/**
 * R53：feishu-sync.js (873 行) 拆分至 domains/feishu-reports-sync/*，挂 extracted 地板。
 * DB 交互通过 setPool() 注入 mock pool；HTTP 交互通过替换 globalThis.fetch。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setPool } from '../utils/database.js';
import { encryptIntegrationConfig } from '../tenant-integrations.js';

import {
  isTransientFeishuBitableError,
  isDataNotReadyError,
  isFeishuInternalError,
  sleep
} from '../domains/feishu-reports-sync/transient-errors.js';
import {
  extractFieldText,
  pickFieldValue,
  pickFieldText,
  parseFieldNumber,
  pickFieldNumber,
  extractDishLibraryEntries,
  extractClosingReportFields,
  extractOpeningReportFields,
  extractMeetingReportFields,
  extractMaterialReportFields,
  extractSopStepFields
} from '../domains/feishu-reports-sync/field-extractors.js';
import {
  FEISHU_TABLE_CONFIG,
  withTableMeta,
  loadTenantFeishuConfig,
  resolveWebhookTenantId
} from '../domains/feishu-reports-sync/config.js';
import { getFeishuAccessToken, fetchTableRecords, fetchTableRecordsPage } from '../domains/feishu-reports-sync/api.js';
import { setFeishuSyncFailureNotifier, notifyFeishuSyncFailure } from '../domains/feishu-reports-sync/notify.js';
import { syncKitchenReports, syncMeetingReports, syncMaterialReports } from '../domains/feishu-reports-sync/report-sync.js';
import { syncDishLibraryCosts } from '../domains/feishu-reports-sync/dish-library-sync.js';
import { syncSopSteps } from '../domains/feishu-reports-sync/sop-sync.js';
import {
  syncAllFeishuTables,
  startDailyFeishuSync,
  runDailyFeishuSyncOnce,
  runWeeklyDishLibrarySyncOnce
} from '../domains/feishu-reports-sync/orchestrator.js';

// re-export barrel (behavior-preserving) 也要能正常工作
import * as barrel from '../feishu-sync.js';

function makeMockPool(matchers = []) {
  const dispatch = async (sql, params) => {
    const s = String(sql);
    for (const [pattern, handler] of matchers) {
      if (pattern.test(s)) return handler(s, params);
    }
    return { rows: [] };
  };
  return {
    query: dispatch,
    connect: async () => ({ query: dispatch, release: () => {} }),
  };
}

// integrationKeyBuffer() 要求 base64 解码后恰好 32 字节，任意固定测试用密钥即可
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

function withMockFetch(handler, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => { globalThis.fetch = orig; });
}

/** 临时设置飞书兼容旧配置所需的环境变量，跑完自动恢复原值。 */
async function withLegacyFeishuEnv(fn) {
  const keys = ['TENANT_INTEGRATION_ENCRYPTION_KEY', 'ALLOW_LEGACY_FEISHU_FALLBACK', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET'];
  const orig = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.ALLOW_LEGACY_FEISHU_FALLBACK = 'true';
  process.env.FEISHU_APP_ID = 'legacy_app_id';
  process.env.FEISHU_APP_SECRET = 'legacy_app_secret';
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (orig[k] !== undefined) process.env[k] = orig[k]; else delete process.env[k];
    }
  }
}

/** token 端点 + 通用记录端点的组合 mock fetch handler。 */
function tokenAndRecordsFetch(recordsByUrlPart = []) {
  return async (url) => {
    if (String(url).includes('tenant_access_token')) {
      return { json: async () => ({ code: 0, tenant_access_token: 'tok', expire: 7200 }) };
    }
    for (const [part, items] of recordsByUrlPart) {
      if (String(url).includes(part)) return { json: async () => ({ code: 0, data: { items } }) };
    }
    return { json: async () => ({ code: 0, data: { items: [] } }) };
  };
}

// ───────────────────────── transient-errors.js ─────────────────────────

