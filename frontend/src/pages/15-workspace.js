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
        // 2026-07-29：用户反馈标题字号跟正文(.ws-card__desc 13px)几乎一样大，层级不清——
        // 改成17px/700，加顶部间距，跟正文(13px)/卡片标题(14px)拉开明显差距。
        '.ws-section__title{font-size:17px;font-weight:700;margin:4px 0 12px;padding-top:4px;color:var(--ws-ink);letter-spacing:-.01em;}' +
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
        '.ws-up{color:var(--ws-up);} .ws-down{color:var(--ws-down);}' +
        '.ws-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;}' +
        '.ws-kpi{background:var(--ws-card);border:1px solid var(--ws-line);border-radius:12px;padding:12px 14px;}' +
        '.ws-kpi__label{font-size:11.5px;color:var(--ws-ink2);margin-bottom:4px;}' +
        '.ws-kpi__value{font-family:"Songti SC","STSong",serif;font-size:19px;font-weight:600;}' +
        '.ws-kpi__sub{font-size:11px;color:var(--ws-ink2);margin-top:4px;}' +
        '.ws-metrics-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;}' +
        '.ws-metric{background:var(--ws-card);border:1px solid var(--ws-line);border-radius:10px;padding:10px;text-align:center;}' +
        '.ws-metric__v{font-family:"Songti SC","STSong",serif;font-size:16px;font-weight:600;}' +
        '.ws-metric__l{font-size:10.5px;color:var(--ws-ink2);margin-top:3px;}' +
        '.ws-metric__s{font-size:10px;color:var(--ws-ink2);margin-top:2px;}' +
        '.ws-stat-list{background:var(--ws-card);border:1px solid var(--ws-line);border-radius:12px;padding:4px 14px;margin-bottom:12px;}' +
        '.ws-stat-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--ws-line);font-size:12.5px;}' +
        '.ws-stat-row:last-child{border-bottom:none;}' +
        '.ws-stat-row__l{color:var(--ws-ink2);flex:none;}' +
        '.ws-stat-row__v{font-weight:600;text-align:right;font-family:"Songti SC","STSong",serif;}' +
        '.ws-stat-row__s{display:block;font-size:10.5px;color:var(--ws-ink2);font-weight:500;font-family:inherit;margin-top:2px;}' +
        '.ws-rank-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}' +
        '.ws-rank-col{background:var(--ws-card);border:1px solid var(--ws-line);border-radius:10px;padding:10px;}' +
        '.ws-rank-col__title{font-size:11.5px;font-weight:600;margin-bottom:6px;}' +
        '.ws-rank-row{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 0;}' +
        '.ws-rank-row__n{color:var(--ws-ink2);width:14px;}' +
        '.ws-rank-row__store{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        '.ws-br-filters{display:flex;gap:6px;margin-bottom:10px;overflow-x:auto;padding-bottom:2px;}' +
        '.ws-br-chip{flex:none;border:1px solid var(--ws-line);background:transparent;color:var(--ws-ink2);border-radius:999px;padding:6px 12px;font-size:11.5px;font-family:inherit;cursor:pointer;white-space:nowrap;}' +
        '.ws-br-chip.active{background:var(--ws-accent-soft);color:var(--ws-ink);border-color:var(--ws-accent);}' +
        '.ws-br-feed{max-height:420px;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:8px;scroll-snap-type:y proximity;}' +
        '.ws-br-item{background:var(--ws-card);border:1px solid var(--ws-line);border-radius:10px;padding:10px 12px;scroll-snap-align:start;}' +
        '.ws-br-item__meta{font-size:11px;color:var(--ws-ink2);margin-bottom:4px;}' +
        '.ws-br-item__content{font-size:13px;line-height:1.6;}' +
        '.ws-lights-list{display:flex;flex-direction:column;gap:0;border-top:1px solid var(--ws-line);}' +
        '.ws-light-row{display:flex;align-items:center;gap:8px;padding:9px 2px;border-bottom:1px solid var(--ws-line);}' +
        '.ws-light-dot{width:8px;height:8px;border-radius:50%;flex:none;}' +
        '.ws-light-dot--green{background:var(--ws-up);} .ws-light-dot--yellow{background:var(--ws-warn);} .ws-light-dot--red{background:var(--ws-down);}' +
        '.ws-light-row__store{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        '.ws-light-row__rate{font-size:12px;color:var(--ws-ink2);font-family:"Songti SC","STSong",serif;}' +
        '.ws-more-toggle{display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;color:var(--ws-ink2);font-size:12.5px;cursor:pointer;border-top:1px solid var(--ws-line);margin-top:6px;}' +
        '.ws-todo{display:flex;gap:8px;margin-bottom:2px;}' +
        '.ws-todo__tab{flex:1;background:var(--ws-card);border:1px solid var(--ws-line);border-radius:10px;padding:10px 8px;text-align:center;color:var(--ws-ink2);font-family:inherit;font-size:12px;cursor:pointer;}' +
        '.ws-todo__tab.is-on{background:var(--ws-accent);border-color:var(--ws-accent);color:var(--ws-on-accent);font-weight:600;}' +
        '.ws-todo__n{display:block;font-family:"Songti SC","STSong",serif;font-size:17px;font-weight:600;margin-bottom:2px;}' +
        '@media (min-width:560px){.ws-quicklinks{grid-template-columns:repeat(4,1fr);} .ws-kpis{grid-template-columns:repeat(4,1fr);}}' +
        '@media (max-width:480px){' +
        '.ws-root{padding:16px 14px calc(20px + env(safe-area-inset-bottom));}' +
        '.ws-header h2{font-size:20px;}' +
        '.ws-card{padding:14px;border-radius:12px;}' +
        '.ws-card__acts{gap:8px;}' +
        '.ws-card__acts .ws-btn{flex:1;justify-content:center;min-width:0;}' +
        '.ws-promote-form{flex-direction:column;}' +
        '.ws-select-multi{width:100%;}' +
        '.ws-metrics-grid{grid-template-columns:repeat(2,1fr);}' +
        '.ws-rank-grid{grid-template-columns:1fr;}' +
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
// 2026-07-28 重做：原来用门店名首字显示成一个方块，同品牌门店首字撞车根本认不出是哪家店——
// 改成整行列出「颜色点 + 完整门店名 + 达成率」，按红→黄→绿排序，红灯排最前面最先看到。
function wsRenderStoreLights(storeLights) {
    if (!Array.isArray(storeLights) || !storeLights.length) {
        return '<div class="ws-empty">暂无门店评级数据</div>';
    }
    const order = { red: 0, yellow: 1, green: 2 };
    const sorted = [...storeLights].sort((a, b) => (order[a.light] ?? 3) - (order[b.light] ?? 3));
    const rows = sorted.map((s) => {
        const rateTxt = s.achievement_rate != null ? s.achievement_rate + '%' : '无评级';
        return (
            '<div class="ws-light-row">' +
            '<span class="ws-light-dot ws-light-dot--' + s.light + '"></span>' +
            '<span class="ws-light-row__store">' + wsEsc(s.store) + '</span>' +
            '<span class="ws-light-row__rate">' + wsEsc(rateTxt) + '</span>' +
            '<span class="ws-tag">' + wsEsc(s.rating || '—') + '</span>' +
            '</div>'
        );
    }).join('');
    const green = storeLights.filter((s) => s.light === 'green').length;
    const yellow = storeLights.filter((s) => s.light === 'yellow').length;
    const red = storeLights.filter((s) => s.light === 'red').length;
    return '<div class="ws-lights-list">' + rows + '</div><div class="ws-legend">' + green + ' 绿 · ' + yellow + ' 黄 · ' + red + ' 红（仅营收达成率，不含差评/人效）</div>';
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

// 2026-07-28：核查发现"任务"栏之前只查 master_tasks，经营诊断六大神器/餐饮总监下发的
// 任务实际落在完全独立的 growth_solution_tasks 表（server/growth-solutions.js），从未被
// getMyOpenTasks/getNotableOpenTasks 查过——诊断下发的任务对责任人来说100%"消失"了。
// 用现成的 GET /api/diagnosis/solutions/my-tasks（该表自己的"我的任务"接口）补上这个缺口，
// 归一化成跟 wsRenderTaskCard 一样的卡片形状，合并进同一个任务列表展示。
async function wsFetchGrowthSolutionTasks() {
    const data = await wsFetchJson('/api/diagnosis/solutions/my-tasks');
    const rows = Array.isArray(data?.tasks) ? data.tasks : [];
    return rows.map((t) => ({
        task_id: t.task_id,
        title: (t.problem_title ? t.problem_title + '：' : '') + (t.title || ''),
        detail: t.description || '',
        store: t.store || '',
        category: t.problem_key || '',
        severity: 'normal',
        source: 'growth_solution',
        round_id: t.round_id,
    }));
}

// ── 需拍板/任务卡片：点击直接调 agent-task-board review，原地展示结果 ──
// 2026-07-28：用户明确要求"任务"这个待办分区（待办组件的「任务」tab）只留完成按钮，
// 不要"查看进展/查看任务详情"这个跳Agent任务板的按钮——这是原则问题，不是样式偏好，
// 加了 hideProgressLink 参数专门给这个场景用，其它地方（门店工作台自己的任务列表）
// 调用时不传这个参数，行为不变。
// 2026-07-29：用户指出两个真问题——① "确认完成/批准"点了会直接调
// /api/agent-task-board/tasks/:id/review，那个接口 GAAS 代理层和 agents-service-v2 两边都限定
// admin/hq_manager/hr_manager 才能调，真正的责任人（出品经理/店长等）点击必定 403；
// ② 就算能点通，"点一下就算完成"本身也不构成闭环——用户明确要求责任人必须提交实际证据
// （文字说明或图片，比如被培训人员签字文件），完成动作要能回传给发起人确认，出问题才能追溯。
// 现在改成：master_tasks 来源的任务点"提交完成证据"展开一个文字+图片上传的小表单，调
// /api/workspace/tasks/:id/respond（不再碰 agent-task-board），状态进入 pending_review；
// 发起人在"待确认的任务反馈"区块里确认/打回。growth_solution 来源的任务不受影响，继续用
// 它自己的 /complete 接口（那条线本来就没有这个 403 问题）。
function wsRenderTaskCard(task, opts) {
    const hideProgressLink = !!(opts && opts.hideProgressLink);
    const sevTag = task.severity === 'high' ? '<span class="ws-tag ws-tag--red">需拍板</span>' : '<span class="ws-tag">待处理</span>';
    const hasDiagnosis = WS_DIAGNOSIS_BACKED_CATEGORIES.includes(String(task.category || ''));
    const progressLabel = hasDiagnosis ? '查看经营诊断 →' : '查看任务详情 →';
    // 门店名单独显示，不拼进标题——master_tasks.title 本身可能已经包含门店名
    // （比如这条 demo 数据："演示门店A — 请说明营收下滑原因..."），拼接会导致店名显示两遍。
    const titleText = String(task.title || '');
    const showStoreSeparately = task.store && !titleText.startsWith(String(task.store));
    const isGrowthTask = task.source === 'growth_solution';
    const isPendingReview = task.status === 'pending_review';
    let actsHtml;
    if (isGrowthTask) {
        actsHtml = '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" data-ws-approve="' + wsEsc(task.task_id) + '">确认完成/批准</button>';
    } else if (isPendingReview) {
        actsHtml = '<span class="ws-tag">已提交，等待确认</span>';
    } else {
        actsHtml = '<button type="button" class="ws-btn ws-btn--primary" data-ws-respond-toggle="' + wsEsc(task.task_id) + '">提交完成证据</button>';
    }
    return (
        '<div class="ws-card" data-task-id="' + wsEsc(task.task_id) + '" data-task-category="' + wsEsc(task.category || '') + '" data-task-source="' + wsEsc(task.source || 'master') + '" data-round-id="' + wsEsc(task.round_id || '') + '">' +
        '<div class="ws-card__tag">' + sevTag + (task.store ? ' <span class="ws-tag">' + wsEsc(task.store) + '</span>' : '') + (isGrowthTask ? ' <span class="ws-tag">经营诊断</span>' : '') + '</div>' +
        '<div class="ws-card__title">' + (showStoreSeparately ? wsEsc(task.store) + ' — ' : '') + wsEsc(titleText) + '</div>' +
        '<div class="ws-card__desc">' + wsEsc(task.detail || '') + '</div>' +
        '<div class="ws-card__acts">' +
        actsHtml +
        (hideProgressLink || isGrowthTask ? '' : '<button type="button" class="ws-btn ws-btn--link" data-ws-open-task="' + wsEsc(task.task_id) + '">' + progressLabel + '</button>') +
        '</div>' +
        (isGrowthTask || isPendingReview ? '' :
            '<div class="ws-respond-form" id="ws-respond-form-' + wsEsc(task.task_id) + '" style="display:none;margin-top:8px;">' +
            '<textarea class="ws-input" rows="2" placeholder="完成说明（如：已完成XX人培训，附签字文件）" data-ws-respond-text></textarea>' +
            '<input type="file" multiple accept="image/*,.pdf" data-ws-respond-files style="margin-top:6px;">' +
            '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" style="margin-top:6px;" data-ws-respond-submit="' + wsEsc(task.task_id) + '">提交</button>' +
            '</div>'
        ) +
        '<div class="ws-action-result"></div>' +
        '</div>'
    );
}

// 责任人提交完成证据：先传文件(复用现成的 /api/uploads/ops-task-evidence，任何登录用户都能传，
// 不需要再建一个上传接口)，拿到URL数组后连同文字说明一起提交给 /api/workspace/tasks/:id/respond。
async function wsSubmitTaskResponse(taskId, cardEl) {
    const form = cardEl.querySelector('#ws-respond-form-' + taskId);
    const text = form?.querySelector('[data-ws-respond-text]')?.value?.trim() || '';
    const fileInput = form?.querySelector('[data-ws-respond-files]');
    const files = fileInput?.files ? Array.from(fileInput.files) : [];
    if (!text && !files.length) { showNotification('请填写完成说明或上传证据文件', 'warning'); return; }
    const resultEl = cardEl.querySelector('.ws-action-result');
    resultEl.innerHTML = '<div class="ws-loading">提交中...</div>';
    try {
        let responseImages = [];
        if (files.length) {
            const fd = new FormData();
            files.forEach((f) => fd.append('files', f));
            const upR = await fetch('/api/uploads/ops-task-evidence', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('hrms_token') || '') }, body: fd });
            const upD = await upR.json().catch(() => ({}));
            if (!upR.ok) throw new Error(upD?.error || '文件上传失败');
            responseImages = Array.isArray(upD.urls) ? upD.urls : [];
        }
        const r = await fetch('/api/workspace/tasks/' + encodeURIComponent(taskId) + '/respond', {
            method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ responseText: text, responseImages }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
        resultEl.innerHTML = '<span class="ws-ok">✅ 已提交，等待发起人确认</span>';
        if (form) form.style.display = 'none';
        const acts = cardEl.querySelector('.ws-card__acts');
        if (acts) acts.innerHTML = '<span class="ws-tag">已提交，等待确认</span>';
    } catch (e) {
        resultEl.innerHTML = '<span class="ws-err">提交失败：' + wsEsc(e?.message || e) + '</span>';
    }
}

