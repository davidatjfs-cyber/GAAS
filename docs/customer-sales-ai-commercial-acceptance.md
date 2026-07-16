# 客户AI × 销售AI 商业化运行验收审计

审计日期：2026-07-16
审计方式：5个独立只读代码审计（客户AI对话层 / 销售AI后端 / P0-P1新模块 / 数据库schema / 安全权限），逐项要求文件行号或函数级证据，不接受仅凭文件名判断的结论。
审计范围：`sales-strategy.js` `sales-customer-ai.js` `sales-case-library.js` `sales-session.js` `sales-nurture.js` `sales-timeline.js` `tenant-value-report.js` `sales-trial-monitor.js` `tenant-onboarding.js` `tenant-renewal-service.js` `sales-store.js` `sales-scoring.js` `sales-sla-service.js` `sales-ops.js` `sales-collaboration-service.js` `sales-reply-draft.js` `sales-internal-assistant.js` `sales-proposal.js` `sales-provisioning.js`，以及 `sales_tasks` `sales_leads` `sales_lead_events` `sales_stage_history` `tenant_health_incidents` `growth_ontology_attributions`。

状态标记口径：**已完整实现 / 部分实现 / 只有后端接口 / 缺少前端入口 / 缺少数据库字段 / 缺少真实E2E测试 / 缺少权限控制 / 缺少埋点 / 存在重复实现 / 存在生产风险**。同一项可以叠加多个标记。

---

## 一、客户画像槽位一致性

**状态：存在重复实现 / 缺少数据库字段**

没有单一权威 schema。四个文件各自维护不完全一致的字段清单：

| 文件 | 实际使用的字段集合 |
|---|---|
| `sales-knowledge.js:93-104` `DIAGNOSTIC_SLOTS` | `store_count, city, cuisine, pos_brand, phone_data_ready, member_estimate, other_system_used, pain_point, contact_phone, decision_role`（10项，"问什么"的唯一来源） |
| `sales-strategy.js:20-94` `extractSlotsFromText` | 在上面10项之外额外产出 `name, company, phone, budget_range, expected_close_hint, has_member_system`；且用 `phone` 存储手机号，槽位定义里叫 `contact_phone`——**两个名字指向同一份数据，靠人读代码对齐，无强校验** |
| `sales-scoring.js:5-27` `RULES` | 只引用6个字段，且用的是 `has_member_system`（extractSlotsFromText产出）而不是 `other_system_used`（DIAGNOSTIC_SLOTS定义）——**语义相近但不是同一字段**，容易被误认为同一个槽位 |
| `sales-ops.js` `applyLeadUpdates` → `sales_leads`表列 | `other_system_used`/`has_member_system` 都没有对应的顶层列，只存在于 `extracted` JSONB 里；`buildNextAction`/`buildSalesAdvice`等读顶层字段的逻辑访问不到它们 |

**证据结论**：用户要求的"唯一schema定义"目前不存在，需要在第二阶段建立并收敛这4处引用。

---

## 二、真实Demo预约闭环

**状态：缺失（当前是纯话术） / 存在生产风险**

- `diagnosisCta()`（`sales-strategy.js:172-180`）在客户表达预约意向时，只返回一句固定话术："我可以为您安排一次30分钟的针对性演示…"，**不写任何数据库记录**。
- `detectEvents()`识别到 `REQUEST_DEMO` 事件（`sales-strategy.js:96-110`）时，只是把 `recommended_action` 设为 `takeover`——把控制权交给人工，但**没有创建 `demo_scheduling` 类型的 `sales_task`，没有询问客户可用时间，没有指定责任人，没有写 `demo_requested` 事件类型**（实际写入的 event_type 是通用的 `REQUEST_DEMO`，走的是普通事件管道，不是专属状态机）。
- 唯一真正落库的入口是人工顾问登录 `platform-admin.html` 后台事后手动调用 `createDemo()`（`sales-store.js:426-441`，路由 `/api/admin/sales/demos`），需要顾问自己填 `scheduledAt/attendedBy/summary`——**这是销售人工补录，不是客户AI对话中自动生成的任务**。
- `sales-collaboration-service.js:9-10` 的状态机定义里 `demo_scheduled` 是合法状态，但全仓库搜不到任何代码真正把 `stage` 设为 `'demo_scheduled'`。

**结论**：用户指出的问题完全属实——"预约演示"目前止于话术，闭环需要在第二阶段从零搭建。

---

## 三、诊断结论 + 案例交付

**状态：部分实现 / 缺少埋点**

