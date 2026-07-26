/**
 * Feishu card for task-response dispatch (pure; P2 peel from agents.js).
 */

export function buildTaskDispatchCard(task, formUrl, { isFirstDispatch = true } = {}) {
  const sev = task.severity === 'high' ? '🔴 高' : '🟡 中';
  const roleLabel = task.assignee_role === 'store_production_manager' ? '出品经理' : '店长';
  const timeNow = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const newBadge = isFirstDispatch ? '🆕 新任务 · ' : '🔄 追踪 · ';

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${newBadge}⚠️ 异常通知 [${task.task_id}]` },
      template: isFirstDispatch ? (task.severity === 'high' ? 'red' : 'orange') : 'blue',
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**门店**\n${task.store || '-'}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**品牌**\n${task.brand || '-'}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**严重程度**\n${sev}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**时间**\n${timeNow}` } },
        ],
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**异常类型**：${task.category || '-'}\n\n**详情**：${task.title || '-'}\n${task.detail || ''}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `${roleLabel}您好，请点击下方按钮打开回复表单，说明原因并提交整改措施：`,
        },
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '📝 填写回复表单' },
            type: 'primary',
            url: formUrl,
          },
        ],
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `任务编号：${task.task_id} · 请在表单中填写回复说明和上传整改照片 · 小年`,
          },
        ],
      },
    ],
  };
}
