/**
 * 请款基础配置：仍住在 hrms_state，但禁止经 PUT /api/state 覆盖。
 * 读写走 GET/PUT /api/payment-config。
 */

function cleanList(arr) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((x) => {
    const s = String(x || '').trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
}

export function normalizePaymentSettings(ps) {
  const v = ps && typeof ps === 'object' && !Array.isArray(ps) ? ps : {};
  const categories = Array.isArray(v.categories) ? v.categories : [];
  const payees = Array.isArray(v.payees) ? v.payees : [];
  const urgencies = Array.isArray(v.urgencies) ? v.urgencies : [];
  const payeeDetails = Array.isArray(v.payeeDetails) ? v.payeeDetails : [];
  const cleanPayeeDetails = (arr) => {
    const seen = new Set();
    const out = [];
    (arr || []).forEach((x) => {
      if (!x || typeof x !== 'object') return;
      const name = String(x.name || '').trim();
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({
        name,
        account: String(x.account || '').trim(),
        bank: String(x.bank || '').trim(),
      });
    });
    return out;
  };
  const cleanSecondary = (arr) => {
    const seen = new Set();
    const out = [];
    (arr || []).forEach((x) => {
      if (!x || typeof x !== 'object') return;
      const name = String(x.name || '').trim();
      const primary = String(x.primary || '').trim();
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ name, primary });
    });
    return out;
  };
  let primaryCategories = Array.isArray(v.primaryCategories) ? cleanList(v.primaryCategories) : [];
  let secondaryCategories = Array.isArray(v.secondaryCategories) ? cleanSecondary(v.secondaryCategories) : [];
  if (!primaryCategories.length && !secondaryCategories.length && categories.length) {
    primaryCategories = cleanList(categories);
  }
  return {
    categories: cleanList(categories),
    primaryCategories,
    secondaryCategories,
    payees: cleanList(payees),
    payeeDetails: cleanPayeeDetails(payeeDetails),
    urgencies: cleanList(urgencies.length ? urgencies : ['低', '中', '高']),
  };
}

export function normalizePaymentBudgets(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  arr.forEach((x) => {
    const store = String(x?.store || '').trim();
    const month = String(x?.month || '').trim();
    const category = String(x?.category || '').trim();
    const amount = Number(x?.amount);
    if (!store || !month || !category) return;
    if (!Number.isFinite(amount) || amount < 0) return;
    const key = `${store}__${month}__${category}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ store, month, category, amount });
  });
  return out;
}

export function loadPaymentConfigFromState(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    paymentSettings: normalizePaymentSettings(s.paymentSettings),
    paymentBudgets: normalizePaymentBudgets(s.paymentBudgets),
  };
}
