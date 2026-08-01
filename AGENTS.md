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
**代码层面没有相互 import**，但**共享同一 Postgres = 进程级耦合**（distributed monolith）：
任何一边改共享表列语义，另一边可能静默出错。不要说「可独立开发部署」——
部署进程可分开，**改共享表 / 共享密钥 / 指标口径必须双边通知**，并遵守下方「共享表唯一写入方」矩阵。

## 6. Deployment & Server Info

### ⚠️ CI 运行时：Node >= 22（闸门必须真跑）

`server` 的 `npm test` / `test:integration` 依赖 Node 的 `--test-force-exit`（Node 22+）。
2026-07-23 曾出现：脚本已写 `--test-force-exit`，但 CI 仍是 Node 18 → 进程立刻
`bad option` 退出，**SHARED_TABLE / ensure-ddl / 集成测全部零执行**，只剩红灯噪音。

硬约束：
- `.github/workflows/ci.yml` → `node-version: '22'`
- `package.json` / `server/package.json` → `"engines": { "node": ">=22" }` + `.npmrc` `engine-strict=true`
- `.nvmrc` → `22`
- 每次 CI / `npm test` 前跑 `node scripts/assert-ci-runtime.mjs`；单测 job 另有一步复查关键闸门输出

本地 Node &lt; 22 时不要强行跑测试装过门面——先升级。

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
4. **覆盖前先备份生产文件**：直接备份到 web root **之外**，例如
   `ssh root@47.100.96.30 "cp /opt/hrms/server/<file> /opt/hrms-archive/deploy-bak/<file>.bak.$(date +%s)"`。
   **禁止**在 `/opt/hrms` 内留下 `*.bak.*` 文件或 `name.bak.<ts>/` 目录（含 `server/domains/<域>.bak.<ts>/`）。
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
- 闸门：`server/test/sales-raw-ban.test.mjs` 禁止可执行代码再出现 `FROM/INTO/UPDATE sales_raw`；
  `insertSalesRawRows` 已永久抛 `sales_raw_retired`。

### ⚠️ ensure*Table / listen-time DDL 冻结（B5）

**新表、新列、新索引一律只走编号 migration**：`server/migrations/NNN_*.sql` → `node migrate.js`
（生产需 `ALLOW_PRODUCTION_MIGRATE=true`）。agents-service-v2 **禁止**为共享表自建 migration。

- **禁止**在 `ensure*Table` / `ensure*Schema` 里新增 `CREATE TABLE` / `ALTER TABLE` / 补列逻辑。
- 存量 ensure* 视为遗留：仅当 `ALLOW_SCHEMA_CHANGES=true`（见 `safety.js#isSchemaChangeAllowed`）才在 listen 时跑；
  生产/staging 默认关闭 listen-time DDL。
- ensure* 若仍保留，只允许「存在性检查 / no-op / 读校验」，不得再扩张 schema。
- 闸门：`server/test/ensure-ddl-freeze.test.mjs`；改 schema 纪律写在本段，不要靠口头约定。

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

### ⚠️ 巨石文件纪律（2026-07 升级）

- **现在不拆** `index.js` / `agents.js` / `working-fixed.html` 存量；禁止再往里堆新功能。
- **新 API**：`server/domains/<域>/routes.js`（handler ≤30 行）+ `service.js`（纯逻辑、不碰 req/res）；
  禁止再造 2000 行 `registerXxxRoutes` 闭包。`server/` 根目录禁止继续平铺新文件。
- **`PUT /api/state`**：白名单写入（`server/hrms-state-put.js`）；业务事实落表后从白名单删除。
- **外提切分**：若函数 >200 行，必须同批切分，禁止整体包进 `createXxx(deps)` 闭包（见
  `server/function-size-ratchet.json`）。工厂只做装配；业务步骤提成具名导出函数。
- **拆分收尾必跑 lint**：外提常复制死 `deps` 解构 → `no-unused-vars` error。合入前 `npm run lint`
  （0 errors），或 `node scripts/fix-unused-vars-from-eslint.mjs` 机械收尾后再 lint。
- 棘轮跳过目录须用路径前缀（`server/test/walk-server-js.mjs`），禁止 basename 裸匹配（如 `'reports'`
  会误跳过 `domains/reports/`）。

### ⚠️ 共享表唯一写入方（GAAS ↔ agents-service-v2）

