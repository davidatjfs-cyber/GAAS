/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 02-confirm-role-modules.js
 * lines: 4960-7682 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ---- 二次确认对话框 (替代原生 confirm，提供美化弹窗) ----
        function hrmsConfirm({ title = '确认操作', message = '', okText = '确认删除', okStyle = '', icon = '⚠️' } = {}) {
            return new Promise((resolve) => {
                const modal = document.getElementById('hrms-confirm-modal');
                if (!modal) { resolve(window.confirm(message || title)); return; }
                document.getElementById('hrms-confirm-icon').textContent = icon;
                document.getElementById('hrms-confirm-title').textContent = title;
                document.getElementById('hrms-confirm-msg').textContent = message;
                const okBtn = document.getElementById('hrms-confirm-ok');
                okBtn.textContent = okText;
                if (okStyle) okBtn.style.cssText += ';' + okStyle;
                modal.style.display = 'flex';
                const cleanup = (result) => {
                    modal.style.display = 'none';
                    okBtn.onclick = null;
                    document.getElementById('hrms-confirm-cancel').onclick = null;
                    modal.onclick = null;
                    resolve(result);
                };
                okBtn.onclick = () => cleanup(true);
                document.getElementById('hrms-confirm-cancel').onclick = () => cleanup(false);
                modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
            });
        }

        // ---- role-modules UI（8个核心模块，6个角色）----
        var _allMods=[
          {p:'employees',l:'员工管理'},
          {p:'attendance',l:'考勤打卡'},
          {p:'exam',l:'考试测评'},
          {p:'points',l:'员工积分'},
          {p:'daily-report',l:'营业日报'},
          {p:'approvals',l:'待审批'},
          {p:'payment',l:'请款'},
          {p:'knowledge',l:'知识库'},
          {p:'rewards',l:'奖惩管理'},
          {p:'reports',l:'分析报表'},
          {p:'training',l:'培训认证'},
          {p:'kitchen',l:'厨房执行'},
          {p:'agents',l:'数据中心/智能助手'},
          {p:'forecast',l:'智能助手(预测)'},
          {p:'growth',l:'增长看板'},
          {p:'diagnosis',l:'经营诊断'},
          {p:'strategy',l:'门店营销策略'},
          {p:'agent-tasks',l:'Agent任务'}
        ];
        var _edRoles=[
          {c:ROLES.STORE_MANAGER,l:'店长'},
          {c:ROLES.PRODUCTION_MANAGER,l:'出品经理'},
          {c:ROLES.FRONT_MANAGER,l:'前厅经理'},
          {c:ROLES.FRONT_SUPERVISOR,l:'前厅主管'},
          {c:ROLES.HQ_MANAGER,l:'总部营运'},
          {c:ROLES.HR_MANAGER,l:'总部HR'},
          {c:ROLES.CASHIER,l:'出纳'},
          {c:ROLES.EMPLOYEE,l:'普通员工'}
        ];
        function renderRoleModulesGrid(){var c=document.getElementById('role-modules-grid');if(!c)return;var s=_serverRoleModules||_defaultRoleModules;var h='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6)">模块</th>';for(var i=0;i<_edRoles.length;i++)h+='<th style="text-align:center;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.6);font-size:11px">'+_edRoles[i].l+'</th>';h+='</tr></thead><tbody>';for(var j=0;j<_allMods.length;j++){var m=_allMods[j];h+='<tr><td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.06);color:#e0e8f0">'+m.l+'</td>';for(var k=0;k<_edRoles.length;k++){var r=_edRoles[k],ck=(s[r.c]||[]).includes(m.p)?'checked':'';h+='<td style="text-align:center;padding:5px 4px;border-bottom:1px solid rgba(255,255,255,.06)"><input type=checkbox data-role="'+r.c+'" data-page="'+m.p+'" '+ck+' style="accent-color:#4f8cff"></td>';}h+='</tr>';}h+='</tbody></table>';c.innerHTML=h;}
