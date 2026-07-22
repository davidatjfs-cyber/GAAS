#!/usr/bin/env node
/**
 * 把 frontend/src/pages/*.js 按 manifest 顺序拼接，写回 working-fixed.html 主 <script>。
 * 零模块化语法：仍是经典 script，全局函数可见性与切分前一致。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_HTML = join(ROOT, 'working-fixed.html');
const PAGES_DIR = join(ROOT, 'frontend/src/pages');
const MANIFEST = join(ROOT, 'frontend/src/pages.manifest.json');

const SCRIPT_OPEN = '\n    <script>\n';
const SCRIPT_CLOSE = '\n    </script>\n';
const BANNER =
  '/* bundled from frontend/src/pages — edit those files, then: node scripts/bundle-frontend.mjs */\n';

function extractMainScript(html) {
  const openIdx = html.indexOf(SCRIPT_OPEN);
  if (openIdx === -1) throw new Error('找不到主 script 起始锚点');
  if (html.indexOf(SCRIPT_OPEN, openIdx + 1) !== -1) throw new Error('主 script 起始锚点不唯一');
  const closeIdx = html.indexOf(SCRIPT_CLOSE, openIdx);
  if (closeIdx === -1) throw new Error('找不到主 script 结束锚点');
  if (html.indexOf(SCRIPT_CLOSE, closeIdx + 1) !== -1) throw new Error('主 script 结束锚点不唯一');
  return { openIdx, closeIdx };
}

function stripAutoHeader(raw) {
  return raw.replace(/^\/\* (AUTO-SPLIT|bundled)[\s\S]*?\*\/\n\n?/, '');
}

if (!existsSync(MANIFEST)) {
  console.error('缺少 frontend/src/pages.manifest.json，请先运行: node scripts/extract-frontend-pages.mjs');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const chunks = [];
for (const p of manifest.parts) {
  const path = join(PAGES_DIR, p.file);
  if (!existsSync(path)) throw new Error(`缺少页面文件: ${p.file}`);
  chunks.push(stripAutoHeader(readFileSync(path, 'utf8')).replace(/\n$/, ''));
}
const bundled = BANNER + chunks.join('\n');

const html = readFileSync(SRC_HTML, 'utf8');
const { openIdx, closeIdx } = extractMainScript(html);
const next =
  html.slice(0, openIdx) +
  SCRIPT_OPEN +
  bundled +
  SCRIPT_CLOSE +
  html.slice(closeIdx + SCRIPT_CLOSE.length);

writeFileSync(SRC_HTML, next);

// syntax check via temp extract like build-shell
const tmp = join(ROOT, 'frontend/src/.bundle-check.js');
writeFileSync(tmp, bundled);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} catch (e) {
  throw new Error(`bundle JS 语法检查失败：\n${e.stderr || e.message}`);
}

const hash = createHash('sha256').update(bundled).digest('hex').slice(0, 12);
console.log(`bundle-frontend OK → working-fixed.html (${(bundled.length / 1024 / 1024).toFixed(2)} MB, sha ${hash})`);
console.log(`parts: ${manifest.parts.map((p) => p.file).join(', ')}`);
