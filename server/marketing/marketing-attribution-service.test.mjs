import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketingAttributionMetricsInput,
  calculateCampaignAttributionFromRecords,
  matchTouchToOrders,
} from './marketing-attribution-service.js';
import { inferIssuesFromMetrics } from '../ontology/business-ontology-engine.js';

const touches = [
  { touchId: 't1', campaignId: 'c1', customerId: 'u1', touchTime: '2026-07-01T10:00:00Z', couponId: 'cp1' },
  { touchId: 't2', campaignId: 'c1', customerId: 'u2', touchTime: '2026-07-01T10:00:00Z' },
  { touchId: 't3', campaignId: 'c1', customerId: '', touchTime: '2026-07-01T10:00:00Z' },
];

test('same customerId order within 7 days is attributed', () => {
  const matches = matchTouchToOrders(touches, [
    { orderId: 'o1', customerId: 'u1', orderTime: '2026-07-03T10:00:00Z', orderAmount: 120 },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].relatedOrderId, 'o1');
});

test('orders outside attributionWindowDays are not attributed', () => {
  const matches = matchTouchToOrders(touches, [
    { orderId: 'o2', customerId: 'u1', orderTime: '2026-07-20T10:00:00Z', orderAmount: 120 },
  ], { attributionWindowDays: 7 });
  assert.equal(matches.length, 0);
});

test('couponId match gets priority attribution type', () => {
  const matches = matchTouchToOrders(touches, [
    { orderId: 'o3', customerId: 'u1', orderTime: '2026-07-02T10:00:00Z', orderAmount: 90, couponId: 'cp1' },
  ]);
  assert.equal(matches[0].attributionType, 'coupon');
  assert.equal(matches[0].couponUsed, true);
});

test('orders without customerId are not forced into attribution', () => {
  const matches = matchTouchToOrders(touches, [
    { orderId: 'o4', customerId: '', orderTime: '2026-07-02T10:00:00Z', orderAmount: 90 },
  ]);
  assert.equal(matches.length, 0);
});

test('calculateCampaignAttributionFromRecords computes conversion and revenue', () => {
  const summary = calculateCampaignAttributionFromRecords('c1', touches, [
    { orderId: 'o1', customerId: 'u1', orderTime: '2026-07-02T10:00:00Z', orderAmount: 120, couponId: 'cp1' },
    { orderId: 'o2', customerId: 'u2', orderTime: '2026-07-03T10:00:00Z', orderAmount: 80 },
  ]);
  assert.equal(summary.touchedCustomerCount, 2);
  assert.equal(summary.returnedCustomerCount, 2);
  assert.equal(summary.attributedRevenue, 200);
  assert.equal(summary.conversionRate, 1);
  assert.equal(summary.evidenceDetails.length, 2);
  assert.equal(summary.evidenceDetails[0].relatedOrderId, 'o1');
});

test('records without relatedOrderId do not count as real attributed revenue', () => {
  const summary = calculateCampaignAttributionFromRecords('c1', [
    { touchId: 't1', campaignId: 'c1', customerId: 'u1', touchTime: '2026-07-01T10:00:00Z' },
  ], [
    { orderId: '', customerId: 'u1', orderTime: '2026-07-02T10:00:00Z', orderAmount: 120 },
  ]);
  assert.equal(summary.attributedRevenue, 0);
  assert.equal(summary.evidenceDetails.length, 0);
});

test('buildMarketingAttributionMetricsInput outputs ontology-ready metrics', () => {
  const metrics = buildMarketingAttributionMetricsInput({
    conversionRate: 0.08,
    previousConversionRate: 0.16,
    attributedRevenue: 800,
    previousAttributedRevenue: 1200,
    couponUsedCount: 4,
    previousCouponUsedCount: 8,
  });
  assert.equal(metrics.campaign_conversion_rate.current, 8);
  assert.equal(metrics.attributed_revenue.current, 800);
  assert.equal(metrics.coupon_used_count.changeRate, -50);
});

test('campaign_conversion_rate down infers marketing_conversion_weak', () => {
  const insights = inferIssuesFromMetrics({
    campaign_conversion_rate: { current: 8, previous: 16, changeRate: -50 },
  });
  assert.equal(insights[0].issueId, 'marketing_conversion_weak');
});

test('insufficient attribution data returns insufficient_data metrics status', () => {
  const metrics = buildMarketingAttributionMetricsInput({ conversionRate: 0.08 });
  assert.equal(metrics.ontologyStatus, 'insufficient_data');
});
