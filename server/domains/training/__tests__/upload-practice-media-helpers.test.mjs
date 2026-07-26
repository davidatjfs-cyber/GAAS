import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePracticeMediaType,
  buildRubricScoringPrompt,
  buildJudgmentPrompt,
} from '../upload-practice-media-helpers.js';

test('resolvePracticeMediaType: video extensions', () => {
  assert.equal(resolvePracticeMediaType('.mp4'), 'video');
  assert.equal(resolvePracticeMediaType('.MOV'), 'video');
  assert.equal(resolvePracticeMediaType('.webm'), 'video');
});

test('resolvePracticeMediaType: image fallback', () => {
  assert.equal(resolvePracticeMediaType('.jpg'), 'image');
  assert.equal(resolvePracticeMediaType('.png'), 'image');
});

test('buildRubricScoringPrompt includes dish and threshold', () => {
  const prompt = buildRubricScoringPrompt({
    dish_name: '宫保鸡丁',
    station: '热菜',
    items: [{ action: '切配', weight: 10, checks: ['均匀'] }],
    fail_criteria: ['生熟不分'],
    pass_threshold: 85,
  }, '实操一', 'video');
  assert.match(prompt, /宫保鸡丁/);
  assert.match(prompt, /85/);
  assert.match(prompt, /完整视频/);
});

test('buildJudgmentPrompt includes practice task', () => {
  const prompt = buildJudgmentPrompt({ practice_task: '摆盘', key_points: ['整洁'] });
  assert.match(prompt, /摆盘/);
  assert.match(prompt, /整洁/);
});
