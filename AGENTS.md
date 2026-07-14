# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## 5. 项目定位

**GAAS（Growth as a Service）** = 原 hr-management-system，门店经营/增长管理系统。
2026-07-11 从 `agents-service-v2` monorepo 拆分为独立仓库（原 monorepo 已归档：
`davidatjfs-cyber/agents-service-v2-legacy-monorepo`）。

姊妹项目 **agents-service-v2**（Agent 服务，增长诊断/自动化任务/飞书集成）现独立仓库：
`davidatjfs-cyber/agents-service-v2`，本地建议放在 `/Users/xieding/agents-service-v2`。
两个服务通过 HTTP（`http://127.0.0.1:3101/health` 等）和同一个 Postgres 库互相协作，
**代码层面没有相互 import**，可以独立开发部署，但改动会互相影响的场景（共享表结构、
共享密钥）要留意通知对方。

## 6. Deployment & Server Info

- **Server**: root@47.100.96.30 (passwordless SSH)
- **Nginx serves from**: `/opt/hrms` (NOT `/root/hr-management-system/`)
- **HRMS(GAAS) deploy**: `scp` files to `root@47.100.96.30:/opt/hrms/` then `ssh root@47.100.96.30 "pm2 restart hrms-service"`
- **Local code**: `/Users/xieding/GAAS/`
- **PM2 process**: `hrms-service` (port 3000)
- **DB**: `postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms`
- **Auth token**: localStorage key `hrms_token`
- **Server files**: working-fixed.html, sw.js → `/opt/hrms/`; server/*.js → `/opt/hrms/server/`

### ⚠️ 部署前必做：核对本地与生产是否同源（血泪教训）

生产是**按文件 scp 拼装**的，不同文件可能来自不同分支——本地某个文件直接覆盖上去会删掉生产独有功能、导致服务崩溃。
（真实事故：本地 `growth-api.js` 是 `main` 分支版，生产跑的是 `Codex/hungry-bell-98fbf1` 版，多了企微每日日报/`setSendGrowthAlert` 等。直接覆盖 → `index.js` 找不到导出 → 整个服务起不来。）

**每次 scp 覆盖某个 server/*.js 前，必须：**
1. **先拉生产现版对比**：`scp root@47.100.96.30:/opt/hrms/server/<file> /tmp/prod-<file>`，与本地 diff。差异异常大 → 八成不同源，停下核实，别直接覆盖。
2. **校验导入/导出契约**：被覆盖文件若被 `index.js` 等 import（如 `setSendGrowthAlert`），确认新文件仍导出这些符号，否则启动即崩。
3. **部署后必须验证服务真的起来了**（不能只看 `pm2 status` 显示 online，崩溃重启也可能短暂 online）：
   - `ssh root@47.100.96.30 "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/"` 必须返回 `200`
   - `ssh root@47.100.96.30 "pm2 logs hrms-service --err --lines 10 --nostream"` 不能有 `SyntaxError`/`does not provide an export`
4. **覆盖前先备份生产文件**：`ssh root@47.100.96.30 "cp /opt/hrms/server/<file> /opt/hrms/server/<file>.bak.$(date +%s)"`，便于秒级回滚。
5. 部署成功后，把上线版同步回本地（`md5` 校验一致），避免本地再次成为"会炸生产的旧版"。

### ⚠️ sales_raw 表已于 2026-07-03 下线，禁止再新建代码引用它

`sales_raw` 已从生产库 **DROP TABLE**（177,284行/101MB，已备份：本地 `/tmp/sales_raw_full_backup_before_drop.sql` +
服务器 `/opt/hrms/sales_raw_backup_20260703.sql`）。**POS 销售数据的唯一权威来源是 `pos_order_items`**（明细表，含堂食+外卖全渠道）。

- **绝大多数查询场景**（营收/销量/菜品统计等聚合查询）应查 **`pos_sales_detail` 视图**——它是 `pos_order_items` 的同构视图，
  列结构（`store, date, biz_type, dish_name, dish_code, category, qty, sales_amount, revenue, discount, slot, order_time,
  checkout_time, weekday, tenant_id`）和当年 `sales_raw` 几乎一致，绝大部分老代码只需把 `FROM sales_raw` 换成
  `FROM pos_sales_detail` 即可，**无需重写聚合逻辑**。
- 该视图**没有 `created_at` 列**（老代码常用它做"数据新鲜度"判断），需要新鲜度判断时改用 `checkout_time`。
- `pos_orders`（订单级，无明细行）**不要单独用来算营收**——它不含外卖等渠道明细，会导致营收对不上账
  （实测洪潮店曾差 0.2%、马己仙店曾差近 30%）。营收类查询一律走 `pos_order_items`/`pos_sales_detail`，不要查 `pos_orders`。
- `daily_reports`（人工日报，`actual_margin`/`pre_discount_revenue` 等字段）与 `pos_sales_detail` 交叉验证过，数字一致（误差 <0.5%），
  两者都可信；`metric_dictionary` 里营业额/毛利相关口径目前以 `daily_reports` 为准（历史决策，7 组重复口径已于 2026-07-03 合并）。
- 如果你在写新代码或看到旧代码里出现 `sales_raw` 字样：**这一定是需要修的信号**，不是可以照抄的参考。

### ⚠️ RLS：本仓库（GAAS/47.100.96.30）永远关闭，另有 GAAS-demo（多租户服务器）永远开启——别搞混

这件事被反复问过好几次，写在这里以后不用再解释：

- **本仓库 / 47.100.96.30 这台服务器** = 只服务马己仙、洪潮两个品牌的**单租户生产环境**，**RLS 必须保持关闭**
  （`relrowsecurity = false`）。哪怕表上还挂着 `tenant_isolation` policy 定义、`FORCE ROW LEVEL SECURITY` 标记，
  只要 `relrowsecurity=false`，这些策略就是完全不生效的残留物，**不要因为看到这些标记就以为 RLS 开着**——
  必须直接查 `pg_class.relrowsecurity`，不能只看 `\d table` 里有没有 POLICY。
- **另有一台「GAAS-demo」服务器**（`davidatjfs-cyber/GAAS-demo` 仓库），是面向未来多租户/百店托管客户的演示环境，
  **RLS 要求全部打开**。
- **协作方式**：所有代码改动一律先在本仓库（GAAS）完成、验证，之后才会被同步到 GAAS-demo。
  这意味着本仓库里任何"为多租户设计"的代码（`tenant_id` 字段、`tenantContext`、`wrapPoolForTenantContext` 等）
  要保留、要写对，但**不要在本仓库里主动执行"开启 RLS"这类操作**——那是 GAAS-demo 那边的事。

### ⚠️ 远程操作：ssh 和 scp 分工不同，别用错，别用 ssh pipe 传大文件

- **scp** 用于传文件（上传/下载代码、备份文件），**ssh** 用于在服务器上跑命令（`psql`、`pm2`、`node --check`、`curl` 健康检查）。
  两者职责不同，**不是"优先用哪个"的问题**——部署一定需要 ssh 执行 `pm2 restart` 和验证步骤，无法只用 scp 完成。
- **真正要避免的是**：用 `ssh ... "pg_dump ..." > 本地文件.sql` 这种方式把大量输出通过 SSH 交互式会话的 stdout 管道
  流回本地——这条连接的 pipe 吞吐量经常很慢（实测 177K 行/101MB 的表流式传输可能要几十分钟甚至更久）。
  **正确做法**：先 `ssh ... "pg_dump ... -f /tmp/x.sql"` 让命令在服务器本地写文件（几乎瞬间完成），
  再单独 `scp root@...:/tmp/x.sql ./` 把这个文件传下来（普通文件传输速度快得多）。
- 这条连接本身有时会话间歇性变慢/断开（`Connection closed`/`timed out during banner exchange`），属于正常波动，
  遇到就用更长的 `ConnectTimeout` 重试、把大批量文件传输拆成小批次，不代表命令或凭据有问题。

### 前端缓存方案：working-fixed.html 是源，生产跑的是构建产物 shell（别直接 scp 源文件）

仓库里的 `working-fixed.html` 是**唯一真源**（内联大 CSS/JS，~3.3MB）。生产 `/opt/hrms/working-fixed.html`
跑的是构建脚本生成的 **shell**（~600KB，大 CSS/JS 抽成 `/app.<hash>.css`、`/app.<hash>.js` 外链）。
两者**故意不同源**——这是缓存优化，不是"被覆盖错了"。

**改动前端后重新部署步骤：**
1. 改源文件 `working-fixed.html`。
2. `node scripts/build-shell.mjs` → 生成 `dist/`（已 gitignore）。
3. 先传两个哈希资源再传 shell（顺序很重要，先有资源再换 shell，否则瞬间 404）：
   `scp dist/app.*.css dist/app.*.js root@47.100.96.30:/opt/hrms/`，
   再 `scp dist/working-fixed.html root@…:/opt/hrms/working-fixed.html.staged && ssh … "mv … working-fixed.html"`。
4. 验证：shell 返回 `Cache-Control: no-cache`+ETag（`If-None-Match` 应回 304）；`app.<hash>.js/.css`
   返回 `Cache-Control: public, max-age=31536000, immutable`。
   `curl -sk -D - https://127.0.0.1/working-fixed.html -H "Host: nnyx.cc"`。
5. nginx 已加 `location ~* "^/app\.[0-9a-f]+\.(js|css)$"`（immutable）+ 首个 `.html` 块改 `no-cache`，
   通常无需再动 nginx；若动了先 `nginx -t` 再 `systemctl reload nginx`，改前备份配置。
   注意 server_name 是 **nnyx.cc**（不是 hrms.nnyx.cc），80 端口 301 跳 443。

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
