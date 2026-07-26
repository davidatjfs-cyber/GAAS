/**
 * Feishu bitable field value parsers (P4 peel from growth-api.js).
 */

export function bitText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x && (x.text || x.name)) || x).join(',');
  if (typeof v === 'object') return String(v.text || v.name || '');
  return String(v);
}

export function bitNum(v) {
  if (v == null) return 0;
  if (typeof v === 'object' && v.text != null) return Number(v.text) || 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function bitDateMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (!Number.isNaN(n) && n > 1e10) return n; // epoch ms
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function bitPhone(v) {
  return bitText(v).replace(/[^0-9]/g, '');
}
