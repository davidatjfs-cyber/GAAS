/**
 * Channel delivery dispatcher for growth action execution — P5.4.
 */
import { deliverGrowthActionWecom } from './deliver-wecom.js';
import { deliverGrowthActionSms } from './deliver-sms.js';
import { deliverGrowthActionSubscribe } from './deliver-subscribe.js';
import { deliverGrowthActionMember } from './deliver-member.js';

export async function deliverGrowthActionChannels(ctx) {
  const { payload, cleanText, cleanPhone } = ctx;
  const channel = cleanText(payload.channel || '', 80);
  if (channel === 'wecom' && cleanText(payload.external_userid, 128)) {
    await deliverGrowthActionWecom(ctx);
  } else if (channel === 'sms' && cleanPhone(payload.phone)) {
    await deliverGrowthActionSms(ctx);
  } else if (channel === 'subscribe' && (cleanPhone(payload.phone) || cleanText(payload.openid || '', 128))) {
    await deliverGrowthActionSubscribe(ctx);
  } else if (channel === 'member' && (cleanPhone(payload.phone) || cleanText(payload.openid || '', 128))) {
    await deliverGrowthActionMember(ctx);
  }
}
