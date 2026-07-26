import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateRule,
  evaluateRules,
  loadEffectiveRules,
  renderBossLanguage,
  getRuleSourceNote,
  confidenceNoteForRule,
} from './ontology-rule-service.js';

describe('ontology-rule-service', () => {
  describe('evaluateRule', () => {
    it('should match between comparator', async () => {
      const rule = {
        rule_id: 'test_between',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'value', comparator: 'between', value: [10, 20] },
        severity: 'P1',
        priority: 'P1',
        confidence_base: 0.9,
        version: 1,
      };
      const result = await evaluateRule(rule, { value: 15 });
      assert.strictEqual(result.matched, true);
      assert.strictEqual(result.severity, 'P1');
    });

    it('should not match between when outside range', async () => {
      const rule = {
        rule_id: 'test_between',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'value', comparator: 'between', value: [10, 20] },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { value: 25 });
      assert.strictEqual(result.matched, false);
    });

    it('should match >= comparator', async () => {
      const rule = {
        rule_id: 'test_gte',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'count', comparator: '>=', value: 5 },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.75,
        version: 1,
      };
      const result = await evaluateRule(rule, { count: 5 });
      assert.strictEqual(result.matched, true);
    });

    it('should match < comparator', async () => {
      const rule = {
        rule_id: 'test_lt',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'rate', comparator: '<', value: 0.35 },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.76,
        version: 1,
      };
      const result = await evaluateRule(rule, { rate: 0.30 });
      assert.strictEqual(result.matched, true);
    });

    it('should match <= comparator', async () => {
      const rule = {
        rule_id: 'test_lte',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'rate', comparator: '<=', value: -8 },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.84,
        version: 1,
      };
      const result = await evaluateRule(rule, { rate: -10 });
      assert.strictEqual(result.matched, true);
    });

    it('should match = comparator', async () => {
      const rule = {
        rule_id: 'test_eq',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'status', comparator: '=', value: 0 },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { status: 0 });
      assert.strictEqual(result.matched, true);
    });

    it('should match != comparator', async () => {
      const rule = {
        rule_id: 'test_neq',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'status', comparator: '!=', value: 'closed' },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { status: 'open' });
      assert.strictEqual(result.matched, true);
    });

    it('should match in comparator', async () => {
      const rule = {
        rule_id: 'test_in',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'type', comparator: 'in', value: ['a', 'b', 'c'] },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { type: 'b' });
      assert.strictEqual(result.matched, true);
    });

    it('should match exists comparator', async () => {
      const rule = {
        rule_id: 'test_exists',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'name', comparator: 'exists' },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { name: 'John' });
      assert.strictEqual(result.matched, true);
    });

    it('should match not_exists comparator', async () => {
      const rule = {
        rule_id: 'test_not_exists',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: { field: 'name', comparator: 'not_exists' },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { name: null });
      assert.strictEqual(result.matched, true);
    });

    it('should handle all compound condition', async () => {
      const rule = {
        rule_id: 'test_all',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: {
          all: [
            { field: 'a', comparator: '>=', value: 10 },
            { field: 'b', comparator: '<', value: 5 },
          ],
        },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { a: 15, b: 3 });
      assert.strictEqual(result.matched, true);
    });

    it('should handle any compound condition', async () => {
      const rule = {
        rule_id: 'test_any',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: {
          any: [
            { field: 'a', comparator: '>=', value: 10 },
            { field: 'b', comparator: '<', value: 5 },
          ],
        },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { a: 5, b: 3 });
      assert.strictEqual(result.matched, true);
    });

    it('should handle nested all+any compound condition', async () => {
      const rule = {
        rule_id: 'test_nested',
        rule_name: 'Test',
        business_domain: 'test',
        condition_json: {
          all: [
            { field: 'a', comparator: '>=', value: 10 },
            {
              any: [
                { field: 'b', comparator: '>=', value: 2 },
                { field: 'c', comparator: '>=', value: 300 },
              ],
            },
          ],
        },
        severity: 'P2',
        priority: 'P2',
        confidence_base: 0.8,
        version: 1,
      };
      const result = await evaluateRule(rule, { a: 15, b: 1, c: 500 });
      assert.strictEqual(result.matched, true);
    });
  });

  describe('renderBossLanguage', () => {
    it('should render template with variables', () => {
      const rule = {
        boss_language_template: '发现 {count} 位客户，消费 {amount} 元。',
      };
      const result = renderBossLanguage(rule, { count: 10, amount: 500 });
      assert.strictEqual(result, '发现 10 位客户，消费 500 元。');
    });

    it('should use fallback when template is empty', () => {
      const rule = { boss_language_template: '' };
      const result = renderBossLanguage(rule, {});
      assert.strictEqual(result, '系统发现一条经营规则命中，建议跟进处理。');
    });

    it('should use fallback when rule is null', () => {
      const result = renderBossLanguage(null, {});
      assert.strictEqual(result, '系统发现一条经营规则命中，建议跟进处理。');
    });

    it('should replace missing variables with dash', () => {
      const rule = {
        boss_language_template: '发现 {count} 位客户，消费 {amount} 元。',
      };
      const result = renderBossLanguage(rule, { count: 10 });
      assert.strictEqual(result, '发现 10 位客户，消费 - 元。');
    });
  });

  describe('getRuleSourceNote', () => {
    it('should return store-level note', () => {
      const result = getRuleSourceNote({ store_id: 'store1', tenant_id: 'tenant1' });
      assert.strictEqual(result, '使用本门店专属经营规则判断');
    });

    it('should return tenant-level note', () => {
      const result = getRuleSourceNote({ tenant_id: 'tenant1' });
      assert.strictEqual(result, '使用本品牌经营规则判断');
    });

    it('should return system default note', () => {
      const result = getRuleSourceNote({});
      assert.strictEqual(result, '使用系统默认经营规则判断');
    });

    it('should return system default note for null', () => {
      const result = getRuleSourceNote(null);
      assert.strictEqual(result, '使用系统默认经营规则判断');
    });
  });

  describe('confidenceNoteForRule (alias)', () => {
    it('should be same as getRuleSourceNote', () => {
      assert.strictEqual(confidenceNoteForRule({ store_id: 's' }), '使用本门店专属经营规则判断');
      assert.strictEqual(confidenceNoteForRule({ tenant_id: 't' }), '使用本品牌经营规则判断');
      assert.strictEqual(confidenceNoteForRule(null), '使用系统默认经营规则判断');
    });
  });

  describe('loadEffectiveRules / evaluateRules', () => {
    it('should prefer store scope over tenant and system', async () => {
      const pool = {
        __unwrappedQuery: async (sql) => {
          if (/store_id = \$2/i.test(sql)) {
            return { rows: [{ rule_id: 'r1', version: 2, is_active: true, condition_json: { field: 'x', comparator: '>=', value: 1 }, severity: 'P1', priority: 'P1', confidence_base: 0.9, business_domain: 'customer_growth' }] };
          }
          if (/tenant_id = \$1 AND store_id IS NULL/i.test(sql)) {
            return { rows: [{ rule_id: 'r1', version: 1, is_active: true, condition_json: { field: 'x', comparator: '>=', value: 99 }, severity: 'P2', priority: 'P2', confidence_base: 0.8, business_domain: 'customer_growth' }] };
          }
          return { rows: [{ rule_id: 'r1', version: 0, is_active: true, condition_json: { field: 'x', comparator: '>=', value: 999 }, severity: 'P2', priority: 'P2', confidence_base: 0.7, business_domain: 'customer_growth' }] };
        },
        query: async () => ({ rows: [] }),
      };
      const rules = await loadEffectiveRules(pool, { tenantId: 'default', storeId: 's1' });
      assert.strictEqual(rules.length, 1);
      assert.strictEqual(rules[0].version, 2);
    });

    it('should evaluate matched and unmatched rules', async () => {
      const pool = {
        query: async () => ({
          rows: [
            { rule_id: 'hit', version: 1, is_active: true, condition_json: { field: 'rate', comparator: '<', value: 0.5 }, severity: 'P1', priority: 'P1', confidence_base: 0.9, business_domain: 'customer_growth' },
            { rule_id: 'miss', version: 1, is_active: true, condition_json: { field: 'rate', comparator: '<', value: 0.1 }, severity: 'P2', priority: 'P2', confidence_base: 0.8, business_domain: 'customer_growth' },
          ],
        }),
      };
      const result = await evaluateRules(pool, {
        tenantId: 'default',
        storeId: '',
        businessDomain: 'customer_growth',
        inputContext: { rate: 0.3 },
      });
      assert.strictEqual(result.matchedRules.length, 1);
      assert.strictEqual(result.unmatchedRules.length, 1);
      assert.strictEqual(result.evaluationSummary.topSeverity, 'P1');
    });
  });
});