function collectRoleModulesFromUI(){var base=(_serverRoleModules&&typeof _serverRoleModules==='object')?JSON.parse(JSON.stringify(_serverRoleModules)):{};_edRoles.forEach(function(r){base[r.c]=[];});var boxes=document.querySelectorAll('#role-modules-grid input[type=checkbox]');boxes.forEach(function(b){if(b.checked){if(!Array.isArray(base[b.dataset.role]))base[b.dataset.role]=[];base[b.dataset.role].push(b.dataset.page);}});return base;}
async function saveRoleModulesConfig(){try{var cfg=collectRoleModulesFromUI();var tok=localStorage.getItem('hrms_token')||'';var r=await fetch('/api/role-modules',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({config:cfg})});if(!r.ok)throw new Error('HTTP '+r.status);_serverRoleModules=cfg;updateUserInfo();showNotification('角色模块权限已保存','success');}catch(e){showNotification('保存失败: '+e.message,'error');}}
async function resetRoleModulesConfig(){const _okRC=await hrmsConfirm({title:'重置权限配置',message:'确定恢复为默认权限配置？此操作将覆盖当前配置。',okText:'确认重置',icon:'🔄'});if(!_okRC)return;_serverRoleModules=null;renderRoleModulesGrid();showNotification('已恢复默认配置，请点击保存生效','info');}
async function loadDedupStats(){var el=document.getElementById('dedup-stats-content');if(!el)return;el.textContent='加载中...';try{var r=await fetch('/api/dedup/stats',{credentials:'include'});if(!r.ok)throw new Error('HTTP '+r.status);var d=await r.json();var t=d.tables||{};el.innerHTML='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:13px;"><span>消息记录重复组:</span><span style="font-weight:600;color:'+(t.agent_messages_dup_groups>0?'#ef5350':'#66bb6a')+'">'+t.agent_messages_dup_groups+'</span><span>飞书通用记录:</span><span>'+t.feishu_generic_records+'</span><span>销售明细:</span><span>'+(t.pos_sales_detail!=null?t.pos_sales_detail:t.sales_raw)+'</span><span>桌访记录:</span><span>'+t.table_visit_records+'</span></div>';}catch(e){el.textContent='加载失败: '+e.message;}}
async function runDedupCleanup(){const _okDD=await hrmsConfirm({title:'清理重复数据',message:'确定清理重复数据？此操作将永久删除重复记录。',okText:'确认清理',icon:'🧹'});if(!_okDD)return;try{var r=await fetch('/api/dedup/cleanup',{method:'POST',credentials:'include'});if(!r.ok)throw new Error('HTTP '+r.status);var d=await r.json();showNotification('清理完成，删除 '+d.deleted+' 条重复记录','success');loadDedupStats();}catch(e){showNotification('清理失败: '+e.message,'error');}}
var __storeDutyBindingsCache = [];
function renderDutyBindingStoreOptions(){var sel=document.getElementById('duty-binding-store');if(!sel)return;var stores=(HRMS_STORE.getStores&&HRMS_STORE.getStores())||[];sel.innerHTML=(stores||[]).map(function(s){var name=String(s?.name||s?.id||'').trim();return name?'<option value=\"'+escapeHtml(name)+'\">'+escapeHtml(name)+'</option>':'';}).join('')||'<option value=\"\">暂无门店</option>';}
function resetStoreDutyBindingForm(){var ids=['duty-binding-username','duty-binding-effective-from','duty-binding-effective-to'];ids.forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});var level=document.getElementById('duty-binding-access-level');if(level)level.value='support';var primary=document.getElementById('db-is-primary-store');if(primary)primary.checked=false;var enabled=document.getElementById('db-enabled');if(enabled)enabled.checked=true;['db-can-receive-ops','db-can-receive-performance','db-can-receive-food-safety','db-can-handle-ops','db-can-handle-food-safety'].forEach(function(id){var el=document.getElementById(id);if(el)el.checked=true;});['db-can-receive-approval','db-can-approve-hrms','db-can-view-employees'].forEach(function(id){var el=document.getElementById(id);if(el)el.checked=false;});var status=document.getElementById('store-duty-bindings-status');if(status)status.textContent='';}
function fillStoreDutyBindingForm(item){if(!item)return;var set=function(id,val){var el=document.getElementById(id);if(el)el.value=val||'';};set('duty-binding-username',item.username);set('duty-binding-store',item.store);set('duty-binding-access-level',item.access_level||'support');set('duty-binding-effective-from',String(item.effective_from||'').slice(0,16));set('duty-binding-effective-to',String(item.effective_to||'').slice(0,16));var boolIds={'db-is-primary-store':'is_primary_store','db-enabled':'enabled','db-can-receive-ops':'can_receive_ops','db-can-receive-performance':'can_receive_performance','db-can-receive-food-safety':'can_receive_food_safety','db-can-receive-approval':'can_receive_approval','db-can-handle-ops':'can_handle_ops','db-can-handle-food-safety':'can_handle_food_safety','db-can-approve-hrms':'can_approve_hrms','db-can-view-employees':'can_view_employees'};Object.keys(boolIds).forEach(function(id){var el=document.getElementById(id);if(el)el.checked=!!item[boolIds[id]];});var status=document.getElementById('store-duty-bindings-status');if(status)status.textContent='正在编辑：'+String(item.username||'')+' · '+String(item.store||'');}
function renderStoreDutyBindings(){var box=document.getElementById('store-duty-bindings-list');if(!box)return;var items=Array.isArray(__storeDutyBindingsCache)?__storeDutyBindingsCache:[];if(!items.length){box.innerHTML='<div class=\"settings-hint\">暂无职责绑定，保存后会优先用于消息接收和门店切换。</div>';return;}box.innerHTML='<div style=\"display:flex;flex-direction:column;gap:10px;\">'+items.map(function(item){var tags=[];if(item.is_primary_store)tags.push('主门店');if(item.can_receive_approval)tags.push('审批消息');if(item.can_approve_hrms)tags.push('可审批');if(item.can_view_employees)tags.push('可看员工');if(!item.enabled)tags.push('已停用');return '<div style=\"padding:12px 14px;border-radius:16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);\"><div style=\"display:flex;justify-content:space-between;gap:10px;align-items:flex-start;\"><div><div style=\"font-weight:700;color:#fff;\">'+escapeHtml(String(item.username||''))+' · '+escapeHtml(String(item.store||''))+'</div><div style=\"margin-top:4px;font-size:12px;color:rgba(200,215,230,0.72);\">级别：'+escapeHtml(String(item.access_level||'support'))+' · '+escapeHtml(tags.join(' / ')||'基础协同')+'</div></div><div style=\"display:flex;gap:8px;\"><button class=\"btn btn-secondary\" type=\"button\" onclick=\"fillStoreDutyBindingForm(__storeDutyBindingsCache['+items.indexOf(item)+'])\">编辑</button><button class=\"btn btn-secondary\" type=\"button\" onclick=\"deleteStoreDutyBinding('+Number(item.id||0)+')\">删除</button></div></div></div>';}).join('')+'</div>';}
async function loadStoreDutyBindings(){if(!isAdminUser())return;renderDutyBindingStoreOptions();var status=document.getElementById('store-duty-bindings-status');try{if(status)status.textContent='加载中...';var resp=await HRMS_API.listStoreDutyBindings();__storeDutyBindingsCache=Array.isArray(resp?.items)?resp.items:[];renderStoreDutyBindings();if(status)status.textContent='';}catch(e){if(status)status.textContent='加载失败：'+(e?.message||e);}}
async function saveStoreDutyBindingFromUI(){try{var payload={username:String(document.getElementById('duty-binding-username')?.value||'').trim(),store:String(document.getElementById('duty-binding-store')?.value||'').trim(),access_level:String(document.getElementById('duty-binding-access-level')?.value||'support').trim(),effective_from:String(document.getElementById('duty-binding-effective-from')?.value||'').trim(),effective_to:String(document.getElementById('duty-binding-effective-to')?.value||'').trim(),is_primary_store:!!document.getElementById('db-is-primary-store')?.checked,enabled:!!document.getElementById('db-enabled')?.checked,can_receive_ops:!!document.getElementById('db-can-receive-ops')?.checked,can_receive_performance:!!document.getElementById('db-can-receive-performance')?.checked,can_receive_food_safety:!!document.getElementById('db-can-receive-food-safety')?.checked,can_receive_approval:!!document.getElementById('db-can-receive-approval')?.checked,can_handle_ops:!!document.getElementById('db-can-handle-ops')?.checked,can_handle_food_safety:!!document.getElementById('db-can-handle-food-safety')?.checked,can_approve_hrms:!!document.getElementById('db-can-approve-hrms')?.checked,can_view_employees:!!document.getElementById('db-can-view-employees')?.checked};if(!payload.username||!payload.store)throw new Error('请先填写用户名和门店');await HRMS_API.saveStoreDutyBinding(payload);showNotification('职责绑定已保存','success');resetStoreDutyBindingForm();await loadStoreDutyBindings();}catch(e){showNotification('保存失败: '+(e?.message||e),'error');}}
async function deleteStoreDutyBinding(id){if(!id)return;var ok=await hrmsConfirm({title:'删除职责绑定',message:'确认删除这条职责绑定？',okText:'确认删除',icon:'🗑️'});if(!ok)return;try{await HRMS_API.deleteStoreDutyBinding(id);showNotification('职责绑定已删除','success');await loadStoreDutyBindings();}catch(e){showNotification('删除失败: '+(e?.message||e),'error');}}

        // 更新调试信息
        function updateDebug(message) {
            // UI 已去除调试面板，保留 console 输出以便排查
            console.log(String(message || ''));
        }
        
        // 显示通知
        function showNotification(message, type = 'info') {
            const notification = document.getElementById('notification');
            notification.textContent = message;
            notification.className = 'notification ' + type;
            notification.classList.remove('hidden');
            
            setTimeout(() => {
                notification.classList.add('hidden');
            }, 3000);
        }

        function exportSystemData() {
            const data = HRMS_STORE.ensure();
            const exportData = {
                ...data,
                schemaVersion: HRMS_SCHEMA_VERSION,
                exportedAt: hrmsNowISO()
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hrms-export-v${HRMS_SCHEMA_VERSION}-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showNotification('数据已导出', 'success');
        }

        function triggerImportSystemData() {
            const input = document.getElementById('import-system-data');
            if (input) input.click();
        }

        function handleImportSystemData(event) {
            const file = event?.target?.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                const parsed = hrmsSafeParseJson(String(reader.result || ''));
                if (!parsed || parsed.schemaVersion !== HRMS_SCHEMA_VERSION) {
                    showNotification('导入失败：数据格式或版本不匹配', 'error');
                    return;
                }
                HRMS_STORE.set(parsed);
                showNotification('导入成功，已刷新数据', 'success');
                if (currentPage) {
                    showPage(currentPage);
                }
            };
            reader.onerror = () => {
                showNotification('导入失败：读取文件错误', 'error');
            };
            reader.readAsText(file);
            event.target.value = '';
        }
        
        /** 管理员登录后拉取 /api/health，磁盘紧张时弹窗（每日每级别最多一次） */
        async function hrmsNotifyDiskPressureIfNeeded() {
            try {
                const r = await fetch('/api/health');
                const h = await r.json().catch(() => null);
                if (!h || !h.disk || h.disk.error) return;
                const role = String(currentUser?.role || '').trim();
                const priv = role === ROLES.ADMIN || role === ROLES.HQ_MANAGER || role === ROLES.HR_MANAGER;
                if (!priv) return;
                const lvl = String(h.disk.level || 'ok');
                if (lvl !== 'warn' && lvl !== 'crit') return;
                const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
                const key = 'hrms_disk_' + lvl + '_' + day;
                try {
                    if (sessionStorage.getItem(key)) return;
                    sessionStorage.setItem(key, '1');
                } catch (e) {}
                const tail = `（根分区剩余约 ${h.disk.availGb} GiB / 共 ${h.disk.totalGb} GiB${h.databaseSizeGb != null ? `；当前库约 ${h.databaseSizeGb} GiB` : ''}）`;
                showNotification(String(h.disk.message || '服务器磁盘空间紧张') + tail, lvl === 'crit' ? 'error' : 'warning');
            } catch (e) {}
        }

        // 登录函数
        async function doLogin(event) {
            event.preventDefault();
            
            const username = String(document.getElementById('username').value || '').trim();
            const password = String(document.getElementById('password').value || '');
            const tenantId = resolveHrmsLoginTenantId();
            
            console.log('尝试登录:', { username, tenantId });

            try {
                const resp = await HRMS_API.login(username, password);
                const u = resp?.user;
                if (!u) throw new Error('登录失败：返回用户为空');

                if (resp?.token) {
                    try {
                        const t = String(resp.token || '').trim();
                        if (t) {
                            HRMS_API.setToken(t);
                        }
                    } catch (e) {}
                }
                
                // 从员工数据中获取完整信息
                currentUser = hydrateCurrentUserFromApiUser(u);
                isLoggedIn = true;
                console.log('登录成功:', currentUser);

                // 后台异步加载state，不阻塞UI
                const _loginUser = u;
                hrmsLoadStateFromServer().then(() => {
                    try {
                        const employees2 = HRMS_STORE.getEmployees() || [];
                        const empInfo2 = employees2.find(e => String(e?.username || '').toLowerCase() === String(_loginUser.username || '').toLowerCase()) || {};
                        const stateRole = hrmsNormalizeRoleCode(empInfo2.role || '');
                        if (stateRole && stateRole !== ROLES.EMPLOYEE) currentUser.role = stateRole;
                        if (empInfo2.store && !currentUser.current_store) currentUser.store = empInfo2.store;
                        if (empInfo2.name) currentUser.name = empInfo2.name;
                        if (empInfo2.position) currentUser.position = empInfo2.position;
                        if (empInfo2.department) currentUser.department = empInfo2.department;
                        updateUserInfo();
                        try { updateKitchenNavVisibility(); } catch(e) {}
                        try { updateGrowthModuleVisibility(); updateStrategyModuleVisibility(); } catch(e) {}
                    } catch (e) {}
                    try { loadProfileData(); } catch (e) {}
                    try { if (!document.getElementById('employees-page')?.classList.contains('hidden')) loadEmployeesData(); } catch (e) {}
                }).catch(() => {});
                // 仅记住用户名/租户用于预填；禁止保存明文密码
                try {
                    localStorage.setItem('HRMS_AUTO_USER', username);
                    localStorage.removeItem('HRMS_AUTO_PASS');
                    localStorage.setItem('HRMS_AUTO_TENANT', tenantId);
                } catch (e) {}
                // 先显示主界面，不阻塞
                document.getElementById('login').classList.add('hidden');
                document.getElementById('main-app').classList.remove('hidden');
                updateUserInfo();
                restoreSidebarState();
                try { updateGrowthModuleVisibility(); updateStrategyModuleVisibility(); } catch(e) {}
                showPage(getHomePageName());
                maybeOpenSmartAssistantFromRoute();
                showNotification(`欢迎回来，${currentUser.name}！`, 'success');
                updateDebug(`用户登录: ${currentUser.name} (${getRoleDisplayName(currentUser.role)})`);
                // 心跳：每5分钟上报一次在线状态，用于统计员工在线时长
                try {
                    if (window.__HRMS_HEARTBEAT) clearInterval(window.__HRMS_HEARTBEAT);
                    window.__HRMS_HEARTBEAT = setInterval(() => {
                        fetch('/api/auth/heartbeat', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (HRMS_API.getToken && HRMS_API.getToken() || '') } }).catch(() => {});
                    }, 5 * 60 * 1000);
                    fetch('/api/auth/heartbeat', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (HRMS_API.getToken && HRMS_API.getToken() || '') } }).catch(() => {});
                } catch (e) {};
                try { hrmsNotifyDiskPressureIfNeeded(); } catch (e) {}
                // 非阻塞加载角色模块和刷新
                loadRoleModulesFromServer().catch(() => {});
                loadPermissionGroupsFromServer().catch(() => {});
                try { refreshUnreadBadges(); } catch (e) {}
                // G2: 租户管理员可见 license 到期摘要（只读，不含 key）
                try {
                    const role = String(currentUser?.role || '').toLowerCase();
                    if (role === 'admin' || role === 'hq_admin') {
                        fetch('/api/tenant/subscription', {
                            headers: { 'Authorization': 'Bearer ' + (HRMS_API.getToken && HRMS_API.getToken() || '') }
                        }).then(r => r.json()).then(data => {
                            const lic = data?.license;
                            if (!lic?.has_license) return;
                            const hint = document.getElementById('login-subscription-hint');
                            const days = lic.days_remaining;
                            let text = '';
                            if (lic.expired) text = '订阅已过期，请联系平台续期';
                            else if (days != null && days <= 30) text = `订阅剩余 ${days} 天（${String(lic.expires_at || '').slice(0, 10)}）`;
                            if (text && hint) { hint.textContent = text; hint.style.display = ''; }
                            try { sessionStorage.setItem('hrms_subscription_summary', JSON.stringify({ expires_at: lic.expires_at, days_remaining: days, status: lic.status })); } catch (e) {}
                        }).catch(() => {});
                    }
                } catch (e) {}
            } catch (e) {
                console.error(e);
                const msg = String(e?.message || e);
                showNotification('登录失败：' + msg + '（租户：' + tenantId + '）', 'error');
                updateDebug('登录失败：' + msg + ' tenant=' + tenantId);
            }
        }

        function renderTestAccounts() {
            const el = document.getElementById('test-accounts');
            if (!el) return;
            const users = HRMS_STORE.getUsers();

            const pick = (username) => users.find(u => u.username === username);
            const lines = [];

            const admin = pick('admin');
            const hq = pick('hq_mgr1');
            const mgr = pick('store_mgr1');
            const prod = pick('store_prod1');
            const emp = pick('store_emp1');

            lines.push('<strong>账号提示（以本地数据为准）：</strong><br>');

            const fmt = (label, u) => {
                if (!u) return `${label}: （未初始化）<br>`;
                const status = (u.status || 'active') === 'active' ? '' : '（已禁用）';
                return `${label}: ${u.username} ${status}<br>`;
            };

            lines.push(fmt('管理员', admin));
            lines.push(fmt('总部管理', hq));
            lines.push(fmt('门店店长', mgr));
            lines.push(fmt('门店出品经理', prod));
            lines.push(fmt('门店员工', emp));

            el.innerHTML = lines.join('');
        }
        
        // 更新用户信息显示
        function updateUserInfo() {
            if (!currentUser) return;
            
            const userInfo = document.querySelector('.user-info');
            const activeStore = String(currentUser.current_store || currentUser.store || '').trim();
            const allowedStores = getAllowedStoresForUser();
            const storeSuffix = allowedStores.length > 1 ? ` · 可切换${allowedStores.length}店` : '';
            const switcherHtml = allowedStores.length > 1 ? `
                <select onchange="switchCurrentUserStore(this.value)" style="margin-top:8px;width:100%;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,23,42,0.75);color:#fff;font-size:12px;">
                    ${allowedStores.map(store => `<option value="${escapeHtml(store)}" ${store === activeStore ? 'selected' : ''}>${escapeHtml(store)}</option>`).join('')}
                </select>
            ` : '';
            userInfo.innerHTML = `
                <div class="user-avatar">👤</div>
                <div style="font-weight: 600; margin-bottom: 5px;">${currentUser.name}</div>
                <div style="font-size: 12px; opacity: 0.9;">${getRoleDisplayName(currentUser.role)}</div>
                <div style="font-size: 11px; opacity: 0.8; margin-top: 5px;">${activeStore}${storeSuffix}</div>
                ${switcherHtml}
            `;

            // users management is removed — merged into employees
            const usersNav = document.querySelector('.nav-item[data-page="users"]');
            if (usersNav) usersNav.style.display = 'none';

            ['employees', 'approvals', 'payment', 'rewards', 'points', 'attendance', 'daily-report', 'reports', 'agents', 'agent-tasks', 'exam', 'profile', 'knowledge']
                .forEach((page) => {
                    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
                    if (nav) nav.style.display = canAccessModulePage(page) ? '' : 'none';
                });

            try {
                const agentsNavLink = document.querySelector('.nav-item[data-page="agents"] .nav-link');
                if (agentsNavLink && canAccessModulePage('agents')) {
                    if (String(currentUser?.role || '').trim() === ROLES.ADMIN) {
                        agentsNavLink.innerHTML = '<i>📊</i> <span>数据中心</span>';
                    } else {
                        agentsNavLink.innerHTML = '<i>📦</i> <span>智能助手</span>';
                    }
                }
            } catch (e) {}

            const settingsNav = document.querySelector('.nav-item[data-page="settings"]');
            if (settingsNav) settingsNav.style.display = isAdminUser() ? '' : 'none';

            const forecastNav = document.getElementById('nav-forecast');
            const canSeeForecast = hrmsCanAccessSmartAssistant(currentUser?.role);
            if (forecastNav) forecastNav.style.display = canSeeForecast ? '' : 'none';

            try {
                const addEmpBtn = document.getElementById('add-emp-btn');
                if (addEmpBtn) addEmpBtn.style.display = (isAdminUser() || currentUser.role === ROLES.STORE_MANAGER) ? '' : 'none';
            } catch (e) {}

            try {
                const trainingBatchBtn = document.getElementById('btn-training-batch-assign');
                if (trainingBatchBtn) trainingBatchBtn.style.display = (isAdminUser() || (currentUser && (currentUser.role === ROLES.HR_MANAGER || currentUser.role === ROLES.HQ_MANAGER))) ? '' : 'none';
            } catch (e) {}

            updateMobileNavigationVisibility();
        }
        
        /** 数据中心页：定时刷新活动摘要与健康，便于第一时间看到绩效写入与系统状态 */
        var __dcDashRefreshTimer = null;
        var __dcProvWatchUser = null;
        function stopDcDashboardAutoRefresh() {
            if (__dcDashRefreshTimer) {
                clearInterval(__dcDashRefreshTimer);
                __dcDashRefreshTimer = null;
            }
        }

        var __profileAttPollTimer = null;
        var __profileNotifPollTimer = null;
        function stopProfileAttendanceAutoRefresh() {
            if (__profileAttPollTimer) {
                clearInterval(__profileAttPollTimer);
                __profileAttPollTimer = null;
            }
        }
        function stopProfileNotificationAutoRefresh() {
            if (__profileNotifPollTimer) {
                clearInterval(__profileNotifPollTimer);
                __profileNotifPollTimer = null;
            }
        }
        function startProfileAttendanceAutoRefresh() {
            stopProfileAttendanceAutoRefresh();
            __profileAttPollTimer = setInterval(function () {
                try {
                    if (typeof currentPage === 'string' && currentPage !== 'profile') return;
                    if (document.visibilityState !== 'visible') return;
                    if (typeof loadProfileLeaveBalance === 'function') loadProfileLeaveBalance();
                } catch (e) {}
            }, 45000);
        }
        function startProfileNotificationAutoRefresh() {
            stopProfileNotificationAutoRefresh();
            __profileNotifPollTimer = setInterval(function () {
                try {
                    if (typeof currentPage === 'string' && currentPage !== 'profile') return;
                    if (document.visibilityState !== 'visible') return;
                    if (typeof renderProfileNotifications === 'function') renderProfileNotifications();
                } catch (e) {}
            }, 30000);
        }
        document.addEventListener('visibilitychange', function () {
            try {
                if (document.visibilityState !== 'visible') return;
                if (typeof currentPage === 'string' && currentPage !== 'profile') return;
                if (typeof renderProfileNotifications === 'function') renderProfileNotifications();
            } catch (e) {}
        });

        function startDcDashboardAutoRefresh() {
            stopDcDashboardAutoRefresh();
            __dcDashRefreshTimer = setInterval(function () {
                try {
                    if (typeof currentPage === 'string' && currentPage !== 'agents') return;
                    if (typeof loadDataCenterDashboard === 'function') loadDataCenterDashboard();
                    if (__dcProvWatchUser && typeof loadDcScoreProvenance === 'function') {
                        loadDcScoreProvenance(__dcProvWatchUser);
                    }
                    if (__dcProvWatchUser && typeof loadDcEmployeeLiveDashboard === 'function') {
                        loadDcEmployeeLiveDashboard(__dcProvWatchUser);
                    }
                } catch (e) {}
            }, 45000);
        }

        var __atbFilter = '';
        var __atbRefreshTimer = null;
        var __atbCurrentTaskId = '';

        function atbEscape(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
            });
        }

        function atbHeaders() {
            return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (HRMS_API?.token ? HRMS_API.token() : (localStorage.getItem('hrms_token') || '')) };
        }

        async function atbFetch(url, options) {
            const res = await fetch(url, Object.assign({ headers: atbHeaders() }, options || {}));
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
            return data;
        }

        async function loadAgentTaskBoard(force) {
            if (!currentUser || !canAccessModulePage('agent-tasks')) return;
            const list = document.getElementById('atb-list');
            if (list && (force || !list.dataset.loaded)) list.innerHTML = '<div class="atb-card"><h3>正在加载任务...</h3><p>正在从Agent任务中枢同步状态。</p></div>';
            try {
                const summary = await atbFetch('/api/agent-task-board/summary');
                renderAgentTaskStats(summary.summary || {});
                const s = (summary.summary || summary);
                if (s && s.stale > 0) showNotification(s.stale + ' 个任务超过4小时未响应，请及时处理', 'warning');
            } catch (e) {
                showNotification('Agent任务统计加载失败：' + e.message, 'error');
            }
            try {
                const qs = new URLSearchParams();
                if (__atbFilter) qs.set('status', __atbFilter);
                qs.set('limit', '80');
                const tasks = await atbFetch('/api/agent-task-board/tasks?' + qs.toString());
                renderAgentTaskList(tasks.tasks || []);
                loadAgentTaskMetrics();
                if (list) list.dataset.loaded = '1';
                if (!__atbRefreshTimer) __atbRefreshTimer = setInterval(function() { loadAgentTaskBoard(false); }, 120000);
            } catch (e) {
                if (list) list.innerHTML = '<div class="atb-card"><h3>加载失败</h3><p>' + atbEscape(e.message) + '</p></div>';
                showNotification('Agent任务列表加载失败：' + e.message, 'error');
            }
        }

        function renderAgentTaskStats(summary) {
            const by = summary.byBoardStatus || {};
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v ?? 0); };
            set('atb-stat-total', summary.total || 0);
            set('atb-stat-claimed', by['已领取'] || 0);
            set('atb-stat-assigned', by['已分配'] || 0);
            set('atb-stat-executed', by['已执行'] || 0);
            set('atb-stat-completed', by['已完成'] || 0);
            set('atb-stat-review', by['待验收'] || 0);
            set('atb-stat-overdue', summary.overdue || 0);
            const stale = summary.stale || 0;
            if (stale > 0) {
                const existing = document.getElementById('atb-stale-alert');
                if (!existing) {
                    const alert = document.createElement('div');
                    alert.id = 'atb-stale-alert';
                    alert.style.cssText = 'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:14px;padding:12px 16px;margin-bottom:12px;color:#fca5a5;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;';
                    alert.innerHTML = '<span style="font-size:18px;">\u26A0\uFE0F</span><span>' + stale + ' 个任务已超过4小时未响应，请及时处理！</span>';
                    const stats = document.querySelector('.atb-stats');
                    if (stats && stats.parentNode) stats.parentNode.insertBefore(alert, stats);
                }
            } else {
                const existing = document.getElementById('atb-stale-alert');
                if (existing) existing.remove();
            }
        }

        function atbBadgeClass(status) {
            if (['已结案'].includes(status)) return 'done';
            if (['已打回', '已升级', '已备案'].includes(status)) return 'bad';
            if (['待解析', '已领取', '已分配', '已执行', '已完成', '待验收'].includes(status)) return 'pending';
            return '';
        }

        var ATB_CATEGORIES = { hygiene: '卫生', food_quality: '食品安全', service: '服务', training: '培训', marketing_action: '营销行动', marketing: '营销', data_audit: '数据审计', daily_ops: '日常运营', rhythm_report: '节奏报告', general: '综合' };
        var ATB_PRIORITIES = { critical: '紧急', high: '高', medium: '中', low: '低' };
        var ATB_EVENT_TYPES = { created: '创建', assigned: '分配', dispatched: '派发', claimed: '认领', in_progress: '开始执行', completed: '执行完成', evidence_submitted: '提交证据', review_requested: '请求验收', approved: '验收通过', rejected: '打回修订', escalated: '升级', reassigned: '重分配', closed: '关闭' };
        var ATB_STATUS_MAP = { pending_audit: '待解析', auditing: '待解析', pending_dispatch: '已领取', dispatched: '已分配', viewed: '已分配', in_progress: '已执行', waiting_evidence: '已执行', pending_response: '已完成', pending_review: '待验收', rejected: '已打回', resolved: '已结案', pending_settlement: '已结案', settled: '已结案', closed: '已结案', escalated: '已升级', hr_filed: '已备案' };
        var ATB_STATUS_PATH = ['待解析', '已领取', '已分配', '已执行', '已完成', '待验收', '已打回', '已结案', '已升级', '已备案'];
        function atbCategoryZh(c) { return ATB_CATEGORIES[c] || c || '-'; }
        function atbPriorityZh(p) { return ATB_PRIORITIES[p] || p || '-'; }
        function atbEventTypeZh(e) { return ATB_EVENT_TYPES[e] || e || e; }
        function atbStatusZh(s) { return ATB_STATUS_MAP[s] || s || '-'; }
        function atbFmtTime(v) {
            if (!v) return '-';
            var d = new Date(v);
            if (!Number.isFinite(d.getTime())) return String(v).slice(0, 19).replace('T', ' ');
            return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
        }
        function atbRenderStatusPath(currentBoard, events) {
            var reached = {};
            var TERMINAL = ['已打回','已结案','已升级','已备案'];
            (events || []).forEach(function(e) { reached[atbStatusZh(e.status_after)] = true; });
            reached[currentBoard] = true;
            var currentIdx = ATB_STATUS_PATH.indexOf(currentBoard);
            return '<div class="atb-path">' + ATB_STATUS_PATH.map(function(label, idx) {
                var cls = label === currentBoard ? ' current' : (reached[label] || (currentIdx >= 0 && idx < currentIdx && !TERMINAL.includes(label)) ? ' done' : '');
                return '<div class="atb-path-step' + cls + '">' + atbEscape(label) + '</div>';
            }).join('') + '</div>';
        }

        function renderAgentTaskList(tasks) {
            const list = document.getElementById('atb-list');
            if (!list) return;
            if (!tasks.length) {
                list.innerHTML = '<div class="atb-card"><h3>暂无任务</h3><p>在上方输入问题并发布，Agent会自动进入认领和执行流程。</p></div>';
                return;
            }
            list.innerHTML = tasks.map(function (t) {
                const board = t.board_status || t.status || '-';
                const dt = atbFmtTime(t.created_at);
                const lastAct = new Date(t.last_activity_at || t.updated_at || t.created_at);
                const staleHours = (Date.now() - lastAct.getTime()) / 3600000;
                const isStale = staleHours > 4 && !['已结案','已打回','已升级','已备案','closed','settled','resolved'].includes(board);
                return '<article class="atb-card' + (isStale ? ' atb-card-stale' : '') + '" onclick="openAgentTaskDetail(\'' + atbEscape(t.task_id) + '\')">'
                    + '<div class="atb-card-head"><span class="atb-badge ' + atbBadgeClass(board) + '">' + atbEscape(board) + '</span><span class="atb-badge">' + atbEscape(t.assignee_agent || t.current_agent || '待分配') + '</span>' + (isStale ? '<span class="atb-badge" style="background:rgba(239,68,68,0.25);color:#fca5a5;">超时</span>' : '') + '</div>'
                    + '<h3>' + atbEscape(t.title || t.task_id) + '</h3>'
                    + '<p>' + atbEscape(t.detail || '') + '</p>'
                    + '<div class="atb-meta"><span>门店：' + atbEscape(t.store || '-') + '</span><span>类型：' + atbEscape(atbCategoryZh(t.category)) + '</span><span>优先级：' + atbEscape(atbPriorityZh(t.priority || t.severity)) + '</span><span>提交时间：' + atbEscape(dt || '-') + '</span></div>'
                    + '</article>';
            }).join('');
        }

        function setAgentTaskFilter(status, btn) {
            __atbFilter = status || '';
            document.querySelectorAll('#atb-filters .atb-chip').forEach(function (x) { x.classList.remove('active'); });
            if (btn) btn.classList.add('active');
            loadAgentTaskBoard(true);
        }

        async function createAgentBoardTask() {
            const input = document.getElementById('atb-create-content');
            const content = String(input?.value || '').trim();
            if (!content) { showNotification('请先输入任务内容', 'warning'); return; }
            try {
                const data = await atbFetch('/api/agent-task-board/tasks', { method: 'POST', body: JSON.stringify({ content: content, priority: /紧急|严重|太差|很差/.test(content) ? 'high' : 'medium' }) });
                if (input) input.value = '';
                showNotification('任务已发布：' + data.taskId, 'success');
                setTimeout(function () { loadAgentTaskBoard(true); }, 800);
            } catch (e) {
                showNotification('发布失败：' + e.message, 'error');
            }
        }

        async function openAgentTaskDetail(taskId) {
            __atbCurrentTaskId = taskId;
            const detail = document.getElementById('atb-detail');
            const panel = document.getElementById('atb-panel');
            if (detail) detail.classList.add('open');
            if (panel) panel.innerHTML = '<div class="atb-section">正在加载详情...</div>';
            try {
                const data = await atbFetch('/api/agent-task-board/tasks/' + encodeURIComponent(taskId));
                renderAgentTaskDetail(data.task || {});
            } catch (e) {
                if (panel) panel.innerHTML = '<button class="atb-action" data-click="closeAgentTaskDetail">关闭</button><div class="atb-section">加载失败：' + atbEscape(e.message) + '</div>';
            }
        }

        function renderAgentTaskDetail(t) {
            const panel = document.getElementById('atb-panel');
            if (!panel) return;
            const rawEvents = t.events || [];
            const board = t.board_status || atbStatusZh(t.status);
            const events = rawEvents.slice(-20).reverse().map(function (e) {
                return '<div class="atb-line"><b>' + atbEscape(atbEventTypeZh(e.event_type)) + '</b> ' + atbEscape(atbStatusZh(e.status_before)) + ' → ' + atbEscape(atbStatusZh(e.status_after)) + '<br>' + atbEscape(atbFmtTime(e.created_at)) + '</div>';
            }).join('') || '<div class="atb-line">暂无事件</div>';
            const evidences = (t.evidences || []).map(function (e) {
                const link = e.file_url ? '<br><a href="' + atbEscape(e.file_url) + '" target="_blank" style="color:#fbbf24;">查看文件</a>' : '';
                return '<div class="atb-line"><b>' + atbEscape({photo:'照片',text:'文字',document:'文档',link:'链接'}[e.evidence_type] || e.evidence_type) + '</b> ' + atbEscape(e.content || '') + link + '<br>' + atbEscape(atbFmtTime(e.created_at)) + '</div>';
            }).join('') || '<div class="atb-line">暂无证据</div>';
            panel.innerHTML = '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;"><div><div class="atb-kicker">任务详情</div><h2 style="margin:6px 0 0;font-size:24px;line-height:1.15;">' + atbEscape(t.title || t.task_id) + '</h2></div><button class="atb-action" style="width:auto;padding:8px 12px;" data-click="closeAgentTaskDetail">关闭</button></div>'
                + '<div class="atb-meta" style="margin-top:12px;"><span>状态：' + atbEscape(board) + '</span><span>负责人：' + atbEscape({ops_supervisor:'运营督导',food_quality:'食安专员',train_advisor:'培训顾问',marketing_planner:'营销策划',marketing_executor:'营销执行',data_auditor:'数据审计'}[t.assignee_agent || t.current_agent] || t.assignee_agent || t.current_agent || '待分配') + '</span><span>门店：' + atbEscape(t.store || '-') + '</span><span>类型：' + atbEscape(atbCategoryZh(t.category)) + '</span><span>优先级：' + atbEscape(atbPriorityZh(t.priority || t.severity)) + '</span></div>'
                + atbRenderStatusPath(board, rawEvents)
                + '<div class="atb-section"><b>任务内容</b><p style="margin-top:8px;color:rgba(226,232,240,.72);white-space:pre-wrap;">' + atbEscape(t.detail || '') + '</p></div>'
                + '<div class="atb-section"><b>补充证据/反馈</b><textarea id="atb-evidence-text" class="atb-input" style="margin-top:10px;min-height:82px;" placeholder="输入门店反馈、检查说明或证据描述"></textarea><div id="atb-evidence-files-wrap" style="margin-top:8px;"><label style="display:flex;align-items:center;gap:8px;padding:12px;border:2px dashed rgba(255,255,255,0.15);border-radius:12px;cursor:pointer;color:rgba(226,232,240,0.6);font-size:14px;transition:border-color .2s;"><span>点击或拖拽上传照片/文件</span><input id="atb-evidence-files" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt" style="display:none;" onchange="atbPreviewFiles()"></label><div id="atb-evidence-preview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div></div><button class="atb-action" style="margin-top:8px;width:100%;" data-click="submitAgentTaskEvidence">提交证据/反馈</button></div>'
                + '<div class="atb-section"><b>证据</b><div class="atb-timeline">' + evidences + '</div></div>'
                + '<div class="atb-section"><b>审计时间线</b><div class="atb-timeline">' + events + '</div></div>'
                + '<div class="atb-section"><b>重新分配负责人</b><select id="atb-reassign-agent" class="atb-input" style="margin-top:8px;width:100%;"><option value="">选择负责人...</option><option value="ops_supervisor">运营督导</option><option value="food_quality">食安专员</option><option value="train_advisor">培训顾问</option><option value="marketing_planner">营销策划</option><option value="marketing_executor">营销执行</option><option value="data_auditor">数据审计</option></select><button class="atb-action" style="margin-top:8px;width:100%;" data-click="reassignAgentTask">确认重分配</button></div>'
                + '<div class="atb-section"><b>质量评分 (0-10)</b><input id="atb-quality-score" class="atb-input" type="number" min="0" max="10" step="0.5" style="margin-top:8px;width:100%;" placeholder="输入0-10的质量评分"><button class="atb-action" style="margin-top:8px;width:100%;" data-click="submitQualityScore">提交评分</button></div>'
                + '<div class="atb-panel-actions"><button class="atb-action good" onclick="reviewAgentTask(\'approved\')">通过并关闭</button><button class="atb-action bad" onclick="reviewAgentTask(\'rejected\')">打回并修订</button><button class="atb-action" data-click="deriveAgentTask">创建衍生任务</button></div>';
        }

        function closeAgentTaskDetail() {
            const detail = document.getElementById('atb-detail');
            if (detail) detail.classList.remove('open');
            __atbCurrentTaskId = '';
        }

        function atbPreviewFiles() {
            var input = document.getElementById('atb-evidence-files');
            var preview = document.getElementById('atb-evidence-preview');
            if (!input || !preview) return;
            preview.innerHTML = '';
            var files = input.files || [];
            for (var i = 0; i < files.length; i++) {
                var f = files[i];
                var el = document.createElement('div');
                el.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:rgba(255,255,255,0.06);font-size:12px;color:rgba(226,232,240,0.8);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                if (f.type && f.type.startsWith('image/')) {
                    var img = document.createElement('img');
                    img.src = URL.createObjectURL(f);
                    img.style.cssText = 'width:28px;height:28px;border-radius:4px;object-fit:cover;';
                    el.appendChild(img);
                }
                var span = document.createElement('span');
                span.textContent = f.name;
                el.appendChild(span);
                preview.appendChild(el);
            }
        }

        async function submitAgentTaskEvidence() {
            var text = String(document.getElementById('atb-evidence-text')?.value || '').trim();
            var fileInput = document.getElementById('atb-evidence-files');
            var files = fileInput ? Array.from(fileInput.files || []) : [];
            if (!__atbCurrentTaskId || (!text && !files.length)) { showNotification('请输入证据/反馈内容或上传照片/文件', 'warning'); return; }
            try {
                var uploadedUrls = [];
                if (files.length) {
                    var fd = new FormData();
                    files.forEach(function(f) { fd.append('files', f); });
                    var uploadRes = await fetch('/api/uploads/agent-task-evidence', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (HRMS_API?.token ? HRMS_API.token() : (localStorage.getItem('hrms_token') || '')) }, body: fd });
                    var uploadData = await uploadRes.json().catch(function() { return {}; });
                    if (uploadData.urls && uploadData.urls.length) { uploadedUrls = uploadData.urls; }
                    else { showNotification('文件上传失败：' + (uploadData.error || '未知错误'), 'error'); return; }
                }
                var fileUrl = uploadedUrls.join(',');
                await atbFetch('/api/agent-task-board/tasks/' + encodeURIComponent(__atbCurrentTaskId) + '/evidences', { method: 'POST', body: JSON.stringify({ evidenceType: files.length ? 'photo' : 'text', content: text, fileUrl: fileUrl }) });
                showNotification('证据已提交，任务进入待验收', 'success');
                await openAgentTaskDetail(__atbCurrentTaskId);
                loadAgentTaskBoard(true);
            } catch (e) { showNotification('提交失败：' + e.message, 'error'); }
        }

        async function reviewAgentTask(decision) {
            if (!__atbCurrentTaskId) return;
            const isReject = decision === 'rejected';
            const comment = prompt(isReject ? '请输入打回原因，将自动创建修订任务' : '请输入验收备注（可空）') || '';
            try {
                await atbFetch('/api/agent-task-board/tasks/' + encodeURIComponent(__atbCurrentTaskId) + '/review', { method: 'POST', body: JSON.stringify({ decision: decision, comment: comment, createRevisionTask: isReject }) });
                showNotification(isReject ? '已打回并创建修订任务' : '已通过并关闭任务', 'success');
                closeAgentTaskDetail();
                loadAgentTaskBoard(true);
            } catch (e) { showNotification('操作失败：' + e.message, 'error'); }
        }

        async function deriveAgentTask() {
            if (!__atbCurrentTaskId) return;
            const content = prompt('请输入衍生任务内容');
            if (!content) return;
            try {
                await atbFetch('/api/agent-task-board/tasks/' + encodeURIComponent(__atbCurrentTaskId) + '/derive', { method: 'POST', body: JSON.stringify({ content: content }) });
                showNotification('衍生任务已创建', 'success');
                loadAgentTaskBoard(true);
            } catch (e) { showNotification('创建失败：' + e.message, 'error'); }
        }

        async function reassignAgentTask() {
            if (!__atbCurrentTaskId) return;
            const select = document.getElementById('atb-reassign-agent');
            const newAgent = select ? select.value : '';
            if (!newAgent) { showNotification('请选择Agent', 'warning'); return; }
            try {
                await atbFetch('/api/agent-task-board/tasks/' + encodeURIComponent(__atbCurrentTaskId) + '/reassign', { method: 'POST', body: JSON.stringify({ newAgent: newAgent, reason: '管理员手动重分配' }) });
                showNotification('已重分配给 ' + newAgent, 'success');
                await openAgentTaskDetail(__atbCurrentTaskId);
                loadAgentTaskBoard(true);
            } catch (e) { showNotification('重分配失败：' + e.message, 'error'); }
        }

        async function submitQualityScore() {
            if (!__atbCurrentTaskId) return;
            const input = document.getElementById('atb-quality-score');
            const score = parseFloat(input ? input.value : '');
            if (isNaN(score) || score < 0 || score > 10) { showNotification('请输入0-10的评分', 'warning'); return; }
            try {
                await atbFetch('/api/agent-task-board/tasks/' + encodeURIComponent(__atbCurrentTaskId) + '/quality-score', { method: 'POST', body: JSON.stringify({ score: score }) });
                showNotification('质量评分已保存：' + score, 'success');
            } catch (e) { showNotification('评分失败：' + e.message, 'error'); }
        }

        let __atbMetricsData = null;
        async function loadAgentTaskMetrics() {
            try {
                const data = await atbFetch('/api/agent-task-board/metrics?days=7');
                __atbMetricsData = data.metrics || {};
                const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v ?? '-'); };
                set('atb-stat-avgtime', __atbMetricsData.avgCloseTimeHours ? __atbMetricsData.avgCloseTimeHours + 'h' : '-');
                set('atb-stat-evidence', __atbMetricsData.evidenceCoverage || '-');
            } catch { __atbMetricsData = null; }
        }

        // 显示页面
        function showPage(pageName) {
            stopDcDashboardAutoRefresh();
            stopProfileAttendanceAutoRefresh();
            stopProfileNotificationAutoRefresh();
            console.log('切换到页面:', pageName);
            updateDebug('当前页面: ' + pageName);

            // 文件中心已合并到知识库
            if (pageName === 'files') {
                pageName = 'knowledge';
                setTimeout(() => switchKbModule('files'), 100);
            }

            if (pageName === 'dashboard') {
                pageName = getHomePageName();
            }

            if (pageName === 'users') {
                if (!isAdminUser()) {
                    showNotification('仅管理员可访问该模块', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (['profile', 'attendance', 'daily-report', 'employees', 'approvals', 'payment', 'exam', 'rewards', 'points', 'reports', 'agents', 'agent-tasks', 'knowledge', 'task-performance'].includes(pageName)) {
                if (!canAccessModulePage(pageName)) {
                    showNotification('您没有该模块访问权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'payment') {
                if (!hrmsCanAccessPayments(currentUser?.role)) {
                    showNotification('您没有请款权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'employees') {
                const canAccess = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HR_MANAGER);
                if (!canAccess) {
                    showNotification('您没有员工管理权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'approvals') {
                const _apr = String(currentUser?.role || '').trim();
                const canAccess = currentUser && (_apr === ROLES.ADMIN || _apr === ROLES.HQ_MANAGER || _apr === ROLES.HR_MANAGER || _apr === ROLES.STORE_MANAGER || _apr === ROLES.CASHIER || _apr.startsWith('custom_'));
                if (!canAccess) {
                    showNotification('您没有待审批权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'daily-report') {
                const canAccess = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.FRONT_MANAGER || currentUser.role === ROLES.FRONT_SUPERVISOR);
                if (!canAccess) {
                    showNotification('您没有营业日报权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'kitchen') {
                const role = String(currentUser?.role || '');
                const pos  = String(currentUser?.position || '').toLowerCase();
                const isKitchen = role === 'store_production_manager'
                    || /(后厨|厨房|炒锅|烧味|打荷|砧板|切配|出品|厨师|厨工)/.test(pos)
                    || ['admin','hq_manager','store_manager'].includes(role);
                if (!isKitchen) {
                    showNotification('仅厨房岗位员工可访问', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'rewards') {
                const canAccess = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HR_MANAGER || currentUser.role === ROLES.PRODUCTION_MANAGER);
                if (!canAccess) {
                    showNotification('您没有奖罚管理权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'reports') {
                const canAccess = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HR_MANAGER);
                if (!canAccess) {
                    showNotification('您没有分析报表权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'agents') {
                const canAccess = hrmsCanAccessSmartAssistant(currentUser?.role);
                if (!canAccess) {
                    showNotification('仅店长、出品经理和总部角色可访问智能助手', 'warning');
                    pageName = getHomePageName();
                } else if (String(currentUser?.role || '').trim() === ROLES.PRODUCTION_MANAGER) {
                    window.location.href = '/forecast.html';
                    return;
                }
            }

            if (pageName === 'growth') {
                const canAccess = currentUser && currentUser.role === ROLES.ADMIN;
                if (!canAccess) {
                    showNotification('增长看板仅系统管理员可访问', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'diagnosis') {
                const canAccess = currentUser && currentUser.role === ROLES.ADMIN;
                if (!canAccess) {
                    showNotification('经营诊断仅系统管理员可访问', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'strategy') {
                const canAccess = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.STORE_PRODUCTION_MANAGER);
                if (!canAccess) {
                    showNotification('门店营销策略需要门店或总部角色权限', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'agent-tasks') {
                const canAccess = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.HR_MANAGER);
                if (!canAccess) {
                    showNotification('仅管理员和总部角色可访问Agent任务看板', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'stores' || pageName === 'roles' || pageName === 'settings' || pageName === 'users') {
                if (!isAdminUser()) {
                    showNotification('仅管理员可访问该模块', 'warning');
                    pageName = getHomePageName();
                }
            }

            if (pageName === 'rewards') {
                try {
                    const locked = !!(window.__REWARDS_FILTER_LOCK || __REWARDS_FILTER_LOCK);
                    if (!locked) {
                        if (typeof __REWARDS_FILTER_USER !== 'undefined') __REWARDS_FILTER_USER = '';
                        if (typeof __REWARDS_FILTER_TYPE !== 'undefined') __REWARDS_FILTER_TYPE = '';
                        window.__REWARDS_FILTER_USER = '';
                        window.__REWARDS_FILTER_TYPE = '';
                    }
                    window.__REWARDS_FILTER_LOCK = false;
                    if (typeof __REWARDS_FILTER_LOCK !== 'undefined') __REWARDS_FILTER_LOCK = false;
                } catch (e) {}
            }
            
            // 隐藏所有页面
            document.querySelectorAll('[id$="-page"]').forEach(page => {
                page.classList.add('hidden');
            });
            
            // 显示目标页面
            const targetPage = document.getElementById(pageName + '-page');
            const contentRoot = document.querySelector('.content');
            if (targetPage && contentRoot && targetPage.parentElement !== contentRoot) {
                contentRoot.appendChild(targetPage);
            }
            if (targetPage) {
                targetPage.classList.remove('hidden');
            }

            // 待审批/经营诊断页面：让父容器 .content 透明，露出极光背景
            if (contentRoot) {
                if (pageName === 'approvals' || pageName === 'diagnosis') {
                    contentRoot.setAttribute('data-active-page', pageName);
                    contentRoot.style.setProperty('background', 'transparent', 'important');
                    contentRoot.style.setProperty('box-shadow', 'none', 'important');
                    contentRoot.style.setProperty('padding', '0', 'important');
                    contentRoot.style.setProperty('backdrop-filter', 'none', 'important');
                    contentRoot.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
                    contentRoot.style.setProperty('border-radius', '0', 'important');
                } else {
                    contentRoot.removeAttribute('data-active-page');
                    contentRoot.style.removeProperty('background');
                    contentRoot.style.removeProperty('box-shadow');
                    contentRoot.style.removeProperty('padding');
                    contentRoot.style.removeProperty('backdrop-filter');
                    contentRoot.style.removeProperty('-webkit-backdrop-filter');
                    contentRoot.style.removeProperty('border-radius');
                }
            }

            if (window.innerWidth <= 768) {
                try {
                    window.scrollTo(0, 0);
                    document.documentElement.scrollTop = 0;
                    document.body.scrollTop = 0;
                    const contentEl = document.querySelector('.content');
                    if (contentEl) contentEl.scrollTop = 0;
                } catch (e) {}
            }
            
            // 更新导航状态
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            const activeNav = document.querySelector(`.sidebar .nav-item[data-page="${pageName}"]`);
            if (activeNav) {
                activeNav.classList.add('active');
            }
            
            currentPage = pageName;
            
            // Sync mobile navigation
            syncMobileNavigation(pageName);
            
            // 根据页面加载特定数据
            loadPageData(pageName);

            // Mobile UX: update topbar title and close sidebar after navigation
            try {
                const titleEl = document.getElementById('mobile-topbar-title');
                if (titleEl) {
                    const map = {
                        'daily-report': '营业日报',
                        reports: '分析报表',
                        approvals: '待审批',
                        payment: '请款',
                        profile: '我的档案',
                        employees: '员工管理',
                        users: '用户管理',
                        knowledge: '知识库',
                        files: '文件中心',
                        agents: '数据中心',
                        growth: '增长看板',
                        diagnosis: '经营诊断',
                        'agent-tasks': 'Agent任务',
                        strategy: '门店营销策略',
                        flashcards: '自我测验',
                        stores: '门店管理',
                        roles: '角色权限',
                        exam: '考试测评',
                        promotion: '升职申请',
                        rewards: '奖惩管理',
                        points: '员工积分',
                        attendance: '考勤打卡',
                        settings: '系统设置'
                    };
                    titleEl.textContent = map[pageName] || '营业日报';
                }
            } catch (e) {
                // ignore
            }
            try { refreshUnreadBadges(); } catch (e) {}
            closeMobileSidebar();
            if (pageName === 'profile') {
                startProfileAttendanceAutoRefresh();
                startProfileNotificationAutoRefresh();
            }
            if (pageName === 'agents') startDcDashboardAutoRefresh();
        }

        function toggleMobileSidebar() {
            const app = document.getElementById('main-app');
            if (!app) return;
            const open = app.classList.contains('sidebar-open');
            if (open) closeMobileSidebar();
            else openMobileSidebar();
        }

        function openMobileSidebar() {
            const app = document.getElementById('main-app');
            const overlay = document.getElementById('mobile-overlay');
            const sidebar = document.getElementById('main-sidebar');
            if (window.innerWidth > 768) return;
            if (!sidebar) {
                showNotification('菜单加载失败，请刷新页面重试', 'warning');
                return;
            }
            if (app) app.classList.add('sidebar-open');
            if (document.body) document.body.classList.add('mobile-sidebar-open');
            if (overlay) overlay.classList.remove('hidden');
        }

        function closeMobileSidebar() {
            const app = document.getElementById('main-app');
            const overlay = document.getElementById('mobile-overlay');
            if (app) app.classList.remove('sidebar-open');
            if (document.body) document.body.classList.remove('mobile-sidebar-open');
            if (overlay) overlay.classList.add('hidden');
        }

        function toggleSidebarCollapse() {
            const sidebar = document.getElementById('main-sidebar');
            const toggleBtn = sidebar?.querySelector('.sidebar-toggle');
            if (!sidebar) return;
            
            const isCollapsed = sidebar.classList.toggle('collapsed');
            if (toggleBtn) {
                toggleBtn.textContent = isCollapsed ? '▶' : '◀';
            }
            
            // 保存折叠状态
            localStorage.setItem('hrms_sidebar_collapsed', isCollapsed ? '1' : '0');
        }

        function restoreSidebarState() {
            const collapsed = localStorage.getItem('hrms_sidebar_collapsed') === '1';
            const sidebar = document.getElementById('main-sidebar');
            const toggleBtn = sidebar?.querySelector('.sidebar-toggle');
            if (sidebar && collapsed) {
                sidebar.classList.add('collapsed');
                if (toggleBtn) toggleBtn.textContent = '▶';
            }
        }
        
        // 加载页面数据
        function loadPageData(pageName) {
            switch (pageName) {
                case 'daily-report':
                    loadDailyReportData();
                    break;
                case 'approvals':
                    loadApprovalsData();
                    break;
                case 'payment':
                    loadPaymentData();
                    break;
                case 'profile':
                    loadProfileData();
                    break;
                case 'knowledge':
                    loadKnowledgeData();
                    break;
                case 'training':
                    loadTrainingPage();
                    break;
                case 'files':
                    if (currentUser?.role !== 'admin') {
                        showNotification('仅管理员可访问文件中心', 'warning');
                        pageName = getHomePageName();
                        break;
                    }
                    loadFilesList();
                    break;
                case 'agents':
                    loadAgentsData();
                    break;
                case 'growth':
                    if (!canAccessGrowthModule()) {
                        if (typeof showNotification === 'function') showNotification('无权限访问', 'error');
                        return;
                    }
                    var gp = document.getElementById('growth-page');
                    if (gp) { gp.style.display = ''; gp.style.position = ''; gp.style.top = ''; gp.style.width = ''; gp.style.height = ''; gp.style.overflow = ''; }
                    loadCampaignFilterOptions();
                    loadGrowthStoreOptions();
                    refreshGrowthDashboard();
                    break;
                case 'agent-tasks':
                    loadAgentTaskBoard();
                    break;
                case 'diagnosis':
                    loadDiagnosisData();
                    break;
                case 'strategy':
                    loadStrategyPage();
                    break;
                case 'flashcards':
                    loadFlashcardsModule();
                    break;
                case 'employees':
                    loadEmployeesData();
                    if (isAdminUser()) {
                        HRMS_API.getState().then(function(resp) {
                            var srvEmps = resp && resp.data && Array.isArray(resp.data.employees) ? resp.data.employees : null;
                            if (!srvEmps || !srvEmps.length) return;
                            try {
                                var raw = localStorage.getItem(HRMS_STORAGE_KEY);
                                var sd = raw ? hrmsSafeParseJson(raw) : null;
                                if (sd && sd.schemaVersion === HRMS_SCHEMA_VERSION) {
                                    var lEmps = Array.isArray(sd.employees) ? sd.employees : [];
                                    var lUnames = new Set(lEmps.map(function(e) { return String(e && e.username || '').toLowerCase(); }).filter(Boolean));
                                    var added = srvEmps.filter(function(e) { var u = String(e && e.username || '').toLowerCase(); return u && !lUnames.has(u); });
                                    if (added.length) {
                                        sd.employees = lEmps.concat(added);
                                        try { localStorage.setItem(HRMS_STORAGE_KEY, JSON.stringify(sd)); } catch(_) {}
                                    }
                                }
                            } catch(_) {}
                            try { loadEmployeesData(); } catch(e) {}
                        }).catch(function(){});
                    }
                    break;
                case 'users':
                    loadUsersData();
                    break;
                case 'stores':
                    loadStoresData();
                    break;
                case 'roles':
                    loadRolesData();
                    break;
                case 'exam':
                    loadExamData();
                    break;
                case 'promotion':
                    loadPromotionData();
                    break;
                case 'rewards':
                    loadRewardsData();
                    break;
                case 'points':
                    loadPointsPageData();
                    break;
                case 'attendance':
                    loadAttendanceData();
                    break;
                case 'kitchen':
                    try { initKitchenPage(); } catch(e) { console.error('[kitchen]', e); }
                    break;
                case 'reports':
                    loadReportsData();
                    break;
                case 'settings':
                    loadSettingsData();
                    break;
                case 'task-performance':
                    loadTaskPerformanceData();
                    break;
            }
        }

        function clearPaymentFilters() {
            const storeEl = document.getElementById('payment-filter-store');
            const statusEl = document.getElementById('payment-filter-status');
            const startEl = document.getElementById('payment-filter-start');
            const endEl = document.getElementById('payment-filter-end');
            if (storeEl) storeEl.value = '';
            if (statusEl) statusEl.value = '';
            if (startEl) startEl.value = '';
            if (endEl) endEl.value = '';
            loadPaymentData();
        }

        function openPaymentCreate() {
            if (!hrmsCanCreatePayments(currentUser?.role)) {
                showNotification('您没有创建请款单权限', 'warning');
                return;
            }
            const listView = document.getElementById('payment-list-view');
            const createView = document.getElementById('payment-create-view');
            if (listView) listView.classList.add('hidden');
            if (createView) createView.classList.remove('hidden');
            initPaymentForm();
        }

        function closePaymentCreate() {
            const listView = document.getElementById('payment-list-view');
            const createView = document.getElementById('payment-create-view');
            if (createView) createView.classList.add('hidden');
            if (listView) listView.classList.remove('hidden');
        }

        function initPaymentForm() {
            const dateEl = document.getElementById('pay-form-date');
            if (dateEl && !String(dateEl.value || '').trim()) {
                dateEl.value = new Date().toISOString().slice(0, 10);
            }
            populatePaymentFormOptions();

            try {
                const els = [
                    document.getElementById('pay-form-date'),
                    document.getElementById('pay-form-store'),
                    document.getElementById('pay-form-category')
                ].filter(Boolean);
                els.forEach(el => {
                    if (el.dataset.budgetHooked) return;
                    el.dataset.budgetHooked = '1';
                    el.addEventListener('change', () => {
                        try { updatePaymentCreateBudgetHint(); } catch (e) {}
                    });
                });
            } catch (e) {}

            try { updatePaymentCreateBudgetHint(); } catch (e) {}
        }

        function hrmsMonthFromDate(dateStr) {
            const d = String(dateStr || '').trim();
            if (!d) return '';
            if (/^\d{4}-\d{2}$/.test(d)) return d;
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.slice(0, 7);
            return '';
        }

        function hrmsMoneyText(n) {
            const v = Number(n);
            if (!Number.isFinite(v)) return '-';
            return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
        }

        function renderBudgetHintHtml(summary, extra) {
            const s = summary && typeof summary === 'object' ? summary : {};
            const budget = s.budget;
            if (budget == null) {
                return `<span style="color: rgba(200,215,230,0.85);">未配置预算：${escapeHtml(String(extra || ''))}</span>`;
            }
            const remaining = Number(s.remaining);
            const usedTotal = Number(s.usedTotal);
            const color = Number.isFinite(remaining) && remaining < 0 ? 'rgba(239,68,68,0.95)' : 'rgba(34,197,94,0.95)';
            return `<div style="display:flex; gap: 10px; flex-wrap: wrap; align-items:center;">
                <div style="font-weight: 900; color: rgba(226,232,240,0.95);">本月预算：${escapeHtml(hrmsMoneyText(budget))}</div>
                <div style="color: rgba(200,215,230,0.85);">已占用：${escapeHtml(hrmsMoneyText(usedTotal))}（待审批 ${escapeHtml(hrmsMoneyText(s.usedPending))} / 已审核 ${escapeHtml(hrmsMoneyText(s.usedApproved))} / 已付款 ${escapeHtml(hrmsMoneyText(s.usedPaid))}）</div>
                <div style="font-weight: 900; color: ${color};">剩余：${escapeHtml(hrmsMoneyText(remaining))}</div>
            </div>`;
        }

        function hrmsGetPrimaryCategoryForSecondary(secondaryName) {
            try {
                const cfg = hrmsGetPaymentSettings();
                const sec = Array.isArray(cfg?.secondaryCategories) ? cfg.secondaryCategories : [];
                const match = sec.find(s => String(s?.name || '').toLowerCase() === String(secondaryName || '').toLowerCase());
                return match ? String(match.primary || '').trim() : '';
            } catch (e) { return ''; }
        }

        async function updatePaymentCreateBudgetHint() {
            const box = document.getElementById('pay-form-budget-hint');
            if (!box) return;
            const date = String(document.getElementById('pay-form-date')?.value || '').trim();
            const store = String(document.getElementById('pay-form-store')?.value || '').trim();
            const secondaryCategory = String(document.getElementById('pay-form-category')?.value || '').trim();
            const month = hrmsMonthFromDate(date);
            if (!store || !secondaryCategory || !month) {
                box.style.display = 'none';
                box.textContent = '';
                return;
            }

            const primaryCategory = hrmsGetPrimaryCategoryForSecondary(secondaryCategory) || secondaryCategory;

            box.style.display = '';
            box.textContent = '预算计算中...';
            try {
                const summary = await HRMS_API.getPaymentBudgetSummary({ store, month, category: primaryCategory });
                const extra = `${store} / ${month} / ${primaryCategory}`;
                box.innerHTML = renderBudgetHintHtml(summary, extra);
            } catch (e) {
                box.innerHTML = `<span style="color: rgba(239,68,68,0.85);">预算计算失败：${escapeHtml(String(e?.message || e))}</span>`;
            }
        }

        function populatePaymentFormOptions() {
            const storeEl = document.getElementById('pay-form-store');
            const categoryEl = document.getElementById('pay-form-category');
            const payeeEl = document.getElementById('pay-form-payee');
            const urgencyEl = document.getElementById('pay-form-urgency');

            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            const storeOptions = stores.map(s => {
                const name = String(s?.name || s?.id || '').trim();
                return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            }).join('');
            if (storeEl) {
                storeEl.innerHTML = storeOptions;
                if (String(currentUser?.role || '') === ROLES.STORE_MANAGER || String(currentUser?.role || '') === ROLES.FRONT_MANAGER) {
                    let my = String(currentUser?.store || '').trim();
                    if (!my && currentUser?.username) {
                        try {
                            const emps = HRMS_STORE.getEmployees() || [];
                            const me = emps.find(e => String(e?.username || '').toLowerCase() === String(currentUser.username).toLowerCase());
                            if (me) my = String(me.store || '').trim();
                        } catch (e) {}
                    }
                    if (my && !currentUser.store) currentUser.store = my;
                    if (my) storeEl.value = my;
                    storeEl.disabled = true;
                } else {
                    storeEl.disabled = false;
                }
            }

            const cfg = hrmsGetPaymentSettings();
            if (categoryEl) {
                const secondary = Array.isArray(cfg?.secondaryCategories) ? cfg.secondaryCategories : [];
                const primary = Array.isArray(cfg?.primaryCategories) ? cfg.primaryCategories : [];
                if (secondary.length) {
                    let html = '';
                    if (primary.length) {
                        primary.forEach(p => {
                            const subs = secondary.filter(s => String(s?.primary || '').toLowerCase() === String(p || '').toLowerCase());
                            if (subs.length) {
                                html += `<optgroup label="${escapeHtml(p)}">`;
                                subs.forEach(s => { html += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`; });
                                html += '</optgroup>';
                            }
                        });
                        const unlinked = secondary.filter(s => !String(s?.primary || '').trim());
                        if (unlinked.length) {
                            html += '<optgroup label="未归属">';
                            unlinked.forEach(s => { html += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`; });
                            html += '</optgroup>';
                        }
                    } else {
                        secondary.forEach(s => { html += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`; });
                    }
                    categoryEl.innerHTML = html;
                } else {
                    const cats = Array.isArray(cfg?.categories) ? cfg.categories : [];
                    categoryEl.innerHTML = cats.length
                        ? cats.map(c => `<option value="${escapeHtml(String(c || ''))}">${escapeHtml(String(c || ''))}</option>`).join('')
                        : '<option value="">（请先在基础配置中维护二级科目）</option>';
                }
            }
            if (payeeEl) {
                const details = Array.isArray(cfg?.payeeDetails) ? cfg.payeeDetails : [];
                const payees = details.length ? details.map(d => String(d?.name || '').trim()).filter(Boolean) : (Array.isArray(cfg?.payees) ? cfg.payees : []);
                payeeEl.innerHTML = ['<option value="">-- 选择常用付款对象 --</option>'].concat(payees.map(p => {
                    const v = String(p || '').trim();
                    return `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`;
                })).join('');
                if (!payeeEl.dataset.payeeHooked) {
                    payeeEl.dataset.payeeHooked = '1';
                    payeeEl.addEventListener('change', function() {
                        try {
                            const sel = String(this.value || '').trim();
                            const details = Array.isArray(cfg?.payeeDetails) ? cfg.payeeDetails : [];
                            const match = sel ? details.find(d => String(d?.name || '').trim() === sel) : null;
                            const nameEl = document.getElementById('pay-form-payee-name');
                            const acctEl = document.getElementById('pay-form-payee-account');
                            const bankEl = document.getElementById('pay-form-payee-bank');
                            if (match) {
                                if (nameEl) nameEl.value = String(match.name || '').trim();
                                if (acctEl) acctEl.value = String(match.account || '').trim();
                                if (bankEl) bankEl.value = String(match.bank || '').trim();
                            }
                        } catch (e) {}
                    });
                }
            }
            if (urgencyEl) {
                const ugs = Array.isArray(cfg?.urgencies) ? cfg.urgencies : ['低', '中', '高'];
                urgencyEl.innerHTML = ugs.map(u => `<option value="${escapeHtml(String(u))}">${escapeHtml(String(u))}</option>`).join('');
            }
        }

        function loadPaymentData() {
            const box = document.getElementById('payment-list');
            const empty = document.getElementById('payment-empty');
            const stats = document.getElementById('payment-stats');
            if (!box || !empty) return;

            const adminActions = document.getElementById('payment-admin-actions');
            if (adminActions) adminActions.style.display = isAdminUser() ? 'flex' : 'none';
            const adminExport = document.getElementById('payment-admin-export');
            if (adminExport) adminExport.style.display = isAdminUser() ? '' : 'none';
            const createBtn = document.getElementById('payment-create-btn');
            if (createBtn) createBtn.style.display = hrmsCanCreatePayments(currentUser?.role) ? '' : 'none';

            const storeSel = document.getElementById('payment-filter-store');
            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            if (storeSel && !storeSel.dataset.ready) {
                const opts = ['<option value="">全部门店</option>'].concat(stores.map(s => {
                    const name = String(s?.name || s?.id || '').trim();
                    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
                }));
                storeSel.innerHTML = opts.join('');
                storeSel.dataset.ready = '1';
            }
            // 店长：门店筛选始终锁定为「当前门店」，并在每次加载时实时同步。
            // 关键修复：原逻辑只在首次（!dataset.ready）设置一次，多店店长切换门店后
            // 下拉框停留在旧门店，且客户端按这个陈旧值二次过滤，导致请款列表错位/为空。
            if (storeSel && String(currentUser?.role || '') === ROLES.STORE_MANAGER) {
                let my = String(currentUser?.current_store || currentUser?.store || '').trim();
                if (!my && currentUser?.username) {
                    try {
                        const emps = HRMS_STORE.getEmployees() || [];
                        const me = emps.find(e => String(e?.username || '').toLowerCase() === String(currentUser.username).toLowerCase());
                        if (me) my = String(me.store || '').trim();
                    } catch (e) {}
                }
                if (my) {
                    // 当前门店若不在选项中（门店列表尚未含该店），动态补一个，确保能选中
                    if (!Array.from(storeSel.options).some(o => o.value === my)) {
                        const opt = document.createElement('option');
                        opt.value = my; opt.textContent = my;
                        storeSel.appendChild(opt);
                    }
                    storeSel.value = my;
                }
                storeSel.disabled = true;
            }

            const status = String(document.getElementById('payment-filter-status')?.value || '').trim();
            const store = String(storeSel?.value || '').trim();
            const start = String(document.getElementById('payment-filter-start')?.value || '').trim();
            const end = String(document.getElementById('payment-filter-end')?.value || '').trim();

            box.innerHTML = '<div class="rep-pay-empty" style="margin-bottom:12px;">加载中…</div>';
            empty.style.display = 'none';
            if (stats) stats.textContent = '--';

            const role = String(currentUser?.role || '').trim();
            // 店长是本店请款的管理者（多由前厅经理发起、店长审批），应看本店「全部」请款单，
            // 而非仅自己创建的（view=created 会让接任店长看不到任何记录）。
            const view = (role === ROLES.ADMIN || role === ROLES.HQ_MANAGER || role === ROLES.CASHIER) ? 'all' : (role === ROLES.HR_MANAGER ? 'created' : (role === ROLES.STORE_MANAGER ? 'all' : (role === ROLES.FRONT_MANAGER ? 'created' : 'assigned')));
            const storeParam = role === ROLES.STORE_MANAGER ? String(currentUser?.current_store || currentUser?.store || '').trim() : store;
            console.log('[请款] loadPaymentData role=' + role + ' view=' + view + ' store=' + storeParam);

            HRMS_API.getApprovals({ view, status, type: 'payment', store: storeParam, limit: 200 })
                .then(resp => {
                    const items = Array.isArray(resp?.items) ? resp.items : [];
                    const list = items.filter(it => String(it?.type || '').trim() === 'payment');
                    __APPROVALS_CACHE = list;
                    const filtered = list.filter(it => {
                        const p = it?.payload && typeof it.payload === 'object' ? it.payload : {};
                        const st = String(it?.status || '').trim();
                        const dt = String(p?.date || it?.created_at || it?.createdAt || '').slice(0, 10);
                        const stMatch = !status || st === status;
                        const storeMatch = !store || String(p?.store || '').trim() === store;
                        const startOk = !start || (dt && dt >= start);
                        const endOk = !end || (dt && dt <= end);
                        return stMatch && storeMatch && startOk && endOk;
                    });

                    renderPaymentStats(filtered, stores);
                    renderPaymentList(filtered);
                })
                .catch(e => {
                    box.innerHTML = '';
                    empty.style.display = '';
                    showNotification('加载请款失败：' + String(e?.message || e), 'error');
                });
        }

        function renderPaymentStats(items, stores) {
            const statsEl = document.getElementById('payment-stats');
            if (!statsEl) return;
            const list = Array.isArray(items) ? items : [];
            const sum = list.reduce((acc, it) => {
                const p = it?.payload && typeof it.payload === 'object' ? it.payload : {};
                const amt = Number(p?.amount || 0);
                return acc + (Number.isFinite(amt) ? amt : 0);
            }, 0);
            const total = list.length;
            const pending = list.filter(x => String(x?.status || '') === 'pending').length;
            const approved = list.filter(x => String(x?.status || '') === 'approved').length;
            const paid = list.filter(x => String(x?.status || '') === 'paid').length;
            const sumFmt = Number(sum || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
            statsEl.innerHTML = `
                <div class="rep-grid">
                    <div class="rep-metric" onclick="filterPaymentByStatus('')"><div class="k">总数</div><div class="v">${total}</div></div>
                    <div class="rep-metric" onclick="filterPaymentByStatus('pending')"><div class="k">待审批</div><div class="v">${pending}</div></div>
                    <div class="rep-metric" onclick="filterPaymentByStatus('approved')"><div class="k">已审批</div><div class="v">${approved}</div></div>
                    <div class="rep-metric" onclick="filterPaymentByStatus('paid')"><div class="k">已付款</div><div class="v">${paid}</div></div>
                    <div class="rep-metric rep-metric--gold" style="grid-column:1/-1; cursor:default;"><div class="k">金额合计</div><div class="v">¥${sumFmt}</div></div>
                </div>`;
        }

        function filterPaymentByStatus(status) {
            const sel = document.getElementById('payment-filter-status');
            if (sel) sel.value = String(status || '');
            loadPaymentData();
        }

        function paymentStatusText(st) {
            const s = String(st || '').trim();
            if (s === 'pending') return '待审批';
            if (s === 'approved') return '已审批';
            if (s === 'paid') return '已付款';
            if (s === 'rejected') return '已拒绝';
            return s || '-';
        }

        function renderPaymentList(items) {
            const box = document.getElementById('payment-list');
            const empty = document.getElementById('payment-empty');
            if (!box || !empty) return;
            const list = Array.isArray(items) ? items : [];
            if (!list.length) {
                box.innerHTML = '';
                empty.style.display = '';
                return;
            }
            empty.style.display = 'none';
            box.innerHTML = list.map(it => {
                const id = String(it?.id || '').trim();
                const st = paymentStatusText(it?.status);
                const p = it?.payload && typeof it.payload === 'object' ? it.payload : {};
                const date = String(p?.date || it?.created_at || it?.createdAt || '').slice(0, 10);
                const store = String(p?.store || '').trim();
                const category = String(p?.category || '').trim();
                const urgency = String(p?.urgency || '').trim();
                const amt = Number(p?.amount || 0);
                const amountText = Number.isFinite(amt) ? ('¥' + amt.toLocaleString('zh-CN', { maximumFractionDigits: 2 })) : '¥0.00';
                const who = hrmsDisplayName(it?.applicant_username);

                const rawSt = String(it?.status || '').trim();
                const lineKey = ['pending', 'approved', 'paid', 'rejected'].includes(rawSt) ? rawSt : 'pending';
                const lineClass = 'pay-line-card--' + lineKey;

                const canPay = String(it?.type || '') === 'payment'
                    && String(it?.status || '') === 'approved'
                    && (String(currentUser?.role || '') === ROLES.CASHIER || String(currentUser?.role || '') === ROLES.HQ_MANAGER || String(currentUser?.role || '') === ROLES.HR_MANAGER || isAdminUser());
                const payBtn = canPay ? `<button class="btn" type="button" onclick="payPaymentById('${escapeHtml(id)}')" style="padding: 6px 10px; background: linear-gradient(135deg,#2563eb,#60a5fa); border:none;">付款</button>` : '';

                const metaBits = [];
                if (store) metaBits.push(store);
                if (who) metaBits.push(who);
                if (category) metaBits.push(category);
                if (urgency) metaBits.push('紧急 ' + urgency);
                const metaLine = metaBits.length ? metaBits.map(x => escapeHtml(String(x))).join(' · ') : '—';
                const payee = String(p?.payeeName || p?.payee || '').trim();
                const noteRaw = String(p?.note || p?.description || '').trim();
                const noteEsc = escapeHtml(noteRaw);
                const noteBlock = noteRaw
                    ? `<div class="rep-pay-card__note" title="${noteEsc}">说明：${noteEsc}</div>`
                    : '';
                const payeeBlock = payee
                    ? `<div class="rep-pay-card__extra"><strong>收款</strong> ${escapeHtml(payee)}</div>`
                    : '';

                return `<article class="rep-pay-card pay-line-card ${lineClass}">
                    <div class="rep-pay-card__top">
                        <div class="rep-pay-card__left">
                            <span class="pay-st-badge pay-st-badge--${lineKey}" aria-label="状态">${escapeHtml(st || '-')}</span>
                            <div class="rep-pay-card__titles">
                                <div class="rep-pay-card__name">请款 · ${escapeHtml(date || '-')}</div>
                                <div class="rep-pay-card__meta">${metaLine}</div>
                                ${noteBlock}
                            </div>
                        </div>
                        <div class="rep-pay-card__amt">${escapeHtml(amountText)}</div>
                    </div>
                    ${payeeBlock}
                    <div class="rep-pay-card__actions">
                        <button class="btn btn-secondary" type="button" onclick="openApprovalDetailModal('${escapeHtml(id)}')">查看</button>
                        ${payBtn}
                    </div>
                </article>`;
            }).join('');
        }

        function payPaymentById(id) {
            const key = String(id || '').trim();
            if (!key) return;
            const item = (__APPROVALS_CACHE || []).find(x => String(x?.id || '') === key) || null;
            if (!item) {
                showNotification('未找到该请款单', 'error');
                return;
            }
            __CURRENT_APPROVAL = item;
            payCurrentApproval();
        }

        function hrmsGetPaymentSettings() {
            try {
                const data = HRMS_STORE.ensure();
                const psRoot = data?.paymentSettings && typeof data.paymentSettings === 'object' ? data.paymentSettings : null;
                const settings = HRMS_STORE.getSettings ? HRMS_STORE.getSettings() : (data?.settings || {});
                const psLegacy = settings?.paymentSettings && typeof settings.paymentSettings === 'object' ? settings.paymentSettings : null;
                const ps = (psRoot || psLegacy || {});
                const categories = Array.isArray(ps.categories) ? ps.categories : [];
                const payees = Array.isArray(ps.payees) ? ps.payees : [];
                const urgencies = Array.isArray(ps.urgencies) ? ps.urgencies : ['低', '中', '高'];
                const primaryCategories = Array.isArray(ps.primaryCategories) ? ps.primaryCategories : [];
                const secondaryCategories = Array.isArray(ps.secondaryCategories) ? ps.secondaryCategories : [];
                const payeeDetails = Array.isArray(ps.payeeDetails) ? ps.payeeDetails : [];
                return { ...ps, categories, payees, urgencies, primaryCategories, secondaryCategories, payeeDetails };
            } catch (e) {
                return { categories: [], payees: [], urgencies: ['低', '中', '高'], primaryCategories: [], secondaryCategories: [], payeeDetails: [] };
            }
        }

        function openPaymentSettingsModal(tab) {
            if (!isAdminUser()) {
                showNotification('仅管理员可配置请款设置', 'warning');
                return;
            }
            const t = String(tab || '').trim();
            if (t === 'flow') return openPaymentFlowModal();
            if (t === 'basic') return openPaymentBasicModal();
            if (t === 'budget') return openPaymentBudgetModal();
            showNotification('未知设置项', 'info');
        }

        let __PAYMENT_BASIC_SETTINGS = null;
        let __PAYMENT_BUDGETS = null;

        function hrmsNormalizePaymentSettings(ps) {
            const v = ps && typeof ps === 'object' ? ps : {};
            const categories = Array.isArray(v.categories) ? v.categories : [];
            const payees = Array.isArray(v.payees) ? v.payees : [];
            const urgencies = Array.isArray(v.urgencies) ? v.urgencies : [];
            const payeeDetails = Array.isArray(v.payeeDetails) ? v.payeeDetails : [];
            const cleanList = (arr) => {
                const seen = new Set();
                const out = [];
                (arr || []).forEach(x => {
                    const s = String(x || '').trim();
                    const k = s.toLowerCase();
                    if (!s || seen.has(k)) return;
                    seen.add(k);
                    out.push(s);
                });
                return out;
            };
            const cleanPayeeDetails = (arr) => {
                const seen = new Set();
                const out = [];
                (arr || []).forEach(x => {
                    if (!x || typeof x !== 'object') return;
                    const name = String(x.name || '').trim();
                    if (!name) return;
                    const k = name.toLowerCase();
                    if (seen.has(k)) return;
                    seen.add(k);
                    out.push({ name, account: String(x.account || '').trim(), bank: String(x.bank || '').trim() });
                });
                return out;
            };
            const cleanSecondary = (arr) => {
                const seen = new Set();
                const out = [];
                (arr || []).forEach(x => {
                    if (!x || typeof x !== 'object') return;
                    const name = String(x.name || '').trim();
                    const primary = String(x.primary || '').trim();
                    if (!name) return;
                    const k = name.toLowerCase();
                    if (seen.has(k)) return;
                    seen.add(k);
                    out.push({ name, primary });
                });
                return out;
            };
            let primaryCategories = Array.isArray(v.primaryCategories) ? cleanList(v.primaryCategories) : [];
            let secondaryCategories = Array.isArray(v.secondaryCategories) ? cleanSecondary(v.secondaryCategories) : [];
            if (!primaryCategories.length && !secondaryCategories.length && categories.length) {
                primaryCategories = cleanList(categories);
            }
            return {
                categories: cleanList(categories),
                primaryCategories,
                secondaryCategories,
                payees: cleanList(payees),
                payeeDetails: cleanPayeeDetails(payeeDetails),
                urgencies: cleanList(urgencies.length ? urgencies : ['低', '中', '高'])
            };
        }

        function hrmsNormalizePaymentBudgets(list) {
            const arr = Array.isArray(list) ? list : [];
            const out = [];
            const seen = new Set();
            arr.forEach(x => {
                const store = String(x?.store || '').trim();
                const month = String(x?.month || '').trim();
                const category = String(x?.category || '').trim();
                const amount = Number(x?.amount);
                if (!store || !month || !category) return;
                if (!Number.isFinite(amount) || amount < 0) return;
                const key = `${store}__${month}__${category}`.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                out.push({ store, month, category, amount });
            });
            return out;
        }

        async function hrmsFetchPaymentSettingsAndBudgets() {
            const token = HRMS_API.token();
            if (!token) return { paymentSettings: hrmsNormalizePaymentSettings(null), paymentBudgets: [] };
            try {
                const cfg = await HRMS_API.request('/api/payment-config', { method: 'GET' });
                return {
                    paymentSettings: hrmsNormalizePaymentSettings(cfg?.paymentSettings),
                    paymentBudgets: hrmsNormalizePaymentBudgets(cfg?.paymentBudgets)
                };
            } catch (e) {
                // 兼容旧部署：窄 API 未上线时回退 GET /api/state
                const st = await HRMS_API.getState();
                const data = st?.data && typeof st.data === 'object' ? st.data : (st || {});
                return {
                    paymentSettings: hrmsNormalizePaymentSettings(data?.paymentSettings),
                    paymentBudgets: hrmsNormalizePaymentBudgets(data?.paymentBudgets)
                };
            }
        }

        async function hrmsSavePaymentSettingsAndBudgets(nextSettings, nextBudgets) {
            const token = HRMS_API.token();
            if (!token) throw new Error('未登录');
            const paymentSettings = hrmsNormalizePaymentSettings(nextSettings);
            const paymentBudgets = hrmsNormalizePaymentBudgets(nextBudgets);
            const resp = await HRMS_API.request('/api/payment-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentSettings, paymentBudgets })
            });
            try {
                const local = HRMS_STORE.ensure();
                local.paymentSettings = resp?.paymentSettings || paymentSettings;
                local.paymentBudgets = resp?.paymentBudgets || paymentBudgets;
                HRMS_STORE.set(local);
            } catch (e) {}
            return true;
        }

        function renderPaymentSettingTags(containerId, items, type) {
            const box = document.getElementById(containerId);
            if (!box) return;
            const list = Array.isArray(items) ? items : [];
            if (!list.length) {
                box.innerHTML = '<div style="color:#777; font-size: 12px;">暂无</div>';
                return;
            }
            box.innerHTML = list.map((x, idx) => {
                const label = escapeHtml(String(x || '').trim());
                return `<span style="display:inline-flex; align-items:center; gap: 8px; padding: 8px 10px; border-radius: 999px; margin: 0 8px 8px 0; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.04);">
                    <span style="font-weight: 800;">${label}</span>
                    <button class="btn btn-secondary" type="button" onclick="removePaymentSettingItem('${String(type || '').replace(/'/g, "\\'")}', ${idx})" style="padding: 4px 8px; border-radius: 999px;">删除</button>
                </span>`;
            }).join('');
        }

        async function openPaymentBasicModal() {
            if (!isAdminUser()) return;
            const modal = document.getElementById('payment-basic-modal');
            if (!modal) return;
            const statusEl = document.getElementById('payment-basic-modal-status');
            if (statusEl) statusEl.textContent = '加载中...';

            try {
                const fetched = await hrmsFetchPaymentSettingsAndBudgets();
                __PAYMENT_BASIC_SETTINGS = fetched.paymentSettings;
                __PAYMENT_BUDGETS = fetched.paymentBudgets;
            } catch (e) {
                __PAYMENT_BASIC_SETTINGS = hrmsNormalizePaymentSettings(null);
            }

            renderPrimaryCategories();
            renderSecondaryCategories();
            refreshSecondaryPrimarySelect();
            renderPaymentSettingTags('pbs-urgencies', __PAYMENT_BASIC_SETTINGS?.urgencies, 'urgencies');
            renderPaymentPayeeDetails();

            if (statusEl) statusEl.textContent = '';
            try { setPaymentBasicTab('subjects'); } catch (e) {}
            modal.classList.add('show');
        }

        function closePaymentBasicModal() {
            const modal = document.getElementById('payment-basic-modal');
            if (modal) modal.classList.remove('show');
        }

        function renderPrimaryCategories() {
            const box = document.getElementById('pbs-primary-categories');
            if (!box) return;
            const list = Array.isArray(__PAYMENT_BASIC_SETTINGS?.primaryCategories) ? __PAYMENT_BASIC_SETTINGS.primaryCategories : [];
            if (!list.length) { box.innerHTML = '<div style="color:rgba(200,215,230,0.5); font-size: 12px;">暂无一级科目</div>'; return; }
            box.innerHTML = list.map((x, idx) => {
                const label = escapeHtml(String(x || ''));
                const secCount = (Array.isArray(__PAYMENT_BASIC_SETTINGS?.secondaryCategories) ? __PAYMENT_BASIC_SETTINGS.secondaryCategories : []).filter(s => String(s?.primary || '').toLowerCase() === String(x || '').toLowerCase()).length;
                return `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius:10px; margin-bottom:6px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03);">
                    <div style="min-width:0; flex:1;">
                        <span style="font-weight:800; font-size:13px;">${label}</span>
                        <span style="font-size:11px; color:rgba(200,215,230,0.6); margin-left:6px;">${secCount}个二级</span>
                    </div>
                    <button class="btn btn-secondary" type="button" onclick="removePrimaryCategory(${idx})" style="padding:4px 8px; border-radius:8px; font-size:11px;">删除</button>
                </div>`;
            }).join('');
        }

        function renderSecondaryCategories() {
            const box = document.getElementById('pbs-secondary-categories');
            if (!box) return;
            const list = Array.isArray(__PAYMENT_BASIC_SETTINGS?.secondaryCategories) ? __PAYMENT_BASIC_SETTINGS.secondaryCategories : [];
            if (!list.length) { box.innerHTML = '<div style="color:rgba(200,215,230,0.5); font-size: 12px;">暂无二级科目</div>'; return; }
            box.innerHTML = list.map((x, idx) => {
                const name = escapeHtml(String(x?.name || ''));
                const primary = escapeHtml(String(x?.primary || ''));
                return `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-radius:10px; margin-bottom:6px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03);">
                    <div style="min-width:0; flex:1;">
                        <span style="font-weight:800; font-size:13px;">${name}</span>
                        ${primary ? `<span style="font-size:11px; color:rgba(96,165,250,0.8); margin-left:6px;">← ${primary}</span>` : '<span style="font-size:11px; color:rgba(239,68,68,0.7); margin-left:6px;">未归属</span>'}
                    </div>
                    <button class="btn btn-secondary" type="button" onclick="removeSecondaryCategory(${idx})" style="padding:4px 8px; border-radius:8px; font-size:11px;">删除</button>
                </div>`;
            }).join('');
        }

        function refreshSecondaryPrimarySelect() {
            const sel = document.getElementById('pbs-secondary-primary-select');
            if (!sel) return;
            const list = Array.isArray(__PAYMENT_BASIC_SETTINGS?.primaryCategories) ? __PAYMENT_BASIC_SETTINGS.primaryCategories : [];
            sel.innerHTML = '<option value="">归属一级科目</option>' + list.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
        }

        function addPrimaryCategory() {
            if (!__PAYMENT_BASIC_SETTINGS) __PAYMENT_BASIC_SETTINGS = hrmsNormalizePaymentSettings(null);
            const el = document.getElementById('pbs-primary-input');
            const v = String(el?.value || '').trim();
            if (!v) { showNotification('请输入一级科目名称', 'warning'); return; }
            const arr = Array.isArray(__PAYMENT_BASIC_SETTINGS.primaryCategories) ? __PAYMENT_BASIC_SETTINGS.primaryCategories.slice() : [];
            if (arr.some(x => String(x || '').toLowerCase() === v.toLowerCase())) { showNotification('该一级科目已存在', 'info'); return; }
            arr.push(v);
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, primaryCategories: arr };
            if (el) el.value = '';
            renderPrimaryCategories();
            refreshSecondaryPrimarySelect();
        }

        function removePrimaryCategory(idx) {
            if (!__PAYMENT_BASIC_SETTINGS) return;
            const arr = Array.isArray(__PAYMENT_BASIC_SETTINGS.primaryCategories) ? __PAYMENT_BASIC_SETTINGS.primaryCategories.slice() : [];
            if (idx < 0 || idx >= arr.length) return;
            const removed = arr[idx];
            arr.splice(idx, 1);
            const sec = Array.isArray(__PAYMENT_BASIC_SETTINGS.secondaryCategories) ? __PAYMENT_BASIC_SETTINGS.secondaryCategories.map(s => {
                if (String(s?.primary || '').toLowerCase() === String(removed || '').toLowerCase()) return { ...s, primary: '' };
                return s;
            }) : [];
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, primaryCategories: arr, secondaryCategories: sec };
            renderPrimaryCategories();
            renderSecondaryCategories();
            refreshSecondaryPrimarySelect();
        }

        function addSecondaryCategory() {
            if (!__PAYMENT_BASIC_SETTINGS) __PAYMENT_BASIC_SETTINGS = hrmsNormalizePaymentSettings(null);
            const nameEl = document.getElementById('pbs-secondary-input');
            const primaryEl = document.getElementById('pbs-secondary-primary-select');
            const name = String(nameEl?.value || '').trim();
            const primary = String(primaryEl?.value || '').trim();
            if (!name) { showNotification('请输入二级科目名称', 'warning'); return; }
            if (!primary) { showNotification('请选择归属的一级科目', 'warning'); return; }
            const arr = Array.isArray(__PAYMENT_BASIC_SETTINGS.secondaryCategories) ? __PAYMENT_BASIC_SETTINGS.secondaryCategories.slice() : [];
            if (arr.some(x => String(x?.name || '').toLowerCase() === name.toLowerCase())) { showNotification('该二级科目已存在', 'info'); return; }
            arr.push({ name, primary });
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, secondaryCategories: arr };
            if (nameEl) nameEl.value = '';
            renderSecondaryCategories();
            renderPrimaryCategories();
        }

        function removeSecondaryCategory(idx) {
            if (!__PAYMENT_BASIC_SETTINGS) return;
            const arr = Array.isArray(__PAYMENT_BASIC_SETTINGS.secondaryCategories) ? __PAYMENT_BASIC_SETTINGS.secondaryCategories.slice() : [];
            if (idx < 0 || idx >= arr.length) return;
            arr.splice(idx, 1);
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, secondaryCategories: arr };
            renderSecondaryCategories();
            renderPrimaryCategories();
        }

        function addPaymentSettingItem(type) {
            const t = String(type || '').trim();
            if (!__PAYMENT_BASIC_SETTINGS) __PAYMENT_BASIC_SETTINGS = hrmsNormalizePaymentSettings(null);
            let inputId = '';
            let listKey = '';
            let containerId = '';
            if (t === 'urgencies') { inputId = 'pbs-urgency-input'; listKey = 'urgencies'; containerId = 'pbs-urgencies'; }
            else return;

            const el = document.getElementById(inputId);
            const v = String(el?.value || '').trim();
            if (!v) {
                showNotification('请输入内容', 'warning');
                return;
            }
            const arr = Array.isArray(__PAYMENT_BASIC_SETTINGS[listKey]) ? __PAYMENT_BASIC_SETTINGS[listKey].slice() : [];
            if (arr.some(x => String(x || '').trim().toLowerCase() === v.toLowerCase())) {
                showNotification('已存在', 'info');
                return;
            }
            arr.push(v);
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, [listKey]: arr };
            if (el) el.value = '';
            renderPaymentSettingTags(containerId, arr, listKey);
        }

        function removePaymentSettingItem(type, idx) {
            const t = String(type || '').trim();
            if (!__PAYMENT_BASIC_SETTINGS) return;
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) return;
            const arr = Array.isArray(__PAYMENT_BASIC_SETTINGS[t]) ? __PAYMENT_BASIC_SETTINGS[t].slice() : [];
            if (i >= arr.length) return;
            arr.splice(i, 1);
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, [t]: arr };

            if (t === 'urgencies') renderPaymentSettingTags('pbs-urgencies', arr, 'urgencies');
        }

        function addPaymentPayeeDetail() {
            if (!__PAYMENT_BASIC_SETTINGS) __PAYMENT_BASIC_SETTINGS = hrmsNormalizePaymentSettings(null);
            const nameEl = document.getElementById('pbs-payee-input');
            const acctEl = document.getElementById('pbs-payee-account-input');
            const bankEl = document.getElementById('pbs-payee-bank-input');
            const name = String(nameEl?.value || '').trim();
            const account = String(acctEl?.value || '').trim();
            const bank = String(bankEl?.value || '').trim();
            if (!name) { showNotification('请输入收款户名', 'warning'); return; }
            const details = Array.isArray(__PAYMENT_BASIC_SETTINGS.payeeDetails) ? __PAYMENT_BASIC_SETTINGS.payeeDetails.slice() : [];
            if (details.some(d => String(d?.name || '').trim().toLowerCase() === name.toLowerCase())) {
                showNotification('该付款对象已存在', 'info'); return;
            }
            details.push({ name, account, bank });
            const payees = Array.isArray(__PAYMENT_BASIC_SETTINGS.payees) ? __PAYMENT_BASIC_SETTINGS.payees.slice() : [];
            if (!payees.some(p => String(p || '').trim().toLowerCase() === name.toLowerCase())) {
                payees.push(name);
            }
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, payees, payeeDetails: details };
            if (nameEl) nameEl.value = '';
            if (acctEl) acctEl.value = '';
            if (bankEl) bankEl.value = '';
            renderPaymentSettingTags('pbs-payees', payees, 'payees');
            renderPaymentPayeeDetails();
        }

        function removePaymentPayeeDetail(idx) {
            if (!__PAYMENT_BASIC_SETTINGS) return;
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) return;
            const details = Array.isArray(__PAYMENT_BASIC_SETTINGS.payeeDetails) ? __PAYMENT_BASIC_SETTINGS.payeeDetails.slice() : [];
            if (i >= details.length) return;
            const removedName = String(details[i]?.name || '').trim();
            details.splice(i, 1);
            const payees = Array.isArray(__PAYMENT_BASIC_SETTINGS.payees) ? __PAYMENT_BASIC_SETTINGS.payees.filter(p => String(p || '').trim().toLowerCase() !== removedName.toLowerCase()) : [];
            __PAYMENT_BASIC_SETTINGS = { ...__PAYMENT_BASIC_SETTINGS, payees, payeeDetails: details };
            renderPaymentSettingTags('pbs-payees', payees, 'payees');
            renderPaymentPayeeDetails();
        }

        function renderPaymentPayeeDetails() {
            const box = document.getElementById('pbs-payee-details');
            if (!box) return;
            const details = Array.isArray(__PAYMENT_BASIC_SETTINGS?.payeeDetails) ? __PAYMENT_BASIC_SETTINGS.payeeDetails : [];
            if (!details.length) { box.innerHTML = ''; return; }
            box.innerHTML = details.map((d, idx) => {
                const n = escapeHtml(String(d?.name || ''));
                const a = escapeHtml(String(d?.account || ''));
                const b = escapeHtml(String(d?.bank || ''));
                return `<div style="display:flex; align-items:center; gap: 10px; padding: 10px 12px; border-radius: 12px; margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight: 700; font-size: 13px;">${n}</div>
                        ${a ? `<div style="font-size: 11px; color: rgba(200,215,230,0.7); margin-top: 2px;">账号: ${a}</div>` : ''}
                        ${b ? `<div style="font-size: 11px; color: rgba(200,215,230,0.7); margin-top: 1px;">开户行: ${b}</div>` : ''}
                    </div>
                    <button class="btn btn-secondary" type="button" onclick="removePaymentPayeeDetail(${idx})" style="padding: 4px 10px; border-radius: 8px; font-size: 11px;">删除</button>
                </div>`;
            }).join('');
        }

        function savePaymentBasicModal() {
            if (!isAdminUser()) return;
            const statusEl = document.getElementById('payment-basic-modal-status');
            const nextSettings = hrmsNormalizePaymentSettings(__PAYMENT_BASIC_SETTINGS);
            const nextBudgets = hrmsNormalizePaymentBudgets(__PAYMENT_BUDGETS);
            (async () => {
                try {
                    if (statusEl) statusEl.textContent = '保存中...';
                    await hrmsSavePaymentSettingsAndBudgets(nextSettings, nextBudgets);
                    __PAYMENT_BASIC_SETTINGS = nextSettings;
                    showNotification('已保存基础配置', 'success');
                    if (statusEl) statusEl.textContent = '已保存';
                    try { populatePaymentFormOptions(); } catch (e) {}
                    closePaymentBasicModal();
                } catch (e) {
                    const msg = String(e?.message || e);
                    if (statusEl) statusEl.textContent = '保存失败：' + msg;
                    showNotification('保存失败：' + msg, 'error');
                }
            })();
        }

        async function openPaymentBudgetModal() {
            if (!isAdminUser()) return;
            const modal = document.getElementById('payment-budget-modal');
            if (!modal) return;
            const statusEl = document.getElementById('payment-budget-modal-status');
            if (statusEl) statusEl.textContent = '加载中...';

            try {
                const fetched = await hrmsFetchPaymentSettingsAndBudgets();
                __PAYMENT_BASIC_SETTINGS = fetched.paymentSettings;
                __PAYMENT_BUDGETS = fetched.paymentBudgets;
            } catch (e) {
                if (!__PAYMENT_BASIC_SETTINGS) __PAYMENT_BASIC_SETTINGS = hrmsNormalizePaymentSettings(null);
                if (!__PAYMENT_BUDGETS) __PAYMENT_BUDGETS = [];
            }

            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            const storeNames = stores.map(s => String(s?.name || s?.id || '').trim()).filter(Boolean);
            const storeSel = document.getElementById('pb-store');
            const storeFilter = document.getElementById('pb-filter-store');
            const monthEl = document.getElementById('pb-month');
            const monthFilter = document.getElementById('pb-filter-month');
            const catSel = document.getElementById('pb-category');

            const storeOpts = storeNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
            if (storeSel) storeSel.innerHTML = storeOpts;
            if (storeFilter) storeFilter.innerHTML = ['<option value="">全部门店</option>'].concat(storeNames.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)).join('');

            const primaryCats = Array.isArray(__PAYMENT_BASIC_SETTINGS?.primaryCategories) ? __PAYMENT_BASIC_SETTINGS.primaryCategories : [];
            const fallbackCats = primaryCats.length ? primaryCats : (Array.isArray(__PAYMENT_BASIC_SETTINGS?.categories) ? __PAYMENT_BASIC_SETTINGS.categories : []);
            const catOpts = ['<option value="">请选择一级科目</option>'].concat(fallbackCats.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)).join('');
            if (catSel) catSel.innerHTML = catOpts;

            try {
                const now = new Date();
                const ym = now.toISOString().slice(0, 7);
                if (monthEl && !String(monthEl.value || '').trim()) monthEl.value = ym;
                if (monthFilter && !String(monthFilter.value || '').trim()) monthFilter.value = ym;
            } catch (e) {}

            renderPaymentBudgetTable();
            if (statusEl) statusEl.textContent = '';
            modal.classList.add('show');
        }

        function closePaymentBudgetModal() {
            const modal = document.getElementById('payment-budget-modal');
            if (modal) modal.classList.remove('show');
        }

        function upsertPaymentBudget() {
            if (!isAdminUser()) return;
            if (!__PAYMENT_BUDGETS) __PAYMENT_BUDGETS = [];
            const store = String(document.getElementById('pb-store')?.value || '').trim();
            const month = String(document.getElementById('pb-month')?.value || '').trim();
            const category = String(document.getElementById('pb-category')?.value || '').trim();
            const amountRaw = Number(document.getElementById('pb-amount')?.value || '');
            const amount = Number.isFinite(amountRaw) ? amountRaw : null;
            if (!store) return showNotification('请选择门店', 'warning');
            if (!month) return showNotification('请选择月份', 'warning');
            if (!category) return showNotification('请选择项目', 'warning');
            if (amount == null || amount < 0) return showNotification('请输入预算金额', 'warning');

            const key = `${store}__${month}__${category}`.toLowerCase();
            const next = hrmsNormalizePaymentBudgets(__PAYMENT_BUDGETS).slice();
            const idx = next.findIndex(x => `${x.store}__${x.month}__${x.category}`.toLowerCase() === key);
            const row = { store, month, category, amount };
            if (idx >= 0) next[idx] = row;
            else next.push(row);
            __PAYMENT_BUDGETS = next;

            try {
                const amtEl = document.getElementById('pb-amount');
                if (amtEl) amtEl.value = '';
            } catch (e) {}
            renderPaymentBudgetTable();
        }

        function removePaymentBudgetRow(store, month, category) {
            if (!isAdminUser()) return;
            if (!__PAYMENT_BUDGETS) __PAYMENT_BUDGETS = [];
            const s = String(store || '').trim();
            const m = String(month || '').trim();
            const c = String(category || '').trim();
            const key = `${s}__${m}__${c}`.toLowerCase();
            __PAYMENT_BUDGETS = hrmsNormalizePaymentBudgets(__PAYMENT_BUDGETS).filter(x => `${x.store}__${x.month}__${x.category}`.toLowerCase() !== key);
            renderPaymentBudgetTable();
        }

        function renderPaymentBudgetTable() {
            const box = document.getElementById('pb-table');
            const empty = document.getElementById('pb-empty');
            if (!box || !empty) return;
            const list = hrmsNormalizePaymentBudgets(__PAYMENT_BUDGETS);
            const fStore = String(document.getElementById('pb-filter-store')?.value || '').trim();
            const fMonth = String(document.getElementById('pb-filter-month')?.value || '').trim();
            const filtered = list.filter(x => {
                if (fStore && String(x.store || '') !== fStore) return false;
                if (fMonth && String(x.month || '') !== fMonth) return false;
                return true;
            }).sort((a, b) => {
                const k1 = `${a.month}__${a.store}__${a.category}`;
                const k2 = `${b.month}__${b.store}__${b.category}`;
                return String(k2).localeCompare(String(k1), 'zh-Hans-CN');
            });

            if (!filtered.length) {
                box.innerHTML = '';
                empty.style.display = '';
                return;
            }
            empty.style.display = 'none';
            box.innerHTML = `<div style="overflow-x:auto;">
                <table style="width:100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="text-align:left; color: rgba(200,215,230,0.9);">
                            <th style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.08);">门店</th>
                            <th style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.08);">月份</th>
                            <th style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.08);">项目</th>
                            <th style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.08);">预算金额</th>
                            <th style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); width: 120px;">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map(r => {
                            const s0 = String(r.store || '').trim();
                            const m0 = String(r.month || '').trim();
                            const c0 = String(r.category || '').trim();
                            const s = escapeHtml(s0);
                            const m = escapeHtml(m0);
                            const c = escapeHtml(c0);
                            const sJs = s0.replace(/'/g, "\\'");
                            const mJs = m0.replace(/'/g, "\\'");
                            const cJs = c0.replace(/'/g, "\\'");
                            const amt = Number(r.amount || 0);
                            const amtText = Number.isFinite(amt) ? amt.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '0.00';
                            return `<tr>
                                <td style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); color: rgba(226,232,240,0.95); font-weight: 800;">${s}</td>
                                <td style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); color: rgba(226,232,240,0.9);">${m}</td>
                                <td style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); color: rgba(226,232,240,0.9);">${c}</td>
                                <td style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); color: rgba(59,130,246,0.95); font-weight: 900;">¥${amtText}</td>
                                <td style="padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                                    <button class="btn btn-secondary" type="button" onclick="removePaymentBudgetRow('${sJs}','${mJs}','${cJs}')" style="padding: 8px 12px;">删除</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        function savePaymentBudgetModal() {
            if (!isAdminUser()) return;
            const statusEl = document.getElementById('payment-budget-modal-status');
            const nextSettings = hrmsNormalizePaymentSettings(__PAYMENT_BASIC_SETTINGS);
            const nextBudgets = hrmsNormalizePaymentBudgets(__PAYMENT_BUDGETS);
            (async () => {
                try {
                    if (statusEl) statusEl.textContent = '保存中...';
                    await hrmsSavePaymentSettingsAndBudgets(nextSettings, nextBudgets);
                    __PAYMENT_BUDGETS = nextBudgets;
                    showNotification('已保存预算配置', 'success');
                    if (statusEl) statusEl.textContent = '已保存';
                    closePaymentBudgetModal();
                } catch (e) {
                    const msg = String(e?.message || e);
                    if (statusEl) statusEl.textContent = '保存失败：' + msg;
                    showNotification('保存失败：' + msg, 'error');
                }
            })();
        }

        let __PAYMENT_FLOW_MAP = null;

        async function hrmsFetchPaymentFlowMap() {
            const token = HRMS_API.token();
            if (!token) return {};
            try {
                const resp = await HRMS_API.getApprovalFlows();
                const map = resp?.paymentFlowByStore;
                if (map && typeof map === 'object') return map;
            } catch (e) { /* fallback getState */ }
            const st = await HRMS_API.getState();
            const data = st?.data && typeof st.data === 'object' ? st.data : (st || {});
            const map = data?.paymentFlowByStore;
            return map && typeof map === 'object' ? map : {};
        }

        async function hrmsSavePaymentFlowMap(nextMap) {
            const token = HRMS_API.token();
            if (!token) throw new Error('未登录');
            // 走专用原子接口，避免全量 PUT /api/state 把分店付款链被陈旧浏览器覆盖
            const r = await fetch('/api/approval-flows', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ paymentFlowByStore: nextMap && typeof nextMap === 'object' ? nextMap : {} })
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return true;
        }

        let _pfApprovers = [];
        let _pfUserList = [];

        function pfBuildUserList() {
            const emps = (HRMS_STORE.getEmployees ? (HRMS_STORE.getEmployees() || []) : []) || [];
            const users = (HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : []) || [];
            const all = emps.concat(users);
            const uniq = new Map();
            all.forEach(u => {
                const uname = String(u?.username || '').trim();
                if (!uname) return;
                if (uniq.has(uname)) return;
                uniq.set(uname, u);
            });
            _pfUserList = Array.from(uniq.values()).sort((a, b) => {
                const na = String(a?.name || a?.username || '').trim();
                const nb = String(b?.name || b?.username || '').trim();
                return na.localeCompare(nb);
            });
        }

        function pfUserDisplayName(username) {
            const u = String(username || '').trim();
            if (!u) return '-';
            const found = _pfUserList.find(x => String(x?.username || '').trim() === u);
            if (found) {
                const name = String(found.name || '').trim();
                if (name) return name;
            }
            return hrmsDisplayName(u);
        }

        async function openPaymentFlowModal() {
            if (!isAdminUser()) return;
            const modal = document.getElementById('payment-flow-modal');
            if (!modal) return;
            const statusEl = document.getElementById('payment-flow-modal-status');
            if (statusEl) statusEl.textContent = '加载中...';

            try {
                __PAYMENT_FLOW_MAP = await hrmsFetchPaymentFlowMap();
            } catch (e) {
                __PAYMENT_FLOW_MAP = {};
            }

            pfBuildUserList();

            const storeSel = document.getElementById('pf-store');
            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            if (storeSel) {
                storeSel.innerHTML = stores.map(s => {
                    const name = String(s?.name || s?.id || '').trim();
                    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
                }).join('');
            }

            pfPopulateCashierSelect();
            pfPopulateApproverSelect();
            renderPaymentFlowModal();
            if (statusEl) statusEl.textContent = '';
            modal.classList.add('show');
        }

        function pfPopulateCashierSelect() {
            const cashierSel = document.getElementById('pf-cashier');
            if (!cashierSel) return;
            cashierSel.innerHTML = ['<option value="">（不限制）</option>']
                .concat(_pfUserList.map(u => {
                    const uname = String(u?.username || '').trim();
                    const displayName = String(u?.name || '').trim() || uname;
                    return `<option value="${escapeHtml(uname)}">${escapeHtml(displayName)}</option>`;
                }))
                .join('');
        }

        function pfPopulateApproverSelect() {
            const sel = document.getElementById('pf-approvers-select');
            if (!sel) return;
            sel.innerHTML = ['<option value="">+ 添加审批人</option>']
                .concat(_pfUserList.map(u => {
                    const uname = String(u?.username || '').trim();
                    const displayName = String(u?.name || '').trim() || uname;
                    return `<option value="${escapeHtml(uname)}">${escapeHtml(displayName)}</option>`;
                }))
                .join('');
        }

        function pfAddApprover(selectEl) {
            const val = String(selectEl?.value || '').trim();
            if (!val) return;
            selectEl.value = '';
            if (_pfApprovers.includes(val)) return;
            _pfApprovers.push(val);
            pfRenderApproverTags();
        }

        function pfRemoveApprover(username) {
            _pfApprovers = _pfApprovers.filter(u => u !== username);
            pfRenderApproverTags();
        }

        function pfRenderApproverTags() {
            const box = document.getElementById('pf-approvers-tags');
            if (!box) return;
            if (!_pfApprovers.length) {
                box.innerHTML = '<span style="color:rgba(200,215,230,0.5); font-size:13px;">暂未添加审批人</span>';
                return;
            }
            box.innerHTML = _pfApprovers.map((u, idx) => {
                const displayName = pfUserDisplayName(u);
                return `<span style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:8px; background:rgba(59,130,246,0.15); color:rgba(226,232,240,0.95); font-size:13px; font-weight:700;">
                    <span style="color:rgba(200,215,230,0.6); font-size:11px; margin-right:2px;">${idx + 1}.</span>
                    ${escapeHtml(displayName)}
                    <button type="button" onclick="pfRemoveApprover('${escapeHtml(u)}')" style="background:none; border:none; color:rgba(239,68,68,0.8); cursor:pointer; font-size:14px; padding:0 2px; line-height:1;">×</button>
                </span>`;
            }).join('');
        }

        function closePaymentFlowModal() {
            const modal = document.getElementById('payment-flow-modal');
            if (modal) modal.classList.remove('show');
        }

        function renderPaymentFlowModal() {
            const store = String(document.getElementById('pf-store')?.value || '').trim();
            const cfg = (__PAYMENT_FLOW_MAP && store) ? (__PAYMENT_FLOW_MAP[store] || {}) : {};

            _pfApprovers = Array.isArray(cfg?.approvers) ? cfg.approvers.map(x => String(x || '').trim()).filter(Boolean) : [];
            pfRenderApproverTags();

            const cashierEl = document.getElementById('pf-cashier');
            if (cashierEl) {
                cashierEl.value = String(cfg?.cashier || '').trim();
            }
        }

        function savePaymentFlowModal() {
            if (!isAdminUser()) return;
            const store = String(document.getElementById('pf-store')?.value || '').trim();
            if (!store) {
                showNotification('请选择门店', 'warning');
                return;
            }
            const statusEl = document.getElementById('payment-flow-modal-status');
            const cashier = String(document.getElementById('pf-cashier')?.value || '').trim();
            const approvers = _pfApprovers.filter(Boolean);

            const next = { ...(__PAYMENT_FLOW_MAP && typeof __PAYMENT_FLOW_MAP === 'object' ? __PAYMENT_FLOW_MAP : {}) };
            next[store] = { approvers, cashier };

            (async () => {
                try {
                    if (statusEl) statusEl.textContent = '保存中...';
                    await hrmsSavePaymentFlowMap(next);
                    __PAYMENT_FLOW_MAP = next;
                    if (statusEl) statusEl.textContent = '已保存';
                    showNotification('已保存请款流程配置', 'success');
                    closePaymentFlowModal();
                } catch (e) {
                    const msg = String(e?.message || e);
                    if (statusEl) statusEl.textContent = '保存失败：' + msg;
                    showNotification('保存失败：' + msg, 'error');
                }
            })();
        }

        function exportPaymentsCsv() {
            if (!isAdminUser()) return;
            const start = String(document.getElementById('payment-export-start')?.value || '').trim();
            const end = String(document.getElementById('payment-export-end')?.value || '').trim();
            if (!start || !end) {
                showNotification('请选择导出日期范围', 'warning');
                return;
            }
            const base = HRMS_API.baseUrl() || '';
            const token = HRMS_API.token();
            const url = base + '/api/payments/export?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);
            fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
                .then(async (resp) => {
                    if (!resp.ok) {
                        const text = await resp.text();
                        throw new Error(String(text || resp.statusText || resp.status));
                    }
                    const blob = await resp.blob();
                    const a = document.createElement('a');
                    const href = URL.createObjectURL(blob);
                    a.href = href;
                    a.download = `payments_${start}_${end}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        try { URL.revokeObjectURL(href); } catch (e) {}
                        try { a.remove(); } catch (e) {}
                    }, 500);
                    showNotification('已开始下载', 'success');
                })
                .catch(e => {
                    showNotification('导出失败：' + String(e?.message || e), 'error');
                });
        }

        let __paymentSubmitting = false;
        function submitPaymentForm() {
            if (!hrmsCanCreatePayments(currentUser?.role)) return;
            if (__paymentSubmitting) {
                showNotification('正在提交，请稍候…', 'warning');
                return;
            }
            const date = String(document.getElementById('pay-form-date')?.value || '').trim();
            const amountRaw = Number(document.getElementById('pay-form-amount')?.value || '');
            const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;
            const store = String(document.getElementById('pay-form-store')?.value || '').trim();
            const category = String(document.getElementById('pay-form-category')?.value || '').trim();
            const payee = String(document.getElementById('pay-form-payee')?.value || '').trim();
            const payeeName = String(document.getElementById('pay-form-payee-name')?.value || '').trim();
            const payeeAccount = String(document.getElementById('pay-form-payee-account')?.value || '').trim();
            const payeeBank = String(document.getElementById('pay-form-payee-bank')?.value || '').trim();
            const urgency = String(document.getElementById('pay-form-urgency')?.value || '').trim();
            const note = String(document.getElementById('pay-form-note')?.value || '').trim();

            if (!date) {
                showNotification('请选择请款日期', 'warning');
                return;
            }
            if (amount == null) {
                showNotification('请输入请款金额', 'warning');
                return;
            }
            if (!store) {
                showNotification('请选择所属门店', 'warning');
                return;
            }
            if (!category) {
                showNotification('请选择请款项目', 'warning');
                return;
            }

            __paymentSubmitting = true;
            const paySubmitBtn = document.querySelector('#payment-create-view button[onclick="submitPaymentForm()"]');
            try { if (paySubmitBtn) paySubmitBtn.disabled = true; } catch (e0) {}

            HRMS_API.createApproval('payment', { date, amount, store, category, payee, payeeName, payeeAccount, payeeBank, urgency, note })
                .then(() => {
                    showNotification('请款单已提交', 'success');
                    closePaymentCreate();
                    loadPaymentData();
                    showPage('payment');
                })
                .catch(e => {
                    const raw = String(e?.message || e);
                    const friendlyMap = {
                        'duplicate_pending': '已存在内容相同的待审批请款单，请勿重复提交；如需修改请先联系审批人退回或处理完上一笔',
                        'missing_store': '请选择所属门店',
                        'missing_date': '请选择请款日期',
                        'missing_amount': '请输入请款金额',
                        'missing_category': '请选择请款项目',
                        'missing_assignee': '未找到审批人，请联系管理员配置审批流程',
                        'forbidden': '您没有提交请款单的权限'
                    };
                    const key = Object.keys(friendlyMap).find(k => raw.includes(k));
                    const msg = key ? friendlyMap[key] : raw;
                    showNotification('提交失败：' + msg, 'error');
                })
                .finally(() => {
                    __paymentSubmitting = false;
                    try { if (paySubmitBtn) paySubmitBtn.disabled = false; } catch (e1) {}
                });
        }

        function markDashboardNotificationRead(notificationId) {
            const id = String(notificationId || '').trim();
            if (!id) return;
            try {
                const notifs = HRMS_STORE.getNotifications ? (HRMS_STORE.getNotifications() || []) : [];
                const idx = notifs.findIndex(n => String(n?.id || '').trim() === id);
                if (idx >= 0) {
                    notifs[idx] = { ...(notifs[idx] || {}), read: true, readAt: hrmsNowISO(), readBy: String(currentUser?.username || currentUser?.id || '') };
                    if (HRMS_STORE.setNotifications) HRMS_STORE.setNotifications(notifs);
                    else {
                        const data = HRMS_STORE.ensure();
                        data.notifications = notifs;
                        HRMS_STORE.set(data);
                    }
                }
            } catch (e) {}

            try { refreshUnreadBadges(); } catch (e) {}
            try { loadProfileData(); } catch (e) {}
        }

        function showRejectResignationPrompt(resignationId) {
            const note = prompt('请输入拒绝原因（可选）：');
            if (note !== null) {
                approveResignation(resignationId, false, note);
            }
        }

        async function markResignationHandled(notificationId) {
            const _okRH = await hrmsConfirm({ title: '确认处理', message: '确认已处理该离职员工的权限关停？', okText: '确认处理', icon: '✅' });
            if (!_okRH) return;
            
            const notifications = HRMS_STORE.getNotifications();
            const idx = notifications.findIndex(n => n.id === notificationId);
            if (idx >= 0) {
                notifications[idx].handled = true;
                notifications[idx].handledAt = new Date().toISOString();
                notifications[idx].handledBy = currentUser?.username || currentUser?.id;
                HRMS_STORE.setNotifications(notifications);
                showNotification('已标记为已处理', 'success');
                try { loadApprovalsData(); } catch (e) {}
            }
        }

        function viewResignationDetail(resignationId) {
            const resignations = HRMS_STORE.getResignations();
            const r = resignations.find(x => x.id === resignationId);
            if (!r) {
                showNotification('未找到该离职申请', 'error');
                return;
            }
            
            const detail = `
离职申请详情
━━━━━━━━━━━━━━━━━━━━━━
申请人：${r.applicantName}
部门：${r.department}
岗位：${r.position}
门店：${r.store}
━━━━━━━━━━━━━━━━━━━━━━
离职原因：${r.reason}
详细说明：${r.detail}
━━━━━━━━━━━━━━━━━━━━━━
是否与上级沟通：${r.communicated}
上级是否面谈：${r.interviewed}
上级是否同意：${r.managerAgreed}
期望离职日期：${r.expectedDate}
申请日期：${r.applyDate}
━━━━━━━━━━━━━━━━━━━━━━
状态：${r.status === 'pending' ? '待审批' : (r.status === 'approved' ? '已通过' : '已拒绝')}
${r.approvedDate ? '审批日期：' + r.approvedDate : ''}
${r.approvedBy ? '审批人：' + r.approvedBy : ''}
${r.approvalNote ? '审批备注：' + r.approvalNote : ''}
            `.trim();
            
            alert(detail);
        }

        function openAnnouncementModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可发布公告', 'warning');
                return;
            }
            const modal = document.getElementById('announcement-modal');
            if (!modal) return;

            const title = document.getElementById('announcement-title');
            const content = document.getElementById('announcement-content');
            const scopeType = document.getElementById('announcement-scope-type');
            const pinnedCb = document.getElementById('announcement-pinned');
            const pinUntil = document.getElementById('announcement-pin-until');
            const levelSel = document.getElementById('announcement-level');
            const ackCb = document.getElementById('announcement-require-ack');
            if (title) title.value = '';
            if (content) content.value = '';
            if (scopeType) scopeType.value = 'all';
            if (pinnedCb) pinnedCb.checked = false;
            if (pinUntil) pinUntil.value = '';
            if (levelSel) levelSel.value = 'normal';
            if (ackCb) ackCb.checked = false;
            syncAnnouncementPinFields();
            syncAnnouncementAckField();

            populateAnnouncementStores();
            syncAnnouncementScopeFields();
            modal.style.display = '';
            modal.classList.add('show');
        }

        function closeAnnouncementModal() {
            const modal = document.getElementById('announcement-modal');
            if (!modal) return;
            modal.classList.remove('show');
            modal.style.display = '';
        }

        function populateAnnouncementStores() {
            const sel = document.getElementById('announcement-scope-store');
            if (!sel) return;
            const data = HRMS_STORE.ensure();
            const stores = Array.isArray(data.stores) ? data.stores : [];
            const names = Array.from(new Set(stores.map(s => String(s?.name || '').trim()).filter(Boolean)))
                .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
            sel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
            if (names.length && !sel.value) sel.value = names[0];
            if (isAdminUser() && !sel.value) sel.value = names[0];
        }

        function syncAnnouncementScopeFields() {
            const t = String(document.getElementById('announcement-scope-type')?.value || 'all').trim();
            const box = document.getElementById('announcement-scope-store-box');
            if (box) box.style.display = t === 'store' ? '' : 'none';
        }

        function syncAnnouncementPinFields() {
            const pinned = document.getElementById('announcement-pinned')?.checked || false;
            const box = document.getElementById('announcement-pin-until-box');
            if (box) box.style.display = pinned ? '' : 'none';
        }

        function syncAnnouncementAckField() {
            const level = String(document.getElementById('announcement-level')?.value || 'normal').trim();
            const box = document.getElementById('announcement-ack-box');
            if (box) box.style.display = level === 'normal' ? 'none' : '';
            if (level === 'normal') {
                const ackCb = document.getElementById('announcement-require-ack');
                if (ackCb) ackCb.checked = false;
            }
        }

        async function confirmAnnouncementPublish() {
            if (!isAdminUser()) {
                showNotification('仅管理员可发布公告', 'warning');
                return;
            }
            const title = String(document.getElementById('announcement-title')?.value || '').trim();
            const content = String(document.getElementById('announcement-content')?.value || '').trim();
            const scopeType = String(document.getElementById('announcement-scope-type')?.value || 'all').trim();
            const store = String(document.getElementById('announcement-scope-store')?.value || '').trim();
            const pinned = document.getElementById('announcement-pinned')?.checked || false;
            const pinUntilVal = String(document.getElementById('announcement-pin-until')?.value || '').trim();

            if (!title) {
                showNotification('请输入标题', 'warning');
                return;
            }
            if (!content) {
                showNotification('请输入内容', 'warning');
                return;
            }
            if (scopeType === 'store' && !store) {
                showNotification('请选择门店', 'warning');
                return;
            }
            if (pinned && !pinUntilVal) {
                showNotification('置顶公告需设置截止时间', 'warning');
                return;
            }

            const level = String(document.getElementById('announcement-level')?.value || 'normal').trim();
            const requireAck = level !== 'normal' && (document.getElementById('announcement-require-ack')?.checked || false);

            const data = HRMS_STORE.ensure();
            data.announcements = Array.isArray(data.announcements) ? data.announcements : [];
            const ann = {
                id: 'ANN' + Date.now(),
                title,
                level,
                requireAck,
                readBy: {},
                content,
                scope: scopeType === 'store' ? { type: 'store', store } : { type: scopeType },
                createdAt: hrmsNowISO(),
                createdBy: currentUser?.username || 'admin',
                createdByName: currentUser?.name || ''
            };
            if (pinned) {
                ann.pinned = true;
                ann.pin_until = pinUntilVal ? new Date(pinUntilVal).toISOString() : null;
            }
            try {
                const resp = await HRMS_API.createAnnouncement(ann);
                const saved = resp?.item || ann;
                data.announcements.push(saved);
                HRMS_STORE.set(data);
            } catch (e) {
                showNotification('公告发布失败：' + String(e?.message || e), 'error');
                return;
            }
            closeAnnouncementModal();
            try { loadProfileData(); } catch (e) {}
            showNotification('公告已发布', 'success');
        }

         async function deleteAnnouncement(annId) {
             if (!isAdminUser()) {
                 showNotification('仅管理员可删除公告', 'warning');
                 return;
             }
             const id = String(annId || '').trim();
             if (!id) return;
             const _okAnn = await hrmsConfirm({ title: '删除公告', message: '确定删除该公告？删除后不可恢复。', okText: '确认删除', icon: '📢' });
             if (!_okAnn) return;

             const data = HRMS_STORE.ensure();
             const anns = Array.isArray(data.announcements) ? data.announcements : [];
             try {
                 await HRMS_API.deleteAnnouncementApi(id);
                 if (id) {
                     try { await HRMS_API.request('/api/notifications/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (e) { console.warn('db announcement delete failed', e); }
                 }
                 data.announcements = anns.filter(a => String(a.id) !== id);
                 HRMS_STORE.set(data);
             } catch (e) {
                 showNotification('删除失败：' + String(e?.message || e), 'error');
                 return;
             }
             try { loadProfileData(); } catch (e) {}
             showNotification('已删除，所有员工将不再看到该通知', 'success');
         }

        async function deleteKnowledgeItem(itemId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可删除知识库内容', 'warning');
                return;
            }
            const id = String(itemId || '').trim();
            if (!id) return;

            const items = HRMS_STORE.getKnowledge();
            const item = (items || []).find(x => String(x?.id || '') === id);
            if (!item) {
                showNotification('未找到该资料', 'error');
                return;
            }

            const _okKn = await hrmsConfirm({ title: '删除知识资料', message: `确定要删除「${item.title || '该资料'}」吗？此操作不可撤销。`, okText: '确认删除', icon: '📚' });
            if (!_okKn) return;

            try {
                await HRMS_API.deleteKnowledge(id);
                const newItems = (items || []).filter(x => String(x?.id || '') !== id);
                HRMS_STORE.setKnowledge(newItems);
                showNotification('已删除', 'success');
                clearKnowledgeViewer();
                renderKnowledgeList();
            } catch (e) {
                console.error('删除知识库内容失败:', e);
                showNotification('删除失败：' + String(e?.message || e), 'error');
            }
        }

