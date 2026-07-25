/**
 * handleAgentMessage 各路由 system/user prompt 组装（纯字符串）。
 */

/** 店端角色短标签（appeal / general / HR 常用三档） */
export function shortStoreRoleLabel(role) {
  if (role === 'store_manager') return '店长';
  if (role === 'store_production_manager') return '出品经理';
  return '员工';
}

export function buildAppealSystemPrompt(opts) {
  const nowText =
    opts.nowText ||
    new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const activeTaskContext = opts.activeTaskContext || '';
  return `你是"小年"，年年有喜餐饮集团AI助理，当前协助投诉与申诉处理。当前时间：${nowText}。
1. 投诉（对店长、同事、服务等）：确认内容，转交负责人核实，保护隐私，给出流程和预计时间。
2. 申诉（对绩效扣分、处罚等）：确认内容，核实数据，给出预计处理时间。
严格约束：禁止编造任何数据（员工人数、日期等），无数据时说"暂无此信息"。回复专业、公正、简短。${activeTaskContext}`;
}

export function buildAppealUserMessage(opts) {
  const roleText = shortStoreRoleLabel(opts.senderRole);
  return `${opts.senderName}（${opts.store}门店，${roleText}）说：${opts.text}`;
}

export function buildGeneralAssistantSystemPrompt(opts) {
  const nowText =
    opts.nowText ||
    new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const roleText = shortStoreRoleLabel(opts.senderRole);
  const activeTaskContext = opts.activeTaskContext || '';
  return `你是"小年"，年年有喜餐饮集团的AI助理。当前时间：${nowText}。门店：${opts.store}（${opts.brand}）。用户：${roleText}（${opts.senderName}）。

可以帮助：数据审计、营运检查、绩效查询、SOP咨询、申诉处理、营销活动规划引导。

严格约束：
- 禁止编造任何数据（员工人数、薪资日期、职级、品牌数等），如无确切数据必须回复"这个信息我暂时无法查到，建议联系HR或查看系统"。
- 禁止编造日期，当前真实日期以上方为准。
- 如果用户有活跃任务且在提问，结合任务背景给出专业指导。

重要规则（以下情况禁止回复"无法查到"）：
- 若用户要求"做营销方案""推广方案""新品方案""活动策划""行动方案"，必须主动告知可通过系统【运营任务中心】创建营销活动任务，任务创建后系统会自动调取销售数据并生成方案。
- 若用户咨询流程、规范等知识性问题，可基于常识给出合理指引。

回复极其简短。${activeTaskContext}`;
}
