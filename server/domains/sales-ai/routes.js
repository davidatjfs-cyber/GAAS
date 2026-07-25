/**
 * 销售 AI 路由入口：组合子模块 + 定时任务
 */
import { ensureSalesTables } from '../../services/sales/sales-store.js';
import { getLead } from '../../services/sales/sales-store.js';
import { handleInboundMessage, setSalesNotify } from '../../services/sales/sales-session.js';
import { setSalesCustomerAiLlm } from '../../services/sales/sales-customer-ai.js';
import { setSalesReplyDraftLlm } from '../../services/sales/sales-reply-draft.js';
import { setSalesProposalLlm } from '../../services/sales/sales-proposal.js';
import { setSalesAssistantLlm } from '../../services/sales/sales-internal-assistant.js';
import { refreshSalesPermissionConfigCache } from '../../services/sales/sales-permission-config.js';
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
import { canAccessLead } from '../../services/sales/sales-permissions.js';
import { remindStaleHighIntentLeads, runRiskAlerts } from './service.js';
import { createSalesAiGates } from './gates.js';
import { registerSalesAiKfRoutes } from './routes-kf.js';
import { registerSalesAiAdminMetaRoutes } from './routes-admin-meta.js';
import { registerSalesAiFinanceRoutes } from './routes-finance.js';
import { registerSalesAiLeadsRoutes } from './routes-leads.js';
import { registerSalesAiOpsRoutes } from './routes-ops.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes' });