test('transient-errors: isTransientFeishuBitableError/isDataNotReadyError/isFeishuInternalError/sleep', async () => {
  assert.equal(isTransientFeishuBitableError('1254607: data not ready'), true);
  assert.equal(isTransientFeishuBitableError('502 Bad Gateway'), true);
  assert.equal(isTransientFeishuBitableError('random unrelated error'), false);
  assert.equal(isTransientFeishuBitableError(), false);

  assert.equal(isDataNotReadyError('1254607: data not ready'), true);
  assert.equal(isDataNotReadyError('feishu_code_2200'), false);

  assert.equal(isFeishuInternalError('feishu_code_2200: internal error'), true);
  assert.equal(isFeishuInternalError('1254607: data not ready'), false);

  const t0 = Date.now();
  await sleep(5);
  assert.ok(Date.now() - t0 >= 0);
});

// ───────────────────────── field-extractors.js ─────────────────────────

test('field-extractors: extractFieldText 各类型输入', () => {
  assert.equal(extractFieldText(null), '');
  assert.equal(extractFieldText(undefined), '');
  assert.equal(extractFieldText(' 张三 '), '张三');
  assert.equal(extractFieldText(3.5), '3.5');
  assert.equal(extractFieldText(true), 'true');
  assert.equal(extractFieldText([' a ', 1, null, { name: 'b' }, {}]), 'a 1 b');
  assert.equal(extractFieldText({ text: 'hello' }), 'hello');
  assert.equal(extractFieldText({ value: 'v1' }), 'v1');
  assert.equal(extractFieldText({}), '');
});

test('field-extractors: pickFieldValue/pickFieldText/parseFieldNumber/pickFieldNumber', () => {
  const fields = { '门店': '洪潮店A', '空字段': '', '数量': '1,234.567' };
  assert.equal(pickFieldValue(fields, ['不存在', '门店']), '洪潮店A');
  assert.equal(pickFieldValue(fields, ['不存在']), null);
  // hasOwnProperty 命中但值为空字符串：仍返回该 key 的值(''),而不是继续找下一个候选
  assert.equal(pickFieldValue(fields, ['空字段', '门店']), '');

  assert.equal(pickFieldText(fields, ['门店']), '洪潮店A');
  assert.equal(pickFieldText(fields, ['空字段'], '默认'), '默认');

  assert.equal(parseFieldNumber('1,234.567'), 1234.57);
  assert.equal(parseFieldNumber(''), null);
  assert.equal(parseFieldNumber('abc'), null);

  assert.equal(pickFieldNumber(fields, ['数量']), 1234.57);
  assert.equal(pickFieldNumber(fields, ['不存在']), null);
});

test('field-extractors: extractDishLibraryEntries 堂食/外卖/强制外卖分支', () => {
  const dinein = extractDishLibraryEntries({
    '门店': '马己仙A店', '堂食名称': '牛肉面', '堂食价格': '28', '堂食成本': '10'
  }, 'rec1');
  assert.equal(dinein.length, 1);
  assert.equal(dinein[0].biz_type, 'dinein');
  assert.equal(dinein[0].brand, '马己仙');

  const takeaway = extractDishLibraryEntries({
    '门店': '洪潮B店', '外卖名称': '牛肉面外卖', '外卖价格': '30', '外卖成本': '12'
  }, 'rec2');
  assert.equal(takeaway.length, 1);
  assert.equal(takeaway[0].biz_type, 'takeaway');
  assert.equal(takeaway[0].brand, '洪潮');

  const both = extractDishLibraryEntries({
    '门店': '马己仙C店', '堂食名称': '面A', '堂食价格': '20',
    '外卖名称': '面A外卖', '外卖价格': '22'
  }, 'rec3');
  assert.equal(both.length, 2);

  const forced = extractDishLibraryEntries({
    '菜品名称': '通用菜', '售价': '18'
  }, 'rec4', { forceBizType: 'takeaway' });
  assert.equal(forced.length, 1);
  assert.equal(forced[0].biz_type, 'takeaway');
  assert.equal(forced[0].brand, '*');

  // 无任何有效价格/成本 -> 不产出任何行
  const empty = extractDishLibraryEntries({ '门店': '随便' }, 'rec5');
  assert.deepEqual(empty, []);
});

test('field-extractors: extractClosingReportFields/extractOpeningReportFields', () => {
  const closing = extractClosingReportFields({ '门店': 'A店', '日期': '2026-07-01', '档口': '炒锅', '交接时间': '18:00' });
  assert.equal(closing.store, 'A店');
  assert.equal(closing.handover_time, '18:00');

  const opening = extractOpeningReportFields({ '门店': 'A店', '日期': '2026-07-01', '档口': '炒锅', '开档时间': '08:00' });
  assert.equal(opening.preparation_time, '08:00');
});

