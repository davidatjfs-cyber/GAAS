/**
 * Ensure uploads directory exists and is R/W.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'uploads', handler: 'ensure-dir' });

export function createEnsureUploadsDir({ fs, uploadsDir }) {
  function ensureUploadsDir() {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
    } catch (e) {
      log.error({ msg: 'ensure_uploads_dir_mkdir_failed', err: e?.message || String(e) });
      return { ok: false, error: 'internal_error' };
    }

    try {
      fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
      return { ok: true };
    } catch (e) {
      log.error({ msg: 'ensure_uploads_dir_access_failed', err: e?.message || String(e) });
      return { ok: false, error: 'internal_error' };
    }
  }

  return { ensureUploadsDir };
}
