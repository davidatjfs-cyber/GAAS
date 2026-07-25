import test from 'node:test';
import assert from 'node:assert/strict';
import {
  repairOnboardingEmployee,
  returnApproval,
  resubmitApproval,
} from '../domains/approvals/service-lifecycle.js';

const NOW = '2026-07-24T12:00:00+08:00';

function makePool(handlers = {}) {
  const queries = [];
  const pool = {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (handlers.query) return handlers.query(sql, params, queries);
      return { rows: [] };
    },
  };
  return pool;
}

function makeLifecycleDeps(overrides = {}) {
  const savedStates = [];
  const notifCalls = [];
  const feishuCalls = [];

  const deps = {
    getSharedState: async () => overrides.state || { employees: [] },
    saveSharedState: async (s) => {
      savedStates.push(s);
    },
    mergeSharedStateFields: async (patch, keys) => {
      overrides.merges = overrides.merges || [];
      overrides.merges.push({ patch, keys });
    },
    stateFindUserRecord: (_s, u) => ({
      username: u,
      name: u === 'applicant1' ? '申请人' : u === 'mgr1' ? '经理甲' : String(u),
      store: '测试店',
    }),
    addStateNotification: (state, notif) => {
      notifCalls.push(notif);
      return { ...state, notifications: [...(state.notifications || []), notif] };
    },
    makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
    approvalTypeLabel: (t) => (t === 'leave' ? '休假' : t === 'onboarding' ? '入职' : String(t)),
    lookupFeishuUserByUsername: async (u) => {
      feishuCalls.push(u);
      return u === 'applicant1' ? { open_id: 'ou_applicant' } : null;
    },
    sendLarkMessage: async (...a) => {
      feishuCalls.push(['send', ...a]);
    },
    hrmsNowISO: () => NOW,
    safeNumber: (n) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : null;
    },
    buildOnboardingEmployeeRecordFromPayload: (emp, _state) => {
      const username = String(emp?.username || '').trim();
      if (!username) return { ok: false, reason: 'missing_employee_username', nextEmp: null };
      return {
        ok: true,
        nextEmp: { username, name: String(emp?.name || username), id: '0001' },
        newUsername: username,
        empName: String(emp?.name || username),
      };
    },
    ...overrides.depsExtra,
  };

  return { deps, savedStates, notifCalls, feishuCalls };
}

test('returnApproval: not_found', async () => {
  const pool = makePool({
    query: async () => ({ rows: [] }),
  });
  const { deps } = makeLifecycleDeps();
  const result = await returnApproval({ pool, ...deps, id: 'x1', username: 'mgr1', note: '' });
  assert.equal(result.error, 'not_found');
  assert.equal(result.status, 404);
});

test('returnApproval: not_pending', async () => {
  const pool = makePool({
    query: async () => ({
      rows: [{
        id: 'a1',
        type: 'leave',
        status: 'approved',
        applicant_username: 'applicant1',
        chain: [{ assignee: 'mgr1', status: 'approved' }],
        payload: {},
      }],
    }),
  });
  const { deps } = makeLifecycleDeps();
  const result = await returnApproval({ pool, ...deps, id: 'a1', username: 'mgr1', note: '' });
  assert.equal(result.error, 'not_pending');
  assert.equal(result.status, 400);
});

test('returnApproval: forbidden when user not pending assignee', async () => {
  const pool = makePool({
    query: async () => ({
      rows: [{
        id: 'a1',
        type: 'leave',
        status: 'pending',
        applicant_username: 'applicant1',
        chain: [
          { step: 1, assignee: 'mgr1', status: 'approved', decidedAt: NOW, note: '' },
          { step: 2, assignee: 'mgr2', status: 'pending', decidedAt: null, note: '' },
        ],
        payload: {},
      }],
    }),
  });
  const { deps } = makeLifecycleDeps();
  const result = await returnApproval({ pool, ...deps, id: 'a1', username: 'mgr1', note: '缺材料' });
  assert.equal(result.error, 'forbidden');
  assert.equal(result.status, 403);
});