test('field-extractors: extractMeetingReportFields 会议得分非法值兜底0', () => {
  const m1 = extractMeetingReportFields({ '门店': 'A店', '日期': '2026-07-01', '会议得分': '85' });
  assert.equal(m1.meeting_score, 85);
  const m2 = extractMeetingReportFields({ '门店': 'A店', '日期': '2026-07-01', '会议得分': 'abc' });
  assert.equal(m2.meeting_score, 0);
});

test('field-extractors: extractMaterialReportFields', () => {
  const r = extractMaterialReportFields({ '门店': 'A店', '日期': '2026-07-01', '收货人': '张三', '总金额': '999' });
  assert.equal(r.receiver, '张三');
  assert.equal(r.total_amount, '999');
});

test('field-extractors: extractSopStepFields 必填缺失返回null/关键步骤解析', () => {
  const missing = extractSopStepFields({ '菜品名称': '牛肉面' }, 'rec1');
  assert.equal(missing, null);

  const full = extractSopStepFields({
    '菜品名称': '牛肉面', '档口': '炒锅', '步骤序号': '1', '操作动作': '下锅',
    '是否关键步骤': true, '时限秒': '30'
  }, 'rec2');
  assert.equal(full.dish_name, '牛肉面');
  assert.equal(full.step_seq, 1);
  assert.equal(full.is_critical, true);
  assert.equal(full.store, '*');
});

// ───────────────────────── config.js ─────────────────────────

test('config: FEISHU_TABLE_CONFIG/withTableMeta', () => {
  assert.ok(FEISHU_TABLE_CONFIG.closing_reports.app_token);
  const meta = withTableMeta('closing_reports', { view_id: 'custom_view' });
  assert.equal(meta.app_token, FEISHU_TABLE_CONFIG.closing_reports.app_token);
  assert.equal(meta.view_id, 'custom_view');
  const unknownKeyMeta = withTableMeta('not_a_real_key', { app_token: 'tok', table_id: 'tbl' });
  assert.equal(unknownKeyMeta.app_token, 'tok');
});

test('config: loadTenantFeishuConfig 无加密key直接返回null', async () => {
  const orig = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  try {
    setPool(makeMockPool([]));
    assert.equal(await loadTenantFeishuConfig('default'), null);
  } finally {
    if (orig !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = orig; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  }
});

test('config: loadTenantFeishuConfig 命中已配置租户集成', async () => {
  const orig = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  try {
    const cfg = { app_id: 'appid1', app_secret: 'secret1', tables: { closing_reports: { app_token: 'tok', table_id: 'tbl' } } };
    const encrypted = encryptIntegrationConfig(cfg, process.env.TENANT_INTEGRATION_ENCRYPTION_KEY);
    setPool(makeMockPool([
      [/FROM tenant_integrations/i, async () => ({ rows: [{ encrypted_config: encrypted }] })],
    ]));
    const loaded = await loadTenantFeishuConfig('t1');
    assert.equal(loaded.app_id, 'appid1');
    assert.equal(loaded.tables.closing_reports.table_id, 'tbl');
  } finally {
    if (orig !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = orig; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  }
});

test('config: loadTenantFeishuConfig 未配置+非default租户+禁用兼容 -> null', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  const origAllow = process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.ALLOW_LEGACY_FEISHU_FALLBACK = 'false';
  try {
    setPool(makeMockPool([
      [/FROM tenant_integrations/i, async () => ({ rows: [] })],
    ]));
    assert.equal(await loadTenantFeishuConfig('some_tenant'), null);
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
    if (origAllow !== undefined) process.env.ALLOW_LEGACY_FEISHU_FALLBACK = origAllow; else delete process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
  }
});

test('config: loadTenantFeishuConfig 未配置+default租户+允许兼容 -> 落回env静态映射并持久化', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  const origAllow = process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
  const origAppId = process.env.FEISHU_APP_ID;
  const origAppSecret = process.env.FEISHU_APP_SECRET;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.ALLOW_LEGACY_FEISHU_FALLBACK = 'true';
  process.env.FEISHU_APP_ID = 'legacy_app_id';
  process.env.FEISHU_APP_SECRET = 'legacy_app_secret';
  try {
    let insertCalled = false;
    setPool(makeMockPool([
      [/FROM tenant_integrations/i, async () => ({ rows: [] })],
      [/INSERT INTO tenant_integrations/i, async () => { insertCalled = true; return { rows: [] }; }],
    ]));
    const legacy = await loadTenantFeishuConfig('default');
    assert.equal(legacy.app_id, 'legacy_app_id');
    assert.ok(legacy.tables.closing_reports.app_token);
    assert.equal(insertCalled, true);
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
    if (origAllow !== undefined) process.env.ALLOW_LEGACY_FEISHU_FALLBACK = origAllow; else delete process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
    if (origAppId !== undefined) process.env.FEISHU_APP_ID = origAppId; else delete process.env.FEISHU_APP_ID;
    if (origAppSecret !== undefined) process.env.FEISHU_APP_SECRET = origAppSecret; else delete process.env.FEISHU_APP_SECRET;
  }
});

