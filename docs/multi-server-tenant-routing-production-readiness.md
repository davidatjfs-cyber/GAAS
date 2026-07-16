# 多租户多服务器生产化准备度

## 当前架构

小程序只调用 TCB `hrmsClient`。它按 `store_id -> tenant_id -> tenant_server_routes -> hrms_server_registry` 解析目标服务器；GAAS/HRMS 再调用同一服务器上的 `agents-service-v2`。

## 已落地

- HMAC 请求头：`X-Tenant-Id`、`X-Store-Id`、`X-Request-Id`、`X-Timestamp`、`X-Signature`。
- 非默认租户路由缺失时 fail-closed。
- `server_tenant_bindings` 迁移及索引。
- Outbox 目标服务器字段迁移。
- 客户端内存级租户/服务器并发保护和熔断基础实现。

## 必须配置

- `SERVER_CODE` 或 `HRMS_SERVER_CODE`
- `MINIPROGRAM_SYNC_SECRET`
- `HRMS_ALLOWED_TENANT_IDS`（配置时作为额外白名单）
- 每个正式租户的 `tenant_server_routes`
- 每台服务器的 `server_tenant_bindings`

## 上线前检查

1. 新租户没有路由时不能回退默认服务器。
2. `tenant_id` 与 `store_id` 必须归属一致。
3. 每台服务器只接受自己的绑定租户。
4. 反向小程序调用必须使用 server/tenant/store 签名。
5. Outbox 必须保存 `target_server_code` 和 `route_version`。
6. 执行 `node server/scripts/check-tenant-isolation.js`。
7. 配置测试环境后执行 `node server/scripts/e2e-multi-server-routing.js`。
8. 执行 `node server/scripts/loadtest-multi-tenant-routing.js --tenants=2 --stores=2 --rpm=5 --minutes=1`。
9. 验证 server_a 故障不会影响 server_b。

## 当前限制

真实租户、服务器绑定和域名尚未配置时，不能完成真实跨服务器成功路由验收；静态检查和鉴权失败路径可以先验证。

## Code Governance: Source First, Demo Second

- GAAS 是正式服务端源代码仓库。
- GAAS-demo 只是 demo 部署仓库。
- 所有正式服务端能力必须先进入 GAAS。
- GAAS 验证通过后，才允许同步到 GAAS-demo。
- agents-service-v2 是 Agent 正式源代码仓库。
- agents-service-v2-demo 只是 Agent demo 部署仓库。
- 所有 Agent 正式能力必须先进入 agents-service-v2。
- agents-service-v2 验证通过后，才允许同步到 agents-service-v2-demo。
- 禁止 demo 仓库成为正式功能开发源头。
- 如果紧急 hotfix 先在 demo 修复，必须当天回填主仓库，否则视为未完成。
