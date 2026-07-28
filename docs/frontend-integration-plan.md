# GAAS 前端整合方案 v3：角色工作台 + 一键执行闭环

> 状态：**待确认**，2026-07-28。本文取代 v2，回应用户四点新要求：
> ① mockup 只是示意稿，需完善到「好用有用」；② 新增总部HR独立视图（考勤/休假/欠假/薪资/入离职/人效，权限强管控）；
> ③ 部署环境确认为 GAAS-demo（8.153.95.62）；④ 明确五个角色的底部导航与「点击=立即执行」交互规范。
> **唯一验收标准：管理层和老板真觉得这东西好用、有用。** 不是"内容对不对"，是"用起来顺不顺手"。

---

## 0. 部署环境确认（已探测，非猜测）

SSH 到 `8.153.95.62` 实测结果：

```
hostname: iZuf66595v4lq01a8yi9ffZ
pm2: agents-service-v2 (online) + hrms-service (online)
/opt/ 下有: hrms, hrms-archive, agents-service-v2, deploy-backups ...
Postgres 14.23，本机独立库 "hrms"（不是 47.100.96.30 那个库，物理隔离，测试不会碰生产数据）
RLS 实测：daily_reports / hrms_user_notifications / master_tasks 的 relrowsecurity = t（开启）
```

这印证了 `CLAUDE.md` 里的记录：**本仓库在 47.100.96.30 上 RLS 关闭，GAAS-demo 上 RLS 开启**，且是两台完全独立的机器、独立的库。

**这对本次改造有一个必须写进测试清单的影响**：新的 workspace 聚合查询如果只在应用层做 `WHERE tenant_id = $1` 过滤（跟现有大部分代码一样），在 47.100.96.30 上没问题，但在 8.153.95.62 上会额外受 RLS policy 约束——如果我们的查询走的连接没有设置正确的 session（`app.tenant_id` 等，需要看现有代码怎么设置的），**可能在 demo 上返回空结果或报错，而不是"和生产行为一致"**。

**结论**：demo 测试通过 ≠ 生产一定没问题，反过来也一样——这两个环境行为可能不同，是环境本身的差异，不是 bug。测试清单里必须包含"RLS on 时聚合查询是否正常返回数据"这一项，且要在部署到生产前，额外确认关掉 RLS 后逻辑仍然正确（不能只依赖 demo 通过就直接上生产）。

**部署流程**：
```
GAAS main → 建分支 feature/workspace-shell-p1
  → build:shell → scp 到 8.153.95.62:/opt/hrms（先备份现有文件到 /opt/hrms-archive/deploy-bak/，不留 web root 内）
  → pm2 restart hrms-service --update-env
  → 四个测试账号验收（见 §5 验收清单）
  → 全部通过 → 同样流程部署到 47.100.96.30（部署前 diff 核对同源，见 CLAUDE.md 第 88 条纪律）
```

---

## 1. 核心交互原则（回应你的第 4 点，这是本次改造最重要的一条）

> **卡片上的按钮不是导航链接，是遥控器按钮。点一下，后台立刻执行，卡片原地变化告诉你结果——不许跳页，不许"点进去再点一次"。**

这是把"功能目录"变成"问题解决 OS"的**唯一决定性的交互规则**，比任何 IA 调整都重要。定义统一交互态机：

```
[待处理]  →(点击"批准/执行"按钮 + 二次确认弹窗)→  [执行中...]（按钮变灰，转圈）
                                                        ↓ 后端 API 返回
                                              ┌─────────┴─────────┐
                                         [已成功]              [失败]
                                    卡片原地展示结果内容      卡片显示错误原因 + [重试]
                                    （如："已发送给1247人，        （不吞错误、不静默失败）
                                      预计3天内看到回流数据"）
```

**技术实现**（新前端文件里统一封装，所有 5 个角色工作台复用同一套）：

```js
// frontend/src/pages/16-workspace-actions.js（新文件，唯一执行入口）
async function wsExecuteAction(cardEl, { confirmText, endpoint, method, body, onSuccess }) {
  const ok = await hrmsConfirm({ title: '确认执行', message: confirmText, okText: '确认' });
  if (!ok) return;
  const btn = cardEl.querySelector('.ws-action-btn');
  btn.disabled = true; btn.textContent = '执行中...';
  try {
    const tok = localStorage.getItem('hrms_token') || '';
    const r = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body || {}) });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error || ('HTTP ' + r.status));
    onSuccess(cardEl, d);   // 原地把卡片内容换成"结果态"，不刷新页面、不跳转
  } catch (e) {
    cardEl.querySelector('.ws-action-result').innerHTML =
      `<span class="ws-err">执行失败：${e.message}</span> <button class="ws-retry">重试</button>`;
    btn.disabled = false; btn.textContent = '重试';
  }
}
```

