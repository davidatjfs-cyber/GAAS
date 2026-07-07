export const ACTION_RESULT_MAPPINGS = [
  { actionType: 'customer_reactivation', trackingMetrics: ['回店人数', '回店率', '贡献营业额', '客单价', '触达转化率'] },
  { actionType: 'new_customer_activation', trackingMetrics: ['二次到店率', 'D7回店人数', 'D14回店人数', '优惠券核销率'] },
  { actionType: 'stored_value_activation', trackingMetrics: ['储值客户消费人数', '储值余额消耗金额', '储值客户复购率'] },
  { actionType: 'operation_diagnosis', trackingMetrics: ['营业额变化', '客流变化', '客单价变化', '投诉率变化', '差评率变化'] },
  { actionType: 'kitchen_improvement', trackingMetrics: ['出品差评率', '退菜率', '出餐时长', '菜品评分'] },
  { actionType: 'service_improvement', trackingMetrics: ['服务差评率', '客户评分', '投诉率', '复购率'] },
  { actionType: 'training_followup', trackingMetrics: ['培训完成率', '考试通过率', '技能认证率', '岗位绩效变化'] },
  { actionType: 'task_closure', trackingMetrics: ['任务完成率', '任务逾期率', '按时完成率', '问题复发率'] },
  { actionType: 'marketing_attribution', trackingMetrics: ['触达转化率', '回店人数', '贡献营业额', '优惠券核销率', '归因营业额', 'ROI估算'] },
];

export function listActionResultMappings() {
  return ACTION_RESULT_MAPPINGS.map(item => ({ ...item, trackingMetrics: [...item.trackingMetrics] }));
}
