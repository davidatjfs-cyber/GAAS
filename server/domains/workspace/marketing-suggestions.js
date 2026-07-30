/**
 * 门店营销活动建议（首页第2项）：数据来自 growth_actions（PLLM/AI 生成的待执行营销动作）。
 * 用户要求"每天5条，线下2条+线上不同平台各1条"——现有 growth_actions 没有一个干净的
 * "线上/线下+平台"分类字段，action_type 是自由文本（如 sms_recall/wecom_push/poster 等）。
 * 这里按 action_type 关键词做最佳猜测分类，不是精确匹配用户要求的结构——这是已知近似，
 * 不是精确实现，需要业务方看了实际数据后再调整分类规则。
 */
import { childLogger } from '../../utils/logger.js';
import { resolveAgentCanonicalStore, expandAgentStoreLabels } from '../../v2-store-alignment.js';

const log = childLogger({ domain: 'workspace', handler: 'marketing-suggestions' });

const ONLINE_KEYWORDS = ['sms', 'wecom', 'wechat', 'push', 'campaign', 'coupon', 'member', 'recall'];

function classifyChannel(actionType) {
  const t = String(actionType || '').toLowerCase();
  if (ONLINE_KEYWORDS.some((k) => t.includes(k))) return { channel: 'online', platformGuess: actionType };
  return { channel: 'offline', platformGuess: '' };
}

/**
 * 2026-07-30 修复：门店营销活动建议点"执行"分配责任人时，前端按store_id去匹配员工表的
 * store字段，结果几乎每次都提示"本店未配置店长/前厅主管"——查证生产库发现growth_actions.
 * store_id完全没有统一格式（同时混着POS原始长名"洪潮传统潮汕菜【大宁久光中心店】"、
 * 增长侧数字ID"64822111"、以及员工表用的官方简称"洪潮大宁久光店"），前端拿到的store字段
 * 跟employees.store根本不是同一个字符串，同一批"门店名不统一"问题这次是在增长引擎这条链路
 * 上又出现了一次。改成用resolveAgentCanonicalStore()归一化成官方简称再返回给前端，
 * storeFilter（hq_manager按allowed_stores限定范围时）同理展开成所有已知别名再做ANY匹配。
 */
export async function getMarketingSuggestions(pool, tenantId, storeFilter = [], limit = 5) {
  const lim = Math.min(20, Math.max(1, Number(limit) || 5));
  const params = [tenantId];
  let whereStore = '';
  if (Array.isArray(storeFilter) && storeFilter.length) {
    const aliasList = [...new Set(storeFilter.flatMap((s) => expandAgentStoreLabels(s)))];
    params.push(aliasList);
    whereStore = ` AND store_id = ANY($${params.length})`;
  }
  params.push(lim);
  try {
    const r = await pool.query(
      `SELECT action_key, action_type, store_id, title, detail, created_at
         FROM growth_actions
        WHERE tenant_id = $1 AND status = 'proposed'${whereStore}
        ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return (r.rows || []).map((row) => ({
      actionKey: row.action_key,
      store: resolveAgentCanonicalStore(row.store_id) || row.store_id,
      title: row.title,
      detail: row.detail,
      createdAt: row.created_at,
      ...classifyChannel(row.action_type),
    }));
  } catch (e) {
    log.error({ msg: 'marketing_suggestions_failed', err: e?.message || String(e) });
    return [];
  }
}
