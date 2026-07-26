import { randomUUID } from 'crypto';
import { AGENT_FEATURE_FLAGS } from '../../agent-config-manager.js';
import { getSessionState, logExecutorEvent } from '../../data-executor.js';
import { handleHqBrainMessage } from '../../hq-planner-agent.js';
import { handleMarginMessage } from '../../margin-message-handler.js';
import { childLogger } from '../../utils/logger.js';
import { formatActiveTaskContext, isShortOptionReply } from './helpers.js';
import { tryHandleTrainingFlows } from './training-flow.js';
import { maybeInheritRecentRoute, resolveHqStoreFromText } from './store-resolve.js';

const log = childLogger({ domain: 'agent-message', handler: 'handle-agent-message-prep' });

export async function loadOrInitSessionState(senderUsername) {
  let sessionState = null;
  if (AGENT_FEATURE_FLAGS.enable_session_state) {
    try {
      sessionState = await getSessionState(senderUsername);
      if (sessionState && sessionState.created_at) {
        const ageMs = Date.now() - new Date(sessionState.created_at).getTime();
        if (ageMs > 2 * 60 * 60 * 1000 || sessionState.status === 'closed') {
          sessionState = null;
        }
      }
    } catch (e) {
      logExecutorEvent('session_state_load_error', {
        username: senderUsername,
        error: e?.message,
      });
    }
  }

  if (!sessionState) {
    sessionState = {
      task_id: randomUUID(),
      route: null,
      intent: null,
      metrics_requested: [],
      metrics_returned: [],
      metric_versions: {},
      time_range: null,
      store: null,
      status: 'active',
      created_at: new Date().toISOString(),
    };
  }

  return sessionState;
}

export async function resolveMessageStore(pool, senderStore, text) {
  let store = senderStore;
  if (!store || store === '总部') {
    store = await resolveHqStoreFromText(pool(), text, store);
  }
  return store;
}

export async function fetchActiveTaskContext(pool, senderUsername) {
  try {
    const taskR = await pool().query(
      `SELECT task_id, category, severity, title, detail, status, created_at FROM master_tasks WHERE assignee_username=$1 AND status IN ('pending','pending_response','in_progress') ORDER BY created_at DESC LIMIT 3`,
      [senderUsername]
    );
    return formatActiveTaskContext(taskR.rows);
  } catch {
    return '';
  }
}

export async function maybeInheritGeneralRoute(pool, senderUsername, route, text) {
  if (route === 'general' && isShortOptionReply(text)) {
    return maybeInheritRecentRoute(pool(), senderUsername, route);
  }
  return route;
}

/**
 * HQ brain / training / margin early exits. Returns a value to return from handleAgentMessage, or null.
 */
export async function tryPreRouteEarlyReturns(ctx, deps) {
  const { text, senderRole, senderUsername, store, route, prefixWithAgentName } = ctx;
  const { pool } = deps;

  try {
    log.info({
      msg: 'hq_brain_check',
      role: senderRole,
      text: String(text || '').slice(0, 40),
    });
    const hqResult = await handleHqBrainMessage({
      text,
      role: senderRole,
      username: senderUsername,
      store,
    });
    if (hqResult?.handled) {
      log.info({ msg: 'hq_brain_handled', preview: String(hqResult.response || '').slice(0, 60) });
      return prefixWithAgentName('master', hqResult.response || '');
    }
  } catch (e) {
    log.error({ msg: 'hq_brain_routing_error', err: String(e?.message || e) });
  }

  {
    const training = await tryHandleTrainingFlows(pool(), {
      text,
      senderRole,
      senderUsername,
      route,
    });
    if (training.handled) return training.response;
  }

  if (text.includes('毛利率') && text.includes('%')) {
    try {
      const result = await handleMarginMessage(text);
      if (result.success) {
        return `毛利率数据已收到并保存：${JSON.stringify(result)}`;
      }
    } catch (e) {
      log.error({ msg: 'margin_message_error', err: String(e?.message || e) });
    }
  }

  return null;
}