function wsBindTaskCardEvents(root) {
    root.querySelectorAll('[data-ws-respond-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-ws-respond-toggle');
            const form = root.querySelector('#ws-respond-form-' + taskId);
            if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
        });
    });
    root.querySelectorAll('[data-ws-respond-submit]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-ws-respond-submit');
            wsSubmitTaskResponse(taskId, btn.closest('.ws-card'));
        });
    });
    root.querySelectorAll('[data-ws-approve]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const card = btn.closest('.ws-card');
            const taskId = btn.getAttribute('data-ws-approve');
            const isGrowthTask = card && card.getAttribute('data-task-source') === 'growth_solution';
            const roundId = card ? card.getAttribute('data-round-id') : '';
            wsExecuteAction(card, {
                confirmText: '确认该任务已完成/批准通过？',
                endpoint: isGrowthTask
                    ? '/api/diagnosis/solutions/rounds/' + encodeURIComponent(roundId) + '/tasks/' + encodeURIComponent(taskId) + '/complete'
                    : '/api/agent-task-board/tasks/' + encodeURIComponent(taskId) + '/review',
                body: isGrowthTask ? {} : { decision: 'approved' },
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


// ── 今日经营总览（老板/总经理/总部营运经理共用同一套布局，区别只是后端按 allowed_stores 定的范围）──
function wsFmtPct(v) {
    if (v == null) return '—';
    const sign = v > 0 ? '▲' : v < 0 ? '▼' : '';
    const cls = v > 0 ? 'ws-up' : v < 0 ? 'ws-down' : '';
    return '<span class="' + cls + '">' + sign + Math.abs(v) + '%</span>';
}
function wsFmtMoney(v) {
    if (v == null) return '—';
    return (Number(v) / 10000).toFixed(1) + '万';
}

// 2026-07-28：用户要求把"环比"改成具体对比对象（昨天/上周/上月），"同比"统一改成"去年"，
// 不再用"环比/同比"这种财务术语——momLabel 按卡片类型传入，yoy 统一叫"去年"。
function wsRenderOverviewKpi(label, block, momLabel) {
    return (
        '<div class="ws-kpi">' +
        '<div class="ws-kpi__label">' + wsEsc(label) + '</div>' +
        '<div class="ws-kpi__value">¥' + wsFmtMoney(block.revenue) + '</div>' +
        '<div class="ws-kpi__sub">' + wsEsc(momLabel) + ' ' + wsFmtPct(block.mom) + ' · 去年 ' + wsFmtPct(block.yoy) + '</div>' +
        '</div>'
    );
}

function wsRenderStoreRankList(title, rows, fmt) {
    if (!rows || !rows.length) return '<div class="ws-rank-col"><div class="ws-rank-col__title">' + wsEsc(title) + '</div><div class="ws-empty">暂无数据</div></div>';
    const items = rows.slice(0, 5).map((r, i) => '<div class="ws-rank-row"><span class="ws-rank-row__n">' + (i + 1) + '</span><span class="ws-rank-row__store">' + wsEsc(r.store) + '</span><span class="ws-rank-row__val">' + fmt(r) + '</span></div>').join('');
    return '<div class="ws-rank-col"><div class="ws-rank-col__title">' + wsEsc(title) + '</div>' + items + '</div>';
}

function wsStatRow(label, value, sub) {
    return '<div class="ws-stat-row"><span class="ws-stat-row__l">' + wsEsc(label) + '</span><span class="ws-stat-row__v">' + value + (sub ? '<span class="ws-stat-row__s">' + sub + '</span>' : '') + '</span></div>';
}

// 2026-07-28 重排：原来营收/客流/人数分布各占一整块 grid，视觉很碎——改成
// KPI 卡只保留营收今日/本周/本月/目标这4个最重要的数字，其余全部用紧凑的 label-value
// 单行列表（wsStatRow）呈现，一屏能看完，不再是一堆方块。
function wsRenderOverview(ov) {
    if (!ov || ov.ok === false) return '<div class="ws-empty">经营数据加载失败</div>';
    const rev = ov.revenue || {};
    const op = ov.operational || {};
    const rk = ov.rankings || {};
    const p = op.partySizeSharePct || {};
    let html = '<div class="ws-kpis">';
    html += wsRenderOverviewKpi('今日营收', rev.today || {}, '昨天');
    html += wsRenderOverviewKpi('本周营收', rev.week || {}, '上周');
    html += wsRenderOverviewKpi('本月营收', rev.month || {}, '上月');
    html += '<div class="ws-kpi"><div class="ws-kpi__label">实收目标</div><div class="ws-kpi__value">¥' + wsFmtMoney(rev.target?.targetRevenue) + '</div>' +
        '<div class="ws-kpi__sub">理论 ' + (rev.target?.theoreticalAchievementRate ?? '—') + '% · 实际 ' + (rev.target?.actualAchievementRate ?? '—') + '%</div></div>';
    html += '</div>';

    html += '<div class="ws-stat-list">' +
        wsStatRow('客流量（本月累计）', op.traffic ?? '—', '上月' + wsFmtPct(op.trafficMom) + ' 去年' + wsFmtPct(op.trafficYoy)) +
        wsStatRow('客单价', '¥' + (op.avgSpendPerGuest ?? '—')) +
        wsStatRow('桌均', '¥' + (op.avgSpendPerTable ?? '—')) +
        wsStatRow('堂食 / 外卖占比', (op.dineInSharePct ?? '—') + '% / ' + (op.deliverySharePct ?? '—') + '%') +
        wsStatRow('就餐人数分布', '1人' + (p.p1 ?? '—') + '% · 2人' + (p.p2 ?? '—') + '% · 3-4人' + (p.p3to4 ?? '—') + '% · 5-6人' + (p.p5to6 ?? '—') + '% · 6人以上' + (p.p6plus ?? '—') + '%') +
        '</div>';

    html += '<div class="ws-rank-grid">' +
        wsRenderStoreRankList('营业额排名', rk.byRevenue, (r) => '¥' + wsFmtMoney(r.revenue)) +
        wsRenderStoreRankList('客流量排名', rk.byTraffic, (r) => r.traffic) +
        wsRenderStoreRankList('人效排名', rk.byEfficiency, (r) => r.efficiency) +
        '</div>';

    if (ov.turnover) {
        html += '<div class="ws-stat-list" style="margin-top:10px;">' +
            wsStatRow('本月离职率', (ov.turnover.turnoverRate ?? '—') + '%', '离职' + ov.turnover.departures + '人 · 在职' + ov.turnover.totalEmployees + '人') +
            '</div>';
    }

    if (Array.isArray(ov.team) && ov.team.length) {
        const teamRows = ov.team.slice(0, 10).map((t) => (
            '<div class="ws-rank-row"><span class="ws-rank-row__store">' + wsEsc(t.name || t.username) + '（' + wsEsc(t.store || '') + '）</span>' +
            '<span class="ws-rank-row__val">执' + wsEsc(t.execution_rating || '-') + ' 态' + wsEsc(t.attitude_rating || '-') + ' 能' + wsEsc(t.ability_rating || '-') + '</span></div>'
        )).join('');
        html += '<div class="ws-rank-col" style="margin-top:10px;"><div class="ws-rank-col__title">下属绩效评级（本月）</div>' + teamRows + '</div>';
    }

    return html;
}

// ── 门店营销活动建议（每天5条，线下/线上分类是按 action_type 关键词做的近似分类）──
async function wsRenderMarketingSuggestions() {
    const data = await wsFetchJson('/api/workspace/marketing-suggestions');
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return '<div class="ws-empty">近期暂无待执行的营销建议</div>';
    return items.map((it) => (
        '<div class="ws-card">' +
        '<div class="ws-card__tag"><span class="ws-tag">' + (it.channel === 'online' ? '线上' : '线下') + '</span></div>' +
        '<div class="ws-card__title">' + wsEsc(it.store || '') + ' — ' + wsEsc(it.title || '') + '</div>' +
        '<div class="ws-card__desc">' + wsEsc(it.detail || '') + '</div>' +
        '</div>'
    )).join('');
}

// ── 差评展示：用户明确要求"滚动浏览"而不是搜索表单——去掉输入框式检索，改成
// 门店下拉 + 日期范围用快捷筛选chip（近7天/近30天/全部），点了直接刷新下面的滚动列表，
// 不需要单独点"检索"按钮。
function wsDateRangeFromChip(days) {
    if (!days) return { start: '', end: '' };
    const end = shanghaiTodayYmd();
    const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    return { start, end };
}
function shanghaiTodayYmd() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

async function wsLoadBadReviews(container) {
    const store = container.querySelector('#ws-br-store')?.value || '';
    const activeChip = container.querySelector('.ws-br-chip.active');
    const days = activeChip ? Number(activeChip.getAttribute('data-days') || 0) : 30;
    const { start, end } = wsDateRangeFromChip(days);
    const qs = new URLSearchParams();
    if (store) qs.set('store', store);
    if (start) qs.set('startDate', start);
    if (end) qs.set('endDate', end);
    const list = container.querySelector('#ws-br-feed');
    if (list) list.innerHTML = '<div class="ws-loading">加载中...</div>';
    const data = await wsFetchJson('/api/workspace/bad-reviews?' + qs.toString());
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!list) return;
    if (!items.length) { list.innerHTML = '<div class="ws-empty">这个范围内没有差评记录</div>'; return; }
    list.innerHTML = items.map((it) => (
        '<div class="ws-br-item">' +
        '<div class="ws-br-item__meta">' + wsEsc(it.store || '') + ' · ' + wsEsc(String(it.date || '').slice(0, 10)) + (it.time ? ' ' + wsEsc(String(it.time).slice(0, 5)) : '') + ' · ' + wsEsc(it.source) + '</div>' +
        '<div class="ws-br-item__content">' + wsEsc(it.content || '（无文字内容）') + '</div>' +
        '</div>'
    )).join('');
}

function wsRenderBadReviewSection(allStores) {
    const storeOptions = '<option value="">全部门店</option>' + (allStores || []).map((s) => '<option value="' + wsEsc(s) + '">' + wsEsc(s) + '</option>').join('');
    return (
        '<div class="ws-br-filters">' +
        '<button type="button" class="ws-br-chip" data-days="7">近7天</button>' +
        '<button type="button" class="ws-br-chip active" data-days="30">近30天</button>' +
        '<button type="button" class="ws-br-chip" data-days="0">全部</button>' +
        '<select class="ws-input" id="ws-br-store" style="flex:none;">' + storeOptions + '</select>' +
        '</div>' +
        '<div class="ws-br-feed" id="ws-br-feed"><div class="ws-empty">加载中...</div></div>'
    );
}

function wsBindBadReviewEvents(root) {
    root.querySelectorAll('.ws-br-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            root.querySelectorAll('.ws-br-chip').forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            wsLoadBadReviews(root);
        });
    });
    const storeSel = root.querySelector('#ws-br-store');
    if (storeSel) storeSel.addEventListener('change', () => wsLoadBadReviews(root));
}

