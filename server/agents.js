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
  isDataBackedReply,
} from './domains/agent-message/quality-helpers.js';
import { createAgentMessageRuntime } from './domains/agent-message/runtime.js';
import { parseFeishuMarketingCopyTemplate } from './domains/agent-message/marketing-copy-helpers.js';
import { prefixWithAgentName } from './domains/agent-message/agent-prefix.js';
import { checkAgentPermission } from './domains/agent-message/check-agent-permission.js';
import { createRunAgentEvalSuite } from './domains/agent-message/eval-suite.js';
import { buildFeishuCardFromAgentReply } from './domains/agent-message/feishu-reply-card.js';
export { prefixWithAgentName };
import { createLarkSendApi } from './domains/agent-feishu-bot/lark-send.js';
import { clampInt } from './domains/agent-bi/bi-tool-period.js';
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
import { createBitablePollingController } from './domains/feishu-bitable/start-bitable-polling.js';
import {
  buildKpiRadarAlertJson,
} from './domains/agent-auditor/run-data-auditor.js';
import {
  getLLMClientConfig,
  getProviderHealthStatus,
  markProviderFail,
  markProviderOk,
  resolveModelProvider,
  sleep,
} from './domains/ai/llm-provider-helpers.js';
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
  LARK_APP_ID,
  LARK_APP_SECRET,
  BITABLE_CONFIGS,
} from './domains/agent-bitable/configs.js';
import { createQualityChecksApi } from './domains/agent-auditor/quality-checks.js';
import { wireAgentsRuntime } from './domains/agent-runtime/wire.js';
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

// BITABLE_CONFIGS / LARK_APP_ID / LARK_APP_SECRET → domains/agent-bitable/configs.js

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

let _runChiefEvaluator;
export async function runChiefEvaluator(period, tenantId = 'default') {
  return _runChiefEvaluator(period, tenantId);
}


// ─────────────────────────────────────────────
// 9. Message Router
// ─────────────────────────────────────────────

