/**
 * 客户 AI 一轮对话：策略机 → LLM 生成 → 闸门
 */
import { SALES_PERSONA, PUBLIC_KNOWLEDGE } from './sales-knowledge.js';
import {
  buildStrategyPlan,
  sanitizeReply,
  templateReply,
  containsPriceMention,
  diagnosisCta,
  inferQuestionSlotFromText,
  inferRecentQuestionSlot,
  isUncertainAnswer,
} from './sales-strategy.js';
import { recommendCasesForLead, formatCaseBlurb } from './sales-case-library.js';

let _callLLM = null;
export function setSalesCustomerAiLlm(fn) {
  _callLLM = fn;
}

/**
 * 客户短时间内反复问同一件事(比如连续测试"能语音吗")时，如果原样把每一条都塞进历史，
 * 大模型会被这种高密度重复"带偏"，倾向于顺着历史模式续写而忽略客户最新这一句真正问的
 * 是什么(实测复现：客户测完语音后正常回答"上海，北京"，AI却又重复了几轮前的语音拒绝话术)。
 * 这里按发言方折叠最近的高度相似消息，即使中间夹着一条对方回复也能识别，避免真实的
 * “客户重复提问↔AI重复回答”交替循环挤占模型注意力。
 */
const OBSOLETE_VOICE_DENIAL_RE = /只能.{0,8}文字|还是.{0,8}文字|没法.{0,8}语音|不能.{0,8}语音|无法.{0,8}语音/;
const VOICE_CAPABILITY_QUERY_RE = /(?:能|可以|会).{0,8}(?:听|识别|收|发|回复|回答).{0,8}语音|语音.{0,8}(?:回答|回复|听|识别|测试)|听.{0,5}(?:见|到|懂).{0,10}(?:说话|声音)/;
const CORRECTION_RE = /你听不懂|你没听懂|你没明白|我说的是|不是这个意思|能听明白我的意思|你能听明白|理解错了/;
const MATERIAL_REQUEST_RE = /产品介绍|书面|文字版|资料|介绍.{0,8}(?:发|看)|发.{0,8}(?:介绍|方案)/;
const CONTACT_QUERY_RE = /怎么联系|如何联系|联系你们|联系.{0,6}客户顾问|找.{0,6}顾问/;
const COMMITMENT_QUERY_RE = /什么承诺|能.{0,6}承诺|承诺.{0,6}什么|能.{0,6}保证/;
const TRIAL_QUERY_RE = /试用|试跑|试点|体验.{0,6}(?:一个月|30天)|试.{0,4}一个月/;
const PROFILE_MEMORY_QUERY_RE = /还记得.{0,12}(?:公司|品牌)|我是哪家公司|知道我是哪家/;
const PRESENCE_QUERY_RE = /^(?:你|您)?还?在吗[？?]?$/;

function historyBeforeCurrent(messages = [], userText = '') {
  const out = (messages || []).map((m) => ({ ...m }));
  const current = String(userText || '').replace(/[，。？！?!\s]/g, '');
  const last = out[out.length - 1];
  const lastText = String(last?.content || '').replace(/[，。？！?!\s]/g, '');
  if (last?.direction === 'inbound' && current && current === lastText) out.pop();
  return out;
}

function collapseRepeats(messages) {
  const out = [];
  for (const m of messages) {
    let repeatedAt = -1;
    for (let i = out.length - 1; i >= Math.max(0, out.length - 4); i -= 1) {
      if (out[i].direction === m.direction && similar(out[i].content, m.content)) {
        repeatedAt = i;
        break;
      }
    }
    if (repeatedAt >= 0) {
      const previous = out.splice(repeatedAt, 1)[0];
      out.push({ ...m, count: (previous.count || 1) + 1 });
    } else {
      out.push({ ...m, count: 1 });
    }
  }
  return out;
}

function similar(a = '', b = '') {
  const na = String(a).replace(/[，。？！\s]/g, '');
  const nb = String(b).replace(/[，。？！\s]/g, '');
  if (!na || !nb) return false;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  return longer.includes(shorter.slice(0, Math.max(2, Math.floor(shorter.length * 0.6))));
}

