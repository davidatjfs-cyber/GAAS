/**
 * 租户健康中心（极轻模式 Phase 1）
 * - 全租户红名单：复用 tenant_operation_inspection_* 缓存，避免每次列表都全量重跑
 * - 补充信号：客户登录、短信配置、本月营销执行、月度/晨报类送达
 * - 红项深链 FAQ
 */
import { runInspection } from './tenant-operation-inspection-service.js';
import { isAliyunSmsConfigured, isAliyunSmsAutoSendEnabled } from '../sms.js';
import { faqForItemKey, listHealthFaqs } from './tenant-health-faq.js';
import { tenantContext } from '../utils/database.js';

const OK_STATUS = '正常';
const RED_SEVERITIES = new Set(['P0', 'P1']);

function ymd(date = new Date()) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date ? new Date(date) : new Date());
}

function monthStart(date = new Date()) {
  const s = ymd(date);
  return `${s.slice(0, 7)}-01`;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function tableExists(pool, table) {
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [table]
    );
    return !!r.rows?.length;
  } catch {
    return false;
  }
}

async function listTenants(pool) {
  if (!(await tableExists(pool, 'tenants'))) {
    return [{ tenant_id: 'default', name: 'default', status: 'active', mode: 'managed' }];
  }
  const r = await pool.query(
    `SELECT tenant_id, name, status, mode, created_at
       FROM tenants
      ORDER BY CASE WHEN status='active' THEN 0 WHEN status='provisioning' THEN 1 ELSE 2 END, created_at DESC`
  );
  return r.rows || [];
}

async function latestRunForTenant(pool, tenantId) {
  if (!(await tableExists(pool, 'tenant_operation_inspection_runs'))) return null;
  const r = await pool.query(
    `SELECT id, tenant_id, store_id, inspection_date::text AS inspection_date,
            health_score, risk_level, data_completeness, data_freshness,
            task_completion_rate, ai_runnable_rate, attribution_completeness,
            summary, inspection_status, operation_stage, customer_success_risk,
            created_at
       FROM tenant_operation_inspection_runs
      WHERE tenant_id=$1
      ORDER BY inspection_date DESC, created_at DESC, id DESC
      LIMIT 1`,
    [tenantId]
  );
  return r.rows?.[0] || null;
}

async function itemsForRun(pool, runId, { severities = null } = {}) {
  if (!runId || !(await tableExists(pool, 'tenant_operation_inspection_items'))) return [];
  const r = await pool.query(
    `SELECT id, run_id, tenant_id, store_id, category, item_key, item_name, status, severity,
            owner_role, responsible_party, impact_modules, impact_description, suggestion, evidence,
            can_generate_task, created_at
       FROM tenant_operation_inspection_items
      WHERE run_id=$1
      ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, id ASC`,
    [runId]
  );
  let rows = r.rows || [];
  if (Array.isArray(severities) && severities.length) {
    const set = new Set(severities);
    rows = rows.filter((row) => set.has(String(row.severity || '')));
  }
  return rows.map((row) => ({
    ...row,
    impact_modules: Array.isArray(row.impact_modules) ? row.impact_modules : (row.impact_modules || []),
    faq: faqForItemKey(row.item_key),
  }));
}

