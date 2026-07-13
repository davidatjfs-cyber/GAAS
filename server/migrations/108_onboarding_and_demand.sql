-- Phase 3/5 bookkeeping（运行时 ensure* 也会幂等创建）
-- onboarding + demand governance

CREATE TABLE IF NOT EXISTS tenant_onboarding_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL,
  store_id TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  current_step TEXT NOT NULL DEFAULT 'create_store',
  started_by TEXT,
  completed_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_onboarding_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES tenant_onboarding_runs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_order SMALLINT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  owner_role TEXT NOT NULL DEFAULT 'platform_team',
  impact TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  inspection_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing TEXT,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_tor_tenant ON tenant_onboarding_runs (tenant_id, status);

CREATE TABLE IF NOT EXISTS tenant_demand_requests (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT DEFAULT 'cs',
  verdict TEXT NOT NULL DEFAULT 'evaluate_common',
  status TEXT NOT NULL DEFAULT 'logged',
  enter_eng BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT,
  decided_by TEXT,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tdr_tenant ON tenant_demand_requests (tenant_id, created_at DESC);
