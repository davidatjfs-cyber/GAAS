import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerTurn, shouldResolveSession } from '../customer-reply.js';
import { BUILTIN_PERSONAS } from '../personas.js';

const persona = (key) => BUILTIN_PERSONAS.find((p) => p.persona_key === key);

function runPlan({ track, personaObj, texts, opening, state }) {
  let priorT = [];
  let priorC = opening ? [opening] : [];
  const plans = [];
  for (let i = 0; i < texts.length; i += 1) {
    const plan = buildCustomerTurn({
      track,
      persona: personaObj,
      evalResult: { coachTags: [], triggers: [], strengths: [] },
      session: state,
      turnNo: i + 1,
      traineeText: texts[i],
      priorTraineeTexts: priorT,
      priorCustomerTexts: priorC,
    });
    plans.push(plan);
    priorT.push(texts[i]);
    priorC.push(plan.reply);
  }
  return plans;
}

test('回归：生气人格（会话22序列）期望被接住后进入 resolve', () => {
  const p = persona('cs_angry_bug');
  const plans = runPlan({
    track: 'cs',
    personaObj: p,
    opening: p.opening_line,
    state: { emotion: 41, trust: 45, close_readiness: 0, satisfaction: 65 },
    texts: [
      '非常抱歉，后台的功能确实有些复杂，您看需要我给你仔细介绍一下吗',
      '您说的很有道理，我会反馈给我们工程师，如果真的可行，我们会尽快优化，再次给您道歉',
      '明白，谢谢您的意见，这对我们来说很重要',
      '收到，我们第一时间处理',
    ],
  });
  assert.equal(plans[0].intent, 'ack_empathy');
  assert.equal(plans[2].intent, 'resolve', '学员接住期望后应进入收束');
  const end = shouldResolveSession({
    track: 'cs',
    session: { satisfaction: 80 },
    turnPlan: plans[3],
    priorCustomerIntents: [plans[2].intent],
    turnNo: 4,
  });
  assert.equal(end.end, true, '第二次 resolve 应自动收束');
  assert.equal(end.outcome, 'resolved');
});

test('业务咨询：经营诊断逐问推进（数据来源→指标→闭环→边界）', () => {
  const p = persona('cs_growth_diagnosis');
  const plans = runPlan({
    track: 'cs',
    personaObj: p,
    opening: p.opening_line,
    state: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    texts: [
      '诊断数据来自POS收银和营业日报，每天自动同步',
      '主要看营业额、毛利、复购率和执行率这些指标',
      '诊断出的问题会生成整改任务，指定责任人并跟踪验收',
      '诊断以实际数据为准，不保证百分百准确，作为经营参考',
      '好的，我把报告口径整理好发您',
    ],
  });
  assert.equal(plans[0].intent, 'ack_data_source');
  assert.equal(plans[1].intent, 'ack_indicator');
  assert.equal(plans[2].intent, 'ack_diagnosis_action');
  assert.equal(plans[3].intent, 'ack_confidence');
  assert.equal(plans[4].intent, 'resolve');
});

test('业务咨询：POS 接入逐问推进（兼容→同步→历史→安全）', () => {
  const p = persona('cs_pos_data_connect');
  const plans = runPlan({
    track: 'cs',
    personaObj: p,
    opening: p.opening_line,
    state: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    texts: [
      '二维火可以接，主流收银系统我们都支持对接',
      '数据当天自动同步，最晚次日凌晨更新',
      '上线前的历史数据可以由你们导出后导入',
      '只有授权账号能看到数据，按权限范围展示',
      '好的，资料清单我让店长准备',
    ],
  });
  assert.equal(plans[0].intent, 'ack_support');
  assert.equal(plans[1].intent, 'ack_sync');
  assert.equal(plans[2].intent, 'ack_history');
  assert.equal(plans[3].intent, 'ack_security');
  assert.equal(plans[4].intent, 'resolve');
});

test('业务咨询：营销触达逐问推进（人群→渠道→合规→归因）', () => {
  const p = persona('cs_marketing_sms');
  const plans = runPlan({
    track: 'cs',
    personaObj: p,
    opening: p.opening_line,
    state: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    texts: [
      '可以按人群筛选，比如只选3个月没来的沉睡会员',
      '支持短信和企微触达，也可以同时发',
      '有频次上限和退订机制，避免打扰顾客',
      '发送后有回店和消费归因报表，能看到效果',
      '好的，我先小范围试一批',
    ],
  });
  assert.equal(plans[0].intent, 'ack_audience');
  assert.equal(plans[1].intent, 'ack_channel');
  assert.equal(plans[2].intent, 'ack_compliance');
  assert.equal(plans[3].intent, 'ack_attribution');
  assert.equal(plans[4].intent, 'resolve');
});

test('业务咨询：报表口径逐问推进（范围→退款→日结→核对）', () => {
  const p = persona('cs_report_billing');
  const plans = runPlan({
    track: 'cs',
    personaObj: p,
    opening: p.opening_line,
    state: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    texts: [
      '报表统计堂食和外卖所有渠道的订单',
      '退款按原路冲减，不计入营业额',
      '日结按营业日零点汇总',
      '对不上可以导出明细逐笔核对',
      '好的，那我配合导出明细',
    ],
  });
  assert.equal(plans[0].intent, 'ack_scope');
  assert.equal(plans[1].intent, 'ack_refund');
  assert.equal(plans[2].intent, 'ack_settle');
  assert.equal(plans[3].intent, 'ack_reconcile');
  assert.equal(plans[4].intent, 'resolve');
});

