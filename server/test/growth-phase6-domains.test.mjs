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
  listContentSuggestions,
  safeDateOnly as contentSafeDateOnly,
  upsertContentPerformance,
} from '../domains/growth-content/service.js';
import {
  listCustomerOrders,
  listHardcodedGrowthStores,
  listPosOrderItems,
  listPosOrders,
} from '../domains/growth-pos/service.js';
import { getPosStats, parsePosStatsQuery } from '../domains/growth-pos/stats-service.js';
import { clampSnapshotDays } from '../domains/growth-pos/ingest.js';
import { savePosFeishuConfig } from '../domains/growth-pos/feishu-service.js';
import {
  computeChurnScores,
  listChurnPredictions,
  safeDateOnly,
} from '../domains/growth-churn/service.js';
import { safeMonthOnly } from '../domains/growth-menu-health/service.js';

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

test('listContentSuggestions: limit 夹到 1..50', async () => {
  const calls = [];
  const pool = {
    async query(_sql, params) {
      calls.push(params);
      return { rows: [{ id: 1 }] };
    },
  };
  await listContentSuggestions(pool, 'default', { storeCode: 's1', limit: 999 });
  assert.equal(calls[0][0], 's1');
  assert.equal(calls[0][3], 50);
});

test('content safeDateOnly: 非法日期回落空串', () => {
  assert.equal(contentSafeDateOnly(''), '');
  assert.equal(contentSafeDateOnly('bad'), '');
  assert.equal(contentSafeDateOnly('2026-07-23'), '2026-07-23');
});

test('upsertContentPerformance: 负 impressions 回落 0', async () => {
  const pool = {
    async query(_sql, params) {
      return { rows: [{ id: 1, impressions: params[11], winning_value: '' }] };
    },
  };
  const row = await upsertContentPerformance(pool, 'default', { impressions: -5, clicks: -1 }, 'u1');
  assert.equal(row.impressions, 0);
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

test('safeDateOnly: 非法日期回落空串', () => {
  assert.equal(safeDateOnly(''), '');
  assert.equal(safeDateOnly('not-a-date'), '');
  assert.equal(safeDateOnly('2026-07-23'), '2026-07-23');
});

test('listChurnPredictions: limit 夹到 1..1000', async () => {
  const calls = [];
  const pool = {
    async query(_sql, params) {
      calls.push(params);
      return { rows: [{ risk_level: 'high' }, { risk_level: 'low' }] };
    },
  };
  const result = await listChurnPredictions(pool, { limit: 9999, predDate: 'bad-date' });
  assert.equal(calls[0][3], 1000);
  assert.equal(calls[0][2], '');
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.high, 1);
});

test('computeChurnScores: mock pool 空结果', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('WITH customer_visits')) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await computeChurnScores(pool, 's1', 'default');
  assert.deepEqual(result, { total: 0, saved: 0, high_risk: 0 });
});

test('computeChurnScores: 高风险客户 upsert', async () => {
  const inserts = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes('WITH customer_visits')) {
        return {
          rows: [{
            customer_id: 1,
            phone: '13800000000',
            customer_name: '张三',
            store_code: 's1',
            days_since_last: 90,
            avg_cycle_days: 30,
            spend_30d: 10,
            spend_30_60d: 100,
            visits_30d: 0,
            visits_30_60d: 2,
          }],
        };
      }
      if (sql.includes('INSERT INTO growth_churn_predictions')) {
        inserts.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const result = await computeChurnScores(pool, 's1', 'default');
  assert.equal(result.total, 1);
  assert.equal(result.high_risk, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][6], 'high');
});

test('safeMonthOnly: 非法月份回落空串', () => {
  assert.equal(safeMonthOnly(''), '');
  assert.equal(safeMonthOnly('not-a-month'), '');
  assert.equal(safeMonthOnly('2026-07'), '2026-07');
});

test('parsePosStatsQuery: days 夹到 1..365', () => {
  assert.equal(parsePosStatsQuery({ days: 9999 }).days, 365);
  assert.equal(parsePosStatsQuery({ days: -5 }).days, 1);
  assert.equal(parsePosStatsQuery({}).days, 30);
});

test('getPosStats: campaign_id 分支返回 campaign 结构', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ total_orders: 0, distinct_phones: 0 }] };
    },
  };
  const payload = await getPosStats(pool, { campaign_id: 'c1', days: 7, store_id: 's1' });
  assert.equal(payload.ok, true);
  assert.equal(payload.summary.data_source, 'campaign_pos_orders');
  assert.deepEqual(payload.hourDist, []);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].params[1], 7);
  assert.equal(calls[0].params[2], 'c1');
});

test('getPosStats: 默认分支 days 夹到 365', async () => {
  const calls = [];
  const pool = {
    async query(_sql, params) {
      calls.push(params);
      return { rows: [{}] };
    },
  };
  await getPosStats(pool, { days: 5000 });
  assert.equal(calls[0][1], 365);
});

test('savePosFeishuConfig: 缺 orders token 抛 bad_request', async () => {
  await assert.rejects(
    () => savePosFeishuConfig({ async query() {} }, { items_app_token: 'x' }),
    (e) => e?.code === 'bad_request'
  );
});

test('clampSnapshotDays: 夹到 1..90', () => {
  assert.equal(clampSnapshotDays(999), 90);
  assert.equal(clampSnapshotDays(-5), 1);
  assert.equal(clampSnapshotDays(undefined), 7);
});
