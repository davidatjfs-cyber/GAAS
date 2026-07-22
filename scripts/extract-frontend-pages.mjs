#!/usr/bin/env node
/**
 * 把 working-fixed.html 主 <script> 物理切到 frontend/src/pages/*.js（零逻辑改动）。
 * 仅首次/重新抽取时用；日常改 frontend/src/pages，再跑 bundle-frontend.mjs。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_HTML = join(ROOT, 'working-fixed.html');
const PAGES_DIR = join(ROOT, 'frontend/src/pages');
const MANIFEST = join(ROOT, 'frontend/src/pages.manifest.json');

const STYLE_OPEN = null; // unused
const SCRIPT_OPEN = '\n    <script>\n';
const SCRIPT_CLOSE = '\n    </script>\n';

/** 1-based inclusive start line within the main script body */
const PARTS = [
  { file: '01-boot.js', start: 1 },
  { file: '02-confirm-role-modules.js', start: 4960 },
  { file: '03-training-focus.js', start: 7683 },
  { file: '04-knowledge-ai.js', start: 13066 },
  { file: '05-agents.js', start: 13505 },
  { file: '06-flashcards.js', start: 15266 },
  { file: '07-promotion.js', start: 15882 },
  { file: '08-materials-tasks.js', start: 20130 },
  { file: '09-resignation.js', start: 25412 },
  { file: '10-daily-report-hr.js', start: 28148 },
  { file: '11-rewards-permissions.js', start: 32509 },
  { file: '12-files.js', start: 34550 },
  { file: '13-growth.js', start: 36215 },
  { file: '14-subscription-and-tail.js', start: 39919 },
];

function extractMainScript(html) {
  const openIdx = html.indexOf(SCRIPT_OPEN);
  if (openIdx === -1) throw new Error('找不到主 script 起始锚点');
  if (html.indexOf(SCRIPT_OPEN, openIdx + 1) !== -1) throw new Error('主 script 起始锚点不唯一');
  const closeIdx = html.indexOf(SCRIPT_CLOSE, openIdx);
  if (closeIdx === -1) throw new Error('找不到主 script 结束锚点');
  if (html.indexOf(SCRIPT_CLOSE, closeIdx + 1) !== -1) throw new Error('主 script 结束锚点不唯一');
  return {
    inner: html.slice(openIdx + SCRIPT_OPEN.length, closeIdx),
    openIdx,
    closeIdx,
  };
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

const html = readFileSync(SRC_HTML, 'utf8');
const { inner } = extractMainScript(html);
const lines = inner.split('\n');
const totalLines = lines.length;

rmSync(PAGES_DIR, { recursive: true, force: true });
mkdirSync(PAGES_DIR, { recursive: true });

const ends = [...PARTS.slice(1).map((p) => p.start), totalLines + 1];
const manifest = { version: 1, parts: [], sourceSha256: sha256(inner), sourceLines: totalLines };

for (let i = 0; i < PARTS.length; i++) {
  const start = PARTS[i].start; // 1-based
  const end = ends[i]; // exclusive 1-based (= next start or total+1)
  const slice = lines.slice(start - 1, end - 1);
  const header = [
    `/* AUTO-SPLIT from working-fixed.html main <script>`,
    ` * file: ${PARTS[i].file}`,
    ` * lines: ${start}-${end - 1} (of ${totalLines})`,
    ` * DO NOT add import/export — files are concatenated as a classic script.`,
    ` * Edit this file, then: node scripts/bundle-frontend.mjs`,
    ` */`,
    '',
    '',
  ].join('\n');
  const body = slice.join('\n');
  writeFileSync(join(PAGES_DIR, PARTS[i].file), header + body + '\n');
  manifest.parts.push({ file: PARTS[i].file, start, end: end - 1, lines: end - start });
  console.log(`wrote ${PARTS[i].file}  L${start}-${end - 1}  (${end - start} lines)`);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

// Roundtrip check: strip headers and concat must equal original
let rebuilt = '';
for (const p of manifest.parts) {
  const raw = readFileSync(join(PAGES_DIR, p.file), 'utf8');
  const withoutHeader = raw.replace(/^\/\* AUTO-SPLIT[\s\S]*?\*\/\n\n/, '');
  // file was written with extra trailing \n after body
  rebuilt += withoutHeader.endsWith('\n') ? withoutHeader.slice(0, -1) : withoutHeader;
  if (p !== manifest.parts[manifest.parts.length - 1]) {
    // between parts: original had newline at cut already included in each slice's last/first?
    // Each slice is lines[a..b) joined by \n — joining slices needs \n between them
    rebuilt += '\n';
  } else {
    // last part: original inner may or may not end with \n
  }
}

// Fix: joining with \n between slices is correct because slice.join('\n') doesn't add trailing \n
// after last line of slice, and next slice starts with its first line.
// After loop, rebuilt should equal inner IF inner has no trailing newline after last line,
// OR we need to match.

const ok = rebuilt === inner || rebuilt + '\n' === inner || rebuilt === inner + '\n';
if (!ok) {
  // detailed debug
  console.error('ROUNDTRIP FAIL');
  console.error('inner len', inner.length, 'rebuilt len', rebuilt.length);
  for (let k = 0; k < Math.min(inner.length, rebuilt.length); k++) {
    if (inner[k] !== rebuilt[k]) {
      console.error('first diff at', k, 'inner', JSON.stringify(inner.slice(k, k + 40)), 'rebuilt', JSON.stringify(rebuilt.slice(k, k + 40)));
      break;
    }
  }
  if (inner.length !== rebuilt.length) {
    console.error('tail inner', JSON.stringify(inner.slice(-40)));
    console.error('tail rebuilt', JSON.stringify(rebuilt.slice(-40)));
  }
  process.exit(1);
}

console.log('roundtrip OK, sha256=', manifest.sourceSha256.slice(0, 12));
console.log('manifest →', MANIFEST);
