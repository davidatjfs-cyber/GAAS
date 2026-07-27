import { randomUUID } from 'crypto';

export async function listCoreProducts(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const myStore = ctx.pickMyStoreFromState(state0, username);
    const qStore = String(input.query?.store || '').trim();
    const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
    if (!store) return { ok: false, status: 400, error: 'missing_store' };

    const all = Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts : [];
    const items = all.filter((x) => String(x?.store || '').trim() === store);
    return { ok: true, store, items };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function createCoreProduct(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  const product = String(input.body?.product || '').trim();
  const targetQty = Number(input.body?.targetQty || 0);
  if (!product) return { ok: false, status: 400, error: 'missing_product' };
  if (!Number.isFinite(targetQty) || targetQty <= 0) return { ok: false, status: 400, error: 'invalid_target_qty' };

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const myStore = ctx.pickMyStoreFromState(state0, username);
    const qStore = String(input.body?.store || '').trim();
    const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
    if (!store) return { ok: false, status: 400, error: 'missing_store' };

    const all = Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts.slice() : [];
    const key = `${store}||${product}`;
    const keyOf = (x) => `${String(x?.store || '').trim()}||${String(x?.product || '').trim()}`;
    const idx = all.findIndex((x) => keyOf(x) === key);
    const now = ctx.hrmsNowISO();
    const item = {
      id: idx >= 0 ? (all[idx]?.id || randomUUID()) : randomUUID(),
      store,
      product,
      targetQty: Number(targetQty.toFixed(1)),
      createdAt: idx >= 0 ? (all[idx]?.createdAt || now) : now,
      createdBy: idx >= 0 ? (all[idx]?.createdBy || username) : username,
      updatedAt: now,
      updatedBy: username,
    };
    if (idx >= 0) all.splice(idx, 1, item);
    else all.unshift(item);

    await ctx.saveSharedState({ ...state0, forecastCoreProducts: all.slice(0, 2000) });
    return { ok: true, item };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function deleteCoreProduct(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  const id = String(input.params?.id || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const all = Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts.slice() : [];
    const idx = all.findIndex((x) => String(x?.id || '').trim() === id);
    if (idx < 0) return { ok: false, status: 404, error: 'not_found' };
    all.splice(idx, 1);
    await ctx.saveSharedState({ ...state0, forecastCoreProducts: all });
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
