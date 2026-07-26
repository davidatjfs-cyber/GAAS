import { ensureSalesTables, listLeads, getLead } from '../../services/sales/sales-store.js';
import {
  getLeadDetail,
} from '../../services/sales/sales-session.js';

import { getUnifiedCustomerTimeline } from '../../services/sales/sales-timeline.js';

import { maskLeadContact, maskLeadListContact, canViewFullContact } from '../../services/sales/sales-privacy.js';
import { sensitiveRateLimit } from '../../services/sales/sales-rate-limit.js';
import { leadScopeSql, canAccessLead } from '../../services/sales/sales-permissions.js';

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-leads' });

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */

/** @param { app: any, pool: any, platformAdminRequired: Function, gates: object } ctx */
export function registerSalesAiLeadsReadRoutes(ctx) {
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
}
