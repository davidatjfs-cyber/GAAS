/**
 * Treat undefined/null/[]/{} as empty for state ↔ domain-table backfill.
 * Used by payroll + leave domain mutual-repair paths (identical semantics).
 */
export function domainJsonFieldEmpty(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
