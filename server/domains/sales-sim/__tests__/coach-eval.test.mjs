import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTraineeUtterance } from '../principles.js';
import { shouldResolveSession } from '../customer-reply.js';
import { maybeRefineEvaluationWithLLM, applyRefinedEvaluation } from '../llm-eval.js';

function csEval(traineeText, customerText, turnNo = 1) {
  return evaluateTraineeUtterance({
    track: 'cs',
    traineeText,
    customerText,
    turnNo,
    priorTraineeCount: turnNo - 1,
  });
}

test('评估补漏：推诿/甩锅被判「先揽责不推诿」', () => {
  const ev = csEval(
    '这个问题不是由我们控制的，是运营商那里的问题，我们能做的就是再优化系统',
    '今天营销短信怎么没发？'
  );
  assert.ok(ev.violations.some((v) => v.principle_id === 'own_problem'));
  assert.ok(ev.coachTags.some((t) => t.code === 'blame_shift'));
});

test('评估补漏：过度承诺被判「承诺有边界」', () => {
  const ev = csEval('您放心，保证一定没问题，100%能修复', '短信怎么没发？');
  assert.ok(ev.violations.some((v) => v.principle_id === 'no_overpromise'));
  assert.ok(ev.coachTags.some((t) => t.code === 'overpromise'));
});

test('评估补漏：否定式承诺（不保证百分百）不误判过度承诺', () => {
  const ev = csEval('诊断以实际数据为准，不保证百分百准确，作为经营参考', '诊断准不准？');
  assert.ok(!ev.violations.some((v) => v.principle_id === 'no_overpromise'));
  assert.ok(!ev.coachTags.some((t) => t.code === 'overpromise'));
});

test('误报修正：客户语气平静时不再判「先安抚再处理」', () => {
  const ev = csEval(
    '查到了，因为会员数量比较多，短信在运营商那里卡住了，我们已经重新启动，正在排队发送',
    '好，10分钟给答复这点还算可以。但关键是，到底是什么原因导致这次短信没发出去？'
  );
  assert.ok(!ev.violations.some((v) => v.principle_id === 'soothe_first'), '平静追问不应判缺安抚');
  assert.ok(!ev.coachTags.some((t) => t.code === 'no_soothe'));
  assert.ok(ev.coachTags.some((t) => t.code === 'next_hint'), '应有中性提示');
});

test('误报修正：行吧/可以出现在句中后也算平静语气', () => {
  const ev = csEval(
    '查到了，是会员数量多导致短信在运营商那里卡住了，我们已经重新启动，正在排队发送',
    '10分钟？行吧，那赶紧查，到底是系统出问题了还是其他什么原因。'
  );
  assert.ok(!ev.violations.some((v) => v.principle_id === 'soothe_first'));
});

test('三态教练：中性回合给下一步提示', () => {
  const ev = csEval('好的，没问题。', '好的，那先这样。');
  assert.ok(ev.coachTags.some((t) => t.code === 'next_hint'));
});

test('三态教练：优点回合给肯定旁白', () => {
  const ev = csEval('非常抱歉，我马上帮您处理，处理好跟您说明', '今天营销短信怎么没发？');
  assert.ok(ev.strengths.some((s) => s.principle_id === 'soothe_first'));
  assert.ok(ev.coachTags.some((t) => t.code === 'strength_note'));
});

