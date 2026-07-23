import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSyncFailure } from '../domains/growth-sync-failures/routes.js';
import {
  importWechatCustomersFromFeishu,
  importWechatCustomersManual,
} from '../domains/growth-wechat-work/service.js';
import {
  listStoreRankings,
  patchCampaignPlanStatus,
  upsertCampaignPlan,
} from '../domains/growth-campaigns/service.js';
import {
  listChannelEffects,
  upsertContentCalendarItem,
} from '../domains/growth-content-calendar/service.js';
import {
  listCustomerOrders,
  listHardcodedGrowthStores,
  listPosOrderItems,
  listPosOrders,
} from '../domains/growth-pos/service.js';

test('recordSyncFailure: 写入参数裁剪与 JSON payload', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await recordSyncFailure(pool, 'default', {
    source: 'x'.repeat(100),
    event_type: 'scan',
    payload: { a: 1 },
    error_message: 'boom',
  });
  assert.equal(calls[0].params[0].length, 80);
  assert.equal(calls[0].params[1], 'scan');
  assert.equal(calls[0].params[2], JSON.stringify({ a: 1 }));
  assert.equal(calls[0].params[4], 'default');
});

test('importWechatCustomersFromFeishu: 缺 token 抛 bad_request', async () => {
  await assert.rejects(
    () => importWechatCustomersFromFeishu({}, async () => 'default', async () => ({}), {}),
    (e) => e?.code === 'bad_request'
  );
});

test('importWechatCustomersManual: 无手机号跳过', async () => {
  const pool = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };
  const r = await importWechatCustomersManual(pool, async () => 'default', [{ name: '无手机' }]);
  assert.equal(r.imported, 0);
});

test('upsertCampaignPlan: coupon/budget 非法回落 0', async () => {
  const pool = {
    async query(_sql, params) {
      return {
        rows: [{ plan_id: params[0], coupon_value_fen: params[7], budget_fen: params[8], status: params[9] }],
      };
    },
  };
  const row = await upsertCampaignPlan(pool, 'default', {
    plan_id: 'p1',
    coupon_value_fen: 'x',
    budget_fen: -9,
  });
  assert.equal(row.coupon_value_fen, 0);
  assert.equal(row.budget_fen, 0);
  assert.equal(row.status, 'draft');
});

test('patchCampaignPlanStatus: invalid_status / not_found', async () => {
  await assert.rejects(
    () => patchCampaignPlanStatus({}, 'default', { id: 'x', status: 'nope' }, { executeGrowthActionRecord: async () => null }),
    (e) => e?.code === 'invalid_status'
  );
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  await assert.rejects(
    () =>
      patchCampaignPlanStatus(pool, 'default', { id: 'missing', status: 'draft' }, {
        executeGrowthActionRecord: async () => null,
      }),
    (e) => e?.code === 'not_found'
  );
});

test('patchCampaignPlanStatus: draft→active 会调用 executeGrowthActionRecord', async () => {
  let executed = false;
  const plan = {
    plan_id: 'p1',
    campaign_id: 'c1',
    store_id: 's1',
    title: '测',
    status: 'draft',
    channel: 'miniprogram',
    target_audience: 'all',
    budget_fen: 100,
    coupon_value_fen: 50,
    created_by: 'admin',
  };
  let step = 0;
  const pool = {
    async query(sql) {
      step += 1;
      if (step === 1) return { rows: [plan] };
      if (sql.includes('UPDATE growth_campaign_plans')) return { rows: [{ ...plan, status: 'active' }] };
      return { rows: [] };
    },
  };
  const result = await patchCampaignPlanStatus(
    pool,
    'default',
    { id: 'p1', status: 'active', authUser: { username: 'u1', role: 'admin' } },
    {
      executeGrowthActionRecord: async () => {
        executed = true;
        return { ok: true };
      },
    }
  );
  assert.equal(executed, true);
  assert.equal(result.plan.status, 'active');
  assert.deepEqual(result.execution, { ok: true });
});

test('listStoreRankings: days 夹到 1..90', async () => {
  const calls = [];
  const pool = {
    async query(_sql, params) {
      calls.push(params);
      return { rows: [{ store_id: 's1', revenue_fen: 10, scan_count: 1 }] };
    },
  };
  const rankings = await listStoreRankings(pool, 999);
  assert.equal(calls[0][0], 90);
  assert.equal(rankings[0].rank, 1);
});

test('upsertContentCalendarItem: 缺 publish_date 用今天，status 默认 draft', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const pool = {
    async query(_sql, params) {
      return { rows: [{ item_id: params[0], publish_date: params[3], status: params[10] }] };
    },
  };
  const row = await upsertContentCalendarItem(pool, 'default', { item_id: 'i1', title: 't' });
  assert.equal(row.publish_date, today);
  assert.equal(row.status, 'draft');
});

test('listChannelEffects: days 夹到 1..365', async () => {
  const calls = [];
  const pool = {
    async query(_sql, params) {
      calls.push(params);
      return { rows: [{ channel: 'xhs', total_items: 1 }] };
    },
  };
  await listChannelEffects(pool, 9999);
  assert.equal(calls[0][0], 365);
});

test('listPosOrderItems / listCustomerOrders: 缺参 bad_request', async () => {
  await assert.rejects(() => listPosOrderItems({}, ''), (e) => e?.code === 'bad_request');
  await assert.rejects(() => listCustomerOrders({}, {}), (e) => e?.code === 'bad_request');
});

test('listPosOrders: limit 夹到 1000，条件拼装', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await listPosOrders(pool, { store_id: 's1', phone: '138', limit: 5000 });
  assert.ok(calls[0].sql.includes('store_id=$1'));
  assert.ok(calls[0].sql.includes('phone=$2'));
  assert.equal(calls[0].params[2], 1000);
});

test('listHardcodedGrowthStores: 两店固定', () => {
  const stores = listHardcodedGrowthStores();
  assert.equal(stores.length, 2);
  assert.equal(stores[0].store_id, '64822111');
});
