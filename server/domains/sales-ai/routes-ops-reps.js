import { ensureSalesTables, listLeads, getLead } from '../../services/sales/sales-store.js';
import { getLeadDetail } from '../../services/sales/sales-session.js';
import {
  buildBossDailyReport,
  buildSalesTodoList,
  buildRiskCustomers,
  buildFunnelStats,
  buildTomorrowActions,
  buildTopHighLeads,
  buildDemoBrief,
  summarizeMeeting,
} from '../../services/sales/sales-ops.js';
import { provisionTenantFromLead, listPendingProvisioningCompensations } from '../../services/sales-provisioning.js';
import { buildSalesBossDashboard } from '../../services/sales/sales-boss-metrics.js';
import { buildVoiceQualityReport } from '../../services/sales/sales-voice-quality.js';
import { listCaseAssets, recommendCasesForLead, formatCaseForSend, getCaseAsset } from '../../services/sales/sales-case-library.js';
import { generateSalesProposal, runDeepDiagnosis } from '../../services/sales/sales-proposal.js';
import { TRAINING_SCENARIOS, scoreTrainingResponse, recordTrainingSession, getTrainingStats } from '../../services/sales/sales-training.js';
import { runSalesAssistantTurn, listAssistantThreads, listAssistantMessages } from '../../services/sales/sales-internal-assistant.js';
import { validateTrialProgress, buildTrialProgressSummary } from '../../services/sales/sales-trial-monitor.js';
import { getCreditRisk } from '../../services/sales/sales-credit-risk.js';
import { sensitiveRateLimit } from '../../services/sales/sales-rate-limit.js';
import { leadScopeSql, canAccessLead, canAccessRepMetrics, isManager } from '../../services/sales/sales-permissions.js';
import {
  listSalesReps,
  createOrUpdateSalesRep,
  upsertKpiTarget,
  computeAndSaveKpiScore,
  getRepScorecard,
  getTeamLeaderboard,
} from '../../services/sales/sales-rep-management.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-ops' });



/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object, sendOpsAlert?: Function }} ctx */
export function registerSalesAiOpsRepRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates, sendOpsAlert } = ctx;
  const { managerGate } = gates;

  app.get('/api/admin/sales/reps', platformAdminRequired, async (req, res) => {
    try {
      const reps = await listSalesReps(pool, { status: req.query?.status });
      res.json({ ok: true, reps });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/regions', platformAdminRequired, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM sales_regions WHERE active=true ORDER BY sort_order,region_name`);
      res.json({ ok: true, regions: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/regions', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const code = String(req.body?.region_code || '').trim();
      const name = String(req.body?.region_name || '').trim();
      if (!code || !name || !/^[A-Za-z0-9_-]{1,40}$/.test(code)) return res.status(400).json({ ok: false, error: 'invalid_region' });
      const r = await pool.query(
        `INSERT INTO sales_regions (region_code,region_name,active) VALUES ($1,$2,true)
         ON CONFLICT (region_code) DO UPDATE SET region_name=EXCLUDED.region_name,active=true,updated_at=NOW() RETURNING *`,
        [code, name]
      );
      res.json({ ok: true, region: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/reps', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const rep = await createOrUpdateSalesRep(pool, {
        repKey: req.body?.rep_key,
        displayName: req.body?.display_name,
        role: req.body?.role,
        status: req.body?.status,
        hireDate: req.body?.hire_date,
        wecomName: req.body?.wecom_name,
        wecomQrAssetId: req.body?.wecom_qr_asset_id ? Number(req.body.wecom_qr_asset_id) : null,
        regionCode: req.body?.region_code,
        regionName: req.body?.region_name,
      });
      res.json({ ok: true, rep });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/performance/by-region', platformAdminRequired, async (req, res) => {
    try {
      if (!isManager(req.platformAdmin)) return res.status(403).json({ ok: false, error: 'manager_required' });
      const scope = leadScopeSql(req.platformAdmin, 1);
      const r = await pool.query(
        `WITH scoped AS (
           SELECT l.id,l.stage,
                  COALESCE(l.region_code,rep.region_code,'unassigned') AS region_code,
                  COALESCE(l.region_name,rep.region_name,'未分区域') AS region_name,
                  COALESCE((SELECT SUM(c.amount_fen) FROM sales_contracts c WHERE c.lead_id=l.id AND c.status='effective'),0) AS contract_fen,
                  COALESCE((SELECT SUM(p.amount_fen) FROM sales_payments p JOIN sales_contracts c ON c.id=p.contract_id WHERE c.lead_id=l.id AND p.status='confirmed'),0) AS paid_fen
             FROM sales_leads l
             LEFT JOIN sales_reps rep ON rep.rep_key=COALESCE(l.assigned_to,l.owner_username)
            WHERE ${scope.clause}
         )
         SELECT region_code,MAX(region_name) AS region_name,COUNT(*)::int AS lead_count,
                COUNT(*) FILTER (WHERE stage='won')::int AS won_count,
                COALESCE(SUM(contract_fen),0)::bigint AS contract_fen,
                COALESCE(SUM(paid_fen),0)::bigint AS paid_fen
           FROM scoped GROUP BY region_code ORDER BY paid_fen DESC,lead_count DESC`,
        scope.params
      );
      res.json({ ok: true, regions: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.get('/api/admin/sales/reps/:id/activity', platformAdminRequired, async (req, res) => {
    try {
      const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 180);
      const r = await pool.query(
        `SELECT * FROM sales_daily_activity
          WHERE rep_id = $1 AND activity_date >= (NOW() - ($2 || ' days')::interval)::date
          ORDER BY activity_date DESC`,
        [Number(req.params.id), days]
      );
      res.json({ ok: true, activity: r.rows || [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/reps/:id/scorecard', platformAdminRequired, async (req, res) => {
    try {
      const repRow = await pool.query(`SELECT rep_key FROM sales_reps WHERE id=$1 LIMIT 1`, [Number(req.params.id)]);
      if (!canAccessRepMetrics(req.platformAdmin, repRow.rows?.[0]?.rep_key)) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await getRepScorecard(pool, Number(req.params.id), req.query?.period_type, req.query?.period_key);
      res.json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/kpi-targets', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const target = await upsertKpiTarget(pool, {
        repId: Number(req.body?.rep_id),
        periodType: req.body?.period_type,
        periodKey: req.body?.period_key,
        targetNewLeads: req.body?.target_new_leads,
        targetDemos: req.body?.target_demos,
        targetDeals: req.body?.target_deals,
        targetRevenueFen: req.body?.target_revenue_fen,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, target });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/kpi-scores', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const score = await computeAndSaveKpiScore(pool, {
        repId: Number(req.body?.rep_id),
        periodType: req.body?.period_type,
        periodKey: req.body?.period_key,
        managerScore: req.body?.manager_score,
        managerComment: req.body?.manager_comment,
      });
      res.json({ ok: true, score });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/kpi-leaderboard', platformAdminRequired, async (req, res) => {
    try {
      const leaderboard = await getTeamLeaderboard(pool, { periodType: req.query?.period_type, periodKey: req.query?.period_key });
      res.json({ ok: true, leaderboard });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

}
