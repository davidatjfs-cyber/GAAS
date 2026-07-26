/**
 * Ops Agent listener — dispatch notify + feedback review.
 */
import { createOpsDispatchState, processOpsDispatchNotify } from './ops-dispatch.js';
import { runOpsReviewCycle } from './ops-review.js';

export function createOpsAgentListener(deps) {
  const state = createOpsDispatchState();

  return async function opsAgentListener(tenantId = 'default') {
    let actions = 0;

    try {
      actions += await processOpsDispatchNotify(deps, state, tenantId);
    } catch (e) {
      deps.log.error('[master:ops] dispatch notify error:', e?.message);
    }

    actions += await runOpsReviewCycle(deps, tenantId);
    return actions;
  };
}
