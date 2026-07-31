import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIncidentLockedReply, buildIncidentCorrections, resolveModelAnswer,
} from '../incident-dialogue.js';

const wasteCard = {
  card_key: 'hr_waste_food',
  title: '临期食品能不能便宜卖给员工',
  counterpart_role: 'hr',
  locked_facts: ['临期/撤下食品', '问能否私分'],
  success_criteria: '隔离登记，禁止擅自处理出售',
  model_answer: '不能便宜卖给员工，也不能私分。应隔离停用、报损销毁并登记上报。',
  probe_questions: [
    '除了能不能卖，完整说：发现后第一步找谁、怎么登记？',
    '同事私下说「便宜点给我」，你怎么拒绝才合规？',
    '最终处置请用规定用语：报损、销毁，还是可以内部消化？',
  ],
  failure_signals: ['编造制度'],
};

test('人事题：答对后换角度，不复读原题', () => {
  const r1 = buildIncidentLockedReply({
    incident: wasteCard,
    evalResult: { violations: [], strengths: [] },
    turnNo: 1,
    traineeText: '必须扔掉',
    priorTraineeTexts: [],
    priorCustomerTexts: [wasteCard.probe_questions[0]],
  });
  assert.ok(r1);
  assert.ok(!/我再确认一下/.test(r1));
  assert.ok(!/临期食品能不能便宜卖给员工/.test(r1));

  const r2 = buildIncidentLockedReply({
    incident: wasteCard,
    evalResult: { violations: [], strengths: [] },
    turnNo: 2,
    traineeText: '不能私分，要报损销毁并上报厨师长登记',
    priorTraineeTexts: ['必须扔掉'],
    priorCustomerTexts: [r1],
  });
  assert.ok(r2);
  assert.notEqual(r2, r1);
  assert.ok(!r2.includes(r1.slice(0, 10)));
});

test('复盘：指出过短答法并给正确句', () => {
  const out = buildIncidentCorrections({
    card: wasteCard,
    traineeTurns: [
      { turn_no: 1, content: '必须扔掉' },
      { turn_no: 2, content: '不能' },
    ],
    evals: [],
  });
  assert.ok(out.model_answer.includes('不能'));
  assert.ok(out.turn_corrections.length >= 1);
  const first = out.turn_corrections[0];
  assert.ok(first.your_words);
  assert.ok(first.better_answer);
  assert.ok(first.problems?.length);
});

test('标准答法可从卡面解析', () => {
  assert.ok(resolveModelAnswer(wasteCard).includes('私分'));
});
