import test from 'node:test';
import assert from 'node:assert/strict';
import { SALES_EVENT_DICTIONARY, assertSalesEventType } from './sales-event-dictionary.js';

test('SALES_EVENT_DICTIONARY contains frozen schema metadata', () => {
  assert.equal(SALES_EVENT_DICTIONARY.lead_created.event_type, 'lead_created');
  assert.equal(SALES_EVENT_DICTIONARY.lead_created.schema_version, 'v1');
  assert.match(SALES_EVENT_DICTIONARY.deal_won.description, /成交/);
});

test('assertSalesEventType returns entry for known events', () => {
  const entry = assertSalesEventType('demo_completed');
  assert.equal(entry.description, 'Demo已完成');
});

test('assertSalesEventType throws for unknown events', () => {
  assert.throws(() => assertSalesEventType('not_a_real_event'), /unknown_sales_event_type:not_a_real_event/);
});
