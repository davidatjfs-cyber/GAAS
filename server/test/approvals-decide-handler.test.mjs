/**
 * L1：handleApprovalDecide 入口失败路径 + 简单通过终审。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApprovalDecide } from '../domains/approvals/decide-handler.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function baseDeps(overrides = {}) {
  const queries = [];
  return {
    queries,
    deps: {
      pool: {
        query: async (sql, params) => {
          queries.push({ sql: String(sql), params });
          if (typeof overrides.poolQuery === 'function') {
            return overrides.poolQuery(String(sql), params, queries.length);
          }
          return { rows: [] };
        },
      },
      hrmsNowISO: () => '2026-07-25T12:00:00+08:00',
      getSharedState: async () => ({}),
      stateFindUserRecord: (_s, u) => ({ username: u, name: u }),
      safeErrMessage: (e) => String(e?.message || e),
      approvalTypeLabel: (t) => t || '审批',
      lookupFeishuUserByUsername: async () => null,
      sendLarkMessage: async () => ({ ok: true }),
      // handlers may need these if afterDecide runs
      makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
      appendNotifications: async () => {},
      mergeSharedStateFields: async () => {},
      uniqUsernames: (a) => [...new Set(a)],
      safeDateOnly: (d) => String(d || '').slice(0, 10),
      safeNumber: (n) => {
        const x = Number(n);
        return Number.isFinite(x) ? x : null;
      },
      safeBizMonth: (s) => String(s || '').slice(0, 7) || '2026-07',
      randomUUID: () => '00000000-0000-4000-8000-000000000099',
      upsertPayrollLedgerEntry: async () => {},
      resolveAttendancePayrollRules: async () => ({ rules: {} }),
      notifyAdminsDualWriteFailure: () => {},
      shanghaiTodayDateOnly: () => '2026-07-25',
      calcDateSpanDaysInclusive: () => 1,
      ...overrides.depsExtra,
    },
  };
}

test('decide: front_manager → 403 forbidden（无审批中心权限）', async () => {
  const { deps } = baseDeps();
  const res = mockRes();
  await handleApprovalDecide(
    { user: { username: 'fm', role: 'front_manager' }, params: { id: 'x' }, body: { approved: true } },
    res,
    deps
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('decide: missing_user / missing_id', async () => {
  const { deps } = baseDeps();
  const res1 = mockRes();
  await handleApprovalDecide(
    { user: { username: '', role: 'admin' }, params: { id: 'a1' }, body: {} },
    res1,
    deps
  );
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.error, 'missing_user');

  const res2 = mockRes();
  await handleApprovalDecide(
    { user: { username: 'admin', role: 'admin' }, params: { id: '' }, body: {} },
    res2,
    deps
  );
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error, 'missing_id');
});

test('decide: not_found', async () => {
  const { deps } = baseDeps({
    poolQuery: async () => ({ rows: [] }),
  });
  const res = mockRes();
  await handleApprovalDecide(
    { user: { username: 'admin', role: 'admin' }, params: { id: 'missing' }, body: { approved: true } },
    res,
    deps
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'not_found');
});

test('decide: not_pending', async () => {
  const { deps } = baseDeps({
    poolQuery: async () => ({
      rows: [{
        id: 'a1',
        type: 'leave',
        status: 'approved',
        applicant_username: 'emp1',
        current_assignee_username: null,
        chain: [],
        payload: {},
      }],
    }),
  });
  const res = mockRes();
  await handleApprovalDecide(
    { user: { username: 'mgr1', role: 'store_manager' }, params: { id: 'a1' }, body: { approved: true } },
    res,
    deps
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'not_pending');
});

test('decide: 非当前 assignee → 403', async () => {
  const { deps } = baseDeps({
    poolQuery: async () => ({
      rows: [{
        id: 'a2',
        type: 'leave',
        status: 'pending',
        applicant_username: 'emp1',
        current_assignee_username: 'other',
        chain: [{ assignee: 'other', status: 'pending' }],
        payload: {},
      }],
    }),
  });
  const res = mockRes();
  await handleApprovalDecide(
    { user: { username: 'mgr1', role: 'store_manager' }, params: { id: 'a2' }, body: { approved: true } },
    res,
    deps
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('decide: 末级同意 → status approved 并 UPDATE', async () => {
  const { deps, queries } = baseDeps({
    poolQuery: async (sql) => {
      if (/^select /i.test(sql.trim())) {
        return {
          rows: [{
            id: 'a3',
            type: 'leave',
            status: 'pending',
            applicant_username: 'emp1',
            current_assignee_username: 'mgr1',
            chain: [{ assignee: 'mgr1', status: 'pending' }],
            payload: { leaveType: '年假', startDate: '2026-08-01', endDate: '2026-08-02' },
            effective_date: null,
            created_at: '2026-07-20T00:00:00Z',
            updated_at: '2026-07-20T00:00:00Z',
          }],
        };
      }
      if (/^update approval_requests/i.test(sql.trim())) {
        return {
          rows: [{
            id: 'a3',
            type: 'leave',
            status: 'approved',
            applicant_username: 'emp1',
            current_assignee_username: null,
            chain: [{ assignee: 'mgr1', status: 'approved' }],
            payload: { leaveType: '年假', startDate: '2026-08-01', endDate: '2026-08-02' },
            effective_date: null,
            created_at: '2026-07-20T00:00:00Z',
            updated_at: '2026-07-25T12:00:00+08:00',
          }],
        };
      }
      return { rows: [] };
    },
  });
  const res = mockRes();
  await handleApprovalDecide(
    {
      user: { username: 'mgr1', role: 'store_manager' },
      params: { id: 'a3' },
      body: { approved: true, remainingLeaveDays: 3 },
      tenantId: 'default',
    },
    res,
    deps
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.status, 'approved');
  assert.ok(queries.some((q) => /^update approval_requests/i.test(q.sql.trim())));
});
