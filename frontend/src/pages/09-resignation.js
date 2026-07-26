/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 09-resignation.js
 * lines: 25412-28147 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ========== 离职申请功能 ==========
        function openResignationModal() {
            const modal = document.getElementById('resignation-modal');
            if (!modal) return;

            // 检查是否已有待审批的离职申请
            const resignations = HRMS_STORE.getResignations ? HRMS_STORE.getResignations() : [];
            const pending = resignations.find(r => r.applicant === (currentUser?.username || currentUser?.id) && r.status === 'pending');
            if (pending) {
                showNotification('您已有待审批的离职申请，请等待审批结果', 'warning');
                return;
            }

            // 重置表单
            document.getElementById('resignation-reason').value = '';
            document.getElementById('resignation-detail').value = '';
            document.getElementById('resignation-detail-count').textContent = '0';
            document.getElementById('resignation-communicated').value = '';
            document.getElementById('resignation-interviewed').value = '';
            document.getElementById('resignation-manager-agreed').value = '';
            document.getElementById('resignation-date').value = '';

            // 重置分段按钮
            ['resignation-communicated-seg', 'resignation-interviewed-seg', 'resignation-manager-agreed-seg'].forEach(segId => {
                const seg = document.getElementById(segId);
                if (seg) {
                    seg.querySelectorAll('.ui-seg-btn').forEach(btn => btn.classList.remove('active'));
                }
            });

            // 绑定分段按钮事件
            bindResignationSegments();

            // 绑定字数统计
            const detailEl = document.getElementById('resignation-detail');
            if (detailEl) {
                detailEl.oninput = function() {
                    document.getElementById('resignation-detail-count').textContent = this.value.length;
                };
            }

            modal.classList.add('show');
        }

        function bindResignationSegments() {
            const segments = [
                { segId: 'resignation-communicated-seg', inputId: 'resignation-communicated' },
                { segId: 'resignation-interviewed-seg', inputId: 'resignation-interviewed' },
                { segId: 'resignation-manager-agreed-seg', inputId: 'resignation-manager-agreed' }
            ];

            segments.forEach(({ segId, inputId }) => {
                const seg = document.getElementById(segId);
                const input = document.getElementById(inputId);
                if (!seg || !input) return;

                seg.querySelectorAll('.ui-seg-btn').forEach(btn => {
                    btn.onclick = function() {
                        seg.querySelectorAll('.ui-seg-btn').forEach(b => b.classList.remove('active'));
                        this.classList.add('active');
                        input.value = this.dataset.value;
                    };
                });
            });
        }

        function closeResignationModal() {
            const modal = document.getElementById('resignation-modal');
            if (modal) modal.classList.remove('show');
        }

        function submitResignation() {
            const reason = (document.getElementById('resignation-reason')?.value || '').trim();
            const detail = (document.getElementById('resignation-detail')?.value || '').trim();
            const communicated = (document.getElementById('resignation-communicated')?.value || '').trim();
            const interviewed = (document.getElementById('resignation-interviewed')?.value || '').trim();
            const managerAgreed = (document.getElementById('resignation-manager-agreed')?.value || '').trim();
            const resignDate = (document.getElementById('resignation-date')?.value || '').trim();

            // 验证
            if (!reason) {
                showNotification('请选择离职原因', 'warning');
                return;
            }
            if (detail.length < 100) {
                showNotification('详细说明至少需要100字', 'warning');
                return;
            }
            if (!communicated) {
                showNotification('请选择是否与直属上级沟通过', 'warning');
                return;
            }
            if (!interviewed) {
                showNotification('请选择上级是否找你面谈过', 'warning');
                return;
            }
            if (!managerAgreed) {
                showNotification('请选择直属上级是否同意', 'warning');
                return;
            }
            if (!resignDate) {
                showNotification('请选择期望离职日期', 'warning');
                return;
            }

            try {
                if (currentUser && HRMS_API.token && HRMS_API.token()) {
                    const payload = {
                        username: String(currentUser.username || '').trim(),
                        name: String(currentUser.name || '').trim(),
                        store: String(currentUser.store || '').trim(),
                        resignDate: resignDate,
                        reason: reason,
                        detail: detail,
                        communicated: communicated,
                        interviewed: interviewed,
                        managerAgreed: managerAgreed
                    };
                    HRMS_API.createApproval('offboarding', payload)
                        .then(() => {
                            closeResignationModal();
                            showNotification('离职申请已提交审批', 'success');
                            try { refreshUnreadBadges(); } catch (e) {}
                        })
                        .catch((e) => {
                            showNotification('离职申请提交失败：' + String(e?.message || e), 'error');
                        });
                    return;
                }
            } catch (e) {
                // ignore
            }

            // 创建离职申请记录
            const resignation = {
                id: 'RES-' + Date.now(),
                applicant: currentUser?.username || currentUser?.id,
                applicantName: currentUser?.name || '--',
                store: currentUser?.store || '--',
                department: currentUser?.department || '--',
                position: currentUser?.position || '--',
                managerUsername: currentUser?.managerUsername || '',
                reason: reason,
                detail: detail,
                communicated: communicated,
                interviewed: interviewed,
                managerAgreed: managerAgreed,
                expectedDate: resignDate,
                applyDate: new Date().toISOString().slice(0, 10),
                status: 'pending', // pending, approved, rejected
                approvedDate: null,
                approvedBy: null,
                approvalNote: ''
            };

            // 保存到存储
            const resignations = HRMS_STORE.getResignations ? HRMS_STORE.getResignations() : [];
            resignations.push(resignation);
            HRMS_STORE.setResignations(resignations);

            // 创建通知给直属上级、总经理、管理员
            createResignationNotifications(resignation);

            closeResignationModal();
            showNotification('离职申请已提交，等待审批', 'success');
        }

        function createResignationNotifications(resignation) {
            const employees = HRMS_STORE.getEmployees();
            const notifyUsers = new Set();
            if (resignation.managerUsername) notifyUsers.add(resignation.managerUsername);
            (employees || []).forEach(function(emp) {
                if (emp.role === 'hq_manager' || emp.role === 'admin') notifyUsers.add(emp.username);
            });
            const notifications = Array.from(notifyUsers).map(function(username) {
                return {
                    targetUser: username,
                    type: 'resignation_request',
                    title: '离职申请待审批',
                    message: (resignation.applicantName || '') + ' 提交了离职申请，离职原因：' + (resignation.reason || ''),
                    meta: { resignationId: resignation.id || '' }
                };
            });
            if (notifications.length) {
                HRMS_API.request('/api/notifications/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notifications })
                }).catch(function(e) { console.warn('[createResignationNotifications]', e); });
            }
        }

        // 审批离职申请
        function approveResignation(resignationId, approved, note) {
            const resignations = HRMS_STORE.getResignations ? HRMS_STORE.getResignations() : [];
            const idx = resignations.findIndex(r => r.id === resignationId);
            if (idx < 0) {
                showNotification('未找到该离职申请', 'error');
                return;
            }

            const resignation = resignations[idx];
            resignation.status = approved ? 'approved' : 'rejected';
            resignation.approvedDate = new Date().toISOString().slice(0, 10);
            resignation.approvedBy = currentUser?.username || currentUser?.id;
            resignation.approvalNote = note || '';
            // 审批通过后，实际离职日期从期望日期开始
            if (approved) {
                resignation.effectiveDate = resignation.expectedDate;
            }

            HRMS_STORE.setResignations(resignations);

            // 通知申请人
            HRMS_API.request('/api/notifications/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notifications: [{
                    targetUser: resignation.applicant,
                    type: 'resignation_result',
                    title: approved ? '离职申请已通过' : '离职申请被拒绝',
                    message: approved
                        ? '您的离职申请已通过审批，离职日期：' + (resignation.expectedDate || '')
                        : '您的离职申请被拒绝' + (note ? '，原因：' + note : ''),
                    meta: { resignationId: resignation.id || '' }
                }] })
            }).catch(function(e) { console.warn('[approveResignation notif]', e); });

            showNotification(approved ? '已批准离职申请' : '已拒绝离职申请', 'success');
            
            try { loadApprovalsData(); } catch (e) {}
        }

        // 检查当日离职员工并自动处理
        function checkTodayResignations() {
            const today = new Date().toISOString().slice(0, 10);
            const resignations = HRMS_STORE.getResignations();
            const employees = HRMS_STORE.getEmployees();
            const notifications = HRMS_STORE.getNotifications();

            // 找到今天离职且已批准的申请
            const todayResignations = resignations.filter(r => 
                r.status === 'approved' && 
                r.expectedDate === today && 
                !r.processed // 未处理过
            );

            if (!todayResignations.length) return;

            let employeesChanged = false;
            let notifsChanged = false;

            todayResignations.forEach(r => {
                // 自动将员工状态改为离职
                const empIdx = employees.findIndex(e => 
                    e.username === r.applicant || e.id === r.applicant
                );
                if (empIdx >= 0) {
                    employees[empIdx].status = 'resigned';
                    employees[empIdx].resignDate = today;
                    employeesChanged = true;
                }

                // 给所有管理员发送重要通知
                const admins = employees.filter(e => e.role === 'admin');
                admins.forEach(admin => {
                    // 检查是否已发送过今日离职通知
                    const alreadyNotified = notifications.some(n => 
                        n.type === 'resignation_today' && 
                        n.resignationId === r.id && 
                        n.targetUser === admin.username
                    );
                    if (!alreadyNotified) {
                        notifications.push({
                            id: 'NOTIF-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
                            type: 'resignation_today',
                            targetUser: admin.username,
                            title: '【重要】员工今日离职',
                            message: `${r.applicantName}（${r.department} - ${r.position}）今日离职，请及时关停该员工所有系统权限。员工状态已自动更新为"离职"。`,
                            resignationId: r.id,
                            read: false,
                            createdAt: new Date().toISOString(),
                            important: true
                        });
                        notifsChanged = true;
                    }
                });

                // 标记为已处理
                r.processed = true;
            });

            if (employeesChanged) {
                HRMS_STORE.setEmployees(employees);
                // A1：employees 已不在 PUT /api/state 白名单，离职状态走窄 API
                todayResignations.forEach(r => {
                    const un = String(r?.applicant || '').trim();
                    if (!un) return;
                    HRMS_API.patchEmployeeStatus(un, 'resigned', { resignDate: today }).catch(e => {
                        console.warn('[resignation] patch status failed', un, e?.message || e);
                    });
                });
            }
            if (notifsChanged || todayResignations.length) {
                HRMS_STORE.setResignations(resignations);
                HRMS_STORE.setNotifications(notifications);
            }
        }
        
        // 加载个人信息数据
        async function renderDevelopmentMap() {
            const box = document.getElementById('profile-devmap');
            if (!box) return;
            try {
                const resp = await fetch('/api/training/my-development-map', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                const data = await resp.json();
                const m = data && data.success ? data.map : null;
                if (!m || !m.position || !m.ladder || !m.ladder.length) { box.style.display = 'none'; return; }
                const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
                const ladderHtml = m.ladder.map(l => {
                    const pct = l.total ? Math.round(l.certified / l.total * 100) : 0;
                    const cur = l.isCurrent ? ' <span class="ga-badge ga-badge--iris">当前</span>' : '';
                    const tick = l.complete ? ' <span class="ga-badge ga-badge--mint">已达成</span>' : '';
                    return `<div class="pf2-ld">
                        <div class="pf2-ldh"><b>${esc(l.label)}${cur}${tick}</b><s>认证 ${l.certified}/${l.total}</s></div>
                        <div class="pf2-ldb"><i class="${l.complete ? 'p' : ''}" style="width:${pct}%"></i></div>
                    </div>`;
                }).join('');
                let pathHtml = '';
                if (m.path && m.path.nodes && m.path.nodes.length) {
                    const steps = m.path.nodes.map((n, i) => {
                        const sep = i < m.path.nodes.length - 1 ? '<span class="pf2-sp">\u203a</span>' : '';
                        let cls = 'pf2-nd';
                        if (n.isApex) cls += ' pf2-nd--top';
                        if (n.isCurrent) cls += ' pf2-nd--now';
                        return `<span class="${cls}">${esc(n.display)}</span>${sep}`;
                    }).join('');
                    pathHtml = `<div class="pf2-path" style="flex-direction:column;align-items:flex-start;gap:9px;">
                        <div style="font-size:11.5px;color:var(--pf-faint);">${esc(m.path.note)}</div>
                        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;">${steps}</div>
                    </div>`;
                } else if (m.path && m.path.note) {
                    pathHtml = `<div class="pf2-path" style="font-size:12px;color:var(--pf-faint);">${esc(m.path.note)}</div>`;
                }
                const ctaHtml = m.cta ? `<span data-click="showPage" data-arg="promotion" style="display:inline-block;margin-left:8px;padding:3px 10px;border-radius:8px;background:var(--pf-ac);color:var(--pf-acx);font-weight:600;font-size:11.5px;cursor:pointer;white-space:nowrap;">${esc(m.cta.text)} ›</span>` : '';
                const nextHtml = m.nextStep ? `<div class="pf2-nx"><svg class="pfi"><use href="#pfi-flag"/></svg><span>${esc(m.nextStep)}${ctaHtml}</span></div>` : '';
                box.innerHTML = `
                    <div style="font-size:11.5px;color:var(--pf-faint);margin-bottom:12px;">当前岗位 <b style="color:var(--pf-tx);font-weight:600;">${esc(m.positionDisplay)}</b>${m.currentLevel ? ' \u00b7 ' + esc(m.currentLevel) : ''}</div>
                    ${ladderHtml}
                    ${nextHtml}
                    ${pathHtml}
                `;
                box.style.display = 'block';
            } catch (e) { box.style.display = 'none'; }
        }

        /* ══════════════════════════════════════════════════════════════════
           我的档案 v2 · 结构重排配套逻辑
           设计取舍：不逐个改写既有渲染函数（loadProfileData / renderProfile* 等），
           而是用 MutationObserver 监听档案页子树，从它们已经写好的值里「派生」出
           v2 需要的展示状态（评分条宽度 / 考勤异常着色 / 待办计数）。
           好处是既有渲染逻辑一行不动，降低回归风险。
           ══════════════════════════════════════════════════════════════════ */

        // 分段切换：任务 / 待批 / 通知
        function pf2SwitchTodo(tab) {
            const root = document.getElementById('profile-page');
            if (!root) return;
            root.querySelectorAll('.pf2-seg button').forEach(b => {
                b.classList.toggle('is-on', b.dataset.pf2tab === tab);
            });
            root.querySelectorAll('.pf2-pane').forEach(p => {
                p.classList.toggle('is-on', p.dataset.pf2pane === tab);
            });
            try { localStorage.setItem('pf2_todo_tab', tab); } catch (e) {}
        }

        // 等级 → 进度条宽度。无法识别的等级返回 null（不画条，避免瞎猜）
        function pf2RatingPct(raw) {
            const s = String(raw == null ? '' : raw).trim().toUpperCase();
            if (!s || s === '--' || s === '-') return null;
            const num = parseFloat(s);
            if (!isNaN(num) && /^[\d.]+$/.test(s)) return Math.max(0, Math.min(100, num));
            const MAP = {
                'S+': 100, 'S': 98, 'S-': 95,
                'A+': 94, 'A': 90, 'A-': 86,
                'B+': 80, 'B': 74, 'B-': 68,
                'C+': 60, 'C': 54, 'C-': 48,
                'D+': 40, 'D': 34, 'D-': 28,
                'E': 20, 'F': 12
            };
            if (MAP[s] != null) return MAP[s];
            if (s.includes('优秀')) return 92;
            if (s.includes('良好')) return 78;
            if (s.includes('合格') || s.includes('达标')) return 64;
            if (s.includes('待改进') || s.includes('不合格')) return 36;
            return null;
        }

        function pf2Sync() {
            const root = document.getElementById('profile-page');
            if (!root || pf2Sync._busy) return;
            pf2Sync._busy = true;
            try {
                const txt = id => (document.getElementById(id)?.textContent || '').trim();
                const num = id => {
                    const v = parseFloat(String(txt(id)).replace(/[^\d.-]/g, ''));
                    return isNaN(v) ? 0 : v;
                };

                // ① 姓名 / 头像首字 / 问候语 / 门店岗位行
                const name = txt('profile-name');
                const hasName = name && name !== '--' && name !== '-';

                const av = document.getElementById('profile-avatar-initial');
                if (av) {
                    const ch = hasName ? Array.from(name)[0].toUpperCase() : '–';
                    if (av.textContent !== ch) av.textContent = ch;
                }

                // 问候语：按上海时区的当前时段。用当前时间而非会话建立时间——
                // 早上登录挂到晚上还显示「早上好」会更奇怪。
                const gr = document.getElementById('profile-greeting');
                if (gr) {
                    let h;
                    try {
                        // 用 hourCycle:'h23'：hour12:false 在部分引擎午夜会返回 "24"
                        h = parseInt(new Intl.DateTimeFormat('en-US', {
                            hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Shanghai'
                        }).format(new Date()), 10);
                    } catch (e) { h = new Date().getHours(); }
                    if (isNaN(h)) h = new Date().getHours();
                    if (h >= 24) h = 0;
                    let g;
                    if (h < 5) g = '夜深了';
                    else if (h < 11) g = '早上好';
                    else if (h < 14) g = '中午好';
                    else if (h < 18) g = '下午好';
                    else g = '晚上好';
                    if (gr.textContent !== g) gr.textContent = g;
                }

                // 门店 · 部门 · 岗位：过滤空值/占位符，并去掉与姓名重复的岗位
                const meta = document.getElementById('pf2-meta');
                if (meta) {
                    const parts = ['profile-store', 'profile-department', 'profile-position']
                        .map(txt)
                        .filter(v => v && v !== '--' && v !== '-')
                        .filter((v, i, arr) => arr.indexOf(v) === i)
                        .filter(v => v !== name);
                    const line = parts.join(' \u00b7 ');
                    if (meta.textContent !== line) meta.textContent = line;
                }

                // ② 绩效条：由已渲染的等级文本派生宽度
                [['profile-execution-rating', 'pf2-bar-exec'],
                 ['profile-attitude-rating', 'pf2-bar-att'],
                 ['profile-ability-rating', 'pf2-bar-abil']].forEach(([src, bar]) => {
                    const el = document.getElementById(bar);
                    const badge = document.getElementById(src);
                    const pct = pf2RatingPct(txt(src));
                    // 等级 -> 语义档：优(薄荷) / 良(金) / 中(琥珀) / 差(珊瑚)
                    let tier = '';
                    // 阈值对齐字母档：A 系 >=85 / B 系 >=68 / C 系 >=45 / D 及以下
                    if (pct != null) tier = pct >= 85 ? 'a' : pct >= 68 ? 'b' : pct >= 45 ? 'c' : 'd';
                    if (badge) {
                        ['a', 'b', 'c', 'd'].forEach(t => badge.classList.toggle('is-' + t, tier === t));
                    }
                    if (!el) return;
                    const w = pct == null ? '0%' : pct + '%';
                    if (el.style.width !== w) el.style.width = w;
                    ['a', 'b', 'c', 'd'].forEach(t => el.classList.toggle('t-' + t, tier === t));
                });

                // ③ 考勤：只有异常值着色（0 是好消息，不该显示告警色）
                const mark = (wrapId, bad) => {
                    const el = document.getElementById(wrapId);
                    if (el) el.classList.toggle('is-bad', bad);
                };
                mark('pf2-att-absent', num('profile-att-absent-count') > 0);
                mark('pf2-att-late', num('profile-att-late-count') > 0);
                mark('pf2-att-early', num('profile-att-early-count') > 0);
                const remain = document.getElementById('pf2-att-remain');
                if (remain) {
                    const v = num('profile-att-rest-remaining');
                    remain.classList.toggle('is-good', v > 0);
                    remain.classList.toggle('is-bad', v < 0);
                }

                // ④ 待办计数：从各列表实际渲染出的条目数取
                const cnt = (sel) => root.querySelectorAll(sel).length;
                const nTask = cnt('#profile-my-tasks-list > *') + cnt('#profile-team-tasks-list > *');
                const nAppr = cnt('#profile-pending-approvals-list .pf-approval-item');
                const nNoti = cnt('#profile-notifications .pf-notif-card');
                const put = (id, v) => {
                    const e = document.getElementById(id);
                    if (e && e.textContent !== String(v)) e.textContent = v;
                };
                put('pf2-n-tasks', nTask);
                put('pf2-n-approvals', nAppr);
                put('pf2-n-notifs', nNoti);
                put('pf2-todo-total', nTask + nAppr + nNoti);

                // 待批为 0 时，红色计数徽章降级为普通样式
                const apprBadge = document.getElementById('pf2-n-approvals');
                if (apprBadge) apprBadge.classList.toggle('al', nAppr > 0);

                // 任务空态
                const te = document.getElementById('pf2-tasks-empty');
                if (te) te.style.display = nTask > 0 ? 'none' : '';

                // 待批空态
                const al = document.getElementById('profile-pending-approvals-list');
                if (al && !al.querySelector('.pf-approval-item') && !al.querySelector('.pf2-empty')) {
                    al.innerHTML = '<div class="pf2-empty">暂无待审批</div>';
                }

                // ⑤ 日期
                const now = new Date();
                const ymd = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                put('pf2-today', ymd + '-' + String(now.getDate()).padStart(2, '0'));
                put('pf2-month', ymd);

                // ⑥ 发展地图：内容非空才展开外层折叠
                const dm = document.getElementById('profile-devmap');
                const dmFold = document.getElementById('profile-devmap-fold');
                if (dm && dmFold) {
                    const has = dm.innerHTML.trim().length > 0 && dm.style.display !== 'none';
                    dmFold.style.display = has ? '' : 'none';
                }
            } catch (e) {
                /* 派生逻辑失败不应影响页面主体 */
            } finally {
                pf2Sync._busy = false;
            }
        }

        // 监听档案页子树变化，渲染函数写完值后自动派生
        (function pf2Observe() {
            const start = () => {
                const root = document.getElementById('profile-page');
                if (!root) { setTimeout(start, 400); return; }
                try {
                    const tab = localStorage.getItem('pf2_todo_tab');
                    if (tab) pf2SwitchTodo(tab);
                } catch (e) {}
                let t = null;
                new MutationObserver(() => {
                    clearTimeout(t);
                    t = setTimeout(pf2Sync, 60);
                }).observe(root, { childList: true, subtree: true, characterData: true });
                pf2Sync();
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', start);
            } else {
                start();
            }
        })();

        async function loadProfileData() {
            if (!currentUser) return;
            try { renderDevelopmentMap(); } catch (e) {}

            // Re-read employee/user data to ensure onboarding fields are up-to-date
            let _empRec = {};
            try {
                const _empList = HRMS_STORE.getEmployees() || [];
                const _userList = HRMS_STORE.getUsers() || [];
                const _uname = String(currentUser.username || '').trim().toLowerCase();
                // 仅按username匹配：id字段大量重复不可信，name匹配会误伤其他员工
                _empRec = _uname ? (_empList.find(e => String(e?.username || '').trim().toLowerCase() === _uname) || {}) : {};
                const _usrRec = _uname ? (_userList.find(u => String(u?.username || '').trim().toLowerCase() === _uname) || {}) : {};

                currentUser = {
                    ...currentUser,
                    id: currentUser.id || _empRec.id || _usrRec.id || '',
                    username: currentUser.username || _empRec.username || _usrRec.username || '',
                    name: _empRec.name || currentUser.name || _usrRec.name || '',
                    gender: _empRec.gender || _usrRec.gender || currentUser.gender || '',
                    birthday: _empRec.birthday || _usrRec.birthday || currentUser.birthday || '',
                    hometown: _empRec.hometown || _usrRec.hometown || currentUser.hometown || '',
                    // Preserve current_store/store from switch — don't overwrite with static employee record store
                    store: currentUser.current_store || currentUser.store || _empRec.store || '',
                    department: _empRec.department || currentUser.department || '',
                    position: _empRec.position || currentUser.position || '',
                    level: _empRec.level || _empRec.jobLevel || _empRec.rank || currentUser.level || '',
                    joinDate: _empRec.joinDate || _empRec.hireDate || _empRec.entryDate || _empRec.onboardDate || currentUser.joinDate || '',
                    managerUsername: _empRec.managerUsername || _empRec.manager || currentUser.managerUsername || '', managerName: _empRec.managerName || currentUser.managerName || ''
                };
            } catch (e) {}
            
            // 加载用户基本信息
            document.getElementById('profile-name').textContent = currentUser.name || '--';
            document.getElementById('profile-id').textContent = currentUser.id || '--';
            document.getElementById('profile-gender').textContent = currentUser.gender || '--';
            document.getElementById('profile-birthday').textContent = currentUser.birthday || '--';
            document.getElementById('profile-hometown').textContent = currentUser.hometown || '--';
            document.getElementById('profile-store').textContent = currentUser.store || '--';
            document.getElementById('profile-department').textContent = currentUser.department || '--';
            document.getElementById('profile-position').textContent = currentUser.position || '--';
            document.getElementById('profile-level').textContent = currentUser.level || '--';

            const managerEl = document.getElementById('profile-manager');
            if (managerEl) {
                const mgrUsername = (currentUser.managerUsername || '').trim();
                if (!mgrUsername) {
                    managerEl.textContent = '--';
                } else {
                    const users = HRMS_STORE.getUsers() || [];
                    const employees = HRMS_STORE.getEmployees() || [];
                    const key = mgrUsername.toLowerCase();
                    const mgrUser = users.find(u => String(u?.username || '').trim().toLowerCase() === key);
                    const mgrEmp = employees.find(e => String(e?.username || '').trim().toLowerCase() === key || String(e?.id || '').trim().toLowerCase() === key || String(e?.name || '').trim() === mgrUsername);
                    const mgrName = String(mgrEmp?.name || mgrUser?.name || '').trim();
                    // 如果按username找不到名字，尝试从员工档案中的managerName读取
                    const mgrNameFromEmp = !mgrName ? String(currentUser.managerName || _empRec?.managerName || '').trim() : '';
                    managerEl.textContent = mgrName || mgrNameFromEmp || mgrUsername;
                }
            }

            const username = String(currentUser.username || currentUser.id || '').trim();
            const usernameLower = username.toLowerCase();
            const data = HRMS_STORE.ensure();
            const adjs = Array.isArray(data.salaryAdjustments) ? data.salaryAdjustments : [];
            const nowMonth = hrmsShanghaiYYYYMM();
            const myAdjs = adjs.filter(a => {
                const target = String(a?.targetUsername || '').trim().toLowerCase();
                const st = String(a?.status || '').trim().toLowerCase();
                return target === usernameLower && (!st || st === 'approved');
            });
            const signedOf = (a) => {
                const signed = Number(a?.signedAmount);
                if (Number.isFinite(signed)) return signed;
                const raw = Math.abs(Number(a?.amount) || 0);
                const tp = String(a?.type || a?.rpType || '').trim().toLowerCase();
                const isPunish = tp.includes('惩罚') || tp.includes('punish');
                return isPunish ? -raw : raw;
            };
            let cumReward = 0;
            let cumPunishment = 0;
            let monthReward = 0;
            let monthPunishment = 0;
            myAdjs.forEach(a => {
                const signed = signedOf(a);
                const ym = String(a?.createdAt || a?.effectiveAt || '').slice(0, 7);
                if (signed >= 0) cumReward += signed;
                else cumPunishment += Math.abs(signed);
                if (ym === nowMonth) {
                    if (signed >= 0) monthReward += signed;
                    else monthPunishment += Math.abs(signed);
                }
            });
            const moneyText = (n) => '¥' + (Number(n || 0)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const results = Array.isArray(data.examResults) ? data.examResults : [];
            const examCount = results.filter(r => String(r?.user || '').trim() === username).length;
            const latestSelf = (() => {
                const users = Array.isArray(data.users) ? data.users : [];
                const employees = Array.isArray(data.employees) ? data.employees : [];
                const all = employees.concat(users);
                const hit = all.find(u => String(u?.username || '').trim().toLowerCase() === usernameLower);
                return hit || currentUser || {};
            })();
            const promotionHistory = Array.isArray(latestSelf?.promotionHistory) ? latestSelf.promotionHistory : [];

            const rewardEl = document.getElementById('profile-reward-count');
            const punishmentEl = document.getElementById('profile-punishment-count');
            const monthRewardEl = document.getElementById('profile-month-reward-amount');
            const monthPunishmentEl = document.getElementById('profile-month-punishment-amount');
            const examEl = document.getElementById('profile-exam-count');
            const promoEl = document.getElementById('profile-promotion-count');
            if (rewardEl) rewardEl.textContent = moneyText(cumReward);
            if (punishmentEl) punishmentEl.textContent = moneyText(cumPunishment);
            if (monthRewardEl) monthRewardEl.textContent = moneyText(monthReward);
            if (monthPunishmentEl) monthPunishmentEl.textContent = moneyText(monthPunishment);
            if (examEl) examEl.textContent = String(examCount);
            if (promoEl) promoEl.textContent = String(promotionHistory.length);
            const pointsEl = document.getElementById('profile-month-points');
            if (pointsEl) pointsEl.textContent = '—';

            // Fetch ranking for profile display
            try {
                const empMatch = (Array.isArray(data.employees) ? data.employees : []).find(e => String(e?.username || '').trim().toLowerCase() === usernameLower);
                const myStore = String(empMatch?.store || '').trim();
                const rankResp = await HRMS_API.request('/api/points/ranking?month=' + encodeURIComponent(nowMonth) + (myStore ? '&store=' + encodeURIComponent(myStore) : ''));
                if (pointsEl) pointsEl.textContent = (rankResp?.myPoints || 0) + '分';
                const rankEl = document.getElementById('profile-points-ranking');
                if (rankEl) {
                    rankEl.style.display = '';
                    if (rankResp?.myRank) {
                        rankEl.textContent = '🏅 本店排名 第' + rankResp.myRank + '名 / 共' + (rankResp.total || 0) + '人';
                    } else if (rankResp?.total > 0) {
                        rankEl.textContent = '📊 本店共' + rankResp.total + '人上榜，你暂未上榜';
                    } else {
                        rankEl.textContent = '📊 本月暂无排名数据';
                    }
                }
            } catch (e) { console.warn('[profile] ranking fetch failed:', e); }

            try { renderProfileNotifications(); } catch (e) {}
            try { renderProfilePendingApprovals(); } catch (e) {}
            try { renderProfileLeaveRecords(); } catch (e) {}
            try { loadProfileLeaveBalance(); } catch (e) {}
            try { loadProfileStoreRating(); } catch (e) {}
            try { loadProfileMyTasks(); } catch (e) {}
            try { loadProfileTeamTasks(); } catch (e) {}
        }

        // 加载我在增长方案里被指派的任务(六大标准问题+自定义问题共用growth_solution_tasks表)
        async function loadProfileMyTasks() {
            const section = document.getElementById('profile-my-tasks-section');
            const list = document.getElementById('profile-my-tasks-list');
            const countEl = document.getElementById('profile-my-tasks-count');
            if (!section || !list) return;
            try {
                const res = await fetch('/api/diagnosis/solutions/my-tasks', { headers: { 'Authorization': 'Bearer ' + dxToken() } });
                const data = await res.json();
                if (!data.ok || !(data.tasks || []).length) { section.style.display = 'none'; return; }
                section.style.display = '';
                countEl.textContent = `${data.tasks.length}项待办`;
                const todayYmd = new Date().toISOString().slice(0, 10);
                list.innerHTML = data.tasks.map(t => {
                    const overdue = t.due_date && String(t.due_date).slice(0, 10) < todayYmd;
                    const meta = [escapeHtml(t.store), escapeHtml(t.problem_title)].filter(Boolean).join(' \u00b7 ');
                    const due = t.due_date ? ` \u00b7 截止 ${String(t.due_date).slice(0, 10)}` : '';
                    const rem = Number(t.reminder_count) > 0 ? ` \u00b7 已提醒 ${t.reminder_count} 次` : '';
                    return `<div class="pf-approval-item${overdue ? ' pf-approval-item--hot' : ''}">
                        <div class="pf-approval-main">
                            <div class="pf-approval-title">${escapeHtml(t.title)}${overdue ? '<span class="ga-badge ga-badge--coral">逾期</span>' : ''}</div>
                            ${t.description ? `<div class="pf-approval-summary">${escapeHtml(t.description)}</div>` : ''}
                            <div class="pf-approval-meta">${meta}${due}${rem}</div>
                        </div>
                        <div class="pf-approval-actions">
                            <button class="ga-btn ga-btn--primary ga-btn--sm" data-click="profileCompleteMyTask" data-arg="${t.round_id}" data-arg-type="number" data-arg2="${t.task_id}" data-arg2-type="number" data-arg-self="1">完成</button>
                        </div>
                    </div>`;
                }).join('');
            } catch (e) { section.style.display = 'none'; }
        }

        // 管理层视图：下属增长方案任务完成情况——只有admin/hq_manager/store_manager等管理角色
        // 才请求这个接口(后端也会校验角色，前端role判断只是避免非管理角色发起无意义请求)。
        async function loadProfileTeamTasks() {
            const section = document.getElementById('profile-team-tasks-section');
            const list = document.getElementById('profile-team-tasks-list');
            const countEl = document.getElementById('profile-team-tasks-count');
            if (!section || !list) return;
            const managementRoles = ['admin', 'hq_manager', 'store_manager', 'front_manager', 'front_supervisor'];
            if (!managementRoles.includes(currentUser?.role)) { section.style.display = 'none'; return; }
            try {
                const res = await fetch('/api/diagnosis/solutions/team-tasks', { headers: { 'Authorization': 'Bearer ' + dxToken() } });
                const data = await res.json();
                if (!data.ok || !(data.people || []).length) { section.style.display = 'none'; return; }
                section.style.display = '';
                const totalPending = data.people.reduce((s, p) => s + p.tasks.length, 0);
                const totalOverdue = data.people.reduce((s, p) => s + p.overdue, 0);
                countEl.textContent = `${data.people.length}人 · ${totalPending}项待办${totalOverdue ? ` · ${totalOverdue}项逾期` : ''}`;
                list.innerHTML = data.people.map(p => {
                    const doneRate = p.total ? Math.round((p.done / p.total) * 100) : 0;
                    const taskRows = p.tasks.map(t => `
                        <div style="padding:8px 0;border-top:1px solid var(--pf-line);display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                            <div style="min-width:0;">
                                <div style="font-size:12.5px;color:var(--pf-tx);">${escapeHtml(t.title)}</div>
                                <div style="font-size:11px;color:${t.overdue ? 'var(--pf-neg)' : 'var(--pf-faint)'};margin-top:2px;">${escapeHtml(t.store)} · ${escapeHtml(t.problem_title)}${t.due_date ? ` · 截止${String(t.due_date).slice(0, 10)}${t.overdue ? '(已逾期)' : ''}` : ''}${Number(t.reminder_count) > 0 ? ` · 已提醒${t.reminder_count}次` : ''}</div>
                            </div>
                            <button class="ga-btn ga-btn--ghost ga-btn--sm" style="flex-shrink:0;" data-click="gsRemindTask" data-arg="${t.task_id}" data-arg-type="number" data-arg-self="1">提醒</button>
                        </div>`).join('');
                    return `<details style="margin-bottom:8px;">
                        <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--pf-line);">
                            <span style="font-size:13px;font-weight:600;color:var(--pf-tx);">${escapeHtml(p.assignee_name)}</span>
                            <span style="font-size:11px;color:var(--pf-faint);">完成${p.done}/${p.total}(${doneRate}%)${p.overdue ? ` · <span style="color:var(--pf-neg);">逾期${p.overdue}</span>` : ''}</span>
                        </summary>
                        ${taskRows || '<div style="padding:8px 0;font-size:12px;color:var(--pf-faint);">全部任务已完成</div>'}
                    </details>`;
                }).join('');
            } catch (e) { section.style.display = 'none'; }
        }

        async function profileCompleteMyTask(roundId, taskId, btn) {
            if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
            try {
                const res = await fetch(`/api/diagnosis/solutions/rounds/${roundId}/tasks/${taskId}/complete`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dxToken() }, body: '{}',
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                showNotification('已标记完成', 'success');
                loadProfileMyTasks();
            } catch (e) {
                showNotification('操作失败: ' + e.message, 'error');
                if (btn) { btn.disabled = false; btn.textContent = '标记完成'; }
            }
        }

        // 加载绩效分与门店级别（来自 HR 评分模型）
        async function loadProfileStoreRating() {
            const totalScoreEl = document.getElementById('profile-total-score');
            const executionEl = document.getElementById('profile-execution-rating');
            const attitudeEl = document.getElementById('profile-attitude-rating');
            const abilityEl = document.getElementById('profile-ability-rating');
            const badge = document.getElementById('profile-store-rating-badge');
            const ratingEl = document.getElementById('profile-store-rating');

            if (totalScoreEl) totalScoreEl.textContent = '--';
            if (executionEl) executionEl.textContent = '--';
            if (attitudeEl) attitudeEl.textContent = '--';
            if (abilityEl) abilityEl.textContent = '--';

            try {
                const __pTok = (typeof HRMS_STORE !== 'undefined' && HRMS_STORE && typeof HRMS_STORE.token === 'function')
                    ? HRMS_STORE.token()
                    : String(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '').trim();
                const resp = await fetch('/api/agent-scores/me', {
                    headers: { 'Authorization': 'Bearer ' + __pTok }
                });
                if (!resp.ok) return;
                const data = await resp.json();

                const totalScore = Number(data?.total_score);
                const execution = String(data?.execution_rating || '').trim();
                const attitude = String(data?.attitude_rating || '').trim();
                const ability = String(data?.ability_rating || '').trim();
                const storeRating = String(data?.store_rating || data?.breakdown?.store_rating || '').trim();

                if (totalScoreEl) {
                    totalScoreEl.textContent = Number.isFinite(totalScore)
                        ? String(Number(totalScore.toFixed(1))).replace('.0', '')
                        : '--';
                }
                if (executionEl) executionEl.textContent = execution || '--';
                if (attitudeEl) attitudeEl.textContent = attitude || '--';
                if (abilityEl) abilityEl.textContent = ability || '--';

                const storeHint = document.getElementById('profile-store-rating-hint');
                const personalHint = document.getElementById('profile-personal-performance-hint');
                if (storeHint) {
                    storeHint.textContent = String(data?.storeRatingPeriodNote || '').trim() || '';
                }
                if (personalHint) {
                    personalHint.textContent = String(data?.personalPerformanceNote || '').trim() || '';
                }

                if (badge && ratingEl) {
                    const ratingText = storeRating ? `${storeRating}级` : '待评估';
                    ratingEl.textContent = ratingText;
                    const colors = {
                        A: 'rgba(52,211,153,0.98)',
                        B: 'rgba(96,165,250,0.98)',
                        C: 'rgba(251,191,36,0.98)',
                        D: 'rgba(248,113,113,0.98)',
                        null: 'rgba(203,213,225,0.92)'
                    };
                    const tint = {
                        A: 'rgba(34,197,94,0.12)',
                        B: 'rgba(59,130,246,0.12)',
                        C: 'rgba(245,158,11,0.12)',
                        D: 'rgba(239,68,68,0.12)',
                        null: 'rgba(148,163,184,0.08)'
                    };
                    const borderTint = {
                        A: 'rgba(52,211,153,0.35)',
                        B: 'rgba(96,165,250,0.35)',
                        C: 'rgba(251,191,36,0.35)',
                        D: 'rgba(248,113,113,0.35)',
                        null: 'rgba(255,255,255,0.16)'
                    };
                    const ratingKey = storeRating || 'null';
                    ratingEl.style.color = colors[ratingKey] || colors.null;
                    const ti = tint[ratingKey] || tint.null;
                    const bd = borderTint[ratingKey] || borderTint.null;
                    badge.style.background = `linear-gradient(165deg, rgba(255,255,255,0.1), ${ti})`;
                    badge.style.backdropFilter = 'blur(18px) saturate(1.45)';
                    badge.style.webkitBackdropFilter = 'blur(18px) saturate(1.45)';
                    badge.style.border = `1px solid ${bd}`;
                    badge.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.14), 0 8px 28px rgba(0,0,0,0.22)';
                    badge.style.display = 'block';
                }
            } catch (e) {
                console.warn('loadProfileStoreRating error:', e);
            }
        }

        function __notifRelativeTime(isoStr) {
            try {
                const d = new Date(isoStr);
                if (isNaN(d.getTime())) return '';
                const now = new Date();
                const diff = now - d;
                const mins = Math.floor(diff / 60000);
                if (mins < 1) return '刚刚';
                if (mins < 60) return mins + '分钟前';
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return hrs + '小时前';
                const days = Math.floor(hrs / 24);
                if (days === 1) return '昨天';
                if (days < 7) return days + '天前';
                return isoStr.slice(0, 10);
            } catch (e) { return ''; }
        }

        async function renderProfileNotifications() {
            const box = document.getElementById('profile-notifications');
            const empty = document.getElementById('profile-notifications-empty');
            const pulseEl = document.getElementById('profile-notif-pulse');
            const subtitleEl = document.getElementById('profile-notif-subtitle');
            const countBadge = document.getElementById('profile-notif-count-badge');
            if (!box || !empty || !currentUser) return;
            const data = HRMS_STORE.ensure();
            const myUsername = String(currentUser.username || currentUser.id || '').trim().toLowerCase();

            // 从 API 获取 DB 中的公司通知（V2 Agent 直接写入 hrms_user_notifications 表）
            let dbNotifs = [];
            try {
                const token = (typeof HRMS_STORE !== 'undefined' && HRMS_STORE && typeof HRMS_STORE.token === 'function')
                    ? HRMS_STORE.token()
                    : String(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '').trim();
                const r = await fetch('/api/hrms-notifications/me?limit=100', {
                    headers: { 'Authorization': 'Bearer ' + token },
                    cache: 'no-store'
                });
                if (r.ok) {
                    const j = await r.json();
                    dbNotifs = (j.items || []).map(n => ({
                        id: String(n.id || ''),
                        targetUser: myUsername,
                        title: String(n.title || '公司通知'),
                        message: String(n.message || ''),
                        type: String(n.type || ''),
                        createdAt: String(n.created_at || ''),
                        meta: n.meta || {}
                    }));
                }
            } catch (e) { /* ignore */ }

            // DB 通知（从 hrms_user_notifications 表来，全部通知均写入 DB）
            const dbSysNotifs = dbNotifs
                .filter(n => n && !String(n.type || '').trim().endsWith('_request'))
                .map(n => ({
                    title: n.title || '公司通知',
                    content: n.message || '',
                    createdAt: n.createdAt || '',
                    level: (n.meta && n.meta.priority === 'A') ? 'urgent' : 'system',
                    meta: n.meta || {},
                    _src: 'db_notification',
                    _id: 'db-' + n.id
                }));

            const anns = (Array.isArray(data.announcements) ? data.announcements : [])
                .filter(a => {
                    if (!a) return false;
                    const scope = a.scope || { type: 'all' };
                    const t = String(scope.type || 'all');
                    if (t === 'all') return true;
                    if (t === 'hq') return String(currentUser?.store || '') === '总部';
                    if (t === 'store') return String(scope.store || '') === String(currentUser?.store || '');
                    return false;
                })
                .map(a => ({ ...a, _src: 'announcement', _id: a.id || '' }));
            const visible = dbSysNotifs.concat(anns);
            // 置顶公告优先显示（检查是否过期）
            const nowISO = new Date().toISOString();
            const isPinned = (a) => {
                if (!a?.pinned) return false;
                if (a?.pin_until && a.pin_until < nowISO) return false; // 过期自动取消置顶
                return true;
            };
            visible.sort((a, b) => {
                const aPinned = isPinned(a);
                const bPinned = isPinned(b);
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;
                return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''));
            });

            // 强制确认队列：覆盖"公司通知"面板里的全部内容——管理员发布的公告 + 系统自动通知
            // （培训任务指派、审批结果、系统告警等），只对"强制确认上线之后"产生的新消息生效，
            // 之前已存在的历史消息不会突然弹窗骚扰所有员工。
            // 公告的已读状态走服务端 readBy；系统通知没有按用户的已读字段，用本地 localStorage 记忆。
            const sysAckKey = 'hrms_acked_sys_notifs_' + myUsername;
            let ackedSysIds = [];
            try { ackedSysIds = JSON.parse(localStorage.getItem(sysAckKey) || '[]'); } catch (e) { ackedSysIds = []; }
            // 注意：系统通知(db_notification)的createdAt来自后端timestamptz自定义解析，格式是
            // "2026-06-26 19:22:24"(空格分隔，不带T/Z)；公告(announcement)的createdAt是前端
            // hrmsNowISO()生成的标准ISO("...T...Z")。两种格式直接用字符串>=比较会踩坑——空格
            // 的ASCII码比'T'小，导致"空格格式"的时间永远被判定"小于"ISO格式的cutoff，不管
            // 实际多新都会被排除在强制队列外。这里统一转成Date时间戳再比较，规避格式差异。
            const forceAckCutoffMs = new Date(ANNOUNCEMENT_FORCE_ACK_SINCE).getTime();
            const ackQueue = visible.filter(a => {
                if (!a) return false;
                const createdMs = new Date(a?.createdAt || 0).getTime();
                if (!Number.isFinite(createdMs) || createdMs < forceAckCutoffMs) return false;
                if (a._src === 'announcement') return !(a?.readBy && a.readBy[myUsername]);
                if (a._src === 'db_notification') return !ackedSysIds.includes(String(a._id || ''));
                return false;
            });
            if (ackQueue.length) {
                ackQueue.sort((a, b) => (String(a.level) === 'urgent' ? -1 : 0) - (String(b.level) === 'urgent' ? -1 : 0));
                setTimeout(() => showForcedAnnouncementAck(ackQueue), 400);
            }

            // Update header badge & subtitle
            const todayDate = new Date().toISOString().slice(0, 10);
            const todayCount = visible.filter(a => String(a?.createdAt || '').slice(0, 10) === todayDate).length;

            if (!visible.length) {
                box.innerHTML = '';
                empty.style.display = '';
                const expandFooterEmpty = document.getElementById('profile-notif-expand-footer');
                if (expandFooterEmpty) expandFooterEmpty.innerHTML = '';
                if (pulseEl) pulseEl.style.display = 'none';
                if (subtitleEl) subtitleEl.textContent = '暂无新通知';
                if (countBadge) countBadge.style.display = 'none';
                return;
            }
            empty.style.display = 'none';
            if (pulseEl) pulseEl.style.display = todayCount > 0 ? '' : 'none';
            if (subtitleEl) subtitleEl.textContent = todayCount > 0 ? `今日 ${todayCount} 条新通知` : `共 ${visible.length} 条通知`;
            if (countBadge) {
                if (todayCount > 0) {
                    countBadge.style.display = '';
                    countBadge.textContent = todayCount + ' 新';
                } else {
                    countBadge.style.display = 'none';
                }
            }

            const isAdmin = isAdminUser();
            const pubBtn = document.getElementById('profile-publish-announcement-btn');
            if (pubBtn) pubBtn.style.display = isAdmin ? '' : 'none';
            const COLLAPSE_LIMIT = 3;

            const renderCard = (a, idx, animDelay) => {
                const title = escapeHtml(String(a?.title || '通知'));
                const rawMsg = String(a?.content || '');
                const msg = escapeHtml(rawMsg);
                const relTime = __notifRelativeTime(a?.createdAt);
                const fullDt = String(a?.createdAt || '').slice(0, 16).replace('T', ' ');
                const isSys = a._src === 'notification' || a._src === 'db_notification';
                const notifDate = String(a?.createdAt || '').slice(0, 10);
                const isToday = notifDate === todayDate;
                const annLevel = String(a?.level || 'normal');
                const isUrgent = annLevel === 'urgent';
                const isImportant = annLevel === 'important' || isUrgent;
                const isRead = isSys ? true : !!(a?.readBy && a.readBy[myUsername]);

                const __ic = n => '<svg class="pfi"><use href="#pfi-' + n + '"/></svg>';
                let typeIcon = __ic(isSys ? 'bell' : 'mega');
                if (String(a?.title || '').includes('排班')) typeIcon = __ic('cal');
                if (isUrgent) typeIcon = __ic('alert');

                const nowISO = new Date().toISOString();
                const isPinned = a?.pinned && (!a?.pin_until || a.pin_until >= nowISO);
                let badge = '';
                if (isUrgent) {
                    badge = '<span class="pf-notif-badge pf-notif-badge--urgent">紧急</span>';
                } else if (isPinned) {
                    badge = '<span class="pf-notif-badge pf-notif-badge--announcement">置顶</span>';
                } else if (isToday) {
                    badge = '<span class="pf-notif-badge pf-notif-badge--warning">NEW</span>';
                } else if (isImportant) {
                    badge = '<span class="pf-notif-badge pf-notif-badge--warning">重要</span>';
                } else if (!isSys) {
                    badge = '<span class="pf-notif-badge pf-notif-badge--announcement">公告</span>';
                }
                const unreadDot = (!isSys && !isRead) ? '<span class="pf-notif-unread-dot" title="未读"></span>' : '';

                const srcId = a._src + '|' + a._id;
                const delBtn = isAdmin
                    ? '<button type="button" data-click="deleteProfileNotification" data-arg="' + srcId + '" data-stop class="ga-btn ga-btn--danger ga-btn--sm" style="height:26px;font-size:11px;">删除</button>'
                    : '';
                const receiptBtn = (isAdmin && !isSys && a._id)
                    ? '<button type="button" data-click="showAnnouncementReceipts" data-arg="' + escapeHtml(String(a._id)) + '" data-stop class="ga-btn ga-btn--sm" style="height:26px;font-size:11px;">已读情况</button>'
                    : '';

                const isLong = rawMsg.length > 80;
                const preview = isLong ? escapeHtml(rawMsg.slice(0, 80)) + '…' : msg;

                const cardCls = 'pf-notif-card' + (isUrgent ? ' pf-notif-card--urgent' : '') + (!isSys && !isRead ? ' pf-notif-card--unread' : '');
                return '<div class="' + cardCls + '"' + (isLong ? ' data-click="hrmsToggleNotifFull" data-arg-self="1"' : '') + '>'
                    + '<div class="pf-notif-head">'
                    +   '<div class="pf-notif-main">'
                    +     '<span class="pf-notif-icon">' + typeIcon + '</span>'
                    +     '<div class="pf-notif-copy">'
                    +       '<div class="pf-notif-title-row">'
                    +         unreadDot
                    +         '<span class="pf-notif-title">' + title + '</span>'
                    +         badge
                    +       '</div>'
                    +       '<div class="pf-notif-meta">' + escapeHtml(relTime) + ' · ' + escapeHtml(fullDt) + '</div>'
                    +     '</div>'
                    +   '</div>'
                    +   '<div style="display:flex;gap:6px;flex-shrink:0;">' + receiptBtn + delBtn + '</div>'
                    + '</div>'
                    + '<div class="pf-notif-body">' + preview + '</div>'
                    + (isLong ? '<div class="notif-full-msg pf-notif-full" style="display:none;">' + msg + '</div><div class="pf-notif-expand-hint">点击展开全文</div>' : '')
                    + '</div>';
            };

            const expandFooter = document.getElementById('profile-notif-expand-footer');
            if (expandFooter) expandFooter.innerHTML = '';

            const topCards = visible.slice(0, COLLAPSE_LIMIT).map((a, i) => renderCard(a, i, i * 60)).join('');
            let html = topCards;

            if (visible.length > COLLAPSE_LIMIT) {
                const moreCards = visible.slice(COLLAPSE_LIMIT).map((a, i) => renderCard(a, i + COLLAPSE_LIMIT, 0)).join('');
                html += `<div id="profile-notif-more" class="notif-expand-area">${moreCards}</div>`;
                if (expandFooter) {
                    expandFooter.innerHTML = `<button type="button" id="profile-notif-toggle" class="notif-more-btn" data-click="toggleProfileNotifications">
                    查看更多通知（${visible.length - COLLAPSE_LIMIT}条）▾
                </button>`;
                }
            }
            box.innerHTML = html;
        }

        // 重要公告强制确认队列：一个一个弹，点"我已阅读"才关掉当前这个并弹下一个
        // 强制确认上线时间：只有这个时间之后发布的公告才会强制弹窗，历史公告不受影响
        const ANNOUNCEMENT_FORCE_ACK_SINCE = '2026-06-26T00:00:00.000Z';
        let __ackAnnouncementQueue = [];
        function formatAckAnnouncementHtml(item) {
            const raw = String(item?.content || '').trim();
            const title = String(item?.title || '').replace(/^【[^】]+】/, '').trim();
            const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
            const kv = [];
            let summary = '';
            let details = [];
            let inTips = false;
            for (const line of lines) {
                if (/^【排查建议】/.test(line)) { inTips = true; details.push(line); continue; }
                if (/^【去重】/.test(line)) { details.push(line); continue; }
                if (inTips) { details.push(line); continue; }
                if (/^—+$/.test(line)) continue;
                const m = line.match(/^([^：:]+)[：:]\s*(.+)$/);
                if (m && /^(时间|问题类型|级别|配置键|表名|app_token|table_id|错误摘要)/.test(m[1])) {
                    kv.push({ k: m[1], v: m[2] });
                    continue;
                }
                if (!summary && !/^🔴|^🟠|^🟡/.test(line) && line !== title) summary = line;
            }
            if (!summary && kv.length) {
                const err = kv.find((x) => x.k === '错误摘要');
                summary = err ? ('同步失败：' + err.v) : ('「' + (title || '系统通知') + '」需要您确认已读。');
            }
            if (!summary) summary = raw.slice(0, 280) || '请阅读以下内容并确认。';
            summary = summary.replace(/^🔴\s*【数据异常告警·[^】]+】/,'').trim();

            let html = '<div class="ack-summary">' + escapeHtml(summary) + '</div>';
            if (kv.length) {
                html += '<div class="ack-kv">' + kv.slice(0, 6).map(function(row) {
                    return '<div class="ack-kv-row"><span class="ack-kv-k">' + escapeHtml(row.k) + '</span><span class="ack-kv-v">' + escapeHtml(row.v) + '</span></div>';
                }).join('') + '</div>';
            }
            const rest = details.length ? details.join('\n') : raw;
            if (rest && rest.length > summary.length + 20) {
                html += '<details class="ack-details"><summary>技术详情与排查建议</summary><div class="ack-details-body">' + escapeHtml(rest) + '</div></details>';
            }
            return html;
        }
        function showForcedAnnouncementAck(queue) {
            __ackAnnouncementQueue = Array.isArray(queue) ? queue.slice() : [];
            __showNextForcedAnnouncement();
        }
        function __showNextForcedAnnouncement() {
            const modal = document.getElementById('ack-announcement-modal');
            if (!modal) return;
            if (!__ackAnnouncementQueue.length) { modal.classList.remove('show'); return; }
            const a = __ackAnnouncementQueue[0];
            const isSysNotif = a?._src === 'db_notification';
            const isUrgent = String(a?.level || '') === 'urgent' || /A级·紧急|【A级/.test(String(a?.title || ''));
            const top = document.getElementById('ack-announcement-top');
            const badge = document.getElementById('ack-announcement-badge');
            const queueEl = document.getElementById('ack-announcement-queue');
            const titleEl = document.getElementById('ack-announcement-title');
            const metaEl = document.getElementById('ack-announcement-meta');
            const contentEl = document.getElementById('ack-announcement-content');
            const btn = document.getElementById('ack-announcement-btn');
            const tone = isUrgent ? 'urgent' : (isSysNotif ? 'warn' : 'info');
            if (top) top.className = 'ack-top ack-top--' + tone;
            if (badge) {
                badge.className = 'ack-badge ack-badge--' + tone;
                badge.textContent = isSysNotif ? (isUrgent ? '紧急告警' : '系统通知') : (isUrgent ? '紧急公告' : '重要公告');
            }
            if (queueEl) {
                const n = __ackAnnouncementQueue.length;
                queueEl.textContent = n > 1 ? ('待确认 ' + n + ' 条') : '';
            }
            const cleanTitle = String(a?.title || '通知').replace(/^【[^】]+】/, '').trim();
            if (titleEl) titleEl.textContent = cleanTitle || '通知';
            const metaPrefix = isSysNotif ? '系统自动发送' : ('发布人：' + String(a?.createdByName || a?.createdBy || '管理员'));
            const when = String(a?.createdAt || '').slice(0, 16).replace('T', ' ');
            if (metaEl) metaEl.textContent = metaPrefix + ' · ' + when;
            if (contentEl) {
                contentEl.innerHTML = isSysNotif ? formatAckAnnouncementHtml(a) : ('<div class="ack-summary">' + escapeHtml(String(a?.content || '')) + '</div>');
            }
            if (btn) btn.className = 'ack-btn' + (isUrgent ? ' ack-btn--urgent' : '');
            modal.classList.add('show');
        }
        async function ackAndCloseAnnouncement() {
            const a = __ackAnnouncementQueue[0];
            if (!a) { document.getElementById('ack-announcement-modal')?.classList.remove('show'); return; }
            const annId = String(a.id || a._id || '');
            const myUsername = String(currentUser?.username || currentUser?.id || '').trim().toLowerCase();
            if (a._src === 'db_notification') {
                // 系统自动通知（培训任务指派/审批结果/系统告警等）没有按用户的服务端已读字段，
                // 用 localStorage 按账号记一份已确认过的 id 列表。
                try {
                    const key = 'hrms_acked_sys_notifs_' + myUsername;
                    let ids = [];
                    try { ids = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { ids = []; }
                    if (!ids.includes(annId)) ids.push(annId);
                    localStorage.setItem(key, JSON.stringify(ids));
                } catch (e) {}
            } else {
                try {
                    await HRMS_API.request('/api/announcements/' + encodeURIComponent(annId) + '/ack', { method: 'POST' });
                } catch (e) { console.warn('ack announcement failed', e); }
                // 本地同步标记已读：renderProfileNotifications 用的是本地缓存的 data.announcements，
                // 不写回的话下次重渲染还是查到 readBy 缺失，又被判定成未读重新塞回强制队列，弹窗消不掉。
                try {
                    const localData = HRMS_STORE.ensure();
                    const ann = (Array.isArray(localData.announcements) ? localData.announcements : []).find(x => String(x?.id || '') === annId);
                    if (ann) {
                        if (!ann.readBy || typeof ann.readBy !== 'object' || Array.isArray(ann.readBy)) ann.readBy = {};
                        ann.readBy[myUsername] = new Date().toISOString();
                        // HRMS_STORE.get()/ensure() 每次都从 localStorage 重新读取解析，不是同一个对象引用，
                        // 只改内存对象不会持久化，必须显式 set() 写回 localStorage 才能让下次 ensure() 看到。
                        HRMS_STORE.set(localData);
                    }
                } catch (e) {}
            }
            __ackAnnouncementQueue.shift();
            if (__ackAnnouncementQueue.length) {
                __showNextForcedAnnouncement();
            } else {
                document.getElementById('ack-announcement-modal')?.classList.remove('show');
                try { renderProfileNotifications(); } catch (e) {}
            }
        }

        // 管理员查看某条公告的已读情况
        async function showAnnouncementReceipts(annId) {
            const modal = document.getElementById('announcement-receipts-modal');
            const body = document.getElementById('announcement-receipts-body');
            if (!modal || !body) return;
            body.innerHTML = '加载中…';
            modal.classList.add('show');
            try {
                const data = await HRMS_API.request('/api/announcements/' + encodeURIComponent(annId) + '/receipts');
                const total = data.total || 0;
                const readCount = data.readCount || 0;
                const unread = Array.isArray(data.unread) ? data.unread : [];
                const pct = total ? Math.round((readCount / total) * 100) : 0;
                let html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">'
                    + '<div style="font-size:28px;font-weight:800;color:' + (pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444') + ';">' + pct + '%</div>'
                    + '<div style="color:#666;font-size:12px;">已读 ' + readCount + ' / 共 ' + total + ' 人</div>'
                    + '</div>';
                if (unread.length) {
                    html += '<div style="font-weight:700;margin-bottom:6px;">未读名单（' + unread.length + '人）</div>';
                    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + unread.map(u =>
                        '<span style="background:rgba(239,68,68,0.1);color:#ef4444;padding:4px 10px;border-radius:8px;font-size:12px;">' + escapeHtml(u.name || u.username) + (u.store ? '（' + escapeHtml(u.store) + '）' : '') + '</span>'
                    ).join('') + '</div>';
                } else {
                    html += '<div style="color:#10b981;">🎉 全员已读</div>';
                }
                body.innerHTML = html;
            } catch (e) {
                body.innerHTML = '<span style="color:#ef4444;">加载失败：' + escapeHtml(e.message || '') + '</span>';
            }
        }
        function closeAnnouncementReceiptsModal() {
            document.getElementById('announcement-receipts-modal')?.classList.remove('show');
        }

        function toggleProfileNotifications() {
            const more = document.getElementById('profile-notif-more');
            const btn = document.getElementById('profile-notif-toggle');
            if (!more || !btn) return;
            const isExpanded = more.classList.contains('expanded');
            if (isExpanded) {
                more.classList.remove('expanded');
                btn.innerHTML = btn.getAttribute('data-more-text') || '查看更多通知 ▾';
                const sc = document.querySelector('.profile-notifications-scroll');
                if (sc) sc.scrollTop = 0;
            } else {
                btn.setAttribute('data-more-text', btn.innerHTML);
                more.classList.add('expanded');
                btn.innerHTML = '收起 ▴';
            }
        }

        async function renderProfilePendingApprovals() {
            const card = document.getElementById('profile-pending-approvals-card');
            const list = document.getElementById('profile-pending-approvals-list');
            const countEl = document.getElementById('profile-pending-count');
            if (!card || !list || !currentUser) return;
            try {
                const resp = await HRMS_API.getApprovals();
                const all = Array.isArray(resp?.items) ? resp.items : [];
                __APPROVALS_CACHE = all;
                const myUn = String(currentUser.username || '').toLowerCase();
                const pending = all.filter(it => {
                    if (String(it?.status || '') !== 'pending') return false;
                    if (currentUser.role === 'store_production_manager' && String(it?.type || '') === 'points') return false;
                    const assignee = String(it?.current_assignee_username || '').toLowerCase();
                    if (assignee === myUn) return true;
                    const chain = Array.isArray(it?.chain) ? it.chain : [];
                    return chain.some(s => String(s?.assignee || '').toLowerCase() === myUn && String(s?.status || '') === 'pending');
                });
                if (!pending.length) {
                    list.innerHTML = '<div style="font-size:12px;color:var(--faint);text-align:center;padding:8px;">暂无待审批</div>';
                    if (countEl) countEl.textContent = '0';
                    return;
                }
                if (countEl) countEl.textContent = String(pending.length);
                const show = pending.slice(0, 5);
                list.innerHTML = show.map(it => {
                    const id = escapeHtml(String(it?.id || ''));
                    const type = approvalTypeText(it?.type);
                    const who = hrmsDisplayName(it?.applicant_username);
                    const time = String(it?.created_at || it?.createdAt || '').slice(0, 16).replace('T', ' ');
                    const payload = it?.payload && typeof it.payload === 'object' ? it.payload : {};
                    let summary = '';
                    const tp = String(it?.type || '');
                    if (tp === 'onboarding') {
                        const emp = payload?.employee || payload;
                        summary = `新员工：${escapeHtml(String(emp?.name || emp?.username || '-'))}，门店：${escapeHtml(String(emp?.store || '-'))}`;
                    } else if (tp === 'leave') {
                        summary = `${escapeHtml(String(payload?.startDate || ''))} 至 ${escapeHtml(String(payload?.endDate || ''))}${payload?.days ? `（${payload.days}天）` : ''}`;
                    } else if (tp === 'promotion') {
                        summary = `${escapeHtml(String(payload?.newLevel || payload?.level || '-'))} ${escapeHtml(String(payload?.newPosition || payload?.position || ''))}`;
                    } else if (tp === 'reward_punishment') {
                        const tgt = escapeHtml(String(payload?.targetName || payload?.targetUsername || '-'));
                        const rpT = String(payload?.rpType || payload?.category || '');
                        const amt = payload?.amount ? `¥${payload.amount}` : '';
                        summary = `${tgt} ${escapeHtml(rpT)} ${escapeHtml(amt)}`;
                    } else if (tp === 'points') {
                        const itemName = escapeHtml(String(payload?.itemName || '积分事项'));
                        const pts = Number(payload?.points || 0);
                        summary = `${itemName} · ${pts}分`;
                    } else if (tp === 'offboarding') {
                        summary = `离职日期：${escapeHtml(String(payload?.resignDate || payload?.date || '-'))}`;
                    } else if (tp === 'payment') {
                        summary = `金额：¥${escapeHtml(String(payload?.amount || '-'))}`;
                    }
                    return '<div class="pf-approval-item">'
                        + '<div class="pf-approval-main">'
                        +   '<div class="pf-approval-title">' + escapeHtml(type) + '</div>'
                        +   '<div class="pf-approval-meta">申请人：' + escapeHtml(who) + ' · ' + escapeHtml(time) + '</div>'
                        +   (summary ? '<div class="pf-approval-summary">' + summary + '</div>' : '')
                        + '</div>'
                        + '<div class="pf-approval-actions">'
                        +   '<button class="ga-btn ga-btn--primary ga-btn--sm" style="height:28px;font-size:11px;border-radius:8px;" data-click="profileQuickApprove" data-arg="' + id + '" data-arg2="true">通过</button>'
                        +   '<button class="ga-btn ga-btn--danger ga-btn--sm" style="height:28px;font-size:11px;border-radius:8px;" data-click="profileQuickApprove" data-arg="' + id + '" data-arg2="false">拒绝</button>'
                        +   '<button class="ga-btn ga-btn--ghost ga-btn--sm" style="height:28px;font-size:11px;border-radius:8px;" data-click="openApprovalDetailModal" data-arg="' + id + '">详情</button>'
                        + '</div>'
                        + '</div>';
                }).join('') + (pending.length > 5 ? '<div style="text-align:center;margin-top:8px;font-size:12px;color:var(--dim);">还有 ' + (pending.length - 5) + ' 条待处理…</div>' : '');
            } catch (e) {
                list.innerHTML = '<div style="font-size:12px;color:var(--coral);text-align:center;padding:8px;">加载待审批失败</div>';
            }
        }

        async function profileQuickApprove(id, approved) {
            const action = approved ? '通过' : '拒绝';
            let note = '';
            if (!approved) {
                note = prompt('请输入拒绝原因（可选）：') || '';
            }
            const _okApprove = await hrmsConfirm({ title: `${action}审批`, message: `确认${action}该审批？`, okText: `确认${action}`, icon: approved ? '✅' : '❌' });
            if (!_okApprove) return;
            try {
                await HRMS_API.decideApproval(id, !!approved, note || '');
                showNotification(`审批已${action}`, 'success');
                renderProfilePendingApprovals();
                renderProfileNotifications();
            } catch (e) {
                showNotification('操作失败：' + String(e?.message || e), 'error');
            }
        }

        // Build the merged visible list (announcements only; notifications come from DB via renderProfileNotifications)
        function _getProfileVisibleNotifs() {
            const data = HRMS_STORE.ensure();
            const anns = (Array.isArray(data.announcements) ? data.announcements : [])
                .filter(a => {
                    if (!a) return false;
                    const scope = a.scope || { type: 'all' };
                    const t = String(scope.type || 'all');
                    if (t === 'all') return true;
                    if (t === 'hq') return String(currentUser?.store || '') === '总部';
                    if (t === 'store') return String(scope.store || '') === String(currentUser?.store || '');
                    return false;
                })
                .map(a => ({ ...a, _src: 'announcement', _id: a.id || '' }));
            anns.sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
            return anns;
        }

        async function deleteProfileNotification(srcId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可删除通知', 'warning');
                return;
            }
            const _okDN = await hrmsConfirm({ title: '删除通知', message: '确定删除此通知？', okText: '确认删除', icon: '🗑️' });
            if (!_okDN) return;
            try {
                const parts = String(srcId || '').split('|');
                const src = parts[0];
                const id = parts.slice(1).join('|');
                const dbId = id.replace(/^db-/, '');
                const data = HRMS_STORE.ensure();
                if (src === 'db_notification') {
                    if (dbId) {
                        try { await HRMS_API.request('/api/notifications/' + encodeURIComponent(dbId), { method: 'DELETE' }); } catch (e) { console.warn('db notif delete failed', e); }
                    }
                } else {
                    if (id) {
                        try { await HRMS_API.deleteAnnouncementApi(id); } catch (e) {
                            // 兼容旧通知：本地仍删
                            console.warn('announcement delete failed', e);
                        }
                    }
                    const anns = Array.isArray(data.announcements) ? data.announcements.slice() : [];
                    data.announcements = anns.filter(a => String(a?.id || '') !== String(id));
                    if (dbId) {
                        try { await HRMS_API.request('/api/notifications/' + encodeURIComponent(dbId), { method: 'DELETE' }); } catch (e) { console.warn('db ann delete failed', e); }
                    }
                }
                HRMS_STORE.set(data);
                showNotification('通知已删除', 'success');
                renderProfileNotifications();
            } catch (e) {
                showNotification('删除失败', 'error');
            }
        }

        function renderProfileLeaveRecords() {
            const box = document.getElementById('profile-leave-records');
            if (!box || !currentUser) return;
            const username = String(currentUser.username || currentUser.id || '').trim();
            const data = HRMS_STORE.ensure();
            const list = Array.isArray(data.leaveRecords) ? data.leaveRecords : [];
            const mine = list.filter(x => String(x?.applicant || '').trim() === username);
            mine.sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
            const top = mine.slice(0, 5);
            if (!top.length) {
                box.innerHTML = '<div style="color: rgba(200,215,230,0.72); font-size: 12px; padding: 10px 2px;">暂无休假记录</div>';
                return;
            }
            box.innerHTML = `
                <div style="font-weight: 900; margin-bottom: 10px;">我的休假记录</div>
                ${top.map(r => {
                    const start = escapeHtml(String(r?.startDate || '-'));
                    const end = escapeHtml(String(r?.endDate || '-'));
                    const reason = escapeHtml(String(r?.reason || ''));
                    const days = String(r?.days || '').trim();
                    const meta = [days ? (days + '天') : '', String(r?.createdAt || '').slice(0, 10)].filter(Boolean).join(' · ');
                    return `
                        <div style="padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); margin-bottom: 10px;">
                            <div style="font-weight: 900;">${start} 至 ${end}</div>
                            ${reason ? `<div style="margin-top: 6px; color: rgba(226,232,240,0.92); font-size: 13px;">${reason}</div>` : ''}
                            <div style="margin-top: 6px; color: rgba(200,215,230,0.72); font-size: 12px;">${escapeHtml(meta || '-') }</div>
                        </div>
                    `;
                }).join('')}
            `;
        }

        async function loadProfileLeaveBalance() {
            if (!currentUser) return;
            const month = hrmsShanghaiYYYYMM();
            const monthEl = document.getElementById('profile-leave-month');
            if (monthEl) monthEl.textContent = month;
            try {
                const uname = String(currentUser.username || '').trim();
                const displayName = String(currentUser.displayName || currentUser.name || currentUser.username || uname || '-');
                const overview = await HRMS_API.getProfileAttendanceOverview({ month });
                const nameEl = document.getElementById('profile-att-username');
                const monthTagEl = document.getElementById('profile-att-month');
                const cumulativeEl = document.getElementById('profile-att-cumulative-leave');
                const absentEl = document.getElementById('profile-att-absent-count');
                const lateEl = document.getElementById('profile-att-late-count');
                const earlyEl = document.getElementById('profile-att-early-count');
                const restEl = document.getElementById('profile-att-rest-days');
                const restRemainEl = document.getElementById('profile-att-rest-remaining');
                if (nameEl) nameEl.textContent = displayName;
                if (monthTagEl) monthTagEl.textContent = month;
                if (cumulativeEl) cumulativeEl.textContent = String(Number(overview?.cumulativeLeaveDays || 0));
                if (absentEl) absentEl.textContent = String(Number(overview?.absentCount || 0));
                if (lateEl) lateEl.textContent = String(Number(overview?.lateCount || 0));
                if (earlyEl) earlyEl.textContent = String(Number(overview?.earlyLeaveCount || 0));
                if (restEl) restEl.textContent = String(Number(overview?.restDays || 0));
                if (restRemainEl) restRemainEl.textContent = String(Number(overview?.monthRestRemaining || 0));
            } catch (e) {
                console.warn('loadProfileLeaveBalance error:', e);
                const nameEl = document.getElementById('profile-att-username');
                const monthTagEl = document.getElementById('profile-att-month');
                if (nameEl) nameEl.textContent = String(currentUser.displayName || currentUser.name || currentUser.username || '-');
                if (monthTagEl) monthTagEl.textContent = month;
            }
        }

        function openLeaveApplyModal() {
            const m = document.getElementById('leave-apply-modal');
            if (m) m.classList.add('show');
            // Calculate leave balance
            try {
                const balEl = document.getElementById('leave-balance-value');
                if (!balEl) return;
                if (!currentUser) { balEl.textContent = '-'; return; }
                const username = String(currentUser.username || '').trim().toLowerCase();
                // Find employee record for join date
                const employees = HRMS_STORE.getEmployees ? (HRMS_STORE.getEmployees() || []) : [];
                const users = HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : [];
                const emp = employees.find(e => String(e?.username || '').toLowerCase() === username) ||
                            users.find(u => String(u?.username || '').toLowerCase() === username);
                const joinDate = emp?.joinDate || emp?.hireDate || '';
                // Calculate annual leave based on tenure
                let annualDays = 0; // 入职未满1年无年假
                if (joinDate) {
                    const jd = new Date(joinDate);
                    const now = new Date();
                    const years = (now - jd) / (365.25 * 24 * 60 * 60 * 1000);
                    if (years >= 20) annualDays = 15;
                    else if (years >= 10) annualDays = 10;
                    else if (years >= 1) annualDays = 5;
                    else annualDays = 0;
                }
                // Count used leave days this year
                let usedDays = 0;
                try {
                    HRMS_API.request('/api/approvals?type=leave', { method: 'GET' }).then(resp => {
                        const items = Array.isArray(resp?.items) ? resp.items : (Array.isArray(resp) ? resp : []);
                        const thisYear = new Date().getFullYear();
                        const calcInclusiveDays = (s, e) => {
                            const sd = String(s || '').trim();
                            const ed = String(e || '').trim();
                            if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) || !/^\d{4}-\d{2}-\d{2}$/.test(ed)) return 0;
                            const st = new Date(sd + 'T00:00:00').getTime();
                            const et = new Date(ed + 'T00:00:00').getTime();
                            if (!Number.isFinite(st) || !Number.isFinite(et) || et < st) return 0;
                            return Math.floor((et - st) / 86400000) + 1;
                        };
                        items.forEach(a => {
                            const d = a?.data || a;
                            if (String(d?.username || '').toLowerCase() !== username) return;
                            if (String(a?.status || '') === 'rejected') return;
                            const sd = String(d?.startDate || '').trim();
                            if (!sd || !sd.startsWith(String(thisYear))) return;
                            const rawDays = Number(d?.days || d?.leaveDays || 0);
                            const autoDays = calcInclusiveDays(d?.startDate || d?.fromDate || d?.beginDate, d?.endDate || d?.toDate || d?.finishDate);
                            usedDays += (Number.isFinite(rawDays) && rawDays > 0) ? rawDays : autoDays;
                        });
                        const remaining = Math.round((annualDays - usedDays) * 100) / 100;
                        if (balEl) {
                            if (remaining < 0) {
                                balEl.textContent = `年假 ${remaining} 天（员工欠公司 ${Math.abs(remaining)} 天；总 ${annualDays} 天，已用 ${usedDays} 天）`;
                            } else {
                                balEl.textContent = `年假 ${remaining} 天（总 ${annualDays} 天，已用 ${usedDays} 天）`;
                            }
                        }
                    }).catch(() => {
                        if (balEl) balEl.textContent = `年假 ${annualDays} 天`;
                    });
                } catch (e) {
                    balEl.textContent = `年假 ${annualDays} 天`;
                }
            } catch (e) {}
        }
        function closeLeaveApplyModal() {
            const m = document.getElementById('leave-apply-modal');
            if (m) m.classList.remove('show');
        }
        function openChangePasswordModal() {
            const m = document.getElementById('change-password-modal');
            if (m) m.classList.add('show');
            try {
                const o = document.getElementById('cp-old-password');
                const n1 = document.getElementById('cp-new-password');
                const n2 = document.getElementById('cp-new-password2');
                if (o) o.value = '';
                if (n1) n1.value = '';
                if (n2) n2.value = '';
            } catch (e) {}
        }
        function closeChangePasswordModal() {
            const m = document.getElementById('change-password-modal');
            if (m) m.classList.remove('show');
        }
        async function submitChangePassword() {
            if (!currentUser) return;
            const oldPassword = String(document.getElementById('cp-old-password')?.value || '').trim();
            const newPassword = String(document.getElementById('cp-new-password')?.value || '').trim();
            const newPassword2 = String(document.getElementById('cp-new-password2')?.value || '').trim();
            if (!oldPassword || !newPassword || !newPassword2) {
                showNotification('请完整填写密码信息', 'warning');
                return;
            }
            if (newPassword.length < 6) {
                showNotification('新密码至少6位', 'warning');
                return;
            }
            if (newPassword !== newPassword2) {
                showNotification('两次输入的新密码不一致', 'warning');
                return;
            }
            try {
                await HRMS_API.changePassword(oldPassword, newPassword);
                try {
                    const data = HRMS_STORE.ensure();
                    ['users', 'employees'].forEach((k) => {
                        const arr = Array.isArray(data[k]) ? data[k] : [];
                        data[k] = arr.map(it => String(it?.username || '').toLowerCase() === String(currentUser?.username || '').toLowerCase() ? { ...it, password: newPassword } : it);
                    });
                    HRMS_STORE.set(data);
                } catch (e) {}
                closeChangePasswordModal();
                showNotification('密码修改成功，请牢记新密码', 'success');
            } catch (e) {
                const raw = String(e?.message || e || '');
                if (/old_password_invalid|原密码/i.test(raw)) {
                    showNotification('原密码不正确', 'error');
                    return;
                }
                showNotification('修改密码失败：' + raw, 'error');
            }
        }
        function openGmMailboxModal() {
            const m = document.getElementById('gm-mailbox-modal');
            if (m) m.classList.add('show');
        }
        function closeGmMailboxModal() {
            const m = document.getElementById('gm-mailbox-modal');
            if (m) m.classList.remove('show');
        }
        function openLeaveApplyCard() {
            try { showPage('profile'); } catch (e) {}
            try { openLeaveApplyModal(); } catch (e) {}
        }

        function submitLeaveApplication() {
            if (!currentUser) return;
            const leaveType = String(document.getElementById('leave-type')?.value || '').trim();
            const startDate = String(document.getElementById('leave-start-date')?.value || '').trim();
            const endDate = String(document.getElementById('leave-end-date')?.value || '').trim();
            const reason = String(document.getElementById('leave-reason')?.value || '').trim();
            if (!leaveType) {
                showNotification('请选择休假类型', 'warning');
                return;
            }
            if (!startDate || !endDate) {
                showNotification('请选择休假开始与结束日期', 'warning');
                return;
            }
            if (startDate > endDate) {
                showNotification('开始日期不能晚于结束日期', 'warning');
                return;
            }
            if (!reason) {
                showNotification('请填写申请理由', 'warning');
                return;
            }

            const payload = {
                leaveType,
                startDate,
                endDate,
                reason,
                username: String(currentUser.username || '').trim(),
                name: String(currentUser.name || '').trim(),
                store: String(currentUser.store || '').trim()
            };

            HRMS_API.createApproval('leave', payload)
                .then(() => {
                    showNotification('休假申请已提交审批', 'success');
                    try { closeLeaveApplyModal(); } catch (e) {}
                    try {
                        const tEl = document.getElementById('leave-type');
                        const sEl = document.getElementById('leave-start-date');
                        const eEl = document.getElementById('leave-end-date');
                        const rEl = document.getElementById('leave-reason');
                        if (tEl) tEl.value = '';
                        if (sEl) sEl.value = '';
                        if (eEl) eEl.value = '';
                        if (rEl) rEl.value = '';
                        try { document.getElementById('leave-reason-count').textContent = '0'; } catch (e) {}
                    } catch (e) {}
                    try { refreshUnreadBadges(); } catch (e) {}
                })
                .catch(e => {
                    const msg = String(e?.message || e || '');
                    if (/duplicate_pending/i.test(msg)) {
                        showNotification('您已有一条待审批的休假申请，请等待审批完成后再提交。', 'warning');
                        return;
                    }
                    showNotification('休假申请提交失败：' + msg, 'error');
                });
        }

        function submitGmMailbox() {
            if (!currentUser) return;
            const content = String(document.getElementById('gm-mailbox-content')?.value || '').trim();
            const statusEl = document.getElementById('gm-mailbox-status');
            if (!content) {
                showNotification('请输入内容', 'warning');
                return;
            }
            if (content.length < 5) {
                showNotification('内容至少 5 个字', 'warning');
                return;
            }

            if (statusEl) statusEl.textContent = '提交中...';
            HRMS_API.request('/api/gm-mailbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            })
                .then(() => {
                    showNotification('已匿名提交', 'success');
                    if (statusEl) statusEl.textContent = '';
                    try { document.getElementById('gm-mailbox-content').value = ''; } catch (e) {}
                    try { closeGmMailboxModal(); } catch (e) {}
                    try { refreshUnreadBadges(); } catch (e) {}
                })
                .catch(e => {
                    if (statusEl) statusEl.textContent = '';
                    showNotification('提交失败：' + String(e?.message || e), 'error');
                });
        }

        function clearGmMailbox() {
            try {
                const el = document.getElementById('gm-mailbox-content');
                if (el) el.value = '';
            } catch (e) {}
            try {
                const s = document.getElementById('gm-mailbox-status');
                if (s) s.textContent = '';
            } catch (e) {}
        }

        let __REWARDS_FILTER_USER = '';
        let __REWARDS_FILTER_TYPE = '';
        let __REWARDS_FILTER_LOCK = false;
        let __REWARDS_APPROVALS_CACHE = [];
        let __POINTS_EVIDENCE_URLS = [];

        let __DR_LAST_LIST = [];
        let __DR_FRONT_STAFF = [];
        let __DR_KITCHEN_STAFF = [];
        let __DR_REST_STAFF = [];
        let __DR_SCHEDULE_STAFF = [];
        let __DR_SCHEDULE_FRONT_STAFF = [];
        let __DR_SCHEDULE_KITCHEN_STAFF = [];
        let __DR_PHOTOS = [];
        let __DR_STAFF_MODAL_KIND = '';
        let __DR_STAFF_PICK_LIST = [];
        let __DR_CURRENT_REPORT = null;
        let __DR_STAFF_ANCHOR = null;

        function drRoleCanSeeStoreSelect() {
            const r = String(currentUser?.role || '').trim();
            return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER;
        }

        function drGetDefaultDate() {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        function drEnsureSelectStores() {
            const sel = document.getElementById('dr-store');
            if (!sel) return;
            const canSelect = drRoleCanSeeStoreSelect();
            let stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : (HRMS_STORE.ensure().stores || []);

            // Fallback: if stores empty but we have a token, try to re-read from server state
            if ((!stores || stores.length === 0) && HRMS_API.token()) {
                try {
                    HRMS_API.getState().then(resp => {
                        const data = resp?.data;
                        if (data && Array.isArray(data.stores) && data.stores.length > 0) {
                            HRMS_STORE.set(data);
                            drEnsureSelectStores();
                        }
                    }).catch(() => {});
                } catch (e) {}
            }

            if (canSelect) {
                const prevVal = sel.value;
                sel.innerHTML = ['<option value="">所有门店</option>'].concat(stores.map(s => {
                    const name = String(s?.name || s?.id || '').trim();
                    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
                })).join('');
                sel.disabled = false;
                if (prevVal) sel.value = prevVal;
            } else {
                let myStore = String(currentUser?.store || '').trim();
                if (!myStore && currentUser?.username) {
                    try {
                        const emps = HRMS_STORE.getEmployees ? (HRMS_STORE.getEmployees() || []) : [];
                        const users = HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : [];
                        const all = emps.concat(users);
                        const me = all.find(e => String(e?.username || '').toLowerCase() === String(currentUser.username).toLowerCase());
                        if (me) myStore = String(me.store || '').trim();
                    } catch (e) {}
                }
                if (!myStore && currentUser?.name) {
                    try {
                        const found = stores.find(s => String(s?.managerName || '').trim() === String(currentUser.name).trim());
                        if (found) myStore = String(found.name || found.id || '').trim();
                    } catch (e) {}
                }
                if (!myStore && currentUser?.username) {
                    try {
                        const found = stores.find(s => String(s?.managerUsername || '').toLowerCase() === String(currentUser.username).toLowerCase());
                        if (found) myStore = String(found.name || found.id || '').trim();
                    } catch (e) {}
                }
                if (!myStore) {
                    try {
                        if (stores.length === 1) myStore = String(stores[0]?.name || stores[0]?.id || '').trim();
                    } catch (e) {}
                }
                if (myStore && !currentUser.store) currentUser.store = myStore;
                sel.innerHTML = myStore ? `<option value="${escapeHtml(myStore)}">${escapeHtml(myStore)}</option>` : '<option value="">-</option>';
                sel.disabled = true;
            }

            if (!sel.value) {
                const v = String(currentUser?.store || '').trim();
                if (v) sel.value = v;
            }
        }


        function setDailyReportEditorTab(tab) {
            try {
                const key = String(tab || 'meta').trim();
                const ok = ['meta', 'revenue', 'channels', 'reputation', 'people'];
                const k = ok.includes(key) ? key : 'meta';
                document.querySelectorAll('#dr-edit-view .dr-report-seg__btn').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-drtab') === k);
                });
                document.querySelectorAll('#dr-edit-view .dr-report-panel').forEach(p => {
                    p.classList.toggle('is-active', p.id === 'dr-tab-' + k);
                });
            } catch (e) {}
        }

        function setPaymentBasicTab(tab) {
            try {
                const key = String(tab || 'subjects').trim();
                const ok = ['subjects', 'payees', 'urgency'];
                const k = ok.includes(key) ? key : 'subjects';
                document.querySelectorAll('#payment-basic-modal .pay-dict-seg__btn').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-pbs-tab') === k);
                });
                document.querySelectorAll('#payment-basic-modal .pay-dict-panel').forEach(p => {
                    p.classList.toggle('is-active', p.id === 'pbs-panel-' + k);
                });
            } catch (e) {}
        }

        function drIsEditing() {
            const edit = document.getElementById('dr-edit-view');
            return !!(edit && !edit.classList.contains('hidden'));
        }

        function showDailyReportEditor() {
            const list = document.getElementById('dr-list-view');
            const edit = document.getElementById('dr-edit-view');
            if (list) list.classList.add('hidden');
            if (edit) edit.classList.remove('hidden');
            try { setDailyReportEditorTab('meta'); } catch (e) {}
        }

        function showDailyReportList() {
            const list = document.getElementById('dr-list-view');
            const edit = document.getElementById('dr-edit-view');
            if (edit) edit.classList.add('hidden');
            if (list) list.classList.remove('hidden');
        }

        function openDailyReportCreate() {
            drEnsureSelectStores();
            const dateEl = document.getElementById('dr-date');
            if (dateEl) dateEl.value = drGetDefaultDate();
            const wEl = document.getElementById('dr-weather');
            if (wEl) wEl.value = '晴';
            try {
                const hEl = document.getElementById('dr-holiday-switch');
                if (hEl) hEl.checked = false;
            } catch (e) {}

            try { drResetStaffState(); } catch (e) {}
            try { __DR_PHOTOS = []; renderDailyReportPhotos(); } catch (e) {}

            try {
                drSetValue('dr-budget', '');
                drSetValue('dr-gross', '');
                drSetValue('dr-actual', '');
                drSetValue('dr-noon', '');
                drSetValue('dr-afternoon', '');
                drSetValue('dr-night', '');
                drSetValue('dr-dine-revenue', '');
                drSetValue('dr-dine-orders', '');
                drSetValue('dr-dine-traffic', '');
                drSetValue('dr-dine-avg-table', '');
                drSetValue('dr-dine-avg-person', '');
                drSetValue('dr-discount-total', '');
                drSetValue('dr-discount-dine', '');
                drSetValue('dr-discount-delivery', '');
                drSetValue('dr-cat-water-amt', '');
                drSetValue('dr-cat-water-qty', '');
                drSetValue('dr-cat-soup-amt', '');
                drSetValue('dr-cat-soup-qty', '');
                drSetValue('dr-cat-roast-amt', '');
                drSetValue('dr-cat-roast-qty', '');
                drSetValue('dr-cat-wok-amt', '');
                drSetValue('dr-cat-wok-qty', '');
                drSetValue('dr-eleme-orders', '');
                drSetValue('dr-eleme-rev', '');
                drSetValue('dr-eleme-actual', '');
                drSetValue('dr-eleme-target', '');
                drSetValue('dr-meituan-orders', '');
                drSetValue('dr-meituan-rev', '');
                drSetValue('dr-meituan-actual', '');
                drSetValue('dr-meituan-target', '');
                drSetValue('dr-operational-anomaly', '');
                drSetValue('dr-bad-dianping', '');
                drSetValue('dr-bad-meituan', '');
                drSetValue('dr-bad-eleme', '');
                drSetValue('dr-recharge-count', '');
                drSetValue('dr-recharge-amt', '');
                // 目标字段：只读显示，不需要reset（只有毛利率目标）
                drSetText('dr-target-margin', '未设置');
                drSetValue('dr-dianping-rating', '');
                drSetValue('dr-private-room-uses', '');
                const _prmEl = document.getElementById('dr-private-room-month-total'); if (_prmEl) _prmEl.textContent = '—';
                drSetValue('dr-front-support', '');
                drSetValue('dr-kitchen-support', '');
                drSetValue('dr-tomorrow-gross', '');
                drSetValue('dr-schedule-remark', '');
            } catch (e) {}

            drSetValue('dr-new-wechat-members', '');
            try { __DR_WECHAT_MONTH_BASE = 0; drUpdateWechatMonthTotal(); } catch (e) {}

            showDailyReportEditor();
            syncDailyReportComputed();
            try { __DR_CURRENT_REPORT = null; } catch (e) {}
            try { applyDailyReportEditorPermissions(); } catch (e) {}

            try {
                var _cDate = String(document.getElementById('dr-date')?.value || '').trim();
                var _cStore = String(document.getElementById('dr-store')?.value || '').trim();
                if (_cDate && _cStore) drFetchAndSetWechatMonthBase(_cDate, _cStore);
            } catch (e) {}
            try { syncDailyReportPrivateRoom(); } catch (e) {}
        }

        function closeDailyReportEditor() {
            showDailyReportList();
        }

        function drGetNum(id) {
            const v = Number(document.getElementById(id)?.value || '0');
            return Number.isFinite(v) ? v : 0;
        }

        function drSetText(id, text) {
            const el = document.getElementById(id);
            if (el) el.textContent = String(text == null ? '' : text);
        }

        function drSetValue(id, val) {
            const el = document.getElementById(id);
            if (el) el.value = (val == null ? '' : String(val));
        }

        function drFmtMoney(n) {
            const v = Number(n || 0);
            if (!Number.isFinite(v)) return '¥0.00';
            return '¥' + v.toFixed(2);
        }

        function drFmtPct(n) {
            const v = Number(n || 0);
            if (!Number.isFinite(v)) return '0.00%';
            return (v * 100).toFixed(2) + '%';
        }

        function drSumStaff(list) {
            const arr = Array.isArray(list) ? list : [];
            let sum = 0;
            arr.forEach(x => {
                const d = Number(x?.days || 0);
                if (Number.isFinite(d) && d > 0) sum += d;
                else sum += 1;
            });
            return sum;
        }

        function drRenderStaff(kind) {
            const k = String(kind || '').trim() || 'front';
            const boxId = kind === 'kitchen'
                ? 'dr-kitchen-staff'
                : (k === 'rest'
                    ? 'dr-rest-staff'
                    : (k === 'schedule_front'
                        ? 'dr-schedule-front-staff'
                        : (k === 'schedule_kitchen'
                            ? 'dr-schedule-kitchen-staff'
                        : (kind === 'schedule'
                            ? 'dr-schedule-staff'
                            : 'dr-front-staff'))));
            const box = document.getElementById(boxId);
            if (!box) return;
            const list = kind === 'kitchen'
                ? __DR_KITCHEN_STAFF
                : (k === 'rest'
                    ? __DR_REST_STAFF
                    : (k === 'schedule_front'
                        ? __DR_SCHEDULE_FRONT_STAFF
                        : (k === 'schedule_kitchen'
                            ? __DR_SCHEDULE_KITCHEN_STAFF
                        : (kind === 'schedule'
                            ? __DR_SCHEDULE_STAFF
                            : __DR_FRONT_STAFF))));
            if (!Array.isArray(list) || !list.length) {
                box.innerHTML = '暂无人员';
                return;
            }
            box.innerHTML = list.map((it, idx) => {
                const uname = String(it?.user || '').trim();
                let nm = String(it?.name || '').trim();
                let pos = '';
                try {
                    const users = HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : [];
                    const u = users.find(x => String(x?.username || '').trim() === uname) || null;
                    if (u) {
                        if (!nm) nm = String(u?.name || uname).trim();
                        pos = String(u?.position || '').trim();
                    }
                } catch (e) {}
                const name = escapeHtml(nm || uname || '-');
                const days = Number(it?.days || 1);
                const dayText = (Number.isFinite(days) && days === 0.5) ? '半天' : '全天';
                const meta = [pos ? ('岗位：' + pos) : ''].filter(Boolean).join(' ');
                return `
                    <div class="dr-staff-row">
                        <div style="min-width:0; flex:1;">
                            <div class="dr-staff-name">${name}</div>
                            <div class="dr-staff-meta">${escapeHtml(meta || '')}</div>
                        </div>
                        <div class="dr-staff-actions">
                            <button class="btn" type="button" data-click="toggleDailyReportStaffDays" data-arg="${escapeHtml(kind)}" data-arg2="${idx}" data-arg2-type="number" style="padding: 8px 12px; background: #f97316;">${escapeHtml(dayText)}</button>
                            <button class="btn" type="button" data-click="removeDailyReportStaffItem" data-arg="${escapeHtml(kind)}" data-arg2="${idx}" data-arg2-type="number" style="padding: 8px 12px; background: #ef4444;">删除</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function toggleDailyReportStaffDays(kind, idx) {
            const k = String(kind || '').trim();
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) return;
            const list = k === 'kitchen'
                ? __DR_KITCHEN_STAFF
                : (k === 'rest'
                    ? __DR_REST_STAFF
                    : (k === 'schedule_front'
                        ? __DR_SCHEDULE_FRONT_STAFF
                        : (k === 'schedule_kitchen'
                            ? __DR_SCHEDULE_KITCHEN_STAFF
                        : (k === 'schedule'
                            ? __DR_SCHEDULE_STAFF
                            : __DR_FRONT_STAFF))));
            if (!Array.isArray(list) || !list[i]) return;
            const cur = Number(list[i]?.days || 1);
            const next = (cur === 1) ? 0.5 : 1;
            list[i] = { ...(list[i] || {}), days: next };
            drRenderStaff(k);
            if (k === 'schedule_front' || k === 'schedule_kitchen') drRebuildScheduleStaff();
            syncDailyReportComputed();
        }

        function drRebuildScheduleStaff() {
            const src = []
                .concat(Array.isArray(__DR_SCHEDULE_FRONT_STAFF) ? __DR_SCHEDULE_FRONT_STAFF : [])
                .concat(Array.isArray(__DR_SCHEDULE_KITCHEN_STAFF) ? __DR_SCHEDULE_KITCHEN_STAFF : []);
            const seen = new Set();
            const merged = [];
            src.forEach((x) => {
                const u = String(x?.user || '').trim();
                const n = String(x?.name || '').trim();
                const key = (u || n).toLowerCase();
                if (!key || seen.has(key)) return;
                seen.add(key);
                merged.push({ user: u, name: n, days: Number(x?.days || 1) === 0.5 ? 0.5 : 1 });
            });
            __DR_SCHEDULE_STAFF = merged;
        }

        function drMergeUniqueStaffLists() {
            const lists = Array.from(arguments);
            const seen = new Set();
            const out = [];
            lists.forEach((arr) => {
                (Array.isArray(arr) ? arr : []).forEach((x) => {
                    const u = String(x?.user || '').trim();
                    const n = String(x?.name || '').trim();
                    const key = (u || n).toLowerCase();
                    if (!key || seen.has(key)) return;
                    seen.add(key);
                    out.push({ user: u, name: n, days: Number(x?.days || 1) === 0.5 ? 0.5 : 1 });
                });
            });
            return out;
        }

        function drResetStaffState() {
            __DR_FRONT_STAFF = [];
            __DR_KITCHEN_STAFF = [];
            __DR_REST_STAFF = [];
            __DR_SCHEDULE_STAFF = [];
            __DR_SCHEDULE_FRONT_STAFF = [];
            __DR_SCHEDULE_KITCHEN_STAFF = [];
            drRenderStaff('front');
            drRenderStaff('kitchen');
            drRenderStaff('rest');
            drRenderStaff('schedule');
            drRenderStaff('schedule_front');
            drRenderStaff('schedule_kitchen');
        }

        function drGetPickableUsers() {
            const store = String(document.getElementById('dr-store')?.value || currentUser?.store || '').trim().toLowerCase();
            const employees = HRMS_STORE.getEmployees ? (HRMS_STORE.getEmployees() || []) : [];
            const users = HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : [];
            const seen = new Set();
            const merged = [];
            employees.concat(users).forEach(u => {
                const uname = String(u?.username || '').trim().toLowerCase();
                if (!uname || seen.has(uname)) return;
                seen.add(uname);
                merged.push(u);
            });
            const list = merged.filter(u => {
                const r = String(u?.role || '').trim();
                if (r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.HR_MANAGER) return false;
                const st = String(u?.store || '').trim().toLowerCase();
                if (store && st && st !== store) return false;
                if (store && !st) return false;
                const status = String(u?.status || '').trim();
                if (status === '离职' || status === 'inactive') return false;
                return true;
            });
            list.sort((a, b) => String(a?.name || a?.username || '').localeCompare(String(b?.name || b?.username || ''), 'zh-Hans-CN'));
            return list;
        }

        function drRenderStaffPickList() {
            const box = document.getElementById('dr-staff-pick-list');
            if (!box) return;
            const list = Array.isArray(__DR_STAFF_PICK_LIST) ? __DR_STAFF_PICK_LIST : [];
            box.innerHTML = list.map((u, idx) => {
                const checked = !!u.checked;
                const nm = escapeHtml(String(u?.name || u?.username || '').trim() || '-');
                const pos = escapeHtml(String(u?.position || '').trim());
                const day = Number(u?.days || 1);
                const dayText = day === 0.5 ? '半天' : '全天';
                const chkCls = checked ? 'dr-staff-pick-row__chk is-on' : 'dr-staff-pick-row__chk';
                const chkInner = checked ? '✓' : '';
                return `
                    <div class="dr-staff-pick-row dr-staff-row" data-click="toggleDailyReportStaffPick" data-arg="${idx}" data-arg-type="number">
                        <div class="dr-staff-pick-row__main">
                            <div class="${chkCls}">${chkInner}</div>
                            <div style="min-width:0; flex:1;">
                                <div class="dr-staff-name" style="font-size:15px;">${nm}</div>
                                <div class="dr-staff-meta">${pos ? ('岗位：' + pos) : ''}</div>
                            </div>
                        </div>
                        <div class="dr-staff-actions" data-click="hrmsNoop" data-stop>
                            <button type="button" class="dr-staff-pick-row__day" data-click="toggleDailyReportStaffPickDays" data-arg="${idx}" data-arg-type="number">${escapeHtml(dayText)}</button>
                        </div>
                    </div>
                `;
            }).join('');

            try {
                const btn = document.getElementById('dr-staff-select-all');
                if (btn) {
                    const total = list.length;
                    const sel = list.filter(x => x && x.checked).length;
                    btn.textContent = sel === total && total > 0 ? `取消全选（共 ${total} 人）` : `全选（共 ${total} 人）`;
                }
            } catch (e) {}
        }

        function openDailyReportStaffModal(kind, ev) {
            const modal = document.getElementById('dr-staff-modal');
            if (!modal) return;
            __DR_STAFF_MODAL_KIND = String(kind || '').trim() || 'front';
            const k = __DR_STAFF_MODAL_KIND;
            const cap = {
                front: { title: '选择员工 · 前厅上班', desc: '今日实际出勤：勾选后加入前厅上班名单，可切换半天/全天。', hint: '与前厅「添加」联动 · 可批量勾选' },
                kitchen: { title: '选择员工 · 厨房上班', desc: '今日实际出勤：勾选后加入厨房上班名单。', hint: '与厨房「添加」联动 · 可批量勾选' },
                rest: { title: '选择员工 · 当日休息', desc: '将人员记入当日休息名单（半天/全天在确认后生效）。', hint: '与休息「添加」联动' },
                schedule_front: { title: '选择员工 · 前厅排班', desc: '第二天排班：加入明日前厅排班名单。', hint: '与排班前厅「添加」联动' },
                schedule_kitchen: { title: '选择员工 · 厨房排班', desc: '第二天排班：加入明日厨房排班名单。', hint: '与排班厨房「添加」联动' },
                schedule_morning: { title: '选择员工 · 早班排班', desc: '第二天排班：加入明日早班排班名单。', hint: '与早班排班「添加」联动' },
                schedule_afternoon: { title: '选择员工 · 午班排班', desc: '第二天排班：加入明日午班排班名单。', hint: '与午班排班「添加」联动' },
                schedule: { title: '选择员工 · 排班', desc: '批量勾选加入排班名单。', hint: '排班人员选择' }
            };
            const meta = cap[k] || cap.front;
            try {
                const t = document.getElementById('dr-staff-modal-title');
                const d = document.getElementById('dr-staff-modal-desc');
                const h = document.getElementById('dr-staff-modal-hint');
                if (t) t.textContent = meta.title;
                if (d) d.textContent = meta.desc;
                if (h) h.textContent = meta.hint;
            } catch (e) {}
            __DR_STAFF_ANCHOR = ev?.currentTarget || ev?.target || null;
            const users = drGetPickableUsers();
            __DR_STAFF_PICK_LIST = users.map(u => ({
                username: String(u?.username || '').trim(),
                name: String(u?.name || '').trim(),
                position: String(u?.position || '').trim(),
                store: String(u?.store || '').trim(),
                checked: false,
                days: 1
            })).filter(x => x.username);
            drRenderStaffPickList();
            // Prevent page scroll-to-top when modal opens
            const scrollY = window.scrollY;
            modal.classList.add('show');
            setTimeout(() => { positionDailyReportStaffModal(); window.scrollTo(0, scrollY); }, 0);
        }

        function positionDailyReportStaffModal() {
            const modal = document.getElementById('dr-staff-modal');
            const card = modal?.querySelector('.modal-content');
            if (!modal || !card) return;
            const trigger = (__DR_STAFF_ANCHOR && __DR_STAFF_ANCHOR.getBoundingClientRect)
                ? __DR_STAFF_ANCHOR
                : null;
            const vw = window.innerWidth || document.documentElement.clientWidth || 375;
            const vh = window.innerHeight || document.documentElement.clientHeight || 700;
            const cardW = Math.min(560, Math.max(280, vw - 16));
            const preferredH = Math.min(620, Math.floor(vh * 0.86));
            const minH = 220;
            const edge = 8;
            const gap = 8;

            if (vw <= 768) {
                card.style.position = '';
                card.style.width = '';
                card.style.maxWidth = '';
                card.style.margin = '';
                card.style.left = '';
                card.style.top = '';
                card.style.maxHeight = '';
                return;
            }

            card.style.position = 'fixed';
            card.style.width = cardW + 'px';
            card.style.maxWidth = cardW + 'px';
            card.style.margin = '0';
            card.style.left = Math.max(edge, Math.floor((vw - cardW) / 2)) + 'px';
            card.style.top = Math.max(12, vh - preferredH - 12) + 'px';
            card.style.maxHeight = preferredH + 'px';

            if (!trigger) return;
            const rect = trigger.getBoundingClientRect();

            const spaceBelow = vh - rect.bottom - gap - edge;
            const spaceAbove = rect.top - gap - edge;
            const openAbove = (spaceBelow < 280 && spaceAbove > spaceBelow);
            const available = openAbove ? spaceAbove : spaceBelow;
            const modalH = Math.max(minH, Math.min(preferredH, available));

            const left = Math.max(edge, Math.min(rect.left, vw - cardW - edge));
            let top = openAbove
                ? (rect.top - gap - modalH)
                : (rect.bottom + gap);

            top = Math.max(edge, Math.min(top, vh - modalH - edge));

            card.style.left = Math.round(left) + 'px';
            card.style.top = Math.round(top) + 'px';
            card.style.maxHeight = Math.round(modalH) + 'px';
        }

        function resetDailyReportStaffModalPosition() {
            const modal = document.getElementById('dr-staff-modal');
            const card = modal?.querySelector('.modal-content');
            if (!card) return;
            card.style.position = '';
            card.style.width = '';
            card.style.maxWidth = '';
            card.style.margin = '';
            card.style.left = '';
            card.style.top = '';
            card.style.maxHeight = '';
        }

        function closeDailyReportStaffModal() {
            const modal = document.getElementById('dr-staff-modal');
            if (modal) modal.classList.remove('show');
            resetDailyReportStaffModalPosition();
            __DR_STAFF_ANCHOR = null;
        }

        function confirmDailyReportStaffModal() {
            const picked = (Array.isArray(__DR_STAFF_PICK_LIST) ? __DR_STAFF_PICK_LIST : []).filter(x => x && x.checked);
            if (!picked.length) {
                showNotification('请选择员工', 'warning');
                return;
            }
            const k = String(__DR_STAFF_MODAL_KIND || 'front').trim();

            const pushUnique = (arr, item) => {
                const list = Array.isArray(arr) ? arr : [];
                const key = String(item?.user || '').trim();
                if (!key) return;
                if (list.some(x => String(x?.user || '').trim() === key)) return;
                list.push(item);
            };

            picked.forEach(p => {
                const item = { user: p.username, name: p.name, days: (p.days === 0.5 ? 0.5 : 1) };
                if (k === 'kitchen') pushUnique(__DR_KITCHEN_STAFF, item);
                else if (k === 'rest') pushUnique(__DR_REST_STAFF, item);
                else if (k === 'schedule') pushUnique(__DR_SCHEDULE_STAFF, item);
                else if (k === 'schedule_front') pushUnique(__DR_SCHEDULE_FRONT_STAFF, item);
                else if (k === 'schedule_kitchen') pushUnique(__DR_SCHEDULE_KITCHEN_STAFF, item);
                else pushUnique(__DR_FRONT_STAFF, item);
            });
            if (k === 'schedule_front' || k === 'schedule_kitchen') drRebuildScheduleStaff();
            drRenderStaff(k);
            if (k === 'schedule_front' || k === 'schedule_kitchen') drRenderStaff('schedule');
            closeDailyReportStaffModal();
            syncDailyReportComputed();
        }

        function toggleDailyReportStaffPick(idx) {
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) return;
            if (!Array.isArray(__DR_STAFF_PICK_LIST) || !__DR_STAFF_PICK_LIST[i]) return;
            __DR_STAFF_PICK_LIST[i].checked = !__DR_STAFF_PICK_LIST[i].checked;
            drRenderStaffPickList();
        }

        function toggleDailyReportStaffPickDays(idx) {
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) return;
            if (!Array.isArray(__DR_STAFF_PICK_LIST) || !__DR_STAFF_PICK_LIST[i]) return;
            const cur = Number(__DR_STAFF_PICK_LIST[i].days || 1);
            __DR_STAFF_PICK_LIST[i].days = (cur === 1) ? 0.5 : 1;
            drRenderStaffPickList();
        }

        function toggleDailyReportStaffSelectAll() {
            const list = Array.isArray(__DR_STAFF_PICK_LIST) ? __DR_STAFF_PICK_LIST : [];
            if (!list.length) return;
            const all = list.every(x => x && x.checked);
            list.forEach(x => { if (x) x.checked = !all; });
            __DR_STAFF_PICK_LIST = list;
            drRenderStaffPickList();
        }

        function drCoalescePointerEvent(ev) {
            if (ev && (ev.currentTarget || ev.target)) return ev;
            try { return (typeof window !== 'undefined' && window.event) ? window.event : null; } catch (e) { return null; }
        }

        /** 日结单预览/打印用：根相对路径拼 API 基址（与 fetch 同源逻辑一致），避免历史数据只有 /uploads/... 时 img 指向错误源 */
        function drResolveDailyReportPhotoSrc(pathStr) {
            const raw = String(pathStr || '').trim();
            if (!raw) return '';
            if (/^(?:https?:)?\/\//i.test(raw) || /^data:/i.test(raw) || /^blob:/i.test(raw)) return raw;
            const base = (typeof HRMS_API !== 'undefined' && HRMS_API.baseUrl)
                ? String(HRMS_API.baseUrl() || '').replace(/\/$/, '')
                : '';
            let p = raw.replace(/\\/g, '/');
            if (!p.startsWith('/')) p = '/' + p.replace(/^\.+\//, '');
            return (base || '') + p;
        }

        function drNormalizeDailyReportPhotoUrl(item) {
            if (item == null) return '';
            if (typeof item === 'string') {
                const s = String(item).trim();
                if (!s) return '';
                if (/^(?:https?:)?\/\//i.test(s) || /^data:/i.test(s) || /^blob:/i.test(s)) return s;
                if (s.startsWith('/uploads/') || s.startsWith('uploads/')) return s.startsWith('/') ? s : '/' + s;
                if (!s.includes('/') && /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(s)) return '/uploads/' + s;
                return s;
            }
            if (typeof item === 'object') {
                const o = item;
                const u = o.url || o.href || o.src || o.path || o.photoUrl || o.fileUrl
                    || o.photo || o.image || o.imageUrl || o.file || o.filepath || o.file_path;
                if (u) return String(u).trim();
                const fn = o.filename || o.fileName || o.name;
                if (fn) {
                    const f = String(fn).trim().replace(/^\/+/, '');
                    if (!f) return '';
                    if (/^(?:https?:)?\/\//i.test(f) || /^data:/i.test(f) || /^blob:/i.test(f)) return f;
                    if (f.startsWith('uploads/')) return '/' + f;
                    if (f.startsWith('/uploads/')) return f;
                    return '/uploads/' + f;
                }
            }
            return '';
        }

        function drNormalizeDailyReportPhotosArr(raw) {
            const arr = Array.isArray(raw) ? raw : [];
            const out = [];
            arr.forEach((x) => {
                const s = drNormalizeDailyReportPhotoUrl(x);
                if (s) out.push(s);
            });
            return out.slice(0, 9);
        }

        /** 从日报条目各字段收集日结单 URL（兼容 PG/state 不同嵌套、{urls:[]} 等） */
        function drCollectPhotosFromReport(raw, r) {
            const acc = [];
            function walk(v) {
                if (v == null) return;
                if (Array.isArray(v)) {
                    v.forEach(walk);
                    return;
                }
                if (typeof v === 'object') {
                    if (Array.isArray(v.urls)) walk(v.urls);
                    if (Array.isArray(v.items)) walk(v.items);
                    if (Array.isArray(v.paths)) walk(v.paths);
                    if (Array.isArray(v.photos)) walk(v.photos);
                }
                const one = drNormalizeDailyReportPhotoUrl(v);
                if (one) acc.push(one);
            }
            const rawObj = raw && typeof raw === 'object' ? raw : {};
            const rObj = r && typeof r === 'object' ? r : {};
            walk(rawObj.photos);
            walk(rObj.photos);
            walk(rawObj.dailyReportPhotos);
            walk(rawObj.statementPhotos);
            walk(rawObj.dayEndPhotos);
            walk(rawObj.attachments);
            const seen = new Set();
            const out = [];
            acc.forEach((u) => {
                const n = drNormalizeDailyReportPhotoUrl(u);
                if (!n || seen.has(n)) return;
                seen.add(n);
                out.push(n);
            });
            return out.slice(0, 9);
        }

        function addDailyReportStaffRow(kind, ev) {
            const k = String(kind || '').trim();
            const pev = drCoalescePointerEvent(ev);
            if (k === 'kitchen' || k === 'rest') {
                openDailyReportStaffModal(k, pev);
                return;
            }
            openDailyReportStaffModal('front', pev);
        }

        function addDailyReportScheduleDeptRow(dept, ev) {
            const kind = String(dept || '').trim() === 'kitchen' ? 'schedule_kitchen' : 'schedule_front';
            openDailyReportStaffModal(kind, drCoalescePointerEvent(ev));
        }

        function addDailyReportSchedulePlanRow(ev) {
            openDailyReportStaffModal('schedule_front', drCoalescePointerEvent(ev));
        }

        function removeDailyReportStaffItem(kind, idx) {
            const k = String(kind || '').trim();
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) return;
            if (k === 'kitchen') __DR_KITCHEN_STAFF.splice(i, 1);
            else if (k === 'rest') __DR_REST_STAFF.splice(i, 1);
            else if (k === 'schedule') __DR_SCHEDULE_STAFF.splice(i, 1);
            else if (k === 'schedule_front') __DR_SCHEDULE_FRONT_STAFF.splice(i, 1);
            else if (k === 'schedule_kitchen') __DR_SCHEDULE_KITCHEN_STAFF.splice(i, 1);
            else __DR_FRONT_STAFF.splice(i, 1);
            if (k === 'schedule_front' || k === 'schedule_kitchen') drRebuildScheduleStaff();
            drRenderStaff(k || 'front');
            if (k === 'schedule_front' || k === 'schedule_kitchen') drRenderStaff('schedule');
            syncDailyReportComputed();
        }

        function triggerDailyReportPhotoSelect() {
            const el = document.getElementById('dr-photo-input');
            if (el) el.click();
        }

        function renderDailyReportPhotos() {
            const box = document.getElementById('dr-photos-preview');
            if (!box) return;
            __DR_PHOTOS = drNormalizeDailyReportPhotosArr(__DR_PHOTOS);
            const list = Array.isArray(__DR_PHOTOS) ? __DR_PHOTOS : [];
            if (!list.length) {
                box.innerHTML = '';
                return;
            }
            box.innerHTML = list.map((u, idx) => {
                const srcRaw = drNormalizeDailyReportPhotoUrl(u);
                const srcDisp = drResolveDailyReportPhotoSrc(srcRaw);
                const src = escapeHtml(srcDisp);
                return `
                    <div style="position: relative; width: 96px; height: 96px; border-radius: 12px; overflow:hidden; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.03);">
                        <img alt="日结单" src="${src}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="width: 100%; height: 100%; object-fit: cover;" />
                        <button class="btn btn-secondary" type="button" data-click="removeDailyReportPhoto" data-arg="${idx}" data-arg-type="number" style="position:absolute; top: 6px; right: 6px; padding: 4px 8px; font-size: 12px; border-radius: 999px;">×</button>
                    </div>
                `;
            }).join('');
        }

        function removeDailyReportPhoto(idx) {
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) return;
            __DR_PHOTOS.splice(i, 1);
            renderDailyReportPhotos();
        }

        async function handleDailyReportPhotoSelect(event) {
            const input = event?.target;
            const files = Array.from(input?.files || []);
            if (!files.length) return;
            const remain = 9 - (__DR_PHOTOS?.length || 0);
            const use = files.slice(0, Math.max(0, remain));
            if (!use.length) {
                showNotification('最多上传 9 张', 'warning');
                try { input.value = ''; } catch (e) {}
                return;
            }
            try {
                showNotification('上传中...', 'info');
                const fd = new FormData();
                use.forEach(f => fd.append('files', f, f.name));
                const resp = await HRMS_API.uploadDailyReportPhotos(fd);
                const urls = Array.isArray(resp?.urls) ? resp.urls : [];
                urls.forEach(u => {
                    const s = drNormalizeDailyReportPhotoUrl(u);
                    if (s) __DR_PHOTOS.push(s);
                });
                __DR_PHOTOS = drNormalizeDailyReportPhotosArr(__DR_PHOTOS);
                renderDailyReportPhotos();
                showNotification('上传成功', 'success');
            } catch (e) {
                showNotification('上传失败：' + String(e?.message || e), 'error');
            }
            try { input.value = ''; } catch (e) {}
        }

        var __DR_WECHAT_MONTH_BASE = 0;
        function drFetchAndSetWechatMonthBase(date, store) {
            if (!date || !store) { __DR_WECHAT_MONTH_BASE = 0; drUpdateWechatMonthTotal(); return; }
            console.log('[wechat-base] fetching for', date, store);
            HRMS_API.getDailyReports({ store: store, date: date, limit: 1 })
                .then(function(resp) {
                    var serverBase = Number(resp?.wechat_month_base || 0);
                    console.log('[wechat-base] server returned base=' + serverBase + ', current=' + __DR_WECHAT_MONTH_BASE);
                    __DR_WECHAT_MONTH_BASE = serverBase;
                    drUpdateWechatMonthTotal();
                })
                .catch(function(err) {
                    console.warn('[wechat-base] fetch failed, using local calc', err);
                    __DR_WECHAT_MONTH_BASE = drCalcWechatMonthBase(date, store);
                    drUpdateWechatMonthTotal();
                });
        }
        function drCalcWechatMonthBase(date, store) {
            var base = 0;
            if (!date || !store) return base;
            var ym = String(date).slice(0, 7);
            var list = Array.isArray(window.__DR_LAST_LIST) ? window.__DR_LAST_LIST : [];
            list.forEach(function(r) {
                if (String(r?.store || '').trim() !== String(store).trim()) return;
                if (String(r?.date || '').trim() === String(date).trim()) return;
                if (String(r?.date || '').slice(0, 7) !== ym) return;
                base += Math.max(0, Math.floor(Number(r?.data?.new_wechat_members) || 0));
            });
            return base;
        }
        function drUpdateWechatMonthTotal() {
            var today = Math.max(0, Math.floor(Number(document.getElementById('dr-new-wechat-members')?.value) || 0));
            var total = __DR_WECHAT_MONTH_BASE + today;
            var el = document.getElementById('dr-wechat-month-total');
            if (el) el.textContent = total;
        }
        (function() {
            var _bound = false;
            var _tryBind = function() {
                var inp = document.getElementById('dr-new-wechat-members');
                if (inp && !_bound) { _bound = true; inp.addEventListener('input', drUpdateWechatMonthTotal); }
                else if (!_bound) setTimeout(_tryBind, 500);
            };
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _tryBind);
            else _tryBind();
        })();

        function onDailyReportStoreChange() {
            try { loadDailyReportData(); } catch (e) {}
        }

        function onDailyReportDateChange() {
            try { loadDailyReportData(); } catch (e) {}
        }

        function loadDailyReportData() {
            if (!currentUser) return;

            drEnsureSelectStores();
            const dateEl = document.getElementById('dr-date');
            if (dateEl && !dateEl.value) dateEl.value = drGetDefaultDate();

            try {
                const wEl = document.getElementById('dr-weather');
                if (wEl && !String(wEl.value || '').trim()) wEl.value = '晴';
            } catch (e) {}

            const date = String(document.getElementById('dr-date')?.value || '').trim();
            const store = String(document.getElementById('dr-store')?.value || '').trim();
            const listStart = String(document.getElementById('dr-list-start')?.value || '').trim();
            const listEnd = String(document.getElementById('dr-list-end')?.value || '').trim();
            const listDate = String(listStart || listEnd || '').trim();
            const listEl = document.getElementById('dr-list');
            const emptyEl = document.getElementById('dr-empty');
            const banner = document.getElementById('dr-missing-banner');
            if (listEl) listEl.innerHTML = '<div style="color:#777; font-size: 12px; padding: 10px 2px;">加载中...</div>';
            if (emptyEl) emptyEl.style.display = 'none';
            if (banner) banner.style.display = 'none';

            HRMS_API.getDailyReports({ store: store, start: listStart, end: listEnd, date: '', limit: 2000 })
                .then(resp => {
                    const allItems = Array.isArray(resp?.items) ? resp.items : [];
                    __DR_LAST_LIST = allItems;
                    renderDailyReportList(allItems);

                    try {
                        // Missing report banner: show stores that did not submit yesterday's report.
                        const now = new Date();
                        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                        const pad = (n) => String(n).padStart(2, '0');
                        const yKey = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
                        const h = now.getHours();
                        if (!listDate && h >= 0 && h < 6) {
                            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : (HRMS_STORE.ensure().stores || []);
                            const storeNames = Array.from(new Set((stores || []).map(s => String(s?.name || s?.id || '').trim()).filter(Boolean)));
                            const scopeStores = store ? [store] : storeNames;
                            const miss = scopeStores.filter(st => {
                                if (!st) return false;
                                return !allItems.some(r => String(r?.store || '').trim() === st && String(r?.date || '').trim() === yKey);
                            });
                            if (banner && miss.length) {
                                banner.textContent = `${miss.join('、')} 门店 ${yKey} 没有提交日报`;
                                banner.style.display = '';
                            }
                        }
                    } catch (e) {}
                    if (!drIsEditing()) {
                        return;
                    }
                    if (date && store) {
                        const one = allItems.find(x =>
                            String(x?.date || '').trim() === date && String(x?.store || '').trim() === store
                        ) || null;
                        if (one) fillDailyReportForm(one);
                        else {
                            try {
                                drResetStaffState();
                                __DR_PHOTOS = [];
                                renderDailyReportPhotos();
                                drSetValue('dr-budget', '');
                                drSetValue('dr-gross', '');
                                drSetValue('dr-actual', '');
                                drSetValue('dr-noon', '');
                                drSetValue('dr-afternoon', '');
                                drSetValue('dr-night', '');
                                drSetValue('dr-dine-revenue', '');
                                drSetValue('dr-dine-orders', '');
                                drSetValue('dr-dine-traffic', '');
                                drSetValue('dr-dine-avg-table', '');
                                drSetValue('dr-dine-avg-person', '');
                                drSetValue('dr-discount-total', '');
                                drSetValue('dr-discount-dine', '');
                                drSetValue('dr-discount-delivery', '');
                                drSetValue('dr-cat-water-amt', '');
                                drSetValue('dr-cat-water-qty', '');
                                drSetValue('dr-cat-soup-amt', '');
                                drSetValue('dr-cat-soup-qty', '');
                                drSetValue('dr-cat-roast-amt', '');
                                drSetValue('dr-cat-roast-qty', '');
                                drSetValue('dr-cat-wok-amt', '');
                                drSetValue('dr-cat-wok-qty', '');
                                drSetValue('dr-eleme-orders', '');
                                drSetValue('dr-eleme-rev', '');
                                drSetValue('dr-eleme-actual', '');
                                drSetValue('dr-eleme-target', '');
                                drSetValue('dr-meituan-orders', '');
                                drSetValue('dr-meituan-rev', '');
                                drSetValue('dr-meituan-actual', '');
                                drSetValue('dr-meituan-target', '');
                                drSetValue('dr-bad-dianping', '');
                                drSetValue('dr-bad-meituan', '');
                                drSetValue('dr-bad-eleme', '');
                                drSetValue('dr-new-wechat-members', '');
                                drSetValue('dr-recharge-count', '');
                                drSetValue('dr-recharge-amt', '');
                                // 目标字段：只读显示，不需要reset
                                drSetText('dr-target-revenue', '未设置');
                                drSetText('dr-target-margin', '未设置');
                                drSetValue('dr-dianping-rating', '');
                                drSetValue('dr-private-room-uses', '');
                                const _prmEl2 = document.getElementById('dr-private-room-month-total'); if (_prmEl2) _prmEl2.textContent = '—';
                                drSetValue('dr-front-support', '');
                                drSetValue('dr-kitchen-support', '');
                                drSetValue('dr-tomorrow-gross', '');
                                drSetValue('dr-schedule-remark', '');
                                try { __DR_WECHAT_MONTH_BASE = drCalcWechatMonthBase(date, store); drUpdateWechatMonthTotal(); drFetchAndSetWechatMonthBase(date, store); } catch(_e3) {}
                            } catch (e2) {}
                            try { syncDailyReportPrivateRoom(); } catch (e3) {}
                            syncDailyReportComputed();
                        }
                    } else {
                        syncDailyReportComputed();
                    }

                    try { applyDailyReportEditorPermissions(); } catch (e) {}
                })
                .catch(e => {
                    if (listEl) listEl.innerHTML = '';
                    if (emptyEl) emptyEl.style.display = '';
                    showNotification('加载日报失败：' + String(e?.message || e), 'error');
                });
        }

