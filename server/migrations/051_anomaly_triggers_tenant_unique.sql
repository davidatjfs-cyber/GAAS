-- idx_anomaly_triggers_key_unique 原唯一索引(anomaly_key, store, trigger_date)不含tenant_id，
-- 两个租户若有同名门店在同一天触发同一异常，第二个会被ON CONFLICT DO NOTHING静默吞掉。
-- 改为含tenant_id的唯一索引。这张表被agents-service-v2(独立进程，同一个hrms数据库)使用。
DO $$
BEGIN
  IF to_regclass('public.anomaly_triggers') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_anomaly_triggers_key_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_triggers_key_unique ON anomaly_triggers (anomaly_key, store, trigger_date, tenant_id);
  END IF;
END $$;
