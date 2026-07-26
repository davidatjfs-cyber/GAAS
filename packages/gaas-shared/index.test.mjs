import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFeishuSignature,
  verifyFeishuWebhookRequest,
  fetchFeishuTenantAccessToken,
  getCachedFeishuTenantAccessToken,
  evictFeishuTokenCache,
  SHARED_TABLES,
  SHARED_TABLE_WRITERS,
  HR_RATING_CONFIG_KEYS,
} from './index.js';

test('shared: signature roundtrip', () => {
  const rawBody = Buffer.from('{"type":"event_callback"}');
  const sig = computeFeishuSignature({
    timestamp: '1',
    nonce: 'n',
    encryptKey: 'k',
    rawBody,
  });
  const r = verifyFeishuWebhookRequest({
    headers: {
      'x-lark-request-timestamp': '1',
      'x-lark-request-nonce': 'n',
      'x-lark-signature': sig,
    },
    rawBody,
    encryptKey: 'k',
    requireSignature: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'signature');
});

test('shared: table writer matrix covers master_tasks / hrms_state / employees', () => {
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.MASTER_TASKS], 'agents');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.HRMS_STATE], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.EMPLOYEES], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.HR_RATING_CONFIGS], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.EXAM_RESULTS], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.HRMS_USER_NOTIFICATIONS], 'gaas');
  assert.equal(HR_RATING_CONFIG_KEYS.APPROVAL_FLOWS, 'approval_flows');
});

test('shared: SHARED_TABLE_WRITERS 全表覆盖且写入方仅 gaas|agents', () => {
  const allowed = new Set(['gaas', 'agents']);
  const tables = Object.values(SHARED_TABLES);
  assert.ok(tables.length >= 15);
  for (const table of tables) {
    assert.ok(Object.prototype.hasOwnProperty.call(SHARED_TABLE_WRITERS, table), table);
    assert.ok(allowed.has(SHARED_TABLE_WRITERS[table]), `${table}=${SHARED_TABLE_WRITERS[table]}`);
  }
  for (const table of Object.keys(SHARED_TABLE_WRITERS)) {
    assert.ok(tables.includes(table), `unknown ${table}`);
  }
});

test('shared: fetchFeishuTenantAccessToken uses fetchImpl', async () => {
  const token = await fetchFeishuTenantAccessToken({
    appId: 'id',
    appSecret: 'sec',
    fetchImpl: async () => ({
      json: async () => ({ code: 0, tenant_access_token: 't-demo', expire: 7200 }),
    }),
  });
  assert.equal(token.token, 't-demo');
});

test('shared: onRefresh 只在真取新 token 时触发，缓存命中静默', async () => {
  const cacheKey = 'test:onrefresh';
  evictFeishuTokenCache(cacheKey);

  let fetchCalls = 0;
  let refreshCalls = 0;
  const opts = {
    appId: 'id',
    appSecret: 'sec',
    cacheKey,
    fetchImpl: async () => {
      fetchCalls += 1;
      return { json: async () => ({ code: 0, tenant_access_token: 't1', expire: 7200 }) };
    },
    onRefresh: () => { refreshCalls += 1; },
  };

  // 首次：缓存未命中 → 应真取 + 触发回调
  assert.equal(await getCachedFeishuTenantAccessToken(opts), 't1');
  assert.equal(fetchCalls, 1);
  assert.equal(refreshCalls, 1);

  // 再调两次：缓存命中 → 不取网络、不触发回调（这正是日志刷屏的修复点）
  await getCachedFeishuTenantAccessToken(opts);
  await getCachedFeishuTenantAccessToken(opts);
  assert.equal(fetchCalls, 1, '缓存命中不应再打网络');
  assert.equal(refreshCalls, 1, '缓存命中不应触发 onRefresh');

  // forceRefresh：强制取新 → 再触发一次
  await getCachedFeishuTenantAccessToken({ ...opts, forceRefresh: true });
  assert.equal(fetchCalls, 2);
  assert.equal(refreshCalls, 2);

  evictFeishuTokenCache(cacheKey);
});

test('shared: onRefresh 回调抛错不影响 token 返回', async () => {
  const cacheKey = 'test:onrefresh-throw';
  evictFeishuTokenCache(cacheKey);
  const token = await getCachedFeishuTenantAccessToken({
    appId: 'id',
    appSecret: 'sec',
    cacheKey,
    fetchImpl: async () => ({
      json: async () => ({ code: 0, tenant_access_token: 't-ok', expire: 7200 }),
    }),
    onRefresh: () => { throw new Error('callback boom'); },
  });
  assert.equal(token, 't-ok');
  evictFeishuTokenCache(cacheKey);
});
