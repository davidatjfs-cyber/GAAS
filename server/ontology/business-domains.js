export const BUSINESS_DOMAINS = [
  {
    id: 'customer_growth',
    name: '客户增长',
    description: '围绕客户分层、复购、流失预警、触达转化和营业额贡献的经营判断。',
    relatedEntities: ['customer', 'store', 'employee', 'metric', 'task'],
    coreQuestions: [
      '哪些客户正在流失？',
      '哪些客户值得优先维护？',
      '哪些客户触达后产生了复购？',
      '客户维护有没有带来营业额？',
    ],
  },
  {
    id: 'operation_improvement',
    name: '经营整改',
    description: '围绕营业额、客流、客单、投诉、服务和出品稳定性的整改闭环。',
    relatedEntities: ['store', 'metric', 'task', 'dish', 'report'],
    coreQuestions: [
      '生意结果哪里开始下滑？',
      '问题来自客流、客单、复购还是体验？',
      '整改动作有没有被执行？',
      '整改后结果有没有恢复？',
    ],
  },
  {
    id: 'talent_development',
    name: '人才复制',
    description: '围绕培训、认证、岗位能力和后备干部梯队的人才经营判断。',
    relatedEntities: ['employee', 'store', 'metric', 'task'],
    coreQuestions: [
      '哪些员工能力还没补齐？',
      '培训有没有真正完成？',
      '关键岗位有没有后备人选？',
      '人才复制有没有支撑门店复制？',
    ],
  },
  {
    id: 'task_execution',
    name: '任务闭环',
    description: '围绕任务分派、逾期、关闭、复发和责任人的执行闭环。',
    relatedEntities: ['task', 'employee', 'store', 'metric'],
    coreQuestions: [
      '问题发现后有没有变成任务？',
      '任务有没有按时完成？',
      '谁是责任对象？',
      '问题有没有复发？',
    ],
  },
];

export function listBusinessDomains() {
  return BUSINESS_DOMAINS.map(domain => ({ ...domain }));
}
