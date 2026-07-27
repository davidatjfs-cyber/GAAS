import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureContractAuthorizedLearningPolicies,
  normalizeContractLearningConfig,
  recordContractLearningAuthorization,
} from '../contract-policy-service.js';

test('normalizeContractLearningConfig rejects missing references and normalizes bounded fields', () => {
  assert.throws(() => normalizeContractLearningConfig({}), /AI_LEARNING_AGREEMENT_REFERENCE_required/);
  assert.throws(() => normalizeContractLearningConfig({
    agreementReference: 'contract-1',
    agreementEffectiveAt: 'not-a-date',
  }), /invalid_agreement_effective_at/);

  const config = normalizeContractLearningConfig({
    agreementReference: `  ${'r'.repeat(205)}  `,
    agreementVersion: '',
    agreementEffectiveAt: '2026-07-19T00:00:00+08:00',
    recordedBy: '',
  });
  assert.equal(config.agreementReference.length, 200);
  assert.equal(config.agreementVersion, '1');
  assert.equal(config.recordedBy, 'platform_owner');
  assert.equal(config.agreementEffectiveAt, '2026-07-18T16:00:00.000Z');
  assert.equal(config.authorizationBasis, 'contract');
  assert.equal(config.automationMode, 'automatic');
});

test('recordContractLearningAuthorization validates active tenant and writes policy event', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }] };
      if (String(sql).includes('INSERT INTO ai_learning_policies')) {
        return {
          rows: [{
            tenant_id: 'tenant-a',
            policy_version: 2,
            allowed_purposes: ['*'],
            retention_days: 365,
            max_daily_contributions: 100,
          }],
        };
      }
      return { rows: [] };
    },
  };
  const priorKey = process.env.AI_LEARNING_PSEUDONYM_KEY;
  process.env.AI_LEARNING_PSEUDONYM_KEY = 'test-key';
  try {
    const policy = await recordContractLearningAuthorization(pool, {
      tenantId: 'tenant-a',
      agreementReference: 'contract-001',
      agreementVersion: '7',
      agreementEffectiveAt: '2026-07-19T00:00:00Z',
      recordedBy: 'platform_owner',
    });
    assert.equal(policy.tenant_id, 'tenant-a');
    assert.equal(calls[0].sql.includes('FROM tenants'), true);
    assert.equal(calls[1].sql.includes('INSERT INTO ai_learning_policies'), true);
    assert.equal(calls[2].sql.includes('INSERT INTO ai_learning_policy_events'), true);
    assert.equal(calls[1].params.at(-1), 'manual_platform_record');
  } finally {
    if (priorKey == null) delete process.env.AI_LEARNING_PSEUDONYM_KEY;
    else process.env.AI_LEARNING_PSEUDONYM_KEY = priorKey;
  }
});

test('ensureContractAuthorizedLearningPolicies revokes stale CRM policy before invalidating artifacts', async () => {
  const calls = [];
  const revokedPolicy = {
    tenant_id: 'tenant-revoked',
    policy_version: 4,
    allowed_purposes: ['*'],
    retention_days: 365,
    max_daily_contributions: 100,
    authorization_basis: 'contract',
    agreement_reference: 'expired-contract',
    agreement_version: '1',
    agreement_effective_at: '2026-01-01T00:00:00.000Z',
    authorization_source: 'sales_crm',
  };
  const pool = {
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("FROM tenants WHERE status='active'")) return { rows: [{ tenant_id: 'tenant-active' }] };
      if (text.includes('FROM sales_orders')) return { rows: [] };
      if (text.includes('UPDATE ai_learning_policies')) return { rows: [revokedPolicy] };
      if (text.includes('SELECT DISTINCT i.dataset_id')) return { rows: [{ dataset_id: 'dataset-1' }] };
      if (text.includes('SELECT tenant_id FROM ai_learning_policies')) return { rows: [{ tenant_id: 'tenant-active' }] };
      return { rows: [] };
    },
  };
  const priorKey = process.env.AI_LEARNING_PSEUDONYM_KEY;
  process.env.AI_LEARNING_PSEUDONYM_KEY = 'test-key';
  try {
    const result = await ensureContractAuthorizedLearningPolicies(pool);
    assert.deepEqual(result.revoked, ['tenant-revoked']);
    assert.deepEqual(result.missingAuthorization, []);
    const revokeAt = calls.findIndex((call) => call.sql.includes('UPDATE ai_learning_policies'));
    const deleteAt = calls.findIndex((call) => call.sql.includes('DELETE FROM ai_evaluation_dataset_items'));
    const withdrawAt = calls.findIndex((call) => call.sql.includes("UPDATE ai_learning_candidates SET status='withdrawn'"));
    const invalidateAt = calls.findIndex((call) => call.sql.includes("status='invalidated_contract'"));
    assert.ok(revokeAt >= 0 && revokeAt < deleteAt);
    assert.ok(deleteAt < withdrawAt && withdrawAt < invalidateAt);
    assert.deepEqual(calls[revokeAt].params, [[]]);
  } finally {
    if (priorKey == null) delete process.env.AI_LEARNING_PSEUDONYM_KEY;
    else process.env.AI_LEARNING_PSEUDONYM_KEY = priorKey;
  }
});
