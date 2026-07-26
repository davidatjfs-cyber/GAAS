/**
 * 营销活动 / 短信频控 / ABC 轮换 / 人群 SQL 构建（从 growth-api.js 外提）。
 */
import crypto from 'node:crypto';
import { storeNameToId as _storeNameToIdFromConfig } from '../../brands-config.js';
import { getSmsSlot } from '../../sms-templates.js';
import { childLogger } from '../../utils/logger.js';
import { cleanText } from '../growth-sms/helpers.js';

const log = childLogger({ domain: 'growth-campaigns' });

export function interpolateTemplate(template, context) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = context[key];
    return value == null ? '' : String(value);
  });
}

export function buildActionMessage(actionRow, payload) {
  const couponValueFen = Math.max(0, Math.floor(Number(payload.coupon_value_fen || payload.value_fen) || 0));
  const favoriteDishesText = cleanText(payload.favorite_dishes_text || '', 200) || '店内推荐菜';
  const context = {
    customer_name: cleanText(payload.customer_name || '您好', 80) || '您好',
    days_since_last_visit: Math.max(0, Math.floor(Number(payload.days_since_last_visit) || 0)),
    visit_count: Math.max(0, Math.floor(Number(payload.visit_count) || 0)),
    coupon_value_text: couponValueFen > 0 ? `¥${(couponValueFen / 100).toFixed(0)}` : '',
    valid_days: Math.max(0, Math.floor(Number(payload.valid_days) || 0)),
    favorite_dishes_text: favoriteDishesText,
  };
  const template = cleanText(payload.content_template || payload.message_template, 1800);
  if (template) return interpolateTemplate(template, context);
  return cleanText(actionRow.detail || actionRow.title || '', 1800);
}

export function pickSmsTemplateByStore(storeId) {
  return getSmsSlot({ storeId, slot: 'TEMPLATE' }).template_code;
}

export function pickCampaignSmsSign(storeId) {
  return getSmsSlot({ storeId, slot: 'SIGN' }).sign_name;
}

export function pickWinbackTemplateByStore(storeId) {
  return getSmsSlot({ storeId, slot: 'WINBACK_TEMPLATE' }).template_code;
}

export function pickBalanceTemplateByStore(storeId) {
  return getSmsSlot({ storeId, slot: 'BALANCE_TEMPLATE' }).template_code;
}

export const CAMPAIGN_TYPES = {
  vip_gift: { label: 'VIP客户维护', source: 'profiles', tplPrefix: 'VIP', coupon_count: 1, vars: ['date', 'code'] },
  newcomer_4d: { label: '新客回头·4天', source: 'profiles', tplPrefix: 'NEW4', coupon_count: 1, vars: ['date', 'code'] },
  newcomer_8d: { label: '新客回头·8天', source: 'profiles', tplPrefix: 'NEW8', coupon_count: 1, vars: ['date', 'code'] },
  newcomer_recall: { label: '新客二次召回·21-60天', source: 'profiles', tplPrefix: 'NEWRECALL', coupon_count: 1, vars: ['value', 'date', 'code'] },
  regular_cooling: { label: '常客降温唤醒·21-60天', source: 'profiles', tplPrefix: 'COOLING', coupon_count: 1, vars: ['date', 'code'] },
  active: { label: '活跃客经营', source: 'profiles', tplPrefix: 'ACTIVE', coupon_count: 1, vars: ['date', 'code'] },
  vip_winback: { label: 'VIP专属召回·61-365天', source: 'profiles', tplPrefix: 'VIPWB', coupon_count: 1, vars: ['value', 'date', 'code'] },
  dormant_60_90: { label: '沉睡召回·60-90天', source: 'profiles', tplPrefix: 'DORM6090', coupon_count: 1, vars: ['value', 'date', 'code'] },
  dormant_90_180: { label: '沉睡召回·90-180天', source: 'profiles', tplPrefix: 'DORM90180', coupon_count: 1, vars: ['value', 'date', 'code'] },
  lost_long: { label: '长期流失召回·181-365天', source: 'profiles', tplPrefix: 'LOSTLONG', coupon_count: 2, vars: ['value', 'date', 'code'] },
  lost_over365: { label: '长期流失超1年召回', source: 'profiles', tplPrefix: 'LOSTOVER365', coupon_count: 2, vars: ['value', 'date', 'code'] },
  mj_dinner_weekend: { label: '马己仙晚市/周末复购客', source: 'profiles', tplPrefix: 'MJDINNERWK', coupon_count: 1, vars: ['value', 'date', 'code'] },
  hc_weekday_lunch: { label: '洪潮平日午市客唤醒', source: 'profiles', tplPrefix: 'HCWDLUNCH', coupon_count: 1, vars: ['date', 'code'] },
  mj_dinner_weekend_gift: { label: '马己仙晚市赠菜券(A/B免费菜组)', source: 'profiles', tplPrefix: 'MJDWGIFT', coupon_count: 1, vars: ['date', 'code'] },
  prospect_recall: { label: '到店未买单潜客召回', source: 'profiles', tplPrefix: 'PROSPECT', coupon_count: 1, vars: ['value', 'date', 'code'] },
};

