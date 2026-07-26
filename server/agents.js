/**
 * HRMS Multi-Agent System — Feishu-First Architecture
 * BUILD_VERSION: 2026-03-24-v2-store-align
 *
 * HRMS = 大脑 + 数据处理中心
 * 飞书 = 唯一交互通道（单聊推送 / 接收回复）
 *
 * Agents:
 *   1. Data Auditor        (数据审计员) — 异常检测 → 飞书推送
 *   2. Operational Supervisor (营运督导员) — 图片审核 / 反作弊
 *   3. HR Agent           (HR专员) — 绩效评分 / 人事管理
 *   4. SOP Advisor         (SOP顾问)   — 知识库问答
 *
 * Flow:
 *   Scheduler → Agent 发现异常 → 飞书推送给店长
 *   店长在飞书回复文字/照片/语音 → webhook → Agent 处理 → 飞书回复
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { isAiQualityExternalEnabled, isExternalEnabled } from './safety.js';
import crypto from 'crypto';
import { 
  calculateStoreRating, 
  calculateEmployeeScore
} from './new-scoring-model.js';
import { 

  AgentCommunicationHelper 
} from './agent-communication-system.js';
import { pool as agentPool, setPool as setUnifiedAgentPool, getActiveTenantIds, resolveTenantIdDefault, tenantContext } from './utils/database.js'
import { getTenantAiModelConfig } from './tenant-integrations.js';
import { getLarkTenantToken as getTenantLarkToken } from './feishu-messaging.js';
import { getBrandConfigSync, getBrandForStoreSync, getAllBrandNamesSync } from './utils/brand-config-loader.js';
import { safeExecute, safeErrorLog } from './utils/error-handler.js';
import { maskLLMMessages } from './utils/sensitive-mask.js';
import { sanitizeLLMOutput, sanitizeLLMOutputWithAudit } from './utils/llm-output-sanitize.js';
import { logAgentOperation } from './utils/agent-audit-log.js';
import { recordAiFeedback, recordAiInteraction } from './services/ai-quality-learning-service.js';
import {
  feishuSkipOpenIdResolveHrms,
  isOpenIdCrossAppFeishuError,
  refreshFeishuUserOpenIdForImDeliveryHrms
} from './utils/feishu-open-id-cross-app.js';
import { deduplicateMessage } from './message-deduplication.js';
import { getOpsAgentConfig, getBiAgentConfig, AGENT_FEATURE_FLAGS } from './agent-config-manager.js';
import {
  buildEvidencePackage,
  detectFactDemand,
  isDataBackedReply,
} from './domains/agent-message/quality-helpers.js';
import { createHandleAgentMessage } from './domains/agent-message/handle-agent-message.js';
import { createRouteMessage } from './domains/agent-message/route-message.js';
import { createHandleOpsChecklistCardAction } from './domains/agent-ops/handle-checklist-card-action.js';
import { createOpsChecklistCardsApi } from './domains/agent-ops/checklist-cards.js';
import { createAuditImage } from './domains/agent-ops/audit-image.js';
import { createTryFeishuMarketingCopyRound } from './domains/agent-message/marketing-copy.js';
import { createCheckAgentQualityApi } from './domains/agent-message/check-agent-quality.js';
import { parseFeishuMarketingCopyTemplate } from './domains/agent-message/marketing-copy-helpers.js';
import { createGetOpsKnowledgeSupport } from './domains/agent-ops/knowledge-support.js';
import { createSendScheduledChecklist } from './domains/agent-ops/send-scheduled-checklist.js';
import { createRunChiefEvaluator } from './domains/agent-evaluator/run-chief-evaluator.js';
import { createSendSafetyCheck } from './domains/agent-ops/send-safety-check.js';
import { createFetchStoreRatingForProfileDisplay } from './domains/agent-evaluator/fetch-store-rating-for-profile.js';
import { createArchiveOldBitableSubmissions } from './domains/feishu-bitable/archive-old-submissions.js';
import { createExecuteScheduledTask } from './domains/agent-ops/execute-scheduled-task.js';
import { createGetBitableSubmissionStats } from './domains/feishu-bitable/get-submission-stats.js';
import { createBuildScheduledTasksFromConfig } from './domains/agent-ops/build-scheduled-tasks-from-config.js';
import { createHandleDataAuditorCase } from './domains/agent-message/handle-data-auditor-case.js';
import { createOnFeishuEvent } from './domains/agent-feishu-bot/on-feishu-event.js';
import { createFeishuUserMessagingApi } from './domains/agent-feishu-bot/feishu-user-messaging.js';
import { createTryHandleBiByFunctionCalling } from './domains/agent-bi/try-handle-bi-by-function-calling.js';
import { clampInt } from './domains/agent-bi/bi-tool-period.js';
import { createRunBiFunctionTool } from './domains/agent-bi/run-bi-function-tool.js';
import { createBuildBiDeterministicDailyReportReply } from './domains/agent-bi/build-daily-report-reply.js';
import { createBuildBiDeterministicSalesRawTopReply } from './domains/agent-bi/build-sales-raw-top-reply.js';
import { createBuildBiDeterministicBadReviewReportReply } from './domains/agent-bi/build-bad-review-report-reply.js';
import { createDeterministicCascadeReplies } from './domains/agent-bi/deterministic-cascade-replies.js';
import { createPollBitableSubmissions } from './domains/feishu-bitable/poll-submissions.js';
import { createTaskResponseApi } from './domains/feishu-bitable/task-response.js';
import { createProcessBitableData } from './domains/feishu-bitable/process-bitable-data.js';
import { createBitableRecordsClient } from './domains/feishu-bitable/bitable-records-client.js';
import { createBitablePollingController } from './domains/feishu-bitable/start-bitable-polling.js';
import {
  buildKpiRadarAlertJson,
  createRunDataAuditor,
} from './domains/agent-auditor/run-data-auditor.js';
import { createTableVisitMetricsApi } from './domains/agent-auditor/table-visit-metrics.js';
import { createMarginMetricsApi } from './domains/agent-auditor/margin-metrics.js';
import {
  getLLMClientConfig,
  getProviderHealthStatus,
  markProviderFail,
  markProviderOk,
  resolveModelProvider,
  sleep,
} from './domains/ai/llm-provider-helpers.js';
import { createLoadTenantAiConfig } from './domains/ai/load-tenant-ai-config.js';
import { createTenantLlmConfigCache } from './domains/ai/tenant-llm-config.js';
import { createCallLLM } from './domains/ai/call-llm.js';
import { createCallVisionLLM, createCallVisionLLMVideo } from './domains/ai/call-vision-llm.js';
import { buildSalesReport } from './bi-sales-detail.js';
import {
  generateWeeklyReport,
  generateMonthlyReport,
  formatReportMarkdown,
  setReportPool,
  resolveStoreKeyForReports,
  queryMarginByBiz,
  queryCostCoverageDiagnostics,
  calendarPreviousMonthRangeShanghai,
  calendarLastCompletedWeekMonSunShanghai
} from './bi-weekly-report.js';
import { extractRelationsFromBitableRecord } from './knowledge-graph.js';
import {
  feishuStoreSearchPatterns,
  dailyReportIlikePatterns,
  dailyReportRowMatches,
  feishuTableRowMatches,
  resolveAgentCanonicalStore
} from './v2-store-alignment.js';
import {
  getModelForRole,
  getTemperatureForRole,
  getMaxTokensForRole,
  trackLLMCall,
  getModelTier,
  getAvailableTools,
  isToolAllowed,
  isTierBudgetExceeded
} from './hq-brain-config.js';
import {
  matchAnalysisRule,
  setCallLLMBridge,
  logExecutorEvent
} from './data-executor.js';
import {
  inferBrandFromStoreName as _inferBrandFromStoreNameImpl,
  STORE_CANONICAL_MAP as _STORE_CANONICAL_MAP_IMPL,
  ALL_STORE_NAMES,
  STORE_ID_TO_NAME as _STORE_ID_TO_NAME_IMPL,
} from './brands-config.js';

import { childLogger } from './utils/logger.js';
import {
  runAuditTick,
  runWeeklyAuditTick,
  runEvalTick,
  runWeeklyOpsTick,
  runDailyRechargeTick,
  runPushTick,
} from './domains/agent-ops/scheduler-ticks.js';

export { getProviderHealthStatus };

const log = childLogger({ domain: 'agents' });

// ─────────────────────────────────────────────
// 0. Config
// ─────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || 'ep-20260424183833-7lr9g';
const QWEN_API_KEY = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen-max';
const DOUBAO_API_KEY = process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY || '';
const DOUBAO_BASE_URL = process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';

// Provider health / fallback chain → domains/ai/llm-provider-helpers.js

function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

const _biConversationCtx = new Map();
const BI_CONV_CTX_TTL = 10 * 60 * 1000;
const BI_CONV_CTX_MAX = 4;

const _agentQualityMetrics = {
  audits: 0,
  rewrites: 0,
  failedAudits: 0,
  numericViolations: 0,
  factualBlocks: 0,
  autonomousTasks: 0,
  lastUpdatedAt: ''
};

const AGENT_EVAL_CASES = [
  { text: '近7天门店营业额达成率怎么样', route: 'data_auditor', demand: 'hard' },
  { text: '帮我看下差评最多的菜品', route: 'data_auditor', demand: 'hard' },
  { text: '我要开市检查表', route: 'ops_supervisor', demand: 'soft' },
  { text: '这条绩效扣分我想申诉', route: 'appeal', demand: 'soft' },
  { text: '我想咨询离职流程', route: 'chief_evaluator', demand: 'soft' },
  { text: '这个SOP退款标准怎么执行', route: 'train_advisor', demand: 'soft' },
  { text: '你好', route: 'general', demand: 'none' }
];

function safeJsonParse(text, fallback = null) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { /* ignore */ }
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch (e) { /* ignore */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try { return JSON.parse(m[0]); } catch (e) { return fallback; }
}

function normalizePlainText(text, maxLen = 1200) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function extractNumericLiterals(text) {
  const vals = String(text || '').match(/-?\d+(?:\.\d+)?%?/g) || [];
  return vals.slice(0, 24);
}

function verifyNumericGrounding(responseText, evidenceText) {
  const answerNums = extractNumericLiterals(responseText);
  if (!answerNums.length) return { ok: true, missing: [] };
  const evidenceNums = new Set(extractNumericLiterals(evidenceText));
  if (!evidenceNums.size) return { ok: false, missing: answerNums.slice(0, 6) };
  const missing = answerNums.filter((x) => !evidenceNums.has(x));
  return { ok: missing.length <= Math.max(1, Math.floor(answerNums.length * 0.3)), missing: missing.slice(0, 6) };
}

function getBiConversationHistory(userId) {
  const entry = _biConversationCtx.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.ts > BI_CONV_CTX_TTL) { _biConversationCtx.delete(userId); return []; }
  return entry.history || [];
}

function pushBiConversationTurn(userId, userText, assistantText, toolName) {
  const entry = _biConversationCtx.get(userId) || { ts: Date.now(), history: [] };
  entry.ts = Date.now();
  entry.history.push({ role: 'user', q: String(userText || '').slice(0, 120), tool: toolName || '' });
  entry.history.push({ role: 'assistant', a: String(assistantText || '').slice(0, 200) });
  if (entry.history.length > BI_CONV_CTX_MAX * 2) entry.history = entry.history.slice(-BI_CONV_CTX_MAX * 2);
  _biConversationCtx.set(userId, entry);
}

const BI_FUNCTION_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_sales_ranking',
      description: '查询门店菜品销售排行（可查询TOP或倒数，支持堂食/外卖，支持按销量/折前金额/实收金额排序）',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议7-90', minimum: 1, maximum: 90 },
          limit: { type: 'integer', description: '返回条数，建议1-20', minimum: 1, maximum: 20 },
          sort_order: { type: 'string', enum: ['desc', 'asc'], description: 'desc=TOP最高，asc=倒数最低' },
          metric: { type: 'string', enum: ['sales_amount', 'revenue', 'qty'], description: 'sales_amount=折前金额，revenue=实收金额，qty=销量' },
          biz_type: { type: 'string', enum: ['all', 'dinein', 'takeaway'], description: 'all=全部，dinein=堂食，takeaway=外卖' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_complaint_product_ranking',
      description: '查询门店被投诉/差评最多或最少的产品排行',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议7-90', minimum: 1, maximum: 90 },
          limit: { type: 'integer', description: '返回条数，建议1-20', minimum: 1, maximum: 20 },
          sort_order: { type: 'string', enum: ['desc', 'asc'], description: 'desc=投诉最多，asc=投诉最少' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_revenue_summary',
      description: '查询门店在指定天数内的营业额与达成率汇总',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议1-60', minimum: 1, maximum: 60 }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_revenue_forecast_next_day',
      description: '预测门店下一日营业额（优先使用营业日报，缺失时回退销售明细）',
      parameters: {
        type: 'object',
        properties: {
          lookback_days: { type: 'integer', description: '回看天数，建议7-30', minimum: 3, maximum: 60 }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_table_visit',
      description: '查询门店桌访记录（不满意菜品、桌巡记录等）',
      parameters: {
        type: 'object',
        properties: {
          period_days: { type: 'integer', description: '统计天数，建议7-30', minimum: 1, maximum: 90 }
        }
      }
    }
  }
];

function parseToolArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  try {
    const parsed = JSON.parse(String(rawArgs));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_e) {
    return {};
  }
}

// P2: clampInt / resolveToolPeriod / execBiTool* / runBiFunctionTool → domains/agent-bi/
let _runBiFunctionTool;
async function runBiFunctionTool(toolName, store, args = {}, originalQuery = '', ctx = {}) {
  return _runBiFunctionTool(toolName, store, args, originalQuery, ctx);
}

function tryParseJsonObjectFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const direct = parseToolArgs(raw);
  if (direct && Object.keys(direct).length) return direct;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const parsed = parseToolArgs(m[0]);
  return parsed && Object.keys(parsed).length ? parsed : null;
}

function normalizeIntentPlan(rawPlan = {}) {
  const intent = String(rawPlan.intent || 'other').trim();
  const confidence = Math.max(0, Math.min(1, Number(rawPlan.confidence) || 0));
  const params = rawPlan.params && typeof rawPlan.params === 'object' ? rawPlan.params : {};
  return { intent, confidence, params };
}

async function buildBiIntentPlan(text, safeStore, conversationHistory = [], senderRole = '') {
  const historyHint = conversationHistory.length
    ? `\n\n最近对话记录（用于理解追问/上下文）：\n${conversationHistory.map(h => h.role === 'user' ? `用户: ${h.q} [工具:${h.tool||'无'}]` : `助手: ${h.a}`).join('\n')}`
    : '';
  const planner = await callLLM(
    [
      {
        role: 'system',
        content: `你是BI意图识别器。\n仅输出JSON，不要额外文字。\n候选intent：query_sales_ranking、query_complaint_product_ranking、query_revenue_summary、query_revenue_forecast_next_day、query_table_visit、marketing_plan_request、other。\n输出格式：{"intent":"...","confidence":0-1,"params":{...}}\nparams仅允许：period_days,lookback_days,limit,sort_order,metric,biz_type,product_name。\n若用户问"最差/倒数/垫底"则sort_order=asc；问"最好/最多/TOP"则sort_order=desc。\n当前门店：${safeStore}（只用于理解上下文，最终权限以后端为准）。\n\n【最高优先级规则-先判断再看其他】：\n- 只要用户消息包含"方案""计划""策略""如何提升""怎么提升""怎样提升""如何增加""怎么增加""行动计划""具体方案"等规划性词汇，无论是否也含有"营收""销售""数据"等词，一律识别为 marketing_plan_request，confidence=1。\n- 仅当用户是纯粹查询数据（如"查一下营收""看看销售额""最近数据""上周多少钱"）时才使用 query_xxx 类型。\n- 若用户要求"做营销方案""推广方案""新品方案""活动策划""行动方案"等战略规划类请求，识别为 marketing_plan_request，confidence=1，params中用product_name记录产品名（如有）。\n\n重要：用户可能在追问上一轮的结果（比如"给我10样""排前10呢""具体投诉什么"），请结合对话记录理解真实意图。若追问内容明显关联上一轮工具，复用同一intent并调整params（如limit/sort_order）。${historyHint}`
      },
      { role: 'user', content: String(text || '') }
    ],
    {
      model: getBiReasoningModel(),
      temperature: 0,
      max_tokens: 220,
      skipCache: true,
      role: senderRole,
      purpose: 'analysis'
    }
  );
  const parsed = tryParseJsonObjectFromText(planner?.content || '');
  if (!parsed) return { intent: 'other', confidence: 0, params: {} };
  return normalizeIntentPlan(parsed);
}

async function narrateBiToolResult(userText, toolText, store, senderRole = '') {
  const narr = await callLLM(
    [
      {
        role: 'system',
        content: `你是门店BI助手。请把工具查询结果转成简洁可执行的中文回答。\n严格要求：\n1) 只能使用"工具结果"中出现的事实，不得新增数字或臆造菜品名称\n2) 结论先行，最多200字\n3) 保留关键口径（例如TOP/倒数、近N天）\n4) 若工具结果提示样本不足/暂无数据，直接如实说明，不要猜测\n5) 严格区分数据来源：桌访（table_visit_records）是门店服务员巡台记录，差评（bad_reviews）是大众点评/美团线上评价，不能混用"投诉""差评"等词描述桌访数据\n6) 桌访数据请用"桌访反馈""桌访不满意"等表述，差评数据才用"投诉""差评"等表述\n7) 禁止臆造菜品名称（如"卤鹅"等），只能使用工具结果中明确列出的菜品\n8) 如果工具结果为空或无具体菜品，必须明确说明"暂无数据"，不得编造示例`
      },
      {
        role: 'user',
        content: `用户问题：${String(userText || '')}\n门店：${String(store || '')}\n工具结果：\n${String(toolText || '')}`
      }
    ],
    {
      model: getBiReasoningModel(),
      temperature: 0.1,
      max_tokens: 260,
      skipCache: true,
      role: senderRole,
      purpose: 'reasoning'
    }
  );
  const content = String(narr?.content || '').trim();
  return content || toolText;
}

let _tryHandleBiByFunctionCalling;
async function tryHandleBiByFunctionCalling({ text, store, brand, senderRole, senderUsername }) {
  return _tryHandleBiByFunctionCalling({ text, store, brand, senderRole, senderUsername });
}

function resolveDateRangeFromQuestion(text, dd = 7) {
  const q = String(text||'').trim();
  const now = new Date(), today = new Date(now.getFullYear(),now.getMonth(),now.getDate()), ms = 86400000;
  const makeMonthRange = (year, month) => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    return { start: formatDate(first), end: formatDate(last) };
  };

  const monthRange = q.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(?:到|至|~|～|-|—)\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/);
  if (monthRange) {
    let sy = parseInt(monthRange[1] || String(now.getFullYear()), 10);
    const sm = parseInt(monthRange[2], 10);
    let ey = parseInt(monthRange[3] || String(sy), 10);
    const em = parseInt(monthRange[4], 10);
    if (!monthRange[3] && em < sm) ey += 1;
    const s = makeMonthRange(sy, sm);
    const e = makeMonthRange(ey, em);
    if (s && e) return { label: `${sy}年${sm}月-${ey}年${em}月`, start: s.start, end: e.end };
  }

  const dualMonth = q.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月[^0-9]{0,8}(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/);
  if (dualMonth) {
    let sy = parseInt(dualMonth[1] || String(now.getFullYear()), 10);
    const sm = parseInt(dualMonth[2], 10);
    let ey = parseInt(dualMonth[3] || String(sy), 10);
    const em = parseInt(dualMonth[4], 10);
    if (sm !== em) {
      if (!dualMonth[3] && em < sm) ey += 1;
      const s = makeMonthRange(sy, sm);
      const e = makeMonthRange(ey, em);
      if (s && e) return { label: `${sy}年${sm}月-${ey}年${em}月`, start: s.start, end: e.end };
    }
  }

  const singleMonth = q.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/);
  if (singleMonth && !/上[个]?月|本月/.test(q)) {
    const year = parseInt(singleMonth[1] || String(now.getFullYear()), 10);
    const month = parseInt(singleMonth[2], 10);
    const m = makeMonthRange(year, month);
    if (m) return { label: `${year}年${month}月`, start: m.start, end: m.end };
  }

  if (/今[天日]/.test(q)) return {label:'今日',start:formatDate(today),end:formatDate(today)};
  if (/昨[天日]/.test(q)) { const y=new Date(today-ms); return {label:'昨日',start:formatDate(y),end:formatDate(y)}; }
  if (/前[天日]/.test(q)) { const d=new Date(today-2*ms); return {label:'前天',start:formatDate(d),end:formatDate(d)}; }
  if (/上周/.test(q)) { const dow=today.getDay()||7; const m=new Date(today-(dow+6)*ms); return {label:'上周',start:formatDate(m),end:formatDate(new Date(+m+6*ms))}; }
  if (/本周/.test(q)) { const dow=today.getDay()||7; return {label:'本周',start:formatDate(new Date(today-(dow-1)*ms)),end:formatDate(today)}; }
  if (/上[个]?月/.test(q)) { const f=new Date(now.getFullYear(),now.getMonth(),1),l=new Date(f-ms),s=new Date(l.getFullYear(),l.getMonth(),1); return {label:'上月',start:formatDate(s),end:formatDate(l)}; }
  if (/本月/.test(q)) return {label:'本月',start:formatDate(new Date(now.getFullYear(),now.getMonth(),1)),end:formatDate(today)};
  const nm = q.match(/近\s*(\d+)\s*天/);
  if (nm) { const n=parseInt(nm[1],10)||dd; return {label:`近${n}天`,start:formatDate(new Date(today-(n-1)*ms)),end:formatDate(today)}; }
  return {label:`近${dd}天`,start:formatDate(new Date(today-(dd-1)*ms)),end:formatDate(today)};
}

