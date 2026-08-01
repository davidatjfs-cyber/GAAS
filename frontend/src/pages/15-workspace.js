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
        '.ws-card__desc{font-size:13px;color:var(--ws-ink2);line-height:1.7;margin-bottom:12px;overflow-wrap:anywhere;}' +
        '.ws-detail-collapse summary{cursor:pointer;list-style:none;}' +
        '.ws-detail-collapse summary::-webkit-details-marker{display:none;}' +
        '.ws-detail-summary::after{content:" ▾";opacity:.6;}' +
        '.ws-detail-collapse[open] .ws-detail-summary::after{content:" ▴";}' +
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
        '.ws-perf-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;}' +
        '.ws-perf-head__title{font-size:20px;font-weight:700;color:var(--ws-ink);}' +
        '.ws-perf-head__sub{font-size:12.5px;color:var(--ws-ink2);}' +
        '.ws-perf-score{display:flex;align-items:baseline;gap:10px;margin-bottom:20px;}' +
        '.ws-perf-score__n{font-size:40px;font-weight:800;color:var(--ws-accent);line-height:1;}' +
        '.ws-perf-score__l{font-size:12.5px;color:var(--ws-ink2);}' +
        '.ws-perf-row{display:flex;align-items:center;gap:12px;margin-bottom:16px;}' +
        '.ws-perf-row__label{width:64px;flex:none;font-size:13px;color:var(--ws-ink);}' +
        '.ws-perf-row__bar{flex:1;height:6px;border-radius:3px;background:var(--ws-line);overflow:hidden;}' +
        '.ws-perf-row__fill{height:100%;border-radius:3px;}' +
        '.ws-perf-row__fill--up{background:var(--ws-up);} .ws-perf-row__fill--warn{background:var(--ws-warn);} .ws-perf-row__fill--down{background:var(--ws-down);}' +
        '.ws-perf-badge{flex:none;width:38px;height:30px;border-radius:15px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;}' +
        '.ws-perf-badge--up{background:rgba(134,201,162,.18);color:var(--ws-up);} .ws-perf-badge--warn{background:rgba(207,161,74,.18);color:var(--ws-warn);} .ws-perf-badge--down{background:rgba(229,139,152,.22);color:var(--ws-down);}' +
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
        // 2026-07-31：不再用"通知放最前面默认展开"这种霸占整页的方式吸引注意，改成通知有
        // 未读时用醒目边框+右上角脉冲红点，用户扫一眼就能注意到，但仍然默认停留在任务tab。
        '.ws-todo__tab{position:relative;}' +
        '.ws-todo__tab--alert{border-color:var(--ws-down);}' +
        '.ws-todo__dot{position:absolute;top:6px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--ws-down);animation:wsTodoPulse 1.4s ease-in-out infinite;}' +
        '@keyframes wsTodoPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(1.4);}}' +
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

// 2026-07-30：食品安全类任务的detail字段本身可以有几百字（数据来源速览+原文摘录+处置说明），
// 之前原样dump成一个<div>，字面的**加粗**标记不生效只显示星号，长文本又没有折叠，卡片被撑得
// 很长，操作按钮被挤到很下面看不到。这里补两件事：1) **text** 转成真正的<strong>；
// 2) 超过阈值的用原生<details>/<summary>折叠（同一套模式在09-resignation.js的
// ack-details已经在用），不新增inline onclick。
const WS_DETAIL_COLLAPSE_THRESHOLD = 120;
function wsFormatTaskDetail(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const rich = wsEsc(raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    if (raw.length <= WS_DETAIL_COLLAPSE_THRESHOLD) {
        return '<div class="ws-card__desc">' + rich + '</div>';
    }
    return (
        '<details class="ws-detail-collapse">' +
        '<summary class="ws-card__desc ws-detail-summary">详情（约' + raw.length + '字，点击展开）</summary>' +
        '<div class="ws-card__desc" style="margin-top:4px;">' + rich + '</div>' +
        '</details>'
    );
}

async function wsFetchJson(url) {
    try {
        if (typeof HRMS_API !== 'undefined' && HRMS_API && typeof HRMS_API.request === 'function') {
            return await HRMS_API.request(url, { method: 'GET' });
        }
        const r = await fetch(url, { headers: wsAuthHeaders() });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            const err = new Error(String(data?.message || data?.error || ('HTTP ' + r.status)));
            err.status = r.status;
            err.data = data;
            throw err;
        }
        return data;
    } catch (e) {
        return { __error: String(e?.message || e), status: e?.status || 0 };
    }
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
    // 2026-07-30 第一次修复：_ccOnly 表示这条任务不是指派给当前查看者的，只是按规则抄送
    // 给他知道（目前只有食品安全类是这样：仅hq_manager可判罚处理，管理员只是同步知悉）——
    // 当时只是渲染成静态文案"仅同步知悉，由责任人处理"，没有任何操作按钮。
    // 2026-07-30 第二次修复：用户明确指出"任务栏是要清空的队列，不是展示区"——不同角色对
    // "这条任务对我来说算完成了"的定义不一样：admin只需要"确认收到"（点一下，per-user
    // ack，不影响其他cc收件人还能不能看到）；hq_manager是唯一真正有权判罚食品安全的角色，
    // 需要输入判罚结果，任务才真正结案(status=resolved)，对所有人都消失。
    const isCcOnly = !!task._ccOnly;
    const isHqVerdictRole = String(currentUser?.role || '') === 'hq_manager';
    let actsHtml;
    if (isCcOnly && isHqVerdictRole) {
        actsHtml = '<button type="button" class="ws-btn ws-btn--primary" data-ws-verdict-toggle="' + wsEsc(task.task_id) + '">输入判罚结果</button>';
    } else if (isCcOnly) {
        actsHtml = '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" data-ws-ack-task="' + wsEsc(task.task_id) + '">确认收到</button>';
    } else if (isGrowthTask) {
        actsHtml = '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" data-ws-approve="' + wsEsc(task.task_id) + '">确认完成/批准</button>';
    } else if (isPendingReview) {
        actsHtml = '<span class="ws-tag">已提交，等待确认</span>';
    } else {
        actsHtml = '<button type="button" class="ws-btn ws-btn--primary" data-ws-respond-toggle="' + wsEsc(task.task_id) + '">提交完成证据</button>';
    }
    // 2026-07-30：用户明确要求任务栏改成跟"8大AI督导指挥中心"一样的折叠形式——默认只显示
    // 一行(标签+标题)，点开才展开详情/操作按钮，而不是像之前那样标题+标签+按钮always可见、
    // 只有超长detail文本才折叠。用<details>包一层，summary放"一行摘要"。
    const summaryLine =
        sevTag + ' ' + (task.store ? '<span class="ws-tag">' + wsEsc(task.store) + '</span> ' : '') +
        (isGrowthTask ? '<span class="ws-tag">经营诊断</span> ' : '') +
        wsEsc((showStoreSeparately ? task.store + ' — ' : '') + titleText);
    const bodyHtml =
        wsFormatTaskDetail(task.detail) +
        '<div class="ws-card__acts">' +
        actsHtml +
        (hideProgressLink || isGrowthTask ? '' : '<button type="button" class="ws-btn ws-btn--link" data-ws-open-task="' + wsEsc(task.task_id) + '">' + progressLabel + '</button>') +
        '</div>' +
        (isCcOnly && isHqVerdictRole
            ? '<div class="ws-respond-form" id="ws-verdict-form-' + wsEsc(task.task_id) + '" style="display:none;margin-top:8px;">' +
              '<textarea class="ws-input" rows="2" placeholder="判罚结果（如：门店负责人扣绩效X分，责令2周内整改）" data-ws-verdict-text></textarea>' +
              '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" style="margin-top:6px;" data-ws-verdict-submit="' + wsEsc(task.task_id) + '">提交判罚结果</button>' +
              '</div>'
            : (isGrowthTask || isPendingReview || isCcOnly ? '' :
                '<div class="ws-respond-form" id="ws-respond-form-' + wsEsc(task.task_id) + '" style="display:none;margin-top:8px;">' +
                '<textarea class="ws-input" rows="2" placeholder="完成说明（如：已完成XX人培训，附签字文件）" data-ws-respond-text></textarea>' +
                '<input type="file" multiple accept="image/*,.pdf" data-ws-respond-files style="margin-top:6px;">' +
                '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" style="margin-top:6px;" data-ws-respond-submit="' + wsEsc(task.task_id) + '">提交</button>' +
                '</div>'
            )
        ) +
        '<div class="ws-action-result"></div>';
    return (
        '<details class="ws-card ws-detail-collapse" data-task-id="' + wsEsc(task.task_id) + '" data-task-category="' + wsEsc(task.category || '') + '" data-task-source="' + wsEsc(task.source || 'master') + '" data-round-id="' + wsEsc(task.round_id || '') + '">' +
        '<summary class="ws-detail-summary" style="cursor:pointer;list-style:none;">' + summaryLine + '</summary>' +
        '<div style="margin-top:10px;">' + bodyHtml + '</div>' +
        '</details>'
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
        wsRemoveTaskCard(cardEl);
    } catch (e) {
        resultEl.innerHTML = '<span class="ws-err">提交失败：' + wsEsc(e?.message || e) + '</span>';
    }
}

// 2026-07-30：用户明确要求"任务栏是要清空的队列，不是展示区"——之前每个操作(提交证据/
// 批准/确认收到/判罚)成功后只是把按钮换成一行文字提示，卡片本身一直留在列表里，跟"清空"
// 的要求矛盾。统一改成：任一操作对当前查看者来说算完成后，直接把卡片从DOM里移除，并把
// "任务"tab角标数字减1（角标是渲染时的静态计数，删卡片不会自动联动，这里手动同步）。
function wsRemoveTaskCard(cardEl) {
    if (!cardEl) return;
    const tab = document.querySelector('[data-ws-todo-tab="task"] .ws-todo__n');
    if (tab) {
        const n = Math.max(0, (Number(tab.textContent) || 0) - 1);
        tab.textContent = String(n);
    }
    cardEl.remove();
}

