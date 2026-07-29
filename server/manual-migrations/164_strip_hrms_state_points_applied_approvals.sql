-- Tier 2: pointsAppliedApprovals — 幂等改查 point_records.approval_id
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data - 'pointsAppliedApprovals',
       updated_at = NOW()
 WHERE data ? 'pointsAppliedApprovals';
