/**
 * 门店 Job Coach 轨：原则检测、客户回复、场景/能力种子
 */

const QUESTION_RE = /[？?]|吗\s*$|么\s*$|呢\s*$|是否|能不能|方便/;
const APOLOGY_RE = /抱歉|对不起|不好意思/;
const EMPATHY_RE = /理解|换我|也会|一起|马上帮|立刻帮/;
const OWN_RE = /我来处理|我帮您|我去催|责任在我们|是我们/;
const MEMBER_RE = /会员|办卡|积分|充值/;
const RECOMMEND_RE = /推荐|套餐|今日|招牌|搭配|加一份/;
const PRICE_FACT_RE = /\d+\s*元|价钱|价格|多少钱/;

export const STORE_TRACKS = ['foh_server', 'cashier', 'store_manager', 'kitchen_staff', 'hq_ops'];

export const FOH_SKILLS = [
  'service_awareness', 'product_knowledge', 'recommendation',
  'communication', 'exception_handling', 'member_conversion', 'brand_expression',
];
export const CASHIER_SKILLS = [
  'communication', 'exception_handling', 'product_knowledge', 'member_conversion',
];
export const MANAGER_SKILLS = [
  'communication', 'exception_handling', 'service_awareness', 'brand_expression',
];
export const KITCHEN_SKILLS = [
  'product_knowledge', 'exception_handling', 'communication', 'service_awareness',
];
export const HQ_SKILLS = [
  'communication', 'brand_expression', 'service_awareness', 'exception_handling',
];

export const FOH_PRINCIPLES = [
  { id: 'greet_first', label: '先问候再办事', skill: 'service_awareness' },
  { id: 'soothe_guest', label: '客诉先安抚', skill: 'exception_handling' },
  { id: 'recommend_after_need', label: '先了解再推荐', skill: 'recommendation' },
  { id: 'own_exception', label: '异常先揽责', skill: 'exception_handling' },
  { id: 'member_invite', label: '适时会员引导', skill: 'member_conversion' },
  { id: 'brand_tone', label: '品牌表达得体', skill: 'brand_expression' },
  { id: 'clear_speak', label: '表达清晰可执行', skill: 'communication' },
];

export const CASHIER_PRINCIPLES = [
  { id: 'clear_bill', label: '账单说清楚', skill: 'communication' },
  { id: 'refund_verify', label: '退款先核实', skill: 'exception_handling' },
  { id: 'queue_calm', label: '排队先安抚', skill: 'service_awareness' },
  { id: 'groupbuy_clear', label: '团购规则说清', skill: 'product_knowledge' },
  { id: 'member_checkout', label: '结账会员提醒', skill: 'member_conversion' },
];

export const MANAGER_PRINCIPLES = [
  { id: 'stabilize_first', label: '升级客诉先稳场', skill: 'exception_handling' },
  { id: 'listen_staff', label: '对员工先听再决', skill: 'communication' },
  { id: 'mystery_fact', label: '巡店/神秘顾客据实应答', skill: 'brand_expression' },
  { id: 'hq_clear', label: '对总部汇报清晰', skill: 'communication' },
  { id: 'service_standard', label: '强调门店服务标准', skill: 'service_awareness' },
];

export const KITCHEN_PRINCIPLES = [
  { id: 'ack_ticket', label: '先确认出餐问题', skill: 'communication' },
  { id: 'eta_clear', label: '给出明确出餐时间', skill: 'exception_handling' },
  { id: 'food_safety', label: '食品安全优先', skill: 'product_knowledge' },
  { id: 'no_blame_foh', label: '不甩锅前厅', skill: 'service_awareness' },
];

export const HQ_PRINCIPLES = [
  { id: 'clarify_goal', label: '先澄清总部目标', skill: 'communication' },
  { id: 'store_context', label: '结合门店现状', skill: 'service_awareness' },
  { id: 'actionable', label: '给出可执行动作', skill: 'exception_handling' },
  { id: 'brand_align', label: '对齐品牌标准', skill: 'brand_expression' },
];