function wsBindTaskCardEvents(root) {
    root.querySelectorAll('[data-ws-ack-task]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const taskId = btn.getAttribute('data-ws-ack-task');
            const card = btn.closest('.ws-card');
            const resultEl = card?.querySelector('.ws-action-result');
            btn.disabled = true;
            try {
                const r = await fetch('/api/workspace/tasks/' + encodeURIComponent(taskId) + '/ack', { method: 'POST', headers: wsAuthHeaders() });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
                wsRemoveTaskCard(card);
            } catch (e) {
                btn.disabled = false;
                if (resultEl) resultEl.innerHTML = '<span class="ws-err">确认失败：' + wsEsc(e?.message || e) + '</span>';
            }
        });
    });
    root.querySelectorAll('[data-ws-verdict-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-ws-verdict-toggle');
            const form = root.querySelector('#ws-verdict-form-' + taskId);
            if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
        });
    });
    root.querySelectorAll('[data-ws-verdict-submit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const taskId = btn.getAttribute('data-ws-verdict-submit');
            const card = btn.closest('.ws-card');
            const form = root.querySelector('#ws-verdict-form-' + taskId);
            const verdict = form?.querySelector('[data-ws-verdict-text]')?.value?.trim() || '';
            if (!verdict) { showNotification('请填写判罚结果', 'warning'); return; }
            const resultEl = card?.querySelector('.ws-action-result');
            btn.disabled = true;
            try {
                const r = await fetch('/api/workspace/tasks/' + encodeURIComponent(taskId) + '/food-safety-verdict', {
                    method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ verdict }),
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
                wsRemoveTaskCard(card);
            } catch (e) {
                btn.disabled = false;
                if (resultEl) resultEl.innerHTML = '<span class="ws-err">提交失败：' + wsEsc(e?.message || e) + '</span>';
            }
        });
    });
    root.querySelectorAll('[data-ws-respond-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-ws-respond-toggle');
            const form = root.querySelector('#ws-respond-form-' + taskId);
            if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
        });
    });
    root.querySelectorAll('[data-ws-respond-submit]').forEach((btn) => {
        btn.addEventListener('click', () => {
            // 2026-07-30：网络慢/服务重启期间用户反复点提交，按钮未disable导致同一任务被
            // 多次POST到/respond，后端又漏排除pending_review状态，堆积出98条重复"待确认"通知。
            if (btn.disabled) return;
            btn.disabled = true;
            const taskId = btn.getAttribute('data-ws-respond-submit');
            wsSubmitTaskResponse(taskId, btn.closest('.ws-card')).finally(() => { btn.disabled = false; });
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
                onSuccess: (cardEl) => wsRemoveTaskCard(cardEl),
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
// 2026-07-30：用户要求门店经营明细里补上"门店人效值"、把顶层"本月离职率"挪进来按店展示——
// 后端operationalMetrics()已经把efficiency/turnoverRate直接merge进每条门店记录，这里直接
// 取用，不用再单独请求一次。
function wsRenderStoreOperationalBody(row) {
    const p = row.partySizeSharePct || {};
    return wsStatRow('客流量（本月累计）', row.traffic ?? '—', '上月' + wsFmtPct(row.trafficMom) + ' 去年' + wsFmtPct(row.trafficYoy)) +
        wsStatRow('客单价', '¥' + (row.avgSpendPerGuest ?? '—')) +
        wsStatRow('桌均', '¥' + (row.avgSpendPerTable ?? '—')) +
        wsStatRow('门店人效值', row.efficiency ?? '—') +
        wsStatRow('堂食 / 外卖占比', (row.dineInSharePct ?? '—') + '% / ' + (row.deliverySharePct ?? '—') + '%') +
        wsStatRow('就餐人数分布', '1人' + (p.p1 ?? '—') + '% · 2人' + (p.p2 ?? '—') + '% · 3-4人' + (p.p3to4 ?? '—') + '% · 5-6人' + (p.p5to6 ?? '—') + '% · 6人以上' + (p.p6plus ?? '—') + '%') +
        wsStatRow('本月离职率', (row.turnoverRate ?? '—') + '%', row.turnoverRate != null ? '离职' + row.turnoverDepartures + '人 · 在职' + row.turnoverTotalEmployees + '人' : '');
}

// 2026-07-30 第一次修复：客流量/客单价/桌均/堂食外卖占比/就餐人数分布之前是全范围聚合成
// 一个数字，改成按店各返回一张<details>折叠卡片。
// 2026-07-30 第二次修复：门店一多（几十家）时逐店平铺卡片仍然不合理，即使折叠也要滚动
// 很久才能找到自己关心的店——改成一个门店选择下拉框，下面的数字只显示当前选中门店，
// 切换下拉框数字跟着变，不再要求用户逐店翻找。opRows缓存在模块级变量里给切换事件用，
// 这个工作台任何时刻只会渲染一个角色视图，不会有多份数据互相覆盖的问题。
let _wsLastOpRows = [];
function wsRenderOperationalSection(opRows) {
    _wsLastOpRows = Array.isArray(opRows) ? opRows : [];
    if (!_wsLastOpRows.length) return '<div class="ws-empty">暂无门店经营明细</div>';
    const options = _wsLastOpRows.map((r) => '<option value="' + wsEsc(r.store || '') + '">' + wsEsc(r.store || '未知门店') + '</option>').join('');
    return (
        '<div class="ws-section__title" style="font-size:14px;margin:10px 0 6px;">门店经营明细（选择门店查看）</div>' +
        '<select class="ws-input" id="ws-op-store-select">' + options + '</select>' +
        '<div class="ws-stat-list" id="ws-op-store-body" style="margin-top:8px;">' + wsRenderStoreOperationalBody(_wsLastOpRows[0]) + '</div>'
    );
}
function wsBindOperationalStoreSelector(root) {
    const sel = root.querySelector('#ws-op-store-select');
    if (!sel) return;
    sel.addEventListener('change', () => {
        const row = _wsLastOpRows.find((r) => r.store === sel.value);
        const body = root.querySelector('#ws-op-store-body');
        if (body && row) body.innerHTML = wsRenderStoreOperationalBody(row);
    });
}

// 2026-07-30：用户要求① 门店经营明细里加"门店人效值"、把"本月离职率"从顶层挪进去（每店
// 各自展示，不再是跨全部门店的一个聚合数字，operationalMetrics现在已经把efficiency/
// turnoverRate直接merge进每条门店记录里，这里直接渲染，不用单独再拼一份）；② 店长/出品
// 经理视角取消营业额/客流量/人效排名，管理员/总部经理视角保留——用showRankings区分，
// 由调用方(wsRenderStore传false，wsRenderBossOrHq传true)按角色决定，不是这里猜角色。
function wsRenderOverview(ov, showRankings) {
    if (!ov || ov.ok === false) return '<div class="ws-empty">经营数据加载失败</div>';
    const rev = ov.revenue || {};
    const opRows = Array.isArray(ov.operational) ? ov.operational : [];
    const rk = ov.rankings || {};
    let html = '<div class="ws-kpis">';
    html += wsRenderOverviewKpi('昨日营收', rev.yesterday || {}, '前天');
    html += wsRenderOverviewKpi('本周营收', rev.week || {}, '上周');
    html += wsRenderOverviewKpi('本月营收', rev.month || {}, '上月');
    html += '<div class="ws-kpi"><div class="ws-kpi__label">实收目标</div><div class="ws-kpi__value">¥' + wsFmtMoney(rev.target?.targetRevenue) + '</div>' +
        '<div class="ws-kpi__sub">理论 ' + (rev.target?.theoreticalAchievementRate ?? '—') + '% · 实际 ' + (rev.target?.actualAchievementRate ?? '—') + '%</div></div>';
    html += '</div>';

    html += wsRenderOperationalSection(opRows);

    if (showRankings) {
        html += '<div class="ws-rank-grid">' +
            wsRenderStoreRankList('营业额排名', rk.byRevenue, (r) => '¥' + wsFmtMoney(r.revenue)) +
            wsRenderStoreRankList('客流量排名', rk.byTraffic, (r) => r.traffic) +
            wsRenderStoreRankList('人效排名', rk.byEfficiency, (r) => r.efficiency) +
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

// ── 门店营销活动建议（数据来自growth_actions，由campaign-autopilot/growth-touch-rules/
// agent-collaboration等多个触发源各自按自己的条件写入，不是单一固定的"每天几点跑一次"的
// cron——生成频率跟随实际触发条件变化，"每天5条"只是历史观察到的近似数量，不是保证值）。
// 线下/线上分类是按 action_type 关键词做的近似分类。
// 2026-07-30：① 跟任务卡片一样加长文本折叠；② 补"执行/忽略"操作，复用增长看板
// 已有的 /api/growth/actions/:key/execute 与 /ignore 接口（同一张growth_actions表，
// 同一套状态机，不新建接口）。
// 2026-07-30：用户反馈"执行"按钮点了等于什么都没发生——promo_task这类内容创作型建议，
// 之前的executeGrowthActionRecord只是往growth_content_calendar插一行'planned'，没有责任人、
// 没人知道要去做、没有任何完成追踪。业务方明确要求：所有类型的营销建议"执行"都必须先选
// 责任人（该门店的店长/前厅主管），生成真实任务，责任人任务栏能看到、需要提交完成证据、
// 发起人确认后才算真正执行完成。这里把原来"点执行直接调用/execute"改成"点执行先展开责任人
// 选择框"，选完调用新的/assign-and-execute；责任人列表用HRMS_STORE.getEmployees()按门店+
// 角色(store_manager/front_manager)过滤，不用额外接口。
// 2026-07-30 第一次修复：几乎每次都提示"本店未配置店长/前厅主管"——查证发现HRMS_STORE
// 本地员工数据里role字段有不少还是历史遗留的中文标签("店长"/"前厅主管"等)，不是标准化后
// 的role code，直接用===比较'store_manager'/'front_manager'必然漏掉这些人。改用现成的
// hrmsNormalizeRoleCode()（01-boot.js里到处在用的同一套归一化，不新写一套）先转换再比较。
// 2026-07-30 第二次修复：用户反馈责任人下拉框里出现了离职员工——之前的过滤只看role+store，
// 完全没有排除已离职/停用的人。跟09-resignation.js里"离职/停用员工不能再被指派"的既有判断
// 保持一致：status为'离职'或'inactive'的一律排除，只有在职('active'，或未设置时默认视为在职
// 的历史数据)才能出现在责任人候选里。
function wsMarketingAssigneeOptions(store) {
    const employees = (typeof HRMS_STORE !== 'undefined' && HRMS_STORE.getEmployees) ? (HRMS_STORE.getEmployees() || []) : [];
    const eligible = employees.filter((e) => {
        if (String(e?.store || '') !== String(store || '')) return false;
        const status = String(e?.status || 'active');
        if (status === '离职' || status === 'inactive') return false;
        const role = (typeof hrmsNormalizeRoleCode === 'function') ? hrmsNormalizeRoleCode(e?.role) : String(e?.role || '');
        return ['store_manager', 'front_manager'].includes(role);
    });
    if (!eligible.length) return { html: '', empty: true };
    return {
        html: eligible.map((e) => '<option value="' + wsEsc(e.username) + '">' + wsEsc(e.name || e.username) + '（' + wsEsc(getRoleDisplayName ? getRoleDisplayName(e.role) : e.role) + '）</option>').join(''),
        empty: false,
    };
}
// 2026-07-30：用户问"用户如何知道这个营销方案投放在哪里"——之前只显示线上/线下粗分类，
// 补上真实渠道名称的中文展示（后端已经透出payload.channel，见marketing-suggestions.js）。
const WS_CHANNEL_LABELS = {
    wecom: '企业微信', sms: '短信', dianping: '大众点评', pengyouquan: '朋友圈',
    xiaohongshu: '小红书', douyin: '抖音', meituan: '美团', member: '会员小程序',
};
function wsChannelLabel(it) {
    const name = String(it?.channelName || '').trim().toLowerCase();
    return WS_CHANNEL_LABELS[name] || name || '';
}
// 2026-07-30：用户要求"滚动更新"后加一个未读标记区分新旧——用localStorage记录已经看过的
// actionKey，本次渲染时先判断是否已见过，渲染完再把当前这批全部标记为已见，下次刷新只有
// 真正新出现的建议才会带"新"标签。
const WS_MARKETING_SEEN_KEY = 'ws_marketing_suggestions_seen';
function wsMarketingSeenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(WS_MARKETING_SEEN_KEY) || '[]')); } catch (e) { return new Set(); }
}
function wsMarketingMarkSeen(actionKeys) {
    try {
        const seen = wsMarketingSeenSet();
        actionKeys.forEach((k) => seen.add(k));
        // 只保留最近500个，避免localStorage无限增长
        localStorage.setItem(WS_MARKETING_SEEN_KEY, JSON.stringify([...seen].slice(-500)));
    } catch (e) { /* ignore */ }
}
// 2026-07-31：PLLM策略实验卡片——每条方案本身就是"结合门店真实异常信号(差评/流失/储值等)
// 生成的可直接执行A/B方案+逐日执行指引"，跟通用营销建议单方案卡片结构不同，需要专门渲染
// 两个variant。采纳/不适合复用增长看板同一套接口(/api/strategy-experiments/:code/
// approve|reject)，权限跟接口一致仅admin/hq_manager可操作，其它角色只读展示（了解总部
// 在为自己门店评估什么方案，不重复造一套权限判断）。
// 2026-07-31：用户反馈"点了执行就没有下文了"——之前采纳只是把实验状态改成running，
// 从没让总部选择"这个方案具体交给哪个人执行"，approve接口其实早就支持storeAssignments
// (每个variant各自的门店+责任人)，只是从来没有调用方真正收集过这个信息、传进去。
// 补上：每个variant配一个责任人下拉框（复用wsMarketingAssigneeOptions按门店过滤在职
// 店长/前厅主管），采纳时把选择打包成storeAssignments一起提交。
function wsRenderPllmExperimentCard(it, seen) {
    const isNew = it.actionKey && !seen.has(it.actionKey);
    const canDecide = ['admin', 'hq_manager'].includes(String(currentUser?.role || ''));
    // 2026-07-31：strategy_variants表只有action/execution_guide两个文本列，没有独立的
    // channel/ready_copy/image_requirement/duration_days/target_kpi/cost_estimate列——
    // agents-service-v2那边已经把这些字段折叠进action文本一起返回，这里用wsFormatTaskDetail
    // 保留换行/长文本折叠展示，不再假设有独立字段。
    const variantsHtml = (it.variants || []).map((v) => {
        const assignees = canDecide ? wsMarketingAssigneeOptions(v.store) : { empty: true };
        return (
            '<div class="ws-card__desc" style="margin-top:8px;padding:8px 10px;background:rgba(134,201,162,0.05);border:1px solid rgba(134,201,162,0.18);border-radius:8px;">' +
            '<div style="font-weight:700;margin-bottom:4px;">方案' + wsEsc(v.variantCode || '') + (v.label ? ' — ' + wsEsc(v.label) : '') + '（' + wsEsc(v.store || '') + '）</div>' +
            wsFormatTaskDetail(v.action) +
            (v.executionGuide ? '<div style="margin-top:4px;opacity:.7;font-size:11px;">' + wsEsc(v.executionGuide) + '</div>' : '') +
            (canDecide
                ? '<div style="margin-top:8px;">责任人：' +
                  (assignees.empty
                      ? '<span style="opacity:.6;">本店未配置店长/前厅主管，暂无法分配</span>'
                      : '<select class="ws-input" data-ws-pllm-assignee="' + wsEsc(v.variantCode || '') + '" style="width:100%;margin-top:4px;">' + assignees.html + '</select>')
                  + '</div>'
                : '') +
            '</div>'
        );
    }).join('');
    return (
        '<details class="ws-card ws-detail-collapse" data-action-key="' + wsEsc(it.actionKey || '') + '" data-marketing-store="' + wsEsc(it.store || '') + '">' +
        '<summary class="ws-detail-summary" style="cursor:pointer;list-style:none;">' +
        (isNew ? '<span class="ws-tag" style="background:#e74c3c;color:#fff;">新</span> ' : '') +
        '<span class="ws-tag" style="background:rgba(209,143,160,0.18);color:#D18FA0;">🎯 PLLM策略实验</span> ' +
        wsEsc((it.store || '') + ' — ' + (it.title || '')) +
        '</summary>' +
        '<div style="margin-top:10px;">' +
        (it.anomalyType ? '<div class="ws-card__desc">触发信号：' + wsEsc(it.anomalyType) + (it.goal ? '（' + wsEsc(it.goal) + '）' : '') + '</div>' : '') +
        variantsHtml +
        (canDecide
            ? '<div class="ws-card__acts">' +
              '<button type="button" class="ws-btn ws-btn--primary" data-ws-pllm-approve="' + wsEsc(it.actionKey || '') + '">采纳·分配责任人执行</button>' +
              '<button type="button" class="ws-btn" data-ws-pllm-reject="' + wsEsc(it.actionKey || '') + '">不适合</button>' +
              '</div>'
            : '<div class="ws-card__desc" style="opacity:.6;">待总部审批决策，暂不需要门店操作</div>') +
        '<div class="ws-action-result"></div>' +
        '</div>' +
        '</details>'
    );
}
async function wsRenderMarketingSuggestions() {
    const data = await wsFetchJson('/api/workspace/marketing-suggestions');
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return '<div class="ws-empty">近期暂无待执行的营销建议</div>';
    const seen = wsMarketingSeenSet();
    // 2026-07-30：跟任务卡片一样，改成折叠形式——默认只显示一行(渠道标签+门店+标题)，
    // 点开才展开详情和执行/忽略按钮，跟8大AI督导指挥中心的记录展示保持一致。
    const html = items.map((it) => {
        // 2026-07-31：用户反馈增长看板"PLLM策略实验"卡片(结合门店真实差评/流失等异常信号生成
        // 的A/B方案+逐日执行步骤)质量远高于这里的通用模板文案——把这个数据源接进来(见
        // marketing-suggestions.js的getStrategyExperimentSuggestions)，用专门的卡片渲染
        // 完整展示两个方案，不能沿用下面通用建议的单方案卡片结构。
        if (it.kind === 'pllm_experiment') return wsRenderPllmExperimentCard(it, seen);
        const assignees = wsMarketingAssigneeOptions(it.store);
        const isNew = it.actionKey && !seen.has(it.actionKey);
        return (
            '<details class="ws-card ws-detail-collapse" data-action-key="' + wsEsc(it.actionKey || '') + '" data-marketing-store="' + wsEsc(it.store || '') + '">' +
            '<summary class="ws-detail-summary" style="cursor:pointer;list-style:none;">' +
            (isNew ? '<span class="ws-tag" style="background:#e74c3c;color:#fff;">新</span> ' : '') +
            '<span class="ws-tag">' + (it.channel === 'online' ? '线上' : '线下') + (wsChannelLabel(it) ? '·' + wsEsc(wsChannelLabel(it)) : '') + '</span> ' +
            wsEsc((it.store || '') + ' — ' + (it.title || '')) +
            '</summary>' +
            '<div style="margin-top:10px;">' +
            (wsChannelLabel(it) ? '<div class="ws-card__desc">发布渠道：' + wsEsc(wsChannelLabel(it)) + '（点击执行后需门店责任人在该渠道手动发布并确认，系统不会自动群发）</div>' : '') +
            wsFormatTaskDetail(it.detail) +
            '<div class="ws-card__acts">' +
            '<button type="button" class="ws-btn ws-btn--primary" data-ws-marketing-execute-toggle="' + wsEsc(it.actionKey || '') + '">执行</button>' +
            '<button type="button" class="ws-btn" data-ws-marketing-ignore="' + wsEsc(it.actionKey || '') + '">忽略</button>' +
            '</div>' +
            '<div class="ws-respond-form" id="ws-marketing-assign-form-' + wsEsc(it.actionKey || '') + '" style="display:none;margin-top:8px;">' +
            (assignees.empty
                ? '<div class="ws-empty">本店未配置店长/前厅主管，无法分配责任人——请先在员工档案里补上岗位</div>'
                : '<select class="ws-input" data-ws-marketing-assignee-select style="width:100%;margin-bottom:6px;">' + assignees.html + '</select>' +
                  '<button type="button" class="ws-action-btn ws-btn ws-btn--primary" data-ws-marketing-assign-submit="' + wsEsc(it.actionKey || '') + '">确认分配并执行</button>'
            ) +
            '</div>' +
            '<div class="ws-action-result"></div>' +
            '</div>' +
            '</details>'
        );
    }).join('');
    wsMarketingMarkSeen(items.map((it) => it.actionKey).filter(Boolean));
    return html;
}

function wsBindMarketingSuggestionsEvents(root) {
    // 2026-07-31：PLLM策略实验的采纳/不适合——复用增长看板同一套接口，不新建。
    root.querySelectorAll('[data-ws-pllm-approve]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            // 2026-07-31：用户反馈"点了执行就没有下文了"——之前采纳完全不收集责任人，approve
            // 接口早就支持storeAssignments却从没有调用方真正传过。这里收集每个variant的
            // 责任人下拉框选择，一起提交，让方案真正落到具体人身上。
            const card = btn.closest('.ws-card');
            const assigneeSelects = card ? [...card.querySelectorAll('[data-ws-pllm-assignee]')] : [];
            const storeAssignments = assigneeSelects
                .map((sel) => ({ variantCode: sel.getAttribute('data-ws-pllm-assignee'), assigneeUsername: sel.value }))
                .filter((a) => a.assigneeUsername);
            if (assigneeSelects.length && !storeAssignments.length) {
                showNotification('请至少为一个方案选择责任人', 'warning');
                return;
            }
            if (!confirm('采纳此PLLM策略实验方案？\n\n将分配给所选责任人，请人工按方案执行。')) return;
            const code = btn.getAttribute('data-ws-pllm-approve');
            const resultEl = card?.querySelector('.ws-action-result');
            btn.disabled = true;
            try {
                const r = await fetch('/api/strategy-experiments/' + encodeURIComponent(code) + '/approve', {
                    method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ storeAssignments }),
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
                if (resultEl) resultEl.innerHTML = '<span class="ws-ok">已采纳并分配责任人，请按方案执行</span>';
                card?.querySelector('.ws-card__acts')?.remove();
            } catch (e) {
                btn.disabled = false;
                if (resultEl) resultEl.innerHTML = '<span class="ws-err">采纳失败：' + wsEsc(e?.message || e) + '</span>';
            }
        });
    });
    root.querySelectorAll('[data-ws-pllm-reject]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!confirm('标记为不适合执行？该实验将从待审批列表中移除。')) return;
            const code = btn.getAttribute('data-ws-pllm-reject');
            const resultEl = btn.closest('.ws-card')?.querySelector('.ws-action-result');
            btn.disabled = true;
            try {
                const r = await fetch('/api/strategy-experiments/' + encodeURIComponent(code) + '/reject', { method: 'POST', headers: wsAuthHeaders() });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
                if (resultEl) resultEl.innerHTML = '<span class="ws-ok">已标记为不适合</span>';
                btn.closest('.ws-card__acts')?.remove();
            } catch (e) {
                btn.disabled = false;
                if (resultEl) resultEl.innerHTML = '<span class="ws-err">操作失败：' + wsEsc(e?.message || e) + '</span>';
            }
        });
    });
    root.querySelectorAll('[data-ws-marketing-execute-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-ws-marketing-execute-toggle');
            const form = root.querySelector('#ws-marketing-assign-form-' + CSS.escape(key));
            if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
        });
    });
    root.querySelectorAll('[data-ws-marketing-assign-submit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const key = btn.getAttribute('data-ws-marketing-assign-submit');
            const card = btn.closest('.ws-card');
            const form = root.querySelector('#ws-marketing-assign-form-' + CSS.escape(key));
            const assigneeUsername = form?.querySelector('[data-ws-marketing-assignee-select]')?.value || '';
            if (!assigneeUsername) { showNotification('请选择责任人', 'warning'); return; }
            const resultEl = card?.querySelector('.ws-action-result');
            btn.disabled = true;
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(key) + '/assign-and-execute', {
                    method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ assigneeUsername })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
                if (resultEl) resultEl.innerHTML = '<span class="ws-ok">已分配任务，等待责任人提交完成证据后确认闭环</span>';
                if (card) card.querySelector('.ws-card__acts')?.remove();
                if (form) form.remove();
            } catch (e) {
                btn.disabled = false;
                if (resultEl) resultEl.innerHTML = '<span class="ws-err">分配失败：' + wsEsc(e?.message || e) + '</span>';
            }
        });
    });
    root.querySelectorAll('[data-ws-marketing-ignore]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const key = btn.getAttribute('data-ws-marketing-ignore');
            const reason = prompt('请输入忽略原因', '当前不适合执行');
            if (reason === null) return;
            const card = btn.closest('.ws-card');
            const resultEl = card?.querySelector('.ws-action-result');
            btn.disabled = true;
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(key) + '/ignore', {
                    method: 'POST', headers: wsAuthHeaders(), body: JSON.stringify({ reason })
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
                // 2026-07-30：用户要求"忽略后直接清除补充一条新的建议"——之前忽略成功只是
                // 隐藏掉这张卡片的按钮，列表里其它建议不动，也不会补上新的一条。改成重新
                // 拉取整个建议区块：后端已把这条标记为ignored（不再是proposed），重新查询
                // 会自然把它排除掉，同时把候选池里下一条未展示过的建议顶上来。
                const container = document.getElementById('ws-marketing-suggestions-body');
                if (container) {
                    container.innerHTML = await wsRenderMarketingSuggestions();
                    wsBindMarketingSuggestionsEvents(container);
                } else if (resultEl) {
                    resultEl.innerHTML = '<span class="ws-ok">已忽略</span>';
                    card?.querySelector('.ws-card__acts')?.remove();
                }
            } catch (e) {
                btn.disabled = false;
                if (resultEl) resultEl.innerHTML = '<span class="ws-err">忽略失败：' + wsEsc(e?.message || e) + '</span>';
            }
        });
    });
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
    const activeChip = container.querySelector('.ws-br-chip[data-days].active');
    const days = activeChip ? Number(activeChip.getAttribute('data-days') || 0) : 30;
    const { start, end } = wsDateRangeFromChip(days);
    // 2026-08-01：用户要求差评展示支持按来源筛选（桌访/大众点评/外卖），跟日期chip同款交互。
    const activeSourceChip = container.querySelector('.ws-br-source-chip.active');
    const sourceType = activeSourceChip ? (activeSourceChip.getAttribute('data-source') || '') : '';
    const qs = new URLSearchParams();
    if (store) qs.set('store', store);
    if (start) qs.set('startDate', start);
    if (end) qs.set('endDate', end);
    if (sourceType) qs.set('sourceType', sourceType);
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

