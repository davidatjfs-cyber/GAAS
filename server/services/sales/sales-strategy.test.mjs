import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCommercialTermsQuery,
  isContractProcessQuery,
  isUncertainAnswer,
  inferQuestionSlotFromText,
  inferRecentQuestionSlot,
  extractSlotsFromText,
  detectEvents,
  nextDiagnosticQuestion,
  shouldTakeover,
  buildStrategyPlan,
  diagnosisCta,
  containsPriceMention,
  sanitizeReply,
  templateReply,
} from './sales-strategy.js';

test('isCommercialTermsQuery distinguishes vendor pricing from own-business context', () => {
  assert.equal(isCommercialTermsQuery('你们这套系统多少钱'), true);
  assert.equal(isCommercialTermsQuery('我们门店搞优惠活动'), false);
  assert.equal(isCommercialTermsQuery('食材越来越贵'), false);
  assert.equal(isCommercialTermsQuery('怎么收费'), true);
});

test('isContractProcessQuery ignores system feature inquiries', () => {
  assert.equal(isContractProcessQuery('签约流程是怎样的'), true);
  assert.equal(isContractProcessQuery('系统里能管理合同吗'), false);
});

test('inferQuestionSlotFromText and isUncertainAnswer', () => {
  assert.equal(inferQuestionSlotFromText('你们会员大概有多少'), 'member_estimate');
  assert.equal(isUncertainAnswer('不太清楚'), true);
  assert.equal(isUncertainAnswer('1200'), false);
});

test('extractSlotsFromText merges city and store count', () => {
  const slots = extractSlotsFromText('我们在上海有3家门店，用的是客如云POS', {});
  assert.equal(slots.city, '上海');
  assert.equal(slots.store_count, 3);
  assert.match(String(slots.pos_brand || ''), /客如云/i);
});

test('inferRecentQuestionSlot reads latest outbound question', () => {
  const slot = inferRecentQuestionSlot([
    { direction: 'outbound', content: '请问门店在哪个城市？' },
    { direction: 'inbound', content: '上海' },
  ]);
  assert.equal(slot, 'city');
});

test('detectEvents flags demo and commercial intents', () => {
  const events = detectEvents('能不能安排一个demo看看');
  assert.ok(events.some((e) => e.event_type === 'REQUEST_DEMO'));
  const priceEvents = detectEvents('你们报价是多少');
  assert.ok(priceEvents.some((e) => e.event_type === 'ASK_PRICE'));
});

test('nextDiagnosticQuestion asks for missing slots', () => {
  const q = nextDiagnosticQuestion({ city: '上海', store_count: 2 });
  assert.ok(q);
  assert.equal(q.key, 'cuisine');
});

test('shouldTakeover triggers on high intent or commercial terms', () => {
  assert.equal(shouldTakeover({ text: '下周想试点', extracted: {}, intentScore: 0, controller: 'ai' }).takeover, true);
  assert.equal(shouldTakeover({ text: '随便看看', extracted: {}, intentScore: 0, controller: 'ai' }).takeover, false);
});

test('buildStrategyPlan returns strategy fields', () => {
  const plan = buildStrategyPlan({
    userText: '我们在北京有3家门店',
    extracted: extractSlotsFromText('我们在北京有3家门店', {}),
    history: [],
    intentScore: 0.2,
    controller: 'ai',
    knowledgeItems: [],
  });
  assert.equal(plan.mode, 'diagnose');
  assert.equal(plan.extracted.store_count, 3);
});

test('diagnosisCta, containsPriceMention, sanitizeReply, templateReply', () => {
  assert.match(diagnosisCta(50), /演示/);
  assert.equal(containsPriceMention('报价多少'), false);
  assert.equal(containsPriceMention('费用9800元'), true);
  assert.match(sanitizeReply('嗯，我们支持客如云的POS系统'), /需由顾问评估|接口评估/);
  const plan = buildStrategyPlan({
    userText: '你好',
    extracted: {},
    history: [],
    intentScore: 0,
    controller: 'ai',
    knowledgeItems: [],
  });
  const reply = templateReply(plan, '你好', 0);
  assert.match(reply, /李娟娟|门店/);
});
