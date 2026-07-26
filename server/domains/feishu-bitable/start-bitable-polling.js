/**
 * Bitable PG LISTEN + catchup + archive scheduler (P2 peel from agents.js).
 */
import { createProcessBitableRecordsFromDB } from './process-records-from-db.js';
import {
  BITABLE_AGGRESSIVE_CATCHUP_DEADLINE_MS,
  BITABLE_CATCHUP_INTERVAL_MS,
  BITABLE_INITIAL_CATCHUP_MS,
  BITABLE_KEEPALIVE_FAIL_THRESHOLD,
  BITABLE_LISTEN_BACKOFF_MAX_MS,
  BITABLE_LISTEN_BACKOFF_MIN_MS,
  BITABLE_LISTEN_HEALTH_MS,
  BITABLE_NOTIFY_DEBOUNCE_MS,
} from './start-bitable-polling-constants.js';
import {
  checkBitableCapacity,
  disposeBitablePolling,
  runBitableCatchup,
  runBitableListenerHandler,
  scheduleBitableAggressiveCatchup,
  scheduleBitableNotifyProcessing,
  startArchiveScheduler,
  startBitableFallbackPolling,
  startBitableListener,
  startBitablePolling,
  stopBitablePolling,
} from './start-bitable-polling-helpers.js';

export {
  BITABLE_AGGRESSIVE_CATCHUP_DEADLINE_MS,
  BITABLE_CATCHUP_INTERVAL_MS,
  BITABLE_INITIAL_CATCHUP_MS,
  BITABLE_KEEPALIVE_FAIL_THRESHOLD,
  BITABLE_LISTEN_BACKOFF_MAX_MS,
  BITABLE_LISTEN_BACKOFF_MIN_MS,
  BITABLE_LISTEN_HEALTH_MS,
  BITABLE_NOTIFY_DEBOUNCE_MS,
};

/**
 * @param {object} deps
 * @returns {{
 *   startBitablePolling: (intervalMs?: number) => void,
 *   stopBitablePolling: () => void,
 *   startArchiveScheduler: () => void,
 *   checkBitableCapacity: () => Promise<void>,
 *   dispose: () => Promise<void>,
 * }}
 */
export function createBitablePollingController(deps) {
  const {
    pool,
    bitableConfigs,
    processedRecordIds,
    lastProcessedTime,
    dedupMaxKeys = 30000,
    dedupCleanCount = 8000,
    seedBitableDedup,
    extractRelationsFromBitableRecord,
    processBitableData,
    processChecklistConfirmation,
    pollAllBitableSubmissions,
    archiveOldBitableSubmissions,
    getBitableSubmissionStats,
    notifyBitablePipelineFailure,
    log,
    importPg = () => import('pg'),
    getDatabaseUrl = () => process.env.DATABASE_URL,
    notifyDebounceMs = BITABLE_NOTIFY_DEBOUNCE_MS,
    listenHealthMs = BITABLE_LISTEN_HEALTH_MS,
    initialCatchupMs = BITABLE_INITIAL_CATCHUP_MS,
    aggressiveCatchupDeadlineMs = BITABLE_AGGRESSIVE_CATCHUP_DEADLINE_MS,
    listenReconnectBackoffMinMs = BITABLE_LISTEN_BACKOFF_MIN_MS,
  } = deps;

  const processBitableRecordsFromDB = createProcessBitableRecordsFromDB({
    pool,
    bitableConfigs,
    processedRecordIds,
    lastProcessedTime,
    dedupMaxKeys,
    dedupCleanCount,
    extractRelationsFromBitableRecord,
    processBitableData,
    processChecklistConfirmation,
    log,
  });

  const ctx = {
    bitableConfigs,
    seedBitableDedup,
    processBitableRecordsFromDB,
    pollAllBitableSubmissions,
    archiveOldBitableSubmissions,
    getBitableSubmissionStats,
    notifyBitablePipelineFailure,
    log,
    importPg,
    getDatabaseUrl,
    notifyDebounceMs,
    listenHealthMs,
    initialCatchupMs,
    aggressiveCatchupDeadlineMs,
    listenReconnectBackoffMinMs,
    pollingInterval: null,
    pollingInProgress: false,
    listenClient: null,
    catchupInterval: null,
    listenKeepaliveTimer: null,
    listenReconnectTimer: null,
    listenBackoffMs: BITABLE_LISTEN_BACKOFF_MIN_MS,
    notifyDebounceTimers: new Map(),
    listenKeepaliveFailStreak: 0,
    aggressiveCatchupTimer: null,
    archiveTimer: null,
    initialCatchupTimer: null,
  };

  return {
    startBitablePolling: (intervalMs) => startBitablePolling(ctx, intervalMs),
    stopBitablePolling: () => stopBitablePolling(ctx),
    startArchiveScheduler: () => startArchiveScheduler(ctx),
    checkBitableCapacity: () => checkBitableCapacity(ctx),
    dispose: () => disposeBitablePolling(ctx),
    _internals: {
      scheduleBitableNotifyProcessing: (p) => scheduleBitableNotifyProcessing(ctx, p),
      runBitableListenerHandler: (k) => runBitableListenerHandler(ctx, k),
      runBitableCatchup: () => runBitableCatchup(ctx),
      scheduleBitableAggressiveCatchup: (r) => scheduleBitableAggressiveCatchup(ctx, r),
      startBitableListener: () => startBitableListener(ctx),
      startBitableFallbackPolling: (ms) => startBitableFallbackPolling(ctx, ms),
      processBitableRecordsFromDB,
      getState: () => ({
        bitablePollingInProgress: ctx.pollingInProgress,
        bitableListenBackoffMs: ctx.listenBackoffMs,
        bitableListenKeepaliveFailStreak: ctx.listenKeepaliveFailStreak,
        hasAggressiveTimer: Boolean(ctx.aggressiveCatchupTimer),
        notifyDebounceSize: ctx.notifyDebounceTimers.size,
      }),
    },
  };
}