// 2026-07-30：店长/出品经理反馈差评展示的门店筛选框显示"全部门店"，应该直接显示自己
// 所属门店名字——之前不管allStores里有几家店，都无条件在最前面加一个"全部门店"选项，
// 单店角色也会看到这个选项(且默认选中)，容易误以为自己能看到别的店。allStores长度为1
// (单店角色场景)时，直接把这一家店的名字设成唯一/默认选中项，不再提供"全部门店"这个
// 对单店角色毫无意义的选项；多店/不限场景(admin/hq_manager)保留原有的"全部门店"+完整列表。
function wsRenderBadReviewSection(allStores) {
    const stores = allStores || [];
    const isSingleStore = stores.length === 1;
    const storeOptions = isSingleStore
        ? '<option value="' + wsEsc(stores[0]) + '" selected>' + wsEsc(stores[0]) + '</option>'
        : '<option value="">全部门店</option>' + stores.map((s) => '<option value="' + wsEsc(s) + '">' + wsEsc(s) + '</option>').join('');
    return (
        '<div class="ws-br-filters">' +
        '<button type="button" class="ws-br-chip" data-days="7">近7天</button>' +
        '<button type="button" class="ws-br-chip active" data-days="30">近30天</button>' +
        '<button type="button" class="ws-br-chip" data-days="0">全部</button>' +
        '<select class="ws-input" id="ws-br-store" style="flex:none;"' + (isSingleStore ? ' disabled' : '') + '>' + storeOptions + '</select>' +
        '</div>' +
        '<div class="ws-br-filters" style="margin-top:4px;">' +
        '<button type="button" class="ws-br-chip ws-br-source-chip active" data-source="">全部来源</button>' +
        '<button type="button" class="ws-br-chip ws-br-source-chip" data-source="table_visit">桌访</button>' +
        '<button type="button" class="ws-br-chip ws-br-source-chip" data-source="platform_dianping">大众点评</button>' +
        '<button type="button" class="ws-br-chip ws-br-source-chip" data-source="platform_delivery">外卖</button>' +
        '</div>' +
        '<div class="ws-br-feed" id="ws-br-feed"><div class="ws-empty">加载中...</div></div>'
    );
}

