/**
 * 账单账期区间：下次开票日往前推一个周期。
 * @param {string|Date|null|undefined} nextInvoiceAt
 * @param {string|null|undefined} cycle monthly|quarterly|yearly
 * @returns {{ start: Date, end: Date }|null}
 */
export function computeBillingPeriod(nextInvoiceAt, cycle) {
  const end = nextInvoiceAt ? new Date(nextInvoiceAt) : null;
  if (!end || Number.isNaN(end.getTime())) return null;
  const start = new Date(end);
  if (cycle === 'quarterly') start.setMonth(start.getMonth() - 3);
  else if (cycle === 'yearly') start.setFullYear(start.getFullYear() - 1);
  else start.setMonth(start.getMonth() - 1); // monthly 或未设置时的默认假设
  return { start, end };
}
