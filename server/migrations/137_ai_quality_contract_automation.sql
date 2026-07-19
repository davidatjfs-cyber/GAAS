-- Contract-authorized, fully automated AI quality flywheel governance.
-- Raw tenant data remains tenant-scoped; platform tables contain only redacted
-- candidates, aggregate metrics and append-only lineage/audit records.

BEGIN;

ALTER TABLE ai_learning_policies
  ADD COLUMN IF NOT EXISTS authorization_basis VARCHAR(30),
  ADD COLUMN IF NOT EXISTS agreement_reference VARCHAR(200),
  ADD COLUMN IF NOT EXISTS agreement_version VARCHAR(80),
  ADD COLUMN IF NOT EXISTS agreement_effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS authorization_recorded_by VARCHAR(120),
  ADD COLUMN IF NOT EXISTS authorization_source VARCHAR(40),
  ADD COLUMN IF NOT EXISTS automation_mode VARCHAR(30) NOT NULL DEFAULT 'automatic',
  ADD COLUMN IF NOT EXISTS enabled_at TIMESTAMPTZ;

ALTER TABLE ai_learning_policy_events
  ADD COLUMN IF NOT EXISTS authorization_basis VARCHAR(30),
  ADD COLUMN IF NOT EXISTS agreement_reference VARCHAR(200),
  ADD COLUMN IF NOT EXISTS agreement_version VARCHAR(80),
  ADD COLUMN IF NOT EXISTS agreement_effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS authorization_source VARCHAR(40),
  ADD COLUMN IF NOT EXISTS automation_mode VARCHAR(30) NOT NULL DEFAULT 'automatic';

CREATE TABLE IF NOT EXISTS ai_learning_cycle_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  trigger_type VARCHAR(30) NOT NULL DEFAULT 'scheduler',
  tenant_count INTEGER NOT NULL DEFAULT 0,
  trace_count INTEGER NOT NULL DEFAULT 0,
  feedback_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  dataset_id UUID REFERENCES ai_evaluation_datasets(id) ON DELETE SET NULL,
  dataset_version VARCHAR(80),
  proposal_count INTEGER NOT NULL DEFAULT 0,
  canary_count INTEGER NOT NULL DEFAULT 0,
  promoted_count INTEGER NOT NULL DEFAULT 0,
  rolled_back_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_summary JSONB NOT NULL DEFAULT '[]'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_learning_cycle_runs_started_idx
  ON ai_learning_cycle_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS ai_quality_release_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_candidate_id UUID NOT NULL REFERENCES ai_quality_release_candidates(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  reason VARCHAR(160) NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_quality_release_events_candidate_idx
  ON ai_quality_release_events (release_candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_quality_model_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation VARCHAR(40) NOT NULL,
  route VARCHAR(80),
  provider VARCHAR(60),
  model_name VARCHAR(160),
  success BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  error_code VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_quality_model_calls_created_idx
  ON ai_quality_model_calls (created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_learning_cycle_runs','ai_quality_release_events','ai_quality_model_calls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_system_only ON %I', t);
    EXECUTE format(
      'CREATE POLICY platform_system_only ON %I USING (current_setting(''app.tenant_id'', true) = ''__system__'') WITH CHECK (current_setting(''app.tenant_id'', true) = ''__system__'')',
      t
    );
  END LOOP;
END $$;

COMMIT;
