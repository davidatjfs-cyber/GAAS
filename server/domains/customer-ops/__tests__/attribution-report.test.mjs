import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleAttributionReport,
  attributionCostExpr,
  buildAttributionRecommendations,
  classifyAttributionAudience,
  friendlyAttributionTitle,
  maskAttributionPhone,
} from '../attribution-report.js';

test('maskAttributionPhone masks valid mobile numbers', () => {
  assert.equal(maskAttributionPhone('13812345678'), '138****5678');
  assert.equal(maskAttributionPhone('bad'), '');
});

test('classifyAttributionAudience + friendlyAttributionTitle', () => {
  assert.equal(classifyAttributionAudience({ campaign_type: 'VIP维护', target_audience: '', rule_key: '', title: '' }), '高价值客户');
  assert.equal(classifyAttributionAudience({ campaign_type: '自动营销', target_audience: '规则圈选', rule_key: 'auto_x', title: '' }), '自动营销客户');
  assert.equal(friendlyAttributionTitle('dormant'), '沉睡客户召回');
  assert.equal(friendlyAttributionTitle('unknown_title'), 'unknown_title');
});

test('attributionCostExpr only charges sms channel', () => {
  assert.match(attributionCostExpr('dl.channel'), /sms/);
  assert.match(attributionCostExpr('dl.channel'), /0\.05/);
});

test('buildAttributionRecommendations includes low return-rate warning', () => {
  const recs = buildAttributionRecommendations({
    customerTypeRows: [{ customer_type: '高价值客户', attributed_revenue: 5000 }],
    campaignRows: [{ title: '周末邀约', returned_customers: 2, attributed_revenue: 3000 }],
    touchedCustomers: 100,
    returnedCustomers: 3,
    discountAmount: 500,
  });
  assert.equal(recs.length, 7);
  assert.ok(recs.some(r => r.includes('回店率偏低')));
  assert.ok(recs.some(r => r.includes('高价值客户')));
});

test('assembleAttributionReport maps query rows into report shape', () => {
  const queryResults = [
    { rows: [{ touch_count: 10, touched_customers: 8, touch_cost: 0.5 }] },
    { rows: [{ attributed_orders: 3, returned_customers: 2, attributed_revenue: 1200, attributed_pre_discount_revenue: 1300, discount_amount: 100 }] },
    { rows: [{ title: 'dormant', campaign_type: '自动营销', target_audience: '沉睡召回', rule_key: 'dormant', channel: 'sms', touches: 5, touched_customers: 4, returned_customers: 2, attributed_orders: 2, attributed_revenue: 800, attributed_pre_discount_revenue: 900, discount_amount: 50, touch_cost: 0.25 }] },
    { rows: [{ store_id: '51866138', store_name: '马己仙', touches: 5, touched_customers: 4, touch_cost: 0.25, attributed_orders: 2, returned_customers: 2, attributed_revenue: 800, discount_amount: 50 }] },
    { rows: [{ campaign_type: '自动营销', target_audience: '沉睡召回', rule_key: 'dormant', title: 'dormant', returned_customers: 2, attributed_orders: 2, attributed_revenue: 800 }] },
    { rows: [{ day: '2026-07-20', touched_customers: 4, returned_customers: 2, attributed_orders: 2, attributed_revenue: 800 }] },
    { rows: [{ phone: '13812345678', store_name: '马己仙', store_id: '51866138', last_touch_date: '2026-07-18', last_order_date: '2026-07-20', attributed_orders: 1, attributed_revenue: 600 }] },
    { rows: [{ phone: '13812345678', biz_date: '2026-07-20', store_id: '51866138', store_name: '马己仙', table_no: 'A1', diners: 2, order_no: 'O1', revenue: 600, pre_discount_revenue: 650, discount_amount: 50 }] },
    { rows: [{ campaign_count: 1, suggested_customers: 20, manual_revenue: 0, manual_cost: 0 }] },
  ];

  const result = assembleAttributionReport({
    queryResults,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-25',
    storeId: '',
    storeFilter: { displayName: '全部门店' },
    windowDays: 14,
  });

  assert.equal(result.ok, true);
  assert.equal(result.report.summary.touched_customers, 8);
  assert.equal(result.report.summary.returned_customers, 2);
  assert.equal(result.report.by_campaign[0].title, '沉睡客户召回');
  assert.equal(result.report.top_customers[0].phone, '138****5678');
  assert.equal(result.report.order_records[0].order_no, 'O1');
});
