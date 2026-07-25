import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffProdVsServerDeps,
  serverDepsToProdDeps,
} from '../../scripts/prod-deps-lib.mjs';

test('serverDepsToProdDeps 去掉 @gaas/shared', () => {
  const out = serverDepsToProdDeps({
    '@gaas/shared': 'file:../packages/gaas-shared',
    express: '^4.18.2',
    pino: '^9.14.0',
  });
  assert.deepEqual(out, { express: '^4.18.2', pino: '^9.14.0' });
});

test('diffProdVsServerDeps 检出缺失与版本漂移', () => {
  const server = { '@gaas/shared': 'file:x', express: '^4', pino: '^9', pg: '^8' };
  const prod = { express: '^4', pino: '^8' }; // missing pg, pino mismatch; also missing other criticals
  const d = diffProdVsServerDeps(prod, server);
  assert.ok(d.missingInProd.includes('pg'));
  assert.ok(d.versionMismatch.some((x) => x.startsWith('pino:')));
  assert.equal(d.ok, false);
});