function historyToPrompt(messages = [], userText = '') {
  const useful = historyBeforeCurrent(messages, userText)
    .filter((m) => !(m.direction === 'outbound' && OBSOLETE_VOICE_DENIAL_RE.test(String(m.content || ''))))
    .slice(-12);
  const collapsed = collapseRepeats(useful).slice(-8);
  return collapsed
    .map((m) => {
      const who = m.direction === 'inbound' ? '客户' : '顾问';
      const repeatNote = m.count > 1 ? `(类似内容连续问了${m.count}次)` : '';
      return `${who}：${m.content}${repeatNote}`;
    })
    .join('\n');
}

const UNKNOWN_SLOT_GUIDANCE = {
  phone_data_ready: '您可以在POS后台随机打开一笔会员订单或一个会员档案，看顾客信息里有没有“手机号”字段；也可以直接问收银员，结账或办会员时是否会留手机号',
  member_estimate: '可以打开POS的会员中心或会员管理页，看会员总数；如果只看到会员ID而没有手机号，也可以直接告诉我',
  pos_brand: '可以看收银机的登录页、系统左上角品牌名，或直接问店长/收银员',
  store_count: '可以按目前正在营业的门店数计算，筹备中和已关店的先不算',
  other_system_used: '可以问一下运营或收银员，除POS外是否还登录过会员、营销或CRM系统',
};
const SLOT_LABELS = {
  phone_data_ready: '有没有客户手机号',
  member_estimate: '会员或客户数量',
  pos_brand: 'POS品牌',
  store_count: '门店数量',
  other_system_used: '是否在用其他会员或营销系统',
};

function recentOutboundHasGuidance(history, slot) {
  const recent = (history || []).filter((m) => m.direction === 'outbound').slice(-4).map((m) => String(m.content || '')).join('\n');
  if (slot === 'phone_data_ready') return /会员订单|会员档案|手机号字段|问收银员/.test(recent);
  return /待确认|不用猜|稍后再查/.test(recent);
}

function buildUncertaintyReply({ userText, plan, history }) {
  const slot = plan.uncertain_slot || inferQuestionSlotFromText(userText) || inferRecentQuestionSlot(history);
  if (!slot) return null;
  const corrected = CORRECTION_RE.test(String(userText || ''));
  const alreadyExplained = recentOutboundHasGuidance(history, slot);
  const label = SLOT_LABELS[slot] || '这个信息';
  const prefix = corrected
    ? slot === 'phone_data_ready'
      ? '是我刚才理解错了，抱歉。您的意思是“目前不确定有没有手机号”，不是“没有手机号”。'
      : `是我刚才理解错了，抱歉。您的意思是“目前不确定${label}”，不是已经给出了确定答案。`
    : '';
  if (alreadyExplained) {
    return `${prefix}这个先记为“待确认”，不需要现在反复查，也不影响我们继续沟通。等方便时按刚才的方法看一下就行。`;
  }
  let guidance = UNKNOWN_SLOT_GUIDANCE[slot] || '可以稍后问一下负责这块的同事，现在不需要靠猜';
  if (slot === 'phone_data_ready' && plan.extracted?.pos_brand) {
    guidance = guidance.replace('POS后台', `${plan.extracted.pos_brand}后台`);
  }
  return `${prefix}这个不用猜。${guidance}。现在不方便查的话，我先记为“待确认”，不再重复追问。`;
}

function buildProfileFactReply({ userText, previousExtracted = {}, plan, history }) {
  const text = String(userText || '');
  if (/[？?]|怎么|为什么|如何|能不能|能否|可以吗/.test(text) || plan.mode === 'handoff') return null;
  const current = plan.extracted || {};
  const changed = (key) => current[key] != null && JSON.stringify(current[key]) !== JSON.stringify(previousExtracted?.[key]);
  const changedKeys = ['store_count', 'city', 'cuisine', 'pos_brand', 'phone_data_ready', 'pain_point'].filter(changed);
  if (!changedKeys.length) return null;

  const recentSlot = inferRecentQuestionSlot(history);
  const nextQuestion = plan.next_question?.key && plan.next_question.key !== recentSlot ? plan.next_question.question : '';
  if (changed('pos_brand')) {
    return `您现在用的是${current.pos_brand}，我记下了。能否标准接入需要先做数据字段和接口评估，不会先口头承诺。${nextQuestion || ''}`;
  }
  if (changed('phone_data_ready')) {
    const status = current.phone_data_ready ? '订单里能记录客户手机号' : '订单里目前没有客户手机号';
    return `${status}，这个数据条件我记下了。${nextQuestion || ''}`;
  }

  if (changedKeys.length === 1 && changed('pain_point') && current.pain_point === '营业额下降') {
    return `营业额持续下降，先不要急着猜原因，最好按时段、渠道、菜品、客流和客单逐层拆开看。${nextQuestion ? `为了判断现有数据能做到哪一步，${nextQuestion}` : ''}`;
  }

  const facts = [];
  if (changed('store_count')) facts.push(`${current.store_count}家门店`);
  if (changed('city')) facts.push(`分布在${current.city}`);
  if (changed('cuisine')) facts.push(`主要做${current.cuisine}`);
  if (changed('pain_point')) facts.push(`重点关注${current.pain_point}`);
  if (!facts.length) return null;
  return `${facts.join('，')}，我记下了。${nextQuestion || ''}`;
}

