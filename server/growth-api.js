const EVENT_TYPES = new Set([
  'campaign_scan',
  'phone_authorized',
  'coupon_claimed',
  'coupon_purchased',
  'coupon_redeemed',
  'payment_success',
  'customer_arrived',
  'marketing_triggered',
  'wechat_match_check',
  'customer_profile_updated'
]);

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

// 阿里云短信「个人姓名」变量仅接受中文姓名/称谓；英文名、微信昵称、emoji、符号、空值会被
// 运营商以「变量不符合个人姓名规范」拒发。信息完善前先用统称「顾客」兜底，
// 待门店补全姓+性别后可正常用「张先生」「王哥」等中文称谓。
function smsSafeName(value) {
  const s = cleanText(value, 20);
  return /^[一-龥·]{2,15}$/.test(s) ? s : '顾客';
}

// 自动营销规则发券短信：阿里云已报备模板的可用英文变量及其取值口径。
// 模板正文(content_template)须与阿里云模板逐字一致，本函数按正文里出现的 {var} 精确组装
// templateParam，确保「参数名/个数」与阿里云严格匹配（不匹配会被整批拒收）。
const SMS_DERIVED_VARS = new Set(['name', 'value', 'date', 'code', 'balance', 'days']);

// 券有效期 → 「M月D日」（到店报码时客人一眼能看懂的中文日期；以 valid_days 自当日顺延）。
function formatSmsValidDate(validDays) {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(1, Math.floor(Number(validDays) || 7)));
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 唯一券码：6 位数字，便于客人口述、店员在核销台输入。带时间熵降低碰撞，核销按本码配对。
function genSmsShortCode() {
  const n = (Date.now() % 1000000) ^ Math.floor(Math.random() * 1000000);
  return String(100000 + (Math.abs(n) % 900000));
}

// 储值余额(元)：按手机号(可选门店)取储值会员当前余额，供储值维护模板的 {balance} 变量。
async function getStoredValueBalanceYuan(pool, phone, storeId) {
  const p = cleanPhone(phone);
  if (!p) return 0;
  const params = [p];
  let where = "phone = $1 AND phone <> ''";
  const sid = cleanText(storeId, 128);
  if (sid) { params.push(sid); where += ` AND store_id = $${params.length}`; }
  const r = await pool.query(
    `SELECT balance_fen FROM growth_stored_value_members WHERE ${where} ORDER BY balance_fen DESC LIMIT 1`,
    params
  ).catch(() => ({ rows: [] }));
  return Math.max(0, Math.round((r.rows[0]?.balance_fen || 0) / 100));
}

function parseOccurredAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { sendAliyunSms, isAliyunSmsConfigured, isAliyunSmsAutoSendEnabled } from './sms.js';
import { getStoreSmsEnvSuffix, storeNameToId as _storeNameToIdFromConfig, STORE_ID_TO_NAME, STORES as _ALL_STORES } from './brands-config.js';
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
  if (headerSecret === secret || bearer === secret) return { ok: true };
  if (bearer && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
      if (decoded && decoded.username) return { ok: true };
    } catch (e) {}
  }
  return { ok: false, status: 401, error: 'unauthorized' };
}

export async function ensureGrowthTables(pool) {
  // 储值客户(从客如云→飞书「储值客户」表同步,按卡号聚合当前余额与最近消费日)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_stored_value_members (
      card_no TEXT PRIMARY KEY,
      member_name TEXT,
      phone TEXT,
      level TEXT,
      tags TEXT,
      store_id TEXT,
      balance_fen INTEGER DEFAULT 0,
      last_consume_date DATE,
      last_recharge_date DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_svm_store_consume ON growth_stored_value_members (store_id, last_consume_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_svm_phone ON growth_stored_value_members (phone)`);
  // 召回活动任务:HRMS 发起时冻结目标名单,小程序定时器拉取执行(发起权集中在 HRMS)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_campaign_jobs (
      id BIGSERIAL PRIMARY KEY,
      campaign_id TEXT,
      store_id TEXT,
      value_yuan INTEGER,
      valid_days INTEGER,
      dormant_days INTEGER,
      min_balance_fen INTEGER,
      targets JSONB NOT NULL DEFAULT '[]'::jsonb,
      total INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      result JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_campaign_jobs_status ON growth_campaign_jobs (status, created_at)`);
  // kind 区分任务类型：'winback'=发券召回(小程序定时器执行，需生成并注册券码)；
  // 'stored_value_remind'=储值余额提醒(HRMS 自身后台执行，只发 {balance}，无券无码)。
  await pool.query(`ALTER TABLE growth_campaign_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'winback'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_customers (
      id BIGSERIAL PRIMARY KEY,
      phone TEXT,
      openid TEXT,
      external_userid TEXT,
      first_store_id TEXT,
      last_store_id TEXT,
      first_seen_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_customers_phone ON growth_customers (phone) WHERE phone IS NOT NULL AND phone <> ''`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_customers_openid ON growth_customers (openid) WHERE openid IS NOT NULL AND openid <> ''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_customers_last_store ON growth_customers (last_store_id, last_seen_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_identities (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES growth_customers(id) ON DELETE CASCADE,
      identity_type TEXT NOT NULL,
      identity_value TEXT NOT NULL,
      source TEXT DEFAULT 'miniprogram',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(identity_type, identity_value)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_identities_customer ON customer_identities (customer_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_campaigns (
      id BIGSERIAL PRIMARY KEY,
      campaign_id TEXT UNIQUE NOT NULL,
      name TEXT,
      channel TEXT,
      store_id TEXT,
      status TEXT DEFAULT 'active',
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_campaigns_store ON growth_campaigns (store_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      customer_id BIGINT REFERENCES growth_customers(id) ON DELETE SET NULL,
      phone TEXT,
      openid TEXT,
      external_userid TEXT,
      store_id TEXT,
      campaign_id TEXT,
      channel TEXT,
      coupon_id TEXT,
      order_id TEXT,
      amount_fen INTEGER DEFAULT 0,
      idempotency_key TEXT UNIQUE,
      metadata JSONB DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_events_type_time ON growth_events (event_type, occurred_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_events_campaign ON growth_events (campaign_id, occurred_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_events_store ON growth_events (store_id, occurred_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_events_customer ON growth_events (customer_id, occurred_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_redemptions (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES growth_customers(id) ON DELETE SET NULL,
      coupon_id TEXT,
      campaign_id TEXT,
      store_id TEXT,
      amount_fen INTEGER DEFAULT 0,
      metadata JSONB DEFAULT '{}'::jsonb,
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(coupon_id, redeemed_at)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_redemptions_campaign ON growth_redemptions (campaign_id, redeemed_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_daily_metrics (
      id BIGSERIAL PRIMARY KEY,
      metric_date DATE NOT NULL,
      store_id TEXT NOT NULL DEFAULT '',
      campaign_id TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      scan_count INTEGER DEFAULT 0,
      authorized_count INTEGER DEFAULT 0,
      coupon_claimed_count INTEGER DEFAULT 0,
      coupon_purchased_count INTEGER DEFAULT 0,
      marketing_triggered_count INTEGER DEFAULT 0,
      coupon_redeemed_count INTEGER DEFAULT 0,
      payment_count INTEGER DEFAULT 0,
      revenue_fen INTEGER DEFAULT 0,
      roi NUMERIC,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(metric_date, store_id, campaign_id, channel)
    )
  `);
  await pool.query(`ALTER TABLE growth_daily_metrics ADD COLUMN IF NOT EXISTS coupon_claimed_count INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE growth_daily_metrics ADD COLUMN IF NOT EXISTS coupon_purchased_count INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE growth_daily_metrics ADD COLUMN IF NOT EXISTS marketing_triggered_count INTEGER DEFAULT 0`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_daily_metrics_date ON growth_daily_metrics (metric_date DESC, store_id, campaign_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_alerts (
      id BIGSERIAL PRIMARY KEY,
      alert_key TEXT UNIQUE NOT NULL,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      store_id TEXT,
      campaign_id TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      suggested_action TEXT,
      metrics JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT
    )
  `);
  await pool.query(`ALTER TABLE growth_alerts ADD COLUMN IF NOT EXISTS resolved_by TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_alerts_status ON growth_alerts (status, created_at DESC)`);

  // 短信永久抑制名单：停机/空号/黑名单等永久性失败的号码，后续一切营销短信跳过，
  // 不再浪费发送费且避免投诉。由发送失败时自动判别入表（见 maybeSuppressPhone）。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_sms_suppression (
      phone TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // holdout 对照组：每个活动按手机号确定性抽样 N%（GROWTH_HOLDOUT_PCT，默认10）不发送，
  // 用于衡量营销的真实增量（对照组回店率 vs 触达组回店率）。同一号码对同一活动恒定分组。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_holdout_members (
      phone TEXT NOT NULL,
      campaign_key TEXT NOT NULL,
      store_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (phone, campaign_key)
    )
  `);

  // 中国法定节假日日历：day_type='holiday'(放假) / 'workday'(调休补班日,周末上班算平日)。
  // 供「平日/周末/节假日」就餐时段划分使用(洪潮平日口径需排除节假日)。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cn_holiday_calendar (
      day DATE PRIMARY KEY,
      day_type TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 就餐时段标签成员：按 segment_key 存手机号(如 mj_dinner_weekend_repeat / hc_weekday_lunch)，
  // 由 POS order_time 聚合离线计算(recomputeDiningSegments)，营销规则按 criteria.segment_key 命中。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_segment_members (
      phone TEXT NOT NULL,
      segment_key TEXT NOT NULL,
      store_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (phone, segment_key)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_segment_key ON growth_segment_members (segment_key)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_actions (
      id BIGSERIAL PRIMARY KEY,
      action_key TEXT UNIQUE,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      store_id TEXT,
      campaign_id TEXT,
      title TEXT NOT NULL,
      detail TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      created_by TEXT DEFAULT 'agent_v2',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      executed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_actions_status ON growth_actions (status, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_marketing_profiles (
      id BIGSERIAL PRIMARY KEY,
      store_id TEXT UNIQUE NOT NULL,
      brand TEXT,
      avg_ticket_fen INTEGER DEFAULT 0,
      primary_audience TEXT,
      peak_hours JSONB DEFAULT '[]'::jsonb,
      suitable_offers JSONB DEFAULT '[]'::jsonb,
      unsuitable_offers JSONB DEFAULT '[]'::jsonb,
      best_campaigns JSONB DEFAULT '[]'::jsonb,
      worst_campaigns JSONB DEFAULT '[]'::jsonb,
      execution_level TEXT DEFAULT 'unknown',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_customer_profiles (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES growth_customers(id) ON DELETE CASCADE,
      phone TEXT,
      openid TEXT,
      store_id TEXT,
      brand TEXT,
      lifecycle_stage TEXT DEFAULT 'new',
      next_visit_probability NUMERIC,
      best_contact_window TEXT,
      preferred_visit_time TEXT,
      avg_party_size NUMERIC,
      visit_interval_days NUMERIC,
      response_to_discount NUMERIC,
      price_sensitivity NUMERIC,
      adventurous_score NUMERIC,
      health_conscious_score NUMERIC,
      spicy_level NUMERIC,
      occasion_date_score NUMERIC,
      occasion_family_score NUMERIC,
      occasion_business_score NUMERIC,
      occasion_solo_score NUMERIC,
      occasion_friends_score NUMERIC,
      favorite_dishes JSONB DEFAULT '[]'::jsonb,
      disliked_signals JSONB DEFAULT '[]'::jsonb,
      semantic_tags JSONB DEFAULT '[]'::jsonb,
      source_signals JSONB DEFAULT '{}'::jsonb,
      profile_version INTEGER DEFAULT 1,
      last_profiled_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(customer_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_store ON growth_customer_profiles (store_id, lifecycle_stage)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_updated ON growth_customer_profiles (updated_at DESC)`);
  // 叠加标签：价值分级（vip/regular/low，按门店消费额前15%取vip）+ 价格敏感标记
  await pool.query(`ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS value_tier TEXT DEFAULT 'low'`);
  await pool.query(`ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS price_sensitive BOOLEAN DEFAULT FALSE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_tier ON growth_customer_profiles (store_id, value_tier)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_profile_signals (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES growth_customers(id) ON DELETE SET NULL,
      signal_type TEXT NOT NULL,
      signal_key TEXT NOT NULL,
      signal_value TEXT,
      signal_score NUMERIC,
      source TEXT,
      store_id TEXT,
      campaign_id TEXT,
      occurred_at TIMESTAMPTZ DEFAULT NOW(),
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_customer ON growth_profile_signals (customer_id, occurred_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_type ON growth_profile_signals (signal_type, signal_key, occurred_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_marketing_constraints (
      id BIGSERIAL PRIMARY KEY,
      store_id TEXT NOT NULL,
      brand TEXT,
      min_discount_rate NUMERIC,
      max_coupon_value_fen INTEGER,
      monthly_budget_fen INTEGER,
      max_touch_per_72h INTEGER DEFAULT 1,
      cooldown_hours_after_payment INTEGER DEFAULT 24,
      allowed_channels JSONB DEFAULT '[]'::jsonb,
      disallowed_campaign_types JSONB DEFAULT '[]'::jsonb,
      disallowed_dishes JSONB DEFAULT '[]'::jsonb,
      preferred_channels JSONB DEFAULT '[]'::jsonb,
      brand_voice_style TEXT,
      execution_notes TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(store_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_store_marketing_constraints_active ON store_marketing_constraints (active, updated_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_execution_logs (
      id BIGSERIAL PRIMARY KEY,
      action_key TEXT,
      strategy_key TEXT,
      store_id TEXT,
      action_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      operator_username TEXT,
      operator_role TEXT,
      before_payload JSONB DEFAULT '{}'::jsonb,
      after_payload JSONB DEFAULT '{}'::jsonb,
      decision_reason TEXT,
      result_summary TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_execution_logs_action ON growth_execution_logs (action_key, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_touch_rules (
      id BIGSERIAL PRIMARY KEY,
      rule_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      enabled BOOLEAN DEFAULT TRUE,
      priority INTEGER DEFAULT 100,
      auto_execute BOOLEAN DEFAULT TRUE,
      criteria JSONB DEFAULT '{}'::jsonb,
      action_type TEXT NOT NULL DEFAULT 'send_message',
      action_payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_touch_rules_enabled ON growth_touch_rules (enabled, priority ASC, updated_at DESC)`);
  // 治理字段：经办人 + 审核（只有经管理员审核的规则才允许自动执行）+ 上次运行时间。
  await pool.query(`ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS owner TEXT`);
  await pool.query(`ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS note TEXT`);
  await pool.query(`ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS approved_by TEXT`);
  await pool.query(`ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`);

  // 支付后发券规则：配置权集中在 HRMS，小程序定时拉取写入 marketing_rules 集合并在支付时实时执行。
  // 字段镜像小程序 marketing_rules，member_template_id = 小程序券模板ID（与召回 member_template_id 同口径）。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_payment_rules (
      rule_key TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      priority INTEGER NOT NULL DEFAULT 0,
      target_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      trigger_value TEXT DEFAULT '',
      member_template_id TEXT NOT NULL DEFAULT '',
      daily_user_limit INTEGER,
      global_daily_limit INTEGER,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_payment_rules_active ON marketing_payment_rules (active, store_id, priority ASC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_delivery_logs (
      id BIGSERIAL PRIMARY KEY,
      delivery_key TEXT UNIQUE,
      action_key TEXT,
      rule_key TEXT,
      customer_id BIGINT,
      store_id TEXT,
      channel TEXT NOT NULL,
      external_userid TEXT,
      provider_msg_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB DEFAULT '{}'::jsonb,
      result JSONB DEFAULT '{}'::jsonb,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_action ON growth_delivery_logs (action_key, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_msg ON growth_delivery_logs (provider_msg_id, created_at DESC)`);
  // ABC 6模板滚动：按 rule_key(=campaign_key)+手机号统计累计成功发送次数，加速轮换推导。
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_rule_phone_status ON growth_delivery_logs (rule_key, status, (payload->>'phone'))`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_wecom_configs (
      id BIGSERIAL PRIMARY KEY,
      store_id TEXT UNIQUE NOT NULL,
      corp_id TEXT NOT NULL,
      corp_secret TEXT NOT NULL,
      agent_id TEXT DEFAULT '',
      sender_userid TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public_channels (
      id BIGSERIAL PRIMARY KEY,
      channel_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      store_id TEXT,
      owner_username TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public_promo_tasks (
      id BIGSERIAL PRIMARY KEY,
      task_key TEXT UNIQUE,
      store_id TEXT,
      channel_key TEXT,
      campaign_id TEXT,
      title TEXT NOT NULL,
      content_brief TEXT,
      copy_text TEXT,
      poster_url TEXT,
      qr_scene TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      assignee_username TEXT,
      due_at TIMESTAMPTZ,
      published_url TEXT,
      result_metrics JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_public_promo_tasks_status ON public_promo_tasks (status, due_at, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS creative_assets (
      id BIGSERIAL PRIMARY KEY,
      asset_key TEXT UNIQUE,
      store_id TEXT,
      asset_type TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT,
      tags JSONB DEFAULT '[]'::jsonb,
      meta JSONB DEFAULT '{}'::jsonb,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
     CREATE TABLE IF NOT EXISTS poster_templates (
      id BIGSERIAL PRIMARY KEY,
      template_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      channel TEXT,
      aspect_ratio TEXT,
      layout JSONB DEFAULT '{}'::jsonb,
      style_guide JSONB DEFAULT '{}'::jsonb,
      image_url TEXT,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE poster_templates ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await pool.query(`ALTER TABLE poster_templates ADD COLUMN IF NOT EXISTS purposes TEXT[] DEFAULT '{}'::text[]`);
  await pool.query(`ALTER TABLE poster_templates ADD COLUMN IF NOT EXISTS channels TEXT[] DEFAULT '{}'::text[]`);
  await pool.query(`ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS purposes TEXT[] DEFAULT '{}'::text[]`);
  await pool.query(`ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS channels TEXT[] DEFAULT '{}'::text[]`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS generated_posters (
      id BIGSERIAL PRIMARY KEY,
      poster_key TEXT UNIQUE,
      campaign_id TEXT,
      store_id TEXT,
      template_key TEXT,
      title TEXT,
      subtitle TEXT,
      cta TEXT,
      image_url TEXT,
      output_url TEXT,
      purposes TEXT[] DEFAULT '{}'::text[],
      channels TEXT[] DEFAULT '{}'::text[],
      status TEXT NOT NULL DEFAULT 'draft',
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_performance (
      id BIGSERIAL PRIMARY KEY,
      content_date DATE NOT NULL,
      channel TEXT NOT NULL,
      store_code TEXT,
      content_type TEXT NOT NULL DEFAULT '',
      variant_tag TEXT DEFAULT 'A',
      dish_name TEXT DEFAULT '',
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      orders INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // add columns that may not exist in older deployments
  for (const col of [
    `ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0`,
    `ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0`,
    `ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0`,
    `ADD COLUMN IF NOT EXISTS new_followers INTEGER DEFAULT 0`,
    `ADD COLUMN IF NOT EXISTS store_id TEXT`,
    `ADD COLUMN IF NOT EXISTS content_title TEXT`,
    `ADD COLUMN IF NOT EXISTS platform TEXT`
  ]) {
    await pool.query(`ALTER TABLE content_performance ${col}`).catch(() => {});
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_content_performance_date ON content_performance (content_date DESC, store_code)`);

  // 营销矩阵：生命周期阶段 × 价值分级 → 差异化动作
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
  for (const rule of defaultTouchRules) {
    await pool.query(
      // 仅作首次默认种子：已存在则保留运营在 HRMS UI 上的编辑（渠道/短信模板/券额/频次/审批），
      // 避免每次进程重启用代码默认值覆盖用户配置。
      `INSERT INTO growth_touch_rules (rule_key, name, enabled, priority, auto_execute, criteria, action_type, action_payload)
       VALUES ($1,$2,TRUE,$3,$4,$5::jsonb,$6,$7::jsonb)
       ON CONFLICT (rule_key) DO NOTHING`,
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
}

async function upsertCustomer(pool, payload) {
  const phone = cleanPhone(payload.phone);
  const openid = cleanText(payload.openid, 128);
  const externalUserId = cleanText(payload.external_userid, 128);
  const storeId = cleanText(payload.store_id, 128);
  const meta = payload.customer_meta && typeof payload.customer_meta === 'object' ? payload.customer_meta : {};

  if (!phone && !openid && !externalUserId) return null;

  let existing = null;
  if (phone) {
    const r = await pool.query('SELECT * FROM growth_customers WHERE phone = $1 LIMIT 1', [phone]);
    existing = r.rows[0] || null;
  }
  if (!existing && openid) {
    const r = await pool.query('SELECT * FROM growth_customers WHERE openid = $1 LIMIT 1', [openid]);
    existing = r.rows[0] || null;
  }

  // 若按手机号匹配到的记录将把 openid 改写为另一条记录已占用的值（同一 openid 此前绑定在不同/无手机号的记录上），
  // 先释放该记录的 openid，避免下面的 UPDATE 触发 uq_growth_customers_openid 冲突。
  if (existing && openid && existing.openid !== openid) {
    const conflict = await pool.query('SELECT id FROM growth_customers WHERE openid = $1 LIMIT 1', [openid]);
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
      `INSERT INTO growth_customers (phone, openid, external_userid, first_store_id, last_store_id, meta)
       VALUES (NULLIF($1,''), NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($4,''), $5::jsonb)
       ON CONFLICT (openid) WHERE openid IS NOT NULL AND openid <> '' DO UPDATE SET
         phone = COALESCE(growth_customers.phone, EXCLUDED.phone),
         external_userid = COALESCE(EXCLUDED.external_userid, growth_customers.external_userid),
         last_store_id = COALESCE(EXCLUDED.last_store_id, growth_customers.last_store_id),
         last_seen_at = NOW(),
         meta = COALESCE(growth_customers.meta, '{}'::jsonb) || EXCLUDED.meta,
         updated_at = NOW()
       RETURNING *`,
      [phone, openid, externalUserId, storeId, JSON.stringify(meta)]
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
      `INSERT INTO customer_identities (customer_id, identity_type, identity_value, source)
       VALUES ($1,$2,$3,'miniprogram')
       ON CONFLICT (identity_type, identity_value)
       DO UPDATE SET customer_id = EXCLUDED.customer_id, updated_at = NOW()`,
      [existing.id, type, value]
    );
  }

  return existing;
}

async function recomputeCustomerProfiles(pool, days = 90) {
  const safeDays = Math.min(Math.max(Number(days) || 90, 7), 365);
  // 将所有留过手机号的POS消费客自动建档进会员表，使散客也纳入分类（不再只统计小程序会员）。
  // 幂等：已存在的手机号 DO NOTHING，不覆盖会员既有信息；门店取其首单/末单所在门店。
  await pool.query(`
    INSERT INTO growth_customers (phone, first_store_id, last_store_id, first_seen_at, last_seen_at, meta)
    SELECT s.phone, s.first_store, s.last_store, s.first_at, s.last_at, '{"source":"pos_auto"}'::jsonb
    FROM (
      SELECT phone,
             (ARRAY_AGG(NULLIF(store_id,'') ORDER BY biz_date ASC) FILTER (WHERE NULLIF(store_id,'') IS NOT NULL))[1] AS first_store,
             (ARRAY_AGG(NULLIF(store_id,'') ORDER BY biz_date DESC) FILTER (WHERE NULLIF(store_id,'') IS NOT NULL))[1] AS last_store,
             MIN(biz_date)::timestamptz AS first_at,
             MAX(biz_date)::timestamptz AS last_at
      FROM pos_orders
      WHERE phone IS NOT NULL AND phone <> ''
      GROUP BY phone
    ) s
    ON CONFLICT (phone) WHERE phone IS NOT NULL AND phone <> '' DO NOTHING
  `);
  await pool.query(
    `WITH event_base AS (
       SELECT
         c.id AS customer_id,
         c.phone,
         c.openid,
         COALESCE(c.last_store_id, c.first_store_id, '') AS store_id,
         MAX(e.occurred_at) AS last_event_at,
         COUNT(*) FILTER (WHERE e.event_type = 'payment_success')::int AS payment_count,
         COUNT(*) FILTER (WHERE e.event_type IN ('coupon_claimed','coupon_purchased','marketing_triggered'))::int AS discount_touch_count,
         COUNT(*) FILTER (WHERE e.event_type = 'coupon_redeemed')::int AS discount_convert_count,
         AVG(NULLIF((e.metadata ->> 'party_size')::numeric, 0)) FILTER (WHERE e.metadata ? 'party_size') AS avg_party_size,
         AVG(NULLIF((e.metadata ->> 'spicy_level')::numeric, 0)) FILTER (WHERE e.metadata ? 'spicy_level') AS spicy_level,
         MODE() WITHIN GROUP (ORDER BY CASE
           WHEN EXTRACT(HOUR FROM e.occurred_at) BETWEEN 10 AND 14 THEN '午市'
           WHEN EXTRACT(HOUR FROM e.occurred_at) BETWEEN 17 AND 21 THEN '晚市'
           ELSE '夜间'
         END) AS preferred_visit_time
       FROM growth_customers c
       LEFT JOIN growth_events e ON e.customer_id = c.id
         AND e.occurred_at >= CURRENT_DATE - ($1::int || ' days')::interval
       GROUP BY c.id, c.phone, c.openid, COALESCE(c.last_store_id, c.first_store_id, '')
     ), signal_base AS (
       SELECT
         s.customer_id,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'price_sensitivity') AS signal_price_sensitivity,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'adventurous_score') AS adventurous_score,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'health_conscious_score') AS health_conscious_score,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'response_to_discount') AS response_to_discount,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'date')::numeric AS occasion_date_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'family')::numeric AS occasion_family_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'business')::numeric AS occasion_business_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'solo')::numeric AS occasion_solo_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'friends')::numeric AS occasion_friends_score,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.signal_value) FILTER (WHERE s.signal_key = 'favorite_dish' AND COALESCE(s.signal_value,'') <> ''), NULL) AS favorite_dishes,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.signal_value) FILTER (WHERE s.signal_type = 'semantic_tag' AND COALESCE(s.signal_value,'') <> ''), NULL) AS semantic_tags
        FROM growth_profile_signals s
        WHERE s.occurred_at >= CURRENT_DATE - ($1::int || ' days')::interval
        GROUP BY s.customer_id
      ), pos_base AS (
        SELECT
          gc.id AS customer_id,
          COUNT(po.order_no)::int AS pos_order_count,
          COALESCE(SUM(po.amount_after_discount), 0) AS pos_total_spend,
          ROUND(AVG(po.amount_after_discount), 2) AS avg_check,
          COUNT(*) FILTER (WHERE po.order_type = '堂食')::numeric / NULLIF(COUNT(*)::numeric, 0) AS pos_dine_in_ratio,
          MAX(po.biz_date) AS pos_last_order_at,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT poi.dish_name) FILTER (WHERE poi.dish_name IS NOT NULL AND poi.dish_name <> '-' AND poi.category <> '-'), NULL) AS pos_favorite_dishes
        FROM growth_customers gc
        INNER JOIN pos_orders po ON gc.phone = po.phone AND po.phone <> ''
        LEFT JOIN pos_order_items poi ON poi.order_no = po.order_no AND poi.category IS NOT NULL AND poi.category <> '-'
        GROUP BY gc.id
      )
      INSERT INTO growth_customer_profiles (
        customer_id, phone, openid, store_id, lifecycle_stage,
        next_visit_probability, best_contact_window, preferred_visit_time,
        avg_party_size, response_to_discount, price_sensitivity,
        adventurous_score, health_conscious_score, spicy_level,
        occasion_date_score, occasion_family_score, occasion_business_score,
        occasion_solo_score, occasion_friends_score,
        favorite_dishes, semantic_tags, source_signals, last_profiled_at, updated_at,
        pos_order_count, pos_total_spend, avg_check, pos_dine_in_ratio, pos_last_order_at
      )
     SELECT
       e.customer_id,
       e.phone,
       e.openid,
       NULLIF(e.store_id, ''),
        CASE
          -- 潜在新客：扫码/被触达但从未下单（陪客等）
          WHEN GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) = 0 THEN 'prospect'
          -- 新客：累计下单1次 且 最近14天内有到店
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '14 days'
               AND GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) = 1 THEN 'new'
          -- 活跃客：累计下单≥2次 且 最近14天内有到店
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '14 days'
               AND GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) >= 2 THEN 'active'
          -- 临界客：14-30天未到店
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '30 days' THEN 'at_risk'
          -- 长期流失客：90天以上未到店，按时长细分（资料再利用，分批触达试召回）
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) < NOW() - INTERVAL '365 days' THEN 'lost_365'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) < NOW() - INTERVAL '180 days' THEN 'lost_180'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) < NOW() - INTERVAL '90 days' THEN 'lost_90'
          -- 沉睡老客：30-90天未到店 且 曾累计下单≥2次（值得花力气召回）
          WHEN GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) >= 2 THEN 'dormant'
          -- 流失低频客：30-90天未到店 且 只下过1单
          ELSE 'churned'
        END,
        CASE
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '7 days' THEN 0.85
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '14 days' THEN 0.65
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '30 days' THEN 0.35
          ELSE 0.1
        END,
       CASE COALESCE(e.preferred_visit_time, '晚市')
         WHEN '午市' THEN '周四 11:00-13:00'
         WHEN '夜间' THEN '周五 20:00-22:00'
         ELSE '周五 17:00-19:00'
       END,
       COALESCE(e.preferred_visit_time, '晚市'),
       COALESCE(e.avg_party_size, 1),
       COALESCE(s.response_to_discount,
         CASE WHEN e.discount_touch_count > 0 THEN ROUND(e.discount_convert_count::numeric / e.discount_touch_count, 4) ELSE 0 END),
       COALESCE(s.signal_price_sensitivity,
         CASE WHEN e.discount_touch_count > 0 THEN ROUND(LEAST(1, e.discount_convert_count::numeric / e.discount_touch_count), 4) ELSE 0.2 END),
       COALESCE(s.adventurous_score, 0.5),
       COALESCE(s.health_conscious_score, 0.5),
       COALESCE(e.spicy_level, 0.5),
       COALESCE(s.occasion_date_score, 0),
       COALESCE(s.occasion_family_score, 0),
       COALESCE(s.occasion_business_score, 0),
       COALESCE(s.occasion_solo_score, 0),
       COALESCE(s.occasion_friends_score, 0),
        COALESCE(to_jsonb(ARRAY(SELECT DISTINCT unnest(COALESCE(s.favorite_dishes, '{}') || COALESCE(p.pos_favorite_dishes, '{}')))), '[]'::jsonb),
        COALESCE(to_jsonb(s.semantic_tags), '[]'::jsonb),
        jsonb_build_object(
          'payment_count', e.payment_count,
          'discount_touch_count', e.discount_touch_count,
          'discount_convert_count', e.discount_convert_count,
          'pos_order_count', COALESCE(p.pos_order_count, 0),
          'pos_total_spend', COALESCE(p.pos_total_spend, 0),
          'source_days', $1
        ),
        NOW(), NOW(),
        COALESCE(p.pos_order_count, 0),
        COALESCE(p.pos_total_spend, 0),
        COALESCE(p.avg_check, ROUND(e.avg_party_size, 2)),
        p.pos_dine_in_ratio,
        p.pos_last_order_at
      FROM event_base e
      LEFT JOIN signal_base s ON s.customer_id = e.customer_id
      LEFT JOIN pos_base p ON p.customer_id = e.customer_id
      ON CONFLICT (customer_id) DO UPDATE SET
        phone = EXCLUDED.phone,
        openid = EXCLUDED.openid,
        store_id = EXCLUDED.store_id,
        lifecycle_stage = EXCLUDED.lifecycle_stage,
        next_visit_probability = EXCLUDED.next_visit_probability,
        best_contact_window = EXCLUDED.best_contact_window,
        preferred_visit_time = EXCLUDED.preferred_visit_time,
        avg_party_size = EXCLUDED.avg_party_size,
        response_to_discount = EXCLUDED.response_to_discount,
        price_sensitivity = EXCLUDED.price_sensitivity,
        adventurous_score = EXCLUDED.adventurous_score,
        health_conscious_score = EXCLUDED.health_conscious_score,
        spicy_level = EXCLUDED.spicy_level,
        occasion_date_score = EXCLUDED.occasion_date_score,
        occasion_family_score = EXCLUDED.occasion_family_score,
        occasion_business_score = EXCLUDED.occasion_business_score,
        occasion_solo_score = EXCLUDED.occasion_solo_score,
        occasion_friends_score = EXCLUDED.occasion_friends_score,
        favorite_dishes = EXCLUDED.favorite_dishes,
        semantic_tags = EXCLUDED.semantic_tags,
        source_signals = EXCLUDED.source_signals,
        pos_order_count = EXCLUDED.pos_order_count,
        pos_total_spend = EXCLUDED.pos_total_spend,
        avg_check = EXCLUDED.avg_check,
        pos_dine_in_ratio = EXCLUDED.pos_dine_in_ratio,
        pos_last_order_at = EXCLUDED.pos_last_order_at,
        last_profiled_at = NOW(),
        updated_at = NOW()`,
    [safeDays]
  );

  // 价值分级：按门店内消费额分位，前15%为vip、30%-85%为regular、其余low
  // 冷启动期门店人数少时分位会有噪声，属预期内——先让分层有人、规则能跑
  await pool.query(`
    WITH ranked AS (
      SELECT customer_id,
             PERCENT_RANK() OVER (
               PARTITION BY COALESCE(NULLIF(store_id, ''), '*')
               ORDER BY COALESCE(pos_total_spend, 0)
             ) AS pct
      FROM growth_customer_profiles
      WHERE COALESCE(pos_total_spend, 0) > 0
    )
    UPDATE growth_customer_profiles p
    SET value_tier = CASE
          WHEN r.pct >= 0.85 THEN 'vip'
          WHEN r.pct >= 0.30 THEN 'regular'
          ELSE 'low'
        END
    FROM ranked r
    WHERE p.customer_id = r.customer_id
  `);
  // 未消费客户（潜在新客）固定为 low
  await pool.query(`UPDATE growth_customer_profiles SET value_tier = 'low' WHERE COALESCE(pos_total_spend, 0) = 0`);

  // 价格敏感标签：价格敏感度>0.5 或 折扣响应率>0.4
  await pool.query(`
    UPDATE growth_customer_profiles
    SET price_sensitive = (COALESCE(price_sensitivity, 0) > 0.5 OR COALESCE(response_to_discount, 0) > 0.4)
  `);

  return safeDays;
}

// 核销时小程序常未填消费金额（amount_fen=0），且POS数据是按天批量同步、核销当时查不到。
// 每天凌晨批量补算：按"同门店+同手机号+核销时间前后2小时内最近一单"匹配 pos_orders 回填，
// 只扫近7天内仍为0的核销记录，匹配不到则保持0（不影响现有数据）。
async function backfillRedemptionAmounts(pool) {
  const r = await pool.query(`
    WITH matched AS (
      SELECT DISTINCT ON (gr.id) gr.id AS redemption_id, po.amount_after_discount
      FROM growth_redemptions gr
      JOIN growth_customers gc ON gc.id = gr.customer_id
      JOIN pos_orders po ON po.store_id = gr.store_id AND po.phone = gc.phone
        AND po.order_time BETWEEN gr.redeemed_at - INTERVAL '2 hours' AND gr.redeemed_at + INTERVAL '30 minutes'
      WHERE gr.amount_fen = 0
        AND gr.redeemed_at >= NOW() - INTERVAL '7 days'
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
          `INSERT INTO growth_learnings (source_type, source_id, store_code, channel, scene, audience_tag, variable, winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, is_verified)
           VALUES ('ai_suggestion',$1,$2,'sms',NULL,$3,'AI建议方案有效性',$4,$5,$6,$7,$8,$9,true)
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
            new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
          ]
        ).catch(() => {});
      }
      count++;
    } catch (e) {
      console.warn('[sms-backfill] error for', action.action_key, e?.message);
    }
  }
  return count;
}

async function appendExecutionLog(pool, payload) {
  await pool.query(
    `INSERT INTO growth_execution_logs (
      action_key, strategy_key, store_id, action_type, decision,
      operator_username, operator_role, before_payload, after_payload,
      decision_reason, result_summary
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
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
      cleanText(payload.result_summary, 2000)
    ]
  );
}

