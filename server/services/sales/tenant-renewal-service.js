/**
 * 续费健康度 + 续费风险预警 + 转介绍机会：给已开通租户算一个"值不值得续费/该不该问转介绍"的分数。
 * 与 tenant-health-center-service.js 的运营巡检 health_score 是两回事——那个是"系统运行是否正常"，
 * 这个是"这个客户续费概率高不高"，输入信号更偏商业侧(license倒计时/归因产出/CS积压)。
 */
import { getHealthCenterTenantDetail } from '../tenant-health-center-service.js';
import { upsertTask } from './sales-store.js';

function daysUntil(dateVal) {
  if (!dateVal) return null;
  return Math.ceil((new Date(dateVal).getTime() - Date.now()) / 86400000);
}

/**
 * 0-100 分，越低续费风险越大。透明的加减分规则，不是黑盒模型。
 */
export async function computeRenewalHealth(pool, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) return { ok: false, error: 'tenant_id_required' };

  const [licenseR, detail, attrR, openTaskR] = await Promise.all([
    pool.query(`SELECT expires_at, status FROM licenses WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tid]),
    getHealthCenterTenantDetail(pool, tid),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM growth_ontology_attributions WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '30 days'`,
      [tid]
    ).catch(() => ({ rows: [{ cnt: 0 }] })),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM tenant_health_incidents WHERE tenant_id=$1 AND status='open' AND created_at < NOW() - INTERVAL '7 days'`,
      [tid]
    ).catch(() => ({ rows: [{ cnt: 0 }] })),
  ]);

  const license = licenseR.rows?.[0] || null;
  const daysRemaining = license ? daysUntil(license.expires_at) : null;
  const card = detail?.tenant || {};
  const light = card.light || 'gray';
  const p0 = Number(card.p0_count || 0);
  const p1 = Number(card.p1_count || 0);
  const attributionCnt = Number(attrR.rows?.[0]?.cnt || 0);
  const staleOpenIncidents = Number(openTaskR.rows?.[0]?.cnt || 0);

  const deductions = [];
  let score = 100;
  const lightDeduction = { green: 0, yellow: 15, red: 35, gray: 10 }[light] ?? 10;
  if (lightDeduction) { score -= lightDeduction; deductions.push({ reason: `健康灯：${card.light_label || light}`, points: -lightDeduction }); }
  if (p0 > 0) { const d = Math.min(20, p0 * 10); score -= d; deductions.push({ reason: `P0异常 ${p0} 项`, points: -d }); }
  if (p1 > 0) { const d = Math.min(15, p1 * 5); score -= d; deductions.push({ reason: `P1异常 ${p1} 项`, points: -d }); }
  if (daysRemaining != null && daysRemaining < 0) { score -= 40; deductions.push({ reason: '授权已过期', points: -40 }); }
  else if (daysRemaining != null && daysRemaining <= 14) { score -= 20; deductions.push({ reason: `授权${daysRemaining}天内到期`, points: -20 }); }
  if (attributionCnt === 0) { score -= 10; deductions.push({ reason: '近30天无可归因结果产出', points: -10 }); }
  if (staleOpenIncidents > 0) { score -= 10; deductions.push({ reason: `${staleOpenIncidents}项异常超7天未解决`, points: -10 }); }
  score = Math.max(0, Math.min(100, score));

  return {
    ok: true,
    tenant_id: tid,
    renewal_health_score: score,
    days_remaining: daysRemaining,
    license_status: license?.status || null,
    light,
    p0_count: p0,
    p1_count: p1,
    attribution_count_30d: attributionCnt,
    stale_open_incidents: staleOpenIncidents,
    deductions,
  };
}

/** 全量已开通租户的续费风险清单，按分数升序(风险最高排前面) */
export async function listRenewalRisks(pool, { limit = 50 } = {}) {
  const tenants = await pool.query(`SELECT tenant_id, name FROM tenants WHERE status <> 'disabled' ORDER BY created_at ASC LIMIT $1`, [limit]);
  const results = [];
  for (const t of tenants.rows || []) {
    const health = await computeRenewalHealth(pool, t.tenant_id).catch(() => null);
    if (!health?.ok) continue;
    const atRisk = health.renewal_health_score < 60 || (health.days_remaining != null && health.days_remaining <= 14);
    if (atRisk) results.push({ tenant_id: t.tenant_id, tenant_name: t.name, ...health });
  }
  return results.sort((a, b) => a.renewal_health_score - b.renewal_health_score);
}

/** 转介绍候选：健康分高、无逾期异常、授权不是快过期状态的稳定客户 */
export async function listReferralCandidates(pool, { limit = 50 } = {}) {
  const tenants = await pool.query(
    `SELECT tenant_id, name, created_at FROM tenants WHERE status='active' ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const t of tenants.rows || []) {
    const tenureDays = t.created_at ? Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) : 0;
    if (tenureDays < 60) continue; // 上线不满60天，还谈不上"稳定客户"
    const health = await computeRenewalHealth(pool, t.tenant_id).catch(() => null);
    if (!health?.ok) continue;
    if (health.renewal_health_score >= 80 && health.p0_count === 0 && health.stale_open_incidents === 0) {
      results.push({ tenant_id: t.tenant_id, tenant_name: t.name, tenure_days: tenureDays, renewal_health_score: health.renewal_health_score });
    }
  }
  return results.sort((a, b) => b.renewal_health_score - a.renewal_health_score);
}

