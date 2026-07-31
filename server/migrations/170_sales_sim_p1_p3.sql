-- 170: sales-sim P1–P3 扩展
-- 话术提名/审核、导师批注、人格受众与经营真题字段、会话租户隔离

ALTER TABLE sales_sim_playbooks
  ADD COLUMN IF NOT EXISTS nominated_by TEXT,
  ADD COLUMN IF NOT EXISTS nominated_session_id BIGINT,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_trainee_text TEXT,
  ADD COLUMN IF NOT EXISTS target_scene_key TEXT;

ALTER TABLE sales_sim_personas
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'builtin',
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_sim_personas_audience
  ON sales_sim_personas (audience, track, active);

ALTER TABLE sales_sim_sessions
  ADD COLUMN IF NOT EXISTS tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'internal';

CREATE INDEX IF NOT EXISTS idx_sales_sim_sessions_tenant
  ON sales_sim_sessions (tenant_id, username, started_at DESC);

CREATE TABLE IF NOT EXISTS sales_sim_mentor_notes (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sales_sim_sessions(id) ON DELETE CASCADE,
  mentor_username TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_sim_mentor_notes_session
  ON sales_sim_mentor_notes (session_id, created_at DESC);

ALTER TABLE sales_sim_ranks
  ADD COLUMN IF NOT EXISTS mentor_eligible BOOLEAN NOT NULL DEFAULT FALSE;
