import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformAdminRequired } from './tenant-platform-routes.js';

test('createPlatformAdminRequired rejects missing token', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({}) }, 'plat-secret');
  const req = { headers: {}, method: 'GET' };
  const res = {
    statusCode: 0,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let next = false;
  await mw(req, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.statusCode, 401);
});
