/**
 * B2 棘轮：working-fixed.html 总行数只减不增。
 * 新 UI 逻辑应写入 frontend/src/pages/*.js，经 bundle-frontend 拼回，勿直接堆 inline script。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../../working-fixed.html');

/**
 * 冻结基线（2026-07-23 P3 build:shell 后 wc -l working-fixed.html）。
 * 2026-07-28 一次性上调：新增 frontend/src/pages/15-workspace.js（角色工作台 Phase 1，
 * 含 boss/hq/store/employee/hq_hr 五个 persona 视图 + 一键执行封装 + JS 注入的容器/样式/
 * 导航入口，避免直接堆内联 HTML/CSS）。这是通过正规 frontend/src/pages 结构新增的真实
 * 功能，不是绕过棘轮的偷懒堆砌——按棘轮精神仍然「只减不增」：此后任何改动都不得让总行数
 * 超过这个新基线，除非同样是一次经过说明的、刻意的上调。
 */
const MAX_LINES = 69481;

test('working-fixed.html line count must not grow', () => {
  const content = fs.readFileSync(htmlPath, 'utf8');
  const lineCount = (content.match(/\n/g) || []).length;
  assert.ok(
    lineCount <= MAX_LINES,
    `working-fixed.html has ${lineCount} lines (max ${MAX_LINES}). ` +
      'Do not add inline script/HTML here — put new UI in frontend/src/pages/*.js and bundle.',
  );
});
