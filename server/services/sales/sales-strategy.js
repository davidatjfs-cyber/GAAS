/**
 * 销售对话策略机：确定性决定「下一问 / 是否转人工 / 能否报价」
 * LLM 只负责「怎么说」，不负责「该不该说」。
 */
import { DIAGNOSTIC_SLOTS, knowledgeForPain, containsForbiddenClaim } from './sales-knowledge.js';
import { diagnoseLead } from './sales-diagnosis.js';
import { normalizeCustomerProfileSlots } from './sales-lead-schema.js';

const HIGH_INTENT_PATTERNS = [
  /价格|多少钱|报价|费用|收费/,
  /demo|演示|看一下系统|演示一下/i,
  /合同|签约|付款|对公/,
  /试跑|试用|试点/,
  /接入|对接|能不能接/,
  /什么时候能上|上线时间|下周|尽快|这个月|下个月|下月/,
];

const BUYING_SIGNALS = [/正在找|想上系统|准备采购|对比过|有预算|有需求|有意向/];
const NEGATIVE_SIGNALS = [/随便问问|看看|了解一下|先看看|暂时不需要|没预算|太贵|不急着|不着急/];
const UNCERTAINTY_RE = /不确定|不知道|不清楚|不太清楚|没确认|没注意|不了解|不晓得|说不准/;
const CITY_PATTERN = '北京|上海|广州|深圳|杭州|成都|重庆|武汉|南京|苏州|西安|天津|青岛|厦门|长沙|郑州|宁波|无锡|佛山|东莞|合肥|福州|济南|沈阳|大连|昆明|哈尔滨|长春|南宁|贵阳|石家庄|太原|南昌|兰州|乌鲁木齐|呼和浩特|海口|银川|西宁|拉萨';

const QUESTION_SLOT_PATTERNS = [
  ['member_estimate', /(?:会员|客户|手机号).{0,18}(?:大概有多少|有多少|多少个|规模|数量|积累)/],
  ['phone_data_ready', /(?:POS|订单|会员|顾客).{0,22}(?:手机号|手机号码)|(?:记录|留|存).{0,12}(?:客户|会员)?手机号|有没有手机号/],
  ['store_count', /(?:几家|多少家|门店数)/],
  ['city', /(?:哪个|什么|哪些).{0,8}城市|门店.{0,8}在哪/],
  ['cuisine', /(?:什么|哪种).{0,8}(?:品类|菜系)|主要经营/],
  ['pos_brand', /(?:哪家|什么|哪个).{0,8}POS|POS.{0,8}(?:品牌|系统)/i],
  ['other_system_used', /(?:有没有|是否|在用).{0,12}(?:会员|营销).{0,6}(?:系统|软件)/],
  ['pain_point', /(?:最想|最头疼|优先).{0,15}(?:解决|问题)|复购、门店执行/],
  ['contact_phone', /(?:留|提供|方便).{0,8}(?:手机号|联系方式)/],
  ['decision_role', /(?:您本人|谁).{0,10}(?:评估|拍板|决定)|运营\/?IT/],
];

export function isUncertainAnswer(text = '') {
  return UNCERTAINTY_RE.test(String(text || ''));
}

