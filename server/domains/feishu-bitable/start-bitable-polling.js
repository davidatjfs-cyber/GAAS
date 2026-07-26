/**
 * Bitable PG LISTEN + catchup + archive scheduler (P2 peel from agents.js).
 */
import { createProcessBitableRecordsFromDB } from './process-records-from-db.js';
import {
  buildBitableCapacityMessages,
  computeListenReconnectDelay,
  listCatchupConfigKeys,
  msUntilNextArchiveAt3am,
  nextListenBackoffMs,
  pickAggressiveCatchupDelay,
  resolveBitableConfigKeyFromNotifyPayload,
  shouldTriggerAggressiveCatchup,
} from './listen-helpers.js';

export const BITABLE_NOTIFY_DEBOUNCE_MS = 300;
export const BITABLE_CATCHUP_INTERVAL_MS = 2 * 60 * 1000;
export const BITABLE_INITIAL_CATCHUP_MS = 8000;
export const BITABLE_LISTEN_HEALTH_MS = 45_000;
export const BITABLE_LISTEN_BACKOFF_MIN_MS = 2000;
export const BITABLE_LISTEN_BACKOFF_MAX_MS = 90_000;
export const BITABLE_KEEPALIVE_FAIL_THRESHOLD = 3;
export const BITABLE_AGGRESSIVE_CATCHUP_DEADLINE_MS = 28_000;

