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
export function registerSalesAiOpsAssistantRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates, sendOpsAlert } = ctx;
  const { managerGate } = gates;

  app.post('/api/admin/sales/loss-reasons', platformAdminRequired, async (req, res) => {
    try {
      const { recordLossReason } = await import('../../services/sales/sales-store.js');
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const reasonKey = String(req.body?.reason_key || '').trim();
      const detail = String(req.body?.detail || '').trim();
      const budgetStatus = String(req.body?.budget_status || '').trim();
      const currentSystem = String(req.body?.current_system || '').trim();
      const enterNurture = req.body?.enter_nurture === true;
      const recontactAt = req.body?.recontact_at || null;
      if (!reasonKey || detail.length < 10 || !budgetStatus || !currentSystem || (enterNurture && !recontactAt)) {
        return res.status(400).json({ ok: false, error: 'loss_review_incomplete', message: '请完整填写最大原因、具体细节、预算情况、当前系统；进入培育时必须填写再次联系时间' });
      }
      const loss = await recordLossReason(pool, {
        leadId,
        reasonKey,
        reasonLabel: req.body?.reason_label,
        detail,
        evidence: req.body?.evidence,
        competitor: req.body?.competitor,
        budgetStatus,
        currentSystem,
        recontactAt,
        enterNurture,
        createdBy: req.platformAdmin?.username,
      });
      if (enterNurture) {
        await pool.query(`UPDATE sales_leads SET controller='ai',auto_nurture_enabled=true,auto_nurture_paused_at=NULL,updated_at=NOW() WHERE id=$1`, [leadId]);
        await pool.query(`UPDATE sales_conversations SET controller='ai',updated_at=NOW() WHERE lead_id=$1 AND status='open'`, [leadId]);
      }
      res.json({ ok: true, loss });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/objections', platformAdminRequired, async (req, res) => {
    try {
      const { recordObjection } = await import('../../services/sales/sales-store.js');
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const obj = await recordObjection(pool, {
        leadId,
        objectionKey: req.body?.objection_key,
        objectionLabel: req.body?.objection_label,
        evidence: req.body?.evidence,
        responseText: req.body?.response_text,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, objection: obj });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
