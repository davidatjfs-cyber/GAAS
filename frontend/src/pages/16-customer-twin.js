/* bundled page: 16-customer-twin.js — 培训卡审核（仅管理员可见） */

// ========== 培训卡审核（门店员工培训素材，仅系统管理员） ==========
var __ctr = { cards: [], kw: '', generating: false };

var __ctrCategoryLabel = {
  dine_complaint: '堂食客诉', delivery_complaint: '外卖客诉', greeting_host: '迎宾揽客',
  table_service: '席间服务', upsell_member: '会员推荐', cashier_dispute: '收银结账争议',
  kitchen_handoff: '前后厅交接', kitchen_open_close: '开收档', kitchen_qc: '出品质检',
  hygiene_cleaning: '卫生清洁', emergency_safety: '应急处置', shift_teamwork: '班次协作',
  manager_escalate: '店长升级处理', manager_ops: '店长日常运营', hq_ops_review: '总部巡店复盘',
  online_reputation: '线上口碑', food_safety_inspect: '食安迎检', newhire_handbook: '新人规章',
};
var __ctrJobLabel = {
  foh_server: '前厅服务员', cashier: '收银员', store_manager: '店长',
  kitchen_staff: '后厨', hq_ops: '总部运营',
};
var __ctrSourceLabel = {
  table_visit_records: '真实桌访', agent_messages: '真实差评',
};

function ctrEnsureContainer() {
  if (document.getElementById('customer-twin-review-page')) return;
  const page = document.createElement('div');
  page.id = 'customer-twin-review-page';
  page.className = 'hidden';
  page.innerHTML =
    '<div style="max-width:820px;margin:0 auto;padding:14px 12px 30px;color:#e8eef2;font-family:inherit">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
    '<div><div style="font-size:17px;font-weight:800">培训卡审核</div>' +
    '<div style="font-size:12px;color:rgba(232,238,242,.62);margin-top:2px">来自真实桌访与差评的待审培训卡（供门店员工岗位教练使用）</div></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button data-ctr-action="generate" style="padding:9px 12px;border-radius:10px;border:1px solid #0d7a5f;background:#0d7a5f;color:#fff;cursor:pointer;font-size:13px">从真实数据生成</button>' +
    '<button data-ctr-action="reject-all" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(185,28,28,.7);background:transparent;color:#f2a0a0;cursor:pointer;font-size:13px">批量拒绝当前列表</button>' +
    '<button data-ctr-action="calibration" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(207,161,74,.7);background:transparent;color:#e7c987;cursor:pointer;font-size:13px">每日评分校准</button>' +
    '<button data-ctr-action="refresh" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(232,238,242,.35);background:transparent;color:#e8eef2;cursor:pointer;font-size:13px">刷新</button>' +
    '</div></div>' +
    '<div style="background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:rgba(232,238,242,.75)">' +
    '<span id="ctr-account-line">当前账号：——</span>　<span id="ctr-stats-line">加载中…</span></div>' +
    '<input id="ctr-filter" placeholder="筛选：输入菜品或客诉关键词…" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e8eef2;font-size:14px;margin-bottom:10px" />' +
    '<div id="ctr-error" class="hidden" style="background:rgba(185,28,28,.15);border:1px solid rgba(185,28,28,.45);border-radius:12px;padding:12px;margin-bottom:10px;font-size:13px;line-height:1.7"></div>' +
    '<div id="ctr-list"></div></div>';
  document.body.appendChild(page);
}

function ctrToken() {
  try {
    if (typeof HRMS_API !== 'undefined' && HRMS_API && typeof HRMS_API.token === 'function') {
      const t = HRMS_API.token();
      if (t) return t;
    }
  } catch (e) {}
  return localStorage.getItem('hrms_token') || localStorage.getItem('HRMS_API_TOKEN') || '';
}

function ctrEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ctrChineseError(err, data) {
  const code = data && (data.error || data.message) ? String(data.error || data.message) : '';
  if (code === 'unauthorized') return '登录已失效，请重新登录平台后再试';
  if (code === 'forbidden') return '当前账号没有操作权限';
  if (code === 'server_error') return '服务器开小差了，请稍后重试';
  if (code === 'card_not_found') return '未找到该培训卡，可能已被处理';
  if (/network|fetch/i.test(String(err && err.message || ''))) return '网络异常，请检查网络后重试';
  return (err && err.message) || '操作失败，请稍后重试';
}

async function ctrApi(path, opts) {
  let res;
  try {
    res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + ctrToken(),
        ...(opts && opts.headers ? opts.headers : {}),
      },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error(ctrChineseError(e, null));
  }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || data.ok === false) {
    throw new Error(ctrChineseError(data.error || data.message || ('状态码 ' + res.status), data));
  }
  return data;
}

function ctrCurrentCards() {
  const kw = String(__ctr.kw || '').trim().toLowerCase();
  if (!kw) return __ctr.cards;
  return __ctr.cards.filter((c) =>
    [c.card_key, c.title, c.incident_brief, c.category_key, (c.meta || {}).store, (c.meta || {}).source_table]
      .filter(Boolean)
      .some((s) => String(s).toLowerCase().includes(kw))
  );
}

function ctrRenderStats() {
  const shown = ctrCurrentCards();
  const byCat = {};
  for (const c of shown) {
    const label = __ctrCategoryLabel[c.category_key] || '其他客诉';
    byCat[label] = (byCat[label] || 0) + 1;
  }
  const catStr = Object.entries(byCat).map(([k, v]) => k + ' ' + v + ' 张').join('，');
  document.getElementById('ctr-stats-line').textContent = '显示 ' + shown.length + ' / 待审 ' + __ctr.cards.length + ' 张' + (catStr ? ' · ' + catStr : '');
}

function ctrRenderCards() {
  const list = document.getElementById('ctr-list');
  const shown = ctrCurrentCards();
  list.textContent = '';
  if (!shown.length) {
    list.innerHTML = '<div style="text-align:center;color:rgba(232,238,242,.5);padding:28px 0">' +
      (__ctr.cards.length ? '没有匹配的培训卡，换个关键词试试。' : '暂无待审核培训卡，可点上方「从真实数据生成」拉取最新真实客诉。') + '</div>';
    return;
  }
  for (const card of shown) {
    const meta = card.meta || {};
    const facts = (card.locked_facts || []).map((f) => '<li>' + ctrEsc(f) + '</li>').join('');
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-bottom:10px';
    el.innerHTML =
      '<div style="font-size:14px;font-weight:700;margin-bottom:6px">' + ctrEsc(card.title) + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
      '<span style="padding:2px 8px;border-radius:999px;background:rgba(13,122,95,.25);color:#7fd7b8;font-size:12px">' + ctrEsc(__ctrCategoryLabel[card.category_key] || '其他客诉') + '</span>' +
      '<span style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08);color:rgba(232,238,242,.8);font-size:12px">难度 ' + ctrEsc(card.difficulty) + '</span>' +
      '<span style="padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.08);color:rgba(232,238,242,.8);font-size:12px">' + ctrEsc(__ctrJobLabel[card.job_profile_key] || '门店岗位') + '</span>' +
      (meta.store ? '<span style="padding:2px 8px;border-radius:999px;background:rgba(207,161,74,.18);color:#e7c987;font-size:12px">' + ctrEsc(meta.store) + '</span>' : '') +
      '</div>' +
      '<pre style="margin:0 0 8px;white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.6;color:rgba(232,238,242,.85);background:rgba(0,0,0,.18);border-radius:8px;padding:8px">' + ctrEsc(card.incident_brief) + '</pre>' +
      '<details><summary style="font-size:12px;color:rgba(232,238,242,.55);cursor:pointer">查看锁定事实、开场白与来源</summary>' +
      '<ul style="font-size:12.5px;line-height:1.7;color:rgba(232,238,242,.8);padding-left:18px">' + facts + '</ul>' +
      '<div style="font-size:12.5px;color:rgba(232,238,242,.7);margin-top:4px">开场白：' + ctrEsc(card.opening_line) + '</div>' +
      '<div style="font-size:12px;color:rgba(232,238,242,.5);margin-top:4px">来源：' + ctrEsc(__ctrSourceLabel[meta.source_table] || '真实案例') +
      (meta.date ? ' · ' + ctrEsc(meta.date) : '') + (meta.platform ? ' · ' + ctrEsc(meta.platform) : '') + '</div></details>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
      '<button data-ctr-approve="' + ctrEsc(card.card_key) + '" style="padding:8px 12px;border-radius:10px;border:1px solid #0d7a5f;background:#0d7a5f;color:#fff;cursor:pointer;font-size:13px">通过（进入岗位教练）</button>' +
      '<button data-ctr-reject="' + ctrEsc(card.card_key) + '" style="padding:8px 12px;border-radius:10px;border:1px solid rgba(185,28,28,.7);background:transparent;color:#f2a0a0;cursor:pointer;font-size:13px">拒绝（不再生成）</button>' +
      '</div>';
    list.appendChild(el);
  }
}

