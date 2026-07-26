/**
 * Feishu ASR / user lookup / issue push bodies (P2 peel from agents.js).
 */

export async function recognizeLarkAudioBody(deps, messageId, fileKey) {
  const { getLarkTenantToken, axios, log } = deps;
  const token = await getLarkTenantToken();
  if (!token) return null;

  try {
    const msgResp = await axios.get(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const msgBody = msgResp.data?.data?.items?.[0]?.body || msgResp.data?.data?.body || {};
    const recognition = msgBody?.content
      ? (() => {
          try {
            const parsed = JSON.parse(msgBody.content) || {};
            return parsed?.recognition || parsed?.text || parsed?.transcript || '';
          } catch {
            return '';
          }
        })()
      : '';
    if (recognition.trim()) {
      log.info(`[feishu-asr] IM API recognition: "${recognition.trim().slice(0, 80)}"`);
      return recognition.trim();
    }
  } catch (e) {
    log.info(`[feishu-asr] IM API fallback skipped: ${e?.response?.status || e?.message}`);
  }

  try {
    const audioResp = await axios.get(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { type: 'file' },
        responseType: 'arraybuffer',
        timeout: 30000,
      }
    );
    const audioBase64 = Buffer.from(audioResp.data).toString('base64');
    log.info(`[feishu-asr] audio downloaded: ${audioResp.data.byteLength} bytes`);

    const asrPayload = {
      speech: { speech: audioBase64 },
      config: { engine_type: '16k_auto', file_id: messageId, format: 'opus' },
    };
    const asrEndpoints = [
      'https://open.feishu.cn/open-apis/speech/v1/speech/file_recognize',
      'https://open.feishu.cn/open-apis/speech_to_text/v1/speech/file_recognize',
    ];
    for (const endpoint of asrEndpoints) {
      try {
        const asrResp = await axios.post(endpoint, asrPayload, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        });
        const recognized = asrResp.data?.data?.recognition_text || asrResp.data?.data?.text || '';
        if (recognized.trim()) {
          log.info(`[feishu-asr] Speech API recognized via ${endpoint}: "${recognized.slice(0, 80)}"`);
          return recognized.trim();
        }
      } catch (ee) {
        const status = ee?.response?.status;
        if (status !== 404) throw ee;
      }
    }
  } catch (e) {
    const status = e?.response?.status;
    if (status === 404 || status === 403) {
      log.warn(`[feishu-asr] Speech API ${status} — 需在飞书开放平台开通"语音识别"权限 (speech:speech)`);
    } else {
      log.error('[feishu-asr] Speech API error:', e?.response?.data?.msg || e?.message);
    }
  }

  return null;
}

export async function replyLarkMessageBody(deps, messageId, text) {
  const { getLarkTenantToken, axios, log } = deps;
  const token = await getLarkTenantToken();
  if (!token) return { ok: false };
  try {
    const resp = await axios.post(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`,
      { msg_type: 'text', content: JSON.stringify({ text }) },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    return { ok: resp.data?.code === 0 };
  } catch (e) {
    log.error('[feishu] reply failed:', e?.message);
    return { ok: false };
  }
}

export async function lookupFeishuUserBody(deps, openId) {
  const { pool, tenantContext, getActiveTenantIds } = deps;
  try {
    for (const tenantId of await getActiveTenantIds(pool())) {
      const r = await tenantContext.run(tenantId, () =>
        pool().query('SELECT * FROM feishu_users WHERE open_id = $1 LIMIT 1', [openId])
      );
      if (r.rows?.length) return r.rows[0];
    }
    return null;
  } catch {
    return null;
  }
}

export async function getFeishuUserInfoBody(deps, openId) {
  const { getLarkTenantToken, axios, log } = deps;
  try {
    const token = await getLarkTenantToken();
    if (!token) return null;
    const resp = await axios.get(`https://open.feishu.cn/open-apis/contact/v3/users/${openId}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { user_id_type: 'open_id' },
      timeout: 8000,
    });
    return resp.data?.data?.user || null;
  } catch (e) {
    log.warn('[feishu] getFeishuUserInfo failed:', e?.message);
    return null;
  }
}

