-- 模式2批3: 飞书/企微相关表加 tenant_id。
--
-- 分类依据（以全仓库 CREATE TABLE/运行时 ensure 路径核实）：
-- * feishu_users：正式表，005 已创建；表存在时必须补租户列。
-- * feishu_generic_records、feishu_sync_logs：历史/可选集成表，主要由 server/index.js
--   的 ensureFeishu* 在启用对应能力时创建；空库无配置时允许不存在。
-- * feishu_pending_pllm_decisions、feishu_pending_replies：baseline/legacy 表，正式完整
--   结构在 093/101 出现；本迁移不能提前创建，也不能因空库缺失而阻断。
-- * store_wecom_configs、wechat_work_customers：企微可选功能表，正式结构在 093/101 或
--   growth 运行时 ensure 路径出现；表存在时迁移，表不存在时安全跳过。
-- 每张表独立判断，禁止用占位表掩盖正式schema顺序问题。
DO $$
DECLARE t TEXT; idx TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['feishu_generic_records','feishu_pending_pllm_decisions','feishu_pending_replies','feishu_sync_logs','feishu_users','store_wecom_configs','wechat_work_customers'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT %L', t, 'default');
      idx := 'idx_' || t || '_tenant';
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(tenant_id)', idx, t);
    END IF;
  END LOOP;
END $$;