const STORE_REPLIES = {
  default: ['那你打算怎么处理？', '你倒是给个准话。', '我听着呢。'],
  angry: ['越说我越生气，你们到底管不管？', '别跟我打官腔！'],
  soothed: ['行，那你先处理，我等你结果。', '好，尽快，我们还在等。'],
  rush: ['催了三次了，还要等多久？', '孩子都饿哭了！'],
  wrong_dish: ['这根本不是我点的！你们怎么上菜的？', '上错了还让我自己找？'],
  recommend_push: ['别硬推，我吃不了辣。', '你有没有听我说忌口？'],
  member: ['办会员有什么好处？别只说充值。', '积分怎么用，说清楚。'],
  refund: ['能不能退就直说，别绕。', '团购规则当时没讲清楚。'],
  queue: ['队伍这么长，你们多开个收银台行不行？', '等了二十分钟了。'],
  mystery: ['我按总部标准问：刚才那位服务员有没有做迎宾？', '标准动作我怎么没看见？'],
  staff: ['排班又改，我不干了。', '你到底站谁那边？'],
  kitchen: ['这单火大吗？客人催疯了！', '上错了是谁的责任？'],
  hq: ['你先别解释，告诉我明天门店怎么改。', '数据我有，要你的动作。'],
};

export function skillsForTrack(track) {
  if (track === 'foh_server') return FOH_SKILLS;
  if (track === 'cashier') return CASHIER_SKILLS;
  if (track === 'store_manager') return MANAGER_SKILLS;
  if (track === 'kitchen_staff') return KITCHEN_SKILLS;
  if (track === 'hq_ops') return HQ_SKILLS;
  return null;
}

export function principlesForTrack(track) {
  if (track === 'foh_server') return FOH_PRINCIPLES;
  if (track === 'cashier') return CASHIER_PRINCIPLES;
  if (track === 'store_manager') return MANAGER_PRINCIPLES;
  if (track === 'kitchen_staff') return KITCHEN_PRINCIPLES;
  if (track === 'hq_ops') return HQ_PRINCIPLES;
  return null;
}

export function isStoreTrack(track) {
  return STORE_TRACKS.includes(track);
}

export function detectStoreTriggers(customerText = '') {
  const t = String(customerText || '');
  const hits = [];
  if (/投诉|生气|受够|太差|什么破/.test(t)) hits.push('angry');
  if (/催|多久|还没来|等了/.test(t)) hits.push('rush');
  if (/上错|不是我点|错菜/.test(t)) hits.push('wrong_dish');
  if (/推荐|套餐|招牌|吃什么/.test(t)) hits.push('ask_recommend');
  if (/会员|积分|办卡/.test(t)) hits.push('member');
  if (/退款|退钱|团购/.test(t)) hits.push('refund');
  if (/排队|队伍|收银台/.test(t)) hits.push('queue');
  if (/神秘顾客|总部标准|巡店|迎宾/.test(t)) hits.push('mystery');
  if (/排班|我不干|站谁/.test(t)) hits.push('staff');
  if (/出餐|后厨|火大|厨房/.test(t)) hits.push('kitchen');
  if (/明天怎么改|动作|数据我有/.test(t)) hits.push('hq');
  if (/投诉|上菜慢|给说法|找店长|解决不了/.test(t)) hits.push('complaint');
  return hits;
}

export function evaluateStoreUtterance({ track, traineeText, customerText, turnNo }) {
  const text = String(traineeText || '');
  const triggers = detectStoreTriggers(customerText);
  const violations = [];
  const strengths = [];
  const coachTags = [];

  if (track === 'foh_server') {
    evalFoh({ text, triggers, turnNo, violations, strengths, coachTags });
  } else if (track === 'cashier') {
    evalCashier({ text, triggers, violations, strengths, coachTags });
  } else if (track === 'store_manager') {
    evalManager({ text, triggers, violations, strengths, coachTags });
  } else if (track === 'kitchen_staff') {
    evalKitchen({ text, triggers, violations, strengths, coachTags });
  } else if (track === 'hq_ops') {
    evalHq({ text, triggers, violations, strengths, coachTags });
  }

  return {
    violations, strengths, coachTags, triggers,
    hasQuestion: QUESTION_RE.test(text),
  };
}