// ── 批量推广菜品：真实一键执行，绑定 /api/workspace/promote-dish。
// 2026-07-28：按用户要求从驾驶舱页面上移除了（不在9项计划内，容易跟计划内容混淆），
// 但代码保留不删——用户要先研究这个功能具体是做什么的，再决定要不要放回页面/放到哪。
// 这两个函数目前没有任何调用点，是有意保留的未使用代码，不要当成遗留垃圾清掉。
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
                let msg = '<span class="ws-ok">✅ 已批准推广到 ' + (d.storeCount || targetStores.length) + ' 家店，任务已下发</span>';
                if (Array.isArray(d.unassignedStores) && d.unassignedStores.length) {
                    msg += '<br><span class="ws-err">⚠️ ' + wsEsc(d.unassignedStores.join('、')) + ' 没有找到出品经理，任务已建但暂时无人认领</span>';
                }
                cardEl.querySelector('.ws-action-result').innerHTML = msg;
            },
        });
    });
}

// ── 六大管理神器：点击 → 选门店 → 内嵌任务拆分（接现有 /api/diagnosis/solutions/:key），
// 不跳转到经营诊断整页，只嵌入这一个问题的方案卡片。
// 2026-07-28：用户反馈"餐饮总监"混在六大神器按钮网格里容易认错——拆成独立板块，
// 不再是 WS_SIX_TOOLS 里的第7个按钮，见 wsRenderCustomDirectorSection。
const WS_SIX_TOOLS = [
    { key: 'revenue', label: '提升营收' },
    { key: 'staff_efficiency', label: '提升员工效率' },
    { key: 'kitchen_standard', label: '提升出品标准' },
    { key: 'menu_optimization', label: '提升菜品质量' },
    { key: 'gross_margin', label: '提升菜品毛利' },
    { key: 'training_replication', label: '复制培养人才' },
];

