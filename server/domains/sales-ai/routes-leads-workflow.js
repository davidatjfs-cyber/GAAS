import { ensureSalesTables, listLeads, getLead, upsertTask, transitionLeadStage } from '../../services/sales/sales-store.js';
import {
  handleInboundMessage,
  takeoverConversation,
  releaseToAi,
  getLeadDetail,
  recordSalesReply,
  detectOvercommitment,
} from '../../services/sales/sales-session.js';
import { draftCustomerReply, draftStandardResponse, draftQuickReplyByScenario } from '../../services/sales/sales-reply-draft.js';
import { checkPricePermission } from '../../services/sales/sales-price-policy.js';
import { buildLeadSummary, calculateSla } from '../../services/sales/sales-collaboration-service.js';
import { getUnifiedCustomerTimeline } from '../../services/sales/sales-timeline.js';
import { buildTenantMonthlyValueReport } from '../../services/sales/tenant-value-report.js';
import { getOnboardingChecklist } from '../../services/sales/tenant-onboarding.js';
import { computeRenewalHealth, listRenewalRisks, listReferralCandidates } from '../../services/sales/tenant-renewal-service.js';
import { maskLeadContact, maskLeadListContact, canViewFullContact } from '../../services/sales/sales-privacy.js';
import { sensitiveRateLimit } from '../../services/sales/sales-rate-limit.js';
import { leadScopeSql, canAccessLead, canAccessTenant } from '../../services/sales/sales-permissions.js';
import { kfConfigured } from '../../services/sales/sales-kf.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-leads' });


/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */

