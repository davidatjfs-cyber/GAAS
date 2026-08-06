-- 180: 菜品属性列 + 新品研发记录表（顾客孪生菜品测试工作台数据层）
-- 来源：飞书堂食菜品库（已加 8 个属性列）+ 飞书新品研发记录表（新建）

ALTER TABLE dish_library_costs
  ADD COLUMN IF NOT EXISTS spicy_level TEXT,
  ADD COLUMN IF NOT EXISTS main_ingredient TEXT,
  ADD COLUMN IF NOT EXISTS cooking_method TEXT,
  ADD COLUMN IF NOT EXISTS taste_type TEXT,
  ADD COLUMN IF NOT EXISTS is_signature TEXT,
  ADD COLUMN IF NOT EXISTS is_new TEXT,
  ADD COLUMN IF NOT EXISTS portion_size TEXT,
  ADD COLUMN IF NOT EXISTS suitable_scenes TEXT;

CREATE TABLE IF NOT EXISTS customer_twin_new_dish_records (
  id BIGSERIAL PRIMARY KEY,
  record_id TEXT NOT NULL UNIQUE,
  dish_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  dev_date DATE,
  dev_by TEXT NOT NULL DEFAULT '',
  cost NUMERIC(12,2),
  planned_price NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT '',
  linked_dish TEXT NOT NULL DEFAULT '',
  selling_points TEXT NOT NULL DEFAULT '',
  tasting_date DATE,
  tasting_participants TEXT NOT NULL DEFAULT '',
  boss_opinion TEXT NOT NULL DEFAULT '',
  ops_opinion TEXT NOT NULL DEFAULT '',
  manager_opinion TEXT NOT NULL DEFAULT '',
  tasting_conclusion TEXT NOT NULL DEFAULT '',
  adjustment TEXT NOT NULL DEFAULT '',
  retest TEXT NOT NULL DEFAULT '',
  launch_date DATE,
  launch_stores TEXT NOT NULL DEFAULT '',
  promo_channels TEXT NOT NULL DEFAULT '',
  sales_30d NUMERIC(12,2),
  review_summary_30d TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ct_ndr_status
  ON customer_twin_new_dish_records (status);
