import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchDataIntegrationSnapshot,
  buildDataIntegrationIssues,
  runCheckDataIntegration,
} from '../check-data-integration-helpers.js';

const STATUS = {
  ok: '正常',
  abnormal: '异常',
  missing: '缺失',
  delayed: '延迟',
  pending: '待配置',
};

function n(v) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function pct(ok, total) {
  if (n(total) <= 0) return 0;
  return Math.round((n(ok) / n(total)) * 100);
}

function previousDate(date) {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function issue(fields) {
  return { ...fields, evidence: fields.evidence || {} };
}

function makeQueryIfTable(responses) {
  return async (_pool, table) => responses[table] || { exists: false, rows: [], evidence: {} };
}

test('fetchDataIntegrationSnapshot queries all tables', async () => {
  const calls = [];
  const queryIfTable = async (_pool, table, _sql, params) => {
    calls.push({ table, params });
    return { exists: true, rows: [{}], evidence: { table_exists: true } };
  };
  const snapshot = await fetchDataIntegrationSnapshot(
    {},
    { tenantId: 't1', date: '2026-07-26' },
    [{ store_id: 's1', store_name: '店A' }],
    {
      queryIfTable,
      previousDate,
      storeFilterValues: () => ['s1', '店A'],
      storeFilterPatterns: () => ['%店A%'],
    }
  );
  assert.equal(calls.length, 5);
  assert.ok(snapshot.yesterday);
  assert.equal(snapshot.storeValues.length, 2);
});

test('buildDataIntegrationIssues: healthy POS + attributability', () => {
  const snapshot = {
    yesterday: '2026-07-25',
    posR: {
      exists: true,
      rows: [{ total: 1000, yesterday_total: 50, latest_date: '2026-07-25', phone_rows: 100, rows_with_phone: 80, dish_rows: 20, categorized_dish_rows: 18 }],
      evidence: {},
    },
    customerR: { exists: true, rows: [{ total: 200, updated_7d: 10 }], evidence: {} },
    customerOpsR: { exists: true, rows: [{ total: 50, updated_7d: 5 }], evidence: {} },
    attributabilityR: {
      exists: true,
      rows: [{ total: 500, with_phone: 400, with_customer_id: 350, with_coupon_id: 20 }],
      evidence: {},
    },
    briefingR: {
      exists: true,
      rows: [{ today_ok: 1, yesterday_ok: 0, latest_sent_at: '2026-07-26T07:30:00' }],
      evidence: {},
    },
  };
  const issues = buildDataIntegrationIssues(snapshot, { issue, STATUS, n, pct });
  assert.equal(issues.length, 9);
  const posOk = issues.find((x) => x.item_key === 'pos_data_connected');
  assert.equal(posOk.status, STATUS.ok);
  const phoneOk = issues.find((x) => x.item_key === 'order_phone_complete_rate');
  assert.equal(phoneOk.status, STATUS.ok);
  const briefingOk = issues.find((x) => x.item_key === 'morning_briefing_delivered');
  assert.equal(briefingOk.status, STATUS.ok);
});

test('buildDataIntegrationIssues: missing tables → pending', () => {
  const snapshot = {
    yesterday: '2026-07-25',
    posR: { exists: false, rows: [], evidence: { table_missing: 'pos_order_items' } },
    customerR: { exists: false, rows: [], evidence: {} },
    customerOpsR: { exists: false, rows: [], evidence: {} },
    attributabilityR: { exists: false, rows: [], evidence: {} },
    briefingR: { exists: false, rows: [], evidence: {} },
  };
  const issues = buildDataIntegrationIssues(snapshot, { issue, STATUS, n, pct });
  assert.ok(issues.every((x) => x.status === STATUS.pending || x.item_key === 'order_coupon_id_complete_rate'));
});

test('buildDataIntegrationIssues: low phone rate → abnormal P2', () => {
  const snapshot = {
    yesterday: '2026-07-25',
    posR: {
      exists: true,
      rows: [{ total: 100, yesterday_total: 10, phone_rows: 100, rows_with_phone: 10, dish_rows: 10, categorized_dish_rows: 10 }],
      evidence: {},
    },
    customerR: { exists: true, rows: [{ total: 0 }], evidence: {} },
    customerOpsR: { exists: false, rows: [], evidence: {} },
    attributabilityR: {
      exists: true,
      rows: [{ total: 100, with_phone: 10, with_customer_id: 5, with_coupon_id: 0 }],
      evidence: {},
    },
    briefingR: { exists: true, rows: [{ today_ok: 0, yesterday_ok: 0 }], evidence: {} },
  };
  const issues = buildDataIntegrationIssues(snapshot, { issue, STATUS, n, pct });
  const phone = issues.find((x) => x.item_key === 'order_phone_complete_rate');
  assert.equal(phone.status, STATUS.abnormal);
  assert.equal(phone.severity, 'P2');
  const briefing = issues.find((x) => x.item_key === 'morning_briefing_delivered');
  assert.equal(briefing.status, STATUS.delayed);
  assert.equal(briefing.severity, 'P1');
});

test('buildDataIntegrationIssues: zero POS total → missing P0', () => {
  const snapshot = {
    yesterday: '2026-07-25',
    posR: { exists: true, rows: [{ total: 0, yesterday_total: 0, phone_rows: 0, rows_with_phone: 0, dish_rows: 0, categorized_dish_rows: 0 }], evidence: {} },
    customerR: { exists: true, rows: [{ total: 0 }], evidence: {} },
    customerOpsR: { exists: false, rows: [], evidence: {} },
    attributabilityR: { exists: true, rows: [{ total: 0, with_phone: 0, with_customer_id: 0, with_coupon_id: 0 }], evidence: {} },
    briefingR: { exists: true, rows: [{}], evidence: {} },
  };
  const issues = buildDataIntegrationIssues(snapshot, { issue, STATUS, n, pct });
  assert.equal(issues.find((x) => x.item_key === 'pos_data_connected').status, STATUS.missing);
  assert.equal(issues.find((x) => x.item_key === 'order_phone_complete_rate').status, STATUS.pending);
});

test('runCheckDataIntegration end-to-end with mocks', async () => {
  const queryIfTable = makeQueryIfTable({
    pos_order_items: {
      exists: true,
      rows: [{ total: 500, yesterday_total: 30, phone_rows: 200, rows_with_phone: 150, dish_rows: 40, categorized_dish_rows: 35 }],
      evidence: {},
    },
    growth_customer_profiles: { exists: true, rows: [{ total: 100, updated_7d: 20 }], evidence: {} },
    customer_ops_source_records: { exists: false, rows: [], evidence: {} },
    pos_orders: {
      exists: true,
      rows: [{ total: 300, with_phone: 200, with_customer_id: 180, with_coupon_id: 10 }],
      evidence: {},
    },
    agent_v2_morning_briefing_sends: {
      exists: true,
      rows: [{ today_ok: 0, yesterday_ok: 1, latest_sent_at: '2026-07-25T07:30:00' }],
      evidence: {},
    },
  });
  const issues = await runCheckDataIntegration(
    {},
    { tenantId: 'default', date: '2026-07-26' },
    [],
    {
      queryIfTable,
      issue,
      STATUS,
      previousDate,
      storeFilterValues: () => [],
      storeFilterPatterns: () => [],
      n,
      pct,
    }
  );
  assert.equal(issues.length, 9);
  assert.equal(issues.find((x) => x.item_key === 'yesterday_orders_synced').status, STATUS.ok);
});
