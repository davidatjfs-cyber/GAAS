import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runHealthCheckPeriodScan,
  deliverHealthCheckReport,
} from './health-check-period-service.js';

test('runHealthCheckPeriodScan marks overdue and notifies', async () => {
  const updates = [];
  const notices = [];
  const pool = {
    query: async (sql, params = []) => {
      const s = String(sql);
      if (s.includes('SELECT id, lead_id')) {
        return {
          rows: [
            { id: 5, lead_id: 1, tenant_id: 'tenant-x', cs_owner: 'ops1', health_check_due_at: '2026-07-01' },
          ],
        };
      }
      if (s.includes('SET health_check_overdue=TRUE')) {
        updates.push(params[0]);
        return { rows: [] };
      }
      throw new Error(s.slice(0, 80));
    },
  };
  const now = new Date('2026-07-26T08:00:00Z');
  const r = await runHealthCheckPeriodScan(pool, async (msg, meta) => notices.push({ msg, meta }), now);
  assert.equal(r.ok, true);
  assert.equal(r.alerted, 1);
  assert.deepEqual(updates, [5]);
  assert.match(notices[0].msg, /7天体检期超时/);
  assert.equal(notices[0].meta.title, '体检期报告超时');
});

test('runHealthCheckPeriodScan handles empty rows and notify errors', async () => {
  const emptyPool = { query: async () => ({ rows: [] }) };
  const empty = await runHealthCheckPeriodScan(emptyPool, async () => {});
  assert.equal(empty.alerted, 0);

  const pool = {
    query: async (sql) => {
      if (String(sql).includes('SELECT')) {
        return { rows: [{ id: 1, tenant_id: 't', cs_owner: null, health_check_due_at: 'x' }] };
      }
      return { rows: [] };
    },
  };
  const r = await runHealthCheckPeriodScan(pool, async () => {
    throw new Error('down');
  });
  assert.equal(r.alerted, 1);
});

test('deliverHealthCheckReport persists report ref', async () => {
  const pool = {
    query: async (_sql, params) => {
      if (params[0] === 7) {
        return { rows: [{ id: 7, health_check_report_ref: params[1] }] };
      }
      return { rows: [] };
    },
  };
  const row = await deliverHealthCheckReport(pool, 7, 'report://abc');
  assert.equal(row.health_check_report_ref, 'report://abc');
  assert.equal(await deliverHealthCheckReport(pool, 8, null), null);
});
