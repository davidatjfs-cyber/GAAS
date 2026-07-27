/**
 * domains/agent-message/runtime*.js 直测（缓存 / 检索 peel）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeCacheApi } from '../runtime-cache.js';
import { createRuntimeQueriesApi } from '../runtime-queries.js';
import { createAgentMessageRuntime } from '../runtime.js';

test('cache: hit within TTL increments cacheHits; miss after expiry', () => {
  const api = createRuntimeCacheApi({ resolveTenantIdDefault: () => 't1' });
  assert.equal(api.getCachedResponse('k'), null);
  api.setCachedResponse('k', { ok: 1 });
  assert.deepEqual(api.getCachedResponse('k'), { ok: 1 });
  assert.equal(api.performanceMetrics.cacheHits, 1);

  // simulate expiry: set then clearExpired with a "now" past TTL
  api.clearCaches();
  api.setCachedResponse('old', 'v');
  const cleaned = api.clearExpiredResponseCache(Date.now() + api.CACHE_TTL_MS + 1);
  assert.equal(cleaned, 1);
  assert.equal(api.getCachedResponse('old'), null);
});

test('context: tenant-isolated keys, trim, and eviction of oldest user', () => {
  let tenant = 'a';
  const api = createRuntimeCacheApi({ resolveTenantIdDefault: () => tenant });
  api.updateContext('Alice', 'user', 'hi');
  api.updateContext('Alice', 'assistant', 'yo');
  assert.equal(api.getContext('alice').length, 2);
  assert.equal(api.getContext('bob').length, 0);

  tenant = 'b';
  assert.equal(api.getContext('alice').length, 0);
  api.updateContext('alice', 'user', 'other-tenant');
  assert.equal(api.getContextSize(), 2);

  // fill beyond MAX_CONTEXT_USERS (500) — use many distinct users under tenant b
  tenant = 'b';
  for (let i = 0; i < 502; i += 1) {
    api.updateContext(`u${i}`, 'user', `m${i}`);
  }
  assert.ok(api.getContextSize() <= 500);
});

test('clearCaches resets maps; performanceMetrics is same object ref', () => {
  const api = createRuntimeCacheApi({ resolveTenantIdDefault: () => 'default' });
  const metrics = api.performanceMetrics;
  metrics.totalCalls = 3;
  api.setCachedResponse('x', 1);
  api.updateContext('u', 'user', 'm');
  api.clearCaches();
  assert.equal(api.getCacheSize(), 0);
  assert.equal(api.getContextSize(), 0);
  assert.equal(api.performanceMetrics, metrics);
  assert.equal(api.performanceMetrics.totalCalls, 3);
});

test('getEmployeePositionForKb reads employees then users; empty on miss', async () => {
  const api = createRuntimeQueriesApi({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    getSharedState: async () => ({
      employees: [{ username: 'Ann', position: '店长' }],
      users: [{ username: 'bob', position: '收银' }],
    }),
    log: { error() {} },
  });
  assert.equal(await api.getEmployeePositionForKb(''), '');
  assert.equal(await api.getEmployeePositionForKb('ann'), '店长');
  assert.equal(await api.getEmployeePositionForKb('Bob'), '收银');
  assert.equal(await api.getEmployeePositionForKb('nobody'), '');
});

test('queryKnowledgeBase prefers ragQuery; falls back to SQL', async () => {
  const sql = [];
  const withRag = createRuntimeQueriesApi({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    getSharedState: async () => ({}),
    log: { error() {} },
    importRagTool: async () => ({
      ragQuery: async (args) => {
        assert.equal(args.agentName, 'sop_advisor');
        assert.equal(args.query, '卫生标准');
        return { results: [{ title: 'T', content: 'C', tags: ['a'], createdAt: 't' }] };
      },
    }),
  });
  const rows = await withRag.queryKnowledgeBase(['ignored'], '卫生标准', 3);
  assert.deepEqual(rows, [{ title: 'T', content: 'C', tags: ['a'], created_at: 't' }]);

  const fallback = createRuntimeQueriesApi({
    pool: () => ({
      query: async (q, params) => {
        sql.push({ q, params });
        return { rows: [{ title: 'sql', content: 'x', tags: [], created_at: null }] };
      },
    }),
    getSharedState: async () => ({}),
    log: { error() {} },
    importRagTool: async () => ({}),
  });
  const fb = await fallback.queryKnowledgeBase('ops', 'foo', 2, { brandTag: '洪潮' });
  assert.equal(fb[0].title, 'sql');
  assert.equal(sql[0].params[0], '洪潮');
  assert.equal(sql[0].params[1], '%foo%');
});

test('queryKnowledgeBase returns [] on error', async () => {
  const errors = [];
  const api = createRuntimeQueriesApi({
    pool: () => ({
      query: async () => {
        throw new Error('db down');
      },
    }),
    getSharedState: async () => ({}),
    log: { error: (...a) => errors.push(a) },
    importRagTool: async () => ({}),
  });
  assert.deepEqual(await api.queryKnowledgeBase('a', 'q'), []);
  assert.ok(errors.length >= 1);
});

test('queryBitableData applies contentType/configKey filters', async () => {
  const seen = [];
  const api = createRuntimeQueriesApi({
    pool: () => ({
      query: async (sql, params) => {
        seen.push({ sql, params });
        return { rows: [{ content: 'c' }] };
      },
    }),
    getSharedState: async () => ({}),
    log: { error() {} },
  });
  const rows = await api.queryBitableData('bi', '探店', 5, {
    contentType: 'table_visit',
    configKey: 'tv1',
  });
  assert.equal(rows.length, 1);
  assert.match(seen[0].sql, /content_type = \$3/);
  assert.match(seen[0].sql, /agent_data::text ILIKE \$4/);
  assert.equal(seen[0].params[2], 'table_visit');
  assert.match(seen[0].params[3], /tv1/);
});

test('queryAgentData respects include flags', async () => {
  const api = createRuntimeQueriesApi({
    pool: () => ({ query: async () => ({ rows: [{ content: 'b' }] }) }),
    getSharedState: async () => ({}),
    log: { error() {} },
    importRagTool: async () => ({
      ragQuery: async () => ({ results: [{ title: 'k', content: '1', tags: [], createdAt: null }] }),
    }),
  });
  const both = await api.queryAgentData('a', 'q', 2);
  assert.equal(both.knowledge.length, 1);
  assert.equal(both.bitable.length, 1);

  const kbOnly = await api.queryAgentData('a', 'q', 2, { includeBitable: false });
  assert.equal(kbOnly.knowledge.length, 1);
  assert.equal(kbOnly.bitable.length, 0);

  const biOnly = await api.queryAgentData('a', 'q', 2, { includeKnowledge: false });
  assert.equal(biOnly.knowledge.length, 0);
  assert.equal(biOnly.bitable.length, 1);
});

test('createAgentMessageRuntime composes cache + queries; metrics ref stable', async () => {
  const rt = createAgentMessageRuntime({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    resolveTenantIdDefault: () => 'default',
    getSharedState: async () => ({ employees: [{ username: 'x', position: 'P' }] }),
    log: { error() {}, info() {} },
    importRagTool: async () => ({}),
  });
  const m = rt.performanceMetrics;
  rt.setCachedResponse('c', 1);
  assert.equal(rt.getCachedResponse('c'), 1);
  assert.equal(await rt.getEmployeePositionForKb('x'), 'P');
  assert.equal(rt.performanceMetrics, m);
});
