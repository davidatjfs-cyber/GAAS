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

export function registerInventoryForecastAliasRoutes(app, deps) {
  const { authRequired, upload, ...rest } = deps;
  const ctx = { ...rest };

  app.get('/api/reports/sales-raw/dish-aliases', authRequired, async (req, res) => {
    const result = await listDishAliases(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/reports/sales-raw/dish-aliases', authRequired, async (req, res) => {
    const result = await createDishAlias(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.put('/api/reports/sales-raw/dish-aliases/:id', authRequired, async (req, res) => {
    const result = await updateDishAlias(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.delete('/api/reports/sales-raw/dish-aliases/:id', authRequired, async (req, res) => {
    const result = await deleteDishAlias(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.get('/api/reports/inventory-forecast/core-products', authRequired, async (req, res) => {
    const result = await listCoreProducts(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/reports/inventory-forecast/core-products', authRequired, async (req, res) => {
    const result = await createCoreProduct(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.delete('/api/reports/inventory-forecast/core-products/:id', authRequired, async (req, res) => {
    const result = await deleteCoreProduct(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.get('/api/reports/inventory-forecast/product-aliases', authRequired, async (req, res) => {
    const result = await listProductAliases(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/reports/inventory-forecast/product-aliases', authRequired, async (req, res) => {
    const result = await createProductAlias(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.put('/api/reports/inventory-forecast/product-aliases/:id', authRequired, async (req, res) => {
    const result = await updateProductAlias(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.delete('/api/reports/inventory-forecast/product-aliases/:id', authRequired, async (req, res) => {
    const result = await deleteProductAlias(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });
}
