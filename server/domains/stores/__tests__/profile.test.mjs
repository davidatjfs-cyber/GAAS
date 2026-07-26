/**
 * domains/stores/profile.js 门店画像提取与 chairman_config 同步
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStoreProfileFields,
  syncStoreProfileToChairmanConfig,
} from '../profile.js';

test('extractStoreProfileFields：字符串/数组/数字/布尔与对象字段', () => {
  const out = extractStoreProfileFields({
    positioning: ' 正餐 ',
    targetCustomer: '家庭',
    peakHours: [' 11-13 ', '', '17-21'],
    seats: '40',
    tables: '',
    avgPrice: 88,
    area: null,
    hasTakeout: 1,
    target_daily_dineIn: { weekday: 100 },
    target_daily_takeout: 'bad',
    cost_structure: { food: 0.3 },
    topDishes: ['A'],
    problemDishes: 'nope',
  });
  assert.equal(out.positioning, '正餐');
  assert.equal(out.targetCustomer, '家庭');
  assert.deepEqual(out.peakHours, ['11-13', '17-21']);
  assert.equal(out.seats, 40);
  assert.equal(out.tables, undefined);
  assert.equal(out.avgPrice, 88);
  assert.equal(out.area, undefined);
  assert.equal(out.hasTakeout, true);
  assert.deepEqual(out.target_daily_dineIn, { weekday: 100 });
  assert.equal(out.target_daily_takeout, undefined);
  assert.deepEqual(out.cost_structure, { food: 0.3 });
  assert.deepEqual(out.topDishes, ['A']);
  assert.equal(out.problemDishes, undefined);
});

test('extractStoreProfileFields：空 body 默认值', () => {
  const out = extractStoreProfileFields();
  assert.equal(out.positioning, '');
  assert.deepEqual(out.peakHours, []);
  assert.equal(out.hasTakeout, false);
  assert.equal(out.seats, undefined);
});

test('syncStoreProfileToChairmanConfig：空店名跳过；合并写入；错误吞掉', async () => {
  const calls = [];
  await syncStoreProfileToChairmanConfig(
    { query: async () => { calls.push('q'); return { rows: [] }; } },
    '',
    '品牌',
    { positioning: 'x' }
  );
  assert.equal(calls.length, 0);

  const writes = [];
  const pool = {
    query: async (sql, params) => {
      if (/SELECT data FROM hrms_state/i.test(sql)) {
        return {
          rows: [{
            data: {
              stores: {
                洪潮大宁久光店: { brand: '旧品牌', positioning: '旧' },
              },
            },
          }],
        };
      }
      writes.push({ sql, params });
      return { rowCount: 1 };
    },
  };
  await syncStoreProfileToChairmanConfig(pool, '洪潮大宁久光店', '洪潮', {
    positioning: '新定位',
    seats: 50,
  });
  assert.equal(writes.length, 1);
  const saved = JSON.parse(writes[0].params[0]);
  assert.equal(saved.stores['洪潮大宁久光店'].brand, '洪潮');
  assert.equal(saved.stores['洪潮大宁久光店'].positioning, '新定位');
  assert.equal(saved.stores['洪潮大宁久光店'].seats, 50);

  const boom = {
    query: async () => {
      throw new Error('db down');
    },
  };
  await assert.doesNotReject(() =>
    syncStoreProfileToChairmanConfig(boom, '店A', '品牌', { positioning: 'y' })
  );
});
