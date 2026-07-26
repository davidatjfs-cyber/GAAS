/**
 * Bitable LISTEN / catchup runtime helpers (P2 peel; split for function-size ratchet).
 */
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
import {
  BITABLE_CATCHUP_INTERVAL_MS,
  BITABLE_KEEPALIVE_FAIL_THRESHOLD,
  BITABLE_LISTEN_BACKOFF_MAX_MS,
  BITABLE_LISTEN_BACKOFF_MIN_MS,
} from './start-bitable-polling-constants.js';

export function scheduleBitableNotifyProcessing(ctx, payloadRaw) {
  const { bitableConfigs, notifyDebounceTimers, notifyDebounceMs, log } = ctx;
  const raw = String(payloadRaw || '').trim();
  if (!raw) return;
  const debounceKey = resolveBitableConfigKeyFromNotifyPayload(raw, bitableConfigs) || raw;
  const prev = notifyDebounceTimers.get(debounceKey);
  if (prev) clearTimeout(prev);
  notifyDebounceTimers.set(
    debounceKey,
    setTimeout(() => {
      notifyDebounceTimers.delete(debounceKey);
      const ck = resolveBitableConfigKeyFromNotifyPayload(raw, bitableConfigs);
      if (!ck) {
        log.warn('[bitable] NOTIFY payload not mapped to any BITABLE_CONFIGS (ignored):', raw);
        return;
      }
      runBitableListenerHandler(ctx, ck).catch((e) =>
        log.error(`[bitable] LISTEN handler error for ${ck}:`, e?.message)
      );
    }, notifyDebounceMs)
  );
}

export function startBitableFallbackPolling(ctx, intervalMs) {
  const { log, pollAllBitableSubmissions, notifyBitablePipelineFailure } = ctx;
  log.info('[bitable] ⚠️ Falling back to Feishu API polling (higher latency, more API calls)');
  const runPollingOnce = async () => {
    if (ctx.pollingInProgress) { log.info('[bitable] previous cycle still running, skip'); return; }
    ctx.pollingInProgress = true;
    try {
      await pollAllBitableSubmissions();
    } catch (e) {
      log.error('[bitable] poll error:', e?.message);
      void notifyBitablePipelineFailure('Bitable 飞书直连轮询（回退模式）单次失败', e, {
        minIntervalMs: 15 * 60 * 1000,
        dedupeKey: 'fallback_poll_once',
      });
    } finally { ctx.pollingInProgress = false; }
  };
  runPollingOnce().catch(log.error);
  ctx.pollingInterval = setInterval(() => { runPollingOnce().catch(log.error); }, intervalMs);
}

export async function runBitableListenerHandler(ctx, configKeyOrPayload) {
  const { bitableConfigs, seedBitableDedup, processBitableRecordsFromDB, notifyBitablePipelineFailure, log } = ctx;
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
  if (ctx.pollingInProgress) {
    log.info('[bitable] NOTIFY skipped — handler busy; catchup will pick up:', configKey);
    return;
  }
  ctx.pollingInProgress = true;
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
    ctx.pollingInProgress = false;
  }
}

export async function runBitableCatchup(ctx) {
  const { bitableConfigs, seedBitableDedup, processBitableRecordsFromDB, notifyBitablePipelineFailure, log } = ctx;
  if (ctx.pollingInProgress) {
    log.info('[bitable] catchup skipped — handler already running');
    return;
  }
  ctx.pollingInProgress = true;
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
    ctx.pollingInProgress = false;
  }
}

