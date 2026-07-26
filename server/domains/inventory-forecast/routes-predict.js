/**
 * Inventory forecast HTTP routes — thin handlers.
 * Business logic lives in service.js; multer upload stays here.
 */
import fs from 'fs';
import {
  listHistory,
  clearHistory,
  batchHistory,
  uploadHistoryFile,
  uploadHistoryImage,
  uploadSalesRaw,
  listDishAliases,
  createDishAlias,
  updateDishAlias,
  deleteDishAlias,
  listCoreProducts,
  createCoreProduct,
  deleteCoreProduct,
  listProductAliases,
  createProductAlias,
  updateProductAlias,
  deleteProductAlias,
  getCoreProductSales,
  getAnalytics,
  estimateRevenue,
  listGrossProfitProfiles,
  upsertGrossProfitProfiles,
  updateGrossProfitProfile,
  deleteGrossProfitProfile,
  estimateGrossMargin,
  getAccuracy,
  predictForecast
} from './service.js';

function sendFail(res, result) {
  const { ok: _ok, status, ...body } = result;
  return res.status(status || 500).json(body);
}

/** Strip internal ok/status. Pass keepOk for endpoints that originally returned { ok: true, ... }. */
function sendOk(res, result, { keepOk = false } = {}) {
  const { ok: _ok, status: _status, ...body } = result;
  if (keepOk) return res.json({ ok: true, ...body });
  return res.json(body);
}

export function registerInventoryForecastPredictRoutes(app, deps) {
  const { authRequired, upload, ...rest } = deps;
  const ctx = { ...rest };

  app.get('/api/reports/inventory-forecast/accuracy', authRequired, async (req, res) => {
    const result = await getAccuracy(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/reports/inventory-forecast/predict', authRequired, async (req, res) => {
    const result = await predictForecast(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });
}