function phoneTail(extracted = {}) {
  const phone = String(extracted.contact_phone || extracted.phone || '').replace(/\D/g, '');
  return phone.length >= 4 ? phone.slice(-4) : '';
}

function profileSummary(extracted = {}) {
  return [
    extracted.city,
    extracted.store_count ? `${extracted.store_count}家` : '',
    extracted.cuisine,
    extracted.pos_brand ? `使用${extracted.pos_brand}` : '',
  ].filter(Boolean).join('、');
}

function buildMaterialReply(extracted = {}) {
  const profile = profileSummary(extracted);
  return `可以，我先把文字版直接发您：我们做的是餐厅AI增长服务，核心是把POS经营数据、客户维护和门店执行串成闭环。${profile ? `按您目前${profile}的情况，` : ''}第一步评估数据字段，第二步做经营诊断和整改跟踪，第三步可选1～2家店做30天试跑，用真实结果决定是否扩大。`;
}

function buildContactReply(extracted = {}) {
  const tail = phoneTail(extracted);
  if (tail) return `您直接在当前微信继续发消息就可以。之前留的手机号尾号${tail}我已经记录，人工顾问会通过当前微信或这个号码与您联系，不需要再留一次。`;
  return '您直接在当前微信继续发消息就可以，人工顾问会在这个会话里接手。如果希望电话联系，再留一个方便接听的手机号即可。';
}

function buildTrialReply(extracted = {}) {
  const tail = phoneTail(extracted);
  const scale = extracted.store_count ? `再决定是否扩大到${extracted.store_count}家店` : '再决定是否扩大';
  return `可以申请30天试跑。先做数据评估，确认${extracted.pos_brand || 'POS'}能否提供订单、菜品和会员等必要字段，再选1～2家代表门店，约定营业额、复购或执行指标；30天后用真实结果复盘，${scale}。${tail ? `您已留过尾号${tail}，` : ''}我现在把试跑申请交给人工顾问确认范围和启动时间。`;
}

function buildProfileMemoryReply(extracted = {}) {
  const company = String(extracted.company || '').trim();
  if (company) return `记得，您是${company}。${profileSummary(extracted) ? `我这边还记录了：${profileSummary(extracted)}。` : ''}`;
  const known = profileSummary(extracted);
  return `公司或品牌名称我这边还没有记录到，不会随便猜。${known ? `已记住的是：${known}。` : ''}您把品牌名发我，我马上补上。`;
}

