# Public API surface（对外/跨服务契约摘要）

本文件供契约测试引用；完整行为以代码为准。

## Health

- `GET /health`（agents-service-v2）：基础存活。详细载荷受 `allowDetailedHealth` / `HEALTH_TOKEN` 门禁。
- `GET /api/health`（GAAS/HRMS）：服务健康检查。

## Tenant branding

- `GET /api/tenant/branding`：登录页/租户品牌展示（公开或半公开，不依赖业务 JWT）。
