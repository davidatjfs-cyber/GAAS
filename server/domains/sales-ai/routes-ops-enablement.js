import { getLead } from '../../services/sales/sales-store.js';
import { getLeadDetail } from '../../services/sales/sales-session.js';
import { buildSalesBossDashboard } from '../../services/sales/sales-boss-metrics.js';

import { listCaseAssets, recommendCasesForLead, formatCaseForSend, getCaseAsset } from '../../services/sales/sales-case-library.js';
import { generateSalesProposal, runDeepDiagnosis } from '../../services/sales/sales-proposal.js';
import { TRAINING_SCENARIOS, scoreTrainingResponse, recordTrainingSession, getTrainingStats } from '../../services/sales/sales-training.js';
import { runSalesAssistantTurn, listAssistantThreads, listAssistantMessages } from '../../services/sales/sales-internal-assistant.js';
import { validateTrialProgress, buildTrialProgressSummary } from '../../services/sales/sales-trial-monitor.js';

import { sensitiveRateLimit } from '../../services/sales/sales-rate-limit.js';
import { canAccessLead } from '../../services/sales/sales-permissions.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-ops' });

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object, sendOpsAlert?: Function }} ctx */
export function registerSalesAiOpsEnablementRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates, sendOpsAlert: _sendOpsAlert } = ctx;
  const { managerGate: _managerGate } = gates;

  app.post('/api/admin/sales/leads/:id/deep-diagnosis', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const result = await runDeepDiagnosis({
        lead: detail.lead,
        messages: detail.messages,
        ruleDiagnosis: detail.diagnosis,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/proposal', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const cases = await recommendCasesForLead(pool, detail.lead);
      const proposal = await generateSalesProposal({
        lead: detail.lead,
        diagnosis: detail.diagnosis,
        cases,
        funnel: detail.funnel,
      });
      res.json({ ok: true, ...proposal, cases: cases.slice(0, 3).map((c) => ({ case_key: c.case_key, title: c.title })) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/cases', platformAdminRequired, async (req, res) => {
    try {
      const cases = await listCaseAssets(pool, { theme: req.query?.theme, pain: req.query?.pain, limit: Number(req.query?.limit) || 50 });
      res.json({ ok: true, cases });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/cases/:key', platformAdminRequired, async (req, res) => {
    try {
      const c = await getCaseAsset(pool, req.params.key);
      if (!c) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, case: c, text: formatCaseForSend(c) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/boss-dashboard', platformAdminRequired, async (_req, res) => {
    try {
      res.json(await buildSalesBossDashboard(pool));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/training/scenarios', platformAdminRequired, (_req, res) => {
    res.json({ ok: true, scenarios: TRAINING_SCENARIOS });
  });

  app.post('/api/admin/sales/training/score', platformAdminRequired, async (req, res) => {
    try {
      const scored = scoreTrainingResponse(req.body?.scenario_key, req.body?.response);
      if (!scored.ok) return res.status(400).json(scored);
      const row = await recordTrainingSession(pool, {
        username: req.platformAdmin?.username || 'admin',
        scenarioKey: req.body.scenario_key,
        response: req.body?.response,
        score: scored.score,
        feedback: scored.feedback,
      });
      res.json({ ok: true, ...scored, session: row });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/training/stats', platformAdminRequired, async (req, res) => {
    try {
      const stats = await getTrainingStats(pool, req.platformAdmin?.username || 'admin');
      res.json({ ok: true, stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/trials/:id/validate', platformAdminRequired, async (req, res) => {
    try {
      const trialId = Number(req.params.id);
      const tr = await pool.query(`SELECT * FROM sales_trials WHERE id=$1`, [trialId]);
      const trial = tr.rows?.[0];
      if (!trial) return res.status(404).json({ ok: false, error: 'not_found' });
      const lead = await getLead(pool, trial.lead_id);
      const result = await validateTrialProgress(pool, {
        leadId: trial.lead_id,
        tenantId: trial.tenant_id || lead?.tenant_id,
        trialId,
        days: Number(req.body?.days) || 30,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 30天试跑第几天/剩几天 + 建档时约定的KPI目标 vs 实际值，validate接口只判断"有没有数据"，
  // 这个接口回答"离目标还差多少"
  app.get('/api/admin/sales/trials/:id/progress', platformAdminRequired, sensitiveRateLimit('trial_progress'), async (req, res) => {
    try {
      const trialId = Number(req.params.id);
      const tr = await pool.query(`SELECT lead_id FROM sales_trials WHERE id=$1`, [trialId]);
      const leadId = tr.rows?.[0]?.lead_id;
      if (!leadId) return res.status(404).json({ ok: false, error: 'not_found' });
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await buildTrialProgressSummary(pool, trialId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_trial_progress', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/assistant/chat', platformAdminRequired, async (req, res) => {
    try {
      const result = await runSalesAssistantTurn(pool, {
        ownerUsername: req.platformAdmin?.username || 'admin',
        threadId: req.body?.thread_id,
        leadId: req.body?.lead_id ? Number(req.body.lead_id) : null,
        message: req.body?.message,
        history: req.body?.history,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/sales/assistant/threads', platformAdminRequired, async (req, res) => {
    try {
      const threads = await listAssistantThreads(pool, req.platformAdmin?.username || 'admin');
      res.json({ ok: true, threads });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/assistant/threads/:id/messages', platformAdminRequired, async (req, res) => {
    try {
      const messages = await listAssistantMessages(pool, Number(req.params.id), req.platformAdmin?.username || 'admin');
      res.json({ ok: true, messages });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
