/**
 * 报价/折扣权限控制
 */
const SENIOR_ROLES = new Set(['platform_admin', 'sales_director', 'sales_manager']);

export function canDiscussPricing(user = {}) {
  const role = String(user?.role || user?.sales_role || '').trim();
  if (SENIOR_ROLES.has(role)) return { allowed: true, level: 'full' };
  if (role === 'sales' || role === 'platform_admin') return { allowed: true, level: 'principle_only' };
  return { allowed: false, level: 'none', reason: '无报价权限，请转交销售负责人' };
}

export function checkPricePermission(user, text = '') {
  const perm = canDiscussPricing(user);
  const t = String(text || '');
  const hasDiscount = /折扣|优惠|便宜|降价|特价|最低价|少点|返点/.test(t);
  const hasExactPrice = /(\d+(?:\.\d+)?)\s*万|报价\s*\d|价格\s*是\s*\d|年费|月费\s*\d/.test(t);
  const risks = [];
  if (!perm.allowed && (hasDiscount || hasExactPrice)) {
    risks.push(perm.reason || '无报价权限');
  } else if (perm.level === 'principle_only' && hasDiscount) {
    risks.push('当前账号仅可讲价格原则，不可承诺折扣');
  }
  if (hasExactPrice && perm.level !== 'full') {
    risks.push('具体报价需负责人确认');
  }
  return { ...perm, risks, blocked: risks.length > 0 && !perm.allowed };
}
