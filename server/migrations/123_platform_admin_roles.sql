-- 123: 平台管理员角色分级——之前platform_admins登录后是"全权限"，没有区分
-- 超级管理员 vs 销售/客服/销售经理这类只该看销售模块、不该碰租户开通/系统配置的角色。
--
-- 已存在的账号一律给 'super_admin'(保留现有访问权限，不会因为这次迁移被锁出去)，
-- 新建账号今后必须显式指定角色(见 server/tenant-platform-routes.js 的账号创建接口)。

ALTER TABLE platform_admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin';

COMMENT ON COLUMN platform_admins.role IS 'super_admin(全权限：租户开通/配置/系统设置) / sales_manager(销售模块全权限含提成规则/KPI打分) / sales(销售模块，不含提成规则设置和KPI打分) / customer_service(销售模块，仅客户接待/拜访，不含成交/提成/KPI)';
