import assert from 'node:assert/strict';
import test from 'node:test';

import {
  feedbackLabel,
  materializeLearningCandidate,
  recordAiFeedback,
  recordAiInteraction,
} from '../trace-feedback-service.js';

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

test('recordAiInteraction rejects missing source and otherwise hashes/sanitizes and inserts', async () => {
  await assert.rejects(() => recordAiInteraction({ query: async () => ({ rows: [] }) }, {}), /ai_trace_source_required/);

  const pool = makePool([
    ['INSERT INTO ai_interaction_traces', () => ({ rows: [{ trace_id: 'trace-1' }] })],
  ]);
  const traceId = await recordAiInteraction(pool, {
    source: 'agent_message',
    sourceRecordId: 42,
    route: 'diagnosis',
    purpose: 'not a valid purpose!!',
    actorId: 'user-a',
    input: 'raw customer text',
    output: 'raw reply',
    qualityMetrics: { api_key: 'sk-secret', total: 0.9 },
    businessContext: { phone: '13812345678' },
    tenantId: 'tenant-a',
  });
  assert.equal(traceId, 'trace-1');
  const insert = pool.calls.find((c) => c.text.includes('INSERT INTO ai_interaction_traces'));
  assert.equal(insert.params[0], 'tenant-a');
  assert.equal(insert.params[1], 'agent_message');
  assert.equal(insert.params[4], null); // invalid purpose normalized to null
  assert.equal(insert.params[9].length, 64); // sha256 input hash
  assert.equal(insert.params[15].includes('sk-secret'), false);
  assert.equal(insert.params[16].includes('13812345678'), false);
});

test('feedbackLabel maps feedback type + rating to a label', () => {
  assert.equal(feedbackLabel('business_outcome', 1), 'business_win');
  assert.equal(feedbackLabel('business_outcome', -1), 'business_loss');
  assert.equal(feedbackLabel('quality_audit', 1), 'audit_pass');
  assert.equal(feedbackLabel('quality_audit', -1), 'audit_fail');
  assert.equal(feedbackLabel('user_rating', 1), 'helpful');
  assert.equal(feedbackLabel('user_rating', -1), 'unhelpful');
});

test('materializeLearningCandidate short-circuits when platform learning is not authorized', async () => {
  const pool = makePool([
    ['SELECT platform_learning_enabled', () => ({ rows: [] })],
  ]);
  const result = await materializeLearningCandidate(pool, { traceId: 't1', input: 'a', output: 'b' });
  assert.deepEqual(result, { created: false, reason: 'platform_learning_not_enabled' });
});

test('materializeLearningCandidate short-circuits when trace is missing', async () => {
  const pool = makePool([
    ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['*'] }] })],
    ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [] })],
  ]);
  const result = await materializeLearningCandidate(pool, { traceId: 'missing', input: 'a', output: 'b' });
  assert.deepEqual(result, { created: false, reason: 'trace_not_found' });
});

test('materializeLearningCandidate rejects purposes outside the allow-list', async () => {
  const pool = makePool([
    ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['diagnosis'] }] })],
    ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [{ route: 'r', purpose: 'marketing' }] })],
  ]);
  const result = await materializeLearningCandidate(pool, { traceId: 't1', input: 'a', output: 'b' });
  assert.deepEqual(result, { created: false, reason: 'purpose_not_allowed' });
});

test('materializeLearningCandidate skips empty-after-redaction content', async () => {
  const pool = makePool([
    ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['*'] }] })],
    ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [{ route: 'r', purpose: 'diagnosis' }] })],
  ]);
  const result = await materializeLearningCandidate(pool, { traceId: 't1', input: '   ', output: '   ' });
  assert.deepEqual(result, { created: false, reason: 'empty_after_redaction' });
});

test('materializeLearningCandidate requires a pseudonym key even when the source is loaded from traces', async () => {
  const pool = makePool([
    ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['*'] }] })],
    ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [{ route: 'r', purpose: 'diagnosis' }] })],
  ]);
  const priorKey = process.env.AI_LEARNING_PSEUDONYM_KEY;
  delete process.env.AI_LEARNING_PSEUDONYM_KEY;
  try {
    await assert.rejects(
      () => materializeLearningCandidate(pool, { traceId: 't1', input: 'good input', output: 'good output' }),
      /AI_LEARNING_PSEUDONYM_KEY_required/
    );
  } finally {
    if (priorKey == null) delete process.env.AI_LEARNING_PSEUDONYM_KEY;
    else process.env.AI_LEARNING_PSEUDONYM_KEY = priorKey;
  }
});

