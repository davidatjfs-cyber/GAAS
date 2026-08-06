/**
 * appendNotifications / insertHrmsUserNotifications
 * (behavior-preserving extract from index.js)
 *
 * appendNotifications 只写 hrms_user_notifications 表（权威），不再 merge blob。
 */

export function createAppendHelpers({
  pool,
  resolveTenantIdDefault,
  hrmsNowISO,
  invalidateSharedStateCache,
}) {
  async function insertHrmsUserNotifications(notifs) {
    const list = Array.isArray(notifs) ? notifs.filter(Boolean) : [];
    if (!list.length) return;
    const tid = resolveTenantIdDefault();
    for (const n of list) {
      const target = String(n?.targetUser || n?.targetUsername || n?.to || '').trim();
      if (!target) continue;
      const type = String(n?.type || 'system_notice').trim();
      const message = String(n?.message || '').trim();
      // 2026-07-30：这里是所有通知类型（排班/培训/离职/积分申请等）共用的唯一落库入口，
      // 之前完全没有去重检查——一旦上层调用方因为并发重复请求/竞态条件被多次触发（如
      // 日报提交接口被短时间内重复POST，命中"未提交"判断的多个并发请求各自都会走一遍
      // 通知全员的逻辑），这里就会无脑各插一遍，实测曾在同一秒内堆积出十几万条重复通知，
      // 拖垮数据库进而拖垮整机。加一道去重锁，在唯一写入点堵住，不需要逐个上层调用方
      // 各自补防重复逻辑。
      // 2026-07-31 修复设计缺陷：上一版去重锁限定"最近10分钟内"，只能挡住同一秒/同一
      // 突发窗口内的重复插入——但生产实测发现points_request/schedule_notice等类型
      // 存在"每隔十几分钟到几十分钟就被重新触发一次"的更慢速重复bug（同一条未处理的
      // 审批请求反复通知），旧的一旦超过10分钟就不再被识别为"重复"，日积月累堆积到
      // 6万+条。改成：只要还存在同用户+同类型+同文案的未读通知（不限时间），就跳过
      // 插入——这才是真正的意图："同一条未读通知不需要重复提醒"，不是"只挡突发短时重复"。
      // 2026-08-01 再修一个设计缺陷：这道锁只挡"未读"的——用户一旦点了"已读"，锁就立刻
      // 松开，如果上游的告警/检查任务本身有 bug 反复触发同一句文案（今天实测：
      // 定时任务心跳异常/上月累计假期自动快照失败/培训任务逾期提醒/销售数据缺失告警
      // 都出现过"acked后没多久又插入一条一模一样的"，用户在一天内被同一件事反复强制
      // 弹窗确认），用户体验上跟完全没去重一样——"点掉了又弹出来"。改成：已读的也纳入
      // 去重窗口，但只挡最近 COOLDOWN_HOURS 小时内acked过的（不是永久挡，跨天/长时间
      // 后同一句文案如果真的又发生，还是应该能提醒到）。
      // 2026-08-03 修复：这道去重锁原来是"先 SELECT 查有没有重复、再 INSERT"两步分开执行，
      // 中间存在经典的 TOCTOU 竞态——两个并发调用可能同时查到"没有重复"，然后各自插入一条，
      // 去重锁形同虚设。今天定位"弹窗点了又来"时实测同一条告警存在两条完全相同的记录
      // （同 created_at/message/meta），主因是 system-alert.js 把同一批通知连续插了两遍
      // （已单独修复），但只要这里还是"查完再插"，任何并发路径都可能重现同样的重复。
      // 改成单条 INSERT ... SELECT ... WHERE NOT EXISTS。
      // 2026-08-06 更正：上一行原本写着「判重和插入在同一条 SQL 语句里原子完成，并发下最多
      // 只有一条能插进去」——这个说法是错的，别再照抄。PostgreSQL 默认 READ COMMITTED 下，
      // 两个并发事务互相看不到对方未提交的行，双方的 NOT EXISTS 都会返回真、双方都插入成功；
      // 没有 UNIQUE 约束时 WHERE NOT EXISTS 挡不住并发重复。生产实证：admin 在 2026-08-06
      // 15:08:36 收到 id 11851217 / 11851428 两条完全相同的心跳告警，近 7 天 66 组重复。
      //
      // 真正的保证来自 migration 183 建的**部分唯一索引** uniq_hrms_notif_unread_msg
      // (lower(target_username), type, md5(message)) WHERE read_at IS NULL，
      // 配合下面的 ON CONFLICT DO NOTHING —— 唯一性由数据库裁决，并发下必然只有一条落地。
      // 保留 WHERE NOT EXISTS 是因为它还多管一件唯一索引管不了的事：已读通知在 4 小时冷却期内
      // 不重复提醒（已读行不在部分索引里，只能靠这个子查询挡）。两者职责不同，都要留着。
      //
      // 2026-08-06（migration 184）：target_username 已改为 citext，比较天生忽略大小写，
      // 所以这里写 `target_username = $1` 而不是 `lower(target_username) = lower($1)`。
      // ⚠️ 这不只是"更简洁"——写成 lower($1) 会直接报错 42P08
      // `inconsistent types deduced for parameter $1: text versus citext`：
      // 同一个 $1 既作为 citext 列的插入值、又被 lower() 当 text 用，Postgres 推断不出类型，
      // 整条语句失败（= 所有通知写不进去）。citext 列的参数不要再套 lower()。
      await pool.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
         SELECT $1,$2,$3,$4,$5,$6,$7
          WHERE NOT EXISTS (
            SELECT 1 FROM hrms_user_notifications
             WHERE target_username = $1 AND type = $4 AND message = $3
               AND (read_at IS NULL OR read_at > NOW() - INTERVAL '4 hours')
          )
         ON CONFLICT DO NOTHING`,
        [
          target,
          String(n?.title || '').trim() || '通知',
          message,
          type,
          JSON.stringify(n?.meta || n?.data || {}),
          n?.createdAt ? new Date(n.createdAt).toISOString() : hrmsNowISO(),
          tid,
        ]
      );
    }
    if (typeof invalidateSharedStateCache === 'function') {
      invalidateSharedStateCache(tid);
    }
  }

  async function appendNotifications(notifs) {
    await insertHrmsUserNotifications(notifs);
  }

  return { appendNotifications, insertHrmsUserNotifications };
}
