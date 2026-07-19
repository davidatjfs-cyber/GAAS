import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_KNOWLEDGE,
  buildProductBenchmark,
  classifyProductQuery,
  formatProductAnswer,
  searchProductKnowledge,
} from './sales-product-knowledge.js';
import { runCustomerAiTurn, setSalesCustomerAiLlm } from './sales-customer-ai.js';

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
  setSalesCustomerAiLlm(null);
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
