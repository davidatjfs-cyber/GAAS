/**
 * Master task status machine — transitions and agent ownership.
 */

export const STATUS_FLOW = {
  pending_audit: { next: ['auditing', 'pending_dispatch'], agent: 'data_auditor' },
  auditing: { next: ['pending_dispatch', 'closed'], agent: 'data_auditor' },
  pending_dispatch: { next: ['dispatched'], agent: 'master' },
  dispatched: { next: ['pending_response'], agent: 'ops_supervisor' },
  pending_response: { next: ['pending_review'], agent: 'master' },
  pending_review: { next: ['resolved', 'rejected'], agent: 'ops_supervisor' },
  resolved: { next: ['pending_settlement'], agent: 'master' },
  rejected: { next: ['closed'], agent: 'master' },
  pending_settlement: { next: ['settled'], agent: 'chief_evaluator' },
  settled: { next: ['closed'], agent: 'master' },
  closed: { next: [], agent: null },

  agent_issue_reported: { next: ['pending_review'], agent: 'master' },
  issue_assigned: { next: ['optimization_proposed'], agent: 'data_auditor' },
  optimization_proposed: {
    next: ['optimization_approved', 'optimization_rejected'],
    agent: 'master',
  },
  optimization_approved: { next: ['optimization_implemented'], agent: 'data_auditor' },
  optimization_implemented: { next: ['completed'], agent: 'master' },
  optimization_completed: { next: ['closed'], agent: 'master' },
};

/** Statuses that close a BI anomaly trigger row when source is bi_anomaly. */
export const BI_ANOMALY_CLOSE_STATUSES = new Set([
  'closed',
  'resolved',
  'settled',
  'completed',
]);

export function getStatusFlowEntry(status) {
  return STATUS_FLOW[status] ?? null;
}

export function isValidTransition(fromStatus, toStatus) {
  const flow = STATUS_FLOW[fromStatus];
  if (!flow) return false;
  return flow.next.includes(toStatus);
}

export function getAgentForStatus(status) {
  return STATUS_FLOW[status]?.agent ?? null;
}

export function getNextStatuses(status) {
  return STATUS_FLOW[status]?.next ?? [];
}

export function shouldSyncAnomalyTriggersOnClose(newStatus, taskSource) {
  return (
    BI_ANOMALY_CLOSE_STATUSES.has(newStatus) &&
    String(taskSource || '').trim() === 'bi_anomaly'
  );
}

/** SQL SET fragments for lifecycle timestamps keyed by target status. */
export function appendStatusTimestampSets(newStatus, sets) {
  if (newStatus === 'dispatched') sets.push('dispatched_at = NOW()');
  if (newStatus === 'pending_review') sets.push('responded_at = NOW()');
  if (newStatus === 'resolved' || newStatus === 'rejected') sets.push('resolved_at = NOW()');
  if (newStatus === 'settled') sets.push('settled_at = NOW()');
  if (newStatus === 'closed') sets.push('closed_at = NOW()');
}

/** All registered lifecycle status keys. */
export function listMasterTaskStatuses() {
  return Object.keys(STATUS_FLOW);
}

/** Whether a status exists in the master task state machine. */
export function isKnownMasterTaskStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_FLOW, status);
}

/** Primary happy-path chain from audit through close (excludes agent-issue branches). */
export const CORE_STATUS_CHAIN = [
  'pending_audit',
  'auditing',
  'pending_dispatch',
  'dispatched',
  'pending_response',
  'pending_review',
  'resolved',
  'pending_settlement',
  'settled',
  'closed',
];

export function isCoreStatusChainStep(fromStatus, toStatus) {
  const fromIdx = CORE_STATUS_CHAIN.indexOf(fromStatus);
  const toIdx = CORE_STATUS_CHAIN.indexOf(toStatus);
  return fromIdx >= 0 && toIdx === fromIdx + 1;
}
