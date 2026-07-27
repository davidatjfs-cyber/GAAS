/**
 * A/B 测试指标定义/求值等纯函数（从 growth-ab/service 外提）。
 */
import { cleanText } from '../growth-phase-auth.js';
import { AB_TEMPLATES } from './ab-templates.js';

export function sanitizeMetricDef(m, allowedKeys) {
  if (!m || typeof m !== 'object') return null;
  const num = Array.isArray(m.num) ? m.num.map((k) => cleanText(k, 40)).filter((k) => allowedKeys.includes(k)) : [];
  if (!num.length) return null;
  const den = m.den ? cleanText(m.den, 40) : null;
  if (den && !allowedKeys.includes(den)) return null;
  const fmt = ['pct', 'money', 'x', 'int'].includes(m.format) ? m.format : (den ? 'pct' : 'int');
  return { key: cleanText(m.key || 'primary', 40), label: cleanText(m.label || '主指标', 40), num, den, format: fmt };
}

export function sanitizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => ({
    key: cleanText(f.key || f.label, 40).replace(/[^a-zA-Z0-9_]/g, '') || ('f' + Math.random().toString(36).slice(2, 7)),
    label: cleanText(f.label || f.key, 40),
    type: ['int', 'money'].includes(f.type) ? f.type : 'int'
  })).filter((f) => f.key && f.label).slice(0, 12);
}

export function evalAbMetric(agg, def) {
  if (!def) return 0;
  const num = (def.num || []).reduce((s, k) => s + Number(agg[k] || 0), 0);
  if (!def.den) return Number(num.toFixed(2));
  const den = Number(agg[def.den] || 0);
  if (den <= 0) return 0;
  const v = num / den;
  return def.format === 'pct' ? Number(v.toFixed(4)) : Number(v.toFixed(2));
}

export function stableVariant(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h) % 2 === 0 ? 'A' : 'B';
}

export function interpolateAbContent(template, customer) {
  const name = cleanText(customer?.name || customer?.member_name || '', 40) || '您';
  return String(template || '').replace(/\{姓名\}/g, name).replace(/\{name\}/gi, name);
}

export function formatPercent(n, digits = 2) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0.00%';
  return `${v.toFixed(digits)}%`;
}

export function abMetricValue(v, metric) {
  const sent = Number(v?.sent || 0);
  switch (cleanText(metric, 40)) {
    case 'click_rate':
    case 'response_rate':
      return sent > 0 ? Number((Number(v?.clicks || 0) / sent).toFixed(4)) : 0;
    case 'revenue':
      return Number(v?.revenue || 0);
    case 'revenue_per_order':
      return Number(v?.revenue_per_order || 0);
    case 'redemption_rate':
    default:
      return Number(v?.redemption_rate || 0);
  }
}

export function isAbManualInput(task) {
  return !!cleanText(task?.target_rule_key, 200) || !!(task?.metrics_schema && typeof task.metrics_schema === 'object');
}

export function listAbTemplates() {
  return AB_TEMPLATES;
}
