import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectStorageHelpers } from '../domains/uploads/object-storage.js';
import { createRequireEnvHelpers } from '../domains/shared/require-env.js';
import { createLoginLogHelpers } from '../domains/auth/login-log.js';

test('requireEnv lists missing keys', () => {
  const { requireEnv } = createRequireEnvHelpers({ databaseUrl: '', jwtSecret: '' });
  assert.deepEqual(requireEnv(), ['DATABASE_URL', 'JWT_SECRET']);
  const ok = createRequireEnvHelpers({ databaseUrl: 'x', jwtSecret: 'y' }).requireEnv();
  assert.deepEqual(ok, []);
});

test('buildCosPublicUrl prefers public base then default host', () => {
  class FakeCOS {
    constructor(opts) {
      this.opts = opts;
    }
  }
  const { buildCosPublicUrl, getCosClient, getOssClient, buildOssPublicUrl } = createObjectStorageHelpers({
    COS: FakeCOS,
    cosSecretId: 'id',
    cosSecretKey: 'key',
    cosBucket: 'bkt',
    cosRegion: 'ap-shanghai',
    cosPublicBaseUrl: ' https://cdn.example/ ',
  });
  assert.equal(buildCosPublicUrl('/a/b.png'), 'https://cdn.example/a/b.png');
  assert.equal(getOssClient(), null);
  assert.equal(buildOssPublicUrl('x'), '');
  const client = getCosClient();
  assert.ok(client instanceof FakeCOS);
  assert.equal(client.opts.SecretId, 'id');

  const noBase = createObjectStorageHelpers({
    COS: FakeCOS,
    cosSecretId: 'id',
    cosSecretKey: 'key',
    cosBucket: 'bkt',
    cosRegion: 'ap-shanghai',
    cosPublicBaseUrl: '',
  });
  assert.equal(
    noBase.buildCosPublicUrl('path/x.jpg'),
    'https://bkt.cos.ap-shanghai.myqcloud.com/path/x.jpg'
  );
  assert.equal(noBase.getCosClient() && true, true);

  const missing = createObjectStorageHelpers({
    COS: FakeCOS,
    cosSecretId: '',
    cosSecretKey: '',
    cosBucket: '',
    cosRegion: '',
    cosPublicBaseUrl: '',
  });
  assert.equal(missing.getCosClient(), null);
  assert.equal(missing.buildCosPublicUrl('x'), '');
});

test('recordLogin no-ops without username; writes close+insert', async () => {
  const queries = [];
  let released = 0;
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
    },
    release() {
      released += 1;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const tenantContext = {
    async run(tid, fn) {
      assert.equal(tid, 't1');
      return fn();
    },
  };
  const { recordLogin, recordLogout } = createLoginLogHelpers({ pool, tenantContext });
  await recordLogin('', 'sn', { headers: {} }, 't1');
  assert.equal(queries.length, 0);

  await recordLogin('Alice', 'sn-1', {
    headers: { 'x-forwarded-for': '1.2.3.4, 9.9.9.9', 'user-agent': 'ua' },
    ip: '0.0.0.0',
  }, 't1');
  assert.equal(queries.length, 3); // SET + update + insert
  assert.match(queries[1].sql, /logout_at = now\(\)/);
  assert.equal(queries[1].params[0], 'alice');
  assert.equal(queries[2].params[0], 'alice');
  assert.equal(queries[2].params[1], 'sn-1');
  assert.equal(queries[2].params[2], '1.2.3.4');
  assert.equal(queries[2].params[4], 't1');
  assert.equal(released, 1);

  queries.length = 0;
  released = 0;
  await recordLogout('Bob');
  assert.match(queries[1].sql, /logout_at = now\(\)/);
  assert.equal(queries[1].params[0], 'bob');
  assert.equal(released, 1);
});
