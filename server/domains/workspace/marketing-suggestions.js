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

const REJECT_LABELS = {
  not_fit_store: '不贴合本店客群', cost_too_high: '成本过高', channel_unavailable: '渠道不可用',
  duplicate: '重复', conflict: '与现有活动冲突', targets_unrealistic: '目标不可达',
  cannot_execute: '无法执行', copy_quality: '文案质量差', other: '其他',
};

const ANOMALY_LABELS = {
  slot_decline: '时段营收下滑', category_decline: '品类营收下滑', overall_decline: '整体营收下滑',
  traffic_decline: '客流下滑', bad_review_product: '差评产品', bad_review_service: '差评服务',
  rising_category_opportunity: '上升品类机会', diner_mix_opportunity: '客群结构机会',
  marketing: '营销机会', churn_risk: '流失风险', unknown: '经营信号',
};

const SOURCE_LABELS = {
  marketing_job: '每日营销建议', master_dispatcher: '营销异常派工', pllm: 'PLLM策略',
  rule_engine: '自动营销规则', campaign_autopilot: '活动自动生成', agent_v2: 'AI运营建议',
  agent_collaboration: '智能体协作', admin: '手工/活动激活', marketing_planner: '营销策划',
};

export function anomalyLabel(code) {
  return ANOMALY_LABELS[String(code || '')] || String(code || 'unknown');
}

export function marketingSourceLabel(source) {
  return SOURCE_LABELS[String(source || '')] || String(source || 'unknown');
}

