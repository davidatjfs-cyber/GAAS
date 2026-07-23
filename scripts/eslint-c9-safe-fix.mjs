#!/usr/bin/env node
/**
 * C9 安全修复：只处理 no-empty，以及 import 子句里未使用的命名绑定。
 * 禁止生成 `import { } from` 或损坏路径（如 utils/.js）。
 * 不改 export / 函数声明名（曾因重命名导出绑定炸过生产）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const raw = execFileSync(
  'npx',
  ['eslint', 'server', '--max-warnings', '99999', '-f', 'json'],
  {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  }
);
const data = JSON.parse(raw);

let emptyFixed = 0;
let importFixed = 0;

for (const f of data) {
  const path = f.filePath;
  if (!/\.(js|mjs)$/.test(path)) continue;
  const original = readFileSync(path, 'utf8');
  let lines = original.split('\n');
  const hadTrail = original.endsWith('\n');
  const msgs = f.messages || [];

  for (const m of msgs.filter((x) => x.ruleId === 'no-empty').sort((a, b) => b.line - a.line)) {
    const i = m.line - 1;
    if (i < 0 || i >= lines.length) continue;
    const line = lines[i];
    if (/\{\s*$/.test(line) && i + 1 < lines.length && /^\s*\}\s*$/.test(lines[i + 1])) {
      const indent = (lines[i + 1].match(/^(\s*)/) || ['', ''])[1];
      lines.splice(i + 1, 0, `${indent}/* ignore */`);
      emptyFixed++;
      continue;
    }
    if (/\{\s*\}/.test(line)) {
      lines[i] = line.replace(/\{\s*\}/, '{ /* ignore */ }');
      emptyFixed++;
    }
  }

  for (const m of msgs.filter((x) => x.ruleId === 'no-unused-vars').sort((a, b) => b.line - a.line)) {
    const mm = /'([^']+)' is (?:defined|assigned a value) but never used/.exec(m.message || '');
    if (!mm) continue;
    const name = mm[1];
    if (name.startsWith('_')) continue;
    const i = m.line - 1;
    if (i < 0 || i >= lines.length) continue;
    const line = lines[i];
    const im = /^(\s*import\s+)\{([^}]*)\}(\s+from\s+['"][^'"]+['"];?\s*)$/.exec(line);
    if (!im) continue;
    const parts = im[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const next = [];
    let removed = false;
    for (const p of parts) {
      const am = /^(.+?)\s+as\s+(.+)$/.exec(p);
      const local = (am ? am[2] : p).trim();
      if (local === name) {
        removed = true;
        continue;
      }
      next.push(p);
    }
    if (!removed) continue;
    if (next.length === 0) {
      lines[i] = '';
    } else {
      lines[i] = `${im[1]}{ ${next.join(', ')} }${im[3]}`;
    }
    importFixed++;
  }

  let out = lines.join('\n');
  if (hadTrail && !out.endsWith('\n')) out += '\n';
  if (out !== original) writeFileSync(path, out);
}

console.log(JSON.stringify({ emptyFixed, importFixed }));
