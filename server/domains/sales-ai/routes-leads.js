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
export function registerSalesAiLeadsRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates } = ctx;
  const { contractPriceGate } = gates;

  app.get('/api/admin/sales/leads', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const scope = leadScopeSql(req.platformAdmin, 4);
      const leads = await listLeads(pool, { stage: req.query?.stage, min_score: req.query?.min_score, limit: req.query?.limit }, scope);
      res.json({ ok: true, leads: maskLeadListContact(leads, req.platformAdmin) });
    } catch (e) {
      log.error({ msg: 'sales_list_leads', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 记录级归属校验：查不到 或 无权限 统一返回404，不用403——避免通过状态码差异
  // 就能判断出"这个ID存在但我无权看"，变相把线索ID是否存在这件事泄露出去。
  app.get('/api/admin/sales/leads/:id', platformAdminRequired, sensitiveRateLimit('lead_detail'), async (req, res) => {
    try {
      const data = await getLeadDetail(pool, Number(req.params.id));
      if (!data.ok) return res.status(404).json(data);
      if (!canAccessLead(req.platformAdmin, data.lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      data.lead = maskLeadContact(data.lead, req.platformAdmin);
      res.status(200).json(data);
    } catch (e) {
      log.error({ msg: 'sales_lead_detail', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 签约价格/账期——由销售在首次签约时录入一次，之后基本不变；只有总经理/财务/超级管理员
  // 能读写。这是账单PDF自动生成金额和账期的唯一权威来源(见 tenant-platform-routes.js)。
  app.get('/api/admin/sales/leads/:id/contract-price', platformAdminRequired, contractPriceGate, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({
        ok: true,
        contract_price_fen: lead.contract_price_fen ?? null,
        contract_billing_cycle: lead.contract_billing_cycle || null,
        contract_billing_day: lead.contract_billing_day ?? null,
        contract_price_note: lead.contract_price_note || '',
        contract_price_set_by: lead.contract_price_set_by || null,
        contract_price_set_at: lead.contract_price_set_at || null,
      });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.put('/api/admin/sales/leads/:id/contract-price', platformAdminRequired, contractPriceGate, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      // 跟订单金额(sales_orders.amount_fen)同样的约定：前端表单填元，这里统一转成分存库。
      const priceFen = Math.round(Number(req.body?.contract_price || 0) * 100);
      const cycle = String(req.body?.contract_billing_cycle || '').trim();
      const day = Number(req.body?.contract_billing_day);
      if (priceFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_price', message: '签约价格必须大于0' });
      if (!['monthly', 'quarterly', 'yearly'].includes(cycle)) return res.status(400).json({ ok: false, error: 'invalid_cycle', message: '账期只能是monthly/quarterly/yearly' });
      if (!Number.isInteger(day) || day < 1 || day > 28) return res.status(400).json({ ok: false, error: 'invalid_billing_day', message: '扣款/开票日必须是1-28之间的整数' });
      const r = await pool.query(
        `UPDATE sales_leads SET contract_price_fen=$2, contract_billing_cycle=$3, contract_billing_day=$4,
           contract_price_note=$5, contract_price_set_by=$6, contract_price_set_at=NOW()
         WHERE id=$1 RETURNING contract_price_fen, contract_billing_cycle, contract_billing_day, contract_price_note, contract_price_set_by, contract_price_set_at`,
        [lead.id, priceFen, cycle, day, String(req.body?.contract_price_note || '').trim() || null, req.platformAdmin.username]
      );
      res.json({ ok: true, ...r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  // 受控查看完整联系方式：列表/详情接口默认脱敏，需要真实拨打电话时走这个接口，
  // 必须带业务原因；POST请求会被 platformAdminRequired 中间件自动写入
  // platform_admin_audit_log(admin_username/path/target_tenant_id/detail/ip)，不用另建审计表。
  app.post('/api/admin/sales/leads/:id/reveal-contact', platformAdminRequired, sensitiveRateLimit('reveal_contact'), async (req, res) => {
    try {
      const reason = String(req.body?.reason || '').trim();
      if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });
      const leadId = Number(req.params.id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!canViewFullContact(req.platformAdmin, lead)) return res.status(403).json({ ok: false, error: 'forbidden' });
      res.json({ ok: true, phone: lead.phone || null, legal_contact_phone: lead.legal_contact_phone || null });
    } catch (e) {
      log.error({ msg: 'sales_reveal_contact', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 统一客户时间线：售前(线索事件/阶段/对话) + 售后(已开通租户的健康度事件)，
  // 销售/客户成功接手时不用再让客户重复一遍已经聊过的信息
  app.get('/api/admin/sales/leads/:id/timeline', platformAdminRequired, sensitiveRateLimit('lead_timeline'), async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const lead = await getLead(pool, leadId);
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await getUnifiedCustomerTimeline(pool, leadId);
      res.status(data.ok ? 200 : 404).json(data);
    } catch (e) {
      log.error({ msg: 'sales_unified_timeline', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 供 agents-service-v2 的"首月每周运行检测报告"调用，用同一套内部密钥口径
  // (X-Miniprogram-Sync-Secret)，不复用 platformAdminRequired(那是面向后台管理员会话的)。
  app.post('/api/internal/sales/tenant-onboarding-checklist', async (req, res) => {
    try {
      const secret = String(req.headers['x-miniprogram-sync-secret'] || '');
      const expected = String(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '');
      if (!expected || secret !== expected) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const data = await getOnboardingChecklist(pool, req.body?.tenant_id);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_internal_onboarding_checklist', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 客户上线进度清单：新开通租户是否具备"数据条件+基础配置"就绪，复用已有巡检信号
  app.get('/api/admin/sales/tenants/:tenantId/onboarding', platformAdminRequired, sensitiveRateLimit('tenant_onboarding'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await getOnboardingChecklist(pool, req.params.tenantId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_onboarding_checklist', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 单租户续费健康度：透明加减分，续费风险/转介绍候选列表都是基于这个分数派生的
  app.get('/api/admin/sales/tenants/:tenantId/renewal-health', platformAdminRequired, sensitiveRateLimit('tenant_renewal_health'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await computeRenewalHealth(pool, req.params.tenantId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_renewal_health', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 续费风险清单：分数<60或授权14天内到期的租户，按风险从高到低排；非manager只看自己范围内的租户
  app.get('/api/admin/sales/renewal-risks', platformAdminRequired, sensitiveRateLimit('renewal_risks'), async (req, res) => {
    try {
      const all = await listRenewalRisks(pool, { limit: Number(req.query.limit) || 50 });
      const items = [];
      for (const item of all) {
        if (await canAccessTenant(pool, req.platformAdmin, item.tenant_id)) items.push(item);
      }
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'sales_renewal_risks', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 转介绍候选：稳定使用满60天、健康分≥80、无逾期异常的客户；非manager只看自己范围内的租户
  app.get('/api/admin/sales/referral-candidates', platformAdminRequired, sensitiveRateLimit('referral_candidates'), async (req, res) => {
    try {
      const all = await listReferralCandidates(pool, { limit: Number(req.query.limit) || 50 });
      const items = [];
      for (const item of all) {
        if (await canAccessTenant(pool, req.platformAdmin, item.tenant_id)) items.push(item);
      }
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'sales_referral_candidates', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 月度客户价值报告：证明续费理由，供销售/客户成功在续费沟通前查看或发送给客户
  app.get('/api/admin/sales/tenants/:tenantId/value-report', platformAdminRequired, sensitiveRateLimit('tenant_value_report'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await buildTenantMonthlyValueReport(pool, req.params.tenantId, { month: req.query.month });
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_tenant_value_report', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

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

  app.post('/api/admin/sales/sandbox/chat', platformAdminRequired, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const externalUserid = String(req.body?.external_userid || req.body?.session_key || '').trim() || `sandbox_${req.user?.username || 'admin'}`;
      const welcome = !!req.body?.welcome;
      const inputMode = req.body?.input_mode === 'voice' ? 'voice' : 'text';
      const data = await handleInboundMessage(pool, { text: welcome && !text ? '' : text, openKfid: 'sandbox', externalUserid, sourceChannel: 'sandbox', welcome, inputMode });
      res.json(data);
    } catch (e) {
      log.error({ msg: 'sales_sandbox_chat', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/sales/leads/:id/takeover', platformAdminRequired, async (req, res) => {
    try {
      const data = await takeoverConversation(pool, Number(req.params.id), { ownerUsername: req.user?.username || req.body?.owner_username });
      res.status(data.ok ? 200 : 404).json(data);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/release-ai', platformAdminRequired, async (req, res) => {
    try {
      res.json(await releaseToAi(pool, Number(req.params.id)));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/reply', platformAdminRequired, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'empty' });
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      if (detail.conversation?.controller !== 'human' && detail.lead.controller !== 'human') {
        return res.status(400).json({ ok: false, error: 'not_in_human_control', message: '请先接管会话' });
      }
      const result = await recordSalesReply(pool, Number(req.params.id), text, { sender: req.user?.username || 'human' });
      if (detail.lead.open_kfid && detail.lead.open_kfid !== 'sandbox' && detail.lead.external_userid && kfConfigured()) {
        try {
          const { sendKfText } = await import('../../services/sales/sales-kf.js');
          await sendKfText({ openKfid: detail.lead.open_kfid, externalUserid: detail.lead.external_userid, content: text });
        } catch (e) {
          return res.json({ ok: true, saved: true, overcommit_risks: result.overcommit_risks, send_error: e?.message || String(e) });
        }
      }
      res.json({ ok: true, saved: true, overcommit_risks: result.overcommit_risks });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/draft-reply', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const draft = await draftCustomerReply({ lead: detail.lead, messages: detail.messages, advice: detail.advice });
      if (!draft.ok) return res.json({ ok: false, error: draft.error, message: '暂无法生成草稿，请手动编写' });
      res.json({ ok: true, text: draft.text });
    } catch (e) {
      log.error({ msg: 'sales_draft_reply', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/quick-reply', platformAdminRequired, async (req, res) => {
    try {
      const scenario = String(req.body?.scenario || '').trim();
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const draft = draftQuickReplyByScenario({ lead: detail.lead, scenario });
      res.json(draft);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/diagnosis', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      res.json({ ok: true, diagnosis: detail.diagnosis });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/leads/:id/check-overcommit', platformAdminRequired, async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'empty' });
      const price = checkPricePermission({ role: 'platform_admin', ...req.platformAdmin }, text);
      const risks = [...detectOvercommitment(text), ...price.risks];
      res.json({ ok: true, risks, price_permission: price });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/objections/response', platformAdminRequired, async (req, res) => {
    try {
      const key = String(req.body?.objection_key || '').trim();
      if (!key) return res.status(400).json({ ok: false, error: 'missing_key' });
      const resp = draftStandardResponse(key);
      res.json(resp.ok ? { ok: true, ...resp } : { ok: false, error: resp.error });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
