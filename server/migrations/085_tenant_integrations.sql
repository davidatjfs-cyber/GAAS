-- Encrypted per-tenant external integration configuration.
CREATE TABLE IF NOT EXISTS tenant_integrations (
  tenant_id VARCHAR(80) NOT NULL,
  integration_key VARCHAR(80) NOT NULL,
  encrypted_config TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, integration_key)
);

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_integrations_tenant_id_fkey') THEN
    ALTER TABLE tenant_integrations ADD CONSTRAINT tenant_integrations_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_integrations;
CREATE POLICY tenant_isolation ON tenant_integrations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
