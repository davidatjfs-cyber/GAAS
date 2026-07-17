-- 130: 跨区域销售协同。线索与销售均可归属区域，自动分配优先同区域，业绩按区域汇总。

CREATE TABLE IF NOT EXISTS sales_regions (
  region_code TEXT PRIMARY KEY,
  region_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS region_code TEXT,
  ADD COLUMN IF NOT EXISTS region_name TEXT;

ALTER TABLE sales_reps
  ADD COLUMN IF NOT EXISTS region_code TEXT,
  ADD COLUMN IF NOT EXISTS region_name TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_leads_region ON sales_leads (region_code, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_reps_region ON sales_reps (region_code, status);