function isFactLikeQuestion(text) {
  const q = String(text || '').trim();
  if (!q) return false;
  const hasFactTopic = /(营业额|营收|生意|经营情况|差评|桌访|开档|收档|例会|原料|kpi|考核指标|评分|门店|菜品|员工|姓名)/i.test(q);
  const hasQuestionPattern = /(多少|怎么样|如何|情况|对比|趋势|排名|top|为什么|分析|异常|有没有)/i.test(q);
  return hasFactTopic && hasQuestionPattern;
}

let _buildBiDeterministicDataSourceCoverageReply;
async function buildBiDeterministicDataSourceCoverageReply(text) {
  return _buildBiDeterministicDataSourceCoverageReply(text);
}


function resolveBiRelevantSourceKeys(text) {
  const q = String(text || '').trim();
  const keys = new Set();
  if (/(桌访|桌巡|巡台|巡桌|不满意.*菜|菜品.*不满意|最不满意|出品.*不满意)/.test(q)) {
    keys.add('table_visit_records');
    keys.add('table_visit_bitable');
  }
  if (/(差评|点评|评论|客诉)/.test(q)) {
    keys.add('bad_reviews');
  }
  if (/(开档|开市)/.test(q)) {
    keys.add('opening_reports_bitable');
  }
  if (/(收档|收市|闭市)/.test(q)) {
    keys.add('closing_reports_bitable');
  }
  if (/(例会|会议)/.test(q)) {
    keys.add('meeting_reports_bitable');
  }
  if (/(原料|收货)/.test(q)) {
    keys.add('material_majixian_bitable');
    keys.add('material_hongchao_bitable');
  }
  if (/(营业额|营收|收入|对账|毛利|损耗|成本|人效|KPI|kpi)/.test(q)) {
    keys.add('daily_reports');
  }
  if (/(堂食|外卖|销售明细|时段.*销|午市|晚市|热销|畅销|备货|菜品.*销量|点单)/.test(q)) {
    keys.add('pos_sales_detail');
    keys.add('inventory_forecast');
  }
  if (keys.size === 0 && isFactLikeQuestion(q)) {
    keys.add('daily_reports');
    keys.add('table_visit_records');
    keys.add('bad_reviews');
  }
  return Array.from(keys);
}

async function buildBiFactSourceAudit(store, text) {
  const keyDefs = {
    table_visit_records: {
      label: '桌访记录（系统入库）',
      sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM table_visit_records WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)]
    },
    table_visit_bitable: {
      label: '桌访表（飞书）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='table_visit' AND lower(regexp_replace(coalesce(agent_data->>'store', agent_data#>>'{fields,store}', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)]
    },
    bad_reviews: {
      label: '差评报告（同步）',
      sql: `SELECT COUNT(*)::int AS c, MAX(created_at)::text AS latest
            FROM agent_messages
            WHERE content_type='negative_review'
              AND lower(regexp_replace(coalesce(
                agent_data->>'store',
                agent_data#>>'{fields,store}',
                agent_data#>>'{fields,所属门店}',
                agent_data#>>'{fields,门店}',
                agent_data#>>'{fields,差评门店}',
                ''
              ), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)]
    },
    opening_reports_bitable: {
      label: '开档报告（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='opening_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)]
    },
    closing_reports_bitable: {
      label: '收档报告（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='closing_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)]
    },
    meeting_reports_bitable: {
      label: '例会报告（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='meeting_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)]
    },
    material_majixian_bitable: {
      label: '马己仙原料收货（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1 AND lower(coalesce(agent_data->>'brand','')) LIKE '%maji%'`,
      params: [normalizeStoreKey(store)]
    },
    material_hongchao_bitable: {
      label: '洪潮原料收货（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1 AND lower(coalesce(agent_data->>'brand','')) LIKE '%hong%'`,
      params: [normalizeStoreKey(store)]
    },
    daily_reports: {
      label: '营业日报（系统）',
      sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM daily_reports WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)]
    },
    pos_sales_detail: {
      label: '销售明细（pos_sales_detail）',
      sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM pos_sales_detail WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)]
    }
  };

  const relevant = resolveBiRelevantSourceKeys(text);
  const rows = [];
  for (const key of relevant) {
    const def = keyDefs[key];
    if (!def) continue;
    if (!isBiSourceEnabled(key)) {
      rows.push({ key, label: def.label, status: 'disabled', count: 0, latest: '-' });
      continue;
    }
    try {
      const r = await pool().query(def.sql, def.params);
      const c = Number(r.rows?.[0]?.c || 0);
      const latest = String(r.rows?.[0]?.latest || '').trim() || '-';
      rows.push({ key, label: def.label, status: c > 0 ? 'ok' : 'empty', count: c, latest });
    } catch (_e) {
      rows.push({ key, label: def.label, status: 'error', count: 0, latest: '-' });
    }
  }
  return rows;
}

function buildBiSourceAuditText(auditRows = []) {
  if (!Array.isArray(auditRows) || auditRows.length === 0) return '';
  const lines = auditRows.map((x) => {
    const statusText = x.status === 'ok'
      ? '可用'
      : x.status === 'empty'
        ? '空样本'
        : x.status === 'disabled'
          ? '已禁用'
          : '查询失败';
    return `- ${x.label}：${statusText}（count=${Number(x.count || 0)}, latest=${x.latest || '-'})`;
  });
  return lines.join('\n');
}

function buildFeishuCardFromAgentReply(route, resp) {
  if (!resp) return null;
  const t = {data_auditor:'小年',ops_supervisor:'小年',master:'小年'}[route] || '小年';
  const c = {data_auditor:'blue',ops_supervisor:'green',master:'indigo'}[route] || 'blue';
  return {config:{wide_screen_mode:true},header:{title:{content:t,tag:'plain_text'},template:c},elements:[{tag:'div',text:{content:String(resp),tag:'lark_md'}}]};
}

let _buildBiDeterministicTableVisitReply;
export async function buildBiDeterministicTableVisitReply(store, text) {
  return _buildBiDeterministicTableVisitReply(store, text);
}


let _buildBiDeterministicOpsReportCountReply;
async function buildBiDeterministicOpsReportCountReply(store, text) {
  return _buildBiDeterministicOpsReportCountReply(store, text);
}


// BI确定性回复：收档报告（得分、合格率）
let _buildBiDeterministicClosingReportReply;
async function buildBiDeterministicClosingReportReply(store, text) {
  return _buildBiDeterministicClosingReportReply(store, text);
}


// BI确定性回复：开档报告
let _buildBiDeterministicOpeningReportReply;
async function buildBiDeterministicOpeningReportReply(store, text) {
  return _buildBiDeterministicOpeningReportReply(store, text);
}


// BI确定性回复：原料收货日报（异常）
let _buildBiDeterministicMaterialReportReply;
async function buildBiDeterministicMaterialReportReply(store, text) {
  return _buildBiDeterministicMaterialReportReply(store, text);
}


// BI确定性回复：例会报告统计
let _buildBiDeterministicMeetingReportReply;
async function buildBiDeterministicMeetingReportReply(store, text) {
  return _buildBiDeterministicMeetingReportReply(store, text);
}


// BI确定性回复：营业日报（daily_reports 表）
let _buildBiDeterministicDailyReportReply;
async function buildBiDeterministicDailyReportReply(store, text) {
  return _buildBiDeterministicDailyReportReply(store, text);
}

let _buildBiDeterministicSalesRawTopReply;
async function buildBiDeterministicSalesRawTopReply(store, text) {
  return _buildBiDeterministicSalesRawTopReply(store, text);
}

// BI确定性回复：报损单统计
let _buildBiDeterministicLossReportReply;
async function buildBiDeterministicLossReportReply(store, text) {
  return _buildBiDeterministicLossReportReply(store, text);
}


let _buildBiDeterministicBadReviewReportReply;
async function buildBiDeterministicBadReviewReportReply(store, text) {
  return _buildBiDeterministicBadReviewReportReply(store, text);
}

// resolveModelProvider / loadTenantAiConfig / getLLMClientConfig → domains/ai/*

const _isProd = String(process.env.NODE_ENV || '').trim() === 'production';
const LARK_APP_ID = process.env.LARK_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : '');
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || '';
const _LARK_ENCRYPT_KEY = process.env.LARK_ENCRYPT_KEY || '';
const _LARK_VERIFICATION_TOKEN = process.env.LARK_VERIFICATION_TOKEN || '';

// Bitable Configuration - 支持多个配置
const BITABLE_CONFIGS = {
  'ops_checklist': {
    appId: process.env.BITABLE_OPS_APP_ID || 'cli_a91dae9f9578dcb1',
    appSecret: process.env.BITABLE_OPS_APP_SECRET || '',
    appToken: process.env.BITABLE_OPS_APP_TOKEN || 'PtVObRtoPaMAP3stIIFc8DnJngd',
    tableId: process.env.BITABLE_OPS_TABLE_ID || 'tblxHI9ZAKONOTpp',
    name: '运营检查表(含开收档)',
    type: 'checklist',
    pollingInterval: 60000,
    sortField: '["_id DESC"]'
  },
  'table_visit': {
    appId: process.env.BITABLE_TABLEVISIT_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_TABLEVISIT_APP_SECRET || '',
    appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_TABLEVISIT_TABLE_ID || 'tblpx5Efqc6eHo3L',
    name: '桌访表',
    type: 'table_visit',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'bad_reviews': {
    appId: process.env.BITABLE_TABLEVISIT_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_TABLEVISIT_APP_SECRET || '',
    appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: 'tblgReexNjWJOJB6',
    name: '差评报告DB',
    type: 'bad_review',
    pollingInterval: 300000,
    sortField: '["创建日期 DESC"]'
  },
  'closing_reports': {
    appId: process.env.BITABLE_CLOSING_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_CLOSING_APP_SECRET || '',
    appToken: process.env.BITABLE_CLOSING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_CLOSING_TABLE_ID || 'tblXYfSBRrgNGohN',
    name: '收档报告DB',
    type: 'closing_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'opening_reports': {
    appId: process.env.BITABLE_OPENING_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_OPENING_APP_SECRET || '',
    appToken: process.env.BITABLE_OPENING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_OPENING_TABLE_ID || 'tbl32E6d0CyvLvfi',
    name: '开档报告',
    type: 'opening_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'meeting_reports': {
    appId: process.env.BITABLE_MEETING_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_MEETING_APP_SECRET || '',
    appToken: process.env.BITABLE_MEETING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_MEETING_TABLE_ID || 'tblZXgaU0LpSye2m',
    name: '例会报告',
    type: 'meeting_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'material_majixian': {
    appId: process.env.BITABLE_MATERIAL_MJX_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_MATERIAL_MJX_APP_SECRET || '',
    appToken: process.env.BITABLE_MATERIAL_MJX_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_MATERIAL_MJX_TABLE_ID || 'tblz4kW1cY22XRlL',
    name: '马己仙原料收货日报',
    type: 'material_report',
    brand: 'majixian',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'material_hongchao': {
    appId: process.env.BITABLE_MATERIAL_HC_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_MATERIAL_HC_APP_SECRET || '',
    appToken: process.env.BITABLE_MATERIAL_HC_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_MATERIAL_HC_TABLE_ID || 'tbllcV1evqTJyzlN',
    name: '洪潮原料收货日报',
    type: 'material_report',
    brand: 'hongchao',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'loss_reports': {
    appId: process.env.BITABLE_LOSS_APP_ID || 'cli_a9fc0d13c838dcd6',
    appSecret: process.env.BITABLE_LOSS_APP_SECRET || '',
    appToken: process.env.BITABLE_LOSS_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_LOSS_TABLE_ID || 'tblLCxLO0ZbV7uyo',
    name: '报损单',
    type: 'loss_report',
    pollingInterval: 300000,
    sortField: '["创建日期 DESC"]'
  },
  'task_responses': {
    appId:
      process.env.BITABLE_TASK_RESP_APP_ID ||
      process.env.BITABLE_TABLEVISIT_APP_ID ||
      'cli_a9fc0d13c838dcd6',
    appSecret:
      process.env.BITABLE_TASK_RESP_APP_SECRET ||
      process.env.BITABLE_TABLEVISIT_APP_SECRET ||
      '',
    appToken: process.env.BITABLE_TASK_RESP_APP_TOKEN || 'BTAjbflrlaMRHesADUfc8usznqh',
    tableId: process.env.BITABLE_TASK_RESP_TABLE_ID || 'tblT86H1uuTJydne',
    name: '异常任务回复',
    type: 'task_response',
    pollingInterval: 60000,
    sortField: '["_id DESC"]'
  }
};

let BI_AGENT_CONFIG = {
  dataSources: [
    { key: 'daily_reports', enabled: true },
    { key: 'table_visit_records', enabled: true },
    { key: 'table_visit_bitable', enabled: true },
    { key: 'opening_reports_bitable', enabled: true },
    { key: 'closing_reports_bitable', enabled: true },
    { key: 'meeting_reports_bitable', enabled: true },
    { key: 'bad_reviews', enabled: true },
    { key: 'material_majixian_bitable', enabled: true },
    { key: 'material_hongchao_bitable', enabled: true },
    { key: 'ops_checklist_bitable', enabled: true },
    { key: 'loss_reports_bitable', enabled: true }
  ],
  anomalyTriggers: {
    global: {
      revenueGapMedium: 0.10,
      revenueGapHigh: 0.20,
      efficiencyMedium: 1100,
      efficiencyHigh: 1000,
      marginMedium: 0.69,
      marginHigh: 0.68,
      tableVisitProductMedium: 2,
      tableVisitProductHigh: 4,
      tableVisitRatioMedium: 0.5,
      tableVisitRatioHigh: 0.4,
      badReviewMedium: 1,
      badReviewHigh: 2,
      rechargeStreakHighDays: 2
    },
    storeOverrides: {}
  }
};

// 获取门店级别的异常阈值，门店覆盖 > 全局默认
function getStoreThreshold(storeName, key, fallback) {
  const triggers = BI_AGENT_CONFIG?.anomalyTriggers || {};
  const overrides = triggers.storeOverrides && typeof triggers.storeOverrides === 'object' ? triggers.storeOverrides : {};
  const storeConfig = overrides[storeName];
  if (storeConfig && storeConfig[key] !== undefined && storeConfig[key] !== null) {
    return Number(storeConfig[key]);
  }
  const globalConfig = triggers.global && typeof triggers.global === 'object' ? triggers.global : {};
  if (globalConfig[key] !== undefined && globalConfig[key] !== null) {
    return Number(globalConfig[key]);
  }
  return fallback;
}

async function refreshBiAgentRuntimeConfig() {
  try {
    const remote = await getBiAgentConfig();
    if (remote && typeof remote === 'object') {
      const remoteT = remote.anomalyTriggers || {};
      const localT = BI_AGENT_CONFIG?.anomalyTriggers || {};
      BI_AGENT_CONFIG = {
        ...BI_AGENT_CONFIG,
        ...remote,
        anomalyTriggers: {
          global: { ...(localT.global || {}), ...(remoteT.global || {}) },
          storeOverrides: { ...(localT.storeOverrides || {}), ...(remoteT.storeOverrides || {}) }
        }
      };
    }
  } catch (e) {
    log.error('[bi] refresh runtime config failed:', e?.message || e);
  }
}

function isBiSourceEnabled(key) {
  const list = Array.isArray(BI_AGENT_CONFIG?.dataSources) ? BI_AGENT_CONFIG.dataSources : [];
  const hit = list.find((x) => String(x?.key || '').trim() === String(key || '').trim());
  return hit ? hit.enabled !== false : true;
}

function getOpsReasoningModel() {
  const model = String(OPS_AGENT_CONFIG?.llmModels?.reasoningModel || '').trim();
  return model || DEEPSEEK_MODEL;
}

function getOpsVisionModel() {
  const model = String(OPS_AGENT_CONFIG?.llmModels?.visionModel || '').trim();
  if (model.startsWith('doubao-') || model.startsWith('ep-')) return model;
  return String(DEEPSEEK_VISION_MODEL || '').startsWith('doubao-') || String(DEEPSEEK_VISION_MODEL || '').startsWith('ep-') ? DEEPSEEK_VISION_MODEL : 'ep-20260424183833-7lr9g';
}

function getBiReasoningModel() {
  const model = String(BI_AGENT_CONFIG?.llmModels?.reasoningModel || '').trim();
  return model || DEEPSEEK_MODEL;
}

function formatChecklistTypeLabel(checkType) {
  return _opsChecklistCardsApi.formatChecklistTypeLabel(checkType);
}

/** 全角数字 → 半角，避免「１１２２３３」绕过测试过滤 */
function normalizeDigitsForOpsFilter(input) {
  return String(input || '').replace(/[\uFF10-\uFF19]/g, (ch) => String(ch.charCodeAt(0) - 0xff10));
}

/**
 * 测试/遗留 V1 巡检项：不注册定时器、不下发飞书（与 agents-service-v2 deterministic-replies 口径对齐）
 */
function isBlockedOpsChecklistPattern(checkType, taskKey = '') {
  const blob = normalizeDigitsForOpsFilter(`${checkType || ''}\n${taskKey || ''}`);
  const t = String(checkType || '').trim();
  if (/112233/i.test(blob)) return true;
  if (/测试\s*112233|112233\s*检查/i.test(blob)) return true;
  // 「测试 … 检查」且含 112233 的变体（空格/中间插入字）
  if (/测试/.test(t) && /检查/.test(t) && /112233/i.test(blob)) return true;
  if (/agent[\s_-]*v1/i.test(blob)) return true;
  if (/^test$/i.test(t) || /^测试$/i.test(t)) return true;
  return false;
}

/** 阻止 HRMS 定时「检查单」下发与 OPS-* master_tasks（默认关闭旧链路，仅保留 agents-v2 控制台下发） */
function shouldSkipHrmsScheduledChecklist(config) {
  const legacyEnable = String(process.env.HRMS_ENABLE_LEGACY_SCHEDULED_CHECKLIST || '').trim().toLowerCase();
  if (!(legacyEnable === '1' || legacyEnable === 'true' || legacyEnable === 'yes')) {
    return true;
  }
  const dis = String(process.env.HRMS_DISABLE_SCHEDULED_CHECKLIST || '').trim().toLowerCase();
  if (dis === '1' || dis === 'true' || dis === 'yes') {
    log.info('[ops] sendScheduledChecklist skipped (HRMS_DISABLE_SCHEDULED_CHECKLIST)');
    return true;
  }
  if (isBlockedOpsChecklistPattern(config?.checkType, config?.taskKey)) {
    log.info('[ops] sendScheduledChecklist skipped (test/legacy pattern):', config?.checkType, config?.taskKey || '');
    return true;
  }
  return false;
}

async function refreshOpsAgentRuntimeConfig() {
  try {
    const remote = await getOpsAgentConfig();
    if (remote && typeof remote === 'object') {
      OPS_AGENT_CONFIG = {
        ...OPS_AGENT_CONFIG,
        ...remote,
        scheduledTasks: {
          ...(OPS_AGENT_CONFIG?.scheduledTasks || {}),
          ...(remote?.scheduledTasks || {})
        }
      };
    }
  } catch (e) {
    log.error('[ops] refresh runtime config failed:', e?.message || e);
  }
}

// 向后兼容的默认配置
const _BITABLE_APP_ID = process.env.BITABLE_APP_ID || BITABLE_CONFIGS.ops_checklist.appId;
const _BITABLE_APP_SECRET = process.env.BITABLE_APP_SECRET || BITABLE_CONFIGS.ops_checklist.appSecret;
const _BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN || BITABLE_CONFIGS.ops_checklist.appToken;
const _BITABLE_TABLE_ID = process.env.BITABLE_TABLE_ID || BITABLE_CONFIGS.ops_checklist.tableId;

const _BRAND_ANALYSIS_CONFIG = {
  '洪潮': {
    marginTolerance: 0.01,
    scoreWeights: { quality: 0.4, cost: 0.3, response: 0.3 },
    label: '洪潮模式'
  },
  '马己仙': {
    marginTolerance: 0.02,
    scoreWeights: { efficiency: 0.4, cost: 0.4, execution: 0.2 },
    label: '马己仙模式'
  }
};

function normalizeBrandId(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

// 品牌配置兜底值：与 brand_configs 表里的 config_json.checklist 内容一致，
// 仅在DB缓存未就绪或查不到该品牌时使用，保证行为与改造前完全一致。
const BRAND_CONFIG = {
  '洪潮': {
    name: '洪潮',
    fullName: '洪潮传统潮汕菜',
    checkItems: {
      opening: ['地面清洁无积水', '所有设备正常开启', '食材新鲜度检查', '餐具消毒完成', '灯光亮度适中', '背景音乐开启', '空调温度设置合适', '员工仪容仪表检查'],
      closing: ['食材封存', '设备关闭', '垃圾清理', '安全检查', '门窗锁好']
    },
    standards: {
      quality: '高标准食材，新鲜度要求严格',
      service: '热情周到，响应及时',
      environment: '干净整洁，氛围舒适'
    }
  },
  '马己仙': {
    name: '马己仙',
    fullName: '马己仙',
    checkItems: {
      opening: ['地面清洁', '设备开启', '食材准备', '餐具消毒', '迎宾准备'],
      closing: ['食材封存', '设备关闭', '垃圾清理', '安全检查', '门窗锁好', '电源关闭']
    },
    standards: {
      quality: '精致料理，注重细节',
      service: '优雅服务，体验至上',
      environment: '高雅环境，品质生活'
    }
  }
};

function fallbackBrandConfigByName(brandName) {
  const name = String(brandName || '').trim();
  const brandKey = name.includes('马己仙') ? '马己仙' : '洪潮';
  const literal = BRAND_CONFIG[brandKey];
  const dbChecklist = getBrandConfigSync(brandKey, resolveTenantIdDefault())?.checklist;
  if (!dbChecklist) return literal;
  return {
    name: literal.name,
    fullName: literal.fullName,
    checkItems: {
      opening: dbChecklist.opening || literal.checkItems.opening,
      closing: dbChecklist.closing || literal.checkItems.closing
    },
    standards: dbChecklist.standards || literal.standards
  };
}

function getBrandsFromState(state0) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  const existing = Array.isArray(state?.brands) ? state.brands : [];
  const map = new Map();

  existing.forEach((b) => {
    const name = String(b?.name || b?.label || '').trim();
    const id = normalizeBrandId(b?.id || b?.brandId || name);
    if (!name || !id) return;
    map.set(id, {
      id,
      name,
      config: b?.config && typeof b.config === 'object' ? b.config : {}
    });
  });

  stores.forEach((s) => {
    const name = String(s?.brand || s?.brandName || '').trim();
    const id = normalizeBrandId(s?.brandId || name);
    if (!name || !id || map.has(id)) return;
    map.set(id, { id, name, config: {} });
  });

  return Array.from(map.values());
}

function getBrandRuntimeConfig(state0, brandContext) {
  const brandName = String(brandContext?.brandName || '').trim();
  const fallback = fallbackBrandConfigByName(brandName);
  const custom = brandContext?.brandConfig && typeof brandContext.brandConfig === 'object' ? brandContext.brandConfig : {};
  return {
    ...fallback,
    ...custom,
    scoreWeights: custom?.scoreWeights && typeof custom.scoreWeights === 'object'
      ? custom.scoreWeights
      : fallback.scoreWeights,
    sopKeypoints: Array.isArray(custom?.sopKeypoints) ? custom.sopKeypoints : []
  };
}

let _opsChecklistCardsApi;
let _opsChecklistProgress;

function buildOpsChecklistItemDetailCard(args) {
  return _opsChecklistCardsApi.buildOpsChecklistItemDetailCard(args);
}
function getOpsChecklistProgressKey(openId, checkType, storeName) {
  return _opsChecklistCardsApi.getOpsChecklistProgressKey(openId, checkType, storeName);
}
function countOpsChecklistCompleted(progress) {
  return _opsChecklistCardsApi.countOpsChecklistCompleted(progress);
}
function countOpsChecklistAbnormal(progress) {
  return _opsChecklistCardsApi.countOpsChecklistAbnormal(progress);
}
function buildOpsChecklistItemsCard(args) {
  return _opsChecklistCardsApi.buildOpsChecklistItemsCard(args);
}
function buildOpsChecklistAbnormalItemsCard(args) {
  return _opsChecklistCardsApi.buildOpsChecklistAbnormalItemsCard(args);
}
function detectOpsChecklistType(text) {
  return _opsChecklistCardsApi.detectOpsChecklistType(text);
}
function getOpsChecklistItems(checkType, storeName = '', brandName = '') {
  return _opsChecklistCardsApi.getOpsChecklistItems(checkType, storeName, brandName);
}
function buildOpsChecklistCard(args) {
  return _opsChecklistCardsApi.buildOpsChecklistCard(args);
}
function buildOpsChecklistTemplateText(args) {
  return _opsChecklistCardsApi.buildOpsChecklistTemplateText(args);
}

let _handleOpsChecklistCardAction;
async function handleOpsChecklistCardAction(event) {
  return _handleOpsChecklistCardAction(event);
}


export function resolveBrandContextByStore(state0, storeRef) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  const brands = getBrandsFromState(state);
  const byId = new Map(brands.map((b) => [String(b.id || ''), b]));
  const ref = String(storeRef || '').trim();
  const row = stores.find((s) => String(s?.id || '').trim() === ref || String(s?.name || '').trim() === ref) || null;
  const storeName = String(row?.name || ref || '').trim();
  const brandNameFromStore = String(row?.brand || row?.brandName || '').trim();
  const brandId = normalizeBrandId(row?.brandId || brandNameFromStore || inferBrandFromStoreName(storeName));
  const brand = byId.get(brandId) || null;
  const brandName = String(brand?.name || brandNameFromStore || inferBrandFromStoreName(storeName) || '').trim();
  const brandConfig = brand?.config && typeof brand.config === 'object' ? brand.config : {};
  return {
    storeId: String(row?.id || '').trim(),
    storeName,
    brandId,
    brandName,
    brandConfig
  };
}

// ─────────────────────────────────────────────
// 1. Database / Blackboard
// ─────────────────────────────────────────────

let _pool = null;
export function setPool(p) { 
  _pool = p; 
  setUnifiedAgentPool(p); // 同时设置统一数据库连接
}
export function pool() { 
  if (!_pool) throw new Error('agents: pool not set'); 
  return _pool; 
}

// Hook for Master Agent task response handler (set by master-agent.js to avoid circular import)
let _taskResponseHook = null;
export function setTaskResponseHook(fn) { _taskResponseHook = fn; }

export async function ensureAgentTables() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const runMig = async (name) => {
    const migrationFile = path.join(dir, 'migrations', name);
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    await pool().query(sql);
    log.info('[agents] Migration', name, 'applied successfully');
  };
  try {
    await runMig('005_agent_p0p2_tables.sql');
  } catch (e) {
    const code = String(e?.code || '');
    if (code !== '23505') log.error('[agents] ensureAgentTables 005 failed:', e?.message || e);
  }
  try {
    await runMig('010_hrms_perf_notifications.sql');
  } catch (e) {
    log.error('[agents] ensureAgentTables 010 failed:', e?.message || e);
  }
  try {
    await runMig('012_agent_scores_base_score.sql');
  } catch (e) {
    log.error('[agents] ensureAgentTables 012 failed:', e?.message || e);
  }
}

// ─────────────────────────────────────────────
// 2. LLM Helpers & Context Management
// ─────────────────────────────────────────────

// 上下文缓存：存储最近的对话历史
// M2-FIX: 添加最大用户数限制，防止内存泄漏
const _conversationContext = new Map();
const MAX_CONTEXT_LENGTH = 10;
const MAX_CONTEXT_USERS = 500;

// 响应缓存：避免重复调用LLM
const _responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

// 性能监控
const _performanceMetrics = {
  totalCalls: 0,
  cacheHits: 0,
  avgResponseTime: 0,
  errorCount: 0
};

function getCachedResponse(cacheKey) {
  const cached = _responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    _performanceMetrics.cacheHits++;
    return cached.response;
  }
  return null;
}

