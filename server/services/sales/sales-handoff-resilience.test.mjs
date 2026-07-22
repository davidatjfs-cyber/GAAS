import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDeferredHandoffReply,
  findAssignableSalesRep,
  resolveHandoffController,
} from './sales-session.js';
import {
  recordKfDelivery,
  sendKfText,
  setSalesKfFetch,
} from './sales-kf.js';

function jsonResponse(data) {
  return { ok: true, async json() { return data; } };
}

test('没有可接管销售时继续由客户AI接待，不能进入waiting_human', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };
  const repKey = await findAssignableSalesRep(pool, { region_code: 'east', assigned_to: null });
  const resolved = resolveHandoffController({ requested: true, repKey, currentController: 'ai' });
  assert.equal(repKey, null);
  assert.deepEqual(resolved, { takeover: false, deferred: true, controller: 'ai' });
  assert.match(queries[0].sql, /status='active'/);
  assert.match(queries[0].sql, /sales_manager/);
  assert.match(buildDeferredHandoffReply(), /继续在这里为您解答/);
  assert.doesNotMatch(buildDeferredHandoffReply(), /已经转人工|正在接手/);
});

test('存在可用销售时才进入waiting_human', () => {
  assert.deepEqual(
    resolveHandoffController({ requested: true, repKey: 'sales_01', currentController: 'ai' }),
    { takeover: true, deferred: false, controller: 'waiting_human' }
  );
});

test('企微会话处于待人工状态2时停止假发送并返回明确错误', async () => {
  const calls = [];
  process.env.WECOM_KF_CORP_ID = 'corp';
  process.env.WECOM_KF_SECRET = 'secret';
  setSalesKfFetch(async (url) => {
    calls.push(String(url));
    if (String(url).includes('/gettoken')) return jsonResponse({ errcode: 0, access_token: 'token', expires_in: 7200 });
    if (String(url).includes('/service_state/get')) return jsonResponse({ errcode: 0, service_state: 2 });
    throw new Error('send_should_not_be_called');
  });
  await assert.rejects(
    sendKfText({ openKfid: 'wk', externalUserid: 'wm', content: '回复' }),
    /kf_session_not_ai_service_state_2/
  );
  assert.equal(calls.some((url) => url.includes('/kf/send_msg')), false);
  setSalesKfFetch(null);
});

test('企微未处理状态0先认领为AI状态1再发送', async () => {
  const calls = [];
  process.env.WECOM_KF_CORP_ID = 'corp';
  process.env.WECOM_KF_SECRET = 'secret';
  setSalesKfFetch(async (url) => {
    calls.push(String(url));
    if (String(url).includes('/gettoken')) return jsonResponse({ errcode: 0, access_token: 'token', expires_in: 7200 });
    if (String(url).includes('/service_state/get')) return jsonResponse({ errcode: 0, service_state: 0 });
    if (String(url).includes('/service_state/trans')) return jsonResponse({ errcode: 0, errmsg: 'ok' });
    if (String(url).includes('/kf/send_msg')) return jsonResponse({ errcode: 0, msgid: 'msg_1' });
    throw new Error(`unexpected_url:${url}`);
  });
  const result = await sendKfText({ openKfid: 'wk', externalUserid: 'wm', content: '回复' });
  assert.equal(result.msgid, 'msg_1');
  assert.equal(calls.some((url) => url.includes('/service_state/trans')), true);
  assert.equal(calls.some((url) => url.includes('/kf/send_msg')), true);
  setSalesKfFetch(null);
});

test('企微发送失败写回消息状态并生成严重事件', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [], rowCount: 1 };
    },
  };
  const turn = { outbound_message_id: 293, lead_id: 5 };
  const result = await recordKfDelivery(pool, turn, {
    status: 'failed', channel: 'text', error: new Error('kf_session_not_ai_service_state_2'),
  });
  assert.equal(result.updated, true);
  assert.equal(turn.delivery_status, 'failed');
  assert.match(turn.send_error, /service_state_2/);
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /UPDATE sales_messages SET meta/);
  assert.match(queries[1].sql, /CUSTOMER_AI_DELIVERY_FAILED/);
  assert.match(queries[1].sql, /critical/);
});

test('销售CRM明确显示企微送达、发送中和失败状态', () => {
  const html = readFileSync(new URL('../../../platform-admin.html', import.meta.url), 'utf8');
  assert.match(html, /已送达企微/);
  assert.match(html, /发送中/);
  assert.match(html, /发送失败：/);
});