**每一个"批准/执行"按钮背后必须绑定一个真实存在、已验证的写入型 API**，不能是占位符。下面每个角色的每个按钮都标注了具体绑定的接口——这是这次确认的核心内容。

---

## 2. 五个角色工作台：底部导航 + 每格具体内容 + 按钮绑定的真实接口

### 2.1 老板驾驶舱（`admin`）—— 已确认老板=admin

**底部导航 4 格**：`驾驶舱` `问题` `问数据` `周报`

| 格 | 内容 | 数据源/接口 |
|---|---|---|
| **驾驶舱**（落地页） | 见 §3 完善版设计 | 见下 |
| **问题** | 全部「需拍板/增长机会/好结果」的完整列表，按门店/严重度筛选 | `GET /api/ontology/issues` + `GET /api/ontology/opportunities` |
| **问数据** | 自然语言问答（"洪潮中山店为什么营收降了"） | `POST /api/agent/message`（已有 BI Agent，直接复用，不新建） |
| **周报** | `closed-loop-report` 的完整版：本周下发了什么、完成了什么、结果如何 | `GET /api/ontology/closed-loop-report` |

**驾驶舱首页三类卡片，按钮全部一键执行**（对应你截图里的三张卡）：

1. **需拍板卡**（"洪潮·中山店 营收环比 −18%"）
   - `[查看进展并拍板]` → 不是导航，是**展开卡片内嵌的任务进展详情**（`GET /api/agent-task-board/tasks/:taskId`），内嵌显示当前 3 步整改任务各自的状态；老板在展开区里对每一步可以点 `[确认完成]`（绑定 `POST /api/agent-task-board/tasks/:taskId/review`，body `{decision:'approved'}`）或 `[改派]`（`POST /api/agent-task-board/tasks/:taskId/reassign`）
   - `[经营诊断→]` 才是唯一允许跳转的按钮（去 `diagnosis` 页看完整归因），且用抽屉打开不整页跳转

2. **增长机会卡**（"储值消耗率61%，1247人未到店，建议召回，预计回流¥8-12万"）
   - `[批准召回方案]` → **立即执行**，绑定 `POST /api/growth/campaign/launch`（已存在的接口，body 里带这条 `opportunity_id`/`alert_key`），后台立刻创建 `growth_campaigns` 记录并进入执行队列
   - 按钮点击后卡片**原地**变成：「✅ 已批准 · 系统正在向 1,247 人分批发送 · 预计 3 天内看到回流数据」，附一个 `[查看进度]`（3 天后这条卡片会被 §5 的 decision_receipt 机制自动更新为结果）
   - `[先看分析→]` 展开抽屉，不跳页，显示 `growth_ontology_opportunities.evidence_json` 的完整依据

3. **好结果卡**（"万象城酸汤鱼首周点单率23%，客单+¥9，建议推广"）
   - `[批准推广到8家店]` → 立即执行，绑定 `POST /api/growth/menu-health-reports/generate` 或专门的"推广"接口（**这个具体动作在现有代码里没有直接对应的"批量推广菜品到多店"API，需要在 Phase 1 新建一个薄接口** `server/domains/workspace/service.js` 里的 `promoteDishToStores()`，本质是给目标门店批量写一条 `master_tasks`，标题"上新XX，请X天内完成培训+上架"，指派给各店出品经理——这是**已有能力的组合**，不是新领域逻辑）

4. **门店红绿灯**：`GET /api/master/tasks` 按 store 聚合 open count + severity，红黄绿三色圆点，点击任一店直接展开该店的完整问题列表（抽屉，不跳页）

### 2.2 总部工作台（`hq_manager`）

**底部导航 4 格**：`工作台` `审批` `任务板` `对比`

| 格 | 内容 | 接口 |
|---|---|---|
| 工作台（落地页） | 异常清单（按严重度）+ 门店健康度排名 | `GET /api/ontology/issues` + 门店评分聚合 |
| 审批 | 待我审批的请假/请款/奖惩，**点击直接批准/驳回，不跳转到 approvals 页** | 现有 `/api/approvals/:id/decide`（已存在） |
| 任务板 | HQ 视角的全部 `master_tasks`，可下发/改派/催办 | `/api/agent-task-board/*`（已全套存在） |
| 对比 | 多店 KPI 对比表（营收/毛利/人效/健康度） | 复用现有 `reports` 页数据源，只读切片 |

异常清单每条卡片按钮同老板卡片模式（`[下发整改任务]` 绑定 `POST /api/agent-task-board/tasks`；`[发起召回]` 同老板的 campaign/launch）。

### 2.3 门店工作台（`store_manager` / `store_production_manager` / `front_manager` / `front_supervisor`）