function setCachedResponse(cacheKey, response) {
  _responseCache.set(cacheKey, {
    response,
    timestamp: Date.now()
  });
  
  // 清理过期缓存
  if (_responseCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of _responseCache.entries()) {
      if (now - value.timestamp > CACHE_TTL) {
        _responseCache.delete(key);
      }
    }
  }
}

function updateContext(userId, role, content) {
  const contextKey = `${resolveTenantIdDefault()}::${String(userId || '').trim().toLowerCase()}`;
  if (!_conversationContext.has(contextKey)) {
    _conversationContext.set(contextKey, []);
  }
  const context = _conversationContext.get(contextKey);
  context.push({ role, content, timestamp: Date.now() });
  
  // 保持最近10轮对话
  if (context.length > MAX_CONTEXT_LENGTH) {
    context.shift();
  }
  
  // 清理过期上下文（1小时）
  const now = Date.now();
  while (context.length > 0 && now - context[0].timestamp > 3600000) {
    context.shift();
  }
  
  // M2-FIX: 限制总用户数，淘汰最旧的用户上下文
  if (_conversationContext.size > MAX_CONTEXT_USERS) {
    let oldestKey = null, oldestTime = Infinity;
    for (const [key, ctx] of _conversationContext.entries()) {
      const lastTs = ctx.length > 0 ? ctx[ctx.length - 1].timestamp : 0;
      if (lastTs < oldestTime) { oldestTime = lastTs; oldestKey = key; }
    }
    if (oldestKey) _conversationContext.delete(oldestKey);
  }
}

function getContext(userId) {
  const contextKey = `${resolveTenantIdDefault()}::${String(userId || '').trim().toLowerCase()}`;
  return _conversationContext.get(contextKey) || [];
}

function markQualityMetric(field, delta = 1) {
  if (!Object.prototype.hasOwnProperty.call(_agentQualityMetrics, field)) return;
  _agentQualityMetrics[field] = Number(_agentQualityMetrics[field] || 0) + Number(delta || 0);
  _agentQualityMetrics.lastUpdatedAt = new Date().toISOString();
}

async function getAgentLongMemory(userKey, memoryKey) {
  const u = String(userKey || '').trim().toLowerCase();
  const k = String(memoryKey || '').trim();
  if (!u || !k) return null;
  try {
    const r = await pool().query(
      `SELECT memory_value FROM agent_long_memory WHERE user_key = $1 AND memory_key = $2 LIMIT 1`,
      [u, k]
    );
    const row = r.rows?.[0];
    return row?.memory_value && typeof row.memory_value === 'object' ? row.memory_value : null;
  } catch (e) {
    return null;
  }
}

async function setAgentLongMemory(userKey, memoryKey, value) {
  const u = String(userKey || '').trim().toLowerCase();
  const k = String(memoryKey || '').trim();
  if (!u || !k) return;
  const payload = value && typeof value === 'object' ? value : { value: String(value || '') };
  try {
    await pool().query(
      `INSERT INTO agent_long_memory (user_key, memory_key, memory_value, created_at, updated_at, tenant_id)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW(), $4)
       ON CONFLICT (user_key, memory_key, tenant_id)
       DO UPDATE SET memory_value = EXCLUDED.memory_value, updated_at = NOW()`,
      [u, k, JSON.stringify(payload), resolveTenantIdDefault()]
    );
  } catch (e) {
    log.error('[agents] setAgentLongMemory failed:', e?.message || e);
  }
}

async function recordAgentQualityAudit({ route, username, queryText, responseText, auditResult, passed, rewriteCount = 0 }) {
  const auditId = randomUUID();
  let traceId = null;
  try {
    traceId = await recordAiInteraction(pool(), {
      source: 'agent_quality_audit',
      sourceRecordId: auditId,
      route,
      purpose: 'user_response',
      actorId: username,
      input: queryText,
      output: responseText,
      qualityMetrics: { ...(auditResult || {}), passed: passed === true, rewrite_count: rewriteCount },
    });
  } catch (e) {
    log.error('[agents] record AI interaction trace failed:', e?.message || e);
  }
  try {
    await pool().query(
      `INSERT INTO agent_quality_audits (id, route, username, query_text, response_text, audit_result, passed, rewrite_count, tenant_id, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [
        auditId,
        String(route || '').trim(),
        String(username || '').trim(),
        String(queryText || '').slice(0, 1000),
        String(responseText || '').slice(0, 4000),
        JSON.stringify(auditResult || {}),
        passed === true,
        Math.max(0, Number(rewriteCount) || 0),
        resolveTenantIdDefault(),
        traceId,
      ]
    );
  } catch (e) {
    log.error('[agents] recordAgentQualityAudit failed:', e?.message || e);
    try {
      await pool().query(
        `INSERT INTO agent_quality_audits (id, route, username, query_text, response_text, audit_result, passed, rewrite_count, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [auditId, String(route || '').trim(), String(username || '').trim(), String(queryText || '').slice(0, 1000),
          String(responseText || '').slice(0, 4000), JSON.stringify(auditResult || {}), passed === true,
          Math.max(0, Number(rewriteCount) || 0), resolveTenantIdDefault()]
      );
    } catch (fallbackError) {
      log.error('[agents] recordAgentQualityAudit legacy fallback failed:', fallbackError?.message || fallbackError);
    }
  }
  if (traceId) {
    try {
      await recordAiFeedback(pool(), {
        traceId,
        actorId: 'quality_gate',
        feedbackType: 'quality_audit',
        rating: passed === true ? 1 : -1,
        input: queryText,
        output: responseText,
        idempotencyKey: `quality-audit:${auditId}`,
      });
    } catch (e) {
      log.error('[agents] record AI quality feedback failed:', e?.message || e);
    }
  }
}

