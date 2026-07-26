/**
 * Deterministic daily_reports BI reply (Wave A5a peel from agents.js).
 */
import { buildBiDeterministicDailyReportReplyBody } from './build-daily-report-reply-helpers.js';

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicDailyReportReply(deps) {
  return async function buildBiDeterministicDailyReportReply(store, text) {
    return buildBiDeterministicDailyReportReplyBody(deps, store, text);
  };
}
