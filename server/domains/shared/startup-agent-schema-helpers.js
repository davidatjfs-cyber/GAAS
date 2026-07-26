/**
 * P5.4 peel: startup agent pool wiring + listen-time schema ensure (from runStartupAgentSchemaBootstrap).
 * No new DDL — only hoists existing listen-time ensure blocks.
 */

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

export function wireAgentPoolsOnStartup(deps) {
  const {
    pool,
    setMasterPool,
    setReportPool,
    setSalesRawPool,
    setDataExecutorPool,
    setTaskResponseHook,
    handleTaskResponse,
  } = deps;
  setMasterPool(pool);
  setReportPool(pool);
  setSalesRawPool(pool);
  setDataExecutorPool(pool);
  setTaskResponseHook(handleTaskResponse);
}

export async function runDomainEnsureTables(deps, log) {
  const {
    pool,
    ensureBaselineSchemaHealth,
    ensurePayrollRulesTables,
    seedDefaultBrandPayrollRules,
    ensurePermissionTables,
    ensureGrowthTables,
    ensureAgentAuditLogTable,
    ensurePhaseTables,
    ensureCustomerOpsTables,
  } = deps;
  await ensureBaselineSchemaHealth(pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[schema] baseline health:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
  await ensurePayrollRulesTables(pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[payroll-rules] ensure tables:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
  await seedDefaultBrandPayrollRules('default', pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[payroll-rules] seed:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
  await ensurePermissionTables(pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[permissions] ensure tables:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
  await ensureGrowthTables(pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[growth] ensure tables:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
  await ensureAgentAuditLogTable(pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[agent-audit] ensure table:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
  await ensurePhaseTables(pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[growth-phases] ensure tables:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
  await ensureCustomerOpsTables(pool).catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[customer-ops] ensure tables:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
    })
  );
}

export async function runInlineListenTimeMigrations(deps, log) {
  const { pool, ensureDataGovernanceTables, ensureAgentTables, assertCriticalFunctions } = deps;
  await pool.query(`ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS new_wechat_members INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS version VARCHAR(50) DEFAULT NULL`);
  await pool
    .query(
      `ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS audience JSONB DEFAULT '{"type":"all"}'::jsonb`
    )
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] knowledge_base.audience:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      })
    );
  await pool
    .query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS group_name VARCHAR(120) DEFAULT NULL`)
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] knowledge_base.group_name:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      })
    );
  await pool
    .query(
      `UPDATE knowledge_base
       SET group_name = COALESCE(NULLIF(group_name, ''), title)
       WHERE COALESCE(group_name, '') = ''`
    )
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] knowledge_base.group_name.backfill:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      })
    );
  await pool
    .query(
      `
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
    `
    )
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] files table:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
      })
    );
  await pool
    .query(
      `
    CREATE TABLE IF NOT EXISTS file_access_logs (
      id SERIAL PRIMARY KEY,
      file_id VARCHAR(50) NOT NULL,
      action VARCHAR(20) NOT NULL,
      username VARCHAR(50),
      ip VARCHAR(50),
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    `
    )
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] file_access_logs table:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      })
    );
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_type ON files(file_type)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_store ON files(store)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at)`).catch(() => {});
  await pool
    .query(`CREATE INDEX IF NOT EXISTS idx_file_access_logs_file_id ON file_access_logs(file_id)`)
    .catch(() => {});
  await pool
    .query(`CREATE INDEX IF NOT EXISTS idx_file_access_logs_created_at ON file_access_logs(created_at DESC)`)
    .catch(() => {});
  await ensureDataGovernanceTables();
  await ensureAgentTables();
  await pool
    .query(
      `
    CREATE TABLE IF NOT EXISTS hrms_user_notifications (
      id BIGSERIAL PRIMARY KEY,
      target_username TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'performance_deduction',
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
    `
    )
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] hrms_user_notifications table:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      })
    );
  await pool
    .query(
      `CREATE INDEX IF NOT EXISTS idx_hrms_notif_user_created ON hrms_user_notifications (target_username, created_at DESC)`
    )
    .catch(() => {});
  await pool
    .query(`CREATE INDEX IF NOT EXISTS idx_hrms_notif_task_id ON hrms_user_notifications ((meta->>'task_id'))`)
    .catch(() => {});
  await pool
    .query(
      `
    CREATE TABLE IF NOT EXISTS hrms_state_snapshots (
      id BIGSERIAL PRIMARY KEY,
      state_key TEXT NOT NULL DEFAULT 'default',
      data JSONB NOT NULL,
      byte_size INTEGER,
      source TEXT NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
    `
    )
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] hrms_state_snapshots table:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      })
    );
  await pool
    .query(
      `CREATE INDEX IF NOT EXISTS idx_hrms_state_snapshots_key_created ON hrms_state_snapshots (state_key, created_at DESC)`
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_record_content_uniq ON agent_messages (record_id, content_type) WHERE record_id IS NOT NULL AND record_id != ''`
    )
    .catch((e) =>
      log.warn({
        msg: 'startup',
        detail: ['[migration] dedup index:', e?.message].map((x) => (x == null ? '' : String(x))).join(' '),
      })
    );
  assertCriticalFunctions();
}

export async function runListenTimeSchemaEnsure(deps, log) {
  const {
    allowSchemaChanges,
    appEnv,
    initStoreAliasCache,
    ensureUserSessionsTable,
    ensureFeishuGenericRecordsTable,
    ensureFeishuGenericRecordsNotifyTrigger,
  } = deps;

  await initStoreAliasCache().catch((e) =>
    log.warn({
      msg: 'startup',
      detail: ['[store-alias-cache] refresh failed:', e?.message || e]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    })
  );
  await ensureUserSessionsTable();
  if (!allowSchemaChanges) {
    log.warn({
      msg: 'startup',
      detail: [
        `[safety] APP_ENV=${appEnv}: skip listen-time schema ensure/DDL (ALLOW_SCHEMA_CHANGES!=true); use node migrate.js`,
      ]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
    return;
  }
  await runDomainEnsureTables(deps, log);
  await runInlineListenTimeMigrations(deps, log);
  await ensureFeishuGenericRecordsTable();
  await ensureFeishuGenericRecordsNotifyTrigger();
}

export function scheduleLlmHealthCheck(verifyLLMHealth, log) {
  verifyLLMHealth()
    .then((h) => {
      if (!h.allOk) {
        log.error({
          msg: 'startup',
          detail: ['[STARTUP] ⚠️ LLM health check FAILED — agents may be brainless!']
            .map((x) => (x == null ? '' : String(x)))
            .join(' '),
        });
      } else {
        log.info({
          msg: 'startup',
          detail: ['[STARTUP] ✅ All LLM providers healthy'].map((x) => (x == null ? '' : String(x))).join(' '),
        });
      }
    })
    .catch((e) =>
      log.error({
        msg: 'startup',
        detail: ['[STARTUP] LLM health check error:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      })
    );
}

export function startAgentSubsystemsIfEnabled(deps, env, log) {
  const {
    startAgentScheduler,
    startBitablePolling,
    startScheduledTasks,
    startMasterAgent,
  } = deps;
  if (isAgentSchedulingDisabled(env.DISABLE_AGENT_SCHEDULING)) {
    log.info({
      msg: 'startup',
      detail: ['[agents] ⚠️ DISABLE_AGENT_SCHEDULING=true — agent scheduling delegated to V2']
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
    return;
  }
  startAgentScheduler();
  log.info({
    msg: 'startup',
    detail: ['[agents] Multi-agent system initialized'].map((x) => (x == null ? '' : String(x))).join(' '),
  });
  startBitablePolling();
  startScheduledTasks();
  log.info({
    msg: 'startup',
    detail: ['[agents] Bitable polling started, scheduled tasks started']
      .map((x) => (x == null ? '' : String(x)))
      .join(' '),
  });
  startMasterAgent();
  log.info({
    msg: 'startup',
    detail: ['[master] Master Agent orchestration initialized']
      .map((x) => (x == null ? '' : String(x)))
      .join(' '),
  });
}

export async function runLegacyListenTimeMigrations(deps, log) {
  const { pool, allowSchemaChanges, ensureMasterTables, ensureLeaveDomainTable, readMigrationSql } = deps;
  if (!allowSchemaChanges) return;
  await ensureMasterTables();
  for (const name of LISTEN_TIME_MIGRATION_SQL_NAMES) {
    try {
      const mig = await readMigrationSql(name);
      await pool.query(mig);
      log.info({
        msg: 'startup',
        detail: [`[migration] ${name} applied (listen-time, ALLOW_SCHEMA_CHANGES)`]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      });
    } catch (e) {
      log.error({
        msg: 'startup',
        detail: [`[migration] ${name} error (non-fatal):`, e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      });
    }
  }
  try {
    await ensureLeaveDomainTable();
    log.info({
      msg: 'startup',
      detail: ['[startup] hrms_leave_domain table ready'].map((x) => (x == null ? '' : String(x))).join(' '),
    });
  } catch (e) {
    log.error({
      msg: 'startup',
      detail: ['[startup] hrms_leave_domain table init failed (non-fatal):', e?.message]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
  }
}
