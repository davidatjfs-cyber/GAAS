/**
 * Feishu webhook event handler (Wave A3 peel from agents.js onFeishuEvent).
 * Ops checklist / marketing / handleAgentMessage stay injected from agents.js.
 */
import { childLogger } from '../../utils/logger.js';
import { handleImMessageReceiveV1 } from './on-feishu-event-im-message.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'on-feishu-event' });

/** In-memory dedup of recent event IDs (last 500). */
const _processedEvents = new Set();
const _processedEventsQueue = [];

export function markEventProcessed(eventId) {
  if (_processedEvents.size > 500) {
    const old = _processedEventsQueue.shift();
    _processedEvents.delete(old);
  }
  _processedEvents.add(eventId);
  _processedEventsQueue.push(eventId);
}

/** @internal test helper */
export function _resetProcessedEventsForTests() {
  _processedEvents.clear();
  _processedEventsQueue.length = 0;
}

export function hasProcessedEvent(eventId) {
  return _processedEvents.has(eventId);
}

function handleUrlVerification(body) {
  log.info({ msg: 'url_verification_challenge' });
  return { challenge: body.challenge };
}

function parseEventHeader(body) {
  const header = body?.header || {};
  const event = body?.event || {};
  const eventId = String(header?.event_id || '').trim();
  const eventType = String(header?.event_type || '').trim();
  return { header, event, eventId, eventType };
}

function dedupeOrMarkEvent(eventId) {
  if (eventId && hasProcessedEvent(eventId)) {
    return { dedup: true, result: { ok: true, dedup: true } };
  }
  if (eventId) markEventProcessed(eventId);
  return { dedup: false };
}

/**
 * @param {object} deps
 * @returns {(body: object) => Promise<object>}
 */
export function createOnFeishuEvent(deps) {
  const { handleOpsChecklistCardAction } = deps;

  return async function onFeishuEvent(body) {
    if (body?.type === 'url_verification' || body?.challenge) {
      return handleUrlVerification(body);
    }

    const { event, eventId, eventType } = parseEventHeader(body);
    const dedupe = dedupeOrMarkEvent(eventId);
    if (dedupe.dedup) return dedupe.result;

    log.info({ msg: 'event', event_type: eventType, event_id: eventId, build: 'v176' });

    if (eventType === 'card.action.trigger') {
      return await handleOpsChecklistCardAction(event);
    }

    if (eventType === 'im.message.receive_v1') {
      return await handleImMessageReceiveV1(deps, { event });
    }

    return { ok: true, unhandled: eventType };
  };
}
