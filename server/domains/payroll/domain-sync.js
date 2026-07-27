/**
 * Dual-write hrms_state payroll / leave JSON blobs into domain tables.
 * No DDL here — ensureLeaveDomainTable lives in services/hrms-core-schema-ensure.js.
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'payroll', handler: 'domain-sync' });

export function createPayrollLeaveDomainSyncHelpers({
  pool,
  resolveTenantIdDefault,
  getSharedState,
  notifyAdminsDualWriteFailure,
}) {
  async function upsertPayrollDomainFromState(state) {
    if (!state || typeof state !== 'object') return;
    const tid = resolveTenantIdDefault();
    const pa =
      state.payrollAdjustments && typeof state.payrollAdjustments === 'object'
        ? state.payrollAdjustments
        : {};
    const pau =
      state.payrollAudits && typeof state.payrollAudits === 'object' ? state.payrollAudits : {};
    const sa = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [];
    const mc = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];
    await pool.query(
      `INSERT INTO hrms_payroll_domain (id, tenant_id, payroll_adjustments, payroll_audits, salary_adjustments, monthly_confirmations, updated_at)
       VALUES ($1::text, $1::varchar(80), $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         payroll_adjustments = EXCLUDED.payroll_adjustments,
         payroll_audits = EXCLUDED.payroll_audits,
         salary_adjustments = EXCLUDED.salary_adjustments,
         monthly_confirmations = EXCLUDED.monthly_confirmations,
         updated_at = NOW()`,
      [tid, JSON.stringify(pa), JSON.stringify(pau), JSON.stringify(sa), JSON.stringify(mc)]
    );
  }

  async function upsertLeaveDomainFromState(state) {
    if (!state || typeof state !== 'object') return;
    const tid = resolveTenantIdDefault();
    const overrides =
      state.leaveBalanceOverrides && typeof state.leaveBalanceOverrides === 'object'
        ? state.leaveBalanceOverrides
        : {};
    const adjustments = Array.isArray(state.leaveBalanceAdjustments)
      ? state.leaveBalanceAdjustments
      : [];
    const snapshots =
      state.leaveCumulativeCloseSnapshots && typeof state.leaveCumulativeCloseSnapshots === 'object'
        ? state.leaveCumulativeCloseSnapshots
        : {};
    await pool.query(
      `INSERT INTO hrms_leave_domain (
         id, tenant_id, leave_balance_overrides, leave_balance_adjustments, leave_cumulative_close_snapshots, updated_at
       )
       VALUES ($1::text, $1::varchar(80), $2::jsonb, $3::jsonb, $4::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         leave_balance_overrides = EXCLUDED.leave_balance_overrides,
         leave_balance_adjustments = EXCLUDED.leave_balance_adjustments,
         leave_cumulative_close_snapshots = EXCLUDED.leave_cumulative_close_snapshots,
         updated_at = NOW()`,
      [tid, JSON.stringify(overrides), JSON.stringify(adjustments), JSON.stringify(snapshots)]
    );
  }

  function schedulePayrollDomainSync() {
    setImmediate(async () => {
      try {
        const s = await getSharedState();
        await upsertPayrollDomainFromState(s);
      } catch (e) {
        log.error({ msg: 'hrms_payroll_domain_async_sync_failed_non_fatal', err: e?.message });
        void notifyAdminsDualWriteFailure('hrms_payroll_domain（异步薪资域双写）', e);
      }
    });
  }

  function scheduleLeaveDomainSync() {
    setImmediate(async () => {
      try {
        const s = await getSharedState();
        await upsertLeaveDomainFromState(s);
      } catch (e) {
        log.error({ msg: 'hrms_leave_domain_async_sync_failed_non_fatal', err: e?.message });
        void notifyAdminsDualWriteFailure('hrms_leave_domain（异步欠休域双写）', e);
      }
    });
  }

  return {
    upsertPayrollDomainFromState,
    upsertLeaveDomainFromState,
    schedulePayrollDomainSync,
    scheduleLeaveDomainSync,
  };
}
