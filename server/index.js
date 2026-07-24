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
import { registerReadsRoutes } from './domains/reads/routes.js';
import { registerAttentionScoresRoutes } from './domains/attention-scores/routes.js';
import { registerAnnouncementExtraRoutes } from './domains/remaining-state/routes-announcement-extra.js';
import { registerNotificationsWriteRoutes } from './domains/notifications/routes.js';
import { registerBirthdayRoutes } from './domains/birthday/routes.js';
import { createBirthdayScheduler } from './domains/birthday/scheduler.js';
import { createRecurringRewardScheduler } from './domains/approvals/scheduler-recurring-reward.js';
import { createPromotionRecipientsHelpers } from './domains/approvals/promotion-recipients.js';
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
import { createFeishuBitableHelpers } from './domains/feishu-bitable/create-helpers.js';
import { createInventoryForecastHelpers } from './domains/inventory-forecast/create-helpers.js';
import { createLeaveAttendanceHelpers } from './domains/leave-attendance/create-helpers.js';
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
  return String(e?.message || e || 'internal_error');
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

// Wave 4p: dedup → domains/dedup/routes.js

// Wave H12: GET /api/me → auth-routes.js (distinct from /api/auth/me)

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

// Wave 4l: employee attachments → domains/employees/routes-attachments.js

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
  hrmsNowISO, // function declaration later in file — hoisted OK
  sendLarkMessage,
  lookupFeishuUserByUsername,
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

function normalizeApprovalType(input) {
  const t = String(input || '').trim().toLowerCase();
  const allowed = ['onboarding', 'offboarding', 'leave', 'payment', 'reward_punishment', 'promotion', 'points', 'monthly_confirm'];
  if (!allowed.includes(t)) return '';
  return t;
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


// Wave H12: normalizeOpenAiCompatibleBaseUrl → domains/ai/routes-chat-completions.js

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

// Wave 4j: /api/ops/tasks* → domains/ops-tasks/routes.js

// Wave 4q: admin reconcile/leave-close → domains/admin-ops/routes.js

// Wave 4p: metrics admin → domains/metrics-admin/routes.js

// Wave 4q: diagnosis feedback/stats → domains/diagnosis/routes.js

// Wave 4q: sales-raw folder import → domains/admin-ops/routes.js

function normalizeStoreKey(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

function safeDateOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

// Wave H5: ops-tasks helpers + scheduler (must run after safeDateOnly; ensureOpsTasksTable / pickStoreRoleUsernameByStore hoisted)
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

// Wave H2b: inventory-forecast helpers factory (must run after brand/store utils + safeDateOnly/safeNumber/inDateRange/pickMyStoreFromState)
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


function safeMonthOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}$/.test(v)) return null;
  return v;
}


// Wave H3: leave/attendance calc helpers（须在 safeMonthOnly / clampNum / hrmsNowISO / getSharedState 等之后）
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
  return leaveAttendanceHelpers.shanghaiDateOnly(new Date());
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

// Wave 4q: employee-password → domains/admin-ops/routes.js

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

// Wave 4o: promotion tracks + bitable-sync → domains/promotion, domains/bitable-sync

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

// Wave 4o: chairman/tenant-settings → domains/tenant-settings/routes.js

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

// Wave 4o: exam-results → domains/exam-results/routes.js

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

// Wave H8: offboarding auto-disable + promotion sweep → domains/approvals/scheduler-offboarding-promotion.js
// Factory after applyHrmsUserAccountGateFromEmployee / notifications / getPromotionTrackRecipients; module-load start (before birthday H6).
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