test('config: resolveWebhookTenantId 空token兜底default/缓存命中', async () => {
  assert.equal(await resolveWebhookTenantId(''), 'default');
  assert.equal(await resolveWebhookTenantId(null), 'default');
});

test('config: resolveWebhookTenantId 缓存过期后按app_token重建租户映射', async (t) => {
  // 用假时钟把 Date.now() 拨快 6 分钟，确保跨过模块内 5 分钟缓存窗口、必定触发重建，
  // 不依赖此前用例留下的真实缓存时间戳。
  t.mock.timers.enable({ apis: ['Date'] });
  await withLegacyFeishuEnv(async () => {
    const cfg = { app_id: 'appid2', app_secret: 'secret2', tables: { closing_reports: { app_token: 'webhook_tok', table_id: 'tbl' } } };
    const encrypted = encryptIntegrationConfig(cfg, TEST_ENCRYPTION_KEY);
    setPool(makeMockPool([
      [/SELECT DISTINCT tenant_id FROM tenant_integrations/i, async () => ({ rows: [{ tenant_id: 'tA' }] })],
      [/SELECT encrypted_config FROM tenant_integrations/i, async () => ({ rows: [{ encrypted_config: encrypted }] })],
    ]));
    t.mock.timers.tick(6 * 60 * 1000);
    assert.equal(await resolveWebhookTenantId('webhook_tok'), 'tA');
    // 重建后 5 分钟内命中内存缓存，不查表也能拿到同样结果
    assert.equal(await resolveWebhookTenantId('webhook_tok'), 'tA');
    // 缓存里没有的 app_token 兜底 default
    assert.equal(await resolveWebhookTenantId('unknown_tok'), 'default');
  });
});

test('config: resolveWebhookTenantId 重建查询异常时兜底不抛出', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  t.mock.timers.tick(6 * 60 * 1000); // 跨过上一用例建立的缓存窗口，强制本次触发重建
  setPool({
    query: async () => { throw new Error('tenant_integrations_query_down'); },
    connect: async () => { throw new Error('tenant_integrations_query_down'); },
  });
  assert.equal(await resolveWebhookTenantId('any_tok'), 'default');
});

// ───────────────────────── api.js ─────────────────────────

test('api: getFeishuAccessToken 成功返回token', async () => {
  await withMockFetch(
    async () => ({ json: async () => ({ code: 0, tenant_access_token: 'tok_abc', expire: 7200 }) }),
    async () => {
      const token = await getFeishuAccessToken({ app_id: 'a', app_secret: 'b' });
      assert.equal(token, 'tok_abc');
    }
  );
});

test('api: fetchTableRecordsPage 成功首次返回', async () => {
  await withMockFetch(
    async () => ({ json: async () => ({ code: 0, data: { items: [{ record_id: 'r1', fields: {} }] } }) }),
    async () => {
      const data = await fetchTableRecordsPage({ app_token: 'at', table_id: 'tb' }, 'token', new URLSearchParams());
      assert.equal(data.data.items.length, 1);
    }
  );
});

test('api: fetchTableRecordsPage 非瞬态错误立即抛出（不重试）', async () => {
  await withMockFetch(
    async () => ({ json: async () => ({ code: 99999, msg: 'permanent failure' }) }),
    async () => {
      await assert.rejects(
        () => fetchTableRecordsPage({ app_token: 'at', table_id: 'tb' }, 'token', new URLSearchParams()),
        /获取表格数据失败/
      );
    }
  );
});