async function ctrLoad() {
  const errBox = document.getElementById('ctr-error');
  errBox.className = 'hidden';
  const account = (typeof currentUser !== 'undefined' && currentUser && currentUser.username) ? currentUser.username : '——';
  document.getElementById('ctr-account-line').textContent = '当前账号：' + account + '（系统管理员）';
  try {
    const data = await ctrApi('/api/customer-twin/incidents/pending');
    __ctr.cards = data.cards || [];
    ctrRenderStats();
    ctrRenderCards();
  } catch (e) {
    errBox.textContent = e.message;
    errBox.className = '';
    ctrRenderStats();
    ctrRenderCards();
  }
}

async function ctrApprove(key) {
  const ok = typeof hrmsConfirm === 'function'
    ? await hrmsConfirm({ title: '确认通过', message: '通过后，门店员工在岗位教练中可能抽到这张真实客诉卡。', okText: '确认通过', icon: '✅' })
    : confirm('通过后，门店员工在岗位教练中可能抽到这张真实客诉卡。');
  if (!ok) return;
  try {
    await ctrApi('/api/customer-twin/incidents/' + encodeURIComponent(key) + '/approve', { method: 'POST', body: { active: true } });
    await ctrLoad();
  } catch (e) {
    document.getElementById('ctr-error').textContent = e.message;
    document.getElementById('ctr-error').className = '';
  }
}

async function ctrReject(key) {
  const ok = typeof hrmsConfirm === 'function'
    ? await hrmsConfirm({ title: '确认拒绝', message: '拒绝后，该真实客诉不再生成培训卡，员工不会抽到。', okText: '确认拒绝', icon: '⛔' })
    : confirm('拒绝后，该真实客诉不再生成培训卡，员工不会抽到。');
  if (!ok) return;
  try {
    await ctrApi('/api/customer-twin/incidents/' + encodeURIComponent(key), { method: 'DELETE' });
    await ctrLoad();
  } catch (e) {
    document.getElementById('ctr-error').textContent = e.message;
    document.getElementById('ctr-error').className = '';
  }
}

async function ctrRejectAll() {
  const shown = ctrCurrentCards();
  if (!shown.length) {
    if (typeof showNotification === 'function') showNotification('当前没有可拒绝的培训卡', 'warning');
    return;
  }
  const ok = typeof hrmsConfirm === 'function'
    ? await hrmsConfirm({
        title: '确认批量拒绝',
        message: '将拒绝当前显示的 ' + shown.length + ' 张培训卡。拒绝后这些真实客诉不再生成培训卡，员工不会抽到。确认？',
        okText: '确认拒绝',
        icon: '⛔',
      })
    : confirm('将拒绝当前显示的 ' + shown.length + ' 张培训卡，拒绝后不再生成。确认？');
  if (!ok) return;
  const btn = document.querySelector('[data-ctr-action="reject-all"]');
  if (btn) { btn.disabled = true; btn.textContent = '拒绝中…'; }
  let done = 0;
  let failed = 0;
  try {
    for (const card of shown) {
      try {
        await ctrApi('/api/customer-twin/incidents/' + encodeURIComponent(card.card_key), { method: 'DELETE' });
        done += 1;
      } catch (e) {
        failed += 1;
      }
    }
    if (typeof showNotification === 'function') {
      showNotification('已拒绝 ' + done + ' 张' + (failed ? '，失败 ' + failed + ' 张' : ''), failed ? 'warning' : 'success');
    }
    await ctrLoad();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '批量拒绝当前列表'; }
  }
}

