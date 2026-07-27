import { faqForItemKey } from '../tenant-health-faq.js';

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function healNotifyCustomer(pool, incident, notifiers = {}) {
  const faq = faqForItemKey(incident.item_key) || (incident.faq_id ? { id: incident.faq_id, title: incident.faq_id } : null);
  const usersR = await pool.query(
    `SELECT username FROM users
      WHERE COALESCE(tenant_id,'default')=$1
        AND COALESCE(is_active,true)=true
        AND role IN ('admin','tenant_admin','hq_manager','operation_admin')
      ORDER BY id ASC LIMIT 20`,
    [incident.tenant_id]
  ).catch(() => ({ rows: [] }));

  let targets = usersR.rows || [];
  if (!targets.length) {
    const empR = await pool.query(
      `SELECT username FROM employees
        WHERE COALESCE(tenant_id,'default')=$1
          AND role IN ('admin','tenant_admin','hq_manager','store_manager')
        LIMIT 20`,
      [incident.tenant_id]
    ).catch(() => ({ rows: [] }));
    targets = empR.rows || [];
  }

  const title = `【需门店处理】${incident.item_name || incident.item_key}`;
  const message = [
    `租户：${incident.tenant_id}`,
    `问题：${incident.item_name || incident.item_key}（${incident.severity || ''}）`,
    `缺少/影响：${incident.suggestion || '请按健康中心建议完成配置或确认。'}`,
    faq ? `自助说明：${faq.title || faq.id}（FAQ:${faq.id}）` : null,
    '此问题归类为「客户可处理」，请门店/管理员处理，无需研发介入。',
    '入口：平台控制台 → 健康中心',
  ].filter(Boolean).join('\n');

  let notified = 0;
  const delivery = { in_app: [], feishu: [] };
  const hasNotif = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='hrms_user_notifications' LIMIT 1`
  );
  if (hasNotif.rows?.length) {
    for (const user of targets) {
      const ins = await pool.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
         VALUES ($1,$2,$3,'health_incident',$4::jsonb,$5)
         RETURNING id`,
        [
          user.username,
          title,
          message,
          JSON.stringify({
            incident_id: incident.id,
            item_key: incident.item_key,
            queue: 'customer',
            faq_id: faq?.id || incident.faq_id || null,
            channel: 'in_app',
          }),
          incident.tenant_id,
        ]
      ).catch((error) => ({ rows: [], error: error?.message }));
      if (ins.rows?.length) {
        notified += 1;
        delivery.in_app.push({ username: user.username, ok: true, id: ins.rows[0].id });
      } else {
        delivery.in_app.push({ username: user.username, ok: false, error: ins.error || 'insert_failed' });
      }
    }
  }

  let feishuSent = 0;
  let feishuFailed = 0;
  if (typeof notifiers.lookupFeishuUserByUsername === 'function' && typeof notifiers.sendLarkMessage === 'function') {
    const seen = new Set();
    for (const user of targets) {
      try {
        const feishuUser = await notifiers.lookupFeishuUserByUsername(user.username);
        const openId = String(feishuUser?.open_id || '').trim();
        if (!openId || seen.has(openId)) continue;
        seen.add(openId);
        const sent = await notifiers.sendLarkMessage(openId, `${title}\n\n${message}`, { skipDedup: true })
          .catch((error) => ({ ok: false, error: error?.message }));
        if (sent?.ok) {
          feishuSent += 1;
          delivery.feishu.push({ username: user.username, open_id: openId, ok: true });
        } else {
          feishuFailed += 1;
          delivery.feishu.push({ username: user.username, open_id: openId, ok: false, error: sent?.error || 'send_failed' });
        }
      } catch (error) {
        feishuFailed += 1;
        delivery.feishu.push({ username: user.username, ok: false, error: error?.message || String(error) });
      }
    }
  }

  return {
    ok: notified > 0 || feishuSent > 0,
    action: 'notify_customer',
    notified,
    feishu_sent: feishuSent,
    feishu_failed: feishuFailed,
    targets: targets.map((target) => target.username),
    faq_id: faq?.id || null,
    delivery,
    auto_resolved: false,
    message: (notified || feishuSent)
      ? `站内 ${notified} / 飞书 ${feishuSent}（失败 ${feishuFailed}）`
      : '未找到可通知的管理员账号或投递失败（已记录工单）',
  };
}

