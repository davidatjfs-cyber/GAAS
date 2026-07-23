/**
 * 客户诊断引擎：表面问题 → 潜在根因 → 销售建议
 */

const DIAGNOSIS_LIBRARY = [
  {
    surface: /营销做了很多|效果差|ROI|广告费|推广|投放|触达|短信|企微|私域|公域|抖音|小红书|大众点评/,
    root_causes: [
      '客户没有分层，触达内容千篇一律',
      '营销缺少针对性，未按消费频次/金额/偏好分层',
      '无法判断客户是否回店，缺少订单归因',
      '缺少 ROI 归因订单，无法知道哪个动作带来营业额',
      '门店没有后续承接动作，券发了没人核销或回访',
    ],
    recommended_modules: ['客户分层', '自动营销', '回店归因', 'ROI 报表'],
    avoid_modules: ['培训', '绩效'],
  },
  {
    surface: /复购|老客|流失|回店|回头客|沉睡|复购率|客户跑了/,
    root_causes: [
      '缺乏客户生命周期识别，未区分新客/活跃/VIP/流失风险',
      '没有自动化维护节奏，靠人工记忆或经验',
      '缺少回店归因，不知道哪些维护动作真正有效',
      '客户离开前没有预警机制',
    ],
    recommended_modules: ['客户分层', '自动维护', '流失预警', '回店归因'],
    avoid_modules: ['员工绩效'],
  },
  {
    surface: /营业额|营收|收入|业绩|下滑|下降|赚钱|利润|流水|生意不好/,
    root_causes: [
      '只看总额，不看客户结构变化（新客/老客/流失客）',
      '问题发现滞后，日常缺少异常预警',
      '门店执行与结果之间没有闭环追踪',
      '营销投入与营业额增长无法归因',
    ],
    recommended_modules: ['AI 诊断', '异常预警', '客户维护', 'ROI 归因'],
    avoid_modules: ['培训'],
  },
  {
    surface: /执行|店长|不会干|跟进|落地|督导|执行差|执行弱|人效|执行力/,
    root_causes: [
      '每天问题多但缺少具体可执行建议',
      '建议下发后没有追踪完成结果',
      '责任人与截止时间不清晰',
      '缺少按门店/个人的执行排行榜',
    ],
    recommended_modules: ['每日异常建议', '任务追踪', '责任人闭环', '执行复盘'],
    avoid_modules: ['复杂营销'],
  },
  {
    surface: /培训|人才|员工|培养|流失|招聘|能力|员工流失|不稳定/,
    root_causes: [
      '培训与考试、认证、绩效未串联',
      '能力标准不统一，靠师傅带徒弟',
      '人员流动后能力断层，缺少可复用的训练内容',
      '绩效激励与日常执行动作脱节',
    ],
    recommended_modules: ['培训', '考试认证', '绩效闭环'],
    avoid_modules: ['复杂营销'],
  },
  {
    surface: /多店|连锁|管理困难|管不过来|门店多|督导|巡店|标准化/,
    root_causes: [
      '多店数据分散，无法统一查看',
      '异常缺少门店排名，老板看不清哪家店出问题',
      '督导靠线下跑店，效率低且覆盖不全',
      '标准 SOP 落地没有数据追踪',
    ],
    recommended_modules: ['多店看板', '异常排名', '督导巡店', 'SOP 追踪'],
    avoid_modules: ['单店深度定制'],
  },
  {
    surface: /数据|报表|看不见|不清楚|不知道|经营数据|数据孤岛|老板要看/,
    root_causes: [
      '数据分散在 POS/会员/Excel/各门店',
      '报表维度多但缺少可执行的结论',
      '老板看不到"问题-责任人-结果"的完整闭环',
    ],
    recommended_modules: ['老板日报', '异常归因', '执行闭环'],
    avoid_modules: ['复杂营销'],
  },
];

const DEFAULT_DIAGNOSIS = {
  surface_problem: '经营增长遇到瓶颈',
  root_causes: [
    '客户可能缺少系统化的客户分层与维护',
    '日常经营问题发现与执行闭环可能不完整',
    '营销投入与结果可能难以归因',
  ],
  recommended_modules: ['30 天试跑', 'AI 经营诊断', '客户维护闭环'],
  avoid_modules: ['大规模定制'],
};

export function diagnoseLead(lead = {}) {
  const pain = String(lead.pain_point || lead.extracted?.pain_point || lead.pain_points?.[0] || '');
  if (!pain) return DEFAULT_DIAGNOSIS;
  for (const lib of DIAGNOSIS_LIBRARY) {
    if (lib.surface.test(pain)) {
      return {
        surface_problem: pain,
        root_causes: lib.root_causes,
        recommended_modules: lib.recommended_modules,
        avoid_modules: lib.avoid_modules,
      };
    }
  }
  return DEFAULT_DIAGNOSIS;
}

