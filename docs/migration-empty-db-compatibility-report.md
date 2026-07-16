# GAAS Migration 空库兼容性修复记录

测试环境：本机 Homebrew PostgreSQL 16.14，数据库 `hrms_sales_ai_test`，用户 `hrms_test`。未连接生产数据库。

## 已修复并从空库重放通过的 migration

004、025、028、033、035、037、039、040、041、042、050、051、052、053、054、055、056、057、058、059、060、061、062、063、064、065、066、067、068、069、070、071、072、073、074。

修复原则均为：表存在时执行原迁移；可选/legacy 表不存在时安全跳过；不创建占位表；不修改 `schema_migrations` 绕过失败。

## 关键根因

- 早期 migration 在 `hrms_state`、POS、飞书/企微、Agent、增长模块正式表创建前直接执行 ALTER/RLS/索引操作。
- `041_pos_tenant_id.sql` 仍引用已经下线的 `sales_raw`，已删除该引用并改为 `pos_order_items` 权威来源。
- 多个租户补列 migration 对大量可选表采用无条件 ALTER。

## 当前阻断

最新一次完整链已通过 001–074；`075_growth_tables_unique_constraints_tenant_id.sql` 已完成可选增长表存在性保护修复，待重新从空库验证 075 及后续 migration。批次1数据库测试尚未执行，原因是正式 migration 链尚未全部通过。

## 生产影响

本次只修改本地 migration 文件并使用本机隔离数据库验证；未执行生产 migration、未修改生产数据库、未部署。

## 最终空库验证（2026-07-16）

- 隔离库 `hrms_sales_ai_test` 从空库完整重放 001–126 通过，迁移器记录 133 个文件；未创建占位表，`sales_raw` 未被重新引用。
- 第二次执行 migration 通过：`applied 0, skipped 133`，确认幂等。
- 关键检查：`schema_migrations=133`、`sales_leads` 存在、租户隔离 policy 共 191 条。
- 修复 075、076、077、079、080、081、082、083、084、085、093 的空库兼容性问题；085 保留父表存在时才挂外键，093 对缺失触发器函数安全跳过。
- 未部署、未执行生产 migration、未连接生产数据库。
