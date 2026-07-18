-- Multi-tenant AI quality learning flywheel.
-- Tenant-owned raw traces stay isolated. Only explicitly opted-in, redacted
-- candidates may be read by the platform system context for evaluation.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_learning_policies (
  tenant_id VARCHAR(80) PRIMARY KEY,
  platform_learning_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_purposes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 30 AND 1095),
  max_daily_contributions INTEGER NOT NULL DEFAULT 100 CHECK (max_daily_contributions BETWEEN 1 AND 1000),
  policy_version INTEGER NOT NULL DEFAULT 1,
  updated_by VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_learning_policy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL,
  policy_version INTEGER NOT NULL,
  platform_learning_enabled BOOLEAN NOT NULL,
  allowed_purposes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  retention_days INTEGER NOT NULL,
  max_daily_contributions INTEGER NOT NULL,
  changed_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_learning_policy_events_tenant_idx
  ON ai_learning_policy_events (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_interaction_traces (
  trace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL,
  source VARCHAR(60) NOT NULL,
  source_record_id TEXT,
  route VARCHAR(80),
  purpose VARCHAR(80),
  actor_id VARCHAR(160),
  model_provider VARCHAR(60),
  model_name VARCHAR(160),
  prompt_version VARCHAR(120),
  input_hash VARCHAR(64) NOT NULL,
  output_hash VARCHAR(64),
  status VARCHAR(30) NOT NULL DEFAULT 'completed',
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  quality_metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  business_context JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_interaction_traces_source_uniq UNIQUE (tenant_id, source, source_record_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_interaction_traces_trace_tenant_uniq
  ON ai_interaction_traces (trace_id, tenant_id);
CREATE INDEX IF NOT EXISTS ai_interaction_traces_tenant_created_idx
  ON ai_interaction_traces (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_interaction_traces_route_created_idx
  ON ai_interaction_traces (tenant_id, route, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  tenant_id VARCHAR(80) NOT NULL,
  actor_id VARCHAR(160),
  feedback_type VARCHAR(40) NOT NULL,
  rating SMALLINT CHECK (rating BETWEEN -1 AND 1),
  note TEXT,
  business_outcome JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_feedback_events_trace_fk
    FOREIGN KEY (trace_id, tenant_id)
    REFERENCES ai_interaction_traces (trace_id, tenant_id)
    ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_feedback_events_idempotency_uniq
  ON ai_feedback_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_feedback_events_trace_idx
  ON ai_feedback_events (tenant_id, trace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_learning_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL,
  source_trace_id UUID NOT NULL,
  source_feedback_id UUID,
  source_tenant_pseudonym VARCHAR(64) NOT NULL,
  route VARCHAR(80),
  purpose VARCHAR(80),
  sanitized_input TEXT NOT NULL,
  sanitized_output TEXT NOT NULL,
  label VARCHAR(40) NOT NULL,
  label_score NUMERIC(6,3),
  business_outcome JSONB NOT NULL DEFAULT '{}'::JSONB,
  redaction_report JSONB NOT NULL DEFAULT '{}'::JSONB,
  status VARCHAR(30) NOT NULL DEFAULT 'eligible',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  CONSTRAINT ai_learning_candidates_trace_fk
    FOREIGN KEY (source_trace_id, tenant_id)
    REFERENCES ai_interaction_traces (trace_id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT ai_learning_candidates_feedback_fk
    FOREIGN KEY (source_feedback_id)
    REFERENCES ai_feedback_events (id)
    ON DELETE SET NULL,
  CONSTRAINT ai_learning_candidates_trace_uniq UNIQUE (tenant_id, source_trace_id, label)
);
CREATE INDEX IF NOT EXISTS ai_learning_candidates_status_idx
  ON ai_learning_candidates (status, route, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_evaluation_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(30) NOT NULL DEFAULT 'ready',
  item_count INTEGER NOT NULL DEFAULT 0,
  tenant_count INTEGER NOT NULL DEFAULT 0,
  selection_policy JSONB NOT NULL DEFAULT '{}'::JSONB,
  content_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_evaluation_dataset_items (
  dataset_id UUID NOT NULL REFERENCES ai_evaluation_datasets(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES ai_learning_candidates(id) ON DELETE RESTRICT,
  source_tenant_pseudonym VARCHAR(64) NOT NULL,
  route VARCHAR(80),
  sanitized_input TEXT NOT NULL,
  sanitized_output TEXT NOT NULL,
  expected_label VARCHAR(40) NOT NULL,
  label_score NUMERIC(6,3),
  PRIMARY KEY (dataset_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS ai_evaluation_dataset_items_route_idx
  ON ai_evaluation_dataset_items (dataset_id, route);

CREATE TABLE IF NOT EXISTS ai_quality_release_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type VARCHAR(40) NOT NULL,
  artifact_key VARCHAR(160) NOT NULL,
  artifact_version VARCHAR(80) NOT NULL,
  artifact_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  dataset_id UUID REFERENCES ai_evaluation_datasets(id),
  baseline_metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  candidate_metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  gate_result JSONB NOT NULL DEFAULT '{}'::JSONB,
  canary_metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(120),
  approved_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_quality_release_artifact_uniq UNIQUE (artifact_type, artifact_key, artifact_version)
);

ALTER TABLE agent_quality_audits ADD COLUMN IF NOT EXISTS trace_id UUID;
ALTER TABLE diagnosis_feedback ADD COLUMN IF NOT EXISTS trace_id UUID;
ALTER TABLE diagnosis_feedback ADD COLUMN IF NOT EXISTS query_text TEXT;
ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS trace_id UUID;
CREATE INDEX IF NOT EXISTS agent_quality_audits_trace_idx ON agent_quality_audits (trace_id);
CREATE INDEX IF NOT EXISTS diagnosis_feedback_trace_idx ON diagnosis_feedback (trace_id);
CREATE INDEX IF NOT EXISTS agent_memory_trace_idx ON agent_memory (trace_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_learning_policies',
    'ai_learning_policy_events',
    'ai_learning_candidates'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true) OR current_setting(''app.tenant_id'', true) = ''__system__'') WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true) OR current_setting(''app.tenant_id'', true) = ''__system__'')',
      t
    );
  END LOOP;

  -- Raw tenant telemetry (actor identifiers, hashes and business context) is
  -- never cross-tenant readable, including from the platform system context.
  FOREACH t IN ARRAY ARRAY[
    'ai_interaction_traces',
    'ai_feedback_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'ai_evaluation_datasets',
    'ai_evaluation_dataset_items',
    'ai_quality_release_candidates'
  ] LOOP
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
