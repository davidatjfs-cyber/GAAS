# 客户AI × 销售AI 事件字典 v1

本阶段统一使用 `sales_lead_events` 记录客户画像、诊断交付、案例推荐、转人工和 Demo 生命周期事件。事件写入必须带 `actor_type`、`source_type`、`correlation_id`；手机号等敏感值只能进入受控联系方式字段，不能进入普通事件摘要或证据。

事件类型以 `server/services/sales/sales-event-dictionary.js` 为机器可校验的唯一来源。旧的 `REQUEST_DEMO` 等历史事件继续保留用于兼容查询，新流程新增 `demo_requested` 等标准事件。
