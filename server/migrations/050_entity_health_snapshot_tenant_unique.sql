-- uq_entity_health_day 原唯一约束(entity_type, entity_id, snapshot_date)不含tenant_id，
-- 两个租户若有同名门店会在同一天互相覆盖对方的健康度快照。改为含tenant_id的唯一约束。
ALTER TABLE entity_health_snapshot DROP CONSTRAINT IF EXISTS uq_entity_health_day;
ALTER TABLE entity_health_snapshot ADD CONSTRAINT uq_entity_health_day
  UNIQUE (entity_type, entity_id, snapshot_date, tenant_id);
