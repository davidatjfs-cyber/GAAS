-- 124: 商业化验收批次1——把这两轮迭代里靠运行时 ALTER TABLE 建的字段收进正式migration，
-- 并补上并发去重用的唯一索引 + 案例对外使用授权字段。
-- 对应 docs/customer-sales-ai-commercial-acceptance.md 第九节发现的缺口。

-- 培育节奏引擎的进度字段(此前只在 sales-nurture.js 的 ensureNurtureColumns() 里运行时建)
ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS nurture_step INT NOT NULL DEFAULT 0,       -- 已推进到第几个培育节点(0=未开始)
  ADD COLUMN IF NOT EXISTS nurture_last_sent_at TIMESTAMPTZ;          -- 上一次生成培育任务的时间

-- 清理历史遗留的重复数据，否则下面的唯一索引会建不上（sales-store.js运行时已有兜底捕获，
-- 这里在migration里主动清一次，让保护真正生效而不是一直停留在"降级模式"）：
-- 同一 external_userid 若有多条 sales_leads，只保留最早的一条，其余的 external_userid 置空
-- (不删除线索本身，避免丢历史对话，只是让它不再参与"同一客户"的去重判断)。
WITH ranked AS (
  SELECT id, external_userid,
         ROW_NUMBER() OVER (PARTITION BY external_userid ORDER BY id ASC) AS rn
    FROM sales_leads
   WHERE external_userid IS NOT NULL
)
UPDATE sales_leads sl
   SET external_userid = NULL
  FROM ranked
 WHERE sl.id = ranked.id AND ranked.rn > 1;

-- 同理，同一 lead 下若已有多条状态为open、标题相同的任务，只保留最早一条，其余标记为取消，
-- 避免下面的唯一索引建不上。
WITH ranked AS (
  SELECT id, lead_id, title,
         ROW_NUMBER() OVER (PARTITION BY lead_id, title ORDER BY id ASC) AS rn
    FROM sales_tasks
   WHERE status = 'open'
)
UPDATE sales_tasks st
   SET status = 'superseded', updated_at = NOW()
  FROM ranked
 WHERE st.id = ranked.id AND ranked.rn > 1;

-- 并发去重的唯一索引兜底（对应竞态修复：upsertTask / upsertLead 现在走 ON CONFLICT）
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_leads_external_uid
  ON sales_leads (external_userid) WHERE external_userid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tasks_dedup_open
  ON sales_tasks (lead_id, title) WHERE status = 'open';

-- 案例是否已获授权对外展示给潜在客户(客户AI/销售提案会引用)。
-- 默认true=不改变现有已上线案例的可见行为，之后新增案例需要显式标记才会被客户AI推荐。
ALTER TABLE sales_case_assets
  ADD COLUMN IF NOT EXISTS external_approved BOOLEAN NOT NULL DEFAULT true;
