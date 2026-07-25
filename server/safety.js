import { URL } from 'url';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'safety', handler: 'safety' });


export function getAppEnv() {
  const v = String(process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
  if (v === 'prod') return 'production';
  if (v === 'stage') return 'staging';
  if (v === 'dev') return 'development';
  return v;
}

function parseDbHostFromDatabaseUrl(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    const u = new URL(databaseUrl);
    return (u.hostname || '').trim() || null;
  } catch {
    return null;
  }
}

function isLocalHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * HRMS 内置「多 Agent + Master + 飞书 Bot 大脑」V1 总开关（与 agents-service-v2 解耦）。
 * - 未设置或不为 `true`：**默认关闭** V1 路由、飞书非多维表事件的 Bot 处理、V1 调度器/轮询/Master/BI 定时周报月报等。
 * - `HRMS_AGENT_V1_ENABLED=true`：恢复 V1（仍受 `DISABLE_AGENT_SCHEDULING` 等变量约束）。
 * 说明：`agents.js` 仍会被加载（agent-config-manager 等依赖其中的 pool），仅关闭运行时行为以保稳定；彻底删文件需后续把 pool 抽到独立模块。
 */
export function isHrmsAgentV1Enabled() {
  return String(process.env.HRMS_AGENT_V1_ENABLED || '').trim().toLowerCase() === 'true';
}

const WEAK_JWT_SECRETS = new Set(['', 'dev', 'local_dev_secret', 'secret', 'jwt_secret', 'changeme']);

export function isWeakJwtSecret(secret) {
  const s = String(secret || '').trim();
  if (!s) return true;
  if (WEAK_JWT_SECRETS.has(s.toLowerCase())) return true;
  if (s.length < 16) return true;
  return false;
}

/** 飞书 webhook 是否强制签名/Verification Token（默认关，DEMO/生产可开） */
export function requireWebhookSignature() {
  const v = String(process.env.REQUIRE_WEBHOOK_SIGNATURE || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function enforceRuntimeSafetyOrExit({ serviceName }) {
  const appEnv = getAppEnv();
  const dbHost = process.env.DB_HOST || parseDbHostFromDatabaseUrl(process.env.DATABASE_URL) || '';
  const redisHost = process.env.REDIS_HOST || '';

  // 1) 防误连生产：development 必须只连本机
  if (appEnv === 'development') {
    if (dbHost && !isLocalHost(dbHost)) {
      log.error({
        msg: 'safety_refuse_start_non_local_db',
        service: serviceName,
        db_host: dbHost,
      });
      process.exit(2);
    }
    if (redisHost && !isLocalHost(redisHost)) {
      log.error({
        msg: 'safety_refuse_start_non_local_redis',
        service: serviceName,
        redis_host: redisHost,
      });
      process.exit(2);
    }
  }

  // 2) 防误上线：production 必须显式确认才允许运行（避免把本地直接指到生产）
  if (appEnv === 'production') {
    if (process.env.CONFIRM_PRODUCTION !== 'true') {
      log.error({
        msg: 'safety_refuse_start_production_unconfirmed',
        service: serviceName,
      });
      process.exit(2);
    }
  }

  // 3) 禁止弱 JWT（production/staging 强制；development 仅警告）
  const jwtSecret = process.env.JWT_SECRET;
  if (isWeakJwtSecret(jwtSecret)) {
    if (appEnv === 'production' || appEnv === 'staging') {
      log.error({
        msg: 'safety_refuse_start_weak_jwt_secret',
        service: serviceName,
      });
      process.exit(2);
    }
    log.warn({ msg: 'safety_weak_jwt_secret_local_ok', service: serviceName });
  }
}

export function configureDbSessionSafety(pool, { serviceName }) {
  const enableDbWrite = process.env.ENABLE_DB_WRITE === 'true';
  const appEnv = getAppEnv();

  pool.on('connect', async (client) => {
    try {
      // 防误操作：默认全局只读（DDL/DML都会被阻止）
      if (!enableDbWrite) {
        await client.query('SET default_transaction_read_only = on');
        log.warn({
          msg: 'safety_db_read_only',
          service: serviceName,
          app_env: appEnv,
        });
      }
    } catch (e) {
      log.error({
        msg: 'safety_failed_to_set_db_mode',
        service: serviceName,
        err: e?.message || String(e),
      });
      // 安全起见：无法确保只读时，直接拒绝启动
      if (!enableDbWrite) process.exit(2);
    }
  });
}

/**
 * listen-time DDL / ensure*Table 是否允许跑。
 * B5 冻结：新 schema 只走 numbered migrations + migrate.js；
 * ensure* 不得再新增 CREATE/ALTER。本开关仅控制存量遗留 ensure 是否执行。
 */
export function isSchemaChangeAllowed() {
  const appEnv = getAppEnv();
  // 默认：staging/production 禁止自动建表/补列/运行时 migration
  if (appEnv === 'production' || appEnv === 'staging') {
    return process.env.ALLOW_SCHEMA_CHANGES === 'true';
  }
  // development 允许，但也可以显式关闭
  return process.env.ALLOW_SCHEMA_CHANGES !== 'false';
}

export function isExternalEnabled() {
  const appEnv = getAppEnv();
  // 所有环境默认关闭外部调用，必须显式开启
  if (appEnv === 'production' || appEnv === 'staging') return process.env.ENABLE_EXTERNAL === 'true';
  return process.env.ENABLE_EXTERNAL === 'true';
}

/** 仅允许显式标记的离线平台质量任务调用专用模型，不放开租户业务对话。 */
export function isAiQualityExternalEnabled() {
  return String(process.env.ENABLE_AI_QUALITY_EXTERNAL || '').trim().toLowerCase() === 'true';
}

export function isWebhookEnabled() {
  const appEnv = getAppEnv();
  // 默认关闭 webhook，必须显式开启
  if (appEnv === 'production' || appEnv === 'staging') return process.env.ENABLE_WEBHOOK === 'true';
  return process.env.ENABLE_WEBHOOK === 'true';
}

/** single = 自用 HRMS（默认）；multi = DEMO/托管多租户 */
export function getTenantMode() {
  const v = String(process.env.TENANT_MODE || '').trim().toLowerCase();
  if (v === 'multi' || v === 'saas' || v === 'hosted') return 'multi';
  return 'single';
}

export function isMultiTenantMode() {
  return getTenantMode() === 'multi';
}

/**
 * 是否强制 license 才能登录。
 * - LICENSE_ENFORCE=true 显式开
 * - multi 模式下默认开（可用 LICENSE_ENFORCE=false 关）
 * - single 默认关，保证 default 租户现网零感知
 */
export function isLicenseEnforced() {
  const v = String(process.env.LICENSE_ENFORCE || '').trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return isMultiTenantMode();
}

/** 逗号分隔的租户 ID，强制 license 时仍豁免（默认含 default） */
export function getLicenseEnforceExemptTenants() {
  const raw = String(process.env.LICENSE_ENFORCE_EXEMPT_TENANTS || 'default').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

export function isLicenseExemptTenant(tenantId) {
  return getLicenseEnforceExemptTenants().has(String(tenantId || '').trim());
}

/**
 * 是否允许回落马己仙/洪潮 legacy 飞书默认配置。
 * - ALLOW_LEGACY_FEISHU_FALLBACK 显式控制
 * - single 默认 true；multi 默认 false
 */
export function allowLegacyFeishuFallback() {
  const v = String(process.env.ALLOW_LEGACY_FEISHU_FALLBACK || '').trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return !isMultiTenantMode();
}