function evalFoh({ text, triggers, turnNo, violations, strengths, coachTags }) {
  if (turnNo <= 1 && !/你好|欢迎|您好|早上好|下午好|晚上好/.test(text) && triggers.includes('ask_recommend')) {
    violations.push({ principle_id: 'greet_first', detail: '开场缺少问候' });
    coachTags.push({ code: 'no_greet', level: 'warn', message: '先问候再进入推荐' });
  } else if (/你好|欢迎|您好/.test(text)) {
    strengths.push({ principle_id: 'greet_first', detail: '有迎宾问候' });
  }

  if (triggers.includes('angry') || triggers.includes('complaint') || triggers.includes('rush') || triggers.includes('wrong_dish')) {
    if (!APOLOGY_RE.test(text) && !EMPATHY_RE.test(text)) {
      violations.push({ principle_id: 'soothe_guest', detail: '客诉/催菜缺少安抚' });
      coachTags.push({ code: 'no_soothe', level: 'error', message: '先抱歉安抚，再给处理方案' });
    } else strengths.push({ principle_id: 'soothe_guest', detail: '有安抚' });
    if (OWN_RE.test(text)) strengths.push({ principle_id: 'own_exception', detail: '主动揽责处理' });
    else if (/不是我|怪厨房|怪收银|你自己/.test(text)) {
      violations.push({ principle_id: 'own_exception', detail: '推诿责任' });
      coachTags.push({ code: 'blame', level: 'error', message: '异常先揽责：我来处理' });
    }
  }

  if (triggers.includes('ask_recommend')) {
    if (RECOMMEND_RE.test(text) && !QUESTION_RE.test(text) && !/忌口|几位|口味|偏好/.test(text)) {
      violations.push({ principle_id: 'recommend_after_need', detail: '未了解需求就硬推' });
      coachTags.push({ code: 'hard_sell', level: 'warn', message: '先问忌口/人数再推荐' });
    } else if (QUESTION_RE.test(text) || /忌口|几位|口味/.test(text)) {
      strengths.push({ principle_id: 'recommend_after_need', detail: '推荐前探询需求' });
    }
  }

  if (triggers.includes('member') || MEMBER_RE.test(text)) {
    if (MEMBER_RE.test(text) && (/好处|积分|优惠|可以/.test(text) || QUESTION_RE.test(text))) {
      strengths.push({ principle_id: 'member_invite', detail: '会员利益说清' });
    }
  }

  if (/竞品更差|别家不行|我们最好吃随便说/.test(text)) {
    violations.push({ principle_id: 'brand_tone', detail: '品牌表达不当' });
    coachTags.push({ code: 'bad_brand', level: 'warn', message: '少贬低竞品，多讲自己标准' });
  }

  if (text.length > 90 && !QUESTION_RE.test(text)) {
    violations.push({ principle_id: 'clear_speak', detail: '表达过长且无确认' });
    coachTags.push({ code: 'verbose', level: 'warn', message: '说短一点，并确认客人是否接受' });
  } else if (QUESTION_RE.test(text) || /好的|马上|请稍等/.test(text)) {
    strengths.push({ principle_id: 'clear_speak', detail: '表达清晰' });
  }

  if (PRICE_FACT_RE.test(text) && /大概|好像|应该是/.test(text)) {
    violations.push({ principle_id: 'clear_speak', detail: '价格表达含糊' });
    coachTags.push({ code: 'vague_price', level: 'warn', message: '价格不确定时先核实，勿猜' });
  }
}

