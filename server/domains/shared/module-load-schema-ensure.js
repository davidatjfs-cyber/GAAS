/**
 * Module-load schema ensure cascade + ops-task scheduler start
 * (P18 peel from index.js after app.listen registration).
 */
export async function runModuleLoadSchemaEnsure(deps) {
  const {
    allowSchemaChanges,
    appEnv,
    log,
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
  } = deps;

  if (!allowSchemaChanges) {
    log.warn({ msg: 'skip_auto_schema_ensure', appEnv });
    return { skipped: true };
  }

  await runWithBootstrapTenantContext(async () => {
    await ensureBaselineSchemaHealth(pool).catch((e) =>
      log.warn({ msg: 'schema_baseline_health', err: e?.message || String(e) })
    );
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
  });
  startOpsTaskScheduler();
  return { skipped: false };
}
