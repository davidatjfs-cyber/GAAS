import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideAutomaticPromotion,
  evaluateReleaseGate,
  normalizeContractLearningConfig,
  redactLearningText,
  runPlatformQualityModelTask,
  shouldRollbackCanary,
} from './ai-quality-learning-service.js';

test('redactLearningText removes direct identifiers and secrets', () => {
  const source = '手机 13812345678，邮箱 boss@example.com，身份证 110101199001011234，api_key=sk-live-secret';
  const result = redactLearningText(source);
  assert.equal(result.text.includes('13812345678'), false);
  assert.equal(result.text.includes('boss@example.com'), false);
  assert.equal(result.text.includes('110101199001011234'), false);
  assert.equal(result.text.includes('sk-live-secret'), false);
  assert.equal(result.report.replacements.phone, 1);
  assert.equal(result.report.replacements.email, 1);
  assert.equal(result.report.replacements.id_card, 1);
  assert.equal(result.report.replacements.secret, 1);
});

test('platform quality model task has a separate daily quota and metadata-only audit', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (String(sql).includes('SELECT COUNT(*)')) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
  };
  const previousLimit = process.env.AI_QUALITY_DAILY_CALL_LIMIT;
  process.env.AI_QUALITY_DAILY_CALL_LIMIT = '5';
  try {
    const result = await runPlatformQualityModelTask(pool, {
      operation: 'evaluate_prompt_patch',
      route: 'marketing_plan',
      execute: async () => ({ ok: true, actualModel: 'quality-model', responseTime: 12, raw: { usage: { prompt_tokens: 10, completion_tokens: 3 } } }),
    });
    assert.equal(result.ok, true);
    const insert = calls.find((item) => String(item.sql).includes('INSERT INTO ai_quality_model_calls'));
    assert.ok(insert);
    assert.equal(insert.params[0], 'evaluate_prompt_patch');
    assert.equal(insert.params[1], 'marketing_plan');
    assert.equal(insert.params.includes('quality-model'), true);
    assert.equal(insert.params.length, 9);
    assert.equal(insert.params.some((value) => String(value).includes('customer raw text')), false);
  } finally {
    if (previousLimit == null) delete process.env.AI_QUALITY_DAILY_CALL_LIMIT;
    else process.env.AI_QUALITY_DAILY_CALL_LIMIT = previousLimit;
  }
});

test('redactLearningText removes operational identity and location labels', () => {
  const source = '联系人：张三，门店：幸福路旗舰店，地址：上海市浦东新区幸福路88号，来源 https://example.com/a?token=abc，IP 8.8.8.8';
  const result = redactLearningText(source);
  assert.equal(result.text.includes('张三'), false);
  assert.equal(result.text.includes('幸福路旗舰店'), false);
  assert.equal(result.text.includes('幸福路88号'), false);
  assert.equal(result.text.includes('example.com'), false);
  assert.equal(result.text.includes('8.8.8.8'), false);
});

test('contract learning config is explicit and traceable', () => {
  assert.throws(() => normalizeContractLearningConfig({}), /AI_LEARNING_AGREEMENT_REFERENCE_required/);
  const config = normalizeContractLearningConfig({
    agreementReference: 'offline-master-contract-ai-clause',
    agreementVersion: '2026-07',
    agreementEffectiveAt: '2026-07-19T00:00:00+08:00',
    recordedBy: 'platform_owner',
  });
  assert.equal(config.authorizationBasis, 'contract');
  assert.equal(config.automationMode, 'automatic');
  assert.equal(config.agreementVersion, '2026-07');
});

test('release gate requires diverse evidence and a measurable quality lift', () => {
  const baseline = {
    quality_score: 0.80,
    groundedness: 0.91,
    safety_violation_rate: 0.005,
    negative_feedback_rate: 0.12,
    p95_latency_ms: 1000,
  };
  const candidate = {
    sample_size: 180,
    tenant_count: 4,
    quality_score: 0.84,
    groundedness: 0.93,
    safety_violation_rate: 0.004,
    negative_feedback_rate: 0.09,
    p95_latency_ms: 1120,
  };
  assert.equal(evaluateReleaseGate(baseline, candidate).passed, true);
  assert.equal(evaluateReleaseGate(baseline, { ...candidate, tenant_count: 1 }).passed, false);
  assert.equal(evaluateReleaseGate(baseline, { ...candidate, quality_score: 0.81 }).passed, false);
});

test('canary rollback reacts to safety, feedback and quality regressions', () => {
  const baseline = {
    quality_score: 0.84,
    safety_violation_rate: 0.002,
    negative_feedback_rate: 0.08,
    error_rate: 0.01,
  };
  assert.equal(shouldRollbackCanary(baseline, {
    quality_score: 0.85,
    safety_violation_rate: 0.002,
    negative_feedback_rate: 0.09,
    error_rate: 0.01,
  }).rollback, false);
  const unsafe = shouldRollbackCanary(baseline, {
    quality_score: 0.79,
    safety_violation_rate: 0.004,
    negative_feedback_rate: 0.14,
    error_rate: 0.03,
  });
  assert.equal(unsafe.rollback, true);
  assert.deepEqual(new Set(unsafe.reasons.map((item) => item.key)), new Set([
    'safety_violation_rate', 'negative_feedback_rate', 'error_rate', 'quality_score',
  ]));
});

test('automatic promotion waits for evidence, promotes safe lift and rolls back regression', () => {
  const baseline = { quality_score: 0.8, safety_violation_rate: 0, negative_feedback_rate: 0.1, error_rate: 0.01 };
  assert.equal(decideAutomaticPromotion(baseline, {
    sample_size: 50, tenant_count: 2, quality_score: 0.84,
    safety_violation_rate: 0, negative_feedback_rate: 0.08, error_rate: 0.01,
  }).status, 'canary');
  assert.equal(decideAutomaticPromotion(baseline, {
    sample_size: 120, tenant_count: 3, quality_score: 0.84,
    safety_violation_rate: 0, negative_feedback_rate: 0.08, error_rate: 0.01,
  }).status, 'approved');
  assert.equal(decideAutomaticPromotion(baseline, {
    sample_size: 120, tenant_count: 3, quality_score: 0.7,
    safety_violation_rate: 0.01, negative_feedback_rate: 0.2, error_rate: 0.05,
  }).status, 'rolled_back');
});
