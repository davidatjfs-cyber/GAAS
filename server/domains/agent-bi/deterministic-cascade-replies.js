/**
 * Remaining BI deterministic cascade replies (Wave A5c peel from agents.js).
 * Fact-source audit helpers stay in agents.js.
 */

import { createBuildBiDeterministicDataSourceCoverageReply } from './deterministic-cascade-data-source-coverage.js';
import { createBuildBiDeterministicTableVisitReply } from './deterministic-cascade-table-visit.js';
import { createBuildBiDeterministicOpsReportCountReply } from './deterministic-cascade-ops-report-count.js';
import {
  createBuildBiDeterministicClosingReportReply,
  createBuildBiDeterministicOpeningReportReply,
  createBuildBiDeterministicMaterialReportReply,
  createBuildBiDeterministicMeetingReportReply,
  createBuildBiDeterministicLossReportReply,
} from './deterministic-cascade-feishu-reports.js';

/**
 * @param {object} deps
 * @returns {object} named reply builders
 */
export function createDeterministicCascadeReplies(deps) {
  return {
    buildBiDeterministicDataSourceCoverageReply: createBuildBiDeterministicDataSourceCoverageReply(deps),
    buildBiDeterministicTableVisitReply: createBuildBiDeterministicTableVisitReply(deps),
    buildBiDeterministicOpsReportCountReply: createBuildBiDeterministicOpsReportCountReply(deps),
    buildBiDeterministicClosingReportReply: createBuildBiDeterministicClosingReportReply(deps),
    buildBiDeterministicOpeningReportReply: createBuildBiDeterministicOpeningReportReply(deps),
    buildBiDeterministicMaterialReportReply: createBuildBiDeterministicMaterialReportReply(deps),
    buildBiDeterministicMeetingReportReply: createBuildBiDeterministicMeetingReportReply(deps),
    buildBiDeterministicLossReportReply: createBuildBiDeterministicLossReportReply(deps),
  };
}
