#!/usr/bin/env node
/**
 * C9 pass2：安全处理
 * - 解构/单行 import 中未使用的命名绑定 → 删除
 * - `const/let name =` 赋值未使用 → 改名为 `_name`
 * - 函数参数未使用 → 改名为 `_name`（仅简单标识符参数）
 * 不改：export 声明、function 声明名、class 名。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const target = process.argv[2] || 'src';
const raw = execFileSync('npx', ['eslint', target, '--max-warnings', '99999', '-f', 'json'], {
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
});
const data = JSON.parse(raw);

let destructureFixed = 0;
let assignFixed = 0;
let argFixed = 0;

function removeFromImportOrDestructure(line, name) {
  // import { ... }
  let m = /^(\s*import\s+)\{([^}]*)\}(\s+from\s+['"][^'"]+['"];?\s*)$/.exec(line);
  if (m) {
    const parts = m[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const next = parts.filter((p) => {
      const am = /^(.+?)\s+as\s+(.+)$/.exec(p);
      const local = (am ? am[2] : p).trim();
      return local !== name;
    });
    if (next.length === parts.length) return null;
    if (next.length === 0) return '';
    return `${m[1]}{ ${next.join(', ')} }${m[3]}`;
  }
  // const/let/var { ... } = ...
  m = /^(\s*(?:const|let|var)\s+)\{([^}]*)\}(\s*=\s*.+)$/.exec(line);
  if (m) {
    const parts = m[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const next = [];
    let removed = false;
    for (const p of parts) {
      // skip rest ...x
      if (p.startsWith('...')) {
        next.push(p);
        continue;
      }
      const am = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(p);
      const local = (am ? am[2] : p.replace(/\s*=\s*.+$/, '').trim()).trim();
      // plain name or name = default
      const plain = /^([A-Za-z_$][\w$]*)(?:\s*=\s*.+)?$/.exec(p);
      const loc = am ? am[2] : plain ? plain[1] : null;
      if (loc === name) {
        removed = true;
        continue;
      }
      next.push(p);
    }
    if (!removed) return null;
    if (next.length === 0) return null; // don't leave empty destructure
    return `${m[1]}{ ${next.join(', ')} }${m[3]}`;
  }
  // lone binding line inside multi-line destructure: `  name,` or `  name`
  m = /^(\s*)([A-Za-z_$][\w$]*)(\s*,\s*)?$/.exec(line);
  if (m && m[2] === name) {
    return ''; // delete line
  }
  // `  name: alias,` rename forms
  m = /^(\s*)([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)(,?)\s*$/.exec(line);
  if (m && m[3] === name) {
    return '';
  }
  return null;
}

for (const f of data) {
  const path = f.filePath;
  if (!/\.(js|mjs)$/.test(path)) continue;
  const original = readFileSync(path, 'utf8');
  let lines = original.split('\n');
  const hadTrail = original.endsWith('\n');
  const msgs = (f.messages || [])
    .filter((x) => x.ruleId === 'no-unused-vars')
    .sort((a, b) => b.line - a.line || b.column - a.column);

  for (const msg of msgs) {
    const mm = /'([^']+)' is (defined|assigned a value) but never used/.exec(msg.message || '');
    if (!mm) continue;
    const name = mm[1];
    const kind = mm[2];
    if (name.startsWith('_')) continue;
    const i = msg.line - 1;
    if (i < 0 || i >= lines.length) continue;
    const line = lines[i];

    // never touch exports
    if (/^\s*export\s+/.test(line)) continue;
    if (/^\s*(?:async\s+)?function\s+/.test(line) && kind === 'defined') continue;
    if (/^\s*class\s+/.test(line)) continue;

    // try destructure / import removal first
    const replaced = removeFromImportOrDestructure(line, name);
    if (replaced !== null) {
      lines[i] = replaced;
      destructureFixed++;
      continue;
    }

    if (kind === 'assigned a value' || kind === 'assigned') {
      // 跳过解构行（已在上面处理）；勿因模板字符串里的 `${` 误跳过
      if (/^\s*(?:const|let|var)\s*\{/.test(line)) continue;
      const re = new RegExp(`\\b((?:const|let|var)\\s+)${name}\\b`);
      if (re.test(line)) {
        lines[i] = line.replace(re, `$1_${name}`);
        assignFixed++;
        continue;
      }
    }

    // unused args only — never rewrite import { name } bindings (breaks ESM named exports)
    if (/Allowed unused args/.test(msg.message)) {
      if (/^\s*import\b/.test(line) || line.includes(' from ')) continue;
      const col = (msg.column || 1) - 1;
      if (col >= 0 && col < line.length) {
        const slice = line.slice(col);
        if (slice.startsWith(name) && new RegExp(`^${name}\\b`).test(slice)) {
          const before = line.slice(0, col);
          if (/\(|,\s*$/.test(before) || before.endsWith('(') || /,\s*$/.test(before.trimEnd())) {
            lines[i] = line.slice(0, col) + '_' + name + line.slice(col + name.length);
            argFixed++;
          }
        }
      }
    }
  }

  // drop empty lines left by deleted destructure entries? keep structure; collapse only if line became ''
  // Clean trailing double commas in destructure blocks lightly — skip for safety

  let out = lines.join('\n');
  // fix ",," or leading commas in simple cases inside files we touched
  if (out !== original) {
    if (hadTrail && !out.endsWith('\n')) out += '\n';
    writeFileSync(path, out);
  }
}

console.log(JSON.stringify({ destructureFixed, assignFixed, argFixed }));
