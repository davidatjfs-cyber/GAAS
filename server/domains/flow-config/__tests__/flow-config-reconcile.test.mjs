/**
 * flow-config 表 vs hrms_state 镜像对账（单元级，mock pool）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stableConfigHash,
  reconcileFlowConfigMirror,
  reconcileFlowConfigMirrorAllTenants,
} from '../reconcile.js';
import { createMirrorReconcileScheduler } from '../../shared/mirror-reconcile-scheduler.js';

/**
 * @param {{
 *   tableConfigs?: Record<string, object>,
 *   mirrorState?: Record<string, unknown>,
 * }} opts
 */
function mockFlowConfigPool({ tableConfigs = {}, mirrorState = {} } = {}) {
  return {
    async query(sql, params) {
      const s = String(sql);
      if (/hr_rating_configs/i.test(s)) {
        const configKey = params?.[0];
        const cfg = tableConfigs[configKey];
        return { rows: cfg ? [{ config: cfg }] : [] };
      }
      if (/hrms_state/i.test(s) && /SELECT/i.test(s)) {
        return { rows: [{ data: mirrorState }] };
      }
      return { rows: [] };
    },
  };
}

test('reconcileFlowConfigMirror: both empty → ok', async () => {
  const pool = mockFlowConfigPool();
  const report = await reconcileFlowConfigMirror(pool, 'default');
  assert.equal(report.ok, true);
  assert.deepEqual(report.drifts, []);
  assert.equal(report.fields.roleModules.ok, true);
  assert.equal(report.fields.approvalFlows.ok, true);
  assert.equal(report.fields.paymentFlowByStore.ok, true);
});

test('reconcileFlowConfigMirror: table has roleModules, mirror empty → only_table', async () => {
  const pool = mockFlowConfigPool({
    tableConfigs: {
      role_module_config: { store_manager: ['employees'] },
    },
    mirrorState: {},
  });
  const report = await reconcileFlowConfigMirror(pool, 'default');
  assert.equal(report.ok, false);
  assert.deepEqual(report.drifts, [{ field: 'roleModules', reason: 'only_table' }]);
  assert.equal(report.fields.roleModules.tablePresent, true);
  assert.equal(report.fields.roleModules.mirrorPresent, false);
  assert.equal(report.fields.roleModules.reason, 'only_table');
});

test('reconcileFlowConfigMirror: matching hashes after normalize → ok', async () => {
  const pool = mockFlowConfigPool({
    tableConfigs: {
      role_module_config: { store_manager: ['employees', 'attendance'] },
      approval_flows: { leave: ['manager', 'admin'] },
    },
    mirrorState: {
      roleModules: { store_manager: ['employees', 'attendance'] },
      approvalFlows: { leave: { steps: ['manager', 'admin'] } },
    },
  });
  const report = await reconcileFlowConfigMirror(pool, 'default');
  assert.equal(report.ok, true);
  assert.deepEqual(report.drifts, []);
  assert.equal(report.fields.roleModules.ok, true);
  assert.equal(report.fields.approvalFlows.ok, true);
});

test('reconcileFlowConfigMirror: content mismatch → content_hash_mismatch', async () => {
  const pool = mockFlowConfigPool({
    tableConfigs: {
      payment_flow_by_store: { 洪潮: { approvers: ['alice'] } },
    },
    mirrorState: {
      paymentFlowByStore: { 洪潮: { approvers: ['bob'] } },
    },
  });
  const report = await reconcileFlowConfigMirror(pool, 'default');
  assert.equal(report.ok, false);
  assert.deepEqual(report.drifts, [{ field: 'paymentFlowByStore', reason: 'content_hash_mismatch' }]);
  assert.equal(report.fields.paymentFlowByStore.reason, 'content_hash_mismatch');
});

test('reconcileFlowConfigMirrorAllTenants calls both tenants', async () => {
  const seen = [];
  const pool = {
    async query(sql, params) {
      const s = String(sql);
      if (/hr_rating_configs/i.test(s)) return { rows: [] };
      if (/hrms_state/i.test(s) && /SELECT/i.test(s)) {
        seen.push(params?.[0]);
        return { rows: [{ data: {} }] };
      }
      return { rows: [] };
    },
  };
  const reports = await reconcileFlowConfigMirrorAllTenants(pool, async () => ['default', 'tenant-b']);
  assert.equal(reports.length, 2);
  assert.deepEqual(seen, ['default', 'tenant-b']);
  assert.equal(reports[0].tenantId, 'default');
  assert.equal(reports[1].tenantId, 'tenant-b');
});

test('stableConfigHash sorts keys recursively', () => {
  const a = stableConfigHash({ z: 1, a: { y: 2, b: 3 } });
  const b = stableConfigHash({ a: { b: 3, y: 2 }, z: 1 });
  assert.equal(a, b);
});

test('createMirrorReconcileScheduler exports startMirrorReconcileScheduler', () => {
  const { startMirrorReconcileScheduler } = createMirrorReconcileScheduler({
    pool: {},
    getActiveTenantIds: async () => [],
    notifyAdminsDualWriteFailure: () => {},
    reconcileEmployeesMirrorAllTenants: async () => [],
    reconcileFlowConfigMirrorAllTenants: async () => [],
  });
  assert.equal(typeof startMirrorReconcileScheduler, 'function');
});