async function ctrGenerate() {
  if (__ctr.generating) return;
  __ctr.generating = true;
  const btn = document.querySelector('[data-ctr-action="generate"]');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const r = await ctrApi('/api/customer-twin/incidents/generate', { method: 'POST', body: { limit_per_source: 50 } });
    if (typeof showNotification === 'function') showNotification('已生成 ' + r.upserted + ' 张培训卡', 'success');
    await ctrLoad();
  } catch (e) {
    document.getElementById('ctr-error').textContent = e.message;
    document.getElementById('ctr-error').className = '';
  } finally {
    __ctr.generating = false;
    if (btn) { btn.disabled = false; btn.textContent = '从真实数据生成'; }
  }
}

var __ctrCal = { tasks: [] };

async function ctrLoadCalibration() {
  const errBox = document.getElementById('ctr-error');
  errBox.className = 'hidden';
  const list = document.getElementById('ctr-list');
  try {
    const data = await ctrApi('/api/customer-twin/calibration/daily');
    __ctrCal.tasks = data.tasks || [];
    document.getElementById('ctr-stats-line').textContent = '每日评分校准：待评 ' + __ctrCal.tasks.length + ' 条';
    if (!__ctrCal.tasks.length) {
      list.innerHTML = '<div style="text-align:center;color:rgba(232,238,242,.5);padding:28px 0">今天暂时没有待校准的已完成会话。</div>';
      return;
    }
    list.innerHTML = __ctrCal.tasks.map(ctrRenderCalTask).join('');
  } catch (e) {
    errBox.textContent = e.message;
    errBox.className = '';
  }
}

function ctrRenderCalTask(t) {
  const transcript = (t.transcript || []).map((x) =>
    '<div style="font-size:13px;line-height:1.6;margin:3px 0;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.05)">' +
    '<span style="color:' + (x.role === 'customer' ? '#7fd7b8' : '#e7c987') + ';font-weight:600">' +
    (x.role === 'customer' ? '客人：' : '员工：') + '</span>' + ctrEsc(x.text) + '</div>'
  ).join('');
  const dims = (t.dimensions || []).map((d) =>
    '<label style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:13px;margin:5px 0">' +
    '<span>' + ctrEsc(d) + '</span>' +
    '<input id="ctr-cal-' + t.id + '-' + ctrEsc(d) + '" type="number" min="0" max="100" value="70" style="width:76px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#e8eef2" /></label>'
  ).join('');
  return '<div style="background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-bottom:12px">' +
    '<div style="font-size:14px;font-weight:700;margin-bottom:4px">技能：' + ctrEsc(t.skill_key) + ' · ' + ctrEsc(t.session_no) + '</div>' +
    '<div style="font-size:12px;color:rgba(232,238,242,.55);margin-bottom:6px">客人人设：' + ctrEsc((t.persona && t.persona.desc) || '') + '</div>' +
    transcript +
    '<div style="margin-top:8px;border-top:1px solid rgba(255,255,255,.1);padding-top:8px">' + dims +
    '<button data-cal-submit="' + t.id + '" style="margin-top:8px;padding:8px 12px;border-radius:10px;border:1px solid #0d7a5f;background:#0d7a5f;color:#fff;cursor:pointer">提交我的评分</button></div>' +
    '<div id="ctr-cal-result-' + t.id + '" style="font-size:12.5px;color:rgba(232,238,242,.8);margin-top:8px"></div></div>';
}