function todayPeriod() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/**
 * 把续费风险/转介绍机会转成客户成功任务，复用 sales_tasks 表(通过 tenant_id 反查
 * 该客户当初的 lead_id)，不新建一张表——同一个客户的售前/售后任务在同一处能看到。
 * dedup_key 按天粒度(renewal-risk:{tenant_id}:renewal_health:{today})，同一天内cron
 * 无论跑几次(每6小时一次)都只产生一条任务，不刷屏。
 */
export async function syncCustomerSuccessTasks(pool) {
  const created = [];
  const period = todayPeriod();

  const risks = await listRenewalRisks(pool);
  for (const r of risks) {
    const lead = await pool.query(`SELECT id, owner_username FROM sales_leads WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [r.tenant_id]);
    const leadRow = lead.rows?.[0];
    if (!leadRow) continue;
    const detail = r.deductions.map((d) => `${d.reason}（${d.points}分）`).join('；') || '续费健康分偏低';
    const task = await upsertTask(pool, {
      leadId: leadRow.id,
      title: '续费风险跟进',
      detail: `${r.tenant_name || r.tenant_id}：续费健康分 ${r.renewal_health_score}。${detail}`,
      dueAt: new Date(),
      assignee: leadRow.owner_username || null,
      dedupKey: `renewal-risk:${r.tenant_id}:renewal_health:${period}`,
      taskDomain: 'renewal', taskType: 'renewal_risk_followup',
      tenantId: r.tenant_id, sourceType: 'tenant_renewal_health', sourceId: r.tenant_id, createdBy: 'cron:renewal',
    });
    if (task) created.push({ kind: 'renewal_risk', tenant_id: r.tenant_id, task_id: task.id });
  }

  const referrals = await listReferralCandidates(pool);
  for (const c of referrals) {
    const lead = await pool.query(`SELECT id, owner_username FROM sales_leads WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [c.tenant_id]);
    const leadRow = lead.rows?.[0];
    if (!leadRow) continue;
    const task = await upsertTask(pool, {
      leadId: leadRow.id,
      title: '转介绍机会跟进',
      detail: `${c.tenant_name || c.tenant_id}：已稳定使用${c.tenure_days}天，健康分${c.renewal_health_score}，可尝试邀请转介绍。`,
      dueAt: new Date(),
      assignee: leadRow.owner_username || null,
      dedupKey: `referral:${c.tenant_id}:${period}`,
      taskDomain: 'referral', taskType: 'referral_followup',
      tenantId: c.tenant_id, sourceType: 'tenant_renewal_health', sourceId: c.tenant_id, createdBy: 'cron:referral',
    });
    if (task) created.push({ kind: 'referral_opportunity', tenant_id: c.tenant_id, task_id: task.id });
  }

  return created;
}

// 每天只主动推送一次续费提醒消息(CS任务本身按天dedup不会重复，但sendOpsAlert没有去重能力，
// 不加这个内存guard的话每次cron tick——目前每天固定跑一次——都会重发同一条消息)。
let _lastRenewalBillReminderSentDate = null;

/**
 * 续费前15天提醒：发给销售+客服的内部提醒(不直接发给客户)，客户侧账单需要销售/客服
 * 从平台配置的"下载账单PDF"功能里拿到文件后手动发给客人——自动发送客户以后再做。
 */
export async function runRenewalBillReminders15d(pool, sendOpsAlert) {
  const period = todayPeriod();
  const r = await pool.query(
    `SELECT l.tenant_id, l.store_id, l.store_name, l.expires_at, t.name AS tenant_name
       FROM tenant_store_licenses l
       JOIN tenants t ON t.tenant_id = l.tenant_id
      WHERE l.status = 'active'
        AND l.expires_at BETWEEN NOW() AND NOW() + INTERVAL '15 days'
      ORDER BY l.expires_at ASC`
  );
  const rows = r.rows || [];
  const created = [];
  for (const row of rows) {
    const lead = await pool.query(`SELECT id, owner_username FROM sales_leads WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [row.tenant_id]);
    const leadRow = lead.rows?.[0];
    if (!leadRow) continue;
    const daysLeft = Math.max(0, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 86400000));
    const task = await upsertTask(pool, {
      leadId: leadRow.id,
      title: '续费账单提醒',
      detail: `${row.tenant_name || row.tenant_id}·${row.store_name}：授权将于${daysLeft}天后到期(${new Date(row.expires_at).toISOString().slice(0, 10)})，请在平台配置页下载账单PDF发送给客户并跟进续费。`,
      dueAt: new Date(),
      assignee: leadRow.owner_username || null,
      dedupKey: `renewal-bill-15d:${row.tenant_id}:${row.store_id}:${period}`,
      taskDomain: 'renewal', taskType: 'renewal_bill_reminder',
      tenantId: row.tenant_id, sourceType: 'tenant_store_license', sourceId: row.store_id, createdBy: 'cron:renewal-bill',
    });
    if (task) created.push({ tenant_id: row.tenant_id, store_name: row.store_name, days_left: daysLeft, task_id: task.id });
  }

  if (rows.length && typeof sendOpsAlert === 'function' && _lastRenewalBillReminderSentDate !== period) {
    _lastRenewalBillReminderSentDate = period;
    await sendOpsAlert(
      ['【续费账单提醒·15天内到期】', ...rows.map((row) => {
        const daysLeft = Math.max(0, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 86400000));
        return `· ${row.tenant_name || row.tenant_id}·${row.store_name}：剩${daysLeft}天到期，请下载账单PDF跟进续费`;
      })].join('\n'),
      { title: '续费账单提醒', audience: 'sales' }
    );
  }

  return created;
}
