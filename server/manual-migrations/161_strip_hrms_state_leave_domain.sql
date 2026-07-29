-- Tier 1: leave 域三字段 — hrms_leave_domain 表为权威
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data
     - 'leaveBalanceOverrides'
     - 'leaveBalanceAdjustments'
     - 'leaveCumulativeCloseSnapshots',
       updated_at = NOW()
 WHERE data ?| ARRAY['leaveBalanceOverrides', 'leaveBalanceAdjustments', 'leaveCumulativeCloseSnapshots'];
