const action = (actionId, actionName, actionType, ownerRole, priority, defaultDeadlineDays, description, executionSteps, expectedResult, trackingMetrics) => ({
  actionId,
  actionName,
  actionType,
  ownerRole,
  priority,
  defaultDeadlineDays,
  description,
  executionSteps,
  expectedResult,
  trackingMetrics,
});

export const ISSUE_ACTION_MAPPINGS = [
  {
    issueId: 'customer_retention_weak',
    actions: [
      action('sleeping_customer_reactivation', '生成沉睡客户唤醒任务', 'customer_reactivation', '营销负责人', 'P1', 3, '筛出沉睡老客并形成触达任务。', ['生成沉睡客户名单', '分配企微触达', '7天追踪回店和营业额'], '7天内带回老客并看到贡献营业额', ['回店人数', '回店率', '贡献营业额']),
      action('high_value_customer_pool', '生成高价值客户维护名单', 'customer_reactivation', '店长', 'P1', 3, '优先维护高价值老客。', ['筛选高价值客户', '店长确认维护对象', '记录触达结果'], '7天内带回高价值客户，并追踪贡献营业额', ['回店人数', '贡献营业额']),
      action('manager_wecom_private_chat', '店长企微私聊', 'customer_reactivation', '店长', 'P1', 2, '由店长亲自触达重点老客。', ['生成私聊名单', '发送个性化邀约', '回填触达状态'], '重点客户获得专人维护', ['触达转化率', '回店率']),
      action('retention_7d_result_tracking', '7天追踪回店人数和贡献营业额', 'customer_reactivation', '营销负责人', 'P2', 7, '跟踪唤醒动作是否真的带来回店。', ['统计回店人数', '统计贡献营业额', '复盘未回店原因'], '明确唤醒动作的经营结果', ['回店人数', '贡献营业额']),
    ],
  },
  {
    issueId: 'new_customer_activation_weak',
    actions: [
      action('new_customer_d4_d8_touch', '生成新客 D4 / D8 触达任务', 'new_customer_activation', '营销负责人', 'P1', 2, '把新客承接变成固定触达节奏。', ['筛选新客', '生成D4触达', '生成D8复访提醒'], '提升新客二次到店率', ['二次到店率', 'D7回店人数', 'D14回店人数']),
      action('second_visit_benefit', '发放二次到店权益', 'new_customer_activation', '店长', 'P2', 3, '给新客明确的二次到店理由。', ['配置权益', '匹配新客名单', '跟踪核销'], '带动新客复访', ['优惠券核销率', '二次到店率']),
      action('second_visit_tracking', '追踪二次到店率', 'new_customer_activation', '营销负责人', 'P2', 7, '看承接动作是否转化为二次到店。', ['统计二次到店', '拆解触达来源', '复盘未转化客户'], '形成新客承接复盘', ['二次到店率']),
    ],
  },
  {
    issueId: 'vip_churn_risk',
    actions: [
      action('vip_priority_pool', '生成 VIP 重点维护池', 'customer_reactivation', '店长', 'P1', 2, '筛出高价值沉睡客户。', ['筛选VIP沉睡客户', '标注最近偏好', '分配维护责任人'], '重点VIP进入维护池', ['VIP回店人数', 'VIP回店率']),
      action('owner_vip_touch', '店长或老板亲自触达', 'customer_reactivation', '老板', 'P1', 3, '关键VIP由高层亲自维护。', ['确认触达名单', '准备个性化话术', '回填触达状态'], '提升VIP回店意愿', ['VIP回店率', 'VIP贡献营业额']),
      action('vip_preference_benefit', '推荐包房、新菜、招牌菜权益', 'customer_reactivation', '店长', 'P2', 3, '不默认大额折扣，优先用体验和偏好权益。', ['匹配客户偏好', '推荐包房或招牌菜', '记录权益使用'], '用体验权益带动回店', ['VIP回店人数', 'VIP贡献营业额']),
    ],
  },
  {
    issueId: 'stored_value_activation_weak',
    actions: [
      action('stored_value_balance_reminder', '生成储值余额提醒任务', 'stored_value_activation', '会员运营负责人', 'P1', 3, '提醒储值客户把余额转化为消费。', ['筛选有余额未消费客户', '生成提醒任务', '跟踪消费转化'], '储值余额开始消耗', ['储值客户消费人数', '储值余额消耗金额']),
      action('stored_value_signature_combo', '推荐招牌菜组合', 'stored_value_activation', '店长', 'P2', 5, '用菜品组合带动储值客户回店。', ['匹配招牌菜组合', '发送到店推荐', '回填消费结果'], '提升储值客户消费转化率', ['储值客户复购率']),
    ],
  },
  {
    issueId: 'revenue_decline',
    actions: [
      action('revenue_breakdown_diagnosis', '拆解客流、客单、复购', 'operation_diagnosis', '店长', 'P1', 1, '先定位营业额下滑来自哪里。', ['拆解客流', '拆解客单', '拆解复购'], '明确营业额下滑主因', ['营业额变化', '客流变化', '客单价变化', '复购率变化']),
      action('operation_rectification_plan', '生成经营诊断任务', 'operation_diagnosis', '店长', 'P1', 2, '要求门店提交整改计划。', ['标记P1风险', '生成整改任务', '提交整改计划'], '形成可追踪整改动作', ['营业额变化', '投诉率变化']),
    ],
  },
  {
    issueId: 'lunch_business_weak',
    actions: [
      action('lunch_customer_analysis', '分析午市客群', 'operation_diagnosis', '营销负责人', 'P2', 2, '找出午市客群不足或结构变化。', ['拆解午市客群', '识别低频老客', '提出套餐方向'], '明确午市增长抓手', ['午市营业额', '午市桌数']),
      action('lunch_offer_or_reactivation', '生成午市套餐或老客唤醒动作', 'operation_diagnosis', '店长', 'P2', 5, '用套餐或老客唤醒支撑午市。', ['设计午市套餐', '生成老客唤醒名单', '追踪到店桌数'], '提升午市营业额和桌数', ['午市营业额', '午市桌数', '午市客单价']),
    ],
  },
  {
    issueId: 'complaint_risk_up',
    actions: [
      action('complaint_category_split', '按服务、出品、等位、环境分组', 'operation_diagnosis', '店长', 'P1', 1, '先把客诉拆到可整改类别。', ['按类别分组', '标记责任角色', '生成整改任务'], '找到客诉主因', ['投诉率', '差评率']),
      action('complaint_rectification_task', '生成整改任务', 'operation_diagnosis', '店长', 'P1', 3, '将客诉复盘转成任务闭环。', ['分配责任人', '填写整改动作', '追踪评分变化'], '降低差评和投诉', ['差评率变化', '投诉率变化']),
    ],
  },
  {
    issueId: 'kitchen_quality_issue',
    actions: [
      action('kitchen_review_task', '生成出品复盘任务', 'kitchen_improvement', '出品经理', 'P1', 2, '由出品经理复盘出品稳定性。', ['分配给出品经理', '复盘退菜和差评', '跟踪出餐时长'], '降低出品差评和退菜', ['出品差评率', '退菜率', '出餐时长']),
    ],
  },
  {
    issueId: 'service_quality_issue',
    actions: [
      action('service_retraining_task', '生成服务复训任务', 'service_improvement', '前厅主管', 'P1', 3, '针对服务差评做复训。', ['分配给店长或前厅主管', '组织服务复训', '追踪客户评分'], '服务差评下降，客户评分恢复', ['服务差评率', '客户评分', '投诉率']),
    ],
  },
  {
    issueId: 'training_execution_weak',
    actions: [
      action('unfinished_training_list', '生成未完成培训人员清单', 'training_followup', '主管', 'P2', 3, '把未完成培训的人明确到责任主管。', ['生成未完成名单', '分配主管跟进', '追踪完成率'], '培训完成率恢复', ['培训完成率', '考试通过率']),
    ],
  },
  {
    issueId: 'skill_certification_weak',
    actions: [
      action('retest_and_retraining', '生成补考和复训任务', 'training_followup', '培训负责人', 'P2', 5, '将认证未通过人员拉入补考复训。', ['关联岗位技能树', '生成补考任务', '追踪认证通过率'], '认证通过率提升', ['认证通过率', '岗位绩效变化']),
    ],
  },
  {
    issueId: 'talent_pipeline_weak',
    actions: [
      action('promotion_candidate_review', '生成晋升候选人盘点', 'training_followup', '区域负责人', 'P2', 7, '盘点后备干部和关键岗位缺口。', ['生成候选人盘点', '标记关键岗位缺口', '追踪认证进度'], '补齐后备干部池', ['晋升候选人数', '关键岗位覆盖率']),
    ],
  },
  {
    issueId: 'task_closure_weak',
    actions: [
      action('overdue_task_list', '生成逾期任务清单', 'task_closure', '任务负责人', 'P1', 1, '把逾期任务和责任人拉出来处理。', ['生成逾期清单', '标记责任人', '要求填写下一步动作'], '逾期任务开始关闭', ['任务完成率', '任务逾期率', '问题关闭率']),
    ],
  },
  {
    issueId: 'execution_power_weak',
    actions: [
      action('execution_breakdown_rank', '生成执行力排行榜', 'task_closure', '店长', 'P1', 3, '按门店、负责人、任务类型拆解执行力。', ['拆解任务完成率', '生成排行榜', '追踪逾期率'], '执行差异变得可管理', ['任务完成率', '任务逾期率']),
    ],
  },
  {
    issueId: 'marketing_conversion_weak',
    actions: [
      action('marketing_audience_review', '复盘触达客群和权益组合', 'marketing_attribution', '营销负责人', 'P1', 2, '检查触达对象、触达时机和权益是否匹配。', ['拆解未回店客户', '复盘触达内容', '调整客群和权益组合'], '提升触达后的回店人数', ['触达转化率', '回店人数', '贡献营业额']),
      action('manager_followup_for_touched_customers', '生成触达未回店客户跟进任务', 'marketing_attribution', '店长', 'P1', 3, '将触达后未回店客户交给门店继续跟进。', ['生成未回店名单', '分配店长跟进', '7天后复盘回店'], '让触达动作进入门店承接闭环', ['回店人数', '触达转化率']),
    ],
  },
  {
    issueId: 'marketing_revenue_weak',
    actions: [
      action('marketing_revenue_diagnosis', '拆解归因营业额和客单价', 'marketing_attribution', '营销负责人', 'P1', 2, '判断营销有无带来足够实收。', ['拆解归因订单', '查看客单价', '复盘权益成本'], '找到营销贡献不足的主因', ['归因营业额', '客单价', 'ROI估算']),
    ],
  },
  {
    issueId: 'coupon_activation_weak',
    actions: [
      action('coupon_activation_review', '复盘权益核销门槛', 'marketing_attribution', '营销负责人', 'P2', 3, '检查优惠券权益是否被客户理解和使用。', ['检查券门槛', '复盘核销门店', '调整下一轮权益'], '提升优惠券核销和回店', ['优惠券核销数', '优惠券核销率', '回店人数']),
    ],
  },
];

export function listIssueActionMappings() {
  return ISSUE_ACTION_MAPPINGS.map(item => ({
    issueId: item.issueId,
    actions: item.actions.map(actionItem => ({ ...actionItem, executionSteps: [...actionItem.executionSteps], trackingMetrics: [...actionItem.trackingMetrics] })),
  }));
}
