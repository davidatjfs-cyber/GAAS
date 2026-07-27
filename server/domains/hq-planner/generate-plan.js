/**
 * HQ Planner — Strategy Planner (策略生成)
 * 从 hq-planner-agent.js 拆出。ctx = { pool, callLLMTiered, log }（避免反向 import）。
 */
import {
  traceCausalChain,
  getStoreHealthOverview,
  formatGraphContextForLLM
} from '../../knowledge-graph.js';
import { isHqRole } from '../../hq-brain-config.js';
import { checkPlanGrounding } from '../../ontology/plan-grounding-check.js';
import { queryObject } from '../../ontology/query.js';
import { buildPlannerPrompt } from './prompts.js';
import { repairPlanJson } from './plan-json-repair.js';
import { normalizePlanData, inferBrand } from './plan-data.js';
import { runComplianceCheck } from './compliance-check.js';

async function collectPlanContext(ctx, { store, tenantId, windowDays }) {
  const [storeHealth, causalChain] = await Promise.all([
    getStoreHealthOverview(store, windowDays),
    traceCausalChain('store', store, 2, windowDays)
  ]);

  const graphContext = formatGraphContextForLLM(causalChain, 40);

  // 第一个走本体统一查询API(queryObject)的生产读路径，而不是直连SQL；
  // 租户隔离交给master_tasks上的FORCE RLS(见migration 082)。
  const recentTasks = await queryObject(ctx.pool(), 'task', {
    filters: { store },
    sinceDays: windowDays,
    limit: 20
  });
  const tasksSummary = recentTasks.map(t =>
    `[${t.task_id}] ${t.category}(${t.severity}) - ${t.title} - 状态:${t.status} 扣分:${t.score_impact || 0}`
  ).join('\n');

  const recentScores = await ctx.pool().query(
    `SELECT username, role, total_score, period, summary
     FROM agent_scores WHERE store = $1 AND created_at > NOW() - ($2::int * INTERVAL '1 day') AND tenant_id = $3
     ORDER BY created_at DESC LIMIT 10`,
    [store, Math.max(windowDays, 60), tenantId]
  );
  const scoresSummary = (recentScores.rows || []).map(s =>
    `${s.username}(${s.role}) ${s.period}: ${s.total_score}分 - ${String(s.summary || '').slice(0, 80)}`
  ).join('\n');

  return { storeHealth, causalChain, graphContext, tasksSummary, scoresSummary };
}

function buildComplianceRejection(groundingResult) {
  return {
    passed: false,
    checks: {
      dataAccuracy: {
        passed: false,
        issues: groundingResult.unverifiedClaims.map(
          c => `${c.field} 中的"${c.raw}"未能在真实数据中找到依据，疑似编造`
        )
      }
    },
    overallComment: '程序化数字校验未通过（未提交LLM合规审查）：' +
      groundingResult.unverifiedClaims.map(c => c.raw).join('、')
  };
}

async function persistPlan(ctx, { planId, planData, goal, store, status, complianceResult, storeHealth, causalChain, createdBy, tenantId }) {
  await ctx.pool().query(
    `INSERT INTO action_plans (plan_id, title, goal, store, brand, status, plan_data, compliance_result, graph_context, created_by, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
    [
      planId,
      planData.title || `${store} 改善计划`,
      goal || '综合提升',
      store,
      inferBrand(store),
      status,
      JSON.stringify(planData),
      JSON.stringify(complianceResult),
      JSON.stringify({ healthScore: storeHealth.healthScore, causalChainLength: causalChain.length }),
      createdBy || 'system',
      tenantId
    ]
  );

  // decision_log是Palantir式Action审计表，建好后一直没有代码写入过——这里补上，
  // 让每次自动生成的行动计划都留下可追溯记录（含是否通过程序化/LLM合规审查）。
  await ctx.pool().query(
    `INSERT INTO decision_log (store, brand, decision_type, title, content, agent, source_task_id, created_by, status, tenant_id)
     VALUES ($1, $2, 'action_plan', $3, $4, 'hq-planner-agent', $5, $6, $7, $8)`,
    [
      store,
      inferBrand(store),
      planData.title || `${store} 改善计划`,
      planData.summary || '',
      planId,
      createdBy || 'system',
      status === 'pending_review' ? 'active' : 'rejected',
      tenantId
    ]
  ).catch(e => ctx.log.error({ msg: 'decision_log_write_failed', err: e?.message }));
}

export async function generateActionPlan(ctx, { store, goal, role, createdBy, daysBack = 30, tenantId = 'default' }) {
  if (!isHqRole(role)) {
    return { ok: false, error: 'forbidden', message: '仅总部角色可生成行动计划' };
  }

  const planId = `AP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const windowDays = Math.max(7, Math.min(90, Number(daysBack) || 30));

  try {
    const { storeHealth, causalChain, graphContext, tasksSummary, scoresSummary } =
      await collectPlanContext(ctx, { store, tenantId, windowDays });

    const plannerPrompt = buildPlannerPrompt({ store, goal, windowDays, storeHealth, tasksSummary, scoresSummary });

    const planResult = await ctx.callLLMTiered([
      { role: 'system', content: plannerPrompt },
      { role: 'user', content: `请为 ${store} 生成改善行动计划。目标: ${goal || '综合提升'}` }
    ], role, { purpose: 'reasoning', maxTokens: 4096 });

    if (!planResult.ok) {
      return { ok: false, error: 'llm_failed', message: planResult.error };
    }

    // 解析/修复并归一化 LLM 输出，确保产出结构稳定可用
    const repaired = await repairPlanJson(ctx, planResult.content, role);
    const planData = normalizePlanData(repaired || {}, {
      store,
      goal,
      storeHealth,
      rawContent: planResult.content
    });

    // 程序化数字校验（非LLM）——历史上4/8个计划都是因为LLM在rootCauses/summary
    // 里编造了真实数据中不存在的"N分"/"N次"，靠合规LLM去抓不够可靠，这里先用确定性比对拦一道。
    const groundingResult = checkPlanGrounding(planData, storeHealth);

    // 合规审查——程序化校验没过直接判定不合规，不再消耗一次LLM调用
    const complianceResult = groundingResult.passed
      ? await runComplianceCheck(ctx, planData, { store, storeHealth, graphContext, tasksSummary, scoresSummary, role })
      : buildComplianceRejection(groundingResult);

    const status = complianceResult.passed ? 'pending_review' : 'compliance_rejected';
    await persistPlan(ctx, { planId, planData, goal, store, status, complianceResult, storeHealth, causalChain, createdBy, tenantId });

    ctx.log.info({ msg: 'plan_created', plan_id: planId, store, status });
    return {
      ok: true,
      planId,
      status,
      plan: planData,
      compliance: complianceResult,
      healthScore: storeHealth.healthScore
    };
  } catch (e) {
    ctx.log.error({ msg: 'generate_action_plan_failed', err: e?.message });
    return { ok: false, error: 'internal', message: e?.message };
  }
}
