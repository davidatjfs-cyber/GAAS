/**
 * 业态分层基准库路由：
 * - 门店查自己的基准区间 → 普通租户鉴权(authRequired)，只读、只查自己租户内的门店。
 * - 重新分类/重算基准 → 跨租户聚合操作，必须走平台管理员鉴权(platformAdminRequired)，
 *   不能开放给任何租户自己触发(否则会被滥用刷跑批量聚合任务)。
 */
import { classifyAllStores, computeAllBenchmarks, getBenchmarkForStore, getKpiWeightsForBusinessType } from './benchmark-service.js';
import { listBusinessTypes } from './store-segments.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'ontology', handler: 'benchmark-routes' });

export function registerBenchmarkRoutes(app, pool, authRequired, platformAdminRequired) {
  app.get('/api/ontology/benchmarks/business-types', authRequired, async (_req, res) => {
    res.json({ ok: true, business_types: listBusinessTypes() });
  });

  app.get('/api/ontology/benchmarks/kpi-weights/:businessType', authRequired, async (req, res) => {
    try {
      const weights = await getKpiWeightsForBusinessType(pool, req.params.businessType);
      res.json({ ok: true, business_type: req.params.businessType, weights });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/ontology/benchmarks/store/:storeId', authRequired, async (req, res) => {
    try {
      const metricName = String(req.query?.metric_name || 'avg_ticket_price').trim();
      const benchmark = await getBenchmarkForStore(pool, req.params.storeId, metricName);
      if (!benchmark) return res.status(404).json({ ok: false, error: 'no_benchmark_available' });
      res.json({ ok: true, benchmark });
    } catch (e) {
      log.error({ msg: 'benchmark_lookup_failed', err: e?.message || String(e) });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  if (!platformAdminRequired) return;

  app.post('/api/admin/ontology/benchmarks/classify-stores', platformAdminRequired, async (_req, res) => {
    try {
      const result = await classifyAllStores(pool);
      res.json(result);
    } catch (e) {
      log.error({ msg: 'benchmark_classify_failed', err: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e?.message || 'server_error' });
    }
  });

  app.post('/api/admin/ontology/benchmarks/recompute', platformAdminRequired, async (_req, res) => {
    try {
      const result = await computeAllBenchmarks(pool);
      res.json(result);
    } catch (e) {
      log.error({ msg: 'benchmark_recompute_failed', err: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e?.message || 'server_error' });
    }
  });
}
