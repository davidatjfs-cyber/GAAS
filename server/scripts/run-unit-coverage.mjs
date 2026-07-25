#!/usr/bin/env node
/**
 * 单测覆盖率棘轮执行器（Phase 0）。
 * 读取 coverage-ratchet.json，拼 --test-coverage-* 阈值，跑非 integration 单测。
 * 豁免 glob 通过 --test-coverage-exclude 传入（见 coverage-exempt.json）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

function walkTestFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'coverage') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (p.includes(`${path.sep}test${path.sep}integration`)) continue;
      walkTestFiles(p, out);
    } else if (name.endsWith('.test.mjs')) {
      out.push(p);
    }
  }
  return out;
}

const ratchetPath = path.join(serverRoot, 'coverage-ratchet.json');
const exemptPath = path.join(serverRoot, 'coverage-exempt.json');
const ratchet = JSON.parse(fs.readFileSync(ratchetPath, 'utf8'));
const exempt = JSON.parse(fs.readFileSync(exemptPath, 'utf8'));

const lines = Number(ratchet.lines);
const branches = Number(ratchet.branches);
const functions = Number(ratchet.functions);
if (![lines, branches, functions].every((n) => Number.isFinite(n) && n >= 0)) {
  console.error('[coverage] invalid coverage-ratchet.json thresholds');
  process.exit(2);
}

const tests = walkTestFiles(serverRoot).sort();
if (!tests.length) {
  console.error('[coverage] no unit test files found');
  process.exit(2);
}

const excludes = (exempt.patterns || [])
  .map((p) => String(p.glob || '').trim())
  .filter(Boolean)
  .map((g) => g.replace(/\\/g, '/'));

const args = [
  '--test',
  '--test-force-exit',
  '--experimental-test-coverage',
  `--test-coverage-lines=${lines}`,
  `--test-coverage-branches=${branches}`,
  `--test-coverage-functions=${functions}`,
];
for (const g of excludes) {
  args.push(`--test-coverage-exclude=${g}`);
}
args.push(...tests);

console.log(
  `[coverage] ratchet lines>=${lines} branches>=${branches} functions>=${functions} tests=${tests.length} excludes=${excludes.length}`
);

const r = spawnSync(process.execPath, args, {
  cwd: serverRoot,
  stdio: 'inherit',
  env: process.env,
});

process.exit(r.status == null ? 1 : r.status);
