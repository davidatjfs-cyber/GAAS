import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentsServiceAuthHelpers } from '../domains/shared/agents-service-auth.js';

test('getAgentsServiceBaseUrl strips trailing slash and defaults', () => {
  const prev = process.env.AGENTS_SERVICE_BASE_URL;
  try {
    delete process.env.AGENTS_SERVICE_BASE_URL;
    const { getAgentsServiceBaseUrl } = createAgentsServiceAuthHelpers({ axios: {} });
    assert.equal(getAgentsServiceBaseUrl(), 'http://127.0.0.1:3101');

    process.env.AGENTS_SERVICE_BASE_URL = ' http://agents.example/ ';
    assert.equal(getAgentsServiceBaseUrl(), 'http://agents.example');
  } finally {
    if (prev === undefined) delete process.env.AGENTS_SERVICE_BASE_URL;
    else process.env.AGENTS_SERVICE_BASE_URL = prev;
  }
});

test('getAgentsServiceAdminToken caches for 45s', async () => {
  const prevUser = process.env.AGENTS_ADMIN_USERNAME;
  const prevPass = process.env.AGENTS_ADMIN_PASSWORD;
  process.env.AGENTS_ADMIN_PASSWORD = 'secret';
  delete process.env.AGENTS_ADMIN_USERNAME;

  let now = 1_000_000;
  let posts = 0;
  const axios = {
    async post(url, body) {
      posts += 1;
      assert.match(url, /\/api\/login$/);
      assert.equal(body.username, 'admin');
      assert.equal(body.password, 'secret');
      return { status: 200, data: { token: 'tok-' + posts } };
    },
  };

  const { getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({
    axios,
    nowFn: () => now,
  });

  assert.equal(await getAgentsServiceAdminToken(), 'tok-1');
  now += 10_000;
  assert.equal(await getAgentsServiceAdminToken(), 'tok-1');
  assert.equal(posts, 1);

  now += 50_000;
  assert.equal(await getAgentsServiceAdminToken(), 'tok-2');
  assert.equal(posts, 2);

  if (prevUser === undefined) delete process.env.AGENTS_ADMIN_USERNAME;
  else process.env.AGENTS_ADMIN_USERNAME = prevUser;
  if (prevPass === undefined) delete process.env.AGENTS_ADMIN_PASSWORD;
  else process.env.AGENTS_ADMIN_PASSWORD = prevPass;
});

test('getAgentsServiceAdminToken throws when password missing', async () => {
  const prev = process.env.AGENTS_ADMIN_PASSWORD;
  delete process.env.AGENTS_ADMIN_PASSWORD;
  const { getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({ axios: {} });
  await assert.rejects(
    () => getAgentsServiceAdminToken(),
    /AGENTS_ADMIN_PASSWORD/
  );
  if (prev === undefined) delete process.env.AGENTS_ADMIN_PASSWORD;
  else process.env.AGENTS_ADMIN_PASSWORD = prev;
});

test('getAgentsServiceAdminToken throws on login failure', async () => {
  const prev = process.env.AGENTS_ADMIN_PASSWORD;
  process.env.AGENTS_ADMIN_PASSWORD = 'x';
  const axios = {
    async post() {
      return { status: 401, data: { error: 'bad' } };
    },
  };
  const { getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({ axios });
  await assert.rejects(
    () => getAgentsServiceAdminToken(),
    /agents_service_login_failed:401/
  );
  if (prev === undefined) delete process.env.AGENTS_ADMIN_PASSWORD;
  else process.env.AGENTS_ADMIN_PASSWORD = prev;
});
