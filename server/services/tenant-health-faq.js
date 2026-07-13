/** 健康中心红项 → FAQ 深链。与 docs/轻服务-客服FAQ.md 同步。 */

export const HEALTH_FAQ = {
  'data-not-updated': {
    id: 'data-not-updated',
    category: '数据同步',
    title: '为什么数据没有更新？',
    summary: '先看昨日订单同步与最近同步时间；区分门店休息、编码映射与同步任务失败。',
    steps: ['打开健康中心看「昨日订单是否同步」', '核对门店是否休息/编码映射', '若同步任务失败→第三方或平台队列'],
  },
  'phone-match-low': {
    id: 'phone-match-low',
    category: '客户识别',
    title: '为什么手机号匹配率低？',
    summary: 'POS 未带手机号或小程序未授权；匹配率低于 60% 时营销与归因不可靠。',
    steps: ['确认 POS 是否导出手机号字段', '引导到店授权小程序手机号', '勿升级研发——属采集流程'],
  },
  'attribution-low': {
    id: 'attribution-low',
    category: '营销归因',
    title: '为什么营销归因少？',
    summary: '缺 campaign_id、券未回写、手机号匹配低，或窗口内客户未回店。',
    steps: ['查触达是否带活动标识', '查券核销是否回流', '区分「没回店」与「系统坏了」'],
  },
  'sms-not-sent': {
    id: 'sms-not-sent',
    category: '短信触达',
    title: '短信为什么没有发出？',
    summary: '检查平台短信配置、规则审批、运营商审核与频控。',
    steps: ['平台短信开关/签名', '规则是否 approved', '运营商审核/频控'],
  },
  'coupon-not-redeemed': {
    id: 'coupon-not-redeemed',
    category: '优惠券',
    title: '优惠券为什么没有核销？',
    summary: '券状态、店员核销、POS 登记与事件回流任一环节都可能导致。',
    steps: ['查券是否到账/过期', '店员是否小程序核销', '核销事件是否回流 HRMS'],
  },
  'report-calc': {
    id: 'report-calc',
    category: '报告口径',
    title: '报告数据如何计算？',
    summary: '营收以 pos_sales_detail / pos_order_items 为准；日报可交叉验证。',
    steps: ['营收查明细不查残缺订单头', '有争议先对口径', '误差通常 <0.5%'],
  },
  'pos-source': {
    id: 'pos-source',
    category: '数据来源',
    title: '哪些数据来自 POS？',
    summary: '订单明细与结账字段来自 POS；会员手机号与券核销多来自小程序事件。',
    steps: ['POS：明细/金额/结账时间', '小程序：授权手机号/券/扫码归因'],
  },
  'ai-auto-execute': {
    id: 'ai-auto-execute',
    category: 'AI与执行',
    title: 'AI 建议是否会自动执行？',
    summary: '多数需确认；仅审批且开启自动执行的营销规则才会自动触达。',
    steps: ['经营建议默认需确认', '未执行记入责任台账', '月报可说明客户未执行'],
  },
  'system-unavailable': {
    id: 'system-unavailable',
    category: '可用性',
    title: '系统为什么显示不可用？',
    summary: '缺门店/POS/客户数据时功能会标不可用；先消红项。',
    steps: ['看功能可用性阻塞项', '先消 P0/P1 红项', '再谈功能体验'],
  },
  'add-store-staff': {
    id: 'add-store-staff',
    category: '开通配置',
    title: '如何添加门店和员工？',
    summary: '租户管理员在 HRMS 维护；未绑定门店岗位会导致任务派发失败。',
    steps: ['HRMS 后台加门店', '员工绑定门店岗位', '走完上线向导十步'],
  },
  'non-execution': {
    id: 'non-execution',
    category: '责任边界',
    title: '客户不执行时如何说明？',
    summary: '系统记录建议/确认/执行；月报可声明未执行故无法评价改善效果。',
    steps: ['打开健康→未执行台账', '导出 statement 给客户', '勿把未执行归因成系统无效'],
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
  manager_confirmed_tasks: 'non-execution',
  employees_executed_tasks: 'non-execution',
  overdue_tasks_exist: 'non-execution',
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
