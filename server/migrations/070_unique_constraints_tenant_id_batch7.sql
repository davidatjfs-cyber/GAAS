-- RLS Phase5全量推进第8批：agent_*集群2张表的唯一约束补tenant_id
ALTER TABLE agent_autonomous_tasks DROP CONSTRAINT IF EXISTS agent_autonomous_tasks_fingerprint_key;
ALTER TABLE agent_autonomous_tasks ADD CONSTRAINT agent_autonomous_tasks_fingerprint_key UNIQUE (fingerprint, tenant_id);

ALTER TABLE agent_scores DROP CONSTRAINT IF EXISTS uq_agent_scores_period;
ALTER TABLE agent_scores ADD CONSTRAINT uq_agent_scores_period UNIQUE (brand, store, username, period, tenant_id);
