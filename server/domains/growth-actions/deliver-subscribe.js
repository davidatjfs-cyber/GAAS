/**
 * Extracted from growth-api.js executeGrowthActionRecord — P5.4.
 */
export async function deliverGrowthActionSubscribe(ctx) {
  const {
    pool, before: _before, payload, storeId, campaignId, actionKey, tenantId, executionResults,
    cleanText, cleanPhone, buildActionMessage: _buildActionMessage, sendWecomExternalMessage: _sendWecomExternalMessage,
    upsertDeliveryLog, insertGrowthEvent, buildSmsTemplateParam: _buildSmsTemplateParam, pickSmsTemplateByStore: _pickSmsTemplateByStore,
    globalSmsCapped: _globalSmsCapped, isPhoneSuppressed: _isPhoneSuppressed, sendAliyunSms: _sendAliyunSms, handleSmsFailure: _handleSmsFailure,
    isSubscribePushConfigured, postSubscribePush,
    isMemberCouponPushConfigured: _isMemberCouponPushConfigured, postMemberCouponPush: _postMemberCouponPush,
  } = ctx;

  // 订阅消息通道：POST 到云函数代发网关。订阅消息平台硬约束——只能发给已点过
  // 订阅授权且仍有剩余次数的用户，未授权云函数回 ok:false(error:'...43101...')，
  // 这里如实记录为 failed/skipped，不抛错（属业务结果非系统故障）。
  const subPhone = cleanPhone(payload.phone);
  const subOpenid = cleanText(payload.openid || '', 128);
  const templateType = (cleanText(payload.subscribe_template_type || payload.templateType || '', 40) === 'expiring') ? 'expiring' : 'received';
  const templateData = (payload.subscribe_template_data && typeof payload.subscribe_template_data === 'object')
    ? payload.subscribe_template_data
    : (payload.templateData && typeof payload.templateData === 'object' ? payload.templateData : null);
  const subPage = cleanText(payload.subscribe_page || payload.page || '', 256);
  const deliveryKey = `${actionKey}:sub:${subOpenid || subPhone}:${Date.now()}`;
  if (!isSubscribePushConfigured()) {
    executionResults.delivery_error = 'subscribe_push_not_configured';
    await upsertDeliveryLog(pool, {
      delivery_key: deliveryKey,
      action_key: actionKey,
      rule_key: cleanText(payload.rule_key, 128),
      customer_id: payload.customer_id,
      store_id: storeId,
      channel: 'subscribe',
      external_userid: '',
      status: 'skipped',
      payload: { phone: subPhone, openid: subOpenid, template_type: templateType },
      result: {},
      error_message: '未配置 HRMS_SUBSCRIBE_PUSH_URL / MINIPROGRAM_SYNC_SECRET，已跳过订阅消息发送'
    }, tenantId);
  } else {
    try {
      const pushResp = await postSubscribePush({
        phone: subPhone || undefined,
        openid: subOpenid || undefined,
        store_id: storeId,
        templateType,
        templateData: templateData || undefined,
        page: subPage || undefined
      });
      const ok = !!(pushResp.body && pushResp.body.ok);
      const providerMsgId = (pushResp.body && (pushResp.body.openid || (pushResp.body.sub_result && pushResp.body.sub_result.msgid))) || deliveryKey;
      payload.delivery_key = deliveryKey;
      await upsertDeliveryLog(pool, {
        delivery_key: deliveryKey,
        action_key: actionKey,
        rule_key: cleanText(payload.rule_key, 128),
        customer_id: payload.customer_id,
        store_id: storeId,
        channel: 'subscribe',
        external_userid: '',
        provider_msg_id: String(providerMsgId),
        status: ok ? 'sent' : 'failed',
        payload: { phone: subPhone, openid: subOpenid, template_type: templateType, template_data: templateData },
        result: pushResp.body || {},
        error_message: ok ? null : ((pushResp.body && pushResp.body.error) || `subscribe_push_http_${pushResp.httpStatus}`)
      }, tenantId);
      if (ok) {
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: payload.customer_id,
          phone: subPhone || null,
          external_userid: null,
          store_id: storeId,
          campaign_id: campaignId,
          channel: 'subscribe',
          coupon_id: payload.coupon_id,
          idempotency_key: `marketing_triggered:${actionKey}:${providerMsgId}`,
          metadata: {
            action_key: actionKey,
            rule_key: cleanText(payload.rule_key, 128),
            delivery_key: deliveryKey,
            template_type: templateType
          }
        }, tenantId);
        executionResults.real_executions.push({ type: 'subscribe_message', provider_msg_id: String(providerMsgId), status: 'sent' });
      } else {
        executionResults.delivery_error = (pushResp.body && pushResp.body.error) || `subscribe_push_http_${pushResp.httpStatus}`;
      }
    } catch (deliveryErr) {
      executionResults.delivery_error = deliveryErr?.message || 'subscribe_send_failed';
      await upsertDeliveryLog(pool, {
        delivery_key: deliveryKey,
        action_key: actionKey,
        rule_key: cleanText(payload.rule_key, 128),
        customer_id: payload.customer_id,
        store_id: storeId,
        channel: 'subscribe',
        external_userid: '',
        status: 'failed',
        payload: { phone: subPhone, openid: subOpenid, template_type: templateType },
        result: {},
        error_message: deliveryErr?.message || 'subscribe_send_failed'
      }, tenantId);
    }
  }
}
