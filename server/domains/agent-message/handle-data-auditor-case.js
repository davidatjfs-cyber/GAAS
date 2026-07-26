/**
 * data_auditor case body (Wave A2b peel from agents.js).
 * BI deterministic builders / FC / grounding stay in agents.js and are injected.
 *
 * Note: do NOT import agent-config-manager here — it imports pool from agents.js
 * and would create a circular init cycle with this module.
 */
import {
  executeMetrics as defaultExecuteMetrics,
  extractTimeRangeFromText as defaultExtractTimeRangeFromText,
  logExecutorEvent as defaultLogExecutorEvent,
  runBusinessDiagnosis as defaultRunBusinessDiagnosis,
  setSessionState as defaultSetSessionState,
} from '../../data-executor.js';
import { childLogger } from '../../utils/logger.js';
import { tryBiDeterministicCascade } from './bi-deterministic-cascade.js';
import { resolveDataAuditorStore } from './store-resolve.js';

const log = childLogger({ domain: 'agent-message', handler: 'handle-data-auditor-case' });

/**
 * @param {object} deps
 * @param {object} deps.featureFlags - AGENT_FEATURE_FLAGS (injected; avoids agent-config cycle)
 * @returns {(ctx: object) => Promise<{ response: string, agentData: object }>}
 */

async function runDataAuditorMetricsExecutor(env) {
  const {
    featureFlags, routeRes, text, resolvedStore, store, brand, brandId, brandConfig, route,
    pool, extractTimeRangeFromText, executeMetrics, logExecutorEvent, runBusinessDiagnosis,
    setSessionState, senderUsername, sessionState,
  } = env;
  let dxFallbackResponse;
  let dxFallbackAgentData;
  if (featureFlags.enable_data_executor && featureFlags.enable_metric_dictionary) {
    const ruleMetrics = Array.isArray(routeRes.required_metrics) ? routeRes.required_metrics : [];
    if (ruleMetrics.length > 0) {
      try {
        const execStore = resolvedStore;
        const extracted = extractTimeRangeFromText(text);
        let resolvedTimeRange = extracted.timeRange;
        const userSpecifiedTime = extracted.label !== '近7天';
        let staleDataNotice = '';
        if (!userSpecifiedTime && execStore && execStore !== '总部') {
          try {
            const latestDateRes = await pool().query(
              `SELECT MAX(date) as latest FROM pos_sales_detail WHERE store = $1`,
              [execStore]
            );
            const latestDate = latestDateRes.rows?.[0]?.latest;
            if (latestDate) {
              const latestMs = new Date(latestDate).getTime();
              const nowMs = Date.now();
              const dayDiff = Math.floor((nowMs - latestMs) / 86400000);
              if (dayDiff > 7) {
                staleDataNotice = `${execStore} 最新销售数据为 ${latestDate}（滞后 ${dayDiff} 天）`;
                log.warn({ msg: 'stale_source_detected', detail: staleDataNotice });
              }
            }
          } catch {
            /* ignore */
          }
        }
        sessionState.time_range = resolvedTimeRange;
        logExecutorEvent('time_range_extracted', {
          task_id: sessionState.task_id,
          text_snippet: text.slice(0, 60),
          time_range: resolvedTimeRange,
        });

        const execResult = await executeMetrics(
          ruleMetrics,
          resolvedTimeRange,
          execStore,
          sessionState.task_id
        );
        sessionState.metrics_requested = [
          ...new Set([...(sessionState.metrics_requested || []), ...ruleMetrics]),
        ];
        sessionState.metrics_returned = [
          ...new Set([...(sessionState.metrics_returned || []), ...execResult.metrics_returned]),
        ];
        sessionState.metric_versions = {
          ...(sessionState.metric_versions || {}),
          ...execResult.metric_versions,
        };
        setSessionState(senderUsername, sessionState).catch(() => {});

        const validResults = execResult.results.filter(
          (r) => r.value !== null && r.value !== undefined
        );
        if (validResults.length > 0) {
          const lines = validResults.map((r) => {
            const isRatio = r.metric_id.includes('率') || r.name?.includes('率');
            const v =
              typeof r.value === 'number'
                ? isRatio
                  ? `${r.value}%`
                  : r.value.toLocaleString('zh-CN')
                : r.value;
            return `- **${r.name}**：${v}${r.notes ? `（${r.notes}）` : ''}`;
          });
          const failedResults = execResult.results.filter(
            (r) => r.value === null || r.value === undefined
          );
          const failNote =
            failedResults.length > 0
              ? `\n\n⚠️ 以下指标暂无数据：${failedResults.map((r) => r.name || r.metric_id).join('、')}`
              : '';
          const intentLabel = routeRes.intent_label || routeRes.intent || '';
          const { label: timeLabel } = extractTimeRangeFromText(text);
          const displayStore =
            resolvedStore && resolvedStore !== '总部' ? resolvedStore : store || '全部门店';
          let dataBlock = `📊 ${intentLabel}（${displayStore}｜${timeLabel}）\n\n${lines.join('\n')}${failNote}`;
          if (staleDataNotice) {
            dataBlock += `\n\n⚠️ 数据新鲜度提醒：${staleDataNotice}`;
          }

          if (featureFlags.enable_business_diagnosis) {
            try {
              const diagResult = await runBusinessDiagnosis(execResult, text, {
                username: senderUsername,
              });
              if (diagResult?.diagnosis) {
                dataBlock += `\n\n💡 **经营诊断**\n${diagResult.diagnosis}`;
                logExecutorEvent('diagnosis_injected', {
                  task_id: execResult.task_id,
                  data_basis: diagResult.data_basis,
                });
              }
            } catch (de) {
              logExecutorEvent('diagnosis_inject_error', {
                task_id: execResult.task_id,
                error: de?.message,
              });
            }
          }

          dxFallbackResponse = dataBlock;
          dxFallbackAgentData = {
            route,
            store,
            brand,
            brandId,
            brandConfig,
            grounded: true,
            deterministic: true,
            source: 'data_executor',
            task_id: execResult.task_id,
            intent: routeRes.intent,
            metrics_returned: execResult.metrics_returned,
            metric_versions: execResult.metric_versions,
          };
        }
      } catch (e) {
        logExecutorEvent('executor_fallthrough', {
          task_id: sessionState.task_id,
          error: e?.message,
          metrics: routeRes.required_metrics,
        });
        log.error({ msg: 'executor_fallthrough', err: String(e?.message || e) });
      }
    }
  }
  return { dxFallbackResponse, dxFallbackAgentData };
}