export function pickCampaignTemplate(campaignKey, storeId) {
  const cfg = CAMPAIGN_TYPES[campaignKey];
  if (!cfg) return '';
  return getSmsSlot({ storeId, slot: cfg.tplPrefix }).template_code;
}

export function freqDaysEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export async function globalSmsCapped(pool, phone, tenantId = 'default') {
  const days = freqDaysEnv('ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS', 7);
  const p = String(phone || '').trim();
  if (days <= 0 || !p) return 0;
  const r = await pool.query(
    `SELECT 1 FROM growth_delivery_logs
       WHERE channel = 'sms' AND status = 'sent' AND payload->>'phone' = $1
         AND created_at > now() - ($2 || ' days')::interval
         AND tenant_id = $3
       LIMIT 1`,
    [p, String(days), tenantId]
  );
  return r.rows.length ? days : 0;
}

export function inSmsQuietHours(now = new Date()) {
  const toMins = (s) => {
    const [h, m] = (s || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const bjMins = (() => {
    const p = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const h = Number((p.find((x) => x.type === 'hour') || {}).value || 0);
    const m = Number((p.find((x) => x.type === 'minute') || {}).value || 0);
    return h * 60 + m;
  })();
  const raw = cleanText(process.env.SMS_SEND_WINDOWS || '10:30-12:00,17:00-20:30', 200);
  const windows = raw.split(',').map((w) => {
    const [s, e] = w.trim().split('-');
    return [toMins(s), toMins(e)];
  });
  return !windows.some(([s, e]) => bjMins >= s && bjMins < e);
}

const SMS_PERMANENT_FAIL_RE = /空号|黑名单|号码状态错误|MOBILE_NUMBER_ILLEGAL|MOBILE_NUMBER_NULL|BLACK_KEY_CONTROL_LIMIT/i;
const SMS_BALANCE_FAIL_RE = /余额不足|AMOUNT_NOT_ENOUGH|OUT_OF_SERVICE/i;

export async function isPhoneSuppressed(pool, phone, tenantId = 'default') {
  const p = String(phone || '').trim();
  if (!p) return false;
  const r = await pool.query(
    `SELECT 1 FROM growth_sms_suppression WHERE phone = $1 AND tenant_id = $2 LIMIT 1`,
    [p, tenantId]
  );
  return r.rows.length > 0;
}

export async function handleSmsFailure(pool, phone, errMsg, tenantId = 'default') {
  const msg = String(errMsg || '');
  try {
    const p = String(phone || '').trim();
    if (p && SMS_PERMANENT_FAIL_RE.test(msg)) {
      await pool.query(
        `INSERT INTO growth_sms_suppression (phone, reason, error_message, tenant_id) VALUES ($1, 'permanent_failure', $2, $3)
         ON CONFLICT (phone, tenant_id) DO UPDATE SET error_message = EXCLUDED.error_message, updated_at = NOW()`,
        [p, msg.slice(0, 500), tenantId]
      );
    }
    if (SMS_BALANCE_FAIL_RE.test(msg)) {
      const alertKey = `sms_account_balance:${new Date().toISOString().slice(0, 10)}`;
      await pool.query(
        `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics, tenant_id)
         VALUES ($1,'sms_account','high','','阿里云短信账户余额不足，发送已失败','短信发送返回「${msg.slice(0, 120)}」。在余额恢复前所有营销短信都会失败。','前往阿里云控制台为短信账户充值，并核对今日失败记录是否需要补发',$2::jsonb,$3)
         ON CONFLICT (alert_key, tenant_id) DO UPDATE SET message = EXCLUDED.message, status = 'open', updated_at = NOW()`,
        [alertKey, JSON.stringify({ error: msg.slice(0, 200) }), tenantId]
      );
    }
  } catch (e) {
    log.warn({ msg: 'handle_sms_failure_error', err: e?.message });
  }
}

export async function campaignTouchCapped(pool, campaignKey, phone, tenantId = 'default') {
  const cap = Math.max(0, Math.floor(Number(process.env.ALIYUN_SMS_CAMPAIGN_MAX_TOUCHES) || 3));
  if (cap <= 0) return false;
  const r = await pool.query(
    `SELECT count(*)::int n FROM growth_delivery_logs
      WHERE channel='sms' AND status='sent' AND rule_key = $1 AND payload->>'phone' = $2 AND tenant_id = $3`,
    [campaignKey, String(phone || '').trim(), tenantId]
  );
  return (Number(r.rows[0]?.n) || 0) >= cap;
}

const ABC_DEFAULT_LADDER_DAYS = [15, 30, 45, 60, 75, 90];

export const ABC_ROTATION_ORDER = {
  vip_gift: ['giftA', 'giftB', 'giftC', 'coupon30', 'coupon50', 'coupon2x50'],
  active: ['giftA', 'giftB', 'giftC', 'coupon30', 'coupon50', 'coupon2x50'],
  regular_cooling: ['giftA', 'giftB', 'giftC', 'coupon30', 'coupon50', 'coupon2x50'],
  dormant_90_180: ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'],
  newcomer_recall: ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'],
  dormant_60_90: ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'],
  vip_winback: ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'],
  lost_long: ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'],
  lost_over365: ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'],
  prospect_recall: ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'],
};

export const ABC_STEP_DEFS = {
  giftA: { vars: ['date', 'code'], coupon_value_fen: 0, coupon_count: 1 },
  giftB: { vars: ['date', 'code'], coupon_value_fen: 0, coupon_count: 1 },
  giftC: { vars: ['date', 'code'], coupon_value_fen: 0, coupon_count: 1 },
  coupon30: { vars: ['date', 'code'], coupon_value_fen: 3000, coupon_count: 1 },
  coupon50: { vars: ['date', 'code'], coupon_value_fen: 5000, coupon_count: 1 },
  coupon2x50: { vars: ['date', 'code'], coupon_value_fen: 5000, coupon_count: 2 },
};

const ABC_STEP_TPL_PREFIX = {
  giftA: 'ABCGIFTA',
  giftB: 'ABCGIFTB',
  giftC: 'ABCGIFTC',
  coupon30: 'ABCCOUPON30',
  coupon50: 'ABCCOUPON50',
  coupon2x50: 'ABCCOUPON2X50',
};

export function pickAbcTemplate(step, storeId) {
  const pfx = ABC_STEP_TPL_PREFIX[step];
  if (!pfx) return '';
  return getSmsSlot({ storeId, slot: pfx }).template_code;
}

export function deriveAbcStep(campaignKey, totalSent) {
  const order = ABC_ROTATION_ORDER[campaignKey];
  if (!order) return { step: null, freqDaysOverride: null, blacklisted: false };
  const ladder = ABC_DEFAULT_LADDER_DAYS;
  const perCycle = order.length;
  const maxTouches = ladder.length;
  if (totalSent >= maxTouches) return { step: null, freqDaysOverride: null, blacklisted: true };
  const posInCycle = totalSent % perCycle;
  const freqDaysOverride = ladder[Math.max(0, totalSent - 1)];
  return { step: order[posInCycle], freqDaysOverride, blacklisted: false };
}

export async function countCampaignSent(pool, campaignKey, phone, tenantId = 'default') {
  const p = String(phone || '').trim();
  const r = await pool.query(
    `SELECT count(*)::int n FROM growth_delivery_logs
      WHERE channel='sms' AND status='sent' AND rule_key = $1 AND payload->>'phone' = $2 AND tenant_id = $3
        AND created_at > COALESCE(
          (SELECT MAX(pos_last_order_at) FROM growth_customer_profiles WHERE phone = $2 AND tenant_id = $3),
          '1970-01-01'::timestamptz)`,
    [campaignKey, p, tenantId]
  );
  return Number(r.rows[0]?.n) || 0;
}

export function marketingFatigueMax() {
  const v = Number(process.env.MARKETING_FATIGUE_MAX);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 8;
}

export function marketingFatigueWindowDays() {
  const v = Number(process.env.MARKETING_FATIGUE_WINDOW_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 90;
}

export async function marketingFatigueCapped(pool, phone, tenantId = 'default') {
  const p = String(phone || '').trim();
  if (!p) return false;
  const max = marketingFatigueMax();
  const win = marketingFatigueWindowDays();
  const r = await pool.query(
    `SELECT count(*)::int n FROM growth_delivery_logs
      WHERE channel='sms' AND status='sent' AND payload->>'phone' = $1
        AND created_at > now() - ($2 || ' days')::interval
        AND tenant_id = $3
        AND created_at > COALESCE(
          (SELECT MAX(pos_last_order_at) FROM growth_customer_profiles WHERE phone = $1 AND tenant_id = $3),
          '1970-01-01'::timestamptz)`,
    [p, String(win), tenantId]
  );
  return (Number(r.rows[0]?.n) || 0) >= max;
}

export function holdoutPct() {
  const v = Number(process.env.GROWTH_HOLDOUT_PCT);
  return Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), 0), 50) : 10;
}

