/**
 * 营销短信模板参数组装（从 growth-api.js executeGrowthActionRecord 外提）。
 */
import { cleanText } from '../growth-actions/helpers.js';
import { cleanPhone } from '../growth-stored-value/helpers.js';

export const SMS_DERIVED_VARS = new Set(['name', 'value', 'date', 'code', 'balance', 'days']);

export function smsSafeName(value) {
  const s = cleanText(value, 20);
  return /^[一-龥·]{2,15}$/.test(s) ? s : '顾客';
}

export function genSmsShortCode() {
  const n = (Date.now() % 1000000) ^ Math.floor(Math.random() * 1000000);
  return String(100000 + (Math.abs(n) % 900000));
}

export function formatSmsValidDate(validDays) {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, Math.floor(Number(validDays) || 7)));
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

async function getStoredValueBalanceYuan(pool, phone, storeId) {
  const p = cleanPhone(phone);
  if (!p) return 0;
  const params = [p];
  let where = "phone = $1 AND phone <> ''";
  const sid = cleanText(storeId, 128);
  if (sid) {
    params.push(sid);
    where += ` AND store_id = $${params.length}`;
  }
  const r = await pool
    .query(
      `SELECT balance_fen FROM growth_stored_value_members WHERE ${where} ORDER BY balance_fen DESC LIMIT 1`,
      params
    )
    .catch(() => ({ rows: [] }));
  return Math.max(0, Math.round((r.rows[0]?.balance_fen || 0) / 100));
}

/**
 * Build Aliyun SMS templateParam + optional short code.
 * @returns {{ templateParam: object|null, generatedCode: string, skipReason: string }}
 */
export async function buildSmsTemplateParam(pool, payload, storeId) {
  const smsPhone = cleanPhone(payload.phone);
  const couponValueFen = Math.max(0, Math.floor(Number(payload.coupon_value_fen || payload.value_fen) || 0));
  const tplText = cleanText(payload.content_template || payload.message_template, 1800);
  const neededVars = Array.from(
    new Set((tplText.match(/\{([a-zA-Z0-9_]+)\}/g) || []).map((s) => s.slice(1, -1)))
  );
  const useDerivedParams = neededVars.length > 0 && neededVars.every((v) => SMS_DERIVED_VARS.has(v));

  let templateParam = null;
  let generatedCode = '';
  let skipReason = '';

  if (useDerivedParams) {
    const param = {};
    for (const v of neededVars) {
      if (v === 'name') param.name = smsSafeName(payload.customer_name) || '顾客';
      else if (v === 'days')
        param.days = String(Math.max(0, Math.floor(Number(payload.days_since_last_visit) || 0)));
      else if (v === 'value') {
        if (couponValueFen <= 0) {
          skipReason = 'no_coupon_value';
          break;
        }
        param.value = String(Math.round(couponValueFen / 100));
      } else if (v === 'date') {
        param.date = formatSmsValidDate(payload.valid_days);
      } else if (v === 'code') {
        generatedCode = genSmsShortCode();
        param.code = generatedCode;
      } else if (v === 'balance') {
        const balYuan = await getStoredValueBalanceYuan(pool, smsPhone, storeId);
        if (balYuan <= 0) {
          skipReason = 'no_balance';
          break;
        }
        param.balance = String(balYuan);
      }
    }
    if (!skipReason) templateParam = param;
  } else if (couponValueFen <= 0) {
    skipReason = 'no_coupon_value';
  } else {
    templateParam = {
      name: smsSafeName(payload.customer_name) || '顾客',
      days: String(Math.max(0, Math.floor(Number(payload.days_since_last_visit) || 0))),
      value: String(Math.round(couponValueFen / 100)),
    };
  }

  return { templateParam, generatedCode, skipReason, smsPhone, couponValueFen };
}
