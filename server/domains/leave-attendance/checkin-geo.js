/**
 * Check-in geo fence: haversine distance + radius resolution.
 * Priority: CHECKIN_MAX_DISTANCE_METERS env > state.checkinMaxDistanceMeters
 *   > store checkinRadiusMeters (aliases) > default 100m.
 */

export const CHECKIN_RADIUS_DEFAULT_METERS = 100;
export const CHECKIN_RADIUS_MIN = 10;
export const CHECKIN_RADIUS_MAX = 2000;

export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** @returns {number|null} */
export function parseCheckinRadiusMeters(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const x = Math.round(Number(raw));
  if (!Number.isFinite(x) || x < CHECKIN_RADIUS_MIN) return null;
  return Math.min(CHECKIN_RADIUS_MAX, x);
}

/**
 * 优先级：环境变量 CHECKIN_MAX_DISTANCE_METERS > state.checkinMaxDistanceMeters >
 * 门店 checkinRadiusMeters（等别名）> 默认 100
 */
export function resolveCheckinRadiusMeters(storeRow, state) {
  const fromEnv = parseCheckinRadiusMeters(process.env.CHECKIN_MAX_DISTANCE_METERS);
  if (fromEnv != null) return fromEnv;
  if (state && typeof state === 'object') {
    const g = parseCheckinRadiusMeters(state.checkinMaxDistanceMeters);
    if (g != null) return g;
  }
  if (storeRow && typeof storeRow === 'object') {
    const sr =
      storeRow.checkinRadiusMeters ??
      storeRow.checkin_radius_meters ??
      storeRow.geoFenceRadiusMeters ??
      storeRow.geo_fence_radius_meters;
    const sg = parseCheckinRadiusMeters(sr);
    if (sg != null) return sg;
  }
  return CHECKIN_RADIUS_DEFAULT_METERS;
}
