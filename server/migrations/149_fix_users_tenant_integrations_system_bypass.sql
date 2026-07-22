-- 修复 users / tenant_integrations 两张表的 tenant_isolation 策略：
-- 缺少对系统上下文('__system__')的例外，导致 runWithSystemTenantContext()
-- 从未真正绕过这两张表的RLS（查询在RLS下永远返回0行，调用方各自的空值兜底
-- 会静默产生错误结果，而不是报错）。
--
-- 已确认受影响的调用点：
--   - index.js lookupTenantIdByUsername()：客户端登录时如果没显式传tenant_id，
--     会静默错误回退到'default'租户（生产环境的web前端working-fixed.html已经
--     显式传tenant_id绕开了这个问题，但不能依赖客户端行为兜底服务端的安全策略）
--   - feishu-sync.js resolveWebhookTenantId()：飞书webhook事件进来时用app_token
--     反查所属租户，这个场景下不可能有客户端提前指定tenant_id——任何配置了
--     自己独立飞书机器人的租户，其事件大概率被误判为'default'租户
--
-- 修复方式：比照 migrations/136_ai_quality_learning_flywheel.sql 里
-- ai_learning_policies 等表已验证过的正确写法（USING子句加 OR __system__ 例外），
-- 不是全新设计，是订正成本仓库里已经证明安全的既有模式。
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'tenant_integrations'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true) OR current_setting(''app.tenant_id'', true) = ''__system__'') WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true) OR current_setting(''app.tenant_id'', true) = ''__system__'')',
        t
      );
    END IF;
  END LOOP;
END $$;
