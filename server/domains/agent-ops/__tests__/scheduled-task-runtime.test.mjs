import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInspectionIntervalDays,
  isBlockedOpsChecklistPattern,
  normalizeDigitsForOpsFilter,
  shouldSkipHrmsScheduledChecklistBody,
} from '../scheduled-task-runtime-helpers.js';
import { createScheduledTaskRuntimeApi } from '../scheduled-task-runtime.js';

test('normalizeDigitsForOpsFilter converts full-width digits', () => {
  assert.equal(normalizeDigitsForOpsFilter('测试１１２２３３检查'), '测试112233检查');
});

test('isBlockedOpsChecklistPattern blocks test/legacy patterns', () => {
  assert.equal(isBlockedOpsChecklistPattern('测试112233检查'), true);
  assert.equal(isBlockedOpsChecklistPattern('开市检查'), false);
  assert.equal(isBlockedOpsChecklistPattern('agent-v1'), true);
  assert.equal(isBlockedOpsChecklistPattern('测试'), true);
});

test('shouldSkipHrmsScheduledChecklistBody defaults to skip unless legacy enabled', () => {
  const logs = [];
  assert.equal(shouldSkipHrmsScheduledChecklistBody({ checkType: '开市' }, { env: {}, log: { info: (...a) => logs.push(a) } }), true);
  assert.equal(
    shouldSkipHrmsScheduledChecklistBody(
      { checkType: '开市' },
      { env: { HRMS_ENABLE_LEGACY_SCHEDULED_CHECKLIST: '1' }, log: { info() {} } }
    ),
    false
  );
  assert.equal(
    shouldSkipHrmsScheduledChecklistBody(
      { checkType: '开市' },
      { env: { HRMS_ENABLE_LEGACY_SCHEDULED_CHECKLIST: '1', HRMS_DISABLE_SCHEDULED_CHECKLIST: 'true' }, log: { info() {} } }
    ),
    true
  );
});

test('getInspectionIntervalDays maps frequencies', () => {
  assert.equal(getInspectionIntervalDays({ frequency: 'daily' }), 1);
  assert.equal(getInspectionIntervalDays({ frequency: 'weekly' }), 7);
  assert.equal(getInspectionIntervalDays({ frequency: 'custom', customIntervalDays: 3 }), 3);
});

test('startScheduledTasks registers fixed/random timers and status', async () => {
  const timers = [];
  const executed = [];
  const api = createScheduledTaskRuntimeApi({
    refreshOpsAgentRuntimeConfig: async () => {},
    buildScheduledTasksFromConfig: () => ({
      fixed_a: { action: 'checklist', time: '10:00', frequency: 'daily' },
      rand_b: { action: 'safety', random: true, interval: [1, 2] },
    }),
    executeScheduledTask: async (key) => { executed.push(key); },
    log: { info() {} },
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeoutFn: () => {},
    nowFn: () => new Date('2026-07-26T02:00:00.000Z'), // CST 10:00 already passed → next day
    randomFn: () => 0,
  });

  await api.startScheduledTasks();
  const status = api.getScheduledTaskStatus();
  assert.equal(status.activeTimers, 2);
  assert.equal(status.tasks.length, 2);
  assert.ok(status.tasks.every((t) => t.nextExecutionAt));
  assert.equal(api.isBlockedOpsChecklistPattern('测试112233'), true);
  assert.equal(api.shouldSkipHrmsScheduledChecklist({ checkType: '开市' }), true);
});
