export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** Normalize store-constraints body fields (numeric clamps / JSON arrays). */
export function normalizeConstraintFields(b) {
  return {
    brand: cleanText(b.brand, 128),
    min_discount_rate: b.min_discount_rate == null ? null : Number(b.min_discount_rate),
    max_coupon_value_fen:
      b.max_coupon_value_fen == null
        ? null
        : Math.max(0, Math.floor(Number(b.max_coupon_value_fen) || 0)),
    monthly_budget_fen:
      b.monthly_budget_fen == null
        ? null
        : Math.max(0, Math.floor(Number(b.monthly_budget_fen) || 0)),
    max_touch_per_72h: Math.max(0, Math.floor(Number(b.max_touch_per_72h) || 1)),
    cooldown_hours_after_payment: Math.max(
      0,
      Math.floor(Number(b.cooldown_hours_after_payment) || 24)
    ),
    allowed_channels: b.allowed_channels || [],
    disallowed_campaign_types: b.disallowed_campaign_types || [],
    disallowed_dishes: b.disallowed_dishes || [],
    preferred_channels: b.preferred_channels || [],
    brand_voice_style: cleanText(b.brand_voice_style, 200),
    execution_notes: cleanText(b.execution_notes, 4000),
    active: b.active !== false,
  };
}

export function buildStrategyContextSummary(result) {
  return {
    has_profile: !!result.profile,
    has_constraints: !!result.constraints,
  };
}
