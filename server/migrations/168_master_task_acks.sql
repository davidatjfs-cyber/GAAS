-- 2026-07-30：任务栏必须是"待清空的队列"，不是展示区——食品安全类cc视图(getNotableOpenTasks)
-- 抄送给所有admin/hq_manager，是共享查询、不针对某个人，之前没有任何per-user状态记录谁已经
-- "确认收到"过，导致这类任务永远留在每个人的列表里。这张表记录"某个用户已确认收到某条任务"，
-- 只影响该用户自己的列表(不影响任务本身状态，也不影响其他cc收件人)。

CREATE TABLE IF NOT EXISTS master_task_acks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  task_id VARCHAR(120) NOT NULL,
  username VARCHAR(80) NOT NULL,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, task_id, username)
);

CREATE INDEX IF NOT EXISTS idx_master_task_acks_lookup
  ON master_task_acks (tenant_id, username, task_id);

COMMENT ON TABLE master_task_acks IS 'per-user"已确认收到"标记，用于cc(仅同步知悉)类任务从个人任务栏清空，不改变任务本身状态';