async function loadSupplementalSignals(pool, tenantId) {
  const signals = [];
  const now = new Date();
  const mStart = monthStart(now);
  const day30 = new Date(now.getTime() - 30 * 86400000);

  // 1) 客户登录（30 天内是否有该租户登录）
  if (await tableExists(pool, 'user_login_log')) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt, MAX(login_at) AS last_login_at
         FROM user_login_log
        WHERE COALESCE(tenant_id,'default')=$1 AND login_at >= $2`,
      [tenantId, day30.toISOString()]
    ).catch(() => ({ rows: [{ cnt: 0, last_login_at: null }] }));
    const cnt = n(r.rows?.[0]?.cnt);
    const last = r.rows?.[0]?.last_login_at || null;
    signals.push({
      key: 'customer_login_30d',
      label: '客户是否登录',
      ok: cnt > 0,
      level: cnt > 0 ? 'green' : 'yellow',
      severity: cnt > 0 ? null : 'P1',
      detail: cnt > 0 ? `近30天登录 ${cnt} 次` : '近30天无登录记录',
      evidence: { login_count_30d: cnt, last_login_at: last },
      faq: faqForItemKey('manager_roles_configured'),
    });
  }

  // 2) 短信配置（当前为平台全局；租户级配置后续可替换）
  const smsConfigured = isAliyunSmsConfigured();
  const smsEnabled = isAliyunSmsAutoSendEnabled();
  signals.push({
    key: 'sms_platform_ready',
    label: '短信是否正常',
    ok: smsConfigured && smsEnabled,
    level: smsConfigured && smsEnabled ? 'green' : smsConfigured ? 'yellow' : 'red',
    severity: smsConfigured && smsEnabled ? null : smsConfigured ? 'P1' : 'P0',
    detail: !smsConfigured ? '平台短信密钥/签名未配置' : !smsEnabled ? '短信已配置但自动发送未开启' : '短信配置可用',
    evidence: { configured: smsConfigured, auto_send_enabled: smsEnabled, scope: 'platform_global' },
    faq: faqForItemKey('sms_wecom_sent'),
  });

  // 3) 本月是否有营销执行
  if (await tableExists(pool, 'growth_delivery_logs')) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('sent','success','delivered'))::int AS sent
         FROM growth_delivery_logs
        WHERE tenant_id=$1 AND created_at >= $2::date`,
      [tenantId, mStart]
    ).catch(() => ({ rows: [{ total: 0, sent: 0 }] }));
    const sent = n(r.rows?.[0]?.sent);
    const total = n(r.rows?.[0]?.total);
    signals.push({
      key: 'marketing_executed_mtd',
      label: '本月是否有营销执行',
      ok: sent > 0,
      level: sent > 0 ? 'green' : 'yellow',
      severity: sent > 0 ? null : 'P1',
      detail: sent > 0 ? `本月已发送 ${sent} 次触达` : '本月尚无成功发送记录',
      evidence: { month_start: mStart, delivery_total: total, delivery_sent: sent },
      faq: faqForItemKey('sms_wecom_sent'),
    });
  }

  // 4) 月度/晨报类是否有送达迹象（晨报本月 or 巡检报告本月）
  let reportOk = false;
  let reportDetail = '本月未见报告/晨报送达记录';
  const evidence = { month_start: mStart };

  if (await tableExists(pool, 'agent_v2_morning_briefing_sends')) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt, MAX(created_at) AS last_at
         FROM agent_v2_morning_briefing_sends
        WHERE COALESCE(tenant_id,'default')=$1 AND created_at >= $2::date`,
      [tenantId, mStart]
    ).catch(() => ({ rows: [{ cnt: 0, last_at: null }] }));
    evidence.morning_briefing_mtd = n(r.rows?.[0]?.cnt);
    evidence.morning_briefing_last_at = r.rows?.[0]?.last_at || null;
    if (n(r.rows?.[0]?.cnt) > 0) {
      reportOk = true;
      reportDetail = `本月晨报已送达 ${n(r.rows?.[0]?.cnt)} 次`;
    }
  }

  if (!reportOk && (await tableExists(pool, 'tenant_operation_inspection_reports'))) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt, MAX(created_at) AS last_at
         FROM tenant_operation_inspection_reports
        WHERE tenant_id=$1 AND created_at >= $2::date`,
      [tenantId, mStart]
    ).catch(() => ({ rows: [{ cnt: 0, last_at: null }] }));
    evidence.inspection_report_mtd = n(r.rows?.[0]?.cnt);
    if (n(r.rows?.[0]?.cnt) > 0) {
      reportOk = true;
      reportDetail = `本月已生成巡检/整改报告 ${n(r.rows?.[0]?.cnt)} 份`;
    }
  }

  signals.push({
    key: 'monthly_or_briefing_report',
    label: '月度报告是否生成',
    ok: reportOk,
    level: reportOk ? 'green' : 'yellow',
    severity: reportOk ? null : 'P1',
    detail: reportDetail,
    evidence,
    faq: faqForItemKey('morning_briefing_delivered'),
  });

  return signals;
}

