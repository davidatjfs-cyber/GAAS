/**
 * Task-response Bitable API (P2 peel from agents.js).
 * Factory binds shared state + deps; agents.js keeps thin re-exports.
 */
import { childLogger } from '../../utils/logger.js';
import { createInitialTaskResponseState } from './task-response-constants.js';
import { buildTaskDispatchCard as buildTaskDispatchCardPure } from './task-response-dispatch-card.js';
import {
  createBitableRecord as createBitableRecordBody,
  ensureTaskResponseBitable as ensureTaskResponseBitableBody,
  getTaskResponseFormUrl as getTaskResponseFormUrlBody,
  pollTaskResponseBitable as pollTaskResponseBitableBody,
  updateBitableRecord as updateBitableRecordBody,
  writeTaskToBitable as writeTaskToBitableBody,
} from './task-response-helpers.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'task-response' });

/**
 * @param {object} deps
 * @param {() => object} deps.pool
 * @param {object} deps.bitableConfigs
 * @param {(key: string) => Promise<string|null>} deps.getBitableTenantToken
 * @param {(configKey: string, fileToken: string) => Promise<string|null>} deps.getBitableRecordImageDownloadUrl
 * @param {(v: unknown) => string} deps.extractBitableFieldText
 * @param {() => Function|null|undefined} [deps.getTaskResponseHook]
 * @param {typeof import('axios').default} deps.axios
 */
export function createTaskResponseApi(deps) {
  const state = createInitialTaskResponseState();
  const processedIds = new Set();
  const merged = { ...deps, log };

  return {
    ensureTaskResponseBitable: () => ensureTaskResponseBitableBody(merged, state),
    createBitableRecord: (configKey, fields) => createBitableRecordBody(merged, configKey, fields),
    updateBitableRecord: (configKey, recordId, fields) =>
      updateBitableRecordBody(merged, configKey, recordId, fields),
    writeTaskToBitable: (task) => writeTaskToBitableBody(merged, state, processedIds, task),
    getTaskResponseFormUrl: (task) => getTaskResponseFormUrlBody(state, task),
    buildTaskDispatchCard: buildTaskDispatchCardPure,
    pollTaskResponseBitable: () => pollTaskResponseBitableBody(merged, state, processedIds),
    /** @internal test helper */
    _state: state,
    _processedIds: processedIds,
  };
}
