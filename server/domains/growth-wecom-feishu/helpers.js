export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export const WECOM_STATUS_MAP = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  clicked: 'clicked',
  redeemed: 'redeemed',
};

export const WECOM_EVENT_MAP = {
  delivered: 'wecom_message_delivered',
  read: 'wecom_message_read',
  clicked: 'wecom_message_clicked',
  redeemed: 'wecom_coupon_redeemed',
};

/** Extract mainland mobile from WeCom follow_info / wechat_channels. */
export function extractWecomContactPhone(detailData) {
  let contactPhone = '';
  if (Array.isArray(detailData?.follow_info) && detailData.follow_info.length) {
    const fi = detailData.follow_info[0];
    if (fi.description) {
      const m = fi.description.match(/1[3-9]\d{9}/);
      if (m) contactPhone = m[0];
    }
  }
  if (Array.isArray(detailData?.wechat_channels)) {
    const wc = detailData.wechat_channels.find((ch) => ch.phone);
    if (wc) contactPhone = wc.phone;
  }
  return contactPhone;
}

export function resolveCallbackSecret(storeConfig, globalConfig, envSecret) {
  return cleanText(
    storeConfig?.callback_secret ||
      globalConfig?.callback_secret ||
      envSecret ||
      '',
    500
  );
}
