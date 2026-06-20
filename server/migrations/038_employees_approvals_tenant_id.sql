-- 模式2核心表第一批：employees + approval_requests 加 tenant_id，纯加列+默认值，零行为风险。
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);

ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id);
