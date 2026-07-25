import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFromDailyReportStaff } from '../services/hrms-attendance-day.js';

test('classifyFromDailyReportStaff：上班 / 周休 / 未命中', () => {
  const staff = {
    front: [{ user: 'alice', days: 1 }],
    kitchen: [{ name: '厨师甲', days: 2 }],
    restStaff: [{ username: 'bob' }],
    frontRestStaff: [{ name: '小李' }],
  };
  assert.deepEqual(classifyFromDailyReportStaff(staff, 'Alice', ''), {
    onSchedule: true,
    onWeeklyRest: false,
    scheduleDays: 1,
    restDays: 0,
  });
  assert.deepEqual(classifyFromDailyReportStaff(staff, '', '厨师甲'), {
    onSchedule: true,
    onWeeklyRest: false,
    scheduleDays: 2,
    restDays: 0,
  });
  assert.deepEqual(classifyFromDailyReportStaff(staff, 'bob', ''), {
    onSchedule: false,
    onWeeklyRest: true,
    scheduleDays: 0,
    restDays: 1,
  });
  assert.deepEqual(classifyFromDailyReportStaff(staff, '', '小李'), {
    onSchedule: false,
    onWeeklyRest: true,
    scheduleDays: 0,
    restDays: 1,
  });
  assert.deepEqual(classifyFromDailyReportStaff(null, 'nobody', ''), {
    onSchedule: false,
    onWeeklyRest: false,
    scheduleDays: 0,
    restDays: 0,
  });
});
