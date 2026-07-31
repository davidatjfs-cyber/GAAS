-- 172: Talent Engine P0
-- Ability Library / Job Profile / Competency(version) / Coach Persona / Coach Memory
-- Job Coach Runtime 仍使用 sales_sim_* 会话表

CREATE TABLE IF NOT EXISTS talent_abilities (
  ability_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_coach_profiles (
  profile_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role_matchers JSONB NOT NULL DEFAULT '[]'::jsonb,
  position_matchers JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_coach_persona_key TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_coach_competencies (
  id BIGSERIAL PRIMARY KEY,
  job_profile_key TEXT NOT NULL REFERENCES job_coach_profiles(profile_key) ON DELETE CASCADE,
  competency_key TEXT NOT NULL,
  ability_key TEXT NOT NULL REFERENCES talent_abilities(ability_key),
  label TEXT NOT NULL,
  weight NUMERIC(6,3) NOT NULL DEFAULT 1.0,
  pass_score INT NOT NULL DEFAULT 75,
  version INT NOT NULL DEFAULT 1,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  recommended_topic_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_kb_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  kpi_metric_key TEXT,
  sort_order INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_profile_key, competency_key, version)
);

CREATE INDEX IF NOT EXISTS idx_job_coach_competencies_profile_active
  ON job_coach_competencies (job_profile_key, active, version DESC);

CREATE TABLE IF NOT EXISTS job_coach_coach_personas (
  persona_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tone_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  debrief_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS talent_coach_memory (
  username TEXT NOT NULL,
  job_profile_key TEXT NOT NULL REFERENCES job_coach_profiles(profile_key) ON DELETE CASCADE,
  focus_competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  boost_until TIMESTAMPTZ,
  recent_persona_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  recent_scenario_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, job_profile_key)
);

-- Runtime session: profile / coach persona / competency version snapshot
ALTER TABLE sales_sim_sessions
  ADD COLUMN IF NOT EXISTS job_profile_key TEXT,
  ADD COLUMN IF NOT EXISTS coach_persona_key TEXT,
  ADD COLUMN IF NOT EXISTS competency_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE sales_sim_sessions
   SET job_profile_key = track
 WHERE job_profile_key IS NULL;

-- Relax track CHECKs so future store job profiles can reuse runtime tables
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname, cls.relname
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
     WHERE con.contype = 'c'
       AND cls.relname IN (
         'sales_sim_personas', 'sales_sim_playbooks', 'sales_sim_sessions',
         'sales_sim_skill_profiles', 'sales_sim_ranks'
       )
       AND pg_get_constraintdef(con.oid) ILIKE '%track%'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.relname, r.conname);
  END LOOP;
END $$;
