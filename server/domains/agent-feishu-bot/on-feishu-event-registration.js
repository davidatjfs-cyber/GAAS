import { tenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'on-feishu-event-registration' });

function parseTextContent(msg) {
  if (String(msg?.message_type || '').trim() !== 'text') return '';
  try {
    return String(JSON.parse(msg?.content || '{}').text || '').trim();
  } catch {
    return String(msg?.content || '').trim();
  }
}

async function insertPendingFeishuUser(deps, openId) {
  const { pool } = deps;
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
}

async function sendRegistrationPrompt(deps, openId) {
  const { sendLarkMessage } = deps;
  await sendLarkMessage(
    openId,
    `你好！我是HRMS智能助理 🤖\n\n首次使用需要绑定HRMS账号。\n请输入你的HRMS用户名（登录HRMS系统时使用的用户名，如：NNYXYF26）：`
  );
  return { ok: true, pendingRegistration: true };
}

const WELCOME_AFTER_BIND =
  '我是HRMS智能助理，可以帮你：\n📊 查数据 — "昨天损耗多少？""差评情况？"\n📷 审图片 — 直接发照片，我帮你审核卫生/出品\n📈 看绩效 — "我这周考核分多少？"\n📖 问SOP — "外卖漏发餐具怎么赔付？"\n✋ 申诉 — "申诉昨天损耗扣分，原因是停电"';

/**
 * @param {object} deps
 * @param {{ openId: string, msg: object, msgType: string, existingUser?: object|null }} ctx
 */
export async function handleUnregisteredFeishuUser(deps, { openId, msg, msgType, existingUser }) {
  const { lookupFeishuUser, tryAutoBindByName, registerFeishuUser, sendLarkMessage } = deps;

  log.info({ msg: 'user_not_registered', open_id: openId, existing: !!existingUser });
  const inputText = parseTextContent({ ...msg, message_type: msgType });

  const autoBind = await tryAutoBindByName(openId);
  if (autoBind?.ok) {
    const u = autoBind.user;
    await sendLarkMessage(
      openId,
      `✅ 已自动识别！${u.name || u.username}（${u.store || ''}），你好！\n\n${WELCOME_AFTER_BIND}\n\n正在处理您的消息...`
    );
    const feishuUser = await lookupFeishuUser(openId);
    if (feishuUser?.registered) {
      log.info({ msg: 'auto_bind_ok', username: u.username });
      return { feishuUser, continue: true };
    }
    return { result: { ok: true, registered: true, autoBound: true, username: u.username } };
  }

  if (inputText) {
    const regResult = await registerFeishuUser(openId, inputText);
    if (regResult.ok) {
      const u = regResult.user;
      await sendLarkMessage(
        openId,
        `✅ 绑定成功！${u.name || u.username}（${u.store || ''}），你好！\n\n${WELCOME_AFTER_BIND}\n\n现在就可以开始对话了！`
      );
      return { result: { ok: true, registered: true, username: u.username } };
    }
    log.info({
      msg: 'register_with_text_failed',
      text: inputText.slice(0, 20),
      err: regResult.error,
    });
    await insertPendingFeishuUser(deps, openId);
    return { result: await sendRegistrationPrompt(deps, openId) };
  }

  await insertPendingFeishuUser(deps, openId);
  return { result: await sendRegistrationPrompt(deps, openId) };
}
