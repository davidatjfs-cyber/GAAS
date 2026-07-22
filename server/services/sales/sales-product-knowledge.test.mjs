import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_KNOWLEDGE,
  buildCustomerLanguageBenchmark,
  buildProductBenchmark,
  classifyProductQuery,
  formatProductAnswer,
  formatProductSpeechAnswer,
  searchProductKnowledge,
} from './sales-product-knowledge.js';
import { runCustomerAiTurn, setSalesCustomerAiLlm } from './sales-customer-ai.js';
import { voiceReplyForTurn } from './sales-kf.js';

test('系统知识覆盖主要功能模块且基准问题不少于300条', () => {
  assert.ok(PRODUCT_KNOWLEDGE.length >= 120);
  assert.ok(new Set(PRODUCT_KNOWLEDGE.map((item) => item.module)).size >= 18);
  assert.ok(buildProductBenchmark().length >= 1000);
});

test('系统问答检索基准 Top-1 准确率至少90%', () => {
  const benchmark = buildProductBenchmark();
  let correct = 0;
  const failures = [];
  for (const sample of benchmark) {
    const actual = searchProductKnowledge(sample.question, { limit: 1 })[0]?.id || null;
    if (actual === sample.expected) correct += 1;
    else failures.push({ ...sample, actual });
  }
  const accuracy = correct / benchmark.length;
  assert.ok(accuracy >= 0.9, `accuracy=${(accuracy * 100).toFixed(2)}% failures=${JSON.stringify(failures.slice(0, 12))}`);
});

test('聊天式系统问法 Top-1 准确率至少90%', () => {
  const benchmark = buildCustomerLanguageBenchmark();
  let correct = 0;
  const failures = [];
  for (const sample of benchmark) {
    const actual = classifyProductQuery(sample.question).matches[0]?.id || null;
    if (actual === sample.expected) correct += 1;
    else failures.push({ ...sample, actual });
  }
  const accuracy = correct / benchmark.length;
  assert.ok(benchmark.length >= 600, `benchmark=${benchmark.length}`);
  assert.ok(accuracy >= 0.9, `accuracy=${(accuracy * 100).toFixed(2)}% failures=${JSON.stringify(failures.slice(0, 12))}`);
});

test('真实口语问题能命中正确知识卡', () => {
  const cases = [
    ['日报填错了还能改吗', 'daily.edit'],
    ['为什么我同事有菜单我没有', 'account.permissions'],
    ['员工要离职应该直接删掉吗', 'employee.offboarding'],
    ['审批被退回来以后怎么重新交', 'approval.return'],
    ['我想让员工学习SOP怎么指派', 'training.topics'],
    ['POS是不是所有品牌都可以直接接', 'growth.pos'],
    ['后厨菜品的原料配比在哪看', 'kitchen.recipe'],
    ['预测出来的备货量一定准吗', 'forecast.inventory'],
    ['跨店经理怎么切到另一家门店', 'account.store-switch'],
    ['请款超过预算还能提交吗', 'approval.budget'],
  ];
  for (const [question, expected] of cases) {
    assert.equal(searchProductKnowledge(question, { limit: 1 })[0]?.id, expected, question);
  }
});

test('方案差别与合作流程同步进入客户AI、RAG和Ontology共用知识源', () => {
  const packageQuery = classifyProductQuery('公司的话有什么差别呢？');
  assert.equal(packageQuery.matches[0]?.id, 'account.packages');
  assert.match(packageQuery.matches[0].answer, /跨店汇总|分级权限/);
  const processQuery = classifyProductQuery('你们正式合作和试跑是什么流程？');
  assert.equal(processQuery.matches[0]?.id, 'account.cooperation-process');
  assert.match(processQuery.matches[0].answer, /数据接入评估|30天/);
});

test('刚才真实竞品语音问法必须命中竞品定位，文字和语音不能答成两个主题', async () => {
  const questions = [
    '那你们跟美团客户云这些有什么区别呢？',
    '那你觉得你们的系统跟威盟啊，跟那个友赞啊，这些公司有什么区别吗？',
  ];
  for (const question of questions) {
    const classified = classifyProductQuery(question);
    assert.equal(classified.matches[0]?.id, 'account.competitive-positioning', question);
    const turn = await runCustomerAiTurn({
      userText: question,
      extracted: { store_count: 3, pain_point: '多店管理' },
      history: [],
      intentScore: 23,
      controller: 'ai',
      inputMode: 'voice',
    });
    assert.equal(turn.source, 'product_knowledge');
    assert.equal(turn.productKnowledge?.matched, 'account.competitive-positioning');
    assert.match(turn.reply, /不会简单说|侧重点|30天/);
    assert.doesNotMatch(turn.reply, /权限说明|注意：/);
    assert.match(turn.speechReply, /不想简单说谁好谁坏|任务|30天/);
    assert.doesNotMatch(turn.speechReply, /基础、连锁与集团方案/);
  }
});