export async function healNotifyOps(pool, incident, notifiers = {}) {
  const faq = faqForItemKey(incident.item_key);
  const queueLabels = {
    customer: '客户可处理',
    cs_ops: '客服 / 实施',
    third_party: '第三方',
    eng: '研发值班',
  };
  const queueLabel = queueLabels[incident.queue] || incident.queue;
  const text = [
    `【健康中心·${queueLabel}】`,
    `租户 ${incident.tenant_id}`,
    `${incident.severity || ''} ${incident.item_name || incident.item_key}`,
    incident.suggestion || '',
    faq ? `FAQ: ${faq.title} (${faq.id})` : '',
    `工单 #${incident.id} · 请在 platform-admin「健康」页处理`,
  ].filter(Boolean).join('\n');

  let alertResult = { ok: false };
  if (typeof notifiers.sendOpsAlert === 'function') {
    alertResult = await notifiers.sendOpsAlert(text, {
      title: `健康中心 ${queueLabel}`,
      audience: incident.queue === 'eng' ? 'eng' : 'cs',
      meta: { incident_id: incident.id, queue: incident.queue, item_key: incident.item_key },
    }).catch((error) => ({ ok: false, error: error?.message || String(error) }));
  }

  return {
    ok: !!alertResult?.ok || (alertResult?.feishuSent || 0) > 0,
    action: 'notify_ops',
    audience: incident.queue === 'eng' ? 'eng' : 'cs',
    alert: alertResult,
    auto_resolved: false,
    message: (alertResult?.feishuSent || alertResult?.ok)
      ? `已通知值班（飞书 ${alertResult.feishuSent || 0}）`
      : `值班通知未投递：${alertResult?.error || 'notifier_unavailable'}`,
  };
}

export async function healAuditDeliveryFailures(pool, incident, notifiers = {}) {
  const has = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='growth_delivery_logs' LIMIT 1`
  );
  if (!has.rows?.length) {
    return { ok: false, action: 'audit_delivery_failures', error: 'growth_delivery_logs_missing', auto_resolved: false };
  }

  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS cnt,
            MAX(created_at) AS last_at,
            MIN(COALESCE(error_message, result->>'error', payload->>'error', '')) AS sample_error
       FROM growth_delivery_logs
      WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY status
      ORDER BY cnt DESC`,
    [incident.tenant_id]
  ).catch(() => ({ rows: [] }));

  const byStatus = {};
  let total = 0;
  let failed = 0;
  for (const row of result.rows || []) {
    const count = numberOrZero(row.cnt);
    byStatus[row.status] = { count, last_at: row.last_at, sample_error: row.sample_error || null };
    total += count;
    if (['failed', 'error', 'rejected'].includes(String(row.status))) failed += count;
  }
  const failRate = total > 0 ? Math.round((failed / total) * 100) : 0;
  const summary = {
    window_days: 7,
    total,
    failed,
    fail_rate_pct: failRate,
    by_status: byStatus,
    note: '仅汇总，未自动重发短信/企微',
  };

  let alert = null;
  if (failed > 0 && typeof notifiers.sendOpsAlert === 'function') {
    alert = await notifiers.sendOpsAlert(
      [
        '【健康中心·触达失败汇总】',
        `租户 ${incident.tenant_id}`,
        `近7日失败 ${failed}/${total}（${failRate}%）`,
        `关联项：${incident.item_name || incident.item_key}`,
        '禁止自动重发；请人工核对模板/运营商/频控后决定是否补发。',
      ].join('\n'),
      { title: '触达失败汇总', audience: 'cs', meta: { incident_id: incident.id, audit: summary } }
    ).catch((error) => ({ ok: false, error: error?.message }));
  }

  return {
    ok: true,
    action: 'audit_delivery_failures',
    summary,
    alert,
    auto_resolved: false,
    message: total ? `近7日失败率 ${failRate}%（${failed}/${total}）` : '近7日无触达记录',
  };
}
