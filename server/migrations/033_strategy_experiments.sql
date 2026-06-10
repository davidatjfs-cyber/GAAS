-- Mirror of agents-service-v2 migration 028 for HRMS server
-- Strategy experiment framework tables

CREATE TABLE IF NOT EXISTS strategy_experiments (
  id                SERIAL PRIMARY KEY,
  experiment_code   VARCHAR(40) NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  goal              TEXT NOT NULL,
  metric_focus      VARCHAR(20) NOT NULL DEFAULT 'revenue',
  anomaly_type      VARCHAR(50),
  source_task_id    VARCHAR(60),
  status            VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
  assigned_stores   JSONB DEFAULT '[]',
  planned_start     DATE,
  planned_end       DATE,
  result_deadline   DATE,
  approved_by       VARCHAR(100),
  approved_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_by        VARCHAR(60) DEFAULT 'pllm',
  result_summary    JSONB,
  conclusion        TEXT,
  winner            VARCHAR(10),
  confidence        VARCHAR(20),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiments_status ON strategy_experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_code ON strategy_experiments(experiment_code);

CREATE TABLE IF NOT EXISTS strategy_variants (
  id                SERIAL PRIMARY KEY,
  experiment_id     INT NOT NULL REFERENCES strategy_experiments(id) ON DELETE CASCADE,
  variant_code      VARCHAR(10) NOT NULL,
  label             VARCHAR(100),
  action            TEXT NOT NULL,
  execution_guide   TEXT,
  store             VARCHAR(100) NOT NULL,
  assignee_username  VARCHAR(100),
  assignee_open_id   VARCHAR(100),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  result_data       JSONB,
  outcome_score     FLOAT,
  executed_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_experiment ON strategy_variants(experiment_id);
CREATE INDEX IF NOT EXISTS idx_variants_store ON strategy_variants(store);
CREATE INDEX IF NOT EXISTS idx_variants_status ON strategy_variants(status);

ALTER TABLE agent_experience ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'auto';
UPDATE agent_experience SET source = 'auto_deprecated' WHERE source = 'auto' OR source IS NULL;

DROP INDEX IF EXISTS strategy_rules_scenario_root_unique;
ALTER TABLE strategy_rules ADD COLUMN IF NOT EXISTS variant_label VARCHAR(10) DEFAULT NULL;
ALTER TABLE strategy_rules ADD COLUMN IF NOT EXISTS experiment_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE strategy_rules ADD COLUMN IF NOT EXISTS experiment_id INT REFERENCES strategy_experiments(id);

CREATE UNIQUE INDEX IF NOT EXISTS strategy_rules_scenario_root_variant_unique
  ON strategy_rules(scenario, root_cause, variant_label);