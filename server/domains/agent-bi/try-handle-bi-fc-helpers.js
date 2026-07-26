/**
 * P5.4 peel: BI function-calling helpers (from createTryHandleBiByFunctionCalling).
 */
import { randomUUID } from 'crypto';
import { resolveTenantIdDefault } from '../../utils/database.js';
import {
  getRuntimePromptPatch,
  recordAiInteraction,
} from '../../services/ai-quality-learning-service.js';

export async function resolveBiFcStoreFromText(pool, textStr, safeStore) {
  let resolved = String(safeStore || '').trim();
  try {
    if (/马己仙/.test(textStr)) {
      const r = await pool().query(
        `SELECT store FROM pos_sales_detail WHERE store LIKE '%马己仙%' GROUP BY store ORDER BY COUNT(*) DESC LIMIT 1`
      );
      const extracted = String(r.rows?.[0]?.store || '').trim();
      if (extracted) resolved = extracted;
    } else if (/洪潮/.test(textStr)) {
      const r = await pool().query(
        `SELECT store FROM pos_sales_detail WHERE store LIKE '%洪潮%' GROUP BY store ORDER BY COUNT(*) DESC LIMIT 1`
      );
      const extracted = String(r.rows?.[0]?.store || '').trim();
      if (extracted) resolved = extracted;
    }
  } catch (_e) {
    /* ignore */
  }
  return resolved;
}

export function applyBiFcIntentHeuristics(intentPlan, q) {
  if (intentPlan?.params && /(最差|倒数|垫底|最低)/.test(q)) intentPlan.params.sort_order = 'asc';
  if (intentPlan?.params && /(最好|最高|top|前十|前10)/i.test(q)) intentPlan.params.sort_order = 'desc';
  if (intentPlan?.params && /(其他呢|还有呢|再来|继续|更多|再给我)/.test(q) && !intentPlan.params.limit) {
    intentPlan.params.limit = 15;
  }
  if (
    !/^\s*营销文案/m.test(q) &&
    /(方案|计划|策略|如何提升|怎么提升|怎样提升|如何增加|怎么增加|行动计划|具体方案|推广|活动策划|新品方案|营销方案)/.test(q)
  ) {
    intentPlan.intent = 'marketing_plan_request';
    intentPlan.confidence = 1;
  }
  return intentPlan;
}

export async function handleBiFcFollowupTurn(deps, ctx) {
  const {
    runBiFunctionTool,
    narrateBiToolResult,
    pushBiConversationTurn,
    clampInt,
    isToolAllowed,
    setBiLastToolCtx,
  } = deps;
  const { text, q, safeStore, senderRole, userId, brand, lastCtx, allowedTools } = ctx;
  if (!/(其他呢|还有呢|再来|继续|更多|再给我|我要最差|最差的|倒数|垫底|最好|前十|前10|top10|top 10)/i.test(q)) {
    return null;
  }
  if (!lastCtx?.tool) return null;
  if (!allowedTools.has(lastCtx.tool) || !isToolAllowed(senderRole, lastCtx.tool)) {
    return {
      response: '当前角色暂不支持该数据分析工具，请联系管理员开通对应权限。',
      meta: { permissionDenied: true, tool: lastCtx.tool, role: senderRole, store: safeStore },
    };
  }
  const args = { ...(lastCtx.args || {}) };
  if (/(最差|倒数|垫底)/.test(q)) args.sort_order = 'asc';
  if (/(最好|前十|前10|top10|top 10)/i.test(q)) args.sort_order = 'desc';
  if (/(其他呢|还有呢|再来|继续|更多|再给我)/.test(q)) {
    args.limit = clampInt(Number(args.limit || 10) + 5, 1, 20, 20);
  }
  const executed = await runBiFunctionTool(lastCtx.tool, safeStore, args, text, {
    operatorUsername: userId,
    operatorRole: senderRole,
  });
  if (!executed?.text || /暂无.*数据|无法查询|未绑定门店/.test(String(executed.text || ''))) {
    return null;
  }
  const narrated = await narrateBiToolResult(text, executed.text, safeStore, senderRole);
  pushBiConversationTurn(userId, text, narrated, lastCtx.tool);
  setBiLastToolCtx(userId, { tool: lastCtx.tool, args, store: safeStore, ts: Date.now() });
  return {
    response: narrated,
    meta: {
      source: executed.source,
      tool: lastCtx.tool,
      args,
      intentPlan: { intent: lastCtx.tool, confidence: 1, params: args },
      grounded: !!executed.ok,
      followup: true,
      store: safeStore,
      brand,
      role: senderRole,
    },
  };
}

