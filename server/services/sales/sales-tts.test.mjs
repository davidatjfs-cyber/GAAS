import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashscopeTtsHttpUrl,
  buildDashscopeTtsWsUrl,
  buildNaturalSpeechDirection,
  buildTaggedSpeechText,
  buildTtsCandidateConfigs,
  buildTtsParameters,
  prepareSpeechText,
  stableRolloutBucket,
  stripUnknownSpeechTags,
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
  assert.match(direction.instruction, /不要播音腔|逐字朗读/);
  assert.match(direction.instruction, /日常聊天/);
  assert.match(direction.instruction, /不要念标题或编号/);
  assert.ok(direction.instruction.length <= 100);
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

test('未知内联标签必须剥掉——模型不支持的标签会被逐字念出来', () => {
  assert.equal(stripUnknownSpeechTags('[breath]好的[bogus_tag]，没问题。'), '[breath]好的，没问题。');
  assert.equal(stripUnknownSpeechTags('[sighs]我理解。'), '[sighs]我理解。');
});

test('共情语气加叹气，长解释在首句后换气，短句不加标签', () => {
  assert.equal(buildTaggedSpeechText('我理解您的顾虑。', 'empathy'), '[sighs]我理解您的顾虑。');

  const long = '这个功能可以直接对接您现在的收银系统。装好之后每天的营业额和菜品销量都会自动汇总，不用人工去导表。';
  const tagged = buildTaggedSpeechText(long, 'explain');
  assert.match(tagged, /\[breath\]/);
  assert.equal(tagged.replace('[breath]', ''), long);

  assert.equal(buildTaggedSpeechText('好的，没问题。', 'quick'), '好的，没问题。');
});

test('标签灰度关闭时不产生标签候选，打开时标签候选排在无标签候选之前', () => {
  const off = buildTtsCandidateConfigs('我理解您的顾虑。', { rolloutKey: 'c1', rolloutPercent: 100, tagPercent: 0, baseConfig: {} });
  assert.deepEqual(off.map((c) => c.variant), ['natural_v1', 'natural_fallback']);

  const on = buildTtsCandidateConfigs('我理解您的顾虑。', { rolloutKey: 'c1', rolloutPercent: 100, tagPercent: 100, baseConfig: {} });
  assert.deepEqual(on.map((c) => c.variant), ['natural_v1_tag', 'natural_v1', 'natural_fallback']);
  assert.equal(on[0].speechText, '[sighs]我理解您的顾虑。');
  assert.equal(on[0].tagged, true);
  // 标签候选失败必须能退回同音色的无标签版本，否则一个不支持的标签会毁掉整通语音
  assert.equal(on[1].model, on[0].model);
  assert.equal(on[1].speechText, undefined);
});
