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
import { registerApplicationRoutes } from './domains/app/routes.js';
import { createApplicationRouteDeps } from './domains/app/create-application-route-deps.js';
import {
  registerApprovalDecideRoutes,
  registerApprovalLifecycleRoutes,
  buildOnboardingEmployeeRecordFromPayload,
} from './domains/approvals/routes.js';
import { applyStatePutWhitelist } from './hrms-state-put.js';
import { registerPayrollDomainRoutes } from './domains/payroll/routes.js';
import { registerEmployeesDomainRoutes } from './domains/employees/routes.js';
import {
  upsertEmployeeFromStateShape,
  upsertEmployeesFromStateShape,
  loadEmployeesFromTable,
} from './domains/employees/service.js';
import { reconcileEmployeesMirrorAllTenants } from './domains/employees/mirror-tx.js';
import { reconcileFlowConfigMirrorAllTenants } from './domains/flow-config/reconcile.js';
import { createMirrorReconcileScheduler } from './domains/shared/mirror-reconcile-scheduler.js';
import { checkStateOnlyDomainsIntegrityAllTenants } from './domains/shared/state-only-integrity.js';
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
import { createListenMonitors } from './domains/health/startup-monitors.js';
import { safeErrMessage } from './domains/shared/safe-err-message.js';
import { createStartupTenantReconcileRunner } from './domains/shared/startup-tenant-reconcile.js';
import { runStartupAgentSchemaBootstrap } from './domains/shared/startup-agent-schema.js';
import { runStartupModuleSchedulers } from './domains/shared/startup-module-schedulers.js';
import { runStartupRoleCleanup } from './domains/shared/startup-role-cleanup.js';
import { createAiQualitySchedulerHandlers } from './domains/shared/ai-quality-scheduler-handlers.js';
import { runModuleLoadSchemaEnsure } from './domains/shared/module-load-schema-ensure.js';
import { startBackgroundRuntimeMonitors } from './domains/shared/startup-background-monitors.js';
import {
  runHrmsCliSyncTableVisitIfRequested,
  runHttpListenBootstrap,
  startPostRouteModuleLoadRuntime,
} from './domains/shared/startup-listen-or-cli.js';
import {
  inferContentType,
  buildInlineContentDisposition,
} from './domains/uploads/content-type.js';
import { createObjectStorageHelpers } from './domains/uploads/object-storage.js';
import { createUploadMulters } from './domains/uploads/create-multers.js';
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
import { startProcessHealthMonitor } from './domains/health/process-health-monitor.js';
import { createHttpAccessLogger, logger } from './utils/logger.js';
import { registerFlowConfigRoutes } from './domains/flow-config/routes.js';
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
import { createFeishuBitableHelpers } from './domains/feishu-bitable/create-helpers.js';
import { createInventoryForecastHelpers } from './domains/inventory-forecast/create-helpers.js';
import { syncInventoryForecastStateToTables } from './domains/inventory-forecast/table-service.js';
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
import { setPool as setAgentPool, ensureAgentTables, registerAgentRoutes, startAgentScheduler, setTaskResponseHook, startBitablePolling, startScheduledTasks, assertCriticalFunctions, verifyLLMHealth, getAgentHealthStatus, getAgentPerformanceMetrics, getScheduledTaskStatus, clearAgentCache, runAgentEvalSuite, getSharedState as getAgentSharedState, inferBrandFromStoreName, fetchStoreRatingForProfileDisplay, registerFeishuUser, runDataAuditor, runChiefEvaluator, pushIssuesToFeishu, pushScoresToFeishu, getLarkTenantToken, routeMessage, callVisionLLM, pool as agentPool, startWeeklyReportScheduler, sendWeeklyReports, sendMonthlyReports, sendTestReportsToUser, lookupFeishuUserByUsername, sendLarkMessage, onFeishuEvent, callLLM, invalidateTenantLlmConfigCache, getBitableSubmissionStats, archiveOldBitableSubmissions } from './agents.js';
import { registerAgentDataCenterRoutes } from './domains/agent-data-center/routes.js';
import { registerAgentOpsRoutes } from './domains/agent-ops/routes.js';
import { registerAgentRecordsRoutes } from './domains/agent-records/routes.js';
import { registerAgentTriggersRoutes } from './domains/agent-triggers/routes.js';
import { registerAgentFeishuBotRoutes } from './domains/agent-feishu-bot/routes.js';
import { calculateStoreRating } from './new-scoring-model.js';
import { cronJobLabelZh } from './cron-job-label-zh.js';
import { ensureAgentConfigTables, registerAgentConfigRoutes } from "./agent-config-manager.js";
import { initBrandConfigCache, getBrandForStoreSync, getBrandConfigSync } from './utils/brand-config-loader.js';
import { initStoreAliasCache } from './utils/store-alias-cache.js';

