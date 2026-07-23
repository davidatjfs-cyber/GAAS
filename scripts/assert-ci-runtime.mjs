#!/usr/bin/env node
/**
 * CI / 本地测试运行时闸门。
 *
 * 血泪教训（2026-07-23）：`--test-force-exit` 合入后 CI 仍停在 Node 18，
 * 两个 job 在启动测试前就 `bad option` 退出 → lint 之外的全部单测/集成测/SHARED_TABLE
 * 等闸门等于零执行，红灯却掩盖了「根本没跑」。
 *
 * 本脚本必须在 npm test / test:integration 之前跑；失败即阻断。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_MAJOR = 22;
const major = Number(process.versions.node.split('.')[0]);

if (!Number.isFinite(major) || major < MIN_MAJOR) {
  console.error(
    `[assert-ci-runtime] Node ${process.versions.node} 过旧：需要 >= ${MIN_MAJOR}（当前 major=${major}）。\n` +
      `  CI 曾因 Node 18 + --test-force-exit 导致测试进程立刻退出、闸门零执行。\n` +
      `  请升级 Node，或检查 .github/workflows/ci.yml 的 node-version / .nvmrc。`
  );
  process.exit(1);
}

const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8', timeout: 10000 });
const helpText = `${help.stdout || ''}${help.stderr || ''}`;
if (!/--test-force-exit/.test(helpText)) {
  console.error(
    `[assert-ci-runtime] 当前 Node ${process.versions.node} 的 --help 未列出 --test-force-exit。\n` +
      `  升级到 Node ${MIN_MAJOR}+，否则 CI 会“红灯但零测试”。`
  );
  process.exit(1);
}

const probeFile = path.join(os.tmpdir(), `gaas-ci-runtime-probe-${process.pid}.test.mjs`);
fs.writeFileSync(probeFile, "import test from 'node:test';\ntest('probe', () => {});\n");
try {
  const probe = spawnSync(process.execPath, ['--test', '--test-force-exit', probeFile], {
    encoding: 'utf8',
    timeout: 20000,
  });
  const errText = `${probe.stderr || ''}${probe.stdout || ''}`;
  if (/bad option:\s*--test-force-exit/i.test(errText)) {
    console.error(`[assert-ci-runtime] --test-force-exit 被拒绝：\n${errText.trim()}`);
    process.exit(1);
  }
  if (probe.status !== 0) {
    console.error(
      `[assert-ci-runtime] 探测测试未通过 (exit=${probe.status})：\n${errText.trim() || '(no output)'}`
    );
    process.exit(1);
  }
} finally {
  try { fs.unlinkSync(probeFile); } catch { /* ignore */ }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredGateFiles = [
  'server/test/shared-table-writers-gate.test.mjs',
  'server/test/ensure-ddl-freeze.test.mjs',
];
const missing = requiredGateFiles.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error('[assert-ci-runtime] 关键闸门测试文件缺失:\n' + missing.map((m) => `  - ${m}`).join('\n'));
  process.exit(1);
}

console.log(
  `[assert-ci-runtime] ok node=${process.versions.node} test-force-exit=supported gates=${requiredGateFiles.length}`
);
