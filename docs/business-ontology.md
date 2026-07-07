# 经营语义层

本项目已有的 `server/ontology/` 不是一个独立产品模块，而是一层轻量经营语义基础设施。本次升级继续复用这套目录和调用方式，没有新建第二套 ontology，也没有引入图数据库或改数据库 schema。

## 已有能力

1. 对象关系注册

   `server/ontology/objects.js` 登记了 `store`、`employee`、`metric`、`task`、`dish` 等系统正在使用的业务对象，以及它们在当前代码中的真实关联字段。

2. 查询 API

   `server/ontology/query.js` 和 `server/ontology/routes.js` 提供只读查询：

   - `GET /api/ontology/types`
   - `GET /api/ontology/:type`

   查询字段来自白名单注册表，避免把用户输入拼进 SQL 字段名。

3. 数据新鲜度监控

   `server/ontology/freshness.js` 和 `server/ontology/freshness-config.js` 监控 `pos_sales_detail`、`daily_reports`、`feishu_generic_records` 等关键数据源。

4. metric lint

   `server/ontology/metric-lint.js` 检测 `metric_dictionary` 中的口径冲突和冗余注册，只返回结果，不自动修复。

5. plan grounding check

   `server/ontology/plan-grounding-check.js` 已接入 `hq-planner-agent.js` 和 `growth-phases.js`，用于防止行动计划或总结里出现没有真实依据的数字。

## 本次新增能力

本次新增的经营语义层把系统从“对象注册 / 查询 / 数据治理层”推进到第一版经营判断链路：

`指标异常 -> 经营问题 -> 责任对象 -> 执行动作 -> 任务草稿 -> 结果追踪`

新增文件：

- `server/ontology/business-domains.js`
- `server/ontology/metric-issue-mapping.js`
- `server/ontology/issue-action-mapping.js`
- `server/ontology/action-result-mapping.js`
- `server/ontology/business-ontology-engine.js`
- `server/ontology/task-draft-adapter.js`

### 指标 -> 问题

`metric-issue-mapping.js` 定义了指标异常如何映射到经营问题。例如：

- `repeat_purchase_rate` 下降 -> `customer_retention_weak`，老板语言为“进得来，留不住”
- `vip_inactive_count` 上升 -> `vip_churn_risk`，老板语言为“高价值客户正在悄悄流失”
- `lunch_revenue` 下降 -> `lunch_business_weak`
- `service_complaint_rate` 上升 -> `service_quality_issue`
- `training_completion_rate` 下降 -> `training_execution_weak`
- `task_overdue_rate` 上升 -> `task_closure_weak`

同一个经营问题被多个指标命中时，系统合并 evidence，不重复输出多个相同 issue。

### 问题 -> 动作

`issue-action-mapping.js` 定义每个经营问题的建议动作，包括：

- 动作名称
- 动作类型
- 责任角色
- 优先级
- 默认截止天数
- 执行步骤
- 预期结果
- 追踪指标

### 动作 -> 结果

`action-result-mapping.js` 定义动作类型对应的结果指标。例如：

- `customer_reactivation` 追踪回店人数、回店率、贡献营业额、客单价、触达转化率
- `operation_diagnosis` 追踪营业额变化、客流变化、客单价变化、投诉率变化、差评率变化
- `task_closure` 追踪任务完成率、任务逾期率、按时完成率、问题复发率

### 任务草稿

`task-draft-adapter.js` 只生成 `status: draft` 的任务草稿，不直接写入数据库，不破坏现有任务创建逻辑。后续可以在确认权限、责任人解析、门店范围和通知策略后，再接入真实 task API。

### 老板语言总结

`business-ontology-engine.js` 的 `generateBossSummary()` 输出老板能看懂的经营结论，不展示 ontology、metric id 等技术词。

## 为什么不是重型知识图谱

这套实现只做轻量规则推理和经营语义映射：

- 不引入图数据库
- 不新增大规模 schema
- 不替代现有 `knowledge-graph.js`
- 不把 LLM 当作数字来源
- 不绕过 `metric_dictionary` 和已有报告逻辑

它更像一层“经营判断字典 + 推理服务”，把已有指标和任务体系翻译成能执行的经营语言。

## API

### 查看业务领域

```bash
curl -s -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/ontology/business/domains
```

### 查看映射配置

```bash
curl -s -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/ontology/business/mappings
```

### 推理经营问题

```bash
curl -s -X POST http://localhost:3000/api/ontology/business/infer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "metricsInput": {
      "repeat_purchase_rate": { "current": 18, "previous": 25, "changeRate": -28 },
      "vip_inactive_count": { "current": 38, "previous": 21, "changeRate": 80 }
    }
  }'
```

返回：

- `insights`
- `bossSummary`
- `actionPlan`

### 生成任务草稿

```bash
curl -s -X POST http://localhost:3000/api/ontology/business/task-drafts \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "metricsInput": {
      "task_overdue_rate": { "current": 22, "previous": 11 }
    }
  }'
```

