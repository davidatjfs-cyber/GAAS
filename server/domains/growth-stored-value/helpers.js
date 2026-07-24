export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

export function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone);
  return s.slice(0, 3) + '****' + s.slice(-4);
}

export function parseCampaignCriteria(src) {
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? NaN : Math.floor(Number(v)));
  return {
    storeId: cleanText(src.store_id, 128),
    valueTier: cleanText(src.value_tier, 32),
    lifecycleStage: cleanText(src.lifecycle_stage, 32),
    minVisits: num(src.min_visits),
    maxVisits: num(src.max_visits),
    minDays: num(src.min_days),
    maxDays: num(src.max_days),
  };
}

/**
 * Aggregate Feishu bitable rows → Map(card → member snapshot).
 * Pure; bit* / mapStoreNameToId injected via helpers arg.
 */
export function aggregateStoredValueMembers(records, helpers) {
  const { bitText, bitNum, bitDateMs, bitPhone, mapStoreNameToId } = helpers;
  const byCard = new Map();
  for (const rec of records) {
    const f = (rec && rec.fields) || {};
    const card = bitText(f['卡号']).trim();
    if (!card) continue;
    const txnMs = bitDateMs(f['交易时间']) || bitDateMs(f['营业日期']) || 0;
    const type = bitText(f['交易类型']);
    const od = bitDateMs(f['营业日期']);
    const cur = byCard.get(card) || { card, latestMs: -1, consumeMs: 0, rechargeMs: 0 };
    if (txnMs >= cur.latestMs) {
      cur.latestMs = txnMs;
      cur.member_name = bitText(f['会员名称']).trim();
      cur.phone = bitPhone(f['手机号']);
      cur.level = bitText(f['会员等级'] || f['会员登记']).trim();
      cur.tags = bitText(f['人群标签']).trim();
      cur.store_id = mapStoreNameToId(bitText(f['交易门店']) || bitText(f['开卡门店']));
      cur.balance_fen = Math.round((bitNum(f['交易后-储值余额']) || 0) * 100);
    }
    if (/消费|支付/.test(type) && od > cur.consumeMs) cur.consumeMs = od;
    if (/充值|储值$/.test(type) && od > cur.rechargeMs) cur.rechargeMs = od;
    byCard.set(card, cur);
  }
  return byCard;
}
