import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTraineeUtterance, scoreSkillsFromEvals, CONSULT_SKILLS,
} from '../principles.js';
import { BUILTIN_PERSONAS } from '../personas.js';
import { trackLabel } from '../labels.js';
import { rankLadder } from '../rank.js';

test('业务咨询类人格已从 cs 迁到独立 consult track，不再套用投诉话术评分', () => {
  const keys = ['cs_growth_diagnosis', 'cs_marketing_sms', 'cs_pos_data_connect', 'cs_report_billing', 'cs_activity_setup'];
  for (const k of keys) {
    const p = BUILTIN_PERSONAS.find((x) => x.persona_key === k);
    assert.equal(p.track, 'consult', `${k} 应属于 consult track`);
  }
});

test('consult：只给模糊回应（可以/没问题）未给步骤，判 clear_steps 违规', () => {
  const { violations, strengths } = evaluateTraineeUtterance({
    track: 'consult',
    traineeText: '可以',
    customerText: '我想自己在后台建一个会员日活动，还想群发短信，但不知道从哪开始，你能一步一步教我操作吗？',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  assert.ok(violations.some((v) => v.principle_id === 'clear_steps'));
  assert.ok(!strengths.some((s) => s.principle_id === 'clear_steps'));
});

test('consult：给出分步骤说明，判 clear_steps 优点', () => {
  const { strengths, violations } = evaluateTraineeUtterance({
    track: 'consult',
    traineeText: '第一步先在后台建活动，第二步设置券码规则，第三步选择人群，第四步群发短信',
    customerText: '我想自己在后台建一个会员日活动，还想群发短信，但不知道从哪开始，你能一步一步教我操作吗？',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  assert.ok(strengths.some((s) => s.principle_id === 'clear_steps'));
  assert.ok(!violations.some((v) => v.principle_id === 'clear_steps'));
});

test('consult：过度绝对承诺（肯定没问题）判 accurate_info 违规', () => {
  const { violations } = evaluateTraineeUtterance({
    track: 'consult',
    traineeText: '肯定没问题，随便接都行',
    customerText: '我们店用的是二维火收银，你们的系统能接上吗？',
    turnNo: 1,
    priorTraineeCount: 0,
  });
  assert.ok(violations.some((v) => v.principle_id === 'accurate_info'));
});

test('consult：技能评分维度是业务能力四项，不是安抚/定位/闭环/维护', () => {
  assert.deepEqual(CONSULT_SKILLS, ['communication', 'product_knowledge', 'service_awareness', 'recommendation']);
  const skills = scoreSkillsFromEvals('consult', []);
  assert.deepEqual(Object.keys(skills).sort(), [...CONSULT_SKILLS].sort());
});

test('consult：track 标签与职级阶梯独立于 cs', () => {
  assert.equal(trackLabel('consult'), '咨询答疑陪练');
  const ladder = rankLadder('consult');
  assert.ok(ladder.every((r) => r.key.startsWith('consult_')));
});
