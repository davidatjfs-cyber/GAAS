BEGIN;

-- 共享单域名登录（server/tenant-login.js resolveExplicitTenantId +
-- server/index.js lookupTenantIdByUsername）在客户端没有显式传 tenant_id 时，
-- 靠查一次 users.username 找出所在租户，前提是 username 全局唯一——但当时的
-- 约束是 UNIQUE(username, tenant_id)（按租户唯一），已经产生过真实冲突
-- （两个不同租户各自注册了 adminxie）。这里先把已存在的冲突自动改名解决
-- （保留创建时间最早的账号用原用户名，其余的加租户后缀），再收紧约束为
-- 全局唯一，避免以后再出现同名账号导致登录被路由到错误租户。
DO $$
DECLARE
  dup RECORD;
  dup_row RECORD;
  suffix TEXT;
  seq INT;
BEGIN
  FOR dup IN
    SELECT lower(username) AS uname
    FROM users
    GROUP BY lower(username)
    HAVING count(*) > 1
  LOOP
    seq := 0;
    FOR dup_row IN
      SELECT id, tenant_id
      FROM users
      WHERE lower(username) = dup.uname
      ORDER BY created_at ASC, id ASC
      OFFSET 1
    LOOP
      seq := seq + 1;
      suffix := substr(regexp_replace(dup_row.tenant_id, '[^A-Za-z0-9]', '', 'g'), 1, 12);
      UPDATE users
      SET username = dup.uname || '_' || COALESCE(NULLIF(suffix, ''), seq::text)
      WHERE id = dup_row.id;
      RAISE NOTICE 'users_username_global_unique: renamed duplicate username % (tenant %) to avoid global collision', dup.uname, dup_row.tenant_id;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);

COMMIT;
