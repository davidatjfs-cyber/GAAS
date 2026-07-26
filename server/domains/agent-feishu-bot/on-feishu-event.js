/**
 * Feishu webhook event handler (Wave A3 peel from agents.js onFeishuEvent).
 * Ops checklist / marketing / handleAgentMessage stay injected from agents.js.
 */
import { resolveTenantIdDefault, tenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'on-feishu-event' });

/** In-memory dedup of recent event IDs (last 500). */
const _processedEvents = new Set();
const _processedEventsQueue = [];

export function markEventProcessed(eventId) {
  if (_processedEvents.size > 500) {
    const old = _processedEventsQueue.shift();
    _processedEvents.delete(old);
  }
  _processedEvents.add(eventId);
  _processedEventsQueue.push(eventId);
}

/** @internal test helper */
export function _resetProcessedEventsForTests() {
  _processedEvents.clear();
  _processedEventsQueue.length = 0;
}

export function hasProcessedEvent(eventId) {
  return _processedEvents.has(eventId);
}

/**
 * @param {object} deps
 * @returns {(body: object) => Promise<object>}
 */
export function createOnFeishuEvent(deps) {
  const {
    pool,
    lookupFeishuUser,
    tryAutoBindByName,
    registerFeishuUser,
    sendLarkMessage,
    sendLarkCard,
    getLarkImageUrl,
    recognizeLarkAudio,
    getSharedState,
    resolveBrandContextByStore,
    routeMessage,
    checkAgentPermission,
    prefixWithAgentName,
    handleAgentMessage,
    handleOpsChecklistCardAction,
    tryCaptureOpsChecklistDetailFromChat,
    tryFeishuMarketingCopyRound,
    detectOpsChecklistType,
    getTaskResponseHook,
  } = deps;

  return async function onFeishuEvent(body) {
    if (body?.type === 'url_verification' || body?.challenge) {
      log.info({ msg: 'url_verification_challenge' });
      return { challenge: body.challenge };
    }

    const header = body?.header || {};
    const event = body?.event || {};
    const eventId = String(header?.event_id || '').trim();
    const eventType = String(header?.event_type || '').trim();

    if (eventId && hasProcessedEvent(eventId)) {
      return { ok: true, dedup: true };
    }
    if (eventId) markEventProcessed(eventId);

    log.info({ msg: 'event', event_type: eventType, event_id: eventId, build: 'v176' });

    if (eventType === 'card.action.trigger') {
      return await handleOpsChecklistCardAction(event);
    }

    if (eventType === 'im.message.receive_v1') {
      const msg = event?.message || {};
      const sender = event?.sender || {};
      const msgType = String(msg?.message_type || '').trim();
      const messageId = String(msg?.message_id || '').trim();
      const parentMessageId = String(msg?.parent_id || msg?.parent_message_id || '').trim();
      const rootMessageId = String(msg?.root_id || msg?.root_message_id || '').trim();
      const chatType = String(msg?.chat_type || '').trim();
      const openId = String(sender?.sender_id?.open_id || '').trim();

      if (!openId) return { ok: true, skipped: 'no_sender' };
      if (chatType !== 'private' && chatType !== 'p2p') {
        log.info({ msg: 'skip_non_private', chat_type: chatType });
        return { ok: true, skipped: 'not_private' };
      }

      let feishuUser = await lookupFeishuUser(openId);

      if (!feishuUser || !feishuUser.registered) {
        log.info({ msg: 'user_not_registered', open_id: openId, existing: !!feishuUser });
        let inputText = '';
        if (msgType === 'text') {
          try {
            inputText = String(JSON.parse(msg?.content || '{}').text || '').trim();
          } catch {
            inputText = String(msg?.content || '').trim();
          }
        }

        const autoBind = await tryAutoBindByName(openId);
        if (autoBind?.ok) {
          const u = autoBind.user;
          await sendLarkMessage(
            openId,
            `✅ 已自动识别！${u.name || u.username}（${u.store || ''}），你好！\n\n我是HRMS智能助理，可以帮你：\n📊 查数据 — "昨天损耗多少？""差评情况？"\n📷 审图片 — 直接发照片，我帮你审核卫生/出品\n📈 看绩效 — "我这周考核分多少？"\n📖 问SOP — "外卖漏发餐具怎么赔付？"\n✋ 申诉 — "申诉昨天损耗扣分，原因是停电"\n\n正在处理您的消息...`
          );
          feishuUser = await lookupFeishuUser(openId);
          if (feishuUser?.registered) {
            log.info({ msg: 'auto_bind_ok', username: u.username });
          } else {
            return { ok: true, registered: true, autoBound: true, username: u.username };
          }
        } else if (inputText) {
          const regResult = await registerFeishuUser(openId, inputText);
          if (regResult.ok) {
            const u = regResult.user;
            await sendLarkMessage(
              openId,
              `✅ 绑定成功！${u.name || u.username}（${u.store || ''}），你好！\n\n我是HRMS智能助理，可以帮你：\n📊 查数据 — "昨天损耗多少？""差评情况？"\n📷 审图片 — 直接发照片，我帮你审核卫生/出品\n📈 看绩效 — "我这周考核分多少？"\n📖 问SOP — "外卖漏发餐具怎么赔付？"\n✋ 申诉 — "申诉昨天损耗扣分，原因是停电"\n\n现在就可以开始对话了！`
            );
            return { ok: true, registered: true, username: u.username };
          }
          log.info({
            msg: 'register_with_text_failed',
            text: inputText.slice(0, 20),
            err: regResult.error,
          });

          try {
            await tenantContext.run('default', () =>
              pool().query(
                `INSERT INTO feishu_users (open_id, registered, tenant_id) VALUES ($1, FALSE, 'default') ON CONFLICT (open_id, tenant_id) DO NOTHING`,
                [openId]
              )
            );
          } catch {
            /* ignore */
          }

          await sendLarkMessage(
            openId,
            `你好！我是HRMS智能助理 🤖\n\n首次使用需要绑定HRMS账号。\n请输入你的HRMS用户名（登录HRMS系统时使用的用户名，如：NNYXYF26）：`
          );
          return { ok: true, pendingRegistration: true };
        } else {
          try {
            await tenantContext.run('default', () =>
              pool().query(
                `INSERT INTO feishu_users (open_id, registered, tenant_id) VALUES ($1, FALSE, 'default') ON CONFLICT (open_id, tenant_id) DO NOTHING`,
                [openId]
              )
            );
          } catch {
            /* ignore */
          }

          await sendLarkMessage(
            openId,
            `你好！我是HRMS智能助理 🤖\n\n首次使用需要绑定HRMS账号。\n请输入你的HRMS用户名（登录HRMS系统时使用的用户名，如：NNYXYF26）：`
          );
          return { ok: true, pendingRegistration: true };
        }
      }

      try {
        const _state = await getSharedState();
        const _empList = Array.isArray(_state?.employees) ? _state.employees : [];
        const _empU = String(feishuUser.username || '').trim().toLowerCase();
        const _empRec = _empList.find(
          (e) => String(e?.username || '').trim().toLowerCase() === _empU
        );
        const _inactive = [
          'resigned',
          'deleted',
          'inactive',
          'terminated',
          '离职',
          '已删除',
          '已离职',
        ];
        if (!_empRec || _inactive.includes(String(_empRec.status || '').trim().toLowerCase())) {
          const _msg = !_empRec
            ? '⚠️ 您的账号已从系统中移除，无法使用智能助理。'
            : '⚠️ 您的账号已离职，无法使用智能助理。';
          await sendLarkMessage(openId, _msg);
          try {
            await tenantContext.run(feishuUser.tenant_id || 'default', () =>
              pool().query('UPDATE feishu_users SET registered=FALSE WHERE open_id=$1', [openId])
            );
          } catch {
            /* ignore */
          }
          return { ok: true, blocked: !_empRec ? 'deleted' : 'inactive' };
        }
      } catch (_e) {
        log.error({ msg: 'status_check_error', err: String(_e?.message || _e) });
      }

      return await tenantContext.run(feishuUser.tenant_id || 'default', async () => {
        let text = '';
        let imageUrls = [];

        if (msgType === 'text') {
          try {
            text = String(JSON.parse(msg?.content || '{}').text || '').trim();
          } catch {
            text = String(msg?.content || '').trim();
          }
          if (msg?.mentions?.length) {
            for (const m of msg.mentions) {
              text = text.replace(new RegExp(`@${m.name || ''}`, 'g'), '').trim();
            }
          }
        } else if (msgType === 'image') {
          try {
            const content = JSON.parse(msg?.content || '{}');
            const imageKey = content?.image_key || '';
            if (imageKey && messageId) {
              log.info({ msg: 'downloading_image', image_key: imageKey });
              const imgUrl = await getLarkImageUrl(messageId, imageKey);
              if (imgUrl) imageUrls.push(imgUrl);
            }
          } catch (e) {
            log.error({ msg: 'parse_image_failed', err: String(e?.message || e) });
          }
        } else if (msgType === 'audio') {
          try {
            const content = JSON.parse(msg?.content || '{}');
            const fileKey = content?.file_key || '';
            if (fileKey && messageId) {
              const recognized = await recognizeLarkAudio(messageId, fileKey);
              if (recognized) {
                text = recognized;
                log.info({ msg: 'voice_to_text', preview: text.slice(0, 60) });
              } else {
                await sendLarkMessage(openId, '🎙️ 语音识别未成功，请再试一次或用文字描述。', {
                  skipDedup: true,
                });
                return { ok: true, skipped: 'asr_empty' };
              }
            } else {
              await sendLarkMessage(openId, '🎙️ 语音消息格式异常，请用文字描述你的问题。', {
                skipDedup: true,
              });
              return { ok: true, skipped: 'audio_no_filekey' };
            }
          } catch (e) {
            log.error({ msg: 'audio_parse_failed', err: String(e?.message || e) });
            await sendLarkMessage(openId, '🎙️ 语音识别服务暂时不可用，请用文字描述。', {
              skipDedup: true,
            });
            return { ok: true, skipped: 'asr_error' };
          }
        } else {
          await sendLarkMessage(
            openId,
            `收到${msgType}消息。目前支持文字和图片，请用文字描述或发送照片。`
          );
          return { ok: true, skipped: 'unsupported_type' };
        }

        const mcRound = await tryFeishuMarketingCopyRound({
          openId,
          feishuUser,
          text,
          imageUrls,
        });
        if (mcRound?.handled) return mcRound.body;

        if (!text && !imageUrls.length) return { ok: true, skipped: 'empty' };

        const detailCapture = await tryCaptureOpsChecklistDetailFromChat(
          openId,
          feishuUser,
          text,
          imageUrls
        );
        if (detailCapture?.handled) {
          return { ok: true, route: 'ops_supervisor', checklistDetailCaptured: true };
        }

        const checklistType = detectOpsChecklistType(text);
        if (msgType === 'text' && checklistType) {
          const storeName = String(feishuUser.store || '').trim();
          const typeLabel = checklistType === 'opening' ? '开市' : '收档';

          const formUrl =
            'https://ycnp8e71t8x8.feishu.cn/base/PtVObRtoPaMAP3stIIFc8DnJngd?table=tblxHI9ZAKONOTpp&view=vewjuqywQu';
          const headerColor = checklistType === 'closing' ? 'orange' : 'blue';
          const timeNow = new Date().toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          });

          const checkCard = {
            config: { wide_screen_mode: true },
            header: {
              title: { tag: 'plain_text', content: `📋 ${typeLabel}检查通知` },
              template: headerColor,
            },
            elements: [
              {
                tag: 'div',
                fields: [
                  {
                    is_short: true,
                    text: { tag: 'lark_md', content: `**门店**\n${storeName || '-'}` },
                  },
                  {
                    is_short: true,
                    text: { tag: 'lark_md', content: `**检查类型**\n${typeLabel}检查` },
                  },
                  {
                    is_short: true,
                    text: { tag: 'lark_md', content: `**时间**\n${timeNow}` },
                  },
                ],
              },
              { tag: 'hr' },
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: '请点击下方按钮打开检查表，逐项检查并提交：',
                },
              },
              {
                tag: 'action',
                actions: [
                  {
                    tag: 'button',
                    text: { tag: 'plain_text', content: '📝 打开检查表' },
                    type: 'primary',
                    url: formUrl,
                  },
                ],
              },
              { tag: 'hr' },
              {
                tag: 'note',
                elements: [{ tag: 'plain_text', content: '填写完成后系统自动确认 · 小年' }],
              },
            ],
          };

          const cardResult = await sendLarkCard(openId, checkCard);
          if (!cardResult.ok) {
            await sendLarkMessage(
              openId,
              prefixWithAgentName(
                'ops_supervisor',
                `📋 请填写${typeLabel}检查表\n\n🔗 ${formUrl}\n\n✅ 填写完成后系统会自动确认`
              )
            );
          }

          try {
            await pool().query(
              `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, routed_to, content_type, content, agent_data, tenant_id)
           VALUES ('out','feishu',$1,$2,$3,$4,'ops_supervisor','bitable_form',$5,$6::jsonb,$7)`,
              [
                openId,
                feishuUser.username,
                feishuUser.name || feishuUser.username,
                feishuUser.role || '',
                `${typeLabel}检查表（Bitable表单）`,
                JSON.stringify({ checklistType, via: 'bitable_form', formUrl }),
                resolveTenantIdDefault(),
              ]
            );
          } catch {
            /* ignore */
          }

          return { ok: true, route: 'ops_supervisor', bitableForm: true };
        }

        let msgDbId = null;
        try {
          const r = await pool().query(
            `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, content_type, content, image_urls, feishu_message_id, tenant_id)
         VALUES ('in','feishu',$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
            [
              openId,
              feishuUser.username,
              feishuUser.name,
              feishuUser.role,
              imageUrls.length ? 'image' : 'text',
              text || '',
              JSON.stringify(imageUrls),
              messageId,
              resolveTenantIdDefault(),
            ]
          );
          msgDbId = r.rows?.[0]?.id;
        } catch {
          /* ignore */
        }

        log.info({
          msg: 'task_reply_debug',
          parentMessageId,
          rootMessageId,
          text: String(text || '').slice(0, 60),
          msgKeys: Object.keys(msg),
        });
        const _effectiveParentId = parentMessageId || rootMessageId || '';
        const _isLikelyTaskResponse =
          !!_effectiveParentId ||
          imageUrls.length > 0 ||
          /^(TASK|OPS|BI|EVAL|MT)-/i.test(String(text || '').trim()) ||
          /(已处理|已完成|已整改|已解决|处理完|整改完毕|情况说明|原因如下|回复你|测试)/.test(
            String(text || '').trim()
          );
        const taskResponseHook =
          typeof getTaskResponseHook === 'function' ? getTaskResponseHook() : null;
        if (taskResponseHook && _isLikelyTaskResponse) {
          try {
            const taskResult = await taskResponseHook(
              feishuUser.username,
              text,
              imageUrls,
              _effectiveParentId
            );
            if (taskResult?.handled) {
              const reply = prefixWithAgentName('master', taskResult.response);
              await sendLarkMessage(openId, reply);
              try {
                if (msgDbId) {
                  await pool().query(
                    `UPDATE agent_messages SET routed_to='master', agent_response=$1, agent_data=$2::jsonb WHERE id=$3`,
                    [
                      taskResult.response,
                      JSON.stringify({ taskId: taskResult.taskId, route: 'master_task' }),
                      msgDbId,
                    ]
                  );
                }
              } catch {
                /* feishu task response update */
              }
              return { ok: true, route: 'master', taskId: taskResult.taskId };
            }
          } catch (e) {
            log.error({ msg: 'task_response_hook_error', err: String(e?.message || e) });
          }
        }

        const sharedState = await getSharedState();
        const brandContext = resolveBrandContextByStore(sharedState, feishuUser.store || '');

        const hasImg = Array.isArray(imageUrls) && imageUrls.length > 0;
        const preRoute = await routeMessage(text, hasImg, feishuUser.username);
        const userRole = String(feishuUser.role || '').trim();
        if (preRoute?.route && userRole) {
          const permCheck = checkAgentPermission(userRole, preRoute.route);
          if (!permCheck.allowed) {
            await sendLarkMessage(openId, `⚠️ ${permCheck.reason}`);
            return { ok: true, denied: true, route: preRoute.route, role: userRole };
          }
        }

        const _t = String(text || '').trim();
        const _isSlowRequest =
          _t.includes('行动计划') ||
          _t.includes('健康度') ||
          _t.includes('改善方案') ||
          _t.includes('因果') ||
          _t.includes('对比') ||
          _t.includes('预估') ||
          _t.includes('营业额') ||
          _t.includes('毛利') ||
          _t.includes('损耗') ||
          _t.includes('差评') ||
          _t.includes('绩效') ||
          _t.includes('考核') ||
          imageUrls.length > 0;
        if (_isSlowRequest) {
          const loadingHint =
            imageUrls.length > 0 ? '📸 收到照片，正在审核中...' : '🔍 正在为您查询，请稍候...';
          sendLarkMessage(openId, loadingHint, { skipDedup: true }).catch(() => {});
        }

        const rawResult = await handleAgentMessage(
          feishuUser.username,
          feishuUser.name || feishuUser.username,
          feishuUser.store || '',
          feishuUser.role || '',
          brandContext,
          text,
          imageUrls
        );
        const result =
          rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
            ? rawResult
            : { route: 'general', response: String(rawResult || ''), agentData: {} };

        if (result.response) {
          await sendLarkMessage(openId, prefixWithAgentName(result.route, result.response), {
            skipDedup: true,
          });
        }

        try {
          if (msgDbId) {
            await pool().query(
              `UPDATE agent_messages SET routed_to=$1, agent_response=$2, agent_data=$3::jsonb WHERE id=$4`,
              [result.route, result.response, JSON.stringify(result.agentData || {}), msgDbId]
            );
          }
        } catch {
          /* ignore */
        }

        return { ok: true, route: result.route, responded: !!result.response };
      });
    }

    return { ok: true, unhandled: eventType };
  };
}
