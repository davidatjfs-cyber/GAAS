-- RLS Phase5全量推进第3批：3张表的唯一约束补tenant_id(sop-distribution.js/hrms-api-tools.js)
ALTER TABLE sop_distributions DROP CONSTRAINT IF EXISTS sop_distributions_sop_version_id_employee_username_key;
ALTER TABLE sop_distributions ADD CONSTRAINT sop_distributions_sop_version_id_employee_username_key UNIQUE (sop_version_id, employee_username, tenant_id);

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_store_employee_username_shift_date_key;
ALTER TABLE schedules ADD CONSTRAINT schedules_store_employee_username_shift_date_key UNIQUE (store, employee_username, shift_date, tenant_id);

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_employee_username_record_date_key;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_employee_username_record_date_key UNIQUE (employee_username, record_date, tenant_id);