| 表 | 唯一写入方 | 另一方 |
|----|------------|--------|
| `master_tasks` | agents-service-v2 | GAAS 只读（或经 HTTP） |
| `feishu_users` / `feishu_generic_records` | agents-service-v2 | GAAS 读 |
| `agent_messages` / `agent_scores` / `knowledge_base` | agents-service-v2 | GAAS 读或经 HTTP |
| `daily_reports` | GAAS | agents 只读 |
| `hrms_state` | GAAS | agents 只读 |
| `pos_order_items` / `pos_sales_detail` | GAAS | agents 只读 |
| `tenants` / `licenses` / `tenant_integrations` | GAAS | agents 读配置（唯一例外见下） |
| schema migration（共享表） | GAAS `server/migrations/` | agents 禁止并行建共享表 |

**例外（2026-08-01 拍板，029/030 所有权收敛）**：agents-service-v2 的 license 心跳
仅允许写 `licenses.last_seen_at`（X-License-Key 校验中间件的异步心跳，热路径不走 HTTP）；
`tenant_integrations` 的运行时写入权归 GAAS，agents 侧不得再自愈写入（`saveTenantIntegrationConfig`
已移除，改纯读回退）。租户 RLS 排除清单单一真源在 `packages/gaas-shared/tenant-rls-scope.js`，
demo 环境的 RLS 开启由 `server/scripts/apply-tenant-rls.mjs`（TENANT_MODE=multi 硬闸门）显式执行，
不在编号迁移链内。

### ⚠️ 远程操作：ssh 和 scp 分工不同，别用错，别用 ssh pipe 传大文件

- **scp** 用于传文件（上传/下载代码、备份文件），**ssh** 用于在服务器上跑命令（`psql`、`pm2`、`node --check`、`curl` 健康检查）。
  两者职责不同，**不是"优先用哪个"的问题**——部署一定需要 ssh 执行 `pm2 restart` 和验证步骤，无法只用 scp 完成。
- **真正要避免的是**：用 `ssh ... "pg_dump ..." > 本地文件.sql` 这种方式把大量输出通过 SSH 交互式会话的 stdout 管道
  流回本地——这条连接的 pipe 吞吐量经常很慢（实测 177K 行/101MB 的表流式传输可能要几十分钟甚至更久）。
  **正确做法**：先 `ssh ... "pg_dump ... -f /tmp/x.sql"` 让命令在服务器本地写文件（几乎瞬间完成），
  再单独 `scp root@...:/tmp/x.sql ./` 把这个文件传下来（普通文件传输速度快得多）。
- 这条连接本身有时会话间歇性变慢/断开（`Connection closed`/`timed out during banner exchange`），属于正常波动，
  遇到就用更长的 `ConnectTimeout` 重试、把大批量文件传输拆成小批次，不代表命令或凭据有问题。

### 前端缓存方案：JS 真源在 `frontend/src/pages/`，`npm run build:shell` 部署

- 改业务 JS → 改 `frontend/src/pages/*.js` → `npm run build:shell` → 先 scp `app.*.js/css` 再换 shell。
- 不要直接编辑 `working-fixed.html` 内联主 `<script>`（由 `bundle-frontend.mjs` 写回）。
- **B2 行数棘轮**：`server/test/working-fixed-size-gate.test.mjs` 冻结总行数（≤69156）；新 UI 进 `frontend/src/pages`。
- **P5.1 onclick 棘轮**：`server/test/working-fixed-onclick-gate.test.mjs` 冻结 inline `onclick=` 数量（≤902，只减不增）；新 UI 禁止新增 inline onclick，应逐步迁到 `frontend/src/pages` 事件绑定。
- **B7 XSS（边界须如实）**：主 script 前加载 `/assets/vendor/dompurify/`；`innerHTML` 已挂 DOMPurify。
  - 已拦 script/iframe/javascript:；**不拦**事件属性 XSS（`on*`，兼容遗留 inline onclick）。
  - DOMPurify 未加载时 fail-closed（返回空串）。新代码优先 `setHTML`/`appendHTML`。
  - 消灭 inline onclick 之前，不能把 B7 当成 XSS 已解决。

### @gaas/shared 生产软链

见 [`docs/gaas-shared.md`](docs/gaas-shared.md)。改共享包后：`node scripts/sync-gaas-shared.mjs`，两边提交；生产 `ln -sfn` 到本仓 `packages/gaas-shared` 再重启。

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
