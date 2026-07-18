/**
 * SLA到期时间计算：给部署检查(1工作日)、体检期(7自然日)等共用，避免各自重写工作日逻辑。
 */
export function addBusinessDays(from, days) {
  const d = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

export function computeDueAt(from, { unit, amount }) {
  if (unit === 'business_day') return addBusinessDays(from, amount);
  const d = new Date(from);
  d.setDate(d.getDate() + amount);
  return d;
}
