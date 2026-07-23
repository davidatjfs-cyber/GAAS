export function fmtLeaveDate(d) {
  if (!d) return '';
  const p = String(d).split('-');
  return p.length >= 3 ? `${Number(p[1])}月${Number(p[2])}日` : d;
}
