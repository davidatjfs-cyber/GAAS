/**
 * agent-data-center 纯逻辑 + 解析路径单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEF_ROLES,
  DASHBOARD_ROLES,
  shanghaiYmd,
  resolveActivitySummaryDate,
  clampLimit,
  mergeAdminAlerts,
  buildDashboardPayload,
  resolveFeishuUserFromQuery,
  getScoreProvenance,
  resolvePeriodYm,
  monthBoundsFromPeriod,
  parseRollupBreakdown,
  computeMonthBiDeducted,
  getEmployeeLiveDashboard,
} from '../domains/agent-data-center/service.js';

test('role lists are non-empty and brief ⊆ dashboard-ish', () => {
  assert.ok(DASHBOARD_ROLES.includes('admin'));
  assert.ok(BRIEF_ROLES.every((r) => typeof r === 'string'));
  assert.ok(BRIEF_ROLES.includes('hr_manager'));
});

test('shanghaiYmd returns YYYY-MM-DD', () => {
  assert.match(shanghaiYmd(new Date('2026-07-24T16:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('resolveActivitySummaryDate prefers valid query date', () => {
  assert.equal(resolveActivitySummaryDate('2026-07-01', '2026-07-25'), '2026-07-01');
  assert.equal(resolveActivitySummaryDate('bad', '2026-07-25'), '2026-07-25');
  assert.equal(resolveActivitySummaryDate('', '2026-07-25'), '2026-07-25');
});

test('clampLimit bounds', () => {
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(100), 60);
  assert.equal(clampLimit('x'), 30);
  assert.equal(clampLimit(12), 12);
});

test('mergeAdminAlerts sorts by sent_at desc and truncates', () => {
  const merged = mergeAdminAlerts(
    [{ id: 1, sent_at: '2026-07-01T10:00:00Z' }],
    [
      { id: 2, sent_at: '2026-07-02T10:00:00Z' },
      { id: 3, sent_at: '2026-06-01T10:00:00Z' },
    ],
    2
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 2);
  assert.equal(merged[1].id, 1);
});

test('buildDashboardPayload flattens counters', () => {
  const p = buildDashboardPayload({
    issues: { open: '3', high_open: '1' },
    scores: { total: '10', avg_score: '88.5' },
    audits: { total: '2', failed: '1' },
    messages: { total: '7' },
    feishuUsers: { total: '5', registered: '4' },
    generic: { total: '9' },
    performance: { uptime: 1 },
  });
  assert.equal(p.openIssues, 3);
  assert.equal(p.avgScore, 88.5);
  assert.equal(p.messages.total_7d, 7);
  assert.equal(p.performance.uptime, 1);
  assert.equal(p.totalGenericRecords, 9);
});

function mockFeishuPool(rowsBySql) {
  return {
    async query(sql, params) {
      const s = String(sql);
      for (const [needle, rowsOrFn] of rowsBySql) {
        if (s.includes(needle)) {
          const rows = typeof rowsOrFn === 'function' ? rowsOrFn(params) : rowsOrFn;
          return { rows };
        }
      }
      return { rows: [] };
    },
  };
}

test('resolveFeishuUserFromQuery: by username', async () => {
  const pool = mockFeishuPool([
    ['LOWER(TRIM(username))', [{ username: 'alice', disp: 'Alice' }]],
  ]);
  const r = await resolveFeishuUserFromQuery(pool, 'alice');
  assert.equal(r.ok, true);
  assert.equal(r.username, 'alice');
});

test('resolveFeishuUserFromQuery: ambiguous exact name', async () => {
  const pool = mockFeishuPool([
    ['LOWER(TRIM(username))', []],
    [
      'TRIM(name) = $1',
      [
        { username: 'a1', disp: '王芳' },
        { username: 'a2', disp: '王芳' },
      ],
    ],
  ]);
  const r = await resolveFeishuUserFromQuery(pool, '王芳');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ambiguous_name');
});

test('resolveFeishuUserFromQuery: not_found', async () => {
  const pool = mockFeishuPool([
    ['LOWER(TRIM(username))', []],
    ['TRIM(name) = $1', []],
    ['name ILIKE', []],
  ]);
  const r = await resolveFeishuUserFromQuery(pool, 'nobody');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('getScoreProvenance: empty query → 400', async () => {
  const r = await getScoreProvenance({ query: async () => ({ rows: [] }) }, { query: '' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('getScoreProvenance: happy path returns scores + notifications', async () => {
  const pool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('LOWER(TRIM(username)) = LOWER(TRIM($1))') && s.includes('FROM feishu_users')) {
        return { rows: [{ username: 'bob', disp: 'Bob' }] };
      }
      if (s.includes('FROM agent_scores')) {
        return { rows: [{ period: '2026-07', total_score: 90 }] };
      }
      if (s.includes('FROM hrms_user_notifications')) {
        return { rows: [{ title: '扣分', type: 'score' }] };
      }
      return { rows: [] };
    },
  };
  const r = await getScoreProvenance(pool, { query: 'bob', tenantId: 'default', limit: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.body.username, 'bob');
  assert.equal(r.body.scores.length, 1);
  assert.equal(r.body.notifications.length, 1);
});

test('resolvePeriodYm / monthBoundsFromPeriod', () => {
  assert.equal(resolvePeriodYm('2026-06', '2026-07-25'), '2026-06');
  assert.equal(resolvePeriodYm('bad', '2026-07-25'), '2026-07');
  const b = monthBoundsFromPeriod('2026-02');
  assert.equal(b.monthStart, '2026-02-01');
  assert.equal(b.monthEnd, '2026-02-28');
  assert.equal(b.monthKey, '202602');
});

test('parseRollupBreakdown + computeMonthBiDeducted', () => {
  assert.deepEqual(parseRollupBreakdown('{"本月累计扣分":3}'), { 本月累计扣分: 3 });
  assert.equal(
    computeMonthBiDeducted({ breakdown: { 本月累计扣分: 5 } }, [{ breakdown: { 本周扣分: 9 } }]),
    5
  );
  assert.equal(
    computeMonthBiDeducted({ breakdown: {} }, [
      { breakdown: { 本周扣分: 2 } },
      { breakdown: { 本周扣分: 3 } },
    ]),
    5
  );
  assert.equal(computeMonthBiDeducted(null, []), 0);
});

test('getEmployeeLiveDashboard: uses 本月累计扣分 and filings', async () => {
  const pool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('FROM feishu_users') && s.includes('LOWER(TRIM(username))')) {
        if (s.includes('SELECT store, role')) {
          return { rows: [{ store: '洪潮', role: '店长' }] };
        }
        return { rows: [{ username: 'carol', disp: 'Carol' }] };
      }
      if (s.includes('FROM agent_scores') && s.includes('ORDER BY updated_at DESC') && s.includes('LIMIT 1')) {
        if (s.includes('total_score, breakdown')) {
          return {
            rows: [{ total_score: 95, breakdown: { 本月累计扣分: 4 }, period: 'week_2026-07-01' }],
          };
        }
        return { rows: [{ period: 'week_2026-07-01', total_score: 96 }] };
      }
      if (s.includes('FROM employee_scores')) {
        return { rows: [{ total_score: 88 }] };
      }
      if (s.includes('FROM ops_tasks')) return { rows: [{ cnt: 2 }] };
      if (s.includes('FROM master_tasks')) return { rows: [{ cnt: 1 }] };
      return { rows: [] };
    },
  };
  const r = await getEmployeeLiveDashboard(pool, {
    query: 'carol',
    period: '2026-07',
    tenantId: 'default',
  });
  assert.equal(r.ok, true);
  assert.equal(r.body.month_bi_deducted_total, 4);
  assert.equal(r.body.latest_performance_score, 96);
  assert.equal(r.body.store, '洪潮');
  assert.equal(r.body.execution_filing_count, 2);
  assert.equal(r.body.attitude_filing_count, 1);
});
