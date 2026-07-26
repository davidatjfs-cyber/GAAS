/**
 * Master Agent periodic tick helpers — tenant-scoped interval wiring.
 */

export function createTenantScopedTick({ pool, getActiveTenantIds, tenantContext, log }) {
  return function tenantTick(label, run, options = {}) {
    const {
      logWhen = (result) => result > 0,
      formatMessage = (result) => String(result),
    } = options;

    return async () => {
      for (const tenantId of await getActiveTenantIds(pool())) {
        await tenantContext.run(tenantId, async () => {
          try {
            const result = await run(tenantId);
            if (logWhen(result)) {
              log.info(
                `[master:tick] ${label}(${tenantId}) ${formatMessage(result)}`
              );
            }
          } catch (e) {
            log.error(
              `[master:tick] ${label} error (tenant=${tenantId}):`,
              e?.message
            );
          }
        });
      }
    };
  };
}

export function registerMasterIntervals(schedule, log) {
  for (const entry of schedule) {
    setInterval(entry.fn, entry.intervalMs);
    if (entry.startupDelayMs != null) {
      setTimeout(entry.fn, entry.startupDelayMs);
    }
  }
  log.info(
    '[master] All agent listeners started (including KG health tick + auto-ops engine)'
  );
}
