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
