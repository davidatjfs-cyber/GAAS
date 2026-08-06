-- 2026-08-06：通知重复插入的真正根因修复。
--
-- server/domains/notifications/append.js 用 `INSERT ... SELECT ... WHERE NOT EXISTS` 做去重，
-- 并在注释里声称「判重和插入在同一条 SQL 语句里原子完成，并发下最多只有一条能插进去」。
-- 这个说法是错的：PostgreSQL 默认 READ COMMITTED 隔离级别下，两个并发事务互相看不到对方
-- 尚未提交的行，于是双方的 NOT EXISTS 子查询都返回真，双方都插入成功。表上此前没有任何
-- UNIQUE 约束兜底，所以这道"锁"在并发路径上形同虚设。
--
-- 生产实证（2026-08-06）：admin 在 15:08:36 收到两条 id 11851217 / 11851428，
-- target_username / type / message / created_at 完全相同；近 7 天共 66 组重复、129 行冗余。
-- 用户点"我已阅读并知晓"只清掉其中一条，孪生副本仍未读，下次又被强制弹窗队列捞出来
-- ——这就是长期反馈的"点了又冒出来"。
--
-- 正确做法是让数据库来保证唯一性。这里建**部分唯一索引**（只约束未读行），语义正好等于
-- append.js 真正想表达的意图：「同一个人名下，同一条未读通知只能存在一份」。
-- 用户 ack 后 read_at 变为非空，该行自动离开索引，未来同样文案如果真的又发生，仍能再次插入
-- ——不会退化成"永久屏蔽"。
--
-- message 用 md5 收进索引键：btree 单键有 ~2704 字节上限，告警正文（含排查建议）经常超限，
-- 直接索引 message 原文会在长文案时报错。

-- 1) 先清掉存量重复的未读副本，否则唯一索引建不起来。每组只保留 id 最小的那条。
DELETE FROM hrms_user_notifications a
 USING hrms_user_notifications b
 WHERE a.read_at IS NULL
   AND b.read_at IS NULL
   AND a.id > b.id
   AND lower(a.target_username) = lower(b.target_username)
   AND a.type = b.type
   AND md5(a.message) = md5(b.message);

-- 2) 部分唯一索引：同一用户 + 同类型 + 同文案，未读行最多一条。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hrms_notif_unread_msg
    ON hrms_user_notifications (lower(target_username), type, md5(message))
 WHERE read_at IS NULL;
