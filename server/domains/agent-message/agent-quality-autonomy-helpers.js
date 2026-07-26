/**
 * Pure helpers for agent quality metrics / autonomy fingerprints (P2 peel from agents.js).
 */
import crypto from 'crypto';

export function createAgentQualityMetricsState() {
  return {
    audits: 0,
    rewrites: 0,
    failedAudits: 0,
    numericViolations: 0,
    factualBlocks: 0,
    autonomousTasks: 0,
    lastUpdatedAt: '',
  };
}

export function markQualityMetricBody(metrics, field, delta = 1) {
  if (!Object.prototype.hasOwnProperty.call(metrics, field)) return;
  metrics[field] = Number(metrics[field] || 0) + Number(delta || 0);
  metrics.lastUpdatedAt = new Date().toISOString();
}

export function buildAutonomousTaskFingerprintBody(
  { taskType, store, route, queryText },
  { normalizeStoreKey, normalizePlainText }
) {
  const raw = `${String(taskType || '').trim()}|${normalizeStoreKey(store)}|${String(route || '').trim()}|${normalizePlainText(queryText || '', 300)}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}
