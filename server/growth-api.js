export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

export function parseOccurredAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { sendAliyunSms, isAliyunSmsConfigured, isAliyunSmsAutoSendEnabled } from './sms.js';
import { STORES as _ALL_STORES } from './brands-config.js';
import {
  buildActionMessage,
  pickSmsTemplateByStore,
  phoneHashPct,
  phoneAbBucket,
  holdoutPct,
  interpolateTemplate,
  CAMPAIGN_TYPES,
  ABC_ROTATION_ORDER,
  ABC_STEP_DEFS,
  freqDaysEnv,
  globalSmsCapped,
  inSmsQuietHours,
  isPhoneSuppressed,
  handleSmsFailure,
  pickBalanceTemplateByStore,
} from './domains/growth-campaigns/helpers.js';
import { buildSmsTemplateParam } from './domains/growth-campaigns/sms-params.js';
import { applyGrowthActionTypeEffects } from './domains/growth-actions/execute-type-effects.js';
import { deliverGrowthActionChannels } from './domains/growth-actions/deliver-channels.js';
export {
  pickCampaignSmsSign,
  pickWinbackTemplateByStore,
  pickBalanceTemplateByStore,
  CAMPAIGN_TYPES,
  pickCampaignTemplate,
  freqDaysEnv,
  globalSmsCapped,
  inSmsQuietHours,
  isPhoneSuppressed,
  handleSmsFailure,
  campaignTouchCapped,
  ABC_ROTATION_ORDER,
  ABC_STEP_DEFS,
  pickAbcTemplate,
  deriveAbcStep,
  countCampaignSent,
  marketingFatigueCapped,
  buildCampaignTargetQuery,
  mapStoreNameToId,
} from './domains/growth-campaigns/helpers.js';
export { formatSmsValidDate } from './domains/growth-campaigns/sms-params.js';
import { recomputeCustomerProfiles } from './domains/growth-profiles/recompute.js';
export { recomputeCustomerProfiles } from './domains/growth-profiles/recompute.js';
import {
  fmtYmd,
  buildRuleActionKey,
  buildRulePeriodKey,
  filterGenericRuleCandidates,
  fetchGenericRuleCandidates,
  loadSegmentPhoneSet,
  loadRuleCandidates,
} from './domains/growth-touch-rules/helpers.js';
export {
  fmtYmd,
  loadRuleCandidates,
  filterGenericRuleCandidates,
  fetchGenericRuleCandidates,
} from './domains/growth-touch-rules/helpers.js';
import { buildGrowthDailyReport } from './domains/growth-ops/daily-report.js';
export { buildGrowthDailyReport } from './domains/growth-ops/daily-report.js';
import { buildRemindTargetsQuery } from './domains/growth-stored-value/helpers.js';
export { buildRemindTargetsQuery } from './domains/growth-stored-value/helpers.js';
import { runForActiveTenants, tenantContext, resolveTenantIdDefault } from './utils/database.js';
import { initSmsTemplatesCache } from './sms-templates.js';
import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'growth-api' });
const _storeId = (brandName) => _ALL_STORES.find(s => s.brandName === brandName)?.storeId || '';

// 订阅消息推送网关（方案B）：HRMS 自己没有小程序 access_token，发不了订阅消息，
// 改为 POST 到云函数 growthSubscribePush（云开发 HTTP 访问服务暴露的 URL），
// 由小程序侧复用 sendSubscribeMessage 真正下发。URL 配在 env HRMS_SUBSCRIBE_PUSH_URL。
function subscribePushUrl() {
  return cleanText(process.env.HRMS_SUBSCRIBE_PUSH_URL || '', 500);
}
function isSubscribePushConfigured() {
  return !!subscribePushUrl() && !!cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
}
// 与召回短信回调同一套密钥口径，云函数侧用 X-Miniprogram-Sync-Secret 校验。
async function postSubscribePush(body) {
  const url = subscribePushUrl();
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Miniprogram-Sync-Secret': secret },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    let json = {};
    try { json = await resp.json(); } catch (e) { json = {}; }
    return { httpStatus: resp.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

// 小程序站内推券网关：HRMS 策略 → 调云函数 growthMemberCoupon → 给会员发券进卡包。
// URL 配在 env HRMS_MEMBER_COUPON_PUSH_URL，密钥与订阅推送同口径。
function memberCouponPushUrl() {
  return cleanText(process.env.HRMS_MEMBER_COUPON_PUSH_URL || '', 500);
}
function isMemberCouponPushConfigured() {
  return !!memberCouponPushUrl() && !!cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
}
async function postMemberCouponPush(body) {
  const url = memberCouponPushUrl();
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Miniprogram-Sync-Secret': secret },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    let json = {};
    try { json = await resp.json(); } catch (e) { json = {}; }
    return { httpStatus: resp.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

function authMiniProgramSync(req) {
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || '', 500);
  if (!secret) return { ok: false, status: 503, error: 'miniprogram_sync_disabled' };
  const headerSecret = cleanText(req.headers['x-miniprogram-sync-secret'] || '', 500);
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const signature = cleanText(req.headers['x-signature'] || '', 128);
  const timestamp = cleanText(req.headers['x-timestamp'] || '', 32);
  const requestId = cleanText(req.headers['x-request-id'] || '', 128);
  const tenantId = cleanText(req.headers['x-tenant-id'] || '', 128);
  const storeId = cleanText(req.headers['x-store-id'] || '', 128);
  if (signature || timestamp || requestId) {
    const age = Math.abs(Date.now() - Number(timestamp));
    const bodyText = JSON.stringify(req.body && typeof req.body === 'object' ? req.body : {});
    const bodyHash = crypto.createHash('sha256').update(bodyText).digest('hex');
    const material = [timestamp, requestId, tenantId, storeId, bodyHash].join('\n');
    const expected = crypto.createHmac('sha256', secret).update(material).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (!timestamp || !requestId || sigBuf.length !== expectedBuf.length || !Number.isFinite(age) || age > 5 * 60 * 1000 || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return { ok: false, status: 401, error: 'invalid_miniprogram_signature' };
    const allowed = String(process.env.HRMS_ALLOWED_TENANT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length && (!tenantId || !allowed.includes(tenantId))) return { ok: false, status: 403, error: 'tenant_not_assigned_to_server' };
    return { ok: true };
  }
  if (String(process.env.MINIPROGRAM_SIGNATURE_REQUIRED || 'false').toLowerCase() === 'true') return { ok: false, status: 401, error: 'miniprogram_signature_required' };
  if (headerSecret === secret || bearer === secret) return { ok: true };
  if (bearer && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
      if (decoded && decoded.username) return { ok: true };
    } catch (e) { /* ignore */ }
  }
  return { ok: false, status: 401, error: 'unauthorized' };
}

let _growthTablesDeprecationLogged = false;

export async function ensureGrowthTables(pool) {
  if (!_growthTablesDeprecationLogged) {
    log.warn({ msg: 'ensure_growth_tables_deprecated' });
    _growthTablesDeprecationLogged = true;
  }
  // 营销矩阵：生命周期阶段 × 价值分级 → 差异化动作
  // value_tier 口径：VIP=各门店折前人均消费金额(avg_check)排名前15%；regular=15–50分位；low=后50%或未消费
  // VIP 走「专属感/大钩子」不打折，普通/低频走「券」，潜在新客仅轻触达
  const defaultTouchRules = [
    {
      rule_key: 'dormant_vip_winback',
      name: '沉睡VIP老客大钩子召回',
      priority: 10,
      auto_execute: true,
      criteria: { lifecycle_stage: 'dormant', value_tier: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 5000,
        valid_days: 7,
        coupon_name: 'VIP专属回归礼',
        title_template: 'VIP老客专属回归礼遇',
        content_template: '{customer_name}，好久不见。给老朋友留了一份招牌菜，本周到店即赠，另附{coupon_value_text}专属礼券，7天内有效，期待你回来。'
      }
    },
    {
      rule_key: 'dormant_normal_winback',
      name: '沉睡普通老客召回券',
      priority: 12,
      auto_execute: true,
      criteria: { lifecycle_stage: 'dormant', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 3000,
        valid_days: 7,
        coupon_name: '老客召回券',
        title_template: '老朋友召回券',
        content_template: '{customer_name}，已有{days_since_last_visit}天没见啦，这张{coupon_value_text}召回券为你保留7天，欢迎回来尝尝 {favorite_dishes_text}。'
      }
    },
    {
      rule_key: 'new_customer_welcome',
      name: '新客72小时黄金窗口问候',
      priority: 15,
      auto_execute: true,
      criteria: { min_visit_count: 1, max_visit_count: 1, min_days_since_last_visit: 4, max_days_since_last_visit: 7, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '新客欢迎问候',
        content_template: '{customer_name}，谢谢你的光临。不知道菜品是否合口味？下次想试试 {favorite_dishes_text}，提前说一声我们帮你留位。'
      }
    },
    {
      rule_key: 'active_vip_privilege',
      name: '活跃VIP专属感运营',
      priority: 20,
      auto_execute: true,
      criteria: { lifecycle_stage: 'active', value_tier: 'vip' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: 'VIP专属新品预告',
        content_template: '{customer_name}，本周到了一批限量时令好货，给你优先留着。想安排包厢或预留座位随时招呼。'
      }
    },
    {
      rule_key: 'at_risk_winback',
      name: '临界客温和提醒',
      priority: 30,
      auto_execute: true,
      criteria: { lifecycle_stage: 'at_risk' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '临界客推荐菜提醒',
        content_template: '{customer_name}，已经{days_since_last_visit}天没见你啦，最近上了新菜，下次来试试 {favorite_dishes_text}，需要留位提前说。'
      }
    },
    {
      rule_key: 'loyal_birthday_month',
      name: '忠诚客户生日月礼遇',
      priority: 35,
      auto_execute: true,
      criteria: { min_visit_count: 3, max_visit_interval_days: 10 },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 1800,
        valid_days: 7,
        coupon_name: '生日月礼券',
        title_template: '忠诚客户生日月礼遇',
        content_template: '{customer_name}，感谢一直以来的喜爱，生日月为你准备了一张{coupon_value_text}专享礼券，7天内到店可用。'
      }
    },
    {
      rule_key: 'lost_lowfreq_lastcall',
      name: '流失低频客一次性小券',
      priority: 40,
      auto_execute: true,
      criteria: { lifecycle_stage: 'churned' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 1200,
        valid_days: 7,
        coupon_name: '回归小券',
        title_template: '我们想念你',
        content_template: '{customer_name}，好久没见啦，这张{coupon_value_text}小券为你保留7天，欢迎回来坐坐。'
      }
    },
    {
      rule_key: 'prospect_light_touch',
      name: '潜在新客轻触达',
      priority: 50,
      auto_execute: true,
      criteria: { lifecycle_stage: 'prospect' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '潜在新客推荐菜',
        content_template: '{customer_name}，欢迎关注我们。下次到店推荐你试试 {favorite_dishes_text}，提前说一声帮你安排好。'
      }
    },
    {
      rule_key: 'seven_days_no_visit',
      name: '7天未到店关怀',
      priority: 35,
      auto_execute: true,
      criteria: { min_visit_count: 1, max_visit_count: 1, min_days_since_last_visit: 8, max_days_since_last_visit: 20, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '7天未到店关怀',
        content_template: '{customer_name}，好久不见，已经{days_since_last_visit}天没见到你了，最近有空来坐坐？'
      }
    },
    {
      rule_key: 'bad_review_compensation',
      name: '差评补偿关怀',
      priority: 5,
      auto_execute: false,
      criteria: { manual_trigger: true },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'wecom',
        coupon_value_fen: 2000,
        valid_days: 14,
        coupon_name: '差评补偿券',
        title_template: '差评补偿关怀',
        content_template: '{customer_name}，非常抱歉上次的用餐体验未能达到您的预期，为表歉意特送上{coupon_value_text}补偿券，期待您的再次光临。'
      }
    },
    {
      rule_key: 'new_dish_launch_notify',
      name: '新品上线通知',
      priority: 45,
      auto_execute: true,
      criteria: { min_visit_count: 4, min_days_since_last_visit: 5, max_days_since_last_visit: 20 },
      action_type: 'send_message',
      action_payload: {
        channel: 'wecom',
        title_template: '新品上线通知',
        content_template: '{customer_name}，我们新菜上线啦！作为老朋友第一时间告诉你，欢迎来尝鲜～'
      }
    },
    // 长期流失客召回（90天以上）：渠道走短信(企微/订阅触达率为0)，钩子随流失时长递增；
    // 默认未审批(approved_at 为空→不自动发)，需在 HRMS 审批并备好对应短信报备模板后再启用。
    {
      rule_key: 'lost_90_winback',
      name: '流失客(3-6月)召回券',
      priority: 42,
      auto_execute: true,
      criteria: { lifecycle_stage: 'lost_90', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'sms',
        coupon_value_fen: 2000,
        valid_days: 15,
        coupon_name: '老客回归券',
        title_template: '好久不见召回',
        content_template: '{customer_name}，好久没见啦，这张{coupon_value_text}回归券为你保留15天，欢迎回来尝尝。'
      }
    },
    {
      rule_key: 'lost_180_winback',
      name: '流失客(6-12月)召回券',
      priority: 43,
      auto_execute: true,
      criteria: { lifecycle_stage: 'lost_180', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'sms',
        coupon_value_fen: 3000,
        valid_days: 15,
        coupon_name: '老客回归券',
        title_template: '想念你召回',
        content_template: '{customer_name}，很久没见到你啦，这张{coupon_value_text}回归券为你保留15天，期待你回来。'
      }
    },
    {
      rule_key: 'lost_365_winback',
      name: '流失客(1年+)唤醒大券',
      priority: 44,
      auto_execute: true,
      criteria: { lifecycle_stage: 'lost_365', value_tier_not: 'vip' },
      action_type: 'send_voucher',
      action_payload: {
        channel: 'sms',
        coupon_value_fen: 5000,
        valid_days: 15,
        coupon_name: '老客唤醒大券',
        title_template: '老朋友唤醒',
        content_template: '{customer_name}，太久没见啦，特地为你准备{coupon_value_text}唤醒大券，保留15天，欢迎回来坐坐。'
      }
    },
    {
      // 储值余额提醒：收编进自动营销当一条规则。channel='balance' → 引擎跳过逐人触达，
      // 由 enqueueAutoStoredValueReminds 触发器按门店每日冻结余额提醒任务(无券无码)。
      // 默认未审核(approved_at=null) → 治理门拦住，需在面板「审核通过 + 启用」才会自动跑。
      rule_key: 'stored_value_remind',
      name: '储值余额提醒',
      priority: 15,
      auto_execute: true,
      criteria: { dormant_days: 30, min_balance_yuan: 1 },
      action_type: 'send_message',
      action_payload: { channel: 'balance' }
    },
    {
      // 新客二次召回·21-60天：到店仅1次、首访后21-60天未回头(非VIP；VIP另走VIP维护)。
      // 现金券(value/date/code)，券面额/有效期在「自动营销」面板按效果调整(coupon_value_fen=0时不发)。
      rule_key: 'newcomer_recall_21_60',
      name: '新客二次召回·21-60天',
      priority: 28,
      auto_execute: true,
      criteria: { min_visit_count: 1, max_visit_count: 1, min_days_since_last_visit: 21, max_days_since_last_visit: 60, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'newcomer_recall', valid_days: 14, coupon_value_fen: 0 }
    },
    {
      // 常客降温唤醒·21-60天：到店≥2次、21-60天未回头(排除VIP与"活跃"阶段，避免与VIP维护/活跃经营重叠)。
      // 赠品券(date/code，复用活跃模板)，有效期在面板调整。
      rule_key: 'regular_cooling_21_60',
      name: '常客降温唤醒·21-60天',
      priority: 29,
      auto_execute: true,
      criteria: { min_visit_count: 2, min_days_since_last_visit: 21, max_days_since_last_visit: 60, value_tier_not: 'vip', lifecycle_stage_not: 'active' },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'regular_cooling', valid_days: 14 }
    },
    {
      // VIP专属召回·61-365天：VIP客在61-365天未到店，单独走专属现金券召回(SMS_507220292/SMS_507240296)。
      // 与 dormant_vip_winback(VIP·0-60天)衔接，与沉睡/长期阶梯互斥(后者已加 value_tier_not:'vip')。
      // 现金券(value/date/code)，券面额/有效期在「自动营销」面板按效果调整(coupon_value_fen=0时不发)。
      rule_key: 'vip_winback_61_365',
      name: 'VIP专属召回·61-365天',
      priority: 26,
      auto_execute: true,
      criteria: { value_tier: 'vip', min_days_since_last_visit: 61, max_days_since_last_visit: 365 },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'vip_winback', valid_days: 14, coupon_value_fen: 0 }
    },
    {
      // 到店未买单潜客召回：扫码/陪客但从未下单(lifecycle=prospect)。先赠券(¥30/¥50/2×¥50)后赠菜，
      // 走 ABC 轮换，用现金券钩子促成首次消费。复用 ABC 6模板，无需新报备模板。
      rule_key: 'prospect_recall',
      name: '到店未买单潜客召回',
      priority: 52,
      auto_execute: true,
      criteria: { lifecycle_stage: 'prospect' },
      action_type: 'send_message',
      action_payload: { channel: 'sms', campaign_key: 'prospect_recall', valid_days: 14 }
    }
  ];
  // ALLOWED_SYSTEM_DEFAULT: 启动期仅给 default 播种触达规则（single 现网）；multi 应走平台开通种子
  // 启动期默认规则种子，无HTTP请求上下文，固定按default租户播种
  await tenantContext.run('default', async () => {
    for (const rule of defaultTouchRules) {
      await pool.query(
        // 仅作首次默认种子：已存在则保留运营在 HRMS UI 上的编辑（渠道/短信模板/券额/频次/审批），
        // 避免每次进程重启用代码默认值覆盖用户配置。
        `INSERT INTO growth_touch_rules (rule_key, name, enabled, priority, auto_execute, criteria, action_type, action_payload, tenant_id)
         VALUES ($1,$2,TRUE,$3,$4,$5::jsonb,$6,$7::jsonb,'default')
         ON CONFLICT (rule_key, tenant_id) DO NOTHING`,
        [
          rule.rule_key,
          rule.name,
          rule.priority,
          rule.auto_execute !== false,
          JSON.stringify(rule.criteria || {}),
          rule.action_type,
          JSON.stringify(rule.action_payload || {})
        ]
      );
    }
    await pool.query(
      `DELETE FROM growth_touch_rules WHERE rule_key = ANY($1::text[])`,
      [['churn_21_return_coupon', 'churn_45_return_coupon', 'birthday_month_touch', 'high_frequency_upgrade',
        'high_risk_churn_voucher', 'lost_customer_miss_you', 'silent_new_customer_activate']]
    );
  });
}

