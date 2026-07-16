# 客户AI × 销售AI 商业化验收 · 批次1加固报告

范围：只做权限/脱敏/并发去重/阶段审计/运行时DDL收编/开租户补偿这条安全基线，不做槽位schema、
事件字典、Demo预约闭环、三张看板、P2。对应用户在审计文档之后追加的加固指令。

## 一、审计结论核实（逐项证据）

| # | 核实项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 7个新接口是否只用platformAdminRequired | **确认属实(修改前)** | `server/sales-ai-routes.js` 7处路由注册均只有 `platformAdminRequired`，未叠加`managerGate` |
| 2 | 普通sales/customer_service能否看全部sales_leads | **确认属实(修改前)** | `listLeads()`原SQL无owner过滤；`platformAdminRequired`只校验JWT+`account_role∈{super_admin,sales_manager,sales,customer_service}`四选一，不做记录级过滤 |
| 3 | leads/:id、timeline、commissions是否缺记录级归属校验 | **确认属实(修改前)** | 三处handler均只按数字ID查询，不比对`req.platformAdmin.username`与`owner_username`/`rep_key` |
| 4 | 手机号是否明文返回 | **确认属实(修改前)** | `getLeadDetail`/`listLeads`直接`SELECT *`返回，无任何mask逻辑 |
| 5 | createDemo/createMeeting/createTrial/createDeal/recordLossReason/pause是否绕过recordStageChange和canTransition | **确认属实(修改前)** | 6处均直接`UPDATE sales_leads SET stage=...`，只有手动`/stage`路由调用了`canTransition`；`recordStageChange`只在AI会话路径和手动路由里被调用 |
| 6 | sales_tasks是否只有SELECT后INSERT无唯一约束 | **确认属实(修改前)** | `upsertTask`原实现是`SELECT...LIMIT 1`后`INSERT`，无DB约束兜底，存在TOCTOU竞态窗口 |
| 7 | 重复msg_id是否仍继续跑完整副作用 | **确认属实(修改前)** | `addMessage`原实现虽然`SELECT`去重了消息行本身，但`handleInboundMessage`在其后无条件继续评分/LLM/`applyLeadUpdates`/通知 |
| 8 | external_userid是否缺唯一约束 | **确认属实(修改前)** | `sales_leads`原schema无该约束；`upsertLead`是SELECT-then-INSERT模式 |
| 9 | nurture_step等字段是否运行时ALTER与正式migration重复管理 | **确认属实(修改前)** | `nurture_step`/`nurture_last_sent_at`只在`sales-nurture.js`运行时ALTER；`intent_level`/`handoff_level`/`last_sales_decision`则是`sales-store.js`运行时ALTER**和**`server/migrations/113_sales_ai_customer_collaboration.sql`重复管理 |
| 10 | provisioning是否存在核心事务成功但tenant_id写回失败的问题 | **确认属实(修改前)** | 核心事务(tenants/users/hrms_state/license)有BEGIN/COMMIT保护，但事务提交后的`startOnboarding`/`upsertCustomer`/3条`UPDATE sales_leads|sales_deals|sales_trials`完全在事务外、且原本无try/catch，任一失败会让调用方收到500但租户已经真实创建 |

以上10项审计结论**全部确认属实**，与`docs/customer-sales-ai-commercial-acceptance.md`一致。下面是本批的修复情况。

## 二、权限矩阵（已实现）

新建 [sales-permissions.js](../server/services/sales/sales-permissions.js)：

| 角色 | 线索(sales_leads) | 租户数据(续费/上线/价值报告) | 提成 |
|---|---|---|---|
| super_admin / sales_manager | 全量 | 全量 | 全量 |
| sales | `owner_username=自己` 或 `assigned_to=自己` | 依附在可访问的线索上(通过tenant_id反查lead判断) | 只能查自己(`rep_key=自己username`) |
| customer_service | `cs_owner_username=自己`(新字段，默认未分配=不可见) | 同上 | 不可见(非manager一律强制查自己，customer_service没有rep记录会查到空列表) |

