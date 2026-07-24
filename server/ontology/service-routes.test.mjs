import test from 'node:test';
import assert from 'node:assert/strict';

import {
  disableOntologyRule,
  enableOntologyRule,
  listOntologyRuleHits,
  listOntologyRules,
  updateOntologyRule,
} from './service-routes.js';

function isSchemaSql(sql) {
  return /CREATE\s+(TABLE|UNIQUE|INDEX)/i.test(String(sql));
}

function isLoadRulesSql(sql) {
  const s = String(sql);
  return s.includes('FROM ontology_rules') && s.includes('is_active = true') && s.includes('effective_from');
}

function mockPool(handler) {
  return {
    query: async (sql, params) => {
      if (isSchemaSql(sql)) return { rows: [] };
      return handler(String(sql), params);
    },
  };
}

test('listOntologyRules returns empty rules when no effective rules', async () => {
  const pool = mockPool((sql) => {
    if (isLoadRulesSql(sql)) return { rows: [] };
    if (sql.includes('FROM ontology_rule_hits') && sql.includes('hit_count')) return { rows: [] };
    return { rows: [] };
  });
  const rules = await listOntologyRules(pool, { tenantId: 'default', storeId: '' });
  assert.deepEqual(rules, []);
});

test('updateOntologyRule returns rule_not_found when base rule missing', async () => {
  const pool = mockPool((sql) => {
    if (isLoadRulesSql(sql)) return { rows: [] };
    return { rows: [] };
  });
  const result = await updateOntologyRule(pool, {
    tenantId: 'default',
    storeId: '',
    ruleId: 'missing_rule',
    body: {},
    username: 'tester',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'rule_not_found');
});

test('updateOntologyRule inserts new version on success path', async () => {
  const baseRule = {
    rule_id: 'repeat_purchase_drop',
    rule_type: 'diagnosis',
    rule_name: '复购下降',
    business_domain: 'customer_growth',
    target_metric: 'repeat_purchase_rate',
    condition_json: { all: [] },
    action_json: { issueId: 'customer_retention_weak' },
    boss_language_template: '复购在掉',
    severity: 'P1',
    priority: 'P1',
    confidence_base: 0.8,
    version: 1,
    tenant_id: 'default',
    store_id: null,
  };
  const inserted = { ...baseRule, version: 2, rule_name: '复购下降-改', is_active: true, created_by: 'tester' };
  const pool = mockPool((sql) => {
    if (isLoadRulesSql(sql)) {
      if (sql.includes('tenant_id IS NULL AND store_id IS NULL')) return { rows: [] };
      return { rows: [baseRule] };
    }
    if (sql.includes('COALESCE(max(version)')) return { rows: [{ next_version: 2 }] };
    if (sql.includes('UPDATE ontology_rules SET is_active=false')) return { rows: [] };
    if (sql.includes('INSERT INTO ontology_rules')) return { rows: [inserted] };
    return { rows: [] };
  });
  const result = await updateOntologyRule(pool, {
    tenantId: 'default',
    storeId: '',
    ruleId: 'repeat_purchase_drop',
    body: { rule_name: '复购下降-改' },
    username: 'tester',
  });
  assert.equal(result.ok, true);
  assert.equal(result.rule.rule_id, 'repeat_purchase_drop');
  assert.equal(result.rule.version, 2);
  assert.equal(result.rule.rule_name, '复购下降-改');
});

test('listOntologyRuleHits returns empty array', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('FROM ontology_rule_hits') && sql.includes('ORDER BY hit_at DESC')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
  const hits = await listOntologyRuleHits(pool, { tenantId: 'default', storeId: '' });
  assert.deepEqual(hits, []);
});

test('disableOntologyRule returns disabled action', async () => {
  let updated = false;
  const pool = mockPool((sql) => {
    if (sql.includes('UPDATE ontology_rules SET is_active=false')) {
      updated = true;
      return { rows: [] };
    }
    return { rows: [] };
  });
  const result = await disableOntologyRule(pool, {
    tenantId: 'default',
    storeId: '',
    ruleId: 'repeat_purchase_drop',
  });
  assert.equal(updated, true);
  assert.deepEqual(result, { ok: true, ruleId: 'repeat_purchase_drop', action: 'disabled' });
});

test('enableOntologyRule returns enabled action', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('UPDATE ontology_rules SET is_active=true')) return { rows: [] };
    return { rows: [] };
  });
  const result = await enableOntologyRule(pool, {
    tenantId: 'default',
    storeId: 'store_a',
    ruleId: 'repeat_purchase_drop',
  });
  assert.deepEqual(result, { ok: true, ruleId: 'repeat_purchase_drop', action: 'enabled' });
});
