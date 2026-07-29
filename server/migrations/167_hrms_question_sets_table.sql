-- Tier 2: questionSets 独立表（JSONB 存整套题组）
-- questionBank 仍留 blob 至后续 PR；本迁移仅 questionSets。
-- 仅写脚本，不在 CI/生产自动执行。

CREATE TABLE IF NOT EXISTS hrms_question_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  set_index INT NOT NULL DEFAULT 0,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, set_index)
);

CREATE INDEX IF NOT EXISTS idx_hrms_question_sets_tenant
  ON hrms_question_sets (tenant_id, set_index);

COMMENT ON TABLE hrms_question_sets IS '考试题组（自 hrms_state.questionSets 外提）';