export async function tryAutoBindByNameBody(deps, openId) {
  const { getSharedState, registerFeishuUser, log } = deps;
  try {
    const feishuInfo = await getFeishuUserInfoBody(deps, openId);
    const displayName = String(feishuInfo?.name || '').trim();
    log.info(`[feishu] tryAutoBindByName: openId=${openId}, feishuName="${displayName}"`);

    const state = await getSharedState();
    const allEmp = [
      ...(Array.isArray(state?.employees) ? state.employees : []),
      ...(Array.isArray(state?.users) ? state.users : []),
    ];
    const inactive = ['resigned', 'deleted', 'inactive', 'terminated', '离职', '已删除', '已离职'];
    const active = allEmp.filter((e) => !inactive.includes(String(e?.status || '').trim().toLowerCase()));

    if (displayName) {
      const matches = active.filter((e) => String(e?.name || '').trim() === displayName);
      if (matches.length === 1) {
        const emp = matches[0];
        const regResult = await registerFeishuUser(openId, emp.username);
        if (regResult.ok) {
          log.info(`[feishu] auto-bind success: ${displayName} -> ${emp.username} (${emp.store})`);
          return regResult;
        }
      } else if (matches.length > 1) {
        log.info(`[feishu] auto-bind: multiple matches for "${displayName}" (${matches.length}), fallback to manual`);
      } else {
        log.info(`[feishu] auto-bind: no exact match for "${displayName}"`);
      }
    }

    const feishuMobile = String(feishuInfo?.mobile || '')
      .replace(/^\+86/, '')
      .replace(/\D/g, '')
      .trim();
    if (feishuMobile && feishuMobile.length >= 11) {
      const phoneMatch = active.find((e) => {
        const empPhone = String(e?.phone || '')
          .replace(/\D/g, '')
          .trim();
        return empPhone && empPhone === feishuMobile;
      });
      if (phoneMatch) {
        const regResult = await registerFeishuUser(openId, phoneMatch.username);
        if (regResult.ok) {
          log.info(
            `[feishu] auto-bind by phone success: ${feishuMobile} -> ${phoneMatch.username} (${phoneMatch.store})`
          );
          return regResult;
        }
      }
    }

    return null;
  } catch (e) {
    log.warn('[feishu] tryAutoBindByName error:', e?.message);
    return null;
  }
}

export async function lookupFeishuUserByUsernameBody(deps, username) {
  const { pool, log } = deps;
  try {
    const r = await pool().query(
      `SELECT *
       FROM feishu_users
       WHERE lower(username) = lower($1) AND registered = TRUE
         AND open_id NOT LIKE '%probe%'
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
      [username]
    );
    if (!r.rows?.[0]) {
      log.info('[feishu] lookupFeishuUserByUsername: no registered user found for', username);
    }
    return r.rows?.[0] || null;
  } catch (e) {
    log.error('[feishu] lookupFeishuUserByUsername error:', e?.message);
    return null;
  }
}

export async function pushIssueToAssigneeBody(deps, issue, message, tenantId = 'default') {
  const { getSharedState, sendLarkMessage, log } = deps;
  const recipients = [];

  if (issue.assignee_username) {
    const assignee = await lookupFeishuUserByUsernameBody(deps, issue.assignee_username);
    if (assignee?.open_id) {
      recipients.push({ openId: assignee.open_id, role: 'assignee', username: issue.assignee_username });
    }
  }

  const isHighSeverity = String(issue.severity || '').toLowerCase() === 'high';
  if (isHighSeverity) {
    try {
      const state = await getSharedState(tenantId);
      const allUsers = [
        ...(Array.isArray(state?.employees) ? state.employees : []),
        ...(Array.isArray(state?.users) ? state.users : []),
      ];

      for (const mgr of allUsers.filter((u) => u.role === 'hq_manager')) {
        const fu = await lookupFeishuUserByUsernameBody(deps, mgr.username);
        if (fu?.open_id) {
          recipients.push({ openId: fu.open_id, role: 'hq_manager', username: mgr.username });
        }
      }

      for (const adm of allUsers.filter((u) => u.role === 'admin')) {
        const fu = await lookupFeishuUserByUsernameBody(deps, adm.username);
        if (fu?.open_id) {
          recipients.push({ openId: fu.open_id, role: 'admin', username: adm.username });
        }
      }
    } catch (e) {
      log.error('[pushIssue] 查找抄送人失败:', e?.message);
    }
  }

  const results = [];
  for (const recipient of recipients) {
    try {
      let roleLabel = '';
      if (recipient.role === 'assignee') {
        roleLabel = `【OP督办】`;
      } else if (recipient.role === 'hq_manager') {
        roleLabel = `【OP督办-抄送总部营运】`;
      } else if (recipient.role === 'admin') {
        roleLabel = `【OP督办-抄送管理员】`;
      }

      const fullMessage = `${roleLabel}\n${message}`;
      const result = await sendLarkMessage(recipient.openId, fullMessage);
      results.push({ ...recipient, success: result.ok });
    } catch (e) {
      log.error(`[pushIssue] 发送给${recipient.username}失败:`, e?.message);
      results.push({ ...recipient, success: false, error: e?.message });
    }
  }

  return { issueId: issue.id, recipients: results.length, results };
}
