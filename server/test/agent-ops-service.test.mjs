/**
 * agent-ops 过滤/权限纯逻辑单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLimit,
  isOpsAdminRole,
  isOpsViewerRole,
  buildAutonomousTasksFilter,
  canResolveAutonomousTask,
  buildQualityAuditsFilter,
  listEvalSuiteRuns,
  resolveAutonomousTask,
} from '../domains/agent-ops/service.js';

test('role helpers', () => {
  assert.equal(isOpsAdminRole('admin'), true);
  assert.equal(isOpsAdminRole('hr_manager'), false);
  assert.equal(isOpsViewerRole('hr_manager'), true);
  assert.equal(isOpsViewerRole('store_manager'), false);
});

test('clampLimit', () => {
  assert.equal(clampLimit(0, { min: 1, max: 50, fallback: 10 }), 1);
  assert.equal(clampLimit(99, { min: 1, max: 50, fallback: 10 }), 50);
  assert.equal(clampLimit('x', { min: 1, max: 50, fallback: 10 }), 10);
});

test('buildAutonomousTasksFilter: store user scoped to self', () => {
  const f = buildAutonomousTasksFilter({
    status: 'open',
    role: 'store_manager',
    username: 'alice',
    tenantId: 't1',
    limit: 20,
  });
  assert.match(f.whereSql, /owner_username/);
  assert.match(f.whereSql, /requester_username/);
  assert.ok(f.params.includes('alice'));
  assert.ok(f.params.includes('t1'));
  assert.equal(f.limit, 20);
});

test('buildAutonomousTasksFilter: admin sees all statuses when all', () => {
  const f = buildAutonomousTasksFilter({
    status: 'all',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
  });
  assert.doesNotMatch(f.whereSql, /status =/);
  assert.doesNotMatch(f.whereSql, /owner_username/);
});

test('canResolveAutonomousTask', () => {
  assert.equal(
    canResolveAutonomousTask({
      role: 'admin',
      username: 'x',
      ownerUsername: 'a',
      requesterUsername: 'b',
    }),
    true
  );
  assert.equal(
    canResolveAutonomousTask({
      role: 'staff',
      username: 'a',
      ownerUsername: 'a',
      requesterUsername: 'b',
    }),
    true
  );
  assert.equal(
    canResolveAutonomousTask({
      role: 'staff',
      username: 'z',
      ownerUsername: 'a',
      requesterUsername: 'b',
    }),
    false
  );
});

test('buildQualityAuditsFilter optional route', () => {
  const withRoute = buildQualityAuditsFilter({ route: 'bi', tenantId: 't', limit: 5 });
  assert.match(withRoute.whereSql, /route =/);
  assert.ok(withRoute.params.includes('bi'));
  const noRoute = buildQualityAuditsFilter({ tenantId: 't' });
  assert.doesNotMatch(noRoute.whereSql, /route =/);
});

test('listEvalSuiteRuns passes tenant + limit', async () => {
  let seen;
  const pool = {
    async query(sql, params) {
      seen = { sql, params };
      return { rows: [{ id: 1 }] };
    },
  };
  const rows = await listEvalSuiteRuns(pool, 'tenant-a', 3);
  assert.equal(rows.length, 1);
  assert.deepEqual(seen.params, [3, 'tenant-a']);
});

test('resolveAutonomousTask: missing id / forbidden / ok', async () => {
  assert.equal((await resolveAutonomousTask({}, { id: '' })).status, 400);

  const forbiddenPool = {
    async query(sql) {
      if (String(sql).includes('SELECT owner_username')) {
        return { rows: [{ owner_username: 'a', requester_username: 'b' }] };
      }
      return { rows: [] };
    },
  };
  const denied = await resolveAutonomousTask(forbiddenPool, {
    id: '1',
    role: 'staff',
    username: 'z',
  });
  assert.equal(denied.status, 403);

  let updated = false;
  const okPool = {
    async query(sql) {
      if (String(sql).includes('SELECT owner_username')) {
        return { rows: [{ owner_username: 'z', requester_username: 'b' }] };
      }
      if (String(sql).includes('UPDATE')) {
        updated = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const ok = await resolveAutonomousTask(okPool, {
    id: '1',
    role: 'staff',
    username: 'z',
    note: 'done',
    tenantId: 'default',
  });
  assert.equal(ok.ok, true);
  assert.equal(updated, true);
});