function evalCashier({ text, triggers, violations, strengths, coachTags }) {
  if (triggers.includes('refund')) {
    if (/不能退|没法退/.test(text) && !QUESTION_RE.test(text)) {
      violations.push({ principle_id: 'refund_verify', detail: '未核实就拒退' });
      coachTags.push({ code: 'hard_deny', level: 'error', message: '先核实订单/团购规则再答复' });
    } else if (/核实|查一下|订单|团购|规则/.test(text) || QUESTION_RE.test(text)) {
      strengths.push({ principle_id: 'refund_verify', detail: '退款先核实' });
    }
  }
  if (triggers.includes('queue')) {
    if (APOLOGY_RE.test(text) || /马上|增开|请稍等|两位/.test(text)) {
      strengths.push({ principle_id: 'queue_calm', detail: '排队安抚' });
    } else {
      violations.push({ principle_id: 'queue_calm', detail: '排队场景缺少安抚' });
      coachTags.push({ code: 'queue_cold', level: 'warn', message: '先致歉并给等待预期' });
    }
  }
  if (/团购|验券|美团|抖音/.test(text) || triggers.includes('refund')) {
    if (/规则|不找零|限制|可用/.test(text)) strengths.push({ principle_id: 'groupbuy_clear', detail: '说明规则' });
  }
  if (/合计|一共|应收|找零/.test(text)) strengths.push({ principle_id: 'clear_bill', detail: '账单清楚' });
  if (MEMBER_RE.test(text)) strengths.push({ principle_id: 'member_checkout', detail: '会员提醒' });
}

function evalManager({ text, triggers, violations, strengths, coachTags }) {
  if (triggers.includes('angry') || triggers.includes('complaint') || triggers.includes('mystery')) {
    if (!APOLOGY_RE.test(text) && !EMPATHY_RE.test(text)) {
      violations.push({ principle_id: 'stabilize_first', detail: '升级场景未先稳场' });
      coachTags.push({ code: 'no_stabilize', level: 'error', message: '店长先稳场致歉，再给方案' });
    } else strengths.push({ principle_id: 'stabilize_first', detail: '先稳场' });
  }
  if (triggers.includes('staff')) {
    if (QUESTION_RE.test(text) || /听你说|什么情况|一起看/.test(text)) {
      strengths.push({ principle_id: 'listen_staff', detail: '先听员工' });
    } else if (/必须|给我|不然就/.test(text)) {
      violations.push({ principle_id: 'listen_staff', detail: '未倾听就下命令' });
      coachTags.push({ code: 'order_only', level: 'warn', message: '先听原因再决策' });
    }
  }
  if (triggers.includes('mystery')) {
    if (/标准|迎宾|我会整改|立即补训/.test(text)) {
      strengths.push({ principle_id: 'mystery_fact', detail: '据实应答并整改' });
    }
  }
  if (triggers.includes('hq')) {
    if (/明天|今日|动作|安排|跟进/.test(text)) strengths.push({ principle_id: 'hq_clear', detail: '有动作' });
    else {
      violations.push({ principle_id: 'hq_clear', detail: '汇报缺少动作' });
      coachTags.push({ code: 'no_action', level: 'warn', message: '给总部可执行的下一步' });
    }
  }
  if (/服务标准|门店标准|培训/.test(text)) {
    strengths.push({ principle_id: 'service_standard', detail: '强调标准' });
  }
}