export function buildDiagnosisReport(lead = {}) {
  const d = diagnoseLead(lead);
  return {
    ...d,
    sales_advice: [
      `客户当前表述的是：${d.surface_problem}`,
      `不要先讲 ${d.avoid_modules.join('、')}，优先展示 ${d.recommended_modules.join('、')}。`,
      `背后根因可能是：${d.root_causes[0]}`,
      lead.phone_data_ready === false ? '风险：数据基础弱，先谈可行性再报价。' : null,
      lead.decision_role !== '老板' ? '风险：未确认决策人，建议尽快确认老板是否参与。' : null,
    ].filter(Boolean).join('\n'),
  };
}

export function buildDemoBrief(lead = {}, funnel = {}) {
  const d = diagnoseLead(lead);
  const demos = funnel.demos || [];
  const _latestDemo = demos[0] || {};
  return {
    customer: lead.company || lead.name || lead.lead_key || '未知名称',
    store_count: lead.store_count || '未明',
    cuisine: lead.cuisine || '未明',
    city: lead.city || '未明',
    pos: lead.pos_brand || '未明',
    main_problems: [d.surface_problem, ...(d.root_causes || [])].slice(0, 4),
    top_concerns: lead.extracted?.objections || [],
    this_meeting_goal: [
      '确认数据条件',
      '展示客户增长闭环',
      '确认试跑门店',
      '约定下一步时间',
    ],
    suggested_pages: d.recommended_modules.slice(0, 4),
  };
}

export function summarizeMeeting(notes = '') {
  const n = String(notes || '');
  const needs = [];
  const objections = [];
  const commitments = [];
  const risks = [];
  let decisionMaker = '';
  let budget = '';
  let timeline = '';

  if (/提升.*复购|老客|流失|客户维护|客户分层/.test(n)) needs.push('提升老客复购');
  if (/减少.*运营|减少.*工作量|效率|人效|自动化/.test(n)) needs.push('减少运营人员工作量');
  if (/营业额|增长|业绩|收入/.test(n)) needs.push('提升营业额');
  if (/执行|店长|督导|落地/.test(n)) needs.push('改善门店执行');
  if (/培训|人才|员工|绩效/.test(n)) needs.push('人才培养与绩效');
  if (/数据|报表|看板|日报/.test(n)) needs.push('经营数据可视');

  if (/担心.*POS|接入|对接|周期|数据/.test(n)) objections.push('担心POS接入周期');
  if (/担心.*门店|不会用|复杂|难用/.test(n)) objections.push('担心门店不会使用');
  if (/价格高|贵|预算|成本|ROI/.test(n)) objections.push('价格/ROI 顾虑');
  if (/安全|数据安全|隐私|泄露/.test(n)) objections.push('数据安全顾虑');
  if (/定制|个性化|特殊/.test(n)) objections.push('定制需求');

  if (/发送.*清单|发.*方案|发.*资料|提供.*清单|周三|周五|下周一|下周/.test(n)) commitments.push('按约定发送资料');
  if (/安排.*Demo|看.*演示|演示/.test(n)) commitments.push('安排Demo/演示');
  if (/确认.*门店|试跑.*门店|试跑/.test(n)) commitments.push('确认试跑门店');

  if (/不是.*决策|要问老板|和领导|合伙人|审批|申请预算|预算没批/.test(n)) {
    risks.push('未确认最终决策人');
  }
  if (/POS.*无法接入|非标准|自研POS|手工/.test(n)) {
    risks.push('POS接入风险');
  }
  if (/竞品|对比|其他家|也在看/.test(n)) {
    risks.push('客户处于竞争对比阶段');
  }

  const dmM = n.match(/(?:决策人|老板|负责人|拍板|决定)(?:是|为)?([^，。\n]{1,10})/);
  if (dmM) decisionMaker = dmM[1].trim();
  const bM = n.match(/(?:预算|投入|价格|金额)(?:约|大概|在)?(\d+(?:\.\d+)?万?)/);
  if (bM) budget = bM[1];
  const tM = n.match(/(?:时间|节点|上线|启动|试跑)(?:在|是|为)?([^，。\n]{1,20})/);
  if (tM) timeline = tM[1].trim();

  return {
    customer_needs: needs,
    customer_objections: objections,
    customer_commitments: commitments,
    our_commitments: commitments,
    risks,
    decision_maker: decisionMaker,
    budget,
    timeline,
    next_steps: commitments.length ? commitments : ['整理会议纪要并发送确认邮件'],
  };
}

/**
 * 检测销售人工回复中的过度承诺风险
 */
