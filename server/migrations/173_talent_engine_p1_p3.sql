-- 173: Talent Engine P1–P3
-- 场景库、考试模式、培训事件、真实案例来源字段

CREATE TABLE IF NOT EXISTS job_coach_scenarios (
  scenario_key TEXT PRIMARY KEY,
  job_profile_key TEXT NOT NULL REFERENCES job_coach_profiles(profile_key) ON DELETE CASCADE,
  title TEXT NOT NULL,
  difficulty INT NOT NULL DEFAULT 1,
  goal TEXT NOT NULL DEFAULT '',
  success_condition TEXT NOT NULL DEFAULT '',
  failure_condition TEXT NOT NULL DEFAULT '',
  default_persona_key TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_coach_scenarios_profile
  ON job_coach_scenarios (job_profile_key, active, difficulty);

CREATE TABLE IF NOT EXISTS job_coach_scenario_competencies (
  scenario_key TEXT NOT NULL REFERENCES job_coach_scenarios(scenario_key) ON DELETE CASCADE,
  competency_key TEXT NOT NULL,
  weight NUMERIC(6,3) NOT NULL DEFAULT 1.0,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (scenario_key, competency_key)
);

-- 会话考试模式 / 场景 / 事实闸门命中
ALTER TABLE sales_sim_sessions
  ADD COLUMN IF NOT EXISTS exam_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scenario_key TEXT,
  ADD COLUMN IF NOT EXISTS fact_gate JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 陪练完成 → 培训域事件（Learning Loop 挂钩，不复制认证逻辑）
CREATE TABLE IF NOT EXISTS talent_training_events (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  tenant_id TEXT,
  job_profile_key TEXT NOT NULL,
  session_id BIGINT,
  event_type TEXT NOT NULL,
  competency_key TEXT,
  topic_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_talent_training_events_user
  ON talent_training_events (username, job_profile_key, created_at DESC);

-- 真实案例生成来源（客诉/巡店等预留）
CREATE TABLE IF NOT EXISTS talent_case_sources (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  title TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  suggested_profile_key TEXT,
  suggested_scenario_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_talent_case_sources_status
  ON talent_case_sources (status, created_at DESC);