export async function handleBiMarketingPlanRequest(deps, ctx) {
  const { pool, callLLM, log, text, safeStore, senderRole, senderUsername, intentPlan, brand } = ctx;
  const productName = String(intentPlan.params?.product_name || '').trim();
  try {
    const salesRes = await pool().query(
      `SELECT dish_name, SUM(qty) AS total_qty, SUM(revenue) AS total_revenue, COUNT(DISTINCT date) AS sale_days
       FROM pos_sales_detail WHERE store = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY dish_name ORDER BY total_revenue DESC LIMIT 10`,
      [safeStore]
    );
    const revenueRes = await pool().query(
      `SELECT ROUND(AVG(daily_rev)::numeric, 0) AS avg_rev, ROUND(MAX(daily_rev)::numeric, 0) AS max_rev, ROUND(MIN(daily_rev)::numeric, 0) AS min_rev
       FROM (SELECT date, SUM(revenue) AS daily_rev FROM pos_sales_detail WHERE store = $1 AND date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY date) t`,
      [safeStore]
    );
    let productSalesText = '';
    if (productName) {
      const pRes = await pool().query(
        `SELECT SUM(qty) AS total_qty, SUM(revenue) AS total_revenue FROM pos_sales_detail WHERE store = $1 AND dish_name LIKE $2 AND date >= CURRENT_DATE - INTERVAL '30 days'`,
        [safeStore, `%${productName}%`]
      );
      const pRow = pRes.rows[0];
      if (pRow && Number(pRow.total_qty) > 0) {
        productSalesText = `\n【${productName}】近30天销量：${pRow.total_qty}份，营收¥${Number(pRow.total_revenue).toFixed(0)}。`;
      } else {
        productSalesText = `\n【${productName}】近30天暂无销售记录，属于新品推广机会。`;
      }
    }
    const rev = revenueRes.rows[0] || {};
    const topSales = salesRes.rows
      .map((r, i) => `${i + 1}. ${r.dish_name}：${r.total_qty}份，¥${Number(r.total_revenue).toFixed(0)}`)
      .join('\n');
    const dataContext = `门店：${safeStore}\n近30天日均营收：¥${rev.avg_rev || 0}（最高¥${rev.max_rev || 0}，最低¥${rev.min_rev || 0}）${productSalesText}\n\nTOP10销售产品（按营收）：\n${topSales || '暂无数据'}`;
    const marketingTenantId = resolveTenantIdDefault();
    const runtimePatch = await getRuntimePromptPatch(pool(), {
      artifactKey: 'marketing_plan',
      tenantId: marketingTenantId,
      actorId: senderUsername || 'unknown',
    }).catch(() => null);
    const qualityPatchBlock = runtimePatch?.patch
      ? `\n7) 已通过质量门禁的改进规则：${runtimePatch.patch}`
      : '';
    const planLLM = await callLLM(
      [
        {
          role: 'system',
          content: `你是年年有喜餐饮集团的营运顾问。根据以下门店真实数据，生成一份简洁可执行的营收提升行动方案。\n要求：\n1) 基于数据分析，找出2-3个提升点\n2) 每个提升点给出具体可执行动作（不超过2条）\n3) 预估增量（保守）\n4) 总字数不超过400字\n5) 严格基于提供数据，不臆造数据\n6) 如有指定产品，围绕该产品给出推广策略${qualityPatchBlock}`,
        },
        { role: 'user', content: `用户需求：${text}\n\n真实数据：\n${dataContext}` },
      ],
      { role: senderRole, purpose: 'reasoning', temperature: 0.3, max_tokens: 600 }
    );
    const planResponse = planLLM?.content || '数据查询完成，但方案生成失败，请稍后重试。';
    await recordAiInteraction(pool(), {
      source: 'marketing_plan',
      sourceRecordId: randomUUID(),
      route: 'marketing_plan',
      purpose: 'marketing_plan',
      actorId: senderUsername || null,
      modelName: planLLM?.actualModel || null,
      promptVersion: runtimePatch?.version || 'baseline',
      input: text,
      output: planResponse,
      latencyMs: planLLM?.responseTime,
      inputTokens: planLLM?.raw?.usage?.prompt_tokens,
      outputTokens: planLLM?.raw?.usage?.completion_tokens,
      qualityMetrics: { grounded: true, llm_ok: planLLM?.ok === true },
      businessContext: {
        store: safeStore,
        product_name: productName || null,
        quality_release_candidate_id: runtimePatch?.candidateId || null,
        quality_release_status: runtimePatch?.status || 'baseline',
      },
      tenantId: marketingTenantId,
    }).catch((error) =>
      log.error({ msg: 'bi_fc', detail: ['[bi-fc] marketing quality trace failed:', error?.message || error] })
    );
    log.info({
      msg: 'bi_fc',
      detail: ['[bi-fc] marketing_plan_request: generated real plan, len:', planResponse.length],
    });
    return {
      response: planResponse,
      meta: {
        source: 'marketing_plan_generated',
        intentPlan,
        store: safeStore,
        brand,
        role: senderRole,
        grounded: true,
        dataBacked: true,
        functionCalling: true,
      },
    };
  } catch (e) {
    log.error({ msg: 'bi_fc', detail: ['[bi-fc] marketing_plan_request error:', e?.message] });
    return {
      response: `收到！正在为${safeStore}${productName ? '【' + productName + '】' : ''}生成营收提升方案，但数据查询出现问题（${e?.message}），请稍后重试。`,
      meta: { source: 'marketing_plan_error', store: safeStore, role: senderRole },
    };
  }
}

