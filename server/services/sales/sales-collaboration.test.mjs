import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSalesDecision, buildCustomerAiGuidance, normalizeCustomerAiEvent } from './sales-collaboration.js';
import { canTransition, buildLeadSummary, calculateSla } from './sales-collaboration-service.js';

test('customer AI event is normalized with evidence and bounded confidence', () => {
  const event = normalizeCustomerAiEvent({ event_type: 'REQUEST_DEMO', priority: 'high', confidence: 2 }, '客户原话');
  assert.equal(event.event_type, 'REQUEST_DEMO');
  assert.equal(event.evidence, '客户原话');
  assert.equal(event.confidence, 1);
});

test('sales AI makes critical handoff decision without exposing internals to customer AI', () => {
  const decision = buildSalesDecision({
    lead: { stage: 'need_identified', decision_role: '老板', extracted: { store_count: 6, pain_point: '复购', pos_brand: '客如云' } },
    score: { intent_score: 88 },
    events: [{ event_type: 'REQUEST_TRIAL', priority: 'high' }, { event_type: 'ASK_POS_INTEGRATION', priority: 'high' }],
  });
  assert.equal(decision.intent_level, 'critical');
  assert.equal(decision.controller_recommendation, 'handoff_now');
  assert.ok(decision.customer_ai_policy.forbidden.includes('price_detail'));
  assert.equal(buildCustomerAiGuidance(decision).mode, 'waiting_human');
});

test('medium lead receives a reverse guidance question instead of forced takeover', () => {
  const decision = buildSalesDecision({ lead: { stage: 'ai_greeting', extracted: {} }, score: { intent_score: 20 }, events: [] });
  const guidance = buildCustomerAiGuidance(decision);
  assert.equal(decision.controller_recommendation, 'continue_ai');
  assert.equal(guidance.mode, 'diagnose');
  assert.equal(guidance.question_slot, 'store_count');
});

test('state machine rejects illegal jumps and summary exposes missing facts', () => {
  assert.equal(canTransition('ai_greeting', 'new'), false);
  assert.equal(canTransition('demo_completed', 'proposal'), true);
  const summary = buildLeadSummary({ stage: 'need_confirmed', intent_level: 'high', extracted: { pain_point: '复购' } }, { missing_facts: ['pos_brand'] });
  assert.deepEqual(summary.missing_facts, ['pos_brand']);
});

test('critical SLA is five minutes', () => {
  const now = new Date('2026-07-14T00:00:00Z');
  assert.equal(calculateSla('critical', now).toISOString(), '2026-07-14T00:05:00.000Z');
});
