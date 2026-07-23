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

### 前端缓存方案：JS 真源在 frontend/src/pages，working-fixed.html 由 bundle 写回后再抽 shell

- **JS 真源**：`frontend/src/pages/*.js`（按业务区物理切分的经典 script，无 import/export）。
- **拼回**：`node scripts/bundle-frontend.mjs` → 写回 `working-fixed.html` 主 `<script>`。
- **部署产物**：`node scripts/build-shell.mjs`（内部先 bundle）→ `dist/`（shell + `app.<hash>.js/.css`）。
- HTML/CSS 结构仍以 `working-fixed.html` 为载体；**不要**直接在内联 `<script>` 里改业务逻辑。
- **B7 XSS**：`/assets/vendor/dompurify/` 在主 script 前加载；`Element.innerHTML` setter 已挂 DOMPurify。
  新代码优先 `setHTML(el, html)` / `appendHTML(el, html)`；勿再引入第二个 `\n    <script>\n` 锚点（会破坏 bundle）。

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
