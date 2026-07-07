-- Restaurant growth ontology core.
-- Idempotent by design: safe to re-run on existing tenant databases.

CREATE TABLE IF NOT EXISTS growth_ontology_stores (
  store_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  name text,
  city text,
  business_type text,
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_customers (
  customer_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  phone text,
  external_id text,
  wechat_id text,
  mini_program_openid text,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  visit_count numeric DEFAULT 0,
  total_spend numeric DEFAULT 0,
  avg_spend numeric DEFAULT 0,
  lifecycle_stage text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level text,
  value_level text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_dishes (
  dish_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  name text,
  category text,
  price numeric,
  gross_margin_estimate numeric,
  is_signature boolean DEFAULT false,
  is_repeat_driver boolean DEFAULT false,
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_orders (
  order_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  customer_id text,
  order_time timestamptz,
  amount numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  actual_paid numeric DEFAULT 0,
  table_no text,
  pax integer,
  channel text,
  source text,
  coupon_id text,
  campaign_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_employees (
  employee_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  name text,
  role text,
  status text DEFAULT 'active',
  skill_level text,
  performance_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_campaigns (
  campaign_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  name text,
  target_segment text,
  channel text,
  offer_type text,
  offer_cost_estimate numeric DEFAULT 0,
  start_at timestamptz,
  end_at timestamptz,
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_benefits (
  benefit_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  campaign_id text,
  name text,
  type text,
  face_value numeric DEFAULT 0,
  cost_estimate numeric DEFAULT 0,
  valid_from timestamptz,
  valid_to timestamptz,
  status text DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_touches (
  touch_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  customer_id text,
  campaign_id text,
  channel text,
  content text,
  coupon_id text,
  sent_at timestamptz,
  status text DEFAULT 'sent',
  opened_at timestamptz,
  clicked_at timestamptz,
  converted_order_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_issues (
  issue_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  issue_type text,
  issue_title text,
  issue_description text,
  severity text,
  confidence_score numeric,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  root_cause_candidates_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_amount_estimate numeric,
  status text DEFAULT 'open',
  first_detected_at timestamptz,
  last_detected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_opportunities (
  opportunity_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  issue_id text,
  opportunity_type text,
  title text,
  description text,
  target_entity_type text,
  target_entity_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_revenue_uplift numeric,
  estimated_cost numeric,
  expected_roi numeric,
  priority text,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_attributions (
  attribution_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  campaign_id text,
  task_id text,
  opportunity_id text,
  customer_id text,
  related_order_id text,
  baseline_value numeric,
  actual_value numeric,
  uplift_value numeric,
  cost_value numeric,
  net_value numeric,
  attribution_method text,
  confidence_score numeric,
  attribution_window_start timestamptz,
  attribution_window_end timestamptz,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS growth_ontology_business_results (
  result_id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'default',
  store_id text,
  result_type text,
  entity_type text,
  entity_id text,
  metric_name text,
  before_value numeric,
  after_value numeric,
  delta_value numeric,
  result_period_start timestamptz,
  result_period_end timestamptz,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS issue_id text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS opportunity_id text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS owner_role text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS action_type text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS action_detail text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS priority text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS expected_result text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS actual_result text;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS store_id text;

CREATE INDEX IF NOT EXISTS idx_go_stores_tenant_store ON growth_ontology_stores (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_go_customers_tenant_store ON growth_ontology_customers (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_go_customers_phone ON growth_ontology_customers (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_go_dishes_tenant_store ON growth_ontology_dishes (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_go_orders_tenant_store_time ON growth_ontology_orders (tenant_id, store_id, order_time);
CREATE INDEX IF NOT EXISTS idx_go_orders_customer ON growth_ontology_orders (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_go_orders_campaign ON growth_ontology_orders (tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_go_employees_tenant_store ON growth_ontology_employees (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_go_campaigns_tenant_store ON growth_ontology_campaigns (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_go_benefits_campaign ON growth_ontology_benefits (tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_go_touches_campaign ON growth_ontology_touches (tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_go_touches_customer ON growth_ontology_touches (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_go_issues_tenant_store ON growth_ontology_issues (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_go_issues_type ON growth_ontology_issues (tenant_id, issue_type);
CREATE INDEX IF NOT EXISTS idx_go_opportunities_issue ON growth_ontology_opportunities (tenant_id, issue_id);
CREATE INDEX IF NOT EXISTS idx_go_opportunities_store ON growth_ontology_opportunities (tenant_id, store_id);
CREATE INDEX IF NOT EXISTS idx_go_attributions_task ON growth_ontology_attributions (tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_go_attributions_opp ON growth_ontology_attributions (tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_go_attributions_order ON growth_ontology_attributions (tenant_id, related_order_id);
CREATE INDEX IF NOT EXISTS idx_go_results_entity ON growth_ontology_business_results (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_master_tasks_growth_ontology ON master_tasks (tenant_id, opportunity_id, issue_id);
