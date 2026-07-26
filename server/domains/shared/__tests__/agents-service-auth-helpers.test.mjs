import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentsOutboundHeaders,
  createAgentsServiceAuthHelpers,
} from '../agents-service-auth.js';

test('agentsOutboundHeaders 透传 requestId / x-request-id / X-Request-Id', () => {
  assert.deepEqual(
    agentsOutboundHeaders({ requestId: 'rid-1' }, { Authorization: 'Bearer t' }),
    { Authorization: 'Bearer t', 'X-Request-Id': 'rid-1' }
  );
  assert.deepEqual(
    agentsOutboundHeaders({ headers: { 'x-request-id': 'rid-2' } }),
    { 'X-Request-Id': 'rid-2' }
  );
  assert.deepEqual(
    agentsOutboundHeaders({ headers: { 'X-Request-Id': 'rid-cap' } }),
    { 'X-Request-Id': 'rid-cap' }
  );
  assert.deepEqual(agentsOutboundHeaders({}, { 'Content-Type': 'application/json' }), {
    'Content-Type': 'application/json',
  });
});

test('agentsOutboundHeaders null/空白 requestId 不注入头', () => {
  assert.deepEqual(agentsOutboundHeaders(null, { A: '1' }), { A: '1' });
  assert.deepEqual(agentsOutboundHeaders(undefined, { B: '2' }), { B: '2' });
  assert.deepEqual(agentsOutboundHeaders({ requestId: '   ' }, { C: '3' }), { C: '3' });
  assert.deepEqual(
    agentsOutboundHeaders({ requestId: '  rid-trim  ' }),
    { 'X-Request-Id': 'rid-trim' }
  );
});

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

test('getAgentsServiceAdminToken 缓存 expiresAt 边界：等于 now 时刷新', async () => {
  const prevPass = process.env.AGENTS_ADMIN_PASSWORD;
  process.env.AGENTS_ADMIN_PASSWORD = 'secret';

  let now = 2_000_000;
  let posts = 0;
  const axios = {
    async post() {
      posts += 1;
      return { status: 200, data: { token: 'tok-' + posts } };
    },
  };

  const { getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({
    axios,
    nowFn: () => now,
  });

  assert.equal(await getAgentsServiceAdminToken(), 'tok-1');
  now = 2_000_000 + 45_000; // expiresAt === now，不应命中缓存
  assert.equal(await getAgentsServiceAdminToken(), 'tok-2');
  assert.equal(posts, 2);

  if (prevPass === undefined) delete process.env.AGENTS_ADMIN_PASSWORD;
  else process.env.AGENTS_ADMIN_PASSWORD = prevPass;
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

test('getAgentsServiceAdminToken 自定义 username；空白 env 回落 admin', async () => {
  const prevUser = process.env.AGENTS_ADMIN_USERNAME;
  const prevPass = process.env.AGENTS_ADMIN_PASSWORD;
  process.env.AGENTS_ADMIN_USERNAME = '  ops-admin  ';
  process.env.AGENTS_ADMIN_PASSWORD = '  pw-trim  ';

  let seenBody = null;
  let seenOpts = null;
  const axios = {
    async post(_url, body, opts) {
      seenBody = body;
      seenOpts = opts;
      return { status: 200, data: { token: 'tok-custom' } };
    },
  };

  const { getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({ axios });
  assert.equal(await getAgentsServiceAdminToken(), 'tok-custom');
  assert.deepEqual(seenBody, { username: 'ops-admin', password: 'pw-trim' });
  assert.equal(seenOpts.timeout, 8000);
  assert.equal(seenOpts.headers['Content-Type'], 'application/json');
  assert.equal(seenOpts.validateStatus(401), true);
  assert.equal(seenOpts.validateStatus(200), true);

  process.env.AGENTS_ADMIN_USERNAME = '   ';
  seenBody = null;
  const { getAgentsServiceAdminToken: getAgain } = createAgentsServiceAuthHelpers({ axios });
  await getAgain();
  assert.equal(seenBody.username, 'admin');

  if (prevUser === undefined) delete process.env.AGENTS_ADMIN_USERNAME;
  else process.env.AGENTS_ADMIN_USERNAME = prevUser;
  if (prevPass === undefined) delete process.env.AGENTS_ADMIN_PASSWORD;
  else process.env.AGENTS_ADMIN_PASSWORD = prevPass;
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
    /agents_service_login_failed:401.*bad/
  );
  if (prev === undefined) delete process.env.AGENTS_ADMIN_PASSWORD;
  else process.env.AGENTS_ADMIN_PASSWORD = prev;
});

test('getAgentsServiceAdminToken 非 2xx / 缺 token / 非 object detail', async () => {
  const prev = process.env.AGENTS_ADMIN_PASSWORD;
  process.env.AGENTS_ADMIN_PASSWORD = 'x';

  const cases = [
    { status: 199, data: { token: 't' }, re: /agents_service_login_failed:199/ },
    { status: 300, data: { token: 't' }, re: /agents_service_login_failed:300/ },
    { status: 200, data: {}, re: /agents_service_login_failed:200/ },
    { status: 200, data: null, re: /agents_service_login_failed:200/ },
    { status: 503, data: 'maintenance', re: /agents_service_login_failed:503.*maintenance/ },
  ];

  for (const { status, data, re } of cases) {
    const axios = { async post() { return { status, data }; } };
    const { getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({ axios });
    await assert.rejects(() => getAgentsServiceAdminToken(), re);
  }

  if (prev === undefined) delete process.env.AGENTS_ADMIN_PASSWORD;
  else process.env.AGENTS_ADMIN_PASSWORD = prev;
});