async function ctrSubmitCal(id) {
  const task = __ctrCal.tasks.find((t) => String(t.id) === String(id));
  if (!task) return;
  const scores = {};
  for (const d of task.dimensions || []) {
    const el = document.getElementById('ctr-cal-' + id + '-' + d);
    const v = Number(el ? el.value : 70);
    scores[d] = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 70;
  }
  try {
    const r = await ctrApi('/api/customer-twin/calibration/submit', { method: 'POST', body: { session_id: id, scores } });
    const box = document.getElementById('ctr-cal-result-' + id);
    const lines = ['本次一致率：' + r.rate + '%'];
    Object.entries(r.agreement || {}).forEach(([d, ok]) => lines.push((ok ? '✓' : '✗') + ' ' + d + '（AI：' + (r.ai_scores && r.ai_scores[d] != null ? r.ai_scores[d] : '—') + '）'));
    box.textContent = lines.join('\n');
  } catch (e) {
    document.getElementById('ctr-cal-result-' + id).textContent = e.message;
  }
}

function ctrWireEvents() {
  document.removeEventListener('click', ctrHandleClick);
  document.addEventListener('click', ctrHandleClick);
  const filter = document.getElementById('ctr-filter');
  if (filter && !filter.dataset.wired) {
    filter.dataset.wired = '1';
    filter.addEventListener('input', () => {
      __ctr.kw = filter.value || '';
      ctrRenderStats();
      ctrRenderCards();
    });
  }
}

function ctrHandleClick(ev) {
  const gen = ev.target.closest('[data-ctr-action="generate"]');
  const ref = ev.target.closest('[data-ctr-action="refresh"]');
  const rjAll = ev.target.closest('[data-ctr-action="reject-all"]');
  const cal = ev.target.closest('[data-ctr-action="calibration"]');
  const ap = ev.target.closest('[data-ctr-approve]');
  const rj = ev.target.closest('[data-ctr-reject]');
  const calSub = ev.target.closest('[data-cal-submit]');
  if (gen) ctrGenerate();
  else if (cal) ctrLoadCalibration();
  else if (rjAll) ctrRejectAll();
  else if (ref) ctrLoad();
  else if (ap) ctrApprove(ap.getAttribute('data-ctr-approve'));
  else if (rj) ctrReject(rj.getAttribute('data-ctr-reject'));
  else if (calSub) ctrSubmitCal(calSub.getAttribute('data-cal-submit'));
}

function loadCustomerTwinReviewPage() {
  ctrEnsureContainer();
  ctrWireEvents();
  ctrLoad();
}

// ========== 全局训练看板（店长/总部经理/管理员，黑缎玫瑰 · 手机优先） ==========
var __ctd = { data: null, storeFilter: '' };

function ctdEnsureContainer() {
  if (document.getElementById('customer-twin-dashboard-page')) return;
  const page = document.createElement('div');
  page.id = 'customer-twin-dashboard-page';
  page.className = 'hidden';
  page.style.cssText = 'min-height:100%;background:linear-gradient(180deg,#23151c 0%,#170f14 100%);color:#F2EAEE;font-family:inherit';
  page.innerHTML =
    '<div style="max-width:860px;margin:0 auto;padding:12px 10px 44px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
    '<div><div style="font-size:18px;font-weight:800;color:#F6E3E8">全局训练看板</div>' +
    '<div style="font-size:12px;color:rgba(242,234,238,.6);margin-top:2px">每天练没练 · 练完没练完 · 结果如何 · 重点跟进</div></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button data-ctd-action="refresh" style="padding:9px 14px;border-radius:12px;border:1px solid rgba(224,166,180,.65);background:linear-gradient(135deg,#8d4a5d,#5f3240);color:#fff;cursor:pointer;font-size:13px;font-weight:600">刷新</button>' +
    '<button data-ctd-action="back" style="padding:9px 14px;border-radius:12px;border:1px solid rgba(242,234,238,.28);background:transparent;color:#F2EAEE;cursor:pointer;font-size:13px">返回培训</button>' +
    '</div></div>' +
    '<div id="ctd-error" class="hidden" style="background:rgba(185,28,28,.16);border:1px solid rgba(224,102,120,.5);border-radius:12px;padding:12px;margin-bottom:10px;font-size:13px;line-height:1.7"></div>' +
    '<div id="ctd-body">加载中…</div></div>';
  document.body.appendChild(page);
}

function ctdLevelLabel(level) {
  return level === 'advanced' ? '高级' : level === 'gold' ? '金牌' : '普通';
}

