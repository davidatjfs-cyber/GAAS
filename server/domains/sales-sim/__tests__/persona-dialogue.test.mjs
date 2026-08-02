import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerReply, maybePolishCustomerReply } from '../customer-reply.js';
import { BUILTIN_PERSONAS } from '../personas.js';

const persona = (key) => BUILTIN_PERSONAS.find((p) => p.persona_key === key);

/** 模拟 submitTurn 的逐轮调用（含真实会话的学员发言序列） */
function runSession({ track, personaObj, texts, strengths = () => [], state, opening }) {
  let priorT = [];
  let priorC = opening ? [opening] : [];
  const replies = [];
  for (let i = 0; i < texts.length; i += 1) {
    const r = buildCustomerReply({
      track,
      persona: personaObj,
      evalResult: { coachTags: [], triggers: [], strengths: strengths(i) },
      session: state,
      turnNo: i + 1,
      traineeText: texts[i],
      priorTraineeTexts: priorT,
      priorCustomerTexts: priorC,
    });
    replies.push(r);
    priorT.push(texts[i]);
    priorC.push(r);
  }
  return replies;
}

test('回归：客服短信场景（生产会话13）不再复读「什么时候解决」', () => {
  const texts = [
    '非常抱歉，让我们工程师马上紧急查询，我马上给您答复',
    '如果速度快的话，15 分钟可以找到准确问题',
    '我想先找到问题再给您准确答复',
    '已经确认是今天早上服务器系统冲突，工程师说现在已经恢复了',
    '短信的问题已经解决了',
    '因为咱们会员数量比较多，信息到了运营商这里卡死了，属于系统故障',
    '我们会实时监控后台直到您短信全部发出去',
  ];
  const replies = runSession({
    track: 'cs',
    personaObj: persona('cs_sms_fail'),
    texts,
    strengths: (i) => (i === 0 ? [{ principle_id: 'soothe_first' }] : []),
    state: { emotion: 38, trust: 37, close_readiness: 0, satisfaction: 60 },
    opening: '今天营销短信怎么没发？会员都在问我，你们系统什么情况？',
  });

  assert.equal(new Set(replies).size, replies.length, '每轮回复不应重复');
  // 给出时间后不再追问「什么时候解决」这类旧循环句
  assert.ok(
    !replies.slice(0, 2).some((r) => /什么时候能解决|给个准话|给个准信/.test(r)),
    `旧循环句仍出现: ${replies.slice(0, 2).join(' / ')}`
  );
  // 意图按 时限 → 原因 → 验证/闭环 推进
  assert.match(replies[0], /查|原因/);
  assert.match(replies[1], /原因|卡/);
  assert.match(replies[3], /发出|恢复|正常/);
  assert.match(replies[4], /确认|收到|补发/);
  assert.match(replies[6], /说一声|谢谢|等你/);
});

test('同一意图最多追问两轮，之后必须升级或收束', () => {
  const replies = runSession({
    track: 'cs',
    personaObj: persona('cs_sms_fail'),
    texts: ['我们在处理，请稍等。', '我们在处理，请稍等。', '我们在处理，请稍等。'],
    state: { emotion: 38, trust: 37, close_readiness: 0, satisfaction: 60 },
  });
  assert.equal(new Set(replies).size, replies.length, '弱回应也不应原句复读');
  assert.match(replies[2], /失望|行不行|解决|说法/, '连续追问后应升级表达');
});

test('销售：异议被回应后客户承认并推进，不再复读「发资料」', () => {
  const p = persona('busy_owner');
  let priorT = [];
  let priorC = [p.opening_line];
  const t1 = buildCustomerReply({
    track: 'sales',
    persona: p,
    evalResult: { coachTags: [], triggers: ['no_time'], strengths: [] },
    session: { emotion: 40, close_readiness: 10 },
    turnNo: 1,
    traineeText: '我理解您忙，正因为忙才值得看看——您每天盯数据的时间能省下来，给我一分钟就够。',
    priorTraineeTexts: priorT,
    priorCustomerTexts: priorC,
  });
  assert.match(t1, /省时间|听你说|值得/);
  priorT.push('我理解您忙，正因为忙才值得看看——您每天盯数据的时间能省下来，给我一分钟就够。');
  priorC.push(t1);

  const t2 = buildCustomerReply({
    track: 'sales',
    persona: p,
    evalResult: { coachTags: [], triggers: ['no_time'], strengths: [] },
    session: { emotion: 40, close_readiness: 10 },
    turnNo: 2,
    traineeText: '我们现在帮门店每周省 2 小时盯数据的时间，自动生成日报。',
    priorTraineeTexts: priorT,
    priorCustomerTexts: priorC,
  });
  assert.match(t2, /方案|下一步|考虑/);
  assert.ok(!/发资料|没时间听/.test(t2), '异议回应后不应再复读「没时间/发资料」');
});

