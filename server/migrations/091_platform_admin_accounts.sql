-- 平台管理鉴权从"单一共享密钥"升级为账号体系+操作审计日志。
-- 共享密钥模式下密钥一旦泄露=对全部租户的完全控制权，且无法区分谁做了什么操作；
-- 升级后每个平台管理员有自己的账号，所有非GET操作都落审计日志。
-- 旧的 PLATFORM_ADMIN_SECRET 只保留用于一次性创建第一个账号(bootstrap)，
-- bootstrap接口在 platform_admins 表非空后永久失效。

CREATE TABLE IF NOT EXISTS platform_admins (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  real_name VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_username VARCHAR(80) NOT NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(300) NOT NULL,
  target_tenant_id VARCHAR(80),
  detail JSONB,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_created ON platform_admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_admin_audit_admin ON platform_admin_audit_log (admin_username, created_at DESC);
