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
  try {
    // 2026-07-31 二次重写：用户反馈内容"根本不能用"——查证生产库发现真正的根因：同一家店在
    // growth_actions.store_id里同时存在两种格式（数字增长引擎ID如'51866138'=马己仙，累计
    // 1767条历史堆积；以及POS长名如'马己仙广东小馆·荔枝木烧鹅（大宁音乐广场店）'，93条），
    // 而之前的去重逻辑是按"归一化前的原始store_id字符串"分组的，同一家店的两种格式互相不
    // 认识对方、各自去重，数字ID那个桶的海量历史堆积会在"按created_at最新N条"里把真正该
    // 展示的内容挤没。改成：①先归一化成门店官方简称再分组去重；②按门店轮流(round-robin)
    // 抽取，确保每个门店数量相对平均，不会被某个门店的历史堆积独占。
    const r = await pool.query(
      `SELECT action_key, action_type, store_id, title, detail, created_at, payload
         FROM growth_actions
        WHERE tenant_id = $1 AND status = 'proposed'${whereStore}
        ORDER BY created_at DESC LIMIT 500`,
      params
    );
    const byStore = new Map(); // canonicalStore -> [{row, audienceKey}]，同店同客群只保留最新
    const seenAudience = new Map(); // canonicalStore -> Set(audienceKey)
    for (const row of r.rows || []) {
      const canonicalStore = resolveAgentCanonicalStore(row.store_id) || String(row.store_id || '').trim();
      if (!canonicalStore) continue;
      const targetAudience = String(row.payload?.target_audience || '').trim();
      const audienceKey = targetAudience || row.action_key;
      if (!seenAudience.has(canonicalStore)) seenAudience.set(canonicalStore, new Set());
      const seen = seenAudience.get(canonicalStore);
      if (seen.has(audienceKey)) continue; // 已有更新的同客群建议，跳过（结果按created_at desc排列，先到先得=最新）
      seen.add(audienceKey);
      if (!byStore.has(canonicalStore)) byStore.set(canonicalStore, []);
      byStore.get(canonicalStore).push({ ...row, store: canonicalStore });
    }
    // 按门店轮流抽取，而不是全局按最新时间截断——避免历史堆积多的门店独占展示名额
    const storeQueues = [...byStore.values()];
    const deduped = [];
    let round = 0;
    while (deduped.length < lim && storeQueues.some((q) => q.length > round)) {
      for (const queue of storeQueues) {
        if (deduped.length >= lim) break;
        if (queue.length > round) deduped.push(queue[round]);
      }
      round++;
    }
    return deduped.map((row) => ({
      actionKey: row.action_key,
      store: row.store,
      title: row.title,
      detail: row.detail,
      createdAt: row.created_at,
      // 2026-07-30：用户问"用户如何知道这个营销方案投放在哪里"——之前classifyChannel只返回
      // online/offline粗分类，真实渠道(小红书/抖音/企微/朋友圈/大众点评等)其实一直在
      // payload.channel里，只是没有透出给前端。这里补上原始渠道字段。
      // 2026-07-30 二次修正：用户明确要求"营销全部手动触发"，不再区分系统自动/人工执行——
      // 所有渠道点执行后都是分配给责任人手动落实，去掉之前误加的autoExecuted区分。
      channelName: row.payload?.channel || '',
      ...classifyChannel(row.action_type),
    }));
  } catch (e) {
    log.error({ msg: 'marketing_suggestions_failed', err: e?.message || String(e) });
    return [];
  }
}