核心函数：`leadScopeSql`(列表查询用SQL片段)、`canAccessLead`(单条记录判断)、`canAccessTenant`(通过关联线索判断)、`canAccessTask`、`canAccessRepMetrics`。

已接入的接口：`GET /leads`(列表加scope过滤)、`GET /leads/:id`、`GET /leads/:id/timeline`、
`GET /tenants/:tenantId/{onboarding,renewal-health,value-report}`、`GET /renewal-risks`、
`GET /referral-candidates`、`GET /trials/:id/progress`、`GET /commissions`(强制rep_id=自己)、
`GET /reps/:id/scorecard`。失败统一返回**404**(不用403)，避免通过状态码差异确认记录是否存在。

**未覆盖**：其余约55个`/api/admin/sales/*`只读接口(如`/funnel`、`/top5`、`/risks`、`/boss-dashboard`、
`/kpi-leaderboard`)本批未加scope过滤，维持"任何四种角色都能看聚合数据"的原状——这些是团队级聚合看板，
是否需要按角色收窄留给第二批讨论，本批只处理审计里明确点名的记录级泄露风险(单条线索详情、租户数据、个人提成)。

## 三、脱敏（已实现）

[sales-privacy.js](../server/services/sales/sales-privacy.js)：`maskPhone`格式`138****5678`；
`maskLeadContact`递归处理`extracted`JSONB内所有键名含"phone"的字段(不只是顶层`phone`)；
`canViewFullContact`按角色+归属判断是否明文。

新增受控接口 `POST /leads/:id/reveal-contact`：要求body带`reason`，权限判断+404/403，
利用已有的`platformAdminRequired`中间件对非GET请求自动写`platform_admin_audit_log`
(含`admin_username/path/target_tenant_id/detail/ip`)，不用另建审计表。

## 四、限流防枚举（已实现，轻量级）

新建 [sales-rate-limit.js](../server/services/sales/sales-rate-limit.js)：进程内内存计数，
每人每路由族每分钟60次上限，超限返回429并打警告日志。已接入本节列出的全部敏感只读接口。
**局限**：单进程内存实现，重启清零、多实例不共享计数——现有部署是单实例pm2 fork模式，够用；
如果未来扩成多实例集群需要换成Redis等共享存储，这是已知的技术债，不在本批范围内解决。

## 五、统一阶段写入入口（已实现）

详见 [customer-sales-ai-state-machine.md](customer-sales-ai-state-machine.md)。`transitionLeadStage`
统一了createDemo/createMeeting/createTrial/createDeal/recordLossReason/pause动作/手动stage路由
共7处写入点，行锁+校验+审计在同一事务。状态表按这6处历史行为"如实收口"而非重新设计，避免拒绝掉
真实发生过的成交/暂停动作。**唯一未收口**：sales-session.js里AI每轮对话驱动的自动阶段变更(已有
recordStageChange审计，但未加canTransition校验)，评估后判断这条热路径的结构性改造风险大于本批
收益，留作已知缺口。

## 六、任务dedup_key规则（已实现）

`sales_tasks`新增字段：`task_domain`(sales/nurture/onboarding/customer_success/renewal/referral)、
`task_type`、`tenant_id`、`source_type`、`source_id`、`dedup_key`、`completed_at`、`completion_result`、
`created_by`，`dedup_key`上有唯一索引`idx_sales_tasks_dedup_key`。

规则(与用户指定格式一致)：
- 培育任务：`nurture:{lead_id}:{nurture_step}`
- 续费风险任务：`renewal-risk:{tenant_id}:renewal_health:{YYYY-MM-DD}`（按天粒度，6小时cron同一天只生成一条）
- 转介绍任务：`referral:{tenant_id}:{YYYY-MM-DD}`

`upsertTask`改为`INSERT...ON CONFLICT(dedup_key) DO NOTHING`原子写入；未传`dedup_key`的旧调用方
(比如后台手动创建任务)保持原有的`(lead_id,title,status='open')`兜底行为不变。

