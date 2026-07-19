-- 142: 客户档案里的签约价格/账期——机密信息，只有超级管理员/总经理/财务能在客户档案里
-- 看到原始字段(销售/客服完全看不到，见 sales-privacy.js 的 redactContractPrice)。
-- 由销售在第一次签约时录入，之后基本不变，是"自动生成账单"金额与账期的唯一权威来源。
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS contract_price_fen BIGINT,
  ADD COLUMN IF NOT EXISTS contract_billing_cycle TEXT CHECK (contract_billing_cycle IN ('monthly', 'quarterly', 'yearly')),
  ADD COLUMN IF NOT EXISTS contract_billing_day INTEGER CHECK (contract_billing_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS contract_price_note TEXT,
  ADD COLUMN IF NOT EXISTS contract_price_set_by TEXT,
  ADD COLUMN IF NOT EXISTS contract_price_set_at TIMESTAMPTZ;

-- 我方收款账户——平台级单一配置(不是按租户)，复用 tenant_config 表，用 '__system__' 这个
-- 哨兵tenant_key(不是真实tenant_id，tenant_config对tenant_key没有外键约束，安全)。
-- 展示在每一份账单PDF上，跟"签约价格"一样属于机密程度较高的信息，同样只对
-- 超级管理员/总经理/财务开放编辑，但下载账单本身(会带出这份信息)按现有
-- platformAdminRequired口径开放给需要发送账单给客户的销售/客服。
