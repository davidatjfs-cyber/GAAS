# @gaas/shared：同步与生产软链

权威包在 **GAAS** `packages/gaas-shared`（飞书验签 / tenant token / `SHARED_TABLES`）。
agents-service-v2 仓库内 `packages/gaas-shared` 是**同步副本**，不是第二权威。

## 本地改共享代码

1. 只改 GAAS：`packages/gaas-shared/**`
2. 同步到 agents：

```bash
# 在 GAAS 仓根目录
node scripts/sync-gaas-shared.mjs
```

3. **两边都提交**：
   - GAAS：`packages/gaas-shared` + 若有引用方改动
   - agents-service-v2：`packages/gaas-shared`（同步产物）

4. 本地解析路径：
   - GAAS：`node_modules/@gaas/shared` → `../../packages/gaas-shared`（workspace / file:）
   - agents：`package.json` 里 `"@gaas/shared": "file:packages/gaas-shared"`

## 生产部署（47.100.96.30）

两仓部署后都要保证 `node_modules/@gaas/shared` 指向**本进程包副本**（或软链到该副本），不要指向另一服务目录的漂移副本。

### GAAS（hrms-service）

```bash
# 代码 scp 到 /opt/hrms 后：
mkdir -p /opt/hrms/node_modules/@gaas
ln -sfn /opt/hrms/packages/gaas-shared /opt/hrms/node_modules/@gaas/shared
# 校验
node -e "import('@gaas/shared').then(m=>console.log('SHARED_TABLES',!!m.SHARED_TABLES)).catch(e=>{console.error(e);process.exit(1)})"
# 工作目录需在 /opt/hrms/server 或 NODE_PATH 能解析到 /opt/hrms/node_modules
cd /opt/hrms/server && node -e "import('@gaas/shared').then(m=>console.log(Object.keys(m.SHARED_TABLES||{}).length))"
pm2 restart hrms-service
```

当前生产约定：`/opt/hrms/node_modules/@gaas/shared` → `../../packages/gaas-shared`。

### agents-service-v2

```bash
# 代码 scp 到 /opt/agents-service-v2 后：
mkdir -p /opt/agents-service-v2/node_modules/@gaas
ln -sfn /opt/agents-service-v2/packages/gaas-shared /opt/agents-service-v2/node_modules/@gaas/shared
node -e "import('@gaas/shared').then(m=>console.log('ok',!!m.SHARED_TABLES)).catch(e=>{console.error(e);process.exit(1)})"
pm2 restart agents-service-v2
```

当前生产约定：`/opt/agents-service-v2/node_modules/@gaas/shared` → `/opt/agents-service-v2/packages/gaas-shared`。

## 注意

- **禁止**在 agents 仓手改 `packages/gaas-shared` 后不同步回 GAAS（下次 sync 会被覆盖）。
- 共享表 schema 只走 **GAAS `server/migrations/`**；agents 禁止为共享表新建 migration。
- 业务 SQL 表名优先 `SHARED_TABLES.*`，避免魔法字符串漂移。
