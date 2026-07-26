import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeployCheckSlaScan, completeDeployCheck } from './onboarding-sla-service.js';

test('runDeployCheckSlaScan marks overdue and notifies', async () => {
  const updates = [];
  const notices = [];
  const pool = {
    query: async (sql, params = []) => {
      const s = String(sql);
      if (s.includes('SELECT id, lead_id')) {
        return {
          rows: [
            { id: 1, lead_id: 10, tenant_id: 't-a', cs_owner: 'cs1', deploy_check_due_at: '2026-07-01' },
            { id: 2, lead_id: 11, tenant_id: 't-b', cs_owner: null, deploy_check_due_at: '2026-07-02' },
          ],
        };
      }
      if (s.includes('SET deploy_check_overdue=TRUE')) {
        updates.push(params[0]);
        return { rows: [] };
      }
      throw new Error(s.slice(0, 80));
    },
  };
  const notify = async (msg, meta) => {
    notices.push({ msg, meta });
  };
  const now = new Date('2026-07-26T00:00:00Z');
  const r = await runDeployCheckSlaScan(pool, notify, now);
  assert.equal(r.ok, true);
  assert.equal(r.alerted, 2);
  assert.equal(r.checked_at, now.toISOString());
  assert.deepEqual(updates, [1, 2]);
  assert.equal(notices.length, 2);
  assert.match(notices[0].msg, /部署检查SLA超时/);
  assert.equal(notices[0].meta.audience, 'customer_service');
  assert.match(notices[1].msg, /未分配/);
});

test('runDeployCheckSlaScan ignores notify failures and non-functions', async () => {
  const pool = {
    query: async (sql) => {
      if (String(sql).includes('SELECT id, lead_id')) {
        return { rows: [{ id: 9, tenant_id: 't', cs_owner: 'cs', deploy_check_due_at: 'x' }] };
      }
      return { rows: [] };
    },
  };
  const failing = async () => {
    throw new Error('boom');
  };
  const r1 = await runDeployCheckSlaScan(pool, failing);
  assert.equal(r1.alerted, 1);
  const r2 = await runDeployCheckSlaScan(pool, null);
  assert.equal(r2.alerted, 1);
});

test('completeDeployCheck returns updated row or null', async () => {
  const pool = {
    query: async (_sql, params) => {
      if (params[0] === 3) return { rows: [{ id: 3, deploy_check_completed_at: 'now' }] };
      return { rows: [] };
    },
  };
  assert.equal((await completeDeployCheck(pool, 3)).id, 3);
  assert.equal(await completeDeployCheck(pool, 404), null);
});
