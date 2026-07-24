import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUuid,
  normalizeKnowledgeGroupName,
  normalizeMultipartFilename,
} from '../domains/knowledge/helpers.js';
import {
  listKnowledge,
  listKnowledgeGroups,
  deleteKnowledge,
  putKnowledge,
  putKnowledgeExplanation,
  regenerateExplanation,
  getKnowledgeContent,
} from '../domains/knowledge/service.js';

function makePool(handler) {
  return {
    query: async (sql, params) => {
      if (handler) return handler(sql, params);
      return { rows: [], rowCount: 0 };
    },
  };
}

test('helpers: isUuid / normalizeKnowledgeGroupName / normalizeMultipartFilename', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);

  assert.equal(normalizeKnowledgeGroupName('  前厅SOP  '), '前厅SOP');
  assert.equal(normalizeKnowledgeGroupName('x'.repeat(200)).length, 120);

  // latin1 mojibake recovery for CJK filenames
  const mojibake = Buffer.from('培训手册.pdf', 'utf8').toString('latin1');
  assert.equal(normalizeMultipartFilename(mojibake), '培训手册.pdf');
  assert.equal(normalizeMultipartFilename('plain.txt'), 'plain.txt');
});

test('listKnowledgeGroups: empty pool returns { ok, items: [] }', async () => {
  const result = await listKnowledgeGroups(
    { pool: makePool(async () => ({ rows: [] })) },
    { viewer: { role: 'admin', store: '', position: '' } }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
});

test('listKnowledge: empty pool returns { ok, items: [] }', async () => {
  const result = await listKnowledge(
    {
      pool: makePool(async () => ({ rows: [] })),
      buildKnowledgeBrandScopeTag: () => 'brand:all',
    },
    { viewer: { role: 'employee', store: '洪潮', position: '服务员' }, query: {} }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
});

test('deleteKnowledge: missing id / not found', async () => {
  const missing = await deleteKnowledge({ pool: makePool() }, { role: 'admin', id: '' });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);
  assert.equal(missing.error, 'missing_id');

  const notFound = await deleteKnowledge(
    {
      pool: makePool(async () => ({ rows: [] })),
      uploadsDir: '/tmp',
    },
    { role: 'admin', id: '550e8400-e29b-41d4-a716-446655440000' }
  );
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.error, 'not_found');
});

test('putKnowledge: missing id / no fields', async () => {
  const missing = await putKnowledge(
    { pool: makePool(), resolveTenantIdDefault: () => 'default' },
    { role: 'admin', id: '', body: { title: 'x' }, username: 'admin' }
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'missing_id');

  const noFields = await putKnowledge(
    { pool: makePool(), resolveTenantIdDefault: () => 'default' },
    { role: 'admin', id: '550e8400-e29b-41d4-a716-446655440000', body: {}, username: 'admin' }
  );
  assert.equal(noFields.ok, false);
  assert.equal(noFields.status, 400);
  assert.equal(noFields.error, 'no_fields_to_update');
});

test('putKnowledgeExplanation: success UPDATE (mock pool)', async () => {
  const calls = [];
  const pool = makePool(async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT ai_explanation/i.test(sql)) {
      return { rows: [{ ai_explanation: 'old' }] };
    }
    return { rows: [], rowCount: 1 };
  });
  const result = await putKnowledgeExplanation(
    { pool, resolveTenantIdDefault: () => 'default' },
    {
      role: 'admin',
      id: '550e8400-e29b-41d4-a716-446655440000',
      explanation: '手动精修后的解析内容',
      username: 'boss',
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.locked, true);
  assert.ok(calls.some((c) => /UPDATE knowledge_base SET ai_explanation/i.test(c.sql)));
  assert.equal(calls.find((c) => /UPDATE knowledge_base SET ai_explanation/i.test(c.sql)).params[0], '手动精修后的解析内容');
});

test('regenerateExplanation: admin_only when role is not admin', async () => {
  const result = await regenerateExplanation(
    { pool: makePool() },
    { role: 'employee', id: '550e8400-e29b-41d4-a716-446655440000' }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'admin_only');
});

test('getKnowledgeContent: forbidden for non-admin outside audience', async () => {
  const pool = makePool(async () => ({
    rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', content: 'hello', audience: { type: 'store', stores: ['马己仙'] } }],
  }));
  const result = await getKnowledgeContent(
    { pool },
    {
      viewer: { role: 'employee', store: '洪潮', position: '服务员' },
      id: '550e8400-e29b-41d4-a716-446655440000',
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, 'forbidden');
});
