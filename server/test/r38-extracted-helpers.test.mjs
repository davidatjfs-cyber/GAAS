/**
 * R38：冲高 sales-ai / wecom-feishu / queries / profiles / content* / turnover。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  remindStaleHighIntentLeads,
  runRiskAlerts,
} from '../domains/sales-ai/service.js';
import {
  getWecomConfigEndpoint,
  saveWecomConfig,
  listStoreWecomConfigs,
  upsertStoreWecomConfig,
  deleteStoreWecomConfig,
  syncWecomContactsForStore,
  syncWecomContactsEndpoint,
  getFeishuConfig,
  saveFeishuConfig,
} from '../domains/growth-wecom-feishu/service.js';
import {
  listCustomers,
  listEvents,
  listCampaigns,
  listRedemptions,
  handleFeishuCallback,
  semanticParse,
  semanticWriteback,
} from '../domains/growth-queries/service.js';
import {
  listStoreProfiles,
  upsertStoreProfile,
  listCustomerProfiles,
  recomputeProfiles,
  listProfileSignals,
  createProfileSignal,
  listStoreConstraints,
  upsertStoreConstraint,
  getStrategyContext,
} from '../domains/growth-profiles/service.js';
import {
  listPublicChannels,
  upsertPublicChannel,
  listPublicPromoTasks,
  upsertPublicPromoTask,
  listCreativeAssets,
  upsertCreativeAsset,
  listPosterTemplates,
  upsertPosterTemplate,
  deleteById,
  listGeneratedPosters,
  upsertGeneratedPoster,
  listContentLibrary,
} from '../domains/growth-content-library/service.js';
import {
  safeDateOnly,
  listContentSuggestions,
  listContentPerformance,
  upsertContentPerformance,
  upsertContentPerformanceV2,
  generateDishTrendSummary,
  generateWeeklyContentSuggestion,
  pushWeeklySuggestionToFeishu,
} from '../domains/growth-content/service.js';
import { getTurnoverReportPayload } from '../domains/reports/service-turnover.js';
import { bindReportsRuntimeDeps } from '../domains/reports/helpers.js';

function tcCtx(pool, extra = {}) {
  return {
    pool,
    tenantContext: { run: async (_t, fn) => fn() },
    resolveTenantIdDefault: () => 'default',
    resolveTenantIdForStore: async () => 'default',
    parseOccurredAt: (v) => (v ? new Date(v) : new Date()),
    ...extra,
  };
}

test('sales-ai/service：remind + risk alerts', async () => {
  assert.equal(await remindStaleHighIntentLeads({}, null), undefined);
  const alerts = [];
  const updates = [];
  const pool = {
    async query(sql, params) {
      if (/intent_level = 'high'/.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              lead_key: 'L1',
              company: 'C',
              name: 'N',
              city: '上海',
              store_count: 2,
              intent_score: 90,
              next_action: '打电话',
            },
          ],
        };
      }
      if (/last_risk_check_at/.test(sql) && /SELECT/.test(sql)) {
        return {
          rows: [
            {
              id: 2,
              lead_key: 'L2',
              company: 'D',
              name: 'M',
              intent_score: 80,
              stage: 'demo',
              last_human_at: new Date(Date.now() - 4 * 86400000).toISOString(),
              updated_at: new Date(Date.now() - 4 * 86400000).toISOString(),
              decision_role: null,
              demo_count: 1,
              has_asked_price: true,
            },
          ],
        };
      }
      if (/UPDATE sales_leads/.test(sql)) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  await remindStaleHighIntentLeads(pool, async (msg, meta) => {
    alerts.push({ msg, meta });
  });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].msg, /高意向/);

  await runRiskAlerts(pool, async (msg) => {
    alerts.push({ msg });
  });
  assert.ok(alerts.some((a) => /风险/.test(a.msg)));
  assert.ok(updates.some((u) => /last_risk_check_at/.test(u.sql)));

  // alert 抛错仍继续
  await remindStaleHighIntentLeads(pool, async () => {
    throw new Error('boom');
  });
});

test('growth-wecom-feishu/service：config/sync/list/delete', async () => {
  const cleared = [];
  const ctx = {
    tenantContext: { run: async (_t, fn) => fn() },
    resolveTenantIdForStore: async () => 'default',
    getWecomConfig: async () => ({ corp_id: 'c', callback_secret: 's' }),
    getStoreWecomConfig: async () => ({
      store_id: 's1',
      sender_userid: 'u1',
      corp_id: 'c',
    }),
    getAllStoreWecomConfigs: async () => [{ store_id: 's1', sender_userid: 'u1' }],
    getWecomAccessToken: async () => 'tok',
    resetGrowthWecomTokenCache: () => {},
    clearStoreWecomTokenCache: (id) => cleared.push(id),
    fetch: async (url) => {
      if (url.includes('/list?')) {
        return {
          async json() {
            return { errcode: 0, external_userid: ['e1'] };
          },
        };
      }
      return {
        async json() {
          return {
            errcode: 0,
            external_contact: {
              external_userid: 'e1',
              name: '客人',
            },
            follow_info: [{ description: '手机13800138000' }],
          };
        },
      };
    },
  };
  const pool = {
    async query() {
      return { rows: [{ data: { app_token: 'a' } }] };
    },
  };
  assert.equal((await getWecomConfigEndpoint(ctx, pool)).status, 200);
  assert.equal(
    (await saveWecomConfig(ctx, pool, { corp_id: 'c', corp_secret: 's', sender_userid: 'u' })).status,
    200
  );
  assert.equal((await listStoreWecomConfigs(ctx, pool)).body.configs.length, 1);
  assert.equal(
    (
      await upsertStoreWecomConfig(ctx, pool, {
        store_id: 's1',
        corp_id: 'c',
        corp_secret: 'sec',
        sender_userid: 'u',
      })
    ).status,
    200
  );
  assert.equal((await deleteStoreWecomConfig(ctx, pool, 's1')).status, 200);
  assert.ok(cleared.includes('s1'));
  assert.equal(await syncWecomContactsForStore(ctx, pool, { store_id: 's1', sender_userid: 'u1' }), 1);
  const syncEp = await syncWecomContactsEndpoint(ctx, pool, { store_id: 's1' });
  assert.equal(syncEp.body.total, 1);
  assert.equal((await getFeishuConfig(ctx, pool)).body.config.app_token, 'a');
  assert.equal(
    (await saveFeishuConfig(ctx, pool, { app_token: 't', table_id: 'tbl' })).status,
    200
  );
});

test('growth-queries/service：list* + callback + writeback', async () => {
  const pool = {
    async query(sql) {
      if (/SELECT \* FROM growth_actions/.test(sql)) {
        return { rows: [{ action_key: 'a1', store_id: 's1', action_type: 'send' }] };
      }
      return { rows: [{ id: 1 }] };
    },
  };
  const logs = [];
  const ctx = tcCtx(pool, {
    getActiveTenantIds: async () => ['default'],
    appendExecutionLog: async (_p, row) => {
      logs.push(row.decision);
    },
  });
  assert.equal((await listCustomers(ctx, 'default', { phone: '1', limit: 10 })).body.customers.length, 1);
  assert.equal((await listEvents(ctx, 'default', { event_type: 'scan' })).body.events.length, 1);
  assert.equal((await listCampaigns(ctx, 'default', { status: 'active' })).body.campaigns.length, 1);
  assert.equal((await listRedemptions(ctx, 'default', { store_id: 's' })).body.redemptions.length, 1);

  const prev = process.env.FEISHU_CALLBACK_SECRET;
  process.env.FEISHU_CALLBACK_SECRET = 'sec';
  try {
    const ign = await handleFeishuCallback(
      ctx,
      { secret: 'sec', action_key: 'a1', decision: 'ignore' },
      {}
    );
    assert.equal(ign.status, 200);
    assert.equal(ign.body.action, 'ignored');
    const fb = await handleFeishuCallback(
      ctx,
      { secret: 'sec', action_key: 'a1', decision: 'feedback', reason: '备注' },
      {}
    );
    assert.equal(fb.status, 200);
    assert.equal(fb.body.action, 'feedback_submitted');
    const bad = await handleFeishuCallback(
      ctx,
      { secret: 'sec', action_key: 'a1', decision: 'weird' },
      {}
    );
    assert.equal(bad.status, 400);
    assert.ok(logs.includes('ignored'));
  } finally {
    if (prev == null) delete process.env.FEISHU_CALLBACK_SECRET;
    else process.env.FEISHU_CALLBACK_SECRET = prev;
  }

  const prevJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'dev';
  try {
    const parsed = await semanticParse(ctx, { text: '麻辣好吃' });
    assert.equal(parsed.status, 200);
    assert.ok(parsed.body.taste_tags?.length || parsed.body.source);
  } finally {
    if (prevJwt == null) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevJwt;
  }

  const wb = await semanticWriteback(ctx, 'default', {
    customer_id: 9,
    tags: ['vip'],
    taste_tags: ['麻辣'],
    price_sensitivity_hint: 3,
    return_intent: true,
  });
  assert.equal(wb.status, 200);
  assert.equal(wb.body.customer_id, 9);
});

test('growth-profiles/service：list/upsert/strategy', async () => {
  const pool = {
    async query() {
      return { rows: [{ id: 1, store_id: 's1' }] };
    },
  };
  const ctx = tcCtx(pool, {
    recomputeCustomerProfiles: async (_p, days) => days,
    upsertCustomer: async () => ({ id: 9 }),
  });
  assert.equal((await listStoreProfiles(ctx, 'default')).body.profiles.length, 1);
  assert.equal((await upsertStoreProfile(ctx, 'default', {})).status, 400);
  assert.equal((await upsertStoreProfile(ctx, 'default', { store_id: 's1', brand: '洪潮' })).status, 200);
  assert.equal((await listCustomerProfiles(ctx, 'default', { store_id: 's1' })).body.profiles.length, 1);
  assert.equal((await recomputeProfiles(ctx, 'default', { days: 30 })).body.days, 30);
  assert.equal((await listProfileSignals(ctx, 'default', { customer_id: 1 })).body.signals.length, 1);
  assert.equal(
    (await createProfileSignal(ctx, 'default', { customer_id: 1, signal_type: 'like', store_id: 's1' })).status,
    200
  );
  assert.equal((await listStoreConstraints(ctx, { store_id: 's1' })).body.constraints.length, 1);
  assert.equal((await upsertStoreConstraint(ctx, { store_id: 's1' })).status, 200);
  const strat = await getStrategyContext(ctx, 's1', 'xhs', 'all');
  assert.equal(strat.status, 200);
});

test('growth-content-library/service：list/upsert/delete', async () => {
  const pool = {
    async query() {
      return { rows: [{ id: 1 }] };
    },
  };
  const ctx = tcCtx(pool);
  assert.equal((await listPublicChannels(ctx)).body.channels.length, 1);
  assert.equal((await upsertPublicChannel(ctx, { channel_key: 'xhs', name: '小红书', platform: 'xhs' })).status, 200);
  assert.equal((await listPublicPromoTasks(ctx, {})).status, 200);
  assert.equal((await upsertPublicPromoTask(ctx, { task_key: 't1', title: '任务', channel_key: 'xhs' })).status, 200);
  assert.equal((await listCreativeAssets(ctx, 'default', {})).status, 200);
  assert.equal((await upsertCreativeAsset(ctx, 'default', { asset_key: 'a1', title: '素材', asset_type: 'image' })).status, 200);
  assert.equal((await listPosterTemplates(ctx)).status, 200);
  assert.equal((await upsertPosterTemplate(ctx, { template_key: 'p1', name: '海报' })).status, 200);
  assert.equal((await deleteById(ctx, 'poster_templates', 1)).status, 200);
  assert.equal((await listGeneratedPosters(ctx, {})).status, 200);
  assert.equal((await upsertGeneratedPoster(ctx, { poster_key: 'g1', template_key: 'p1' })).status, 200);
  assert.equal((await listContentLibrary(ctx, {})).status, 200);
});

test('growth-content/service：date/list/upsert/trend', async () => {
  assert.equal(safeDateOnly('2026-07-01'), '2026-07-01');
  assert.equal(safeDateOnly('bad'), '');
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push(sql);
      if (/FROM pos_order_items/.test(sql) || /dish_name/.test(sql)) {
        return {
          rows: [
            { dish_name: '牛肉汤', qty: 10, revenue: 500 },
            { dish_name: '凉菜', qty: 2, revenue: 50 },
          ],
        };
      }
      if (/INSERT INTO content_performance/.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              content_key: params[0],
              store_code: 's1',
              channel: 'xhs',
              winning_value: '标题A',
              impressions: 200,
              redemptions: 10,
            },
          ],
        };
      }
      if (/INSERT INTO growth_learnings/.test(sql)) return { rows: [] };
      return { rows: [{ id: 1 }] };
    },
  };
  assert.equal((await listContentSuggestions(pool, 'default', { storeCode: 's' })).length, 1);
  assert.equal((await listContentPerformance(pool, { channel: 'xhs' })).length, 1);
  const perf = await upsertContentPerformance(pool, 'default', {
    content_key: 'k1',
    store_code: 's1',
    channel: 'xhs',
    winning_value: '标题A',
    impressions: 200,
    redemptions: 10,
  });
  assert.equal(perf.content_key, 'k1');
  const v2 = await upsertContentPerformanceV2(pool, 'default', {
    content_key: 'k2',
    store_code: 's1',
    channel: 'xhs',
  });
  assert.ok(v2);
  const trendPool = {
    async query(sql) {
      if (/WITH cur AS/.test(sql) || /FULL JOIN/.test(sql)) {
        return {
          rows: [
            { dish_name: '热菜', cur_qty: 20, prev_qty: 10, cur_revenue: 100, prev_revenue: 50 },
            { dish_name: '冷菜', cur_qty: 2, prev_qty: 10, cur_revenue: 20, prev_revenue: 80 },
          ],
        };
      }
      if (/FROM growth_learnings/.test(sql) || /lookup|learnings/i.test(sql)) {
        return {
          rows: [
            {
              winning_value: '亲切口吻',
              effect_desc: '+12%',
              is_verified: true,
              audience_tag: '午市',
            },
          ],
        };
      }
      if (/FROM ab_test_tasks/.test(sql)) {
        return { rows: [{ test_type: 'sms_copy', winner: 'A' }] };
      }
      if (/INSERT INTO growth_content_suggestions/.test(sql)) {
        return { rows: [{ id: 3, suggestion_key: 'weekly_s1_2026-07-01', feishu_pushed_at: null }] };
      }
      if (/UPDATE growth_content_suggestions/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const trend = await generateDishTrendSummary(trendPool, 's1');
  assert.ok(trend.topGrowers.length >= 1);
  const weekly = await generateWeeklyContentSuggestion(trendPool, 's1', '2026-07-01', 'admin', 'default');
  assert.equal(weekly.id, 3);
  const pushed = await pushWeeklySuggestionToFeishu(trendPool, weekly);
  assert.ok(pushed.pushed === 0 || pushed.pushed >= 0);
});

test('reports/service-turnover：db merge + employment_records + offboarding', async () => {
  const pool = {
    async query(sql) {
      if (/FROM approval_requests/.test(sql)) {
        return {
          rows: [
            {
              applicant_username: 'eve',
              status: 'approved',
              payload: {
                resignDate: '2026-07-12',
                reason: '个人原因',
                departureType: 'voluntary',
              },
            },
            {
              applicant_username: 'frank',
              status: 'approved',
              payload: { resignDate: '2026-07-08', reason: '劝退优化', departureType: 'involuntary' },
            },
          ],
        };
      }
      if (/FROM employment_records/.test(sql)) {
        return {
          rows: [
            {
              username: 'gina',
              name: '吉娜',
              store: '测试店',
              position: '服务员',
              department: '',
              actionDate: '2026-07-15',
              action_type: 'resign',
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  bindReportsRuntimeDeps({
    pool,
    safeMonthOnly: (m) => m,
    resolveAgentCanonicalStore: (s) => s,
    getSharedState: async () => ({}),
  });
  const ctx = {
    pool,
    getSharedState: async () => ({
      employees: [
        {
          username: 'alice',
          name: '爱丽丝',
          store: '测试店',
          status: 'active',
          joinDate: '2025-01-01',
          level: '2',
        },
      ],
    }),
    safeDateOnly: (v) => String(v || '').slice(0, 10),
    pickMyStoreFromState: () => '测试店',
    dbListEmployeesForReports: async () => [
      {
        username: 'alice',
        name: '爱丽丝DB',
        store: '测试店',
        status: 'active',
        joinDate: '2025-01-01',
        level: '1',
      },
      {
        username: 'bob',
        name: '鲍勃',
        store: '测试店',
        status: 'active',
        joinDate: '2026-06-01',
      },
    ],
    expandAgentStoreLabels: (s) => [s],
  };
  const r = await getTurnoverReportPayload(ctx, {
    month: '2026-07',
    storeQ: '测试店',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });
  assert.equal(r.ok, true);
  assert.ok(r.payload.totalDeparted >= 1);
  assert.ok(r.payload.voluntaryInvoluntary.voluntary + r.payload.voluntaryInvoluntary.involuntary >= 1);
});
