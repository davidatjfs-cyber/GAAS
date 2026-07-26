import { getLead } from '../../services/sales/sales-store.js';

import {
  summarizeMeeting,
} from '../../services/sales/sales-ops.js';
import { provisionTenantFromLead, listPendingProvisioningCompensations } from '../../services/sales-provisioning.js';

import { getCreditRisk } from '../../services/sales/sales-credit-risk.js';

import { canAccessLead } from '../../services/sales/sales-permissions.js';
import { childLogger } from '../../utils/logger.js';

const _log = childLogger({ domain: 'sales-ai', handler: 'routes-ops' });

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object, sendOpsAlert?: Function }} ctx */
export function registerSalesAiOpsPipelineRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates, sendOpsAlert: _sendOpsAlert } = ctx;
  const { managerGate } = gates;

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
}