function trafficLight({ run, redItems, signals, tenantStatus }) {
  if (!run) return 'gray';
  const hasP0 = redItems.some((i) => i.severity === 'P0');
  const hasP1 = redItems.some((i) => i.severity === 'P1');
  const score = run.health_score == null ? null : n(run.health_score);
  const csRisk = String(run.customer_success_risk || '').toLowerCase();
  // 平台全局信号（如短信密钥）只展示，不单独把每家租户打成红灯，避免淹没真实门店问题
  const fatalSignal = (signals || []).some((s) => !s.ok && s.level === 'red' && s.evidence?.scope !== 'platform_global');
  const warnSignal = (signals || []).some((s) => !s.ok && (s.level === 'yellow' || s.level === 'red'));

  if (hasP0 || csRisk === 'high' || (score != null && score < 60) || fatalSignal) return 'red';
  if (hasP1 || csRisk === 'medium' || warnSignal) return 'yellow';
  return 'green';
}

function pickSignalMap(signals) {
  const map = {};
  for (const s of signals || []) map[s.key] = s;
  return map;
}

async function buildTenantHealthCard(pool, tenant, { includeItems = true } = {}) {
  const tenantId = tenant.tenant_id;
  const run = await latestRunForTenant(pool, tenantId);
  const allItems = run && includeItems ? await itemsForRun(pool, run.id) : [];
  const redItems = allItems.filter((i) => i.status !== OK_STATUS && RED_SEVERITIES.has(String(i.severity || '')));
  const signals = await loadSupplementalSignals(pool, tenantId);
  const light = trafficLight({ run, redItems, signals, tenantStatus: tenant.status });
  const signalMap = pickSignalMap(signals);

  // 从检测项里抽关键指标摘要
  const byKey = Object.fromEntries(allItems.map((i) => [i.item_key, i]));
  const phoneItem = byKey.customer_phone_match_rate || byKey.order_phone_complete_rate;
  const syncItem = byKey.yesterday_orders_synced;
  const attrItem = byKey.attribution_links_orders;
  const aiBlocked = allItems.some((i) => i.category === 'AI 可运行度' && i.status !== OK_STATUS && RED_SEVERITIES.has(i.severity));

  return {
    tenant_id: tenantId,
    tenant_name: tenant.name || tenantId,
    status: tenant.status,
    mode: tenant.mode,
    light,
    light_label: { red: '红', yellow: '黄', green: '绿', gray: '未检测' }[light] || light,
    health_score: run?.health_score ?? null,
    risk_level: run?.risk_level || null,
    customer_success_risk: run?.customer_success_risk || null,
    operation_stage: run?.operation_stage || null,
    inspection_status: run?.inspection_status || null,
    last_inspection_at: run?.created_at || null,
    last_inspection_date: run?.inspection_date || null,
    run_id: run?.id || null,
    p0_count: redItems.filter((i) => i.severity === 'P0').length,
    p1_count: redItems.filter((i) => i.severity === 'P1').length,
    red_item_count: redItems.length,
    indicators: {
      data_sync_ok: syncItem ? syncItem.status === OK_STATUS : null,
      last_sync_time: syncItem?.evidence?.latest_sync_time || null,
      phone_match_rate: phoneItem?.evidence?.rate ?? phoneItem?.evidence?.phone_match_rate ?? null,
      attribution_available: attrItem ? attrItem.status === OK_STATUS : null,
      ai_available: aiBlocked ? false : (run ? true : null),
      sms_ok: signalMap.sms_platform_ready?.ok ?? null,
      marketing_mtd_ok: signalMap.marketing_executed_mtd?.ok ?? null,
      customer_login_ok: signalMap.customer_login_30d?.ok ?? null,
      monthly_report_ok: signalMap.monthly_or_briefing_report?.ok ?? null,
      churn_risk: run?.customer_success_risk || null,
    },
    signals,
    red_items: redItems.slice(0, 20),
    top_red: redItems.slice(0, 3).map((i) => ({
      item_key: i.item_key,
      item_name: i.item_name,
      severity: i.severity,
      responsible_party: i.responsible_party,
      owner_role: i.owner_role,
      suggestion: i.suggestion,
      faq: i.faq,
    })),
  };
}

/**
 * 健康中心看板：全租户红绿灯 + 红名单
 * @param {{ light?: 'red'|'yellow'|'green'|'gray'|'all', refresh?: boolean }} opts
 */
