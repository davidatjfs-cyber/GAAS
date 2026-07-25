/**
 * pino 入口日志：HTTP 访问中间件字段与静默路径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import { createHttpAccessLogger } from '../utils/logger.js';

function collectLogger() {
  const lines = [];
  const dest = {
    write(chunk) {
      lines.push(JSON.parse(String(chunk)));
    },
  };
  const root = pino({ level: 'info', base: null }, dest);
  return { root, lines };
}

function mockReqRes({ method = 'GET', url = '/api/foo', statusCode = 200, extras = {} } = {}) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  const req = {
    method,
    originalUrl: url,
    url,
    requestId: 'rid-1',
    ...extras,
  };
  return { req, res };
}

test('createHttpAccessLogger: 成功请求打 info + request_id/tenant', async () => {
  const { root, lines } = collectLogger();
  const mw = createHttpAccessLogger(root);
  const { req, res } = mockReqRes({
    url: '/api/state',
    extras: { tenantId: 'default', user: { username: 'alice' } },
  });
  await new Promise((resolve) => {
    mw(req, res, () => {
      assert.equal(typeof req.log?.info, 'function');
      res.statusCode = 200;
      res.emit('finish');
      resolve();
    });
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].msg, 'http_request');
  assert.equal(lines[0].request_id, 'rid-1');
  assert.equal(lines[0].tenant_id, 'default');
  assert.equal(lines[0].username, 'alice');
  assert.equal(lines[0].status, 200);
  assert.equal(lines[0].path, '/api/state');
  assert.ok(typeof lines[0].duration_ms === 'number');
});

test('createHttpAccessLogger: /health 成功不打 info', async () => {
  const { root, lines } = collectLogger();
  const mw = createHttpAccessLogger(root);
  const { req, res } = mockReqRes({ url: '/health' });
  await new Promise((resolve) => {
    mw(req, res, () => {
      res.statusCode = 200;
      res.emit('finish');
      resolve();
    });
  });
  assert.equal(lines.length, 0);
});

test('createHttpAccessLogger: 5xx 打 error', async () => {
  const { root, lines } = collectLogger();
  const mw = createHttpAccessLogger(root);
  const { req, res } = mockReqRes({ url: '/api/boom' });
  await new Promise((resolve) => {
    mw(req, res, () => {
      res.statusCode = 500;
      res.emit('finish');
      resolve();
    });
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 50); // pino error
  assert.equal(lines[0].status, 500);
});
