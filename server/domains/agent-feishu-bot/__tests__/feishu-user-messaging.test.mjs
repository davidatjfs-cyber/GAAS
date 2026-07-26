import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFeishuUserInfoBody,
  lookupFeishuUserBody,
  lookupFeishuUserByUsernameBody,
  pushIssueToAssigneeBody,
  recognizeLarkAudioBody,
  replyLarkMessageBody,
  tryAutoBindByNameBody,
} from '../feishu-user-messaging-io.js';
import { createFeishuUserMessagingApi } from '../feishu-user-messaging.js';

function baseLog() {
  return { info() {}, warn() {}, error() {} };
}

test('recognizeLarkAudioBody uses IM recognition first', async () => {
  const text = await recognizeLarkAudioBody(
    {
      getLarkTenantToken: async () => 'tok',
      axios: {
        get: async () => ({
          data: { data: { body: { content: JSON.stringify({ recognition: '  你好门店  ' }) } } },
        }),
      },
      log: baseLog(),
    },
    'mid',
    'fkey'
  );
  assert.equal(text, '你好门店');
});

test('recognizeLarkAudioBody falls back to speech API', async () => {
  let posts = 0;
  const text = await recognizeLarkAudioBody(
    {
      getLarkTenantToken: async () => 'tok',
      axios: {
        get: async (url) => {
          if (url.includes('/resources/')) {
            return { data: Buffer.from('audio') };
          }
          return { data: { data: { body: { content: '{}' } } } };
        },
        post: async () => {
          posts += 1;
          return { data: { data: { recognition_text: '语音文本' } } };
        },
      },
      log: baseLog(),
    },
    'mid',
    'fkey'
  );
  assert.equal(text, '语音文本');
  assert.equal(posts, 1);
});

test('replyLarkMessageBody / lookup helpers', async () => {
  const reply = await replyLarkMessageBody(
    {
      getLarkTenantToken: async () => 'tok',
      axios: { post: async () => ({ data: { code: 0 } }) },
      log: baseLog(),
    },
    'm1',
    'hi'
  );
  assert.deepEqual(reply, { ok: true });

  const seen = [];
  const user = await lookupFeishuUserBody(
    {
      pool: () => ({
        query: async (_sql, params) => {
          seen.push(params[0]);
          return { rows: params[0] === 'ou_hit' ? [{ open_id: 'ou_hit' }] : [] };
        },
      }),
      tenantContext: { run: async (_t, fn) => fn() },
      getActiveTenantIds: async () => ['t1', 't2'],
    },
    'ou_hit'
  );
  assert.equal(user.open_id, 'ou_hit');
  assert.deepEqual(seen, ['ou_hit']);

  const byName = await lookupFeishuUserByUsernameBody(
    {
      pool: () => ({
        query: async () => ({ rows: [{ open_id: 'ou_u', username: 'alice' }] }),
      }),
      log: baseLog(),
    },
    'alice'
  );
  assert.equal(byName.username, 'alice');
});

test('tryAutoBindByNameBody exact name and phone', async () => {
  const regs = [];
  const bound = await tryAutoBindByNameBody(
    {
      getLarkTenantToken: async () => 'tok',
      axios: {
        get: async () => ({ data: { data: { user: { name: '张三', mobile: '+8613812345678' } } } }),
      },
      getSharedState: async () => ({
        employees: [{ name: '张三', username: 'zhangsan', store: '洪潮店', status: 'active' }],
      }),
      registerFeishuUser: async (openId, username) => {
        regs.push({ openId, username });
        return { ok: true, username };
      },
      log: baseLog(),
    },
    'ou_1'
  );
  assert.equal(bound.ok, true);
  assert.deepEqual(regs, [{ openId: 'ou_1', username: 'zhangsan' }]);

  const phoneBound = await tryAutoBindByNameBody(
    {
      getLarkTenantToken: async () => 'tok',
      axios: {
        get: async () => ({ data: { data: { user: { name: '路人', mobile: '13900001111' } } } }),
      },
      getSharedState: async () => ({
        employees: [{ name: '李四', username: 'lisi', phone: '13900001111', store: '马己仙', status: 'active' }],
      }),
      registerFeishuUser: async (_o, username) => ({ ok: true, username }),
      log: baseLog(),
    },
    'ou_2'
  );
  assert.equal(phoneBound.username, 'lisi');
});

test('pushIssueToAssigneeBody high severity cc', async () => {
  const sent = [];
  const out = await pushIssueToAssigneeBody(
    {
      getSharedState: async () => ({
        employees: [
          { username: 'hq1', role: 'hq_manager' },
          { username: 'adm1', role: 'admin' },
        ],
      }),
      pool: () => ({
        query: async (_sql, params) => {
          const u = params[0];
          const map = {
            store_mgr: { open_id: 'ou_s', username: 'store_mgr' },
            hq1: { open_id: 'ou_h', username: 'hq1' },
            adm1: { open_id: 'ou_a', username: 'adm1' },
          };
          return { rows: map[u] ? [map[u]] : [] };
        },
      }),
      sendLarkMessage: async (openId, text) => {
        sent.push({ openId, text });
        return { ok: true };
      },
      log: baseLog(),
    },
    { id: 9, assignee_username: 'store_mgr', severity: 'high' },
    '请整改',
    'default'
  );
  assert.equal(out.recipients, 3);
  assert.equal(sent.length, 3);
  assert.ok(sent.some((s) => s.text.includes('【OP督办】')));
  assert.ok(sent.some((s) => s.text.includes('抄送总部营运')));
});

test('createFeishuUserMessagingApi wires methods', async () => {
  const api = createFeishuUserMessagingApi({
    getLarkTenantToken: async () => null,
    axios: {},
    pool: () => ({ query: async () => ({ rows: [] }) }),
    tenantContext: { run: async (_t, fn) => fn() },
    getActiveTenantIds: async () => [],
    getSharedState: async () => ({}),
    registerFeishuUser: async () => ({ ok: false }),
    sendLarkMessage: async () => ({ ok: false }),
    log: baseLog(),
  });
  assert.equal(await api.recognizeLarkAudio('m', 'f'), null);
  assert.equal(await api.lookupFeishuUser('ou_x'), null);
});

test('getFeishuUserInfoBody null token', async () => {
  assert.equal(
    await getFeishuUserInfoBody(
      { getLarkTenantToken: async () => null, axios: {}, log: baseLog() },
      'ou'
    ),
    null
  );
});
