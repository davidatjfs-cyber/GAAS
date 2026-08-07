/**
 * 转化闭环回归闸门（P0-P2）：
 * 1. 购买意向/经营痛点不再被误判成"查不到系统说明"（真实事故：客户说
 *    "我对你们系统蛮感兴趣的"被回 product_knowledge_unanswered 堵死）。
 * 2. 诊断交付门槛放宽：有门店数+痛点即出诊断，不再永远卡在"收满10个槽位"。
 * 3. 企微会话状态流转(1→2/3)请求体正确。
 * 4. sync_msg 按 origin 分流：真人客户端消息(origin=5)回传 CRM 且不触发 AI。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProductQuery, isOurSystemFeatureQuestion } from '../services/sales/sales-product-knowledge.js';
import { isDiagnosisReady, buildStrategyPlan } from '../services/sales/sales-strategy.js';
import {
  setSalesKfFetch,
  transKfServiceState,
  handoffKfToHumanQueue,
  listKfServicers,
  processKfCallbackEvent,
} from '../services/sales/sales-kf.js';

const json = (body) => ({ ok: true, status: 200, json: async () => body });

// getAccessToken 会先校验企微凭据环境变量再走 mock fetch
process.env.WECOM_KF_CORP_ID = 'corp-test';
process.env.WECOM_KF_SECRET = 'secret-test';
process.env.WECOM_KF_OPEN_KFID = 'wk1';

test('购买意向/经营痛点不再被误判为产品功能问题', () => {
  assert.equal(classifyProductQuery('我对你们系统蛮感兴趣的').isProductQuery, false);
  assert.equal(classifyProductQuery('外卖平台抽成太高怎么办').isProductQuery, false);
  assert.equal(isOurSystemFeatureQuestion('我对你们系统蛮感兴趣的'), false);
  assert.equal(isOurSystemFeatureQuestion('外卖平台抽成太高怎么办'), false);
  assert.equal(isOurSystemFeatureQuestion('你们系统的员工模块怎么用'), true);
  assert.equal(isOurSystemFeatureQuestion('系统里怎么给员工排班'), true);
});

test('isDiagnosisReady：核心信息够用即出诊断', () => {
  assert.equal(isDiagnosisReady({ store_count: 3, pain_point: '营业额下降' }), true);
  assert.equal(isDiagnosisReady({ store_count: 10, city: '北京' }, 25), true);
  assert.equal(isDiagnosisReady({ store_count: 10, city: '北京' }, 10), false);
  assert.equal(isDiagnosisReady({ city: '北京', pain_point: '复购低' }), false);
  assert.equal(isDiagnosisReady({ store_count: 3, pain_point: '执行差', diagnosis_delivered: true }), true);
});

test('buildStrategyPlan：有店数+痛点直接交付诊断，不再追问手机号，高意向给演示 CTA', () => {
  const plan = buildStrategyPlan({
    userText: '3家店，主要问题是老客复购低',
    extracted: { store_count: 3, city: '杭州', pain_point: '复购低' },
    intentScore: 35,
    controller: 'ai',
    knowledgeItems: [],
  });
  assert.equal(plan.mode, 'diagnosis_complete');
  assert.equal(plan.extracted.diagnosis_delivered, true);
  assert.equal(plan.next_question, null);
  assert.equal(plan.offer_demo, false);

  const hot = buildStrategyPlan({
    userText: '3家店，主要问题是老客复购低',
    extracted: { store_count: 3, city: '杭州', pain_point: '复购低' },
    intentScore: 50,
    controller: 'ai',
    knowledgeItems: [],
  });
  assert.equal(hot.offer_demo, true);

  const notReady = buildStrategyPlan({
    userText: '3家店',
    extracted: { store_count: 3 },
    intentScore: 0,
    controller: 'ai',
    knowledgeItems: [],
  });
  assert.equal(notReady.mode, 'diagnose');
  assert.ok(notReady.next_question?.question);
});

test('transKfServiceState：state=3 必带 servicer_userid，state=2 不带', async () => {
  const calls = [];
  setSalesKfFetch(async (url, opts) => {
    calls.push({ url, body: JSON.parse(String(opts?.body || '{}')) });
    if (url.includes('/gettoken')) return json({ errcode: 0, access_token: 't', expires_in: 7200 });
    if (url.includes('/service_state/trans')) return json({ errcode: 0, errmsg: 'ok', msg_code: 'code' });
    return json({ errcode: 40001, errmsg: 'unexpected' });
  });

  await transKfServiceState({ openKfid: 'wk1', externalUserid: 'wm1', serviceState: 3, servicerUserid: 'zhangsan' });
  const to3 = calls.find((c) => c.url.includes('/service_state/trans'));
  assert.deepEqual(to3.body, { open_kfid: 'wk1', external_userid: 'wm1', service_state: 3, servicer_userid: 'zhangsan' });

  await handoffKfToHumanQueue({ openKfid: 'wk1', externalUserid: 'wm1' });
  const to2 = calls.filter((c) => c.url.includes('/service_state/trans')).pop();
  assert.equal(to2.body.service_state, 2);
  assert.equal(to2.body.servicer_userid, undefined);
});

test('listKfServicers：返回接待人员列表', async () => {
  setSalesKfFetch(async (url) => {
    if (url.includes('/gettoken')) return json({ errcode: 0, access_token: 't', expires_in: 7200 });
    if (url.includes('/servicer/list')) return json({ errcode: 0, errmsg: 'ok', servicer_list: [{ userid: 'zhangsan', status: 1 }] });
    return json({ errcode: 40001, errmsg: 'unexpected' });
  });
  const list = await listKfServicers({ openKfid: 'wk1' });
  assert.deepEqual(list, [{ userid: 'zhangsan', status: 1 }]);
});

test('processKfCallbackEvent：origin=5 真人消息只回传不触发 AI，origin=3 客户消息走 AI', async () => {
  const msgs = [
    { msgid: 'm1', open_kfid: 'wk1', external_userid: 'wm1', origin: 3, msgtype: 'text', text: { content: '你好' } },
    { msgid: 'm2', open_kfid: 'wk1', external_userid: 'wm1', origin: 5, servicer_userid: 'zhangsan', msgtype: 'text', text: { content: '您好，我是谢总' } },
  ];
  let aiCalls = 0;
  let agentCalls = 0;
  setSalesKfFetch(async (url) => {
    if (url.includes('/gettoken')) return json({ errcode: 0, access_token: 't', expires_in: 7200 });
    if (url.includes('/sync_msg')) return json({ errcode: 0, next_cursor: 'c2', msg_list: msgs });
    return json({ errcode: 0, errmsg: 'ok' });
  });
  const pool = { query: async () => ({ rows: [] }) };
  await processKfCallbackEvent(
    pool,
    { token: '', openKfid: 'wk1' },
    async () => { aiCalls += 1; return { ok: true, replied: false }; },
    { notify: null, handleAgentMessage: async () => { agentCalls += 1; } }
  );
  assert.equal(aiCalls, 1);
  assert.equal(agentCalls, 1);
});
