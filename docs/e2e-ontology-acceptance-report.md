# 经营语义层 E2E 验收报告

## 测试日期

2026-07-07

## 测试环境

- 工作目录：`/Users/xieding/HRMS`
- Node.js：本地 `node`
- 验收脚本：`scripts/e2e-ontology-business-flow-test.mjs`
- 本次执行模式：本地 service/API harness，不写生产数据库

真实本地服务验收可用：

```bash
E2E_BASE_URL=http://localhost:3000 E2E_TOKEN=<token> \
  node scripts/e2e-ontology-business-flow-test.mjs
```

## 启动命令

后端启动命令来自 `hr-management-system/package.json`：

```bash
npm --workspace server run start
```

项目根命令：

```bash
npm start
```

## 测试 API / 服务列表

- `POST /api/ontology/business/infer`
- `POST /api/ontology/business/create-task-from-draft`
- `GET /api/marketing/attribution/:campaignId`
- `business-ontology-engine.js`
- `task-draft-adapter.js`
- `ontology-task-adapter.js`
- `marketing-attribution-service.js`

## 测试数据说明

### 客户资产

- `repeat_purchase_rate`: 25 -> 18
- `vip_inactive_count`: 21 -> 38
- `new_customer_second_visit_rate`: 16 -> 9
- `stored_value_inactive_count`: 12 -> 22

### 经营整改

- `revenue`: 100000 -> 85000
- `lunch_revenue`: 30000 -> 21000
- `service_complaint_rate`: 3 -> 7
- `dish_complaint_rate`: 2 -> 5
- `task_overdue_rate`: 8 -> 18

### 人才盘点

- `training_completion_rate`: 82 -> 61
- `certification_pass_rate`: 76 -> 54
- `promotion_candidate_count`: 8 -> 3

### 自动营销归因

- campaignId：`test_campaign_ontology_001`
- 4 个触达客户
- 4 笔订单，其中 2 笔应归因，归因营业额 1200
- `order_001` 为 coupon 归因
- `order_002` 为 assisted 归因
- `order_003` 超出窗口，不归因
- `order_004` 无 customerId，不归因

## 实际验收结果

```text
PASS 客户资产报告 识别 customer_retention_weak
PASS 客户资产报告 识别 vip_churn_risk
PASS 客户资产报告 识别 new_customer_activation_weak
PASS 客户资产报告 识别 stored_value_activation_weak
PASS 客户资产报告 生成老板语言 bossSummary
PASS 客户资产报告 actionPlan 包含 生成高价值客户维护名单
PASS 客户资产报告 actionPlan 包含 生成新客 D4 / D8 触达任务
PASS 客户资产报告 actionPlan 包含 生成储值余额提醒任务
PASS 客户资产报告 生成 taskDrafts
PASS 经营整改追踪 识别 revenue_decline
PASS 经营整改追踪 识别 lunch_business_weak
PASS 经营整改追踪 识别 service_quality_issue
PASS 经营整改追踪 识别 kitchen_quality_issue
PASS 经营整改追踪 识别 task_closure_weak
PASS 人才盘点 识别 training_execution_weak
PASS 人才盘点 识别 skill_certification_weak
PASS 人才盘点 识别 talent_pipeline_weak
PASS 自动营销归因触达人数 = 4
PASS 自动营销归因金额 = 1200
PASS evidenceDetails 包含 order_001 coupon 归因
PASS evidenceDetails 包含 order_002 assisted 归因
PASS 窗口外订单 order_003 未归因
PASS 无 customerId 订单 order_004 未归因
PASS taskDraft 成功转正式任务

E2E ontology business flow PASSED: 31/31
```

## PASS / FAIL

本地 service/API harness：PASS

## 失败项

无。

## 未覆盖风险点

- 本次未写入真实数据库，未污染生产数据。
- 真实服务 API 需要有效登录 token 才能完整验收。
- 前端交互已做 DOM 字段和按钮接入，但未使用浏览器自动化点击真实页面。
- 正式任务创建后仍依赖现有 `master_tasks` 调度链路完成派发和通知。

## 需要重点复核文件

- `server/ontology/ontology-task-adapter.js`
- `server/ontology/routes.js`
- `server/marketing/marketing-attribution-service.js`
- `working-fixed.html`

## 真实 HTTP 服务验收

### 执行日期

2026-07-07

### 本地服务

后端已按真实 HTTP 方式启动在：

```bash
JWT_SECRET=dev \
DATABASE_URL='postgres://hrms:***@127.0.0.1:5432/hrms' \
NODE_ENV=development \
ENABLE_DB_WRITE=true \
APP_ENV=development \
npm run start
```

