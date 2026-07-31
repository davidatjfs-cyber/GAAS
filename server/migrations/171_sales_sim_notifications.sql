-- 171: 模拟训练训后通知（培训人站内信）

CREATE TABLE IF NOT EXISTS sales_sim_notifications (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  session_id BIGINT,
  track TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_sim_notifications_user
  ON sales_sim_notifications (username, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_sim_notifications_unread
  ON sales_sim_notifications (username, created_at DESC)
  WHERE read_at IS NULL;
