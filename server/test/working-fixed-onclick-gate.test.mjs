/**
 * P5.1 棘轮：working-fixed.html 中 inline onclick= 只减不增。
 * 统计全文件 onclick= 子串（HTML 属性 + JS 模板字符串中的属性片段）。
 * 新 UI 禁止新增 inline onclick — 在 frontend/src/pages/*.js 用 addEventListener 绑定。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../../working-fixed.html');

/** 冻结基线（2026-07-26 P5.1 静态 HTML 零参/单参 onclick 批量迁移 data-click+data-arg 委托后实测 rg -o 'onclick=' working-fixed.html | wc -l） */
const MAX_ONCLICK = 157;

function countOnclickAttributes(content) {
  return (content.match(/onclick=/g) || []).length;
}

test('working-fixed.html inline onclick count must not grow', () => {
  const content = fs.readFileSync(htmlPath, 'utf8');
  const count = countOnclickAttributes(content);
  assert.ok(
    count <= MAX_ONCLICK,
    `working-fixed.html has ${count} onclick= occurrences (max ${MAX_ONCLICK}). ` +
      'Do not add inline onclick — bind events in frontend/src/pages/*.js instead.',
  );
});
