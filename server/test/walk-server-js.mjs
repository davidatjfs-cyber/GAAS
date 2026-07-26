/**
 * Path-precise server tree walk for ratchet gates.
 * Basename-only skips (e.g. 'reports') blind domains/reports/ — use rel prefixes instead.
 */
import fs from 'fs';
import path from 'path';

const SKIP_DIR_BASENAMES = new Set([
  'node_modules',
  'coverage',
  'dist',
  '.git',
  'tmp',
  '.stryker-tmp',
]);

/** Only skip top-level server/test, server/reports output, and migrations SQL dirs. */
const SKIP_DIR_REL_PREFIXES = ['test/', 'reports/', 'migrations/'];

export function shouldSkipServerWalkDir(absDir, serverRoot) {
  const base = path.basename(absDir);
  if (SKIP_DIR_BASENAMES.has(base)) return true;
  const rel = path.relative(serverRoot, absDir).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return false;
  return SKIP_DIR_REL_PREFIXES.some(
    (pfx) => rel === pfx.slice(0, -1) || rel.startsWith(pfx)
  );
}

export function walkServerJs(serverRoot, opts = {}) {
  const root = opts.root ?? serverRoot;
  const extRe = opts.extensions ?? /\.(js|mjs)$/;
  const skipTestFiles = opts.skipTestFiles ?? false;
  const out = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (shouldSkipServerWalkDir(p, serverRoot)) continue;
        walk(p);
      } else if (extRe.test(name)) {
        if (skipTestFiles && name.includes('.test.')) continue;
        out.push(p);
      }
    }
  }

  walk(root);
  return out;
}