export async function upsertCustomer(pool, payload, tenantId = 'default') {
  const phone = cleanPhone(payload.phone);
  const openid = cleanText(payload.openid, 128);
  const externalUserId = cleanText(payload.external_userid, 128);
  const storeId = cleanText(payload.store_id, 128);
  const meta = payload.customer_meta && typeof payload.customer_meta === 'object' ? payload.customer_meta : {};

  if (!phone && !openid && !externalUserId) return null;

  let existing = null;
  if (phone) {
    const r = await pool.query('SELECT * FROM growth_customers WHERE phone = $1 AND tenant_id = $2 LIMIT 1', [phone, tenantId]);
    existing = r.rows[0] || null;
  }
  if (!existing && openid) {
    const r = await pool.query('SELECT * FROM growth_customers WHERE openid = $1 AND tenant_id = $2 LIMIT 1', [openid, tenantId]);
    existing = r.rows[0] || null;
  }

  // 若按手机号匹配到的记录将把 openid 改写为另一条记录已占用的值（同一 openid 此前绑定在不同/无手机号的记录上），
  // 先释放该记录的 openid，避免下面的 UPDATE 触发 uq_growth_customers_openid 冲突。
  if (existing && openid && existing.openid !== openid) {
    const conflict = await pool.query('SELECT id FROM growth_customers WHERE openid = $1 AND tenant_id = $2 LIMIT 1', [openid, tenantId]);
    const conflictId = conflict.rows[0]?.id;
    if (conflictId && conflictId !== existing.id) {
      await pool.query('UPDATE growth_customers SET openid = NULL, updated_at = NOW() WHERE id = $1', [conflictId]);
    }
  }

  if (existing) {
    const r = await pool.query(
      `UPDATE growth_customers SET
         phone = COALESCE(NULLIF($2,''), phone),
         openid = COALESCE(NULLIF($3,''), openid),
         external_userid = COALESCE(NULLIF($4,''), external_userid),
         first_store_id = COALESCE(first_store_id, NULLIF($5,'')),
         last_store_id = COALESCE(NULLIF($5,''), last_store_id),
         last_seen_at = NOW(),
         meta = COALESCE(meta, '{}'::jsonb) || $6::jsonb,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [existing.id, phone, openid, externalUserId, storeId, JSON.stringify(meta)]
    );
    existing = r.rows[0];
  } else {
    const r = await pool.query(
      `INSERT INTO growth_customers (phone, openid, external_userid, first_store_id, last_store_id, meta, tenant_id)
       VALUES (NULLIF($1,''), NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($4,''), $5::jsonb, $6)
       ON CONFLICT (openid, tenant_id) WHERE openid IS NOT NULL AND openid <> '' DO UPDATE SET
         phone = COALESCE(growth_customers.phone, EXCLUDED.phone),
         external_userid = COALESCE(EXCLUDED.external_userid, growth_customers.external_userid),
         last_store_id = COALESCE(EXCLUDED.last_store_id, growth_customers.last_store_id),
         last_seen_at = NOW(),
         meta = COALESCE(growth_customers.meta, '{}'::jsonb) || EXCLUDED.meta,
         updated_at = NOW()
       RETURNING *`,
      [phone, openid, externalUserId, storeId, JSON.stringify(meta), tenantId]
    );
    existing = r.rows[0];
  }

  const identities = [
    ['phone', phone],
    ['openid', openid],
    ['external_userid', externalUserId]
  ].filter(([, value]) => value);
  for (const [type, value] of identities) {
    await pool.query(
      `INSERT INTO customer_identities (customer_id, identity_type, identity_value, source, tenant_id)
       VALUES ($1,$2,$3,'miniprogram',$4)
       ON CONFLICT (identity_type, identity_value, tenant_id)
       DO UPDATE SET customer_id = EXCLUDED.customer_id, updated_at = NOW()`,
      [existing.id, type, value, tenantId]
    );
  }

  return existing;
}

async function backfillRedemptionAmounts(pool) {
  const r = await pool.query(`
    WITH matched AS (
      SELECT DISTINCT ON (gr.id) gr.id AS redemption_id, po.amount_after_discount
      FROM growth_redemptions gr
      JOIN growth_customers gc ON gc.id = gr.customer_id
      JOIN pos_orders po ON po.store_id = gr.store_id AND po.phone = gc.phone
        AND po.order_time BETWEEN gr.redeemed_at - INTERVAL '2 hours' AND gr.redeemed_at + INTERVAL '30 minutes'
      WHERE gr.amount_fen = 0
        AND NULLIF(gc.phone, '') IS NOT NULL
        AND NULLIF(gr.store_id, '') IS NOT NULL
      ORDER BY gr.id, ABS(EXTRACT(EPOCH FROM (po.order_time - gr.redeemed_at)))
    )
    UPDATE growth_redemptions gr
    SET amount_fen = GREATEST(0, ROUND(matched.amount_after_discount * 100))
    FROM matched
    WHERE gr.id = matched.redemption_id
    RETURNING gr.id
  `);
  // 同步把对应的 coupon_redeemed 事件记录一起补齐，保持两表一致。
  await pool.query(`
    UPDATE growth_events ge
    SET amount_fen = gr.amount_fen
    FROM growth_redemptions gr
    WHERE ge.event_type = 'coupon_redeemed' AND ge.amount_fen = 0 AND gr.amount_fen > 0
      AND ge.customer_id = gr.customer_id AND ge.coupon_id = gr.coupon_id AND ge.occurred_at = gr.redeemed_at
  `).catch(() => {});
  return r.rows.length;
}

// T+7 SMS自动回填：找已发送7天以上且无outcome_summary的短信AI建议，
// 按customer_id+store_id+7天窗口匹配核销数据，自动打分写回并沉淀经验库(is_verified=true)。
async function autoBackfillSmsActions(pool) {
  const candidates = await pool.query(`
    SELECT a.action_key, a.store_id, a.payload
    FROM growth_actions a
    WHERE a.payload->>'channel' = 'sms'
      AND (a.payload->'outcome_summary') IS NULL
      AND a.updated_at <= NOW() - INTERVAL '7 days'
      AND EXISTS (
        SELECT 1 FROM growth_delivery_logs dl
        WHERE dl.action_key = a.action_key AND dl.status = 'sent'
      )
      AND NOT EXISTS (
        SELECT 1 FROM growth_learnings gl
        WHERE gl.source_type = 'ai_suggestion' AND gl.source_id = a.action_key
      )
    LIMIT 50
  `);
  let count = 0;
  for (const action of candidates.rows) {
    try {
      const { action_key, store_id, payload } = action;
      const reachR = await pool.query(
        `SELECT COUNT(*)::int AS reach, MIN(created_at) AS first_sent
         FROM growth_delivery_logs WHERE action_key=$1 AND status='sent'`,
        [action_key]
      );
      const reach = reachR.rows[0]?.reach || 0;
      const firstSent = reachR.rows[0]?.first_sent;
      if (reach === 0 || !firstSent) continue;

      const redR = await pool.query(
        `SELECT COUNT(*)::int AS redemptions, COALESCE(SUM(gr.amount_fen),0)::bigint AS revenue_fen
         FROM growth_redemptions gr
         WHERE gr.customer_id IN (
           SELECT customer_id FROM growth_delivery_logs WHERE action_key=$1 AND status='sent' AND customer_id IS NOT NULL
         )
         AND gr.store_id = $2
         AND gr.redeemed_at BETWEEN $3::timestamptz AND $3::timestamptz + INTERVAL '7 days'`,
        [action_key, store_id, firstSent]
      );
      const redemptions = redR.rows[0]?.redemptions || 0;
      const revenue_fen = Number(redR.rows[0]?.revenue_fen || 0);

      const expected = (payload.expected_kpi && typeof payload.expected_kpi === 'object') ? payload.expected_kpi : {};
      const parts = [];
      if (Number(expected.reach) > 0) parts.push(Math.min(2, reach / Number(expected.reach)));
      const actualRate = reach > 0 ? (redemptions / reach) * 100 : 0;
      if (Number(expected.redemption_rate) > 0) parts.push(Math.min(2, actualRate / Number(expected.redemption_rate)));
      if (Number(expected.revenue_fen) > 0) parts.push(Math.min(2, revenue_fen / Number(expected.revenue_fen)));
      const achievement = parts.length ? parts.reduce((a, c) => a + c, 0) / parts.length : null;
      const score = achievement != null ? Math.round(Math.min(100, achievement * 80)) : null;
      const effectiveness = score == null ? '已回填' : score >= 70 ? '有效' : score >= 40 ? '部分有效' : '无效';

      const scorePayload = {
        actual: { reach, redemptions, revenue_fen },
        actual_redemption_rate: reach > 0 ? Number((redemptions / reach * 100).toFixed(1)) : 0,
        achievement: achievement != null ? Number(achievement.toFixed(2)) : null,
        effectiveness_score: score,
        effectiveness,
        scored_at: new Date().toISOString(),
        auto_backfill: true
      };
      await pool.query(
        `UPDATE growth_actions SET payload = COALESCE(payload,'{}') || $2::jsonb, updated_at=NOW() WHERE action_key=$1`,
        [action_key, JSON.stringify({ outcome_summary: scorePayload })]
      );

      const approach = cleanText(payload.ready_copy || payload.execution_action || '', 500);
      if (approach) {
        const isWin = score != null && score >= 70;
        const effectDesc = cleanText(
          `${effectiveness}｜核销率${Number(actualRate.toFixed(1))}%，实收¥${Math.round(revenue_fen / 100)}，达成${achievement != null ? Math.round(achievement * 100) + '%' : '-'}(自动回填)`,
          255
        );
        await pool.query(
          `INSERT INTO growth_learnings (source_type, source_id, store_code, channel, scene, audience_tag, variable, winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, is_verified, tenant_id)
           VALUES ('ai_suggestion',$1,$2,'sms',NULL,$3,'AI建议方案有效性',$4,$5,$6,$7,$8,$9,true,$10)
           ON CONFLICT DO NOTHING`,
          [
            action_key,
            cleanText(store_id, 128),
            cleanText(payload.target_audience || '', 120) || null,
            isWin ? approach : '换其它方向（避免重复）',
            isWin ? null : approach,
            effectDesc,
            Math.min(reach, 99999),
            reach >= 100 ? 'high' : reach >= 30 ? 'medium' : 'low',
            new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
            resolveTenantIdDefault()
          ]
        ).catch(() => {});
      }
      count++;
    } catch (e) {
      log.warn({ msg: 'sms_backfill_action_error', action_key: action.action_key, err: e?.message });
    }
  }
  return count;
}

export async function appendExecutionLog(pool, payload) {
  await pool.query(
    `INSERT INTO growth_execution_logs (
      action_key, strategy_key, store_id, action_type, decision,
      operator_username, operator_role, before_payload, after_payload,
      decision_reason, result_summary, tenant_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
    [
      cleanText(payload.action_key, 255),
      cleanText(payload.strategy_key, 255),
      cleanText(payload.store_id, 128),
      cleanText(payload.action_type, 80),
      cleanText(payload.decision, 80),
      cleanText(payload.operator_username, 128),
      cleanText(payload.operator_role, 80),
      JSON.stringify(payload.before_payload || {}),
      JSON.stringify(payload.after_payload || {}),
      cleanText(payload.decision_reason, 2000),
      cleanText(payload.result_summary, 2000),
      resolveTenantIdDefault()
    ]
  );
}

async function getStateValue(pool, key) {
  const r = await pool.query(`SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`, [key]);
  return r.rows?.[0]?.data || null;
}

export async function insertGrowthEvent(pool, payload, tenantId = 'default') {
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  await pool.query(
    `INSERT INTO growth_events (
       event_type, customer_id, phone, openid, external_userid, store_id, campaign_id, channel,
       coupon_id, order_id, amount_fen, idempotency_key, metadata, occurred_at, tenant_id
     ) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),$11,NULLIF($12,''),$13::jsonb,$14,$15)
     ON CONFLICT (idempotency_key, tenant_id) DO NOTHING`,
    [
      cleanText(payload.event_type, 80),
      payload.customer_id ? Number(payload.customer_id) : null,
      cleanPhone(payload.phone),
      cleanText(payload.openid, 128),
      cleanText(payload.external_userid, 128),
      cleanText(payload.store_id, 128),
      cleanText(payload.campaign_id, 128),
      cleanText(payload.channel, 80),
      cleanText(payload.coupon_id, 128),
      cleanText(payload.order_id, 128),
      Math.max(0, Math.floor(Number(payload.amount_fen) || 0)),
      cleanText(payload.idempotency_key, 255),
      JSON.stringify(metadata),
      parseOccurredAt(payload.occurred_at),
      tenantId
    ]
  );
}

export async function upsertDeliveryLog(pool, payload, tenantId = 'default') {
  const r = await pool.query(
    `INSERT INTO growth_delivery_logs (
       delivery_key, action_key, rule_key, campaign_id, customer_id, store_id, channel,
       external_userid, provider_msg_id, status, payload, result, error_message, updated_at, tenant_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,NOW(),$14)
     ON CONFLICT (delivery_key, tenant_id) DO UPDATE SET
       provider_msg_id = COALESCE(NULLIF(EXCLUDED.provider_msg_id,''), growth_delivery_logs.provider_msg_id),
       status = EXCLUDED.status,
       result = EXCLUDED.result,
       error_message = EXCLUDED.error_message,
       updated_at = NOW()
     RETURNING *`,
    [
      cleanText(payload.delivery_key, 255),
      cleanText(payload.action_key, 255),
      cleanText(payload.rule_key, 128),
      cleanText(payload.campaign_id, 128) || cleanText(payload.rule_key, 128),
      payload.customer_id ? Number(payload.customer_id) : null,
      cleanText(payload.store_id, 128),
      cleanText(payload.channel || 'wecom', 40),
      cleanText(payload.external_userid, 128),
      cleanText(payload.provider_msg_id, 255),
      cleanText(payload.status || 'pending', 40),
      JSON.stringify(payload.payload || {}),
      JSON.stringify(payload.result || {}),
      cleanText(payload.error_message, 2000),
      tenantId
    ]
  );
  return r.rows[0] || null;
}

let __growthWecomTokenCache = { token: '', expiresAt: 0, store_id: '' };
let __storeWecomTokenCaches = {};

export async function getWecomConfig(pool) {
  const config = await getStateValue(pool, 'growth_wecom_config');
  return config && typeof config === 'object' ? config : null;
}

export async function getStoreWecomConfig(pool, storeId) {
  if (!storeId) return null;
  const r = await pool.query('SELECT * FROM store_wecom_configs WHERE store_id = $1 LIMIT 1', [storeId]);
  return r.rows[0] || null;
}

// 桥接：企微 token 缓存是本模块内的可变共享状态，供已搬到 growth-wecom-feishu-routes.js
// 的路由（重置全局 token / 清除门店 token）复用，不直接导出可变 let 变量。
export function resetGrowthWecomTokenCache() {
  __growthWecomTokenCache = { token: '', expiresAt: 0, store_id: '' };
}

export function clearStoreWecomTokenCache(storeId) {
  delete __storeWecomTokenCaches[storeId];
}

// 企微小程序/webhook 等无 JWT 上下文的入口，通过 store 反查其所属租户（employees.store → tenant_id）。
// 查不到（如全新门店尚无员工档案）时回退 'default'，与全库其它表的默认行为一致。
let __storeTenantCache = {};
let __storeTenantCacheAt = 0;
export async function resolveTenantIdForStore(pool, storeId) {
  const sid = String(storeId || '').trim();
  if (!sid) return 'default';
  const now = Date.now();
  if (now - __storeTenantCacheAt > 300000) { __storeTenantCache = {}; __storeTenantCacheAt = now; }
  if (__storeTenantCache[sid]) return __storeTenantCache[sid];
  try {
    const r = await pool.query(`SELECT tenant_id FROM ${SHARED_TABLES.EMPLOYEES} WHERE store = $1 AND tenant_id IS NOT NULL LIMIT 1`, [sid]);
    const tid = String(r.rows?.[0]?.tenant_id || '').trim() || 'default';
    __storeTenantCache[sid] = tid;
    return tid;
  } catch (_e) {
    return 'default';
  }
}

export async function getAllStoreWecomConfigs(pool) {
  const r = await pool.query('SELECT * FROM store_wecom_configs ORDER BY store_id');
  return r.rows;
}

export async function getWecomAccessToken(pool, storeId) {
  const now = Date.now();
  let corpId, corpSecret;

  if (storeId) {
    const cached = __storeWecomTokenCaches[storeId];
    if (cached && cached.token && cached.expiresAt > now + 10000) return cached.token;
    const storeConfig = await getStoreWecomConfig(pool, storeId);
    if (storeConfig) {
      corpId = cleanText(storeConfig.corp_id, 200);
      corpSecret = cleanText(storeConfig.corp_secret, 500);
    } else {
      const globalConfig = await getWecomConfig(pool);
      corpId = cleanText(globalConfig?.corp_id, 200);
      corpSecret = cleanText(globalConfig?.corp_secret, 500);
    }
  } else {
    if (__growthWecomTokenCache.token && __growthWecomTokenCache.expiresAt > now + 10000) return __growthWecomTokenCache.token;
    const config = await getWecomConfig(pool);
    corpId = cleanText(config?.corp_id, 200);
    corpSecret = cleanText(config?.corp_secret, 500);
  }

  if (!corpId || !corpSecret) throw new Error('missing_wecom_config');
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  const resp = await fetch(url, { method: 'GET' });
  const data = await resp.json();
  if (!resp.ok || Number(data?.errcode) !== 0 || !data?.access_token) throw new Error(data?.errmsg || 'wecom_token_failed');

  const token = cleanText(data.access_token, 500);
  const expiresAt = now + Math.max(300, Number(data.expires_in) || 7200) * 1000;

  if (storeId) {
    __storeWecomTokenCaches[storeId] = { token, expiresAt };
  } else {
    __growthWecomTokenCache = { token, expiresAt, store_id: '' };
  }
  return token;
}

async function sendWecomExternalMessage(pool, payload) {
  const storeId = cleanText(payload.store_id, 128);
  let config;
  if (storeId) {
    config = await getStoreWecomConfig(pool, storeId);
  }
  if (!config) {
    config = await getWecomConfig(pool);
  }
  const senderUserId = cleanText(payload.sender_userid || config?.sender_userid, 128);
  const externalUserId = cleanText(payload.external_userid, 128);
  const content = cleanText(payload.content, 1800);
  if (!senderUserId) throw new Error('missing_wecom_sender_userid');
  if (!externalUserId) throw new Error('missing_external_userid');
  if (!content) throw new Error('missing_message_content');
  const accessToken = await getWecomAccessToken(pool, storeId);
  const resp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/add_msg_template?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_type: 'single',
      external_userid: [externalUserId],
      sender: senderUserId,
      allow_select: false,
      text: { content }
    })
  });
  const data = await resp.json();
  if (!resp.ok || Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'wecom_send_failed');
  return { provider_msg_id: cleanText(data?.msgid || data?.msgid_list?.[0], 255), raw: data };
}

