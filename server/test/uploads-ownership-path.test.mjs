import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRecordUploadOwnership } from '../domains/uploads/ownership.js';
import { resolveUploadRelPath } from '../domains/uploads/path.js';
import { registerUploadRoutes } from '../domains/uploads/routes.js';
import { registerAiChatCompletionsRoutes } from '../domains/ai/routes-chat-completions.js';
import { registerAuthRoutes } from '../auth-routes.js';

test('resolveUploadRelPath accepts simple relative names', () => {
  assert.equal(resolveUploadRelPath('abc.jpg'), 'abc.jpg');
  assert.equal(resolveUploadRelPath('/nested/file.png'), 'nested/file.png');
});

test('resolveUploadRelPath rejects traversal / absolute / empty', () => {
  assert.equal(resolveUploadRelPath(''), null);
  assert.equal(resolveUploadRelPath('../secret'), null);
  assert.equal(resolveUploadRelPath('foo/../../etc/passwd'), null);
  // leading slashes are stripped (same as index); absolute only after normalize
  assert.equal(resolveUploadRelPath('/etc/passwd'), 'etc/passwd');
});

test('createRecordUploadOwnership inserts SQL shape and skips empty', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const recordUploadOwnership = createRecordUploadOwnership(pool);

  await recordUploadOwnership([], 't1', 'u1');
  assert.equal(calls.length, 0);

  await recordUploadOwnership([null, undefined, ''], 't1', 'u1');
  assert.equal(calls.length, 0);

  await recordUploadOwnership('a.png', 'tenant-x', 'alice');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO upload_file_owners/);
  assert.match(calls[0].sql, /ON CONFLICT \(filename\) DO NOTHING/);
  assert.deepEqual(calls[0].params, ['a.png', 'tenant-x', 'alice']);

  await recordUploadOwnership(['b.png', 'c.png'], null, null);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].params, ['b.png', 'default', null]);
  assert.deepEqual(calls[2].params, ['c.png', 'default', null]);
});

test('createRecordUploadOwnership swallows query errors', async () => {
  const pool = {
    query: async () => {
      throw new Error('db_down');
    },
  };
  const recordUploadOwnership = createRecordUploadOwnership(pool);
  await assert.doesNotReject(() => recordUploadOwnership('x.png', 'default', 'u'));
});

test('registerUploadRoutes / registerAiChatCompletionsRoutes / registerAuthRoutes smoke', () => {
  const app = express();
  const authRequired = (req, res, next) => next();
  const upload = {
    single: () => (req, res, next) => next(),
    array: () => (req, res, next) => next(),
    fields: () => (req, res, next) => next(),
  };
  const pool = { query: async () => ({ rows: [] }) };
  const recordUploadOwnership = createRecordUploadOwnership(pool);

  assert.doesNotThrow(() => {
    registerUploadRoutes(app, authRequired, {
      upload,
      recordUploadOwnership,
      pool,
      uploadsDir: '/tmp/uploads-test',
    });
  });
  assert.doesNotThrow(() => {
    registerAiChatCompletionsRoutes(app, authRequired);
  });
  assert.doesNotThrow(() => {
    registerAuthRoutes(app, authRequired, (req, res, next) => next(), {
      pool,
      JWT_SECRET: 'test',
      DATABASE_URL: 'postgres://x',
      getSharedState: async () => ({}),
      normalizeRoleForJwt: (r) => r,
      normalizeUsersTableRole: (r) => r,
      employeeAccountShouldDisable: () => false,
      getUserStoreAccessContext: async () => ({ allowedStores: [], currentStore: '', primaryStore: '' }),
      pickMyStoreFromState: () => '',
      recordLogin: () => {},
      recordLogout: async () => {},
      storeSessionNonce: async () => true,
      loadTenantRuntimeStatus: async () => ({}),
    });
  });

  const stack = app._router?.stack || [];
  const paths = stack
    .map((layer) => layer?.route?.path)
    .filter(Boolean);
  assert.ok(paths.includes('/uploads/*'));
  assert.ok(paths.includes('/api/growth/upload'));
  assert.ok(paths.includes('/api/ai/chat-completions'));
  assert.ok(paths.includes('/api/me'));
  assert.ok(paths.includes('/api/auth/me'));
});
