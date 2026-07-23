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

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object, sendOpsAlert?: Function }} ctx */
export function registerSalesAiOpsRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates, sendOpsAlert } = ctx;
  const { managerGate } = gates;

  app.get('/api/admin/sales/daily-report', platformAdminRequired, async (_req, res) => {
    try {
      res.json(await buildBossDailyReport(pool));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/daily-report/send', platformAdminRequired, async (_req, res) => {
    try {
      const report = await buildBossDailyReport(pool);
      if (typeof sendOpsAlert === 'function') await sendOpsAlert(report.text, { title: '销售AI日报', audience: 'sales' });
      res.json({ ok: true, report });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/todo', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, todos: buildSalesTodoList(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/risks', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, risks: buildRiskCustomers(leads), tomorrow_actions: buildTomorrowActions(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/top5', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, top5: buildTopHighLeads(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/leads/:id/demo-brief', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const brief = buildDemoBrief(detail.lead, detail.funnel || {});
      res.json({ ok: true, brief, text: [
        `【会前简报】${brief.customer}`,
        `门店 ${brief.store_count}｜菜系 ${brief.cuisine}｜城市 ${brief.city}｜POS ${brief.pos}`,
        `主要问题：${(brief.main_problems || []).join('；')}`,
        `本次目标：${(brief.this_meeting_goal || []).join('、')}`,
        `建议展示：${(brief.suggested_pages || []).join('、')}`,
      ].join('\n') });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/funnel', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 500 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, funnel: buildFunnelStats(leads), count: leads.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/demos', platformAdminRequired, async (req, res) => {
    try {
      const { createDemo } = await import('../../services/sales/sales-store.js');
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const demo = await createDemo(pool, {
        leadId,
        scheduledAt: req.body?.scheduled_at,
        attendedBy: req.body?.attended_by,
        summary: req.body?.summary,
        keyPoints: req.body?.key_points,
        objections: req.body?.objections,
        nextSteps: req.body?.next_steps,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, demo });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/meetings', platformAdminRequired, async (req, res) => {
    try {
      const { createMeeting } = await import('../../services/sales/sales-store.js');
      const leadId = Number(req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      let summary = null;
      if (req.body?.raw_notes) {
        const s = summarizeMeeting(req.body.raw_notes);
        summary = JSON.stringify(s);
      }
      const meeting = await createMeeting(pool, {
        leadId,
        meetingType: req.body?.meeting_type || 'meeting',
        occurredAt: req.body?.occurred_at,
        rawNotes: req.body?.raw_notes,
        createdBy: req.platformAdmin?.username,
      });
      res.json({ ok: true, meeting, summary });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/trials', platformAdminRequired, async (req, res) => {
    try {
      const { createTrial } = await import('../../services/sales/sales-store.js');
      const { evaluateTrialEligibility } = await import('../../services/sales/trial-eligibility-service.js');
      const leadId = Number(req.params?.id || req.body?.lead_id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const eligibility = await evaluateTrialEligibility(pool, lead);
      const isManagerOrAbove = ['super_admin', 'general_manager', 'sales_manager'].includes(req.platformAdmin?.role);
      if (eligibility.verdict === 'unfit' && !(req.body?.override_ineligible === true && isManagerOrAbove)) {
        return res.status(422).json({ ok: false, error: 'trial_not_eligible', eligibility });
      }
      if (eligibility.verdict === 'conditional' && !isManagerOrAbove) {
        return res.status(403).json({ ok: false, error: 'trial_conditional_requires_manager_confirm', eligibility });
      }
      const trial = await createTrial(pool, {
        leadId,
        startedAt: req.body?.started_at,
        endedAt: req.body?.ended_at,
        stores: req.body?.stores,
        posBrand: req.body?.pos_brand || lead?.pos_brand,
        targetKpis: req.body?.target_kpis,
        createdBy: req.platformAdmin?.username,
        tenantId: lead?.tenant_id || req.body?.tenant_id,
      });
      res.json({ ok: true, trial });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/deals', platformAdminRequired, async (req, res) => {
    try {
      const { createDeal, addOpportunity } = await import('../../services/sales/sales-store.js');
      const leadId = Number(req.params?.id || req.body?.lead_id);
      const leadForDeal = await getLead(pool, leadId);
      if (!leadForDeal || !canAccessLead(req.platformAdmin, leadForDeal)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (req.body?.provision_tenant !== false) {
        if (req.platformAdmin?.role !== 'super_admin') return res.status(403).json({ ok: false, error: 'provision_requires_super_admin' });
        const effectiveContract = await pool.query(`SELECT 1 FROM sales_contracts WHERE lead_id=$1 AND status='effective' LIMIT 1`, [leadId]);
        if (!effectiveContract.rows?.[0]) return res.status(409).json({ ok: false, error: 'effective_contract_required' });
        const creditRisk = await getCreditRisk(pool, leadId);
        if (!creditRisk.can_provision) return res.status(409).json({ ok: false, error: creditRisk.payment_type === 'cash' ? 'confirmed_payment_required' : 'credit_limit_exceeded_or_not_authorized', credit_risk: creditRisk });
      }
      if (req.body?.opportunity_id) {
        await addOpportunity(pool, { leadId, title: '成交机会', stage: 'won', amount: req.body?.amount, createdBy: req.platformAdmin?.username });
      }
      const deal = await createDeal(pool, {
        leadId,
        opportunityId: req.body?.opportunity_id,
        dealDate: req.body?.deal_date,
        amount: req.body?.amount,
        storeCount: req.body?.store_count,
        contractTerm: req.body?.contract_term,
        notes: req.body?.notes,
        createdBy: req.platformAdmin?.username,
      });
      let provision = null;
      if (req.body?.provision_tenant !== false) {
        provision = await provisionTenantFromLead(pool, leadId, {
          tenantId: req.body?.tenant_id,
          tenantName: req.body?.tenant_name,
          adminUsername: req.body?.admin_username,
          startedBy: req.platformAdmin?.username || 'sales_ai',
        });
        if (provision?.ok && provision.tenant_id) {
          await pool.query(`UPDATE sales_deals SET tenant_id=$2, provision_status='done' WHERE id=$1`, [deal.id, provision.tenant_id]);
        }
      }
      const { generateCommissionForDeal } = await import('../../services/sales/sales-commission-service.js');
      const commission = await generateCommissionForDeal(pool, deal.id).catch((e) => ({ ok: false, error: e?.message }));
      res.json({ ok: true, deal, provision, commission });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/leads/:id/provision-tenant', platformAdminRequired, async (req, res) => {
    try {
      const result = await provisionTenantFromLead(pool, Number(req.params.id), {
        tenantId: req.body?.tenant_id,
        tenantName: req.body?.tenant_name,
        adminUsername: req.body?.admin_username,
        startedBy: req.platformAdmin?.username,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  // 开租户"部分成功"补偿队列：核心租户已建好，但收尾步骤(onboarding/客户桥接/关联表回写)
  // 还没完成的记录，供人工确认后重试(重试走同一个provision-tenant接口，不会重复建租户)
  app.get('/api/admin/sales/provisioning/pending-compensations', platformAdminRequired, managerGate, async (req, res) => {
    try {
      const items = await listPendingProvisioningCompensations(pool, { limit: Number(req.query.limit) || 50 });
      res.json({ ok: true, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

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
      console.error('[sales] trial progress', e?.message || e);
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