// 飞书多维表字段值解析(文本/数字/日期/电话)
export function bitText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x && (x.text || x.name)) || x).join(',');
  if (typeof v === 'object') return String(v.text || v.name || '');
  return String(v);
}
export function bitNum(v) {
  if (v == null) return 0;
  if (typeof v === 'object' && v.text != null) return Number(v.text) || 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
export function bitDateMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (!isNaN(n) && n > 1e10) return n; // epoch ms
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
export function bitPhone(v) { return bitText(v).replace(/[^0-9]/g, ''); }

// 用 BITABLE_TASK_RESP 飞书应用获取 tenant_access_token(该应用对储值客户表有读权限)
async function getBitableTenantToken() {
  const id = process.env.BITABLE_TASK_RESP_APP_ID;
  const secret = process.env.BITABLE_TASK_RESP_APP_SECRET;
  if (!id || !secret) throw new Error('bitable_app_not_configured');
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: id, app_secret: secret })
  });
  const d = await r.json();
  if (!d.tenant_access_token) throw new Error('bitable_token_failed:' + (d.code || '') + ' ' + (d.msg || ''));
  return d.tenant_access_token;
}
// 分页读「储值客户」多维表全部记录
export async function readStoredValueBitableRecords() {
  const appToken = process.env.STORED_VALUE_BITABLE_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe';
  const tableId = process.env.STORED_VALUE_BITABLE_TABLE_ID || 'tblvAcEjXHmEYQGZ';
  const token = await getBitableTenantToken();
  let all = [];
  let pageToken = '';
  for (let i = 0; i < 500; i++) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500` + (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    const d = await (await fetch(url, { headers: { Authorization: 'Bearer ' + token } })).json();
    if (d.code !== 0) throw new Error('bitable_read_failed:' + d.code + ' ' + d.msg);
    all = all.concat((d.data && d.data.items) || []);
    if (d.data && d.data.has_more && d.data.page_token) pageToken = d.data.page_token; else break;
  }
  return all;
}

export async function executeGrowthActionRecord(pool, before, operator, extraPayload = {}, reason = '') {
  const tenantId = String(before.tenant_id || 'default').trim() || 'default';
  const basePayload = before.payload && typeof before.payload === 'object' ? before.payload : {};
  const payload = Object.assign({}, basePayload, extraPayload || {});
  const storeId = cleanText(before.store_id || payload.store_id, 128);
  const campaignId = cleanText(before.campaign_id || payload.campaign_id, 128);
  const actionType = cleanText(before.action_type, 80);
  const actionKey = cleanText(before.action_key, 255);
  let executionResults = { action_type: actionType, real_executions: [] };

  const ctx = {
    pool, before, payload, storeId, campaignId, actionType, actionKey, tenantId, operator, executionResults,
    cleanText, cleanPhone, buildActionMessage, sendWecomExternalMessage,
    upsertDeliveryLog, insertGrowthEvent, buildSmsTemplateParam, pickSmsTemplateByStore,
    globalSmsCapped, isPhoneSuppressed, sendAliyunSms, handleSmsFailure,
    isSubscribePushConfigured, postSubscribePush,
    isMemberCouponPushConfigured, postMemberCouponPush,
  };

  try {
    await applyGrowthActionTypeEffects(ctx);
    await deliverGrowthActionChannels(ctx);
  } catch (execErr) {
    executionResults.error = execErr?.message;
  }

  const result = await pool.query(
    `UPDATE growth_actions
     SET status = 'executed',
         payload = CASE WHEN $2::jsonb = '{}'::jsonb THEN payload ELSE COALESCE(payload,'{}'::jsonb) || $2::jsonb END,
         updated_at = NOW(),
         executed_at = NOW()
     WHERE action_key = $1
     RETURNING *`,
    [actionKey, JSON.stringify(Object.assign({}, payload, executionResults))]
  );
  await appendExecutionLog(pool, {
    action_key: actionKey,
    strategy_key: cleanText(basePayload.strategy_key || payload.strategy_key || '', 255),
    store_id: storeId,
    action_type: actionType,
    decision: 'executed',
    operator_username: operator.username,
    operator_role: operator.role,
    before_payload: basePayload,
    after_payload: result.rows[0]?.payload || {},
    decision_reason: cleanText(reason, 2000),
    result_summary: `真实执行: ${executionResults.real_executions.map((e) => `${e.type}=${Object.values(e).slice(1).join(',')}`).join('; ') || 'none'}`
  });
  return { action: result.rows[0], execution: executionResults };
}

async function createChurnAlert(pool, rule, row) {
  const days = Math.max(0, Math.floor(Number(row.days_since_last_visit) || 0));
  const alertKey = `churn:${cleanText(rule.rule_key, 128)}:${Number(row.customer_id) || 0}:${fmtYmd(row.last_visit_at)}`;
  await pool.query(
    `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics, tenant_id)
     VALUES ($1,'churn','medium',$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (alert_key, tenant_id) DO UPDATE SET message = EXCLUDED.message, metrics = EXCLUDED.metrics, status = 'open', updated_at = NOW()`,
    [
      alertKey,
      cleanText(row.store_id, 128),
      `${days}天未到店流失预警`,
      `${cleanText(row.customer_name || row.phone || `客户#${row.customer_id}`, 120)} 已${days}天未到店，系统已自动触发回流触达。`,
      '已由规则引擎自动发送回流触达',
      JSON.stringify({ customer_id: row.customer_id, days_since_last_visit: days, rule_key: rule.rule_key }),
      resolveTenantIdDefault()
    ]
  );
}

export async function recomputeDiningSegments(pool, tenantId = 'default') {
  const BJ = "AT TIME ZONE 'Asia/Shanghai'";
  const hj = `LEFT JOIN cn_holiday_calendar h ON h.day=(order_time ${BJ})::date AND h.day_type='holiday'
              LEFT JOIN cn_holiday_calendar w ON w.day=(order_time ${BJ})::date AND w.day_type='workday'`;
  const eff = `((extract(dow from order_time ${BJ}) BETWEEN 1 AND 5 AND h.day IS NULL) OR w.day IS NOT NULL)`;
  const mjSid = _storeId('马己仙');
  const hcSid = _storeId('洪潮');
  await pool.query(`DELETE FROM growth_segment_members WHERE segment_key='mj_dinner_weekend_repeat' AND tenant_id=$1`, [tenantId]);
  const mj = await pool.query(`INSERT INTO growth_segment_members(phone,segment_key,store_id,tenant_id)
    SELECT phone,'mj_dinner_weekend_repeat','${mjSid}',$1 FROM (
      SELECT phone,
        count(*) FILTER (WHERE extract(hour from order_time ${BJ})>=16) dinner,
        count(*) FILTER (WHERE extract(dow from order_time ${BJ}) IN (0,6)) weekend
      FROM pos_orders WHERE store_id='${mjSid}' AND order_time IS NOT NULL AND phone<>'' AND tenant_id=$1 GROUP BY phone
    ) t WHERE dinner>=2 OR weekend>=2 ON CONFLICT DO NOTHING`, [tenantId]);
  await pool.query(`DELETE FROM growth_segment_members WHERE segment_key='hc_weekday_lunch' AND tenant_id=$1`, [tenantId]);
  const hc = await pool.query(`INSERT INTO growth_segment_members(phone,segment_key,store_id,tenant_id)
    SELECT DISTINCT phone,'hc_weekday_lunch','${hcSid}',$1 FROM (
      SELECT phone FROM pos_orders ${hj} WHERE store_id='${hcSid}' AND order_time IS NOT NULL AND phone<>'' AND pos_orders.tenant_id=$1
        AND ${eff} AND extract(hour from order_time ${BJ}) BETWEEN 10 AND 15
    ) t ON CONFLICT DO NOTHING`, [tenantId]);
  return { mj_dinner_weekend_repeat: mj.rowCount, hc_weekday_lunch: hc.rowCount };
}

// POS数据滞后阈值（天）。上传频率为每2天一次，超过3天视为异常。
const POS_STALE_DAYS = 3;

// 活动制规则：把命中候选「冻结」成发券任务(growth_campaign_jobs, kind=campaign_key)，
// 由小程序 runWinbackJobs 生成短码+写 user_vouchers + 调 /campaign/send-sms 下发，券码可核销可归因。
// 治理门：仅在 规则已审核 + 启用 + auto + 短信总闸(ALIYUN_SMS_ENABLED)开 时才自动冻结，
// 任一不满足都不发(开关默认关闭即全部静默，与 smsAutoBlocked 同款守护)。
// 幂等：同活动+同店+同日 一个任务(引擎每15分钟跑)。频控/全局总闸由 /campaign/send-sms 在发送时兜底。
async function enqueueCampaignJobsForRule(pool, rule, candidates, campaignKey, claimedPhones = null) {
  const cfg = CAMPAIGN_TYPES[campaignKey];
  if (!cfg) return { enqueued: 0, skipped: 'unknown_campaign' };
  const ap = rule.action_payload || {};
  const ok = rule.enabled && !!rule.approved_at && rule.auto_execute !== false && isAliyunSmsAutoSendEnabled();
  if (!ok) return { enqueued: 0, skipped: 'governance' };
  const valueYuan = Math.max(0, Math.floor(Number(ap.coupon_value_fen || ap.value_fen || 0) / 100));
  const validDays = Math.max(1, Math.floor(Number(ap.valid_days) || 14));
  const abcOrder = ABC_ROTATION_ORDER[campaignKey];
  const needsValue = Array.isArray(cfg.vars) && cfg.vars.includes('value');
  // ABC 6模板滚动：面额按当前模板步骤(ABC_STEP_DEFS)推导，不依赖规则自身的 coupon_value_fen。
  if (needsValue && valueYuan <= 0 && !abcOrder) return { enqueued: 0, skipped: 'missing_value' };
  // 冻结前预排除「近 global-freq 天内已成功发过短信」的号码：与发送端 globalSmsCapped 同口径，
  // 双保险确保不对已触达客户重复建券/重复发短信(发送端也会再兜底跳过，此处避免空建券)。
  const gDays = freqDaysEnv('ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS', 7);
  let recentSentSet = new Set();
  if (gDays > 0) {
    const rc = await pool.query(
      `SELECT DISTINCT payload->>'phone' AS phone FROM growth_delivery_logs
         WHERE channel='sms' AND status='sent' AND created_at > now() - ($1 || ' days')::interval`,
      [String(gDays)]
    );
    recentSentSet = new Set((rc.rows || []).map((r) => String(r.phone || '')).filter(Boolean));
  }
  // 抑制名单：停机/黑名单号码冻结前剔除（发送端也兜底，此处避免空建券）
  const supRes = await pool.query(`SELECT phone FROM growth_sms_suppression`);
  const suppressedSet = new Set((supRes.rows || []).map((r) => String(r.phone || '')));
  const candPhones = [...new Set(candidates.map((c) => cleanPhone(c.phone)).filter(Boolean))];
  // 跨活动疲劳总闸：近 window 天内、最近一次到店之后累计收满 max 条【任意活动】营销短信仍未回店
  // → 暂停其所有营销(冻结前剔除，避免空建券；发送端 marketingFatigueCapped 再兜底)。
  let fatigueSet = new Set();
  if (candPhones.length) {
    const fr = await pool.query(
      `WITH lastvisit AS (
         SELECT phone, MAX(pos_last_order_at) AS lv FROM growth_customer_profiles
          WHERE phone = ANY($1::text[]) GROUP BY phone
       )
       SELECT dl.payload->>'phone' AS phone FROM growth_delivery_logs dl
         LEFT JOIN lastvisit lv ON lv.phone = dl.payload->>'phone'
        WHERE dl.channel='sms' AND dl.status='sent'
          AND dl.payload->>'phone' = ANY($1::text[])
          AND dl.created_at > now() - ($2 || ' days')::interval
          AND dl.created_at > COALESCE(lv.lv, '1970-01-01'::timestamptz)
        GROUP BY 1 HAVING count(*) >= $3`,
      [candPhones, String(marketingFatigueWindowDays()), marketingFatigueMax()]
    );
    fatigueSet = new Set((fr.rows || []).map((r) => String(r.phone || '')).filter(Boolean));
  }
  // ABC 滚动：批量预取每个手机号在本活动下「最近一次到店之后」的成功发送数 n + 最后发送时间，
  // 用于推导当前轮换步骤(n)与每步降频冷却(last_sent，避免冷却期内重复建券超发券)。
  let abcSentByPhone = new Map();
  if (abcOrder && candPhones.length) {
    const sc = await pool.query(
      `WITH lastvisit AS (
         SELECT phone, MAX(pos_last_order_at) AS lv FROM growth_customer_profiles
          WHERE phone = ANY($2::text[]) GROUP BY phone
       )
       SELECT dl.payload->>'phone' AS phone, count(*)::int n, MAX(dl.created_at) AS last_sent FROM growth_delivery_logs dl
         LEFT JOIN lastvisit lv ON lv.phone = dl.payload->>'phone'
        WHERE dl.channel='sms' AND dl.status='sent' AND dl.rule_key = $1
          AND dl.payload->>'phone' = ANY($2::text[])
          AND dl.created_at > COALESCE(lv.lv, '1970-01-01'::timestamptz)
        GROUP BY 1`,
      [campaignKey, candPhones]
    );
    abcSentByPhone = new Map(sc.rows.map((r) => [r.phone, { n: Number(r.n), last: r.last_sent ? new Date(r.last_sent).getTime() : null }]));
  }
  // 变体分配：A/B 面额实验(ab_value_split=[a分,b分]，按手机号哈希均分) 优先于
  // 价值分档(coupon_value_fen_high：历史消费≥阈值的客人发高档面额)。都未配置则单一面额。
  const abSplit = Array.isArray(ap.ab_value_split) && ap.ab_value_split.length === 2
    ? ap.ab_value_split.map((v) => Math.max(0, Math.floor(Number(v) || 0))) : null;
  const highFen = Math.max(0, Math.floor(Number(ap.coupon_value_fen_high) || 0));
  const highThresholdFen = Math.max(0, Math.floor(Number(ap.high_spend_threshold_fen) || 50000));
  const pickVariant = (row, phone) => {
    if (abSplit && abSplit[0] > 0 && abSplit[1] > 0) {
      return phoneHashPct(phone) % 2 === 0
        ? { suffix: '_a', valueYuan: Math.floor(abSplit[0] / 100) }
        : { suffix: '_b', valueYuan: Math.floor(abSplit[1] / 100) };
    }
    // pos_total_spend 为「元」（POS amount_after_discount 累计），阈值按「分」配置 → 换算后比较
    if (highFen > 0 && Math.round(Number(row.pos_total_spend || 0) * 100) >= highThresholdFen) {
      return { suffix: '_hi', valueYuan: Math.floor(highFen / 100) };
    }
    return { suffix: '', valueYuan };
  };
  // 按 门店×变体 分组(一条规则覆盖两店，按门店分别冻结任务+解析已报备模板)
  const hPct = holdoutPct();
  const byGroup = new Map();
  let heldOut = 0;
  for (const row of candidates) {
    const phone = cleanPhone(row.phone);
    if (!phone) continue;
    if (recentSentSet.has(phone)) continue; // 近期已触达，跳过(防重复)
    if (suppressedSet.has(phone)) continue; // 永久抑制(停机/黑名单)
    if (fatigueSet.has(phone)) continue; // 跨活动疲劳：累计触达过多仍未回店 → 暂停所有营销
    if (claimedPhones && claimedPhones.has(phone)) continue; // 本轮已被更高优先级活动占用 → 一人一活动
    const sid = String(row.store_id || ap.store_id || '').trim();
    if (!sid) continue;
    let variant = null;
    let abcStep = null;
    if (abcOrder) {
      const rec = abcSentByPhone.get(phone) || { n: 0, last: null };
      const derived = deriveAbcStep(campaignKey, rec.n);
      if (derived.blacklisted) continue; // 已走完降频阶梯仍未回应 → 红名单，本活动不再自动触达
      // 降频冷却：距上次成功发送不足本步阶梯天数 → 跳过，避免冷却期内反复建券/超发券
      if (rec.last && derived.freqDaysOverride > 0 &&
          (Date.now() - rec.last) < derived.freqDaysOverride * 86400000) continue;
      if (!pickAbcTemplate(derived.step, sid)) continue; // 该门店该步骤模板未配置(后补)→跳过
      abcStep = derived.step;
      variant = { suffix: `_${abcStep}`, valueYuan: Math.floor(ABC_STEP_DEFS[abcStep].coupon_value_fen / 100) };
    } else {
      if (!pickCampaignTemplate(campaignKey, sid)) continue; // 该门店模板未配置(后补)→跳过，防整批拒收
    }
    // holdout 对照组：确定性抽样不发送，仅记录，用于衡量真实增量
    if (hPct > 0 && phoneHashPct(phone) < hPct) {
      heldOut++;
      await pool.query(
        `INSERT INTO growth_holdout_members (phone, campaign_key, store_id, tenant_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (phone, campaign_key, tenant_id) DO NOTHING`,
        [phone, campaignKey, sid, resolveTenantIdDefault()]
      ).catch(() => {});
      continue;
    }
    if (!variant) variant = pickVariant(row, phone);
    const gKey = `${sid}${variant.suffix}`;
    if (!byGroup.has(gKey)) byGroup.set(gKey, { sid, variant, abcStep, targets: [] });
    byGroup.get(gKey).targets.push({ phone, name: row.customer_name || '' });
    if (claimedPhones) claimedPhones.add(phone); // 占用该号码，本轮其它活动不再触达
  }
  const today = new Date().toISOString().slice(0, 10);
  let enqueued = 0;
  for (const [, g] of byGroup) {
    if (!g.targets.length) continue;
    const campaignId = `auto_${campaignKey}_${g.sid}_${today}${g.variant.suffix}`;
    const exist = await pool.query(`SELECT 1 FROM growth_campaign_jobs WHERE campaign_id = $1 LIMIT 1`, [campaignId]);
    if (exist.rows.length) continue; // 当日已冻结，避免重复
    const result = {
      campaign_key: campaignKey,
      coupon_count: g.abcStep ? ABC_STEP_DEFS[g.abcStep].coupon_count : cfg.coupon_count,
      rule_key: rule.rule_key,
    };
    if (g.variant.suffix) result.variant = g.variant.suffix.slice(1);
    if (g.abcStep) result.abc_step = g.abcStep;
    await pool.query(
      `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
       VALUES ($1,$2,$3,$4,0,0,$5::jsonb,$6,'pending',$7,$8,$9::jsonb,$10)`,
      [campaignId, g.sid, g.variant.valueYuan, validDays, JSON.stringify(g.targets), g.targets.length, campaignKey, `rule_engine:${rule.rule_key}`, JSON.stringify(result), resolveTenantIdDefault()]
    );
    enqueued += g.targets.length;
  }
  return { enqueued, held_out: heldOut };
}

export async function runTouchRuleEngine(pool, options = {}) {
  const ruleEngineTenantId = String(options.tenantId || 'default').trim() || 'default';
  // 第三层防护：POS数据新鲜度闸门。数据滞后会让全员被误判为临界/流失，
  // 进而乱发券。滞后超阈值时停止自动触达，改为告警人工核查。
  const freshRes = await pool.query(`SELECT MAX(biz_date) AS latest, (CURRENT_DATE - MAX(biz_date))::int AS lag_days FROM pos_orders`);
  const lagDays = Number(freshRes.rows?.[0]?.lag_days);
  if (!Number.isFinite(lagDays) || lagDays > POS_STALE_DAYS) {
    const latest = freshRes.rows?.[0]?.latest || null;
    const alertKey = `pos_stale_guard:${new Date().toISOString().slice(0, 10)}`;
    await pool.query(
      `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics, tenant_id)
       VALUES ($1,'data_freshness','high','',$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (alert_key, tenant_id) DO UPDATE SET message = EXCLUDED.message, metrics = EXCLUDED.metrics, status = 'open', updated_at = NOW()`,
      [
        alertKey,
        'POS数据滞后，已暂停自动营销触达',
        `POS最新数据为 ${latest || '无'}，滞后 ${Number.isFinite(lagDays) ? lagDays : '未知'} 天（阈值${POS_STALE_DAYS}天）。为避免基于过期数据误发券，规则引擎本次跳过。请尽快上传最新POS数据到飞书。`,
        '上传最新POS数据到飞书并触发 POST /api/growth/pos-feishu-sync',
        JSON.stringify({ latest_biz_date: latest, lag_days: Number.isFinite(lagDays) ? lagDays : null, threshold_days: POS_STALE_DAYS }),
        ruleEngineTenantId
      ]
    );
    return { created: 0, skipped: true, reason: 'pos_data_stale', lag_days: Number.isFinite(lagDays) ? lagDays : null };
  }
  const limitPerRule = Math.min(Math.max(Number(options.limit_per_rule) || 100, 1), 5000);
  const rulesResult = await pool.query(`SELECT * FROM growth_touch_rules WHERE enabled = TRUE AND tenant_id = $1 ORDER BY priority ASC, rule_key ASC LIMIT 20`, [ruleEngineTenantId]);
  const createdActions = [];
  // 跨活动单触达：同一手机号本轮只进入一个活动(按 priority 高者先占)，杜绝一个客人因同时命中
  // 多个段(如就餐时段标签×召回段)在同一轮被多条活动各发一条短信。发送端 globalSmsCapped 再兜底。
  const claimedPhones = new Set();
  for (const rule of (rulesResult.rows || [])) {
    // 储值余额提醒规则(channel='balance')：不走逐人触达引擎，由独立触发器
    // enqueueAutoStoredValueReminds 按门店每日冻结余额提醒任务。此处直接跳过。
    if (String((rule.action_payload || {}).channel || '') === 'balance') continue;
    const candidates = (await loadRuleCandidates(pool, rule, ruleEngineTenantId)).slice(0, limitPerRule);
    // 活动制规则(action_payload.campaign_key)：不逐人直发，改为聚合候选→冻结发券任务(可核销可归因)。
    const ruleCampaignKey = cleanText((rule.action_payload || {}).campaign_key || '', 64);
    if (ruleCampaignKey && CAMPAIGN_TYPES[ruleCampaignKey]) {
      await enqueueCampaignJobsForRule(pool, rule, candidates, ruleCampaignKey, claimedPhones).catch((e) => log.warn({ msg: 'enqueue_campaign_job_failed', rule_key: rule.rule_key, err: e?.message }));
      await pool.query(`UPDATE growth_touch_rules SET last_run_at = NOW() WHERE rule_key = $1`, [rule.rule_key]).catch(() => {});
      continue;
    }
    for (const row of candidates) {
      // 通道选择：
      //  - 规则显式声明 channel='subscribe' 时走订阅消息（需手机号/openid 以解析，
      //    且配置了推送网关 HRMS_SUBSCRIBE_PUSH_URL），不回落短信/企微；
      //  - 否则企微优先，无企微但有手机号且短信已配置时回落短信，再否则跳过。
      const rowPhone = cleanPhone(row.phone);
      const ruleChannel = cleanText((rule.action_payload && rule.action_payload.channel) || '', 40);
      let channel = null;
      if (ruleChannel === 'member') {
        // 小程序站内推券：需会员有 openid 或手机号，且配置了推券网关
        if ((rowPhone || cleanText(row.openid || '', 128)) && isMemberCouponPushConfigured()) channel = 'member';
      } else if (ruleChannel === 'subscribe') {
        if ((rowPhone || cleanText(row.openid || '', 128)) && isSubscribePushConfigured()) channel = 'subscribe';
      } else if (row.external_userid) {
        channel = 'wecom';
      } else if (rowPhone && isAliyunSmsConfigured()) {
        channel = 'sms';
      }
      if (!channel) continue;

      // ===== 全局营销疲劳保护（跨规则 / 跨活动去重）=====
      // 痛点：多条规则可能同时命中同一客户（如「7天未到店」+「新品上线」），
      // 若各自独立发送会对客人造成轰炸。这里在「本规则冷却」之外再加两道全局闸门：
      //  (1) 全局触达间隔 GROWTH_GLOBAL_MIN_GAP_DAYS（默认7天）：客户被【任何】规则
      //      成功触达后，该天数内不再发送【任何】新营销。
      //  (2) 活动/券有效期排他 GROWTH_COUPON_MIN_GAP_DAYS（默认14天）：客户在上一张券
      //      可能仍有效的期间内，不再发【新的发券类活动】（send_voucher），
      //      避免「上次的券还没用，又发新券」。
      const GLOBAL_GAP = Math.max(0, Math.floor(Number(process.env.GROWTH_GLOBAL_MIN_GAP_DAYS) || 7));
      const COUPON_GAP = Math.max(0, Math.floor(Number(process.env.GROWTH_COUPON_MIN_GAP_DAYS) || 14));
      const reachedStatuses = `('sent','delivered','read','clicked','redeemed')`;
      if (GLOBAL_GAP > 0) {
        const g = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
           WHERE customer_id = $1 AND status IN ${reachedStatuses}
             AND updated_at > NOW() - ($2::int || ' days')::interval
           LIMIT 1`,
          [row.customer_id, GLOBAL_GAP]
        );
        if (g.rows.length) continue; // 全局静默期内，跳过该客户的一切新营销
      }
      const isVoucherRule = cleanText(rule.action_type || '', 80) === 'send_voucher';
      if (isVoucherRule && COUPON_GAP > 0) {
        // 仅对发券类规则：检查该客户最近 COUPON_GAP 天内是否已收到过任何发券类触达
        const c = await pool.query(
          `SELECT 1 FROM growth_delivery_logs dl
           JOIN growth_actions ga ON ga.action_key = dl.action_key
           WHERE dl.customer_id = $1 AND dl.status IN ${reachedStatuses}
             AND ga.action_type = 'send_voucher'
             AND dl.updated_at > NOW() - ($2::int || ' days')::interval
           LIMIT 1`,
          [row.customer_id, COUPON_GAP]
        );
        if (c.rows.length) continue; // 上一张券可能仍在有效期内，不重复发券
      }

      // 发送频率（冷却）：规则可设 frequency_days（每位会员最短重发间隔）。
      // 若该会员在 frequency_days 天内已被本规则成功触达过，则本轮跳过，避免高频打扰。
      // 未设置(0)时沿用默认的「每个到店周期最多 1 次」语义（由 period_key 去重保证）。
      const freqDays = Math.max(0, Math.floor(Number(rule.action_payload?.frequency_days) || 0));
      if (freqDays > 0) {
        const recent = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
           WHERE rule_key = $1 AND customer_id = $2 AND status = 'sent'
             AND updated_at > NOW() - ($3::int || ' days')::interval
           LIMIT 1`,
          [rule.rule_key, row.customer_id, freqDays]
        );
        if (recent.rows.length) continue;
      }
      const actionPayload = Object.assign({}, rule.action_payload || {}, {
        rule_key: rule.rule_key,
        customer_id: row.customer_id,
        store_id: row.store_id,
        phone: row.phone,
        openid: row.openid || '',
        external_userid: row.external_userid,
        channel,
        customer_name: row.customer_name || row.phone || `客户#${row.customer_id}`,
        days_since_last_visit: row.days_since_last_visit,
        visit_count: row.pos_order_count,
        visit_interval_days: row.visit_interval_days,
        price_sensitivity: row.price_sensitivity,
        response_to_discount: row.response_to_discount,
        pos_total_spend: row.pos_total_spend,
        favorite_dishes_text: Array.isArray(row.favorite_dishes) && row.favorite_dishes.length ? row.favorite_dishes.slice(0, 3).join('、') : '店内推荐菜',
        strategy_key: `rule_engine:${rule.rule_key}`
      });
      const actionKey = buildRuleActionKey(rule.rule_key, row.customer_id, buildRulePeriodKey(rule.rule_key, row));
      const insert = await pool.query(
        `INSERT INTO growth_actions (action_key, action_type, status, store_id, title, detail, payload, created_by, tenant_id)
         VALUES ($1,$2,'proposed',NULLIF($3,''),$4,$5,$6::jsonb,'rule_engine',$7)
         ON CONFLICT (action_key, tenant_id) DO NOTHING
         RETURNING *`,
        [
          actionKey,
          cleanText(rule.action_type || 'send_message', 80),
          cleanText(row.store_id, 128),
          interpolateTemplate(cleanText(actionPayload.title_template || rule.name, 500), actionPayload),
          interpolateTemplate(cleanText(actionPayload.content_template || rule.name, 2000), actionPayload),
          JSON.stringify(actionPayload),
          ruleEngineTenantId
        ]
      );
      if (!insert.rows.length) continue;
      if (rule.rule_key === 'dormant_vip_winback' || rule.rule_key === 'dormant_normal_winback') await createChurnAlert(pool, rule, row);
      const actionRow = insert.rows[0];
      // 短信通道仅在显式开启 ALIYUN_SMS_ENABLED 时才自动发送，
      // 否则留作「AI建议(proposed)」由人工在面板确认执行，避免配好密钥即群发。
      const smsAutoBlocked = channel === 'sms' && !isAliyunSmsAutoSendEnabled();
      // 治理门：只有经管理员「审核」（approved_at 不为空）的规则才允许自动执行。
      // 未审核的规则照常生成 proposed 动作进待发队列，等人工在面板确认，从而做到
      // 「自动执行可视化 + 有明确经办人」，且新规则默认不会偷偷群发。
      const ruleApproved = !!rule.approved_at;
      if (rule.auto_execute !== false && !smsAutoBlocked && ruleApproved) {
        await executeGrowthActionRecord(pool, actionRow, { username: 'rule_engine', role: rule.owner ? `owner:${rule.owner}` : 'system' }, {}, `规则引擎自动执行:${rule.rule_key}（审核人:${rule.approved_by || '?'}）`);
      }
      createdActions.push(actionKey);
    }
    // 记录本规则最近一次被引擎扫描的时间，供前端展示「上次运行」。
    await pool.query(`UPDATE growth_touch_rules SET last_run_at = NOW() WHERE rule_key = $1`, [rule.rule_key]).catch(() => {});
  }
  return { created: createdActions.length, action_keys: createdActions };
}

