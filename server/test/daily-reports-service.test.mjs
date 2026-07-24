import test from 'node:test';
import assert from 'node:assert/strict';
import {
  queryPrivateRoomMonthTotal,
  deleteDailyReportFromState,
  syncSubmittedDailyReportsToPg,
} from '../domains/daily-reports/service.js';

test('queryPrivateRoomMonthTotal returns 0 when store or month empty', async () => {
  const queries = [];
  const pool = {
    query: async (...a) => {
      queries.push(a);
      return { rows: [{ total: 99 }] };
    },
  };
  const expandAgentStoreLabels = (s) => [s];

  assert.deepEqual(
    await queryPrivateRoomMonthTotal({ pool, store: '', month: '2026-07', tenantId: 'default', expandAgentStoreLabels }),
    { total: 0 }
  );
  assert.deepEqual(
    await queryPrivateRoomMonthTotal({ pool, store: '测试店', month: '', tenantId: 'default', expandAgentStoreLabels }),
    { total: 0 }
  );
  assert.equal(queries.length, 0);
});

test('queryPrivateRoomMonthTotal exact match then ILIKE fallback', async () => {
  const calls = [];
  const pool = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (calls.length === 1) return { rows: [{ total: 0 }] };
      return { rows: [{ total: 12 }] };
    },
  };
  const expandAgentStoreLabels = (s) => [s, `${s}别名`];

  const out = await queryPrivateRoomMonthTotal({
    pool,
    store: '洪潮店',
    month: '2026-07',
    tenantId: 'default',
    expandAgentStoreLabels,
  });

  assert.equal(out.total, 12);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /TRIM\(store\) = ANY/i);
  assert.match(calls[1].sql, /ILIKE ANY/i);
  assert.deepEqual(calls[0].args, ['2026-07', ['洪潮店', '洪潮店别名'], 'default']);
});

test('deleteDailyReportFromState filters list and calls merge', async () => {
  const merges = [];
  const state = {
    dailyReports: [
      { store: 'A店', date: '2026-07-01', id: 'keep1' },
      { store: 'B店', date: '2026-07-01', id: 'remove' },
      { store: 'A店', date: '2026-07-02', id: 'keep2' },
    ],
  };

  const result = await deleteDailyReportFromState({
    store: 'B店',
    date: '2026-07-01',
    getSharedState: async () => state,
    mergeSharedStateFields: async (patch, keys) => {
      merges.push({ patch, keys });
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(merges.length, 1);
  assert.equal(merges[0].patch.dailyReports.length, 2);
  assert.ok(merges[0].patch.dailyReports.every((r) => !(r.store === 'B店' && r.date === '2026-07-01')));
  assert.deepEqual(merges[0].keys, { dailyReports: ['store', 'date'] });
});

test('deleteDailyReportFromState returns state_merge_failed on merge error', async () => {
  const result = await deleteDailyReportFromState({
    store: 'A店',
    date: '2026-07-01',
    getSharedState: async () => ({ dailyReports: [] }),
    mergeSharedStateFields: async () => {
      throw new Error('merge boom');
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.equal(result.error, 'state_merge_failed');
  assert.equal(result.message, 'merge boom');
});

test('syncSubmittedDailyReportsToPg only upserts submitted matching date', async () => {
  const upserts = [];
  const state = {
    dailyReports: [
      { store: 'A店', date: '2026-07-01', submitted: true, data: {} },
      { store: 'B店', date: '2026-07-01', submittedAt: '2026-07-01T10:00:00+08:00', data: {} },
      { store: 'A店', date: '2026-07-02', submitted: true, data: {} },
      { store: 'C店', date: '2026-07-01', data: {} },
    ],
  };

  const out = await syncSubmittedDailyReportsToPg({
    date: '2026-07-01',
    storeFilter: 'A店',
    tenantId: 'default',
    getSharedState: async () => state,
    safeDateOnly: (d) => String(d || '').slice(0, 10),
    upsertDailyReportPgFromStateReport: async (dr, tenantId) => {
      upserts.push({ dr, tenantId });
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.equal(out.ok, true);
  assert.equal(out.date, '2026-07-01');
  assert.equal(out.storeFilter, 'A店');
  assert.equal(out.matched, 1);
  assert.equal(out.results.length, 1);
  assert.deepEqual(out.results[0], { store: 'A店', date: '2026-07-01', ok: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].dr.store, 'A店');
  assert.equal(upserts[0].tenantId, 'default');
});

test('syncSubmittedDailyReportsToPg records upsert failures', async () => {
  const out = await syncSubmittedDailyReportsToPg({
    date: '2026-07-01',
    storeFilter: '',
    tenantId: 'default',
    getSharedState: async () => ({
      dailyReports: [{ store: 'X店', date: '2026-07-01', submitted: true }],
    }),
    safeDateOnly: (d) => String(d || '').slice(0, 10),
    upsertDailyReportPgFromStateReport: async () => {
      throw new Error('pg fail');
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.equal(out.matched, 1);
  assert.deepEqual(out.results[0], { store: 'X店', date: '2026-07-01', ok: false, error: 'pg fail' });
});