export function phoneHashPct(phone) {
  const h = crypto.createHash('md5').update(String(phone || '')).digest('hex');
  return parseInt(h.slice(0, 4), 16) % 100;
}

export function phoneAbBucket(phone, n) {
  const h = crypto.createHash('md5').update(String(phone || '')).digest('hex');
  return parseInt(h.slice(8, 12), 16) % Math.max(1, n);
}

export function buildCampaignTargetQuery(opts) {
  const { storeId, valueTier, lifecycleStage, minVisits, maxVisits, minDays, maxDays, ruleKey, freqDays, limit } = opts;
  const hasAudience = !!(
    valueTier ||
    lifecycleStage ||
    Number.isFinite(minVisits) ||
    Number.isFinite(maxVisits) ||
    Number.isFinite(minDays) ||
    Number.isFinite(maxDays)
  );
  if (!hasAudience) return null;
  const params = [String(Math.max(0, Math.floor(Number(freqDays) || 0)))];
  const daysExpr = '(CURRENT_DATE - COALESCE(cp.pos_last_order_at::date, gc.last_seen_at::date))';
  const clauses = ["cp.phone IS NOT NULL AND cp.phone <> ''"];
  if (storeId) {
    params.push(storeId);
    clauses.push(`cp.store_id = $${params.length}`);
  }
  if (valueTier) {
    params.push(valueTier);
    clauses.push(`cp.value_tier = $${params.length}`);
  }
  if (lifecycleStage) {
    params.push(lifecycleStage);
    clauses.push(`cp.lifecycle_stage = $${params.length}`);
  }
  if (Number.isFinite(minVisits)) clauses.push(`COALESCE(cp.pos_order_count,0) >= ${Math.floor(minVisits)}`);
  if (Number.isFinite(maxVisits)) clauses.push(`COALESCE(cp.pos_order_count,0) <= ${Math.floor(maxVisits)}`);
  if (Number.isFinite(minDays)) clauses.push(`${daysExpr} >= ${Math.floor(minDays)}`);
  if (Number.isFinite(maxDays)) clauses.push(`${daysExpr} <= ${Math.floor(maxDays)}`);
  params.push(ruleKey);
  const ruleIdx = params.length;
  const lim = Math.min(Math.max(Math.floor(Number(limit) || 500), 1), 5000);
  const sql = `
    SELECT cp.customer_id, cp.store_id, cp.phone,
           COALESCE(cp.pos_order_count,0) AS visits,
           ${daysExpr}::int AS days,
           COALESCE(NULLIF(gc.meta->>'title',''), NULLIF(gc.meta->>'name',''), '') AS name,
           (NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
              WHERE d.channel='sms' AND d.rule_key=$${ruleIdx} AND d.status='sent'
                AND d.payload->>'phone' = cp.phone
                AND d.created_at > now() - ($1 || ' days')::interval)) AS sendable
    FROM growth_customer_profiles cp
    JOIN growth_customers gc ON gc.id = cp.customer_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY days ASC LIMIT ${lim}`;
  return { sql, params };
}

export function mapStoreNameToId(name) {
  return _storeNameToIdFromConfig(name);
}
