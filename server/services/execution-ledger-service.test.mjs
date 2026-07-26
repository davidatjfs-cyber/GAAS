import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionLedger } from './execution-ledger-service.js';

function makePool({ tables = new Set(['master_tasks', 'growth_actions']), tasks = [], actions = [] } = {}) {
  return {
    query: async (sql, params = []) => {
      const s = String(sql);
      if (s.includes('information_schema.tables')) {
        return { rows: tables.has(params[0]) ? [{ '?column?': 1 }] : [] };
      }
      if (s.includes('FROM master_tasks')) {
        return { rows: tasks };
      }
      if (s.includes('FROM growth_actions')) {
        return { rows: actions };
      }
      throw new Error(`unexpected sql: ${s.slice(0, 100)}`);
    },
  };
}

test('buildExecutionLedger returns empty-period statement when no tables', async () => {
  const pool = makePool({ tables: new Set() });
  const r = await buildExecutionLedger(pool, {
    tenantId: 'default',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-26',
  });
  assert.equal(r.ok, true);
  assert.equal(r.summary.suggested_count, 0);
  assert.match(r.statement, /未产生待客户确认/);
  assert.deepEqual(r.period, { date_from: '2026-07-01', date_to: '2026-07-26' });
});

test('buildExecutionLedger classifies master_tasks decisions and skips executed', async () => {
  const pool = makePool({
    tasks: [
      { task_id: 't1', title: '待确认', status: 'proposed', assignee_role: '店长', store: '洪潮', created_at: '2026-07-10' },
      { task_id: 't2', title: '已确认未执行', status: 'pending_review', assignee_role: '服务员', store: '马己仙', created_at: '2026-07-11' },
      { task_id: 't3', title: '已拒绝', status: 'rejected', assignee_role: 'manager', store: '洪潮', created_at: '2026-07-12' },
      { task_id: 't4', title: '已完成', status: 'done', assignee_role: '店长', store: '洪潮', created_at: '2026-07-13' },
    ],
    actions: [],
  });
  const r = await buildExecutionLedger(pool, { tenant_id: 't1', date_from: '2026-07-01', date_to: '2026-07-26' });
  assert.equal(r.summary.suggested_count, 3);
  const byId = Object.fromEntries(r.items.map((i) => [i.ref_id, i]));
  assert.equal(byId.t1.decision, 'unconfirmed');
  assert.equal(byId.t1.responsible_party, 'store_manager');
  assert.equal(byId.t2.decision, 'confirmed_unexecuted');
  assert.equal(byId.t2.responsible_party, 'employee');
  assert.equal(byId.t3.decision, 'rejected');
  assert.equal(byId.t4, undefined);
  assert.match(r.statement, /共提出 3 条/);
});

test('buildExecutionLedger includes proposed and ignored growth_actions', async () => {
  const pool = makePool({
    tasks: [],
    actions: [
      { action_key: 'a1', action_type: 'sms', status: 'proposed', store_id: '洪潮', title: '发短信', created_at: '2026-07-10' },
      { action_key: 'a2', action_type: 'wecom', status: 'ignored', store_id: '马己仙', title: '企微触达', created_at: '2026-07-11' },
    ],
  });
  const r = await buildExecutionLedger(pool, { tenantId: 'x', storeId: '洪潮' });
  assert.equal(r.summary.suggested_count, 2);
  assert.equal(r.summary.ignored_count, 1);
  assert.equal(r.summary.unexecuted_count, 1);
  const ignored = r.items.find((i) => i.ref_id === 'a2');
  assert.equal(ignored.decision, 'ignored');
  assert.equal(ignored.responsible_party, 'tenant_admin');
  assert.match(ignored.impact, /被忽略/);
});
