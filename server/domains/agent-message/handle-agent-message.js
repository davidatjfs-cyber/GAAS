/**
 * handleAgentMessage orchestration shell (Wave A2a).
 * data_auditor case body stays in agents.js and is injected as handleDataAuditorCase.
 */
import { setSessionState } from '../../data-executor.js';
import { childLogger } from '../../utils/logger.js';
import { finalizeAgentMessage } from './handle-agent-message-finalize.js';
import {
  fetchActiveTaskContext,
  loadOrInitSessionState,
  maybeInheritGeneralRoute,
  resolveMessageStore,
  tryPreRouteEarlyReturns,
} from './handle-agent-message-prep.js';
import { dispatchAgentMessageRoute } from './handle-agent-message-routes.js';

const log = childLogger({ domain: 'agent-message', handler: 'handle-agent-message' });

/**
 * @param {object} params
 * @param {object} deps
 * @returns {Promise<any>}
 */
export async function runHandleAgentMessage(params, deps) {
  const {
    senderUsername,
    senderName,
    senderStore,
    senderRole,
    senderBrandContext,
    text,
    imageUrls,
  } = params;
  const { pool, routeMessage, prefixWithAgentName, getBrandRuntimeConfig, getSharedState } = deps;

  const hasImage = Array.isArray(imageUrls) && imageUrls.length > 0;
  let routeRes = await routeMessage(text, hasImage, senderUsername);
  let route = routeRes.route;

  if (route === 'clarify') {
    return prefixWithAgentName('master', routeRes.message || '请问您具体想咨询哪个方面的问题？');
  }

  let sessionState = await loadOrInitSessionState(senderUsername);
  let store = await resolveMessageStore(pool, senderStore, text);
  const activeTaskContext = await fetchActiveTaskContext(pool, senderUsername);

  route = await maybeInheritGeneralRoute(pool, senderUsername, route, text);

  const preRouteHit = await tryPreRouteEarlyReturns(
    { text, senderRole, senderUsername, store, route, prefixWithAgentName },
    deps
  );
  if (preRouteHit != null) return preRouteHit;

  const brand = String(senderBrandContext?.brandName || '').trim();
  const brandId = String(senderBrandContext?.brandId || '').trim();
  const brandTag = brandId ? `brand:${brandId}` : '';
  const brandConfig = getBrandRuntimeConfig(await getSharedState(), senderBrandContext);

  sessionState.route = route;
  sessionState.intent = routeRes.intent || sessionState.intent;
  sessionState.store = store || sessionState.store;
  if (routeRes.time_range) sessionState.time_range = routeRes.time_range;
  setSessionState(senderUsername, sessionState).catch(() => {});

  let response = '';
  let agentData = { route, brandId, brandConfig };

  try {
    const routed = await dispatchAgentMessageRoute(
      {
        text,
        route,
        routeRes,
        hasImage,
        imageUrls,
        store,
        brand,
        brandId,
        brandConfig,
        brandTag,
        senderRole,
        senderUsername,
        senderName,
        sessionState,
        activeTaskContext,
      },
      deps
    );
    response = routed.response;
    agentData = routed.agentData;
  } catch (e) {
    log.error({ msg: 'handle_agent_message_error', err: String(e?.message || e) });
    response = '抱歉，处理消息时出现错误，请稍后重试。';
    agentData = { route, error: String(e?.message || e) };
  }

  return finalizeAgentMessage(
    {
      text,
      route,
      response,
      agentData,
      senderUsername,
      senderRole,
      store,
      brand,
      sessionState,
    },
    deps
  );
}

/**
 * @param {object} deps
 * @returns {(senderUsername: string, senderName: string, senderStore: string, senderRole: string, senderBrandContext: any, text: string, imageUrls: any) => Promise<any>}
 */
export function createHandleAgentMessage(deps) {
  return async function handleAgentMessage(
    senderUsername,
    senderName,
    senderStore,
    senderRole,
    senderBrandContext,
    text,
    imageUrls
  ) {
    return runHandleAgentMessage(
      {
        senderUsername,
        senderName,
        senderStore,
        senderRole,
        senderBrandContext,
        text,
        imageUrls,
      },
      deps
    );
  };
}
