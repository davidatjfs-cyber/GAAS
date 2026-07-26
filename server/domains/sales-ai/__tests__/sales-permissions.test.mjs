import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isManager,
  leadScopeSql,
  canAccessLead,
  canAccessTask,
  canAccessRepMetrics,
  canAccessTenant,
} from '../../../services/sales/sales-permissions.js';

test('isManager / leadScopeSql：角色矩阵', () => {
  assert.equal(isManager({ role: 'super_admin' }), true);
  assert.equal(isManager({ role: 'sales_manager' }), true);
  assert.equal(isManager({ role: 'sales' }), false);
  assert.equal(isManager({ role: 'unknown_role' }), false);

  assert.deepEqual(leadScopeSql({ role: 'sales_manager' }, 2), { clause: 'TRUE', params: [] });
  assert.deepEqual(leadScopeSql({ role: 'sales', username: 'u1' }, 3), {
    clause: '(owner_username = $3 OR assigned_to = $3)',
    params: ['u1'],
  });
  assert.deepEqual(leadScopeSql({ role: 'customer_service', username: 'cs1' }, 1), {
    clause: 'cs_owner_username = $1',
    params: ['cs1'],
  });
  assert.deepEqual(leadScopeSql({ role: 'nobody' }, 1), { clause: 'FALSE', params: [] });
});

test('canAccessLead / Task / RepMetrics', () => {
  assert.equal(canAccessLead({ role: 'sales_manager' }, { owner_username: 'x' }), true);
  assert.equal(canAccessLead({ role: 'sales' }, null), false);
  assert.equal(
    canAccessLead({ role: 'sales', username: 'u1' }, { owner_username: 'u1', assigned_to: 'y' }),
    true
  );
  assert.equal(
    canAccessLead({ role: 'sales', username: 'u1' }, { owner_username: 'a', assigned_to: 'u1' }),
    true
  );
  assert.equal(
    canAccessLead({ role: 'sales', username: 'u1' }, { owner_username: 'a', assigned_to: 'b' }),
    false
  );
  assert.equal(
    canAccessLead({ role: 'implementation', username: 'cs1' }, { cs_owner_username: 'cs1' }),
    true
  );
  assert.equal(
    canAccessLead({ role: 'implementation', username: 'cs1' }, { cs_owner_username: 'other' }),
    false
  );

  assert.equal(canAccessTask({ role: 'sales_manager' }, { assignee: 'x' }), true);
  assert.equal(canAccessTask({ role: 'sales', username: 'u1' }, { assignee: 'u1' }), true);
  assert.equal(canAccessTask({ role: 'sales', username: 'u1' }, { assignee: 'u2' }), false);
  assert.equal(canAccessTask({ role: 'sales' }, null), false);

  assert.equal(canAccessRepMetrics({ role: 'sales_manager' }, 'anyone'), true);
  assert.equal(canAccessRepMetrics({ role: 'sales', username: 'u1' }, 'u1'), true);
  assert.equal(canAccessRepMetrics({ role: 'sales', username: 'u1' }, 'u2'), false);
});

test('canAccessTenant：manager / 关联线索 / 无线索拒绝', async () => {
  assert.equal(
    await canAccessTenant({ query: async () => ({ rows: [] }) }, { role: 'sales_manager' }, 't1'),
    true
  );
  assert.equal(
    await canAccessTenant({ query: async () => ({ rows: [] }) }, { role: 'sales', username: 'u1' }, 't1'),
    false
  );
  assert.equal(
    await canAccessTenant(
      {
        query: async () => ({
          rows: [{ owner_username: 'u1', assigned_to: null, cs_owner_username: null }],
        }),
      },
      { role: 'sales', username: 'u1' },
      't1'
    ),
    true
  );
  assert.equal(
    await canAccessTenant(
      {
        query: async () => ({
          rows: [{ owner_username: null, assigned_to: null, cs_owner_username: 'cs1' }],
        }),
      },
      { role: 'customer_service', username: 'cs1' },
      't1'
    ),
    true
  );
});
