import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandKeyOf,
  lookupCost,
  median,
  nextTarget,
  normalizeBiz,
  normalizeDishName,
  quadrantsForChannel,
  summarizeCard,
  summarizeMetricForAnalysis,
} from '../metrics-helpers.js';

test('normalizeDishName strips brackets and punctuation', () => {
  assert.equal(normalizeDishName('【招牌】黑椒牛柳（大份）'), '黑椒牛柳');
  assert.equal(normalizeDishName(''), '');
});

test('normalizeBiz maps takeaway vs dinein', () => {
  assert.equal(normalizeBiz('外卖'), 'takeaway');
  assert.equal(normalizeBiz('Delivery'), 'takeaway');
  assert.equal(normalizeBiz('堂食'), 'dinein');
  assert.equal(normalizeBiz(''), 'dinein');
});

test('brandKeyOf extracts brand from store name', () => {
  assert.equal(brandKeyOf('马己仙南山店'), '马己仙');
  assert.equal(brandKeyOf('洪潮旗舰店'), '洪潮');
  assert.equal(brandKeyOf('其他店'), '其他店');
});

test('median handles odd/even/empty', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(median([NaN, 5]), 5);
});

test('lookupCost prefers biz-specific then any', () => {
  const costMap = {
    takeaway: new Map([['beef', 8]]),
    dinein: new Map([['beef', 12]]),
    any: new Map([['beef', 10]]),
  };
  assert.equal(lookupCost(costMap, 'takeaway', 'beef'), 8);
  assert.equal(lookupCost(costMap, 'dinein', 'beef'), 12);
  assert.equal(lookupCost(costMap, 'dinein', 'missing'), null);
  const fallback = { takeaway: new Map(), dinein: new Map(), any: new Map([['rice', 2]]) };
  assert.equal(lookupCost(fallback, 'dinein', 'rice'), 2);
});

test('nextTarget pct ladder steps toward cap', () => {
  assert.equal(nextTarget('revenue', 100000, 100000, []), 105000);
  assert.equal(nextTarget('revenue', 120000, 100000, []), null);
  assert.equal(nextTarget('staff_efficiency', 500, 500, []), 550);
});

test('nextTarget pp ladder adds percentage points', () => {
  assert.equal(nextTarget('gross_margin', 40, 40, []), 41);
  assert.equal(nextTarget('gross_margin', 43, 40, []), null);
});

test('nextTarget ladder type picks next step', () => {
  assert.equal(nextTarget('kitchen_standard', 75, 75, []), 80);
  assert.equal(nextTarget('kitchen_standard', 95, 75, []), null);
  assert.equal(nextTarget('training_replication', 45, 45, []), 50);
});

test('nextTarget count type caps per round', () => {
  assert.equal(nextTarget('menu_optimization', 12, 12, []), 5);
  assert.equal(nextTarget('menu_optimization', 3, 3, []), 3);
  assert.equal(nextTarget('menu_optimization', 0, 0, []), null);
});

test('quadrantsForChannel classifies within category medians', () => {
  const rows = [
    { dish: 'A', category: '主菜', qty: 100, profit: 200, margin: 50, biz: 'dinein' },
    { dish: 'B', category: '主菜', qty: 50, profit: 80, margin: 40, biz: 'dinein' },
    { dish: 'C', category: '主菜', qty: 20, profit: 300, margin: 60, biz: 'dinein' },
    { dish: 'D', category: '主菜', qty: 10, profit: 20, margin: 10, biz: 'dinein' },
  ];
  const q = quadrantsForChannel(rows);
  assert.equal(q.star.length, 1);
  assert.equal(q.star[0].dish, 'A');
  assert.equal(q.eliminate.length, 1);
  assert.equal(q.eliminate[0].dish, 'D');
  assert.ok(q.matched >= 4);
});

test('summarizeCard formats per problem key', () => {
  assert.match(
    summarizeCard('staff_efficiency', { value: 500, detail: { pre_discount_revenue: 10000, person_days: 20 } }),
    /折前营收 ¥10000 \/ 20 人天/
  );
  assert.match(
    summarizeCard('revenue', { value: 1, detail: { sleeping_customers: 5, sleeping_high: 2, sleeping_medium: 3 } }),
    /可召回沉睡池 5 位/
  );
  assert.equal(summarizeCard('unknown', { value: 1 }), '');
  assert.equal(summarizeCard('revenue', null), '');
});

test('summarizeMetricForAnalysis includes key detail fields', () => {
  const revenue = summarizeMetricForAnalysis('revenue', {
    value: 100000,
    detail: { days: 30, sleeping_customers: 10, sleeping_high: 4 },
  });
  assert.match(revenue, /近30天近30天营业额：100000元/);
  assert.match(revenue, /沉睡客户10人/);

  const menu = summarizeMetricForAnalysis('menu_optimization', {
    value: 3,
    detail: {
      complaint_dishes: [{ dish: '鱼香肉丝' }],
      quadrants: {
        dinein: { star: [1], traffic: [], potential: [], eliminate: [1, 2] },
        takeaway: { star: [], traffic: [1], potential: [], eliminate: [] },
      },
    },
  });
  assert.match(menu, /鱼香肉丝/);
  assert.match(menu, /淘汰2道/);
});
