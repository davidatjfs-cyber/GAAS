import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlertCard,
  deepSanitizeFeishuCardStrings,
  sanitizePerformanceZhText,
} from '../lark-send-helpers.js';
import {
  getLarkImageUrlBody,
  registerFeishuUserBody,
  sendLarkCardBody,
  sendLarkMessageBody,
} from '../lark-send-io.js';
import { createLarkSendApi } from '../lark-send.js';

test('sanitizePerformanceZhText / card helpers', () => {
  assert.equal(sanitizePerformanceZhText('你好'), '你好');
  assert.match(sanitizePerformanceZhText('📊 绩效考核通知\nstore_rating: A分'), /绩效考核周报/);
  assert.match(sanitizePerformanceZhText('store_rating: A分'), /门店级别：A级/);
  const card = { header: { title: { content: '绩效考核通知' } }, elements: ['store_rating: B分'] };
  deepSanitizeFeishuCardStrings(card, sanitizePerformanceZhText);
  assert.match(card.header.title.content, /周报/);
  assert.match(card.elements[0], /门店级别/);
  const alert = buildAlertCard('告警', 'high', '详情', [{ text: '查看', value: { id: 1 } }]);
  assert.equal(alert.header.template, 'red');
  assert.equal(alert.elements.length, 2);
});

test('sendLarkMessageBody dedup / success / cross-app retry', async () => {
  const deduped = await sendLarkMessageBody(
    {
      axios: {},
      getLarkTenantToken: async () => 'tok',
      deduplicateMessage: () => false,
      feishuSkipOpenIdResolveHrms: () => true,
      isOpenIdCrossAppFeishuError: () => false,
      refreshFeishuUserOpenIdForImDeliveryHrms: async () => null,
      feishuOpenIdResolveDeps: () => ({}),
      log: { error() {}, info() {}, warn() {} },
    },
    'ou_1',
    'hello'
  );
  assert.deepEqual(deduped, { ok: true, deduplicated: true });

  const posts = [];
  const ok = await sendLarkMessageBody(
    {
      axios: {
        post: async (_url, body) => {
          posts.push(body);
          return { data: { code: 0 } };
        },
      },
      getLarkTenantToken: async () => 'tok',
      deduplicateMessage: () => true,
      feishuSkipOpenIdResolveHrms: () => true,
      isOpenIdCrossAppFeishuError: () => false,
      refreshFeishuUserOpenIdForImDeliveryHrms: async () => null,
      feishuOpenIdResolveDeps: () => ({}),
      log: { error() {}, info() {}, warn() {} },
    },
    'ou_1',
    'hello'
  );
  assert.equal(ok.ok, true);
  assert.equal(posts.length, 1);

  let tries = 0;
  const retried = await sendLarkMessageBody(
    {
      axios: {
        post: async (_url, body) => {
          tries += 1;
          if (body.receive_id === 'ou_old') return { data: { code: 99991668, msg: 'open_id cross app' } };
          return { data: { code: 0 } };
        },
      },
      getLarkTenantToken: async () => 'tok',
      deduplicateMessage: () => true,
      feishuSkipOpenIdResolveHrms: () => false,
      isOpenIdCrossAppFeishuError: (code) => code === 99991668,
      refreshFeishuUserOpenIdForImDeliveryHrms: async () => 'ou_new',
      feishuOpenIdResolveDeps: () => ({}),
      log: { error() {}, info() {}, warn() {} },
    },
    'ou_old',
    'hi'
  );
  assert.equal(retried.ok, true);
  assert.equal(tries, 2);
});

test('sendLarkCardBody / getLarkImageUrlBody / registerFeishuUserBody', async () => {
  const cardOk = await sendLarkCardBody(
    {
      axios: { post: async () => ({ data: { code: 0 } }) },
      getLarkTenantToken: async () => 'tok',
      feishuSkipOpenIdResolveHrms: () => true,
      isOpenIdCrossAppFeishuError: () => false,
      refreshFeishuUserOpenIdForImDeliveryHrms: async () => null,
      feishuOpenIdResolveDeps: () => ({}),
      log: { error() {}, info() {}, warn() {} },
    },
    'ou_1',
    { header: { title: { content: 'x' } } }
  );
  assert.equal(cardOk.ok, true);

  const img = await getLarkImageUrlBody(
    {
      axios: { get: async () => ({ data: Buffer.from('jpeg') }) },
      getLarkTenantToken: async () => 'tok',
      log: { error() {} },
    },
    'mid',
    'ikey'
  );
  assert.match(img, /^data:image\/jpeg;base64,/);

  const writes = [];
  const reg = await registerFeishuUserBody(
    {
      pool: () => ({
        query: async (sql, params) => {
          writes.push({ sql, params });
          if (/FROM users/i.test(sql)) return { rows: [{ tenant_id: 't1' }] };
          return { rows: [] };
        },
      }),
      tenantContext: { run: async (_t, fn) => fn() },
      getSharedState: async () => ({
        employees: [{ username: 'alice', name: 'Alice', store: '洪潮', role: 'store_manager' }],
      }),
      findUserInState: (_s, u) => ({ username: u, name: 'Alice', store: '洪潮', role: 'store_manager' }),
      resolveBrandContextByStore: () => ({ brandId: 'hc', brandName: '洪潮' }),
      log: { error() {} },
    },
    'ou_a',
    'alice'
  );
  assert.equal(reg.ok, true);
  assert.ok(writes.some((w) => /INSERT INTO feishu_users/i.test(w.sql)));
});

test('createLarkSendApi wires methods', async () => {
  const api = createLarkSendApi({
    axios: { post: async () => ({ data: { code: 0 } }), get: async () => ({ data: Buffer.from('x') }) },
    pool: () => ({ query: async () => ({ rows: [] }) }),
    getLarkTenantToken: async () => null,
    deduplicateMessage: () => true,
    feishuSkipOpenIdResolveHrms: () => true,
    isOpenIdCrossAppFeishuError: () => false,
    refreshFeishuUserOpenIdForImDeliveryHrms: async () => null,
    getSharedState: async () => ({}),
    findUserInState: () => null,
    resolveBrandContextByStore: () => ({}),
    tenantContext: { run: async (_t, fn) => fn() },
    log: { error() {}, info() {}, warn() {} },
  });
  assert.equal(api.sanitizePerformanceZhText('x'), 'x');
  assert.equal((await api.sendLarkMessage('ou', 'hi')).ok, false);
  assert.equal(await api.getLarkImageUrl('m', 'k'), null);
});