test('returnApproval: success updates chain, clears assignee, notifies', async () => {
  let updateArgs = null;
  const pool = makePool({
    query: async (sql, params) => {
      if (sql.includes('select id, type, status')) {
        return {
          rows: [{
            id: 'a1',
            type: 'leave',
            status: 'pending',
            applicant_username: 'applicant1',
            chain: [
              { step: 1, assignee: 'mgr1', status: 'pending', decidedAt: null, note: '' },
              { step: 2, assignee: 'mgr2', status: 'queued', decidedAt: null, note: '' },
            ],
            payload: { startDate: '2026-07-25' },
          }],
        };
      }
      if (sql.includes('update approval_requests')) {
        updateArgs = params;
        const chain = JSON.parse(params[1]);
        const payload = JSON.parse(params[2]);
        return {
          rows: [{
            id: 'a1',
            type: 'leave',
            status: 'returned',
            applicant_username: 'applicant1',
            current_assignee_username: null,
            chain,
            payload,
          }],
        };
      }
      return { rows: [] };
    },
  });
  const { deps, savedStates, notifCalls, feishuCalls } = makeLifecycleDeps();

  const result = await returnApproval({
    pool,
    ...deps,
    id: 'a1',
    username: 'mgr1',
    note: '日期不对',
  });

  assert.equal(result.ok, true);
  assert.equal(result.item.status, 'returned');
  assert.equal(result.item.current_assignee_username, null);

  const chain = JSON.parse(updateArgs[1]);
  assert.equal(chain[0].status, 'returned');
  assert.equal(chain[0].note, '日期不对');
  assert.equal(chain[1].status, 'queued');

  const payload = JSON.parse(updateArgs[2]);
  assert.equal(payload.returnedBy, 'mgr1');
  assert.equal(payload.returnNote, '日期不对');
  assert.equal(payload.returnedAt, NOW);

  assert.equal(savedStates.length, 1);
  assert.equal(notifCalls.length, 1);
  assert.equal(notifCalls[0].u, 'applicant1');
  assert.equal(notifCalls[0].meta.type, 'leave_returned');
  assert.ok(feishuCalls.includes('applicant1'));
});

test('repairOnboardingEmployee: not_onboarding / not_approved', async () => {
  const poolWrongType = makePool({
    query: async () => ({
      rows: [{ id: 'o1', type: 'leave', status: 'approved', payload: {} }],
    }),
  });
  const { deps } = makeLifecycleDeps();
  const r1 = await repairOnboardingEmployee({
    pool: poolWrongType,
    ...deps,
    id: 'o1',
  });
  assert.equal(r1.error, 'not_onboarding');
  assert.equal(r1.status, 400);

  const poolNotApproved = makePool({
    query: async () => ({
      rows: [{ id: 'o2', type: 'onboarding', status: 'pending', payload: {} }],
    }),
  });
  const r2 = await repairOnboardingEmployee({
    pool: poolNotApproved,
    ...deps,
    id: 'o2',
  });
  assert.equal(r2.error, 'not_approved');
  assert.equal(r2.status, 400);
});

test('repairOnboardingEmployee: success merges employee', async () => {
  const merges = [];
  const pool = makePool({
    query: async () => ({
      rows: [{
        id: 'o3',
        type: 'onboarding',
        status: 'approved',
        payload: { employee: { username: 'newhire', name: '新员工' } },
      }],
    }),
  });
  const { deps } = makeLifecycleDeps({
    depsExtra: {
      mergeSharedStateFields: async (patch, keys) => {
        merges.push({ patch, keys });
      },
    },
  });

  const result = await repairOnboardingEmployee({ pool, ...deps, id: 'o3' });
  assert.equal(result.ok, true);
  assert.equal(result.approvalId, 'o3');
  assert.equal(result.username, 'newhire');
  assert.equal(result.name, '新员工');
  assert.equal(merges.length, 1);
  assert.deepEqual(merges[0].keys, { employees: 'username' });
  assert.equal(merges[0].patch.employees[0].username, 'newhire');
});

test('resubmitApproval: forbidden if not applicant', async () => {
  const pool = makePool({
    query: async () => ({
      rows: [{
        id: 'r1',
        type: 'leave',
        status: 'returned',
        applicant_username: 'applicant1',
        chain: [{ assignee: 'mgr1', status: 'returned' }],
        payload: { returnedAt: NOW },
      }],
    }),
  });
  const { deps } = makeLifecycleDeps();
  const result = await resubmitApproval({
    pool,
    ...deps,
    id: 'r1',
    username: 'other_user',
    bodyPayload: {},
  });
  assert.equal(result.error, 'forbidden');
  assert.equal(result.status, 403);
});

test('resubmitApproval: not_returned status', async () => {
  const pool = makePool({
    query: async () => ({
      rows: [{
        id: 'r2',
        type: 'leave',
        status: 'pending',
        applicant_username: 'applicant1',
        chain: [],
        payload: {},
      }],
    }),
  });
  const { deps } = makeLifecycleDeps();
  const result = await resubmitApproval({
    pool,
    ...deps,
    id: 'r2',
    username: 'applicant1',
    bodyPayload: {},
  });
  assert.equal(result.error, 'not_returned');
  assert.equal(result.status, 400);
});

