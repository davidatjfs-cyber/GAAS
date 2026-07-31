-- 175: 事故卡标准答法 + 追问题纲（复盘纠错 / 对话不复读）

ALTER TABLE job_coach_incident_cards
  ADD COLUMN IF NOT EXISTS model_answer TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS probe_questions JSONB NOT NULL DEFAULT '[]'::jsonb;
