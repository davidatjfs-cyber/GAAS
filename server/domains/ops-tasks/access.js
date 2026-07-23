export function canAccessOpsTasks(role) {
  const r = String(role || '').trim();
  return r === 'admin' || r === 'hq_manager' || r === 'hr_manager' || r === 'store_manager' || r === 'store_production_manager';
}
