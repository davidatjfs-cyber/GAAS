export function getShanghaiYmd() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}

/** @param {string|Date} isoOrDate */
export function formatShanghaiYmdChinese(isoOrDate) {
  const d = new Date(isoOrDate);
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(d);
  const m = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(d);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', day: 'numeric' }).format(d);
  return `${y}年${Number(m)}月${Number(day)}日`;
}

export function getShanghaiPrevYm() {
  const d = new Date();
  const shD = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  shD.setMonth(shD.getMonth() - 1);
  const y = shD.getFullYear();
  const m = String(shD.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function isWithin3DaysAndSameMonth(createdAt) {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now - created;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > 3) return false;
  const shNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const shCreated = new Date(created.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  if (shNow.getFullYear() !== shCreated.getFullYear() || shNow.getMonth() !== shCreated.getMonth()) return false;
  return true;
}

export function getRoleLabelZh(role) {
  const r = String(role || '').trim();
  if (r === 'store_manager') return '店长';
  if (r === 'store_production_manager') return '出品经理';
  if (r === 'front_manager') return '前厅经理';
  return r || '—';
}

/**
 * 工作态度备案失效 — 责任人卡片
 * @param {object} p
 */
export function buildFilingInvalidationAssigneeCard(p) {
  const {
    empName, username, empStore, empRole, period, ymdZh, taskIdStr, countBefore, countAfter
  } = p;
  const roleLabel = getRoleLabelZh(empRole);
  const content = `**责任人**：${empName}（${username}）
**门店**：${empStore || '—'}
**岗位**：${roleLabel}
**统计月**：${period}
**备案任务日**：${ymdZh}
**任务编号**：\`${taskIdStr}\`

**本月工作态度备案次数（系统有效口径）**
由 **${countBefore}** 次更新为 **${countAfter}** 次

> 管理员已撤销上述备案条目，统计与档案将按最新口径展示。**如有疑问请咨询总部营运。**`;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `\u2705 工作态度备案撤销通知 \xb7 ${period}` },
      template: 'green'
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: 'HRMS 数据中心 · 备案失效已生效' }] }
    ]
  };
}

/**
 * 工作态度备案失效 — 管理员抄送卡片
 * @param {object} p
 */
export function buildFilingInvalidationAdminCard(p) {
  const {
    adminUser, empName, username, empStore, empRole, period, ymdZh, taskIdStr, countBefore, countAfter
  } = p;
  const roleLabel = getRoleLabelZh(empRole);
  const content = `**操作管理员**：${adminUser}
**责任人**：${empName}（${username}）
**门店**：${empStore || '—'}
**岗位**：${roleLabel}
**统计月**：${period}
**备案任务日**：${ymdZh}
**任务编号**：\`${taskIdStr}\`

**责任人本月工作态度备案次数（有效口径）**
由 **${countBefore}** 次更新为 **${countAfter}** 次

> 本条撤销已写入系统；责任人侧已推送**备案撤销通知**卡片。请留存本条备查。`;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `\u2709 抄送 \xb7 备案撤销已生效 \xb7 ${taskIdStr}` },
      template: 'blue'
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '非月度评级定稿通知，请勿对外解释为最终绩效等级' }] }
    ]
  };
}

/**
 * 周度扣分记录失效 — 责任人 + 管理员（结构统一、专业展示）
 */
export function buildWeeklyScoreInvalidationCard(p, audience) {
  const {
    empName, username, empStore, empRole, period, sourceId, recordSummary, before, after, adminUser
  } = p;
  const roleLabel = getRoleLabelZh(empRole);
  const scoreLine =
    typeof before?.total_score !== 'undefined' || typeof after?.total_score !== 'undefined'
      ? `**关联月度演算得分（仅供参考）**：${before?.total_score ?? '—'} → ${after?.total_score ?? '—'}`
      : '';
  const contentAssignee = `**责任人**：${empName}（${username}）
**门店**：${empStore || '—'}
**岗位**：${roleLabel}
**统计月**：${period}
**失效记录 ID**：\`${sourceId}\`
${recordSummary ? `**失效记录摘要**：${recordSummary}\n` : ''}${scoreLine ? `${scoreLine}\n` : ''}
> 对应周度异常扣分条目已由管理员标记失效，月度汇总将按最新有效记录重算。**如有疑问请咨询总部营运。**`;

  const contentAdmin = `**操作管理员**：${adminUser}
**责任人**：${empName}（${username}）
**门店**：${empStore || '—'}
**岗位**：${roleLabel}
**统计月**：${period}
**失效记录 ID**：\`${sourceId}\`
${recordSummary ? `**失效记录摘要**：${recordSummary}\n` : ''}${scoreLine ? `${scoreLine}\n` : ''}
> 已同步通知责任人；请留存本条备查。`;

  const isAdmin = audience === 'admin';
  return {
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: isAdmin
          ? `\u2709 抄送 \xb7 周度扣分记录已失效 \xb7 ${sourceId}`
          : `\u2705 周度绩效扣分记录已失效 \xb7 ${period}`
      },
      template: isAdmin ? 'blue' : 'green'
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: isAdmin ? contentAdmin : contentAssignee }
      },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: isAdmin
              ? 'HRMS 数据中心 · 供管理员核对'
              : 'HRMS · 周度 agent_scores 失效重算说明'
          }
        ]
      }
    ]
  };
}

export function buildChangeCard(before, after, username, name, store, role, period) {
  const roleLabel = getRoleLabelZh(role);
  const lines = [];

  const scoreBefore = before.total_score ?? '—';
  const scoreAfter = after.total_score ?? '—';
  if (scoreBefore !== scoreAfter) lines.push(`• 绩效得分：${scoreBefore} → ${scoreAfter}`);

  const dims = [
    { key: 'execution_rating', label: '执行力' },
    { key: 'attitude_rating', label: '工作态度' },
    { key: 'ability_rating', label: '工作能力' }
  ];
  for (const d of dims) {
    const b = before[d.key] ?? '—';
    const a = after[d.key] ?? '—';
    if (b !== a) lines.push(`• ${d.label}：${b} → ${a}`);
  }

  if (!lines.length) return null;

  const content = `**门店**：${store}
**岗位**：${roleLabel} · ${name || username}
**统计月**：${period}

**变更明细**
${lines.join('\n')}

**变更后**
• 绩效得分：**${scoreAfter}**
• 执行力：**${after.execution_rating ?? '—'}**
• 工作态度：**${after.attitude_rating ?? '—'}**
• 工作能力：**${after.ability_rating ?? '—'}**`;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `\u270f\ufe0f 绩效数据变更通知 \xb7 ${period}` },
      template: 'orange'
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '管理员已变更绩效记录，数据即刻生效' }] }
    ]
  };
}