function evalKitchen({ text, triggers, violations, strengths, coachTags }) {
  if (triggers.includes('kitchen') || triggers.includes('rush') || triggers.includes('wrong_dish')) {
    if (/收到|确认|哪一桌|几号单/.test(text) || QUESTION_RE.test(text)) {
      strengths.push({ principle_id: 'ack_ticket', detail: '确认问题' });
    } else {
      violations.push({ principle_id: 'ack_ticket', detail: '未确认出餐问题' });
      coachTags.push({ code: 'no_ack', level: 'warn', message: '先确认桌号/菜品再给时间' });
    }
    if (/\d+\s*分钟|马上出|尽快出/.test(text)) {
      strengths.push({ principle_id: 'eta_clear', detail: '给出时间' });
    } else {
      violations.push({ principle_id: 'eta_clear', detail: '未给出明确出餐时间' });
      coachTags.push({ code: 'no_eta', level: 'error', message: '告诉前厅还要几分钟' });
    }
  }
  if (/过期|不新鲜|掉地上|重做/.test(text) && /安全|重做|不能上/.test(text)) {
    strengths.push({ principle_id: 'food_safety', detail: '食品安全优先' });
  }
  if (/怪服务员|前厅害的|他们搞错/.test(text)) {
    violations.push({ principle_id: 'no_blame_foh', detail: '甩锅前厅' });
    coachTags.push({ code: 'blame_foh', level: 'error', message: '先解决问题，不甩锅' });
  }
}

function evalHq({ text, triggers, violations, strengths, coachTags }) {
  if (QUESTION_RE.test(text) || /目标|优先级|最想/.test(text)) {
    strengths.push({ principle_id: 'clarify_goal', detail: '澄清目标' });
  } else if (triggers.includes('hq') && text.length > 40) {
    violations.push({ principle_id: 'clarify_goal', detail: '未澄清目标就给方案' });
    coachTags.push({ code: 'no_goal', level: 'warn', message: '先确认总部要的结果' });
  }
  if (/门店|客流|复购|排班|出餐/.test(text)) {
    strengths.push({ principle_id: 'store_context', detail: '结合门店现状' });
  }
  if (/明天|本周|动作|跟进|负责人/.test(text)) {
    strengths.push({ principle_id: 'actionable', detail: '可执行动作' });
  } else if (text.length > 50) {
    violations.push({ principle_id: 'actionable', detail: '缺少可执行动作' });
    coachTags.push({ code: 'vague_plan', level: 'warn', message: '给出负责人+时间+动作' });
  }
  if (/品牌|标准|统一/.test(text)) strengths.push({ principle_id: 'brand_align', detail: '对齐品牌' });
}

export function buildStoreCustomerReply({ track, evalResult, turnNo }) {
  const triggers = evalResult?.triggers || [];
  const violations = evalResult?.violations || [];
  const salt = turnNo || 0;
  const pick = (arr) => arr[Math.abs(salt) % arr.length];

  if (violations.some((v) => ['soothe_guest', 'stabilize_first', 'queue_calm'].includes(v.principle_id))) {
    return pick(STORE_REPLIES.angry);
  }
  if (evalResult?.strengths?.some((s) => ['soothe_guest', 'stabilize_first'].includes(s.principle_id))) {
    return pick(STORE_REPLIES.soothed);
  }
  if (triggers.includes('rush')) return pick(STORE_REPLIES.rush);
  if (triggers.includes('wrong_dish')) return pick(STORE_REPLIES.wrong_dish);
  if (triggers.includes('ask_recommend') && violations.some((v) => v.principle_id === 'recommend_after_need')) {
    return pick(STORE_REPLIES.recommend_push);
  }
  if (triggers.includes('member')) return pick(STORE_REPLIES.member);
  if (triggers.includes('refund')) return pick(STORE_REPLIES.refund);
  if (triggers.includes('queue')) return pick(STORE_REPLIES.queue);
  if (triggers.includes('mystery')) return pick(STORE_REPLIES.mystery);
  if (triggers.includes('staff')) return pick(STORE_REPLIES.staff);
  if (track === 'kitchen_staff' || triggers.includes('kitchen')) return pick(STORE_REPLIES.kitchen);
  if (track === 'hq_ops' || triggers.includes('hq')) return pick(STORE_REPLIES.hq);
  return pick(STORE_REPLIES.default);
}