test('api: fetchTableRecordsPage fetch自身抛出非瞬态异常立即抛出', async () => {
  await withMockFetch(
    async () => { throw new Error('boom_permanent'); },
    async () => {
      await assert.rejects(
        () => fetchTableRecordsPage({ app_token: 'at', table_id: 'tb' }, 'token', new URLSearchParams()),
        /获取表格数据失败: boom_permanent/
      );
    }
  );
});

test('api: fetchTableRecords 分页拼接', async () => {
  let call = 0;
  await withMockFetch(
    async () => {
      call++;
      if (call === 1) return { json: async () => ({ code: 0, data: { items: [{ record_id: 'r1' }], page_token: 'p2' } }) };
      return { json: async () => ({ code: 0, data: { items: [{ record_id: 'r2' }] } }) };
    },
    async () => {
      const records = await fetchTableRecords({ app_token: 'at', table_id: 'tb', view_id: 'v1' }, 'token');
      assert.equal(records.length, 2);
      assert.equal(records[1].record_id, 'r2');
    }
  );
});

// ───────────────────────── notify.js ─────────────────────────

test('notify: 瞬态错误跳过通知；非瞬态错误调用已注册的notifier；notifier异常被吞掉', () => {
  let called = null;
  setFeishuSyncFailureNotifier((label, err) => { called = { label, err }; });

  notifyFeishuSyncFailure('table_a', new Error('502 Bad Gateway'));
  assert.equal(called, null);

  notifyFeishuSyncFailure('table_b', new Error('permanent failure'));
  assert.equal(called.label, 'table_b');

  setFeishuSyncFailureNotifier(() => { throw new Error('notifier_broken'); });
  assert.doesNotThrow(() => notifyFeishuSyncFailure('table_c', new Error('permanent failure 2')));

  setFeishuSyncFailureNotifier(null);
  assert.doesNotThrow(() => notifyFeishuSyncFailure('table_d', new Error('permanent failure 3')));
});

// ───────────────────────── report-sync.js ─────────────────────────

test('report-sync: syncKitchenReports 跳过缺字段记录+正常写入closing/opening', async () => {
  const inserted = [];
  setPool(makeMockPool([
    [/INSERT INTO kitchen_reports/, async (sql, params) => { inserted.push(params); return { rows: [] }; } ],
  ]));
  await withMockFetch(
    async () => ({ json: async () => ({ code: 0, data: { items: [
      { record_id: 'r1', fields: { '门店': '', '日期': '2026-07-01', '档口': '炒锅' } }, // 缺门店 -> 跳过
      { record_id: 'r2', fields: { '门店': '洪潮店A', '日期': '2026-07-01', '档口': '炒锅', '交接时间': '18:00' } },
    ] } }) }),
    async () => {
      await syncKitchenReports({ name: '收档报告DB', app_token: 'at', table_id: 'tb' }, 'token', 'closing', 'default');
    }
  );
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][0], '洪潮店A');
  assert.equal(inserted[0][3], 'closing');

  inserted.length = 0;
  await withMockFetch(
    async () => ({ json: async () => ({ code: 0, data: { items: [
      { record_id: 'r3', fields: { '门店': '马己仙店A', '日期': '2026-07-01', '档口': '炒锅', '开档时间': '08:00' } },
    ] } }) }),
    async () => {
      await syncKitchenReports({ name: '开档报告', app_token: 'at', table_id: 'tb' }, 'token', 'opening', 'default');
    }
  );
  assert.equal(inserted[0][3], 'opening');
});

test('report-sync: syncKitchenReports 异常时兜底不抛出并触发通知', async () => {
  let notified = false;
  setFeishuSyncFailureNotifier(() => { notified = true; });
  setPool(makeMockPool([]));
  await withMockFetch(
    async () => { throw new Error('permanent_fetch_error'); },
    async () => {
      await assert.doesNotReject(() => syncKitchenReports({ name: '收档报告DB', app_token: 'at', table_id: 'tb' }, 'token', 'closing', 'default'));
    }
  );
  assert.equal(notified, true);
  setFeishuSyncFailureNotifier(null);
});

