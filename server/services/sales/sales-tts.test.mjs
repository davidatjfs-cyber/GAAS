import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashscopeTtsHttpUrl, buildDashscopeTtsWsUrl, buildTtsParameters, prepareSpeechText } from './sales-tts.js';

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