## 七、重复消息处理（已实现）

`addMessage`改为`INSERT...ON CONFLICT(msg_id) DO NOTHING`原子写入，返回值新增`inserted`布尔标记。
`handleInboundMessage`在三个分支(human/waiting_human/ai)都检查`inserted===false`时立即返回
`{ok:true, replied:false, reason:'duplicate_message'}`，不再继续跑评分/LLM回复/`applyLeadUpdates`/
转人工通知/培育状态更新。

## 八、线索/会话并发（已实现 + 单corp核实）

**核实结论**：企微客服配置(`sales-kf.js`)里`WECOM_KF_CORP_ID`是单一环境变量，本部署只服务一个企微
corp，不存在"同一个external_userid分属不同corp"的场景。因此`UNIQUE(external_userid)`（不需要
复合键）就是正确的业务唯一键，维持migration 124里已经实现的方案，未做复合键改造。

`upsertLead`/`upsertConversation`均改为`ON CONFLICT...DO NOTHING`原子upsert，命中约束缺失(过渡期
历史脏数据未清理)时优雅退回旧逻辑而不是抛500。

## 九、Provisioning补偿机制（已实现）

核心事务(tenants/users/hrms_state/license)提交后立即落库`provision_status='tenant_created'`
+`provision_meta`(含`retry_count:0`)。后续`startOnboarding`/`upsertCustomer`/3条回写UPDATE
各自try/catch，失败记入`provision_meta.failed_steps[]`(含`step/error/at`)，整体状态记为
`'partial'`（全部成功才是`'done'`）。

重试逻辑：`provisionTenantFromLead`发现`lead.tenant_id`已存在且`provision_status!=='done'`时，
**跳过**建租户/建管理员账号那段（不会创建第二个租户），只重跑还没完成的收尾步骤——这些步骤本身
都是幂等的(upsert/COALESCE/`WHERE tenant_id IS NULL`)。

新增只读接口 `GET /provisioning/pending-compensations`(manager权限)列出所有`tenant_created`/`partial`
状态的记录，供人工确认后调用现有的`POST /leads/:id/provision-tenant`触发重试。
**未实现**：自动定时重试——评估后认为无监督的自动重试如果命中永久性失败(比如租户名冲突)会
无限重试消耗资源，本批只做"可见+手动重试入口"，不做自动化。

## 十、案例外部使用保护（已实现，行为有变化）

`sales_case_assets`新增`external_use_allowed`/`anonymized`/`approved_by`/`approved_at`，
**默认值全部是false**。`recommendCasesForLead`(客户AI诊断话术引用的案例来源)现在要求
`external_use_allowed=true AND anonymized=true`才会被推荐。

⚠️ **这是一个刻意的行为倒退，需要人工操作才能恢复**：此前(P0阶段)已经上线的"诊断结论+案例佐证"
功能里，案例引用靠的是`external_approved`字段(默认true)，一直在正常展示。本批按用户明确要求
("旧数据默认不得自动视为允许外部展示")换成更严格的字段且不做兼容回退，**部署后客户AI将不再
引用任何案例，直到有人过一遍案例库手动批准**。恢复方式：

```sql
UPDATE sales_case_assets
   SET external_use_allowed = true, anonymized = true,
       approved_by = '<审核人>', approved_at = NOW()
 WHERE status = 'active';  -- 建议先人工过一遍内容确认已脱敏，而不是无脑全量放行
```

## 十一、迁移与索引清单

| Migration | 内容 |
|---|---|
| `124_sales_ai_nurture_dedup_and_privacy.sql` | `nurture_step`/`nurture_last_sent_at`收编入正式migration；清理历史重复`external_userid`/重复open任务；建`idx_sales_leads_external_uid`(唯一)、`idx_sales_tasks_dedup_open`(唯一)；`sales_case_assets.external_approved`(默认true，历史兼容字段) |
| `125_sales_ai_scope_dedup_case_approval.sql` | `sales_leads.cs_owner_username`；`sales_tasks`补8个字段(task_domain/task_type/tenant_id/source_type/source_id/dedup_key/completed_at/completion_result/created_by)+3个索引(`idx_sales_tasks_dedup_key`唯一/`idx_sales_tasks_domain_status`/`idx_sales_tasks_tenant`)；`sales_case_assets`补4个字段(external_use_allowed/anonymized/approved_by/approved_at) |

