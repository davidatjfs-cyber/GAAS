/**
 * WeCom external-contact message send (P4 peel from growth-api.js).
 */

/**
 * @param {{
 *   cleanText: (v: unknown, max?: number) => string,
 *   getWecomConfig: (pool: object) => Promise<object|null>,
 *   getStoreWecomConfig: (pool: object, storeId: string) => Promise<object|null>,
 *   getWecomAccessToken: (pool: object, storeId?: string) => Promise<string>,
 *   fetchFn?: typeof fetch,
 * }} deps
 */
export function createSendWecomExternalMessage(deps) {
  const {
    cleanText,
    getWecomConfig,
    getStoreWecomConfig,
    getWecomAccessToken,
    fetchFn = globalThis.fetch,
  } = deps;

  return async function sendWecomExternalMessage(pool, payload) {
    const storeId = cleanText(payload.store_id, 128);
    let config;
    if (storeId) {
      config = await getStoreWecomConfig(pool, storeId);
    }
    if (!config) {
      config = await getWecomConfig(pool);
    }
    const senderUserId = cleanText(payload.sender_userid || config?.sender_userid, 128);
    const externalUserId = cleanText(payload.external_userid, 128);
    const content = cleanText(payload.content, 1800);
    if (!senderUserId) throw new Error('missing_wecom_sender_userid');
    if (!externalUserId) throw new Error('missing_external_userid');
    if (!content) throw new Error('missing_message_content');
    const accessToken = await getWecomAccessToken(pool, storeId);
    const resp = await fetchFn(
      `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/add_msg_template?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_type: 'single',
          external_userid: [externalUserId],
          sender: senderUserId,
          allow_select: false,
          text: { content },
        }),
      }
    );
    const data = await resp.json();
    if (!resp.ok || Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'wecom_send_failed');
    return { provider_msg_id: cleanText(data?.msgid || data?.msgid_list?.[0], 255), raw: data };
  };
}
