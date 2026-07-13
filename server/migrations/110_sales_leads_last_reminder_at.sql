-- 110: 销售AI「超时未跟进」定时提醒去重字段
-- 记录上一次因“高意向未接管”发送提醒的时间，避免同一线索被反复轰炸提醒。
ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;
