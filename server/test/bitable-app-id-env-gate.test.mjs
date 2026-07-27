/**
 * P3.2：BITABLE App ID 不得在生产路径无条件硬编码兜底。
 * 允许非生产 `(!_isProd ? 'cli_…' : '')` 本地开发兜底。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentsSrc = fs.readFileSync(path.join(__dirname, '../agents.js'), 'utf8');

test('agents.js BITABLE appId 无 `|| \'cli_…\'` 无条件兜底', () => {
  const unconditional = agentsSrc.match(/\|\|\s*'cli_[a-z0-9]+'/g) || [];
  assert.deepEqual(
    unconditional,
    [],
    `发现无条件 App ID 硬编码兜底: ${unconditional.join(', ')}；生产应只读 env`,
  );
});

test('agents.js 仍允许非生产 LARK/BITABLE 本地兜底形态', () => {
  assert.match(agentsSrc, /!_isProd\s*\?\s*'cli_a9fc0d13c838dcd6'\s*:\s*''/);
});
