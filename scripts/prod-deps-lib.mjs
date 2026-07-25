/**
 * 生产依赖契约：deploy/prod-package.json ↔ server/package.json
 * @gaas/shared 在生产用软链，不进 prod-package.json。
 */

export const PROD_SKIP_DEPS = Object.freeze(['@gaas/shared']);

export const PROD_CRITICAL_MODULES = Object.freeze([
  'express',
  'pg',
  'jsonwebtoken',
  'dotenv',
  'cors',
  'compression',
  'multer',
  'bcryptjs',
  'axios',
  'ws',
  'pdfkit',
  'xlsx',
  'ali-oss',
  'cos-nodejs-sdk-v5',
  'archiver',
  'pino',
]);

/**
 * @param {Record<string, string>} serverDeps
 * @returns {Record<string, string>}
 */
export function serverDepsToProdDeps(serverDeps) {
  const out = {};
  for (const [name, ver] of Object.entries(serverDeps || {})) {
    if (PROD_SKIP_DEPS.includes(name)) continue;
    out[name] = ver;
  }
  return out;
}

/**
 * @param {Record<string, string>} prodDeps
 * @param {Record<string, string>} serverDeps
 * @returns {{ ok: boolean, missingInProd: string[], versionMismatch: string[], missingCritical: string[] }}
 */
export function diffProdVsServerDeps(prodDeps, serverDeps) {
  const expected = serverDepsToProdDeps(serverDeps);
  const missingInProd = [];
  const versionMismatch = [];
  for (const [name, ver] of Object.entries(expected)) {
    if (!(name in (prodDeps || {}))) missingInProd.push(name);
    else if (String(prodDeps[name]) !== String(ver)) {
      versionMismatch.push(`${name}: prod=${prodDeps[name]} server=${ver}`);
    }
  }
  const missingCritical = PROD_CRITICAL_MODULES.filter((m) => !(m in (prodDeps || {})));
  return {
    ok: missingInProd.length === 0 && versionMismatch.length === 0 && missingCritical.length === 0,
    missingInProd,
    versionMismatch,
    missingCritical,
  };
}
