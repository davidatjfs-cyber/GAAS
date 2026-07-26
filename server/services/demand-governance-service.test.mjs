import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMAND_VERDICTS,
  createDemandRequest,
  listDemandRequests,
} from './demand-governance-service.js';

test('DEMAND_VERDICTS covers reject/config/evaluate/prioritize paths', () => {
  assert.ok(DEMAND_VERDICTS.reject_single_store);
  assert.equal(DEMAND_VERDICTS.reject_single_store.enter_eng, false);
  assert.equal(DEMAND_VERDICTS.prioritize_renewal.enter_eng, true);
  assert.ok(DEMAND_VERDICTS.config_solve.label);
});

function makePool() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    query: async (sql, params = []) => {
      const s = String(sql);
      if (s.includes('CREATE TABLE') || s.includes('CREATE INDEX')) return { rows: [] };
      if (s.includes('INSERT INTO tenant_demand_requests')) {
        seq += 1;
        const item = {
          id: seq,
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
        rows.push(item);
        return { rows: [item] };
      }
      if (s.includes('SELECT * FROM tenant_demand_requests')) {
        const tid = String(params[0] || '');
        return {
          rows: tid ? rows.filter((r) => r.tenant_id === tid) : rows.slice(),
        };
      }
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    },
  };
}

test('createDemandRequest requires title', async () => {
  const pool = makePool();
  const r = await createDemandRequest(pool, { title: '  ' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'title_required');
});

test('createDemandRequest defaults unknown verdict and queues eng when prioritized', async () => {
  const pool = makePool();
  const r = await createDemandRequest(pool, {
    title: '续费优先需求',
    verdict: 'not_a_real_verdict',
    tenant_id: 't1',
    created_by: 'cs1',
  });
  assert.equal(r.ok, true);
  assert.equal(r.item.verdict, 'evaluate_common');
  assert.equal(r.item.status, 'logged');
  assert.equal(r.item.enter_eng, false);

  const eng = await createDemandRequest(pool, {
    title: '优先续费项',
    verdict: 'prioritize_renewal',
    tenant_id: 't1',
  });
  assert.equal(eng.item.status, 'queued_eng');
  assert.equal(eng.item.enter_eng, true);
});

test('createDemandRequest marks reject verdicts as rejected', async () => {
  const pool = makePool();
  const r = await createDemandRequest(pool, {
    title: '单店定制',
    verdict: 'reject_single_store',
    detail: 'x'.repeat(3000),
  });
  assert.equal(r.ok, true);
  assert.equal(r.item.status, 'rejected');
  assert.ok(r.item.detail.length <= 2000);
});

test('listDemandRequests filters by tenant_id', async () => {
  const pool = makePool();
  await createDemandRequest(pool, { title: 'A', tenant_id: 'ta' });
  await createDemandRequest(pool, { title: 'B', tenant_id: 'tb' });
  const onlyA = await listDemandRequests(pool, { tenant_id: 'ta' });
  assert.equal(onlyA.ok, true);
  assert.equal(onlyA.items.length, 1);
  assert.equal(onlyA.items[0].title, 'A');
  assert.ok(onlyA.verdicts.evaluate_common);

  const all = await listDemandRequests(pool, {});
  assert.equal(all.items.length, 2);
});
