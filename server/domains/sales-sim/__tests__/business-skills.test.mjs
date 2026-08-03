import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SALES_SKILLS, SALES_PRINCIPLES, scoreSkillsFromEvals,
} from '../principles.js';
import { skillLabel, principleLabel } from '../labels.js';
import { enrichEvalsWithBusinessAcks } from '../session-service.js';

test('销售轨技能维度包含业务能力：方案价值 + 落地实施', () => {
  assert.ok(SALES_SKILLS.includes('solution_value'));
  assert.ok(SALES_SKILLS.includes('implementation'));
  assert.ok(SALES_PRINCIPLES.some((p) => p.id === 'solution_value' && p.skill === 'solution_value'));
  assert.ok(SALES_PRINCIPLES.some((p) => p.id === 'implementation' && p.skill === 'implementation'));
  assert.equal(skillLabel('solution_value'), '方案价值');
  assert.equal(skillLabel('implementation'), '落地实施');
  assert.equal(principleLabel('solution_value'), '方案价值与边界');
  assert.equal(principleLabel('implementation'), '落地实施清晰');
});

test('销售业务能力评分进入技能得分', () => {
  const skills = scoreSkillsFromEvals('sales', [
    { violations: [], strengths: [{ principle_id: 'solution_value' }] },
    { violations: [], strengths: [{ principle_id: 'implementation' }] },
  ]);
  assert.ok(skills.solution_value > 70, '方案价值优点应抬升分数');
  assert.ok(skills.implementation > 70, '落地实施优点应抬升分数');
});

test('业务 ack 意图回填业务能力优点（销售轨）', () => {
  const turns = [
    { role: 'customer', turn_no: 1, content: '开场', state_delta: {} },
    { role: 'trainee', turn_no: 1, content: '按营业额算，一年毛利提升15-20万', state_delta: {} },
    { role: 'customer', turn_no: 1, content: '算清楚了', state_delta: { customer_intent: 'ack_roi_calc' } },
    { role: 'customer', turn_no: 2, content: '第一周做什么？', state_delta: {} },
    { role: 'trainee', turn_no: 2, content: '第一周先盘点并培训', state_delta: {} },
    { role: 'customer', turn_no: 2, content: '明白', state_delta: { customer_intent: 'ack_week1' } },
  ];
  const evals = [
    { turn_no: 1, violations: [], strengths: [], triggers: [], coachTags: [] },
    { turn_no: 2, violations: [], strengths: [], triggers: [], coachTags: [] },
  ];
  enrichEvalsWithBusinessAcks(turns, evals, 'sales');
  assert.ok(evals[0].strengths.some((s) => s.principle_id === 'solution_value'));
  assert.ok(evals[1].strengths.some((s) => s.principle_id === 'implementation'));
});

test('业务 ack 回填按原则去重，且不影响非销售轨', () => {
  const turns = [
    { role: 'customer', turn_no: 1, content: 'x', state_delta: { customer_intent: 'ack_roi_calc' } },
    { role: 'customer', turn_no: 1, content: 'y', state_delta: { customer_intent: 'ack_assumption' } },
  ];
  const evals = [{ turn_no: 1, violations: [], strengths: [{ principle_id: 'solution_value' }], triggers: [], coachTags: [] }];
  enrichEvalsWithBusinessAcks(turns, evals, 'sales');
  assert.equal(evals[0].strengths.filter((s) => s.principle_id === 'solution_value').length, 1, '同一原则只记一次');

  const csEvals = [{ turn_no: 1, violations: [], strengths: [], triggers: [], coachTags: [] }];
  enrichEvalsWithBusinessAcks(turns, csEvals, 'cs');
  assert.equal(csEvals[0].strengths.length, 0, '非销售轨不注入');
});
