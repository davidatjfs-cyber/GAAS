import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTimeRangeFromText, parseTimeRange } from '../time-range.js';
import {
  extractTimeRangeFromText as facadeExtractTimeRangeFromText,
  parseTimeRange as facadeParseTimeRange,
} from '../../../data-executor.js';

function todayParts() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

test('data-executor facade preserves time-range public exports', () => {
  assert.equal(facadeParseTimeRange, parseTimeRange);
  assert.equal(facadeExtractTimeRangeFromText, extractTimeRangeFromText);
});

test('parseTimeRange handles default, month, range, day, and opaque input', () => {
  const { year, month, day } = todayParts();
  const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  assert.deepEqual(parseTimeRange(), { start: today, end: today, label: '今天' });
  assert.deepEqual(parseTimeRange('2026-02'), {
    start: '2026-02-01',
    end: '2026-02-28',
    label: '2026年02月',
  });
  assert.deepEqual(parseTimeRange('2024-02'), {
    start: '2024-02-01',
    end: '2024-02-29',
    label: '2024年02月',
  });
  assert.deepEqual(parseTimeRange('2026-02-01~2026-02-28'), {
    start: '2026-02-01',
    end: '2026-02-28',
    label: '2026-02-01 至 2026-02-28',
  });
  assert.deepEqual(parseTimeRange('2026-02-14'), {
    start: '2026-02-14',
    end: '2026-02-14',
    label: '2026-02-14',
  });
  assert.deepEqual(parseTimeRange('自定义期间'), {
    start: '自定义期间',
    end: '自定义期间',
    label: '自定义期间',
  });
});

test('extractTimeRangeFromText recognizes explicit date ranges', () => {
  const { year, month } = todayParts();

  assert.deepEqual(extractTimeRangeFromText('查2月15日到22日'), {
    timeRange: `${year}-02-15~${year}-02-22`,
    label: '2月15日-22日',
  });
  assert.deepEqual(extractTimeRangeFromText('查15号至22号'), {
    timeRange: `${year}-${String(month).padStart(2, '0')}-15~${year}-${String(month).padStart(2, '0')}-22`,
    label: `${month}月15日-22日`,
  });
  assert.deepEqual(extractTimeRangeFromText('查2月15日-3月22日'), {
    timeRange: `${year}-02-15~${year}-03-22`,
    label: '2月15日-3月22日',
  });
});

test('extractTimeRangeFromText recognizes relative days and weeks', () => {
  const today = new Date();
  const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dayMs = 86400000;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  assert.deepEqual(extractTimeRangeFromText('今天营收').label, '今日');
  assert.deepEqual(extractTimeRangeFromText('昨天营收').label, '昨日');
  assert.deepEqual(extractTimeRangeFromText('前天营收').label, '前天');

  const dow = midnight.getDay() || 7;
  const lastMonday = new Date(+midnight - (dow - 1 + 7) * dayMs);
  assert.deepEqual(extractTimeRangeFromText('上周营收'), {
    timeRange: `${format(lastMonday)}~${format(new Date(+lastMonday + 6 * dayMs))}`,
    label: '上周',
  });
  assert.deepEqual(extractTimeRangeFromText('本周营收'), {
    timeRange: `${format(new Date(+midnight - (dow - 1) * dayMs))}~${format(midnight)}`,
    label: '本周',
  });
});

test('extractTimeRangeFromText recognizes months, rolling ranges, and fallback', () => {
  const { year, month, day } = todayParts();
  const today = new Date(year, month - 1, day);
  const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const previousMonthEnd = new Date(year, month - 1, 0);

  assert.deepEqual(extractTimeRangeFromText('上个月营收'), {
    timeRange: `${format(new Date(previousMonthEnd.getFullYear(), previousMonthEnd.getMonth(), 1))}~${format(previousMonthEnd)}`,
    label: '上月',
  });
  assert.deepEqual(extractTimeRangeFromText('本月营收'), {
    timeRange: `${year}-${String(month).padStart(2, '0')}-01~${format(today)}`,
    label: '本月',
  });
  assert.deepEqual(extractTimeRangeFromText('近 10 天营收'), {
    timeRange: `${format(new Date(+today - 9 * 86400000))}~${format(today)}`,
    label: '近10天',
  });
  assert.deepEqual(extractTimeRangeFromText('二月营收'), {
    timeRange: `${year}-02-01~${year}-02-${new Date(year, 2, 0).getDate()}`,
    label: '2月',
  });
  assert.deepEqual(extractTimeRangeFromText('3月1号营收'), {
    timeRange: `${year}-03-01~${year}-03-01`,
    label: '3月1日',
  });
  assert.deepEqual(extractTimeRangeFromText('11月营收'), {
    timeRange: `${year}-11-01~${year}-11-30`,
    label: '11月',
  });
  assert.deepEqual(extractTimeRangeFromText('没有日期'), {
    timeRange: `${format(new Date(+today - 6 * 86400000))}~${format(today)}`,
    label: '近7天',
  });
});