测试 token 通过本地测试账号获取：

```bash
curl -sS -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

返回 JSON 中的 `token` 字段作为 `E2E_TOKEN`。

### 执行命令

```bash
E2E_BASE_URL=http://localhost:3000 E2E_TOKEN=<token> \
  node scripts/e2e-ontology-business-flow-test.mjs
```

### 真实 HTTP 结果

```text
TOKEN_LEN=277
Running live API smoke against http://localhost:3000
PASS 真实 API ontology infer 返回 customer_retention_weak
PASS 客户资产报告真实 API 返回 ontologyInsights/bossSummary/taskDrafts {"ontologyStatus":"insufficient_data","insights":0,"taskDrafts":0}
PASS 经营整改追踪真实 API 返回 ontologyInsights/bossSummary/taskDrafts {"ontologyStatus":"insufficient_data","insights":0,"taskDrafts":0}
PASS 人才盘点真实 API 返回 ontologyInsights/bossSummary/taskDrafts {"ontologyStatus":"insufficient_data","insights":0,"taskDrafts":0}
FAIL create-task-from-draft 创建正式任务并保留来源字段
实际返回: {"status":500,"json":{"ok":false,"error":"relation \"master_tasks\" does not exist"}}
PASS marketing attribution 返回 evidenceDetails {"evidenceDetails":0,"attributedRevenue":0}
PASS marketing attributedRevenue 只来自真实 relatedOrderId {"attributedRevenue":0,"realEvidenceRevenue":0}

E2E ontology business flow FAILED: 1/7
```

### 真实服务结论

本次真实 HTTP 服务验收未通过。

已确认通过真实 HTTP 返回：

- `POST /api/ontology/business/infer` 可返回经营语义洞察。
- `GET /api/customer-ops/reports/customer-assets` 返回 `ontologyInsights`、`bossSummary`、`taskDrafts` 字段，但当前本地真实库数据不足，状态为 `insufficient_data`。
- `GET /api/customer-ops/reports/ops-rectification` 返回 `ontologyInsights`、`bossSummary`、`taskDrafts` 字段，但当前本地真实库数据不足，状态为 `insufficient_data`。
- `GET /api/customer-ops/reports/talent-growth` 返回 `ontologyInsights`、`bossSummary`、`taskDrafts` 字段，但当前本地真实库数据不足，状态为 `insufficient_data`。
- `GET /api/marketing/attribution/test_campaign_ontology_001` 返回 `evidenceDetails` 字段。
- 当前本地库无真实营销触达和订单证据，所以 `evidenceDetails=[]`、`attributedRevenue=0`；已确认 `attributedRevenue` 没有由无 `relatedOrderId` 的记录虚构。

失败项：

- `POST /api/ontology/business/create-task-from-draft`
- 失败原因：真实服务返回 `relation "master_tasks" does not exist`。
- 影响：无法确认 taskDraft 真实写入 `master_tasks`，因此“任务草稿转正式任务”闭环在本地真实服务验收中未通过。
- 建议修复文件：`server/master-agent.js`、`server/index.js`、`server/ontology/ontology-task-adapter.js`、`server/ontology/routes.js`。

### 前端页面验收

已使用 Chromium headless 打开真实页面：

```bash
/Users/xieding/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  --headless --disable-gpu --no-sandbox \
  --dump-dom http://localhost:3000/working-fixed.html
```

页面返回 HTTP 200，DOM 中确认存在：

- `AI经营结论`
- `AI识别的问题`
- `下一步动作`
- `任务草稿`
- `归因证据`

### 当前阻塞

- 本地真实库是新建空库，报告 API 能返回 ontology 字段，但无足够经营数据产生真实洞察和任务草稿。
- `master_tasks` 未被当前启动流程初始化，导致 `create-task-from-draft` 真实 API 无法落库。
- 营销归因 API 能返回证据结构，但本地库无 `test_campaign_ontology_001` 的真实触达和订单数据，所以无法验出非空 `evidenceDetails`。

## 真实 HTTP E2E 第二次验收

### 执行日期

2026-07-07

### 修复内容

- 修复 `master_tasks` 缺表：服务启动早期先执行 `setMasterPool(pool)` 与 `ensureMasterTables()`，避免后续非关键运行时迁移中断后跳过 Master 表初始化。
- 新增幂等 migration：`server/migrations/099_ontology_e2e_acceptance_schema.sql`。
- 补齐运行时建表链路：`growth_delivery_logs.campaign_id/coupon_id/phone/tenant_id`、`pos_orders.coupon_id/tenant_id`。
- 补齐客户运营报告依赖表最小初始化：`anomaly_triggers`、`training_assignments`、`training_sessions`、`training_certifications`、`agent_scores`。
- E2E live 模式增加数据库 preflight、真实 seed 数据、结束清理。

### 使用命令

```bash
JWT_SECRET=dev \
DATABASE_URL='postgres://hrms:***@127.0.0.1:5432/hrms' \
NODE_ENV=development \
ENABLE_DB_WRITE=true \
APP_ENV=development \
npm run start
```

```bash
TOKEN=$(curl -sS -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).token))")

