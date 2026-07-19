import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashscopeTtsHttpUrl,
  buildDashscopeTtsWsUrl,
  buildNaturalSpeechDirection,
  buildTtsCandidateConfigs,
  buildTtsParameters,
  prepareSpeechText,
  stableRolloutBucket,
} from './sales-tts.js';

test('buildDashscopeTtsWsUrl adds wss protocol and inference path to a workspace host', () => {
  assert.equal(
    buildDashscopeTtsWsUrl('workspace.cn-beijing.maas.aliyuncs.com'),
    'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
  );
});

test('buildDashscopeTtsWsUrl preserves a complete workspace websocket URL', () => {
  assert.equal(
    buildDashscopeTtsWsUrl('wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'),
    'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
  );
});

test('buildDashscopeTtsWsUrl rejects insecure or unrelated endpoints', () => {
  assert.throws(() => buildDashscopeTtsWsUrl('https://workspace.cn-beijing.maas.aliyuncs.com'), /host_invalid/);
  assert.throws(() => buildDashscopeTtsWsUrl('wss://workspace.cn-beijing.maas.aliyuncs.com/wrong'), /host_invalid/);
});

test('buildDashscopeTtsWsUrl rejects missing configuration', () => {
  assert.throws(() => buildDashscopeTtsWsUrl(''), /host_missing/);
});

test('buildDashscopeTtsHttpUrl maps the configured workspace to the supported HTTP synthesizer', () => {
  assert.equal(
    buildDashscopeTtsHttpUrl('wss://dashscope.aliyuncs.com/api-ws/v1/inference'),
    'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'
  );
});

test('高拟真语音默认使用Qwen Audio Plus自然亲切音色与会话指令', () => {
  const params = buildTtsParameters({});
  assert.equal(params.model, 'qwen-audio-3.0-tts-plus');
  assert.equal(params.voice, 'longanlingxin');
  assert.match(params.parameters.instruction, /真人|自然/);
  assert.match(params.parameters.instruction, /不要播音腔|避免播音腔/);
  assert.ok(params.parameters.rate < 1);
});

test('语音前处理要把技术缩写转成自然口语读法', () => {
  assert.equal(
    prepareSpeechText('先评估POS数据，再选1-2家店做30天试跑。'),
    '先评估P O S数据，再选一到两家店做三十天试跑。'
  );
});

test('动态语气只改变TTS表达参数，不改回复文字', () => {
  const direction = buildNaturalSpeechDirection('我理解您的顾虑，这里确实需要先说明清楚。');
  assert.equal(direction.tone, 'empathy');
  assert.ok(direction.rate < 0.96);
  assert.match(direction.instruction, /不改变原文含义/);
});

test('功能讲解使用聊天语速，并明确禁止念说明书', () => {
  const direction = buildNaturalSpeechDirection('具体操作步骤和流程我给您解释一下，这项功能会记录相关数据。');
  assert.equal(direction.tone, 'explain');
  assert.equal(direction.rate, 1);
  assert.match(direction.instruction, /不是在朗读|不是照着文字念/);
  assert.match(direction.instruction, /说明书腔/);
  assert.match(direction.instruction, /不要放慢成培训授课/);
});

test('小流量分组对同一个客户保持稳定', () => {
  assert.equal(stableRolloutBucket('customer-123'), stableRolloutBucket('customer-123'));
  assert.equal(stableRolloutBucket(''), 100);
});

test('0%保持当前基线，100%使用胜出音色并配置当前音色动态回退', () => {
  const baseline = buildTtsCandidateConfigs('好的。', { rolloutKey: 'customer-1', rolloutPercent: 0, baseConfig: { model: 'current', voice: 'current' } });
  assert.deepEqual(baseline.map((item) => item.variant), ['baseline']);

  const natural = buildTtsCandidateConfigs('具体可以先评估数据。', { rolloutKey: 'customer-1', rolloutPercent: 100, baseConfig: {} });
  assert.equal(natural[0].model, 'qwen-audio-3.0-tts-flash');
  assert.equal(natural[0].voice, 'longanxiaoxin');
  assert.equal(natural[0].variant, 'natural_v1');
  assert.equal(natural[1].model, 'qwen-audio-3.0-tts-plus');
  assert.equal(natural[1].voice, 'longanlingxin');
  assert.equal(natural[1].variant, 'natural_fallback');

  const naturalWithoutKey = buildTtsCandidateConfigs('好的。', { rolloutPercent: 100, baseConfig: {} });
  assert.equal(naturalWithoutKey[0].variant, 'natural_v1');
});
