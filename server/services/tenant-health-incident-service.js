/**
 * 极轻模式 Phase 2：异常分流 + 有限自愈
 * - 红项按责任方进入队列：customer / cs_ops / third_party / eng
 * - 仅白名单动作可自愈（复检、生成整改报告、通知租户管理员）
 * - 默认不把客户可处理问题丢进研发队列
 */
import {
  runInspection,
  generateInspectionReport,
  saveInspectionReport,
} from './tenant-operation-inspection-service.js';
import { faqForItemKey } from './tenant-health-faq.js';
import { tenantContext } from '../utils/database.js';

const OK_STATUS = '正常';
const RED_SEVERITIES = new Set(['P0', 'P1']);

export const QUEUE_LABELS = {
  customer: '客户可处理',
  cs_ops: '客服 / 实施',
  third_party: '第三方',
  eng: '研发值班',
};

/** 可安全自动执行的自愈动作（禁止自由扩展为任意业务写操作） */
export const HEAL_ACTIONS = {
  rerun_inspection: {
    id: 'rerun_inspection',
    label: '重新运行运营检测',
    description: '对租户重跑巡检并刷新红项缓存。',
  },
  generate_report: {
    id: 'generate_report',
    label: '生成整改报告',
    description: '基于最新巡检生成并保存整改报告。',
  },
  notify_customer: {
    id: 'notify_customer',
    label: '通知租户管理员',
    description: '站内通知 + 飞书（若已绑定），说明需客户处理的事项与 FAQ。',
  },
  notify_ops: {
    id: 'notify_ops',
    label: '通知客服/研发值班',
    description: '向平台值班人员推送本条异常摘要（不改业务数据）。',
  },
  audit_delivery_failures: {
    id: 'audit_delivery_failures',
    label: '汇总近7日触达失败',
    description: '只读汇总 growth_delivery_logs 失败原因；禁止自动重发短信。',
  },
};

/** 可选外部投递（由 index.js 注入，避免循环依赖） */
let _notifiers = {
  sendLarkMessage: null,
  lookupFeishuUserByUsername: null,
  sendOpsAlert: null,
};

export function setHealthIncidentNotifiers(partial = {}) {
  _notifiers = { ..._notifiers, ...partial };
}

/** 某些 item_key 强制进研发（平台技术问题） */
const ENG_ITEM_KEYS = new Set([
  'ai_tasks_generated',
  'execution_review_records',
  'customer_segments_generatable',
]);

/** 某些 item_key 更像第三方/接口 */
const THIRD_PARTY_ITEM_KEYS = new Set([
  'yesterday_orders_synced',
  'pos_data_connected',
  'sms_wecom_sent',
]);

function ymd(date = new Date()) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date ? new Date(date) : new Date());
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

let ensurePromise = null;

