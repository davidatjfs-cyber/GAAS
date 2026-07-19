import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymizeSpeechText, buildSpeechDirection, classifySpeechTone, prepareSpeechText } from './customer-voice-eval.mjs';

test('anonymizes private contact details before generating samples', () => {
  const value = anonymizeSpeechText('请联系13800138000，邮箱 test@example.com，https://example.com/a');
  assert.equal(value, '请联系[手机号]，邮箱 [邮箱]，[链接]');
});

test('keeps reply meaning while normalizing speech-only pronunciation', () => {
  assert.equal(prepareSpeechText('先看POS数据，选1-2家店做30天试用。'), '先看P O S数据，选一到两家店做三十天试用。');
});

test('routes explanations and concerns to different delivery directions', () => {
  assert.equal(classifySpeechTone('我理解您的顾虑，这里确实需要先说明清楚。'), 'empathy');
  assert.equal(classifySpeechTone('具体可以先评估3家店的数据，再确定试用方案。'), 'explain');
  assert.notEqual(buildSpeechDirection('我理解您的顾虑。').instruction, buildSpeechDirection('具体分为三个步骤。').instruction);
});

test('baseline remains the exact current production direction', () => {
  const direction = buildSpeechDirection('任意文本', 'static');
  assert.equal(direction.tone, 'baseline');
  assert.equal(direction.rate, 0.96);
  assert.match(direction.instruction, /轻微呼吸感/);
});
