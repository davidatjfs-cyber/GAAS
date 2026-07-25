/**
 * Listen-time module schema ensure + feishu/sales/performance/snapshot schedulers
 * (Wave M4 peel from index.js app.listen, after monitors / before role cleanup).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'shared', handler: 'startup-module-schedulers' });

/** Clamp snapshot interval minutes to [5, 1440]. */
export function resolveHrmsStateSnapshotIntervalMin(raw) {
  return Math.max(5, Math.min(24 * 60, Number(raw || 15)));
}

export function isHrmsStateSnapshotDisabled(envVal) {
  return String(envVal || '').toLowerCase() === 'true';
}

/** Label for sales_raw folder import failure notifier. */
export function formatSalesRawImportFailureLabel(ctx) {
  const where = ctx?.tick ? '定时扫描' : ctx?.startup ? '启动后首次扫描' : '目录入库';
  const dirHint = ctx?.dir ? `·${String(ctx.dir).slice(0, 120)}` : '';
  return `sales_raw（${where}${dirHint}）`;
}

/**
 * @param {object} deps
 */
export async function runStartupModuleSchedulers(deps) {
  const {
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
    env = process.env,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
    importAutonomous = () => import('../../agent-autonomous.js'),
    importRegression = () => import('../../regression-protection.js'),
    importLlmConfig = () => import('../../llm-config-enhanced.js'),
  } = deps;

  try {
    const { initializeAutonomousTasks } = await importAutonomous();
    initializeAutonomousTasks();
    log.info({ msg: 'startup', detail: '[autonomous] Agent autonomous capabilities initialized' });
  } catch (e) {
    log.error({
      msg: 'startup',
      detail: ['[autonomous] Failed to initialize:', e?.message]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
  }

  try {
    const { initializeRegressionProtection } = await importRegression();
    await initializeRegressionProtection();
    log.info({ msg: 'startup', detail: '[regression] Regression protection initialized' });
  } catch (e) {
    log.error({
      msg: 'startup',
      detail: ['[regression] Failed to initialize:', e?.message]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
  }

  try {
    const { initializeEnhancedLLMConfig } = await importLlmConfig();
    initializeEnhancedLLMConfig();
    log.info({ msg: 'startup', detail: '[llm] Enhanced LLM configuration initialized' });
  } catch (e) {
    log.error({
      msg: 'startup',
      detail: ['[llm] Failed to initialize:', e?.message]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
  }

  await ensureRAGSchema();
  await ensureTaskBoardSchema();
  await ensureHRMSApiSchema();
  await ensureSOPDistributionSchema();
  await ensureKitchenExecutionSchema();
  await ensureRecipeSchema();
  await ensureTrainingSchema();
  log.info({
    msg: 'startup',
    detail:
      '[modules] RAG + TaskBoard + HRMS-API + SOP-Distribution + KitchenExec + Recipe + Training initialized',
  });
  startTrainingReminderScheduler();
  await ensureGrowthSolutionsSchema();
  startSolutionSweepScheduler();
  log.info({ msg: 'startup', detail: '[modules] GrowthSolutions initialized' });

  setFeishuSyncFailureNotifier((label, err) => {
    void notifyAdminsDualWriteFailure(`飞书表格→PG（${label}）`, err);
  });
  setSalesRawFolderImportFailureNotifier((err, ctx) => {
    void notifyAdminsDualWriteFailure(formatSalesRawImportFailureLabel(ctx), err);
  });

  startDailyFeishuSync();
  log.info({ msg: 'startup', detail: '[feishu] Daily sync scheduler started' });

  startWeeklyReportScheduler();

  startHrmsPerformanceJobs({
    onHeartbeat: beatHeartbeat,
  });
  startSalesRawFolderImporter();

  const snapIntervalMin = resolveHrmsStateSnapshotIntervalMin(env.HRMS_STATE_SNAPSHOT_INTERVAL_MINUTES);
  const runHrmsStateSnapshot = () =>
    runForActiveTenants(
      (tenantId) => captureHrmsStateSnapshotToDb({ source: 'scheduled', stateKey: tenantId }),
      {
        continueOnError: true,
        onError: ({ tenantId, error }) => {
          log.error({
            msg: 'startup',
            detail: ['[hrms_state_snapshot] tick:', tenantId, safeErrMessage(error)]
              .map((x) => (x == null ? '' : String(x)))
              .join(' '),
          });
          void notifyAdminsDualWriteFailure(
            `hrms_state 定时快照（hrms_state_snapshots）租户=${tenantId}`,
            error
          );
        },
      }
    ).catch((e) => {
      log.error({
        msg: 'startup',
        detail: ['[hrms_state_snapshot] tick:', e?.message || e]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      });
      void notifyAdminsDualWriteFailure('hrms_state 定时快照（hrms_state_snapshots）', e);
    });

  if (!isHrmsStateSnapshotDisabled(env.HRMS_STATE_SNAPSHOT_DISABLED)) {
    setTimeoutFn(() => {
      runHrmsStateSnapshot();
    }, 120_000);
    setIntervalFn(() => {
      runHrmsStateSnapshot();
    }, snapIntervalMin * 60 * 1000);
    log.info({
      msg: 'startup',
      detail: [
        '[hrms_state_snapshot] scheduler on, interval_min=',
        snapIntervalMin,
        'retain_days=',
        env.HRMS_STATE_SNAPSHOT_RETAIN_DAYS || 30,
        'max_rows=',
        env.HRMS_STATE_SNAPSHOT_MAX_ROWS || 400,
      ]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
  } else {
    log.info({
      msg: 'startup',
      detail: '[hrms_state_snapshot] disabled (HRMS_STATE_SNAPSHOT_DISABLED=true)',
    });
  }

  return { snapIntervalMin, runHrmsStateSnapshot };
}
