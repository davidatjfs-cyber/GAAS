/**
 * Chief Evaluator monthly scoring (Wave A9 peel from agents.js runChiefEvaluator).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-evaluator', handler: 'run-chief-evaluator' });

/**
 * @param {object} deps
 * @returns {(period: string, tenantId?: string) => Promise<object>}
 */
export function createRunChiefEvaluator(deps) {
  const {
    pool,
    getSharedState,
    getStoresFromState,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
    getBrandRuntimeConfig,
    calculateStoreRating,
    calculateEmployeeScore,
    callLLM,
  } = deps;

  return async function runChiefEvaluator(period, tenantId = 'default') {
    const p = String(period || '').trim();
    if (!p) return { error: 'missing_period' };
    // 旧 HRMS 周评（2026-W03 这类）已被 anomaly_rollups_v2 取代。
    // 继续写 new_model 周评会制造一批错误的 100 分历史行，并被旧补发链路误发到飞书。
    // 仅允许月度 period（YYYY-MM）；周度 period 直接跳过。
    if (/^\d{4}-W\d{2}$/i.test(p)) {
      return { period: p, evaluated: 0, results: [], model: 'legacy_weekly_disabled', skipped: true };
    }

    const state = await getSharedState();
    const stores = getStoresFromState(state);
    const results = [];

    for (const storeInfo of stores) {
      const storeName = storeInfo.name;
      const brandCtx = resolveBrandContextByStore(state, storeName);
      const brand =
        brandCtx.brandName || storeInfo.brand || inferBrandFromStoreName(storeName) || '洪潮';
      const config = getBrandRuntimeConfig(state, brandCtx);

      const all = [
        ...(Array.isArray(state?.employees) ? state.employees : []),
        ...(Array.isArray(state?.users) ? state.users : []),
      ];
      const managers = all.filter(
        (u) =>
          String(u?.store || '').trim() === storeName &&
          ['store_manager', 'store_production_manager'].includes(String(u?.role || '').trim())
      );

      const storeRating = await calculateStoreRating(storeName, brand, p);

      for (const mgr of managers) {
        const username = String(mgr.username || '').trim();
        const mgrName = String(mgr.name || '').trim();
        const role = String(mgr.role || '').trim();
        if (!username) continue;

        const employeeScore = await calculateEmployeeScore(storeName, username, role, p);

        if (!employeeScore) {
          log.info({ msg: 'employee_score_failed', username });
          continue;
        }

        const totalScore = employeeScore.total_score;
        const breakdown = {
          execution_rating: employeeScore.execution_rating,
          attitude_rating: employeeScore.attitude_rating,
          ability_rating: employeeScore.ability_rating,
          store_rating: storeRating.rating || null,
        };
        const deductions = [];

        let summary = '';
        try {
          const llm = await callLLM([
            { role: 'system', content: '你是专业的餐饮绩效考核官，语言简洁务实。' },
            {
              role: 'user',
              content: `品牌${brand}（${config.label}），门店${storeName}，${mgr.name || username}（${role === 'store_manager' ? '店长' : '出品经理'}）。总分${totalScore}，门店评级${storeRating.rating || 'N/A'}，执行力${employeeScore.execution_rating}，态度${employeeScore.attitude_rating}，能力${employeeScore.ability_rating}。请给出2-3句评语。`,
            },
          ]);
          summary = llm.content || '';
        } catch {
          /* ignore */
        }

        try {
          await pool().query(
            `INSERT INTO agent_scores (brand, store, username, name, role, period, score_model, total_score, breakdown, deductions, summary, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
           ON CONFLICT (brand, store, username, period, tenant_id)
           DO UPDATE SET name=EXCLUDED.name, total_score=EXCLUDED.total_score, breakdown=EXCLUDED.breakdown, deductions=EXCLUDED.deductions, summary=EXCLUDED.summary, feishu_notified=FALSE, updated_at=NOW()`,
            [
              brand,
              storeName,
              username,
              mgrName,
              role,
              p,
              'new_model',
              totalScore,
              JSON.stringify(breakdown),
              JSON.stringify(deductions),
              summary,
              tenantId,
            ]
          );
        } catch (e) {
          log.error({ msg: 'upsert_score_failed', err: String(e?.message || e) });
        }

        results.push({
          brand,
          store: storeName,
          username,
          name: mgrName,
          role,
          totalScore,
          breakdown,
          deductions: deductions.length,
          summary,
          store_rating: storeRating,
        });
      }
    }

    return { period: p, evaluated: results.length, results, model: 'new_scoring_model' };
  };
}