test('resubmitApproval: success resets chain to pending first assignee', async () => {
  let updateArgs = null;
  const pool = makePool({
    query: async (sql, params) => {
      if (sql.includes('select id, type, status')) {
        return {
          rows: [{
            id: 'r3',
            type: 'leave',
            status: 'returned',
            applicant_username: 'applicant1',
            chain: [
              { step: 1, assignee: 'mgr1', status: 'returned', decidedAt: NOW, note: '退回' },
              { step: 2, assignee: 'mgr2', status: 'queued', decidedAt: null, note: '' },
            ],
            payload: {
              startDate: '2026-07-25',
              returnedAt: NOW,
              returnedBy: 'mgr1',
              returnNote: '退回',
            },
          }],
        };
      }
      if (sql.includes('update approval_requests')) {
        updateArgs = params;
        const chain = JSON.parse(params[2]);
        const payload = JSON.parse(params[3]);
        return {
          rows: [{
            id: 'r3',
            type: 'leave',
            status: 'pending',
            applicant_username: 'applicant1',
            current_assignee_username: params[1],
            chain,
            payload,
          }],
        };
      }
      return { rows: [] };
    },
  });
  const { deps, savedStates, notifCalls } = makeLifecycleDeps();

  const result = await resubmitApproval({
    pool,
    ...deps,
    id: 'r3',
    username: 'applicant1',
    bodyPayload: { patch: { endDate: '2026-07-26' } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.item.status, 'pending');
  assert.equal(result.item.current_assignee_username, 'mgr1');

  const chain = JSON.parse(updateArgs[2]);
  assert.equal(chain[0].status, 'pending');
  assert.equal(chain[0].decidedAt, null);
  assert.equal(chain[1].status, 'queued');

  const payload = JSON.parse(updateArgs[3]);
  assert.equal(payload.resubmittedAt, NOW);
  assert.equal(payload.endDate, '2026-07-26');
  assert.equal(payload.returnedAt, undefined);
  assert.equal(payload.returnedBy, undefined);
  assert.equal(payload.returnNote, undefined);

  assert.equal(savedStates.length, 1);
  assert.equal(notifCalls.length, 1);
  assert.equal(notifCalls[0].u, 'mgr1');
  assert.equal(notifCalls[0].meta.type, 'leave_resubmitted');
});

test('resubmitApproval: points 条目校验与成功重提', async () => {
  const baseRow = {
    id: 'pts-r1',
    type: 'points',
    status: 'returned',
    applicant_username: 'applicant1',
    chain: [{ assignee: 'mgr1', status: 'returned' }],
    payload: { ruleId: 'old', reason: '旧' },
  };
  const poolFail = makePool({
    query: async () => ({ rows: [baseRow] }),
  });
  const { deps } = makeLifecycleDeps({
    state: {
      employees: [{ username: 'applicant1', store: '测试店' }],
      pointRules: [{ id: 'r1', itemName: '加分', points: 5, enabled: true, store: '测试店' }],
    },
  });
  assert.equal(
    (await resubmitApproval({
      pool: poolFail,
      ...deps,
      id: 'pts-r1',
      username: 'applicant1',
      bodyPayload: { items: [] },
    })).error,
    'empty_items'
  );
  assert.equal(
    (await resubmitApproval({
      pool: poolFail,
      ...deps,
      id: 'pts-r1',
      username: 'applicant1',
      bodyPayload: { items: [{ ruleId: 'r1', reason: '' }] },
    })).error,
    'missing_reason'
  );

  let updatedPayload = null;
  const poolOk = makePool({
    query: async (sql, params) => {
      if (sql.includes('select id, type, status')) return { rows: [baseRow] };
      if (sql.includes('update approval_requests')) {
        updatedPayload = JSON.parse(params[3]);
        return {
          rows: [{
            ...baseRow,
            status: 'pending',
            current_assignee_username: 'mgr1',
            chain: [{ assignee: 'mgr1', status: 'pending' }],
            payload: updatedPayload,
          }],
        };
      }
      return { rows: [] };
    },
  });
  const ok = await resubmitApproval({
    pool: poolOk,
    ...deps,
    id: 'pts-r1',
    username: 'applicant1',
    bodyPayload: {
      items: [{ ruleId: 'r1', reason: '重提理由' }],
      evidenceUrls: [' https://x/a.jpg ', ''],
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(updatedPayload.totalPoints, 5);
  assert.deepEqual(updatedPayload.evidenceUrls, ['https://x/a.jpg']);
});

test('resubmitApproval: points missing_store / rule_disabled / too_many_items', async () => {
  const baseRow = {
    id: 'pts-r2',
    type: 'points',
    status: 'returned',
    applicant_username: 'applicant1',
    chain: [{ assignee: 'mgr1', status: 'returned' }],
    payload: {},
  };
  const pool = makePool({ query: async () => ({ rows: [baseRow] }) });

  const { deps: noStore } = makeLifecycleDeps({
    state: {
      employees: [{ username: 'applicant1', store: '' }],
      pointRules: [{ id: 'r1', points: 1, enabled: true }],
    },
    depsExtra: {
      stateFindUserRecord: () => ({ username: 'applicant1', store: '' }),
    },
  });
  assert.equal(
    (await resubmitApproval({
      pool,
      ...noStore,
      id: 'pts-r2',
      username: 'applicant1',
      bodyPayload: { items: [{ ruleId: 'r1', reason: 'x' }] },
    })).error,
    'missing_store'
  );

  const { deps: disabled } = makeLifecycleDeps({
    state: {
      employees: [{ username: 'applicant1', store: '测试店' }],
      pointRules: [{ id: 'r1', points: 1, enabled: false, store: '测试店' }],
    },
  });
  assert.equal(
    (await resubmitApproval({
      pool,
      ...disabled,
      id: 'pts-r2',
      username: 'applicant1',
      bodyPayload: { items: [{ ruleId: 'r1', reason: 'x' }] },
    })).error,
    'rule_disabled'
  );

  const many = Array.from({ length: 21 }, (_, i) => ({ ruleId: 'r1', reason: `r${i}` }));
  const { deps: tooMany } = makeLifecycleDeps({
    state: {
      employees: [{ username: 'applicant1', store: '测试店' }],
      pointRules: [{ id: 'r1', points: 1, enabled: true, store: '测试店' }],
    },
  });
  assert.equal(
    (await resubmitApproval({
      pool,
      ...tooMany,
      id: 'pts-r2',
      username: 'applicant1',
      bodyPayload: { items: many },
    })).error,
    'too_many_items'
  );
});

test('repairOnboardingEmployee: not_found / missing username', async () => {
  const empty = makePool({ query: async () => ({ rows: [] }) });
  const { deps } = makeLifecycleDeps();
  assert.equal(
    (await repairOnboardingEmployee({ pool: empty, ...deps, id: 'x' })).error,
    'not_found'
  );

  const badEmp = makePool({
    query: async () => ({
      rows: [{
        id: 'onb-bad',
        type: 'onboarding',
        status: 'approved',
        payload: { employee: {} },
      }],
    }),
  });
  const r = await repairOnboardingEmployee({ pool: badEmp, ...deps, id: 'onb-bad' });
  assert.equal(r.error, 'missing_employee_username');
  assert.equal(r.status, 400);
});

test('resubmitApproval: onboarding 合并 employee；飞书通知', async () => {
  let payloadOut = null;
  const feishu = [];
  const pool = makePool({
    query: async (sql, params) => {
      if (sql.includes('select id, type, status')) {
        return {
          rows: [{
            id: 'onb-r',
            type: 'onboarding',
            status: 'returned',
            applicant_username: 'applicant1',
            chain: [{ assignee: 'mgr1', status: 'returned' }],
            payload: { employee: { username: 'new1', name: '旧名' } },
          }],
        };
      }
      if (sql.includes('update approval_requests')) {
        payloadOut = JSON.parse(params[3]);
        return {
          rows: [{
            id: 'onb-r',
            type: 'onboarding',
            status: 'pending',
            applicant_username: 'applicant1',
            current_assignee_username: 'mgr1',
            chain: [{ assignee: 'mgr1', status: 'pending' }],
            payload: payloadOut,
          }],
        };
      }
      return { rows: [] };
    },
  });
  const { deps } = makeLifecycleDeps({
    depsExtra: {
      lookupFeishuUserByUsername: async (u) => (u === 'mgr1' ? { open_id: 'ou_mgr' } : null),
      sendLarkMessage: async (openId, msg) => {
        feishu.push({ openId, msg });
      },
    },
  });
  const r = await resubmitApproval({
    pool,
    ...deps,
    id: 'onb-r',
    username: 'applicant1',
    bodyPayload: { employee: { name: '新名', joinDate: '2026-08-01' } },
  });
  assert.equal(r.ok, true);
  assert.equal(payloadOut.employee.name, '新名');
  assert.equal(payloadOut.employee.username, 'new1');
  assert.ok(feishu.some((x) => x.openId === 'ou_mgr'));
});
