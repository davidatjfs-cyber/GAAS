/**
 * I/O for LLM health probes + admin error alerts (P2 peel from agents.js).
 */
import {
  LLM_HEALTH_PROVIDER_KEY_MAP,
  buildLlmFailureFallbackNote,
  summarizeLlmHealthResults,
} from './llm-health-scheduler-helpers.js';

export async function probeLlmProvidersBody(deps, providers) {
  const { axios, markProviderOk, markProviderFail } = deps;
  const results = [];
  for (const p of providers) {
    if (!p.apiKey) {
      results.push({ name: p.name, ok: false, error: 'API_KEY未配置' });
      continue;
    }
    try {
      const resp = await axios.post(`${p.baseUrl}/chat/completions`, {
        model: p.model,
        messages: [{ role: 'user', content: '回复OK' }],
        max_tokens: 5,
        temperature: 0,
      }, {
        headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      const content = resp.data?.choices?.[0]?.message?.content || '';
      results.push({ name: p.name, model: p.model, ok: true, reply: content.slice(0, 20) });
      markProviderOk(LLM_HEALTH_PROVIDER_KEY_MAP[p.name] || '');
    } catch (e) {
      const status = e?.response?.status || 'timeout';
      const msg = e?.response?.data?.error?.message || e?.message || '未知错误';
      results.push({ name: p.name, model: p.model, ok: false, error: `HTTP ${status}: ${msg.slice(0, 100)}` });
      // Keep double markProviderFail to preserve prior runtime behavior.
      markProviderFail(LLM_HEALTH_PROVIDER_KEY_MAP[p.name] || '');
      markProviderFail(LLM_HEALTH_PROVIDER_KEY_MAP[p.name] || '');
    }
  }
  return results;
}

export async function verifyLLMHealthBody(deps, state, options = {}) {
  const {
    isExternalEnabled,
    buildProviders,
    log,
    sendErrorAlertToAdmin,
  } = deps;

  if (!isExternalEnabled()) {
    return { allOk: false, results: [{ name: 'External', ok: false, error: 'external_disabled' }] };
  }
  const notifyOnFailure = options.notifyOnFailure !== false;
  const notifyOnRecovery = options.notifyOnRecovery !== false;
  const forceNotify = !!options.forceNotify;

  const results = await probeLlmProvidersBody(deps, buildProviders());
  const allOk = results.every((r) => r.ok);
  const summary = summarizeLlmHealthResults(results);
  const prevAllOk = state.lastAllOk;
  state.lastAllOk = allOk;
  state.lastSummary = summary;
  log.info(`[LLM-HEALTH] Startup check:\n${summary}`);

  if (!allOk && notifyOnFailure && (forceNotify || prevAllOk !== false)) {
    const fallbackNote = buildLlmFailureFallbackNote(results);
    log.error('[LLM-HEALTH] ⚠️ 部分LLM不可用，自动降级已激活');
    try {
      await sendErrorAlertToAdmin(`⚠️ 【系统告警】LLM健康检查未通过:\n${summary}${fallbackNote}\n\n请检查 API Key / 模型配置 / 网络连通性。`);
    } catch (_) { /* ignore */ }
  }
  if (allOk && notifyOnRecovery && prevAllOk === false) {
    try {
      await sendErrorAlertToAdmin(`✅ 【系统恢复】LLM健康检查已恢复正常:\n${summary}`);
    } catch (_) { /* ignore */ }
  }
  return { allOk, results };
}

export async function sendErrorAlertToAdminBody(deps, errorTracker, errorMsg) {
  const { getSharedState, lookupFeishuUserByUsername, sendLarkMessage, log, nowFn = Date.now } = deps;
  const now = nowFn();
  if (now - errorTracker.lastAlertTime < errorTracker.alertCooldownMs) return;
  errorTracker.lastAlertTime = now;
  try {
    const state = await getSharedState();
    const allUsers = [
      ...(Array.isArray(state?.employees) ? state.employees : []),
      ...(Array.isArray(state?.users) ? state.users : []),
    ];
    const recipients = allUsers.filter((u) => ['admin', 'hq_manager'].includes(String(u?.role || '').trim()));
    for (const admin of recipients) {
      const fu = await lookupFeishuUserByUsername(String(admin.username || '').trim());
      if (fu?.open_id) {
        await sendLarkMessage(
          fu.open_id,
          `🚨 系统告警\n\n${errorMsg}\n\n时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n请尽快检查服务状态。`,
          { skipDedup: true }
        );
      }
    }
  } catch (e) {
    log.error('[alert] Failed to send admin alert:', e?.message);
  }
}
