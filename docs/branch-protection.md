# main 分支保护（交付安全 P3.2）

> **现状（2026-07-25）**：仓库为 **private**，GitHub Free 下  
> `branches/.../protection` 与 `rulesets` API 均返回 **403**（需 Pro / Team / 公开仓）。  
> 硬保护无法用 API 代开；在此之前用软约束 + CI 红灯 Issue。

## 目标规则（升级 Pro/Team 后照此配置）

Settings → Rules → New ruleset：

| 项 | 值 |
|----|-----|
| Target | `refs/heads/main` |
| Restrict deletions | ✅ |
| Block force pushes | ✅ |
| Require status checks | ✅ **strict**（分支须与 base 同步） |
| Required checks | `test`、`test-integration`（CI job 名，不是 workflow 名 `CI`） |
| Require a pull request | 建议 ✅（至少 1 审） |

验证（升级后）：

```bash
./scripts/verify-branch-protection.sh
# 或
gh api repos/davidatjfs-cyber/GAAS/rulesets
gh api repos/davidatjfs-cyber/GAAS/rules/branches/main
```

## Free 私有仓软约束（当前生效）

1. **合并前**：PR 上 `test` + `test-integration` 必须绿（见 PR 模板勾选）。
2. **事后**：`.github/workflows/ci-failure-notify.yml` — main 连续失败 ≥3 开 Issue 升级标题。
3. **本地自检**：`./scripts/verify-branch-protection.sh`（检测 API 是否仍 403，并列出最近 main CI）。

## 升级账号后的一键检查清单

- [ ] 开 Pro/Team 或临时公开仓
- [ ] 建 ruleset（上表）
- [ ] `./scripts/verify-branch-protection.sh` 退出码 0
- [ ] 故意开一个缺 CI 的 PR，确认无法 Merge
