-- 177: 租户平台 schema 所有权收敛（2026-08-01 拍板）。
--
-- 背景：tenants/licenses 此前由 agents-service-v2 的 029 迁移创建（该定义没有
-- max_stores），GAAS 后续在 117_license_store_quota.sql 单独补了 max_stores——
-- 同一张表两边各自演进。本次把定义收敛到 GAAS 权威链，agents-v2 029/030 退役为
-- no-op（保留文件名维持 _migrations 已应用记录）。
--
-- 列集与生产 47.100.96.30（只读核实 2026-08-01）一致；CREATE TABLE IF NOT EXISTS
-- 幂等，已存在环境零影响。RLS 的 ENABLE/FORCE 不在这里——由
-- server/scripts/apply-tenant-rls.mjs 在 TENANT_MODE=multi 的 demo 环境显式执行，
-- 单租户生产保持 relrowsecurity=false。

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id   VARCHAR(80) PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  mode        VARCHAR(20) NOT NULL DEFAULT 'managed',
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON COLUMN tenants.mode IS 'managed(我们部署运营) | licensed(客户自有服务器租赁)';
COMMENT ON COLUMN tenants.status IS 'active | suspended | terminated';

CREATE TABLE IF NOT EXISTS licenses (
  id                SERIAL PRIMARY KEY,
  tenant_id         VARCHAR(80) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  license_key       TEXT NOT NULL UNIQUE,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'active',
  allowed_features  JSONB DEFAULT '[]',
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  max_stores        INTEGER
);
COMMENT ON COLUMN licenses.status IS 'active | revoked | expired';
COMMENT ON COLUMN licenses.last_seen_at IS '最近一次心跳校验通过时间，用于离线宽限期判断';
COMMENT ON COLUMN licenses.max_stores IS '已购买的门店数量上限；NULL=不限制(兼容历史租户)。POST /api/stores 建店前会校验此值。';

CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);

-- default 租户种子：现有单租户生产（马己仙/洪潮共用一套部署）的语义由 GAAS 侧定义。
-- 仅当 tenants 未开启 RLS 时写入（单租户生产 / 全新环境）：demo 等托管环境里 tenants
-- 已被 RLS 策略保护（全局表被策略覆盖是历史漂移，见 apply-tenant-rls 的清单外警告），
-- 该环境下租户注册由平台建租户流程负责，种子跳过以避免迁移被策略拦截。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tenants' AND relrowsecurity = true) THEN
    INSERT INTO tenants (tenant_id, name, mode, status)
    VALUES ('default', '默认租户(现有生产)', 'managed', 'active')
    ON CONFLICT (tenant_id) DO NOTHING;
  END IF;
END $$;
