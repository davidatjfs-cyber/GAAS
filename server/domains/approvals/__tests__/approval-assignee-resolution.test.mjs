import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStoreApprovalRoleUsername,
  buildConfiguredApprovalAssignees,
} from '../../../approval-assignee-resolution.js';

const state = {
  employees: [
    { username: 'mgrStore', role: 'store_manager', store: '洪潮', status: 'active' },
    { username: 'prodMgr', role: 'store_production_manager', store: '洪潮', status: 'active' },
    { username: 'hr1', role: 'hr_manager', store: '', status: 'active' },
    { username: 'gone', role: 'hq_manager', store: '洪潮', status: '离职' },
  ],
  users: [
    { username: 'hq1', role: 'hq_manager', status: 'active' },
  ],
  approvalFlows: {
    leave: {
      stores: ['洪潮'],
      steps: ['manager', 'hq_manager', 'store_manager', 'username:fixedUser', 'role:hr_manager', 'admin'],
    },
    payment: {
      stores: ['马己仙'],
      steps: ['cashier'],
    },
    open: {
      steps: ['role:store_manager', 'store_production_manager', 'hr_manager'],
    },
  },
};

test('resolveStoreApprovalRoleUsername：duty 优先，否则按门店角色', async () => {
  assert.equal(await resolveStoreApprovalRoleUsername(state, '', ['store_manager']), '');
  assert.equal(
    await resolveStoreApprovalRoleUsername(state, '洪潮', ['store_manager'], async () => 'dutyUser'),
    'dutyUser'
  );
  assert.equal(
    await resolveStoreApprovalRoleUsername(state, '洪潮', ['store_manager'], async () => ''),
    'mgrStore'
  );
  assert.equal(
    await resolveStoreApprovalRoleUsername(state, '洪潮', ['store_production_manager']),
    'prodMgr'
  );
});

test('buildConfiguredApprovalAssignees：token 解析 + 去重 + 门店不匹配', async () => {
  const ctx = {
    state,
    applicantStore: '洪潮',
    managerUsername: 'lineMgr',
    hqManagerUsername: 'hqBoss',
    hrManagerUsername: 'hrBoss',
    adminUsername: 'root',
    cashierUsername: 'cash1',
  };
  const list = await buildConfiguredApprovalAssignees(state, 'leave', ctx, async () => 'dutyMgr');
  assert.deepEqual(list, ['lineMgr', 'hqBoss', 'dutyMgr', 'fixedUser', 'hr1', 'root']);

  // 门店不在 flow.stores → 空
  assert.deepEqual(
    await buildConfiguredApprovalAssignees(state, 'leave', { ...ctx, applicantStore: '马己仙' }, async () => ''),
    []
  );

  // payment 匹配马己仙 → cashier
  assert.deepEqual(
    await buildConfiguredApprovalAssignees(
      state,
      'payment',
      { ...ctx, applicantStore: '马己仙' },
      async () => ''
    ),
    ['cash1']
  );

  // open：无 stores 限制；role:store_manager + production + findUserByRole(hr)
  const openList = await buildConfiguredApprovalAssignees(
    state,
    'open',
    { ...ctx, applicantStore: '洪潮' },
    async () => 'duty2'
  );
  assert.ok(openList.includes('duty2'));
  assert.ok(openList.includes('prodMgr'));
  assert.ok(openList.includes('hrBoss') || openList.includes('hr1'));

  // 未知 step token → findUserByRole(raw)
  const customState = {
    ...state,
    approvalFlows: {
      custom: { steps: ['hr_manager', 'unknown_role_x'] },
    },
    employees: [
      ...state.employees,
      { username: 'unk1', role: 'unknown_role_x', status: 'active' },
    ],
  };
  const custom = await buildConfiguredApprovalAssignees(
    customState,
    'custom',
    { ...ctx, state: customState, applicantStore: '' },
    async () => ''
  );
  assert.ok(custom.includes('hrBoss'));
  assert.ok(custom.includes('unk1'));
});
