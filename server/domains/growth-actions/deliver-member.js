/**
 * Extracted from growth-api.js executeGrowthActionRecord — P5.4.
 */
export async function deliverGrowthActionMember(ctx) {
  const {
    pool, before, payload, storeId, campaignId, actionKey, tenantId, executionResults,
    cleanText, cleanPhone, buildActionMessage, sendWecomExternalMessage,
    upsertDeliveryLog, insertGrowthEvent, buildSmsTemplateParam, pickSmsTemplateByStore,
    globalSmsCapped, isPhoneSuppressed, sendAliyunSms, handleSmsFailure,
    isSubscribePushConfigured, postSubscribePush,
    isMemberCouponPushConfigured, postMemberCouponPush,
  } = ctx;

  // 小程序站内推券通道：HRMS 策略 → 云函数 growthMemberCoupon → 发券进会员卡包。
  // 只在自己的小程序里触达（不经短信/企微）。需在规则 action_payload 配 member_template_id
  // （指向小程序已建好的券模板）。未配置或网关未配则如实记 skipped，不抛错。
  const memPhone = cleanPhone(payload.phone);
  const memOpenid = cleanText(payload.openid || '', 128);
  const memberTemplateId = cleanText(payload.member_template_id || payload.template_id || '', 128);
  const deliveryKey = `${actionKey}:member:${memOpenid || memPhone}:${Date.now()}`;
  if (!isMemberCouponPushConfigured() || !memberTemplateId) {
    executionResults.delivery_error = !memberTemplateId ? 'member_template_not_set' : 'member_coupon_push_not_configured';
    await upsertDeliveryLog(pool, {
      delivery_key: deliveryKey,
      action_key: actionKey,
      rule_key: cleanText(payload.rule_key, 128),
      customer_id: payload.customer_id,
      store_id: storeId,
      channel: 'member',
      external_userid: '',
      status: 'skipped',
      payload: { phone: memPhone, openid: memOpenid, template_id: memberTemplateId },
      result: {},
      error_message: !memberTemplateId
        ? '规则未配置 member_template_id（小程序券模板ID），已跳过站内推券'
        : '未配置 HRMS_MEMBER_COUPON_PUSH_URL / MINIPROGRAM_SYNC_SECRET，已跳过站内推券'
    }, tenantId);
  } else {
    try {
      const pushResp = await postMemberCouponPush({
        phone: memPhone || undefined,
        openid: memOpenid || undefined,
        store_id: storeId,
        template_id: memberTemplateId,
        idempotency_key: deliveryKey
      });
      const ok = !!(pushResp.body && pushResp.body.ok);
      const providerMsgId = (pushResp.body && pushResp.body.voucher_id) || deliveryKey;
      payload.delivery_key = deliveryKey;
      await upsertDeliveryLog(pool, {
        delivery_key: deliveryKey,
        action_key: actionKey,
        rule_key: cleanText(payload.rule_key, 128),
        customer_id: payload.customer_id,
        store_id: storeId,
        channel: 'member',
        external_userid: '',
        provider_msg_id: String(providerMsgId),
        status: ok ? 'sent' : 'failed',
        payload: { phone: memPhone, openid: memOpenid, template_id: memberTemplateId },
        result: pushResp.body || {},
        error_message: ok ? null : ((pushResp.body && pushResp.body.error) || `member_coupon_http_${pushResp.httpStatus}`)
      }, tenantId);
      if (ok) {
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: payload.customer_id,
          phone: memPhone || null,
          external_userid: null,
          store_id: storeId,
          campaign_id: campaignId,
          channel: 'member',
          coupon_id: payload.coupon_id,
          idempotency_key: `marketing_triggered:${actionKey}:${providerMsgId}`,
          metadata: {
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            delivery_key: deliveryKey,
            template_id: memberTemplateId,
            voucher_id: String(providerMsgId)
          }
        }, tenantId);
        executionResults.real_executions.push({ type: 'member_coupon', provider_msg_id: String(providerMsgId), status: 'sent' });
      } else {
        executionResults.delivery_error = (pushResp.body && pushResp.body.error) || `member_coupon_http_${pushResp.httpStatus}`;
      }
    } catch (deliveryErr) {
      executionResults.delivery_error = deliveryErr?.message || 'member_coupon_send_failed';
      await upsertDeliveryLog(pool, {
        delivery_key: deliveryKey,
        action_key: actionKey,
        rule_key: cleanText(payload.rule_key, 128),
        customer_id: payload.customer_id,
        store_id: storeId,
        channel: 'member',
        external_userid: '',
        status: 'failed',
        payload: { phone: memPhone, openid: memOpenid, template_id: memberTemplateId },
        result: {},
        error_message: deliveryErr?.message || 'member_coupon_send_failed'
      }, tenantId);
    }
  }
}
