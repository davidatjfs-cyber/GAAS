-- 169: AI 客户模拟训练中心（sales-sim）
-- 人格 / 会话 / 话轮 / 复盘 / L2 话术库 / 能力画像 / 职级

CREATE TABLE IF NOT EXISTS sales_sim_personas (
  id BIGSERIAL PRIMARY KEY,
  persona_key TEXT NOT NULL UNIQUE,
  track TEXT NOT NULL CHECK (track IN ('sales', 'cs')),
  title TEXT NOT NULL,
  difficulty INT NOT NULL DEFAULT 1,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  opening_line TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_sim_playbooks (
  id BIGSERIAL PRIMARY KEY,
  track TEXT NOT NULL CHECK (track IN ('sales', 'cs')),
  scene_key TEXT NOT NULL,
  title TEXT NOT NULL,
  trigger_patterns TEXT[] NOT NULL DEFAULT '{}',
  principle_ids TEXT[] NOT NULL DEFAULT '{}',
  exemplar_text TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '参考',
  status TEXT NOT NULL DEFAULT 'approved',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (track, scene_key)
);

CREATE TABLE IF NOT EXISTS sales_sim_sessions (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('sales', 'cs')),
  persona_key TEXT NOT NULL,
  difficulty INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  emotion INT NOT NULL DEFAULT 50,
  trust INT NOT NULL DEFAULT 40,
  close_readiness INT NOT NULL DEFAULT 15,
  satisfaction INT NOT NULL DEFAULT 60,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_sec INT NOT NULL DEFAULT 0,
  outcome TEXT,
  debrief JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sales_sim_sessions_user_track
  ON sales_sim_sessions (username, track, started_at DESC);

CREATE TABLE IF NOT EXISTS sales_sim_turns (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sales_sim_sessions(id) ON DELETE CASCADE,
  turn_no INT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'trainee', 'coach')),
  content TEXT NOT NULL DEFAULT '',
  coach_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  principle_hits JSONB NOT NULL DEFAULT '[]'::jsonb,
  state_delta JSONB NOT NULL DEFAULT '{}'::jsonb,
  voice BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, turn_no, role)
);

CREATE INDEX IF NOT EXISTS idx_sales_sim_turns_session ON sales_sim_turns (session_id, turn_no);

CREATE TABLE IF NOT EXISTS sales_sim_skill_profiles (
  username TEXT NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('sales', 'cs')),
  skills JSONB NOT NULL DEFAULT '{}'::jsonb,
  sessions_count INT NOT NULL DEFAULT 0,
  effective_minutes INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, track)
);

CREATE TABLE IF NOT EXISTS sales_sim_ranks (
  username TEXT NOT NULL,
  track TEXT NOT NULL CHECK (track IN ('sales', 'cs')),
  rank_key TEXT NOT NULL,
  effective_minutes INT NOT NULL DEFAULT 0,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (username, track)
);

CREATE TABLE IF NOT EXISTS sales_sim_rank_events (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  track TEXT NOT NULL,
  from_rank TEXT,
  to_rank TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_sim_rank_events_user
  ON sales_sim_rank_events (username, track, created_at DESC);
