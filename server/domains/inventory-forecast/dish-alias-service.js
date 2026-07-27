/**
 * dish_name_aliases CRUD business logic. Returns { ok, status?, error?, ...payload }.
 */

function requireAliasAdmin(ctx, input, message) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { error: { ok: false, status: 400, error: 'missing_user' } };
  if (!ctx.canManageGrossProfitProfiles(role)) {
    return { error: { ok: false, status: 403, error: 'forbidden', message } };
  }
  return { username };
}

function serverError() {
  return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
}

export async function listDishAliases(ctx, input) {
  const access = requireAliasAdmin(ctx, input, '仅管理员可查看菜名别名规则');
  if (access.error) return access.error;
  try {
    const store = String(input.query?.store || '*').trim() || '*';
    const bizType = ctx.normalizeDishAliasBizType(input.query?.bizType || '*');
    const where = ['enabled = TRUE'];
    const params = [];
    if (store !== '*') {
      params.push(store);
      where.push(`(store = $${params.length} OR store = '*')`);
    }
    if (bizType !== '*') {
      params.push(bizType);
      where.push(`(biz_type = $${params.length} OR biz_type = '*')`);
    }
    const result = await ctx.pool.query(
      `SELECT id, store, biz_type, alias_name, canonical_name, enabled, updated_at
       FROM dish_name_aliases
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC, id DESC
       LIMIT 2000`,
      params
    );
    return { ok: true, items: result.rows || [] };
  } catch (_error) {
    return serverError();
  }
}

export async function createDishAlias(ctx, input) {
  const access = requireAliasAdmin(ctx, input, '仅管理员可配置菜名别名规则');
  if (access.error) return access.error;
  try {
    const store = String(input.body?.store || '*').trim() || '*';
    const bizType = ctx.normalizeDishAliasBizType(input.body?.bizType || '*');
    const aliasName = String(input.body?.aliasName || '').trim();
    const canonicalName = String(input.body?.canonicalName || '').trim();
    if (!aliasName || !canonicalName) {
      return { ok: false, status: 400, error: 'missing_params', message: 'aliasName/canonicalName 必填' };
    }
    const result = await ctx.pool.query(
      `INSERT INTO dish_name_aliases (store, biz_type, alias_name, canonical_name, enabled, created_by, updated_by, updated_at, tenant_id)
       VALUES ($1,$2,$3,$4,TRUE,$5,$5,NOW(),$6)
       ON CONFLICT (store, biz_type, alias_name, tenant_id)
       DO UPDATE SET canonical_name = EXCLUDED.canonical_name, enabled = TRUE, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING id, store, biz_type, alias_name, canonical_name, enabled, updated_at`,
      [store, bizType, aliasName, canonicalName, access.username, ctx.resolveTenantIdDefault()]
    );
    return { ok: true, item: result.rows?.[0] || null };
  } catch (_error) {
    return serverError();
  }
}

export async function updateDishAlias(ctx, input) {
  const access = requireAliasAdmin(ctx, input, '仅管理员可修改菜名别名规则');
  if (access.error) return access.error;
  try {
    const id = Number(input.params?.id || 0);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, status: 400, error: 'invalid_id' };

    const aliasName = String(input.body?.aliasName || '').trim();
    const canonicalName = String(input.body?.canonicalName || '').trim();
    const enabled = input.body?.enabled === undefined ? null : !!input.body.enabled;
    const sets = [];
    const values = [];
    if (aliasName) {
      values.push(aliasName);
      sets.push(`alias_name = $${values.length}`);
    }
    if (canonicalName) {
      values.push(canonicalName);
      sets.push(`canonical_name = $${values.length}`);
    }
    if (enabled !== null) {
      values.push(enabled);
      sets.push(`enabled = $${values.length}`);
    }
    values.push(access.username);
    sets.push(`updated_by = $${values.length}`);
    sets.push('updated_at = NOW()');
    values.push(id);

    const result = await ctx.pool.query(
      `UPDATE dish_name_aliases
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, store, biz_type, alias_name, canonical_name, enabled, updated_at`,
      values
    );
    if (!result.rows?.length) return { ok: false, status: 404, error: 'not_found' };
    return { ok: true, item: result.rows[0] };
  } catch (_error) {
    return serverError();
  }
}

export async function deleteDishAlias(ctx, input) {
  const access = requireAliasAdmin(ctx, input, '仅管理员可删除菜名别名规则');
  if (access.error) return access.error;
  try {
    const id = Number(input.params?.id || 0);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, status: 400, error: 'invalid_id' };
    const result = await ctx.pool.query(
      `UPDATE dish_name_aliases
       SET enabled = FALSE, updated_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [access.username, id]
    );
    if (!result.rows?.length) return { ok: false, status: 404, error: 'not_found' };
    return { ok: true };
  } catch (_error) {
    return serverError();
  }
}