import { setMasterPool, ensureMasterTables, startMasterAgent, registerMasterRoutes, handleTaskResponse, syncDataAuditorIssuesToMasterTasks } from './master-agent.js';
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
import { registerWorkspaceRoutes } from './domains/workspace/routes.js';
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
  ensureLeaveDomainTable as ensureLeaveDomainTableImpl,
} from './services/hrms-core-schema-ensure.js';
// P17：从 index.js 外提的遗留 listen-time ensure*（只搬家，不新增 schema）
import { ensureOpsTasksTable as ensureOpsTasksTableImpl } from './services/ops-tasks-schema-ensure.js';
import { ensureDataGovernanceTables as ensureDataGovernanceTablesImpl } from './services/data-governance-schema-ensure.js';
import { ensureCheckinTable as ensureCheckinTableImpl } from './services/checkin-schema-ensure.js';
import { ensureExamResultsTable as ensureExamResultsTableImpl } from './services/exam-results-schema-ensure.js';
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
// 结构化访问日志（pino）：依赖上方 requestId；auth 完成后 finish 带 tenant/username
app.use(createHttpAccessLogger(logger));
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
  // SAMEORIGIN 而非 DENY：下面这行 CSP 的 frame-src 'self' 已经表明允许同源自嵌(如工作台
  // iframe 内嵌 /forecast.html)，DENY 会连同源都拦掉，跟 CSP 的意图自相矛盾——防点击劫持
  // 的核心诉求(禁止跨域嵌套)用 SAMEORIGIN 一样能达到，不是放宽安全。
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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
  return ensureOpsTasksTableImpl(pool);
}

async function ensureDataGovernanceTables() {
  return ensureDataGovernanceTablesImpl(pool);
}


try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
  logger.info({ msg: 'uploads_dir_ready', uploadsDir });
} catch (e) {
  logger.error({ msg: 'uploads_dir_not_writable', err: e?.message || String(e) });
  try { fs.chmodSync(uploadsDir, 0o755); } catch (e2) {
    logger.error({ msg: 'uploads_dir_chmod_failed', err: e2?.message || String(e2) });
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

const { upload, knowledgeUpload, trainingPracticeUpload } = createUploadMulters({
  multer,
  path,
  fs,
  randomUUID,
  uploadsDir,
  ensureUploadsDir,
});

// Wave H12: recipeMediaUpload + /api/recipes/{upload-step-media,template,import} → recipe-management.js

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

// P17: hasColumn 唯一调用点(ensureExamResultsTable)已随 exam-results-schema-ensure.js
// 外提到 services/ 自行实例化，此处不再需要。

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
let _invalidateSharedStateCacheImpl = null;
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
function invalidateSharedStateCache(tenantId) {
  if (_invalidateSharedStateCacheImpl) _invalidateSharedStateCacheImpl(tenantId);
}

// Wave H31: hrms_state snapshot → domains/shared/hrms-state-snapshot.js
const { captureHrmsStateSnapshotToDb } = createHrmsStateSnapshotHelpers({ pool });

const loadTenantRuntimeStatus = (tenantId) => loadTenantRuntimeStatusFromModule(pool, tenantId);

setAgentPool(pool);
initBrandConfigCache().catch((e) => logger.error({ msg: 'init_brand_config_cache_failed', err: e?.message || String(e) }));
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
  return sendLarkMessage(FEISHU_ALERT_ADMIN_GROWTH, String(msg || ''), { skipDedup: true }).catch((e) => { logger.error({ msg: 'feishu_alert_growth_send_failed', err: e?.message || String(e) }); return { ok: false }; });
});
registerGrowthSolutionRoutes(app, authRequired);
setSolutionNotifier(async (msg) => {
  return sendLarkMessage(FEISHU_ALERT_ADMIN_GROWTH, String(msg || ''), { skipDedup: true }).catch((e) => { logger.error({ msg: 'feishu_alert_growth_send_failed', err: e?.message || String(e) }); return { ok: false }; });
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
    const r = await sendLarkMessage(FEISHU_ALERT_ADMIN_HEALTH, String(msg || ''), { skipDedup: true }).catch((e) => { logger.error({ msg: 'feishu_alert_health_send_failed', err: e?.message || String(e) }); return { ok: false }; });
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
    const r = await sendLarkMessage(FEISHU_ALERT_ADMIN_SALES, String(msg || ''), { skipDedup: true }).catch((e) => { logger.error({ msg: 'feishu_alert_sales_send_failed', err: e?.message || String(e) }); return { ok: false }; });
    return { ok: !!r?.ok, feishuSent: r?.ok ? 1 : 0, feishuFailed: r?.ok ? 0 : 1, recipients: [FEISHU_ALERT_ADMIN_SALES] };
  },
  requireSalesManagerOrAbove,
  upload,
  authRequired,
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
  return ensureCheckinTableImpl(pool);
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
  resolveTenantIdDefault,
  hrmsNowISO, // Wave H18: imported from domains/shared/time-number.js
  sendLarkMessage,
  lookupFeishuUserByUsername,
  invalidateSharedStateCache,
});

