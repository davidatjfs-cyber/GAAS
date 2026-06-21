-- RLS Phase5: 4张表的唯一约束不含tenant_id，配合ON CONFLICT目标列表同批修正
-- (recipe-management.js / feishu-sync.js)，否则会重演anomaly_triggers那次
-- "no unique or exclusion constraint matching ON CONFLICT specification"报错。
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS uq_recipe;
ALTER TABLE recipes ADD CONSTRAINT uq_recipe UNIQUE (dish_name, store, version, tenant_id);

ALTER TABLE kitchen_reports DROP CONSTRAINT IF EXISTS kitchen_reports_store_report_date_report_type_station_key;
ALTER TABLE kitchen_reports ADD CONSTRAINT kitchen_reports_store_report_date_report_type_station_key UNIQUE (store, report_date, report_type, station, tenant_id);

ALTER TABLE store_meeting_reports DROP CONSTRAINT IF EXISTS store_meeting_reports_store_meeting_date_key;
ALTER TABLE store_meeting_reports ADD CONSTRAINT store_meeting_reports_store_meeting_date_key UNIQUE (store, meeting_date, tenant_id);

ALTER TABLE material_receiving_reports DROP CONSTRAINT IF EXISTS material_receiving_reports_store_brand_report_date_key;
ALTER TABLE material_receiving_reports ADD CONSTRAINT material_receiving_reports_store_brand_report_date_key UNIQUE (store, brand, report_date, tenant_id);
