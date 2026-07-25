/**
 * Listen-time agent pool wiring + schema ensure + legacy migration re-apply + agent schedulers
 * (Wave M5 peel from index.js app.listen).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'shared', handler: 'startup-agent-schema' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../migrations');

/** Legacy listen-time numbered SQL re-apply list (prefer migrate.js for new envs). */
export const LISTEN_TIME_MIGRATION_SQL_NAMES = [
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
];

export function isAgentSchedulingDisabled(envVal) {
  return String(envVal || '') === 'true';
}

export async function defaultReadMigrationSql(name) {
  return readFile(join(MIGRATIONS_DIR, `${name}.sql`), 'utf8');
}

/**
 * @param {object} deps
 */
export async function runStartupAgentSchemaBootstrap(deps) {
  const {
    pool,
    runWithBootstrapTenantContext,
    allowSchemaChanges,
    appEnv,
    env = process.env,
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
    readMigrationSql = defaultReadMigrationSql,
  } = deps;


  if (allowSchemaChanges) {
    await runWithBootstrapTenantContext(async () => {
      await ensureTenantRuntimeTables();
    });
  }
  setMasterPool(pool);
  setReportPool(pool);
  setSalesRawPool(pool);
  setDataExecutorPool(pool);
  setTaskResponseHook(handleTaskResponse);
  if (allowSchemaChanges) {
    await runWithBootstrapTenantContext(async () => {
      await ensureMasterTables();
    });
  }

  await runWithBootstrapTenantContext(async () => {
    await initStoreAliasCache().catch((e) => log.warn({ msg: 'startup', detail: ['[store-alias-cache] refresh failed:', e?.message || e].map((x)=>(x==null?'':String(x))).join(' ') }));
    // 登录会话表：必须在 ALLOW_SCHEMA_CHANGES 之外也能创建，否则 INSERT 失败 + 仍签发 JWT → 全站 session 校验失败
    await ensureUserSessionsTable();
    if (!allowSchemaChanges) {
      log.warn({ msg: 'startup', detail: [`[safety] APP_ENV=${appEnv}: skip listen-time schema ensure/DDL (ALLOW_SCHEMA_CHANGES!=true); use node migrate.js`].map((x)=>(x==null?'':String(x))).join(' ') });
      return;
    }
    await ensureBaselineSchemaHealth(pool).catch(e => log.warn({ msg: 'startup', detail: ['[schema] baseline health:', e?.message || e].map((x)=>(x==null?'':String(x))).join(' ') }));
    await ensurePayrollRulesTables(pool).catch(e => log.warn({ msg: 'startup', detail: ['[payroll-rules] ensure tables:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await seedDefaultBrandPayrollRules('default', pool).catch(e => log.warn({ msg: 'startup', detail: ['[payroll-rules] seed:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await ensurePermissionTables(pool).catch(e => log.warn({ msg: 'startup', detail: ['[permissions] ensure tables:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await ensureGrowthTables(pool).catch(e => log.warn({ msg: 'startup', detail: ['[growth] ensure tables:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await ensureAgentAuditLogTable(pool).catch(e => log.warn({ msg: 'startup', detail: ['[agent-audit] ensure table:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await ensurePhaseTables(pool).catch(e => log.warn({ msg: 'startup', detail: ['[growth-phases] ensure tables:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await ensureCustomerOpsTables(pool).catch(e => log.warn({ msg: 'startup', detail: ['[customer-ops] ensure tables:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    // Runtime migration: 企微会员新增字段（避免旧库缺字段导致评分数据源为空）
    await pool.query(`ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS new_wechat_members INTEGER DEFAULT 0`);
    // Runtime migration: 知识库文件版本号
    await pool.query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS version VARCHAR(50) DEFAULT NULL`);
    // 知识库分发范围（门店/岗位/全员），JSON：{ type, store?, position? }
    await pool.query(
      `ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS audience JSONB DEFAULT '{"type":"all"}'::jsonb`
    ).catch((e) => log.warn({ msg: 'startup', detail: ['[migration] knowledge_base.audience:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    // 知识库项目组名称：独立于文件标题，避免“组名=第一份文件名”
    await pool.query(
      `ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS group_name VARCHAR(120) DEFAULT NULL`
    ).catch((e) => log.warn({ msg: 'startup', detail: ['[migration] knowledge_base.group_name:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await pool.query(
      `UPDATE knowledge_base
       SET group_name = COALESCE(NULLIF(group_name, ''), title)
       WHERE COALESCE(group_name, '') = ''`
    ).catch((e) => log.warn({ msg: 'startup', detail: ['[migration] knowledge_base.group_name.backfill:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
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
    `).catch(e => log.warn({ msg: 'startup', detail: ['[migration] files table:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
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
    `).catch(e => log.warn({ msg: 'startup', detail: ['[migration] file_access_logs table:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
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
    `).catch(e => log.warn({ msg: 'startup', detail: ['[migration] hrms_user_notifications table:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
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
    `).catch(e => log.warn({ msg: 'startup', detail: ['[migration] hrms_state_snapshots table:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_hrms_state_snapshots_key_created ON hrms_state_snapshots (state_key, created_at DESC)`
    ).catch(() => {});
    // Runtime migration: dedup unique index on agent_messages(record_id, content_type)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_record_content_uniq ON agent_messages (record_id, content_type) WHERE record_id IS NOT NULL AND record_id != ''`).catch(e => log.warn({ msg: 'startup', detail: ['[migration] dedup index:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
    assertCriticalFunctions();
    await ensureFeishuGenericRecordsTable();
    await ensureFeishuGenericRecordsNotifyTrigger();
  });
  // LLM健康检查 — 启动时验证所有大模型API可用，失败时飞书通知管理员
  verifyLLMHealth().then(h => {
    if (!h.allOk) log.error({ msg: 'startup', detail: ['[STARTUP] ⚠️ LLM health check FAILED — agents may be brainless!'].map((x)=>(x==null?'':String(x))).join(' ') });
    else log.info({ msg: 'startup', detail: ['[STARTUP] ✅ All LLM providers healthy'].map((x)=>(x==null?'':String(x))).join(' ') });
  }).catch(e => log.error({ msg: 'startup', detail: ['[STARTUP] LLM health check error:', e?.message].map((x)=>(x==null?'':String(x))).join(' ') }));
  if (isAgentSchedulingDisabled(env.DISABLE_AGENT_SCHEDULING)) {
    log.info({ msg: 'startup', detail: ['[agents] ⚠️ DISABLE_AGENT_SCHEDULING=true — agent scheduling delegated to V2'].map((x)=>(x==null?'':String(x))).join(' ') });
  } else {
    startAgentScheduler();
    log.info({ msg: 'startup', detail: ['[agents] Multi-agent system initialized'].map((x)=>(x==null?'':String(x))).join(' ') });
    startBitablePolling();
    startScheduledTasks();
    log.info({ msg: 'startup', detail: ['[agents] Bitable polling started, scheduled tasks started'].map((x)=>(x==null?'':String(x))).join(' ') });
    startMasterAgent();
    log.info({ msg: 'startup', detail: ['[master] Master Agent orchestration initialized'].map((x)=>(x==null?'':String(x))).join(' ') });
  }

  // Initialize Master Agent pools (needed for webhook handler even when scheduling disabled)
  // Schema DDL / numbered SQL re-runs: only when ALLOW_SCHEMA_CHANGES (prefer `node migrate.js` + schema_migrations)
  await runWithBootstrapTenantContext(async () => {
    if (allowSchemaChanges) {
      await ensureMasterTables();

      // Legacy listen-time re-apply of numbered migrations (idempotent). New envs should use migrate.js instead.
      for (const name of LISTEN_TIME_MIGRATION_SQL_NAMES) {
        try {
          const mig = await readMigrationSql(name);
          await pool.query(mig);
          log.info({ msg: 'startup', detail: [`[migration] ${name} applied (listen-time, ALLOW_SCHEMA_CHANGES)`].map((x)=>(x==null?'':String(x))).join(' ') });
        } catch (e) {
          log.error({ msg: 'startup', detail: [`[migration] ${name} error (non-fatal):`, e?.message].map((x)=>(x==null?'':String(x))).join(' ') });
        }
      }

      try {
        await ensureLeaveDomainTable();
        log.info({ msg: 'startup', detail: ['[startup] hrms_leave_domain table ready'].map((x)=>(x==null?'':String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] hrms_leave_domain table init failed (non-fatal):', e?.message].map((x)=>(x==null?'':String(x))).join(' ') });
      }
    }

  });

}
