-- 153: growth/marketing tables extracted from ensureGrowthTables (growth-api.js)
-- Idempotent: IF NOT EXISTS throughout; safe on prod that already has these objects.

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_svm_store_consume ON growth_stored_value_members (store_id, last_consume_date);

CREATE INDEX IF NOT EXISTS idx_growth_svm_phone ON growth_stored_value_members (phone);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_campaign_jobs_status ON growth_campaign_jobs (status, created_at);

ALTER TABLE growth_campaign_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'winback';

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
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_customers_phone ON growth_customers (phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_customers_openid ON growth_customers (openid) WHERE openid IS NOT NULL AND openid <> '';

CREATE INDEX IF NOT EXISTS idx_growth_customers_last_store ON growth_customers (last_store_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS customer_identities (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES growth_customers(id) ON DELETE CASCADE,
      identity_type TEXT NOT NULL,
      identity_value TEXT NOT NULL,
      source TEXT DEFAULT 'miniprogram',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(identity_type, identity_value)
    );

CREATE INDEX IF NOT EXISTS idx_customer_identities_customer ON customer_identities (customer_id);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_campaigns_store ON growth_campaigns (store_id, created_at DESC);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_events_type_time ON growth_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_events_campaign ON growth_events (campaign_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_events_store ON growth_events (store_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_events_customer ON growth_events (customer_id, occurred_at DESC);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_redemptions_campaign ON growth_redemptions (campaign_id, redeemed_at DESC);

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
    );

ALTER TABLE growth_daily_metrics ADD COLUMN IF NOT EXISTS coupon_claimed_count INTEGER DEFAULT 0;

ALTER TABLE growth_daily_metrics ADD COLUMN IF NOT EXISTS coupon_purchased_count INTEGER DEFAULT 0;

ALTER TABLE growth_daily_metrics ADD COLUMN IF NOT EXISTS marketing_triggered_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_growth_daily_metrics_date ON growth_daily_metrics (metric_date DESC, store_id, campaign_id);

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
    );

ALTER TABLE growth_alerts ADD COLUMN IF NOT EXISTS resolved_by TEXT;

CREATE INDEX IF NOT EXISTS idx_growth_alerts_status ON growth_alerts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS growth_sms_suppression (
      phone TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS growth_holdout_members (
      phone TEXT NOT NULL,
      campaign_key TEXT NOT NULL,
      store_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (phone, campaign_key)
    );

CREATE TABLE IF NOT EXISTS cn_holiday_calendar (
      day DATE PRIMARY KEY,
      day_type TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

CREATE TABLE IF NOT EXISTS growth_segment_members (
      phone TEXT NOT NULL,
      segment_key TEXT NOT NULL,
      store_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (phone, segment_key)
    );

CREATE INDEX IF NOT EXISTS idx_growth_segment_key ON growth_segment_members (segment_key);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_actions_status ON growth_actions (status, created_at DESC);

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
    );

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_store ON growth_customer_profiles (store_id, lifecycle_stage);

CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_updated ON growth_customer_profiles (updated_at DESC);

ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS value_tier TEXT DEFAULT 'low';

ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS price_sensitive BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_tier ON growth_customer_profiles (store_id, value_tier);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_customer ON growth_profile_signals (customer_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_type ON growth_profile_signals (signal_type, signal_key, occurred_at DESC);

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
    );

CREATE INDEX IF NOT EXISTS idx_store_marketing_constraints_active ON store_marketing_constraints (active, updated_at DESC);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_execution_logs_action ON growth_execution_logs (action_key, created_at DESC);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_touch_rules_enabled ON growth_touch_rules (enabled, priority ASC, updated_at DESC);

ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS owner TEXT;

ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS approved_by TEXT;

ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

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
    );

CREATE INDEX IF NOT EXISTS idx_marketing_payment_rules_active ON marketing_payment_rules (active, store_id, priority ASC);

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
    );

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_action ON growth_delivery_logs (action_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_msg ON growth_delivery_logs (provider_msg_id, created_at DESC);

ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';

ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS campaign_id TEXT;

ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS coupon_id TEXT;

ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_campaign ON growth_delivery_logs (tenant_id, campaign_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_rule_phone_status ON growth_delivery_logs (rule_key, status, (payload->>'phone'));

CREATE TABLE IF NOT EXISTS store_wecom_configs (
      id BIGSERIAL PRIMARY KEY,
      store_id TEXT UNIQUE NOT NULL,
      corp_id TEXT NOT NULL,
      corp_secret TEXT NOT NULL,
      agent_id TEXT DEFAULT '',
      sender_userid TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

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
    );

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
    );

CREATE INDEX IF NOT EXISTS idx_public_promo_tasks_status ON public_promo_tasks (status, due_at, created_at DESC);

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
    );

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
    );

ALTER TABLE poster_templates ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE poster_templates ADD COLUMN IF NOT EXISTS purposes TEXT[] DEFAULT '{}'::text[];

ALTER TABLE poster_templates ADD COLUMN IF NOT EXISTS channels TEXT[] DEFAULT '{}'::text[];

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
    );

ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS purposes TEXT[] DEFAULT '{}'::text[];

ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS channels TEXT[] DEFAULT '{}'::text[];

ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';

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
    );

CREATE INDEX IF NOT EXISTS idx_content_performance_date ON content_performance (content_date DESC, store_code);

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0;

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0;

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS new_followers INTEGER DEFAULT 0;

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS store_id TEXT;

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS content_title TEXT;

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS platform TEXT;