export async function getHealthCenterBoard(pool, opts = {}) {
  const lightFilter = String(opts.light || 'red').trim() || 'red';
  const tenants = await listTenants(pool);
  const cards = [];
  for (const tenant of tenants) {
    // 补充信号与缓存读取在 tenantContext 下执行，兼容后续 RLS/租户隔离
    const card = await tenantContext.run(tenant.tenant_id, () => buildTenantHealthCard(pool, tenant));
    cards.push(card);
  }

  const summary = {
    total: cards.length,
    red: cards.filter((c) => c.light === 'red').length,
    yellow: cards.filter((c) => c.light === 'yellow').length,
    green: cards.filter((c) => c.light === 'green').length,
    gray: cards.filter((c) => c.light === 'gray').length,
    p0_total: cards.reduce((s, c) => s + n(c.p0_count), 0),
    p1_total: cards.reduce((s, c) => s + n(c.p1_count), 0),
  };

  const order = { red: 0, yellow: 1, gray: 2, green: 3 };
  let list = cards.slice().sort((a, b) => {
    const d = (order[a.light] ?? 9) - (order[b.light] ?? 9);
    if (d !== 0) return d;
    return n(b.p0_count) - n(a.p0_count) || n(b.p1_count) - n(a.p1_count) || String(a.tenant_id).localeCompare(String(b.tenant_id));
  });
  if (lightFilter !== 'all') list = list.filter((c) => c.light === lightFilter);

  let incidents = null;
  try {
    const { listIncidents, syncIncidentsFromInspections } = await import('./tenant-health-incident-service.js');
    // 看板打开时轻量同步一次，保证队列与最新红项对齐（幂等）
    if (opts.syncIncidents !== false) {
      await syncIncidentsFromInspections(pool, {}).catch(() => null);
    }
    const listed = await listIncidents(pool, { status: 'open', limit: 50 });
    incidents = {
      summary: listed.summary,
      queue_labels: listed.queue_labels,
      open_preview: listed.items.slice(0, 20),
    };
  } catch (e) {
    incidents = { error: e?.message || String(e) };
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    filter: { light: lightFilter },
    summary,
    tenants: list,
    incidents,
    faqs: listHealthFaqs(),
    sop_hint: '每天只处理红色；黄/绿不主动打扰。分流队列见下方：客户/客服/第三方/研发。',
  };
}

export async function getHealthCenterTenantDetail(pool, tenantId) {
  const id = String(tenantId || '').trim() || 'default';
  const tenants = await listTenants(pool);
  const tenant = tenants.find((t) => t.tenant_id === id) || { tenant_id: id, name: id, status: 'unknown', mode: 'managed' };
  const card = await tenantContext.run(id, () => buildTenantHealthCard(pool, tenant, { includeItems: true }));
  const allItems = card.run_id ? await itemsForRun(pool, card.run_id) : [];
  return {
    ok: true,
    tenant: card,
    items: allItems,
    faqs: listHealthFaqs(),
  };
}

/**
 * 全量或指定租户扫描（写入 inspection runs）
 */
export async function scanHealthCenter(pool, opts = {}) {
  const date = ymd(opts.date);
  const tenants = await listTenants(pool);
  const only = Array.isArray(opts.tenantIds) && opts.tenantIds.length
    ? new Set(opts.tenantIds.map((x) => String(x).trim()).filter(Boolean))
    : null;
  const targets = only ? tenants.filter((t) => only.has(t.tenant_id)) : tenants.filter((t) => ['active', 'provisioning'].includes(String(t.status || '')));
  const results = [];
  for (const tenant of targets) {
    try {
      const result = await tenantContext.run(tenant.tenant_id, () => runInspection(pool, {
        tenantId: tenant.tenant_id,
        date,
        scope: '全部',
      }));
      const red = (result.items || []).filter((i) => i.status !== OK_STATUS && RED_SEVERITIES.has(i.severity));
      results.push({
        tenant_id: tenant.tenant_id,
        ok: true,
        health_score: result.overview?.health_score ?? null,
        risk_level: result.overview?.risk_level || null,
        customer_success_risk: result.overview?.customer_success_risk || null,
        p0_count: red.filter((i) => i.severity === 'P0').length,
        p1_count: red.filter((i) => i.severity === 'P1').length,
      });
    } catch (e) {
      results.push({ tenant_id: tenant.tenant_id, ok: false, error: e?.message || String(e) });
    }
  }
  return {
    ok: true,
    date,
    scanned: results.length,
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
