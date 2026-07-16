-- 125: 商业化验收批次1(扩展版)——记录级权限归属字段、任务dedup_key正式方案、案例对外展示
-- 最低安全字段。对应 docs/customer-sales-ai-commercial-acceptance.md 整改要求。

-- 客户成功负责人：customer_service角色默认对所有线索/租户不可见，只有显式分配到这个字段
-- 才能看——不给"客服默认能看全部售前线索"的口子。
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS cs_owner_username TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_leads_cs_owner ON sales_leads (cs_owner_username);

-- sales_tasks 补齐任务域/去重键等字段，销售任务和客户成功任务继续共用这张表，
-- 靠 task_domain 区分列表筛选，靠 dedup_key 做数据库级去重（不再只靠应用层SELECT）。
ALTER TABLE sales_tasks
  ADD COLUMN IF NOT EXISTS task_domain TEXT NOT NULL DEFAULT 'sales',  -- sales/nurture/onboarding/customer_success/renewal/referral
  ADD COLUMN IF NOT EXISTS task_type TEXT,
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_result TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 历史任务补一次tenant_id(能从关联lead拿到就拿，拿不到留空，不是错误)
UPDATE sales_tasks st
   SET tenant_id = sl.tenant_id
  FROM sales_leads sl
 WHERE st.lead_id = sl.id AND st.tenant_id IS NULL AND sl.tenant_id IS NOT NULL;

-- 历史里已经进status='done'的任务，用updated_at回填completed_at，避免"以前的任务永远没有完成时间"
UPDATE sales_tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tasks_dedup_key ON sales_tasks (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tasks_domain_status ON sales_tasks (task_domain, status);
CREATE INDEX IF NOT EXISTS idx_sales_tasks_tenant ON sales_tasks (tenant_id) WHERE tenant_id IS NOT NULL;

-- 案例对外展示最低保护：active只代表"这条案例记录本身有效"，不代表"允许讲给客户听"。
-- 旧数据默认 false，需要人工过一遍案例库手动标记，不是自动放行(即便此前124迁移里给
-- external_approved默认了true——这里改用更严格的两个字段名并默认false，双保险不冲突，
-- 客户AI推荐逻辑改成同时要求 external_use_allowed 和 anonymized 都为true)。
ALTER TABLE sales_case_assets
  ADD COLUMN IF NOT EXISTS external_use_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
