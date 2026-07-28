// ============ 角色工作台（Phase 1）============
// persona 只决定这里怎么排版，权限判断一律走 canAccessModulePage() / hrmsHasPermission()，
// 本文件不得新增任何权限逻辑。所有按钮绑定的都是已验证存在的真实接口，没有占位符。

function wsEnsurePageContainer() {
    if (document.getElementById('workspace-page')) return;
    const page = document.createElement('div');
    page.id = 'workspace-page';
    page.className = 'hidden';
    page.innerHTML = '<div id="workspace-root" class="ws-root"></div>';
    document.body.appendChild(page);
    wsInjectStyles();
}

// 样式随容器一起 JS 注入，working-fixed.html 的行数棘轮零余量，不能再往 <style> 里加静态 CSS。
function wsInjectStyles() {
    if (document.getElementById('ws-styles')) return;
    const style = document.createElement('style');
    style.id = 'ws-styles';
    style.textContent =
        '.ws-root{padding:20px;max-width:720px;margin:0 auto;}' +
        '.ws-header h2{margin:0 0 4px;font-size:20px;}' +
        '.ws-sub{color:#8f8e89;font-size:13px;margin-bottom:16px;}' +
        '.ws-section{margin-bottom:22px;}' +
        '.ws-section__title{font-size:14px;font-weight:600;margin-bottom:10px;}' +
        '.ws-lights{display:flex;gap:8px;flex-wrap:wrap;}' +
        '.ws-light{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;font-weight:600;}' +
        '.ws-light--green{background:#3e8e62;} .ws-light--yellow{background:#d9a43b;} .ws-light--red{background:#d45d4d;}' +
        '.ws-legend{font-size:12px;color:#8f8e89;margin-top:6px;}' +
        '.ws-card{background:var(--card,#fff);border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:14px;margin-bottom:10px;}' +
        '.ws-card__tag{margin-bottom:6px;} .ws-tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:#f0f0f0;color:#666;}' +
        '.ws-tag--red{background:#fde8e6;color:#b3402f;} .ws-tag--green{background:#e6f4ec;color:#2f7a4f;}' +
        '.ws-card__title{font-weight:600;margin-bottom:4px;} .ws-card__desc{font-size:13px;color:#666;line-height:1.6;margin-bottom:10px;}' +
        '.ws-card__acts{display:flex;gap:8px;align-items:center;}' +
        '.ws-btn{border:1px solid rgba(0,0,0,.12);background:#fff;border-radius:8px;padding:7px 13px;font-size:12.5px;cursor:pointer;}' +
        '.ws-btn--primary{background:#1b1b19;color:#fff;border-color:#1b1b19;} .ws-btn--link{border-color:transparent;background:transparent;color:#2f6bde;}' +
        '.ws-action-result{margin-top:8px;font-size:12.5px;} .ws-ok{color:#2f7a4f;font-weight:600;} .ws-err{color:#b3402f;font-weight:600;}' +
        '.ws-empty{color:#8f8e89;font-size:13px;padding:12px 0;}' +
        '.ws-promote-form{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}' +
        '.ws-input{border:1px solid rgba(0,0,0,.15);border-radius:8px;padding:7px 10px;font-size:13px;}' +
        '.ws-select-multi{min-width:160px;height:70px;}' +
        '.ws-quicklinks{display:flex;gap:10px;flex-wrap:wrap;}';
    document.head.appendChild(style);
}

function wsAuthHeaders() {
    return { 'Authorization': 'Bearer ' + (localStorage.getItem('hrms_token') || ''), 'Content-Type': 'application/json' };
}

// 统一「点击=立即执行」封装：确认 → 调真实接口 → 卡片原地展示结果，不跳转不刷新。
async function wsExecuteAction(cardEl, { confirmText, endpoint, method = 'POST', body, onSuccess }) {
    const ok = await hrmsConfirm({ title: '确认执行', message: confirmText, okText: '确认' });
    if (!ok) return;
    const btn = cardEl.querySelector('.ws-action-btn');
    const resultEl = cardEl.querySelector('.ws-action-result');
    if (btn) { btn.disabled = true; btn.textContent = '执行中...'; }
    try {
        const r = await fetch(endpoint, { method, headers: wsAuthHeaders(), body: body ? JSON.stringify(body) : undefined });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
        if (typeof onSuccess === 'function') onSuccess(cardEl, d);
        else if (resultEl) resultEl.innerHTML = '<span class="ws-ok">✅ 已执行</span>';
    } catch (e) {
        if (resultEl) resultEl.innerHTML = '<span class="ws-err">执行失败：' + (e?.message || e) + '</span> <button type="button" class="ws-retry-btn">重试</button>';
        if (btn) { btn.disabled = false; btn.textContent = '重试'; }
        showNotification('执行失败：' + (e?.message || e), 'error');
    }
}

function wsEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function wsFetchJson(url) {
    try {
        const r = await fetch(url, { headers: wsAuthHeaders() });
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { return null; }
}

// ── 门店红绿灯（老板/总部共用）──
function wsRenderStoreLights(storeSummary) {
    if (!Array.isArray(storeSummary) || !storeSummary.length) {
        return '<div class="ws-empty">暂无门店任务数据</div>';
    }
    const dots = storeSummary.slice(0, 12).map((s) => {
        const open = Number(s.open_count || 0);
        const high = Number(s.high_count || 0);
        const cls = high > 0 ? 'ws-light--red' : (open > 0 ? 'ws-light--yellow' : 'ws-light--green');
        return '<div class="ws-light ' + cls + '" title="' + wsEsc(s.store) + '：开放任务 ' + open + '，高优 ' + high + '">' + wsEsc(String(s.store || '').slice(0, 1)) + '</div>';
    }).join('');
    const red = storeSummary.filter((s) => Number(s.high_count) > 0).length;
    const yellow = storeSummary.filter((s) => Number(s.high_count) === 0 && Number(s.open_count) > 0).length;
    const green = storeSummary.length - red - yellow;
    return '<div class="ws-lights">' + dots + '</div><div class="ws-legend">' + green + ' 绿 · ' + yellow + ' 黄 · ' + red + ' 红</div>';
}

// ── 需拍板/任务卡片：点击直接调 agent-task-board review，原地展示结果 ──
function wsRenderTaskCard(task) {
    const sevTag = task.severity === 'high' ? '<span class="ws-tag ws-tag--red">需拍板</span>' : '<span class="ws-tag">待处理</span>';
    return (
        '<div class="ws-card" data-task-id="' + wsEsc(task.task_id) + '">' +
        '<div class="ws-card__tag">' + sevTag + '</div>' +
        '<div class="ws-card__title">' + wsEsc(task.store || '') + ' — ' + wsEsc(task.title || '') + '</div>' +
        '<div class="ws-card__desc">' + wsEsc(task.detail || '') + '</div>' +
        '<div class="ws-card__acts">' +
        '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" data-ws-approve="' + wsEsc(task.task_id) + '">确认完成/批准</button>' +
        '<button type="button" class="ws-btn ws-btn--link" data-ws-open-task="' + wsEsc(task.task_id) + '">查看进展 →</button>' +
        '</div>' +
        '<div class="ws-action-result"></div>' +
        '</div>'
    );
}

function wsBindTaskCardEvents(root) {
    root.querySelectorAll('[data-ws-approve]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const card = btn.closest('.ws-card');
            const taskId = btn.getAttribute('data-ws-approve');
            wsExecuteAction(card, {
                confirmText: '确认该任务已完成/批准通过？',
                endpoint: '/api/agent-task-board/tasks/' + encodeURIComponent(taskId) + '/review',
                body: { decision: 'approved' },
                onSuccess: (cardEl) => {
                    cardEl.querySelector('.ws-action-result').innerHTML = '<span class="ws-ok">✅ 已确认，任务状态已更新</span>';
                    const acts = cardEl.querySelector('.ws-card__acts');
                    if (acts) acts.style.display = 'none';
                },
            });
        });
    });
    root.querySelectorAll('[data-ws-open-task]').forEach((btn) => {
        btn.addEventListener('click', () => {
            try { showPage('agent-tasks'); } catch (e) {}
        });
    });
}