function wsRenderSixTools(allStores) {
    const buttons = WS_SIX_TOOLS.map((t) => '<button type="button" class="ws-btn" data-ws-six-tool="' + t.key + '">' + wsEsc(t.label) + '</button>').join('');
    const storeOptions = (allStores || []).map((s) => '<option value="' + wsEsc(s) + '">' + wsEsc(s) + '</option>').join('');
    return (
        '<div class="ws-quicklinks" style="grid-template-columns:repeat(3,1fr);">' + buttons + '</div>' +
        '<div id="ws-six-tool-panel" style="display:none;margin-top:12px;">' +
        '<select class="ws-input" id="ws-six-tool-store" style="margin-bottom:10px;width:100%;">' + storeOptions + '</select>' +
        '<div id="ws-six-tool-body"><div class="ws-empty">选择门店后加载方案</div></div>' +
        '</div>'
    );
}

// AI洞察嵌入六大神器：选了门店之后，把该店的经营闭环叙事（真实数据，不是写死文字）
// 显示在任务拆分列表上方。⚠️ 这里传的 store_id 就是门店显示名（如"演示门店A"），跟
// ontology 那套表内部用的 store_id 是不是同一套编码，我没有逐一核实过——如果 ontology
// 那边的 store_id 是另一套编码（不是展示名），这里会查不到数据，需要拿真实门店数据验证。
async function wsRenderSixToolInsight(store) {
    const report = await wsFetchJson('/api/ontology/closed-loop-report?period=30d&store_id=' + encodeURIComponent(store));
    if (!report || report.ok === false || report.ontologyStatus === 'insufficient_data' || !report.boss_summary) {
        return '<div class="ws-card"><div class="ws-card__tag"><span class="ws-tag ws-tag--green">AI 洞察</span></div>' +
            '<div class="ws-card__desc">该门店近30天数据不足，暂无AI经营判断</div></div>';
    }
    return '<div class="ws-card ws-card--insight"><div class="ws-card__tag"><span class="ws-tag ws-tag--green">AI 洞察</span></div>' +
        '<div class="ws-card__desc">' + wsEsc(report.boss_summary) + '</div></div>';
}

// 2026-07-28 重做：之前直接调 agent-task-board 创建通用任务，完全绕开了经营诊断真正的
// 阶梯目标+轮次机制——现在改成跟经营诊断页（frontend/src/pages/12-files.js 的
// gsRenderPlan/gsRenderRound/gsDispatch）同一套真实流程：GET .../:key 返回 open_round
// （已有进行中轮次，只读展示状态）或 plan（还没开始，要选责任人+截止日期后一键下发），
// 下发调 POST /api/diagnosis/solutions/:key/rounds 真正创建轮次，不是发个通用任务了事。
const WS_ROUND_STATUS_LABEL = { active: '执行中', observing: '观察期', reviewing: '待复盘确认' };

function wsRenderPlanTasks(plan) {
    return (plan || []).map((t, i) => {
        const opts = (t.suggested_assignees || []).map((a) => '<option value="' + wsEsc(a.username) + '">' + wsEsc(a.name) + '(' + wsEsc(a.position || '') + ')</option>').join('');
        const defDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
        return (
            '<div class="ws-card" data-plan-idx="' + i + '">' +
            '<div class="ws-card__title">' + wsEsc(t.title || '') + '</div>' +
            '<div class="ws-card__desc">' + wsEsc(t.description || '') + '</div>' +
            (t.why ? '<div class="ws-card__desc">💡 ' + wsEsc(t.why) + '</div>' : '') +
            (t.acceptance_criteria ? '<div class="ws-card__desc">✓ ' + wsEsc(t.acceptance_criteria) + '</div>' : '') +
            '<div class="ws-promote-form">' +
            '<select class="ws-input ws-plan-assignee" data-idx="' + i + '">' + (opts || '<option value="">⚠️ 无候选人</option>') + '</select>' +
            '<input type="date" class="ws-input ws-plan-due" data-idx="' + i + '" value="' + defDue + '">' +
            '</div></div>'
        );
    }).join('');
}

function wsRenderOpenRoundTasks(round) {
    const todayYmd = new Date().toISOString().slice(0, 10);
    const tasks = (round.tasks || []).map((t) => {
        const overdue = t.status !== 'done' && t.due_date && String(t.due_date).slice(0, 10) < todayYmd;
        return (
            '<div class="ws-card"><div class="ws-card__title">' + wsEsc(t.title || '') + '</div>' +
            '<div class="ws-card__desc">' + wsEsc(t.description || '') + '</div>' +
            '<div class="ws-card__desc">👤 ' + wsEsc(t.assignee_name || t.assignee_username || '') +
            (t.due_date ? ' · 截止 ' + String(t.due_date).slice(0, 10) : '') +
            ' · ' + (t.status === 'done' ? '✓已完成' : (overdue ? '⚠️已逾期' : '进行中')) + '</div></div>'
        );
    }).join('');
    const statusTag = '<div class="ws-card__tag"><span class="ws-tag">' + wsEsc(WS_ROUND_STATUS_LABEL[round.status] || round.status) + ' 第' + round.round_no + '轮</span></div>';
    return statusTag + tasks;
}

