# GAAS / agent-service-v2 代码清单（2026-07 重构后）

维护参考：两服务共享同一 Postgres，代码不互相 import。改共享表 schema 以 GAAS `server/migrations/` 为权威；密钥/门店别名/指标口径变更需双边通知。详见各自 `CLAUDE.md`。

---

# GAAS（/Users/xieding/GAAS）

## 根目录核心文件

| 文件 | 作用 |
|---|---|
| `server/index.js` (~2256行) | 主入口/HTTP 服务器骨架，历史巨石文件，各 domain 路由通过 `register*Routes` 挂载 |
| `server/agents.js` (~2613行) | Multi-Agent 系统主文件（Data Auditor/Operational Supervisor/HR Agent/SOP Advisor），历史巨石文件，大部分已拆到 `server/domains/agent-*` |
| `server/growth-api.js` (~519行) | 增长相关工具函数，历史巨石文件，已被拆到 `server/domains/growth-*` |
| `server/migrate.js` | DB schema 迁移 CLI（生产需 `ALLOW_PRODUCTION_MIGRATE=true`） |
| `working-fixed.html` | 前端主 HTML，由 `frontend/src/pages/*.js` 拼接生成，是实际部署产物 |
| `platform-admin.html` / `agents-admin.html` | 平台/Agent 管理后台页面 |
| `database.sql` | 建表参考脚本 |
| `dev.sh` / `prod.sh` / `staging.sh` | 各环境启动脚本 |
| `restaurant-ai-growth-video/` | 视频项目源码/文案（与主业务无直接关联） |

## server/domains 分类清单（~90 个目录）

### 增长 / Growth
| 目录 | 作用 |
|---|---|
| growth-ab | A/B 测试模板与实验管理 |
| growth-actions | 增长动作执行/多渠道触达 |
| growth-bitable | 增长数据与飞书多维表桥接 |
| growth-campaigns | 营销活动管理 |
| growth-churn | 客户流失分析 |
| growth-content / -content-calendar / -content-library | 增长内容/内容日历/内容库 |
| growth-coupons | 优惠券管理 |
| growth-customers | 客户档案批处理 |
| growth-menu-health | 菜单健康度分析 |
| growth-metrics | 增长核心指标计算 |
| growth-ops | 增长运营后台任务（日报/定时提醒） |
| growth-payment-rules | 支付规则配置 |
| growth-phase-auth | 增长阶段权限校验（service.js + routes 目录结构） |
| growth-phases | 增长阶段定时任务/POS 同步 cron |
| growth-pos | POS 收银系统对接（客如云等） |
| growth-profiles | 客户增长画像 |
| growth-queries | 增长数据查询接口 |
| growth-sms | 短信发送健康监控/对账 |
| growth-solutions | 增长问题诊断方案 |
| growth-stored-value | 储值卡业务 |
| growth-sync-failures | 增长数据同步失败记录 |
| growth-touch-rules | 客户触达规则引擎 |
| growth-wechat-work / growth-wecom | 企业微信对接 |
| growth-wecom-feishu | 企微-飞书联动 |
| growth-winback | 客户召回营销 |
| inventory-forecast | 库存预测（AI 预测/PDF 解析） |
| sales-ai | 销售 AI 助手（线索/财务/客服/运营），体量最大之一 |

### Agent 相关
| 目录 | 作用 |
|---|---|
| agent-auditor | 数据审计员 Agent |
| agent-bi | Agent BI 问答工具 |
| agent-brand | Agent 品牌运行时上下文 |
| agent-config | Agent 配置管理（加载器/规则/模板/管理路由） |
| agent-data / agent-data-center | Agent 数据访问/数据中心路由 |
| agent-evaluator | 首席评估官 Agent |
| agent-feishu-bot | 飞书机器人事件订阅与消息路由 |
| agent-message | Agent 消息处理核心（路由/质量/话术/培训），最大目录之一 |
| agent-ops | Agent 运维监控（巡检、定时任务） |
| agent-records | Agent 记录查询路由 |
| agent-runtime | Agent 运行时配置状态 |
| agent-store | Agent 门店身份识别辅助 |
| agent-triggers | Agent 手动触发/诊断测试路由 |
| master-agent | 主控 Agent（生命周期/任务分发/审核/飞书同步/调度），全仓最核心 |
| ai | 底层 LLM 调用封装 |
| rag | RAG 检索增强问答 |
| knowledge | 知识库管理 |

### 考勤 / 薪资 HR
| 目录 | 作用 |
|---|---|
| checkin | 打卡/考勤概览 |
| daily-reports | 员工日报 |
| employees | 员工档案管理 |
| hrms-payroll / hrms-state | HRMS 薪资规则/状态查询 |
| leave-attendance | 请假/考勤 |
| payroll | 薪资计算与同步 |
| points | 积分体系 |
| reports | HR/薪资/离职综合报表 |
| training | 培训体系（任务/认证/评分） |
| exam-results | 考试结果记录 |

