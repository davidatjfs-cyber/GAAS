import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSlotsFromText, nextDiagnosticQuestion, sanitizeReply } from './sales-strategy.js';
import { runCustomerAiTurn, setSalesCustomerAiLlm } from './sales-customer-ai.js';
import { buildWaitingHumanBridgeReply } from './sales-session.js';
import { listMessages } from './sales-store.js';

const phoneQuestionHistory = [
  { direction: 'inbound', content: '二维火' },
  { direction: 'outbound', content: 'POS订单里目前能记录客户手机号吗？' },
];

test('对话历史必须取最近N条再按时间正序返回，不能取最旧N条', async () => {
  let queryText = '';
  const pool = {
    async query(sql) {
      queryText = String(sql);
      return { rows: [] };
    },
  };
  await listMessages(pool, 7, 30);
  assert.match(queryText, /ORDER BY id DESC LIMIT \$2/);
  assert.match(queryText, /recent_messages\s+ORDER BY id ASC/);
});

test('“不确定有没有手机号”必须保存为待确认，不能误判为没有手机号', () => {
  const slots = extractSlotsFromText(
    '你听不懂啊，我不确定有没有手机号',
    { pos_brand: '二维火', phone_data_ready: false, pain_point: '营业额下降' }
  );
  assert.equal(slots.phone_data_ready, null);
  assert.ok(slots.uncertain_slots.includes('phone_data_ready'));
  assert.equal(slots.pain_point, '营业额下降');
});

test('客户问“怎么确定”时必须给方法，不得再重复原问题', async () => {
  setSalesCustomerAiLlm(async () => ({
    ok: true,
    content: '嗯，我理解您的困惑。您提到营业额下降，POS订单里目前能记录客户手机号吗？',
  }));
  const turn = await runCustomerAiTurn({
    userText: '我不确定，应该怎么样确定',
    extracted: { pos_brand: '二维火', pain_point: '营业额下降' },
    history: phoneQuestionHistory,
    intentScore: 20,
    controller: 'ai',
    inputMode: 'text',
  });
  assert.equal(turn.source, 'uncertainty_guard');
  assert.match(turn.reply, /会员订单|会员档案/);
  assert.match(turn.reply, /手机号.?字段/);
  assert.match(turn.reply, /待确认/);
  assert.doesNotMatch(turn.reply, /能记录客户手机号吗/);
  assert.doesNotMatch(turn.reply, /^嗯/);
  setSalesCustomerAiLlm(null);
});

test('待确认的手机号数据必须跳过手机号数量追问', () => {
  const next = nextDiagnosticQuestion({
    store_count: 10,
    city: '北京、上海',
    cuisine: '西餐',
    pos_brand: '二维火',
    phone_data_ready: null,
    uncertain_slots: ['phone_data_ready'],
    pain_point: '营业额下降',
    contact_phone: '18300000000',
  });
  assert.equal(next.key, 'other_system_used');
});

test('对经营原因不得使用“精准找出”这类过度承诺', () => {
  assert.equal(sanitizeReply('能精准找出原因，再给您建议。'), '能辅助定位原因，再给您建议。');
});

test('同一诊断问题已经问过时，闸门必须删掉LLM的重复追问', async () => {
  setSalesCustomerAiLlm(async () => ({ ok: true, content: '没问题，我们先聊您关心的。POS订单里目前能记录客户手机号吗？' }));
  const turn = await runCustomerAiTurn({
    userText: '这个先不说，先聊别的',
    extracted: { pos_brand: '二维火', pain_point: '营业额下降' },
    history: phoneQuestionHistory,
    intentScore: 20,
    controller: 'ai',
    inputMode: 'text',
  });
  assert.match(turn.source, /repeat_guard/);
  assert.doesNotMatch(turn.reply, /能记录客户手机号吗/);
  setSalesCustomerAiLlm(null);
});

test('客户同时说北京和上海时必须保留两个城市', () => {
  const slots = extractSlotsFromText('北京上海', {});
  assert.deepEqual(slots.cities, ['北京', '上海']);
  assert.equal(slots.city, '北京、上海');
});

test('客户明确纠正后必须承认理解错误，不得跳到追问手机号数量', async () => {
  const turn = await runCustomerAiTurn({
    userText: '你听不懂啊，我不确定有没有手机号',
    extracted: { pos_brand: '二维火', phone_data_ready: false, pain_point: '营业额下降' },
    history: [
      ...phoneQuestionHistory,
      { direction: 'inbound', content: '我不确定，应该怎么样确定' },
      { direction: 'outbound', content: '我们先来确认一下，二维火POS订单里能记录客户手机号吗？' },
    ],
    intentScore: 20,
    controller: 'ai',
    inputMode: 'text',
  });
  assert.match(turn.reply, /我刚才理解错了|是我刚才没有听准/);
  assert.match(turn.reply, /不是“没有手机号”/);
  assert.doesNotMatch(turn.reply, /大概有多少|积累的会员/);
  assert.equal(turn.plan.extracted.phone_data_ready, null);
});

