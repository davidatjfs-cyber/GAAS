/**
 * Ops checklist Feishu card builders + progress helpers (P2 peel from agents.js).
 */

export function formatChecklistTypeLabel(checkType) {
  const type = String(checkType || '').trim();
  const labels = { opening: '开市', closing: '收档', hygiene: '卫生巡检', food_safety: '食安检查', equipment: '设备巡检' };
  return labels[type] || type || '巡检';
}

export function buildOpsChecklistItemDetailCard({ checkType, brandName, storeName, itemIndex, itemName, detail = {} }) {
  const typeLabel = formatChecklistTypeLabel(checkType);
  const statusLabel = detail.status === 'fail' ? '异常' : detail.status === 'pass' ? '合格' : '未选择';
  const remark = String(detail.remark || '').trim() || '未填写';
  const photoCount = Number(detail.photoCount) || 0;

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      title: { tag: 'plain_text', content: `${typeLabel}检查项填写` },
      template: 'indigo'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**门店**：${storeName || '-'}\n**品牌**：${brandName || '-'}\n**检查项**：${itemIndex + 1}. ${itemName}`
        }
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `当前状态：${statusLabel}\n说明：${remark}\n已上传照片：${photoCount} 张\n\n下一步：先点击“合格/异常”，再直接在会话发送“说明：xxx”，然后上传照片。`
        }
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '✅ 本项合格' },
            value: { action: 'ops_checklist_item_status', checkType, itemIndex: String(itemIndex), itemName, status: 'pass' }
          },
          {
            tag: 'button',
            type: 'danger',
            text: { tag: 'plain_text', content: '⚠️ 本项异常' },
            value: { action: 'ops_checklist_item_status', checkType, itemIndex: String(itemIndex), itemName, status: 'fail' }
          }
        ]
      }
    ]
  };
}

export function getOpsChecklistProgressKey(openId, checkType, storeName) {
  const day = new Date().toISOString().slice(0, 10);
  return `${openId}||${storeName || '-'}||${checkType}||${day}`;
}

export function countOpsChecklistCompleted(progress) {
  const details = progress?.itemDetails && typeof progress.itemDetails === 'object' ? progress.itemDetails : {};
  let done = 0;
  for (const v of Object.values(details)) {
    const statusOk = v && (v.status === 'pass' || v.status === 'fail');
    const remarkOk = String(v?.remark || '').trim().length > 0;
    if (statusOk && remarkOk) done += 1;
  }
  return done;
}

export function countOpsChecklistAbnormal(progress) {
  const details = progress?.itemDetails && typeof progress.itemDetails === 'object' ? progress.itemDetails : {};
  let cnt = 0;
  for (const v of Object.values(details)) {
    if (v && v.status === 'fail') cnt += 1;
  }
  return cnt;
}

export function buildOpsChecklistItemsCard(getOpsAgentConfig, { checkType, brandName, storeName, checkedIndices = new Set() }) {
  const typeLabel = formatChecklistTypeLabel(checkType);
  const items = getOpsChecklistItems(getOpsAgentConfig, checkType, storeName, brandName);
  const rows = (items.length ? items : ['现场环境检查', '设备状态检查', '安全规范检查'])
    .map((item, idx) => {
      const done = checkedIndices.has(idx);
      return {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: done ? 'primary' : 'default',
            text: { tag: 'plain_text', content: `${done ? '✅' : '⬜'} ${idx + 1}. ${item}` },
            value: { action: 'ops_checklist_item_focus', checkType, itemIndex: String(idx), itemName: item }
          }
        ]
      };
    });

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      title: { tag: 'plain_text', content: `${typeLabel}逐项勾选` },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**门店**：${storeName || '-'}\n**品牌**：${brandName || '-'}\n点击每一项完成勾选。`
        }
      },
      ...rows
    ]
  };
}

