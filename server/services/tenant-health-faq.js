/** 健康中心红项 → FAQ 深链。与 docs/轻服务-客服FAQ.md 同步。 */

export const HEALTH_FAQ = {
  'data-not-updated': {
    id: 'data-not-updated',
    title: '为什么数据没有更新？',
    summary: '先看昨日订单同步与最近同步时间；区分门店休息、编码映射与同步任务失败。',
  },
  'phone-match-low': {
    id: 'phone-match-low',
    title: '为什么手机号匹配率低？',
    summary: 'POS 未带手机号或小程序未授权；匹配率低于 60% 时营销与归因不可靠。',
  },
  'attribution-low': {
    id: 'attribution-low',
    title: '为什么营销归因少？',
    summary: '缺 campaign_id、券未回写、手机号匹配低，或窗口内客户未回店。',
  },
  'sms-not-sent': {
    id: 'sms-not-sent',
    title: '短信为什么没有发出？',
    summary: '检查平台短信配置、规则审批、运营商审核与频控。',
  },
  'coupon-not-redeemed': {
    id: 'coupon-not-redeemed',
    title: '优惠券为什么没有核销？',
    summary: '券状态、店员核销、POS 登记与事件回流任一环节都可能导致。',
  },
  'report-calc': {
    id: 'report-calc',
    title: '报告数据如何计算？',
    summary: '营收以 pos_sales_detail / pos_order_items 为准；日报可交叉验证。',
  },
  'pos-source': {
    id: 'pos-source',
    title: '哪些数据来自 POS？',
    summary: '订单明细与结账字段来自 POS；会员手机号与券核销多来自小程序事件。',
  },
  'ai-auto-execute': {
    id: 'ai-auto-execute',
    title: 'AI 建议是否会自动执行？',
    summary: '多数需确认；仅审批且开启自动执行的营销规则才会自动触达。',
  },
  'system-unavailable': {
    id: 'system-unavailable',
    title: '系统为什么显示不可用？',
    summary: '缺门店/POS/客户数据时功能会标不可用；先消红项。',
  },
  'add-store-staff': {
    id: 'add-store-staff',
    title: '如何添加门店和员工？',
    summary: '租户管理员在 HRMS 维护；未绑定门店岗位会导致任务派发失败。',
  },
};

/** item_key → faq id */
export const ITEM_KEY_TO_FAQ = {
  yesterday_orders_synced: 'data-not-updated',
  pos_data_connected: 'pos-source',
  customer_phone_match_rate: 'phone-match-low',
  order_phone_complete_rate: 'phone-match-low',
  order_customer_id_complete_rate: 'phone-match-low',
  attribution_links_orders: 'attribution-low',
  delivery_campaign_id_complete_rate: 'attribution-low',
  sms_wecom_sent: 'sms-not-sent',
  coupon_issue_redeem_data: 'coupon-not-redeemed',
  order_coupon_id_complete_rate: 'coupon-not-redeemed',
  morning_briefing_delivered: 'report-calc',
  ai_tasks_generated: 'ai-auto-execute',
  manager_confirmed_tasks: 'ai-auto-execute',
  employees_executed_tasks: 'ai-auto-execute',
  tenant_has_stores: 'add-store-staff',
  employees_bound_store_role: 'add-store-staff',
  manager_roles_configured: 'add-store-staff',
  customer_data_updated: 'system-unavailable',
  customer_segments_generatable: 'system-unavailable',
};

export function faqForItemKey(itemKey) {
  const id = ITEM_KEY_TO_FAQ[String(itemKey || '').trim()];
  if (!id) return null;
  return HEALTH_FAQ[id] || null;
}

export function listHealthFaqs() {
  return Object.values(HEALTH_FAQ);
}