export function inferQuestionSlotFromText(text = '') {
  const value = String(text || '');
  return QUESTION_SLOT_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

export function inferRecentQuestionSlot(history = []) {
  const outbound = (history || []).filter((m) => m.direction === 'outbound').slice(-6).reverse();
  for (const message of outbound) {
    const slot = inferQuestionSlotFromText(message.content);
    if (slot) return slot;
  }
  return null;
}

function markSlotUncertain(extracted, slot) {
  if (!slot) return;
  const uncertain = new Set(Array.isArray(extracted.uncertain_slots) ? extracted.uncertain_slots : []);
  uncertain.add(slot);
  extracted[slot] = null;
  extracted.uncertain_slots = [...uncertain];
}

export function extractSlotsFromText(text = '', prev = {}) {
  const t = String(text || '');
  const out = normalizeCustomerProfileSlots(prev);
  const uncertainSlots = new Set(Array.isArray(out.uncertain_slots) ? out.uncertain_slots : []);

  const nameM = t.match(/(?:我(?:姓|叫)|本人|名字|贵姓|怎么称呼|叫我)([^，。,\d]{1,6})/);
  if (nameM) out.name = nameM[1].trim();

  const companyM = t.match(/(?:我们(?:店|品牌|公司|餐厅)|(?:叫|品牌是|公司名称))([^，。,]{2,20})/);
  if (companyM) out.company = companyM[1].trim();

  const phoneM = t.match(/(?:1[3-9]\d{9}|(?:0\d{2,3}-?)?\d{7,8})/);
  if (phoneM) {
    out.contact_phone = phoneM[0];
    uncertainSlots.delete('contact_phone');
  }

  const budgetM = t.match(/(?:预算|大概|投入|一年|每年).*?(\d+(?:\.\d+)?)\s*万/);
  if (budgetM) out.budget_range = `${budgetM[1]}万/年`;
  else if (/预算有限|便宜|省钱|低成本|低成本方案|性价比/.test(t)) out.budget_range = 'low';
  else if (/不差钱|预算充足|没问题|可以投|看效果|值得/.test(t)) out.budget_range = 'high';

  const closeDateM = t.match(/(?:年底|明年|春节后|春节后|6月|7月|8月|9月|10月|11月|12月|一季度|二季度|三季度|四季度)/);
  if (closeDateM) out.expected_close_hint = closeDateM[0];

  const storeM = t.match(/(\d+)\s*家/);
  if (storeM) {
    out.store_count = Number(storeM[1]);
    uncertainSlots.delete('store_count');
  }

  const posM = t.match(/客如云|美团|企迈|天财|二维火|二维虎|收钱吧|哗啦啦|博云|银豹|美味不用等/);
  if (posM) {
    out.pos_brand = posM[0] === '二维虎' ? '二维火' : posM[0];
    uncertainSlots.delete('pos_brand');
  }

  const phoneDataUncertain = isUncertainAnswer(t) && /(?:手机号|手机号码|会员资料|顾客信息)/.test(t);
  if (phoneDataUncertain) {
    out.phone_data_ready = null;
    uncertainSlots.add('phone_data_ready');
  } else if (/有手机号|能记录手机|有会员手机|手机号齐全|可以.*手机号/.test(t)) {
    out.phone_data_ready = true;
    uncertainSlots.delete('phone_data_ready');
  } else if (/(?<!有)没有手机号|无手机号|记录不了手机/.test(t)) {
    out.phone_data_ready = false;
    uncertainSlots.delete('phone_data_ready');
  }

  if (/会员系统|CRM|营销系统|营销.*软件|客户.*系统|会员.*软件/.test(t)) out.has_member_system = true;
  if (/没有会员系统|没.*系统|没.*软件|无.*系统/.test(t)) out.has_member_system = false;

  if (/复购|老客|流失|回店|回头客|复购率/.test(t)) out.pain_point = '复购';
  else if (/营业额|收入|营收|下滑|下降|赚钱|利润|流水|业绩|生意不好/.test(t)) out.pain_point = '营业额下降';
  else if (/执行|店长|不会干|跟进|落地|督导|执行差|执行弱|人效|执行力/.test(t)) out.pain_point = '门店执行';
  else if (/培训|人才|员工|培养|流失|招聘|人效|能力|员工流失|不稳定/.test(t)) out.pain_point = '人才培养';
  else if (/多店|连锁|管理困难|管不过来|门店多|督导|巡店|标准化/.test(t)) out.pain_point = '多店管理';
  else if (/营销|投放|广告|推广|ROI|抖音|小红书|大众点评|广告费|触达|短信|企微|微信/.test(t)) out.pain_point = '营销归因';
  else if (/数据|报表|看不见|经营数据不清楚|不知道经营数据|老板要看|缺数据|数据孤岛/.test(t)) out.pain_point = '缺少经营数据';

  if (/老板|我自己|法人|创始人|老板娘|我亲自|我决定|我说了算|拍板/.test(t)) out.decision_role = '老板';
  else if (/运营|店长|经理|总监|合伙人|副总|总经理|负责人|主管/.test(t)) out.decision_role = '运营';
  else if (/IT|技术|信息|系统管理员|运维|开发/.test(t)) out.decision_role = 'IT';
  else if (/财务|会计|出纳|行政|人事|采购|hr/.test(t)) out.decision_role = '职能';

  const cities = [...t.matchAll(new RegExp(CITY_PATTERN, 'g'))].map((m) => m[0]);
  if (cities.length) {
    out.cities = [...new Set(cities)];
    out.city = out.cities.join('、');
    uncertainSlots.delete('city');
  }

  if (/潮汕|粤菜|川菜|火锅|烧烤|湘菜|日料|西餐|快餐|咖啡|茶饮|烘焙|云南菜|新疆菜|西北菜|江浙菜|东北菜|鲁菜|徽菜|闽菜|湘菜|本帮菜|淮扬菜|小吃|自助餐|轻食|酒馆|酒吧|烧烤|烤肉|串串|麻辣烫|粉面|饺子|粥|包子|汉堡|炸鸡|奶茶|甜品|冰淇淋/.test(t)) {
    const m = t.match(/潮汕|粤菜|川菜|火锅|烧烤|湘菜|日料|西餐|快餐|咖啡|茶饮|烘焙|云南菜|新疆菜|西北菜|江浙菜|东北菜|鲁菜|徽菜|闽菜|本帮菜|淮扬菜|小吃|自助餐|轻食|酒馆|酒吧|串串|麻辣烫|粉面|饺子|粥|包子|汉堡|炸鸡|奶茶|甜品|冰淇淋/);
    if (m) {
      out.cuisine = m[0];
      uncertainSlots.delete('cuisine');
    }
  }

  const CN_WAN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cnMemM = t.match(/([一二三四五六七八九十两\d]+)\s*万/);
  if (cnMemM && /会员|客户|手机|微信|企微|粉丝/.test(t)) {
    const raw = cnMemM[1];
    const n = /^\d+$/.test(raw) ? Number(raw) : (CN_WAN[raw] || (raw === '十' ? 10 : null));
    if (n) {
      out.member_estimate = Math.round(n * 10000);
      uncertainSlots.delete('member_estimate');
    }
  }
  const memM = t.match(/(\d+(?:\.\d+)?)\s*万/);
  if (!out.member_estimate && memM && /会员|客户|手机|微信|企微|粉丝/.test(t)) {
    out.member_estimate = Math.round(Number(memM[1]) * 10000);
    uncertainSlots.delete('member_estimate');
  }
  else if (!out.member_estimate && /两三千|三千|四千|五千|六千|七八千|八九千|九千|10000|1万|几千|一万多/.test(t) && /会员|客户|手机/.test(t)) {
    const nM = t.match(/(\d+)\s*千/);
    if (nM) {
      out.member_estimate = Math.round(Number(nM[1]) * 1000);
      uncertainSlots.delete('member_estimate');
    }
  }

  if (/在用.*(会员|营销|CRM|系统|软件)|已经有.*(会员|营销|系统|软件)|用过.*(系统|软件)|用过.*(有赞|客如云|美团|二维火|哗啦啦|银豹)/i.test(t)) {
    out.other_system_used = true;
    uncertainSlots.delete('other_system_used');
  } else if (/没有用.*系统|没有其他系统|没用系统|没有系统|没用过.*(系统|软件)|从零开始|还没用|没有会员系统/.test(t)) {
    out.other_system_used = false;
    uncertainSlots.delete('other_system_used');
  }

  if (out.decision_role && /(?:老板|我自己|法人|创始人|运营|店长|经理|总监|IT|技术|财务|会计|行政|人事|hr)/i.test(t)) uncertainSlots.delete('decision_role');
  if (uncertainSlots.size) out.uncertain_slots = [...uncertainSlots];
  else delete out.uncertain_slots;

  return normalizeCustomerProfileSlots(out);
}

export function detectEvents(text = '') {
  const t = String(text || '');
  const events = [];
  if (/价格|多少钱|报价|费用|收费|年费|月费|多少钱一套|怎么收费|怎么定价/.test(t)) events.push({ event_type: 'ASK_PRICE', priority: 'high', recommended_action: 'takeover' });
  if (/demo|演示|看一下系统|演示一下|产品演示|在线演示|腾讯会议|飞书会议|会议演示|展示/i.test(t)) events.push({ event_type: 'REQUEST_DEMO', priority: 'high', recommended_action: 'takeover' });
  if (/试跑|试用|试点|试一个月|试两个月|30天|三十天|试一个店|跑一个月|跑一跑|跑一下|测试一下|体验|体验一下|试试看|试一试行不行/.test(t)) events.push({ event_type: 'REQUEST_TRIAL', priority: 'high', recommended_action: 'takeover' });
  if (/合同|签约|付款|对公|打款|发票|付款方式|签约流程|合作流程|走流程|审批|预算|申请预算/.test(t)) events.push({ event_type: 'ASK_CONTRACT', priority: 'high', recommended_action: 'takeover' });
  if (/接入|对接|POS|数据打通|数据同步|接口|导入|数据迁移|能否接|可以接|能不能接|怎么接|接不接|支持.*POS|支持.*数据|支持.*系统|能接吗|能对接吗/.test(t)) events.push({ event_type: 'ASK_POS_INTEGRATION', priority: 'high', recommended_action: 'notify_sales' });
  if (/能不能便宜|便宜点|打个折|折扣|优惠|优惠吗|有没有优惠|能不能便宜|少点|便宜多少|降点价|价格能否优惠|优惠方案|最低价/.test(t)) events.push({ event_type: 'ASK_DISCOUNT', priority: 'high', recommended_action: 'takeover' });
  if (/已经.*看|已经.*对比|正在对比|正在比较|比几家|看了几家|其他家|竞品|竞争者|替代方案|也在看|同时看|比较一下|几家产品|几个方案/.test(t)) events.push({ event_type: 'COMPETITOR_MENTIONED', priority: 'medium', recommended_action: 'notify_sales' });
  if (BUYING_SIGNALS.some((re) => re.test(t))) events.push({ event_type: 'BUYING_INTENT', priority: 'medium', recommended_action: 'notify_sales' });
  if (NEGATIVE_SIGNALS.some((re) => re.test(t))) events.push({ event_type: 'LOW_INTEREST', priority: 'low', recommended_action: 'continue' });
  if (/复购|老客|流失|回店|营业额|下降|执行|店长|培训|人才|员工|多店|管理|营销|数据|归因|ROI|客户分层|会员维护|触达|客户维护|私域|公域|新客|激活|沉睡|流失预警|复购率|回店率|客户生命周期|会员价值|LTV/.test(t)) events.push({ event_type: 'PAIN_STATED', priority: 'normal', recommended_action: 'continue' });
  return events;
}

export function nextDiagnosticQuestion(extracted = {}) {
  const uncertain = new Set(Array.isArray(extracted.uncertain_slots) ? extracted.uncertain_slots : []);
  for (const slot of DIAGNOSTIC_SLOTS) {
    if (uncertain.has(slot.key)) continue;
    if (slot.key === 'member_estimate' && uncertain.has('phone_data_ready')) continue;
    if (slot.key === 'store_count' && extracted.store_count == null) return slot;
    if (slot.key === 'city' && !extracted.city) return slot;
    if (slot.key === 'cuisine' && !extracted.cuisine) return slot;
    if (slot.key === 'pos_brand' && !extracted.pos_brand) return slot;
    if (slot.key === 'phone_data_ready' && extracted.phone_data_ready == null) return slot;
    if (slot.key === 'member_estimate' && extracted.member_estimate == null) return slot;
    if (slot.key === 'other_system_used' && extracted.other_system_used == null) return slot;
    if (slot.key === 'pain_point' && !extracted.pain_point) return slot;
    if (slot.key === 'decision_role' && !extracted.decision_role) return slot;
    if (slot.key === 'contact_phone' && !extracted.contact_phone && !extracted.phone) return slot;
  }
  return null;
}

export function shouldTakeover({ text, extracted, intentScore, controller }) {
  if (controller === 'human' || controller === 'waiting_human') return { takeover: false, reason: 'already_human' };
  const t = String(text || '');
  if (HIGH_INTENT_PATTERNS.some((re) => re.test(t))) return { takeover: true, reason: 'high_intent_phrase', level: 'high' };
  if ((intentScore || 0) >= 70) return { takeover: true, reason: 'score_threshold', level: 'high' };
  if ((extracted.store_count || 0) >= 3 && extracted.pain_point && extracted.phone_data_ready === true && (intentScore || 0) >= 50) {
    return { takeover: true, reason: 'qualified_profile', level: 'high' };
  }
  if ((intentScore || 0) >= 40) return { takeover: false, reason: 'watch', level: 'medium' };
  return { takeover: false, reason: 'continue', level: 'low' };
}

export function buildStrategyPlan({ userText, extracted, history = [], intentScore = 0, controller = 'ai', knowledgeItems }) {
  const slots = extractSlotsFromText(userText, extracted || {});
  let uncertainSlot = null;
  if (isUncertainAnswer(userText)) {
    uncertainSlot = inferQuestionSlotFromText(userText) || inferRecentQuestionSlot(history);
    if (uncertainSlot) markSlotUncertain(slots, uncertainSlot);
  }
  const events = detectEvents(userText);
  const nextQ = nextDiagnosticQuestion(slots);
  const takeover = shouldTakeover({ text: userText, extracted: slots, intentScore, controller });
  const knowledge = knowledgeForPain(slots.pain_point || userText, knowledgeItems);

  let mode = 'diagnose';
  let diagnosis = null;
  if (takeover.takeover) mode = 'handoff';
  else if (uncertainSlot) mode = 'clarify_unknown';
  else if (!nextQ && !slots.diagnosis_delivered) {
    // 9个槽位全部收集完毕后，给出一次经营诊断结论，而不是继续问下一题或直接结束
    mode = 'diagnosis_complete';
    diagnosis = diagnoseLead(slots);
    slots.diagnosis_delivered = true;
  } else if (/你们|系统|功能|什么|怎么|能否|可以|适合|有哪些|介绍一下|讲讲|说说|是什么|怎么做/.test(String(userText || '')) && slots.pain_point) mode = 'value_match';
  else if (/你们|系统|功能|什么|介绍|产品|方案|服务|是什么|怎么收费|适合谁|有啥用/.test(String(userText || ''))) mode = 'introduce';

  return {
    mode,
    extracted: slots,
    events,
    next_question: nextQ,
    knowledge,
    diagnosis,
    uncertain_slot: uncertainSlot,
    takeover,
    allow_price_talk: !takeover.takeover && !/折扣|便宜点|优惠|便宜|降价|少点|优惠吗|最低价|特价/.test(String(userText || '')),
    history_turns: history.length,
  };
}

/** 诊断结论后的转化动作按意向分层，对齐 shouldTakeover 的 40 分中意向门槛 */
export function diagnosisCta(intentScore = 0) {
  if ((intentScore || 0) >= 40) {
    return '我可以为您安排一次30分钟的针对性演示，演示内容会直接按照您目前的门店情况准备，而不是泛泛介绍系统。';
  }
  if ((intentScore || 0) >= 20) {
    return '我先给您发送一个与您情况接近的餐饮客户解决方案，您看完以后，我再帮您安排一次针对性的演示。';
  }
  return '我已经记录了您目前最关注的问题，后续您需要了解客户复购、员工管理或多店经营时，可以直接继续问我。';
}

// 客户AI禁止自行报价：命中具体数字+货币/折扣单位即视为报价（¥xxx、xxx元、xxx万、xx折），
// 客户问价格由 shouldTakeover 的 HIGH_INTENT_PATTERNS 先一步转人工兜底；这里是第二道防线，
// 防止LLM在非报价语境下自由发挥时意外说出具体数字。
const PRICE_MENTION_RE = /¥\s*\d+(\.\d+)?|\d+(\.\d+)?\s*(元|块钱|万元|折)/;
export function containsPriceMention(text = '') {
  return PRICE_MENTION_RE.test(String(text || ''));
}

export function sanitizeReply(text = '') {
  let out = String(text || '').trim();
  out = out.replace(/^(?:嗯+|呃+|啊+)[，,。！!\s]*/, '');
  out = out.replace(/精准(?:地)?找出原因/g, '辅助定位原因');
  const posBrands = '客如云|美团|企迈|天财|二维火|收钱吧|哗啦啦|博云|银豹|美味不用等';
  out = out.replace(
    new RegExp(`(${posBrands})(?:的)?(?:POS)?(?:系统)?我们(?:是)?支持的`, 'g'),
    '$1能否标准接入需要先做数据字段与接口评估'
  );
  out = out.replace(
    new RegExp(`我们(?:是)?支持(${posBrands})(?:的)?(?:POS)?(?:系统)?`, 'g'),
    '$1能否标准接入需要先做数据字段与接口评估'
  );
  const hit = containsForbiddenClaim(out);
  if (hit) {
    out = out.replace(hit, '需由顾问评估后确认');
  }
  if (out.length > 220) out = `${out.slice(0, 200)}…`;
  const parts = out.split('？');
  if (parts.length > 2) out = `${parts[0]}？`;
  return out.trim();
}

/** 无 LLM 时的高质量模板回复（保证像顾问） */
export function templateReply(plan, userText, intentScore = 0) {
  const e = plan.extracted || {};
  const q = plan.next_question?.question;

  if (plan.mode === 'handoff') {
    return '根据您提到的情况，已经比较适合安排顾问做一次针对性说明和可行性判断。我这边先为您转人工顾问，他会基于您的门店数和数据条件继续沟通，不耽误您时间。';
  }

  if (plan.mode === 'diagnosis_complete') {
    const d = plan.diagnosis || {};
    const causes = (d.root_causes || []).slice(0, 2).join('；');
    const modules = (d.recommended_modules || []).slice(0, 3).join('、');
    const caseLine = plan.caseBlurb ? `同类客户案例：${plan.caseBlurb}。` : '';
    return `根据您目前的情况，核心问题是「${d.surface_problem}」，背后原因可能是：${causes}。建议先帮您解决：${modules}。${caseLine}${diagnosisCta(intentScore)}`;
  }

  if (plan.mode === 'introduce') {
    const base = plan.knowledge?.body || '';
    return `${base}${q ? ` ${q}` : ' 您目前最想先解决哪一类问题？'}`;
  }

  if (plan.mode === 'value_match') {
    const pain = e.pain_point || '经营问题';
    return `您说的「${pain}」正是我们重点场景。${plan.knowledge?.body || ''}${q ? ` ${q}` : ''}`;
  }

  if (e.store_count && !e.pain_point) {
    return `收到，${e.store_count} 家门店的规模已经适合看连锁经营闭环。${q || '您现在最头疼的是复购、执行、人才培养还是多店管理？'}`;
  }
  if (e.store_count && e.pain_point) {
    return `收到，${e.store_count} 家店，您提到「${e.pain_point}」这块很关键。${plan.knowledge?.body || ''}${q ? ` ${q}` : ''}`;
  }
  if (userText && q) {
    return `明白。${q}`;
  }
  return q || '您好，我是李娟娟，负责餐厅经营顾问这块。请问您目前有几家门店？';
}
