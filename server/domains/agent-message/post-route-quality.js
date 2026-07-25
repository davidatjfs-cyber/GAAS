/**
 * handleAgentMessage 路由后：事实护栏 → 统一质检门 → evidence 元数据。
 */
import {
  applyFactDemandGuardrail,
  enrichAgentEvidenceMeta,
} from './quality-helpers.js';

/**
 * @param {{
 *   text: string,
 *   route: string,
 *   response: string,
 *   agentData: object,
 *   senderUsername: string,
 *   senderRole: string,
 *   store: string,
 *   brand: string,
 * }} ctx
 * @param {{
 *   markQualityMetric: (field: string, delta?: number) => void,
 *   enforceUnifiedQualityGate: (args: object) => Promise<{ response: string, agentData: object }>,
 * }} deps
 * @returns {Promise<{ response: string, agentData: object, evidence: object }>}
 */
export async function applyPostRouteQualityGates(ctx, deps) {
  let { response, agentData } = applyFactDemandGuardrail(
    { text: ctx.text, response: ctx.response, agentData: ctx.agentData },
    { markQualityMetric: deps.markQualityMetric }
  );

  try {
    const qg = await deps.enforceUnifiedQualityGate({
      userQuery: ctx.text,
      route: ctx.route,
      response,
      agentData,
      senderUsername: ctx.senderUsername,
      senderRole: ctx.senderRole,
      store: ctx.store,
      brand: ctx.brand,
    });
    response = qg.response;
    agentData = qg.agentData;
  } catch (e) {
    console.error('[agents] enforceUnifiedQualityGate error:', e?.message || e);
  }

  return enrichAgentEvidenceMeta({
    response,
    agentData,
    route: ctx.route,
    store: ctx.store,
    brand: ctx.brand,
  });
}