function ctdPct(v) {
  return v == null ? '—' : v + '%';
}

function ctdScore(v) {
  return v == null ? '—' : v + ' 分';
}

function ctdCard(title, bodyHtml) {
  return '<div style="background:rgba(224,166,180,.055);border:1px solid rgba(224,166,180,.2);border-radius:16px;padding:12px;margin-bottom:12px">' +
    '<div style="font-size:14px;font-weight:700;color:#F6DCE4;margin-bottom:8px">' + ctrEsc(title) + '</div>' + bodyHtml + '</div>';
}

function ctdKpi(v, sub) {
  return '<div style="background:rgba(224,166,180,.07);border:1px solid rgba(224,166,180,.22);border-radius:14px;padding:10px 8px;text-align:center">' +
    '<div style="font-size:20px;font-weight:800;color:#F6E3E8">' + ctrEsc(v) + '</div>' +
    (sub ? '<div style="font-size:11px;color:rgba(242,234,238,.6);margin-top:2px">' + ctrEsc(sub) + '</div>' : '') + '</div>';
}

function ctdDayDot(day) {
  const color = day.sessions === 0 ? 'rgba(242,234,238,.14)' : day.passed > 0 ? '#7FC8A9' : '#D9A441';
  const label = day.sessions ? (day.date.slice(5) + ' 训练' + day.sessions + '次·通过' + day.passed + '·未过' + day.failed + '·均分' + ctdScore(day.avg_score)) : (day.date.slice(5) + ' 未训练');
  return '<div title="' + ctrEsc(label) + '" style="width:34px;height:34px;border-radius:10px;background:' + color + ';display:flex;flex-direction:column;align-items:center;justify-content:center;color:#1b1117;font-weight:700;font-size:12px">' +
    (day.sessions ? day.sessions : '·') + '</div>';
}

