/**
 * Feishu performance text / card sanitize helpers (P2 peel from agents.js).
 */

/**
 * 飞书绩效类文本统一中文化：内部字段名、模型 key、英文「分」→「级」、通知标题改名
 */
export function sanitizePerformanceZhText(text) {
  if (typeof text !== 'string' || !text) return text;
  if (
    !/(绩效|考核|评分|总分|扣分明细|store_rating|execution_rating|attitude_rating|ability_rating|new_model|anomaly_rollups|task_reminder|模型|门店级别|门店评级)/i.test(
      text
    )
  ) {
    return text;
  }
  let t = text;
  t = t.replace(/📊\s*绩效考核通知/g, '📊 绩效考核周报');
  t = t.replace(/(^|[\n\u200b])绩效考核通知/g, '$1绩效考核周报');
  t = t.replace(/📊\s*绩效考核日报/g, '📊 绩效考核周报');
  t = t.replace(/(^|[\n\u200b])绩效考核日报/g, '$1绩效考核周报');
  t = t.replace(/📋\s*模型[：:]\s*`?new_model_monthly`?/gi, '📋 评分类型：月度自动评分');
  t = t.replace(/📋\s*模型[：:]\s*`?new_model`?/gi, '📋 评分类型：人力资源综合模型');
  t = t.replace(/\*\*📋\s*模型\*\*\s*[：:]\s*`?new_model_monthly`?/gi, '**📋 评分类型**：月度自动评分');
  t = t.replace(/\bnew_model_monthly\b/g, '月度自动评分');
  t = t.replace(/\bnew_model\b/g, '人力资源综合模型');
  t = t.replace(/\banomaly_rollups_v2\b/g, '周度异常汇总');
  t = t.replace(/\btask_reminder_v1\b/g, '任务催办绩效记录');
  t = t.replace(/\bmonthly_anomaly_bonus_v1\b/g, '月度异常免罚加分');
  t = t.replace(/\bstore_production_manager\b/g, '出品经理');
  t = t.replace(/\bstore_manager\b/g, '店长');
  t = t.replace(/\bstore_rating\b\s*[:：]\s*null\b/gi, '门店级别：待评估');
  t = t.replace(/\bstore_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '门店级别：$1级');
  t = t.replace(/\bstore_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '门店级别：$1级');
  t = t.replace(/\bexecution_rating\b\s*[:：]\s*'?(待定)'?\s*分?\b/gi, '执行力：$1');
  t = t.replace(/\bexecution_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '执行力：$1级');
  t = t.replace(/\bexecution_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '执行力：$1级');
  t = t.replace(/\battitude_rating\b\s*[:：]\s*'?(待定)'?\s*分?\b/gi, '工作态度：$1');
  t = t.replace(/\battitude_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '工作态度：$1级');
  t = t.replace(/\battitude_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '工作态度：$1级');
  t = t.replace(/\bability_rating\b\s*[:：]\s*'?(待定)'?\s*分?\b/gi, '工作能力：$1');
  t = t.replace(/\bability_rating\b\s*[:：]\s*'?(A|B|C|D)'?\s*分\b/gi, '工作能力：$1级');
  t = t.replace(/\bability_rating\b\s*[:：]\s*'?(A|B|C|D)'?\b(?!级)/gi, '工作能力：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*store_rating\s*[:：]\s*null\s*$/gim, '• 门店级别：待评估');
  t = t.replace(/^[ \t]*[•\-*]\s*store_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 门店级别：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*ability_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 工作能力：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*attitude_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 工作态度：$1级');
  t = t.replace(/^[ \t]*[•\-*]\s*execution_rating\s*[:：]\s*([A-D])\s*分?\b/gim, '• 执行力：$1级');
  return t;
}

export function deepSanitizeFeishuCardStrings(node, fn) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = fn(node[i]);
      else deepSanitizeFeishuCardStrings(node[i], fn);
    }
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') node[k] = fn(v);
      else deepSanitizeFeishuCardStrings(v, fn);
    }
  }
}

export function buildAlertCard(title, severity, detail, actions) {
  const color = severity === 'high' ? 'red' : 'orange';
  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: detail } }];
  if (actions && actions.length) {
    elements.push({
      tag: 'action',
      actions: actions.map((a) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: a.text },
        type: a.type || 'default',
        value: a.value || {},
      })),
    });
  }
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template: color },
    elements,
  };
}
