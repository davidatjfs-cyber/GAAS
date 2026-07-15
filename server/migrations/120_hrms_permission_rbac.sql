-- 租户级 RBAC：薪资/报表等敏感操作可配置授权，默认 legacy 模式与洪潮/马己仙硬编码行为一致

CREATE TABLE IF NOT EXISTS hrms_permission_policies (
  tenant_id VARCHAR(64) PRIMARY KEY,
  enforcement_mode VARCHAR(16) NOT NULL DEFAULT 'legacy',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS hrms_permission_definitions (
  tenant_id VARCHAR(64) NOT NULL,
  permission_id VARCHAR(80) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'general',
  label_zh VARCHAR(128) NOT NULL DEFAULT '',
  description_zh TEXT,
  sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (tenant_id, permission_id)
);

CREATE TABLE IF NOT EXISTS hrms_permission_grants (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  grantee_type VARCHAR(24) NOT NULL,
  grantee_key VARCHAR(128) NOT NULL,
  permission_id VARCHAR(80) NOT NULL,
  store_scope VARCHAR(24) NOT NULL DEFAULT 'inherit',
  granted_by VARCHAR(100),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, grantee_type, grantee_key, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_hrms_perm_grants_tenant_grantee
  ON hrms_permission_grants (tenant_id, grantee_type, grantee_key);

CREATE TABLE IF NOT EXISTS hrms_permission_audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  actor_username VARCHAR(100),
  action VARCHAR(48) NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hrms_perm_audit_tenant_created
  ON hrms_permission_audit_log (tenant_id, created_at DESC);