test('LLM 复核：采用 LLM 判定、保留硬违规、可纠正软误判', async () => {
  const ruleEval = csEval('不是我们控制的', '短信怎么没发？');
  assert.ok(ruleEval.violations.some((v) => v.principle_id === 'soothe_first'));
  assert.ok(ruleEval.violations.some((v) => v.principle_id === 'own_problem'));

  const fakeLlm = async () => ({
    ok: true,
    content: JSON.stringify({
      violations: [],
      strengths: [{ principle_id: 'close_loop', detail: '给了闭环承诺' }],
      coach: '做得好，给客户明确闭环。',
    }),
  });
  const out = await maybeRefineEvaluationWithLLM(fakeLlm, {
    track: 'cs',
    traineeText: '不是我们控制的',
    customerText: '短信怎么没发？',
    evalResult: ruleEval,
    turnNo: 1,
  });
  assert.equal(out.ok, true);
  assert.ok(!out.violations.some((v) => v.principle_id === 'soothe_first'), 'LLM 可纠正平静语境误判');
  assert.ok(out.violations.some((v) => v.principle_id === 'own_problem'), '硬违规（推诿）必须保留');
  assert.ok(out.strengths.some((s) => s.principle_id === 'close_loop'));
  assert.equal(out.coach, '做得好，给客户明确闭环。');
});

test('LLM 复核：非法输出回退规则判定', async () => {
  const ruleEval = csEval('不是我们控制的', '短信怎么没发？');
  const out = await maybeRefineEvaluationWithLLM(async () => ({ ok: true, content: '不是json' }), {
    track: 'cs',
    traineeText: 'x',
    customerText: 'y',
    evalResult: ruleEval,
    turnNo: 1,
  });
  assert.equal(out.ok, false);
});

test('LLM 复核：提示词只含当前轮，禁止翻旧账', async () => {
  let msg = '';
  const ruleEval = csEval('好的。', '好的，那先这样。');
  await maybeRefineEvaluationWithLLM(async (messages) => {
    msg = messages[0].content;
    return { ok: true, content: JSON.stringify({ violations: [], strengths: [], coach: '' }) };
  }, {
    track: 'cs',
    traineeText: '好的。',
    customerText: '好的，那先这样。',
    evalResult: ruleEval,
    turnNo: 5,
  });
  assert.ok(/只判这一句/.test(msg));
  assert.ok(/禁止翻旧账/.test(msg));
  assert.ok(!/最近对话/.test(msg), '不应带入多轮历史，防止翻旧账');
});

test('合并：违规映射引擎 code + LLM 教练旁白', () => {
  const ruleEval = csEval('不是我们控制的', '短信怎么没发？');
  const final = applyRefinedEvaluation(ruleEval, {
    violations: [{ principle_id: 'own_problem', detail: '推诿' }],
    strengths: [],
    coach: '先揽责，再给解决方案。',
  });
  assert.ok(final.coachTags.some((t) => t.code === 'blame_shift'));
  assert.ok(final.coachTags.some((t) => t.code === 'llm_coach'));
  assert.ok(final.violations.some((v) => v.principle_id === 'own_problem'));
});

test('满意收束：cs 满意度达标且第二次 resolve 才结束', () => {
  const base = { track: 'cs', session: { satisfaction: 70 }, turnPlan: { intent: 'resolve' }, turnNo: 5 };
  assert.equal(shouldResolveSession({ ...base, priorCustomerIntents: ['resolve'] }).end, true);
  assert.equal(shouldResolveSession({ ...base, priorCustomerIntents: [] }).end, false, '首次 resolve 不结束');
  const mid = shouldResolveSession({ ...base, session: { satisfaction: 60 }, priorCustomerIntents: ['resolve'] });
  assert.equal(mid.end, true, '满意度及格也收场');
  assert.equal(mid.outcome, 'completed');
  const low = shouldResolveSession({ ...base, session: { satisfaction: 50 }, priorCustomerIntents: ['resolve'] });
  assert.equal(low.end, false, '满意度过低不收场');
  assert.equal(
    shouldResolveSession({ ...base, turnPlan: { intent: 'press_cause' }, priorCustomerIntents: ['resolve'] }).end,
    false
  );
  const sales = shouldResolveSession({
    track: 'sales',
    session: { close_readiness: 70 },
    turnPlan: { intent: 'signal' },
    priorCustomerIntents: ['signal'],
    turnNo: 3,
  });
  assert.equal(sales.end, true);
  assert.equal(sales.outcome, 'won');
});
