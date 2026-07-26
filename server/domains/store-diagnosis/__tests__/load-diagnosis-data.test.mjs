import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStoreDiagnosisData } from '../load-diagnosis-data.js';

test('loadStoreDiagnosisData aggregates parallel query results for 马己仙', async () => {
  let calls = 0;
  const pool = {
    query: async () => {
      calls += 1;
      return {
        rows: [
          {
            anomaly_key: 'x',
            total_visits: 10,
            issue_count: 2,
            dish: '烧鹅',
            n: 3,
            member_rev: 100,
            total_rev: 200,
            date: '2026-07-20',
            store: '马己仙上海音乐广场店',
          },
        ],
      };
    },
  };
  const data = await loadStoreDiagnosisData(
    pool,
    '马己仙上海音乐广场店',
    '2026-07-14',
    '2026-07-20'
  );
  assert.ok(calls >= 10);
  assert.equal(data.weekAgoStart, '2026-07-07');
  assert.equal(data.weekAgoEnd, '2026-07-13');
  assert.ok(Array.isArray(data.anomalies));
  assert.ok(Array.isArray(data.reports));
  assert.equal(data.tableVisitCurrent.total_visits, 10);
  assert.equal(data.topDissatisfiedDish.dish, '烧鹅');
  assert.equal(data.memberRevenueCurrent.member_rev, 100);
});

test('loadStoreDiagnosisData uses 洪潮 store filter branch', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const data = await loadStoreDiagnosisData(pool, '洪潮大宁久光中心店', '2026-07-01', '2026-07-07');
  assert.deepEqual(data.anomalies, []);
  assert.deepEqual(data.employees, []);
  assert.deepEqual(data.tableVisitCurrent, {});
  assert.equal(data.topDissatisfiedDish, null);
});

test('loadStoreDiagnosisData falls back to raw store name when brand unknown', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const data = await loadStoreDiagnosisData(pool, '未知门店A', '2026-07-01', '2026-07-02');
  assert.ok(data.weekAgoStart);
  assert.ok(Array.isArray(data.trainingStatus));
});
