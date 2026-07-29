-- DEFERRED: users/stores blob strip
-- users 仍经 PUT /api/state 与 employees 镜像交织；stores 与 growth_ontology_stores / stores 表未完全对齐。
-- 当前策略：仅 hydrate（employees 已 hydrate），不 strip。待 users/stores 表 SoT 完备后再增 migration。

-- 占位注释文件，无 DDL/DML。
