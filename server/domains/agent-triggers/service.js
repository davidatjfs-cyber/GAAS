/**
 * Agent 手动触发 / 诊断测试：run/*、test-*、route-test、llm-health。
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-triggers', handler: 'service' });

export const TRIGGER_HQ_ROLES = Object.freeze(['admin', 'hq_manager']);

export function isTriggerAdminRole(role) {
  return String(role || '').trim() === 'admin';
}

export function isTriggerHqRole(role) {
  return TRIGGER_HQ_ROLES.includes(String(role || '').trim());
}

/** @returns {'daily'|'weekly'|'full'} */
export function normalizeAuditMode(mode) {
  const m = String(mode || 'full').trim().toLowerCase();
  if (m === 'daily' || m === 'weekly') return m;
  return 'full';
}

export function resolveStoreRatingsPeriod(period, now = new Date()) {
  const p = String(period || '').trim();
  if (p && /^\d{4}-\d{2}$/.test(p)) return p;
  const sh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  return `${sh.getFullYear()}-${String(sh.getMonth() + 1).padStart(2, '0')}`;
}

export function maskTokenPreview(token) {
  const t = String(token || '');
  if (!t) return null;
  if (t.length <= 12) return `${t.slice(0, 2)}…`;
  return `${t.slice(0, 8)}...${t.slice(-4)}`;
}

export const ROUTE_TEST_KEYWORD_GROUPS = Object.freeze({
  audit: ['损耗', '盘点', '毛利', '牛肉', '成本', '差评', '折扣', '营收', '对账', '异常'],
  ops: ['图片', '卫生', '检查', '拍照', '摆盘', '收货', '消毒', '开市', '闭市', '巡检'],
  eval: ['分数', '绩效', '考核', '奖金', '得分', '扣分', '排名', '评价', '这周'],
  hr: ['离职', '辞职', '入职', '转正', '晋升', '调岗', '加薪', '薪资', '工资', '请假', '休假', '社保', '人事', '档案', '考勤'],
  appeal: ['申诉', '取消扣分', '不公平', '误判', '恢复', '投诉', '举报'],
  train: ['SOP', '赔付', '退款', '培训', '入职培训', '课件', '带教', '讲师', '考核培训', '技能培训', '标准作业'],
});

export function matchRouteKeywords(text) {
  const t = String(text || '');
  const matched = [];
  for (const [group, words] of Object.entries(ROUTE_TEST_KEYWORD_GROUPS)) {
    for (const k of words) {
      if (t.includes(k)) matched.push(`${group}:${k}`);
    }
  }
  return matched;
}

/**
 * @param {{
 *   mode?: string,
 *   tenantId?: string,
 *   runDataAuditor: (mode: string, tenantId: string) => Promise<{issuesCreated?: number, newIssueIds?: string[]}>,
 *   pushIssuesToFeishu: () => Promise<unknown>,
 *   syncDataAuditorIssuesToMasterTasks?: (ids: string[]) => Promise<number>,
 * }} deps
 */
export async function runManualAudit(deps) {
  const mode = normalizeAuditMode(deps.mode);
  const tenantIdQ = deps.tenantId || 'default';
  let issuesCreated = 0;
  let newIssueIds = [];
  if (mode === 'daily' || mode === 'weekly') {
    const r = await deps.runDataAuditor(mode, tenantIdQ);
    issuesCreated = r.issuesCreated;
    newIssueIds = r.newIssueIds || [];
  } else {
    const d = await deps.runDataAuditor('daily', tenantIdQ);
    const w = await deps.runDataAuditor('weekly', tenantIdQ);
    issuesCreated = (d.issuesCreated || 0) + (w.issuesCreated || 0);
    newIssueIds = [...(d.newIssueIds || []), ...(w.newIssueIds || [])];
  }
  const pushed = await deps.pushIssuesToFeishu();
  let masterSynced = 0;
  if (typeof deps.syncDataAuditorIssuesToMasterTasks === 'function') {
    try {
      masterSynced = await deps.syncDataAuditorIssuesToMasterTasks(newIssueIds);
    } catch (e) {
      log.error({ msg: 'agent_triggers_run_audit_master_sync', err: e?.message || e });
    }
  }
  return { issuesCreated, newIssueIds, feishuPushed: pushed, masterSynced };
}

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   period?: string,
 *   now?: Date,
 *   inferBrandFromStoreName: (store: string) => string|null,
 *   calculateStoreRating: (store: string, brand: string, period: string) => Promise<object>,
 * }} deps
 */
export async function runStoreRatingsRecalc(pool, deps) {
  const period = resolveStoreRatingsPeriod(deps.period, deps.now);
  const ur = await pool.query(
    `SELECT DISTINCT TRIM(store) AS store FROM feishu_users
         WHERE registered = true AND TRIM(COALESCE(store,'')) <> ''
           AND role IN ('store_manager','store_production_manager')`
  );
  const seen = new Set();
  const results = [];
  for (const row of ur.rows || []) {
    const st = String(row.store || '').trim();
    const k = st.toLowerCase().replace(/\s+/g, '');
    if (!st || seen.has(k)) continue;
    seen.add(k);
    const brand = deps.inferBrandFromStoreName(st);
    const r = await deps.calculateStoreRating(st, brand, period);
    results.push({
      store: st,
      brand,
      period,
      rating: r.rating ?? null,
      reason: r.reason,
      achievementRate: r.achievementRate,
      actualRevenue: r.actualRevenue,
      targetRevenue: r.targetRevenue,
    });
  }
  return { ok: true, period, count: results.length, results };
}