function buildConversationGuard({ userText, previousExtracted, plan, history, inputMode, controller }) {
  const text = String(userText || '');
  if (PRESENCE_QUERY_RE.test(text)) {
    return {
      source: 'presence_guard',
      reply: controller === 'waiting_human'
        ? '在的，人工顾问正在接手，但我不会让您在这里空等。您继续发问就行，我会先回答并把信息同步给顾问。'
        : '在的，您直接说就行，我会接着前面的内容继续聊。',
    };
  }
  if (VOICE_CAPABILITY_QUERY_RE.test(text)) {
    return {
      source: 'voice_capability_guard',
      reply: inputMode === 'voice'
        ? '听到了，您的语音已经识别成功，我也可以用语音消息回复。我们现在可以直接用语音继续聊；目前支持的是语音消息，不是实时电话通话。'
        : '可以，您直接发送语音消息就行，我能识别内容并用语音消息回复；目前支持的是语音消息，不是实时电话通话。',
    };
  }
  if (MATERIAL_REQUEST_RE.test(text)) return { source: 'material_conversion_guard', reply: buildMaterialReply(plan.extracted), preserveOnHandoff: true };
  if (CONTACT_QUERY_RE.test(text)) return { source: 'contact_conversion_guard', reply: buildContactReply(plan.extracted), preserveOnHandoff: true };
  if (COMMITMENT_QUERY_RE.test(text)) {
    return {
      source: 'commitment_guard',
      preserveOnHandoff: true,
      reply: `能承诺的是过程和交付可验收，不是未经评估就承诺${plan.extracted?.pos_brand || 'POS'}一定接入或营业额一定上涨。我们会基于真实数据做接入评估，明确问题证据、整改动作和责任人，并在试跑后复盘验收；达不到约定的数据条件会提前说清楚。`,
    };
  }
  if (TRIAL_QUERY_RE.test(text)) return { source: 'trial_conversion_guard', reply: buildTrialReply(plan.extracted), preserveOnHandoff: true };
  if (PROFILE_MEMORY_QUERY_RE.test(text)) return { source: 'profile_memory_guard', reply: buildProfileMemoryReply(plan.extracted), preserveOnHandoff: true };
  if (plan.uncertain_slot || (isUncertainAnswer(text) && inferRecentQuestionSlot(history)) || CORRECTION_RE.test(text)) {
    const reply = buildUncertaintyReply({ userText: text, plan, history });
    if (reply) return { source: 'uncertainty_guard', reply };
  }
  const profileReply = buildProfileFactReply({ userText: text, previousExtracted, plan, history });
  if (profileReply) return { source: 'profile_fact_guard', reply: profileReply };
  return null;
}

function removeRepeatedQuestion(reply, history) {
  const slot = inferQuestionSlotFromText(reply);
  if (!slot) return reply;
  const lastOutbound = [...(history || [])].reverse().find((m) => m.direction === 'outbound');
  if (!lastOutbound || inferQuestionSlotFromText(lastOutbound.content) !== slot) return reply;
  const sentences = String(reply).match(/[^。！？!?]+[。！？!?]?/g) || [String(reply)];
  const kept = sentences.filter((sentence) => !(inferQuestionSlotFromText(sentence) === slot && /[？?]/.test(sentence)));
  const cleaned = kept.join('').trim();
  return cleaned || '这个信息可以稍后再确认，我先不重复追问。';
}

const IDENTITY_INTRO_RE = /(?:我叫|我是)(?:李娟娟|Catherine|凯瑟琳)/i;
const CONTACT_REQUEST_RE = /(?:留|发|提供|给).{0,8}(?:手机号|联系方式)|方便.{0,8}(?:手机号|联系方式)/;
const CONTACT_ALLOWED_RE = /资料|demo|演示|报价|价格|顾问.{0,5}联系|联系我/i;
const POS_OVERCLAIM_RE = /(?:POS|客如云|美团|企迈|天财|二维火|收钱吧|哗啦啦|博云|银豹|美味不用等).{0,18}(?:我们支持|直接接入|可以接入|能接入|能对接)/i;

/** 发送前用可解释的确定性规则拦截致命话术问题。 */
export function evaluateCustomerReply({ reply, userText, history = [], plan = {} }) {
  const value = String(reply || '').trim();
  const customer = String(userText || '');
  const issues = [];
  if (!value) issues.push('empty_reply');
  if (/^(?:嗯+|呃+|啊+)[，,。！!\s]*/.test(value) || /^我理解您的困惑/.test(value)) issues.push('mechanical_opening');
  if (OBSOLETE_VOICE_DENIAL_RE.test(value)) issues.push('stale_voice_denial');
  if (IDENTITY_INTRO_RE.test(value) && !/你是谁|您是谁|叫什么|怎么称呼/.test(customer)) issues.push('unsolicited_identity');
  if (CONTACT_REQUEST_RE.test(value) && !CONTACT_ALLOWED_RE.test(customer) && !plan?.extracted?.contact_phone && !plan?.extracted?.phone) {
    issues.push('premature_contact_request');
  }
  if (POS_OVERCLAIM_RE.test(value) && !/评估|确认后|具体要看/.test(value)) issues.push('pos_overclaim');
  if (/官方电话|客服电话|拨打我们.{0,6}电话/.test(value)) issues.push('invented_contact_channel');
  if (/啥|咱们|整一个|不少问题呢/.test(value)) issues.push('overcasual_language');
  if ((value.match(/[？?]/g) || []).length > 1) issues.push('multiple_questions');

  const replySlot = inferQuestionSlotFromText(value);
  const lastOutbound = [...historyBeforeCurrent(history, customer)].reverse().find((m) => m.direction === 'outbound');
  if (replySlot && lastOutbound && inferQuestionSlotFromText(lastOutbound.content) === replySlot && /[？?]/.test(value)) {
    issues.push('repeated_question');
  }
  if (CORRECTION_RE.test(customer) && !/理解错|没有听准|没听准|抱歉|对不起/.test(value)) issues.push('correction_not_acknowledged');
  if (isUncertainAnswer(customer) && replySlot && /[？?]/.test(value)) issues.push('uncertainty_reasked');
  return [...new Set(issues)];
}

