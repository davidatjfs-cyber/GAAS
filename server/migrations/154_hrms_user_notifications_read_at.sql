-- 系统通知强制确认：已读状态落到服务端，避免仅靠 localStorage 导致每次登录重复弹窗
ALTER TABLE hrms_user_notifications
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_hrms_notif_user_unread
  ON hrms_user_notifications (target_username, created_at DESC)
  WHERE read_at IS NULL;
