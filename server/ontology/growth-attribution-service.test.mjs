import test from 'node:test';
import assert from 'node:assert/strict';
import { generateGrowthAttribution } from './growth-attribution-service.js';

function makePool(handler) {
  return { query: handler || (async () => ({ rows: [] })) };
}

test('generateGrowthAttribution returns insufficient_data without touches', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const r = await generateGrowthAttribution(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(r.ontologyStatus, 'insufficient_data');
  assert.equal(r.attributedOrderCount, 0);
  assert.equal(r.attributedRevenue, 0);
});

test('generateGrowthAttribution persists matched touch-to-order attributions', async () => {
  const inserts = [];
  const pool = makePool(async (sql) => {
    if (/FROM growth_ontology_touches/i.test(sql)) {
      return {
        rows: [{
          touchId: 'touch1',
          campaignId: 'camp1',
          customerId: 'cust1',
          touchTime: '2026-07-20T12:00:00.000Z',
          couponId: null,
          channel: 'sms',
        }],
      };
    }
    if (/FROM growth_ontology_orders/i.test(sql)) {
      return {
        rows: [{
          orderId: 'ord1',
          customerId: 'cust1',
          orderTime: '2026-07-21T12:00:00.000Z',
          orderAmount: 288,
          couponId: null,
          directCampaignId: null,
        }],
      };
    }
    if (/INSERT INTO growth_ontology_attributions/i.test(sql)) {
      inserts.push(sql);
      return {
        rows: [{
          customer_id: 'cust1',
          actual_value: 288,
          related_order_id: 'ord1',
          attribution_method: 'time_window',
          evidence_json: { touchTime: '2026-07-20T12:00:00.000Z', channel: 'sms' },
        }],
      };
    }
    return { rows: [] };
  });
  const r = await generateGrowthAttribution(pool, {
    tenantId: 'default',
    storeId: 's1',
    campaignId: 'camp1',
    attributionWindowDays: 7,
    scenario: 'new_customer_second_visit',
  });
  assert.equal(r.ontologyStatus, 'ok');
  assert.equal(r.attributedOrderCount, 1);
  assert.equal(r.attributedRevenue, 288);
  assert.equal(r.evidenceDetails[0].orderAmount, 288);
  assert.equal(inserts.length, 1);
});
