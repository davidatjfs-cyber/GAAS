import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LISTEN_TIME_MIGRATION_SQL_NAMES,
  isAgentSchedulingDisabled,
  runStartupAgentSchemaBootstrap,
} from '../startup-agent-schema.js';

test('isAgentSchedulingDisabled', () => {
  assert.equal(isAgentSchedulingDisabled('true'), true);
  assert.equal(isAgentSchedulingDisabled('false'), false);
  assert.equal(isAgentSchedulingDisabled(undefined), false);
});

test('LISTEN_TIME_MIGRATION_SQL_NAMES has expected entries', () => {
  assert.ok(LISTEN_TIME_MIGRATION_SQL_NAMES.includes('008_agent_intelligence_upgrade'));
  assert.ok(LISTEN_TIME_MIGRATION_SQL_NAMES.includes('081_unique_constraints_tenant_id_batch9'));
  assert.equal(LISTEN_TIME_MIGRATION_SQL_NAMES.length, 15);
});

function makeDeps(overrides = {}) {
  const calls = { ensure: [], starts: [], hooks: [], sql: [], mig: [] };
  const noop = (name) => async () => {
    calls.ensure.push(name);
  };
  const deps = {
    pool: {
      query: async (sql) => {
        calls.sql.push(String(sql).slice(0, 60));
        return { rows: [], rowCount: 0 };
      },
    },
    runWithBootstrapTenantContext: async (fn) => fn(),
    allowSchemaChanges: true,
    appEnv: 'development',
    env: {},
    ensureTenantRuntimeTables: noop('tenantRuntime'),
    ensureMasterTables: noop('master'),
    ensureUserSessionsTable: noop('sessions'),
    ensureBaselineSchemaHealth: noop('baseline'),
    ensurePayrollRulesTables: noop('payrollRules'),
    seedDefaultBrandPayrollRules: noop('seedPayroll'),
    ensurePermissionTables: noop('perms'),
    ensureGrowthTables: noop('growth'),
    ensureAgentAuditLogTable: noop('agentAudit'),
    ensurePhaseTables: noop('phase'),
    ensureCustomerOpsTables: noop('customerOps'),
    ensureDataGovernanceTables: noop('gov'),
    ensureAgentTables: noop('agentTables'),
    ensureFeishuGenericRecordsTable: noop('feishuRec'),
    ensureFeishuGenericRecordsNotifyTrigger: noop('feishuTrig'),
    ensureLeaveDomainTable: noop('leaveDomain'),
    initStoreAliasCache: async () => {
      calls.ensure.push('alias');
    },
    setMasterPool: () => {
      calls.hooks.push('masterPool');
    },
    setReportPool: () => {
      calls.hooks.push('reportPool');
    },
    setSalesRawPool: () => {
      calls.hooks.push('salesRawPool');
    },
    setDataExecutorPool: () => {
      calls.hooks.push('dataExecPool');
    },
    setTaskResponseHook: () => {
      calls.hooks.push('taskHook');
    },
    handleTaskResponse: () => {},
    assertCriticalFunctions: () => {
      calls.hooks.push('assertCritical');
    },
    verifyLLMHealth: async () => ({ allOk: true }),
    startAgentScheduler: () => {
      calls.starts.push('agentSched');
    },
    startBitablePolling: () => {
      calls.starts.push('bitable');
    },
    startScheduledTasks: () => {
      calls.starts.push('schedTasks');
    },
    startMasterAgent: () => {
      calls.starts.push('masterAgent');
    },
    readMigrationSql: async (name) => {
      calls.mig.push(name);
      return '-- ok';
    },
    ...overrides,
  };
  return { deps, calls };
}

test('runStartupAgentSchemaBootstrap: full allowSchema path + agents started', async () => {
  const { deps, calls } = makeDeps();
  await runStartupAgentSchemaBootstrap(deps);
  assert.ok(calls.hooks.includes('masterPool'));
  assert.ok(calls.hooks.includes('taskHook'));
  assert.ok(calls.ensure.includes('sessions'));
  assert.ok(calls.ensure.includes('growth'));
  assert.ok(calls.ensure.includes('leaveDomain'));
  assert.ok(calls.starts.includes('agentSched'));
  assert.ok(calls.starts.includes('masterAgent'));
  assert.equal(calls.mig.length, LISTEN_TIME_MIGRATION_SQL_NAMES.length);
  assert.ok(calls.sql.some((s) => /daily_reports/i.test(s)));
  assert.ok(calls.sql.some((s) => /files/i.test(s)));
});

test('runStartupAgentSchemaBootstrap: skip DDL when allowSchemaChanges=false', async () => {
  const { deps, calls } = makeDeps({ allowSchemaChanges: false });
  await runStartupAgentSchemaBootstrap(deps);
  assert.ok(calls.ensure.includes('sessions'));
  assert.ok(!calls.ensure.includes('growth'));
  assert.ok(!calls.ensure.includes('leaveDomain'));
  assert.equal(calls.mig.length, 0);
  assert.ok(calls.starts.includes('agentSched'));
});

test('runStartupAgentSchemaBootstrap: DISABLE_AGENT_SCHEDULING skips starts', async () => {
  const { deps, calls } = makeDeps({
    env: { DISABLE_AGENT_SCHEDULING: 'true' },
    allowSchemaChanges: false,
  });
  await runStartupAgentSchemaBootstrap(deps);
  assert.deepEqual(calls.starts, []);
});

test('runStartupAgentSchemaBootstrap: migration + leave failures non-fatal; LLM unhealthy', async () => {
  const { deps, calls } = makeDeps({
    readMigrationSql: async (name) => {
      calls.mig.push(name);
      throw new Error('no_file');
    },
    ensureLeaveDomainTable: async () => {
      throw new Error('leave_fail');
    },
    verifyLLMHealth: async () => ({ allOk: false }),
    initStoreAliasCache: async () => {
      throw new Error('alias_fail');
    },
  });
  await runStartupAgentSchemaBootstrap(deps);
  assert.ok(calls.starts.includes('agentSched'));
  // allow microtask for verifyLLMHealth then
  await new Promise((r) => setImmediate(r));
});
