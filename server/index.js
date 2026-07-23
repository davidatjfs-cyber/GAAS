import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import { statfs } from 'node:fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createDecipheriv, createHash } from 'crypto';
import { getActiveTenantIds, tenantContext, resolveTenantIdDefault, runWithBootstrapTenantContext, runForActiveTenants } from './utils/database.js';

import { registerAuthRoutes } from './auth-routes.js';
import { registerApprovalRoutes } from './approval-routes.js';
import {
  registerApprovalDecideRoutes,
  registerApprovalLifecycleRoutes,
  buildOnboardingEmployeeRecordFromPayload,
} from './domains/approvals/routes.js';
import { applyStatePutWhitelist } from './hrms-state-put.js';
import { registerPayrollDomainRoutes } from './domains/payroll/routes.js';
import { hydrateStateFromAuthoritativeTables } from './domains/payroll/service.js';
import { registerEmployeesDomainRoutes } from './domains/employees/routes.js';
import {
  hydrateEmployeesFromTable,
  upsertEmployeeFromStateShape,
  upsertEmployeesFromStateShape,
  loadEmployeesFromTable,
} from './domains/employees/service.js';
import { reconcileEmployeesMirrorAllTenants } from './domains/employees/mirror-tx.js';
import { startSchemaMigrationDriftMonitor } from './schema-migration-drift-monitor.js';
import { registerFlowConfigRoutes } from './domains/flow-config/routes.js';
import { hydrateFlowConfigFromTable } from './domains/flow-config/service.js';
import { hydrateNotificationsFromTable } from './domains/notifications/service.js';
import { hydrateExamResultsFromTable } from './domains/exam-results/service.js';
import {
  registerStoresDomainRoutes,
  registerStoresCrudRoutes,
  registerBrandsRoutes,
} from './domains/stores/routes.js';
import { registerPaymentConfigRoutes } from './domains/payment-config/routes.js';
import { registerPaymentRoutes } from './domains/payments/routes.js';
import { registerPermissionGroupsRoutes } from './domains/permission-groups/routes.js';
import { registerUploadRoutes } from './domains/uploads/routes.js';
import { registerOpsTasksRoutes } from './domains/ops-tasks/routes.js';
import { registerStoreDutyBindingsRoutes } from './domains/store-duty-bindings/routes.js';
import { registerRemainingStateRoutes } from './domains/remaining-state/routes.js';
import { registerGmMailboxRoutes } from './domains/gm-mailbox/routes.js';
import {




} from './tenant-integrations.js';
import multer from 'multer';
import https from 'https';
import { execFileSync } from 'child_process';
import OSS from 'ali-oss';
import COS from 'cos-nodejs-sdk-v5';
import pg from 'pg';
const { Pool } = pg;
// Return raw strings instead of JS Date objects to avoid UTC-to-local timezone shift
// OID 1082 = date, OID 1114 = timestamp without time zone, OID 1184 = timestamp with time zone
pg.types.setTypeParser(1082, str => str);  // date → keep as 'YYYY-MM-DD' string
pg.types.setTypeParser(1114, str => str);
pg.types.setTypeParser(1184, str => {
  // Convert timestamptz to Beijing time string
  const d = new Date(str);
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
});

import zlib from 'zlib';
import XLSX from 'xlsx';
import axios from 'axios';
import { setPool as setAgentPool, ensureAgentTables, registerAgentRoutes, startAgentScheduler, setTaskResponseHook, startBitablePolling, startScheduledTasks, assertCriticalFunctions, verifyLLMHealth, getAgentHealthStatus, startWeeklyReportScheduler, sendWeeklyReports, sendMonthlyReports, sendTestReportsToUser, lookupFeishuUserByUsername, sendLarkMessage, onFeishuEvent, callLLM, invalidateTenantLlmConfigCache } from './agents.js';
import { ensureAgentConfigTables, registerAgentConfigRoutes } from "./agent-config-manager.js";
import { initBrandConfigCache, getBrandForStoreSync, getBrandConfigSync } from './utils/brand-config-loader.js';
import { initStoreAliasCache } from './utils/store-alias-cache.js';

import { setMasterPool, ensureMasterTables, startMasterAgent, registerMasterRoutes, handleTaskResponse } from './master-agent.js';
import { setReportPool } from './bi-weekly-report.js';
import { setSalesRawPool } from './sales-raw-upload.js';
import { startSalesRawFolderImporter, runSalesRawFolderImportOnce, setSalesRawFolderImportFailureNotifier } from './sales-raw-folder-importer.js';
import {
  startHrmsPerformanceJobs,
  sendWeeklyDishOptimizationReport,
  getLastCompletedWeekRangeShanghai,
  getExpectedMonthlyPerformancePeriodShanghai,
  countEligibleMonthlyPerformanceUsers
} from './performance-jobs.js';
import { startDailyFeishuSync, syncDishLibraryCosts, syncSopSteps, setFeishuSyncFailureNotifier, resolveWebhookTenantId, loadTenantFeishuBitableConfig, getFeishuAccessToken as getFeishuTokenByConfig } from './feishu-sync.js';

import { registerNewScoringRoutes } from './new-scoring-api.js';
import { registerPerformanceInvalidationRoutes } from './performance-invalidation-api.js';

import { registerUploadStatusRoute } from './upload-status.js';
import { ensureRAGSchema, ragQuery, ragMultiQuery, ragStats } from './rag-tool.js';
import { ensureTaskBoardSchema } from './task-board-api.js';
import { ensureHRMSApiSchema, registerHRMSApiRoutes } from './hrms-api-tools.js';
import { ensureSOPDistributionSchema, registerSOPDistributionRoutes } from './sop-distribution.js';
import { ensureKitchenExecutionSchema, registerKitchenExecutionRoutes } from './kitchen-execution.js';
import { ensureRecipeSchema, registerRecipeRoutes, generateRecipeTemplate, importRecipeFromExcel } from './recipe-management.js';
import { ensureTrainingSchema, registerTrainingRoutes, startTrainingReminderScheduler, getPromotionRequiredTopics, createTrainingAssignment, getPromotionTrackProgress, getCrossTrackTechnicianStatus } from './training.js';
import { setDataExecutorPool, purgeExpiredCache, updateMetricVersion } from './data-executor.js';
import fileRoutes from './file-routes.js';
import { enforceRuntimeSafetyOrExit, configureDbSessionSafety, isSchemaChangeAllowed, getAppEnv, isWebhookEnabled, isExternalEnabled, requireWebhookSignature } from './safety.js';
import { createLoginRateLimiter } from './middleware/rate-limit.js';
import { verifyFeishuWebhookRequest } from './utils/feishu-webhook-verify.js';
import { expandAgentStoreLabels, resolveAgentCanonicalStore } from './v2-store-alignment.js';
import { ensureGrowthTables, registerGrowthRoutes, setSendGrowthAlert, getSendGrowthAlert } from './growth-api.js';
import { ensureAgentAuditLogTable } from './utils/agent-audit-log.js';
import { registerGrowthWinbackRoutes } from './growth-winback-routes.js';
import { registerGrowthPaymentRulesRoutes } from './growth-payment-rules-routes.js';
import { registerGrowthStoredValueRoutes } from './growth-stored-value-routes.js';
import { registerGrowthActionsRoutes } from './growth-actions-routes.js';
import { registerSmsTemplateRoutes } from './growth-sms-templates-routes.js';
import { registerSmsReconcileJob } from './growth-sms-reconcile.js';
import { registerSmsHealthMonitor } from './growth-sms-health-monitor.js';
import { registerGrowthMetricsRoutes } from './growth-metrics-routes.js';
import { registerGrowthProfilesRoutes } from './growth-profiles-routes.js';
import { registerGrowthContentRoutes } from './growth-content-routes.js';
import { registerGrowthWecomFeishuRoutes } from './growth-wecom-feishu-routes.js';
import { registerGrowthQueriesRoutes } from './growth-queries-routes.js';
import { registerGrowthOpsRoutes } from './growth-ops-routes.js';
import { registerDiagnosisRoutes } from './store-diagnosis.js';
import { registerOntologyRoutes } from './ontology/routes.js';
import { registerBenchmarkRoutes } from './ontology/benchmark-routes.js';
import { registerDataTrustRoutes } from './ontology/data-trust-routes.js';
import { startOntologyDailyDiagnosisScheduler } from './ontology/daily-diagnosis-scheduler.js';
import { runFreshnessCheck } from './ontology/freshness.js';
import { FRESHNESS_SOURCES } from './ontology/freshness-config.js';
import { ensureGrowthSolutionsSchema, registerGrowthSolutionRoutes, setSolutionNotifier, setSolutionLLM, setTrainingAssigner, startSolutionSweepScheduler } from './growth-solutions.js';
import strategyExperimentRoutes from './strategy-experiment-api.js';
import { ensurePhaseTables, registerPhaseRoutes } from './growth-phases.js';
import { ensureCustomerOpsTables, registerCustomerOpsRoutes } from './customer-ops.js';
import { registerMarketingAttributionRoutes } from './marketing/marketing-attribution-routes.js';
import { registerTenantOperationInspectionRoutes } from './tenant-operation-inspection-routes.js';
import { registerLightSaasRoutes } from './light-saas-routes.js';
import { registerSalesAiRoutes } from './sales-ai-routes.js';
import { getCreditRisk } from './services/sales/sales-credit-risk.js';
import { startHealthCenterDailyScanScheduler } from './services/tenant-health-center-scheduler.js';
import { setHealthIncidentNotifiers } from './services/tenant-health-incident-service.js';
import { startHealthOpsLoopScheduler } from './services/tenant-health-ops-scheduler.js';
import { loadTenantRuntimeStatus as loadTenantRuntimeStatusFromModule } from './tenant-runtime-status.js';
import { registerTenantSubscriptionRoutes } from './tenant-subscription-routes.js';
import { createPlatformAdminRequired, registerTenantPlatformRoutes, requireSuperAdmin, requireSalesManagerOrAbove } from './tenant-platform-routes.js';
import { registerKnowledgeRoutes } from './knowledge-routes.js';
import { registerCheckinRoutes } from './checkin-routes.js';
import { registerReportsRoutes } from './reports-routes.js';
import { registerDailyReportsRoutes, canAccessDailyReports, dailyReportItemFromPgRow } from './domains/daily-reports/routes.js';
import { registerPointsRoutes, dedupeGlobalSocialMediaPointRules, ensureGlobalSocialMediaPointRule } from './domains/points/routes.js';
import { registerAiQualityLearningRoutes } from './ai-quality-learning-routes.js';
import { recordAiFeedback, runPlatformQualityModelTask, startAiQualityLearningScheduler } from './services/ai-quality-learning-service.js';
import {
  registerHrmsPayrollClosedLoopRoutes,
  ensurePayrollRulesTables,
  seedDefaultBrandPayrollRules,
  upsertPayrollLedgerEntry,
  applyPromotionSalaryNextMonth,
  insertSalaryTimeline,
  buildPayrollForMonth
} from './hrms-payroll-routes.js';
import { resolveAttendancePayrollRules, safeBizMonth } from './services/hrms-payroll-rules.js';
import { registerHrmsPermissionRoutes } from './hrms-permission-routes.js';
import {
  ensurePermissionTables,
  resolveUserPermissionContext,
} from './services/hrms-permission-engine.js';
import { registerInventoryForecastRoutes } from './inventory-forecast-routes.js';
import { registerAgentTaskBoardRoutes } from './agent-task-board-routes.js';
import { ensureBaselineSchemaHealth } from './baseline-schema-health.js';
import {
  reconcileDailyReportAttendanceRegister,
  backfillDailyAttendanceRegisterMissing,
  summarizeDailyRegisterForEmployee,
  filterDailyRegisterRowsByEmployee
} from './daily-attendance-register.js';
import {
  buildStoreAccessContext,
  canAccessApprovalCenter,

  ensureStoreDutyBindingsTable,
  loadActiveDutyRowsForUser,

} from './store-duty-bindings.js';
import {
  buildConfiguredApprovalAssignees,
  resolveStoreApprovalRoleUsername,
} from './approval-assignee-resolution.js';


const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || '0.0.0.0');
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const PLATFORM_ADMIN_SECRET = process.env.PLATFORM_ADMIN_SECRET;
// 平台管理员JWT用独立密钥签发/校验，与租户内普通用户登录的JWT_SECRET隔离，
// 避免任一边密钥轮换/泄露时影响范围扩大到另一边。agents-service-v2需配置同一个值
// 才能让同一份platform_admin token跨两个服务通用（参见该服务middleware/auth.js）。
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET || JWT_SECRET;
const TENANT_INTEGRATION_ENCRYPTION_KEY = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY || '';
const REQUIRED_TENANT_FEISHU_TABLE_KEYS = [
  'ops_checklist',
  'table_visit',
  'bad_review',
  'closing_reports',
  'opening_reports',
  'meeting_reports',
  'material_majixian',
  'material_hongchao',
  'dish_library',
  'dish_library_majixian_takeaway',
  'loss_report',
  'task_responses',
  'actual_gross_margin',
  'sop_steps'
];
const STARTED_AT = new Date().toISOString();
const APP_ENV = getAppEnv();

enforceRuntimeSafetyOrExit({ serviceName: 'hrms-server' });

const app = express();
// gzip静态HTML/JS/CSS/JSON响应；index.js之前完全没有压缩中间件，platform-admin.html
// 这类几百KB的内联单文件页面每次都是明文全量下载，直连3000端口(没有nginx在前面兜底gzip)
// 时体感尤其慢。放在最前面，覆盖后面所有路由包括静态文件和API JSON响应。
app.use(compression());
// H3: request_id for structured logs / client correlation
app.use((req, res, next) => {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const requestId = incoming || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});
// M1-FIX: 生产环境不把内部错误细节（e.message，可能含SQL/文件路径等）返回给客户端
function safeErrMessage(e) {
  if (process.env.NODE_ENV === 'production') return 'internal_error';
  return safeErrMessage(e);
}
// H3-FIX: 限制CORS来源（生产环境使用白名单，开发环境允许所有）
const CORS_WHITELIST = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(CORS_WHITELIST.length > 0 ? {
  origin: (origin, cb) => {
    if (!origin || CORS_WHITELIST.includes(origin)) cb(null, true);
    else cb(new Error('CORS not allowed'));
  },
  credentials: true
} : undefined));
app.use(express.json({ limit: '5mb' }));

// ── Security headers ─────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' *.feishu.cn *.bytedance.net cdn.jsdelivr.net cdnjs.cloudflare.com unpkg.com cdn.sheetjs.com; style-src 'self' 'unsafe-inline' *.feishu.cn fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: *.feishu.cn *.aliyuncs.com; connect-src 'self' *.feishu.cn *.feishuopen.com dashscope.aliyuncs.com api.deepseek.com; frame-src 'self' *:3101");
  next();
});

const _OSS_REGION = process.env.OSS_REGION;
const _OSS_BUCKET = process.env.OSS_BUCKET;
const _OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID;
const _OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET;
const _OSS_PUBLIC_BASE_URL = process.env.OSS_PUBLIC_BASE_URL;
const OSS_TIMEOUT_MS = Number(process.env.OSS_TIMEOUT_MS || 600000);
const OSS_PART_SIZE_MB = Number(process.env.OSS_PART_SIZE_MB || 10);
const OSS_PARALLEL = Number(process.env.OSS_PARALLEL || 3);
const OSS_RETRY_COUNT = Number(process.env.OSS_RETRY_COUNT || 6);

const COS_SECRET_ID = process.env.COS_SECRET_ID;
const COS_SECRET_KEY = process.env.COS_SECRET_KEY;
const COS_BUCKET = process.env.COS_BUCKET;
const COS_REGION = process.env.COS_REGION;
const COS_PUBLIC_BASE_URL = process.env.COS_PUBLIC_BASE_URL;

// 飞书配置
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEISHU_ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY;

function tryParseJson(input) {
  try {
    if (!input) return null;
    return JSON.parse(input);
  } catch (e) {
    return null;
  }
}

function decryptFeishuEncryptPayload(encryptValue) {
  if (!FEISHU_ENCRYPT_KEY) throw new Error('missing_feishu_encrypt_key');
  const cipherBuf = Buffer.from(String(encryptValue || ''), 'base64');
  if (!cipherBuf.length) throw new Error('invalid_encrypt_payload');

  let keyBuf = Buffer.from(String(FEISHU_ENCRYPT_KEY || ''), 'base64');
  if (keyBuf.length !== 32) {
    keyBuf = Buffer.from(String(FEISHU_ENCRYPT_KEY || ''), 'utf8');
    if (keyBuf.length < 32) {
      keyBuf = Buffer.concat([keyBuf, Buffer.alloc(32 - keyBuf.length)]);
    }
    if (keyBuf.length > 32) keyBuf = keyBuf.subarray(0, 32);
  }
  const iv = keyBuf.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', keyBuf, iv);
  let decrypted = decipher.update(cipherBuf, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
const uploadsDir = path.join(__dirname, 'uploads');
function ensureUploadsDir() {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (e) {
    console.error('[ensureUploadsDir] mkdirSync failed:', e?.message || e);
    return { ok: false, error: 'internal_error' };
  }

  try {
    fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
    return { ok: true };
  } catch (e) {
    console.error('[ensureUploadsDir] accessSync failed:', e?.message || e);
    return { ok: false, error: 'internal_error' };
  }
}

function normalizeBrandId(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
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
      config: b?.config && typeof b.config === 'object' ? b.config : {
        sopKeypoints: [],
        performanceWeights: {}
      }
    });
  });

  stores.forEach((s) => {
    const name = String(s?.brand || s?.brandName || '').trim();
    const id = normalizeBrandId(s?.brandId || name);
    if (!name || !id) return;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name,
        config: { sopKeypoints: [], performanceWeights: {} }
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
}

function resolveStoreBrandContext(state0, storeRef) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  const brands = getBrandsFromState(state);
  const byId = new Map(brands.map((b) => [String(b.id || ''), b]));
  const ref = String(storeRef || '').trim();
  const row = stores.find((s) => String(s?.id || '').trim() === ref || String(s?.name || '').trim() === ref) || null;
  const brandName = String(row?.brand || row?.brandName || '').trim();
  const brandId = normalizeBrandId(row?.brandId || brandName);
  const brand = byId.get(brandId) || (brandId && brandName
    ? { id: brandId, name: brandName, config: { sopKeypoints: [], performanceWeights: {} } }
    : null);
  return {
    storeId: String(row?.id || '').trim(),
    storeName: String(row?.name || '').trim(),
    brandId: String(brand?.id || brandId || '').trim(),
    brandName: String(brand?.name || brandName || '').trim(),
    brandConfig: brand?.config && typeof brand.config === 'object' ? brand.config : { sopKeypoints: [], performanceWeights: {} }
  };
}

function getStoreNamesByBrand(state0, brandIdInput) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const brandId = normalizeBrandId(brandIdInput);
  if (!brandId) return [];
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  return stores
    .filter((s) => normalizeBrandId(s?.brandId || s?.brand || s?.brandName) === brandId)
    .map((s) => String(s?.name || '').trim())
    .filter(Boolean);
}

function getStoreNamesByRegion(state0, regionInput) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const region = String(regionInput || '').trim();
  if (!region) return [];
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  return stores
    .filter((s) => String(s?.region || '').trim() === region)
    .map((s) => String(s?.name || '').trim())
    .filter(Boolean);
}

// 权限组/岗位的"门店范围"统一解析：全部/按品牌/按区域/按店多选 → 门店名称数组。
// 返回 null 表示这个权限组没有设置门店范围（caller 应该回退到原有的跨店绑定逻辑），
// 返回数组(可以是空数组)表示按这个范围来，不再看跨店绑定表——对没用到权限组的现有
// 租户(洪潮/马己仙)完全没有影响，因为他们的员工没有 permissionGroupId。
function resolveStoreScopeStores(state0, scope) {
  if (!scope || typeof scope !== 'object') return null;
  const mode = String(scope.mode || '').trim();
  if (!mode || mode === 'legacy') return null;
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  if (mode === 'all') {
    return (Array.isArray(state?.stores) ? state.stores : [])
      .map((s) => String(s?.name || '').trim())
      .filter(Boolean);
  }
  if (mode === 'brand') return getStoreNamesByBrand(state, scope.brand);
  if (mode === 'region') return getStoreNamesByRegion(state, scope.region);
  if (mode === 'stores') {
    return Array.isArray(scope.stores) ? scope.stores.map((s) => String(s || '').trim()).filter(Boolean) : [];
  }
  return null;
}

function buildKnowledgeBrandScopeTag(input) {
  const raw = String(input || '').trim();
  if (!raw || raw === 'all') return 'brand:all';
  const id = normalizeBrandId(raw);
  return id ? `brand:${id}` : 'brand:all';
}

function resolveForecastScope(state0, username, role, requestedStore, requestedBrandId) {
  const scopedRole = isForecastStoreScopedRole(role);
  const myStore = pickMyStoreFromState(state0, username);
  const qStore = String(requestedStore || '').trim();
  const qBrandId = normalizeBrandId(requestedBrandId);

  if (scopedRole) {
    const ctx = resolveStoreBrandContext(state0, myStore);
    const store = String(ctx.storeName || myStore || '').trim();
    return {
      store,
      brandId: normalizeBrandId(ctx.brandId),
      brandName: String(ctx.brandName || '').trim(),
      storeScope: store ? [store] : []
    };
  }

  if (qStore) {
    const ctx = resolveStoreBrandContext(state0, qStore);
    const store = String(ctx.storeName || qStore || '').trim();
    return {
      store,
      brandId: normalizeBrandId(ctx.brandId),
      brandName: String(ctx.brandName || '').trim(),
      storeScope: store ? [store] : []
    };
  }

  if (qBrandId) {
    const brands = getBrandsFromState(state0);
    const brand = brands.find((b) => normalizeBrandId(b?.id) === qBrandId) || null;
    return {
      store: '',
      brandId: qBrandId,
      brandName: String(brand?.name || '').trim(),
      storeScope: getStoreNamesByBrand(state0, qBrandId)
    };
  }

  return { store: '', brandId: '', brandName: '', storeScope: [] };
}

import { FEISHU_TABLE_CONFIG } from './feishu-sync.js';

// 根据 appToken 和 tableId 查找对应的 configKey
function findConfigKeyByTableInfo(appToken, tableId) {
  if (!appToken || !tableId) return null;
  const appTokenNorm = String(appToken).trim();
  const tableIdNorm = String(tableId).trim();
  
  for (const [key, config] of Object.entries(FEISHU_TABLE_CONFIG)) {
    if (typeof config === 'object' && config !== null) {
      // 处理嵌套配置（如 material_reports.majixian）
      if (config.app_token && config.table_id) {
        if (String(config.app_token).trim() === appTokenNorm && 
            String(config.table_id).trim() === tableIdNorm) {
          return key;
        }
      }
      // 处理嵌套的品牌配置
      for (const [subKey, subConfig] of Object.entries(config)) {
        if (typeof subConfig === 'object' && subConfig !== null && 
            subConfig.app_token && subConfig.table_id) {
          if (String(subConfig.app_token).trim() === appTokenNorm && 
              String(subConfig.table_id).trim() === tableIdNorm) {
            return `${key}_${subKey}`;
          }
        }
      }
    }
  }
  return null;
}

async function ensureFeishuGenericRecordsTable() {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists feishu_generic_records (
        id uuid primary key default gen_random_uuid(),
        app_token varchar(100) not null,
        table_id varchar(100) not null,
        record_id varchar(100) not null,
        config_key varchar(60),
        fields jsonb,
        raw jsonb,
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp,
        unique (app_token, table_id, record_id)
      )`
    );
    await pool.query('alter table feishu_generic_records add column if not exists config_key varchar(60)');
    await pool.query('create index if not exists idx_feishu_generic_table on feishu_generic_records (app_token, table_id, updated_at desc)');
    await pool.query('create index if not exists idx_feishu_generic_record on feishu_generic_records (record_id)');
    await pool.query('create index if not exists idx_feishu_generic_config on feishu_generic_records (config_key, updated_at desc)');
  } catch (e) {
    console.error('[ensureFeishuGenericRecordsTable] Error:', e?.message || e);
    throw e;
  }
}

/**
 * 库级 NOTIFY：凡写入 feishu_generic_records（含 HRMS Webhook / Agent 轮询）且 fields/raw/config_key 实质变化即通知，
 * 与 HRMS LISTEN channel `bitable_records_updated` 对齐；payload 为 config_key 或兜底 table_id。
 */
async function ensureFeishuGenericRecordsNotifyTrigger() {
  // 注意：不能把 TG_OP 写在触发器 WHEN (...) 里 —— WHEN 是 SQL 表达式，会把 TG_OP 当成列名 tg_op 而报错。
  // 插入/更新是否实质变化在函数体内用 TG_OP / OLD / NEW 判断。
  const fnSql = `
CREATE OR REPLACE FUNCTION feishu_generic_records_bitable_notify() RETURNS trigger AS $$
DECLARE
  pl text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      OLD.fields IS DISTINCT FROM NEW.fields
      OR OLD.raw IS DISTINCT FROM NEW.raw
      OR OLD.config_key IS DISTINCT FROM NEW.config_key
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  pl := COALESCE(NULLIF(BTRIM(COALESCE(NEW.config_key, '')), ''), NULLIF(BTRIM(COALESCE(NEW.table_id, '')), ''));
  IF pl IS NULL OR pl = '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_notify('bitable_records_updated', pl);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`;
  const dropSql = 'DROP TRIGGER IF EXISTS trg_feishu_generic_records_bitable_notify ON feishu_generic_records';
  const trigBody = `
AFTER INSERT OR UPDATE OF fields, raw, config_key ON feishu_generic_records
FOR EACH ROW`;
  try {
    await pool.query(fnSql);
    await pool.query(dropSql);
    try {
      await pool.query(
        `CREATE TRIGGER trg_feishu_generic_records_bitable_notify ${trigBody} EXECUTE FUNCTION feishu_generic_records_bitable_notify();`
      );
    } catch (e1) {
      await pool.query(
        `CREATE TRIGGER trg_feishu_generic_records_bitable_notify ${trigBody} EXECUTE PROCEDURE feishu_generic_records_bitable_notify();`
      );
    }
    console.log('[schema] feishu_generic_records → pg_notify(bitable_records_updated) trigger ready');
  } catch (e) {
    console.error('[ensureFeishuGenericRecordsNotifyTrigger] Error:', e?.message || e);
    void notifyAdminsDualWriteFailure('feishu_generic_records（NOTIFY 触发器安装/更新失败）', e);
    throw e;
  }
}

function stripAttachmentLikeFields(fields) {
  const src = fields && typeof fields === 'object' ? fields : {};
  const out = {};
  Object.entries(src).forEach(([k, v]) => {
    if (!k) return;
    const key = String(k).toLowerCase();
    if (key.includes('附件') || key.includes('attachment') || key.includes('file') || key.includes('图片') || key.includes('image')) return;
    out[k] = v;
  });
  return out;
}

async function upsertFeishuGenericRecord({ appToken, tableId, record, configKey = null }) {
  if (!appToken || !tableId || !record) return;
  const recordId = String(record?.record_id || '').trim();
  if (!recordId) return;
  const rawFields = record?.fields || {};
  const cleanedFields = stripAttachmentLikeFields(rawFields);

  await pool.query(
    `insert into feishu_generic_records (app_token, table_id, record_id, config_key, fields, raw, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (app_token, table_id, record_id)
     do update set config_key = excluded.config_key, fields = excluded.fields, raw = excluded.raw, updated_at = now()`,
    [appToken, tableId, recordId, configKey, cleanedFields, record]
  );
}

async function ensureOpsTasksTable() {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists ops_tasks (
        id uuid primary key default gen_random_uuid(),
        biz_date date not null,
        store varchar(200) not null,
        brand varchar(120),
        task_type varchar(60) not null,
        schedule_key varchar(100) not null,
        dedupe_key varchar(220) not null,
        title varchar(220) not null,
        instructions text,
        checklist jsonb not null default '[]'::jsonb,
        required_photos int not null default 1,
        assignee_username varchar(100) not null,
        assignee_role varchar(60) not null,
        status varchar(20) not null default 'open',
        due_at timestamp not null,
        completed_at timestamp,
        evidence_urls jsonb not null default '[]'::jsonb,
        evidence_note text,
        feedback_score int,
        feedback_text text,
        source varchar(60) not null default 'ops_agent',
        tenant_id varchar(80) not null default 'default',
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp,
        constraint uq_ops_tasks_dedupe unique (dedupe_key, tenant_id)
      )`
    );
    await pool.query(`create index if not exists idx_ops_tasks_assignee_status on ops_tasks (assignee_username, status)`);
    await pool.query(`create index if not exists idx_ops_tasks_store_date on ops_tasks (store, biz_date)`);
    await pool.query(`create index if not exists idx_ops_tasks_due on ops_tasks (due_at)`);
  } catch (e) {
    if (safeErrMessage(e).includes('already exists')) return;
    if (e?.code === '23505') {
      const rel = await pool.query(`select to_regclass('public.ops_tasks') as rel`).catch(() => null);
      if (rel?.rows?.[0]?.rel === 'ops_tasks') return;
    }
    console.error('[ensureOpsTasksTable] Error:', e?.message || e);
    throw e;
  }
}

async function getFeishuAccessToken(options = {}) {
  if (!isExternalEnabled()) return '';
  const appId = options.appId || FEISHU_APP_ID;
  const appSecret = options.appSecret || FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    return '';
  }

  try {
    const response = await axios.post(`${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
      app_id: appId,
      app_secret: appSecret
    });

    if (response.data?.code === 0 && response.data?.tenant_access_token) {
      return response.data.tenant_access_token;
    }
    throw new Error(`Feishu API error: ${response.data?.msg || 'Unknown error'} (code: ${response.data?.code})`);
  } catch (error) {
    console.error('[getFeishuAccessToken] Error:', safeErrMessage(error));
    if (error?.response?.data) {
      const code = error.response.data?.code;
      const msg = error.response.data?.msg;
      throw new Error(`Feishu API error: ${msg || error.message} (code: ${code ?? 'unknown'})`);
    }
    throw error;
  }
}

async function createFeishuBitableRecord({ appToken, tableId, fields, accessToken }) {
  if (!isExternalEnabled()) return null;
  if (!appToken || !tableId) {
    return null;
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return null;
  }

  try {
    const url = `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
    const response = await axios.post(
      url,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data?.code !== 0) {
      throw new Error(`Feishu Bitable Create API error: ${response.data?.msg || 'Unknown error'} (code: ${response.data?.code})`);
    }
    return response.data?.data?.record || null;
  } catch (error) {
    console.error('[createFeishuBitableRecord] Error:', safeErrMessage(error));
    if (error?.response?.data) {
      const code = error.response.data?.code;
      const msg = error.response.data?.msg;
      throw new Error(`Feishu Bitable Create API error: ${msg || error.message} (code: ${code ?? 'unknown'})`);
    }
    throw error;
  }
}

async function getFeishuBitableData(appToken, tableId, accessToken) {
  if (!isExternalEnabled()) return { items: [], has_more: false };
  try {
    const allItems = [];
    let pageToken = '';
    let guard = 0;

    while (guard < 2000) {
      guard++;
      const url = `${FEISHU_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          page_size: 500,
          ...(pageToken ? { page_token: pageToken } : {})
        }
      });

      if (response.data?.code !== 0) {
        throw new Error(`Feishu Bitable API error: ${response.data?.msg || 'Unknown error'} (code: ${response.data?.code})`);
      }

      const data = response.data?.data || {};
      const items = Array.isArray(data.items) ? data.items : [];
      allItems.push(...items);

      if (!data.has_more) {
        return { ...data, items: allItems };
      }

      pageToken = String(data.page_token || '').trim();
      if (!pageToken) {
        // defensive: has_more=true but no token
        return { ...data, has_more: false, items: allItems };
      }
    }

    return { items: allItems, has_more: false };
  } catch (error) {
    console.error('[getFeishuBitableData] Error:', safeErrMessage(error));
    if (error?.response?.data) {
      const code = error.response.data?.code;
      const msg = error.response.data?.msg;
      throw new Error(`Feishu Bitable API error: ${msg || error.message} (code: ${code ?? 'unknown'})`);
    }
    throw error;
  }
}

async function ensureFeishuSyncTable() {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists feishu_sync_logs (
        id uuid primary key default gen_random_uuid(),
        event_type varchar(50) not null,
        table_id varchar(100) not null,
        record_id varchar(100),
        data jsonb,
        sync_status varchar(20) not null default 'pending',
        error_message text,
        created_at timestamp default current_timestamp,
        processed_at timestamp
      )`
    );
    await pool.query(`create index if not exists idx_feishu_sync_status on feishu_sync_logs (sync_status)`);
    await pool.query(`create index if not exists idx_feishu_sync_table on feishu_sync_logs (table_id, created_at)`);
  } catch (e) {
    if (safeErrMessage(e).includes('already exists')) return;
    console.error('[ensureFeishuSyncTable] Error:', e?.message || e);
    throw e;
  }
}

// ─── Dedup: unique partial index on agent_messages ───────────────────────────
async function ensureDedupIndexes() {
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_messages_record_content
      ON agent_messages (record_id, content_type)
      WHERE record_id IS NOT NULL AND record_id != ''`);
  } catch (e) {
    // If duplicates already exist, clean them first then retry
    if (/duplicate key|could not create unique index/i.test(String(e?.message || ''))) {
      console.log('[dedup] cleaning existing duplicates in agent_messages...');
      try {
        await pool.query(`
          DELETE FROM agent_messages a USING agent_messages b
          WHERE a.record_id IS NOT NULL AND a.record_id != ''
            AND a.record_id = b.record_id AND a.content_type = b.content_type
            AND a.created_at < b.created_at`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_messages_record_content
          ON agent_messages (record_id, content_type)
          WHERE record_id IS NOT NULL AND record_id != ''`);
        console.log('[dedup] agent_messages unique index created after cleanup');
      } catch (e2) {
        console.warn('[dedup] could not create unique index:', e2?.message);
      }
    } else {
      console.warn('[dedup] index creation skipped:', e?.message);
    }
  }
}

async function ensureTableVisitRecordsTable() {
  try {
    await pool.query('create extension if not exists pgcrypto');
    
    // 首先检查表是否存在
    const tableExists = await pool.query(`
      select exists (
        select from information_schema.tables 
        where table_schema = 'public' 
        and table_name = 'table_visit_records'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      // 表不存在，创建完整的新表
      await pool.query(
        `create table table_visit_records (
          id uuid primary key default gen_random_uuid(),
          date date not null,
          store varchar(200) not null,
          brand varchar(120),
          table_number varchar(20),
          guest_count int default 0,
          amount decimal(10,2) default 0,
          has_reservation boolean default false,
          dissatisfaction_dish text,
          feedback text,
          
          -- 扩展字段（供agent分析使用）
          reservation_time time,
          customer_type varchar(50),
          order_type varchar(50),
          service_rating int default 0,
          food_rating int default 0,
          environment_rating int default 0,
          waiter_name varchar(100),
          promotion_info text,
          weather varchar(50),
          peak_hours boolean default false,
          customer_complaint text,
          complaint_resolution text,
          satisfaction_level varchar(20),
          repeat_customer boolean default false,
          special_requests text,
          payment_method varchar(50),
          order_duration int default 0,
          table_turnover int default 0,
          dish_recommendations text,
          allergic_info text,
          celebration_type varchar(50),
          visit_purpose varchar(100),
          companion_info text,
          customer_age varchar(20),
          customer_gender varchar(10),
          visit_frequency varchar(50),
          preferred_dishes text,
          unsatisfied_items text,
          suggested_improvements text,
          staff_performance text,
          facility_issues text,
          hygiene_rating int default 0,
          value_rating int default 0,
          ambiance_rating int default 0,
          noise_level varchar(20),
          temperature varchar(20),
          lighting varchar(20),
          music_volume varchar(20),
          seating_comfort varchar(20),
          queue_time int default 0,
          service_speed varchar(20),
          order_accuracy varchar(20),
          staff_attitude varchar(20),
          problem_resolution text,
          manager_intervention boolean default false,
          compensation_provided text,
          follow_up_required boolean default false,
          follow_up_details text,
          additional_notes text,
          
          feishu_record_id varchar(100) unique,
          created_at timestamp default current_timestamp,
          updated_at timestamp default current_timestamp
        )`
      );
    } else {
      // 表已存在，检查并添加缺失的字段
      const existingColumns = await pool.query(`
        select column_name, data_type 
        from information_schema.columns 
        where table_schema = 'public' 
        and table_name = 'table_visit_records'
      `);
      const columnNames = existingColumns.rows.map(row => row.column_name);
      
      // 需要添加的字段定义
      const newColumns = [
        { name: 'reservation_time', type: 'time' },
        { name: 'customer_type', type: 'varchar(50)' },
        { name: 'order_type', type: 'varchar(50)' },
        { name: 'service_rating', type: 'int default 0' },
        { name: 'food_rating', type: 'int default 0' },
        { name: 'environment_rating', type: 'int default 0' },
        { name: 'waiter_name', type: 'varchar(100)' },
        { name: 'promotion_info', type: 'text' },
        { name: 'weather', type: 'varchar(50)' },
        { name: 'peak_hours', type: 'boolean default false' },
        { name: 'customer_complaint', type: 'text' },
        { name: 'complaint_resolution', type: 'text' },
        { name: 'satisfaction_level', type: 'varchar(20)' },
        { name: 'repeat_customer', type: 'boolean default false' },
        { name: 'special_requests', type: 'text' },
        { name: 'payment_method', type: 'varchar(50)' },
        { name: 'order_duration', type: 'int default 0' },
        { name: 'table_turnover', type: 'int default 0' },
        { name: 'dish_recommendations', type: 'text' },
        { name: 'allergic_info', type: 'text' },
        { name: 'celebration_type', type: 'varchar(50)' },
        { name: 'visit_purpose', type: 'varchar(100)' },
        { name: 'companion_info', type: 'text' },
        { name: 'customer_age', type: 'varchar(20)' },
        { name: 'customer_gender', type: 'varchar(10)' },
        { name: 'visit_frequency', type: 'varchar(50)' },
        { name: 'preferred_dishes', type: 'text' },
        { name: 'unsatisfied_items', type: 'text' },
        { name: 'suggested_improvements', type: 'text' },
        { name: 'staff_performance', type: 'text' },
        { name: 'facility_issues', type: 'text' },
        { name: 'hygiene_rating', type: 'int default 0' },
        { name: 'value_rating', type: 'int default 0' },
        { name: 'ambiance_rating', type: 'int default 0' },
        { name: 'noise_level', type: 'varchar(20)' },
        { name: 'temperature', type: 'varchar(20)' },
        { name: 'lighting', type: 'varchar(20)' },
        { name: 'music_volume', type: 'varchar(20)' },
        { name: 'seating_comfort', type: 'varchar(20)' },
        { name: 'queue_time', type: 'int default 0' },
        { name: 'service_speed', type: 'varchar(20)' },
        { name: 'order_accuracy', type: 'varchar(20)' },
        { name: 'staff_attitude', type: 'varchar(20)' },
        { name: 'problem_resolution', type: 'text' },
        { name: 'manager_intervention', type: 'boolean default false' },
        { name: 'compensation_provided', type: 'text' },
        { name: 'follow_up_required', type: 'boolean default false' },
        { name: 'follow_up_details', type: 'text' },
        { name: 'additional_notes', type: 'text' },
        { name: 'rush_dish_content', type: 'text' }
      ];
      
      for (const column of newColumns) {
        if (!columnNames.includes(column.name)) {
          try {
            await pool.query(`alter table table_visit_records add column ${column.name} ${column.type}`);
            console.log(`[ensureTableVisitRecordsTable] Added column: ${column.name}`);
          } catch (e) {
            console.log(`[ensureTableVisitRecordsTable] Failed to add column ${column.name}:`, e?.message || e);
          }
        }
      }
    }
    
    // 创建索引
    await pool.query(`create index if not exists idx_table_visit_date on table_visit_records (date)`);
    await pool.query(`create index if not exists idx_table_visit_store on table_visit_records (store)`);
    await pool.query(`create index if not exists idx_table_visit_feishu_id on table_visit_records (feishu_record_id)`);
    
    // 尝试创建新索引（如果字段存在的话）
    try {
      await pool.query(`create index if not exists idx_table_visit_satisfaction on table_visit_records (satisfaction_level)`);
    } catch (e) {
      console.log('[ensureTableVisitRecordsTable] Satisfaction index skipped (column may not exist)');
    }
    
    try {
      await pool.query(`create index if not exists idx_table_visit_rating on table_visit_records (service_rating, food_rating, environment_rating)`);
    } catch (e) {
      console.log('[ensureTableVisitRecordsTable] Rating index skipped (columns may not exist)');
    }
    
  } catch (e) {
    if (safeErrMessage(e).includes('already exists')) return;
    console.error('[ensureTableVisitRecordsTable] Error:', e?.message || e);
    throw e;
  }
}

function mapFeishuFieldToHrms(feishuRecord, fieldType) {
  const mapped = {};

  const normalizeFeishuFieldValue = (rawValue) => {
    if (rawValue == null) return '';
    if (typeof rawValue === 'string') return rawValue.trim();
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') return rawValue;

    if (Array.isArray(rawValue)) {
      const parts = rawValue
        .map((item) => normalizeFeishuFieldValue(item))
        .filter((item) => item !== '' && item != null);
      if (!parts.length) return '';
      if (parts.length === 1) return parts[0];
      return parts.map((item) => String(item)).join(', ');
    }

    if (typeof rawValue === 'object') {
      if (typeof rawValue.text === 'string' && rawValue.text.trim()) return rawValue.text.trim();
      if (Array.isArray(rawValue.text_arr) && rawValue.text_arr.length) return rawValue.text_arr.join('');
      if (typeof rawValue.name === 'string' && rawValue.name.trim()) return rawValue.name.trim();
      if (typeof rawValue.id === 'string' && rawValue.id.trim()) return rawValue.id.trim();
      return '';
    }

    return String(rawValue || '').trim();
  };

  const normalizePgTimeOrNull = (rawValue) => {
    const s = String(normalizeFeishuFieldValue(rawValue) || '').trim();
    if (!s) return null;
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
    return null;
  };

  const parseFeishuNumber = (rawValue) => {
    const normalized = normalizeFeishuFieldValue(rawValue);
    const text = String(normalized || '').trim();
    if (!text) return 0;
    const n = Number(text.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const parseFeishuBoolean = (rawValue) => {
    if (typeof rawValue === 'boolean') return rawValue;
    const normalized = String(normalizeFeishuFieldValue(rawValue) || '').trim().toLowerCase();
    if (!normalized) return false;
    return ['是', 'true', '1', 'yes', 'y'].includes(normalized);
  };

  const parseFeishuDate = (rawValue) => {
    const normalized = normalizeFeishuFieldValue(rawValue);
    if (normalized === '' || normalized == null) return '';

    const toDateOnly = (dateObj) => {
      if (!dateObj || !Number.isFinite(dateObj.getTime())) return '';
      return dateObj.toISOString().slice(0, 10);
    };

    if (typeof normalized === 'number' && Number.isFinite(normalized)) {
      const millis = normalized > 1e12 ? normalized : normalized * 1000;
      return toDateOnly(new Date(millis));
    }

    const text = String(normalized).trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    if (/^\d{13}$/.test(text)) return toDateOnly(new Date(Number(text)));
    if (/^\d{10}$/.test(text)) return toDateOnly(new Date(Number(text) * 1000));

    const parsed = new Date(text);
    if (Number.isFinite(parsed.getTime())) return toDateOnly(parsed);
    return '';
  };

  const fields = feishuRecord?.fields || {};
  const pickRaw = (...keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) return fields[key];
    }
    return undefined;
  };
  const pickText = (...keys) => String(normalizeFeishuFieldValue(pickRaw(...keys)) || '').trim();
  
  if (fieldType === 'table_visit') {
    // 桌访记录完整字段映射（供agent使用）
    // 飞书多维里常见主键为「记录日期」「提交时间」，旧模板用「日期」；缺任一都会导致无法入结构化表
    mapped.date = parseFeishuDate(pickRaw('记录日期', '提交时间', '日期', '就餐日期', '发生日期', '营业日期'));
    mapped.store = pickText('所属门店', '门店', '店铺');
    mapped.brand = pickText('所属品牌', '品牌');
    mapped.tableNumber = pickText('桌号', '桌位号');
    mapped.guestCount = parseFeishuNumber(pickRaw('就餐人数', '人数'));
    mapped.amount = parseFeishuNumber(pickRaw('消费金额', '消费额', '金额'));
    mapped.hasReservation = parseFeishuBoolean(pickRaw('是否有预订', '有无预订'));
    mapped.dissatisfactionDish = pickText(
      '今天不满意的菜品',
      '今天 不满意菜品',
      '今日不满意菜品',
      '不满意菜品'
    );
    mapped.feedback = pickText('顾客反馈', '反馈', '评价');
    
    // 扩展字段（供agent分析使用）
    mapped.reservationTime = normalizePgTimeOrNull(pickRaw('预订时间'));
    mapped.customerType = pickText('是否第一次来', '新老客户', '客户类型');
    mapped.orderType = pickText('点单方式');
    mapped.serviceRating = parseFeishuNumber(pickRaw('服务评分'));
    mapped.foodRating = parseFeishuNumber(pickRaw('菜品评分'));
    mapped.environmentRating = parseFeishuNumber(pickRaw('环境评分'));
    mapped.waiterName = pickText('服务员姓名');
    mapped.promotionInfo = pickText('哪里知道我们的', '如何知道我们', '客流渠道', '促销活动');
    mapped.weather = pickText('天气情况');
    mapped.peakHours = parseFeishuBoolean(pickRaw('高峰时段'));
    mapped.customerComplaint = pickText('客户投诉');
    mapped.complaintResolution = pickText('投诉处理');
    mapped.satisfactionLevel = pickText('今天用餐是否满意', '满意度等级', '满意度');
    mapped.repeatCustomer = parseFeishuBoolean(pickRaw('是否回头客'));
    mapped.specialRequests = pickText('特殊要求');
    mapped.paymentMethod = pickText('支付方式');
    mapped.orderDuration = parseFeishuNumber(pickRaw('用餐时长（分钟）', '用餐时长'));
    mapped.tableTurnover = parseFeishuNumber(pickRaw('翻台次数'));
    mapped.dishRecommendations = pickText('推荐菜品', '菜品推荐');
    mapped.allergicInfo = pickText('过敏信息');
    mapped.celebrationType = pickText('庆祝类型');
    mapped.visitPurpose = pickText('就餐目的');
    mapped.companionInfo = pickText('同行人员');
    mapped.customerAge = pickText('客户年龄段');
    mapped.customerGender = pickText('客户性别');
    mapped.visitFrequency = pickText('就餐频次');
    mapped.preferredDishes = pickText('今天比较喜欢的菜', '比较喜欢菜品', '偏好菜品');
    mapped.unsatisfiedItems = pickText(
      '不满意的主要原因是什么',
      '不满意的主要原因',
      '满意或不满意的主要原因是什么？',
      '满意或不满意的主要原因',
      '满意/不满意的主要原因',
      '不满意项',
      '不满意原因'
    );
    mapped.suggestedImprovements = pickText('改进建议');
    mapped.staffPerformance = pickText('员工表现');
    mapped.facilityIssues = pickText('设施问题');
    mapped.hygieneRating = parseFeishuNumber(pickRaw('卫生评分'));
    mapped.valueRating = parseFeishuNumber(pickRaw('性价比评分'));
    mapped.ambianceRating = parseFeishuNumber(pickRaw('氛围评分'));
    mapped.noiseLevel = pickText('噪音水平');
    mapped.temperature = pickText('室内温度');
    mapped.lighting = pickText('照明情况');
    mapped.musicVolume = pickText('音乐音量');
    mapped.seatingComfort = pickText('座位舒适度');
    mapped.queueTime = parseFeishuNumber(pickRaw('等位时间（分钟）', '等位时间'));
    mapped.serviceSpeed = pickText('服务速度');
    mapped.orderAccuracy = pickText('点单准确性');
    mapped.staffAttitude = pickText('员工态度');
    mapped.problemResolution = pickText('问题解决');
    mapped.managerIntervention = parseFeishuBoolean(pickRaw('经理介入'));
    mapped.compensationProvided = pickText('补偿措施');
    mapped.followUpRequired = parseFeishuBoolean(pickRaw('需要跟进'));
    mapped.followUpDetails = pickText('跟进详情');
    mapped.additionalNotes = pickText('备注');
    mapped.rushDishContent = pickText('今天催菜内容', '催菜内容');
    mapped.recordId = feishuRecord?.record_id;

    console.log('[mapFeishuFieldToHrms] mapped required fields:', {
      recordId: mapped.recordId,
      mappedDate: mapped.date,
      mappedStore: mapped.store
    });
  }
  
  return mapped;
}

// ─── Product Name Normalization ───
// Maps variant names like "9秒生炒魚片【地道鲜嫩廣府味】" → "九秒生炒鱼片"
const _TRAD_TO_SIMP = {'魚':'鱼','雞':'鸡','鴨':'鸭','豬':'猪','牛':'牛','蝦':'虾','蠔':'蚝','鵝':'鹅','雜':'杂','滷':'卤','燒':'烧','煲':'煲','湯':'汤','飯':'饭','麵':'面','餅':'饼','粥':'粥','蛋':'蛋','菜':'菜','醬':'酱','糖':'糖','鹽':'盐','點':'点','條':'条','塊':'块','份':'份','碟':'碟','個':'个','隻':'只','煎':'煎','炒':'炒','蒸':'蒸','燜':'焖','燉':'炖','烤':'烤','炸':'炸','焗':'焗','凍':'冻','熱':'热','鮮':'鲜','嫩':'嫩','脆':'脆','軟':'软','濃':'浓','淡':'淡','辣':'辣','甜':'甜','酸':'酸','鹹':'咸','廣':'广','東':'东','風':'风','記':'记','號':'号','閣':'阁','園':'园','館':'馆','樓':'楼','優':'优','選':'选','經':'经','標':'标','準':'准','與':'与','開':'开','關':'关','電':'电','話':'话','網':'网','車':'车','門':'门','書':'书','學':'学','師':'师','員':'员','長':'长','華':'华','國':'国','區':'区','場':'场','種':'种','類':'类','質':'质','體':'体','節':'节','張':'张','動':'动','機':'机','對':'对','裡':'里','後':'后','從':'从','過':'过','間':'间','樣':'样','見':'见','頭':'头','實':'实','結':'结','當':'当','處':'处','總':'总','進':'进','現':'现','發':'发','線':'线','連':'连','運':'运','達':'达','傳':'传','輕':'轻','邊':'边','產':'产','話':'话','識':'识','認':'认','議':'议','論':'论','訂':'订','計':'计','調':'调','設':'设','許':'许','試':'试','語':'语','讀':'读','護':'护','變':'变','讓':'让','買':'买','賣':'卖','費':'费','賞':'赏','資':'资','貨':'货','貿':'贸','財':'财','價':'价','貴':'贵','賓':'宾','貢':'贡','響':'响','頁':'页','順':'顺','領':'领','題':'题','顏':'颜','額':'额','飲':'饮','餐':'餐','養':'养','駕':'驾','騎':'骑','驗':'验','髮':'发','鬥':'斗','鑊':'镬','鍋':'锅','鐵':'铁','鏡':'镜','鋪':'铺','鮑':'鲍','鱸':'鲈','鯇':'鲩','龍':'龙','龜':'龟'};
const _ARAB_TO_CN = {'0':'零','1':'一','2':'二','3':'三','4':'四','5':'五','6':'六','7':'七','8':'八','9':'九'};
function normalizeProductName(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  // Strip bracketed marketing text: 【...】 （...） (...) [...] etc.
  s = s.replace(/【[^】]*】/g, '').replace(/\([^)]*\)/g, '').replace(/（[^）]*）/g, '').replace(/\[[^\]]*\]/g, '');
  // Traditional → Simplified
  s = s.split('').map(c => _TRAD_TO_SIMP[c] || c).join('');
  // Arabic digits → Chinese digits (single-char only, for product names like "9秒"→"九秒")
  s = s.split('').map(c => _ARAB_TO_CN[c] || c).join('');
  // Remove extra whitespace
  s = s.replace(/\s+/g, '').trim();
  return s;
}

function buildForecastProductAliasLookup(state0, scopeInput) {
  const scopeStore = typeof scopeInput === 'string' ? String(scopeInput || '').trim() : String(scopeInput?.store || '').trim();
  const scopeBrandId = normalizeBrandId(typeof scopeInput === 'string' ? '' : scopeInput?.brandId);
  const inferredBrandId = scopeBrandId || normalizeBrandId(resolveStoreBrandContext(state0, scopeStore).brandId);
  const lookup = new Map();
  const list = Array.isArray(state0?.forecastProductAliasRules) ? state0.forecastProductAliasRules : [];
  list
    .filter((x) => {
      const ruleBrandId = normalizeBrandId(x?.brandId);
      if (ruleBrandId && inferredBrandId) return ruleBrandId === inferredBrandId;
      if (inferredBrandId && !ruleBrandId) {
        const rowBrandId = normalizeBrandId(resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
        return rowBrandId === inferredBrandId;
      }
      return String(x?.store || '').trim() === scopeStore;
    })
    .forEach((rule) => {
      const canonical = String(rule?.canonical || '').trim();
      const canonicalNorm = normalizeProductName(canonical);
      if (!canonical || !canonicalNorm) return;
      const aliases = Array.isArray(rule?.aliases) ? rule.aliases : [];
      [canonical, ...aliases].forEach((name) => {
        const norm = normalizeProductName(name);
        if (!norm) return;
        lookup.set(norm, { canonical, canonicalNorm });
      });
    });
  return lookup;
}

function resolveForecastProductName(rawName, aliasLookup) {
  const original = String(rawName || '').trim();
  const normalized = normalizeProductName(original);
  if (!normalized) return { key: '', display: '' };
  if (aliasLookup && aliasLookup.has(normalized)) {
    const hit = aliasLookup.get(normalized);
    return {
      key: String(hit?.canonicalNorm || normalized),
      display: String(hit?.canonical || original || normalized).trim()
    };
  }
  return { key: normalized, display: original || normalized };
}

function canonicalizeForecastProductQuantities(input, aliasLookup) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  Object.entries(source).forEach(([product, qtyRaw]) => {
    const qty = Number(qtyRaw || 0);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const resolved = resolveForecastProductName(product, aliasLookup);
    if (!resolved.key || isExcludedForecastProduct(resolved.display)) return;
    out[resolved.display] = Number((Number(out[resolved.display] || 0) + qty).toFixed(2));
  });
  return out;
}

function canonicalizeForecastRows(rows, aliasLookup) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    productQuantities: canonicalizeForecastProductQuantities(row?.productQuantities, aliasLookup)
  }));
}

function forecastDayTypeLabel(date, isHoliday) {
  if (isHoliday === true) return 'holiday';
  const d = new Date(String(date || '') + 'T00:00:00');
  if (Number.isFinite(d.getTime())) {
    const day = d.getDay();
    if (day === 0 || day === 6) return 'holiday';
  }
  return 'workday';
}

function normalizeForecastWeatherTag(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/雨|暴雨|雷|阵雨/.test(s)) return 'rain';
  if (/雪/.test(s)) return 'snow';
  if (/雾|霾/.test(s)) return 'fog';
  if (/风/.test(s)) return 'wind';
  if (/阴|多云/.test(s)) return 'cloudy';
  if (/晴/.test(s)) return 'sunny';
  return s.toLowerCase();
}

// 门店预测配置：雨天系数、节假日策略
const STORE_FORECAST_CONFIG = {
  '洪潮大宁久光店': { rainFactor: 0.90, snowFactor: 0.85, holidayAsWeekend: true },
  '洪潮久光店': { rainFactor: 0.90, snowFactor: 0.85, holidayAsWeekend: true },
  '马己仙上海音乐广场店': { rainFactor: 0.85, snowFactor: 0.80, holidayAsWeekend: true },
  '马己仙': { rainFactor: 0.85, snowFactor: 0.80, holidayAsWeekend: true },
  '_default': { rainFactor: 0.88, snowFactor: 0.82, holidayAsWeekend: true }
};

function getStoreForecastConfig(store) {
  const s = String(store || '').trim();
  // resolveTenantIdDefault读AsyncLocalStorage里authRequired设置的租户上下文，
  // 不需要给这个函数的所有调用点都加tenantId参数。
  const tid = resolveTenantIdDefault();
  const brandKey = getBrandForStoreSync(s, tid)?.brandKey;
  const dbCfg = brandKey ? getBrandConfigSync(brandKey, tid)?.forecast : null;
  if (dbCfg) return dbCfg;
  if (STORE_FORECAST_CONFIG[s]) return STORE_FORECAST_CONFIG[s];
  // Partial name match for abbreviated store names
  const key = Object.keys(STORE_FORECAST_CONFIG).find(k => k !== '_default' && (s.includes(k) || k.includes(s)));
  return (key ? STORE_FORECAST_CONFIG[key] : null) || STORE_FORECAST_CONFIG['_default'];
}

function isCNYPeriod(dateStr) {
  // Spring Festival anomaly window. Mar 1+ treated as normal (元宵 = Feb 20 2026).
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (!Number.isFinite(d.getTime())) return false;
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  // 2026 CNY window: Jan 25 – Feb 28
  if (y === 2026 && ((m === 1 && day >= 25) || m === 2)) return true;
  // Generic guard for other years: Jan 25 – Feb 28
  if (m === 2 || (m === 1 && day >= 25)) return true;
  return false;
}

// Known national public holidays (non-CNY) that inflate restaurant sales.
const KNOWN_PUBLIC_HOLIDAYS = new Set([
  '2026-01-01','2026-01-02','2026-01-03',
  '2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05',
  '2026-06-19','2026-06-20','2026-06-21',
  '2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08',
  '2025-01-01','2025-01-02','2025-01-03',
  '2025-05-01','2025-05-02','2025-05-03','2025-05-04','2025-05-05',
  '2025-05-31','2025-06-01','2025-06-02',
  '2025-10-01','2025-10-02','2025-10-03','2025-10-04','2025-10-05','2025-10-06','2025-10-07','2025-10-08',
]);

function isKnownPublicHoliday(dateStr) {
  return KNOWN_PUBLIC_HOLIDAYS.has(String(dateStr || '').trim());
}

function isNormalWorkday(dateStr, isHoliday) {
  if (isHoliday) return false;
  if (isCNYPeriod(dateStr)) return false;
  if (isKnownPublicHoliday(dateStr)) return false;
  const d = new Date((dateStr || '') + 'T00:00:00');
  if (!Number.isFinite(d.getTime())) return false;
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

function estimateRevenueByHistory(historyRows, target, store) {
  const rows = Array.isArray(historyRows) ? historyRows : [];
  const dailyMap = new Map();
  rows.forEach((row) => {
    const date = safeDateOnly(row?.date);
    const bizType = normalizeForecastBizType(row?.bizType);
    if (!date || !bizType) return;
    const key = `${date}||${bizType}`;
    const prev = dailyMap.get(key) || {
      date,
      bizType,
      weather: normalizeForecastWeather(row?.weather),
      isHoliday: !!row?.isHoliday,
      revenue: 0
    };
    prev.revenue += Number(row?.expectedRevenue || 0);
    if (!prev.weather) prev.weather = normalizeForecastWeather(row?.weather);
    if (row?.isHoliday) prev.isHoliday = true;
    dailyMap.set(key, prev);
  });

  // Mark known public holidays so they get the same penalty as CNY weekdays
  dailyMap.forEach((item) => {
    if (!item.isHoliday && isKnownPublicHoliday(item.date)) item.isHoliday = true;
  });

  // Outlier removal: per-DOW IQR filter.
  // Removes extreme records (e.g. Jan 15 = 502722) that would skew the weighted average.
  // Only removes genuine outliers: revenue > Q3 + 3×IQR within the same day-of-week group.
  (() => {
    const revByDow = {};
    dailyMap.forEach((item) => {
      const dObj = new Date(String(item.date || '') + 'T00:00:00');
      if (!Number.isFinite(dObj.getTime())) return;
      const dw = dObj.getDay();
      if (!revByDow[dw]) revByDow[dw] = [];
      revByDow[dw].push(Number(item.revenue || 0));
    });
    const caps = {};
    Object.entries(revByDow).forEach(([dw, vals]) => {
      if (vals.length < 4) return;
      const sorted = vals.slice().sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      caps[dw] = q3 + 3 * iqr;
    });
    dailyMap.forEach((item, key) => {
      const dObj = new Date(String(item.date || '') + 'T00:00:00');
      if (!Number.isFinite(dObj.getTime())) return;
      const dw = dObj.getDay();
      const cap = caps[dw];
      if (cap != null && Number(item.revenue || 0) > cap) {
        dailyMap.delete(key);
      }
    });
  })();

  const storeConfig = getStoreForecastConfig(store);
  const targetDate = safeDateOnly(target?.date);
  const targetWeatherTag = normalizeForecastWeatherTag(target?.weather);
  const targetIsHoliday = !!target?.isHoliday;
  let targetDow = -1;
  try {
    const td = new Date(String(targetDate || '') + 'T00:00:00');
    if (Number.isFinite(td.getTime())) targetDow = td.getDay();
    // 节假日按周末预测：将目标日视为周日(0)
    if (storeConfig.holidayAsWeekend && targetIsHoliday && targetDow >= 1 && targetDow <= 5) targetDow = 0;
  } catch (e) { /* ignore */ }

  const result = {
    sampleCount: 0,
    byBizType: {
      takeaway: { enabled: false, estimatedRevenue: 0, sampleCount: 0, confidence: 0 },
      dinein: { enabled: false, estimatedRevenue: 0, sampleCount: 0, confidence: 0 }
    },
    totalEstimatedRevenue: 0
  };

  ['takeaway', 'dinein'].forEach((bizType) => {
    const list = Array.from(dailyMap.values())
      .filter((x) => x.bizType === bizType)
      .filter((x) => Number(x.revenue || 0) > 0)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 400);
    result.byBizType[bizType].enabled = list.length > 0;
    result.byBizType[bizType].sampleCount = list.length;
    result.sampleCount += list.length;
    if (!list.length) return;

    // Determine if target is a normal workday (non-holiday, non-CNY, Mon-Fri)
    const targetIsNormalWorkday = isNormalWorkday(targetDate, targetIsHoliday);

    const scored = list.map((item) => {
      let score = 1;
      let cnyPenaltyFactor = 1.0; // applied last, after all additive scoring
      try {
        const d1 = new Date(String(item.date || '') + 'T00:00:00');
        if (Number.isFinite(d1.getTime()) && targetDow >= 0) {
          // Day-of-week: exact match is the strongest signal (Mon≠Fri, weekday≠weekend)
          let itemDow = d1.getDay();
          const itemRawDow = itemDow;
          if (storeConfig.holidayAsWeekend && item.isHoliday && itemDow >= 1 && itemDow <= 5) itemDow = 0;
          if (itemDow === targetDow) score += 20.0;
          else {
            // Saturday(6) and Sunday(0) are NOT interchangeable — different revenue patterns
            const bothWeekend = (itemDow === 0 || itemDow === 6) && (targetDow === 0 || targetDow === 6);
            if (bothWeekend) score += 1.5;
            else score += 0.3; // weekday vs wrong weekday, or weekday vs weekend
          }

          // ── CNY / holiday contamination detection ─────────────────────────
          const itemIsCNY = isCNYPeriod(item.date);
          const itemIsHolidayWeekday = (item.isHoliday || itemIsCNY) && itemRawDow >= 1 && itemRawDow <= 5;
          const itemIsNormalWkd = isNormalWorkday(item.date, item.isHoliday);

          if (itemIsHolidayWeekday && targetIsNormalWorkday) {
            // CNY-inflated weekday vs normal-day target: nearly discard
            // Penalty applied AFTER all additive scoring so recency can't rescue it
            cnyPenaltyFactor = 0.05;
          } else if (itemIsNormalWkd && !targetIsNormalWorkday && (targetDow === 0 || targetDow === 6 || targetIsHoliday)) {
            // Normal weekday data pulled for weekend/holiday forecast: down-weight
            cnyPenaltyFactor = 0.5;
          }

          // Recency bonus: skip for CNY-contaminated items targeting normal workdays
          if (targetDate && cnyPenaltyFactor > 0.1) {
            const d2 = new Date(targetDate + 'T00:00:00');
            if (Number.isFinite(d2.getTime())) {
              const dayDiff = Math.abs(Math.round((d2.getTime() - d1.getTime()) / 86400000));
              score += Math.max(0, 2.0 * (1.0 - Math.min(1.0, dayDiff / 90)));
            }
          }
        } else if (targetDate) {
          // Recency bonus when DOW not available
          const d1b = new Date(String(item.date || '') + 'T00:00:00');
          const d2 = new Date(targetDate + 'T00:00:00');
          if (Number.isFinite(d1b.getTime()) && Number.isFinite(d2.getTime())) {
            const dayDiff = Math.abs(Math.round((d2.getTime() - d1b.getTime()) / 86400000));
            score += Math.max(0, 2.0 * (1.0 - Math.min(1.0, dayDiff / 90)));
          }
        }
      } catch (e) { /* ignore */ }
      // Holiday matching (separate dimension)
      if (Boolean(item.isHoliday) === targetIsHoliday) score += 0.8;
      // Weather match
      const itemWeatherTag = normalizeForecastWeatherTag(item.weather);
      if (itemWeatherTag && targetWeatherTag) {
        if (itemWeatherTag === targetWeatherTag) score += 0.6;
        else score += 0.1;
      }
      // Apply CNY penalty as final multiplier — after all additive bonuses
      score = score * cnyPenaltyFactor;
      return { ...item, score: Number(score.toFixed(4)) };
    });

    // Filter to exact DOW-matching items when sufficient (≥2) to prevent
    // weekend high-revenue records from inflating weekday forecasts.
    const dowMatched = scored.filter((x) => {
      if (targetDow < 0) return false;
      try {
        const dw = new Date(String(x.date || '') + 'T00:00:00').getDay();
        return dw === targetDow;
      } catch (e) { return false; }
    });
    const scoringPool = dowMatched.length >= 2 ? dowMatched : scored;
    const picked = scoringPool
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, Math.min(20, scoringPool.length));
    const scoreSum = picked.reduce((s, x) => s + Number(x.score || 0), 0);
    const weightedRevenue = picked.reduce((s, x) => s + Number(x.revenue || 0) * Number(x.score || 0), 0);
    let estimatedRevenue = scoreSum > 0 ? (weightedRevenue / scoreSum) : 0;

    // Weather adjustment: rain/snow → takeaway up, dine-in down (differential correction)
    // Only apply if the weather-matched samples are underrepresented in picked set
    if (targetWeatherTag === 'rain' || targetWeatherTag === 'snow') {
      const matchCount = picked.filter((x) => normalizeForecastWeatherTag(x.weather) === targetWeatherTag).length;
      const coverage = picked.length > 0 ? matchCount / picked.length : 0;
      const strength = Math.max(0, 1 - coverage * 2); // full strength if <50% weather-matched
      const wf = targetWeatherTag === 'snow' ? storeConfig.snowFactor : storeConfig.rainFactor;
      const drop = 1 - wf; // e.g. 0.10 for 90% factor
      if (bizType === 'dinein') estimatedRevenue *= (1 - drop * strength);
      else if (bizType === 'takeaway') estimatedRevenue *= (1 + drop * 0.5 * strength);
    }

    const confidence = Math.max(0.2, Math.min(0.95, 0.35 + Math.min(0.5, list.length * 0.02)));
    result.byBizType[bizType].estimatedRevenue = Number(Math.max(0, estimatedRevenue).toFixed(2));
    result.byBizType[bizType].confidence = Number(confidence.toFixed(2));
    result.totalEstimatedRevenue += Number(result.byBizType[bizType].estimatedRevenue || 0);
  });

  result.totalEstimatedRevenue = Number(result.totalEstimatedRevenue.toFixed(2));
  return result;
}

function normalizeGrossProfitProfileItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const product = String(raw?.product || '').trim();
  const bizType = normalizeForecastBizType(raw?.bizType) || '';
  const costPerUnit = safeNumber(raw?.costPerUnit ?? raw?.cost);
  const grossPerUnit = safeNumber(raw?.grossPerUnit ?? raw?.grossProfit ?? raw?.profitPerUnit);
  if (!product) return null;
  // Accept either costPerUnit or grossPerUnit
  const hasCost = Number.isFinite(costPerUnit) && costPerUnit >= 0;
  const hasGross = Number.isFinite(grossPerUnit) && grossPerUnit >= 0;
  if (!hasCost && !hasGross) return null;
  return {
    product,
    bizType,
    costPerUnit: hasCost ? Number(costPerUnit.toFixed(4)) : undefined,
    grossPerUnit: hasGross ? Number(grossPerUnit.toFixed(4)) : undefined
  };
}

function computeAvgPricePerProduct(historyRows, storeScope, aliasLookup) {
  const storeSet = new Set(
    (Array.isArray(storeScope) ? storeScope : [storeScope])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
  );
  // agg keyed by bizType||productKey so dine-in and takeaway prices are tracked separately
  const agg = new Map();
  const rows = Array.isArray(historyRows) ? historyRows : [];
  rows.filter((x) => {
    if (!storeSet.size) return true;
    return storeSet.has(String(x?.store || '').trim());
  }).forEach((row) => {
    const rowBiz = normalizeForecastBizType(row?.bizType) || '';
    const rev = Math.max(0, Number(row?.expectedRevenue || 0));
    const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
    const entries = Object.entries(products)
      .map(([p, q]) => ({ product: String(p || '').trim(), qty: Number(q || 0) }))
      .filter((x) => x.product && x.qty > 0);
    const totalQty = entries.reduce((s, x) => s + x.qty, 0);
    entries.forEach(({ product, qty }) => {
      const resolved = resolveForecastProductName(product, aliasLookup);
      if (!resolved.key) return;
      const allocRev = totalQty > 0 && rev > 0 ? (qty / totalQty) * rev : 0;
      // Key by bizType so channels don't blend prices
      const key = `${rowBiz}||${resolved.key}`;
      const prev = agg.get(key) || { totalRevenue: 0, totalQty: 0 };
      prev.totalRevenue += allocRev;
      prev.totalQty += qty;
      agg.set(key, prev);
      // Also accumulate blended fallback key (empty biz prefix) for cross-channel lookup
      const fallbackKey = `||${resolved.key}`;
      const prev2 = agg.get(fallbackKey) || { totalRevenue: 0, totalQty: 0 };
      prev2.totalRevenue += allocRev;
      prev2.totalQty += qty;
      agg.set(fallbackKey, prev2);
    });
  });
  const result = new Map();
  agg.forEach((v, k) => {
    if (v.totalQty > 0) result.set(k, Number((v.totalRevenue / v.totalQty).toFixed(4)));
  });
  return result;
}

function canManageGrossProfitProfiles(role) {
const r = String(role || '').trim();
return r === 'admin' || r === 'hq_manager';
}

function normalizeDishAliasBizType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s === '*' || s === 'all' || s === '全部' || s === '通用') return '*';
  if (/takeaway|delivery|外卖|外送/.test(s)) return 'takeaway';
  if (/dinein|堂食|店内|堂食点餐/.test(s)) return 'dinein';
  return '*';
}

async function ensureDataGovernanceTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dish_name_aliases (
      id BIGSERIAL PRIMARY KEY,
      store VARCHAR(200) NOT NULL DEFAULT '*',
      biz_type VARCHAR(20) NOT NULL DEFAULT '*',
      alias_name VARCHAR(255) NOT NULL,
      canonical_name VARCHAR(255) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by VARCHAR(120),
      updated_by VARCHAR(120),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_dish_name_aliases_scope UNIQUE (store, biz_type, alias_name)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dish_name_aliases_lookup ON dish_name_aliases (store, biz_type, alias_name) WHERE enabled = TRUE`);
  // sales_raw已于2026-07-03下线，pos_sales_detail视图已直接提供dish_code(sku别名)/category列，
  // category_code该视图固定为NULL，不需要再对sales_raw做列补齐。
}

function estimateGrossMarginByHistory({ historyRows, profiles, startDate, endDate, bizType, storeScope, aliasLookup }) {
const list = Array.isArray(historyRows) ? historyRows : [];
const profileList = Array.isArray(profiles) ? profiles : [];
// Build avg price map for cost→gross conversion
const priceMap = storeScope ? computeAvgPricePerProduct(list, storeScope, aliasLookup) : new Map();
const profileMap = new Map();
const costPerUnitMap = new Map();
  profileList.forEach((p) => {
    const item = normalizeGrossProfitProfileItem(p);
    if (!item) return;
    let gpu = item.grossPerUnit;
    const resolvedItem = resolveForecastProductName(item.product, aliasLookup);
    const hasCost = Number.isFinite(item.costPerUnit) && item.costPerUnit >= 0;
    // Store costPerUnit for direct cost-based calculation
    if (hasCost) {
      costPerUnitMap.set(`${item.bizType}||${resolvedItem.key}`, item.costPerUnit);
      costPerUnitMap.set(`||${resolvedItem.key}`, item.costPerUnit);
    }
    // If only costPerUnit is set, compute grossPerUnit from biz-specific avg price
    if ((!Number.isFinite(gpu) || gpu === undefined) && hasCost) {
      const bizKey = `${item.bizType}||${resolvedItem.key}`;
      const fallbackKey = `||${resolvedItem.key}`;
      const avgPrice = priceMap.get(bizKey) || priceMap.get(fallbackKey) || 0;
      gpu = avgPrice > item.costPerUnit ? Number((avgPrice - item.costPerUnit).toFixed(4)) : 0;
    }
    if (!Number.isFinite(gpu)) return;
    // Store by both original and normalized name for matching
    profileMap.set(`${item.bizType}||${resolvedItem.key}`, gpu);
    const normName = resolvedItem.key;
    if (normName && normName !== item.product) {
      profileMap.set(`${item.bizType}||${normName}`, gpu);
      profileMap.set(`||${normName}`, gpu);
    }
    profileMap.set(`||${resolvedItem.key}`, gpu);
  });

  let rows = list.filter((x) => inDateRange(String(x?.date || '').trim(), startDate, endDate));
  if (bizType) rows = rows.filter((x) => normalizeForecastBizType(x?.bizType) === bizType);

  const productAgg = new Map();
  const byBizAgg = new Map();
  const uncovered = new Map();
  let totalRevenue = 0;
  let totalGrossProfit = 0;
  let totalActualRevenue = 0;
  let totalExpectedRevenue = 0;

  rows.forEach((row) => {
    const rowBizType = normalizeForecastBizType(row?.bizType);
    const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
    let rev = Math.max(0, Number(row?.expectedRevenue || 0));
    let rowActualRevRaw = Math.max(0, Number(row?.actualRevenue || 0));
    const rowDiscount = Math.max(0, Number(row?.totalDiscount || 0));
    // 安全校验：折前营收一定>=实收营收，若反了则交换（修复列映射反转问题）
    if (rev > 0 && rowActualRevRaw > 0 && rowActualRevRaw > rev) {
      const tmp = rev; rev = rowActualRevRaw; rowActualRevRaw = tmp;
    }
    const rowActualRev = rowActualRevRaw > 0 ? rowActualRevRaw : Math.max(0, rev - rowDiscount);
    totalExpectedRevenue += rev;
    totalActualRevenue += rowActualRev;
    const validEntries = Object.entries(products)
      .map(([product, qtyRaw]) => ({ product: String(product || '').trim(), qty: Number(qtyRaw || 0) }))
      .filter((x) => x.product && !isExcludedForecastProduct(x.product) && Number.isFinite(x.qty) && x.qty > 0);
    const rowTotalQty = validEntries.reduce((s, x) => s + Number(x.qty || 0), 0);
    validEntries.forEach((it) => {
      // Try exact name first, then normalized name for cross-matching (takeaway vs dine-in name variants)
      const resolved = resolveForecastProductName(it.product, aliasLookup);
      const normName = resolved.key;
      const keyExact = `${rowBizType}||${normName}`;
      const keyFallback = `||${normName}`;
      const keyNormExact = `${rowBizType}||${normName}`;
      const keyNormFallback = `||${normName}`;
      const gpu = Number(
        profileMap.has(keyExact) ? profileMap.get(keyExact) :
        profileMap.has(keyFallback) ? profileMap.get(keyFallback) :
        profileMap.has(keyNormExact) ? profileMap.get(keyNormExact) :
        profileMap.has(keyNormFallback) ? profileMap.get(keyNormFallback) : NaN
      );
      const allocRevenue = rowTotalQty > 0 && rev > 0 ? (Number(it.qty || 0) / rowTotalQty) * rev : 0;
      if (!Number.isFinite(gpu) || gpu === 0) {
        // Fallback: if costPerUnit available but no avgPrice for gross, use cost-based
        const cpuKey = costPerUnitMap.has(keyExact) ? keyExact : costPerUnitMap.has(keyFallback) ? keyFallback : null;
        if (cpuKey) {
          const cpu = costPerUnitMap.get(cpuKey);
          const costEst = Number(it.qty || 0) * cpu;
          const grossEst = Math.max(0, allocRevenue - costEst);
          totalRevenue += allocRevenue;
          totalGrossProfit += grossEst;
          const p2 = productAgg.get(resolved.display) || { product: resolved.display, qty: 0, revenue: 0, grossProfit: 0 };
          p2.qty += Number(it.qty || 0); p2.revenue += allocRevenue; p2.grossProfit += grossEst;
          productAgg.set(resolved.display, p2);
          return;
        }
        const miss = uncovered.get(resolved.display) || { product: resolved.display, qty: 0 };
        miss.qty += Number(it.qty || 0);
        uncovered.set(resolved.display, miss);
        return;
      }
      const gross = Number(it.qty || 0) * gpu;
      totalRevenue += allocRevenue;
      totalGrossProfit += gross;

      const p = productAgg.get(resolved.display) || { product: resolved.display, qty: 0, revenue: 0, grossProfit: 0 };
      p.qty += Number(it.qty || 0);
      p.revenue += allocRevenue;
      p.grossProfit += gross;
      productAgg.set(resolved.display, p);

      const b = byBizAgg.get(rowBizType) || { bizType: rowBizType, revenue: 0, grossProfit: 0, marginRate: 0 };
      b.revenue += allocRevenue;
      b.grossProfit += gross;
      byBizAgg.set(rowBizType, b);
    });
  });

  const byBiz = Array.from(byBizAgg.values()).map((x) => ({
    bizType: x.bizType,
    revenue: Number(x.revenue.toFixed(2)),
    grossProfit: Number(x.grossProfit.toFixed(2)),
    marginRate: Number((x.revenue > 0 ? x.grossProfit / x.revenue : 0).toFixed(4))
  }));
  const products = Array.from(productAgg.values())
    .map((x) => ({
      product: x.product,
      qty: Number(x.qty.toFixed(2)),
      revenue: Number(x.revenue.toFixed(2)),
      grossProfit: Number(x.grossProfit.toFixed(2)),
      marginRate: Number((x.revenue > 0 ? x.grossProfit / x.revenue : 0).toFixed(4))
    }))
    .sort((a, b) => Number(b.grossProfit || 0) - Number(a.grossProfit || 0));

  // 估算成本 = 折前营收 - 毛利（毛利基于折前营收分配计算）
  const coveredCostRate = totalRevenue > 0 ? Math.max(0, 1 - totalGrossProfit / totalRevenue) : 1;
  const totalEstimatedCost = Math.max(0, totalExpectedRevenue * coveredCostRate);
  // 折前毛利率 = (折前营收 - 成本) / 折前营收
  const marginRate = totalRevenue > 0 ? Number((totalGrossProfit / totalRevenue).toFixed(4)) : 0;
  // 实收毛利率 = (实收营收 - 成本) / 实收营收（成本不变，实收更低所以实收毛利率 < 折前毛利率）
  const actualGrossProfit = Math.max(0, totalActualRevenue - totalEstimatedCost);
  const actualMarginRate = totalActualRevenue > 0 ? Number((actualGrossProfit / totalActualRevenue).toFixed(4)) : 0;

  return {
    sampleCount: rows.length,
    revenue: Number(totalExpectedRevenue.toFixed(2)),
    actualRevenue: Number(totalActualRevenue.toFixed(2)),
    grossProfit: Number(totalGrossProfit.toFixed(2)),
    marginRate,
    actualMarginRate,
    byBiz,
    products,
    uncoveredProducts: Array.from(uncovered.values())
      .map((x) => ({ product: x.product, qty: Number(Number(x.qty || 0).toFixed(2)) }))
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
      .slice(0, 100)
  };
}

function decodePdfLiteralText(token) {
  let s = String(token || '');
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => {
      const code = parseInt(oct, 8);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function decodeUtf16BeBuffer(buf) {
  const src = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  if (!src.length) return '';
  const len = src.length - (src.length % 2);
  if (len <= 0) return '';
  const swapped = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 2) {
    swapped[i] = src[i + 1];
    swapped[i + 1] = src[i];
  }
  return swapped.toString('utf16le');
}

function decodePdfHexToken(hexRaw) {
  const hex = String(hexRaw || '').replace(/\s+/g, '');
  if (!hex || hex.length % 2 !== 0) return '';
  let bytes;
  try {
    bytes = Buffer.from(hex, 'hex');
  } catch (e) {
    return '';
  }
  if (!bytes.length) return '';

  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return decodeUtf16BeBuffer(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return bytes.subarray(2).toString('utf16le');
  }

  let evenZero = 0;
  let oddZero = 0;
  const pairs = Math.floor(bytes.length / 2);
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0) evenZero += 1;
    if (bytes[i + 1] === 0) oddZero += 1;
  }
  if (pairs > 2) {
    const evenZeroRate = evenZero / pairs;
    const oddZeroRate = oddZero / pairs;
    if (evenZeroRate > 0.45 && oddZeroRate < 0.2) {
      return decodeUtf16BeBuffer(bytes);
    }
    if (oddZeroRate > 0.45 && evenZeroRate < 0.2) {
      return bytes.toString('utf16le');
    }
  }

  const utf8 = bytes.toString('utf8');
  const bad = (utf8.match(/�/g) || []).length;
  if (bad <= Math.max(2, Math.floor(utf8.length * 0.1))) return utf8;
  return bytes.toString('latin1');
}

function isMeaningfulPdfText(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(t)) return false;
  return true;
}

function extractPdfText(rawBuffer) {
  const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || '');
  const streams = [];
  const text = buf.toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = streamRe.exec(text)) !== null) {
    streams.push({ start: m.index, data: Buffer.from(m[1] || '', 'latin1') });
  }

  const decodedBlocks = [];
  const pushDecoded = (b) => {
    const s = Buffer.isBuffer(b) ? b.toString('latin1') : String(b || '');
    if (s) decodedBlocks.push(s);
  };

  pushDecoded(buf);
  for (const s of streams) {
    const around = text.slice(Math.max(0, s.start - 220), s.start + 40);
    const mayFlate = /FlateDecode/i.test(around);
    if (mayFlate) {
      try { pushDecoded(zlib.inflateSync(s.data)); continue; } catch (e) { /* ignore */ }
      try { pushDecoded(zlib.inflateRawSync(s.data)); continue; } catch (e) { /* ignore */ }
    }
    pushDecoded(s.data);
  }

  const chunks = [];
  const tokenRe = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>/g;
  decodedBlocks.forEach((blk) => {
    let t;
    while ((t = tokenRe.exec(blk)) !== null) {
      if (t[0]?.startsWith('(')) {
        const plain = decodePdfLiteralText(t[0]).trim();
        if (isMeaningfulPdfText(plain)) chunks.push(plain);
      } else if (t[1]) {
        const plain = decodePdfHexToken(t[1]).trim();
        if (isMeaningfulPdfText(plain)) chunks.push(plain);
      }
    }
  });

  return chunks.join('\n');
}

function parseInventoryForecastRowsFromPdfBuffer(rawBuffer, fallbackBizType = '') {
  const text = nfkcNormalize(extractPdfText(rawBuffer));
  if (!text) return [];

  const lines = String(text)
    .split(/\r?\n/)
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const matrix = lines
    .map((line) => {
      if (/\t/.test(line)) return line.split(/\t+/).map((x) => x.trim());
      if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((x) => x.trim());
      if (/,/.test(line)) return line.split(',').map((x) => x.trim());
      return [line];
    })
    .filter((arr) => arr.some(Boolean));

  let parsed = parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType);
  if (parsed.length) return parsed;

  const dateMatch = text.match(/(20\d{2}[\-\/.年]\d{1,2}[\-\/.月]\d{1,2})/);
  const date = normalizeForecastUploadDate(dateMatch ? dateMatch[1] : '');
  const storeMatch = text.match(/(?:门店|店铺|商户|销售门店|门店名称)\s*[：:]\s*([^\n,，;；]+)/);
  const parsedStore = normalizeForecastStoreName(storeMatch ? storeMatch[1] : '');
  const weatherMatch = text.match(/(晴|阴|多云|小雨|中雨|大雨|暴雨|雨|雪|雾|风)/);
  const weather = normalizeForecastWeather(weatherMatch ? weatherMatch[1] : '');
  const bizRaw = /外卖|外送/.test(text) ? '外卖' : (/堂食|堂吃/.test(text) ? '堂食' : fallbackBizType);
  const bizType = normalizeForecastBizType(bizRaw) || 'dinein';

  const detailRows = [];
  lines.forEach((line) => {
    const m2 = line.match(/(\d{1,2}\s*[:：]\s*\d{1,2}\s*[~～\-—–至到]\s*\d{1,2}\s*[:：]\s*\d{1,2}).*?([^\d]{2,}?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s|$)/);
    if (!m2) return;
    const slot = normalizeForecastSlotFromHourRange(m2[1]);
    const product = String(m2[2] || '').trim();
    const qty = Number(m2[3]);
    const amount = Number(m2[4]);
    if (!slot || !product || isExcludedForecastProduct(product) || !Number.isFinite(qty) || qty <= 0) return;
    detailRows.push({ slot, product, qty, amount: Number.isFinite(amount) ? amount : 0 });
  });
  if (!detailRows.length || !date) return [];

  const grouped = new Map();
  detailRows.forEach((it) => {
    const key = `${bizType}||${it.slot}||${date}`;
    if (!grouped.has(key)) grouped.set(key, { store: parsedStore, bizType, slot: it.slot, date, weather, isHoliday: false, expectedRevenue: 0, productQuantities: {} });
    const row = grouped.get(key);
    if (!row.store && parsedStore) row.store = parsedStore;
    row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + Number(it.amount || 0)).toFixed(2));
    row.productQuantities[it.product] = Number((Number(row.productQuantities[it.product] || 0) + Number(it.qty || 0)).toFixed(2));
  });

  parsed = Array.from(grouped.values()).filter((x) => x.bizType && x.slot && x.date && Object.keys(x.productQuantities || {}).length);
  return parsed;
}

function nfkcNormalize(s) {
  let out = String(s || '');
  try { out = out.normalize('NFKC'); } catch (e) { /* ignore */ }
  // CJK Radicals Supplement chars that NFKC misses (pdftotext outputs these)
  const radicalMap = {
    '\u2E81': '丨', '\u2E84': '丶', '\u2E85': '丿', '\u2E86': '乀', '\u2E87': '乁',
    '\u2E88': '亅', '\u2E8B': '冫', '\u2E8C': '冖', '\u2E97': '匕', '\u2E98': '匚',
    '\u2E9C': '厂', '\u2E9F': '又', '\u2EA5': '女', '\u2EAA': '宀', '\u2EAB': '寸',
    '\u2EAD': '尢', '\u2EB3': '巛', '\u2EB6': '干', '\u2EB7': '幺', '\u2EBB': '弓',
    '\u2EBC': '彐', '\u2EBE': '彡', '\u2EC0': '彳', '\u2EC6': '戈', '\u2EC8': '手',
    '\u2ECA': '支', '\u2ECC': '文', '\u2ECD': '斗', '\u2ECF': '方', '\u2ED1': '日',
    '\u2ED4': '木', '\u2ED6': '欠', '\u2ED7': '止', '\u2ED8': '歹', '\u2EDA': '毋',
    '\u2EDB': '比', '\u2EDC': '毛', '\u2EDD': '食', // ⻝ → 食 (critical for this PDF)
    '\u2EDE': '氏', '\u2EDF': '气', '\u2EE0': '水', '\u2EE1': '火', '\u2EE2': '爪',
    '\u2EE3': '父', '\u2EE4': '爻', '\u2EE5': '片', '\u2EE8': '犬', '\u2EEB': '玄',
    '\u2EED': '瓜', '\u2EEF': '甘', '\u2EF0': '生', '\u2EF2': '疋', '\u2EF3': '疒',
  };
  out = out.replace(/[\u2E80-\u2EFF]/g, (ch) => radicalMap[ch] || ch);
  return out;
}

function parseInventoryForecastRowsFromPdfPath(pdfPath, fallbackBizType = '') {
  const p = String(pdfPath || '').trim();
  if (!p) return [];
  try {
    const out = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', p, '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
      maxBuffer: 12 * 1024 * 1024
    });
    const text = nfkcNormalize(String(out || '')).trim();
    if (!text) return [];
    console.log('[pdf-parse] pdftotext output length:', text.length, 'first 300 chars:', text.slice(0, 300));
    const lines = text.split(/\r?\n/).map((x) => String(x || '').trim()).filter(Boolean);
    if (!lines.length) return [];
    const matrix = lines.map((line) => {
      if (/\t/.test(line)) return line.split(/\t+/).map((x) => x.trim());
      if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((x) => x.trim());
      if (/,/.test(line)) return line.split(',').map((x) => x.trim());
      return [line];
    });
    const parsed = parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType);
    if (parsed.length) return parsed;

    const dateMatch = text.match(/(20\d{2}[\-\/.年]\d{1,2}[\-\/.月]\d{1,2})/);
    const date = normalizeForecastUploadDate(dateMatch ? dateMatch[1] : '');
    const storeMatch = text.match(/(?:门店|店铺|商户|销售门店|门店名称)\s*[：:]\s*([^\n,，;；]+)/);
    const parsedStore = normalizeForecastStoreName(storeMatch ? storeMatch[1] : '');
    const weatherMatch = text.match(/(晴|阴|多云|小雨|中雨|大雨|暴雨|雨|雪|雾|风)/);
    const weather = normalizeForecastWeather(weatherMatch ? weatherMatch[1] : '');
    const bizRaw = /外卖|外送/.test(text) ? '外卖' : (/堂食|堂吃/.test(text) ? '堂食' : fallbackBizType);
    const bizType = normalizeForecastBizType(bizRaw) || 'dinein';

    if (!date) return [];
    const grouped = new Map();
    lines.forEach((line) => {
      const m2 = line.match(/(\d{1,2}\s*[:：]\s*\d{1,2}\s*[~～\-—–至到]\s*\d{1,2}\s*[:：]\s*\d{1,2}).*?([^\d]{2,}?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s|$)/);
      if (!m2) return;
      const slot = normalizeForecastSlotFromHourRange(m2[1]);
      const product = String(m2[2] || '').trim();
      const qty = Number(m2[3]);
      const amount = Number(m2[4]);
      if (!slot || !product || isExcludedForecastProduct(product) || !Number.isFinite(qty) || qty <= 0) return;
      const key = `${bizType}||${slot}||${date}`;
      if (!grouped.has(key)) grouped.set(key, { store: parsedStore, bizType, slot, date, weather, isHoliday: false, expectedRevenue: 0, productQuantities: {} });
      const row = grouped.get(key);
      if (!row.store && parsedStore) row.store = parsedStore;
      row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + (Number.isFinite(amount) ? amount : 0)).toFixed(2));
      row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
    });

    return Array.from(grouped.values()).filter((x) => x.bizType && x.slot && x.date && Object.keys(x.productQuantities || {}).length);
  } catch (e) {
    return [];
  }
}
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
  console.log('[uploads] Uploads dir ready:', uploadsDir);
} catch (e) {
  console.error('[uploads] Cannot ensure uploads dir writable:', e?.message || e);
  try { fs.chmodSync(uploadsDir, 0o755); } catch (e2) {
    console.error('[uploads] chmod fallback also failed:', e2?.message || e2);
  }
}



/**
 * 手动补发「菜品优化周报」飞书卡片 → admin / hq_manager（sales_raw + dish_library_costs）
 * Body 可选：{ "weekStart": "2026-03-23", "weekEnd": "2026-03-29" }；省略则按当前上海日期取「刚结束的自然周」周一～周日。
 */
app.post('/api/admin/perf/dish-weekly/resend', authRequired, async (req, res) => {
  try {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden', message: '仅 admin 或 hq_manager' });
    }
    let weekStart = String(req.body?.weekStart || '').trim();
    let weekEnd = String(req.body?.weekEnd || '').trim();
    if (!weekStart || !weekEnd) {
      const w = getLastCompletedWeekRangeShanghai();
      weekStart = w.start;
      weekEnd = w.end;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
      return res.status(400).json({ error: 'bad_range', message: 'weekStart/weekEnd 须为 YYYY-MM-DD' });
    }
    await sendWeeklyDishOptimizationReport(weekStart, weekEnd);
    return res.json({ ok: true, weekStart, weekEnd, message: '已尝试向 admin/hq_manager 发送菜品优化周报卡片' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

// Bitable Management API
app.get('/api/bitable/stats', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hr_manager', 'hq_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  try {
    const stats = await getBitableSubmissionStats();
    res.json({ ok: true, data: stats });
  } catch (e) {
    console.error('[api] bitable stats error:', e?.message);
    res.status(500).json({ error: 'internal_error', message: 'internal_error' });
  }
});

app.post('/api/bitable/archive', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hr_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  try {
    const result = await archiveOldBitableSubmissions();
    res.json({ ok: true, data: result });
  } catch (e) {
    console.error('[api] bitable archive error:', e?.message);
    res.status(500).json({ error: 'internal_error', message: 'internal_error' });
  }
});

// ─── Agent API - 通用查询飞书多维表数据（已落库的 generic records）
// H1-FIX: 添加认证保护
app.get('/api/agent/feishu-table-data', authRequired, async (req, res) => {
  try {
    const appToken = String(req.query?.appToken || '').trim();
    const tableId = String(req.query?.tableId || '').trim();
    const q = String(req.query?.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query?.offset) || 0, 0);

    if (!appToken || !tableId) {
      return res.status(400).json({ error: 'missing_params', message: 'appToken/tableId required' });
    }

    const where = ['app_token = $1', 'table_id = $2'];
    const params = [appToken, tableId];
    if (q) {
      params.push(`%${q}%`);
      where.push(`fields::text ilike $${params.length}`);
    }
    params.push(req.tenantId || req.user?.tenant_id || 'default');
    where.push(`tenant_id = $${params.length}`);

    const whereSql = where.length ? `where ${where.join(' and ')}` : '';

    const countR = await pool.query(
      `select count(*)::int as cnt from feishu_generic_records ${whereSql}`,
      params
    );
    const total = Number(countR.rows?.[0]?.cnt || 0) || 0;

    params.push(limit, offset);
    const r = await pool.query(
      `select app_token, table_id, record_id, fields, updated_at
       from feishu_generic_records
       ${whereSql}
       order by updated_at desc
       limit $${params.length - 1} offset $${params.length}`,
      params
    );

    return res.json({
      items: r.rows || [],
      pagination: { limit, offset, total },
      query: { appToken, tableId, q: q || '' }
    });
  } catch (e) {
    console.error('[Agent Feishu Table Data] Error:', e);
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.post('/api/ai/chat-completions', authRequired, async (req, res) => {
  const username = String(req.user?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'missing_user' });

  const baseUrl = normalizeOpenAiCompatibleBaseUrl(req.body?.baseUrl || req.body?.apiUrl || '');
  const apiKey = String(req.body?.apiKey || '').trim();
  const model = String(req.body?.model || '').trim();
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const maxTokens = Math.max(1, Math.min(4000, Number(req.body?.max_tokens || req.body?.maxTokens || 1024) || 1024));
  const temperature = Number(req.body?.temperature);

  if (!baseUrl) return res.status(400).json({ error: 'missing_base_url' });
  if (!apiKey) return res.status(400).json({ error: 'missing_api_key' });
  if (!model) return res.status(400).json({ error: 'missing_model' });
  if (!messages.length) return res.status(400).json({ error: 'missing_messages' });

  const payload = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: Number.isFinite(temperature) ? temperature : 0.2
  };

  const controller = new AbortController();
  /** 出题/长上下文等场景上游常 >25s；过短会 502 + 浏览器 aborted */
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await upstream.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* ignore */ }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'upstream_error',
        message: String(data?.error?.message || data?.message || text || `HTTP ${upstream.status}`),
        upstreamStatus: upstream.status
      });
    }
    if (data && typeof data === 'object') return res.json(data);
    return res.json({ raw: text });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unreachable', message: 'internal_error' });
  } finally {
    clearTimeout(timer);
  }
});

// Wave 4f: /api/payments/* → domains/payments/routes.js
// Wave 4c: POST /api/approvals (create), return, resubmit, repair-onboarding → domains/approvals/routes-lifecycle.js

app.post('/api/reads/batch', authRequired, async (req, res) => {
  const username = String(req.user?.username || '').trim();
  const module = String(req.body?.module || '').trim();
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(x => String(x || '').trim()).filter(Boolean) : [];
  if (!username) return res.status(400).json({ error: 'missing_user' });
  if (!module) return res.status(400).json({ error: 'missing_module' });
  if (!keys.length) return res.json({ ok: true, inserted: 0 });

  const sliced = keys.slice(0, 500);
  try {
    const values = [];
    const params = [];
    sliced.forEach((k, i) => {
      params.push(username, module, k);
      const base = i * 3;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, now())`);
    });
    await pool.query(
      `insert into user_reads (username, module, item_key, read_at)
       values ${values.join(',')}
       on conflict (username, module, item_key) do update set read_at = excluded.read_at`,
      params
    );
    return res.json({ ok: true, inserted: sliced.length });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.get('/api/unread-counts', authRequired, async (req, res) => {
  const username = String(req.user?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'missing_user' });

  try {
    const readsR = await pool.query('select module, item_key from user_reads where username = $1', [username]);
    const readMap = new Map();
    (readsR.rows || []).forEach(r => {
      const m = String(r?.module || '').trim();
      const k = String(r?.item_key || '').trim();
      if (!m || !k) return;
      if (!readMap.has(m)) readMap.set(m, new Set());
      readMap.get(m).add(k);
    });

    const approvalsUnreadR = await pool.query(
      `select count(*)::int as cnt
       from approval_requests ar
       left join user_reads ur
         on ur.username = $1 and ur.module = 'approval' and ur.item_key = ar.id::text
       where ar.status = 'pending'
         and lower(ar.current_assignee_username) = lower($1)
         and ar.tenant_id = $2
         and ur.item_key is null`,
      [username, req.tenantId || req.user?.tenant_id || 'default']
    );
    const approvals = approvalsUnreadR.rows?.[0]?.cnt || 0;

    const state = (await getSharedState()) || {};
    const me = stateFindUserRecord(state, username) || await dbFindEmployeeRecord(username) || {};
    const myStore = String(me?.store || '').trim();
    const myDept = String(me?.department || '').trim();
    const myPos = String(me?.position || '').trim();

    const isRead = (module, key) => {
      const s = readMap.get(module);
      return s ? s.has(String(key || '').trim()) : false;
    };

    const tasks = Array.isArray(state.trainingTasks) ? state.trainingTasks : [];
    let training = 0;
    for (const t of tasks) {
      const id = String(t?.id || '').trim();
      if (!id) continue;
      if (String(t?.status || '') === 'cancelled') continue;
      const scope = t?.scope && typeof t.scope === 'object' ? t.scope : {};
      const scopeType = String(scope?.type || '').trim();
      const matchScope =
        scopeType === 'all' ||
        (scopeType === 'store' && String(scope?.store || '').trim() && String(scope.store).trim() === myStore) ||
        (scopeType === 'department' && String(scope?.department || '').trim() && String(scope.department).trim() === myDept) ||
        (scopeType === 'user' && String(scope?.user || '').trim() && String(scope.user).trim() === username);

      const assignedTo = String(t?.assignedTo || '').trim();
      const assignedUsers = Array.isArray(t?.assignedUsers) ? t.assignedUsers.map(x => String(x || '').trim()) : [];
      const matchAssigned = assignedTo === username || assignedUsers.includes(username);
      if (!matchScope && !matchAssigned) continue;
      if (isRead('training', id)) continue;
      training += 1;
    }

    const assignments = Array.isArray(state.examAssignments) ? state.examAssignments : [];
    const toArr = (v) => {
      if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
      const s = String(v || '').trim();
      return s ? [s] : [];
    };
    let exam = 0;
    for (const a of assignments) {
      const id = String(a?.id || '').trim();
      if (!id) continue;
      const scope = a?.scope && typeof a.scope === 'object' ? a.scope : (a?.audience && typeof a.audience === 'object' ? a.audience : {});
      const t = String(scope?.type || 'all').trim();
      let match = true;
      if (t === 'store') match = toArr(scope?.stores || scope?.store || scope?.value).includes(myStore);
      if (t === 'position') match = toArr(scope?.positions || scope?.position || scope?.value).includes(myPos);
      if (t === 'user') match = toArr(scope?.users || scope?.user || scope?.value).includes(username);
      if (!match) continue;
      if (isRead('exam', id)) continue;
      exam += 1;
    }

    const notifications = Array.isArray(state.notifications) ? state.notifications : [];
    let dashboard = 0;
    for (const n of notifications) {
      const key = String(n?.id || '').trim();
      if (!key) continue;

      const targetUser = String(n?.targetUser || '').trim();
      if (targetUser) {
        if (targetUser !== username) continue;
      } else {
        const scope = n?.scope && typeof n.scope === 'object' ? n.scope : null;
        const t = String(scope?.type || 'all').trim();
        if (t === 'all') {
          // visible
        } else if (t === 'store') {
          if (String(scope?.store || '').trim() !== myStore) continue;
        } else if (t === 'position') {
          if (String(scope?.position || '').trim() !== myPos) continue;
        } else if (t === 'user') {
          const list = Array.isArray(scope?.usernames) ? scope.usernames.map(x => String(x || '').trim()) : [];
          if (!list.includes(username)) continue;
        } else {
          continue;
        }
      }

      if (isRead('dashboard', key)) continue;
      dashboard += 1;
    }

    // rewards: unread reward_punishment records for this user
    let rewards = 0;
    try {
      const rwR = await pool.query(
        `SELECT count(*)::int as cnt
         FROM approval_requests ar
         LEFT JOIN user_reads ur
           ON ur.username = $1 AND ur.module = 'rewards' AND ur.item_key = ar.id::text
         WHERE ar.type = 'reward_punishment'
           AND ar.status IN ('approved','paid')
           AND (ar.payload->>'targetUser' = $1 OR ar.submitted_by = $1)
           AND ar.tenant_id = $2
           AND ur.item_key IS NULL`,
        [username, req.tenantId || req.user?.tenant_id || 'default']
      );
      rewards = rwR.rows?.[0]?.cnt || 0;
    } catch (e) { /* ignore */ }

    // payment: unread payment records for this user
    let payment = 0;
    try {
      const pmR = await pool.query(
        `SELECT count(*)::int as cnt
         FROM approval_requests ar
         LEFT JOIN user_reads ur
           ON ur.username = $1 AND ur.module = 'payment' AND ur.item_key = ar.id::text
         WHERE ar.type = 'payment'
           AND ar.status = 'pending'
           AND (lower(ar.current_assignee_username) = lower($1) OR lower(ar.submitted_by) = lower($1))
           AND ar.tenant_id = $2
           AND ur.item_key IS NULL`,
        [username, req.tenantId || req.user?.tenant_id || 'default']
      );
      payment = pmR.rows?.[0]?.cnt || 0;
    } catch (e) { /* ignore */ }

    let opsTasks = 0;
    try {
      const opR = await pool.query(
        `select count(*)::int as cnt
         from ops_tasks t
         left join user_reads ur
           on ur.username = $1 and ur.module = 'ops_tasks' and ur.item_key = t.id::text
         where t.status in ('open', 'overdue')
           and lower(t.assignee_username) = lower($1)
           and ur.item_key is null`,
        [username]
      );
      opsTasks = opR.rows?.[0]?.cnt || 0;
    } catch (e) { /* ignore */ }

    return res.json({ approvals, training, exam, dashboard, rewards, payment, opsTasks });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});
// 2026-06-25 文件存储租户隔离：/uploads 之前用express.static公开裸露，任何人拿到URL
// (哪怕是员工身份证照片)不用登录就能直接看，且没有租户边界。改为鉴权路由按文件归属
// 租户校验后才流式返回。URL路径不变(/uploads/<...>)，老链接不受影响，只是访问方式变了。
app.get('/uploads/*', authRequired, async (req, res) => {
  try {
    const rawRel = String(req.params[0] || '').replace(/^\/+/, '');
    const normalizedRel = path.normalize(rawRel);
    if (!rawRel || normalizedRel.startsWith('..') || path.isAbsolute(normalizedRel)) {
      return res.status(400).json({ error: 'invalid_path' });
    }
    const fullPath = path.join(uploadsDir, normalizedRel);
    if (!fullPath.startsWith(uploadsDir)) return res.status(400).json({ error: 'invalid_path' });
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'not_found' });

    const filename = path.basename(normalizedRel);
    const reqTenantId = String(req.tenantId || 'default').trim() || 'default';
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') {
      let ownerTenantId = 'default';
      try {
        const r = await pool.query(`SELECT tenant_id FROM upload_file_owners WHERE filename = $1 LIMIT 1`, [filename]);
        ownerTenantId = r.rows?.[0]?.tenant_id || 'default';
      } catch (_) { /* 查询失败：保守按default处理，不放行非default租户 */ }
      if (ownerTenantId !== reqTenantId) return res.status(403).json({ error: 'forbidden' });
    }
    return res.sendFile(fullPath);
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

// 上传成功后记录文件归属租户，供上面的鉴权下载路由做校验
async function recordUploadOwnership(filenames, tenantId, uploadedBy) {
  const list = (Array.isArray(filenames) ? filenames : [filenames]).filter(Boolean);
  if (!list.length) return;
  try {
    for (const filename of list) {
      await pool.query(
        `INSERT INTO upload_file_owners (filename, tenant_id, uploaded_by) VALUES ($1,$2,$3)
         ON CONFLICT (filename) DO NOTHING`,
        [filename, tenantId || 'default', uploadedBy || null]
      );
    }
  } catch (e) {
    console.warn('[uploads] recordUploadOwnership failed:', e?.message);
  }
}

const webRootDir = path.resolve(__dirname, '..');
// 2026-06-25 安全修复(严重)：原来 express.static(webRootDir) 不分青红皂白地把整个项目根目录
// 公开对外，包括 server/ 全部后端源码、migrations/ 全部SQL、docs/、*.md报告、database.sql、
// db-check*.js等——任何人访问 https://nnyx.cc/server/index.js 都能直接下载完整后端源码。
// 实测确认(curl https://nnyx.cc/server/index.js → 200，返回完整源码)。
// 改为白名单：只放行前端确实需要公开访问的具体文件/目录，其余一律不经过这个静态服务器，
// 落到下面的具体路由处理（未匹配的最终会进Express默认404，不会再暴露文件系统）。
const STATIC_ALLOWED_ROOT_FILES = new Set([
  'working-fixed.html', 'agents-admin.html', 'platform-admin.html', 'campaign.html',
  'forecast.html', 'index.html', 'member-agreement.html',
  'svremind.html', 'winback.html', 'manifest.json', 'pwa-icon.svg', 'sw.js', 'script.js',
  'styles.css', 'role-modules-ui.js'
]);
const STATIC_ALLOWED_DIR_PREFIXES = ['assets/', 'dist/'];
const staticServeWebRoot = express.static(webRootDir, {
  index: false,
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    const lp = String(filePath || '').toLowerCase();
    if (lp.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // no-cache（非 no-store）：浏览器可缓存，但每次用前必须带 ETag 回源校验；
      // 内容未变回 304（几乎0流量并复用缓存），改版后 ETag 变化即拉新版，不会读到过期页面。
      res.setHeader('Cache-Control', 'no-cache');
    } else if (lp.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
});
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const reqPath = decodeURIComponent(String(req.path || '')).replace(/^\/+/, '');
  const isAllowedDir = STATIC_ALLOWED_DIR_PREFIXES.some((pre) => reqPath.startsWith(pre));
  const isAllowedFile = STATIC_ALLOWED_ROOT_FILES.has(reqPath) || reqPath === '';
  // build-shell.mjs生成的内容哈希资源(app.<hash>.js/.css)，生产环境nginx会先拦截直接served，
  // 这里放行只是为了本地/没走nginx时也不404，与白名单其余条目同等安全(内容是构建产物，不是源码)
  const isHashedAsset = /^app\.[0-9a-f]+\.(js|css)$/.test(reqPath);
  if (!isAllowedDir && !isAllowedFile && !isHashedAsset) return next();
  return staticServeWebRoot(req, res, next);
});

app.get('/agent/tenant-operation-inspection', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(webRootDir, 'agents-admin.html'));
});

// Wave 4h: /api/permission-groups* → domains/permission-groups/routes.js

// A2：GET/PUT /api/role-modules 唯一权威 = domains/flow-config（hr_rating_configs + state 镜像）
// agent-config-manager 内影子路由已删除（勿再加 /api/admin/role-modules）

// Wave 4k: /api/admin/store-duty-bindings* → domains/store-duty-bindings/routes.js

// ─── Dedup Stats & Cleanup API ───────────────────────────────────────────────
app.get('/api/dedup/stats', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  try {
    const tables = {};
    // agent_messages duplicates
    const am = await pool.query(`SELECT count(*) as cnt FROM (
      SELECT record_id, content_type, count(*) as c FROM agent_messages
      WHERE record_id IS NOT NULL AND record_id != '' AND tenant_id = $1
      GROUP BY record_id, content_type HAVING count(*) > 1) t`, [req.tenantId || req.user?.tenant_id || 'default']);
    tables.agent_messages_dup_groups = Number(am.rows[0]?.cnt || 0);
    // feishu_generic_records total
    const fg = await pool.query(`SELECT count(*) as cnt FROM feishu_generic_records`);
    tables.feishu_generic_records = Number(fg.rows[0]?.cnt || 0);
    // pos_sales_detail total(sales_raw已下线)
    const sr = await pool.query(`SELECT count(*) as cnt FROM pos_sales_detail`);
    tables.pos_sales_detail = Number(sr.rows[0]?.cnt || 0);
    // table_visit_records total
    const tv = await pool.query(`SELECT count(*) as cnt FROM table_visit_records`);
    tables.table_visit_records = Number(tv.rows[0]?.cnt || 0);
    return res.json({ ok: true, tables });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.post('/api/dedup/cleanup', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  try {
    // Remove duplicate agent_messages (keep newest, tiebreak by id)
    const del = await pool.query(`
      DELETE FROM agent_messages a USING agent_messages b
      WHERE a.record_id IS NOT NULL AND a.record_id != ''
        AND a.record_id = b.record_id AND a.content_type = b.content_type
        AND a.tenant_id = b.tenant_id AND a.tenant_id = $1
        AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id))`, [req.tenantId || req.user?.tenant_id || 'default']);
    return res.json({ ok: true, deleted: del.rowCount || 0 });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.get('/api/me', authRequired, async (req, res) => {
  const username = String(req.user?.username || '').trim();
  const role = String(req.user?.role || '').trim();
  if (!username) return res.status(400).json({ error: 'missing_user' });
  try {
    const state = (await getSharedState()) || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const users = Array.isArray(state.users) ? state.users : [];
    const emp = employees.find(e => String(e?.username || '').trim() === username) || {};
    const usr = users.find(u => String(u?.username || '').trim() === username) || {};
    const permCtx = await resolveUserPermissionContext(req, { getSharedState });
    return res.json({
      user: {
        username,
        name: emp.name || usr.name || username,
        role: role || emp.role || usr.role || 'employee',
        store: emp.store || usr.store || req.user?.store || '',
        position: emp.position || usr.position || '',
        department: emp.department || usr.department || '',
        permission_group_id: permCtx.permission_group_id || null,
        enforcement_mode: permCtx.enforcement_mode || 'legacy',
        permissions: permCtx.permissions || [],
        allowed_stores: req.user?.allowed_stores || [],
        current_store: req.user?.current_store || '',
      }
    });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.get('/', (req, res) => {
  const p1 = path.join(webRootDir, 'working-fixed.html');
  const p2 = path.join(webRootDir, 'index.html');
  const target = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : null);
  if (!target) return res.status(404).send('Missing frontend html');
  // no-cache（非 no-store）：允许缓存但每次回源校验，命中 ETag 回 304；改版即拉新版。
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.sendFile(target);
});

const UPLOAD_ALLOWED_EXTS = new Set([
  '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
  '.jpg','.jpeg','.png','.gif','.webp','.bmp',
  '.txt','.csv','.zip','.rar',
  '.mp4','.mov','.webm','.avi',
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const st = ensureUploadsDir();
      if (!st.ok) return cb(new Error('uploads_dir_not_writable: ' + String(st.error || 'unknown')));
      return cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const orig = String(file?.originalname || 'file');
      const ext = path.extname(orig).toLowerCase().slice(0, 16);
      if (!UPLOAD_ALLOWED_EXTS.has(ext)) {
        return cb(new Error(`blocked_file_type: ${ext || 'unknown'}`));
      }
      cb(null, `${randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const knowledgeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const st = ensureUploadsDir();
      if (!st.ok) return cb(new Error('uploads_dir_not_writable: ' + String(st.error || 'unknown')));
      return cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const orig = String(file?.originalname || 'file');
      const ext = path.extname(orig).toLowerCase().slice(0, 16);
      if (!UPLOAD_ALLOWED_EXTS.has(ext) && !['.json', '.md', '.yaml', '.yml'].includes(ext)) {
        return cb(new Error(`blocked_file_type: ${ext || 'unknown'}`));
      }
      cb(null, `${randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 } // 视频上传需 500MB
});

// 配方工艺步骤媒体上传（图片 + 视频）
const RECIPE_MEDIA_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.mp4','.mov','.webm','.heic']);
const recipeMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const st = ensureUploadsDir();
      if (!st.ok) return cb(new Error('uploads_dir_not_writable'));
      return cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(String(file?.originalname || 'file')).toLowerCase().slice(0, 16);
      if (!RECIPE_MEDIA_EXTS.has(ext)) return cb(new Error(`blocked_file_type: ${ext}`));
      cb(null, `recipe-step-${randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB max for video
});

// 培训实操上传（图片 + 视频）
const TRAINING_MEDIA_EXTS = new Set(['.jpg','.jpeg','.png','.mp4','.mov','.webm','.heic']);
const trainingPracticeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const trainingDir = path.join(uploadsDir, 'training');
      fs.mkdirSync(trainingDir, { recursive: true });
      cb(null, trainingDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!TRAINING_MEDIA_EXTS.has(ext)) return cb(new Error('blocked_file_type'));
      cb(null, `training-${randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

app.post('/api/recipes/upload-step-media', authRequired, recipeMediaUpload.single('file'), async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin','hq_manager','store_manager','store_production_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    if (!req.file?.filename) return res.status(400).json({ error: 'missing_file' });
    await recordUploadOwnership(req.file.filename, req.tenantId, req.user?.username);
    const ext = path.extname(req.file.filename).toLowerCase();
    const videoExts = new Set(['.mp4','.mov','.webm']);
    const mediaType = videoExts.has(ext) ? 'video' : 'image';
    return res.json({ ok: true, url: `/uploads/${req.file.filename}`, type: mediaType });
  } catch (e) {
    return res.status(500).json({ error: e?.message });
  }
});

// 配方 Excel 模版下载
const RECIPE_ADMIN_ROLES = new Set(['admin','hq_manager','store_manager','store_production_manager']);
app.get('/api/recipes/template', authRequired, (req, res) => {
  if (!RECIPE_ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
  try {
    const buf = generateRecipeTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'%E9%85%8D%E6%96%B9%E5%AF%BC%E5%85%A5%E6%A8%A1%E7%89%88.xlsx');
    res.send(buf);
  } catch(e) {
    res.status(500).json({ error: e?.message });
  }
});

// 配方 Excel 导入
app.post('/api/recipes/import', authRequired, upload.single('file'), async (req, res) => {
  if (!RECIPE_ADMIN_ROLES.has(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
  try {
    if (!req.file?.path) return res.status(400).json({ error: 'missing_file' });
    const buffer = fs.readFileSync(req.file.path);
    const result = await importRecipeFromExcel(buffer, req.user.username, req.user?.store || '*');
    if (!result.success) return res.json({ success: false, error: result.error });
    // Read back dish name from the import for the response
    const row = await import('./utils/database.js').then(m => m.pool().query('SELECT dish_name FROM recipes WHERE id=$1', [result.id]));
    return res.json({ success: true, id: result.id, dishName: row.rows[0]?.dish_name || '' });
  } catch(e) {
    return res.status(500).json({ success: false, error: e?.message });
  }
});

// Wave 4i: POST /api/uploads/* (daily-report/idcard/points) → domains/uploads/routes.js

const pool = new Pool({ connectionString: DATABASE_URL });
const loginRateLimit = createLoginRateLimiter();
const platformAdminRequired = createPlatformAdminRequired(pool, PLATFORM_ADMIN_JWT_SECRET);

setAgentPool(pool);
initBrandConfigCache().catch((e) => console.error('initBrandConfigCache failed:', e?.message || e));
configureDbSessionSafety(pool, { serviceName: 'hrms-server' });
const __ALLOW_SCHEMA_CHANGES__ = isSchemaChangeAllowed();
registerGrowthRoutes(app, pool);
registerGrowthWinbackRoutes(app, pool);
registerGrowthPaymentRulesRoutes(app, pool);
registerGrowthStoredValueRoutes(app, pool);
registerGrowthActionsRoutes(app, pool);
registerSmsTemplateRoutes(app, pool);
registerSmsReconcileJob(pool);
registerSmsHealthMonitor(pool);
registerGrowthMetricsRoutes(app, pool);
registerGrowthProfilesRoutes(app, pool);
registerGrowthContentRoutes(app, pool);
registerGrowthWecomFeishuRoutes(app, pool);
registerGrowthQueriesRoutes(app, pool);
registerGrowthOpsRoutes(app, pool);
registerDiagnosisRoutes(app, pool, authRequired, callLLM);
registerOntologyRoutes(app, pool, authRequired);
// 跨租户聚合(重算基准库/复核数据冲突)只给super_admin，不是销售模块日常操作。
registerBenchmarkRoutes(app, pool, authRequired, [platformAdminRequired, requireSuperAdmin]);
registerDataTrustRoutes(app, pool, authRequired, [platformAdminRequired, requireSuperAdmin]);
// 各类平台/运营告警的飞书收件人，统一从环境变量读取，未配置时回退到共用的默认账号。
// 销售公司独立租户建好、拿到专属飞书 open_id 后，只需设置 FEISHU_ALERT_ADMIN_SALES，
// 无需再改代码。
const FEISHU_ALERT_ADMIN_DEFAULT = 'ou_6ba8c330d8b2e1e9fa0b70c615b524d9';
const FEISHU_ALERT_ADMIN_GROWTH = process.env.FEISHU_ALERT_ADMIN_GROWTH || FEISHU_ALERT_ADMIN_DEFAULT;
const FEISHU_ALERT_ADMIN_HEALTH = process.env.FEISHU_ALERT_ADMIN_HEALTH || FEISHU_ALERT_ADMIN_DEFAULT;
const FEISHU_ALERT_ADMIN_SALES = process.env.FEISHU_ALERT_ADMIN_SALES || FEISHU_ALERT_ADMIN_DEFAULT;
setSendGrowthAlert(async (msg) => {
  return sendLarkMessage(FEISHU_ALERT_ADMIN_GROWTH, String(msg || ''), { skipDedup: true }).catch((e) => { console.error('[feishu-alert-growth] send failed:', e?.message || e); return { ok: false }; });
});
registerGrowthSolutionRoutes(app, authRequired);
setSolutionNotifier(async (msg) => {
  return sendLarkMessage(FEISHU_ALERT_ADMIN_GROWTH, String(msg || ''), { skipDedup: true }).catch((e) => { console.error('[feishu-alert-growth] send failed:', e?.message || e); return { ok: false }; });
});
setSolutionLLM(async (prompt) => {
  const r = await callLLM([{ role: 'user', content: prompt }], { purpose: 'reasoning' });
  return r?.ok ? r.content : '';
});
setTrainingAssigner(createTrainingAssignment);
registerPhaseRoutes(app, pool, { getFeishuBitableData });
registerCustomerOpsRoutes(app, pool, authRequired, upload, uploadsDir, recordUploadOwnership, callLLM);
registerMarketingAttributionRoutes(app, pool, authRequired);
registerTenantOperationInspectionRoutes(app, pool, authRequired, platformAdminRequired);
registerLightSaasRoutes(app, pool, platformAdminRequired);
setHealthIncidentNotifiers({
  sendLarkMessage,
  lookupFeishuUserByUsername,
  sendOpsAlert: async (msg, _opts = {}) => {
    // 健康中心 SLA/队列摘要属于平台运营信息，不按租户 users.role 群发。
    // sendAdminSystemAlert() 会跨租户扫描 admin/hq_manager/hr_manager，
    // 从而把销售/系统运营告警发给马己仙、洪潮的门店管理员。
    const r = await sendLarkMessage(FEISHU_ALERT_ADMIN_HEALTH, String(msg || ''), { skipDedup: true }).catch((e) => { console.error('[feishu-alert-health] send failed:', e?.message || e); return { ok: false }; });
    return { ok: !!r?.ok, feishuSent: r?.ok ? 1 : 0, feishuFailed: r?.ok ? 0 : 1, recipients: [FEISHU_ALERT_ADMIN_HEALTH] };
  },
});
registerSalesAiRoutes(app, pool, platformAdminRequired, {
  callLLM,
  // 销售AI的告警(新线索/日报/停滞提醒)是GAAS销售团队自己的内部运营信息，跟马己仙/洪潮
  // 这两个租户的门店经营毫无关系。之前误用 sendAdminSystemAlert()——那个函数按角色
  // (admin/hq_manager/hr_manager)查 users 表且不区分租户，查到的正是马己仙/洪潮实际在用的
  // 那几个管理员账号，导致门店管理者一直在收到"新增销售线索"这类跟他们无关的通知。
  // 改成跟 GROWTH_REPORT_ADMIN 同样的写法(见上方 setSendGrowthAlert)——直接发给平台/销售
  // 团队自己的飞书账号，不查任何tenant的users表。收件人由 FEISHU_ALERT_ADMIN_SALES 配置，
  // 销售公司新租户建好后改这一个环境变量即可切换收件人，无需再动代码。
  sendOpsAlert: async (msg, _opts = {}) => {
    const r = await sendLarkMessage(FEISHU_ALERT_ADMIN_SALES, String(msg || ''), { skipDedup: true }).catch((e) => { console.error('[feishu-alert-sales] send failed:', e?.message || e); return { ok: false }; });
    return { ok: !!r?.ok, feishuSent: r?.ok ? 1 : 0, feishuFailed: r?.ok ? 0 : 1, recipients: [FEISHU_ALERT_ADMIN_SALES] };
  },
  requireSalesManagerOrAbove,
  upload,
});
registerTenantSubscriptionRoutes(app, { pool, authRequired });
registerAiQualityLearningRoutes(app, {
  pool,
  authRequired,
  platformAdminRequired,
  requireSuperAdmin,
});
// tenant-platform-routes.js 里全部是租户开通/许可证/系统配置这类"总控"操作，只该给
// super_admin用——这里传一个组合中间件(先校验登录，再校验角色)，覆盖该文件里所有
// 使用 platformAdminRequired 的路由，不用逐条去改25+个路由定义。
registerTenantPlatformRoutes(app, {
  pool,
  platformAdminRequired: [platformAdminRequired, requireSuperAdmin],
  platformAdminSessionRequired: platformAdminRequired,
  loginRateLimit,
  upload,
  recordUploadOwnership,
  PLATFORM_ADMIN_SECRET,
  PLATFORM_ADMIN_JWT_SECRET,
  TENANT_INTEGRATION_ENCRYPTION_KEY,
  REQUIRED_TENANT_FEISHU_TABLE_KEYS,
  invalidateTenantLlmConfigCache,
});
registerKnowledgeRoutes(app, {
  pool,
  authRequired,
  authRequiredOrQueryToken,
  getKnowledgeViewerProfile,
  buildKnowledgeBrandScopeTag,
  callLLM,
  resolveTenantIdDefault,
  knowledgeUpload,
  uploadsDir,
  recordUploadOwnership,
  notifyAdminsOcrFailed,
  inferContentType,
  buildInlineContentDisposition,
  getCosClient,
  getOssClient,
  buildCosPublicUrl,
  buildOssPublicUrl,
  COS_BUCKET,
  COS_REGION,
  OSS_PART_SIZE_MB,
  OSS_PARALLEL,
  OSS_RETRY_COUNT,
  OSS_TIMEOUT_MS,
});
registerCheckinRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  mergeSharedStateFields,
  safeDateOnly,
  loadActiveDutyRowsForUser,
  pickMyStoreFromState,
  stateFindUserRecord,
  dbFindEmployeeRecord,
  calcEmployeeMonthlyLeaveBalance,
  computeAttendanceMissingClockPenalties,
  hrmsAttendanceWindowMinutesForStore,
  hrmsDateKeyInShanghai,
  hrmsClockMinutesInShanghai,
  dailyReportRestDaysForEmployee,
  leaveBalanceOverrideKey,
  shiftMonth,
  hrmsNowISO,
  pickHrManagerUsername,
  appendNotifications,
  upsertEmployeeAttendanceMirrorFromCheckinRow,
  notifyAdminsDualWriteFailure,
  haversineDistance,
  resolveCheckinRadiusMeters,
  randomUUID,
});
registerReportsRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  mergeSharedStateFields,
  safeDateOnly,
  safeMonthOnly,
  parseMonth,
  pickMyStoreFromState,
  stateFindUserRecord,
  stateOrDbFindUserRecord,
  dbListEmployeesForReports,
  calcEmployeeMonthlyLeaveBalance,
  computeAttendanceMissingClockPenalties,
  buildAttendanceFromCheckinRecords,
  buildAttendanceFromReports,
  buildAttendanceSummaryRows,
  summarizeDailyRegisterForEmployee,
  filterDailyRegisterRowsByEmployee,
  expandAgentStoreLabels,
  resolveAgentCanonicalStore,
  isLegacyTestUsername,
  canAccessBusinessReports,
  canAccessAnalyticsReports,
  canAccessDailyAttendanceRegister,
  isAdmin,
  isHq,
  inDateRange,
  clampNum,
  safeNumber,
  findUserSalary,
  hrmsNowISO,
  randomUUID,
  sendWeeklyReports,
  sendMonthlyReports,
  sendTestReportsToUser,
  buildPayrollForMonth,
});
registerDailyReportsRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  mergeSharedStateFields,
  safeDateOnly,
  stateFindUserRecord,
  expandAgentStoreLabels,
  inDateRange,
  hrmsNowISO,
  notifyAdminsDualWriteFailure,
  safeErrMessage,
  isAdmin,
  addStateNotification,
  makeNotif,
});
registerPointsRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  saveSharedState,
  mergeSharedStateFields,
  pickMyStoreFromState,
  safeDateOnly,
  safeMonthOnly,
  safeNumber,
  hrmsNowISO,
  randomUUID,
});
registerHrmsPermissionRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  saveSharedState,
  isAdmin,
});
registerHrmsPayrollClosedLoopRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  mergeSharedStateFields,
  calcEmployeeMonthlyLeaveBalance,
  findUserSalary,
  isAdmin,
  isHq,
  canAccessAnalyticsReports,
  appendNotifications,
  makeNotif,
  hrmsNowISO,
  safeMonthOnly,
  parseMonth,
  dbListEmployeesForReports,
  stateFindUserRecord,
  isLegacyTestUsername,
});
registerInventoryForecastRoutes(app, {
  pool,
  authRequired,
  upload,
  uploadsDir,
  getSharedState,
  saveSharedState,
  pickMyStoreFromState,
  isForecastStoreScopedRole,
  safeDateOnly,
  normalizeForecastBizType,
  normalizeForecastSlot,
  loadInventoryForecastHistoryFromSalesRaw,
  shiftForecastDate,
  upsertInventoryForecastHistoryInState,
  parseInventoryForecastRowsFromTableMatrix,
  inferForecastUploadDateFromFilename,
  parseInventoryForecastRowsFromPdfPath,
  parseInventoryForecastRowsFromPdfBuffer,
  normalizeForecastStoreName,
  normalizeForecastStoreKey,
  normalizeDishAliasBizType,
  canManageGrossProfitProfiles,
  resolveTenantIdDefault,
  canAccessAnalyticsReports,
  resolveForecastScope,
  normalizeBrandId,
  resolveStoreBrandContext,
  normalizeProductName,
  buildForecastProductAliasLookup,
  resolveForecastProductName,
  computeAvgPricePerProduct,
  normalizeGrossProfitProfileItem,
  mergePreferredForecastHistoryRows,
  getStoreNamesByBrand,
  forecastBrandToken,
  normalizeStoreKey,
  isExcludedForecastProduct,
  estimateRevenueByHistory,
  resolvePosStoreKeys,
  isCNYPeriod,
  isKnownPublicHoliday,
  estimateGrossMarginByHistory,
  summarizeForecastAccuracyRows,
  normalizeForecastWeather,
  canonicalizeForecastRows,
  computeSlotRevenueShare,
  buildForecastCalibrationFactors,
  buildForecastByHeuristic,
  buildForecastByAI,
  applyForecastCalibration,
  constrainPredictionsToHistory,
  calcForecastAccuracyMetrics,
  safeNumber,
  inDateRange,
  hrmsNowISO,
});

registerAgentTaskBoardRoutes(app, {
  authRequired,
  axios,
  getAgentsServiceAdminToken,
  getAgentsServiceBaseUrl,
});

// 托管控制台（内部 Agent Ops 使用，不对租户开放）：复用同一套业务逻辑，
// 仅换成平台管理员鉴权 + URL 中的 :tenantId 决定操作对象。
registerCustomerOpsRoutes(app, pool, platformAdminRequired, upload, uploadsDir, recordUploadOwnership, callLLM, {
  basePath: '/api/admin/tenants/:tenantId/customer-ops',
  getTenantId: (req) => req.params.tenantId || 'default',
});
app.use(strategyExperimentRoutes(pool, authRequired));

app.post('/api/growth/upload', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
    await recordUploadOwnership(req.file.filename, req.tenantId, req.user?.username);
    const url = `/uploads/${req.file.filename}`;
    return res.json({ ok: true, url, filename: req.file.filename, size: req.file.size });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || 'upload_failed' });
  }
});

async function ensureEmployeeAttachmentsTable() {
  try {
    await pool.query(`
      create table if not exists employee_attachments (
        id serial primary key,
        employee_id text not null,
        filename text not null,
        original_name text not null,
        url text not null,
        description text default '',
        uploaded_by text not null,
        created_at timestamptz default now()
      )
    `);
    await pool.query(`create index if not exists idx_emp_att_emp_id on employee_attachments(employee_id)`);
  } catch (e) { /* ignore */ }
}
if (__ALLOW_SCHEMA_CHANGES__) ensureEmployeeAttachmentsTable();

app.get('/api/employees/:empId/attachments', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  const allowed = ['admin', 'store_manager', 'hr_manager', 'hq_manager'];
  if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
  try {
    const empId = String(req.params.empId || '').trim();
    if (!empId) return res.status(400).json({ error: 'missing_emp_id' });
    const r = await pool.query('select * from employee_attachments where employee_id=$1 order by created_at desc', [empId]);
    return res.json(r.rows);
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.post('/api/employees/:empId/attachments', authRequired, upload.single('file'), async (req, res) => {
  const role = String(req.user?.role || '').trim();
  const allowed = ['admin', 'store_manager', 'hr_manager'];
  if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
  try {
    const empId = String(req.params.empId || '').trim();
    if (!empId) return res.status(400).json({ error: 'missing_emp_id' });
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'missing_file' });
    if (file.size > 20 * 1024 * 1024) return res.status(400).json({ error: 'file_too_large' });
    await recordUploadOwnership(file.filename, req.tenantId, req.user?.username);
    const url = `/uploads/${file.filename}`;
    const originalName = String(file.originalname || file.filename);
    const description = String(req.body?.description || '').slice(0, 200);
    const uploadedBy = String(req.user?.username || '');
    const r = await pool.query(
      'insert into employee_attachments(employee_id,filename,original_name,url,description,uploaded_by,tenant_id) values($1,$2,$3,$4,$5,$6,$7) returning *',
      [empId, file.filename, originalName, url, description, uploadedBy, resolveTenantIdDefault()]
    );
    return res.json(r.rows[0]);
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.delete('/api/employees/:empId/attachments/:attachId', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  const allowed = ['admin', 'store_manager', 'hr_manager'];
  if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
  try {
    const empId = String(req.params.empId || '').trim();
    const attachId = String(req.params.attachId || '').trim();
    if (!empId || !attachId) return res.status(400).json({ error: 'missing_params' });
    const r = await pool.query('delete from employee_attachments where id=$1 and employee_id=$2 returning filename', [attachId, empId]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    try {
      const filename = r.rows[0]?.filename;
      if (filename) {
        const filepath = path.join(uploadsDir, filename);
        fs.unlink(filepath, () => {});
      }
    } catch (e2) { /* ignore */ }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

async function hasColumn(tableName, columnName) {
  const t = String(tableName || '').trim();
  const c = String(columnName || '').trim();
  if (!t || !c) return false;
  const r = await pool.query(
    `select 1
     from information_schema.columns
     where table_schema = 'public'
       and table_name = $1
       and column_name = $2
     limit 1`,
    [t, c]
  );
  return (r.rows || []).length > 0;
}

async function ensureHrmsStateTable() {
  try {
    await pool.query(
      `create table if not exists hrms_state (
        key text primary key,
        data jsonb not null,
        updated_at timestamp default current_timestamp
      )`
    );
  } catch (e) {
    console.error('ensureHrmsStateTable failed:', e);
  }
}

async function ensureApprovalTables() {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists approval_requests (
        id uuid primary key default gen_random_uuid(),
        type varchar(50) not null,
        status varchar(20) not null,
        applicant_username varchar(100) not null,
        current_assignee_username varchar(100),
        chain jsonb not null default '[]'::jsonb,
        payload jsonb not null default '{}'::jsonb,
        effective_date date,
        executed_at timestamp,
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp
      )`
    );
    await pool.query(`create index if not exists idx_approval_requests_assignee_status on approval_requests (current_assignee_username, status)`);
    await pool.query(`create index if not exists idx_approval_requests_applicant_status on approval_requests (applicant_username, status)`);
    await pool.query(`create index if not exists idx_approval_requests_type_effective_date on approval_requests (type, effective_date)`);
    await pool.query(`create table if not exists recurring_reward_templates (
      id uuid primary key default gen_random_uuid(),
      active boolean not null default true,
      created_by varchar(100) not null,
      frequency varchar(20) not null default 'monthly',
      payload jsonb not null default '{}'::jsonb,
      last_generated_ym varchar(7),
      created_at timestamptz default current_timestamp,
      updated_at timestamptz default current_timestamp
    )`);
    await pool.query(
      `create index if not exists idx_recurring_reward_templates_active on recurring_reward_templates (active, frequency)`
    );
  } catch (e) {
    console.error('ensureApprovalTables failed:', e);
  }
}

async function ensureUserSessionsTable() {
  if (!DATABASE_URL) return;
  let client;
  try {
    client = await pool.connect();
    await client.query('SET default_transaction_read_only = OFF');
    await client.query(
      `create table if not exists user_sessions (
        username varchar(100) primary key,
        session_nonce varchar(64) not null,
        tenant_id varchar(80) not null default 'default',
        updated_at timestamp default current_timestamp
      )`
    );
    await client.query(`alter table user_sessions add column if not exists tenant_id varchar(80) not null default 'default'`);
    await client.query(`create unique index if not exists user_sessions_username_tenant_idx on user_sessions (username, tenant_id)`);
  } catch (e) {
    console.error('ensureUserSessionsTable failed:', e);
  } finally {
    try {
      if (client) client.release();
    } catch (_e) {
      /* ignore */
    }
  }
}

async function ensureTenantRuntimeTables() {
  if (!DATABASE_URL) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT UNIQUE NOT NULL,
        name TEXT,
        mode TEXT DEFAULT 'managed',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        status TEXT DEFAULT 'trial',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_config (
        id BIGSERIAL PRIMARY KEY,
        tenant_key TEXT NOT NULL,
        config_key TEXT NOT NULL,
        config_value JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (tenant_key, config_key)
      )`);
    await pool.query(`
      INSERT INTO tenants (tenant_id, name, mode, status)
      VALUES ('default', '本地默认租户', 'managed', 'active')
      ON CONFLICT (tenant_id) DO UPDATE SET status='active', updated_at=NOW()`);
  } catch (e) {
    console.error('ensureTenantRuntimeTables failed:', e?.message || e);
  }
}

async function ensureUserReadsTable() {
  try {
    await pool.query(
      `create table if not exists user_reads (
        username varchar(100) not null,
        module varchar(50) not null,
        item_key varchar(160) not null,
        read_at timestamp default current_timestamp,
        primary key (username, module, item_key)
      )`
    );
    await pool.query(`create index if not exists idx_user_reads_username_module on user_reads (username, module)`);
  } catch (e) {
    console.error('ensureUserReadsTable failed:', e);
  }
}

async function ensureLoginLogTable() {
  try {
    await pool.query(`
      create table if not exists user_login_log (
        id serial primary key,
        username varchar(100) not null,
        login_at timestamptz not null default now(),
        logout_at timestamptz,
        session_nonce varchar(64),
        ip_address varchar(45),
        user_agent text,
        created_at timestamptz not null default now()
      )
    `);
    await pool.query(`create index if not exists idx_ull_username_date on user_login_log (username, CAST((login_at at time zone 'Asia/Shanghai') AS date))`);
    await pool.query(`create index if not exists idx_ull_login_at on user_login_log (login_at)`);
    await pool.query(`create index if not exists idx_ull_open_session on user_login_log (username, logout_at) where logout_at is null`);
  } catch (e) {
    console.error('ensureLoginLogTable failed:', e);
  }
}

async function recordLogin(username, sessionNonce, req, tenantId = 'default') {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return;
  const ip = String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || req.ip || '').split(',')[0].trim().slice(0, 45);
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 500);
  const tid = String(tenantId || 'default').trim() || 'default';
  // 登录这一刻还没有JWT/ALS上下文(还没发token)，靠调用方传入刚查到的用户租户身份，
  // 自己用tenantContext.run()包裹，不依赖外部上下文。
  await tenantContext.run(tid, async () => {
    let client;
    try {
      client = await pool.connect();
      await client.query('SET default_transaction_read_only = OFF');
      await client.query(
        `update user_login_log set logout_at = now() where lower(username) = $1 and logout_at is null`,
        [key]
      );
      await client.query(
        `insert into user_login_log (username, login_at, session_nonce, ip_address, user_agent, tenant_id) values ($1, now(), $2, $3, $4, $5)`,
        [key, sessionNonce, ip, ua, tid]
      );
    } catch (e) {
      console.error('recordLogin failed:', e?.message || e);
    } finally {
      try { if (client) client.release(); } catch (_e) { /* ignore */ }
    }
  });
}

async function recordLogout(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return;
  let client;
  try {
    client = await pool.connect();
    await client.query('SET default_transaction_read_only = OFF');
    await client.query(
      `update user_login_log set logout_at = now() where username = $1 and logout_at is null`,
      [key]
    );
  } catch (e) {
    console.error('recordLogout failed:', e?.message || e);
  } finally {
    try { if (client) client.release(); } catch (_e) { /* ignore */ }
  }
}

async function ensureCheckinTable() {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists checkin_records (
        id uuid primary key default gen_random_uuid(),
        username varchar(100) not null,
        store varchar(200),
        type varchar(20) not null default 'clock_in',
        check_time timestamp not null default current_timestamp,
        latitude double precision,
        longitude double precision,
        distance_meters double precision,
        face_match boolean default false,
        face_score double precision,
        photo_url text,
        status varchar(20) not null default 'normal',
        note text,
        confirmed_by varchar(100),
        confirmed_at timestamp,
        created_at timestamp default current_timestamp
      )`
    );
    await pool.query(`create index if not exists idx_checkin_username_time on checkin_records (username, check_time)`);
    await pool.query(`create index if not exists idx_checkin_store_time on checkin_records (store, check_time)`);
    await pool.query(`create index if not exists idx_checkin_time on checkin_records (check_time)`);
  } catch (e) {
    console.error('ensureCheckinTable failed:', e);
  }
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 考勤打卡允许半径（米）：默认 100（原代码误写死 50 导致与后台配置不一致） */
const CHECKIN_RADIUS_DEFAULT_METERS = 100;
const CHECKIN_RADIUS_MIN = 10;
const CHECKIN_RADIUS_MAX = 2000;

function parseCheckinRadiusMeters(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const x = Math.round(Number(raw));
  if (!Number.isFinite(x) || x < CHECKIN_RADIUS_MIN) return null;
  return Math.min(CHECKIN_RADIUS_MAX, x);
}

/**
 * 优先级：环境变量 CHECKIN_MAX_DISTANCE_METERS > state.checkinMaxDistanceMeters > 门店 checkinRadiusMeters（等别名）> 默认 100
 */
function resolveCheckinRadiusMeters(storeRow, state) {
  const fromEnv = parseCheckinRadiusMeters(process.env.CHECKIN_MAX_DISTANCE_METERS);
  if (fromEnv != null) return fromEnv;
  if (state && typeof state === 'object') {
    const g = parseCheckinRadiusMeters(state.checkinMaxDistanceMeters);
    if (g != null) return g;
  }
  if (storeRow && typeof storeRow === 'object') {
    const sr =
      storeRow.checkinRadiusMeters ??
      storeRow.checkin_radius_meters ??
      storeRow.geoFenceRadiusMeters ??
      storeRow.geo_fence_radius_meters;
    const sg = parseCheckinRadiusMeters(sr);
    if (sg != null) return sg;
  }
  return CHECKIN_RADIUS_DEFAULT_METERS;
}

const LEGACY_TEST_USERNAMES = new Set(['store_emp1', 'store_prod1', 'store_mgr1', 'hq_mgr1', 'emp1']);
const LEGACY_TEST_EMPLOYEE_IDS = new Set(['EMP001', 'EMP004']);

function isLegacyTestUsername(input) {
  const u = String(input || '').trim().toLowerCase();
  return !!u && LEGACY_TEST_USERNAMES.has(u);
}

function cleanupLegacyTestState(state0) {
  const state = state0 && typeof state0 === 'object' ? { ...state0 } : {};
  let changed = false;

  const users = Array.isArray(state.users) ? state.users : [];
  const nextUsers = users.filter(u => !isLegacyTestUsername(u?.username));
  if (nextUsers.length !== users.length) {
    state.users = nextUsers;
    changed = true;
  }

  const employees = Array.isArray(state.employees) ? state.employees : [];
  const nextEmployees = employees.filter(e => {
    if (isLegacyTestUsername(e?.username)) return false;
    const id = String(e?.id || '').trim().toUpperCase();
    return !LEGACY_TEST_EMPLOYEE_IDS.has(id);
  });
  if (nextEmployees.length !== employees.length) {
    state.employees = nextEmployees;
    changed = true;
  }

  const pointRecords = Array.isArray(state.pointRecords) ? state.pointRecords : [];
  const nextPointRecords = pointRecords.filter(r => !isLegacyTestUsername(r?.username));
  if (nextPointRecords.length !== pointRecords.length) {
    state.pointRecords = nextPointRecords;
    changed = true;
  }

  const salaryAdjustments = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [];
  const nextSalaryAdjustments = salaryAdjustments.filter(r => !isLegacyTestUsername(r?.targetUsername) && !isLegacyTestUsername(r?.applicantUsername));
  if (nextSalaryAdjustments.length !== salaryAdjustments.length) {
    state.salaryAdjustments = nextSalaryAdjustments;
    changed = true;
  }

  const payrollAdjustments = state.payrollAdjustments && typeof state.payrollAdjustments === 'object' ? state.payrollAdjustments : {};
  const nextPayrollAdjustments = {};
  Object.entries(payrollAdjustments).forEach(([k, v]) => {
    const key = String(k || '').trim();
    const m = key.match(/^\d{4}-\d{2}\|\|.+\|\|(.+)$/);
    const keyUser = m ? String(m[1] || '').trim() : '';
    const valueUser = String(v?.username || '').trim();
    if (isLegacyTestUsername(keyUser) || isLegacyTestUsername(valueUser)) {
      changed = true;
      return;
    }
    nextPayrollAdjustments[key] = v;
  });
  state.payrollAdjustments = nextPayrollAdjustments;

  return { state, changed };
}

// tenantContext/resolveTenantIdDefault现在是utils/database.js里的共享实例(见该文件注释)，
// 这样agents.js/performance-jobs.js等同一进程内的其它文件也能读到authRequired设置的租户上下文。

async function getSharedState(tenantId) {
  const key = resolveTenantIdDefault(tenantId);
  const r = await pool.query('select data from hrms_state where key = $1 limit 1', [key]);
  const row = r.rows?.[0] || null;
  return row?.data && typeof row.data === 'object' ? row.data : null;
}

async function saveSharedState(nextData, tenantId) {
  if (!nextData || typeof nextData !== 'object' || !Object.keys(nextData).length) return;
  const key = resolveTenantIdDefault(tenantId);

  // 使用显式事务 + FOR UPDATE + 乐观锁，避免调用方传入陈旧 state 覆盖并发修改
  // （与 mergeSharedStateFields 一致的事务保护模式）
  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query('SELECT data, updated_at FROM hrms_state WHERE key = $1 FOR UPDATE', [key]);
      const current = (r.rows?.[0]?.data && typeof r.rows[0].data === 'object') ? r.rows[0].data : {};
      const prevUpdatedAt = r.rows?.[0]?.updated_at;

      // Merge: caller 的字段覆盖 current，但 nextData 未涉及的字段（如 dailyReports）保留 current 值
      // 避免调用方传入的陈旧 state 覆盖其他模块的并发写入
      const merged = { ...current, ...nextData };

      const result = await client.query(
        `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1 AND updated_at = $3`,
        [key, JSON.stringify(merged), prevUpdatedAt]
      );
      if (result.rowCount > 0) {
        await client.query('COMMIT');
        client.release();
        schedulePayrollDomainSync();
        scheduleLeaveDomainSync();
        await dualWriteStateToDB(merged);
        return;
      }
      // 乐观锁冲突：回滚后重试
      await client.query('ROLLBACK');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw e;
    }
  }
  throw new Error('saveSharedState: max retries exceeded');
}

/**
 * 仅原子合并 hrms_state 中的特定顶层字段，避免 Read-Modify-Write 竞态覆盖其他字段。
 * 对于 array 类型字段（如 pointRecords、dailyReports），每个元素按 idField 去重合并。
 * 对于 object 类型字段（如 payrollAdjustments、pointsAppliedApprovals），做 JSON merge。
 * 对于非 array/object 字段，直接替换值。
 *
 * @param {Object} patches  key→value 映射；value 可以是数组（追加/更新）、对象（merge）或原始值（覆盖）
 * @param {Object} [arrayIdFields]  对 array 字段指定去重 key，如 { pointRecords: 'id', dailyReports: ['store','date'] }
 */
// tenantId 默认 'default'，与现有调用方(未传参)行为完全一致，零风险。
async function mergeSharedStateFields(patches, arrayIdFields = {}, tenantId) {
  if (!patches || typeof patches !== 'object' || !Object.keys(patches).length) return;
  const key = resolveTenantIdDefault(tenantId);

  // 原子合并 hrms_state：使用显式事务 + FOR UPDATE + 乐观锁（updated_at）
  // 避免 auto-commit 模式下 FOR UPDATE 锁在 SELECT 后即释放导致的丢失更新竞态
  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query('SELECT data, updated_at FROM hrms_state WHERE key = $1 FOR UPDATE', [key]);
      const row = r.rows?.[0];
      const current = (row?.data && typeof row.data === 'object') ? row.data : {};
      const prevUpdatedAt = row?.updated_at;

      const next = { ...current };
      for (const [field, patchValue] of Object.entries(patches)) {
        if (Array.isArray(patchValue)) {
          const idSpec = arrayIdFields[field];
          const existing = Array.isArray(current[field]) ? current[field].slice() : [];
          if (idSpec) {
            // Merge: update existing items by id, prepend new ones
            const getKey = Array.isArray(idSpec)
              ? (item) => idSpec.map(k => String(item?.[k] || '')).join('|')
              : (item) => String(item?.[idSpec] || '');
            const existingMap = new Map(existing.map(e => [getKey(e), e]));
            for (const item of patchValue) {
              existingMap.set(getKey(item), item);
            }
            // Preserve original order, new items at front
            const patchKeys = new Set(patchValue.map(getKey));
            const retained = existing.filter(e => !patchKeys.has(getKey(e)));
            next[field] = [...patchValue, ...retained];
          } else {
            // No id spec: prepend patch items
            next[field] = [...patchValue, ...existing];
          }
        } else if (patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue)) {
          next[field] = { ...(current[field] && typeof current[field] === 'object' ? current[field] : {}), ...patchValue };
        } else {
          next[field] = patchValue;
        }
      }

      // 乐观锁：仅当 updated_at 未被其他事务修改时写入
      const updateResult = await client.query(
        `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1 AND updated_at = $3`,
        [key, JSON.stringify(next), prevUpdatedAt]
      );
      if (updateResult.rowCount > 0) {
        await client.query('COMMIT');
        // (after commit the client is auto-released back to pool)
        if (Array.isArray(patches.employees) && patches.employees.length && arrayIdFields.employees === 'username') {
          const mergedEmps = Array.isArray(next.employees) ? next.employees : [];
          for (const item of patches.employees) {
            const u = String(item?.username || '').trim();
            if (!u) continue;
            const rec = mergedEmps.find(e => String(e?.username || '').trim().toLowerCase() === u.toLowerCase());
            if (rec) {
              try {
                await applyHrmsUserAccountGateFromEmployee(rec);
              } catch (e) {
                console.error('[mergeSharedStateFields][account-gate]', u, e?.message || e);
              }
              // A1：表权威 — merge state 后同步 employees 表（修复原只写 state 的缺口）
              try {
                await upsertEmployeeFromStateShape(pool, key, rec);
              } catch (e) {
                console.error('[mergeSharedStateFields][employees-table]', u, e?.message || e);
                void notifyAdminsDualWriteFailure('employees（mergeSharedStateFields）', e);
              }
            }
          }
        }
        schedulePayrollDomainSync();
        scheduleLeaveDomainSync();
        client.release();
        return;
      }
      // 乐观锁冲突：其他事务已修改，回滚后重试
      await client.query('ROLLBACK');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw e;
    }
  }
  throw new Error('mergeSharedStateFields: max retries exceeded');
}

/** 从 hrms_state 镜像中移除员工（及 users 同账号），供 DELETE /api/employees 使用 */
async function removeEmployeesFromSharedState(usernames, tenantId) {
  const want = new Set(
    (Array.isArray(usernames) ? usernames : [usernames])
      .map((u) => String(u || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (!want.size) return;
  const key = resolveTenantIdDefault(tenantId);
  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query('SELECT data, updated_at FROM hrms_state WHERE key = $1 FOR UPDATE', [key]);
      const row = r.rows?.[0];
      const current = row?.data && typeof row.data === 'object' ? row.data : {};
      const prevUpdatedAt = row?.updated_at;
      const next = { ...current };
      next.employees = (Array.isArray(current.employees) ? current.employees : []).filter(
        (e) => !want.has(String(e?.username || '').trim().toLowerCase())
      );
      next.users = (Array.isArray(current.users) ? current.users : []).filter(
        (u) => !want.has(String(u?.username || '').trim().toLowerCase())
      );
      const updateResult = await client.query(
        `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1 AND updated_at = $3`,
        [key, JSON.stringify(next), prevUpdatedAt]
      );
      if (updateResult.rowCount > 0) {
        await client.query('COMMIT');
        client.release();
        return;
      }
      await client.query('ROLLBACK');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw e;
    }
  }
  throw new Error('removeEmployeesFromSharedState: max retries exceeded');
}

/**
 * 将当前 hrms_state 整包写入 hrms_state_snapshots（定时任务用），并按保留策略裁剪旧行。
 * 失败由调用方 catch 后走 notifyAdminsDualWriteFailure。
 */
async function captureHrmsStateSnapshotToDb(opts = {}) {
  if (String(process.env.HRMS_STATE_SNAPSHOT_DISABLED || '').toLowerCase() === 'true') {
    return { ok: true, skipped: true, reason: 'disabled' };
  }
  const source = String(opts.source || 'scheduled').slice(0, 64);
  const key = String(opts.stateKey || 'default').trim() || 'default';
  const r = await pool.query('SELECT data FROM hrms_state WHERE key = $1 LIMIT 1', [key]);
  const row = r.rows?.[0];
  if (!row) return { ok: true, skipped: true, reason: 'no_row' };
  let payload = row.data;
  if (payload == null) payload = {};
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  const jsonStr = JSON.stringify(payload);
  const byteSize = Buffer.byteLength(jsonStr, 'utf8');
  await pool.query(
    `INSERT INTO hrms_state_snapshots (state_key, data, byte_size, source)
     VALUES ($1, $2::jsonb, $3, $4)`,
    [key, jsonStr, byteSize, source]
  );
  const retainDays = Math.max(1, Math.min(365, Number(process.env.HRMS_STATE_SNAPSHOT_RETAIN_DAYS || 30)));
  await pool.query(
    `DELETE FROM hrms_state_snapshots WHERE state_key = $1 AND created_at < NOW() - ($2::int * INTERVAL '1 day')`,
    [key, retainDays]
  );
  const retainRows = Math.max(10, Math.min(5000, Number(process.env.HRMS_STATE_SNAPSHOT_MAX_ROWS || 400)));
  await pool.query(
    `DELETE FROM hrms_state_snapshots s
     USING (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY state_key ORDER BY created_at DESC) AS rn
         FROM hrms_state_snapshots
         WHERE state_key = $1
       ) x WHERE x.rn > $2
     ) d
     WHERE s.id = d.id`,
    [key, retainRows]
  );
  return { ok: true, byteSize };
}

/**
 * 双写失败告警（系统底线）：任何 hrms_state ↔ PostgreSQL 不同步风险必须调用本函数。
 * - 先入运维日志（console.error，便于采集/巡检），再尽最大努力发飞书。
 * - 飞书接收人：feishu_users 中 admin / hq_manager（及常见中文管理员别名），避免仅有英文 admin 导致漏告。
 *
 * 已接入范围见仓库内对此函数的引用（遗漏新增双写时请同步调用）。
 */
async function notifyAdminsDualWriteFailure(scopeLabel, err) {
  const reason = String(err?.message || err || 'unknown').slice(0, 500);
  const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  console.error('[dual-write][CRITICAL]', scopeLabel, '|', reason, '|', timeStr, 'Asia/Shanghai');

  try {
    const r = await pool.query(
      `SELECT DISTINCT open_id
       FROM feishu_users
       WHERE registered = true
         AND open_id IS NOT NULL
         AND open_id NOT LIKE '%probe%'
         AND (
           TRIM(LOWER(role)) IN ('admin', 'hq_manager')
           OR TRIM(role) IN ('管理员', '系统管理员', '总部经理', '总部营运')
         )
       LIMIT 35`
    );
    const rows = r.rows || [];
    if (!rows.length) {
      console.error(
        '[dual-write][CRITICAL] 双写失败但无可投递飞书账号（请检查 feishu_users.registered / role / open_id）。范围:',
        scopeLabel
      );
      return;
    }
    const msg =
      `【HRMS 双写失败告警】\n范围：${scopeLabel}\n原因：${reason}\n时间：${timeStr}（上海）\n` +
      `说明：营业日报若 PG 失败，接口会返回 **502（pg_sync_failed）** 且 **不会** 写入 hrms_state，避免「前端已提交、库表无行」。\n` +
      `请检查 DATABASE_URL、表约束、字段类型；可用 POST /api/admin/sync-submitted-daily-reports-pg 从 state 补写 daily_reports。\n` +
      `请核对 hrms_state 与独立表一致性。`;
    const sends = (rows || []).map((row) =>
      sendLarkMessage(row.open_id, msg, { skipDedup: true }).catch((e) => ({ err: e?.message || e }))
    );
    const settled = await Promise.all(sends);
    const failed = settled.filter((x) => x && x.err);
    if (failed.length) {
      console.error('[dual-write][CRITICAL] 部分飞书告警发送失败:', failed.length, failed[0]?.err);
    }
  } catch (e) {
    console.error('[dual-write][CRITICAL] notifyAdminsDualWriteFailure 自身异常:', scopeLabel, e?.message);
  }
}

/**
 * 知识库文件 OCR/解析失败时飞书告警管理员
 * @param {string} itemTitle   文件标题
 * @param {string} fileType    类型描述（如图片、PDF、PDF 扫描件）
 * @param {string} reason      失败原因
 */
async function notifyAdminsOcrFailed(itemTitle, fileType, reason) {
  try {
    const r = await pool.query(
      `SELECT open_id FROM feishu_users
       WHERE registered = true AND open_id IS NOT NULL
         AND role = 'admin'
         AND open_id NOT LIKE '%probe%'
       LIMIT 20`
    );
    const rows = r.rows || [];
    if (!rows.length) {
      console.warn('[knowledge-ocr] no admin open_id for Feishu alert');
      return;
    }
    const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
    const msg =
`【知识库文件解析失败告警】
文件：${itemTitle}
类型：${fileType || '未知'}
原因：${String(reason || '未知错误').slice(0, 500)}
时间：${timeStr}（上海）
说明：该文件自动解析失败，如需使用请在知识库中重新上传或手动填写内容。请检查视觉模型配置或服务器依赖（poppler-utils）是否正常安装。`;
    const sends = rows.map(row =>
      sendLarkMessage(row.open_id, msg, { skipDedup: true }).catch(e => ({ err: e?.message || e }))
    );
    const settled = await Promise.all(sends);
    const failed = settled.filter(x => x && x.err);
    if (failed.length) {
      console.error('[knowledge-ocr] some Feishu admin alerts failed:', failed.length, failed[0]?.err);
    }
  } catch (e) {
    console.error('[knowledge-ocr] notify admins failed:', e?.message);
  }
}

/** 全量双写：每次保存 state 时自动同步所有模块到独立 DB 表 */
async function dualWriteStateToDB(state) {
  if (!state || typeof state !== 'object') return;
  try {
    // 1. employees → employees 表（A1：走 domain service）
    const empArr = Array.isArray(state.employees) ? state.employees : [];
    if (empArr.length) {
      await upsertEmployeesFromStateShape(pool, resolveTenantIdDefault(), empArr);
    }

    // 2. leaveRecords → hrms_leave_records 表
    const lrArr = Array.isArray(state.leaveRecords) ? state.leaveRecords : [];
    for (const lr of lrArr) {
      const rid = String(lr?.id || '').trim();
      if (!rid) continue;
      const startDate = String(lr?.startDate || '').trim();
      const endDate = String(lr?.endDate || '').trim();
      if (!startDate || !endDate) continue;
      await pool.query(
        `INSERT INTO hrms_leave_records (id, username, name, store, brand, start_date, end_date, days, type, reason, status, submitted_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           username=EXCLUDED.username, name=EXCLUDED.name, store=EXCLUDED.store,
           start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, days=EXCLUDED.days,
           type=EXCLUDED.type, reason=EXCLUDED.reason, status=EXCLUDED.status, updated_at=NOW()`,
        [rid, String(lr?.applicant || '').trim(), String(lr?.applicantName || lr?.name || '').trim(),
         String(lr?.store || '').trim(), String(lr?.brand || '').trim(),
         startDate, endDate, lr?.days != null && lr?.days !== '' ? Number(lr.days) : 0,
         String(lr?.type || 'leave').trim(), String(lr?.reason || '').trim(),
         String(lr?.status || 'pending').trim(), String(lr?.createdAt || '').trim() || hrmsNowISO(),
         String(lr?.createdAt || '').trim() || hrmsNowISO()]
      );
    }

    // 3. salaryAdjustments → hrms_reward_punishment_records 表
    const saArr = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [];
    for (const sa of saArr) {
      const rid = String(sa?.id || '').trim();
      if (!rid) continue;
      const rpType = String(sa?.type || '').trim();
      const isReward = rpType === '奖励' || rpType === 'reward';
      await pool.query(
        `INSERT INTO hrms_reward_punishment_records (id, username, name, store, brand, type, category, amount, reason, source, approval_id, status, created_by, created_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approval',$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           username=EXCLUDED.username, name=EXCLUDED.name, type=EXCLUDED.type,
           amount=EXCLUDED.amount, reason=EXCLUDED.reason, status=EXCLUDED.status, updated_at=NOW()`,
        [rid, String(sa?.targetUsername || '').trim(), String(sa?.targetName || '').trim(),
         '', '', isReward ? 'reward' : 'punishment', rpType,
         Math.abs(Number(sa?.amount) || 0), String(sa?.reason || '').trim(),
         toNullableUuid(sa?.approvalId), String(sa?.status || 'active').trim(),
         String(sa?.applicantUsername || '').trim(),
         String(sa?.createdAt || '').trim() || hrmsNowISO(),
         resolveTenantIdDefault()]
      );
    }

    // 4. notifications → hrms_user_notifications 表（绩效扣分、工作态度、排班通知等全部通知）
    const notifArr = Array.isArray(state.notifications) ? state.notifications : [];
    for (const n of notifArr) {
      // makeNotif 使用 targetUser 字段，兼容旧的 targetUsername/to
      const target = String(n?.targetUser || n?.targetUsername || n?.to || '').trim();
      if (!target) continue;
      const nType = String(n?.type || 'system_notice').trim();
      await pool.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [target, String(n?.title || '').trim(), String(n?.message || '').trim(),
         nType, JSON.stringify(n?.meta || n?.data || {}),
         n?.createdAt ? new Date(n.createdAt).toISOString() : hrmsNowISO(),
         resolveTenantIdDefault()]
      );
    }
  } catch (e) {
    // 双写失败告警：虽然不影响 hrms_state 保存，但会导致 DB 表与 state 不一致
    // 重启时会自动从 DB 表重建 state，所以双写失败可能导致数据丢失
    console.error('[dualWriteStateToDB] ⚠️ 双写失败！DB 表与 hrms_state 可能不一致，重启后可能丢失数据:', e?.message);
    console.error('[dualWriteStateToDB] 失败堆栈:', e?.stack || 'no stack');
    void notifyAdminsDualWriteFailure(
      '全量双写（employees / hrms_leave_records / hrms_reward_punishment_records / hrms_user_notifications）',
      e
    );
  }
}

/** 薪资域 JSON 是否视为「空」（用于 state ↔ hrms_payroll_domain 互备回灌） */
function payrollDomainFieldEmpty(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function leaveDomainFieldEmpty(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/** 将当前 state 中的薪资相关字段写入独立表 hrms_payroll_domain（双写备份） */
// id曾经硬编码为'default'常量、tenant_id列全靠DEFAULT带过——在只有一个租户时无害，
// 但id是单独的PRIMARY KEY(不是id+tenant_id复合键)，多租户下所有租户会共享同一行、
// 互相覆盖数据；RLS开启的环境(如demo)还会因为写入行的tenant_id(默认'default')与
// 当前会话的租户上下文不一致而被policy拒绝(new row violates row-level security policy)。
// 改为用当前租户id同时作为id和tenant_id，天然解决两个问题。
async function upsertPayrollDomainFromState(state) {
  if (!state || typeof state !== 'object') return;
  const tid = resolveTenantIdDefault();
  const pa = state.payrollAdjustments && typeof state.payrollAdjustments === 'object' ? state.payrollAdjustments : {};
  const pau = state.payrollAudits && typeof state.payrollAudits === 'object' ? state.payrollAudits : {};
  const sa = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [];
  const mc = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];
  await pool.query(
    `INSERT INTO hrms_payroll_domain (id, tenant_id, payroll_adjustments, payroll_audits, salary_adjustments, monthly_confirmations, updated_at)
     VALUES ($1::text, $1::varchar(80), $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       payroll_adjustments = EXCLUDED.payroll_adjustments,
       payroll_audits = EXCLUDED.payroll_audits,
       salary_adjustments = EXCLUDED.salary_adjustments,
       monthly_confirmations = EXCLUDED.monthly_confirmations,
       updated_at = NOW()`,
    [tid, JSON.stringify(pa), JSON.stringify(pau), JSON.stringify(sa), JSON.stringify(mc)]
  );
}

async function ensureLeaveDomainTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hrms_leave_domain (
      id TEXT PRIMARY KEY,
      leave_balance_overrides JSONB DEFAULT '{}'::jsonb,
      leave_balance_adjustments JSONB DEFAULT '[]'::jsonb,
      leave_cumulative_close_snapshots JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// 同上：id曾经硬编码为'default'、tenant_id全靠列DEFAULT带过，多租户下会互相覆盖数据，
// RLS开启环境下还会触发policy拒绝。改为用当前租户id同时作为id和tenant_id。
async function upsertLeaveDomainFromState(state) {
  if (!state || typeof state !== 'object') return;
  const tid = resolveTenantIdDefault();
  const overrides =
    state.leaveBalanceOverrides && typeof state.leaveBalanceOverrides === 'object'
      ? state.leaveBalanceOverrides
      : {};
  const adjustments = Array.isArray(state.leaveBalanceAdjustments) ? state.leaveBalanceAdjustments : [];
  const snapshots =
    state.leaveCumulativeCloseSnapshots && typeof state.leaveCumulativeCloseSnapshots === 'object'
      ? state.leaveCumulativeCloseSnapshots
      : {};
  await pool.query(
    `INSERT INTO hrms_leave_domain (
       id, tenant_id, leave_balance_overrides, leave_balance_adjustments, leave_cumulative_close_snapshots, updated_at
     )
     VALUES ($1::text, $1::varchar(80), $2::jsonb, $3::jsonb, $4::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       leave_balance_overrides = EXCLUDED.leave_balance_overrides,
       leave_balance_adjustments = EXCLUDED.leave_balance_adjustments,
       leave_cumulative_close_snapshots = EXCLUDED.leave_cumulative_close_snapshots,
       updated_at = NOW()`,
    [tid, JSON.stringify(overrides), JSON.stringify(adjustments), JSON.stringify(snapshots)]
  );
}

function schedulePayrollDomainSync() {
  setImmediate(async () => {
    try {
      const s = await getSharedState();
      await upsertPayrollDomainFromState(s);
    } catch (e) {
      console.error('[hrms_payroll_domain] async sync failed (non-fatal):', e?.message);
      void notifyAdminsDualWriteFailure('hrms_payroll_domain（异步薪资域双写）', e);
    }
  });
}

function scheduleLeaveDomainSync() {
  setImmediate(async () => {
    try {
      const s = await getSharedState();
      await upsertLeaveDomainFromState(s);
    } catch (e) {
      console.error('[hrms_leave_domain] async sync failed (non-fatal):', e?.message);
      void notifyAdminsDualWriteFailure('hrms_leave_domain（异步欠休域双写）', e);
    }
  });
}

/** 打卡记录写入 employee_attendance_records（与 checkin_records 同 id） */
async function upsertEmployeeAttendanceMirrorFromCheckinRow(rec, tenantId) {
  if (!rec?.id) return;
  await pool.query(
    `INSERT INTO employee_attendance_records (
       id, username, store, type, check_time, latitude, longitude, distance_meters,
       face_match, face_score, photo_url, status, note, confirmed_by, confirmed_at, created_at, synced_at, tenant_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16::timestamptz, NOW()), NOW(), $17
     )
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       store = EXCLUDED.store,
       type = EXCLUDED.type,
       check_time = EXCLUDED.check_time,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       distance_meters = EXCLUDED.distance_meters,
       face_match = EXCLUDED.face_match,
       face_score = EXCLUDED.face_score,
       photo_url = EXCLUDED.photo_url,
       status = EXCLUDED.status,
       note = EXCLUDED.note,
       confirmed_by = EXCLUDED.confirmed_by,
       confirmed_at = EXCLUDED.confirmed_at,
       synced_at = NOW()`,
    [
      rec.id,
      rec.username,
      rec.store,
      rec.type,
      rec.check_time,
      rec.latitude,
      rec.longitude,
      rec.distance_meters,
      rec.face_match,
      rec.face_score,
      rec.photo_url,
      rec.status,
      rec.note,
      rec.confirmed_by,
      rec.confirmed_at,
      rec.created_at,
      tenantId || 'default'
    ]
  );
}

function stateFindUserRecord(state, username) {
  const u = String(username || '').trim();
  if (!u) return null;
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  // employees first – real users live there
  const all = employees.concat(users);
  return all.find(x => String(x?.username || '').trim().toLowerCase() === u.toLowerCase()) || null;
}

async function dbFindEmployeeRecord(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  try {
    const r = await pool.query(
      `select username, name, role, store, department, position, status,
              join_date as "joinDate", created_at as "createdAt",
              coalesce(extra_json, '{}'::jsonb) as "extraJson"
         from employees
        where lower(username) = lower($1)
        limit 1`,
      [u]
    );
    const row = r.rows?.[0];
    if (!row) return null;
    const ex = row.extraJson && typeof row.extraJson === 'object' ? row.extraJson : {};
    const { ...rest } = row;
    const levelFromExtra = ex.level != null && ex.level !== '' ? String(ex.level).trim() : '';
    return { ...rest, level: levelFromExtra || String(rest.level || '').trim() };
  } catch (_) {
    return null;
  }
}

async function dbListEmployeesForReports({ store, includeInactive, tenantId }) {
  try {
    const params = [];
    const where = [];
    if (store) {
      const storeLabels = [
        ...new Set(expandAgentStoreLabels(store).map((s) => String(s).trim()).filter(Boolean))
      ];
      if (storeLabels.length) {
        params.push(storeLabels);
        where.push(`trim(store) = ANY($${params.length}::text[])`);
      }
    }
    if (!includeInactive) {
      where.push(`coalesce(status, '') not in ('inactive', '离职')`);
    }
    params.push(String(tenantId || 'default'));
    where.push(`tenant_id = $${params.length}`);
    const sql = `select username, name, role, store, department, position, status,
                        join_date as "joinDate", created_at as "createdAt",
                        extra_json->>'offboardingDate' as "offboardingDate",
                        extra_json->>'offboardingApproved' as "offboardingApproved",
                        extra_json->>'resignedAt' as "resignedAt",
                        coalesce(extra_json->>'coreTalent', 'false')::boolean as "coreTalent",
                        nullif(trim(coalesce(extra_json->>'level', extra_json->>'jobLevel', '')), '') as level
                   from employees
                   ${where.length ? ('where ' + where.join(' and ')) : ''}
                  order by name asc, username asc`;
    const r = await pool.query(sql, params);
    return Array.isArray(r.rows) ? r.rows : [];
  } catch (_) {
    return [];
  }
}

async function stateOrDbFindUserRecord(state, username) {
  return stateFindUserRecord(state, username) || await dbFindEmployeeRecord(username);
}

async function pickAdminUsername(state) {
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  // employees first – real users live there
  const all = employees.concat(users);
  const fromState = all.find(x => String(x?.role || '').trim() === 'admin')?.username;
  if (fromState) return String(fromState).trim();

  try {
    // 缺少 tenant_id 过滤会跨租户拿到别的租户的admin用户名，
    // 拿去当审批链assignee用会导致跨租户的人被塞进审批链。
    const r = await pool.query(
      "select username from users where role = 'admin' and is_active = true and tenant_id = $1 order by created_at asc limit 1",
      [resolveTenantIdDefault()]
    );
    const row = r.rows?.[0] || null;
    if (row?.username) return String(row.username).trim();
  } catch (e) { /* ignore */ }

  return 'admin';
}

async function pickHqManagerUsername(state) {
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  // employees first – real users live there; users may contain stale test accounts
  const all = employees.concat(users);
  const fromState = all.find(x => String(x?.role || '').trim() === 'hq_manager' && String(x?.status || '').trim() !== '离职' && String(x?.status || '').trim() !== 'inactive')?.username;
  if (fromState) return String(fromState).trim();

  try {
    // 同 pickAdminUsername：缺少 tenant_id 过滤会跨租户拿到别的租户的hq_manager。
    const r = await pool.query(
      "select username from users where role = 'hq_manager' and is_active = true and tenant_id = $1 order by created_at asc limit 1",
      [resolveTenantIdDefault()]
    );
    const row = r.rows?.[0] || null;
    if (row?.username) return String(row.username).trim();
  } catch (e) { /* ignore */ }

  return '';
}

async function pickHrManagerUsername(state) {
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  // employees first – real users live there
  const all = employees.concat(users);
  const hrRoles = ['hr_manager', 'custom_人事经理'];
  const fromState = all.find(x => hrRoles.includes(String(x?.role || '').trim()) && String(x?.status || '').trim() !== '离职' && String(x?.status || '').trim() !== 'inactive')?.username;
  if (fromState) return String(fromState).trim();
  return '';
}

async function pickCashierUsername(state) {
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  // employees first – real users live there
  const all = employees.concat(users);
  const cashierRoles = ['cashier', 'custom_出纳'];
  const fromState = all.find(x => cashierRoles.includes(String(x?.role || '').trim()) && String(x?.status || '').trim() !== '离职' && String(x?.status || '').trim() !== 'inactive')?.username;
  if (fromState) return String(fromState).trim();

  try {
    const r = await pool.query("select username from users where role = 'cashier' and is_active = true order by created_at asc limit 1");
    const row = r.rows?.[0] || null;
    if (row?.username) return String(row.username).trim();
  } catch (e) { /* ignore */ }

  return '';
}

function pickStoreRoleUsernameByStore(state, storeName, roleList) {
  const store = String(storeName || '').trim();
  const roles = Array.isArray(roleList) ? roleList.map(r => String(r || '').trim()) : [];
  if (!store || !roles.length) return '';
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  const all = employees.concat(users);
  const matches = all.filter(x => {
    const st = String(x?.store || '').trim();
    const rl = String(x?.role || '').trim();
    const status = String(x?.status || '').trim();
    return st === store && roles.includes(rl) && status !== '离职' && status !== 'inactive';
  });
  if (!matches.length) return '';
  if (roles.includes('store_production_manager')) {
    const byTitle = matches.find(x => /出品经理|厨师长/.test(String(x?.position || '')));
    if (byTitle?.username) return String(byTitle.username).trim();
    const lineCookPos = /(炒锅|砧板|打荷|刺身|烧味|卤水|汤档|煲仔)/;
    const nonLine = matches.find(x => !lineCookPos.test(String(x?.position || '')));
    if (nonLine?.username) return String(nonLine.username).trim();
  }
  const found = matches[0];
  return found?.username ? String(found.username).trim() : '';
}

function isKitchenByRoleOrPosition(roleRaw, positionRaw, departmentRaw) {
  const role = String(roleRaw || '').trim().toLowerCase();
  if (role === 'store_production_manager') return true;
  const txt = `${String(positionRaw || '')} ${String(departmentRaw || '')}`.toLowerCase();
  return /(后厨|厨房|后堂|后场|出品|厨师|厨工)/.test(txt);
}

function normalizePromotionTrainingPeriods(input) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  list.forEach((x, idx) => {
    if (!x || typeof x !== 'object') return;
    const startDate = safeDateOnly(x.startDate || x.date || '');
    const endDate = safeDateOnly(x.endDate || x.date || startDate || '');
    if (!startDate || !endDate) return;
    const title = String(x.title || `培训周期${idx + 1}`).trim() || `培训周期${idx + 1}`;
    const key = `${startDate}__${endDate}__${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: String(x.id || randomUUID()),
      title,
      startDate,
      endDate,
      note: String(x.note || '').trim()
    });
  });
  out.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  return out;
}

async function getPromotionTrackRecipients(state, track) {
  const applicantUsername = String(track?.applicantUsername || '').trim();
  const mentorUsername = String(track?.mentorUsername || '').trim();
  const store = String(track?.store || '').trim();
  const currentPosition = String(track?.currentPosition || '').trim();
  const department = String(track?.department || '').trim();
  const applicantRec = stateFindUserRecord(state, applicantUsername) || {};
  const applicantRole = String(track?.applicantRole || applicantRec?.role || '').trim();
  const kitchen = isKitchenByRoleOrPosition(applicantRole, currentPosition, department);
  const storeManager = pickStoreRoleUsernameByStore(state, store, ['store_manager']);
  const productionManager = kitchen ? pickStoreRoleUsernameByStore(state, store, ['store_production_manager']) : '';
  const hqManager = await pickHqManagerUsername(state);
  return uniqUsernames([
    applicantUsername,
    mentorUsername,
    storeManager,
    hqManager,
    productionManager
  ].filter(Boolean));
}

function normalizeApprovalType(input) {
  const t = String(input || '').trim().toLowerCase();
  const allowed = ['onboarding', 'offboarding', 'leave', 'payment', 'reward_punishment', 'promotion', 'points', 'monthly_confirm'];
  if (!allowed.includes(t)) return '';
  return t;
}

function getApprovalFlowStepsFromState(state, type, applicantStore) {
  const st = state && typeof state === 'object' ? state : {};
  const flows = st.approvalFlows && typeof st.approvalFlows === 'object' ? st.approvalFlows : {};
  const cfg = flows[String(type || '').trim().toLowerCase()];
  if (!cfg || typeof cfg !== 'object') return [];
  const cfgStores = Array.isArray(cfg.stores) ? cfg.stores.map(x => String(x || '').trim()).filter(Boolean) : [];
  if (cfgStores.length > 0 && applicantStore) {
    const aStore = String(applicantStore).trim().toLowerCase();
    const match = cfgStores.some(s => s.toLowerCase() === aStore);
    if (!match) return [];
  }
  const steps = cfg.steps;
  return Array.isArray(steps) ? steps.map(x => String(x || '').trim()).filter(Boolean) : [];
}

function resolveApprovalFlowToken(token, ctx) {
  const t0 = String(token || '').trim();
  if (!t0) return '';
  const t = t0.toLowerCase();

  if (t === 'manager') return String(ctx?.managerUsername || '').trim();
  if (t === 'hq_manager') return String(ctx?.hqManagerUsername || '').trim();
  if (t === 'hr_manager') return String(ctx?.hrManagerUsername || '').trim();
  if (t === 'admin') return String(ctx?.adminUsername || '').trim();
  if (t === 'cashier') return String(ctx?.cashierUsername || '').trim();

  if (t.startsWith('username:')) {
    return String(t0.slice('username:'.length) || '').trim();
  }

  // Handle role: prefix (e.g. "role:custom_人事经理")
  if (t.startsWith('role:')) {
    const roleId = t0.slice('role:'.length).trim();
    if (roleId && ctx?.state) {
      const found = findUserByRole(ctx.state, roleId);
      if (found) return found;
    }
    return '';
  }

  // Try to resolve any other token as a role id (e.g. "custom_人事经理")
  if (ctx?.state) {
    const found = findUserByRole(ctx.state, t0);
    if (found) return found;
  }
  return '';
}

function findUserByRole(state, roleId) {
  const rid = String(roleId || '').trim();
  if (!rid) return '';
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  // employees first – real users live there
  const all = employees.concat(users);
  const match = all.find(x => {
    const r = String(x?.role || '').trim();
    const st = String(x?.status || '').trim();
    return r.toLowerCase() === rid.toLowerCase() && String(x?.username || '').trim() && st !== '离职' && st !== 'inactive';
  });
  return match ? String(match.username).trim() : '';
}

function buildApprovalAssigneesFromConfig(state, type, ctx) {
  const applicantStore = String(ctx?.applicantStore || '').trim();
  const steps = getApprovalFlowStepsFromState(state, type, applicantStore);
  if (!steps.length) return [];
  const assignees = steps
    .map(s => resolveApprovalFlowToken(s, ctx))
    .map(x => String(x || '').trim())
    .filter(Boolean);

  // de-dupe while keeping order
  const seen = new Set();
  const uniq = [];
  for (const a of assignees) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(a);
  }
  return uniq;
}

function getPaymentFlowForStore(state, store) {
  const st = state && typeof state === 'object' ? state : {};
  const map = st.paymentFlowByStore && typeof st.paymentFlowByStore === 'object' ? st.paymentFlowByStore : {};
  const key = String(store || '').trim();
  const cfg = key ? map[key] : null;
  const approvers = Array.isArray(cfg?.approvers) ? cfg.approvers.map(x => String(x || '').trim()).filter(Boolean) : [];
  const cashier = String(cfg?.cashier || '').trim();
  return { approvers, cashier };
}

function approvalTypeLabel(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'onboarding') return '入职';
  if (t === 'offboarding') return '离职';
  if (t === 'leave') return '休假';
  if (t === 'payment') return '请款';
  if (t === 'reward_punishment') return '奖惩';
  if (t === 'points') return '积分';
  if (t === 'promotion') return '晋升';
  if (t === 'monthly_confirm') return '月度考勤确认';
  return t || '审批';
}

function safeNumber(input) {
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

function toNullableUuid(input) {
  const value = String(input || '').trim();
  return value ? value : null;
}

function addStateNotification(state, notif) {
  const s = state && typeof state === 'object' ? state : {};
  const list = Array.isArray(s.notifications) ? s.notifications.slice() : [];
  list.push(notif);
  return { ...s, notifications: list };
}

async function appendNotifications(notifs) {
  const list = Array.isArray(notifs) ? notifs.filter(Boolean) : [];
  if (!list.length) return;
  await mergeSharedStateFields({ notifications: list }, { notifications: 'id' });
}

function systemAlertTitle(msg) {
  const firstLine = String(msg || '').split(/\r?\n/).map(s => String(s || '').trim()).find(Boolean) || '';
  return firstLine.slice(0, 120) || 'HRMS 系统告警';
}

async function insertHrmsUserNotifications(notifs) {
  const list = Array.isArray(notifs) ? notifs.filter(Boolean) : [];
  if (!list.length) return;
  for (const n of list) {
    const target = String(n?.targetUser || n?.targetUsername || n?.to || '').trim();
    if (!target) continue;
    await pool.query(
      `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        target,
        String(n?.title || '').trim() || '通知',
        String(n?.message || '').trim(),
        String(n?.type || 'system_notice').trim(),
        JSON.stringify(n?.meta || n?.data || {}),
        n?.createdAt ? new Date(n.createdAt).toISOString() : hrmsNowISO(),
        resolveTenantIdDefault()
      ]
    );
  }
}

async function sendAdminSystemAlert(msg, options = {}) {
  const text = String(msg || '').trim();
  if (!text) return { recipients: [], feishuSent: 0, feishuFailed: 0 };

  const explicitUsernames = uniqUsernames(Array.isArray(options?.usernames) ? options.usernames : []);
  let recipients = explicitUsernames.slice();
  if (!recipients.length) {
    const admins = await pool.query(
      `SELECT username
       FROM users
       WHERE role IN ('admin','hq_manager','hr_manager')
         AND is_active = true
       LIMIT 8`
    );
    recipients = uniqUsernames((admins.rows || []).map(r => r.username));
  }
  if (!recipients.length) return { recipients: [], feishuSent: 0, feishuFailed: 0 };

  const title = String(options?.title || '').trim() || systemAlertTitle(text);
  const notificationType = String(options?.notificationType || 'system_alert').trim();
  const meta = options?.meta && typeof options.meta === 'object' ? options.meta : {};

  if (options?.persistToHrms !== false) {
    const notifs = recipients.map((username) => makeNotif(username, title, text, {
      type: notificationType,
      meta: {
        source: 'admin_system_alert',
        ...meta
      }
    }));
    try {
      await appendNotifications(notifs);
      await insertHrmsUserNotifications(notifs);
    } catch (e) {
      console.error('[system-alert] persist company notification failed:', e?.message || e);
    }
  }

  let feishuSent = 0;
  let feishuFailed = 0;
  const sendTargets = [];
  const seenOpenId = new Set();
  for (const username of recipients) {
    try {
      let fu = await lookupFeishuUserByUsername(username);
      let openId = String(fu?.open_id || '').trim();
      if (!openId) {
        const r = await pool.query(
          `SELECT open_id FROM feishu_users WHERE lower(username)=lower($1) LIMIT 1`,
          [username]
        );
        openId = String(r.rows?.[0]?.open_id || '').trim();
      }
      if (!openId || seenOpenId.has(openId)) continue;
      seenOpenId.add(openId);
      sendTargets.push(openId);
    } catch (e) {
      // ignore single user mapping failure, below会走角色兜底
    }
  }
  // 仅在“群发管理员”场景启用 role 兜底；单人演练/定向告警必须严格按指定用户名发送
  if (!explicitUsernames.length) {
    try {
      const roleRows = await pool.query(
        `SELECT DISTINCT open_id
         FROM feishu_users
         WHERE registered = true
           AND role IN ('admin','hq_manager','hr_manager')
           AND TRIM(COALESCE(open_id, '')) <> ''
           AND open_id NOT LIKE '%probe%'`
      );
      for (const row of roleRows.rows || []) {
        const oid = String(row?.open_id || '').trim();
        if (!oid || seenOpenId.has(oid)) continue;
        seenOpenId.add(oid);
        sendTargets.push(oid);
      }
    } catch (e) {
      console.error('[system-alert] feishu role fallback query failed:', e?.message || e);
    }
  }

  for (const openId of sendTargets) {
    const result = await sendLarkMessage(openId, text, { skipDedup: true }).catch((e) => ({ ok: false, error: e?.message }));
    if (result?.ok) feishuSent += 1;
    else feishuFailed += 1;
  }

  if (sendTargets.length === 0) {
    feishuFailed = recipients.length || 1;
  }
  if (feishuSent === 0) {
    console.error('[system-alert] feishu send all failed:', { recipients, sendTargetsCount: sendTargets.length, feishuFailed });
  }

  return { recipients, feishuSent, feishuFailed };
}

function uniqUsernames(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach(u => {
    const v = String(u || '').trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });
  return out;
}

function hrmsNowISO() {
  // Force Asia/Shanghai wall-clock time regardless of server timezone.
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const pick = (t) => parts.find(p => p.type === t)?.value || '';
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  const h = pick('hour');
  const mi = pick('minute');
  const s = pick('second');
  return `${y}-${m}-${d}T${h}:${mi}:${s}+08:00`;
}

function makeNotif(targetUser, title, message, extra) {
  return {
    id: 'NOTIF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    type: String(extra?.type || 'notice'),
    targetUser: String(targetUser || '').trim(),
    title: String(title || '').trim() || '通知',
    message: String(message || '').trim(),
    createdAt: hrmsNowISO(),
    ...(extra && typeof extra === 'object' ? extra : {})
  };
}

let _lastRecurringRewardJobSlot = '';

function shanghaiCalendarForJobs(now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return { ymd, y, m, d, hour, minute };
}

async function insertRewardPunishmentApprovalFromTemplate(applicantUsername, payloadObj) {
  const username = String(applicantUsername || '').trim();
  if (!username) throw new Error('missing_applicant');
  let state = (await getSharedState()) || {};
  const applicant = stateFindUserRecord(state, username) || {};
  const applicantManager = String(applicant?.managerUsername || '').trim();
  const adminUsername = await pickAdminUsername(state);
  const hqManagerUsername = await pickHqManagerUsername(state);
  const cashierUsername = await pickCashierUsername(state);
  const hrManagerUsername = await pickHrManagerUsername(state);
  const applicantStore = String(applicant?.store || payloadObj?.store || '').trim();
  const ctx = {
    state,
    applicantUsername: username,
    applicantStore,
    managerUsername: applicantManager,
    adminUsername,
    hqManagerUsername,
    hrManagerUsername,
    cashierUsername
  };
  let assignees = await buildConfiguredApprovalAssignees(state, 'reward_punishment', ctx, resolveDutyApproverForStore);
  if (!assignees.length) {
    assignees = [applicantManager, hrManagerUsername].filter(Boolean);
  }
  const seen = new Set();
  const uniq = [];
  (assignees || []).forEach((a) => {
    const k = String(a || '').trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    uniq.push(String(a || '').trim());
  });
  if (!uniq.length) throw new Error('missing_assignee');
  const chain = uniq.map((a, idx) => ({
    step: idx + 1,
    assignee: a,
    status: idx === 0 ? 'pending' : 'queued',
    decidedAt: null,
    note: ''
  }));
  const currentAssignee = chain[0]?.assignee || null;
  const r = await pool.query(
    `insert into approval_requests (type, status, applicant_username, current_assignee_username, chain, payload, created_at, updated_at)
     values ($1,$2,$3,$4,$5::jsonb,$6::jsonb, now(), now())
     returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
    ['reward_punishment', 'pending', username, currentAssignee, JSON.stringify(chain), JSON.stringify(payloadObj)]
  );
  const item = r.rows?.[0] || null;
  return { item, uniq, currentAssignee, state, applicant };
}

async function runMonthlyRecurringRewardTemplatesJob() {
  const cal = shanghaiCalendarForJobs();
  // 与绩效/关账节奏对齐：每月 10 日（上海）早间生成当月待审批单
  if (cal.d !== 10 || cal.hour !== 7 || cal.minute >= 20) return;
  const slotKey = `${cal.ymd}_rrt`;
  if (_lastRecurringRewardJobSlot === slotKey) return;
  _lastRecurringRewardJobSlot = slotKey;

  const ym = `${cal.y}-${String(cal.m).padStart(2, '0')}`;
  // recurring_reward_templates开了FORCE RLS，这个cron不是per-tenant循环调用的，
  // 需要自己遍历active租户分别查，否则在没有任何租户上下文时只会读到0行。
  let rows = [];
  try {
    for (const tid of await getActiveTenantIds(pool)) {
      const r = await tenantContext.run(tid, () =>
        pool.query(`select * from recurring_reward_templates where active = true and frequency = 'monthly'`)
      );
      rows.push(...(r.rows || []));
    }
  } catch (e) {
    return;
  }

  for (const tpl of rows) {
    const tplTenantId = String(tpl.tenant_id || 'default').trim() || 'default';
    await tenantContext.run(tplTenantId, async () => {
    if (String(tpl.last_generated_ym || '') === ym) return;
    const applicantUsername = String(tpl.created_by || '').trim();
    if (!applicantUsername) return;
    const base = tpl.payload && typeof tpl.payload === 'object' ? tpl.payload : {};
    const genPayload = {
      ...base,
      recurringTemplateId: String(tpl.id),
      recurringGeneratedYm: ym,
      note:
        (String(base.note || '').trim() ? `${String(base.note).trim()}\n` : '') +
        `[系统自动·${ym}月度奖惩]`
    };
    try {
      const dup = await pool.query(
        `select id from approval_requests where type=$1 and status=$2
           and coalesce(payload->>'recurringTemplateId','')=$3
           and coalesce(payload->>'recurringGeneratedYm','')=$4 limit 1`,
        ['reward_punishment', 'pending', String(tpl.id), ym]
      );
      if (dup.rows?.length) {
        await pool.query(
          `update recurring_reward_templates set last_generated_ym=$1, updated_at=now() where id=$2`,
          [ym, tpl.id]
        );
        return;
      }
      const { item, currentAssignee, state, applicant } = await insertRewardPunishmentApprovalFromTemplate(
        applicantUsername,
        genPayload
      );
      if (item && currentAssignee) {
        try {
          let nextState = state;
          const applicantName = String(applicant?.name || applicantUsername).trim() || applicantUsername;
          const targetUser = String(genPayload?.targetUsername || '').trim();
          const targetRec = targetUser ? stateFindUserRecord(state, targetUser) || {} : {};
          const targetName = String(targetRec?.name || targetUser).trim() || applicantName;
          const rpType = String(genPayload?.rpType || '').trim();
          const title = '奖惩申请待审批';
          const msg = `${applicantName} 提交了${rpType || '奖惩'}申请（${targetName}），请审批。[月度自动]`;
          const recipients = [String(currentAssignee || '').trim()].filter(Boolean);
          for (const u of recipients) {
            nextState = addStateNotification(
              nextState,
              makeNotif(u, title, msg, { type: 'reward_punishment_request', approvalId: item.id })
            );
          }
          await saveSharedState(nextState);
          (async () => {
            try {
              const fu = await lookupFeishuUserByUsername(currentAssignee);
              if (fu?.open_id) {
                const feishuMsg = `📋 【HRMS 待审批提醒】\n\n${msg}\n\n请登录 HRMS 系统处理：https://nnyx.cc`;
                await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
              }
            } catch (feishuErr) {
              console.error('[recurring-reward] feishu notify error:', feishuErr?.message);
            }
          })();
        } catch (ne) {
          console.error('[recurring-reward] notify error:', ne?.message || ne);
        }
      }
      await pool.query(
        `update recurring_reward_templates set last_generated_ym=$1, updated_at=now() where id=$2`,
        [ym, tpl.id]
      );
    } catch (e) {
      console.error('[recurring-reward] template', tpl.id, e?.message || e);
    }
    });
  }
}

function upsertInventoryForecastHistoryInState(state0, { store, bizType, slot, rowsRaw, username }) {
  const history = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.slice() : [];
  const predictionList = Array.isArray(state0.inventoryForecastPredictions) ? state0.inventoryForecastPredictions.slice() : [];
  const evaluationList = Array.isArray(state0.inventoryForecastEvaluations) ? state0.inventoryForecastEvaluations.slice() : [];
  const keyOf = (x) => `${String(x?.store || '').trim()}||${String(x?.bizType || '').trim()}||${String(x?.slot || '').trim()}||${String(x?.date || '').trim()}`;
  const map = new Map();
  history.forEach((x) => map.set(keyOf(x), x));
  const predMap = new Map();
  predictionList.forEach((x) => predMap.set(keyOf(x), x));
  const evalMap = new Map();
  evaluationList.forEach((x) => evalMap.set(keyOf(x), x));

  const now = hrmsNowISO();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const touchedKeys = new Set();

  (Array.isArray(rowsRaw) ? rowsRaw : []).forEach((raw) => {
    const normalized = parseForecastHistoryRow(raw);
    if (!normalized) {
      skipped += 1;
      return;
    }
    const k = `${store}||${bizType}||${slot}||${normalized.date}`;
    const prev = map.get(k);
    const nextItem = {
      ...(prev || {}),
      id: prev?.id || randomUUID(),
      store,
      bizType,
      slot,
      date: normalized.date,
      weather: normalized.weather,
      isHoliday: normalized.isHoliday,
      expectedRevenue: normalized.expectedRevenue,
      actualRevenue: normalized.actualRevenue || 0,
      totalDiscount: normalized.totalDiscount || 0,
      productQuantities: normalized.productQuantities,
      createdAt: prev?.createdAt || now,
      createdBy: prev?.createdBy || username,
      updatedAt: now,
      updatedBy: username
    };
    if (prev) updated += 1;
    else inserted += 1;
    map.set(k, nextItem);
    touchedKeys.add(k);
  });

  let evaluated = 0;
  touchedKeys.forEach((k) => {
    const actualRow = map.get(k);
    const predRow = predMap.get(k);
    if (!actualRow || !predRow) return;
    const metrics = calcForecastAccuracyMetrics(predRow?.predictions, actualRow?.productQuantities);
    const prevEval = evalMap.get(k);
    evalMap.set(k, {
      ...(prevEval || {}),
      id: prevEval?.id || randomUUID(),
      predictionId: String(predRow?.id || '').trim(),
      store,
      bizType,
      slot,
      date: String(actualRow?.date || ''),
      totalPredQty: metrics.totalPredQty,
      totalActualQty: metrics.totalActualQty,
      totalAbsError: metrics.totalAbsError,
      totalAccuracy: metrics.totalAccuracy,
      mape: metrics.mape,
      hitRate20: metrics.hitRate20,
      productCount: metrics.productCount,
      perProduct: metrics.perProduct,
      topDiffProducts: metrics.topDiffProducts,
      evaluatedAt: now,
      updatedAt: now,
      updatedBy: username
    });
    evaluated += 1;
  });

  const nextHistory = Array.from(map.values()).sort((a, b) => {
    const aDate = String(a?.date || '');
    const bDate = String(b?.date || '');
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''));
  });
  const nextEvaluations = Array.from(evalMap.values())
    .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')) || String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
    .slice(0, 6000);

  return {
    state: { ...state0, inventoryForecastHistory: nextHistory, inventoryForecastEvaluations: nextEvaluations },
    inserted,
    updated,
    skipped,
    accepted: inserted + updated,
    evaluated
  };
}

function normalizePredictionItems(input) {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((x) => ({
      product: String(x?.product || '').trim(),
      qty: Number(Number(x?.qty || 0).toFixed(2)),
      reason: String(x?.reason || '').trim()
    }))
    .filter((x) => x.product && Number.isFinite(x.qty) && x.qty >= 0);
}

function forecastPredictionToProductMap(predictions) {
  const map = {};
  normalizePredictionItems(predictions).forEach((x) => {
    map[x.product] = Number((Number(map[x.product] || 0) + Number(x.qty || 0)).toFixed(2));
  });
  return map;
}

function calcForecastAccuracyMetrics(predictions, actualProducts) {
  const predMap = forecastPredictionToProductMap(predictions);
  const actualMap = normalizeForecastProducts(actualProducts);
  const names = Array.from(new Set([...Object.keys(predMap), ...Object.keys(actualMap)]));
  let totalPredQty = 0;
  let totalActualQty = 0;
  let totalAbsError = 0;
  const perProduct = names.map((name) => {
    const predQty = Number(predMap[name] || 0);
    const actualQty = Number(actualMap[name] || 0);
    const absError = Math.abs(predQty - actualQty);
    const ape = absError / Math.max(actualQty, 1);
    const accuracy = Math.max(0, Math.min(1, 1 - ape));
    totalPredQty += predQty;
    totalActualQty += actualQty;
    totalAbsError += absError;
    return {
      product: name,
      predQty: Number(predQty.toFixed(2)),
      actualQty: Number(actualQty.toFixed(2)),
      absError: Number(absError.toFixed(2)),
      ape: Number(ape.toFixed(4)),
      accuracy: Number(accuracy.toFixed(4))
    };
  });

  const count = perProduct.length;
  const mape = count ? Number((perProduct.reduce((s, x) => s + Number(x.ape || 0), 0) / count).toFixed(4)) : 1;
  const hitRate20 = count
    ? Number((perProduct.filter((x) => Number(x.ape || 0) <= 0.2).length / count).toFixed(4))
    : 0;
  const totalAccuracy = Number(Math.max(0, Math.min(1, 1 - (totalAbsError / Math.max(totalActualQty, 1)))).toFixed(4));
  const topDiffProducts = perProduct
    .slice()
    .sort((a, b) => Number(b.absError || 0) - Number(a.absError || 0))
    .slice(0, 10);
  return {
    totalPredQty: Number(totalPredQty.toFixed(2)),
    totalActualQty: Number(totalActualQty.toFixed(2)),
    totalAbsError: Number(totalAbsError.toFixed(2)),
    totalAccuracy,
    mape,
    hitRate20,
    productCount: count,
    perProduct,
    topDiffProducts
  };
}

function buildForecastCalibrationFactors(evaluations, asOfDate) {
  const list = Array.isArray(evaluations) ? evaluations : [];
  const productRatios = new Map();
  let sumPred = 0;
  let sumActual = 0;
  let sampleCount = 0;
  const cutoff = (() => {
    const d = String(asOfDate || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  })();

  list.forEach((ev) => {
    const d = String(ev?.date || '').trim();
    if (cutoff && d && d >= cutoff) return;
    const per = Array.isArray(ev?.perProduct) ? ev.perProduct : [];
    per.forEach((x) => {
      const predQty = Number(x?.predQty || 0);
      const actualQty = Number(x?.actualQty || 0);
      if (!(predQty > 0) || !(actualQty >= 0)) return;
      const ratio = Math.max(0.2, Math.min(3, actualQty / Math.max(predQty, 0.0001)));
      const name = String(x?.product || '').trim();
      if (!name) return;
      const prev = productRatios.get(name) || [];
      prev.push(ratio);
      productRatios.set(name, prev.slice(-20));
      sumPred += predQty;
      sumActual += actualQty;
      sampleCount += 1;
    });
  });

  const globalRaw = sumPred > 0 ? (sumActual / sumPred) : 1;
  const globalFactor = Number(Math.max(0.65, Math.min(1.35, globalRaw)).toFixed(4));
  const byProduct = {};
  productRatios.forEach((ratios, name) => {
    if (!Array.isArray(ratios) || ratios.length < 2) return;
    const avg = ratios.reduce((s, x) => s + Number(x || 0), 0) / Math.max(1, ratios.length);
    byProduct[name] = Number(Math.max(0.6, Math.min(1.45, avg)).toFixed(4));
  });

  return {
    globalFactor,
    byProduct,
    sampleCount,
    productSampleCount: Object.keys(byProduct).length
  };
}

function applyForecastCalibration(predictions, calibration) {
  const list = normalizePredictionItems(predictions);
  const cal = calibration && typeof calibration === 'object' ? calibration : {};
  const globalFactor = Number.isFinite(Number(cal.globalFactor)) ? Number(cal.globalFactor) : 1;
  const byProduct = cal.byProduct && typeof cal.byProduct === 'object' ? cal.byProduct : {};
  return list
    .map((x) => {
      const f = Number.isFinite(Number(byProduct[x.product])) ? Number(byProduct[x.product]) : globalFactor;
      return {
        ...x,
        qty: Number((Number(x.qty || 0) * Math.max(0.5, Math.min(1.8, f))).toFixed(2))
      };
    })
    .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));
}

function summarizeForecastAccuracyRows(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return {
      comparedCount: 0,
      avgAccuracy: 0,
      avgMape: 0,
      avgHitRate20: 0,
      totalPredQty: 0,
      totalActualQty: 0,
      totalAbsError: 0,
      moduleStats: []
    };
  }
  let sumAcc = 0;
  let sumMape = 0;
  let sumHit = 0;
  let totalPredQty = 0;
  let totalActualQty = 0;
  let totalAbsError = 0;
  const moduleMap = new Map();

  list.forEach((x) => {
    const acc = Number(x?.totalAccuracy || 0);
    const mape = Number(x?.mape || 0);
    const hit = Number(x?.hitRate20 || 0);
    sumAcc += acc;
    sumMape += mape;
    sumHit += hit;
    totalPredQty += Number(x?.totalPredQty || 0);
    totalActualQty += Number(x?.totalActualQty || 0);
    totalAbsError += Number(x?.totalAbsError || 0);
    const key = `${String(x?.bizType || '').trim()}||${String(x?.slot || '').trim()}`;
    const prev = moduleMap.get(key) || {
      bizType: String(x?.bizType || '').trim(),
      slot: String(x?.slot || '').trim(),
      comparedCount: 0,
      sumAcc: 0,
      sumMape: 0,
      sumHit: 0
    };
    prev.comparedCount += 1;
    prev.sumAcc += acc;
    prev.sumMape += mape;
    prev.sumHit += hit;
    moduleMap.set(key, prev);
  });

  const count = list.length;
  const moduleStats = Array.from(moduleMap.values())
    .map((m) => ({
      bizType: m.bizType,
      slot: m.slot,
      comparedCount: m.comparedCount,
      avgAccuracy: Number((m.sumAcc / Math.max(1, m.comparedCount)).toFixed(4)),
      avgMape: Number((m.sumMape / Math.max(1, m.comparedCount)).toFixed(4)),
      avgHitRate20: Number((m.sumHit / Math.max(1, m.comparedCount)).toFixed(4))
    }))
    .sort((a, b) => String(a.bizType).localeCompare(String(b.bizType)) || String(a.slot).localeCompare(String(b.slot)));

  return {
    comparedCount: count,
    avgAccuracy: Number((sumAcc / Math.max(1, count)).toFixed(4)),
    avgMape: Number((sumMape / Math.max(1, count)).toFixed(4)),
    avgHitRate20: Number((sumHit / Math.max(1, count)).toFixed(4)),
    totalPredQty: Number(totalPredQty.toFixed(2)),
    totalActualQty: Number(totalActualQty.toFixed(2)),
    totalAbsError: Number(totalAbsError.toFixed(2)),
    moduleStats
  };
}


function isAdmin(role) {
  return String(role || '').trim() === 'admin';
}

function isHq(role) {
  const r = String(role || '').trim();
  return r === 'hq_manager' || r === 'hr_manager';
}

function canAccessAnalyticsReports(role) {
  const r = String(role || '').trim();
  return r === 'admin' || r === 'hq_manager' || r === 'store_manager' || r === 'hr_manager' || r === 'store_production_manager';
}

/** 出勤表台账：仅管理员 / 总部营运 / 总部人事（与 JWT 中文/别名角色映射一致） */
function canAccessDailyAttendanceRegister(role) {
  const r = normalizeRoleForJwt(role);
  return r === 'admin' || r === 'hq_manager' || r === 'hr_manager';
}

function canAccessBusinessReports(role) {
  const r = String(role || '').trim();
  return r === 'admin' || r === 'hq_manager' || r === 'store_manager';
}

function isForecastStoreScopedRole(role) {
  const r = String(role || '').trim();
  return r === 'store_manager' || r === 'store_production_manager';
}

function inDateRange(date, start, end) {
  const d = String(date || '').trim();
  if (!d) return false;
  const s = start ? String(start).trim() : '';
  const e = end ? String(end).trim() : '';
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}


function parseMonth(input) {
  const v = String(input || '').trim();
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  return v;
}

function clampNum(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

function normalizeForecastBizType(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'takeaway' || v === 'delivery' || v === '外卖') return 'takeaway';
  if (v === 'dinein' || v === 'dine_in' || v === '堂食') return 'dinein';
  return '';
}

// 从品牌名/门店名推断品牌 token（洪潮/马己仙），用于按品牌过滤菜品库成本，避免跨品牌成本污染。
function forecastBrandToken(input) {
  const t = String(input || '');
  const dbBrand = getBrandForStoreSync(t, resolveTenantIdDefault())?.brandName;
  if (dbBrand) return dbBrand;
  if (t.includes('洪潮')) return '洪潮';
  if (t.includes('马己仙')) return '马己仙';
  return '';
}

// Store-level business slot configuration.
// hasAfternoon: false  → no afternoon tea slot; 14:00-16:59 becomes early dinner.
// dineinEarlyStart: hour at which dine-in can start (e.g. 16 for weekend 16:30 arrivals).
const STORE_SLOT_CONFIG = {
  '洪潮大宁久光店': { hasAfternoon: false, dineinEarlyStart: 16 },
  '洪潮久光店':     { hasAfternoon: false, dineinEarlyStart: 16 },
  '_default':       { hasAfternoon: true,  dineinEarlyStart: 17 }
};

function getStoreSlotConfig(store) {
  const s = String(store || '').trim();
  const tid = resolveTenantIdDefault();
  const brandKey = getBrandForStoreSync(s, tid)?.brandKey;
  const dbCfg = brandKey ? getBrandConfigSync(brandKey, tid)?.slotConfig : null;
  if (dbCfg) return dbCfg;
  if (STORE_SLOT_CONFIG[s]) return STORE_SLOT_CONFIG[s];
  const key = Object.keys(STORE_SLOT_CONFIG).find(k => k !== '_default' && (s.includes(k) || k.includes(s)));
  return (key ? STORE_SLOT_CONFIG[key] : null) || STORE_SLOT_CONFIG['_default'];
}

function normalizeForecastSlot(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'lunch' || v === 'noon' || v === '午市') return 'lunch';
  if (v === 'afternoon' || v === 'tea' || v === 'afternoon_tea' || v === '下午茶') return 'afternoon';
  if (v === 'dinner' || v === 'night' || v === '晚市') return 'dinner';
  return '';
}

// Returns the canonical slot for a given hour, respecting store-level slot config.
function resolveSlotForHour(startHour, storeSlotCfg) {
  const cfg = storeSlotCfg || STORE_SLOT_CONFIG['_default'];
  if (startHour >= 10 && startHour < 14) return 'lunch';
  if (!cfg.hasAfternoon) {
    // No afternoon tea: everything from lunch-end onward is dinner
    if (startHour >= 14 && startHour < 23) return 'dinner';
  } else {
    if (startHour >= 14 && startHour < 17) return 'afternoon';
    if (startHour >= 17 && startHour < 23) return 'dinner';
  }
  return '';
}

function normalizeForecastSlotFromHourRange(input, store) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const byWord = normalizeForecastSlot(raw);
  // If explicitly named as a slot, remap 'afternoon' → 'dinner' for stores without afternoon tea
  if (byWord) {
    if (byWord === 'afternoon' && store) {
      const cfg = getStoreSlotConfig(store);
      if (!cfg.hasAfternoon) return 'dinner';
    }
    return byWord;
  }
  const slotCfg = store ? getStoreSlotConfig(store) : null;
  // Match HH:MM or HH：MM patterns
  const m = raw.match(/(\d{1,2})\s*[:：]\s*\d{1,2}/);
  if (m) {
    const startHour = Number(m[1]);
    if (Number.isFinite(startHour)) {
      const s = resolveSlotForHour(startHour, slotCfg);
      if (s) return s;
    }
  }
  // Match decimal time from Excel (e.g. 0.708333 = 17:00)
  const dec = Number(raw);
  if (Number.isFinite(dec) && dec > 0 && dec < 1) {
    const hour = Math.floor(dec * 24);
    const s = resolveSlotForHour(hour, slotCfg);
    if (s) return s;
  }
  // Match AM/PM time (e.g. "5:00 PM", "5:00:00 PM")
  const ampm = raw.match(/(\d{1,2})\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{1,2})?\s*(AM|PM|am|pm|上午|下午)/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const isPM = /pm|下午/i.test(ampm[2]);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    const s = resolveSlotForHour(h, slotCfg);
    if (s) return s;
  }
  // Match plain hour number (e.g. "17" or "17:00")
  const plainHour = raw.match(/^(\d{1,2})$/);
  if (plainHour) {
    const s = resolveSlotForHour(Number(plainHour[1]), slotCfg);
    if (s) return s;
  }
  return '';
}

function normalizeForecastUploadDate(input) {
  const v = String(input || '').trim();
  if (!v) return '';
  const date = safeDateOnly(v);
  if (date) return date;
  // Chinese: X月Y日
  const cn = v.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (cn) {
    const y = new Date().getFullYear();
    const m = String(Math.max(1, Math.min(12, Number(cn[1] || 1)))).padStart(2, '0');
    const d = String(Math.max(1, Math.min(31, Number(cn[2] || 1)))).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // M/D/YY or M/D/YYYY (XLSX date output format)
  const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    let yr = Number(mdy[3]);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    const m = String(Math.max(1, Math.min(12, Number(mdy[1])))).padStart(2, '0');
    const d = String(Math.max(1, Math.min(31, Number(mdy[2])))).padStart(2, '0');
    return `${yr}-${m}-${d}`;
  }
  // D/M/YYYY or DD/MM/YYYY
  const dmy = v.match(/^(\d{1,2})[\.\-](\d{1,2})[\.\-](\d{4})$/);
  if (dmy) {
    const a = Number(dmy[1]), b = Number(dmy[2]), yr = Number(dmy[3]);
    if (a > 12 && b <= 12) {
      return `${yr}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
    }
    return `${yr}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
  }
  // YYYY/M/D
  const ymd = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;
  }
  return '';
}

function inferForecastUploadDateFromFilename(input, now = new Date()) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const basename = raw.replace(/\.[^.]+$/, '');

  // 1) Full date patterns in filename: YYYY-MM-DD / YYYY_MM_DD / YYYY.MM.DD
  const full = basename.match(/(20\d{2})[-_.\/年](\d{1,2})[-_.\/月](\d{1,2})/);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // 2) Range-like pattern: 2-16-22 => interpret as M-D1-D2, choose D2
  const mdRange = basename.match(/(^|\D)(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{1,2})(\D|$)/);
  if (mdRange) {
    const m = Number(mdRange[2]);
    const d1 = Number(mdRange[3]);
    const d2 = Number(mdRange[4]);
    if (m >= 1 && m <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      const y = now.getFullYear();
      const day = Math.max(d1, d2);
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 3) Single month-day pattern: 2-16 / 2_16 / 2.16
  const md = basename.match(/(^|\D)(\d{1,2})[-_.\/](\d{1,2})(\D|$)/);
  if (md) {
    const m = Number(md[2]);
    const d = Number(md[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = now.getFullYear();
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return '';
}

function parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType = '', options = {}) {
  const rows = Array.isArray(matrix) ? matrix : [];
  if (!rows.length) return [];
  const fallbackDate = normalizeForecastUploadDate(options?.fallbackDate || '');
  const allowTodayFallbackDate = options?.allowTodayFallbackDate !== false;
  const norm = (x) => String(x || '').trim();
  const normHead = (x) => norm(x).toLowerCase().replace(/\s+/g, '');
  const cleanHead = (x) => normHead(x).replace(/[\/:：()（）\[\]【】_\-~～]/g, '');
  const rowMetaValue = (line, keyReg) => {
    const arr = Array.isArray(line) ? line.map(norm) : [];
    for (let i = 0; i < arr.length; i += 1) {
      const cell = String(arr[i] || '');
      const compact = cell.replace(/\s+/g, '');
      if (!keyReg.test(cell) && !keyReg.test(compact)) continue;
      for (let j = i + 1; j < arr.length; j += 1) {
        if (arr[j]) return arr[j];
      }
    }
    return '';
  };

  let headerRowIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const line = Array.isArray(rows[i]) ? rows[i] : [];
    const heads = line.map((x) => cleanHead(x));
    const _joined = heads.join('|');
    const hasSlot = heads.some((h) => /餐时段名称|时段名称|餐时段|时段/.test(h));
    const hasProduct = heads.some((h) => /菜品名称|商品名称|产品名称|产品|菜品|品名/.test(h));
    const hasQty = heads.some((h) => /销售数量|数量|qty|quantity/.test(h));
    const hasAmount = heads.some((h) => /销售金额|销售额|销售收入|折前营收|折前营业额|折前收入|金额/.test(h));
    const hasSeqNo = heads.some((h) => /^序号$/.test(h));
    const hasDate = heads.some((h) => /营业日期|销售日期|日期/.test(h));
    const hasActualRevenue = heads.some((h) => /实际收入|实收|实际营收|菜品收入|家品收入|折后营收|折后收入/.test(h));
    const hasOrderTime = heads.some((h) => /下单时间|点单时间|订单时间/.test(h));
    const _hasCheckoutTime = heads.some((h) => /结账时间|结算时间/.test(h));
    const _hasDiscount = heads.some((h) => /优惠金额|优惠|折扣/.test(h));
    const _hasMenuPrice = heads.some((h) => /菜谱售价|售价|单价|菜品售价/.test(h));
    // Accept if we have slot+product+qty, or slot+product+amount, or seqNo+slot+product
    if ((hasSlot && hasProduct && hasQty) || (hasSlot && hasProduct && hasAmount) || (hasSeqNo && hasSlot && hasProduct)) {
      headerRowIndex = i;
      break;
    }
    // New format: 序号+营业日期+菜品名称+销售数量 (no slot column, derive from 下单时间/结账时间)
    if (hasSeqNo && hasDate && hasProduct && hasQty) {
      headerRowIndex = i;
      break;
    }
    // New format variant: 营业日期+菜品名称+销售数量+实际收入
    if (hasDate && hasProduct && hasQty && hasActualRevenue) {
      headerRowIndex = i;
      break;
    }
    // Fuzzy: if row has >=3 known header keywords, accept it
    const knownCount = [hasSlot, hasProduct, hasQty, hasAmount, hasSeqNo, hasDate, hasActualRevenue, hasOrderTime].filter(Boolean).length;
    if (knownCount >= 3) {
      headerRowIndex = i;
      break;
    }
  }
  const dataStartIndex = headerRowIndex >= 0 ? (headerRowIndex + 1) : 0;

  let defaultDate = fallbackDate || '';
  let defaultBizType = normalizeForecastBizType(fallbackBizType);
  let defaultStore = '';
  let defaultWeather = '';
  for (let i = 0; i < (headerRowIndex >= 0 ? headerRowIndex : Math.min(rows.length, 12)); i += 1) {
    const line = Array.isArray(rows[i]) ? rows[i] : [];
    if (!defaultDate) {
      const v = rowMetaValue(line, /营业日期|销售日期|日期/);
      if (v) defaultDate = normalizeForecastUploadDate(v);
    }
    if (!defaultBizType) {
      const v = rowMetaValue(line, /销售类型|类型/);
      if (v) defaultBizType = normalizeForecastBizType(v);
    }
    if (!defaultStore) {
      const v = rowMetaValue(line, /门店|店铺|商户|销售门店|门店名称/);
      if (v) defaultStore = normalizeForecastStoreName(v);
    }
    if (!defaultWeather) {
      const v = rowMetaValue(line, /天气|weather/i);
      if (v) defaultWeather = normalizeForecastWeather(v);
    }
  }
  if (!defaultDate && allowTodayFallbackDate) {
    defaultDate = normalizeForecastUploadDate(new Date().toISOString());
  }

  const headersRaw = headerRowIndex >= 0 && Array.isArray(rows[headerRowIndex]) ? rows[headerRowIndex] : [];
  const headers = headersRaw.map(cleanHead);
  const idx = (names) => {
    for (const n of names) {
      const i = headers.indexOf(cleanHead(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iDate = idx(['销售日期', '日期', 'date', '营业日期']);
  const iBizType = idx(['销售类型', '类型', 'biztype']);
  const iSlot = idx(['餐/时段名称', '时段名称', '餐时段', '时段']);
  const iProduct = idx(['菜品名称', '商品名称', '品名', '产品', 'product']);
  const iQty = idx(['销售数量', '数量', 'qty', 'quantity']);
  const iAmount = idx(['销售金额', '销售额', '销售收入', '折前营收', '折前营业额', '折前收入', 'amount']);
  const iStore = idx(['门店', '店铺', '商户', '销售门店', '门店名称', 'store']);
  const iWeather = idx(['天气', 'weather']);
  // New format columns
  const iActualRevenue = idx(['实际收入', '实收', '实际营收', '实收金额', '实收营业额', '实收金额元', '菜品收入', '家品收入', '折后营收', '折后收入']);
  const iDiscount = idx(['优惠金额', '优惠', '折扣']);
  const _iMenuPrice = idx(['菜谱售价', '售价', '单价', '菜品售价']);
  const iOrderTime = idx(['下单时间', '点单时间', '订单时间']);
  const iCheckoutTime = idx(['结账时间', '结算时间']);
  const _iDept = idx(['出品部门', '部门']);
  const _iCategory = idx(['大类名称/编码', '大类名称', '大类', '类别']);

  const grouped = new Map();
  const parseNumCell = (v) => {
    const s = String(v == null ? '' : v).replace(/[,，\s]/g, '').replace(/[¥￥]/g, '').trim();
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  const looksLikeTimeRange = (v) => {
    const s = String(v || '').trim();
    if (!s) return false;
    // Standard: 17:00~18:00 or 17：00～18：00
    if (/\d{1,2}\s*[:：]\s*\d{1,2}\s*[~～\-—–至到]\s*\d{1,2}\s*[:：]\s*\d{1,2}/.test(s)) return true;
    // AM/PM: 5:00 PM - 6:00 PM
    if (/\d{1,2}\s*[:：]\s*\d{1,2}.*(?:AM|PM|am|pm|上午|下午)/.test(s)) return true;
    // Decimal time from Excel: 0.4166666 to 0.9166666
    const dec = Number(s);
    if (Number.isFinite(dec) && dec > 0 && dec < 1) return true;
    // Single time: 17:00 or 17：00
    if (/^\d{1,2}\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{1,2})?$/.test(s)) return true;
    return false;
  };
  for (let r = dataStartIndex; r < rows.length; r += 1) {
    const line = Array.isArray(rows[r]) ? rows[r] : [];
    if (!line.length) continue;
    const product = norm(iProduct >= 0 ? line[iProduct] : '');
    const qty = parseNumCell(iQty >= 0 ? line[iQty] : 0);
    if (!product || isExcludedForecastProduct(product) || !Number.isFinite(qty) || qty <= 0) continue;

    const dateRaw = norm(iDate >= 0 ? line[iDate] : '');
    const date = normalizeForecastUploadDate(dateRaw) || defaultDate;
    if (!date) continue;

    const bizRaw = norm(iBizType >= 0 ? line[iBizType] : '');
    const bizType = normalizeForecastBizType(bizRaw) || defaultBizType || 'dinein';
    const store = normalizeForecastStoreName(iStore >= 0 ? line[iStore] : '') || defaultStore;

    // Derive slot: prefer explicit slot column, then 下单时间, then 结账时间
    let slotRaw = norm(iSlot >= 0 ? line[iSlot] : '');
    let slot = slotRaw ? normalizeForecastSlotFromHourRange(slotRaw, store) : '';
    if (!slot && iOrderTime >= 0) {
      slot = normalizeForecastSlotFromHourRange(norm(line[iOrderTime]), store);
    }
    if (!slot && iCheckoutTime >= 0) {
      slot = normalizeForecastSlotFromHourRange(norm(line[iCheckoutTime]), store);
    }
    // If still no slot and we have a datetime in the date column, try extracting time from it
    if (!slot && dateRaw && /\d{1,2}[:：]\d{1,2}/.test(dateRaw)) {
      slot = normalizeForecastSlotFromHourRange(dateRaw, store);
    }
    if (!slot) continue;
    const weather = normalizeForecastWeather(iWeather >= 0 ? line[iWeather] : '') || defaultWeather;

    // 约定：销售收入 = 折前营收（expectedRevenue）
    const amount = parseNumCell(iAmount >= 0 ? line[iAmount] : 0);
    const expectedRevenueInc = Number.isFinite(amount) && amount > 0 ? amount : 0;
    // 约定：菜品收入 = 折后营收（actualRevenue），用于实收毛利率计算
    const actualRevenueRaw = parseNumCell(iActualRevenue >= 0 ? line[iActualRevenue] : 0);
    const discountRaw = parseNumCell(iDiscount >= 0 ? line[iDiscount] : 0);
    const discountInc = Number.isFinite(discountRaw) ? Math.abs(discountRaw) : 0;
    const derivedActualRevenue = Math.max(0, expectedRevenueInc - discountInc);
    const actualRevenueInc = Number.isFinite(actualRevenueRaw) && actualRevenueRaw > 0
      ? actualRevenueRaw
      : derivedActualRevenue;

    const key = `${bizType}||${slot}||${date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        store,
        bizType,
        slot,
        date,
        weather: weather || '',
        isHoliday: false,
        expectedRevenue: 0,
        actualRevenue: 0,
        totalDiscount: 0,
        productQuantities: {}
      });
    }
    const row = grouped.get(key);
    if (!row.store && store) row.store = store;
    if (!row.weather && weather) row.weather = weather;
    row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + expectedRevenueInc).toFixed(2));
    row.actualRevenue = Number((Number(row.actualRevenue || 0) + actualRevenueInc).toFixed(2));
    row.totalDiscount = Number((Number(row.totalDiscount || 0) + discountInc).toFixed(2));
    row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
  }

  // Fallback: for complex/merged templates from Excel export, infer columns by row shape.
  if (!grouped.size) {
    for (let r = dataStartIndex; r < rows.length; r += 1) {
      const line = Array.isArray(rows[r]) ? rows[r].map(norm) : [];
      if (!line.length) continue;
      let slotIdx = -1;
      for (let i = 0; i < line.length; i += 1) {
        if (looksLikeTimeRange(line[i])) {
          slotIdx = i;
          break;
        }
      }
      if (slotIdx < 0) continue;
      const slot = normalizeForecastSlotFromHourRange(line[slotIdx], defaultStore);
      if (!slot) continue;

      const numericCells = [];
      for (let i = 0; i < line.length; i += 1) {
        const n = parseNumCell(line[i]);
        if (Number.isFinite(n)) numericCells.push({ i, n });
      }
      if (!numericCells.length) continue;

      const amountCell = numericCells[numericCells.length - 1];
      const qtyCell = numericCells
        .filter((x) => x.i < amountCell.i)
        .sort((a, b) => b.i - a.i)[0] || null;
      const qty = qtyCell ? qtyCell.n : NaN;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const amount = Number.isFinite(amountCell?.n) ? amountCell.n : 0;

      let product = '';
      for (let i = (qtyCell ? qtyCell.i : amountCell.i) - 1; i >= 0; i -= 1) {
        const cell = line[i];
        if (!cell) continue;
        if (looksLikeTimeRange(cell)) continue;
        if (Number.isFinite(parseNumCell(cell))) continue;
        if (cell === '-' || cell === '—' || cell === '–' || cell === '一') continue;
        if (/(^序号$|^菜品大类$|^菜品中类$|^餐时段名称$|^时段名称$|^销售数量$|^销售金额$)/.test(cell.replace(/\s+/g, ''))) continue;
        product = cell;
        break;
      }
      if (!product) continue;

      let date = '';
      for (let i = 0; i < line.length; i += 1) {
        date = normalizeForecastUploadDate(line[i]);
        if (date) break;
      }
      date = date || defaultDate;
      if (!date) continue;

      let bizType = '';
      for (let i = 0; i < line.length; i += 1) {
        bizType = normalizeForecastBizType(line[i]);
        if (bizType) break;
      }
      bizType = bizType || defaultBizType || 'dinein';

      let weather = '';
      for (let i = 0; i < line.length; i += 1) {
        const s = normalizeForecastWeather(line[i]);
        if (!s) continue;
        if (/(晴|阴|雨|雪|风|雾|多云|weather)/i.test(s)) {
          weather = s;
          break;
        }
      }
      weather = weather || defaultWeather;

      let store = '';
      for (let i = 0; i < line.length; i += 1) {
        const s = normalizeForecastStoreName(line[i]);
        if (!s) continue;
        if (/(门店|店铺|广场店|久光店|万象城|商场|mall|store)/i.test(s)) {
          store = s;
          break;
        }
      }
      store = store || defaultStore;

      const key = `${bizType}||${slot}||${date}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          store,
          bizType,
          slot,
          date,
          weather: weather || '',
          isHoliday: false,
          expectedRevenue: 0,
          productQuantities: {}
        });
      }
      const row = grouped.get(key);
      if (!row.store && store) row.store = store;
      if (!row.weather && weather) row.weather = weather;
      row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + (amount > 0 ? amount : 0)).toFixed(2));
      row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
    }
  }
  return Array.from(grouped.values()).filter((x) => x.bizType && x.slot && x.date && Object.keys(x.productQuantities || {}).length);
}

function normalizeForecastWeather(input) {
  return String(input || '').trim().slice(0, 40);
}

function normalizeForecastStoreName(input) {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function normalizeForecastStoreKey(input) {
  return normalizeForecastStoreName(input).replace(/\s+/g, '').toLowerCase();
}

function shiftForecastDate(dateStr, deltaDays) {
  const safe = safeDateOnly(dateStr);
  if (!safe) return '';
  const dt = new Date(`${safe}T00:00:00Z`);
  if (!Number.isFinite(dt.getTime())) return '';
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  return dt.toISOString().slice(0, 10);
}

function forecastHistoryRowKey(row) {
  return [
    String(row?.store || '').trim(),
    String(row?.bizType || '').trim(),
    String(row?.slot || '').trim(),
    String(row?.date || '').trim()
  ].join('||');
}

function sortForecastHistoryRows(rows, limit = 0) {
  const sorted = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const aDate = String(a?.date || '');
    const bDate = String(b?.date || '');
    if (aDate !== bDate) return bDate.localeCompare(aDate);
    return String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''));
  });
  if (limit > 0) return sorted.slice(0, limit);
  return sorted;
}

function mergePreferredForecastHistoryRows(primaryRows, fallbackRows, limit = 0) {
  const map = new Map();
  (Array.isArray(primaryRows) ? primaryRows : []).forEach((row) => {
    map.set(forecastHistoryRowKey(row), row);
  });
  (Array.isArray(fallbackRows) ? fallbackRows : []).forEach((row) => {
    const key = forecastHistoryRowKey(row);
    if (!map.has(key)) map.set(key, row);
  });
  return sortForecastHistoryRows(Array.from(map.values()), limit);
}

// POS 上传门店名（导出全称，如「洪潮传统潮汕菜【大宁久光中心店】」）与系统配置门店名
// （简称，如「洪潮大宁久光店」）属于两套命名体系，直接等值匹配取不到数（毛利率/预测全为0）。
// 这里把配置门店名解析成真实 POS 门店名：① 精确 key 命中；② 用品牌词（店名前2个汉字）圈定
// POS 候选，品牌下唯一候选即命中；③ 多候选时用去掉品牌/通用词后的位置词最长公共子串≥2 兜底。
// 解析不到则回退原 key（结果与修复前一致，不引入回归）。结果带 60s 缓存。
const _posStoreListCache = new Map();
async function listPosStoreNames() {
  const now = Date.now();
  const tenantId = resolveTenantIdDefault();
  const cached = _posStoreListCache.get(tenantId);
  if (cached && now - cached.at < 60000 && cached.list.length) return cached.list;
  try {
    const r = await pool.query(`SELECT DISTINCT store FROM pos_sales_detail WHERE store IS NOT NULL AND trim(store) <> ''`);
    const list = (r.rows || []).map((x) => String(x.store || '').trim()).filter(Boolean);
    _posStoreListCache.set(tenantId, { at: now, list });
    return list;
  } catch (_e) { /* keep stale cache on error */ }
  return cached?.list || [];
}
function longestCommonRun(a, b) {
  if (!a || !b) return 0;
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}
function stripStoreGenericWords(key) {
  return String(key || '').replace(/(传统潮汕菜|广东小馆|荔枝木烧鹅|上海|北京|深圳|广州|中心|门店|店铺|商场|购物中心|店)/g, '');
}
async function resolvePosStoreKeys(storeScope) {
  const wanted = (Array.isArray(storeScope) ? storeScope : []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!wanted.length) return [];
  const posStores = await listPosStoreNames();
  if (!posStores.length) return Array.from(new Set(wanted.map((x) => normalizeStoreKey(x)).filter(Boolean)));
  const out = new Set();
  for (const w of wanted) {
    const wk = normalizeStoreKey(w);
    const exact = posStores.find((p) => normalizeStoreKey(p) === wk);
    if (exact) { out.add(normalizeStoreKey(exact)); continue; }
    const brandTok = (w.match(/[一-龥]{2}/) || [''])[0]; // 店名前2个汉字作品牌词
    let cands = brandTok ? posStores.filter((p) => p.includes(brandTok)) : posStores.slice();
    if (cands.length !== 1) {
      const wa = stripStoreGenericWords(wk);
      const scored = cands
        .map((c) => ({ c, run: longestCommonRun(wa, stripStoreGenericWords(normalizeStoreKey(c))) }))
        .filter((x) => x.run >= 2)
        .sort((a, b) => b.run - a.run);
      cands = scored.length ? [scored[0].c] : [];
    }
    out.add(cands.length === 1 ? normalizeStoreKey(cands[0]) : wk);
  }
  return Array.from(out);
}

async function loadInventoryForecastHistoryFromSalesRaw({ storeScope, bizType, slot, startDate, endDate }) {
  const stores = Array.isArray(storeScope)
    ? Array.from(new Set(storeScope.map((x) => String(x || '').trim()).filter(Boolean)))
    : [];
  if (!stores.length) return [];
  const storeKeys = await resolvePosStoreKeys(stores);
  if (!storeKeys.length) return [];

  const qBizType = normalizeForecastBizType(bizType);
  const qSlot = normalizeForecastSlot(slot);
  const start = safeDateOnly(startDate);
  const end = safeDateOnly(endDate);
  const where = [`lower(regexp_replace(COALESCE(store,''),'\\s+','','g')) = ANY($1)`];
  const params = [storeKeys];
  if (start) {
    params.push(start);
    where.push(`date >= $${params.length}::date`);
  }
  if (end) {
    params.push(end);
    where.push(`date <= $${params.length}::date`);
  }
  if (qBizType) {
    params.push(qBizType);
    where.push(`(
      ($${params.length} = 'takeaway' AND lower(regexp_replace(COALESCE(biz_type,''),'\\s+','','g')) IN ('takeaway','delivery','外卖','外送'))
      OR
      ($${params.length} = 'dinein' AND lower(regexp_replace(COALESCE(biz_type,''),'\\s+','','g')) IN ('dinein','堂食','店内','堂食点餐'))
    )`);
  }

  const sql = `
    SELECT
      store,
      date::text AS date,
      biz_type,
      COALESCE(slot, '') AS slot,
      dish_name,
      ROUND(SUM(COALESCE(qty, 0))::numeric, 2) AS qty,
      ROUND(SUM(COALESCE(sales_amount, 0))::numeric, 2) AS sales_amount,
      ROUND(SUM(COALESCE(revenue, 0))::numeric, 2) AS revenue,
      ROUND(SUM(COALESCE(discount, 0))::numeric, 2) AS discount
    FROM pos_sales_detail
    WHERE ${where.join(' AND ')}
    GROUP BY store, date, biz_type, slot, dish_name
    ORDER BY date DESC
  `;

  const resp = await pool.query(sql, params);
  const grouped = new Map();
  for (const raw of (resp.rows || [])) {
    const date = safeDateOnly(raw?.date);
    const biz = normalizeForecastBizType(raw?.biz_type);
    const slotName = normalizeForecastSlot(raw?.slot);
    const product = String(raw?.dish_name || '').trim();
    const qty = safeNumber(raw?.qty);
    const salesAmount = safeNumber(raw?.sales_amount);
    const revenue = safeNumber(raw?.revenue);
    const discount = safeNumber(raw?.discount);
    if (!date || !biz || !slotName || !product || !Number.isFinite(qty) || qty <= 0) continue;
    if (qBizType && biz !== qBizType) continue;
    if (qSlot && slotName !== qSlot) continue;

    const key = `${String(raw?.store || '').trim()}||${biz}||${slotName}||${date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `pos_sales:${key}`,
        store: String(raw?.store || '').trim(),
        bizType: biz,
        slot: slotName,
        date,
        weather: '',
        isHoliday: !!(isKnownPublicHoliday(date) || isCNYPeriod(date)),
        expectedRevenue: 0,
        actualRevenue: 0,
        totalDiscount: 0,
        productQuantities: {},
        source: 'pos_sales_detail',
        createdAt: `${date}T00:00:00.000Z`,
        updatedAt: `${date}T23:59:59.000Z`
      });
    }
    const row = grouped.get(key);
    const expectedRevenueInc = Number.isFinite(salesAmount) && salesAmount > 0
      ? salesAmount
      : Math.max(0, Number(revenue || 0) + Number(discount || 0));
    row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + expectedRevenueInc).toFixed(2));
    row.actualRevenue = Number((Number(row.actualRevenue || 0) + (Number.isFinite(revenue) ? revenue : 0)).toFixed(2));
    row.totalDiscount = Number((Number(row.totalDiscount || 0) + (Number.isFinite(discount) ? discount : 0)).toFixed(2));
    row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
  }
  return sortForecastHistoryRows(Array.from(grouped.values()));
}

const FORECAST_EXCLUDED_PRODUCTS = ['打包盒', '特色米饭', '年夜饭', '五常大米饭'];

function isExcludedForecastProduct(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  return FORECAST_EXCLUDED_PRODUCTS.some((kw) => n.includes(kw));
}

function normalizeArkBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'https://ark.cn-beijing.volces.com/api/v3';
  const noSlash = raw.replace(/\/$/, '');
  if (/ark\.cn-beijing\.volces\.com/i.test(noSlash)) {
    if (/\/api\/v3$/i.test(noSlash)) return noSlash;
    return `${noSlash}/api/v3`;
  }
  return noSlash;
}

function normalizeOpenAiCompatibleBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const noSlash = raw.replace(/\/+$/, '');
  if (/ark\.cn-beijing\.volces\.com/i.test(noSlash)) {
    if (/\/api\/v3$/i.test(noSlash)) return noSlash;
    if (/\/v1$/i.test(noSlash)) return noSlash.replace(/\/v1$/i, '/api/v3');
    return `${noSlash}/api/v3`;
  }
  if (/\/v1$/i.test(noSlash)) return noSlash;
  return `${noSlash}/v1`;
}

/**
 * 从租户自己在 HRMS「系统设置 → AI 配置」里填的模型/绑定（state0.settings.llm，多模型+
 * 按功能绑定的新格式）解析出应该用哪个模型；跟下面这套环境变量/aiConfig 兜底逻辑
 * （default 租户目前用的旧单模型格式）是两条独立路径，新格式没配置时完全走旧逻辑。
 */
function resolveTenantAiConfigFromState(state0, featureKey = 'default') {
  const llm = state0?.settings?.llm;
  if (!llm || typeof llm !== 'object') return null;
  const models = Array.isArray(llm.models) ? llm.models : [];
  if (!models.length) return null; // 旧单模型格式走下面现有兜底链，不在这里处理
  const bindings = llm.bindings || {};
  const key = String(featureKey || 'default').trim() || 'default';
  const boundId = String(bindings?.[key] || bindings?.default || '').trim();
  let m = models.find((x) => x?.id === boundId && x?.enabled !== false);
  if (!m) m = models.find((x) => x?.enabled !== false);
  if (!m?.apiKey || !m?.baseUrl || !m?.model) return null;
  return { apiKey: String(m.apiKey).trim(), baseUrl: normalizeArkBaseUrl(m.baseUrl), model: String(m.model).trim() };
}

async function resolveForecastArkConfig(state0, opts = {}) {
  const tenantCfg = resolveTenantAiConfigFromState(state0, opts.preferVision ? 'vision_scoring' : 'default');
  if (tenantCfg) return tenantCfg;

  const preferVision = !!opts.preferVision;
  const llm = state0?.settings?.llm && typeof state0.settings.llm === 'object' ? state0.settings.llm : {};
  const aiConfig = state0?.aiConfig && typeof state0.aiConfig === 'object' ? state0.aiConfig : {};
  const endpointId = String(
    process.env.ARK_ENDPOINT_ID
      || process.env.INVENTORY_FORECAST_ENDPOINT_ID
      || llm.endpointId
      || aiConfig.endpointId
      || ''
  ).trim();
  const modelRaw = String(
    (preferVision ? process.env.ARK_VISION_MODEL : '')
      || process.env.INVENTORY_FORECAST_MODEL
      || process.env.ARK_MODEL
      || llm.model
      || aiConfig.model
      || ''
  ).trim();
  const model = /^ep-/i.test(endpointId)
    ? endpointId
    : (/^ep-/i.test(modelRaw) ? modelRaw : 'ep-20260217191023-bjlrn');
  const apiKey = String(
    process.env.ARK_API_KEY
      || process.env.INVENTORY_FORECAST_API_KEY
      || process.env.FORECAST_API_KEY
      || process.env.OPENAI_API_KEY
      || llm.apiKey
      || aiConfig.apiKey
      || ''
  ).trim();
  const baseUrl = normalizeArkBaseUrl(
    process.env.INVENTORY_FORECAST_API_BASE
      || process.env.ARK_API_BASE
      || llm.baseUrl
      || aiConfig.apiUrl
      || 'https://ark.cn-beijing.volces.com'
  );
  return { apiKey, baseUrl, model };
}

function normalizeForecastProducts(input) {
  const out = {};
  if (Array.isArray(input)) {
    input.forEach((it) => {
      const name = String(it?.name || it?.product || '').trim();
      if (isExcludedForecastProduct(name)) return;
      if (!name) return;
      const qty = safeNumber(it?.qty ?? it?.quantity ?? it?.count);
      if (!Number.isFinite(qty) || qty < 0) return;
      out[name] = Number((Number(out[name] || 0) + qty).toFixed(2));
    });
    return out;
  }
  if (input && typeof input === 'object') {
    Object.keys(input).forEach((k) => {
      const name = String(k || '').trim();
      if (isExcludedForecastProduct(name)) return;
      if (!name) return;
      const qty = safeNumber(input[k]);
      if (!Number.isFinite(qty) || qty < 0) return;
      out[name] = Number(qty.toFixed(2));
    });
  }
  return out;
}

function parseForecastHistoryRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = safeDateOnly(raw?.date);
  if (!date) return null;
  const weather = normalizeForecastWeather(raw?.weather);
  const isHoliday = !!(raw?.isHoliday === true || raw?.isHoliday === 1 || raw?.isHoliday === '1' || String(raw?.isHoliday || '').trim().toLowerCase() === 'true' || String(raw?.isHoliday || '').trim() === '是');
  const expectedRevenue = safeNumber(raw?.expectedRevenue ?? raw?.forecastRevenue ?? raw?.revenue);
  const actualRevenue = safeNumber(raw?.actualRevenue);
  const totalDiscount = safeNumber(raw?.totalDiscount);
  const productQuantities = normalizeForecastProducts(raw?.productQuantities ?? raw?.products);
  if (!Object.keys(productQuantities).length) return null;
  return {
    date,
    weather,
    isHoliday,
    expectedRevenue: Number.isFinite(expectedRevenue) ? Number(expectedRevenue.toFixed(2)) : 0,
    actualRevenue: Number.isFinite(actualRevenue) ? Number(actualRevenue.toFixed(2)) : 0,
    totalDiscount: Number.isFinite(totalDiscount) ? Number(totalDiscount.toFixed(2)) : 0,
    productQuantities
  };
}

function scoreForecastRow(item, target) {
  const date = String(item?.date || '').trim();
  const weather = String(item?.weather || '').trim().toLowerCase();
  const targetWeather = String(target?.weather || '').trim().toLowerCase();
  let score = 1;
  let dayDiff = null;
  try {
    const d1 = new Date(date + 'T00:00:00');
    const d2 = new Date(String(target?.date || '') + 'T00:00:00');
    if (Number.isFinite(d1.getTime()) && Number.isFinite(d2.getTime())) {
      dayDiff = Math.abs(Math.round((d2.getTime() - d1.getTime()) / 86400000));
      // Day-of-week: exact match is the strongest signal (Mon≠Fri≠Sat)
      if (d1.getDay() === d2.getDay()) score += 1.8;
      else {
        const diff = Math.abs(d1.getDay() - d2.getDay());
        const adj = Math.min(diff, 7 - diff);
        if (adj === 1) score += 0.3;
      }
      // Recency bonus: closer dates are more reliable for food demand.
      const recencyBonus = Math.max(0, 1.0 - Math.min(1.0, Number(dayDiff || 0) / 60));
      score += recencyBonus;
    }
  } catch (e) { /* ignore */ }
  // Holiday matching as separate dimension (some stores busy on holidays, some not)
  if (Boolean(item?.isHoliday) === Boolean(target?.isHoliday)) score += 0.7;
  // Weather match
  const itemWeatherTag = normalizeForecastWeatherTag(weather);
  const targetWeatherTag = normalizeForecastWeatherTag(targetWeather);
  if (itemWeatherTag && targetWeatherTag) {
    if (itemWeatherTag === targetWeatherTag) score += 0.6;
    else score += 0.1;
  }
  const rev = Number(item?.expectedRevenue || 0);
  const targetRev = Number(target?.expectedRevenue || 0);
  if (targetRev > 0 && rev > 0) {
    const diffRate = Math.abs(rev - targetRev) / Math.max(targetRev, 1);
    score += Math.max(0, 0.8 - diffRate);
  }
  return Math.max(0.2, Number(score.toFixed(4)));
}

function buildForecastByHeuristic(historyRows, target, topN) {
  const list = Array.isArray(historyRows) ? historyRows : [];
  if (!list.length) return { predictions: [], confidence: 0.1, summary: '暂无历史数据，无法生成稳定预测。' };

  const sumByProduct = new Map();
  let totalScore = 0;
  let strongMatchCount = 0;
  let weightedRevenueSum = 0;
  let revenueScoreSum = 0;

  list.forEach((row) => {
    const score = scoreForecastRow(row, target);
    totalScore += score;
    if (score >= 2.4) strongMatchCount += 1;
    const rowRev = Number(row?.expectedRevenue || row?.revenue || row?.totalAmount || 0);
    if (rowRev > 0) {
      weightedRevenueSum += rowRev * score;
      revenueScoreSum += score;
    }
    const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
    Object.entries(products).forEach(([name, qtyRaw]) => {
      const nameSafe = String(name || '').trim();
      if (isExcludedForecastProduct(nameSafe)) return;
      if (!nameSafe) return;
      const qty = Number(qtyRaw || 0);
      if (!Number.isFinite(qty) || qty < 0) return;
      const prev = sumByProduct.get(nameSafe) || 0;
      sumByProduct.set(nameSafe, prev + qty * score);
    });
  });

  const divider = totalScore > 0 ? totalScore : list.length;

  // CRITICAL: Calculate revenue scaling factor
  // If target revenue is 20000 but historical average is 10000, scale predictions by ~2x
  const targetRev = Number(target?.expectedRevenue || 0);
  const avgHistoricalRevenue = revenueScoreSum > 0 ? (weightedRevenueSum / revenueScoreSum) : 0;
  let revenueScale = 1;
  if (targetRev > 0 && avgHistoricalRevenue > 0) {
    const ratio = targetRev / avgHistoricalRevenue;
    // Small sample size is very noisy. Use stronger damping to avoid runaway qty inflation.
    const exp = list.length < 8 ? 0.45 : (list.length < 20 ? 0.6 : 0.72);
    revenueScale = Math.pow(Math.max(0.01, ratio), exp);
    // 旺日/节假日放宽缩放上限，避免大促当天备货系统性不足；样本越多越敢放宽。
    const upperCap = target?.isHoliday ? 2.8 : (list.length >= 20 ? 2.3 : 1.9);
    if (revenueScale > upperCap) revenueScale = upperCap;
    if (revenueScale < 0.6) revenueScale = 0.6;
  }

  const sorted = Array.from(sumByProduct.entries())
    .map(([product, weightedQty]) => ({
      product,
      qty: Number(((weightedQty / Math.max(1, divider)) * revenueScale).toFixed(1)),
      reason: revenueScale !== 1 ? `营收比例${(revenueScale * 100).toFixed(0)}%调整` : ''
    }))
    .filter((x) => Number(x.qty) > 0)
    .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));

  const limit = Math.max(5, Math.min(80, Number(topN || 20) || 20));
  const predictions = sorted.slice(0, limit);
  const baseConfidence = 0.35 + Math.min(0.35, list.length * 0.015) + Math.min(0.2, strongMatchCount * 0.03);
  const confidence = Number(Math.max(0.1, Math.min(0.95, baseConfidence)).toFixed(2));
  const revNote = (targetRev > 0 && avgHistoricalRevenue > 0)
    ? `预计营收¥${targetRev}（历史均值¥${Math.round(avgHistoricalRevenue)}，缩放${(revenueScale * 100).toFixed(0)}%）。`
    : '';
  const summary = `基于${list.length}条历史记录进行相似度加权，匹配度较高样本${strongMatchCount}条。${revNote}`;
  return { predictions, confidence, summary };
}

function extractHistoryProductUniverse(historyRows) {
  const out = new Set();
  (Array.isArray(historyRows) ? historyRows : []).forEach((row) => {
    const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
    Object.keys(products).forEach((name) => {
      const n = String(name || '').trim();
      if (!n || isExcludedForecastProduct(n)) return;
      out.add(n);
    });
  });
  return out;
}

function constrainPredictionsToHistory(predictions, historyRows, topN) {
  const universe = extractHistoryProductUniverse(historyRows);
  if (!universe.size) return [];
  return normalizePredictionItems(predictions)
    .filter((x) => universe.has(String(x?.product || '').trim()))
    .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
    .slice(0, Math.max(5, Math.min(80, Number(topN || 20) || 20)));
}

// Compute slot's share of total biz-type revenue from historical data.
// Returns { slotRevenue, slotShare, splitMode } where slotRevenue is the
// revenue this specific slot should expect given a total biz-type revenue.
function computeSlotRevenueShare(allHistoryRows, store, bizType, slot, date) {
  const rows = (Array.isArray(allHistoryRows) ? allHistoryRows : [])
    .filter((x) => String(x?.store || '').trim() === String(store || '').trim())
    .filter((x) => normalizeForecastBizType(x?.bizType) === normalizeForecastBizType(bizType))
    .filter((x) => { const d = safeDateOnly(x?.date); return !date || !d || d <= date; });
  const bySlot = { lunch: 0, afternoon: 0, dinner: 0 };
  rows.forEach((row) => {
    const s = normalizeForecastSlot(row?.slot);
    if (s && Object.prototype.hasOwnProperty.call(bySlot, s)) {
      bySlot[s] += Math.max(0, Number(row?.expectedRevenue || 0));
    }
  });
  const total = Object.values(bySlot).reduce((a, b) => a + b, 0);
  // Fallback shares if no history: typical restaurant pattern
  const fallback = { lunch: 0.45, afternoon: 0.10, dinner: 0.45 };
  const normalizedSlot = normalizeForecastSlot(slot);
  if (total > 0) {
    const share = Number((bySlot[normalizedSlot] || 0) / total);
    return { slotShare: Number(Math.max(0.05, share).toFixed(4)), splitMode: 'history' };
  }
  return { slotShare: fallback[normalizedSlot] || 0.33, splitMode: 'fallback' };
}

async function buildForecastByAI({ historyRows, target, topN, state0 }) {
  const cfg = await resolveForecastArkConfig(state0 || {}, { preferVision: false });
  const apiKey = cfg.apiKey;
  if (!apiKey) return null;

  const baseUrl = cfg.baseUrl;
  const model = cfg.model;
  const rows = (Array.isArray(historyRows) ? historyRows : []).slice(0, 200);
  if (!rows.length) return null;

  const prompt = [
    '你是专业的餐饮门店备货预测AI助手。',
    '请仅输出 JSON，不要输出任何额外解释文字。',
    'JSON 格式：',
    '{"predictions":[{"product":"产品名","qty":12.3,"reason":"简短原因"}],"summary":"一句话总结","confidence":0.78}',
    '',
    '规则：',
    '1) predictions 只包含具体菜品产品，qty 为预测销售数量（非负数字），按 qty 降序排列；',
    '2) 【最重要】目标条件中的 expectedRevenue 是该时段（非全天）的预计营收。对比目标营收与历史同时段营收，按比例调整每个菜品的预测销量；',
    '3) 同时分析：目标日期是星期几、天气状况、是否假日，与历史同类条件下的销售数据对比；天气不能直接做固定比例加减，销量应主要由目标营收和历史样本决定；',
    `4) 只输出销量排名前 ${Math.min(topN || 20, 20)} 名的产品；`,
    '5) qty 必须是合理的整数或一位小数，不能为0；',
    '',
    '目标条件：',
    JSON.stringify(target),
    '',
    `历史销售样本（共${rows.length}条）：`,
    JSON.stringify(rows)
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const tx = await resp.text().catch(() => '');
      throw new Error(`forecast_ai_http_${resp.status}:${tx.slice(0, 240)}`);
    }
    const data = await resp.json();
    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) throw new Error('forecast_ai_empty');
    const jsonTextMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonTextMatch ? jsonTextMatch[0] : content);
    const arr = Array.isArray(parsed?.predictions) ? parsed.predictions : [];
    const predictions = arr
      .map((x) => ({
        product: String(x?.product || '').trim(),
        qty: Number(Number(x?.qty || 0).toFixed(2)),
        reason: String(x?.reason || '').trim()
      }))
      .filter((x) => x.product && Number.isFinite(x.qty) && x.qty >= 0 && !isExcludedForecastProduct(x.product))
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
      .slice(0, Math.max(5, Math.min(80, Number(topN || 20) || 20)));
    const confidenceRaw = Number(parsed?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Number(Math.max(0.05, Math.min(0.99, confidenceRaw)).toFixed(2))
      : 0.72;
    const summary = String(parsed?.summary || '').trim();
    return { predictions, confidence, summary };
  } finally {
    clearTimeout(timer);
  }
}

function getStateUsers(state) {
  const users = Array.isArray(state?.users) ? state.users : [];
  const employees = Array.isArray(state?.employees) ? state.employees : [];
  return { users, employees };
}

function findUserSalary(state, username) {
  const u = String(username || '').trim();
  if (!u) return null;
  const { users, employees } = getStateUsers(state);
  const rec = users.find(x => String(x?.username || '').trim() === u) || employees.find(x => String(x?.username || '').trim() === u) || null;
  if (!rec) return null;
  const raw = (rec.salary !== undefined && rec.salary !== null && rec.salary !== '')
    ? rec.salary
    : ((rec.wage !== undefined && rec.wage !== null && rec.wage !== '')
      ? rec.wage
      : ((rec.baseSalary !== undefined && rec.baseSalary !== null && rec.baseSalary !== '')
        ? rec.baseSalary
        : ((rec.monthlySalary !== undefined && rec.monthlySalary !== null && rec.monthlySalary !== '')
          ? rec.monthlySalary
          : ((rec.pay !== undefined && rec.pay !== null && rec.pay !== '') ? rec.pay : null))));
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function buildAttendanceFromReports(items) {
  const out = [];
  const map = new Map();

  const add = (store, date, staffArr) => {
    const list = Array.isArray(staffArr) ? staffArr : [];
    for (const it of list) {
      const user = String(it?.user || it?.username || '').trim();
      if (!user) continue;
      const name = String(it?.name || '').trim();
      const days = clampNum(it?.days, 1);
      const key = `${store}||${date}||${user}`;
      const prev = map.get(key);
      if (prev) {
        prev.days = clampNum(prev.days, 0) + (Number.isFinite(days) ? days : 1);
      } else {
        const rec = { store, date, username: user, name, days: Number.isFinite(days) ? days : 1 };
        map.set(key, rec);
        out.push(rec);
      }
    }
  };

  (Array.isArray(items) ? items : []).forEach(r => {
    const store = String(r?.store || '').trim();
    const date = String(r?.date || '').trim();
    if (!store || !date) return;
    const data = r?.data && typeof r.data === 'object' ? r.data : {};
    add(store, date, data?.staff?.front);
    add(store, date, data?.staff?.kitchen);
  });

  out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.store).localeCompare(String(b.store)) || String(a.username).localeCompare(String(b.username)));
  return out;
}

function isCountableCheckinStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'normal' || s === 'confirmed' || s === 'no_gps';
}

function shanghaiDateOnly(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}

function buildAttendanceFromCheckinRecords(rows, options = {}) {
  const out = [];
  const map = new Map();
  const start = safeDateOnly(options?.start);
  const end = safeDateOnly(options?.end);
  const knownUsers = options?.knownUsers instanceof Set ? options.knownUsers : null;

  for (const row of (Array.isArray(rows) ? rows : [])) {
    const user = String(row?.username || '').trim();
    const userLower = user.toLowerCase();
    if (!user || isLegacyTestUsername(userLower)) continue;
    if (knownUsers && !knownUsers.has(userLower)) continue;
    if (!isCountableCheckinStatus(row?.status)) continue;
    const date = shanghaiDateOnly(row?.check_time);
    if (!date) continue;
    if (start && date < start) continue;
    if (end && date > end) continue;
    const store = String(row?.store || '').trim();
    if (!store) continue;
    const key = `${store}||${date}||${userLower}`;
    if (map.has(key)) continue;
    const rec = {
      store,
      date,
      username: user,
      name: String(row?.display_name || row?.name || user).trim(),
      days: 1
    };
    map.set(key, rec);
    out.push(rec);
  }

  out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.store).localeCompare(String(b.store)) || String(a.username).localeCompare(String(b.username)));
  return out;
}

function normalizeAttendanceRegisterLineDetails(raw) {
  let lines = raw;
  if (typeof lines === 'string') {
    try { lines = JSON.parse(lines); } catch (e) { lines = []; }
  }
  return Array.isArray(lines) ? lines : [];
}

function sortIsoDateList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((x) => String(x || '').trim()).filter(Boolean))).sort();
}

function buildAttendanceSummaryRows(registerRows, checkinDetails) {
  const summaryMap = new Map();
  const checkinDayMap = new Map();

  const ensureSummary = (storeRaw, usernameRaw, nameRaw) => {
    const store = String(storeRaw || '').trim();
    const username = String(usernameRaw || '').trim();
    const name = String(nameRaw || username || '').trim();
    const identity = username ? username.toLowerCase() : name.toLowerCase();
    if (!identity) return null;
    const key = `${store}||${identity}`;
    let row = summaryMap.get(key);
    if (!row) {
      row = {
        store,
        username,
        name,
        actualDates: new Set(),
        absentDates: new Set(),
        lateDates: new Set(),
        restDates: new Set(),
        restOffsetDates: new Set(),
        anomalyPunches: 0,
        punchDays: new Set(),
        workFrac: new Map(),   // 日期 -> 上班天数（半天=0.5），来自台账 declared_days
        restFrac: new Map()    // 日期 -> 休息天数（半天=0.5）
      };
      summaryMap.set(key, row);
    } else {
      if (!row.username && username) row.username = username;
      if ((!row.name || row.name === row.username) && name) row.name = name;
      if (!row.store && store) row.store = store;
    }
    return row;
  };

  for (const regRow of (Array.isArray(registerRows) ? registerRows : [])) {
    const reportDate = String(regRow?.report_date || '').slice(0, 10);
    const store = String(regRow?.store || '').trim();
    if (!reportDate) continue;
    const lines = normalizeAttendanceRegisterLineDetails(regRow?.line_details);
    for (const line of lines) {
      const username = String(line?.username || line?.user || '').trim();
      const name = String(line?.display_name || line?.name || username).trim();
      const row = ensureSummary(store, username, name);
      if (!row) continue;
      const kind = String(line?.kind || '').trim();
      const declared = Number(line?.declared_days);
      const frac = Number.isFinite(declared) && declared > 0 ? declared : 1;
      if (kind === 'work') {
        row.actualDates.add(reportDate);
        row.workFrac.set(reportDate, (Number(row.workFrac.get(reportDate)) || 0) + frac);
      } else if (kind === 'absent') {
        row.absentDates.add(reportDate);
      } else if (kind === 'rest' || kind === 'leave_only') {
        row.restDates.add(reportDate);
        row.restOffsetDates.add(reportDate);
        row.restFrac.set(reportDate, (Number(row.restFrac.get(reportDate)) || 0) + frac);
      }
    }
  }

  for (const checkin of (Array.isArray(checkinDetails) ? checkinDetails : [])) {
    const username = String(checkin?.username || '').trim();
    const name = String(checkin?.display_name || checkin?.name || username).trim();
    const store = String(checkin?.store || '').trim();
    const date = shanghaiDateOnly(checkin?.check_time);
    const row = ensureSummary(store, username, name);
    if (!row || !date) continue;

    const dayKey = `${store}||${(username || name).trim().toLowerCase()}||${date}`;
    let day = checkinDayMap.get(dayKey);
    if (!day) {
      day = { store, date, firstIn: null, hasCountable: false, anomalyPunches: 0 };
      checkinDayMap.set(dayKey, day);
    }

    const status = String(checkin?.status || '').trim();
    if (isCountableCheckinStatus(status)) {
      day.hasCountable = true;
      row.punchDays.add(date);
      if (!row.actualDates.has(date) && !row.absentDates.has(date) && !row.restDates.has(date)) {
        row.actualDates.add(date);
      }
      if (String(checkin?.type || '').trim() === 'clock_in') {
        const dt = new Date(checkin.check_time);
        if (Number.isFinite(dt.getTime()) && (!day.firstIn || dt.getTime() < day.firstIn.getTime())) {
          day.firstIn = dt;
        }
      }
    }

    if (status && !['normal', 'no_gps', 'confirmed'].includes(status)) {
      day.anomalyPunches += 1;
    }
  }

  for (const row of summaryMap.values()) {
    const identity = String(row.username || row.name || '').trim().toLowerCase();
    if (!identity) continue;
    for (const [key, day] of checkinDayMap.entries()) {
      if (!key.startsWith(`${row.store}||${identity}||`)) continue;
      row.anomalyPunches += Number(day?.anomalyPunches || 0);
      if (day?.hasCountable && day?.firstIn && row.actualDates.has(day.date)) {
        const attWin = hrmsAttendanceWindowMinutesForStore(row.store);
        const firstInMinutes = hrmsClockMinutesInShanghai(day.firstIn);
        if (Number.isFinite(firstInMinutes) && firstInMinutes > attWin.startMinutes) {
          row.lateDates.add(day.date);
        }
      }
    }
  }

  return Array.from(summaryMap.values())
    .map((row) => {
      const actualDates = sortIsoDateList(Array.from(row.actualDates));
      const absentDates = sortIsoDateList(Array.from(row.absentDates));
      const lateDates = sortIsoDateList(Array.from(row.lateDates));
      const restDates = sortIsoDateList(Array.from(row.restDates));
      const restOffsetDates = sortIsoDateList(Array.from(row.restOffsetDates));
      // 半天精度：台账有 declared_days 用其分数，无台账记录（仅打卡推断）按整天计
      const sumFrac = (dates, fracMap) => Number(dates.reduce(
        (s, d) => s + (fracMap.has(d) ? Number(fracMap.get(d)) || 0 : 1), 0).toFixed(2));
      return {
        store: row.store,
        username: row.username,
        name: row.name || row.username,
        actualAttendanceDays: sumFrac(actualDates, row.workFrac),
        absenceDays: absentDates.length,
        lateDays: lateDates.length,
        restDays: sumFrac(restDates, row.restFrac),
        anomalyPunches: Number(row.anomalyPunches || 0),
        checkinDays: row.punchDays.size,
        actualDates,
        absentDates,
        lateDates,
        restDates,
        restOffsetDates
      };
    })
    .sort((a, b) => {
      if (String(a.store || '') !== String(b.store || '')) {
        return String(a.store || '').localeCompare(String(b.store || ''), 'zh-Hans-CN');
      }
      if (Number(b.absenceDays || 0) !== Number(a.absenceDays || 0)) {
        return Number(b.absenceDays || 0) - Number(a.absenceDays || 0);
      }
      if (Number(b.lateDays || 0) !== Number(a.lateDays || 0)) {
        return Number(b.lateDays || 0) - Number(a.lateDays || 0);
      }
      return String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), 'zh-Hans-CN');
    });
}

function pickMyStoreFromState(state, username) {
  const me = stateFindUserRecord(state, username) || {};
  const st = String(me?.store || '').trim();
  return st;
}

let __storeDutyBindingsReady = false;

async function ensureStoreDutyBindingsReady() {
  if (__storeDutyBindingsReady) return;
  try {
    await ensureStoreDutyBindingsTable(pool);
    __storeDutyBindingsReady = true;
  } catch (e) {
    console.warn('[store-duty-bindings] ensure table failed:', e?.message || e);
  }
}

// 门店若无在岗店长（如喻烽以监管身份兼管马己仙），回退到该门店职责绑定中
// can_approve_hrms 的负责人，作为审批链的「门店店长」步骤。
async function resolveDutyApproverForStore(store) {
  const s = String(store || '').trim();
  if (!s) return '';
  try {
    await ensureStoreDutyBindingsReady();
    const r = await pool.query(
      `SELECT username FROM store_duty_bindings
        WHERE enabled = true
          AND can_approve_hrms = true
          AND lower(trim(store)) = lower(trim($1))
          AND (effective_from IS NULL OR effective_from <= now())
          AND (effective_to IS NULL OR effective_to >= now())
        ORDER BY is_primary_store DESC, updated_at DESC, id DESC
        LIMIT 1`,
      [s]
    );
    return r.rows?.[0]?.username ? String(r.rows[0].username).trim() : '';
  } catch (e) {
    console.warn('[store-duty-bindings] resolveDutyApproverForStore failed:', e?.message || e);
    return '';
  }
}

async function getUserStoreAccessContext(username, role, opts = {}) {
  const normalizedUsername = String(username || '').trim();
  const normalizedRole = normalizeRoleForJwt(role);
  const requestedStore = String(opts?.requestedStore || '').trim();
  const stateStore = String(opts?.stateStore || '').trim();
  let dutyRows = [];

  // 权限组/岗位的门店范围（全部/按品牌/按区域/按店多选）优先于跨店绑定表生效；
  // 员工身上有 storeScopeOverride 就优先用它，否则用所在权限组的 storeScope。
  // 员工没分配权限组、或权限组没设门店范围时 resolveStoreScopeStores 返回 null，
  // 直接落到下面 else 分支走原有的跨店绑定查询——对洪潮/马己仙现有数据零影响。
  let scopeStores = null;
  let scopeActions = null;
  if (normalizedUsername) {
    try {
      const tenantId = resolveTenantIdDefault();
      const state = (await getSharedState(tenantId)) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const emp = employees.find((e) => String(e?.username || '').trim().toLowerCase() === normalizedUsername.toLowerCase());
      const groupId = String(emp?.permissionGroupId || '').trim();
      const group = groupId
        ? (Array.isArray(state.permissionGroups) ? state.permissionGroups : []).find((g) => String(g?.id || '') === groupId)
        : null;
      const effectiveScope = (emp?.storeScopeOverride && typeof emp.storeScopeOverride === 'object')
        ? emp.storeScopeOverride
        : (group?.storeScope || null);
      scopeStores = resolveStoreScopeStores(state, effectiveScope);
      scopeActions = group?.actions && typeof group.actions === 'object' ? group.actions : null;
    } catch (e) {
      scopeStores = null;
    }
  }

  if (Array.isArray(scopeStores)) {
    const primary = stateStore && scopeStores.includes(stateStore) ? stateStore : (scopeStores[0] || '');
    dutyRows = scopeStores.map((store) => ({
      username: normalizedUsername,
      store,
      access_level: store === primary ? 'primary' : 'support',
      is_primary_store: store === primary,
      can_approve_hrms: !!scopeActions?.can_approve_hrms,
      can_view_employees: !!scopeActions?.can_view_employees,
    }));
  } else if (normalizedUsername) {
    try {
      await ensureStoreDutyBindingsReady();
      dutyRows = await loadActiveDutyRowsForUser(pool, normalizedUsername);
    } catch (e) {
      dutyRows = [];
    }
    // 岗位的"动作权限"(可审批HRMS/可查看员工)跟门店范围是否自定义无关，即使门店范围
    // 还是走原有跨店绑定(legacy)，岗位给的动作权限也要叠加生效——用OR不用覆盖，
    // 避免削弱跨店绑定表里已经手动勾好的权限。
    if (scopeActions && (scopeActions.can_approve_hrms || scopeActions.can_view_employees)) {
      dutyRows = dutyRows.map((row) => ({
        ...row,
        can_approve_hrms: !!(row.can_approve_hrms || scopeActions.can_approve_hrms),
        can_view_employees: !!(row.can_view_employees || scopeActions.can_view_employees),
      }));
    }
  }

  return buildStoreAccessContext({
    role: normalizedRole,
    stateStore,
    dutyRows,
    requestedStore,
  });
}

const OPS_BRAND_STORE_MAP = {
  '洪潮大宁久光店': '洪潮传统潮汕菜',
  '马己仙上海音乐广场店': '马己仙广东小馆'
};

const OPS_BRAND_RULES = {
  '洪潮传统潮汕菜': {
    lunchDeadline: '11:00',
    dinnerDeadline: '17:00',
    reviewDeadline: '22:30',
    tableVisitDeadline: '22:00'
  },
  '马己仙广东小馆': {
    lunchDeadline: '11:00',
    dinnerDeadline: '17:00',
    reviewDeadline: '22:30',
    tableVisitDeadline: '22:00'
  }
};

const OPS_ROLE_ALIASES = {
  store_product_manager: 'store_production_manager'
};

function normalizeOpsRole(input) {
  const raw = String(input || '').trim();
  return OPS_ROLE_ALIASES[raw] || raw;
}

function opsDateOnly(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function opsDateAt(dateStr, hm) {
  const date = safeDateOnly(dateStr);
  const time = String(hm || '').trim();
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;
  const v = new Date(`${date}T${time}:00`);
  return Number.isFinite(v.getTime()) ? v : null;
}

function resolveOpsStoreBrand(state, storeName) {
  const store = String(storeName || '').trim();
  if (!store) return '';
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  const row = stores.find(s => String(s?.name || '').trim() === store) || null;
  const fromState = String(row?.brand || row?.brandName || '').trim();
  if (fromState) return fromState;
  return String(OPS_BRAND_STORE_MAP[store] || '').trim();
}

function getOpsManagedStores(state) {
  const inState = Array.isArray(state?.stores)
    ? state.stores.map(s => String(s?.name || '').trim()).filter(Boolean)
    : [];
  const mapped = Object.keys(OPS_BRAND_STORE_MAP);
  return Array.from(new Set(inState.concat(mapped))).filter(Boolean);
}

function getOpsStoreAssignee(state, store, role) {
  const r = normalizeOpsRole(role);
  return pickStoreRoleUsernameByStore(state, store, [r]);
}

function buildOpsTaskTemplates(store, brand, bizDate) {
  const rules = OPS_BRAND_RULES[brand] || OPS_BRAND_RULES['洪潮传统潮汕菜'];
  if (!rules) return [];
  return [
    {
      taskType: 'opening_lunch',
      scheduleKey: 'opening_lunch',
      assigneeRole: 'store_manager',
      title: '午市开档检查（11:00前）',
      dueAt: opsDateAt(bizDate, rules.lunchDeadline),
      requiredPhotos: 3,
      checklist: ['门店前场与后厨开档状态完整', '关键岗位到岗确认', '收银及开档准备完成']
    },
    {
      taskType: 'prep_lunch',
      scheduleKey: 'prep_lunch',
      assigneeRole: 'store_production_manager',
      title: '午市出品与备货巡查（11:00前）',
      dueAt: opsDateAt(bizDate, rules.lunchDeadline),
      requiredPhotos: 3,
      checklist: ['备货台全景', '重点SKU备货近景', '出品工位卫生与标准']
    },
    {
      taskType: 'opening_dinner',
      scheduleKey: 'opening_dinner',
      assigneeRole: 'store_manager',
      title: '晚市开档检查（17:00前）',
      dueAt: opsDateAt(bizDate, rules.dinnerDeadline),
      requiredPhotos: 3,
      checklist: ['晚市排班到岗确认', '服务区与后厨开档完成', '晚市物料状态确认']
    },
    {
      taskType: 'prep_dinner',
      scheduleKey: 'prep_dinner',
      assigneeRole: 'store_production_manager',
      title: '晚市出品与备货巡查（17:00前）',
      dueAt: opsDateAt(bizDate, rules.dinnerDeadline),
      requiredPhotos: 3,
      checklist: ['晚市备货全景', '热销菜品备货细节', '出品台状态与风险点']
    },
    {
      taskType: 'bad_review_followup',
      scheduleKey: 'bad_review_followup',
      assigneeRole: 'store_manager',
      title: '堂食/外卖差评跟踪处理（当日）',
      dueAt: opsDateAt(bizDate, rules.reviewDeadline),
      requiredPhotos: 2,
      checklist: ['上传差评截图（堂食/外卖）', '上传处理结果或沟通记录截图']
    },
    {
      taskType: 'table_visit_tracking',
      scheduleKey: 'table_visit_tracking',
      assigneeRole: 'store_manager',
      title: '桌访达成记录同步确认（当日）',
      dueAt: opsDateAt(bizDate, rules.tableVisitDeadline),
      requiredPhotos: 1,
      checklist: ['上传桌访记录截图（飞书或内部表）', '备注当日关键反馈与跟进项']
    }
  ].filter(t => t.dueAt instanceof Date);
}

async function createOpsTaskIfAbsent(input) {
  const dedupeKey = String(input?.dedupeKey || '').trim();
  if (!dedupeKey) return;
  await pool.query(
    `insert into ops_tasks (
      biz_date, store, brand, task_type, schedule_key, dedupe_key,
      title, instructions, checklist, required_photos,
      assignee_username, assignee_role, due_at, source, tenant_id
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
    on conflict (dedupe_key, tenant_id) do nothing`,
    [
      input.bizDate,
      input.store,
      input.brand || null,
      input.taskType,
      input.scheduleKey,
      dedupeKey,
      input.title,
      input.instructions || null,
      JSON.stringify(Array.isArray(input.checklist) ? input.checklist : []),
      Math.max(1, Number(input.requiredPhotos || 1)),
      input.assigneeUsername,
      normalizeOpsRole(input.assigneeRole),
      input.dueAt,
      'ops_agent',
      resolveTenantIdDefault()
    ]
  );
}

async function ensureOpsTasksForDate(dateStr) {
  const bizDate = safeDateOnly(dateStr);
  if (!bizDate) return;
  const state = (await getSharedState()) || {};
  const stores = getOpsManagedStores(state);
  for (const store of stores) {
    const brand = resolveOpsStoreBrand(state, store);
    if (!brand) continue;
    const templates = buildOpsTaskTemplates(store, brand, bizDate);
    for (const t of templates) {
      const assigneeUsername = getOpsStoreAssignee(state, store, t.assigneeRole);
      if (!assigneeUsername) continue;
      const dedupeKey = `${bizDate}||${store}||${t.scheduleKey}||${assigneeUsername}`;
      await createOpsTaskIfAbsent({
        bizDate,
        store,
        brand,
        taskType: t.taskType,
        scheduleKey: t.scheduleKey,
        dedupeKey,
        title: t.title,
        checklist: t.checklist,
        requiredPhotos: t.requiredPhotos,
        assigneeUsername,
        assigneeRole: t.assigneeRole,
        dueAt: t.dueAt,
        instructions: `${brand} · ${store}：请按检查项完成并上传照片。`
      });
    }
  }
}

function buildOpsFeedback(task, completedAt, photoCount, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const contentVerified = !!opts.contentVerified;

  let score = contentVerified ? 5 : 3;
  const dueAt = new Date(task?.due_at || 0);
  const required = Math.max(1, Number(task?.required_photos || 1));
  if (Number.isFinite(dueAt.getTime()) && completedAt > dueAt) score -= 1;
  if (photoCount < required) score -= 2;
  if (photoCount === required) score -= 0;
  if (photoCount > required) score += 0;
  score = Math.max(1, Math.min(5, score));

  const lateText = Number.isFinite(dueAt.getTime()) && completedAt > dueAt ? '本次提交晚于计划时间，' : '';
  const photoText = photoCount < required
    ? `照片不足（需${required}张，实传${photoCount}张），`
    : '照片数量达标，';

  if (!contentVerified) {
    const feedback = `${lateText}${photoText}系统当前仅校验“时间与照片张数”，尚未校验图片内容与任务是否匹配。该结果仅供提醒，请由值班经理人工复核后再做评价。`;
    return { score, feedback, verificationStatus: 'unverified' };
  }

  const feedback = `${lateText}${photoText}图片内容与任务匹配，执行情况良好。下一次请按检查项逐条拍摄并备注异常点。`;
  return { score, feedback, verificationStatus: 'verified' };
}

let __OPS_TASK_SCHEDULER_STARTED = false;
// ops_tasks是真实业务数据(带RLS)，原只在default租户上下文里生成/关账，改为遍历活跃租户各自处理
async function runOpsTaskSchedulerTick() {
  try {
    await runForActiveTenants(async (tenantId) => {
      try {
        await ensureOpsTasksTable();
        const today = opsDateOnly(new Date());
        await ensureOpsTasksForDate(today);
        await pool.query(
          `update ops_tasks
           set status = 'overdue', updated_at = now()
           where status = 'open'
             and due_at < now()`
        );
      } catch (e) {
        console.error('[ops scheduler] tick failed:', tenantId, e?.message || e);
      }
    }, { continueOnError: true });
  } catch (e) {
    console.error('[ops scheduler] runForActiveTenants error:', e?.message || e);
  }
}

function startOpsTaskScheduler() {
  if (__OPS_TASK_SCHEDULER_STARTED) return;
  __OPS_TASK_SCHEDULER_STARTED = true;
  runOpsTaskSchedulerTick();
  setInterval(runOpsTaskSchedulerTick, 60 * 1000);
}

// Wave 4j: /api/ops/tasks* → domains/ops-tasks/routes.js

app.post('/api/admin/reconcile-daily-attendance-register-from-pg', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!canAccessDailyAttendanceRegister(role)) return res.status(403).json({ error: 'forbidden' });
  if (!pool) return res.status(503).json({ error: 'database_unavailable' });

  const maxRows = Math.min(5000, Math.max(1, Number(req.body?.maxRows) || 1500));
  const start = safeDateOnly(req.body?.start);
  const end = safeDateOnly(req.body?.end);
  const store = String(req.body?.store || '').trim();

  try {
    const refreshExisting = !!req.body?.refreshExisting;
    const out = await backfillDailyAttendanceRegisterMissing(pool, {
      maxRows,
      start,
      end,
      store,
      refreshExisting,
      tenantId: req.tenantId || req.user?.tenant_id || 'default'
    });
    return res.json({ ok: true, refreshExisting, ...out });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

// 管理端：重算指定「已闭合月份」的累计假期闭合快照（覆盖 system_month_close，保留人工 manual_carryover）。
// 用途：累计假期公式修复后，旧公式在月初锁定的快照仍会被 getLockedOpeningCarryForMonth 取用，需刷新。
app.post('/api/admin/leave-close-snapshot/recompute', authRequired, async (req, res) => {
  if (String(req.user?.role || '') !== 'admin') return res.status(403).json({ error: 'admin_only' });
  const month = safeMonthOnly(req.body?.month || '');
  if (!month) return res.status(400).json({ error: 'missing_month' });
  try {
    const r = await runLeaveCumulativeCloseSnapshotForClosedMonth(month);
    return res.json(r);
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: safeErrMessage(e) });
  }
});


// ─── P0A: 指标版本管理 API ───
app.post('/api/admin/metrics/bump-version', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
  const metricId = String(req.body?.metric_id || '').trim();
  const changes = req.body?.changes || {};
  const changedBy = String(req.user?.username || 'admin');
  if (!metricId) return res.status(400).json({ error: 'missing metric_id' });
  try {
    const result = await updateMetricVersion(metricId, changes, changedBy);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e?.message });
  }
});

app.get('/api/admin/metrics/change-log/:metricId', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'hr_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
  const metricId = String(req.params.metricId || '').trim();
  try {
    const r = await pool.query(
      `SELECT metric_id, name, version, metadata->'change_log' AS change_log, updated_at
       FROM metric_dictionary WHERE metric_id = $1`,
      [metricId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    return res.json(r.rows[0]);
  } catch (e) {
    return res.status(500).json({ error: e?.message });
  }
});

// ─── P1B: Diagnosis 反馈 API ───
app.post('/api/agent/diagnosis-feedback', authRequired, async (req, res) => {
  const userKey = String(req.user?.username || '').toLowerCase();
  const { task_id, feedback, feedback_note } = req.body || {};
  if (!task_id || feedback === undefined) return res.status(400).json({ error: 'missing task_id or feedback' });
  const fb = Number(feedback);
  if (fb !== 0 && fb !== 1) return res.status(400).json({ error: 'feedback must be 0 or 1' });
  try {
    const updated = await pool.query(
      `UPDATE diagnosis_feedback
       SET feedback = $1, feedback_note = $2, updated_at = NOW()
       WHERE task_id = $3 AND user_key = $4 AND tenant_id = $5
       RETURNING id, trace_id, diagnosis, query_text`,
      [fb, String(feedback_note || '').slice(0, 500), task_id, userKey, req.tenantId]
    );
    const row = updated.rows[0];
    if (!row) return res.status(404).json({ error: 'diagnosis_not_found' });
    if (row.trace_id) {
      await recordAiFeedback(pool, {
        traceId: row.trace_id,
        actorId: userKey,
        feedbackType: 'user_rating',
        rating: fb === 1 ? 1 : -1,
        note: feedback_note,
        input: row.query_text || task_id,
        output: row.diagnosis,
        idempotencyKey: `diagnosis:${row.id}`,
        tenantId: req.tenantId,
      });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message });
  }
});

app.get('/api/admin/diagnosis-stats', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(feedback) AS rated,
        ROUND(AVG(CASE WHEN feedback = 1 THEN 100.0 ELSE 0 END), 1) AS like_rate_pct,
        ROUND(AVG(char_count), 0) AS avg_char_count,
        ROUND(AVG(metric_count), 1) AS avg_metric_count
      FROM diagnosis_feedback
      WHERE created_at > NOW() - INTERVAL '30 days' AND tenant_id = $1
    `, [req.tenantId]);
    return res.json(r.rows[0]);
  } catch (e) {
    return res.status(500).json({ error: e?.message });
  }
});


/** 手动触发 sales_raw 目录扫描（需配置 SALES_RAW_IMPORT_DIR） */
app.post('/api/admin/sales-raw/run-folder-import', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await runSalesRawFolderImportOnce();
    return res.json(r);
  } catch (e) {
    void notifyAdminsDualWriteFailure('sales_raw（管理员触发目录导入抛错）', e);
    return res.status(500).json({ error: 'internal_error' });
  }
});


function normalizeStoreKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

function safeDateOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function safeMonthOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  return v;
}

function calcDateSpanDaysInclusive(startDate, endDate) {
  const s = safeDateOnly(startDate);
  const e = safeDateOnly(endDate);
  if (!s || !e) return null;
  const st = new Date(s + 'T00:00:00').getTime();
  const et = new Date(e + 'T00:00:00').getTime();
  if (!Number.isFinite(st) || !Number.isFinite(et) || et < st) return null;
  const days = Math.floor((et - st) / (24 * 60 * 60 * 1000)) + 1;
  return days > 0 ? days : null;
}

function calcOverlapDaysWithinMonth(startDate, endDate, month) {
  const s = safeDateOnly(startDate);
  const e = safeDateOnly(endDate);
  const m = safeMonthOnly(month);
  if (!s || !e || !m) return 0;
  const [yr, mo] = m.split('-').map(Number);
  const monthStart = new Date(yr, mo - 1, 1).getTime();
  const monthEnd = new Date(yr, mo, 0).getTime();
  const st = new Date(s + 'T00:00:00').getTime();
  const et = new Date(e + 'T00:00:00').getTime();
  if (!Number.isFinite(st) || !Number.isFinite(et) || et < st) return 0;
  const overlapStart = Math.max(st, monthStart);
  const overlapEnd = Math.min(et, monthEnd);
  if (overlapEnd < overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / 86400000) + 1;
}

function dailyReportRestStaffForLeaveCalc(staffObj) {
  const so = staffObj && typeof staffObj === 'object' && !Array.isArray(staffObj) ? staffObj : {};
  const lists = [
    Array.isArray(so.restStaff) ? so.restStaff : [],
    Array.isArray(so.frontRestStaff) ? so.frontRestStaff : [],
    Array.isArray(so.kitchenRestStaff) ? so.kitchenRestStaff : []
  ];
  const seen = new Set();
  const out = [];
  for (const arr of lists) {
    for (const it of arr) {
      const u = String(it?.user || it?.username || '').trim().toLowerCase();
      const n = String(it?.name || '').trim();
      const key = u || n.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

function dailyReportHasRestForEmployee(staffObj, unameLower, nameRaw) {
  const uname = String(unameLower || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  if (!uname && !name) return false;
  const restStaff = dailyReportRestStaffForLeaveCalc(staffObj);
  return restStaff.some((it) => {
    const u = String(it?.user || it?.username || '').trim().toLowerCase();
    const n = String(it?.name || '').trim();
    if (u && uname && u === uname) return true;
    if (!u && name && n && n === name) return true;
    return false;
  });
}

// 返回员工当日日报休息「天数」（支持半天 0.5），未命中返回 0。
// 与 dailyReportHasRestForEmployee 的布尔判定一致，但保留 days 精度。
function dailyReportRestDaysForEmployee(staffObj, unameLower, nameRaw) {
  const uname = String(unameLower || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  if (!uname && !name) return 0;
  const restStaff = dailyReportRestStaffForLeaveCalc(staffObj);
  for (const it of restStaff) {
    const u = String(it?.user || it?.username || '').trim().toLowerCase();
    const n = String(it?.name || '').trim();
    if ((u && uname && u === uname) || (!u && name && n && n === name)) {
      const d = Number(it?.days);
      return Number.isFinite(d) && d > 0 ? d : 1;
    }
  }
  return 0;
}

function calcEmployeeMonthlyActualRestFromDailyReports(state, employee, month) {
  const m = safeMonthOnly(month);
  const emp = employee && typeof employee === 'object' ? employee : null;
  const uname = String(emp?.username || '').trim().toLowerCase();
  const name = String(emp?.name || '').trim();
  if (!m || (!uname && !name)) return { total: 0, byDay: {} };

  const reportList = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
  const byDay = {};

  const splitNameTokens = (raw) => String(raw || '')
    .split(/[，,、;；\n\r\t\s\/|]+/)
    .map(x => String(x || '').trim())
    .filter(Boolean);

  const getRestDaysForEmployee = (staffObj) => {
    const so = staffObj && typeof staffObj === 'object' && !Array.isArray(staffObj) ? staffObj : {};
    const lists = [
      Array.isArray(so.restStaff) ? so.restStaff : [],
      Array.isArray(so.frontRestStaff) ? so.frontRestStaff : [],
      Array.isArray(so.kitchenRestStaff) ? so.kitchenRestStaff : []
    ];
    for (const arr of lists) {
      for (const it of arr) {
        const u = String(it?.user || it?.username || '').trim().toLowerCase();
        const n = String(it?.name || '').trim();
        if ((u && uname && u === uname) || (!u && name && n && n === name)) {
          const d = Number(it?.days);
          return Number.isFinite(d) && d > 0 ? d : 1;
        }
      }
    }
    return null;
  };

  reportList.forEach((rep) => {
    const repDate = String(rep?.date || '').trim();
    if (!repDate || !repDate.startsWith(m + '-')) return;
    const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};

    let days = getRestDaysForEmployee(data?.staff);

    // legacy fallback: comma-separated text names
    if (days == null) {
      const frontRest = String(data?.staff?.frontRest || '').trim();
      const kitchenRest = String(data?.staff?.kitchenRest || '').trim();
      const tokens = splitNameTokens(frontRest).concat(splitNameTokens(kitchenRest));
      const tokenSet = new Set(tokens.map(x => x.toLowerCase()));
      const hitByToken = (uname && tokenSet.has(uname)) || (!!name && tokenSet.has(name.toLowerCase()));
      const hitByRaw = (!!name && (frontRest.includes(name) || kitchenRest.includes(name)))
        || (uname && (frontRest.toLowerCase().includes(uname) || kitchenRest.toLowerCase().includes(uname)));
      if (hitByToken || hitByRaw) days = 1;
    }

    if (days != null && days > 0) {
      byDay[repDate] = Number(days);   // 半天休息=0.5，不再硬编码为整天
    }
  });

  const total = Number(Object.values(byDay).reduce((s, x) => {
    const n = Number(x || 0);
    return Number((s + (Number.isFinite(n) ? n : 0)).toFixed(2));
  }, 0).toFixed(2));

  return { total, byDay };
}

function calcCumulativeLeaveDaysByJoinDate(joinDateInput) {
  const joinDate = String(joinDateInput || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) return 0;
  const jd = new Date(joinDate + 'T00:00:00');
  if (!Number.isFinite(jd.getTime())) return 0;
  const years = (Date.now() - jd.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years >= 20) return 15;
  if (years >= 10) return 10;
  if (years >= 1) return 5;
  return 0;
}

function shiftMonth(ym, delta) {
  const m = safeMonthOnly(ym);
  if (!m || !Number.isFinite(Number(delta))) return '';
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + Number(delta), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 打卡时刻在上海时区的「时×60+分」，用于迟到/早退判断 */
function hrmsClockMinutesInShanghai(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return NaN;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const hh = Number(parts.find((x) => x.type === 'hour')?.value);
  const mm = Number(parts.find((x) => x.type === 'minute')?.value);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

/** 打卡记录归属的「上海日历日」YYYY-MM-DD */
function hrmsDateKeyInShanghai(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const gv = (t) => parts.find((x) => x.type === t)?.value || '';
  return `${gv('year')}-${gv('month')}-${gv('day')}`;
}

/**
 * 迟到/早退比对用的门店班次窗口（上海墙钟）。
 * 洪潮大宁久光店：9:15 上班 – 21:00 下班；时段外打卡计迟到/早退。马己仙等未单独配置：9:00–22:00。
 */
function hrmsAttendanceWindowMinutesForStore(storeRaw) {
  const s = String(storeRaw || '').trim();
  const db = getBrandForStoreSync(s, resolveTenantIdDefault());
  if (db && Number.isFinite(db.punchStartMinutes) && Number.isFinite(db.punchEndMinutes)) {
    return { startMinutes: db.punchStartMinutes, endMinutes: db.punchEndMinutes };
  }
  const hongJiuguang = s.includes('洪潮大宁久光')
    || (s.includes('洪潮') && (s.includes('久光') || s.includes('大宁')));
  if (hongJiuguang) return { startMinutes: 9 * 60 + 15, endMinutes: 21 * 60 };
  return { startMinutes: 9 * 60, endMinutes: 22 * 60 };
}

function resolveEmployeeLeaveCalcStartMonth(state, employee, fallbackMonth) {
  const emp = employee && typeof employee === 'object' ? employee : {};
  const uname = String(emp?.username || '').trim().toLowerCase();
  const name = String(emp?.name || '').trim();
  const months = [];

  const reportList = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
  reportList.forEach((rep) => {
    const repDate = String(rep?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(repDate)) return;
    const store = String(rep?.store || '').trim();
    if (!store) return;
    const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};
    const hit = dailyReportHasRestForEmployee(data?.staff, uname, name);
    if (hit) months.push(repDate.slice(0, 7));
  });

  const leaveRecords = Array.isArray(state?.leaveRecords) ? state.leaveRecords : [];
  leaveRecords.forEach((lr) => {
    if (String(lr?.applicant || '').trim().toLowerCase() !== uname) return;
    const sd = String(lr?.startDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) months.push(sd.slice(0, 7));
  });

  const overrides = state?.leaveBalanceOverrides && typeof state.leaveBalanceOverrides === 'object'
    ? state.leaveBalanceOverrides
    : {};
  Object.keys(overrides).forEach((key) => {
    const m = String(key || '').match(/^(.+)_([0-9]{4}-[0-9]{2})$/);
    if (!m) return;
    if (String(m[1] || '').trim().toLowerCase() !== uname) return;
    months.push(String(m[2] || '').trim());
  });

  const clean = months.filter(Boolean).sort();
  return clean[0] || safeMonthOnly(fallbackMonth) || hrmsNowISO().slice(0, 7);
}

/** 与 leaveBalanceOverrides / 审计记录 key 一致：用户名一律小写，避免大小写不一致导致「手动累计假期」未生效 */
function leaveBalanceOverrideKey(username, month) {
  return `${String(username || '').trim().toLowerCase()}_${String(month || '').trim()}`;
}

function getLeaveBalanceOverride(state, username, month) {
  const overrides = state?.leaveBalanceOverrides && typeof state.leaveBalanceOverrides === 'object'
    ? state.leaveBalanceOverrides
    : {};
  const canonical = leaveBalanceOverrideKey(username, month);
  let raw = overrides[canonical];
  if (raw == null) {
    const legacy = `${String(username || '').trim()}_${String(month || '').trim()}`;
    raw = overrides[legacy];
  }
  if (raw == null) return null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const mode = String(raw.mode || '').trim().toLowerCase();
    const value = Number(raw.value);
    if (!Number.isFinite(value)) return null;
    return { mode: mode || 'carryover', value, raw };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return { mode: 'remaining', value, raw };
}

/** 当月已批准休假在月内的天数合计（与薪资/累计假展示口径一致） */
function calcEmployeeMonthlyApprovedLeaveDays(state, employee, month) {
  const m = safeMonthOnly(month);
  const emp = employee && typeof employee === 'object' ? employee : null;
  const uname = String(emp?.username || '').trim().toLowerCase();
  if (!m || !uname) return 0;
  const leaveRecords = Array.isArray(state?.leaveRecords) ? state.leaveRecords : [];
  let usedLeave = 0;
  leaveRecords.forEach((lr) => {
    if (String(lr?.applicant || '').toLowerCase() !== uname) return;
    if (String(lr?.status || '') !== 'approved') return;
    const sd = String(lr?.startDate || '').trim();
    const ed = String(lr?.endDate || '').trim();
    const rawDays = lr?.days != null && lr?.days !== '' ? Number(lr.days) : null;
    const overlapDays = calcOverlapDaysWithinMonth(sd, ed, m);
    let days = 0;
    if (overlapDays > 0) {
      const sameMonthRange = sd.startsWith(m) && ed.startsWith(m);
      days = (sameMonthRange && rawDays != null && Number.isFinite(rawDays) && rawDays > 0)
        ? rawDays
        : overlapDays;
    } else if (rawDays != null && Number.isFinite(rawDays) && rawDays > 0 && sd.startsWith(m)) {
      days = rawDays;
    }
    if (Number.isFinite(days) && days > 0) usedLeave += days;
  });
  return Number(usedLeave.toFixed(2));
}

/**
 * 滚动计算「目标月」月初累计池（不含目标月当月额度与消耗）。
 * @param {{ ignoreEndCarryoverOverride?: boolean }} opts 为 true 时忽略目标月 carryover 人工覆盖（用于次月1日快照，避免把尚未审的覆盖写入上月闭合值）
 */
function calcEmployeeMonthlyCarryover(state, employee, month, opts) {
  const m = safeMonthOnly(month);
  const emp = employee && typeof employee === 'object' ? employee : null;
  const uname = String(emp?.username || '').trim();
  if (!m || !uname) return 0;
  const ignoreEnd = !!(opts && opts.ignoreEndCarryoverOverride);

  const startMonth = resolveEmployeeLeaveCalcStartMonth(state, emp, m);
  let cur = startMonth;
  let carry = 0;
  while (cur && cur < m) {
    // 上月及以前：若该月存在「累计假期（carryover）」手动校准，则以手动值为月初起点，否则沿用滚动计算
    const ov = getLeaveBalanceOverride(state, uname, cur);
    const monthQuota = 4;
    const restInfo = calcEmployeeMonthlyActualRestFromDailyReports(state, emp, cur);
    const usedRest = Number(restInfo?.total || 0);
    const usedLike = Number(usedRest.toFixed(2));
    const startCarry = ov && ov.mode === 'carryover' ? ov.value : carry;
    carry = Number((startCarry + monthQuota - usedLike).toFixed(2));
    cur = shiftMonth(cur, 1);
  }
  // 当月月初累计池：若本月已手动设置「截止上月累计假期」(mode=carryover)，以手动值为准；否则以系统滚动计算为准
  if (!ignoreEnd) {
    const currentOv = getLeaveBalanceOverride(state, uname, m);
    if (currentOv && currentOv.mode === 'carryover') return Number(currentOv.value.toFixed(2));
  }
  return Number(carry.toFixed(2));
}

/** 读取「已闭合月份」上月末累计池快照（次月1日 06:00 上海时区写入） */
function getLeaveCumulativeCloseSnapshot(state, username, closedMonth) {
  const snaps = state?.leaveCumulativeCloseSnapshots && typeof state.leaveCumulativeCloseSnapshots === 'object'
    ? state.leaveCumulativeCloseSnapshots
    : {};
  const k = leaveBalanceOverrideKey(username, closedMonth);
  const raw = snaps[k];
  if (raw == null) return null;
  if (typeof raw === 'object' && raw !== null && Number.isFinite(Number(raw.value))) {
    return { value: Number(raw.value), lockedAt: String(raw.lockedAt || ''), source: String(raw.source || 'system') };
  }
  const v = Number(raw);
  if (Number.isFinite(v)) return { value: v, lockedAt: '', source: 'system' };
  return null;
}

/**
 * 业务口径（与「我的档案」累计假期展示一致）：
 * 1）若当月已有人工 carryover（核实上月末池），以人工为准，且不再回退到公式滚动（当月内固定展示该值）；
 * 2）否则若有「上月」闭合快照（次月1日6点锁定），以快照为准，当月内不随日报回填抖动；
 * 3）否则回退实时滚动计算（新系统或无快照月份）。
 */
function getLockedOpeningCarryForMonth(state, employee, monthM) {
  const m = safeMonthOnly(monthM);
  const emp = employee && typeof employee === 'object' ? employee : null;
  const uname = String(emp?.username || '').trim();
  if (!m || !uname) return 0;
  const oNow = getLeaveBalanceOverride(state, uname, m);
  if (oNow && String(oNow.mode || '').toLowerCase() === 'carryover' && Number.isFinite(Number(oNow.value))) {
    return Number(Number(oNow.value).toFixed(2));
  }
  const prev = shiftMonth(m, -1);
  if (prev) {
    const snap = getLeaveCumulativeCloseSnapshot(state, uname, prev);
    if (snap && Number.isFinite(snap.value)) return Number(snap.value.toFixed(2));
  }
  return Number(calcEmployeeMonthlyCarryover(state, emp, m).toFixed(2));
}

/**
 * 为「已闭合自然月」写入上月末累计池快照（次月 1 日 06:00 上海时区由定时任务调用）。
 * 写入值 = 次月月初池（公式滚动，且忽略次月 carryover 人工覆盖，避免把未审覆盖写进上月闭合快照）。
 */
async function runLeaveCumulativeCloseSnapshotForClosedMonth(closedMonth) {
  const m = safeMonthOnly(closedMonth);
  if (!m) return { ok: false, error: 'bad_month' };
  const nextM = shiftMonth(m, 1);
  if (!nextM) return { ok: false, error: 'bad_next' };

  const state0 = (await getSharedState()) || {};
  const emps = Array.isArray(state0?.employees) ? state0.employees : [];
  const users = Array.isArray(state0?.users) ? state0.users : [];
  const map = new Map();
  users.forEach((u) => {
    const k = String(u?.username || '').trim().toLowerCase();
    if (!k || isLegacyTestUsername(k)) return;
    if (!map.has(k)) map.set(k, { ...u, username: String(u?.username || '').trim() });
  });
  emps.forEach((e) => {
    const k = String(e?.username || '').trim().toLowerCase();
    if (!k || isLegacyTestUsername(k)) return;
    map.set(k, { ...(map.get(k) || {}), ...e, username: String(e?.username || '').trim() });
  });
  const people = Array.from(map.values());

  const prevSnaps = state0.leaveCumulativeCloseSnapshots && typeof state0.leaveCumulativeCloseSnapshots === 'object'
    ? state0.leaveCumulativeCloseSnapshots
    : {};
  const snaps = { ...prevSnaps };
  const lockedAt = hrmsNowISO();
  let n = 0;
  for (const p of people) {
    const uname = String(p?.username || '').trim();
    if (!uname) continue;
    const kk = leaveBalanceOverrideKey(uname, m);
    const prevSnap = prevSnaps[kk];
    if (prevSnap && typeof prevSnap === 'object' && String(prevSnap.source || '') === 'manual_carryover') {
      continue;
    }
    const val = calcEmployeeMonthlyCarryover(state0, p, nextM, { ignoreEndCarryoverOverride: true });
    snaps[kk] = {
      value: Number(Number(val).toFixed(2)),
      lockedAt,
      source: 'system_month_close',
      closedMonth: m
    };
    n++;
  }
  try {
    // 必须用字段级原子合并：saveSharedState 全量写回会与 mergeSharedStateFields（如人工累计假期）并发竞态，导致覆盖丢失
    await mergeSharedStateFields({ leaveCumulativeCloseSnapshots: snaps });
  } catch (e) {
    return { ok: false, error: 'internal_error', closedMonth: m };
  }
  return { ok: true, closedMonth: m, nextMonth: nextM, employees: n };
}

// 考勤缺失扣假规则起始日（含）：2026-06-01 之前不统计
const ATTENDANCE_PENALTY_START_DATE = '2026-06-01';

/**
 * 计算某月「有出勤但缺考勤」的扣假：日报标记上班(work)，但当天缺上班卡或下班卡（任一缺即算缺勤），
 * 每缺勤 1 天扣 1 天休假。返回 Map<usernameLower, { days, details:[{date,days,type,source}] }>。
 * store 仅用于圈定日报台账范围；打卡按 用户+日期 全局匹配（员工打卡归属其本人）。
 */
async function computeAttendanceMissingClockPenalties(month, store, tenantId) {
  const m = safeMonthOnly(month);
  const out = new Map();
  if (!m) return out;
  const [yr, mo] = m.split('-').map(Number);
  const monthStart = `${m}-01`;
  const monthEnd = `${m}-${String(new Date(yr, mo, 0).getDate()).padStart(2, '0')}`;
  const effStart = monthStart > ATTENDANCE_PENALTY_START_DATE ? monthStart : ATTENDANCE_PENALTY_START_DATE;
  if (effStart > monthEnd) return out;
  try {
    const wArgs = [effStart, monthEnd];
    let storeClause = '';
    if (store) { wArgs.push(store); storeClause = ` AND TRIM(store) = TRIM($3::text)`; }
    wArgs.push(tenantId || 'default');
    const workSql = `
      SELECT DISTINCT lower(trim(ld->>'username')) AS u, report_date::text AS d
      FROM daily_report_attendance_register, LATERAL jsonb_array_elements(line_details) ld
      WHERE report_date >= $1::date AND report_date <= $2::date${storeClause}
        AND ld->>'kind' = 'work' AND coalesce(ld->>'username','') <> ''
        AND tenant_id = $${wArgs.length}`;
    const workRows = (await pool.query(workSql, wArgs)).rows || [];
    if (!workRows.length) return out;

    const ciSql = `
      SELECT lower(trim(username)) AS u,
             (timezone('Asia/Shanghai', check_time))::date::text AS d,
             bool_or(type = 'clock_in')  AS has_in,
             bool_or(type = 'clock_out') AS has_out
      FROM checkin_records
      WHERE (timezone('Asia/Shanghai', check_time))::date >= $1::date
        AND (timezone('Asia/Shanghai', check_time))::date <= $2::date
        AND tenant_id = $3
      GROUP BY 1, 2`;
    const ciRows = (await pool.query(ciSql, [effStart, monthEnd, tenantId || 'default'])).rows || [];
    const ciMap = new Map();
    for (const r of ciRows) ciMap.set(`${r.u}||${r.d}`, { has_in: r.has_in === true, has_out: r.has_out === true });

    for (const w of workRows) {
      const ci = ciMap.get(`${w.u}||${w.d}`);
      if (ci && ci.has_in && ci.has_out) continue; // 上下班卡齐全 → 不缺勤
      const miss = !ci ? '无打卡' : (!ci.has_in ? '缺上班卡' : '缺下班卡');
      let entry = out.get(w.u);
      if (!entry) { entry = { days: 0, details: [] }; out.set(w.u, entry); }
      entry.days = Number((entry.days + 1).toFixed(2));
      entry.details.push({ date: w.d, days: 1, type: '考勤缺失扣假', source: `有出勤·${miss}` });
    }
  } catch (e) {
    console.error('[attendance-penalty] compute failed:', e?.message);
  }
  return out;
}

function calcEmployeeMonthlyLeaveBalance(state, employee, month, opts = {}) {
  const m = safeMonthOnly(month);
  const emp = employee && typeof employee === 'object' ? employee : null;
  const uname = String(emp?.username || '').trim();
  if (!m || !uname) return null;

  const [yr, mo] = m.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();

  // Fixed entitlement: 4 rest days per month (not Sunday-count based)
  const MONTHLY_REST_DAYS = 4;
  const weekDetails = [];
  for (let d = 1; d <= daysInMonth; d += 7) {
    const startDay = d;
    const endDay = Math.min(daysInMonth, d + 6);
    // Proportional share of 4 days based on days in this week-segment
    const weekDays = endDay - startDay + 1;
    const entitled = Number((MONTHLY_REST_DAYS * weekDays / daysInMonth).toFixed(2));
    weekDetails.push({
      weekIndex: weekDetails.length + 1,
      range: `${m}-${String(startDay).padStart(2, '0')}~${m}-${String(endDay).padStart(2, '0')}`,
      entitled,
      used: 0,
      remaining: entitled
    });
  }

  const baseLeave = MONTHLY_REST_DAYS;
  const annualLeave = 0;

  // 优先用权威日结果：有按日明细则逐日展示；仅有汇总时回退日报按日明细
  const usedLeaveDetails = [];
  let usedLeave = 0;
  const attDetails = Array.isArray(opts?.attendanceRestDetails) ? opts.attendanceRestDetails : null;
  const attRest = opts && typeof opts === 'object' ? opts.attendanceRestDays : null;

  const addDetailToWeeks = (day, val) => {
    const n = Number(val || 0);
    if (!(Number.isFinite(n) && n > 0)) return;
    weekDetails.forEach((wk) => {
      const [ws, we] = String(wk?.range || '').split('~');
      if (!ws || !we) return;
      if (day < ws || day > we) return;
      wk.used = Number((Number(wk.used || 0) + n).toFixed(2));
    });
  };

  if (attDetails && attDetails.length) {
    for (const d of attDetails) {
      const day = String(d?.date || '').trim().slice(0, 10);
      const n = Number(d?.days);
      if (!day || !(Number.isFinite(n) && n > 0)) continue;
      usedLeaveDetails.push({
        date: day,
        days: n,
        type: String(d?.type || '休息').trim() || '休息',
        source: String(d?.source || '日结果').trim() || '日结果'
      });
      addDetailToWeeks(day, n);
    }
    usedLeave = usedLeaveDetails.reduce((s, x) => s + Number(x.days || 0), 0);
  } else if (attRest != null && Number.isFinite(Number(attRest))) {
    usedLeave = Number(Number(attRest).toFixed(2));
    const restStats = calcEmployeeMonthlyActualRestFromDailyReports(state, emp, m);
    const byDay = restStats?.byDay && typeof restStats.byDay === 'object' ? restStats.byDay : {};
    const dayEntries = Object.entries(byDay);
    if (dayEntries.length) {
      dayEntries.forEach(([day, val]) => {
        const n = Number(val || 0);
        if (!(Number.isFinite(n) && n > 0)) return;
        usedLeaveDetails.push({ date: day, days: n, type: '休息', source: '日报休息' });
        addDetailToWeeks(day, n);
      });
    } else if (usedLeave > 0) {
      usedLeaveDetails.push({ date: m, days: usedLeave, type: '休息', source: '日结果汇总' });
    }
  } else {
    const restStats = calcEmployeeMonthlyActualRestFromDailyReports(state, emp, m);
    usedLeave = Number(restStats?.total || 0);
    Object.entries(restStats?.byDay || {}).forEach(([day, val]) => {
      const n = Number(val || 0);
      if (!(Number.isFinite(n) && n > 0)) return;
      usedLeaveDetails.push({ date: day, days: n, type: '休息', source: '日报休息' });
      addDetailToWeeks(day, n);
    });
  }

  usedLeave = Number((Number(usedLeave || 0)).toFixed(2));

  // 考勤缺失扣假：有出勤(日报上班)但当天缺上班卡或下班卡，每缺勤1天扣1天休假（2026-06起）。
  // 由调用方异步算好后通过 opts.penalty 注入，计入已用假期并在「休息明细」展示。
  const penalty = opts && typeof opts === 'object' ? opts.penalty : null;
  const penaltyDays = Number(penalty?.days || 0);
  if (Number.isFinite(penaltyDays) && penaltyDays > 0) {
    usedLeave = Number((usedLeave + penaltyDays).toFixed(2));
    if (Array.isArray(penalty?.details)) {
      for (const d of penalty.details) usedLeaveDetails.push(d);
    }
  }

  // 月初「累计假期」池：人工 carryover > 上月闭合快照 > 实时滚动（与我的档案、欠休展示一致）
  const cumulativeLeaveDays = getLockedOpeningCarryForMonth(state, emp, m);
  const totalLeave = Number((baseLeave + annualLeave).toFixed(2));
  const monthRemaining = Number((totalLeave - usedLeave).toFixed(2));
  const computedRemaining = Number((cumulativeLeaveDays + totalLeave - usedLeave).toFixed(2));

  const override = getLeaveBalanceOverride(state, uname, m);
  const overridden = !!override;
  const overrideMode = override?.mode || null;
  const overrideValue = override?.value ?? null;
  const carryoverManualLock = !!(override && String(override.mode || '').trim().toLowerCase() === 'carryover');
  let remaining = computedRemaining;
  if (override && String(override.mode || '').trim().toLowerCase() === 'remaining' && Number.isFinite(Number(override.value))) {
    remaining = Number(Number(override.value).toFixed(2));
  }

  const adjustments = Array.isArray(state?.leaveBalanceAdjustments) ? state.leaveBalanceAdjustments : [];
  const overrideKeyNorm = leaveBalanceOverrideKey(uname, m);
  const lastAdjustment = adjustments.find((a) => {
    const k = String(a?.key || '');
    if (k && k.toLowerCase() === overrideKeyNorm) return true;
    const mo = String(a?.month || '').trim();
    const tu = String(a?.targetUsername || '').trim().toLowerCase();
    return mo === m && tu === String(uname || '').trim().toLowerCase();
  }) || null;

  weekDetails.forEach((wk) => {
    wk.remaining = Number((Number(wk.entitled || 0) - Number(wk.used || 0)).toFixed(2));
  });

  return {
    username: uname,
    month: m,
    baseLeave,
    annualLeave: Number(annualLeave.toFixed(2)),
    usedLeave: Number(usedLeave.toFixed(2)),
    totalLeave,
    cumulativeLeaveDays: Number(cumulativeLeaveDays.toFixed(2)),
    monthRemaining,
    computedRemaining,
    remaining: Number(remaining.toFixed(2)),
    overridden,
    overrideValue: overridden ? Number(overrideValue) : null,
    overrideMode: overridden ? overrideMode : null,
    usedLeaveDetails,
    /** 人事已手动校准「截止上月累计假期」：月初池以人工为准，当月内不按公式滚动重算该池（次月1日系统锁数后可对照核验） */
    cumulativeLeaveManualLock: carryoverManualLock,
    weeklyDetails: weekDetails,
    lastAdjustment
  };
}

function safeUuid(input) {
  const v = String(input || '').trim();
  if (!v) return '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return '';
  return v;
}

async function ensureExamResultsTable() {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists exam_results (
        id uuid primary key default gen_random_uuid(),
        assignment_id uuid,
        user_key varchar(100) not null,
        created_at timestamp default current_timestamp,
        started_at timestamp,
        submitted_at timestamp,
        time_used_seconds integer,
        auto_submitted boolean default false,
        set_index integer,
        total integer,
        correct integer,
        score integer,
        answers jsonb
      )`
    );

    // In case an older schema exists, backfill missing columns.
    await pool.query(`alter table exam_results add column if not exists assignment_id uuid`);
    await pool.query(`alter table exam_results add column if not exists user_key varchar(100)`);
    await pool.query(`alter table exam_results add column if not exists created_at timestamp default current_timestamp`);
    await pool.query(`alter table exam_results add column if not exists started_at timestamp`);
    await pool.query(`alter table exam_results add column if not exists submitted_at timestamp`);
    await pool.query(`alter table exam_results add column if not exists time_used_seconds integer`);
    await pool.query(`alter table exam_results add column if not exists auto_submitted boolean default false`);
    await pool.query(`alter table exam_results add column if not exists set_index integer`);
    await pool.query(`alter table exam_results add column if not exists total integer`);
    await pool.query(`alter table exam_results add column if not exists correct integer`);
    await pool.query(`alter table exam_results add column if not exists score integer`);
    await pool.query(`alter table exam_results add column if not exists answers jsonb`);

    const hasUserKey = await hasColumn('exam_results', 'user_key');
    const hasCreatedAt = await hasColumn('exam_results', 'created_at');
    const hasAssignmentId = await hasColumn('exam_results', 'assignment_id');

    if (hasUserKey && hasCreatedAt) {
      await pool.query(
        `create index if not exists idx_exam_results_user_key_created_at
         on exam_results (user_key, created_at desc)`
      );
    }
    if (hasAssignmentId) {
      await pool.query(
        `create index if not exists idx_exam_results_assignment_id
         on exam_results (assignment_id)`
      );
    }
  } catch (e) {
    console.error('ensureExamResultsTable failed:', e);
  }
}

function getOssClient() {
  return null;
}

function getCosClient() {
  if (!COS_SECRET_ID || !COS_SECRET_KEY || !COS_BUCKET || !COS_REGION) return null;
  return new COS({
    SecretId: COS_SECRET_ID,
    SecretKey: COS_SECRET_KEY
  });
}

function buildCosPublicUrl(objectKey) {
  const key = String(objectKey || '').replace(/^\/+/, '');
  if (!key) return '';
  const base = String(COS_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (base) return `${base}/${key}`;
  if (!COS_BUCKET || !COS_REGION) return '';
  return `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${key}`;
}

function buildOssPublicUrl(objectKey) {
  return '';
}

function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(String(str || ''))
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/g, (m) => m.toLowerCase());
}

function buildInlineContentDisposition(filename) {
  const name = String(filename || '').trim() || 'file';
  const encoded = encodeRFC5987ValueChars(name);
  return `inline; filename*=UTF-8''${encoded}`;
}

function inferContentType({ declaredType, originalName, mimeType }) {
  const t = String(declaredType || '').trim().toLowerCase();
  const orig = String(originalName || '').trim();
  const ext = path.extname(orig).toLowerCase();
  const mt = String(mimeType || '').trim().toLowerCase();

  if (mt && mt !== 'application/octet-stream') return mt;

  if (t === 'pdf' || ext === '.pdf') return 'application/pdf';
  if (t === 'video' || ext === '.mp4') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (t === 'img' || ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';

  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  return 'application/octet-stream';
}

function requireEnv() {
  const missing = [];
  if (!DATABASE_URL) missing.push('DATABASE_URL');
  if (!JWT_SECRET) missing.push('JWT_SECRET');
  return missing;
}

async function loadTenantRuntimeStatus(tenantId) {
  return loadTenantRuntimeStatusFromModule(pool, tenantId);
}

async function authRequired(req, res, next) {
  // 企业微信「接收消息」回调为无 token 公开端点（靠签名+AES 解密自证），放行
  if (String(req.originalUrl || '').split('?')[0] === '/api/wecom/callback') return next();
  if (String(req.originalUrl || '').split('?')[0] === '/api/wecom/kf/callback') return next();
  const hdr = String(req.headers.authorization || '');
  let token = hdr.startsWith('Bearer ') ? String(hdr.slice(7) || '').trim() : '';
  // 部分移动端 WebView 在 multipart/form-data 上传时可能丢失 Authorization；允许 query 兜底（与 FormData 同发）
  if (!token) {
    try {
      token = String(req.query?.access_token || req.query?.token || '').trim();
    } catch (e) {
      token = '';
    }
  }
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  if (!JWT_SECRET) return res.status(500).json({ error: 'server_config_error' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    // 旧token(改造前签发)没有tenant_id字段，兜底归入default租户，保持现有行为不变。
    req.tenantId = String(payload.tenant_id || 'default').trim() || 'default';

    // 用 AsyncLocalStorage 把租户上下文挂到本次请求的整条异步调用链上，
    // 让 getSharedState()/saveSharedState() 等未显式传tenantId的历史调用点也能拿到正确租户。
    return await tenantContext.run(req.tenantId, async () => {
    // Single-device login: validate session nonce
    const nonce = String(payload.sn || '').trim();
    const uname = String(payload.username || '').trim();
    if (nonce && uname) {
      try {
        const r = await pool.query(
          'select session_nonce from user_sessions where lower(username) = lower($1) and tenant_id = $2 limit 1',
          [uname, req.tenantId]
        );
        const stored = String(r.rows?.[0]?.session_nonce || '').trim();
        if (stored && stored !== nonce) {
          return res.status(401).json({ error: 'session_replaced', message: '您的账号已在其他设备登录，当前会话已失效' });
        }
      } catch (e) {
        // DB error: allow through to avoid blocking all requests
      }
    }

    try {
      await assertEmployeeLoginAllowedByState(uname);
    } catch (e) {
      if (e && e.statusCode === 403) {
        return res.status(403).json({ error: 'account_disabled', message: '账号已停用或已离职' });
      }
    }

    try {
      let effectiveRole = String(payload.role || '').trim();
      try {
        const dbRoleRow = await pool.query(
          'SELECT role FROM users WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1',
          [uname, req.tenantId]
        );
        const dbRole = String(dbRoleRow.rows?.[0]?.role || '').trim();
        if (dbRole) effectiveRole = dbRole;
      } catch (_e) { /* ignore */ }

      const state0 = (await getSharedState().catch(() => null)) || {};
      const stateStore = String(pickMyStoreFromState(state0, uname) || payload.store || '').trim();
      const ctx = await getUserStoreAccessContext(uname, effectiveRole, {
        requestedStore: payload.current_store || stateStore,
        stateStore
      });
      req.user = {
        ...payload,
        role: effectiveRole,
        store: stateStore,
        primary_store: ctx.primaryStore,
        current_store: ctx.currentStore,
        allowed_stores: ctx.allowedStores
      };
    } catch (_e) {
      req.user = payload;
    }

    next();
    });
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

async function authRequiredOrQueryToken(req, res, next) {
  const hdr = String(req.headers.authorization || '');
  let token = hdr.startsWith('Bearer ') ? String(hdr.slice(7) || '').trim() : '';
  if (!token) {
    try {
      token = String(req.query?.token || req.query?.access_token || '').trim();
    } catch (e) {
      token = '';
    }
  }
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  if (!JWT_SECRET) return res.status(500).json({ error: 'server_config_error' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    req.tenantId = String(payload.tenant_id || 'default').trim() || 'default';
    return await tenantContext.run(req.tenantId, async () => {
    const nonce = String(payload.sn || '').trim();
    const uname = String(payload.username || '').trim();
    if (nonce && uname) {
      try {
        const r = await pool.query(
          'select session_nonce from user_sessions where lower(username) = lower($1) and tenant_id = $2 limit 1',
          [uname, req.tenantId]
        );
        const stored = String(r.rows?.[0]?.session_nonce || '').trim();
        if (stored && stored !== nonce) {
          return res.status(401).json({ error: 'session_replaced', message: '您的账号已在其他设备登录，当前会话已失效' });
        }
      } catch (e) {
        // DB error: allow through
      }
    }
    try {
      await assertEmployeeLoginAllowedByState(uname);
    } catch (e) {
      if (e && e.statusCode === 403) {
        return res.status(403).json({ error: 'account_disabled', message: '账号已停用或已离职' });
      }
    }
    try {
      let effectiveRole = String(payload.role || '').trim();
      try {
        const dbRoleRow = await pool.query(
          'SELECT role FROM users WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1',
          [uname, req.tenantId]
        );
        const dbRole = String(dbRoleRow.rows?.[0]?.role || '').trim();
        if (dbRole) effectiveRole = dbRole;
      } catch (_e) { /* ignore */ }

      const state0 = (await getSharedState().catch(() => null)) || {};
      const stateStore = String(pickMyStoreFromState(state0, uname) || payload.store || '').trim();
      const ctx = await getUserStoreAccessContext(uname, effectiveRole, {
        requestedStore: payload.current_store || stateStore,
        stateStore
      });
      req.user = {
        ...payload,
        role: effectiveRole,
        store: stateStore,
        primary_store: ctx.primaryStore,
        current_store: ctx.currentStore,
        allowed_stores: ctx.allowedStores
      };
    } catch (_e) {
      req.user = payload;
    }
    return next();
    });
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

// users 表 role 列有 CHECK 约束，只允许 admin/hq_manager/store_manager/hq_employee/store_employee 5种，
// normalizeRoleForJwt() 的输出可能是 cashier/hr_manager 等更细的角色（登录时另外从 hrms_state 同步真实权限），
// 写 users 表时需要先收窄到约束允许的范围，避免 INSERT 因 CHECK 失败。
function normalizeUsersTableRole(input) {
  const jwtRole = normalizeRoleForJwt(input);
  const allowed = ['admin', 'hq_manager', 'store_manager', 'hq_employee', 'store_employee'];
  if (allowed.includes(jwtRole)) return jwtRole;
  return 'store_employee';
}

function normalizeRoleForJwt(input) {
  const v = String(input || '').trim();
  if (!v) return 'store_employee';
  const allowed = ['admin', 'hq_manager', 'store_manager', 'store_employee', 'cashier', 'hr_manager', 'store_production_manager', 'front_manager'];
  if (allowed.includes(v)) return v;
  // Map known Chinese/custom role names to standard codes（与前端 hrmsNormalizeRoleCode 对齐，避免 JWT 为 custom_管理员 时服务端仍按非 admin 处理）
  const map = {
    管理员: 'admin',
    系统管理员: 'admin',
    custom_管理员: 'admin',
    custom_系统管理员: 'admin',
    总部管理层: 'hq_manager',
    总部经理: 'hq_manager',
    custom_总部经理: 'hq_manager',
    custom_总部营运: 'hq_manager',
    custom_总部管理层: 'hq_manager',
    总部营运: 'hq_manager',
    总部人员: 'hr_manager',
    总部人事: 'hr_manager',
    custom_总部人员: 'hr_manager',
    custom_总部人事: 'hr_manager',
    custom_人事经理: 'hr_manager',
    人事经理: 'hr_manager',
    出纳: 'cashier',
    总部出纳: 'cashier',
    custom_出纳: 'cashier',
    门店店长: 'store_manager',
    店长: 'store_manager',
    custom_门店店长: 'store_manager',
    custom_店长: 'store_manager',
    门店出品经理: 'store_production_manager',
    出品经理: 'store_production_manager',
    custom_门店出品经理: 'store_production_manager',
    custom_出品经理: 'store_production_manager',
    store_product_manager: 'store_production_manager',
    门店员工: 'store_employee',
    员工: 'store_employee'
  };
  if (map[v]) return map[v];
  if (v.startsWith('custom_')) {
    const raw = v.slice(7);
    if (map[raw]) return map[raw];
    if (/管理员/.test(raw)) return 'admin';
    if (/总部|营运/.test(raw)) return 'hq_manager';
    if (/人事|hr/i.test(raw)) return 'hr_manager';
    if (/店长/.test(raw)) return 'store_manager';
    if (/出品/.test(raw)) return 'store_production_manager';
    if (/出纳|财务/.test(raw)) return 'cashier';
    return 'store_employee';
  }
  return map[v] || v;
}

function isInactiveStatus(input) {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return false;
  return ['inactive', 'disabled', 'disable', 'off', '0', 'resigned', 'leave', 'left', '离职', '禁用', '停用'].includes(v);
}

/** 上海时区当天 YYYY-MM-DD（与 safeDateOnly / offboarding 日期比较口径一致） */
function shanghaiTodayDateOnly() {
  return shanghaiDateOnly(new Date());
}

/**
 * 是否应对该员工关闭 HRMS 登录与飞书侧绑定（含：档案为离职类 / 离职审批已通过）
 */
function employeeAccountShouldDisable(emp) {
  if (!emp || typeof emp !== 'object') return false;
  if (isInactiveStatus(emp.status)) return true;
  const ob =
    emp.offboardingApproved === true
    || String(emp.offboardingApproved || '').trim().toLowerCase() === 'true'
    || String(emp.offboardingApproved || '').trim() === '1';
  if (ob) {
    const obDate = String(emp.offboardingDate || emp.extra_json?.offboardingDate || '').trim().slice(0, 10);
    if (obDate) {
      const today = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
      if (obDate > today) return false;
    }
    return true;
  }
  return false;
}

/**
 * 根据员工档案同步：PostgreSQL users.is_active、飞书 feishu_users.registered、并作废现有 JWT（换 session nonce）
 * 在 mergeSharedStateFields(employees)、PUT /api/state、离职定时任务等路径调用。
 */
async function applyHrmsUserAccountGateFromEmployee(emp) {
  const uname = String(emp?.username || '').trim();
  if (!uname || !DATABASE_URL) return;
  const disable = employeeAccountShouldDisable(emp);
  try {
    // 调用方有HTTP路由(已有ALS)也有定时任务(没有)，函数内部自己反查真实租户并
    // tenantContext.run()包裹，不依赖调用方是否已设好上下文。
    let tenantId = 'default';
    try {
      const tr = await pool.query('SELECT tenant_id FROM users WHERE lower(username) = lower($1) LIMIT 1', [uname]);
      tenantId = String(tr.rows?.[0]?.tenant_id || '').trim() || 'default';
    } catch (_e) { /* ignore */ }
    await tenantContext.run(tenantId, async () => {
    if (disable) {
      await pool.query(
        'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE lower(username) = lower($1)',
        [uname]
      );
      await pool.query(
        'UPDATE feishu_users SET registered = FALSE, updated_at = NOW() WHERE lower(username) = lower($1)',
        [uname]
      );
      const sn = randomUUID().replace(/-/g, '').slice(0, 16);
      await storeSessionNonce(uname, sn);
    } else {
      await pool.query(
        'UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE lower(username) = lower($1)',
        [uname]
      );
      await pool.query(
        `UPDATE feishu_users
            SET registered = TRUE,
                role = $2,
                store = $3,
                name = $4,
                updated_at = NOW()
          WHERE lower(username) = lower($1)`,
        [uname, String(emp.role || ''), String(emp.store || ''), String(emp.name || '')]
      );
    }
    });
  } catch (e) {
    console.error('[account-gate]', uname, disable ? 'disable' : 'enable', e?.message || e);
  }
}

async function assertEmployeeLoginAllowedByState(username) {
  const un = String(username || '').trim();
  if (!un) return;
  const st = (await getSharedState().catch(() => null)) || {};
  const rec = stateFindUserRecord(st, un);
  if (!rec) return;
  if (employeeAccountShouldDisable(rec)) {
    const err = new Error('account_disabled');
    err.statusCode = 403;
    throw err;
  }
}

// ─── Garbled UTF-8 repair (mojibake: UTF-8 bytes mis-decoded as Latin-1) ─────
function repairGarbledUtf8(str) {
  if (typeof str !== 'string' || str.length < 2) return str;
  // Quick check: must contain high Latin-1 chars (0xC0-0xFF) typical of mojibake
  if (!/[\u00c0-\u00ff]/.test(str)) return str;
  try {
    const bytes = Buffer.from(str, 'latin1');
    const decoded = bytes.toString('utf8');
    // Valid repair if result contains CJK chars and no replacement chars
    if (/[\u4e00-\u9fff]/.test(decoded) && !decoded.includes('\ufffd')) return decoded;
  } catch (e) { /* ignore */ }
  return str;
}

function deepRepairGarbledStrings(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return repairGarbledUtf8(obj);
  if (Array.isArray(obj)) return obj.map(deepRepairGarbledStrings);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      out[repairGarbledUtf8(k)] = deepRepairGarbledStrings(obj[k]);
    }
    return out;
  }
  return obj;
}

/** GET /api/state 时非 admin 不返回 employees/users 中的明文 password（仅系统管理员可拉取完整副本）。 */
function stripPasswordFieldsFromStateForClient(data, role) {
  if (!data || typeof data !== 'object') return data;
  if (normalizeRoleForJwt(String(role || '').trim()) === 'admin') return data;
  try {
    const clone = JSON.parse(JSON.stringify(data));
    const wipe = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const it of arr) {
        if (it && typeof it === 'object' && Object.prototype.hasOwnProperty.call(it, 'password')) {
          it.password = '';
        }
      }
    };
    wipe(clone.employees);
    wipe(clone.users);
    return clone;
  } catch (_e) {
    return data;
  }
}

function hrmsNormStoreName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** 与前端员工列表一致：离职 / 停用等不在非管理员接口中返回。 */
function hrmsIsInactiveEmploymentRecord(row) {
  const raw = String(row?.status || '').trim();
  if (!raw) return false;
  const st = raw.toLowerCase();
  if (['inactive', 'resigned', 'terminated', 'deleted', 'left', 'departed'].includes(st)) return true;
  if (/离职|离岗|离退|已删除|已离职|停职|停用/.test(raw)) return true;
  return false;
}

/**
 * 裁剪 state 中的 employees / users：
 * - 仅 admin 可看到离职等停用记录；
 * - 店长仅能看到本店（与自身档案或 feishu_users 门店一致）的在册人员。
 */
async function applyStatePeopleVisibilityForRole(data, role, username, fullStateForLookup, requestedStore) {
  if (!data || typeof data !== 'object') return data;
  const r = normalizeRoleForJwt(String(role || '').trim());
  if (r === 'admin') return data;

  const rawEmps = Array.isArray(data.employees) ? data.employees : [];
  const rawUsers = Array.isArray(data.users) ? data.users : [];
  const lookupAll = []
    .concat(Array.isArray(fullStateForLookup?.employees) ? fullStateForLookup.employees : [])
    .concat(Array.isArray(fullStateForLookup?.users) ? fullStateForLookup.users : []);
  const un = String(username || '').trim().toLowerCase();

  // 用完整名册解析 managerUsername -> managerName，避免门店账号因人员可见性过滤
  // 拿不到总部上级记录时，「我的档案」直属上级只能显示账号代码。
  const nameByUsername = new Map();
  for (const x of lookupAll) {
    const ku = String(x?.username || '').trim().toLowerCase();
    const nm = String(x?.name || '').trim();
    if (ku && nm && !nameByUsername.has(ku)) nameByUsername.set(ku, nm);
  }
  const withMgrName = (row) => {
    if (!row || typeof row !== 'object') return row;
    if (String(row.managerName || '').trim()) return row;
    const mu = String(row.managerUsername || row.manager || '').trim().toLowerCase();
    const nm = mu ? nameByUsername.get(mu) : '';
    return nm ? { ...row, managerName: nm } : row;
  };
  const empsOut = rawEmps.map(withMgrName);
  const usersOut = rawUsers.map(withMgrName);

  let storeScope = null;
  let allowedStores = null;
  if (r === 'store_manager' || r === 'front_manager') {
    const self = lookupAll.find((x) => String(x?.username || '').trim().toLowerCase() === un);
    const stateStore = hrmsNormStoreName(self?.store);
    const ctx = await getUserStoreAccessContext(username, r, {
      requestedStore,
      stateStore
    });
    storeScope = hrmsNormStoreName(ctx.currentStore || stateStore);
    allowedStores = new Set((ctx.allowedStores || []).map((item) => hrmsNormStoreName(item)).filter(Boolean));
  }

  const pass = (row) => {
    if (hrmsIsInactiveEmploymentRecord(row)) return false;
    // Always include the current user's own record regardless of store scope
    if (String(row?.username || '').trim().toLowerCase() === un) return true;
    const rowStore = hrmsNormStoreName(row?.store);
    // 多店兼管（如洪潮店长同时"监管"马己仙门店的 duty binding）时 allowedStores 已包含全部
    // 授权门店；此前额外要求 rowStore === storeScope(主店) 会把非主店的授权门店过滤掉，
    // 导致兼管者在带教人下拉等场景里完全看不到自己有权限的另一家店的员工。
    if (allowedStores && allowedStores.size > 0) return allowedStores.has(rowStore);
    if (storeScope) return rowStore === storeScope;
    return true;
  };

  if ((r === 'store_manager' || r === 'front_manager') && !storeScope) {
    const keepSelf = (row) => String(row?.username || '').trim().toLowerCase() === un;
    return {
      ...data,
      employees: empsOut.filter((row) => keepSelf(row) && !hrmsIsInactiveEmploymentRecord(row)),
      users: usersOut.filter((row) => keepSelf(row) && !hrmsIsInactiveEmploymentRecord(row))
    };
  }

  // Look up the requesting user's authoritative role from the users table.
  // hrms_state.employees role can be stale (overwritten by admin saves); the users table is the source of truth.
  let dbRole = null;
  try {
    const dbRow = await pool.query('SELECT role FROM users WHERE lower(username) = lower($1) LIMIT 1', [un]);
    dbRole = String(dbRow.rows?.[0]?.role || '').trim() || null;
  } catch (_e) { /* ignore */ }

  const filteredEmps = empsOut.filter(pass);
  const filteredUsers = usersOut.filter(pass);

  if (dbRole) {
    return {
      ...data,
      employees: filteredEmps.map(emp =>
        String(emp?.username || '').trim().toLowerCase() === un ? { ...emp, role: dbRole } : emp
      ),
      users: filteredUsers.map(u =>
        String(u?.username || '').trim().toLowerCase() === un ? { ...u, role: dbRole } : u
      )
    };
  }

  return { ...data, employees: filteredEmps, users: filteredUsers };
}

app.get('/api/state', authRequired, async (req, res) => {
  try {
    const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
    const r = await pool.query('select data from hrms_state where key = $1 limit 1', [tenantIdQ]);
    const row = r.rows?.[0] || null;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const data = row.data;
    // Auto-repair garbled UTF-8 strings and persist if changed
    const repaired = deepRepairGarbledStrings(data);
    const origJson = JSON.stringify(data);
    const repairedJson = JSON.stringify(repaired);
    if (origJson !== repairedJson) {
      console.log('[state] Auto-repaired garbled UTF-8 strings in shared state');
      try {
        await pool.query(
          `update hrms_state set data = $1::jsonb, updated_at = now() where key = $2`,
          [repairedJson, tenantIdQ]
        );
      } catch (saveErr) {
        console.error('[state] Failed to persist repaired state:', saveErr?.message || saveErr);
      }
    }
    // 积分/薪资/员工/流程配置/通知/考试成绩以表为权威，覆盖 state 镜像
    let hydrated = await hydrateStateFromAuthoritativeTables(pool, repaired, tenantIdQ);
    hydrated = await hydrateEmployeesFromTable(pool, hydrated, tenantIdQ);
    hydrated = await hydrateFlowConfigFromTable(pool, hydrated, tenantIdQ);
    hydrated = await hydrateNotificationsFromTable(pool, hydrated, tenantIdQ);
    hydrated = await hydrateExamResultsFromTable(pool, hydrated, tenantIdQ);
    const role = String(req.user?.role || '').trim();
    const uname = String(req.user?.username || '').trim();
    let payload = stripPasswordFieldsFromStateForClient(hydrated, role);
    payload = await applyStatePeopleVisibilityForRole(payload, role, uname, hydrated, req.user?.current_store);
    return res.json({ data: payload });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

/** 管理员查看某账号当前登录密码明文（优先 employees 表，其次 state 镜像）。 */
app.get('/api/admin/employee-password/:username', authRequired, async (req, res) => {
  if (normalizeRoleForJwt(String(req.user?.role || '')) !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: '仅系统管理员可查看密码' });
  }
  const un = String(req.params.username || '').trim().toLowerCase();
  if (!un) return res.status(400).json({ error: 'missing_username' });
  try {
    const tid = req.tenantId || req.user?.tenant_id || 'default';
    const tableEmps = await loadEmployeesFromTable(pool, tid);
    const emp = tableEmps.find((e) => String(e?.username || '').trim().toLowerCase() === un);
    if (emp) {
      return res.json({ username: String(req.params.username || '').trim(), password: String(emp.password || '').trim() });
    }
    const state = (await getSharedState(tid)) || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const users = Array.isArray(state.users) ? state.users : [];
    const empS = employees.find((e) => String(e?.username || '').trim().toLowerCase() === un);
    const usr = users.find((u) => String(u?.username || '').trim().toLowerCase() === un);
    const password = String(empS?.password ?? usr?.password ?? '').trim();
    return res.json({ username: String(req.params.username || '').trim(), password });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.put('/api/state', authRequired, async (req, res) => {
  if (String(req.user?.role || '') !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const rawData = req.body?.data;
  if (!rawData || typeof rawData !== 'object') {
    return res.status(400).json({ error: 'missing_data' });
  }
  // Auto-repair garbled UTF-8 before persisting
  const repaired = deepRepairGarbledStrings(rawData);
  try {
    // 白名单写入：以服务端 existing 为底，仅 overlay STATE_PUT_WHITELIST 字段。
    // 禁止再靠「黑名单保护块」拦字段——漏一个就事故一次（请款模块消失 / 审批流乱 / 积分被抹）。
    const existingState = (await getSharedState()) || {};
    const { next: data, ignoredKeys } = applyStatePutWhitelist(existingState, repaired);
    if (ignoredKeys.length) {
      console.warn('[state] PUT ignored non-whitelist keys:', ignoredKeys.slice(0, 30).join(','));
    }
    await pool.query(
      `insert into hrms_state (key, data, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set data = excluded.data, updated_at = now()`,
      [resolveTenantIdDefault(), JSON.stringify(data)]
    );
    // A1：employees 已移出 PUT 白名单，不再从 PUT /api/state 双写员工表
    setImmediate(async () => {
      try {
        await upsertPayrollDomainFromState(data);
      } catch (e) {
        console.error('[hrms_payroll_domain] PUT /api/state sync failed (non-fatal):', e?.message);
        void notifyAdminsDualWriteFailure('hrms_payroll_domain（PUT /api/state）', e);
      }
    });
    // users 数组仍可能经 PUT 写入；employees 账号门控改由窄 API / mergeSharedStateFields 负责
    setImmediate(async () => {
      try {
        const emps = Array.isArray(data.employees) ? data.employees : [];
        for (const emp of emps) {
          const uname = String(emp?.username || '').trim();
          if (!uname) continue;
          try {
            await applyHrmsUserAccountGateFromEmployee(emp);
          } catch (e) {
            console.error('[state][account-gate]', uname, e?.message || e);
          }
        }
      } catch (syncErr) {
        console.error('[state] account gate sync error:', syncErr?.message);
      }
    });
    return res.json({ ok: true, ignoredKeys });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.get('/api/promotion/tracks', authRequired, async (req, res) => {
  const username = String(req.user?.username || '').trim();
  const role = String(req.user?.role || '').trim();
  if (!username) return res.status(400).json({ error: 'missing_user' });
  try {
    const state = (await getSharedState()) || {};
    const list = Array.isArray(state.promotionTracks) ? state.promotionTracks.slice() : [];
    let items = list;
    if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager')) {
      items = list.filter(t => {
        const applicant = String(t?.applicantUsername || '').trim();
        const mentor = String(t?.mentorUsername || '').trim();
        const store = String(t?.store || '').trim();
        const mine = stateFindUserRecord(state, username) || {};
        const myStore = String(mine?.store || '').trim();
        const myRole = String(mine?.role || role || '').trim();
        const storeManagerMatch = myRole === 'store_manager' && myStore && store === myStore;
        const prodManagerMatch = myRole === 'store_production_manager' && myStore && store === myStore;
        return applicant === username || mentor === username || storeManagerMatch || prodManagerMatch;
      });
    }
    items.sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));

    // 唯一渠道：考核结果由系统根据培训认证进度自动判定，去掉人工考核环节
    items = await Promise.all(items.map(async (t) => {
      if (!Array.isArray(t?.requiredTopicIds)) return t;
      const progress = await getPromotionTrackProgress(t.applicantUsername, t.requiredTopicIds);
      return { ...t, trainingProgress: progress, assessmentStatus: progress.passed ? 'passed' : 'pending' };
    }));

    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

// ── Bitable Sync Status (for 数据中心 dashboard) ──
const BITABLE_TABLE_NAMES = {
  'tblpx5Efqc6eHo3L': '桌访表',
  'tblz4kW1cY22XRlL': '马己仙原料收货日报',
  'tblZXgaU0LpSye2m': '例会报告',
  'tbl32E6d0CyvLvfi': '开档报告',
  'tblgReexNjWJOJB6': '差评报告DB',
  'tbllcV1evqTJyzlN': '洪潮原料收货日报',
  'tblXYfSBRrgNGohN': '收档报告DB',
  'tblLCxLO0ZbV7uyo': '报损单',
  'tblxHI9ZAKONOTpp': '运营检查表(含开收档)',
  'tblT86H1uuTJydne': '异常任务回复',
  /** 实际毛利率多维表（线上表 ID 可能为 I 或 l，兼容两种） */
  'tbl4RTo9ZVTxlpLw': '实际毛利率（飞书多维表）',
  'tbl4RTo9ZVTxIpLw': '实际毛利率（飞书多维表）'
};

function bitableSyncDisplayName(tableId) {
  const id = String(tableId || '').trim();
  if (!id) return '—';
  if (BITABLE_TABLE_NAMES[id]) return BITABLE_TABLE_NAMES[id];
  if (/^tbl[A-Za-z0-9]{10,}$/.test(id)) {
    return `飞书多维表（未登记中文名｜${id}）`;
  }
  return id;
}

app.get('/api/agents/bitable-sync', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'hr_manager', 'store_manager', 'front_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await pool.query(
      `SELECT table_id, COUNT(*) as cnt, MAX(updated_at) as last_sync FROM feishu_generic_records WHERE tenant_id = $1 GROUP BY table_id ORDER BY last_sync DESC`,
      [req.tenantId || req.user?.tenant_id || 'default']
    );
    const items = (r.rows || []).map(row => ({
      tableId: row.table_id,
      name: bitableSyncDisplayName(row.table_id),
      count: Number(row.cnt),
      lastSync: row.last_sync
    }));
    return res.json({ items });
  } catch (e) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

/** 与 agents-service-v2 /health 对齐；生产在 .env 设置 AGENTS_SERVICE_HEALTH_URL=http://127.0.0.1:3101/health */
async function fetchAgentsServiceHealthSnapshot() {
  const raw = String(process.env.AGENTS_SERVICE_HEALTH_URL || '').trim();
  if (!raw) return null;
  try {
    const r = await axios.get(raw, { timeout: 4500, validateStatus: () => true });
    if (r.status !== 200 || r.data == null) {
      return { ok: false, httpStatus: r.status, error: 'agents health non-200 or empty' };
    }
    return r.data;
  } catch (e) {
    return { ok: false, error: 'internal_error' };
  }
}

function getAgentsServiceBaseUrl() {
  return String(process.env.AGENTS_SERVICE_BASE_URL || 'http://127.0.0.1:3101').trim().replace(/\/$/, '');
}

/** 避免同一页面并发 summary+tasks 各打一次 agents /api/login 触发竞态或短时过载 */
let __agentsAdminJwCache = { token: '', expiresAt: 0 };

async function getAgentsServiceAdminToken() {
  const now = Date.now();
  if (__agentsAdminJwCache.token && __agentsAdminJwCache.expiresAt > now) {
    return __agentsAdminJwCache.token;
  }
  const url = getAgentsServiceBaseUrl() + '/api/login';
  const username = String(process.env.AGENTS_ADMIN_USERNAME || 'admin').trim() || 'admin';
  const password = String(process.env.AGENTS_ADMIN_PASSWORD || '').trim();
  if (!password) {
    throw new Error('AGENTS_ADMIN_PASSWORD environment variable is required for hrms-server to authenticate with agents-service-v2');
  }
  const r = await axios.post(url, { username, password }, {
    timeout: 8000,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json' }
  });
  if (r.status < 200 || r.status >= 300 || !r.data?.token) {
    const detail = typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data || '');
    throw new Error(`agents_service_login_failed:${r.status}:${detail}`);
  }
  const token = String(r.data.token);
  __agentsAdminJwCache = { token, expiresAt: now + 45000 };
  return token;
}

function canManageChairmanConfig(user) {
  const role = String(user?.role || '').trim();
  return role === 'admin' || role === 'hq_manager' || role === 'hr_manager';
}

app.get('/api/chairman/config', authRequired, async (req, res) => {
  if (!canManageChairmanConfig(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const url = getAgentsServiceBaseUrl() + '/api/chairman/config';
    const token = await getAgentsServiceAdminToken();
    const r = await axios.get(url, {
      timeout: 8000,
      validateStatus: () => true,
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status || 502).json(r.data || { error: 'chairman_config_proxy_failed' });
    }
    return res.json(r.data || { ok: true, config: {} });
  } catch (e) {
    return res.status(502).json({ error: 'internal_error' });
  }
});

app.post('/api/chairman/config', authRequired, async (req, res) => {
  if (!canManageChairmanConfig(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const url = getAgentsServiceBaseUrl() + '/api/chairman/config';
    const token = await getAgentsServiceAdminToken();
    const r = await axios.post(url, req.body || {}, {
      timeout: 10000,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status || 502).json(r.data || { error: 'chairman_config_proxy_failed' });
    }
    return res.json(r.data || { ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'internal_error' });
  }
});

// ═══════════════════════════════════════════════════════
// 任务和绩效 — 租户自助配置代理（原agents-admin控制台 #performance / #scheduled 的租户前端入口）
// 复用 /api/chairman/config 同款代理模式：HRMS后端持service token代租户用户调agents-service-v2的
// 通用配置API，agents-service-v2侧已按tenant_id隔离（当前单租户，行为等价于原全局配置）。
// ═══════════════════════════════════════════════════════
const TENANT_SETTINGS_ALLOWED_KEYS = new Set(['performance_eval', 'rhythm_schedule', 'daily_inspections', 'labor_cost_targets', 'random_inspections']);

function canManageTenantSettings(user) {
  const role = String(user?.role || '').trim();
  return role === 'admin' || role === 'hq_manager' || role === 'hr_manager';
}

// ─── 目标管理：通用KPI目标（门店/品牌/公司级，任意metric_key），供"任务和绩效"页面增删改 ───
// 必须注册在 /api/tenant-settings/:key 之前，否则会被 :key 抢先匹配成 unknown_settings_key → HTTP 400。
// 复用agents-service-v2既有的/api/kpi/targets CRUD（kpi_targets表已tenant_id隔离）。
app.get('/api/tenant-settings/kpi-targets', authRequired, async (req, res) => {
  if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const token = await getAgentsServiceAdminToken();
    const qs = new URLSearchParams();
    ['store', 'brand', 'metric_key'].forEach(k => { if (req.query?.[k]) qs.set(k, String(req.query[k])); });
    const url = getAgentsServiceBaseUrl() + '/api/kpi/targets' + (qs.toString() ? `?${qs}` : '');
    const r = await axios.get(url, { timeout: 8000, validateStatus: () => true, headers: { Authorization: `Bearer ${token}` } });
    if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'kpi_targets_proxy_failed' });
    return res.json(r.data || { targets: [] });
  } catch (e) {
    return res.status(502).json({ error: 'internal_error' });
  }
});

app.put('/api/tenant-settings/kpi-targets', authRequired, async (req, res) => {
  if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const token = await getAgentsServiceAdminToken();
    const url = getAgentsServiceBaseUrl() + '/api/kpi/targets';
    const r = await axios.put(url, req.body || {}, {
      timeout: 8000,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'kpi_targets_proxy_failed' });
    return res.json(r.data || { ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'internal_error' });
  }
});

app.delete('/api/tenant-settings/kpi-targets/:id', authRequired, async (req, res) => {
  if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
  try {
    const token = await getAgentsServiceAdminToken();
    const url = getAgentsServiceBaseUrl() + '/api/kpi/targets/' + encodeURIComponent(req.params.id);
    const r = await axios.delete(url, { timeout: 8000, validateStatus: () => true, headers: { Authorization: `Bearer ${token}` } });
    if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'kpi_targets_proxy_failed' });
    return res.json(r.data || { ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'internal_error' });
  }
});

app.get('/api/tenant-settings/:key', authRequired, async (req, res) => {
  if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
  const key = String(req.params.key || '').trim();
  if (!TENANT_SETTINGS_ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'unknown_settings_key' });
  try {
    const token = await getAgentsServiceAdminToken();
    const url = getAgentsServiceBaseUrl() + '/api/config/' + encodeURIComponent(key);
    const r = await axios.get(url, { timeout: 8000, validateStatus: () => true, headers: { Authorization: `Bearer ${token}` } });
    if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'tenant_settings_proxy_failed' });
    return res.json(r.data || { config_key: key, config_value: null });
  } catch (e) {
    return res.status(502).json({ error: 'internal_error' });
  }
});

app.put('/api/tenant-settings/:key', authRequired, async (req, res) => {
  if (!canManageTenantSettings(req.user)) return res.status(403).json({ error: 'forbidden' });
  const key = String(req.params.key || '').trim();
  if (!TENANT_SETTINGS_ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'unknown_settings_key' });
  const { config_value, description } = req.body || {};
  if (config_value === undefined) return res.status(400).json({ error: 'config_value is required' });
  try {
    const token = await getAgentsServiceAdminToken();
    const url = getAgentsServiceBaseUrl() + '/api/config/' + encodeURIComponent(key);
    const r = await axios.put(url, { config_value, description }, {
      timeout: 8000,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    if (r.status < 200 || r.status >= 300) return res.status(r.status || 502).json(r.data || { error: 'tenant_settings_proxy_failed' });
    return res.json(r.data || { ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'internal_error' });
  }
});


let __lastDiskLarkNoticeAt = 0;

/** 根分区空间（供 /api/health 与磁盘告警）；阈值偏保守，避免再次写满导致 PostgreSQL 宕机 */
async function buildRootDiskHealthInfo() {
  try {
    const s = await statfs('/');
    const bsize = Number(s.bsize) || 4096;
    const total = Number(s.blocks) * bsize;
    const avail = Number(s.bavail) * bsize;
    const usedPct = total > 0 ? Math.round(((total - avail) / total) * 1000) / 10 : null;
    const availGb = Math.round((avail / (1024 ** 3)) * 100) / 100;
    const totalGb = Math.round((total / (1024 ** 3)) * 100) / 100;
    const availCrit = 2 * 1024 ** 3;
    const availWarn = 20 * 1024 ** 3;
    let level = 'ok';
    let message = null;
    if (avail < availCrit || (usedPct != null && usedPct >= 92)) {
      level = 'crit';
      message =
        '根分区空间危急：剩余过低或已用过高，PostgreSQL 可能无法扩展文件，导致全员无法登录。请立即清理 /opt/deploy-backups、journal、PM2 日志等。';
    } else if (avail < availWarn || (usedPct != null && usedPct >= 82)) {
      level = 'warn';
      message = '根分区空间紧张：建议尽快清理部署备份与日志，避免写满磁盘。';
    } else if (usedPct != null && usedPct >= 72) {
      level = 'notice';
      message = `根分区已用约 ${usedPct}%，请关注磁盘余量。`;
    }
    return {
      path: '/',
      totalBytes: total,
      availBytes: avail,
      totalGb,
      availGb,
      usedPercent: usedPct,
      level,
      message
    };
  } catch (e) {
    return { path: '/', error: 'internal_error' };
  }
}

async function maybeNotifyDiskPressureByLark(disk) {
  if (!disk || disk.error) return;
  if (disk.level !== 'crit' && disk.level !== 'warn') return;
  const ids = String(process.env.HRMS_DISK_ALERT_OPEN_IDS || '')
    .split(/[\s,]+/)
    .map(x => x.trim())
    .filter(Boolean);
  if (!ids.length) return;
  const now = Date.now();
  const minMs = disk.level === 'crit' ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
  if (now - __lastDiskLarkNoticeAt < minMs) return;
  __lastDiskLarkNoticeAt = now;
  const text =
    `【HRMS 磁盘告警】\n${disk.message || '磁盘空间异常'}\n` +
    `剩余约 ${disk.availGb} GiB / 合计 ${disk.totalGb} GiB` +
    `${disk.usedPercent != null ? `（已用约 ${disk.usedPercent}%）` : ''}。\n` +
    '可在服务器执行 df -h / 与 du -sh /opt/deploy-backups/* 排查。';
  for (const id of ids) {
    try {
      await sendLarkMessage(id, text);
    } catch (e) {
      console.error('HRMS disk lark notify failed:', e?.message || e);
    }
  }
}

app.get('/api/health', async (req, res) => {
  const missing = requireEnv();
  if (missing.length) {
    return res.status(500).json({ ok: false, missing });
  }
  try {
    const _r = await pool.query('select now() as now');
    const ossConfigured = !!getOssClient();
    const cosConfigured = !!getCosClient();
    const uploads = ensureUploadsDir();
    let agentHealth = {};
    try { agentHealth = getAgentHealthStatus(); } catch (e) { /* ignore */ }
    let agentsService = null;
    try {
      agentsService = await fetchAgentsServiceHealthSnapshot();
    } catch (e) {
      agentsService = { ok: false, error: 'internal_error' };
    }
    const diskInfo = await buildRootDiskHealthInfo();
    maybeNotifyDiskPressureByLark(diskInfo).catch(() => {});

    let databaseSizeBytes = null;
    let databaseSizeGb = null;
    try {
      const sz = await pool.query('select pg_database_size(current_database())::bigint as b');
      const b = Number(sz.rows?.[0]?.b || 0);
      if (b > 0) {
        databaseSizeBytes = b;
        databaseSizeGb = Math.round((b / (1024 ** 3)) * 100) / 100;
      }
    } catch (e) {
      /* ignore size errors */
    }

    const payload = {
      ok: true,
      database: true,
      now: hrmsNowISO(),
      storage: { ossConfigured, cosConfigured },
      uploads,
      agents: agentHealth,
      disk: diskInfo,
      databaseSizeBytes,
      databaseSizeGb
    };
    if (agentsService != null) payload.agentsService = agentsService;
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

app.get('/api/version', async (req, res) => {
  try {
    const out = {
      startedAt: STARTED_AT,
      buildVersion: 'v176',
      server: {
        indexMtime: null,
        agentsMtime: null
      },
      frontend: {
        workingFixedMtime: null,
        swMtime: null,
        swCacheName: null
      }
    };

    try {
      const st = fs.statSync(__filename);
      out.server.indexMtime = st?.mtime ? st.mtime.toISOString() : null;
    } catch (e) { /* ignore */ }
    try {
      const agentsPath = path.resolve(__dirname, 'agents.js');
      const ast = fs.statSync(agentsPath);
      out.server.agentsMtime = ast?.mtime ? ast.mtime.toISOString() : null;
    } catch (e) { /* ignore */ }

    try {
      const webRootDir = path.resolve(__dirname, '..');
      const wf = path.join(webRootDir, 'working-fixed.html');
      const sw = path.join(webRootDir, 'sw.js');
      if (fs.existsSync(wf)) {
        const st = fs.statSync(wf);
        out.frontend.workingFixedMtime = st?.mtime ? st.mtime.toISOString() : null;
      }
      if (fs.existsSync(sw)) {
        const st2 = fs.statSync(sw);
        out.frontend.swMtime = st2?.mtime ? st2.mtime.toISOString() : null;
        try {
          const head = String(fs.readFileSync(sw, 'utf8') || '').split(/\r?\n/).slice(0, 3).join('\n');
          const m = head.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
          out.frontend.swCacheName = m && m[1] ? String(m[1]) : null;
        } catch (e3) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.get('/api/exam-results', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  const isPrivileged = role === 'admin' || role === 'hq_manager' || role === 'store_manager';
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 100)));
  try {
    if (isPrivileged) {
      const r = await pool.query(
        `select id, assignment_id, user_key, created_at, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers
         from exam_results
         where tenant_id = $2
         order by created_at desc
         limit $1`,
        [limit, req.tenantId || req.user?.tenant_id || 'default']
      );
      return res.json({ items: r.rows || [] });
    }

    const userKey = String(req.user?.username || '').trim();
    const r = await pool.query(
      `select id, assignment_id, user_key, created_at, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers
       from exam_results
       where user_key = $1
       order by created_at desc
       limit $2`,
      [userKey, limit]
    );
    return res.json({ items: r.rows || [] });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

app.post('/api/exam-results', authRequired, async (req, res) => {
  const userKey = String(req.user?.username || '').trim() || 'unknown';
  const assignmentIdRaw = req.body?.assignmentId;
  const assignmentId = assignmentIdRaw ? String(assignmentIdRaw).trim() : null;
  const startedAt = req.body?.startedAt ? String(req.body.startedAt).trim() : null;
  const submittedAt = req.body?.submittedAt ? String(req.body.submittedAt).trim() : null;
  const timeUsedSeconds = req.body?.timeUsedSeconds == null ? null : Number(req.body.timeUsedSeconds);
  const autoSubmitted = !!req.body?.autoSubmitted;
  const setIndex = req.body?.setIndex == null ? null : Number(req.body.setIndex);
  const total = req.body?.total == null ? null : Number(req.body.total);
  const correct = req.body?.correct == null ? null : Number(req.body.correct);
  const score = req.body?.score == null ? null : Number(req.body.score);
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

  if (total == null || score == null) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  try {
    const r = await pool.query(
      `insert into exam_results (assignment_id, user_key, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers, tenant_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id, assignment_id, user_key, created_at, started_at, submitted_at, time_used_seconds, auto_submitted, set_index, total, correct, score, answers`,
      [
        assignmentId || null,
        userKey,
        startedAt || null,
        submittedAt || null,
        Number.isFinite(timeUsedSeconds) ? Math.max(0, Math.floor(timeUsedSeconds)) : null,
        autoSubmitted,
        Number.isFinite(setIndex) ? Math.max(0, Math.floor(setIndex)) : null,
        Number.isFinite(total) ? Math.max(0, Math.floor(total)) : null,
        Number.isFinite(correct) ? Math.max(0, Math.floor(correct)) : null,
        Number.isFinite(score) ? Math.max(0, Math.floor(score)) : null,
        JSON.stringify(answers || []),
        req.tenantId || req.user?.tenant_id || 'default'
      ]
    );
    return res.json({ item: r.rows?.[0] || null });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
});

// Wave 4g: stores CRUD/brands/location → domains/stores/*

/** @returns {Promise<boolean>} 是否已成功持久化（失败时不得签发 JWT，否则 sn 与库不一致 → 全站 401/session_replaced） */
async function storeSessionNonce(uname, nonce, tenantId) {
  const key = String(uname || '').trim().toLowerCase();
  const effectiveTenantId = resolveTenantIdDefault(tenantId);
  if (!key) return false;
  let client;
  try {
    client = await pool.connect();
    // configureDbSessionSafety 在 ENABLE_DB_WRITE!=true 时会把连接设为只读；
    // 会话 nonce 必须写入，否则新 token 与库中旧 sn 不一致 → 立刻 401（表现为「登录不了/一进系统就掉线」）。
    await client.query('SET default_transaction_read_only = OFF');
    await client.query(
      `insert into user_sessions (username, session_nonce, tenant_id, updated_at)
       values ($1, $2, $3, now())
       on conflict (username, tenant_id) do update set session_nonce = $2, updated_at = now()`,
      [key, nonce, effectiveTenantId]
    );
    return true;
  } catch (e) {
    console.error('storeSessionNonce failed:', e?.message || e);
    return false;
  } finally {
    try {
      if (client) client.release();
    } catch (_e) {
      /* ignore */
    }
  }
}


async function getKnowledgeViewerProfile(req) {
  const username = String(req.user?.username || '').trim();
  const role = String(req.user?.role || '').trim();
  if (!username) return { username: '', role: '', store: '', position: '' };
  try {
    const state = (await getSharedState()) || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const users = Array.isArray(state.users) ? state.users : [];
    const emp = employees.find((e) => String(e?.username || '').trim().toLowerCase() === username.toLowerCase()) || {};
    const usr = users.find((u) => String(u?.username || '').trim().toLowerCase() === username.toLowerCase()) || {};
    return {
      username,
      role,
      store: String(emp.store || usr.store || '').trim(),
      position: String(emp.position || usr.position || '').trim()
    };
  } catch (e) {
    return { username, role, store: '', position: '' };
  }
}

// ─── RAG 多维知识库 API ───
app.get('/api/rag/stats', authRequired, async (req, res) => {
  res.json(await ragStats());
});

app.post('/api/rag/query', authRequired, async (req, res) => {
  const { query, scope, category, brandTag, limit } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  const profile = await getKnowledgeViewerProfile(req);
  const adminRag = profile.role === 'admin';
  const result = await ragQuery({
    agentName: req.body.agentName || 'master_agent',
    userRole: profile.role || req.user?.role,
    userStore: profile.store,
    userPosition: profile.position,
    skipKnowledgeAudienceFilter: adminRag,
    query,
    scope,
    category,
    brandTag,
    limit
  });
  res.json(result);
});

app.post('/api/rag/multi-query', authRequired, async (req, res) => {
  const { queries, scope, brandTag, limit } = req.body;
  if (!Array.isArray(queries)) return res.status(400).json({ error: 'queries array required' });
  const profile = await getKnowledgeViewerProfile(req);
  const adminRag = profile.role === 'admin';
  const result = await ragMultiQuery({
    agentName: req.body.agentName || 'master_agent',
    userRole: profile.role || req.user?.role,
    userStore: profile.store,
    userPosition: profile.position,
    skipKnowledgeAudienceFilter: adminRag,
    queries,
    scope,
    brandTag,
    limit
  });
  res.json(result);
});

// ─── 飞书Webhook接收端点 ───────────────────────────────────────────────

app.post('/api/webhook/feishu', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!isWebhookEnabled()) return res.status(404).send('Not found');
  console.log('[Feishu Webhook] Received request:', req.headers['x-lark-request-timestamp']);
  
  try {
    const body = req.body;
    const rawBuf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}), 'utf8');
    const rawText = rawBuf.toString('utf8');
    let data = tryParseJson(rawText) || (body && typeof body === 'object' ? body : null);
    if (!data) {
      return res.status(400).json({ code: 400, message: 'invalid_json' });
    }

    const encryptKey = String(process.env.FEISHU_ENCRYPT_KEY || process.env.LARK_ENCRYPT_KEY || '').trim();
    const verificationToken = String(process.env.FEISHU_VERIFICATION_TOKEN || process.env.LARK_VERIFICATION_TOKEN || '').trim();
    const sigCheck = verifyFeishuWebhookRequest({
      headers: req.headers,
      rawBody: rawBuf,
      parsedBody: data,
      encryptKey,
      verificationToken,
      requireSignature: requireWebhookSignature(),
    });
    if (!sigCheck.ok) {
      console.warn('[Feishu Webhook] signature/token rejected:', sigCheck.reason);
      return res.status(401).json({ code: 401, message: sigCheck.reason || 'unauthorized' });
    }
    if (sigCheck.mode === 'skipped' && requireWebhookSignature() === false && (encryptKey || verificationToken)) {
      // 非强制模式：有密钥但未带签名时仅告警，保持现网兼容
      if (!req.headers['x-lark-signature']) {
        console.warn('[Feishu Webhook] signature skipped (REQUIRE_WEBHOOK_SIGNATURE!=true)');
      }
    }

    // Decrypt encrypted payload if present
    if (data.encrypt) {
      try {
        const decrypted = decryptFeishuEncryptPayload(data.encrypt);
        const parsed = tryParseJson(decrypted);
        if (parsed) data = parsed;
      } catch (e) {
        console.error('[Feishu Webhook] decrypt failed:', e?.message || e);
        return res.status(400).json({ code: 400, message: 'decrypt_failed' });
      }
    }

    // 解密后再校验 Verification Token（加密包场景）
    if (verificationToken && requireWebhookSignature()) {
      const tokenAfter = String(data?.token || data?.header?.token || '').trim();
      if (tokenAfter && tokenAfter !== verificationToken) {
        return res.status(401).json({ code: 401, message: 'bad_verification_token' });
      }
    }
    
    // URL验证模式（飞书首次配置webhook时）
    if (data.type === 'url_verification') {
      console.log('[Feishu Webhook] URL verification challenge:', data.challenge);
      return res.json({ challenge: data.challenge });
    }
    
    // 处理业务数据变更事件
    if (data.header?.event_type === 'bitable.record.changed') {
      // webhook 无 JWT/ALS 租户上下文，通过 app_token 反查 tenant_id（5分钟缓存）。
      // 新租户只需在 tenant_integrations 配置 feishu_bitable，无需改代码。
      const event = data.event;
      const webhookTenantId = await resolveWebhookTenantId(event?.app_token).catch(() => 'default');
      return await tenantContext.run(webhookTenantId, async () => {
      const logId = randomUUID();

      // 记录同步日志
      await pool.query(
        `insert into feishu_sync_logs (id, event_type, table_id, record_id, data, sync_status, tenant_id)
         values ($1, $2, $3, $4, $5, 'pending', $6)`,
        [logId, data.header.event_type, event.app_token, event.record_id, event, webhookTenantId]
      );

      // 异步处理数据同步
      setImmediate(async () => {
        try {
          await processFeishuDataChange(event, logId);
        } catch (error) {
          console.error('[Feishu Webhook] Async processing error:', error);
          await pool.query(
            'update feishu_sync_logs set sync_status = $1, error_message = $2, processed_at = now() where id = $3',
            ['failed', safeErrMessage(error), logId]
          );
          void notifyAdminsDualWriteFailure('飞书 Webhook → DB（bitable.record.changed 异步处理失败）', error);
        }
      });

      return res.json({ code: 0, message: 'success' });
      });
    }

    // Forward all non-bitable events to agents handler (bot replies, card actions, etc.)
    try {
      const resp = await onFeishuEvent(data);
      return res.json(resp || { ok: true });
    } catch (e) {
      console.error('[Feishu Webhook] onFeishuEvent error:', e?.message || e);
      return res.status(500).json({ code: 500, message: 'agent_error' });
    }
    
    // 其他事件类型
    console.log('[Feishu Webhook] Unhandled event type:', data.header?.event_type);
    return res.json({ code: 0, message: 'ignored' });
    
  } catch (error) {
    console.error('[Feishu Webhook] Error:', error);
    return res.status(500).json({ code: 500, message: 'internal error' });
  }
});

// 处理飞书数据变更
async function processFeishuDataChange(event, logId) {
  try {
    // 租户感知：tenant 由外层 tenantContext.run(webhookTenantId, ...) 设置。
    const tenantId = resolveTenantIdDefault();
    const tenantCfg = await loadTenantFeishuBitableConfig(tenantId).catch(() => null);
    // 优先用租户专属凭证，无租户配置时回退到全局环境变量（兜底'default'）。
    const accessToken = tenantCfg?.app_id
      ? await getFeishuTokenByConfig({ app_id: tenantCfg.app_id, app_secret: tenantCfg.app_secret }).catch(() => getFeishuAccessToken())
      : await getFeishuAccessToken();
    const appToken = event.app_token;
    const tableId = event.table_id;
    const recordId = event.record_id;

    // 获取记录详情
    const recordData = await getFeishuBitableData(appToken, tableId, accessToken);
    const record = recordData.items?.find(item => item.record_id === recordId);

    if (!record) {
      throw new Error('Record not found in Feishu');
    }

    // Always upsert raw record into generic storage with configKey
    try {
      const configKey = findConfigKeyByTableInfo(appToken, tableId);
      await upsertFeishuGenericRecord({ appToken, tableId, record, configKey });
    } catch (e) {
      console.log('[processFeishuDataChange] generic upsert failed:', e?.message || e);
      void notifyAdminsDualWriteFailure(
        `飞书 Webhook → feishu_generic_records（table ${String(tableId || '').slice(0, 16)} record ${String(recordId || '').slice(0, 24)}）`,
        e
      );
    }

    // 桌访表：从租户配置取 table_id，回退到默认值（默认租户历史值）。
    const tableVisitTableId = tenantCfg?.tables?.table_visit?.table_id || 'tblpx5Efqc6eHo3L';
    const isTableVisit = String(tableId || '').trim() === tableVisitTableId;
    if (!isTableVisit) {
      await pool.query(
        'update feishu_sync_logs set sync_status = $1, processed_at = now() where id = $2',
        ['success', logId]
      );
      return;
    }
    
    // 根据表格类型处理数据
    const hrmsData = mapFeishuFieldToHrms(record, 'table_visit');
    
    // 存储到HRMS系统（这里以桌访记录为例）
    if (hrmsData.date && hrmsData.store) {
      await pool.query(
        `insert into table_visit_records (
          date, store, brand, table_number, guest_count, amount, 
          has_reservation, dissatisfaction_dish, feedback,
          reservation_time, customer_type, order_type, service_rating, food_rating, environment_rating,
          waiter_name, promotion_info, weather, peak_hours, customer_complaint, complaint_resolution,
          satisfaction_level, repeat_customer, special_requests, payment_method, order_duration,
          table_turnover, dish_recommendations, allergic_info, celebration_type, visit_purpose,
          companion_info, customer_age, customer_gender, visit_frequency, preferred_dishes,
          unsatisfied_items, suggested_improvements, staff_performance, facility_issues,
          hygiene_rating, value_rating, ambiance_rating, noise_level, temperature,
          lighting, music_volume, seating_comfort, queue_time, service_speed, order_accuracy,
          staff_attitude, problem_resolution, manager_intervention, compensation_provided,
          follow_up_required, follow_up_details, additional_notes,
          rush_dish_content,
          feishu_record_id, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
          $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, now()
        ) on conflict (feishu_record_id) do update set
          date = excluded.date,
          store = excluded.store,
          brand = excluded.brand,
          table_number = excluded.table_number,
          guest_count = excluded.guest_count,
          amount = excluded.amount,
          has_reservation = excluded.has_reservation,
          dissatisfaction_dish = excluded.dissatisfaction_dish,
          feedback = excluded.feedback,
          reservation_time = excluded.reservation_time,
          customer_type = excluded.customer_type,
          order_type = excluded.order_type,
          service_rating = excluded.service_rating,
          food_rating = excluded.food_rating,
          environment_rating = excluded.environment_rating,
          waiter_name = excluded.waiter_name,
          promotion_info = excluded.promotion_info,
          weather = excluded.weather,
          peak_hours = excluded.peak_hours,
          customer_complaint = excluded.customer_complaint,
          complaint_resolution = excluded.complaint_resolution,
          satisfaction_level = excluded.satisfaction_level,
          repeat_customer = excluded.repeat_customer,
          special_requests = excluded.special_requests,
          payment_method = excluded.payment_method,
          order_duration = excluded.order_duration,
          table_turnover = excluded.table_turnover,
          dish_recommendations = excluded.dish_recommendations,
          allergic_info = excluded.allergic_info,
          celebration_type = excluded.celebration_type,
          visit_purpose = excluded.visit_purpose,
          companion_info = excluded.companion_info,
          customer_age = excluded.customer_age,
          customer_gender = excluded.customer_gender,
          visit_frequency = excluded.visit_frequency,
          preferred_dishes = excluded.preferred_dishes,
          unsatisfied_items = excluded.unsatisfied_items,
          suggested_improvements = excluded.suggested_improvements,
          staff_performance = excluded.staff_performance,
          facility_issues = excluded.facility_issues,
          hygiene_rating = excluded.hygiene_rating,
          value_rating = excluded.value_rating,
          ambiance_rating = excluded.ambiance_rating,
          noise_level = excluded.noise_level,
          temperature = excluded.temperature,
          lighting = excluded.lighting,
          music_volume = excluded.music_volume,
          seating_comfort = excluded.seating_comfort,
          queue_time = excluded.queue_time,
          service_speed = excluded.service_speed,
          order_accuracy = excluded.order_accuracy,
          staff_attitude = excluded.staff_attitude,
          problem_resolution = excluded.problem_resolution,
          manager_intervention = excluded.manager_intervention,
          compensation_provided = excluded.compensation_provided,
          follow_up_required = excluded.follow_up_required,
          follow_up_details = excluded.follow_up_details,
          additional_notes = excluded.additional_notes,
          rush_dish_content = excluded.rush_dish_content,
          updated_at = now()`,
        [
          hrmsData.date, hrmsData.store, hrmsData.brand, hrmsData.tableNumber,
          hrmsData.guestCount, hrmsData.amount, hrmsData.hasReservation,
          hrmsData.dissatisfactionDish, hrmsData.feedback,
          hrmsData.reservationTime ? hrmsData.reservationTime.replace(/^(\d{1,2}):(\d{1,2})$/, '$1:$2:00') : null,
          hrmsData.customerType, hrmsData.orderType,
          hrmsData.serviceRating, hrmsData.foodRating, hrmsData.environmentRating,
          hrmsData.waiterName, hrmsData.promotionInfo, hrmsData.weather, hrmsData.peakHours,
          hrmsData.customerComplaint, hrmsData.complaintResolution, hrmsData.satisfactionLevel,
          hrmsData.repeatCustomer, hrmsData.specialRequests, hrmsData.paymentMethod,
          hrmsData.orderDuration, hrmsData.tableTurnover, hrmsData.dishRecommendations,
          hrmsData.allergicInfo, hrmsData.celebrationType, hrmsData.visitPurpose,
          hrmsData.companionInfo, hrmsData.customerAge, hrmsData.customerGender,
          hrmsData.visitFrequency, hrmsData.preferredDishes, hrmsData.unsatisfiedItems,
          hrmsData.suggestedImprovements, hrmsData.staffPerformance, hrmsData.facilityIssues,
          hrmsData.hygieneRating, hrmsData.valueRating, hrmsData.ambianceRating,
          hrmsData.noiseLevel, hrmsData.temperature, hrmsData.lighting,
          hrmsData.musicVolume, hrmsData.seatingComfort, hrmsData.queueTime,
          hrmsData.serviceSpeed, hrmsData.orderAccuracy, hrmsData.staffAttitude,
          hrmsData.problemResolution, hrmsData.managerIntervention, hrmsData.compensationProvided,
          hrmsData.followUpRequired, hrmsData.followUpDetails, hrmsData.additionalNotes,
          hrmsData.rushDishContent || null,
          hrmsData.recordId
        ]
      );
      
      // 更新同步状态
      await pool.query(
        'update feishu_sync_logs set sync_status = $1, processed_at = now() where id = $2',
        ['success', logId]
      );
      
      console.log('[Feishu Webhook] Data synced successfully:', hrmsData.recordId);
    } else {
      throw new Error('Missing required fields: date or store');
    }
    
  } catch (error) {
    await pool.query(
      'update feishu_sync_logs set sync_status = $1, error_message = $2, processed_at = now() where id = $3',
      ['failed', safeErrMessage(error), logId]
    );
    throw error;
  }
}

// 获取飞书同步状态
app.get('/api/feishu/sync-status', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  
  try {
    const limit = Math.min(Number(req.query?.limit) || 50, 200);
    const offset = Math.max(Number(req.query?.offset) || 0, 0);
    const status = String(req.query?.status || '').trim();
    
    let query = 'select * from feishu_sync_logs';
    const params = [];
    
    if (status) {
      query += ' where sync_status = $1';
      params.push(status);
    }
    
    query += ' order by created_at desc limit $' + (params.length + 1) + ' offset $' + (params.length + 2);
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    res.json({
      items: result.rows,
      pagination: {
        limit,
        offset,
        total: result.rowCount
      }
    });
  } catch (error) {
    console.error('[Feishu Sync Status] Error:', error);
    res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
  }
});

/** 全量拉取指定多维表并写入 feishu_generic_records；桌访表同时 upsert table_visit_records（供 HTTP 与 CLI 共用） */
async function runManualFeishuBitableSync({ appToken, tableId, appId, appSecret }) {
  if (!appToken || !tableId) {
    throw new Error('missing_app_token_or_table_id');
  }
  const accessToken = await getFeishuAccessToken({ appId, appSecret });
  const data = await getFeishuBitableData(appToken, tableId, accessToken);

  const TABLE_VISIT_TABLE_ID = 'tblpx5Efqc6eHo3L';
  const isTableVisit = String(tableId || '').trim() === TABLE_VISIT_TABLE_ID;

  let synced = 0;
  let failed = 0;
  let genericUpserted = 0;
  const failedDetails = [];

  for (const record of data.items || []) {
      try {
        const configKey = findConfigKeyByTableInfo(appToken, tableId);
        await upsertFeishuGenericRecord({ appToken, tableId, record, configKey });
        genericUpserted++;

        if (!isTableVisit) {
          continue;
        }

        const hrmsData = mapFeishuFieldToHrms(record, 'table_visit');

        if (hrmsData.date && hrmsData.store) {
          await pool.query(
            `insert into table_visit_records (
              date, store, brand, table_number, guest_count, amount, 
              has_reservation, dissatisfaction_dish, feedback,
              reservation_time, customer_type, order_type, service_rating, food_rating, environment_rating,
              waiter_name, promotion_info, weather, peak_hours, customer_complaint, complaint_resolution,
              satisfaction_level, repeat_customer, special_requests, payment_method, order_duration,
              table_turnover, dish_recommendations, allergic_info, celebration_type, visit_purpose,
              companion_info, customer_age, customer_gender, visit_frequency, preferred_dishes,
              unsatisfied_items, suggested_improvements, staff_performance, facility_issues,
              hygiene_rating, value_rating, ambiance_rating, noise_level, temperature,
              lighting, music_volume, seating_comfort, queue_time, service_speed, order_accuracy,
              staff_attitude, problem_resolution, manager_intervention, compensation_provided,
              follow_up_required, follow_up_details, additional_notes,
              feishu_record_id, created_at
            ) values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
              $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
              $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
              $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
              $51, $52, $53, $54, $55, $56, $57, $58, $59, now()
            ) on conflict (feishu_record_id) do update set
              date = excluded.date,
              store = excluded.store,
              brand = excluded.brand,
              table_number = excluded.table_number,
              guest_count = excluded.guest_count,
              amount = excluded.amount,
              has_reservation = excluded.has_reservation,
              dissatisfaction_dish = excluded.dissatisfaction_dish,
              feedback = excluded.feedback,
              reservation_time = excluded.reservation_time,
              customer_type = excluded.customer_type,
              order_type = excluded.order_type,
              service_rating = excluded.service_rating,
              food_rating = excluded.food_rating,
              environment_rating = excluded.environment_rating,
              waiter_name = excluded.waiter_name,
              promotion_info = excluded.promotion_info,
              weather = excluded.weather,
              peak_hours = excluded.peak_hours,
              customer_complaint = excluded.customer_complaint,
              complaint_resolution = excluded.complaint_resolution,
              satisfaction_level = excluded.satisfaction_level,
              repeat_customer = excluded.repeat_customer,
              special_requests = excluded.special_requests,
              payment_method = excluded.payment_method,
              order_duration = excluded.order_duration,
              table_turnover = excluded.table_turnover,
              dish_recommendations = excluded.dish_recommendations,
              allergic_info = excluded.allergic_info,
              celebration_type = excluded.celebration_type,
              visit_purpose = excluded.visit_purpose,
              companion_info = excluded.companion_info,
              customer_age = excluded.customer_age,
              customer_gender = excluded.customer_gender,
              visit_frequency = excluded.visit_frequency,
              preferred_dishes = excluded.preferred_dishes,
              unsatisfied_items = excluded.unsatisfied_items,
              suggested_improvements = excluded.suggested_improvements,
              staff_performance = excluded.staff_performance,
              facility_issues = excluded.facility_issues,
              hygiene_rating = excluded.hygiene_rating,
              value_rating = excluded.value_rating,
              ambiance_rating = excluded.ambiance_rating,
              noise_level = excluded.noise_level,
              temperature = excluded.temperature,
              lighting = excluded.lighting,
              music_volume = excluded.music_volume,
              seating_comfort = excluded.seating_comfort,
              queue_time = excluded.queue_time,
              service_speed = excluded.service_speed,
              order_accuracy = excluded.order_accuracy,
              staff_attitude = excluded.staff_attitude,
              problem_resolution = excluded.problem_resolution,
              manager_intervention = excluded.manager_intervention,
              compensation_provided = excluded.compensation_provided,
              follow_up_required = excluded.follow_up_required,
              follow_up_details = excluded.follow_up_details,
              additional_notes = excluded.additional_notes,
              updated_at = now()`,
            [
              hrmsData.date, hrmsData.store, hrmsData.brand, hrmsData.tableNumber,
              hrmsData.guestCount, hrmsData.amount, hrmsData.hasReservation,
              hrmsData.dissatisfactionDish, hrmsData.feedback,
              hrmsData.reservationTime ? hrmsData.reservationTime.replace(/^(\d{1,2}):(\d{1,2})$/, '$1:$2:00') : null,
              hrmsData.customerType, hrmsData.orderType,
              hrmsData.serviceRating, hrmsData.foodRating, hrmsData.environmentRating,
              hrmsData.waiterName, hrmsData.promotionInfo, hrmsData.weather, hrmsData.peakHours,
              hrmsData.customerComplaint, hrmsData.complaintResolution, hrmsData.satisfactionLevel,
              hrmsData.repeatCustomer, hrmsData.specialRequests, hrmsData.paymentMethod,
              hrmsData.orderDuration, hrmsData.tableTurnover, hrmsData.dishRecommendations,
              hrmsData.allergicInfo, hrmsData.celebrationType, hrmsData.visitPurpose,
              hrmsData.companionInfo, hrmsData.customerAge, hrmsData.customerGender,
              hrmsData.visitFrequency, hrmsData.preferredDishes, hrmsData.unsatisfiedItems,
              hrmsData.suggestedImprovements, hrmsData.staffPerformance, hrmsData.facilityIssues,
              hrmsData.hygieneRating, hrmsData.valueRating, hrmsData.ambianceRating,
              hrmsData.noiseLevel, hrmsData.temperature, hrmsData.lighting,
              hrmsData.musicVolume, hrmsData.seatingComfort, hrmsData.queueTime,
              hrmsData.serviceSpeed, hrmsData.orderAccuracy, hrmsData.staffAttitude,
              hrmsData.problemResolution, hrmsData.managerIntervention, hrmsData.compensationProvided,
              hrmsData.followUpRequired, hrmsData.followUpDetails, hrmsData.additionalNotes,
              hrmsData.recordId
            ]
          );
          synced++;
        } else {
          failed++;
          const reason = `missing_required_fields date="${hrmsData.date || ''}" store="${hrmsData.store || ''}"`;
          const detail = {
            recordId: record?.record_id || null,
            reason,
            required: {
              date: hrmsData.date || '',
              store: hrmsData.store || ''
            }
          };
          if (failedDetails.length < 30) failedDetails.push(detail);
          console.warn('[Manual Sync] Skipped record:', detail);
        }
      } catch (error) {
        const detail = {
          recordId: record?.record_id || null,
          reason: error?.message || String(error || 'unknown_error')
        };
        if (failedDetails.length < 30) failedDetails.push(detail);
        console.error('[Manual Sync] Record error:', detail);
        failed++;
      }
    }

  if (failed > 0) {
    void notifyAdminsDualWriteFailure(
      '飞书多维表手动同步（部分记录写入失败）',
      new Error(
        `failed=${failed} synced=${synced} total=${data.items?.length || 0} ` +
          `${JSON.stringify((failedDetails || []).slice(0, 5))}`.slice(0, 500)
      )
    );
  }

  return {
    message: 'Manual sync completed',
    synced,
    failed,
    total: data.items?.length || 0,
    genericUpserted,
    isTableVisit,
    failedDetails
  };
}

// 手动触发飞书数据同步
app.post('/api/feishu/sync-manual', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const { appToken, tableId, appId, appSecret } = req.body;
    if (!appToken || !tableId) {
      return res.status(400).json({ error: 'missing_app_token_or_table_id' });
    }
    const result = await runManualFeishuBitableSync({ appToken, tableId, appId, appSecret });
    res.json(result);
  } catch (error) {
    console.error('[Manual Sync] Error:', error);
    void notifyAdminsDualWriteFailure('飞书多维表手动同步（整次失败）', error);
    res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
  }
});

// 手动触发菜品库成本同步（写入 dish_library_costs）
app.post('/api/feishu/sync-dish-library', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const result = await syncDishLibraryCosts();
    if (!result?.ok) {
      return res.status(500).json({ error: 'server_error', message: result?.error || 'sync_failed' });
    }
    res.json({
      message: 'Dish library sync completed',
      records: Number(result.records || 0),
      upserted: Number(result.upserted || 0)
    });
  } catch (error) {
    console.error('[Dish Library Sync] Error:', error);
    void notifyAdminsDualWriteFailure('菜品库成本同步（HTTP 接口抛错）', error);
    res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
  }
});

// 手动触发SOP步骤库同步
app.post('/api/feishu/sync-sop-steps', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'store_manager', 'store_production_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const result = await syncSopSteps();
    if (!result?.ok) {
      return res.status(500).json({ error: 'sync_failed', message: result?.error });
    }
    res.json({ message: 'SOP步骤库同步完成', ...result });
  } catch (error) {
    console.error('[SOP Steps Sync] Error:', error);
    res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
  }
});

// 测试飞书连接
app.post('/api/feishu/test-connection', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const { appId, appSecret } = req.body;

    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'missing_app_id_or_secret' });
    }

    const accessToken = await getFeishuAccessToken({ appId, appSecret });
    res.json({ success: true, message: '连接成功', accessToken: accessToken ? 'valid' : 'invalid' });
  } catch (error) {
    console.error('[Feishu Test Connection] Error:', error);
    res.status(500).json({ success: false, message: safeErrMessage(error) });
  }
});

// 发送飞书测试消息（轻量验收：token可用 + 至少一条消息可送达）
app.post('/api/feishu/send-test-message', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const username = String(req.body?.username || '').trim();
    const openIdDirect = String(req.body?.openId || '').trim();
    const message = String(req.body?.message || 'HRMS 连通性测试消息').trim();

    let openId = openIdDirect;
    if (!openId && username) {
      const u = await lookupFeishuUserByUsername(username);
      openId = String(u?.open_id || '').trim();
      if (!openId) {
        const r = await pool.query(
          `SELECT open_id FROM feishu_users WHERE lower(username)=lower($1) LIMIT 1`,
          [username]
        );
        openId = String(r.rows?.[0]?.open_id || '').trim();
      }
    }

    if (!openId) {
      return res.status(400).json({ error: 'missing_open_id_or_bind_user' });
    }

    const result = await sendLarkMessage(openId, message, { skipDedup: true });
    return res.json({ ok: Boolean(result?.ok), openId, result });
  } catch (error) {
    console.error('[Feishu Test Message] Error:', error);
    return res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
  }
});

app.post('/api/admin/system-alert/test', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'hr_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const targetUsername = String(req.body?.username || '').trim();
    if (!targetUsername) return res.status(400).json({ error: 'missing_username' });

    const targetR = await pool.query(
      `SELECT username, role
       FROM users
       WHERE lower(username) = lower($1)
         AND role IN ('admin','hq_manager','hr_manager')
       LIMIT 1`,
      [targetUsername]
    );
    const target = targetR.rows?.[0] || null;
    if (!target) return res.status(400).json({ error: 'target_user_not_admin' });

    const message = String(
      req.body?.message ||
      `🧪 [HRMS] 管理员单人告警测试\n目标账号：${target.username}\n时间：${hrmsNowISO()}\n说明：用于验证飞书告警与 HRMS 公司通知链路是否同时生效。`
    ).trim();

    const result = await sendAdminSystemAlert(message, {
      usernames: [target.username],
      persistToHrms: true,
      notificationType: 'system_alert_test',
      meta: {
        test: true,
        createdBy: String(req.user?.username || '')
      }
    });
    return res.json({ ok: true, ...result, targetUsername: target.username });
  } catch (error) {
    console.error('[admin system alert test] Error:', error);
    return res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
  }
});

// Agent/API: 直接写入飞书多维表格（单条或批量）
app.post('/api/agent/feishu-table-write', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const { appToken, tableId, appId, appSecret, fields, records } = req.body || {};
    if (!appToken || !tableId) {
      return res.status(400).json({ error: 'missing_app_token_or_table_id' });
    }

    const items = Array.isArray(records)
      ? records
      : (fields && typeof fields === 'object' ? [fields] : []);

    if (!items.length) {
      return res.status(400).json({ error: 'missing_fields_or_records' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'too_many_records', message: 'max 50 records per request' });
    }

    const accessToken = await getFeishuAccessToken({ appId, appSecret });
    const createdRecordIds = [];
    const failedDetails = [];

    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      try {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new Error('invalid_fields');
        }

        const created = await createFeishuBitableRecord({
          appToken,
          tableId,
          fields: row,
          accessToken
        });

        if (created?.record_id) {
          createdRecordIds.push(created.record_id);
        }

        try {
          if (created) {
            const configKey = findConfigKeyByTableInfo(appToken, tableId);
            await upsertFeishuGenericRecord({ appToken, tableId, record: created, configKey });
          }
        } catch (e) {
          // best effort local mirror; should not fail write call
        }
      } catch (err) {
        failedDetails.push({
          index: i,
          error: err?.message || String(err)
        });
      }
    }

    return res.json({
      success: true,
      total: items.length,
      created: createdRecordIds.length,
      failed: failedDetails.length,
      recordIds: createdRecordIds,
      failedDetails
    });
  } catch (error) {
    console.error('[Agent Feishu Table Write] Error:', error);
    return res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
  }
});

// Agent API - 查询桌访记录数据
// H1-FIX: 添加认证保护
app.get('/api/agent/table-visit-data', authRequired, async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      store, 
      satisfactionLevel, 
      minRating, 
      maxRating,
      limit = 100,
      offset = 0
    } = req.query;
    
    let conditions = [];
    let params = [];
    let idx = 1;
    
    // 日期范围过滤
    if (startDate) {
      conditions.push(`date >= $${idx}::date`);
      params.push(startDate);
      idx++;
    }
    if (endDate) {
      conditions.push(`date <= $${idx}::date`);
      params.push(endDate);
      idx++;
    }
    
    // 门店过滤
    if (store) {
      conditions.push(`store = $${idx}`);
      params.push(store);
      idx++;
    }
    
    // 满意度等级过滤
    if (satisfactionLevel) {
      conditions.push(`satisfaction_level = $${idx}`);
      params.push(satisfactionLevel);
      idx++;
    }
    
    // 评分范围过滤
    if (minRating) {
      conditions.push(`service_rating >= $${idx} AND food_rating >= $${idx} AND environment_rating >= $${idx}`);
      params.push(parseInt(minRating, 10));
      idx++;
    }
    if (maxRating) {
      conditions.push(`service_rating <= $${idx} AND food_rating <= $${idx} AND environment_rating <= $${idx}`);
      params.push(parseInt(maxRating, 10));
      idx++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const baseCond = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    const _whereWithSatisfaction = `WHERE ${baseCond} AND satisfaction_level IS NOT NULL AND satisfaction_level != ''`;
    const _whereWithWeather = `WHERE ${baseCond} AND weather IS NOT NULL AND weather != ''`;
    const limitClause = `LIMIT ${Math.min(parseInt(limit, 10) || 100, 1000)} OFFSET ${Math.max(parseInt(offset, 10) || 0, 0)}`;
    
    const query = `
      SELECT 
        id, date, store, brand, table_number, guest_count, amount,
        has_reservation, dissatisfaction_dish, feedback,
        reservation_time, customer_type, order_type,
        service_rating, food_rating, environment_rating,
        waiter_name, promotion_info, weather, peak_hours,
        customer_complaint, complaint_resolution, satisfaction_level,
        repeat_customer, special_requests, payment_method,
        order_duration, table_turnover, dish_recommendations,
        allergic_info, celebration_type, visit_purpose,
        companion_info, customer_age, customer_gender,
        visit_frequency, preferred_dishes, unsatisfied_items,
        suggested_improvements, staff_performance, facility_issues,
        hygiene_rating, value_rating, ambiance_rating,
        noise_level, temperature, lighting, music_volume,
        seating_comfort, queue_time, service_speed,
        order_accuracy, staff_attitude, problem_resolution,
        manager_intervention, compensation_provided,
        follow_up_required, follow_up_details, additional_notes,
        feishu_record_id, created_at, updated_at
      FROM table_visit_records 
      ${whereClause}
      ORDER BY date DESC, created_at DESC
      ${limitClause}
    `;
    
    const result = await pool.query(query, params);
    
    // 返回统计信息
    const statsQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN dissatisfaction_dish IS NOT NULL AND dissatisfaction_dish != '' THEN 1 END) as complaints,
        COUNT(CASE WHEN customer_complaint IS NOT NULL AND customer_complaint != '' THEN 1 END) as serious_complaints,
        AVG(service_rating) as avg_service_rating,
        AVG(food_rating) as avg_food_rating,
        AVG(environment_rating) as avg_environment_rating,
        AVG(amount) as avg_amount,
        SUM(guest_count) as total_guests
      FROM table_visit_records 
      ${whereClause}
    `;
    
    const statsResult = await pool.query(statsQuery, params);
    
    res.json({
      success: true,
      data: result.rows,
      stats: statsResult.rows[0] || {},
      pagination: {
        limit: parseInt(limit, 10) || 100,
        offset: parseInt(offset, 10) || 0,
        total: result.rowCount
      }
    });
    
  } catch (error) {
    console.error('[Agent Table Visit Data] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'server_error', 
      message: safeErrMessage(error) 
    });
  }
});

// Agent API - 获取桌访数据统计摘要
// H1-FIX: 添加认证保护
app.get('/api/agent/table-visit-summary', authRequired, async (req, res) => {
  try {
    const { startDate, endDate, store } = req.query;
    
    let conditions = [];
    let params = [];
    let idx = 1;
    
    if (startDate) {
      conditions.push(`date >= $${idx}::date`);
      params.push(startDate);
      idx++;
    }
    if (endDate) {
      conditions.push(`date <= $${idx}::date`);
      params.push(endDate);
      idx++;
    }
    if (store) {
      conditions.push(`store = $${idx}`);
      params.push(store);
      idx++;
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const query = `
      SELECT 
        COUNT(*) as total_visits,
        COUNT(DISTINCT date) as active_days,
        COUNT(DISTINCT store) as active_stores,
        SUM(guest_count) as total_guests,
        SUM(amount) as total_revenue,
        AVG(amount) as avg_amount_per_visit,
        AVG(guest_count) as avg_guests_per_visit,
        COUNT(CASE WHEN has_reservation THEN 1 END) as reservation_count,
        COUNT(CASE WHEN dissatisfaction_dish IS NOT NULL AND dissatisfaction_dish != '' THEN 1 END) as dish_complaints,
        COUNT(CASE WHEN customer_complaint IS NOT NULL AND customer_complaint != '' THEN 1 END) as customer_complaints,
        COUNT(CASE WHEN repeat_customer THEN 1 END) as repeat_customers,
        AVG(service_rating) as avg_service_rating,
        AVG(food_rating) as avg_food_rating,
        AVG(environment_rating) as avg_environment_rating,
        AVG(hygiene_rating) as avg_hygiene_rating,
        AVG(value_rating) as avg_value_rating,
        AVG(ambiance_rating) as avg_ambiance_rating,
        COUNT(CASE WHEN manager_intervention THEN 1 END) as manager_interventions,
        COUNT(CASE WHEN follow_up_required THEN 1 END) as follow_ups_required
      FROM table_visit_records 
      ${whereClause}
    `;
    
    const result = await pool.query(query, params);
    
    // 满意度分布
    const satisfactionQuery = `
      SELECT satisfaction_level, COUNT(*) as count
      FROM table_visit_records 
      ${whereWithSatisfaction}
      GROUP BY satisfaction_level
      ORDER BY count DESC
    `;
    
    const satisfactionResult = await pool.query(satisfactionQuery, params);
    
    // 天气影响分析
    const weatherQuery = `
      SELECT weather, 
             COUNT(*) as visits,
             AVG(amount) as avg_amount,
             AVG(service_rating) as avg_service_rating
      FROM table_visit_records 
      ${whereWithWeather}
      GROUP BY weather
      ORDER BY visits DESC
    `;
    
    const weatherResult = await pool.query(weatherQuery, params);
    
    res.json({
      success: true,
      summary: result.rows[0] || {},
      satisfaction_distribution: satisfactionResult.rows || [],
      weather_impact: weatherResult.rows || []
    });
    
  } catch (error) {
    console.error('[Agent Table Visit Summary] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'server_error', 
      message: safeErrMessage(error) 
    });
  }
});

// ── Multi-Agent Routes ──
// ─── Training APIs：batch 已迁入 domains/training/routes-batch-tasks.js（Wave 4e）───

// ─────────────────────────────────────────────────────────────────────────────

registerAuthRoutes(app, authRequired, loginRateLimit, {
  pool,
  JWT_SECRET,
  DATABASE_URL,
  getSharedState,
  normalizeRoleForJwt,
  normalizeUsersTableRole,
  employeeAccountShouldDisable,
  getUserStoreAccessContext,
  pickMyStoreFromState,
  recordLogin,
  recordLogout,
  storeSessionNonce,
  loadTenantRuntimeStatus,
});

registerApprovalRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  stateOrDbFindUserRecord,
  pickMyStoreFromState,
  normalizeApprovalType,
  safeDateOnly,
  scheduleLeaveDomainSync,
});

registerApprovalLifecycleRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  mergeSharedStateFields,
  hrmsNowISO,
  makeNotif,
  addStateNotification,
  appendNotifications,
  stateFindUserRecord,
  stateOrDbFindUserRecord,
  normalizeApprovalType,
  normalizeRoleForJwt,
  pickAdminUsername,
  pickHqManagerUsername,
  pickCashierUsername,
  pickHrManagerUsername,
  approvalTypeLabel,
  safeDateOnly,
  safeNumber,
  uniqUsernames,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  getPaymentFlowForStore,
  pickStoreRoleUsernameByStore,
  isKitchenByRoleOrPosition,
  resolveDutyApproverForStore,
});

registerApprovalDecideRoutes(app, authRequired, {
  pool,
  hrmsNowISO,
  makeNotif,
  appendNotifications,
  getSharedState,
  mergeSharedStateFields,
  stateFindUserRecord,
  uniqUsernames,
  safeDateOnly,
  safeNumber,
  safeErrMessage,
  safeBizMonth,
  shanghaiTodayDateOnly,
  toNullableUuid,
  randomUUID,
  buildOnboardingEmployeeRecordFromPayload,
  createTrainingAssignment,
  applyPromotionSalaryNextMonth,
  insertSalaryTimeline,
  findUserSalary,
  upsertPayrollLedgerEntry,
  resolveAttendancePayrollRules,
  getPromotionRequiredTopics,
  getPromotionTrackProgress,
  normalizePromotionTrainingPeriods,
  approvalTypeLabel,
  calcDateSpanDaysInclusive,
  isKitchenByRoleOrPosition,
  pickHqManagerUsername,
  pickStoreRoleUsernameByStore,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  notifyAdminsDualWriteFailure,
  bcrypt,
});

registerPayrollDomainRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerEmployeesDomainRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
  applyAccountGate: applyHrmsUserAccountGateFromEmployee,
});

// 员工表 vs hrms_state 镜像日对账（绞杀期一致性告警）
{
  const runEmployeesMirrorReconcile = async () => {
    try {
      const reports = await reconcileEmployeesMirrorAllTenants(pool, getActiveTenantIds);
      for (const report of reports) {
        if (!report.ok) {
          const driftSample = (report.fieldDrift || []).slice(0, 10).map((d) => d.username).join(',');
          const msg = `employees mirror drift tenant=${report.tenantId} table=${report.tableCount} mirror=${report.mirrorCount} onlyTable=${report.onlyTable.slice(0, 20).join(',')} onlyMirror=${report.onlyMirror.slice(0, 20).join(',')} fieldDrift=${driftSample}`;
          console.error('[employees-mirror-reconcile]', msg);
          void notifyAdminsDualWriteFailure('employees（表/镜像对账）', new Error(msg));
        } else {
          console.log('[employees-mirror-reconcile] ok', report.tenantId, report.tableCount);
        }
      }
    } catch (e) {
      console.error('[employees-mirror-reconcile] failed', e?.message || e);
    }
  };
  setTimeout(() => void runEmployeesMirrorReconcile(), 60_000);
  setInterval(() => void runEmployeesMirrorReconcile(), 24 * 60 * 60 * 1000);
}

registerFlowConfigRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
  getSharedState,
});

registerStoresDomainRoutes(app, authRequired, {
  pool,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerStoresCrudRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  resolveTenantIdDefault,
  getCreditRisk,
  hrmsNowISO,
  normalizeBrandId,
  getBrandsFromState,
});

registerBrandsRoutes(app, authRequired, {
  getSharedState,
  saveSharedState,
  hrmsNowISO,
  normalizeBrandId,
  getBrandsFromState,
});

registerPaymentConfigRoutes(app, authRequired, {
  pool,
  getSharedState,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerPaymentRoutes(app, authRequired, {
  pool,
  getSharedState,
  hrmsNowISO,
  safeMonthOnly,
  safeDateOnly,
  safeUuid,
  safeNumber,
});

registerPermissionGroupsRoutes(app, authRequired, {
  pool,
  getSharedState,
  saveSharedState,
  mergeSharedStateFields,
});

registerUploadRoutes(app, authRequired, {
  upload,
  recordUploadOwnership,
});

registerOpsTasksRoutes(app, authRequired, {
  pool,
  safeDateOnly,
  normalizeOpsRole,
  buildOpsFeedback,
});

registerStoreDutyBindingsRoutes(app, authRequired, { pool });

registerRemainingStateRoutes(app, authRequired, {
  pool,
  getSharedState,
  resolveTenantId: (req) => req.tenantId || req.user?.tenant_id || resolveTenantIdDefault(),
});

registerGmMailboxRoutes(app, authRequired, {
  getSharedState,
  saveSharedState,
  pickHqManagerUsername,
  pickAdminUsername,
  addStateNotification,
  makeNotif,
  uniqUsernames,
  hrmsNowISO,
});

registerAgentRoutes(app, authRequired);
registerAgentConfigRoutes(app, authRequired);

registerMasterRoutes(app, authRequired);
registerNewScoringRoutes(app, authRequired);
registerPerformanceInvalidationRoutes(app, authRequired);
registerHRMSApiRoutes(app, authRequired);
registerSOPDistributionRoutes(app, authRequired);
registerKitchenExecutionRoutes(app, authRequired);
registerRecipeRoutes(app, authRequired);
registerTrainingRoutes(app, authRequired, trainingPracticeUpload, { getSharedState });
registerUploadStatusRoute(app, { pool, getSharedState, authRequired });
app.use('/api', authRequired, fileRoutes);

/** 运维 CLI：全量同步桌访表入 DB 后退出（不监听端口）。例：cd server && HRMS_CLI_SYNC_TABLE_VISIT=1 node index.js */
if (String(process.env.HRMS_CLI_SYNC_TABLE_VISIT || '').trim() === '1') {
  (async () => {
    try {
      await ensureFeishuGenericRecordsTable();
      await ensureFeishuGenericRecordsNotifyTrigger();
      await ensureTableVisitRecordsTable();
      const r = await runManualFeishuBitableSync({
        appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
        tableId: process.env.BITABLE_TABLEVISIT_TABLE_ID || 'tblpx5Efqc6eHo3L',
        appId: process.env.FEISHU_APP_ID,
        appSecret: process.env.FEISHU_APP_SECRET
      });
      console.log('[HRMS_CLI_SYNC_TABLE_VISIT]', JSON.stringify(r, null, 2));
      process.exit(0);
    } catch (e) {
      console.error('[HRMS_CLI_SYNC_TABLE_VISIT]', e?.message || e);
      process.exit(1);
    }
  })();
} else {
app.listen(PORT, HOST, async () => {
  console.log(`hrms-server listening on ${HOST}:${PORT}`);

  // Initialize multi-agent system
  try {
    if (__ALLOW_SCHEMA_CHANGES__) {
      await runWithBootstrapTenantContext(async () => {
        await ensureTenantRuntimeTables();
      });
    }
    setMasterPool(pool);
    setReportPool(pool);
    setSalesRawPool(pool);
    setDataExecutorPool(pool);
    setTaskResponseHook(handleTaskResponse);
    if (__ALLOW_SCHEMA_CHANGES__) {
      await runWithBootstrapTenantContext(async () => {
        await ensureMasterTables();
      });
    }

    await runWithBootstrapTenantContext(async () => {
      await initStoreAliasCache().catch((e) => console.warn('[store-alias-cache] refresh failed:', e?.message || e));
      // 登录会话表：必须在 ALLOW_SCHEMA_CHANGES 之外也能创建，否则 INSERT 失败 + 仍签发 JWT → 全站 session 校验失败
      await ensureUserSessionsTable();
      if (!__ALLOW_SCHEMA_CHANGES__) {
        console.warn(`[safety] APP_ENV=${APP_ENV}: skip listen-time schema ensure/DDL (ALLOW_SCHEMA_CHANGES!=true); use node migrate.js`);
        return;
      }
      await ensureBaselineSchemaHealth(pool).catch(e => console.warn('[schema] baseline health:', e?.message || e));
      await ensurePayrollRulesTables(pool).catch(e => console.warn('[payroll-rules] ensure tables:', e?.message));
      await seedDefaultBrandPayrollRules('default', pool).catch(e => console.warn('[payroll-rules] seed:', e?.message));
      await ensurePermissionTables(pool).catch(e => console.warn('[permissions] ensure tables:', e?.message));
      await ensureGrowthTables(pool).catch(e => console.warn('[growth] ensure tables:', e?.message));
      await ensureAgentAuditLogTable(pool).catch(e => console.warn('[agent-audit] ensure table:', e?.message));
      await ensurePhaseTables(pool).catch(e => console.warn('[growth-phases] ensure tables:', e?.message));
      await ensureCustomerOpsTables(pool).catch(e => console.warn('[customer-ops] ensure tables:', e?.message));
      // Runtime migration: 企微会员新增字段（避免旧库缺字段导致评分数据源为空）
      await pool.query(`ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS new_wechat_members INTEGER DEFAULT 0`);
      // Runtime migration: 知识库文件版本号
      await pool.query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS version VARCHAR(50) DEFAULT NULL`);
      // 知识库分发范围（门店/岗位/全员），JSON：{ type, store?, position? }
      await pool.query(
        `ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS audience JSONB DEFAULT '{"type":"all"}'::jsonb`
      ).catch((e) => console.warn('[migration] knowledge_base.audience:', e?.message));
      // 知识库项目组名称：独立于文件标题，避免“组名=第一份文件名”
      await pool.query(
        `ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS group_name VARCHAR(120) DEFAULT NULL`
      ).catch((e) => console.warn('[migration] knowledge_base.group_name:', e?.message));
      await pool.query(
        `UPDATE knowledge_base
         SET group_name = COALESCE(NULLIF(group_name, ''), title)
         WHERE COALESCE(group_name, '') = ''`
      ).catch((e) => console.warn('[migration] knowledge_base.group_name.backfill:', e?.message));
      // Runtime migration: 文件管理系统表
      await pool.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        file_id VARCHAR(50) UNIQUE NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        stored_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(50),
        file_size BIGINT,
        checksum VARCHAR(64),
        source VARCHAR(50) DEFAULT 'manual_upload',
        store VARCHAR(100),
        brand VARCHAR(100),
        date_range_start DATE,
        date_range_end DATE,
        tags JSONB DEFAULT '[]'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        uploader_username VARCHAR(50),
        uploader_name VARCHAR(100),
        upload_ip VARCHAR(50),
        upload_note TEXT,
        related_task_id VARCHAR(50),
        validation_status VARCHAR(20) DEFAULT 'pending',
        validation_result JSONB,
        download_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP,
        deleted_by VARCHAR(50)
      )
      `).catch(e => console.warn('[migration] files table:', e?.message));
      await pool.query(`
      CREATE TABLE IF NOT EXISTS file_access_logs (
        id SERIAL PRIMARY KEY,
        file_id VARCHAR(50) NOT NULL,
        action VARCHAR(20) NOT NULL,
        username VARCHAR(50),
        ip VARCHAR(50),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
      `).catch(e => console.warn('[migration] file_access_logs table:', e?.message));
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_store ON files(store)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_file_access_logs_file_id ON file_access_logs(file_id)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_file_access_logs_created_at ON file_access_logs(created_at DESC)`).catch(() => {});
      await ensureDataGovernanceTables();
      await ensureAgentTables();
      // Runtime migration: 公司通知表（V2 Agent 写入，HRMS 前端读取，确保表存在）
      await pool.query(`
      CREATE TABLE IF NOT EXISTS hrms_user_notifications (
        id BIGSERIAL PRIMARY KEY,
        target_username TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'performance_deduction',
        meta JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
      `).catch(e => console.warn('[migration] hrms_user_notifications table:', e?.message));
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_hrms_notif_user_created ON hrms_user_notifications (target_username, created_at DESC)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_hrms_notif_task_id ON hrms_user_notifications ((meta->>'task_id'))`).catch(() => {});
      // Runtime migration: hrms_state 定时快照（整包 JSONB，供灾难恢复/对账；不依赖 ALLOW_SCHEMA_CHANGES）
      await pool.query(`
      CREATE TABLE IF NOT EXISTS hrms_state_snapshots (
        id BIGSERIAL PRIMARY KEY,
        state_key TEXT NOT NULL DEFAULT 'default',
        data JSONB NOT NULL,
        byte_size INTEGER,
        source TEXT NOT NULL DEFAULT 'scheduled',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
      `).catch(e => console.warn('[migration] hrms_state_snapshots table:', e?.message));
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_hrms_state_snapshots_key_created ON hrms_state_snapshots (state_key, created_at DESC)`
      ).catch(() => {});
      // Runtime migration: dedup unique index on agent_messages(record_id, content_type)
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_record_content_uniq ON agent_messages (record_id, content_type) WHERE record_id IS NOT NULL AND record_id != ''`).catch(e => console.warn('[migration] dedup index:', e?.message));
      assertCriticalFunctions();
      await ensureFeishuGenericRecordsTable();
      await ensureFeishuGenericRecordsNotifyTrigger();
    });
    // LLM健康检查 — 启动时验证所有大模型API可用，失败时飞书通知管理员
    verifyLLMHealth().then(h => {
      if (!h.allOk) console.error('[STARTUP] ⚠️ LLM health check FAILED — agents may be brainless!');
      else console.log('[STARTUP] ✅ All LLM providers healthy');
    }).catch(e => console.error('[STARTUP] LLM health check error:', e?.message));
    if (process.env.DISABLE_AGENT_SCHEDULING === 'true') {
      console.log('[agents] ⚠️ DISABLE_AGENT_SCHEDULING=true — agent scheduling delegated to V2');
    } else {
      startAgentScheduler();
      console.log('[agents] Multi-agent system initialized');
      startBitablePolling();
      startScheduledTasks();
      console.log('[agents] Bitable polling started, scheduled tasks started');
      startMasterAgent();
      console.log('[master] Master Agent orchestration initialized');
    }

    // Initialize Master Agent pools (needed for webhook handler even when scheduling disabled)
    // Schema DDL / numbered SQL re-runs: only when ALLOW_SCHEMA_CHANGES (prefer `node migrate.js` + schema_migrations)
    await runWithBootstrapTenantContext(async () => {
      if (__ALLOW_SCHEMA_CHANGES__) {
        await ensureMasterTables();

        // Legacy listen-time re-apply of numbered migrations (idempotent). New envs should use migrate.js instead.
        for (const name of [
          '008_agent_intelligence_upgrade',
          '009_agent_improvements',
          '012_metric_analysis_tree_and_experience',
          '013_daily_reports_operational_anomaly',
          '014_employee_attendance_payroll_domain',
          '020_daily_reports_all_fields',
          '021_hrms_leave_records',
          '022_hrms_reward_punishment_records',
          '023_approval_requests_migration',
          '024_employees_table_migration',
          '025_daily_reports_holiday_switch',
          '027_backfill_hrms_leave_from_approvals',
          '030_daily_report_attendance_register',
          '031_growth_miniprogram_events',
          '081_unique_constraints_tenant_id_batch9',
        ]) {
          try {
            const mig = await import('fs').then(f => f.promises.readFile(new URL(`./migrations/${name}.sql`, import.meta.url), 'utf8'));
            await pool.query(mig);
            console.log(`[migration] ${name} applied (listen-time, ALLOW_SCHEMA_CHANGES)`);
          } catch (e) {
            console.error(`[migration] ${name} error (non-fatal):`, e?.message);
          }
        }

        try {
          await ensureLeaveDomainTable();
          console.log('[startup] hrms_leave_domain table ready');
        } catch (e) {
          console.error('[startup] hrms_leave_domain table init failed (non-fatal):', e?.message);
        }
      }

    });

    // 启动时的数据互备/重建全部按已注册活跃租户执行。这里不能使用 bootstrap/default
    // 上下文，否则多租户库重启后只有 default 会被修复，其余租户会永久跳过。
    const startupTenantReconcile = await runForActiveTenants(async (tenantId) => {
    // 启动时权威重建：每次启动都从 daily_reports 表完整重建 hrms_state.dailyReports
    // 策略：DB 是基础字段（营收/订单等）的权威来源；但明细字段（segments/categories/staff/photos/schedule_next_day/weather/discount/bad_reviews）
    //       DB 从未写入过，必须从 state 保留，否则每次重启明细数据全部丢失。
    // 修复历史：raw row_to_json 写入导致 data.actual=0，pg date 时区偏移导致日期差1天
      try {
      const pgAll = await pool.query(`
        SELECT store, date, brand, actual_revenue, pre_discount_revenue, total_discount,
               dine_orders, dine_revenue, dine_traffic, efficiency, labor_total,
               actual_margin, gross_profit, dianping_rating, new_wechat_members, wechat_month_total,
               private_room_uses, operational_anomaly_note, delivery_pre_revenue, delivery_actual,
               delivery_orders, delivery_bad_reviews, budget, budget_rate, submitted, submitted_at, updated_at,
               recharge_count, recharge_amount,
               weather, segments, discount_dine, discount_delivery, categories, delivery_detail,
               bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch
        FROM daily_reports
        ORDER BY date DESC
      `);
      const dbItems = pgAll.rows.map(row => dailyReportItemFromPgRow(row));
      const dbKeySet = new Set(dbItems.map(x => `${x.date}|${x.store}`));

      const state0 = (await getSharedState()) || {};
      const existingArr = Array.isArray(state0.dailyReports) ? state0.dailyReports : [];

      // 明细字段列表（DB 从未写入，必须从 state 保留）
      const DETAIL_FIELDS = ['segments', 'categories', 'staff', 'scheduleNextDay', 'photos', 'weather', 'discount', 'badReviews'];

      // 合并策略：DB 基础字段 + state 明细字段
      const merged = dbItems.map(dbItem => {
        const k = `${dbItem.date}|${dbItem.store}`;
        const stateItem = existingArr.find(s => `${String(s?.date || '').slice(0, 10)}|${String(s?.store || '').trim()}` === k);
        if (!stateItem?.data) return dbItem;
        // 从 state 补充明细字段（仅当 DB 为空时）
        const mergedData = { ...dbItem.data };
        for (const f of DETAIL_FIELDS) {
          const dbVal = dbItem.data[f];
          const stVal = stateItem.data[f];
          const dbEmpty = dbVal === undefined || dbVal === null || (typeof dbVal === 'object' && Object.keys(dbVal).length === 0) || (Array.isArray(dbVal) && dbVal.length === 0);
          const stHas = stVal !== undefined && stVal !== null && (typeof stVal !== 'object' || Object.keys(stVal).length > 0) && (!Array.isArray(stVal) || stVal.length > 0);
          if (dbEmpty && stHas) {
            mergedData[f] = stVal;
          }
        }
        return { ...dbItem, data: mergedData };
      });

      // 保留 state 里的草稿（DB 没有对应记录的条目）
      const stateOnlyItems = existingArr.filter(r => {
        const k = `${String(r?.date || '').slice(0, 10)}|${String(r?.store || '').trim()}`;
        return !dbKeySet.has(k);
      });

      const finalMerged = [...merged, ...stateOnlyItems];
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        const cur = await client2.query(`SELECT data FROM hrms_state WHERE key=$1 FOR UPDATE`, [tenantId]);
        const curData = cur.rows[0]?.data || {};
        await client2.query(
          `UPDATE hrms_state SET data=$2::jsonb, updated_at=NOW() WHERE key=$1`,
          [tenantId, JSON.stringify({ ...curData, dailyReports: finalMerged })]
        );
        await client2.query('COMMIT');
      } finally {
        client2.release();
      }
      console.log(`[startup] 日报权威重建：DB ${dbItems.length} 条 + 草稿 ${stateOnlyItems.length} 条 = 共 ${finalMerged.length} 条`);
      } catch (e) {
        console.error('[startup] 日报权威重建失败（非致命，不影响启动）:', e?.message);
      }

    // 启动时权威重建：从 point_records 表完整重建 hrms_state.pointRecords
    // 策略：DB 表是唯一权威，覆盖 state 里所有同 id 的条目，保留 state 里没有 id 的孤立记录
      try {
      const prRows = await pool.query(`
        SELECT id::text, approval_id, username, name, store, item_name, reason,
               points, amount, approved_at, approved_by
        FROM point_records
        ORDER BY approved_at DESC NULLS LAST, created_at DESC
      `);
      const dbPrItems = prRows.rows.map(row => ({
        id: row.id,
        approvalId: row.approval_id || '',
        username: row.username || '',
        name: row.name || '',
        store: row.store || '',
        itemName: row.item_name || '',
        reason: row.reason || '',
        points: Number(row.points) || 0,
        amount: Number(row.amount) || 0,
        approvedAt: row.approved_at ? String(row.approved_at) : '',
        approvedBy: row.approved_by || '',
      }));
      const dbPrIds = new Set(dbPrItems.map(x => x.id));

      const state1 = (await getSharedState()) || {};
      const existingPr = Array.isArray(state1.pointRecords) ? state1.pointRecords : [];
      // Keep state-only records without valid id (edge case)
      const stateOnlyPr = existingPr.filter(r => r?.id && !dbPrIds.has(r.id));

      const mergedPr = [...dbPrItems, ...stateOnlyPr];
      const client3 = await pool.connect();
      try {
        await client3.query('BEGIN');
        const cur3 = await client3.query(`SELECT data FROM hrms_state WHERE key=$1 FOR UPDATE`, [tenantId]);
        const curData3 = cur3.rows[0]?.data || {};
        await client3.query(
          `UPDATE hrms_state SET data=$2::jsonb, updated_at=NOW() WHERE key=$1`,
          [tenantId, JSON.stringify({ ...curData3, pointRecords: mergedPr })]
        );
        await client3.query('COMMIT');
      } finally {
        client3.release();
      }
      console.log(`[startup] 积分记录权威重建：DB ${dbPrItems.length} 条 + 孤立 ${stateOnlyPr.length} 条 = 共 ${mergedPr.length} 条`);
      } catch (e) {
        console.error('[startup] 积分记录权威重建失败（非致命，不影响启动）:', e?.message);
      }

    // 考勤双表互备：checkin_records ↔ employee_attendance_records 补缺（防单表损坏）
      try {
      const insToMirror = await pool.query(`
        INSERT INTO employee_attendance_records (
          id, username, store, type, check_time, latitude, longitude, distance_meters,
          face_match, face_score, photo_url, status, note, confirmed_by, confirmed_at, created_at, synced_at
        )
        SELECT c.id, c.username, c.store, c.type, c.check_time::timestamptz, c.latitude, c.longitude, c.distance_meters,
               c.face_match, c.face_score, c.photo_url, c.status, c.note, c.confirmed_by, c.confirmed_at::timestamptz,
               c.created_at::timestamptz, NOW()
        FROM checkin_records c
        WHERE NOT EXISTS (SELECT 1 FROM employee_attendance_records e WHERE e.id = c.id)
      `);
      const insToCheckin = await pool.query(`
        INSERT INTO checkin_records (
          id, username, store, type, check_time, latitude, longitude, distance_meters,
          face_match, face_score, photo_url, status, note, confirmed_by, confirmed_at, created_at
        )
        SELECT e.id, e.username, e.store, e.type, e.check_time, e.latitude, e.longitude, e.distance_meters,
               e.face_match, e.face_score, e.photo_url, e.status, e.note, e.confirmed_by, e.confirmed_at, e.created_at
        FROM employee_attendance_records e
        WHERE NOT EXISTS (SELECT 1 FROM checkin_records c WHERE c.id = e.id)
      `);
      console.log(
        `[startup] 考勤双表同步：→镜像 ${insToMirror.rowCount || 0} 条，→checkin ${insToCheckin.rowCount || 0} 条`
      );
      } catch (e) {
        console.error('[startup] 考勤双表同步失败（非致命，不影响启动）:', e?.message);
      }

    // 薪资域双备：state 某字段空则从 hrms_payroll_domain 回灌，再写回独立表
      try {
      const domainR = await pool.query(`SELECT * FROM hrms_payroll_domain WHERE id = $1`, [tenantId]);
      const row = domainR.rows?.[0];
      if (row) {
        let stateP = (await getSharedState()) || {};
        let changed = false;
        const pairs = [
          ['payrollAdjustments', 'payroll_adjustments'],
          ['payrollAudits', 'payroll_audits'],
          ['salaryAdjustments', 'salary_adjustments'],
          ['monthlyConfirmations', 'monthly_confirmations']
        ];
        for (const [sk, col] of pairs) {
          const dbVal = row[col];
          const stVal = stateP[sk];
          if (payrollDomainFieldEmpty(stVal) && !payrollDomainFieldEmpty(dbVal)) {
            stateP = { ...stateP, [sk]: dbVal };
            changed = true;
          }
        }
        if (changed) {
          await pool.query(
            `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`,
            [tenantId, JSON.stringify(stateP)]
          );
          console.log('[startup] 薪资域从 hrms_payroll_domain 回灌到 hrms_state');
        }
      }
      const freshState = (await getSharedState()) || {};
      await upsertPayrollDomainFromState(freshState);
      } catch (e) {
        console.error('[startup] 薪资域互备同步失败（非致命，不影响启动）:', e?.message);
      }

    // 欠休/累计假域双备：state 某字段空则从 hrms_leave_domain 回灌，再写回独立表
      try {
      const leaveDomainR = await pool.query(`SELECT * FROM hrms_leave_domain WHERE id = $1`, [tenantId]);
      const row = leaveDomainR.rows?.[0];
      if (row) {
        let stateL = (await getSharedState()) || {};
        let changed = false;
        const pairs = [
          ['leaveBalanceOverrides', 'leave_balance_overrides'],
          ['leaveBalanceAdjustments', 'leave_balance_adjustments'],
          ['leaveCumulativeCloseSnapshots', 'leave_cumulative_close_snapshots']
        ];
        for (const [sk, col] of pairs) {
          const dbVal = row[col];
          const stVal = stateL[sk];
          if (leaveDomainFieldEmpty(stVal) && !leaveDomainFieldEmpty(dbVal)) {
            stateL = { ...stateL, [sk]: dbVal };
            changed = true;
          }
        }
        if (changed) {
          await pool.query(
            `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`,
            [tenantId, JSON.stringify(stateL)]
          );
          console.log('[startup] 欠休域从 hrms_leave_domain 回灌到 hrms_state');
        }
      }
      const freshLeaveState = (await getSharedState()) || {};
      await upsertLeaveDomainFromState(freshLeaveState);
      } catch (e) {
        console.error('[startup] 欠休域互备同步失败（非致命，不影响启动）:', e?.message);
      }

    // A1：启动时 state→表补齐；表中多出的账号回灌 state 镜像（GET 仍以表 hydrate 为准）
      try {
      const employeeSyncSummary = await tenantContext.run(tenantId, async () => {
          const stateEmp = (await getSharedState(tenantId)) || {};
          const empArr = Array.isArray(stateEmp.employees) ? stateEmp.employees : [];
          const syncedToTable = await upsertEmployeesFromStateShape(pool, tenantId, empArr);
          const dbEmpItems = await loadEmployeesFromTable(pool, tenantId);

          let backfilledToState = 0;
          if (dbEmpItems.length > 0) {
            const existingEmployees = Array.isArray(stateEmp.employees) ? stateEmp.employees : [];
            const existingUsernames = new Set(existingEmployees.map(e => String(e?.username || '').trim().toLowerCase()));
            const newEmps = dbEmpItems.filter(e => e.username && !existingUsernames.has(e.username.toLowerCase()));
            if (newEmps.length > 0) {
              await mergeSharedStateFields({ employees: newEmps }, { employees: 'username' }, tenantId);
              backfilledToState = newEmps.length;
            }
          }

          console.log(`[startup][${tenantId}] 员工信息同步：${syncedToTable} 条 → employees 表；回灌 ${backfilledToState} 条 → hrms_state.employees`);
          return { tenantId, syncedToTable, backfilledToState };
      });
      console.log(`[startup][${tenantId}] 员工同步完成：写表 ${employeeSyncSummary.syncedToTable}，回灌 ${employeeSyncSummary.backfilledToState}`);
      } catch (e) {
        console.error('[startup] 多租户员工同步失败（非致命，不影响启动）:', e?.message);
      }

    // 启动时休假记录重建：hrms_leave_records DB → hrms_state.leaveRecords
      try {
      const dbLeave = await pool.query(`SELECT * FROM hrms_leave_records ORDER BY start_date DESC`);
      const dbLeaveItems = dbLeave.rows.map(r => ({
        id: String(r.id || ''),
        applicant: String(r.username || '').trim(),
        applicantName: String(r.name || '').trim(),
        store: String(r.store || '').trim(),
        brand: String(r.brand || '').trim(),
        startDate: r.start_date ? String(r.start_date).slice(0, 10) : '',
        endDate: r.end_date ? String(r.end_date).slice(0, 10) : '',
        days: r.days != null ? Number(r.days) : '',
        type: String(r.type || 'leave').trim(),
        reason: String(r.reason || '').trim(),
        createdAt: r.created_at ? String(r.created_at) : '',
        status: String(r.status || 'approved').trim()
      }));
      const dbLeaveKeySet = new Set(dbLeaveItems.map(x => `${x.applicant}|${x.startDate}|${x.endDate}`));
      let stateLeave = (await getSharedState()) || {};
      const existingLeave = Array.isArray(stateLeave.leaveRecords) ? stateLeave.leaveRecords : [];
      const stateOnlyLeave = existingLeave.filter(r => {
        const k = `${String(r?.applicant || '').trim()}|${String(r?.startDate || '').trim()}|${String(r?.endDate || '').trim()}`;
        return !dbLeaveKeySet.has(k);
      });
      const mergedLeave = [...dbLeaveItems, ...stateOnlyLeave];
      if (mergedLeave.length !== existingLeave.length) {
        stateLeave = { ...stateLeave, leaveRecords: mergedLeave };
        await pool.query(`UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`, [tenantId, JSON.stringify(stateLeave)]);
      }
      console.log(`[startup] 休假记录重建：DB ${dbLeaveItems.length} 条 + 草稿 ${stateOnlyLeave.length} 条 = 共 ${mergedLeave.length} 条`);
      } catch (e) {
        console.error('[startup] 休假记录重建失败（非致命，不影响启动）:', e?.message);
      }

    // 启动时奖惩记录重建：hrms_reward_punishment_records DB → hrms_state.salaryAdjustments
      try {
      const dbRP = await pool.query(`SELECT * FROM hrms_reward_punishment_records WHERE status = 'active' ORDER BY created_at DESC`);
      const dbRPItems = dbRP.rows.map(r => ({
        id: String(r.id || ''),
        approvalId: String(r.approval_id || ''),
        targetUsername: String(r.username || '').trim(),
        targetName: String(r.name || '').trim(),
        type: String(r.type === 'reward' ? '奖励' : '惩罚').trim(),
        amount: Number(r.amount) || 0,
        signedAmount: r.type === 'reward' ? Math.abs(Number(r.amount) || 0) : -Math.abs(Number(r.amount) || 0),
        reason: String(r.reason || '').trim(),
        result: '',
        applicantUsername: String(r.created_by || '').trim(),
        applicantName: String(r.created_by || '').trim(),
        createdAt: r.created_at ? String(r.created_at) : '',
        status: 'approved'
      }));
      const dbRPKeySet = new Set(dbRPItems.map(x => x.id));
      let stateRP = (await getSharedState()) || {};
      const existingRP = Array.isArray(stateRP.salaryAdjustments) ? stateRP.salaryAdjustments : [];
      const stateOnlyRP = existingRP.filter(r => r?.id && !dbRPKeySet.has(r.id));
      const mergedRP = [...dbRPItems, ...stateOnlyRP];
      if (mergedRP.length !== existingRP.length) {
        stateRP = { ...stateRP, salaryAdjustments: mergedRP };
        await pool.query(`UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`, [tenantId, JSON.stringify(stateRP)]);
      }
      console.log(`[startup] 奖惩记录重建：DB ${dbRPItems.length} 条 + 孤立 ${stateOnlyRP.length} 条 = 共 ${mergedRP.length} 条`);
      } catch (e) {
        console.error('[startup] 奖惩记录重建失败（非致命，不影响启动）:', e?.message);
      }

    // 启动时审批记录重建：approval_requests DB 已是权威，无需回灌 state（审批本身就是独立表）
    // 但确认表存在
      try {
      const arCheck = await pool.query(`SELECT COUNT(*) as cnt FROM approval_requests`);
      console.log(`[startup] 审批记录表：${arCheck.rows[0]?.cnt || 0} 条`);
      } catch (e) {
        console.error('[startup] 审批记录表检查失败（非致命，不影响启动）:', e?.message);
      }

    // 启动时公司通知重建：hrms_user_notifications DB → hrms_state.notifications
    // V2 Agent 直接写 DB，HRMS 前端从 state 读取，需要回灌
    // 注意：前端按 targetUser 字段过滤，必须使用 targetUser 而非 targetUsername
      try {
      const dbNotif = await pool.query(`SELECT * FROM hrms_user_notifications ORDER BY created_at DESC LIMIT 500`);
      const dbNotifItems = dbNotif.rows.map(r => ({
        id: String(r.id || ''),
        targetUser: String(r.target_username || '').trim(),
        title: String(r.title || '').trim(),
        message: String(r.message || '').trim(),
        type: String(r.type || 'performance_deduction').trim(),
        meta: r.meta && typeof r.meta === 'object' ? r.meta : {},
        createdAt: r.created_at ? String(r.created_at) : ''
      }));
      if (dbNotifItems.length > 0) {
        let stateNotif = (await getSharedState()) || {};
        const existingNotifs = Array.isArray(stateNotif.notifications) ? stateNotif.notifications : [];
        const dbNotifIds = new Set(dbNotifItems.map(n => n.id));
        const stateOnlyNotifs = existingNotifs.filter(n => n?.id && !dbNotifIds.has(n.id));
        const mergedNotifs = [...dbNotifItems, ...stateOnlyNotifs];
        if (mergedNotifs.length !== existingNotifs.length) {
          stateNotif = { ...stateNotif, notifications: mergedNotifs };
          await pool.query(`UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`, [tenantId, JSON.stringify(stateNotif)]);
        }
        console.log(`[startup] 公司通知重建：DB ${dbNotifItems.length} 条 + 孤立 ${stateOnlyNotifs.length} 条 = 共 ${mergedNotifs.length} 条`);
      }
      } catch (e) {
        console.error('[startup] 公司通知重建失败（非致命，不影响启动）:', e?.message);
      }

    // ── 历史数据回填（state → DB，一次性补缺） ──

    // 回填：hrms_state.leaveRecords → hrms_leave_records
      try {
      const stateLR = (await getSharedState()) || {};
      const lrList = Array.isArray(stateLR.leaveRecords) ? stateLR.leaveRecords : [];
      if (lrList.length > 0) {
        const existingIds = await pool.query(`SELECT id::text FROM hrms_leave_records`);
        const existingSet = new Set(existingIds.rows.map(r => r.id));
        let backfillCount = 0;
        for (const lr of lrList) {
          const rid = String(lr?.id || '').trim();
          if (!rid || existingSet.has(rid)) continue;
          const startDate = String(lr?.startDate || '').trim();
          const endDate = String(lr?.endDate || '').trim();
          if (!startDate || !endDate) continue;
          await pool.query(
            `INSERT INTO hrms_leave_records (id, username, name, store, brand, start_date, end_date, days, type, reason, status, submitted_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11,$12)
             ON CONFLICT (id) DO NOTHING`,
            [rid, String(lr?.applicant || '').trim(), String(lr?.applicantName || lr?.name || '').trim(),
             String(lr?.store || '').trim(), String(lr?.brand || '').trim(),
             startDate, endDate, lr?.days != null && lr?.days !== '' ? Number(lr.days) : 0,
             String(lr?.type || 'leave').trim(), String(lr?.reason || '').trim(),
             String(lr?.createdAt || '').trim() || hrmsNowISO(), String(lr?.createdAt || '').trim() || hrmsNowISO()]
          );
          backfillCount++;
        }
        if (backfillCount > 0) console.log(`[startup] 休假记录回填：${backfillCount} 条 state → hrms_leave_records`);
      }
      } catch (e) {
        console.error('[startup] 休假记录回填失败（非致命）:', e?.message);
      }

    // 回填：hrms_state.salaryAdjustments → hrms_reward_punishment_records
    // 该表已开FORCE RLS；这段跑在app.listen启动回调里，没有HTTP请求/ALS上下文，
    // 必须显式包裹tenantContext.run，否则resolveTenantIdDefault()返回'default'但
    // session变量是fail-closed的sentinel，写入会被WITH CHECK拒绝。
      try {
      const stateSA = (await getSharedState()) || {};
      const saList = Array.isArray(stateSA.salaryAdjustments) ? stateSA.salaryAdjustments : [];
      if (saList.length > 0) {
        const existingIds = await pool.query(`SELECT id::text FROM hrms_reward_punishment_records`);
        const existingSet = new Set(existingIds.rows.map(r => r.id));
        let backfillCount = 0;
        for (const sa of saList) {
          const rid = String(sa?.id || '').trim();
          if (!rid || existingSet.has(rid)) continue;
          const rpType = String(sa?.type || '').trim();
          const isReward = rpType === '奖励' || rpType === 'reward';
          await pool.query(
            `INSERT INTO hrms_reward_punishment_records (id, username, name, store, brand, type, category, amount, reason, source, approval_id, status, created_by, created_at, tenant_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approval',$10,'active',$11,$12,$13)
             ON CONFLICT (id) DO NOTHING`,
            [rid, String(sa?.targetUsername || '').trim(), String(sa?.targetName || '').trim(),
             '', '', isReward ? 'reward' : 'punishment', rpType,
             Math.abs(Number(sa?.amount) || 0), String(sa?.reason || '').trim(),
             toNullableUuid(sa?.approvalId), String(sa?.applicantUsername || '').trim(),
             String(sa?.createdAt || '').trim() || hrmsNowISO(),
             resolveTenantIdDefault()]
          );
          backfillCount++;
        }
        if (backfillCount > 0) console.log(`[startup] 奖惩记录回填：${backfillCount} 条 state → hrms_reward_punishment_records`);
      }
      } catch (e) {
        console.error('[startup] 奖惩记录回填失败（非致命）:', e?.message);
      }

    // 回填：hrms_state.dailyReports → daily_reports 表（补充缺失的明细字段）
      try {
      const stateDR = (await getSharedState()) || {};
      const drList = Array.isArray(stateDR.dailyReports) ? stateDR.dailyReports : [];
      if (drList.length > 0) {
        let backfillCount = 0;
        for (const dr of drList) {
          const d = dr?.data;
          if (!d) continue;
          const store = String(dr?.store || '').trim();
          const date = String(dr?.date || '').trim().slice(0, 10);
          if (!store || !date) continue;

          const segments = d?.segments ? JSON.stringify(d.segments) : null;
          const categories = d?.categories ? JSON.stringify(d.categories) : null;
          const deliveryDetail = d?.delivery ? JSON.stringify(d.delivery) : null;
          const staff = d?.staff ? JSON.stringify(d.staff) : null;
          const scheduleNextDay = d?.scheduleNextDay ? JSON.stringify(d.scheduleNextDay) : null;
          const photos = d?.photos ? JSON.stringify(d.photos) : null;
          const weather = String(d?.weather || '').trim() || null;
          const holidaySwitch = !!(d?.holiday_switch ?? d?.holidaySwitch);
          const discountDine = Number(d?.discount?.dine) || 0;
          const discountDelivery = Number(d?.discount?.delivery) || 0;
          const badReviewsDianping = Math.floor(Number(d?.badReviews?.dianping) || 0);

          const hasDetail = segments || categories || deliveryDetail || staff || scheduleNextDay || photos || weather || discountDine || discountDelivery || holidaySwitch;
          if (!hasDetail) continue;

          await pool.query(
            `UPDATE daily_reports SET
               segments = COALESCE($3, segments),
               categories = COALESCE($4, categories),
               delivery_detail = COALESCE($5, delivery_detail),
               staff = COALESCE($6, staff),
               schedule_next_day = COALESCE($7, schedule_next_day),
               photos = COALESCE($8, photos),
               weather = COALESCE($9, weather),
               discount_dine = COALESCE($10, discount_dine),
               discount_delivery = COALESCE($11, discount_delivery),
               bad_reviews_dianping = COALESCE($12, bad_reviews_dianping),
               holiday_switch = COALESCE($13, holiday_switch),
               updated_at = NOW()
             WHERE store = $1 AND date = $2::date`,
            [store, date, segments, categories, deliveryDetail, staff, scheduleNextDay, photos, weather, discountDine, discountDelivery, badReviewsDianping, holidaySwitch]
          );
          backfillCount++;
        }
        if (backfillCount > 0) console.log(`[startup] 营业日报明细回填：${backfillCount} 条 state → daily_reports`);
      }
      } catch (e) {
        console.error('[startup] 营业日报明细回填失败（非致命）:', e?.message);
      }

    // 补缺：daily_reports 已有但 daily_report_attendance_register 缺失（功能上线前提交的双写）
      try {
      const bf = await backfillDailyAttendanceRegisterMissing(pool, { maxRows: 2500 });
      if (bf.reconciled > 0) {
        console.log(`[startup] 出勤台账补缺：扫描 ${bf.scanned} 条，写入 ${bf.reconciled} 条`);
      }
      } catch (e) {
        console.error('[startup] 出勤台账补缺失败（非致命）:', e?.message);
      }

      await dedupeGlobalSocialMediaPointRules();
      await ensureGlobalSocialMediaPointRule();
    }, {
      continueOnError: true,
      onError: ({ tenantId, error }) => {
        console.error(`[startup][${tenantId}] 租户数据重建失败（非致命）:`, safeErrMessage(error));
      }
    });
    console.log(`[startup] 多租户数据重建完成：成功 ${startupTenantReconcile.results.length}，失败 ${startupTenantReconcile.errors.length}`);

    // P0B: Purge expired session states every hour
    // 原用runWithBootstrapTenantContext只清default租户，agent_long_memory开了RLS，改为遍历活跃租户各自清理
    setInterval(async () => {
      try {
        await runForActiveTenants(async (tenantId) => {
          try {
            const r = await pool.query(
              `DELETE FROM agent_long_memory
               WHERE memory_key = 'session_state'
                 AND updated_at < NOW() - INTERVAL '2 hours'`
            );
            if (r.rowCount > 0) console.log(`[intelligence] Purged ${r.rowCount} expired session states, tenant=${tenantId}`);
          } catch (e) {
            console.error('[intelligence] Session state purge error:', tenantId, e?.message);
          }
        }, { continueOnError: true });
      } catch (e) {
        console.error('[intelligence] Session state purge runForActiveTenants error:', e?.message || e);
      }
    }, 60 * 60 * 1000);

    // ── P0-3: 定时任务心跳表（表结构由 migrate / 093 等提供；启动仅在允许 schema 变更时 ensure）──
    if (__ALLOW_SCHEMA_CHANGES__) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS scheduler_heartbeat (
            task_name   TEXT PRIMARY KEY,
            last_beat   TIMESTAMPTZ DEFAULT NOW(),
            run_count   BIGINT DEFAULT 0
          )
        `);
        console.log('[monitor] scheduler_heartbeat table ready');
      } catch (e) {
        console.error('[monitor] heartbeat table init error:', e?.message);
      }
    }

    // 辅助：写心跳。task_name是全局单例系统任务(cache_purge/critical_data_reconcile/pos_sales_check)，
    // 不属于任何具体租户，固定写tenant_id='default'并在同一上下文里设置会话变量，
    // 避免RLS的WITH CHECK因为会话变量(无上下文时是哨兵值)跟列默认值'default'不一致而静默拒绝写入。
    async function beatHeartbeat(taskName) {
      try {
        // ALLOWED_SYSTEM_DEFAULT: 全局调度心跳
        await tenantContext.run('default', async () => {
          await pool.query(
            `INSERT INTO scheduler_heartbeat (task_name, last_beat, run_count, tenant_id)
             VALUES ($1, NOW(), 1, 'default')
             ON CONFLICT (task_name)
             DO UPDATE SET last_beat = NOW(), run_count = scheduler_heartbeat.run_count + 1`,
            [taskName]
          );
        });
      } catch (_) { /* ignore */ }
    }

    // 辅助：给管理员发送系统告警，并同步写入 HRMS 公司通知
    async function sendSystemAlert(msg) {
      try {
        await sendAdminSystemAlert(msg, {
          persistToHrms: true,
          notificationType: 'system_alert',
          meta: { source: 'monitor' }
        });
      } catch (e) {
        console.error('[monitor] sendSystemAlert error:', e?.message);
      }
    }

    const HEARTBEAT_ALERT_THRESHOLDS_MIN = {
      cache_purge: 390, // cache_purge 每 2 小时一次，放宽到 6.5 小时避免夜间误报
      // 销售完整性检查每天23:30只执行一次；连续72小时未更新才告警。
      pos_sales_check: 72 * 60,
      default: 180
    };
    const heartbeatAlertDedup = new Map();

    // 带心跳的缓存清理（覆盖原 setInterval）
    // agent_metric_cache 带tenant_id/RLS，原只清default租户会导致其他租户缓存堆积不过期；改为遍历活跃租户。
    // 心跳(beatHeartbeat)本身是系统级监控，不依赖租户上下文，仍在租户循环外单独打一次。
    const runCachePurge = async () => {
      try {
        await runForActiveTenants(() => purgeExpiredCache().catch(() => {}), { continueOnError: true });
      } catch (e) {
        console.error('[cache_purge] runForActiveTenants error:', e?.message || e);
      }
      await beatHeartbeat('cache_purge');
    };
    setInterval(runCachePurge, 2 * 60 * 60 * 1000);
    // 启动即执行一次并写心跳，避免重启后首个 2 小时窗口误判为“任务停摆”
    setTimeout(runCachePurge, 15 * 1000);

    // ── P0-3: 每 30 分钟检查心跳是否存活 ────────────────────────
    setInterval(async () => {
      await runWithBootstrapTenantContext(async () => {
        try {
          const r = await pool.query(`
            SELECT task_name,
                   EXTRACT(EPOCH FROM (NOW() - last_beat)) / 60 AS minutes_ago
            FROM scheduler_heartbeat
          `);
          const staleRows = (r.rows || []).filter((row) => {
            const name = String(row?.task_name || '').trim();
            const mins = Number(row?.minutes_ago || 0);
            const th = Number(HEARTBEAT_ALERT_THRESHOLDS_MIN[name] || HEARTBEAT_ALERT_THRESHOLDS_MIN.default);
            return Number.isFinite(mins) && mins >= th;
          });
          if (staleRows.length > 0) {
            const dead = staleRows
              .map(row => `${row.task_name}（${Math.floor(Number(row.minutes_ago || 0))}分钟前）`)
              .join('、');
            const dedupeKey = staleRows
              .map((row) => `${row.task_name}:${Math.floor(Number(row.minutes_ago || 0) / 30)}`)
              .join('|');
            const lastSent = Number(heartbeatAlertDedup.get(dedupeKey) || 0);
            if (Date.now() - lastSent < 2 * 60 * 60 * 1000) return;
            heartbeatAlertDedup.set(dedupeKey, Date.now());
            const msg = `🚨 [HRMS] 定时任务心跳异常\n停止任务：${dead}\n请登录服务器检查：\nsystemctl status hrms.service`;
            console.error('[monitor] Dead tasks:', dead);
            await sendSystemAlert(msg);
          }
        } catch (e) {
          console.error('[monitor] heartbeat check error:', e?.message);
        }
      });
    }, 30 * 60 * 1000);

    // 原为单一字符串，改为按租户区分的Map，避免A租户的告警状态误挡住B租户
    const _perfMonthlyMissingAlertKey = new Map();

    // 核心数据每 10 分钟自愈回灌一次：即使 hrms_state 被旧快照污染，也会从权威表/独立域自动拉回
    // 原用 runWithBootstrapTenantContext 只处理default租户；daily_reports/point_records等查询本身
    // 靠pool的RLS会话变量自动按租户过滤，但getSharedState()/hrms_state.key='default'是硬编码的，
    // 改为遍历活跃租户各自处理各自的hrms_state.key。
    setInterval(async () => {
      try {
      await runForActiveTenants(async (tenantId) => {
        try {
          await beatHeartbeat('critical_data_reconcile');
          const stateNow = (await getSharedState(tenantId)) || {};

        // 1) 营业日报：若 state 最新日期落后于表最新日期，则整段重建
        const drLatestR = await pool.query(`SELECT MAX(date)::text AS latest FROM daily_reports`);
        const drLatest = String(drLatestR.rows?.[0]?.latest || '').trim();
        const stateDrLatest = (Array.isArray(stateNow.dailyReports) ? stateNow.dailyReports : [])
          .map(r => String(r?.date || '').slice(0, 10))
          .filter(Boolean)
          .sort()
          .pop() || '';
        if (drLatest && drLatest > stateDrLatest) {
          const pgAll = await pool.query(`
            SELECT store, date, brand, actual_revenue, pre_discount_revenue, total_discount,
                   dine_orders, dine_revenue, dine_traffic, efficiency, labor_total,
                   actual_margin, gross_profit, dianping_rating, new_wechat_members, wechat_month_total,
                   private_room_uses, operational_anomaly_note, delivery_pre_revenue, delivery_actual,
                   delivery_orders, delivery_bad_reviews, budget, budget_rate, submitted, submitted_at, updated_at,
                   recharge_count, recharge_amount,
                   weather, segments, discount_dine, discount_delivery, categories, delivery_detail,
                   bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch
            FROM daily_reports
            ORDER BY date DESC
          `);
          const dbItems = pgAll.rows.map(row => dailyReportItemFromPgRow(row));
          // 保留 state 中的草稿（DB 没有的行），避免直接覆写丢失
          const existingArr = Array.isArray(stateNow.dailyReports) ? stateNow.dailyReports : [];
          const dbKeySet = new Set(dbItems.map(x => `${x.date}|${x.store}`));
          const stateOnlyItems = existingArr.filter(r => {
            const k = `${String(r?.date || '').slice(0, 10)}|${String(r?.store || '').trim()}`;
            return !dbKeySet.has(k);
          });
          const finalItems = [...dbItems, ...stateOnlyItems];
          // 直接 UPDATE hrms_state 的 dailyReports 字段，不经过 mergeSharedStateFields（避免与用户提交抢乐观锁）
          await pool.query(
            `UPDATE hrms_state SET data = jsonb_set(COALESCE(data, '{}'), '{dailyReports}', $1::jsonb), updated_at = NOW() WHERE key = $2`,
            [JSON.stringify(finalItems), tenantId]
          );
          await sendSystemAlert(`⚠️ [HRMS] 核心数据自愈：租户${tenantId} 营业日报 state 最新日期 ${stateDrLatest || '无'} 落后于表 ${drLatest}，已自动回灌。`);
        }

        // 2) 积分：若 point_records 数量大于 state.pointRecords，则自动重建
        const prCountR = await pool.query(`SELECT COUNT(*)::int AS c FROM point_records`);
        const dbPrCount = Number(prCountR.rows?.[0]?.c || 0);
        const statePrCount = Array.isArray(stateNow.pointRecords) ? stateNow.pointRecords.length : 0;
        if (dbPrCount > statePrCount) {
          const prRows = await pool.query(`
            SELECT id::text, approval_id, username, name, store, item_name, reason, points, amount, approved_at, approved_by
            FROM point_records
            ORDER BY approved_at DESC NULLS LAST, created_at DESC
          `);
          const dbPrItems = prRows.rows.map(row => ({
            id: row.id,
            approvalId: row.approval_id || '',
            username: row.username || '',
            name: row.name || '',
            store: row.store || '',
            itemName: row.item_name || '',
            reason: row.reason || '',
            points: Number(row.points) || 0,
            amount: Number(row.amount) || 0,
            approvedAt: row.approved_at ? String(row.approved_at) : '',
            approvedBy: row.approved_by || '',
          }));
          await mergeSharedStateFields({ pointRecords: dbPrItems }, { pointRecords: 'id' });
          await sendSystemAlert(`⚠️ [HRMS] 核心数据自愈：积分记录 state=${statePrCount} 落后于表=${dbPrCount}，已自动回灌。`);
        }

        // 3) 绩效月结果：10 日关账窗口后，若应产出的月度绩效结果明显缺失，第一时间通知管理员。
        const shParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          hour12: false
        }).formatToParts(new Date());
        const shDay = Number(shParts.find((p) => p.type === 'day')?.value || '0');
        const shHour = Number(shParts.find((p) => p.type === 'hour')?.value || '0');
        // agents-service-v2 月度成绩单在每月10日 01:18 写入；此前告警属于误报窗口。
        const pastMonthlyCloseWindow = shDay > 10 || (shDay === 10 && shHour >= 2);
        if (pastMonthlyCloseWindow) {
          const period = getExpectedMonthlyPerformancePeriodShanghai();
          const eligibleCount = await countEligibleMonthlyPerformanceUsers().catch(() => 0);
          if (eligibleCount > 0) {
            const perfCountR = await pool.query(
              `SELECT COUNT(*)::int AS c
               FROM agent_scores
               WHERE period = $1 AND score_model = 'new_model_monthly'`,
              [period]
            );
            const actualCount = Number(perfCountR.rows?.[0]?.c || 0);
            const minimumExpected = Math.max(1, Math.floor(eligibleCount * 0.8));
            const alertKey = `${period}:${eligibleCount}:${actualCount}`;
            if (actualCount < minimumExpected && _perfMonthlyMissingAlertKey.get(tenantId) !== alertKey) {
              _perfMonthlyMissingAlertKey.set(tenantId, alertKey);
              await sendSystemAlert([
                '🚨 [HRMS] 月度绩效结果缺失告警',
                `租户：${tenantId}`,
                `周期：${period}`,
                `应有人员（估算）：${eligibleCount}`,
                `已写入结果：${actualCount}`,
                '说明：月度绩效关账或结果写入可能未完成，员工端/管理端看到的绩效结果可能不完整。',
                '请立即检查 agents-service-v2 的 monthly_comprehensive_rating（每月10日01:18）、agent_scores 表。'
              ].join('\n'));
            }
            if (actualCount >= minimumExpected) {
              _perfMonthlyMissingAlertKey.delete(tenantId);
            }
          }
        }

        // 4) 欠休域 / 5) 薪资域：确保独立域始终跟随当前 state
          await upsertLeaveDomainFromState((await getSharedState(tenantId)) || {});
          await upsertPayrollDomainFromState((await getSharedState(tenantId)) || {});
        } catch (e) {
          console.error('[monitor] critical data reconcile error:', tenantId, e?.message);
        }
      }, { continueOnError: true });
      } catch (e) {
        console.error('[monitor] critical data reconcile runForActiveTenants error:', e?.message || e);
      }
    }, 10 * 60 * 1000);

    // ── P0-2: 每天 23:30 检查销售数据完整性 ──────────────
    // 用 setInterval 每5分钟检查时间窗口
    // 原用 runWithBootstrapTenantContext 只处理default租户，改为遍历活跃租户各自检查；
    // 去重标记也从单一值改为按租户区分的 Map。
    const _salesCheckFiredDate = new Map();
    setInterval(async () => {
      try {
      await runForActiveTenants(async (tenantId) => {
        const now = new Date();
        const h = now.getHours(), m = now.getMinutes();
        // 每天 23:30~23:35 触发一次
        if (h !== 23 || m < 30 || m > 34) return;
        if (_salesCheckFiredDate.get(tenantId) === now.getDate()) return;
        _salesCheckFiredDate.set(tenantId, now.getDate());

        try {
          // 获取昨天日期（sales_raw已下线，改查pos_sales_detail视图，一般T+1检查）
          const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
          const r = await pool.query(
            `SELECT DISTINCT store FROM pos_sales_detail WHERE date = $1`,
            [yesterday]
          );
          const presentStores = r.rows.map(row => String(row.store || '').trim());

          // 预期门店列表：门店经理的店铺归属存在 hrms_state 的员工名单里(state.employees/state.users)，
          // 不在 SQL users 表(该表只有 role/is_active，没有 store/status 列，此前一直查错表导致这里天天报错)
          const state = (await getSharedState(tenantId)) || {};
          const staffList = [].concat(Array.isArray(state.employees) ? state.employees : [], Array.isArray(state.users) ? state.users : []);
          const expectedStores = [...new Set(
            staffList
              .filter((x) => String(x?.role || '').trim() === 'store_manager' && String(x?.status || '').trim() !== '离职' && String(x?.status || '').trim() !== 'inactive')
              .map((x) => String(x?.store || '').trim())
              .filter(Boolean)
          )];

          const missing = expectedStores.filter(es =>
            !presentStores.some(ps => ps.includes(es.slice(0, 4)) || es.includes(ps.slice(0, 4)))
          );

          await beatHeartbeat('pos_sales_check');

          if (missing.length > 0) {
            const msg = [
              `⚠️ [HRMS] 销售数据缺失告警`,
              `租户：${tenantId}`,
              `检查日期：${yesterday}`,
              `缺失门店：${missing.join('、')}`,
              `已有数据：${presentStores.join('、') || '无'}`,
              `销售明细已改为自动同步（pos_order_items），如持续缺失请检查该门店的POS同步是否中断。`
            ].join('\n');
            console.error('[monitor] pos_sales_detail missing stores:', tenantId, missing);
            await sendSystemAlert(msg);
          } else {
            console.log(`[monitor] sales check OK for tenant=${tenantId} ${yesterday}: ${presentStores.join('、')}`);
          }
        } catch (e) {
          console.error('[monitor] sales check error:', tenantId, e?.message);
        }
      }, { continueOnError: true });
      } catch (e) {
        console.error('[monitor] sales check runForActiveTenants error:', e?.message || e);
      }
    }, 5 * 60 * 1000);

    // ── 上月末「累计假期」池快照：上海时间每月 1 日 06:00–06:14 写入，供当月展示与公式解耦 ──
    // 原用 runWithBootstrapTenantContext 只处理 default 租户；改为遍历全部活跃租户，
    // 去重标记也从单一字符串改为按租户区分的 Map，避免A租户跑完误挡住B租户。
    const _leaveCumulativeSnapshotDoneCurYm = new Map();
    setInterval(async () => {
      try {
        await runForActiveTenants(async (tenantId) => {
          try {
            const partsFmt = new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });
            const p = partsFmt.formatToParts(new Date());
            const gv = (t) => p.find(x => x.type === t)?.value || '';
            const y = gv('year');
            const mo = gv('month');
            const d = gv('day');
            const h = Number(gv('hour'));
            const mi = Number(gv('minute'));
            if (d !== '01' || h !== 6 || mi >= 15) return;
            const curYm = `${y}-${mo}`;
            if (_leaveCumulativeSnapshotDoneCurYm.get(tenantId) === curYm) return;
            const closedMonth = shiftMonth(curYm, -1);
            if (!closedMonth) return;
            const r = await runLeaveCumulativeCloseSnapshotForClosedMonth(closedMonth);
            if (r?.ok) {
              _leaveCumulativeSnapshotDoneCurYm.set(tenantId, curYm);
              console.log('[leave-cumulative-snapshot] locked tenant=', tenantId, 'closedMonth=', r.closedMonth, 'employees=', r.employees);
            } else {
              await sendSystemAlert([
                '🔴 [HRMS] 上月累计假期自动快照失败',
                `租户：${tenantId}`,
                `闭合月：${closedMonth}`,
                `当前上海月：${curYm}`,
                `原因：${String(r?.error || 'unknown')}`,
                '请检查服务日志 [leave-cumulative-snapshot] 与 state 持久化；窗口内将每分钟重试。'
              ].join('\n'));
            }
          } catch (e) {
            console.error('[leave-cumulative-snapshot] tick:', tenantId, e?.message || e);
            try {
              await sendSystemAlert([
                '🔴 [HRMS] 上月累计假期快照任务异常',
                `租户：${tenantId}`,
                `错误：${safeErrMessage(e)}`,
                '请检查 hrms-service 日志与数据库/共享状态写入。'
              ].join('\n'));
            } catch (_) { /* ignore */ }
          }
        }, { continueOnError: true });
      } catch (e) {
        console.error('[leave-cumulative-snapshot] runForActiveTenants error:', e?.message || e);
      }
    }, 60 * 1000);

    setInterval(() => {
      void runMonthlyRecurringRewardTemplatesJob().catch((e) =>
        console.error('[recurring-reward] tick error:', e?.message || e)
      );
    }, 5 * 60 * 1000);

    // Initialize enhanced autonomous agent systems
    try {
      const { initializeAutonomousTasks } = await import('./agent-autonomous.js');
      initializeAutonomousTasks();
      console.log('[autonomous] Agent autonomous capabilities initialized');
    } catch (e) {
      console.error('[autonomous] Failed to initialize:', e?.message);
    }

    // Initialize regression protection
    try {
      const { initializeRegressionProtection } = await import('./regression-protection.js');
      await initializeRegressionProtection();
      console.log('[regression] Regression protection initialized');
    } catch (e) {
      console.error('[regression] Failed to initialize:', e?.message);
    }

    // Initialize enhanced LLM configuration
    try {
      const { initializeEnhancedLLMConfig } = await import('./llm-config-enhanced.js');
      initializeEnhancedLLMConfig();
      console.log('[llm] Enhanced LLM configuration initialized');
    } catch (e) {
      console.error('[llm] Failed to initialize:', e?.message);
    }

    // Initialize new modules (RAG, TaskBoard, HRMS API, SOP Distribution)
    await ensureRAGSchema();
    await ensureTaskBoardSchema();
    await ensureHRMSApiSchema();
    await ensureSOPDistributionSchema();
    await ensureKitchenExecutionSchema();
    await ensureRecipeSchema();
    await ensureTrainingSchema();
    console.log('[modules] RAG + TaskBoard + HRMS-API + SOP-Distribution + KitchenExec + Recipe + Training initialized');
    startTrainingReminderScheduler();
    await ensureGrowthSolutionsSchema();
    startSolutionSweepScheduler();
    console.log('[modules] GrowthSolutions initialized');


    // 飞书表格→PG 与 sales_raw 目录入库：失败第一时间通知 admin（见 notifyAdminsDualWriteFailure 注释）
    setFeishuSyncFailureNotifier((label, err) => {
      void notifyAdminsDualWriteFailure(`飞书表格→PG（${label}）`, err);
    });
    setSalesRawFolderImportFailureNotifier((err, ctx) => {
      const where = ctx?.tick ? '定时扫描' : ctx?.startup ? '启动后首次扫描' : '目录入库';
      const dirHint = ctx?.dir ? `·${String(ctx.dir).slice(0, 120)}` : '';
      void notifyAdminsDualWriteFailure(`sales_raw（${where}${dirHint}）`, err);
    });

    // Start Feishu daily sync
    startDailyFeishuSync();
    console.log('[feishu] Daily sync scheduler started');

    // Weekly BI report (Monday 10:00 CST)
    startWeeklyReportScheduler();

    startHrmsPerformanceJobs({
      onHeartbeat: beatHeartbeat
    });
    startSalesRawFolderImporter();

    // hrms_state → 快照表（定时 INSERT；环境变量：HRMS_STATE_SNAPSHOT_INTERVAL_MINUTES / _MAX_ROWS / _RETAIN_DAYS / HRMS_STATE_SNAPSHOT_DISABLED）
    const snapIntervalMin = Math.max(5, Math.min(24 * 60, Number(process.env.HRMS_STATE_SNAPSHOT_INTERVAL_MINUTES || 15)));
    // hrms_state.key 本身就是租户标识（如 'default'、未来新租户的 tenant_id），
    // captureHrmsStateSnapshotToDb 原来固定只快照 stateKey='default'，遍历租户改为每个租户各自快照自己的 key。
    const runHrmsStateSnapshot = () => {
      void runForActiveTenants(
        (tenantId) => captureHrmsStateSnapshotToDb({ source: 'scheduled', stateKey: tenantId }),
        { continueOnError: true, onError: ({ tenantId, error }) => {
          console.error('[hrms_state_snapshot] tick:', tenantId, safeErrMessage(error));
          void notifyAdminsDualWriteFailure(`hrms_state 定时快照（hrms_state_snapshots）租户=${tenantId}`, error);
        } }
      ).catch((e) => {
        console.error('[hrms_state_snapshot] tick:', e?.message || e);
        void notifyAdminsDualWriteFailure('hrms_state 定时快照（hrms_state_snapshots）', e);
      });
    };
    if (String(process.env.HRMS_STATE_SNAPSHOT_DISABLED || '').toLowerCase() !== 'true') {
      setTimeout(() => {
        runHrmsStateSnapshot();
      }, 120_000);
      setInterval(() => {
        runHrmsStateSnapshot();
      }, snapIntervalMin * 60 * 1000);
      console.log(
        '[hrms_state_snapshot] scheduler on, interval_min=',
        snapIntervalMin,
        'retain_days=',
        process.env.HRMS_STATE_SNAPSHOT_RETAIN_DAYS || 30,
        'max_rows=',
        process.env.HRMS_STATE_SNAPSHOT_MAX_ROWS || 400
      );
    } else {
      console.log('[hrms_state_snapshot] disabled (HRMS_STATE_SNAPSHOT_DISABLED=true)');
    }
  } catch (e) {
    console.error('[agents] init failed:', e?.message || e);
  }

  // Migration: normalize all roles to 7 built-in roles + set specific user assignments
  try {
    // 这里包含马己仙/洪潮历史员工姓名映射，只属于 default 租户，不能扩散到商业租户。
    await runWithBootstrapTenantContext(async () => {
    const state = (await getSharedState()) || {};
    let changed = false;
    const cleanup = cleanupLegacyTestState(state);
    if (cleanup.changed) {
      Object.assign(state, cleanup.state);
      changed = true;
      console.log('[migration] Removed legacy built-in test accounts/data');
    }
    const ALLOWED_ROLES = ['admin', 'hq_manager', 'store_manager', 'store_employee', 'cashier', 'hr_manager', 'store_production_manager', 'front_manager'];
    const ROLE_MAP = {
      'hq_employee': 'hr_manager',
      '总部人员': 'hr_manager',
      '总部人事': 'hr_manager',
      '人事经理': 'hr_manager',
      '总部HR': 'hr_manager',
      '总部营运': 'hq_manager',
      '总部经理': 'hq_manager',
      '总部管理层': 'hq_manager',
      '总部管理': 'hq_manager',
      '出纳': 'cashier',
      'custom_出纳': 'cashier',
      '总部出纳': 'cashier',
      '门店店长': 'store_manager',
      '店长': 'store_manager',
      '门店出品经理': 'store_production_manager',
      '出品经理': 'store_production_manager',
      '门店员工': 'store_employee',
      '员工': 'store_employee',
      '管理员': 'admin',
      '系统管理员': 'admin',
      '前厅经理': 'front_manager',
      '门店前厅经理': 'front_manager'
    };
    // Specific user role assignments
    const USER_ROLE_OVERRIDES = {
      '徐彬': 'hq_manager',
      '李艳玲': 'cashier',
      '高赟': 'hr_manager',
      '喻峰': 'store_manager',
      '黎永荣': 'store_production_manager',
      '李丽丽': 'store_employee',
      '田海伶': 'front_manager',
      '武静静': 'front_manager'
    };
    for (const list of [state.users, state.employees]) {
      if (!Array.isArray(list)) continue;
      for (const u of list) {
        const name = String(u?.name || '').trim();
        const oldRole = String(u?.role || '').trim();
        // Apply specific user overrides first
        if (USER_ROLE_OVERRIDES[name]) {
          if (oldRole !== USER_ROLE_OVERRIDES[name]) {
            console.log(`[migration] ${name}: ${oldRole} -> ${USER_ROLE_OVERRIDES[name]}`);
            u.role = USER_ROLE_OVERRIDES[name];
            changed = true;
          }
          continue;
        }
        // Normalize known legacy/Chinese role names
        if (ROLE_MAP[oldRole]) {
          console.log(`[migration] ${name}: ${oldRole} -> ${ROLE_MAP[oldRole]}`);
          u.role = ROLE_MAP[oldRole];
          changed = true;
          continue;
        }
        // Any custom_ or unknown role -> default to store_employee
        if (oldRole && !ALLOWED_ROLES.includes(oldRole)) {
          console.log(`[migration] ${name}: ${oldRole} -> store_employee (unknown role)`);
          u.role = 'store_employee';
          changed = true;
        }
      }
    }

    // Normalize approvalFlows step tokens to built-in roles
    const normalizeFlowToken = (tok) => {
      const t = String(tok || '').trim();
      if (!t) return '';
      if (t === 'manager') return 'manager';
      if (t.startsWith('username:')) return t;
      if (t.startsWith('role:')) {
        const rid0 = t.slice('role:'.length).trim();
        const rid = ROLE_MAP[rid0] || rid0;
        if (rid === 'store_employee') return 'role:store_employee';
        if (ALLOWED_ROLES.includes(rid)) return 'role:' + rid;
        return 'role:store_employee';
      }
      const mapped = ROLE_MAP[t] || t;
      if (ALLOWED_ROLES.includes(mapped)) return mapped;
      // legacy labels
      if (mapped === 'hr_manager') return 'hr_manager';
      if (mapped === 'hq_manager') return 'hq_manager';
      if (mapped === 'cashier') return 'cashier';
      if (mapped === 'store_manager') return 'store_manager';
      if (mapped === 'store_production_manager') return 'store_production_manager';
      if (mapped === 'store_employee') return 'store_employee';
      return 'store_employee';
    };
    if (state.approvalFlows && typeof state.approvalFlows === 'object') {
      const flows = state.approvalFlows;
      Object.keys(flows).forEach((k) => {
        const cfg = flows[k];
        if (!cfg || typeof cfg !== 'object') return;
        const steps = Array.isArray(cfg.steps) ? cfg.steps : [];
        if (!steps.length) return;
        const nextSteps = steps.map(s => normalizeFlowToken(s)).filter(Boolean);
        const same = nextSteps.length === steps.length && nextSteps.every((v, i) => String(v) === String(steps[i]));
        if (!same) {
          flows[k] = { ...cfg, steps: nextSteps };
          changed = true;
          console.log(`[migration] Normalized approvalFlows.${k}.steps`);
        }
      });
      state.approvalFlows = flows;
    }

    // Also clean up orgDict custom roles if present
    if (state.orgDict && Array.isArray(state.orgDict.roles)) {
      const before = state.orgDict.roles.length;
      state.orgDict.roles = [];
      if (before > 0) { changed = true; console.log(`[migration] Cleared ${before} custom roles from orgDict`); }
    }
    if (changed) {
      // CRITICAL: Re-read fresh state and merge only the modified arrays
      // to avoid overwriting dailyReports or other data changed concurrently.
      const freshState = (await getSharedState()) || {};
      if (state.users) freshState.users = state.users;
      if (state.employees) freshState.employees = state.employees;
      if (state.approvalFlows) freshState.approvalFlows = state.approvalFlows;
      if (state.orgDict) freshState.orgDict = state.orgDict;
      if (state.pointRecords) freshState.pointRecords = state.pointRecords;
      if (state.salaryAdjustments) freshState.salaryAdjustments = state.salaryAdjustments;
      if (state.payrollAdjustments) freshState.payrollAdjustments = state.payrollAdjustments;
      await saveSharedState(freshState);
      console.log('[migration] Role cleanup complete');
    }
    });
  } catch (e) {
    console.error('[migration] role cleanup failed:', e?.message || e);
  }
});
}

app.use((err, req, res, next) => {
  if (!err) return next();
  const requestId = req.requestId || res.getHeader?.('X-Request-Id') || null;
  try {
    if (err instanceof multer.MulterError) {
      const code = String(err.code || 'multer_error');
      if (code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large', request_id: requestId });
      }
      return res.status(400).json({ error: 'upload_error', code, request_id: requestId });
    }
  } catch (e) { /* ignore */ }

  const msg = String(err?.message || err);
  if (/uploads_dir_not_writable/i.test(msg)) {
    return res.status(500).json({ error: 'uploads_dir_not_writable', message: msg, request_id: requestId });
  }
  if (/blocked_file_type/i.test(msg)) {
    return res.status(400).json({ error: 'blocked_file_type', message: msg, request_id: requestId });
  }
  console.error('[express]', requestId || '-', msg);
  return res.status(500).json({ error: 'server_error', message: 'internal_error', request_id: requestId });
});

if (__ALLOW_SCHEMA_CHANGES__) {
  void runWithBootstrapTenantContext(async () => {
    await ensureBaselineSchemaHealth(pool).catch(e => console.warn('[schema] baseline health:', e?.message || e));
    await ensureExamResultsTable();
    await ensureHrmsStateTable();
    await ensureApprovalTables();
    await ensureUserReadsTable();
    await ensureUserSessionsTable();
    await ensureLoginLogTable();
    await ensureAgentConfigTables();

    await ensureCheckinTable();
    await ensureOpsTasksTable();
    await ensureFeishuSyncTable();
    await ensureFeishuGenericRecordsTable();
    await ensureFeishuGenericRecordsNotifyTrigger();
    await ensureTableVisitRecordsTable();
    await ensureDedupIndexes();
  }).catch((e) =>
    console.error('[startup/bootstrap-schema]', e?.message || e)
  );
  startOpsTaskScheduler();
} else {
  console.warn(`[safety] APP_ENV=${APP_ENV}: skip auto schema/ensure tables (ALLOW_SCHEMA_CHANGES!=true)`);
}

// 原用runWithBootstrapTenantContext只处理default租户的离职自动化+晋升进度扫描；改为遍历活跃租户
setInterval(() => {
  (async () => {
    try {
    await runForActiveTenants(async (tenantId) => {
      try {
      await ensureApprovalTables();
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      const dateOnly = `${y}-${m}-${d}`;

      const r = await pool.query(
        `select id, payload, applicant_username
         from approval_requests
         where type = $1
           and status = $2
           and effective_date is not null
           and effective_date <= $3::date
           and executed_at is null
         order by effective_date asc
         limit 50`,
        ['offboarding', 'approved', dateOnly]
      );
      const items = r.rows || [];
      if (!items.length) return;

      const state = (await getSharedState(tenantId)) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      let changed = false;
      for (const it of items) {
        const empUsername = String(it?.payload?.username || it?.payload?.employeeUsername || it?.payload?.applicant || it?.applicant_username || '').trim();
        if (!empUsername) continue;
        const idx = employees.findIndex(e => String(e?.username || '').toLowerCase() === empUsername.toLowerCase());
        if (idx < 0) continue;
        const old = employees[idx] || {};
        const eff = safeDateOnly(it?.effective_date || it?.payload?.resignDate || it?.payload?.date);
        if (String(old.status || '') !== '离职' && String(old.status || '') !== 'inactive') {
          employees[idx] = {
            ...old,
            status: '离职',
            resignedAt: dateOnly,
            offboardingApproved: true,
            offboardingDate: eff || old.offboardingDate || dateOnly
          };
          changed = true;
        }
      }

      if (changed) {
        await saveSharedState({ ...state, employees }, tenantId);
      }
      try {
        const stAfter = (await getSharedState(tenantId)) || {};
        const emList = Array.isArray(stAfter.employees) ? stAfter.employees : [];
        for (const it of items) {
          const empUsername = String(it?.payload?.username || it?.payload?.employeeUsername || it?.payload?.applicant || it?.applicant_username || '').trim();
          if (!empUsername) continue;
          const rec2 = emList.find(e => String(e?.username || '').toLowerCase() === empUsername.toLowerCase());
          if (rec2) {
            try {
              await applyHrmsUserAccountGateFromEmployee(rec2);
            } catch (ge) {
              console.error('[offboarding-cron][account-gate]', tenantId, empUsername, ge?.message || ge);
            }
          }
        }
      } catch (eGate) {
        console.error('[offboarding-cron] account gate batch failed:', tenantId, eGate?.message || eGate);
      }

      // P1/P2/P5: 晋升进度每日扫描
      // P4: 替换旧的 trainingSessions 死代码（新版培训任务存 DB，promotionTrack 无 trainingSessions 字段）
      try {
        let state2 = (await getSharedState(tenantId)) || {};
        let allTracks = Array.isArray(state2.promotionTracks) ? state2.promotionTracks.slice() : [];
        if (allTracks.length) {
          let changedTrack = false;

          // P5: 归档超过90天的已完成/已拒绝 track，防止 state 无限膨胀
          const cutoff90 = Date.now() - 90 * 86400000;
          const freshTracks = allTracks.filter(tr => {
            const s = String(tr?.status || '');
            if (s === 'promoted' || s === 'formal_rejected') {
              const ts = tr?.updatedAt ? new Date(tr.updatedAt).getTime() : 0;
              return ts > cutoff90;
            }
            return true;
          });
          if (freshTracks.length < allTracks.length) {
            state2 = { ...state2, promotionTracks: freshTracks };
            allTracks = freshTracks;
            changedTrack = true;
          }

          // P1/P2: 扫描进行中的 track
          const activeTracks = allTracks.filter(tr =>
            String(tr?.status || '') === 'qualification_approved' && !tr?.formalApplied
          );
          for (const tr of activeTracks) {
            const trackId = String(tr?.id || '');
            const applicantUsername = String(tr?.applicantUsername || '');
            if (!trackId || !applicantUsername) continue;
            const requiredTopicIds = Array.isArray(tr.requiredTopicIds) ? tr.requiredTopicIds : [];
            const progress = requiredTopicIds.length ? await getPromotionTrackProgress(applicantUsername, requiredTopicIds) : null;

            // P1: 全部认证通过 → 推"可申请正式晋升"通知（仅推一次）
            if (progress?.passed && !tr.readyNotifiedAt) {
              const recipients = await getPromotionTrackRecipients(state2, tr);
              const name = String(tr?.applicantName || applicantUsername);
              const pos = String(tr?.targetPosition || '');
              for (const u of recipients) {
                state2 = addStateNotification(state2, makeNotif(u, '晋升培训已完成，可申请正式晋升',
                  `${name}，你的晋升能力培训全部通过认证，已具备申请「${pos}」正式晋升的条件，请尽快提交正式晋升申请。`,
                  { type: 'promotion_training_completed', trackId }
                ));
              }
              const idx2 = state2.promotionTracks.findIndex(t => String(t?.id || '') === trackId);
              if (idx2 >= 0) {
                const updated2 = state2.promotionTracks.slice();
                updated2[idx2] = { ...updated2[idx2], readyNotifiedAt: hrmsNowISO() };
                state2 = { ...state2, promotionTracks: updated2 };
              }
              changedTrack = true;
            }

            // P2: 截止日逾期且未通过 → 每天推一次逾期提醒（最多3次）
            if (!progress?.passed && tr.trainingDueDate && tr.trainingDueDate < dateOnly) {
              const lastDate = String(tr?.lastOverdueReminderAt || '').slice(0, 10);
              const overdueCount = Number(tr?.overdueReminderCount || 0);
              if (lastDate !== dateOnly && overdueCount < 3) {
                const daysOverdue = Math.round((new Date(dateOnly + 'T00:00:00').getTime() - new Date(tr.trainingDueDate + 'T00:00:00').getTime()) / 86400000);
                const recipients = await getPromotionTrackRecipients(state2, tr);
                const name = String(tr?.applicantName || applicantUsername);
                for (const u of recipients) {
                  state2 = addStateNotification(state2, makeNotif(u, '晋升培训进度逾期提醒',
                    `${name} 的晋升培训已超截止日 ${daysOverdue} 天（截止：${tr.trainingDueDate}），仍有知识点未完成认证，请尽快推进。`,
                    { type: 'promotion_training_overdue', trackId }
                  ));
                }
                const idx2 = state2.promotionTracks.findIndex(t => String(t?.id || '') === trackId);
                if (idx2 >= 0) {
                  const updated2 = state2.promotionTracks.slice();
                  updated2[idx2] = { ...updated2[idx2], lastOverdueReminderAt: hrmsNowISO(), overdueReminderCount: overdueCount + 1 };
                  state2 = { ...state2, promotionTracks: updated2 };
                }
                changedTrack = true;
              }
            }
          }

          if (changedTrack) await saveSharedState(state2, tenantId);
        }
      } catch (e) {
        console.log('[promotion-sweep] failed:', tenantId, e?.message || e);
      }

        for (const it of items) {
          try {
            await pool.query('update approval_requests set executed_at = now(), updated_at = now() where id = $1', [it.id]);
          } catch (e) { /* ignore */ }
        }
      } catch (e) {
        console.log('offboarding auto-disable job failed:', tenantId, e?.message || e);
      }
    }, { continueOnError: true });
    } catch (e) {
      console.error('[offboarding-cron] runForActiveTenants error:', e?.message || e);
    }
  })();
}, 30 * 60 * 1000);

// ========== 生日祝福自动发送 ==========

// 解析生日字段，返回 { month, day } 或 null
function parseBirthdayMonthDay(birthday) {
  const s = String(birthday || '').trim();
  if (!s) return null;
  // 支持格式: YYYY-MM-DD, MM-DD, YYYY/MM/DD, MM/DD
  const match = s.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

// 获取下个月的年月
function getNextMonth(today) {
  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 1-12
  if (m === 12) return { year: y + 1, month: 1 };
  return { year: y, month: m + 1 };
}

// 检查是否是月底（当月最后3天）
function isEndOfMonth(today) {
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() >= lastDay - 2;
}

// 生日祝福定时任务 - 每小时检查一次
// 原用runWithBootstrapTenantContext只处理default租户的员工生日；改为遍历活跃租户各自处理各自员工
setInterval(() => {
  (async () => {
    try {
    await runForActiveTenants(async (tenantId) => {
      try {
      const now = new Date();
      const todayMonth = now.getMonth() + 1;
      const todayDay = now.getDate();
      const todayStr = `${now.getFullYear()}-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;
      const hour = now.getHours();

      let state = (await getSharedState(tenantId)) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const activeEmployees = employees.filter(e => !isInactiveStatus(String(e?.status || '').trim()) && !employeeAccountShouldDisable(e));

      // 记录已发送的生日祝福，避免重复
      const birthdayGreetingsSent = state.birthdayGreetingsSent || {};
      const birthdayRemindersSent = state.birthdayRemindersSent || {};
      const monthlyRemindersSent = state.monthlyRemindersSent || {};

      let changed = false;

      // === 1. 生日当天自动发送祝福（每天8-10点之间执行一次）===
      if (hour >= 8 && hour <= 10) {
        const adminUsername = await pickAdminUsername(state);
        const adminName = adminUsername ? (stateFindUserRecord(state, adminUsername)?.name || adminUsername) : '总部';

        for (const emp of activeEmployees) {
          const bd = parseBirthdayMonthDay(emp?.birthday);
          if (!bd || bd.month !== todayMonth || bd.day !== todayDay) continue;

          const empUsername = String(emp?.username || '').trim();
          const empName = String(emp?.name || '').trim() || empUsername;
          const greetingKey = `${empUsername}_${todayStr}`;

          if (birthdayGreetingsSent[greetingKey]) continue;

          // 生日祝福消息
          const message = `${empName}，今天是你的生日，公司代表门店及总部所有人员祝你生日快乐，感谢你在过去一年里的努力与付出，你的专业与责任心让团队更加稳固可靠。愿新的一岁事业顺遂、生活明朗，收获成长与喜悦。公司很荣幸与你一路同行，期待与你共同创造更好的未来。\n\n来自总部 ${adminName}（${todayStr}）`;

          state = addStateNotification(state, makeNotif(empUsername, '🎂 生日快乐', message, { type: 'birthday_greeting' }));
          birthdayGreetingsSent[greetingKey] = hrmsNowISO();
          changed = true;
          console.log(`Birthday greeting sent to ${empName} (${empUsername})`);
        }
      }

      // === 2. 生日前1天提醒店长（每天8-10点之间执行一次）===
      if (hour >= 8 && hour <= 10) {
        const tomorrow = new Date(now.getTime() + 86400000);
        const tomorrowMonth = tomorrow.getMonth() + 1;
        const tomorrowDay = tomorrow.getDate();
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrowMonth).padStart(2, '0')}-${String(tomorrowDay).padStart(2, '0')}`;

        // 按门店分组明天过生日的员工
        const storeMap = new Map();
        for (const emp of activeEmployees) {
          const bd = parseBirthdayMonthDay(emp?.birthday);
          if (!bd || bd.month !== tomorrowMonth || bd.day !== tomorrowDay) continue;
          const store = String(emp?.store || '').trim() || '总部';
          if (!storeMap.has(store)) storeMap.set(store, []);
          storeMap.get(store).push(emp);
        }

        // 通知每个门店的店长
        for (const [store, emps] of storeMap) {
          const storeManager = activeEmployees.find(e => String(e?.store || '').trim() === store && String(e?.role || '').trim() === 'store_manager');
          if (!storeManager) continue;

          const smUsername = String(storeManager?.username || '').trim();
          const reminderKey = `${smUsername}_${tomorrowStr}`;
          if (birthdayRemindersSent[reminderKey]) continue;

          const names = emps.map(e => String(e?.name || e?.username || '').trim()).join('、');
          const message = `温馨提醒：明天（${tomorrowStr}）是以下员工的生日，请提前准备祝福：\n\n${names}`;

          state = addStateNotification(state, makeNotif(smUsername, '🎂 明日生日提醒', message, { type: 'birthday_reminder_1day' }));
          birthdayRemindersSent[reminderKey] = hrmsNowISO();
          changed = true;
        }
      }

      // === 3. 月底提醒：下月生日员工名单（每月最后3天的8-10点执行一次）===
      if (hour >= 8 && hour <= 10 && isEndOfMonth(now)) {
        const nextMonth = getNextMonth(now);
        const monthKey = `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}`;

        // 找出下月过生日的员工
        const nextMonthBirthdays = activeEmployees.filter(e => {
          const bd = parseBirthdayMonthDay(e?.birthday);
          return bd && bd.month === nextMonth.month;
        });

        if (nextMonthBirthdays.length > 0) {
          // 按门店分组
          const storeMap = new Map();
          for (const emp of nextMonthBirthdays) {
            const store = String(emp?.store || '').trim() || '总部';
            if (!storeMap.has(store)) storeMap.set(store, []);
            storeMap.get(store).push(emp);
          }

          // 通知每个门店的店长
          for (const [store, emps] of storeMap) {
            const storeManager = activeEmployees.find(e => String(e?.store || '').trim() === store && String(e?.role || '').trim() === 'store_manager');
            if (!storeManager) continue;

            const smUsername = String(storeManager?.username || '').trim();
            const reminderKey = `monthly_${smUsername}_${monthKey}`;
            if (monthlyRemindersSent[reminderKey]) continue;

            const lines = emps.map(e => {
              const bd = parseBirthdayMonthDay(e?.birthday);
              return `• ${String(e?.name || e?.username || '').trim()}（${nextMonth.month}月${bd?.day}日）`;
            }).join('\n');
            const message = `以下是${store}门店${nextMonth.month}月份过生日的员工名单，请提前准备祝福：\n\n${lines}`;

            state = addStateNotification(state, makeNotif(smUsername, `📋 ${nextMonth.month}月生日员工名单`, message, { type: 'birthday_monthly_reminder' }));
            monthlyRemindersSent[reminderKey] = hrmsNowISO();
            changed = true;
          }

          // 通知总部人事（HR）
          const hrUsername = await pickHrManagerUsername(state);
          if (hrUsername) {
            const hrReminderKey = `monthly_hr_${monthKey}`;
            if (!monthlyRemindersSent[hrReminderKey]) {
              const lines = nextMonthBirthdays.map(e => {
                const bd = parseBirthdayMonthDay(e?.birthday);
                const store = String(e?.store || '').trim() || '总部';
                return `• ${String(e?.name || e?.username || '').trim()}（${store}，${nextMonth.month}月${bd?.day}日）`;
              }).sort().join('\n');
              const message = `以下是公司所有门店（含总部）${nextMonth.month}月份过生日的员工名单：\n\n${lines}`;

              state = addStateNotification(state, makeNotif(hrUsername, `📋 ${nextMonth.month}月全公司生日员工名单`, message, { type: 'birthday_monthly_reminder_hr' }));
              monthlyRemindersSent[hrReminderKey] = hrmsNowISO();
              changed = true;
            }
          }
        }
      }

        // 保存状态
        if (changed) {
          state.birthdayGreetingsSent = birthdayGreetingsSent;
          state.birthdayRemindersSent = birthdayRemindersSent;
          state.monthlyRemindersSent = monthlyRemindersSent;
          await saveSharedState(state, tenantId);
        }

      } catch (e) {
        console.log('birthday greeting job failed:', tenantId, e?.message || e);
      }
    }, { continueOnError: true });
    } catch (e) {
      console.error('[birthday-greeting] runForActiveTenants error:', e?.message || e);
    }
  })();
}, 60 * 60 * 1000); // 每小时检查一次

// 手动触发生日检查（仅管理员，用于测试）
app.post('/api/birthday/check', authRequired, async (req, res) => {
  try {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });

    const forceDate = String(req.body?.date || '').trim(); // 可选：模拟指定日期 YYYY-MM-DD
    const now = forceDate ? new Date(forceDate + 'T09:00:00') : new Date();
    if (isNaN(now.getTime())) return res.status(400).json({ error: 'invalid_date' });

    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();
    const todayStr = `${now.getFullYear()}-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;

    let state = (await getSharedState()) || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const activeEmployees = employees.filter(e => !isInactiveStatus(String(e?.status || '').trim()) && !employeeAccountShouldDisable(e));

    const birthdayGreetingsSent = state.birthdayGreetingsSent || {};
    const birthdayRemindersSent = state.birthdayRemindersSent || {};
    const monthlyRemindersSent = state.monthlyRemindersSent || {};

    let changed = false;
    const results = { greetings: [], reminders1day: [], monthlyReminders: [] };

    // 1. 生日当天祝福
    const adminUsername = await pickAdminUsername(state);
    const adminName = adminUsername ? (stateFindUserRecord(state, adminUsername)?.name || adminUsername) : '总部';

    for (const emp of activeEmployees) {
      const bd = parseBirthdayMonthDay(emp?.birthday);
      if (!bd || bd.month !== todayMonth || bd.day !== todayDay) continue;

      const empUsername = String(emp?.username || '').trim();
      const empName = String(emp?.name || '').trim() || empUsername;
      const greetingKey = `${empUsername}_${todayStr}`;

      if (birthdayGreetingsSent[greetingKey]) {
        results.greetings.push({ name: empName, status: 'already_sent' });
        continue;
      }

      const message = `${empName}，今天是你的生日，公司代表门店及总部所有人员祝你生日快乐，感谢你在过去一年里的努力与付出，你的专业与责任心让团队更加稳固可靠。愿新的一岁事业顺遂、生活明朗，收获成长与喜悦。公司很荣幸与你一路同行，期待与你共同创造更好的未来。\n\n来自总部 ${adminName}（${todayStr}）`;

      state = addStateNotification(state, makeNotif(empUsername, '🎂 生日快乐', message, { type: 'birthday_greeting' }));
      birthdayGreetingsSent[greetingKey] = hrmsNowISO();
      changed = true;
      results.greetings.push({ name: empName, status: 'sent' });
    }

    // 2. 生日前1天提醒店长
    const tomorrow = new Date(now.getTime() + 86400000);
    const tomorrowMonth = tomorrow.getMonth() + 1;
    const tomorrowDay = tomorrow.getDate();
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrowMonth).padStart(2, '0')}-${String(tomorrowDay).padStart(2, '0')}`;

    const storeMap = new Map();
    for (const emp of activeEmployees) {
      const bd = parseBirthdayMonthDay(emp?.birthday);
      if (!bd || bd.month !== tomorrowMonth || bd.day !== tomorrowDay) continue;
      const store = String(emp?.store || '').trim() || '总部';
      if (!storeMap.has(store)) storeMap.set(store, []);
      storeMap.get(store).push(emp);
    }

    for (const [store, emps] of storeMap) {
      const storeManager = activeEmployees.find(e => String(e?.store || '').trim() === store && String(e?.role || '').trim() === 'store_manager');
      if (!storeManager) continue;

      const smUsername = String(storeManager?.username || '').trim();
      const reminderKey = `${smUsername}_${tomorrowStr}`;
      if (birthdayRemindersSent[reminderKey]) {
        results.reminders1day.push({ store, status: 'already_sent' });
        continue;
      }

      const names = emps.map(e => String(e?.name || e?.username || '').trim()).join('、');
      const message = `温馨提醒：明天（${tomorrowStr}）是以下员工的生日，请提前准备祝福：\n\n${names}`;

      state = addStateNotification(state, makeNotif(smUsername, '🎂 明日生日提醒', message, { type: 'birthday_reminder_1day' }));
      birthdayRemindersSent[reminderKey] = hrmsNowISO();
      changed = true;
      results.reminders1day.push({ store, employees: names, status: 'sent' });
    }

    // 3. 月底提醒
    if (isEndOfMonth(now)) {
      const nextMonth = getNextMonth(now);
      const monthKey = `${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}`;

      const nextMonthBirthdays = activeEmployees.filter(e => {
        const bd = parseBirthdayMonthDay(e?.birthday);
        return bd && bd.month === nextMonth.month;
      });

      if (nextMonthBirthdays.length > 0) {
        const storeMap2 = new Map();
        for (const emp of nextMonthBirthdays) {
          const store = String(emp?.store || '').trim() || '总部';
          if (!storeMap2.has(store)) storeMap2.set(store, []);
          storeMap2.get(store).push(emp);
        }

        for (const [store, emps] of storeMap2) {
          const storeManager = activeEmployees.find(e => String(e?.store || '').trim() === store && String(e?.role || '').trim() === 'store_manager');
          if (!storeManager) continue;

          const smUsername = String(storeManager?.username || '').trim();
          const reminderKey = `monthly_${smUsername}_${monthKey}`;
          if (monthlyRemindersSent[reminderKey]) {
            results.monthlyReminders.push({ store, status: 'already_sent' });
            continue;
          }

          const lines = emps.map(e => {
            const bd = parseBirthdayMonthDay(e?.birthday);
            return `• ${String(e?.name || e?.username || '').trim()}（${nextMonth.month}月${bd?.day}日）`;
          }).join('\n');
          const message = `以下是${store}门店${nextMonth.month}月份过生日的员工名单，请提前准备祝福：\n\n${lines}`;

          state = addStateNotification(state, makeNotif(smUsername, `📋 ${nextMonth.month}月生日员工名单`, message, { type: 'birthday_monthly_reminder' }));
          monthlyRemindersSent[reminderKey] = hrmsNowISO();
          changed = true;
          results.monthlyReminders.push({ store, count: emps.length, status: 'sent' });
        }

        const hrUsername = await pickHrManagerUsername(state);
        if (hrUsername) {
          const hrReminderKey = `monthly_hr_${monthKey}`;
          if (!monthlyRemindersSent[hrReminderKey]) {
            const lines = nextMonthBirthdays.map(e => {
              const bd = parseBirthdayMonthDay(e?.birthday);
              const store = String(e?.store || '').trim() || '总部';
              return `• ${String(e?.name || e?.username || '').trim()}（${store}，${nextMonth.month}月${bd?.day}日）`;
            }).sort().join('\n');
            const message = `以下是公司所有门店（含总部）${nextMonth.month}月份过生日的员工名单：\n\n${lines}`;

            state = addStateNotification(state, makeNotif(hrUsername, `📋 ${nextMonth.month}月全公司生日员工名单`, message, { type: 'birthday_monthly_reminder_hr' }));
            monthlyRemindersSent[hrReminderKey] = hrmsNowISO();
            changed = true;
            results.monthlyReminders.push({ target: 'HR', count: nextMonthBirthdays.length, status: 'sent' });
          }
        }
      }
    }

    if (changed) {
      state.birthdayGreetingsSent = birthdayGreetingsSent;
      state.birthdayRemindersSent = birthdayRemindersSent;
      state.monthlyRemindersSent = monthlyRemindersSent;
      await saveSharedState(state);
    }

    res.json({ ok: true, date: todayStr, isEndOfMonth: isEndOfMonth(now), results });
  } catch (e) {
    console.error('POST /api/birthday/check error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// 查询生日员工列表（管理员/HR/店长）
app.get('/api/birthday/upcoming', authRequired, async (req, res) => {
  try {
    const role = String(req.user?.role || '').trim();
    const username = String(req.user?.username || '').trim();
    const _canSeeAll = role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role.startsWith('custom_人事');

    const state = (await getSharedState()) || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
     const activeEmployees = employees.filter(e => !isInactiveStatus(String(e?.status || '').trim()) && !employeeAccountShouldDisable(e));

    let myStore = '';
    if (role === 'store_manager') {
      const me = activeEmployees.find(e => String(e?.username || '').toLowerCase() === username.toLowerCase());
      myStore = String(me?.store || '').trim();
    }

    const now = new Date();
    const _todayMonth = now.getMonth() + 1;
    const _todayDay = now.getDate();
    const daysParam = Math.max(1, Math.min(90, Number(req.query?.days) || 30));

    const results = [];
    for (const emp of activeEmployees) {
      const bd = parseBirthdayMonthDay(emp?.birthday);
      if (!bd) continue;

      // 店长只能看本店
      if (role === 'store_manager' && myStore) {
        const empStore = String(emp?.store || '').trim();
        if (empStore !== myStore) continue;
      }

      // 计算距离生日的天数
      const thisYearBd = new Date(now.getFullYear(), bd.month - 1, bd.day);
      let nextBd = thisYearBd;
      if (thisYearBd < now) {
        nextBd = new Date(now.getFullYear() + 1, bd.month - 1, bd.day);
      }
      const diffDays = Math.ceil((nextBd.getTime() - now.getTime()) / 86400000);

      if (diffDays <= daysParam) {
        results.push({
          username: String(emp?.username || '').trim(),
          name: String(emp?.name || '').trim(),
          store: String(emp?.store || '').trim() || '总部',
          birthday: String(emp?.birthday || '').trim(),
          birthdayDisplay: `${bd.month}月${bd.day}日`,
          daysUntil: diffDays,
          isToday: diffDays === 0
        });
      }
    }

    results.sort((a, b) => a.daysUntil - b.daysUntil);
    res.json({ ok: true, upcoming: results });
  } catch (e) {
    console.error('GET /api/birthday/upcoming error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ========== 培训专注度监控 API ==========

// 创建 attention_scores 表（如果不存在）
(async () => {
  try {
    await runWithBootstrapTenantContext(async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS attention_scores (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          name TEXT DEFAULT '',
          store TEXT DEFAULT '',
          material_id TEXT NOT NULL,
          material_title TEXT DEFAULT '',
          score INTEGER DEFAULT 0,
          duration_seconds INTEGER DEFAULT 0,
          total_samples INTEGER DEFAULT 0,
          attentive_samples INTEGER DEFAULT 0,
          avg_score INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      try {
        await pool.query('CREATE INDEX IF NOT EXISTS idx_attn_username ON attention_scores(username)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_attn_material ON attention_scores(material_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_attn_created ON attention_scores(created_at)');
      } catch (e) { /* ignore */ }
    });
  } catch (e) {
    console.log('attention_scores table init:', e?.message || e);
  }
})();

// 保存专注度分数
app.post('/api/attention-scores', authRequired, async (req, res) => {
  try {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });

    const materialId = String(req.body?.materialId || '').trim();
    const materialTitle = String(req.body?.materialTitle || '').trim();
    const score = Math.max(0, Math.min(100, Number(req.body?.score) || 0));
    const durationSeconds = Math.max(0, Number(req.body?.durationSeconds) || 0);
    const totalSamples = Math.max(0, Number(req.body?.totalSamples) || 0);
    const attentiveSamples = Math.max(0, Number(req.body?.attentiveSamples) || 0);
    const avgScore = Math.max(0, Math.min(100, Number(req.body?.avgScore) || 0));

    if (!materialId) return res.status(400).json({ error: 'missing_material_id' });

    // 获取用户姓名和门店
    const state = (await getSharedState()) || {};
    const users = Array.isArray(state.users) ? state.users : [];
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const userObj = users.find(u => String(u?.username || '').toLowerCase() === username.toLowerCase())
      || employees.find(e => String(e?.username || '').toLowerCase() === username.toLowerCase());
    const name = String(userObj?.name || '').trim();
    const store = String(userObj?.store || '').trim();

    const id = 'attn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    await pool.query(
      `INSERT INTO attention_scores (id, username, name, store, material_id, material_title, score, duration_seconds, total_samples, attentive_samples, avg_score, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, username, name, store, materialId, materialTitle, score, durationSeconds, totalSamples, attentiveSamples, avgScore, resolveTenantIdDefault()]
    );

    res.json({ ok: true, id, score });
  } catch (e) {
    console.error('POST /api/attention-scores error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// 查询专注度分数（管理员/经理可查全部，普通员工只能查自己）
app.get('/api/attention-scores', authRequired, async (req, res) => {
  try {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const canSeeAll = role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager';

    const filterUser = String(req.query?.username || '').trim();
    const filterMaterial = String(req.query?.materialId || '').trim();
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));

    let query = 'SELECT * FROM attention_scores WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (!canSeeAll) {
      query += ` AND username = $${paramIdx++}`;
      params.push(username);
    } else if (filterUser) {
      query += ` AND username = $${paramIdx++}`;
      params.push(filterUser);
    }

    if (filterMaterial) {
      query += ` AND material_id = $${paramIdx++}`;
      params.push(filterMaterial);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIdx++}`;
    params.push(limit);

    const r = await pool.query(query, params);
    res.json({ scores: r.rows || [] });
  } catch (e) {
    console.error('GET /api/attention-scores error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// 专注度统计摘要（按用户汇总）
app.get('/api/attention-scores/summary', authRequired, async (req, res) => {
  try {
    const role = String(req.user?.role || '').trim();
    const canSeeAll = role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager';
    if (!canSeeAll) return res.status(403).json({ error: 'forbidden' });

    const r = await pool.query(`
      SELECT username, name, store,
        COUNT(*) as session_count,
        ROUND(AVG(score)) as avg_score,
        SUM(duration_seconds) as total_duration,
        MAX(created_at) as last_session
      FROM attention_scores
      GROUP BY username, name, store
      ORDER BY avg_score ASC
    `);
    res.json({ summary: r.rows || [] });
  } catch (e) {
    console.error('GET /api/attention-scores/summary error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});


// ─── 员工系统使用周报表 ───
app.get('/api/admin/usage-weekly', authRequired, async (req, res) => {
  const role = String(req.user?.role || '').trim();
  if (role !== 'admin' && role !== 'hq_manager') {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { periodStart, periodEnd } = (() => {
      const now = new Date();
      const shanghaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      const dayOfWeek = shanghaiNow.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(shanghaiNow);
      monday.setDate(shanghaiNow.getDate() + mondayOffset - 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fmt = d => d.toISOString().slice(0, 10);
      return { periodStart: fmt(monday), periodEnd: fmt(sunday) };
    })();

    const result = await pool.query(`
      SELECT
        l.username,
        COALESCE(e.name, u.real_name, l.username) AS name,
        COALESCE(e.store, fu.store, '') AS store,
        COALESCE(e.position, fu.role, u.role, '') AS position,
        COUNT(*) AS login_count,
        ROUND(
          EXTRACT(EPOCH FROM (
            COALESCE(
              SUM(
                LEAST(
                  COALESCE(
                    l.logout_at,
                    LEAST(
                      (($2::text || ' 23:59:59')::timestamp AT TIME ZONE 'Asia/Shanghai'),
                      l.login_at + INTERVAL '12 hours'
                    )
                  ),
                  l.login_at + INTERVAL '12 hours'
                ) - l.login_at
              ),
              INTERVAL '0'
            )
          )) / 60.0
        , 1) AS online_minutes
      FROM user_login_log l
      LEFT JOIN employees e ON LOWER(TRIM(e.username)) = LOWER(TRIM(l.username))
      LEFT JOIN users u ON LOWER(TRIM(u.username)) = LOWER(TRIM(l.username))
      LEFT JOIN feishu_users fu ON LOWER(TRIM(fu.username)) = LOWER(TRIM(l.username))
      WHERE (l.login_at AT TIME ZONE 'Asia/Shanghai')::date >= $1::date
        AND (l.login_at AT TIME ZONE 'Asia/Shanghai')::date <= $2::date
        AND l.username NOT LIKE '__periodic%%'
        AND COALESCE(e.name, u.real_name, '') NOT IN ('系统管理员', 'test')
      GROUP BY l.username, e.name, u.real_name, e.store, fu.store, e.position, fu.role, u.role
      ORDER BY login_count DESC, online_minutes DESC
    `, [periodStart, periodEnd]);

    res.json({ periodStart, periodEnd, data: result.rows });
  } catch (e) {
    console.error('GET /api/admin/usage-weekly error:', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// unhandledRejection 不会让进程崩溃，可能一天触发几十次（不像uncaughtException那样
// 自带"只会响一次"的天然限流）。直接接飞书会刷屏、导致频道被静音，反而让真正的崩溃
// 告警被忽略——所以这里加一个15分钟冷却，同一条错误消息在冷却期内只告警一次。
let _lastRejectionAlertAt = 0;
const _rejectionAlertCooldownMs = 15 * 60 * 1000;
process.on('unhandledRejection', (reason, _promise) => {
  const detail = reason instanceof Error ? reason.stack : String(reason);
  console.error('[HRMS] Unhandled rejection:', detail);
  const now = Date.now();
  if (now - _lastRejectionAlertAt > _rejectionAlertCooldownMs) {
    _lastRejectionAlertAt = now;
    sendLarkMessage(
      FEISHU_ALERT_ADMIN_HEALTH,
      `⚠️【HRMS 未处理的Promise异常】\n\n${String(detail || '').slice(0, 800)}\n\n（15分钟内只告警一次，日志里可能还有更多同类异常，请查看服务器日志确认。）`,
      { skipDedup: true }
    ).catch((e) => console.error('[HRMS] unhandledRejection告警发送失败:', e?.message || e));
  }
});

// 未捕获的同步异常此前没有专门处理，会静默让进程崩溃（PM2会重启，但没有留下明确原因）。
// 这里先记录清晰日志再退出，方便事后从日志定位，而不是改变"崩溃后重启"的现有行为。
process.on('uncaughtException', (err) => {
  const detail = err instanceof Error ? err.stack : String(err);
  console.error('[HRMS] Uncaught exception, process exiting:', detail);
  // 之前这里只写日志，进程崩溃靠人工翻日志才会发现。补一条飞书告警，
  // 给个短超时避免飞书调用本身卡住导致进程迟迟不退出。
  const alertPromise = sendLarkMessage(
    FEISHU_ALERT_ADMIN_HEALTH,
    `🚨【HRMS 进程崩溃】\n\n${String(detail || '').slice(0, 800)}\n\n进程即将重启(PM2)，如果频繁重启请立即排查。`,
    { skipDedup: true }
  ).catch((e) => console.error('[HRMS] 崩溃告警发送失败:', e?.message || e));
  Promise.race([alertPromise, new Promise((r) => setTimeout(r, 5000))]).finally(() => process.exit(1));
});

// ── Scheduled cleanup: retain 2 months of notifications ────
// hrms_user_notifications带RLS，原只清default租户；改为遍历活跃租户各自清理
async function cleanupOldNotifications() {
  let deleted = 0;
  try {
    await runForActiveTenants(async () => {
      const r = await pool.query(`DELETE FROM hrms_user_notifications WHERE created_at < now() - interval '3 days' AND id NOT IN (SELECT id FROM hrms_user_notifications ORDER BY created_at DESC LIMIT 50)`);
      deleted += r.rowCount ?? 0;
    }, { continueOnError: true });
  } catch (e) {
    console.error('[cleanup] hrms_user_notifications error:', e?.message);
  }
  if (deleted > 0) console.log('[cleanup] hrms_user_notifications deleted:', deleted);
}
// Run every 6 hours; first run deferred 1 min after startup
setTimeout(() => { cleanupOldNotifications(); }, 60000);
setInterval(cleanupOldNotifications, 6 * 3600 * 1000);

// 数据新鲜度监控：server/ontology/freshness.js写好后一直没接cron，是纯代码骨架，
// 这里激活它——每6小时按活跃租户检查一遍，每个租户每天最多告警一次(防止刷屏)。
const _freshnessAlertFiredDate = new Map();
async function runFreshnessMonitorTick() {
  try {
    await runForActiveTenants(async (tenantId) => {
      const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      if (_freshnessAlertFiredDate.get(tenantId) === todayStr) return;
      const { stale, alertText } = await runFreshnessCheck(pool, FRESHNESS_SOURCES);
      if (!alertText) return;
      _freshnessAlertFiredDate.set(tenantId, todayStr);
      const r = await pool.query(
        `SELECT DISTINCT open_id
         FROM feishu_users
         WHERE registered = true
           AND open_id IS NOT NULL
           AND open_id NOT LIKE '%probe%'
           AND (
             TRIM(LOWER(role)) IN ('admin', 'hq_manager')
             OR TRIM(role) IN ('管理员', '系统管理员', '总部经理', '总部营运')
           )
         LIMIT 35`
      );
      const rows = r.rows || [];
      if (!rows.length) {
        console.error('[freshness] 数据陈旧但无可投递飞书账号，tenant:', tenantId, stale.map(s => s.name));
        return;
      }
      const sends = rows.map((row) =>
        sendLarkMessage(row.open_id, alertText, { skipDedup: true }).catch((e) => ({ err: e?.message || e }))
      );
      const settled = await Promise.all(sends);
      const failed = settled.filter((x) => x && x.err);
      if (failed.length) {
        console.error('[freshness] 部分飞书告警发送失败:', tenantId, failed.length, '/', settled.length, failed[0]?.err);
      } else {
        console.error('[freshness] alert sent, tenant:', tenantId, 'stale:', stale.map(s => s.name));
      }
    }, { continueOnError: true });
  } catch (e) {
    console.error('[freshness] runForActiveTenants error:', e?.message || e);
  }
}
setTimeout(() => { runFreshnessMonitorTick(); }, 90000);
setInterval(runFreshnessMonitorTick, 6 * 3600 * 1000);

// schema_migrations 漂移对账（仓库 .sql vs 记账表）；告警走增长管理员通道
startSchemaMigrationDriftMonitor(pool, {
  notifyFn: async (msg) => {
    const send = getSendGrowthAlert();
    if (send) return send(msg, 'schema_migration_drift');
    return sendLarkMessage(FEISHU_ALERT_ADMIN_GROWTH, String(msg || ''), { skipDedup: true });
  },
});

// 经营语义层日更：CST 08:00–08:14 对各活跃租户门店 sync + 诊断（见 ontology/daily-diagnosis-scheduler.js）
startOntologyDailyDiagnosisScheduler(pool);

// 健康中心日巡缓存：CST 07:00–07:14 全量扫描，客服上班前红名单就绪
startHealthCenterDailyScanScheduler(pool);
// 健康中心运营闭环：CST 08:30 队列摘要 + 工作时段 SLA 提醒（投递走 setHealthIncidentNotifiers）
startHealthOpsLoopScheduler(pool);
// Multi-tenant AI quality flywheel: contract-authorized policies are synced for
// active tenants, then tenant-scoped signals become redacted, balanced platform
// evaluation data. Low-risk prompt patches pass offline and live canary gates
// automatically; any regression rolls back without employee interaction.
if (!String(process.env.AI_QUALITY_LLM_API_KEY || '').trim()) {
  console.error('[ai-quality-learning] AI_QUALITY_LLM_API_KEY missing: signal capture and redaction remain active, but proposal generation/evaluation is paused');
}
startAiQualityLearningScheduler(pool, {
  generateCandidate: async ({ route, samples, evidence }) => {
    const result = await runPlatformQualityModelTask(pool, {
      operation: 'generate_prompt_patch',
      route,
      execute: () => callLLM([
      {
        role: 'system',
        content: `你是平台AI质量工程师。根据已脱敏、跨租户汇总的失败样本，为指定路由提出一个最小提示词补丁。
只能总结共性，不得复原或猜测租户、员工、顾客身份，不得照抄样本中的专有名词或数字。
严格返回JSON：{"problem_pattern":"共性问题","prompt_patch":"可追加到系统提示词的明确规则","risk":"潜在副作用","evaluation_focus":["评测重点"]}`,
      },
      {
        role: 'user',
        content: JSON.stringify({ route, evidence, samples }, null, 2).slice(0, 24000),
      },
      ], {
        purpose: 'quality_improvement',
        platformQuality: true,
        temperature: 0,
        max_tokens: 800,
        skipCache: true,
      }),
    });
    if (!result?.ok || !result.content) return null;
    const text = String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  },
  evaluateCandidate: async ({ route, samples, proposal, evidence }) => {
    const result = await runPlatformQualityModelTask(pool, {
      operation: 'evaluate_prompt_patch',
      route,
      execute: () => callLLM([
      {
        role: 'system',
        content: `你是独立AI质量评测器。对已脱敏失败样本与候选提示词补丁进行离线对比评测。
不得猜测或恢复任何身份。只判断补丁能否纠正共性错误、是否有事实依据、是否引入安全风险。
严格返回JSON：{"quality_score":0到1,"groundedness":0到1,"safety_violation_rate":0到1,"negative_feedback_rate":0到1,"p95_latency_ms":0,"rationale":"不超过100字"}`,
      },
      {
        role: 'user',
        content: JSON.stringify({ route, evidence, proposal, samples }, null, 2).slice(0, 24000),
      },
      ], {
        purpose: 'quality_improvement_evaluation',
        platformQuality: true,
        temperature: 0,
        max_tokens: 500,
        skipCache: true,
      }),
    });
    if (!result?.ok || !result.content) return null;
    const text = String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  },
});

// 公告已读回执：员工标记自己已读/已确认某条公告。
// announcements 现在直接对每条公告挂 readBy{username: isoTime} 这个map，不另起新表——
// 用 mergeSharedStateFields 按 id 合并单条公告对象，不会跟其它员工的并发已读/其它字段写入冲突。
app.post('/api/announcements/:id/ack', authRequired, async (req, res) => {
  try {
    const annId = String(req.params.id || '').trim();
    const username = String(req.user?.username || '').trim().toLowerCase();
    if (!annId) return res.status(400).json({ error: 'missing_id' });
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const state = await getSharedState(req.tenantId);
    const anns = Array.isArray(state?.announcements) ? state.announcements : [];
    const ann = anns.find((a) => String(a?.id || '') === annId);
    if (!ann) return res.status(404).json({ error: 'not_found' });
    const readBy = (ann.readBy && typeof ann.readBy === 'object' && !Array.isArray(ann.readBy)) ? { ...ann.readBy } : {};
    if (!readBy[username]) {
      readBy[username] = new Date().toISOString();
      await mergeSharedStateFields({ announcements: [{ ...ann, readBy }] }, { announcements: 'id' }, req.tenantId);
    }
    return res.json({ ok: true, readAt: readBy[username] });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
  }
});

// 管理员查看某条公告的已读情况：总目标人数/已读人数/未读名单
app.get('/api/announcements/:id/receipts', authRequired, async (req, res) => {
  if (!['admin', 'hq_manager', 'store_manager'].includes(String(req.user?.role || ''))) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const annId = String(req.params.id || '').trim();
    const state = await getSharedState(req.tenantId);
    const anns = Array.isArray(state?.announcements) ? state.announcements : [];
    const ann = anns.find((a) => String(a?.id || '') === annId);
    if (!ann) return res.status(404).json({ error: 'not_found' });
    const employees = (Array.isArray(state?.employees) ? state.employees : [])
      .filter((e) => !employeeAccountShouldDisable(e));
    const scope = ann.scope || { type: 'all' };
    const scopeType = String(scope.type || 'all');
    const targets = employees.filter((e) => {
      if (scopeType === 'all') return true;
      if (scopeType === 'hq') return String(e?.store || '') === '总部';
      if (scopeType === 'store') return String(e?.store || '') === String(scope.store || '');
      return false;
    });
    const readBy = (ann.readBy && typeof ann.readBy === 'object') ? ann.readBy : {};
    const unread = targets.filter((e) => !readBy[String(e?.username || '').trim().toLowerCase()]);
    return res.json({
      ok: true,
      total: targets.length,
      readCount: targets.length - unread.length,
      unread: unread.map((e) => ({ username: e.username, name: e.name || e.username, store: e.store || '' }))
    });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
  }
});

app.delete('/api/notifications/:id', authRequired, async (req, res) => {
  if (String(req.user?.role || '') !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const notifId = String(req.params.id || '').trim();
  if (!notifId) return res.status(400).json({ error: 'missing_id' });
  try {
    const r = await pool.query(`DELETE FROM hrms_user_notifications WHERE id = $1`, [notifId]);
    if (r.rowCount === 0) {
      return res.json({ ok: true, deleted: 0, note: 'not_in_db' });
    }
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) {
    console.error('[DELETE /api/notifications/:id] error:', e?.message);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/notifications/batch', authRequired, async (req, res) => {
  const items = Array.isArray(req.body?.notifications) ? req.body.notifications : [];
  if (!items.length) return res.status(400).json({ error: 'empty' });
  try {
    const ids = [];
    for (const n of items) {
      const target = String(n.targetUser || '').trim();
      const title  = String(n.title   || '').trim();
      const msg    = String(n.message || '').trim();
      const type   = String(n.type    || 'system').trim();
      const meta   = (n.meta && typeof n.meta === 'object') ? n.meta : {};
      if (!target || !title) continue;
      const r = await pool.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [target, title, msg, type, meta, resolveTenantIdDefault()]
      );
      ids.push(r.rows[0]?.id);
    }
    return res.json({ ok: true, ids });
  } catch (e) {
    console.error('[POST /api/notifications/batch]', e?.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 企业微信服务器验证接口（配置「接收消息服务器URL」时企微发 GET 请求，返回 echostr 即通过验证）
// 企业微信「接收消息」回调验证（仅用于解锁可信IP；本系统只发消息，不处理被动消息）
// Token / EncodingAESKey 来自环境变量，与企微后台「接收消息」配置一致：
//   WECOM_CALLBACK_TOKEN, WECOM_CALLBACK_AES_KEY
function wecomVerifySignature(token, timestamp, nonce, encrypt) {
  const arr = [token, String(timestamp || ''), String(nonce || ''), String(encrypt || '')].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}
function wecomDecryptEchostr(encryptB64, encodingAesKey) {
  const aesKey = Buffer.from(encodingAesKey + '=', 'base64'); // 32 bytes
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(Buffer.from(encryptB64, 'base64')), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - pad); // 去 PKCS7 填充
  const content = decrypted.subarray(16); // 去 16 字节随机前缀
  const msgLen = content.readUInt32BE(0);
  return content.subarray(4, 4 + msgLen).toString('utf8'); // 明文 echostr
}
app.get('/api/wecom/callback', (req, res) => {
  const token = String(process.env.WECOM_CALLBACK_TOKEN || '').trim();
  const aesKey = String(process.env.WECOM_CALLBACK_AES_KEY || '').trim();
  const { msg_signature, timestamp, nonce, echostr } = req.query || {};
  if (token && aesKey && msg_signature && echostr) {
    try {
      const expect = wecomVerifySignature(token, timestamp, nonce, echostr);
      if (expect !== String(msg_signature)) return res.status(401).send('invalid signature');
      return res.send(wecomDecryptEchostr(String(echostr), aesKey));
    } catch (e) {
      return res.status(400).send('decrypt failed');
    }
  }
  if (echostr) return res.send(String(echostr)); // 明文模式兜底
  return res.send('ok');
});
// 被动接收消息：仅回执，不处理（系统为单向群发）
app.post('/api/wecom/callback', (req, res) => res.send(''));
