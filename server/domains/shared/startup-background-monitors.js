/**
 * Background runtime monitors started at module load (P18 peel from index.js).
 */
export function startBackgroundRuntimeMonitors(deps) {
  const {
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
    log,
    env,
  } = deps;

  registerProcessGuards({ sendLarkMessage, FEISHU_ALERT_ADMIN_HEALTH });

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

  startSchemaMigrationDriftMonitor(pool, {
    notifyFn: async (msg) => {
      const send = getSendGrowthAlert();
      if (send) return send(msg, 'schema_migration_drift');
      return sendLarkMessage(FEISHU_ALERT_ADMIN_GROWTH, String(msg || ''), { skipDedup: true });
    },
  });

  startProcessHealthMonitor({
    processName: 'hrms-service',
    maxMemoryRestartBytes: Number(env.PM2_MAX_MEMORY_RESTART_BYTES || 800 * 1024 * 1024),
    notifyFn: async (msg) => {
      return sendLarkMessage(FEISHU_ALERT_ADMIN_HEALTH, String(msg || ''), { skipDedup: true });
    },
  });

  startOntologyDailyDiagnosisScheduler(pool);
  startHealthCenterDailyScanScheduler(pool);
  startHealthOpsLoopScheduler(pool);

  if (!String(env.AI_QUALITY_LLM_API_KEY || '').trim()) {
    log.error({ msg: 'ai_quality_llm_api_key_missing' });
  }
  startAiQualityLearningScheduler(pool, aiQualityHandlers);
}
