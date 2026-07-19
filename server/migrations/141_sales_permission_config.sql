-- 销售CRM分模块/分权限查看：角色可配置的数据可见范围(own/all)和可见模块列表。
-- 不填的角色回退到代码里的默认值(与改造前的硬编码行为完全一致)，不会因为没配置就出问题。
CREATE TABLE IF NOT EXISTS sales_permission_config (
  role TEXT PRIMARY KEY,
  data_scope TEXT NOT NULL DEFAULT 'own' CHECK (data_scope IN ('own','all')),
  modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
