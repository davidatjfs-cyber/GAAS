import { resolveTenantIdDefault } from '../../utils/database.js';

const FORM_URL =
  'https://ycnp8e71t8x8.feishu.cn/base/PtVObRtoPaMAP3stIIFc8DnJngd?table=tblxHI9ZAKONOTpp&view=vewjuqywQu';

export function buildOpsChecklistCard({ checklistType, storeName }) {
  const typeLabel = checklistType === 'opening' ? '开市' : '收档';
  const headerColor = checklistType === 'closing' ? 'orange' : 'blue';
  const timeNow = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    typeLabel,
    formUrl: FORM_URL,
    card: {
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
              url: FORM_URL,
            },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [{ tag: 'plain_text', content: '填写完成后系统自动确认 · 小年' }],
        },
      ],
    },
  };
}

/**
 * @param {object} deps
 * @param {{ openId: string, feishuUser: object, text: string, msgType: string, checklistType: string }} ctx
 */
export async function sendOpsChecklistBitableForm(deps, { openId, feishuUser, text: _text, msgType, checklistType }) {
  const { sendLarkCard, sendLarkMessage, prefixWithAgentName, pool } = deps;

  if (msgType !== 'text' || !checklistType) return null;

  const storeName = String(feishuUser.store || '').trim();
  const { typeLabel, formUrl, card } = buildOpsChecklistCard({ checklistType, storeName });

  const cardResult = await sendLarkCard(openId, card);
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
