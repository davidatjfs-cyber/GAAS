# 手动 CD（P3.3）

生产仍是 **scp 拼装**；自动 `push main → 部署` 风险高。当前只提供 **GitHub Actions `workflow_dispatch`**。

## 一次配置（账号持有人）

仓库 Settings → Secrets and variables → Actions：

| Secret | 说明 |
|--------|------|
| `DEPLOY_SSH_KEY` | 能登录 `root@47.100.96.30` 的私钥全文（含 `BEGIN`/`END`） |
| `DEPLOY_HOST` | 可选，默认 `root@47.100.96.30` |
| `DEPLOY_KNOWN_HOSTS` | 可选；不设则 workflow 内 `ssh-keyscan` |

再新建 Environment **`production`**（Settings → Environments），可加必需审阅人。

## 使用

Actions → **CD server (manual)** → Run workflow：

1. `dry_run: true` — 只拉生产 diff，不上传  
2. 确认 diff 可接受后，同一路径 `dry_run: false`

禁止通过 CD 直接覆盖：`server/index.js`、`server/agents.js`、`server/growth-api.js`、任何 `.env`。  
这些仍用本地：

```bash
./scripts/deploy-server-files.sh server/domains/foo/bar.js
```

## 失败回滚

`deploy-server-files.sh` 每次把旧文件放到  
`/opt/hrms-archive/deploy-bak/server-<ts>/`。  
健康检查失败会非 0 退出；用 archive 里对应文件 `scp` 回 `/opt/hrms/...` 后 `pm2 reload hrms-service`。
