export const FALLBACK_MODEL = 'qwen-max';

const ALLOWED_MODEL_PREFIXES = ['qwen', 'deepseek', 'doubao'];

export function normalizeModelName(v, fallback = FALLBACK_MODEL) {
  const model = String(v || '').trim();
  if (!model) return fallback;
  return ALLOWED_MODEL_PREFIXES.some((x) => model.startsWith(`${x}-`)) ? model : fallback;
}

export function normalizeFrequency(v) {
  const x = String(v || '').trim();
  return ['daily', 'weekly', 'biweekly', 'monthly', 'custom'].includes(x) ? x : 'daily';
}

export function normalizeOpsType(v) {
  const raw = String(v || '').trim();
  if (!raw) return 'opening';
  return raw;
}

export function normalizeOpsStore(v) {
  return String(v || '').trim();
}

export function toFinite(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
