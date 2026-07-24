import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureEmployeeAttachmentsTable,
  ensureHrmsStateTable,
  ensureApprovalTables,
  ensureUserSessionsTable,
  ensureTenantRuntimeTables,
  ensureUserReadsTable,
  ensureLoginLogTable,
} from '../services/hrms-core-schema-ensure.js';
import { createExpressErrorMiddleware } from '../domains/health/express-error-middleware.js';
import {
  createUnhandledRejectionHandler,
  registerProcessGuards,
} from '../domains/health/process-guards.js';

test('hrms-core-schema-ensure exports all ensure* functions', () => {
  assert.equal(typeof ensureEmployeeAttachmentsTable, 'function');
  assert.equal(typeof ensureHrmsStateTable, 'function');
  assert.equal(typeof ensureApprovalTables, 'function');
  assert.equal(typeof ensureUserSessionsTable, 'function');
  assert.equal(typeof ensureTenantRuntimeTables, 'function');
  assert.equal(typeof ensureUserReadsTable, 'function');
  assert.equal(typeof ensureLoginLogTable, 'function');
});

function mockRes() {
  const out = { statusCode: null, body: null };
  return {
    getHeader() {
      return 'req-1';
    },
    status(code) {
      out.statusCode = code;
      return {
        json(payload) {
          out.body = payload;
          return out;
        },
      };
    },
    _out: out,
  };
}

test('express error middleware: Multer LIMIT_FILE_SIZE → 413', () => {
  class MulterError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const middleware = createExpressErrorMiddleware({ multer: { MulterError } });
  const res = mockRes();
  middleware(new MulterError('LIMIT_FILE_SIZE'), { requestId: 'abc' }, res, () => {});
  assert.equal(res._out.statusCode, 413);
  assert.equal(res._out.body.error, 'file_too_large');
  assert.equal(res._out.body.request_id, 'abc');
});

class FakeMulterError extends Error {}

test('express error middleware: uploads_dir_not_writable → 500', () => {
  const middleware = createExpressErrorMiddleware({ multer: { MulterError: FakeMulterError } });
  const res = mockRes();
  middleware(new Error('uploads_dir_not_writable: /tmp'), {}, res, () => {});
  assert.equal(res._out.statusCode, 500);
  assert.equal(res._out.body.error, 'uploads_dir_not_writable');
});

test('express error middleware: generic error → 500 server_error', () => {
  const middleware = createExpressErrorMiddleware({ multer: { MulterError: FakeMulterError } });
  const res = mockRes();
  middleware(new Error('something broke'), {}, res, () => {});
  assert.equal(res._out.statusCode, 500);
  assert.equal(res._out.body.error, 'server_error');
  assert.equal(res._out.body.message, 'internal_error');
});

test('process guards: unhandledRejection handler sends alert once per cooldown', async () => {
  const calls = [];
  const handler = createUnhandledRejectionHandler({
    sendLarkMessage: async (chat, msg) => {
      calls.push({ chat, msg });
      return { ok: true };
    },
    FEISHU_ALERT_ADMIN_HEALTH: 'health-chat',
  });
  handler(new Error('first'), Promise.resolve());
  handler(new Error('second'), Promise.resolve());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chat, 'health-chat');
  assert.match(calls[0].msg, /first/);
});

test('registerProcessGuards attaches unhandledRejection and uncaughtException listeners', () => {
  const beforeRejection = process.listenerCount('unhandledRejection');
  const beforeException = process.listenerCount('uncaughtException');
  registerProcessGuards({
    sendLarkMessage: async () => ({ ok: true }),
    FEISHU_ALERT_ADMIN_HEALTH: 'health-chat',
  });
  assert.ok(process.listenerCount('unhandledRejection') > beforeRejection);
  assert.ok(process.listenerCount('uncaughtException') > beforeException);
});
