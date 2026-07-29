-- Tier 1: dailyReports — daily_reports 表为权威（与 POS/人工日报交叉验证一致）
-- blob 中 dailyReports 仅为历史镜像；strip 前请核对：
--   SELECT COUNT(*) FROM daily_reports;
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data - 'dailyReports',
       updated_at = NOW()
 WHERE data ? 'dailyReports';
