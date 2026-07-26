import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOnFeishuEvent,
  markEventProcessed,
  hasProcessedEvent,
  _resetProcessedEventsForTests,
} from '../on-feishu-event.js';

function registeredUser(overrides = {}) {
  return {
    open_id: 'ou_1',
    registered: true,
    username: 'u1',
    name: '甲',
    store: '洪潮久光店',
    role: 'store_manager',
    tenant_id: 'default',
    ...overrides,
  };
}

function textMsgBody({ text = '你好', openId = 'ou_1', chatType = 'p2p', eventId = 'ev1', extraMsg = {} } = {}) {
  return {
    header: { event_id: eventId, event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: openId } },
      message: {
        message_type: 'text',
        message_id: 'm1',
        chat_type: chatType,
        content: JSON.stringify({ text }),
        ...extraMsg,
      },
    },
  };
}

function makeHandler(overrides = {}) {
  const calls = { lark: [], card: [], ham: [], sql: [] };
  let msgIdSeq = 10;
  const deps = {
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params });
        if (/RETURNING id/i.test(sql)) {
          return { rows: [{ id: ++msgIdSeq }] };
        }
        return { rows: [] };
      },
    }),
    lookupFeishuUser: async () => registeredUser(),
    tryAutoBindByName: async () => null,
    registerFeishuUser: async () => ({ ok: false, error: 'nope' }),
    sendLarkMessage: async (openId, text, opts) => {
      calls.lark.push({ openId, text, opts });
      return { ok: true };
    },
    sendLarkCard: async (openId, card) => {
      calls.card.push({ openId, card });
      return { ok: true };
    },
    getLarkImageUrl: async () => 'https://img.example/1.jpg',
    recognizeLarkAudio: async () => '语音识别结果',
    getSharedState: async () => ({
      employees: [{ username: 'u1', status: 'active' }],
    }),
    resolveBrandContextByStore: () => ({ brandName: '洪潮' }),
    routeMessage: async () => ({ route: 'general' }),
    checkAgentPermission: () => ({ allowed: true }),
    prefixWithAgentName: (route, text) => `[${route}] ${text}`,
    handleAgentMessage: async (...args) => {
      calls.ham.push(args);
      return { route: 'general', response: '答', agentData: {} };
    },
    handleOpsChecklistCardAction: async () => ({ ok: true, card: true }),
    tryCaptureOpsChecklistDetailFromChat: async () => ({ handled: false }),
    tryFeishuMarketingCopyRound: async () => null,
    detectOpsChecklistType: () => null,
    getTaskResponseHook: () => null,
    ...overrides,
  };
  return { onEvent: createOnFeishuEvent(deps), calls, deps };
}

test.beforeEach(() => {
  _resetProcessedEventsForTests();
});

test('url_verification returns challenge', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent({ type: 'url_verification', challenge: 'tok' });
  assert.deepEqual(r, { challenge: 'tok' });
});

test('challenge-only body also verifies', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent({ challenge: 'c2' });
  assert.deepEqual(r, { challenge: 'c2' });
});

test('dedup skips second event with same id', async () => {
  const { onEvent } = makeHandler();
  const body = textMsgBody({ eventId: 'dup1' });
  const r1 = await onEvent(body);
  assert.equal(r1.ok, true);
  const r2 = await onEvent(body);
  assert.deepEqual(r2, { ok: true, dedup: true });
});

test('markEventProcessed evicts after 500', () => {
  // size>500 时先踢再加；第 502 次写入才会丢掉 e0
  for (let i = 0; i < 502; i++) markEventProcessed(`e${i}`);
  assert.equal(hasProcessedEvent('e0'), false);
  assert.equal(hasProcessedEvent('e501'), true);
});

test('card.action.trigger delegates', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent({
    header: { event_id: 'c1', event_type: 'card.action.trigger' },
    event: { action: { value: 'x' } },
  });
  assert.deepEqual(r, { ok: true, card: true });
});

