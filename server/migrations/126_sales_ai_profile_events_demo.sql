-- 第二阶段：统一槽位元数据、可审计动作和Demo预约任务。
CREATE TABLE IF NOT EXISTS sales_profile_slot_definitions (
  slot_key TEXT PRIMARY KEY,
  value_type TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  sensitive BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO sales_profile_slot_definitions(slot_key,value_type,required,sensitive,sort_order) VALUES
 ('store_count','number',true,false,10),('city','string',true,false,15),('cuisine','string',true,false,20),
 ('pos_brand','string',true,false,30),('phone_data_ready','boolean',true,false,40),('member_estimate','number',true,false,45),
 ('other_system_used','boolean',true,false,47),('pain_point','string',true,false,50),('contact_phone','string',false,true,55),
 ('decision_role','string',true,false,60)
ON CONFLICT (slot_key) DO UPDATE SET value_type=EXCLUDED.value_type, required=EXCLUDED.required, sensitive=EXCLUDED.sensitive, sort_order=EXCLUDED.sort_order;
ALTER TABLE sales_lead_events ADD COLUMN IF NOT EXISTS actor_type TEXT;
ALTER TABLE sales_lead_events ADD COLUMN IF NOT EXISTS actor_id TEXT;
ALTER TABLE sales_lead_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE sales_lead_events ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE sales_lead_events ADD COLUMN IF NOT EXISTS source_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_events_correlation ON sales_lead_events(correlation_id) WHERE correlation_id IS NOT NULL;
