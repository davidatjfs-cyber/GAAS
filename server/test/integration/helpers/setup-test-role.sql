-- 集成测试专用：创建一个非superuser、非BYPASSRLS的角色供被测应用连接。
-- 本地默认的Postgres连接角色通常是superuser，superuser天生绕过RLS(不管表有没有
-- FORCE ROW LEVEL SECURITY)。如果应用测试时也用superuser连接，多租户隔离测试
-- 会"看起来通过"但实际上什么都没测到——生产环境的应用角色应该不是superuser。
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gaas_app_test') THEN
    CREATE ROLE gaas_app_test LOGIN PASSWORD 'gaas_app_test_pw' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO gaas_app_test;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gaas_app_test;
GRANT USAGE ON SCHEMA public TO gaas_app_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO gaas_app_test;
