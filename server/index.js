import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';
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
import { createPickUsernameHelpers } from './domains/employees/pick-usernames.js';
import { createUserLookupHelpers } from './domains/employees/user-lookup.js';
import { findUserSalary } from './domains/employees/salary-helpers.js';
import { createRoleAccessHelpers } from './domains/shared/role-access.js';
import {
  normalizeRoleForJwt,
  normalizeUsersTableRole,
} from './domains/shared/role-normalize.js';
import {
  deepRepairGarbledStrings,
  createStateClientShapingHelpers,
} from './domains/shared/state-client-shaping.js';
import {
  isLegacyTestUsername,
  cleanupLegacyTestState,
} from './domains/shared/legacy-test-cleanup.js';
import {
  isInactiveStatus,
  employeeAccountShouldDisable,
  createAccountGateHelpers,
} from './domains/employees/account-gate.js';
import {
  safeNumber,
  toNullableUuid,
  hrmsNowISO,
  inDateRange,
  parseMonth,
  clampNum,
  normalizeStoreKey,
  safeDateOnly,
  safeMonthOnly,
  safeUuid,
} from './domains/shared/time-number.js';
import { shanghaiTodayDateOnly } from './domains/leave-attendance/attendance-build.js';
import { createAgentsServiceAuthHelpers } from './domains/shared/agents-service-auth.js';
import { safeErrMessage } from './domains/shared/safe-err-message.js';
import { domainJsonFieldEmpty } from './domains/shared/domain-json-empty.js';
import {
  inferContentType,
  buildInlineContentDisposition,
} from './domains/uploads/content-type.js';
import { createObjectStorageHelpers } from './domains/uploads/object-storage.js';
import { createRequireEnvHelpers } from './domains/shared/require-env.js';
import { createLoginLogHelpers } from './domains/auth/login-log.js';
import { createSessionNonceHelpers } from './domains/auth/session-nonce.js';
import { createAuthMiddlewareHelpers } from './domains/auth/middleware.js';
import { createPayrollLeaveDomainSyncHelpers } from './domains/payroll/domain-sync.js';
import { createHrmsStateSnapshotHelpers } from './domains/shared/hrms-state-snapshot.js';
import { createStateDualWriteHelpers } from './domains/shared/state-dual-write.js';
import { createHrmsStateStoreHelpers } from './domains/shared/hrms-state-store.js';
import { registerStateRoutes } from './domains/hrms-state/routes.js';
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
import {
  normalizeBrandId,
  getBrandsFromState,
  resolveStoreBrandContext,
  getStoreNamesByBrand,
  resolveStoreScopeStores,
  buildKnowledgeBrandScopeTag,
} from './domains/stores/brand-scope.js';
import { registerPaymentConfigRoutes } from './domains/payment-config/routes.js';
import { registerPaymentRoutes } from './domains/payments/routes.js';
import { registerPermissionGroupsRoutes } from './domains/permission-groups/routes.js';
import { registerUploadRoutes } from './domains/uploads/routes.js';
import { createRecordUploadOwnership } from './domains/uploads/ownership.js';
import { registerAiChatCompletionsRoutes } from './domains/ai/routes-chat-completions.js';
import { registerOpsTasksRoutes } from './domains/ops-tasks/routes.js';
import { createOpsTaskHelpers } from './domains/ops-tasks/create-helpers.js';
import { registerStoreDutyBindingsRoutes } from './domains/store-duty-bindings/routes.js';
import { createDutyApproverResolver } from './domains/store-duty-bindings/resolve-approver.js';
import { createStoreAccessContextHelpers } from './domains/store-duty-bindings/store-access-context.js';
import { registerReadsRoutes } from './domains/reads/routes.js';
import { registerAttentionScoresRoutes } from './domains/attention-scores/routes.js';
import { registerAnnouncementExtraRoutes } from './domains/remaining-state/routes-announcement-extra.js';
import { registerNotificationsWriteRoutes } from './domains/notifications/routes.js';
import { registerBirthdayRoutes } from './domains/birthday/routes.js';
import { createBirthdayScheduler } from './domains/birthday/scheduler.js';
import { createRecurringRewardScheduler } from './domains/approvals/scheduler-recurring-reward.js';
import { createPromotionRecipientsHelpers } from './domains/approvals/promotion-recipients.js';
import { createApprovalNormalizeHelpers } from './domains/approvals/normalize-helpers.js';
import { createOffboardingPromotionScheduler } from './domains/approvals/scheduler-offboarding-promotion.js';
import { registerRemainingStateRoutes } from './domains/remaining-state/routes.js';
import { registerGmMailboxRoutes } from './domains/gm-mailbox/routes.js';
import { registerExamResultsRoutes } from './domains/exam-results/routes.js';
import { registerTenantSettingsRoutes } from './domains/tenant-settings/routes.js';
import { registerUsageWeeklyRoutes } from './domains/usage-weekly/routes.js';
import { registerWecomCallbackRoutes } from './domains/wecom/routes-callback.js';
import { registerPromotionTracksRoutes } from './domains/promotion/routes-tracks.js';
import { registerBitableSyncRoutes } from './domains/bitable-sync/routes.js';
import { registerRagRoutes } from './domains/rag/routes.js';
import { getKnowledgeViewerProfile as getKnowledgeViewerProfileFromDomain } from './domains/rag/profile.js';
import { registerFeishuSyncRoutes } from './domains/feishu-sync/routes.js';
import { runManualFeishuBitableSync } from './domains/feishu-sync/manual-bitable-sync.js';
import { registerBitableAdminRoutes } from './domains/bitable-admin/routes.js';
import { registerPerfAdminRoutes } from './domains/perf-admin/routes.js';
import { registerMetricsAdminRoutes } from './domains/metrics-admin/routes.js';
import { registerDedupRoutes } from './domains/dedup/routes.js';
import { registerAdminOpsRoutes } from './domains/admin-ops/routes.js';
import { registerDiagnosisFeedbackRoutes } from './domains/diagnosis/routes.js';
import { registerAgentDataRoutes } from './domains/agent-data/routes.js';
import { registerFeishuWebhookRoutes } from './domains/feishu-webhook/routes.js';
import { registerHealthRoutes } from './domains/health/routes.js';
import { registerWebStaticRoutes } from './domains/health/web-static.js';
import { createEnsureUploadsDir } from './domains/uploads/ensure-dir.js';
import { createHasColumnHelpers } from './domains/shared/has-column.js';
import { createFeishuBitableHelpers } from './domains/feishu-bitable/create-helpers.js';
import { createInventoryForecastHelpers } from './domains/inventory-forecast/create-helpers.js';
import { createLeaveAttendanceHelpers } from './domains/leave-attendance/create-helpers.js';
import { createAttendanceMirrorHelpers } from './domains/leave-attendance/attendance-mirror.js';
import {
  haversineDistance,
  resolveCheckinRadiusMeters,
} from './domains/leave-attendance/checkin-geo.js';
import { createNotificationsHelpers } from './domains/notifications/create-helpers.js';
import { createNotificationsCleanupScheduler } from './domains/notifications/scheduler-cleanup.js';
import { createFreshnessMonitorScheduler } from './domains/notifications/scheduler-freshness.js';
import {




} from './tenant-integrations.js';
import multer from 'multer';
import https from 'https';
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

