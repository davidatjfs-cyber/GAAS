/**
 * domains/growth-wecom unit tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWecomTokenCaches } from '../token-cache.js';
import { getWecomConfig, getStoreWecomConfig, getAllStoreWecomConfigs } from '../config.js';
import { createStoreTenantResolver } from '../resolve-tenant.js';
import { createGetWecomAccessToken } from '../access-token.js';
import { createSendWecomExternalMessage } from '../send-message.js';
import { createGrowthWecom } from '../service.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function queuePool(handlers) {
  let i = 0;
  return {
    query: async (sql, params) => {
      const next = handlers[i++];
      if (!next) throw new Error(`unexpected query #${i}: ${String(sql).slice(0, 80)}`);
      if (typeof next === 'function') return next(sql, params);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('token caches reset/clear', () => {
  const caches = createWecomTokenCaches();
  caches.setGrowthCache({ token: 'g', expiresAt: 9, store_id: '' });
  caches.setStoreCache('s1', { token: 't', expiresAt: 9 });
  assert.equal(caches.getGrowthCache().token, 'g');
  assert.equal(caches.getStoreCache('s1').token, 't');
  caches.resetGrowthCache();
  caches.clearStoreCache('s1');
  assert.equal(caches.getGrowthCache().token, '');
  assert.equal(caches.getStoreCache('s1'), undefined);
});

test('getWecomConfig / store configs', async () => {
  const cfg = await getWecomConfig(queuePool([{ rows: [{ data: { corp_id: 'c' } }] }]), async () => ({ corp_id: 'c' }));
  assert.equal(cfg.corp_id, 'c');
  assert.equal(await getWecomConfig(queuePool([]), async () => null), null);

  assert.equal(await getStoreWecomConfig(queuePool([]), ''), null);
  const store = await getStoreWecomConfig(queuePool([{ rows: [{ store_id: 's1' }] }]), 's1');
  assert.equal(store.store_id, 's1');

  const all = await getAllStoreWecomConfigs(queuePool([{ rows: [{ store_id: 'a' }, { store_id: 'b' }] }]));
  assert.equal(all.length, 2);
});

test('resolveTenantIdForStore caches and falls back', async () => {
  const resolve = createStoreTenantResolver({ employeesTable: 'employees' });
  assert.equal(await resolve(queuePool([]), ''), 'default');

  const pool = queuePool([
    { rows: [{ tenant_id: 't1' }] },
    { rows: [{ tenant_id: 't1' }] }, // would not be used if cache hits
  ]);
  assert.equal(await resolve(pool, '店A'), 't1');
  assert.equal(await resolve(pool, '店A'), 't1');

  const broken = createStoreTenantResolver({ employeesTable: 'employees' });
  assert.equal(await broken(queuePool([new Error('db')]), 'x'), 'default');
});

test('getWecomAccessToken: store cache hit + fetch miss', async () => {
  const caches = createWecomTokenCaches();
  caches.setStoreCache('s1', { token: 'cached', expiresAt: Date.now() + 60_000 });
  const getTok = createGetWecomAccessToken({
    cleanText,
    getWecomConfig: async () => null,
    getStoreWecomConfig: async () => null,
    caches,
    fetchFn: async () => { throw new Error('should not fetch'); },
  });
  assert.equal(await getTok({}, 's1'), 'cached');

  caches.clearStoreCache('s1');
  const fetchTok = createGetWecomAccessToken({
    cleanText,
    getWecomConfig: async () => ({ corp_id: 'c', corp_secret: 's' }),
    getStoreWecomConfig: async () => null,
    caches,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ errcode: 0, access_token: 'newtok', expires_in: 7200 }),
    }),
  });
  assert.equal(await fetchTok({}, 's1'), 'newtok');
  assert.equal(caches.getStoreCache('s1').token, 'newtok');
});

test('getWecomAccessToken: global path + missing config', async () => {
  const caches = createWecomTokenCaches();
  const getTok = createGetWecomAccessToken({
    cleanText,
    getWecomConfig: async () => ({ corp_id: 'c', corp_secret: 'sec' }),
    getStoreWecomConfig: async () => null,
    caches,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ errcode: 0, access_token: 'g', expires_in: 100 }),
    }),
  });
  assert.equal(await getTok({}, ''), 'g');
  assert.equal(caches.getGrowthCache().token, 'g');

  await assert.rejects(
    createGetWecomAccessToken({
      cleanText,
      getWecomConfig: async () => ({}),
      getStoreWecomConfig: async () => null,
      caches: createWecomTokenCaches(),
      fetchFn: async () => ({ ok: true, json: async () => ({}) }),
    })({}, ''),
    /missing_wecom_config/
  );
});

test('sendWecomExternalMessage validates and sends', async () => {
  const send = createSendWecomExternalMessage({
    cleanText,
    getWecomConfig: async () => ({ sender_userid: 'u1' }),
    getStoreWecomConfig: async () => null,
    getWecomAccessToken: async () => 'tok',
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ errcode: 0, msgid: 'm1' }),
    }),
  });
  const r = await send({}, {
    store_id: 's1',
    external_userid: 'ext',
    content: 'hello',
  });
  assert.equal(r.provider_msg_id, 'm1');

  const sendNoSender = createSendWecomExternalMessage({
    cleanText,
    getWecomConfig: async () => ({}),
    getStoreWecomConfig: async () => null,
    getWecomAccessToken: async () => 'tok',
    fetchFn: async () => ({ ok: true, json: async () => ({ errcode: 0 }) }),
  });
  await assert.rejects(
    sendNoSender({}, { external_userid: 'e', content: 'x' }),
    /missing_wecom_sender_userid/
  );
});

test('createGrowthWecom wires exports', async () => {
  const api = createGrowthWecom({
    cleanText,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ errcode: 0, access_token: 't', expires_in: 7200 }),
    }),
  });
  assert.equal(typeof api.getWecomConfig, 'function');
  assert.equal(typeof api.resetGrowthWecomTokenCache, 'function');
  api.resetGrowthWecomTokenCache();
  api.clearStoreWecomTokenCache('x');
});
