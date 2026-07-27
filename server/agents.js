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
import {
  getOpsAgentConfig as loadOpsAgentConfigRemote,
  getBiAgentConfig as loadBiAgentConfigRemote,
  AGENT_FEATURE_FLAGS,
} from './agent-config-manager.js';
import { createAgentRuntimeConfig } from './domains/agent-runtime/runtime-config.js';
import {
  buildEvidencePackage,
  detectFactDemand,
  isDataBackedReply,
} from './domains/agent-message/quality-helpers.js';
import { createHandleAgentMessage } from './domains/agent-message/handle-agent-message.js';
import { createRouteMessage } from './domains/agent-message/route-message.js';
import { createHandleOpsChecklistCardAction } from './domains/agent-ops/handle-checklist-card-action.js';
import { createOpsChecklistCardsApi } from './domains/agent-ops/checklist-cards.js';
import { createTryCaptureOpsChecklistDetailFromChat } from './domains/agent-ops/capture-checklist-detail.js';
import { createFollowUpOverdueTasks } from './domains/agent-ops/follow-up-overdue-tasks.js';
import { createAuditImage } from './domains/agent-ops/audit-image.js';
import { createTryFeishuMarketingCopyRound } from './domains/agent-message/marketing-copy.js';
import { createCheckAgentQualityApi } from './domains/agent-message/check-agent-quality.js';
import { createAgentQualityAutonomyApi } from './domains/agent-message/agent-quality-autonomy.js';
import { createAgentMessageRuntime } from './domains/agent-message/runtime.js';
import { parseFeishuMarketingCopyTemplate } from './domains/agent-message/marketing-copy-helpers.js';
import { createGetOpsKnowledgeSupport } from './domains/agent-ops/knowledge-support.js';
import { createSendScheduledChecklist } from './domains/agent-ops/send-scheduled-checklist.js';
import { createRunChiefEvaluator } from './domains/agent-evaluator/run-chief-evaluator.js';
import { createSendSafetyCheck } from './domains/agent-ops/send-safety-check.js';
import { createFetchStoreRatingForProfileDisplay } from './domains/agent-evaluator/fetch-store-rating-for-profile.js';
import { createArchiveOldBitableSubmissions } from './domains/feishu-bitable/archive-old-submissions.js';
import { createExecuteScheduledTask } from './domains/agent-ops/execute-scheduled-task.js';
import { createScheduledTaskRuntimeApi } from './domains/agent-ops/scheduled-task-runtime.js';
import { createGetBitableSubmissionStats } from './domains/feishu-bitable/get-submission-stats.js';
import { createBuildScheduledTasksFromConfig } from './domains/agent-ops/build-scheduled-tasks-from-config.js';
import { createHandleDataAuditorCase } from './domains/agent-message/handle-data-auditor-case.js';
import { createOnFeishuEvent } from './domains/agent-feishu-bot/on-feishu-event.js';
import { createFeishuUserMessagingApi } from './domains/agent-feishu-bot/feishu-user-messaging.js';
import { createLarkSendApi } from './domains/agent-feishu-bot/lark-send.js';
import { createPushIssuesToFeishu } from './domains/agent-feishu-bot/push-issues.js';
import { createTryHandleBiByFunctionCalling } from './domains/agent-bi/try-handle-bi-by-function-calling.js';
import { clampInt } from './domains/agent-bi/bi-tool-period.js';
import { createRunBiFunctionTool } from './domains/agent-bi/run-bi-function-tool.js';
import { createBiFunctionCallingSupport } from './domains/agent-bi/function-calling-support.js';
import { createBuildBiDeterministicDailyReportReply } from './domains/agent-bi/build-daily-report-reply.js';
import { createBuildBiDeterministicSalesRawTopReply } from './domains/agent-bi/build-sales-raw-top-reply.js';
import { createBuildBiDeterministicBadReviewReportReply } from './domains/agent-bi/build-bad-review-report-reply.js';
import { createBiQueryHelpersApi } from './domains/agent-bi/bi-query-helpers.js';
import { createSendPeriodReportsApi } from './domains/agent-bi/send-period-reports.js';
import { createDeterministicCascadeReplies } from './domains/agent-bi/deterministic-cascade-replies.js';
import { createPollBitableSubmissions } from './domains/feishu-bitable/poll-submissions.js';
import { createOpsSubmissionValidation } from './domains/agent-ops/submission-validation.js';
import {
  normalizeBitableDateValue,
  extractBitableFieldText,
  extractDissatisfactionDishFromFields,
  extractDissatisfactionReasonFromFields,
  extractTableVisitItems,
} from './domains/feishu-bitable/field-normalization.js';
import { createAgentBrandRuntimeContext } from './domains/agent-brand/runtime-context.js';
import { createAgentStoreIdentity } from './domains/agent-store/identity.js';
import { createNotifyBitablePipelineFailure } from './domains/feishu-bitable/pipeline-failure-notify.js';
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
import { createLlmHealthSchedulerApi } from './domains/ai/llm-health-scheduler.js';
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

