/**
 * Startup assertion that critical agent entrypoints are still functions (P20 peel).
 */

/**
 * @param {object} deps
 * @param {Record<string, unknown>} deps.fns name → value (typically typeof-checked)
 * @param {{ info?: Function, error?: Function }} deps.log
 */
export function createAssertCriticalFunctions(deps) {
  const { fns, log } = deps;

  return function assertCriticalFunctions() {
    const critical = Object.entries(fns).map(([name, value]) => [name, typeof value]);
    const missing = critical.filter(([, t]) => t !== 'function');
    if (missing.length > 0) {
      const msg = `[CRITICAL] Missing functions at startup: ${missing.map(([n]) => n).join(', ')}`;
      log.error(msg);
      throw new Error(msg);
    }
    log.info('[agents] Startup assertion passed: all critical functions defined');
  };
}
