/**
 * 闸门：deploy/prod-package.json 必须覆盖 server 运行时依赖（除 @gaas/shared 软链）。
 * 新增 server dependency 却忘了同步 prod 清单 → 生产 install/reload 会缺包。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffProdVsServerDeps, PROD_CRITICAL_MODULES } from '../../scripts/prod-deps-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('prod-package.json 与 server/package.json dependencies 对齐（除 @gaas/shared）', () => {
  const serverPkg = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8'));
  const prodPkg = JSON.parse(readFileSync(join(root, 'deploy/prod-package.json'), 'utf8'));
  const diff = diffProdVsServerDeps(prodPkg.dependencies, serverPkg.dependencies);
  assert.deepEqual(diff.missingInProd, [], `prod 缺包: ${diff.missingInProd.join(', ')}`);
  assert.deepEqual(diff.versionMismatch, [], `版本不一致: ${diff.versionMismatch.join('; ')}`);
  assert.deepEqual(diff.missingCritical, [], `缺关键包: ${diff.missingCritical.join(', ')}`);
  assert.equal(diff.ok, true);
});

test('prod-package.json 不得声明 @gaas/shared（生产走软链）', () => {
  const prodPkg = JSON.parse(readFileSync(join(root, 'deploy/prod-package.json'), 'utf8'));
  assert.equal(prodPkg.dependencies?.['@gaas/shared'], undefined);
});

test('PROD_CRITICAL_MODULES 含 express/pg/pino', () => {
  assert.ok(PROD_CRITICAL_MODULES.includes('express'));
  assert.ok(PROD_CRITICAL_MODULES.includes('pg'));
  assert.ok(PROD_CRITICAL_MODULES.includes('pino'));
});
