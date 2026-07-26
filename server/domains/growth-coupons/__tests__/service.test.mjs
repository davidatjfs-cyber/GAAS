import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertGrowthCoupon } from '../service.js';

test('upsertGrowthCoupon: stock 缺失时用 -1，不传 NaN', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ coupon_id: params[0], stock: params[6] }] };
    },
  };
  const row = await upsertGrowthCoupon(pool, 'default', {
    coupon_id: 'c1',
    name: '测试',
    // stock 故意省略
  });
  assert.equal(calls[0].params[6], -1);
  assert.equal(row.stock, -1);
});

test('upsertGrowthCoupon: stock 非法字符串也回落 -1', async () => {
  const pool = {
    async query(_sql, params) {
      return { rows: [{ stock: params[6] }] };
    },
  };
  const row = await upsertGrowthCoupon(pool, 'default', { coupon_id: 'c2', name: 'x', stock: 'abc' });
  assert.equal(row.stock, -1);
});