export function shouldEndStoreSession(session, track) {
  const emotion = Number(session.emotion || 50);
  const satisfaction = Number(session.satisfaction || 60);
  if (emotion <= 15) return { end: true, outcome: 'walkout', reason: '客人怒而离席/要求找店长。' };
  if (satisfaction >= 85 && Number(session.meta?.turn_hint || 0) >= 5) {
    return { end: true, outcome: 'resolved', reason: '客人表示认可，本场可以结束。' };
  }
  if (track === 'store_manager' && emotion <= 20) {
    return { end: true, outcome: 'escalated', reason: '场面失控，需要总部介入。' };
  }
  return { end: false };
}

/** 场景种子（绑定能力） */
export const BUILTIN_STORE_SCENARIOS = [
  { scenario_key: 'foh_rush', job_profile_key: 'foh_server', title: '顾客催菜', difficulty: 2, goal: '安抚并给明确等待时间', default_persona_key: 'foh_rush_diner', competencies: [['exception_handling', 1, true], ['communication', 0.5, false]] },
  { scenario_key: 'foh_recommend', job_profile_key: 'foh_server', title: '推荐套餐', difficulty: 2, goal: '了解忌口后推荐', default_persona_key: 'foh_first_visit', competencies: [['recommendation', 1, true], ['product_knowledge', 0.6, false]] },
  { scenario_key: 'foh_wrong_dish', job_profile_key: 'foh_server', title: '上错菜', difficulty: 3, goal: '揽责+换菜闭环', default_persona_key: 'foh_wrong_dish', competencies: [['exception_handling', 1, true], ['service_awareness', 0.5, false]] },
  { scenario_key: 'foh_member', job_profile_key: 'foh_server', title: '会员引导', difficulty: 2, goal: '说清会员利益', default_persona_key: 'foh_member_ask', competencies: [['member_conversion', 1, true], ['brand_expression', 0.4, false]] },
  { scenario_key: 'foh_vip', job_profile_key: 'foh_server', title: 'VIP 接待', difficulty: 4, goal: '高标准接待与品牌表达', default_persona_key: 'foh_vip', competencies: [['service_awareness', 1, true], ['brand_expression', 0.8, false]] },
  { scenario_key: 'cash_refund', job_profile_key: 'cashier', title: '退款解释', difficulty: 3, goal: '核实后礼貌处理', default_persona_key: 'cash_refund_guest', competencies: [['exception_handling', 1, true], ['product_knowledge', 0.5, false]] },
  { scenario_key: 'cash_queue', job_profile_key: 'cashier', title: '排队结账', difficulty: 2, goal: '安抚并提速预期', default_persona_key: 'cash_queue_guest', competencies: [['communication', 1, true], ['service_awareness', 0.5, false]] },
  { scenario_key: 'cash_groupbuy', job_profile_key: 'cashier', title: '团购验券', difficulty: 2, goal: '规则说清', default_persona_key: 'cash_groupbuy', competencies: [['product_knowledge', 1, true], ['communication', 0.5, false]] },
  { scenario_key: 'mgr_complaint', job_profile_key: 'store_manager', title: '客诉升级', difficulty: 4, goal: '稳场并给方案', default_persona_key: 'mgr_angry_guest', competencies: [['exception_handling', 1, true], ['communication', 0.6, false]] },
  { scenario_key: 'mgr_mystery', job_profile_key: 'store_manager', title: '神秘顾客/巡店', difficulty: 5, goal: '据实应答与整改', default_persona_key: 'mgr_mystery', competencies: [['brand_expression', 1, true], ['service_awareness', 0.7, false]] },
  { scenario_key: 'mgr_staff', job_profile_key: 'store_manager', title: '排班冲突', difficulty: 3, goal: '先听员工再决策', default_persona_key: 'mgr_staff_conflict', competencies: [['communication', 1, true]] },
  { scenario_key: 'mgr_hq', job_profile_key: 'store_manager', title: '总部业绩追问', difficulty: 4, goal: '清晰动作汇报', default_persona_key: 'mgr_hq_review', competencies: [['communication', 1, true], ['service_awareness', 0.5, false]] },
  { scenario_key: 'kit_rush', job_profile_key: 'kitchen_staff', title: '催菜单协同', difficulty: 3, goal: '确认并给出餐时间', default_persona_key: 'kit_rush_ticket', competencies: [['exception_handling', 1, true], ['communication', 0.6, false]] },
  { scenario_key: 'kit_wrong', job_profile_key: 'kitchen_staff', title: '做错菜', difficulty: 3, goal: '食品安全与重做', default_persona_key: 'kit_wrong_item', competencies: [['product_knowledge', 1, true], ['service_awareness', 0.5, false]] },
  { scenario_key: 'hq_ops_brief', job_profile_key: 'hq_ops', title: '运营周会应答', difficulty: 3, goal: '目标澄清+动作', default_persona_key: 'hq_boss_brief', competencies: [['communication', 1, true], ['brand_expression', 0.5, false]] },
];