// 真正的一键下发：POST /api/diagnosis/solutions/:key/rounds，创建阶梯目标轮次
// （跟经营诊断页 gsDispatch 是同一个接口/同一套body结构），不是发个孤立任务了事。
async function wsDispatchPlan(key, store, plan, containerEl, resultEl) {
    const tasks = [];
    let missing = 0;
    containerEl.querySelectorAll('[data-plan-idx]').forEach((card) => {
        const idx = Number(card.getAttribute('data-plan-idx'));
        const t = plan[idx];
        const sel = card.querySelector('.ws-plan-assignee');
        const due = card.querySelector('.ws-plan-due');
        const username = sel?.value || '';
        if (!username) { missing++; return; }
        tasks.push({
            template_code: t.template_code || null, title: t.title, description: t.description, phase: t.phase,
            why: t.why || '', acceptance_criteria: t.acceptance_criteria || '',
            assignee_username: username, assignee_name: sel.selectedOptions[0]?.textContent || '',
            due_date: due?.value || null,
        });
    });
    if (missing > 0) { showNotification('还有 ' + missing + ' 项任务未指定责任人，不能下发', 'warning'); return; }
    const ok = await hrmsConfirm({ title: '确认下发', message: '确认下发 ' + tasks.length + ' 项任务给 ' + store + '？', okText: '确认下发' });
    if (!ok) return;
    resultEl.innerHTML = '<div class="ws-loading">下发中...</div>';
    try {
        const body = { store, tasks };
        if (String(key).startsWith('custom:')) { body.custom_title = plan.__customTitle || ''; body.metric_key = plan.__metricKey || ''; }
        const r = await fetch('/api/diagnosis/solutions/' + encodeURIComponent(key) + '/rounds', { method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
        resultEl.innerHTML = '<span class="ws-ok">✅ 已下发 ' + tasks.length + ' 项任务，进入第' + (d.round_no || 1) + '轮</span>';
    } catch (e) {
        resultEl.innerHTML = '<span class="ws-err">下发失败：' + wsEsc(e?.message || e) + '</span>';
    }
}

// 餐饮总监：接现有 /api/diagnosis/solutions/custom/analyze（经营诊断页"目前遇到的问题是
// 什么？"那个自由提问框用的同一个真实接口，不是新做的）。老板输入一句话问题，AI 结合门店
// 真实数据（差评/离职快照等，接口内部按关键词自动附带）生成分析+任务方案。布局按经营诊断
// 页原样搬：标题+说明+输入框+按钮，下面"进行中的自定义任务"+"最近查询记录"。
// 2026-07-28：原来跟六大神器共用同一个网格+同一个 #ws-six-tool-body 容器，用户反馈容易
// 跟标准六大神器混淆——拆成独立板块（独立标题+独立门店选择器+独立容器 #ws-custom-director-body）。
function wsRenderCustomDirectorSection(allStores) {
    const storeOptions = (allStores || []).map((s) => '<option value="' + wsEsc(s) + '">' + wsEsc(s) + '</option>').join('');
    return (
        '<select class="ws-input" id="ws-custom-director-store" style="margin-bottom:10px;width:100%;">' + storeOptions + '</select>' +
        '<div id="ws-custom-director-body"><div class="ws-empty">加载中...</div></div>'
    );
}

function wsBindCustomDirectorEvents(root) {
    const storeSel = root.querySelector('#ws-custom-director-store');
    if (!storeSel) return;
    wsRenderCustomDirectorTool(storeSel.value || '');
    storeSel.addEventListener('change', () => wsRenderCustomDirectorTool(storeSel.value || ''));
}

function wsRenderCustomDirectorTool(store) {
    const body = document.getElementById('ws-custom-director-body');
    if (!body) return;
    body.innerHTML =
        '<div class="ws-card">' +
        '<div class="ws-card__title">目前遇到的问题是什么？</div>' +
        '<div class="ws-card__desc">描述你的经营问题，AI 结合门店真实数据生成完整解决方案（同样按阶梯目标+任务闭环执行）。</div>' +
        '<input type="text" class="ws-input" id="ws-custom-question" style="width:100%;margin:8px 0;" placeholder="例如：最近外卖差评变多，出餐越来越慢...">' +
        '<div class="ws-card__acts"><button type="button" class="ws-action-btn ws-btn ws-btn--primary" id="ws-custom-submit">AI 生成方案</button></div>' +
        '</div>' +
        '<div id="ws-custom-result" style="margin-top:10px;"></div>' +
        '<div id="ws-custom-active" style="margin-top:10px;"></div>' +
        '<div id="ws-custom-history" style="margin-top:10px;"></div>';

    wsLoadCustomActiveRounds(store);
    wsLoadCustomHistory(store);

    document.getElementById('ws-custom-submit')?.addEventListener('click', () => wsRunCustomAnalyze(store, document.getElementById('ws-custom-question')?.value?.trim()));
}

async function wsLoadCustomActiveRounds(store) {
    const host = document.getElementById('ws-custom-active');
    if (!host || !store) return;
    const data = await wsFetchJson('/api/diagnosis/solutions/custom/active-rounds?store=' + encodeURIComponent(store));
    const rounds = Array.isArray(data?.rounds) ? data.rounds : [];
    if (!rounds.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="ws-section__title" style="font-size:11.5px;">📌 进行中的自定义任务（点击查看进度）</div>' +
        rounds.map((r) => (
            '<button type="button" class="ws-btn" style="width:100%;justify-content:space-between;margin-bottom:6px;" data-ws-active-round="' + wsEsc(r.problem_key) + '">' +
            '<span>' + wsEsc(r.problem_title) + ' · 第' + r.round_no + '轮</span>' +
            '<span>' + wsEsc(WS_ROUND_STATUS_LABEL[r.status] || r.status) + ' ' + r.tasks_done + '/' + r.tasks_total + '</span>' +
            '</button>'
        )).join('');
    host.querySelectorAll('[data-ws-active-round]').forEach((btn) => {
        btn.addEventListener('click', () => wsLoadSixToolPlan(btn.getAttribute('data-ws-active-round'), store));
    });
}

async function wsLoadCustomHistory(store) {
    const host = document.getElementById('ws-custom-history');
    if (!host || !store) return;
    const data = await wsFetchJson('/api/diagnosis/solutions/custom/history?store=' + encodeURIComponent(store) + '&limit=10');
    const history = Array.isArray(data?.history) ? data.history : [];
    if (!history.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="ws-section__title" style="font-size:11.5px;">最近查询记录（点击直接查看，不用重新输入）</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        history.map((h) => '<button type="button" class="ws-btn" data-ws-history-q="' + wsEsc(h.question) + '">' + wsEsc(h.title || h.question) + '</button>').join('') +
        '</div>';
    // 历史记录只重新问一次(数据可能已经变了,不直接显示当时的旧结果)，跟经营诊断页同样的取舍。
    host.querySelectorAll('[data-ws-history-q]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const q = btn.getAttribute('data-ws-history-q');
            const input = document.getElementById('ws-custom-question');
            if (input) input.value = q;
            wsRunCustomAnalyze(store, q);
        });
    });
}

async function wsRunCustomAnalyze(store, question) {
    const btn = document.getElementById('ws-custom-submit');
    const resultEl = document.getElementById('ws-custom-result');
    if (!question) { showNotification('请描述你遇到的问题', 'warning'); return; }
    if (!store) { showNotification('请先选择门店', 'warning'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
    resultEl.innerHTML = '<div class="ws-loading">AI 分析中，可能需要几秒...</div>';
    try {
        const r = await fetch('/api/diagnosis/solutions/custom/analyze', { method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ store, question }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
        if (d.mode === 'existing') {
            resultEl.innerHTML = '<div class="ws-card"><div class="ws-card__desc">' + wsEsc(d.reason || '') + '</div><div class="ws-card__desc">' + wsEsc(d.analysis || '') + '</div>' +
                '<div class="ws-card__acts"><button type="button" class="ws-btn ws-btn--link" data-ws-jump-key="' + wsEsc(d.problem_key) + '">这属于"' + wsEsc((WS_SIX_TOOLS.find((t) => t.key === d.problem_key) || {}).label || d.problem_key) + '"标准方案，点击查看 →</button></div></div>';
            resultEl.querySelector('[data-ws-jump-key]')?.addEventListener('click', (e) => {
                const key = e.target.getAttribute('data-ws-jump-key');
                document.getElementById('ws-six-tool-panel')?.setAttribute('data-active-key', key);
                wsLoadSixToolPlan(key, store);
            });
        } else {
            const plan = Array.isArray(d.plan) ? d.plan : [];
            plan.__customTitle = d.title || '';
            plan.__metricKey = d.metric_key || '';
            let html = '<div class="ws-card"><div class="ws-card__title">' + wsEsc(d.title || '自定义方案') + '</div>';
            if (d.reason) html += '<div class="ws-card__desc">' + wsEsc(d.reason) + '</div>';
            if (d.analysis) html += '<div class="ws-card__desc">' + wsEsc(d.analysis) + '</div>';
            if (d.priority_recommendation) html += '<div class="ws-card__desc">' + wsEsc(d.priority_recommendation) + '</div>';
            if (d.out_of_scope) html += '<div class="ws-card__desc">⚠️ ' + wsEsc(d.out_of_scope) + '</div>';
            html += '</div>';
            if (!plan.length) {
                html += '<div class="ws-empty">AI 未生成有效任务，请换个描述重试</div>';
                resultEl.innerHTML = html;
                if (btn) { btn.disabled = false; btn.textContent = 'AI 生成方案'; }
                return;
            }
            const containerId = 'ws-custom-plan-container';
            html += '<div id="' + containerId + '">' + wsRenderPlanTasks(plan) + '</div>';
            html += '<div class="ws-card__acts"><button type="button" class="ws-action-btn ws-btn ws-btn--primary" id="ws-custom-dispatch-btn">一键下发全部任务</button></div>';
            html += '<div class="ws-action-result" id="ws-custom-dispatch-result"></div>';
            resultEl.innerHTML = html;
            document.getElementById('ws-custom-dispatch-btn')?.addEventListener('click', () => {
                wsDispatchPlan(d.problem_key, store, plan, document.getElementById(containerId), document.getElementById('ws-custom-dispatch-result'));
            });
        }
    } catch (e) {
        resultEl.innerHTML = '<span class="ws-err">生成失败：' + wsEsc(e?.message || e) + '</span>';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'AI 生成方案'; }
    }
}

async function wsLoadSixToolPlan(key, store) {
    const body = document.getElementById('ws-six-tool-body');
    if (!body || !store) return;
    body.innerHTML = '<div class="ws-loading">加载中...</div>';
    const [data, insightHtml] = await Promise.all([
        wsFetchJson('/api/diagnosis/solutions/' + encodeURIComponent(key) + '?store=' + encodeURIComponent(store)),
        wsRenderSixToolInsight(store),
    ]);
    if (!data || data.ok === false) { body.innerHTML = insightHtml + '<div class="ws-empty">加载失败</div>'; return; }
    if (data.open_round) {
        body.innerHTML = insightHtml + wsRenderOpenRoundTasks(data.open_round);
        return;
    }
    if (data.capped) {
        body.innerHTML = insightHtml + '<div class="ws-empty">该指标已达阶梯封顶🎉，保持当前水平即可</div>';
        return;
    }
    const plan = Array.isArray(data.plan) ? data.plan : [];
    if (!plan.length) { body.innerHTML = insightHtml + '<div class="ws-empty">该门店暂无该方案的任务拆分</div>'; return; }
    const containerId = 'ws-six-tool-plan-container';
    let html = insightHtml;
    if (data.analysis) html += '<div class="ws-card"><div class="ws-card__desc">' + wsEsc(data.analysis) + '</div></div>';
    html += '<div id="' + containerId + '">' + wsRenderPlanTasks(plan) + '</div>';
    html += '<div class="ws-card__acts"><button type="button" class="ws-action-btn ws-btn ws-btn--primary" id="ws-six-dispatch-btn">一键下发全部任务</button></div>';
    html += '<div class="ws-action-result" id="ws-six-dispatch-result"></div>';
    body.innerHTML = html;
    document.getElementById('ws-six-dispatch-btn')?.addEventListener('click', () => {
        wsDispatchPlan(key, store, plan, document.getElementById(containerId), document.getElementById('ws-six-dispatch-result'));
    });
}

function wsBindSixToolsEvents(root) {
    root.querySelectorAll('[data-ws-six-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const panel = document.getElementById('ws-six-tool-panel');
            const storeSel = document.getElementById('ws-six-tool-store');
            if (panel) panel.style.display = '';
            panel.setAttribute('data-active-key', btn.getAttribute('data-ws-six-tool'));
            wsLoadSixToolPlan(btn.getAttribute('data-ws-six-tool'), storeSel?.value || '');
        });
    });
    const storeSel = root.querySelector('#ws-six-tool-store');
    if (storeSel) {
        storeSel.addEventListener('change', () => {
            const panel = document.getElementById('ws-six-tool-panel');
            const key = panel?.getAttribute('data-active-key');
            if (key) wsLoadSixToolPlan(key, storeSel.value);
        });
    }
}

