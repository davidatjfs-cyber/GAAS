import { ensureSalesTables, getLead, addEvent, newLeadKey } from '../../services/sales/sales-store.js';
import { rotateTenantAdminCredentials } from '../../services/sales-provisioning.js';

import { canAccessLead } from '../../services/sales/sales-permissions.js';
import { completeDeployCheck } from '../../services/sales/onboarding-sla-service.js';
import { deliverHealthCheckReport } from '../../services/sales/health-check-period-service.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-finance' });

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */

/** @param { app: any, pool: any, platformAdminRequired: Function, gates: object } ctx */
export function registerSalesAiFinanceDeliveryRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates } = ctx;
  const {
    salesCreateCustomerGate,
  } = gates;

  app.get('/api/admin/sales/leads/:id/delivery', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const r = await pool.query(`SELECT * FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      res.json({ ok: true, project: r.rows?.[0] || null });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.put('/api/admin/sales/leads/:id/delivery', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const allowed = ['pending', 'assigned', 'data_import', 'diagnosis', 'configuration', 'acceptance', 'delivered'];
      const status = String(req.body?.status || '').trim();
      if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'invalid_delivery_status' });
      if (!['super_admin', 'customer_service', 'implementation'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const prior = await pool.query(`SELECT status FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      const r = await pool.query(
        `UPDATE sales_delivery_projects SET status=$2, implementation_owner=COALESCE($3,implementation_owner), cs_owner=COALESCE($4,cs_owner),
           assigned_at=CASE WHEN $2='assigned' THEN COALESCE(assigned_at,NOW()) ELSE assigned_at END,
           data_imported_at=CASE WHEN $2='data_import' THEN COALESCE(data_imported_at,NOW()) ELSE data_imported_at END,
           diagnosis_completed_at=CASE WHEN $2='diagnosis' THEN COALESCE(diagnosis_completed_at,NOW()) ELSE diagnosis_completed_at END,
           configured_at=CASE WHEN $2='configuration' THEN COALESCE(configured_at,NOW()) ELSE configured_at END,
           acceptance_completed_at=CASE WHEN $2='acceptance' THEN COALESCE(acceptance_completed_at,NOW()) ELSE acceptance_completed_at END,
           account_sent_at=CASE WHEN $2='delivered' THEN COALESCE(account_sent_at,NOW()) ELSE account_sent_at END,
           accepted_at=CASE WHEN $2='delivered' THEN COALESCE(accepted_at,NOW()) ELSE accepted_at END,updated_at=NOW()
         WHERE lead_id=$1 RETURNING *`,
        [lead.id, status, req.body?.implementation_owner || null, req.body?.cs_owner || null]
      );
      if (!r.rows?.[0]) return res.status(409).json({ ok: false, error: 'delivery_project_not_created' });
      const credentials = status === 'delivered' && prior.rows?.[0]?.status !== 'delivered' ? await rotateTenantAdminCredentials(pool, lead.id) : null;
      res.json({ ok: true, project: r.rows[0], credentials });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/delivery/deploy-check-complete', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!['super_admin', 'customer_service', 'implementation'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const project = await pool.query(`SELECT id FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      if (!project.rows?.[0]) return res.status(409).json({ ok: false, error: 'delivery_project_not_created' });
      const updated = await completeDeployCheck(pool, project.rows[0].id);
      res.json({ ok: true, project: updated });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/leads/:id/delivery/health-check-report', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      if (!['super_admin', 'customer_service', 'implementation'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden' });
      const project = await pool.query(`SELECT id FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]);
      if (!project.rows?.[0]) return res.status(409).json({ ok: false, error: 'delivery_project_not_created' });
      const updated = await deliverHealthCheckReport(pool, project.rows[0].id, req.body?.report_ref);
      res.json({ ok: true, project: updated });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  // 销售自主拜访、转介绍、展会等非客户 AI 来源，统一在此建立客户档案。
  // 数据仍落在 sales_leads，确保后续拜访、合同、回款、授信、开通和交付完全复用同一闭环；
  // 但对业务界面使用 customer_code，不再把内部“线索”编号暴露给用户。
  app.post('/api/admin/sales/customers', platformAdminRequired, salesCreateCustomerGate, async (req, res) => {
    const body = req.body || {};
    const company = String(body.company || '').trim();
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const contactTitle = String(body.contact_title || '').trim();
    const rawBrands = Array.isArray(body.customer_brands) ? body.customer_brands : [];
    const customerBrands = rawBrands.map((item) => ({
      brand_name: String(item?.brand_name || '').trim(),
      city: String(item?.city || '').trim(),
      store_count: Math.max(0, Number(item?.store_count) || 0),
    })).filter((item) => item.brand_name || item.city || item.store_count);
    const customerCities = [...new Set(customerBrands.map((item) => item.city).filter(Boolean))];
    const city = customerCities[0] || String(body.city || '').trim();
    const storeCount = customerBrands.reduce((total, item) => total + item.store_count, 0) || Number(body.store_count) || null;
    const customerContacts = [{ name, title: contactTitle, phone }].filter((item) => item.name || item.phone);
    const requestedPaymentType = String(body.requested_payment_type || 'cash').trim();
    const requestedCreditDays = Math.max(0, Number(body.requested_credit_days) || 0);
    const requestedCreditLimitFen = Math.max(0, Math.round(Number(body.requested_credit_limit || 0) * 100));
    const origin = String(body.customer_origin || 'sales_visit').trim();
    const allowedOrigins = new Set(['sales_visit', 'referral', 'exhibition', 'phone_outreach', 'other']);
    if (!company) return res.status(400).json({ ok: false, error: 'company_required', message: '请填写客户企业名称' });
    if (!name && !phone) return res.status(400).json({ ok: false, error: 'contact_required', message: '请至少填写联系人姓名或联系电话' });
    if (!customerBrands.length) return res.status(400).json({ ok: false, error: 'brand_required', message: '请至少填写一个品牌、城市和门店数量' });
    if (customerBrands.some((item) => !item.brand_name || !item.city || !item.store_count)) return res.status(400).json({ ok: false, error: 'brand_invalid', message: '每个品牌都需要填写品牌名称、城市和门店数量' });
    if (!['cash', 'credit'].includes(requestedPaymentType)) return res.status(400).json({ ok: false, error: 'payment_type_invalid', message: '客户性质不正确' });
    if (requestedPaymentType === 'credit' && (!requestedCreditDays || !requestedCreditLimitFen)) return res.status(400).json({ ok: false, error: 'credit_terms_required', message: '帐期客户请填写申请账期天数和申请授信金额' });
    if (!allowedOrigins.has(origin)) return res.status(400).json({ ok: false, error: 'invalid_origin', message: '客户来源不正确' });
    try {
      await ensureSalesTables(pool);
      const duplicate = await pool.query(
        `SELECT * FROM sales_leads
          WHERE ($1 <> '' AND phone = $1)
             OR (LOWER(COALESCE(company,'')) = LOWER($2) AND COALESCE(city,'') = $3)
          ORDER BY updated_at DESC LIMIT 1`,
        [phone, company, city]
      );
      const existing = duplicate.rows?.[0];
      if (existing) {
        if (canAccessLead(req.platformAdmin, existing)) {
          return res.status(409).json({ ok: false, error: 'customer_exists', message: '该客户已建档，请直接打开已有客户档案', existing: { id: existing.id, customer_code: existing.customer_code || null, company: existing.company, name: existing.name } });
        }
        return res.status(409).json({ ok: false, error: 'customer_exists', message: '该客户已建档，请联系销售经理确认归属' });
      }
      const owner = req.platformAdmin?.username || null;
      const visitNotes = String(body.first_visit_notes || '').trim();
      const followupAt = body.next_followup_at ? new Date(body.next_followup_at) : null;
      const r = await pool.query(
        `INSERT INTO sales_leads
          (lead_key, customer_code, customer_origin, source_channel, manual_created_by, manual_created_at,
           name, company, phone, city, region_code, region_name, cuisine, store_count, pos_brand,
           legal_contact_name, legal_contact_title, legal_contact_phone,
           customer_brands, customer_cities, customer_contacts,
           requested_payment_type, requested_credit_days, requested_credit_limit_fen,
           stage, controller, intent_score, intent_level, owner_username, assigned_to,
           next_action, next_action_due, tags, extracted)
         VALUES ($1,$2,$3,'manual',$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22,
                 'sales_takeover','human',0,'low',$4,$4,
                 $23,$24::timestamptz,$25::jsonb,$26::jsonb)
         RETURNING *`,
        [
          newLeadKey('M'), `KH${Date.now().toString().slice(-8)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`,
          origin, owner, name || null, company, phone || null, city || null,
          String(body.region_code || '').trim() || null, String(body.region_name || '').trim() || null,
          String(body.cuisine || '').trim() || null, storeCount, String(body.pos_brand || customerBrands[0]?.brand_name || '').trim() || null,
          name || null, contactTitle || null, phone || null,
          JSON.stringify(customerBrands), JSON.stringify(customerCities), JSON.stringify(customerContacts),
          requestedPaymentType, requestedPaymentType === 'credit' ? requestedCreditDays : null, requestedPaymentType === 'credit' ? requestedCreditLimitFen : null,
          String(body.next_action || '补全客户档案并安排下一次跟进').trim(), followupAt && !Number.isNaN(followupAt.getTime()) ? followupAt.toISOString() : null,
          JSON.stringify(['销售自主建档']), JSON.stringify({ source: 'manual_customer', first_visit_notes: visitNotes || null, customer_brands: customerBrands, requested_payment_type: requestedPaymentType }),
        ]
      );
      const customer = r.rows?.[0];
      await pool.query(
        `INSERT INTO sales_conversations (lead_id, controller, status, meta) VALUES ($1,'human','open',$2::jsonb)`,
        [customer.id, JSON.stringify({ source: 'manual_customer', customer_origin: origin })]
      );
      await addEvent(pool, customer.id, {
        event_type: 'MANUAL_CUSTOMER_CREATED', summary: '销售自主建立客户档案', evidence: visitNotes || null,
        priority: 'normal', recommended_action: customer.next_action, actor_type: 'human', actor_id: owner,
        source_type: 'manual_customer', source_id: origin, payload: { customer_origin: origin, first_visit_notes: visitNotes || null },
      });
      res.status(201).json({ ok: true, customer });
    } catch (e) {
      log.error({ msg: 'sales_create_manual_customer_failed', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error', message: '客户建档失败，请稍后重试' });
    }
  });
}
