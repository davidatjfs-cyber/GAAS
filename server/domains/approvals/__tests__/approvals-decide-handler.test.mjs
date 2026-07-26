/**
 * L1：handleApprovalDecide 入口失败路径 + 简单通过终审。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApprovalDecide } from '../decide-handler.js';

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

test('decide: 多级同意推进下一审批人 + 飞书通知 next', async () => {
  const lark = [];
  const { deps } = baseDeps({
    poolQuery: async (sql, params) => {
      if (/^select /i.test(sql.trim())) {
        return {
          rows: [{
            id: 'a4',
            type: 'leave',
            status: 'pending',
            applicant_username: 'emp1',
            current_assignee_username: 'mgr1',
            chain: [
              { assignee: 'mgr1', status: 'pending' },
              { assignee: 'hq1', status: 'queued' },
            ],
            payload: { leaveType: '事假', startDate: '2026-08-01', endDate: '2026-08-01' },
            effective_date: null,
          }],
        };
      }
      if (/^update approval_requests/i.test(sql.trim())) {
        return {
          rows: [{
            id: 'a4',
            type: 'leave',
            status: 'pending',
            applicant_username: 'emp1',
            current_assignee_username: params?.[2] || 'hq1',
            chain: [
              { assignee: 'mgr1', status: 'approved' },
              { assignee: 'hq1', status: 'pending' },
            ],
            payload: {},
          }],
        };
      }
      return { rows: [] };
    },
    depsExtra: {
      lookupFeishuUserByUsername: async (u) => (u === 'hq1' ? { open_id: 'ou_hq1' } : null),
      sendLarkMessage: async (openId, msg) => {
        lark.push({ openId, msg });
        return { ok: true };
      },
    },
  });
  const res = mockRes();
  await handleApprovalDecide(
    {
      user: { username: 'mgr1', role: 'store_manager' },
      params: { id: 'a4' },
      body: { approved: true },
    },
    res,
    deps
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.status, 'pending');
  assert.equal(res.body.item.current_assignee_username, 'hq1');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(lark.some((x) => x.openId === 'ou_hq1' && /待审批提醒/.test(x.msg)));
});

test('decide: 拒绝 → rejected + 飞书通知申请人', async () => {
  const lark = [];
  const { deps } = baseDeps({
    poolQuery: async (sql) => {
      if (/^select /i.test(sql.trim())) {
        return {
          rows: [{
            id: 'a5',
            type: 'leave',
            status: 'pending',
            applicant_username: 'emp1',
            current_assignee_username: 'mgr1',
            chain: [{ assignee: 'mgr1', status: 'pending' }],
            payload: {},
          }],
        };
      }
      if (/^update approval_requests/i.test(sql.trim())) {
        return {
          rows: [{
            id: 'a5',
            type: 'leave',
            status: 'rejected',
            applicant_username: 'emp1',
            current_assignee_username: null,
            chain: [{ assignee: 'mgr1', status: 'rejected' }],
            payload: {},
          }],
        };
      }
      return { rows: [] };
    },
    depsExtra: {
      lookupFeishuUserByUsername: async (u) => (u === 'emp1' ? { open_id: 'ou_emp' } : null),
      sendLarkMessage: async (openId, msg) => {
        lark.push({ openId, msg });
        return { ok: true };
      },
    },
  });
  const res = mockRes();
  await handleApprovalDecide(
    {
      user: { username: 'mgr1', role: 'store_manager' },
      params: { id: 'a5' },
      body: { approved: false, note: '材料不全' },
    },
    res,
    deps
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.status, 'rejected');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(lark.some((x) => x.openId === 'ou_emp' && /被拒绝/.test(x.msg) && /材料不全/.test(x.msg)));
});

test('decide: beforeUpdate abort — missing_mentor / missing_promoted_salary', async () => {
  const { deps: mentorDeps, queries: mentorQueries } = baseDeps({
    poolQuery: async (sql) => {
      if (/^select /i.test(sql.trim())) {
        return {
          rows: [{
            id: 'p-abort-1',
            type: 'promotion',
            status: 'pending',
            applicant_username: 'emp1',
            current_assignee_username: 'mgr1',
            chain: [{ assignee: 'mgr1', status: 'pending' }],
            payload: { promotionStage: 'qualification', reason: '升' },
          }],
        };
      }
      return { rows: [] };
    },
    depsExtra: {
      normalizePromotionTrainingPeriods: () => [],
    },
  });
  const resMentor = mockRes();
  await handleApprovalDecide(
    {
      user: { username: 'mgr1', role: 'store_manager' },
      params: { id: 'p-abort-1' },
      body: { approved: true },
    },
    resMentor,
    mentorDeps
  );
  assert.equal(resMentor.statusCode, 400);
  assert.equal(resMentor.body.error, 'missing_mentor');
  assert.equal(
    mentorQueries.filter((q) => /^update approval_requests/i.test(q.sql.trim())).length,
    0
  );

  const { deps: salaryDeps, queries: salaryQueries } = baseDeps({
    poolQuery: async (sql) => {
      if (/^select /i.test(sql.trim())) {
        return {
          rows: [{
            id: 'p-abort-2',
            type: 'promotion',
            status: 'pending',
            applicant_username: 'emp1',
            current_assignee_username: 'mgr1',
            chain: [{ assignee: 'mgr1', status: 'pending' }],
            payload: { promotionStage: 'formal', reason: '正式', promotionTrackId: 't1' },
          }],
        };
      }
      return { rows: [] };
    },
    depsExtra: {
      normalizePromotionTrainingPeriods: () => [],
    },
  });
  const resSalary = mockRes();
  await handleApprovalDecide(
    {
      user: { username: 'mgr1', role: 'store_manager' },
      params: { id: 'p-abort-2' },
      body: { approved: true },
    },
    resSalary,
    salaryDeps
  );
  assert.equal(resSalary.statusCode, 400);
  assert.equal(resSalary.body.error, 'missing_promoted_salary');
  assert.equal(
    salaryQueries.filter((q) => /^update approval_requests/i.test(q.sql.trim())).length,
    0
  );
});

test('decide: offboarding 终审写 effectiveDate；pool 抛错 → 500', async () => {
  const { deps } = baseDeps({
    poolQuery: async (sql, params) => {
      if (/^select /i.test(sql.trim())) {
        return {
          rows: [{
            id: 'a6',
            type: 'offboarding',
            status: 'pending',
            applicant_username: 'emp2',
            current_assignee_username: 'mgr1',
            chain: [{ assignee: 'mgr1', status: 'pending' }],
            payload: { resignDate: '2026-08-15' },
            effective_date: null,
          }],
        };
      }
      if (/^update approval_requests/i.test(sql.trim())) {
        assert.equal(params[4], '2026-08-15'); // effective_date
        return {
          rows: [{
            id: 'a6',
            type: 'offboarding',
            status: 'approved',
            applicant_username: 'emp2',
            current_assignee_username: null,
            chain: [{ assignee: 'mgr1', status: 'approved' }],
            payload: { resignDate: '2026-08-15', departureType: 'voluntary' },
            effective_date: '2026-08-15',
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
      params: { id: 'a6' },
      body: { approved: true, departureType: 'voluntary' },
    },
    res,
    deps
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.item.status, 'approved');

  const { deps: badDeps } = baseDeps({
    poolQuery: async () => {
      throw new Error('db_boom');
    },
  });
  const res500 = mockRes();
  await handleApprovalDecide(
    { user: { username: 'mgr1', role: 'admin' }, params: { id: 'x' }, body: { approved: true } },
    res500,
    badDeps
  );
  assert.equal(res500.statusCode, 500);
  assert.equal(res500.body.error, 'server_error');
});