// Wave H29: payroll/leave domain dual-write → domains/payroll/domain-sync.js
// After getSharedState + notifyAdminsDualWriteFailure; ensureLeaveDomainTable → hrms-core-schema-ensure.
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
  upsertTableVisitRecordFromMapped,
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
// P20: ensureLeaveDomainTable → services/hrms-core-schema-ensure.js

async function ensureLeaveDomainTable() {
  return ensureLeaveDomainTableImpl(pool);
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
  resolveTenantIdDefault,
  invalidateSharedStateCache,
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
  invalidateSharedStateCache,
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
  return ensureExamResultsTableImpl(pool);
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
  appendNotifications,
  invalidateSharedStateCache,
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
  syncInventoryForecastStateToTables: (state) =>
    syncInventoryForecastStateToTables(pool, resolveTenantIdDefault(), state),
  ...forecastHelpers,
});

registerReportsRoutes(app, {
  pool,
  authRequired,
  getSharedState,
  mergeSharedStateFields,
  invalidateSharedStateCache,
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
  _invalidateSharedStateCacheImpl = stateStore.invalidateSharedStateCache;
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
// 权威字段 hydrate 已收口进 getSharedState()；本路由不再注入 5 个 hydrate*
registerStateRoutes(app, authRequired, {
  pool,
  getSharedState,
  resolveTenantIdDefault,
  deepRepairGarbledStrings,
  invalidateSharedStateCache,
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

// P1: 角色工作台聚合 + 批量推广菜品 → domains/workspace/
registerWorkspaceRoutes(app, authRequired, { pool, resolveTenantIdDefault, getSharedState });

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

const applicationRouteDeps = createApplicationRouteDeps({
  DATABASE_URL,
  JWT_SECRET,
  addStateNotification,
  agentPool,
  appendNotifications,
  applyHrmsUserAccountGateFromEmployee,
  applyPromotionSalaryNextMonth,
  approvalTypeLabel,
  archiveOldBitableSubmissions,
  authRequired,
  axios,
  backfillDailyAttendanceRegisterMissing,
  bcrypt,
  buildOnboardingEmployeeRecordFromPayload,
  buildOpsFeedback,
  calculateStoreRating,
  callLLM,
  callVisionLLM,
  canAccessDailyAttendanceRegister,
  checkStateOnlyDomainsIntegrityAllTenants,
  clearAgentCache,
  createFeishuBitableRecord,
  createMirrorReconcileScheduler,
  createTrainingAssignment,
  cronJobLabelZh,
  dbFindEmployeeRecord,
  decryptFeishuEncryptPayload,
  employeeAccountShouldDisable,
  ensureUploadsDir,
  express,
  fetchStoreRatingForProfileDisplay,
  fileRoutes,
  findConfigKeyByTableInfo,
  findUserSalary,
  getActiveTenantIds,
  getAgentPerformanceMetrics,
  getAgentSharedState,
  getAgentsServiceAdminToken,
  getAgentsServiceBaseUrl,
  getBitableSubmissionStats,
  getBrandsFromState,
  getCreditRisk,
  getFeishuAccessToken,
  getFeishuBitableData,
  getFeishuTokenByConfig,
  getLarkTenantToken,
  getLastCompletedWeekRangeShanghai,
  getPaymentFlowForStore,
  getPromotionRequiredTopics,
  getPromotionTrackProgress,
  getScheduledTaskStatus,
  getSharedState,
  getUserStoreAccessContext,
  hrmsNowISO,
  inferBrandFromStoreName,
  insertSalaryTimeline,
  invalidateSharedStateCache,
  isInactiveStatus,
  isKitchenByRoleOrPosition,
  isWebhookEnabled,
  leaveAttendanceHelpers,
  loadEmployeesFromTable,
  loadTenantFeishuBitableConfig,
  loadTenantRuntimeStatus,
  loginRateLimit,
  lookupFeishuUserByUsername,
  makeNotif,
  mapFeishuFieldToHrms,
  mergeSharedStateFields,
  normalizeApprovalType,
  normalizeBrandId,
  normalizeOpsRole,
  normalizePromotionTrainingPeriods,
  normalizeRoleForJwt,
  normalizeUsersTableRole,
  notifyAdminsDualWriteFailure,
  onFeishuEvent,
  pickAdminUsername,
  pickCashierUsername,
  pickHqManagerUsername,
  pickHrManagerUsername,
  pickMyStoreFromState,
  pickStoreRoleUsernameByStore,
  pool,
  pushIssuesToFeishu,
  pushScoresToFeishu,
  ragMultiQuery,
  ragQuery,
  ragStats,
  randomUUID,
  reconcileEmployeesMirrorAllTenants,
  reconcileFlowConfigMirrorAllTenants,
  recordAiFeedback,
  recordLogin,
  recordLogout,
  recordUploadOwnership,
  registerAdminOpsRoutes,
  registerAgentConfigRoutes,
  registerAgentDataCenterRoutes,
  registerAgentDataRoutes,
  registerAgentFeishuBotRoutes,
  registerAgentOpsRoutes,
  registerAgentRecordsRoutes,
  registerAgentRoutes,
  registerAgentTriggersRoutes,
  registerAiChatCompletionsRoutes,
  registerAnnouncementExtraRoutes,
  registerApprovalDecideRoutes,
  registerApprovalLifecycleRoutes,
  registerApprovalRoutes,
  registerAttentionScoresRoutes,
  registerAuthRoutes,
  registerBirthdayRoutes,
  registerBitableAdminRoutes,
  registerBitableSyncRoutes,
  registerBrandsRoutes,
  registerDedupRoutes,
  registerDiagnosisFeedbackRoutes,
  registerEmployeesDomainRoutes,
  registerExamResultsRoutes,
  registerFeishuSyncRoutes,
  registerFeishuUser,
  registerFeishuWebhookRoutes,
  registerFlowConfigRoutes,
  registerGmMailboxRoutes,
  registerHRMSApiRoutes,
  registerKitchenExecutionRoutes,
  registerMasterRoutes,
  registerMetricsAdminRoutes,
  registerNewScoringRoutes,
  registerNotificationsWriteRoutes,
  registerOpsTasksRoutes,
  registerPaymentConfigRoutes,
  registerPaymentRoutes,
  registerPayrollDomainRoutes,
  registerPerfAdminRoutes,
  registerPerformanceInvalidationRoutes,
  registerPermissionGroupsRoutes,
  registerPromotionTracksRoutes,
  registerRagRoutes,
  registerReadsRoutes,
  registerRecipeRoutes,
  registerRemainingStateRoutes,
  registerSOPDistributionRoutes,
  registerStoreDutyBindingsRoutes,
  registerStoresCrudRoutes,
  registerStoresDomainRoutes,
  registerTenantSettingsRoutes,
  registerTrainingRoutes,
  registerUploadRoutes,
  registerUploadStatusRoute,
  registerUsageWeeklyRoutes,
  registerWecomCallbackRoutes,
  requireWebhookSignature,
  resolveAttendancePayrollRules,
  resolveDutyApproverForStore,
  resolveTenantIdDefault,
  resolveWebhookTenantId,
  routeMessage,
  runAgentEvalSuite,
  runChiefEvaluator,
  runDataAuditor,
  runSalesRawFolderImportOnce,
  safeBizMonth,
  safeDateOnly,
  safeErrMessage,
  safeMonthOnly,
  safeNumber,
  safeUuid,
  saveSharedState,
  scheduleLeaveDomainSync,
  sendAdminSystemAlert,
  sendLarkMessage,
  sendWeeklyDishOptimizationReport,
  shanghaiTodayDateOnly,
  stateFindUserRecord,
  stateOrDbFindUserRecord,
  storeSessionNonce,
  syncDataAuditorIssuesToMasterTasks,
  syncDishLibraryCosts,
  syncSopSteps,
  tenantContext,
  toNullableUuid,
  trainingPracticeUpload,
  tryParseJson,
  uniqUsernames,
  updateMetricVersion,
  upload,
  uploadsDir,
  upsertFeishuGenericRecord,
  upsertPayrollLedgerEntry,
  upsertTableVisitRecordFromMapped,
  verifyFeishuWebhookRequest,
  verifyLLMHealth,
});

registerApplicationRoutes(app, applicationRouteDeps);


const runStartupTenantReconcile = createStartupTenantReconcileRunner({
  pool,
  runForActiveTenants,
  getSharedState,
  mergeSharedStateFields,
  tenantContext,
  upsertPayrollDomainFromState,
  upsertLeaveDomainFromState,
  upsertEmployeesFromStateShape,
  loadEmployeesFromTable,
  hrmsNowISO,
  toNullableUuid,
  resolveTenantIdDefault,
  backfillDailyAttendanceRegisterMissing,
  dedupeGlobalSocialMediaPointRules,
  ensureGlobalSocialMediaPointRule,
  safeErrMessage,
});

const { beatHeartbeat, startListenMonitors } = createListenMonitors({
  pool,
  runForActiveTenants,
  runWithBootstrapTenantContext,
  tenantContext,
  getSharedState,
  mergeSharedStateFields,
  invalidateSharedStateCache,
  purgeExpiredCache,
  sendAdminSystemAlert,
  upsertLeaveDomainFromState,
  upsertPayrollDomainFromState,
  getExpectedMonthlyPerformancePeriodShanghai,
  countEligibleMonthlyPerformanceUsers,
  leaveAttendanceHelpers,
  safeErrMessage,
  hrmsNowISO,
  allowSchemaChanges: __ALLOW_SCHEMA_CHANGES__,
});

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
        upsertTableVisitRecordFromMapped,
        notifyAdminsDualWriteFailure,
      }, {
        appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
        tableId: process.env.BITABLE_TABLEVISIT_TABLE_ID || 'tblpx5Efqc6eHo3L',
        appId: process.env.FEISHU_APP_ID,
        appSecret: process.env.FEISHU_APP_SECRET
      });
      logger.info({ msg: 'hrms_cli_sync_table_visit', result: r });
      process.exit(0);
    } catch (e) {
      logger.error({ msg: 'hrms_cli_sync_table_visit_failed', err: e?.message || String(e) });
      process.exit(1);
    }
  })();



} else {
app.listen(PORT, HOST, async () => {
  logger.info({ msg: 'listening', host: HOST, port: PORT });

  // Initialize multi-agent system
  try {
    // Wave M5: agent pools + listen-time schema/migrations + agent schedulers → domains/shared/startup-agent-schema.js
    await runStartupAgentSchemaBootstrap({
      pool,
      runWithBootstrapTenantContext,
      allowSchemaChanges: __ALLOW_SCHEMA_CHANGES__,
      appEnv: APP_ENV,
      env: process.env,
      ensureTenantRuntimeTables,
      ensureMasterTables,
      ensureUserSessionsTable,
      ensureBaselineSchemaHealth,
      ensurePayrollRulesTables,
      seedDefaultBrandPayrollRules,
      ensurePermissionTables,
      ensureGrowthTables,
      ensureAgentAuditLogTable,
      ensurePhaseTables,
      ensureCustomerOpsTables,
      ensureDataGovernanceTables,
      ensureAgentTables,
      ensureFeishuGenericRecordsTable,
      ensureFeishuGenericRecordsNotifyTrigger,
      ensureLeaveDomainTable,
      initStoreAliasCache,
      setMasterPool,
      setReportPool,
      setSalesRawPool,
      setDataExecutorPool,
      setTaskResponseHook,
      handleTaskResponse,
      assertCriticalFunctions,
      verifyLLMHealth,
      startAgentScheduler,
      startBitablePolling,
      startScheduledTasks,
      startMasterAgent,
    });

    // Wave M1: multi-tenant startup reconcile → domains/shared/startup-tenant-reconcile.js
    await runStartupTenantReconcile();

    // Wave M2: listen monitors → domains/health/startup-monitors.js
    await startListenMonitors();

    startRecurringRewardScheduler();

    // Wave M4: module schemas + feishu/sales/perf/snapshot schedulers → domains/shared/startup-module-schedulers.js
    await runStartupModuleSchedulers({
      ensureRAGSchema,
      ensureTaskBoardSchema,
      ensureHRMSApiSchema,
      ensureSOPDistributionSchema,
      ensureKitchenExecutionSchema,
      ensureRecipeSchema,
      ensureTrainingSchema,
      ensureGrowthSolutionsSchema,
      startTrainingReminderScheduler,
      startSolutionSweepScheduler,
      setFeishuSyncFailureNotifier,
      setSalesRawFolderImportFailureNotifier,
      notifyAdminsDualWriteFailure,
      startDailyFeishuSync,
      startWeeklyReportScheduler,
      startHrmsPerformanceJobs,
      startSalesRawFolderImporter,
      beatHeartbeat,
      runForActiveTenants,
      captureHrmsStateSnapshotToDb,
      safeErrMessage,
    });
  } catch (e) {
    logger.error({ msg: 'agents_init_failed', err: e?.message || String(e) });
  }

  // Wave M3: role cleanup → domains/shared/startup-role-cleanup.js
  await runStartupRoleCleanup({
    getSharedState,
    saveSharedState,
    runWithBootstrapTenantContext,
  });
});
}

