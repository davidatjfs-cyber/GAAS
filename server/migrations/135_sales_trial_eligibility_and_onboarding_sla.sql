-- 缺口1：试跑资格判断规则引擎
CREATE TABLE IF NOT EXISTS trial_eligibility_rules (
  id BIGSERIAL PRIMARY KEY,
  rule_key TEXT NOT NULL,
  label TEXT NOT NULL,
  condition JSONB NOT NULL, -- {field, op, value}
  weight INT NOT NULL DEFAULT 0,
  is_blocking BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO trial_eligibility_rules (rule_key, label, condition, weight, is_blocking)
SELECT * FROM (VALUES
  ('has_pos_data', '客户有可用POS/手机号数据', '{"field":"phone_data_ready","op":"eq","value":true}'::jsonb, 40, TRUE),
  ('min_store_count', '门店数量不少于1家', '{"field":"store_count","op":"gte","value":1}'::jsonb, 20, TRUE),
  ('has_pos_brand', '已确认POS品牌', '{"field":"pos_brand","op":"not_empty","value":null}'::jsonb, 20, FALSE),
  ('has_decision_role', '已确认对接人决策角色', '{"field":"decision_role","op":"not_empty","value":null}'::jsonb, 20, FALSE)
) v(rule_key, label, condition, weight, is_blocking)
WHERE NOT EXISTS (SELECT 1 FROM trial_eligibility_rules);

-- 缺口2/3：部署检查1工作日SLA + 7天体检期报告交付追踪
ALTER TABLE sales_delivery_projects ADD COLUMN IF NOT EXISTS deploy_check_due_at TIMESTAMPTZ;
ALTER TABLE sales_delivery_projects ADD COLUMN IF NOT EXISTS deploy_check_completed_at TIMESTAMPTZ;
ALTER TABLE sales_delivery_projects ADD COLUMN IF NOT EXISTS deploy_check_overdue BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_delivery_projects ADD COLUMN IF NOT EXISTS health_check_due_at TIMESTAMPTZ;
ALTER TABLE sales_delivery_projects ADD COLUMN IF NOT EXISTS health_check_report_ref TEXT;
ALTER TABLE sales_delivery_projects ADD COLUMN IF NOT EXISTS health_check_delivered_at TIMESTAMPTZ;
ALTER TABLE sales_delivery_projects ADD COLUMN IF NOT EXISTS health_check_overdue BOOLEAN NOT NULL DEFAULT FALSE;

-- sales_order_delivery_projects 是订单闭环(现金/账期)路径下的交付记录表，与 sales_delivery_projects
-- (线索路径)并存；两者目前哪个是客服日常操作台尚在过渡，SLA字段两边都补齐，避免以后迁移操作台时漏项。
ALTER TABLE sales_order_delivery_projects ADD COLUMN IF NOT EXISTS deploy_check_due_at TIMESTAMPTZ;
ALTER TABLE sales_order_delivery_projects ADD COLUMN IF NOT EXISTS deploy_check_completed_at TIMESTAMPTZ;
ALTER TABLE sales_order_delivery_projects ADD COLUMN IF NOT EXISTS deploy_check_overdue BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_order_delivery_projects ADD COLUMN IF NOT EXISTS health_check_due_at TIMESTAMPTZ;
ALTER TABLE sales_order_delivery_projects ADD COLUMN IF NOT EXISTS health_check_report_ref TEXT;
ALTER TABLE sales_order_delivery_projects ADD COLUMN IF NOT EXISTS health_check_delivered_at TIMESTAMPTZ;
ALTER TABLE sales_order_delivery_projects ADD COLUMN IF NOT EXISTS health_check_overdue BOOLEAN NOT NULL DEFAULT FALSE;