async function generateWithLlm(plan, userText, history, knowledgeItems, intentScore = 0, repair = null) {
  if (typeof _callLLM !== 'function') return null;
  const items = Array.isArray(knowledgeItems) && knowledgeItems.length ? knowledgeItems : PUBLIC_KNOWLEDGE;
  const knowledgeBlurb = items.map((k) => `- ${k.title}：${k.body}`).join('\n');
  const diagnosisBlurb = plan.mode === 'diagnosis_complete' && plan.diagnosis
    ? `\n【本轮必须先给出经营诊断结论，再引导下一步】
核心问题=${plan.diagnosis.surface_problem}
背后原因=${(plan.diagnosis.root_causes || []).slice(0, 2).join('；')}
建议优先解决=${(plan.diagnosis.recommended_modules || []).slice(0, 3).join('、')}
${plan.caseBlurb ? `可引用的同类客户案例=${plan.caseBlurb}\n` : ''}诊断后的转化动作（必须作为结尾）=${diagnosisCta(intentScore)}
`
    : '';
  const system = `${SALES_PERSONA.system_role}

【可引用的公开知识】
${knowledgeBlurb}
${diagnosisBlurb}
【最高优先级规则】无论"对话历史"里出现过什么内容、客户之前问过多少次相似的问题，本轮
回复必须是对"客户本轮说"这一句话的直接回应——历史只用来理解背景，不能照抄或延续历史里
最近出现的话术模式。如果本轮客户说的内容和历史明显不是一回事(比如历史在聊语音通话、
本轮客户其实在回答店数/城市这类问题)，必须切换到回应本轮内容，不能停留在历史话题上。
当前能力事实=已经支持微信语音消息的识别和语音回复，但不是实时电话通话。历史中“只能文字”的说法已过时，严禁再说。
只有客户主动问“你是谁/叫什么”时才介绍姓名，其他对话严禁突然自我介绍。
如果客户说“不确定/不知道/不清楚”，必须告诉他具体怎么确认，或先记为待确认；严禁把原问题再问一遍。
如果客户说“你没听懂/你理解错了”，先明确承认刚才理解错误，再用一句话复述正确理解，本轮不问新问题。
禁止以“嗯”开头，禁止说“我理解您的困惑”后立即重复原问题。

【本轮策略（必须遵守）】
模式=${plan.mode}
下一问=${plan.next_question?.question ? `本轮直接回应完成后，只有这个问题没问过、且客户没有表示不确定时才可以问：${plan.next_question.question}` : '（可不问）'}
是否转人工=${plan.takeover.takeover ? '是' : '否'}
价格规则=绝对禁止提及任何具体价格数字/折扣比例（包括金额、折扣、报价范围）。客户问价格一律引导"由顾问为您详细说明"，不得自行报价。
联系方式规则=${plan.extracted?.phone ? '客户已经留过手机号，严禁再问。' : '不要因为聊到痛点就立即索要手机号。只有客户主动要资料、Demo、报价或明确要顾问联系时，才可以问联系方式。'}
已确认信息=${JSON.stringify(plan.extracted || {})}
待确认信息=${JSON.stringify(plan.extracted?.uncertain_slots || [])}
`;

  const repairInstruction = repair?.previousReply
    ? `\n上一版候选回复未通过发送前质量检查：${repair.issues.join('、')}。\n上一版：${repair.previousReply}\n请重写：保留有用信息，修正上述问题，只回复一个自然简洁的顾问话轮。\n`
    : '';
  const user = `对话历史(仅供理解背景，不要照抄延续)：
${historyToPrompt(history, userText) || '（新会话）'}

客户本轮说：${userText}
${repairInstruction}

请只针对"客户本轮说"这句话给出顾问的下一句回复，不要重复历史里已经说过的话。只输出对客户说的话，不要输出分析。`;

  const r = await _callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    {
      purpose: 'sales_customer_ai',
      model: process.env.SALES_CUSTOMER_AI_MODEL || 'qwen-plus-character',
      temperature: 0.2,
      max_tokens: 240,
      skipCache: true,
    }
  ).catch(() => null);
  if (!r?.ok || !r.content) return null;
  return String(r.content).trim();
}

