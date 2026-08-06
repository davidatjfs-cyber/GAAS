-- 2026-08-06：用户名全面改为大小写不敏感（citext）。
--
-- 问题：同一个人在库里被拆成两个身份。生产实测 users 表里每人只有一个账号（零重复），
-- 但引用它的列写入了不一致的大小写——真账号是 NNYXYF26，通知却写成 nnyxyf26。
-- 扣掉 user_login_log（那是登录输入原文，本就该保留），仍有约 918 行漂移，其中
-- user_reads（已读状态）和 master_tasks.assignee_username（任务指派）会造成用户可见的错乱：
-- 已读的又变未读、指派给你的任务查不到。
--
-- 根因分类（见 CLAUDE.md「反复复发类问题」第 1 条）：这属于**不变量靠约定维护**。
-- 代码里 120 处记得写 lower(username)、94 处没写——一半人记得的约定必然漏。
-- 逐个补 lower() 是又一轮同类修法：补完这 94 处，下一个新写的 SQL 照样会漏。
--
-- 修法是把「大小写不敏感」变成**列的类型属性**，由数据库保证：
-- citext 的比较运算符天生忽略大小写，那 94 处裸 `username = $1` 自动变正确，
-- 以后新代码也不需要记得写 lower()。这是 O(1) 的修法，不是 O(代码路径数)。
--
-- 附带效果（正是用户要的语义）：users.username 上的唯一索引变成大小写不敏感，
-- 从此**建不出 'Foo' 和 'foo' 两个账号**——大小写默认就是同一个账号。
--
-- 安全性：
--  - citext 在 PG13+ 是 trusted 扩展，非超级用户（本库的 hrms）可安装。
--  - 已核对：无视图依赖这些列（不会阻塞 ALTER TYPE）；除 3 个 NULL 外无大小写撞车
--    （NULL 不违反唯一约束）；唯一的 FK knowledge_base.created_by 指向 users(id)（uuid），
--    与 username 无关，不受影响。
--  - schema-migrations.js 用事务执行每个 migration，任何唯一索引冲突都会整体 ROLLBACK。
--  - citext 只改变**比较**语义，不改变存储值：user_login_log 里用户当时输入的原文照样保留。

CREATE EXTENSION IF NOT EXISTS citext;

DO $$
DECLARE
  r record;
  converted int := 0;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, c.column_name AS c
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND tb.table_type = 'BASE TABLE'
       AND c.column_name IN ('username', 'target_username', 'assignee_username', 'created_by')
       AND c.data_type IN ('text', 'character varying')
       -- 备份/归档表不动：它们是历史快照，转换没有收益，只增加本次改动的爆炸半径
       AND c.table_name NOT LIKE '%_backup'
       AND c.table_name NOT LIKE '%_legacy%'
     ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE citext', r.t, r.c);
    converted := converted + 1;
  END LOOP;
  RAISE NOTICE 'citext 转换完成，共 % 列', converted;
END $$;

-- 把历史上写歪的大小写归一到 users 表的标准写法。
-- 转 citext 之后功能上已经不需要这一步（比较会忽略大小写），但界面上直接展示
-- target_username / assignee_username 的地方仍会露出 nnyxyf26 这种不一致的写法，
-- 统一成标准写法可读性更好。user_login_log 例外——它记录的是用户当时实际输入的内容，
-- 属于审计事实，不能被改写。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, c.column_name AS c
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND tb.table_type = 'BASE TABLE'
       AND c.column_name IN ('username', 'target_username', 'assignee_username')
       AND c.udt_name = 'citext'
       AND c.table_name <> 'user_login_log'
       AND c.table_name <> 'users'
  LOOP
    EXECUTE format(
      'UPDATE public.%I x SET %I = u.username FROM public.users u ' ||
      ' WHERE x.%I = u.username AND x.%I::text <> u.username::text',
      r.t, r.c, r.c, r.c);
  END LOOP;
END $$;
