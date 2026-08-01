-- 176: master_tasks 补 created_by（发起人）列
-- 用户要求责任人在工作台任务卡上能看到"发起人"，之前只有source_data.created_by(jsonb，
-- 未结构化、agents-service-v2侧createBoardTask默认落'unknown')，没有真实列可供查询展示。

ALTER TABLE master_tasks
  ADD COLUMN IF NOT EXISTS created_by TEXT;
