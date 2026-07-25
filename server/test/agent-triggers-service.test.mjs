/**
 * agent-triggers 纯逻辑单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAuditMode,
  resolveStoreRatingsPeriod,
  maskTokenPreview,
  matchRouteKeywords,
  runManualAudit,
  runStoreRatingsRecalc,
  isTriggerAdminRole,
  isTriggerHqRole,
} from '../domains/agent-triggers/service.js';

test('role helpers', () => {
  assert.equal(isTriggerAdminRole('admin'), true);
  assert.equal(isTriggerAdminRole('hq_manager'), false);
  assert.equal(isTriggerHqRole('hq_manager'), true);
});

test('normalizeAuditMode', () => {
  assert.equal(normalizeAuditMode('daily'), 'daily');
  assert.equal(normalizeAuditMode('WEEKLY'), 'weekly');
  assert.equal(normalizeAuditMode(''), 'full');
  assert.equal(normalizeAuditMode('other'), 'full');
});

test('resolveStoreRatingsPeriod', () => {
  assert.equal(resolveStoreRatingsPeriod('2026-05'), '2026-05');
  assert.equal(resolveStoreRatingsPeriod('bad', new Date('2026-07-15T04:00:00Z')), '2026-07');
});

test('maskTokenPreview', () => {
  assert.equal(maskTokenPreview(''), null);
  assert.equal(maskTokenPreview('abcdefghijklmnop'), 'abcdefgh...mnop');
});

test('matchRouteKeywords', () => {
  const m = matchRouteKeywords('本周绩效分数和卫生检查');
  assert.ok(m.includes('eval:绩效'));
  assert.ok(m.includes('ops:卫生'));
});

test('runManualAudit full mode merges daily+weekly', async () => {
  const calls = [];
  const out = await runManualAudit({
    mode: 'full',
    tenantId: 't1',
    runDataAuditor: async (mode, tid) => {
      calls.push([mode, tid]);
      return { issuesCreated: mode === 'daily' ? 2 : 3, newIssueIds: [`${mode}-1`] };
    },
    pushIssuesToFeishu: async () => 9,
    syncDataAuditorIssuesToMasterTasks: async (ids) => ids.length,
  });
  assert.deepEqual(calls, [
    ['daily', 't1'],
    ['weekly', 't1'],
  ]);
  assert.equal(out.issuesCreated, 5);
  assert.deepEqual(out.newIssueIds, ['daily-1', 'weekly-1']);
  assert.equal(out.feishuPushed, 9);
  assert.equal(out.masterSynced, 2);
});

test('runStoreRatingsRecalc dedupes stores', async () => {
  const pool = {
    async query() {
      return {
        rows: [
          { store: '洪潮' },
          { store: '洪潮' },
          { store: '马己仙' },
        ],
      };
    },
  };
  const out = await runStoreRatingsRecalc(pool, {
    period: '2026-06',
    inferBrandFromStoreName: (s) => (s.includes('马') ? '马己仙' : '洪潮'),
    calculateStoreRating: async (store, brand, period) => ({
      rating: 'A',
      reason: 'ok',
      achievementRate: 1,
      actualRevenue: 1,
      targetRevenue: 1,
      store,
      brand,
      period,
    }),
  });
  assert.equal(out.count, 2);
  assert.equal(out.period, '2026-06');
});
