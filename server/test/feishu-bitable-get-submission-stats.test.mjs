import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetBitableSubmissionStats } from '../domains/feishu-bitable/get-submission-stats.js';

test('aggregates main + archive totals', async () => {
  const sqls = [];
  const get = createGetBitableSubmissionStats({
    pool: () => ({
      query: async (sql) => {
        sqls.push(String(sql));
        if (/FROM agent_messages/.test(sql)) {
          return {
            rows: [{ total: '3', last_7_days: '1', last_30_days: '2', oldest: 'a', newest: 'b' }],
          };
        }
        return { rows: [{ total: '5', last_30_days: '4' }] };
      },
    }),
  });
  const r = await get();
  assert.equal(r.total, 8);
  assert.equal(r.main.total, '3');
  assert.equal(r.archive.total, '5');
  assert.ok(sqls.some((s) => /bitable_submission/.test(s)));
  assert.ok(sqls.some((s) => /bitable_submissions_archive/.test(s)));
});

test('empty rows → zeros', async () => {
  const get = createGetBitableSubmissionStats({
    pool: () => ({
      query: async () => ({ rows: [] }),
    }),
  });
  assert.deepEqual(await get(), { main: {}, archive: {}, total: 0 });
});

test('query error soft-fails', async () => {
  const get = createGetBitableSubmissionStats({
    pool: () => ({
      query: async () => {
        throw new Error('db');
      },
    }),
  });
  assert.deepEqual(await get(), { main: {}, archive: {}, total: 0 });
});
