/**
 * Inventory forecast history CRUD + upload orchestration. Returns { ok, status?, error?, ...payload }.
 */
import { childLogger } from '../../utils/logger.js';
import { runUploadHistoryFile } from './upload-history-file-helpers.js';

const log = childLogger({ domain: 'inventory-forecast', handler: 'history-service' });

export async function listHistory(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  const bizType = ctx.normalizeForecastBizType(input.query?.bizType);
  const slot = ctx.normalizeForecastSlot(input.query?.slot);
  const start = ctx.safeDateOnly(input.query?.start);
  const end = ctx.safeDateOnly(input.query?.end);
  const qStore = String(input.query?.store || '').trim();
  const limit = Math.max(1, Math.min(1000, Number(input.query?.limit || 300) || 300));

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const myStore = ctx.pickMyStoreFromState(state0, username);
    const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
    if (!store) return { ok: false, status: 400, error: 'missing_store' };

    const today = new Date().toISOString().slice(0, 10);
    const salesRawItems = await ctx.loadInventoryForecastHistoryFromSalesRaw({
      storeScope: [store],
      bizType,
      slot,
      startDate: start || ctx.shiftForecastDate(end || today, -180),
      endDate: end || today
    });
    const items = salesRawItems.slice(0, limit);
    return { ok: true,
      store,
      bizType: bizType || '',
      slot: slot || '',
      storageSource: salesRawItems.length ? 'pos_sales_detail' : 'inventoryForecastHistory',
      items
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function clearHistory(ctx, input) {
  const role = String(input.role || '').trim();
  if (role !== 'admin') return { ok: false, status: 403, error: 'admin_only' };
  try {
    const state0 = (await ctx.getSharedState()) || {};
    const qStore = String(input.query?.store || input.body?.store || '').trim();
    const prevCount = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.length : 0;
    if (qStore) {
      state0.inventoryForecastHistory = (state0.inventoryForecastHistory || []).filter((x) => String(x?.store || '').trim() !== qStore);
      state0.inventoryForecastPredictions = (state0.inventoryForecastPredictions || []).filter((x) => String(x?.store || '').trim() !== qStore);
      state0.inventoryForecastEvaluations = (state0.inventoryForecastEvaluations || []).filter((x) => String(x?.store || '').trim() !== qStore);
    } else {
      state0.inventoryForecastHistory = [];
      state0.inventoryForecastPredictions = [];
      state0.inventoryForecastEvaluations = [];
    }
    await ctx.saveSharedState(state0);
    const afterCount = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.length : 0;
    // 严禁在此删除 sales_raw：无 store 参数时曾误执行 DELETE FROM sales_raw 全表，导致生产数据被清空。
    return { ok: true, cleared: prevCount - afterCount, remaining: afterCount, store: qStore || '(all)' };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function batchHistory(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  const bizType = ctx.normalizeForecastBizType(input.body?.bizType);
  const slot = ctx.normalizeForecastSlot(input.body?.slot);
  if (!bizType) return { ok: false, status: 400, error: 'invalid_biz_type' };
  if (!slot) return { ok: false, status: 400, error: 'invalid_slot' };
  const rowsRaw = Array.isArray(input.body?.rows) ? input.body.rows : [];
  if (!rowsRaw.length) return { ok: false, status: 400, error: 'missing_rows' };

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const myStore = ctx.pickMyStoreFromState(state0, username);
    const storeBody = String(input.body?.store || '').trim();
    const store = ctx.isForecastStoreScopedRole(role) ? myStore : storeBody;
    if (!store) return { ok: false, status: 400, error: 'missing_store' };
    const ret = ctx.upsertInventoryForecastHistoryInState(state0, { store, bizType, slot, rowsRaw, username });
    await ctx.saveSharedState(ret.state);

    return {
      ok: true,
      store,
      bizType,
      slot,
      inserted: ret.inserted,
      updated: ret.updated,
      skipped: ret.skipped,
      accepted: ret.accepted,
      evaluated: ret.evaluated
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function uploadHistoryFile(ctx, input) {
  return runUploadHistoryFile(ctx, input, { log, uploadsDir: ctx.uploadsDir });
}

export async function uploadHistoryImage(_ctx, _input) {
  return { ok: false, status: 410,
    error: 'image_upload_disabled',
    message: '图片上传功能已下线，请使用 Excel 或 PDF 上传历史数据。'
  };
}

export async function uploadSalesRaw(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };
  // sales_raw表已于2026-07-03下线，手工上传销售明细的流程被pos_order_items自动同步取代，
  // 不再需要人工上传。（文件清理由 routes finally 负责）
  return { ok: false, status: 410,
    error: 'sales_raw_retired',
    message: '销售明细已改为自动同步（pos_order_items/pos_sales_detail），不再需要手工上传销售明细文件。'
  };
}
