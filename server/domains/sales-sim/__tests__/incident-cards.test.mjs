import test from 'node:test';
import assert from 'node:assert/strict';
import { INCIDENT_CATEGORIES } from '../incident-categories.js';
import { INCIDENT_SEED_CARDS } from '../incident-seed-cards.js';
import {
  publicIncidentCard, scoreIncidentPerformance,
} from '../incident-cards.js';
import { buildIncidentLockedReply, buildCustomerReply } from '../customer-reply.js';

test('场景大类覆盖用户要求的主干类型', () => {
  const keys = new Set(INCIDENT_CATEGORIES.map((c) => c.category_key));
  for (const k of [
    'dine_complaint', 'delivery_complaint', 'food_safety_inspect',
    'greeting_host', 'newhire_handbook', 'cashier_dispute', 'manager_escalate',
  ]) {
    assert.ok(keys.has(k), `missing category ${k}`);
  }
});

test('事故卡素材库：每张卡绑定大类/锁定事实/KB hints/SOP', () => {
  assert.ok(INCIDENT_SEED_CARDS.length >= 100, `期望素材库≥100，实际 ${INCIDENT_SEED_CARDS.length}`);
  const catKeys = new Set(INCIDENT_CATEGORIES.map((c) => c.category_key));
  const seen = new Set();
  for (const c of INCIDENT_SEED_CARDS) {
    assert.ok(c.card_key && !seen.has(c.card_key), `duplicate/missing key ${c.card_key}`);
    seen.add(c.card_key);
    assert.ok(catKeys.has(c.category_key), `${c.card_key} bad category`);
    assert.ok(Array.isArray(c.locked_facts) && c.locked_facts.length >= 2);
    assert.ok(c.opening_line && c.incident_brief);
    assert.ok(Array.isArray(c.kb_title_hints) && c.kb_title_hints.length >= 1);
    assert.ok(Array.isArray(c.sop_checklist) && c.sop_checklist.length >= 1);
  }
});

test('新人规章类由 HR 对手扮演', () => {
  const hrs = INCIDENT_SEED_CARDS.filter((c) => c.category_key === 'newhire_handbook');
  assert.ok(hrs.length >= 4);
  assert.ok(hrs.every((c) => c.counterpart_role === 'hr'));
});

test('锁定回复：不另起新事实，围绕 locked_facts', () => {
  const incident = {
    card_key: 'dine_foreign_hair',
    counterpart_role: 'customer',
    locked_facts: ['桌号8号', '菜品是烧鹅', '异物为头发'],
    title: '菜品中发现头发',
  };
  const reply = buildIncidentLockedReply({
    incident,
    evalResult: { violations: [{ principle_id: 'x' }], strengths: [] },
    turnNo: 1,
    traineeText: '你自己找厨房',
    priorTraineeTexts: [],
    priorCustomerTexts: [],
  });
  assert.match(reply, /烧鹅|头发|桌号|方案|处理|解决|致歉/);
  assert.ok(!/外卖超时|食药监|团购券/.test(reply));
  assert.ok(!/我再确认一下/.test(reply));
});

test('buildCustomerReply 有事故卡时走锁定路径', () => {
  const text = buildCustomerReply({
    track: 'foh_server',
    persona: null,
    evalResult: { violations: [], strengths: [{ principle_id: 'soothe' }, { principle_id: 'own_exception' }], coachTags: [] },
    session: {
      incident_snapshot: {
        card_key: 'x',
        counterpart_role: 'customer',
        locked_facts: ['汤汁洒漏'],
      },
    },
    turnNo: 2,
  });
  assert.ok(/按你说的办|看着|处理好|汤汁洒漏|解决/.test(text));
});

test('双维评分：好回复抬升知识分与体验分', () => {
  const card = {
    sop_checklist: ['先致歉安抚', '确认事实', '给处理方案', '闭环告知'],
    experience_rubric: ['客人感到被重视'],
    failure_signals: ['推诿'],
    kb_articles: [{ id: '1', title: '前厅客诉处置SOP' }],
  };
  const good = scoreIncidentPerformance({
    card,
    evals: [{
      violations: [],
      strengths: [{ principle_id: 'soothe' }, { principle_id: 'own_exception' }],
    }],
    traineeTexts: [
      '非常抱歉让您不快，我马上确认是烧鹅里的问题，这道菜免单并给您重做一份，处理好立刻跟您说。',
    ],
  });
  assert.ok(good.knowledge_score >= 70);
  assert.ok(good.experience_score >= 70);
  assert.equal(good.kb_articles[0].title, '前厅客诉处置SOP');

  const bad = scoreIncidentPerformance({
    card,
    evals: [{ violations: [{ principle_id: 'no_soothe' }], strengths: [] }],
    traineeTexts: ['不是我的事，你自己找厨房去，按规定不能退。推诿一下。'],
  });
  assert.ok(bad.experience_score < good.experience_score);
  assert.ok(bad.total_score < good.total_score);
});

test('publicIncidentCard 暴露对练所需字段', () => {
  const p = publicIncidentCard({
    card_key: 'a',
    category_key: 'dine_complaint',
    category_label: '堂食客诉类',
    job_profile_key: 'foh_server',
    title: 't',
    difficulty: 2,
    counterpart_role: 'customer',
    incident_brief: 'b',
    locked_facts: ['f1'],
    opening_line: 'o',
    success_criteria: 's',
    competency_keys: ['exception_handling'],
    kb_articles: [],
    sop_checklist: ['致歉'],
  });
  assert.equal(p.counterpart_label, '客人');
  assert.equal(p.category_label, '堂食客诉类');
  assert.deepEqual(p.locked_facts, ['f1']);
});
