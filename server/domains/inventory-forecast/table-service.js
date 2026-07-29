/**
 * inventoryForecast* 表读写 + hydrate（Tier 2）。
 * 写入路径：state-upsert 在更新内存 state 后同步 upsert 行；读路径：getSharedState hydrate。
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'inventory-forecast', handler: 'table-service' });

const HISTORY_TABLE = 'inventory_forecast_history';
const PREDICTIONS_TABLE = 'inventory_forecast_predictions';
const EVALUATIONS_TABLE = 'inventory_forecast_evaluations';

async function loadForecastRows(pool, table, tenantId, limit = 6000) {
  const tid = String(tenantId || 'default');
  const lim = Math.min(10000, Math.max(1, Number(limit) || 6000));
  const r = await pool.query(
    `SELECT payload FROM ${table}
      WHERE tenant_id = $1
      ORDER BY forecast_date DESC, updated_at DESC
      LIMIT $2`,
    [tid, lim]
  );
  return (r.rows || [])
    .map((row) => (row.payload && typeof row.payload === 'object' ? row.payload : null))
    .filter(Boolean);
}

export async function hydrateInventoryForecastFromTables(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  const tid = String(tenantId || 'default');
  try {
    const [history, predictions, evaluations] = await Promise.all([
      loadForecastRows(pool, HISTORY_TABLE, tid),
      loadForecastRows(pool, PREDICTIONS_TABLE, tid),
      loadForecastRows(pool, EVALUATIONS_TABLE, tid),
    ]);
    if (history.length) base.inventoryForecastHistory = history;
    if (predictions.length) base.inventoryForecastPredictions = predictions;
    if (evaluations.length) base.inventoryForecastEvaluations = evaluations;
  } catch (e) {
    log.error({ msg: 'inventory_forecast_hydrate_failed', err: e?.message || String(e) });
  }
  return base;
}

export async function upsertInventoryForecastRow(pool, table, tenantId, item) {
  if (!item || typeof item !== 'object') return;
  const tid = String(tenantId || 'default');
  const id = String(item.id || '').trim();
  const store = String(item.store || '').trim();
  const bizType = String(item.bizType || '').trim();
  const slot = String(item.slot || '').trim();
  const date = String(item.date || '').trim();
  if (!id || !store || !date) return;
  await pool.query(
    `INSERT INTO ${table}
       (id, tenant_id, store, biz_type, slot, forecast_date, payload, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::jsonb,NOW())
     ON CONFLICT (tenant_id, store, biz_type, slot, forecast_date)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [id, tid, store, bizType, slot, date, JSON.stringify(item)]
  );
}

export async function syncInventoryForecastStateToTables(pool, tenantId, state) {
  const tid = String(tenantId || 'default');
  const history = Array.isArray(state?.inventoryForecastHistory) ? state.inventoryForecastHistory : [];
  const predictions = Array.isArray(state?.inventoryForecastPredictions) ? state.inventoryForecastPredictions : [];
  const evaluations = Array.isArray(state?.inventoryForecastEvaluations) ? state.inventoryForecastEvaluations : [];
  for (const item of history) {
    await upsertInventoryForecastRow(pool, HISTORY_TABLE, tid, item);
  }
  for (const item of predictions) {
    await upsertInventoryForecastRow(pool, PREDICTIONS_TABLE, tid, item);
  }
  for (const item of evaluations) {
    await upsertInventoryForecastRow(pool, EVALUATIONS_TABLE, tid, item);
  }
}
