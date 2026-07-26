import test from 'node:test';
import assert from 'node:assert/strict';
import { sensitiveRateLimit } from './sales-rate-limit.js';

function mockRes() {
  const out = { statusCode: 0, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return body;
    },
  };
}

test('sensitiveRateLimit allows under threshold then returns 429', () => {
  const mw = sensitiveRateLimit(`leads-detail-${Date.now()}`);
  const req = { platformAdmin: { username: 'u1' }, ip: '1.1.1.1' };
  let nextCount = 0;
  for (let i = 0; i < 60; i += 1) {
    const res = mockRes();
    mw(req, res, () => {
      nextCount += 1;
    });
    assert.equal(res.out.statusCode, 0);
  }
  assert.equal(nextCount, 60);
  const limited = mockRes();
  let limitedNext = false;
  mw(req, limited, () => {
    limitedNext = true;
  });
  assert.equal(limitedNext, false);
  assert.equal(limited.out.statusCode, 429);
  assert.deepEqual(limited.out.body, { ok: false, error: 'rate_limited' });
});

test('sensitiveRateLimit buckets by route family and identity', () => {
  const family = `timeline-${Date.now()}`;
  const mw = sensitiveRateLimit(family);
  const resA = mockRes();
  let nextA = false;
  mw({ platformAdmin: { username: 'a' } }, resA, () => {
    nextA = true;
  });
  assert.equal(nextA, true);

  const resAnon = mockRes();
  let nextAnon = false;
  mw({ ip: '9.9.9.9' }, resAnon, () => {
    nextAnon = true;
  });
  assert.equal(nextAnon, true);
});