app.use(createExpressErrorMiddleware({ multer }));

void runModuleLoadSchemaEnsure({
  allowSchemaChanges: __ALLOW_SCHEMA_CHANGES__,
  appEnv: APP_ENV,
  log: logger,
  runWithBootstrapTenantContext,
  ensureBaselineSchemaHealth,
  pool,
  ensureExamResultsTable,
  ensureHrmsStateTable,
  ensureApprovalTables,
  ensureUserReadsTable,
  ensureUserSessionsTable,
  ensureLoginLogTable,
  ensureAgentConfigTables,
  ensureCheckinTable,
  ensureOpsTasksTable,
  ensureFeishuSyncTable,
  ensureFeishuGenericRecordsTable,
  ensureFeishuGenericRecordsNotifyTrigger,
  ensureTableVisitRecordsTable,
  ensureDedupIndexes,
  startOpsTaskScheduler,
}).catch((e) =>
  logger.error({ msg: 'startup_bootstrap_schema_failed', err: e?.message || String(e) })
);

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

const aiQualityHandlers = createAiQualitySchedulerHandlers({
  callLLM,
  runPlatformQualityModelTask,
  pool,
});

startBackgroundRuntimeMonitors({
  registerProcessGuards,
  sendLarkMessage,
  FEISHU_ALERT_ADMIN_HEALTH,
  FEISHU_ALERT_ADMIN_GROWTH,
  createNotificationsCleanupScheduler,
  createFreshnessMonitorScheduler,
  pool,
  runForActiveTenants,
  runFreshnessCheck,
  FRESHNESS_SOURCES,
  startSchemaMigrationDriftMonitor,
  getSendGrowthAlert,
  startProcessHealthMonitor,
  startOntologyDailyDiagnosisScheduler,
  startHealthCenterDailyScanScheduler,
  startHealthOpsLoopScheduler,
  startAiQualityLearningScheduler,
  aiQualityHandlers,
  log: logger,
  env: process.env,
});

// 公告已读回执：员工标记自己已读/已确认某条公告。
// announcements 现在直接对每条公告挂 readBy{username: isoTime} 这个map，不另起新表——
// 用 mergeSharedStateFields 按 id 合并单条公告对象，不会跟其它员工的并发已读/其它字段写入冲突。
// Wave 4n: announcements ack/receipts + notifications write → domains

// Wave 4o: wecom callback → domains/wecom/routes-callback.js
