/**
 * routes-lifecycle-bind.js — 路由早退分支（不 mock service，仅测 bind 层门禁）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindApprovalCreateRoute,
  bindRepairOnboardingRoute,
  bindApprovalReturnRoute,
  bindApprovalResubmitRoute,
} from '../routes-lifecycle-bind.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

function captureApp() {
  const routes = new Map();
  return {
    app: {
      post(path, ...handlers) {
        routes.set(`POST ${path}`, handlers);
      },
    },
    routes,
  };
}

async function invoke(handlers, req, res) {
  for (let i = 0; i < handlers.length; i++) {
    let advanced = false;
    await new Promise((resolve, reject) => {
      const next = (err) => {
        advanced = true;
        if (err) {
          res.status(500).json({ error: String(err?.message || err) });
        }
        resolve();
      };
      Promise.resolve(handlers[i](req, res, next)).then(() => {
        if (res.headersSent || advanced) resolve();
      }, reject);
    });
    if (res.headersSent) break;
  }
}

const authRequired = (_req, _res, next) => next();

function baseCreateDeps() {
  return {
    pool: { query: async () => ({ rows: [] }) },
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    stateFindUserRecord: () => null,
    stateOrDbFindUserRecord: async () => null,
    pickAdminUsername: () => 'admin',
    pickHqManagerUsername: () => 'hq',
    pickCashierUsername: () => 'cashier',
    pickHrManagerUsername: () => 'hr',
    approvalTypeLabel: (t) => t,
    safeDateOnly: (d) => String(d || '').slice(0, 10),
    safeNumber: (n) => (Number.isFinite(Number(n)) ? Number(n) : null),
    uniqUsernames: (a) => [...new Set(a)],
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({ ok: true }),
    getPaymentFlowForStore: () => ({}),
    pickStoreRoleUsernameByStore: () => '',
    isKitchenByRoleOrPosition: () => false,
    resolveDutyApproverForStore: () => '',
    appendNotifications: async () => {},
    makeNotif: () => ({}),
    hrmsNowISO: () => '2026-07-26T12:00:00+08:00',
    normalizeApprovalType: (t) => String(t || '').trim().toLowerCase(),
    normalizeRoleForJwt: (r) => String(r || '').trim().toLowerCase(),
  };
}

function registerCreate() {
  const { app, routes } = captureApp();
  bindApprovalCreateRoute(app, authRequired, baseCreateDeps());
  return routes;
}

test('bindApprovalCreateRoute: 无审批中心权限 → 403', async () => {
  const routes = registerCreate();
  const res = mockRes();
  await invoke(routes.get('POST /api/approvals'), {
    user: { username: 'emp1', role: 'store_employee' },
    body: { type: 'payment', payload: {} },
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('bindApprovalCreateRoute: self-service leave 允许 store_employee', async () => {
  const routes = registerCreate();
  const res = mockRes();
  await invoke(routes.get('POST /api/approvals'), {
    user: { username: 'emp1', role: 'store_employee' },
    body: { type: 'leave', payload: { startDate: '2026-08-01' } },
    tenantId: 'default',
  }, res);
  assert.notEqual(res.statusCode, 403);
});

test('bindApprovalCreateRoute: offboarding store_employee 不能代他人提交', async () => {
  const routes = registerCreate();
  const res = mockRes();
  await invoke(routes.get('POST /api/approvals'), {
    user: { username: 'emp1', role: 'store_employee' },
    body: { type: 'offboarding', payload: { applicantUsername: 'other' } },
  }, res);
  assert.equal(res.statusCode, 403);
});

test('bindApprovalCreateRoute: missing_user / invalid_type', async () => {
  const routes = registerCreate();

  const res1 = mockRes();
  await invoke(routes.get('POST /api/approvals'), {
    user: { username: '', role: 'admin' },
    body: { type: 'leave', payload: {} },
  }, res1);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.error, 'missing_user');

  const res2 = mockRes();
  await invoke(routes.get('POST /api/approvals'), {
    user: { username: 'admin', role: 'admin' },
    body: { type: '', payload: {} },
  }, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error, 'invalid_type');
});

test('bindRepairOnboardingRoute: 非 admin/hr/hq → 403；missing_id → 400', async () => {
  const { app, routes } = captureApp();
  bindRepairOnboardingRoute(app, authRequired, {
    pool: { query: async () => ({ rows: [] }) },
    getSharedState: async () => ({}),
    mergeSharedStateFields: async () => {},
    buildOnboardingEmployeeRecordFromPayload: () => ({}),
  });

  const res403 = mockRes();
  await invoke(routes.get('POST /api/admin/repair-onboarding-employee/:id'), {
    user: { role: 'store_manager' },
    params: { id: 'x' },
  }, res403);
  assert.equal(res403.statusCode, 403);

  const res400 = mockRes();
  await invoke(routes.get('POST /api/admin/repair-onboarding-employee/:id'), {
    user: { role: 'admin' },
    params: { id: '' },
  }, res400);
  assert.equal(res400.statusCode, 400);
  assert.equal(res400.body.error, 'missing_id');
});

test('bindApprovalReturnRoute: missing_user / missing_id', async () => {
  const { app, routes } = captureApp();
  bindApprovalReturnRoute(app, authRequired, {
    pool: { query: async () => ({ rows: [] }) },
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    stateFindUserRecord: () => null,
    addStateNotification: async () => {},
    makeNotif: () => ({}),
    approvalTypeLabel: (t) => t,
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({}),
    hrmsNowISO: () => '2026-07-26T12:00:00+08:00',
  });

  const res1 = mockRes();
  await invoke(routes.get('POST /api/approvals/:id/return'), {
    user: { username: '' },
    params: { id: 'a1' },
    body: {},
  }, res1);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.error, 'missing_user');

  const res2 = mockRes();
  await invoke(routes.get('POST /api/approvals/:id/return'), {
    user: { username: 'mgr1' },
    params: { id: '' },
    body: { note: 'x' },
  }, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error, 'missing_id');
});

test('bindApprovalResubmitRoute: missing_user / missing_id', async () => {
  const { app, routes } = captureApp();
  bindApprovalResubmitRoute(app, authRequired, {
    pool: { query: async () => ({ rows: [] }) },
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    stateFindUserRecord: () => null,
    addStateNotification: async () => {},
    makeNotif: () => ({}),
    approvalTypeLabel: (t) => t,
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => ({}),
    hrmsNowISO: () => '2026-07-26T12:00:00+08:00',
    safeNumber: (n) => Number(n),
  });

  const res1 = mockRes();
  await invoke(routes.get('POST /api/approvals/:id/resubmit'), {
    user: { username: '' },
    params: { id: 'a1' },
    body: {},
  }, res1);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.error, 'missing_user');

  const res2 = mockRes();
  await invoke(routes.get('POST /api/approvals/:id/resubmit'), {
    user: { username: 'u1' },
    params: { id: '' },
    body: {},
  }, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error, 'missing_id');
});
