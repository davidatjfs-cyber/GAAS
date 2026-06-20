-- 给核心规范化表加 tenant_id 列，为多租户改造打地基。
-- 纯加列+默认值，不改任何现有查询逻辑，零行为风险——
-- 所有现有数据自动归入 'default' 租户，现网马己仙/洪潮使用不受影响。

ALTER TABLE training_topics          ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE training_assignments     ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE training_certifications  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE growth_actions           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE ab_test_tasks            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
ALTER TABLE strategy_experiments     ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_training_topics_tenant         ON training_topics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_assignments_tenant    ON training_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_certifications_tenant ON training_certifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_growth_actions_tenant          ON growth_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_tasks_tenant           ON ab_test_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_strategy_experiments_tenant    ON strategy_experiments(tenant_id);
