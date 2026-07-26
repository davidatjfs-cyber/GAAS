/**
 * Checklist card + master task helpers — P5.4 peel from createSendScheduledChecklist.
 */
const DEFAULT_FORM_URLS = {
  opening:
    'https://ycnp8e71t8x8.feishu.cn/base/PtVObRtoPaMAP3stIIFc8DnJngd?table=tblxHI9ZAKONOTpp&view=vewjuqywQu',
  closing:
    'https://ycnp8e71t8x8.feishu.cn/base/PtVObRtoPaMAP3stIIFc8DnJngd?table=tblxHI9ZAKONOTpp&view=vewjuqywQu',
};

export function buildScheduledChecklistCard(config, store, configBrand, deps) {
  const {
    formatChecklistTypeLabel,
    getOpsChecklistItems,
    opsTaskReplyAuditLarkMd,
    nowFn = Date.now,
  } = deps;

  const formUrl = String(config.formUrl || '').trim() || DEFAULT_FORM_URLS[config.checkType] || '';
  const typeLabel = formatChecklistTypeLabel(config.checkType);
  const headerColor = config.checkType === 'closing' ? 'orange' : 'blue';
  const timeNow = new Date(nowFn()).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const timeWindow = Math.max(5, Math.floor(Number(config?.timeWindow) || 60));
  const deadlineAt = new Date(nowFn() + timeWindow * 60 * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const infoFields = [
    { is_short: true, text: { tag: 'lark_md', content: `**门店**\n${store.name}` } },
    { is_short: true, text: { tag: 'lark_md', content: `**品牌**\n${configBrand || store?.brand || '-'}` } },
    { is_short: true, text: { tag: 'lark_md', content: `**检查类型**\n${typeLabel}检查` } },
    { is_short: true, text: { tag: 'lark_md', content: `**发送时间**\n${timeNow}` } },
    { is_short: true, text: { tag: 'lark_md', content: `**完成时限**\n${timeWindow}分钟` } },
    { is_short: true, text: { tag: 'lark_md', content: `**截止时间**\n${deadlineAt}` } },
  ];

  const elements = [{ tag: 'div', fields: infoFields }, { tag: 'hr' }];

  if (formUrl) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: '请点击下方按钮打开检查表，逐项检查并提交：' },
    });
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📝 打开检查表' },
          type: 'primary',
          url: formUrl,
        },
      ],
    });
  } else {
    const items = getOpsChecklistItems(config.checkType, store.name, configBrand);
    const listMd = items.length
      ? items.map((it, i) => `${i + 1}. ${it}`).join('\n')
      : '请在现场完成巡检并通过聊天窗口回复检查结果（文字+照片）';
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `**检查项目：**\n${listMd}` },
    });
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: '\n💡 请直接在聊天中回复检查结果（可附照片），小年将自动记录。',
      },
    });
  }

  elements.push({ tag: 'hr' });
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: opsTaskReplyAuditLarkMd } });
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: `请在截止时间前完成提交 · 小年` }],
  });

  return {
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `📋 ${typeLabel}检查通知` },
        template: headerColor,
      },
      elements,
    },
    typeLabel,
    timeWindow,
    deadlineAt,
  };
}

export async function insertScheduledChecklistMasterTask(pool, {
  store,
  configBrand,
  username,
  targets,
  typeLabel,
  timeWindow,
  deadlineAt,
  cardResult,
  nowFn = Date.now,
  randomFn = Math.random,
  log,
}) {
  const taskId = `OPS-${new Date(nowFn()).toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(randomFn() * 10000)).padStart(4, '0')}`;
  const msgId = cardResult.data?.data?.message_id || cardResult.data?.message_id || '';

  await pool().query(
    `INSERT INTO master_tasks (
        task_id, status, source, category, store, brand,
        assignee_username, assignee_role, title, detail,
        feishu_msg_ids, dispatched_at, timeout_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW() + INTERVAL '${timeWindow} minutes')`,
    [
      taskId,
      'pending_response',
      'scheduled_checklist',
      `${typeLabel}检查`,
      store.name,
      configBrand || store?.brand || '',
      username,
      targets.find((t) => t.username === username)?.role || 'store_manager',
      `${store.name} ${typeLabel}检查通知`,
      `检查类型：${typeLabel}\n完成时限：${timeWindow}分钟\n截止时间：${deadlineAt}`,
      msgId ? JSON.stringify([msgId]) : '[]',
    ]
  );
  log.info({ msg: 'created_master_task', task_id: taskId });
}
