/**
 * Periodic / on-demand snapshot of hrms_state into hrms_state_snapshots.
 */

export function createHrmsStateSnapshotHelpers({ pool }) {
  async function captureHrmsStateSnapshotToDb(opts = {}) {
    if (String(process.env.HRMS_STATE_SNAPSHOT_DISABLED || '').toLowerCase() === 'true') {
      return { ok: true, skipped: true, reason: 'disabled' };
    }
    const source = String(opts.source || 'scheduled').slice(0, 64);
    const key = String(opts.stateKey || 'default').trim() || 'default';
    const r = await pool.query('SELECT data FROM hrms_state WHERE key = $1 LIMIT 1', [key]);
    const row = r.rows?.[0];
    if (!row) return { ok: true, skipped: true, reason: 'no_row' };
    let payload = row.data;
    if (payload == null) payload = {};
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    if (typeof payload !== 'object' || Array.isArray(payload)) payload = {};
    const jsonStr = JSON.stringify(payload);
    const byteSize = Buffer.byteLength(jsonStr, 'utf8');
    await pool.query(
      `INSERT INTO hrms_state_snapshots (state_key, data, byte_size, source)
       VALUES ($1, $2::jsonb, $3, $4)`,
      [key, jsonStr, byteSize, source]
    );
    const retainDays = Math.max(
      1,
      Math.min(365, Number(process.env.HRMS_STATE_SNAPSHOT_RETAIN_DAYS || 30))
    );
    await pool.query(
      `DELETE FROM hrms_state_snapshots WHERE state_key = $1 AND created_at < NOW() - ($2::int * INTERVAL '1 day')`,
      [key, retainDays]
    );
    const retainRows = Math.max(
      10,
      Math.min(5000, Number(process.env.HRMS_STATE_SNAPSHOT_MAX_ROWS || 400))
    );
    await pool.query(
      `DELETE FROM hrms_state_snapshots s
       USING (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY state_key ORDER BY created_at DESC) AS rn
           FROM hrms_state_snapshots
           WHERE state_key = $1
         ) x WHERE x.rn > $2
       ) d
       WHERE s.id = d.id`,
      [key, retainRows]
    );
    return { ok: true, byteSize };
  }

  return { captureHrmsStateSnapshotToDb };
}
