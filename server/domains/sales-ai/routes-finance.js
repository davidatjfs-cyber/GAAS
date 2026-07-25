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
export function registerSalesAiFinanceRoutes(ctx) {
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

  app.get('/api/admin/sales/leads/:id/credit-risk', platformAdminRequired, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead || !canAccessLead(req.platformAdmin, lead)) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json(await getCreditRisk(pool, lead.id));
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  app.put('/api/admin/sales/leads/:id/credit-risk', platformAdminRequired, generalManagerGate, async (req, res) => {
    try {
      const lead = await getLead(pool, Number(req.params.id));
      if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
      const paymentType = String(req.body?.payment_type || '').trim();
      const limitFen = Math.round(Number(req.body?.credit_limit || 0) * 100);
      if (!['cash', 'credit'].includes(paymentType) || (paymentType === 'credit' && limitFen <= 0)) return res.status(400).json({ ok: false, error: 'invalid_credit_terms' });
      const r = await pool.query(
        `INSERT INTO sales_credit_accounts (lead_id,payment_type,credit_limit_fen,status,approved_by,approved_at,lock_reason)
         VALUES ($1,$2,$3,'active',$4,NOW(),NULL)
         ON CONFLICT (lead_id) DO UPDATE SET payment_type=EXCLUDED.payment_type,credit_limit_fen=EXCLUDED.credit_limit_fen,status='active',approved_by=EXCLUDED.approved_by,approved_at=NOW(),lock_reason=NULL,updated_at=NOW()
         RETURNING *`, [lead.id, paymentType, paymentType === 'cash' ? 0 : limitFen, req.platformAdmin.username]
      );
      const risk = await getCreditRisk(pool, lead.id);
      const provision = await autoProvisionIfEligible(lead.id, req.platformAdmin.username);
      res.json({ ok: true, account: r.rows[0], risk, provision });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message }); }
  });

  app.post('/api/admin/sales/contracts/:id/submit-approval', platformAdminRequired, async (req, res) => {
    const r = await pool.query(`SELECT c.*,l.owner_username,l.assigned_to FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
    const contract = r.rows?.[0];
    if (!contract || !canAccessLead(req.platformAdmin, contract)) return res.status(404).json({ ok:false,error:'not_found' });
    if (!contract.file_url) return res.status(400).json({ ok:false,error:'signed_contract_required',message:'请先上传签约合同文件' });
    const updated = await pool.query(`UPDATE sales_contracts SET approval_status='pending',submitted_by=$2,submitted_at=NOW(),updated_at=NOW() WHERE id=$1 AND approval_status IN ('draft','rejected') RETURNING *`, [contract.id, req.platformAdmin.username]);
    if (!updated.rows?.[0]) return res.status(409).json({ ok:false,error:'approval_not_submittable' });
    res.json({ ok:true,contract:updated.rows[0] });
  });

  app.get('/api/admin/sales/approvals/contracts', platformAdminRequired, generalManagerGate, async (_req,res) => {
    const r = await pool.query(`SELECT c.*,l.company,l.name FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.approval_status='pending' ORDER BY c.submitted_at ASC`);
    res.json({ ok:true, items:r.rows });
  });

  app.post('/api/admin/sales/contracts/:id/approve', platformAdminRequired, generalManagerGate, async (req,res) => {
    const contractRow = await pool.query(`SELECT c.*,l.company,l.name,l.id AS lead_id FROM sales_contracts c JOIN sales_leads l ON l.id=c.lead_id WHERE c.id=$1`, [Number(req.params.id)]);
    const contract = contractRow.rows?.[0];
    const paymentType = String(req.body?.payment_type || 'cash');
    const limitFen = Math.round(Number(req.body?.credit_limit || 0) * 100);
    const brandName = String(req.body?.brand_name || contract?.company || '').trim();
    if (!contract || contract.approval_status !== 'pending') return res.status(409).json({ ok:false,error:'approval_not_pending' });
    if (!['cash','credit'].includes(paymentType) || !brandName || (paymentType === 'credit' && limitFen <= 0)) return res.status(400).json({ ok:false,error:'invalid_credit_terms',message:'帐期客户必须填写品牌名称和授信金额' });
    const poolResult = await pool.query(`INSERT INTO sales_credit_pools (brand_key,brand_name,payment_type,credit_limit_fen,status,approved_by,approved_at,lock_reason)
      VALUES ($1,$2,$3,$4,'active',$5,NOW(),NULL) ON CONFLICT (brand_key) DO UPDATE SET brand_name=EXCLUDED.brand_name,payment_type=EXCLUDED.payment_type,credit_limit_fen=EXCLUDED.credit_limit_fen,status='active',approved_by=EXCLUDED.approved_by,approved_at=NOW(),lock_reason=NULL,updated_at=NOW() RETURNING *`, [brandKey(brandName),brandName,paymentType,paymentType==='credit'?limitFen:0,req.platformAdmin.username]);
    await pool.query(`INSERT INTO sales_credit_pool_members (lead_id,credit_pool_id) VALUES ($1,$2) ON CONFLICT (lead_id) DO UPDATE SET credit_pool_id=EXCLUDED.credit_pool_id`, [contract.lead_id,poolResult.rows[0].id]);
    const approved = await pool.query(`UPDATE sales_contracts SET approval_status='approved',status='effective',approved_by=$2,approved_at=NOW(),approval_note=$3,payment_type=$4,brand_name=$5,effective_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`, [contract.id,req.platformAdmin.username,String(req.body?.approval_note||''),paymentType,brandName]);
    res.json({ ok:true, contract:approved.rows[0], credit_pool:poolResult.rows[0] });
  });

  app.post('/api/admin/sales/leads/:id/orders', platformAdminRequired, salesCreateCustomerGate, async (req,res) => {
    const lead = await getLead(pool, Number(req.params.id));
    const body=req.body||{}; const amountFen=Math.round(Number(body.amount||0)*100);
    if (!lead || !canAccessLead(req.platformAdmin,lead)) return res.status(404).json({ok:false,error:'not_found'});
    if (!['new_store','renewal'].includes(body.order_type) || !String(body.store_name||'').trim() || amountFen<=0) return res.status(400).json({ok:false,error:'invalid_order',message:'请填写订单类型、门店名称和订单金额'});
    const contract=await pool.query(`SELECT * FROM sales_contracts WHERE id=$1 AND lead_id=$2 AND approval_status='approved' LIMIT 1`,[Number(body.contract_id),lead.id]);
    const member=await pool.query(`SELECT credit_pool_id FROM sales_credit_pool_members WHERE lead_id=$1`,[lead.id]);
    if (!contract.rows?.[0] || !member.rows?.[0]) return res.status(409).json({ok:false,error:'approved_contract_required',message:'必须先完成总经理合同及授信审批后才能新建订单'});
    const no=`ORD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Date.now().toString().slice(-6)}`;
    const qty=Math.max(1,Number(body.store_quantity)||1); const licenseDays=Math.max(1,Number(body.license_days)||365); const brandName=String(body.brand_name||'').trim(); const orderBrandKey=brandName ? brandKey(brandName) : null;
    const order=await pool.query(`INSERT INTO sales_orders (order_no,lead_id,contract_id,credit_pool_id,order_type,store_quantity,license_days,amount_fen,store_name,brand_name,brand_key,store_address,contact_name,contact_phone,area_sqm,restaurant_type,submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[no,lead.id,contract.rows[0].id,member.rows[0].credit_pool_id,body.order_type,qty,licenseDays,amountFen,String(body.store_name).trim(),brandName||null,orderBrandKey,body.store_address||null,body.contact_name||null,body.contact_phone||null,Number(body.area_sqm)||null,body.restaurant_type||null,req.platformAdmin.username]);
    res.status(201).json({ok:true,order:order.rows[0]});
  });

  app.get('/api/admin/sales/finance/orders', platformAdminRequired, financeGate, async (_req,res) => {
    const r=await pool.query(`SELECT o.*,l.company,l.name,p.brand_name,p.payment_type,p.credit_limit_fen,p.status AS pool_status FROM sales_orders o JOIN sales_leads l ON l.id=o.lead_id JOIN sales_credit_pools p ON p.id=o.credit_pool_id WHERE o.status='finance_pending' ORDER BY o.submitted_at ASC`);
    res.json({ok:true,items:r.rows});
  });

  app.post('/api/admin/sales/orders/:id/finance-decision', platformAdminRequired, financeGate, async (req,res) => {
    const orderRow=await pool.query(`SELECT o.*,p.payment_type,p.status AS pool_status FROM sales_orders o JOIN sales_credit_pools p ON p.id=o.credit_pool_id WHERE o.id=$1`,[Number(req.params.id)]);
    const order=orderRow.rows?.[0]; const action=String(req.body?.action||'');
    if(!order || order.status!=='finance_pending') return res.status(409).json({ok:false,error:'order_not_pending'});
    if(action==='return'){const u=await pool.query(`UPDATE sales_orders SET status='returned',return_reason=$2,finance_by=$3,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,String(req.body?.reason||'财务退回'),req.platformAdmin.username]);return res.json({ok:true,order:u.rows[0]});}
    if(order.payment_type==='cash' && action==='confirm_paid'){
      const paidFen=Math.round(Number(req.body?.amount||order.amount_fen/100)*100); if(paidFen<=0) return res.status(400).json({ok:false,error:'invalid_payment'});
      await pool.query(`INSERT INTO sales_order_payments (order_id,amount_fen,receipt_url,received_by,note) VALUES ($1,$2,$3,$4,$5)`,[order.id,paidFen,req.body?.receipt_url||null,req.platformAdmin.username,req.body?.note||null]);
      const u=await pool.query(`UPDATE sales_orders SET status='paid',finance_by=$2,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,req.platformAdmin.username]);
      await ensureInvoiceRequestForOrder(u.rows[0], req.platformAdmin.username);
      const provision=await provisionTenantFromOrder(pool,order.id,{startedBy:req.platformAdmin.username}); return res.json({ok:true,order:u.rows[0],provision});
    }
    if(order.payment_type==='credit' && action==='approve_credit'){
      const risk=await getCreditPoolRisk(pool,order.credit_pool_id,{lockWhenExceeded:false}); const projected=Number(risk.outstanding_fen)+Number(order.amount_fen);
      if(risk.status!=='active' || projected>Number(risk.credit_limit_fen)){await pool.query(`UPDATE sales_credit_pools SET status='locked',lock_reason=$2,updated_at=NOW() WHERE id=$1`,[order.credit_pool_id,`订单 ${order.order_no} 审核后欠款将达${projected}分，超过授信${risk.credit_limit_fen}分`]);const u=await pool.query(`UPDATE sales_orders SET status='returned',return_reason='品牌欠款超过授信，已锁定，需总经理重新授信',finance_by=$2,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,req.platformAdmin.username]);return res.status(409).json({ok:false,error:'credit_limit_exceeded',order:u.rows[0],risk:{...risk,projected_outstanding_fen:projected}});}
      // 授信通过只是"允许赊账开通"，客户这时候还没有真的付钱，不该在这一步生成开票申请——
      // 只有 confirm_paid(现金已收款) 才是真正"收到客人付款"的那一刻，见上面 ensureInvoiceRequestForOrder 的唯一调用点。
      const u=await pool.query(`UPDATE sales_orders SET status='credit_approved',finance_by=$2,finance_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[order.id,req.platformAdmin.username]);const provision=await provisionTenantFromOrder(pool,order.id,{startedBy:req.platformAdmin.username});return res.json({ok:true,order:u.rows[0],provision,credit_risk:await getCreditPoolRisk(pool,order.credit_pool_id)});
    }
    return res.status(400).json({ok:false,error:'invalid_finance_action'});
  });

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
