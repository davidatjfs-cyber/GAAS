# CLAUDE.md

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
（真实事故：本地 `growth-api.js` 是 `main` 分支版，生产跑的是 `claude/hungry-bell-98fbf1` 版，多了企微每日日报/`setSendGrowthAlert` 等。直接覆盖 → `index.js` 找不到导出 → 整个服务起不来。）

**每次 scp 覆盖某个 server/*.js 前，必须：**
1. **先拉生产现版对比**：`scp root@47.100.96.30:/opt/hrms/server/<file> /tmp/prod-<file>`，与本地 diff。差异异常大 → 八成不同源，停下核实，别直接覆盖。
2. **校验导入/导出契约**：被覆盖文件若被 `index.js` 等 import（如 `setSendGrowthAlert`），确认新文件仍导出这些符号，否则启动即崩。
3. **部署后必须验证服务真的起来了**（不能只看 `pm2 status` 显示 online，崩溃重启也可能短暂 online）：
   - `ssh root@47.100.96.30 "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/"` 必须返回 `200`
   - `ssh root@47.100.96.30 "pm2 logs hrms-service --err --lines 10 --nostream"` 不能有 `SyntaxError`/`does not provide an export`
4. **覆盖前先备份生产文件**：直接备份到 web root **之外**，例如
   `ssh root@47.100.96.30 "cp /opt/hrms/server/<file> /opt/hrms-archive/deploy-bak/<file>.bak.$(date +%s)"`，
   便于秒级回滚。**禁止**在 `/opt/hrms` 内留下 `*.bak.*` 文件或 `name.bak.<ts>/` 目录。
5. 部署成功后，把上线版同步回本地（`md5` 校验一致），避免本地再次成为"会炸生产的旧版"。

### ⚠️ `.bak.*` 备份（文件与目录）不能留在 `/opt/hrms`（web root）里

`/opt/hrms` 是 nginx 的 `root`，任何放进去的文件默认都能被 `https://nnyx.cc/<文件名>` 直接访问到。
覆盖前备份是对的，但**备份不能留在 web root 原地**——2026-07-24 实测发现 `/opt/hrms` 下堆积了 146 个历史部署产生的
`working-fixed.html.bak.*`、`app.*.js.bak.*`、`agents-admin.html.bak.` 等文件，其中至少两个可以被匿名
`curl` 直接 200 下载到，泄露历史前端源码。nginx 已有的黑名单（`\.(sql|md|env|log|sh)$` 等，见上方
2026-06-25 那条）**没有覆盖 `.bak` 这个命名模式**，所以这批文件一直在裸奔。

**已修复**：`/etc/nginx/sites-enabled/hrms` 加了 `location ~* \.bak { return 404; }`；146 个历史 `.bak` 文件
已移到 `/opt/hrms-archive/frontend-bak/`（保留未删，web root 之外）。

**2026-07-25 追加（目录形态）**：拆分部署时还出现过 `server/domains/<域>.bak.<timestamp>/` 这种**目录**备份
（如 `approvals.bak.1784864013/`）。`\.bak` 规则已能 404，但纪律仍是「备份不进 web root」——已全部
`mv` 到 `/opt/hrms-archive/deploy-bak/`；nginx 另加 `location ~* /[^/]+\.bak\.[0-9]+(/|$)` 双保险。
**整目录备份**同样禁止留在 `/opt/hrms` 内。

**以后的纪律**：任何"覆盖前备份"产生的 `.bak` 文件或 `*.bak.<ts>/` 目录，要么直接放 `/opt/hrms` 之外
（如 `/opt/hrms-archive/deploy-bak/`），要么生成后立刻 `mv` 出 web root，不要指望"忘了清理也没事"
——nginx 黑名单是按名字匹配的，新增一种备份命名习惯就可能绕开它。

**附带修复**：`server/index.js` 里配置的 CSP/HSTS/X-Frame-Options/X-Content-Type-Options 这些安全头
只在请求打到 Node 进程时生效（主要是 `/api/*`）；nginx 直接从磁盘吐 `index.html`/`working-fixed.html`/
`app.*.js/css` 这些静态文件时完全不带这些头。已在 `sites-enabled/hrms` 里给静态资源的 location 也补上
同样的安全头，两边（Node 和 nginx 静态服务）现在保持一致。

### 🔴 2026-07-24 事故：`/opt/hrms` web root 大面积裸奔，真实 `.env` 泄露超过3天——已修复，但泄露过的密钥必须轮换

上面那条 `.bak` 修复上线后，重新做了一次彻底排查，发现问题比最初以为的严重得多，是**真实发生过的凭据泄露**，
不是"有风险"这种程度：

- **`.env.ORPHANED_UNUSED_2026-07-21_see_server_env`**——文件名看着像"废弃不用"，实际内容是完整的生产
  `.env`，`curl https://nnyx.cc/.env.ORPHANED_UNUSED_2026-07-21_see_server_env` 之前直接 200 返回全部内容：
  `JWT_SECRET`、`PLATFORM_ADMIN_JWT_SECRET`、`ADMIN_PASSWORD`、`AGENTS_ADMIN_PASSWORD`、
  `DEEPSEEK_API_KEY`、`QWEN_API_KEY`、`DOUBAO_API_KEY`、`OPENAI_API_KEY`、`DATABASE_URL`、
  `ALIYUN_SMS_ACCESS_KEY_ID`/`SECRET`、`WECOM_KF_SECRET`/`AES_KEY`、`MINIPROGRAM_SYNC_SECRET` 等。
  文件名日期 2026-07-21，即**在公网裸奔了 3 天以上**，必须假定已被扫描/爬取过，不能只靠"看起来没人访问"。
- 同时 `member_consumption.json`（真实会员姓名/手机号/卡号）、`default_op_config.json`、以及
  `sales-ai-routes.js`/`sales-customer-ai.js`/`store-diagnosis.js`/`import-member-consumption.js`/
  `sync-pos-feishu-feb.cjs` 等一批**后端源码文件**，连同几十个 `*.md`/`*.sql`/`test-*.js`/`db-check*.js`/
  部署脚本（`dev.sh`/`prod.sh`/`staging.sh`）**直接堆在 `/opt/hrms` 根目录**，均可被 `curl` 原样下载。
- 更进一步：`backups/`、`.backups/`、`_bak/`、`bak.<timestamp>/`、`migration-backups/`、
  `.codex-stage-*/`、`incoming-sales/`、`packages/`、`hr-management-system/`、`.windsurf/`、`_dead_archive/`、
  `dist/` 这些**目录**也直接摆在 web root 下，目录名不在 nginx 黑名单里。目录本身没开 `autoindex`（列目录返
  403），但只要知道/猜到具体文件名，单个文件照样能直接下载——实测 `backups/hrms_payroll_state_*.json.gz`
  （工资单）、`migration-backups/*.sql.gz`（DB 迁移备份）都曾 200 可下载。

**根因**：这套部署方式是"把整个项目目录当 web root"，靠 nginx 黑名单挡不该公开的东西——黑名单只能挡"已知
命名模式"，新增一种备份/暂存命名习惯（如 `.codex-stage-*`、`ORPHANED_UNUSED` 这种一次性改名）就会绕开它。
2026-06-25 修过一次（`server/`、`node_modules/` 等目录），2026-07-24 早些时候又修过 `.bak` 文件，这次是
第三轮，说明黑名单模式本身有系统性缺陷，不是"这次全补上了就一劳永逸"。

**已修复**：
1. 上述所有暴露的文件/目录已从 `/opt/hrms` 移到 `/opt/hrms-archive/leaked-2026-07-24/`（保留未删）。
2. `sites-enabled/hrms` 追加了目录黑名单（`backups?|\.backups|_bak|bak\.[0-9]+|\.codex-stage-.*|
   _dead_archive|migration-backups|incoming-sales|packages|hr-management-system|\.windsurf|dist`）。
3. 修复后逐条用真实内容校验（不只看 HTTP 状态码——本站 `try_files` 兜底到 `index.html`，不存在的路径也会
   返回 200，必须看 body 是不是 SPA 壳子来判断是否真的堵住了）。

**必须做、但只有账号持有人能做的事（本次没有代替执行）**：`.env` 里出现过的所有密钥/密码**必须视为已泄露
并轮换**，不能因为"现在挡住了"就当没事发生过。可执行波次、双边对照与验证命令见
[`docs/key-rotation-runbook.md`](docs/key-rotation-runbook.md)；只读复检：`./scripts/verify-secret-presence.sh`。
- `JWT_SECRET` / `PLATFORM_ADMIN_JWT_SECRET`：换新值 → 会导致所有现有登录 session 失效，需提前告知用户重新登录。
- `ADMIN_PASSWORD` / `AGENTS_ADMIN_PASSWORD`：改密码。
- `DEEPSEEK_API_KEY` / `QWEN_API_KEY` / `DOUBAO_API_KEY` / `OPENAI_API_KEY`：去对应控制台吊销旧 key、生成新 key。
- `ALIYUN_SMS_ACCESS_KEY_ID` / `_SECRET`：阿里云控制台轮换 AK/SK（顺带检查这期间有没有异常短信发送记录/账单）。
- `WECOM_KF_SECRET` / `WECOM_KF_AES_KEY`：企业微信管理后台重新生成。
- `MINIPROGRAM_SYNC_SECRET`：按小程序侧约定换新值，两边同步更新。
- `DATABASE_URL` 里的 DB 密码：如果和其他地方复用，也建议换。
- 换完每一个都要 `pm2 restart hrms-service --update-env`，并验证对应功能（登录、AI 对话、短信、客服）没有因为轮换而失效。
- 建议顺手查一下这期间（至少 2026-07-21 之后）服务器访问日志里有没有对 `.env*`、`backups/`、
  `migration-backups/` 等路径的异常请求，判断是否已经被人下载过。

### ⚠️ sales_raw 表已于 2026-07-03 下线，禁止再新建代码引用它

`sales_raw` 已从生产库 **DROP TABLE**（177,284行/101MB，已备份：本地 `/tmp/sales_raw_full_backup_before_drop.sql` +
服务器 `/opt/hrms-archive/leaked-2026-07-24/sales_raw_backup_20260703.sql`，2026-07-24 因 web root 泄露事件从
`/opt/hrms/` 迁出，见下方「web root 大面积泄露」条目）。**POS 销售数据的唯一权威来源是 `pos_order_items`**（明细表，含堂食+外卖全渠道）。

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

### ⚠️ 巨石文件纪律：新功能一律加进已拆出来的独立模块，禁止继续往 index.js / agents.js 本体堆代码

**每个对话在开发新功能前必须先读这一条并遵守，不分模块大小、不分任务紧急程度。**

`server/index.js`（~1.8万行）、`server/agents.js`（~1.35万行）、`working-fixed.html`（~6.8万行）已经是巨石文件，
2026-07 审计后的结论是**现在不拆存量代码**（拆分本身的重构风险，此时高于收益），但纪律是**不能再让它们变得更胖**：

- **新增 API 路由（升级后）**：禁止再造「2000 行 `registerXxxRoutes` 闭包」。新域放
  `server/domains/<域>/`（或复用已有 `ontology/`、`services/`），拆成：
  - `routes.js`：只做路由绑定与参数校验，**每个 handler ≤ 30 行**，不写业务逻辑；
  - `service.js`：纯逻辑，导出函数，**不接触 `req`/`res`**，可直接单测。
  `index.js` 只加两行（`import` + 注册）。存量 `registerXxxRoutes` 不动；改到某文件时按新形态外提。
- **`server/` 根目录**：只允许入口/遗留模块；**新文件必须进 `domains/<域>/`、`ontology/`、`services/` 等分层目录**，禁止继续平铺。
- **`index.js`/`agents.js` 本体只允许的改动**：注册新模块的 `import` + 调用那两行、修复本体内已有代码的 bug、
  给已有函数补充极少量必要的调用点。
- **`working-fixed.html`同理**：新的大块 UI 逻辑优先独立模块；至少不要堆到同一个超长 `<script>` 顶部。
- **`PUT /api/state`**：已改为**白名单写入**（`server/hrms-state-put.js`）。新业务事实字段禁止靠扩大白名单偷懒；
  应落真表 + 窄 API，并从白名单删除。配置类（如 `settings`）可留 state。

违反这条纪律的表现：`git diff --stat` 里 `index.js`/`agents.js` 一次改动新增几十上百行"新逻辑"（不是"新增两行注册"），
或新增又一个 >500 行的 `registerXxxRoutes` 闭包——应停下来按 routes/service 拆。

### ⚠️ 外提切分纪律（禁止「闭包整体搬运」）

外提巨石函数到 `domains/` 时，**搬家合规 ≠ 复杂度下降**。已反复出现三次的反模式：
把 400–500 行整块塞进 `createXxx(deps) { ... }` 工厂闭包、闭包内零子函数——依赖方向对了，但
`>150` 行函数占比与巨石数不降反升。

硬约束（与 `server/function-size-ratchet.json` / `test/function-size-ratchet.test.mjs` 闸门一致）：
- **外提时若函数 >200 行，必须同批切分为多个具名函数/模块**，不允许整体包进 `createXxx` 闭包后合入。
- 工厂闭包只做依赖装配与薄编排；业务步骤提成同文件或同域的具名导出函数（可单测）。
- 存量超大函数进 allowlist 冻结（只降不升）；新增超大函数 CI 红，禁止靠扩大 allowlist 过关。
- **拆分收尾必跑 lint**：外提会把原 `deps` 解构原样复制进新文件，极易留下死 import / 未使用解构字段（`no-unused-vars` 在非 legacy 文件是 **error**，会直接打红 CI）。合入前对改动文件执行：
  1. `npm run lint`（须 0 errors；warnings 受 `--max-warnings` 约束）
  2. 或机械收尾：`npx eslint "server/domains/<域>/**/*.js" -f json -o /tmp/eslint.json && node scripts/fix-unused-vars-from-eslint.mjs /tmp/eslint.json`，再 `node --check` 抽查语法后复跑 lint