### 审批 / 门店 / 认证
| 目录 | 作用 |
|---|---|
| approvals | 审批流核心（创建/决策/离职晋升/奖励调度） |
| store-duty-bindings | 店铺值班绑定与审批人解析 |
| stores | 门店 CRUD |
| store-diagnosis | 门店经营诊断 |
| tenant-platform | 租户平台管理（Agent中心/账单/品牌/集成），体量大 |
| tenant-settings | 租户设置 |
| auth | 登录/会话核心 |
| permission-groups | 权限组管理 |

### 报表 / 通知
| 目录 | 作用 |
|---|---|
| bi-weekly-report | BI 周报生成 |
| notifications | 站内通知 |
| reads | 已读/未读状态 |
| usage-weekly | 使用情况周报 |
| metrics-admin | 指标管理后台 |
| attention-scores | 关注度评分 |
| performance-invalidation | 绩效失效/重算通知 |

### 飞书 / 企微集成
| 目录 | 作用 |
|---|---|
| feishu-bitable | 飞书多维表核心桥接，最大飞书相关目录 |
| feishu-sync | 手动触发飞书同步 |
| feishu-webhook | 飞书 webhook 端点 |
| bitable-admin / bitable-sync | Bitable 管理/同步状态 |
| wecom | 企业微信回调路由 |
| gm-mailbox | 总经理信箱 |

### 其它基础设施
| 目录 | 作用 |
|---|---|
| admin-ops | 管理端运维路由 |
| health | 健康检查/进程监控 |
| shared | 跨 domain 公共工具库（角色权限/状态快照/租户 schema 对账） |
| flow-config | 流程配置管理 |
| dedup | 去重统计与清理 |
| diagnosis | AI 反馈诊断统计 |
| birthday | 生日提醒 |
| customer-ops | 客户归因报表/分群外呼 |
| ops-tasks | 运营任务创建/反馈/调度 |
| payment-config / payments | 支付配置/路由 |
| perf-admin | 绩效管理后台 |
| promotion | 晋升轨迹 |
| remaining-state | 拆分过程临时归集处（公告/考试培训/HRMS用户等未归类路由） |
| uploads | 文件上传（对象存储） |

## 前端

- `frontend/src/pages/*.js`：14 个页面模块（01-boot ~ 14-subscription-and-tail），按 `pages.manifest.json` 顺序拼接进 `working-fixed.html` 主 `<script>`
- `scripts/bundle-frontend.mjs`：拼接回写 working-fixed.html
- `scripts/build-shell.mjs`：bundle + 抽取内容哈希外链 JS/CSS（配合 nginx immutable 缓存）

## 共享包

- `packages/gaas-shared`（`@gaas/shared`）：GAAS 与 agent-service-v2 共享库权威副本 — 飞书 webhook 验签、飞书 token 管理、共享表名常量

---

# agent-service-v2（/Users/xieding/agents-service-v2）

| 目录/文件 | 作用 |
|---|---|
| `src/index.js` | 服务主入口 |
| `src/routes/` | HTTP 路由层：admin-api*（功能开关/dish-triggers/月度助手/活动指标/知识源等）、auth-api、config-api、feishu-webhook-api、health-api（供 GAAS 探活）、kpi-api、agent-task-board-api、agent-dispatch-api、strategy-experiment-api、telemetry-api、knowledge-scoring-api、rhythm-api、anomaly-ops-api |
| `src/services/` | 业务逻辑核心（200+ 文件）：异常检测（anomaly-engine*）、飞书集成（feishu-client*/feishu-cards*）、主控编排（master-agent-dispatcher/master-planner/task-orchestrator）、节奏引擎（rhythm-engine*）、绩效评分（monthly-comprehensive-rating/periodic-scoring）、诊断报告（dissatisfied-product-report等）、增长诊断（growth-monitor/campaign-autopilot）、LLM 提供层（llm-provider*/model-router）、知识检索（knowledge-base/unified-retriever）、proactive-v2/（主动异常检测触发子系统）、agent-session/（会话管理） |
| `src/schedulers/` | 定时任务注册（register-crons*） |
| `src/middleware/` | auth/internal-auth/idempotency/rate-limit/license |
| `src/config/` | 门店映射与别名缓存、异常规则配置 |
| `src/utils/` | db/logger/queue/飞书辅助/safety/租户解析 |
| `src/migrations/` | SQL 迁移（001~030+），run.js 为执行器 |
| `src/workers/escalation-worker.js` | 升级/告警处理 worker |
| `packages/gaas-shared` | 共享库副本（file 依赖） |
| `scripts/` | 一次性运维脚本（数据补丁/核对/回填/部署/清理） |
| `docs/` | Agent 协作原则、飞书 webhook 排查、任务催办说明等 |
| `CLAUDE.md` | 与 GAAS 的耦合说明、部署流程、"覆盖生产前必须核对同源"教训 |
| `README-proactive.md` | Proactive 主动异常检测模块说明 |
| 部署配置 | Dockerfile、ecosystem.config.cjs（PM2）、dev.sh/prod.sh/staging.sh |

**部署要点**：`root@47.100.96.30:/opt/agents-service-v2/`，PM2 进程名 `agents-service-v2`，端口 3101，与 GAAS 共用 `hrms` 库。
