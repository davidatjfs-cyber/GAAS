-- Tier 1: payrollAdjustments/payrollAudits/salaryAdjustments/monthlyConfirmations
-- hrms_payroll_domain 表为权威；strip blob 镜像字段。
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data
     - 'payrollAdjustments'
     - 'payrollAudits'
     - 'salaryAdjustments'
     - 'monthlyConfirmations',
       updated_at = NOW()
 WHERE data ?| ARRAY['payrollAdjustments', 'payrollAudits', 'salaryAdjustments', 'monthlyConfirmations'];