export function detectOvercommitment(text = '') {
  const t = String(text || '');
  const risks = [];
  if (/所有POS都能接|任何POS|什么POS都能接|全部.*能接|保证.*接入|肯定能接|一定能接|没问题.*接入/.test(t)) risks.push('过度承诺所有POS可接入');
  if (/保证.*效果|保证.*涨|保证.*营业额|保证.*增长|一定.*效果|一定.*涨|承诺.*效果|承诺.*增长/.test(t)) risks.push('过度承诺效果');
  if (/定制|定制开发|个性化|特殊需求|按你们要求做|你们说了算|怎么改都行|都可以做|什么都能做|随便改/.test(t)) risks.push('过度承诺定制');
  if (/免费|不要钱|不收钱|送|免费.*定制|免费.*开发|免费.*做|白送|赠送/.test(t)) risks.push('过度承诺免费/赠送');
  if (/折扣|打折|便宜|优惠|最低价|特批|破例|低于.*价|内部价|私下/.test(t)) risks.push('涉及折扣/价格特批');
  if (/几天上线|马上上线|一周.*上线|很快.*上线|快速上线|马上能用|立刻能用| instantly/.test(t)) risks.push('过度承诺上线周期');
  return risks;
}

/**
 * 标准异议库与推荐回答
 */
export const OBJECTION_LIBRARY = {
  price_too_high: {
    label: '价格太高',
    response: '是否值得投入，关键不是功能多少，而是能否明确看到客户回店、营业额增长和管理成本下降。建议先看您现有客户数据能否支撑30天试跑，再判断正式合作。',
  },
  has_pos: {
    label: '已经有POS',
    response: '我们不替换您的POS，而是连接现有POS数据，把客户、订单、员工串成闭环。接入的是数据，不是改您的系统。',
  },
  has_wecom: {
    label: '已经有企微',
    response: '企微是触达客户的通道，我们解决的是"给谁发、什么时候发、发什么、回没回店"——也就是策略和归因。',
  },
  too_complex: {
    label: '系统太复杂',
    response: '我们的核心设计不是让门店多做工作，而是尽量自动发现问题、自动生成建议、自动追踪结果。门店主要完成必要动作，老板直接看结果。',
  },
  staff_cannot_use: {
    label: '门店不会用',
    response: '系统每天只推送必要动作，店长看到的是"问题-建议-确认完成"，不需要复杂操作。培训聚焦在标准流程上。',
  },
  no_effect: {
    label: '看不到效果',
    response: '30天试跑会以"客户回店数、营业额变化、执行完成率"作为可验证结果，不靠感觉说话。',
  },
  data_incomplete: {
    label: '数据不完整',
    response: '数据条件是第一步，我们可以先评估POS订单里手机号覆盖率和菜品映射完整度，再判断是否适合试跑。',
  },
  data_security: {
    label: '担心数据安全',
    response: '数据接入范围、用途和权限需要在实施前明确，只处理已授权的经营与客户数据，并按账号和门店范围控制访问；具体数据责任与安全边界会写进合同和实施方案。',
  },
  more_workload: {
    label: '不想增加员工工作量',
    response: '系统自动生成建议，门店只需完成关键动作；长期来看，自动化反而减少人工统计和反复沟通的工作量。',
  },
  only_one_module: {
    label: '只想买某一个功能',
    response: '单一模块可能无法形成闭环。建议先从30天试跑开始，按实际结果决定优先启用哪些模块。',
  },
  competitor: {
    label: '正在对比竞品',
    response: '可以告诉我们您重点对比哪些维度，我们直接拿这几个维度在试跑中验证，用结果说话。',
  },
  need_customization: {
    label: '需要定制',
    response: '我们坚持标准产品，轻交付。非标准需求可以先评估是否通过配置或试跑解决，不做单店深度定制。',
  },
};

export function matchObjection(text = '') {
  const t = String(text || '');
  if (/价格|贵|多少钱|预算|投入|成本|ROI|性价比|便宜|优惠|打折|折扣/.test(t)) return 'price_too_high';
  if (/已经有POS|有POS|不用换POS|不替换POS|现有POS/.test(t)) return 'has_pos';
  if (/已经有企微|有企微|有企业微信|有微信/.test(t)) return 'has_wecom';
  if (/复杂|太复杂|难用|不会用|学不会|门槛|操作麻烦/.test(t)) return 'too_complex';
  if (/门店不会用|员工不会用|店长不会用|培训不会|学起来麻烦/.test(t)) return 'staff_cannot_use';
  if (/看不到效果|没效果|没作用|不靠谱|试过了没用|没效果/.test(t)) return 'no_effect';
  if (/数据不完整|数据不好|数据不行|没有数据|数据质量差|数据条件/.test(t)) return 'data_incomplete';
  if (/安全|隐私|泄露|数据安全|不放心/.test(t)) return 'data_security';
  if (/增加工作量|更忙|多做事情|额外工作|没时间/.test(t)) return 'more_workload';
  if (/只想买一个|只买一个|只用一个|只想要一个|单一功能|只要一个/.test(t)) return 'only_one_module';
  if (/竞品|对比|其他家|也在看|比较一下|考虑别家|别家产品/.test(t)) return 'competitor';
  if (/定制|个性化|特殊需求|二次开发|私有化|本地部署|买断/.test(t)) return 'need_customization';
  return null;
}

export function getObjectionResponse(key) {
  return OBJECTION_LIBRARY[key] || null;
}
