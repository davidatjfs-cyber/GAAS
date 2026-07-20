BEGIN;

-- 共享单域名登录（server/tenant-login.js resolveExplicitTenantId +
-- server/index.js lookupTenantIdByUsername）在客户端没有显式传 tenant_id 时，
-- 靠查一次 users.username 找出所在租户，前提是 username 全局唯一——但当时的
-- 约束是 UNIQUE(username, tenant_id)（按租户唯一），已经产生过真实冲突
-- （两个不同租户各自注册了 adminxie）。业务方确认：tenant_wkzec7cxng（上海
-- 年年有喜科技有限公司）继续用 adminxie；tenant_2wjavmfm0f 改名为 admin3。
UPDATE users
SET username = 'admin3'
WHERE tenant_id = 'tenant_2wjavmfm0f' AND lower(username) = 'adminxie';

-- 安全网：处理上面这条已知冲突之外，未预料到的其它重名（保留创建时间最早
-- 的账号用原用户名，其余的加租户后缀），确保这条迁移在任何环境都能把
-- username 收紧成全局唯一，而不只是修复这一次审计发现的这一对。
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