const {
  refreshBiAgentRuntimeConfig,
  refreshOpsAgentRuntimeConfig,
  getStoreThreshold,
  isBiSourceEnabled,
  getBiReasoningModel,
  getOpsReasoningModel,
  getOpsVisionModel,
  getOpsAgentConfig,
} = createAgentRuntimeConfig({
  getBiAgentConfig: loadBiAgentConfigRemote,
  getOpsAgentConfig: loadOpsAgentConfigRemote,
  log,
  deepseekModel: DEEPSEEK_MODEL,
  deepseekVisionModel: DEEPSEEK_VISION_MODEL,
});

// Provider health / fallback chain → domains/ai/llm-provider-helpers.js

function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

const AGENT_EVAL_CASES = [
  { text: '近7天门店营业额达成率怎么样', route: 'data_auditor', demand: 'hard' },
  { text: '帮我看下差评最多的菜品', route: 'data_auditor', demand: 'hard' },
  { text: '我要开市检查表', route: 'ops_supervisor', demand: 'soft' },
  { text: '这条绩效扣分我想申诉', route: 'appeal', demand: 'soft' },
  { text: '我想咨询离职流程', route: 'chief_evaluator', demand: 'soft' },
  { text: '这个SOP退款标准怎么执行', route: 'train_advisor', demand: 'soft' },
  { text: '你好', route: 'general', demand: 'none' }
];

function normalizePlainText(text, maxLen = 1200) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

// P2: clampInt / resolveToolPeriod / execBiTool* / runBiFunctionTool → domains/agent-bi/
let _runBiFunctionTool;
async function runBiFunctionTool(toolName, store, args = {}, originalQuery = '', ctx = {}) {
  return _runBiFunctionTool(toolName, store, args, originalQuery, ctx);
}

let _tryHandleBiByFunctionCalling;
async function tryHandleBiByFunctionCalling({ text, store, brand, senderRole, senderUsername }) {
  return _tryHandleBiByFunctionCalling({ text, store, brand, senderRole, senderUsername });
}

// BI query helpers → domains/agent-bi/bi-query-helpers.js
let _biQueryHelpersApi;
function resolveDateRangeFromQuestion(text, dd = 7) {
  return _biQueryHelpersApi.resolveDateRangeFromQuestion(text, dd);
}
function isFactLikeQuestion(text) {
  return _biQueryHelpersApi.isFactLikeQuestion(text);
}

let _buildBiDeterministicDataSourceCoverageReply;
async function buildBiDeterministicDataSourceCoverageReply(text) {
  return _buildBiDeterministicDataSourceCoverageReply(text);
}