- 触发与生成逻辑已完整：`sales-strategy.js:150-154`（`diagnosis_complete`模式）+ `sales-customer-ai.js:69-72`（案例推荐注入）。
- 但 `diagnosis_delivered=true` **只是 `sales_leads.extracted` JSONB 里的一个布尔flag**，随 `applyLeadUpdates` 整体写入，**不是 `sales_lead_events` 里的可审计事件**。全仓库搜不到任何 `event_type='diagnosis_delivered'` 或 `'case_recommended'` 的 `addEvent` 调用。
- 后果：无法在事件时间线上回答"什么时候对哪个客户推了哪个案例"，也就无法做用户要求的"诊断后Demo预约率"这类归因统计。

---

## 四、培育任务去重（sales-nurture.js）

**状态：部分实现 / 存在生产风险**

- `upsertTask`（`sales-store.js:408-420`）按 `(lead_id, status='open', title)` 做SELECT去重，title是固定字符串（如"培育Day1：发送针对性案例"），**这一层能防住"同一cron正常单次运行"的重复**。
- 但 SELECT 和 INSERT 之间**没有事务/行锁**（无 `SELECT...FOR UPDATE`），也**没有对应的数据库唯一约束**兜底。如果两个进程并发跑同一tick（例如部署时pm2重启导致新旧进程短暂并存），两次SELECT都可能读到"不存在"，各自INSERT出重复任务——经典TOCTOU竞态。
- `sales_leads.nurture_step` 的 `UPDATE` 同样没有乐观锁（无 `WHERE nurture_step=旧值`条件）。
- 三个新增cron（nurture/CS任务同步/试跑校验）仅靠 `globalThis.__xxxTimer` 防止**同一进程**内重复注册定时器，对**多进程**场景（错误的多实例部署）零防护。

---

## 五、重复消息 / 并发处理（sales-session.js）

**状态：部分实现 / 存在生产风险**

- **消息级去重健壮**：`addMessage()`（`sales-store.js:362-374`）插入前先查 `msg_id`，且表上有唯一索引 `idx_sales_msg_msgid`兜底，双重保险。
- 但 msgId 去重**只防止 `sales_messages` 表出现重复行**，`handleInboundMessage`（`sales-session.js:71-269`）在这之后仍会继续走完整套评分/生成回复/`applyLeadUpdates`/通知流程——**如果企微重推同一条消息，客户可能收到两条几乎相同的AI回复，销售可能收到重复通知**。
- **线索级无事务保护**：`upsertLead`/`upsertConversation`（`sales-session.js:38-69`）都是先查后插，`sales_leads.external_userid`**没有唯一约束**（只有普通索引），并发场景下同一客户可能被拆成两条不同 `lead_key` 的线索，历史和评分分裂。`sales_conversations`有部分唯一索引但代码未捕获其冲突异常，命中时会直接抛异常而非优雅回退。

---

## 六、前端入口盘点

**状态：部分实现 / 缺少前端入口**

重要澄清：**working-fixed.html 与销售AI完全无关**——里面的"sales"字样全部指向 `sales_raw`(POS销售流水/经营预测)，是另一套功能。真正的销售/客户成功坐席后台是 **`platform-admin.html`**。

已接入前端（约50个接口）：线索列表/详情、接管/释放、回复/草稿话术、诊断、过度承诺检测、客户档案、拜访邀请、动作、Demo简报、开租户、深度诊断、方案书、Demo/会议/试跑/成交/流失记录、老板看板、案例库、知识库、销售花名册、KPI榜单、提成、培训、内部助手对话、日报、Top5、待办、风险、漏斗、沙盒试聊、拜访记录、上线进度。

**本轮新增的7个接口，以及另外7个既有接口，共14个后台接口在 `platform-admin.html` 里完全没有调用入口**：
- `GET /api/admin/sales/leads/:id/timeline`
- `GET /api/admin/sales/tenants/:tenantId/value-report`
- `GET /api/admin/sales/trials/:id/progress`
- `GET /api/admin/sales/tenants/:tenantId/renewal-health`
- `GET /api/admin/sales/renewal-risks`
- `GET /api/admin/sales/referral-candidates`
- `POST /api/admin/sales/leads/:id/stage`（直接置阶段）
- `POST /api/admin/sales/leads/:id/assign`
- `GET /api/admin/sales/leads/:id/summary`
- `GET /api/admin/sales/assistant/threads`（+ `/messages`）
- `GET /api/admin/sales/objections`（列表）
- `GET/POST /api/admin/sales/kpi-targets`
- `POST /api/admin/sales/kpi-scores`
- `POST /api/admin/sales/trials/:id/validate`

（`tenants/:tenantId/onboarding` 例外——已确认有前端调用）

---

## 七、销售阶段审计完整性（sales_stage_history）

