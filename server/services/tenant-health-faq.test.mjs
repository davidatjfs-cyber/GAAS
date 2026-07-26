import test from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH_FAQ, ITEM_KEY_TO_FAQ, faqForItemKey, listHealthFaqs } from './tenant-health-faq.js';

test('HEALTH_FAQ entries have required fields', () => {
  for (const faq of Object.values(HEALTH_FAQ)) {
    assert.ok(faq.id);
    assert.ok(faq.title);
    assert.ok(Array.isArray(faq.steps) && faq.steps.length >= 1);
  }
});

test('faqForItemKey resolves mapped keys and returns null for unknown', () => {
  const faq = faqForItemKey('yesterday_orders_synced');
  assert.equal(faq?.id, 'data-not-updated');
  assert.equal(faqForItemKey('unknown_item_key'), null);
  assert.equal(faqForItemKey(''), null);
});

test('ITEM_KEY_TO_FAQ covers core health red items', () => {
  assert.equal(ITEM_KEY_TO_FAQ.customer_phone_match_rate, 'phone-match-low');
  assert.equal(ITEM_KEY_TO_FAQ.attribution_links_orders, 'attribution-low');
});

test('listHealthFaqs returns all FAQ objects', () => {
  const list = listHealthFaqs();
  assert.equal(list.length, Object.keys(HEALTH_FAQ).length);
  assert.ok(list.some((f) => f.id === 'ai-auto-execute'));
});