export function scheduleBitableAggressiveCatchup(ctx, reason) {
  const { log, notifyBitablePipelineFailure, aggressiveCatchupDeadlineMs } = ctx;
  if (ctx.aggressiveCatchupTimer) {
    log.info('[bitable] aggressive catchup already queued, skip:', reason);
    return;
  }
  const delay = pickAggressiveCatchupDelay(aggressiveCatchupDeadlineMs);
  log.warn(`[bitable] aggressive catchup scheduled in ${delay}ms (${reason})`);
  ctx.aggressiveCatchupTimer = setTimeout(() => {
    ctx.aggressiveCatchupTimer = null;
    runBitableCatchup(ctx)
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

export function attachListenClientHandlers(ctx, client) {
  const { log, notifyBitablePipelineFailure, listenReconnectBackoffMinMs } = ctx;
  client.on('notification', (msg) => {
    if (msg.channel === 'bitable_records_updated' && msg.payload) {
      log.info(`[bitable] PG NOTIFY received: payload=${msg.payload}`);
      scheduleBitableNotifyProcessing(ctx, msg.payload);
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
    if (ctx.listenKeepaliveTimer) {
      clearInterval(ctx.listenKeepaliveTimer);
      ctx.listenKeepaliveTimer = null;
    }
    if (ctx.listenClient === client) ctx.listenClient = null;
    const delay = computeListenReconnectDelay(
      ctx.listenBackoffMs,
      listenReconnectBackoffMinMs,
      BITABLE_LISTEN_BACKOFF_MAX_MS
    );
    ctx.listenBackoffMs = nextListenBackoffMs(ctx.listenBackoffMs, BITABLE_LISTEN_BACKOFF_MAX_MS);
    log.info(`[bitable] LISTEN disconnected, reconnect in ${delay}ms (backoff max ${BITABLE_LISTEN_BACKOFF_MAX_MS}ms)`);
    void notifyBitablePipelineFailure(
      'Bitable LISTEN 连接已断开（将自动重连）',
      new Error(`LISTEN client end; next reconnect in ${delay}ms, backoff=${ctx.listenBackoffMs}ms`),
      { minIntervalMs: 120_000, dedupeKey: 'listen_end' }
    );
    if (ctx.listenReconnectTimer) clearTimeout(ctx.listenReconnectTimer);
    ctx.listenReconnectTimer = setTimeout(() => {
      ctx.listenReconnectTimer = null;
      startBitableListener(ctx).catch((e) => {
        log.error('[bitable] LISTEN reconnect failed:', e?.message);
        void notifyBitablePipelineFailure('Bitable LISTEN 重连尝试失败', e, {
          minIntervalMs: 60_000,
          dedupeKey: 'listen_reconnect',
        });
      });
    }, delay);
  });
}

export function startListenKeepalive(ctx) {
  const { log, notifyBitablePipelineFailure, listenHealthMs, aggressiveCatchupDeadlineMs } = ctx;
  ctx.listenKeepaliveTimer = setInterval(async () => {
    try {
      const c = ctx.listenClient;
      if (!c || c._ending) return;
      await c.query('SELECT 1');
      ctx.listenKeepaliveFailStreak = 0;
    } catch (e) {
      log.error('[bitable] LISTEN keepalive failed:', e?.message);
      void notifyBitablePipelineFailure('Bitable LISTEN keepalive 失败', e, {
        minIntervalMs: 45_000,
        dedupeKey: 'keepalive',
      });
      ctx.listenKeepaliveFailStreak += 1;
      if (shouldTriggerAggressiveCatchup(ctx.listenKeepaliveFailStreak, BITABLE_KEEPALIVE_FAIL_THRESHOLD)) {
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
        ctx.listenKeepaliveFailStreak = 0;
        scheduleBitableAggressiveCatchup(ctx, 'listen_keepalive_degraded');
      }
      try { ctx.listenClient?.end(); } catch (_) { /* ignore */ }
    }
  }, listenHealthMs);
}

export async function resetListenRuntime(ctx) {
  if (ctx.listenReconnectTimer) {
    clearTimeout(ctx.listenReconnectTimer);
    ctx.listenReconnectTimer = null;
  }
  if (ctx.aggressiveCatchupTimer) {
    clearTimeout(ctx.aggressiveCatchupTimer);
    ctx.aggressiveCatchupTimer = null;
  }
  if (ctx.listenKeepaliveTimer) {
    clearInterval(ctx.listenKeepaliveTimer);
    ctx.listenKeepaliveTimer = null;
  }
  if (ctx.listenClient) {
    try {
      ctx.listenClient.removeAllListeners();
      await ctx.listenClient.end();
    } catch (_) { /* ignore */ }
    ctx.listenClient = null;
  }
}

export async function startBitableListener(ctx) {
  const {
    importPg,
    getDatabaseUrl,
    log,
    notifyBitablePipelineFailure,
    listenReconnectBackoffMinMs,
    listenHealthMs,
  } = ctx;
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
    startBitableFallbackPolling(ctx, 60000);
    return;
  }
  try {
    await resetListenRuntime(ctx);
    const Client = pgModule.Client || pgModule.default?.Client;
    const client = new Client({ connectionString });
    await client.connect();
    await client.query('LISTEN bitable_records_updated');
    ctx.listenBackoffMs = listenReconnectBackoffMinMs || BITABLE_LISTEN_BACKOFF_MIN_MS;
    ctx.listenKeepaliveFailStreak = 0;
    attachListenClientHandlers(ctx, client);
    ctx.listenClient = client;
    startListenKeepalive(ctx);
    log.info('[bitable] PG LISTEN setup complete for bitable_records_updated (keepalive every ' + listenHealthMs + 'ms)');
  } catch (e) {
    log.error('[bitable] PG LISTEN setup failed, falling back to polling:', e?.message);
    void notifyBitablePipelineFailure('Bitable LISTEN 初始化失败（已回退飞书直连轮询）', e, { minIntervalMs: 0 });
    startBitableFallbackPolling(ctx, 60000);
  }
}

export async function checkBitableCapacity(ctx) {
  const { getBitableSubmissionStats, log } = ctx;
  try {
    const stats = await getBitableSubmissionStats();
    const { mainCount, totalCount, warning, critical } = buildBitableCapacityMessages(stats);
    log.info(`[bitable] capacity check: main=${mainCount}, total=${totalCount}`);
    if (warning) log.warn('[bitable] CAPACITY WARNING:', warning);
    if (critical) log.error('[bitable] CAPACITY CRITICAL:', critical);
  } catch (e) {
    log.error('[bitable] capacity check failed:', e?.message);
  }
}

export function startArchiveScheduler(ctx) {
  const { archiveOldBitableSubmissions, log } = ctx;
  const scheduleNextArchive = () => {
    const { msUntilArchive, nextAt } = msUntilNextArchiveAt3am(new Date());
    if (ctx.archiveTimer) clearTimeout(ctx.archiveTimer);
    ctx.archiveTimer = setTimeout(async () => {
      ctx.archiveTimer = null;
      log.info('[bitable] running daily archive task');
      const result = await archiveOldBitableSubmissions();
      log.info('[bitable] archive result:', result);
      await checkBitableCapacity(ctx);
      scheduleNextArchive();
    }, msUntilArchive);
    log.info('[bitable] next archive scheduled for:', nextAt.toISOString());
  };
  scheduleNextArchive();
}

export function startBitablePolling(ctx, _intervalMs = 60000) {
  const { log, notifyBitablePipelineFailure, initialCatchupMs } = ctx;
  if (ctx.pollingInterval) clearInterval(ctx.pollingInterval);
  log.info('[bitable] ⚡ PG LISTEN + DB trigger notify — Agent V2 writes feishu_generic_records, HRMS reacts on NOTIFY');
  startBitableListener(ctx);
  if (ctx.catchupInterval) clearInterval(ctx.catchupInterval);
  ctx.catchupInterval = setInterval(() => {
    runBitableCatchup(ctx).catch((e) => log.error('[bitable] catchup error:', e?.message));
  }, BITABLE_CATCHUP_INTERVAL_MS);
  if (ctx.initialCatchupTimer) clearTimeout(ctx.initialCatchupTimer);
  ctx.initialCatchupTimer = setTimeout(() => {
    ctx.initialCatchupTimer = null;
    runBitableCatchup(ctx).catch((e) => {
      log.error('[bitable] initial catchup error:', e?.message);
      void notifyBitablePipelineFailure('Bitable 启动后首次 catchup 失败', e, { minIntervalMs: 0 });
    });
  }, initialCatchupMs);
  startArchiveScheduler(ctx);
}

export function stopBitablePolling(ctx) {
  if (ctx.pollingInterval) {
    clearInterval(ctx.pollingInterval);
    ctx.pollingInterval = null;
    ctx.log.info('[bitable] polling stopped');
  }
}

export async function disposeBitablePolling(ctx) {
  stopBitablePolling(ctx);
  if (ctx.catchupInterval) {
    clearInterval(ctx.catchupInterval);
    ctx.catchupInterval = null;
  }
  if (ctx.listenKeepaliveTimer) {
    clearInterval(ctx.listenKeepaliveTimer);
    ctx.listenKeepaliveTimer = null;
  }
  if (ctx.listenReconnectTimer) {
    clearTimeout(ctx.listenReconnectTimer);
    ctx.listenReconnectTimer = null;
  }
  if (ctx.aggressiveCatchupTimer) {
    clearTimeout(ctx.aggressiveCatchupTimer);
    ctx.aggressiveCatchupTimer = null;
  }
  if (ctx.archiveTimer) {
    clearTimeout(ctx.archiveTimer);
    ctx.archiveTimer = null;
  }
  if (ctx.initialCatchupTimer) {
    clearTimeout(ctx.initialCatchupTimer);
    ctx.initialCatchupTimer = null;
  }
  for (const t of ctx.notifyDebounceTimers.values()) clearTimeout(t);
  ctx.notifyDebounceTimers.clear();
  if (ctx.listenClient) {
    const client = ctx.listenClient;
    ctx.listenClient = null;
    try {
      client.removeAllListeners();
      await client.end();
    } catch (_) { /* ignore */ }
  }
  if (ctx.listenReconnectTimer) {
    clearTimeout(ctx.listenReconnectTimer);
    ctx.listenReconnectTimer = null;
  }
}
