/**
 * Sales AI background timers — P5.4 peel from registerSalesAiRoutes.
 */
import { ensureSalesTables } from '../../services/sales/sales-store.js';
import { runSalesSlaScan } from '../../services/sales/sales-sla-service.js';
import { runDeployCheckSlaScan } from '../../services/sales/onboarding-sla-service.js';
import { runHealthCheckPeriodScan } from '../../services/sales/health-check-period-service.js';
import { runProvisioningRetryScan } from '../../services/sales/provisioning-retry-service.js';
import { runNurtureCadence } from '../../services/sales/sales-nurture.js';
import { scanCreditRisks } from '../../services/sales/sales-credit-risk.js';
import { syncCustomerSuccessTasks, runRenewalBillReminders15d } from '../../services/sales/tenant-renewal-service.js';
import { runTrialValidations } from '../../services/sales/sales-trial-monitor.js';
import { buildBossDailyReport } from '../../services/sales/sales-ops.js';
import { runDailyActivityRollup, runAutoKpiRollupAndNotify } from '../../services/sales/sales-rep-management.js';
import { kfConfigured, kfEnv, processKfCallbackEvent } from '../../services/sales/sales-kf.js';
import { handleInboundMessage } from '../../services/sales/sales-session.js';
import { remindStaleHighIntentLeads, runRiskAlerts } from './service.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-schedulers' });

// Node's setTimeout delay is a 32-bit signed int (~24.8 days). Passing a larger
// delay silently overflows and fires almost immediately (TimeoutOverflowWarning),
// which turned monthly schedules into a fire-immediately-then-reschedule tight
// loop. Chain timeouts to stay under the limit for delays further out.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
function safeSetTimeout(fn, delay) {
  if (delay > MAX_TIMEOUT_MS) {
    return setTimeout(() => safeSetTimeout(fn, delay - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }
  return setTimeout(fn, Math.max(delay, 0));
}

function scheduleDailyAt(pool, sendOpsAlert, globalKey, hour, minute, runner, failMsg) {
  if (globalThis[globalKey]) return;
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    globalThis[globalKey] = safeSetTimeout(async () => {
      try {
        await runner();
      } catch (e) {
        log.warn({ msg: failMsg, err: e?.message || e });
      }
      schedule();
    }, next - now);
  };
  schedule();
}

function scheduleWeeklyKpi(pool, sendOpsAlert, globalKey, period) {
  if (globalThis[globalKey]) return;
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(8, period === 'week' ? 0 : 15, 0, 0);
    if (period === 'week') {
      const dayOfWeek = next.getDay() || 7;
      let daysUntilMonday = (1 - dayOfWeek + 7) % 7;
      if (daysUntilMonday === 0 && next <= now) daysUntilMonday = 7;
      next.setDate(next.getDate() + daysUntilMonday);
    } else if (next <= now) {
      next.setMonth(next.getMonth() + 1, 1);
    }
    globalThis[globalKey] = safeSetTimeout(async () => {
      try {
        await runAutoKpiRollupAndNotify(pool, sendOpsAlert, period);
      } catch (e) {
        log.warn({ msg: period === 'week' ? 'sales_ai_weekly_kpi_rollup_failed' : 'sales_ai_monthly_kpi_rollup_failed', err: e?.message || e });
      }
      schedule();
    }, next - now);
  };
  schedule();
}