export async function ensureHealthIncidentTables(pool) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_health_incidents (
        id BIGSERIAL PRIMARY KEY,
        tenant_id VARCHAR(80) NOT NULL,
        inspection_item_id BIGINT,
        run_id BIGINT,
        item_key TEXT NOT NULL,
        item_name TEXT,
        severity TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        queue TEXT NOT NULL,
        owner_role TEXT,
        responsible_party TEXT,
        impact_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
        suggestion TEXT,
        faq_id TEXT,
        fingerprint TEXT NOT NULL,
        heal_action TEXT,
        heal_result JSONB,
        acked_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        escalated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, fingerprint)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_thi_queue_status ON tenant_health_incidents (queue, status, severity)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_thi_tenant ON tenant_health_incidents (tenant_id, status, updated_at DESC)`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export function classifyIncidentQueue({ item_key, responsible_party, owner_role } = {}) {
  const key = String(item_key || '').trim();
  const party = String(responsible_party || '').trim();
  const role = String(owner_role || '').trim();

  if (ENG_ITEM_KEYS.has(key)) return 'eng';
  if (THIRD_PARTY_ITEM_KEYS.has(key) || party === 'system_integration' || /接口|同步/.test(role)) return 'third_party';
  if (party === 'tenant_admin' || party === 'store_manager' || party === 'employee' || /租户|店长|员工/.test(role)) {
    return 'customer';
  }
  if (party === 'customer_success' || /客户成功|托管/.test(role)) return 'cs_ops';
  // platform_team / 实施人员 → 客服实施队列，默认不进研发
  return 'cs_ops';
}

export function suggestedHealAction(itemKey, queue) {
  const key = String(itemKey || '');
  if (queue === 'customer') return 'notify_customer';
  if (['customer_phone_match_rate', 'order_phone_complete_rate', 'order_customer_id_complete_rate'].includes(key)) {
    return 'notify_customer';
  }
  if (['sms_wecom_sent', 'delivery_campaign_id_complete_rate'].includes(key)) {
    return 'audit_delivery_failures';
  }
  if (queue === 'eng') return 'generate_report';
  if (queue === 'third_party' || queue === 'cs_ops') {
    if (['yesterday_orders_synced', 'pos_data_connected', 'morning_briefing_delivered'].includes(key)) {
      return 'rerun_inspection';
    }
    return 'notify_ops';
  }
  if (['ai_tasks_generated', 'execution_review_records'].includes(key)) return 'generate_report';
  return 'rerun_inspection';
}

const SLA_HOURS = 24;

export function isSlaBreached(incident, now = new Date()) {
  if (!incident) return false;
  const status = String(incident.status || '');
  if (!['open', 'healing'].includes(status)) return false;
  if (incident.acked_at) return false;
  const created = incident.created_at ? new Date(incident.created_at).getTime() : 0;
  if (!created) return false;
  return now.getTime() - created >= SLA_HOURS * 3600 * 1000;
}

function fingerprintFor(tenantId, itemKey, date = ymd()) {
  return `${String(tenantId)}::${String(itemKey)}::${ymd(date)}`;
}

function mapItemToIncident(tenantId, item, runId, date) {
  const queue = classifyIncidentQueue(item);
  const faq = faqForItemKey(item.item_key);
  return {
    tenant_id: tenantId,
    inspection_item_id: item.id || null,
    run_id: runId || item.run_id || null,
    item_key: item.item_key,
    item_name: item.item_name,
    severity: item.severity,
    status: 'open',
    queue,
    owner_role: item.owner_role || '',
    responsible_party: item.responsible_party || '',
    impact_modules: Array.isArray(item.impact_modules) ? item.impact_modules : [],
    suggestion: item.suggestion || '',
    faq_id: faq?.id || null,
    fingerprint: fingerprintFor(tenantId, item.item_key, date),
    suggested_heal: suggestedHealAction(item.item_key, queue),
  };
}

/**
 * 从最新巡检红项同步到分流队列（按日 fingerprint 去重）
 */
export async function syncIncidentsFromInspections(pool, opts = {}) {
  await ensureHealthIncidentTables(pool);
  const date = ymd(opts.date);
  const onlyTenant = String(opts.tenantId || opts.tenant_id || '').trim();

  let tenants;
  if (onlyTenant) {
    tenants = [{ tenant_id: onlyTenant }];
  } else {
    const hasTenants = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants' LIMIT 1`
    );
    if (!hasTenants.rows?.length) tenants = [{ tenant_id: 'default' }];
    else {
      const r = await pool.query(`SELECT tenant_id FROM tenants WHERE status IN ('active','provisioning') ORDER BY created_at DESC`);
      tenants = r.rows?.length ? r.rows : [{ tenant_id: 'default' }];
    }
  }

  let upserted = 0;
  let skipped = 0;
  const byQueue = { customer: 0, cs_ops: 0, third_party: 0, eng: 0 };

  for (const t of tenants) {
    const tenantId = t.tenant_id;
    const runR = await pool.query(
      `SELECT id FROM tenant_operation_inspection_runs
        WHERE tenant_id=$1
        ORDER BY inspection_date DESC, created_at DESC, id DESC LIMIT 1`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    const runId = runR.rows?.[0]?.id;
    if (!runId) continue;

    const itemsR = await pool.query(
      `SELECT * FROM tenant_operation_inspection_items WHERE run_id=$1`,
      [runId]
    ).catch(() => ({ rows: [] }));
    const red = (itemsR.rows || []).filter(
      (i) => i.status !== OK_STATUS && RED_SEVERITIES.has(String(i.severity || ''))
    );

    for (const item of red) {
      const draft = mapItemToIncident(tenantId, item, runId, date);
      byQueue[draft.queue] = (byQueue[draft.queue] || 0) + 1;
      const r = await pool.query(
        `INSERT INTO tenant_health_incidents
          (tenant_id, inspection_item_id, run_id, item_key, item_name, severity, status, queue,
           owner_role, responsible_party, impact_modules, suggestion, faq_id, fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10::jsonb,$11,$12,$13)
         ON CONFLICT (tenant_id, fingerprint) DO UPDATE SET
           inspection_item_id = EXCLUDED.inspection_item_id,
           run_id = EXCLUDED.run_id,
           item_name = EXCLUDED.item_name,
           severity = EXCLUDED.severity,
           queue = CASE
             WHEN tenant_health_incidents.status IN ('escalated') THEN tenant_health_incidents.queue
             WHEN tenant_health_incidents.status IN ('resolved') THEN tenant_health_incidents.queue
             ELSE EXCLUDED.queue
           END,
           owner_role = EXCLUDED.owner_role,
           responsible_party = EXCLUDED.responsible_party,
           impact_modules = EXCLUDED.impact_modules,
           suggestion = EXCLUDED.suggestion,
           faq_id = EXCLUDED.faq_id,
           status = CASE
             WHEN tenant_health_incidents.status = 'resolved' THEN 'resolved'
             WHEN tenant_health_incidents.status = 'escalated' THEN 'escalated'
             ELSE tenant_health_incidents.status
           END,
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          draft.tenant_id,
          draft.inspection_item_id,
          draft.run_id,
          draft.item_key,
          draft.item_name,
          draft.severity,
          draft.queue,
          draft.owner_role,
          draft.responsible_party,
          JSON.stringify(draft.impact_modules),
          draft.suggestion,
          draft.faq_id,
          draft.fingerprint,
        ]
      );
      if (r.rows?.[0]?.inserted) upserted += 1;
      else skipped += 1;
    }
  }

  return {
    ok: true,
    date,
    upserted,
    touched: upserted + skipped,
    queue_counts_from_sync: byQueue,
  };
}

export async function listIncidents(pool, opts = {}) {
  await ensureHealthIncidentTables(pool);
  const queue = String(opts.queue || '').trim();
  const status = String(opts.status || 'open').trim();
  const tenantId = String(opts.tenantId || opts.tenant_id || '').trim();
  const limit = Math.min(Math.max(n(opts.limit) || 100, 1), 300);

  const r = await pool.query(
    `SELECT *
       FROM tenant_health_incidents
      WHERE ($1::text = '' OR queue = $1)
        AND ($2::text = 'all' OR status = $2 OR ($2::text = 'open' AND status IN ('open','acked','healing','escalated')))
        AND ($3::text = '' OR tenant_id = $3)
      ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
               CASE queue WHEN 'eng' THEN 0 WHEN 'third_party' THEN 1 WHEN 'cs_ops' THEN 2 ELSE 3 END,
               updated_at DESC
      LIMIT $4`,
    [queue, status || 'open', tenantId, limit]
  );

  const rows = (r.rows || []).map((row) => ({
    ...row,
    queue_label: QUEUE_LABELS[row.queue] || row.queue,
    impact_modules: Array.isArray(row.impact_modules) ? row.impact_modules : [],
    faq: row.faq_id ? faqForItemKey(row.item_key) : faqForItemKey(row.item_key),
    suggested_heal: suggestedHealAction(row.item_key, row.queue),
    suggested_heal_label: HEAL_ACTIONS[suggestedHealAction(row.item_key, row.queue)]?.label || null,
    sla_breached: isSlaBreached(row),
    sla_hours: SLA_HOURS,
  }));

  const summaryR = await pool.query(
    `SELECT queue, status, COUNT(*)::int AS cnt
       FROM tenant_health_incidents
      WHERE status IN ('open','acked','healing','escalated')
      GROUP BY queue, status`
  );
  const summary = {
    customer: 0,
    cs_ops: 0,
    third_party: 0,
    eng: 0,
    open_total: 0,
    escalated: 0,
    sla_breached: 0,
  };
  for (const row of summaryR.rows || []) {
    if (['open', 'acked', 'healing', 'escalated'].includes(row.status)) {
      summary[row.queue] = (summary[row.queue] || 0) + n(row.cnt);
      summary.open_total += n(row.cnt);
    }
    if (row.status === 'escalated') summary.escalated += n(row.cnt);
  }
  summary.sla_breached = rows.filter((x) => x.sla_breached).length
    || (await countSlaBreached(pool));

  const ops_stats = await getIncidentOpsStats(pool);

  return {
    ok: true,
    filter: { queue: queue || 'all', status: status || 'open', tenant_id: tenantId || null },
    summary,
    ops_stats,
    queue_labels: QUEUE_LABELS,
    heal_actions: Object.values(HEAL_ACTIONS),
    items: rows,
    routing_hint: '客户可处理→通知客户；第三方→查供应商；客服实施→日巡处理；仅平台技术/升级项进研发。超24h未确认会 SLA 提醒（不自动升级）。',
  };
}

async function countSlaBreached(pool) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS cnt
       FROM tenant_health_incidents
      WHERE status IN ('open','healing')
        AND acked_at IS NULL
        AND created_at < NOW() - INTERVAL '24 hours'`
  ).catch(() => ({ rows: [{ cnt: 0 }] }));
  return n(r.rows?.[0]?.cnt);
}

/**
 * 今日运营统计：处理数 / 自愈成功 / 升级研发（供健康页截图）
 */
export async function getIncidentOpsStats(pool) {
  await ensureHealthIncidentTables(pool);
  const r = await pool.query(
    `SELECT
        COUNT(*) FILTER (
          WHERE (acked_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
             OR (resolved_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
             OR (escalated_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
             OR (
               heal_action IS NOT NULL
               AND (updated_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
             )
        )::int AS handled_today,
        COUNT(*) FILTER (
          WHERE heal_action IS NOT NULL
            AND (updated_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
        )::int AS heal_attempts_today,
        COUNT(*) FILTER (
          WHERE heal_action IS NOT NULL
            AND (updated_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
            AND COALESCE(heal_result->>'ok','true') NOT IN ('false','0')
        )::int AS heal_ok_today,
        COUNT(*) FILTER (
          WHERE (escalated_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
        )::int AS escalated_today,
        COUNT(*) FILTER (
          WHERE (resolved_at AT TIME ZONE 'Asia/Shanghai')::date = (NOW() AT TIME ZONE 'Asia/Shanghai')::date
        )::int AS resolved_today,
        COUNT(*) FILTER (
          WHERE status IN ('open','healing') AND acked_at IS NULL
            AND created_at < NOW() - INTERVAL '24 hours'
        )::int AS sla_breached_open
       FROM tenant_health_incidents`
  ).catch(() => ({ rows: [{}] }));
  const row = r.rows?.[0] || {};
  const attempts = n(row.heal_attempts_today);
  const ok = n(row.heal_ok_today);
  return {
    date: ymd(),
    handled_today: n(row.handled_today),
    heal_attempts_today: attempts,
    heal_ok_today: ok,
    heal_success_rate: attempts > 0 ? Math.round((ok / attempts) * 100) : null,
    escalated_today: n(row.escalated_today),
    resolved_today: n(row.resolved_today),
    sla_breached_open: n(row.sla_breached_open),
  };
}

async function getIncident(pool, id) {
  const r = await pool.query(`SELECT * FROM tenant_health_incidents WHERE id=$1 LIMIT 1`, [id]);
  return r.rows?.[0] || null;
}

export async function ackIncident(pool, incidentId, { note } = {}) {
  await ensureHealthIncidentTables(pool);
  const r = await pool.query(
    `UPDATE tenant_health_incidents
        SET status='acked', acked_at=NOW(), updated_at=NOW(),
            heal_result = COALESCE(heal_result,'{}'::jsonb) || jsonb_build_object('ack_note', $2::text)
      WHERE id=$1 AND status IN ('open','healing','acked')
      RETURNING *`,
    [incidentId, String(note || '').slice(0, 500)]
  );
  if (!r.rows?.length) return { ok: false, error: 'not_found_or_not_open' };
  return { ok: true, incident: r.rows[0] };
}

export async function resolveIncident(pool, incidentId, { note } = {}) {
  await ensureHealthIncidentTables(pool);
  const r = await pool.query(
    `UPDATE tenant_health_incidents
        SET status='resolved', resolved_at=NOW(), updated_at=NOW(),
            heal_result = COALESCE(heal_result,'{}'::jsonb) || jsonb_build_object('resolve_note', $2::text)
      WHERE id=$1 AND status <> 'resolved'
      RETURNING *`,
    [incidentId, String(note || '').slice(0, 500)]
  );
  if (!r.rows?.length) return { ok: false, error: 'not_found' };
  return { ok: true, incident: r.rows[0] };
}

export async function escalateIncident(pool, incidentId, { note } = {}) {
  await ensureHealthIncidentTables(pool);
  const r = await pool.query(
    `UPDATE tenant_health_incidents
        SET status='escalated', queue='eng', escalated_at=NOW(), updated_at=NOW(),
            heal_result = COALESCE(heal_result,'{}'::jsonb) || jsonb_build_object('escalate_note', $2::text)
      WHERE id=$1 AND status IN ('open','acked','healing','escalated')
      RETURNING *`,
    [incidentId, String(note || '客服升级研发').slice(0, 500)]
  );
  if (!r.rows?.length) return { ok: false, error: 'not_found' };
  return { ok: true, incident: r.rows[0], message: '已升级到研发值班队列' };
}

async function healRerunInspection(pool, incident) {
  const result = await tenantContext.run(incident.tenant_id, () =>
    runInspection(pool, { tenantId: incident.tenant_id, scope: '全部' })
  );
  const stillBad = (result.items || []).some(
    (i) => i.item_key === incident.item_key && i.status !== OK_STATUS
  );
  return {
    ok: true,
    action: 'rerun_inspection',
    health_score: result.overview?.health_score ?? null,
    item_still_abnormal: stillBad,
    auto_resolved: !stillBad,
  };
}

async function healGenerateReport(pool, incident) {
  const result = await tenantContext.run(incident.tenant_id, () =>
    runInspection(pool, { tenantId: incident.tenant_id, scope: '全部' })
  );
  const report = generateInspectionReport({
    tenantId: incident.tenant_id,
    overview: result.overview,
    store_results: result.store_results,
    items: result.items,
  });
  const saved = await saveInspectionReport(pool, {
    tenantId: incident.tenant_id,
    runId: result.items?.[0]?.run_id || incident.run_id || null,
    report,
  });
  return {
    ok: true,
    action: 'generate_report',
    report_id: saved.report?.id || null,
    auto_resolved: false,
  };
}

async function healNotifyCustomer(pool, incident) {
  const faq = faqForItemKey(incident.item_key) || (incident.faq_id ? { id: incident.faq_id, title: incident.faq_id } : null);
  const usersR = await pool.query(
    `SELECT username FROM users
      WHERE COALESCE(tenant_id,'default')=$1
        AND COALESCE(is_active,true)=true
        AND role IN ('admin','tenant_admin','hq_manager','operation_admin')
      ORDER BY id ASC LIMIT 20`,
    [incident.tenant_id]
  ).catch(() => ({ rows: [] }));

  let targets = usersR.rows || [];
  if (!targets.length) {
    const empR = await pool.query(
      `SELECT username FROM employees
        WHERE COALESCE(tenant_id,'default')=$1
          AND role IN ('admin','tenant_admin','hq_manager','store_manager')
        LIMIT 20`,
      [incident.tenant_id]
    ).catch(() => ({ rows: [] }));
    targets = empR.rows || [];
  }

  const title = `【需门店处理】${incident.item_name || incident.item_key}`;
  const message = [
    `租户：${incident.tenant_id}`,
    `问题：${incident.item_name || incident.item_key}（${incident.severity || ''}）`,
    `缺少/影响：${incident.suggestion || '请按健康中心建议完成配置或确认。'}`,
    faq ? `自助说明：${faq.title || faq.id}（FAQ:${faq.id}）` : null,
    '此问题归类为「客户可处理」，请门店/管理员处理，无需研发介入。',
    '入口：平台控制台 → 健康中心',
  ].filter(Boolean).join('\n');

  let notified = 0;
  const delivery = { in_app: [], feishu: [] };
  const hasNotif = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='hrms_user_notifications' LIMIT 1`
  );
  if (hasNotif.rows?.length) {
    for (const u of targets) {
      const ins = await pool.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
         VALUES ($1,$2,$3,'health_incident',$4::jsonb,$5)
         RETURNING id`,
        [
          u.username,
          title,
          message,
          JSON.stringify({
            incident_id: incident.id,
            item_key: incident.item_key,
            queue: 'customer',
            faq_id: faq?.id || incident.faq_id || null,
            channel: 'in_app',
          }),
          incident.tenant_id,
        ]
      ).catch((e) => ({ rows: [], error: e?.message }));
      if (ins.rows?.length) {
        notified += 1;
        delivery.in_app.push({ username: u.username, ok: true, id: ins.rows[0].id });
      } else {
        delivery.in_app.push({ username: u.username, ok: false, error: ins.error || 'insert_failed' });
      }
    }
  }

  let feishuSent = 0;
  let feishuFailed = 0;
  if (typeof _notifiers.lookupFeishuUserByUsername === 'function' && typeof _notifiers.sendLarkMessage === 'function') {
    const seen = new Set();
    for (const u of targets) {
      try {
        const fu = await _notifiers.lookupFeishuUserByUsername(u.username);
        const openId = String(fu?.open_id || '').trim();
        if (!openId || seen.has(openId)) continue;
        seen.add(openId);
        const sent = await _notifiers.sendLarkMessage(openId, `${title}\n\n${message}`, { skipDedup: true })
          .catch((e) => ({ ok: false, error: e?.message }));
        if (sent?.ok) {
          feishuSent += 1;
          delivery.feishu.push({ username: u.username, open_id: openId, ok: true });
        } else {
          feishuFailed += 1;
          delivery.feishu.push({ username: u.username, open_id: openId, ok: false, error: sent?.error || 'send_failed' });
        }
      } catch (e) {
        feishuFailed += 1;
        delivery.feishu.push({ username: u.username, ok: false, error: e?.message || String(e) });
      }
    }
  }

  return {
    ok: notified > 0 || feishuSent > 0,
    action: 'notify_customer',
    notified,
    feishu_sent: feishuSent,
    feishu_failed: feishuFailed,
    targets: targets.map((x) => x.username),
    faq_id: faq?.id || null,
    delivery,
    auto_resolved: false,
    message: (notified || feishuSent)
      ? `站内 ${notified} / 飞书 ${feishuSent}（失败 ${feishuFailed}）`
      : '未找到可通知的管理员账号或投递失败（已记录工单）',
  };
}