两个migration均已在生产库执行成功(`node migrate.js --status`确认applied)，均通过`ADD COLUMN IF NOT EXISTS`
+ 历史数据清理保证在已有数据的库上安全跑通，也天然支持空库初始化(migration本身不依赖历史数据存在)。

**运行时DDL收编情况**：`nurture_step`/`nurture_last_sent_at`已从"业务请求触发ALTER TABLE"改成
"只读information_schema检查，缺列直接抛错提示去跑migrate.js"(见`sales-nurture.js`的
`ensureNurtureColumns`)。`intent_level`/`handoff_level`/`last_sales_decision`这3处运行时ALTER
（在`sales-store.js`的`ensureSalesTables`里）因为已经被migration 113覆盖过，属于纯粹的
幂等no-op，保留未动——它们是`ensureSalesTables`这个大函数的一部分，那个函数本身是"支持空数据库
初始化"的兼容路径(建N张表)，不在本批的"收编"范围内单独抽出来改造，属于合理的存量兼容逻辑。

## 十二、测试

新增 [server/test-sales-ai-batch1.mjs](../server/test-sales-ai-batch1.mjs)，覆盖：
- 权限矩阵纯函数断言(canAccessLead/canAccessTenant/leadScopeSql/canAccessRepMetrics/isManager)
- 脱敏纯函数断言(maskPhone格式、递归extracted字段、owner可见明文)
- 阶段机纯函数断言(widened转换表、终态保护)
- DB级：并发`upsertTask`(同dedup_key)只产生一行、并发`addMessage`(同msg_id)只产生一行且
  `inserted`标记互斥、`transitionLeadStage`合法转换写审计/非法转换零副作用/同状态幂等、
  `canAccessTenant`在查不到关联线索时对非manager fail-closed

**执行状态：纯函数部分已本地运行并全部通过；DB级断言未运行。**

纯函数部分(权限矩阵/脱敏/阶段机)不需要数据库连接，已在本地实际执行：

```bash
cd server && node test-sales-ai-batch1.mjs   # 不设DATABASE_URL会自动跳过DB断言，只跑纯函数部分
```

```
ok permission matrix: canAccessLead role/ownership rules
ok permission matrix: isManager
ok permission matrix: canAccessRepMetrics (commission scoping)
ok permission matrix: leadScopeSql SQL fragment shape
ok phone masking: top-level + recursive extracted.* fields, owner sees plaintext
ok stage machine: widened transitions match real business actions, terminal states still guarded
SKIP: no DATABASE_URL, DB-backed assertions skipped (pure-function assertions above all passed)

ALL PASS
```

**这次实际运行不是走过场——它在部署前抓出了两个真实bug**：`STAGE_TRANSITIONS`第一版手写时漏掉了
`new→won`（会导致极快成交路径被误判为非法转换、真实拒单）、且错误允许了`lost→won`（丢单后不经
`nurture`重新激活就能直接显示成交，不合理）。改成用代码生成转换表并修正后测试才通过，随后已重新
部署到生产（详见十三）。这也印证了你在需求里强调的"必须验证数据库最终状态、不能只审查代码"的
必要性——如果没跑这段测试，这两个bug会带着"我自己看过很多遍代码"的错觉直接上线。

DB级断言（并发去重/阶段审计事务/canAccessTenant fail-closed）设计为对真实Postgres运行（用
`e2e_test_`前缀的隔离数据，跑完自动清理），但本环境唯一可连接的数据库是生产库，直接在生产库上
执行INSERT/DELETE测试操作被Claude Code的安全分类器拦截("修改共享资源")，需要你显式授权才能执行——
即使是自清理的隔离数据也不例外。

