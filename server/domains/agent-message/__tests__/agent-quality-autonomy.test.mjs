import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutonomousTaskFingerprintBody,
  createAgentQualityMetricsState,
  markQualityMetricBody,
} from '../agent-quality-autonomy-helpers.js';
import { createAgentQualityAutonomyApi } from '../agent-quality-autonomy.js';

test('markQualityMetricBody updates known fields only', () => {
  const m = createAgentQualityMetricsState();
  markQualityMetricBody(m, 'audits', 2);
  markQualityMetricBody(m, 'unknown', 9);
  assert.equal(m.audits, 2);
  assert.ok(m.lastUpdatedAt);
  assert.equal(m.rewrites, 0);
});

test('buildAutonomousTaskFingerprintBody is stable for same inputs', () => {
  const deps = {
    normalizeStoreKey: (s) => String(s || '').trim().toLowerCase(),
    normalizePlainText: (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n),
  };
  const a = buildAutonomousTaskFingerprintBody({
    taskType: 'data_gap', store: '洪潮', route: 'bi', queryText: '营收多少',
  }, deps);
  const b = buildAutonomousTaskFingerprintBody({
    taskType: 'data_gap', store: '洪潮', route: 'bi', queryText: '营收多少',
  }, deps);
  assert.equal(a, b);
  assert.equal(a.length, 40);
});

function createApi(overrides = {}) {
  const calls = { sql: [], lark: [], interactions: [], feedback: [] };
  const api = createAgentQualityAutonomyApi({
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql, params });
        if (/SELECT memory_value/.test(sql)) {
          return { rows: [{ memory_value: { route: 'train_advisor' } }] };
        }
        if (/INSERT INTO agent_autonomous_tasks/.test(sql)) {
          return { rows: [{ id: 7, owner_username: 'owner1', task_type: 'data_gap', store: '洪潮', reason: '缺数', query_text: 'q' }] };
        }
        if (/INSERT INTO agent_quality_audits/.test(sql) && /trace_id/.test(sql)) {
          throw new Error('no_trace_col');
        }
        return { rows: [] };
      },
    }),
    resolveTenantIdDefault: () => 'default',
    normalizeStoreKey: (s) => String(s || '').trim().toLowerCase(),
    normalizePlainText: (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n),
    recordAiInteraction: async (_pool) => {
      calls.interactions.push(1);
      return 'trace-1';
    },
    recordAiFeedback: async (_pool, args) => { calls.feedback.push(args); },
    lookupFeishuUserByUsername: async (u) => (u === 'owner1' ? { open_id: 'ou_1' } : null),
    sendLarkMessage: async (openId, text) => {
      calls.lark.push({ openId, text });
      return { ok: true };
    },
    prefixWithAgentName: (_a, t) => `M:${t}`,
    log: { error() {}, info() {} },
    ...overrides,
  });
  return { api, calls };
}

test('get/setAgentLongMemory and metrics snapshot', async () => {
  const { api } = createApi();
  assert.equal(await api.getAgentLongMemory('', 'k'), null);
  const mem = await api.getAgentLongMemory('User', 'pref');
  assert.deepEqual(mem, { route: 'train_advisor' });
  await api.setAgentLongMemory('User', 'pref', { a: 1 });
  api.markQualityMetric('audits', 1);
  assert.equal(api.getAgentQualityMetrics().audits, 1);
});

test('recordAgentQualityAudit falls back without trace_id column then records feedback', async () => {
  const { api, calls } = createApi();
  await api.recordAgentQualityAudit({
    route: 'bi',
    username: 'u1',
    queryText: 'q',
    responseText: 'a',
    auditResult: { ok: false },
    passed: false,
    rewriteCount: 1,
  });
  assert.equal(calls.interactions.length, 1);
  assert.ok(calls.sql.some((c) => /agent_quality_audits/.test(c.sql) && !/trace_id/.test(c.sql)));
  assert.equal(calls.feedback.length, 1);
  assert.equal(calls.feedback[0].rating, -1);
});

test('recordAgentQualityAudit happy path inserts with trace_id and positive rating', async () => {
  const calls = { sql: [], feedback: [] };
  const api = createAgentQualityAutonomyApi({
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql, params });
        return { rows: [] };
      },
    }),
    resolveTenantIdDefault: () => 'default',
    normalizeStoreKey: (s) => s,
    normalizePlainText: (t) => t,
    recordAiInteraction: async () => 'trace-ok',
    recordAiFeedback: async (_p, args) => { calls.feedback.push(args); },
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({ ok: true }),
    prefixWithAgentName: (_a, t) => t,
    log: { error() {} },
  });
  await api.recordAgentQualityAudit({
    route: 'bi', username: 'u', queryText: 'q', responseText: 'a',
    auditResult: {}, passed: true, rewriteCount: 0,
  });
  assert.ok(calls.sql.some((c) => /trace_id/.test(c.sql)));
  assert.equal(calls.feedback[0].rating, 1);
});

test('createOrUpdateAutonomousDataTask returns null on DB error', async () => {
  const { api } = createApi({
    pool: () => ({
      query: async () => { throw new Error('db down'); },
    }),
  });
  const row = await api.createOrUpdateAutonomousDataTask({
    taskType: 'data_gap', store: 's', route: 'bi', queryText: 'q',
  });
  assert.equal(row, null);
});

test('createOrUpdateAutonomousDataTask + notify owner', async () => {
  const { api, calls } = createApi();
  const row = await api.createOrUpdateAutonomousDataTask({
    taskType: 'data_gap',
    store: '洪潮',
    brand: '洪潮',
    requesterUsername: 'u',
    route: 'bi',
    queryText: '营收',
    reason: '缺数',
    evidence: {},
    ownerUsername: 'owner1',
  });
  assert.equal(row.id, 7);
  assert.equal(api.getAgentQualityMetrics().autonomousTasks, 1);
  await api.notifyAutonomousDataTaskOwner(row);
  assert.equal(calls.lark.length, 1);
  assert.equal(calls.lark[0].openId, 'ou_1');
  assert.ok(calls.sql.some((c) => /notify_count/.test(c.sql)));
});

test('notifyAutonomousDataTaskOwner no-ops without owner open_id', async () => {
  const { api, calls } = createApi({
    lookupFeishuUserByUsername: async () => null,
  });
  await api.notifyAutonomousDataTaskOwner({ id: 1, owner_username: 'x', task_type: 't' });
  assert.equal(calls.lark.length, 0);
});
