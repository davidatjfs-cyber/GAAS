import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTraineeUtterance, detectCustomerTriggers } from '../principles.js';
import { applyStateDelta, buildCustomerReply, shouldEndSession } from '../customer-reply.js';
import { rankLadder, rankLabel } from '../rank.js';
import { BUILTIN_PLAYBOOKS } from '../playbooks.js';
import { BUILTIN_PERSONAS } from '../personas.js';

test('detectCustomerTriggers: 太贵 / 再考虑', () => {
  assert.ok(detectCustomerTriggers('你们太贵了').includes('too_expensive'));
  assert.ok(detectCustomerTriggers('我再考虑一下').includes('think_again'));
});

test('销售：过早功能介绍触发 no_early_pitch', () => {
  const ev = evaluateTraineeUtterance({
    track: 'sales',
    traineeText: '我们系统有经营诊断、会员营销、AI客服很多功能',
    customerText: '有事快说',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  assert.ok(ev.violations.some((v) => v.principle_id === 'no_early_pitch'));
  assert.ok(ev.coachTags.some((t) => t.code === 'early_pitch'));
});

test('销售：提问挖需算 strengths', () => {
  const ev = evaluateTraineeUtterance({
    track: 'sales',
    traineeText: '在介绍之前，我想先了解您现在最想解决什么问题？',
    customerText: '有事快说',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  assert.ok(ev.hasQuestion);
  assert.ok(ev.strengths.some((s) => s.principle_id === 'ask_first'));
  assert.equal(ev.violations.length, 0);
});

test('销售：价格异议辩解触发 stay_on_pain', () => {
  const ev = evaluateTraineeUtterance({
    track: 'sales',
    traineeText: '我们其实不贵，性价比很高',
    customerText: '太贵了',
    turnNo: 3,
    priorTraineeCount: 2,
  });
  assert.ok(ev.violations.some((v) => v.principle_id === 'stay_on_pain'));
});

test('客服：投诉无安抚', () => {
  const ev = evaluateTraineeUtterance({
    track: 'cs',
    traineeText: '我帮您看看后台日志',
    customerText: '今天短信怎么没发？我要投诉',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  assert.ok(ev.violations.some((v) => v.principle_id === 'soothe_first'));
});

test('客服：退款硬拒', () => {
  const ev = evaluateTraineeUtterance({
    track: 'cs',
    traineeText: '不能退，按规定不行',
    customerText: '我要退款',
    turnNo: 2,
    priorTraineeCount: 1,
  });
  assert.ok(ev.violations.some((v) => v.principle_id === 'dig_refund_root'));
});

test('状态机：违规降低信任；可挂断', () => {
  const ev = evaluateTraineeUtterance({
    track: 'sales',
    traineeText: '我们有很多功能经营诊断会员营销',
    customerText: '快说',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  const state = applyStateDelta(
    { emotion: 30, trust: 25, close_readiness: 15, satisfaction: 0 },
    { evalResult: ev, track: 'sales' }
  );
  assert.ok(state.trust < 25);
  const end = shouldEndSession({ ...state, emotion: 10, trust: 10 }, 'sales');
  assert.equal(end.end, true);
});

test('客户回复：过早推销 → 反感话术', () => {
  const reply = buildCustomerReply({
    track: 'sales',
    persona: BUILTIN_PERSONAS[0],
    evalResult: { coachTags: [{ code: 'early_pitch' }], triggers: [], strengths: [] },
    session: { emotion: 40, close_readiness: 10 },
    turnNo: 1,
  });
  assert.ok(/功能|头疼|说明书/.test(reply));
});

test('内置人格与话术覆盖双轨', () => {
  assert.ok(BUILTIN_PERSONAS.filter((p) => p.track === 'sales').length >= 5);
  assert.ok(BUILTIN_PERSONAS.filter((p) => p.track === 'cs').length >= 3);
  assert.ok(BUILTIN_PLAYBOOKS.some((p) => p.scene_key === 'too_expensive'));
  assert.ok(BUILTIN_PLAYBOOKS.some((p) => p.scene_key === 'refund'));
});

test('职级阶梯标签', () => {
  assert.equal(rankLabel('sales', 'sales_ace'), '销冠');
  assert.equal(rankLabel('cs', 'cs_gold'), '金牌客服');
  assert.ok(rankLadder('sales').some((r) => r.mentor));
});