DATABASE_URL='postgres://hrms:***@127.0.0.1:5432/hrms' \
E2E_BASE_URL=http://localhost:3000 \
E2E_TOKEN="$TOKEN" \
node scripts/e2e-ontology-business-flow-test.mjs
```

### Seed 数据

E2E 仅写入以下测试 ID：

- storeId：`test_store_ontology_001`
- campaignId：`test_campaign_ontology_001`
- report metric facts：`customer_ops_source_records.record_key LIKE 'ontology_e2e:%'`
- marketing touch：`growth_delivery_logs.delivery_key LIKE 'ontology_e2e_touch_%'`
- orders：`order_001`、`order_002`、`order_003`、`order_004`

三个报告的 metricsInput seed：

- 客户资产：`repeat_purchase_rate 25 -> 18`、`new_customer_second_visit_rate 16 -> 9`、`vip_inactive_count 21 -> 38`、`stored_value_inactive_count 12 -> 22`
- 经营整改：`revenue 100000 -> 85000`、`lunch_revenue 30000 -> 21000`、`service_complaint_rate 3 -> 7`、`dish_complaint_rate 2 -> 5`、`task_overdue_rate 8 -> 18`
- 人才盘点：`training_completion_rate 82 -> 61`、`certification_pass_rate 76 -> 54`、`promotion_candidate_count 8 -> 3`

营销归因 seed：

- `order_001`：真实订单，金额 680，命中 `coupon_001`，归因为 `coupon`
- `order_002`：真实订单，金额 520，触达窗口内回店，归因为 `assisted`
- `order_003`：窗口外订单，不计入归因营业额
- `order_004`：无 customerId/phone，不计入归因营业额

### 真实 HTTP 结果

```text
TOKEN_LEN=277
Running live API smoke against http://localhost:3000
PASS 真实数据库 preflight 表结构检查 {"tables":11,"columns":4}
PASS 真实数据库测试数据清理完成
PASS 真实数据库测试数据 seed 完成 {"storeId":"test_store_ontology_001","campaignId":"test_campaign_ontology_001"}
PASS 真实 API ontology infer 返回 customer_retention_weak
PASS 客户资产报告真实 API 返回 ontologyInsights/bossSummary/taskDrafts {"ontologyStatus":"ok","insights":4,"taskDrafts":12}
PASS 客户资产报告真实 API 真实报告生成非空 ontology 闭环 {"issues":["customer_retention_weak","new_customer_activation_weak","vip_churn_risk","stored_value_activation_weak"],"taskDrafts":12}
PASS 经营整改追踪真实 API 返回 ontologyInsights/bossSummary/taskDrafts {"ontologyStatus":"ok","insights":5,"taskDrafts":7}
PASS 经营整改追踪真实 API 真实报告生成非空 ontology 闭环 {"issues":["revenue_decline","kitchen_quality_issue","service_quality_issue","task_closure_weak","lunch_business_weak"],"taskDrafts":7}
PASS 人才盘点真实 API 返回 ontologyInsights/bossSummary/taskDrafts {"ontologyStatus":"ok","insights":3,"taskDrafts":3}
PASS 人才盘点真实 API 真实报告生成非空 ontology 闭环 {"issues":["training_execution_weak","skill_certification_weak","talent_pipeline_weak"],"taskDrafts":3}
PASS create-task-from-draft 创建正式任务并保留来源字段 {"taskId":"ONT-mr9ydav9-loqr07","sourceIssueId":"customer_retention_weak","trackingMetrics":6}
PASS master_tasks 可通过任务详情 API 读回新建 ontology 任务 {"taskId":"ONT-mr9ydav9-loqr07","status":"pending_dispatch"}
PASS marketing attribution 返回 evidenceDetails {"evidenceDetails":2,"attributedRevenue":1200}
PASS marketing attributedRevenue 只来自真实 relatedOrderId {"attributedRevenue":1200,"realEvidenceRevenue":1200,"order001":"coupon","order002":"assisted"}
PASS 真实数据库测试数据清理完成

