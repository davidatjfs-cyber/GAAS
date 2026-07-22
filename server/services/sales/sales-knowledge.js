/**
 * 销售 AI · 产品知识 / 人设 / 禁承诺（客户侧仅可见公开内容）
 */

export const SALES_PERSONA = {
  name: '李娟娟',
  displayName: '李娟娟Catherine',
  system_role: `你叫李娟娟，英文名Catherine，女性，是一名餐厅经营顾问，面向餐饮老板做专业、克制的销售诊断沟通。
如果客户问"你是谁"、"你叫什么"、"是不是真人/机器人/AI"，必须诚实说明"我是AI经营顾问李娟娟，不是真人"，再说明哪些问题可以直接回答、哪些需要人工顾问确认；不得冒充真人，也不要在客户没有询问身份时主动强调AI身份。
目标：让对方听懂价值、说出真实问题、判断是否适合标准产品，而不是堆功能。
说话要求：
1. 每轮回复控制在 80–160 字；口语自然，像见过几百家餐厅老板的资深顾问在跟人聊天，不像客服脚本或AI助手。
2. 每轮最多问 1 个问题；优先回指客户已说过的信息，不要复述或概括对方刚说的话再展开（不说"您提到的XX情况"这类转述开场）。
3. 先确认痛点，再只介绍与痛点相关的 1–2 点能力。
4. 不说空话套话，不用表情符号，不列长清单，不用"首先/其次/另外"这种书面结构词。
5. 涉及价格或折扣，先直接说明定价维度和优惠原则，再说明具体商务条件由顾问确认；不承诺具体折扣。涉及 POS 必须说明要核对接口和数据字段后才能判断，不能用「有标准接入评估」这类听起来像已经支持的表达。
6. 出现询价/Demo/合同/试跑/老板拍板时，引导转人工顾问，不继续深谈商务细节。
7. 直接进入有信息量的回答，禁止以"嗯""呃"等无信息量的口头禅开头；客户表示不满时必须具体承认哪里理解错了。
8. 用成熟、自然、专业的普通话，不用“啥”“咱们”“整一个”“不少问题呢”这类过度随意的表达。`,
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
    pain_keys: [],
  },
  {
    id: 'repurchase',
    title: '复购/老客',
    body: '系统按消费时间、次数、金额和偏好分层（新客、活跃、VIP、储值、流失风险），自动生成维护动作，并追踪回店与营业额归因。',
    pain_keys: ['复购', '老客', '流失', '营销'],
  },
  {
    id: 'revenue-decline',
    title: '营业额下降',
    body: 'AI会按时段、菜品、渠道拆解营业额变化（不是单纯看总数下滑），辅助定位是出餐、客流还是客单变化，再给出对应的整改动作并跟踪结果。',
    pain_keys: ['营业额下降'],
  },
  {
    id: 'execution',
    title: '店长执行',
    body: '每天发现经营异常，生成可执行建议并追踪店长/员工是否完成；老板看到的是问题、责任人、是否解决、结果是否改善。',
    pain_keys: ['门店执行', '执行', '店长'],
  },
  {
    id: 'training',
    title: '人才培养',
    body: '培训、考试、认证与绩效可串成闭环，减少人员流动带来的能力不稳定。',
    pain_keys: ['人才培养', '培训', '人才', '员工'],
  },
  {
    id: 'multi-store',
    title: '多店管理',
    body: '系统按门店维度汇总经营异常并自动排名，老板每天只看需要关注的门店和问题，而不是逐店翻数据；督导可以直接看到哪些店执行慢、哪些店在改善。',
    pain_keys: ['多店管理', '缺少经营数据'],
  },
  {
    id: 'marketing-roi',
    title: '营销归因/ROI',
    body: '每次营销触达(短信/企微/券)都会跟踪客户是否回店、产生了多少营业额，把投放和实际回店营收对应起来，而不是只看发了多少条、领了多少券。',
    pain_keys: ['营销归因'],
  },
  {
    id: 'trial',
    title: '30天试跑',
    body: '适合有POS与客户手机号基础的门店。先验证数据条件与回店归因，再决定正式合作；不以功能堆砌代替结果验证。',
    pain_keys: [],
  },
  {
    id: 'boundary',
    title: '合作边界',
    body: '标准产品、轻交付。单店重度定制不做；非标准POS需先评估；价格按门店规模方案，折扣需人工审批。',
    pain_keys: [],
  },
  {
    id: 'price-range',
    title: '价格原则',
    body: '按门店规模提供基础/连锁/集团方案区间。具体报价需顾问结合门店数、数据条件与试跑范围确认，机器人不报最终成交价。',
    pain_keys: [],
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
  { key: 'contact_phone', question: '方便留一个手机号吗？后面顾问可以直接联系您，发资料和方案会更快一些。', priority: 55 },
  { key: 'decision_role', question: '这次主要是您本人在看，还是运营/IT同事一起评估？', priority: 60 },
];

// extractSlotsFromText 产出的 pain_point 是精确值(如"营业额下降")，优先精确匹配
// pain_keys 数组里的完整值，避免子串匹配时"营销归因"命中"营销"而误判成复购模块。
// items 参数支持传入数据库里可编辑的知识条目(见 sales-knowledge-store.js)，
// 不传则使用内置默认值，保证DB异常时客户AI仍可用兜底知识。
export function knowledgeForPain(text = '', items = PUBLIC_KNOWLEDGE) {
  const s = String(text);
  const list = Array.isArray(items) && items.length ? items : PUBLIC_KNOWLEDGE;
  const exact = list.find((x) => (x.pain_keys || []).includes(s));
  if (exact) return exact;
  const partial = list.find((x) => (x.pain_keys || []).some((k) => k && s.includes(k)));
  if (partial) return partial;
  return list[0];
}

export function containsForbiddenClaim(text = '') {
  const s = String(text);
  return FORBIDDEN_CLAIMS.find((c) => s.includes(c)) || null;
}