test('系统问题直接走产品知识，不调用销售话术模型也不继续诊断追问', async () => {
  let llmCalls = 0;
  setSalesCustomerAiLlm(async () => { llmCalls += 1; return { ok: true, content: '销售话术' }; });
  const turn = await runCustomerAiTurn({
    userText: '请问营业日报怎么提交？',
    extracted: {}, history: [], intentScore: 0, controller: 'ai', inputMode: 'text',
  });
  assert.equal(turn.source, 'product_knowledge');
  assert.equal(turn.plan.mode, 'product_query');
  assert.equal(turn.plan.next_question, null);
  assert.equal(llmCalls, 0);
  assert.match(turn.reply, /营业日报|保存草稿|提交/);
  assert.ok(turn.speechReply);
  assert.doesNotMatch(turn.speechReply, /操作路径|权限说明|1\./);
  setSalesCustomerAiLlm(null);
});

test('刚才三条真实语音问法必须命中，并生成顾问讲解稿而不是念手册', async () => {
  const cases = [
    ['你能给我介绍一下你的这个系统的功能？', 'account.overview'],
    ['那你给我介绍一下你们这个关于考勤打卡这块的功能，可以吗？', 'attendance.checkin'],
    ['你们有个培训认证，我觉得不错，你能跟我仔细介绍一下。', 'training.topics'],
  ];
  for (const [userText, expected] of cases) {
    const result = classifyProductQuery(userText);
    assert.equal(result.matches[0]?.id, expected, userText);
    const speech = formatProductSpeechAnswer(result.matches, userText);
    assert.match(speech, /可以|简单说|这块/);
    assert.doesNotMatch(speech, /操作路径|权限说明|注意：|\d+[.、]/);
    assert.ok(speech.length >= 70 && speech.length <= 220, `${userText}: ${speech.length}`);
  }
});

test('最新真实失败问法命中卖点和培训资料，并使用容易理解的顾问表达', async () => {
  const cases = [
    ['那你给我介绍一下你们系统最大的卖点是什么？', 'account.selling-points', /问题|闭环|改善/],
    ['我的问题是培训的资料怎么整理？', 'training.materials', /岗位|资料|培训/],
  ];
  for (const [userText, expected, valuePattern] of cases) {
    const classified = classifyProductQuery(userText);
    assert.equal(classified.matches[0]?.id, expected, userText);
    const answer = formatProductAnswer(classified.matches, userText);
    const speech = formatProductSpeechAnswer(classified.matches, userText);
    assert.match(answer, valuePattern);
    assert.match(speech, valuePattern);
    assert.doesNotMatch(speech, /操作路径|权限说明|注意：|\d+[.、]/);

    const turn = await runCustomerAiTurn({
      userText,
      extracted: {}, history: [], intentScore: 0, controller: 'waiting_human', inputMode: 'voice',
    });
    assert.equal(turn.source, 'product_knowledge');
    assert.equal(turn.productKnowledge.matched, expected);
    assert.equal(turn.speechReply, speech);
  }
});

test('缺少系统语境的泛化追问不会误命中产品知识', () => {
  const result = classifyProductQuery('你没有解决方案吗？');
  assert.equal(result.isProductQuery, false);
});

test('企微语音发送优先使用讲解稿，文字失败回退仍保留完整答案', () => {
  assert.equal(voiceReplyForTurn({ reply: '完整文字', speech_reply: '自然讲解' }), '自然讲解');
  assert.equal(voiceReplyForTurn({ reply: '完整文字' }), '完整文字');
});

test('命中答案包含可执行步骤和权限边界', () => {
  const matches = searchProductKnowledge('请款怎么操作', { limit: 3 });
  const answer = formatProductAnswer(matches);
  assert.match(answer, /操作路径/);
  assert.match(answer, /权限说明/);
  assert.doesNotMatch(answer, /密码|密钥|服务器/);
});

test('未收录的明确系统问题不编造答案', async () => {
  const turn = await runCustomerAiTurn({
    userText: '系统里的量子排班按钮怎么用？',
    extracted: {}, history: [], intentScore: 0, controller: 'ai', inputMode: 'text',
  });
  assert.equal(turn.source, 'product_knowledge_unanswered');
  assert.match(turn.reply, /没有找到足够准确|不想凭印象/);
});
