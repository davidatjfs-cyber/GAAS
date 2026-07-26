/**
 * 增长方案 service 薄装配（plan/review/sweep/IO + 注入钩子）。
 */
import {
  buildPlan,
  fetchRecentComplaints,
  fetchTurnoverSnapshot,
  getClosedRounds,
  getOpenRound,
  saveQueryHistory,
  suggestAssignees,
} from './rounds-io.js';
import { generateReview } from './review.js';
import { runSolutionSweep, startSolutionSweepScheduler } from './sweep.js';

/**
 * @param {{ pool: () => import('pg').Pool, computeMetric: Function, log: { error: Function } }} deps
 */
export function createGrowthSolutionService(deps) {
  const { pool, computeMetric, log } = deps;

  let _notify = null;
  let _llm = null;
  let _createTrainingAssignment = null;

  async function notify(msg) {
    if (_notify) {
      try {
        await _notify(msg);
      } catch {
        /* ignore */
      }
    }
  }

  const boundGenerateReview = (round) => generateReview(pool, computeMetric, () => _llm, round);
  const boundRunSolutionSweep = () =>
    runSolutionSweep({
      getPool: pool,
      generateReview: boundGenerateReview,
      notify,
      log,
    });

  return {
    suggestAssignees: (store, role) => suggestAssignees(pool, store, role),
    saveQueryHistory: (tenantId, store, question, resultPayload, username) =>
      saveQueryHistory(pool, log, tenantId, store, question, resultPayload, username),
    fetchRecentComplaints: (store, days) => fetchRecentComplaints(pool, store, days),
    fetchTurnoverSnapshot: (store) => fetchTurnoverSnapshot(pool, store),
    buildPlan: (problemKey, store, currentDetail) => buildPlan(pool, store, problemKey, currentDetail),
    getOpenRound: (store, problemKey) => getOpenRound(pool, store, problemKey),
    getClosedRounds: (store, problemKey) => getClosedRounds(pool, store, problemKey),
    generateReview: boundGenerateReview,
    runSolutionSweep: boundRunSolutionSweep,
    startSolutionSweepScheduler: () => startSolutionSweepScheduler(boundRunSolutionSweep),
    setSolutionNotifier: (fn) => {
      _notify = fn;
    },
    setSolutionLLM: (fn) => {
      _llm = fn;
    },
    setTrainingAssigner: (fn) => {
      _createTrainingAssignment = fn;
    },
    getLlm: () => _llm,
    getTrainingAssigner: () => _createTrainingAssignment,
    notify,
  };
}
