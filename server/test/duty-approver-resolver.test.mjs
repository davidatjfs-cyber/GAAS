import test from 'node:test';
import assert from 'node:assert/strict';
import { createDutyApproverResolver } from '../domains/store-duty-bindings/resolve-approver.js';

test('resolveDutyApproverForStore empty store returns empty string', async () => {
  const calls = [];
  const pool = {
    query: async (...args) => {
      calls.push(args);
      return { rows: [] };
    },
  };
  const ensureReady = async () => {
    calls.push(['ensureReady']);
  };
  const { resolveDutyApproverForStore } = createDutyApproverResolver({ pool, ensureReady });

  assert.equal(await resolveDutyApproverForStore(''), '');
  assert.equal(await resolveDutyApproverForStore('   '), '');
  assert.equal(await resolveDutyApproverForStore(null), '');
  assert.equal(calls.length, 0);
});

test('resolveDutyApproverForStore queries can_approve_hrms window and returns trimmed username', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ username: '  alice  ' }] };
    },
  };
  const ensureReady = async () => {
    calls.push({ ensureReady: true });
  };
  const { resolveDutyApproverForStore } = createDutyApproverResolver({ pool, ensureReady });

  const got = await resolveDutyApproverForStore('马己仙');
  assert.equal(got, 'alice');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ensureReady, true);
  assert.match(calls[1].sql, /can_approve_hrms\s*=\s*true/);
  assert.match(calls[1].sql, /enabled\s*=\s*true/);
  assert.match(calls[1].sql, /effective_from\s+IS NULL OR effective_from\s*<=\s*now\(\)/);
  assert.match(calls[1].sql, /effective_to\s+IS NULL OR effective_to\s*>=\s*now\(\)/);
  assert.match(calls[1].sql, /lower\(trim\(store\)\)\s*=\s*lower\(trim\(\$1\)\)/);
  assert.deepEqual(calls[1].params, ['马己仙']);
});

test('resolveDutyApproverForStore no rows returns empty string', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const { resolveDutyApproverForStore } = createDutyApproverResolver({
    pool,
    ensureReady: async () => {},
  });
  assert.equal(await resolveDutyApproverForStore('洪潮'), '');
});

test('resolveDutyApproverForStore query throw returns empty string', async () => {
  const pool = {
    query: async () => {
      throw new Error('db_down');
    },
  };
  const { resolveDutyApproverForStore } = createDutyApproverResolver({
    pool,
    ensureReady: async () => {},
  });
  assert.equal(await resolveDutyApproverForStore('洪潮'), '');
});

test('resolveDutyApproverForStore calls ensureReady before query', async () => {
  const order = [];
  const pool = {
    query: async () => {
      order.push('query');
      return { rows: [{ username: 'bob' }] };
    },
  };
  const ensureReady = async () => {
    order.push('ensureReady');
  };
  const { resolveDutyApproverForStore } = createDutyApproverResolver({ pool, ensureReady });
  await resolveDutyApproverForStore('店A');
  assert.deepEqual(order, ['ensureReady', 'query']);
});
