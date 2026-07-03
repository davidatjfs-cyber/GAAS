/**
 * Ontology 只读查询路由 — GET /api/ontology/:type[?id=][&limit=]
 * 沿用 store-diagnosis.js#registerDiagnosisRoutes 的注册约定。
 */

import { listObjectTypes } from './objects.js';
import { queryObject } from './query.js';

export function registerOntologyRoutes(app, pool, authRequired) {
  app.get('/api/ontology/types', authRequired, async (req, res) => {
    return res.json({ ok: true, types: listObjectTypes() });
  });

  app.get('/api/ontology/:type', authRequired, async (req, res) => {
    try {
      const { type } = req.params;
      const { id, limit } = req.query;
      const rows = await queryObject(pool, type, { id, limit });
      return res.json({ ok: true, type, rows });
    } catch (e) {
      if (String(e?.message || '').startsWith('ontology: unknown object type')) {
        return res.status(404).json({ ok: false, error: 'unknown_object_type' });
      }
      console.error('[ontology] query error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
