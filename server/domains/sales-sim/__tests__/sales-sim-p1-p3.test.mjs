import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBusinessPersonaSpec } from '../business-persona.js';
import { BUILTIN_PERSONAS } from '../personas.js';
import { buildCustomerReply } from '../customer-reply.js';

test('经营真题人格含复购数字与禁功能开场', () => {
  const spec = buildBusinessPersonaSpec({
    brandName: '潮粤坊',
    repurchaseRate: 0.18,
    members: 12000,
    stores: 3,
    pos: '二维火',
    pain: '复购偏弱',
  });
  assert.match(spec.opening_line, /复购率大概18/);
  assert.match(spec.opening_line, /别讲功能/);
  assert.equal(spec.source_type, 'business');
  assert.equal(spec.profile.members, 12000);
});

test('P1/P2 高难人格与门店租户场景已内置', () => {
  const keys = new Set(BUILTIN_PERSONAS.map((p) => p.persona_key));
  for (const k of [
    'silent_closer', 'last_minute_regret', 'biz_repurchase_gap',
    'cs_rage_escalation', 'cs_refund_lawyer',
    'store_diner_complaint', 'store_delivery_late', 'store_member_points',
  ]) {
    assert.ok(keys.has(k), `missing ${k}`);
  }
  assert.ok(BUILTIN_PERSONAS.some((p) => p.audience === 'tenant'));
});

test('经营真题客户对功能倾销给出业务追问', () => {
  const persona = BUILTIN_PERSONAS.find((p) => p.persona_key === 'biz_repurchase_gap');
  const reply = buildCustomerReply({
    track: 'sales',
    persona,
    evalResult: { coachTags: [{ code: 'feature_dump' }], triggers: ['ask_features'], strengths: [] },
    session: { emotion: 50, close_readiness: 20 },
    turnNo: 2,
  });
  assert.match(reply, /第一步|复购|杠杆|模块/);
});

test('高难沉默人格会产出短回复', () => {
  const persona = BUILTIN_PERSONAS.find((p) => p.persona_key === 'silent_closer');
  const reply = buildCustomerReply({
    track: 'sales',
    persona,
    evalResult: { coachTags: [], triggers: [], strengths: [] },
    session: { emotion: 50, close_readiness: 20 },
    turnNo: 2,
  });
  assert.ok(reply.length < 40 || /沉默|继续|嗯/.test(reply));
});
