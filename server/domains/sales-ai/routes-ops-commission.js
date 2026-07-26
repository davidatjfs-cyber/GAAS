import { sensitiveRateLimit } from '../../services/sales/sales-rate-limit.js';
import { isManager } from '../../services/sales/sales-permissions.js';

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */
export function registerSalesAiOpsCommissionRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates } = ctx;
  const { managerGate } = gates;

  // ── 客户拜访记录 ──
  app.post('/api/admin/sales/leads/:id/visits', platformAdminRequired, async (req, res) => {
    try {
      const { recordVisit } = await import('../../services/sales/sales-visits-service.js');
      const visit = await recordVisit(pool, {
        leadId: Number(req.params.id),
        repId: req.body?.rep_id ? Number(req.body.rep_id) : null,
        visitType: req.body?.visit_type,
        occurredAt: req.body?.occurred_at,
        notes: req.body?.notes,
        nextFollowupAt: req.body?.next_followup_at,
        nextFollowupPlan: req.body?.next_followup_plan,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, visit });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/leads/:id/visits', platformAdminRequired, async (req, res) => {
    try {
      const { listVisitsForLead } = await import('../../services/sales/sales-visits-service.js');
      const visits = await listVisitsForLead(pool, Number(req.params.id));
      res.json({ ok: true, visits });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // ── 销售提成 ──
  app.post('/api/admin/sales/commission-rules', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const { setCommissionRule } = await import('../../services/sales/sales-commission-service.js');
      const rule = await setCommissionRule(pool, {
        repId: req.body?.rep_id ? Number(req.body.rep_id) : null,
        ratePercent: Number(req.body?.rate_percent),
        effectiveFrom: req.body?.effective_from,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, rule });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  // rep_id 之前完全信任客户端传参，普通销售改个数字就能看到别人的提成——非manager一律
  // 强制用自己的rep_id覆盖请求参数，不管前端传了什么。
  app.get('/api/admin/sales/commissions', platformAdminRequired, sensitiveRateLimit('commissions'), async (req, res) => {
    try {
      const { listCommissions } = await import('../../services/sales/sales-commission-service.js');
      let repId = req.query?.rep_id ? Number(req.query.rep_id) : null;
      if (!isManager(req.platformAdmin)) {
        const own = await pool.query(`SELECT id FROM sales_reps WHERE rep_key=$1 LIMIT 1`, [req.platformAdmin?.username]);
        repId = own.rows?.[0]?.id || -1; // 查不到自己的rep记录就传个不存在的id，返回空列表而不是报错
      }
      const commissions = await listCommissions(pool, { repId, status: req.query?.status });
      res.json({ ok: true, commissions });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/commissions/:id/status', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const { updateCommissionStatus } = await import('../../services/sales/sales-commission-service.js');
      const commission = await updateCommissionStatus(pool, Number(req.params.id), {
        status: req.body?.status,
        approvedBy: req.platformAdmin?.username,
      });
      if (!commission) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, commission });
    } catch (e) {
      res.status(400).json({ ok: false, error: e?.message || 'invalid_request' });
    }
  });
}
