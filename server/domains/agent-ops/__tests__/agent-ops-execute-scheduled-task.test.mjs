import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExecuteScheduledTask,
  isWithinWorkingHours,
} from '../execute-scheduled-task.js';

test('isWithinWorkingHours shanghai window', () => {
  // 2026-07-26 10:00 CST = 02:00 UTC
  assert.equal(isWithinWorkingHours(() => Date.parse('2026-07-26T02:00:00.000Z')), true);
  // 07:00 CST = previous day 23:00 UTC
  assert.equal(isWithinWorkingHours(() => Date.parse('2026-07-25T23:00:00.000Z')), false);
});

function makeExec(overrides = {}) {
  const statusMap = new Map();
  const calls = { checklist: 0, safety: 0, refresh: 0 };
  const exec = createExecuteScheduledTask({
    sendScheduledChecklist: async () => {
      calls.checklist++;
    },
    sendSafetyCheck: async () => {
      calls.safety++;
    },
    refreshOpsAgentRuntimeConfig: async () => {
      calls.refresh++;
    },
    buildScheduledTasksFromConfig: () => ({
      'daily_opening': { action: 'send_checklist', checkType: 'opening' },
    }),
    isBlockedOpsChecklistPattern: () => false,
    getOpsAgentConfig: () => ({
      scheduledTasks: {
        randomInspections: [
          {
            enabled: true,
            type: '冷柜',
            description: '查温度',
            timeWindow: 20,
            store: '洪潮久光店',
            brand: '洪潮',
            assigneeRoles: ['store_manager'],
          },
        ],
      },
    }),
    scheduledTaskRuntimeStatus: statusMap,
    env: {},
    nowFn: () => Date.parse('2026-07-26T02:00:00.000Z'), // 10:00 CST
    isWithinWorkingHoursFn: () => true,
    ...overrides,
  });
  return { exec, calls, statusMap };
}

test('skip outside working hours', async () => {
  const { exec, calls } = makeExec({ isWithinWorkingHoursFn: () => false });
  await exec('daily_opening', { action: 'send_checklist' });
  assert.equal(calls.checklist, 0);
});

test('skip when checklist env disabled', async () => {
  const { exec, calls } = makeExec({
    env: { HRMS_DISABLE_SCHEDULED_CHECKLIST: 'true' },
  });
  await exec('daily_opening', { action: 'send_checklist' });
  assert.equal(calls.checklist, 0);
});

test('stale checklist timer skipped', async () => {
  const { exec, calls } = makeExec({
    buildScheduledTasksFromConfig: () => ({}),
  });
  await exec('gone_task', { action: 'send_checklist' });
  assert.equal(calls.refresh, 1);
  assert.equal(calls.checklist, 0);
});

test('send_checklist happy path updates status', async () => {
  const { exec, calls, statusMap } = makeExec();
  await exec('daily_opening', { action: 'send_checklist' });
  assert.equal(calls.checklist, 1);
  assert.equal(statusMap.get('daily_opening').runCount, 1);
  assert.equal(statusMap.get('daily_opening').lastError, null);
});

test('safety_check random refresh + send', async () => {
  const { exec, calls } = makeExec();
  await exec('random_1', { action: 'safety_check', random: true });
  assert.equal(calls.safety, 1);
  assert.equal(calls.refresh, 1);
});

test('random inspection env disabled', async () => {
  const { exec, calls } = makeExec({
    env: { HRMS_DISABLE_RANDOM_INSPECTION: '1' },
  });
  await exec('random_1', { action: 'safety_check', random: true });
  assert.equal(calls.safety, 0);
});

test('random slot empty/disabled', async () => {
  const { exec, calls } = makeExec({
    getOpsAgentConfig: () => ({ scheduledTasks: { randomInspections: [] } }),
  });
  await exec('random_1', { action: 'safety_check', random: true });
  assert.equal(calls.safety, 0);
});

test('random blocked pattern', async () => {
  const { exec, calls } = makeExec({
    isBlockedOpsChecklistPattern: () => true,
  });
  await exec('random_1', { action: 'safety_check', random: true });
  assert.equal(calls.safety, 0);
});

test('unknown action', async () => {
  const { exec, statusMap } = makeExec();
  await exec('x', { action: 'noop' });
  assert.equal(statusMap.get('x').runCount, 1);
});

test('action throw records lastError', async () => {
  const { exec, statusMap } = makeExec({
    sendScheduledChecklist: async () => {
      throw new Error('boom');
    },
  });
  await exec('daily_opening', { action: 'send_checklist' });
  assert.match(statusMap.get('daily_opening').lastError, /boom/);
});

test('direct safety_check without random', async () => {
  const { exec, calls } = makeExec();
  await exec('s1', { action: 'safety_check' });
  assert.equal(calls.safety, 1);
  assert.equal(calls.refresh, 0);
});
