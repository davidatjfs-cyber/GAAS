/**
 * 门店营销活动建议（首页第2项）：数据来自 growth_actions（PLLM/AI 生成的待执行营销动作）。
 * 用户要求"每天5条，线下2条+线上不同平台各1条"——现有 growth_actions 没有一个干净的
 * "线上/线下+平台"分类字段，action_type 是自由文本（如 sms_recall/wecom_push/poster 等）。
 * 这里按 action_type 关键词做最佳猜测分类，不是精确匹配用户要求的结构——这是已知近似，
 * 不是精确实现，需要业务方看了实际数据后再调整分类规则。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'workspace', handler: 'marketing-suggestions' });

const ONLINE_KEYWORDS = ['sms', 'wecom', 'wechat', 'push', 'campaign', 'coupon', 'member', 'recall'];

function classifyChannel(actionType) {
  const t = String(actionType || '').toLowerCase();
  if (ONLINE_KEYWORDS.some((k) => t.includes(k))) return { channel: 'online', platformGuess: actionType };
  return { channel: 'offline', platformGuess: '' };
}

export async function getMarketingSuggestions(pool, tenantId, storeFilter = [], limit = 5) {
  const lim = Math.min(20, Math.max(1, Number(limit) || 5));
  const params = [tenantId];
  let whereStore = '';
  if (Array.isArray(storeFilter) && storeFilter.length) {
    params.push(storeFilter);
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
      store: row.store_id,
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