export async function runCustomerAiTurn({ userText, extracted, history, intentScore, controller, guidance = null, knowledgeItems = null, pool = null, inputMode = 'text' }) {
  const plan = buildStrategyPlan({ userText, extracted, history, intentScore, controller, knowledgeItems });
  if (controller === 'waiting_human') {
    plan.mode = 'waiting_human_bridge';
    plan.next_question = null;
  }
  if (guidance?.question_slot) {
    const forced = (plan.next_question?.key === guidance.question_slot) || guidance.question_slot;
    if (typeof forced === 'object') plan.next_question = forced;
    else plan.guidance_question_slot = forced;
  }

  if (plan.mode === 'diagnosis_complete' && pool) {
    const cases = await recommendCasesForLead(pool, { extracted: plan.extracted }).catch(() => []);
    plan.caseBlurb = cases?.[0]?._score > 0 ? formatCaseBlurb(cases[0]) : '';
  }

  const guarded = buildConversationGuard({ userText, previousExtracted: extracted || {}, plan, history, inputMode, controller });
  let reply = guarded?.reply || await generateWithLlm(plan, userText, history, knowledgeItems, intentScore);
  let source = guarded?.source || 'llm';
  if (!reply) {
    reply = templateReply(plan, userText, intentScore);
    source = 'template';
  }
  reply = sanitizeReply(reply);

  if (plan.mode === 'handoff' && !guarded?.preserveOnHandoff) {
    reply = sanitizeReply(templateReply(plan, userText, intentScore));
    source = 'handoff_template';
  } else if (containsPriceMention(reply)) {
    // 第二道防线：策略机没有判定为转人工场景，但LLM回复里仍然出现了具体价格数字/折扣，
    // 强制改为转人工模板，并把 takeover 标记为真，确保下游(sales-session.js)真正执行
    // 人工接管，而不只是话术上"听起来像转人工"。
    plan.mode = 'handoff';
    plan.takeover = { ...plan.takeover, takeover: true, reason: 'price_leak_guard' };
    reply = sanitizeReply(templateReply(plan, userText, intentScore));
    source = 'handoff_template_price_guard';
  }

  if (!guarded && plan.next_question?.question && plan.mode !== 'handoff' && !/[？?]/.test(reply)) {
    reply = sanitizeReply(`${reply} ${plan.next_question.question}`);
  }
  if (!guarded) {
    const deduped = removeRepeatedQuestion(reply, historyBeforeCurrent(history, userText));
    if (deduped !== reply) source = `${source}_repeat_guard`;
    reply = sanitizeReply(deduped);
  }

  if (!guarded && source.startsWith('llm')) {
    const issues = evaluateCustomerReply({ reply, userText, history, plan });
    if (issues.length) {
      let rewritten = await generateWithLlm(plan, userText, history, knowledgeItems, intentScore, {
        previousReply: reply,
        issues,
      });
      rewritten = sanitizeReply(rewritten || '');
      if (rewritten && plan.next_question?.question && plan.mode !== 'handoff' && !/[？?]/.test(rewritten)) {
        rewritten = sanitizeReply(`${rewritten} ${plan.next_question.question}`);
      }
      rewritten = sanitizeReply(removeRepeatedQuestion(rewritten, historyBeforeCurrent(history, userText)));
      const rewriteIssues = evaluateCustomerReply({ reply: rewritten, userText, history, plan });
      if (rewritten && !containsPriceMention(rewritten) && !rewriteIssues.length) {
        reply = rewritten;
        source = 'llm_quality_rewrite';
      } else {
        reply = sanitizeReply(removeRepeatedQuestion(templateReply(plan, userText, intentScore), historyBeforeCurrent(history, userText)));
        source = 'quality_fallback';
      }
    }
  }

  return { ok: true, reply, source, plan, guidance };
}