export const BUILTIN_STORE_PERSONAS = [
  { persona_key: 'foh_rush_diner', track: 'foh_server', audience: 'tenant', difficulty: 2, title: '堂食客 · 催菜', opening_line: '等了四十分钟菜还没来，孩子都哭了，你们怎么做事的？', profile: { scenario_key: 'foh_rush', objections: ['rush', 'angry'] } },
  { persona_key: 'foh_first_visit', track: 'foh_server', audience: 'tenant', difficulty: 2, title: '新客 · 不知点什么', opening_line: '第一次来，有什么推荐？我们两个人，一个不太能吃辣。', profile: { scenario_key: 'foh_recommend', objections: ['ask_recommend'] } },
  { persona_key: 'foh_wrong_dish', track: 'foh_server', audience: 'tenant', difficulty: 3, title: '堂食客 · 上错菜', opening_line: '这根本不是我点的红烧肉！你们怎么上菜的？', profile: { scenario_key: 'foh_wrong_dish', objections: ['wrong_dish', 'angry'] } },
  { persona_key: 'foh_member_ask', track: 'foh_server', audience: 'tenant', difficulty: 2, title: '客人 · 问会员', opening_line: '你们办会员到底有什么用？别只劝我充钱。', profile: { scenario_key: 'foh_member', objections: ['member'] } },
  { persona_key: 'foh_vip', track: 'foh_server', audience: 'tenant', difficulty: 4, title: 'VIP 熟客', opening_line: '老规矩，包间那位常客到了，按品牌标准接待。', profile: { scenario_key: 'foh_vip', traits: ['vip'] } },
  { persona_key: 'cash_refund_guest', track: 'cashier', audience: 'tenant', difficulty: 3, title: '结账客 · 要退款', opening_line: '团购用不了，我要全额退款，别跟我绕。', profile: { scenario_key: 'cash_refund', objections: ['refund'] } },
  { persona_key: 'cash_queue_guest', track: 'cashier', audience: 'tenant', difficulty: 2, title: '排队客 · 不耐烦', opening_line: '队伍这么长，你们多开个收银台行不行？等了二十分钟了！', profile: { scenario_key: 'cash_queue', objections: ['queue', 'angry'] } },
  { persona_key: 'cash_groupbuy', track: 'cashier', audience: 'tenant', difficulty: 2, title: '团购客 · 验券争议', opening_line: '美团套餐为什么不能叠加会员折扣？当时页面没写清楚。', profile: { scenario_key: 'cash_groupbuy', objections: ['refund'] } },
  { persona_key: 'mgr_angry_guest', track: 'store_manager', audience: 'tenant', difficulty: 4, title: '升级客诉 · 要找店长', opening_line: '服务员解决不了！你是店长吧？今天必须给说法，不然投诉！', profile: { scenario_key: 'mgr_complaint', objections: ['angry', 'complaint'] } },
  { persona_key: 'mgr_mystery', track: 'store_manager', audience: 'tenant', difficulty: 5, title: '神秘顾客/督导', opening_line: '我按总部标准问：刚才迎宾、推荐、送客三项，你门店做到了哪几项？', profile: { scenario_key: 'mgr_mystery', objections: ['mystery'] } },
  { persona_key: 'mgr_staff_conflict', track: 'store_manager', audience: 'tenant', difficulty: 3, title: '员工 · 排班冲突', opening_line: '排班又改，这个月第三次了，我不干了。你到底站谁那边？', profile: { scenario_key: 'mgr_staff', objections: ['staff'] } },
  { persona_key: 'mgr_hq_review', track: 'store_manager', audience: 'tenant', difficulty: 4, title: '总部 · 业绩追问', opening_line: '复购又掉了，你先别解释，告诉我明天门店怎么改。', profile: { scenario_key: 'mgr_hq', objections: ['hq'] } },
  { persona_key: 'kit_rush_ticket', track: 'kitchen_staff', audience: 'tenant', difficulty: 3, title: '前厅传菜 · 催单', opening_line: '8号桌催第三次了，这单火大吗？客人催疯了！', profile: { scenario_key: 'kit_rush', objections: ['kitchen', 'rush'] } },
  { persona_key: 'kit_wrong_item', track: 'kitchen_staff', audience: 'tenant', difficulty: 3, title: '前厅 · 反馈做错菜', opening_line: '这盘是不是上错了？客人说没点这个，还说有根头发！', profile: { scenario_key: 'kit_wrong', objections: ['wrong_dish', 'kitchen'] } },
  { persona_key: 'hq_boss_brief', track: 'hq_ops', audience: 'tenant', difficulty: 3, title: '老板 · 运营周会', opening_line: '数据我有，要你的动作——下周两家店客流怎么拉回来？', profile: { scenario_key: 'hq_ops_brief', objections: ['hq'] } },
];

