import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PREFIX, prefixWithAgentName } from '../agent-prefix.js';
import { checkAgentPermission } from '../check-agent-permission.js';
import { AGENT_EVAL_CASES, createRunAgentEvalSuite } from '../eval-suite.js';
import { buildFeishuCardFromAgentReply } from '../feishu-reply-card.js';

test('prefixWithAgentName uses AGENT_PREFIX or HRMS fallback', () => {
  assert.equal(prefixWithAgentName('data_auditor', '你好'), '小年：你好');
  assert.equal(AGENT_PREFIX.ops_supervisor, '小年');
  assert.equal(prefixWithAgentName('unknown_route', 'x'), 'HRMS：x');
});

test('checkAgentPermission allows admin and route roles; denies others', () => {
  assert.deepEqual(checkAgentPermission('admin', 'data_auditor'), { allowed: true });
  assert.deepEqual(checkAgentPermission('store_manager', 'data_auditor'), { allowed: true });
  assert.equal(checkAgentPermission('cashier', 'ops_supervisor').allowed, false);
  assert.match(checkAgentPermission('cashier', 'ops_supervisor').reason, /角色/);
  assert.deepEqual(checkAgentPermission('', 'data_auditor'), { allowed: true });
  assert.deepEqual(checkAgentPermission('staff', 'general'), { allowed: true });
});

test('buildFeishuCardFromAgentReply null-safe and templates by route', () => {
  assert.equal(buildFeishuCardFromAgentReply('master', null), null);
  const card = buildFeishuCardFromAgentReply('ops_supervisor', '检查完成');
  assert.equal(card.header.template, 'green');
  assert.equal(card.elements[0].text.content, '检查完成');
});

test('createRunAgentEvalSuite scores route/demand and persists summary', async () => {
  const inserts = [];
  const run = createRunAgentEvalSuite({
    pool: () => ({
      query: async (_sql, params) => {
        inserts.push(params);
        return { rows: [] };
      },
    }),
    routeMessage: async (text) => {
      const hit = AGENT_EVAL_CASES.find((c) => c.text === text);
      return { route: hit?.route || 'general' };
    },
    log: { error: () => {} },
  });
  const summary = await run({ suiteName: 'unit', createdBy: 't', tenantId: 'default' });
  assert.equal(summary.total, AGENT_EVAL_CASES.length);
  assert.equal(summary.routeHit, AGENT_EVAL_CASES.length);
  assert.equal(summary.routeAccuracy, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], 'unit');
});

test('createRunAgentEvalSuite continues when routeMessage throws; persist failure is non-fatal', async () => {
  const errs = [];
  const run = createRunAgentEvalSuite({
    pool: () => ({
      query: async () => {
        throw new Error('db down');
      },
    }),
    routeMessage: async () => {
      throw new Error('route boom');
    },
    log: { error: (...a) => errs.push(a.join(' ')) },
  });
  const summary = await run();
  assert.equal(summary.total, AGENT_EVAL_CASES.length);
  // '你好' expected route is general — still counts as routeHit even when routeMessage throws
  assert.equal(summary.routeHit, 1);
  assert.ok(summary.cases.every((c) => c.error.includes('route boom')));
  assert.ok(errs.some((e) => /persist failed/.test(e)));
});