test('no_sender skipped', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent({
    header: { event_id: 'ns', event_type: 'im.message.receive_v1' },
    event: { message: { chat_type: 'p2p', message_type: 'text', content: '{}' }, sender: {} },
  });
  assert.deepEqual(r, { ok: true, skipped: 'no_sender' });
});

test('non-private skipped', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent(textMsgBody({ chatType: 'group', eventId: 'g1' }));
  assert.deepEqual(r, { ok: true, skipped: 'not_private' });
});

test('unhandled event type', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent({
    header: { event_id: 'u1', event_type: 'app.ticket_v1' },
    event: {},
  });
  assert.deepEqual(r, { ok: true, unhandled: 'app.ticket_v1' });
});

test('register success with typed username', async () => {
  const { onEvent, calls } = makeHandler({
    lookupFeishuUser: async () => null,
    registerFeishuUser: async () => ({
      ok: true,
      user: { username: 'u9', name: '乙', store: '店' },
    }),
  });
  const r = await onEvent(textMsgBody({ text: 'u9', eventId: 'reg1' }));
  assert.equal(r.registered, true);
  assert.equal(r.username, 'u9');
  assert.ok(calls.lark.some((m) => /绑定成功/.test(m.text)));
});

test('register fail then pendingRegistration', async () => {
  const { onEvent, calls } = makeHandler({
    lookupFeishuUser: async () => ({ registered: false }),
    registerFeishuUser: async () => ({ ok: false, error: 'bad' }),
  });
  const r = await onEvent(textMsgBody({ text: 'baduser', eventId: 'reg2' }));
  assert.equal(r.pendingRegistration, true);
  assert.ok(calls.lark.some((m) => /绑定HRMS账号/.test(m.text)));
  assert.ok(calls.sql.some((q) => /INSERT INTO feishu_users/i.test(q.sql)));
});

test('unregistered image asks for username', async () => {
  const { onEvent } = makeHandler({
    lookupFeishuUser: async () => null,
    tryAutoBindByName: async () => null,
  });
  const r = await onEvent({
    header: { event_id: 'img0', event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: 'ou_x' } },
      message: {
        message_type: 'image',
        message_id: 'mimg',
        chat_type: 'private',
        content: JSON.stringify({ image_key: 'ik' }),
      },
    },
  });
  assert.equal(r.pendingRegistration, true);
});

test('auto-bind then fallthrough to handleAgentMessage', async () => {
  let n = 0;
  const { onEvent, calls } = makeHandler({
    lookupFeishuUser: async () => {
      n++;
      if (n === 1) return null;
      return registeredUser();
    },
    tryAutoBindByName: async () => ({
      ok: true,
      user: { username: 'u1', name: '甲', store: '洪潮久光店' },
    }),
  });
  const r = await onEvent(textMsgBody({ text: '你好', eventId: 'ab1' }));
  assert.equal(r.route, 'general');
  assert.equal(r.responded, true);
  assert.ok(calls.ham.length >= 1);
  assert.ok(calls.lark.some((m) => /已自动识别/.test(m.text)));
});

test('auto-bind without re-lookup registered returns early', async () => {
  const { onEvent } = makeHandler({
    lookupFeishuUser: async () => ({ registered: false }),
    tryAutoBindByName: async () => ({
      ok: true,
      user: { username: 'u2', name: '丙', store: '店' },
    }),
  });
  const r = await onEvent(textMsgBody({ text: 'x', eventId: 'ab2' }));
  assert.deepEqual(r, { ok: true, registered: true, autoBound: true, username: 'u2' });
});

test('inactive employee blocked', async () => {
  const { onEvent, calls } = makeHandler({
    getSharedState: async () => ({
      employees: [{ username: 'u1', status: 'resigned' }],
    }),
  });
  const r = await onEvent(textMsgBody({ eventId: 'inact' }));
  assert.equal(r.blocked, 'inactive');
  assert.ok(calls.sql.some((q) => /UPDATE feishu_users SET registered=FALSE/i.test(q.sql)));
});