import XLSX from 'xlsx';
import axios from 'axios';
import { setPool as setAgentPool, ensureAgentTables, registerAgentRoutes, startAgentScheduler, setTaskResponseHook, startBitablePolling, startScheduledTasks, assertCriticalFunctions, verifyLLMHealth, getAgentHealthStatus, startWeeklyReportScheduler, sendWeeklyReports, sendMonthlyReports, sendTestReportsToUser, lookupFeishuUserByUsername, sendLarkMessage, onFeishuEvent, callLLM, invalidateTenantLlmConfigCache, getBitableSubmissionStats, archiveOldBitableSubmissions } from './agents.js';
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
import { ensureRecipeSchema, registerRecipeRoutes } from './recipe-management.js';
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
} from './services/hrms-permission-engine.js';
import {
  ensureEmployeeAttachmentsTable as ensureEmployeeAttachmentsTableImpl,
  ensureHrmsStateTable as ensureHrmsStateTableImpl,
  ensureApprovalTables as ensureApprovalTablesImpl,
  ensureUserSessionsTable as ensureUserSessionsTableImpl,
  ensureTenantRuntimeTables as ensureTenantRuntimeTablesImpl,
  ensureUserReadsTable as ensureUserReadsTableImpl,
  ensureLoginLogTable as ensureLoginLogTableImpl,
} from './services/hrms-core-schema-ensure.js';
import { createExpressErrorMiddleware } from './domains/health/express-error-middleware.js';
import { registerProcessGuards } from './domains/health/process-guards.js';
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
  canAccessApprovalCenter,

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

// Wave H28: requireEnv → domains/shared/require-env.js
const { requireEnv } = createRequireEnvHelpers({
  databaseUrl: DATABASE_URL,
  jwtSecret: JWT_SECRET,
});
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
// Wave H27: safeErrMessage → domains/shared/safe-err-message.js (named import)
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

// Wave H28: COS/OSS helpers → domains/uploads/object-storage.js
// Must run before registerKnowledgeRoutes / registerHealthRoutes (factory not hoisted).
const {
  getOssClient,
  getCosClient,
  buildCosPublicUrl,
  buildOssPublicUrl,
} = createObjectStorageHelpers({
  COS,
  cosSecretId: COS_SECRET_ID,
  cosSecretKey: COS_SECRET_KEY,
  cosBucket: COS_BUCKET,
  cosRegion: COS_REGION,
  cosPublicBaseUrl: COS_PUBLIC_BASE_URL,
});

// 飞书配置
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEISHU_ENCRYPT_KEY = process.env.FEISHU_ENCRYPT_KEY;

const uploadsDir = path.join(__dirname, 'uploads');
// Wave H30: ensureUploadsDir → domains/uploads/ensure-dir.js (before multer)
const { ensureUploadsDir } = createEnsureUploadsDir({ fs, uploadsDir });

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



// Wave 4p: dish-weekly resend → domains/perf-admin/routes.js

// Wave 4p: bitable stats/archive → domains/bitable-admin/routes.js

// Wave 4q: agent feishu-table-data → domains/agent-data/routes.js

// Wave H12: POST /api/ai/chat-completions → domains/ai/routes-chat-completions.js
// Wave 4f: /api/payments/* → domains/payments/routes.js
// Wave 4c: POST /api/approvals (create), return, resubmit, repair-onboarding → domains/approvals/routes-lifecycle.js

// Wave 4m: /api/reads/batch + /api/unread-counts → domains/reads/routes.js

// Wave H12: GET /uploads/* + recordUploadOwnership → domains/uploads/*