**底部导航 4 格**：`今日` `任务` `日报` `我的`

| 格 | 内容 | 接口 |
|---|---|---|
| 今日（落地页） | 昨日经营 KPI + 待我处理任务（含飞书同步来的）+ 团队考勤异常 | `daily_reports` 只读 + `GET /api/master/tasks?assignee=me` |
| 任务 | 我的全部任务，`[提交证据]` `[标记完成]` 原地操作 | `/api/agent-task-board/tasks/:taskId/evidences`、`.../review` |
| 日报 | 填报入口（保留现有日报页功能，深链） | 现有 `daily-report` 页 |
| 我的 | 档案/考勤/请假 | 现有 `profile`/`attendance` 页 |

### 2.4 员工工作台（`store_employee`）

**底部导航 4 格**：`今日` `学习` `积分` `我的`

今日待办清单（打卡提醒、待交证据任务）、培训任务、积分/奖惩记录、个人档案。全部现有页面的只读聚合，无新接口需求。

### 2.5 【新增】总部HR工作台 —— 严格权限管控

这是你这次提的核心新增需求，单独详细设计。

**底部导航 4 格**：`薪酬看板` `考勤治理` `人员流动` `一键报表`

| 格 | 内容 | 接口（已存在，验证过） |
|---|---|---|
| **薪酬看板**（落地页） | 全部门店实时薪资概览：应发合计、已核算门店数、异常门店数、待确认考勤异常数 | `GET /api/hrms/payroll/ledger` + `GET /api/hrms/attendance-day/abnormals`（跨店聚合，需新增一个薄聚合接口，见下） |
| **考勤治理** | 各门店考勤异常/欠假清单，可批量确认 | `GET /api/hrms/attendance-day/abnormals` + `POST /api/hrms/attendance-day/confirm` |
| **人员流动** | 入职/离职/在职人数，各店对比 | `GET /api/hrms/turnover`（已存在，`server/hrms-api-tools.js:307`）+ `GET /api/employees` |
| **一键报表** | **一键生成当月全部门店薪资报表** | `POST /api/hrms/payroll/month-run`（全店批量）+ `GET /api/hrms/payroll/month-run/status`（轮询进度）+ 导出 |

**「一键生成薪资报表」的具体交互**（这是你反复强调的痛点，必须做到极致简单）：

```
[HR 点击"一键生成本月薪资"]
        ↓ 二次确认："将为 8 家门店生成 2026年7月 薪资报表，此操作会锁定本月考勤数据，确认？"
        ↓ POST /api/hrms/payroll/month-run { period: '2026-07', stores: 'all' }
[卡片显示：生成中... 3/8 家门店已完成]  ← 轮询 GET /api/hrms/payroll/month-run/status
        ↓ 全部完成
[✅ 8家门店薪资报表已生成，共计 ¥XX 万，2 家门店有异常需人工复核 →]
        ↓ 点击异常门店，直接展开该店异常明细（考勤缺卡/请假未销假导致的算薪差异）
```

已有接口 `/api/hrms/payroll/month-run` 本身是否已支持"全部门店批量跑一次"还是"单店逐次调用"需要在 Phase 1 落地时读代码确认；如果现在是单店接口，前端循环调用 8 次并汇总进度即可，**不需要改后端**，只是编排。

**权限管控设计（你的要求："只有授权的人能用，没授权的不能用"）**——**不新建角色，复用已验证的真实权限系统**：

代码里已经有一套**服务端强制执行**的细粒度权限（`server/domains/hrms-payroll/route-helpers.js` 的 `requirePayrollPerm`），支持的权限点包括：
```
reports.payroll.view / .export / .adjust / .audit / .month_run / .rules / .ledger / .abnormal_confirm
employee.salary.view / employee.salary.edit
admin.permission_manage
```
这**不是装饰性的前端判断**——`enforcement_mode = strict/hybrid` 时，服务端每个请求都会校验 `req.user.permissions` 数组（见 `route-helpers.js:15-40`）。

**落地方式**：
1. 「总部HR工作台」入口本身，前端判断 `hrmsHasPermission('reports.payroll.view') || hrmsHasPermission('reports.payroll.ledger')`——**没有这两个权限中至少一个，整个入口在导航里都不显示**，不是显示了点不动。
2. 「一键生成报表」按钮额外要求 `reports.payroll.month_run`；「调整薪资」额外要求 `reports.payroll.adjust`；「导出」要求 `reports.payroll.export`。
3. 授权动作走**已有的权限组管理页**（`admin.permission_manage`，仅 admin 可操作）——即老板/系统管理员在权限组配置里，给指定的 HR 账号勾选上述权限点，而不是"给了 hr_manager 角色就自动有"。这样即使一个账号角色是 `hr_manager`，默认（legacy 模式下）也按现有角色逻辑，**若企业要精确管控，必须先把该租户切到 `strict`/`hybrid` 模式**（`PUT /api/hrms/permissions/policy`，已存在，admin-only）。
4. **强制要求**：凡是渲染薪资数字（应发、底薪、扣款明细）的组件，除了前端权限判断，**必须确认对应的 GET 接口本身也做了服务端权限校验**（不能只在前端隐藏、接口本身谁登录都能调）。这是 Phase 1 落地前必须逐个接口过一遍的安全检查项，不能假设"前端不显示=安全"。

