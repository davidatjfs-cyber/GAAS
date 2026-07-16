import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashscopeTtsWsUrl } from './sales-tts.js';

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