// ── 批量推广菜品：真实一键执行，绑定新建的 /api/workspace/promote-dish ──
function wsRenderPromoteDishWidget(allStores) {
    const storeOptions = (allStores || []).map((s) => '<option value="' + wsEsc(s) + '">' + wsEsc(s) + '</option>').join('');
    return (
        '<div class="ws-card ws-card--promote">' +
        '<div class="ws-card__tag"><span class="ws-tag ws-tag--green">可复制的好结果</span></div>' +
        '<div class="ws-card__title">新品/新动作批量推广到多店</div>' +
        '<div class="ws-card__desc">填写菜品/动作名称，选择要推广的门店，系统会为每家店的出品经理生成一条待办任务。</div>' +
        '<div class="ws-promote-form">' +
        '<input type="text" class="ws-input" id="ws-promote-dish-name" placeholder="例如：酸汤鱼">' +
        '<select multiple class="ws-input ws-select-multi" id="ws-promote-stores">' + storeOptions + '</select>' +
        '</div>' +
        '<div class="ws-card__acts"><button type="button" class="ws-action-btn ws-btn ws-btn--primary" id="ws-promote-submit-btn">批准推广</button></div>' +
        '<div class="ws-action-result"></div>' +
        '</div>'
    );
}

function wsBindPromoteDishEvents(root) {
    const btn = root.querySelector('#ws-promote-submit-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const card = btn.closest('.ws-card');
        const dishName = root.querySelector('#ws-promote-dish-name')?.value?.trim();
        const sel = root.querySelector('#ws-promote-stores');
        const targetStores = sel ? Array.from(sel.selectedOptions).map((o) => o.value) : [];
        if (!dishName || !targetStores.length) {
            showNotification('请填写名称并选择至少一家门店', 'warning');
            return;
        }
        wsExecuteAction(card, {
            confirmText: '将为 ' + targetStores.length + ' 家门店生成「' + dishName + '」推广任务，确认？',
            endpoint: '/api/workspace/promote-dish',
            body: { dishName, targetStores },
            onSuccess: (cardEl, d) => {
                cardEl.querySelector('.ws-action-result').innerHTML =
                    '<span class="ws-ok">✅ 已批准推广到 ' + (d.storeCount || targetStores.length) + ' 家店，任务已下发</span>';
            },
        });
    });
}

// ── 老板 / 总部 工作台 ──
async function wsRenderBossOrHq(root, persona) {
    root.innerHTML = '<div class="ws-loading">加载中...</div>';
    const home = await wsFetchJson('/api/workspace/home?scope=notable');
    const allStores = (home?.storeSummary || []).map((s) => s.store).filter(Boolean);
    const tasksList = Array.isArray(home?.myTasks) ? home.myTasks : [];

    const heading = persona === 'boss' ? '经营驾驶舱' : '总部工作台';
    let html = '<div class="ws-header"><h2>' + heading + '</h2>';
    html += '<div class="ws-sub">未读消息 ' + (home?.unreadCount || 0) + ' 条</div></div>';
    html += '<div class="ws-section"><div class="ws-section__title">门店红绿灯</div>' + wsRenderStoreLights(home?.storeSummary) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">今天该处理的事</div>';
    if (tasksList.length) {
        html += tasksList.slice(0, 6).map(wsRenderTaskCard).join('');
    } else {
        html += '<div class="ws-empty">暂无指派给你的开放任务</div>';
    }
    html += '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">批量推广</div>' + wsRenderPromoteDishWidget(allStores) + '</div>';
    root.innerHTML = html;
    wsBindTaskCardEvents(root);
    wsBindPromoteDishEvents(root);
}

// ── 门店工作台 ──
async function wsRenderStore(root) {
    root.innerHTML = '<div class="ws-loading">加载中...</div>';
    const home = await wsFetchJson('/api/workspace/home');
    const tasksList = Array.isArray(home?.myTasks) ? home.myTasks : [];
    let html = '<div class="ws-header"><h2>今日工作台</h2></div>';
    html += '<div class="ws-section"><div class="ws-section__title">我的待办（' + tasksList.length + '）</div>';
    if (tasksList.length) {
        html += tasksList.map(wsRenderTaskCard).join('');
    } else {
        html += '<div class="ws-empty">暂无待办任务，保持关注</div>';
    }
    html += '</div>';
    root.innerHTML = html;
    wsBindTaskCardEvents(root);
}

// ── 员工工作台 ──
async function wsRenderEmployee(root) {
    root.innerHTML =
        '<div class="ws-header"><h2>我的今天</h2></div>' +
        '<div class="ws-section"><div class="ws-quicklinks">' +
        '<button type="button" class="ws-btn" data-ws-nav="attendance">打卡</button>' +
        '<button type="button" class="ws-btn" data-ws-nav="training">培训</button>' +
        '<button type="button" class="ws-btn" data-ws-nav="points">积分</button>' +
        '<button type="button" class="ws-btn" data-ws-nav="profile">我的档案</button>' +
        '</div></div>';
    root.querySelectorAll('[data-ws-nav]').forEach((b) => b.addEventListener('click', () => { try { showPage(b.getAttribute('data-ws-nav')); } catch (e) {} }));
}

