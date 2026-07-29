-- Tier 1: flow config — hr_rating_configs 表为权威（roleModules/approvalFlows/paymentFlowByStore）
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data
     - 'roleModules'
     - 'approvalFlows'
     - 'paymentFlowByStore',
       updated_at = NOW()
 WHERE data ?| ARRAY['roleModules', 'approvalFlows', 'paymentFlowByStore'];