/** @param { app: any, pool: any, platformAdminRequired: Function, gates: object } ctx */
export function registerSalesAiLeadsWorkflowRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates } = ctx;
  const { contractPriceGate } = gates;

  // 客户档案手动编辑：之前公司/电话等字段只能靠客户AI从聊天里提取，销售没有任何
  // 手动修正/补录的入口。这里只开放"客户档案"类字段(基础信息+营业执照/开票/联系人)，
  // 不允许通过这个接口改stage/controller/intent_score这些由AI/销售流程自动维护的字段。
  const LEAD_DOSSIER_FIELDS = [
    'name', 'company', 'phone', 'city', 'region_code', 'region_name', 'cuisine', 'store_count', 'pos_brand',
    'customer_brands', 'customer_cities', 'customer_contacts', 'requested_payment_type', 'requested_credit_days', 'requested_credit_limit_fen',
    'legal_company_name', 'unified_credit_code', 'registered_address', 'company_size', 'website',
    'invoice_title', 'invoice_tax_no', 'invoice_bank_name', 'invoice_bank_account',
    'legal_contact_name', 'legal_contact_title', 'legal_contact_phone',
  ];
  app.put('/api/admin/sales/leads/:id/dossier', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const body = req.body || {};
      const fields = Object.keys(body).filter((k) => LEAD_DOSSIER_FIELDS.includes(k));
      if (!fields.length) return res.status(400).json({ ok: false, error: 'no_valid_fields' });
      const jsonFields = new Set(['customer_brands', 'customer_cities', 'customer_contacts']);
      if (fields.includes('customer_brands')) {
        const brands = Array.isArray(body.customer_brands) ? body.customer_brands : JSON.parse(String(body.customer_brands || '[]'));
        if (!Array.isArray(brands) || brands.some((item) => !String(item?.brand_name || '').trim() || !String(item?.city || '').trim() || !(Number(item?.store_count) > 0))) {
          return res.status(400).json({ ok: false, error: 'customer_brands_invalid', message: '每个品牌都需要填写品牌名称、城市和门店数量' });
        }
        const cities = [...new Set(brands.map((item) => String(item.city).trim()))];
        body.customer_brands = brands.map((item) => ({ brand_name: String(item.brand_name).trim(), city: String(item.city).trim(), store_count: Number(item.store_count) }));
        body.customer_cities = cities;
        body.city = cities.join('、');
        body.store_count = brands.reduce((total, item) => total + Number(item.store_count), 0);
        body.pos_brand = [...new Set(brands.map((item) => String(item.brand_name).trim()))].join('、');
        for (const derivedField of ['customer_cities', 'city', 'store_count', 'pos_brand']) if (!fields.includes(derivedField)) fields.push(derivedField);
      }
      if (fields.includes('customer_contacts')) {
        const contacts = Array.isArray(body.customer_contacts) ? body.customer_contacts : JSON.parse(String(body.customer_contacts || '[]'));
        if (!Array.isArray(contacts) || contacts.some((item) => !String(item?.name || '').trim() || !String(item?.title || '').trim() || !String(item?.phone || '').trim())) {
          return res.status(400).json({ ok: false, error: 'customer_contacts_invalid', message: '每位联系人都需要填写姓名、职位和电话' });
        }
        body.customer_contacts = contacts.map((item) => ({ name: String(item.name).trim(), title: String(item.title).trim(), phone: String(item.phone).trim() }));
        const primary = body.customer_contacts[0];
        body.name = primary.name; body.phone = primary.phone;
        body.legal_contact_name = primary.name; body.legal_contact_title = primary.title; body.legal_contact_phone = primary.phone;
        for (const derivedField of ['name', 'phone', 'legal_contact_name', 'legal_contact_title', 'legal_contact_phone']) if (!fields.includes(derivedField)) fields.push(derivedField);
      }
      const values = fields.map((field) => {
        const value = body[field];
        if (!jsonFields.has(field)) return value === '' ? null : value;
        if (Array.isArray(value)) return JSON.stringify(value);
        try {
          const parsed = JSON.parse(String(value || '[]'));
          if (!Array.isArray(parsed)) throw new Error('not_array');
          return JSON.stringify(parsed);
        } catch {
          throw Object.assign(new Error(`${field}_invalid`), { statusCode: 400 });
        }
      });
      const typedSetClauses = fields.map((f, i) => `${f} = $${i + 2}${jsonFields.has(f) ? '::jsonb' : ''}`);
      const r = await pool.query(
        `UPDATE sales_leads SET ${typedSetClauses.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [leadId, ...values]
      );
      if (!r.rows?.[0]) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, lead: r.rows[0] });
    } catch (e) {
      res.status(e?.statusCode || 500).json({ ok: false, error: e?.message || 'server_error', message: e?.statusCode ? '档案中的品牌或联系人格式不正确' : e?.message });
    }
  });

  app.get('/api/admin/sales/leads/:id/summary', platformAdminRequired, async (req, res) => {
    try {
      const data = await getLeadDetail(pool, Number(req.params.id));
      if (!data.ok) return res.status(404).json(data);
      res.json({ ok: true, summary: buildLeadSummary(data.lead, data.lead.last_sales_decision || {}) });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/leads/:id/assign', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const username = String(req.body?.username || '').trim();
      if (!username) return res.status(400).json({ ok: false, error: 'missing_username' });
      const lead = await getLead(pool, leadId); if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      const due = calculateSla(lead.handoff_level || lead.intent_level);
      await pool.query(`UPDATE sales_leads SET assigned_to=$2, assigned_at=NOW(), sla_due_at=$3::timestamptz, sla_status=CASE WHEN $3::timestamptz IS NULL THEN 'not_required' ELSE 'open' END, updated_at=NOW() WHERE id=$1`, [leadId, username, due]);
      res.json({ ok: true, lead_id: leadId, assigned_to: username, sla_due_at: due });
    } catch (e) { log.error({ msg: 'sales_assign_lead_failed', err: e?.message || e }); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/leads/:id/stage', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const toStage = String(req.body?.stage || '').trim();
      const t = await transitionLeadStage(pool, {
        leadId, toStage, actorType: 'human', actorId: req.platformAdmin?.username || 'sales',
        reason: req.body?.reason || 'manual_stage_change', sourceType: 'manual', sourceId: 'stage_route', metadata: req.body?.evidence || {},
      });
      if (!t.ok) {
        const status = t.error === 'lead_not_found' ? 404 : 400;
        return res.status(status).json({ ok: false, error: t.error, from_stage: t.from_stage, to_stage: t.to_stage });
      }
      res.json({ ok: true, lead_id: leadId, from_stage: t.from_stage, to_stage: t.to_stage, changed: t.changed });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/leads/:id/actions', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const actionType = String(req.body?.action_type || '').trim();
      const allowed = ['send_case', 'send_demo', 'create_task', 'schedule_meeting', 'pause', 'transfer'];
      if (!allowed.includes(actionType)) return res.status(400).json({ ok: false, error: 'unsupported_action' });
      const lead = await getLead(pool, leadId); if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      let result = null;
      if (actionType === 'create_task') {
        result = await upsertTask(pool, { leadId, title: String(req.body?.title || '销售跟进'), detail: req.body?.detail, dueAt: req.body?.due_at || null, assignee: req.body?.assignee || lead.assigned_to });
      } else if (actionType === 'schedule_meeting') {
        const { createMeeting } = await import('../../services/sales/sales-store.js');
        result = await createMeeting(pool, { leadId, meetingType: req.body?.meeting_type || 'demo', occurredAt: req.body?.occurred_at, rawNotes: req.body?.notes, createdBy: req.platformAdmin?.username });
      } else if (actionType === 'send_case' || actionType === 'send_demo') {
        const text = actionType === 'send_demo' ? String(req.body?.text || '您好，我为您安排一次针对门店情况的系统演示，请回复方便的时间。') : String(req.body?.text || '我先发您一份相关案例，您可以重点看客户分层、触达和回店归因部分。');
        await pool.query(`INSERT INTO sales_messages (conversation_id, lead_id, direction, sender, content, meta) SELECT id, $1, 'outbound', 'human', $2, $3::jsonb FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [leadId, text, JSON.stringify({ action: actionType })]);
        let sendStatus = 'wecom_not_configured';
        if (kfConfigured() && lead.open_kfid && lead.external_userid) {
          const { sendKfText } = await import('../../services/sales/sales-kf.js');
          await sendKfText({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, content: text });
          sendStatus = 'sent';
        }
        result = { text, send_status: sendStatus };
      } else if (actionType === 'pause') {
        const t = await transitionLeadStage(pool, { leadId, toStage: 'paused', actorType: 'human', actorId: req.platformAdmin?.username || 'sales_ops', reason: 'manual_pause', sourceType: 'sales_action', sourceId: 'pause' });
        if (!t.ok) return res.status(409).json({ ok: false, error: t.error, from_stage: t.from_stage, to_stage: t.to_stage });
        result = { stage: 'paused' };
      } else if (actionType === 'transfer') {
        const username = String(req.body?.username || '').trim(); if (!username) return res.status(400).json({ ok: false, error: 'missing_username' });
        await pool.query(`UPDATE sales_leads SET assigned_to=$2, assigned_at=NOW(), updated_at=NOW() WHERE id=$1`, [leadId, username]); result = { assigned_to: username };
      }
      await pool.query(`INSERT INTO sales_action_logs (lead_id, action_type, asset_key, payload, created_by) VALUES ($1,$2,$3,$4::jsonb,$5)`, [leadId, actionType, req.body?.asset_key || null, JSON.stringify(result || req.body || {}), req.platformAdmin?.username || 'sales']);
      res.json({ ok: true, action_type: actionType, result });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/consultant-invite', platformAdminRequired, async (req, res) => {
    try {
      const leadId = Number(req.params.id); const lead = await getLead(pool, leadId); if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      const qr = String(req.body?.qr_url || process.env.WECOM_SALES_CONSULTANT_QR_URL || '').trim();
      if (!qr) return res.status(409).json({ ok: false, error: 'consultant_qr_not_configured', message: '请先配置销售顾问企业微信二维码' });
      let sent = false;
      let text = `为了方便发送Demo资料和后续跟进，请添加专属顾问：${qr}`;
      if (kfConfigured() && lead.open_kfid && lead.external_userid) {
        const { sendKfConsultantCard } = await import('../../services/sales/sales-kf.js');
        const cardResult = await sendKfConsultantCard({ openKfid: lead.open_kfid, externalUserid: lead.external_userid, consultantName: req.body?.consultant_name, qrUrl: qr });
        sent = !!cardResult.ok;
        if (cardResult.content) text = cardResult.content;
      }
      await pool.query(`INSERT INTO sales_action_logs (lead_id, action_type, payload, created_by) VALUES ($1,'consultant_invite',$2::jsonb,$3)`, [leadId, JSON.stringify({ qr_url: qr, sent, text }), req.platformAdmin?.username || 'sales']);
      res.json({ ok: true, sent, text, qr_url: qr, reason: sent ? null : 'wecom_not_configured' });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });
}
