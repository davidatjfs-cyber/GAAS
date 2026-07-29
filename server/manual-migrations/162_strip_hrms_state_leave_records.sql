-- Tier 1: leaveRecords — hrms_leave_records 表为权威
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data - 'leaveRecords',
       updated_at = NOW()
 WHERE data ? 'leaveRecords';