export const STORE_COMPETENCY_SEEDS = {
  foh_server: FOH_SKILLS.map((k, i) => ({ key: k, ability_key: k, label: labelOf(k), sort_order: (i + 1) * 10 })),
  cashier: CASHIER_SKILLS.map((k, i) => ({ key: k, ability_key: k, label: labelOf(k), sort_order: (i + 1) * 10 })),
  store_manager: MANAGER_SKILLS.map((k, i) => ({ key: k, ability_key: k, label: labelOf(k), sort_order: (i + 1) * 10 })),
  kitchen_staff: KITCHEN_SKILLS.map((k, i) => ({ key: k, ability_key: k, label: labelOf(k), sort_order: (i + 1) * 10 })),
  hq_ops: HQ_SKILLS.map((k, i) => ({ key: k, ability_key: k, label: labelOf(k), sort_order: (i + 1) * 10 })),
};

function labelOf(k) {
  return ({
    service_awareness: '服务意识',
    product_knowledge: '产品知识',
    recommendation: '推荐能力',
    communication: '沟通能力',
    exception_handling: '异常处理',
    member_conversion: '会员转化',
    brand_expression: '品牌表达',
  })[k] || k;
}

export async function ensureStoreScenarioSeed(pool) {
  for (const s of BUILTIN_STORE_SCENARIOS) {
    await pool.query(
      `INSERT INTO job_coach_scenarios
         (scenario_key, job_profile_key, title, difficulty, goal, default_persona_key, active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       ON CONFLICT (scenario_key) DO UPDATE SET
         title=EXCLUDED.title, difficulty=EXCLUDED.difficulty,
         goal=EXCLUDED.goal, default_persona_key=EXCLUDED.default_persona_key, active=TRUE`,
      [s.scenario_key, s.job_profile_key, s.title, s.difficulty, s.goal, s.default_persona_key]
    );
    for (const [comp, weight, isPrimary] of s.competencies) {
      await pool.query(
        `INSERT INTO job_coach_scenario_competencies (scenario_key, competency_key, weight, is_primary)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (scenario_key, competency_key) DO UPDATE SET
           weight=EXCLUDED.weight, is_primary=EXCLUDED.is_primary`,
        [s.scenario_key, comp, weight, isPrimary]
      );
    }
  }
}
