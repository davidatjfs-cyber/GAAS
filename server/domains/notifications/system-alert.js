/**
 * systemAlertTitle / sendAdminSystemAlert
 * (behavior-preserving extract from index.js)
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'notifications', handler: 'system-alert' });

export function systemAlertTitle(msg) {
  const firstLine = String(msg || '').split(/\r?\n/).map((s) => String(s || '').trim()).find(Boolean) || '';
  return firstLine.slice(0, 120) || 'HRMS 系统告警';
}

export function createSendAdminSystemAlert({
  pool,
  makeNotif,
  appendNotifications,
  insertHrmsUserNotifications,
  uniqUsernames,
  systemAlertTitle: titleFromMsg,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  resolveTenantIdDefault,
}) {
  return async function sendAdminSystemAlert(msg, options = {}) {
    const text = String(msg || '').trim();
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

    if (options?.persistToHrms !== false) {
      const notifs = recipients.map((username) => makeNotif(username, title, text, {
        type: notificationType,
        meta: {
          source: 'admin_system_alert',
          ...meta,
        },
      }));
      try {
        await appendNotifications(notifs);
        await insertHrmsUserNotifications(notifs);
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