// ── 8大AI督导指挥中心：内嵌发布框+按钮，状态栏直接同步 agent-task-board 的记录状态，
// 不跳转到 Agent任务指挥中心整页。
async function wsLoadAgentBoardList(container) {
    const list = container.querySelector('#ws-atb-list');
    if (!list) return;
    const data = await wsFetchJson('/api/agent-task-board/tasks?limit=8');
    const items = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data?.items) ? data.items : []);
    if (!items.length) { list.innerHTML = '<div class="ws-empty">暂无记录</div>'; return; }
    list.innerHTML = items.map((it) => (
        '<div class="ws-rank-row"><span class="ws-rank-row__store">' + wsEsc(it.title || it.content || '') + '</span>' +
        '<span class="ws-tag">' + wsEsc(it.status || '') + '</span></div>'
    )).join('');
}

function wsRenderAgentCommandCenter() {
    return (
        '<div class="ws-promote-form" style="flex-direction:column;">' +
        '<textarea class="ws-input" id="ws-atb-content" rows="3" placeholder="例：洪潮的卫生太差了，请督促门店2周内整改完成，每次提交前厅、后厨、洗手间照片。"></textarea>' +
        '<button type="button" class="ws-btn ws-btn--primary" id="ws-atb-publish">发布任务</button>' +
        '</div>' +
        '<div id="ws-atb-list" style="margin-top:10px;"><div class="ws-empty">加载中...</div></div>'
    );
}

function wsBindAgentCommandCenterEvents(root) {
    wsLoadAgentBoardList(root);
    const btn = root.querySelector('#ws-atb-publish');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const content = root.querySelector('#ws-atb-content')?.value?.trim();
        if (!content) { showNotification('请输入任务内容', 'warning'); return; }
        btn.disabled = true; btn.textContent = '发布中...';
        try {
            const r = await fetch('/api/agent-task-board/tasks', { method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ content }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
            root.querySelector('#ws-atb-content').value = '';
            showNotification('任务已发布', 'success');
            wsLoadAgentBoardList(root);
        } catch (e) {
            showNotification('发布失败：' + (e?.message || e), 'error');
        } finally {
            btn.disabled = false; btn.textContent = '发布任务';
        }
    });
}

// ── AI 洞察卡（仅老板）：接 /api/ontology/closed-loop-report 真实数据，不是写死文字。
// 卡1 = boss_summary（该服务已经按场景手工组织好的一句叙事，本身就是"headline"）；
// 卡2/3 = key_findings_for_owner[1]/[2] 配对 next_actions_for_owner[1]/[2]（按下标best-effort
// 配对，findings 和 actions 是两个独立数组不一定语义对应同一件事，这是当前已知的近似，
// 不是精确绑定——精确到"这条 finding 对应哪条 action"需要 opportunity.issue_id 关联，
// Phase 3 做「批准」按钮时会顺带做对。这次只做「展示 + 查看详情」，不假装有一键批准按钮。
function wsRenderInsightCard(text, tag, expandText) {
    if (!text) return '';
    const id = 'ws-insight-' + Math.random().toString(36).slice(2, 8);
    return (
        '<div class="ws-card ws-card--insight">' +
        '<div class="ws-card__tag"><span class="ws-tag ws-tag--green">' + wsEsc(tag) + '</span></div>' +
        '<div class="ws-card__desc">' + wsEsc(text) + '</div>' +
        (expandText
            ? '<div class="ws-card__acts"><button type="button" class="ws-btn ws-btn--link" data-ws-toggle="' + id + '">查看依据 →</button></div>' +
              '<div class="ws-action-result" id="' + id + '" style="display:none;">' + wsEsc(expandText) + '</div>'
            : '') +
        '</div>'
    );
}

async function wsRenderInsightsSection() {
    const report = await wsFetchJson('/api/ontology/closed-loop-report?period=30d');
    if (!report || report.ok === false || report.ontologyStatus === 'insufficient_data') {
        return '<div class="ws-empty">近30天数据不足，暂时无法生成经营判断（不会强行给结论）</div>';
    }
    const findings = Array.isArray(report.key_findings_for_owner) ? report.key_findings_for_owner : [];
    const actions = Array.isArray(report.next_actions_for_owner) ? report.next_actions_for_owner : [];
    const cards = [];
    if (report.boss_summary) {
        cards.push(wsRenderInsightCard(report.boss_summary, '本期概览', report.confidence_note));
    }
    for (let i = 0; i < 2; i++) {
        const f = findings[i];
        const a = actions[i];
        if (!f && !a) continue;
        const text = f && a ? (f + ' 建议：' + a) : (f || a);
        cards.push(wsRenderInsightCard(text, '增长机会', report.risk_warning));
    }
    if (!cards.length) return '<div class="ws-empty">近30天暂无需要关注的经营异常</div>';
    return cards.join('');
}

// ── 老板 / 总部 工作台 ──
// 2026-07-28：按用户要求去掉了 AI洞察卡（数据不足前一直显示占位文字，没有实际价值）
// 和批量推广（真实功能，但不在用户给的9项清单里，混进来显得乱）——只留用户明确要的9项。
// ── 待办三分区（任务/待批/通知）——2026-07-28 新增。"待批"直接查已有 /api/approvals
// （view=assigned&status=pending），不重新实现审批归属判断（那套逻辑很复杂，链式审批
// 都在里面，容易写错）；"通知"这里只给数量，没做列表下钻（没有现成的"通知列表"接口，
// 只有未读数，列表本身在 hrms_user_notifications，需要另外做才能下钻）。
function wsRenderTodoWidget(taskCount, pendingApprovalCount, unreadCount) {
    return (
        '<div class="ws-todo">' +
        '<button type="button" class="ws-todo__tab is-on" data-ws-todo-tab="task"><span class="ws-todo__n">' + taskCount + '</span>任务</button>' +
        '<button type="button" class="ws-todo__tab" data-ws-todo-tab="approval"><span class="ws-todo__n">' + pendingApprovalCount + '</span>待批</button>' +
        '<button type="button" class="ws-todo__tab" data-ws-todo-tab="notif"><span class="ws-todo__n">' + unreadCount + '</span>通知</button>' +
        '</div>' +
        '<div class="ws-todo-pane" id="ws-todo-pane"></div>'
    );
}

function wsBindTodoWidgetEvents(root, tasksList, pendingApprovals) {
    const renderPane = (tab) => {
        const pane = root.querySelector('#ws-todo-pane');
        if (!pane) return;
        if (tab === 'task') {
            pane.innerHTML = tasksList.length ? tasksList.slice(0, 6).map((t) => wsRenderTaskCard(t, { hideProgressLink: true })).join('') : '<div class="ws-empty">暂无进行中的任务</div>';
            wsBindTaskCardEvents(pane);
            return;
        }
        if (tab === 'approval') {
            pane.innerHTML = pendingApprovals.length
                ? pendingApprovals.map((a) => '<div class="ws-rank-row"><span class="ws-rank-row__store">' + wsEsc(a.type_label || a.type || '') + ' · ' + wsEsc(a.applicant_name || a.applicant_username || '') + '</span><span class="ws-tag">待审批</span></div>').join('')
                : '<div class="ws-empty">暂无待批事项</div>';
            return;
        }
        pane.innerHTML = '<div class="ws-empty">通知详情请去"我的档案"查看，这里暂时只显示未读数</div>';
    };
    root.querySelectorAll('[data-ws-todo-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            root.querySelectorAll('[data-ws-todo-tab]').forEach((b) => b.classList.remove('is-on'));
            btn.classList.add('is-on');
            renderPane(btn.getAttribute('data-ws-todo-tab'));
        });
    });
    renderPane('task');
}

// 待确认的任务反馈：责任人提交完成证据(pending_review)后，发起人在这里确认/打回，
// 任务闭环的最后一环——没有这一步，责任人点了提交跟没点没区别，发起人根本看不到反馈。
function wsRenderPendingConfirmations(items) {
    if (!Array.isArray(items) || !items.length) return '';
    const cards = items.map((it) => (
        '<div class="ws-card" data-confirm-task-id="' + wsEsc(it.task_id) + '">' +
        '<div class="ws-card__title">' + wsEsc(it.title || '') + (it.store ? ' · ' + wsEsc(it.store) : '') + '</div>' +
        '<div class="ws-card__desc">👤 ' + wsEsc(it.assignee_username || '') + ' 提交：' + wsEsc(it.response_text || '（无文字说明）') + '</div>' +
        (Array.isArray(it.response_images) && it.response_images.length
            ? '<div class="ws-card__desc">' + it.response_images.map((u) => '<a href="' + wsEsc(u) + '" target="_blank" class="ws-btn ws-btn--link">证据文件</a>').join(' ') + '</div>'
            : '') +
        '<div class="ws-card__acts">' +
        '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" data-ws-confirm-approve="' + wsEsc(it.task_id) + '">确认通过</button>' +
        '<button type="button" class="ws-btn" data-ws-confirm-reject="' + wsEsc(it.task_id) + '">打回重做</button>' +
        '</div>' +
        '<div class="ws-action-result"></div>' +
        '</div>'
    )).join('');
    return '<div class="ws-section"><div class="ws-section__title">待确认的任务反馈（' + items.length + '）</div>' + cards + '</div>';
}

