-- 文件存储租户隔离：/uploads 之前是 express.static 裸露的公开静态目录，
-- 任何人拿到URL(哪怕是员工身份证照片)都能直接看，且没有任何租户边界。
-- 现在改为鉴权路由按文件归属租户校验后才流式返回；本表记录每个文件属于哪个租户。
-- 迁移前已存在的文件没有记录时，按 default 处理（这台服务器迁移前只有 default 租户）。
CREATE TABLE IF NOT EXISTS upload_file_owners (
  filename VARCHAR(300) PRIMARY KEY,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  uploaded_by VARCHAR(120),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
