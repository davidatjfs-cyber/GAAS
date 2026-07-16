DO $$
BEGIN
  IF to_regclass('public.auto_ops_runs') IS NOT NULL THEN
    ALTER TABLE auto_ops_runs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
    UPDATE auto_ops_runs SET tenant_id='default' WHERE tenant_id IS NULL OR trim(tenant_id)='';
    CREATE INDEX IF NOT EXISTS idx_auto_ops_runs_tenant ON auto_ops_runs(tenant_id);
    ALTER TABLE auto_ops_runs DROP CONSTRAINT IF EXISTS auto_ops_runs_job_key_run_key_key;
    ALTER TABLE auto_ops_runs DROP CONSTRAINT IF EXISTS auto_ops_runs_job_key_run_key_tenant_key;
    ALTER TABLE auto_ops_runs ADD CONSTRAINT auto_ops_runs_job_key_run_key_tenant_key UNIQUE (job_key,run_key,tenant_id);
  END IF;
END $$;
