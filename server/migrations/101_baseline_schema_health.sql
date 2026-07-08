-- Baseline schema health repair.
-- Purpose: allow empty, old, and test databases to boot without historical
-- missing table / missing column warnings from legacy modules.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agent_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key varchar(120) NOT NULL,
  agent_id varchar(50) NOT NULL,
  name varchar(120) NOT NULL,
  content text NOT NULL,
  enabled boolean DEFAULT true,
  is_builtin boolean DEFAULT false,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT current_timestamp,
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE agent_prompt_templates ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE agent_prompt_templates ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT current_timestamp;
ALTER TABLE agent_prompt_templates ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT current_timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS agent_prompt_templates_template_key_tenant_idx
  ON agent_prompt_templates (template_key, tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_templates_tenant ON agent_prompt_templates (tenant_id);

CREATE TABLE IF NOT EXISTS agent_reply_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key varchar(120) NOT NULL,
  agent_id varchar(50) NOT NULL,
  name varchar(120) NOT NULL,
  content text NOT NULL,
  enabled boolean DEFAULT true,
  is_builtin boolean DEFAULT false,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT current_timestamp,
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE agent_reply_templates ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE agent_reply_templates ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT current_timestamp;
ALTER TABLE agent_reply_templates ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT current_timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS agent_reply_templates_template_key_tenant_idx
  ON agent_reply_templates (template_key, tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_reply_templates_tenant ON agent_reply_templates (tenant_id);

CREATE TABLE IF NOT EXISTS agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id varchar(50) NOT NULL,
  name varchar(100) NOT NULL,
  description text,
  system_prompt text,
  model_name varchar(50) DEFAULT 'qwen-plus',
  temperature decimal(3,2) DEFAULT 0.1,
  enabled boolean DEFAULT true,
  schedule_interval int DEFAULT 30,
  prompt_template_id uuid,
  reply_template_id uuid,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS prompt_template_id uuid;
ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS reply_template_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS agent_configs_agent_tenant_idx ON agent_configs (agent_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_tenant ON agent_configs (tenant_id);

CREATE TABLE IF NOT EXISTS feishu_pending_replies (
  open_id text NOT NULL,
  task_id text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE feishu_pending_replies ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_pending_replies_tenant ON feishu_pending_replies (tenant_id);

CREATE TABLE IF NOT EXISTS feishu_pending_pllm_decisions (
  open_id text NOT NULL,
  task_id text NOT NULL DEFAULT '',
  decision text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE feishu_pending_pllm_decisions ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_pending_pllm_decisions_tenant ON feishu_pending_pllm_decisions (tenant_id);

CREATE TABLE IF NOT EXISTS agent_v2_data_alert_dedupe (
  dedupe_key varchar(320) NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  tenant_id varchar(80) NOT NULL DEFAULT 'default'
);

ALTER TABLE agent_v2_data_alert_dedupe ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_data_alert_dedupe_tenant ON agent_v2_data_alert_dedupe (tenant_id);

CREATE TABLE IF NOT EXISTS agent_v2_morning_briefing_sends (
  id bigserial PRIMARY KEY,
  run_ymd text NOT NULL,
  username text NOT NULL,
  scope text NOT NULL,
  ok boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_v2_morning_briefing_sends ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_morning_briefing_sends_tenant ON agent_v2_morning_briefing_sends (tenant_id);

CREATE TABLE IF NOT EXISTS agent_v2_scheduled_report_sends (
  id bigserial PRIMARY KEY,
  job_key text NOT NULL,
  run_ymd text NOT NULL,
  username text NOT NULL,
  scope text NOT NULL,
  ok boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_v2_scheduled_report_sends ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_scheduled_report_sends_tenant ON agent_v2_scheduled_report_sends (tenant_id);

CREATE TABLE IF NOT EXISTS customer_identities (
  id bigserial PRIMARY KEY,
  customer_id bigint,
  identity_type text NOT NULL,
  identity_value text NOT NULL,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE customer_identities ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_customer_identities_tenant ON customer_identities (tenant_id);

CREATE TABLE IF NOT EXISTS user_reads (
  username varchar(100) NOT NULL,
  module varchar(100) NOT NULL,
  item_key varchar(255) NOT NULL,
  read_at timestamp DEFAULT current_timestamp,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  PRIMARY KEY (username, module, item_key, tenant_id)
);

ALTER TABLE user_reads ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE user_reads ADD COLUMN IF NOT EXISTS read_at timestamp DEFAULT current_timestamp;
CREATE INDEX IF NOT EXISTS idx_user_reads_tenant ON user_reads (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_reads_username_module ON user_reads (username, module);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(100) UNIQUE NOT NULL,
  password_hash varchar(255) DEFAULT '',
  real_name varchar(120) DEFAULT '',
  email varchar(120),
  phone varchar(40),
  role varchar(80) NOT NULL DEFAULT 'store_employee',
  department varchar(80),
  position varchar(80),
  is_active boolean DEFAULT true,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT current_timestamp,
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar(255) DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name varchar(120) DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(80) DEFAULT 'store_employee';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);

CREATE TABLE IF NOT EXISTS agent_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category varchar(100) NOT NULL,
  assignee_role varchar(100) NOT NULL,
  normal_deduction int DEFAULT 10,
  major_deduction int DEFAULT 20,
  enabled boolean DEFAULT true,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE agent_rules ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE agent_rules ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT current_timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS agent_rules_category_tenant_idx ON agent_rules (category, tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_rules_tenant ON agent_rules (tenant_id);

CREATE TABLE IF NOT EXISTS hr_rating_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key varchar(80) NOT NULL,
  config jsonb NOT NULL,
  enabled boolean DEFAULT true,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE hr_rating_configs ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE hr_rating_configs ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT current_timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS hr_rating_configs_key_tenant_idx ON hr_rating_configs (config_key, tenant_id);
CREATE INDEX IF NOT EXISTS idx_hr_rating_configs_tenant ON hr_rating_configs (tenant_id);

CREATE TABLE IF NOT EXISTS daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  store varchar(200) NOT NULL DEFAULT '',
  brand varchar(120) NOT NULL DEFAULT '',
  date date NOT NULL DEFAULT current_date,
  dine_orders integer DEFAULT 0,
  actual_revenue numeric(12,2) DEFAULT 0,
  target_revenue numeric(12,2) DEFAULT 0,
  actual_margin numeric(5,2),
  target_margin numeric(5,2),
  dianping_rating numeric(3,2),
  submitted boolean DEFAULT false,
  submitted_at timestamp,
  created_at timestamp DEFAULT current_timestamp,
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS store varchar(200) NOT NULL DEFAULT '';
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS brand varchar(120) NOT NULL DEFAULT '';
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS date date NOT NULL DEFAULT current_date;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS actual_revenue numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS pre_discount_revenue numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS total_discount numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS target_revenue numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS dine_orders integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS dine_revenue numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS dine_traffic integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS efficiency numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS labor_total numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS actual_margin numeric(5,2);
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS target_margin numeric(5,2);
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS gross_profit numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS dianping_rating numeric(3,2);
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS new_wechat_members integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS wechat_month_total integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS private_room_uses integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS operational_anomaly_note text;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS delivery_pre_revenue numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS delivery_actual numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS delivery_orders integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS delivery_bad_reviews integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS budget numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS budget_rate numeric(8,4) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS recharge_count integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS recharge_amount numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS weather text;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS segments jsonb DEFAULT '{"noon":0,"afternoon":0,"night":0}'::jsonb;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS discount_dine numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS discount_delivery numeric(12,2) DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS categories jsonb DEFAULT '{}'::jsonb;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS delivery_detail jsonb;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS bad_reviews_dianping integer DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS staff jsonb;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS schedule_next_day jsonb;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT '[]'::jsonb;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS holiday_switch boolean DEFAULT false;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS submitted boolean DEFAULT false;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS submitted_at timestamp;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT current_timestamp;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT current_timestamp;
CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant ON daily_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_store_date ON daily_reports (store, date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant_store_date ON daily_reports (tenant_id, store, date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports (date);

CREATE TABLE IF NOT EXISTS generated_posters (
  id bigserial PRIMARY KEY,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  poster_key text,
  campaign_id text,
  store_id text,
  template_key text,
  title text,
  subtitle text,
  cta text,
  image_url text,
  output_url text,
  purposes text[] DEFAULT '{}'::text[],
  channels text[] DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'draft',
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS store_id text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS template_key text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS subtitle text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS cta text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS output_url text;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS purposes text[] DEFAULT '{}'::text[];
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS channels text[] DEFAULT '{}'::text[];
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS generated_posters_poster_key_tenant_idx
  ON generated_posters (poster_key, tenant_id) WHERE poster_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generated_posters_tenant ON generated_posters (tenant_id);
CREATE INDEX IF NOT EXISTS idx_generated_posters_store ON generated_posters (tenant_id, store_id);

CREATE TABLE IF NOT EXISTS content_performance (
  id bigserial PRIMARY KEY,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  content_date date NOT NULL DEFAULT current_date,
  channel text NOT NULL DEFAULT '',
  store_code text,
  store_id text,
  content_type text NOT NULL DEFAULT '',
  variant_tag text DEFAULT 'A',
  dish_name text DEFAULT '',
  content_title text,
  platform text,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  likes integer DEFAULT 0,
  comments integer DEFAULT 0,
  shares integer DEFAULT 0,
  saves integer DEFAULT 0,
  orders integer DEFAULT 0,
  new_followers integer DEFAULT 0,
  notes text DEFAULT '',
  created_by text DEFAULT 'manual',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS content_date date NOT NULL DEFAULT current_date;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT '';
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS store_code text;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS store_id text;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT '';
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS variant_tag text DEFAULT 'A';
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS dish_name text DEFAULT '';
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS content_title text;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS impressions integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS clicks integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS likes integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS comments integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS shares integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS saves integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS orders integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS new_followers integer DEFAULT 0;
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS created_by text DEFAULT 'manual';
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_content_performance_date ON content_performance (content_date DESC, store_code);
CREATE INDEX IF NOT EXISTS idx_content_performance_tenant ON content_performance (tenant_id);

CREATE TABLE IF NOT EXISTS store_name_aliases (
  id bigserial PRIMARY KEY,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  canonical_name varchar(200) NOT NULL,
  alias_name varchar(200) NOT NULL,
  source varchar(40) DEFAULT 'manual',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_name_aliases_scope_idx ON store_name_aliases (tenant_id, alias_name);
CREATE INDEX IF NOT EXISTS idx_store_name_aliases_lookup ON store_name_aliases (tenant_id, alias_name) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_store_name_aliases_canonical ON store_name_aliases (tenant_id, canonical_name) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction varchar(10) NOT NULL DEFAULT 'in',
  channel varchar(30) NOT NULL DEFAULT 'feishu',
  feishu_open_id varchar(200),
  sender_username varchar(200),
  sender_name varchar(200),
  sender_role varchar(60),
  routed_to varchar(60),
  content_type varchar(30) NOT NULL DEFAULT 'text',
  content text,
  image_urls jsonb DEFAULT '[]'::jsonb,
  agent_response text,
  agent_data jsonb DEFAULT '{}'::jsonb,
  feishu_message_id varchar(200),
  record_id varchar(200),
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  updated_at timestamp DEFAULT current_timestamp,
  created_at timestamp DEFAULT current_timestamp
);

ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS record_id varchar(200);
ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT current_timestamp;
CREATE INDEX IF NOT EXISTS idx_agent_messages_tenant ON agent_messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_record_id ON agent_messages (record_id) WHERE record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_record_content_uniq
  ON agent_messages (record_id, content_type) WHERE record_id IS NOT NULL AND record_id != '';

CREATE TABLE IF NOT EXISTS business_entity_relations (
  id bigserial PRIMARY KEY,
  source_type text NOT NULL DEFAULT '',
  source_id text NOT NULL DEFAULT '',
  source_label text,
  target_type text NOT NULL DEFAULT '',
  target_id text NOT NULL DEFAULT '',
  target_label text,
  relation text NOT NULL DEFAULT '',
  weight numeric DEFAULT 1,
  metadata jsonb DEFAULT '{}'::jsonb,
  date date DEFAULT current_date,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE business_entity_relations ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_business_entity_relations_tenant ON business_entity_relations (tenant_id);

CREATE TABLE IF NOT EXISTS entity_health_snapshot (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL DEFAULT '',
  entity_id text NOT NULL DEFAULT '',
  entity_label text,
  health_score numeric DEFAULT 0,
  dimensions jsonb DEFAULT '{}'::jsonb,
  snapshot_date date NOT NULL DEFAULT current_date,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE entity_health_snapshot ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_entity_health_snapshot_tenant ON entity_health_snapshot (tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_entity_health_day'
  ) THEN
    ALTER TABLE entity_health_snapshot
      ADD CONSTRAINT uq_entity_health_day UNIQUE (entity_type, entity_id, snapshot_date, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent varchar(60) NOT NULL DEFAULT '',
  brand varchar(120),
  store varchar(200),
  category varchar(120),
  severity varchar(20) NOT NULL DEFAULT 'medium',
  title varchar(500) NOT NULL DEFAULT '',
  detail text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(30) NOT NULL DEFAULT 'open',
  assignee_username varchar(100),
  resolved_at timestamp,
  resolution text,
  feishu_notified boolean DEFAULT false,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT current_timestamp,
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE agent_issues ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE agent_issues ADD COLUMN IF NOT EXISTS feishu_notified boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_agent_issues_tenant ON agent_issues (tenant_id);

CREATE TABLE IF NOT EXISTS agent_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand varchar(120) NOT NULL DEFAULT '',
  store varchar(200) NOT NULL DEFAULT '',
  username varchar(100) NOT NULL DEFAULT '',
  name varchar(200),
  role varchar(60),
  period varchar(20) NOT NULL DEFAULT '',
  score_model varchar(60),
  base_score numeric(5,1) NOT NULL DEFAULT 100,
  total_score numeric(5,1) NOT NULL DEFAULT 100,
  additions jsonb NOT NULL DEFAULT '[]'::jsonb,
  deductions jsonb NOT NULL DEFAULT '[]'::jsonb,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  feishu_notified boolean DEFAULT false,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT current_timestamp,
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS brand varchar(120) NOT NULL DEFAULT '';
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS store varchar(200) NOT NULL DEFAULT '';
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS username varchar(100) NOT NULL DEFAULT '';
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS name varchar(200);
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS role varchar(60);
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS period varchar(20) NOT NULL DEFAULT '';
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS score_model varchar(60);
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS base_score numeric(5,1) NOT NULL DEFAULT 100;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS total_score numeric(5,1) NOT NULL DEFAULT 100;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS additions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS deductions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS feishu_notified boolean DEFAULT false;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT current_timestamp;
ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT current_timestamp;
CREATE INDEX IF NOT EXISTS idx_agent_scores_tenant ON agent_scores (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_scores_user ON agent_scores (username, period);

CREATE TABLE IF NOT EXISTS agent_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text NOT NULL DEFAULT '',
  notification_type text NOT NULL DEFAULT '',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_status boolean DEFAULT false,
  read_at timestamp,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT now()
);

ALTER TABLE agent_notifications ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_notifications_tenant ON agent_notifications (tenant_id);

CREATE TABLE IF NOT EXISTS bad_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date,
  store text,
  brand text,
  review_type text,
  content text,
  product_name text,
  service_item text,
  rating numeric,
  platform text,
  order_id text,
  customer_name text,
  has_detailed_event boolean DEFAULT false,
  event_detail text,
  sop_case_id uuid,
  status text DEFAULT 'open',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bad_reviews ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE bad_reviews ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_bad_reviews_tenant ON bad_reviews (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bad_reviews_status ON bad_reviews (status);

CREATE TABLE IF NOT EXISTS sop_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  source_review_id uuid,
  store text NOT NULL DEFAULT '',
  brand text,
  event_detail text NOT NULL DEFAULT '',
  analysis text,
  improvement_actions text,
  created_by text,
  confirmed_by text,
  confirmed_at timestamptz,
  published_at timestamptz,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sop_cases ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE sop_cases ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_sop_cases_tenant ON sop_cases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sop_cases_store ON sop_cases (store);
CREATE INDEX IF NOT EXISTS idx_sop_cases_status ON sop_cases (status);

CREATE TABLE IF NOT EXISTS training_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text UNIQUE NOT NULL,
  type text NOT NULL DEFAULT 'general',
  title text NOT NULL DEFAULT '',
  target_role text NOT NULL DEFAULT '',
  assignee_username text NOT NULL DEFAULT '',
  store text NOT NULL DEFAULT '',
  brand text,
  status text NOT NULL DEFAULT 'pending',
  progress_data jsonb DEFAULT '{}'::jsonb,
  due_date date,
  completed_at timestamptz,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE training_tasks ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE training_tasks ADD COLUMN IF NOT EXISTS progress_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE training_tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_training_tasks_tenant ON training_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_tasks_assignee ON training_tasks (assignee_username, status);
CREATE INDEX IF NOT EXISTS idx_training_tasks_role ON training_tasks (target_role);

CREATE TABLE IF NOT EXISTS agent_autonomous_logs (
  id serial PRIMARY KEY,
  task_id text NOT NULL,
  status text NOT NULL,
  result jsonb,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_autonomous_logs ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_autonomous_logs_tenant ON agent_autonomous_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_logs_task ON agent_autonomous_logs (task_id, created_at);

CREATE TABLE IF NOT EXISTS feishu_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  open_id text,
  username text,
  name text,
  mobile text,
  store text,
  role text,
  registered boolean DEFAULT false,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE feishu_users ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_users_tenant ON feishu_users (tenant_id);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  category varchar(50),
  tags text[] DEFAULT '{}'::text[],
  file_path varchar(255),
  file_type varchar(50),
  file_size integer,
  access_roles text[] DEFAULT '{}'::text[],
  access_departments text[] DEFAULT '{}'::text[],
  created_by uuid,
  scope varchar(20) DEFAULT 'public',
  version varchar(50),
  audience jsonb DEFAULT '{"type":"all"}'::jsonb,
  group_id uuid,
  group_name varchar(120),
  ai_explanation text,
  ai_explanation_locked boolean DEFAULT false,
  step_rubric jsonb DEFAULT '{}'::jsonb,
  content_chunks jsonb DEFAULT '[]'::jsonb,
  enabled boolean DEFAULT true,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT current_timestamp,
  updated_at timestamp DEFAULT current_timestamp
);

ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS scope varchar(20) DEFAULT 'public';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS version varchar(50);
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS audience jsonb DEFAULT '{"type":"all"}'::jsonb;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS group_id uuid;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS group_name varchar(120);
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS ai_explanation text;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS ai_explanation_locked boolean DEFAULT false;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS step_rubric jsonb DEFAULT '{}'::jsonb;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS content_chunks jsonb DEFAULT '[]'::jsonb;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tenant ON knowledge_base (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_scope ON knowledge_base (scope);

CREATE TABLE IF NOT EXISTS growth_customers (
  id bigserial PRIMARY KEY,
  phone text,
  openid text,
  external_userid text,
  first_store_id text,
  last_store_id text,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  meta jsonb DEFAULT '{}'::jsonb,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE growth_customers ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE growth_customers ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;
ALTER TABLE growth_customers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE growth_customers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_growth_customers_tenant ON growth_customers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_growth_customers_last_store ON growth_customers (last_store_id, last_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS growth_customers_phone_tenant_idx
  ON growth_customers (phone, tenant_id) WHERE phone IS NOT NULL AND phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS growth_customers_openid_tenant_idx
  ON growth_customers (openid, tenant_id) WHERE openid IS NOT NULL AND openid <> '';

CREATE TABLE IF NOT EXISTS growth_touch_rules (
  id bigserial PRIMARY KEY,
  rule_key text NOT NULL,
  name text NOT NULL,
  enabled boolean DEFAULT true,
  priority integer DEFAULT 100,
  auto_execute boolean DEFAULT true,
  criteria jsonb DEFAULT '{}'::jsonb,
  action_type text NOT NULL DEFAULT 'send_message',
  action_payload jsonb DEFAULT '{}'::jsonb,
  owner text,
  note text,
  approved_by text,
  approved_at timestamptz,
  last_run_at timestamptz,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS owner text;
ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS last_run_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS growth_touch_rules_rule_tenant_idx ON growth_touch_rules (rule_key, tenant_id);
CREATE INDEX IF NOT EXISTS idx_growth_touch_rules_tenant ON growth_touch_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_growth_touch_rules_enabled ON growth_touch_rules (enabled, priority ASC, updated_at DESC);

CREATE TABLE IF NOT EXISTS growth_segment_members (
  phone text NOT NULL,
  segment_key text NOT NULL,
  store_id text,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE growth_segment_members ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE growth_segment_members ADD COLUMN IF NOT EXISTS store_id text;
ALTER TABLE growth_segment_members ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_growth_segment_members_tenant ON growth_segment_members (tenant_id);
CREATE INDEX IF NOT EXISTS idx_growth_segment_key ON growth_segment_members (segment_key);

CREATE TABLE IF NOT EXISTS growth_customer_profiles (
  id bigserial PRIMARY KEY,
  customer_id bigint,
  phone text,
  openid text,
  store_id text,
  brand text,
  lifecycle_stage text DEFAULT 'new',
  value_tier text DEFAULT 'low',
  pos_order_count integer DEFAULT 0,
  pos_total_amount numeric DEFAULT 0,
  pos_avg_check numeric DEFAULT 0,
  source_signals jsonb DEFAULT '{}'::jsonb,
  semantic_tags jsonb DEFAULT '[]'::jsonb,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS value_tier text DEFAULT 'low';
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS pos_order_count integer DEFAULT 0;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS pos_total_spend numeric DEFAULT 0;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS pos_total_amount numeric DEFAULT 0;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS pos_avg_check numeric DEFAULT 0;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS avg_check numeric DEFAULT 0;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS pos_dine_in_ratio numeric DEFAULT 0;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS pos_last_order_at timestamptz;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS visit_interval_days numeric;
ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS favorite_dishes jsonb DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_tenant ON growth_customer_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_pos ON growth_customer_profiles (pos_order_count DESC) WHERE pos_order_count > 0;
CREATE UNIQUE INDEX IF NOT EXISTS growth_customer_profiles_customer_tenant_idx ON growth_customer_profiles (customer_id, tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'growth_customer_profiles_customer_tenant_key'
  ) THEN
    ALTER TABLE growth_customer_profiles
      ADD CONSTRAINT growth_customer_profiles_customer_tenant_key UNIQUE (customer_id, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS regression_check_results (
  id bigserial PRIMARY KEY,
  check_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed boolean DEFAULT false,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE regression_check_results ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_regression_check_results_tenant ON regression_check_results (tenant_id);
CREATE INDEX IF NOT EXISTS idx_regression_check_time ON regression_check_results (created_at);

CREATE TABLE IF NOT EXISTS daily_report_attendance_register (
  id bigserial PRIMARY KEY,
  store text NOT NULL DEFAULT '',
  report_date date NOT NULL DEFAULT current_date,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE daily_report_attendance_register ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_daily_report_attendance_register_tenant ON daily_report_attendance_register (tenant_id);

CREATE TABLE IF NOT EXISTS dish_library_costs (
  id bigserial PRIMARY KEY,
  brand text NOT NULL DEFAULT '',
  biz_type text NOT NULL DEFAULT '',
  dish_name text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dish_library_costs_tenant ON dish_library_costs (tenant_id);

CREATE TABLE IF NOT EXISTS feishu_generic_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_token text,
  table_id text,
  record_id text,
  fields jsonb DEFAULT '{}'::jsonb,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE feishu_generic_records ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_generic_records_tenant ON feishu_generic_records (tenant_id);

CREATE TABLE IF NOT EXISTS hrms_leave_balance_overrides (
  id bigserial PRIMARY KEY,
  username text NOT NULL DEFAULT '',
  month text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE hrms_leave_balance_overrides ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_leave_balance_overrides_tenant ON hrms_leave_balance_overrides (tenant_id);

CREATE TABLE IF NOT EXISTS hrms_payroll_history (
  id bigserial PRIMARY KEY,
  idempotency_key text NOT NULL,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hrms_payroll_history_tenant ON hrms_payroll_history (tenant_id);

CREATE TABLE IF NOT EXISTS pos_orders (
  id bigserial PRIMARY KEY,
  order_no text NOT NULL DEFAULT '',
  store_id text,
  phone text,
  biz_date date,
  order_time timestamptz,
  checkout_time timestamptz,
  order_type text,
  amount_before_discount numeric DEFAULT 0,
  amount_after_discount numeric DEFAULT 0,
  diners numeric DEFAULT 1,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_pos_orders_tenant ON pos_orders (tenant_id);

CREATE TABLE IF NOT EXISTS pos_order_items (
  id bigserial PRIMARY KEY,
  order_no text NOT NULL DEFAULT '',
  biz_date date,
  store_code text DEFAULT '',
  sku text,
  dish_name text,
  spec text,
  tags text,
  unit_price numeric DEFAULT 0,
  qty numeric DEFAULT 0,
  unit text,
  amount_before_discount numeric DEFAULT 0,
  service_fee numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  amount_after_discount numeric DEFAULT 0,
  category_mid text,
  category text,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pos_order_items ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_pos_order_items_tenant ON pos_order_items (tenant_id);

CREATE TABLE IF NOT EXISTS public_promo_tasks (
  id bigserial PRIMARY KEY,
  task_key text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public_promo_tasks ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_public_promo_tasks_tenant ON public_promo_tasks (tenant_id);

CREATE TABLE IF NOT EXISTS sales_growth_snapshot (
  id bigserial PRIMARY KEY,
  snapshot_date date NOT NULL DEFAULT current_date,
  store_code text NOT NULL DEFAULT '',
  dish_name text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_growth_snapshot_tenant ON sales_growth_snapshot (tenant_id);

CREATE TABLE IF NOT EXISTS store_duty_bindings (
  id bigserial PRIMARY KEY,
  username text NOT NULL DEFAULT '',
  store text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE store_duty_bindings ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_duty_bindings_tenant ON store_duty_bindings (tenant_id);

CREATE TABLE IF NOT EXISTS store_ratings (
  id bigserial PRIMARY KEY,
  store text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  period text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_ratings_tenant ON store_ratings (tenant_id);

CREATE TABLE IF NOT EXISTS store_wecom_configs (
  id bigserial PRIMARY KEY,
  store_id text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE store_wecom_configs ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_wecom_configs_tenant ON store_wecom_configs (tenant_id);

CREATE TABLE IF NOT EXISTS strategy_experiments (
  id bigserial PRIMARY KEY,
  experiment_code text NOT NULL,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_experiments_tenant ON strategy_experiments (tenant_id);

CREATE TABLE IF NOT EXISTS strategy_rules (
  id bigserial PRIMARY KEY,
  scenario text NOT NULL DEFAULT '',
  root_cause text NOT NULL DEFAULT '',
  variant_label text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strategy_rules_tenant ON strategy_rules (tenant_id);

CREATE TABLE IF NOT EXISTS table_visit_records (
  id bigserial PRIMARY KEY,
  feishu_record_id text NOT NULL DEFAULT '',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE table_visit_records ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_table_visit_records_tenant ON table_visit_records (tenant_id);

CREATE TABLE IF NOT EXISTS agent_issues_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id text UNIQUE NOT NULL,
  agent_type text NOT NULL,
  issue_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  context jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending',
  severity text DEFAULT 'medium',
  priority text DEFAULT 'normal',
  assigned_agent text,
  deadline timestamp,
  optimization_plan jsonb,
  expected_impact text,
  implementation_time text,
  approved_by text,
  approval_notes text,
  approved_at timestamp,
  optimization_results jsonb,
  metrics jsonb,
  completed_at timestamp,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

ALTER TABLE agent_issues_reports ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_issues_reports_tenant ON agent_issues_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_issues_reports_status ON agent_issues_reports (status);

ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS sla_due_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_master_tasks_sla_due_at ON master_tasks (sla_due_at) WHERE sla_due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS training_certifications (
  id serial PRIMARY KEY,
  session_id integer NOT NULL DEFAULT 0,
  employee_username varchar(100) NOT NULL DEFAULT '',
  topic_id integer NOT NULL DEFAULT 0,
  certified_at timestamp,
  valid_until timestamp,
  status varchar(30) DEFAULT 'pending',
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  created_at timestamp DEFAULT now()
);

ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS certified_at timestamp;
ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS valid_until timestamp;
ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS status varchar(30) DEFAULT 'pending';
ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS manager_verdict varchar(30);
ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_training_certifications_tenant ON training_certifications (tenant_id);

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(100),
  name varchar(200),
  real_name varchar(200),
  role varchar(80),
  store varchar(200),
  status varchar(40) DEFAULT 'active',
  is_active boolean DEFAULT true,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  extra_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT current_timestamp,
  updated_at timestamptz DEFAULT current_timestamp
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS tenant_id varchar(80) NOT NULL DEFAULT 'default';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS extra_json jsonb DEFAULT '{}'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT current_timestamp;
CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees (tenant_id);

CREATE TABLE IF NOT EXISTS point_records (
  id bigserial PRIMARY KEY,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  username text,
  name text,
  store text,
  item_name text,
  approval_id text,
  points numeric DEFAULT 0,
  amount numeric DEFAULT 0,
  reason text,
  source text,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE point_records ADD COLUMN IF NOT EXISTS approval_id text;
ALTER TABLE point_records ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE point_records ADD COLUMN IF NOT EXISTS store text;
ALTER TABLE point_records ADD COLUMN IF NOT EXISTS item_name text;
ALTER TABLE point_records ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0;
ALTER TABLE point_records ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE point_records ADD COLUMN IF NOT EXISTS approved_by text;
CREATE INDEX IF NOT EXISTS idx_point_records_tenant ON point_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_point_records_approval_id ON point_records (approval_id) WHERE approval_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recipes (
  id bigserial PRIMARY KEY,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  recipe_key text,
  name text NOT NULL DEFAULT '',
  dish_name varchar(255) NOT NULL DEFAULT '',
  category text,
  brand varchar(100),
  store varchar(200) NOT NULL DEFAULT '*',
  station varchar(100),
  version varchar(20) NOT NULL DEFAULT '1.0',
  status text DEFAULT 'active',
  notes text,
  created_by varchar(120),
  updated_by varchar(120),
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS dish_name varchar(255) NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS brand varchar(100);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS store varchar(200) NOT NULL DEFAULT '*';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS station varchar(100);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS version varchar(20) NOT NULL DEFAULT '1.0';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS created_by varchar(120);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS updated_by varchar(120);
CREATE INDEX IF NOT EXISTS idx_recipes_tenant ON recipes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recipes_lookup ON recipes (dish_name, store, status);

-- pos_sales_detail是pos_order_items的视图(权威POS数据源，sales_raw表已于2026-07-03下线)，
-- 不是表——上面这段CREATE TABLE/CREATE INDEX是误加的，会在"is not a table or materialized
-- view"报错，而ensureBaselineSchemaHealth()用单次pool.query()把整份文件当一条隐式事务执行，
-- 一处失败会导致前面所有已成功的CREATE TABLE/ALTER TABLE全部回滚，等于本文件在任何环境
-- 都从未真正生效过。已彻底移除，不要再在这里为pos_sales_detail建表/建索引。
