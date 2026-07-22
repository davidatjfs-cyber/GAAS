import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDeferredHandoffReply,
  findAssignableSalesRep,
  recordCustomerConversionIntent,
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

test('无人接管时必须保留已经回答的价格或折扣信息，只追加简短跟进说明', () => {
  const reply = buildDeferredHandoffReply(
    '门店数量增加时，单店成本通常有优化空间，具体优惠需要按方案审批。',
    { preserveAnswer: true }
  );
  assert.match(reply, /单店成本通常有优化空间/);
  assert.match(reply, /具体优惠需要按方案审批/);
  assert.match(reply, /继续.*回答/);
  assert.doesNotMatch(reply, /当前暂时没有可立即接管的顾问/);
});

test('存在可用销售时才进入waiting_human', () => {
  assert.deepEqual(
    resolveHandoffController({ requested: true, repKey: 'sales_01', currentController: 'ai' }),
    { takeover: true, deferred: false, controller: 'waiting_human' }
  );
});

test('客户AI识别到Demo后必须写转化动作并创建去重跟进任务', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{ id: 88 }], rowCount: 1 };
    },
  };
  const result = await recordCustomerConversionIntent(pool, {
    leadId: 5,
    leadKey: 'L5',
    assignee: 'adminxie',
    conversion: {
      goal: 'demo',
      action_type: 'customer_ai_demo_requested',
      task_title: '客户请求针对性演示',
      task_detail: '按3家门店、多店管理准备演示',
      due_hours: 0.2,
      priority: 'high',
    },
    evidence: '可以给我安排个演示吗',
  });
  assert.equal(result.recorded, true);
  assert.ok(queries.some((q) => /INSERT INTO sales_action_logs/.test(q.sql)));
  const taskQuery = queries.find((q) => /INSERT INTO sales_tasks/.test(q.sql));
  assert.ok(taskQuery);
  assert.ok(taskQuery.params.includes('客户请求针对性演示'));
  assert.ok(taskQuery.params.includes('adminxie'));
  assert.match(taskQuery.sql, /ON CONFLICT \(lead_id, title\).*status='open'/);
});

test('转化意向落库payload字段完整，异议同步写入异议表', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{ id: 77 }], rowCount: 1 };
    },
  };
  const result = await recordCustomerConversionIntent(pool, {
    leadId: 42,
    leadKey: 'wx_abc',
    assignee: 'sales_01',
    conversion: {
      goal: 'resolve_objection',
      action_type: 'customer_ai_objection_handled',
      priority: 'high',
      due_hours: 4,
      objection_key: 'too_complex',
      objection_label: '系统太复杂',
      response_text: 'AI已先回应',
      task_title: '跟进客户异议：系统太复杂',
      task_detail: '客户异议：我担心系统太复杂。',
    },
    evidence: '我担心系统太复杂，店长不会用。',
  });
  assert.equal(result.recorded, true);
  assert.equal(result.task?.id, 77);
  const actionInsert = queries.find((q) => /INSERT INTO sales_action_logs/.test(q.sql));
  assert.ok(actionInsert);
  assert.equal(actionInsert.params[0], 42);
  assert.equal(actionInsert.params[1], 'customer_ai_objection_handled');
  const payload = JSON.parse(actionInsert.params[2]);
  assert.equal(payload.goal, 'resolve_objection');
  assert.equal(payload.priority, 'high');
  assert.equal(payload.objection_key, 'too_complex');
  assert.equal(payload.evidence, '我担心系统太复杂，店长不会用。');
  assert.equal(payload.lead_key, 'wx_abc');
  const objectionInsert = queries.find((q) => /INSERT INTO sales_objections/.test(q.sql));
  assert.ok(objectionInsert);
  assert.equal(objectionInsert.params[1], 'too_complex');
  assert.equal(objectionInsert.params[5], 'customer_ai');
  // 异议由AI直接回应、没有转人工(controller未传/非waiting_human)，不应该压一条SLA倒计时，
  // 否则销售会被"客户其实已经被AI安抚住了"的异议无谓报警。
  assert.ok(!queries.some((q) => /UPDATE sales_leads[\s\S]*sla_due_at/.test(q.sql)));
});

