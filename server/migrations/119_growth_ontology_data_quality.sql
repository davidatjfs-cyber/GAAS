-- 119: Data Trust Engine——数据可信度引擎的落库层。
-- 任何一条"自证"数据(员工自己打卡/自己上传)在进入基准库/AI推理前，
-- 先经过这张表算出的trust_score过滤，不是简单的true/false，是0-100连续分值。

CREATE TABLE IF NOT EXISTS growth_ontology_data_quality (
  id BIGSERIAL PRIMARY KEY,
  data_id TEXT NOT NULL,          -- 原始数据ID(如任务ID/打卡ID/POS订单ID)
  data_type TEXT NOT NULL,        -- 任务/打卡/培训/POS/库存 等
  tenant_id TEXT NOT NULL,
  store_id TEXT,
  source_type TEXT NOT NULL,      -- 见 data-trust-service.js SOURCE_TRUST_WEIGHTS
  trust_score NUMERIC NOT NULL,   -- 0-100
  confidence_level TEXT NOT NULL, -- high/medium/low/suspect/conflict (见 classifyTrustLevel)
  conflict_flag BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_rules JSONB NOT NULL DEFAULT '[]'::jsonb, -- 命中的冲突规则ID列表
  verification_sources JSONB NOT NULL DEFAULT '[]'::jsonb, -- 参与交叉验证的数据源列表
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb, -- 各维度得分明细，供审计/调参
  review_status TEXT NOT NULL DEFAULT 'pending', -- pending/approved/rejected
  reviewer TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (data_id, data_type)
);
CREATE INDEX IF NOT EXISTS idx_ontology_data_quality_lookup ON growth_ontology_data_quality (tenant_id, store_id, data_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ontology_data_quality_conflict ON growth_ontology_data_quality (conflict_flag, review_status) WHERE conflict_flag = TRUE;
CREATE INDEX IF NOT EXISTS idx_ontology_data_quality_trust ON growth_ontology_data_quality (trust_score);

COMMENT ON TABLE growth_ontology_data_quality IS 'Data Trust Engine落库层：每条待判定数据的可信度评分+冲突标记，进基准库/AI推理前的过滤闸门';
COMMENT ON COLUMN growth_ontology_data_quality.trust_score IS '0-100连续分值，非二元true/false；<60默认不进Benchmark，<30隔离待人工复核';
