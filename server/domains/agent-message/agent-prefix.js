/**
 * Agent display-name prefix for Feishu/outbound replies (P18 peel from agents.js).
 */
export const AGENT_PREFIX = {
  data_auditor: '小年',
  ops_supervisor: '小年',
  chief_evaluator: '小年',
  train_advisor: '小年',
  sop_advisor: '小年',
  appeal: '小年',
  master: '小年',
  general: '小年',
};

/**
 * @param {string} route
 * @param {string} text
 * @returns {string}
 */
export function prefixWithAgentName(route, text) {
  const prefix = AGENT_PREFIX[route] || 'HRMS';
  return `${prefix}：${text}`;
}
