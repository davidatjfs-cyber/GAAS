import { tenantContext } from '../../utils/database.js';
import { authPhaseApi, cleanText } from '../growth-phase-auth.js';
import {
  generateWeeklyContentSuggestion,
  listContentPerformance,
  listContentSuggestions,
  pushWeeklySuggestionToFeishu,
  safeDateOnly,
  upsertContentPerformance,
  upsertContentPerformanceV2,
} from './service.js';

function todayShanghaiYmd() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

/**
 * @param {import('express').Express} app
 * @param {{ pool: any, requirePhaseAuth: Function, getPhaseTenantId: Function }} deps
 */
export function registerGrowthContentRoutes(app, deps) {
  const { pool, getPhaseTenantId } = deps;

  app.get('/api/growth/content-suggestions', async (req, res) => {
    if (!authPhaseApi(req).ok) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const suggestions = await listContentSuggestions(pool, getPhaseTenantId(req), {
        storeCode: req.query.store_code,
        weekStart: req.query.week_start,
        limit: req.query.limit,
      });
      return res.json({ ok: true, suggestions });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/content-suggestions/generate', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'unauthorized' });
    const storeCode = cleanText(req.body?.store_code || req.query?.store_code || '51866138', 128);
    const weekStart = safeDateOnly(req.body?.week_start || req.query?.week_start || todayShanghaiYmd());
    const tenantId = getPhaseTenantId(req);
    try {
      const { suggestion, pushed } = await tenantContext.run(tenantId, async () => {
        const suggestion = await generateWeeklyContentSuggestion(
          pool,
          storeCode,
          weekStart,
          auth.user?.username || 'system',
          tenantId
        );
        const pushed = await pushWeeklySuggestionToFeishu(pool, suggestion).catch(() => ({ pushed: 0 }));
        return { suggestion, pushed };
      });
      return res.json({ ok: true, suggestion, pushed });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/content-performance', async (req, res) => {
    if (!authPhaseApi(req).ok) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const items = await listContentPerformance(pool, {
        storeCode: req.query.store_code,
        channel: req.query.channel,
      });
      return res.json({ ok: true, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/content-performance', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'unauthorized' });
    try {
      const perf = await tenantContext.run(getPhaseTenantId(req), () =>
        upsertContentPerformance(pool, getPhaseTenantId(req), req.body || {}, auth.user?.username || 'system')
      );
      return res.json({ ok: true, item: perf });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/content-performance-v2', async (req, res) => {
    if (!authPhaseApi(req).ok) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      const items = await listContentPerformance(pool, {
        storeCode: req.query.store_code,
        channel: req.query.channel,
      });
      return res.json({ ok: true, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/content-performance-v2', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'unauthorized' });
    try {
      const perf = await tenantContext.run(getPhaseTenantId(req), () =>
        upsertContentPerformanceV2(pool, getPhaseTenantId(req), req.body || {}, auth.user?.username || 'system')
      );
      return res.json({ ok: true, item: perf });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