export function registerSalesAiSchedulers(pool, sendOpsAlert) {
  if (!globalThis.__salesStaleLeadReminderTimer) {
    globalThis.__salesStaleLeadReminderTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => remindStaleHighIntentLeads(pool, sendOpsAlert))
        .catch((e) => log.warn({ msg: 'sales_ai_stale_lead_reminder_run_failed', err: e?.message || e }));
    }, 30 * 60 * 1000);
  }

  if (!globalThis.__salesRiskAlertTimer) {
    globalThis.__salesRiskAlertTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => runRiskAlerts(pool, sendOpsAlert))
        .catch((e) => log.warn({ msg: 'sales_ai_risk_alert_run_failed', err: e?.message || e }));
    }, 60 * 60 * 1000);
  }

  if (!globalThis.__salesSlaTimer) {
    globalThis.__salesSlaTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runSalesSlaScan(pool, sendOpsAlert)).catch((e) => log.warn({ msg: 'sales_ai_sla_scan_failed', err: e?.message || e }));
    }, 5 * 60 * 1000);
  }

  if (!globalThis.__salesDeployCheckSlaTimer) {
    globalThis.__salesDeployCheckSlaTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runDeployCheckSlaScan(pool, sendOpsAlert)).catch((e) => log.warn({ msg: 'sales_ai_deploy_check_sla_scan_failed', err: e?.message || e }));
    }, 30 * 60 * 1000);
  }

  if (!globalThis.__salesHealthCheckPeriodTimer) {
    globalThis.__salesHealthCheckPeriodTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runHealthCheckPeriodScan(pool, sendOpsAlert)).catch((e) => log.warn({ msg: 'sales_ai_health_check_period_scan_failed', err: e?.message || e }));
    }, 60 * 60 * 1000);
  }

  if (!globalThis.__salesProvisioningRetryTimer) {
    globalThis.__salesProvisioningRetryTimer = setInterval(() => {
      ensureSalesTables(pool).then(() => runProvisioningRetryScan(pool, sendOpsAlert)).catch((e) => log.warn({ msg: 'sales_ai_provisioning_retry_scan_failed', err: e?.message || e }));
    }, 5 * 60 * 1000);
  }

  if (!globalThis.__salesNurtureCadenceTimer) {
    globalThis.__salesNurtureCadenceTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => runNurtureCadence(pool))
        .catch((e) => log.warn({ msg: 'sales_ai_nurture_cadence_run_failed', err: e?.message || e }));
    }, 60 * 60 * 1000);
  }

  if (!globalThis.__salesCreditRiskTimer) {
    globalThis.__salesCreditRiskTimer = setInterval(() => {
      scanCreditRisks(pool, sendOpsAlert).catch((e) => log.warn({ msg: 'sales_ai_credit_risk_scan_failed', err: e?.message || e }));
    }, 30 * 60 * 1000);
  }

  if (!globalThis.__salesCsTaskSyncTimer) {
    globalThis.__salesCsTaskSyncTimer = setInterval(() => {
      ensureSalesTables(pool)
        .then(() => syncCustomerSuccessTasks(pool))
        .catch((e) => log.warn({ msg: 'sales_ai_cs_task_sync_failed', err: e?.message || e }));
    }, 6 * 60 * 60 * 1000);
  }

  if (!globalThis.__salesRenewalBillReminderTimer) {
    globalThis.__salesRenewalBillReminderTimer = setInterval(() => {
      runRenewalBillReminders15d(pool, sendOpsAlert).catch((e) => log.warn({ msg: 'sales_ai_renewal_bill_reminder_failed', err: e?.message || e }));
    }, 6 * 60 * 60 * 1000);
  }

  if (!globalThis.__salesInvoiceReminderTimer) {
    let lastInvoiceReminderSentDate = null;
    globalThis.__salesInvoiceReminderTimer = setInterval(() => {
      const period = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      if (lastInvoiceReminderSentDate === period) return;
      pool.query(`SELECT i.*,c.contract_no,l.company,l.name FROM sales_invoices i JOIN sales_contracts c ON c.id=i.contract_id JOIN sales_leads l ON l.id=c.lead_id WHERE i.status='requested' ORDER BY i.created_at ASC`)
        .then((r) => {
          const items = r.rows || [];
          if (!items.length || typeof sendOpsAlert !== 'function') return;
          lastInvoiceReminderSentDate = period;
          return sendOpsAlert(
            ['【待开票提醒】', ...items.map((i) => `· ${i.company || i.name || `客户#${i.lead_id}`}：${i.contract_no || ''} 待开票 ¥${(Number(i.amount_fen) / 100).toFixed(2)}`)].join('\n'),
            { title: '待开票提醒', audience: 'sales' }
          );
        })
        .catch((e) => log.warn({ msg: 'sales_ai_invoice_reminder_failed', err: e?.message || e }));
    }, 6 * 60 * 60 * 1000);
  }

  if (!globalThis.__salesTrialValidationTimer) {
    globalThis.__salesTrialValidationTimer = setInterval(() => {
      runTrialValidations(pool, { limit: 10 })
        .then((rows) => {
          const bad = (rows || []).filter((r) => r.report?.status === 'no_data');
          if (bad.length && typeof sendOpsAlert === 'function') {
            return sendOpsAlert(
              ['【销售AI·试跑无数据】', ...bad.map((b) => `· ${b.company || b.lead_id}：${b.report?.summary || ''}`)].join('\n'),
              { title: '试跑数据告警', audience: 'sales' }
            );
          }
        })
        .catch((e) => log.warn({ msg: 'sales_ai_trial_validation_failed', err: e?.message || e }));
    }, 6 * 60 * 60 * 1000);
  }

  scheduleDailyAt(pool, sendOpsAlert, '__salesDailyReportTimer', 9, 0, async () => {
    const report = await buildBossDailyReport(pool);
    if (typeof sendOpsAlert === 'function') {
      await sendOpsAlert(report.text, { title: '销售AI日报', audience: 'sales' });
    }
  }, 'sales_ai_daily_report_send_failed');

  scheduleDailyAt(pool, sendOpsAlert, '__salesRepActivityRollupTimer', 0, 30, () => runDailyActivityRollup(pool, {}), 'sales_ai_rep_activity_rollup_failed');

  scheduleWeeklyKpi(pool, sendOpsAlert, '__salesWeeklyKpiTimer', 'week');
  scheduleWeeklyKpi(pool, sendOpsAlert, '__salesMonthlyKpiTimer', 'month');

  if (!globalThis.__salesKfSyncTimer) {
    globalThis.__salesKfSyncTimer = setInterval(() => {
      if (!kfConfigured()) return;
      const env = kfEnv();
      processKfCallbackEvent(pool, { token: '', openKfid: env.openKfid }, (payload) => handleInboundMessage(pool, payload), { notify: sendOpsAlert })
        .catch((e) => log.warn({ msg: 'sales_ai_kf_compensating_sync_failed', err: e?.message || e }));
    }, 5 * 60 * 1000);
  }
}