/**
 * @param {object} deps
 * @returns {{
 *   startBitablePolling: (intervalMs?: number) => void,
 *   stopBitablePolling: () => void,
 *   startArchiveScheduler: () => void,
 *   checkBitableCapacity: () => Promise<void>,
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

  let bitablePollingInterval = null;
  let bitablePollingInProgress = false;
  let bitableListenClient = null;
  let bitableCatchupInterval = null;
  let bitableListenKeepaliveTimer = null;
  let bitableListenReconnectTimer = null;
  let bitableListenBackoffMs = BITABLE_LISTEN_BACKOFF_MIN_MS;
  const bitableNotifyDebounceTimers = new Map();
  let bitableListenKeepaliveFailStreak = 0;
  let bitableAggressiveCatchupTimer = null;
  let bitableArchiveTimer = null;
  let bitableInitialCatchupTimer = null;

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

  function scheduleBitableNotifyProcessing(payloadRaw) {
    const raw = String(payloadRaw || '').trim();
    if (!raw) return;
    const debounceKey = resolveBitableConfigKeyFromNotifyPayload(raw, bitableConfigs) || raw;
    const prev = bitableNotifyDebounceTimers.get(debounceKey);
    if (prev) clearTimeout(prev);
    bitableNotifyDebounceTimers.set(
      debounceKey,
      setTimeout(() => {
        bitableNotifyDebounceTimers.delete(debounceKey);
        const ck = resolveBitableConfigKeyFromNotifyPayload(raw, bitableConfigs);
        if (!ck) {
          log.warn('[bitable] NOTIFY payload not mapped to any BITABLE_CONFIGS (ignored):', raw);
          return;
        }
        runBitableListenerHandler(ck).catch((e) =>
          log.error(`[bitable] LISTEN handler error for ${ck}:`, e?.message)
        );
      }, notifyDebounceMs)
    );
  }

  function startBitableFallbackPolling(intervalMs) {
    log.info('[bitable] ⚠️ Falling back to Feishu API polling (higher latency, more API calls)');
    const runPollingOnce = async () => {
      if (bitablePollingInProgress) { log.info('[bitable] previous cycle still running, skip'); return; }
      bitablePollingInProgress = true;
      try {
        await pollAllBitableSubmissions();
      } catch (e) {
        log.error('[bitable] poll error:', e?.message);
        void notifyBitablePipelineFailure('Bitable 飞书直连轮询（回退模式）单次失败', e, {
          minIntervalMs: 15 * 60 * 1000,
          dedupeKey: 'fallback_poll_once',
        });
      } finally { bitablePollingInProgress = false; }
    };
    runPollingOnce().catch(log.error);
    bitablePollingInterval = setInterval(() => { runPollingOnce().catch(log.error); }, intervalMs);
  }

  async function runBitableListenerHandler(configKeyOrPayload) {
    const configKey =
      resolveBitableConfigKeyFromNotifyPayload(configKeyOrPayload, bitableConfigs)
      || String(configKeyOrPayload || '').trim();
    if (!configKey || !bitableConfigs[configKey]?.tableId) {
      log.warn('[bitable] runBitableListenerHandler: unknown configKey / payload:', configKeyOrPayload);
      void notifyBitablePipelineFailure(
        'Bitable NOTIFY payload 无法映射到 BITABLE_CONFIGS',
        new Error(String(configKeyOrPayload || 'empty')),
        { minIntervalMs: 60 * 60 * 1000, dedupeKey: 'unknown_notify_payload' }
      );
      return;
    }
    if (bitablePollingInProgress) {
      log.info('[bitable] NOTIFY skipped — handler busy; catchup will pick up:', configKey);
      return;
    }
    bitablePollingInProgress = true;
    try {
      await seedBitableDedup();
      await processBitableRecordsFromDB(configKey);
    } catch (e) {
      log.error(`[bitable] LISTEN handler error for ${configKey}:`, e?.message);
      void notifyBitablePipelineFailure(`Bitable NOTIFY 处理失败（configKey=${configKey}）`, e, {
        minIntervalMs: 120_000,
        dedupeKey: configKey,
      });
    } finally {
      bitablePollingInProgress = false;
    }
  }

  async function runBitableCatchup() {
    if (bitablePollingInProgress) {
      log.info('[bitable] catchup skipped — handler already running');
      return;
    }
    bitablePollingInProgress = true;
    try {
      await seedBitableDedup();
      const configKeys = listCatchupConfigKeys(bitableConfigs);
      for (const configKey of configKeys) {
        try {
          await processBitableRecordsFromDB(configKey);
        } catch (e) {
          log.error(`[bitable] catchup error for ${configKey}:`, e?.message);
          void notifyBitablePipelineFailure(`Bitable catchup 单表失败（${configKey}）`, e, {
            minIntervalMs: 180_000,
            dedupeKey: `catchup_${configKey}`,
          });
        }
        await new Promise((r) => setImmediate(r));
      }
      log.info('[bitable] catchup cycle complete');
    } catch (e) {
      log.error('[bitable] catchup cycle error:', e?.message);
      void notifyBitablePipelineFailure('Bitable 定时 catchup 整轮失败', e, {
        minIntervalMs: 180_000,
        dedupeKey: 'catchup_cycle',
      });
    } finally {
      bitablePollingInProgress = false;
    }
  }

  function scheduleBitableAggressiveCatchup(reason) {
    if (bitableAggressiveCatchupTimer) {
      log.info('[bitable] aggressive catchup already queued, skip:', reason);
      return;
    }
    const delay = pickAggressiveCatchupDelay(aggressiveCatchupDeadlineMs);
    log.warn(`[bitable] aggressive catchup scheduled in ${delay}ms (${reason})`);
    bitableAggressiveCatchupTimer = setTimeout(() => {
      bitableAggressiveCatchupTimer = null;
      runBitableCatchup()
        .then(() => log.info('[bitable] aggressive catchup cycle complete'))
        .catch((err) => {
          log.error('[bitable] aggressive catchup error:', err?.message);
          void notifyBitablePipelineFailure('Bitable 加密 catchup（keepalive 降级触发）失败', err, {
            minIntervalMs: 0,
            dedupeKey: 'aggressive_catchup',
          });
        });
    }, delay);
  }

  async function startBitableListener() {
    let pgModule;
    try { pgModule = await importPg(); } catch (e) { pgModule = null; }
    const connectionString = getDatabaseUrl();
    if (!pgModule || !connectionString) {
      log.error('[bitable] No pg module or DATABASE_URL, cannot LISTEN — falling back to polling');
      void notifyBitablePipelineFailure(
        'Bitable LISTEN（缺少 pg 或 DATABASE_URL）',
        new Error('cannot LISTEN: no pg module or DATABASE_URL'),
        { minIntervalMs: 0 }
      );
      startBitableFallbackPolling(60000);
      return;
    }
    try {
      if (bitableListenReconnectTimer) {
        clearTimeout(bitableListenReconnectTimer);
        bitableListenReconnectTimer = null;
      }
      if (bitableAggressiveCatchupTimer) {
        clearTimeout(bitableAggressiveCatchupTimer);
        bitableAggressiveCatchupTimer = null;
      }
      if (bitableListenKeepaliveTimer) {
        clearInterval(bitableListenKeepaliveTimer);
        bitableListenKeepaliveTimer = null;
      }
      if (bitableListenClient) {
        try {
          bitableListenClient.removeAllListeners();
          await bitableListenClient.end();
        } catch (_) { /* ignore */ }
        bitableListenClient = null;
      }
      const Client = pgModule.Client || pgModule.default?.Client;
      const client = new Client({ connectionString });
      await client.connect();
      await client.query('LISTEN bitable_records_updated');
      bitableListenBackoffMs = listenReconnectBackoffMinMs;
      bitableListenKeepaliveFailStreak = 0;
      client.on('notification', (msg) => {
        if (msg.channel === 'bitable_records_updated' && msg.payload) {
          log.info(`[bitable] PG NOTIFY received: payload=${msg.payload}`);
          scheduleBitableNotifyProcessing(msg.payload);
        }
      });
      client.on('error', (err) => {
        log.error('[bitable] LISTEN client error:', err?.message);
        void notifyBitablePipelineFailure('Bitable LISTEN 连接 error 事件', err, {
          minIntervalMs: 30_000,
          dedupeKey: 'listen_client_error',
        });
        try { client.end(); } catch (_) { /* ignore */ }
      });
      client.on('end', () => {
        if (bitableListenKeepaliveTimer) {
          clearInterval(bitableListenKeepaliveTimer);
          bitableListenKeepaliveTimer = null;
        }
        if (bitableListenClient === client) bitableListenClient = null;
        const delay = computeListenReconnectDelay(
          bitableListenBackoffMs,
          listenReconnectBackoffMinMs,
          BITABLE_LISTEN_BACKOFF_MAX_MS
        );
        bitableListenBackoffMs = nextListenBackoffMs(bitableListenBackoffMs, BITABLE_LISTEN_BACKOFF_MAX_MS);
        log.info(`[bitable] LISTEN disconnected, reconnect in ${delay}ms (backoff max ${BITABLE_LISTEN_BACKOFF_MAX_MS}ms)`);
        void notifyBitablePipelineFailure(
          'Bitable LISTEN 连接已断开（将自动重连）',
          new Error(`LISTEN client end; next reconnect in ${delay}ms, backoff=${bitableListenBackoffMs}ms`),
          { minIntervalMs: 120_000, dedupeKey: 'listen_end' }
        );
        if (bitableListenReconnectTimer) clearTimeout(bitableListenReconnectTimer);
        bitableListenReconnectTimer = setTimeout(() => {
          bitableListenReconnectTimer = null;
          startBitableListener().catch((e) => {
            log.error('[bitable] LISTEN reconnect failed:', e?.message);
            void notifyBitablePipelineFailure('Bitable LISTEN 重连尝试失败', e, {
              minIntervalMs: 60_000,
              dedupeKey: 'listen_reconnect',
            });
          });
        }, delay);
      });
      bitableListenClient = client;
      bitableListenKeepaliveTimer = setInterval(async () => {
        try {
          const c = bitableListenClient;
          if (!c || c._ending) return;
          await c.query('SELECT 1');
          bitableListenKeepaliveFailStreak = 0;
        } catch (e) {
          log.error('[bitable] LISTEN keepalive failed:', e?.message);
          void notifyBitablePipelineFailure('Bitable LISTEN keepalive 失败', e, {
            minIntervalMs: 45_000,
            dedupeKey: 'keepalive',
          });
          bitableListenKeepaliveFailStreak += 1;
          if (shouldTriggerAggressiveCatchup(bitableListenKeepaliveFailStreak, BITABLE_KEEPALIVE_FAIL_THRESHOLD)) {
            log.warn(
              `[bitable] LISTEN keepalive failed ${BITABLE_KEEPALIVE_FAIL_THRESHOLD} times consecutively — scheduling aggressive catchup within ${aggressiveCatchupDeadlineMs}ms`
            );
            void notifyBitablePipelineFailure(
              `Bitable LISTEN keepalive 连续失败（≥${BITABLE_KEEPALIVE_FAIL_THRESHOLD} 次，已调度加密 catchup）`,
              e,
              {
                minIntervalMs: 0,
                extraLines: [
                  `已连续 ${BITABLE_KEEPALIVE_FAIL_THRESHOLD} 次 keepalive 失败，已在约 ${aggressiveCatchupDeadlineMs}ms 内调度额外 DB catchup。`,
                ],
              }
            );
            bitableListenKeepaliveFailStreak = 0;
            scheduleBitableAggressiveCatchup('listen_keepalive_degraded');
          }
          try { bitableListenClient?.end(); } catch (_) { /* ignore */ }
        }
      }, listenHealthMs);
      log.info('[bitable] PG LISTEN setup complete for bitable_records_updated (keepalive every ' + listenHealthMs + 'ms)');
    } catch (e) {
      log.error('[bitable] PG LISTEN setup failed, falling back to polling:', e?.message);
      void notifyBitablePipelineFailure('Bitable LISTEN 初始化失败（已回退飞书直连轮询）', e, { minIntervalMs: 0 });
      startBitableFallbackPolling(60000);
    }
  }

  async function checkBitableCapacity() {
    try {
      const stats = await getBitableSubmissionStats();
      const { mainCount, totalCount, warning, critical } = buildBitableCapacityMessages(stats);

      log.info(`[bitable] capacity check: main=${mainCount}, total=${totalCount}`);

      if (warning) {
        log.warn('[bitable] CAPACITY WARNING:', warning);
      }
      if (critical) {
        log.error('[bitable] CAPACITY CRITICAL:', critical);
      }
    } catch (e) {
      log.error('[bitable] capacity check failed:', e?.message);
    }
  }

  function startArchiveScheduler() {
    const scheduleNextArchive = () => {
      const { msUntilArchive, nextAt } = msUntilNextArchiveAt3am(new Date());

      if (bitableArchiveTimer) clearTimeout(bitableArchiveTimer);
      bitableArchiveTimer = setTimeout(async () => {
        bitableArchiveTimer = null;
        log.info('[bitable] running daily archive task');
        const result = await archiveOldBitableSubmissions();
        log.info('[bitable] archive result:', result);

        await checkBitableCapacity();

        scheduleNextArchive();
      }, msUntilArchive);

      log.info('[bitable] next archive scheduled for:', nextAt.toISOString());
    };

    scheduleNextArchive();
  }

  function startBitablePolling(_intervalMs = 60000) {
    if (bitablePollingInterval) {
      clearInterval(bitablePollingInterval);
    }

    log.info('[bitable] ⚡ PG LISTEN + DB trigger notify — Agent V2 writes feishu_generic_records, HRMS reacts on NOTIFY');

    startBitableListener();

    if (bitableCatchupInterval) clearInterval(bitableCatchupInterval);
    bitableCatchupInterval = setInterval(() => {
      runBitableCatchup().catch((e) => log.error('[bitable] catchup error:', e?.message));
    }, BITABLE_CATCHUP_INTERVAL_MS);

    if (bitableInitialCatchupTimer) clearTimeout(bitableInitialCatchupTimer);
    bitableInitialCatchupTimer = setTimeout(() => {
      bitableInitialCatchupTimer = null;
      runBitableCatchup().catch((e) => {
        log.error('[bitable] initial catchup error:', e?.message);
        void notifyBitablePipelineFailure('Bitable 启动后首次 catchup 失败', e, { minIntervalMs: 0 });
      });
    }, initialCatchupMs);

    startArchiveScheduler();
  }

  function stopBitablePolling() {
    if (bitablePollingInterval) {
      clearInterval(bitablePollingInterval);
      bitablePollingInterval = null;
      log.info('[bitable] polling stopped');
    }
  }

  /** Clear timers / LISTEN client — used by unit tests and optional shutdown. */
  async function dispose() {
    stopBitablePolling();
    if (bitableCatchupInterval) {
      clearInterval(bitableCatchupInterval);
      bitableCatchupInterval = null;
    }
    if (bitableListenKeepaliveTimer) {
      clearInterval(bitableListenKeepaliveTimer);
      bitableListenKeepaliveTimer = null;
    }
    if (bitableListenReconnectTimer) {
      clearTimeout(bitableListenReconnectTimer);
      bitableListenReconnectTimer = null;
    }
    if (bitableAggressiveCatchupTimer) {
      clearTimeout(bitableAggressiveCatchupTimer);
      bitableAggressiveCatchupTimer = null;
    }
    if (bitableArchiveTimer) {
      clearTimeout(bitableArchiveTimer);
      bitableArchiveTimer = null;
    }
    if (bitableInitialCatchupTimer) {
      clearTimeout(bitableInitialCatchupTimer);
      bitableInitialCatchupTimer = null;
    }
    for (const t of bitableNotifyDebounceTimers.values()) clearTimeout(t);
    bitableNotifyDebounceTimers.clear();
    if (bitableListenClient) {
      const client = bitableListenClient;
      bitableListenClient = null;
      try {
        client.removeAllListeners();
        await client.end();
      } catch (_) { /* ignore */ }
    }
    if (bitableListenReconnectTimer) {
      clearTimeout(bitableListenReconnectTimer);
      bitableListenReconnectTimer = null;
    }
  }

  return {
    startBitablePolling,
    stopBitablePolling,
    startArchiveScheduler,
    checkBitableCapacity,
    dispose,
    // exposed for unit tests
    _internals: {
      scheduleBitableNotifyProcessing,
      runBitableListenerHandler,
      runBitableCatchup,
      scheduleBitableAggressiveCatchup,
      startBitableListener,
      startBitableFallbackPolling,
      processBitableRecordsFromDB,
      getState: () => ({
        bitablePollingInProgress,
        bitableListenBackoffMs,
        bitableListenKeepaliveFailStreak,
        hasAggressiveTimer: Boolean(bitableAggressiveCatchupTimer),
        notifyDebounceSize: bitableNotifyDebounceTimers.size,
      }),
    },
  };
}