- 棘轮 `SKIP_DIRS` / exempt **禁止按目录 basename 裸匹配**（如字面量 `'reports'` 会误跳过 `domains/reports/`）。统一用 `server/test/walk-server-js.mjs` 的路径前缀跳过。

### ⚠️ @gaas/shared（跨仓共享包）

权威路径：`packages/gaas-shared`（飞书验签、tenant token、共享表名常量）。
agents-service-v2 通过 `file:packages/gaas-shared` 引用**同步副本**；改共享代码后跑
`node scripts/sync-gaas-shared.mjs` 再在两边提交。两边的 `utils/feishu-webhook-verify.js`
已改为 re-export，勿再复制粘贴实现。

**生产软链与部署步骤见** [`docs/gaas-shared.md`](docs/gaas-shared.md)
（`node_modules/@gaas/shared` → 本仓 `packages/gaas-shared`；部署后须 `ln -sfn` 再 `pm2 restart`）。

### ⚠️ 共享表唯一写入方（GAAS ↔ agents-service-v2）

两边直连同一库。改 schema 以 **GAAS `server/migrations/`** 为权威；agents-service-v2 **不要**再为共享表自建 migration。
另一方若要写，必须走 HTTP，禁止静默双边写。

| 表 | 唯一写入方 | 另一方 |
|----|------------|--------|
| `master_tasks` | agents-service-v2 | GAAS 只读（或经 HTTP） |
| `feishu_users` / `feishu_generic_records` | agents-service-v2（飞书同步） | GAAS 读；注册状态等经既有 API |
| `agent_messages` / `agent_scores` / `knowledge_base` | agents-service-v2 | GAAS 读或经 HTTP |
| `daily_reports` | GAAS | agents 只读 |
| `hrms_state` | GAAS | agents 只读（配置/员工镜像） |
| `pos_order_items` / `pos_sales_detail` | GAAS（导入） | agents 只读 |
| `tenants` / `tenant_integrations` | GAAS | agents 读配置 |
| `schema_migrations` | GAAS `migrate.js` | agents 禁止并行建共享表 |

