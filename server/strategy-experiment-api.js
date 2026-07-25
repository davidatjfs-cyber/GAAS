/**
 * 策略实验 API — HRMS Server 路由
 * 
 * 门店侧路由：查看待执行、提交结果
 * 注册方式: app.use(strategyExperimentRoutes(pool, authRequired))
 */

import { Router } from 'express';
import { resolveAgentCanonicalStore } from './v2-store-alignment.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'strategy-experiment', handler: 'api' });


export default function strategyExperimentRoutes(pool, authRequired) {
  const r = Router();

r.get('/api/strategy-experiments', authRequired, async (req, res) => {
  try {
    const { status, store, limit, offset } = req.query;
    const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
    const conditions = [`e.tenant_id = $1`];
    const params = [tenantId];
    let idx = 2;

    if (status) {
      conditions.push(`e.status = $${idx++}`);
      params.push(status);
    }
    if (store) {
      conditions.push(`v.store ILIKE $${idx++}`);
      params.push(`%${store}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = await pool.query(
      `SELECT COUNT(DISTINCT e.id) AS cnt FROM strategy_experiments e LEFT JOIN strategy_variants v ON v.experiment_id = e.id ${where}`,
      params
    );

    const rows = await pool.query(`
      SELECT e.*, json_agg(json_build_object(
        'id', v.id, 'variant_code', v.variant_code, 'label', v.label,
        'action', v.action, 'store', v.store, 'status', v.status,
        'outcome_score', v.outcome_score, 'assignee_username', v.assignee_username
      )) FILTER (WHERE v.id IS NOT NULL) AS variants
      FROM strategy_experiments e
      LEFT JOIN strategy_variants v ON v.experiment_id = e.id
      ${where}
      GROUP BY e.id
      ORDER BY e.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, parseInt(limit) || 50, parseInt(offset) || 0]);

    res.json({ ok: true, experiments: rows.rows, total: parseInt(total.rows[0]?.cnt || 0) });
  } catch (e) {
    log.error({ msg: 'list_strategy_experiments_failed', err: e?.message });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// NOTE: 必须注册在 /:code 之前，否则 Express 会把 pending-for-store 当作 :code 匹配导致 404
r.get('/api/strategy-experiments/pending-for-store', authRequired, async (req, res) => {
  try {
    const store = req.user?.store || req.query.store;
    if (!store) return res.status(400).json({ ok: false, error: 'store required' });
    const canonical = resolveAgentCanonicalStore(store);
    const variants = await pool.query(`
      SELECT v.*, e.experiment_code, e.title, e.goal, e.metric_focus, e.planned_start, e.planned_end
      FROM strategy_variants v
      JOIN strategy_experiments e ON e.id = v.experiment_id
      WHERE v.store ILIKE $1 AND v.status IN ('pending', 'executing')
        AND e.status IN ('approved', 'running')
      ORDER BY e.created_at DESC
    `, [`%${canonical}%`]);
    res.json({ ok: true, variants: variants.rows });
  } catch (e) {
    log.error({ msg: 'get_pending_variants_failed', err: e?.message });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

r.get('/api/strategy-experiments/:code', authRequired, async (req, res) => {
  try {
    const exp = await pool.query(`SELECT * FROM strategy_experiments WHERE experiment_code = $1`, [req.params.code]);
    if (!exp.rows[0]) return res.status(404).json({ ok: false, error: 'not_found' });
    const variants = await pool.query(`SELECT * FROM strategy_variants WHERE experiment_id = $1 ORDER BY variant_code`, [exp.rows[0].id]);
    res.json({ ok: true, experiment: exp.rows[0], variants: variants.rows });
  } catch (e) {
    log.error({ msg: 'get_strategy_experiment_failed', err: e?.message });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

r.post('/api/strategy-experiments/:code/variants/:variant/start', authRequired, async (req, res) => {
  try {
    const exp = await pool.query(`SELECT id FROM strategy_experiments WHERE experiment_code = $1`, [req.params.code]);
    if (!exp.rows[0]) return res.status(404).json({ ok: false, error: 'experiment_not_found' });

    await pool.query(`
      UPDATE strategy_variants SET status = 'executing', executed_at = NOW()
      WHERE experiment_id = $1 AND variant_code = $2
    `, [exp.rows[0].id, req.params.variant]);
    res.json({ ok: true });
  } catch (e) {
    log.error({ msg: 'start_variant_failed', err: e?.message });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

r.post('/api/strategy-experiments/:code/variants/:variant/result', authRequired, async (req, res) => {
  try {
    const exp = await pool.query(`SELECT id, status FROM strategy_experiments WHERE experiment_code = $1`, [req.params.code]);
    if (!exp.rows[0]) return res.status(404).json({ ok: false, error: 'experiment_not_found' });

    const variant = await pool.query(
      `SELECT * FROM strategy_variants WHERE experiment_id = $1 AND variant_code = $2`,
      [exp.rows[0].id, req.params.variant]
    );
    if (!variant.rows[0]) return res.status(404).json({ ok: false, error: 'variant_not_found' });
    if (variant.rows[0].status === 'completed') {
      return res.status(400).json({ ok: false, error: 'variant already completed' });
    }

    const resultData = {
      before_daily_revenue: parseFloat(req.body.before_daily_revenue),
      during_daily_revenue: parseFloat(req.body.during_daily_revenue),
      before_daily_traffic: parseInt(req.body.before_daily_traffic),
      during_daily_traffic: parseInt(req.body.during_daily_traffic),
      extra_cost: req.body.extra_cost ? parseFloat(req.body.extra_cost) : null,
      new_customers: req.body.new_customers ? parseInt(req.body.new_customers) : null,
      execution_fidelity: req.body.execution_fidelity || 'partial',
      feedback: req.body.feedback || ''
    };

    if (isNaN(resultData.before_daily_revenue) || isNaN(resultData.during_daily_revenue) ||
        isNaN(resultData.before_daily_traffic) || isNaN(resultData.during_daily_traffic)) {
      return res.status(400).json({ ok: false, error: 'required number fields missing' });
    }

    if (!['full', 'partial', 'failed'].includes(resultData.execution_fidelity)) {
      return res.status(400).json({ ok: false, error: 'execution_fidelity must be full, partial, or failed' });
    }

    await pool.query(`
      UPDATE strategy_variants SET result_data = $1, status = 'completed', completed_at = NOW()
      WHERE experiment_id = $2 AND variant_code = $3
    `, [JSON.stringify(resultData), exp.rows[0].id, req.params.variant]);

    const allVariants = await pool.query(`SELECT status FROM strategy_variants WHERE experiment_id = $1`, [exp.rows[0].id]);
    const allDone = allVariants.rows.every(v => ['completed', 'expired', 'incomplete'].includes(v.status));
    if (allDone) {
      await pool.query(`UPDATE strategy_experiments SET status = 'reviewing', updated_at = NOW() WHERE id = $1`, [exp.rows[0].id]);
    }

    res.json({ ok: true });
  } catch (e) {
    log.error({ msg: 'submit_variant_result_failed', err: e?.message });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

  // Admin: approve experiment
  r.post('/api/strategy-experiments/:code/approve', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const { storeAssignments } = req.body;
      const exp = await pool.query(`SELECT id, status FROM strategy_experiments WHERE experiment_code = $1`, [req.params.code]);
      if (!exp.rows[0]) return res.status(404).json({ ok: false, error: 'not_found' });
      if (exp.rows[0].status !== 'pending_approval') return res.status(400).json({ ok: false, error: 'experiment not in pending_approval status' });

      if (storeAssignments && Array.isArray(storeAssignments)) {
        for (const sa of storeAssignments) {
          const canonical = resolveAgentCanonicalStore(sa.store);
          await pool.query(`
            UPDATE strategy_variants SET store = $1, assignee_username = $2, assignee_open_id = $3
            WHERE experiment_id = $4 AND variant_code = $5
          `, [canonical, sa.assigneeUsername || null, sa.assigneeOpenId || null, exp.rows[0].id, sa.variantCode]);
        }
      }

      const agentsUrl = process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101';
      try {
        const resp = await axios.post(`${agentsUrl}/api/strategy/experiments/${req.params.code}/approve`, { storeAssignments }, {
          headers: { Authorization: req.headers.authorization || '', 'Content-Type': 'application/json' }
        });
        return res.json(resp.data);
      } catch (proxyErr) {
        log.error({ msg: 'proxy_approve_to_agents_service_failed_falling_back_to_local', err: proxyErr?.message });
      }

      await pool.query(`
        UPDATE strategy_experiments SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
        WHERE id = $2
      `, [req.user?.username || 'admin', exp.rows[0].id]);

      const plannedStart = (await pool.query(`SELECT planned_start FROM strategy_experiments WHERE id = $1`, [exp.rows[0].id])).rows[0]?.planned_start || new Date();
      const plannedEnd = (await pool.query(`SELECT planned_end FROM strategy_experiments WHERE id = $1`, [exp.rows[0].id])).rows[0]?.planned_end;
      const resultDeadline = plannedEnd ? new Date(new Date(plannedEnd).getTime() + 7 * 86400000) : null;

      await pool.query(`
        UPDATE strategy_experiments SET status = 'running', planned_start = $1::date, result_deadline = $2::date, updated_at = NOW()
        WHERE id = $3 AND status = 'approved'
      `, [plannedStart, resultDeadline, exp.rows[0].id]);

      await pool.query(`
        UPDATE strategy_variants SET status = 'executing', executed_at = NOW()
        WHERE experiment_id = $1 AND status = 'pending'
      `, [exp.rows[0].id]);

      const updated = await pool.query(`SELECT * FROM strategy_experiments WHERE id = $1`, [exp.rows[0].id]);
      const variants = await pool.query(`SELECT * FROM strategy_variants WHERE experiment_id = $1 ORDER BY variant_code`, [exp.rows[0].id]);
      res.json({ ok: true, experiment: updated.rows[0], variants: variants.rows });
    } catch (e) {
      log.error({ msg: 'approve_experiment_failed', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // Admin: reject experiment
  r.post('/api/strategy-experiments/:code/reject', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const exp = await pool.query(`SELECT id, status FROM strategy_experiments WHERE experiment_code = $1`, [req.params.code]);
      if (!exp.rows[0]) return res.status(404).json({ ok: false, error: 'not_found' });

      await pool.query(`UPDATE strategy_experiments SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [exp.rows[0].id]);

      const updated = await pool.query(`SELECT * FROM strategy_experiments WHERE id = $1`, [exp.rows[0].id]);
      res.json({ ok: true, experiment: updated.rows[0] });
    } catch (e) {
      log.error({ msg: 'reject_experiment_failed', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // Admin: evaluate experiment
  r.post('/api/strategy-experiments/:code/evaluate', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const { default: axios } = await import('axios');
      const agentsUrl = (process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101');
      const resp = await axios.post(`${agentsUrl}/api/strategy/experiments/${req.params.code}/evaluate`, {}, {
        headers: { 'Authorization': req.headers['authorization'] || '' }
      });
      res.json(resp.data);
    } catch (e) {
      log.error({ msg: 'evaluate_experiment_failed', err: e?.message });
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  r.put('/api/strategy-experiments/:code/variants/:variant/result', authRequired, async (req, res) => {
  try {
    const exp = await pool.query(`SELECT id FROM strategy_experiments WHERE experiment_code = $1`, [req.params.code]);
    if (!exp.rows[0]) return res.status(404).json({ ok: false, error: 'experiment_not_found' });

    const variant = await pool.query(
      `SELECT status FROM strategy_variants WHERE experiment_id = $1 AND variant_code = $2`,
      [exp.rows[0].id, req.params.variant]
    );
    if (!variant.rows[0]) return res.status(404).json({ ok: false, error: 'variant_not_found' });
    if (variant.rows[0].status === 'completed') {
      return res.status(400).json({ ok: false, error: 'already completed, cannot modify' });
    }

    await pool.query(`
      UPDATE strategy_variants SET result_data = $1, status = 'completed', completed_at = NOW()
      WHERE experiment_id = $2 AND variant_code = $3
    `, [JSON.stringify(req.body), exp.rows[0].id, req.params.variant]);

    res.json({ ok: true });
  } catch (e) {
    log.error({ msg: 'update_variant_result_failed', err: e?.message });
    res.status(500).json({ ok: false, error: e?.message });
  }
});

return r;
}