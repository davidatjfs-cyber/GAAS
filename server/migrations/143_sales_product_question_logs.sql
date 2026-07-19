-- 143: 客户 AI 系统功能问答的命中/未命中日志，用于持续补齐产品手册。

CREATE TABLE IF NOT EXISTS sales_product_question_logs (
  id BIGSERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  matched_card_id TEXT,
  match_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  answered BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'customer_ai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_product_question_logs_created
  ON sales_product_question_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_product_question_logs_unanswered
  ON sales_product_question_logs (answered, created_at DESC);
