/**
 * 闸门：platform-admin.html 必须在调用 bindSalesSimVoice() 之前初始化 state.salesSim.voice。
 * 回归背景：2026-08-07 线上事故——顶层绑定阶段(3661行)先调用 bindSalesSimVoice()，
 * 而 state.salesSim 到 4923 行才初始化，页面加载即抛
 * "TypeError: undefined is not an object (evaluating 'state.salesSim.voice')"，
 * 导致该 <script> 内其后所有 onclick 绑定(销售CRM/创建任务等)全部失效。
 * 修复：把 salesSim 初始化收进顶层 state 字面量(1337行起)，保证绑定前必存在。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../../platform-admin.html');

test('platform-admin: state.salesSim(含 voice) 初始化必须先于 bindSalesSimVoice() 调用', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const initMark = 'salesSim: { sessionId: null, messages: [], voice: { recorder: null, chunks: [], stream: null, startedAt: 0, timer: null, phase: \'idle\' } }';
  const bindCallMark = 'bindSalesSimVoice();';
  const voiceReadMark = 'const v = state.salesSim.voice;';

  const initIdx = html.indexOf(initMark);
  const bindIdx = html.indexOf(bindCallMark);
  const voiceIdx = html.indexOf(voiceReadMark);

  assert.ok(initIdx >= 0, 'platform-admin.html 缺少 state.salesSim 初始化（含 voice 字段）');
  assert.ok(bindIdx >= 0, 'platform-admin.html 缺少 bindSalesSimVoice() 调用');
  assert.ok(voiceIdx >= 0, 'platform-admin.html 缺少 state.salesSim.voice 读取点');
  assert.ok(
    initIdx < bindIdx && initIdx < voiceIdx,
    `初始化顺序错误：salesSim 初始化(${initIdx}) 必须早于 bindSalesSimVoice() 调用(${bindIdx}) 和 voice 读取(${voiceIdx})`
  );
});