async function wsSubmitConfirmDecision(taskId, decision, cardEl) {
    const resultEl = cardEl.querySelector('.ws-action-result');
    if (decision === 'reject') {
        const note = window.prompt('请说明打回原因（会通知责任人重新提交）');
        if (note == null) return;
        await wsConfirmDecisionRequest(taskId, 'reject', note, cardEl, resultEl);
    } else {
        const ok = await hrmsConfirm({ title: '确认通过', message: '确认该任务反馈已核实通过？', okText: '确认通过' });
        if (!ok) return;
        await wsConfirmDecisionRequest(taskId, 'approve', '', cardEl, resultEl);
    }
}

async function wsConfirmDecisionRequest(taskId, decision, note, cardEl, resultEl) {
    resultEl.innerHTML = '<div class="ws-loading">处理中...</div>';
    try {
        const r = await fetch('/api/workspace/tasks/' + encodeURIComponent(taskId) + '/confirm-response', {
            method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ decision, note }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
        resultEl.innerHTML = decision === 'reject' ? '<span class="ws-ok">✅ 已打回，责任人会收到通知重新提交</span>' : '<span class="ws-ok">✅ 已确认通过</span>';
        const acts = cardEl.querySelector('.ws-card__acts');
        if (acts) acts.style.display = 'none';
    } catch (e) {
        resultEl.innerHTML = '<span class="ws-err">操作失败：' + wsEsc(e?.message || e) + '</span>';
    }
}

function wsBindPendingConfirmationsEvents(root) {
    root.querySelectorAll('[data-ws-confirm-approve]').forEach((btn) => {
        btn.addEventListener('click', () => wsSubmitConfirmDecision(btn.getAttribute('data-ws-confirm-approve'), 'approve', btn.closest('.ws-card')));
    });
    root.querySelectorAll('[data-ws-confirm-reject]').forEach((btn) => {
        btn.addEventListener('click', () => wsSubmitConfirmDecision(btn.getAttribute('data-ws-confirm-reject'), 'reject', btn.closest('.ws-card')));
    });
}

async function wsRenderBossOrHq(root, persona) {
    root.innerHTML = '<div class="ws-loading">加载中...</div>';
    const [home, overview, marketingHtml, approvalsData, growthTasks, pendingConfirmData] = await Promise.all([
        wsFetchJson('/api/workspace/home?scope=notable'),
        wsFetchJson('/api/workspace/overview'),
        wsRenderMarketingSuggestions(),
        wsFetchJson('/api/approvals?view=assigned&status=pending&limit=50'),
        wsFetchGrowthSolutionTasks(),
        wsFetchJson('/api/workspace/pending-confirmations'),
    ]);
    const allStores = (home?.storeLights || home?.storeSummary || []).map((s) => s.store).filter(Boolean);
    const tasksList = (Array.isArray(home?.myTasks) ? home.myTasks : []).concat(growthTasks);
    const pendingApprovals = Array.isArray(approvalsData?.items) ? approvalsData.items : [];
    const pendingConfirmations = Array.isArray(pendingConfirmData?.items) ? pendingConfirmData.items : [];

    const heading = persona === 'boss' ? '经营驾驶舱' : '总部工作台';
    const roleLabel = (typeof getRoleDisplayName === 'function' ? getRoleDisplayName(currentUser?.role) : '') + (currentUser?.position ? '·' + currentUser.position : '') + '·级别' + (currentUser?.level || '暂无');
    let html = '<div class="ws-header"><h2>' + heading + '</h2>';
    html += '<div class="ws-sub">' + wsEsc(currentUser?.name || '') + (roleLabel ? '（' + wsEsc(roleLabel) + '）' : '') + ' · 未读消息 ' + (home?.unreadCount || 0) + ' 条' + (overview?.scoped ? ' · 仅显示你负责范围内的门店' : '') + '</div></div>';
    html += wsRenderTodoWidget(tasksList.length, pendingApprovals.length, home?.unreadCount || 0);
    html += wsRenderPendingConfirmations(pendingConfirmations);
    html += '<div class="ws-section"><div class="ws-section__title">今日经营总览</div>' + wsRenderOverview(overview) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">差评展示</div>' + wsRenderBadReviewSection(allStores) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">门店营销活动建议</div>' + marketingHtml + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">门店红绿灯（上月）</div>' + wsRenderStoreLights(home?.storeLights) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">六大管理神器</div>' + wsRenderSixTools(allStores) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">餐饮总监</div>' + wsRenderCustomDirectorSection(allStores) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">8大AI督导指挥中心</div>' + wsRenderAgentCommandCenter() + '</div>';
    html += '<div class="ws-section">' + wsRenderQuickActions() + '</div>';
    root.innerHTML = html;
    wsBindTodoWidgetEvents(root, tasksList, pendingApprovals);
    wsBindPendingConfirmationsEvents(root);
    wsBindSixToolsEvents(root);
    wsBindCustomDirectorEvents(root);
    wsBindAgentCommandCenterEvents(root);
    root.querySelectorAll('[data-ws-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const el = document.getElementById(btn.getAttribute('data-ws-toggle'));
            if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
        });
    });
    wsBindBadReviewEvents(root);
    wsLoadBadReviews(root);
}

// ── 门店工作台 ──
// 营业日目标(已有，来自 revenueRollup)+毛利目标(daily_reports actual_margin/target_margin
// 月平均)——用户明确说"大众点评/企微等其他目标"也要有，但查了库里没有这两个的目标配置
// (revenue_targets/margin_targets 只有营收和毛利)，如实展示"暂无数据源"，不编数字。
// 2026-07-28 重做：用户指出"其他目标"（大众点评/企微等）每个租户配置差异很大，不能写死
// 固定字段，只能从系统真实的目标设置里读——查到系统确实有一套通用KPI目标机制
// (kpi_targets表，任意metric_key，门店/品牌/公司三级，"任务和绩效"页面管理)，之前漏看了。
// 现在改成：营业日目标/毛利目标(daily_reports有实际值，能算达成率)继续用已有的真实计算；
// 其余目标改成动态读 GET /api/tenant-settings/kpi-targets?store=X 拿这家店实际配置了哪些
// metric_key，逐条展示目标值——但如实说明：这套通用目标机制目前只存了"目标值"，没有对应
// 的"任意指标自动核算实际值"的机制(那是另一套工程量，calculateKpiAchievement只覆盖agent
// 质量类固定指标，不含大众点评/企微这类业务指标)，所以这里只能展示目标、不能展示实际达成率。
async function wsRenderTargetTracking(ov, store) {
    const t = ov?.revenue?.target || {};
    const theo = t.theoreticalAchievementRate;
    const actual = t.actualAchievementRate;
    const status = (theo != null && actual != null) ? (actual >= theo ? '<span class="ws-up">超越目标</span>' : '<span class="ws-down">落后目标</span>') : '—';
    const m = ov?.margin || {};
    let html = '<div class="ws-stat-list">' +
        wsStatRow('营业日目标', '¥' + wsFmtMoney(t.targetRevenue), '理论达成 ' + (theo ?? '—') + '% · 实际达成 ' + (actual ?? '—') + '% · ' + status) +
        wsStatRow('毛利目标（本月日均）', (m.targetMargin != null ? m.targetMargin + '%' : '—'), '实际 ' + (m.actualMargin != null ? m.actualMargin + '%' : '—')) +
        '</div>';
    const kpiData = store ? await wsFetchJson('/api/tenant-settings/kpi-targets?store=' + encodeURIComponent(store)) : null;
    const kpiTargets = Array.isArray(kpiData?.targets) ? kpiData.targets : [];
    if (kpiTargets.length) {
        html += '<div class="ws-stat-list" style="margin-top:10px;">' +
            kpiTargets.map((k) => wsStatRow(wsEsc(k.metric_key), (k.target_value ?? '—') + (k.unit ? wsEsc(k.unit) : ''), '实际值：系统暂未接入该指标的自动核算，需人工核对')).join('') +
            '</div>';
    } else {
        html += '<div class="ws-empty">本店在"任务和绩效"目标设置里暂未配置其他目标（如大众点评/企微）</div>';
    }
    return html;
}

