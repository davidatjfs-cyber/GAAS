import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUuid,
  normalizeKnowledgeGroupName,
  normalizeMultipartFilename,
} from '../helpers.js';
import {
  listKnowledge,
  listKnowledgeGroups,
  deleteKnowledge,
  putKnowledge,
  putKnowledgeExplanation,
  regenerateExplanation,
  getKnowledgeContent,
} from '../service.js';
import {
  deleteGroup,
  getKnowledgeGroup,
  putGroupMeta,
  putKnowledgeGroupId,
} from '../knowledge-groups.js';

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

test('knowledge groups: list and get respect audience', async () => {
  const rows = [
    {
      id: 'a',
      group_id: '550e8400-e29b-41d4-a716-446655440000',
      group_name: '前厅SOP',
      title: '服务流程',
      category: '培训',
      tags: ['brand:all'],
      scope: 'public',
      audience: { type: 'all' },
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    },
    {
      id: 'b',
      group_id: '550e8400-e29b-41d4-a716-446655440000',
      title: '仅限马己仙',
      category: '培训',
      audience: { type: 'store', stores: ['马己仙'] },
      created_at: '2026-01-03',
      updated_at: '2026-01-04',
    },
  ];
  const pool = makePool(async () => ({ rows }));
  const viewer = { role: 'employee', store: '洪潮', position: '服务员' };

  const listed = await listKnowledgeGroups({ pool }, { viewer });
  assert.equal(listed.ok, true);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].title, '前厅SOP');
  assert.equal(listed.items[0].file_count, 1);

  const fetched = await getKnowledgeGroup(
    { pool },
    { viewer, groupId: '550e8400-e29b-41d4-a716-446655440000' }
  );
  assert.equal(fetched.ok, true);
  assert.deepEqual(fetched.items, [rows[0]]);
});

test('knowledge groups: admin updates group membership and metadata', async () => {
  const calls = [];
  const pool = makePool(async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT 1 FROM knowledge_base WHERE group_id/i.test(sql)) return { rows: [{ '?column?': 1 }] };
    if (/SELECT group_name, title/i.test(sql)) return { rows: [{ group_name: '后厨SOP' }] };
    if (/UPDATE knowledge_base\s+SET group_name/i.test(sql)) return { rows: [{ id: 'a' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const id = '550e8400-e29b-41d4-a716-446655440001';
  const groupId = '550e8400-e29b-41d4-a716-446655440000';

  const membership = await putKnowledgeGroupId({ pool }, { role: 'admin', id, groupId });
  assert.deepEqual(membership, { ok: true, success: true });
  assert.ok(calls.some((call) => /UPDATE knowledge_base SET group_id/i.test(call.sql)));

  const metadata = await putGroupMeta(
    { pool },
    { role: 'admin', groupId, body: { groupName: '  新后厨SOP  ' } }
  );
  assert.equal(metadata.ok, true);
  assert.equal(metadata.updated, 1);
  assert.equal(metadata.groupName, '新后厨SOP');
});

test('knowledge groups: validate permissions and delete all group records', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440001';
  const groupId = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal((await getKnowledgeGroup({ pool: makePool() }, { viewer: {}, groupId: '' })).error, 'missing_group_id');
  assert.equal((await putKnowledgeGroupId({ pool: makePool() }, { role: 'employee', id, groupId })).error, 'admin_only');
  assert.equal((await putGroupMeta({ pool: makePool() }, { role: 'admin', groupId, body: {} })).error, 'missing_group_name');

  const calls = [];
  const pool = makePool(async (sql) => {
    calls.push(sql);
    if (/SELECT id, file_path/i.test(sql)) return { rows: [{ id, file_path: '' }, { id: 'b', file_path: '' }] };
    return { rows: [], rowCount: 2 };
  });
  const deleted = await deleteGroup({ pool, uploadsDir: '/tmp' }, { role: 'admin', groupId });
  assert.deepEqual(deleted, { ok: true, deleted: 2 });
  assert.ok(calls.some((sql) => /DELETE FROM knowledge_base WHERE group_id/i.test(sql)));
});
