import { canViewContractPrice } from '../../services/sales/sales-privacy.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'gates' });


/**
 * @param {any} pool
 * @param {Function|undefined} requireSalesManagerOrAbove
 */
export function createSalesAiGates(pool, requireSalesManagerOrAbove) {
  // 提成规则/审批、KPI目标与主管打分、销售花名册这类"销售管理"操作，普通销售/客服
  // 不该碰，只有销售经理/超级管理员可以。没传这个中间件时(比如老的调用方式)退化成
  // 只做登录校验，不因为这次改造而让原本能用的调用方式直接报错。
  const managerGate = typeof requireSalesManagerOrAbove === 'function' ? requireSalesManagerOrAbove : (_req, _res, next) => next();
  const financeGate = (req, res, next) => {
    if (!['super_admin', 'finance'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅财务或超级管理员可确认回款' });
    next();
  };
  // 开票提醒财务和客服都要能看到/处理：客服经常是第一个知道"客户不需要发票"的人。
  const financeOrCsGate = (req, res, next) => {
    if (!['super_admin', 'finance', 'customer_service'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅财务/客服或超级管理员可处理开票提醒' });
    next();
  };
  // 签约价格/账期属于客户档案里最机密的一档信息，比手机号可见范围更窄——
  // sales_manager能看完整联系方式，但看不到签约价格。
  const contractPriceGate = (req, res, next) => {
    if (!canViewContractPrice(req.platformAdmin)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅超级管理员/总经理/财务可查看或修改签约价格' });
    next();
  };
  /**
   * 订单标记"已付款"(现金，真正收到客人的钱)后，自动生成一条待开票申请——不用再等客户/客服
   * 主动发起"申请开票"这一步。用 order_id 唯一索引天然防重复(同一订单多次触发finance-decision
   * 也只会有一条开票申请)。注意：授信审核通过不算"收到付款"，不应该调用这个函数——
   * 账期客户还没实际付钱，见 approve_credit 分支旁边的说明。
   */
  async function ensureInvoiceRequestForOrder(order, requestedBy) {
    try {
      await pool.query(
        `INSERT INTO sales_invoices (contract_id, order_id, amount_fen, status, requested_by)
         VALUES ($1,$2,$3,'requested',$4) ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING`,
        [order.contract_id, order.id, order.amount_fen, requestedBy]
      );
    } catch (e) {
      log.warn({ msg: 'sales_ai_auto_invoice_request_failed', err: e?.message || e });
    }
  }
  const generalManagerGate = (req, res, next) => {
    if (!['super_admin', 'general_manager'].includes(req.platformAdmin?.role)) return res.status(403).json({ ok: false, error: 'forbidden', message: '仅总经理可授信或解锁客户' });
    next();
  };
  const salesCreateCustomerGate = (req, res, next) => {
    if (!['super_admin', 'general_manager', 'sales_manager', 'sales'].includes(req.platformAdmin?.role)) {
      return res.status(403).json({ ok: false, error: 'forbidden', message: '仅销售人员或销售管理人员可以新建客户档案' });
    }
    next();
  };
  // 新闭环必须先形成订单并由财务确认，合同本身不得直接开通租户。
  const autoProvisionIfEligible = async () => null;

  return {
    managerGate,
    financeGate,
    financeOrCsGate,
    contractPriceGate,
    generalManagerGate,
    salesCreateCustomerGate,
    ensureInvoiceRequestForOrder,
    autoProvisionIfEligible,
  };
}
