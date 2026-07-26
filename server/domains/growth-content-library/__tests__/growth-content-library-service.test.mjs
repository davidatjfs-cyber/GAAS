import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  normalizeStringArray,
  parsePositiveId,
  buildContentLibraryFilter,
} from '../helpers.js';
import {
  deleteById,
  listContentLibrary,
  upsertPosterTemplate,
} from '../service.js';

function baseCtx(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    resolveTenantIdDefault: () => 'default',
    resolveTenantIdForStore: async () => 'default',
    parseOccurredAt: (v) => new Date(v),
    ...overrides,
  };
}

test('helpers: cleanText / normalizeStringArray / parsePositiveId', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.deepEqual(normalizeStringArray(['a', '', null, 'b']), ['a', 'b']);
  assert.deepEqual(normalizeStringArray('x'), []);
  assert.equal(parsePositiveId('12'), 12);
  assert.equal(parsePositiveId('0'), null);
  assert.equal(parsePositiveId('abc'), null);
});

test('buildContentLibraryFilter: purpose + channel + store', () => {
  const { conditions, params } = buildContentLibraryFilter({
    purpose: 'winback',
    channel: 'wecom',
    store_id: 's1',
  });
  assert.ok(conditions[0].includes("status IN"));
  assert.equal(conditions.length, 4);
  assert.deepEqual(params, ['winback', 'wecom', 's1']);
});

test('deleteById: invalid_id / invalid_table / ok', async () => {
  assert.equal((await deleteById(baseCtx(), 'poster_templates', 'x')).status, 400);
  assert.equal((await deleteById(baseCtx(), 'evil_table', 1)).body.error, 'invalid_table');
  let deleted;
  const ctx = baseCtx({
    pool: {
      async query(sql, params) {
        deleted = { sql, params };
        return { rows: [] };
      },
    },
  });
  const r = await deleteById(ctx, 'generated_posters', 9);
  assert.equal(r.status, 200);
  assert.ok(String(deleted.sql).includes('generated_posters'));
  assert.deepEqual(deleted.params, [9]);
});

test('listContentLibrary: builds filtered query', async () => {
  let seen;
  const ctx = baseCtx({
    pool: {
      async query(sql, params) {
        seen = { sql, params };
        return { rows: [{ id: 1 }] };
      },
    },
  });
  const r = await listContentLibrary(ctx, { purpose: 'vip' });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.ok(seen.sql.includes('ANY(gp.purposes)'));
  assert.deepEqual(seen.params, ['vip']);
});

test('upsertPosterTemplate: normalizes purposes/channels arrays', async () => {
  let seenParams;
  const ctx = baseCtx({
    pool: {
      async query(_sql, params) {
        seenParams = params;
        return { rows: [{ template_key: 't1' }] };
      },
    },
  });
  await upsertPosterTemplate(ctx, {
    template_key: 't1',
    name: 'N',
    purposes: ['a', '', 'b'],
    channels: null,
  });
  assert.deepEqual(seenParams[9], ['a', 'b']);
  assert.deepEqual(seenParams[10], []);
});