export function registerSalesAiRoutes(app, pool, platformAdminRequired, { callLLM, sendOpsAlert, requireSalesManagerOrAbove, upload } = {}) {
  const gates = createSalesAiGates(pool, requireSalesManagerOrAbove);
  const ctx = { app, pool, platformAdminRequired, gates, callLLM, sendOpsAlert, upload };

  if (typeof callLLM === 'function') {
    setSalesCustomerAiLlm(callLLM);
    setSalesReplyDraftLlm(callLLM);
    setSalesProposalLlm(callLLM);
    setSalesAssistantLlm(callLLM);
  }
  if (typeof sendOpsAlert === 'function') setSalesNotify(sendOpsAlert);

  refreshSalesPermissionConfigCache(pool).catch((e) => log.warn({ msg: 'sales_ai_permission_config_warm_up_failed', err: e?.message || e }));

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

  if (!globalThis.__salesDailyReportTimer) {
    const scheduleSalesDailyReport = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(9, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      globalThis.__salesDailyReportTimer = setTimeout(async () => {
        try {
          const report = await buildBossDailyReport(pool);
          if (typeof sendOpsAlert === 'function') {
            await sendOpsAlert(report.text, { title: '销售AI日报', audience: 'sales' });
          }
        } catch (e) {
          log.warn({ msg: 'sales_ai_daily_report_send_failed', err: e?.message || e });
        }
        scheduleSalesDailyReport();
      }, next - now);
    };
    scheduleSalesDailyReport();
  }

  if (!globalThis.__salesRepActivityRollupTimer) {
    const scheduleSalesRepActivityRollup = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(0, 30, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      globalThis.__salesRepActivityRollupTimer = setTimeout(async () => {
        try {
          await runDailyActivityRollup(pool, {});
        } catch (e) {
          log.warn({ msg: 'sales_ai_rep_activity_rollup_failed', err: e?.message || e });
        }
        scheduleSalesRepActivityRollup();
      }, next - now);
    };
    scheduleSalesRepActivityRollup();
  }

  // 所有以 /leads/:id 为目标的接口统一做记录级归属校验，避免某个新增路由忘记加权限。
  app.use('/api/admin/sales/leads/:id', platformAdminRequired, async (req, res, next) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      req.salesLead = lead;
      next();
    } catch (e) { log.error({ msg: 'sales_lead_scope_check_failed', err: e?.message || e }); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  // P3：每周一 08:00 自动结算上一周KPI；每月1号 08:15 自动结算上个月KPI（都不含主管主观分，
  // 主管后续用 kpi-scores 接口补分即可覆盖更新）。
  if (!globalThis.__salesWeeklyKpiTimer) {
    const scheduleWeeklyKpi = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(8, 0, 0, 0);
      const dayOfWeek = next.getDay() || 7; // 周一=1...周日=7
      let daysUntilMonday = (1 - dayOfWeek + 7) % 7;
      if (daysUntilMonday === 0 && next <= now) daysUntilMonday = 7;
      next.setDate(next.getDate() + daysUntilMonday);
      globalThis.__salesWeeklyKpiTimer = setTimeout(async () => {
        try {
          await runAutoKpiRollupAndNotify(pool, sendOpsAlert, 'week');
        } catch (e) {
          log.warn({ msg: 'sales_ai_weekly_kpi_rollup_failed', err: e?.message || e });
        }
        scheduleWeeklyKpi();
      }, next - now);
    };
    scheduleWeeklyKpi();
  }

  if (!globalThis.__salesMonthlyKpiTimer) {
    const scheduleMonthlyKpi = () => {
      const now = new Date();
      let next = new Date(now.getFullYear(), now.getMonth(), 1, 8, 15, 0, 0);
      if (next <= now) next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 8, 15, 0, 0);
      globalThis.__salesMonthlyKpiTimer = setTimeout(async () => {
        try {
          await runAutoKpiRollupAndNotify(pool, sendOpsAlert, 'month');
        } catch (e) {
          log.warn({ msg: 'sales_ai_monthly_kpi_rollup_failed', err: e?.message || e });
        }
        scheduleMonthlyKpi();
      }, next - now);
    };
    scheduleMonthlyKpi();
  }

  if (!globalThis.__salesKfSyncTimer) {
    globalThis.__salesKfSyncTimer = setInterval(() => {
      if (!kfConfigured()) return;
      const env = kfEnv();
      processKfCallbackEvent(pool, { token: '', openKfid: env.openKfid }, (payload) => handleInboundMessage(pool, payload), { notify: sendOpsAlert })
        .catch((e) => log.warn({ msg: 'sales_ai_kf_compensating_sync_failed', err: e?.message || e }));
    }, 5 * 60 * 1000);
  }


  // 所有以 /leads/:id 为目标的接口统一做记录级归属校验，避免某个新增路由忘记加权限。
  app.use('/api/admin/sales/leads/:id', platformAdminRequired, async (req, res, next) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      req.salesLead = lead;
      next();
    } catch (e) { log.error({ msg: 'sales_lead_scope_check_failed', err: e?.message || e }); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  if (!globalThis.__salesWeeklyKpiTimer) {
    const scheduleWeeklyKpi = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(8, 0, 0, 0);
      const dayOfWeek = next.getDay() || 7; // 周一=1...周日=7
      let daysUntilMonday = (1 - dayOfWeek + 7) % 7;
      if (daysUntilMonday === 0 && next <= now) daysUntilMonday = 7;
      next.setDate(next.getDate() + daysUntilMonday);
      globalThis.__salesWeeklyKpiTimer = setTimeout(async () => {
        try {
          await runAutoKpiRollupAndNotify(pool, sendOpsAlert, 'week');
        } catch (e) {
          log.warn({ msg: 'sales_ai_weekly_kpi_rollup_failed', err: e?.message || e });
        }
        scheduleWeeklyKpi();
      }, next - now);
    };
    scheduleWeeklyKpi();
  }

  if (!globalThis.__salesMonthlyKpiTimer) {
    const scheduleMonthlyKpi = () => {
      const now = new Date();
      let next = new Date(now.getFullYear(), now.getMonth(), 1, 8, 15, 0, 0);
      if (next <= now) next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 8, 15, 0, 0);
      globalThis.__salesMonthlyKpiTimer = setTimeout(async () => {
        try {
          await runAutoKpiRollupAndNotify(pool, sendOpsAlert, 'month');
        } catch (e) {
          log.warn({ msg: 'sales_ai_monthly_kpi_rollup_failed', err: e?.message || e });
        }
        scheduleMonthlyKpi();
      }, next - now);
    };
    scheduleMonthlyKpi();
  }

  registerSalesAiKfRoutes(ctx);
  registerSalesAiAdminMetaRoutes(ctx);
  registerSalesAiFinanceRoutes(ctx);
  registerSalesAiLeadsRoutes(ctx);
  registerSalesAiOpsRoutes(ctx);
}
