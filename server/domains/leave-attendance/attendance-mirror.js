/**
 * Dual-write: checkin_records → employee_attendance_records (same id).
 * No DDL — table owned by migration 014.
 */

export function createAttendanceMirrorHelpers({ pool }) {
  async function upsertEmployeeAttendanceMirrorFromCheckinRow(rec, tenantId) {
    if (!rec?.id) return;
    await pool.query(
      `INSERT INTO employee_attendance_records (
         id, username, store, type, check_time, latitude, longitude, distance_meters,
         face_match, face_score, photo_url, status, note, confirmed_by, confirmed_at, created_at, synced_at, tenant_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16::timestamptz, NOW()), NOW(), $17
       )
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         store = EXCLUDED.store,
         type = EXCLUDED.type,
         check_time = EXCLUDED.check_time,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         distance_meters = EXCLUDED.distance_meters,
         face_match = EXCLUDED.face_match,
         face_score = EXCLUDED.face_score,
         photo_url = EXCLUDED.photo_url,
         status = EXCLUDED.status,
         note = EXCLUDED.note,
         confirmed_by = EXCLUDED.confirmed_by,
         confirmed_at = EXCLUDED.confirmed_at,
         synced_at = NOW()`,
      [
        rec.id,
        rec.username,
        rec.store,
        rec.type,
        rec.check_time,
        rec.latitude,
        rec.longitude,
        rec.distance_meters,
        rec.face_match,
        rec.face_score,
        rec.photo_url,
        rec.status,
        rec.note,
        rec.confirmed_by,
        rec.confirmed_at,
        rec.created_at,
        tenantId || 'default',
      ]
    );
  }

  return { upsertEmployeeAttendanceMirrorFromCheckinRow };
}