/** 门店近 30 天审核反馈摘要（采纳/拒绝/主要拒绝原因），供审核卡片展示 */
async function loadStoreFeedbackSummary(pool, tenantId, stores) {
  const summary = new Map();
  if (!Array.isArray(stores) || !stores.length) return summary;
  try {
    const r = await pool.query(
      `SELECT v.store,
              COUNT(*) FILTER (WHERE e.status IN ('approved','running','completed'))::int AS approved,
              COUNT(*) FILTER (WHERE e.status = 'rejected')::int AS rejected,
              jsonb_agg(e.reject_reason) FILTER (WHERE e.status = 'rejected' AND e.reject_reason IS NOT NULL) AS reasons
         FROM strategy_experiments e
         JOIN strategy_variants v ON v.experiment_id = e.id
        WHERE e.tenant_id = $1 AND v.store = ANY($2)
          AND e.created_at > NOW() - interval '30 days'
        GROUP BY v.store`,
      [tenantId, stores]
    );
    for (const row of r.rows || []) {
      const reasons = (row.reasons || []).filter(Boolean);
      const byCode = new Map();
      for (const rz of reasons) {
        const code = String(rz?.primary || 'other');
        byCode.set(code, (byCode.get(code) || 0) + 1);
      }
      summary.set(row.store, {
        total: Number(row.approved || 0) + Number(row.rejected || 0),
        approved: Number(row.approved || 0),
        rejected: Number(row.rejected || 0),
        topReasons: [...byCode.entries()].map(([code, count]) => ({ label: REJECT_LABELS[code] || '其他', count })).sort((a, b) => b.count - a.count).slice(0, 2),
      });
    }
  } catch (e) {
    log.warn({ msg: 'load_store_feedback_summary_failed', err: e?.message });
  }
  return summary;
}

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
      `SELECT e.experiment_code, e.title, e.goal, e.anomaly_type, e.created_at, e.created_by,
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
    const feedback = await loadStoreFeedbackSummary(pool, tenantId, [...byStore.keys()]);
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
    return picked.map((row) => {
      const rowStores = [...new Set((row.variants || []).map((v) => v.store).filter(Boolean))];
      const fbParts = rowStores.map((s) => feedback.get(s)).filter(Boolean);
      const fb = fbParts.length
        ? {
            total: fbParts.reduce((s, x) => s + (x.total || 0), 0),
            approved: fbParts.reduce((s, x) => s + (x.approved || 0), 0),
            rejected: fbParts.reduce((s, x) => s + (x.rejected || 0), 0),
            topReasons: fbParts.flatMap((x) => x.topReasons || []).slice(0, 2),
          }
        : null;
      return {
        kind: 'pllm_experiment',
        actionKey: row.experiment_code,
        store: rowStores.join('/'),
        title: row.title,
        goal: row.goal,
        anomalyType: row.anomaly_type,
        anomalyLabel: anomalyLabel(row.anomaly_type),
        createdBy: row.created_by || 'unknown',
        sourceLabel: marketingSourceLabel(row.created_by),
        createdAt: row.created_at,
        variants: row.variants || [],
        feedback: fb,
      };
    });
  } catch (e) {
    log.error({ msg: 'marketing_suggestions_failed', err: e?.message || String(e) });
    return [];
  }
}

/**
 * 统一营销审核队列（2026-08-07）：所有营销方案生产口的待审输出聚合到一个接口。
 * 策略实验侧：每日营销任务 marketing_job / 营销异常派工 master_dispatcher / PLLM 桥接；
 * 动作侧：规则引擎 rule_engine / campaign-autopilot / AI运营建议 agent_v2 / 智能体协作等
 * 写入的 growth_actions(proposed)。前端审核模块只认这一个端口。
 */
export async function getMarketingReviewQueue(pool, tenantId, storeFilter = []) {
  const strategyItems = await getMarketingSuggestions(pool, tenantId, storeFilter);
  const strategy = strategyItems.map((it) => ({
    kind: 'strategy_experiment',
    source: it.createdBy,
    sourceLabel: it.sourceLabel,
    actionKey: it.actionKey,
    store: it.store,
    title: it.title,
    detail: it.goal || '',
    anomalyType: it.anomalyType,
    anomalyLabel: it.anomalyLabel,
    channel: null,
    channelLabel: null,
    createdAt: it.createdAt,
    status: 'pending_approval',
    payload: { variants: it.variants, feedback: it.feedback },
  }));
  let actions = [];
  try {
    const params = [tenantId];
    let whereStore = '';
    if (Array.isArray(storeFilter) && storeFilter.length) {
      const aliasList = [...new Set(storeFilter.flatMap((s) => expandAgentStoreLabels(s)))];
      params.push(aliasList);
      whereStore = ` AND store_id = ANY($${params.length})`;
    }
    const r = await pool.query(
      `SELECT action_key, action_type, status, store_id, title, detail, payload, created_by, created_at
         FROM growth_actions
        WHERE tenant_id = $1 AND status = 'proposed'
          AND created_at >= NOW() - interval '30 days'${whereStore}
        ORDER BY created_at DESC LIMIT 200`,
      params
    );
    actions = (r.rows || []).map((row) => {
      const payload = (row.payload && typeof row.payload === 'object') ? row.payload : {};
      const channel = String(payload.channel || '').trim();
      return {
        kind: 'growth_action',
        source: row.created_by || 'unknown',
        sourceLabel: marketingSourceLabel(row.created_by),
        actionKey: row.action_key,
        store: row.store_id || '',
        title: row.title || '',
        detail: row.detail || '',
        anomalyType: null,
        anomalyLabel: null,
        channel,
        channelLabel: channel,
        createdAt: row.created_at,
        status: row.status || 'proposed',
        payload: payload,
      };
    });
    // 2026-08-07 核心修复：同一「来源+规则/策略+客户/门店」只保留最新一条待审，
    // 历史周期残留的同客户重复建议不再把审核队列/任务栏撑满。
    const latestByFingerprint = new Map();
    for (const a of actions) {
      const fp = a.source === 'rule_engine'
        ? `${a.source}|${a.payload.rule_key || ''}|${a.payload.customer_id || ''}`
        : `${a.source}|${a.payload.strategy_key || a.payload.action_type_structured || a.payload.campaign_key || a.actionKey || ''}|${a.payload.customer_id || a.store}`;
      const prev = latestByFingerprint.get(fp);
      if (!prev || new Date(a.createdAt || 0) > new Date(prev.createdAt || 0)) {
        latestByFingerprint.set(fp, a);
      }
    }
    actions = [...latestByFingerprint.values()];
  } catch (e) {
    log.warn({ msg: 'load_review_queue_actions_failed', err: e?.message });
  }
  const items = [...strategy, ...actions].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
  return items;
}