function buildAutonomousTaskFingerprint({ taskType, store, route, queryText }) {
  const raw = `${String(taskType || '').trim()}|${normalizeStoreKey(store)}|${String(route || '').trim()}|${normalizePlainText(queryText || '', 300)}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

async function createOrUpdateAutonomousDataTask({
  taskType,
  store,
  brand,
  requesterUsername,
  route,
  queryText,
  reason,
  evidence,
  ownerUsername,
  dueHours = 8
}) {
  const fingerprint = buildAutonomousTaskFingerprint({ taskType, store, route, queryText });
  try {
    const r = await pool().query(
      `INSERT INTO agent_autonomous_tasks (
         fingerprint, task_type, status, store, brand, requester_username, route,
         query_text, reason, evidence, action_plan, owner_username, notify_count, due_at, created_at, updated_at, tenant_id
       )
       VALUES (
         $1, $2, 'open', $3, $4, $5, $6,
         $7, $8, $9::jsonb, $10::jsonb, $11, 0, NOW() + make_interval(hours => $12), NOW(), NOW(), $13
       )
       ON CONFLICT (fingerprint, tenant_id)
       DO UPDATE SET
         reason = EXCLUDED.reason,
         evidence = EXCLUDED.evidence,
         owner_username = COALESCE(agent_autonomous_tasks.owner_username, EXCLUDED.owner_username),
         updated_at = NOW()
       RETURNING *`,
      [
        fingerprint,
        String(taskType || 'data_gap').trim() || 'data_gap',
        String(store || '').trim(),
        String(brand || '').trim(),
        String(requesterUsername || '').trim(),
        String(route || '').trim(),
        String(queryText || '').slice(0, 2000),
        String(reason || '').slice(0, 500),
        JSON.stringify(evidence || {}),
        JSON.stringify({ suggestedAction: '同步/补齐数据源后自动回访用户', createdBy: 'agent_autonomy' }),
        String(ownerUsername || '').trim(),
        Math.max(1, Math.min(72, Number(dueHours) || 8)),
        resolveTenantIdDefault()
      ]
    );
    markQualityMetric('autonomousTasks', 1);
    return r.rows?.[0] || null;
  } catch (e) {
    log.error('[agents] createOrUpdateAutonomousDataTask failed:', e?.message || e);
    return null;
  }
}

async function notifyAutonomousDataTaskOwner(task) {
  const t = task && typeof task === 'object' ? task : null;
  if (!t) return;
  const owner = String(t.owner_username || '').trim();
  if (!owner) return;
  try {
    const fu = await lookupFeishuUserByUsername(owner);
    if (!fu?.open_id) return;
    const msg = [
      `📌 自治任务提醒 [${t.task_type}]`,
      `门店：${t.store || '-'}`,
      `原因：${t.reason || '数据不足'}`,
      `用户问题：${String(t.query_text || '').slice(0, 120)}`,
      `请补齐数据源后在系统内关闭任务。`
    ].join('\n');
    await sendLarkMessage(fu.open_id, prefixWithAgentName('master', msg));
    await pool().query(
      `UPDATE agent_autonomous_tasks
       SET notify_count = COALESCE(notify_count, 0) + 1, updated_at = NOW()
       WHERE id = $1`,
      [t.id]
    );
  } catch (e) {
    log.error('[agents] notifyAutonomousDataTaskOwner failed:', e?.message || e);
  }
}

// sleep / isRetryableLLMError → domains/ai/llm-provider-helpers.js

// ── LLM Bridge for data-executor (避免循环依赖，延迟注入) ──
setTimeout(() => { try { setCallLLMBridge(callLLM); } catch (_) { /* ignore */ } }, 0);

// ── Tenant LLM config cache + callLLM / vision → domains/ai/* (wired at bottom) ──
let _invalidateTenantLlmConfigCache;
export function invalidateTenantLlmConfigCache(tenantId) {
  return _invalidateTenantLlmConfigCache(tenantId);
}

let _callLLM;
export async function callLLM(messages, options = {}) {
  return _callLLM(messages, options);
}

let _callVisionLLM;
export async function callVisionLLM(imageUrl, prompt, opts = {}) {
  return _callVisionLLM(imageUrl, prompt, opts);
}

let _callVisionLLMVideo;
export async function callVisionLLMVideo(videoUrl, prompt, opts = {}) {
  return _callVisionLLMVideo(videoUrl, prompt, opts);
}


async function getEmployeePositionForKb(username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return '';
  try {
    const state = await getSharedState();
    const employees = Array.isArray(state?.employees) ? state.employees : [];
    const users = Array.isArray(state?.users) ? state.users : [];
    const emp = employees.find((e) => String(e?.username || '').trim().toLowerCase() === u);
    const usr = users.find((x) => String(x?.username || '').trim().toLowerCase() === u);
    return String(emp?.position || usr?.position || '').trim();
  } catch (e) {
    return '';
  }
}

export async function queryKnowledgeBase(agent, query, limit = 5, options = {}) {
  // 委托给 RAG 多维知识库工具（兼容旧调用签名）
  try {
    let ragModule;
    try { ragModule = await import('./rag-tool.js'); } catch (e) { /* fallback below */ }
    if (ragModule?.ragQuery) {
      const agentName = Array.isArray(agent) ? 'sop_advisor' : String(agent || 'master_agent').trim();
      // 必须用用户问题检索 PDF 正文；旧逻辑在 agent 为数组时误用关键词拼接，导致 ILIKE 永远匹配不到上传内容
      const queryStr = Array.isArray(query)
        ? query.filter(Boolean).join(' ')
        : (String(query || '').trim() || (Array.isArray(agent) ? agent.filter(Boolean).join(' ') : String(agent || '')));
      const result = await ragModule.ragQuery({
        agentName,
        userRole: options?.userRole || 'admin',
        userStore: options?.userStore ?? '',
        userPosition: options?.userPosition ?? '',
        skipKnowledgeAudienceFilter: options?.skipKnowledgeAudienceFilter !== false,
        query: queryStr,
        brandTag: options?.brandTag,
        limit
      });
      return (result?.results || []).map((r) => ({
        title: r.title,
        content: r.content,
        tags: r.tags,
        created_at: r.createdAt
      }));
    }
    // fallback: 直接查询
    const brandTag = String(options?.brandTag || '').trim();
    const r = await pool().query(
      `SELECT title, content, tags, created_at FROM knowledge_base WHERE ($1 = '' OR tags && $1) AND (content ILIKE $2 OR title ILIKE $2) ORDER BY created_at DESC LIMIT $3`,
      [brandTag, `%${query}%`, limit]
    );
    return r.rows || [];
  } catch (e) {
    log.error('[agents] queryKnowledgeBase error:', e?.message);
    return [];
  }
}

// Query Bitable data for all agents
export async function queryBitableData(agent, query, limit = 10, options = {}) {
  try {
    const contentType = options?.contentType || '';
    const configKey = options?.configKey || '';
    
    let whereClause = `content_type IN ('bitable_submission', 'table_visit', 'vision_analysis')`;
    let params = [`%${query}%`, limit];
    
    if (contentType) {
      whereClause += ` AND content_type = $${params.length + 1}`;
      params.push(contentType);
    }
    
    if (configKey) {
      whereClause += ` AND agent_data::text ILIKE $${params.length + 1}`;
      params.push(`%"configKey":"${configKey}"%`);
    }
    
    const r = await pool().query(
      `SELECT content, content_type, agent_data, created_at, sender_name
       FROM agent_messages 
       WHERE ${whereClause} 
         AND (content ILIKE $1 OR agent_data::text ILIKE $1)
       ORDER BY created_at DESC 
       LIMIT $2`,
      params
    );
    
    return r.rows || [];
  } catch (e) {
    log.error('[agents] queryBitableData error:', e?.message);
    return [];
  }
}

// Unified query function for all agents
export async function queryAgentData(agent, query, limit = 10, options = {}) {
  const includeBitable = options?.includeBitable !== false;
  const includeKnowledge = options?.includeKnowledge !== false;
  
  const results = {
    knowledge: [],
    bitable: []
  };
  
  if (includeKnowledge) {
    results.knowledge = await queryKnowledgeBase(agent, query, limit, options);
  }
  
  if (includeBitable) {
    results.bitable = await queryBitableData(agent, query, limit, options);
  }
  
  return results;
}

// ─────────────────────────────────────────────
// 3. Shared State Helpers
// ─────────────────────────────────────────────

export async function getSharedState(tenantId = 'default') {
  const key = String(tenantId || '').trim() || 'default';
  const r = await pool().query('SELECT data FROM hrms_state WHERE key = $1 LIMIT 1', [key]);
  return r.rows?.[0]?.data && typeof r.rows[0].data === 'object' ? r.rows[0].data : {};
}

function findUserInState(state, username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  const all = [
    ...(Array.isArray(state?.employees) ? state.employees : []),
    ...(Array.isArray(state?.users) ? state.users : [])
  ];
  return all.find(x => String(x?.username || '').trim().toLowerCase() === u) || null;
}

export function getStoresFromState(state) {
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  return stores.map(s => ({
    id: String(s?.id || '').trim(),
    name: String(s?.name || '').trim(),
    brand: String(s?.brand || s?.brandName || '').trim(),
    brandId: normalizeBrandId(s?.brandId || s?.brand || s?.brandName)
  })).filter(s => s.name);
}

export function inferBrandFromStoreName(storeName) {
  return _inferBrandFromStoreNameImpl(storeName);
}

function resolveBrand(state, store) {
  const ctx = resolveBrandContextByStore(state, store);
  return ctx?.brandName || inferBrandFromStoreName(store) || '洪潮';
}

export async function findStoreManager(state, storeName) {
  const all = [
    ...(Array.isArray(state?.employees) ? state.employees : []),
    ...(Array.isArray(state?.users) ? state.users : [])
  ];
  const normalizedStoreName = normalizeStoreKey(storeName);
  const mgr = all.find(u =>
    normalizeStoreKey(u?.store) === normalizedStoreName &&
    String(u?.role || '').trim() === 'store_manager'
  );
  return mgr ? String(mgr.username || '').trim() : null;
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toDateOnly(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch (e) {
    return '';
  }
}

function inDateRangeInclusive(v, start, end) {
  const d = toDateOnly(v);
  if (!d) return false;
  const s = toDateOnly(start);
  const e = toDateOnly(end);
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}

function normProductKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeStoreKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

// 用于 SQL LIKE 的模糊门店匹配参数
function normalizeStoreLike(v) {
  return `%${normalizeStoreKey(v)}%`;
}

// 将飞书/外部门店名变体统一为系统标准名称（映射维护在 brands-config.js）
const STORE_CANONICAL_MAP = _STORE_CANONICAL_MAP_IMPL;
function normalizeCanonicalStoreName(store) {
  if (!store) return store;
  const s = store.trim();
  for (const entry of STORE_CANONICAL_MAP) {
    for (const kw of entry.keywords) {
      if (new RegExp(kw, 'i').test(s)) return entry.canonical;
    }
  }
  return s;
}

function normalizeStoreAliasKey(v) {
  return normalizeStoreKey(v).replace(/(上海|北京|深圳|广州|大宁|门店|店铺|店|商场|广场|购物中心)/g, '');
}

function isExactSameStore(a, b) {
  return normalizeStoreKey(a) && normalizeStoreKey(a) === normalizeStoreKey(b);
}

function isLikelySameStore(a, b) {
  const x = normalizeStoreKey(a);
  const y = normalizeStoreKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const ax = normalizeStoreAliasKey(a);
  const by = normalizeStoreAliasKey(b);
  if (ax && by && (ax === by || ax.includes(by) || by.includes(ax))) return true;
  return false;
}

function normalizeBitableDateValue(v, fallback = '') {
  if (v === null || v === undefined || v === '') return toDateOnly(fallback);
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    return toDateOnly(new Date(ms).toISOString());
  }
  const s = String(v || '').trim();
  if (!s) return toDateOnly(fallback);
  if (/^\d{13}$/.test(s) || /^\d{10}$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) {
      const ms = s.length === 13 ? n : n * 1000;
      return toDateOnly(new Date(ms).toISOString());
    }
  }
  return toDateOnly(s) || toDateOnly(fallback);
}

// 从飞书多维表格的复杂字段值中提取纯文本
// 支持格式: string, [{text_arr:[...]}, ...], [{text:"..."}], array等
function extractBitableFieldText(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    const parts = [];
    for (const item of val) {
      if (typeof item === 'string') { parts.push(item); continue; }
      if (item && typeof item === 'object') {
        if (Array.isArray(item.text_arr) && item.text_arr.length) {
          parts.push(...item.text_arr.map(t => String(t || '').trim()).filter(Boolean));
        } else if (item.text) {
          parts.push(String(item.text).trim());
        }
      }
    }
    return parts.join('，').trim();
  }
  if (typeof val === 'object' && val.text) return String(val.text).trim();
  return String(val).trim();
}

// 从飞书 fields 中按优先级提取桌访不满意菜品字段
function extractDissatisfactionDishFromFields(fields) {
  // 优先级：精确匹配 > 模糊匹配
  const candidates = [
    fields['今天不满意的菜品'],
    fields['今天 不满意菜品'],        // 实际飞书字段名(有空格)
    fields['今天不满意菜品'],          // 无空格变体
    fields['今日不满意菜品'],          // 旧代码变体
    fields['不满意菜品'],
    fields['不满意菜品/问题'],
  ];
  for (const v of candidates) {
    const text = extractBitableFieldText(v);
    if (text) return text;
  }
  return '';
}

// 从飞书 fields 中提取不满意原因
function extractDissatisfactionReasonFromFields(fields) {
  const candidates = [
    fields['不满意的主要原因是什么'],
    fields['不满意的主要原因'],
    fields['满意/不满意的主要原因'],
    fields['满意或不满意的主要原因是什么？'],
    fields['满意或不满意的主要原因'],
    fields['不满意项'],
    fields['不满意原因'],
    fields['备注'],
  ];
  for (const v of candidates) {
    const text = extractBitableFieldText(v);
    if (text) return text;
  }
  return '';
}

function extractTableVisitItems(row) {
  const dishText = String(row?.dissatisfaction_dish || '').trim();
  const _reasonText = String(row?.unsatisfied_items || '').trim();

  const dishItems = dishText
    ? dishText
        .split(/[，,、\/;；|\n\r\t\s]+/)
        .map((k) => String(k || '').trim())
        .filter(Boolean)
    : [];

  // 只用dissatisfaction_dish统计产品投诉，unsatisfied_items是原因描述不是菜品名
  return dishItems.filter((x) => x && !/卤鹅/.test(String(x)));
}

let _tableVisitMetricsApi;
let _marginMetricsApi;

function extractTableVisitDishes(row) {
  return _tableVisitMetricsApi.extractTableVisitDishes(row);
}

async function loadUnifiedTableVisitRowsByStore(store, startDate, endDate) {
  return _tableVisitMetricsApi.loadUnifiedTableVisitRowsByStore(store, startDate, endDate);
}

async function loadTableVisitMetricsByStore(store, startDate, endDate) {
  return _tableVisitMetricsApi.loadTableVisitMetricsByStore(store, startDate, endDate);
}

async function estimateMarginMetricsForRange(args) {
  return _marginMetricsApi.estimateMarginMetricsForRange(args);
}

async function resolveTrustedNetMarginForAuditorIssue(storeName, startDate, endDate) {
  return _marginMetricsApi.resolveTrustedNetMarginForAuditorIssue(storeName, startDate, endDate);
}


// ─────────────────────────────────────────────
// 4. Feishu Client
// ─────────────────────────────────────────────

// 获取飞书租户token；tenantId 有独立配置的 feishu_bot(app_id/app_secret) 就用租户自己的应用身份，
// 否则回退到平台全局 LARK_APP_ID/LARK_APP_SECRET（历史行为，向后兼容不传tenantId的调用方）
export async function getLarkTenantToken(tenantId) {
  // 未显式传tenantId时，跟随当前 AsyncLocalStorage 租户上下文（跟RLS用的是同一套上下文），
  // 这样绝大多数已经跑在 tenantContext.run(tenantId, ...) 里的业务调用（审批提醒/检查表提醒等）
  // 不需要逐个调用点手动传tenantId也能自动按租户选择飞书应用；没有任何租户上下文时(或该租户未
  // 配置feishu_bot)才回退到平台全局应用，行为与改造前一致。
  return getTenantLarkToken(resolveTenantIdDefault(tenantId), {
    pool: pool(),
    encryptionKey: String(process.env.TENANT_INTEGRATION_ENCRYPTION_KEY || '').trim(),
    globalAppId: LARK_APP_ID,
    globalAppSecret: LARK_APP_SECRET
  });
}

let _bitableRecordsClient;
async function getBitableTenantToken(configKey = 'ops_checklist') {
  return _bitableRecordsClient.getBitableTenantToken(configKey);
}

export async function getBitableRecords(configKey = 'ops_checklist', options = {}) {
  return _bitableRecordsClient.getBitableRecords(configKey, options);
}

export async function getBitableRecordImageDownloadUrl(configKey = 'ops_checklist', fileToken) {
  return _bitableRecordsClient.getBitableRecordImageDownloadUrl(configKey, fileToken);
}


let _processBitableData;
export async function processBitableData(configKey, records) {
  return _processBitableData(configKey, records);
}


let _archiveOldBitableSubmissions;
export async function archiveOldBitableSubmissions() {
  return _archiveOldBitableSubmissions();
}


let _getBitableSubmissionStats;
export async function getBitableSubmissionStats() {
  return _getBitableSubmissionStats();
}


// ─────────────────────────────────────────────
// Bitable Integration for Checklist (continued)

const _bitableLastProcessedTime = new Map();
const _bitableProcessedRecordIds = new Set();
const BITABLE_DEDUP_MAX_KEYS = 30000;
const BITABLE_DEDUP_CLEAN_COUNT = 8000;
let _bitableDedupsSeeded = false;

// 启动时从数据库种子化dedup集合，避免重启后重复发送确认消息
async function seedBitableDedup() {
  if (_bitableDedupsSeeded) return;
  _bitableDedupsSeeded = true;
  try {
    const r = await pool().query(
      `SELECT record_id, table_id, MAX(updated_at) AS updated_at
       FROM feishu_generic_records
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY record_id, table_id
       LIMIT 20000`
    );
    const tableIdToConfigKeys = new Map();
    for (const [key, cfg] of Object.entries(BITABLE_CONFIGS)) {
      const tableId = String(cfg?.tableId || '').trim();
      if (!tableId) continue;
      if (!tableIdToConfigKeys.has(tableId)) tableIdToConfigKeys.set(tableId, []);
      tableIdToConfigKeys.get(tableId).push(key);
    }
    const fallbackKeys = Object.keys(BITABLE_CONFIGS).filter((k) => BITABLE_CONFIGS[k]?.type !== 'task_response');
    for (const row of (r.rows || [])) {
      const recordId = String(row?.record_id || '').trim();
      if (!recordId) continue;
      const tableId = String(row?.table_id || '').trim();
      const configKeys = tableIdToConfigKeys.get(tableId) || fallbackKeys;
      const rowMs = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
      const safeMs = Number.isFinite(rowMs) ? rowMs : 0;
      for (const key of configKeys) {
        const pk = `${key}_${recordId}`;
        _bitableProcessedRecordIds.add(pk);
        _bitableLastProcessedTime.set(pk, safeMs);
      }
    }
    log.info(`[bitable] seeded dedup set with ${_bitableProcessedRecordIds.size} keys from DB`);
  } catch (e) {
    log.error('[bitable] seed dedup failed:', e?.message);
  }
}

let _pollBitableSubmissions;
export async function pollBitableSubmissions(configKey = 'ops_checklist') {
  return _pollBitableSubmissions(configKey);
}

// 多配置轮询调度器
export async function pollAllBitableSubmissions() {
  const preferredOrder = [
    'ops_checklist',
    'bad_reviews',
    'closing_reports',
    'opening_reports',
    'meeting_reports',
    'material_majixian',
    'material_hongchao',
    'table_visit'
  ];
  const known = new Set(preferredOrder);
  const finalKeys = [
    ...preferredOrder.filter((k) => BITABLE_CONFIGS[k]),
    ...Object.keys(BITABLE_CONFIGS).filter((k) => !known.has(k) && BITABLE_CONFIGS[k]?.type !== 'task_response')
  ];
  for (const configKey of finalKeys) {
    try {
      await pollBitableSubmissions(configKey);
    } catch (e) {
      log.error(`[bitable][${configKey}] poll error:`, e?.message);
    }
    await new Promise(r => setImmediate(r));
  }
}

// ─────────────────────────────────────────────
// Task Response via Bitable Collection Form → domains/feishu-bitable/task-response*
// ─────────────────────────────────────────────
let _taskResponseApi;
function taskResponseApi() {
  if (!_taskResponseApi) {
    _taskResponseApi = createTaskResponseApi({
      pool,
      axios,
      bitableConfigs: BITABLE_CONFIGS,
      getBitableTenantToken,
      getBitableRecordImageDownloadUrl,
      extractBitableFieldText,
      getTaskResponseHook: () => _taskResponseHook,
    });
  }
  return _taskResponseApi;
}

export async function ensureTaskResponseBitable() {
  return taskResponseApi().ensureTaskResponseBitable();
}
export async function createBitableRecord(configKey, fields) {
  return taskResponseApi().createBitableRecord(configKey, fields);
}
export async function updateBitableRecord(configKey, recordId, fields) {
  return taskResponseApi().updateBitableRecord(configKey, recordId, fields);
}
export async function writeTaskToBitable(task) {
  return taskResponseApi().writeTaskToBitable(task);
}
export function getTaskResponseFormUrl(task) {
  return taskResponseApi().getTaskResponseFormUrl(task);
}
export function buildTaskDispatchCard(task, formUrl, opts) {
  return taskResponseApi().buildTaskDispatchCard(task, formUrl, opts);
}
export async function pollTaskResponseBitable() {
  return taskResponseApi().pollTaskResponseBitable();
}

// 导出定时任务函数
export { startScheduledTasks };

// ─────────────────────────────────────────────
// 定时任务调度器
// ─────────────────────────────────────────────

/** 与 agents-service-v2 任务审核口径一致（仅 HRMS 内建调度启用时使用） */
const OPS_TASK_REPLY_AUDIT_LARK_MD =
  '**系统审核要求**\n' +
  '• 文字 **≥20 字**，或 **附现场照片**（满足其一可通过基础规则）\n' +
  '• 须说明 **现场情况**、**处理措施**；抽检/巡检类须写 **发现与处理结果**\n' +
  '• 勿仅用「收到」「无」「OK」等占位回复（易被退回；累计 3 次不合格记入绩效）';

let _scheduledTaskIntervals = new Map();
const _scheduledTaskRuntimeStatus = new Map();

let _buildScheduledTasksFromConfig;
function buildScheduledTasksFromConfig() {
  return _buildScheduledTasksFromConfig();
}


function getInspectionIntervalDays(config) {
  const frequency = String(config?.frequency || 'daily').trim();
  if (frequency === 'weekly') return 7;
  if (frequency === 'biweekly') return 14;
  if (frequency === 'monthly') return 30;
  if (frequency === 'custom') return Math.max(1, Math.floor(Number(config?.customIntervalDays) || 1));
  return 1;
}

export function getScheduledTaskStatus() {
  const tasks = Array.from(_scheduledTaskRuntimeStatus.entries()).map(([taskKey, status]) => ({
    taskKey,
    ...status
  }));
  return {
    started: _scheduledTaskIntervals.size > 0,
    activeTimers: _scheduledTaskIntervals.size,
    tasks
  };
}

async function startScheduledTasks() {
  log.info('[ops] starting scheduled tasks...');
  await refreshOpsAgentRuntimeConfig();
  const runtimeTasks = buildScheduledTasksFromConfig();
  
  // 清除现有定时器
  for (const [, timer] of _scheduledTaskIntervals) {
    clearTimeout(timer);
  }
  _scheduledTaskIntervals.clear();
  _scheduledTaskRuntimeStatus.clear();
  
  // 设置定时任务
  for (const [taskKey, config] of Object.entries(runtimeTasks)) {
    _scheduledTaskRuntimeStatus.set(taskKey, {
      taskKey,
      action: config.action,
      nextExecutionAt: null,
      lastRunAt: null,
      runCount: 0,
      lastError: null
    });
    if (config.random) {
      // 随机任务
      scheduleRandomTask(taskKey, config);
    } else {
      // 定时任务
      scheduleFixedTask(taskKey, config);
    }
  }
}

function scheduleFixedTask(taskKey, config) {
  const [hour, minute] = config.time.split(':').map(Number);
  const intervalDays = getInspectionIntervalDays(config);

  const scheduleNext = () => {
    const now = new Date();
    // 配置时间是CST(+08:00)，正确转换
    const cst = new Date(now.toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));
    const ds = `${cst.getFullYear()}-${String(cst.getMonth()+1).padStart(2,'0')}-${String(cst.getDate()).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`;
    let nextExecution = new Date(ds);
    
    // 如果CST时间已过，按频率顺延
    if (nextExecution.getTime() <= now.getTime()) {
      nextExecution = new Date(nextExecution.getTime() + intervalDays * 86400000);
    }
    
    const msUntilExecution = nextExecution.getTime() - now.getTime();
    const status = _scheduledTaskRuntimeStatus.get(taskKey);
    if (status) {
      status.nextExecutionAt = nextExecution.toISOString();
      _scheduledTaskRuntimeStatus.set(taskKey, status);
    }
    
    const timer = setTimeout(() => {
      executeScheduledTask(taskKey, config);
      scheduleNext(); // 递归调度下一次
    }, msUntilExecution);
    _scheduledTaskIntervals.set(taskKey, timer);
    
    log.info(`[ops] scheduled ${taskKey} for: ${nextExecution.toISOString()}`);
  };
  
  scheduleNext();
}

function scheduleRandomTask(taskKey, config) {
  const [minHours, maxHours] = config.interval;
  
  const scheduleNext = () => {
    const intervalHours = minHours + Math.random() * (maxHours - minHours);
    let nextExecution = new Date(Date.now() + intervalHours * 3600000);
    // 确保在工作时间08:00-23:00 CST内执行，否则推到次日08:00+随机偏移
    const cstH = Number(nextExecution.toLocaleString('en-US',{timeZone:'Asia/Shanghai',hour:'numeric',hour12:false}));
    if (cstH < 8 || cstH >= 23) {
      // 计算推迟到下一个CST 08:00的毫秒数（纯UTC算术，避免setHours混淆CST/UTC）
      const hoursUntilNext = cstH >= 23 ? (24 - cstH + 8) : (8 - cstH);
      const baseNext = new Date(nextExecution.getTime() + hoursUntilNext * 3600000);
      // 对齐到整点（清掉分秒）
      baseNext.setMinutes(0, 0, 0);
      nextExecution = new Date(baseNext.getTime() + Math.random() * 6 * 3600000);
    }
    const intervalMs = nextExecution.getTime() - Date.now();
    const status = _scheduledTaskRuntimeStatus.get(taskKey);
    if (status) {
      status.nextExecutionAt = nextExecution.toISOString();
      _scheduledTaskRuntimeStatus.set(taskKey, status);
    }
    
    const timer = setTimeout(() => {
      executeScheduledTask(taskKey, config);
      scheduleNext(); // 递归调度下一次
    }, intervalMs);
    _scheduledTaskIntervals.set(taskKey, timer);
    
    log.info(`[ops] scheduled random ${taskKey} for: ${nextExecution.toISOString()} (interval: ${intervalHours}h)`);
  };
  
  scheduleNext();
}

let _executeScheduledTask;
async function executeScheduledTask(taskKey, config) {
  return _executeScheduledTask(taskKey, config);
}


let _sendScheduledChecklist;
export async function sendScheduledChecklist(config) {
  return _sendScheduledChecklist(config);
}


let _sendSafetyCheck;
async function sendSafetyCheck(config) {
  return _sendSafetyCheck(config);
}


// 辅助函数：从AI回复中提取分数
function extractScore(text) {
  if (!text) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*10|评分[：:]\s*(\d+(?:\d+)?)/i);
  return match ? parseFloat(match[1] || match[2]) : 0;
}

// 照片真实性验证
async function validatePhotoAuthenticity(imageUrl, expectedLocation, submitTime) {
  log.info('[ops] validating photo authenticity...');
  
  try {
    // 1. 调用视觉 AI 分析照片内容
    const visionResult = await callVisionLLM([
      { type: 'image', image_url: imageUrl },
      { type: 'text', text: `请分析这张照片：1.拍摄地点是否为${expectedLocation} 2.照片中的环境特征 3.是否有时间显示 4.照片真实性评估` }
    ]);
    
    // 2. 模拟 EXIF 和 GPS 验证（实际需要更复杂的实现）
    const now = Date.now();
    const timeDiff = Math.abs(now - submitTime);
    const isTimeValid = timeDiff < 5 * 60 * 1000; // 5分钟内
    
    // 3. 照片 Hash 简单验证（实际需要更复杂的实现）
    const photoHash = imageUrl.split('/').pop(); // 简化实现
    const isDuplicate = await checkPhotoDuplicate(photoHash);
    
    const validation = {
      isAuthentic: isTimeValid && !isDuplicate,
      timeValid: isTimeValid,
      notDuplicate: !isDuplicate,
      locationMatch: visionResult.content?.includes(expectedLocation) || false,
      confidence: 0.8 // 简化实现
    };
    
    log.info('[ops] photo validation result:', validation);
    return validation;
  } catch (e) {
    log.error('[ops] photo validation failed:', e?.message);
    return { isAuthentic: false, error: e?.message };
  }
}

// 检查照片重复
async function checkPhotoDuplicate(photoHash) {
  try {
    const result = await pool().query(
      'SELECT COUNT(*) as count FROM agent_messages WHERE content_type LIKE %image% AND agent_data::text ILIKE $1',
      [`%${photoHash}%`]
    );
    return (result.rows[0]?.count || 0) > 1;
  } catch (e) {
    log.error('[ops] check duplicate failed:', e?.message);
    return false;
  }
}

// 强化催办逻辑
async function handleTaskEscalation(taskId, assignee, taskType, overdueMinutes) {
  log.info(`[ops] handling escalation for task ${taskId}, overdue: ${overdueMinutes}min`);
  
  let escalationLevel = 'reminder';
  let message = '';
  
  if (overdueMinutes >= 60) {
    escalationLevel = 'performance_mark';
    message = `⚠️ 任务超时 ${overdueMinutes} 分钟，已标记绩效问题\n任务ID: ${taskId}\n请立即处理！`;
    
    // 标记绩效问题
    try {
      await pool().query(
        `INSERT INTO agent_messages (direction, channel, content_type, content, agent_data, tenant_id)
         VALUES ('system','feishu','performance_issue',$1,$2::jsonb,$3)`,
        [`任务响应迟缓 - ${taskType}`, JSON.stringify({ taskId, assignee, overdueMinutes }), resolveTenantIdDefault()]
      );
    } catch (e) { /* ignore */ }
    
  } else if (overdueMinutes >= 15) {
    escalationLevel = 'strong_reminder';
    message = `🔔 任务已超时 ${overdueMinutes} 分钟\n任务ID: ${taskId}\n请尽快处理！`;
  } else {
    message = `💡 温馨提醒：任务待处理\n任务ID: ${taskId}`;
  }
  
  // 发送催办消息
  if (assignee?.id) {
    await sendLarkMessage(assignee.id, prefixWithAgentName('ops_supervisor', message));
  }
  
  return { escalationLevel, message };
}

// 逻辑纠偏检查
async function validateSubmissionLogic(submission) {
  log.info('[ops] validating submission logic...');
  
  const issues = [];
  
  // 1. 检查数据逻辑一致性
  if (submission.checkType === '开档检查' && submission.checkStatus === '不合格') {
    if (!submission.checkRemark || submission.checkRemark.length < 10) {
      issues.push('不合格项需要详细说明原因');
    }
  }
  
  // 2. 检查照片与描述的一致性
  if (submission.checkPhotos && submission.checkPhotos.length > 0) {
    if (submission.checkRemark.includes('干净') && submission.checkPhotos.length === 0) {
      issues.push('描述环境干净但未提供照片验证');
    }
  }
  
  // 3. 检查时间逻辑
  const submitHour = new Date(submission.submitTime).getHours();
  if (submission.checkType === '开档检查' && (submitHour < 8 || submitHour > 12)) {
    issues.push('开档检查时间异常，应在上午8-12点进行');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    suggestion: issues.length > 0 ? `检测到以下问题：${issues.join('；')}。请核实后重新提交。` : ''
  }
}

/** 档案绩效展示周期：每月 10 日（上海）起展示上月整月；10 日前仍展示上上月（冻结） */
function profilePerformanceDisplayPeriodShanghai() {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const pad = (n) => String(n).padStart(2, '0');
  const subMonth = (yy, mm, delta) => {
    let M = mm + delta;
    let Y = yy;
    while (M < 1) {
      M += 12;
      Y -= 1;
    }
    while (M > 12) {
      M -= 12;
      Y += 1;
    }
    return `${Y}-${pad(M)}`;
  };
  if (d >= 10) return subMonth(y, m, -1);
  return subMonth(y, m, -2);
}

/**
 * 飞书绩效类文本统一中文化：内部字段名、模型 key、英文「分」→「级」、通知标题改名
 */
export function sanitizePerformanceZhText(text) {
  if (typeof text !== 'string' || !text) return text;
  if (!/(绩效|考核|评分|总分|扣分明细|store_rating|execution_rating|attitude_rating|ability_rating|new_model|anomaly_rollups|task_reminder|模型|门店级别|门店评级)/i.test(text)) {
    return text;
  }
  let t = text;
  t = t.replace(/📊\s*绩效考核通知/g, '📊 绩效考核周报');
  t = t.replace(/(^|[\n\u200b])绩效考核通知/g, '$1绩效考核周报');
  t = t.replace(/📊\s*绩效考核日报/g, '📊 绩效考核周报');
  t = t.replace(/(^|[\n\u200b])绩效考核日报/g, '$1绩效考核周报');
  t = t.replace(/📋\s*模型[：:]\s*`?new_model_monthly`?/gi, '📋 评分类型：月度自动评分');
  t = t.replace(/📋\s*模型[：:]\s*`?new_model`?/gi, '📋 评分类型：人力资源综合模型');
  t = t.replace(/\*\*📋\s*模型\*\*\s*[：:]\s*`?new_model_monthly`?/gi, '**📋 评分类型**：月度自动评分');
  t = t.replace(/\bnew_model_monthly\b/g, '月度自动评分');
  t = t.replace(/\bnew_model\b/g, '人力资源综合模型');
  t = t.replace(/\banomaly_rollups_v2\b/g, '周度异常汇总');
  t = t.replace(/\btask_reminder_v1\b/g, '任务催办绩效记录');
  t = t.replace(/\bmonthly_anomaly_bonus_v1\b/g, '月度异常免罚加分');
  t = t.replace(/\bstore_production_manager\b/g, '出品经理');
  t = t.replace(/\bstore_manager\b/g, '店长');
  t = t.replace(/\bstore_rating\b\s*[:：]\s*null\b/gi, '门店级别：待评估');
  t = t.replace(/\bstore_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '门店级别：$1级');
  t = t.replace(/\bstore_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '门店级别：$1级');
  t = t.replace(/\bexecution_rating\b\s*[:：]\s*'?(待定)'?\s*分?\b/gi, '执行力：$1');
  t = t.replace(/\bexecution_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '执行力：$1级');
  t = t.replace(/\bexecution_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '执行力：$1级');
  t = t.replace(/\battitude_rating\b\s*[:：]\s*'?(待定)'?\s*分?\b/gi, '工作态度：$1');
  t = t.replace(/\battitude_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '工作态度：$1级');
  t = t.replace(/\battitude_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '工作态度：$1级');
  t = t.replace(/\bability_rating\b\s*[:：]\s*'?(待定)'?\s*分?\b/gi, '工作能力：$1');
  t = t.replace(/\bability_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '工作能力：$1级');
  t = t.replace(/\bability_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '工作能力：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*store_rating\s*[:：]\s*null\s*$/gim, '• 门店级别：待评估');
  t = t.replace(/^[ \t]*[•\-*]\s*store_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 门店级别：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*ability_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 工作能力：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*attitude_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 工作态度：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*execution_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 执行力：$1级');
  return t;
}

function deepSanitizeFeishuCardStrings(node, fn) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = fn(node[i]);
      else deepSanitizeFeishuCardStrings(node[i], fn);
    }
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') node[k] = fn(v);
      else deepSanitizeFeishuCardStrings(v, fn);
    }
  }
}

/**
 * 档案「门店级别」：默认取上月闭合月；若传入 lockedPeriodYm 则只查该月（不回落到「任意最新」，与档案冻结展示一致）
 */
let _fetchStoreRatingForProfileDisplay;
export async function fetchStoreRatingForProfileDisplay(storeLabel, lockedPeriodYm = null) {
  return _fetchStoreRatingForProfileDisplay(storeLabel, lockedPeriodYm);
}


function feishuOpenIdResolveDeps() {
  return {
    query: (sql, params) => pool().query(sql, params),
    warn: (...args) => log.warn(...args),
    info: (...args) => log.info(...args)
  };
}

// ─────────────────────────────────────────────
// Send plain text message to a user by open_id
export async function sendLarkMessage(openId, text, options = {}) {
  if (typeof text === 'string' && /绩效|考核|评分|总分|扣分明细|store_rating|模型/.test(text)) {
    text = sanitizePerformanceZhText(text);
  }
  // 消息去重检查（BI确定性回复跳过去重，因为用户可能重复查同一指标）
  if (!options.skipDedup && !deduplicateMessage(text, openId)) {
    return { ok: true, deduplicated: true };
  }

  const token = await getLarkTenantToken(options.tenantId);
  if (!token) {
    log.error('[feishu] cannot send: no token');
    return { ok: false, error: 'no_token' };
  }

  const deps = feishuOpenIdResolveDeps();
  const postTextOnce = async (rid) => {
    const ridTrim = String(rid || '').trim();
    try {
      const resp = await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        { receive_id: ridTrim, msg_type: 'text', content: JSON.stringify({ text }) },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          params: { receive_id_type: 'open_id' },
          timeout: 10000
        }
      );
      const ok = resp.data?.code === 0;
      log.info('[feishu] message sent to', ridTrim, '→', ok ? 'ok' : resp.data?.msg);
      return { ok, data: resp.data, errText: String(resp.data?.msg || '') };
    } catch (e) {
      const d = e?.response?.data;
      log.error('[feishu] send message failed:', d || e?.message);
      const code = Number(d?.code || 0);
      const errText = String(d?.msg || e?.message || '');
      return { ok: false, data: d, errText, httpCode: code };
    }
  };

  let rid = String(openId || '').trim();
  let out = await postTextOnce(rid);
  if (!out.ok && !feishuSkipOpenIdResolveHrms()) {
    const code = Number(out.data?.code ?? out.httpCode ?? 0);
    const errStr = String(out.errText || out.data?.msg || '');
    if (isOpenIdCrossAppFeishuError(code, errStr)) {
      const fixed = await refreshFeishuUserOpenIdForImDeliveryHrms(deps, token, rid);
      if (fixed && fixed !== rid) {
        log.warn('[feishu] open_id cross app: retry text after resolve');
        out = await postTextOnce(fixed);
      }
    }
  }

  return { ok: !!out.ok, data: out.data, error: out.ok ? undefined : String(out.errText || out.data?.msg || '') };
}

// Send interactive card (rich message) to a user
export async function sendLarkCard(openId, card, options = {}) {
  try {
    deepSanitizeFeishuCardStrings(card, sanitizePerformanceZhText);
  } catch (e) {
    log.warn('[feishu] card sanitize skipped:', e?.message);
  }
  const token = await getLarkTenantToken(options.tenantId);
  if (!token) return { ok: false, error: 'no_token' };

  const deps = feishuOpenIdResolveDeps();
  const postCardOnce = async (rid) => {
    const ridTrim = String(rid || '').trim();
    try {
      const resp = await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        { receive_id: ridTrim, msg_type: 'interactive', content: JSON.stringify(card) },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          params: { receive_id_type: 'open_id' },
          timeout: 10000
        }
      );
      const ok = resp.data?.code === 0;
      return { ok, data: resp.data, errText: String(resp.data?.msg || '') };
    } catch (e) {
      const d = e?.response?.data;
      log.error('[feishu] send card failed:', d || e?.message);
      const code = Number(d?.code || 0);
      const errText = String(d?.msg || e?.message || '');
      return { ok: false, data: d, errText, httpCode: code };
    }
  };

  let rid = String(openId || '').trim();
  let out = await postCardOnce(rid);
  if (!out.ok && !feishuSkipOpenIdResolveHrms()) {
    const code = Number(out.data?.code ?? out.httpCode ?? 0);
    const errStr = String(out.errText || out.data?.msg || '');
    if (isOpenIdCrossAppFeishuError(code, errStr)) {
      const fixed = await refreshFeishuUserOpenIdForImDeliveryHrms(deps, token, rid);
      if (fixed && fixed !== rid) {
        log.warn('[feishu] open_id cross app: retry card after resolve');
        out = await postCardOnce(fixed);
      }
    }
  }

  return { ok: !!out.ok, data: out.data, error: out.ok ? undefined : String(out.errText || out.data?.msg || '') };
}

// Download image from Feishu message
export async function getLarkImageUrl(messageId, imageKey) {
  const token = await getLarkTenantToken();
  if (!token) return null;
  try {
    const resp = await axios.get(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}`,
      { headers: { 'Authorization': `Bearer ${token}` }, params: { type: 'image' }, responseType: 'arraybuffer', timeout: 30000 }
    );
    const b64 = Buffer.from(resp.data).toString('base64');
    return `data:image/jpeg;base64,${b64}`;
  } catch (e) {
    log.error('[feishu] get image failed:', e?.message);
    return null;
  }
}