**状态：部分实现 / 存在生产风险**

`recordStageChange`（写入审计表的唯一函数）只在2处被调用：手动 `/stage` 路由和AI会话决策路径。**其余6处直接写 `sales_leads.stage` 的地方全部绕过审计表**：

- `sales-store.js:435` `createDemo` → 置为 `demo_completed`
- `sales-store.js:452` `createMeeting` → 置为 `sales_takeover`
- `sales-store.js:468` `createTrial` → 置为 `trial`
- `sales-store.js:482` `createDeal` → 置为 `won`
- `sales-store.js:507` `recordLossReason` → 置为 `lost`
- `sales-ai-routes.js:562`（pause动作）→ 置为 `paused`

`canTransition`（`sales-collaboration-service.js:21-25`）是真实的状态转换校验（非空实现），但**只在手动`/stage`路由这一个入口被调用**，上述6处全部绕过它直接写库——理论上 `createDeal` 可以把一个还在 `new` 阶段的线索直接置为 `won`，没有任何拦截。

---

## 八、权限与租户隔离

**状态：缺少权限控制 / 存在生产风险**

- `platformAdminRequired` 确实校验有效JWT，不是"任意登录用户"都能过，但它把 `super_admin/sales_manager/sales/customer_service` **四种角色一视同仁**放行。7个本轮新增接口全部只用这一层gate，**没有一个应用 `requireSalesManagerOrAbove`**。
- **无记录级越权保护**：`GET /leads` 列表SQL完全不按 `owner_username`/`assigned_to` 过滤，任何角色登录后看到全部线索；`GET /commissions?rep_id=xxx` 的 `rep_id` 是客户端传入的查询参数，不是从登录身份派生的，普通销售可以传别人的id看到别人的提成。
- **IDOR/未脱敏风险**：`sales_leads.id` 是自增BIGSERIAL，`leads/:id/timeline`、`leads/:id`等接口对ID本身不做归属校验，普通客服账号理论上可以顺序遍历ID拉取全部客户手机号（返回体明文含 `phone` 字段），且**没有任何限流/防枚举机制**。
- **案例库无外部使用授权字段**：`sales_case_assets` 表只有 `status='active'` 一个门槛，没有"是否已匿名化/是否允许对外展示给客户"的字段，理论上任何标记active的案例都会被推给潜在客户。
- **SQL注入检查通过**：抽查的关键新文件（`sales-timeline.js`/`tenant-renewal-service.js`/`tenant-onboarding.js`/`sales-ai-routes.js`）全部使用参数化查询，未发现拼接风险。

---

## 九、数据库schema现状

**状态：缺少数据库字段 / 存在重复实现**

`sales_tasks` 当前列：`id, lead_id, title, detail, status, due_at, assignee, created_at, updated_at`。用户要求的 `task_domain, task_type, tenant_id, owner_id, owner_role, source_type, source_id, priority, completed_at, completion_result, dedup_key, created_by` **全部缺失**，去重目前靠 `(lead_id, status, title)` 的应用层SELECT，不是真正的 `dedup_key`。

`sales_lead_events` 缺 `correlation_id, dedup_key, actor_type, actor_id, session_id, source_type, source_id`（用户要求的统一事件字典需要这些列）。

`sales_stage_history` 纯append-only，无任何唯一约束防止短时间内重复写入同一 `(lead_id, to_stage)`。

**存在重复实现**：`nurture_step`/`nurture_last_sent_at`（`sales-nurture.js`运行时ALTER）、`intent_level`/`handoff_level`/`last_sales_decision`（`sales-store.js:282-284`运行时ALTER）与 `server/migrations/113_sales_ai_customer_collaboration.sql` 里已经正式迁移过的**同名列重复定义**——两条独立的DDL路径管理同一批列。

`server/migrate.js` + `server/migrations/*.sql` + `schema_migrations`跟踪表这套正式迁移基础设施是存在且在用的（其他约15个sales相关迁移文件都在这里），但 `ensureSalesTables()`绕开了 `ALLOW_SCHEMA_CHANGES` 生产开关，在请求时直接跑DDL——这是本仓库其余部分明确要避免的模式（`index.js`对其他表的DDL都做了这层开关保护）。

---

## 十、新增P0-P1模块的数据真实性

**状态：部分实现（非全部造假，但部分指标默认为惩罚态）**

