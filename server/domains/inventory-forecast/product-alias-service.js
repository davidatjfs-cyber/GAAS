import { randomUUID } from 'crypto';

export async function listProductAliases(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可查看别名规则' };
  try {
    const state0 = (await ctx.getSharedState()) || {};
    const scope = ctx.resolveForecastScope(state0, username, role, input.query?.store, input.query?.brandId);
    if (!scope.brandId) return { ok: false, status: 400, error: 'missing_brand' };
    let items = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
    items = items.filter((x) => {
      const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
      return rid === scope.brandId;
    });
    items.sort((a, b) => String(a?.canonical || '').localeCompare(String(b?.canonical || ''), 'zh-Hans-CN'));
    return { ok: true, brandId: scope.brandId, brandName: scope.brandName, items };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function createProductAlias(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可配置别名规则' };
  const canonical = String(input.body?.canonical || '').trim();
  const aliases = Array.isArray(input.body?.aliases) ? input.body.aliases : [];
  if (!canonical) return { ok: false, status: 400, error: 'missing_canonical' };
  try {
    const state0 = (await ctx.getSharedState()) || {};
    const scope = ctx.resolveForecastScope(state0, username, role, input.body?.store, input.body?.brandId);
    if (!scope.brandId) return { ok: false, status: 400, error: 'missing_brand' };

    const now = ctx.hrmsNowISO();
    const all = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
    const normalizedTokens = [canonical, ...aliases]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .map((x) => ({ raw: x, norm: ctx.normalizeProductName(x) }))
      .filter((x) => x.norm);
    if (!normalizedTokens.length) return { ok: false, status: 400, error: 'invalid_aliases' };

    const storeItems = all.filter((x) => {
      const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
      return rid === scope.brandId;
    });
    const used = new Map();
    storeItems.forEach((it) => {
      const names = [String(it?.canonical || '').trim(), ...(Array.isArray(it?.aliases) ? it.aliases : [])];
      names.forEach((name) => {
        const norm = ctx.normalizeProductName(name);
        if (!norm) return;
        used.set(norm, String(it?.id || ''));
      });
    });
    const conflict = normalizedTokens.find((x) => used.has(x.norm));
    if (conflict) return { ok: false, status: 400, error: 'duplicate_alias', message: `名称「${conflict.raw}」已被其他规则使用` };

    const item = {
      id: randomUUID(),
      brandId: scope.brandId,
      brandName: scope.brandName,
      store: scope.storeScope[0] || scope.store || '',
      canonical,
      aliases: Array.from(new Set(aliases.map((x) => String(x || '').trim()).filter(Boolean))),
      createdAt: now,
      createdBy: username,
      updatedAt: now,
      updatedBy: username
    };
    all.unshift(item);
    await ctx.saveSharedState({ ...state0, forecastProductAliasRules: all.slice(0, 4000) });
    return { ok: true, item };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function updateProductAlias(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可修改别名规则' };
  const id = String(input.params?.id || '').trim();
  const canonical = String(input.body?.canonical || '').trim();
  const aliases = Array.isArray(input.body?.aliases) ? input.body.aliases : [];
  if (!id) return { ok: false, status: 400, error: 'missing_id' };
  if (!canonical) return { ok: false, status: 400, error: 'missing_canonical' };
  try {
    const state0 = (await ctx.getSharedState()) || {};
    const all = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
    const idx = all.findIndex((x) => String(x?.id || '').trim() === id);
    if (idx < 0) return { ok: false, status: 404, error: 'not_found' };

    const existing = all[idx];
    const store = String(existing?.store || '').trim();
    const brandId = ctx.normalizeBrandId(existing?.brandId || ctx.resolveStoreBrandContext(state0, store).brandId);
    const brandName = String(existing?.brandName || ctx.resolveStoreBrandContext(state0, store).brandName || '').trim();
    const now = ctx.hrmsNowISO();
    const normalizedTokens = [canonical, ...aliases]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .map((x) => ({ raw: x, norm: ctx.normalizeProductName(x) }))
      .filter((x) => x.norm);
    if (!normalizedTokens.length) return { ok: false, status: 400, error: 'invalid_aliases' };

    const used = new Map();
    all
      .filter((x) => String(x?.id || '').trim() !== id)
      .filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === brandId)
      .forEach((it) => {
        const names = [String(it?.canonical || '').trim(), ...(Array.isArray(it?.aliases) ? it.aliases : [])];
        names.forEach((name) => {
          const norm = ctx.normalizeProductName(name);
          if (!norm) return;
          used.set(norm, String(it?.id || ''));
        });
      });
    const conflict = normalizedTokens.find((x) => used.has(x.norm));
    if (conflict) return { ok: false, status: 400, error: 'duplicate_alias', message: `名称「${conflict.raw}」已被其他规则使用` };

    all[idx] = {
      ...existing,
      brandId,
      brandName,
      canonical,
      aliases: Array.from(new Set(aliases.map((x) => String(x || '').trim()).filter(Boolean))),
      updatedAt: now,
      updatedBy: username
    };
    await ctx.saveSharedState({ ...state0, forecastProductAliasRules: all });
    return { ok: true, item: all[idx] };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function deleteProductAlias(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可删除别名规则' };
  const id = String(input.params?.id || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };
  try {
    const state0 = (await ctx.getSharedState()) || {};
    const all = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
    const idx = all.findIndex((x) => String(x?.id || '').trim() === id);
    if (idx < 0) return { ok: false, status: 404, error: 'not_found' };
    all.splice(idx, 1);
    await ctx.saveSharedState({ ...state0, forecastProductAliasRules: all });
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