// ── 飞书语音识别 / 用户映射 / 督办推送 → domains/agent-feishu-bot/feishu-user-messaging*.js ──
let _feishuUserMessagingApi;
async function recognizeLarkAudio(messageId, fileKey) {
  return _feishuUserMessagingApi.recognizeLarkAudio(messageId, fileKey);
}
async function replyLarkMessage(messageId, text) {
  return _feishuUserMessagingApi.replyLarkMessage(messageId, text);
}
async function lookupFeishuUser(openId) {
  return _feishuUserMessagingApi.lookupFeishuUser(openId);
}
async function getFeishuUserInfo(openId) {
  return _feishuUserMessagingApi.getFeishuUserInfo(openId);
}
async function tryAutoBindByName(openId) {
  return _feishuUserMessagingApi.tryAutoBindByName(openId);
}
export async function lookupFeishuUserByUsername(username) {
  return _feishuUserMessagingApi.lookupFeishuUserByUsername(username);
}
async function pushIssueToAssignee(issue, message, tenantId = 'default') {
  return _feishuUserMessagingApi.pushIssueToAssignee(issue, message, tenantId);
}

export async function registerFeishuUser(openId, username) {
  const state = await getSharedState();
  const user = findUserInState(state, username);
  if (!user) return { ok: false, error: 'user_not_found' };

  const uname = String(user.username || username).trim();
  const name = String(user.name || '').trim();
  const store = String(user.store || '').trim();
  const brandCtx = resolveBrandContextByStore(state, store);
  const role = String(user.role || '').trim();

  try {
    // 飞书机器人消息webhook没有JWT/ALS上下文，按username反查users表得到真实租户，
    // 整段用tenantContext.run()包裹，避免会话变量跟下面显式写的tenant_id列值不一致。
    let tenantId = 'default';
    try {
      const tr = await pool().query('SELECT tenant_id FROM users WHERE lower(username) = lower($1) LIMIT 1', [uname]);
      tenantId = String(tr.rows?.[0]?.tenant_id || '').trim() || 'default';
    } catch (_e) { /* ignore */ }

    await tenantContext.run(tenantId, async () => {
      await pool().query(
        `UPDATE feishu_users
         SET registered = FALSE, updated_at = NOW()
         WHERE username = $1 AND open_id <> $2`,
        [uname, openId]
      );

      await pool().query(
        `INSERT INTO feishu_users (open_id, username, name, store, role, registered, tenant_id)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         ON CONFLICT (open_id, tenant_id) DO UPDATE SET username = $2, name = $3, store = $4, role = $5, registered = TRUE, updated_at = NOW()`,
        [openId, uname, name, store, role, tenantId]
      );
    });
    return { ok: true, user: { username: uname, name, store, role, brandId: brandCtx.brandId, brandName: brandCtx.brandName } };
  } catch (e) {
    log.error('[feishu] register user failed:', e?.message);
    return { ok: false, error: String(e?.message) };
  }
}

// Build an alert card for Feishu
function buildAlertCard(title, severity, detail, actions) {
  const color = severity === 'high' ? 'red' : 'orange';
  const elements = [
    { tag: 'div', text: { tag: 'lark_md', content: detail } }
  ];
  if (actions && actions.length) {
    elements.push({
      tag: 'action',
      actions: actions.map(a => ({
        tag: 'button',
        text: { tag: 'plain_text', content: a.text },
        type: a.type || 'default',
        value: a.value || {}
      }))
    });
  }
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template: color },
    elements
  };
}

// ─────────────────────────────────────────────
// 6. Agent 1: Data Auditor (数据审计员)
// ─────────────────────────────────────────────

// 注意：扣分规则已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// 注意：图片审核扣分规则已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// 注意：品牌评分模型已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// 注意：扣分计算函数已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// 注意：扣分计算函数已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// 注意：图片审核扣分函数已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// 注意：品牌维度得分计算函数已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// 注意：月度绩效计算函数已移交给 Chief Evaluator (OKR) 管理
// Data Auditor 只负责异常检测，不负责评分

// ─────────────────────────────────────────────
// Data Auditor 核心功能：只负责异常检测，不负责评分
// ─────────────────────────────────────────────

// Wave A1: runDataAuditor → domains/agent-auditor/run-data-auditor.js (wired after checkDataSourceQuality)
let _runDataAuditor;
export async function runDataAuditor(checkMode = 'daily', tenantId = 'default') {
  return _runDataAuditor(checkMode, tenantId);
}

// ─────────────────────────────────────────────
// 7. Agent 2: Operational Supervisor (营运督导员)
// ─────────────────────────────────────────────

// 营运督导员工作职责配置
let OPS_AGENT_CONFIG = {
  llmModels: {
    reasoningModel: 'deepseek-chat',
    visionModel: 'ep-20260424183833-7lr9g'
  },
  // 任务调度与主动触发
  scheduledTasks: {
    // 开/收市巡检
    dailyInspections: [
      
    ],
    // 食安抽检
    randomInspections: [
      
    ],
    // 数据联动触发阈值（配合BI异常检测规则）
    dataTriggers: {
      // 产品投诉阈值：1周内同一产品投诉>2次触发medium，>4次触发high
      productComplaintThreshold: 2, 
      // 毛利偏差阈值：马己仙<64%/洪潮<69%为medium
      marginDeviationThreshold: 0.01, // 使用较小的容差确保能触发
      // 桌访率阈值：桌访率<50%触发medium，<40%触发high
      tableVisitRatioThreshold: 0.50  
    }
  },

  // 多模态视觉审核标准
  visualInspection: {
    // 环境检查标准
    environment: {
      floorWater: 'detect_water_or_oil_on_floor',
      trashCovered: 'trash_bin_lid_closed',
      lightingAdequate: 'lighting_sufficient_for_clear_photos'
    },
    // 产品检查标准  
    product: {
      platingAesthetics: '洪潮切配摆盘美学标准',
      portionSize: '分量是否达标',
      garnishPlacement: '装饰配菜摆放规范'
    },
    // 物料检查标准
    materials: {
      fridgeLabelExpiry: '冰箱标签是否过期',
      rawCookedSeparation: '生熟分装检查',
      storageTemperature: '储存温度合规'
    },
    // 视觉准确度要求
    accuracyThresholds: {
      labelClarity: 0.8,      // 标识清晰度 > 80%
      foodCoverage: 0.9,     // 食材遮盖率达标
      photoQuality: 0.85     // 照片质量要求
    }
  },

  // 执行闭环追踪
  loopManagement: {
    // 催办逻辑
    followUpRules: {
      firstReminder: 60,  // 60分钟内未读信
      secondReminder: 90, // 90分钟内未首次反馈
      escalationDelay: 120, // 2小时后升级
      maxReminders: 3      // 最多提醒3次
    },
    // 逻辑纠偏检查
    logicValidation: {
      photoLocationRadius: 500, // 门店500米内
      exifTimeTolerance: 5,     // Exif时间误差<5分钟
      hashDuplicateCheck: true, // Hash重复检查
      dataConsistency: true     // 数据一致性检查
    }
  },

  // 判定逻辑标准
  judgmentStandards: {
    timeliness: {
      readDeadline: 15,    // 15分钟内读信
      responseDeadline: 60, // 60分钟内首次反馈
      latePenalty: 'mark_slow_response' // 超时标记响应迟缓
    },
    authenticity: {
      locationRadius: 500,
      exifTolerance: 300,  // 5分钟=300秒
      hashCheck: true,
      fraudAction: 'block_and_report' // 作假直接封禁并上报
    },
    visualAccuracy: {
      minClarity: 0.8,
      minCoverage: 0.9,
      poorQualityResponse: '环境光线不足，请打开补光灯重拍'
    },
    logicConsistency: {
      dataTolerance: 0.1,   // 10%数据偏差容忍度
      inconsistencyResponse: '检测到数据偏差较大，请核实后再提交'
    }
  },

  // 现场知识支援
  knowledgeSupport: {
    // SOP知识库调用规则
    sopQueryRules: {
      productQuality: '产品质量问题处理流程',
      ingredientHandling: '食材处理标准',
      equipmentOperation: '设备操作规范',
      emergencyProcedures: '紧急情况处理'
    },
    // 常见问题标准回复
    standardResponses: {
      smallOysters: '根据洪潮验收SOP第3条，超过20%不达标需拍图留存并做退货登记。请拍摄对比照片。',
      fridgeTemperature: '冰箱温度应保持在4°C以下，请检查温控设置并记录当前温度。',
      handWashing: '洗手必须满20秒，请使用洗手液并冲洗至手腕部位。'
    }
  }
};

let _auditImage;
export async function auditImage(imageUrl, auditType, context = {}) {
  return _auditImage(imageUrl, auditType, context);
}

let _getOpsKnowledgeSupport;
export async function getOpsKnowledgeSupport(query, context = {}) {
  return _getOpsKnowledgeSupport(query, context);
}