test('业务咨询：不确定时承诺查证也算回应（不编造）', () => {
  const p = persona('cs_growth_diagnosis');
  const plan = buildCustomerTurn({
    track: 'cs',
    persona: p,
    evalResult: { coachTags: [], triggers: [], strengths: [] },
    session: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    turnNo: 1,
    traineeText: '这个我需要核实一下，确认后答复您',
    priorTraineeTexts: [],
    priorCustomerTexts: [p.opening_line],
  });
  assert.equal(plan.intent, 'ack_data_source');
});

test('业务咨询：查证承诺按「一诺一问」覆盖，不能一句跳过整场', () => {
  const p = persona('cs_growth_diagnosis');
  let priorT = [];
  let priorC = [p.opening_line];
  const t1 = buildCustomerTurn({
    track: 'cs',
    persona: p,
    evalResult: { coachTags: [], triggers: [], strengths: [] },
    session: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    turnNo: 1,
    traineeText: '这个我需要核实一下，确认后答复您',
    priorTraineeTexts: priorT,
    priorCustomerTexts: priorC,
  });
  assert.equal(t1.intent, 'ack_data_source', '第一次查证承诺只覆盖第一问');
  priorT.push('这个我需要核实一下，确认后答复您');
  priorC.push(t1.reply);
  const t2 = buildCustomerTurn({
    track: 'cs',
    persona: p,
    evalResult: { coachTags: [], triggers: [], strengths: [] },
    session: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    turnNo: 2,
    traineeText: '诊断指标我也需要确认后答复',
    priorTraineeTexts: priorT,
    priorCustomerTexts: priorC,
  });
  assert.equal(t2.intent, 'ack_indicator', '第二次查证承诺只覆盖第二问');
  priorT.push('积分使用规则我也需要确认后答复');
  priorC.push(t2.reply);
  const t3 = buildCustomerTurn({
    track: 'cs',
    persona: p,
    evalResult: { coachTags: [], triggers: [], strengths: [] },
    session: { emotion: 40, trust: 40, close_readiness: 0, satisfaction: 60 },
    turnNo: 3,
    traineeText: '诊断闭环的部分我需要再确认一下',
    priorTraineeTexts: priorT,
    priorCustomerTexts: priorC,
  });
  assert.equal(t3.intent, 'ack_diagnosis_action', '第三次查证承诺才覆盖第三问');
});

test('经营专业：ROI 测算按 测算→假设→边界→方案 推进', () => {
  const p = persona('sales_roi_question');
  const plans = runPlan({
    track: 'sales',
    personaObj: p,
    opening: p.opening_line,
    state: { emotion: 45, trust: 35, close_readiness: 20 },
    texts: [
      '按您目前日均2.5万营业额估算，一年毛利提升空间大概在15-20万',
      '这是按同行保守数据预估的，实际以您门店客流和复购为准',
      '效果我们不做保证，建议先跑3个月试点，以实际数据验证',
      '第一步我先出一份试点方案和账本给您',
      '好的，方案和账本整理好后我发给您',
    ],
  });
  assert.equal(plans[0].intent, 'ack_roi_calc');
  assert.equal(plans[1].intent, 'ack_assumption');
  assert.equal(plans[2].intent, 'ack_boundary', '承诺边界是专业表现');
  assert.equal(plans[3].intent, 'ack_next_step');
  assert.equal(plans[4].intent, 'resolve');
  const end = shouldResolveSession({
    track: 'sales',
    session: { close_readiness: 70 },
    turnPlan: plans[4],
    priorCustomerIntents: ['resolve'],
    turnNo: 5,
  });
  assert.equal(end.end, true);
  assert.equal(end.outcome, 'won');
});

test('经营专业：落地实施方案按 第一周→首月→分工→指标 推进', () => {
  const p = persona('sales_solution_demo');
  const plans = runPlan({
    track: 'sales',
    personaObj: p,
    opening: p.opening_line,
    state: { emotion: 45, trust: 40, close_readiness: 25 },
    texts: [
      '第一周我们先盘点门店现状、导入会员数据并做员工培训',
      '第一个月每周复盘一次，第二个月按数据调整动作',
      '我们实施顾问负责落地，店长抽半天配合即可',
      '效果看复购率和月报数据，每月出一次复盘',
      '好的，我按这个计划执行',
    ],
  });
  assert.equal(plans[0].intent, 'ack_week1');
  assert.equal(plans[1].intent, 'ack_month1');
  assert.equal(plans[2].intent, 'ack_who');
  assert.equal(plans[3].intent, 'ack_measure');
  assert.equal(plans[4].intent, 'resolve');
});

test('新业务人格已内置且可被种子化', () => {
  const keys = new Set(BUILTIN_PERSONAS.map((p) => p.persona_key));
  for (const k of [
    'cs_growth_diagnosis', 'cs_marketing_sms', 'cs_pos_data_connect', 'cs_report_billing', 'cs_activity_setup',
    'sales_roi_question', 'sales_competitor_compare', 'sales_solution_demo',
  ]) {
    assert.ok(keys.has(k), `missing ${k}`);
  }
  assert.ok(!keys.has('cs_member_points_rule'), '会员积分不是系统功能，不得存在');
  assert.ok(!keys.has('cs_stored_value_rule'), '储值规则不是系统功能，不得存在');
});
