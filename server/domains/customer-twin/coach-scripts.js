/**
 * AI 顾客技能剧本（v1：先做「推销」，其余技能后续按同一 schema 扩展）
 * 四阶段：opening 开场 → deep_dive 深挖 → challenge 挑战 → closing 收尾
 */

export const COACH_CRITICAL_PRINCIPLES = [
  { id: 'soothe_first', label: '异议/客诉先安抚', anti: /(这跟我们没关系|不关我事|你去找|随便你|那是你的事)/ },
  { id: 'need_first', label: '先了解需求再推荐', anti: /(不用问|直接给你|我说了算)/ },
  { id: 'own_exception', label: '异常先揽责', anti: /(不是我的错|找我们经理|我不知道|别问我)/ },
  { id: 'promise_keep', label: '承诺要兑现', anti: /(应该可以吧|到时候再说|下次再说)/ },
  { id: 'allergy_confirm', label: '过敏/忌口必须确认', anti: /(过敏没事的|一点点没事|不用管)/ },
  { id: 'no_fabricate', label: '不确定先核实，不编造', anti: /(好像是|应该是|可能是吧|说不准|记不清|大概吧)/ },
];

export const COACH_DIMENSIONS = [
  { key: 'professional', label: '专业度' },
  { key: 'tone', label: '语气' },
  { key: 'response', label: '应对' },
  { key: 'completeness', label: '完整性' },
  { key: 'knowledge_accuracy', label: '知识准确性' },
  { key: 'initiative', label: '主动性' },
  { key: 'sales_conversion', label: '销售转化', skills: ['selling'] },
];

export const SELLING_SCRIPT = {
  skill_key: 'selling',
  persona: {
    label: '犹豫型老顾客',
    desc: '常客，价格敏感，对充值/会员有疑虑，怕被套路',
    scene: '晚饭时段，2 人用餐，用餐尾声',
  },
  opening: [
    '服务员，你们会员充 500 送 100 是真的吗？',
    '我看你们桌上有会员活动，具体是什么？',
    '你们是不是有会员充值？划算吗？',
  ],
  deep_dive: [
    '我一个月就来两三次，充 500 划算吗？',
    '充的钱能用在套餐上吗？',
    '会员除了充值还有什么好处？',
    '会不会充了以后你们价格就变了？',
    '如果我朋友也办，两个人能一起用吗？',
    '充值送的那 100 有使用期限吗？',
  ],
  challenge: [
    '上次我在别家充了钱，后来店都换了，你们怎么保证？',
    '你们是不是就靠充值套住客人？',
    '我现在不办，过几天活动还有吗？',
  ],
  closing_satisfied: [
    '行，听起来还可以，那我现在办一个吧。',
    '好，那就先充 500 试试。',
  ],
  closing_unsatisfied: [
    '我再想想吧，不着急。',
    '算了，下次再说。',
  ],
  knowledge_hints: ['推销', '会员', '充值'],
  min_deep_turns: 3,
  min_challenge_turns: 1,
};

export const SKILL_SCRIPTS = {
  selling: SELLING_SCRIPT,
};