async function getStateValue(pool, key) {
  const r = await pool.query(`SELECT data FROM hrms_state WHERE key = $1 LIMIT 1`, [key]);
  return r.rows?.[0]?.data || null;
}

function fmtYmd(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

function fmtYm(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 7);
}

function deriveBirthdayMonth(meta = {}) {
  const monthRaw = cleanText(meta?.birthday_month, 2);
  if (/^(0?[1-9]|1[0-2])$/.test(monthRaw)) return monthRaw.padStart(2, '0');
  const birthday = cleanText(meta?.birthday, 32);
  const m = birthday.match(/^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!m) return '';
  return String(m[1]).padStart(2, '0');
}

function interpolateTemplate(template, context) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = context[key];
    return value == null ? '' : String(value);
  });
}

async function insertGrowthEvent(pool, payload) {
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  await pool.query(
    `INSERT INTO growth_events (
       event_type, customer_id, phone, openid, external_userid, store_id, campaign_id, channel,
       coupon_id, order_id, amount_fen, idempotency_key, metadata, occurred_at
     ) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),$11,NULLIF($12,''),$13::jsonb,$14)
     ON CONFLICT (idempotency_key) DO NOTHING`,
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
      parseOccurredAt(payload.occurred_at)
    ]
  );
}

async function upsertDeliveryLog(pool, payload) {
  const r = await pool.query(
    `INSERT INTO growth_delivery_logs (
       delivery_key, action_key, rule_key, customer_id, store_id, channel,
       external_userid, provider_msg_id, status, payload, result, error_message, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,NOW())
     ON CONFLICT (delivery_key) DO UPDATE SET
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
      payload.customer_id ? Number(payload.customer_id) : null,
      cleanText(payload.store_id, 128),
      cleanText(payload.channel || 'wecom', 40),
      cleanText(payload.external_userid, 128),
      cleanText(payload.provider_msg_id, 255),
      cleanText(payload.status || 'pending', 40),
      JSON.stringify(payload.payload || {}),
      JSON.stringify(payload.result || {}),
      cleanText(payload.error_message, 2000)
    ]
  );
  return r.rows[0] || null;
}

let __growthWecomTokenCache = { token: '', expiresAt: 0, store_id: '' };
let __storeWecomTokenCaches = {};

async function getWecomConfig(pool) {
  const config = await getStateValue(pool, 'growth_wecom_config');
  return config && typeof config === 'object' ? config : null;
}

async function getStoreWecomConfig(pool, storeId) {
  if (!storeId) return null;
  const r = await pool.query('SELECT * FROM store_wecom_configs WHERE store_id = $1 LIMIT 1', [storeId]);
  return r.rows[0] || null;
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
    const r = await pool.query('SELECT tenant_id FROM employees WHERE store = $1 AND tenant_id IS NOT NULL LIMIT 1', [sid]);
    const tid = String(r.rows?.[0]?.tenant_id || '').trim() || 'default';
    __storeTenantCache[sid] = tid;
    return tid;
  } catch (_e) {
    return 'default';
  }
}

async function getAllStoreWecomConfigs(pool) {
  const r = await pool.query('SELECT * FROM store_wecom_configs ORDER BY store_id');
  return r.rows;
}

async function getWecomAccessToken(pool, storeId) {
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

function buildActionMessage(actionRow, payload) {
  const couponValueFen = Math.max(0, Math.floor(Number(payload.coupon_value_fen || payload.value_fen) || 0));
  const favoriteDishesText = cleanText(payload.favorite_dishes_text || '', 200) || '店内推荐菜';
  const context = {
    customer_name: cleanText(payload.customer_name || '您好', 80) || '您好',
    days_since_last_visit: Math.max(0, Math.floor(Number(payload.days_since_last_visit) || 0)),
    visit_count: Math.max(0, Math.floor(Number(payload.visit_count) || 0)),
    coupon_value_text: couponValueFen > 0 ? `¥${(couponValueFen / 100).toFixed(0)}` : '',
    valid_days: Math.max(0, Math.floor(Number(payload.valid_days) || 0)),
    favorite_dishes_text: favoriteDishesText
  };
  const template = cleanText(payload.content_template || payload.message_template, 1800);
  if (template) return interpolateTemplate(template, context);
  return cleanText(actionRow.detail || actionRow.title || '', 1800);
}

// 门店→已报备短信模板（每店一个独立模板，模板正文里写死了对应门店名，绝不能发错店）。
// 模板 CODE 从环境变量读取；后缀映射在 brands-config.js 维护，增改门店不动此处代码。
function pickSmsTemplateByStore(storeId) {
  const sfx = getStoreSmsEnvSuffix(storeId);
  const def = String(process.env.ALIYUN_SMS_TEMPLATE_DEFAULT || '').trim();
  return String(process.env[`ALIYUN_SMS_TEMPLATE_${sfx}`] || '').trim() || def;
}

// 沉睡客召回券「现金抵用券」新模板（变量 name/value/date/code，含券码到店报码核销）。
function pickWinbackTemplateByStore(storeId) {
  const sfx = getStoreSmsEnvSuffix(storeId);
  const def = String(process.env.ALIYUN_SMS_WINBACK_TEMPLATE_DEFAULT || '').trim();
  return String(process.env[`ALIYUN_SMS_WINBACK_TEMPLATE_${sfx}`] || '').trim() || def;
}

// 储值余额提醒模板（变量仅 balance；无券无码，提醒客人用余额+推荐菜促复购）。
// 可被规则/任务里的 sms_template_code 覆盖。
function pickBalanceTemplateByStore(storeId) {
  const sfx = getStoreSmsEnvSuffix(storeId);
  const def = String(process.env.ALIYUN_SMS_BALANCE_TEMPLATE_DEFAULT || '').trim();
  return String(process.env[`ALIYUN_SMS_BALANCE_TEMPLATE_${sfx}`] || '').trim() || def;
}

// 通用「营销发券一键发起」段配置。所有带券码段统一走召回任务管道：
// HRMS 冻结 job(kind=段key) → 小程序 runWinbackJobs 生成短码+写 user_vouchers → 调 HRMS 发短信。
// 券码因此在小程序 user_vouchers 落地，核销台 verifyVoucher 可校验+统计。
// source='profiles' 取 growth_customer_profiles(到店次数/天数/价值分级)；'stored' 取储值客户表。
// 沉睡60-90 沿用现有「储值召回」页(winback)，不在此注册。
// vars: 该段阿里云模板的变量集合(须与已报备模板逐字一致，否则整批拒收)。
// 赠菜/赠糖水类只有 date+code(无门槛礼品券)；长期流失是 value+date+code 的满额回归券(2张/1码核销2次)。
const CAMPAIGN_TYPES = {
  vip_gift:       { label: 'VIP客户维护',          source: 'profiles', tplPrefix: 'VIP',       coupon_count: 1, vars: ['date', 'code'] },
  newcomer_4d:    { label: '新客回头·4天',         source: 'profiles', tplPrefix: 'NEW4',      coupon_count: 1, vars: ['date', 'code'] },
  newcomer_8d:    { label: '新客回头·8天',         source: 'profiles', tplPrefix: 'NEW8',      coupon_count: 1, vars: ['date', 'code'] },
  // 新客二次召回(21-60天,到店1次,现金券): env ALIYUN_SMS_NEWRECALL_* (SMS_507205142/SMS_507240155)
  newcomer_recall:{ label: '新客二次召回·21-60天',  source: 'profiles', tplPrefix: 'NEWRECALL', coupon_count: 1, vars: ['value', 'date', 'code'] },
  // 常客降温唤醒(21-60天,到店≥2次,赠品券,复用活跃模板): env ALIYUN_SMS_COOLING_* (SMS_507100271/SMS_507400282)
  regular_cooling:{ label: '常客降温唤醒·21-60天',  source: 'profiles', tplPrefix: 'COOLING',   coupon_count: 1, vars: ['date', 'code'] },
  active:         { label: '活跃客经营',           source: 'profiles', tplPrefix: 'ACTIVE',    coupon_count: 1, vars: ['date', 'code'] },
  // VIP专属召回(61-365天,VIP,现金券): env ALIYUN_SMS_VIPWB_* (SMS_507220292/SMS_507240296)
  vip_winback:    { label: 'VIP专属召回·61-365天', source: 'profiles', tplPrefix: 'VIPWB',     coupon_count: 1, vars: ['value', 'date', 'code'] },
  // 沉睡召回60-90：沿用现有 winback 已报备模板(SMS_507220292/SMS_507240296)，env 见 ALIYUN_SMS_DORM6090_*
  dormant_60_90:  { label: '沉睡召回·60-90天',     source: 'profiles', tplPrefix: 'DORM6090',  coupon_count: 1, vars: ['value', 'date', 'code'] },
  // 沉睡召回90-180：短信后补，未配 env → pickCampaignTemplate 返回 '' → 不可发(launch/send 报 sms_template_not_configured)
  dormant_90_180: { label: '沉睡召回·90-180天',    source: 'profiles', tplPrefix: 'DORM90180', coupon_count: 1, vars: ['value', 'date', 'code'] },
  lost_long:      { label: '长期流失召回·181-365天', source: 'profiles', tplPrefix: 'LOSTLONG',  coupon_count: 2, vars: ['value', 'date', 'code'] },
  // 长期流失超1年(>365天)：与181-365分开运营，频次30天/有效期30天。env ALIYUN_SMS_LOSTOVER365_* (洪潮SMS_507890076/马己仙SMS_507105250)
  lost_over365:   { label: '长期流失超1年召回',      source: 'profiles', tplPrefix: 'LOSTOVER365', coupon_count: 2, vars: ['value', 'date', 'code'] },
  // 就餐时段标签(基于 growth_segment_members，按 criteria.segment_key 命中)：
  // 马己仙晚市/周末复购客(现金券) env ALIYUN_SMS_MJDINNERWK_MAJIXIAN=SMS_508075082
  mj_dinner_weekend: { label: '马己仙晚市/周末复购客', source: 'profiles', tplPrefix: 'MJDINNERWK', coupon_count: 1, vars: ['value', 'date', 'code'] },
  // 洪潮平日午市客唤醒(赠菜券,无面额) env ALIYUN_SMS_HCWDLUNCH_HONGCHAO=SMS_508135078
  hc_weekday_lunch:  { label: '洪潮平日午市客唤醒',   source: 'profiles', tplPrefix: 'HCWDLUNCH',  coupon_count: 1, vars: ['date', 'code'] },
  // 券类型A/B「免费菜组」：复用活跃客马己仙赠菜模板(SMS_507100271)，但独立 campaign_key 保证打分不混。
  // env ALIYUN_SMS_MJDWGIFT_MAJIXIAN=SMS_507100271
  mj_dinner_weekend_gift: { label: '马己仙晚市赠菜券(A/B免费菜组)', source: 'profiles', tplPrefix: 'MJDWGIFT', coupon_count: 1, vars: ['date', 'code'] },
  // 到店未买单潜客召回：扫码/陪客但从未下单，先券后菜促首单。走 ABC 轮换(复用 ABC 6模板，无新模板)。
  prospect_recall: { label: '到店未买单潜客召回', source: 'profiles', tplPrefix: 'PROSPECT', coupon_count: 1, vars: ['value', 'date', 'code'] },
};
// 按段+门店解析阿里云模板 code：ALIYUN_SMS_<PREFIX>_<MAJIXIAN|HONGCHAO|DEFAULT>
function pickCampaignTemplate(campaignKey, storeId) {
  const cfg = CAMPAIGN_TYPES[campaignKey];
  if (!cfg) return '';
  const pfx = cfg.tplPrefix;
  const sfx = getStoreSmsEnvSuffix(storeId);
  const def = String(process.env[`ALIYUN_SMS_${pfx}_DEFAULT`] || '').trim();
  return String(process.env[`ALIYUN_SMS_${pfx}_${sfx}`] || '').trim() || def;
}

// 解析「天数」类环境变量：未配置(缺省/空串)用默认值；显式填 0 表示「关闭频控」。
// 修复老坑：旧写法 `Number(env) || 30` 把 0 当假值会回落成 30，导致频控永远关不掉。
function freqDaysEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : def;
}

// 全局短信总闸：同一手机号 N 天内最多收 1 条「任意类型」营销短信，跨所有触达段叠加防骚扰。
// 默认 7 天(每周最多 1 条)，由 ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS 配置，设 0 关闭。
// 只统计真正发出(status='sent')的记录；命中返回 days(>0)，未命中返回 0。
async function globalSmsCapped(pool, phone) {
  const days = freqDaysEnv('ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS', 7);
  const p = String(phone || '').trim();
  if (days <= 0 || !p) return 0;
  const r = await pool.query(
    `SELECT 1 FROM growth_delivery_logs
       WHERE channel = 'sms' AND status = 'sent' AND payload->>'phone' = $1
         AND created_at > now() - ($2 || ' days')::interval
       LIMIT 1`,
    [p, String(days)]
  );
  return r.rows.length ? days : 0;
}

// 允许发送时段：SMS_SEND_WINDOWS（逗号分隔多段，格式 HH:MM-HH:MM，北京时间）。
// 默认两个窗口：午市前 10:30-12:00 + 晚市前 17:00-20:30。
// 窗口外均为禁发时段，任务保持 pending，窗口内自动续跑。
function inSmsQuietHours(now = new Date()) {
  const toMins = (s) => { const [h, m] = (s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const bjMins = (() => {
    const p = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
    const h = Number((p.find((x) => x.type === 'hour') || {}).value || 0);
    const m = Number((p.find((x) => x.type === 'minute') || {}).value || 0);
    return h * 60 + m;
  })();
  const raw = cleanText(process.env.SMS_SEND_WINDOWS || '10:30-12:00,17:00-20:30', 200);
  const windows = raw.split(',').map((w) => { const [s, e] = w.trim().split('-'); return [toMins(s), toMins(e)]; });
  return !windows.some(([s, e]) => bjMins >= s && bjMins < e);
}

// 永久性失败判别 → 入抑制名单，后续一切营销短信跳过。
// 注意：「业务停机」不算永久失败！实测停机号码绝大多数之前都成功发过，属临时状态
// （关机/临时欠费），下次照常重试（7天频控自然控制节奏）。只有空号/号码非法/黑名单退订
// 才是真正不可达或客人明确拒收，需永久抑制。
const SMS_PERMANENT_FAIL_RE = /空号|黑名单|号码状态错误|MOBILE_NUMBER_ILLEGAL|MOBILE_NUMBER_NULL|BLACK_KEY_CONTROL_LIMIT/i;
// 账户级故障判别：余额不足 → 写 growth_alerts 高优告警（前台已有告警展示）。
const SMS_BALANCE_FAIL_RE = /余额不足|AMOUNT_NOT_ENOUGH|OUT_OF_SERVICE/i;

async function isPhoneSuppressed(pool, phone) {
  const p = String(phone || '').trim();
  if (!p) return false;
  const r = await pool.query(`SELECT 1 FROM growth_sms_suppression WHERE phone = $1 LIMIT 1`, [p]);
  return r.rows.length > 0;
}

// 发送失败后调用：永久性失败入抑制名单；余额不足写告警。容错（自身失败不影响主流程）。
async function handleSmsFailure(pool, phone, errMsg) {
  const msg = String(errMsg || '');
  try {
    const p = String(phone || '').trim();
    if (p && SMS_PERMANENT_FAIL_RE.test(msg)) {
      await pool.query(
        `INSERT INTO growth_sms_suppression (phone, reason, error_message) VALUES ($1, 'permanent_failure', $2)
         ON CONFLICT (phone) DO UPDATE SET error_message = EXCLUDED.error_message, updated_at = NOW()`,
        [p, msg.slice(0, 500)]
      );
    }
    if (SMS_BALANCE_FAIL_RE.test(msg)) {
      const alertKey = `sms_account_balance:${new Date().toISOString().slice(0, 10)}`;
      await pool.query(
        `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics)
         VALUES ($1,'sms_account','high','','阿里云短信账户余额不足，发送已失败','短信发送返回「${msg.slice(0, 120)}」。在余额恢复前所有营销短信都会失败。','前往阿里云控制台为短信账户充值，并核对今日失败记录是否需要补发',$2::jsonb)
         ON CONFLICT (alert_key) DO UPDATE SET message = EXCLUDED.message, status = 'open', updated_at = NOW()`,
        [alertKey, JSON.stringify({ error: msg.slice(0, 200) })]
      );
    }
  } catch (e) { console.warn('[growth] handleSmsFailure error:', e?.message); }
}

// 触达上限：同一手机号同一活动累计成功发送 N 次（默认3）仍未回店则永久停发该活动，
// 防止对明确不响应的客人无限期发券。回店后 days_since 重置、自然脱离人群，不受此限影响。
async function campaignTouchCapped(pool, campaignKey, phone) {
  const cap = Math.max(0, Math.floor(Number(process.env.ALIYUN_SMS_CAMPAIGN_MAX_TOUCHES) || 3));
  if (cap <= 0) return false;
  const r = await pool.query(
    `SELECT count(*)::int n FROM growth_delivery_logs
      WHERE channel='sms' AND status='sent' AND rule_key = $1 AND payload->>'phone' = $2`,
    [campaignKey, String(phone || '').trim()]
  );
  return (Number(r.rows[0]?.n) || 0) >= cap;
}

const ABC_DEFAULT_LADDER_DAYS = [15, 30, 45, 60];

// ABC方案轮换(活动制)：8条常规段「赠菜A/B/C + 赠券30/50/2X50」共6个模板按固定顺序轮换
// (顺序差异=先菜后券 vs 先券后菜)；马己仙晚市2条拆分段各自只含本组3个模板。
// 顺序即"该客户在本活动下累计成功发送次数 % 模板数"对应到第几个模板。
const ABC_ROTATION_ORDER = {
  vip_gift:               ['giftA', 'giftB', 'giftC', 'coupon30', 'coupon50', 'coupon2x50'], // VIP客户维护：先菜后券
  active:                 ['giftA', 'giftB', 'giftC', 'coupon30', 'coupon50', 'coupon2x50'], // 活跃客经营：先菜后券
  regular_cooling:        ['giftA', 'giftB', 'giftC', 'coupon30', 'coupon50', 'coupon2x50'], // 常客降温唤醒21-60天：先菜后券
  dormant_90_180:         ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'], // 沉睡召回90-180天：先券后菜
  newcomer_recall:        ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'], // 新客二次召回21-60天：先券后菜
  dormant_60_90:          ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'], // 沉睡召回60-90天：先券后菜
  vip_winback:            ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'], // VIP专属召回61-365天：先券后菜
  lost_long:              ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'], // 长期流失召回181-365天：先券后菜
  lost_over365:           ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'], // 长期流失超1年召回：先券后菜
  mj_dinner_weekend_gift: ['giftA', 'giftB', 'giftC'],                                       // 马己仙晚市·免费菜组：只赠菜
  mj_dinner_weekend:      ['coupon30', 'coupon50', 'coupon2x50'],                            // 马己仙晚市·现金券组：只赠券
  prospect_recall:        ['coupon30', 'coupon50', 'coupon2x50', 'giftA', 'giftB', 'giftC'], // 到店未买单潜客：先券后菜
};

// 6个模板各自的短信变量集合与券面额/张数。2X50=2张50元券(coupon_count:2)，
// 与现有 lost_long/lost_over365 的「2张/1码核销2次」模式一致。
const ABC_STEP_DEFS = {
  giftA:      { vars: ['date', 'code'], coupon_value_fen: 0, coupon_count: 1 },
  giftB:      { vars: ['date', 'code'], coupon_value_fen: 0, coupon_count: 1 },
  giftC:      { vars: ['date', 'code'], coupon_value_fen: 0, coupon_count: 1 },
  coupon30:   { vars: ['value', 'date', 'code'], coupon_value_fen: 3000, coupon_count: 1 },
  coupon50:   { vars: ['value', 'date', 'code'], coupon_value_fen: 5000, coupon_count: 1 },
  coupon2x50: { vars: ['value', 'date', 'code'], coupon_value_fen: 5000, coupon_count: 2 },
};

// 按模板步骤+门店解析阿里云模板code：ALIYUN_SMS_ABC<STEP>_<MAJIXIAN|HONGCHAO|DEFAULT>
const ABC_STEP_TPL_PREFIX = {
  giftA: 'ABCGIFTA', giftB: 'ABCGIFTB', giftC: 'ABCGIFTC',
  coupon30: 'ABCCOUPON30', coupon50: 'ABCCOUPON50', coupon2x50: 'ABCCOUPON2X50',
};
function pickAbcTemplate(step, storeId) {
  const pfx = ABC_STEP_TPL_PREFIX[step];
  if (!pfx) return '';
  const sfx = getStoreSmsEnvSuffix(storeId);
  const def = String(process.env[`ALIYUN_SMS_${pfx}_DEFAULT`] || '').trim();
  return String(process.env[`ALIYUN_SMS_${pfx}_${sfx}`] || '').trim() || def;
}

// 按"该手机号在本活动下累计成功发送次数"纯推导当前应发的模板步骤+降频阶梯天数。
// 单调降频：第1轮起每条间隔即按阶梯 15→30→45→60 天逐轮变慢；共走 4 轮(=阶梯长度)，
// 每轮一整套模板(常规段6条/马己仙拆分段3条)；满 模板数×4 条(常规24/马己仙12)仍未回应
// → 该客户对本活动进入"红名单"，不再自动触达。中途到店消费会清零(见 countCampaignSent)。
function deriveAbcStep(campaignKey, totalSent) {
  const order = ABC_ROTATION_ORDER[campaignKey];
  if (!order) return { step: null, freqDaysOverride: null, blacklisted: false };
  const ladder = ABC_DEFAULT_LADDER_DAYS; // [15,30,45,60]
  const perCycle = order.length;
  const blacklistAt = perCycle * ladder.length; // 常规6×4=24，马己仙3×4=12
  if (totalSent >= blacklistAt) return { step: null, freqDaysOverride: null, blacklisted: true };
  const cycleIdx = Math.floor(totalSent / perCycle); // 0..3
  const posInCycle = totalSent % perCycle;
  const freqDaysOverride = ladder[cycleIdx]; // 第1轮即15，单调15/30/45/60
  return { step: order[posInCycle], freqDaysOverride, blacklisted: false };
}

// 「到店即清零」：轮换计数只统计客户「最近一次到店(pos_last_order_at)之后」的成功发送数。
// 这样自循环段(VIP客户维护/活跃客经营)里每次回头消费都会让轮换从头开始、不会把忠诚回头客
// 误推进降频阶梯/红名单；而真正不回头的客户发送数持续累积，照常走阶梯并最终入红名单。
// 从未到店(pos_last_order_at 为空)的潜客则统计全部发送数(无到店可清零)。
async function countCampaignSent(pool, campaignKey, phone) {
  const p = String(phone || '').trim();
  const r = await pool.query(
    `SELECT count(*)::int n FROM growth_delivery_logs
      WHERE channel='sms' AND status='sent' AND rule_key = $1 AND payload->>'phone' = $2
        AND created_at > COALESCE(
          (SELECT MAX(pos_last_order_at) FROM growth_customer_profiles WHERE phone = $2),
          '1970-01-01'::timestamptz)`,
    [campaignKey, p]
  );
  return Number(r.rows[0]?.n) || 0;
}

// 跨活动疲劳总闸：某号码在 MARKETING_FATIGUE_WINDOW_DAYS(默认90)天内、且「最近一次到店之后」
// 累计收到的【任意活动】营销短信达到 MARKETING_FATIGUE_MAX(默认8)条仍未回店 → 暂停其所有营销短信。
// 解决「不回应客人随距今天数变大滑过多个标签、每段ABC计数清零导致跨标签累计轰炸」的问题。
// 一旦到店消费，post-visit 计数归零，疲劳状态自动解除。返回 true=已疲劳应暂停。
function marketingFatigueMax() {
  const v = Number(process.env.MARKETING_FATIGUE_MAX);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 8;
}
function marketingFatigueWindowDays() {
  const v = Number(process.env.MARKETING_FATIGUE_WINDOW_DAYS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 90;
}
async function marketingFatigueCapped(pool, phone) {
  const p = String(phone || '').trim();
  if (!p) return false;
  const max = marketingFatigueMax();
  const win = marketingFatigueWindowDays();
  const r = await pool.query(
    `SELECT count(*)::int n FROM growth_delivery_logs
      WHERE channel='sms' AND status='sent' AND payload->>'phone' = $1
        AND created_at > now() - ($2 || ' days')::interval
        AND created_at > COALESCE(
          (SELECT MAX(pos_last_order_at) FROM growth_customer_profiles WHERE phone = $1),
          '1970-01-01'::timestamptz)`,
    [p, String(win)]
  );
  return (Number(r.rows[0]?.n) || 0) >= max;
}

// holdout 对照组：md5(phone) 前4位十六进制 %100 < pct 即入对照组（确定性、与活动无关的均匀抽样）。
function holdoutPct() {
  const v = Number(process.env.GROWTH_HOLDOUT_PCT);
  return Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), 0), 50) : 10;
}
function phoneHashPct(phone) {
  const h = crypto.createHash('md5').update(String(phone || '')).digest('hex');
  return parseInt(h.slice(0, 4), 16) % 100;
}
// A/B 分桶：用 md5 的不同片段(slice 8-12)，与 holdout(slice 0-4) 独立，避免两者抽样相关联。
function phoneAbBucket(phone, n) {
  const h = crypto.createHash('md5').update(String(phone || '')).digest('hex');
  return parseInt(h.slice(8, 12), 16) % Math.max(1, n);
}

// 通用发券人群(profiles)取数：可编辑筛选(门店/价值分级/生命周期/到店次数/未消费天数)+频控。
// 返回 SQL 与参数，preview 与 launch 共用，保证「预览即所发」。
// 至少需一个人群维度，否则视为全量、拒绝(防误群发)。
function buildCampaignTargetQuery(opts) {
  const { storeId, valueTier, lifecycleStage, minVisits, maxVisits, minDays, maxDays, ruleKey, freqDays, limit } = opts;
  const hasAudience = !!(valueTier || lifecycleStage
    || Number.isFinite(minVisits) || Number.isFinite(maxVisits)
    || Number.isFinite(minDays) || Number.isFinite(maxDays));
  if (!hasAudience) return null;
  const params = [String(Math.max(0, Math.floor(Number(freqDays) || 0)))];
  const daysExpr = '(CURRENT_DATE - COALESCE(cp.pos_last_order_at::date, gc.last_seen_at::date))';
  const clauses = ["cp.phone IS NOT NULL AND cp.phone <> ''"];
  if (storeId) { params.push(storeId); clauses.push(`cp.store_id = $${params.length}`); }
  if (valueTier) { params.push(valueTier); clauses.push(`cp.value_tier = $${params.length}`); }
  if (lifecycleStage) { params.push(lifecycleStage); clauses.push(`cp.lifecycle_stage = $${params.length}`); }
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

// 门店名 → POS门店号(储值客户表里的开卡/交易门店是中文名)
function mapStoreNameToId(name) {
  return _storeNameToIdFromConfig(name);
}
// 飞书多维表字段值解析(文本/数字/日期/电话)
function bitText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x && (x.text || x.name)) || x).join(',');
  if (typeof v === 'object') return String(v.text || v.name || '');
  return String(v);
}
function bitNum(v) {
  if (v == null) return 0;
  if (typeof v === 'object' && v.text != null) return Number(v.text) || 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function bitDateMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (!isNaN(n) && n > 1e10) return n; // epoch ms
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
function bitPhone(v) { return bitText(v).replace(/[^0-9]/g, ''); }

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
async function readStoredValueBitableRecords() {
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
  const basePayload = before.payload && typeof before.payload === 'object' ? before.payload : {};
  const payload = Object.assign({}, basePayload, extraPayload || {});
  const storeId = cleanText(before.store_id || payload.store_id, 128);
  const campaignId = cleanText(before.campaign_id || payload.campaign_id, 128);
  const actionType = cleanText(before.action_type, 80);
  const actionKey = cleanText(before.action_key, 255);
  let executionResults = { action_type: actionType, real_executions: [] };

  try {
    if (actionType === 'send_voucher' || actionType === 'campaign_activate') {
      const title = cleanText(before.title, 500);
      const planId = cleanText(payload.plan_id, 128) || `exec_plan_${Date.now()}`;
      const channel = cleanText(payload.channel || 'miniprogram', 80);
      const sourceTemplateId = payload.source_template_id ? Number(payload.source_template_id) : null;
      const recommendedPosterId = payload.recommended_poster_id ? Number(payload.recommended_poster_id) : null;
      const planResult = await pool.query(
        `INSERT INTO growth_campaign_plans (plan_id, store_id, campaign_id, title, channel, status, planned_start, planned_end, created_by, source_template_id, recommended_poster_id)
         VALUES ($1,$2,$3,$4,$5,'active',NOW(),NOW() + ($6::int || ' days')::interval,$7,$8,$9)
         ON CONFLICT (plan_id) DO UPDATE SET status='active', updated_at=NOW()
         RETURNING plan_id, status`,
        [planId, storeId, campaignId || `camp_${Date.now()}`, title, channel, Math.max(1, Math.floor(Number(payload.valid_days) || 7)), operator.username, sourceTemplateId, recommendedPosterId]
      );
      executionResults.real_executions.push({ type: 'campaign_plan', plan_id: planResult.rows[0]?.plan_id, status: 'active' });
      if (sourceTemplateId) {
        pool.query('UPDATE marketing_templates SET use_count = use_count + 1 WHERE id = $1', [sourceTemplateId]).catch(() => {});
      }
      if (campaignId) {
        await pool.query(
          `INSERT INTO growth_campaigns (campaign_id, name, channel, store_id, status)
           VALUES ($1,$2,$3,$4,'active')
           ON CONFLICT (campaign_id) DO UPDATE SET status='active', updated_at=NOW()`,
          [campaignId, title, channel, storeId]
        );
        executionResults.real_executions.push({ type: 'campaign', campaign_id: campaignId, status: 'active' });
      }
      const couponId = payload.coupon_id ? cleanText(payload.coupon_id, 128) : `exec_coupon_${Date.now()}`;
      await pool.query(
        `INSERT INTO growth_coupons (coupon_id, name, type, value_fen, valid_days, usage_rule, store_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
         ON CONFLICT (coupon_id) DO UPDATE SET name=EXCLUDED.name, value_fen=EXCLUDED.value_fen, valid_days=EXCLUDED.valid_days, usage_rule=EXCLUDED.usage_rule, is_active=TRUE, updated_at=NOW()`,
        [
          couponId,
          cleanText(payload.coupon_name || before.title, 300),
          cleanText(payload.coupon_type || 'cash', 40),
          Math.max(0, Math.floor(Number(payload.coupon_value_fen || payload.value_fen) || 1000)),
          Math.max(1, Math.floor(Number(payload.valid_days) || 7)),
          cleanText(payload.usage_rule || '规则引擎自动触达', 1000),
          storeId
        ]
      );
      payload.coupon_id = couponId;
      executionResults.real_executions.push({ type: 'coupon', coupon_id: couponId });
    } else if (actionType === 'create_content' || actionType === 'promo_task') {
      const itemId = `exec_content_${Date.now()}`;
      const channel = cleanText(payload.channel || 'miniprogram', 80);
      const contentResult = await pool.query(
        `INSERT INTO growth_content_calendar (item_id, store_id, channel, publish_date, title, content_brief, copy_text, status)
         VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,'planned')
         RETURNING item_id`,
        [itemId, storeId, channel, cleanText(before.title, 500), cleanText(payload.content_brief || payload.detail, 2000), cleanText(before.detail, 4000)]
      );
      executionResults.real_executions.push({ type: 'content_calendar', item_id: contentResult.rows[0]?.item_id });
    } else if (actionType === 'generate_poster') {
      const posterKey = `exec_poster_${Date.now()}`;
      const posterResult = await pool.query(
        `INSERT INTO generated_posters (poster_key, campaign_id, store_id, title, status)
         VALUES ($1,$2,$3,$4,'generated')
         RETURNING poster_key`,
        [posterKey, campaignId, storeId, cleanText(before.title, 500)]
      );
      executionResults.real_executions.push({ type: 'poster', poster_key: posterResult.rows[0]?.poster_key });
    } else {
      executionResults.real_executions.push({ type: 'marked_executed', note: '直接执行触达动作' });
    }

    if (cleanText(payload.channel || '', 80) === 'wecom' && cleanText(payload.external_userid, 128)) {
      const deliveryKey = `${actionKey}:${cleanText(payload.external_userid, 128)}:${Date.now()}`;
      const messageContent = buildActionMessage(before, payload);
      try {
        const sent = await sendWecomExternalMessage(pool, {
          store_id: storeId,
          external_userid: cleanText(payload.external_userid, 128),
          sender_userid: cleanText(payload.sender_userid, 128),
          content: messageContent
        });
        payload.delivery_key = deliveryKey;
        payload.provider_msg_id = sent.provider_msg_id;
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey,
          action_key: actionKey,
          rule_key: cleanText(payload.rule_key, 128),
          customer_id: payload.customer_id,
          store_id: storeId,
          channel: 'wecom',
          external_userid: cleanText(payload.external_userid, 128),
          provider_msg_id: sent.provider_msg_id,
          status: 'sent',
          payload: { content: messageContent },
          result: sent.raw || {}
        });
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: payload.customer_id,
          phone: payload.phone,
          external_userid: payload.external_userid,
          store_id: storeId,
          campaign_id: campaignId,
          channel: 'wecom',
          coupon_id: payload.coupon_id,
          idempotency_key: `marketing_triggered:${actionKey}:${sent.provider_msg_id || deliveryKey}`,
          metadata: {
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            delivery_key: deliveryKey,
            provider_msg_id: sent.provider_msg_id,
            content: messageContent
          }
        });
        executionResults.real_executions.push({ type: 'wecom_message', provider_msg_id: sent.provider_msg_id || deliveryKey, status: 'sent' });
      } catch (deliveryErr) {
        executionResults.delivery_error = deliveryErr?.message || 'wecom_send_failed';
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey,
          action_key: actionKey,
          rule_key: cleanText(payload.rule_key, 128),
          customer_id: payload.customer_id,
          store_id: storeId,
          channel: 'wecom',
          external_userid: cleanText(payload.external_userid, 128),
          status: 'failed',
          payload: { content: messageContent },
          result: {},
          error_message: deliveryErr?.message || 'wecom_send_failed'
        });
      }
    } else if (cleanText(payload.channel || '', 80) === 'sms' && cleanPhone(payload.phone)) {
      const smsPhone = cleanPhone(payload.phone);
      const deliveryKey = `${actionKey}:${smsPhone}:${Date.now()}`;
      const couponValueFen = Math.max(0, Math.floor(Number(payload.coupon_value_fen || payload.value_fen) || 0));
      // 阿里云短信走「模板+参数」，且参数名/个数必须与已报备模板严格一致，否则被判
      // 「请检查模板内容与模板参数是否匹配」直接拒收（2026-05-31 整批失败即此原因：
      // 旧逻辑多传 dishes/count、无券时又把 value 删掉）。
      // 现按门店选模板（马己仙 SMS_507400089 / 洪潮 SMS_507130081），二者变量均为
      // name/days/value 三个，缺一不可、不得多传。
      // 同一触达段在两店是不同的已报备模板(CODE 不同)，而规则是「不分店」的一条，
      // 故支持 payload.sms_template_code_by_store = {"51866138":"SMS_xxx","64822111":"SMS_yyy"}，
      // 发送时按客人门店取；其次单一 sms_template_code；最后回退门店默认模板。
      const smsTplByStore = (payload.sms_template_code_by_store && typeof payload.sms_template_code_by_store === 'object')
        ? cleanText(payload.sms_template_code_by_store[storeId], 64) : '';
      const smsTemplateCode = smsTplByStore || cleanText(payload.sms_template_code, 64) || pickSmsTemplateByStore(storeId);

      // 解析模板正文（content_template，与阿里云已报备模板逐字一致）中的 {var} 占位符，
      // 仅当出现的变量都属于受支持的英文变量集时走「按需精确组装」新模式；
      // 否则（如旧规则用 {customer_name} 等展示型变量）回退到旧的 name/days/value 固定三变量。
      const tplText = cleanText(payload.content_template || payload.message_template, 1800);
      const neededVars = Array.from(new Set((tplText.match(/\{([a-zA-Z0-9_]+)\}/g) || []).map((s) => s.slice(1, -1))));
      const useDerivedParams = neededVars.length > 0 && neededVars.every((v) => SMS_DERIVED_VARS.has(v));

      let templateParam = null;
      let generatedCode = '';
      let skipReason = '';
      if (useDerivedParams) {
        const param = {};
        for (const v of neededVars) {
          if (v === 'name') param.name = smsSafeName(payload.customer_name) || '顾客';
          else if (v === 'days') param.days = String(Math.max(0, Math.floor(Number(payload.days_since_last_visit) || 0)));
          else if (v === 'value') {
            if (couponValueFen <= 0) { skipReason = 'no_coupon_value'; break; }
            param.value = String(Math.round(couponValueFen / 100));
          } else if (v === 'date') {
            param.date = formatSmsValidDate(payload.valid_days);
          } else if (v === 'code') {
            generatedCode = genSmsShortCode();
            param.code = generatedCode;
          } else if (v === 'balance') {
            const balYuan = await getStoredValueBalanceYuan(pool, smsPhone, storeId);
            if (balYuan <= 0) { skipReason = 'no_balance'; break; }
            param.balance = String(balYuan);
          }
        }
        if (!skipReason) templateParam = param;
      } else if (couponValueFen <= 0) {
        // 旧模板本质是「优惠券召回」，无券面额时既无 value 可填、也不应发「0元券」短信。
        skipReason = 'no_coupon_value';
      } else {
        templateParam = {
          name: smsSafeName(payload.customer_name) || '顾客',
          days: String(Math.max(0, Math.floor(Number(payload.days_since_last_visit) || 0))),
          value: String(Math.round(couponValueFen / 100))
        };
      }

      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      if (!skipReason && await globalSmsCapped(pool, smsPhone)) skipReason = 'global_capped';
      // 永久抑制名单：停机/空号/黑名单号码不再发送
      if (!skipReason && await isPhoneSuppressed(pool, smsPhone)) skipReason = 'suppressed';

      if (skipReason) {
        executionResults.delivery_error = `sms_skipped_${skipReason}`;
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey,
          action_key: actionKey,
          rule_key: cleanText(payload.rule_key, 128),
          customer_id: payload.customer_id,
          store_id: storeId,
          channel: 'sms',
          external_userid: '',
          status: 'skipped',
          payload: { phone: smsPhone, reason: skipReason, template_code: smsTemplateCode },
          result: {},
          error_message: skipReason === 'no_balance'
            ? `储值余额为 0，模板 ${smsTemplateCode || 'default'} 需要 balance 变量，已跳过发送`
            : skipReason === 'global_capped'
            ? `该号码近期已收过短信，触发全局短信总闸(每周最多1条)，已跳过发送`
            : `无优惠券面额，模板 ${smsTemplateCode || 'default'} 需要 value 变量，已跳过发送`
        });
      } else {
      try {
        const sent = await sendAliyunSms({
          phoneNumbers: smsPhone,
          templateCode: smsTemplateCode || undefined,
          templateParam
        });
        payload.delivery_key = deliveryKey;
        payload.provider_msg_id = sent.provider_msg_id;
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey,
          action_key: actionKey,
          rule_key: cleanText(payload.rule_key, 128),
          customer_id: payload.customer_id,
          store_id: storeId,
          channel: 'sms',
          external_userid: '',
          provider_msg_id: sent.provider_msg_id,
          status: 'sent',
          // coupon_code 写入投递日志：核销回传同一短码时按 payload->>'coupon_code' 配对翻成 redeemed。
          payload: generatedCode
            ? { phone: smsPhone, template_param: templateParam, coupon_code: generatedCode }
            : { phone: smsPhone, template_param: templateParam },
          result: sent.raw || {}
        });
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: payload.customer_id,
          phone: smsPhone,
          external_userid: null,
          store_id: storeId,
          campaign_id: campaignId,
          channel: 'sms',
          coupon_id: generatedCode || payload.coupon_id,
          idempotency_key: `marketing_triggered:${actionKey}:${sent.provider_msg_id || deliveryKey}`,
          metadata: {
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            delivery_key: deliveryKey,
            provider_msg_id: sent.provider_msg_id,
            template_param: templateParam,
            ...(generatedCode ? { short_code: generatedCode } : {})
          }
        });
        executionResults.real_executions.push({ type: 'sms_message', provider_msg_id: sent.provider_msg_id || deliveryKey, status: 'sent' });
      } catch (deliveryErr) {
        executionResults.delivery_error = deliveryErr?.message || 'sms_send_failed';
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey,
          action_key: actionKey,
          rule_key: cleanText(payload.rule_key, 128),
          customer_id: payload.customer_id,
          store_id: storeId,
          channel: 'sms',
          external_userid: '',
          status: 'failed',
          payload: { phone: smsPhone, template_param: templateParam },
          result: {},
          error_message: deliveryErr?.message || 'sms_send_failed'
        });
        await handleSmsFailure(pool, smsPhone, deliveryErr?.message);
      }
      }
    } else if (cleanText(payload.channel || '', 80) === 'subscribe' && (cleanPhone(payload.phone) || cleanText(payload.openid || '', 128))) {
      // 订阅消息通道：POST 到云函数代发网关。订阅消息平台硬约束——只能发给已点过
      // 订阅授权且仍有剩余次数的用户，未授权云函数回 ok:false(error:'...43101...')，
      // 这里如实记录为 failed/skipped，不抛错（属业务结果非系统故障）。
      const subPhone = cleanPhone(payload.phone);
      const subOpenid = cleanText(payload.openid || '', 128);
      const templateType = (cleanText(payload.subscribe_template_type || payload.templateType || '', 40) === 'expiring') ? 'expiring' : 'received';
      const templateData = (payload.subscribe_template_data && typeof payload.subscribe_template_data === 'object')
        ? payload.subscribe_template_data
        : (payload.templateData && typeof payload.templateData === 'object' ? payload.templateData : null);
      const subPage = cleanText(payload.subscribe_page || payload.page || '', 256);
      const deliveryKey = `${actionKey}:sub:${subOpenid || subPhone}:${Date.now()}`;
      if (!isSubscribePushConfigured()) {
        executionResults.delivery_error = 'subscribe_push_not_configured';
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey,
          action_key: actionKey,
          rule_key: cleanText(payload.rule_key, 128),
          customer_id: payload.customer_id,
          store_id: storeId,
          channel: 'subscribe',
          external_userid: '',
          status: 'skipped',
          payload: { phone: subPhone, openid: subOpenid, template_type: templateType },
          result: {},
          error_message: '未配置 HRMS_SUBSCRIBE_PUSH_URL / MINIPROGRAM_SYNC_SECRET，已跳过订阅消息发送'
        });
      } else {
        try {
          const pushResp = await postSubscribePush({
            phone: subPhone || undefined,
            openid: subOpenid || undefined,
            store_id: storeId,
            templateType,
            templateData: templateData || undefined,
            page: subPage || undefined
          });
          const ok = !!(pushResp.body && pushResp.body.ok);
          const providerMsgId = (pushResp.body && (pushResp.body.openid || (pushResp.body.sub_result && pushResp.body.sub_result.msgid))) || deliveryKey;
          payload.delivery_key = deliveryKey;
          await upsertDeliveryLog(pool, {
            delivery_key: deliveryKey,
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            customer_id: payload.customer_id,
            store_id: storeId,
            channel: 'subscribe',
            external_userid: '',
            provider_msg_id: String(providerMsgId),
            status: ok ? 'sent' : 'failed',
            payload: { phone: subPhone, openid: subOpenid, template_type: templateType, template_data: templateData },
            result: pushResp.body || {},
            error_message: ok ? null : ((pushResp.body && pushResp.body.error) || `subscribe_push_http_${pushResp.httpStatus}`)
          });
          if (ok) {
            await insertGrowthEvent(pool, {
              event_type: 'marketing_triggered',
              customer_id: payload.customer_id,
              phone: subPhone || null,
              external_userid: null,
              store_id: storeId,
              campaign_id: campaignId,
              channel: 'subscribe',
              coupon_id: payload.coupon_id,
              idempotency_key: `marketing_triggered:${actionKey}:${providerMsgId}`,
              metadata: {
                action_key: actionKey,
                rule_key: cleanText(payload.rule_key, 128),
                delivery_key: deliveryKey,
                template_type: templateType
              }
            });
            executionResults.real_executions.push({ type: 'subscribe_message', provider_msg_id: String(providerMsgId), status: 'sent' });
          } else {
            executionResults.delivery_error = (pushResp.body && pushResp.body.error) || `subscribe_push_http_${pushResp.httpStatus}`;
          }
        } catch (deliveryErr) {
          executionResults.delivery_error = deliveryErr?.message || 'subscribe_send_failed';
          await upsertDeliveryLog(pool, {
            delivery_key: deliveryKey,
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            customer_id: payload.customer_id,
            store_id: storeId,
            channel: 'subscribe',
            external_userid: '',
            status: 'failed',
            payload: { phone: subPhone, openid: subOpenid, template_type: templateType },
            result: {},
            error_message: deliveryErr?.message || 'subscribe_send_failed'
          });
        }
      }
    } else if (cleanText(payload.channel || '', 80) === 'member' && (cleanPhone(payload.phone) || cleanText(payload.openid || '', 128))) {
      // 小程序站内推券通道：HRMS 策略 → 云函数 growthMemberCoupon → 发券进会员卡包。
      // 只在自己的小程序里触达（不经短信/企微）。需在规则 action_payload 配 member_template_id
      // （指向小程序已建好的券模板）。未配置或网关未配则如实记 skipped，不抛错。
      const memPhone = cleanPhone(payload.phone);
      const memOpenid = cleanText(payload.openid || '', 128);
      const memberTemplateId = cleanText(payload.member_template_id || payload.template_id || '', 128);
      const deliveryKey = `${actionKey}:member:${memOpenid || memPhone}:${Date.now()}`;
      if (!isMemberCouponPushConfigured() || !memberTemplateId) {
        executionResults.delivery_error = !memberTemplateId ? 'member_template_not_set' : 'member_coupon_push_not_configured';
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey,
          action_key: actionKey,
          rule_key: cleanText(payload.rule_key, 128),
          customer_id: payload.customer_id,
          store_id: storeId,
          channel: 'member',
          external_userid: '',
          status: 'skipped',
          payload: { phone: memPhone, openid: memOpenid, template_id: memberTemplateId },
          result: {},
          error_message: !memberTemplateId
            ? '规则未配置 member_template_id（小程序券模板ID），已跳过站内推券'
            : '未配置 HRMS_MEMBER_COUPON_PUSH_URL / MINIPROGRAM_SYNC_SECRET，已跳过站内推券'
        });
      } else {
        try {
          const pushResp = await postMemberCouponPush({
            phone: memPhone || undefined,
            openid: memOpenid || undefined,
            store_id: storeId,
            template_id: memberTemplateId,
            idempotency_key: deliveryKey
          });
          const ok = !!(pushResp.body && pushResp.body.ok);
          const providerMsgId = (pushResp.body && pushResp.body.voucher_id) || deliveryKey;
          payload.delivery_key = deliveryKey;
          await upsertDeliveryLog(pool, {
            delivery_key: deliveryKey,
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            customer_id: payload.customer_id,
            store_id: storeId,
            channel: 'member',
            external_userid: '',
            provider_msg_id: String(providerMsgId),
            status: ok ? 'sent' : 'failed',
            payload: { phone: memPhone, openid: memOpenid, template_id: memberTemplateId },
            result: pushResp.body || {},
            error_message: ok ? null : ((pushResp.body && pushResp.body.error) || `member_coupon_http_${pushResp.httpStatus}`)
          });
          if (ok) {
            await insertGrowthEvent(pool, {
              event_type: 'marketing_triggered',
              customer_id: payload.customer_id,
              phone: memPhone || null,
              external_userid: null,
              store_id: storeId,
              campaign_id: campaignId,
              channel: 'member',
              coupon_id: payload.coupon_id,
              idempotency_key: `marketing_triggered:${actionKey}:${providerMsgId}`,
              metadata: {
                action_key: actionKey,
                rule_key: cleanText(payload.rule_key, 128),
                delivery_key: deliveryKey,
                template_id: memberTemplateId,
                voucher_id: String(providerMsgId)
              }
            });
            executionResults.real_executions.push({ type: 'member_coupon', provider_msg_id: String(providerMsgId), status: 'sent' });
          } else {
            executionResults.delivery_error = (pushResp.body && pushResp.body.error) || `member_coupon_http_${pushResp.httpStatus}`;
          }
        } catch (deliveryErr) {
          executionResults.delivery_error = deliveryErr?.message || 'member_coupon_send_failed';
          await upsertDeliveryLog(pool, {
            delivery_key: deliveryKey,
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            customer_id: payload.customer_id,
            store_id: storeId,
            channel: 'member',
            external_userid: '',
            status: 'failed',
            payload: { phone: memPhone, openid: memOpenid, template_id: memberTemplateId },
            result: {},
            error_message: deliveryErr?.message || 'member_coupon_send_failed'
          });
        }
      }
    }
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

function buildRuleActionKey(ruleKey, customerId, periodKey) {
  return `rule:${cleanText(ruleKey, 128)}:${Number(customerId) || 0}:${cleanText(periodKey, 40)}`;
}

async function createChurnAlert(pool, rule, row) {
  const days = Math.max(0, Math.floor(Number(row.days_since_last_visit) || 0));
  const alertKey = `churn:${cleanText(rule.rule_key, 128)}:${Number(row.customer_id) || 0}:${fmtYmd(row.last_visit_at)}`;
  await pool.query(
    `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics)
     VALUES ($1,'churn','medium',$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (alert_key) DO UPDATE SET message = EXCLUDED.message, metrics = EXCLUDED.metrics, status = 'open', updated_at = NOW()`,
    [
      alertKey,
      cleanText(row.store_id, 128),
      `${days}天未到店流失预警`,
      `${cleanText(row.customer_name || row.phone || `客户#${row.customer_id}`, 120)} 已${days}天未到店，系统已自动触发回流触达。`,
      '已由规则引擎自动发送回流触达',
      JSON.stringify({ customer_id: row.customer_id, days_since_last_visit: days, rule_key: rule.rule_key })
    ]
  );
}

async function loadRuleCandidates(pool, rule) {
  if (rule.rule_key === 'loyal_birthday_month') {
    const r = await pool.query(
      `SELECT cp.customer_id, cp.store_id, cp.phone, cp.pos_order_count, cp.pos_last_order_at, cp.visit_interval_days,
              gc.meta AS customer_meta, gc.last_seen_at, gc.openid, gc.external_userid AS customer_external_userid,
              COALESCE(ww.external_userid, gc.external_userid) AS external_userid,
              COALESCE(NULLIF(gc.meta->>'title',''), NULLIF(ww.name,''), NULLIF(gc.meta->>'name',''), cp.phone, '') AS customer_name
       FROM growth_customer_profiles cp
       JOIN growth_customers gc ON gc.id = cp.customer_id
       LEFT JOIN wechat_work_customers ww ON ww.bind_customer_id = cp.customer_id
       WHERE COALESCE(ww.external_userid, gc.external_userid) IS NOT NULL
          OR (cp.phone IS NOT NULL AND cp.phone <> '')
       LIMIT 500`
    );
    const currentMonth = fmtYm(new Date()).slice(5, 7);
    return r.rows.filter((row) => {
      const visits = Math.max(0, Math.floor(Number(row.pos_order_count) || 0));
      const interval = Number(row.visit_interval_days);
      return deriveBirthdayMonth(row.customer_meta || {}) === currentMonth && visits >= 3 && Number.isFinite(interval) && interval <= 10;
    });
  }
  const rows = await fetchGenericRuleCandidates(pool);
  const segmentSet = await loadSegmentPhoneSet(pool, (rule.criteria || {}).segment_key);
  return filterGenericRuleCandidates(rows, rule, segmentSet);
}

// 通用候选集扫描：除生日规则(loyal_birthday_month)外所有规则共用同一份 profiles 扫描结果。
// 抽离为独立函数，使 audience 端点可「一次扫描、内存复用」，避免 19 条规则各扫一遍 13k 行
// （旧实现导致自动营销页加载约 30 秒）。
async function fetchGenericRuleCandidates(pool) {
  const r = await pool.query(
    `SELECT cp.customer_id, cp.store_id, cp.phone, cp.price_sensitivity, cp.response_to_discount,
            cp.lifecycle_stage, cp.value_tier, cp.price_sensitive,
            cp.pos_order_count, cp.pos_total_spend, cp.pos_last_order_at, cp.visit_interval_days, cp.favorite_dishes, gc.last_seen_at, gc.openid,
            COALESCE(cp.pos_last_order_at::date, gc.last_seen_at::date) AS last_visit_at,
            (CURRENT_DATE - COALESCE(cp.pos_last_order_at::date, gc.last_seen_at::date))::int AS days_since_last_visit,
            gc.meta AS customer_meta,
            COALESCE(ww.external_userid, gc.external_userid) AS external_userid,
            COALESCE(NULLIF(gc.meta->>'title',''), NULLIF(ww.name,''), NULLIF(gc.meta->>'name',''), cp.phone, '') AS customer_name
     FROM growth_customer_profiles cp
     JOIN growth_customers gc ON gc.id = cp.customer_id
     LEFT JOIN wechat_work_customers ww ON ww.bind_customer_id = cp.customer_id
     WHERE COALESCE(ww.external_userid, gc.external_userid) IS NOT NULL
        OR (cp.phone IS NOT NULL AND cp.phone <> '')
     LIMIT 50000`
  );
  return r.rows;
}

// 就餐时段标签成员(growth_segment_members)按 segment_key 取手机号集合，供 criteria.segment_key 命中。
async function loadSegmentPhoneSet(pool, segmentKey) {
  if (!segmentKey) return null;
  const r = await pool.query(`SELECT phone FROM growth_segment_members WHERE segment_key = $1`, [segmentKey]);
  return new Set((r.rows || []).map((x) => String(x.phone || '')));
}

// 在内存中按规则 criteria 过滤通用候选集（与 loadRuleCandidates 同口径，供 audience 批量复用）。
// segmentSet: 当 criteria.segment_key 存在时，传入该标签的手机号集合(loadSegmentPhoneSet)，否则 null。
function filterGenericRuleCandidates(rows, rule, segmentSet) {
  // 旧版基于访问/天数的规则（企微分支保留），先于生命周期匹配处理
  const criteria = rule.criteria || {};
  return rows.filter((row) => {
    const days = Math.max(0, Math.floor(Number(row.days_since_last_visit) || 0));
    const visits = Math.max(0, Math.floor(Number(row.pos_order_count) || 0));
    // 新客回头·8天(seven_days_no_visit)已并入活动制，按其 criteria(lifecycle_stage=new + 天数窗口)筛选，
    // 不再用旧版「任意≥2次访问」硬编码命中(否则会把大量老客误当新客发新客券)。
    if (rule.rule_key === 'new_dish_launch_notify') return visits >= 4 && days >= 5 && days <= 20;
    // 新分类规则：按生命周期阶段 + 价值分级筛选候选人，对齐营销矩阵
    const stage = row.lifecycle_stage || '';
    const tier = row.value_tier || 'low';
    // 门店限定：规则带 store_id 时只命中本店客户，避免跨店误发（订阅规则必带门店）
    if (criteria.store_id && String(row.store_id || '') !== String(criteria.store_id)) return false;
    if (criteria.lifecycle_stage && stage !== criteria.lifecycle_stage) return false;
    if (criteria.lifecycle_stage_not && stage === criteria.lifecycle_stage_not) return false;
    if (criteria.value_tier && tier !== criteria.value_tier) return false;
    if (criteria.value_tier_not && tier === criteria.value_tier_not) return false;
    if (Number.isFinite(Number(criteria.max_days_since_last_visit)) && days > Number(criteria.max_days_since_last_visit)) return false;
    if (Number.isFinite(Number(criteria.min_days_since_last_visit)) && days < Number(criteria.min_days_since_last_visit)) return false;
    if (Number.isFinite(Number(criteria.min_visit_count)) && visits < Number(criteria.min_visit_count)) return false;
    if (Number.isFinite(Number(criteria.max_visit_count)) && visits > Number(criteria.max_visit_count)) return false;
    // 个人复购周期超时：interval_overdue_multiplier=2 表示「距上次到店 ≥ 个人平均到店间隔×2」才命中。
    // 比固定天窗更精准（周客超14天即异常，月客45天才算）。要求有稳定周期数据(visit_interval_days>0)。
    if (Number.isFinite(Number(criteria.interval_overdue_multiplier))) {
      const interval = Number(row.visit_interval_days);
      if (!Number.isFinite(interval) || interval <= 0) return false;
      if (days < interval * Number(criteria.interval_overdue_multiplier)) return false;
    }
    // 就餐时段标签：criteria.segment_key 命中 growth_segment_members(按手机号)。
    if (criteria.segment_key) {
      if (!segmentSet || !segmentSet.has(String(row.phone || ''))) return false;
    }
    // 券类型A/B分桶：同一人群拆成两条「可见可控」的规则(现金组/免费菜组)，各取一半。
    // ab_bucket=0/1 按手机号哈希(与 holdout 不同片段)分流，两组统计等同、唯一变量是券种。
    if (criteria.ab_bucket === 0 || criteria.ab_bucket === 1) {
      if (phoneAbBucket(cleanPhone(row.phone), 2) !== criteria.ab_bucket) return false;
    }
    // 必须至少有一个「人群」维度筛选（生命周期/价值/天数/到店次数/周期超时/时段标签），
    // 否则视为无条件全量，拒绝命中以防误群发（store_id 不算人群筛选）。
    const hasAudienceFilter = !!(criteria.lifecycle_stage || criteria.lifecycle_stage_not || criteria.value_tier || criteria.value_tier_not
      || criteria.segment_key
      || Number.isFinite(Number(criteria.max_days_since_last_visit))
      || Number.isFinite(Number(criteria.min_days_since_last_visit))
      || Number.isFinite(Number(criteria.min_visit_count))
      || Number.isFinite(Number(criteria.max_visit_count))
      || Number.isFinite(Number(criteria.interval_overdue_multiplier)));
    return hasAudienceFilter;
  });
}

function buildRulePeriodKey(ruleKey, row) {
  if (ruleKey === 'loyal_birthday_month') return fmtYm(new Date());
  return fmtYmd(row.last_visit_at || row.pos_last_order_at || row.last_seen_at);
}

// 就餐时段标签重算：从 pos_orders.order_time(北京时间) 聚合，刷新 growth_segment_members。
// 随 POS 数据更新需定期重算(每日)。口径：
//  - mj_dinner_weekend_repeat: 马己仙 晚市(≥16点)≥2次 或 周末(周六日)≥2次 的复购客；
//  - hc_weekday_lunch:        洪潮 平日(排除周末+法定节假日,含调休补班) 午市(10-15点) ≥1次。
async function recomputeDiningSegments(pool) {
  const BJ = "AT TIME ZONE 'Asia/Shanghai'";
  const hj = `LEFT JOIN cn_holiday_calendar h ON h.day=(order_time ${BJ})::date AND h.day_type='holiday'
              LEFT JOIN cn_holiday_calendar w ON w.day=(order_time ${BJ})::date AND w.day_type='workday'`;
  const eff = `((extract(dow from order_time ${BJ}) BETWEEN 1 AND 5 AND h.day IS NULL) OR w.day IS NOT NULL)`;
  const mjSid = _storeId('马己仙');
  const hcSid = _storeId('洪潮');
  await pool.query(`DELETE FROM growth_segment_members WHERE segment_key='mj_dinner_weekend_repeat'`);
  const mj = await pool.query(`INSERT INTO growth_segment_members(phone,segment_key,store_id)
    SELECT phone,'mj_dinner_weekend_repeat','${mjSid}' FROM (
      SELECT phone,
        count(*) FILTER (WHERE extract(hour from order_time ${BJ})>=16) dinner,
        count(*) FILTER (WHERE extract(dow from order_time ${BJ}) IN (0,6)) weekend
      FROM pos_orders WHERE store_id='${mjSid}' AND order_time IS NOT NULL AND phone<>'' GROUP BY phone
    ) t WHERE dinner>=2 OR weekend>=2 ON CONFLICT DO NOTHING`);
  await pool.query(`DELETE FROM growth_segment_members WHERE segment_key='hc_weekday_lunch'`);
  const hc = await pool.query(`INSERT INTO growth_segment_members(phone,segment_key,store_id)
    SELECT DISTINCT phone,'hc_weekday_lunch','${hcSid}' FROM (
      SELECT phone FROM pos_orders ${hj} WHERE store_id='${hcSid}' AND order_time IS NOT NULL AND phone<>''
        AND ${eff} AND extract(hour from order_time ${BJ}) BETWEEN 10 AND 15
    ) t ON CONFLICT DO NOTHING`);
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
        `INSERT INTO growth_holdout_members (phone, campaign_key, store_id) VALUES ($1,$2,$3)
         ON CONFLICT (phone, campaign_key) DO NOTHING`,
        [phone, campaignKey, sid]
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
      `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result)
       VALUES ($1,$2,$3,$4,0,0,$5::jsonb,$6,'pending',$7,$8,$9::jsonb)`,
      [campaignId, g.sid, g.variant.valueYuan, validDays, JSON.stringify(g.targets), g.targets.length, campaignKey, `rule_engine:${rule.rule_key}`, JSON.stringify(result)]
    );
    enqueued += g.targets.length;
  }
  return { enqueued, held_out: heldOut };
}

async function runTouchRuleEngine(pool, options = {}) {
  const ruleEngineTenantId = String(options.tenantId || 'default').trim() || 'default';
  // 第三层防护：POS数据新鲜度闸门。数据滞后会让全员被误判为临界/流失，
  // 进而乱发券。滞后超阈值时停止自动触达，改为告警人工核查。
  const freshRes = await pool.query(`SELECT MAX(biz_date) AS latest, (CURRENT_DATE - MAX(biz_date))::int AS lag_days FROM pos_orders`);
  const lagDays = Number(freshRes.rows?.[0]?.lag_days);
  if (!Number.isFinite(lagDays) || lagDays > POS_STALE_DAYS) {
    const latest = freshRes.rows?.[0]?.latest || null;
    const alertKey = `pos_stale_guard:${new Date().toISOString().slice(0, 10)}`;
    await pool.query(
      `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, title, message, suggested_action, metrics)
       VALUES ($1,'data_freshness','high','',$2,$3,$4,$5::jsonb)
       ON CONFLICT (alert_key) DO UPDATE SET message = EXCLUDED.message, metrics = EXCLUDED.metrics, status = 'open', updated_at = NOW()`,
      [
        alertKey,
        'POS数据滞后，已暂停自动营销触达',
        `POS最新数据为 ${latest || '无'}，滞后 ${Number.isFinite(lagDays) ? lagDays : '未知'} 天（阈值${POS_STALE_DAYS}天）。为避免基于过期数据误发券，规则引擎本次跳过。请尽快上传最新POS数据到飞书。`,
        '上传最新POS数据到飞书并触发 POST /api/growth/pos-feishu-sync',
        JSON.stringify({ latest_biz_date: latest, lag_days: Number.isFinite(lagDays) ? lagDays : null, threshold_days: POS_STALE_DAYS })
      ]
    );
    return { created: 0, skipped: true, reason: 'pos_data_stale', lag_days: Number.isFinite(lagDays) ? lagDays : null };
  }
  const limitPerRule = Math.min(Math.max(Number(options.limit_per_rule) || 100, 1), 5000);
  const rulesResult = await pool.query(`SELECT * FROM growth_touch_rules WHERE enabled = TRUE ORDER BY priority ASC, rule_key ASC LIMIT 20`);
  const createdActions = [];
  // 跨活动单触达：同一手机号本轮只进入一个活动(按 priority 高者先占)，杜绝一个客人因同时命中
  // 多个段(如就餐时段标签×召回段)在同一轮被多条活动各发一条短信。发送端 globalSmsCapped 再兜底。
  const claimedPhones = new Set();
  for (const rule of (rulesResult.rows || [])) {
    // 储值余额提醒规则(channel='balance')：不走逐人触达引擎，由独立触发器
    // enqueueAutoStoredValueReminds 按门店每日冻结余额提醒任务。此处直接跳过。
    if (String((rule.action_payload || {}).channel || '') === 'balance') continue;
    const candidates = (await loadRuleCandidates(pool, rule)).slice(0, limitPerRule);
    // 活动制规则(action_payload.campaign_key)：不逐人直发，改为聚合候选→冻结发券任务(可核销可归因)。
    const ruleCampaignKey = cleanText((rule.action_payload || {}).campaign_key || '', 64);
    if (ruleCampaignKey && CAMPAIGN_TYPES[ruleCampaignKey]) {
      await enqueueCampaignJobsForRule(pool, rule, candidates, ruleCampaignKey, claimedPhones).catch((e) => console.warn('[growth] enqueue campaign job failed:', rule.rule_key, e?.message));
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
         ON CONFLICT (action_key) DO NOTHING
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

function cnHour(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return ((d.getUTCHours() + 8) % 24);
}

function shiftDate(dateStr, days) {
  // Safe date arithmetic: parse as UTC midnight, shift, return YYYY-MM-DD
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 门店编号（企微/POS code）→ 门店名称。映射源见 brands-config.js。
const GROWTH_STORE_CODE_TO_NAME = STORE_ID_TO_NAME;
function growthStoreName(storeCode) {
  const k = String(storeCode || '').trim();
  return GROWTH_STORE_CODE_TO_NAME[k] || k;
}

// Build report for ONE store using sales_growth_snapshot + pos_orders
async function buildStoreReport(pool, storeCode, yd) {
  const dbd = shiftDate(yd, -1);
  const lwSame = shiftDate(yd, -7);

  function pct(a, b) {
    if (!b) return null;
    const v = (a - b) / b * 100;
    return (v >= 0 ? '▲' : '▼') + Math.abs(v).toFixed(1) + '%';
  }
  function fmtMoney(n) { return '¥' + Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // Revenue from snapshot (most accurate per-store breakdown)
  const [snapYd, snapDbd, snapLw, topDishes] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(revenue),0)::numeric AS rev, COALESCE(SUM(lunch_qty),0)::int AS lunch_qty, COALESCE(SUM(dinner_qty),0)::int AS dinner_qty
                FROM sales_growth_snapshot WHERE snapshot_date=$1 AND store_code=$2`, [yd, storeCode]),
    pool.query(`SELECT COALESCE(SUM(revenue),0)::numeric AS rev FROM sales_growth_snapshot WHERE snapshot_date=$1 AND store_code=$2`, [dbd, storeCode]),
    pool.query(`SELECT COALESCE(SUM(revenue),0)::numeric AS rev FROM sales_growth_snapshot WHERE snapshot_date=$1 AND store_code=$2`, [lwSame, storeCode]),
    pool.query(`SELECT dish_name, revenue::numeric AS rev, qty AS qty FROM sales_growth_snapshot
                WHERE snapshot_date=$1 AND store_code=$2 AND dish_name IS NOT NULL AND dish_name<>''
                ORDER BY revenue DESC LIMIT 5`, [yd, storeCode])
  ]);

  const rev = Number(snapYd.rows[0]?.rev || 0);
  const prevRev = Number(snapDbd.rows[0]?.rev || 0);
  const lwRev = Number(snapLw.rows[0]?.rev || 0);
  const lunchQty = Number(snapYd.rows[0]?.lunch_qty || 0);
  const dinnerQty = Number(snapYd.rows[0]?.dinner_qty || 0);

  // Order count and period revenue from pos_orders (order-level)
  const [ordersYd, periodOrders, weekOrders, memberMiss] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS cnt FROM pos_orders
                WHERE biz_date=$1 AND store_id=$2 AND order_status NOT IN ('cancelled','voided')`, [yd, storeCode]),
    pool.query(`SELECT order_time, amount_after_discount FROM pos_orders
                WHERE biz_date=$1 AND store_id=$2 AND order_status NOT IN ('cancelled','voided') AND order_time IS NOT NULL`,
                [yd, storeCode]),
    pool.query(`SELECT biz_date, order_time, amount_after_discount FROM pos_orders
                WHERE biz_date >= $1 AND biz_date <= $2 AND store_id=$3
                  AND order_status NOT IN ('cancelled','voided') AND order_time IS NOT NULL
                ORDER BY biz_date ASC`, [lwSame, yd, storeCode]),
    pool.query(`SELECT COUNT(*)::int AS cnt FROM growth_customer_profiles
                WHERE (CURRENT_DATE - COALESCE(pos_last_order_at::date, NOW()::date)) BETWEEN 7 AND 20`)
  ]);

  const orderCnt = Number(ordersYd.rows[0]?.cnt || 0);
  let lunchRev = 0, lunchCnt = 0, dinnerRev = 0, dinnerCnt = 0;
  for (const row of periodOrders.rows) {
    const h = cnHour(row.order_time);
    if (h == null) continue;
    const v = Number(row.amount_after_discount || 0);
    if (h >= 11 && h < 14) { lunchRev += v; lunchCnt++; }
    if (h >= 17 && h < 21) { dinnerRev += v; dinnerCnt++; }
  }

  // weekly lunch trend
  const dayLunch = {};
  for (const row of weekOrders.rows) {
    const h = cnHour(row.order_time);
    if (h == null || h < 11 || h >= 14) continue;
    const k = String(row.biz_date).slice(0, 10);
    dayLunch[k] = (dayLunch[k] || 0) + Number(row.amount_after_discount || 0);
  }
  const lunchDays = Object.keys(dayLunch).sort().slice(-4);
  let lunchTrend = '';
  if (lunchDays.length >= 3) {
    const vals = lunchDays.map(d => dayLunch[d]);
    const drops = vals.slice(1).filter((v, i) => v < vals[i]).length;
    if (drops >= 2) lunchTrend = `午市连续${drops + 1}天下滑 ⚠️`;
  }

  const missCount = Number(memberMiss.rows[0]?.cnt || 0);
  const totalRev = rev || 1;

  const lines = [
    `【增长日报 · ${growthStoreName(storeCode)} · ${yd}】`,
    '',
    '━━ 昨日销售 ━━',
    `总营收：${fmtMoney(rev)}  订单数：${orderCnt}单`,
    prevRev > 0 ? `环比昨日：${pct(rev, prevRev) || '-'}（前日${fmtMoney(prevRev)}）` : '环比昨日：暂无数据',
    lwRev > 0 ? `环比上周同期：${pct(rev, lwRev) || '-'}` : '环比上周同期：暂无数据',
  ];

  if (topDishes.rows.length) {
    lines.push('', '━━ TOP菜品（按营收）━━');
    ['①','②','③','④','⑤'].forEach((n, i) => {
      const r = topDishes.rows[i]; if (!r) return;
      // strip suffix starting with a digit/punctuation to clean POS dish names like "xxx11:00&16:30出炉"
      const clean = r.dish_name.replace(/[\d&（(【\[].{0,20}$/, '').trim() || r.dish_name.slice(0, 10);
      lines.push(`${n} ${clean.slice(0,10).padEnd(10)}  ${fmtMoney(r.rev)}  ${Math.round(Number(r.qty))}单`);
    });
  }

  lines.push('', '━━ 时段分析 ━━');
  if (lunchCnt > 0) lines.push(`午市(11-14): ${fmtMoney(lunchRev)} / ${lunchCnt}单（占比${(lunchRev / totalRev * 100).toFixed(0)}%）`);
  if (dinnerCnt > 0) lines.push(`晚市(17-21): ${fmtMoney(dinnerRev)} / ${dinnerCnt}单（占比${(dinnerRev / totalRev * 100).toFixed(0)}%）`);
  if (!lunchCnt && !dinnerCnt) lines.push(`午市菜品${lunchQty}份 / 晚市菜品${dinnerQty}份（快照数据）`);

  lines.push('', '━━ 本周规律 ━━');
  lines.push(lunchTrend || '数据积累中，暂无规律');

  lines.push('', '━━ 今日建议 ━━');
  const sugg = [];
  if (lunchTrend) sugg.push('① 午市弱势，建议今日推荐单人套餐');
  if (topDishes.rows[0] && Number(topDishes.rows[0].qty) > 30)
    sugg.push(`${sugg.length ? '②' : '①'} ${topDishes.rows[0].dish_name.slice(0,8)}昨日售出${Math.round(Number(topDishes.rows[0].qty))}单，接近上限，提前备货`);
  if (missCount > 0)
    sugg.push(`${['①','②','③'][sugg.length] || (sugg.length+1+'.')} 有${missCount}名会员7天未到店，建议今日触达`);
  if (!sugg.length) sugg.push('① 今日经营正常，保持当前节奏');
  lines.push(...sugg);

  return lines.join('\n');
}

async function buildGrowthDailyReport(pool, targetDate) {
  // yesterday in CST: add 8h to UTC then subtract 1 day
  const yd = targetDate || shiftDate(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), -1);

  // find all stores with data for that day
  const storesRes = await pool.query(
    `SELECT DISTINCT store_code FROM sales_growth_snapshot WHERE snapshot_date=$1 ORDER BY store_code`, [yd]
  );
  if (!storesRes.rows.length) return `【增长日报 · ${yd}】\n暂无 ${yd} 的 POS 数据`;

  const reports = await Promise.all(storesRes.rows.map(r => buildStoreReport(pool, r.store_code, yd)));
  return reports.join('\n\n' + '━'.repeat(20) + '\n\n');
}

export function registerGrowthRoutes(app, pool) {
  function requireGrowthAuth(req, res) {
    const auth = authMiniProgramSync(req);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return false;
    }
    return true;
  }

  function getGrowthOperator(req) {
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
  function getGrowthTenantId(req) {
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

  async function recomputeDailyMetrics(days = 7) {
    const safeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
    await pool.query(
      `INSERT INTO growth_daily_metrics (
         metric_date, store_id, campaign_id, channel,
         scan_count, authorized_count,
         coupon_claimed_count, coupon_purchased_count, marketing_triggered_count,
         coupon_redeemed_count, payment_count, revenue_fen, roi, updated_at
       )
       SELECT
         occurred_at::date AS metric_date,
         COALESCE(store_id, '') AS store_id,
         COALESCE(campaign_id, '') AS campaign_id,
         COALESCE(channel, '') AS channel,
         COUNT(*) FILTER (WHERE event_type = 'campaign_scan')::int AS scan_count,
         COUNT(*) FILTER (WHERE event_type = 'phone_authorized')::int AS authorized_count,
         COUNT(*) FILTER (WHERE event_type = 'coupon_claimed')::int AS coupon_claimed_count,
         COUNT(*) FILTER (WHERE event_type = 'coupon_purchased')::int AS coupon_purchased_count,
         COUNT(*) FILTER (WHERE event_type = 'marketing_triggered')::int AS marketing_triggered_count,
         COUNT(*) FILTER (WHERE event_type = 'coupon_redeemed')::int AS coupon_redeemed_count,
         COUNT(*) FILTER (WHERE event_type = 'payment_success')::int AS payment_count,
          COALESCE(SUM(amount_fen) FILTER (WHERE event_type IN ('payment_success','coupon_redeemed')), 0)::int AS revenue_fen,
          CASE WHEN COUNT(*) FILTER (WHERE event_type = 'campaign_scan') > 0
            THEN ROUND(COALESCE(SUM(amount_fen) FILTER (WHERE event_type IN ('payment_success','coupon_redeemed')), 0)::numeric / COUNT(*) FILTER (WHERE event_type = 'campaign_scan'), 4)
            ELSE NULL END AS roi,
          NOW()
       FROM growth_events
       WHERE occurred_at >= CURRENT_DATE - ($1::int || ' days')::interval
       GROUP BY 1,2,3,4
       ON CONFLICT (metric_date, store_id, campaign_id, channel)
       DO UPDATE SET
         scan_count = EXCLUDED.scan_count,
         authorized_count = EXCLUDED.authorized_count,
         coupon_claimed_count = EXCLUDED.coupon_claimed_count,
         coupon_purchased_count = EXCLUDED.coupon_purchased_count,
         marketing_triggered_count = EXCLUDED.marketing_triggered_count,
         coupon_redeemed_count = EXCLUDED.coupon_redeemed_count,
          payment_count = EXCLUDED.payment_count,
          revenue_fen = EXCLUDED.revenue_fen,
          roi = EXCLUDED.roi,
          updated_at = NOW()`,
      [safeDays]
    );
    return safeDays;
  }

  // 沉睡客召回：小程序生成带短码的券后,调本接口由 HRMS 用阿里云发短信。
  // 仅用「小程序→HRMS」这一已验证方向;幂等按券码去重;发送结果写 growth_delivery_logs(带活动+券码)供算核销率/ROI。
  app.post('/api/growth/winback/send-sms', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const phone = cleanPhone(b.phone);
      const storeId = cleanText(b.store_id, 128);
      const code = cleanText(b.coupon_code || b.code, 64);
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan || b.value) || 0));
      const validUntil = cleanText(b.valid_until || b.date, 40); // 如「6月20日」或「2026-06-20」
      const campaignId = cleanText(b.campaign_id || b.scene, 128);
      const idempotencyKey = cleanText(b.idempotency_key, 255) || (code ? `winback_sms:${code}` : '');

      if (!phone) return res.status(400).json({ ok: false, error: 'missing_phone' });
      if (!code) return res.status(400).json({ ok: false, error: 'missing_coupon_code' });
      if (valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      if (!validUntil) return res.status(400).json({ ok: false, error: 'missing_valid_until' });

      const templateCode = pickWinbackTemplateByStore(storeId);
      if (!templateCode) return res.status(503).json({ ok: false, error: 'winback_template_not_configured' });

      // 幂等：同一券码已发过 → 不重复发（防小程序重试导致客人收多条）
      if (idempotencyKey) {
        const dup = await pool.query(`SELECT status FROM growth_delivery_logs WHERE delivery_key = $1 LIMIT 1`, [idempotencyKey]);
        if (dup.rows.length && dup.rows[0].status === 'sent') {
          return res.json({ ok: true, deduped: true });
        }
      }
      // 触达频控(防骚扰核心):同一手机号 N 天内最多收 1 条召回短信。
      // 写在发送总入口,无论从哪发起(小程序/HRMS/对账)都统一拦截。N 经 env 配置,默认 30 天。
      const freqDays = freqDaysEnv('ALIYUN_SMS_WINBACK_FREQUENCY_DAYS', 30);
      if (freqDays > 0) {
        const recent = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
            WHERE channel = 'sms' AND rule_key = 'winback_sms' AND status = 'sent'
              AND payload->>'phone' = $1 AND created_at > now() - ($2 || ' days')::interval
            LIMIT 1`,
          [phone, String(freqDays)]
        );
        if (recent.rows.length) {
          return res.json({ ok: true, skipped: true, reason: 'frequency_capped', frequency_days: freqDays });
        }
      }
      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      const gCap = await globalSmsCapped(pool, phone);
      if (gCap) return res.json({ ok: true, skipped: true, reason: 'global_frequency_capped', frequency_days: gCap });
      // 永久抑制名单：停机/空号/黑名单号码不再发送
      if (await isPhoneSuppressed(pool, phone)) return res.json({ ok: true, skipped: true, reason: 'suppressed' });
      const deliveryKey = idempotencyKey || `winback_sms:${phone}:${Date.now()}`;
      // 已报备模板仅 3 个变量 value/date/code（无 name，避免超 3 变量报备失败）。
      // 务必与模板严格一致，多传 name 会被阿里云判「参数不匹配」拒收。
      const templateParam = { value: String(valueYuan), date: validUntil, code };

      try {
        const sent = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam });
        // 解析/登记客户，使发送日志与触达事件都带 customer_id，核销时可按人归因
        const winbackCustomer = await upsertCustomer(pool, { phone, store_id: storeId }).catch(() => null);
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || 'winback', rule_key: 'winback_sms',
          customer_id: winbackCustomer?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
          provider_msg_id: sent.provider_msg_id, status: 'sent',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId },
          result: sent.raw || {}
        });
        // 写 marketing_triggered 事件：让日指标按活动统计「发送量」，与后续 coupon_redeemed 配对算核销率/ROI。
        // 幂等键带短码，云函数重试不会重复计数。
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: winbackCustomer?.id || null,
          phone,
          external_userid: null,
          store_id: storeId,
          campaign_id: campaignId,
          channel: 'sms',
          coupon_id: code,
          idempotency_key: `marketing_triggered:winback_sms:${code}`,
          metadata: {
            rule_key: 'winback_sms',
            delivery_key: deliveryKey,
            provider_msg_id: sent.provider_msg_id,
            short_code: code,
            coupon_value_fen: valueYuan * 100,
            template_code: templateCode
          }
        });
        return res.json({ ok: true, provider_msg_id: sent.provider_msg_id });
      } catch (deliveryErr) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || 'winback', rule_key: 'winback_sms',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId },
          result: {}, error_message: deliveryErr?.message || 'sms_send_failed'
        });
        await handleSmsFailure(pool, phone, deliveryErr?.message);
        return res.status(502).json({ ok: false, error: deliveryErr?.message || 'sms_send_failed' });
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 储值客户同步:从飞书「储值客户」表拉全部记录,按卡号聚合(当前余额=最新一行余额,
  // 最近消费日=交易类型含「消费」的最新营业日期),写入 growth_stored_value_members。
  // 你每周更新飞书表后,调用本接口(或我手动跑)即可同步。
  app.post('/api/growth/stored-value/sync', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const records = await readStoredValueBitableRecords();
      const byCard = new Map();
      for (const rec of records) {
        const f = (rec && rec.fields) || {};
        const card = bitText(f['卡号']).trim();
        if (!card) continue;
        const txnMs = bitDateMs(f['交易时间']) || bitDateMs(f['营业日期']) || 0;
        const type = bitText(f['交易类型']);
        const od = bitDateMs(f['营业日期']);
        const cur = byCard.get(card) || { card, latestMs: -1, consumeMs: 0, rechargeMs: 0 };
        if (txnMs >= cur.latestMs) {
          cur.latestMs = txnMs;
          cur.member_name = bitText(f['会员名称']).trim();
          cur.phone = bitPhone(f['手机号']);
          cur.level = bitText(f['会员等级'] || f['会员登记']).trim();   // 兼容旧字段名「会员登记」
          cur.tags = bitText(f['人群标签']).trim();
          cur.store_id = mapStoreNameToId(bitText(f['交易门店']) || bitText(f['开卡门店']));
          cur.balance_fen = Math.round((bitNum(f['交易后-储值余额']) || 0) * 100);
        }
        if (/消费|支付/.test(type) && od > cur.consumeMs) cur.consumeMs = od;
        if (/充值|储值$/.test(type) && od > cur.rechargeMs) cur.rechargeMs = od;
        byCard.set(card, cur);
      }
      let upserted = 0;
      for (const m of byCard.values()) {
        await pool.query(
          `INSERT INTO growth_stored_value_members
             (card_no, member_name, phone, level, tags, store_id, balance_fen, last_consume_date, last_recharge_date, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (card_no) DO UPDATE SET
             member_name=EXCLUDED.member_name, phone=EXCLUDED.phone, level=EXCLUDED.level,
             tags=EXCLUDED.tags, store_id=EXCLUDED.store_id, balance_fen=EXCLUDED.balance_fen,
             last_consume_date=EXCLUDED.last_consume_date, last_recharge_date=EXCLUDED.last_recharge_date, updated_at=NOW()`,
          [m.card, m.member_name || null, m.phone || null, m.level || null, m.tags || null, m.store_id || null,
           m.balance_fen || 0,
           m.consumeMs > 0 ? new Date(m.consumeMs) : null,
           m.rechargeMs > 0 ? new Date(m.rechargeMs) : null]
        );
        upserted++;
      }
      return res.json({ ok: true, records: records.length, members: byCard.size, upserted });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 储值客户召回目标:有余额 + 久未消费(dormant_days),按门店,供 sendWinbackCampaign 取名单。
  app.get('/api/growth/stored-value/targets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const storeId = cleanText(req.query.store_id, 128);
      const dormantDays = Math.max(1, Math.floor(Number(req.query.dormant_days) || 14));
      const minBalanceFen = Math.max(0, Math.floor((Number(req.query.min_balance_yuan) || 1) * 100));
      const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
      const params = [];
      const clauses = ["phone IS NOT NULL AND phone <> ''", `balance_fen >= ${minBalanceFen}`,
        `(last_consume_date IS NULL OR last_consume_date <= (CURRENT_DATE - ${dormantDays}))`];
      if (storeId) { params.push(storeId); clauses.push(`store_id = $${params.length}`); }
      params.push(limit);
      const r = await pool.query(
        `SELECT card_no, member_name, phone, level, tags, store_id, balance_fen, last_consume_date
           FROM growth_stored_value_members
          WHERE ${clauses.join(' AND ')}
          ORDER BY balance_fen DESC LIMIT $${params.length}`,
        params
      );
      return res.json({ ok: true, count: r.rows.length, targets: r.rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 召回预览/试算(不发送):返回命中人数、扣除频控后真正会发的人数、样例。发起前必看,防误群发。
  app.get('/api/growth/winback/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const storeId = cleanText(req.query.store_id, 128);
      const dormantDays = Math.max(1, Math.floor(Number(req.query.dormant_days) || 14));
      const minBalanceFen = Math.max(0, Math.floor((Number(req.query.min_balance_yuan) || 1) * 100));
      const freqDays = Math.max(0, Math.floor(Number(req.query.freq_days != null ? req.query.freq_days : (process.env.ALIYUN_SMS_WINBACK_FREQUENCY_DAYS || 30))));
      const params = [String(freqDays)];
      const clauses = ["m.phone IS NOT NULL AND m.phone <> ''", `m.balance_fen >= ${minBalanceFen}`,
        `(m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))`];
      if (storeId) { params.push(storeId); clauses.push(`m.store_id = $${params.length}`); }
      const r = await pool.query(
        `SELECT m.card_no, m.member_name, m.phone, m.balance_fen, m.last_consume_date,
                (NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
                   WHERE d.channel='sms' AND d.rule_key='winback_sms' AND d.status='sent'
                     AND d.payload->>'phone' = m.phone AND d.created_at > now() - ($1 || ' days')::interval)) AS sendable
           FROM growth_stored_value_members m
          WHERE ${clauses.join(' AND ')}
          ORDER BY m.balance_fen DESC LIMIT 5000`,
        params
      );
      const matchCount = r.rows.length;
      const sendable = r.rows.filter((x) => x.sendable);
      const sample = sendable.slice(0, 10).map((x) => ({
        phone: x.phone ? (String(x.phone).slice(0, 3) + '****' + String(x.phone).slice(-4)) : '',
        balance_yuan: Math.round((x.balance_fen || 0) / 100),
        last_consume_date: x.last_consume_date
      }));
      return res.json({
        ok: true, dry_run: true,
        match_count: matchCount,
        capped_count: matchCount - sendable.length,
        sendable_count: sendable.length,
        frequency_days: freqDays,
        sample
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 【HRMS 集中发起】储值召回:发起时即解析并冻结目标名单(已过余额+沉睡+频控),写入待执行任务。
  app.post('/api/growth/winback/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 128);
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan) || 0));
      const validDays = Math.max(1, Math.floor(Number(b.valid_days) || 14));
      const dormantDays = Math.max(1, Math.floor(Number(b.dormant_days) || 14));
      const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 500, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_WINBACK_FREQUENCY_DAYS', 30);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      if (valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      const r = await pool.query(
        `SELECT card_no, member_name, phone FROM growth_stored_value_members m
          WHERE m.phone IS NOT NULL AND m.phone <> '' AND m.store_id = $2 AND m.balance_fen >= $3
            AND (m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))
            AND NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
              WHERE d.channel='sms' AND d.rule_key='winback_sms' AND d.status='sent'
                AND d.payload->>'phone' = m.phone AND d.created_at > now() - ($1 || ' days')::interval)
          ORDER BY m.balance_fen DESC LIMIT ${maxTargets}`,
        [String(freqDays), storeId, minBalanceFen]
      );
      const targets = r.rows.map((x) => ({ phone: x.phone, name: x.member_name || '', card_no: x.card_no }));
      if (!targets.length) return res.json({ ok: true, job_id: null, target_count: 0, message: '没有符合条件的对象(余额/沉睡/频控筛选后为空)' });
      const campaignId = cleanText(b.campaign_id, 128) || ('winback_' + storeId + '_' + Date.now());
      const ins = await pool.query(
        `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',$9) RETURNING id`,
        [campaignId, storeId, valueYuan, validDays, dormantDays, minBalanceFen, JSON.stringify(targets), targets.length, cleanText(b.operator, 128) || 'hrms_admin']
      );
      return res.json({ ok: true, job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 小程序定时器拉取一个待执行任务(原子认领:置为 running,避免并发重复执行)
  app.get('/api/growth/winback/pending-jobs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      // 禁发时段(默认北京时间21:30-9:00)：不放出任务，pending 保持原状，窗口外自动续跑。
      // 此端点是小程序执行器唯一的任务入口，在这里拦截即覆盖全部发券短信。
      if (inSmsQuietHours()) return res.json({ ok: true, job: null, quiet_hours: true });
      // 小程序认领所有「带券码」任务：召回(winback) + 通用发券(各段key)。
      // 仅排除 stored_value_remind（无券无码，由 HRMS 后台 worker 直发）。
      // 认领待执行任务：pending 优先；另回收「卡死的 running」——小程序断点续跑会把未发完的
      // 任务置回 pending，但若其执行中崩溃/超时来不及回写，任务会滞留 running。超过 3 分钟未更新
      // 即视为僵死，重新认领续跑（已发出的人受 7 天频控保护不会重复发，按 result.processed 续跑不重复建券）。
      const r = await pool.query(
        `UPDATE growth_campaign_jobs SET status='running', updated_at=now()
          WHERE id = (SELECT id FROM growth_campaign_jobs
                       WHERE kind <> 'stored_value_remind'
                         AND (status='pending' OR status='partial' OR (status='running' AND updated_at < now() - interval '3 minutes'))
                       ORDER BY created_at ASC LIMIT 1)
          RETURNING id, campaign_id, store_id, kind, value_yuan, valid_days, targets, result`
      );
      return res.json({ ok: true, job: r.rows[0] || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 小程序回写任务执行结果
  app.post('/api/growth/winback/job-result', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const jobId = Math.floor(Number(b.job_id) || 0);
      if (!jobId) return res.status(400).json({ ok: false, error: 'missing_job_id' });
      const sentN = Math.max(0, Math.floor(Number(b.sent) || 0));
      const failedN = Math.max(0, Math.floor(Number(b.failed) || 0));
      // 优先尊重小程序的 finished 信号(status='done'): processed>=total 时即使有失败也算完成。
      // 若小程序未报告 done，则按 sent/failed 推导：全失败=failed，混合=partial，全成功=done。
      const miniDone = cleanText(b.status || '', 20) === 'done';
      const computedStatus = miniDone ? 'done' : (sentN === 0 && failedN > 0 ? 'failed' : sentN > 0 && failedN > 0 ? 'partial' : 'done');
      await pool.query(
        `UPDATE growth_campaign_jobs SET sent=$2, failed=$3, status=$4, result=$5::jsonb, updated_at=now() WHERE id=$1`,
        [jobId, sentN, failedN, computedStatus, JSON.stringify(b.result || {})]
      );
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 管理端查看近期召回任务及进度
  app.get('/api/growth/winback/jobs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const r = await pool.query(
        `SELECT id, campaign_id, store_id, kind, value_yuan, valid_days, dormant_days, total, sent, failed, status, created_by, created_at, updated_at
           FROM growth_campaign_jobs ORDER BY created_at DESC LIMIT ${limit}`
      );
      return res.json({ ok: true, jobs: r.rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 通用「营销发券一键发起」(VIP/新客/活跃/长期流失)：profiles 人群 + 召回任务管道 ──
  // 与储值召回同理：HRMS 冻结名单 → 小程序执行(生成券码+写券+发短信)，券码可核销可统计。
  function parseCampaignCriteria(src) {
    const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? NaN : Math.floor(Number(v)));
    return {
      storeId: cleanText(src.store_id, 128),
      valueTier: cleanText(src.value_tier, 32),
      lifecycleStage: cleanText(src.lifecycle_stage, 32),
      minVisits: num(src.min_visits),
      maxVisits: num(src.max_visits),
      minDays: num(src.min_days),
      maxDays: num(src.max_days),
    };
  }

  app.post('/api/growth/campaign/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const campaignKey = cleanText(b.campaign_key, 64);
      if (!CAMPAIGN_TYPES[campaignKey]) return res.status(400).json({ ok: false, error: 'unknown_campaign_key' });
      const c = parseCampaignCriteria(b);
      const freqDays = Math.max(0, Math.floor(Number(b.freq_days != null ? b.freq_days : (process.env.ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS || 30))));
      const q = buildCampaignTargetQuery({ ...c, ruleKey: campaignKey, freqDays, limit: 5000 });
      if (!q) return res.status(400).json({ ok: false, error: 'need_audience_filter' });
      const r = await pool.query(q.sql, q.params);
      const sendable = r.rows.filter((x) => x.sendable);
      const sample = sendable.slice(0, 10).map((x) => ({
        phone: x.phone ? (String(x.phone).slice(0, 3) + '****' + String(x.phone).slice(-4)) : '',
        name: x.name || '', visits: x.visits, days: x.days
      }));
      return res.json({
        ok: true, dry_run: true,
        match_count: r.rows.length,
        capped_count: r.rows.length - sendable.length,
        sendable_count: sendable.length,
        coupon_count: CAMPAIGN_TYPES[campaignKey].coupon_count,
        frequency_days: freqDays, sample
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/campaign/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const campaignKey = cleanText(b.campaign_key, 64);
      const cfg = CAMPAIGN_TYPES[campaignKey];
      if (!cfg) return res.status(400).json({ ok: false, error: 'unknown_campaign_key' });
      const c = parseCampaignCriteria(b);
      if (!c.storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan) || 0));
      const validDays = Math.max(1, Math.floor(Number(b.valid_days) || 14));
      if (valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      if (!pickCampaignTemplate(campaignKey, c.storeId)) return res.status(503).json({ ok: false, error: 'sms_template_not_configured' });
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 500, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS', 30);
      const q = buildCampaignTargetQuery({ ...c, ruleKey: campaignKey, freqDays, limit: maxTargets });
      if (!q) return res.status(400).json({ ok: false, error: 'need_audience_filter' });
      const r = await pool.query(q.sql, q.params);
      const targets = r.rows.filter((x) => x.sendable).map((x) => ({ phone: x.phone, name: x.name || '' }));
      if (!targets.length) return res.json({ ok: true, job_id: null, target_count: 0, message: '没有符合条件的对象(人群/频控筛选后为空)' });
      const campaignId = cleanText(b.campaign_id, 128) || (campaignKey + '_' + c.storeId + '_' + Date.now());
      const result = { campaign_key: campaignKey, coupon_count: cfg.coupon_count };
      const ins = await pool.query(
        `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result)
         VALUES ($1,$2,$3,$4,0,0,$5::jsonb,$6,'pending',$7,$8,$9::jsonb) RETURNING id`,
        [campaignId, c.storeId, valueYuan, validDays, JSON.stringify(targets), targets.length, campaignKey, cleanText(b.operator, 128) || 'hrms_admin', JSON.stringify(result)]
      );
      return res.json({ ok: true, job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length, coupon_count: cfg.coupon_count });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 【通用发券短信发送】小程序 runWinbackJobs 生成短码+写券后回调本接口发短信。
  // 模板按 段key+门店 解析(pickCampaignTemplate)，templateParam 严格按 CAMPAIGN_TYPES[key].vars 拼装
  // (赠菜类只 date+code；长期流失 value+date+code)。多/少变量都会被阿里云整批拒收，故以 vars 为准。
  // 频控/幂等/落库/事件与 winback/send-sms 同构，但 rule_key=段key，核销可按活动归因统计。
  app.post('/api/growth/campaign/send-sms', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const campaignKey = cleanText(b.campaign_key, 64);
      const cfg = CAMPAIGN_TYPES[campaignKey];
      if (!cfg) return res.status(400).json({ ok: false, error: 'unknown_campaign_key' });
      const phone = cleanPhone(b.phone);
      const storeId = cleanText(b.store_id, 128);
      const code = cleanText(b.coupon_code || b.code, 64);
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan || b.value) || 0));
      const validUntil = cleanText(b.valid_until || b.date, 40) || formatSmsValidDate(b.valid_days);
      const campaignId = cleanText(b.campaign_id || b.scene, 128);
      const idempotencyKey = cleanText(b.idempotency_key, 255) || (code ? `${campaignKey}:${code}` : '');

      if (!phone) return res.status(400).json({ ok: false, error: 'missing_phone' });

      // ABC 6模板滚动：按该手机号在本活动下累计成功发送次数推导当前应发的模板步骤+降频阶梯天数。
      const abcOrder = ABC_ROTATION_ORDER[campaignKey];
      let effectiveVars = cfg.vars;
      let templateCode;
      let abcFreqDaysOverride = null;
      let abcStep = null;
      if (abcOrder) {
        const totalSent = await countCampaignSent(pool, campaignKey, phone);
        const derived = deriveAbcStep(campaignKey, totalSent);
        if (derived.blacklisted) return res.json({ ok: true, skipped: true, reason: 'abc_blacklisted' });
        abcStep = derived.step;
        abcFreqDaysOverride = derived.freqDaysOverride;
        effectiveVars = ABC_STEP_DEFS[abcStep].vars;
        templateCode = pickAbcTemplate(abcStep, storeId);
      } else {
        templateCode = pickCampaignTemplate(campaignKey, storeId);
      }
      if (effectiveVars.includes('code') && !code) return res.status(400).json({ ok: false, error: 'missing_coupon_code' });
      if (effectiveVars.includes('value') && valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      if (!templateCode) return res.status(503).json({ ok: false, error: 'sms_template_not_configured' });

      // 幂等：同一券码已发过 → 不重复发
      if (idempotencyKey) {
        const dup = await pool.query(`SELECT status FROM growth_delivery_logs WHERE delivery_key = $1 LIMIT 1`, [idempotencyKey]);
        if (dup.rows.length && dup.rows[0].status === 'sent') return res.json({ ok: true, deduped: true });
      }
      // 触达频控：同一手机号 N 天内最多收 1 条本活动短信。ABC 轮换走完一轮后按降频阶梯
      // (15/30/45/60天)覆盖默认频率。
      const freqDays = abcFreqDaysOverride != null ? abcFreqDaysOverride : freqDaysEnv('ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS', 30);
      if (freqDays > 0) {
        const recent = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
            WHERE channel = 'sms' AND rule_key = $1 AND status = 'sent'
              AND payload->>'phone' = $2 AND created_at > now() - ($3 || ' days')::interval
            LIMIT 1`,
          [campaignKey, phone, String(freqDays)]
        );
        if (recent.rows.length) return res.json({ ok: true, skipped: true, reason: 'frequency_capped', frequency_days: freqDays });
      }
      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      const gCap = await globalSmsCapped(pool, phone);
      if (gCap) return res.json({ ok: true, skipped: true, reason: 'global_frequency_capped', frequency_days: gCap });
      // 永久抑制名单：停机/空号/黑名单号码不再发送
      if (await isPhoneSuppressed(pool, phone)) return res.json({ ok: true, skipped: true, reason: 'suppressed' });
      // 跨活动疲劳总闸：近90天最近到店后累计收满8条任意活动短信仍未回店 → 暂停所有营销
      if (await marketingFatigueCapped(pool, phone)) return res.json({ ok: true, skipped: true, reason: 'marketing_fatigue' });
      // 触达上限：同活动累计发满 N 次(默认3)仍未回店 → 停发本活动。ABC 轮换自带 15/30/45/60天
      // 降频阶梯+红名单机制，不再叠加此上限。
      if (!abcOrder && await campaignTouchCapped(pool, campaignKey, phone)) return res.json({ ok: true, skipped: true, reason: 'touch_capped' });
      const deliveryKey = idempotencyKey || `${campaignKey}:${phone}:${Date.now()}`;
      // 严格按 vars 拼模板参数：缺/多变量阿里云都判「参数不匹配」整批拒收。
      const templateParam = {};
      if (effectiveVars.includes('value')) templateParam.value = String(valueYuan);
      if (effectiveVars.includes('date')) templateParam.date = validUntil;
      if (effectiveVars.includes('code')) templateParam.code = code;

      try {
        const sent = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam });
        const camCustomer = await upsertCustomer(pool, { phone, store_id: storeId }).catch(() => null);
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || campaignKey, rule_key: campaignKey,
          customer_id: camCustomer?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
          provider_msg_id: sent.provider_msg_id, status: 'sent',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId, campaign_key: campaignKey },
          result: sent.raw || {}
        });
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: camCustomer?.id || null, phone, external_userid: null, store_id: storeId,
          campaign_id: campaignId, channel: 'sms', coupon_id: code,
          idempotency_key: `marketing_triggered:${campaignKey}:${code || phone}`,
          metadata: {
            rule_key: campaignKey, delivery_key: deliveryKey, provider_msg_id: sent.provider_msg_id,
            short_code: code, coupon_value_fen: valueYuan * 100, template_code: templateCode
          }
        });
        return res.json({ ok: true, provider_msg_id: sent.provider_msg_id });
      } catch (deliveryErr) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || campaignKey, rule_key: campaignKey,
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId, campaign_key: campaignKey },
          result: {}, error_message: deliveryErr?.message || 'sms_send_failed'
        });
        await handleSmsFailure(pool, phone, deliveryErr?.message);
        return res.status(502).json({ ok: false, error: deliveryErr?.message || 'sms_send_failed' });
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ── 储值余额提醒（HRMS 自身后台直发，只发 {balance}，无券无码）──
  // 目标口径：有余额(≥min) + 久未消费(dormant_days) + 频控(remind 类 N 天内不重发)。
  // 与「储值召回(发券)」共用 growth_campaign_jobs 表，kind='stored_value_remind' 区分，
  // 由本文件内的后台 worker 认领执行（小程序定时器只认 kind='winback'，不会误发本类）。
  function buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets) {
    return {
      sql: `SELECT card_no, member_name, phone, balance_fen FROM growth_stored_value_members m
              WHERE m.phone IS NOT NULL AND m.phone <> '' AND m.store_id = $2 AND m.balance_fen >= $3
                AND (m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))
                AND NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
                  WHERE d.channel='sms' AND d.rule_key='stored_value_remind' AND d.status IN ('sent','redeemed')
                    AND d.payload->>'phone' = m.phone AND d.created_at > now() - ($1 || ' days')::interval)
              ORDER BY m.balance_fen DESC LIMIT ${maxTargets}`,
      params: [String(freqDays), storeId, minBalanceFen]
    };
  }

  app.post('/api/growth/stored-value/remind/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 128);
      const dormantDays = Math.max(0, Math.floor(Number(b.dormant_days) || 30));
      const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 1000, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      const q = buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
      const r = await pool.query(q.sql, q.params);
      return res.json({
        ok: true,
        target_count: r.rows.length,
        sample: r.rows.slice(0, 5).map((x) => ({ name: x.member_name || '', balance_yuan: Math.round((x.balance_fen || 0) / 100) }))
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/stored-value/remind/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 128);
      const dormantDays = Math.max(0, Math.floor(Number(b.dormant_days) || 30));
      const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 1000, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
      const templateCode = cleanText(b.sms_template_code, 64) || pickBalanceTemplateByStore(storeId);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      if (!templateCode) return res.status(503).json({ ok: false, error: 'balance_template_not_configured' });
      const q = buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
      const r = await pool.query(q.sql, q.params);
      // 冻结目标(含发起时点余额快照)，发送时直接用，无需重查。
      const targets = r.rows.map((x) => ({ phone: x.phone, name: x.member_name || '', card_no: x.card_no, balance_yuan: Math.round((x.balance_fen || 0) / 100) }));
      if (!targets.length) return res.json({ ok: true, job_id: null, target_count: 0, message: '没有符合条件的对象(余额/沉睡/频控筛选后为空)' });
      const campaignId = cleanText(b.campaign_id, 128) || ('svremind_' + storeId + '_' + Date.now());
      const ins = await pool.query(
        `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result)
         VALUES ($1,$2,0,0,$3,$4,$5::jsonb,$6,'pending','stored_value_remind',$7,$8::jsonb) RETURNING id`,
        [campaignId, storeId, dormantDays, minBalanceFen, JSON.stringify(targets), targets.length, cleanText(b.operator, 128) || 'hrms_admin', JSON.stringify({ template_code: templateCode })]
      );
      return res.json({ ok: true, job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

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
      if (await isPhoneSuppressed(pool, phone)) continue;
      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      const gCap = await globalSmsCapped(pool, phone);
      if (gCap) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'skipped',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id, reason: 'global_capped' },
          result: {}, error_message: '触发全局短信总闸(每周最多1条)，已跳过'
        }).catch(() => null);
        continue;
      }
      try {
        const result = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam });
        const cust = await upsertCustomer(pool, { phone, store_id: storeId }).catch(() => null);
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: cust?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
          provider_msg_id: result.provider_msg_id, status: 'sent',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id }, result: result.raw || {}
        });
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered', customer_id: cust?.id || null, phone, external_userid: null,
          store_id: storeId, campaign_id: job.campaign_id, channel: 'sms', coupon_id: null,
          idempotency_key: `marketing_triggered:svremind:${job.id}:${phone}`,
          metadata: { rule_key: 'stored_value_remind', delivery_key: deliveryKey, provider_msg_id: result.provider_msg_id, template_code: templateCode, template_param: templateParam }
        });
        sent++;
      } catch (err) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id }, result: {},
          error_message: err?.message || 'sms_send_failed'
        }).catch(() => null);
        await handleSmsFailure(pool, phone, err?.message);
        failed++;
      }
    }
    await pool.query(`UPDATE growth_campaign_jobs SET sent=$2, failed=$3, status='done', updated_at=now() WHERE id=$1`,
      [job.id, sent, failed]);
  }
  if (!globalThis.__growthRemindWorker) {
    globalThis.__growthRemindWorker = true;
    setInterval(() => { processOneRemindJob().catch((e) => console.warn('[svremind] worker failed:', e?.message)); }, 30 * 1000);
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
        `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result)
         VALUES ($1,$2,0,0,$3,$4,$5::jsonb,$6,'pending','stored_value_remind',$7,$8::jsonb)`,
        [campaignId, storeId, dormantDays, minBalanceFen, JSON.stringify(targets), targets.length, 'auto_scheduler', JSON.stringify({ template_code: templateCode })]
      );
      enqueued += targets.length;
    }
    return { enqueued };
  }
  if (!globalThis.__growthRemindAutoTimer) {
    globalThis.__growthRemindAutoTimer = setInterval(() => {
      enqueueAutoStoredValueReminds().catch((e) => console.warn('[svremind] auto enqueue failed:', e?.message));
    }, 60 * 60 * 1000);
    setTimeout(() => {
      enqueueAutoStoredValueReminds().catch((e) => console.warn('[svremind] initial auto enqueue failed:', e?.message));
    }, 20000);
  }

  // 就餐时段标签：手动重算端点 + 每日重算(随 POS 数据更新保持新鲜)
  app.post('/api/growth/segments/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const result = await recomputeDiningSegments(pool);
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  if (!globalThis.__growthSegmentTimer) {
    globalThis.__growthSegmentTimer = setInterval(() => {
      recomputeDiningSegments(pool).catch((e) => console.warn('[segments] recompute failed:', e?.message));
    }, 24 * 60 * 60 * 1000);
    setTimeout(() => {
      recomputeDiningSegments(pool).catch((e) => console.warn('[segments] initial recompute failed:', e?.message));
    }, 30000);
  }

  // T+7 SMS自动回填：每天跑一次；启动后延迟60s首跑（等DB连接稳定）
  if (!globalThis.__smsBackfillTimer) {
    globalThis.__smsBackfillTimer = setInterval(() => {
      autoBackfillSmsActions(pool).then((n) => { if (n > 0) console.log(`[sms-backfill] auto-backfilled ${n} actions`); }).catch((e) => console.warn('[sms-backfill] failed:', e?.message));
    }, 24 * 60 * 60 * 1000);
    setTimeout(() => {
      autoBackfillSmsActions(pool).then((n) => { if (n > 0) console.log(`[sms-backfill] initial run: backfilled ${n} actions`); }).catch((e) => console.warn('[sms-backfill] initial failed:', e?.message));
    }, 60000);
  }

  app.post('/api/miniprogram/events', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const eventType = cleanText(body.event_type, 80);
      if (!EVENT_TYPES.has(eventType)) {
        return res.status(400).json({ ok: false, error: 'invalid_event_type' });
      }

      const customer = await upsertCustomer(pool, body);
      const campaignId = cleanText(body.campaign_id || body.scene, 128);
      const storeId = cleanText(body.store_id, 128);
      const channel = cleanText(body.channel, 80);
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
      const amountFen = Math.max(0, Math.floor(Number(body.amount_fen) || 0));
      const occurredAt = parseOccurredAt(body.occurred_at);
      const idempotencyKey = cleanText(body.idempotency_key, 255) || null;

      if (campaignId) {
        await pool.query(
          `INSERT INTO growth_campaigns (campaign_id, channel, store_id, meta)
           VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4::jsonb)
           ON CONFLICT (campaign_id) DO UPDATE SET
             channel = COALESCE(growth_campaigns.channel, EXCLUDED.channel),
             store_id = COALESCE(growth_campaigns.store_id, EXCLUDED.store_id),
             updated_at = NOW()`,
          [campaignId, channel, storeId, JSON.stringify({ first_event_type: eventType })]
        );
      }

      const inserted = await pool.query(
        `INSERT INTO growth_events (
           event_type, customer_id, phone, openid, external_userid, store_id, campaign_id, channel,
           coupon_id, order_id, amount_fen, idempotency_key, metadata, occurred_at
         ) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),$11,$12,$13::jsonb,$14)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          eventType,
          customer?.id || null,
          cleanPhone(body.phone),
          cleanText(body.openid, 128),
          cleanText(body.external_userid, 128),
          storeId,
          campaignId,
          channel,
          cleanText(body.coupon_id, 128),
          cleanText(body.order_id, 128),
          amountFen,
          idempotencyKey,
          JSON.stringify(metadata),
          occurredAt
        ]
      );

      if (eventType === 'coupon_redeemed' && inserted.rows.length) {
        await pool.query(
          `INSERT INTO growth_redemptions (customer_id, coupon_id, campaign_id, store_id, amount_fen, metadata, redeemed_at)
           VALUES ($1,NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5,$6::jsonb,$7)
           ON CONFLICT DO NOTHING`,
          [customer?.id || null, cleanText(body.coupon_id, 128), campaignId, storeId, amountFen, JSON.stringify(metadata), occurredAt]
        );
        // 闭环回写：按核销回传的短码，把对应「已发送」短信日志翻成「已核销」，
        // 使 growth_delivery_logs 单表即可查「发→核销」全过程（核销率 = redeemed / sent）。
        const redeemShortCode = cleanText(metadata.short_code || '', 64);
        if (redeemShortCode) {
          await pool.query(
            `UPDATE growth_delivery_logs
                SET status = 'redeemed', updated_at = NOW()
              WHERE channel = 'sms'
                AND status = 'sent'
                AND payload->>'coupon_code' = $1`,
            [redeemShortCode]
          ).catch((e) => console.warn('[growth] delivery redeem flip failed:', e?.message));
        }
      }

      // Phase 2: 授权手机号/匹配检查时，反查 wechat_work_customers 并绑定
      const matchPhone = cleanPhone(body.phone);
      if ((eventType === 'phone_authorized' || eventType === 'wechat_match_check') && matchPhone) {
        try {
          const wwMatch = await pool.query(
            `UPDATE wechat_work_customers SET bind_customer_id = $1, updated_at = NOW()
             WHERE phone = $2 AND bind_customer_id IS NULL
             RETURNING id, store_id`,
            [customer?.id, matchPhone]
          );
          if (wwMatch.rows.length) {
            console.log(`[growth] wechat_work customer matched: phone=${matchPhone}, customer_id=${customer?.id}`);
          }
        } catch (e) {
          console.warn('[growth] wechat_work match failed:', e?.message);
        }
      }

      return res.json({ ok: true, inserted: inserted.rows.length > 0, customer_id: customer?.id || null });
    } catch (e) {
      console.error('[growth] miniprogram event failed:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/campaigns/:campaignId/funnel', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const campaignId = cleanText(req.params.campaignId, 128);
    const r = await pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM growth_events
       WHERE campaign_id = $1
       GROUP BY event_type
       ORDER BY event_type`,
      [campaignId]
    );
    return res.json({ ok: true, campaign_id: campaignId, counts: r.rows });
  });

  app.post('/api/growth/metrics/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const days = await recomputeDailyMetrics(req.body?.days || 7);
    return res.json({ ok: true, days });
  });

  // 按手机号聚合 POS 消费，供小程序写回 users.total_spent 等字段。
  // 入参 { phones: ['1xx...'], window_days: 30 }；金额以「分」返回，与小程序 users.total_spent 单位一致。
  app.post('/api/growth/pos/consumption', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const body = req.body || {};
    const windowDays = Math.min(Math.max(Number(body.window_days) || 30, 1), 365);
    let phones = Array.isArray(body.phones) ? body.phones : [];
    phones = phones.map((p) => cleanPhone(p)).filter(Boolean);
    phones = Array.from(new Set(phones));
    if (phones.length > 5000) phones = phones.slice(0, 5000);
    if (!phones.length) return res.json({ ok: true, window_days: windowDays, matched: 0, data: {} });

    const r = await pool.query(
      `SELECT trim(phone) AS phone,
              ROUND(COALESCE(SUM(amount_after_discount), 0) * 100)::bigint AS total_spent_fen,
              COUNT(*)::int AS total_orders,
              ROUND(COALESCE(SUM(amount_after_discount)
                FILTER (WHERE biz_date >= (CURRENT_DATE - ($2::int || ' days')::interval)), 0) * 100)::bigint AS spent_30d_fen,
              MAX(checkout_time) AS last_visit,
              (ARRAY_AGG(store_id ORDER BY checkout_time DESC NULLS LAST))[1] AS last_store_id
       FROM pos_orders
       WHERE trim(phone) = ANY($1::text[]) AND phone IS NOT NULL AND trim(phone) <> ''
       GROUP BY trim(phone)`,
      [phones, windowDays]
    );

    const data = {};
    for (const row of r.rows) {
      data[row.phone] = {
        total_spent_fen: Number(row.total_spent_fen) || 0,
        total_orders: Number(row.total_orders) || 0,
        spent_30d_fen: Number(row.spent_30d_fen) || 0,
        last_visit: row.last_visit ? new Date(row.last_visit).toISOString() : null,
        store_id: row.last_store_id || ''
      };
    }
    return res.json({ ok: true, window_days: windowDays, requested: phones.length, matched: r.rows.length, data });
  });

  app.get('/api/growth/metrics', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 365);
    if (req.query.recompute === '1' || req.query.recompute === 'true') {
      await recomputeDailyMetrics(days);
    }
    const r = await pool.query(
      `SELECT * FROM growth_daily_metrics
       WHERE metric_date >= CURRENT_DATE - ($1::int || ' days')::interval
         AND ($2::text = '' OR store_id = $2)
         AND ($3::text = '' OR campaign_id = $3)
       ORDER BY metric_date DESC, store_id, campaign_id, channel
       LIMIT 1000`,
      [days, cleanText(req.query.store_id || '', 128), cleanText(req.query.campaign_id || '', 128)]
    );
    return res.json({ ok: true, rows: r.rows });
  });

  app.get('/api/growth/alerts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || 'open', 40);
    const r = await pool.query(
      `SELECT * FROM growth_alerts WHERE ($1::text = '' OR status = $1) ORDER BY created_at DESC LIMIT 200`,
      [status]
    );
    return res.json({ ok: true, alerts: r.rows });
  });

  app.post('/api/growth/alerts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const alertKey = cleanText(b.alert_key || `${b.alert_type || 'growth'}:${b.store_id || ''}:${b.campaign_id || ''}:${new Date().toISOString().slice(0, 10)}`, 255);
    const r = await pool.query(
      `INSERT INTO growth_alerts (alert_key, alert_type, severity, store_id, campaign_id, title, message, suggested_action, metrics)
       VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,$7,$8,$9::jsonb)
       ON CONFLICT (alert_key) DO UPDATE SET
         severity = EXCLUDED.severity,
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         suggested_action = EXCLUDED.suggested_action,
         metrics = EXCLUDED.metrics,
         status = 'open',
         updated_at = NOW()
       RETURNING *`,
      [alertKey, cleanText(b.alert_type, 80), cleanText(b.severity || 'medium', 40), cleanText(b.store_id, 128), cleanText(b.campaign_id, 128), cleanText(b.title, 500), cleanText(b.message, 2000), cleanText(b.suggested_action, 2000), JSON.stringify(b.metrics || {})]
    );
    return res.json({ ok: true, alert: r.rows[0] });
  });

  // 标记预警为已处理（关闭预警）
  app.post('/api/growth/alerts/:alertKey/resolve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const alertKey = cleanText(req.params.alertKey, 255);
    const operator = getGrowthOperator(req);
    const r = await pool.query(
      `UPDATE growth_alerts SET status = 'resolved', resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
       WHERE alert_key = $1 RETURNING *`,
      [alertKey, operator.username || 'system']
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'alert_not_found' });
    return res.json({ ok: true, alert: r.rows[0] });
  });

  app.get('/api/growth/touch-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT * FROM growth_touch_rules ORDER BY priority ASC, rule_key ASC LIMIT 100`);
    return res.json({ ok: true, rules: r.rows });
  });

  app.post('/api/growth/touch-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const ruleKey = cleanText(b.rule_key, 128);
    if (!ruleKey) return res.status(400).json({ ok: false, error: 'missing_rule_key' });
    const criteriaStr = JSON.stringify(b.criteria || {});
    const payloadStr = JSON.stringify(b.action_payload || {});
    const actionType = cleanText(b.action_type || 'send_message', 80);
    // 改了「目标人群/券额文案/动作类型」就要重新审核——避免审过的规则被人偷偷改条件后继续自动群发。
    const existing = await pool.query(`SELECT criteria, action_payload, action_type FROM growth_touch_rules WHERE rule_key = $1 LIMIT 1`, [ruleKey]);
    let keepApproval = false;
    let criteriaChanged = true;
    if (existing.rows.length) {
      const ex = existing.rows[0];
      criteriaChanged = JSON.stringify(ex.criteria || {}) !== criteriaStr;
      keepApproval =
        !criteriaChanged &&
        JSON.stringify(ex.action_payload || {}) === payloadStr &&
        (ex.action_type || '') === actionType;
    }
    const r = await pool.query(
      `INSERT INTO growth_touch_rules (rule_key, name, enabled, priority, auto_execute, criteria, action_type, action_payload, owner, note)
       VALUES ($1,$2,COALESCE($3,TRUE),$4,COALESCE($5,TRUE),$6::jsonb,$7,$8::jsonb,NULLIF($9,''),NULLIF($10,''))
       ON CONFLICT (rule_key) DO UPDATE SET
         name = EXCLUDED.name,
         enabled = EXCLUDED.enabled,
         priority = EXCLUDED.priority,
         auto_execute = EXCLUDED.auto_execute,
         criteria = EXCLUDED.criteria,
         action_type = EXCLUDED.action_type,
         action_payload = EXCLUDED.action_payload,
         owner = COALESCE(EXCLUDED.owner, growth_touch_rules.owner),
         note = COALESCE(EXCLUDED.note, growth_touch_rules.note),
         approved_by = CASE WHEN $11 THEN growth_touch_rules.approved_by ELSE NULL END,
         approved_at = CASE WHEN $11 THEN growth_touch_rules.approved_at ELSE NULL END,
         updated_at = NOW()
       RETURNING *`,
      [
        ruleKey,
        cleanText(b.name || ruleKey, 255),
        b.enabled !== false,
        Math.max(1, Math.floor(Number(b.priority) || 100)),
        b.auto_execute !== false,
        criteriaStr,
        actionType,
        payloadStr,
        cleanText(b.owner || '', 128),
        cleanText(b.note || '', 1000),
        keepApproval
      ]
    );
    // 人群定向(criteria)变了才需重算覆盖人数；后台重算，不清空缓存、不阻塞本次保存，
    // 避免保存请求与5秒全表扫描抢连接池而卡住。频率/券面额/文案变更不影响覆盖人数。
    if (criteriaChanged && typeof globalThis.__refreshGrowthAudience === 'function') globalThis.__refreshGrowthAudience();
    return res.json({ ok: true, rule: r.rows[0] });
  });

  // ===== 支付后发券规则（配置集中在 HRMS，小程序定时拉取执行）=====
  const VALID_PAYMENT_TAGS = new Set(['prospect', 'new', 'active', 'at_risk', 'dormant', 'churned', 'vip', 'regular', 'low', 'general']);

  function normalizePaymentTags(input) {
    let arr = [];
    if (Array.isArray(input)) arr = input;
    else if (typeof input === 'string' && input) arr = [input];
    return arr.map(t => String(t).trim()).filter(t => VALID_PAYMENT_TAGS.has(t));
  }

  function paymentRuleToSync(row) {
    return {
      rule_key: row.rule_key,
      store_id: row.store_id,
      name: row.name,
      priority: row.priority,
      trigger_type: 'payment',
      action_type: 'send_voucher',
      action_config: { template_id: row.member_template_id || '' },
      target_tags: Array.isArray(row.target_tags) ? row.target_tags : [],
      trigger_value: row.trigger_value == null ? '' : String(row.trigger_value),
      daily_user_limit: row.daily_user_limit == null ? null : Number(row.daily_user_limit),
      global_daily_limit: row.global_daily_limit == null ? null : Number(row.global_daily_limit)
    };
  }

  app.get('/api/growth/payment-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const r = await pool.query(`SELECT * FROM marketing_payment_rules ORDER BY store_id ASC, priority ASC, rule_key ASC LIMIT 200`);
      return res.json({ ok: true, rules: r.rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/payment-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 64);
      const name = cleanText(b.name, 255);
      const memberTemplateId = cleanText(b.member_template_id || b.template_id || '', 128);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      if (!name) return res.status(400).json({ ok: false, error: 'missing_name' });
      if (!memberTemplateId) return res.status(400).json({ ok: false, error: 'missing_member_template_id' });

      const operator = getGrowthOperator(req);
      // rule_key 稳定标识：传入沿用，否则按门店生成。小程序以此为 join key。
      const ruleKey = cleanText(b.rule_key, 128) || `pay_${storeId}_${Date.now().toString(36)}`;
      const priority = Math.max(0, Math.floor(Number(b.priority) || 0));
      const triggerValue = String(b.trigger_value == null ? '' : b.trigger_value).trim();
      const tags = normalizePaymentTags(b.target_tags);
      const dailyUserLimit = b.daily_user_limit === '' || b.daily_user_limit == null ? null : Math.max(0, Math.floor(Number(b.daily_user_limit) || 0));
      const globalDailyLimit = b.global_daily_limit === '' || b.global_daily_limit == null ? null : Math.max(0, Math.floor(Number(b.global_daily_limit) || 0));

      const r = await pool.query(
        `INSERT INTO marketing_payment_rules
           (rule_key, store_id, name, active, priority, target_tags, trigger_value, member_template_id, daily_user_limit, global_daily_limit, created_by)
         VALUES ($1,$2,$3,COALESCE($4,TRUE),$5,$6::jsonb,$7,$8,$9,$10,NULLIF($11,''))
         ON CONFLICT (rule_key) DO UPDATE SET
           store_id = EXCLUDED.store_id,
           name = EXCLUDED.name,
           active = EXCLUDED.active,
           priority = EXCLUDED.priority,
           target_tags = EXCLUDED.target_tags,
           trigger_value = EXCLUDED.trigger_value,
           member_template_id = EXCLUDED.member_template_id,
           daily_user_limit = EXCLUDED.daily_user_limit,
           global_daily_limit = EXCLUDED.global_daily_limit,
           updated_at = NOW()
         RETURNING *`,
        [ruleKey, storeId, name, b.active !== false, priority, JSON.stringify(tags), triggerValue,
         memberTemplateId, dailyUserLimit, globalDailyLimit, operator.username || '']
      );
      return res.json({ ok: true, rule: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete('/api/growth/payment-rules/:ruleKey', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const ruleKey = cleanText(req.params.ruleKey, 128);
      const r = await pool.query(`DELETE FROM marketing_payment_rules WHERE rule_key = $1 RETURNING rule_key`, [ruleKey]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'rule_not_found' });
      return res.json({ ok: true, deleted: ruleKey });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 小程序定时拉取：返回全部有效规则 + 当前有效 rule_key 全集（用于小程序清理已删/停用规则）
  app.get('/api/growth/payment-rules/sync', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const r = await pool.query(`SELECT * FROM marketing_payment_rules ORDER BY priority ASC, rule_key ASC LIMIT 500`);
      const allKeys = r.rows.map(x => x.rule_key);
      const rules = r.rows.filter(x => x.active).map(paymentRuleToSync);
      return res.json({ ok: true, rules, all_rule_keys: allKeys });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 审核规则：记录审核人 + 时间。只有审核过的规则才允许引擎自动执行。
  app.post('/api/growth/touch-rules/:ruleKey/approve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const ruleKey = cleanText(req.params.ruleKey, 128);
    const operator = getGrowthOperator(req);
    const owner = cleanText(req.body?.owner || '', 128);
    const r = await pool.query(
      `UPDATE growth_touch_rules
         SET approved_by = $2, approved_at = NOW(),
             owner = COALESCE(NULLIF($3,''), owner),
             updated_at = NOW()
       WHERE rule_key = $1
       RETURNING *`,
      [ruleKey, operator.username || 'system', owner]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'rule_not_found' });
    return res.json({ ok: true, rule: r.rows[0] });
  });

  // 撤销审核：撤销后该规则不再自动执行，仅生成待发动作供人工确认。
  app.post('/api/growth/touch-rules/:ruleKey/unapprove', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const ruleKey = cleanText(req.params.ruleKey, 128);
    const r = await pool.query(
      `UPDATE growth_touch_rules SET approved_by = NULL, approved_at = NULL, updated_at = NOW() WHERE rule_key = $1 RETURNING *`,
      [ruleKey]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'rule_not_found' });
    return res.json({ ok: true, rule: r.rows[0] });
  });

  // 规则维度闭环统计：本规则累计 已发送 / 已核销 / 核销率（delivery_logs + redemptions 经 action_key/rule_key 关联）。
  app.get('/api/growth/touch-rules/stats', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const r = await pool.query(
      // 注：核销成功后 Fix3 会把投递日志 status 由 'sent' 翻成 'redeemed'，
      // 故发送数须把已触达的各终态都计入，否则被核销的那条会从发送数里漏掉。
      // 归因键修正：投递日志的 rule_key 实际存的是 campaign_key（活动制规则），核销事件
      // metadata 里也是 campaign_key。故统一按「归因键 akey = COALESCE(campaign_key, rule_key)」
      // 聚合并 JOIN，否则活动制规则(主力)发送/核销全部漏算成 0（旧实现的真实 bug）。
      `WITH sent AS (
         SELECT rule_key AS akey,
                COUNT(*)::int AS sent_count,
                COUNT(*) FILTER (WHERE channel = 'sms')::int AS sms_sent_count
         FROM growth_delivery_logs
         WHERE status IN ('sent','delivered','read','clicked','redeemed')
           AND created_at >= NOW() - ($1::int || ' days')::interval
         GROUP BY rule_key
       ),
       redeemed AS (
         SELECT COALESCE(NULLIF(metadata->>'campaign_key',''), NULLIF(metadata->>'rule_key','')) AS akey,
                COUNT(*)::int AS redeemed_count,
                COALESCE(SUM(amount_fen), 0)::bigint AS revenue_fen
         FROM growth_events
         WHERE event_type = 'coupon_redeemed' AND created_at >= NOW() - ($1::int || ' days')::interval
           AND COALESCE(NULLIF(metadata->>'campaign_key',''), NULLIF(metadata->>'rule_key','')) IS NOT NULL
         GROUP BY 1
       )
       SELECT tr.rule_key,
              tr.action_payload->>'campaign_key' AS campaign_key,
              COALESCE(s.sent_count, 0) AS sent_count,
              COALESCE(s.sms_sent_count, 0) AS sms_sent_count,
              COALESCE(rd.redeemed_count, 0) AS redeemed_count,
              COALESCE(rd.revenue_fen, 0) AS revenue_fen
       FROM growth_touch_rules tr
       LEFT JOIN sent s ON s.akey = COALESCE(NULLIF(tr.action_payload->>'campaign_key',''), tr.rule_key)
       LEFT JOIN redeemed rd ON rd.akey = COALESCE(NULLIF(tr.action_payload->>'campaign_key',''), tr.rule_key)`,
      [days]
    );
    // 单条短信成本 0.05 元（5 分）；订阅消息 / 小程序渠道成本为 0。
    // ROI = 带来的营收 ÷ 投入成本；据此打分排序并给运营建议（不自动改投放，仅供决策）。
    const SMS_COST_FEN = 5;
    const stats = r.rows.map((row) => {
      const sent = Number(row.sent_count) || 0;
      const smsSent = Number(row.sms_sent_count) || 0;
      const redeemed = Number(row.redeemed_count) || 0;
      const revenueFen = Number(row.revenue_fen) || 0;
      const costFen = smsSent * SMS_COST_FEN;
      const redeemRate = sent > 0 ? redeemed / sent : null; // 0~1
      const roi = costFen > 0 ? revenueFen / costFen : null; // 营收/成本，成本为 0 时不适用
      const revenueMissing = redeemed > 0 && revenueFen === 0; // 核销了但实收未录入

      // 评分（0~100）：核销率为主（实收常缺失），有成本时再融合 ROI。
      let score = null;
      if (sent > 0) {
        const rateScore = Math.min(100, Math.round((redeemRate || 0) * 100 * 5)); // 20% 核销=满分
        if (costFen > 0) {
          const roiScore = Math.min(100, Math.round(((roi || 0) / 5) * 100)); // ROI≥5=满分
          score = Math.round(rateScore * 0.6 + roiScore * 0.4);
        } else {
          score = rateScore;
        }
      }

      // 文字建议
      let suggestion;
      if (sent === 0) {
        suggestion = '尚未发送，审核启用后可观察效果';
      } else if (redeemed === 0) {
        suggestion = '已发送但暂无核销，建议优化文案/券面额或更换目标人群';
      } else if (redeemRate < 0.05) {
        suggestion = '核销率偏低（<5%），建议收窄人群定向或提高券吸引力';
      } else if (redeemRate >= 0.15) {
        suggestion = '核销率优秀，建议保持并可适度加大投放';
      } else {
        suggestion = '核销率中等，可小幅优化文案或做面额 A/B 测试';
      }
      if (costFen > 0 && revenueFen > 0) {
        if (roi >= 3) suggestion += '；ROI 高，投入产出优';
        else if (roi < 1) suggestion += '；ROI<1 尚未回本，注意控制成本';
      }
      if (revenueMissing) {
        suggestion += '；注：本期实收金额未录入，ROI 暂按 0 计，建议核销时录入实收金额以精确核算';
      }

      // 券类型：活动模板含 value 变量=现金券，否则=免费菜/赠菜券。供「现金券 vs 免费菜」对比。
      const cfg = CAMPAIGN_TYPES[row.campaign_key];
      const couponKind = cfg ? (Array.isArray(cfg.vars) && cfg.vars.includes('value') ? 'cash' : 'gift') : 'unknown';
      return Object.assign({}, row, {
        sent_count: sent,
        sms_sent_count: smsSent,
        redeemed_count: redeemed,
        revenue_fen: revenueFen,
        cost_fen: costFen,
        roi: roi == null ? null : Math.round(roi * 100) / 100,
        coupon_kind: couponKind,
        score,
        suggestion
      });
    });
    // 券类型汇总（现金券 vs 免费菜券）：供管理员一眼看清哪类券核销更好。
    // 注意：样本不足或人群不同会让对比失真，前端展示需带「样本量/置信」提示，不可仅凭此切换全部投放。
    const byKind = {};
    for (const s of stats) {
      const k = s.coupon_kind;
      if (k !== 'cash' && k !== 'gift') continue;
      const b = byKind[k] || (byKind[k] = { sent: 0, redeemed: 0 });
      b.sent += s.sent_count; b.redeemed += s.redeemed_count;
    }
    for (const k of Object.keys(byKind)) {
      byKind[k].redeem_rate = byKind[k].sent > 0 ? Math.round(byKind[k].redeemed / byKind[k].sent * 10000) / 100 : null;
    }
    return res.json({ ok: true, days, stats, coupon_kind_summary: byKind });
  });

  // ABC 6模板滚动分布：该活动当前命中人群中，各模板步骤(赠菜A/B/C+赠券30/50/2X50)×
  // 降频阶梯(0=正常频率,1+=第几轮降频)各有多少人、以及已进入「红名单」(阶梯走完未回应，
  // 本活动不再自动触达)的人数。campaign_key 未配置 ABC 轮换时返回 enabled:false。
  app.get('/api/growth/campaign/:campaignKey/abc-distribution', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const campaignKey = cleanText(req.params.campaignKey, 64);
    const order = ABC_ROTATION_ORDER[campaignKey];
    if (!order) return res.json({ ok: true, enabled: false });
    const ruleRes = await pool.query(
      `SELECT * FROM growth_touch_rules WHERE action_payload->>'campaign_key' = $1 LIMIT 1`,
      [campaignKey]
    );
    if (!ruleRes.rows.length) return res.status(404).json({ ok: false, error: 'rule_not_found' });
    const rule = ruleRes.rows[0];

    const candidates = (await loadRuleCandidates(pool, rule)).slice(0, 500);
    const phones = [...new Set(candidates.map((c) => cleanPhone(c.phone)).filter(Boolean))];
    const sentCounts = phones.length ? await pool.query(
      // 「到店即清零」：与发送端同口径，只统计最近一次到店(pos_last_order_at)之后的成功发送数。
      `WITH lastvisit AS (
         SELECT phone, MAX(pos_last_order_at) AS lv FROM growth_customer_profiles
          WHERE phone = ANY($2::text[]) GROUP BY phone
       )
       SELECT dl.payload->>'phone' AS phone, count(*)::int n FROM growth_delivery_logs dl
         LEFT JOIN lastvisit lv ON lv.phone = dl.payload->>'phone'
        WHERE dl.channel='sms' AND dl.status = 'sent' AND dl.rule_key = $1
          AND dl.payload->>'phone' = ANY($2::text[])
          AND dl.created_at > COALESCE(lv.lv, '1970-01-01'::timestamptz)
        GROUP BY 1`,
      [campaignKey, phones]
    ) : { rows: [] };
    const sentByPhone = new Map(sentCounts.rows.map((r) => [r.phone, Number(r.n)]));

    const dist = {};
    for (const step of order) dist[step] = 0;
    let cycling = 0; // 已走完至少一轮、进入更慢降频轮次(第2轮及以后)的人数
    let blacklisted = 0;
    for (const c of candidates) {
      const phone = cleanPhone(c.phone);
      if (!phone) continue;
      const totalSent = sentByPhone.get(phone) || 0;
      const { step, blacklisted: bl } = deriveAbcStep(campaignKey, totalSent);
      if (bl) { blacklisted++; continue; }
      dist[step] = (dist[step] || 0) + 1;
      if (totalSent >= order.length) cycling++; // 超过一轮(perCycle)即已进入降频后续轮次
    }
    return res.json({ ok: true, enabled: true, total: candidates.length, step_distribution: dist, cycling, blacklisted });
  });

  // 每条规则当前「涉及会员数」（命中人群且可触达：有企微外部联系人或手机号）。
  // 用于前台展示活动覆盖范围，让管理员审核前清楚知道这次会发给多少人。
  //
  // 性能要点：这是一次全量人群扫描(冷启动约5秒，占用一个数据库连接)。绝不能放在
  // 用户请求(尤其是"保存规则")的同步路径上——否则该扫描会和保存抢连接池，让保存也卡5秒，
  // 表现为"一改发送频率/有效期就死机"。因此这里改为：后台定时刷新缓存，HTTP 请求只读缓存、
  // 永不同步触发重算(仅服务刚启动、缓存还空时兜底算一次)。
  let __touchRulesAudienceCache = { data: null, at: 0 };
  let __touchRulesAudienceComputing = null; // 进行中的重算 Promise，去重并发
  async function computeTouchRulesAudience() {
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
          candidates = filterGenericRuleCandidates(genericRows, rule, segSet);
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
  // 后台刷新缓存（去重并发；不抛错给调用方，由 .catch 兜底）。
  function refreshTouchRulesAudienceCache() {
    if (__touchRulesAudienceComputing) return __touchRulesAudienceComputing;
    __touchRulesAudienceComputing = computeTouchRulesAudience()
      .then((a) => { __touchRulesAudienceCache = { data: a, at: Date.now() }; return a; })
      .finally(() => { __touchRulesAudienceComputing = null; });
    return __touchRulesAudienceComputing;
  }
  // 暴露给 POST 规则改动后触发后台重算（见 /api/growth/touch-rules）。
  globalThis.__refreshGrowthAudience = () => { refreshTouchRulesAudienceCache().catch(() => {}); };
  // 服务启动后预热一次，并每 10 分钟后台刷新，确保 HTTP 请求始终命中缓存、不阻塞。
  if (!globalThis.__growthAudienceTimer) {
    setTimeout(() => refreshTouchRulesAudienceCache().catch(() => {}), 15000);
    globalThis.__growthAudienceTimer = setInterval(() => { refreshTouchRulesAudienceCache().catch(() => {}); }, 10 * 60 * 1000);
  }
  // 客户画像（生命周期/价值分级等，决定"涉及会员"人数）每日自动重算，避免依赖人工触发而过期；
  // 重算后顺带刷新人群缓存，使"涉及会员"数据始终与画像同步。
  if (!globalThis.__growthProfileTimer) {
    const runProfileRecompute = () => recomputeCustomerProfiles(pool, 90)
      .then(() => refreshTouchRulesAudienceCache())
      .catch((e) => console.warn('[profiles] recompute failed:', e?.message));
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
      backfillRedemptionAmounts(pool)
        .then((n) => console.log(`[growth] redemption amount backfill: ${n} rows updated`))
        .catch((e) => console.warn('[growth] redemption amount backfill failed:', e?.message));
    };
    globalThis.__growthRedemptionBackfillTimer = setInterval(runBackfill, 10 * 60 * 1000);
  }
  app.get('/api/growth/touch-rules/audience', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    // 有缓存就直接返回（即便略旧）；超过3分钟则后台刷新，但本次请求不等待。
    if (__touchRulesAudienceCache.data) {
      const stale = Date.now() - __touchRulesAudienceCache.at > 180000;
      if (stale) refreshTouchRulesAudienceCache().catch(() => {});
      return res.json({ ok: true, audience: __touchRulesAudienceCache.data, cached: true, stale });
    }
    // 冷启动、缓存还空：兜底同步算一次（全局唯一一次会阻塞的路径）。
    try {
      const a = await refreshTouchRulesAudienceCache();
      return res.json({ ok: true, audience: a });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'audience_failed' });
    }
  });

  app.post('/api/growth/rule-engine/run', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const result = await runTouchRuleEngine(pool, { ...(req.body || {}), tenantId: getGrowthTenantId(req) });
    return res.json({ ok: true, result });
  });

  app.get('/api/growth/actions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || '', 40);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const tenantId = getGrowthTenantId(req);
    let sql = `SELECT * FROM growth_actions WHERE tenant_id = $1`;
    const params = [tenantId];
    if (status) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const r = await pool.query(sql, params);
    let countSql = `SELECT COUNT(*) as total FROM growth_actions WHERE tenant_id = $1`;
    const countParams = [tenantId];
    if (status) { countSql += ` AND status = $2`; countParams.push(status); }
    const c = await pool.query(countSql, countParams);
    return res.json({ ok: true, actions: r.rows, total: Number(c.rows[0]?.total || 0), limit, offset });
  });

  app.get('/api/growth/execution-logs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const storeId = cleanText(req.query.store_id || '', 128);
    const decision = cleanText(req.query.decision || '', 40);
    // 关键语义修正：growth_execution_logs.decision='executed' 只代表「引擎处理了该动作」，
    // 不代表「触达到了客人」。真正的渠道触达结果在 growth_delivery_logs。这里按 action_key
    // 聚合投递日志，回传每条执行记录的真实触达统计，供前端区分「已触达 / 失败 / 跳过 / 仅内部执行」。
    let sql = `SELECT el.*,
        tr.name AS rule_name,
        COALESCE(d.total_count, 0) AS delivery_total,
        COALESCE(d.delivered_count, 0) AS delivery_delivered,
        COALESCE(d.failed_count, 0) AS delivery_failed,
        COALESCE(d.skipped_count, 0) AS delivery_skipped,
        d.channels AS delivery_channels,
        d.last_error AS delivery_last_error
      FROM growth_execution_logs el
      LEFT JOIN growth_touch_rules tr ON tr.rule_key = split_part(el.action_key, ':', 2)
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','clicked','redeemed')) AS delivered_count,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
          COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_count,
          string_agg(DISTINCT channel, ',') AS channels,
          (array_agg(error_message ORDER BY created_at DESC) FILTER (WHERE error_message IS NOT NULL))[1] AS last_error
        FROM growth_delivery_logs dl
        WHERE dl.action_key = el.action_key
      ) d ON TRUE`;
    const params = [];
    const conds = [];
    if (storeId) { conds.push(`el.store_id = $${params.length + 1}`); params.push(storeId); }
    if (decision) { conds.push(`el.decision = $${params.length + 1}`); params.push(decision); }
    if (conds.length) sql += ` WHERE ` + conds.join(' AND ');
    sql += ` ORDER BY el.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const r = await pool.query(sql, params);
    const logs = r.rows.map((l) => {
      let reach = 'na';
      if (l.decision === 'ignored') reach = 'ignored';
      else if (Number(l.delivery_total) === 0) reach = 'internal_only';
      else if (Number(l.delivery_delivered) > 0) reach = 'reached';
      else if (Number(l.delivery_failed) > 0) reach = 'failed';
      else if (Number(l.delivery_skipped) > 0) reach = 'skipped';
      else reach = 'internal_only';
      return Object.assign({}, l, { reach });
    });
    return res.json({ ok: true, logs, limit, offset });
  });

  app.post('/api/growth/actions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const actionsTenantId = getGrowthTenantId(req);
    const r = await pool.query(
      `INSERT INTO growth_actions (action_key, action_type, status, store_id, campaign_id, title, detail, payload, created_by, tenant_id)
       VALUES (NULLIF($1,''),$2,COALESCE(NULLIF($3,''),'proposed'),NULLIF($4,''),NULLIF($5,''),$6,$7,$8::jsonb,COALESCE(NULLIF($9,''),'agent_v2'),$10)
       ON CONFLICT (action_key) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail, payload = EXCLUDED.payload, updated_at = NOW()
       RETURNING *`,
      [cleanText(b.action_key, 255), cleanText(b.action_type, 80), cleanText(b.status, 40), cleanText(b.store_id, 128), cleanText(b.campaign_id, 128), cleanText(b.title, 500), cleanText(b.detail, 4000), JSON.stringify(b.payload || {}), cleanText(b.created_by, 80), actionsTenantId]
    );
    return res.json({ ok: true, action: r.rows[0] });
  });

  app.post('/api/growth/actions/:actionKey/execute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const operator = getGrowthOperator(req);
    const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'action_not_found' });
    const before = current.rows[0];
    const executed = await executeGrowthActionRecord(pool, before, operator, req.body?.payload || {}, req.body?.reason || '');
    return res.json({ ok: true, action: executed.action, execution: executed.execution });
  });

  app.post('/api/growth/actions/:actionKey/ignore', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const operator = getGrowthOperator(req);
    const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'action_not_found' });
    const before = current.rows[0];
    const result = await pool.query(
      `UPDATE growth_actions SET status = 'ignored', updated_at = NOW() WHERE action_key = $1 RETURNING *`,
      [actionKey]
    );
    await appendExecutionLog(pool, {
      action_key: actionKey,
      strategy_key: cleanText(before.payload?.strategy_key || '', 255),
      store_id: before.store_id,
      action_type: before.action_type,
      decision: 'ignored',
      operator_username: operator.username,
      operator_role: operator.role,
      before_payload: before.payload || {},
      after_payload: result.rows[0].payload || {},
      decision_reason: cleanText(req.body?.reason || '', 2000),
      result_summary: '动作被忽略'
    });
    return res.json({ ok: true, action: result.rows[0] });
  });

  app.post('/api/growth/actions/:actionKey/edit-and-execute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const operator = getGrowthOperator(req);
    const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'action_not_found' });
    const before = current.rows[0];
    const patch = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    const result = await pool.query(
      `UPDATE growth_actions
       SET status = 'executed', payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at = NOW(), executed_at = NOW()
       WHERE action_key = $1 RETURNING *`,
      [actionKey, JSON.stringify(patch)]
    );
    await appendExecutionLog(pool, {
      action_key: actionKey,
      strategy_key: cleanText(before.payload?.strategy_key || '', 255),
      store_id: before.store_id,
      action_type: before.action_type,
      decision: 'edited_then_executed',
      operator_username: operator.username,
      operator_role: operator.role,
      before_payload: before.payload || {},
      after_payload: result.rows[0].payload || {},
      decision_reason: cleanText(req.body?.reason || '', 2000),
      result_summary: '动作修改后执行'
    });
    return res.json({ ok: true, action: result.rows[0] });
  });

  app.get('/api/growth/store-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT * FROM store_marketing_profiles ORDER BY updated_at DESC LIMIT 300`);
    return res.json({ ok: true, profiles: r.rows });
  });

  app.post('/api/growth/store-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeId = cleanText(b.store_id, 128);
    if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
    const r = await pool.query(
      `INSERT INTO store_marketing_profiles (store_id, brand, avg_ticket_fen, primary_audience, peak_hours, suitable_offers, unsuitable_offers, notes)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
       ON CONFLICT (store_id) DO UPDATE SET
         brand = EXCLUDED.brand,
         avg_ticket_fen = EXCLUDED.avg_ticket_fen,
         primary_audience = EXCLUDED.primary_audience,
         peak_hours = EXCLUDED.peak_hours,
         suitable_offers = EXCLUDED.suitable_offers,
         unsuitable_offers = EXCLUDED.unsuitable_offers,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [storeId, cleanText(b.brand, 128), Math.max(0, Math.floor(Number(b.avg_ticket_fen) || 0)), cleanText(b.primary_audience, 500), JSON.stringify(b.peak_hours || []), JSON.stringify(b.suitable_offers || []), JSON.stringify(b.unsuitable_offers || []), cleanText(b.notes, 4000)]
    );
    return res.json({ ok: true, profile: r.rows[0] });
  });

  app.get('/api/growth/customer-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const lifecycle = cleanText(req.query.lifecycle_stage || '', 40);
    const r = await pool.query(
      `SELECT * FROM growth_customer_profiles
       WHERE ($1::text = '' OR store_id = $1)
         AND ($2::text = '' OR lifecycle_stage = $2)
       ORDER BY updated_at DESC
       LIMIT 300`,
      [storeId, lifecycle]
    );
    return res.json({ ok: true, profiles: r.rows });
  });

  app.post('/api/growth/customer-profiles/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const days = await recomputeCustomerProfiles(pool, req.body?.days || 90);
    return res.json({ ok: true, days });
  });

  app.get('/api/growth/profile-signals', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const customerId = Number(req.query.customer_id) || 0;
    const signalType = cleanText(req.query.signal_type || '', 80);
    const r = await pool.query(
      `SELECT * FROM growth_profile_signals
       WHERE ($1::bigint = 0 OR customer_id = $1)
         AND ($2::text = '' OR signal_type = $2)
       ORDER BY occurred_at DESC
       LIMIT 300`,
      [customerId, signalType]
    );
    return res.json({ ok: true, signals: r.rows });
  });

  app.post('/api/growth/profile-signals', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const payload = {
      phone: b.phone,
      openid: b.openid,
      external_userid: b.external_userid,
      store_id: b.store_id,
      customer_meta: {}
    };
    const customer = b.customer_id ? { id: Number(b.customer_id) } : await upsertCustomer(pool, payload);
    const signal = await pool.query(
      `INSERT INTO growth_profile_signals (
        customer_id, signal_type, signal_key, signal_value, signal_score,
        source, store_id, campaign_id, occurred_at, meta
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      RETURNING *`,
      [
        customer?.id || null,
        cleanText(b.signal_type, 80),
        cleanText(b.signal_key, 80),
        cleanText(b.signal_value, 500),
        b.signal_score == null ? null : Number(b.signal_score),
        cleanText(b.source, 80),
        cleanText(b.store_id, 128),
        cleanText(b.campaign_id, 128),
        parseOccurredAt(b.occurred_at),
        JSON.stringify(b.meta || {})
      ]
    );
    return res.json({ ok: true, signal: signal.rows[0] });
  });

  app.get('/api/growth/store-constraints', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const r = await pool.query(
      `SELECT * FROM store_marketing_constraints
       WHERE ($1::text = '' OR store_id = $1)
       ORDER BY updated_at DESC
       LIMIT 200`,
      [storeId]
    );
    return res.json({ ok: true, constraints: r.rows });
  });

  app.post('/api/growth/store-constraints', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeId = cleanText(b.store_id, 128);
    if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
    const r = await pool.query(
      `INSERT INTO store_marketing_constraints (
        store_id, brand, min_discount_rate, max_coupon_value_fen, monthly_budget_fen,
        max_touch_per_72h, cooldown_hours_after_payment, allowed_channels,
        disallowed_campaign_types, disallowed_dishes, preferred_channels,
        brand_voice_style, execution_notes, active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14)
      ON CONFLICT (store_id) DO UPDATE SET
        brand = EXCLUDED.brand,
        min_discount_rate = EXCLUDED.min_discount_rate,
        max_coupon_value_fen = EXCLUDED.max_coupon_value_fen,
        monthly_budget_fen = EXCLUDED.monthly_budget_fen,
        max_touch_per_72h = EXCLUDED.max_touch_per_72h,
        cooldown_hours_after_payment = EXCLUDED.cooldown_hours_after_payment,
        allowed_channels = EXCLUDED.allowed_channels,
        disallowed_campaign_types = EXCLUDED.disallowed_campaign_types,
        disallowed_dishes = EXCLUDED.disallowed_dishes,
        preferred_channels = EXCLUDED.preferred_channels,
        brand_voice_style = EXCLUDED.brand_voice_style,
        execution_notes = EXCLUDED.execution_notes,
        active = EXCLUDED.active,
        updated_at = NOW()
      RETURNING *`,
      [
        storeId,
        cleanText(b.brand, 128),
        b.min_discount_rate == null ? null : Number(b.min_discount_rate),
        b.max_coupon_value_fen == null ? null : Math.max(0, Math.floor(Number(b.max_coupon_value_fen) || 0)),
        b.monthly_budget_fen == null ? null : Math.max(0, Math.floor(Number(b.monthly_budget_fen) || 0)),
        Math.max(0, Math.floor(Number(b.max_touch_per_72h) || 1)),
        Math.max(0, Math.floor(Number(b.cooldown_hours_after_payment) || 24)),
        JSON.stringify(b.allowed_channels || []),
        JSON.stringify(b.disallowed_campaign_types || []),
        JSON.stringify(b.disallowed_dishes || []),
        JSON.stringify(b.preferred_channels || []),
        cleanText(b.brand_voice_style, 200),
        cleanText(b.execution_notes, 4000),
        b.active !== false
      ]
    );
    return res.json({ ok: true, constraint: r.rows[0] });
  });

  // ── Strategy context — 为 Agent 提供门店画像+约束上下文 ──
  app.get('/api/growth/strategy-context', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    await handleStrategyContext(cleanText(req.query.store_id, 128), cleanText(req.query.channel, 80), cleanText(req.query.audience, 200), res);
  });

  // Shared handler for strategy-context (used by both GET and POST)
  async function handleStrategyContext(storeId, channel, audience, res) {
    const result = { storeId, channel, audience, profile: null, constraints: null };
    try {
      if (storeId) {
        const [p, c] = await Promise.all([
          pool.query('SELECT * FROM store_marketing_profiles WHERE store_id = $1 LIMIT 1', [storeId]),
          pool.query('SELECT * FROM store_marketing_constraints WHERE store_id = $1 LIMIT 1', [storeId])
        ]);
        if (p.rows?.length) result.profile = p.rows[0];
        if (c.rows?.length) result.constraints = c.rows[0];
      }
      res.json({ ok: true, context: result, summary: { has_profile: !!result.profile, has_constraints: !!result.constraints } });
    } catch (e) { res.status(500).json({ ok: false, error: e?.message }); }
  }

  app.post('/api/growth/strategy-context', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    await handleStrategyContext(cleanText(req.body.store_id, 128), cleanText(req.body.channel, 80), cleanText(req.body.audience, 200), res);
  });

  app.get('/api/growth/public-channels', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT * FROM public_channels WHERE enabled = TRUE ORDER BY store_id, platform, name LIMIT 300`);
    return res.json({ ok: true, channels: r.rows });
  });

  app.post('/api/growth/public-channels', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO public_channels (channel_key, name, platform, store_id, owner_username, meta, enabled)
       VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6::jsonb,COALESCE($7, TRUE))
       ON CONFLICT (channel_key) DO UPDATE SET
         name = EXCLUDED.name,
         platform = EXCLUDED.platform,
         store_id = EXCLUDED.store_id,
         owner_username = EXCLUDED.owner_username,
         meta = EXCLUDED.meta,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING *`,
      [cleanText(b.channel_key, 128), cleanText(b.name, 200), cleanText(b.platform, 80), cleanText(b.store_id, 128), cleanText(b.owner_username, 128), JSON.stringify(b.meta || {}), b.enabled !== false]
    );
    return res.json({ ok: true, channel: r.rows[0] });
  });

  app.get('/api/growth/public-promo-tasks', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || '', 40);
    const r = await pool.query(
      `SELECT * FROM public_promo_tasks
       WHERE ($1::text = '' OR status = $1)
       ORDER BY COALESCE(due_at, created_at) DESC
       LIMIT 300`,
      [status]
    );
    return res.json({ ok: true, tasks: r.rows });
  });

  app.post('/api/growth/public-promo-tasks', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO public_promo_tasks (task_key, store_id, channel_key, campaign_id, title, content_brief, copy_text, poster_url, qr_scene, status, assignee_username, due_at)
       VALUES (NULLIF($1,''),NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,COALESCE(NULLIF($10,''),'planned'),NULLIF($11,''),$12)
       ON CONFLICT (task_key) DO UPDATE SET status = EXCLUDED.status, copy_text = EXCLUDED.copy_text, poster_url = EXCLUDED.poster_url, updated_at = NOW()
       RETURNING *`,
      [cleanText(b.task_key, 255), cleanText(b.store_id, 128), cleanText(b.channel_key, 80), cleanText(b.campaign_id, 128), cleanText(b.title, 500), cleanText(b.content_brief, 2000), cleanText(b.copy_text, 4000), cleanText(b.poster_url, 1000), cleanText(b.qr_scene, 255), cleanText(b.status, 40), cleanText(b.assignee_username, 128), b.due_at ? parseOccurredAt(b.due_at) : null]
    );
    return res.json({ ok: true, task: r.rows[0] });
  });

  app.get('/api/growth/creative-assets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const r = await pool.query(
      `SELECT * FROM creative_assets
       WHERE enabled = TRUE AND ($1::text = '' OR store_id = $1)
       ORDER BY created_at DESC
       LIMIT 300`,
      [storeId]
    );
    return res.json({ ok: true, assets: r.rows });
  });

  app.post('/api/growth/creative-assets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO creative_assets (asset_key, store_id, asset_type, name, url, tags, meta, enabled)
       VALUES (NULLIF($1,''),NULLIF($2,''),$3,$4,$5,$6::jsonb,$7::jsonb,COALESCE($8, TRUE))
       ON CONFLICT (asset_key) DO UPDATE SET
         store_id = EXCLUDED.store_id,
         asset_type = EXCLUDED.asset_type,
         name = EXCLUDED.name,
         url = EXCLUDED.url,
         tags = EXCLUDED.tags,
         meta = EXCLUDED.meta,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING *`,
      [cleanText(b.asset_key, 255), cleanText(b.store_id, 128), cleanText(b.asset_type, 80), cleanText(b.name, 300), cleanText(b.url, 1000), JSON.stringify(b.tags || []), JSON.stringify(b.meta || {}), b.enabled !== false]
    );
    return res.json({ ok: true, asset: r.rows[0] });
  });

  app.get('/api/growth/poster-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT * FROM poster_templates WHERE enabled = TRUE ORDER BY category, name LIMIT 300`);
    return res.json({ ok: true, templates: r.rows });
  });

  app.post('/api/growth/poster-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const purposes = Array.isArray(b.purposes) ? b.purposes.filter(Boolean) : [];
    const channels = Array.isArray(b.channels) ? b.channels.filter(Boolean) : [];
    const r = await pool.query(
      `INSERT INTO poster_templates (template_key, name, category, channel, aspect_ratio, layout, style_guide, image_url, enabled, purposes, channels)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,COALESCE($9, TRUE),$10,$11)
       ON CONFLICT (template_key) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         channel = EXCLUDED.channel,
         aspect_ratio = EXCLUDED.aspect_ratio,
         layout = EXCLUDED.layout,
         style_guide = EXCLUDED.style_guide,
         image_url = EXCLUDED.image_url,
         enabled = EXCLUDED.enabled,
         purposes = EXCLUDED.purposes,
         channels = EXCLUDED.channels,
         updated_at = NOW()
       RETURNING *`,
      [cleanText(b.template_key, 128), cleanText(b.name, 300), cleanText(b.category, 80), cleanText(b.channel, 80), cleanText(b.aspect_ratio, 40), JSON.stringify(b.layout || {}), JSON.stringify(b.style_guide || {}), cleanText(b.image_url, 1000), b.enabled !== false, purposes, channels]
    );
    return res.json({ ok: true, template: r.rows[0] });
  });

  app.delete('/api/growth/poster-templates/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
    await pool.query('DELETE FROM poster_templates WHERE id = $1', [id]);
    return res.json({ ok: true });
  });

  app.delete('/api/growth/creative-assets/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
    await pool.query('DELETE FROM creative_assets WHERE id = $1', [id]);
    return res.json({ ok: true });
  });

  app.get('/api/growth/generated-posters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const status = cleanText(req.query.status || '', 40);
    const r = await pool.query(
      `SELECT * FROM generated_posters
       WHERE ($1::text = '' OR status = $1)
       ORDER BY created_at DESC
       LIMIT 300`,
      [status]
    );
    return res.json({ ok: true, posters: r.rows });
  });

  app.post('/api/growth/generated-posters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO generated_posters (poster_key, campaign_id, store_id, template_key, title, subtitle, cta, image_url, output_url, purposes, channels, status, meta)
       VALUES (NULLIF($1,''),NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,COALESCE(NULLIF($12,''),'draft'),$13::jsonb)
       ON CONFLICT (poster_key) DO UPDATE SET title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, cta = EXCLUDED.cta, output_url = EXCLUDED.output_url, purposes = EXCLUDED.purposes, channels = EXCLUDED.channels, status = EXCLUDED.status, meta = EXCLUDED.meta, updated_at = NOW()
       RETURNING *`,
      [cleanText(b.poster_key, 255), cleanText(b.campaign_id, 128), cleanText(b.store_id, 128), cleanText(b.template_key, 128), cleanText(b.title, 500), cleanText(b.subtitle, 1000), cleanText(b.cta, 500), cleanText(b.image_url, 1000), cleanText(b.output_url, 1000), Array.isArray(b.purposes) ? b.purposes.filter(Boolean) : [], Array.isArray(b.channels) ? b.channels.filter(Boolean) : [], cleanText(b.status, 40), JSON.stringify(b.meta || {})]
    );
    return res.json({ ok: true, poster: r.rows[0] });
  });

  app.get('/api/growth/content-library', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const purpose = cleanText(req.query.purpose || '', 40);
    const channel = cleanText(req.query.channel || '', 40);
    const storeId = cleanText(req.query.store_id || '', 128);
    const conditions = ["gp.status IN ('generated','published')"];
    const params = [];
    let idx = 1;
    if (purpose) { conditions.push(`$${idx} = ANY(gp.purposes)`); params.push(purpose); idx++; }
    if (channel) { conditions.push(`$${idx} = ANY(gp.channels)`); params.push(channel); idx++; }
    if (storeId) { conditions.push(`(gp.store_id IS NULL OR gp.store_id = '' OR gp.store_id = $${idx})`); params.push(storeId); idx++; }
    const query = `SELECT gp.id, gp.poster_key AS template_key, COALESCE(pt.name, gp.title, '海报') AS name, gp.title, gp.subtitle, gp.purposes, gp.channels, gp.output_url AS image_url, gp.created_at
      FROM generated_posters gp
      LEFT JOIN poster_templates pt ON pt.template_key = gp.template_key
      WHERE ${conditions.join(' AND ')}
      ORDER BY gp.created_at DESC LIMIT 100`;
    const r = await pool.query(query, params);
    return res.json({ ok: true, items: r.rows });
  });

  app.delete('/api/growth/generated-posters/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
    await pool.query('DELETE FROM generated_posters WHERE id = $1', [id]);
    return res.json({ ok: true });
  });

  app.get('/api/growth/customers', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const phone = cleanText(req.query.phone || '', 32);
    const openid = cleanText(req.query.openid || '', 128);
    const store_id = cleanText(req.query.store_id || '', 128);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (phone) { conditions.push(`phone = $${idx++}`); params.push(phone); }
    if (openid) { conditions.push(`openid = $${idx++}`); params.push(openid); }
    if (store_id) { conditions.push(`(first_store_id = $${idx} OR last_store_id = $${idx})`); params.push(store_id); idx++; }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await pool.query(`SELECT id, phone, openid, external_userid, first_store_id, last_store_id, first_seen_at, last_seen_at, meta, created_at FROM growth_customers ${where} ORDER BY last_seen_at DESC NULLS LAST LIMIT $${idx++} OFFSET $${idx}`, [...params, limit, offset]);
    return res.json({ ok: true, customers: r.rows });
  });

  app.get('/api/growth/events', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const event_type = cleanText(req.query.event_type || '', 80);
    const store_id = cleanText(req.query.store_id || '', 128);
    const campaign_id = cleanText(req.query.campaign_id || '', 128);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (event_type) { conditions.push(`event_type = $${idx++}`); params.push(event_type); }
    if (store_id) { conditions.push(`store_id = $${idx++}`); params.push(store_id); }
    if (campaign_id) { conditions.push(`campaign_id = $${idx++}`); params.push(campaign_id); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await pool.query(`SELECT id, event_type, customer_id, phone, openid, store_id, campaign_id, channel, coupon_id, order_id, amount_fen, occurred_at FROM growth_events ${where} ORDER BY occurred_at DESC LIMIT $${idx++} OFFSET $${idx}`, [...params, limit, offset]);
    return res.json({ ok: true, events: r.rows });
  });

  app.get('/api/growth/campaigns', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const store_id = cleanText(req.query.store_id || '', 128);
    const status = cleanText(req.query.status || '', 40);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (store_id) { conditions.push(`store_id = $${idx++}`); params.push(store_id); }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await pool.query(`SELECT * FROM growth_campaigns ${where} ORDER BY created_at DESC`, params);
    return res.json({ ok: true, campaigns: r.rows });
  });

  app.get('/api/growth/redemptions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const campaign_id = cleanText(req.query.campaign_id || '', 128);
    const store_id = cleanText(req.query.store_id || '', 128);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const conditions = [];
    const params = [];
    let idx = 1;
    if (campaign_id) { conditions.push(`r.campaign_id = $${idx++}`); params.push(campaign_id); }
    if (store_id) { conditions.push(`r.store_id = $${idx++}`); params.push(store_id); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    // 关联活动中文名（campaign_id → growth_campaigns.name），并回传 metadata 供前台兜底取活动/规则名
    const r = await pool.query(
      `SELECT r.id, r.customer_id, r.coupon_id, r.campaign_id, r.store_id, r.amount_fen, r.redeemed_at, r.metadata,
              c.name AS campaign_name
       FROM growth_redemptions r
       LEFT JOIN growth_campaigns c ON c.campaign_id = r.campaign_id
       ${where} ORDER BY r.redeemed_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );
    return res.json({ ok: true, redemptions: r.rows });
  });

  // ── Phase 3: Feishu callback for alert cards ──
  const FEISHU_CALLBACK_SECRET = cleanText(process.env.FEISHU_CALLBACK_SECRET || process.env.MINIPROGRAM_SYNC_SECRET || '', 500);
  app.post('/api/growth/feishu-callback', async (req, res) => {
    const b = req.body || {};
    const reqSecret = cleanText(b.secret || b.token || req.headers['x-callback-secret'] || '', 500);
    if (FEISHU_CALLBACK_SECRET && reqSecret !== FEISHU_CALLBACK_SECRET) return res.status(403).json({ ok: false, error: 'unauthorized' });
    const actionKey = cleanText(b.action_key || '', 255);
    const decision = cleanText(b.decision || '', 80);
    if (!actionKey || !decision) return res.status(400).json({ ok: false, error: 'missing_action_key_or_decision' });
    try {
      const current = await pool.query(`SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1`, [actionKey]);
      if (!current.rows.length) return res.status(404).json({ ok: false, error: 'action_not_found' });
      const before = current.rows[0];
      if (decision === 'execute') {
        await pool.query(`UPDATE growth_actions SET status='executed', executed_at=NOW(), updated_at=NOW() WHERE action_key=$1`, [actionKey]);
        await appendExecutionLog(pool, { action_key: actionKey, store_id: before.store_id, action_type: before.action_type, decision: 'executed', operator_username: 'feishu_callback', operator_role: 'admin', decision_reason: b.reason || '飞书卡片执行', result_summary: '从飞书卡片执行' });
        return res.json({ ok: true, action: 'executed' });
      } else if (decision === 'ignore') {
        await pool.query(`UPDATE growth_actions SET status='ignored', updated_at=NOW() WHERE action_key=$1`, [actionKey]);
        await appendExecutionLog(pool, { action_key: actionKey, store_id: before.store_id, action_type: before.action_type, decision: 'ignored', operator_username: 'feishu_callback', operator_role: 'admin', decision_reason: b.reason || '飞书卡片忽略', result_summary: '从飞书卡片忽略' });
        return res.json({ ok: true, action: 'ignored' });
      } else if (decision === 'feedback') {
        // 允许从飞书卡片提交简短执行反馈
        const note = cleanText(b.reason || b.note || '', 2000);
        await pool.query(
          `UPDATE growth_actions
           SET status = 'executed', payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at = NOW(), executed_at = COALESCE(executed_at, NOW())
           WHERE action_key = $1`,
          [actionKey, JSON.stringify({ feishu_feedback_note: note, feedback_source: 'feishu_card' })]
        );
        await appendExecutionLog(pool, { action_key: actionKey, store_id: before.store_id, action_type: before.action_type, decision: 'feedback', operator_username: 'feishu_callback', operator_role: 'admin', decision_reason: note || '飞书卡片执行回填', result_summary: note || '从飞书卡片回填' });
        return res.json({ ok: true, action: 'feedback_submitted' });
      }
      return res.status(400).json({ ok: false, error: 'invalid_decision' });
    } catch (e) { return res.status(500).json({ ok: false, error: e?.message || 'callback_error' }); }
  });

  // ── Phase 3: Action feedback / 执行回填 ──
  // 纯手动建议看板：店长回填实际结果(触达/核销/营收) → 按预计目标自动打分 → 沉淀经验库供下一轮AI建议复用。
  app.post('/api/growth/actions/:actionKey/feedback', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const actionKey = cleanText(req.params.actionKey, 255);
    const b = req.body || {};
    const operator = getGrowthOperator(req);

    // 先取动作，拿到 expected_kpi / 渠道 / 文案，用于打分与经验沉淀
    const cur = await pool.query('SELECT * FROM growth_actions WHERE action_key = $1 LIMIT 1', [actionKey]);
    if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'action_not_found' });
    const action = cur.rows[0];
    const payload = action.payload || {};

    // 结构化实际结果（任一可空；提供越多打分越准）
    const hasResult = b.actual_reach != null || b.actual_redemptions != null || b.actual_revenue_fen != null;
    const actual = {
      reach: b.actual_reach != null ? Math.max(0, Math.floor(Number(b.actual_reach) || 0)) : null,
      redemptions: b.actual_redemptions != null ? Math.max(0, Math.floor(Number(b.actual_redemptions) || 0)) : null,
      revenue_fen: b.actual_revenue_fen != null ? Math.max(0, Math.floor(Number(b.actual_revenue_fen) || 0)) : null
    };
    const expected = (payload.expected_kpi && typeof payload.expected_kpi === 'object') ? payload.expected_kpi : {};

    // 自动打分：各指标实际/预计的达成比，1.0=达标→80分；缺指标则跳过
    let scorePayload = null;
    if (hasResult) {
      const parts = [];
      if (Number(expected.reach) > 0 && actual.reach != null) parts.push(Math.min(2, actual.reach / Number(expected.reach)));
      const actualRate = actual.reach && actual.reach > 0 && actual.redemptions != null ? (actual.redemptions / actual.reach) * 100 : null;
      if (Number(expected.redemption_rate) > 0 && actualRate != null) parts.push(Math.min(2, actualRate / Number(expected.redemption_rate)));
      if (Number(expected.revenue_fen) > 0 && actual.revenue_fen != null) parts.push(Math.min(2, actual.revenue_fen / Number(expected.revenue_fen)));
      const achievement = parts.length ? parts.reduce((a, c) => a + c, 0) / parts.length : null;
      const score = achievement != null ? Math.round(Math.min(100, achievement * 80)) : null;
      const effectiveness = score == null ? '已回填' : score >= 70 ? '有效' : score >= 40 ? '部分有效' : '无效';
      scorePayload = {
        actual,
        expected_kpi: expected,
        actual_redemption_rate: actualRate != null ? Number(actualRate.toFixed(1)) : null,
        achievement: achievement != null ? Number(achievement.toFixed(2)) : null,
        effectiveness_score: score,
        effectiveness,
        scored_at: new Date().toISOString()
      };
    }

    const mergePayload = {
      feedback_note: cleanText(b.note, 4000),
      feedback_screenshot_url: cleanText(b.screenshot_url, 1000),
      feedback_result_url: cleanText(b.result_url, 1000),
      executed_by: operator.username,
      executed_at: new Date().toISOString()
    };
    if (scorePayload) mergePayload.outcome_summary = scorePayload;

    const r = await pool.query(
      `UPDATE growth_actions
       SET status = COALESCE(NULLIF($2,''), status),
           payload = COALESCE(payload,'{}'::jsonb) || $3::jsonb,
           updated_at = NOW()
       WHERE action_key = $1
       RETURNING *`,
      [actionKey, cleanText(b.status, 40), JSON.stringify(mergePayload)]
    );

    // 沉淀经验库：复用 growth_learnings，被下一轮 AI 建议生成读取
    if (scorePayload && scorePayload.effectiveness_score != null) {
      const approach = cleanText(payload.ready_copy || payload.execution_action || action.title, 500);
      const channel = cleanText(payload.channel || '', 80);
      const audienceTag = cleanText(payload.target_audience || '', 120) || null;
      const isWin = scorePayload.effectiveness_score >= 70;
      const effectDesc = cleanText(
        `${scorePayload.effectiveness}｜核销率${scorePayload.actual_redemption_rate != null ? scorePayload.actual_redemption_rate + '%' : '-'}，实收¥${actual.revenue_fen != null ? Math.round(actual.revenue_fen / 100) : '-'}，达成${scorePayload.achievement != null ? Math.round(scorePayload.achievement * 100) + '%' : '-'}`,
        255
      );
      const sample = actual.reach || 0;
      await pool.query(
        `INSERT INTO growth_learnings (source_type, source_id, store_code, channel, scene, audience_tag, variable, winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, is_verified)
         VALUES ('ai_suggestion',$1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,true)
         ON CONFLICT DO NOTHING`,
        [
          actionKey,
          cleanText(action.store_id, 128),
          channel || null,
          audienceTag,
          'AI建议方案有效性',
          isWin ? approach : '换其它方向（避免重复）',
          isWin ? null : approach,
          effectDesc,
          sample,
          sample >= 100 ? 'high' : sample >= 30 ? 'medium' : 'low',
          new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
        ]
      ).catch((e) => { console.warn('[growth] deposit learning failed:', e?.message || e); });
    }

    await appendExecutionLog(pool, { action_key: actionKey, store_id: r.rows[0].store_id, action_type: r.rows[0].action_type, decision: 'feedback', operator_username: operator.username, operator_role: operator.role, after_payload: r.rows[0].payload, decision_reason: cleanText(b.note, 2000), result_summary: scorePayload ? `回填打分：${scorePayload.effectiveness}(${scorePayload.effectiveness_score}分)` : (b.note || '执行回填完成') });
    return res.json({ ok: true, action: r.rows[0], score: scorePayload });
  });

  // ── Phase 5: Semantic write-back to profiles ──
  app.post('/api/growth/semantic-parse', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const text = cleanText(req.body.text, 4000);
    if (!text) return res.status(400).json({ ok: false, error: 'missing_text' });
    try {
      const { default: jwt } = await import('jsonwebtoken');
      const admToken = jwt.sign({ username: 'growth_semantic', role: 'admin' }, process.env.JWT_SECRET || 'dev', { expiresIn: '30s' });
      const agentResp = await fetch((process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101') + '/api/growth/semantic-parse', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + admToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const result = agentResp.ok ? await agentResp.json() : { ok: false };
      if (result.ok && result.taste_tags) {
        return res.json(result);
      }
    } catch (e) { /* fallback below */ }
    // Fallback keyword parsing
    const tags = [];
    if (/辣|麻辣/.test(text)) tags.push('麻辣');
    if (/清淡|少油/.test(text)) tags.push('清淡');
    if (/甜|甜品/.test(text)) tags.push('甜品');
    if (/肉|牛|羊|猪/.test(text)) tags.push('肉食');
    if (/汤|煲/.test(text)) tags.push('汤品');
    return res.json({
      ok: true, taste_tags: tags, price_sensitivity: null,
      emotion: /差|不好|失望/.test(text) ? '负面' : /好|好吃|满意/.test(text) ? '正面' : '中性',
      return_intent: /再来|下次|还会/.test(text),
      key_insight: '关键词解析（LLM不可用）', source: 'keyword_fallback'
    });
  });

  // ── Phase 5: Semantic write-back to profiles ──
  app.post('/api/growth/semantic-writeback', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const customerId = Number(b.customer_id) || 0;
    if (!customerId) return res.status(400).json({ ok: false, error: 'missing_customer_id' });
    const tags = Array.isArray(b.tags) ? b.tags.map(t => cleanText(String(t), 80)).filter(Boolean) : [];
    const tasteTags = Array.isArray(b.taste_tags) ? b.taste_tags.map(t => cleanText(String(t), 80)).filter(Boolean) : [];
    const priceHint = b.price_sensitivity_hint == null ? null : Number(b.price_sensitivity_hint);
    const returnIntent = !!b.return_intent;
    await pool.query(
      `UPDATE growth_customer_profiles
       SET semantic_tags = COALESCE(semantic_tags,'[]'::jsonb) || $2::jsonb,
           favorite_dishes = CASE WHEN $3::jsonb <> '[]'::jsonb THEN COALESCE(favorite_dishes,'[]'::jsonb) || $3::jsonb ELSE favorite_dishes END,
           price_sensitivity = COALESCE($4, price_sensitivity),
           updated_at = NOW()
       WHERE customer_id = $1`,
      [customerId, JSON.stringify(tags), JSON.stringify(tasteTags), priceHint]
    );
    await pool.query(
      `INSERT INTO growth_profile_signals (customer_id, signal_type, signal_key, signal_value, signal_score, source)
       VALUES ($1,'semantic_tag','semantic_parse',NULLIF($2,''),NULL,$3)`,
      [customerId, tags.slice(0, 5).join(','), 'agent_parse']
    );
    return res.json({ ok: true, customer_id: customerId, tags_written: tags.concat(tasteTags), return_intent: returnIntent });
  });

  // ── Phase 6: Weather context + China holidays ──
  const CHINA_HOLIDAYS = {
    '2026-01-01':'元旦','2026-01-28':'小年','2026-02-12':'除夕','2026-02-13':'春节','2026-02-14':'初二','2026-02-15':'初三','2026-02-16':'初四','2026-02-17':'初五',
    '2026-02-18':'初六','2026-03-01':'元宵节','2026-04-04':'清明节','2026-04-05':'清明','2026-04-06':'清明假期','2026-05-01':'劳动节','2026-05-02':'劳动节','2026-05-03':'劳动节',
    '2026-06-20':'端午节','2026-06-21':'端午','2026-06-22':'端午假期','2026-08-28':'七夕','2026-09-17':'中秋节','2026-09-18':'中秋','2026-09-19':'中秋假期',
    '2026-10-01':'国庆节','2026-10-02':'国庆','2026-10-03':'国庆','2026-10-04':'国庆','2026-10-05':'国庆','2026-10-06':'国庆','2026-10-07':'国庆',
    '2026-12-25':'圣诞节'
  };
  let weatherCache = { data: null, at: 0 };
  app.get('/api/growth/weather-context', async (req, res) => {
    const city = cleanText(req.query.city || '上海', 80);
    const today = new Date().toISOString().slice(0, 10);
    const holiday = CHINA_HOLIDAYS[today] || null;
    const month = new Date().getMonth() + 1;
    const day = new Date().getDate();
    const season = month >= 3 && month <= 5 ? '春季' : month >= 6 && month <= 8 ? '夏季' : month >= 9 && month <= 11 ? '秋季' : '冬季';
    const isWeekend = [0, 6].includes(new Date().getDay());
    const dateKey = today;
    let temperature = null, condition = null;
    // Try cache first (5 min TTL)
    if (weatherCache.data && Date.now() - weatherCache.at < 300000 && weatherCache.data.dateKey === dateKey) {
      temperature = weatherCache.data.temperature;
      condition = weatherCache.data.condition;
    } else {
      // Try open-meteo (more reliable than wttr.in)
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 4000);
        // Use lat/lon for Shanghai area
        const coords = { '上海': '31.23,121.47', '北京': '39.90,116.40', '广州': '23.13,113.26', '深圳': '22.54,114.06' };
        const latlon = coords[city] || '31.23,121.47';
        const [lat, lon] = latlon.split(',');
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`, { signal: ctrl.signal });
        if (resp.ok) {
          const d = await resp.json();
          const current = d?.current;
          if (current) {
            temperature = current.temperature_2m != null ? current.temperature_2m + '°C' : null;
            const codes = {0:'晴',1:'多云',2:'多云',3:'多云',45:'雾',48:'雾',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'阵雨',82:'阵雨',95:'雷阵雨'};
            condition = codes[current.weather_code || 0] || '未知';
          }
        }
      } catch (e) { /* fallback to seasonal */ }
      weatherCache = { data: { dateKey, temperature, condition }, at: Date.now() };
    }
    // Build context with guaranteed fallback values
    const context = { date: today, season, is_weekend: isWeekend, holiday, temperature: temperature || '未知', condition: condition || '未知', city };
    const tips = [];
    if (holiday) tips.push(`今天是${holiday}`);
    if (isWeekend) tips.push('周末');
    if (condition === '雨' || condition?.includes('雨')) tips.push('雨天，适合推送温暖主题');
    if (condition === '雪' || condition?.includes('雪')) tips.push('雪天，适合推送火锅/热饮');
    if (temperature && parseInt(temperature) > 30) tips.push('高温，适合推送冰饮/凉菜');
    if (temperature && parseInt(temperature) < 5) tips.push('寒冷，适合推送热汤/暖锅');
    tips.push(`${season}主题${isWeekend ? '·周末' : '·工作日'}${holiday ? '·' + holiday : ''}`);
    context.tips = tips;
    context.ok = true;
    return res.json(context);
  });

  // ── Phase 6: Active time window prediction ──
  app.get('/api/growth/active-window', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const timePatterns = await pool.query(
      `SELECT
         COUNT(*)::int as event_count,
         CASE
           WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 6 AND 10 THEN '早餐(6-10点)'
           WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 10 AND 14 THEN '午市(10-14点)'
           WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 14 AND 17 THEN '下午茶(14-17点)'
           WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 17 AND 21 THEN '晚市(17-21点)'
           ELSE '夜间(21-6点)'
         END AS time_segment,
         EXTRACT(DOW FROM occurred_at)::int AS weekday,
         CASE WHEN EXTRACT(DOW FROM occurred_at) IN (0,6) THEN '周末' ELSE '工作日' END AS day_type,
         COUNT(*) FILTER (WHERE event_type IN ('payment_success','coupon_redeemed'))::int AS conversion_count
       FROM growth_events
       WHERE ($1='' OR store_id=$1) AND occurred_at >= CURRENT_DATE - 90
       GROUP BY 2, 3, 4
       ORDER BY event_count DESC
       LIMIT 10`,
      [storeId]
    );
    const profileSegments = await pool.query(
      `SELECT lifecycle_stage, COUNT(*)::int as cnt,
              MODE() WITHIN GROUP (ORDER BY best_contact_window) AS top_window,
              ROUND(AVG(price_sensitivity)::numeric, 2) AS avg_price_sens,
              ROUND(AVG(response_to_discount)::numeric, 2) AS avg_discount_resp
       FROM growth_customer_profiles
       WHERE ($1='' OR store_id=$1) GROUP BY lifecycle_stage ORDER BY cnt DESC`,
       [storeId]
     );
    const repurchaseRisk = await pool.query(
      `SELECT COUNT(*)::int as at_risk_count, store_id
       FROM growth_customer_profiles
       WHERE lifecycle_stage IN ('at_risk','dormant','churned')
         AND ($1='' OR store_id=$1)
       GROUP BY store_id`,
      [storeId]
    );
    // 价值分级分布 + VIP沉睡客（最值得优先召回）+ 客户流失率，喂给AI策略推荐
    const valueTierSeg = await pool.query(
      `SELECT value_tier, COUNT(*)::int AS cnt,
              COUNT(*) FILTER (WHERE lifecycle_stage = 'dormant')::int AS dormant_cnt
       FROM growth_customer_profiles
       WHERE ($1='' OR store_id=$1) AND COALESCE(pos_total_spend,0) > 0
       GROUP BY value_tier`,
      [storeId]
    );
    const vipRow = valueTierSeg.rows.find(r => r.value_tier === 'vip') || { cnt: 0, dormant_cnt: 0 };
    const engagedTotal = valueTierSeg.rows.reduce((s, r) => s + Number(r.cnt || 0), 0);
    const lostTotal = profileSegments.rows
      .filter(r => ['dormant', 'churned'].includes(r.lifecycle_stage))
      .reduce((s, r) => s + Number(r.cnt || 0), 0);
    const churnRatePct = engagedTotal ? Math.round((lostTotal / engagedTotal) * 1000) / 10 : 0;
    const topPattern = timePatterns.rows[0];
    const prediction = topPattern ? `${topPattern.day_type} ${topPattern.time_segment}（基于${topPattern.event_count}次历史事件，其中成交${topPattern.conversion_count}次）` : '数据不足';
    return res.json({
      ok: true,
      predicted_window: prediction,
      time_patterns: timePatterns.rows.slice(0, 5),
      segments: profileSegments.rows,
      profile_segments: profileSegments.rows,
      value_tier_segments: valueTierSeg.rows,
      churn_rate: churnRatePct,
      repurchase_risk: repurchaseRisk.rows,
      recommendations: [
        prediction !== '数据不足' ? `📅 预测最佳触达: ${prediction}` : '',
        repurchaseRisk.rows.length ? `⏰ ${repurchaseRisk.rows[0].at_risk_count || 0}位客户处于临界/沉睡/流失，建议尽快触达` : '',
        Number(vipRow.dormant_cnt) > 0 ? `👑 ${vipRow.dormant_cnt}位VIP高价值客已沉睡，优先用招牌菜/专属券召回（勿用小券）` : '',
        Number(vipRow.cnt) > 0 ? `💎 当前VIP客群${vipRow.cnt}人，建议走专属感运营（新品预告/留位），避免打折掉价` : '',
        churnRatePct > 0 ? `📉 客户流失率 ${churnRatePct}%（沉睡+流失占曾消费客户比例）` : '',
        ...profileSegments.rows.filter(r => r.cnt > 0).map(r =>
          `📊 ${r.lifecycle_stage}客群(${r.cnt}人) 最佳触达:${r.top_window || '未设定'} 价格敏感度:${r.avg_price_sens||'N/A'} 折扣响应:${r.avg_discount_resp||'N/A'}`
        )
      ].filter(Boolean)
    });
  });

  // ── Phase 6: Repurchase critical period auto-trigger ──
  app.post('/api/growth/repurchase-trigger', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.body.store_id || '', 128);
    const repurchaseTenantId = getGrowthTenantId(req);
    const r = await pool.query(
      `SELECT cp.customer_id, cp.phone, cp.store_id, cp.lifecycle_stage, cp.next_visit_probability,
              cp.best_contact_window, cp.response_to_discount, cp.price_sensitivity
       FROM growth_customer_profiles cp
       WHERE ($1='' OR cp.store_id=$1) AND cp.lifecycle_stage IN ('at_risk','churned')
         AND cp.phone IS NOT NULL
       LIMIT 50`,
      [storeId]
    );
    let created = 0;
    for (const row of r.rows) {
      const actionKey = `repurchase:${row.customer_id}:${Date.now()}`;
      const useCoupon = Number(row.response_to_discount) > 0.4;
      await pool.query(
        `INSERT INTO growth_actions (action_key, action_type, status, store_id, title, detail, payload, created_by, tenant_id)
         VALUES ($1,'send_voucher','proposed',NULLIF($2,''),$3,$4,$5::jsonb,'agent_v2',$6)
         ON CONFLICT (action_key) DO NOTHING`,
        [actionKey, row.store_id,
         `复购唤醒-客户#${row.customer_id}`,
         `客户${row.phone}已${row.lifecycle_stage === 'churned' ? '流失' : '临近复购临界期'}，${useCoupon ? '建议发送优惠券' : '建议内容触达'}。最佳触达时间:${row.best_contact_window || '未设定'}`,
         JSON.stringify({ customer_id: row.customer_id, phone: row.phone, use_coupon: useCoupon, channel: 'wecom', strategy_key: 'repurchase_auto' }),
         repurchaseTenantId
        ]
      );
      created++;
    }
    return res.json({ ok: true, triggered: created, total_at_risk: r.rows.length });
  });

  app.get('/api/growth/wecom-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const config = await getWecomConfig(pool);
    return res.json({ ok: true, config });
  });

  app.post('/api/growth/wecom-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const corpId = cleanText(b.corp_id, 200);
    const corpSecret = cleanText(b.corp_secret, 500);
    const senderUserId = cleanText(b.sender_userid, 128);
    if (!corpId || !corpSecret || !senderUserId) return res.status(400).json({ ok: false, error: 'missing corp_id/corp_secret/sender_userid' });
    const config = {
      corp_id: corpId,
      corp_secret: corpSecret,
      sender_userid: senderUserId,
      agent_id: cleanText(b.agent_id, 64),
      callback_secret: cleanText(b.callback_secret, 500)
    };
    await pool.query(
      `INSERT INTO hrms_state (key, data, updated_at) VALUES ('growth_wecom_config', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(config)]
    );
    __growthWecomTokenCache = { token: '', expiresAt: 0 };
    return res.json({ ok: true, config });
  });

  app.post('/api/growth/wecom/callback', async (req, res) => {
    const config = await getWecomConfig(pool);
    const configuredSecret = cleanText(config?.callback_secret || process.env.GROWTH_WECOM_CALLBACK_SECRET || '', 500);
    const headerSecret = cleanText(req.headers['x-wecom-callback-secret'] || '', 500);
    if (configuredSecret && headerSecret !== configuredSecret) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const b = req.body || {};
    const providerMsgId = cleanText(b.provider_msg_id || b.msgid, 255);
    const eventType = cleanText(b.event_type || b.event || '', 80).toLowerCase();
    if (!providerMsgId || !eventType) return res.status(400).json({ ok: false, error: 'missing provider_msg_id or event_type' });
    const delivery = await pool.query(`SELECT * FROM growth_delivery_logs WHERE provider_msg_id = $1 ORDER BY created_at DESC LIMIT 1`, [providerMsgId]);
    const row = delivery.rows[0] || null;
    if (!row) return res.status(404).json({ ok: false, error: 'delivery_not_found' });
    const statusMap = { sent: 'sent', delivered: 'delivered', read: 'read', clicked: 'clicked', redeemed: 'redeemed' };
    const eventMap = {
      delivered: 'wecom_message_delivered',
      read: 'wecom_message_read',
      clicked: 'wecom_message_clicked',
      redeemed: 'wecom_coupon_redeemed'
    };
    const newStatus = statusMap[eventType] || 'received';
    await upsertDeliveryLog(pool, {
      delivery_key: row.delivery_key,
      action_key: row.action_key,
      rule_key: row.rule_key,
      customer_id: row.customer_id,
      store_id: row.store_id,
      channel: row.channel,
      external_userid: row.external_userid,
      provider_msg_id: providerMsgId,
      status: newStatus,
      payload: row.payload || {},
      result: Object.assign({}, row.result || {}, b)
    });
    if (eventMap[eventType]) {
      await insertGrowthEvent(pool, {
        event_type: eventMap[eventType],
        customer_id: row.customer_id,
        external_userid: row.external_userid,
        store_id: row.store_id,
        channel: row.channel,
        campaign_id: cleanText((row.payload || {}).campaign_id, 128),
        coupon_id: cleanText((row.payload || {}).coupon_id, 128),
        idempotency_key: `${eventMap[eventType]}:${providerMsgId}`,
        metadata: { provider_msg_id: providerMsgId, action_key: row.action_key, callback: b }
      });
    }
    return res.json({ ok: true, status: newStatus });
  });

  // ── Store WeCom config CRUD ──
  app.get('/api/growth/store-wecom-configs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const configs = await getAllStoreWecomConfigs(pool);
    return res.json({ ok: true, configs });
  });

  app.post('/api/growth/store-wecom-configs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeId = cleanText(b.store_id, 128);
    const corpId = cleanText(b.corp_id, 200);
    const corpSecret = cleanText(b.corp_secret, 500);
    const agentId = cleanText(b.agent_id, 64);
    const senderUserId = cleanText(b.sender_userid, 128);
    if (!storeId || !corpId || !corpSecret) return res.status(400).json({ ok: false, error: 'missing store_id/corp_id/corp_secret' });
    const tenantId = await resolveTenantIdForStore(pool, storeId);
    await pool.query(
      `INSERT INTO store_wecom_configs (store_id, corp_id, corp_secret, agent_id, sender_userid, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (store_id) DO UPDATE SET
         corp_id = EXCLUDED.corp_id, corp_secret = EXCLUDED.corp_secret,
         agent_id = EXCLUDED.agent_id, sender_userid = EXCLUDED.sender_userid,
         updated_at = NOW()`,
      [storeId, corpId, corpSecret, agentId, senderUserId, tenantId]
    );
    delete __storeWecomTokenCaches[storeId];
    return res.json({ ok: true });
  });

  app.delete('/api/growth/store-wecom-configs/:storeId', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.params.storeId, 128);
    await pool.query('DELETE FROM store_wecom_configs WHERE store_id = $1', [storeId]);
    delete __storeWecomTokenCaches[storeId];
    return res.json({ ok: true });
  });

  // ── WeCom contact auto-sync from store configs ──
  async function syncWecomContactsForStore(pool, storeConfig) {
    try {
      const storeId = storeConfig.store_id;
      const token = await getWecomAccessToken(pool, storeId);
      const listResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/list?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(storeConfig.sender_userid || '')}`, { method: 'GET' });
      const listData = await listResp.json();
      if (Number(listData?.errcode) !== 0 || !Array.isArray(listData?.external_userid)) {
        console.warn(`[wecom] list contacts failed for store=${storeId}:`, listData?.errmsg);
        return 0;
      }
      const eids = listData.external_userid.filter(Boolean);
      const tenantId = await resolveTenantIdForStore(pool, storeId);
      let synced = 0;
      for (const eid of eids) {
        const detailResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/get?access_token=${encodeURIComponent(token)}&external_userid=${encodeURIComponent(eid)}`, { method: 'GET' });
        const detailData = await detailResp.json();
        if (Number(detailData?.errcode) !== 0 || !detailData?.external_contact) continue;
        const c = detailData.external_contact;
        const phone = (c.corpid || c.corp_name || ''); // fallback, try from other fields
        const externalUserid = cleanText(c.external_userid || eid, 128);
        const name = cleanText(c.name || '', 128);
        let contactPhone = '';
        if (Array.isArray(detailData.follow_info) && detailData.follow_info.length) {
          const fi = detailData.follow_info[0];
          if (fi.description) {
            const m = fi.description.match(/1[3-9]\d{9}/);
            if (m) contactPhone = m[0];
          }
          if (!contactPhone && fi.tag_id && Array.isArray(fi.tag_id)) {
          }
        }
        if (Array.isArray(detailData.wechat_channels)) {
          const wc = detailData.wechat_channels.find(ch => ch.phone);
          if (wc) contactPhone = wc.phone;
        }
        await pool.query(
          `INSERT INTO wechat_work_customers (external_userid, name, phone, store_id, bind_customer_id, tenant_id)
           VALUES ($1,$2,NULLIF($3,''),$4,NULL,$5)
           ON CONFLICT (external_userid) WHERE external_userid IS NOT NULL AND external_userid <> '' DO UPDATE SET
             name = COALESCE(NULLIF(EXCLUDED.name,''), wechat_work_customers.name),
             phone = COALESCE(NULLIF(EXCLUDED.phone,''), wechat_work_customers.phone),
             store_id = COALESCE(NULLIF(EXCLUDED.store_id,''), wechat_work_customers.store_id),
             updated_at = NOW()`,
          [externalUserid, name, contactPhone, storeId, tenantId]
        );
        if (contactPhone) {
          await pool.query(
            `UPDATE wechat_work_customers SET bind_customer_id = (
              SELECT id FROM growth_customers WHERE phone = $1 LIMIT 1
            ), updated_at = NOW()
            WHERE external_userid = $2 AND bind_customer_id IS NULL`,
            [contactPhone, externalUserid]
          );
        }
        synced++;
      }
      return synced;
    } catch (e) {
      console.warn(`[wecom] sync contacts failed for store=${storeConfig.store_id}:`, e?.message);
      return 0;
    }
  }

  app.post('/api/growth/sync-wecom-contacts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.body?.store_id, 128);
    let configs;
    if (storeId) {
      const cfg = await getStoreWecomConfig(pool, storeId);
      configs = cfg ? [cfg] : [];
    } else {
      configs = await getAllStoreWecomConfigs(pool);
    }
    const results = [];
    for (const cfg of configs) {
      const synced = await syncWecomContactsForStore(pool, cfg);
      results.push({ store_id: cfg.store_id, synced });
    }
    return res.json({ ok: true, results, total: results.reduce((s, r) => s + r.synced, 0) });
  });

  // ── Phase 2: Feishu config persistence for WeChat customer auto-sync ──
  app.get('/api/growth/feishu-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT data FROM hrms_state WHERE key = 'growth_feishu_config' LIMIT 1`);
    const config = r.rows?.[0]?.data || null;
    res.json({ ok: true, config });
  });

  app.post('/api/growth/feishu-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const appToken = cleanText(b.app_token, 200);
    const tableId = cleanText(b.table_id, 200);
    if (!appToken || !tableId) return res.status(400).json({ ok: false, error: 'missing app_token or table_id' });
    await pool.query(
      `INSERT INTO hrms_state (key, data, updated_at) VALUES ('growth_feishu_config', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify({ app_token: appToken, table_id: tableId })]
    );
    res.json({ ok: true, config: { app_token: appToken, table_id: tableId } });
  });

  // ── Phase 6: User clustering (simplified, indexed) ──
  app.get('/api/growth/user-clusters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const r = await pool.query(
      `SELECT lifecycle_stage,
         ROUND(AVG(price_sensitivity)::numeric, 2) AS avg_price_sens,
         ROUND(AVG(response_to_discount)::numeric, 2) AS avg_discount_resp,
         ROUND(AVG(adventurous_score)::numeric, 2) AS avg_adventurous,
         COUNT(*)::int AS user_count,
         COALESCE(MODE() WITHIN GROUP (ORDER BY preferred_visit_time), '') AS common_visit_time
       FROM growth_customer_profiles
       WHERE ($1='' OR store_id=$1)
       GROUP BY lifecycle_stage
       ORDER BY user_count DESC
       LIMIT 20`,
      [storeId]
    );
    return res.json({ ok: true, clusters: r.rows, total: r.rows.reduce((s, r) => s + Number(r.user_count), 0) });
  });

  if (!globalThis.__growthTouchRuleTimer) {
    globalThis.__growthTouchRuleTimer = setInterval(() => {
      runTouchRuleEngine(pool, { limit_per_rule: 5000 }).catch((e) => console.warn('[growth] rule engine run failed:', e?.message));
    }, 15 * 60 * 1000);
    setTimeout(() => {
      runTouchRuleEngine(pool, { limit_per_rule: 5000 }).catch((e) => console.warn('[growth] initial rule engine run failed:', e?.message));
    }, 10000);
  }

  if (!globalThis.__wecomContactSyncTimer) {
    globalThis.__wecomContactSyncTimer = setInterval(async () => {
      try {
        const configs = await getAllStoreWecomConfigs(pool);
        for (const cfg of configs) {
          await syncWecomContactsForStore(pool, cfg);
        }
      } catch (e) {
        console.warn('[growth] wecom contact sync failed:', e?.message);
      }
    }, 6 * 60 * 60 * 1000);
    setTimeout(async () => {
      try {
        const configs = await getAllStoreWecomConfigs(pool);
        for (const cfg of configs) {
          await syncWecomContactsForStore(pool, cfg);
        }
      } catch (e) {
        console.warn('[growth] initial wecom contact sync failed:', e?.message);
      }
    }, 30000);
  }

  app.post('/api/growth/generate-selling-point', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const agentResp = await fetch((process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101') + '/api/growth/generate-selling-point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: req.body?.title || '', offer: req.body?.offer || '', store: req.body?.store || '' })
      });
      const data = await agentResp.json();
      return res.json({ ok: true, selling_point: data?.selling_point || '限时优惠，到店即享' });
    } catch (e) {
      return res.json({ ok: true, selling_point: '限时优惠，到店即享' });
    }
  });

  // 手动触发日报（POST /api/growth/daily-report/send）
  app.post('/api/growth/daily-report/send', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const targetDate = cleanText(req.body?.date || '', 20) || null;
      const msg = await buildGrowthDailyReport(pool, targetDate);
      if (_sendGrowthAlert) {
        const result = await _sendGrowthAlert(msg, 'growth_daily_report');
        return res.json({ ok: true, report: msg, feishu: result });
      }
      return res.json({ ok: true, report: msg, feishu: null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 预览日报不发送（GET /api/growth/daily-report/preview）
  app.get('/api/growth/daily-report/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const targetDate = cleanText(req.query?.date || '', 20) || null;
      const msg = await buildGrowthDailyReport(pool, targetDate);
      return res.json({ ok: true, report: msg });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // content_performance CRUD
  app.get('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const r = await pool.query(
      `SELECT * FROM content_performance
       WHERE ($1='' OR store_code=$1 OR store_id=$1)
         AND content_date >= CURRENT_DATE - ($2 || ' days')::interval
       ORDER BY content_date DESC, id DESC LIMIT 200`,
      [storeId, days]
    );
    return res.json({ ok: true, records: r.rows });
  });

  app.post('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeCode = cleanText(b.store_id || b.store_code || '', 128);
    const channel = cleanText(b.channel || '', 64);
    const platform = cleanText(b.platform || b.content_type || '', 64);
    const contentTitle = cleanText(b.content_title || b.dish_name || '', 255);
    const contentDate = cleanText(b.record_date || b.content_date || fmtYmd(new Date()), 32);
    const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));
    if (!channel) return res.status(400).json({ ok: false, error: 'channel required' });
    const r = await pool.query(
      `INSERT INTO content_performance
         (content_date, channel, store_code, store_id, platform, content_type, content_title, dish_name,
          impressions, clicks, likes, saves, comments, shares, new_followers, orders, notes, created_by)
       VALUES ($1,$2,$3,$3,$4,$4,$5,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [contentDate, channel, storeCode, platform, contentTitle,
       toInt(b.impressions), toInt(b.clicks), toInt(b.likes),
       toInt(b.comments), toInt(b.shares), toInt(b.new_followers), toInt(b.conversions),
       cleanText(b.notes || '', 500), cleanText(b.operator_username || 'manual', 64)]
    );
    return res.json({ ok: true, record: r.rows[0] });
  });

  app.delete('/api/growth/content-performance/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid id' });
    await pool.query(`DELETE FROM content_performance WHERE id=$1`, [id]);
    return res.json({ ok: true });
  });

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
            const msg = await buildGrowthDailyReport(pool);
            await _sendGrowthAlert(msg, 'growth_daily_report');
          }
        } catch (e) {
          console.warn('[growth] daily report failed:', e?.message);
        }
        scheduleDailyReport();
      }, delay);
    }
    scheduleDailyReport();
  }
}
