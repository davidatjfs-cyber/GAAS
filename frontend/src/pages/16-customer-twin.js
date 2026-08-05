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
  const ap = ev.target.closest('[data-ctr-approve]');
  const rj = ev.target.closest('[data-ctr-reject]');
  if (gen) ctrGenerate();
  else if (ref) ctrLoad();
  else if (ap) ctrApprove(ap.getAttribute('data-ctr-approve'));
  else if (rj) ctrReject(rj.getAttribute('data-ctr-reject'));
}

function loadCustomerTwinReviewPage() {
  ctrEnsureContainer();
  ctrWireEvents();
  ctrLoad();
}
