import { ensureSalesTables, getLead, addEvent, newLeadKey } from '../../services/sales/sales-store.js';
import { provisionTenantFromOrder, rotateTenantAdminCredentials } from '../../services/sales-provisioning.js';
import { getCreditRisk } from '../../services/sales/sales-credit-risk.js';
import { brandKey, getCreditPoolRisk } from '../../services/sales/sales-order-credit.js';
import { canAccessLead, isManager } from '../../services/sales/sales-permissions.js';
import { completeDeployCheck } from '../../services/sales/onboarding-sla-service.js';
import { deliverHealthCheckReport } from '../../services/sales/health-check-period-service.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-finance' });


/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */

/** @param { app: any, pool: any, platformAdminRequired: Function, gates: object } ctx */
export function registerSalesAiFinanceContractRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates } = ctx;
  const {
    financeGate,
    financeOrCsGate,
    generalManagerGate,
    salesCreateCustomerGate,
    ensureInvoiceRequestForOrder,
    autoProvisionIfEligible,
  } = gates;

  app.post('/api/admin/sales/leads/:id/contracts', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const contractNo = String(req.body?.contract_no || '').trim();
      const amountFen = Math.round(Number(req.body?.amount || 0) * 100);
      if (!contractNo || amountFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_contract' });
      const r = await pool.query(
        `INSERT INTO sales_contracts (lead_id,contract_no,status,amount_fen,file_url,file_name,created_by,version_no,supersedes_contract_id)
         VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8) RETURNING *`,
        [lead.id, contractNo, amountFen, req.body?.file_url || null, req.body?.file_name || null, req.platformAdmin.username, Math.max(1, Number(req.body?.version_no) || 1), req.body?.supersedes_contract_id ? Number(req.body.supersedes_contract_id) : null]
      );
      await pool.query(`INSERT INTO sales_credit_accounts (lead_id,payment_type,credit_limit_fen,status) VALUES ($1,'cash',0,'active') ON CONFLICT (lead_id) DO NOTHING`, [lead.id]);
      res.json({ ok: true, contract: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.get('/api/admin/sales/leads/:id/crm-overview', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      const [contracts, payments, invoices, delivery, contentDeliveries, risk, orders, creditPoolRow] = await Promise.all([
        pool.query(`SELECT * FROM sales_contracts WHERE lead_id=$1 ORDER BY created_at DESC`, [lead.id]),
        pool.query(`SELECT p.* FROM sales_payments p JOIN sales_contracts c ON c.id=p.contract_id WHERE c.lead_id=$1 ORDER BY p.created_at DESC`, [lead.id]),
        pool.query(`SELECT i.* FROM sales_invoices i JOIN sales_contracts c ON c.id=i.contract_id WHERE c.lead_id=$1 ORDER BY i.created_at DESC`, [lead.id]),
        pool.query(`SELECT * FROM sales_delivery_projects WHERE lead_id=$1`, [lead.id]),
        pool.query(`SELECT d.*,a.title AS asset_title,a.content_type FROM sales_content_deliveries d LEFT JOIN sales_content_assets a ON a.id=d.asset_id WHERE d.lead_id=$1 ORDER BY d.created_at DESC LIMIT 50`, [lead.id]),
        getCreditRisk(pool, lead.id),
        pool.query(`SELECT o.*,p.brand_name,p.payment_type,p.credit_limit_fen,p.status AS pool_status FROM sales_orders o JOIN sales_credit_pools p ON p.id=o.credit_pool_id WHERE o.lead_id=$1 ORDER BY o.created_at DESC`, [lead.id]),
        pool.query(`SELECT p.* FROM sales_credit_pools p JOIN sales_credit_pool_members m ON m.credit_pool_id=p.id WHERE m.lead_id=$1`, [lead.id]),
      ]);
      const creditPool = creditPoolRow.rows?.[0] ? await getCreditPoolRisk(pool, creditPoolRow.rows[0].id) : null;
      res.json({ ok: true, contracts: contracts.rows, payments: payments.rows, invoices: invoices.rows, delivery: delivery.rows?.[0] || null, content_deliveries: contentDeliveries.rows, credit_risk: risk, orders: orders.rows, credit_pool: creditPool });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.patch('/api/admin/sales/contracts/:id/status', platformAdminRequired, async (req, res) => {
    try {
      const status = String(req.body?.status || '').trim();
      if (!['customer_signed', 'our_signed', 'effective', 'cancelled'].includes(status)) return res.status(400).json({ ok: false, error: 'invalid_contract_status' });
      const c = await pool.query(`SELECT c.*,l.owner_username,l.assigned_to,l.cs_owner_username FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
      const contract = c.rows?.[0];
      if (!contract || !canAccessLead(req.platformAdmin, contract)) return res.status(404).json({ ok: false, error: 'not_found' });
      if ((status === 'our_signed' || status === 'effective' || status === 'cancelled') && !isManager(req.platformAdmin)) return res.status(403).json({ ok: false, error: 'manager_required' });
      if (status === 'effective' && (!contract.customer_signed_at || !contract.our_signed_at)) return res.status(409).json({ ok: false, error: 'both_signatures_required' });
      const signedFile = String(req.body?.file_url || '').trim() || null;
      const r = await pool.query(
        `UPDATE sales_contracts SET status=$2,
           customer_signed_at=CASE WHEN $2='customer_signed' THEN NOW() ELSE customer_signed_at END,
           customer_signed_file_url=CASE WHEN $2='customer_signed' THEN COALESCE($3,customer_signed_file_url) ELSE customer_signed_file_url END,
           our_signed_at=CASE WHEN $2='our_signed' THEN NOW() ELSE our_signed_at END,
           our_signed_file_url=CASE WHEN $2='our_signed' THEN COALESCE($3,our_signed_file_url) ELSE our_signed_file_url END,
           effective_at=CASE WHEN $2='effective' THEN NOW() ELSE effective_at END,
           approved_by=CASE WHEN $2 IN ('our_signed','effective') THEN $4 ELSE approved_by END,updated_at=NOW()
         WHERE id=$1 RETURNING *`, [contract.id, status, signedFile, req.platformAdmin.username]
      );
      const risk = status === 'effective' ? await getCreditRisk(pool, contract.lead_id) : null;
      const provision = status === 'effective' ? await autoProvisionIfEligible(contract.lead_id, req.platformAdmin.username) : null;
      res.json({ ok: true, contract: r.rows[0], credit_risk: risk, provision });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/contracts/:id/payments', platformAdminRequired, async (req, res) => {
    try {
      const r = await pool.query(`SELECT c.*, l.owner_username, l.assigned_to, l.cs_owner_username FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
      const contract = r.rows?.[0];
      if (!contract || !canAccessLead(req.platformAdmin, contract)) return res.status(404).json({ ok: false, error: 'not_found' });
      const amountFen = Math.round(Number(req.body?.amount || 0) * 100);
      if (amountFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_payment' });
      const p = await pool.query(`INSERT INTO sales_payments (contract_id,amount_fen,paid_at,receipt_url,status,submitted_by,note) VALUES ($1,$2,$3,$4,'pending',$5,$6) RETURNING *`, [contract.id, amountFen, req.body?.paid_at || null, req.body?.receipt_url || null, req.platformAdmin.username, req.body?.note || null]);
      res.json({ ok: true, payment: p.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/payments/:id/confirm', platformAdminRequired, financeGate, async (req, res) => {
    try {
      const p = await pool.query(`UPDATE sales_payments SET status='confirmed',confirmed_by=$2,confirmed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING *`, [Number(req.params.id), req.platformAdmin.username]);
      if (!p.rows?.[0]) return res.status(409).json({ ok: false, error: 'payment_not_pending' });
      const lead = await pool.query(`SELECT c.lead_id FROM sales_contracts c WHERE c.id=$1`, [p.rows[0].contract_id]);
      const risk = lead.rows?.[0] ? await getCreditRisk(pool, lead.rows[0].lead_id) : null;
      const provision = lead.rows?.[0] ? await autoProvisionIfEligible(lead.rows[0].lead_id, req.platformAdmin.username) : null;
      res.json({ ok: true, payment: p.rows[0], credit_risk: risk, provision });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.get('/api/admin/sales/finance/pending-payments', platformAdminRequired, financeGate, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT p.*,c.contract_no,c.lead_id,l.company,l.name FROM sales_payments p JOIN sales_contracts c ON c.id=p.contract_id JOIN sales_leads l ON l.id=c.lead_id WHERE p.status='pending' ORDER BY p.created_at ASC`);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.get('/api/admin/sales/finance/pending-invoices', platformAdminRequired, financeOrCsGate, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT i.*,c.contract_no,c.lead_id,l.company,l.name FROM sales_invoices i JOIN sales_contracts c ON c.id=i.contract_id JOIN sales_leads l ON l.id=c.lead_id WHERE i.status='requested' ORDER BY i.created_at ASC`);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.post('/api/admin/sales/contracts/:id/invoices', platformAdminRequired, async (req, res) => {
    try {
      const c = await pool.query(`SELECT c.*,l.owner_username,l.assigned_to,l.cs_owner_username FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
      if (!c.rows?.[0] || !canAccessLead(req.platformAdmin, c.rows[0])) return res.status(404).json({ ok: false, error: 'not_found' });
      const amountFen = Math.round(Number(req.body?.amount || 0) * 100);
      if (amountFen <= 0) return res.status(400).json({ ok: false, error: 'invalid_invoice_amount' });
      const r = await pool.query(`INSERT INTO sales_invoices (contract_id,amount_fen,status,requested_by) VALUES ($1,$2,'requested',$3) RETURNING *`, [c.rows[0].id, amountFen, req.platformAdmin.username]);
      res.json({ ok: true, invoice: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.patch('/api/admin/sales/invoices/:id/issued', platformAdminRequired, financeGate, async (req, res) => {
    try {
      const r = await pool.query(`UPDATE sales_invoices SET status='issued',invoice_no=$2,file_url=$3,issued_by=$4,issued_at=NOW(),resolved_by=$4,resolved_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='requested' RETURNING *`, [Number(req.params.id), req.body?.invoice_no || null, req.body?.file_url || null, req.platformAdmin.username]);
      if (!r.rows?.[0]) return res.status(409).json({ ok: false, error: 'invoice_not_requested' });
      res.json({ ok: true, invoice: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  // 客户明确表示不需要发票——财务或客服都能操作，停止后续提醒。
  app.patch('/api/admin/sales/invoices/:id/ignore', platformAdminRequired, financeOrCsGate, async (req, res) => {
    try {
      const reason = String(req.body?.reason || '客户不需要发票').trim();
      const r = await pool.query(`UPDATE sales_invoices SET status='cancelled',ignored_reason=$2,resolved_by=$3,resolved_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='requested' RETURNING *`, [Number(req.params.id), reason, req.platformAdmin.username]);
      if (!r.rows?.[0]) return res.status(409).json({ ok: false, error: 'invoice_not_requested' });
      res.json({ ok: true, invoice: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });
}