test('销售：弱回应不无限循环默认句', () => {
  const p = persona('busy_owner');
  let priorT = [];
  let priorC = [p.opening_line];
  const replies = [];
  for (let i = 0; i < 4; i += 1) {
    const r = buildCustomerReply({
      track: 'sales',
      persona: p,
      evalResult: { coachTags: [], triggers: ['no_time'], strengths: [] },
      session: { emotion: 40, close_readiness: 10 },
      turnNo: i + 1,
      traineeText: '好的，我知道了。',
      priorTraineeTexts: priorT,
      priorCustomerTexts: priorC,
    });
    replies.push(r);
    priorT.push('好的，我知道了。');
    priorC.push(r);
  }
  assert.equal(new Set(replies).size, replies.length, '不应出现相同回复');
  assert.ok(
    !/没时间|发资料/.test(replies[2] + replies[3]),
    `追问耗尽后仍在复读: ${replies.slice(2).join(' / ')}`
  );
});

test('客服：未单独编剧的投诉人格走默认推进队列', () => {
  const r = buildCustomerReply({
    track: 'cs',
    persona: { persona_key: 'tenant_custom', title: 'x', profile: {} },
    evalResult: { coachTags: [], triggers: ['complaint'], strengths: [] },
    session: { emotion: 38, trust: 37, close_readiness: 0, satisfaction: 60 },
    turnNo: 1,
    traineeText: '非常抱歉，我马上帮您查，10 分钟内给您答复。',
    priorTraineeTexts: [],
    priorCustomerTexts: ['今天系统又崩了，我要投诉！'],
  });
  assert.match(r, /答复|等你/);
});

test('回归：客服生气人格不再带出场景外细节「重启」', () => {
  const p = persona('cs_angry_bug');
  const opening = '这个后台也太难用了吧，点半天找不到活动，我真的受够了！';
  let priorT = [];
  let priorC = [opening];
  const texts = [
    '您能具体给我介绍一下哪个功能吗',
    '可以的，具体跟我说说哪些功能让您这么生气',
  ];
  const replies = [];
  for (let i = 0; i < texts.length; i += 1) {
    const r = buildCustomerReply({
      track: 'cs',
      persona: p,
      evalResult: { coachTags: [], triggers: [], strengths: [] },
      session: { emotion: 35, trust: 33, close_readiness: 0, satisfaction: 52 },
      turnNo: i + 1,
      traineeText: texts[i],
      priorTraineeTexts: priorT,
      priorCustomerTexts: priorC,
    });
    replies.push(r);
    priorT.push(texts[i]);
    priorC.push(r);
  }
  assert.ok(!/重启/.test(replies.join(' / ')), '不应出现场景外「重启」细节');
});

test('回归：学员说「明白的，确实有问题」→ 客户承认并推进（不再加压）', () => {
  const p = persona('cs_angry_bug');
  const r = buildCustomerReply({
    track: 'cs',
    persona: p,
    evalResult: { coachTags: [], triggers: [], strengths: [] },
    session: { emotion: 24, trust: 29, close_readiness: 0, satisfaction: 44 },
    turnNo: 3,
    traineeText: '明白的，确实有问题，但我判断不是大问题，应该很快可以解决',
    priorTraineeTexts: ['您能具体给我介绍一下哪个功能吗', '可以的，具体跟我说说哪些功能让您这么生气'],
    priorCustomerTexts: [
      '我点半天都找不到活动，你们自己用过这个后台吗？我真的很生气。',
      '你倒是说说到底怎么回事，别总让我等。',
    ],
  });
  assert.match(r, /谢谢理解|受够|打算怎么处理|怎么改/);
  assert.ok(!/你们到底行不行|很失望|曝光/.test(r), '承认后不应再升级加压');
});

test('润色：服务方口吻输出被拦截并回退规则句', async () => {
  const out = await maybePolishCustomerReply(async () => ({
    ok: true,
    content: '好的，我会尽快跟进这个问题，一有进展马上告诉您。您看还有其他需要我帮忙的地方吗？',
  }), {
    persona: { title: '客户' },
    ruleReply: '谢谢理解。反正我是真的受够了，你们打算怎么处理？',
    history: [],
  });
  assert.equal(out, '谢谢理解。反正我是真的受够了，你们打算怎么处理？');
});

test('润色：提示词锁定顾客视角、带情绪状态并过滤教练行', async () => {
  let msg = '';
  await maybePolishCustomerReply(async (messages) => {
    msg = messages[0].content;
    return { ok: true, content: 'x' };
  }, {
    persona: { title: '客户' },
    ruleReply: 'r',
    history: [
      { role: 'customer', content: 'a' },
      { role: 'trainee', content: 'b' },
      { role: 'coach', content: 'c' },
    ],
    state: { emotion: 30, trust: 33, satisfaction: 54 },
  });
  assert.ok(/顾客/.test(msg), '应锁定顾客视角');
  assert.ok(/30\/100/.test(msg), '应带情绪状态');
  assert.ok(!/coach:/.test(msg), '教练行应被过滤');
  assert.ok(/学员/.test(msg), 'trainee 应翻译为学员');
});