test('真实语音输入必须回答已听到，不得再说只能文字', async () => {
  setSalesCustomerAiLlm(async () => ({ ok: true, content: '我这边还是只能通过文字交流，没法进行语音通话。' }));
  const turn = await runCustomerAiTurn({
    userText: '你现在能听到我说话吗？',
    extracted: {},
    history: [],
    intentScore: 0,
    controller: 'ai',
    inputMode: 'voice',
  });
  assert.equal(turn.source, 'voice_capability_guard');
  assert.match(turn.reply, /听到|识别成功/);
  assert.match(turn.reply, /语音消息/);
  assert.doesNotMatch(turn.reply, /只能.*文字|没法.*语音/);
  setSalesCustomerAiLlm(null);
});

test('POS品牌不得擅自承诺支持，回复也不得机械以“嗯”开头', async () => {
  setSalesCustomerAiLlm(async () => ({ ok: true, content: '嗯，二维火的系统我们是支持的。POS订单里能记录客户手机号吗？' }));
  const turn = await runCustomerAiTurn({
    userText: '二维火',
    extracted: { store_count: 10, city: '北京', cuisine: '西餐', pain_point: '营业额下降' },
    history: [],
    intentScore: 20,
    controller: 'ai',
    inputMode: 'text',
  });
  assert.equal(turn.source, 'profile_fact_guard');
  assert.doesNotMatch(turn.reply, /^嗯/);
  assert.doesNotMatch(turn.reply, /二维火.*我们是支持的/);
  assert.match(turn.reply, /评估/);
  setSalesCustomerAiLlm(null);
});

test('客户只是提供画像事实时，不得突然自我介绍或过早索要手机号', async () => {
  setSalesCustomerAiLlm(async () => ({ ok: true, content: '我叫李娟娟Catherine。方便留个手机号吗？' }));
  const turn = await runCustomerAiTurn({
    userText: '我们10家西餐店，在北京上海，主要是营业额下降',
    extracted: {},
    history: [],
    intentScore: 0,
    controller: 'ai',
    inputMode: 'text',
  });
  assert.equal(turn.source, 'profile_fact_guard');
  assert.match(turn.reply, /10家门店/);
  assert.match(turn.reply, /北京、上海/);
  assert.match(turn.reply, /营业额下降/);
  assert.doesNotMatch(turn.reply, /我叫|手机号/);
  assert.match(turn.reply, /POS/);
  setSalesCustomerAiLlm(null);
});

test('自由生成的高风险话术必须自动重写后才能发送', async () => {
  let calls = 0;
  setSalesCustomerAiLlm(async () => {
    calls += 1;
    return calls === 1
      ? { ok: true, content: '我叫李娟娟Catherine，方便留个手机号吗？' }
      : { ok: true, content: '我们主要帮连锁餐厅把经营数据、门店执行和客户复购串起来，先从您最关心的问题入手。您现在有几家门店？' };
  });
  const turn = await runCustomerAiTurn({
    userText: '你们主要能解决什么问题？',
    extracted: {},
    history: [],
    intentScore: 0,
    controller: 'ai',
    inputMode: 'text',
  });
  assert.equal(calls, 2);
  assert.equal(turn.source, 'llm_quality_rewrite');
  assert.doesNotMatch(turn.reply, /我叫|手机号/);
  assert.match(turn.reply, /经营数据|门店执行|客户复购/);
  setSalesCustomerAiLlm(null);
});

test('重写仍不合格时必须退回安全模板，不得发出坏回复', async () => {
  let calls = 0;
  setSalesCustomerAiLlm(async () => {
    calls += 1;
    return { ok: true, content: '我叫李娟娟Catherine，方便留个手机号吗？' };
  });
  const turn = await runCustomerAiTurn({
    userText: '你们团队一般怎么帮助餐厅？',
    extracted: {},
    history: [],
    intentScore: 0,
    controller: 'ai',
    inputMode: 'text',
  });
  assert.equal(calls, 2);
  assert.equal(turn.source, 'quality_fallback');
  assert.doesNotMatch(turn.reply, /我叫|手机号/);
  setSalesCustomerAiLlm(null);
});

const conversionProfile = {
  store_count: 10,
  city: '北京、上海',
  cuisine: '西餐',
  pos_brand: '二维火',
  pain_point: '缺少经营数据',
  contact_phone: '18321341205',
  phone: '18321341205',
  phone_data_ready: null,
  uncertain_slots: ['phone_data_ready'],
};

