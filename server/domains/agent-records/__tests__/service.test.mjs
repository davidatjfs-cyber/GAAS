/**
 * agent-records 过滤 / 等级合并 / 周期 / 我的绩效组装单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  letterGradeOnly,
  mergeProfileDim,
  shanghaiPrevCalendarYm,
  profilePerformanceDisplayPeriodShanghai,
  resolveScoresUsername,
  buildTenantScopedListFilter,
  resolveAgentIssue,
  createAppeal,
  getMyAgentScore,
} from '../service.js';

test('letterGradeOnly / mergeProfileDim', () => {
  assert.equal(letterGradeOnly('a'), 'A');
  assert.equal(letterGradeOnly('待定'), null);
  assert.equal(mergeProfileDim('B', '待定'), 'B');
  assert.equal(mergeProfileDim(null, '待定'), '待定');
  assert.equal(mergeProfileDim(null, 'C'), 'C');
});

test('resolveScoresUsername maps 马己仙观察号', () => {
  assert.equal(resolveScoresUsername('nnyxcs35', '马己仙总店'), 'NNYXLYR04');
  assert.equal(resolveScoresUsername('nnyxcs35', '洪潮'), 'nnyxcs35');
  assert.equal(resolveScoresUsername('alice', '马己仙'), 'alice');
});

test('profile period: before/after day 10 Shanghai', () => {
  // 2026-07-09 16:00 UTC = 2026-07-10 00:00 CST → day 10 → prev month
  const on10 = profilePerformanceDisplayPeriodShanghai(new Date('2026-07-09T16:00:00Z'));
  assert.equal(on10, '2026-06');
  // 2026-07-08 16:00 UTC = 2026-07-09 00:00 CST → day 9 → prev-prev
  const before10 = profilePerformanceDisplayPeriodShanghai(new Date('2026-07-08T16:00:00Z'));
  assert.equal(before10, '2026-05');
});

test('shanghaiPrevCalendarYm rolls year', () => {
  assert.equal(shanghaiPrevCalendarYm(new Date('2026-01-15T04:00:00Z')), '2025-12');
});

test('buildTenantScopedListFilter store-scopes managers', () => {
  const f = buildTenantScopedListFilter({
    role: 'store_manager',
    username: 'bob',
    tenantId: 't1',
    status: 'open',
    storeScopeColumn: 'assignee_username',
    limit: 10,
  });
  assert.match(f.whereSql, /assignee_username/);
  assert.match(f.whereSql, /status =/);
  assert.ok(f.params.includes('bob'));
  assert.ok(f.params.includes('t1'));
});

test('resolveAgentIssue / createAppeal validation', async () => {
  assert.equal((await resolveAgentIssue({}, { id: '' })).status, 400);
  assert.equal((await createAppeal({}, { username: '', reason: 'x' })).status, 400);
  let updated = false;
  const pool = {
    async query(sql) {
      if (String(sql).includes('UPDATE')) {
        updated = true;
        return { rows: [] };
      }
      if (String(sql).includes('INSERT')) return { rows: [{ id: 9 }] };
      return { rows: [] };
    },
  };
  assert.equal((await resolveAgentIssue(pool, { id: '1', resolution: 'ok' })).ok, true);
  assert.equal(updated, true);
  const created = await createAppeal(pool, { username: 'u', reason: 'r' });
  assert.equal(created.ok, true);
  assert.equal(created.id, 9);
});

test('getMyAgentScore happy path merges grades and store rating', async () => {
  const pool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('FROM feishu_users')) {
        return { rows: [{ store: '洪潮店' }] };
      }
      if (s.includes('FROM employee_scores')) {
        return {
          rows: [
            {
              total_score: 88,
              execution_rating: '待定',
              attitude_rating: 'B',
              ability_rating: null,
              store: '洪潮店',
            },
          ],
        };
      }
      if (s.includes('FROM agent_scores')) {
        return {
          rows: [
            {
              total_score: 90,
              breakdown: { execution_rating: 'A', ability_rating: 'C' },
              summary: 'ok',
              brand: '洪潮',
              store: '洪潮店',
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const r = await getMyAgentScore(pool, {
    username: 'alice',
    tenantId: 'default',
    now: new Date('2026-07-15T04:00:00Z'),
    getSharedState: async () => ({}),
    inferBrandFromStoreName: () => '洪潮',
    fetchStoreRatingForProfileDisplay: async () => ({
      rating: 'B',
      period: '2026-06',
      isFallback: false,
    }),
    calculateStoreRating: async () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.body.execution_rating, 'A');
  assert.equal(r.body.attitude_rating, 'B');
  assert.equal(r.body.ability_rating, 'C');
  assert.equal(r.body.store_rating, 'B');
  assert.equal(r.body.personalPerformanceDisplayPeriod, '2026-06');
  assert.equal(r.body.storeRatingDisplayPeriod, '2026-06');
});
