/**
 * 从员工 role/position 解析默认 job_profile_key
 */

import { listProfiles } from './competency.js';

const FALLBACK_ORDER = [
  'store_manager', 'cashier', 'foh_server', 'kitchen_staff', 'hq_ops', 'cs', 'sales',
];

export async function resolveJobProfileKey(pool, {
  role = '',
  position = '',
  explicit = null,
} = {}) {
  if (explicit) return String(explicit);
  const profiles = await listProfiles(pool, { activeOnly: true }).catch(() => []);
  const roleL = String(role || '').toLowerCase();
  const pos = String(position || '');

  for (const p of profiles) {
    const roles = asArr(p.role_matchers);
    const positions = asArr(p.position_matchers);
    if (roles.some((r) => String(r).toLowerCase() === roleL)) return p.profile_key;
    if (positions.some((m) => m && pos.includes(String(m)))) return p.profile_key;
  }

  // 启发式（配置未命中时）
  if (/store_manager|店长/.test(roleL) || pos.includes('店长')) return 'store_manager';
  if (/cashier|收银/.test(roleL) || /收银/.test(pos)) return 'cashier';
  if (/kitchen|production|厨师|厨|配菜|传菜/.test(`${roleL}${pos}`)) return 'kitchen_staff';
  if (/hq_|总部|运营/.test(`${roleL}${pos}`)) return 'hq_ops';
  if (/服务员|前厅|迎宾/.test(pos) || roleL === 'store_employee') return 'foh_server';
  if (/customer_service|客服|implementation/.test(roleL)) return 'cs';

  for (const key of FALLBACK_ORDER) {
    if (profiles.some((p) => p.profile_key === key)) return key;
  }
  return 'foh_server';
}

function asArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}