test('客户要产品资料时必须当场给可阅读的文字版，不能空口说稍后发', async () => {
  const turn = await runCustomerAiTurn({
    userText: '能发一下你们的产品介绍给我吗？',
    extracted: conversionProfile,
    history: [],
    intentScore: 50,
    controller: 'ai',
    inputMode: 'voice',
  });
  assert.equal(turn.source, 'material_conversion_guard');
  assert.match(turn.reply, /10家|十家/);
  assert.match(turn.reply, /北京、上海/);
  assert.match(turn.reply, /二维火/);
  assert.match(turn.reply, /30天|三十天/);
  assert.doesNotMatch(turn.reply, /稍后.*发|手机号吗/);
});

test('客户问怎么联系时必须使用已有渠道和已留号码，不得虚构官方电话', async () => {
  const turn = await runCustomerAiTurn({
    userText: '怎么联系你们？',
    extracted: conversionProfile,
    history: [],
    intentScore: 50,
    controller: 'ai',
    inputMode: 'voice',
  });
  assert.equal(turn.source, 'contact_conversion_guard');
  assert.match(turn.reply, /当前微信/);
  assert.match(turn.reply, /尾号1205/);
  assert.doesNotMatch(turn.reply, /官方电话|客服电话|其他会员/);
});

test('客户问承诺时必须说可验收边界，不得承诺POS必然接入或效果', async () => {
  const turn = await runCustomerAiTurn({
    userText: '你们能给我一些什么承诺呢？',
    extracted: conversionProfile,
    history: [],
    intentScore: 50,
    controller: 'ai',
    inputMode: 'voice',
  });
  assert.equal(turn.source, 'commitment_guard');
  assert.match(turn.reply, /真实数据/);
  assert.match(turn.reply, /评估/);
  assert.match(turn.reply, /验收|复盘/);
  assert.doesNotMatch(turn.reply, /准确连接|保证效果|一定涨/);
});

test('客户问试用时要说清30天试跑条件和下一步，不能只发通用转人工模板', async () => {
  const turn = await runCustomerAiTurn({
    userText: '那有试用期吗？比如试用一个月。',
    extracted: conversionProfile,
    history: [],
    intentScore: 50,
    controller: 'ai',
    inputMode: 'voice',
  });
  assert.equal(turn.source, 'trial_conversion_guard');
  assert.match(turn.reply, /30天|三十天/);
  assert.match(turn.reply, /1[～~-]2家|一到两家/);
  assert.match(turn.reply, /数据.*评估|评估.*数据/);
  assert.doesNotMatch(turn.reply, /已经比较适合安排顾问/);
});

test('客户问是否记得公司时，未记录就必须诚实说明并复述已知信息', async () => {
  const turn = await runCustomerAiTurn({
    userText: '你还记得我是哪家公司吗？',
    extracted: conversionProfile,
    history: [],
    intentScore: 50,
    controller: 'waiting_human',
    inputMode: 'voice',
  });
  assert.equal(turn.source, 'profile_memory_guard');
  assert.match(turn.reply, /还没有记录到.*公司|公司.*还没有记录/);
  assert.match(turn.reply, /10家|十家/);
  assert.match(turn.reply, /北京、上海/);
});

test('等待人工期间AI必须继续回应客户，不能进入静默黑洞', () => {
  const reply = buildWaitingHumanBridgeReply({
    content: '你还在吗？',
    lead: { ...conversionProfile, extracted: conversionProfile },
  });
  assert.match(reply, /在的/);
  assert.match(reply, /顾问.*接手|人工顾问/);
  assert.doesNotMatch(reply, /稍后再联系/);
});

test('客户连续追问在吗时回复必须自然递进，不能机械复制同一句', async () => {
  const first = await runCustomerAiTurn({
    userText: '你还在吗？', extracted: conversionProfile, history: [], intentScore: 90, controller: 'waiting_human',
  });
  const second = await runCustomerAiTurn({
    userText: '在吗', extracted: conversionProfile,
    history: [{ direction: 'inbound', sender: 'customer', content: '你还在吗？' }, { direction: 'outbound', sender: 'ai', content: first.reply }],
    intentScore: 90, controller: 'waiting_human',
  });
  const third = await runCustomerAiTurn({
    userText: '还在吗？', extracted: conversionProfile,
    history: [
      { direction: 'inbound', sender: 'customer', content: '你还在吗？' },
      { direction: 'outbound', sender: 'ai', content: first.reply },
      { direction: 'inbound', sender: 'customer', content: '在吗' },
      { direction: 'outbound', sender: 'ai', content: second.reply },
    ],
    intentScore: 90, controller: 'waiting_human',
  });
  assert.equal(new Set([first.reply, second.reply, third.reply]).size, 3);
  assert.match(third.reply, /没有掉线|马上接着回答/);
});