**2026-07 追加：什么时候可以拆存量代码，以及怎么安全拆**——"现在不拆存量代码"不等于"永远不拆"。
2026-07-22 已经从 `index.js` 拆出过 `auth-routes.js`（登录/鉴权，~550行）和 `approval-routes.js`
（审批列表/详情/已读/删除/流程配置，不含create/decide/return/resubmit那几个还留在index.js里的巨型逻辑），
验证下来是安全的，前提是按这个流程走，不要图快跳步骤：

1. **先补测试，再拆，不要反过来**。`server/test/integration/` 下已经有真实子进程+隔离测试库的
   集成测试基础设施（不是mock，是真的起一个进程连测试库发HTTP请求）。要拆哪个模块，先确认
   该模块的核心路径有没有至少"一条正常路径+一条失败路径"的测试，没有就先补，再动手拆。
2. **依赖注入，不要反向 import index.js**。被拆出去的文件里，凡是引用了 index.js 里那些被
   全局广泛复用的工具函数（如 `getSharedState`、`normalizeRoleForJwt`、`pickMyStoreFromState`
   这类在上百处被调用的函数），一律通过 `registerXxxRoutes(app, authRequired, deps)` 的 `deps`
   参数注入，不要从新文件里 `import ... from './index.js'`——这个仓库里没有任何文件反向依赖过
   index.js，保持这个约定。只有"只给这个模块自己用、不被别处引用"的辅助函数才跟着搬过去。
