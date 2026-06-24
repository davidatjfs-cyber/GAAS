-- 中心化训练数据回流：租户密钥表
-- 每个租户对应一个 api_key，用于向中心服务器推送训练数据时的身份认证。
-- 仅部署在中心训练服务器上。

CREATE TABLE IF NOT EXISTS telemetry_tenant_keys (
  tenant_id VARCHAR(80) NOT NULL PRIMARY KEY,
  api_key VARCHAR(128) NOT NULL UNIQUE,
  license_key VARCHAR(256),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