const webRootDir = path.resolve(__dirname, '..');
// Wave H30: whitelisted static + shell HTML → domains/health/web-static.js
registerWebStaticRoutes(app, { express, fs, path, webRootDir });

// Wave 4h: /api/permission-groups* → domains/permission-groups/routes.js

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

// Wave H12: recipeMediaUpload + /api/recipes/{upload-step-media,template,import} → recipe-management.js

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

// Wave 4i / H12: POST /api/uploads/* + GET /uploads/* + growth/upload → domains/uploads/routes.js

const pool = new Pool({ connectionString: DATABASE_URL });
const recordUploadOwnership = createRecordUploadOwnership(pool);
const loginRateLimit = createLoginRateLimiter();
const platformAdminRequired = createPlatformAdminRequired(pool, PLATFORM_ADMIN_JWT_SECRET);

// Wave H28: recordLogin / recordLogout → domains/auth/login-log.js
const { recordLogin, recordLogout } = createLoginLogHelpers({ pool, tenantContext });

// Wave H29: storeSessionNonce → domains/auth/session-nonce.js
// Before createAccountGateHelpers / registerAuthRoutes (factory not hoisted).
const { storeSessionNonce } = createSessionNonceHelpers({ pool, resolveTenantIdDefault });

// Wave H30: hasColumn → domains/shared/has-column.js (before ensureExamResultsTable runtime)
const { hasColumn } = createHasColumnHelpers({ pool });

// Wave H11: user/employee lookup helpers → domains/employees/user-lookup.js
// Must run after pool + expandAgentStoreLabels import; BEFORE registerPointsRoutes
// (and any other register* that DI-injects these — factories are NOT hoisted).
const {
  stateFindUserRecord,
  dbFindEmployeeRecord,
  dbListEmployeesForReports,
  stateOrDbFindUserRecord,
  pickMyStoreFromState,
} = createUserLookupHelpers({ pool, expandAgentStoreLabels });

// Wave H31: auth middleware late-bind wrappers (impl assigned after account-gate + store-access).
// Early register*(app, authRequired) must keep a stable function reference.
let _authRequiredImpl = null;
let _authRequiredOrQueryTokenImpl = null;
async function authRequired(req, res, next) {
  if (!_authRequiredImpl) return res.status(503).json({ error: 'auth_not_ready' });
  return _authRequiredImpl(req, res, next);
}
async function authRequiredOrQueryToken(req, res, next) {
  if (!_authRequiredOrQueryTokenImpl) return res.status(503).json({ error: 'auth_not_ready' });
  return _authRequiredOrQueryTokenImpl(req, res, next);
}

// Wave H33: hrms_state hub late-bind wrappers (impl after account-gate + dual-write + schedules).
let _getSharedStateImpl = null;
let _saveSharedStateImpl = null;
let _mergeSharedStateFieldsImpl = null;
let _removeEmployeesFromSharedStateImpl = null;
async function getSharedState(tenantId) {
  if (!_getSharedStateImpl) throw new Error('getSharedState_not_ready');
  return _getSharedStateImpl(tenantId);
}
async function saveSharedState(nextData, tenantId) {
  if (!_saveSharedStateImpl) throw new Error('saveSharedState_not_ready');
  return _saveSharedStateImpl(nextData, tenantId);
}
async function mergeSharedStateFields(patches, arrayIdFields, tenantId) {
  if (!_mergeSharedStateFieldsImpl) throw new Error('mergeSharedStateFields_not_ready');
  return _mergeSharedStateFieldsImpl(patches, arrayIdFields, tenantId);
}
async function removeEmployeesFromSharedState(usernames, tenantId) {
  if (!_removeEmployeesFromSharedStateImpl) throw new Error('removeEmployeesFromSharedState_not_ready');
  return _removeEmployeesFromSharedStateImpl(usernames, tenantId);
}

// Wave H31: hrms_state snapshot → domains/shared/hrms-state-snapshot.js
const { captureHrmsStateSnapshotToDb } = createHrmsStateSnapshotHelpers({ pool });

const loadTenantRuntimeStatus = (tenantId) => loadTenantRuntimeStatusFromModule(pool, tenantId);

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
// Wave H4: registerKnowledgeRoutes / registerDailyReportsRoutes
// 延后到 createNotificationsHelpers 之后（notifyAdminsOcrFailed / notifyAdminsDualWriteFailure 等非 hoisted）
// Wave H3: registerCheckinRoutes / registerReportsRoutes / registerHrmsPayrollClosedLoopRoutes
// 延后到 createLeaveAttendanceHelpers 之后（工厂非 hoisted，不能在定义前 capture）
// Wave H17: registerHrmsPermissionRoutes / registerDailyReportsRoutes / registerInventoryForecastRoutes /
// registerReportsRoutes / registerHrmsPayrollClosedLoopRoutes
// 延后到 createRoleAccessHelpers 之后（工厂非 hoisted；normalizeRoleForJwt 已为 H19 顶层 import）
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