3. **先摸清楚实际规模再决定拆不拆**：拆 `decide` 那类路由前，先用行数/依赖函数数量做个粗略统计
   （见2026-07-22当次教训：以为和 auth 差不多规模，实际读到一半发现是4倍大、直接碰薪资/晋升/
   离职数据），发现规模远超预期就停下来跟人确认是否要缩小这次范围，而不是硬着头皮拆完。
4. **拆完必须补"验证这次移动的代码"的测试，不能只看"其他测试还是绿的"**。移动路由后跑一遍现有
   测试全过，只能证明"没把别的东西弄坏"，不能证明"移动的代码本身是对的"——因为很可能现有测试
   压根没覆盖到被移动的那几个接口。必须针对被移动的每个路由至少加一条直接调用它的测试。
5. **部署前用 diff 核对生产是否有漂移**（本文件第88条已经强调过，这里再次适用）：拆分改动的是
   `index.js` 本体，漂移核对尤其重要，防止把生产上独有的、本地没有的改动覆盖掉。

### ⚠️ 远程操作：ssh 和 scp 分工不同，别用错，别用 ssh pipe 传大文件

- **scp** 用于传文件（上传/下载代码、备份文件），**ssh** 用于在服务器上跑命令（`psql`、`pm2`、`node --check`、`curl` 健康检查）。
  两者职责不同，**不是"优先用哪个"的问题**——部署一定需要 ssh 执行 `pm2 restart` 和验证步骤，无法只用 scp 完成。
