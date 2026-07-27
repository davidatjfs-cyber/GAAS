import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityChecksApi } from '../quality-checks.js';

async function fakeSafeExecute(_context, fn) {
  return fn();
}

function baseDeps(overrides = {}) {
  return {
    refreshBiAgentRuntimeConfig: async () => {},
    safeExecute: fakeSafeExecute,
    safeErrorLog: () => {},
    isBiSourceEnabled: () => true,
    getSharedState: async () => ({ dailyReports: new Array(150).fill({}) }),
    AgentCommunicationHelper: {
      reportDataSourceIssue: async () => {},
      reportTaskExecutionIssue: async () => {},
    },
    bitableConfigs: {
      ops_checklist: { name: '运营检查表' },
      bad_reviews: { name: '差评报告' },
    },
    pool: () => ({ query: async () => ({ rows: [{ count: '10' }] }) }),
    log: { error: () => {} },
    ...overrides,
  };
}

test('createQualityChecksApi returns the expected function surface', () => {
  const api = createQualityChecksApi(baseDeps());
  assert.equal(typeof api.checkDataSourceQuality, 'function');
  assert.equal(typeof api.checkTaskExecutionQuality, 'function');
  assert.equal(typeof api.getLastSyncTime, 'function');
  assert.equal(typeof api.getRecentAuditCount, 'function');
});

test('getLastSyncTime returns a timestamp within the last 5 minutes', async () => {
  const api = createQualityChecksApi(baseDeps());
  const before = Date.now();
  const t = await api.getLastSyncTime('ops_checklist');
  assert.ok(t <= before);
  assert.ok(t >= before - 5 * 60 * 1000 - 1000);
});

test('checkDataSourceQuality: healthy state reports no issues', async () => {
  const api = createQualityChecksApi(baseDeps());
  const issues = await api.checkDataSourceQuality();
  assert.deepEqual(issues, []);
});

test('checkDataSourceQuality: disabled bitable source is skipped', async () => {
  const calls = [];
  const api = createQualityChecksApi(
    baseDeps({
      isBiSourceEnabled: (key) => key !== 'ops_checklist_bitable',
      AgentCommunicationHelper: {
        reportDataSourceIssue: async (...args) => { calls.push(args); },
        reportTaskExecutionIssue: async () => {},
      },
    })
  );
  const issues = await api.checkDataSourceQuality();
  assert.deepEqual(issues, []);
  assert.equal(calls.length, 0);
});

test('checkDataSourceQuality: low daily_reports count reports a completeness issue', async () => {
  const calls = [];
  const api = createQualityChecksApi(
    baseDeps({
      getSharedState: async () => ({ dailyReports: [{}] }),
      AgentCommunicationHelper: {
        reportDataSourceIssue: async (...args) => { calls.push(args); },
        reportTaskExecutionIssue: async () => {},
      },
    })
  );
  const issues = await api.checkDataSourceQuality();
  assert.deepEqual(issues, ['daily_reports']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'daily_reports');
});

test('checkDataSourceQuality: bitable sync error is logged, not thrown', async () => {
  const errors = [];
  const api = createQualityChecksApi(
    baseDeps({
      bitableConfigs: null,
      safeErrorLog: (context, error) => { errors.push({ context, error }); },
    })
  );
  const issues = await api.checkDataSourceQuality();
  assert.deepEqual(issues, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context, 'data_auditor_bitable_sync');
});

test('checkDataSourceQuality: completeness check error is logged, not thrown', async () => {
  const errors = [];
  const api = createQualityChecksApi(
    baseDeps({
      getSharedState: async () => { throw new Error('db down'); },
      safeErrorLog: (context, error) => { errors.push({ context, error }); },
    })
  );
  const issues = await api.checkDataSourceQuality();
  assert.deepEqual(issues, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].context, 'data_auditor_completeness');
});

test('getRecentAuditCount returns the count from the query result', async () => {
  const api = createQualityChecksApi(
    baseDeps({ pool: () => ({ query: async () => ({ rows: [{ count: '7' }] }) }) })
  );
  const count = await api.getRecentAuditCount('洪潮店', 7);
  assert.equal(count, 7);
});

test('getRecentAuditCount returns 0 and logs on query failure', async () => {
  const errors = [];
  const api = createQualityChecksApi(
    baseDeps({
      pool: () => ({ query: async () => { throw new Error('boom'); } }),
      log: { error: (...args) => errors.push(args) },
    })
  );
  const count = await api.getRecentAuditCount('洪潮店', 7);
  assert.equal(count, 0);
  assert.equal(errors.length, 1);
});

test('checkTaskExecutionQuality: reports both failure-rate and duplicate-rate issues when thresholds exceeded', async () => {
  const calls = [];
  const api = createQualityChecksApi(
    baseDeps({
      pool: () => ({ query: async () => ({ rows: [{ count: '10' }] }) }),
      AgentCommunicationHelper: {
        reportDataSourceIssue: async () => {},
        reportTaskExecutionIssue: async (...args) => { calls.push(args); },
      },
    })
  );
  await api.checkTaskExecutionQuality('洪潮店', 'hongchao', 3, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], '图片审核');
  assert.match(calls[0][1], /失败率过高/);
  assert.match(calls[1][1], /重复图片率过高/);
});

test('checkTaskExecutionQuality: no reports when within thresholds', async () => {
  const calls = [];
  const api = createQualityChecksApi(
    baseDeps({
      pool: () => ({ query: async () => ({ rows: [{ count: '100' }] }) }),
      AgentCommunicationHelper: {
        reportDataSourceIssue: async () => {},
        reportTaskExecutionIssue: async (...args) => { calls.push(args); },
      },
    })
  );
  await api.checkTaskExecutionQuality('洪潮店', 'hongchao', 1, 1);
  assert.equal(calls.length, 0);
});

test('checkTaskExecutionQuality: zero total audits keeps rates at zero (no divide-by-zero reports)', async () => {
  const calls = [];
  const api = createQualityChecksApi(
    baseDeps({
      pool: () => ({ query: async () => ({ rows: [{ count: '0' }] }) }),
      AgentCommunicationHelper: {
        reportDataSourceIssue: async () => {},
        reportTaskExecutionIssue: async (...args) => { calls.push(args); },
      },
    })
  );
  await api.checkTaskExecutionQuality('洪潮店', 'hongchao', 5, 5);
  assert.equal(calls.length, 0);
});