// Wave H23: agents-service base URL + admin JWT cache → domains/shared/agents-service-auth.js
// Must run before registerAgentTaskBoardRoutes / registerTenantSettingsRoutes (factory not hoisted).
const { getAgentsServiceBaseUrl, getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({ axios });

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

// Wave H12: POST /api/growth/upload → domains/uploads/routes.js

async function ensureEmployeeAttachmentsTable() {
  return ensureEmployeeAttachmentsTableImpl(pool);
}
if (__ALLOW_SCHEMA_CHANGES__) ensureEmployeeAttachmentsTable();

// Wave 4l: employee attachments → domains/employees/routes-attachments.js

// Wave H30: hasColumn → domains/shared/has-column.js

async function ensureHrmsStateTable() {
  return ensureHrmsStateTableImpl(pool);
}

async function ensureApprovalTables() {
  return ensureApprovalTablesImpl(pool);
}

async function ensureUserSessionsTable() {
  return ensureUserSessionsTableImpl(pool, DATABASE_URL);
}

async function ensureTenantRuntimeTables() {
  return ensureTenantRuntimeTablesImpl(pool, DATABASE_URL);
}

async function ensureUserReadsTable() {
  return ensureUserReadsTableImpl(pool);
}

async function ensureLoginLogTable() {
  return ensureLoginLogTableImpl(pool);
}

// Wave H28: recordLogin / recordLogout → domains/auth/login-log.js (after pool)

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

// Wave H25: haversineDistance / resolveCheckinRadiusMeters → domains/leave-attendance/checkin-geo.js

// Wave H20: isLegacyTestUsername / cleanupLegacyTestState → domains/shared/legacy-test-cleanup.js

// tenantContext/resolveTenantIdDefault现在是utils/database.js里的共享实例(见该文件注释)，
// 这样agents.js/performance-jobs.js等同一进程内的其它文件也能读到authRequired设置的租户上下文。


// Wave H33: get/save/merge/removeEmployees shared-state → domains/shared/hrms-state-store.js
// (late-bind wrappers near pool; real impl after account-gate)

// Wave H31: captureHrmsStateSnapshotToDb → domains/shared/hrms-state-snapshot.js (after pool)

// Wave H4: notifications write/alert helpers（须在 mergeSharedStateFields 之后、createFeishuBitableHelpers 之前）
const {
  notifyAdminsDualWriteFailure,
  notifyAdminsOcrFailed,
  makeNotif,
  addStateNotification,
  appendNotifications,
  sendAdminSystemAlert,
  uniqUsernames,
  insertHrmsUserNotifications,
  systemAlertTitle,
} = createNotificationsHelpers({
  pool,
  mergeSharedStateFields,
  resolveTenantIdDefault,
  hrmsNowISO, // Wave H18: imported from domains/shared/time-number.js
  sendLarkMessage,
  lookupFeishuUserByUsername,
});

// Wave H29: payroll/leave domain dual-write → domains/payroll/domain-sync.js
// After getSharedState + notifyAdminsDualWriteFailure; ensureLeaveDomainTable stays in index.
const {
  upsertPayrollDomainFromState,
  upsertLeaveDomainFromState,
  schedulePayrollDomainSync,
  scheduleLeaveDomainSync,
} = createPayrollLeaveDomainSyncHelpers({
  pool,
  resolveTenantIdDefault,
  getSharedState,
  notifyAdminsDualWriteFailure,
});

// Wave H32: dualWriteStateToDB → domains/shared/state-dual-write.js
// After notifyAdminsDualWriteFailure; saveSharedState calls at runtime (not module-load).
const { dualWriteStateToDB } = createStateDualWriteHelpers({
  pool,
  resolveTenantIdDefault,
  upsertEmployeesFromStateShape,
  hrmsNowISO,
  toNullableUuid,
  notifyAdminsDualWriteFailure,
});

const {
  tryParseJson,
  decryptFeishuEncryptPayload,
  findConfigKeyByTableInfo,
  stripAttachmentLikeFields,
  mapFeishuFieldToHrms,
  upsertFeishuGenericRecord,
  ensureFeishuGenericRecordsTable,
  ensureFeishuGenericRecordsNotifyTrigger,
  ensureFeishuSyncTable,
  ensureDedupIndexes,
  ensureTableVisitRecordsTable,
  getFeishuAccessToken,
  createFeishuBitableRecord,
  getFeishuBitableData,
} = createFeishuBitableHelpers({
  pool,
  axios,
  isExternalEnabled,
  safeErrMessage,
  notifyAdminsDualWriteFailure,
  feishuEnv: {
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    baseUrl: FEISHU_BASE_URL,
    encryptKey: FEISHU_ENCRYPT_KEY || process.env.FEISHU_ENCRYPT_KEY || process.env.LARK_ENCRYPT_KEY || '',
  },
});
registerPhaseRoutes(app, pool, { getFeishuBitableData });

registerKnowledgeRoutes(app, {
  pool,
  authRequired,
  authRequiredOrQueryToken,
  getKnowledgeViewerProfile: (req) => getKnowledgeViewerProfileFromDomain(req, getSharedState),
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
// Wave H17: registerDailyReportsRoutes → after createRoleAccessHelpers (isAdmin)

// Wave H32: dualWriteStateToDB → domains/shared/state-dual-write.js

// Wave H27: payrollDomainFieldEmpty / leaveDomainFieldEmpty → domainJsonFieldEmpty
// (domains/shared/domain-json-empty.js)

// Wave H29: upsert/schedule payroll+leave domain → domains/payroll/domain-sync.js

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

// Wave H24: upsertEmployeeAttendanceMirrorFromCheckinRow → domains/leave-attendance/attendance-mirror.js
// Instantiated with leaveAttendanceHelpers before registerCheckinRoutes.

// Wave H10: pick*Username helpers → domains/employees/pick-usernames.js
// Must run after pool + resolveTenantIdDefault; before promotion-recipients / recurring-reward / ops-tasks.
// (Wave H11 user-lookup factory already ran early after pool — stateFindUserRecord is in scope.)
const {
  pickAdminUsername,
  pickHqManagerUsername,
  pickHrManagerUsername,
  pickCashierUsername,
  pickStoreRoleUsernameByStore,
} = createPickUsernameHelpers({ pool, resolveTenantIdDefault });

// Wave H8: kitchen + promotion-track recipients → domains/approvals/promotion-recipients.js
const { isKitchenByRoleOrPosition, getPromotionTrackRecipients } = createPromotionRecipientsHelpers({
  pickStoreRoleUsernameByStore,
  pickHqManagerUsername,
  uniqUsernames,
  stateFindUserRecord,
});

// Wave H18: safeNumber / toNullableUuid / hrmsNowISO / inDateRange / parseMonth / clampNum /
// normalizeStoreKey / safeDateOnly / safeMonthOnly → domains/shared/time-number.js (named imports)

// Wave H17: role access gates → domains/shared/role-access.js
// see createRoleAccessHelpers below (normalizeRoleForJwt is H19 top-level import).

// Wave H12: normalizeOpenAiCompatibleBaseUrl → domains/ai/routes-chat-completions.js

// Wave H17: getStateUsers / findUserSalary → domains/employees/salary-helpers.js

// Wave H14: resolveDutyApproverForStore → domains/store-duty-bindings/resolve-approver.js
// Instantiate after pool; before createRecurringRewardScheduler (which needs the resolver).
// ensureStoreDutyBindingsReady reuses domains/service.js ensureReady (no second ready flag).
const { resolveDutyApproverForStore, ensureStoreDutyBindingsReady } = createDutyApproverResolver({ pool });

// Wave H7: monthly recurring reward/punishment templates cron → domains/approvals/scheduler-recurring-reward.js
// Factory after resolveDutyApproverForStore; start inside app.listen (not module-load).
const { startRecurringRewardScheduler } = createRecurringRewardScheduler({
  pool,
  getSharedState,
  saveSharedState,
  getActiveTenantIds,
  tenantContext,
  pickAdminUsername,
  pickHqManagerUsername,
  pickCashierUsername,
  pickHrManagerUsername,
  stateFindUserRecord,
  buildConfiguredApprovalAssignees,
  resolveDutyApproverForStore,
  addStateNotification,
  makeNotif,
  lookupFeishuUserByUsername,
  sendLarkMessage,
});

// Wave H15: getUserStoreAccessContext → domains/store-duty-bindings/store-access-context.js
// After H14 ensureStoreDutyBindingsReady; see createStoreAccessContextHelpers call below
// (normalizeRoleForJwt is H19 top-level import).

// Wave 4j: /api/ops/tasks* → domains/ops-tasks/routes.js

// Wave 4q: admin reconcile/leave-close → domains/admin-ops/routes.js

// Wave 4p: metrics admin → domains/metrics-admin/routes.js

// Wave 4q: diagnosis feedback/stats → domains/diagnosis/routes.js

// Wave 4q: sales-raw folder import → domains/admin-ops/routes.js

// Wave H16: approval normalize helpers (safeDateOnly from H18 import; before registerApproval*)
const {
  normalizePromotionTrainingPeriods,
  normalizeApprovalType,
  getPaymentFlowForStore,
  approvalTypeLabel,
} = createApprovalNormalizeHelpers({ safeDateOnly, randomUUID });

// Wave H5: ops-tasks helpers + scheduler (safeDateOnly from H18 import; ensureOpsTasksTable / pickStoreRoleUsernameByStore hoisted)
const {
  normalizeOpsRole,
  buildOpsFeedback,
  startOpsTaskScheduler,
} = createOpsTaskHelpers({
  pool,
  safeDateOnly,
  getSharedState,
  resolveTenantIdDefault,
  pickStoreRoleUsernameByStore,
  runForActiveTenants,
  ensureOpsTasksTable,
});

// Wave H2b: inventory-forecast helpers factory (safeDateOnly/safeNumber/inDateRange/hrmsNowISO/normalizeStoreKey from H18 import + brand/store utils)
const forecastHelpers = createInventoryForecastHelpers({
  safeDateOnly,
  safeNumber,
  inDateRange,
  normalizeBrandId,
  resolveStoreBrandContext,
  resolveTenantIdDefault,
  getBrandForStoreSync,
  getBrandConfigSync,
  pickMyStoreFromState,
  getBrandsFromState,
  getStoreNamesByBrand,
  pool,
  hrmsNowISO,
  randomUUID,
  normalizeStoreKey,
});
// Wave H17: registerInventoryForecastRoutes → after createRoleAccessHelpers (canAccessAnalyticsReports)

// Wave H3: leave/attendance calc helpers（safeMonthOnly / clampNum / hrmsNowISO from H18 import + getSharedState 等）
const leaveAttendanceHelpers = createLeaveAttendanceHelpers({
  pool,
  getSharedState,
  mergeSharedStateFields,
  safeDateOnly,
  safeMonthOnly,
  isLegacyTestUsername,
  clampNum,
  hrmsNowISO,
});

// Wave H24: dual-write checkin → employee_attendance_records (no DDL)
const { upsertEmployeeAttendanceMirrorFromCheckinRow } = createAttendanceMirrorHelpers({ pool });

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
  calcEmployeeMonthlyLeaveBalance: leaveAttendanceHelpers.calcEmployeeMonthlyLeaveBalance,
  computeAttendanceMissingClockPenalties: leaveAttendanceHelpers.computeAttendanceMissingClockPenalties,
  hrmsAttendanceWindowMinutesForStore: leaveAttendanceHelpers.hrmsAttendanceWindowMinutesForStore,
  hrmsDateKeyInShanghai: leaveAttendanceHelpers.hrmsDateKeyInShanghai,
  hrmsClockMinutesInShanghai: leaveAttendanceHelpers.hrmsClockMinutesInShanghai,
  dailyReportRestDaysForEmployee: leaveAttendanceHelpers.dailyReportRestDaysForEmployee,
  leaveBalanceOverrideKey: leaveAttendanceHelpers.leaveBalanceOverrideKey,
  shiftMonth: leaveAttendanceHelpers.shiftMonth,
  hrmsNowISO,
  pickHrManagerUsername,
  appendNotifications,
  upsertEmployeeAttendanceMirrorFromCheckinRow,
  notifyAdminsDualWriteFailure,
  haversineDistance,
  resolveCheckinRadiusMeters,
  randomUUID,
});
// Wave H17: registerReportsRoutes / registerHrmsPayrollClosedLoopRoutes → after createRoleAccessHelpers

// Wave H26: safeUuid → domains/shared/time-number.js (named import)

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

// Wave H28: getOssClient / getCosClient / build*PublicUrl → domains/uploads/object-storage.js
// Wave H28: requireEnv → domains/shared/require-env.js
// Wave H31: authRequired / authRequiredOrQueryToken / loadTenantRuntimeStatus → late-bind + domains/auth/middleware.js

// Wave H19: normalizeRoleForJwt / normalizeUsersTableRole → domains/shared/role-normalize.js (top import)

// Wave H15: after H14 ensureStoreDutyBindingsReady; before registerAuthRoutes /
// any capture of getUserStoreAccessContext at module load.
const { getUserStoreAccessContext } = createStoreAccessContextHelpers({
  pool,
  getSharedState,
  resolveTenantIdDefault,
  normalizeRoleForJwt,
  resolveStoreScopeStores,
  ensureStoreDutyBindingsReady,
});

// Wave H17: role access gates → domains/shared/role-access.js
// Before register* that inject these.
const {
  isAdmin,
  isHq,
  canAccessAnalyticsReports,
  canAccessDailyAttendanceRegister,
  canAccessBusinessReports,
} = createRoleAccessHelpers({ normalizeRoleForJwt });

registerHrmsPermissionRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  saveSharedState,
  isAdmin,
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

registerInventoryForecastRoutes(app, {
  pool,
  authRequired,
  upload,
  uploadsDir,
  getSharedState,
  saveSharedState,
  pickMyStoreFromState,
  safeDateOnly,
  resolveTenantIdDefault,
  canAccessAnalyticsReports,
  normalizeBrandId,
  resolveStoreBrandContext,
  getStoreNamesByBrand,
  normalizeStoreKey,
  safeNumber,
  inDateRange,
  hrmsNowISO,
  ...forecastHelpers,
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
  calcEmployeeMonthlyLeaveBalance: leaveAttendanceHelpers.calcEmployeeMonthlyLeaveBalance,
  computeAttendanceMissingClockPenalties: leaveAttendanceHelpers.computeAttendanceMissingClockPenalties,
  buildAttendanceFromCheckinRecords: leaveAttendanceHelpers.buildAttendanceFromCheckinRecords,
  buildAttendanceFromReports: leaveAttendanceHelpers.buildAttendanceFromReports,
  buildAttendanceSummaryRows: leaveAttendanceHelpers.buildAttendanceSummaryRows,
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

registerHrmsPayrollClosedLoopRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  mergeSharedStateFields,
  calcEmployeeMonthlyLeaveBalance: leaveAttendanceHelpers.calcEmployeeMonthlyLeaveBalance,
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

// Wave H26: shanghaiTodayDateOnly → domains/leave-attendance/attendance-build.js (named import)

// Wave H19: account gate → domains/employees/account-gate.js
// After pool / DATABASE_URL / tenantContext / getSharedState / stateFindUserRecord
// (storeSessionNonce is a function declaration — hoisted). Before registerAuthRoutes /
// birthday+offboarding schedulers that DI-capture these at module load.
const {
  applyHrmsUserAccountGateFromEmployee,
  assertEmployeeLoginAllowedByState,
} = createAccountGateHelpers({
  pool,
  DATABASE_URL,
  tenantContext,
  storeSessionNonce,
  randomUUID,
  getSharedState,
  stateFindUserRecord,
});

// Wave H31: bind real auth middleware after account-gate + store-access-context
{
  const authMw = createAuthMiddlewareHelpers({
    jwt,
    jwtSecret: JWT_SECRET,
    pool,
    tenantContext,
    assertEmployeeLoginAllowedByState,
    getSharedState,
    pickMyStoreFromState,
    getUserStoreAccessContext,
  });
  _authRequiredImpl = authMw.authRequired;
  _authRequiredOrQueryTokenImpl = authMw.authRequiredOrQueryToken;
}

// Wave H33: bind hrms_state hub after account-gate + dual-write + payroll/leave schedules
{
  const stateStore = createHrmsStateStoreHelpers({
    pool,
    resolveTenantIdDefault,
    schedulePayrollDomainSync,
    scheduleLeaveDomainSync,
    dualWriteStateToDB,
    applyHrmsUserAccountGateFromEmployee,
    upsertEmployeeFromStateShape,
    notifyAdminsDualWriteFailure,
  });
  _getSharedStateImpl = stateStore.getSharedState;
  _saveSharedStateImpl = stateStore.saveSharedState;
  _mergeSharedStateFieldsImpl = stateStore.mergeSharedStateFields;
  _removeEmployeesFromSharedStateImpl = stateStore.removeEmployeesFromSharedState;
}

// Wave H22: state client-shaping → domains/shared/state-client-shaping.js
// After H15 getUserStoreAccessContext + pool; before GET/PUT /api/state.
const {
  stripPasswordFieldsFromStateForClient,
  applyStatePeopleVisibilityForRole,
} = createStateClientShapingHelpers({
  normalizeRoleForJwt,
  getUserStoreAccessContext,
  pool,
});

// Wave H34: GET/PUT /api/state → domains/hrms-state/routes.js
registerStateRoutes(app, authRequired, {
  pool,
  getSharedState,
  resolveTenantIdDefault,
  deepRepairGarbledStrings,
  hydrateStateFromAuthoritativeTables,
  hydrateEmployeesFromTable,
  hydrateFlowConfigFromTable,
  hydrateNotificationsFromTable,
  hydrateExamResultsFromTable,
  stripPasswordFieldsFromStateForClient,
  applyStatePeopleVisibilityForRole,
  applyStatePutWhitelist,
  upsertPayrollDomainFromState,
  notifyAdminsDualWriteFailure,
  applyHrmsUserAccountGateFromEmployee,
});

// Wave 4q: employee-password → domains/admin-ops/routes.js

// Wave 4o: promotion tracks + bitable-sync → domains/promotion, domains/bitable-sync

// Wave H23: getAgentsServiceBaseUrl / getAgentsServiceAdminToken → domains/shared/agents-service-auth.js
// (instantiated before registerAgentTaskBoardRoutes)

// Wave 4o: chairman/tenant-settings → domains/tenant-settings/routes.js

// Wave H21: /api/health + /api/version → domains/health/
registerHealthRoutes(app, {
  requireEnv,
  pool,
  getOssClient,
  getCosClient,
  ensureUploadsDir,
  getAgentHealthStatus,
  hrmsNowISO,
  sendLarkMessage,
  STARTED_AT,
  indexFilePath: __filename,
  serverDir: __dirname,
});

// Wave 4o: exam-results → domains/exam-results/routes.js

// Wave 4g: stores CRUD/brands/location → domains/stores/*

// Wave H29: storeSessionNonce → domains/auth/session-nonce.js (after pool)

// Wave 4p: rag + getKnowledgeViewerProfile → domains/rag/*

// Wave 4q: feishu webhook + processFeishuDataChange → domains/feishu-webhook/*

// Wave 4p: feishu sync HTTP + runManualFeishuBitableSync → domains/feishu-sync/*

// Wave 4q: system-alert test → domains/admin-ops/routes.js

// Wave 4q: feishu-table-write + table-visit → domains/agent-data/routes.js

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

registerAiChatCompletionsRoutes(app, authRequired);

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
  calcDateSpanDaysInclusive: leaveAttendanceHelpers.calcDateSpanDaysInclusive,
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
  upload,
  recordUploadOwnership,
  uploadsDir,
  resolveTenantIdDefault,
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
  pool,
  uploadsDir,
});

registerOpsTasksRoutes(app, authRequired, {
  pool,
  safeDateOnly,
  normalizeOpsRole,
  buildOpsFeedback,
});

registerStoreDutyBindingsRoutes(app, authRequired, { pool });

registerReadsRoutes(app, authRequired, {
  pool,
  getSharedState,
  stateFindUserRecord,
  dbFindEmployeeRecord,
});

registerAttentionScoresRoutes(app, authRequired, {
  pool,
  getSharedState,
  resolveTenantIdDefault,
});

registerAnnouncementExtraRoutes(app, authRequired, {
  getSharedState,
  mergeSharedStateFields,
  employeeAccountShouldDisable,
});

registerNotificationsWriteRoutes(app, authRequired, {
  pool,
  resolveTenantIdDefault,
});

registerBirthdayRoutes(app, authRequired, {
  getSharedState,
  saveSharedState,
  isInactiveStatus,
  employeeAccountShouldDisable,
  addStateNotification,
  makeNotif,
  hrmsNowISO,
  pickAdminUsername,
  pickHrManagerUsername,
  stateFindUserRecord,
});

registerExamResultsRoutes(app, authRequired, { pool });

registerTenantSettingsRoutes(app, authRequired, {
  axios,
  getAgentsServiceBaseUrl,
  getAgentsServiceAdminToken,
});

registerUsageWeeklyRoutes(app, authRequired, { pool });

registerWecomCallbackRoutes(app);

registerPromotionTracksRoutes(app, authRequired, {
  getSharedState,
  stateFindUserRecord,
  getPromotionTrackProgress,
});

registerBitableSyncRoutes(app, authRequired, { pool });

registerRagRoutes(app, authRequired, {
  getSharedState,
  ragStats,
  ragQuery,
  ragMultiQuery,
});

registerFeishuSyncRoutes(app, authRequired, {
  pool,
  safeErrMessage,
  getFeishuAccessToken,
  getFeishuBitableData,
  findConfigKeyByTableInfo,
  upsertFeishuGenericRecord,
  mapFeishuFieldToHrms,
  notifyAdminsDualWriteFailure,
  syncDishLibraryCosts,
  syncSopSteps,
  lookupFeishuUserByUsername,
  sendLarkMessage,
});

registerBitableAdminRoutes(app, authRequired, {
  getBitableSubmissionStats,
  archiveOldBitableSubmissions,
});

registerPerfAdminRoutes(app, authRequired, {
  getLastCompletedWeekRangeShanghai,
  sendWeeklyDishOptimizationReport,
});

registerMetricsAdminRoutes(app, authRequired, {
  pool,
  updateMetricVersion,
});

registerDedupRoutes(app, authRequired, { pool });

registerAdminOpsRoutes(app, authRequired, {
  pool,
  canAccessDailyAttendanceRegister,
  safeDateOnly,
  safeMonthOnly,
  safeErrMessage,
  backfillDailyAttendanceRegisterMissing,
  runLeaveCumulativeCloseSnapshotForClosedMonth: leaveAttendanceHelpers.runLeaveCumulativeCloseSnapshotForClosedMonth,
  runSalesRawFolderImportOnce,
  notifyAdminsDualWriteFailure,
  normalizeRoleForJwt,
  loadEmployeesFromTable,
  getSharedState,
  sendAdminSystemAlert,
  hrmsNowISO,
});

registerDiagnosisFeedbackRoutes(app, authRequired, {
  pool,
  recordAiFeedback,
});

registerAgentDataRoutes(app, authRequired, {
  pool,
  safeErrMessage,
  getFeishuAccessToken,
  createFeishuBitableRecord,
  findConfigKeyByTableInfo,
  upsertFeishuGenericRecord,
});

registerFeishuWebhookRoutes(app, {
  express,
  pool,
  isWebhookEnabled,
  tryParseJson,
  verifyFeishuWebhookRequest,
  requireWebhookSignature,
  decryptFeishuEncryptPayload,
  resolveWebhookTenantId,
  tenantContext,
  randomUUID,
  safeErrMessage,
  notifyAdminsDualWriteFailure,
  onFeishuEvent,
  resolveTenantIdDefault,
  loadTenantFeishuBitableConfig,
  getFeishuTokenByConfig,
  getFeishuAccessToken,
  getFeishuBitableData,
  findConfigKeyByTableInfo,
  upsertFeishuGenericRecord,
  mapFeishuFieldToHrms,
});

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
registerRecipeRoutes(app, authRequired, {
  upload,
  uploadsDir,
  ensureUploadsDir,
  recordUploadOwnership,
});
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
        pool,
        getFeishuAccessToken,
        getFeishuBitableData,
        findConfigKeyByTableInfo,
        upsertFeishuGenericRecord,
        mapFeishuFieldToHrms,
        notifyAdminsDualWriteFailure,
      }, {
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
          if (domainJsonFieldEmpty(stVal) && !domainJsonFieldEmpty(dbVal)) {
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
          if (domainJsonFieldEmpty(stVal) && !domainJsonFieldEmpty(dbVal)) {
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
            const closedMonth = leaveAttendanceHelpers.shiftMonth(curYm, -1);
            if (!closedMonth) return;
            const r = await leaveAttendanceHelpers.runLeaveCumulativeCloseSnapshotForClosedMonth(closedMonth);
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

    startRecurringRewardScheduler();

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

app.use(createExpressErrorMiddleware({ multer }));

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

// Wave H8: offboarding auto-disable + promotion sweep → domains/approvals/scheduler-offboarding-promotion.js
// Factory after H19 applyHrmsUserAccountGateFromEmployee / notifications / getPromotionTrackRecipients; module-load start (before birthday H6).
const { startOffboardingPromotionScheduler } = createOffboardingPromotionScheduler({
  pool,
  runForActiveTenants,
  getSharedState,
  saveSharedState,
  ensureApprovalTables,
  safeDateOnly,
  hrmsNowISO,
  applyHrmsUserAccountGateFromEmployee,
  addStateNotification,
  makeNotif,
  getPromotionTrackProgress,
  getPromotionTrackRecipients,
});
startOffboardingPromotionScheduler();

// Wave H6: birthday greeting cron → domains/birthday/scheduler.js（module-load start, same as legacy setInterval）
const { startBirthdayGreetingScheduler } = createBirthdayScheduler({
  getSharedState,
  saveSharedState,
  runForActiveTenants,
  addStateNotification,
  makeNotif,
  hrmsNowISO,
  isInactiveStatus,
  employeeAccountShouldDisable,
  pickAdminUsername,
  pickHrManagerUsername,
  stateFindUserRecord,
  getNow: () => new Date(),
});
startBirthdayGreetingScheduler();

// Wave 4n: /api/birthday/* HTTP → domains/birthday/routes.js；cron → domains/birthday/scheduler.js（Wave H6）

// Wave 4n: /api/attention-scores* → domains/attention-scores/routes.js

// Wave 4o: usage-weekly → domains/usage-weekly/routes.js

registerProcessGuards({ sendLarkMessage, FEISHU_ALERT_ADMIN_HEALTH });

// Wave H13: notification cleanup + freshness monitor cron → domains/notifications/scheduler-*.js
const { startNotificationsCleanupScheduler } = createNotificationsCleanupScheduler({
  pool,
  runForActiveTenants,
});
startNotificationsCleanupScheduler();

const { startFreshnessMonitorScheduler } = createFreshnessMonitorScheduler({
  pool,
  runForActiveTenants,
  runFreshnessCheck,
  FRESHNESS_SOURCES,
  sendLarkMessage,
});
startFreshnessMonitorScheduler();

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
// Wave 4n: announcements ack/receipts + notifications write → domains

// Wave 4o: wecom callback → domains/wecom/routes-callback.js
