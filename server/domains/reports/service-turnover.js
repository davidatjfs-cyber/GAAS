/**
 * Turnover analysis report — pure logic (no req/res).
 */
import { mergeTurnoverStoreEmployees } from './turnover-employees.js';
import { computeTurnoverReportPayload } from './turnover-metrics.js';

/**
 * @param {object} ctx
 * @param {object} opts
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function getTurnoverReportPayload(ctx, {
  month,
  storeQ,
  role,
  username,
  tenantId,
  allowedStores,
  currentStore,
}) {
  const { getSharedState, pickMyStoreFromState } = ctx;

  if (!month || !/^\d{4}-\d{2}$/.test(String(month).trim())) {
    return { ok: false, status: 400, error: 'missing_month' };
  }

  try {
    const state0 = (await getSharedState()) || {};
    const myStore = pickMyStoreFromState(state0, username);
    const allowed = Array.isArray(allowedStores) ? allowedStores : [];
    const curStore = String(currentStore || '').trim();
    const store = role === 'store_manager'
      ? (storeQ && allowed.includes(storeQ) ? storeQ : (curStore || myStore))
      : storeQ;

    const [yr, mo] = month.split('-').map(Number);
    const { storeEmps, empByLower, offDeparted } = await mergeTurnoverStoreEmployees(ctx, {
      state0,
      store,
      month,
      tenantId,
    });

    const payload = computeTurnoverReportPayload({
      month,
      store,
      storeEmps,
      empByLower,
      offDeparted,
      yr,
      mo,
    });

    return { ok: true, payload };
  } catch (_) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