export async function executeBiFcPreferredTool(deps, ctx) {
  const {
    callLLM,
    getBiReasoningModel,
    runBiFunctionTool,
    narrateBiToolResult,
    pushBiConversationTurn,
    parseToolArgs,
    buildBiFactSourceAudit,
    buildBiSourceAuditText,
    isTierBudgetExceeded,
    isToolAllowed,
    getModelTier,
    BI_FUNCTION_TOOLS,
    log,
    setBiLastToolCtx,
  } = deps;
  const {
    text,
    safeStore,
    senderRole,
    userId,
    brand,
    intentPlan,
    preferredTool,
    allowedTools,
  } = ctx;

  if (!allowedTools.has(preferredTool) || !isToolAllowed(senderRole, preferredTool)) {
    return {
      response: '当前角色暂无权限调用该分析工具，建议联系管理员开通后重试。',
      meta: {
        permissionDenied: true,
        requestedTool: preferredTool,
        role: senderRole,
        store: safeStore,
        intentPlan,
      },
    };
  }

  const roleTier = getModelTier(senderRole);
  const budgetExceeded = isTierBudgetExceeded(roleTier);
  let name = preferredTool;
  let args = { ...(intentPlan.params || {}) };
  if (!budgetExceeded) {
    const toolPlanner = await callLLM(
      [
        {
          role: 'system',
          content: `你是BI工具参数器。必须调用工具且只返回工具调用。\n当前用户门店：${safeStore}（该门店是硬约束，不得跨店）。\n已识别意图：${intentPlan.intent}（置信度${intentPlan.confidence.toFixed(2)}）。\n请为指定工具补齐最合理参数。`,
        },
        { role: 'user', content: String(text || '') },
      ],
      {
        model: getBiReasoningModel(),
        temperature: 0,
        max_tokens: 300,
        tools: BI_FUNCTION_TOOLS,
        tool_choice: { type: 'function', function: { name: preferredTool } },
        skipCache: true,
        role: senderRole,
        purpose: 'analysis',
      }
    );
    const toolCalls = Array.isArray(toolPlanner?.message?.tool_calls) ? toolPlanner.message.tool_calls : [];
    log.info({
      msg: 'bi_fc',
      detail: [
        '[bi-fc] toolPlanner ok:',
        toolPlanner?.ok,
        'toolCalls:',
        toolCalls.length,
        'content:',
        String(toolPlanner?.content || '').slice(0, 80),
      ],
    });
    const call = toolCalls[0] || null;
    name = String(call?.function?.name || preferredTool).trim() || preferredTool;
    const llmArgs = parseToolArgs(call?.function?.arguments);
    args = { ...(intentPlan.params || {}), ...(llmArgs || {}) };
  }

  if (!name) {
    log.info({ msg: 'bi_fc', detail: ['[bi-fc] skip: no tool name resolved'] });
    return null;
  }
  log.info({ msg: 'bi_fc', detail: ['[bi-fc] executing tool:', name, 'args:', JSON.stringify(args)] });
  const executed = await runBiFunctionTool(name, safeStore, args, text, {
    operatorUsername: userId,
    operatorRole: senderRole,
  });
  log.info({
    msg: 'bi_fc',
    detail: [
      '[bi-fc] executed ok:',
      executed?.ok,
      'source:',
      executed?.source,
      'textLen:',
      String(executed?.text || '').length,
    ],
  });
  if (!executed?.text) {
    log.info({ msg: 'bi_fc', detail: ['[bi-fc] skip: empty tool result'] });
    return null;
  }
  if (/暂无.*数据|无法查询|未绑定门店/.test(String(executed.text || ''))) {
    const sourceAuditRows = await buildBiFactSourceAudit(safeStore, text).catch(() => []);
    const sourceAuditText = buildBiSourceAuditText(sourceAuditRows);
    const baseText = String(executed.text || '当前查询暂无可用数据。').trim();
    return {
      response: sourceAuditText ? `${baseText}\n\n数据源检查：\n${sourceAuditText}` : baseText,
      meta: {
        source: executed.source,
        tool: name,
        args,
        intentPlan,
        grounded: false,
        deterministic: true,
        functionCalling: true,
        dataBacked: true,
        noData: true,
        reason: 'insufficient_sources',
        sourceAuditRows,
        store: safeStore,
        brand,
        role: senderRole,
      },
    };
  }

  const narrated = await narrateBiToolResult(text, executed.text, safeStore, senderRole);
  log.info({ msg: 'bi_fc', detail: ['[bi-fc] narrated len:', narrated?.length] });
  pushBiConversationTurn(userId, text, narrated, name);
  setBiLastToolCtx(userId, { tool: name, args, store: safeStore, ts: Date.now() });
  return {
    response: narrated,
    meta: {
      source: executed.source,
      tool: name,
      args,
      intentPlan,
      grounded: !!executed.ok,
      budgetExceeded,
      store: safeStore,
      brand,
      role: senderRole,
    },
  };
}

