/**
 * SOP / training task DDL (P4 peel).
 */

/** @param {{ query: Function }} client */
export async function applyTrainingRelatedTablesDdl(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS sop_cases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',  -- draft/pending_confirm/confirmed/published
      source_review_id UUID,                 -- 关联的差评记录
      store TEXT NOT NULL,
      brand TEXT,
      event_detail TEXT NOT NULL,            -- 事件详细过程
      analysis TEXT,                         -- SOP分析内容
      improvement_actions TEXT,              -- 改进措施
      created_by TEXT,                       -- 创建者（Train Agent）
      confirmed_by TEXT,                     -- 确认者（店长）
      confirmed_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sop_cases_store ON sop_cases (store)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_sop_cases_status ON sop_cases (status)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS training_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,                    -- onboarding/skill_upgrade/management/culture
      title TEXT NOT NULL,                   -- 培训标题
      target_role TEXT NOT NULL,             -- 目标岗位 (e.g., store_manager, cashier)
      assignee_username TEXT NOT NULL,       -- 参训人员
      store TEXT NOT NULL,
      brand TEXT,
      status TEXT NOT NULL DEFAULT 'pending',-- pending/in_progress/completed/failed
      progress_data JSONB DEFAULT '{}',      -- 培训进度、考试成绩、反馈等
      due_date DATE,                         -- 截止日期
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_training_tasks_assignee ON training_tasks (assignee_username, status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_training_tasks_role ON training_tasks (target_role)`);
}
