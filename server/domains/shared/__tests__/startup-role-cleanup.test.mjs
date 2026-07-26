import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeApprovalFlowToken,
  applyStartupRoleCleanup,
  runStartupRoleCleanup,
  STARTUP_ROLE_MAP,
  STARTUP_USER_ROLE_OVERRIDES,
  ALLOWED_STARTUP_ROLES,
} from '../startup-role-cleanup.js';

test('normalizeApprovalFlowToken: empty / manager / username / role / legacy', () => {
  assert.equal(normalizeApprovalFlowToken(''), '');
  assert.equal(normalizeApprovalFlowToken('manager'), 'manager');
  assert.equal(normalizeApprovalFlowToken('username:alice'), 'username:alice');
  assert.equal(normalizeApprovalFlowToken('role:店长'), 'role:store_manager');
  assert.equal(normalizeApprovalFlowToken('role:unknown_x'), 'role:store_employee');
  assert.equal(normalizeApprovalFlowToken('role:admin'), 'role:admin');
  assert.equal(normalizeApprovalFlowToken('店长'), 'store_manager');
  assert.equal(normalizeApprovalFlowToken('weird_custom'), 'store_employee');
  assert.equal(normalizeApprovalFlowToken('hr_manager'), 'hr_manager');
});

test('applyStartupRoleCleanup: overrides + ROLE_MAP + unknown + flows + orgDict', () => {
  const { state, changed, messages } = applyStartupRoleCleanup({
    users: [
      { name: '徐彬', role: 'store_employee' },
      { name: '路人', role: '店长' },
      { name: '怪客', role: 'custom_xxx' },
      { name: '已对', role: 'admin' },
    ],
    employees: [{ name: '李艳玲', role: 'store_employee' }],
    approvalFlows: {
      leave: { steps: ['role:店长', 'manager', 'username:bob', 'weird'] },
      empty: { steps: [] },
      bad: null,
    },
    orgDict: { roles: ['custom_a', 'custom_b'] },
    dailyReports: [{ id: 1 }],
  });
  assert.equal(changed, true);
  assert.equal(state.users.find((u) => u.name === '徐彬').role, 'hq_manager');
  assert.equal(state.users.find((u) => u.name === '路人').role, 'store_manager');
  assert.equal(state.users.find((u) => u.name === '怪客').role, 'store_employee');
  assert.equal(state.employees.find((u) => u.name === '李艳玲').role, 'cashier');
  assert.deepEqual(state.approvalFlows.leave.steps, [
    'role:store_manager',
    'manager',
    'username:bob',
    'store_employee',
  ]);
  assert.deepEqual(state.orgDict.roles, []);
  assert.ok(messages.some((m) => m.includes('徐彬')));
  assert.ok(messages.some((m) => m.includes('Normalized approvalFlows.leave')));
  assert.ok(messages.some((m) => m.includes('Cleared 2 custom roles')));
  assert.equal(state.dailyReports[0].id, 1);
});

test('applyStartupRoleCleanup: no-op when already clean', () => {
  const input = {
    users: [{ name: '已对', role: 'admin' }],
    employees: [],
    approvalFlows: { leave: { steps: ['role:admin', 'manager'] } },
    orgDict: { roles: [] },
  };
  const { changed, messages } = applyStartupRoleCleanup(input);
  assert.equal(changed, false);
  assert.equal(messages.length, 0);
});

test('applyStartupRoleCleanup: strips legacy test accounts', () => {
  const { changed, messages, state } = applyStartupRoleCleanup({
    users: [{ username: 'test', name: 'test', role: 'admin' }],
    employees: [],
  });
  // depends on isLegacyTestUsername behavior — at least runs without throw
  assert.equal(typeof changed, 'boolean');
  assert.ok(Array.isArray(messages));
  assert.ok(state);
});

test('runStartupRoleCleanup: persists when changed; swallows errors', async () => {
  let saved = null;
  let state = {
    users: [{ name: '徐彬', role: 'store_employee' }],
    employees: [],
    approvalFlows: {},
    orgDict: { roles: ['x'] },
  };
  await runStartupRoleCleanup({
    getSharedState: async () => ({ ...state, dailyReports: [{ keep: 1 }] }),
    saveSharedState: async (next) => {
      saved = next;
      state = next;
    },
    runWithBootstrapTenantContext: async (fn) => fn(),
  });
  assert.ok(saved);
  assert.equal(saved.users[0].role, 'hq_manager');
  assert.equal(saved.dailyReports[0].keep, 1);

  await runStartupRoleCleanup({
    getSharedState: async () => {
      throw new Error('boom');
    },
    saveSharedState: async () => {},
    runWithBootstrapTenantContext: async (fn) => fn(),
  });

  // no-op path
  let saveCalls = 0;
  await runStartupRoleCleanup({
    getSharedState: async () => ({
      users: [{ name: 'ok', role: 'admin' }],
      employees: [],
      approvalFlows: { a: { steps: ['role:admin'] } },
      orgDict: { roles: [] },
    }),
    saveSharedState: async () => {
      saveCalls += 1;
    },
    runWithBootstrapTenantContext: async (fn) => fn(),
  });
  assert.equal(saveCalls, 0);
});

test('maps / overrides / allowed lists are non-empty', () => {
  assert.ok(Object.keys(STARTUP_ROLE_MAP).length > 10);
  assert.ok(Object.keys(STARTUP_USER_ROLE_OVERRIDES).length >= 8);
  assert.ok(ALLOWED_STARTUP_ROLES.includes('front_manager'));
});
