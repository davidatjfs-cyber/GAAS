/** KeruYun / 客如云 POS 字段解析（ingest + feishu-sync 共用） */

const CN_OFFSET = 8 * 60 * 60 * 1000;

export function parseKeruyunDateTime(val) {
  if (!val) return null;
  const n = Number(val);
  if (Number.isFinite(n) && n > 1e12) {
    return new Date(n).toISOString();
  }
  const s = String(val).trim().replace(/：/g, ':');
  const m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})[日]?\s*(\d{1,2})?[：:]?(\d{1,2})?/);
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${(m[4] || '0').padStart(2, '0')}:${(m[5] || '0').padStart(2, '0')}:00`;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function cnDate(val) {
  if (!val) return null;
  const ts = Number(val);
  if (Number.isFinite(ts) && ts > 1e12) {
    return new Date(ts + CN_OFFSET).toISOString().slice(0, 10);
  }
  const dt = parseKeruyunDateTime(val);
  if (dt) return new Date(new Date(dt).getTime() + CN_OFFSET).toISOString().slice(0, 10);
  const s = String(val).trim().replace(/[\/年]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  return s || null;
}

export function parseKeruyunPhone(val) {
  if (!val || val === '-') return '';
  return String(val).replace(/[^0-9+]/g, '').slice(0, 32);
}

export function parseNum(val) {
  const n = Number(String(val || '').replace(/[,，\s¥￥]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