- **真正要避免的是**：用 `ssh ... "pg_dump ..." > 本地文件.sql` 这种方式把大量输出通过 SSH 交互式会话的 stdout 管道
  流回本地——这条连接的 pipe 吞吐量经常很慢（实测 177K 行/101MB 的表流式传输可能要几十分钟甚至更久）。
  **正确做法**：先 `ssh ... "pg_dump ... -f /tmp/x.sql"` 让命令在服务器本地写文件（几乎瞬间完成），
  再单独 `scp root@...:/tmp/x.sql ./` 把这个文件传下来（普通文件传输速度快得多）。
- 这条连接本身有时会话间歇性变慢/断开（`Connection closed`/`timed out during banner exchange`），属于正常波动，
  遇到就用更长的 `ConnectTimeout` 重试、把大批量文件传输拆成小批次，不代表命令或凭据有问题。
- **别把 scp 接管道后再取 `$?`**：`scp ... | tail -2; echo EXIT=$?` 拿到的是 `tail` 的退出码，
  scp 真失败了也会显示 0。这条链路本来就容易断，一旦漏判就会「资源没传上去但以为成功」，
  接着换 shell → 线上 404。**正确做法**：`scp ...; RC=$?`（不接管道），
  并且**传完一律用 md5 对账**（`md5 -q 本地文件` vs `ssh ... "md5sum 远端文件"`），
  只有 md5 一致才继续下一步。shell 也一样：先传到 `.staged`，md5 比对通过后再 `mv` 原子替换。

