/**
 * Ensure uploads directory exists and is R/W.
 */

export function createEnsureUploadsDir({ fs, uploadsDir }) {
  function ensureUploadsDir() {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (e) {
      console.error('[ensureUploadsDir] mkdirSync failed:', e?.message || e);
      return { ok: false, error: 'internal_error' };
    }

    try {
      fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
      return { ok: true };
    } catch (e) {
      console.error('[ensureUploadsDir] accessSync failed:', e?.message || e);
      return { ok: false, error: 'internal_error' };
    }
  }

  return { ensureUploadsDir };
}
