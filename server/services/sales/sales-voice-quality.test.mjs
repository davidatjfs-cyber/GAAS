import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeVoiceRows } from './sales-voice-quality.js';

const row = (variant, tone, replySeconds, nextInputMode) => ({
  variant, tone, tagged: variant?.endsWith('_tag') || false,
  reply_seconds: replySeconds, next_input_mode: nextInputMode,
});

test('按变体统计发送量、回复率和语音回复率', () => {
  const report = summarizeVoiceRows([
    row('natural_v1', 'explain', 30, 'voice'),
    row('natural_v1', 'explain', 90, 'text'),
    row('natural_v1', 'quick', null, null),
    row('baseline', 'explain', 60, 'text'),
  ]);

  const natural = report.by_variant.find((b) => b.key === 'natural_v1');
  assert.equal(natural.sent, 3);
  assert.equal(natural.replied, 2);
  assert.equal(natural.replied_voice, 1);
  assert.equal(natural.reply_rate, 0.667);
  assert.equal(natural.voice_reply_rate, 0.333);
  assert.equal(natural.median_reply_seconds, 60);

  assert.equal(report.overall.sent, 4);
  assert.equal(report.overall.replied, 3);
});

test('超出回复窗口的后续消息不算被这条语音带动', () => {
  const report = summarizeVoiceRows([row('natural_v1', 'explain', 40 * 3600, 'text')], { replyWindowHours: 24 });
  assert.equal(report.overall.sent, 1);
  assert.equal(report.overall.replied, 0);
  assert.equal(report.overall.reply_rate, 0);
  assert.equal(report.overall.median_reply_seconds, null);
});

test('没有语音投递时不炸，比率返回 null 而不是 0 或 NaN', () => {
  const report = summarizeVoiceRows([]);
  assert.equal(report.overall.sent, 0);
  assert.equal(report.overall.reply_rate, null);
  assert.deepEqual(report.by_variant, []);
});

test('缺失变体标记的历史数据归入 unknown，不被静默丢弃', () => {
  const report = summarizeVoiceRows([row(null, null, 10, 'voice')]);
  assert.equal(report.by_variant[0].key, 'unknown');
  assert.equal(report.by_tone[0].key, 'unknown');
  assert.equal(report.overall.replied_voice, 1);
});