### 🔴 2026-07-29 事故：三个独立 bug 叠加 + 双会话并发部署，导致生产两次整机失联（连 SSH 都连不上）

这次事故的表现是"登录不上→内存95%→速度极慢→整机连SSH banner都握手超时"，排查后发现是**三个互相独立、
各自早就埋下的 bug**同时暴露，叠加上**另一个 Claude 会话在同一时间往同一台服务器并发部署**，共同把一台只有
**2核CPU/3.4G内存**的小机器彻底压垮到操作系统层面无响应（不是 Node 进程崩，是连 sshd 的 banner exchange 都
超时、nginx 也完全不响应——这个信号本身就是"整机过载"而不是"应用报错"，要跟上面 ssh/scp 那条"连接偶尔正常
波动"区分开：如果重试几次、间隔拉长依然 100% 连不上，且伴随 HTTP 也整体 000，基本可以判定是整机级过载或挂起，
不是普通抖动）。

**三个独立 bug**：
1. **nginx 配置里手写的 `ssl_session_cache`/`ssl_session_timeout`/`ssl_session_tickets` 跟 certbot 的
   `include /etc/letsencrypt/options-ssl-nginx.conf` 重复声明**——nginx 长期用内存里已加载的旧配置正常跑，
   这个 bug 从未暴露；直到这次 reboot 强制 nginx 重新 parse 配置文件，才第一次触发 `nginx -t` 失败、
   nginx 直接起不来，导致站点整体 502/无法访问（Node 本身是健康的）。**这是一个「编辑配置后没有立刻验证」
   遗留的地雷**：本文件上面已经反复强调过"改完必须验证"的纪律，但那些纪律主要针对 working-fixed.html/前端
   bundle，没有覆盖到"改 nginx 配置后必须立刻 `nginx -t` + `systemctl reload nginx` 验证"这一类操作。
2. **PM2 常驻内存上限「返祖」**：`ecosystem.config.cjs` 文件里写的是 2G（2026-07-28 事故修复后的值，文件里
   还留着修复说明注释），但**当时实际跑着的 pm2 进程用的是更早的 800M 旧值**（`pm2 jlist` 实测
   `max_memory_restart: 838860800`）。根因：本机 pm2 是通过 `systemd` 的 `pm2-root.service` 管理的，
   其 `ExecStart=pm2 resurrect`——**重启/重建进程时读的是 `/root/.pm2/dump.pm2` 这份快照，不是
   `ecosystem.config.cjs` 文件本身**。2026-07-28 那次修复大概率只在内存里生效（或走了不经过文件的
   `pm2 restart`），**没有紧接着跑 `pm2 save`**，所以这份"正确答案"从未写回 `dump.pm2`；这次 reboot 一
   `resurrect`，直接读回了修复前的 800M 旧快照，复现了 2026-07-28 同款"内存打到上限→每60~90秒重启一次"
   的死循环，且每次重启都在同一台仅 2 核的机器上重跑一遍很重的启动期 reconcile（含"日报权威重建"等）。
   **纠正**：任何一次 `pm2 delete hrms-service && pm2 start ecosystem.config.cjs --update-env` 之后，
   **必须立刻 `pm2 save`**，否则下次 `resurrect`（含服务器重启）会读到修复前的旧配置——这一步过去是靠
   记性做的，必须写进部署 checklist，不能再假设"改完 ecosystem.config.cjs 就自动生效"。
