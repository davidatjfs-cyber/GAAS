import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_STEPS,
  startOnboarding,
  getOnboarding,
  completeOnboardingStep,
} from './tenant-onboarding-service.js';

test('ONBOARDING_STEPS defines ten ordered checklist entries', () => {
  assert.equal(ONBOARDING_STEPS.length, 10);
  assert.deepEqual(ONBOARDING_STEPS.map((s) => s.step_order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(ONBOARDING_STEPS.every((s) => s.step_key && s.title && s.owner_role));
  assert.equal(ONBOARDING_STEPS[0].step_key, 'create_store');
  assert.equal(ONBOARDING_STEPS[9].step_key, 'go_live');
});

function makeOnboardingPool() {
  const runs = [];
  const steps = [];
  let runSeq = 0;
  let stepSeq = 0;
  return {
    runs,
    steps,
    query: async (sql, params = []) => {
      const s = String(sql);
      if (s.includes('CREATE TABLE')) return { rows: [] };
      if (s.includes('CREATE INDEX')) return { rows: [] };
      if (s.includes('SELECT * FROM tenant_onboarding_runs WHERE tenant_id=$1 AND status')) {
        const hit = runs.find((r) => r.tenant_id === params[0] && r.status === 'in_progress');
        return { rows: hit ? [hit] : [] };
      }
      if (s.includes('INSERT INTO tenant_onboarding_runs')) {
        runSeq += 1;
        const run = {
          id: runSeq,
          tenant_id: params[0],
          status: 'in_progress',
          current_step: 'create_store',
          started_by: params[1],
          meta: {},
        };
        runs.push(run);
        return { rows: [run] };
      }
      if (s.includes('INSERT INTO tenant_onboarding_steps')) {
        stepSeq += 1;
        const step = {
          id: stepSeq,
          run_id: params[0],
          step_key: params[1],
          step_order: params[2],
          title: params[3],
          status: 'pending',
          owner_role: params[4],
          impact: params[5],
          inspection_keys: JSON.parse(params[6] || '[]'),
          completed_by: null,
        };
        steps.push(step);
        return { rows: [step] };
      }
      if (s.includes('SELECT * FROM tenant_onboarding_runs WHERE id=$1')) {
        return { rows: runs.filter((r) => r.id === params[0]) };
      }
      if (s.includes('SELECT * FROM tenant_onboarding_steps WHERE run_id=$1 ORDER BY step_order')) {
        return { rows: steps.filter((st) => st.run_id === params[0]).sort((a, b) => a.step_order - b.step_order) };
      }
      if (s.includes('SELECT status FROM tenants')) {
        return { rows: [{ status: 'provisioning' }] };
      }
      if (s.includes('FROM hrms_state')) {
        return { rows: [{ data: { brands: [{ name: '演示品牌' }] } }] };
      }
      if (s.includes('tenant_config')) {
        return { rows: [{ config_value: { ok: false } }] };
      }
      if (s.includes('UPDATE tenant_onboarding_steps')) {
        const step = s.includes("status='done'")
          ? steps.find((st) => st.run_id === params[0] && st.step_key === params[1])
          : steps.find((st) => st.id === params[0]);
        if (step && s.includes("status='done'")) {
          step.status = 'done';
          step.completed_by = params[2] || step.completed_by;
        } else if (step) {
          step.status = params[1];
          step.missing = params[2];
          step.evidence = JSON.parse(params[3] || '{}');
        }
        return { rows: step ? [step] : [] };
      }
      if (s.includes('UPDATE tenant_onboarding_runs')) {
        const run = runs.find((r) => r.id === params[0]);
        if (run) {
          run.current_step = params[1];
          run.status = params[2];
          run.meta = JSON.parse(params[3] || '{}');
        }
        return { rows: [run] };
      }
      if (s.includes('information_schema.tables')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test('startOnboarding creates run and steps then refreshes progress', async () => {
  const pool = makeOnboardingPool();
  const result = await startOnboarding(pool, { tenantId: 'tenant-a', startedBy: 'ops1' });
  assert.equal(result.ok, true);
  assert.equal(result.run.tenant_id, 'tenant-a');
  assert.equal(result.steps.length, 10);
  assert.ok(result.steps.some((s) => s.step_key === 'pos_orders'));
});

test('startOnboarding returns existing in-progress run', async () => {
  const pool = makeOnboardingPool();
  const first = await startOnboarding(pool, { tenantId: 'tenant-b' });
  const second = await startOnboarding(pool, { tenantId: 'tenant-b' });
  assert.equal(first.run.id, second.run.id);
});

test('startOnboarding rejects empty tenant id', async () => {
  const pool = makeOnboardingPool();
  await assert.rejects(() => startOnboarding(pool, { tenantId: '  ' }), /tenant_id_required/);
});

test('completeOnboardingStep marks manual completion', async () => {
  const pool = makeOnboardingPool();
  const started = await startOnboarding(pool, { tenantId: 'tenant-c' });
  const done = await completeOnboardingStep(pool, started.run.id, 'pos_brand', {
    completedBy: 'platform_admin',
    note: '已选客如云',
  });
  const step = done.steps.find((s) => s.step_key === 'pos_brand');
  assert.equal(step.status, 'done');
  assert.equal(step.completed_by, 'platform_admin');
});

test('getOnboarding returns not_found for missing run', async () => {
  const pool = makeOnboardingPool();
  const result = await getOnboarding(pool, 999);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not_found');
});