test('report-sync: syncMeetingReports 跳过缺日期记录+正常写入', async () => {
  const inserted = [];
  setPool(makeMockPool([
    [/INSERT INTO store_meeting_reports/, async (sql, params) => { inserted.push(params); return { rows: [] }; } ],
  ]));
  await withMockFetch(
    async () => ({ json: async () => ({ code: 0, data: { items: [
      { record_id: 'r1', fields: { '门店': '洪潮店A', '会议得分': '90' } }, // 缺日期 -> 跳过
      { record_id: 'r2', fields: { '门店': '洪潮店A', '日期': '2026-07-01', '会议得分': '95', '汇报人': '张三' } },
    ] } }) }),
    async () => {
      await syncMeetingReports({ name: '例会报告', app_token: 'at', table_id: 'tb' }, 'token', 'default');
    }
  );
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][3], '张三');
});

test('report-sync: syncMaterialReports 跳过缺门店记录+正常写入', async () => {
  const inserted = [];
  setPool(makeMockPool([
    [/INSERT INTO material_receiving_reports/, async (sql, params) => { inserted.push(params); return { rows: [] }; } ],
  ]));
  await withMockFetch(
    async () => ({ json: async () => ({ code: 0, data: { items: [
      { record_id: 'r1', fields: { '日期': '2026-07-01' } }, // 缺门店 -> 跳过
      { record_id: 'r2', fields: { '门店': '马己仙店A', '日期': '2026-07-01', '收货人': '李四' } },
    ] } }) }),
    async () => {
      await syncMaterialReports({ name: '马己仙原料收货日报', app_token: 'at', table_id: 'tb' }, 'token', 'majixian', 'default');
    }
  );
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][3], '李四');
});

// ───────────────────────── dish-library-sync.js ─────────────────────────

test('dish-library-sync: syncDishLibraryCosts 集成未配置时跳过', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  try {
    setPool(makeMockPool([]));
    const r = await syncDishLibraryCosts('t_no_integration');
    assert.equal(r.ok, false);
    assert.equal(r.skipped, 'integration_not_configured');
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey;
  }
});

test('dish-library-sync: syncDishLibraryCosts 正常路径遍历两张源表并写入', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  const origAllow = process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
  const origAppId = process.env.FEISHU_APP_ID;
  const origAppSecret = process.env.FEISHU_APP_SECRET;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.ALLOW_LEGACY_FEISHU_FALLBACK = 'true';
  process.env.FEISHU_APP_ID = 'legacy_app_id';
  process.env.FEISHU_APP_SECRET = 'legacy_app_secret';
  try {
    const upserted = [];
    setPool(makeMockPool([
      [/FROM tenant_integrations/i, async () => ({ rows: [] })],
      [/INSERT INTO tenant_integrations/i, async () => ({ rows: [] })],
      [/CREATE TABLE|ALTER TABLE|CREATE INDEX|UPDATE dish_library_costs|DO \$\$/i, async () => ({ rows: [] })],
      [/INSERT INTO dish_library_costs/i, async (sql, params) => { upserted.push(params); return { rows: [] }; }],
    ]));
    await withMockFetch(
      async (url) => {
        if (String(url).includes('tenant_access_token')) {
          return { json: async () => ({ code: 0, tenant_access_token: 'tok', expire: 7200 }) };
        }
        return { json: async () => ({ code: 0, data: { items: [
          { record_id: 'rd1', fields: { '门店': '马己仙A店', '堂食名称': '牛肉面', '堂食价格': '28', '堂食成本': '10' } },
        ] } }) };
      },
      async () => {
        const r = await syncDishLibraryCosts('default');
        assert.equal(r.ok, true);
        // 两张源表各拉到1条同样的记录(source_records=2)，但只有非强制外卖表的堂食字段能提取出行；
        // majixian_takeaway 表 forceBizType='takeaway' 时要求「菜品名称」等通用外卖字段，该记录没有 -> 不产出行
        assert.equal(r.records, 2);
        assert.equal(r.upserted, 1);
      }
    );
    assert.equal(upserted.length, 1);
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
    if (origAllow !== undefined) process.env.ALLOW_LEGACY_FEISHU_FALLBACK = origAllow; else delete process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
    if (origAppId !== undefined) process.env.FEISHU_APP_ID = origAppId; else delete process.env.FEISHU_APP_ID;
    if (origAppSecret !== undefined) process.env.FEISHU_APP_SECRET = origAppSecret; else delete process.env.FEISHU_APP_SECRET;
  }
});