export async function tryHandleBiByFunctionCallingBody(deps, args) {
  const {
    pool,
    getModelTier,
    getAvailableTools,
    parseFeishuMarketingCopyTemplate,
    buildBiIntentPlan,
    getBiConversationHistory,
    log,
    getBiLastToolCtx,
    setBiLastToolCtx,
    isToolAllowed,
    clampInt,
    runBiFunctionTool,
    narrateBiToolResult,
    pushBiConversationTurn,
  } = deps;
  const { text, store, brand, senderRole, senderUsername } = args;

  const userId = String(senderUsername || 'anon').trim();
  let safeStore = String(store || '').trim();
  const lastCtx = getBiLastToolCtx(userId);
  const allowedTools = new Set(getAvailableTools(senderRole));
  const textStr = String(text || '');

  safeStore = await resolveBiFcStoreFromText(pool, textStr, safeStore);
  if ((!safeStore || safeStore === '总部') && lastCtx?.store && lastCtx.store !== '总部') {
    safeStore = String(lastCtx.store || '').trim();
  }
  if (!safeStore || safeStore === '总部') {
    log.info({ msg: 'bi_fc', detail: ['[bi-fc] skip: no valid store'] });
    return null;
  }

  const q = String(text || '').trim();
  if (parseFeishuMarketingCopyTemplate(q)) {
    log.info({ msg: 'bi_fc', detail: ['[bi-fc] skip: marketing copy structured message'] });
    return null;
  }

  const followupDeps = {
    runBiFunctionTool,
    narrateBiToolResult,
    pushBiConversationTurn,
    clampInt,
    isToolAllowed,
    setBiLastToolCtx,
  };
  const followup = await handleBiFcFollowupTurn(followupDeps, {
    text,
    q,
    safeStore,
    senderRole,
    userId,
    brand,
    lastCtx,
    allowedTools,
  });
  if (followup) return followup;

  const convHistory = getBiConversationHistory(userId);
  log.info({
    msg: 'bi_fc',
    detail: [
      '[bi-fc] start intent planning for:',
      JSON.stringify(text).slice(0, 80),
      'store:',
      safeStore,
      'historyTurns:',
      convHistory.length / 2,
    ],
  });
  let intentPlan = await buildBiIntentPlan(text, safeStore, convHistory, senderRole);
  intentPlan = applyBiFcIntentHeuristics(intentPlan, q);
  log.info({ msg: 'bi_fc', detail: ['[bi-fc] intentPlan:', JSON.stringify(intentPlan)] });

  if (intentPlan.intent === 'marketing_plan_request') {
    return handleBiMarketingPlanRequest(deps, {
      pool,
      callLLM: deps.callLLM,
      log,
      text,
      safeStore,
      senderRole,
      senderUsername,
      intentPlan,
      brand,
    });
  }

  if (!intentPlan?.intent || intentPlan.intent === 'other' || intentPlan.confidence < 0.55) {
    log.info({ msg: 'bi_fc', detail: ['[bi-fc] skip: intent not actionable'] });
    return null;
  }

  const intentToolMap = {
    query_sales_ranking: 'query_sales_ranking',
    query_complaint_product_ranking: 'query_complaint_product_ranking',
    query_revenue_summary: 'query_revenue_summary',
    query_revenue_forecast_next_day: 'query_revenue_forecast_next_day',
    query_table_visit: 'query_table_visit',
  };
  const preferredTool = intentToolMap[intentPlan.intent] || '';
  if (!preferredTool) {
    log.info({ msg: 'bi_fc', detail: ['[bi-fc] skip: no tool for intent', intentPlan.intent] });
    return null;
  }

  return executeBiFcPreferredTool(
    { ...deps, log, setBiLastToolCtx, getModelTier },
    { text, q, safeStore, senderRole, userId, brand, intentPlan, preferredTool, allowedTools }
  );
}
