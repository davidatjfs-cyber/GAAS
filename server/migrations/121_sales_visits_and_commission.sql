-- 121: 销售拜访记录 + 销售提成——扩展进现有"销售人员管理"模块(sales_reps/sales_leads/
-- sales_deals)，不新建独立系统。

CREATE TABLE IF NOT EXISTS sales_visits (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  rep_id INT REFERENCES sales_reps(id) ON DELETE SET NULL,
  visit_type TEXT NOT NULL DEFAULT 'onsite', -- onsite(现场拜访) / online(视频) / phone(电话)
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  next_followup_at TIMESTAMPTZ,
  next_followup_plan TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_visits_lead ON sales_visits (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_visits_rep ON sales_visits (rep_id, occurred_at DESC);

-- 提成规则：按销售(rep_id)配置提成比例；rep_id为NULL表示全员默认规则，
-- 单个销售有自己的规则时优先用自己的(见 getEffectiveCommissionRate)。
CREATE TABLE IF NOT EXISTS sales_commission_rules (
  id BIGSERIAL PRIMARY KEY,
  rep_id INT REFERENCES sales_reps(id) ON DELETE CASCADE,
  rate_percent NUMERIC(6,3) NOT NULL, -- 如 5.000 = 5%
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rep_id, effective_from)
);

-- 每笔成交(sales_deals)对应一条提成记录；base_amount/rate_percent在生成时冻结快照，
-- 之后规则调整不影响历史已生成的提成金额。
CREATE TABLE IF NOT EXISTS sales_commissions (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES sales_deals(id) ON DELETE CASCADE,
  rep_id INT REFERENCES sales_reps(id) ON DELETE SET NULL,
  base_amount_fen BIGINT NOT NULL DEFAULT 0,
  rate_percent NUMERIC(6,3) NOT NULL DEFAULT 0,
  commission_amount_fen BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending / approved / paid / rejected
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id)
);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_rep ON sales_commissions (rep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_status ON sales_commissions (status);
