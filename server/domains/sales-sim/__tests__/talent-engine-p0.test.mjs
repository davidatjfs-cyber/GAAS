import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ABILITIES } from '../ability.js';
import { BUILTIN_PROFILES, buildCompetencySnapshot } from '../competency.js';
import {
  BUILTIN_COACH_PERSONAS, applyCoachPersonaToDebrief,
} from '../coach-persona.js';
import {
  resolveFocusFromMemory, recentPersonaSet,
} from '../coach-memory.js';
import { maybePolishCustomerReply } from '../customer-reply.js';

test('Ability Library 含跨岗位可复用能力', () => {
  const keys = new Set(BUILTIN_ABILITIES.map((a) => a.ability_key));
  assert.ok(keys.has('service_awareness'));
  assert.ok(keys.has('questioning'));
  assert.ok(keys.has('recommendation'));
});

test('Job Profile 含销售客服与门店轨', () => {
  const keys = BUILTIN_PROFILES.map((p) => p.profile_key);
  assert.ok(keys.includes('sales'));
  assert.ok(keys.includes('cs'));
  assert.ok(keys.includes('foh_server'));
  assert.ok(keys.includes('kitchen_staff'));
  assert.notEqual(BUILTIN_PROFILES.find((p) => p.profile_key === 'foh_server')?.active, false);
});

test('Competency snapshot 带 version', () => {
  const snap = buildCompetencySnapshot([
    {
      competency_key: 'questioning', ability_key: 'questioning', label: '提问',
      weight: 1, version: 2, pass_score: 75,
    },
  ]);
  assert.equal(snap[0].version, 2);
  assert.equal(snap[0].competency_key, 'questioning');
});

test('Coach Persona 改变复盘叙事顺序', () => {
  const base = {
    score: 70,
    score_grade: 'C',
    strengths: [{ detail: '开场提问好', principle_label: '永远先提问' }],
    improvements: [{ principle_id: 'no_early_pitch', principle_label: '不急着介绍产品', detail: '过早讲功能' }],
    next_focus: 'ask_first',
    next_focus_label: '永远先提问',
  };
  const strict = BUILTIN_COACH_PERSONAS.find((p) => p.persona_key === 'strict');
  const encouraging = BUILTIN_COACH_PERSONAS.find((p) => p.persona_key === 'encouraging');
  const n1 = applyCoachPersonaToDebrief(base, strict);
  const n2 = applyCoachPersonaToDebrief(base, encouraging);
  assert.ok(n1.coach_narrative.includes('必须立刻改正'));
  assert.ok(n2.coach_narrative.includes('值得保持'));
  assert.ok(n1.coach_narrative.indexOf('必须立刻改正') < n1.coach_narrative.indexOf('做得对的地方'));
  assert.ok(n2.coach_narrative.indexOf('值得保持') < n2.coach_narrative.indexOf('可以再顺一点'));
});

test('Coach Memory：boost 窗口内优先弱项焦点', () => {
  const memory = {
    focus_competencies: ['closing', 'value'],
    boost_until: new Date(Date.now() + 3600_000).toISOString(),
    recent_persona_keys: ['busy_owner'],
  };
  assert.equal(resolveFocusFromMemory(memory, 'ask_first'), 'closing');
  assert.ok(recentPersonaSet(memory).has('busy_owner'));
  const expired = {
    ...memory,
    boost_until: new Date(Date.now() - 1000).toISOString(),
  };
  assert.equal(resolveFocusFromMemory(expired, 'ask_first'), 'ask_first');
});

test('maybePolishCustomerReply 使用 callLLM(messages, options) 签名', async () => {
  let called = null;
  const fakeLlm = async (messages, options) => {
    called = { messages, options };
    return { ok: true, content: '你们到底能解决什么？' };
  };
  const out = await maybePolishCustomerReply(fakeLlm, {
    persona: { title: '李老板', profile: { traits: ['怀疑'] } },
    ruleReply: '你继续说。',
    history: [{ role: 'trainee', content: '我们有很多功能' }],
  });
  assert.equal(out, '你们到底能解决什么？');
  assert.ok(Array.isArray(called.messages));
  assert.equal(called.options.max_tokens, 120);
  assert.equal(called.options.trackTier, true);
  assert.equal(called.options.purpose, 'talent_engine_customer_polish');
});

test('maybePolishCustomerReply LLM 失败回退规则句', async () => {
  const out = await maybePolishCustomerReply(async () => { throw new Error('boom'); }, {
    persona: { title: 'x' },
    ruleReply: '规则回退句',
    history: [],
  });
  assert.equal(out, '规则回退句');
});
