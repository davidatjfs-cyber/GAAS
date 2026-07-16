export const SALES_EVENT_DICTIONARY = Object.freeze(Object.fromEntries([
  ['lead_created', '线索创建'], ['profile_started', '画像开始'], ['slot_asked', '提问槽位'], ['slot_answered', '槽位回答'],
  ['slot_skipped', '跳过槽位'], ['slot_invalid', '槽位无效'], ['slot_corrected', '槽位修正'], ['profile_completed', '画像完成'],
  ['diagnosis_delivered', '诊断已交付'], ['case_recommended', '案例已推荐'], ['handoff_triggered', '触发转人工'],
  ['demo_requested', '客户请求Demo'], ['demo_scheduling_task_created', '创建Demo排期任务'], ['demo_scheduled', 'Demo已确认'],
  ['demo_rescheduled', 'Demo已改期'], ['demo_cancelled', 'Demo已取消'], ['demo_completed', 'Demo已完成'], ['demo_no_show', 'Demo未到场'],
  ['proposal_created', '方案已创建'], ['trial_started', '试跑开始'], ['deal_won', '成交'], ['deal_lost', '失单'],
  ['tenant_provisioned', '租户已开通'], ['onboarding_started', '上线开始'], ['onboarding_completed', '上线完成'],
  ['renewal_risk_created', '续费风险'], ['referral_task_created', '转介绍任务'],
].map(([event_type, description]) => [event_type, { event_type, description, schema_version: 'v1' }])));

export function assertSalesEventType(eventType) {
  if (!SALES_EVENT_DICTIONARY[eventType]) throw new Error(`unknown_sales_event_type:${eventType}`);
  return SALES_EVENT_DICTIONARY[eventType];
}
