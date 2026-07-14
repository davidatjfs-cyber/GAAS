import assert from 'node:assert/strict';
import {
  extractSlotsFromText,
  detectEvents,
  buildStrategyPlan,
  sanitizeReply,
  templateReply,
  shouldTakeover,
} from './services/sales/sales-strategy.js';
import { scoreLead, computeWinProbability } from './services/sales/sales-scoring.js';
import { runCustomerAiTurn } from './services/sales/sales-customer-ai.js';
import { buildNextAction, buildSalesAdvice, buildBossDailyReport, buildFunnelStats, buildRiskCustomers, buildTomorrowActions, buildSalesTodoList, buildTopHighLeads } from './services/sales/sales-ops.js';
import { deriveTagsForLead, recommendCaseTheme, recommendAssets, recommendNextSteps } from './services/sales/sales-tags.js';
import { buildDiagnosisReport, diagnoseLead, summarizeMeeting, detectOvercommitment, matchObjection, getObjectionResponse, buildDemoBrief } from './services/sales/sales-diagnosis.js';

{
  const slots = extractSlotsFromText('我们上海有4家潮汕菜，叫洪潮小馆，现在用客如云，会员有两万多人，主要问题是复购低。我姓王，手机13800138000。', {});
  assert.equal(slots.store_count, 4);
  assert.equal(slots.city, '上海');
  assert.equal(slots.cuisine, '潮汕');
  assert.equal(slots.pos_brand, '客如云');
  assert.equal(slots.pain_point, '复购');
  assert.equal(slots.name, '王');
  assert.equal(slots.company, '洪潮小馆');
  assert.equal(slots.phone, '13800138000');
  assert.equal(slots.member_estimate, 20000);
  console.log('ok extract slots');
}

{
  const events = detectEvents('想看看价格，能不能约个Demo，30天试跑一下');
  assert.ok(events.some((e) => e.event_type === 'ASK_PRICE'));
  assert.ok(events.some((e) => e.event_type === 'REQUEST_DEMO'));
  assert.ok(events.some((e) => e.event_type === 'REQUEST_TRIAL'));
  console.log('ok detect events');
}

{
  const plan = buildStrategyPlan({
    userText: '大概多少钱？下周能不能试跑',
    extracted: { store_count: 5, pain_point: '复购', phone_data_ready: true },
    intentScore: 50,
  });
  assert.equal(plan.mode, 'handoff');
  assert.equal(plan.takeover.takeover, true);
  const reply = templateReply(plan, '多少钱');
  assert.ok(reply.includes('转人工') || reply.includes('顾问'));
  assert.ok(!/保证|一定涨|全接/.test(reply));
  console.log('ok handoff plan');
}

{
  const score = scoreLead({
    extracted: { store_count: 5, phone_data_ready: true, pain_point: '复购', decision_role: '老板', has_member_system: true },
    eventTypes: ['ASK_PRICE', 'REQUEST_DEMO'],
  });
  assert.ok(score.intent_score >= 70);
  assert.equal(score.intent_level, 'high');
  assert.ok(score.items.some((i) => i.rule_key === 'request_demo'));
  console.log('ok scoring', score.intent_score);
}

{
  const score = scoreLead({
    extracted: { store_count: 1, phone_data_ready: false, pain_point: '定制开发', decision_role: '职能' },
    eventTypes: ['LOW_INTEREST'],
  });
  assert.ok(score.intent_score < 40);
  assert.ok(score.items.some((i) => i.rule_key === 'heavy_customization' || i.rule_key === 'no_decision_power'));
  console.log('ok negative scoring', score.intent_score);
}

{
  assert.ok(detectOvercommitment('我们所有POS都能接，保证涨营业额').length > 0);
  assert.ok(detectOvercommitment('没问题，定制都可以做').length > 0);
  const cleaned = sanitizeReply('我们可以保证一定涨营业额。请问有几家店？另外还想了解执行吗？');
  assert.ok(cleaned.includes('需由顾问评估后确认') || !cleaned.includes('保证一定'));
  assert.ok((cleaned.match(/？/g) || []).length <= 1);
  console.log('ok sanitize gate');
}

