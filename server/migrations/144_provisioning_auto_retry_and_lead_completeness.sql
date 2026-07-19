-- 开通失败自动重试：provision_status='tenant_created'/'partial' 的线索，系统按退避间隔
-- 自动重试(见 provisioning-retry-service.js)，只有重试到上限还失败才真正需要人工介入。
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS provision_retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS provision_next_retry_at TIMESTAMPTZ;
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS provision_retry_exhausted BOOLEAN NOT NULL DEFAULT FALSE;

-- 门店信息收集完整性：AI对话抽取(extracted字段)和人工建档表单是两套并行入口，之前没有
-- 统一的"信息是否收全"判断。这里不新增字段，靠 sales-lead-completeness.js 直接读取
-- sales_leads 既有字段(store_count/pos_brand/phone_data_ready/decision_role等)判断。