let _sendGrowthAlert = null;
export function setSendGrowthAlert(fn) { _sendGrowthAlert = fn; }
export function getSendGrowthAlert() { return _sendGrowthAlert; }

export function requireGrowthAuth(req, res) {
  const auth = authMiniProgramSync(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.error });
    return false;
  }
  return true;
}

// 一些写操作(审批营销实验/删除共享素材)之前只检查"是否登录"，没检查角色——
// 任何门店角色(如收银员)登录后都能做。'system' 覆盖共享密钥的机器对机器调用
// (getGrowthOperator 在没有真实用户JWT时会给这个角色)。
const GROWTH_ADMIN_WRITE_ROLES = ['admin', 'hq_manager', 'system'];
export function requireGrowthAdminRole(req, res) {
  const role = String(getGrowthOperator(req).role || '').trim();
  if (!GROWTH_ADMIN_WRITE_ROLES.includes(role)) {
    res.status(403).json({ ok: false, error: 'forbidden', message: '仅管理员/总部可执行此操作' });
    return false;
  }
  return true;
}

export function getGrowthOperator(req) {
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer || !process.env.JWT_SECRET) return { username: 'system', role: 'system' };
  try {
    const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
    return {
      username: cleanText(decoded.username || 'system', 128),
      role: cleanText(decoded.role || 'system', 80)
    };
  } catch (_) {
    return { username: 'system', role: 'system' };
  }
}

