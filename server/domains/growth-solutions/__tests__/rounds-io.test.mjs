import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestAssignees, getOpenRound, getClosedRounds } from '../rounds-io.js';

function mockPool(handlers) {
  let callIndex = 0;
  return () => ({
    query: async (sql, params) => {
      const handler = handlers[callIndex];
      callIndex += 1;
      if (typeof handler === 'function') return handler(sql, params);
      if (handler) return handler;
      throw new Error(`unexpected query #${callIndex}: ${String(sql).slice(0, 80)}`);
    },
  });
}

test('suggestAssignees sorts by ROLE_POSITIONS priority for store_manager', async () => {
  const getPool = mockPool([
    {
      rows: [
        { username: 'u1', name: '主管甲', position: '前厅主管' },
        { username: 'u2', name: '店长乙', position: '店长' },
        { username: 'u3', name: '经理丙', position: '前厅经理' },
      ],
    },
  ]);
  const out = await suggestAssignees(getPool, '马己仙旗舰店', 'store_manager');
  assert.deepEqual(out.map((r) => r.username), ['u2', 'u1', 'u3']);
});

test('suggestAssignees falls back to store_manager positions for unknown role', async () => {
  const getPool = mockPool([
    {
      rows: [{ username: 'u1', name: '店长', position: '店长' }],
    },
  ]);
  const out = await suggestAssignees(getPool, '洪潮店', 'unknown_role');
  assert.equal(out.length, 1);
  assert.equal(out[0].username, 'u1');
});

test('getOpenRound returns round with tasks attached', async () => {
  const getPool = mockPool([
    { rows: [{ id: 10, store: '洪潮店', problem_key: 'revenue', status: 'active' }] },
    { rows: [{ id: 101, title: '任务A', status: 'pending' }] },
  ]);
  const round = await getOpenRound(getPool, '洪潮店', 'revenue');
  assert.equal(round.id, 10);
  assert.equal(round.tasks.length, 1);
  assert.equal(round.tasks[0].title, '任务A');
});

test('getOpenRound returns null when no open round', async () => {
  const getPool = mockPool([{ rows: [] }]);
  const round = await getOpenRound(getPool, '洪潮店', 'revenue');
  assert.equal(round, null);
});

test('getClosedRounds returns closed rounds ordered by round_no', async () => {
  const getPool = mockPool([
    {
      rows: [
        { id: 1, round_no: 1, status: 'closed' },
        { id: 2, round_no: 2, status: 'closed' },
      ],
    },
  ]);
  const rows = await getClosedRounds(getPool, '洪潮店', 'revenue');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].round_no, 1);
});
