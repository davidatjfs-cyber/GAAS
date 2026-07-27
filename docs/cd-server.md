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
