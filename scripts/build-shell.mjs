#!/usr/bin/env node
// 第二层缓存方案：把 working-fixed.html 里的主 CSS / 主 JS 抽成内容哈希命名的外链文件。
// 文件名带 sha256 短哈希 + nginx immutable 头 => 内容不变永不重下，内容变了文件名变 => 自动失效。
// JS 真源在 frontend/src/pages/；先 bundle 进 working-fixed.html，再抽 shell。

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'working-fixed.html');
const DIST = join(ROOT, 'dist');

// 先把 frontend/src/pages 拼回 working-fixed.html 主 script（物理切分源）。
execFileSync(process.execPath, [join(__dirname, 'bundle-frontend.mjs')], { stdio: 'inherit' });

const STYLE_OPEN = '\n    <style>\n';
const STYLE_CLOSE = '\n    </style>\n';
const SCRIPT_OPEN = '\n    <script>\n';
const SCRIPT_CLOSE = '\n    </script>\n';

function extractUnique(html, openTag, closeTag, label) {
  const openIdx = html.indexOf(openTag);
  if (openIdx === -1) throw new Error(`找不到 ${label} 起始锚点`);
  if (html.indexOf(openTag, openIdx + 1) !== -1) throw new Error(`${label} 起始锚点不唯一，抽取不安全`);
  const closeIdx = html.indexOf(closeTag, openIdx);
  if (closeIdx === -1) throw new Error(`找不到 ${label} 结束锚点`);
  if (html.indexOf(closeTag, closeIdx + 1) !== -1) throw new Error(`${label} 结束锚点不唯一，抽取不安全`);
  const inner = html.slice(openIdx + openTag.length, closeIdx);
  return { inner, openIdx, closeIdx, openTag, closeTag };
}

function hash8(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

const html = readFileSync(SRC, 'utf8');

const css = extractUnique(html, STYLE_OPEN, STYLE_CLOSE, 'CSS');
const js = extractUnique(html, SCRIPT_OPEN, SCRIPT_CLOSE, 'JS');

const cssHash = hash8(css.inner);
const jsHash = hash8(js.inner);
const cssName = `app.${cssHash}.css`;
const jsName = `app.${jsHash}.js`;

let shell =
  html.slice(0, css.openIdx) +
  `\n    <link rel="stylesheet" href="/${cssName}">\n` +
  html.slice(css.closeIdx + STYLE_CLOSE.length);

const js2 = extractUnique(shell, SCRIPT_OPEN, SCRIPT_CLOSE, 'JS(after css replace)');
shell =
  shell.slice(0, js2.openIdx) +
  `\n    <script src="/${jsName}"></script>\n` +
  shell.slice(js2.closeIdx + SCRIPT_CLOSE.length);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, cssName), css.inner);
writeFileSync(join(DIST, jsName), js.inner);
writeFileSync(join(DIST, 'working-fixed.html'), shell);

try {
  execFileSync(process.execPath, ['--check', join(DIST, jsName)], { stdio: 'pipe' });
} catch (e) {
  throw new Error(`抽取出的 JS 语法检查失败：\n${e.stderr || e.message}`);
}

const written = readdirSync(DIST);
console.log('构建完成 dist/：');
for (const f of written) console.log('  -', f);
console.log(`CSS: ${cssName} (${(css.inner.length / 1024).toFixed(0)} KB)`);
console.log(`JS:  ${jsName} (${(js.inner.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`shell working-fixed.html (${(shell.length / 1024).toFixed(0)} KB)`);