export function buildOpsChecklistAbnormalItemsCard(getOpsAgentConfig, { checkType, brandName, storeName }) {
  const typeLabel = formatChecklistTypeLabel(checkType);
  const items = getOpsChecklistItems(getOpsAgentConfig, checkType, storeName, brandName);
  const rows = (items.length ? items : ['现场环境', '设备状态', '安全规范'])
    .map((item, idx) => ({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          type: 'danger',
          text: { tag: 'plain_text', content: `⚠️ ${idx + 1}. ${item}` },
          value: { action: 'ops_checklist_abnormal_item', checkType, itemIndex: String(idx), itemName: item }
        }
      ]
    }));

  rows.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        type: 'danger',
        text: { tag: 'plain_text', content: '⚠️ 其他异常' },
        value: { action: 'ops_checklist_abnormal_item', checkType, itemIndex: '-1', itemName: '其他异常' }
      }
    ]
  });

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      title: { tag: 'plain_text', content: `${typeLabel}异常项选择` },
      template: 'red'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**门店**：${storeName || '-'}\n**品牌**：${brandName || '-'}\n请选择异常项（可多次点击提交）。`
        }
      },
      ...rows
    ]
  };
}

export function detectOpsChecklistType(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  // 含数据查询词时不触发检查表，交给 data_auditor 处理
  if (/(得分|多少|情况|平均|报告|数据|几次|几条|合格|怎么样|记录|统计|查询|查看|分数|评分|上周|上个月|昨天|今天|本周|本月|谁没|几个人|人员|缺席|未开|查一下|看看|看下)/.test(t)) return '';
  if (t.includes('开市') || t.includes('开档')) return 'opening';
  if (t.includes('收档') || t.includes('收市') || t.includes('闭市')) return 'closing';
  return '';
}

export function getOpsChecklistItems(getOpsAgentConfig, checkType, storeName = '', brandName = '') {
  const daily = getOpsAgentConfig()?.scheduledTasks?.dailyInspections || [];
  const store = String(storeName || '').trim();
  const brand = String(brandName || '').trim();
  let target = daily.find((i) => i.type === checkType && String(i?.store || '').trim() === store && store);
  if (!target) target = daily.find((i) => i.type === checkType && String(i?.brand || '').trim() === brand && brand);
  if (!target) target = daily.find(i => i.type === checkType);
  return Array.isArray(target?.checklist) ? target.checklist : [];
}

export function buildOpsChecklistCard(getOpsAgentConfig, { checkType, brandName, storeName, abnormalCount = 0, _totalCount = 0 }) {
  const typeLabel = formatChecklistTypeLabel(checkType);
  const items = getOpsChecklistItems(getOpsAgentConfig, checkType, storeName, brandName);
  const listMd = items.length
    ? items.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
    : '1. 现场环境检查\n2. 设备状态检查\n3. 安全规范检查';

  return {
    config: { wide_screen_mode: true, enable_forward: true },
    header: {
      title: { tag: 'plain_text', content: `${typeLabel}检查表（异常${abnormalCount}项）` },
      template: 'blue'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**门店**：${storeName || '-'}\n**品牌**：${brandName || '-'}\n默认全部合格，仅需选择异常项并补充说明/照片。`
        }
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `检查项：\n${listMd}` } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '✅ 直接提交（其余默认合格）' },
            value: { action: 'ops_checklist_submit', checkType }
          },
          {
            tag: 'button',
            type: 'danger',
            text: { tag: 'plain_text', content: '⚠️ 选择异常项（可多次）' },
            value: { action: 'ops_checklist_abnormal_open', checkType }
          }
        ]
      }
    ]
  };
}

export function buildOpsChecklistTemplateText(getOpsAgentConfig, { checkType, brandName, storeName }) {
  const typeLabel = formatChecklistTypeLabel(checkType);
  const items = getOpsChecklistItems(getOpsAgentConfig, checkType, storeName, brandName);
  const lines = items.length
    ? items.map((item, idx) => `${idx + 1}. ${item}: [合格/异常] 备注:[ ]`).join('\n')
    : '1. 现场环境: [合格/异常] 备注:[ ]\n2. 设备状态: [合格/异常] 备注:[ ]\n3. 安全规范: [合格/异常] 备注:[ ]';
  return `【${typeLabel}检查标准模板】\n门店: ${storeName || '-'}\n品牌: ${brandName || '-'}\n\n${lines}\n\n异常说明: [如无填 无]\n整改完成时间: [YYYY-MM-DD HH:mm]\n上传照片数量: [N]\n\n请按以上格式直接回复，系统将自动结构化入库。`;
}