async function healNotifyOps(pool, incident) {
  const faq = faqForItemKey(incident.item_key);
  const queueLabel = QUEUE_LABELS[incident.queue] || incident.queue;
  const text = [
    `【健康中心·${queueLabel}】`,
    `租户 ${incident.tenant_id}`,
    `${incident.severity || ''} ${incident.item_name || incident.item_key}`,
    incident.suggestion || '',
    faq ? `FAQ: ${faq.title} (${faq.id})` : '',
    `工单 #${incident.id} · 请在 platform-admin「健康」页处理`,
  ].filter(Boolean).join('\n');

  let alertResult = { ok: false };
  if (typeof _notifiers.sendOpsAlert === 'function') {
    alertResult = await _notifiers.sendOpsAlert(text, {
      title: `健康中心 ${queueLabel}`,
      audience: incident.queue === 'eng' ? 'eng' : 'cs',
      meta: { incident_id: incident.id, queue: incident.queue, item_key: incident.item_key },
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
  }

  return {
    ok: !!alertResult?.ok || (alertResult?.feishuSent || 0) > 0,
    action: 'notify_ops',
    audience: incident.queue === 'eng' ? 'eng' : 'cs',
    alert: alertResult,
    auto_resolved: false,
    message: (alertResult?.feishuSent || alertResult?.ok)
      ? `已通知值班（飞书 ${alertResult.feishuSent || 0}）`
      : `值班通知未投递：${alertResult?.error || 'notifier_unavailable'}`,
  };
}

async function healAuditDeliveryFailures(pool, incident) {
  const has = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='growth_delivery_logs' LIMIT 1`
  );
  if (!has.rows?.length) {
    return { ok: false, action: 'audit_delivery_failures', error: 'growth_delivery_logs_missing', auto_resolved: false };
  }

  const r = await pool.query(
    `SELECT status, COUNT(*)::int AS cnt,
            MAX(created_at) AS last_at,
            MIN(COALESCE(error_message, result->>'error', payload->>'error', '')) AS sample_error
       FROM growth_delivery_logs
      WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY status
      ORDER BY cnt DESC`,
    [incident.tenant_id]
  ).catch(() => ({ rows: [] }));

  const byStatus = {};
  let total = 0;
  let failed = 0;
  for (const row of r.rows || []) {
    const c = n(row.cnt);
    byStatus[row.status] = { count: c, last_at: row.last_at, sample_error: row.sample_error || null };
    total += c;
    if (['failed', 'error', 'rejected'].includes(String(row.status))) failed += c;
  }
  const failRate = total > 0 ? Math.round((failed / total) * 100) : 0;
  const summary = {
    window_days: 7,
    total,
    failed,
    fail_rate_pct: failRate,
    by_status: byStatus,
    note: '仅汇总，未自动重发短信/企微',
  };

  // 顺带提醒值班（不重发）
  let alert = null;
  if (failed > 0 && typeof _notifiers.sendOpsAlert === 'function') {
    alert = await _notifiers.sendOpsAlert(
      [
        '【健康中心·触达失败汇总】',
        `租户 ${incident.tenant_id}`,
        `近7日失败 ${failed}/${total}（${failRate}%）`,
        `关联项：${incident.item_name || incident.item_key}`,
        '禁止自动重发；请人工核对模板/运营商/频控后决定是否补发。',
      ].join('\n'),
      { title: '触达失败汇总', audience: 'cs', meta: { incident_id: incident.id, audit: summary } }
    ).catch((e) => ({ ok: false, error: e?.message }));
  }

  return {
    ok: true,
    action: 'audit_delivery_failures',
    summary,
    alert,
    auto_resolved: false,
    message: total ? `近7日失败率 ${failRate}%（${failed}/${total}）` : '近7日无触达记录',
  };
}

/**
 * 白名单自愈。未知 action 一律拒绝。
 */
export async function healIncident(pool, incidentId, { action } = {}) {
  await ensureHealthIncidentTables(pool);
  const incident = await getIncident(pool, incidentId);
  if (!incident) return { ok: false, error: 'not_found' };
  if (incident.status === 'resolved') return { ok: false, error: 'already_resolved' };

  const actionId = String(action || suggestedHealAction(incident.item_key, incident.queue)).trim();
  if (!HEAL_ACTIONS[actionId]) {
    return { ok: false, error: 'action_not_allowed', allowed: Object.keys(HEAL_ACTIONS) };
  }

  await pool.query(
    `UPDATE tenant_health_incidents SET status='healing', heal_action=$2, updated_at=NOW() WHERE id=$1`,
    [incidentId, actionId]
  );

  let result;
  try {
    if (actionId === 'rerun_inspection') result = await healRerunInspection(pool, incident);
    else if (actionId === 'generate_report') result = await healGenerateReport(pool, incident);
    else if (actionId === 'notify_customer') result = await healNotifyCustomer(pool, incident);
    else if (actionId === 'notify_ops') result = await healNotifyOps(pool, incident);
    else if (actionId === 'audit_delivery_failures') result = await healAuditDeliveryFailures(pool, incident);
    else return { ok: false, error: 'action_not_implemented' };
  } catch (e) {
    await pool.query(
      `UPDATE tenant_health_incidents
          SET status='acked', heal_result=$2::jsonb, updated_at=NOW()
        WHERE id=$1`,
      [incidentId, JSON.stringify({ ok: false, error: e?.message || String(e), action: actionId })]
    );
    return { ok: false, error: 'heal_failed', message: e?.message || String(e) };
  }

  const nextStatus = result.auto_resolved ? 'resolved' : 'acked';
  const updated = await pool.query(
    `UPDATE tenant_health_incidents
        SET status=$2,
            heal_action=$3,
            heal_result=$4::jsonb,
            resolved_at=CASE WHEN $2='resolved' THEN NOW() ELSE resolved_at END,
            acked_at=CASE WHEN $2='acked' AND acked_at IS NULL THEN NOW() ELSE acked_at END,
            updated_at=NOW()
      WHERE id=$1
      RETURNING *`,
    [incidentId, nextStatus, actionId, JSON.stringify(result)]
  );

  return {
    ok: true,
    action: actionId,
    action_label: HEAL_ACTIONS[actionId].label,
    result,
    incident: updated.rows?.[0] || null,
  };
}

/**
 * 构建并投递队列摘要（客服 / 研发分流）
 */
export async function sendQueueDigests(pool) {
  const digests = await buildQueueDigests(pool);
  const results = { cs: null, eng: null, empty: null };
  if (typeof _notifiers.sendOpsAlert !== 'function') {
    return { ok: false, error: 'notifier_unavailable', digests };
  }
  if (digests.cs.count > 0) {
    results.cs = await _notifiers.sendOpsAlert(digests.cs.text, { title: '客服日巡摘要', audience: 'cs' })
      .catch((e) => ({ ok: false, error: e?.message }));
  }
  if (digests.eng.count > 0) {
    results.eng = await _notifiers.sendOpsAlert(digests.eng.text, { title: '研发值班摘要', audience: 'eng' })
      .catch((e) => ({ ok: false, error: e?.message }));
  }
  if (!digests.cs.count && !digests.eng.count) {
    results.empty = await _notifiers.sendOpsAlert(
      `【健康中心】${digests.ops_stats?.date || ymd()} 开放队列为空。今日处理 ${digests.ops_stats?.handled_today ?? 0}。`,
      { title: '健康中心日巡', audience: 'cs' }
    ).catch((e) => ({ ok: false, error: e?.message }));
  }
  return { ok: true, digests, results };
}

/**
 * 构建队列摘要文案（客服 / 研发分流）
 */
export async function buildQueueDigests(pool) {
  await ensureHealthIncidentTables(pool);
  const listed = await listIncidents(pool, { status: 'open', limit: 80 });
  const items = listed.items || [];
  const csItems = items.filter((i) => ['customer', 'cs_ops', 'third_party'].includes(i.queue));
  const engItems = items.filter((i) => i.queue === 'eng' || i.status === 'escalated');
  const fmt = (arr, title) => {
    const top = arr.slice(0, 8).map((i) =>
      `· [${i.severity || '?'}] ${i.tenant_id} ${i.item_name || i.item_key}${i.sla_breached ? ' ⚠SLA' : ''}`
    );
    return [
      title,
      `开放 ${arr.length} 条 | 今日处理 ${listed.ops_stats?.handled_today ?? 0} | 自愈成功 ${listed.ops_stats?.heal_ok_today ?? 0}/${listed.ops_stats?.heal_attempts_today ?? 0} | 升级 ${listed.ops_stats?.escalated_today ?? 0}`,
      top.length ? top.join('\n') : '· （无开放项）',
      '入口：/platform-admin → 健康',
    ].join('\n');
  };
  return {
    ok: true,
    ops_stats: listed.ops_stats,
    summary: listed.summary,
    cs: { count: csItems.length, text: fmt(csItems, '【客服日巡摘要】客户+客服+第三方') },
    eng: { count: engItems.length, text: fmt(engItems, '【研发值班摘要】仅 eng / 已升级') },
  };
}

/**
 * SLA：列出超 24h 未确认的开放工单（不自动改 queue）
 */
export async function listSlaBreaches(pool, { limit = 30 } = {}) {
  await ensureHealthIncidentTables(pool);
  const r = await pool.query(
    `SELECT *
       FROM tenant_health_incidents
      WHERE status IN ('open','healing')
        AND acked_at IS NULL
        AND created_at < NOW() - INTERVAL '24 hours'
      ORDER BY created_at ASC
      LIMIT $1`,
    [Math.min(Math.max(n(limit) || 30, 1), 100)]
  );
  const items = (r.rows || []).map((row) => ({
    ...row,
    queue_label: QUEUE_LABELS[row.queue] || row.queue,
    sla_breached: true,
    age_hours: Math.round((Date.now() - new Date(row.created_at).getTime()) / 3600000),
  }));
  return { ok: true, count: items.length, items, sla_hours: SLA_HOURS };
}

/**
 * 发送 SLA 提醒（仅提醒，不自动升级）
 */
export async function sendSlaReminders(pool) {
  const listed = await listSlaBreaches(pool, { limit: 40 });
  if (!listed.count) return { ok: true, sent: false, count: 0, message: 'no_sla_breach' };
  const lines = listed.items.slice(0, 12).map((i) =>
    `· #${i.id} ${i.tenant_id} [${QUEUE_LABELS[i.queue] || i.queue}] ${i.item_name || i.item_key}（${i.age_hours}h）`
  );
  const text = [
    `【健康中心·SLA提醒】超 ${SLA_HOURS}h 未确认 ${listed.count} 条`,
    '不会自动升级研发，请人工确认或分流。',
    ...lines,
  ].join('\n');
  let alert = { ok: false };
  if (typeof _notifiers.sendOpsAlert === 'function') {
    alert = await _notifiers.sendOpsAlert(text, {
      title: '健康中心 SLA 提醒',
      audience: 'cs',
      meta: { type: 'sla_reminder', count: listed.count },
    }).catch((e) => ({ ok: false, error: e?.message }));
  }
  return { ok: true, sent: !!(alert?.ok || alert?.feishuSent), count: listed.count, alert };
}

/**
 * 兼容旧「生成补救任务」入口：改为写入分流队列，不再派 master_tasks。
 */
export async function routeInspectionItemToIncident(pool, { item, itemId } = {}) {
  await ensureHealthIncidentTables(pool);
  let row = item;
  if (!row && itemId) {
    const r = await pool.query(`SELECT * FROM tenant_operation_inspection_items WHERE id=$1 LIMIT 1`, [itemId]);
    row = r.rows?.[0] || null;
  }
  if (!row) return { ok: false, error: 'inspection_item_not_found' };

  const tenantId = row.tenant_id || 'default';
  const draft = mapItemToIncident(tenantId, row, row.run_id, ymd());
  const saved = await pool.query(
    `INSERT INTO tenant_health_incidents
      (tenant_id, inspection_item_id, run_id, item_key, item_name, severity, status, queue,
       owner_role, responsible_party, impact_modules, suggestion, faq_id, fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10::jsonb,$11,$12,$13)
     ON CONFLICT (tenant_id, fingerprint) DO UPDATE SET
       updated_at=NOW(),
       inspection_item_id=EXCLUDED.inspection_item_id,
       suggestion=EXCLUDED.suggestion
     RETURNING *`,
    [
      draft.tenant_id,
      draft.inspection_item_id,
      draft.run_id,
      draft.item_key,
      draft.item_name,
      draft.severity,
      draft.queue,
      draft.owner_role,
      draft.responsible_party,
      JSON.stringify(draft.impact_modules),
      draft.suggestion,
      draft.faq_id,
      draft.fingerprint,
    ]
  );

  return {
    ok: true,
    routed: true,
    deprecated_master_task: true,
    message: `已分流到「${QUEUE_LABELS[draft.queue] || draft.queue}」队列，不再派发门店任务。`,
    incident: saved.rows?.[0] || null,
    queue: draft.queue,
    suggested_heal: draft.suggested_heal,
  };
}

export async function routeInspectionItemsBatch(pool, opts = {}) {
  await ensureHealthIncidentTables(pool);
  const tenantId = String(opts.tenantId || opts.tenant_id || 'default').trim() || 'default';
  const storeId = String(opts.storeId || opts.store_id || '').trim();
  const severities = Array.isArray(opts.severity) ? opts.severity : String(opts.severity || 'P0,P1').split(',').map((x) => x.trim()).filter(Boolean);
  const r = await pool.query(
    `SELECT * FROM tenant_operation_inspection_items
      WHERE tenant_id=$1
        AND ($2::text='' OR store_id=$2)
        AND status <> $3
        AND severity = ANY($4::text[])
      ORDER BY created_at DESC
      LIMIT 100`,
    [tenantId, storeId, OK_STATUS, severities]
  );
  const results = [];
  for (const item of r.rows || []) {
    results.push(await routeInspectionItemToIncident(pool, { item }));
  }
  return {
    ok: true,
    count: results.length,
    routed: results.filter((x) => x.ok).length,
    items: results,
    message: '已批量写入分流队列（白名单自愈，不派发 master_tasks）。',
  };
}
