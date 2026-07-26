# CD server（手动 + 自动）

生产仍是 **scp 拼装**。提供两套 GitHub Actions：

| Workflow | 触发 | 默认 |
|----------|------|------|
| **CD server (manual)** | `workflow_dispatch` | 可用；推荐先 `dry_run: true` |
| **CD server (auto)** | CI 在 `main` 上 **push** 且结论 success | **默认关闭**（`CD_AUTO_ENABLED`） |

自动 CD 只部署本次变更的 `server/domains|utils|services|ontology` 下 `.js/.mjs`。  
禁止覆盖：`server/index.js`、`server/agents.js`、`server/growth-api.js`、任何 `.env`。

健康检查失败时，`deploy-server-files.sh` 会从  
`/opt/hrms-archive/deploy-bak/server-<ts>/` **自动回滚**本次覆盖的文件并 reload。

## 一次配置（账号持有人）

仓库 Settings → Secrets and variables → Actions：

| Secret / Variable | 说明 |
|-------------------|------|
| `DEPLOY_SSH_KEY` | 能登录 `root@47.100.96.30` 的私钥全文（含 `BEGIN`/`END`） |
| `DEPLOY_HOST` | 可选，默认 `root@47.100.96.30` |
| `DEPLOY_KNOWN_HOSTS` | 可选；不设则 workflow 内 `ssh-keyscan` |
| **`CD_AUTO_ENABLED`**（Variable） | 设为 `true` 才启用自动 CD；不设或其它值 = 关闭 |

再新建 Environment **`production`**（Settings → Environments），可加必需审阅人。  
自动 CD job 使用该 environment。

## 手动使用

Actions → **CD server (manual)** → Run workflow：

1. `dry_run: true` — 只拉生产 diff，不上传  
2. 确认 diff 可接受后，同一路径 `dry_run: false`

巨石入口仍用本地：

```bash
./scripts/deploy-server-files.sh server/domains/foo/bar.js
```

## 自动使用

1. 配好 secrets + `CD_AUTO_ENABLED=true` + `production` environment  
2. 合并/推送到 `main` 且 CI 全绿后，`CD server (auto)` 会挑选变更文件部署  
3. 无 allowlisted 文件变更则 skip  
4. 健康检查失败 → 自动回滚 → job 失败（需人工排查）

## 失败回滚（手动）

若自动回滚未覆盖（例如 NEW 文件无 bak）：

```bash
# bak 目录见失败日志 bak=/opt/hrms-archive/deploy-bak/server-<ts>
scp root@47.100.96.30:/opt/hrms-archive/deploy-bak/server-<ts>/<file> /tmp/
./scripts/deploy-server-files.sh ...  # 或直接 scp 回 /opt/hrms/... 后 pm2 reload
```