// 任务调度与主动触发
export async function scheduleOpsTasks() {
  const config = OPS_AGENT_CONFIG.scheduledTasks;
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  const scheduledTasks = [];
  
  // 检查日常巡检任务
  for (const inspection of config.dailyInspections) {
    if (inspection.time === currentTime) {
      const storeName = String(inspection?.store || '').trim();
      if (!storeName) continue;
      const task = {
        type: 'daily_inspection',
        brand: String(inspection?.brand || '').trim(),
        store: storeName,
        inspectionType: inspection.type,
        checklist: inspection.checklist,
        scheduledTime: now.toISOString()
      };
      scheduledTasks.push(task);
    }
  }
  
  return scheduledTasks;
}

// 数据联动触发检查
export async function checkDataTriggers() {
  const config = OPS_AGENT_CONFIG.scheduledTasks.dataTriggers;
  const triggers = [];
  
  // 检查产品投诉阈值
  try {
    const recentComplaints = await pool().query(`
      SELECT store, product_name, COUNT(*) as complaint_count
      FROM bad_reviews 
      WHERE review_type = 'product' 
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY store, product_name
      HAVING COUNT(*) >= $1
    `, [config.productComplaintThreshold]);
    
    for (const complaint of recentComplaints.rows) {
      triggers.push({
        type: 'product_complaints',
        store: complaint.store,
        product: complaint.product_name,
        count: complaint.complaint_count,
        action: 'check_production_process'
      });
    }
  } catch (e) {
    log.error('[ops_supervisor] data trigger check failed:', e?.message);
  }
  
  return triggers;
}

// 执行闭环追踪 - 催办逻辑
export async function followUpOverdueTasks() {
  const config = OPS_AGENT_CONFIG.loopManagement.followUpRules;
  const now = new Date();
  const followUps = [];
  
  // 检查超时未读的任务
  try {
    const unreadTasks = await pool().query(`
      SELECT t.*, u.open_id, u.name
      FROM master_tasks t
      JOIN users u ON t.assignee_username = u.username
      WHERE t.status = 'dispatched' 
        AND t.created_at < NOW() - make_interval(mins => $2)
        AND t.reminder_count < $1
    `, [config.maxReminders, Math.max(1, Math.floor(Number(config.firstReminder) || 60))]);
    
    for (const task of unreadTasks.rows) {
      // 发送飞书提醒
      const reminderMsg = prefixWithAgentName('ops_supervisor', 
        `【任务提醒】${task.assignee_username}，你有任务已超时${Math.round((now - new Date(task.created_at)) / 60000)}分钟未查看，请及时处理：${task.title}`);
      
      try {
        await sendLarkMessage(task.open_id, reminderMsg);
        
        // 更新提醒次数
        await pool().query(`
          UPDATE master_tasks 
          SET reminder_count = reminder_count + 1, 
              last_reminded_at = NOW()
          WHERE id = $1
        `, [task.id]);
        
        followUps.push({
          taskId: task.id,
          type: 'unread_reminder',
          assignee: task.assignee_username,
          reminderCount: task.reminder_count + 1
        });
      } catch (e) {
        log.error('[ops_supervisor] follow-up failed:', e?.message);
      }
    }
  } catch (e) {
    log.error('[ops_supervisor] overdue tasks check failed:', e?.message);
  }
  
  return followUps;
}

// 辅助函数：根据品牌获取门店列表
async function getStoresForBrand(brandName) {
  const state = await getSharedState();
  const stores = getStoresFromState(state);
  return stores.filter(s => s.brand === brandName);
}

let _runChiefEvaluator;
export async function runChiefEvaluator(period, tenantId = 'default') {
  return _runChiefEvaluator(period, tenantId);
}


// ─────────────────────────────────────────────
// 9. Message Router
// ─────────────────────────────────────────────

const _AUDIT_KEYWORDS = ['损耗', '盘点', '毛利', '牛肉', '成本', '差评', '折扣', '营收', '对账', '异常'];
const _OPS_KEYWORDS = ['图片', '卫生', '检查', '拍照', '摆盘', '收货', '消毒', '开市', '闭市', '巡检'];
const _EVAL_KEYWORDS = ['分数', '绩效', '考核', '奖金', '得分', '扣分', '排名', '评价', '这周'];
const _HR_KEYWORDS = ['离职', '辞职', '入职', '转正', '晋升', '调岗', '加薪', '薪资', '工资', '请假', '休假', '社保', '人事', '档案', '考勤'];
const _APPEAL_KEYWORDS = ['申诉', '取消扣分', '不公平', '误判', '恢复', '投诉', '举报'];
const _SOP_KEYWORDS = ['SOP', '赔付', '退款', '培训', '入职培训', '课件', '带教', '讲师', '考核培训', '技能培训', '标准作业'];

// Agent name prefix mapping
const AGENT_PREFIX = {
  data_auditor: '小年',
  ops_supervisor: '小年',
  chief_evaluator: '小年',
  train_advisor: '小年',
  sop_advisor: '小年',
  appeal: '小年',
  master: '小年',
  general: '小年'
};

export function prefixWithAgentName(route, text) {
  const prefix = AGENT_PREFIX[route] || 'HRMS';
  return `${prefix}：${text}`;
}

async function buildBiGroundingFacts(store, text) {
  const q = String(text || '').trim();
  const targetStore = String(store || '').trim();
  if (!targetStore) return '';
  const askReviewLike = /(差评|点评|评论|桌访|产品问题|反馈|口味|出品|上菜|服务)/.test(q);
  if (!askReviewLike) return '';
  const sections = [];

  try {
    const since30 = toDateOnly(new Date(Date.now() - 29 * 86400000).toISOString());
    const today = toDateOnly(new Date().toISOString());
    const r = await pool().query(
      `SELECT agent_data, created_at
       FROM agent_messages
       WHERE content_type = 'negative_review'
       ORDER BY created_at DESC
       LIMIT 3000`
    );
    const rows = (Array.isArray(r.rows) ? r.rows : []).map((row) => {
      const data = row?.agent_data && typeof row.agent_data === 'object' ? row.agent_data : {};
      const f = data?.fields && typeof data.fields === 'object' ? data.fields : {};
      const rowStore = extractBitableFieldText(
        data.store || f.store || f['所属门店'] || f['门店'] || f['差评门店']
      );
      const date = normalizeBitableDateValue(
        data.date || f['差评日期'] || f['创建日期'] || f['日期'] || f['评价日期'],
        row?.created_at
      );
      const product = extractBitableFieldText(data.product || data.product_name || f['差评产品'] || f['菜品'] || f['产品']);
      const service = extractBitableFieldText(data.service_item || f['服务项'] || f['服务问题']);
      const content = extractBitableFieldText(data.reason || data.content || f['差评原因'] || f['内容'] || f['描述']);
      return { date, rowStore, product_name: product, service_item: service, content };
    }).filter((x) => isLikelySameStore(x.rowStore, targetStore) && inDateRangeInclusive(x.date, since30, today));

    const recent7 = rows.filter((x) => {
      const d = toDateOnly(x?.date);
      if (!d) return false;
      return d >= toDateOnly(formatDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)));
    });

    if (!rows.length) {
      sections.push('【差评数据】近30天该门店无差评样本。');
    } else {
      const productTop = new Map();
      const serviceTop = new Map();
      rows.forEach((x) => {
        const p = String(x?.product_name || '').trim();
        const s = String(x?.service_item || '').trim();
        if (p) productTop.set(p, (productTop.get(p) || 0) + 1);
        if (s) serviceTop.set(s, (serviceTop.get(s) || 0) + 1);
      });
      const topN = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join('、') || '无';
      const samples = rows.slice(0, 3).map((x) => `- ${toDateOnly(x.date) || '-'}：${String(x.content || '').replace(/\s+/g, ' ').slice(0, 60)}`).join('\n');
      sections.push(
        `【差评数据】近7天${recent7.length}条，近30天${rows.length}条；产品Top：${topN(productTop)}；服务Top：${topN(serviceTop)}。\n最近样例：\n${samples}`
      );
    }
  } catch (e) {
    sections.push('【差评数据】查询失败或数据表不可用。');
  }

  try {
    const end = toDateOnly(new Date().toISOString());
    const start = toDateOnly(new Date(Date.now() - 29 * 86400000).toISOString());
    const rows = await loadUnifiedTableVisitRowsByStore(targetStore, start, end);
    if (!rows.length) {
      sections.push('【桌访数据】近30天无桌访不满意菜品样本。');
    } else {
      const itemTop = new Map();
      rows.forEach((x) => {
        extractTableVisitItems(x).forEach((k) => {
          itemTop.set(k, (itemTop.get(k) || 0) + 1);
        });
      });
      const top = Array.from(itemTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join('、') || '无';
      sections.push(`【桌访数据】近30天样本${rows.length}条；不满意项Top：${top}`);
    }
  } catch (e) {
    sections.push('【桌访数据】查询失败或数据表不可用。');
  }

  return sections.join('\n');
}

async function buildBiDeterministicReviewReply(store, text) {
  const q = String(text || '').trim();
  const targetStore = String(store || '').trim();
  if (!targetStore) return '';
  if (!/(评价|差评|好评|评论)/.test(q)) return '';
  if (!/(多少|几条|总数|总评价|统计|上周|本周|昨天|昨日|今天|今日|近7天|7天)/.test(q)) return '';

  const normalizedStore = normalizeStoreKey(targetStore);
  const period = resolveDateRangeFromQuestion(q, 7);
  const periodLabel = period.label;

  try {
    const r = await pool().query(
      `SELECT COUNT(DISTINCT record_id)::int AS c
       FROM agent_messages
       WHERE content_type = 'negative_review'
         AND lower(regexp_replace(coalesce(
           agent_data->>'store',
           agent_data#>>'{fields,store}',
           agent_data#>>'{fields,所属门店}',
           agent_data#>>'{fields,门店}',
           agent_data#>>'{fields,差评门店}',
           ''
         ), '\\s+', '', 'g')) LIKE $1
         AND (
           CASE
             WHEN coalesce(agent_data->>'date','') ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (agent_data->>'date')::date
             WHEN coalesce(agent_data->>'date','') ~ '^\\d{10,13}$' THEN to_timestamp((agent_data->>'date')::bigint / CASE WHEN length(agent_data->>'date')=13 THEN 1000 ELSE 1 END)::date
             ELSE created_at::date
           END
         ) BETWEEN $2::date AND $3::date`,
      [normalizeStoreLike(normalizedStore), period.start, period.end]
    );
    const badCount = Number(r.rows?.[0]?.c || 0);
    return `${periodLabel}评价数据（${targetStore}）\n- 差评数：${badCount}条\n- 好评数：当前系统未接入“好评总量”数据源，无法给出\n- 总评价数：当前系统未接入“全量评价”数据源，无法给出\n\n如需“总评价/好评/差评占比”精确值，请接入平台全量评价表（大众点评/美团）后再查。`;
  } catch (e) {
    return `${periodLabel}评价数据暂不可用（查询异常）。当前仅保证“差评表”可统计，建议先检查差评表同步状态后重试。`;
  }
}

function checkAgentPermission(role, route) {
  const r = String(role || '').trim();
  const rt = String(route || '').trim();
  if (!r || !rt) return { allowed: true };
  if (r === 'admin' || r === 'hr_manager' || r === 'hq_manager') return { allowed: true };
  const ROUTE_ROLES = {
    data_auditor: ['store_manager', 'store_production_manager', 'store_product_manager', 'cashier'],
    marketing_planner: ['store_manager', 'store_production_manager', 'store_product_manager'],
    marketing_executor: ['store_manager', 'store_production_manager', 'store_product_manager'],
    marketing: ['store_manager', 'store_production_manager', 'store_product_manager'],
    ops_supervisor: ['store_manager', 'store_production_manager'],
    chief_evaluator: ['store_manager', 'store_production_manager'],
    sop_advisor: ['store_manager', 'store_production_manager', 'cashier', 'staff'],
    appeal: ['store_manager', 'store_production_manager', 'cashier', 'staff'],
    appeal_agent: ['store_manager', 'store_production_manager', 'cashier', 'staff'],
    train_advisor: ['store_manager', 'store_production_manager', 'cashier', 'staff'],
    general: true
  };
  const allowed = ROUTE_ROLES[rt];
  if (allowed === true || !allowed) return { allowed: true };
  if (Array.isArray(allowed) && allowed.includes(r)) return { allowed: true };
  return { allowed: false, reason: `您的角色（${r}）暂无权限使用该功能，请联系管理员。` };
}

let _routeMessage;
export async function routeMessage(text, hasImage, senderUsername) {
  return _routeMessage(text, hasImage, senderUsername);
}


// ─────────────────────────────────────────────
// 10. Agent Response Generator
// ─────────────────────────────────────────────

// Wave A2a: orchestration → domains/agent-message/handle-agent-message.js
// data_auditor case body remains here as handleDataAuditorCase (inject).
let _handleAgentMessage;
export async function handleAgentMessage(senderUsername, senderName, senderStore, senderRole, senderBrandContext, text, imageUrls) {
  return _handleAgentMessage(senderUsername, senderName, senderStore, senderRole, senderBrandContext, text, imageUrls);
}

// Wave A2b: handleDataAuditorCase → domains/agent-message/handle-data-auditor-case.js (wired below)
let handleDataAuditorCase;




// ─────────────────────────────────────────────
// 11. Check Agent - Self-Reflection Quality Gate
// → domains/agent-message/check-agent-quality*.js
// ─────────────────────────────────────────────
let _checkAgentQualityApi;
async function runWithCheckAgent(userQuery, route, generateFn, maxRetries = 2) {
  return _checkAgentQualityApi.runWithCheckAgent(userQuery, route, generateFn, maxRetries);
}
async function enforceUnifiedQualityGate(args) {
  return _checkAgentQualityApi.enforceUnifiedQualityGate(args);
}

/** Bitable 管道类告警去重：同一 key 在 minIntervalMs 内只发一次（避免 keepalive 死循环刷屏） */
const _bitablePipelineAlertLast = new Map();

/**
 * LISTEN / keepalive / catchup / NOTIFY 解析等故障 → 第一时间飞书通知 admin/hq_manager（与双写告警同 open_id 查询口径）。
 * @param {string} scopeLabel
 * @param {unknown} err
 * @param {{ minIntervalMs?: number, dedupeKey?: string, extraLines?: string[] }} [opts]
 */
async function notifyBitablePipelineFailure(scopeLabel, err, opts = {}) {
  try {
    const reason = String(err?.message || err || 'unknown').slice(0, 900);
    const stack = err?.stack ? String(err.stack).split('\n').slice(0, 8).join('\n').slice(0, 1500) : '';
    const dedupeKey = String(opts?.dedupeKey || scopeLabel || 'default');
    const minI = Number(opts?.minIntervalMs);
    if (Number.isFinite(minI) && minI > 0) {
      const k = `${scopeLabel}|${dedupeKey}`;
      const now = Date.now();
      const last = _bitablePipelineAlertLast.get(k) || 0;
      if (now - last < minI) return;
      _bitablePipelineAlertLast.set(k, now);
    }
    const r = await pool().query(
      `SELECT open_id FROM feishu_users
       WHERE registered = true AND open_id IS NOT NULL
         AND role IN ('admin', 'hq_manager')
         AND open_id NOT LIKE '%probe%'
       LIMIT 20`
    );
    const rows = r.rows || [];
    if (!rows.length) {
      log.warn('[bitable-alert] no admin/hq_manager open_id for Feishu alert:', scopeLabel, reason);
      return;
    }
    const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
    const extra = Array.isArray(opts?.extraLines) ? opts.extraLines.filter(Boolean).join('\n') : '';
    const msg =
      `【HRMS Bitable 实时链故障】\n范围：${scopeLabel}\n原因：${reason}\n时间：${timeStr}（上海）\n` +
      (extra ? `补充：\n${extra}\n` : '') +
      (stack ? `堆栈摘要：\n${stack}\n` : '') +
      `影响：多维表同步后的知识图谱 / 照片验证 / 巡店处理可能延迟；系统会 catchup、LISTEN 重连或回退飞书轮询。\n` +
      `请查 hrms-service 日志 [bitable]、[bitable-alert] 与 DATABASE_URL / PG 权限。`;
    await Promise.all(
      (rows || []).map((row) =>
        sendLarkMessage(row.open_id, msg, { skipDedup: true }).catch((e) =>
          log.error('[bitable-alert] sendLarkMessage failed:', e?.message)
        )
      )
    );
  } catch (e) {
    log.error('[bitable-alert] notifyBitablePipelineFailure failed:', e?.message);
  }
}

// Wave P2: Bitable LISTEN / catchup / archive → domains/feishu-bitable/*
const _bitablePolling = createBitablePollingController({
  pool,
  bitableConfigs: BITABLE_CONFIGS,
  processedRecordIds: _bitableProcessedRecordIds,
  lastProcessedTime: _bitableLastProcessedTime,
  dedupMaxKeys: BITABLE_DEDUP_MAX_KEYS,
  dedupCleanCount: BITABLE_DEDUP_CLEAN_COUNT,
  seedBitableDedup,
  extractRelationsFromBitableRecord,
  processBitableData,
  // Prior agents.js called an unbound processChecklistConfirmation (caught + logged).
  // Keep injectable; Feishu-poll confirmation lives in processOpsChecklistSubmissions.
  processChecklistConfirmation: null,
  pollAllBitableSubmissions,
  archiveOldBitableSubmissions,
  getBitableSubmissionStats,
  notifyBitablePipelineFailure,
  log,
});

export function startBitablePolling(intervalMs = 60000) {
  return _bitablePolling.startBitablePolling(intervalMs);
}

export function startArchiveScheduler() {
  return _bitablePolling.startArchiveScheduler();
}

export async function checkBitableCapacity() {
  return _bitablePolling.checkBitableCapacity();
}

export function stopBitablePolling() {
  return _bitablePolling.stopBitablePolling();
}

// ─────────────────────────────────────────────
// 13. Feishu Webhook Event Handler
// ─────────────────────────────────────────────

async function tryCaptureOpsChecklistDetailFromChat(openId, feishuUser, text, imageUrls) {
  const storeName = String(feishuUser?.store || '').trim();
  if (!openId || !storeName) return { handled: false };

  const candidates = [];
  const today = new Date().toISOString().slice(0, 10);
  candidates.push(`${openId}||${storeName}||opening||${today}`);
  candidates.push(`${openId}||${storeName}||closing||${today}`);

  let matchedKey = '';
  let progress = null;
  for (const key of candidates) {
    const p = _opsChecklistProgress.get(key);
    if (p && Number.isFinite(p.pendingItemIndex) && p.pendingItemIndex >= 0) {
      matchedKey = key;
      progress = p;
      break;
    }
  }
  if (!progress) return { handled: false };

  const idx = progress.pendingItemIndex;
  const itemName = String(progress.pendingItemName || '').trim() || `第${idx + 1}项`;
  if (!progress.itemDetails[idx]) progress.itemDetails[idx] = { status: '', remark: '', photoCount: 0 };

  let changed = false;
  if (text) {
    const normalized = text.replace(/^说明[：:]/, '').trim();
    if (normalized) {
      progress.itemDetails[idx].remark = normalized;
      changed = true;
    }
  }
  if (Array.isArray(imageUrls) && imageUrls.length) {
    progress.itemDetails[idx].photoCount = (Number(progress.itemDetails[idx].photoCount) || 0) + imageUrls.length;
    changed = true;
  }

  if (!changed) return { handled: false };

  const abnormalCount = countOpsChecklistAbnormal(progress);
  const detail = progress.itemDetails[idx] || {};
  const statusText = detail.status === 'pass' ? '合格' : detail.status === 'fail' ? '异常' : '未标记';
  const remarkText = String(detail.remark || '').trim() ? '已填写' : '未填写';
  const photoText = `${Number(detail.photoCount) || 0}张`;

  await sendLarkMessage(
    openId,
    prefixWithAgentName('ops_supervisor', `已更新【${itemName}】\n状态：${statusText}\n说明：${remarkText}\n照片：${photoText}\n\n当前已记录异常：${abnormalCount}项`)
  );

  return { handled: true, progressKey: matchedKey, abnormalCount };
}

// ── 飞书：固定格式「营销文案」+ 菜名/品牌/推荐理由 → 可选配图 → 生成多平台多套文案 ──
// 实现见 domains/agent-message/marketing-copy*.js；若线上另有未合并进 Git 的同名逻辑，部署前需 diff 合并。
let _tryFeishuMarketingCopyRound;
async function tryFeishuMarketingCopyRound(args) {
  return _tryFeishuMarketingCopyRound(args);
}

let _onFeishuEvent;
export async function onFeishuEvent(body) {
  return _onFeishuEvent(body);
}


// ─────────────────────────────────────────────
// 12. Feishu Push Notifications
// ─────────────────────────────────────────────

