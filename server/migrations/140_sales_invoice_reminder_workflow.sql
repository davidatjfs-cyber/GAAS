-- 140: 开票提醒工作流——订单标记已付款/授信通过后自动生成待开票申请，
-- 财务/客服可以标记"已开票"或"忽略开票(客户不需要发票)"来停止提醒。
ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS order_id BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ignored_reason TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- 一个订单最多一条自动生成的开票申请，避免付款/授信状态被重复触发时插入重复行。
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_invoices_order_unique
  ON sales_invoices (order_id) WHERE order_id IS NOT NULL;
