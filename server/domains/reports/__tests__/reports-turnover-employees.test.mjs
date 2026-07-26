/**
 * turnover-employees.js — loadOffboardingDeparted 单测（mock pool）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOffboardingDeparted } from '../turnover-employees.js';

function safeDateOnly(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

test('loadOffboardingDeparted: 解析 payload / 主动被动 / 去重', async () => {
  const pool = {
    query: async (sql, params) => {
      assert.match(String(sql), /approval_requests/);
      assert.deepEqual(params, ['2026-07', 'default']);
      return {
        rows: [
          {
            applicant_username: 'Alice',
            status: 'approved',
            payload: {
              resignDate: '2026-07-10',
              reason: '个人原因',
              departureType: 'voluntary',
            },
          },
          {
            applicant_username: 'bob',
            status: 'pending',
            payload: JSON.stringify({
              date: '2026-07-15',
              reason: '劝退',
              departureType: 'involuntary',
            }),
          },
          {
            applicant_username: 'bob',
            status: 'approved',
            payload: { resignDate: '2026-07-20', reason: '重复应跳过' },
          },
          {
            applicant_username: 'carol',
            status: 'approved',
            payload: { resignDate: '2026-07-18', reason: '裁员' },
          },
        ],
      };
    },
  };

  const map = await loadOffboardingDeparted(pool, '2026-07', 'default', safeDateOnly);

  assert.equal(map.size, 3);
  assert.equal(map.get('alice')?.resignDate, '2026-07-10');
  assert.equal(map.get('alice')?.isVoluntary, true);

  assert.equal(map.get('bob')?.resignDate, '2026-07-15');
  assert.equal(map.get('bob')?.isVoluntary, false);

  assert.equal(map.get('carol')?.isVoluntary, false);
});

test('loadOffboardingDeparted: query 失败返回空 Map', async () => {
  const pool = {
    query: async () => {
      throw new Error('db down');
    },
  };

  const map = await loadOffboardingDeparted(pool, '2026-07', 'default', safeDateOnly);
  assert.equal(map.size, 0);
});

test('loadOffboardingDeparted: 被动离职由 reason 关键词推断', async () => {
  const pool = {
    query: async () => ({
      rows: [
        {
          applicant_username: 'dave',
          payload: { resignDate: '2026-07-05', reason: '因业绩不达标被辞退' },
        },
      ],
    }),
  };

  const map = await loadOffboardingDeparted(pool, '2026-07', 'default', safeDateOnly);
  assert.equal(map.get('dave')?.isVoluntary, false);
});