test('dish-library-sync: syncDishLibraryCosts 异常兜底返回ok:false', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  try {
    setPool({
      query: async () => { throw new Error('db_down'); },
      connect: async () => { throw new Error('db_down'); },
    });
    const r = await syncDishLibraryCosts('default');
    assert.equal(r.ok, false);
    assert.match(r.error, /db_down/);
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  }
});

// ───────────────────────── sop-sync.js ─────────────────────────

test('sop-sync: syncSopSteps 集成未配置时跳过', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  try {
    setPool(makeMockPool([]));
    const r = await syncSopSteps('t_no_integration');
    assert.equal(r.ok, false);
    assert.equal(r.skipped, 'integration_not_configured');
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey;
  }
});

test('sop-sync: syncSopSteps 正常路径按行插入并统计skipped', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  const origAllow = process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
  const origAppId = process.env.FEISHU_APP_ID;
  const origAppSecret = process.env.FEISHU_APP_SECRET;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.ALLOW_LEGACY_FEISHU_FALLBACK = 'true';
  process.env.FEISHU_APP_ID = 'legacy_app_id';
  process.env.FEISHU_APP_SECRET = 'legacy_app_secret';
  try {
    const upserted = [];
    setPool(makeMockPool([
      [/FROM tenant_integrations/i, async () => ({ rows: [] })],
      [/INSERT INTO tenant_integrations/i, async () => ({ rows: [] })],
      [/INSERT INTO kitchen_sop_steps/i, async (sql, params) => { upserted.push(params); return { rows: [] }; }],
    ]));
    await withMockFetch(
      async (url) => {
        if (String(url).includes('tenant_access_token')) {
          return { json: async () => ({ code: 0, tenant_access_token: 'tok', expire: 7200 }) };
        }
        return { json: async () => ({ code: 0, data: { items: [
          { record_id: 's1', fields: { '菜品名称': '牛肉面', '档口': '炒锅', '步骤序号': '1', '操作动作': '下锅' } },
          { record_id: 's2', fields: { '菜品名称': '缺步骤' } },
        ] } }) };
      },
      async () => {
        const r = await syncSopSteps('default');
        assert.equal(r.ok, true);
        assert.equal(r.upserted, 1);
        assert.equal(r.skipped, 1);
      }
    );
    assert.equal(upserted.length, 1);
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
    if (origAllow !== undefined) process.env.ALLOW_LEGACY_FEISHU_FALLBACK = origAllow; else delete process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
    if (origAppId !== undefined) process.env.FEISHU_APP_ID = origAppId; else delete process.env.FEISHU_APP_ID;
    if (origAppSecret !== undefined) process.env.FEISHU_APP_SECRET = origAppSecret; else delete process.env.FEISHU_APP_SECRET;
  }
});

// ───────────────────────── orchestrator.js ─────────────────────────

test('orchestrator: syncAllFeishuTables 集成未配置时跳过', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  try {
    setPool(makeMockPool([]));
    await assert.doesNotReject(() => syncAllFeishuTables('t_no_integration'));
  } finally {
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey;
  }
});

test('orchestrator: syncAllFeishuTables 顶层异常兜底不抛出并触发通知', async () => {
  const origKey = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  let notified = false;
  setFeishuSyncFailureNotifier(() => { notified = true; });
  try {
    setPool({
      query: async () => { throw new Error('db_down'); },
      connect: async () => { throw new Error('db_down'); },
    });
    await assert.doesNotReject(() => syncAllFeishuTables('default'));
    assert.equal(notified, true);
  } finally {
    setFeishuSyncFailureNotifier(null);
    if (origKey !== undefined) process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = origKey; else delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  }
});

test('orchestrator: startDailyFeishuSync 同步启动阶段不抛出', () => {
  assert.doesNotThrow(() => startDailyFeishuSync());
});