function ctdRender() {
  const body = document.getElementById('ctd-body');
  const d = __ctd.data || {};
  const t = d.totals || {};
  const fmtDate = (s) => s ? String(s || '').slice(0, 16).replace('T', ' ') : '—';
  const storeFilter = String(__ctd.storeFilter || '').trim();
  const stores = (d.by_store || []).filter((s) => !storeFilter || s.store === storeFilter);
  const staff = (d.staff_detail || []).filter((x) => !storeFilter || x.store === storeFilter);
  const attention = (d.attention || []).filter((x) => !storeFilter || x.store === storeFilter);
  const cal = d.calibration || {};

  const kpis =
    ctdKpi(t.staff_count, '应训前厅') + ctdKpi(t.trained_staff, '已参训') + ctdKpi(ctdPct(t.participation_rate), '参与率') +
    ctdKpi(t.week_sessions, '近7天训练') + ctdKpi(t.total_sessions, '累计训练') + ctdKpi(t.incomplete_sessions, '未完成训练') +
    ctdKpi(ctdScore(t.avg_score), '平均分') + ctdKpi(cal.total ? ctdPct(cal.avg_rate) + '（' + cal.total + '份）' : '暂无', '校准一致率');

  const attentionHtml = attention.length
    ? attention.map((x) =>
      '<div style="background:rgba(224,102,120,.09);border:1px solid rgba(224,102,120,.38);border-radius:14px;padding:10px 12px;margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<div><span style="font-weight:700;color:#F6DCE4">' + ctrEsc(x.name) + '</span> <span style="font-size:12px;color:rgba(242,234,238,.65)">' + ctrEsc(x.position || '') + ' · ' + ctrEsc(x.store || '') + '</span></div>' +
      '<div style="font-size:11px;color:rgba(242,234,238,.6)">累计 ' + x.total_sessions + ' 次 · 最近 ' + fmtDate(x.last_finished_at) + '</div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' + x.reasons.map((r) =>
        '<span style="padding:3px 8px;border-radius:999px;background:rgba(224,102,120,.2);color:#F4B6C2;font-size:11px;font-weight:600">' + ctrEsc(r) + '</span>').join('') + '</div></div>'
    ).join('')
    : '<div style="text-align:center;color:rgba(242,234,238,.5);padding:14px 0;font-size:13px">全员状态良好，暂无重点跟进人员</div>';

  const starsHtml = (d.active_stars || []).map((x, i) =>
    '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;margin-bottom:6px;background:rgba(221,182,106,.07);border:1px solid rgba(221,182,106,.25);border-radius:12px">' +
    '<div><span style="color:#DDB66A;font-weight:800;margin-right:6px">' + (i + 1) + '</span><span style="font-weight:700;color:#F6DCE4">' + ctrEsc(x.name) + '</span> <span style="font-size:12px;color:rgba(242,234,238,.6)">' + ctrEsc(x.position || '') + ' · ' + ctrEsc(x.store || '') + '</span></div>' +
    '<div style="font-size:12px;color:rgba(242,234,238,.75)">本周' + x.week_days_trained + '天 · ' + x.week_sessions + '次 · 均分' + ctdScore(x.avg_score) + '</div></div>'
  ).join('') || '<div style="text-align:center;color:rgba(242,234,238,.5);padding:14px 0;font-size:13px">本周还没有训练数据</div>';

  const storeRows = stores.map((s) =>
    '<tr><td>' + ctrEsc(s.store) + '</td><td>' + s.staff_count + '</td><td>' + s.trained_staff + '</td>' +
    '<td>' + s.sessions + '（周' + s.week_sessions + '）</td><td>' + ctdScore(s.avg_score) + '</td><td>' + ctdPct(s.pass_rate) + '</td></tr>'
  ).join('') || '<tr><td colspan="6" style="text-align:center;color:rgba(242,234,238,.45)">暂无门店数据</td></tr>';

  const skillRows = (d.by_skill || []).map((s) =>
    '<tr><td>' + ctrEsc(s.label) + '</td><td>' + s.sessions + '</td><td>' + s.trained_users + '</td>' +
    '<td>' + ctdScore(s.avg_score) + '</td><td>' + ctdPct(s.pass_rate) + '</td></tr>'
  ).join('');

  const weakRows = (d.weakest_skills || []).map((s, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + ctrEsc(s.label) + '</td><td>' + s.sessions + '</td>' +
    '<td>' + ctdScore(s.avg_score) + '</td><td>' + ctdPct(s.pass_rate) + '</td></tr>'
  ).join('') || '<tr><td colspan="5" style="text-align:center;color:rgba(242,234,238,.45)">暂无训练数据</td></tr>';

  const staffCards = staff.map((x) => {
    const skills = (x.skills || []).map((sk) =>
      '<span style="padding:3px 8px;border-radius:999px;background:rgba(224,166,180,.12);color:#E9C4CE;font-size:11px;margin:2px 2px 0 0;display:inline-block">' +
      ctrEsc(sk.label) + '·' + ctdLevelLabel(sk.level) + '·' + sk.trained_count + '/' + sk.success_count + '</span>'
    ).join('');
    const dots = (x.recent_days || []).map(ctdDayDot).join('');
    const tags = [];
    if (x.incomplete_sessions > 0) tags.push('<span style="color:#F4B6C2">未完成' + x.incomplete_sessions + '次</span>');
    if (x.consecutive_missed_days >= 1) tags.push('<span style="color:#D9A441">连续' + x.consecutive_missed_days + '天未练</span>');
    tags.push('<span>' + x.week_days_trained + '/7天有训练</span>');
    return '<div style="background:rgba(224,166,180,.055);border:1px solid rgba(224,166,180,.2);border-radius:16px;padding:12px;margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<div><span style="font-weight:700;color:#F6DCE4">' + ctrEsc(x.name) + '</span> <span style="font-size:12px;color:rgba(242,234,238,.62)">' + ctrEsc(x.position || '') + ' · ' + ctrEsc(x.store || '') + '</span></div>' +
      '<div style="font-size:12px;color:rgba(242,234,238,.7)">累计' + x.total_sessions + '次 · 均分' + ctdScore(x.avg_score) + ' · ' + fmtDate(x.last_finished_at) + '</div></div>' +
      '<div style="display:flex;gap:4px;margin-top:10px;overflow:auto;padding-bottom:2px">' + dots + '</div>' +
      '<div style="font-size:11px;color:rgba(242,234,238,.6);margin-top:6px">' + tags.join('　') + '</div>' +
      (skills ? '<div style="margin-top:6px">' + skills + '</div>' : '<div style="font-size:11px;color:rgba(242,234,238,.45);margin-top:6px">尚未开练</div>') +
      '</div>';
  }).join('') || '<div style="text-align:center;color:rgba(242,234,238,.45);padding:18px 0">暂无人员数据</div>';

  const storeOptions = (d.by_store || []).map((s) =>
    '<option value="' + ctrEsc(s.store) + '"' + (s.store === storeFilter ? ' selected' : '') + '>' + ctrEsc(s.store) + '</option>'
  ).join('');

  body.innerHTML =
    '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px">' + kpis + '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<label style="font-size:12px;color:rgba(242,234,238,.7)">门店筛选</label>' +
    '<select id="ctd-store-filter" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(224,166,180,.28);background:rgba(224,166,180,.08);color:#F2EAEE;font-size:13px;flex:1;min-width:160px">' +
    '<option value="">全部门店</option>' + storeOptions + '</select></div>' +
    ctdCard('重点跟进（未训练 / 连续未练 / 未完成）', attentionHtml) +
    ctdCard('本周积极之星 TOP5', starsHtml) +
    ctdCard('门店对比',
      '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px"><thead>' +
      '<tr style="color:rgba(242,234,238,.6);text-align:left"><th style="padding:6px">门店</th><th style="padding:6px">应训</th><th style="padding:6px">已训</th><th style="padding:6px">训练次数</th><th style="padding:6px">平均分</th><th style="padding:6px">通过率</th></tr></thead>' +
      '<tbody>' + storeRows + '</tbody></table></div>') +
    ctdCard('技能训练情况（14 项）',
      '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:520px"><thead>' +
      '<tr style="color:rgba(242,234,238,.6);text-align:left"><th style="padding:6px">技能</th><th style="padding:6px">次数</th><th style="padding:6px">参训人数</th><th style="padding:6px">平均分</th><th style="padding:6px">通过率</th></tr></thead>' +
      '<tbody>' + skillRows + '</tbody></table></div>') +
    ctdCard('最弱技能 TOP5',
      '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:520px"><thead>' +
      '<tr style="color:rgba(242,234,238,.6);text-align:left"><th style="padding:6px">排名</th><th style="padding:6px">技能</th><th style="padding:6px">次数</th><th style="padding:6px">平均分</th><th style="padding:6px">通过率</th></tr></thead>' +
      '<tbody>' + weakRows + '</tbody></table></div>') +
    ctdCard('员工每日训练（近7天，数字=当天训练次数；绿=有通过，黄=未通过，灰=未练）', staffCards);

  const filter = document.getElementById('ctd-store-filter');
  if (filter) {
    filter.onchange = () => {
      __ctd.storeFilter = filter.value || '';
      ctdRender();
    };
  }
}

async function ctdLoad() {
  const errEl = document.getElementById('ctd-error');
  const body = document.getElementById('ctd-body');
  if (errEl) errEl.classList.add('hidden');
  if (body) body.textContent = '加载中…';
  try {
    const data = await ctrApi('/api/customer-twin/training/dashboard');
    __ctd.data = data;
    ctdRender();
  } catch (e) {
    if (errEl) {
      errEl.textContent = '加载失败：' + ctrChineseError(e, e && e.data);
      errEl.classList.remove('hidden');
    }
    if (body) body.textContent = '';
  }
}

function ctdHandleClick(ev) {
  const ref = ev.target.closest('[data-ctd-action="refresh"]');
  const back = ev.target.closest('[data-ctd-action="back"]');
  if (ref) ctdLoad();
  else if (back && typeof showPage === 'function') showPage('training');
}

function loadCustomerTwinDashboardPage() {
  ctdEnsureContainer();
  document.removeEventListener('click', ctdHandleClick);
  document.addEventListener('click', ctdHandleClick);
  ctdLoad();
}
