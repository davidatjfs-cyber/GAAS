/**
 * agents.js bottom `createXxx({...})` wiring cluster, peeled out (P17).
 *
 * agents.js calls `wireAgentsRuntime(deps)` once at module init and assigns the
 * returned bag of APIs to its private `_foo` locals / exports. This module (and its
 * wire-*.js siblings) performs no assignment of its own and never imports agents.js
 * or index.js — deps flow one way, from agents.js in.
 *
 * Cross-references inside the original cluster were almost entirely late-bound
 * wrapper functions already defined in agents.js (e.g. `callLLM`, `routeMessage`,
 * `auditImage`) that read a private `_foo` variable at call time, not at wire time —
 * those are simply forwarded to whichever wire-*.js needs them via `deps`. The few
 * genuine same-tick value dependencies (e.g. `scheduledTaskRuntimeStatus`,
 * `opsChecklistProgress`, the BI cascade-reply object) are kept inside a single
 * wire-*.js so no ordering assumptions leak across files.
 */
import { wireAuditor } from './wire-auditor.js';
import { wireLlm } from './wire-llm.js';
import { wireBi } from './wire-bi.js';
import { wireMessage } from './wire-message.js';
import { wireBitable } from './wire-bitable.js';
import { wireScheduler } from './wire-scheduler.js';
import { wireOpsChecklist } from './wire-ops-checklist.js';
import { wireFeishu } from './wire-feishu.js';

/**
 * @param {object} deps — union of every dep referenced by wire-*.js siblings.
 * @returns {object} flat bag of wired APIs; see wire-*.js return shapes for keys.
 */
export function wireAgentsRuntime(deps) {
  return {
    ...wireAuditor(deps),
    ...wireLlm(deps),
    ...wireBi(deps),
    ...wireMessage(deps),
    ...wireBitable(deps),
    ...wireScheduler(deps),
    ...wireOpsChecklist(deps),
    ...wireFeishu(deps),
  };
}