test('orchestrator: syncAllFeishuTables 正常路径依次调用全部子同步', async () => {
  await withLegacyFeishuEnv(async () => {
    setPool(makeMockPool([
      [/FROM tenant_integrations/i, async () => ({ rows: [] })],
      [/INSERT INTO tenant_integrations/i, async () => ({ rows: [] })],
    ]));
    await withMockFetch(tokenAndRecordsFetch([]), async () => {
      await assert.doesNotReject(() => syncAllFeishuTables('default'));
    });
  });
});

test('orchestrator: runDailyFeishuSyncOnce 编排 runForActiveTenants 并在失败时通知', async () => {
  let notified = null;
  setFeishuSyncFailureNotifier((label) => { notified = label; });
  try {
    // tenants 表返回空 -> getActiveTenantIds 兜底空数组 -> runForActiveTenants 抛 no_active_tenants -> 走 catch+通知
    setPool(makeMockPool([
      [/FROM tenants WHERE status/i, async () => ({ rows: [] })],
    ]));
    await assert.doesNotReject(() => runDailyFeishuSyncOnce());
    assert.equal(notified, '每日凌晨定时');
  } finally {
    setFeishuSyncFailureNotifier(null);
  }
});

test('orchestrator: runWeeklyDishLibrarySyncOnce 非窗口期不触发/窗口期触发一次并去重/异常兜底通知', async () => {
  const notified = [];
  setFeishuSyncFailureNotifier((label) => { notified.push(label); });
  try {
    // 非周六窗口：不触发任何逻辑
    const weekday = new Date('2026-07-27T10:00:00'); // 周一
    const state1 = { lastKey: '' };
    await runWeeklyDishLibrarySyncOnce(state1, weekday);
    assert.equal(state1.lastKey, '');

    // 周六 00:02 窗口内：触发一次；重复调用同一 nowSh 因去重键不变而跳过
    setPool(makeMockPool([
      [/FROM tenants WHERE status/i, async () => ({ rows: [{ tenant_id: 'default' }] })],
    ]));
    await withMockFetch(async () => ({ json: async () => ({ code: 0, data: { items: [] } }) }), async () => {
      const saturday = new Date('2026-08-01T00:02:00'); // 周六
      const state2 = { lastKey: '' };
      await runWeeklyDishLibrarySyncOnce(state2, saturday);
      assert.equal(state2.lastKey, '2026-08-01');
      const before = state2.lastKey;
      await runWeeklyDishLibrarySyncOnce(state2, saturday);
      assert.equal(state2.lastKey, before); // 去重：同一天不重复跑
    });

    // 异常兜底：nowSh 本身读取异常 -> catch 内通知（不依赖 runForActiveTenants 内部缓存状态）
    const brokenNowSh = { getDay() { throw new Error('clock_broken'); } };
    const state3 = { lastKey: '' };
    await assert.doesNotReject(() => runWeeklyDishLibrarySyncOnce(state3, brokenNowSh));
    assert.ok(notified.includes('每周菜品库调度'));
  } finally {
    setFeishuSyncFailureNotifier(null);
  }
});

// ───────────────────────── feishu-sync.js barrel ─────────────────────────

test('feishu-sync.js barrel: 原有 import 路径仍可用', () => {
  assert.equal(typeof barrel.FEISHU_TABLE_CONFIG, 'object');
  assert.equal(typeof barrel.resolveWebhookTenantId, 'function');
  assert.equal(typeof barrel.loadTenantFeishuBitableConfig, 'function');
  assert.equal(typeof barrel.extractClosingReportFields, 'function');
  assert.equal(typeof barrel.extractOpeningReportFields, 'function');
  assert.equal(typeof barrel.extractMeetingReportFields, 'function');
  assert.equal(typeof barrel.extractMaterialReportFields, 'function');
  assert.equal(typeof barrel.getFeishuAccessToken, 'function');
  assert.equal(typeof barrel.fetchTableRecords, 'function');
  assert.equal(typeof barrel.setFeishuSyncFailureNotifier, 'function');
  assert.equal(typeof barrel.syncKitchenReports, 'function');
  assert.equal(typeof barrel.syncMeetingReports, 'function');
  assert.equal(typeof barrel.syncMaterialReports, 'function');
  assert.equal(typeof barrel.syncDishLibraryCosts, 'function');
  assert.equal(typeof barrel.syncSopSteps, 'function');
  assert.equal(typeof barrel.syncAllFeishuTables, 'function');
  assert.equal(typeof barrel.startDailyFeishuSync, 'function');
});
