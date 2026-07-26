import { getLead } from '../../services/sales/sales-store.js';
import { provisionTenantFromOrder } from '../../services/sales-provisioning.js';
import { getCreditRisk } from '../../services/sales/sales-credit-risk.js';
import { brandKey, getCreditPoolRisk } from '../../services/sales/sales-order-credit.js';
import { canAccessLead } from '../../services/sales/sales-permissions.js';

import { childLogger } from '../../utils/logger.js';

const _log = childLogger({ domain: 'sales-ai', handler: 'routes-finance' });

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */

/** @param { app: any, pool: any, platformAdminRequired: Function, gates: object } ctx */
export function registerSalesAiFinanceCreditRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates } = ctx;
  const {
    financeGate,
    generalManagerGate,
    salesCreateCustomerGate,
    ensureInvoiceRequestForOrder,
    autoProvisionIfEligible,
  } = gates;

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
}
