import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationRowToStateShape,
  hydrateNotificationsFromTable,
} from '../domains/notifications/service.js';
import {
  examResultRowToStateShape,
  hydrateExamResultsFromTable,
} from '../domains/exam-results/service.js';

test('notificationRowToStateShape 使用 targetUser', () => {
  const n = notificationRowToStateShape({
    id: '1',
    target_username: 'alice',
    title: 't',
    message: 'm',
    type: 'system',
    meta: { a: 1 },
    created_at: '2026-07-01T00:00:00.000Z',
  });
  assert.equal(n.targetUser, 'alice');
  assert.equal(n.title, 't');
});

test('hydrateNotificationsFromTable：表覆盖并保留孤立 state 项', async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            id: 'db1',
            target_username: 'bob',
            title: 'from-db',
            message: '',
            type: 'x',
            meta: {},
            created_at: '2026-07-02',
          },
        ],
      };
    },
  };
  const out = await hydrateNotificationsFromTable(
    pool,
    {
      notifications: [
        { id: 'db1', targetUser: 'stale', title: 'old' },
        { id: 'orphan', targetUser: 'carol', title: 'only-state' },
      ],
    },
    'default'
  );
  assert.equal(out.notifications.length, 2);
  assert.equal(out.notifications[0].id, 'db1');
  assert.equal(out.notifications[0].targetUser, 'bob');
  assert.equal(out.notifications[1].id, 'orphan');
});

test('examResultRowToStateShape 映射前端字段', () => {
  const r = examResultRowToStateShape({
    id: 9,
    assignment_id: 3,
    user_key: 'alice',
    created_at: '2026-07-01T12:00:00Z',
    started_at: null,
    submitted_at: '2026-07-01T12:05:00Z',
    time_used_seconds: 300,
    auto_submitted: false,
    set_index: 0,
    total: 10,
    correct: 8,
    score: 80,
    answers: [{ i: 0 }],
  });
  assert.equal(r.id, '9');
  assert.equal(r.user, 'alice');
  assert.equal(r.assignmentId, '3');
  assert.equal(r.score, 80);
});

test('hydrateExamResultsFromTable：表有数据时覆盖', async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            id: 'e1',
            assignment_id: null,
            user_key: 'u1',
            created_at: '2026-07-01T00:00:00Z',
            started_at: null,
            submitted_at: null,
            time_used_seconds: null,
            auto_submitted: false,
            set_index: null,
            total: 1,
            correct: 1,
            score: 100,
            answers: [],
          },
        ],
      };
    },
  };
  const out = await hydrateExamResultsFromTable(pool, { examResults: [{ id: 'stale' }] }, 'default');
  assert.equal(out.examResults.length, 1);
  assert.equal(out.examResults[0].id, 'e1');
  assert.equal(out.examResults[0].user, 'u1');
});
