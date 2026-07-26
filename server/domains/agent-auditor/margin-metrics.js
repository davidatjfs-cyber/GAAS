/**
 * Margin metrics API (P2 peel from agents.js).
 */
import {
  estimateMarginMetricsForRange as estimateMarginMetricsForRangeBody,
  resolveTrustedNetMarginForAuditorIssue as resolveTrustedNetMarginForAuditorIssueBody,
} from './margin-metrics-helpers.js';

/**
 * @param {object} deps
 */
export function createMarginMetricsApi(deps) {
  return {
    estimateMarginMetricsForRange: (args) => estimateMarginMetricsForRangeBody(deps, args),
    resolveTrustedNetMarginForAuditorIssue: (storeName, startDate, endDate) =>
      resolveTrustedNetMarginForAuditorIssueBody(deps, storeName, startDate, endDate),
  };
}
