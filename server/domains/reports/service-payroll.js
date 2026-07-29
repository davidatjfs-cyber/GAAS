/**
 * Payroll report / audit / adjustment — pure logic (no req/res).
 */
import { childLogger } from '../../utils/logger.js';
import { buildPayrollPeopleMaps } from './payroll-people.js';
import { tryClosedLoopPayrollPayload } from './payroll-closed-loop.js';
import { buildLegacyPayrollPayload } from './payroll-legacy-rows.js';
import { loadPayrollDomainFromTable, upsertPayrollDomain } from '../payroll/service.js';

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
export async function auditPayrollMonth(ctx, { month, store, username, audited, tenantId }) {
  const { pool, hrmsNowISO, invalidateSharedStateCache } = ctx;
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!month) return { ok: false, status: 400, error: 'missing_month' };

  try {
    const tid = tenantId || 'default';
    const storeKey = String(store || '').trim();
    const auditKey = `${month}||${storeKey || 'ALL'}`;
    const audit = {
      month,
      store: storeKey || '',
      audited: !!audited,
      auditedBy: username,
      auditedAt: hrmsNowISO(),
    };
    // 只 patch 这一个 auditKey；upsertPayrollDomain 会在加锁后跟表里当前值合并，
    // 不会把并发写入的其它门店/月份审计记录冲掉。
    await upsertPayrollDomain(pool, tid, { payrollAudits: { [auditKey]: audit } });
    if (typeof invalidateSharedStateCache === 'function') invalidateSharedStateCache(tid);
    return { ok: true, audit };
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
  const { pool, hrmsNowISO, safeNumber, invalidateSharedStateCache } = ctx;
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
    const tid = tenantId || 'default';
    const storeKey = String(store || '').trim();
    const key = `${month}||${storeKey || 'ALL'}||${target.toLowerCase()}`;
    // 只需要读这一个 key 的旧值（用于保留没在这次调用里更新的 subsidy/baseAmount 字段），
    // 不需要整域快照——upsertPayrollDomain 会在加锁后用当前表值合并，不会覆盖其它 key。
    const domain = await loadPayrollDomainFromTable(pool, tid);
    const existing = domain?.payrollAdjustments?.[key] && typeof domain.payrollAdjustments[key] === 'object'
      ? domain.payrollAdjustments[key]
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
    await upsertPayrollDomain(pool, tid, { payrollAdjustments: { [key]: item } });
    if (typeof invalidateSharedStateCache === 'function') invalidateSharedStateCache(tid);
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
