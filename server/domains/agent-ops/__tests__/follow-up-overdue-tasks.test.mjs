import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollowUpOverdueTasks } from '../follow-up-overdue-tasks.js';

test('followUpOverdueTasks reminds and updates reminder_count', async () => {
  const updates = [];
  const sent = [];
  const followUp = createFollowUpOverdueTasks({
    pool: () => ({
      query: async (sql, params) => {
        if (/FROM master_tasks/i.test(sql)) {
          return {
            rows: [
              {
                id: 9,
                assignee_username: 'bob',
                title: '巡店',
                open_id: 'ou_bob',
                created_at: new Date(Date.now() - 120 * 60_000).toISOString(),
                reminder_count: 0,
              },
            ],
          };
        }
        if (/UPDATE master_tasks/i.test(sql)) {
          updates.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      },
    }),
    getOpsAgentConfig: () => ({
      loopManagement: { followUpRules: { maxReminders: 3, firstReminder: 60 } },
    }),
    sendLarkMessage: async (openId, text) => {
      sent.push({ openId, text });
    },
    prefixWithAgentName: (_r, t) => t,
    log: { error() {} },
  });

  const out = await followUp();
  assert.equal(out.length, 1);
  assert.equal(out[0].taskId, 9);
  assert.equal(sent.length, 1);
  assert.equal(updates.length, 1);
});