test('deleted employee blocked', async () => {
  const { onEvent } = makeHandler({
    getSharedState: async () => ({ employees: [] }),
  });
  const r = await onEvent(textMsgBody({ eventId: 'del' }));
  assert.equal(r.blocked, 'deleted');
});

test('happy path text → handleAgentMessage + update', async () => {
  const { onEvent, calls } = makeHandler();
  const r = await onEvent(textMsgBody({ text: '今天天气', eventId: 'hp1' }));
  assert.equal(r.route, 'general');
  assert.equal(r.responded, true);
  assert.ok(calls.sql.some((q) => /INSERT INTO agent_messages/i.test(q.sql)));
  assert.ok(calls.sql.some((q) => /UPDATE agent_messages SET routed_to/i.test(q.sql)));
  assert.ok(calls.lark.some((m) => /\[general\] 答/.test(m.text)));
});

test('permission denied', async () => {
  const { onEvent } = makeHandler({
    routeMessage: async () => ({ route: 'data_auditor' }),
    checkAgentPermission: () => ({ allowed: false, reason: '角色不足' }),
  });
  const r = await onEvent(textMsgBody({ text: '营收', eventId: 'perm' }));
  assert.equal(r.denied, true);
  assert.equal(r.route, 'data_auditor');
});

test('task hook handled', async () => {
  const { onEvent, calls } = makeHandler({
    getTaskResponseHook: () => async () => ({
      handled: true,
      response: '任务已收',
      taskId: 'TASK-1',
    }),
  });
  const r = await onEvent(
    textMsgBody({
      text: '已完成',
      eventId: 'task1',
      extraMsg: { parent_id: 'pm1' },
    })
  );
  assert.equal(r.route, 'master');
  assert.equal(r.taskId, 'TASK-1');
  assert.ok(calls.lark.some((m) => /任务已收/.test(m.text)));
});

test('marketing copy round handled', async () => {
  const { onEvent } = makeHandler({
    tryFeishuMarketingCopyRound: async () => ({
      handled: true,
      body: { ok: true, route: 'master', marketingCopy: 'hint' },
    }),
  });
  const r = await onEvent(textMsgBody({ text: '文案', eventId: 'mc1' }));
  assert.equal(r.marketingCopy, 'hint');
});

test('ops checklist detail captured', async () => {
  const { onEvent } = makeHandler({
    tryCaptureOpsChecklistDetailFromChat: async () => ({ handled: true }),
  });
  const r = await onEvent(textMsgBody({ text: '补充说明', eventId: 'cd1' }));
  assert.equal(r.checklistDetailCaptured, true);
});

test('opening checklist sends bitable card', async () => {
  const { onEvent, calls } = makeHandler({
    detectOpsChecklistType: () => 'opening',
  });
  const r = await onEvent(textMsgBody({ text: '开市检查', eventId: 'ck1' }));
  assert.equal(r.bitableForm, true);
  assert.equal(calls.card.length, 1);
});

test('checklist card fail falls back to text', async () => {
  const { onEvent, calls } = makeHandler({
    detectOpsChecklistType: () => 'closing',
    sendLarkCard: async () => ({ ok: false }),
  });
  const r = await onEvent(textMsgBody({ text: '收档检查', eventId: 'ck2' }));
  assert.equal(r.bitableForm, true);
  assert.ok(calls.lark.some((m) => /请填写收档检查表/.test(m.text)));
});

test('image message downloads and routes', async () => {
  const { onEvent, calls } = makeHandler();
  const r = await onEvent({
    header: { event_id: 'img1', event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_type: 'image',
        message_id: 'mimg2',
        chat_type: 'p2p',
        content: JSON.stringify({ image_key: 'ik2' }),
      },
    },
  });
  assert.equal(r.responded, true);
  assert.ok(calls.ham[0][6].includes('https://img.example/1.jpg'));
  assert.ok(calls.lark.some((m) => /正在审核/.test(m.text)));
});