// Push new issues to their assignees via Feishu
export async function pushIssuesToFeishu(tenantId = 'default') {
  try {
    const r = await pool().query(
      `SELECT ai.id, ai.title, ai.detail, ai.severity, ai.store, ai.category, ai.assignee_username
       FROM agent_issues ai
       WHERE ai.feishu_notified = FALSE AND ai.assignee_username IS NOT NULL
         AND COALESCE(ai.agent, '') <> 'data_auditor'
         AND ai.tenant_id = $1
       ORDER BY ai.created_at DESC LIMIT 20`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let pushed = 0;
    for (const issue of r.rows) {
      const fu = await lookupFeishuUserByUsername(issue.assignee_username);
      if (!fu?.open_id) continue;

      const sev = issue.severity === 'high' ? '🔴 高优先级' : '🟡 中优先级';
      const sevTemplate = issue.severity === 'high' ? 'red' : 'orange';
      const anomalyCard = {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: `${sev} 异常通知` }, template: sevTemplate },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: `**门店**：${issue.store || '-'}\n**类别**：${issue.category || '-'}` } },
          { tag: 'hr' },
          { tag: 'div', text: { tag: 'lark_md', content: `📋 **${issue.title}**\n\n${issue.detail || ''}` } },
          { tag: 'hr' },
          { tag: 'div', text: { tag: 'lark_md', content: `⏰ 请在 **1小时内** 查看并回复整改措施。\n直接回复文字说明整改情况，或发送整改照片。` } },
          { tag: 'note', elements: [{ tag: 'plain_text', content: `小年 · 异常检测` }] }
        ]
      };

      let sendResult = await sendLarkCard(fu.open_id, anomalyCard);
      if (!sendResult.ok) {
        const msg = prefixWithAgentName('data_auditor', `${sev} 异常通知\n\n📋 ${issue.title}\n\n${issue.detail || ''}\n\n⏰ 请在1小时内查看并回复整改措施。`);
        sendResult = await sendLarkMessage(fu.open_id, msg);
      }
      if (sendResult.ok) {
        await pool().query(`UPDATE agent_issues SET feishu_notified = TRUE WHERE id = $1`, [issue.id]);
        pushed++;

        // Log outbound message
        try {
          await pool().query(
            `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, routed_to, content_type, content, tenant_id)
             VALUES ('out','feishu',$1,$2,$3,'data_auditor','text',$4,$5)`,
            [fu.open_id, 'system', 'HRMS Agent', `${sev} 异常通知: ${issue.title}`, resolveTenantIdDefault()]
          );
        } catch (e) { /* ignore */ }
      }
    }
    return pushed;
  } catch (e) {
    log.error('[feishu] push issues failed:', e?.message);
    return 0;
  }
}

/** 周度异常汇总（anomaly_rollups_v2）的「绩效考核周报」仅周一推送，避免与即时「BI异常情况扣分」卡重复轰炸；非周一积压行保留 feishu_notified=false 至下周一再推。 */
function isShanghaiMondayNow() {
  const wd = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' });
  return wd === 'Mon';
}

/** 上海日历 yyyy-mm-dd */
function shanghaiYmdCal(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}
function addDaysYmdShanghaiPush(ymd, delta) {
  const t = new Date(`${ymd}T12:00:00+08:00`);
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}
/** 刚结束的自然周周一（与 agents 周评分对齐）：昨天所在周的周一 */
function lastCompletedWeekMondayShanghaiForPush() {
  const today = shanghaiYmdCal();
  const yst = addDaysYmdShanghaiPush(today, -1);
  return addDaysYmdShanghaiPush(yst, -6);
}
function currentAndPrevMonthPeriodStrForPush() {
  const parts = shanghaiYmdCal().split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const cur = `${y}-${String(m).padStart(2, '0')}`;
  let pm = m - 1;
  let py = y;
  if (pm < 1) {
    pm = 12;
    py -= 1;
  }
  const prev = `${py}-${String(pm).padStart(2, '0')}`;
  return { cur, prev };
}

// Push performance scores to users via Feishu
export async function pushScoresToFeishu() {
  try {
    log.info('[perf] pushScoresToFeishu disabled: agents-service-v2 owns weekly/monthly score delivery');
    return 0;
  } catch (e) {
    log.error('[feishu] push scores disabled path failed:', e?.message);
    return 0;
  }
}

// ─────────────────────────────────────────────
// 13. Scheduler
// ─────────────────────────────────────────────

let _schedulerStarted = false;

// ── 防护措施：启动断言 + LLM健康检查 + 连续错误告警 ──
const _errorTracker = { consecutiveLLMErrors: 0, lastAlertTime: 0, alertCooldownMs: 10 * 60 * 1000 };
const _llmHealthState = { lastAllOk: null, lastSummary: '' };

export async function verifyLLMHealth(options = {}) {
  if (!isExternalEnabled()) {
    return { allOk: false, results: [{ name: 'External', ok: false, error: 'external_disabled' }] };
  }
  const notifyOnFailure = options.notifyOnFailure !== false;
  const notifyOnRecovery = options.notifyOnRecovery !== false;
  const forceNotify = !!options.forceNotify;
  const results = [];
  const providers = [
    { name: 'DeepSeek', model: DEEPSEEK_MODEL, apiKey: DEEPSEEK_API_KEY, baseUrl: DEEPSEEK_BASE_URL },
    { name: 'Qwen', model: QWEN_MODEL, apiKey: QWEN_API_KEY, baseUrl: QWEN_BASE_URL },
    { name: 'Doubao(Vision)', model: DEEPSEEK_VISION_MODEL, apiKey: DOUBAO_API_KEY, baseUrl: DOUBAO_BASE_URL }
  ];
  const providerKeyMap = { DeepSeek: 'deepseek', Qwen: 'qwen', 'Doubao(Vision)': 'doubao' };
  for (const p of providers) {
    if (!p.apiKey) { results.push({ name: p.name, ok: false, error: 'API_KEY未配置' }); continue; }
    try {
      const resp = await axios.post(`${p.baseUrl}/chat/completions`, {
        model: p.model, messages: [{ role: 'user', content: '回复OK' }], max_tokens: 5, temperature: 0
      }, { headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000 });
      const content = resp.data?.choices?.[0]?.message?.content || '';
      results.push({ name: p.name, model: p.model, ok: true, reply: content.slice(0, 20) });
      markProviderOk(providerKeyMap[p.name] || '');
    } catch (e) {
      const status = e?.response?.status || 'timeout';
      const msg = e?.response?.data?.error?.message || e?.message || '未知错误';
      results.push({ name: p.name, model: p.model, ok: false, error: `HTTP ${status}: ${msg.slice(0, 100)}` });
      markProviderFail(providerKeyMap[p.name] || '');
      markProviderFail(providerKeyMap[p.name] || '');
    }
  }
  const allOk = results.every(r => r.ok);
  const summary = results.map(r => `${r.ok ? '✅' : '❌'} ${r.name}(${r.model || '?'}): ${r.ok ? r.reply : r.error}`).join('\n');
  const prevAllOk = _llmHealthState.lastAllOk;
  _llmHealthState.lastAllOk = allOk;
  _llmHealthState.lastSummary = summary;
  log.info(`[LLM-HEALTH] Startup check:\n${summary}`);
  const healthyProviders = results.filter(r => r.ok).map(r => r.name);
  const downProviders = results.filter(r => !r.ok).map(r => r.name);
  if (!allOk && notifyOnFailure && (forceNotify || prevAllOk !== false)) {
    const fallbackNote = healthyProviders.length > 0
      ? `\n\n🔄 自动降级已激活：${downProviders.join('、')} 不可用时，Agent 将自动切换到 ${healthyProviders.join('、')} 继续工作。`
      : '\n\n⚠️ 所有 Provider 均不可用，Agent 将完全无法响应！';
    log.error('[LLM-HEALTH] ⚠️ 部分LLM不可用，自动降级已激活');
    try {
      await sendErrorAlertToAdmin(`⚠️ 【系统告警】LLM健康检查未通过:\n${summary}${fallbackNote}\n\n请检查 API Key / 模型配置 / 网络连通性。`);
    } catch (_) { /* ignore */ }
  }
  if (allOk && notifyOnRecovery && prevAllOk === false) {
    try {
      await sendErrorAlertToAdmin(`✅ 【系统恢复】LLM健康检查已恢复正常:\n${summary}`);
    } catch (_) { /* ignore */ }
  }
  return { allOk, results };
}

export function assertCriticalFunctions() {
  const critical = [
    ['resolveModelProvider', typeof resolveModelProvider],
    ['getLLMClientConfig', typeof getLLMClientConfig],
    ['checkAgentPermission', typeof checkAgentPermission],
    ['callLLM', typeof callLLM],
    ['callVisionLLM', typeof callVisionLLM],
    ['routeMessage', typeof routeMessage],
    ['handleAgentMessage', typeof handleAgentMessage],
    ['sendLarkMessage', typeof sendLarkMessage],
    ['buildFeishuCardFromAgentReply', typeof buildFeishuCardFromAgentReply],
    ['resolveDateRangeFromQuestion', typeof resolveDateRangeFromQuestion],
    ['formatDate', typeof formatDate],
    ['isDataBackedReply', typeof isDataBackedReply],
    ['buildKpiRadarAlertJson', typeof buildKpiRadarAlertJson],
    ['buildBiDeterministicTableVisitReply', typeof buildBiDeterministicTableVisitReply],
  ];
  const missing = critical.filter(([, t]) => t !== 'function');
  if (missing.length > 0) {
    const msg = `[CRITICAL] Missing functions at startup: ${missing.map(([n]) => n).join(', ')}`;
    log.error(msg);
    throw new Error(msg);
  }
  log.info('[agents] Startup assertion passed: all critical functions defined');
}

async function sendErrorAlertToAdmin(errorMsg) {
  const now = Date.now();
  if (now - _errorTracker.lastAlertTime < _errorTracker.alertCooldownMs) return;
  _errorTracker.lastAlertTime = now;
  try {
    const state = await getSharedState();
    const allUsers = [
      ...(Array.isArray(state?.employees) ? state.employees : []),
      ...(Array.isArray(state?.users) ? state.users : [])
    ];
    const recipients = allUsers.filter(u => ['admin', 'hq_manager'].includes(String(u?.role || '').trim()));
    for (const admin of recipients) {
      const fu = await lookupFeishuUserByUsername(String(admin.username || '').trim());
      if (fu?.open_id) {
        await sendLarkMessage(
          fu.open_id,
          `🚨 系统告警\n\n${errorMsg}\n\n时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n请尽快检查服务状态。`,
          { skipDedup: true }
        );
      }
    }
  } catch (e) {
    log.error('[alert] Failed to send admin alert:', e?.message);
  }
}

export function trackLLMResult(ok) {
  if (ok) {
    _errorTracker.consecutiveLLMErrors = 0;
  } else {
    _errorTracker.consecutiveLLMErrors++;
    if (_errorTracker.consecutiveLLMErrors >= 5) {
      sendErrorAlertToAdmin(
        `LLM 连续调用失败 ${_errorTracker.consecutiveLLMErrors} 次，Agent 可能无法正常回复。\n\n` +
        `说明：厂商控制台「账号正常」不等于 ECS 上 hrms-service 能调通 API（密钥、模型名、出网、429/欠费均会导致失败）。\n` +
        `健康检查会测 DeepSeek、通义(Qwen)、豆包(Vision) 三条链路，任一条失败都会计入。\n\n` +
        `请 SSH 到服务器执行：pm2 logs hrms-service --lines 80\n搜索 [LLM-FALLBACK]、401、429、timeout 定位具体 Provider。`
      );
    }
  }
}

export function getAgentHealthStatus() {
  const schedulingDelegated = process.env.DISABLE_AGENT_SCHEDULING === 'true';
  return {
    schedulerRunning: _schedulerStarted,
    /** 为 true 时 HRMS 进程不跑本地 Agent 定时调度，由 Agent V2 承担；schedulerRunning 为 false 属预期 */
    schedulingDelegated,
    consecutiveLLMErrors: _errorTracker.consecutiveLLMErrors,
    performanceMetrics: { ..._performanceMetrics },
    llmHealthy: _errorTracker.consecutiveLLMErrors < 5,
    scheduledTaskStatus: getScheduledTaskStatus()
  };
}

export function startAgentScheduler() {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  // 启动后做一次延迟健康检查 + 周期检查（防止DeepSeek挂了无告警）
  setTimeout(() => {
    verifyLLMHealth({ notifyOnFailure: true, notifyOnRecovery: true }).catch((e) => {
      log.error('[LLM-HEALTH] periodic check error:', e?.message);
    });
  }, 30000);
  setInterval(() => {
    verifyLLMHealth({ notifyOnFailure: true, notifyOnRecovery: true }).catch((e) => {
      log.error('[LLM-HEALTH] periodic check error:', e?.message);
    });
  }, 10 * 60 * 1000);

  const tickDeps = {
    pool,
    tenantContext,
    getActiveTenantIds,
    runDataAuditor,
    pushIssuesToFeishu,
    pushIssueToAssignee,
    pushScoresToFeishu,
    log,
  };
  const auditTick = () => runAuditTick(tickDeps);
  const weeklyAuditTick = () => runWeeklyAuditTick(tickDeps);
  const evalTick = () => runEvalTick(tickDeps);
  const weeklyOpsTick = () => runWeeklyOpsTick(tickDeps);
  const dailyRechargeTick = () => runDailyRechargeTick(tickDeps);
  const pushTick = () => runPushTick(tickDeps);

  // Initial run after 15 seconds
  setTimeout(auditTick, 15000);

  // Periodic runs
  setInterval(auditTick, 30 * 60 * 1000);   // every 30 min (daily checks)
  setInterval(weeklyAuditTick, 30 * 60 * 1000); // every 30 min (checks if Mon 00:00 CST)
  setInterval(evalTick, 60 * 60 * 1000);     // every hour
  setInterval(weeklyOpsTick, 60 * 60 * 1000); // every hour (checks if Monday 10am)
  setInterval(dailyRechargeTick, 60 * 60 * 1000); // every hour (checks if 10am)
  setInterval(pushTick, 5 * 60 * 1000);      // every 5 min

}

// ─────────────────────────────────────────────
// 15. Performance Monitoring API
// ─────────────────────────────────────────────

export function getAgentPerformanceMetrics() {
  return {
    ..._performanceMetrics,
    cacheHitRate: _performanceMetrics.totalCalls > 0 ? 
      (_performanceMetrics.cacheHits / _performanceMetrics.totalCalls * 100).toFixed(2) + '%' : '0%',
    contextSize: _conversationContext.size,
    cacheSize: _responseCache.size,
    quality: { ..._agentQualityMetrics },
    providerHealth: getProviderHealthStatus(),
    uptime: process.uptime()
  };
}

export function clearAgentCache() {
  _responseCache.clear();
  _conversationContext.clear();
  log.info('[agents] Cache cleared');
}

export async function runAgentEvalSuite({ createdBy = '', suiteName = 'default', tenantId = 'default' } = {}) {
  const rows = [];
  for (const c of AGENT_EVAL_CASES) {
    let routed = 'general';
    let err = '';
    try {
      const r = await routeMessage(c.text, false, '');
      routed = String(r?.route || 'general');
    } catch (e) {
      err = String(e?.message || e);
    }
    const demand = detectFactDemand(c.text);
    const routePass = routed === c.route;
    const demandPass = demand === c.demand;
    rows.push({
      text: c.text,
      expectedRoute: c.route,
      actualRoute: routed,
      expectedDemand: c.demand,
      actualDemand: demand,
      routePass,
      demandPass,
      error: err
    });
  }

  const total = rows.length;
  const routeHit = rows.filter((x) => x.routePass).length;
  const demandHit = rows.filter((x) => x.demandPass).length;
  const summary = {
    total,
    routeHit,
    routeAccuracy: total ? Number((routeHit / total).toFixed(3)) : 0,
    demandHit,
    demandAccuracy: total ? Number((demandHit / total).toFixed(3)) : 0,
    createdAt: new Date().toISOString(),
    cases: rows
  };

  try {
    await pool().query(
      `INSERT INTO agent_eval_runs (suite_name, summary, created_by, tenant_id)
       VALUES ($1, $2::jsonb, $3, $4)`,
      [String(suiteName || 'default'), JSON.stringify(summary), String(createdBy || ''), tenantId]
    );
  } catch (e) {
    log.error('[agents] runAgentEvalSuite persist failed:', e?.message || e);
  }

  return summary;
}

// 定期清理过期缓存
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, value] of _responseCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      _responseCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    log.info(`[agents] Cleaned ${cleaned} expired cache entries`);
  }
}, 10 * 60 * 1000); // 每10分钟清理一次

/**
 * 兼容入口：路由已迁至 domains/agent-*（feishu-bot / data-center / ops / records / triggers）。
 * index.js 分别注册各域；保留此函数以免旧调用点断裂。
 */
export function registerAgentRoutes(_app, _authRequired) {
  // no-op — see domains/agent-feishu-bot, agent-data-center, agent-ops, agent-records, agent-triggers
}

// ─────────────────────────────────────────────
// 辅助函数 - 数据源质量检查
// ─────────────────────────────────────────────

// Data Auditor 数据源质量检查
async function checkDataSourceQuality() {
  await refreshBiAgentRuntimeConfig();
  return safeExecute('data_auditor_quality_check', async () => {
    const issues = [];
    
    // 检查 Bitable 数据同步状态
    try {
      const sourceKeyByConfig = {
        ops_checklist: 'ops_checklist_bitable',
        table_visit: 'table_visit_bitable',
        opening_reports: 'opening_reports_bitable',
        closing_reports: 'closing_reports_bitable',
        meeting_reports: 'meeting_reports_bitable',
        material_majixian: 'material_majixian_bitable',
        material_hongchao: 'material_hongchao_bitable'
      };
      for (const [configKey, config] of Object.entries(BITABLE_CONFIGS)) {
        const sourceKey = sourceKeyByConfig[configKey];
        if (sourceKey && !isBiSourceEnabled(sourceKey)) continue;
        const lastSync = await getLastSyncTime(configKey);
        const syncAge = Date.now() - lastSync;
        
        // 如果超过10分钟没有同步，报告问题
        if (syncAge > 10 * 60 * 1000) {
          await safeExecute('data_source_issue_report', async () => {
            await AgentCommunicationHelper.reportDataSourceIssue(
              configKey,
              `Bitable ${config.name} 数据同步超时`,
              `最后同步时间: ${new Date(lastSync).toLocaleString()}`,
              '建议检查网络连接和API配置'
            );
          });
          issues.push(configKey);
        }
      }
    } catch (error) {
      safeErrorLog('data_auditor_bitable_sync', error);
    }
    
    // 检查数据完整性
    try {
      const state = await getSharedState();
      const reportCount = Array.isArray(state?.dailyReports) ? state.dailyReports.length : 0;
      
      if (isBiSourceEnabled('daily_reports') && reportCount < 100) {
        await safeExecute('data_completeness_report', async () => {
          await AgentCommunicationHelper.reportDataSourceIssue(
            'daily_reports',
            `营业数据量不足: ${reportCount} 条记录`,
            '可能影响异常检测准确性',
            '建议检查数据采集机制'
          );
        });
        issues.push('daily_reports');
      }
    } catch (error) {
      safeErrorLog('data_auditor_completeness', error);
    }
    
    return issues;
  }, []);
}

_tableVisitMetricsApi = createTableVisitMetricsApi({
  pool,
  bitableConfigs: BITABLE_CONFIGS,
  normalizeBitableDateValue,
  extractDissatisfactionDishFromFields,
  extractDissatisfactionReasonFromFields,
  extractBitableFieldText,
  inDateRangeInclusive,
  normalizeStoreKey,
  normProductKey,
});

_marginMetricsApi = createMarginMetricsApi({
  pool,
  log,
  toNum,
  normProductKey,
  inDateRangeInclusive,
  normalizeStoreKey,
  setReportPool,
});

_auditImage = createAuditImage({
  pool,
  log,
  callVisionLLM,
  getOpsAgentConfig: () => OPS_AGENT_CONFIG,
});

_getOpsKnowledgeSupport = createGetOpsKnowledgeSupport({
  log,
  callLLM,
  queryAgentData,
  getOpsAgentConfig: () => OPS_AGENT_CONFIG,
  getOpsReasoningModel,
});

_runDataAuditor = createRunDataAuditor({
  pool,
  getSharedState,
  getStoresFromState,
  resolveBrandContextByStore,
  inferBrandFromStoreName,
  findStoreManager,
  refreshBiAgentRuntimeConfig,
  isBiSourceEnabled,
  getStoreThreshold,
  loadTableVisitMetricsByStore,
  checkDataSourceQuality,
  normalizeStoreKey,
  normalizeCanonicalStoreName,
});

_runBiFunctionTool = createRunBiFunctionTool({
  pool,
  normalizeStoreLike,
  formatDate,
  logAgentOperation,
  getBadReviewTableId: () => BITABLE_CONFIGS?.bad_reviews?.tableId || '',
  normalizeBitableDateValue,
  extractBitableFieldText,
  isLikelySameStore,
  inDateRangeInclusive,
  loadUnifiedTableVisitRowsByStore,
});

// Wave P2: LLM client cluster → domains/ai/*
{
  const tenantLlm = createTenantLlmConfigCache({
    pool,
    getTenantAiModelConfig,
  });
  _invalidateTenantLlmConfigCache = tenantLlm.invalidateTenantLlmConfigCache;

  const loadTenantAiConfig = createLoadTenantAiConfig({
    resolveTenantIdDefault,
    agentPool,
  });

  _callLLM = createCallLLM({
    isExternalEnabled,
    isAiQualityExternalEnabled,
    getModelTier,
    getModelForRole,
    getTemperatureForRole,
    getMaxTokensForRole,
    isTierBudgetExceeded,
    tenantContext,
    resolveTenantLlmConfig: tenantLlm.resolveTenantLlmConfig,
    getCachedResponse,
    setCachedResponse,
    performanceMetrics: _performanceMetrics,
    maskLLMMessages,
    axios,
    sanitizeLLMOutputWithAudit,
    sanitizeLLMOutput,
    pool,
    trackLLMCall,
    trackLLMResult,
  });

  _callVisionLLM = createCallVisionLLM({
    loadTenantAiConfig,
    getOpsVisionModel,
    axios,
    trackLLMResult,
  });

  _callVisionLLMVideo = createCallVisionLLMVideo({
    loadTenantAiConfig,
    axios,
    trackLLMResult,
  });
}

