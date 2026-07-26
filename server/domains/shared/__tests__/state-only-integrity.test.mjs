/**
 * state-only 三域（payment-config / stores / remaining-state）形状日检。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_ONLY_MIRROR_DOMAINS,
  checkPaymentConfigIntegrity,
  checkStoresIntegrity,
  checkRemainingStateIntegrity,
  checkStateOnlyDomainsIntegrityAllTenants,
} from '../state-only-integrity.js';
import { createMirrorReconcileScheduler } from '../mirror-reconcile-scheduler.js';

test('STATE_ONLY_MIRROR_DOMAINS lists the three no-table-SoT domains', () => {
  assert.deepEqual([...STATE_ONLY_MIRROR_DOMAINS], [
    'payment-config',
    'stores',
    'remaining-state',
  ]);
});

test('checkPaymentConfigIntegrity: empty / missing ok', () => {
  assert.equal(checkPaymentConfigIntegrity(null).ok, true);
  assert.equal(checkPaymentConfigIntegrity({}).ok, true);
  assert.equal(
    checkPaymentConfigIntegrity({
      paymentSettings: { categories: ['房租'], urgencies: ['高'] },
      paymentBudgets: [{ store: 'A', month: '2026-07', category: '房租', amount: 1 }],
    }).ok,
    true
  );
});

test('checkPaymentConfigIntegrity: bad shapes fail', () => {
  assert.equal(checkPaymentConfigIntegrity({ paymentSettings: 'x' }).ok, false);
  assert.equal(checkPaymentConfigIntegrity({ paymentBudgets: {} }).ok, false);
});

test('checkStoresIntegrity: array with id ok; non-array fails', () => {
  assert.equal(checkStoresIntegrity({ stores: [{ id: 's1', name: '店' }] }).ok, true);
  assert.equal(checkStoresIntegrity({ stores: 'nope' }).ok, false);
  assert.equal(checkStoresIntegrity({ stores: [{}] }).ok, false);
});

test('checkRemainingStateIntegrity: array fields + users', () => {
  assert.equal(
    checkRemainingStateIntegrity({
      users: [{ username: 'alice', role: 'admin' }],
      announcements: [],
      questionBank: [],
    }).ok,
    true
  );
  assert.equal(checkRemainingStateIntegrity({ users: 'x' }).ok, false);
  assert.equal(checkRemainingStateIntegrity({ users: [{ name: 'no-username' }] }).ok, false);
});

test('checkStateOnlyDomainsIntegrityAllTenants walks tenants', async () => {
  const seen = [];
  const pool = {
    async query(sql, params) {
      if (/hrms_state/i.test(String(sql))) {
        seen.push(params?.[0]);
        return { rows: [{ data: { stores: [{ id: 'a' }], users: [] } }] };
      }
      return { rows: [] };
    },
  };
  const reports = await checkStateOnlyDomainsIntegrityAllTenants(pool, async () => ['t1', 't2']);
  assert.equal(reports.length, 2);
  assert.deepEqual(seen, ['t1', 't2']);
  assert.equal(reports.every((r) => r.ok), true);
});

test('createMirrorReconcileScheduler accepts state-only checker', () => {
  let called = false;
  const { startMirrorReconcileScheduler } = createMirrorReconcileScheduler({
    pool: {},
    getActiveTenantIds: async () => [],
    notifyAdminsDualWriteFailure: () => {},
    reconcileEmployeesMirrorAllTenants: async () => [],
    reconcileFlowConfigMirrorAllTenants: async () => [],
    checkStateOnlyDomainsIntegrityAllTenants: async () => {
      called = true;
      return [];
    },
  });
  assert.equal(typeof startMirrorReconcileScheduler, 'function');
  assert.equal(called, false);
});
