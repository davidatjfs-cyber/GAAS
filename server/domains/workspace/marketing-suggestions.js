/**
 * 门店营销活动建议（首页第2项）。
 *
 * 2026-07-31：用户对比后明确要求"这个工作要的是质量，不是数量"——之前查 growth_actions
 * (campaign_autopilot生成)的通用模板文案质量差、且被历史堆积挤没真正有价值的内容；
 * strategy_experiments/strategy_variants（agents-service-v2的PLLM异常检测流程写入）
 * 才是真正结合门店真实异常信号（差评/流失/储值等）生成的可直接执行A/B方案，带逐日执行
 * 指引。已停用 growth_actions 通用模板来源，只保留这一份高质量输出。
 */
import { childLogger } from '../../utils/logger.js';
import { expandAgentStoreLabels } from '../../v2-store-alignment.js';

const log = childLogger({ domain: 'workspace', handler: 'marketing-suggestions' });

/**
 * 采纳/不适合仅admin/hq_manager可操作（复用现成的/api/strategy-experiments/:code/
 * approve|reject，跟增长看板用同一套接口，不新建），店长/出品经理视角只读展示、了解
 * 总部在为自己门店评估什么方案。按用户要求"不用这么高的频率"，每店只取最近1条。
 */
export async function getMarketingSuggestions(pool, tenantId, storeFilter = [], limit = 5) {
  const perStoreLimit = Math.min(5, Math.max(1, Number(limit) || 1));
  try {
    const params = [tenantId];
    let whereStore = '';
    if (Array.isArray(storeFilter) && storeFilter.length) {
      const aliasList = [...new Set(storeFilter.flatMap((s) => expandAgentStoreLabels(s)))];
      params.push(aliasList);
      whereStore = ` AND v.store = ANY($${params.length})`;
    }
    const r = await pool.query(
      `SELECT e.experiment_code, e.title, e.goal, e.anomaly_type, e.created_at,
              json_agg(json_build_object(
                'variantCode', v.variant_code, 'label', v.label,
                'action', v.action, 'executionGuide', v.execution_guide, 'store', v.store
              ) ORDER BY v.variant_code) AS variants
         FROM strategy_experiments e
         JOIN strategy_variants v ON v.experiment_id = e.id
        WHERE e.tenant_id = $1 AND e.status = 'pending_approval'${whereStore}
        GROUP BY e.id
        ORDER BY e.created_at DESC LIMIT 200`,
      params
    );
    // 每个实验通常同时给多家店各配一份variant——按"实验里实际涉及的门店集合"轮流抽取，
    // 保证每店最近展示数不超过perStoreLimit，不被历史堆积挤占。
    const byStore = new Map();
    for (const row of r.rows || []) {
      const stores = [...new Set((row.variants || []).map((v) => v.store).filter(Boolean))];
      for (const store of stores) {
        if (!byStore.has(store)) byStore.set(store, []);
        byStore.get(store).push(row);
      }
    }
    const seenExperiment = new Set();
    const picked = [];
    for (const [, queue] of byStore) {
      let taken = 0;
      for (const row of queue) {
        if (taken >= perStoreLimit) break;
        if (seenExperiment.has(row.experiment_code)) continue;
        seenExperiment.add(row.experiment_code);
        picked.push(row);
        taken++;
      }
    }
    return picked.map((row) => ({
      kind: 'pllm_experiment',
      actionKey: row.experiment_code,
      store: [...new Set((row.variants || []).map((v) => v.store).filter(Boolean))].join('/'),
      title: row.title,
      goal: row.goal,
      anomalyType: row.anomaly_type,
      createdAt: row.created_at,
      variants: row.variants || [],
    }));
  } catch (e) {
    log.error({ msg: 'marketing_suggestions_failed', err: e?.message || String(e) });
    return [];
  }
}
