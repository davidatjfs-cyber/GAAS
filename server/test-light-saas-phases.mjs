import assert from 'node:assert/strict';
import { ONBOARDING_STEPS } from './services/tenant-onboarding-service.js';
import { DEMAND_VERDICTS, createDemandRequest, listDemandRequests } from './services/demand-governance-service.js';
import { listHealthFaqs } from './services/tenant-health-faq.js';
import { buildExecutionLedger } from './services/execution-ledger-service.js';
import { classifyIncidentQueue } from './services/tenant-health-incident-service.js';

assert.equal(ONBOARDING_STEPS.length, 10);
assert.ok(DEMAND_VERDICTS.reject_single_store);
assert.ok(listHealthFaqs().some((f) => f.id === 'non-execution'));
assert.ok(listHealthFaqs().every((f) => f.category && Array.isArray(f.steps)));
console.log('ok constants');

function makePool() {
  const demands = [];
  let seq = 1;
  return {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('information_schema.tables')) {
        const table = params[0];
        if (['master_tasks', 'growth_actions'].includes(table)) return { rows: [{ x: 1 }] };
        return { rows: [] };
      }
      if (text.includes('FROM master_tasks')) {
        return {
          rows: [
            { task_id: 'T1', title: '唤醒老客', status: 'pending_dispatch', store: 'A', assignee_role: 'store_manager', source: 'ontology', created_at: '2026-07-01', updated_at: '2026-07-01', due_at: null },
            { task_id: 'T2', title: '已完成任务', status: 'closed', store: 'A', assignee_role: 'employee', source: 'ontology', created_at: '2026-07-01', updated_at: '2026-07-02', due_at: null },
          ],
        };
      }
      if (text.includes('FROM growth_actions')) {
        return {
          rows: [
            { action_key: 'a1', action_type: 'send_voucher', status: 'proposed', store_id: 'A', title: '发券', detail: '', created_at: '2026-07-02', executed_at: null },
            { action_key: 'a2', action_type: 'send_voucher', status: 'ignored', store_id: 'A', title: '忽略券', detail: '', created_at: '2026-07-02', executed_at: null },
          ],
        };
      }
      if (text.includes('CREATE TABLE IF NOT EXISTS tenant_demand_requests') || text.includes('CREATE INDEX IF NOT EXISTS idx_tdr')) return { rows: [] };
      if (text.includes('INSERT INTO tenant_demand_requests')) {
        const row = {
          id: seq++,
          tenant_id: params[0],
          title: params[1],
          detail: params[2],
          source: params[3],
          verdict: params[4],
          status: params[5],
          enter_eng: params[6],
          created_by: params[7],
          decided_by: params[8],
          decision_note: params[9],
        };
        demands.push(row);
        return { rows: [row] };
      }
      if (text.includes('FROM tenant_demand_requests')) return { rows: demands };
      return { rows: [] };
    },
  };
}

{
  const ledger = await buildExecutionLedger(makePool(), { tenantId: 't1', dateFrom: '2026-06-01', dateTo: '2026-07-13' });
  assert.equal(ledger.ok, true);
  assert.ok(ledger.summary.suggested_count >= 3);
  assert.ok(ledger.statement.includes('无法评价'));
  assert.ok(ledger.items.some((i) => i.decision === 'unconfirmed'));
  assert.ok(ledger.items.some((i) => i.decision === 'proposed_unexecuted'));
  assert.ok(!ledger.items.some((i) => i.ref_id === 'T2')); // executed filtered out
  console.log('ok execution ledger');
}

{
  assert.equal(classifyIncidentQueue({ item_key: 'manager_confirmed_tasks', responsible_party: 'store_manager', owner_role: '店长' }), 'customer');
  const pool = makePool();
  const created = await createDemandRequest(pool, { title: '只要我们店要的特殊报表', verdict: 'reject_single_store', tenant_id: 't1' });
  assert.equal(created.ok, true);
  assert.equal(created.item.status, 'rejected');
  assert.equal(created.item.enter_eng, false);
  const listed = await listDemandRequests(pool, {});
  assert.ok(listed.items.length >= 1);
  console.log('ok demand governance');
}

console.log('phase3465 tests passed');
