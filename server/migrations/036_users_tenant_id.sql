-- 给 users 表加 tenant_id，作为后续所有"按租户过滤"的锚点。
-- 纯加列+默认值，现网全部用户自动归入 'default' 租户，零行为风险。

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