3. **PR84 的代码（`inventory_forecast_history`/`hrms_question_sets` 两张表的 hydrate 逻辑）已经先于对应
   migration（`165_inventory_forecast_tables.sql`/`167_hrms_question_sets_table.sql`）被部署到生产**——
   这两张表当时并不存在，导致几乎每个涉及共享 state 的请求都要先付一次"查表失败"的开销，在本就资源紧张的
   机器上是压垮骆驼的其中一根稻草。当场用 `node migrate.js`（`ALLOW_PRODUCTION_MIGRATE=true`）补跑这两个
   纯新增（`CREATE TABLE IF NOT EXISTS`）、无风险的 migration 后，这类报错立刻停止。

**叠加的触发条件**：事后确认，**另一个 Claude 会话当时正在并发部署到同一台 47.100.96.30**——生产上能看到
`server/domains/workspace/*.js` 已经是本次 PR86 的最终版本、还有一个未曾在本会话构建过的新前端 bundle，
但 `working-fixed.html` 仍指向旧 bundle（部署到一半的状态），时间点与本次过载的起点高度吻合。**两个会话不
协调地同时对同一台生产机器做部署/重启操作，本身就是这次事故的直接触发器**——任何一边单独的 pm2
restart/reload 都可能打断另一边正在进行中的、本就很重的启动序列，互相打断的结果是两边都不断重新执行那段
昂贵的 startup reconcile，CPU/内存双双失控。

**彻底避免的做法**：
- **多会话协作纪律**：如果怀疑或已知有另一个 Claude 会话可能同时在操作同一台生产服务器，**动手前必须先
  确认对方已停止**，不能假设"各自动各自的没关系"——本条本身就是本次事故最大的单一诱因。
- **改 nginx 配置后必须立刻 `nginx -t`**（哪怕暂时不 reload）——不要让"配置文件语法错误"变成一颗只有下次
  reload/reboot 才会引爆的地雷。
- **任何通过 pm2 直接改运行时配置（内存上限、env 等）之后，必须立刻 `pm2 save`**——本机 pm2 走
  `systemd pm2-root.service` + `pm2 resurrect` 启动，不经过 `ecosystem.config.cjs`，`dump.pm2` 快照
  才是重启后真正生效的东西，两者不同步就是下一次"返祖"的种子。
- **代码先于对应 migration 部署**这件事本身要避免：新代码依赖的新表，必须在部署代码的同一批次里把
  migration 一起跑掉，不能"代码先上线、migration 有空再补"。
- 这台服务器只有 2 核 CPU / 3.4G 内存，同时跑 hrms-service + agents-service-v2 + mempalace-http +
  Postgres，本身余量就不大——如果后续还会反复顶到这个上限，需要跟用户讨论是否该升级服务器规格，
  而不是每次都靠事后排查续命。

### 前端缓存方案：JS 真源在 frontend/src/pages，working-fixed.html 由 bundle 写回后再抽 shell

- **JS 真源**：`frontend/src/pages/*.js`（按业务区物理切分的经典 script，无 import/export）。
- **拼回**：`node scripts/bundle-frontend.mjs` → 写回 `working-fixed.html` 主 `<script>`。
- **部署产物**：`node scripts/build-shell.mjs`（内部先 bundle）→ `dist/`（shell + `app.<hash>.js/.css`）。
- HTML/CSS 结构仍以 `working-fixed.html` 为载体；**不要**直接在内联 `<script>` 里改业务逻辑。
- **B2 行数棘轮**：`server/test/working-fixed-size-gate.test.mjs` 冻结 `working-fixed.html` 总行数（当前 ≤69156）；
  只减不增；新 UI 进 `frontend/src/pages/*.js` 再 bundle，勿直接堆 inline script/HTML。
