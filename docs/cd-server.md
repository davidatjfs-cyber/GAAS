# CD server（手动 + 自动）

生产仍是 **scp/打包拼装**。提供两套 GitHub Actions：

| Workflow | 触发 | 默认 |
|----------|------|------|
| **CD server (manual)** | `workflow_dispatch` | 可用；推荐先 `dry_run: true` |
| **CD server (auto)** | CI 在 `main` 上 **push** 且结论 success | 由 Variable `CD_AUTO_ENABLED=true` 开关 |

自动/手动 CD 都走 `scripts/deploy-server-files.sh`：**本地 tar 打包 → 单次 scp → 远端解包 + md5 + bak**，避免逐文件 SSH 往返在慢链路上超时。  
job 设 `timeout-minutes: 25`，超时记为 **failure**（可告警），不是 cancelled。

自动 CD 只部署本次变更的 `server/domains|utils|services|ontology` 下 `.js/.mjs`。  
禁止覆盖：`server/index.js`、`server/agents.js`、`server/growth-api.js`、任何 `.env`。

健康检查失败时，脚本会从  
`/opt/hrms-archive/deploy-bak/server-<ts>/` **按相对路径**自动回滚本次覆盖的文件并 reload。

## 一次配置（账号持有人）

仓库 Settings → Secrets and variables → Actions：

| Secret / Variable | 说明 |
|-------------------|------|
| `DEPLOY_SSH_KEY` | 能登录 `root@47.100.96.30` 的私钥全文（含 `BEGIN`/`END`）；推荐专用 deploy key |
| `DEPLOY_HOST` | 可选，默认 `root@47.100.96.30` |
| `DEPLOY_KNOWN_HOSTS` | 可选；不设则 workflow 内 `ssh-keyscan` |
| **`CD_AUTO_ENABLED`**（Variable） | 设为 `true` 才启用自动 CD；不设或其它值 = 关闭 |

再新建 Environment **`production`**（Settings → Environments），可加必需审阅人。  
自动/手动 CD job 使用该 environment。

配置后建议先跑一次 **CD server (manual)**（`dry_run: false` + 单个小文件）确认端到端绿灯。

## 手动使用

Actions → **CD server (manual)** → Run workflow：

1. `dry_run: true` — 只拉生产行数摘要，不上传  
2. 确认后同一路径 `dry_run: false`

巨石入口仍用本地：

```bash
./scripts/deploy-server-files.sh server/domains/foo/bar.js
```

## 自动使用

1. 配好 secrets + `CD_AUTO_ENABLED=true` + `production` environment  
2. 合并/推送到 `main` 且 CI 全绿后，`CD server (auto)` 会挑选变更文件打包部署  
3. 无 allowlisted 文件变更则 skip  
4. 健康检查失败 → 自动回滚 → job **failure**（需人工排查）

## 失败回滚（手动）

若自动回滚未覆盖（例如 NEW 文件无 bak）：

```bash
# bak 目录见失败日志 bak=/opt/hrms-archive/deploy-bak/server-<ts>
# bak 内保留相对路径，例如 domains/foo/bar.js
scp root@47.100.96.30:/opt/hrms-archive/deploy-bak/server-<ts>/server/domains/foo/bar.js /tmp/
./scripts/deploy-server-files.sh server/domains/foo/bar.js
```

## 进程管理：ecosystem.config.cjs

PM2 启动参数（`instances`/`exec_mode`/`max_memory_restart` 等）现固化在根目录
[`ecosystem.config.cjs`](../ecosystem.config.cjs)（2026-07-28 前一直是手敲 `pm2 start` 命令，从未进版本控制，
灾备重建只能靠 `pm2 describe` 反推）。真实密钥仍只放 `/opt/hrms/server/.env`，不进这个文件。

日常改代码部署走 `deploy-server-files.sh`（内部用 `pm2 reload`），**不需要**碰这个文件。
只有整机重建/进程被误删时才需要：

```bash
cd /opt/hrms && pm2 delete hrms-service 2>/dev/null; pm2 start ecosystem.config.cjs --update-env
```

## 已知坑（2026-07 全量部署踩过，`deploy-server-files.sh` 本身不受影响）

以下两个问题出现在**手工用 tar 打包整个 `server/` 目录做一次性大批量迁移**时（而不是
`deploy-server-files.sh` 的逐文件 scp 路径），记录下来避免以后重复踩：

1. **`tar --exclude` 必须锚定路径，不能只写目录名**：`tar --exclude='uploads' --exclude='reports'`
   会匹配任意深度下同名目录，误伤了真实代码目录 `server/domains/uploads/` 和 `server/domains/reports/`，
   导致换包上线后进程直接 `ERR_MODULE_NOT_FOUND`。必须用带路径前缀的排除规则
   （如 `--exclude='server/uploads'`，或确保 `-C` 根目录设置正确后用 `--exclude='/uploads'`）。
2. **`comm` 对比文件清单前，两边必须用同一 locale 排序**：`sort` 在不同 locale 下排序结果不同，
   两侧列表分别排序后传给 `comm -23`/`comm -13` 会产生假阳性的"缺失文件"。两边一律
   `LC_ALL=C sort` 再比较。

结论：批量迁移这类非常规操作要格外谨慎地做全量校验（文件级 diff + md5），不要只信 `tar` 的
exit code 或粗略的行数对比。