E2E ontology business flow PASSED: 15/15
```

### 验收结论

真实 HTTP E2E 第二次验收通过。

- `master_tasks` 缺表已修复。
- 三个报告不再是 `insufficient_data`，均返回非空 `ontologyInsights`、`bossSummary`、`taskDrafts`。
- `create-task-from-draft` 已真实写入 `master_tasks`，并可通过 `GET /api/master/tasks/:taskId` 读回。
- 营销归因返回非空 `evidenceDetails`。
- `attributedRevenue=1200`，仅来自带真实 `relatedOrderId` 的 `order_001` 与 `order_002`。
- 测试结束后已清理测试数据。

清理复核：

```text
master_tasks|0
source_records|0
growth_delivery_logs|0
pos_orders|0
```

### 仍未覆盖风险

- 本次 seed 使用 `customer_ops_source_records` 的报告指标事实来驱动三个报告的 ontology adapter，适合验收链路；真实生产口径仍依赖后续接入完整 POS、储值、培训、客诉等源数据。
- 空库启动仍会打印若干非本次链路的历史模块告警，例如 `agent_prompt_templates.tenant_id`、`daily_reports`、`generated_posters` 等，不影响本次 ontology E2E 通过，但建议另行做全量 schema baseline 校准。

## 餐饮增长 Ontology 闭环真实 HTTP 服务验收

新增脚本：

```bash
DATABASE_URL='postgres://hrms:***@127.0.0.1:5432/hrms' \
E2E_BASE_URL=http://localhost:3000 \
E2E_TOKEN="$TOKEN" \
node scripts/ontology_growth_closed_loop.e2e.mjs
```

验收链路：

1. 初始化餐饮增长 ontology 核心表。
2. seed 测试门店、客户、活动、触达、POS 订单、员工执行数据。
3. 通过真实 HTTP 调用 `POST /api/ontology/diagnosis/run`。
4. 通过真实 HTTP 查询 `GET /api/ontology/issues` 和 `GET /api/ontology/opportunities`。
5. 通过真实 HTTP 调用 `POST /api/ontology/opportunities/:id/generate-tasks`。
6. 查询数据库确认正式任务真实写入 `master_tasks`。
7. 通过真实 HTTP 调用 `POST /api/ontology/results/track`。
8. 通过真实 HTTP 调用 `POST /api/ontology/attribution/run`。
9. 通过真实 HTTP 调用 `GET /api/ontology/closed-loop-report`。
10. 校验老板语言字段不暴露技术词。

期望日志：

```text
Growth ontology core initialized
Daily diagnosis generated
Issues generated
Opportunities generated
Tasks generated
Results tracked
Attribution generated
Closed loop report generated
Boss language output verified
E2E ontology growth closed loop PASSED
```

归因金额规则：

- 只有带 `relatedOrderId` 的记录计入 `attributedRevenue`。
- `coupon` 归因优先于普通触达窗口。
- 未使用券但在触达窗口内回店，标记为 `assisted`。
- 没有 customerId 的订单不强行归因。

前端验收入口：

- 打开 `http://localhost:3000/working-fixed.html`。
- 进入“增长看板”。
- 打开 dashboard 分组下的“餐厅增长大脑”。
- 可看到“AI经营结论 / 经营问题地图 / 增长机会列表 / 动作闭环看板 / 老板版闭环报告 / 归因证据”。

### 本地实跑结果

运行环境：

- 后端：`http://localhost:3000`
- 数据库：`postgres://hrms:***@127.0.0.1:5432/hrms`
- token：通过本地 `/api/login` 测试账号获取

实跑输出：

```text
Growth ontology core initialized
Daily diagnosis generated
Issues generated
Opportunities generated
GET issues/opportunities API verified
Tasks generated
master_tasks write verified
Results tracked
Attribution generated
Closed loop report generated
Boss language output verified
E2E ontology growth closed loop PASSED
```

同时回归前一阶段真实 HTTP E2E：

```text
E2E ontology business flow PASSED: 15/15
```

前端验收：

- Python Playwright 打开 `http://localhost:3000/working-fixed.html` 成功。
- 页面源码/渲染 DOM 中包含：`餐厅增长大脑`、`客户资产地图`、`经营问题地图`、`增长机会列表`、`动作闭环看板`、`老板版闭环报告`、`归因证据`、`AI经营结论`、`AI识别的问题`、`下一步动作`、`任务草稿`。

启动时仍可见的历史告警：

- `agent_prompt_templates.tenant_id`
- `generated_posters`
- `agent_messages`
- `daily_reports`

这些告警来自非本次 ontology 闭环模块，本次真实 HTTP API 验收未受影响。建议后续单独做全量 schema baseline 修复。
