-- 模式2批2: 考勤/休假/薪资相关表加 tenant_id，纯加列+默认值，零行为风险。
DO $$
DECLARE t TEXT; idx TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_records','daily_report_attendance_register','employee_attendance_records','hrms_leave_balance_overrides','hrms_leave_domain','hrms_leave_records','hrms_payroll_domain','hrms_payroll_history'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT %L', t, 'default');
      idx := 'idx_' || t || '_tenant';
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(tenant_id)', idx, t);
    END IF;
  END LOOP;
END $$;
