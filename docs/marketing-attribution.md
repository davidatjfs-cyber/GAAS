# 自动营销归因

自动营销归因用于追踪自动营销动作从触达到回店、消费、复购的结果，支撑客户资产报告和自动营销报告里的“结果归因”。

## 第一版规则

- 同一 `customerId`
- 订单发生在触达时间之后
- 默认 7 天归因窗口，可通过 `attributionWindowDays` 配置
- `couponId` 命中优先归因为 `coupon`
- 没有 `couponId`，但客户在窗口内回店下单，归因为 `assisted`
- 如果订单带明确活动链接或活动 id，可归因为 `direct`
- 没有 `customerId` 不强行归因
- 没有 `relatedOrderId` 不计入真实归因营业额
- 窗口外订单不计入归因

## evidenceDetails

归因结果返回 `evidenceDetails`，每条包含：

- `customerId`
- `customerName`
- `campaignId`
- `touchTime`
- `channel`
- `couponId`
- `relatedOrderId`
- `orderTime`
- `orderAmount`
- `attributionType`
- `couponUsed`
- `attributionWindowDays`

`relatedOrderId` 是判断归因营业额是否有真实订单支撑的关键字段。

## API

```bash
GET /api/marketing/attribution/:campaignId
POST /api/marketing/attribution/preview
POST /api/ontology/business/infer-marketing
```

## 老板端展示

自动营销区域展示：

- 触达人数
- 回店人数
- 归因订单数
- 归因营业额
- 转化率
- 归因证据

文案边界：

- `coupon`：客户触达后使用对应优惠券产生订单。
- `direct`：订单可明确关联活动链接或活动 id。
- `assisted`：客户在触达窗口内回店，但没有使用对应优惠券。

辅助归因展示为：

“辅助归因：客户在触达后窗口内回店，但未使用对应优惠券。”

## 如何验证订单归因

1. 查看 `evidenceDetails.relatedOrderId` 是否存在。
2. 确认 `customerId` 与触达记录一致。
3. 确认 `orderTime` 在 `touchTime` 之后。
4. 确认 `orderTime - touchTime` 不超过 `attributionWindowDays`。
5. 如果 `attributionType=coupon`，确认 `couponId` 与触达券一致。

没有满足这些条件时，不计入真实归因营业额。
