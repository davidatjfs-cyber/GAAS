/**
 * Lightweight in-process metrics (counters + duration histograms).
 * Not Prometheus — enough for logs, health introspection, and unit tests.
 */

export const METRIC_NAMES = Object.freeze({
  APPROVAL_DECIDE_DURATION_MS: 'approval.decide.duration_ms',
  HRMS_STATE_DUAL_WRITE_FAILURE: 'hrms_state.dual_write.failure',
  LLM_CALL_SUCCESS: 'llm.call.success',
  LLM_CALL_FAILURE: 'llm.call.failure',
  LLM_CALL_DURATION_MS: 'llm.call.duration_ms',
});

/** @type {Map<string, number>} */
const counters = new Map();

/** @type {Map<string, { count: number, sum: number, min: number, max: number }>} */
const histograms = new Map();

function metricKey(name, tags = {}) {
  const parts = Object.keys(tags)
    .sort()
    .map((k) => `${k}=${String(tags[k])}`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

function isDurationMetric(name) {
  return String(name).endsWith('.duration_ms') || String(name).endsWith('_ms');
}

/**
 * @param {string} name
 * @param {{ value?: number, tags?: Record<string, string|number|boolean> }} [opts]
 */
export function recordMetric(name, { value = 1, tags = {} } = {}) {
  const n = String(name || '').trim();
  if (!n) return;
  const v = Number(value);
  if (!Number.isFinite(v)) return;

  const key = metricKey(n, tags);
  if (isDurationMetric(n)) {
    const prev = histograms.get(key) || { count: 0, sum: 0, min: Infinity, max: -Infinity };
    prev.count += 1;
    prev.sum += v;
    prev.min = Math.min(prev.min, v);
    prev.max = Math.max(prev.max, v);
    histograms.set(key, prev);
    return;
  }
  counters.set(key, (counters.get(key) || 0) + v);
}

/** @returns {{ counters: Record<string, number>, histograms: Record<string, object> }} */
export function getMetricsSnapshot() {
  const histOut = {};
  for (const [key, h] of histograms) {
    histOut[key] = {
      count: h.count,
      sum: h.sum,
      min: h.min === Infinity ? null : h.min,
      max: h.max === -Infinity ? null : h.max,
      avg: h.count > 0 ? h.sum / h.count : null,
    };
  }
  return {
    counters: Object.fromEntries(counters),
    histograms: histOut,
  };
}

/** Test helper — clears all recorded metrics. */
export function resetMetrics() {
  counters.clear();
  histograms.clear();
}