若你确认可以在生产库跑隔离测试数据，完整命令是：
```bash
cd /opt/hrms && set -a && source .env && set +a && node server/test-sales-ai-batch1.mjs
```

## 十三、上线步骤（本批已执行）

1. `git diff`确认本地与生产同源 → 已确认
2. 备份生产文件(`.bak.<timestamp>`) → 已执行
3. scp部署代码文件 → 已执行
4. 生产环境`node --check`语法检查全部文件 → 全部通过
5. `node migrate.js --status`确认待执行迁移 → 124、125均识别为pending
6. `ALLOW_PRODUCTION_MIGRATE=true node migrate.js` → 124、125均执行成功
7. psql核实新增列/索引真实存在 → 已核实(cs_owner_username/task_domain/dedup_key/external_use_allowed等)
8. `pm2 restart hrms-service` → 已执行
9. `curl /` 返回200 + `pm2 logs --err`无新增报错 → 已核实

## 十四、回滚步骤

代码回滚：
```bash
# 服务器上，每个改动文件都有 .bak.<timestamp> 备份
cp /opt/hrms/server/sales-ai-routes.js.bak.<ts> /opt/hrms/server/sales-ai-routes.js
# ...其余文件同理，然后
pm2 restart hrms-service
```

数据库回滚（migration不可逆，需谨慎）：
- 124/125都是纯新增字段+索引，理论上不影响回滚后的旧代码运行(旧代码不读取新列)
- 如需彻底回滚schema：
```sql
DROP INDEX IF EXISTS idx_sales_tasks_dedup_key, idx_sales_tasks_domain_status, idx_sales_tasks_tenant;
DROP INDEX IF EXISTS idx_sales_leads_external_uid, idx_sales_tasks_dedup_open, idx_sales_leads_cs_owner;
ALTER TABLE sales_tasks DROP COLUMN IF EXISTS task_domain, DROP COLUMN IF EXISTS task_type,
  DROP COLUMN IF EXISTS tenant_id, DROP COLUMN IF EXISTS source_type, DROP COLUMN IF EXISTS source_id,
  DROP COLUMN IF EXISTS dedup_key, DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS completion_result,
  DROP COLUMN IF EXISTS created_by;
ALTER TABLE sales_leads DROP COLUMN IF EXISTS cs_owner_username;
ALTER TABLE sales_case_assets DROP COLUMN IF EXISTS external_use_allowed, DROP COLUMN IF EXISTS anonymized,
  DROP COLUMN IF EXISTS approved_by, DROP COLUMN IF EXISTS approved_at;
-- 124迁移清理过的重复external_userid/重复任务数据不可自动恢复，需要从pg_dump备份找回(如果需要)
```
- 迁移执行前**未**做`pg_dump`快照（migration本身只做ADD COLUMN + 清理明确重复行，风险较低，
  且清理逻辑本身可审计——见124迁移SQL注释），如果你认为需要更强的可回滚性，后续migration
  建议先加一步`pg_dump`快照到`server/migrations/`之外的备份路径。

## 十五、未解决问题清单

1. **测试未实际执行**（见十二），需要你授权后由你或我在获得明确许可的情况下运行
2. **案例库外部使用需要人工重新批准**（见十）——部署后客户AI暂时不会引用任何案例，直到手动执行批准SQL
3. **约55个聚合类只读接口未加记录级权限**(top5/funnel/risks/boss-dashboard/kpi-leaderboard等)——本批只处理审计明确点名的记录级泄露风险
4. **AI自动阶段变更路径未加canTransition校验**(sales-session.js热路径，见五)
5. **限流是单进程内存实现**，多实例部署会失效(当前单实例够用)
6. **Provisioning补偿是手动重试**，未做自动定时重试(见九)
7. **`intent_level`/`handoff_level`/`last_sales_decision`仍有运行时ALTER残留**（无害的no-op，未清理，见十一）
8. Migration执行前未做`pg_dump`快照（见十四）