// 增长接口走小程序同步密钥鉴权(authMiniProgramSync)，不经过用户JWT中间件，
// 故req.tenantId不会自动有值。这里复用Bearer token(若管理端带了)解出tenant_id，
// 取不到则归default——与现网单租户行为一致，零风险。
export function getGrowthTenantId(req) {
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer || !process.env.JWT_SECRET) return 'default';
  try {
    const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
    return cleanText(decoded.tenant_id || 'default', 80) || 'default';
  } catch (_) {
    return 'default';
  }
}

// 供跨模块(如拆分出的 touch-rules/winback 路由)读取"涉及会员数"缓存：由 registerGrowthRoutes
// 内部的 computeTouchRulesAudience/refreshTouchRulesAudienceCache 通过 setTouchRulesAudienceGetter
// 注入实现，避免重复维护同一份缓存 Map(与 setSendGrowthAlert 同一模式)。
let _getTouchRulesAudience = null;
export function setTouchRulesAudienceGetter(fn) { _getTouchRulesAudience = fn; }
export async function getTouchRulesAudience(tenantId, storeId, forceRefresh) {
  if (!_getTouchRulesAudience) throw new Error('touch_rules_audience_not_ready');
  return _getTouchRulesAudience(tenantId, storeId, forceRefresh);
}

