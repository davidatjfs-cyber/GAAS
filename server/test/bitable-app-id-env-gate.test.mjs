/**
 * P3.2：BITABLE App ID 不得在生产路径无条件硬编码兜底。
 * 允许非生产 `(!_isProd ? 'cli_…' : '')` 本地开发兜底。
 *
 * P17：BITABLE_CONFIGS / LARK_* 常量已迁至 domains/agent-bitable/configs.js，
 * 扫描范围同步覆盖 agents.js（如有残留）与新配置模块。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsSrc = fs.readFileSync(path.join(__dirname, '../agents.js'), 'utf8');
const bitableConfigsSrc = fs.readFileSync(
  path.join(__dirname, '../domains/agent-bitable/configs.js'),
  'utf8'
);

test('agents.js + domains/agent-bitable/configs.js BITABLE appId 无 `|| \'cli_…\'` 无条件兜底', () => {
  for (const [label, src] of [
    ['agents.js', agentsSrc],
    ['domains/agent-bitable/configs.js', bitableConfigsSrc],
  ]) {
    const unconditional = src.match(/\|\|\s*'cli_[a-z0-9]+'/g) || [];
    assert.deepEqual(
      unconditional,
      [],
      `${label} 发现无条件 App ID 硬编码兜底: ${unconditional.join(', ')}；生产应只读 env`,
    );
  }
});

test('domains/agent-bitable/configs.js 仍允许非生产 LARK/BITABLE 本地兜底形态', () => {
  assert.match(bitableConfigsSrc, /!_isProd\s*\?\s*'cli_a9fc0d13c838dcd6'\s*:\s*''/);
});
