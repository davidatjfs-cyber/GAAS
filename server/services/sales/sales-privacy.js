/**
 * 客户敏感信息脱敏：手机号等字段按角色/归属决定是否明文返回。
 * 审计发现的问题——任意平台角色(含普通客服)登录后能顺序遍历线索ID拉取全部客户手机号，
 * 这里补上"谁能看明文"的判断，不改变原有查询逻辑，只在返回给前端前做脱敏。
 */

const FULL_ACCESS_ROLES = new Set(['super_admin', 'sales_manager']);
const PHONE_KEY_RE = /phone/i;

function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s ? '***' : '';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 管理者始终可见明文；本人负责(销售owner/assigned_to，或客户成功cs_owner)的线索可见明文 */
function canViewFullContact(platformAdmin, lead) {
  const role = platformAdmin?.role || '';
  const username = platformAdmin?.username || '';
  if (FULL_ACCESS_ROLES.has(role)) return true;
  if (role === 'sales' && username && (lead?.owner_username === username || lead?.assigned_to === username)) return true;
  if (role === 'customer_service' && username && lead?.cs_owner_username === username) return true;
  return false;
}

/** 递归脱敏对象里所有键名含"phone"的字段值，不只处理顶层——之前只处理了extracted.phone，
 *  漏了extracted.contact_phone等其他命名变体。 */
function maskPhoneFieldsDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskPhoneFieldsDeep);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PHONE_KEY_RE.test(k) && typeof v === 'string') out[k] = maskPhone(v);
    else if (v && typeof v === 'object') out[k] = maskPhoneFieldsDeep(v);
    else out[k] = v;
  }
  return out;
}

/** 就地脱敏单条 lead 记录里的手机号字段(顶层phone/legal_contact_phone + extracted内的所有phone*字段) */
function maskLeadContact(lead, platformAdmin) {
  if (!lead || canViewFullContact(platformAdmin, lead)) return lead;
  const masked = { ...lead };
  if (masked.phone) masked.phone = maskPhone(masked.phone);
  if (masked.legal_contact_phone) masked.legal_contact_phone = maskPhone(masked.legal_contact_phone);
  if (masked.extracted && typeof masked.extracted === 'object') {
    masked.extracted = maskPhoneFieldsDeep(masked.extracted);
  }
  return masked;
}

function maskLeadListContact(leads, platformAdmin) {
  return (leads || []).map((l) => maskLeadContact(l, platformAdmin));
}

export { maskPhone, canViewFullContact, maskLeadContact, maskLeadListContact };
