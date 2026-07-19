/**
 * 客户敏感信息脱敏：手机号等字段按角色/归属决定是否明文返回。
 * 审计发现的问题——任意平台角色(含普通客服)登录后能顺序遍历线索ID拉取全部客户手机号，
 * 这里补上"谁能看明文"的判断，不改变原有查询逻辑，只在返回给前端前做脱敏。
 */

const FULL_ACCESS_ROLES = new Set(['super_admin', 'sales_manager']);
const PHONE_KEY_RE = /phone/i;

// 签约价格/账期是比手机号更敏感的机密信息(直接关系到客户付了多少钱)，可见范围比
// FULL_ACCESS_ROLES更窄——sales_manager虽然能看客户完整联系方式，但不代表能看签约价格。
const CONTRACT_PRICE_ROLES = new Set(['super_admin', 'general_manager', 'finance']);
const CONTRACT_PRICE_FIELDS = [
  'contract_price_fen',
  'contract_billing_cycle',
  'contract_billing_day',
  'contract_price_note',
  'contract_price_set_by',
  'contract_price_set_at',
];

function canViewContractPrice(platformAdmin) {
  return CONTRACT_PRICE_ROLES.has(platformAdmin?.role || '');
}

/** 就地移除 lead 记录里的签约价格/账期字段(不是遮盖成***，直接不返回，客户档案页面/
 *  接口对无权限角色应完全不出现这些字段，而不是显示占位符暴露"这里有机密信息"这件事本身)。 */
function redactContractPrice(lead, platformAdmin) {
  if (!lead || canViewContractPrice(platformAdmin)) return lead;
  const out = { ...lead };
  for (const key of CONTRACT_PRICE_FIELDS) delete out[key];
  return out;
}

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

/** 就地脱敏单条 lead 记录里的手机号字段(顶层phone/legal_contact_phone + extracted内的所有phone*字段)，
 *  并移除签约价格/账期这类无关手机号可见性、单独按更窄角色集合控制的机密字段。 */
function maskLeadContact(lead, platformAdmin) {
  let masked = redactContractPrice(lead, platformAdmin);
  if (!masked || canViewFullContact(platformAdmin, masked)) return masked;
  masked = { ...masked };
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

export { maskPhone, canViewFullContact, maskLeadContact, maskLeadListContact, canViewContractPrice, redactContractPrice };
