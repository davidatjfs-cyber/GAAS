-- growth-api.js#recomputeCustomerProfiles 的 ON CONFLICT (phone, tenant_id) 依赖这个唯一索引，
-- 但HRMS/demo两边都从未真正建过，导致该函数每次调用都报
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"（非致命，被catch吞掉）。
-- 2026-07-03排查多租户cron任务时发现，HRMS和demo都补建。
CREATE UNIQUE INDEX IF NOT EXISTS idx_growth_customer_profiles_phone_tenant
  ON growth_customer_profiles (phone, tenant_id)
  WHERE phone IS NOT NULL AND phone <> '';