// 供本文件内的企微联系人定时同步任务调用：实现已搬到 growth-wecom-feishu-routes.js，
// 通过 setSyncWecomContactsForStore 注入，避免与该文件的 import.growth-api.js 形成循环依赖。
let _syncWecomContactsForStore = null;
export function setSyncWecomContactsForStore(fn) { _syncWecomContactsForStore = fn; }
async function syncWecomContactsForStore(pool, storeConfig) {
  if (!_syncWecomContactsForStore) throw new Error('sync_wecom_contacts_not_ready');
  return _syncWecomContactsForStore(pool, storeConfig);
}

export function registerGrowthRoutes(app, pool) {
  initSmsTemplatesCache(pool);
  // 后台 worker：认领 pending 的储值余额提醒任务并由 HRMS 自身逐条下发(不经小程序)。
  // 每 30s 跑一次；同一时刻只处理一个任务，发送结果写 delivery_logs + marketing_triggered。
  async function processOneRemindJob() {
    if (inSmsQuietHours()) return; // 禁发时段：任务保持 pending，窗口外自动续跑
    const claim = await pool.query(
      `UPDATE growth_campaign_jobs SET status='running', updated_at=now()
        WHERE id = (SELECT id FROM growth_campaign_jobs WHERE status='pending' AND kind='stored_value_remind' ORDER BY created_at ASC LIMIT 1)
        RETURNING id, campaign_id, store_id, targets, result`
    );
    const job = claim.rows[0];
    if (!job) return;
    const storeId = cleanText(job.store_id, 128);
    const tenantId = await resolveTenantIdForStore(pool, storeId);
    const templateCode = cleanText(job.result?.template_code, 64) || pickBalanceTemplateByStore(storeId);
    const targets = Array.isArray(job.targets) ? job.targets : [];
    let sent = 0, failed = 0;
    if (!templateCode) {
      await pool.query(`UPDATE growth_campaign_jobs SET status='failed', failed=$2, result=result||$3::jsonb, updated_at=now() WHERE id=$1`,
        [job.id, targets.length, JSON.stringify({ error: 'balance_template_not_configured' })]);
      return;
    }
    for (const t of targets) {
      const phone = cleanPhone(t.phone);
      const balanceYuan = Math.max(0, Math.floor(Number(t.balance_yuan) || 0));
      if (!phone || balanceYuan <= 0) { failed++; continue; }
      const deliveryKey = `svremind:${job.id}:${phone}`;
      const templateParam = { balance: String(balanceYuan) };
      // 永久抑制名单：停机/空号/黑名单号码不再发送
      if (await isPhoneSuppressed(pool, phone, tenantId)) continue;
      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      const gCap = await globalSmsCapped(pool, phone, tenantId);
      if (gCap) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'skipped',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id, reason: 'global_capped' },
          result: {}, error_message: '触发全局短信总闸(每周最多1条)，已跳过'
        }, tenantId).catch(() => null);
        continue;
      }
      try {
        const result = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam });
        const cust = await upsertCustomer(pool, { phone, store_id: storeId }, tenantId).catch(() => null);
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: cust?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
          provider_msg_id: result.provider_msg_id, status: 'sent',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id }, result: result.raw || {}
        }, tenantId);
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered', customer_id: cust?.id || null, phone, external_userid: null,
          store_id: storeId, campaign_id: job.campaign_id, channel: 'sms', coupon_id: null,
          idempotency_key: `marketing_triggered:svremind:${job.id}:${phone}`,
          metadata: { rule_key: 'stored_value_remind', delivery_key: deliveryKey, provider_msg_id: result.provider_msg_id, template_code: templateCode, template_param: templateParam }
        }, tenantId);
        sent++;
      } catch (err) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id }, result: {},
          error_message: err?.message || 'sms_send_failed'
        }, tenantId).catch(() => null);
        await handleSmsFailure(pool, phone, err?.message, tenantId);
        failed++;
      }
    }
    await pool.query(`UPDATE growth_campaign_jobs SET sent=$2, failed=$3, status='done', updated_at=now() WHERE id=$1`,
      [job.id, sent, failed]);
  }
  if (!globalThis.__growthRemindWorker) {
    globalThis.__growthRemindWorker = true;
    setInterval(() => {
      runForActiveTenants(() => processOneRemindJob())
        .catch((e) => log.warn({ msg: 'svremind_worker_failed', err: e?.message }));
    }, 30 * 1000);
  }

  // 储值余额提醒·定时自动触发器：每日为每个有储值客的门店自动冻结一条 remind 任务，
  // 由上面的 processOneRemindJob worker 认领下发(只发 {balance}，无券无码)。
  // 治理门：仅在短信总闸(ALIYUN_SMS_ENABLED)开启时才冻结(开关默认关 → 全部静默)。
  // 口径与频控同 /remind/launch：余额≥min + 久未消费(dormant_days) + remind 类 N 天不重发 + 全局总闸。
  // 幂等：同店同日一条任务(campaign_id=auto_svremind_<store>_<日期>)，定时器多跑也不会重复冻结。
  async function enqueueAutoStoredValueReminds() {
    if (!isAliyunSmsAutoSendEnabled()) return { enqueued: 0, skipped: 'sms_switch_off' };
    // 治理门：把「储值余额提醒」收编为自动营销里的一条规则(rule_key='stored_value_remind')，
    // 必须 规则启用 + 已审核 + auto_execute 才自动跑(与其它活动制规则同一治理口径)。
    const rr = await pool.query(
      `SELECT enabled, approved_at, auto_execute, criteria FROM growth_touch_rules WHERE rule_key = 'stored_value_remind' LIMIT 1`
    );
    const rule = rr.rows[0];
    if (!rule || !rule.enabled || !rule.approved_at || rule.auto_execute === false) {
      return { enqueued: 0, skipped: 'governance' };
    }
    const crit = (rule.criteria && typeof rule.criteria === 'object') ? rule.criteria : {};
    const dormantDays = Math.max(0, Math.floor(Number(crit.dormant_days) || Number(process.env.ALIYUN_SMS_REMIND_AUTO_DORMANT_DAYS) || 30));
    const minBalanceFen = Math.max(0, Math.floor((Number(crit.min_balance_yuan) || Number(process.env.ALIYUN_SMS_REMIND_AUTO_MIN_BALANCE_YUAN) || 1) * 100));
    const maxTargets = Math.min(Math.max(Number(process.env.ALIYUN_SMS_REMIND_AUTO_MAX_TARGETS) || 1000, 1), 2000);
    const freqDays = freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
    const today = new Date().toISOString().slice(0, 10);
    const stores = await pool.query(
      `SELECT DISTINCT store_id FROM growth_stored_value_members WHERE store_id IS NOT NULL AND store_id <> ''`
    );
    let enqueued = 0;
    for (const s of stores.rows) {
      const storeId = String(s.store_id || '').trim();
      if (!storeId) continue;
      const templateCode = pickBalanceTemplateByStore(storeId);
      if (!templateCode) continue; // 该门店余额模板未配置 → 跳过，防整批拒收
      const campaignId = `auto_svremind_${storeId}_${today}`;
      const exist = await pool.query(`SELECT 1 FROM growth_campaign_jobs WHERE campaign_id = $1 LIMIT 1`, [campaignId]);
      if (exist.rows.length) continue; // 当日已冻结
      const q = buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
      const r = await pool.query(q.sql, q.params);
      const targets = r.rows.map((x) => ({ phone: x.phone, name: x.member_name || '', card_no: x.card_no, balance_yuan: Math.round((x.balance_fen || 0) / 100) }));
      if (!targets.length) continue;
      await pool.query(
        `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
         VALUES ($1,$2,0,0,$3,$4,$5::jsonb,$6,'pending','stored_value_remind',$7,$8::jsonb,$9)`,
        [campaignId, storeId, dormantDays, minBalanceFen, JSON.stringify(targets), targets.length, 'auto_scheduler', JSON.stringify({ template_code: templateCode }), resolveTenantIdDefault()]
      );
      enqueued += targets.length;
    }
    return { enqueued };
  }
  if (!globalThis.__growthRemindAutoTimer) {
    globalThis.__growthRemindAutoTimer = setInterval(() => {
      runForActiveTenants(() => enqueueAutoStoredValueReminds()).catch((e) => log.warn({ msg: 'svremind_auto_enqueue_failed', err: e?.message }));
    }, 60 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants(() => enqueueAutoStoredValueReminds()).catch((e) => log.warn({ msg: 'svremind_initial_auto_enqueue_failed', err: e?.message }));
    }, 20000);
  }

  // T+7 SMS自动回填：每天跑一次；启动后延迟60s首跑（等DB连接稳定）
  if (!globalThis.__smsBackfillTimer) {
    globalThis.__smsBackfillTimer = setInterval(() => {
      runForActiveTenants(() => autoBackfillSmsActions(pool)).then((rows) => {
        const n = rows.reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (n > 0) log.info({ msg: 'sms_backfill_auto', actions: n });
      }).catch((e) => log.warn({ msg: 'sms_backfill_failed', err: e?.message }));
    }, 24 * 60 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants(() => autoBackfillSmsActions(pool)).then((rows) => {
        const n = rows.reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (n > 0) log.info({ msg: 'sms_backfill_initial', actions: n });
      }).catch((e) => log.warn({ msg: 'sms_backfill_initial_failed', err: e?.message }));
    }, 60000);
  }

  // 每条规则当前「涉及会员数」（命中人群且可触达：有企微外部联系人或手机号）。
  // 用于前台展示活动覆盖范围，让管理员审核前清楚知道这次会发给多少人。
  //
  // 性能要点：这是一次全量人群扫描(冷启动约5秒，占用一个数据库连接)。绝不能放在
  // 用户请求(尤其是"保存规则")的同步路径上——否则该扫描会和保存抢连接池，让保存也卡5秒，
  // 表现为"一改发送频率/有效期就死机"。因此这里改为：后台定时刷新缓存，HTTP 请求只读缓存、
  // 永不同步触发重算(仅服务刚启动、缓存还空时兜底算一次)。
  const __touchRulesAudienceCache = new Map();
  const __touchRulesAudienceComputing = new Map();

  function audienceCacheKey(tenantId, storeId = '') {
    return `${resolveTenantIdDefault(tenantId)}::${cleanText(storeId, 128) || 'ALL'}`;
  }

  function invalidateTouchRulesAudienceCache(tenantId = resolveTenantIdDefault()) {
    const prefix = `${resolveTenantIdDefault(tenantId)}::`;
    for (const key of __touchRulesAudienceCache.keys()) {
      if (key.startsWith(prefix)) __touchRulesAudienceCache.delete(key);
    }
  }

  async function computeTouchRulesAudience(options = {}) {
    const storeFilter = cleanText(options.storeId || '', 128);
    const rulesResult = await pool.query(`SELECT * FROM growth_touch_rules ORDER BY rule_key ASC`);
    const audience = {};
    // 性能：通用人群表只扫一次，19 条规则在内存复用过滤，避免逐规则各扫 13k 行(旧版~30s)。
    // 生日规则(loyal_birthday_month) / 余额规则(channel=balance)人群口径不同，仍各自单独查询(均很轻)。
    let genericRows = null;
    const segmentCache = new Map(); // segment_key → 手机号Set，多条同标签规则复用
    for (const rule of (rulesResult.rows || [])) {
      try {
        // 储值余额提醒(channel=balance)的人群在 growth_stored_value_members，不在 customer_profiles，
        // 口径=有手机号 + 余额≥min + 久未消费(dormant_days)，与短信直发目标一致。
        if (String((rule.action_payload || {}).channel || '') === 'balance') {
          const crit = (rule.criteria && typeof rule.criteria === 'object') ? rule.criteria : {};
          const dormantDays = Math.max(0, Math.floor(Number(crit.dormant_days) || 30));
          const minBalanceFen = Math.max(0, Math.floor((Number(crit.min_balance_yuan) || 1) * 100));
          const br = await pool.query(
            `SELECT count(*)::int AS n FROM growth_stored_value_members m
               WHERE m.phone IS NOT NULL AND m.phone <> '' AND m.balance_fen >= $1
                 AND (m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))`,
            [minBalanceFen]
          );
          const n = Number(br.rows?.[0]?.n) || 0;
          audience[rule.rule_key] = { total: n, sms: n, subscribe: 0, member: 0, wecom: 0 };
          continue;
        }
        let candidates;
        if (rule.rule_key === 'loyal_birthday_month') {
          // 生日规则有独立(轻量 LIMIT 500)查询口径，仍走原函数
          candidates = await loadRuleCandidates(pool, rule);
        } else {
          if (!genericRows) genericRows = await fetchGenericRuleCandidates(pool);
          // 时段标签规则：取该 segment 的手机号集合(按 segment_key 缓存，避免重复查询)
          const segKey = (rule.criteria || {}).segment_key || '';
          let segSet = null;
          if (segKey) {
            if (!segmentCache.has(segKey)) segmentCache.set(segKey, await loadSegmentPhoneSet(pool, segKey));
            segSet = segmentCache.get(segKey);
          }
          candidates = filterGenericRuleCandidates(genericRows, rule, segSet, storeFilter);
        }
        // 分渠道覆盖：短信=有手机号；订阅消息/小程序站内券=有 openid（上限，订阅另受授权限制）；企微=有外部联系人。
        let sms = 0, subscribe = 0, member = 0, wecom = 0;
        for (const c of (candidates || [])) {
          if (cleanPhone(c.phone)) sms++;
          if (cleanText(c.openid || '', 128)) { subscribe++; member++; }
          if (c.external_userid) wecom++;
        }
        audience[rule.rule_key] = { total: (candidates || []).length, sms, subscribe, member, wecom };
      } catch (e) {
        audience[rule.rule_key] = null; // 计算失败标记为未知，不阻断
      }
    }
    return audience;
  }
  // 后台刷新缓存（去重并发；按 tenant+store 分桶，避免切换门店仍命中全店缓存）。
  function refreshTouchRulesAudienceCache(tenantId = resolveTenantIdDefault(), storeId = '') {
    const effectiveTenantId = resolveTenantIdDefault(tenantId);
    const cacheKey = audienceCacheKey(effectiveTenantId, storeId);
    if (__touchRulesAudienceComputing.has(cacheKey)) return __touchRulesAudienceComputing.get(cacheKey);
    const pending = computeTouchRulesAudience({ storeId })
      .then((a) => {
        __touchRulesAudienceCache.set(cacheKey, { data: a, at: Date.now() });
        return a;
      })
      .finally(() => { __touchRulesAudienceComputing.delete(cacheKey); });
    __touchRulesAudienceComputing.set(cacheKey, pending);
    return pending;
  }
  // 供拆分出的 growth-winback-routes.js 的 /api/growth/touch-rules/audience 路由读取同一份缓存。
  setTouchRulesAudienceGetter(async (tenantId, storeId, forceRefresh) => {
    const cacheKey = audienceCacheKey(tenantId, storeId);
    const cachedAudience = __touchRulesAudienceCache.get(cacheKey);
    if (!forceRefresh && cachedAudience?.data) {
      const stale = Date.now() - cachedAudience.at > 180000;
      if (stale) tenantContext.run(tenantId, () => refreshTouchRulesAudienceCache(tenantId, storeId)).catch(() => {});
      return { audience: cachedAudience.data, cached: true, stale };
    }
    const a = await tenantContext.run(tenantId, () => refreshTouchRulesAudienceCache(tenantId, storeId));
    return { audience: a };
  });
  // 暴露给 POST 规则改动后触发后台重算（见 /api/growth/touch-rules）。
  globalThis.__refreshGrowthAudience = (tenantId) => {
    invalidateTouchRulesAudienceCache(tenantId);
    tenantContext.run(resolveTenantIdDefault(tenantId), () => refreshTouchRulesAudienceCache(tenantId)).catch(() => {});
  };
  // 服务启动后预热一次，并每 10 分钟后台刷新，确保 HTTP 请求始终命中缓存、不阻塞。
  if (!globalThis.__growthAudienceTimer) {
    setTimeout(() => runForActiveTenants((tenantId) => refreshTouchRulesAudienceCache(tenantId)).catch(() => {}), 15000);
    globalThis.__growthAudienceTimer = setInterval(() => {
      runForActiveTenants((tenantId) => refreshTouchRulesAudienceCache(tenantId)).catch(() => {});
    }, 10 * 60 * 1000);
  }
  // 客户画像（生命周期/价值分级等，决定"涉及会员"人数）每日自动重算，避免依赖人工触发而过期；
  // 价值分级 VIP 口径：各门店折前人均消费金额(avg_check=折前营业额÷客流量) PERCENT_RANK 前15%
  // 重算后顺带刷新人群缓存，使"涉及会员"数据始终与画像同步。
  if (!globalThis.__growthProfileTimer) {
    const runProfileRecompute = () => runForActiveTenants((tenantId) => recomputeCustomerProfiles(pool, 90)
      .then(() => refreshTouchRulesAudienceCache(tenantId)))
      .catch((e) => log.warn({ msg: 'profiles_recompute_failed', err: e?.message }));
    setTimeout(runProfileRecompute, 20000);
    globalThis.__growthProfileTimer = setInterval(runProfileRecompute, 24 * 60 * 60 * 1000);
  }
  // 核销消费金额每天凌晨2点(北京时间)批量补算一次：POS数据是按天同步的，核销当时大概率查不到，
  // 等次日POS数据到位后统一回填近7天内仍为0的核销记录。
  if (!globalThis.__growthRedemptionBackfillTimer) {
    let __growthRedemptionBackfillLastYmd = '';
    const runBackfill = () => {
      const nowCst = new Date(Date.now() + 8 * 3600000);
      const ymd = nowCst.toISOString().slice(0, 10);
      if (nowCst.getUTCHours() < 2 || __growthRedemptionBackfillLastYmd === ymd) return;
      __growthRedemptionBackfillLastYmd = ymd;
      runForActiveTenants(() => backfillRedemptionAmounts(pool))
        .then((rows) => log.info({ msg: 'redemption_amount_backfill', rows: rows.reduce((sum, value) => sum + (Number(value) || 0), 0) }))
        .catch((e) => log.warn({ msg: 'redemption_amount_backfill_failed', err: e?.message }));
    };
    globalThis.__growthRedemptionBackfillTimer = setInterval(runBackfill, 10 * 60 * 1000);
  }
  if (!globalThis.__growthTouchRuleTimer) {
    globalThis.__growthTouchRuleTimer = setInterval(() => {
      runForActiveTenants((tenantId) => runTouchRuleEngine(pool, { limit_per_rule: 5000, tenantId }))
        .catch((e) => log.warn({ msg: 'rule_engine_run_failed', err: e?.message }));
    }, 15 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants((tenantId) => runTouchRuleEngine(pool, { limit_per_rule: 5000, tenantId }))
        .catch((e) => log.warn({ msg: 'rule_engine_initial_run_failed', err: e?.message }));
    }, 10000);
  }

  if (!globalThis.__wecomContactSyncTimer) {
    globalThis.__wecomContactSyncTimer = setInterval(async () => {
      try {
        await runForActiveTenants(async () => {
          const configs = await getAllStoreWecomConfigs(pool);
          for (const cfg of configs) {
            await syncWecomContactsForStore(pool, cfg);
          }
        });
      } catch (e) {
        log.warn({ msg: 'wecom_contact_sync_failed', err: e?.message });
      }
    }, 24 * 60 * 60 * 1000); // 实时事件回调(wecom-contact-events.js)已是主力数据源，这里降为每日兜底对账
    setTimeout(async () => {
      try {
        await runForActiveTenants(async () => {
          const configs = await getAllStoreWecomConfigs(pool);
          for (const cfg of configs) {
            await syncWecomContactsForStore(pool, cfg);
          }
        });
      } catch (e) {
        log.warn({ msg: 'wecom_contact_sync_initial_failed', err: e?.message });
      }
    }, 30000);
  }

  // 每日增长日报（每天 09:05 发送）
  if (!globalThis.__growthDailyReportTimer) {
    function scheduleDailyReport() {
      const now = new Date();
      const next = new Date(now);
      next.setHours(8, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const delay = next - now;
      globalThis.__growthDailyReportTimer = setTimeout(async () => {
        try {
          if (_sendGrowthAlert) {
            const reportRuns = await runForActiveTenants(
              async (tenantId) => ({
                tenantId,
                message: await buildGrowthDailyReport(pool)
              }),
              {
                continueOnError: true,
                onError: ({ tenantId, error }) => {
                  log.warn({ msg: 'daily_report_tenant_failed', tenant_id: tenantId, err: error?.message || String(error) });
                }
              }
            );
            for (const row of reportRuns.results || []) {
              await _sendGrowthAlert(`[租户 ${row.tenantId}]\n${row.value.message}`, 'growth_daily_report');
            }
          }
        } catch (e) {
          log.warn({ msg: 'daily_report_failed', err: e?.message });
        }
        scheduleDailyReport();
      }, delay);
    }
    scheduleDailyReport();
  }
}
