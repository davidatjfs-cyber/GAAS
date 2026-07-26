import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCoreMasterTables } from '../ensure-tables-core.js';
import { ensureTrainingRelatedTables } from '../ensure-tables-training.js';
import { ensureAgentMonitorTables } from '../ensure-tables-monitor.js';
import { createEnsureMasterTables } from '../ensure-tables.js';

function trackingClient() {
  const sqls = [];
  return {
    sqls,
    query: async (sql) => {
      sqls.push(String(sql));
      return { rows: [] };
    },
    release() {},
  };
}

test('ensureCoreMasterTables creates tasks/events + indexes', async () => {
  const client = trackingClient();
  await ensureCoreMasterTables(client);
  assert.ok(client.sqls.some((s) => /CREATE TABLE IF NOT EXISTS master_tasks/i.test(s)));
  assert.ok(client.sqls.some((s) => /CREATE TABLE IF NOT EXISTS master_events/i.test(s)));
  assert.ok(client.sqls.some((s) => /idx_master_tasks_status/i.test(s)));
});

test('ensureTrainingRelatedTables creates sop + training', async () => {
  const client = trackingClient();
  await ensureTrainingRelatedTables(client);
  assert.ok(client.sqls.some((s) => /sop_cases/i.test(s)));
  assert.ok(client.sqls.some((s) => /training_tasks/i.test(s)));
});

test('ensureAgentMonitorTables creates monitor tables', async () => {
  const client = trackingClient();
  await ensureAgentMonitorTables(client);
  assert.ok(client.sqls.some((s) => /agent_autonomous_logs/i.test(s)));
  assert.ok(client.sqls.some((s) => /agent_collaboration_archives/i.test(s)));
  assert.ok(client.sqls.some((s) => /regression_check_results/i.test(s)));
  assert.ok(client.sqls.some((s) => /automated_test_results/i.test(s)));
  assert.ok(client.sqls.some((s) => /agent_task_logs/i.test(s)));
  assert.ok(client.sqls.some((s) => /data_quality_logs/i.test(s)));
});

test('createEnsureMasterTables commits happy path and runs KG', async () => {
  const client = trackingClient();
  let released = false;
  client.release = () => { released = true; };
  const logs = [];
  let kg = 0;
  const ensure = createEnsureMasterTables({
    getPool: () => ({
      connect: async () => client,
    }),
    log: {
      info: (...a) => logs.push(['info', ...a]),
      error: (...a) => logs.push(['error', ...a]),
    },
    ensureKnowledgeGraphTables: async () => { kg += 1; },
  });
  await ensure();
  assert.ok(client.sqls.includes('BEGIN'));
  assert.ok(client.sqls.includes('COMMIT'));
  assert.equal(kg, 1);
  assert.equal(released, true);
  assert.ok(logs.some((l) => l[0] === 'info'));
});

test('createEnsureMasterTables rolls back on error; ignores 23505', async () => {
  const client = trackingClient();
  let n = 0;
  client.query = async (sql) => {
    client.sqls.push(String(sql));
    n += 1;
    if (n === 2) {
      const err = new Error('dup');
      err.code = '23505';
      throw err;
    }
    return { rows: [] };
  };
  const logs = [];
  const ensure = createEnsureMasterTables({
    getPool: () => ({ connect: async () => client }),
    log: {
      info: (...a) => logs.push(a),
      error: (...a) => logs.push(['error', ...a]),
    },
    ensureKnowledgeGraphTables: async () => {},
  });
  await ensure();
  assert.ok(client.sqls.some((s) => s === 'ROLLBACK'));

  // non-23505 logs error
  const client2 = trackingClient();
  let m = 0;
  client2.query = async (sql) => {
    client2.sqls.push(String(sql));
    m += 1;
    if (m === 2) throw new Error('db down');
    return { rows: [] };
  };
  const errors = [];
  const ensure2 = createEnsureMasterTables({
    getPool: () => ({ connect: async () => client2 }),
    log: {
      info() {},
      error: (...a) => errors.push(a),
    },
    ensureKnowledgeGraphTables: async () => { throw new Error('kg fail'); },
  });
  await ensure2();
  assert.ok(errors.some((e) => String(e[0]).includes('ensureMasterTables failed')));
  assert.ok(errors.some((e) => String(e[0]).includes('ensureKGTables failed')));
});