test('audio recognized to text', async () => {
  const { onEvent, calls } = makeHandler();
  const r = await onEvent({
    header: { event_id: 'au1', event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_type: 'audio',
        message_id: 'mau',
        chat_type: 'p2p',
        content: JSON.stringify({ file_key: 'fk' }),
      },
    },
  });
  assert.equal(r.responded, true);
  assert.equal(calls.ham[0][5], '语音识别结果');
});

test('audio asr empty', async () => {
  const { onEvent } = makeHandler({
    recognizeLarkAudio: async () => '',
  });
  const r = await onEvent({
    header: { event_id: 'au2', event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_type: 'audio',
        message_id: 'mau2',
        chat_type: 'p2p',
        content: JSON.stringify({ file_key: 'fk' }),
      },
    },
  });
  assert.equal(r.skipped, 'asr_empty');
});

test('audio missing file_key', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent({
    header: { event_id: 'au3', event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_type: 'audio',
        message_id: 'mau3',
        chat_type: 'p2p',
        content: '{}',
      },
    },
  });
  assert.equal(r.skipped, 'audio_no_filekey');
});

test('audio throw → asr_error', async () => {
  const { onEvent } = makeHandler({
    recognizeLarkAudio: async () => {
      throw new Error('asr down');
    },
  });
  const r = await onEvent({
    header: { event_id: 'au4', event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_type: 'audio',
        message_id: 'mau4',
        chat_type: 'p2p',
        content: JSON.stringify({ file_key: 'fk' }),
      },
    },
  });
  assert.equal(r.skipped, 'asr_error');
});

test('unsupported message type', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent({
    header: { event_id: 'st1', event_type: 'im.message.receive_v1' },
    event: {
      sender: { sender_id: { open_id: 'ou_1' } },
      message: {
        message_type: 'file',
        message_id: 'mf',
        chat_type: 'p2p',
        content: '{}',
      },
    },
  });
  assert.equal(r.skipped, 'unsupported_type');
});

test('empty text after strip skipped', async () => {
  const { onEvent } = makeHandler();
  const r = await onEvent(
    textMsgBody({
      text: '',
      eventId: 'empty1',
      extraMsg: { content: JSON.stringify({ text: '   ' }) },
    })
  );
  assert.equal(r.skipped, 'empty');
});

test('mentions stripped from text', async () => {
  const { onEvent, calls } = makeHandler();
  await onEvent(
    textMsgBody({
      text: '@小年 你好',
      eventId: 'men1',
      extraMsg: {
        content: JSON.stringify({ text: '@小年 你好' }),
        mentions: [{ name: '小年' }],
      },
    })
  );
  assert.equal(calls.ham[0][5], '你好');
});

test('slow request sends loading hint', async () => {
  const { onEvent, calls } = makeHandler();
  await onEvent(textMsgBody({ text: '昨天营业额多少', eventId: 'slow1' }));
  assert.ok(calls.lark.some((m) => /正在为您查询/.test(m.text)));
});

test('handleAgentMessage string result normalized', async () => {
  const { onEvent } = makeHandler({
    handleAgentMessage: async () => '纯文本回复',
  });
  const r = await onEvent(textMsgBody({ text: 'hi', eventId: 'str1' }));
  assert.equal(r.route, 'general');
  assert.equal(r.responded, true);
});

test('task hook throw continues to handleAgentMessage', async () => {
  const { onEvent, calls } = makeHandler({
    getTaskResponseHook: () => async () => {
      throw new Error('hook boom');
    },
  });
  const r = await onEvent(
    textMsgBody({ text: 'TASK-9 已处理', eventId: 'th1' })
  );
  assert.equal(r.route, 'general');
  assert.ok(calls.ham.length >= 1);
});

test('status check error does not block message', async () => {
  let n = 0;
  const { onEvent } = makeHandler({
    getSharedState: async () => {
      n++;
      if (n === 1) throw new Error('state down');
      return { employees: [{ username: 'u1', status: 'active' }] };
    },
  });
  const r = await onEvent(textMsgBody({ text: 'ok', eventId: 'sterr' }));
  assert.equal(r.responded, true);
});