// ── 总部HR工作台：严格权限门（前端隐藏 + 服务端已有 requirePayrollPerm 二次校验）──
async function wsRenderHqHr(root) {
    const canView = (typeof hrmsHasPermission === 'function') && (hrmsHasPermission('reports.payroll.view') || hrmsHasPermission('reports.payroll.ledger'));
    if (!canView) {
        root.innerHTML = '<div class="ws-header"><h2>总部HR工作台</h2></div>' +
            '<div class="ws-empty">你尚未获得薪酬报表访问权限，请联系系统管理员在权限组中授予 reports.payroll.view。</div>';
        return;
    }
    const canMonthRun = hrmsHasPermission('reports.payroll.month_run');
    root.innerHTML =
        '<div class="ws-header"><h2>总部HR工作台</h2></div>' +
        '<div class="ws-section"><div class="ws-section__title">一键生成本月薪资</div>' +
        '<div class="ws-card">' +
        '<div class="ws-card__desc">将为全部门店生成当月薪资报表，此操作会锁定本月考勤数据。</div>' +
        (canMonthRun
            ? '<div class="ws-card__acts"><button type="button" class="ws-action-btn ws-btn ws-btn--primary" id="ws-hr-monthrun-btn">一键生成本月薪资</button></div><div class="ws-action-result" id="ws-hr-monthrun-result"></div>'
            : '<div class="ws-empty">你没有「reports.payroll.month_run」权限，无法执行月结</div>') +
        '</div></div>';

    if (canMonthRun) {
        document.getElementById('ws-hr-monthrun-btn')?.addEventListener('click', wsRunMonthlyPayrollForAllStores);
    }
}

async function wsRunMonthlyPayrollForAllStores() {
    const ok = await hrmsConfirm({ title: '确认生成本月薪资', message: '将为全部门店生成本月薪资报表并锁定考勤数据，确认继续？', okText: '确认生成' });
    if (!ok) return;
    const resultEl = document.getElementById('ws-hr-monthrun-result');
    const btn = document.getElementById('ws-hr-monthrun-btn');
    if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
    const month = new Date().toISOString().slice(0, 7);
    try {
        const home = await wsFetchJson('/api/workspace/home');
        const stores = (home?.storeSummary || []).map((s) => s.store).filter(Boolean);
        if (!stores.length) throw new Error('未找到门店列表');
        let done = 0;
        for (const store of stores) {
            if (resultEl) resultEl.textContent = '生成中... ' + done + '/' + stores.length + ' 家门店已完成';
            const r = await fetch('/api/hrms/payroll/month-run?store=' + encodeURIComponent(store) + '&month=' + month, { headers: wsAuthHeaders() });
            if (!r.ok) throw new Error(store + ' 生成失败：HTTP ' + r.status);
            done += 1;
        }
        if (resultEl) resultEl.innerHTML = '<span class="ws-ok">✅ ' + stores.length + ' 家门店本月薪资已生成</span>';
    } catch (e) {
        if (resultEl) resultEl.innerHTML = '<span class="ws-err">生成失败：' + (e?.message || e) + '</span>';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '一键生成本月薪资'; }
    }
}

// ── 桌面侧栏「工作台」入口（JS 注入，working-fixed.html 行数棘轮零余量，不能加静态 HTML）──
function wsInjectNavItem() {
    const nav = document.querySelector('.sidebar nav') || document.querySelector('nav');
    if (!nav || nav.querySelector('[data-page="workspace"]')) return;
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.setAttribute('data-page', 'workspace');
    item.innerHTML = '<a href="#" class="nav-link" data-click="showPage" data-arg="workspace"><i>🏠</i> <span>工作台</span></a>';
    nav.insertBefore(item, nav.firstChild);
}

// ── 入口 ──
async function renderWorkspaceHome() {
    wsEnsurePageContainer();
    const root = document.getElementById('workspace-root');
    if (!root) return;
    const persona = (typeof resolveWorkspacePersona === 'function') ? resolveWorkspacePersona(currentUser) : 'staff';
    if (persona === 'boss' || persona === 'hq') return wsRenderBossOrHq(root, persona);
    if (persona === 'hq_hr') return wsRenderHqHr(root);
    if (persona === 'store') return wsRenderStore(root);
    return wsRenderEmployee(root);
}
