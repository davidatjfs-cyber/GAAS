/**
 * systemAlertTitle / sendAdminSystemAlert
 * (behavior-preserving extract from index.js)
 */
import { childLogger } from '../../utils/logger.js';
import { checkNotifyCircuitBreaker } from '../../utils/notify-circuit-breaker.js';

const log = childLogger({ domain: 'notifications', handler: 'system-alert' });

export function systemAlertTitle(msg) {
  const firstLine = String(msg || '').split(/\r?\n/).map((s) => String(s || '').trim()).find(Boolean) || '';
  return firstLine.slice(0, 120) || 'HRMS 系统告警';
}

export function createSendAdminSystemAlert({
  pool,
  makeNotif,
  appendNotifications,
  // appendNotifications 内部就是 insertHrmsUserNotifications（见 append.js），这里保留
  // 入参只为兼容既有调用方传参，本函数不再直接使用它——2026-08-03 双重插入修复。
  insertHrmsUserNotifications: _insertHrmsUserNotifications,
  uniqUsernames,
  systemAlertTitle: titleFromMsg,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  resolveTenantIdDefault,
}) {
  return async function sendAdminSystemAlert(msg, options = {}) {
    let text = String(msg || '').trim();
    if (!text) return { recipients: [], feishuSent: 0, feishuFailed: 0 };

    // 2026-07-28 修复：这两处「群发管理员」查询原来没有 tenant_id 过滤，会把 admin/hq_manager/
    // hr_manager 查到全部租户，导致新租户的管理员收到跟自己毫无关系的告警（真实事故：新建的
    // demo 租户管理员收到了另一个租户的定时任务失败通知）。调用方没显式传 tenantId 时，落到
    // resolveTenantIdDefault() 的 AsyncLocalStorage 上下文，跟其它「找不到就按default处理」
    // 的代码保持一致，不引入新的兜底语义。
    const tenantId = String(options?.tenantId || (resolveTenantIdDefault ? resolveTenantIdDefault() : 'default')).trim() || 'default';

    const explicitUsernames = uniqUsernames(Array.isArray(options?.usernames) ? options.usernames : []);
    let recipients = explicitUsernames.slice();
    if (!recipients.length) {
      const admins = await pool.query(
        `SELECT username
         FROM users
         WHERE role IN ('admin','hq_manager','hr_manager')
           AND is_active = true
           AND tenant_id = $1
         LIMIT 8`,
        [tenantId]
      );
      recipients = uniqUsernames((admins.rows || []).map((r) => r.username));
    }
    if (!recipients.length) return { recipients: [], feishuSent: 0, feishuFailed: 0 };

    const title = String(options?.title || '').trim() || titleFromMsg(text);
    const notificationType = String(options?.notificationType || 'system_alert').trim();
    const meta = options?.meta && typeof options.meta === 'object' ? options.meta : {};

    // 熔断：同一条告警(按 tenant+标题归一化)短时间内重复触发，说明上游大概率是死循环/重复
    // 调度而不是真的有那么多新问题——拦截，只放一条"已限流"提示过去，不再逐条群发轰炸。
    const breakerKey = `${tenantId}:${title}`;
    const breaker = checkNotifyCircuitBreaker(breakerKey, { maxPerWindow: 5, windowMs: 5 * 60 * 1000 });
    if (!breaker.allowed) {
      log.warn({ msg: 'system_alert_circuit_breaker_tripped', tenantId, title, count: breaker.count });
      if (!breaker.justTripped) {
        return { recipients: [], feishuSent: 0, feishuFailed: 0, circuitBreakerTripped: true };
      }
      // 越过阈值的这一次，把消息改写成"已自动限流"提示，仍然正常走下面完整流程发一次，
      // 之后同 key 的调用会被上面的 return 直接拦掉。
      text = `⚠️ 【通知熔断】"${title}" 5分钟内已触发超过5次，判断为重复/异常调度，已自动限流，后续同类消息将被拦截直到窗口重置。\n最初内容：${text.slice(0, 300)}`;
    }

    if (options?.persistToHrms !== false) {
      const notifs = recipients.map((username) => makeNotif(username, title, text, {
        type: notificationType,
        meta: {
          source: 'admin_system_alert',
          ...meta,
        },
      }));
      // 2026-08-03 修复用户反复反馈的"弹窗点了又来"根因：这里之前连续调用了
      // appendNotifications(notifs) 和 insertHrmsUserNotifications(notifs) 两个函数——
      // 但 appendNotifications 的实现(见 append.js)就是直接转调 insertHrmsUserNotifications，
      // 两者根本是同一件事，等于把同一批通知原样插了两遍。生产实测：同一条"定时任务心跳异常"
      // 在 hrms_user_notifications 里存在两条 created_at/message/meta 完全相同的记录
      // (id 11849711 / 11849716)，用户点"我已阅读并知晓"只把其中一条置为已读，另一条仍是
      // 未读，下次打开又被强制弹窗队列捞出来弹一次——这就是"天天点、天天又冒出来"的真相，
      // 跟告警本身触发频率无关。这里只保留一次插入。
      try {
        await appendNotifications(notifs);
      } catch (e) {
        log.error({ msg: 'system_alert_persist_failed', err: e?.message || String(e) });
      }
    }

    let feishuSent = 0;
    let feishuFailed = 0;
    const sendTargets = [];
    const seenOpenId = new Set();
    for (const username of recipients) {
      try {
        const fu = await lookupFeishuUserByUsername(username);
        let openId = String(fu?.open_id || '').trim();
        if (!openId) {
          const r = await pool.query(
            `SELECT open_id FROM feishu_users WHERE lower(username)=lower($1) LIMIT 1`,
            [username]
          );
          openId = String(r.rows?.[0]?.open_id || '').trim();
        }
        if (!openId || seenOpenId.has(openId)) continue;
        seenOpenId.add(openId);
        sendTargets.push(openId);
      } catch {
        // ignore single user mapping failure, below会走角色兜底
      }
    }
    // 仅在“群发管理员”场景启用 role 兜底；单人演练/定向告警必须严格按指定用户名发送
    if (!explicitUsernames.length) {
      try {
        const roleRows = await pool.query(
          `SELECT DISTINCT open_id
           FROM feishu_users
           WHERE registered = true
             AND role IN ('admin','hq_manager','hr_manager')
             AND TRIM(COALESCE(open_id, '')) <> ''
             AND open_id NOT LIKE '%probe%'
             AND tenant_id = $1`,
          [tenantId]
        );
        for (const row of roleRows.rows || []) {
          const oid = String(row?.open_id || '').trim();
          if (!oid || seenOpenId.has(oid)) continue;
          seenOpenId.add(oid);
          sendTargets.push(oid);
        }
      } catch (e) {
        log.error({ msg: 'system_alert_role_fallback_failed', err: e?.message || String(e) });
      }
    }

    for (const openId of sendTargets) {
      const result = await sendLarkMessage(openId, text, { skipDedup: true }).catch((e) => ({ ok: false, error: e?.message }));
      if (result?.ok) feishuSent += 1;
      else feishuFailed += 1;
    }

    if (sendTargets.length === 0) {
      feishuFailed = recipients.length || 1;
    }
    if (feishuSent === 0) {
      log.error({
        msg: 'system_alert_feishu_all_failed',
        recipients,
        send_targets: sendTargets.length,
        feishu_failed: feishuFailed,
      });
    }

    return { recipients, feishuSent, feishuFailed };
  };
}
