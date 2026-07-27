import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listDishAliases,
  createDishAlias,
  updateDishAlias,
  deleteDishAlias,
} from '../dish-alias-service.js';

function baseCtx(overrides = {}) {
  return {
    canManageGrossProfitProfiles: (role) => role === 'admin',
    normalizeDishAliasBizType: (value) => String(value || '').trim() || '*',
    resolveTenantIdDefault: () => 'default',
    pool: { query: async () => ({ rows: [] }) },
    ...overrides,
  };
}

test('listDishAliases: 校验权限并按门店和业态查询', async () => {
  const missing = await listDishAliases(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await listDishAliases(baseCtx(), { username: 'user', role: 'employee', query: {} });
  assert.equal(forbidden.status, 403);

  let statement = null;
  const result = await listDishAliases(baseCtx({
    pool: {
      query: async (sql, params) => {
        statement = { sql, params };
        return { rows: [{ id: 1, alias_name: '牛腩' }] };
      },
    },
  }), {
    username: 'admin',
    role: 'admin',
    query: { store: 'A店', bizType: 'dine_in' },
  });
  assert.deepEqual(result, { ok: true, items: [{ id: 1, alias_name: '牛腩' }] });
  assert.match(statement.sql, /store = \$1/);
  assert.match(statement.sql, /biz_type = \$2/);
  assert.deepEqual(statement.params, ['A店', 'dine_in']);
});

test('createDishAlias: 校验参数并以租户范围 upsert', async () => {
  const missing = await createDishAlias(baseCtx(), {
    username: 'admin',
    role: 'admin',
    body: { aliasName: '牛腩' },
  });
  assert.equal(missing.error, 'missing_params');

  let statement = null;
  const item = { id: 3, alias_name: '牛腩', canonical_name: '招牌牛腩' };
  const result = await createDishAlias(baseCtx({
    resolveTenantIdDefault: () => 'tenant-a',
    pool: {
      query: async (sql, params) => {
        statement = { sql, params };
        return { rows: [item] };
      },
    },
  }), {
    username: 'admin',
    role: 'admin',
    body: { store: 'A店', bizType: 'dine_in', aliasName: '牛腩', canonicalName: '招牌牛腩' },
  });
  assert.deepEqual(result, { ok: true, item });
  assert.match(statement.sql, /ON CONFLICT/);
  assert.deepEqual(statement.params, ['A店', 'dine_in', '牛腩', '招牌牛腩', 'admin', 'tenant-a']);
});

test('updateDishAlias: 更新指定字段，处理无效和缺失记录', async () => {
  const invalid = await updateDishAlias(baseCtx(), {
    username: 'admin',
    role: 'admin',
    params: { id: 'bad' },
    body: {},
  });
  assert.equal(invalid.error, 'invalid_id');

  const notFound = await updateDishAlias(baseCtx(), {
    username: 'admin',
    role: 'admin',
    params: { id: '5' },
    body: { enabled: false },
  });
  assert.equal(notFound.status, 404);

  let statement = null;
  const item = { id: 5, alias_name: '新牛腩', canonical_name: '招牌牛腩', enabled: true };
  const result = await updateDishAlias(baseCtx({
    pool: {
      query: async (sql, params) => {
        statement = { sql, params };
        return { rows: [item] };
      },
    },
  }), {
    username: 'admin',
    role: 'admin',
    params: { id: '5' },
    body: { aliasName: '新牛腩', canonicalName: '招牌牛腩', enabled: true },
  });
  assert.deepEqual(result, { ok: true, item });
  assert.match(statement.sql, /alias_name = \$1/);
  assert.match(statement.sql, /canonical_name = \$2/);
  assert.match(statement.sql, /enabled = \$3/);
  assert.deepEqual(statement.params, ['新牛腩', '招牌牛腩', true, 'admin', 5]);
});

test('deleteDishAlias: 软删除，并拒绝无效或不存在记录', async () => {
  const invalid = await deleteDishAlias(baseCtx(), {
    username: 'admin',
    role: 'admin',
    params: { id: '0' },
  });
  assert.equal(invalid.error, 'invalid_id');

  const notFound = await deleteDishAlias(baseCtx(), {
    username: 'admin',
    role: 'admin',
    params: { id: '7' },
  });
  assert.equal(notFound.status, 404);

  let statement = null;
  const result = await deleteDishAlias(baseCtx({
    pool: {
      query: async (sql, params) => {
        statement = { sql, params };
        return { rows: [{ id: 7 }] };
      },
    },
  }), {
    username: 'admin',
    role: 'admin',
    params: { id: '7' },
  });
  assert.deepEqual(result, { ok: true });
  assert.match(statement.sql, /SET enabled = FALSE/);
  assert.deepEqual(statement.params, ['admin', 7]);
});