test('materializeLearningCandidate loads source text from audits, diagnosis feedback, then agent messages, and persists a pseudonymized candidate', async () => {
  const priorKey = process.env.AI_LEARNING_PSEUDONYM_KEY;
  process.env.AI_LEARNING_PSEUDONYM_KEY = 'test-key';
  try {
    const auditPool = makePool([
      ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['*'] }] })],
      ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [{ route: 'r', purpose: 'diagnosis' }] })],
      ['FROM agent_quality_audits', () => ({ rows: [{ input: '客户来电 13812345678', output: '已处理' }] })],
      ['INSERT INTO ai_learning_candidates', () => ({ rows: [{ id: 'cand-audit' }] })],
    ]);
    const auditResult = await materializeLearningCandidate(auditPool, {
      traceId: 't1', label: 'helpful', labelScore: 1, businessOutcome: { note: 'ok' },
    });
    assert.deepEqual(auditResult, { created: true, candidateId: 'cand-audit' });
    const auditInsert = auditPool.calls.find((c) => c.text.includes('INSERT INTO ai_learning_candidates'));
    assert.equal(auditInsert.params[6].includes('13812345678'), false);

    const diagnosisPool = makePool([
      ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['*'] }] })],
      ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [{ route: 'r', purpose: 'diagnosis' }] })],
      ['FROM agent_quality_audits', () => ({ rows: [] })],
      ['FROM diagnosis_feedback', () => ({ rows: [{ input: 'diagnosis question', output: 'diagnosis answer' }] })],
      ['INSERT INTO ai_learning_candidates', () => ({ rows: [{ id: 'cand-diag' }] })],
    ]);
    const diagResult = await materializeLearningCandidate(diagnosisPool, { traceId: 't2', label: 'helpful', labelScore: 1 });
    assert.deepEqual(diagResult, { created: true, candidateId: 'cand-diag' });

    const messagePool = makePool([
      ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['*'] }] })],
      ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [{ route: 'r', purpose: 'diagnosis' }] })],
      ['FROM agent_quality_audits', () => ({ rows: [] })],
      ['FROM diagnosis_feedback', () => ({ rows: [] })],
      ['FROM agent_messages m', () => ({ rows: [{ input: 'message question', output: 'message answer' }] })],
      ['INSERT INTO ai_learning_candidates', () => ({ rows: [{ id: 'cand-msg' }] })],
    ]);
    const msgResult = await materializeLearningCandidate(messagePool, { traceId: 't3', label: 'helpful', labelScore: 1 });
    assert.deepEqual(msgResult, { created: true, candidateId: 'cand-msg' });

    const emptyMessagePool = makePool([
      ['SELECT platform_learning_enabled', () => ({ rows: [{ platform_learning_enabled: true, allowed_purposes: ['*'] }] })],
      ['FROM ai_interaction_traces WHERE tenant_id=$1 AND trace_id=$2', () => ({ rows: [{ route: 'r', purpose: 'diagnosis' }] })],
      ['FROM agent_quality_audits', () => ({ rows: [] })],
      ['FROM diagnosis_feedback', () => ({ rows: [] })],
      ['FROM agent_messages m', () => ({ rows: [] })],
    ]);
    const emptyResult = await materializeLearningCandidate(emptyMessagePool, { traceId: 't4' });
    assert.deepEqual(emptyResult, { created: false, reason: 'empty_after_redaction' });
  } finally {
    if (priorKey == null) delete process.env.AI_LEARNING_PSEUDONYM_KEY;
    else process.env.AI_LEARNING_PSEUDONYM_KEY = priorKey;
  }
});

test('recordAiFeedback validates input, inserts events, and materializes labeled candidates', async () => {
  await assert.rejects(() => recordAiFeedback({ query: async () => ({ rows: [] }) }, {}), /trace_id_required/);
  await assert.rejects(
    () => recordAiFeedback({ query: async () => ({ rows: [] }) }, { traceId: 't1', rating: 5 }),
    /invalid_rating/
  );

  const neutralPool = makePool([
    ['INSERT INTO ai_feedback_events', () => ({ rows: [{ id: 'fb-1' }] })],
  ]);
  const neutral = await recordAiFeedback(neutralPool, { traceId: 't1', rating: 0, note: 'ok' });
  assert.equal(neutral.feedbackId, 'fb-1');
  assert.deepEqual(neutral.candidate, { created: false, reason: 'unlabeled_feedback' });

  const positivePool = makePool([
    ['INSERT INTO ai_feedback_events', () => ({ rows: [{ id: 'fb-2' }] })],
    ['SELECT platform_learning_enabled', () => ({ rows: [] })],
  ]);
  const positive = await recordAiFeedback(positivePool, {
    traceId: 't2', rating: 1, feedbackType: 'quality_audit', input: 'q', output: 'a', tenantId: 'tenant-a',
  });
  assert.equal(positive.feedbackId, 'fb-2');
  assert.deepEqual(positive.candidate, { created: false, reason: 'platform_learning_not_enabled' });
});