- `tenant_health_incidents` **确实有真实每日cron**在填充（`tenant-health-center-scheduler.js`，每天07:00-07:14跑一次巡检+同步），不是空表。
- `growth_ontology_attributions` 有真实写入方（`growth-attribution-service.js`），但依赖该租户是否真的跑了归因流程——**对没有主动使用营销归因功能的租户，`attribution_count_30d`会一直是0**，导致 `renewal_health_score` 里这一项固定扣10分，不代表客户真实变差，只是功能未启用。
- `tenant-onboarding.js`对没有巡检记录的新租户会优雅降级为"未检测"，不会伪造成"已完成"。

---

## 十一、测试覆盖现状

**状态：缺少真实E2E测试**

- `server/test-sales-ai.mjs` 是手写node脚本（非jest/mocha标准结构），真实覆盖了 `sales-strategy.js`/`sales-customer-ai.js`/`sales-scoring.js`/`sales-ops.js`/`sales-tags.js`/`sales-diagnosis.js`的断言测试，**不是空跑**。
- 另有 `sales-collaboration.test.mjs`/`sales-sla-service.test.mjs`/`sales-commission-service.test.mjs` 三个独立测试文件。
- **完全没有测试**：`sales-session.js`（最核心的编排逻辑，含并发/去重/接管）、`sales-nurture.js`、以及本轮新增的全部6个模块（`sales-timeline.js`/`tenant-value-report.js`/`sales-trial-monitor.js`扩展部分/`tenant-onboarding.js`/`tenant-renewal-service.js`）、`sales-provisioning.js`。
- **没有任何HTTP级别的E2E测试**，也没有权限/租户隔离测试。

---

## 十二、sales-provisioning.js 事务边界

**状态：部分实现**

核心开租户逻辑（`tenants`/`users`/`hrms_state`/`license`四张表）确实包在真实事务里，失败会完整回滚，这块没问题。但**事务COMMIT之后**的收尾步骤（`startOnboarding`/`upsertCustomer`/更新`sales_leads`和`sales_deals`和`sales_trials`的`tenant_id`）不在事务内，其中最后3条`UPDATE`**没有try/catch**——如果其中一条抛异常，租户已经真实创建成功，但`sales_leads.tenant_id`永远不会被写回，导致这条线索"查不到自己开通的租户"，需要人工介入修复。

---

# 总体结论

## P0 是否真正完整？

**不完整。** 5项P0能力（诊断话术、案例匹配、培育节奏、统一时间线、月度价值报告）在**对话生成/数据聚合逻辑**层面是完整的，但：
- 诊断交付和案例推荐没有对应的可审计事件，无法回答"这个动作有没有效"
- 统一时间线依赖的post-sale数据（`tenant_health_incidents`）虽有真实cron，但新开租户当天可能是空的
- 没有任何测试验证过这5项在真实HTTP请求下的端到端行为

## P1 是否真正完整？

**不完整，且缺口更明显。** 4项P1能力（试跑倒计时、上线清单、续费健康度+风险+转介绍、CS任务）：
- **100%没有前端入口**，只能靠curl/Postman调用，销售和客户成功人员实际上看不到这些数据
- 续费健康度的"归因产出"分量对未启用营销归因的租户系统性地打低分，容易造成误判
- CS任务写入`sales_tasks`存在竞态窗口，理论上会产生重复任务

## 哪些能力已达到商业运行标准？

- 企微客服接入、消息级去重、9/10槽位收集、报价/定制拦截、转人工触发 —— **达标**，有真实生产流量验证过
- 线索列表/漏斗/Top5/风险预警/日报/KPI结算/提成/成交后自动开租户（核心事务部分）—— **达标**，有前端、有基本测试
- SQL注入防护 —— **达标**

## 哪些能力仍只能算技术功能（未达商业标准）？

- Demo预约（纯话术，无闭环）
- 续费健康度/风险清单/转介绍候选/试跑进度/统一时间线/月度价值报告（**零前端，只有接口**）
- 诊断/案例推荐的效果归因（无事件记录，无法统计转化率）
- 客户成功任务自动生成（有竞态风险）
- 阶段状态机（6/8写入点绕过审计和校验）

## 是否具备开始真实销售试运行的条件？

**客户AI对话侧（企微接待→诊断→转人工）可以试运行**，这条链路有真实流量验证、有前端、有基本测试。

**销售AI的P1客户成功侧（续费/转介绍/试跑/上线）暂不具备条件**——没有前端，销售和客户成功人员实际上看不到这些数据，等于只是"代码存在"而非"可用功能"；且权限模型目前是四种角色不分彼此，任何登录账号能看到所有客户的手机号等敏感信息，商业化前必须先补齐第八节列出的权限缺口，否则存在真实的数据泄露风险。

**建议**：不要现在开始大规模销售试运行，先按下面的修改计划补齐前端入口+权限控制+关键事件埋点这三块最短板，再试运行。
