-- 模式2批2: 考勤/休假/薪资相关表加 tenant_id，纯加列+默认值，零行为风险。
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_attendance_records_tenant ON attendance_records(tenant_id);

ALTER TABLE daily_report_attendance_register ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_daily_report_attendance_register_tenant ON daily_report_attendance_register(tenant_id);

ALTER TABLE employee_attendance_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_employee_attendance_records_tenant ON employee_attendance_records(tenant_id);

ALTER TABLE hrms_leave_balance_overrides ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_leave_balance_overrides_tenant ON hrms_leave_balance_overrides(tenant_id);

ALTER TABLE hrms_leave_domain ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_leave_domain_tenant ON hrms_leave_domain(tenant_id);

ALTER TABLE hrms_leave_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_leave_records_tenant ON hrms_leave_records(tenant_id);

ALTER TABLE hrms_payroll_domain ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_payroll_domain_tenant ON hrms_payroll_domain(tenant_id);

ALTER TABLE hrms_payroll_history ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_payroll_history_tenant ON hrms_payroll_history(tenant_id);
