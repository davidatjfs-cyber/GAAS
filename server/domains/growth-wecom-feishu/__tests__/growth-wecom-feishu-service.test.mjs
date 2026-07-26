import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  extractWecomContactPhone,
  resolveCallbackSecret,
  WECOM_EVENT_MAP,
  WECOM_STATUS_MAP,
} from '../helpers.js';
import {
  saveWecomConfig,
  saveFeishuConfig,
  handleWecomCallback,
  upsertStoreWecomConfig,
  syncWecomContactsForStore,
} from '../service.js';

function baseCtx(overrides = {}) {
  return {
    tenantContext: { run: async (_t, fn) => fn() },
    resolveTenantIdForStore: async () => 'default',
    getWecomConfig: async () => ({ callback_secret: 'global-secret' }),
    getStoreWecomConfig: async () => null,
    getAllStoreWecomConfigs: async () => [],
    getWecomAccessToken: async () => 'tok',
    resetGrowthWecomTokenCache: () => {},
    clearStoreWecomTokenCache: () => {},
    upsertDeliveryLog: async () => {},
    insertGrowthEvent: async () => {},
    ...overrides,
  };
}

test('helpers: cleanText / maps / extractWecomContactPhone', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.equal(WECOM_STATUS_MAP.read, 'read');
  assert.equal(WECOM_EVENT_MAP.clicked, 'wecom_message_clicked');
  assert.equal(
    extractWecomContactPhone({
      follow_info: [{ description: '客人手机13800138000备注' }],
    }),
    '13800138000'
  );
  assert.equal(
    extractWecomContactPhone({
      follow_info: [],
      wechat_channels: [{ phone: '13900139000' }],
    }),
    '13900139000'
  );
});

test('resolveCallbackSecret: store overrides global', () => {
  assert.equal(
    resolveCallbackSecret({ callback_secret: 'store' }, { callback_secret: 'global' }, 'env'),
    'store'
  );
  assert.equal(resolveCallbackSecret(null, { callback_secret: 'global' }, 'env'), 'global');
  assert.equal(resolveCallbackSecret(null, null, 'env'), 'env');
});

test('saveWecomConfig / saveFeishuConfig: missing fields', async () => {
  const pool = { async query() { return { rows: [] }; } };
  const w = await saveWecomConfig(baseCtx(), pool, { corp_id: 'x' });
  assert.equal(w.status, 400);
  const f = await saveFeishuConfig(baseCtx(), pool, { app_token: 't' });
  assert.equal(f.status, 400);
  assert.equal(f.body.error, 'missing app_token or table_id');
});

test('upsertStoreWecomConfig: missing store_id/corp', async () => {
  const r = await upsertStoreWecomConfig(baseCtx(), { async query() { return { rows: [] }; } }, {
    store_id: 's1',
  });
  assert.equal(r.status, 400);
});

test('handleWecomCallback: missing fields / not found / unauthorized / ok', async () => {
  const ctx = baseCtx();
  const missing = await handleWecomCallback(ctx, { async query() { return { rows: [] }; } }, {}, {});
  assert.equal(missing.status, 400);

  const notFound = await handleWecomCallback(
    ctx,
    { async query() { return { rows: [] }; } },
    { provider_msg_id: 'm1', event_type: 'read' },
    { 'x-wecom-callback-secret': 'global-secret' }
  );
  assert.equal(notFound.status, 404);

  const unauth = await handleWecomCallback(
    ctx,
    {
      async query() {
        return {
          rows: [{ delivery_key: 'd', tenant_id: 'default', store_id: 's1', payload: {} }],
        };
      },
    },
    { provider_msg_id: 'm1', event_type: 'read' },
    { 'x-wecom-callback-secret': 'wrong' }
  );
  assert.equal(unauth.status, 401);

  let eventInserted = false;
  const okCtx = baseCtx({
    insertGrowthEvent: async () => {
      eventInserted = true;
    },
  });
  const ok = await handleWecomCallback(
    okCtx,
    {
      async query() {
        return {
          rows: [
            {
              delivery_key: 'd',
              action_key: 'a',
              rule_key: 'r',
              customer_id: 1,
              store_id: 's1',
              channel: 'wecom',
              external_userid: 'e1',
              tenant_id: 'default',
              payload: {},
              result: {},
            },
          ],
        };
      },
    },
    { provider_msg_id: 'm1', event_type: 'read' },
    { 'x-wecom-callback-secret': 'global-secret' }
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'read');
  assert.equal(eventInserted, true);
});

test('syncWecomContactsForStore: returns 0 on list failure', async () => {
  const ctx = baseCtx({
    fetch: async () => ({
      async json() {
        return { errcode: 40014, errmsg: 'invalid token' };
      },
    }),
  });
  const n = await syncWecomContactsForStore(ctx, { async query() { return { rows: [] }; } }, {
    store_id: 's1',
    sender_userid: 'u1',
  });
  assert.equal(n, 0);
});