test('客户询价/要演示这类高意向转人工时刻必须压紧SLA倒计时，喂给已有的报警扫描', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rows: [{ id: 99 }], rowCount: 1 };
    },
  };
  const before = Date.now();
  await recordCustomerConversionIntent(pool, {
    leadId: 7,
    leadKey: 'wx_urgent',
    assignee: 'sales_02',
    conversion: {
      goal: 'demo',
      action_type: 'customer_ai_demo_requested',
      priority: 'high',
      due_hours: 0.2,
      task_title: '客户请求针对性演示',
      task_detail: '按3家门店、多店管理准备演示',
    },
    evidence: '可以给我安排个演示吗',
    controller: 'waiting_human',
  });
  const slaUpdate = queries.find((q) => /UPDATE sales_leads[\s\S]*sla_due_at/.test(q.sql));
  assert.ok(slaUpdate, '高意向转人工时刻必须刷新sla_due_at，否则销售不响应也不会被5分钟一次的SLA扫描报警');
  assert.match(slaUpdate.sql, /LEAST\(COALESCE\(sla_due_at/);
  assert.match(slaUpdate.sql, /stage NOT IN \('won','lost','unfit'\)/);
  assert.equal(slaUpdate.params[0], 7);
  const dueAt = new Date(slaUpdate.params[1]).getTime();
  assert.ok(dueAt >= before + 0.2 * 3600000 - 2000 && dueAt <= before + 0.2 * 3600000 + 5000, 'due_hours=0.2应换算成约12分钟后');
});

test('培育型转化(due_hours较长)或未转人工时不得压SLA，避免把长周期培育当成紧急报警', async () => {
  const queries = [];
  const pool = { async query(sql, params) { queries.push({ sql: String(sql), params }); return { rows: [{ id: 1 }], rowCount: 1 }; } };
  await recordCustomerConversionIntent(pool, {
    leadId: 8,
    conversion: { goal: 'case_proof', action_type: 'customer_ai_case_requested', priority: 'high', due_hours: 4, task_title: '客户请求经授权真实案例' },
    evidence: '有没有案例',
    controller: 'waiting_human',
  });
  await recordCustomerConversionIntent(pool, {
    leadId: 9,
    conversion: { goal: 'demo', action_type: 'customer_ai_demo_requested', priority: 'high', due_hours: 0.2, task_title: '客户请求针对性演示' },
    evidence: '演示一下',
    controller: 'ai',
  });
  assert.ok(!queries.some((q) => /UPDATE sales_leads[\s\S]*sla_due_at/.test(q.sql)));
});

test('无转化意向时不写任何库，转化写库失败必须以拒绝暴露(调用点负责兜底不断主链路)', async () => {
  const queries = [];
  const quietPool = { async query(sql, params) { queries.push(sql); return { rows: [] }; } };
  const noop = await recordCustomerConversionIntent(quietPool, { leadId: 1, conversion: null, evidence: 'x' });
  assert.deepEqual(noop, { recorded: false });
  assert.equal(queries.length, 0);

  const failingPool = { async query() { throw new Error('db down'); } };
  await assert.rejects(
    () => recordCustomerConversionIntent(failingPool, {
      leadId: 1,
      conversion: { goal: 'demo', action_type: 'customer_ai_demo_requested' },
      evidence: 'x',
    }),
    /db down/
  );
  const sessionSource = readFileSync(new URL('./sales-session.js', import.meta.url), 'utf8');
  const callSite = sessionSource.slice(sessionSource.indexOf('await recordCustomerConversionIntent(pool'));
  assert.match(callSite.slice(0, 400), /\.catch\(/, 'handleInboundMessage里的转化落库调用必须有catch兜底,失败不能中断客户回复主链路');
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
