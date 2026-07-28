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
// 配色/字体 100% 对齐 role-workspaces-mockup.html 的「黑缎玫瑰」主题变量（该文件 :root 段），
// 用固定色值而不是引用 working-fixed.html 里可能存在也可能不存在的全局 CSS 变量——避免出现
// 之前那种"卡片背景 fallback 到白色，跟深色背景撞在一起"的问题。
function wsInjectStyles() {
    if (document.getElementById('ws-styles')) return;
    const style = document.createElement('style');
    style.id = 'ws-styles';
    style.textContent =
        '#workspace-page{--ws-bg:#121012;--ws-card:#1C181C;--ws-ink:#F2EAEE;--ws-ink2:#97848E;--ws-line:#2C252C;' +
        '--ws-accent:#E0A6B4;--ws-accent-deep:#D18FA0;--ws-accent-soft:#2B2027;--ws-on-accent:#241319;' +
        '--ws-up:#86C9A2;--ws-down:#E58B98;--ws-warn:#CFA14A;' +
        'background:var(--ws-bg);color:var(--ws-ink);position:relative;isolation:isolate;min-height:100%;' +
        'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif;}' +
        '.ws-serif{font-family:"Songti SC","STSong","Noto Serif SC",serif;}' +
        '.ws-root{padding:20px 16px calc(24px + env(safe-area-inset-bottom));max-width:720px;margin:0 auto;box-sizing:border-box;}' +
        '.ws-header h2{margin:0 0 4px;font-size:22px;font-weight:600;font-family:"Songti SC","STSong",serif;letter-spacing:.01em;}' +
        '.ws-sub{color:var(--ws-ink2);font-size:13px;margin-bottom:18px;}' +
        '.ws-section{margin-bottom:22px;}' +
        '.ws-section__title{font-size:13px;font-weight:600;margin-bottom:10px;color:var(--ws-ink);letter-spacing:-.01em;}' +
        '.ws-lights{display:flex;gap:8px;flex-wrap:wrap;}' +
        '.ws-light{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;' +
        'border:1px solid var(--ws-line);color:var(--ws-ink2);font-family:"Songti SC","STSong",serif;position:relative;}' +
        '.ws-light::after{content:"";position:absolute;bottom:-2px;right:-2px;width:8px;height:8px;border-radius:50%;border:2px solid var(--ws-card);}' +
        '.ws-light--green::after{background:var(--ws-up);} .ws-light--yellow::after{background:var(--ws-warn);} .ws-light--red::after{background:var(--ws-down);}' +
        '.ws-legend{font-size:11.5px;color:var(--ws-ink2);margin-top:8px;font-weight:500;}' +
        '.ws-card{background:var(--ws-card);border:1px solid var(--ws-line);border-radius:14px;padding:16px;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,.35);box-sizing:border-box;}' +
        '.ws-card__tag{margin-bottom:8px;}' +
        '.ws-tag{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;background:var(--ws-accent-soft);color:var(--ws-ink2);}' +
        '.ws-tag--red{background:var(--ws-accent-soft);color:var(--ws-down);} .ws-tag--green{background:var(--ws-accent-soft);color:var(--ws-up);}' +
        '.ws-card__title{font-weight:600;margin-bottom:6px;font-size:14px;color:var(--ws-ink);}' +
        '.ws-card__desc{font-size:13px;color:var(--ws-ink2);line-height:1.7;margin-bottom:12px;}' +
        '.ws-card__acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
        '.ws-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--ws-line);background:var(--ws-card);color:var(--ws-ink);' +
        'border-radius:8px;padding:9px 15px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;min-height:36px;box-sizing:border-box;}' +
        '.ws-btn--primary{background:var(--ws-accent);border-color:var(--ws-accent);color:var(--ws-on-accent);font-weight:600;}' +
        '.ws-btn--link{border-color:transparent;background:transparent;color:var(--ws-accent);padding:9px 6px;}' +
        '.ws-btn:active{transform:scale(.97);} .ws-btn:disabled{opacity:.6;cursor:default;}' +
        '.ws-action-result{margin-top:10px;font-size:12.5px;line-height:1.6;}' +
        '.ws-ok{color:var(--ws-up);font-weight:600;} .ws-err{color:var(--ws-down);font-weight:600;}' +
        '.ws-empty{color:var(--ws-ink2);font-size:13px;padding:14px 0;}' +
        '.ws-loading{color:var(--ws-ink2);font-size:13px;padding:24px 0;text-align:center;}' +
        '.ws-promote-form{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;}' +
        '.ws-input{border:1px solid var(--ws-line);background:var(--ws-bg);color:var(--ws-ink);border-radius:8px;padding:9px 12px;font-size:13px;font-family:inherit;box-sizing:border-box;}' +
        '.ws-select-multi{min-width:160px;flex:1;height:76px;}' +
        '.ws-quicklinks{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}' +
        '.ws-quicklinks .ws-btn{justify-content:center;}' +
        '@media (min-width:560px){.ws-quicklinks{grid-template-columns:repeat(4,1fr);}}' +
        '@media (max-width:480px){' +
        '.ws-root{padding:16px 14px calc(20px + env(safe-area-inset-bottom));}' +
        '.ws-header h2{font-size:20px;}' +
        '.ws-card{padding:14px;border-radius:12px;}' +
        '.ws-card__acts{gap:8px;}' +
        '.ws-card__acts .ws-btn{flex:1;justify-content:center;min-width:0;}' +
        '.ws-promote-form{flex-direction:column;}' +
        '.ws-select-multi{width:100%;}' +
        '}';
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

// ── 门店红绿灯（老板/总部共用）── 依据：store_ratings 营收达成率评级（A/B→绿 C→黄 D/无评级→红），
// 不是任务数量——这只是营收单一维度，不含差评/人效/任务积压。
function wsRenderStoreLights(storeLights) {
    if (!Array.isArray(storeLights) || !storeLights.length) {
        return '<div class="ws-empty">暂无门店评级数据</div>';
    }
    const dots = storeLights.slice(0, 12).map((s) => {
        const cls = 'ws-light--' + s.light;
        const rateTxt = s.achievement_rate != null ? '营收达成率 ' + s.achievement_rate + '%' : '本月尚无评级（缺目标营收）';
        return '<div class="ws-light ' + cls + '" title="' + wsEsc(s.store) + '：' + wsEsc(rateTxt) + '（' + wsEsc(s.rating || '无评级') + '）">' + wsEsc(String(s.store || '').slice(0, 1)) + '</div>';
    }).join('');
    const green = storeLights.filter((s) => s.light === 'green').length;
    const yellow = storeLights.filter((s) => s.light === 'yellow').length;
    const red = storeLights.filter((s) => s.light === 'red').length;
    return '<div class="ws-lights">' + dots + '</div><div class="ws-legend">' + green + ' 绿 · ' + yellow + ' 黄 · ' + red + ' 红（仅营收达成率，不含差评/人效）</div>';
}

// 六大增长方案问题分类（server/domains/growth-solutions/problems.js 的 PROBLEMS 键）——
// 任务的 category 命中这些键时，说明它背后有经营诊断/增长方案的完整归因与阶梯目标在支撑，
// 「查看进展」应该去经营诊断页看那套上下文，而不是通用 Agent 任务板（那里只有状态机，没有
// 归因和目标）。category 不在此列表里的任务（如这次批量推广用的 menu_optimization 之外的
// 通用 ops 任务）才落到 Agent 任务板——这是目前唯一能反映"这条任务到底谁在跟"的可靠信号，
// 不是瞎绑：demo 数据里"营收下滑"那条任务 category='ops'，本身就不是真走诊断流程生成的，
// 所以目前它确实只能停在 Agent 任务板——这不是我们编的路由错了，是这条 demo 任务本身还没有
// 诊断链路支撑，需要用真诊断生成的任务来验证这条路由。
const WS_DIAGNOSIS_BACKED_CATEGORIES = ['staff_efficiency', 'revenue', 'kitchen_standard', 'menu_optimization', 'gross_margin', 'training_replication'];

// ── 需拍板/任务卡片：点击直接调 agent-task-board review，原地展示结果 ──
function wsRenderTaskCard(task) {
    const sevTag = task.severity === 'high' ? '<span class="ws-tag ws-tag--red">需拍板</span>' : '<span class="ws-tag">待处理</span>';
    const hasDiagnosis = WS_DIAGNOSIS_BACKED_CATEGORIES.includes(String(task.category || ''));
    const progressLabel = hasDiagnosis ? '查看经营诊断 →' : '查看任务详情 →';
    return (
        '<div class="ws-card" data-task-id="' + wsEsc(task.task_id) + '" data-task-category="' + wsEsc(task.category || '') + '">' +
        '<div class="ws-card__tag">' + sevTag + '</div>' +
        '<div class="ws-card__title">' + wsEsc(task.store || '') + ' — ' + wsEsc(task.title || '') + '</div>' +
        '<div class="ws-card__desc">' + wsEsc(task.detail || '') + '</div>' +
        '<div class="ws-card__acts">' +
        '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" data-ws-approve="' + wsEsc(task.task_id) + '">确认完成/批准</button>' +
        '<button type="button" class="ws-btn ws-btn--link" data-ws-open-task="' + wsEsc(task.task_id) + '">' + progressLabel + '</button>' +
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
            const card = btn.closest('.ws-card');
            const category = card ? card.getAttribute('data-task-category') : '';
            const hasDiagnosis = WS_DIAGNOSIS_BACKED_CATEGORIES.includes(String(category || ''));
            try { showPage(hasDiagnosis ? 'diagnosis' : 'agent-tasks'); } catch (e) {}
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
    const allStores = (home?.storeLights || home?.storeSummary || []).map((s) => s.store).filter(Boolean);
    const tasksList = Array.isArray(home?.myTasks) ? home.myTasks : [];

    const heading = persona === 'boss' ? '经营驾驶舱' : '总部工作台';
    let html = '<div class="ws-header"><h2>' + heading + '</h2>';
    html += '<div class="ws-sub">未读消息 ' + (home?.unreadCount || 0) + ' 条</div></div>';
    html += '<div class="ws-section"><div class="ws-section__title">门店红绿灯</div>' + wsRenderStoreLights(home?.storeLights) + '</div>';
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
        '<div class="ws-header"><h2>我的任务</h2></div>' +
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
        const stores = (home?.storeLights || home?.storeSummary || []).map((s) => s.store).filter(Boolean);
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
