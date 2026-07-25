import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHrmsStateSnapshotIntervalMin,
  isHrmsStateSnapshotDisabled,
  formatSalesRawImportFailureLabel,
  runStartupModuleSchedulers,
} from '../domains/shared/startup-module-schedulers.js';

test('resolveHrmsStateSnapshotIntervalMin clamps', () => {
  assert.equal(resolveHrmsStateSnapshotIntervalMin(undefined), 15);
  assert.equal(resolveHrmsStateSnapshotIntervalMin('3'), 5);
  assert.equal(resolveHrmsStateSnapshotIntervalMin('99999'), 1440);
  assert.equal(resolveHrmsStateSnapshotIntervalMin('30'), 30);
});

test('isHrmsStateSnapshotDisabled', () => {
  assert.equal(isHrmsStateSnapshotDisabled('true'), true);
  assert.equal(isHrmsStateSnapshotDisabled('TRUE'), true);
  assert.equal(isHrmsStateSnapshotDisabled(''), false);
  assert.equal(isHrmsStateSnapshotDisabled('1'), false);
});

test('formatSalesRawImportFailureLabel', () => {
  assert.equal(formatSalesRawImportFailureLabel({ tick: true }), 'sales_raw（定时扫描）');
  assert.equal(formatSalesRawImportFailureLabel({ startup: true }), 'sales_raw（启动后首次扫描）');
  assert.equal(formatSalesRawImportFailureLabel({}), 'sales_raw（目录入库）');
  assert.equal(
    formatSalesRawImportFailureLabel({ dir: 'a'.repeat(200) }),
    `sales_raw（目录入库·${'a'.repeat(120)}）`
  );
});

function makeDeps(overrides = {}) {
  const calls = { schemas: [], starts: [], notifiers: [], alerts: [], timers: [], timeouts: [] };
  const deps = {
    ensureRAGSchema: async () => {
      calls.schemas.push('rag');
    },
    ensureTaskBoardSchema: async () => {
      calls.schemas.push('task');
    },
    ensureHRMSApiSchema: async () => {
      calls.schemas.push('hrms');
    },
    ensureSOPDistributionSchema: async () => {
      calls.schemas.push('sop');
    },
    ensureKitchenExecutionSchema: async () => {
      calls.schemas.push('kitchen');
    },
    ensureRecipeSchema: async () => {
      calls.schemas.push('recipe');
    },
    ensureTrainingSchema: async () => {
      calls.schemas.push('training');
    },
    ensureGrowthSolutionsSchema: async () => {
      calls.schemas.push('growth');
    },
    startTrainingReminderScheduler: () => {
      calls.starts.push('trainingReminder');
    },
    startSolutionSweepScheduler: () => {
      calls.starts.push('solutionSweep');
    },
    setFeishuSyncFailureNotifier: (fn) => {
      calls.notifiers.push(['feishu', fn]);
    },
    setSalesRawFolderImportFailureNotifier: (fn) => {
      calls.notifiers.push(['sales', fn]);
    },
    notifyAdminsDualWriteFailure: (label, err) => {
      calls.alerts.push([label, err?.message || err]);
    },
    startDailyFeishuSync: () => {
      calls.starts.push('feishu');
    },
    startWeeklyReportScheduler: () => {
      calls.starts.push('weekly');
    },
    startHrmsPerformanceJobs: (opts) => {
      calls.starts.push(['perf', !!opts?.onHeartbeat]);
    },
    startSalesRawFolderImporter: () => {
      calls.starts.push('salesRaw');
    },
    beatHeartbeat: async () => {},
    runForActiveTenants: async (fn, _opts) => {
      await fn('default');
      return { results: ['default'], errors: [] };
    },
    captureHrmsStateSnapshotToDb: async () => ({ ok: true }),
    safeErrMessage: (e) => String(e?.message || e),
    env: { HRMS_STATE_SNAPSHOT_INTERVAL_MINUTES: '20' },
    setIntervalFn: (fn, ms) => {
      calls.timers.push({ fn, ms });
      return 1;
    },
    setTimeoutFn: (fn, ms) => {
      calls.timeouts.push({ fn, ms });
      return 1;
    },
    importAutonomous: async () => ({
      initializeAutonomousTasks: () => {
        calls.starts.push('autonomous');
      },
    }),
    importRegression: async () => ({
      initializeRegressionProtection: async () => {
        calls.starts.push('regression');
      },
    }),
    importLlmConfig: async () => ({
      initializeEnhancedLLMConfig: () => {
        calls.starts.push('llm');
      },
    }),
    ...overrides,
  };
  return { deps, calls };
}

test('runStartupModuleSchedulers: happy path wires schemas + schedulers + snapshot', async () => {
  const { deps, calls } = makeDeps();
  const { snapIntervalMin, runHrmsStateSnapshot } = await runStartupModuleSchedulers(deps);
  assert.equal(snapIntervalMin, 20);
  assert.ok(calls.schemas.includes('rag'));
  assert.ok(calls.schemas.includes('growth'));
  assert.ok(calls.starts.includes('autonomous'));
  assert.ok(calls.starts.includes('feishu'));
  assert.ok(calls.starts.some((s) => Array.isArray(s) && s[0] === 'perf' && s[1] === true));
  assert.equal(calls.timeouts[0].ms, 120_000);
  assert.equal(calls.timers[0].ms, 20 * 60 * 1000);

  const feishuFn = calls.notifiers.find((n) => n[0] === 'feishu')[1];
  feishuFn('tbl', new Error('x'));
  assert.ok(calls.alerts.some((a) => String(a[0]).includes('飞书表格→PG')));

  const salesFn = calls.notifiers.find((n) => n[0] === 'sales')[1];
  salesFn(new Error('y'), { tick: true });
  assert.ok(calls.alerts.some((a) => String(a[0]).includes('定时扫描')));

  await runHrmsStateSnapshot();
});

test('runStartupModuleSchedulers: optional inits fail soft; snapshot disabled', async () => {
  const { deps, calls } = makeDeps({
    env: { HRMS_STATE_SNAPSHOT_DISABLED: 'true' },
    importAutonomous: async () => {
      throw new Error('no_auto');
    },
    importRegression: async () => {
      throw new Error('no_reg');
    },
    importLlmConfig: async () => {
      throw new Error('no_llm');
    },
  });
  const r = await runStartupModuleSchedulers(deps);
  assert.equal(calls.timers.length, 0);
  assert.equal(calls.timeouts.length, 0);
  assert.ok(calls.schemas.includes('rag'));
  assert.equal(typeof r.runHrmsStateSnapshot, 'function');
});

test('runStartupModuleSchedulers: snapshot onError + outer catch', async () => {
  const { deps, calls } = makeDeps({
    env: { HRMS_STATE_SNAPSHOT_INTERVAL_MINUTES: '10' },
    runForActiveTenants: async (_fn, opts) => {
      opts?.onError?.({ tenantId: 't1', error: new Error('snap') });
      return Promise.reject(new Error('outer'));
    },
  });
  const { runHrmsStateSnapshot } = await runStartupModuleSchedulers(deps);
  await runHrmsStateSnapshot();
  assert.ok(calls.alerts.some((a) => String(a[0]).includes('租户=t1')));
  assert.ok(calls.alerts.some((a) => String(a[0]) === 'hrms_state 定时快照（hrms_state_snapshots）'));
});