**人效**指标复用 `growth-solutions` 的 `metricStaffEfficiency`（`server/domains/growth-solutions/metrics.js:258`），按店聚合展示，不需要新建计算逻辑。

---

## 3. 老板驾驶舱：在你截图基础上的完善（回应你的第1点）

你截图的稿子已经很好（KPI 三格、需拍板/机会/好结果三类卡、门店红绿灯），"完善"主要不是加新板块，而是把每个静态展示变成上面 §1/§2.1 定义的**一键执行**，另外补三处让老板"真的想每天打开"的东西：

1. **顶部加一行"距离上次打开 X 天，期间有 N 件事被自动处理"**——制造"系统在替我盯着"的感知，而不是每次打开都是一张白纸。
2. **每条卡片批准后，不会消失，而是原地降级为"执行中"条目折叠到卡片列表底部**——老板划走前能确认"我这次拍的板系统记住了"，而不是点完就飞走查无实据。
3. **§5 的决策回执机制**——这是让"好用"变成"离不开"的关键：老板批准的动作，到期会**主动**变成一条新卡片推给他看结果，不需要他自己想起来去查。这条比任何 UI 细节都重要。

---

## 4. Phase 1 范围更新（在 v2 基础上增补 HR 工作台）

新增文件：
```
frontend/src/pages/15-workspace-shell.js
frontend/src/pages/16-workspace-actions.js   # 统一"点击=立即执行"封装（§1）
frontend/src/pages/17-workspace-boss.js
frontend/src/pages/18-workspace-hq.js
frontend/src/pages/19-workspace-store.js
frontend/src/pages/20-workspace-employee.js
frontend/src/pages/21-workspace-hr.js        # 新增：总部HR工作台
server/domains/workspace/routes.js
server/domains/workspace/service.js          # 含 promoteDishToStores() 等薄编排
```

Phase 1 仍然**不新建 `agent_outbox`/`decision_receipts`**（那是 §5 提到的机制，属于 Phase 2/3），但会先验证/打通：
- 每个按钮绑定的接口确实存在且服务端强制权限
- HR 工作台入口的权限判断（前端隐藏 + 服务端已有校验复核）

---

## 5. 验收清单（8.153.95.62 上跑通，再上 47.100.96.30）

- [ ] admin 账号：驾驶舱三类卡片按钮点击后**原地**变化，不跳转、不刷新，2 秒内看到"执行中"反馈
- [ ] hq_manager 账号：审批卡片可直接批准/驳回，任务板可直接下发
- [ ] store_manager 账号：任务列表可直接提交证据
- [ ] **未授予 payroll 权限的普通 hr_manager 账号**：登录后底部导航**看不到**"总部HR工作台"入口
- [ ] **已授予 `reports.payroll.month_run` 权限的账号**：能点"一键生成薪资"，进度条正常推进，完成后异常门店可下钻
- [ ] 逐条核对：所有薪资相关 GET 接口，未授权账号直接 curl 调用返回 403（不是只前端隐藏）
- [ ] RLS 开启（demo）与关闭（生产）两种环境下，workspace 聚合查询都返回正确数据
- [ ] `npm test` 全绿；`working-fixed.html` 行数/onclick 闸门不违反

---

## 6. 仍需你确认的点

1. `/api/hrms/payroll/month-run` 现在是单店调用还是已支持批量？（不影响是否能做，只影响前端是循环调用还是单次调用，Phase 1 落地时我会先读代码确认，不用你现在回答）
2. HR 工作台的权限，是打算**新开一个租户级 `strict`/`hybrid` 模式**（会影响其他 payroll 相关页面的权限判断方式），还是只想**新增一个 HR 专属账号**、给他精确勾选上述权限点、其他人和逻辑都不变？后者影响范围更小，我倾向后者，但这是个业务决定。
3. "推广菜品到多店"这类没有现成 API 的动作，Phase 1 要不要做？还是先只做§2 里已有明确接口对应的按钮，这类"需要新建薄接口"的动作放到 Phase 1.5？我倾向后者——优先把"接现有能力"的部分做扎实，验证"一键执行"体验后再扩展新动作类型。

其余我会直接按此方案开工，建分支 `feature/workspace-shell-p1`。
