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
-- 🔴 部署顺序（实测确认，不能凭习惯反过来）：**先部署代码，再跑这个 migration**。
-- 旧代码里 `lower(target_username) = lower($1)` 那几条 SQL 打到已转 citext 的库会直接报
-- 42P08 text versus citext，**整条语句失败** = 所有通知写不进去。演练库实测复现过。
-- 反向的窗口是无害的：新代码的 `target_username = $1` 打到尚未转换的 text 列，
-- 只是判重暂时区分大小写，且 migration 183 的唯一索引仍在兜底。
--
-- 安全性：
--  - citext 在 PG13+ 是 trusted 扩展，非超级用户（本库的 hrms）可安装。
--  - 已核对：无视图依赖这些列（不会阻塞 ALTER TYPE）；除 3 个 NULL 外无大小写撞车
--    （NULL 不违反唯一约束）；唯一的 FK knowledge_base.created_by 指向 users(id)（uuid），
--    与 username 无关，不受影响。
--  - schema-migrations.js 用事务执行每个 migration，任何唯一索引冲突都会整体 ROLLBACK。
--  - citext 只改变**比较**语义，不改变存储值：user_login_log 里用户当时输入的原文照样保留。

CREATE EXTENSION IF NOT EXISTS citext;

-- ── 前置：合并「同一个人被拆成两个身份」造成的重复行 ────────────────────────────
-- 转 citext 后大小写不再区分，含用户名列的唯一约束会把这些行判定为重复而建不起来。
-- 2026-08-07 生产实测：第一次执行就因 store_duty_bindings_username_store_key 失败并整体回滚
-- （事务保护生效，库无损）。事后用「遍历所有含用户名列的唯一索引 + 按 lower() 分组查重复」
-- 的方式系统排查，全库只有下面两处，都是同一个人（NNYXYF26/nnyxyf26、NNYXGY70/nnyxgy70、
-- NNYXXB08/nnyxxb08）的重复记录——正是本 migration 要根治的病症本身。

-- 1) user_reads：同一个人用两种大小写读了同一条内容。保留最早的 read_at
--    （"第一次读到"才是事实；两条都代表已读，合并不改变任何人的已读状态）。
UPDATE user_reads a
   SET read_at = LEAST(a.read_at, (
         SELECT MIN(b.read_at) FROM user_reads b
          WHERE lower(b.username) = lower(a.username) AND b.module = a.module
            AND b.item_key = a.item_key AND b.tenant_id = a.tenant_id))
 WHERE EXISTS (SELECT 1 FROM user_reads b
                WHERE lower(b.username) = lower(a.username) AND b.module = a.module
                  AND b.item_key = a.item_key AND b.tenant_id = a.tenant_id
                  AND b.username <> a.username);
DELETE FROM user_reads a
 USING user_reads b
 WHERE lower(a.username) = lower(b.username) AND a.module = b.module
   AND a.item_key = b.item_key AND a.tenant_id = b.tenant_id
   AND a.username <> b.username
   -- 保留与 users 表标准写法一致的那条；两条都不匹配时保留字典序靠前的，保证确定性
   AND (b.username IN (SELECT username FROM users) OR
        (a.username NOT IN (SELECT username FROM users) AND a.username > b.username));

-- 2) store_duty_bindings：同一人在同一门店有两条绑定。
--    2026-08-07 与用户确认后保留 users 表标准写法（大写）那条，理由：
--      - 用户名与 users 表一致；
--      - metadata 带职责标签（主负责 / 监管+sm_accountable），信息更完整；
--      - 无 effective_to，不会在 2027 年到期后静默失去权限。
--    权限零影响：实测两条在 is_primary_store / can_approve_hrms / can_view_employees
--    上完全相同，且 loadActiveDutyRowsForUser 本来就用 lower(trim(username)) 匹配，
--    也就是说这两条此前一直同时生效，合并后行为不变。
DELETE FROM store_duty_bindings a
 USING store_duty_bindings b
 WHERE lower(a.username) = lower(b.username) AND lower(a.store) = lower(b.store)
   AND a.tenant_id = b.tenant_id AND a.username <> b.username
   AND (b.username IN (SELECT username FROM users) OR
        (a.username NOT IN (SELECT username FROM users) AND a.username > b.username));

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
