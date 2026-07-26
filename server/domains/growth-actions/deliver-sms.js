/**
 * Extracted from growth-api.js executeGrowthActionRecord — P5.4.
 */
export async function deliverGrowthActionSms(ctx) {
  const {
    pool, before: _before, payload, storeId, campaignId, actionKey, tenantId, executionResults,
    cleanText, cleanPhone, buildActionMessage: _buildActionMessage, sendWecomExternalMessage: _sendWecomExternalMessage,
    upsertDeliveryLog, insertGrowthEvent, buildSmsTemplateParam, pickSmsTemplateByStore,
    globalSmsCapped, isPhoneSuppressed, sendAliyunSms, handleSmsFailure,
    isSubscribePushConfigured: _isSubscribePushConfigured, postSubscribePush: _postSubscribePush,
    isMemberCouponPushConfigured: _isMemberCouponPushConfigured, postMemberCouponPush: _postMemberCouponPush,
  } = ctx;

  const deliveryKey = `${actionKey}:${cleanPhone(payload.phone)}:${Date.now()}`;
  const smsTplByStore = (payload.sms_template_code_by_store && typeof payload.sms_template_code_by_store === 'object')
    ? cleanText(payload.sms_template_code_by_store[storeId], 64) : '';
  const smsTemplateCode = smsTplByStore || cleanText(payload.sms_template_code, 64) || pickSmsTemplateByStore(storeId);

  const { templateParam, generatedCode, skipReason: builtSkip, smsPhone } = await buildSmsTemplateParam(pool, payload, storeId);
  let skipReason = builtSkip;

  if (!skipReason && await globalSmsCapped(pool, smsPhone, tenantId)) skipReason = 'global_capped';
  if (!skipReason && await isPhoneSuppressed(pool, smsPhone, tenantId)) skipReason = 'suppressed';

  if (skipReason) {
    executionResults.delivery_error = `sms_skipped_${skipReason}`;
    await upsertDeliveryLog(pool, {
      delivery_key: deliveryKey,
      action_key: actionKey,
      rule_key: cleanText(payload.rule_key, 128),
      customer_id: payload.customer_id,
      store_id: storeId,
      channel: 'sms',
      external_userid: '',
      status: 'skipped',
      payload: { phone: smsPhone, reason: skipReason, template_code: smsTemplateCode },
      result: {},
      error_message: skipReason === 'no_balance'
        ? `储值余额为 0，模板 ${smsTemplateCode || 'default'} 需要 balance 变量，已跳过发送`
        : skipReason === 'global_capped'
        ? `该号码近期已收过短信，触发全局短信总闸(每周最多1条)，已跳过发送`
        : `无优惠券面额，模板 ${smsTemplateCode || 'default'} 需要 value 变量，已跳过发送`
    }, tenantId);
  } else {
  try {
    const sent = await sendAliyunSms({
      phoneNumbers: smsPhone,
      templateCode: smsTemplateCode || undefined,
      templateParam
    });
    payload.delivery_key = deliveryKey;
    payload.provider_msg_id = sent.provider_msg_id;
    await upsertDeliveryLog(pool, {
      delivery_key: deliveryKey,
      action_key: actionKey,
      rule_key: cleanText(payload.rule_key, 128),
      customer_id: payload.customer_id,
      store_id: storeId,
      channel: 'sms',
      external_userid: '',
      provider_msg_id: sent.provider_msg_id,
      status: 'sent',
      // coupon_code 写入投递日志：核销回传同一短码时按 payload->>'coupon_code' 配对翻成 redeemed。
      payload: generatedCode
        ? { phone: smsPhone, template_param: templateParam, coupon_code: generatedCode }
        : { phone: smsPhone, template_param: templateParam },
      result: sent.raw || {}
    }, tenantId);
    await insertGrowthEvent(pool, {
      event_type: 'marketing_triggered',
      customer_id: payload.customer_id,
      phone: smsPhone,
      external_userid: null,
      store_id: storeId,
      campaign_id: campaignId,
      channel: 'sms',
      coupon_id: generatedCode || payload.coupon_id,
      idempotency_key: `marketing_triggered:${actionKey}:${sent.provider_msg_id || deliveryKey}`,
      metadata: {
        action_key: actionKey,
        rule_key: cleanText(payload.rule_key, 128),
        delivery_key: deliveryKey,
        provider_msg_id: sent.provider_msg_id,
        template_param: templateParam,
        ...(generatedCode ? { short_code: generatedCode } : {})
      }
    }, tenantId);
    executionResults.real_executions.push({ type: 'sms_message', provider_msg_id: sent.provider_msg_id || deliveryKey, status: 'sent' });
  } catch (deliveryErr) {
    executionResults.delivery_error = deliveryErr?.message || 'sms_send_failed';
    await upsertDeliveryLog(pool, {
      delivery_key: deliveryKey,
      action_key: actionKey,
      rule_key: cleanText(payload.rule_key, 128),
      customer_id: payload.customer_id,
      store_id: storeId,
      channel: 'sms',
      external_userid: '',
      status: 'failed',
      payload: { phone: smsPhone, template_param: templateParam },
      result: {},
      error_message: deliveryErr?.message || 'sms_send_failed'
    }, tenantId);
    await handleSmsFailure(pool, smsPhone, deliveryErr?.message, tenantId);
  }
  }
}
