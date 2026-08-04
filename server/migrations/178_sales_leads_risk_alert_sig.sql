-- 2026-08-04 风险客户提醒去重：
-- 记录每个线索最近一次「已发送」的风险集合签名。runRiskAlerts 只在签名变化时
-- 重新发送，避免同一批风险（如未确认决策角色）每 4 小时对管理员重复轰炸。
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS last_risk_alert_sig TEXT;