- **P5.1 onclick 棘轮**：`server/test/working-fixed-onclick-gate.test.mjs` 冻结 inline `onclick=` 数量（当前 ≤902，只减不增）；
  新 UI 禁止新增 inline onclick，应逐步迁到 `frontend/src/pages` 事件绑定。
- **B7 XSS（边界须如实）**：`/assets/vendor/dompurify/` 在主 script 前加载；`Element.innerHTML` setter 已挂 DOMPurify。
  - **已拦**：`<script>` / `<iframe>` / `javascript:` 等。
  - **不拦**：事件属性 XSS（`onerror`/`onload`/`onclick`/…）。因遗留 inline handler，`ADD_ATTR` 放行了 `on*`；
    **在消灭 inline `onclick` 等之前，不能把 B7 当成 XSS 已解决。**
  - **fail-closed**：DOMPurify 未加载时返回空串，禁止原样放行。
  - 新代码优先 `setHTML(el, html)` / `appendHTML(el, html)`；勿再引入第二个 `\n    <script>\n` 锚点（会破坏 bundle）。
  - 写入 innerHTML 的内容必须来自可信模板；不要把用户原文当 HTML 拼接。

#### ⚠️ 违反上面这条会「静默丢改动」（2026-07-23 真实事故）

改 `working-fixed.html` 内联 `<script>` 不会报错、当场也能跑通、甚至能构建部署成功——
但**下一次任何人跑 `bundle-frontend.mjs`（或 `build:shell`，它内部会先 bundle），
主 `<script>` 整块会被 `frontend/src/pages/*.js` 覆盖回去，你的 JS 无声无息消失**。
HTML/CSS 改动会留下，只有 JS 没了，所以现象非常迷惑：功能突然失效，但 diff 看着一切正常。

实际发生过两次：
1. 增长看板抽屉的 90 行 JS 注入后被覆盖，只剩 HTML 里的 `onclick="gxOpenSheet()"` 指向一个不存在的函数。
2. 档案页问候语的 `hourCycle` 修复（提交 `8e6b6b8`）只改了 `working-fixed.html` 没同步拆分源，
   被 bundle 回退成有 bug 的 `hour12:false` 版本；生产因为部署早于覆盖才侥幸没受影响。

**因此：**
- **拆分是按行号切的，不是按业务切的**——一个功能的 JS 很可能不在你以为的文件里。
  例：增长看板的 `renderGrowthSubnav` 定义在 `12-files.js`，而 `13-growth.js` 里只是调用它。
  动手前先 `grep -ln "函数名" frontend/src/pages/*.js` 确认归属，不要凭文件名猜。
- **改完必须验证真的进了产物**，不能只看本地页面正常：
  ```bash
  node scripts/bundle-frontend.mjs && grep -c "你的函数名" working-fixed.html
  node scripts/build-shell.mjs   && grep -c "你的函数名" dist/app.*.js
  ```
  两个都 ≥1 才算数。JS 哈希**没变**却声称改了 JS，一定是没进去。

**改动前端后重新部署步骤：**
1. 改 `frontend/src/pages/*.js`（或先改 HTML 结构部分）。
2. `npm run build:shell` → 生成 `dist/`（已 gitignore）。
3. 先传两个哈希资源再传 shell（顺序很重要，先有资源再换 shell，否则瞬间 404）：
   `scp dist/app.*.css dist/app.*.js root@47.100.96.30:/opt/hrms/`，
   再 `scp dist/working-fixed.html root@…:/opt/hrms/working-fixed.html.staged && ssh … "mv … working-fixed.html"`。
4. 验证：shell 返回 `Cache-Control: no-cache`+ETag；`app.<hash>.js/.css` 返回 immutable。

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
