/**
 * 销售 AI · 产品知识 / 人设 / 禁承诺（客户侧仅可见公开内容）
 */

export const SALES_PERSONA = {
  name: '餐厅AI增长顾问',
  system_role: `你是「餐厅AI增长顾问」，面向餐饮老板做专业、克制的销售诊断沟通。
目标：让对方听懂价值、说出真实问题、判断是否适合标准产品，而不是堆功能。
说话要求：
1. 每轮回复控制在 80–160 字；口语自然，像见过几百家餐厅老板的资深顾问在跟人聊天，不像客服脚本或AI助手。
2. 每轮最多问 1 个问题；优先回指客户已说过的信息，不要复述或概括对方刚说的话再展开（不说"您提到的XX情况"这类转述开场）。
3. 先确认痛点，再只介绍与痛点相关的 1–2 点能力。
4. 不说空话套话，不用表情符号，不列长清单，不用"首先/其次/另外"这种书面结构词。
5. 涉及价格只给区间与原则，不承诺折扣；涉及 POS 只说「标准接入评估」，不承诺全都能接。
6. 出现询价/Demo/合同/试跑/老板拍板时，引导转人工顾问，不继续深谈商务细节。
7. 每轮换一种开口方式，不要每次都用同一个句式起头；可以有"嗯""这个"之类的口语衔接词，但别过度。`,
};

export const FORBIDDEN_CLAIMS = [
  '所有POS都能接',
  '保证接入成功',
  '一定涨营业额',
  '保证效果',
  '免费定制',
  '随便打折',
  '几天就能全部门店上线',
  '什么需求都能做',
];

export const PUBLIC_KNOWLEDGE = [
  {
    id: 'what-is',
    title: '产品是什么',
    body: '我们提供的是餐厅AI增长服务，不是单一软件。系统连接POS、客户、员工与经营数据，帮助完成客户自动维护、门店自主运营和人才复制三个闭环。',
  },
  {
    id: 'repurchase',
    title: '复购/老客',
    body: '系统按消费时间、次数、金额和偏好分层（新客、活跃、VIP、储值、流失风险），自动生成维护动作，并追踪回店与营业额归因。',
  },
  {
    id: 'revenue-decline',
    title: '营业额下降',
    body: 'AI会按时段、菜品、渠道自动归因营业额变化的原因(不是单纯看总数下滑)，找到具体是出餐慢、客流下降还是客单下降，再给出对应的整改动作并跟踪结果。',
  },
  {
    id: 'execution',
    title: '店长执行',
    body: '每天发现经营异常，生成可执行建议并追踪店长/员工是否完成；老板看到的是问题、责任人、是否解决、结果是否改善。',
  },
  {
    id: 'training',
    title: '人才培养',
    body: '培训、考试、认证与绩效可串成闭环，减少人员流动带来的能力不稳定。',
  },
  {
    id: 'multi-store',
    title: '多店管理',
    body: '系统按门店维度汇总经营异常并自动排名，老板每天只看需要关注的门店和问题，而不是逐店翻数据；督导可以直接看到哪些店执行慢、哪些店在改善。',
  },
  {
    id: 'marketing-roi',
    title: '营销归因/ROI',
    body: '每次营销触达(短信/企微/券)都会跟踪客户是否回店、产生了多少营业额，把投放和实际回店营收对应起来，而不是只看发了多少条、领了多少券。',
  },
  {
    id: 'trial',
    title: '30天试跑',
    body: '适合有POS与客户手机号基础的门店。先验证数据条件与回店归因，再决定正式合作；不以功能堆砌代替结果验证。',
  },
  {
    id: 'boundary',
    title: '合作边界',
    body: '标准产品、轻交付。单店重度定制不做；非标准POS需先评估；价格按门店规模方案，折扣需人工审批。',
  },
  {
    id: 'price-range',
    title: '价格原则',
    body: '按门店规模提供基础/连锁/集团方案区间。具体报价需顾问结合门店数、数据条件与试跑范围确认，机器人不报最终成交价。',
  },
];

export const DIAGNOSTIC_SLOTS = [
  { key: 'store_count', question: '请问您目前有几家门店？', priority: 10 },
  { key: 'city', question: '方便说下门店主要在哪个城市吗？', priority: 15 },
  { key: 'cuisine', question: '主要经营的是什么品类？', priority: 20 },
  { key: 'pos_brand', question: '门店现在用的是哪家POS？', priority: 30 },
  { key: 'phone_data_ready', question: 'POS订单里目前能记录客户手机号吗？', priority: 40 },
  { key: 'member_estimate', question: '目前积累的会员或客户手机号大概有多少？', priority: 45 },
  { key: 'other_system_used', question: '目前有没有在用其他会员或营销管理系统？', priority: 47 },
  { key: 'pain_point', question: '您现在最想先解决的是客户复购、门店执行，还是人才培养？', priority: 50 },
  { key: 'decision_role', question: '这次主要是您本人在看，还是运营/IT同事一起评估？', priority: 60 },
];

export const PAIN_TO_MODULE = {
  复购: 'repurchase',
  老客: 'repurchase',
  流失: 'repurchase',
  营销: 'repurchase',
  执行: 'execution',
  店长: 'execution',
  培训: 'training',
  人才: 'training',
  员工: 'training',
};

// extractSlotsFromText 产出的 pain_point 是这几个精确值之一，优先精确匹配，
// 避免子串匹配时出现"营销归因"命中"营销"→误判成复购模块的问题。
const PAIN_POINT_EXACT_MODULE = {
  复购: 'repurchase',
  营业额下降: 'revenue-decline',
  门店执行: 'execution',
  人才培养: 'training',
  多店管理: 'multi-store',
  营销归因: 'marketing-roi',
  缺少经营数据: 'multi-store',
};

export function knowledgeForPain(text = '') {
  const s = String(text);
  if (PAIN_POINT_EXACT_MODULE[s]) {
    return PUBLIC_KNOWLEDGE.find((x) => x.id === PAIN_POINT_EXACT_MODULE[s]) || PUBLIC_KNOWLEDGE[0];
  }
  for (const [k, id] of Object.entries(PAIN_TO_MODULE)) {
    if (s.includes(k)) return PUBLIC_KNOWLEDGE.find((x) => x.id === id) || PUBLIC_KNOWLEDGE[0];
  }
  return PUBLIC_KNOWLEDGE[0];
}

export function containsForbiddenClaim(text = '') {
  const s = String(text);
  return FORBIDDEN_CLAIMS.find((c) => s.includes(c)) || null;
}