function wsBindBadReviewEvents(root) {
    // 2026-08-01：来源筛选chip跟日期chip共用.ws-br-chip视觉样式，但各自是独立的单选组——
    // 用[data-days]/.ws-br-source-chip分开选择器，避免点其中一组清掉另一组的active状态。
    root.querySelectorAll('.ws-br-chip[data-days]').forEach((chip) => {
        chip.addEventListener('click', () => {
            root.querySelectorAll('.ws-br-chip[data-days]').forEach((c) => c.classList.remove('active'));
            chip.classList.add('active');
            wsLoadBadReviews(root);
        });
    });
    root.querySelectorAll('.ws-br-source-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            root.querySelectorAll('.ws-br-source-chip').forEach((c) => c.classList.remove('active'));
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

// 2026-07-30：用户反馈"最近查询记录"数据一多就是一整片按钮墙，看不出哪条是哪天问的——
// 改成<details>折叠(默认收起，摘要显示条数)，每条按钮上补日期前缀，不再是光秃秃的标题。
async function wsLoadCustomHistory(store) {
    const host = document.getElementById('ws-custom-history');
    if (!host || !store) return;
    const data = await wsFetchJson('/api/diagnosis/solutions/custom/history?store=' + encodeURIComponent(store) + '&limit=10');
    const history = Array.isArray(data?.history) ? data.history : [];
    if (!history.length) { host.innerHTML = ''; return; }
    host.innerHTML =
        '<details class="ws-detail-collapse"><summary class="ws-section__title ws-detail-summary" style="font-size:11.5px;cursor:pointer;">最近查询记录（' + history.length + '条，点击查看，点开后可直接查询不用重新输入）</summary>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' +
        history.map((h) => '<button type="button" class="ws-btn" data-ws-history-q="' + wsEsc(h.question) + '">' + wsEsc(String(h.created_at || '').slice(0, 10)) + ' · ' + wsEsc(h.title || h.question) + '</button>').join('') +
        '</div></details>';
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
        // 2026-07-30：用户反馈"每次查询后不会留下记录"——查证生产库确认后端其实一直有真实
        // 写入(saveQueryHistory)，问题出在前端："最近查询记录"只在页面刚打开时加载过一次，
        // 提交新查询后从来没有重新拉取过，所以看到的永远是上次打开页面时的旧列表。这里补上
        // 查询成功后重新拉取一次。
        wsLoadCustomHistory(store);
        if (!r.ok || d?.ok === false) throw new Error(d?.error || ('HTTP ' + r.status));
        if (d.mode === 'existing') {
            resultEl.innerHTML = '<div class="ws-card"><div class="ws-card__desc">' + wsEsc(d.reason || '') + '</div><div class="ws-card__desc">' + wsEsc(d.analysis || '') + '</div>' +
                '<div class="ws-card__acts"><button type="button" class="ws-btn ws-btn--link" data-ws-jump-key="' + wsEsc(d.problem_key) + '">这属于"' + wsEsc((WS_SIX_TOOLS.find((t) => t.key === d.problem_key) || {}).label || d.problem_key) + '"标准方案，点击查看 →</button></div></div>';
            // 2026-07-30：用户反馈"点击查看"没有反应——实际上点击后确实触发了加载，只是结果
            // 写进了页面下方"六大管理神器"区块自己的容器(#ws-six-tool-body)，跟这里点击的
            // 位置离得远，用户看不到任何变化、以为按钮坏了。补一个滚动到目标区块，让结果
            // 真正"看得见"。
            resultEl.querySelector('[data-ws-jump-key]')?.addEventListener('click', (e) => {
                const key = e.target.getAttribute('data-ws-jump-key');
                const panel = document.getElementById('ws-six-tool-panel');
                // 2026-07-30 二次修复：上次只补了scrollIntoView，但面板默认display:none，
                // 滚动到一个隐藏元素当然毫无视觉反应——用户反馈"点了还是没反应"是对的。
                // 必须先把面板显示出来（跟顶部六大管理神器按钮的点击逻辑保持一致）。
                if (panel) panel.style.display = '';
                panel?.setAttribute('data-active-key', key);
                wsLoadSixToolPlan(key, store).then(() => {
                    document.getElementById('ws-six-tool-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
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
// 2026-07-30：之前记录只是纯文本行，"closed"这类状态点了没反应，用户看不出这是什么、
// 什么时候关闭的、有没有人处理过。改成点击展开详情（复用已有的GET /api/agent-task-board/
// tasks/:id，本来就是同一批admin/hq_manager在用，权限一致），展示状态流转时间线+证据+
// 审核记录；这个页面本身就只有admin/hq_manager能看到，不是新开权限口子。
// 2026-07-30：用户反馈折叠后的记录"很难辨识"、条数多了根本找不到——两个问题：① 每条记录
// 只有标题+状态，没有日期，标题又经常被截断，看不出是哪天的任务；② 没有筛选，"已结案"的
// 历史记录跟"正在进行"的混在一起，找一条正在处理的任务要翻很久。改成：① 每条摘要行补上
// created_at日期；② 加状态筛选下拉框，默认只显示"进行中"（board_status不是已结案系列），
// 需要查历史时手动切到"全部"。用WS_BOARD_STATUS_ZH的'已结案'分组结果判断是否算结案。
const WS_ATB_CLOSED_STATUSES = new Set(['resolved', 'pending_settlement', 'settled', 'closed']);
let _wsAtbAllItems = [];
function wsRenderAtbList(filter) {
    const items = filter === 'all' ? _wsAtbAllItems : _wsAtbAllItems.filter((it) => !WS_ATB_CLOSED_STATUSES.has(String(it.status || '')));
    if (!items.length) return '<div class="ws-empty">' + (filter === 'all' ? '暂无记录' : '暂无进行中的记录（可切换"全部"查看历史）') + '</div>';
    return items.map((it) => (
        '<div class="ws-rank-row ws-atb-row" data-atb-task-id="' + wsEsc(it.task_id || it.id || '') + '" style="cursor:pointer;">' +
        '<span class="ws-rank-row__store">' + wsEsc(String(it.created_at || '').slice(0, 10)) + ' · ' + wsEsc(it.title || it.content || '') + '</span>' +
        '<span class="ws-tag">' + wsEsc(wsBoardStatusZh(it.board_status || it.status)) + '</span></div>' +
        '<div class="ws-atb-detail" data-atb-detail-for="' + wsEsc(it.task_id || it.id || '') + '" style="display:none;"></div>'
    )).join('');
}
async function wsLoadAgentBoardList(container) {
    const list = container.querySelector('#ws-atb-list');
    if (!list) return;
    const data = await wsFetchJson('/api/agent-task-board/tasks?limit=20');
    _wsAtbAllItems = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data?.items) ? data.items : []);
    const filterSel = container.querySelector('#ws-atb-filter');
    list.innerHTML = wsRenderAtbList(filterSel?.value || 'active');
}

// 2026-07-30：跟后端 task-parser.js 的 mapBoardStatus() 保持一致的中文映射，用在时间线上
// （列表本身已经改用后端算好的 board_status 字段，这里events.status_before/after是原始
// 状态枚举，后端没有顺带映射，前端补一份一致的翻译，不新开接口）。
const WS_BOARD_STATUS_ZH = {
    pending_audit: '待解析', auditing: '待解析',
    pending_dispatch: '已领取',
    dispatched: '已分配', viewed: '已分配',
    in_progress: '已执行', waiting_evidence: '已执行',
    pending_response: '已完成',
    pending_review: '待验收',
    resolved: '已结案', pending_settlement: '已结案', settled: '已结案', closed: '已结案',
    rejected: '已打回',
    escalated: '已升级',
    hr_filed: '已备案',
};
// 2026-07-30：用户反馈状态流转记录里"未知"这个词看着像出错——查证发现这是任务刚创建时
// (event_type='task_created')那条记录的status_before字段，数据库里存的就是空字符串（任务
// 创建前当然没有"之前的状态"），不是数据缺失或异常。改成明确写"任务创建前"，不再用容易
// 让人以为系统坏了的"未知"。
function wsBoardStatusZh(s) {
    if (!s) return '任务创建前';
    return WS_BOARD_STATUS_ZH[s] || s;
}

// 2026-08-01：用户反馈状态流转看不清——两个真实问题：① to_agent直接回显英文agent key
// （ops_supervisor/data_auditor等），门店发起人根本看不懂；② 催办事件(reminder_card_sent/
// reminder_sent)本身不改变status字段(还是dispatched)，之前直接按status_before→after
// 渲染，连续几行全是"已分配→已分配"，看不出这是"没人管"还是"系统正在催办"。改成：催办
// 事件单独渲染成"催办中（第N次）"；agent key经wsAgentKeyZh翻译成中文岗位名；自动备案
// (hr_filed)单独标注"多次催办无响应，系统自动归档"，不再是普普通通一行状态转移。
const WS_AGENT_KEY_ZH = {
    ops_supervisor: '运营督导', food_quality: '食安专员', train_advisor: '培训顾问',
    marketing_planner: '营销策划', marketing_executor: '营销执行', data_auditor: '数据审计',
    master: '调度中枢', task_watchdog: '系统监控', reminder_queue: '催办队列',
    task_orchestrator: '任务编排', review_handler: '审核处理', agent: 'Agent',
};
function wsAgentKeyZh(key) {
    return WS_AGENT_KEY_ZH[key] || key;
}
function wsFormatAtbEventLine(e) {
    const time = wsEsc(String(e.created_at || '').slice(0, 16).replace('T', ' '));
    if (e.event_type === 'reminder_card_sent' || e.event_type === 'reminder_sent') {
        const n = e.payload?.reminderCount;
        return time + ' <strong>催办中</strong>' + (n ? '（第' + wsEsc(String(n)) + '次催办，责任人尚未响应）' : '（责任人尚未响应）');
    }
    if (e.status_after === 'hr_filed') {
        return time + ' <strong>已备案</strong>（多次催办无响应，系统自动归档，需人工介入）';
    }
    const before = wsBoardStatusZh(e.status_before);
    const after = wsBoardStatusZh(e.status_after);
    const agent = e.to_agent ? '（' + wsEsc(wsAgentKeyZh(e.to_agent)) + '）' : '';
    return time + ' ' + wsEsc(before) + ' → ' + wsEsc(after) + agent;
}

function wsFormatAgentBoardDetail(task) {
    if (!task) return '<div class="ws-card__desc">加载失败或记录不存在</div>';
    const rows = [];
    rows.push('<div class="ws-card__desc">' + wsEsc(task.detail || task.content || '（无详情）') + '</div>');
    if (task.store) rows.push('<div class="ws-card__desc">门店：' + wsEsc(task.store) + '</div>');
    const events = Array.isArray(task.events) ? task.events : [];
    if (events.length) {
        rows.push('<div class="ws-card__desc" style="font-weight:600;margin-top:6px;">状态流转</div>');
        rows.push(events.map((e) =>
            '<div class="ws-card__desc" style="margin-bottom:2px;">' + wsFormatAtbEventLine(e) + '</div>'
        ).join(''));
    }
    const evidences = Array.isArray(task.evidences) ? task.evidences : [];
    if (evidences.length) {
        rows.push('<div class="ws-card__desc" style="font-weight:600;margin-top:6px;">提交证据</div>');
        rows.push(evidences.map((e) =>
            '<div class="ws-card__desc" style="margin-bottom:2px;">' +
            wsEsc(String(e.created_at || '').slice(0, 16).replace('T', ' ')) + ' ' +
            wsEsc(e.submitted_by || '') + '：' + wsEsc(e.content || e.evidence_type || '') + '</div>'
        ).join(''));
    }
    const reviews = Array.isArray(task.reviews) ? task.reviews : [];
    if (reviews.length) {
        rows.push('<div class="ws-card__desc" style="font-weight:600;margin-top:6px;">审核记录</div>');
        rows.push(reviews.map((r) =>
            '<div class="ws-card__desc" style="margin-bottom:2px;">' +
            wsEsc(String(r.created_at || '').slice(0, 16).replace('T', ' ')) + ' ' +
            wsEsc(r.reviewed_by || '') + '：' + wsEsc(r.decision || '') + (r.comment ? '（' + wsEsc(r.comment) + '）' : '') + '</div>'
        ).join(''));
    }
    return rows.join('');
}

function wsBindAgentBoardListClick(root) {
    const list = root.querySelector('#ws-atb-list');
    if (!list || list.dataset.atbClickBound) return;
    list.dataset.atbClickBound = '1';
    list.addEventListener('click', async (ev) => {
        const row = ev.target.closest('.ws-atb-row');
        if (!row) return;
        const taskId = row.dataset.atbTaskId;
        if (!taskId) return;
        const detailEl = list.querySelector('.ws-atb-detail[data-atb-detail-for="' + CSS.escape(taskId) + '"]');
        if (!detailEl) return;
        const isOpen = detailEl.style.display !== 'none';
        if (isOpen) { detailEl.style.display = 'none'; return; }
        detailEl.style.display = 'block';
        // 2026-08-01：用户反馈状态流转"要更新"——查证发现详情之前用_wsAtbDetailCache永久
        // 缓存，第一次打开后不管过多久重新打开都是当时的旧数据，看不到之后新增的催办/备案
        // 事件。改成每次打开都重新拉取最新数据，不再依赖缓存（这类详情本身访问频率不高，
        // 不需要为了省一次请求牺牲数据新鲜度）。
        detailEl.innerHTML = '<div class="ws-card__desc">加载中...</div>';
        try {
            const d = await wsFetchJson('/api/agent-task-board/tasks/' + encodeURIComponent(taskId));
            detailEl.innerHTML = wsFormatAgentBoardDetail(d?.task);
        } catch (e) {
            detailEl.innerHTML = '<div class="ws-card__desc ws-err">加载失败：' + wsEsc(e?.message || e) + '</div>';
        }
    });
}

function wsRenderAgentCommandCenter() {
    return (
        '<div class="ws-promote-form" style="flex-direction:column;">' +
        '<textarea class="ws-input" id="ws-atb-content" rows="3" placeholder="例：洪潮的卫生太差了，请督促门店2周内整改完成，每次提交前厅、后厨、洗手间照片。"></textarea>' +
        '<button type="button" class="ws-btn ws-btn--primary" id="ws-atb-publish">发布任务</button>' +
        '</div>' +
        '<select class="ws-input" id="ws-atb-filter" style="margin-top:10px;">' +
        '<option value="active">进行中（默认）</option><option value="all">全部（含已结案）</option>' +
        '</select>' +
        '<div id="ws-atb-list" style="margin-top:10px;"><div class="ws-empty">加载中...</div></div>'
    );
}

function wsBindAgentCommandCenterEvents(root) {
    wsLoadAgentBoardList(root);
    wsBindAgentBoardListClick(root);
    root.querySelector('#ws-atb-filter')?.addEventListener('change', (ev) => {
        const list = root.querySelector('#ws-atb-list');
        if (list) list.innerHTML = wsRenderAtbList(ev.target.value);
    });
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
            // 2026-07-30：用户反馈发布的任务"没有流转下去"、状态一直卡在"待解析"——查证
            // 生产库真实事件日志发现任务其实正常流转到了"已分配"，只是agents-service-v2那边
            // 从创建到自动分派完成有一小段异步耗时，这里发布成功后立刻刷新的列表拿到的是
            // 还没走完自动分派的中间状态快照，之后又没有任何机制再刷新一次，所以列表上的
            // 标签就一直停在那个过渡态，跟点开详情看到的真实状态流转对不上。补一次延迟
            // 刷新，等自动分派大概率走完再拿一次最新状态。
            setTimeout(() => wsLoadAgentBoardList(root), 2500);
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
// 2026-07-30：加"已完成"tab——任务一旦resolved就从"任务"tab消失，责任人自己都没法回头
// 确认"这件事到底有没有真的处理过"，尤其是通过飞书快速回复几秒内就closed的任务，工作台
// 里几乎从来没出现过。这里不显示数字角标（"最近完成"不是待办，没有"未处理"的紧迫感）。
// 2026-07-31：用户先要求通知tab放最前面+默认展开，结果发现整页一打开就是通知列表，
// 看不到经营驾驶舱内容——改回"任务/待批/通知"原顺序、默认还是展开任务tab，但通知有
// 未读时用醒目的脉冲红点+高亮边框吸引注意，不用整页霸占的方式。
// 2026-07-31：用户反馈"飞书秒回resolved的任务，工作台完全看不到"——查证发现任务其实真实
// 存在、责任人也对，只是几十秒内就被resolved从"任务"tab消失，只有"已完成"tab才有，但
// 这个tab之前没有数字角标，是个空白按钮，用户根本不会点进去找。补上角标，跟其它tab一致。
function wsRenderTodoWidget(taskCount, pendingApprovalCount, unreadCount, resolvedCount) {
    const notifAlert = unreadCount > 0 ? ' ws-todo__tab--alert' : '';
    return (
        '<div class="ws-todo">' +
        '<button type="button" class="ws-todo__tab is-on" data-ws-todo-tab="task"><span class="ws-todo__n">' + taskCount + '</span>任务</button>' +
        '<button type="button" class="ws-todo__tab" data-ws-todo-tab="approval"><span class="ws-todo__n">' + pendingApprovalCount + '</span>待批</button>' +
        '<button type="button" class="ws-todo__tab' + notifAlert + '" data-ws-todo-tab="notif"><span class="ws-todo__n">' + unreadCount + '</span>通知' + (unreadCount > 0 ? '<span class="ws-todo__dot"></span>' : '') + '</button>' +
        '<button type="button" class="ws-todo__tab" data-ws-todo-tab="done"><span class="ws-todo__n">' + (Number(resolvedCount) || 0) + '</span>已完成</button>' +
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
        // 2026-07-30：用户反馈"马己仙出品经理16:30收到试味定时任务，但工作台任务栏里根本
        // 没有"——查证发现这条任务是真实通过飞书卡片送达、责任人在飞书里17秒内就回复提交
        // 证据、系统自动审核通过秒级resolved，不是没打通，是resolved的任务立刻从"任务"tab
        // 消失、责任人自己都没法回头确认"这件事到底有没有真的处理过"。加"已完成"tab展示最近
        // 24小时内已解决的任务，弥补这个可见性缺口（不管是通过工作台还是飞书完成的）。
        if (tab === 'done') {
            pane.innerHTML = '<div class="ws-loading">加载中...</div>';
            wsFetchJson('/api/workspace/tasks/recently-resolved?hours=24').then((data) => {
                const items = Array.isArray(data?.items) ? data.items : [];
                if (!items.length) { pane.innerHTML = '<div class="ws-empty">最近24小时暂无已完成的任务</div>'; return; }
                pane.innerHTML = items.map((it) => (
                    '<div class="ws-card">' +
                    '<div class="ws-card__title">' + wsEsc(it.title || '') + (it.store ? ' · ' + wsEsc(it.store) : '') + '</div>' +
                    (it.response_text ? '<div class="ws-card__desc">完成说明：' + wsEsc(it.response_text) + '</div>' : '') +
                    (Array.isArray(it.response_images) && it.response_images.length
                        ? '<div class="ws-card__desc">' + it.response_images.map((u) => '<a href="' + wsEsc(u) + '" target="_blank" class="ws-btn ws-btn--link">证据文件</a>').join(' ') + '</div>'
                        : '') +
                    '<div class="ws-card__desc" style="font-size:11px;opacity:.6;">完成时间：' + wsEsc(String(it.resolved_at || it.responded_at || '').slice(0, 16).replace('T', ' ')) + '</div>' +
                    '</div>'
                )).join('');
            });
            return;
        }
        // 2026-07-29：用户明确要求admin/hq_manager/store_manager/出品经理今后不再用"我的档案"
        // 模块，通知必须在工作台里就能看全——接现成的 GET /api/notifications 真实列表接口
        // （之前只有未读数，没有列表），点开即标记已读。
        // 2026-07-30：用户反馈这里的内容跟"我的档案"的"公司通知"对不上——查证09-resignation.js
        // #renderProfileNotifications发现"我的档案"实际merge了两个来源：hrms_user_notifications
        // (排除*_request类型，那些是审批类，走"待批"tab不是通知) + /api/announcements(公司公告，
        // 完全独立的广播表，不挂在target_username下)，这里之前只查了前者、且没排除*_request，
        // 内容跟"我的档案"对不齐。改成同样merge两个来源、同样排除*_request类型，两边才是
        // 真正"同一份数据"，不是看起来像但细节不同的两套查询。
        pane.innerHTML = '<div class="ws-loading">加载中...</div>';
        Promise.all([
            wsFetchJson('/api/notifications?limit=30'),
            wsFetchJson('/api/announcements'),
        ]).then(([notifData, annData]) => {
            const notifItems = (Array.isArray(notifData?.items) ? notifData.items : [])
                .filter((n) => !String(n.type || '').trim().endsWith('_request'))
                .map((n) => ({ ...n, _src: 'notif' }));
            const annItems = (Array.isArray(annData?.items) ? annData.items : [])
                .filter((a) => {
                    const scope = a.scope || { type: 'all' };
                    const t = String(scope.type || 'all');
                    if (t === 'all') return true;
                    if (t === 'hq') return String(currentUser?.store || '') === '总部';
                    if (t === 'store') return String(scope.store || '') === String(currentUser?.store || currentUser?.current_store || '');
                    return false;
                })
                .map((a) => ({
                    id: a.id, title: a.title || '公司公告', message: a.content || '',
                    created_at: a.createdAt || a.created_at, read_at: null, _src: 'announcement',
                }));
            const items = [...notifItems, ...annItems].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
            if (!items.length) { pane.innerHTML = '<div class="ws-empty">暂无通知</div>'; return; }
            pane.innerHTML = items.map((n) => (
                '<div class="ws-card"' + (n._src === 'notif' ? ' data-notif-id="' + wsEsc(n.id) + '"' : '') + ' style="' + (n.read_at ? 'opacity:.6;' : '') + '">' +
                '<div class="ws-card__title">' + (n.read_at || n._src === 'announcement' ? '' : '<span class="ws-tag ws-tag--red" style="margin-right:6px;">未读</span>') + wsEsc(n.title || '') + '</div>' +
                '<div class="ws-card__desc">' + wsEsc(n.message || '') + '</div>' +
                '<div class="ws-card__desc" style="font-size:11px;opacity:.6;">' + wsEsc(String(n.created_at || '').slice(0, 16).replace('T', ' ')) + '</div>' +
                '</div>'
            )).join('');
            pane.querySelectorAll('[data-notif-id]').forEach((card) => {
                card.addEventListener('click', () => {
                    if (card.style.opacity === '0.6') return;
                    const id = card.getAttribute('data-notif-id');
                    fetch('/api/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST', headers: wsAuthHeaders() }).catch(() => {});
                    card.style.opacity = '.6';
                    const tag = card.querySelector('.ws-tag--red');
                    if (tag) tag.remove();
                });
            });
        });
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
        '<div class="ws-card__desc">👤 ' + wsEsc(it.assignee_name || it.assignee_username || '') + ' 提交：' + wsEsc(it.response_text || '（无文字说明）') + '</div>' +
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
        // 2026-07-30：用户反馈点确认通过后卡片一直留在"待确认的任务反馈"列表里，跟"任务栏
        // 是要清空的队列"矛盾——改成移除卡片，并同步更新标题里的计数"（N）"。
        const section = cardEl.closest('.ws-section');
        cardEl.remove();
        const titleEl = section?.querySelector('.ws-section__title');
        if (titleEl) {
            const remaining = section.querySelectorAll('[data-confirm-task-id]').length;
            if (remaining > 0) titleEl.textContent = '待确认的任务反馈（' + remaining + '）';
            else section.remove();
        }
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
    const [home, overview, marketingHtml, approvalsData, growthTasks, pendingConfirmData, recentlyResolvedData] = await Promise.all([
        wsFetchJson('/api/workspace/home?scope=notable'),
        wsFetchJson('/api/workspace/overview'),
        wsRenderMarketingSuggestions(),
        wsFetchJson('/api/approvals?view=assigned&status=pending&limit=50'),
        wsFetchGrowthSolutionTasks(),
        wsFetchJson('/api/workspace/pending-confirmations'),
        wsFetchJson('/api/workspace/tasks/recently-resolved?hours=24'),
    ]);
    const allStores = (home?.storeLights || home?.storeSummary || []).map((s) => s.store).filter(Boolean);
    const tasksList = (Array.isArray(home?.myTasks) ? home.myTasks : []).concat(growthTasks);
    const pendingApprovals = Array.isArray(approvalsData?.items) ? approvalsData.items : [];
    const pendingConfirmations = Array.isArray(pendingConfirmData?.items) ? pendingConfirmData.items : [];
    // 2026-07-31：用户反馈"飞书秒回resolved的任务，工作台完全看不到"——查证发现任务其实
    // 真实存在、责任人也分配对了，只是几十秒内就被resolved，从"任务"tab消失，只在"已完成"
    // tab才能看到。但"已完成"tab之前完全没有数字角标，用户看到的是一个空白按钮，根本
    // 不会点进去找，才误以为任务"根本不存在"。补上角标数字，跟其它三个tab保持一致。
    const recentlyResolvedCount = Array.isArray(recentlyResolvedData?.items) ? recentlyResolvedData.items.length : 0;

    const heading = persona === 'boss' ? '经营驾驶舱' : '总部工作台';
    const roleLabel = (typeof getRoleDisplayName === 'function' ? getRoleDisplayName(currentUser?.role) : '') + (currentUser?.position ? '·' + currentUser.position : '') + '·级别' + (currentUser?.level || '暂无');
    let html = '<div class="ws-header"><h2>' + heading + '</h2>';
    html += '<div class="ws-sub">' + wsEsc(currentUser?.name || '') + (roleLabel ? '（' + wsEsc(roleLabel) + '）' : '') + ' · 未读消息 ' + (home?.unreadCount || 0) + ' 条' + (overview?.scoped ? ' · 仅显示你负责范围内的门店' : '') + '</div></div>';
    html += wsRenderTodoWidget(tasksList.length, pendingApprovals.length, home?.unreadCount || 0, recentlyResolvedCount);
    html += wsRenderPendingConfirmations(pendingConfirmations);
    html += wsSection('今日经营总览', wsRenderOverview(overview, true));
    html += wsSection('差评展示', wsRenderBadReviewSection(allStores));
    // 2026-07-30：门店营销活动建议之前只有每条建议内部自己折叠，整个区块本身不折叠——
    // 跟其它区块统一改用wsSection()包一层，区块级别也可以整体收起，不是只有卡片能收起。
    html += wsSection('门店营销活动建议', '<div id="ws-marketing-suggestions-body">' + marketingHtml + '</div>');
    html += wsSection('门店红绿灯（上月）', wsRenderStoreLights(home?.storeLights));
    html += wsSection('六大管理神器', wsRenderSixTools(allStores));
    html += wsSection('餐饮总监', wsRenderCustomDirectorSection(allStores));
    html += wsSection('8大AI督导指挥中心', wsRenderAgentCommandCenter());
    // 2026-07-30：用户反馈admin/hq视角的工作台没有"我的绩效"——之前只加到了店长/出品经理
    // 的wsRenderStore()，管理员/总部营运看到的是wsRenderBossOrHq()这条完全独立的渲染
    // 路径，两边各自维护自己的区块列表，加一处不会自动出现在另一处，这里补上同一个模块。
    html += wsSection('我的绩效', '<div id="ws-my-performance"><div class="ws-loading">加载中...</div></div>');
    html += '<div class="ws-section">' + wsRenderQuickActions() + '</div>';
    root.innerHTML = html;
    wsBindTodoWidgetEvents(root, tasksList, pendingApprovals);
    wsBindPendingConfirmationsEvents(root);
    wsBindOperationalStoreSelector(root);
    wsBindSixToolsEvents(root);
    wsBindCustomDirectorEvents(root);
    wsBindAgentCommandCenterEvents(root);
    wsBindMarketingSuggestionsEvents(root);
    wsFetchJson('/api/agent-scores/me').then((data) => {
        const el = document.getElementById('ws-my-performance');
        if (el) el.innerHTML = wsRenderMyPerformance(data);
    });
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
// 2026-07-30 修复：出品经理/店长反馈"当月目标追踪"只有营业额一项——查证发现"目标管理"页面
// （08-materials-tasks.js的monthlyTargets弹窗，实收营业额/毛利率/充值金额/点评星级/企微
// 新增等任意目标项）存的是 HRMS_STORE 本地状态里的 settings.monthlyTargets（{ym,store,
// targets:{key:value}}结构），跟这里原先查询的 /api/tenant-settings/kpi-targets（另一套
// 走agents-service-v2 kpi_targets表的通用KPI机制，是"任务和绩效"页面另一个入口维护的，
// 两套目标机制完全独立、互不知道对方）完全是两张不同的表——用户在"目标管理"里录的那些目标，
// 这里之前根本没读过，所以除了营业额(revenue_targets另一张表，走ov.revenue.target)以外
// 全部显示"暂未配置"。这里改成额外读取monthlyTargets当前月本店那一条，MT_FIELD_MAP/
// MT_ALL_FIELDS定义在07-promotion.js（同一份bundle里全局可见，沿用现成的label/unit元数据，
// 不重新定义一遍）。
function wsCurrentYm() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// 2026-07-30：目标追踪之前对每个目标项一律显示"系统暂未接入该指标的自动核算，需人工核对"，
// 用户指出这不对——除了毛利是每月10号前录入飞书毛利记录表，其它目标(充值/堂食营收/点评
// 星级/企微新增等)全部已经在营业日报里，只是没接查询。改成异步拉取
// GET /api/workspace/monthly-target-actuals（server/domains/workspace/overview.js里的
// getMonthlyTargetActuals()，逐字段从daily_reports聚合本月实际值，毛利单独从monthly_margins
// 取），能匹配到的目标项显示真实"实际 vs 目标"，只有eleme/meituan分渠道明细这类daily_reports
// 本身没有单独字段的，才如实标"数据源暂无该粒度"（不是偷懒没接，是真的没有这个字段）。
async function wsRenderMonthlyTargetFields(store) {
    if (!store || typeof HRMS_STORE === 'undefined' || typeof MT_FIELD_MAP === 'undefined') return '';
    const ym = wsCurrentYm();
    const list = Array.isArray(HRMS_STORE.getSettings?.()?.monthlyTargets) ? HRMS_STORE.getSettings().monthlyTargets : [];
    const rec = list.find((x) => String(x?.ym || '').trim() === ym && String(x?.store || '').trim() === store);
    const targets = rec?.targets || {};
    const keys = Object.keys(targets).filter((k) => targets[k] != null && MT_FIELD_MAP[k]);
    if (!keys.length) return '';
    const actualsData = await wsFetchJson('/api/workspace/monthly-target-actuals?store=' + encodeURIComponent(store) + '&ym=' + encodeURIComponent(ym));
    const actuals = actualsData?.actuals || {};
    return '<div class="ws-stat-list" style="margin-top:10px;">' +
        keys.map((k) => {
            const meta = MT_FIELD_MAP[k];
            const v = targets[k];
            const display = meta.unit === '元' ? '¥' + wsFmtMoney(v) : (v + meta.unit);
            const actual = actuals[k];
            const detail = actual == null
                ? '数据源暂无该粒度（如分平台/分品类明细），需人工核对'
                : ('实际 ' + (meta.unit === '元' ? '¥' + wsFmtMoney(actual) : (actual + meta.unit)) +
                   (Number(v) > 0 ? ' · 达成 ' + Math.round((Number(actual) / Number(v)) * 100) + '%' : ''));
            return wsStatRow(wsEsc(meta.label), display, detail);
        }).join('') +
        '</div>';
}

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
    const monthlyFieldsHtml = await wsRenderMonthlyTargetFields(store);
    const kpiData = store ? await wsFetchJson('/api/tenant-settings/kpi-targets?store=' + encodeURIComponent(store)) : null;
    const kpiTargets = Array.isArray(kpiData?.targets) ? kpiData.targets : [];
    const kpiFieldsHtml = kpiTargets.length
        ? '<div class="ws-stat-list" style="margin-top:10px;">' +
            kpiTargets.map((k) => wsStatRow(wsEsc(k.metric_key), (k.target_value ?? '—') + (k.unit ? wsEsc(k.unit) : ''), '实际值：系统暂未接入该指标的自动核算，需人工核对')).join('') +
            '</div>'
        : '';
    html += monthlyFieldsHtml + kpiFieldsHtml;
    if (!monthlyFieldsHtml && !kpiFieldsHtml) {
        html += '<div class="ws-empty">本店在"目标管理"/"任务和绩效"目标设置里暂未配置其他目标（如大众点评/企微）</div>';
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

// 2026-07-30 第一次修复：之前只显示"1/1 已认证"这种聚合数字，看不出是谁、什么岗位——用户
// 反馈"这种记录毫无意义"。后端 /api/training/dashboard 每一行其实已经带了 members 数组
// (username/name/status/is_overdue)，/api/kitchen/dashboard 每个station也带了
// completed_details/unchecked_details(含employee_name/assignee_name)，只是前端没用。
// 改成用<details>折叠：外层还是"1/1 已认证"这行摘要，点开展示每个人的姓名+状态。
//
// 2026-07-30 第二次修复：按培训主题分组（"客诉培训 1/1已认证"点开列人）实测反馈"太混乱"——
// 同一个人的记录分散在好几个主题下面，看不出"这个人到底完成了几项"，且没有岗位。用户明确
// 要求"看的是员工的培训记录，姓名+岗位"，即以人为单位、不是以培训主题为单位。这里改成
// 反向分组：按 members[].username 聚合出每个员工，展示其姓名+岗位（后端已补充
// members[].position，见routes-dashboard.js），点开看这个人被指派的每个培训主题及认证状态。
function wsRenderTrainingBoard(rows) {
    if (!rows.length) return '<div class="ws-empty">本店暂无培训计划</div>';
    const byEmployee = new Map();
    rows.forEach((r) => {
        (Array.isArray(r.members) ? r.members : []).forEach((m) => {
            const key = m.username || m.name;
            if (!key) return;
            if (!byEmployee.has(key)) byEmployee.set(key, { name: m.name || m.username, position: m.position || '', topics: [] });
            byEmployee.get(key).topics.push({ title: r.title, status: m.status, is_overdue: m.is_overdue });
        });
    });
    const employees = [...byEmployee.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
    if (!employees.length) return '<div class="ws-empty">本店暂无培训计划</div>';
    return employees.map((emp) => {
        const total = emp.topics.length;
        const certified = emp.topics.filter((t) => t.status === 'certified').length;
        const overdue = emp.topics.filter((t) => t.is_overdue).length;
        const topicLines = emp.topics.map((t) => (
            '<div class="ws-stat-row" style="padding:6px 0;"><span class="ws-stat-row__l">' + wsEsc(t.title) + '</span>' +
            '<span class="ws-stat-row__v" style="font-size:11.5px;">' +
            (t.status === 'certified' ? '<span class="ws-ok">已认证</span>' : t.is_overdue ? '<span class="ws-down">逾期未认证</span>' : '未认证') +
            '</span></div>'
        )).join('');
        const summaryLine =
            '<span class="ws-stat-row__l">' + wsEsc(emp.name) + (emp.position ? '（' + wsEsc(emp.position) + '）' : '') + '</span>' +
            '<span class="ws-stat-row__v">' + certified + '/' + total + ' 已认证' + (overdue > 0 ? '<span class="ws-down"> · ' + overdue + '项逾期</span>' : '') + '</span>';
        return (
            '<details class="ws-detail-collapse"><summary class="ws-stat-row ws-detail-summary" style="cursor:pointer;">' + summaryLine + '</summary>' +
            topicLines +
            '</details>'
        );
    }).join('');
}

// 2026-07-30：用户要求厨房打点看板能看到"日期，打点内容，员工姓名，岗位，完成与否"——
// station本身就是岗位（分组维度），dish_name/employee_name/完成状态已有，缺的是日期——
// getStationDashboard()按单一task_date查询，本来就在返回体顶层带了date字段，之前前端没有
// 展示，这里加一行日期标题。
function wsRenderKitchenBoard(summary, date) {
    if (!summary.length) return '<div class="ws-empty">暂无厨房打点数据</div>';
    const dateLine = date ? '<div class="ws-card__desc" style="opacity:.65;margin-bottom:6px;">日期：' + wsEsc(date) + '</div>' : '';
    return dateLine + summary.map((s) => {
        const completed = Array.isArray(s.completed_details) ? s.completed_details : [];
        const unchecked = Array.isArray(s.unchecked_details) ? s.unchecked_details : [];
        const detailLines = [
            ...completed.map((d) => (
                '<div class="ws-stat-row" style="padding:6px 0;"><span class="ws-stat-row__l">' + wsEsc(d.employee_name || d.employee_username || '') + ' · ' + wsEsc(d.dish_name || '') + '（' + wsEsc(String(d.schedule_time || '')) + '）' + '</span>' +
                '<span class="ws-stat-row__v ws-ok" style="font-size:11.5px;">已打点</span></div>'
            )),
            ...unchecked.map((d) => (
                '<div class="ws-stat-row" style="padding:6px 0;"><span class="ws-stat-row__l">' + wsEsc(d.assignee_name || d.assignee_username || '未指派') + ' · ' + wsEsc(d.dish_name || '') + '（' + wsEsc(String(d.schedule_time || '')) + '）' + '</span>' +
                '<span class="ws-stat-row__v ws-down" style="font-size:11.5px;">未打点</span></div>'
            )),
        ].join('');
        const summaryLine =
            '<span class="ws-stat-row__l">' + wsEsc(s.station || '') + '</span>' +
            '<span class="ws-stat-row__v">' + (s.confirmed || 0) + '/' + (s.total || 0) + ' (' + (s.rate ?? 0) + '%)</span>';
        return (
            '<details class="ws-detail-collapse"><summary class="ws-stat-row ws-detail-summary" style="cursor:pointer;">' + summaryLine + '</summary>' +
            (detailLines || '<div class="ws-empty" style="padding:6px 0;">暂无打点记录</div>') +
            '</details>'
        );
    }).join('');
}

// 智能备货：用户明确要求"把目前智能助手的备货整套功能直接放到这里"——预测接口内部参数/
// 权限逻辑较复杂(server/domains/inventory-forecast)，与其重新拼接一遍容易拼错，直接复用
// 现有独立页面 /forecast.html，完整复用真实功能，不重新实现。
// 2026-07-30 第一次修复（已证伪）：以为是WebView localStorage分区隔离导致iframe读不到
// token，改成token拼进iframe src查询参数——上线验证forecast.html本身可以正常独立打开
// （直接访问该URL能看到"无访问权限"这类正常渲染，不是白屏），但nginx当时对所有.html统一
// 加了X-Frame-Options: DENY，浏览器据此完全拒绝任何iframe渲染——已单独给/forecast.html
// 放开SAMEORIGIN。
// 2026-07-30 第二次修复：nginx放开之后，安卓手机上智能备货依然空白——排查同源/CSP/token
// 传递都确认没问题，说明问题出在"作为iframe被嵌套"这件事本身在部分安卓WebView容器下
// 就是不可靠的（真实容器很可能是企业微信/公司App里的WebView，这类容器对二级嵌套iframe
// 的支持历来不稳定，是这一整类问题的共同根因，不是某一次具体配置能兜底的）。改成放弃
// iframe内嵌，直接用<a target="_blank">在新标签页打开完整的/forecast.html——这样它就是
// 一次普通的同源页面跳转，不再经过iframe这层，从根本上避免这整类"WebView容器下iframe不
// 可靠"的问题，跟证据文件链接(wsRenderPendingConfirmations)用的是同一种target="_blank"模式。
function wsRenderSmartRestock() {
    return '<a class="ws-btn ws-btn--primary" href="/forecast.html" target="_blank" rel="noopener">打开智能备货 →</a>';
}

// 折叠版 ws-section：与"8大AI督导指挥中心"同款 <details>/<summary> 效果，默认展开，
// 复用现成的 .ws-detail-collapse/.ws-detail-summary CSS，不新增样式。
function wsSection(title, contentHtml) {
    return '<details class="ws-section ws-detail-collapse" open>' +
        '<summary class="ws-section__title ws-detail-summary">' + wsEsc(title) + '</summary>' +
        contentHtml +
        '</details>';
}

async function wsRenderStore(root) {
    root.innerHTML = '<div class="ws-loading">加载中...</div>';
    const store = String(currentUser?.current_store || currentUser?.store || '').trim();
    const [home, growthTasks, overview, approvalsData, recentlyResolvedData] = await Promise.all([
        wsFetchJson('/api/workspace/home'),
        wsFetchGrowthSolutionTasks(),
        wsFetchJson('/api/workspace/overview'),
        wsFetchJson('/api/approvals?view=assigned&status=pending&limit=50'),
        wsFetchJson('/api/workspace/tasks/recently-resolved?hours=24'),
    ]);
    const tasksList = (Array.isArray(home?.myTasks) ? home.myTasks : []).concat(growthTasks);
    // 2026-07-31：用户反馈"待批"是否真的连通好用——查证发现店长/出品经理视图(wsRenderStore)
    // 这里之前硬编码成空数组，从来没真正查询过审批数据，永远显示0，只有老板/总部视图
    // (wsRenderBossOrHq)是真实连通的。改成跟老板/总部视图一样查同一个/api/approvals接口。
    const pendingApprovals = Array.isArray(approvalsData?.items) ? approvalsData.items : [];
    // 2026-07-31：用户反馈"飞书秒回resolved的任务，工作台完全看不到"——任务其实真实存在、
    // 责任人也分配对了，只是几十秒内就被resolved，从"任务"tab消失，只在"已完成"tab才能
    // 看到。但"已完成"tab之前没有数字角标，用户看到空白按钮不会点进去找。补上角标。
    const recentlyResolvedCount = Array.isArray(recentlyResolvedData?.items) ? recentlyResolvedData.items.length : 0;
    const storeLight = (Array.isArray(home?.storeLights) ? home.storeLights : []).find((s) => s.store === store);
    const storeRoleLabel = (typeof getRoleDisplayName === 'function' ? getRoleDisplayName(currentUser?.role) : '') + (currentUser?.position ? '·' + currentUser.position : '') + '·级别' + (currentUser?.level || '暂无') + '·门店级别' + (storeLight?.rating || '暂无');
    let html = '<div class="ws-header"><h2>今日工作台</h2><div class="ws-sub">' + wsEsc(currentUser?.name || '') + (storeRoleLabel ? '（' + wsEsc(storeRoleLabel) + '）' : '') + '</div></div>';
    html += wsRenderTodoWidget(tasksList.length, pendingApprovals.length, home?.unreadCount || 0, recentlyResolvedCount);
    // 2026-07-30：用户要求整页各区块都能像"8大AI督导指挥中心"一样折叠——用同一套已有的
    // <details class="ws-detail-collapse">+<summary class="ws-section__title ws-detail-summary">
    // 模式（复用现成CSS，不新增样式），默认展开(open)，用户可以自行收起不关心的区块。
    html += wsSection('今日经营总览', wsRenderOverview(overview, false));
    html += wsSection('差评展示', wsRenderBadReviewSection(store ? [store] : []));
    html += wsSection('当月目标追踪', '<div id="ws-target-tracking"><div class="ws-loading">加载中...</div></div>');
    html += wsSection('智能备货', wsRenderSmartRestock());
    html += wsSection('员工绩效', wsRenderEmployeePerformanceList(overview?.team));
    html += wsSection('员工培训看板', '<div id="ws-training-board"><div class="ws-loading">加载中...</div></div>');
    html += wsSection('厨房打点看板', '<div id="ws-kitchen-board"><div class="ws-loading">加载中...</div></div>');
    // 2026-07-30：用户要求工作台最下方加"我的绩效"模块（综合得分+执行力/工作态度/工作能力
    // 三项进度条+等级徽章）——复用现成的 GET /api/agent-scores/me（09-resignation.js的"我的
    // 档案"个人绩效页已经在用同一个接口，字段现成：total_score/execution_rating/
    // attitude_rating/ability_rating），不新建接口。
    html += wsSection('我的绩效', '<div id="ws-my-performance"><div class="ws-loading">加载中...</div></div>');
    html += '<div class="ws-section">' + wsRenderQuickActions() + '</div>';
    root.innerHTML = html;
    wsBindTodoWidgetEvents(root, tasksList, pendingApprovals);
    wsBindOperationalStoreSelector(root);
    root.querySelectorAll('[data-ws-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const el = document.getElementById(btn.getAttribute('data-ws-toggle'));
            if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
        });
    });
    wsBindBadReviewEvents(root);
    wsLoadBadReviews(root);
    if (store) {
        wsFetchJson('/api/training/dashboard?store=' + encodeURIComponent(store)).then((data) => {
            const rows = data?.success && Array.isArray(data.dashboard) ? data.dashboard : [];
            const el = document.getElementById('ws-training-board');
            if (el) el.innerHTML = wsRenderTrainingBoard(rows);
        });
        wsFetchJson('/api/kitchen/dashboard?store=' + encodeURIComponent(store)).then((data) => {
            const summary = data?.success && Array.isArray(data.summary) ? data.summary : [];
            const el = document.getElementById('ws-kitchen-board');
            if (el) el.innerHTML = wsRenderKitchenBoard(summary, data?.date);
        });
        wsRenderTargetTracking(overview, store).then((h) => { const el = document.getElementById('ws-target-tracking'); if (el) el.innerHTML = h; });
    }
    wsFetchJson('/api/agent-scores/me').then((data) => {
        const el = document.getElementById('ws-my-performance');
        if (el) el.innerHTML = wsRenderMyPerformance(data);
    });
}

// 等级字母(A/B/C/D)映射进度条百分比+配色——D/C/B/A 依次对应 --ws-down(粉)/--ws-warn(金)/
// --ws-up(绿)，跟门店红绿灯(ws-light--green/yellow/red)是同一套语义色，不新发明一套颜色。
const WS_PERF_GRADE = {
    A: { pct: 95, cls: 'up' }, B: { pct: 75, cls: 'up' },
    C: { pct: 55, cls: 'warn' }, D: { pct: 30, cls: 'down' },
};
function wsRenderPerfRow(label, grade) {
    const g = WS_PERF_GRADE[grade] || null;
    const pct = g ? g.pct : 0;
    const cls = g ? g.cls : 'ink2';
    return (
        '<div class="ws-perf-row">' +
        '<div class="ws-perf-row__label">' + wsEsc(label) + '</div>' +
        '<div class="ws-perf-row__bar"><div class="ws-perf-row__fill ws-perf-row__fill--' + cls + '" style="width:' + pct + '%;"></div></div>' +
        '<div class="ws-perf-badge ws-perf-badge--' + cls + '">' + wsEsc(grade || '—') + '</div>' +
        '</div>'
    );
}
function wsRenderMyPerformance(data) {
    if (!data || data.error) return '<div class="ws-empty">暂无绩效数据</div>';
    const score = data.total_score;
    return (
        '<div class="ws-perf-head"><span class="ws-perf-head__title">绩效</span><span class="ws-perf-head__sub">上级评定</span></div>' +
        '<div class="ws-perf-score"><span class="ws-perf-score__n">' + (score ?? '—') + '</span><span class="ws-perf-score__l">综合得分</span></div>' +
        wsRenderPerfRow('执行力', data.execution_rating) +
        wsRenderPerfRow('工作态度', data.attitude_rating) +
        wsRenderPerfRow('工作能力', data.ability_rating)
    );
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

// 2026-07-31：用户明确要求管理员/总部营运经理/店长/出品经理这4个角色，"我的档案"入口
// 直接换成"工作台"（原档案页隐藏不用），其它角色（如前厅经理/收银员等普通员工）保持
// 不变继续用"我的档案"——工作台首页已经涵盖了档案页的核心信息，这4个角色不再需要单独
// 的档案入口。
const WS_REPLACE_PROFILE_NAV_ROLES = ['admin', 'hq_manager', 'store_manager', 'store_production_manager'];
function wsShouldReplaceProfileNav() {
    return WS_REPLACE_PROFILE_NAV_ROLES.includes(String(currentUser?.role || ''));
}

// ── 桌面侧栏「工作台」入口（JS 注入，working-fixed.html 行数棘轮零余量，不能加静态 HTML）──
function wsInjectNavItem() {
    const nav = document.querySelector('.sidebar nav') || document.querySelector('nav');
    if (!nav) return;
    if (wsShouldReplaceProfileNav()) {
        const profileNav = nav.querySelector('[data-page="profile"]');
        if (profileNav) profileNav.style.display = 'none';
    }
    if (nav.querySelector('[data-page="workspace"]')) return;
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