{
  const turn = await runCustomerAiTurn({
    userText: '我们3家店，店长不会干',
    extracted: {},
    history: [],
    intentScore: 0,
    controller: 'ai',
  });
  assert.equal(turn.ok, true);
  assert.ok(turn.reply);
  assert.equal(turn.source, 'template');
  assert.ok(turn.plan.extracted.store_count === 3);
  assert.ok(/执行|店长/.test(turn.reply));
  console.log('ok customer ai template turn');
}

{
  const tags = deriveTagsForLead({ store_count: 5, phone_data_ready: true, pain_point: '复购', stage: 'need_identified', intent_level: 'high', member_estimate: 20000, cuisine: '粤菜' });
  assert.ok(tags.includes('连锁客户'));
  assert.ok(tags.includes('有POS数据'));
  assert.ok(tags.includes('有会员数据'));
  assert.ok(tags.includes('老客复购低'));
  assert.ok(tags.includes('高意向'));
  console.log('ok tags', tags.join(','));
}

{
  const theme = recommendCaseTheme({ extracted: { pain_point: '复购' } });
  assert.equal(theme, '老客回店增长案例');
  const assets = recommendAssets({ tags: ['营业额下降'] });
  assert.ok(assets.includes('营业额归因案例'));
  const next = recommendNextSteps({ stage: 'need_identified', demo_count: 0, phone_data_ready: true });
  assert.ok(next.includes('发送匹配案例'));
  console.log('ok recommendation');
}

{
  const d = diagnoseLead({ extracted: { pain_point: '营销做了很多，但是没什么效果' } });
  assert.ok(d.root_causes.includes('客户没有分层，触达内容千篇一律'));
  assert.ok(d.recommended_modules.includes('ROI 报表'));
  const report = buildDiagnosisReport({ extracted: { pain_point: '复购低' }, phone_data_ready: false, decision_role: '运营' });
  assert.ok(report.sales_advice.includes('复购'));
  assert.ok(report.sales_advice.includes('数据基础弱'));
  assert.ok(report.sales_advice.includes('未确认决策人'));
  console.log('ok diagnosis');
}

{
  const summary = summarizeMeeting('客户希望提升老客复购，减少运营人员工作量。担心POS接入周期，担心门店不会使用。需要周三发送标准接入清单，周五安排老板看Demo。不是决策人，要问老板。');
  assert.ok(summary.customer_needs.includes('提升老客复购'));
  assert.ok(summary.customer_objections.includes('担心POS接入周期'));
  assert.ok(summary.risks.includes('未确认最终决策人'));
  console.log('ok meeting summary');
}

{
  const objection = matchObjection('你们价格太贵了');
  assert.equal(objection, 'price_too_high');
  const resp = getObjectionResponse(objection);
  assert.ok(resp.label);
  assert.ok(resp.response.includes('30天试跑'));
  console.log('ok objection library');
}

{
  const next = buildNextAction({ store_count: 3, extracted: { pain_point: '复购' }, phone_data_ready: true, controller: 'ai', demo_count: 0 }, { intent_score: 75, intent_level: 'high' });
  assert.ok(next.next_action.includes('接管'));
  const next2 = buildNextAction({ store_count: 3, extracted: { pain_point: '复购' }, phone_data_ready: true, demo_count: 1, trial_status: '', decision_role: '运营' }, { intent_score: 60, intent_level: 'medium' });
  assert.ok(next2.next_action.includes('决策人') || next2.next_action.includes('试跑'));
  console.log('ok next action');
}

