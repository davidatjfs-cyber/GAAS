import assert from 'node:assert/strict';
import {
  extractSlotsFromText,
  detectEvents,
  buildStrategyPlan,
  sanitizeReply,
  templateReply,
  shouldTakeover,
} from './services/sales/sales-strategy.js';
import { scoreLead } from './services/sales/sales-scoring.js';
import { runCustomerAiTurn } from './services/sales/sales-customer-ai.js';
import { buildNextAction, buildSalesAdvice, buildBossDailyReport } from './services/sales/sales-ops.js';
import { containsForbiddenClaim } from './services/sales/sales-knowledge.js';

{
  const slots = extractSlotsFromText('我们上海有5家潮汕火锅，客如云，复购不行，我是老板', {});
  assert.equal(slots.store_count, 5);
  assert.equal(slots.city, '上海');
  assert.equal(slots.cuisine, '潮汕');
  assert.equal(slots.pos_brand, '客如云');
  assert.equal(slots.pain_point, '复购');
  assert.equal(slots.decision_role, '老板');
  console.log('ok extract slots');
}

{
  const events = detectEvents('想看看价格，能不能约个Demo');
  assert.ok(events.some((e) => e.event_type === 'ASK_PRICE'));
  assert.ok(events.some((e) => e.event_type === 'REQUEST_DEMO'));
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
    extracted: { store_count: 5, phone_data_ready: true, pain_point: '复购', decision_role: '老板' },
    eventTypes: ['ASK_PRICE', 'REQUEST_DEMO'],
  });
  assert.ok(score.intent_score >= 70);
  assert.equal(score.intent_level, 'high');
  assert.ok(score.items.some((i) => i.rule_key === 'request_demo'));
  console.log('ok scoring', score.intent_score);
}

{
  assert.ok(containsForbiddenClaim('我们保证一定涨营业额'));
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
  assert.equal(turn.source, 'template'); // 无 LLM
  assert.ok(turn.plan.extracted.store_count === 3);
  assert.ok(turn.plan.extracted.pain_point === '门店执行' || /执行/.test(turn.reply));
  console.log('ok customer ai template turn');
}

{
  const takeover = shouldTakeover({
    text: '随便问问',
    extracted: { store_count: 1 },
    intentScore: 10,
    controller: 'ai',
  });
  assert.equal(takeover.takeover, false);
  const advice = buildSalesAdvice(
    { extracted: { pain_point: '复购' }, phone_data_ready: false },
    { intent_score: 45, intent_level: 'medium' }
  );
  assert.ok(advice.includes('复购'));
  const next = buildNextAction({ store_count: 3, extracted: { pain_point: '复购' }, phone_data_ready: true, controller: 'ai' }, { intent_score: 75, intent_level: 'high' });
  assert.ok(next.next_action.includes('接管') || next.priority === 'high');
  console.log('ok sales advice');
}

{
  const pool = {
    async query(sql) {
      const t = String(sql);
      if (t.includes('CREATE TABLE') || t.includes('CREATE INDEX') || t.includes('CREATE UNIQUE')) return { rows: [] };
      if (t.includes('COUNT(*)') && t.includes('sales_leads')) return { rows: [{ c: 2 }] };
      if (t.includes('FROM sales_leads') && t.includes('intent_level')) {
        return { rows: [{ intent_level: 'high', c: 1 }, { intent_level: 'medium', c: 1 }] };
      }
      if (t.includes('FROM sales_leads') && t.includes('ORDER BY')) {
        return {
          rows: [
            {
              id: 1,
              lead_key: 'L1',
              intent_score: 80,
              intent_level: 'high',
              stage: 'qualified',
              controller: 'waiting_human',
              store_count: 5,
              next_action: '接管',
              extracted: {},
              pain_points: ['复购'],
            },
          ],
        };
      }
      if (t.includes('FROM sales_tasks')) return { rows: [{ c: 1 }] };
      return { rows: [] };
    },
  };
  const report = await buildBossDailyReport(pool);
  assert.equal(report.ok, true);
  assert.ok(String(report.text || '').includes('销售') || String(report.text || '').includes('线索'));
  console.log('ok daily report');
}

console.log('all sales-ai tests passed');
