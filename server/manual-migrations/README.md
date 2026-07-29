# 手动迁移（不进 `node migrate.js` 自动扫描）

`server/migrations/` 里任何数字开头的 `.sql` 文件都会被 `node migrate.js` 自动执行——
它只看文件名前缀是不是数字、有没有记在 `schema_migrations` 表里，不会读文件内容里的
注释。这个目录下的脚本是 **数据清理/回填类操作**（strip hrms_state 里已经迁移到独立表
的字段），故意放在 `server/migrations/` 之外，防止被下一次任何人跑 `node migrate.js`
（哪怕是为了部署一个完全无关的新迁移）顺带自动执行。

## 执行前置条件（每个文件都必须满足）

对应字段的读写代码（hydrate + 写入路径改表）**已经部署到生产并稳定运行至少几天**，
确认没有遗留代码还在直接读/写 `hrms_state` 里的旧字段，再执行对应脚本。执行顺序按文件名
数字即可（157 的回填要先于它自己的 strip 部分）。

## 执行方式

```bash
psql "$DATABASE_URL" -f server/manual-migrations/<file>.sql
```

执行前建议先对 `hrms_state` 那一行做个快照备份（至少 `select data->'<字段名>' from hrms_state`
存一份），执行后用 `select length(data::text) from hrms_state where key='default'` 确认体积
确实降了，再进行下一个。

`169_deferred_users_stores_strip_NOTE.sql` 只是占位说明，无 DDL/DML，不需要执行。
