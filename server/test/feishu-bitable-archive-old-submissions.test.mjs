import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveOldBitableSubmissions } from '../domains/feishu-bitable/archive-old-submissions.js';

function makeArchiver(overrides = {}) {
  const calls = { sql: [], released: 0 };
  const client = {
    query: async (sql, params) => {
      calls.sql.push({ sql: String(sql), params, via: 'client' });
      if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return {};
      if (/INSERT INTO bitable_submissions_archive/.test(sql)) {
        if (params?.[0] === 'bad') throw new Error('insert fail');
        return {};
      }
      if (/DELETE FROM agent_messages/.test(sql)) return {};
      return {};
    },
    release: () => {
      calls.released++;
    },
  };
  const archive = createArchiveOldBitableSubmissions({
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params, via: 'pool' });
        if (/CREATE TABLE/i.test(sql)) return {};
        if (/SELECT \* FROM agent_messages/.test(sql)) {
          return {
            rows: overrides.rows ?? [
              {
                id: '1',
                direction: 'in',
                channel: 'feishu',
                feishu_open_id: 'ou',
                sender_username: 'u',
                sender_name: 'U',
                sender_role: 'r',
                routed_to: 'ops',
                content_type: 'bitable_submission',
                content: 'x',
                agent_data: {},
                created_at: '2026-01-01',
                updated_at: '2026-01-01',
                feishu_message_id: 'm',
                image_urls: null,
                record_id: 'rec1',
              },
            ],
          };
        }
        if (/DELETE FROM bitable_submissions_archive/.test(sql)) {
          return { rowCount: overrides.deletedCount ?? 2 };
        }
        return { rows: [] };
      },
      connect: async () => client,
    }),
    archiveThresholdDays: 7,
    deleteThresholdDays: 60,
    nowFn: () => new Date('2026-07-26T00:00:00.000Z'),
    ...overrides,
  });
  return { archive, calls, client };
}

test('no records', async () => {
  const { archive, calls } = makeArchiver({ rows: [] });
  assert.deepEqual(await archive(), { archived: 0, deleted: 0 });
  assert.ok(calls.sql.some((q) => /CREATE TABLE/i.test(q.sql)));
});

test('archives and deletes old archive rows', async () => {
  const { archive, calls } = makeArchiver();
  const r = await archive();
  assert.equal(r.archived, 1);
  assert.equal(r.deleted, 2);
  assert.ok(calls.sql.some((q) => /INSERT INTO bitable_submissions_archive/.test(q.sql)));
  assert.ok(calls.sql.some((q) => /DELETE FROM agent_messages/.test(q.sql)));
  assert.ok(calls.sql.some((q) => /DELETE FROM bitable_submissions_archive/.test(q.sql)));
  assert.equal(calls.released, 1);
});

test('single record failure continues batch', async () => {
  const { archive } = makeArchiver({
    rows: [
      {
        id: 'bad',
        direction: 'in',
        channel: 'feishu',
        feishu_open_id: 'ou',
        sender_username: 'u',
        sender_name: 'U',
        sender_role: 'r',
        routed_to: 'ops',
        content_type: 'bitable_submission',
        content: 'x',
        agent_data: {},
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        feishu_message_id: 'm',
        image_urls: null,
      },
      {
        id: '2',
        direction: 'in',
        channel: 'feishu',
        feishu_open_id: 'ou',
        sender_username: 'u',
        sender_name: 'U',
        sender_role: 'r',
        routed_to: 'ops',
        content_type: 'bitable_submission',
        content: 'x',
        agent_data: {},
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        feishu_message_id: 'm',
        image_urls: null,
      },
    ],
  });
  const r = await archive();
  assert.equal(r.archived, 1);
});

test('transaction failure returns error object', async () => {
  const { archive } = makeArchiver({
    pool: () => ({
      query: async (sql) => {
        if (/CREATE TABLE/i.test(sql)) return {};
        if (/SELECT \* FROM agent_messages/.test(sql)) {
          return {
            rows: [
              {
                id: '1',
                direction: 'in',
                channel: 'c',
                feishu_open_id: '',
                sender_username: '',
                sender_name: '',
                sender_role: '',
                routed_to: '',
                content_type: 'bitable_submission',
                content: '',
                agent_data: {},
                created_at: '',
                updated_at: '',
                feishu_message_id: '',
                image_urls: null,
              },
            ],
          };
        }
        return {};
      },
      connect: async () => ({
        query: async (sql) => {
          if (/BEGIN/i.test(sql)) return {};
          if (/COMMIT/i.test(sql)) throw new Error('commit fail');
          if (/ROLLBACK/i.test(sql)) return {};
          return {};
        },
        release: () => {},
      }),
    }),
  });
  const r = await archive();
  assert.equal(r.archived, 0);
  assert.match(r.error, /commit fail/);
});

test('create table failure soft-fails', async () => {
  const { archive } = makeArchiver({
    pool: () => ({
      query: async () => {
        throw new Error('ddl down');
      },
      connect: async () => ({ query: async () => ({}), release: () => {} }),
    }),
  });
  const r = await archive();
  assert.equal(r.error, 'ddl down');
});
