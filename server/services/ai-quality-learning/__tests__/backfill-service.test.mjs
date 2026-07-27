import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillTenantLearningSignals } from '../backfill-service.js';

function makePool(handlers) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      for (const [match, respond] of handlers) {
        if (text.includes(match)) return respond(params);
      }
      return { rows: [] };
    },
  };
}

test('backfillTenantLearningSignals clamps retention, backfills audits + diagnosis feedback, and materializes pending feedback', async () => {
  const pool = makePool([
    ['SELECT retention_days FROM ai_learning_policies', () => ({ rows: [{ retention_days: 5 }] })],
    ['FROM agent_quality_audits\n      WHERE tenant_id=$1 AND trace_id IS NULL', () => ({
      rows: [{
        id: 'audit-1', route: 'diagnosis', username: 'user-a', query_text: 'q', response_text: 'a',
        audit_result: { safety: 'ok' }, passed: true, rewrite_count: 0, created_at: new Date(),
      }],
    })],
    ['FROM diagnosis_feedback\n      WHERE tenant_id=$1 AND trace_id IS NULL', () => ({
      rows: [{
        id: 'diag-1', task_id: 'task-1', user_key: 'user-b', query_text: 'dq', diagnosis: 'da',
        feedback: 1, feedback_note: 'good', metrics_used: ['revenue'], created_at: new Date(),
      }],
    })],
    ['FROM ai_feedback_events f', () => ({
      rows: [{ id: 'fb-pending', trace_id: 'trace-pending', feedback_type: 'user_rating', rating: 1, business_outcome: {} }],
    })],
    ['INSERT INTO ai_interaction_traces', () => ({ rows: [{ trace_id: `trace-${Math.random()}` }] })],
    ['INSERT INTO ai_feedback_events', () => ({ rows: [{ id: `fb-${Math.random()}` }] })],
    ['SELECT platform_learning_enabled', () => ({ rows: [] })],
  ]);

  const result = await backfillTenantLearningSignals(pool, 'tenant-a');
  assert.deepEqual(result, { tenantId: 'tenant-a', traced: 2, feedback: 2, materialized: 0 });

  const auditUpdate = pool.calls.find((c) => c.text.includes('UPDATE agent_quality_audits SET trace_id=$1'));
  assert.ok(auditUpdate);
  const diagnosisUpdate = pool.calls.find((c) => c.text.includes('UPDATE diagnosis_feedback SET trace_id=$1'));
  assert.ok(diagnosisUpdate);
  const retentionUpdate = pool.calls.find((c) => c.text.includes("UPDATE agent_quality_audits\n        SET username=''"));
  assert.ok(retentionUpdate);
  assert.equal(retentionUpdate.params[1], 30); // clamped to the 30-day floor
});

test('backfillTenantLearningSignals no-ops cleanly with no pending rows and a default retention window', async () => {
  const pool = makePool([
    ['SELECT retention_days FROM ai_learning_policies', () => ({ rows: [] })],
  ]);
  const result = await backfillTenantLearningSignals(pool, 'tenant-b');
  assert.deepEqual(result, { tenantId: 'tenant-b', traced: 0, feedback: 0, materialized: 0 });
  const retentionUpdate = pool.calls.find((c) => c.text.includes("UPDATE agent_quality_audits\n        SET username=''"));
  assert.equal(retentionUpdate.params[1], 365); // default retention when no policy row exists
});