{
  const pool = {
    async query(sql, params = []) {
      const t = String(sql);
      if (t.includes('CREATE TABLE') || t.includes('CREATE INDEX') || t.includes('CREATE UNIQUE')) return { rows: [] };
      if (t.includes('COUNT(*)') && t.includes('sales_leads')) return { rows: [{ c: 2 }] };
      if (t.includes('FROM sales_leads') && t.includes('intent_level')) return { rows: [{ intent_level: 'high', c: 1 }, { intent_level: 'medium', c: 1 }] };
      if (t.includes('FROM sales_leads') && t.includes('ORDER BY')) {
        return {
          rows: [
            { id: 1, lead_key: 'L1', company: 'A餐饮', intent_score: 80, intent_level: 'high', stage: 'sales_takeover', controller: 'ai', store_count: 5, demo_count: 1, trial_status: '', decision_role: '老板', pain_points: ['复购'], extracted: {}, events: '[]', last_human_at: new Date(Date.now() - 4 * 86400000).toISOString(), updated_at: new Date(Date.now() - 4 * 86400000).toISOString() },
            { id: 2, lead_key: 'L2', company: 'B餐饮', intent_score: 30, intent_level: 'low', stage: 'need_identified', controller: 'ai', store_count: 1, demo_count: 0, trial_status: '', decision_role: '运营', pain_points: [], extracted: {}, events: '[{"event_type":"ASK_PRICE"}]', last_human_at: new Date(Date.now() - 3 * 86400000).toISOString(), updated_at: new Date(Date.now() - 3 * 86400000).toISOString() },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const report = await buildBossDailyReport(pool);
  assert.equal(report.ok, true);
  assert.ok(report.summary.total >= 2);
  assert.ok(report.funnel.length > 0);
  assert.ok(report.risks.length > 0 || report.tomorrow_actions.length > 0);
  console.log('ok daily report', report.summary);
}

{
  const leads = [
    { id: 1, lead_key: 'L1', stage: 'new', events: '[]', last_human_at: new Date(Date.now() - 4 * 86400000).toISOString(), updated_at: new Date().toISOString() },
    { id: 2, lead_key: 'L2', stage: 'sales_takeover', events: '[{"event_type":"ASK_PRICE"}]', last_human_at: new Date(Date.now() - 3 * 86400000).toISOString(), demo_count: 1, decision_role: '运营', updated_at: new Date().toISOString() },
  ];
  const risks = buildRiskCustomers(leads);
  assert.ok(risks.some((r) => r.lead_key === 'L1' && r.risks.includes('超3天未跟进')));
  assert.ok(risks.some((r) => r.lead_key === 'L2' && r.risks.includes('报价后无进展')));
  console.log('ok risk detection');
}

{
  const leads = [
    { id: 1, lead_key: 'L1', stage: 'ai_greeting', intent_level: 'high', controller: 'ai', next_action_due: new Date(Date.now() - 1000).toISOString(), updated_at: new Date().toISOString() },
    { id: 2, lead_key: 'L2', stage: 'need_identified', intent_level: 'medium', controller: 'human', last_human_at: new Date(Date.now() - 3 * 86400000).toISOString(), updated_at: new Date().toISOString() },
  ];
  const todos = buildSalesTodoList(leads);
  assert.ok(todos.length > 0);
  console.log('ok todo list');
}

{
  const prob = computeWinProbability({ stage: 'demo_completed', intent_score: 70, demo_count: 1, meeting_count: 1 });
  assert.ok(prob >= 50 && prob <= 100);
  const probWon = computeWinProbability({ stage: 'won' });
  assert.equal(probWon, 100);
  console.log('ok win probability', prob);
}

{
  const leads = [
    { id: 1, lead_key: 'L1', company: 'A', intent_score: 85, intent_level: 'high', controller: 'ai', stage: 'need_identified', store_count: 3, pain_points: ['复购'], extracted: { pain_point: '复购' } },
    { id: 2, lead_key: 'L2', company: 'B', intent_score: 60, intent_level: 'medium', controller: 'human', stage: 'sales_takeover', store_count: 2 },
    { id: 3, lead_key: 'L3', company: 'C', intent_score: 90, intent_level: 'high', controller: 'human', stage: 'won' },
  ];
  const top5 = buildTopHighLeads(leads);
  assert.equal(top5.length, 2);
  assert.equal(top5[0].lead_key, 'L1');
  assert.ok(top5[0].reasons.includes('高意向待接管'));
  console.log('ok top5');
}

{
  const brief = buildDemoBrief({ company: '洪潮', store_count: 3, cuisine: '粤菜', extracted: { pain_point: '复购' } }, {});
  assert.equal(brief.customer, '洪潮');
  assert.ok((brief.main_problems || []).length > 0);
  console.log('ok demo brief');
}

console.log('all sales-ai enhanced tests passed');
