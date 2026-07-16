-- Multi-server tenant isolation foundation.
-- Safe to run repeatedly; existing legacy rows remain compatible.
CREATE TABLE IF NOT EXISTS server_tenant_bindings (
  id BIGSERIAL PRIMARY KEY,
  server_code VARCHAR(120) NOT NULL,
  tenant_id VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  bind_mode VARCHAR(30) NOT NULL DEFAULT 'manual',
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unbound_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_code, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_server_tenant_bindings_tenant ON server_tenant_bindings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_server_tenant_bindings_server ON server_tenant_bindings (server_code);
CREATE INDEX IF NOT EXISTS idx_server_tenant_bindings_active_server ON server_tenant_bindings (server_code, status);
CREATE INDEX IF NOT EXISTS idx_server_tenant_bindings_active_tenant ON server_tenant_bindings (tenant_id, status);

ALTER TABLE IF EXISTS tenant_server_routes ADD COLUMN IF NOT EXISTS route_mode VARCHAR(30) NOT NULL DEFAULT 'dedicated';
ALTER TABLE IF EXISTS tenant_server_routes ADD COLUMN IF NOT EXISTS route_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS tenant_server_routes ADD COLUMN IF NOT EXISTS allow_legacy_fallback BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(120);
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS store_id VARCHAR(120);
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS target_server_code VARCHAR(120);
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS target_base_url TEXT;
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS route_version INTEGER;
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS route_mode VARCHAR(30);
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS request_id VARCHAR(160);
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS last_http_status INTEGER;
ALTER TABLE IF EXISTS hrms_event_outbox ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
DO $$
BEGIN
  IF to_regclass('public.hrms_event_outbox') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_hrms_event_outbox_target ON hrms_event_outbox (target_server_code, status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_hrms_event_outbox_tenant ON hrms_event_outbox (tenant_id, status);
  END IF;
END $$;