export async function runDataAuditorExecutorPhase(deps, ctx) {
  const {
  pool,
  inferBrandFromStoreName,
  executeMetrics = defaultExecuteMetrics,
  extractTimeRangeFromText = defaultExtractTimeRangeFromText,
  logExecutorEvent = defaultLogExecutorEvent,
  runBusinessDiagnosis = defaultRunBusinessDiagnosis,
  setSessionState = defaultSetSessionState,
  } = deps;

  // Resolve flags at call time (agents.js ↔ agent-config-manager cycle: binding may be
  // in TDZ if read during module-init wiring).
  const featureFlags =
    typeof deps.getFeatureFlags === 'function' ? deps.getFeatureFlags() : deps.featureFlags;
  if (!featureFlags) {
    throw new Error('createHandleDataAuditorCase: featureFlags/getFeatureFlags is required');
  }
  const {
    text,
    route,
    routeRes,
    store,
    brand,
    brandId,
    brandConfig,
    senderRole,
    senderUsername,
    senderName,
    sessionState,
    activeTaskContext,
  } = ctx;
  let response = '';
  let agentData = { route, brandId, brandConfig };
  let dxFallbackResponse;
  let dxFallbackAgentData;

  const resolvedStore = await resolveDataAuditorStore(pool(), {
    text,
    boundStore: store,
    inferBrandFromStoreName,
  });

  const metricsOut = await runDataAuditorMetricsExecutor({
    featureFlags, routeRes, text, resolvedStore, store, brand, brandId, brandConfig, route,
    pool, extractTimeRangeFromText, executeMetrics, logExecutorEvent, runBusinessDiagnosis,
    setSessionState, senderUsername, sessionState,
  });
  dxFallbackResponse = metricsOut.dxFallbackResponse;
  dxFallbackAgentData = metricsOut.dxFallbackAgentData;

  return {
    featureFlags,
    text,
    route,
    routeRes,
    store,
    brand,
    brandId,
    brandConfig,
    senderRole,
    senderUsername,
    senderName,
    sessionState,
    activeTaskContext,
    response,
    agentData,
    dxFallbackResponse,
    dxFallbackAgentData,
    resolvedStore,
  };
}

