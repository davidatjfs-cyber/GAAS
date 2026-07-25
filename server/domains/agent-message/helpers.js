/**
 * handleAgentMessage 可单测纯逻辑（从 agents.js 外提）。
 */

/** 短回复（数字/汉字序号）可继承上一轮非 general 路由 */
export function isShortOptionReply(text) {
  const t = String(text || '').trim();
  return /^\d+$/.test(t) || /^[一二三四五六七八九十]$/.test(t);
}

/**
 * 从已知门店列表中解析用户文本提及的门店。
 * @param {string} text
 * @param {string[]} knownStores
 * @param {string} [currentStore]
 * @returns {string} 解析后的 store（可能仍是总部/空）
 */
export function resolveStoreFromKnownList(text, knownStores, currentStore = '') {
  let store = String(currentStore || '').trim();
  if (store && store !== '总部') return store;
  const txt = String(text || '');
  const list = Array.isArray(knownStores) ? knownStores.filter(Boolean) : [];
  for (const s of list) {
    if (txt.includes(s)) return s;
  }
  for (const s of list) {
    const prefix = txt.match(/(洪潮|马己仙|年年有喜)/)?.[0];
    if (prefix && s.includes(prefix)) return s;
  }
  return store || currentStore || '';
}

/**
 * 用 STORE_CANONICAL_MAP 从文本解析门店，并按品牌决定是否覆盖绑定门店。
 * @param {{
 *   text: string,
 *   boundStore: string,
 *   storeCanonicalMap: Array<{ keywords: string[], canonical: string }>,
 *   inferBrandFromStoreName: (store: string) => string|null|undefined,
 * }} opts
 * @returns {{ resolvedStore: string, textMentionedStore: string, overridden: boolean }}
 */
export function resolveStoreFromCanonicalMap(opts) {
  const text = String(opts.text || '');
  let resolvedStore = String(opts.boundStore || '').trim();
  const map = Array.isArray(opts.storeCanonicalMap) ? opts.storeCanonicalMap : [];
  let textMentionedStore = '';
  for (const entry of map) {
    for (const kw of entry.keywords || []) {
      if (new RegExp(kw, 'i').test(text)) {
        textMentionedStore = entry.canonical;
        break;
      }
    }
    if (textMentionedStore) break;
  }
  let overridden = false;
  if (textMentionedStore) {
    const mentionedBrand = opts.inferBrandFromStoreName(textMentionedStore);
    const boundBrand = opts.inferBrandFromStoreName(resolvedStore);
    if (mentionedBrand && mentionedBrand !== boundBrand) {
      resolvedStore = textMentionedStore;
      overridden = true;
    } else if (!resolvedStore || resolvedStore === '总部') {
      resolvedStore = textMentionedStore;
      overridden = true;
    }
  }
  return { resolvedStore, textMentionedStore, overridden };
}

export function brandPrefixFromText(text) {
  if (/洪潮/.test(String(text || ''))) return '洪潮';
  if (/马己仙/.test(String(text || ''))) return '马己仙';
  return null;
}

/**
 * 开市/收档/巡检检查表文案（纯逻辑；checklist 可由 brandConfig 注入）。
 * @param {{
 *   text: string,
 *   brand: string,
 *   store: string,
 *   brandChecklist?: { opening?: string[], closing?: string[] }|null,
 * }} opts
 * @returns {string} 空串表示非检查表请求
 */
export function buildOpsChecklistResponse(opts) {
  const text = String(opts.text || '');
  const brand = String(opts.brand || '').trim();
  const store = String(opts.store || '').trim();
  const db = opts.brandChecklist || null;

  if (text.includes('开市') || text.includes('开档')) {
    const items =
      db?.opening ||
      (brand === '洪潮'
        ? [
            '地面清洁无积水',
            '所有设备正常开启',
            '食材新鲜度检查',
            '餐具消毒完成',
            '灯光亮度适中',
            '背景音乐开启',
            '空调温度设置合适',
            '员工仪容仪表检查',
          ]
        : brand === '马己仙'
          ? ['地面清洁', '设备开启', '食材准备', '餐具消毒', '迎宾准备']
          : ['地面清洁', '设备开启', '食材准备', '餐具消毒']);
    return `📋 开市检查表（${brand} · ${store}）\n\n检查项目：\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n请逐项完成后拍照发送至本对话。`;
  }
  if (text.includes('收档') || text.includes('闭市') || text.includes('收市')) {
    const items =
      db?.closing ||
      (brand === '洪潮'
        ? ['食材封存', '设备关闭', '垃圾清理', '安全检查', '门窗锁好']
        : brand === '马己仙'
          ? ['食材封存', '设备关闭', '垃圾清理', '安全检查', '门窗锁好', '电源关闭']
          : ['食材封存', '设备关闭', '垃圾清理', '安全检查']);
    return `📋 收档检查表（${brand} · ${store}）\n\n检查项目：\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n请逐项完成后拍照发送至本对话。`;
  }
  if (text.includes('巡检')) {
    return `📋 营运巡检（${store}）\n\n检查项目：\n1. 大厅环境整洁\n2. 服务台规范\n3. 卫生间清洁\n4. 后厨卫生\n5. 安全设施\n\n请拍照发送至本对话。`;
  }
  return '';
}

export function isTrainingApprovalText(text, role) {
  const r = String(role || '').trim();
  return (
    String(text || '').includes('审核通过') &&
    String(text || '').includes('下发') &&
    (r === 'admin' || r === 'hr_manager')
  );
}

export function isTrainingExamStartText(text) {
  const t = String(text || '');
  return t.includes('开始考核') || t.includes('培训考核');
}

export function isTrainingExamAnswerText(text, route) {
  return (
    String(text || '').includes('1.') &&
    String(text || '').includes('2.') &&
    route === 'train_advisor'
  );
}

/** 简化评估：回答字数 > 20 视为通过（与原逻辑一致） */
export function evaluateTrainingExamAnswer(text) {
  return String(text || '').length > 20;
}

export function formatActiveTaskContext(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  return (
    '\n\n【该用户当前活跃任务】\n' +
    list
      .map(
        (t, i) =>
          `${i + 1}. [${t.severity || 'medium'}] ${t.title}（状态:${t.status}，类别:${t.category}）${
            t.detail ? '\n   详情: ' + String(t.detail).substring(0, 100) : ''
          }`
      )
      .join('\n')
  );
}
