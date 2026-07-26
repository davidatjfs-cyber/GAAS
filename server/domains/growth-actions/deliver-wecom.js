/**
 * Extracted from growth-api.js executeGrowthActionRecord — P5.4.
 */
export async function deliverGrowthActionWecom(ctx) {
  const {
    pool, before, payload, storeId, campaignId, actionKey, tenantId, executionResults,
    cleanText, cleanPhone, buildActionMessage, sendWecomExternalMessage,
    upsertDeliveryLog, insertGrowthEvent, buildSmsTemplateParam, pickSmsTemplateByStore,
    globalSmsCapped, isPhoneSuppressed, sendAliyunSms, handleSmsFailure,
    isSubscribePushConfigured, postSubscribePush,
    isMemberCouponPushConfigured, postMemberCouponPush,
  } = ctx;

  const deliveryKey = `${actionKey}:${cleanText(payload.external_userid, 128)}:${Date.now()}`;
  const messageContent = buildActionMessage(before, payload);
  try {
    const sent = await sendWecomExternalMessage(pool, {
      store_id: storeId,
      external_userid: cleanText(payload.external_userid, 128),
      sender_userid: cleanText(payload.sender_userid, 128),
      content: messageContent
    });
    payload.delivery_key = deliveryKey;
    payload.provider_msg_id = sent.provider_msg_id;
    await upsertDeliveryLog(pool, {
      delivery_key: deliveryKey,
      action_key: actionKey,
      rule_key: cleanText(payload.rule_key, 128),
      customer_id: payload.customer_id,
      store_id: storeId,
      channel: 'wecom',
      external_userid: cleanText(payload.external_userid, 128),
      provider_msg_id: sent.provider_msg_id,
      status: 'sent',
      payload: { content: messageContent },
      result: sent.raw || {}
    }, tenantId);
    await insertGrowthEvent(pool, {
      event_type: 'marketing_triggered',
      customer_id: payload.customer_id,
      phone: payload.phone,
      external_userid: payload.external_userid,
      store_id: storeId,
      campaign_id: campaignId,
      channel: 'wecom',
      coupon_id: payload.coupon_id,
      idempotency_key: `marketing_triggered:${actionKey}:${sent.provider_msg_id || deliveryKey}`,
      metadata: {
        action_key: actionKey,
        rule_key: cleanText(payload.rule_key, 128),
        delivery_key: deliveryKey,
        provider_msg_id: sent.provider_msg_id,
        content: messageContent
      }
    }, tenantId);
    executionResults.real_executions.push({ type: 'wecom_message', provider_msg_id: sent.provider_msg_id || deliveryKey, status: 'sent' });
  } catch (deliveryErr) {
    executionResults.delivery_error = deliveryErr?.message || 'wecom_send_failed';
    await upsertDeliveryLog(pool, {
      delivery_key: deliveryKey,
      action_key: actionKey,
      rule_key: cleanText(payload.rule_key, 128),
      customer_id: payload.customer_id,
      store_id: storeId,
      channel: 'wecom',
      external_userid: cleanText(payload.external_userid, 128),
      status: 'failed',
      payload: { content: messageContent },
      result: {},
      error_message: deliveryErr?.message || 'wecom_send_failed'
    }, tenantId);
  }
}
