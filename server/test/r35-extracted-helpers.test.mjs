/**
 * R35：冲高若干未挂地板小模块覆盖（mock pool / 纯函数）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { upsertFeishuGenericRecord } from '../domains/feishu-bitable/records.js';
import { findConfigKeyByTableInfo } from '../domains/feishu-bitable/config-lookup.js';
import { listGrowthCoupons } from '../domains/growth-coupons/service.js';
import {
  listContentCalendar,
  listUpcomingContentCalendar,
  upsertContentCalendarItem,
} from '../domains/growth-content-calendar/service.js';
import {
  listCampaignPlans,
  listMarketingTemplates,
  createMarketingTemplate,
  deleteMarketingTemplate,
} from '../domains/growth-campaigns/service.js';
import {
  isUuid,
  normalizeCreatedByUuid,
  normalizeKnowledgeTags,
  parseJsonStringArrayForAudience,
  parseKnowledgeAudienceFromBody,
  canViewerSeeKnowledgeAudience,
  resolveUploadsFile,
} from '../domains/knowledge/helpers.js';
import {
  isForecastStoreScopedRole,
  normalizeForecastBizType,
  createForecastBrandToken,
  createGetStoreSlotConfig,
  normalizeForecastSlot,
  resolveSlotForHour,
  createNormalizeForecastSlotFromHourRange,
  createNormalizeForecastUploadDate,
  inferForecastUploadDateFromFilename,
  normalizeForecastWeather,
  normalizeForecastStoreKey,
  createShiftForecastDate,
  forecastHistoryRowKey,
  sortForecastHistoryRows,
  mergePreferredForecastHistoryRows,
  STORE_SLOT_CONFIG,
} from '../domains/inventory-forecast/normalize.js';
import { createAuthMiddlewareHelpers } from '../domains/auth/middleware.js';

function mockRes() {
  const out = { statusCode: 200, body: null };
  out.status = (c) => {
    out.statusCode = c;
    return out;
  };
  out.json = (b) => {
    out.body = b;
    return out;
  };
  return out;
}

test('upsertFeishuGenericRecord：缺参 no-op；有 record_id 写库', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await upsertFeishuGenericRecord(pool, { appToken: '', tableId: 't', record: { record_id: 'r' } });
  await upsertFeishuGenericRecord(pool, {
    appToken: 'app',
    tableId: 'tbl',
    configKey: 'k',
    record: { record_id: 'rec1', fields: { 名: 'x', 附件: [] } },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /feishu_generic_records/);
  assert.equal(calls[0].params[0], 'app');
  assert.equal(calls[0].params[3], 'k');
  assert.equal(calls[0].params[4].名, 'x');
  assert.equal(calls[0].params[4].附件, undefined);
});

test('findConfigKeyByTableInfo：命中顶层 + 未命中', () => {
  assert.equal(findConfigKeyByTableInfo('', 'x'), null);
  assert.equal(
    findConfigKeyByTableInfo('PTWrbUdcbarCshst0QncMoY7nKe', 'tblXYfSBRrgNGohN'),
    'closing_reports'
  );
  assert.equal(findConfigKeyByTableInfo('PTWrbUdcbarCshst0QncMoY7nKe', 'nope'), null);
});

test('listGrowthCoupons / content-calendar list helpers', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 1 }] };
    },
  };
  assert.deepEqual(await listGrowthCoupons(pool, 'default'), [{ id: 1 }]);
  await upsertContentCalendarItem(pool, 't1', { item_id: 'i1', title: 't' });
  assert.deepEqual(await listContentCalendar(pool, { storeId: 's1', channel: 'xhs' }), [{ id: 1 }]);
  assert.deepEqual(await listUpcomingContentCalendar(pool, 's1'), [{ id: 1 }]);
  assert.ok(calls.some((c) => /growth_coupons/.test(c.sql)));
  assert.ok(calls.some((c) => /publish_date>=CURRENT_DATE/.test(c.sql)));
});

test('growth-campaigns list/create/delete templates + plans', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 9, name: 'n' }] };
    },
  };
  assert.equal((await listCampaignPlans(pool, { storeId: 'a', status: 'draft' })).length, 1);
  assert.equal((await listMarketingTemplates(pool)).length, 1);
  const created = await createMarketingTemplate(pool, 'default', { name: 'tpl', actions: [1] });
  assert.equal(created.id, 9);
  await deleteMarketingTemplate(pool, 9);
  assert.ok(calls.some((c) => /DELETE FROM marketing_templates/.test(c.sql)));
});

test('knowledge helpers：tags / audience / uploads path', () => {
  assert.equal(isUuid('not-uuid'), false);
  assert.equal(normalizeCreatedByUuid('bad'), null);
  assert.deepEqual(normalizeKnowledgeTags('a,b', 'ops', '洪潮'), ['洪潮', 'agent:ops', 'a', 'b']);
  assert.deepEqual(parseJsonStringArrayForAudience('["A","B"]'), ['A', 'B']);
  assert.deepEqual(parseJsonStringArrayForAudience('A，B'), ['A', 'B']);
  assert.deepEqual(parseKnowledgeAudienceFromBody({ audienceType: 'store', audienceStores: ['洪潮'] }), {
    type: 'store',
    stores: ['洪潮'],
  });
  assert.deepEqual(parseKnowledgeAudienceFromBody({ audience_type: 'position', audience_position: '店长' }), {
    type: 'position',
    position: '店长',
    positions: ['店长'],
  });
  assert.equal(canViewerSeeKnowledgeAudience({ store: '洪潮' }, { type: 'store', stores: ['洪潮'] }), true);
  assert.equal(canViewerSeeKnowledgeAudience({ store: '马己仙' }, { type: 'store', stores: ['洪潮'] }), false);
  assert.equal(
    canViewerSeeKnowledgeAudience({ position: 'x', role: 'admin' }, { type: 'position', positions: ['系统管理员'] }),
    true
  );
  const dir = path.join('/tmp', 'uploads-k');
  assert.equal(resolveUploadsFile(dir, ''), null);
  assert.equal(resolveUploadsFile(dir, '../etc/passwd'), null);
  assert.equal(resolveUploadsFile(dir, 'foo/bar.txt'), path.join(dir, 'foo/bar.txt'));
});

test('inventory-forecast/normalize 核心路径', () => {
  assert.equal(isForecastStoreScopedRole('store_manager'), true);
  assert.equal(normalizeForecastBizType('外卖'), 'takeaway');
  assert.equal(normalizeForecastBizType('堂食'), 'dinein');
  assert.equal(normalizeForecastBizType('x'), '');
  const brandTok = createForecastBrandToken({
    getBrandForStoreSync: (s) => (s === '已知店' ? { brandName: 'DB品牌' } : null),
    resolveTenantIdDefault: () => 'default',
  });
  assert.equal(brandTok('已知店'), 'DB品牌');
  assert.equal(brandTok('洪潮大宁'), '洪潮');
  assert.equal(brandTok('马己仙外滩'), '马己仙');
  assert.equal(brandTok('其他'), '');

  const getSlot = createGetStoreSlotConfig({
    resolveTenantIdDefault: () => 'default',
    getBrandForStoreSync: () => null,
    getBrandConfigSync: () => null,
  });
  assert.equal(getSlot('洪潮大宁久光店').hasAfternoon, false);
  assert.equal(getSlot('未知店').hasAfternoon, STORE_SLOT_CONFIG._default.hasAfternoon);

  assert.equal(normalizeForecastSlot('下午茶'), 'afternoon');
  assert.equal(resolveSlotForHour(15, { hasAfternoon: false }), 'dinner');
  assert.equal(resolveSlotForHour(15, { hasAfternoon: true }), 'afternoon');

  const fromHour = createNormalizeForecastSlotFromHourRange({ getStoreSlotConfig: getSlot });
  assert.equal(fromHour('afternoon', '洪潮大宁久光店'), 'dinner');
  assert.equal(fromHour('17:30', '未知店'), 'dinner');
  assert.equal(fromHour(String(17 / 24), '未知店'), 'dinner');
  assert.equal(fromHour('5:00 PM', '未知店'), 'dinner');
  assert.equal(fromHour('12', '未知店'), 'lunch');

  const normDate = createNormalizeForecastUploadDate({
    safeDateOnly: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''),
  });
  assert.equal(normDate('2026-07-01'), '2026-07-01');
  assert.match(normDate('7月1日'), /^\d{4}-07-01$/);
  assert.equal(normDate('7/1/26'), '2026-07-01');
  assert.equal(normDate('25.07.2026'), '2026-07-25');
  assert.equal(normDate('2026/7/1'), '2026-07-01');

  const now = new Date('2026-07-26T00:00:00Z');
  assert.equal(inferForecastUploadDateFromFilename('预测_2026-07-01.xlsx', now), '2026-07-01');
  assert.equal(inferForecastUploadDateFromFilename('2-16-22.xlsx', now), '2026-02-22');
  assert.equal(inferForecastUploadDateFromFilename('2-16.xlsx', now), '2026-02-16');
  assert.equal(normalizeForecastWeather(' 晴 '), '晴');
  assert.equal(normalizeForecastStoreKey('洪 潮'), '洪潮');

  const shift = createShiftForecastDate({ safeDateOnly: (v) => v });
  assert.equal(shift('2026-07-01', 1), '2026-07-02');
  assert.equal(forecastHistoryRowKey({ store: 'a', bizType: 't', slot: 'l', date: 'd' }), 'a||t||l||d');
  const sorted = sortForecastHistoryRows(
    [
      { date: '2026-07-01', updatedAt: 'a' },
      { date: '2026-07-02', updatedAt: 'b' },
    ],
    1
  );
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].date, '2026-07-02');
  const merged = mergePreferredForecastHistoryRows(
    [{ store: 'a', bizType: 't', slot: 'l', date: 'd', v: 1 }],
    [
      { store: 'a', bizType: 't', slot: 'l', date: 'd', v: 9 },
      { store: 'b', bizType: 't', slot: 'l', date: 'd', v: 2 },
    ]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.store === 'a').v, 1);
});

test('authRequiredOrQueryToken + session_replaced / account_disabled', async () => {
  const baseDeps = {
    jwtSecret: 'secret',
    pool: {
      async query(sql) {
        if (/session_nonce/.test(sql)) return { rows: [{ session_nonce: 'n' }] };
        if (/FROM users/i.test(sql)) return { rows: [{ role: 'admin' }] };
        return { rows: [] };
      },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    assertEmployeeLoginAllowedByState: async () => {},
    getSharedState: async () => ({}),
    pickMyStoreFromState: () => '',
    getUserStoreAccessContext: async () => ({
      primaryStore: '',
      currentStore: '',
      allowedStores: [],
    }),
  };

  const { authRequired } = createAuthMiddlewareHelpers({
    ...baseDeps,
    jwt: {
      verify: (tok) => {
        if (tok === 'bad') throw new Error('jwt');
        return { username: 'u', sn: 'n', role: 'admin', tenant_id: 'default' };
      },
    },
  });
  let nexted = 0;
  await authRequired({ originalUrl: '/api/x', headers: {}, query: { token: 'ok' } }, mockRes(), () => {
    nexted += 1;
  });
  assert.equal(nexted, 1);

  const { authRequiredOrQueryToken: qAuth } = createAuthMiddlewareHelpers({
    ...baseDeps,
    jwt: {
      verify: (tok) => {
        if (tok === 'replaced') return { username: 'bob', sn: 'old', role: 'admin' };
        if (tok === 'bad') throw new Error('jwt');
        return { username: 'bob', sn: 'n', role: 'admin' };
      },
    },
  });
  const resMissing = mockRes();
  await qAuth({ headers: {}, query: {} }, resMissing, () => {});
  assert.equal(resMissing.statusCode, 401);
  const resBad = mockRes();
  await qAuth({ headers: {}, query: { access_token: 'bad' } }, resBad, () => {});
  assert.equal(resBad.statusCode, 401);
  const resReplaced = mockRes();
  await qAuth({ headers: {}, query: { token: 'replaced' } }, resReplaced, () => {});
  assert.equal(resReplaced.statusCode, 401);
  assert.equal(resReplaced.body.error, 'session_replaced');

  const { authRequiredOrQueryToken: qAuth2 } = createAuthMiddlewareHelpers({
    ...baseDeps,
    jwt: { verify: () => ({ username: 'x', sn: 'n', role: 'admin' }) },
    assertEmployeeLoginAllowedByState: async () => {
      const e = new Error('disabled');
      e.statusCode = 403;
      throw e;
    },
  });
  const resDis = mockRes();
  await qAuth2({ headers: { authorization: 'Bearer t' }, query: {} }, resDis, () => {});
  assert.equal(resDis.statusCode, 403);
  assert.equal(resDis.body.error, 'account_disabled');

  const { authRequired: noSecret } = createAuthMiddlewareHelpers({
    ...baseDeps,
    jwt: { verify: () => ({}) },
    jwtSecret: '',
  });
  const resCfg = mockRes();
  await noSecret({ originalUrl: '/api/x', headers: { authorization: 'Bearer t' }, query: {} }, resCfg, () => {});
  assert.equal(resCfg.statusCode, 500);
});
