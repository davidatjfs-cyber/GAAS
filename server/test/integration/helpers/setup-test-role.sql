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
-- 生产环境的 hrms 角色确实有 public schema 的 CREATE 权限(已通过SSH核实)，
-- 多个路由在请求时会调用形如 ensureXxxTables() 的"顺手建表"逻辑(CREATE TABLE
-- IF NOT EXISTS)，为了让测试环境如实反映生产权限，这里也要授权，否则会看到
-- "permission denied for schema public"——这不是要测的行为，只是测试角色权限
-- 配置不够，会掩盖真正的业务逻辑测试。
GRANT CREATE ON SCHEMA public TO gaas_app_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO gaas_app_test;

-- 生产环境的 hrms 角色是自己建的表的owner(已通过SSH核实:
-- select tableowner from pg_tables where tablename='marketing_campaigns' → hrms)。
-- 本地测试库是用superuser跑migrate.js建的表，owner是superuser，不是gaas_app_test，
-- 导致 CREATE INDEX / ALTER TABLE 这类"顺手加字段/加索引"的运行时DDL报
-- "must be owner of table xxx"——这在生产不会发生(hrms本来就是owner)，
-- 纯粹是本地建库方式和生产不一致，这里统一把所有表/序列的owner转给测试角色。
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO gaas_app_test', r.tablename);
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE %I OWNER TO gaas_app_test', r.sequencename);
  END LOOP;
END
$$;
