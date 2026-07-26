import test from 'node:test';
import assert from 'node:assert/strict';
import {
  examResultRowToStateShape,
  loadExamResultsFromTable,
  hydrateExamResultsFromTable,
} from '../service.js';

test('examResultRowToStateShape：空/缺 id/answers 形态', () => {
  assert.equal(examResultRowToStateShape(null), null);
  assert.equal(examResultRowToStateShape({ id: '' }), null);
  const row = examResultRowToStateShape({
    id: 'e1',
    assignment_id: 9,
    user_key: 'u1',
    created_at: '2026-07-01T00:00:00Z',
    started_at: null,
    submitted_at: '2026-07-01T01:00:00Z',
    time_used_seconds: '12',
    auto_submitted: 1,
    set_index: '2',
    total: '10',
    correct: '8',
    score: '80',
    answers: { q1: 'a' },
  });
  assert.equal(row.id, 'e1');
  assert.equal(row.assignmentId, '9');
  assert.equal(row.user, 'u1');
  assert.equal(row.autoSubmitted, true);
  assert.equal(row.setIndex, 2);
  assert.deepEqual(row.answers, { q1: 'a' });
  assert.ok(row.createdAt.includes('2026'));
  assert.equal(row.startedAt, null);
});

test('loadExamResultsFromTable：tenant 列失败回退无 tenant 查询', async () => {
  let n = 0;
  const pool = {
    async query(sql) {
      n += 1;
      if (n === 1) throw new Error('column tenant_id does not exist');
      assert.match(String(sql), /FROM/i);
      assert.doesNotMatch(String(sql), /tenant_id/);
      return {
        rows: [
          { id: 'e2', user_key: 'u2', created_at: new Date('2026-07-02Z'), answers: [] },
          { id: '', user_key: 'bad' },
        ],
      };
    },
  };
  const rows = await loadExamResultsFromTable(pool, 't1', 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'e2');
});

test('loadExamResultsFromTable：非 tenant 错误上抛；limit 夹紧', async () => {
  await assert.rejects(
    () =>
      loadExamResultsFromTable(
        {
          async query() {
            throw new Error('connection refused');
          },
        },
        't',
        9999
      ),
    /connection refused/
  );
});

test('hydrateExamResultsFromTable：有数据覆盖；空表保留；失败吞错', async () => {
  const withData = await hydrateExamResultsFromTable(
    {
      async query() {
        return {
          rows: [{ id: 'e3', user_key: 'u3', created_at: new Date(), answers: [] }],
        };
      },
    },
    { examResults: [{ id: 'old' }], keep: 1 },
    'default'
  );
  assert.equal(withData.keep, 1);
  assert.equal(withData.examResults[0].id, 'e3');

  const empty = await hydrateExamResultsFromTable(
    { async query() { return { rows: [] }; } },
    { examResults: [{ id: 'keep-me' }] },
    'default'
  );
  assert.equal(empty.examResults[0].id, 'keep-me');

  const boom = await hydrateExamResultsFromTable(
    {
      async query() {
        throw new Error('boom');
      },
    },
    { examResults: [{ id: 'x' }] },
    'default'
  );
  assert.equal(boom.examResults[0].id, 'x');
});
