/**
 * CLI sync-table-visit vs HTTP listen bootstrap (P19 peel from index.js).
 */

/**
 * @param {object} deps
 * @returns {Promise<boolean>} true if CLI path was taken (caller must not listen)
 */
export async function runHrmsCliSyncTableVisitIfRequested(deps) {
  const {
    env = process.env,
    log,
    ensureFeishuGenericRecordsTable,
    ensureFeishuGenericRecordsNotifyTrigger,
    ensureTableVisitRecordsTable,
    runManualFeishuBitableSync,
    syncDeps,
    syncOptions,
    exitFn = (code) => process.exit(code),
  } = deps;

  if (String(env.HRMS_CLI_SYNC_TABLE_VISIT || '').trim() !== '1') {
    return false;
  }

  try {
    await ensureFeishuGenericRecordsTable();
    await ensureFeishuGenericRecordsNotifyTrigger();
    await ensureTableVisitRecordsTable();
    const r = await runManualFeishuBitableSync(syncDeps, syncOptions);
    log.info({ msg: 'hrms_cli_sync_table_visit', result: r });
    exitFn(0);
  } catch (e) {
    log.error({ msg: 'hrms_cli_sync_table_visit_failed', err: e?.message || String(e) });
    exitFn(1);
  }
  return true;
}

/**
 * Body of app.listen callback after PORT bind.
 * @param {object} deps
 */
export async function runHttpListenBootstrap(deps) {
  const {
    log,
    runStartupAgentSchemaBootstrap,
    agentSchemaDeps,
    runStartupTenantReconcile,
    startListenMonitors,
    startRecurringRewardScheduler,
    runStartupModuleSchedulers,
    moduleSchedulerDeps,
    runStartupRoleCleanup,
    roleCleanupDeps,
  } = deps;

  log.info({ msg: 'listening', host: deps.host, port: deps.port });

  try {
    await runStartupAgentSchemaBootstrap(agentSchemaDeps);
    await runStartupTenantReconcile();
    await startListenMonitors();
    startRecurringRewardScheduler();
    await runStartupModuleSchedulers(moduleSchedulerDeps);
  } catch (e) {
    log.error({ msg: 'agents_init_failed', err: e?.message || String(e) });
  }

  await runStartupRoleCleanup(roleCleanupDeps);
}

/**
 * Module-load side effects after routes: schema ensure, offboarding/birthday, monitors.
 * @param {object} deps
 */
export function startPostRouteModuleLoadRuntime(deps) {
  const {
    runModuleLoadSchemaEnsure,
    moduleLoadSchemaDeps,
    log,
    createOffboardingPromotionScheduler,
    offboardingDeps,
    createBirthdayScheduler,
    birthdayDeps,
    createAiQualitySchedulerHandlers,
    aiQualityHandlerDeps,
    startBackgroundRuntimeMonitors,
    backgroundMonitorDeps,
  } = deps;

  void runModuleLoadSchemaEnsure(moduleLoadSchemaDeps).catch((e) =>
    log.error({ msg: 'startup_bootstrap_schema_failed', err: e?.message || String(e) })
  );

  const { startOffboardingPromotionScheduler } = createOffboardingPromotionScheduler(offboardingDeps);
  startOffboardingPromotionScheduler();

  const { startBirthdayGreetingScheduler } = createBirthdayScheduler(birthdayDeps);
  startBirthdayGreetingScheduler();

  const aiQualityHandlers = createAiQualitySchedulerHandlers(aiQualityHandlerDeps);
  startBackgroundRuntimeMonitors({
    ...backgroundMonitorDeps,
    aiQualityHandlers,
  });
}
