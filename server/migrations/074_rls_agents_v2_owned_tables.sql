-- RLS Phase5全量推进第10批：10张表开RLS。这批表的写入方全部是agents-service-v2
-- (独立codebase，共用同一个hrms数据库)，不是hr-management-system，本次连带在
-- agents-service-v2那边发现并修复了一个根因级问题：authRequired中间件从来没有
-- 建立过ALS租户上下文(只把租户写进req.tenantId，跟query()读的tenantContext互不相通)，
-- 已在agents-service-v2单独commit修复(src/middleware/auth.js)，本批后续表都会
-- 直接受益于这个修复，不需要再逐个路由文件打补丁。
--
-- task_evidences/task_reviews/task_experience_logs (task-orchestrator.js)：
--   代码早已正确传tenant_id，本批只是开关。
-- ops_tasks (daily-execution-rating.js)：INSERT补了tenant_id，唯一约束
--   uq_ops_tasks_dedupe同步改成(dedupe_key, tenant_id)。
-- sop_definitions/sop_questions/sop_steps (sop-engine.js)：sop_steps早已正确
--   传tenant_id；definitions/questions的写入未抽样到具体INSERT位置但表结构
--   和测试结果显示数据已正确按租户落地，本批只是开关。
-- anomaly_pending_notifications：代码早已正确传tenant_id，本批只是开关。
-- idempotency_keys：PK从(key)改成(key, tenant_id)，ON CONFLICT同步更新；
--   飞书webhook入口(feishu-client.js)没有JWT/ALS，按生产现状先固定包裹default。
-- platform_data_cache：唯一约束(platform, store)改成补tenant_id，INSERT补
--   tenant_id列值。
ALTER TABLE task_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_evidences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_evidences
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE task_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_reviews
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE task_experience_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_experience_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_experience_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE ops_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops_tasks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sop_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sop_definitions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sop_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sop_questions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sop_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sop_steps
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE anomaly_pending_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_pending_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON anomaly_pending_notifications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE platform_data_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_data_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_data_cache
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
