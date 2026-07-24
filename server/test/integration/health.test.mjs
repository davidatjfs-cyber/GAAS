import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/boot-app.mjs';

test('阶段0验证：真实进程能启动、连上测试库、/api/health响应', async () => {
  const app = await bootApp();
  try {
    const res = await fetch(app.baseUrl + '/api/health');
    const body = await res.json();
    assert.equal(res.status, 200, '预期health检查通过，实际: ' + JSON.stringify(body));
    assert.equal(body.ok, true);
  } finally {
    await app.stop();
  }
});

test('GET /api/version 返回 startedAt / buildVersion / server / frontend', async () => {
  const app = await bootApp();
  try {
    const res = await fetch(app.baseUrl + '/api/version');
    const body = await res.json();
    assert.equal(res.status, 200, '预期version检查通过，实际: ' + JSON.stringify(body));
    assert.ok(body.startedAt, 'startedAt');
    assert.equal(body.buildVersion, 'v176');
    assert.equal(typeof body.server, 'object');
    assert.ok('indexMtime' in body.server);
    assert.ok('agentsMtime' in body.server);
    assert.equal(typeof body.frontend, 'object');
    assert.ok('workingFixedMtime' in body.frontend);
    assert.ok('swMtime' in body.frontend);
    assert.ok('swCacheName' in body.frontend);
  } finally {
    await app.stop();
  }
});
