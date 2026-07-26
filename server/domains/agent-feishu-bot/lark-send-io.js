/**
 * Feishu IM send / image / register I/O (P2 peel from agents.js).
 */
import {
  deepSanitizeFeishuCardStrings,
  sanitizePerformanceZhText,
} from './lark-send-helpers.js';

export async function sendLarkMessageBody(deps, openId, text, options = {}) {
  const {
    axios,
    getLarkTenantToken,
    deduplicateMessage,
    feishuSkipOpenIdResolveHrms,
    isOpenIdCrossAppFeishuError,
    refreshFeishuUserOpenIdForImDeliveryHrms,
    feishuOpenIdResolveDeps,
    log,
  } = deps;

  if (typeof text === 'string' && /绩效|考核|评分|总分|扣分明细|store_rating|模型/.test(text)) {
    text = sanitizePerformanceZhText(text);
  }
  if (!options.skipDedup && !deduplicateMessage(text, openId)) {
    return { ok: true, deduplicated: true };
  }

  const token = await getLarkTenantToken(options.tenantId);
  if (!token) {
    log.error('[feishu] cannot send: no token');
    return { ok: false, error: 'no_token' };
  }

  const resolveDeps = feishuOpenIdResolveDeps();
  const postTextOnce = async (rid) => {
    const ridTrim = String(rid || '').trim();
    try {
      const resp = await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        { receive_id: ridTrim, msg_type: 'text', content: JSON.stringify({ text }) },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          params: { receive_id_type: 'open_id' },
          timeout: 10000,
        }
      );
      const ok = resp.data?.code === 0;
      log.info('[feishu] message sent to', ridTrim, '→', ok ? 'ok' : resp.data?.msg);
      return { ok, data: resp.data, errText: String(resp.data?.msg || '') };
    } catch (e) {
      const d = e?.response?.data;
      log.error('[feishu] send message failed:', d || e?.message);
      const code = Number(d?.code || 0);
      const errText = String(d?.msg || e?.message || '');
      return { ok: false, data: d, errText, httpCode: code };
    }
  };

  let rid = String(openId || '').trim();
  let out = await postTextOnce(rid);
  if (!out.ok && !feishuSkipOpenIdResolveHrms()) {
    const code = Number(out.data?.code ?? out.httpCode ?? 0);
    const errStr = String(out.errText || out.data?.msg || '');
    if (isOpenIdCrossAppFeishuError(code, errStr)) {
      const fixed = await refreshFeishuUserOpenIdForImDeliveryHrms(resolveDeps, token, rid);
      if (fixed && fixed !== rid) {
        log.warn('[feishu] open_id cross app: retry text after resolve');
        out = await postTextOnce(fixed);
      }
    }
  }

  return { ok: !!out.ok, data: out.data, error: out.ok ? undefined : String(out.errText || out.data?.msg || '') };
}

export async function sendLarkCardBody(deps, openId, card, options = {}) {
  const {
    axios,
    getLarkTenantToken,
    feishuSkipOpenIdResolveHrms,
    isOpenIdCrossAppFeishuError,
    refreshFeishuUserOpenIdForImDeliveryHrms,
    feishuOpenIdResolveDeps,
    log,
  } = deps;

  try {
    deepSanitizeFeishuCardStrings(card, sanitizePerformanceZhText);
  } catch (e) {
    log.warn('[feishu] card sanitize skipped:', e?.message);
  }
  const token = await getLarkTenantToken(options.tenantId);
  if (!token) return { ok: false, error: 'no_token' };

  const resolveDeps = feishuOpenIdResolveDeps();
  const postCardOnce = async (rid) => {
    const ridTrim = String(rid || '').trim();
    try {
      const resp = await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        { receive_id: ridTrim, msg_type: 'interactive', content: JSON.stringify(card) },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          params: { receive_id_type: 'open_id' },
          timeout: 10000,
        }
      );
      const ok = resp.data?.code === 0;
      return { ok, data: resp.data, errText: String(resp.data?.msg || '') };
    } catch (e) {
      const d = e?.response?.data;
      log.error('[feishu] send card failed:', d || e?.message);
      const code = Number(d?.code || 0);
      const errText = String(d?.msg || e?.message || '');
      return { ok: false, data: d, errText, httpCode: code };
    }
  };

  let rid = String(openId || '').trim();
  let out = await postCardOnce(rid);
  if (!out.ok && !feishuSkipOpenIdResolveHrms()) {
    const code = Number(out.data?.code ?? out.httpCode ?? 0);
    const errStr = String(out.errText || out.data?.msg || '');
    if (isOpenIdCrossAppFeishuError(code, errStr)) {
      const fixed = await refreshFeishuUserOpenIdForImDeliveryHrms(resolveDeps, token, rid);
      if (fixed && fixed !== rid) {
        log.warn('[feishu] open_id cross app: retry card after resolve');
        out = await postCardOnce(fixed);
      }
    }
  }

  return { ok: !!out.ok, data: out.data, error: out.ok ? undefined : String(out.errText || out.data?.msg || '') };
}

export async function getLarkImageUrlBody(deps, messageId, imageKey) {
  const { axios, getLarkTenantToken, log } = deps;
  const token = await getLarkTenantToken();
  if (!token) return null;
  try {
    const resp = await axios.get(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { type: 'image' },
        responseType: 'arraybuffer',
        timeout: 30000,
      }
    );
    const b64 = Buffer.from(resp.data).toString('base64');
    return `data:image/jpeg;base64,${b64}`;
  } catch (e) {
    log.error('[feishu] get image failed:', e?.message);
    return null;
  }
}

export async function registerFeishuUserBody(deps, openId, username) {
  const { pool, tenantContext, getSharedState, findUserInState, resolveBrandContextByStore, log } = deps;
  const state = await getSharedState();
  const user = findUserInState(state, username);
  if (!user) return { ok: false, error: 'user_not_found' };

  const uname = String(user.username || username).trim();
  const name = String(user.name || '').trim();
  const store = String(user.store || '').trim();
  const brandCtx = resolveBrandContextByStore(state, store);
  const role = String(user.role || '').trim();

  try {
    let tenantId = 'default';
    try {
      const tr = await pool().query('SELECT tenant_id FROM users WHERE lower(username) = lower($1) LIMIT 1', [
        uname,
      ]);
      tenantId = String(tr.rows?.[0]?.tenant_id || '').trim() || 'default';
    } catch {
      /* ignore */
    }

    await tenantContext.run(tenantId, async () => {
      await pool().query(
        `UPDATE feishu_users
         SET registered = FALSE, updated_at = NOW()
         WHERE username = $1 AND open_id <> $2`,
        [uname, openId]
      );

      await pool().query(
        `INSERT INTO feishu_users (open_id, username, name, store, role, registered, tenant_id)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         ON CONFLICT (open_id, tenant_id) DO UPDATE SET username = $2, name = $3, store = $4, role = $5, registered = TRUE, updated_at = NOW()`,
        [openId, uname, name, store, role, tenantId]
      );
    });
    return {
      ok: true,
      user: { username: uname, name, store, role, brandId: brandCtx.brandId, brandName: brandCtx.brandName },
    };
  } catch (e) {
    log.error('[feishu] register user failed:', e?.message);
    return { ok: false, error: String(e?.message) };
  }
}
