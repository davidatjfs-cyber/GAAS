import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  cleanPhone,
  num,
  uniqueClean,
  sqlLikePattern,
  storeKeywordsFromName,
  posStoreFilterSql,
  resolveCustomerOpsStoreFilter,
  latestDiagnosis,
  safeReportQuery,
  saveCampaignResultAsLearning,
} from '../ops-helpers.js';

test('cleanText / cleanPhone / num basics', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.equal(cleanPhone('+86 138-0000-0000'), '13800000000');
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('x'), 0);
});

test('uniqueClean / sqlLikePattern / storeKeywordsFromName', () => {
  assert.deepEqual(uniqueClean(['a', ' a ', 'b', '']), ['a', 'b']);
  assert.equal(sqlLikePattern('洪潮'), '%洪潮%');
  assert.ok(Array.isArray(storeKeywordsFromName('年年有喜·洪潮店')));
});

test('posStoreFilterSql uses placeholders', () => {
  const sql = posStoreFilterSql('o');
  assert.match(sql, /\$3/);
  assert.match(sql, /o\./);
});

test('resolveCustomerOpsStoreFilter returns empty filter when no store id', async () => {
  const pool = { query: async () => { throw new Error('should not query'); } };
  const r = await resolveCustomerOpsStoreFilter(pool, 'default', '');
  assert.equal(r.requested, '');
  assert.equal(r.displayName, '全部门店');
  assert.deepEqual(r.posStoreIds, []);
});

test('resolveCustomerOpsStoreFilter resolves configured store id', async () => {
  const pool = {
    query: async (sql) => {
      if (/hrms_state/i.test(sql)) return { rows: [{ stores: [] }] };
      if (/pos_orders/i.test(sql)) {
        return { rows: [{ store_id: '64822111', store_name: '洪潮大宁久光店' }] };
      }
      return { rows: [] };
    },
  };
  const r = await resolveCustomerOpsStoreFilter(pool, 'default', '64822111');
  assert.equal(r.requested, '64822111');
  assert.ok(r.posStoreIds.includes('64822111'));
});

test('latestDiagnosis returns by id or latest row', async () => {
  const pool = {
    query: async (sql, params) => {
      if (/WHERE id = \$1/i.test(sql)) return { rows: [{ id: params[0], title: 'by-id' }] };
      return { rows: [{ id: 99, title: 'latest' }] };
    },
  };
  assert.equal((await latestDiagnosis(pool, 'default', 5)).title, 'by-id');
  assert.equal((await latestDiagnosis(pool, 'default')).title, 'latest');
});

test('safeReportQuery returns fallback on query failure', async () => {
  const rows = await safeReportQuery({ query: async () => { throw new Error('boom'); } }, 'SELECT 1', [], ['fb']);
  assert.deepEqual(rows, ['fb']);
});

test('saveCampaignResultAsLearning inserts learning row', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  await saveCampaignResultAsLearning(
    pool,
    'default',
    { id: 1, title: '测试活动', campaign_type: '会员', channel: 'sms' },
    { effect_rating: 'excellent', actual_send_count: 10, actual_redemption_count: 3, actual_revenue: 500, actual_cost: 100, store_id: 's1', store_name: '门店A' }
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO growth_learnings/i);
});

test('saveCampaignResultAsLearning no-ops without effect_rating', async () => {
  let called = false;
  await saveCampaignResultAsLearning({ query: async () => { called = true; } }, 'default', { id: 1 }, {});
  assert.equal(called, false);
});
