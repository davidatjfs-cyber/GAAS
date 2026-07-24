/**
 * Client-safe error message: production never leaks internals.
 */
export function safeErrMessage(e) {
  if (process.env.NODE_ENV === 'production') return 'internal_error';
  return String(e?.message || e || 'internal_error');
}