### metric lint

```bash
curl -s -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/ontology/metric-lint
```

该接口只返回冲突检测结果，不自动修改 `metric_dictionary`。

## 如何新增映射

### 新增一个指标映射

在 `metric-issue-mapping.js` 中新增一条规则：

- `metricId`
- `metricName`
- `domain`
- `triggerDirection`
- `issueId`
- `issueName`
- `bossLanguageTitle`
- `severity`
- `evidenceTemplate`
- `possibleCauses`
- `responsibleRoles`
- `affectedResults`
- `resultMetrics`

如果 `metricId` 来自生产指标，优先确认 `metric_dictionary` 已经存在对应口径。

### 新增一个经营问题

先在 `metric-issue-mapping.js` 中定义 `issueId`，再在 `issue-action-mapping.js` 中补动作模板。不要只新增问题，不给动作，否则老板总结和任务草稿会缺少下一步动作。

### 新增一个动作模板

在 `issue-action-mapping.js` 中为对应 `issueId` 增加 action，并确认 `actionType` 已经在 `action-result-mapping.js` 中有追踪指标。没有就同步新增。

## 如何接入报告

报告或 agent 已经有真实指标时，可以调用：

```js
import { enrichReportWithOntology } from './ontology/business-ontology-engine.js';

const enhancedReport = enrichReportWithOntology(reportData, metricsInput);
```

报告结构会增加：

- `ontologyInsights`
- `bossSummary`
- `actionPlan`
- `trackingMetrics`
- `priorityIssues`

重要限制：如果报告暂时没有真实指标字段，不要硬编码假数据。先保留 adapter 调用点，等真实指标接入后再传入 `metricsInput`。

## 第二阶段报告接入

当前已接入三个真实报告 API：

- `GET /api/customer-ops/reports/customer-assets`
- `GET /api/customer-ops/reports/ops-rectification`
- `GET /api/customer-ops/reports/talent-growth`

三个接口保留原有报告字段，并在 `report` 上新增：

- `ontologyStatus`
- `metricsInput`
- `ontologyInsights`
- `bossSummary`
- `actionPlan`
- `trackingMetrics`
- `priorityIssues`
- `taskDrafts`

### 客户资产报告

adapter：`buildCustomerAssetMetricsInput(reportData)`

优先读取真实字段并转换：

- `repeat_purchase_rate`
- `new_customer_second_visit_rate`
- `vip_inactive_count`
- `stored_value_inactive_count`

如果只有客户数、复购客户数、上期客户数，会计算真实比例和变化率；如果缺上期数据，不生成伪变化率。

### 经营整改追踪

adapter：`buildOperationImprovementMetricsInput(reportData)`

优先读取：

- `revenue`
- `lunch_revenue`
- `complaint_rate`
- `dish_complaint_rate`
- `service_complaint_rate`
- `task_completion_rate`
- `task_overdue_rate`

当前真实接入最稳定的是任务完成率和任务逾期率；营业额、午市、投诉类字段只有报告提供 current + previous 时才会进入推理。

### 人才盘点

adapter：`buildTalentDevelopmentMetricsInput(reportData)`

优先读取：

- `training_completion_rate`
- `certification_pass_rate`
- `promotion_candidate_count`

当前来自培训任务、考试 session、认证记录和晋升候选规则。缺上期字段时不会强行推断。

### 数据不足处理

当 adapter 无法构造任何有效 `metricsInput` 时，报告返回：

```json
{
  "ontologyStatus": "insufficient_data",
  "bossSummary": "当前数据不足，暂无法生成经营判断。",
  "ontologyInsights": [],
  "actionPlan": [],
  "taskDrafts": []
}
```

前端统一显示“当前数据不足，暂无法生成经营判断”，不会报错。

### 老板端展示字段

前端统一展示：

- AI经营结论：`bossSummary`
- AI识别的问题：`bossLanguageTitle`、`issueName`、`severity`、`evidence`、`responsibleRoles`
- 下一步动作：`actionName`、`ownerRole`、`priority`、`deadlineDays`、`expectedResult`
- 结果追踪指标：`trackingMetrics`
- 任务草稿：`title`、`ownerRole`、`dueDate`、`expectedResult`、`status`

任务草稿仍是 `draft`，不会自动写入正式任务。后续转正式任务时，应调用现有任务创建 API，并在用户确认后写库。

## 第三阶段可执行闭环

### taskDraft 转正式任务

任务草稿通过以下 API 转为正式 `master_tasks` 任务：

```bash
curl -s -X POST http://localhost:3000/api/ontology/business/create-task-from-draft \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "reportType": "customer_assets",
    "storeId": "test_store_ontology_001",
    "taskDraft": {
      "title": "生成高价值客户维护名单",
      "ownerRole": "店长",
      "priority": "P1",
      "expectedResult": "7天内带回高价值客户，并追踪贡献营业额",
      "trackingMetrics": ["回店人数", "贡献营业额"],
      "sourceIssueId": "customer_retention_weak",
      "sourceDomain": "customer_growth"
    }
  }'
```

