/**
 * Growth background workers — P5.4 extract from registerGrowthRoutes.
 */
export function startGrowthMiscTimers(deps) {
  const {
    pool,
    log,
    runForActiveTenants,
    tenantContext,
    resolveTenantIdDefault,
    cleanText,
    cleanPhone,
    inSmsQuietHours,
    isPhoneSuppressed,
    globalSmsCapped,
    upsertDeliveryLog,
    insertGrowthEvent,
    sendAliyunSms,
    handleSmsFailure,
    upsertCustomer,
    resolveTenantIdForStore,
    pickBalanceTemplateByStore,
    isAliyunSmsAutoSendEnabled,
    freqDaysEnv,
    buildRemindTargetsQuery,
    autoBackfillSmsActions,
    recomputeCustomerProfiles,
    backfillRedemptionAmounts,
    runTouchRuleEngine,
    getAllStoreWecomConfigs,
    syncWecomContactsForStore,
    buildGrowthDailyReport,
    setTouchRulesAudienceGetter,
    sendGrowthAlert,
    hasSendGrowthAlert,
    loadSegmentPhoneSet,
    fetchGenericRuleCandidates,
  } = deps;

  // 客户画像（生命周期/价值分级等，决定"涉及会员"人数）每日自动重算，避免依赖人工触发而过期；
  // 价值分级 VIP 口径：各门店折前人均消费金额(avg_check=折前营业额÷客流量) PERCENT_RANK 前15%
  // 重算后顺带刷新人群缓存，使"涉及会员"数据始终与画像同步。
  if (!globalThis.__growthProfileTimer) {
    const runProfileRecompute = () => runForActiveTenants((tenantId) => recomputeCustomerProfiles(pool, 90)
      .then(() => {
        if (typeof globalThis.__refreshGrowthAudience === 'function') {
          globalThis.__refreshGrowthAudience(tenantId);
        }
      }))
      .catch((e) => log.warn({ msg: 'profiles_recompute_failed', err: e?.message }));
    setTimeout(runProfileRecompute, 20000);
    globalThis.__growthProfileTimer = setInterval(runProfileRecompute, 24 * 60 * 60 * 1000);
  }
  // 核销消费金额每天凌晨2点(北京时间)批量补算一次：POS数据是按天同步的，核销当时大概率查不到，
  // 等次日POS数据到位后统一回填近7天内仍为0的核销记录。
  if (!globalThis.__growthRedemptionBackfillTimer) {
    let __growthRedemptionBackfillLastYmd = '';
    const runBackfill = () => {
      const nowCst = new Date(Date.now() + 8 * 3600000);
      const ymd = nowCst.toISOString().slice(0, 10);
      if (nowCst.getUTCHours() < 2 || __growthRedemptionBackfillLastYmd === ymd) return;
      __growthRedemptionBackfillLastYmd = ymd;
      runForActiveTenants(() => backfillRedemptionAmounts(pool))
        .then((rows) => log.info({ msg: 'redemption_amount_backfill', rows: rows.reduce((sum, value) => sum + (Number(value) || 0), 0) }))
        .catch((e) => log.warn({ msg: 'redemption_amount_backfill_failed', err: e?.message }));
    };
    globalThis.__growthRedemptionBackfillTimer = setInterval(runBackfill, 10 * 60 * 1000);
  }
  if (!globalThis.__growthTouchRuleTimer) {
    globalThis.__growthTouchRuleTimer = setInterval(() => {
      runForActiveTenants((tenantId) => runTouchRuleEngine(pool, { limit_per_rule: 5000, tenantId }))
        .catch((e) => log.warn({ msg: 'rule_engine_run_failed', err: e?.message }));
    }, 15 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants((tenantId) => runTouchRuleEngine(pool, { limit_per_rule: 5000, tenantId }))
        .catch((e) => log.warn({ msg: 'rule_engine_initial_run_failed', err: e?.message }));
    }, 10000);
  }

  if (!globalThis.__wecomContactSyncTimer) {
    globalThis.__wecomContactSyncTimer = setInterval(async () => {
      try {
        await runForActiveTenants(async () => {
          const configs = await getAllStoreWecomConfigs(pool);
          for (const cfg of configs) {
            await syncWecomContactsForStore(pool, cfg);
          }
        });
      } catch (e) {
        log.warn({ msg: 'wecom_contact_sync_failed', err: e?.message });
      }
    }, 24 * 60 * 60 * 1000); // 实时事件回调(wecom-contact-events.js)已是主力数据源，这里降为每日兜底对账
    setTimeout(async () => {
      try {
        await runForActiveTenants(async () => {
          const configs = await getAllStoreWecomConfigs(pool);
          for (const cfg of configs) {
            await syncWecomContactsForStore(pool, cfg);
          }
        });
      } catch (e) {
        log.warn({ msg: 'wecom_contact_sync_initial_failed', err: e?.message });
      }
    }, 30000);
  }

  // 每日增长日报（每天 09:05 发送）
  if (!globalThis.__growthDailyReportTimer) {
    function scheduleDailyReport() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(8, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const delay = next - now;
      globalThis.__growthDailyReportTimer = setTimeout(async () => {
        try {
          if (hasSendGrowthAlert?.()) {
            const reportRuns = await runForActiveTenants(
              async (tenantId) => ({
                tenantId,
                message: await buildGrowthDailyReport(pool)
              }),
              {
                continueOnError: true,
                onError: ({ tenantId, error }) => {
                  log.warn({ msg: 'daily_report_tenant_failed', tenant_id: tenantId, err: error?.message || String(error) });
                }
              }
            );
            for (const row of reportRuns.results || []) {
              await sendGrowthAlert(`[租户 ${row.tenantId}]\n${row.value.message}`, 'growth_daily_report');
            }
          }
        } catch (e) {
          log.warn({ msg: 'daily_report_failed', err: e?.message });
        }
        scheduleDailyReport();
      }, delay);
    }
    scheduleDailyReport();
  }
}
