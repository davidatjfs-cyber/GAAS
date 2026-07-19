import assert from 'node:assert/strict';
import test from 'node:test';

import { syncOntologyDataFromProduction } from './real-data-sync.js';

test('ontology production sync upserts every business id inside tenant scope', async () => {
  const statements = [];
  const pool = {
    query: async (sql) => {
      statements.push(String(sql));
      return { rowCount: 0, rows: [] };
    },
  };
  await syncOntologyDataFromProduction(pool, 'tenant_a');
  const upserts = statements.filter((sql) => sql.includes('ON CONFLICT'));
  assert.equal(upserts.length, 6);
  for (const sql of upserts) {
    assert.match(sql, /ON CONFLICT \(tenant_id, (?:store_id|employee_id|customer_id|order_id|campaign_id|touch_id)\)/);
  }
});
