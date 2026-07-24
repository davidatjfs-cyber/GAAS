/**
 * Upload ownership recording (behavior-preserving extract from index.js).
 * Factory closes over pool so call sites stay:
 *   recordUploadOwnership(filenames, tenantId, uploadedBy)
 */

/**
 * @param {import('pg').Pool} pool
 * @returns {(filenames: string | (string | undefined)[], tenantId: string, uploadedBy: string) => Promise<void>}
 */
export function createRecordUploadOwnership(pool) {
  return async function recordUploadOwnership(filenames, tenantId, uploadedBy) {
    const list = (Array.isArray(filenames) ? filenames : [filenames]).filter(Boolean);
    if (!list.length) return;
    try {
      for (const filename of list) {
        await pool.query(
          `INSERT INTO upload_file_owners (filename, tenant_id, uploaded_by) VALUES ($1,$2,$3)
           ON CONFLICT (filename) DO NOTHING`,
          [filename, tenantId || 'default', uploadedBy || null]
        );
      }
    } catch (e) {
      console.warn('[uploads] recordUploadOwnership failed:', e?.message);
    }
  };
}