_tryHandleBiByFunctionCalling = createTryHandleBiByFunctionCalling({
  pool,
  getModelTier,
  getAvailableTools,
  isToolAllowed,
  isTierBudgetExceeded,
  parseFeishuMarketingCopyTemplate,
  clampInt,
  runBiFunctionTool,
  narrateBiToolResult,
  pushBiConversationTurn,
  getBiConversationHistory,
  buildBiIntentPlan,
  callLLM,
  getBiReasoningModel,
  BI_FUNCTION_TOOLS,
  parseToolArgs,
  buildBiFactSourceAudit,
  buildBiSourceAuditText,
});

_buildBiDeterministicDailyReportReply = createBuildBiDeterministicDailyReportReply({
  pool,
  resolveDateRangeFromQuestion,
  normalizeStoreLike,
  normalizeStoreKey,
});

_buildBiDeterministicSalesRawTopReply = createBuildBiDeterministicSalesRawTopReply({
  pool,
  resolveDateRangeFromQuestion,
  normalizeStoreKey,
  normalizeStoreLike,
});

_buildBiDeterministicBadReviewReportReply = createBuildBiDeterministicBadReviewReportReply({
  pool,
  resolveDateRangeFromQuestion,
  getBadReviewTableId: () => BITABLE_CONFIGS?.bad_reviews?.tableId || '',
  extractBitableFieldText,
  isLikelySameStore,
  normalizeBitableDateValue,
  inDateRangeInclusive,
  loadUnifiedTableVisitRowsByStore,
});

const _cascadeBiReplies = createDeterministicCascadeReplies({
  pool,
  isBiSourceEnabled,
  resolveDateRangeFromQuestion,
  loadUnifiedTableVisitRowsByStore,
  extractTableVisitDishes,
  extractBitableFieldText,
  isLikelySameStore,
  normalizeBitableDateValue,
  inDateRangeInclusive,
  getClosingTableId: () => BITABLE_CONFIGS?.closing_reports?.tableId || '',
  getOpeningTableId: () => BITABLE_CONFIGS?.opening_reports?.tableId || '',
  getMeetingTableId: () => BITABLE_CONFIGS?.meeting_reports?.tableId || '',
  getLossTableId: () => BITABLE_CONFIGS?.loss_reports?.tableId || '',
  getMaterialTableIds: () => [
    BITABLE_CONFIGS?.material_hongchao?.tableId,
    BITABLE_CONFIGS?.material_majixian?.tableId,
  ].filter(Boolean),
});
_buildBiDeterministicDataSourceCoverageReply = _cascadeBiReplies.buildBiDeterministicDataSourceCoverageReply;
_buildBiDeterministicTableVisitReply = _cascadeBiReplies.buildBiDeterministicTableVisitReply;
_buildBiDeterministicOpsReportCountReply = _cascadeBiReplies.buildBiDeterministicOpsReportCountReply;
_buildBiDeterministicClosingReportReply = _cascadeBiReplies.buildBiDeterministicClosingReportReply;
_buildBiDeterministicOpeningReportReply = _cascadeBiReplies.buildBiDeterministicOpeningReportReply;
_buildBiDeterministicMaterialReportReply = _cascadeBiReplies.buildBiDeterministicMaterialReportReply;
_buildBiDeterministicMeetingReportReply = _cascadeBiReplies.buildBiDeterministicMeetingReportReply;
_buildBiDeterministicLossReportReply = _cascadeBiReplies.buildBiDeterministicLossReportReply;



handleDataAuditorCase = createHandleDataAuditorCase({
  pool,
  inferBrandFromStoreName,
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
  getFeatureFlags: () => AGENT_FEATURE_FLAGS,
});

_routeMessage = createRouteMessage({
  pool,
  callLLM,
  matchAnalysisRule,
  logExecutorEvent,
  getFeatureFlags: () => AGENT_FEATURE_FLAGS,
  getAgentLongMemory,
});

_checkAgentQualityApi = createCheckAgentQualityApi({
  callLLM,
  log,
  markQualityMetric,
  recordAgentQualityAudit,
});

_handleAgentMessage = createHandleAgentMessage({
  pool,
  routeMessage,
  prefixWithAgentName,
  callLLM,
  getContext,
  updateContext,
  getBrandRuntimeConfig,
  getSharedState,
  inferBrandFromStoreName,
  runWithCheckAgent,
  enforceUnifiedQualityGate,
  markQualityMetric,
  setAgentLongMemory,
  getEmployeePositionForKb,
  queryKnowledgeBase,
  getOpsKnowledgeSupport,
  getOpsReasoningModel,
  auditImage,
  findStoreManager,
  createOrUpdateAutonomousDataTask,
  notifyAutonomousDataTaskOwner,
  handleDataAuditorCase,
});

_archiveOldBitableSubmissions = createArchiveOldBitableSubmissions({
  pool,
  archiveThresholdDays: 7,
  deleteThresholdDays: 60,
});

_bitableRecordsClient = createBitableRecordsClient({
  bitableConfigs: BITABLE_CONFIGS,
  axios,
  sleep,
});

_processBitableData = createProcessBitableData({
  pool,
  bitableConfigs: BITABLE_CONFIGS,
  tenantContext,
  extractDissatisfactionDishFromFields,
  extractDissatisfactionReasonFromFields,
  normalizeBitableDateValue,
  normalizeCanonicalStoreName,
  extractBitableFieldText,
});


_getBitableSubmissionStats = createGetBitableSubmissionStats({
  pool,
});

_buildScheduledTasksFromConfig = createBuildScheduledTasksFromConfig({
  getOpsAgentConfig: () => OPS_AGENT_CONFIG,
  isBlockedOpsChecklistPattern,
});

_executeScheduledTask = createExecuteScheduledTask({
  sendScheduledChecklist,
  sendSafetyCheck,
  refreshOpsAgentRuntimeConfig,
  buildScheduledTasksFromConfig,
  isBlockedOpsChecklistPattern,
  getOpsAgentConfig: () => OPS_AGENT_CONFIG,
  scheduledTaskRuntimeStatus: _scheduledTaskRuntimeStatus,
});

_sendSafetyCheck = createSendSafetyCheck({
  getSharedState,
  isLikelySameStore,
  normalizeStoreKey,
  lookupFeishuUserByUsername,
  sendLarkCard,
  sendLarkMessage,
  prefixWithAgentName,
  opsTaskReplyAuditLarkMd: OPS_TASK_REPLY_AUDIT_LARK_MD,
});

_fetchStoreRatingForProfileDisplay = createFetchStoreRatingForProfileDisplay({
  pool,
  resolveAgentCanonicalStore,
  dailyReportIlikePatterns,
  feishuStoreSearchPatterns,
});

_runChiefEvaluator = createRunChiefEvaluator({
  pool,
  getSharedState,
  getStoresFromState,
  resolveBrandContextByStore,
  inferBrandFromStoreName,
  getBrandRuntimeConfig,
  calculateStoreRating,
  calculateEmployeeScore,
  callLLM,
});

_sendScheduledChecklist = createSendScheduledChecklist({
  pool,
  getSharedState,
  isLikelySameStore,
  normalizeStoreKey,
  lookupFeishuUserByUsername,
  sendLarkCard,
  formatChecklistTypeLabel,
  getOpsChecklistItems,
  opsTaskReplyAuditLarkMd: OPS_TASK_REPLY_AUDIT_LARK_MD,
  shouldSkipHrmsScheduledChecklist,
});

_opsChecklistCardsApi = createOpsChecklistCardsApi({
  getOpsAgentConfig: () => OPS_AGENT_CONFIG,
});
_opsChecklistProgress = _opsChecklistCardsApi.opsChecklistProgress;

_handleOpsChecklistCardAction = createHandleOpsChecklistCardAction({
  pool,
  lookupFeishuUser,
  sendLarkMessage,
  sendLarkCard,
  getSharedState,
  resolveBrandContextByStore,
  getOpsChecklistProgressKey,
  getOpsChecklistItems,
  opsChecklistProgress: _opsChecklistProgress,
  buildOpsChecklistAbnormalItemsCard,
  prefixWithAgentName,
  formatChecklistTypeLabel,
  countOpsChecklistAbnormal,
  resolveTenantIdDefault,
});

_tryFeishuMarketingCopyRound = createTryFeishuMarketingCopyRound({
  callLLM,
  callVisionLLM,
  sendLarkMessage,
  prefixWithAgentName,
  log,
});

_feishuUserMessagingApi = createFeishuUserMessagingApi({
  getLarkTenantToken,
  axios,
  pool,
  tenantContext,
  getActiveTenantIds,
  getSharedState,
  registerFeishuUser,
  sendLarkMessage,
  log,
});

_onFeishuEvent = createOnFeishuEvent({
  pool,
  lookupFeishuUser,
  tryAutoBindByName,
  registerFeishuUser,
  sendLarkMessage,
  sendLarkCard,
  getLarkImageUrl,
  recognizeLarkAudio,
  getSharedState,
  resolveBrandContextByStore,
  routeMessage,
  checkAgentPermission,
  prefixWithAgentName,
  handleAgentMessage,
  handleOpsChecklistCardAction,
  tryCaptureOpsChecklistDetailFromChat,
  tryFeishuMarketingCopyRound,
  detectOpsChecklistType,
  getTaskResponseHook: () => _taskResponseHook,
});

_pollBitableSubmissions = createPollBitableSubmissions({
  pool,
  bitableConfigs: BITABLE_CONFIGS,
  processedRecordIds: _bitableProcessedRecordIds,
  lastProcessedTime: _bitableLastProcessedTime,
  seedBitableDedup,
  getBitableRecords,
  extractRelationsFromBitableRecord,
  processBitableData,
  validateSubmissionLogic,
  validatePhotoAuthenticity,
  getBitableRecordImageDownloadUrl,
  callVisionLLM,
  extractScore,
  deduplicateMessage,
  sendLarkMessage,
  prefixWithAgentName,
});


async function getLastSyncTime(configKey) {
  // 这里可以实现实际的同步时间检查逻辑
  // 暂时返回当前时间减去随机延迟
  return Date.now() - Math.random() * 5 * 60 * 1000;
}

// Ops Agent 任务执行质量检查
async function checkTaskExecutionQuality(storeName, brand, failedCount, duplicateCount) {
  return safeExecute('ops_agent_quality_check', async () => {
    // 如果失败率过高，报告问题
    const totalAudits = await getRecentAuditCount(storeName, 7); // 最近7天
    const failureRate = totalAudits > 0 ? failedCount / totalAudits : 0;
    
    if (failureRate > 0.15) { // 失败率超过15%
      await safeExecute('task_execution_issue_report', async () => {
        await AgentCommunicationHelper.reportTaskExecutionIssue(
          '图片审核',
          `图片审核失败率过高: ${(failureRate * 100).toFixed(1)}%`,
          failureRate,
          '建议优化审核算法或增加人工复核'
        );
      });
    }
    
    // 如果重复图片过多，报告问题
    const duplicateRate = totalAudits > 0 ? duplicateCount / totalAudits : 0;
    if (duplicateRate > 0.10) { // 重复率超过10%
      await safeExecute('duplicate_image_issue_report', async () => {
        await AgentCommunicationHelper.reportTaskExecutionIssue(
          '图片审核',
          `重复图片率过高: ${(duplicateRate * 100).toFixed(1)}%`,
          duplicateRate,
          '建议加强反作弊机制和用户教育'
        );
      });
    }
  });
}

async function getRecentAuditCount(storeName, days) {
  try {
    const result = await pool().query(`
      SELECT COUNT(*) as count 
      FROM agent_visual_audits 
      WHERE store = $1 
        AND created_at >= NOW() - make_interval(days => $2)
    `, [storeName, Math.max(1, Math.floor(Number(days) || 7))]);
    
    return Number(result.rows[0]?.count || 0);
  } catch (error) {
    log.error('[ops_agent] Failed to get audit count:', error);
    return 0;
  }
}

// 13. Weekly BI Report Scheduler (Monday 10am CST)
/** 种子店名（与 DB 中实际名称可能不一致时，仍会与库中 DISTINCT 店名合并） */
const REPORT_STORES_SEED = ALL_STORE_NAMES;

async function getReportStoresForBiReports(tenantId = 'default') {
  const seed = REPORT_STORES_SEED.slice();
  try {
    const r = await agentPool.query(`
      SELECT DISTINCT TRIM(store) AS store FROM pos_sales_detail
      WHERE date >= (CURRENT_DATE - INTERVAL '120 days')
        AND TRIM(COALESCE(store, '')) <> '' AND tenant_id = $1
      UNION
      SELECT DISTINCT TRIM(store) AS store FROM daily_reports
      WHERE date >= (CURRENT_DATE - INTERVAL '120 days')
        AND TRIM(COALESCE(store, '')) <> '' AND tenant_id = $1
    `, [tenantId]);
    const fromDb = (r.rows || []).map((x) => String(x.store || '').trim()).filter(Boolean);
    const set = new Set([...seed, ...fromDb]);
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
  } catch (e) {
    log.error('[bi-report] getReportStoresForBiReports failed:', e?.message);
    return seed;
  }
}
function splitMarkdownForCard(md, maxLen = 3600) {
  const text = String(md || '');
  if (!text) return [''];
  if (text.length <= maxLen) return [text];
  const lines = text.split('\n');
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line;
    const isSectionStart = /^##\s/.test(line) || /^###\s/.test(line);
    if (next.length > maxLen && cur) {
      chunks.push(cur);
      cur = line;
      continue;
    }
    if (isSectionStart && cur.length > Math.floor(maxLen * 0.75)) {
      chunks.push(cur);
      cur = line;
      continue;
    }
    cur = next;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** 月报投递：匹配该门店的飞书店长（店名字段与 canonical / 日报别名对齐） */
async function feishuStoreManagersForMonthlyReport(storeDisplayName) {
  const canon = String(resolveAgentCanonicalStore(storeDisplayName) || storeDisplayName).trim();
  const pats = [...new Set([
    ...dailyReportIlikePatterns(storeDisplayName),
    ...dailyReportIlikePatterns(canon)
  ])].filter((x) => x && String(x).length > 1);
  const patArr = pats.length ? pats : [`%${String(storeDisplayName).replace(/%/g, '')}%`];
  try {
    const r = await pool().query(
      `SELECT username FROM feishu_users
       WHERE COALESCE(registered, false) = true
         AND TRIM(COALESCE(open_id, '')) <> ''
         AND role = 'store_manager'
         AND (
           TRIM(COALESCE(store, '')) = $1
           OR TRIM(COALESCE(store, '')) = $2
           OR TRIM(COALESCE(store, '')) ILIKE ANY($3::text[])
         )`,
      [storeDisplayName, canon, patArr]
    );
    const seen = new Set();
    const out = [];
    for (const row of r.rows || []) {
      const u = String(row.username || '').trim();
      const k = u.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ username: u });
    }
    return out;
  } catch (e) {
    log.error('[bi-report] feishuStoreManagersForMonthlyReport failed:', e?.message);
    return [];
  }
}

function uniqBiReportRecipients(list) {
  const seen = new Set();
  return (list || []).filter((u) => {
    const k = String(u?.username || '').trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function sendBiReportToAdmins({ admins, title, note, md, cardTemplate = 'blue' }) {
  const chunks = splitMarkdownForCard(md, 3600);
  for (const a of admins) {
    const fu = await lookupFeishuUserByUsername(a.username);
    if (!fu?.open_id) continue;
    for (let i = 0; i < chunks.length; i += 1) {
      const card = {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title },
          template: cardTemplate
        },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: chunks[i] } },
          { tag: 'note', elements: [{ tag: 'plain_text', content: note }] }
        ]
      };
      const s = await sendLarkCard(fu.open_id, card);
      if (!s.ok) {
        await sendLarkMessage(fu.open_id, prefixWithAgentName('data_auditor', chunks[i].slice(0, 3000)));
      }
    }
  }
}

export async function sendWeeklyReports(tenantId = 'default') {
  log.info(`[bi-report] generating weekly reports (tenant=${tenantId})...`);
  const { wsS, weS } = calendarLastCompletedWeekMonSunShanghai();
  const state = await getSharedState(tenantId);
  const adminsRaw = [...(state?.employees||[]),...(state?.users||[])].filter(u => ['admin','hq_manager'].includes(u?.role));
  const admins = uniqBiReportRecipients(adminsRaw);
  const stores = await getReportStoresForBiReports(tenantId);
  for (const store of stores) {
    try {
      const r = await generateWeeklyReport(store, wsS, weS);
      const md = formatReportMarkdown(r);
      await sendBiReportToAdmins({
        admins,
        title: `📊 ${store} 周报`,
        note: `小年·BI周报·${wsS}~${weS}`,
        md,
        cardTemplate: 'blue'
      });
      log.info(`[bi-report] sent ${store} report to ${admins.length} admins`);
    } catch (e) { log.error(`[bi-report] ${store} failed:`, e?.message); }
  }
}

export async function sendMonthlyReports(tenantId = 'default') {
  log.info(`[bi-report] generating monthly reports (tenant=${tenantId})...`);
  const { msS, meS } = calendarPreviousMonthRangeShanghai();
  const state = await getSharedState(tenantId);
  const adminsRaw2 = [...(state?.employees || []), ...(state?.users || [])].filter(u => ['admin','hq_manager'].includes(u?.role));
  const baseRecipients = uniqBiReportRecipients(adminsRaw2);
  const stores = await getReportStoresForBiReports(tenantId);
  for (const store of stores) {
    try {
      const r = await generateMonthlyReport(store, msS, meS);
      const md = formatReportMarkdown(r);
      const managers = await feishuStoreManagersForMonthlyReport(store);
      const admins = uniqBiReportRecipients([...baseRecipients, ...managers]);
      await sendBiReportToAdmins({
        admins,
        title: `📈 ${store} 月报`,
        note: `小年·BI月报·${msS}~${meS}`,
        md,
        cardTemplate: 'turquoise'
      });
      log.info(`[bi-report] sent ${store} monthly report to ${admins.length} recipients (admin/hq + store managers)`);
    } catch (e) { log.error(`[bi-report] ${store} monthly failed:`, e?.message); }
  }
}

export async function sendTestReportsToUser(targetUsername, tenantId = 'default') {
  log.info('[bi-report] test send to user:', targetUsername);
  const fu = await lookupFeishuUserByUsername(targetUsername);
  if (!fu?.open_id) {
    log.error('[bi-report] user not found or not bound to Feishu:', targetUsername);
    return { ok: false, error: 'user_not_found_or_not_bound', username: targetUsername };
  }
  const testAdmins = [{ username: targetUsername }];
  const results = [];

  // 周报：上一完整自然周（上海历）
  const { wsS, weS } = calendarLastCompletedWeekMonSunShanghai();
  const stores = await getReportStoresForBiReports(tenantId);
  for (const store of stores) {
    try {
      const r = await generateWeeklyReport(store, wsS, weS);
      const md = formatReportMarkdown(r);
      await sendBiReportToAdmins({ admins: testAdmins, title: `📊 ${store} 周报`, note: `小年·BI周报·${wsS}~${weS}`, md, cardTemplate: 'blue' });
      results.push({ type: 'weekly', store, ok: true });
      log.info(`[bi-report] test weekly sent: ${store} → ${targetUsername}`);
    } catch (e) {
      results.push({ type: 'weekly', store, ok: false, error: e?.message });
      log.error(`[bi-report] test weekly failed: ${store}`, e?.message);
    }
  }

  // 月报：上一自然月（上海历）
  const { msS, meS } = calendarPreviousMonthRangeShanghai();
  for (const store of stores) {
    try {
      const r = await generateMonthlyReport(store, msS, meS);
      const md = formatReportMarkdown(r);
      await sendBiReportToAdmins({ admins: testAdmins, title: `📈 ${store} 月报`, note: `小年·BI月报·${msS}~${meS}`, md, cardTemplate: 'turquoise' });
      results.push({ type: 'monthly', store, ok: true });
      log.info(`[bi-report] test monthly sent: ${store} → ${targetUsername}`);
    } catch (e) {
      results.push({ type: 'monthly', store, ok: false, error: e?.message });
      log.error(`[bi-report] test monthly failed: ${store}`, e?.message);
    }
  }

  return { ok: true, results, targetUsername };
}

export function startWeeklyReportScheduler() {
  // DISABLED 2026-04-21: 周报/月报已合并到 Agents v2 本周运营周报（周一10:06飞书卡片）和本月运营月报（每月10日10:18飞书卡片）
  // 原来 HRMS 侧的纯文本周报(周一10:00)和月报(每月1日10:00)不再单独发送
  log.info('[bi-report] weekly/monthly report scheduler DISABLED — merged into Agents v2 rhythm-engine');
}