export async function runDataAuditorReplyPhase(deps, state) {
  const {
    pool,
    tryHandleBiByFunctionCalling,
    isFactLikeQuestion,
    buildBiFactSourceAudit,
    buildBiSourceAuditText,
    buildBiGroundingFacts,
    callLLM,
    getContext,
    updateContext,
    getSharedState,
    normalizeStoreKey,
    resolveDateRangeFromQuestion,
    buildSalesReport,
    buildBiDeterministicDataSourceCoverageReply,
    buildBiDeterministicDailyReportReply,
    buildBiDeterministicTableVisitReply,
    buildBiDeterministicSalesRawTopReply,
    buildBiDeterministicBadReviewReportReply,
    buildBiDeterministicClosingReportReply,
    buildBiDeterministicOpeningReportReply,
    buildBiDeterministicMaterialReportReply,
    buildBiDeterministicMeetingReportReply,
    buildBiDeterministicOpsReportCountReply,
    buildBiDeterministicLossReportReply,
  } = deps;
  let {
    text,
    route,
    store,
    brand,
    brandId,
    brandConfig,
    senderRole,
    senderUsername,
    senderName,
    activeTaskContext,
    response,
    agentData,
    dxFallbackResponse,
    dxFallbackAgentData,
    resolvedStore,
  } = state;

  const biDet = await tryBiDeterministicCascade(
    { text, resolvedStore, route, store, brand, brandId, brandConfig },
    {
      buildCoverage: buildBiDeterministicDataSourceCoverageReply,
      buildDailyReport: buildBiDeterministicDailyReportReply,
      buildTableVisit: buildBiDeterministicTableVisitReply,
      buildSalesRawTop: buildBiDeterministicSalesRawTopReply,
      buildBadReview: buildBiDeterministicBadReviewReportReply,
      buildClosing: buildBiDeterministicClosingReportReply,
      buildOpening: buildBiDeterministicOpeningReportReply,
      buildMaterial: buildBiDeterministicMaterialReportReply,
      buildMeeting: buildBiDeterministicMeetingReportReply,
      buildOpsCount: buildBiDeterministicOpsReportCountReply,
      buildLoss: buildBiDeterministicLossReportReply,
      getSharedState,
      normalizeStoreKey,
      resolveDateRangeFromQuestion,
      buildSalesReport,
    }
  );
  if (biDet.handled) {
    return { response: biDet.response, agentData: biDet.agentData };
  }

  const fcHandled = await tryHandleBiByFunctionCalling({
    text,
    store: resolvedStore,
    brand,
    senderRole,
    senderUsername,
  });
  if (fcHandled?.response) {
    return {
      response: fcHandled.response,
      agentData: {
        route,
        store,
        brand,
        brandId,
        brandConfig,
        deterministic: true,
        functionCalling: true,
        ...fcHandled.meta,
      },
    };
  }

  if (typeof dxFallbackResponse === 'string' && dxFallbackResponse) {
    return { response: dxFallbackResponse, agentData: dxFallbackAgentData };
  }

  const isFactQuestion = isFactLikeQuestion(text);
  const sourceAuditRows = isFactQuestion ? await buildBiFactSourceAudit(store, text) : [];
  const hasUsableSource = sourceAuditRows.some((x) => x.status === 'ok');
  if (isFactQuestion && sourceAuditRows.length > 0 && !hasUsableSource) {
    const auditText = buildBiSourceAuditText(sourceAuditRows);
    return {
      response: `当前问题需要的数据源暂无可用样本，无法给出确定性结论。\n\n数据源检查：\n${auditText}\n\n请先完成数据同步/启用后重试。`,
      agentData: {
        route,
        store,
        brand,
        brandId,
        brandConfig,
        grounded: false,
        reason: 'insufficient_sources',
        sourceAuditRows,
      },
    };
  }

  let issueContext = '';
  try {
    const issuesR = await pool().query(
      `SELECT severity, title, created_at FROM agent_issues WHERE store = $1 AND status != 'resolved' ORDER BY created_at DESC LIMIT 5`,
      [store]
    );
    if (issuesR.rows?.length) {
      issueContext =
        '\n\n当前门店未解决的审计异常：\n' +
        issuesR.rows.map((i, idx) => `${idx + 1}. [${i.severity}] ${i.title}`).join('\n');
    }
  } catch {
    /* ignore */
  }

  const groundingFacts = await buildBiGroundingFacts(store, text);
  const sourceAuditText = buildBiSourceAuditText(sourceAuditRows);
  const hasInsufficientFacts = /无差评样本|无桌访不满意菜品样本|查询失败|不可用/.test(
    groundingFacts
  );
  const askReviewLike =
    /(差评|点评|评论|桌访|产品问题|反馈|口味|出品|上菜|服务)/.test(String(text || ''));

  if (askReviewLike && hasInsufficientFacts && !issueContext) {
    return {
      response:
        '当前系统可用样本不足，暂时无法给出准确的“近7天差评/桌访问题次数”结论。建议先确认飞书差评表与桌访表是否已入库，再让我输出精确明细（含桌号/时段/原文）。',
      agentData: {
        route,
        store,
        brand,
        brandId,
        brandConfig,
        grounded: false,
        reason: 'insufficient_facts',
      },
    };
  }

  const biLlm = await callLLM(
    [
      {
        role: 'system',
        content: `你是"小年"，年年有喜餐饮集团AI助理，当前协助数据分析。当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。门店：${store}（${brand}）。用户：${senderName}（${senderRole === 'store_manager' ? '店长' : senderRole === 'store_production_manager' ? '出品经理' : '员工'}）。
  数据说明：系统中"expectedRevenue"=折前营业额（销售金额），"actualRevenue"=实收营业额（菜品收入）。洪潮品牌仅堂食，无外卖业务。
  严格约束：只能基于下方事实作答，绝对禁止编造数字/日期/菜品排名。若无事实必须说"当前系统无此数据"。禁止提及"卤鹅"为热销菜品。禁止编造员工人数/薪资日期等非BI信息。
  ${issueContext}${activeTaskContext}
  ${sourceAuditText ? '数据源：' + sourceAuditText : ''}
  ${groundingFacts ? '可用事实：' + groundingFacts : ''}
  严格基于事实回复，不超300字。`,
      },
      ...getContext(senderUsername).slice(-4),
      { role: 'user', content: text },
    ],
    { role: senderRole, purpose: 'analysis', temperature: 0.05, max_tokens: 420 }
  );
  response = biLlm.content || '收到，我会查看门店数据并尽快回复。';
  updateContext(senderUsername, 'user', text);
  updateContext(senderUsername, 'assistant', response);
  agentData = {
    route,
    store,
    brand,
    brandId,
    brandConfig,
    sourceAuditRows,
    grounded: !!groundingFacts,
    groundingFacts,
  };
  return { response, agentData };
}

export async function handleDataAuditorCase(deps, ctx) {
  const state = await runDataAuditorExecutorPhase(deps, ctx);
  return runDataAuditorReplyPhase(deps, state);
}

export function createHandleDataAuditorCase(deps) {
  return (ctx) => handleDataAuditorCase(deps, ctx);
}
