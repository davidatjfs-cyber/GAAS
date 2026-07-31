-- 174: 门店陪练事故卡（大类 → 具体场景素材库）
-- 对话前先抽卡锁定事实；评分 = 知识/SOP + 客人体验

CREATE TABLE IF NOT EXISTS job_coach_scenario_categories (
  category_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  job_profile_keys TEXT[] NOT NULL DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_coach_incident_cards (
  card_key TEXT PRIMARY KEY,
  category_key TEXT NOT NULL REFERENCES job_coach_scenario_categories(category_key) ON DELETE CASCADE,
  job_profile_key TEXT NOT NULL REFERENCES job_coach_profiles(profile_key) ON DELETE CASCADE,
  title TEXT NOT NULL,
  difficulty INT NOT NULL DEFAULT 2,
  -- customer | staff | hr | regulator | mystery
  counterpart_role TEXT NOT NULL DEFAULT 'customer',
  incident_brief TEXT NOT NULL,
  locked_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  opening_line TEXT NOT NULL,
  success_criteria TEXT NOT NULL DEFAULT '',
  failure_signals TEXT[] NOT NULL DEFAULT '{}',
  sop_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  experience_rubric JSONB NOT NULL DEFAULT '[]'::jsonb,
  competency_keys TEXT[] NOT NULL DEFAULT '{}',
  kb_title_hints TEXT[] NOT NULL DEFAULT '{}',
  kb_article_ids UUID[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_cards_category
  ON job_coach_incident_cards (category_key, job_profile_key, active, difficulty);

CREATE INDEX IF NOT EXISTS idx_incident_cards_profile_comp
  ON job_coach_incident_cards USING GIN (competency_keys);

ALTER TABLE sales_sim_sessions
  ADD COLUMN IF NOT EXISTS incident_card_key TEXT,
  ADD COLUMN IF NOT EXISTS incident_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