function wsRenderEmployeePerformanceList(team) {
    if (!Array.isArray(team) || !team.length) return '<div class="ws-empty">本月暂无绩效评分数据</div>';
    return team.map((t) => (
        '<div class="ws-stat-row"><span class="ws-stat-row__l">' + wsEsc(t.name || t.username) + (t.position ? ' · ' + wsEsc(t.position) : '') + '</span>' +
        '<span class="ws-stat-row__v">得分' + wsEsc(t.total_score ?? '—') + '<span class="ws-stat-row__s">态度' + wsEsc(t.attitude_rating || '-') + ' 执行' + wsEsc(t.execution_rating || '-') + ' 能力' + wsEsc(t.ability_rating || '-') + '</span></span></div>'
    )).join('');
}

async function wsRenderTrainingBoard(store) {
    const data = await wsFetchJson('/api/training/dashboard?store=' + encodeURIComponent(store));
    const rows = data?.success && Array.isArray(data.dashboard) ? data.dashboard : [];
    if (!rows.length) return '<div class="ws-empty">本店暂无培训计划</div>';
    return rows.map((r) => (
        '<div class="ws-stat-row"><span class="ws-stat-row__l">' + wsEsc(r.title) + (r.position ? '（' + wsEsc(r.position) + '）' : '') + '</span>' +
        '<span class="ws-stat-row__v">' + (r.certified_count || 0) + '/' + (r.assigned_count || 0) + ' 已认证' + (Number(r.overdue_count) > 0 ? '<span class="ws-down"> · ' + r.overdue_count + '人逾期</span>' : '') + '</span></div>'
    )).join('');
}

async function wsRenderKitchenBoard(store) {
    const data = await wsFetchJson('/api/kitchen/dashboard?store=' + encodeURIComponent(store));
    const summary = data?.success && Array.isArray(data.summary) ? data.summary : [];
    if (!summary.length) return '<div class="ws-empty">暂无厨房打点数据</div>';
    return summary.map((s) => (
        '<div class="ws-stat-row"><span class="ws-stat-row__l">' + wsEsc(s.station || '') + '</span>' +
        '<span class="ws-stat-row__v">' + (s.confirmed || 0) + '/' + (s.total || 0) + ' (' + (s.rate ?? 0) + '%)</span></div>'
    )).join('');
}

// 智能备货：用户明确要求"把目前智能助手的备货整套功能直接放到这里"——预测接口内部参数/
// 权限逻辑较复杂(server/domains/inventory-forecast)，与其重新拼接一遍容易拼错，改成直接
// 内嵌现有独立页面 /forecast.html(iframe)，完整复用真实功能，不重新实现。
function wsRenderSmartRestock() {
    return '<button type="button" class="ws-btn" data-ws-toggle="ws-restock-frame">展开/收起智能备货</button>' +
        '<div id="ws-restock-frame" style="display:none;margin-top:10px;height:600px;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">' +
        '<iframe src="/forecast.html" style="width:100%;height:100%;border:0;"></iframe></div>';
}

async function wsRenderStore(root) {
    root.innerHTML = '<div class="ws-loading">加载中...</div>';
    const store = String(currentUser?.current_store || currentUser?.store || '').trim();
    const [home, growthTasks, overview] = await Promise.all([
        wsFetchJson('/api/workspace/home'),
        wsFetchGrowthSolutionTasks(),
        wsFetchJson('/api/workspace/overview'),
    ]);
    const tasksList = (Array.isArray(home?.myTasks) ? home.myTasks : []).concat(growthTasks);
    const pendingApprovals = [];
    const storeLight = (Array.isArray(home?.storeLights) ? home.storeLights : []).find((s) => s.store === store);
    const storeRoleLabel = (typeof getRoleDisplayName === 'function' ? getRoleDisplayName(currentUser?.role) : '') + (currentUser?.position ? '·' + currentUser.position : '') + '·级别' + (currentUser?.level || '暂无') + '·门店级别' + (storeLight?.rating || '暂无');
    let html = '<div class="ws-header"><h2>今日工作台</h2><div class="ws-sub">' + wsEsc(currentUser?.name || '') + (storeRoleLabel ? '（' + wsEsc(storeRoleLabel) + '）' : '') + '</div></div>';
    html += wsRenderTodoWidget(tasksList.length, pendingApprovals.length, home?.unreadCount || 0);
    html += '<div class="ws-section"><div class="ws-section__title">今日经营总览</div>' + wsRenderOverview(overview) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">差评展示</div>' + wsRenderBadReviewSection(store ? [store] : []) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">当月目标追踪</div><div id="ws-target-tracking"><div class="ws-loading">加载中...</div></div></div>';
    html += '<div class="ws-section"><div class="ws-section__title">智能备货</div>' + wsRenderSmartRestock() + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">员工绩效</div>' + wsRenderEmployeePerformanceList(overview?.team) + '</div>';
    html += '<div class="ws-section"><div class="ws-section__title">员工培训看板</div><div id="ws-training-board"><div class="ws-loading">加载中...</div></div></div>';
    html += '<div class="ws-section"><div class="ws-section__title">厨房打点看板</div><div id="ws-kitchen-board"><div class="ws-loading">加载中...</div></div></div>';
    html += '<div class="ws-section">' + wsRenderQuickActions() + '</div>';
    root.innerHTML = html;
    wsBindTodoWidgetEvents(root, tasksList, pendingApprovals);
    root.querySelectorAll('[data-ws-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const el = document.getElementById(btn.getAttribute('data-ws-toggle'));
            if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
        });
    });
    wsBindBadReviewEvents(root);
    wsLoadBadReviews(root);
    if (store) {
        wsRenderTrainingBoard(store).then((h) => { const el = document.getElementById('ws-training-board'); if (el) el.innerHTML = h; });
        wsRenderKitchenBoard(store).then((h) => { const el = document.getElementById('ws-kitchen-board'); if (el) el.innerHTML = h; });
        wsRenderTargetTracking(overview, store).then((h) => { const el = document.getElementById('ws-target-tracking'); if (el) el.innerHTML = h; });
    }
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
        '</div></div>' +
        '<div class="ws-section">' + wsRenderQuickActions() + '</div>';
    root.querySelectorAll('[data-ws-nav]').forEach((b) => b.addEventListener('click', () => { try { showPage(b.getAttribute('data-ws-nav')); } catch (e) {} }));
}

// ── 总部HR工作台：严格权限门（前端隐藏 + 服务端已有 requirePayrollPerm 二次校验）──
async function wsRenderHqHr(root) {
    const canView = (typeof hrmsHasPermission === 'function') && (hrmsHasPermission('reports.payroll.view') || hrmsHasPermission('reports.payroll.ledger'));
    if (!canView) {
        root.innerHTML = '<div class="ws-header"><h2>总部HR工作台</h2></div>' +
            '<div class="ws-empty">你尚未获得薪酬报表访问权限，请联系系统管理员在权限组中授予 reports.payroll.view。</div>' +
            '<div class="ws-section">' + wsRenderQuickActions() + '</div>';
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
        '</div></div>' +
        '<div class="ws-section">' + wsRenderQuickActions() + '</div>';

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

// 2026-07-29：用户要求所有角色的工作台底部都加"快捷操作"折叠区块，样式/功能对齐"我的档案"
// 页原有的那个（休假申请/升职申请/总经理信箱/修改密码/离职申请）——直接复用同一套HTML结构
// (pf2-fold/pf2-qk/pfi 这些 class 和 svg 图标 sprite 都是页面里已经有的，不用新写样式)和
// 同一批全局 data-click 处理函数(openLeaveApplyModal/showPage/openGmMailboxModal/
// openChangePasswordModal/openResignationModal 在 01-boot.js 里已经定义好，任何页面都能调)，
// 不重新实现一遍这些弹窗逻辑。
function wsRenderQuickActions() {
    return (
        '<details class="pf2-fold">' +
        '<summary><svg class="pfi"><use href="#pfi-star"/></svg>快捷操作' +
        '<svg class="pfi pfi--sm pf2-cv"><use href="#pfi-chev"/></svg></summary>' +
        '<div class="pf2-fb"><div class="pf2-qk">' +
        '<div data-click="openLeaveApplyModal"><svg class="pfi"><use href="#pfi-leaf"/></svg><span>休假申请</span><svg class="pfi pfi--sm" style="margin-left:auto;color:var(--pf-faint);"><use href="#pfi-chev"/></svg></div>' +
        '<div data-click="showPage" data-arg="promotion"><svg class="pfi"><use href="#pfi-trend"/></svg><span>升职申请</span><svg class="pfi pfi--sm" style="margin-left:auto;color:var(--pf-faint);"><use href="#pfi-chev"/></svg></div>' +
        '<div data-click="openGmMailboxModal"><svg class="pfi"><use href="#pfi-mail"/></svg><span>总经理信箱</span><svg class="pfi pfi--sm" style="margin-left:auto;color:var(--pf-faint);"><use href="#pfi-chev"/></svg></div>' +
        '<div data-click="openChangePasswordModal"><svg class="pfi"><use href="#pfi-lock"/></svg><span>修改密码</span><svg class="pfi pfi--sm" style="margin-left:auto;color:var(--pf-faint);"><use href="#pfi-chev"/></svg></div>' +
        '<div data-click="openResignationModal"><svg class="pfi"><use href="#pfi-exit"/></svg><span>离职申请</span><svg class="pfi pfi--sm" style="margin-left:auto;color:var(--pf-faint);"><use href="#pfi-chev"/></svg></div>' +
        '</div></div></details>'
    );
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