function resolveBiRelevantSourceKeys(text) {
  return _biQueryHelpersApi.resolveBiRelevantSourceKeys(text);
}
async function buildBiFactSourceAudit(store, text) {
  return _biQueryHelpersApi.buildBiFactSourceAudit(store, text);
}
function buildBiSourceAuditText(auditRows = []) {
  return _biQueryHelpersApi.buildBiSourceAuditText(auditRows);
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
    appId: process.env.BITABLE_OPS_APP_ID || (!_isProd ? 'cli_a91dae9f9578dcb1' : ''),
    appSecret: process.env.BITABLE_OPS_APP_SECRET || '',
    appToken: process.env.BITABLE_OPS_APP_TOKEN || 'PtVObRtoPaMAP3stIIFc8DnJngd',
    tableId: process.env.BITABLE_OPS_TABLE_ID || 'tblxHI9ZAKONOTpp',
    name: '运营检查表(含开收档)',
    type: 'checklist',
    pollingInterval: 60000,
    sortField: '["_id DESC"]'
  },
  'table_visit': {
    // App ID：生产必须走 env（已配 BITABLE_*_APP_ID）；非生产保留本地开发兜底
    appId: process.env.BITABLE_TABLEVISIT_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_TABLEVISIT_APP_SECRET || '',
    appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_TABLEVISIT_TABLE_ID || 'tblpx5Efqc6eHo3L',
    name: '桌访表',
    type: 'table_visit',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'bad_reviews': {
    appId: process.env.BITABLE_TABLEVISIT_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_TABLEVISIT_APP_SECRET || '',
    appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: 'tblgReexNjWJOJB6',
    name: '差评报告DB',
    type: 'bad_review',
    pollingInterval: 300000,
    sortField: '["创建日期 DESC"]'
  },
  'closing_reports': {
    appId: process.env.BITABLE_CLOSING_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_CLOSING_APP_SECRET || '',
    appToken: process.env.BITABLE_CLOSING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_CLOSING_TABLE_ID || 'tblXYfSBRrgNGohN',
    name: '收档报告DB',
    type: 'closing_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'opening_reports': {
    appId: process.env.BITABLE_OPENING_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_OPENING_APP_SECRET || '',
    appToken: process.env.BITABLE_OPENING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_OPENING_TABLE_ID || 'tbl32E6d0CyvLvfi',
    name: '开档报告',
    type: 'opening_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'meeting_reports': {
    appId: process.env.BITABLE_MEETING_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_MEETING_APP_SECRET || '',
    appToken: process.env.BITABLE_MEETING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_MEETING_TABLE_ID || 'tblZXgaU0LpSye2m',
    name: '例会报告',
    type: 'meeting_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'material_majixian': {
    appId: process.env.BITABLE_MATERIAL_MJX_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
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
    appId: process.env.BITABLE_MATERIAL_HC_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
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
    appId: process.env.BITABLE_LOSS_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
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
      (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
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

function formatChecklistTypeLabel(checkType) {
  return _opsChecklistCardsApi.formatChecklistTypeLabel(checkType);
}

// checklist skip filters + timers → domains/agent-ops/scheduled-task-runtime*.js
let _scheduledTaskRuntimeApi;
function isBlockedOpsChecklistPattern(checkType, taskKey = '') {
  return _scheduledTaskRuntimeApi.isBlockedOpsChecklistPattern(checkType, taskKey);
}
function shouldSkipHrmsScheduledChecklist(config) {
  return _scheduledTaskRuntimeApi.shouldSkipHrmsScheduledChecklist(config);
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

const {
  normalizeBrandId,
  getBrandsFromState,
  getBrandRuntimeConfig,
  resolveBrandContextByStore,
} = createAgentBrandRuntimeContext({
  getBrandConfigSync,
  resolveTenantIdDefault,
  inferBrandFromStoreName: _inferBrandFromStoreNameImpl,
});
export { resolveBrandContextByStore };

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

// 上下文 / 响应缓存 / KB+Bitable 检索 → domains/agent-message/runtime*.js
const _agentMessageRuntime = createAgentMessageRuntime({
  pool,
  resolveTenantIdDefault,
  getSharedState: (...args) => getSharedState(...args),
  log,
});
const {
  getCachedResponse,
  setCachedResponse,
  updateContext,
  getContext,
  getEmployeePositionForKb,
  performanceMetrics: _performanceMetrics,
} = _agentMessageRuntime;

export async function queryKnowledgeBase(agent, query, limit = 5, options = {}) {
  return _agentMessageRuntime.queryKnowledgeBase(agent, query, limit, options);
}
export async function queryBitableData(agent, query, limit = 10, options = {}) {
  return _agentMessageRuntime.queryBitableData(agent, query, limit, options);
}
export async function queryAgentData(agent, query, limit = 10, options = {}) {
  return _agentMessageRuntime.queryAgentData(agent, query, limit, options);
}

// 质量审计 / 长期记忆 / 自治任务 → domains/agent-message/agent-quality-autonomy*.js
let _agentQualityAutonomyApi;
function markQualityMetric(field, delta = 1) {
  return _agentQualityAutonomyApi.markQualityMetric(field, delta);
}
async function getAgentLongMemory(userKey, memoryKey) {
  return _agentQualityAutonomyApi.getAgentLongMemory(userKey, memoryKey);
}
async function setAgentLongMemory(userKey, memoryKey, value) {
  return _agentQualityAutonomyApi.setAgentLongMemory(userKey, memoryKey, value);
}
async function recordAgentQualityAudit(args) {
  return _agentQualityAutonomyApi.recordAgentQualityAudit(args);
}
async function createOrUpdateAutonomousDataTask(args) {
  return _agentQualityAutonomyApi.createOrUpdateAutonomousDataTask(args);
}
async function notifyAutonomousDataTaskOwner(task) {
  return _agentQualityAutonomyApi.notifyAutonomousDataTaskOwner(task);
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

// ─────────────────────────────────────────────
// 3. Shared State Helpers
// ─────────────────────────────────────────────

export async function getSharedState(tenantId = 'default') {
  const key = String(tenantId || '').trim() || 'default';
  const r = await pool().query('SELECT data FROM hrms_state WHERE key = $1 LIMIT 1', [key]);
  return r.rows?.[0]?.data && typeof r.rows[0].data === 'object' ? r.rows[0].data : {};
}

export function inferBrandFromStoreName(storeName) {
  return _inferBrandFromStoreNameImpl(storeName);
}

const {
  findUserInState,
  getStoresFromState,
  findStoreManager,
  normalizeStoreKey,
  normalizeStoreLike,
  normalizeCanonicalStoreName,
  isLikelySameStore,
  toNum,
  toDateOnly,
  inDateRangeInclusive,
  normProductKey,
} = createAgentStoreIdentity({
  normalizeBrandId,
  resolveBrandContextByStore,
  inferBrandFromStoreName: _inferBrandFromStoreNameImpl,
  storeCanonicalMap: _STORE_CANONICAL_MAP_IMPL,
});
export { getStoresFromState, findStoreManager };

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

/** 与 agents-service-v2 任务审核口径一致（仅 HRMS 内建调度启用时使用） */
const OPS_TASK_REPLY_AUDIT_LARK_MD =
  '**系统审核要求**\n' +
  '• 文字 **≥20 字**，或 **附现场照片**（满足其一可通过基础规则）\n' +
  '• 须说明 **现场情况**、**处理措施**；抽检/巡检类须写 **发现与处理结果**\n' +
  '• 勿仅用「收到」「无」「OK」等占位回复（易被退回；累计 3 次不合格记入绩效）';

let _buildScheduledTasksFromConfig;
function buildScheduledTasksFromConfig() {
  return _buildScheduledTasksFromConfig();
}

export function getScheduledTaskStatus() {
  return _scheduledTaskRuntimeApi.getScheduledTaskStatus();
}

export async function startScheduledTasks() {
  return _scheduledTaskRuntimeApi.startScheduledTasks();
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

// 飞书发送 / 注册 / 绩效文案清洗 → domains/agent-feishu-bot/lark-send*.js
let _larkSendApi;
export function sanitizePerformanceZhText(text) {
  return _larkSendApi.sanitizePerformanceZhText(text);
}

/**
 * 档案「门店级别」：默认取上月闭合月；若传入 lockedPeriodYm 则只查该月（不回落到「任意最新」，与档案冻结展示一致）
 */
let _fetchStoreRatingForProfileDisplay;
export async function fetchStoreRatingForProfileDisplay(storeLabel, lockedPeriodYm = null) {
  return _fetchStoreRatingForProfileDisplay(storeLabel, lockedPeriodYm);
}


export async function sendLarkMessage(openId, text, options = {}) {
  return _larkSendApi.sendLarkMessage(openId, text, options);
}
export async function sendLarkCard(openId, card, options = {}) {
  return _larkSendApi.sendLarkCard(openId, card, options);
}
export async function getLarkImageUrl(messageId, imageKey) {
  return _larkSendApi.getLarkImageUrl(messageId, imageKey);
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
  return _larkSendApi.registerFeishuUser(openId, username);
}
function buildAlertCard(title, severity, detail, actions) {
  return _larkSendApi.buildAlertCard(title, severity, detail, actions);
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
  const config = getOpsAgentConfig().scheduledTasks;
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
  const config = getOpsAgentConfig().scheduledTasks.dataTriggers;
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

// 执行闭环追踪 - 催办逻辑 → domains/agent-ops/follow-up-overdue-tasks.js
let _followUpOverdueTasks;
export async function followUpOverdueTasks() {
  return _followUpOverdueTasks();
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
  return _biQueryHelpersApi.buildBiGroundingFacts(store, text);
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

// Bitable 管道告警 → domains/feishu-bitable/pipeline-failure-notify.js
let _notifyBitablePipelineFailure;
async function notifyBitablePipelineFailure(scopeLabel, err, opts = {}) {
  return _notifyBitablePipelineFailure(scopeLabel, err, opts);
}

// Wave P2: Bitable LISTEN / catchup / archive → domains/feishu-bitable/*
_larkSendApi = createLarkSendApi({
  axios,
  pool,
  tenantContext,
  getLarkTenantToken,
  deduplicateMessage,
  feishuSkipOpenIdResolveHrms,
  isOpenIdCrossAppFeishuError,
  refreshFeishuUserOpenIdForImDeliveryHrms,
  getSharedState,
  findUserInState,
  resolveBrandContextByStore,
  log,
});

_notifyBitablePipelineFailure = createNotifyBitablePipelineFailure({
  pool,
  sendLarkMessage,
  log,
});

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

// 检查单聊天补录 → domains/agent-ops/capture-checklist-detail.js
let _tryCaptureOpsChecklistDetailFromChat;
async function tryCaptureOpsChecklistDetailFromChat(openId, feishuUser, text, imageUrls) {
  return _tryCaptureOpsChecklistDetailFromChat(openId, feishuUser, text, imageUrls);
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

// Push new issues → domains/agent-feishu-bot/push-issues.js
let _pushIssuesToFeishu;
export async function pushIssuesToFeishu(tenantId = 'default') {
  return _pushIssuesToFeishu(tenantId);
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
// 13. Scheduler / LLM health → domains/ai/llm-health-scheduler*.js
// ─────────────────────────────────────────────

let _llmHealthSchedulerApi;
export async function verifyLLMHealth(options = {}) {
  return _llmHealthSchedulerApi.verifyLLMHealth(options);
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

export function trackLLMResult(ok) {
  return _llmHealthSchedulerApi.trackLLMResult(ok);
}

export function getAgentHealthStatus() {
  return _llmHealthSchedulerApi.getAgentHealthStatus();
}

export function startAgentScheduler() {
  return _llmHealthSchedulerApi.startAgentScheduler();
}

// ─────────────────────────────────────────────
// 15. Performance Monitoring API
// ─────────────────────────────────────────────

export function getAgentPerformanceMetrics() {
  return {
    ..._performanceMetrics,
    cacheHitRate: _performanceMetrics.totalCalls > 0 ? 
      (_performanceMetrics.cacheHits / _performanceMetrics.totalCalls * 100).toFixed(2) + '%' : '0%',
    contextSize: _agentMessageRuntime.getContextSize(),
    cacheSize: _agentMessageRuntime.getCacheSize(),
    quality: _agentQualityAutonomyApi ? _agentQualityAutonomyApi.getAgentQualityMetrics() : {},
    providerHealth: getProviderHealthStatus(),
    uptime: process.uptime()
  };
}

export function clearAgentCache() {
  _agentMessageRuntime.clearCaches();
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
  const cleaned = _agentMessageRuntime.clearExpiredResponseCache();
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
  getOpsAgentConfig,
});

_getOpsKnowledgeSupport = createGetOpsKnowledgeSupport({
  log,
  callLLM,
  queryAgentData,
  getOpsAgentConfig,
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

_llmHealthSchedulerApi = createLlmHealthSchedulerApi({
  isExternalEnabled,
  axios,
  markProviderOk,
  markProviderFail,
  getSharedState,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  getScheduledTaskStatus,
  getPerformanceMetrics: () => _performanceMetrics,
  pool,
  tenantContext,
  getActiveTenantIds,
  runDataAuditor,
  pushIssuesToFeishu,
  pushIssueToAssignee,
  pushScoresToFeishu,
  log,
  providerConfig: {
    deepseekModel: DEEPSEEK_MODEL,
    deepseekApiKey: DEEPSEEK_API_KEY,
    deepseekBaseUrl: DEEPSEEK_BASE_URL,
    qwenModel: QWEN_MODEL,
    qwenApiKey: QWEN_API_KEY,
    qwenBaseUrl: QWEN_BASE_URL,
    doubaoModel: DEEPSEEK_VISION_MODEL,
    doubaoApiKey: DOUBAO_API_KEY,
    doubaoBaseUrl: DOUBAO_BASE_URL,
  },
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

_biQueryHelpersApi = createBiQueryHelpersApi({
  formatDate,
  pool,
  normalizeStoreLike,
  normalizeStoreKey,
  isBiSourceEnabled,
  toDateOnly,
  extractBitableFieldText,
  normalizeBitableDateValue,
  isLikelySameStore,
  inDateRangeInclusive,
  loadUnifiedTableVisitRowsByStore,
  extractTableVisitItems,
});

const biFunctionCallingSupport = createBiFunctionCallingSupport({
  callLLM,
  getBiReasoningModel,
});

_tryHandleBiByFunctionCalling = createTryHandleBiByFunctionCalling({
  pool,
  getModelTier,
  getAvailableTools,
  isToolAllowed,
  isTierBudgetExceeded,
  parseFeishuMarketingCopyTemplate,
  clampInt,
  runBiFunctionTool,
  narrateBiToolResult: biFunctionCallingSupport.narrateBiToolResult,
  pushBiConversationTurn: biFunctionCallingSupport.pushBiConversationTurn,
  getBiConversationHistory: biFunctionCallingSupport.getBiConversationHistory,
  buildBiIntentPlan: biFunctionCallingSupport.buildBiIntentPlan,
  callLLM,
  getBiReasoningModel,
  BI_FUNCTION_TOOLS: biFunctionCallingSupport.BI_FUNCTION_TOOLS,
  parseToolArgs: biFunctionCallingSupport.parseToolArgs,
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

_agentQualityAutonomyApi = createAgentQualityAutonomyApi({
  pool,
  resolveTenantIdDefault,
  normalizeStoreKey,
  normalizePlainText,
  recordAiInteraction,
  recordAiFeedback,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  prefixWithAgentName,
  log,
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

_scheduledTaskRuntimeApi = createScheduledTaskRuntimeApi({
  refreshOpsAgentRuntimeConfig,
  buildScheduledTasksFromConfig,
  executeScheduledTask,
  log,
});

_buildScheduledTasksFromConfig = createBuildScheduledTasksFromConfig({
  getOpsAgentConfig,
  isBlockedOpsChecklistPattern,
});

_executeScheduledTask = createExecuteScheduledTask({
  sendScheduledChecklist,
  sendSafetyCheck,
  refreshOpsAgentRuntimeConfig,
  buildScheduledTasksFromConfig,
  isBlockedOpsChecklistPattern,
  getOpsAgentConfig,
  scheduledTaskRuntimeStatus: _scheduledTaskRuntimeApi.scheduledTaskRuntimeStatus,
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
  getOpsAgentConfig,
});
_opsChecklistProgress = _opsChecklistCardsApi.opsChecklistProgress;
_tryCaptureOpsChecklistDetailFromChat = createTryCaptureOpsChecklistDetailFromChat({
  opsChecklistProgress: _opsChecklistProgress,
  countOpsChecklistAbnormal,
  sendLarkMessage,
  prefixWithAgentName,
});

_followUpOverdueTasks = createFollowUpOverdueTasks({
  pool,
  getOpsAgentConfig,
  sendLarkMessage,
  prefixWithAgentName,
  log,
});



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

_pushIssuesToFeishu = createPushIssuesToFeishu({
  pool,
  lookupFeishuUserByUsername,
  sendLarkCard,
  sendLarkMessage,
  prefixWithAgentName,
  resolveTenantIdDefault,
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

let _sendPeriodReportsApi;
_sendPeriodReportsApi = createSendPeriodReportsApi({
  agentPool,
  pool,
  reportStoresSeed: ALL_STORE_NAMES,
  getSharedState,
  lookupFeishuUserByUsername,
  sendLarkCard,
  sendLarkMessage,
  prefixWithAgentName,
  generateWeeklyReport,
  generateMonthlyReport,
  formatReportMarkdown,
  calendarLastCompletedWeekMonSunShanghai,
  calendarPreviousMonthRangeShanghai,
  resolveAgentCanonicalStore,
  dailyReportIlikePatterns,
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

const {
  extractScore,
  validatePhotoAuthenticity,
  validateSubmissionLogic,
} = createOpsSubmissionValidation({
  pool,
  callVisionLLM,
  log,
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

// 13. Weekly BI Report Scheduler → domains/agent-bi/send-period-reports*.js
export async function sendWeeklyReports(tenantId = 'default') {
  return _sendPeriodReportsApi.sendWeeklyReports(tenantId);
}
export async function sendMonthlyReports(tenantId = 'default') {
  return _sendPeriodReportsApi.sendMonthlyReports(tenantId);
}
export async function sendTestReportsToUser(targetUsername, tenantId = 'default') {
  return _sendPeriodReportsApi.sendTestReportsToUser(targetUsername, tenantId);
}
export function startWeeklyReportScheduler() {
  return _sendPeriodReportsApi.startWeeklyReportScheduler();
}