async function buildBiGroundingFacts(store, text) {
  return _biQueryHelpersApi.buildBiGroundingFacts(store, text);
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

// Wave A2b: handleDataAuditorCase → domains/agent-message/handle-data-auditor-case.js (wired below,
// entirely internal to wireMessage's createHandleAgentMessage call — no module-level binding needed)




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
// (wireFeishu builds this internally and feeds it straight into createOnFeishuEvent — no
// module-level wrapper needed since nothing outside the wiring cluster calls it.)

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

export const runAgentEvalSuite = createRunAgentEvalSuite({
  pool,
  routeMessage: (text, hasImage, senderUsername) => routeMessage(text, hasImage, senderUsername),
  log,
});

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
// 辅助函数 - 数据源质量检查 → domains/agent-auditor/quality-checks.js
// ─────────────────────────────────────────────
// 延迟到调用时才构造：AgentCommunicationHelper 经 agent-communication-system.js →
// master-agent.js → agents.js 循环引用而来，模块顶层求值时可能仍是 TDZ。
function checkDataSourceQuality() {
  return createQualityChecksApi({
    pool,
    log,
    refreshBiAgentRuntimeConfig,
    safeExecute,
    safeErrorLog,
    isBiSourceEnabled,
    getSharedState,
    AgentCommunicationHelper,
    bitableConfigs: BITABLE_CONFIGS,
  }).checkDataSourceQuality();
}

let _sendPeriodReportsApi;

// P17: bottom `createXxx` wiring cluster peeled to domains/agent-runtime/wire*.js.
// wireAgentsRuntime(deps) performs the factory calls and returns a flat bag of APIs;
// agents.js just assigns them to its private `_foo` locals (public exports unchanged).
const _agentsRuntimeWire = wireAgentsRuntime({
  pool,
  log,
  bitableConfigs: BITABLE_CONFIGS,
  normalizeBitableDateValue,
  extractDissatisfactionDishFromFields,
  extractDissatisfactionReasonFromFields,
  extractBitableFieldText,
  inDateRangeInclusive,
  normalizeStoreKey,
  normProductKey,
  toNum,
  setReportPool,
  callVisionLLM,
  getOpsAgentConfig,
  callLLM,
  queryAgentData,
  getOpsReasoningModel,
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
  normalizeCanonicalStoreName,
  normalizeStoreLike,
  formatDate,
  logAgentOperation,
  isLikelySameStore,
  loadUnifiedTableVisitRowsByStore,
  isExternalEnabled,
  axios,
  markProviderOk,
  markProviderFail,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  getScheduledTaskStatus,
  performanceMetrics: _performanceMetrics,
  tenantContext,
  getActiveTenantIds,
  runDataAuditor,
  pushIssuesToFeishu,
  pushIssueToAssignee,
  pushScoresToFeishu,
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
  getTenantAiModelConfig,
  resolveTenantIdDefault,
  agentPool,
  isAiQualityExternalEnabled,
  getModelTier,
  getModelForRole,
  getTemperatureForRole,
  getMaxTokensForRole,
  isTierBudgetExceeded,
  getCachedResponse,
  setCachedResponse,
  maskLLMMessages,
  sanitizeLLMOutputWithAudit,
  sanitizeLLMOutput,
  trackLLMCall,
  trackLLMResult,
  getOpsVisionModel,
  toDateOnly,
  extractTableVisitItems,
  extractTableVisitDishes,
  getBiReasoningModel,
  getAvailableTools,
  isToolAllowed,
  parseFeishuMarketingCopyTemplate,
  clampInt,
  runBiFunctionTool,
  buildBiFactSourceAudit,
  buildBiSourceAuditText,
  resolveDateRangeFromQuestion,
  isFactLikeQuestion,
  buildBiGroundingFacts,
  tryHandleBiByFunctionCalling,
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
  getContext,
  updateContext,
  buildSalesReport,
  getFeatureFlags: () => AGENT_FEATURE_FLAGS,
  normalizePlainText,
  recordAiInteraction,
  recordAiFeedback,
  prefixWithAgentName,
  matchAnalysisRule,
  logExecutorEvent,
  getAgentLongMemory,
  markQualityMetric,
  recordAgentQualityAudit,
  getBrandRuntimeConfig,
  routeMessage,
  runWithCheckAgent,
  enforceUnifiedQualityGate,
  setAgentLongMemory,
  getEmployeePositionForKb,
  queryKnowledgeBase,
  getOpsKnowledgeSupport,
  auditImage,
  createOrUpdateAutonomousDataTask,
  notifyAutonomousDataTaskOwner,
  sleep,
  extractRelationsFromBitableRecord,
  deduplicateMessage,
  processedRecordIds: _bitableProcessedRecordIds,
  lastProcessedTime: _bitableLastProcessedTime,
  seedBitableDedup,
  getBitableRecords,
  processBitableData,
  getBitableRecordImageDownloadUrl,
  refreshOpsAgentRuntimeConfig,
  buildScheduledTasksFromConfig,
  executeScheduledTask,
  isBlockedOpsChecklistPattern,
  sendScheduledChecklist,
  sendSafetyCheck,
  resolveAgentCanonicalStore,
  dailyReportIlikePatterns,
  feishuStoreSearchPatterns,
  calculateStoreRating,
  calculateEmployeeScore,
  formatChecklistTypeLabel,
  getOpsChecklistItems,
  opsTaskReplyAuditLarkMd: OPS_TASK_REPLY_AUDIT_LARK_MD,
  shouldSkipHrmsScheduledChecklist,
  countOpsChecklistAbnormal,
  lookupFeishuUser,
  getOpsChecklistProgressKey,
  buildOpsChecklistAbnormalItemsCard,
  sendLarkCard,
  getLarkTenantToken,
  registerFeishuUser,
  reportStoresSeed: ALL_STORE_NAMES,
  generateWeeklyReport,
  generateMonthlyReport,
  formatReportMarkdown,
  calendarLastCompletedWeekMonSunShanghai,
  calendarPreviousMonthRangeShanghai,
  tryAutoBindByName,
  getLarkImageUrl,
  recognizeLarkAudio,
  checkAgentPermission,
  handleAgentMessage,
  handleOpsChecklistCardAction,
  tryCaptureOpsChecklistDetailFromChat,
  detectOpsChecklistType,
  getTaskResponseHook: () => _taskResponseHook,
});

_tableVisitMetricsApi = _agentsRuntimeWire.tableVisitMetricsApi;
_marginMetricsApi = _agentsRuntimeWire.marginMetricsApi;
_auditImage = _agentsRuntimeWire.auditImage;
_getOpsKnowledgeSupport = _agentsRuntimeWire.getOpsKnowledgeSupport;
_runDataAuditor = _agentsRuntimeWire.runDataAuditor;
_runBiFunctionTool = _agentsRuntimeWire.runBiFunctionTool;
_llmHealthSchedulerApi = _agentsRuntimeWire.llmHealthSchedulerApi;
_invalidateTenantLlmConfigCache = _agentsRuntimeWire.invalidateTenantLlmConfigCache;
_callLLM = _agentsRuntimeWire.callLLM;
_callVisionLLM = _agentsRuntimeWire.callVisionLLM;
_callVisionLLMVideo = _agentsRuntimeWire.callVisionLLMVideo;
_biQueryHelpersApi = _agentsRuntimeWire.biQueryHelpersApi;
_tryHandleBiByFunctionCalling = _agentsRuntimeWire.tryHandleBiByFunctionCalling;
_buildBiDeterministicDailyReportReply = _agentsRuntimeWire.buildBiDeterministicDailyReportReply;
_buildBiDeterministicSalesRawTopReply = _agentsRuntimeWire.buildBiDeterministicSalesRawTopReply;
_buildBiDeterministicBadReviewReportReply = _agentsRuntimeWire.buildBiDeterministicBadReviewReportReply;
_buildBiDeterministicDataSourceCoverageReply = _agentsRuntimeWire.buildBiDeterministicDataSourceCoverageReply;
_buildBiDeterministicTableVisitReply = _agentsRuntimeWire.buildBiDeterministicTableVisitReply;
_buildBiDeterministicOpsReportCountReply = _agentsRuntimeWire.buildBiDeterministicOpsReportCountReply;
_buildBiDeterministicClosingReportReply = _agentsRuntimeWire.buildBiDeterministicClosingReportReply;
_buildBiDeterministicOpeningReportReply = _agentsRuntimeWire.buildBiDeterministicOpeningReportReply;
_buildBiDeterministicMaterialReportReply = _agentsRuntimeWire.buildBiDeterministicMaterialReportReply;
_buildBiDeterministicMeetingReportReply = _agentsRuntimeWire.buildBiDeterministicMeetingReportReply;
_buildBiDeterministicLossReportReply = _agentsRuntimeWire.buildBiDeterministicLossReportReply;
_agentQualityAutonomyApi = _agentsRuntimeWire.agentQualityAutonomyApi;
_routeMessage = _agentsRuntimeWire.routeMessage;
_checkAgentQualityApi = _agentsRuntimeWire.checkAgentQualityApi;
_handleAgentMessage = _agentsRuntimeWire.handleAgentMessage;
_archiveOldBitableSubmissions = _agentsRuntimeWire.archiveOldBitableSubmissions;
_bitableRecordsClient = _agentsRuntimeWire.bitableRecordsClient;
_processBitableData = _agentsRuntimeWire.processBitableData;
_getBitableSubmissionStats = _agentsRuntimeWire.getBitableSubmissionStats;
_scheduledTaskRuntimeApi = _agentsRuntimeWire.scheduledTaskRuntimeApi;
_buildScheduledTasksFromConfig = _agentsRuntimeWire.buildScheduledTasksFromConfig;
_executeScheduledTask = _agentsRuntimeWire.executeScheduledTask;
_sendSafetyCheck = _agentsRuntimeWire.sendSafetyCheck;
_fetchStoreRatingForProfileDisplay = _agentsRuntimeWire.fetchStoreRatingForProfileDisplay;
_runChiefEvaluator = _agentsRuntimeWire.runChiefEvaluator;
_sendScheduledChecklist = _agentsRuntimeWire.sendScheduledChecklist;
_opsChecklistCardsApi = _agentsRuntimeWire.opsChecklistCardsApi;
_tryCaptureOpsChecklistDetailFromChat = _agentsRuntimeWire.tryCaptureOpsChecklistDetailFromChat;
_followUpOverdueTasks = _agentsRuntimeWire.followUpOverdueTasks;
_handleOpsChecklistCardAction = _agentsRuntimeWire.handleOpsChecklistCardAction;
_pushIssuesToFeishu = _agentsRuntimeWire.pushIssuesToFeishu;
_feishuUserMessagingApi = _agentsRuntimeWire.feishuUserMessagingApi;
_sendPeriodReportsApi = _agentsRuntimeWire.sendPeriodReportsApi;
_onFeishuEvent = _agentsRuntimeWire.onFeishuEvent;
_pollBitableSubmissions = _agentsRuntimeWire.pollBitableSubmissions;


// getLastSyncTime / checkTaskExecutionQuality / getRecentAuditCount → domains/agent-auditor/quality-checks.js

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
