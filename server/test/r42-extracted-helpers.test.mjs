/**
 * R42：薄 routes（wecom/branding/tracks/announcement-extra/coupons）+
 * growth-stored-value/service 冲高至 ≥80% 挂 extracted 地板。
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerWecomCallbackRoutes } from '../domains/wecom/routes-callback.js';
import { registerTenantPlatformBrandingRoutes } from '../domains/tenant-platform/routes-branding.js';
import { registerPromotionTracksRoutes } from '../domains/promotion/routes-tracks.js';
import { registerAnnouncementExtraRoutes } from '../domains/remaining-state/routes-announcement-extra.js';
import { registerGrowthCouponRoutes } from '../domains/growth-coupons/routes.js';
import {
  syncStoredValueMembers,
  listStoredValueTargets,
  previewCampaign,
  launchCampaign,
  sendCampaignSms,
  previewRemind,
  launchRemind,
  campaignFunnel,
} from '../domains/growth-stored-value/service.js';

async function withApp(register, fn) {
  const app = express();
  app.use(express.json());
  register(app);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authAs(user) {
  return (req, _res, next) => {
    req.user = user;
    req.tenantId = 'default';
    next();
  };
}

function passthroughTenantContext() {
  return { run: async (_tid, fn) => fn() };
}

function baseCtx(overrides = {}) {
  return {
    pool: { async query() { return { rows: [] }; } },
    sendAliyunSms: async () => ({ provider_msg_id: 'm1', raw: {} }),
    tenantContext: passthroughTenantContext(),
    resolveTenantIdDefault: () => 'default',
    resolveTenantIdForStore: async () => 'default',
    CAMPAIGN_TYPES: {
      VIP: { coupon_count: 1, vars: ['value', 'date', 'code'] },
      PLAIN: { coupon_count: 0, vars: ['value', 'date'] },
    },
    freqDaysEnv: (_k, d) => d,
    globalSmsCapped: async () => null,
    isPhoneSuppressed: async () => false,
    handleSmsFailure: async () => {},
    upsertCustomer: async () => ({ id: 1 }),
    upsertDeliveryLog: async () => {},
    insertGrowthEvent: async () => {},
    pickCampaignTemplate: () => 'SMS_TPL',
    pickCampaignSmsSign: () => 'SIGN',
    formatSmsValidDate: () => '2026-08-01',
    pickBalanceTemplateByStore: () => 'SMS_BAL',
    buildCampaignTargetQuery: () => ({ sql: 'SELECT 1', params: [] }),
    buildRemindTargetsQuery: () => ({ sql: 'SELECT 1', params: [] }),
    mapStoreNameToId: (n) => (n === '洪潮' ? 'hongchao' : 's1'),
    bitText: (v) => String(v == null ? '' : v),
    bitNum: (v) => Number(v) || 0,
    bitDateMs: (v) => (v ? Number(v) : 0),
    bitPhone: (v) => String(v || '').replace(/[^0-9]/g, ''),
    readStoredValueBitableRecords: async () => [],
    ABC_ROTATION_ORDER: {},
    ABC_STEP_DEFS: { A: { vars: ['value', 'date', 'code'] } },
    deriveAbcStep: () => ({ step: 'A', blacklisted: false, freqDaysOverride: null }),
    pickAbcTemplate: () => 'SMS_ABC',
    countCampaignSent: async () => 0,
    campaignTouchCapped: async () => false,
    marketingFatigueCapped: async () => false,
    ...overrides,
  };
}

// —— wecom/routes-callback ——
test('wecom callback: plaintext / ok / post / signature paths', async () => {
  const prev = {
    token: process.env.WECOM_CALLBACK_TOKEN,
    aes: process.env.WECOM_CALLBACK_AES_KEY,
  };
  delete process.env.WECOM_CALLBACK_TOKEN;
  delete process.env.WECOM_CALLBACK_AES_KEY;
  try {
    await withApp(
      (app) => registerWecomCallbackRoutes(app),
      async (base) => {
        const plain = await fetch(`${base}/api/wecom/callback?echostr=hello`);
        assert.equal(plain.status, 200);
        assert.equal(await plain.text(), 'hello');

        const ok = await fetch(`${base}/api/wecom/callback`);
        assert.equal(ok.status, 200);
        assert.equal(await ok.text(), 'ok');

        const post = await fetch(`${base}/api/wecom/callback`, { method: 'POST', body: '' });
        assert.equal(post.status, 200);
        assert.equal(await post.text(), '');
      }
    );
  } finally {
    if (prev.token === undefined) delete process.env.WECOM_CALLBACK_TOKEN;
    else process.env.WECOM_CALLBACK_TOKEN = prev.token;
    if (prev.aes === undefined) delete process.env.WECOM_CALLBACK_AES_KEY;
    else process.env.WECOM_CALLBACK_AES_KEY = prev.aes;
  }

  process.env.WECOM_CALLBACK_TOKEN = 'tok';
  process.env.WECOM_CALLBACK_AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  try {
    await withApp(
      (app) => registerWecomCallbackRoutes(app),
      async (base) => {
        const badSig = await fetch(
          `${base}/api/wecom/callback?msg_signature=bad&timestamp=1&nonce=n&echostr=enc`
        );
        assert.equal(badSig.status, 401);

        const arr = ['tok', '1', 'n', 'enc'].sort();
        const sig = createHash('sha1').update(arr.join('')).digest('hex');
        const decryptFail = await fetch(
          `${base}/api/wecom/callback?msg_signature=${sig}&timestamp=1&nonce=n&echostr=enc`
        );
        assert.equal(decryptFail.status, 400);
      }
    );
  } finally {
    if (prev.token === undefined) delete process.env.WECOM_CALLBACK_TOKEN;
    else process.env.WECOM_CALLBACK_TOKEN = prev.token;
    if (prev.aes === undefined) delete process.env.WECOM_CALLBACK_AES_KEY;
    else process.env.WECOM_CALLBACK_AES_KEY = prev.aes;
  }
});

// —— tenant-platform/routes-branding ——
test('tenant branding: logo upload + public get', async () => {
  const upload = {
    single: () => (req, _res, next) => {
      if (req.headers['x-has-file'] === '1') {
        req.file = { filename: 'logo.png' };
      }
      next();
    },
  };
  let owned = null;
  await withApp(
    (app) =>
      registerTenantPlatformBrandingRoutes(app, {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('FROM tenants')) {
              return { rows: [{ name: '门店A' }] };
            }
            if (String(sql).includes('platform_profile')) {
              return {
                rows: [{
                  config_value: {
                    system_name: '系统A',
                    logo_url: '/uploads/a.png',
                    favicon_url: '/f.ico',
                    brand_color: '#123456',
                  },
                }],
              };
            }
            return { rows: [] };
          },
        },
        platformAdminRequired: (req, _res, next) => {
          req.platformAdmin = { username: 'admin' };
          next();
        },
        upload,
        recordUploadOwnership: async (filename, tenantId, user) => {
          owned = { filename, tenantId, user };
        },
      }),
    async (base) => {
      const miss = await fetch(`${base}/api/admin/tenants/t1/logo`, { method: 'POST' });
      assert.equal(miss.status, 400);
      assert.equal((await miss.json()).error, 'missing_file');

      const ok = await fetch(`${base}/api/admin/tenants/t1/logo`, {
        method: 'POST',
        headers: { 'x-has-file': '1' },
      });
      assert.equal(ok.status, 200);
      const oj = await ok.json();
      assert.equal(oj.ok, true);
      assert.equal(oj.url, '/uploads/logo.png');
      assert.equal(owned.tenantId, 't1');

      const brand = await fetch(`${base}/api/tenant/branding?tenant_id=t1`);
      assert.equal(brand.status, 200);
      const bj = await brand.json();
      assert.equal(bj.ok, true);
      assert.equal(bj.system_name, '系统A');
      assert.equal(bj.brand_color, '#123456');
    }
  );

  await withApp(
    (app) =>
      registerTenantPlatformBrandingRoutes(app, {
        pool: {
          query: async () => {
            throw new Error('db down');
          },
        },
        platformAdminRequired: (_req, _res, next) => next(),
        upload: { single: () => (_req, _res, next) => next() },
        recordUploadOwnership: async () => {
          throw new Error('own fail');
        },
      }),
    async (base) => {
      const brand = await fetch(`${base}/api/tenant/branding`);
      assert.equal(brand.status, 200);
      const bj = await brand.json();
      assert.equal(bj.ok, false);
      assert.ok(bj.system_name);

      const logoErr = await fetch(`${base}/api/admin/tenants/t1/logo`, {
        method: 'POST',
        headers: { 'x-has-file': '1' },
      });
      // no file because upload mock doesn't set it in this app — missing_file
      assert.equal(logoErr.status, 400);
    }
  );

  // logo ownership error path
  await withApp(
    (app) =>
      registerTenantPlatformBrandingRoutes(app, {
        pool: { query: async () => ({ rows: [] }) },
        platformAdminRequired: (req, _res, next) => {
          req.platformAdmin = { username: 'a' };
          next();
        },
        upload: {
          single: () => (req, _res, next) => {
            req.file = { filename: 'x.png' };
            next();
          },
        },
        recordUploadOwnership: async () => {
          throw new Error('own fail');
        },
      }),
    async (base) => {
      const r = await fetch(`${base}/api/admin/tenants/t1/logo`, { method: 'POST' });
      assert.equal(r.status, 500);
    }
  );
});

// —— promotion/routes-tracks ——
test('promotion tracks: admin / filter / missing / error', async () => {
  const tracks = [
    {
      id: '1',
      applicantUsername: 'u1',
      mentorUsername: 'm1',
      store: '洪潮',
      updatedAt: '2026-02-01',
      requiredTopicIds: ['t1'],
    },
    {
      id: '2',
      applicantUsername: 'other',
      mentorUsername: 'm2',
      store: '马己仙',
      updatedAt: '2026-01-01',
    },
  ];

  await withApp(
    (app) =>
      registerPromotionTracksRoutes(app, authAs({ username: 'admin', role: 'admin' }), {
        getSharedState: async () => ({ promotionTracks: tracks }),
        stateFindUserRecord: () => ({ store: '洪潮', role: 'admin' }),
        getPromotionTrackProgress: async () => ({ passed: true, done: 1, total: 1 }),
      }),
    async (base) => {
      const r = await fetch(`${base}/api/promotion/tracks`);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.items.length, 2);
      assert.equal(j.items[0].assessmentStatus, 'passed');
    }
  );

  await withApp(
    (app) =>
      registerPromotionTracksRoutes(
        app,
        authAs({ username: 'u1', role: 'store_employee' }),
        {
          getSharedState: async () => ({ promotionTracks: tracks }),
          stateFindUserRecord: () => ({ store: '洪潮', role: 'store_employee' }),
          getPromotionTrackProgress: async () => ({ passed: false, done: 0, total: 1 }),
        }
      ),
    async (base) => {
      const r = await fetch(`${base}/api/promotion/tracks`);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.items.length, 1);
      assert.equal(j.items[0].id, '1');
      assert.equal(j.items[0].assessmentStatus, 'pending');
    }
  );

  await withApp(
    (app) =>
      registerPromotionTracksRoutes(app, authAs({ username: '', role: 'admin' }), {
        getSharedState: async () => ({}),
        stateFindUserRecord: () => null,
        getPromotionTrackProgress: async () => ({ passed: false }),
      }),
    async (base) => {
      const r = await fetch(`${base}/api/promotion/tracks`);
      assert.equal(r.status, 400);
    }
  );

  await withApp(
    (app) =>
      registerPromotionTracksRoutes(
        app,
        authAs({ username: 'sm', role: 'store_manager' }),
        {
          getSharedState: async () => ({
            promotionTracks: [
              { id: 'x', store: '洪潮', applicantUsername: 'a', mentorUsername: 'b' },
            ],
          }),
          stateFindUserRecord: () => ({ store: '洪潮', role: 'store_manager' }),
          getPromotionTrackProgress: async () => ({ passed: false }),
        }
      ),
    async (base) => {
      const r = await fetch(`${base}/api/promotion/tracks`);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).items.length, 1);
    }
  );

  await withApp(
    (app) =>
      registerPromotionTracksRoutes(app, authAs({ username: 'admin', role: 'admin' }), {
        getSharedState: async () => {
          throw new Error('boom');
        },
        stateFindUserRecord: () => null,
        getPromotionTrackProgress: async () => ({}),
      }),
    async (base) => {
      const r = await fetch(`${base}/api/promotion/tracks`);
      assert.equal(r.status, 500);
    }
  );
});

// —— remaining-state/routes-announcement-extra ——
test('announcement extra: ack + receipts scopes', async () => {
  let state = {
    announcements: [
      { id: 'a1', title: 't', readBy: {}, scope: { type: 'all' } },
      { id: 'a2', title: 'hq', readBy: { admin: '2026-01-01' }, scope: { type: 'hq' } },
      { id: 'a3', title: 'st', readBy: {}, scope: { type: 'store', store: '洪潮' } },
    ],
    employees: [
      { username: 'admin', name: 'Admin', store: '总部' },
      { username: 'e1', name: 'E1', store: '洪潮' },
      { username: 'e2', name: 'E2', store: '马己仙' },
    ],
  };
  const merges = [];

  await withApp(
    (app) =>
      registerAnnouncementExtraRoutes(app, authAs({ username: 'E1', role: 'store_employee' }), {
        getSharedState: async () => state,
        mergeSharedStateFields: async (patches) => {
          merges.push(patches);
          const ann = patches.announcements[0];
          state = {
            ...state,
            announcements: state.announcements.map((a) => (a.id === ann.id ? ann : a)),
          };
        },
        employeeAccountShouldDisable: () => false,
      }),
    async (base) => {
      const missId = await fetch(`${base}/api/announcements/%20/ack`, { method: 'POST' });
      assert.equal(missId.status, 400);

      const notFound = await fetch(`${base}/api/announcements/nope/ack`, { method: 'POST' });
      assert.equal(notFound.status, 404);

      const ack = await fetch(`${base}/api/announcements/a1/ack`, { method: 'POST' });
      assert.equal(ack.status, 200);
      assert.equal((await ack.json()).ok, true);
      assert.ok(merges.length >= 1);

      // second ack no-op merge
      const ack2 = await fetch(`${base}/api/announcements/a1/ack`, { method: 'POST' });
      assert.equal(ack2.status, 200);
    }
  );

  await withApp(
    (app) =>
      registerAnnouncementExtraRoutes(app, authAs({ username: '', role: 'admin' }), {
        getSharedState: async () => state,
        mergeSharedStateFields: async () => {},
        employeeAccountShouldDisable: () => false,
      }),
    async (base) => {
      const r = await fetch(`${base}/api/announcements/a1/ack`, { method: 'POST' });
      assert.equal(r.status, 400);
    }
  );

  await withApp(
    (app) =>
      registerAnnouncementExtraRoutes(app, authAs({ username: 'admin', role: 'admin' }), {
        getSharedState: async () => state,
        mergeSharedStateFields: async () => {},
        employeeAccountShouldDisable: (e) => e.username === 'e2',
      }),
    async (base) => {
      const forbid = await fetch(`${base}/api/announcements/a1/receipts`);
      // admin allowed
      assert.equal(forbid.status, 200);
      const all = await forbid.json();
      assert.equal(all.ok, true);
      assert.ok(all.total >= 1);

      const hq = await fetch(`${base}/api/announcements/a2/receipts`);
      assert.equal(hq.status, 200);

      const st = await fetch(`${base}/api/announcements/a3/receipts`);
      assert.equal(st.status, 200);
      assert.equal((await st.json()).total, 1);

      const nf = await fetch(`${base}/api/announcements/missing/receipts`);
      assert.equal(nf.status, 404);
    }
  );

  await withApp(
    (app) =>
      registerAnnouncementExtraRoutes(
        app,
        authAs({ username: 'e1', role: 'store_employee' }),
        {
          getSharedState: async () => state,
          mergeSharedStateFields: async () => {},
          employeeAccountShouldDisable: () => false,
        }
      ),
    async (base) => {
      const r = await fetch(`${base}/api/announcements/a1/receipts`);
      assert.equal(r.status, 403);
    }
  );

  await withApp(
    (app) =>
      registerAnnouncementExtraRoutes(app, authAs({ username: 'admin', role: 'admin' }), {
        getSharedState: async () => {
          throw new Error('x');
        },
        mergeSharedStateFields: async () => {},
        employeeAccountShouldDisable: () => false,
      }),
    async (base) => {
      const a = await fetch(`${base}/api/announcements/a1/ack`, { method: 'POST' });
      assert.equal(a.status, 500);
      const r = await fetch(`${base}/api/announcements/a1/receipts`);
      assert.equal(r.status, 500);
    }
  );
});

// —— growth-coupons/routes ——
test('growth-coupons routes: auth + upsert/list + errors', async () => {
  await withApp(
    (app) =>
      registerGrowthCouponRoutes(app, {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('INSERT INTO growth_coupons')) {
              return { rows: [{ coupon_id: 'c1', name: 'N' }] };
            }
            if (String(sql).includes('FROM growth_coupons')) {
              return { rows: [{ coupon_id: 'c1' }] };
            }
            return { rows: [] };
          },
        },
        requirePhaseAuth: () => true,
        getPhaseTenantId: () => 't1',
      }),
    async (base) => {
      const post = await fetch(`${base}/api/growth/coupons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coupon_id: 'c1', name: 'N', stock: 10 }),
      });
      assert.equal(post.status, 200);
      assert.equal((await post.json()).ok, true);

      const get = await fetch(`${base}/api/growth/coupons`);
      assert.equal(get.status, 200);
      assert.equal((await get.json()).coupons.length, 1);
    }
  );

  await withApp(
    (app) =>
      registerGrowthCouponRoutes(app, {
        pool: {
          query: async () => {
            throw new Error('db');
          },
        },
        requirePhaseAuth: () => true,
        getPhaseTenantId: () => 't1',
      }),
    async (base) => {
      const post = await fetch(`${base}/api/growth/coupons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coupon_id: 'c1' }),
      });
      assert.equal(post.status, 500);
      const get = await fetch(`${base}/api/growth/coupons`);
      assert.equal(get.status, 500);
    }
  );

  await withApp(
    (app) =>
      registerGrowthCouponRoutes(app, {
        pool: { query: async () => ({ rows: [] }) },
        requirePhaseAuth: (_req, res) => {
          res.status(401).json({ error: 'unauthorized' });
          return false;
        },
        getPhaseTenantId: () => 't1',
      }),
    async (base) => {
      const post = await fetch(`${base}/api/growth/coupons`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(post.status, 401);
      const get = await fetch(`${base}/api/growth/coupons`);
      assert.equal(get.status, 401);
    }
  );
});

// —— growth-stored-value/service ——
test('stored-value: sync / list / funnel', async () => {
  const sync = await syncStoredValueMembers(
    baseCtx({
      readStoredValueBitableRecords: async () => [
        {
          fields: {
            卡号: 'C1',
            交易时间: 200,
            营业日期: 200,
            交易类型: '充值',
            会员名称: '甲',
            手机号: '13800138000',
            '交易后-储值余额': 50,
            交易门店: '洪潮',
          },
        },
      ],
      pool: {
        async query() {
          return { rows: [], rowCount: 1 };
        },
      },
    }),
    'default'
  );
  assert.equal(sync.status, 200);
  assert.equal(sync.body.ok, true);
  assert.equal(sync.body.upserted, 1);

  const empty = await syncStoredValueMembers(baseCtx(), 'default');
  assert.equal(empty.body.members, 0);

  const listed = await listStoredValueTargets(
    baseCtx({
      pool: {
        async query(_sql, params) {
          assert.equal(params[0], 'hongchao');
          return {
            rows: [{ card_no: 'C1', phone: '138', balance_fen: 100 }],
          };
        },
      },
    }),
    'default',
    { store_id: 'hongchao', dormant_days: 7, min_balance_yuan: 1, limit: 10 }
  );
  assert.equal(listed.body.count, 1);

  const funnel = await campaignFunnel(
    baseCtx({
      pool: {
        async query() {
          return { rows: [{ event_type: 'sent', count: 3 }] };
        },
      },
    }),
    'default',
    'camp-1'
  );
  assert.equal(funnel.body.ok, true);
  assert.equal(funnel.body.counts.length, 1);
});

test('stored-value: preview/launch campaign happy + edges', async () => {
  const needFilter = await previewCampaign(
    baseCtx({ buildCampaignTargetQuery: () => null }),
    'default',
    { campaign_key: 'VIP' }
  );
  assert.equal(needFilter.body.error, 'need_audience_filter');

  const preview = await previewCampaign(
    baseCtx({
      pool: {
        async query() {
          return {
            rows: [
              { phone: '13800138000', name: 'A', visits: 2, days: 10, sendable: true },
              { phone: '13900139000', name: 'B', visits: 1, days: 20, sendable: false },
            ],
          };
        },
      },
    }),
    'default',
    { campaign_key: 'VIP', store_id: 's1', min_visits: 1 }
  );
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.sendable_count, 1);
  assert.equal(preview.body.sample[0].phone, '138****8000');

  const noTpl = await launchCampaign(
    baseCtx({ pickCampaignTemplate: () => '' }),
    'default',
    { campaign_key: 'VIP', store_id: 's1', value_yuan: 10 }
  );
  assert.equal(noTpl.status, 503);

  const emptyTargets = await launchCampaign(
    baseCtx({
      pool: {
        async query() {
          return { rows: [{ phone: '1', sendable: false }] };
        },
      },
    }),
    'default',
    { campaign_key: 'VIP', store_id: 's1', value_yuan: 10 }
  );
  assert.equal(emptyTargets.body.ok, true);
  assert.equal(emptyTargets.body.target_count, 0);

  const launched = await launchCampaign(
    baseCtx({
      pool: {
        async query(sql) {
          if (String(sql).includes('INSERT INTO growth_campaign_jobs')) {
            return { rows: [{ id: 99 }] };
          }
          return { rows: [{ phone: '13800138000', name: 'A', sendable: true }] };
        },
      },
    }),
    'default',
    { campaign_key: 'VIP', store_id: 's1', value_yuan: 20, operator: 'op' }
  );
  assert.equal(launched.body.job_id, 99);
  assert.equal(launched.body.target_count, 1);

  const launchNeedQ = await launchCampaign(
    baseCtx({ buildCampaignTargetQuery: () => null }),
    'default',
    { campaign_key: 'VIP', store_id: 's1', value_yuan: 10 }
  );
  assert.equal(launchNeedQ.body.error, 'need_audience_filter');
});

test('stored-value: sendCampaignSms branches', async () => {
  assert.equal(
    (await sendCampaignSms(baseCtx(), {
      campaign_key: 'VIP',
      phone: '13800138000',
      store_id: 's1',
      value_yuan: 10,
    })).body.error,
    'missing_coupon_code'
  );

  assert.equal(
    (await sendCampaignSms(baseCtx(), {
      campaign_key: 'PLAIN',
      phone: '13800138000',
      store_id: 's1',
      value_yuan: 0,
    })).body.error,
    'missing_value'
  );

  assert.equal(
    (
      await sendCampaignSms(baseCtx({ pickCampaignTemplate: () => '' }), {
        campaign_key: 'PLAIN',
        phone: '13800138000',
        store_id: 's1',
        value_yuan: 10,
      })
    ).status,
    503
  );

  assert.equal(
    (
      await sendCampaignSms(baseCtx({ globalSmsCapped: async () => 7 }), {
        campaign_key: 'PLAIN',
        phone: '13800138000',
        store_id: 's1',
        value_yuan: 10,
      })
    ).body.reason,
    'global_frequency_capped'
  );

  assert.equal(
    (
      await sendCampaignSms(baseCtx({ isPhoneSuppressed: async () => true }), {
        campaign_key: 'PLAIN',
        phone: '13800138000',
        store_id: 's1',
        value_yuan: 10,
      })
    ).body.reason,
    'suppressed'
  );

  assert.equal(
    (
      await sendCampaignSms(baseCtx({ marketingFatigueCapped: async () => true }), {
        campaign_key: 'PLAIN',
        phone: '13800138000',
        store_id: 's1',
        value_yuan: 10,
      })
    ).body.reason,
    'marketing_fatigue'
  );

  assert.equal(
    (
      await sendCampaignSms(baseCtx({ campaignTouchCapped: async () => true }), {
        campaign_key: 'PLAIN',
        phone: '13800138000',
        store_id: 's1',
        value_yuan: 10,
      })
    ).body.reason,
    'touch_capped'
  );

  const sent = await sendCampaignSms(baseCtx(), {
    campaign_key: 'VIP',
    phone: '13800138000',
    store_id: 's1',
    coupon_code: 'CODE1',
    value_yuan: 15,
    campaign_id: 'c1',
  });
  assert.equal(sent.body.ok, true);
  assert.equal(sent.body.provider_msg_id, 'm1');

  const failed = await sendCampaignSms(
    baseCtx({
      sendAliyunSms: async () => {
        throw new Error('sms_down');
      },
    }),
    {
      campaign_key: 'VIP',
      phone: '13800138000',
      store_id: 's1',
      coupon_code: 'CODE2',
      value_yuan: 15,
    }
  );
  assert.equal(failed.status, 502);

  // ABC rotation: blacklisted
  const abcBlack = await sendCampaignSms(
    baseCtx({
      ABC_ROTATION_ORDER: { VIP: ['A', 'B'] },
      deriveAbcStep: () => ({ step: 'A', blacklisted: true, freqDaysOverride: null }),
    }),
    {
      campaign_key: 'VIP',
      phone: '13800138000',
      store_id: 's1',
      coupon_code: 'X',
      value_yuan: 10,
    }
  );
  assert.equal(abcBlack.body.reason, 'abc_blacklisted');

  // ABC happy path with freq override skipping frequency query (freqDays 0)
  const abcOk = await sendCampaignSms(
    baseCtx({
      ABC_ROTATION_ORDER: { VIP: ['A'] },
      deriveAbcStep: () => ({ step: 'A', blacklisted: false, freqDaysOverride: 0 }),
      pickAbcTemplate: () => 'SMS_ABC',
    }),
    {
      campaign_key: 'VIP',
      phone: '13800138000',
      store_id: 's1',
      coupon_code: 'Y',
      value_yuan: 10,
    }
  );
  assert.equal(abcOk.body.ok, true);
});

test('stored-value: remind preview/launch', async () => {
  const prev = await previewRemind(
    baseCtx({
      pool: {
        async query() {
          return { rows: [{ member_name: '甲', balance_fen: 500 }] };
        },
      },
    }),
    'default',
    { store_id: 's1', dormant_days: 14, min_balance_yuan: 1 }
  );
  assert.equal(prev.body.ok, true);
  assert.equal(prev.body.target_count, 1);
  assert.equal(prev.body.sample[0].balance_yuan, 5);

  assert.equal(
    (
      await launchRemind(baseCtx({ pickBalanceTemplateByStore: () => '' }), 'default', {
        store_id: 's1',
      })
    ).status,
    503
  );

  const empty = await launchRemind(
    baseCtx({
      pool: { async query() { return { rows: [] }; } },
    }),
    'default',
    { store_id: 's1' }
  );
  assert.equal(empty.body.target_count, 0);

  const launched = await launchRemind(
    baseCtx({
      pool: {
        async query(sql) {
          if (String(sql).includes('INSERT INTO growth_campaign_jobs')) {
            return { rows: [{ id: 7 }] };
          }
          return {
            rows: [{ phone: '138', member_name: '甲', card_no: 'C1', balance_fen: 200 }],
          };
        },
      },
    }),
    'default',
    { store_id: 's1', campaign_id: 'r1', operator: 'op' }
  );
  assert.equal(launched.body.job_id, 7);
  assert.equal(launched.body.target_count, 1);
});
