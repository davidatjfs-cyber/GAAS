/**
 * Payroll report / audit / adjustment — pure logic (no req/res).
 */
import { childLogger } from '../../utils/logger.js';
import { buildPayrollPeopleMaps } from './payroll-people.js';
import { tryClosedLoopPayrollPayload } from './payroll-closed-loop.js';
import { buildLegacyPayrollPayload } from './payroll-legacy-rows.js';

const log = childLogger({ domain: 'reports', handler: 'payroll' });

/**
 * @param {object} ctx
 * @param {object} opts
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function getPayrollReportPayload(ctx, {
  month,
  storeQ,
  role,
  username,
  tenantId,
  allowedStores,
  currentStore,
}) {
  const { getSharedState, pickMyStoreFromState } = ctx;

  if (!month) return { ok: false, status: 400, error: 'missing_month' };

  try {
    const state0 = (await getSharedState()) || {};
    const myStore = pickMyStoreFromState(state0, username);
    const allowed = Array.isArray(allowedStores) ? allowedStores : [];
    const curStore = String(currentStore || '').trim();
    const store = role === 'store_manager'
      ? (storeQ && allowed.includes(storeQ) ? storeQ : (curStore || myStore))
      : storeQ;

    const {
      peopleByLower,
      people,
      allPeople,
      knownUsers,
      canonicalUsernameByLower,
    } = await buildPayrollPeopleMaps(ctx, state0, store, tenantId);

    const closedLoop = await tryClosedLoopPayrollPayload(ctx, {
      month,
      store,
      state0,
      peopleByLower,
      people,
      tenantId,
    });
    if (closedLoop) return closedLoop;

    return buildLegacyPayrollPayload(ctx, {
      month,
      store,
      state0,
      peopleByLower,
      allPeople,
      knownUsers,
      canonicalUsernameByLower,
      tenantId,
    });
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * @returns {Promise<{ ok: true, audit: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function auditPayrollMonth(ctx, { month, store, username, audited }) {
  const { getSharedState, mergeSharedStateFields, hrmsNowISO } = ctx;
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!month) return { ok: false, status: 400, error: 'missing_month' };

  try {
    const state0 = (await getSharedState()) || {};
    const storeKey = String(store || '').trim();
    const auditKey = `${month}||${storeKey || 'ALL'}`;
    const auditMap = state0?.payrollAudits && typeof state0.payrollAudits === 'object' ? { ...state0.payrollAudits } : {};
    auditMap[auditKey] = {
      month,
      store: storeKey || '',
      audited: !!audited,
      auditedBy: username,
      auditedAt: hrmsNowISO(),
    };
    await mergeSharedStateFields({ payrollAudits: auditMap });
    return { ok: true, audit: auditMap[auditKey] };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * @returns {Promise<{ ok: true, item: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function adjustPayrollRow(ctx, {
  month,
  store,
  targetUsername,
  subsidy,
  baseAmount,
  reason,
  username,
  tenantId,
}) {
  const { getSharedState, mergeSharedStateFields, hrmsNowISO, safeNumber } = ctx;
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!month) return { ok: false, status: 400, error: 'missing_month' };
  const target = String(targetUsername || '').trim();
  if (!target) return { ok: false, status: 400, error: 'missing_username' };

  const subsidyNum = safeNumber(subsidy);
  const baseAmountNum = safeNumber(baseAmount);
  if (subsidyNum == null && baseAmountNum == null) {
    return { ok: false, status: 400, error: 'missing_adjustment' };
  }

  try {
    const state0 = (await getSharedState()) || {};
    const storeKey = String(store || '').trim();
    const key = `${month}||${storeKey || 'ALL'}||${target.toLowerCase()}`;
    const existing = state0?.payrollAdjustments?.[key] && typeof state0.payrollAdjustments[key] === 'object'
      ? state0.payrollAdjustments[key]
      : {};
    const item = {
      ...existing,
      month,
      store: storeKey || '',
      username: target,
      ...(subsidyNum != null ? { subsidy: subsidyNum } : {}),
      ...(baseAmountNum != null ? { baseAmount: baseAmountNum } : {}),
      updatedBy: username,
      updatedAt: hrmsNowISO(),
    };
    await mergeSharedStateFields({ payrollAdjustments: { [key]: item } });
    if (subsidyNum != null) {
      try {
        const upsert = ctx.upsertPayrollLedgerEntry
          || (await import('../../services/hrms-payroll-engine.js')).upsertPayrollLedgerEntry;
        await upsert({
          tenantId: tenantId || 'default',
          username: target,
          store: storeKey,
          bizMonth: month,
          entryType: 'manual_subsidy',
          amount: subsidyNum,
          title: '人工补贴',
          reason: String(reason || '').trim() || '高温/调店等临时费用',
          sourceRef: key,
          createdBy: username,
        });
      } catch (e) {
        log.warn({ msg: 'payroll_adjustment_ledger_write_failed', err: e?.message || String(e) });
      }
    }
    return { ok: true, item };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
