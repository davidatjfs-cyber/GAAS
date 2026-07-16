# 销售阶段状态机（批次1收口版）

本轮不重新设计生命周期，只把此前散落在 6 处直接写 `sales_leads.stage` 的代码收口到统一入口，
并把状态表补齐到与这 6 处历史行为一致（不是发明新规则）。

## 统一入口

```
transitionLeadStage(pool, {
  leadId, toStage, actorType, actorId, reason, sourceType, sourceId, metadata,
})
```

位置：[sales-store.js](../server/services/sales/sales-store.js)

行为：
1. `SELECT stage FROM sales_leads WHERE id=$1 FOR UPDATE`（行锁，防并发覆盖）
2. `toStage === fromStage` → 幂等返回 `{ok:true, changed:false}`，不写审计
3. `canTransition(fromStage, toStage)` 校验，非法转换返回 `{ok:false, error:'illegal_transition'}`，不落任何库
4. 合法转换：更新 `sales_leads.stage` + 写 `sales_stage_history` + 写 `sales_lead_events(event_type='STAGE_CHANGED')`，三步在同一事务
5. 返回 `{ok, changed, from_stage, to_stage}`

## 替换掉的直接写入点

| 位置 | 原行为 | 现行为 |
|---|---|---|
| `createDemo` | 无条件/CASE条件写 `demo_completed`，不记审计 | 走 `transitionLeadStage`，非法转换会被拒绝 |
| `createMeeting` | CASE条件写 `sales_takeover` | 同上 |
| `createTrial` | 无条件写 `trial` | 同上 |
| `createDeal` | 无条件写 `won` | 同上 |
| `recordLossReason` | 无条件写 `lost` | 同上 |
| `pause`动作(sales-ai-routes.js) | 直接UPDATE，事后补记审计 | 走 `transitionLeadStage`，返回409如果非法 |
| `POST /leads/:id/stage`(手动路由) | 已有canTransition校验但和其他5处逻辑不统一 | 统一走 `transitionLeadStage` |

**未收口的一处**：`sales-session.js` 的AI自动决策路径（每条客户消息都可能触发的
`applyLeadUpdates`）目前仍是直接写 `stage` 字段（同一UPDATE语句里和其他字段一起写），
只是本来就有 `recordStageChange` 记审计，只是没有 `canTransition` 校验。这是全系统调用频率最高的
路径（每条客户消息一次），本批评估后判断结构性改造风险大于收益，未改动，作为已知缺口保留。

## 状态转换表（widened 版，经测试修正）

用代码生成而不是手抄：`BASE_TRANSITIONS`定义基础流转，`trial`/`won`这两个"旧代码里createTrial/
createDeal完全无条件写入"的目标状态，自动追加到除`won`/`lost`/`unfit`之外的所有源状态。

```js
const RESULT_STATES_REACHABLE_FROM_ANYWHERE = ['trial', 'won'];
const TERMINAL_OR_RESULT_SOURCES = new Set(['won', 'lost', 'unfit']);
```

即：`trial`/`won`可以从`new/ai_greeting/need_identified/qualified/need_confirmed/sales_takeover/
demo_scheduled/demo_completed/proposal/nurture/paused`直接抵达（还原旧代码"无条件写入"的真实行为）；
但**不能从`lost`/`unfit`直接跳到`won`/`trial`**——这两个是"已放弃"状态，必须先经过`nurture`重新
激活才能继续往前走。这一点是本轮明确加的守卫（不是简单还原旧行为），因为"标记丢单后又直接
显示成交"在旧代码里technically可能发生但明显不合理，值得借这次收口顺便挡住。

`won`本身仍是完全终态（转出列表为空）。

⚠️ 这份表最初的第一版有bug（'new'→'won'被漏掉、'lost'→'won'被错误允许），是被
[test-sales-ai-batch1.mjs](../server/test-sales-ai-batch1.mjs)的纯函数断言在部署前发现并修正的——
说明这类状态表改动即使看起来简单，也需要真实测试而不是人工审查来保证正确性。