底层复用现有 `master_tasks`，不新增正式任务表。来源字段写入 `source_data`：

- `ontology: true`
- `sourceIssueId`
- `sourceDomain`
- `sourceReportType`
- `ontologyInsightId`
- `expectedResult`
- `trackingMetrics`
- `ownerRole`
- `ownerUserId`
- `resultReview`

任务状态初始为 `pending_dispatch`，继续走现有 master task 流转。

### 上期动作复盘

三个报告会查询过去 30 天内由经营语义层创建的同门店、同报告类型任务，并返回：

- `previousActionReview.resultReviewStatus`
- `previousActionReview.tasksCreated`
- `previousActionReview.tasksCompleted`
- `previousActionReview.tasks`
- `previousActionReview.summary`

当前如果没有 actual metrics 或 completion note，显示：

“上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。”

### 数据不足展示

任务复盘和报告推理都遵守同一边界：没有真实追踪数据就返回 `insufficient_data`，不编造“已改善”。

## 自动营销归因

自动营销归因用于回答：系统触达客户后，是否带来了回店、消费、复购和可归因营业额。

### 第一版归因规则

- 同一 `customerId`
- 订单发生在 `touchTime` 之后
- 订单在 `attributionWindowDays` 内，默认 7 天
- `couponId` 命中优先归因
- 没有 `couponId` 但在窗口内回店，标记为 assisted attribution
- 没有 `customerId` 不强行归因
- 窗口外订单不计入归因

### API

单活动归因：

```bash
curl -s -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/marketing/attribution/<campaignId>
```

归因预览：

```bash
curl -s -X POST http://localhost:3000/api/marketing/attribution/preview \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"campaignId":"campaign-1","attributionWindowDays":7}'
```

营销语义推理：

```bash
curl -s -X POST http://localhost:3000/api/ontology/business/infer-marketing \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"attributionSummary":{"conversionRate":0.08,"previousConversionRate":0.16}}'
```

新增营销指标映射：

- `campaign_conversion_rate` 下降 -> `marketing_conversion_weak`
- `attributed_revenue` 下降 -> `marketing_revenue_weak`
- `coupon_used_count` 下降 -> `coupon_activation_weak`

### 真实数据和证据边界

当前优先复用已有 `growth_delivery_logs`、`marketing_campaigns`、`marketing_campaign_results`、`pos_orders` 等结构。`evidenceOrders` 中带有真实 `relatedOrderId` 的记录才属于订单支撑的归因；没有订单证据但在触达窗口内的回店只能作为 assisted，不作为严格新增营业额证明。没有真实数据时返回 `insufficient_data`，不虚构归因营业额。

### E2E 验收脚本

```bash
node scripts/e2e-ontology-business-flow-test.mjs
```

默认运行本地 service/API harness，不写生产库。若要打真实本地服务：

```bash
E2E_BASE_URL=http://localhost:3000 E2E_TOKEN=<token> \
  node scripts/e2e-ontology-business-flow-test.mjs
```

## 调试入口

当前已完成后端调试 API。前端“经营语义层”页面可以基于这些 API 展示：

- 当前支持的业务领域
- 指标-问题映射
- 问题-动作映射
- 动作-结果映射
- 模拟指标输入
- AI识别问题
- 老板语言结论
- 责任对象
- 下一步动作
- 预期结果
- 追踪指标
- 任务草稿

建议模拟场景：

- 复购率下降
- VIP沉睡人数上升
- 午市营业额下降
- 服务差评上升
- 培训完成率下降
- 任务逾期率上升

## 数字可信边界

`generateActionPlanFromInsights()` 生成的行动计划会携带：

- `sourceMetrics`
- `estimated`
- `groundingStatus`

当前规则生成的行动计划只描述动作和追踪指标，不生成“带回12桌”“贡献12000元”这类具体数字目标。后续如果 LLM 或报告生成了带数字的行动计划，仍需要继续走 `plan-grounding-check.js`，没有真实依据的数字必须标记为估算或要求人工确认。

## 测试

```bash
node --test hr-management-system/server/ontology/*.test.mjs
```

覆盖：

- 复购率下降 -> 老客维护不足
- VIP未到店人数上升 -> 高价值客户流失风险
- 午市营业额下降 -> 午市经营疲软
- 服务差评上升 -> 服务问题上升
- 培训完成率下降 -> 培训执行不足
- 任务逾期率上升 -> 任务闭环不足
- 多指标命中同 issue 时 evidence 合并
- action plan 字段完整
- 老板语言总结
- metric-lint API
- task draft 不写库

## 后续升级方向

- 接入真实客户分层
- 接入真实任务闭环
- 接入真实营销转化
- 接入门店、员工、菜品多对象归因
- 增加内部“经营语义层”调试页面
- 从规则推理逐步升级为 AI 经营决策引擎
