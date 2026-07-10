import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginRateLimiter, _resetLoginRateLimitForTests } from './rate-limit.js';

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('login rate limiter allows under max then 429', async () => {
  _resetLoginRateLimitForTests();
  const limiter = createLoginRateLimiter({ max: 3, windowMs: 60_000 });
  const req = { ip: '1.2.3.4', body: { username: 'u', tenant_id: 'default' }, socket: {} };
  for (let i = 0; i < 3; i++) {
    let nextCalled = false;
    const res = mockRes();
    limiter(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  }
  const res = mockRes();
  let nextCalled = false;
  limiter(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'too_many_login_attempts');
});
