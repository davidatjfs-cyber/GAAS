/**
 * Push agent_issues to Feishu assignees (P2 peel from agents.js).
 */

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {Function} deps.lookupFeishuUserByUsername
 * @param {Function} deps.sendLarkCard
 * @param {Function} deps.sendLarkMessage
 * @param {Function} deps.prefixWithAgentName
 * @param {() => string} deps.resolveTenantIdDefault
 * @param {{ error: Function }} deps.log
 */
export function createPushIssuesToFeishu(deps) {
  const {
    pool,
    lookupFeishuUserByUsername,
    sendLarkCard,
    sendLarkMessage,
    prefixWithAgentName,
    resolveTenantIdDefault,
    log,
  } = deps;

  return async function pushIssuesToFeishu(tenantId = 'default') {
    try {
      const r = await pool().query(
        `SELECT ai.id, ai.title, ai.detail, ai.severity, ai.store, ai.category, ai.assignee_username
       FROM agent_issues ai
       WHERE ai.feishu_notified = FALSE AND ai.assignee_username IS NOT NULL
         AND COALESCE(ai.agent, '') <> 'data_auditor'
         AND ai.tenant_id = $1
       ORDER BY ai.created_at DESC LIMIT 20`,
        [tenantId]
      );
      if (!r.rows?.length) return 0;

      let pushed = 0;
      for (const issue of r.rows) {
        const fu = await lookupFeishuUserByUsername(issue.assignee_username);
        if (!fu?.open_id) continue;

        const sev = issue.severity === 'high' ? '🔴 高优先级' : '🟡 中优先级';
        const sevTemplate = issue.severity === 'high' ? 'red' : 'orange';
        const anomalyCard = {
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: `${sev} 异常通知` }, template: sevTemplate },
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: `**门店**：${issue.store || '-'}\n**类别**：${issue.category || '-'}` },
            },
            { tag: 'hr' },
            { tag: 'div', text: { tag: 'lark_md', content: `📋 **${issue.title}**\n\n${issue.detail || ''}` } },
            { tag: 'hr' },
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `⏰ 请在 **1小时内** 查看并回复整改措施。\n直接回复文字说明整改情况，或发送整改照片。`,
              },
            },
            { tag: 'note', elements: [{ tag: 'plain_text', content: `小年 · 异常检测` }] },
          ],
        };

        let sendResult = await sendLarkCard(fu.open_id, anomalyCard);
        if (!sendResult.ok) {
          const msg = prefixWithAgentName(
            'data_auditor',
            `${sev} 异常通知\n\n📋 ${issue.title}\n\n${issue.detail || ''}\n\n⏰ 请在1小时内查看并回复整改措施。`
          );
          sendResult = await sendLarkMessage(fu.open_id, msg);
        }
        if (sendResult.ok) {
          await pool().query(`UPDATE agent_issues SET feishu_notified = TRUE WHERE id = $1`, [issue.id]);
          pushed++;

          try {
            await pool().query(
              `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, routed_to, content_type, content, tenant_id)
             VALUES ('out','feishu',$1,$2,$3,'data_auditor','text',$4,$5)`,
              [fu.open_id, 'system', 'HRMS Agent', `${sev} 异常通知: ${issue.title}`, resolveTenantIdDefault()]
            );
          } catch {
            /* ignore */
          }
        }
      }
      return pushed;
    } catch (e) {
      log.error('[feishu] push issues failed:', e?.message);
      return 0;
    }
  };
}
