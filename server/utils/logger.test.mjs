import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHttpAccessLogger } from './logger.js';

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  return res;
}

test('createHttpAccessLogger attaches req.log and logs on finish', async () => {
  const logs = [];
  const root = {
    child: () => ({
      info: (payload) => logs.push(payload),
      warn: () => {},
      error: () => {},
    }),
  };
  const middleware = createHttpAccessLogger(root);
  const req = { method: 'POST', originalUrl: '/api/customer-ops/report', requestId: 'rid-1' };
  const res = makeRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.ok(req.log);
  res.statusCode = 201;
  res.emit('finish');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].msg, 'http_request');
  assert.equal(logs[0].path, '/api/customer-ops/report');
  assert.equal(logs[0].status, 201);
});

test('createHttpAccessLogger skips quiet health paths at info level', () => {
  const logs = [];
  const root = { child: () => ({ info: (p) => logs.push(p), warn: () => {}, error: () => {} }) };
  const middleware = createHttpAccessLogger(root);
  const req = { method: 'GET', url: '/health', requestId: 'h1' };
  const res = makeRes();
  middleware(req, res, () => {});
  res.emit('finish');
  assert.equal(logs.length, 0);
});

test('createHttpAccessLogger uses warn/error levels by status', () => {
  const levels = [];
  const root = {
    child: () => ({
      info: () => levels.push('info'),
      warn: () => levels.push('warn'),
      error: () => levels.push('error'),
    }),
  };
  const middleware = createHttpAccessLogger(root);
  for (const [status, expected] of [[404, 'warn'], [500, 'error']]) {
    const req = { method: 'GET', originalUrl: `/api/x/${status}`, requestId: 'x' };
    const res = makeRes();
    res.statusCode = status;
    middleware(req, res, () => {});
    res.emit('finish');
    assert.equal(levels.at(-1), expected);
  }
});
