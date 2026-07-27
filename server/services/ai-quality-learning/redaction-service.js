import crypto from 'node:crypto';

const MAX_LEARNING_TEXT = 6000;

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function redactLearningText(value) {
  let text = String(value || '').slice(0, MAX_LEARNING_TEXT);
  const counts = {};
  const replace = (name, pattern, replacement) => {
    let count = 0;
    text = text.replace(pattern, (...args) => {
      count += 1;
      return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
    if (count) counts[name] = count;
  };
  replace('authorization', /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}\b/gi, '[AUTH_REDACTED]');
  replace('secret', /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*[^\s,;，。]{4,}/gi, '[SECRET_REDACTED]');
  replace('url', /https?:\/\/[^\s<>{}"']+/gi, '[URL_REDACTED]');
  replace('ipv4', /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g, '[IP_REDACTED]');
  replace('id_card', /\b\d{17}[0-9Xx]\b/g, '[ID_REDACTED]');
  replace('phone', /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[PHONE_REDACTED]');
  replace('email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]');
  replace('bank_card', /(?<!\d)\d{16,19}(?!\d)/g, '[BANK_REDACTED]');
  replace('open_id', /\b(?:ou_|on_|oc_|cli_)[a-z0-9_-]{12,}\b/gi, '[EXTERNAL_ID_REDACTED]');
  replace('labeled_person', /(?:姓名|员工|顾客|客户|联系人|负责人|店长)\s*[:：=]\s*[\u4e00-\u9fa5·]{2,12}/g, '[PERSON_REDACTED]');
  replace('labeled_entity', /(?:公司|品牌|门店|店铺|商户)\s*[:：=]\s*[^\s,，。；;]{2,40}/g, '[ENTITY_REDACTED]');
  replace('address', /(?:地址|住址|所在地)\s*[:：=]\s*[^\n。；;]{4,80}/g, '[ADDRESS_REDACTED]');
  replace('account_id', /(?:微信号|账号|工号|会员号)\s*[:：=]\s*[a-zA-Z0-9_-]{4,40}/gi, '[ACCOUNT_REDACTED]');
  return { text, report: { replacements: counts, truncated: String(value || '').length > MAX_LEARNING_TEXT } };
}

export function sanitizeJson(value, depth = 0) {
  if (depth > 5 || value == null) return value == null ? null : '[DEPTH_LIMIT]';
  if (typeof value === 'string') return redactLearningText(value).text;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/password|secret|token|api[_-]?key|authorization|phone|mobile|email|address|open.?id|user.?id|customer.?id|employee.?id|person.?name|customer.?name/i.test(key)) {
      result[key] = '[SECRET_REDACTED]';
    } else {
      result[key] = sanitizeJson(item, depth + 1);
    }
  }
  return result;
}