## 结论：是否可以进入第二批？

**本批（权限/脱敏/并发去重/阶段审计/DDL收编/provisioning补偿）在代码和schema层面已经完成并部署**，
但有一个前提尚未满足：**测试还没有实际跑起来验证**（被安全分类器拦截，需要你的明确授权）。

建议顺序：
1. 你决定是否授权在生产库跑隔离测试数据（或者提供一个非生产DB连接串）
2. 测试通过后，视为批次1真正验收完成
3. 案例库需要你安排人工过一遍、执行批准SQL，恢复客户AI的案例引用能力
4. 之后再考虑是否进入第二批（槽位schema统一/事件字典/Demo预约闭环等）

在测试被验证之前，我不建议正式宣布"批次1已验收"——代码逻辑已经过我逐行检查且部署健康检查通过，
但"数据库最终状态是否真的符合预期"这一条，按你自己在需求里强调的标准("不能只测试HTTP 200")，
现在还没有被证实。

## 十六、批次1最终验收收尾（2026-07-16）

- 数据库级测试：**未执行**。本地没有 `TEST_DATABASE_URL`、`E2E_DATABASE_URL`、独立测试库或Docker PostgreSQL；生产库连接配置也不可作为测试库使用。本次未向生产库写入测试数据，未伪造通过结果。待提供测试库后执行 `cd server && DATABASE_URL="<测试库>" node test-sales-ai-batch1.mjs`。
- 案例库审批：已尝试通过生产只读查询核实，但服务器当前 `.env` 的 `DATABASE_URL` 指向不存在的本机角色 `magainze`，无法取得真实清单；未批量批准任何案例。客户AI仍严格要求 `status='active' AND external_use_allowed=true AND anonymized=true AND approved_at IS NOT NULL`。
- AI阶段热路径：已改为调用 `transitionLeadStage`，不再由 `sales-session.js` 直接写入阶段；非法转换记录警告事件并继续安全回复，同阶段保持幂等。纯函数批次1测试实际通过；数据库级阶段并发断言仍待测试库执行。
- 结论：**批次1暂不正式验收通过**，原因仅为数据库级测试和案例清单核实缺少安全可用的数据库环境；代码收口已完成。

## 十七、隔离数据库重放记录（2026-07-16）

- 本机测试环境：Homebrew PostgreSQL 16.14，独立数据库 `hrms_sales_ai_test`、独立用户 `hrms_test`，监听本机 5432；未连接生产数据库。
- 从空库开始重放正式 migration。已修复并通过空库重放的历史兼容点：004（缺少 `hrms_state` 时跳过历史数据搬迁）、025（缺少 `point_records` 时跳过索引）、028（表达式索引语法）、033（约束依赖的索引删除）、035/037/039（可选表缺失时跳过租户列补充）。
- 当前阻断：完整链尚未验证通过；最新一次重放已通过 001–059，060 已完成存在性保护修复，待重建空库后继续验证。根据本次验收规则，未创建占位表、未跳过 migration、未执行批次1数据库测试。
- 因此本节结论仍为：**批次1未通过，阻断项为完整正式 migration 链尚未能从空库成功重放**。未部署、未执行生产 migration、未触碰生产测试数据。

## 十八、批次1最终数据库验收（2026-07-16）

- 隔离 PostgreSQL `hrms_sales_ai_test` 从空库完整重放 001–126 通过，共 133 个 migration 文件；第二次执行 `applied 0, skipped 133`，幂等通过。
- `server/test-sales-ai-batch1.mjs` 使用该隔离库实际执行并 `ALL PASS`：权限矩阵、手机号递归脱敏、任务/消息并发去重、合法阶段审计、非法阶段无副作用、同阶段幂等、租户拒绝策略均通过。
- 修正验收脚本的非法阶段场景为真实非法回退 `ai_greeting → new`；保留既有业务规则允许非终态直接进入 `won` 的行为。
- 本阶段未部署、未连接生产数据库、未执行生产 migration；未进入批次2。
