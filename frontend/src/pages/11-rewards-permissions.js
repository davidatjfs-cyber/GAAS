/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 11-rewards-permissions.js
 * lines: 32509-34549 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ========== 角色权限编辑功能 ==========
        function openRolePermissionModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可配置权限', 'warning');
                return;
            }
            showNotification('权限配置功能开发中', 'info');
        }

        // ========== 奖惩单功能 ==========
        function openRewardModal() {
            if (!isAdminUser() && !(currentUser && (currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HQ_MANAGER))) {
                showNotification('仅管理员或经理可新建奖惩单', 'warning');
                return;
            }
            const modal = document.getElementById('reward-form-modal');
            if (!modal) {
                showNotification('奖惩单表单未加载', 'error');
                return;
            }

            // 清空表单
            const typeEl = document.getElementById('reward-form-type');
            const empEl = document.getElementById('reward-form-employee');
            const amountEl = document.getElementById('reward-form-amount');
            const reasonEl = document.getElementById('reward-form-reason');

            if (typeEl) typeEl.value = 'reward';
            if (amountEl) amountEl.value = '';
            if (reasonEl) reasonEl.value = '';

            // 填充员工选项
            if (empEl) {
                const employees = HRMS_STORE.getEmployees() || [];
                empEl.innerHTML = '<option value="">请选择员工</option>' + employees.map(e => `<option value="${escapeHtml(e.username)}">${escapeHtml(e.name || e.username)}</option>`).join('');
            }

            modal.classList.add('show');
        }

        function closeRewardModal() {
            const modal = document.getElementById('reward-form-modal');
            if (modal) modal.classList.remove('show');
        }

        function submitRewardForm() {
            const type = document.getElementById('reward-form-type')?.value || 'reward';
            const employee = document.getElementById('reward-form-employee')?.value || '';
            const amount = parseFloat(document.getElementById('reward-form-amount')?.value || '0');
            const reason = (document.getElementById('reward-form-reason')?.value || '').trim();

            if (!employee) {
                showNotification('请选择员工', 'warning');
                return;
            }
            if (!amount || amount <= 0) {
                showNotification('请填写有效金额', 'warning');
                return;
            }
            if (!reason) {
                showNotification('请填写原因', 'warning');
                return;
            }

            const record = {
                id: 'RWD' + Date.now(),
                type,
                employee,
                amount: type === 'punishment' ? -Math.abs(amount) : Math.abs(amount),
                reason,
                createdAt: new Date().toISOString(),
                createdBy: currentUser?.username || 'admin'
            };

            const data = HRMS_STORE.ensure();
            if (!Array.isArray(data.rewards)) data.rewards = [];
            data.rewards.push(record);
            HRMS_STORE.set(data);

            closeRewardModal();
            loadRewardsData();
            showNotification(type === 'reward' ? '奖励已记录' : '惩罚已记录', 'success');
        }

        async function loadRewardsData() {
            const tbody = document.getElementById('rewards-tbody');
            if (!tbody) return;

            const cardsEl = document.getElementById('rewards-cards');

            let rewards = [];
            try {
                const canViewAllRewards = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HR_MANAGER);
                const resp = await HRMS_API.getApprovals({ view: canViewAllRewards ? 'all' : 'created', type: 'reward_punishment', limit: 500 });
                const items = Array.isArray(resp?.items) ? resp.items : [];
                __REWARDS_APPROVALS_CACHE = items.slice();
                rewards = items.map(it => {
                    const p = it?.payload || {};
                    const rpType = String(p?.rpType || p?.category || '').trim();
                    const isReward = rpType === '奖励' || rpType === 'reward';
                    const amountRaw = Number(p?.amount || 0);
                    const amount = isReward ? Math.abs(amountRaw) : -Math.abs(amountRaw);
                    return {
                        id: String(it?.id || ''),
                        type: isReward ? 'reward' : 'punishment',
                        employee: String(p?.targetUsername || p?.employeeUsername || '').trim(),
                        employeeName: String(p?.targetName || p?.employeeName || '').trim(),
                        store: String(p?.store || '').trim(),
                        reason: String(p?.reason || '').trim(),
                        result: String(p?.result || '').trim(),
                        amount,
                        status: String(it?.status || '').trim(),
                        createdAt: String(it?.created_at || it?.createdAt || '').trim(),
                        applicant: String(it?.applicant_username || '').trim()
                    };
                });
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#ef4444;padding:40px;">加载失败：' + escapeHtml(String(e?.message || e)) + '</td></tr>';
                if (cardsEl) cardsEl.innerHTML = '';
                return;
            }
            try {
                const fUser = String(window.__REWARDS_FILTER_USER || __REWARDS_FILTER_USER || '').trim();
                const fType = String(window.__REWARDS_FILTER_TYPE || __REWARDS_FILTER_TYPE || '').trim();
                if (fUser) {
                    rewards = rewards.filter(r => String(r?.employee || '').trim().toLowerCase() === fUser.toLowerCase());
                }
                if (fType) {
                    rewards = rewards.filter(r => String(r?.type || '').trim() === fType);
                }
            } catch (e) {}
            
            if (rewards.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#888;padding:40px;">暂无奖惩记录</td></tr>';
                try {
                    if (cardsEl) {
                        cardsEl.innerHTML = '<div style="text-align:center;color:rgba(200,215,230,0.72);padding:28px 12px;">暂无奖惩记录</div>';
                    }
                } catch (e) {}
                return;
            }

            if (cardsEl) {
                const rewardTotal = rewards.filter(r => Number(r?.amount || 0) > 0).reduce((s, r) => s + Number(r?.amount || 0), 0);
                const punishTotal = rewards.filter(r => Number(r?.amount || 0) < 0).reduce((s, r) => s + Math.abs(Number(r?.amount || 0)), 0);
                cardsEl.innerHTML = `
                    <div class="rw-summary-grid">
                        <div class="rw-sum-chip rw-sum-chip--reward">
                            <div class="rw-sum-k">奖励合计</div>
                            <div class="rw-sum-v" style="color:#86efac;">¥${rewardTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div class="rw-sum-chip rw-sum-chip--punish">
                            <div class="rw-sum-k">处罚合计</div>
                            <div class="rw-sum-v" style="color:#fca5a5;">¥${punishTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div class="rw-sum-chip rw-sum-chip--total">
                            <div class="rw-sum-k">记录数</div>
                            <div class="rw-sum-v" style="color:#93c5fd;">${rewards.length}</div>
                        </div>
                    </div>
                `;
            }

            const employees = HRMS_STORE.getEmployees() || [];
            const empMap = new Map(employees.map(e => [e.username, e.name]));

            tbody.innerHTML = rewards.map(r => {
                const typeLabel = r.type === 'reward'
                    ? '<span style="color:#86efac;font-weight:800;">奖励</span>'
                    : '<span style="color:#fca5a5;font-weight:800;">处罚</span>';
                const empName = empMap.get(r.employee) || r.employee;
                const amountColor = r.amount >= 0 ? '#86efac' : '#fca5a5';
                const amountText = r.amount >= 0 ? `+${r.amount}` : `${r.amount}`;
                const statusRaw = String(r?.status || 'pending').trim();
                const statusText = statusRaw === 'approved' ? '已通过' : (statusRaw === 'rejected' ? '已拒绝' : (statusRaw === 'paid' ? '已生效' : '审批中'));
                const stCls = statusRaw === 'approved' || statusRaw === 'paid' ? 'rw-st--ok' : (statusRaw === 'rejected' ? 'rw-st--bad' : 'rw-st--pend');
                const rid = String(r.id || '');
                const idShort = rid.length > 14 ? rid.slice(0, 12) + '…' : rid;
                const reasonShort = String(r.reason || '').length > 16 ? String(r.reason).slice(0, 14) + '…' : String(r.reason || '');
                
                return `<tr>
                    <td><span class="rw-id">${escapeHtml(idShort)}</span><button type="button" class="btn btn-secondary rw-mini-btn" data-click="openApprovalDetailModal" data-arg="${escapeHtml(rid)}">详情</button></td>
                    <td>${typeLabel}</td>
                    <td>${escapeHtml(empName)}</td>
                    <td>${escapeHtml(r.store || '-')}</td>
                    <td title="${escapeHtml(r.reason || '')}">${escapeHtml(reasonShort || '-')}</td>
                    <td>${escapeHtml(r.result || '-')}</td>
                    <td style="color:${amountColor};font-weight:700;font-family:ui-monospace,monospace;">${amountText}</td>
                    <td><span class="rw-st ${stCls}">${statusText}</span></td>
                    <td style="font-family:ui-monospace,monospace;">${r.createdAt ? r.createdAt.slice(0, 10) : '-'}</td>
                    <td><button class="btn btn-secondary rw-mini-btn" type="button" data-click="openApprovalDetailModal" data-arg="${escapeHtml(rid)}">查看</button></td>
                </tr>`;
            }).join('');
        }

        async function deleteReward(id) {
            const _ok4 = await hrmsConfirm({ title: '删除奖惩记录', message: '确定删除该奖惩记录？此操作不可恢复。', okText: '确认删除', icon: '📋' });
            if (!_ok4) return;
            const data = HRMS_STORE.ensure();
            data.rewards = (data.rewards || []).filter(r => r.id !== id);
            HRMS_STORE.set(data);
            loadRewardsData();
            showNotification('已删除', 'success');
        }

        // ========== 奖惩单创建功能（页面按钮调用） ==========
        function createRewardPunishment() {
            if (!isAdminUser() && !(currentUser && (currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.HR_MANAGER))) {
                showNotification('仅管理员或经理可新建奖惩单', 'warning');
                return;
            }
            openRewardCreateModal();
        }

        function openRewardCreateModal() {
            const modal = document.getElementById('reward-create-modal');
            if (!modal) {
                showNotification('奖惩单表单未加载', 'error');
                return;
            }

            // 填充员工选项（按角色过滤）
            const targetEl = document.getElementById('reward-create-target');
            if (targetEl) {
                const employees = (HRMS_STORE.getEmployees() || []).filter(e => {
                    if (!e || !e.username) return false;
                    const eRole = String(e.role || '').trim();
                    const eStore = String(e.store || '').trim();
                    const eStatus = String(e.status || '').trim().toLowerCase();
                    if (eStatus === '离职' || eStatus === 'disabled' || eStatus === 'inactive') return false;
                    if (String(e.username || '').toLowerCase() === String(currentUser?.username || '').toLowerCase()) return false;
                    if (currentUser.role === ROLES.STORE_MANAGER) {
                        return eStore === String(currentUser.store || '');
                    }
                    if (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER) {
                        const isStoreEmployee = eRole === ROLES.EMPLOYEE || eRole === 'store_employee';
                        return !isStoreEmployee;
                    }
                    return true;
                });
                targetEl.innerHTML = '<option value="">请选择员工</option>' + employees.map(e => `<option value="${escapeHtml(e.username)}">${escapeHtml(e.name || e.username)}${e.store ? ' (' + escapeHtml(e.store) + ')' : ''}</option>`).join('');
            }

            // 清空表单
            const typeEl = document.getElementById('reward-create-type');
            const reasonEl = document.getElementById('reward-create-reason');
            const resultEl = document.getElementById('reward-create-result');
            const noteEl = document.getElementById('reward-create-note');
            const metaEl = document.getElementById('reward-create-target-meta');

            if (typeEl) typeEl.value = 'reward';
            if (targetEl) targetEl.value = '';
            if (reasonEl) reasonEl.value = '服务表现优秀';
            if (resultEl) resultEl.value = '口头表扬';
            const amountEl = document.getElementById('reward-create-amount');
            if (amountEl) amountEl.value = '';
            if (noteEl) noteEl.value = '';
            if (metaEl) metaEl.textContent = '';
            const freqEl = document.getElementById('reward-create-frequency');
            if (freqEl) freqEl.value = 'once';
            try { syncRewardCreateFrequencyVisibility(); } catch (e) {}

            modal.classList.add('show');
        }

        function syncRewardCreateFrequencyVisibility() {
            const typeEl = document.getElementById('reward-create-type');
            const wrap = document.getElementById('reward-create-frequency-wrap');
            const freqEl = document.getElementById('reward-create-frequency');
            if (!wrap) return;
            const isReward = (typeEl?.value || 'reward') === 'reward';
            wrap.style.display = isReward ? '' : 'none';
            if (!isReward && freqEl) freqEl.value = 'once';
        }

        function closeRewardCreateModal() {
            const modal = document.getElementById('reward-create-modal');
            if (modal) modal.classList.remove('show');
        }

        function syncRewardCreateTargetMeta() {
            const targetEl = document.getElementById('reward-create-target');
            const metaEl = document.getElementById('reward-create-target-meta');
            if (!targetEl || !metaEl) return;

            const username = targetEl.value;
            if (!username) {
                metaEl.textContent = '';
                return;
            }

            const employees = HRMS_STORE.getEmployees() || [];
            const emp = employees.find(e => e.username === username);
            if (emp) {
                metaEl.textContent = [emp.store, emp.department, emp.position].filter(Boolean).join(' · ');
            } else {
                metaEl.textContent = '';
            }
        }

        async function confirmRewardCreate() {
            const type = document.getElementById('reward-create-type')?.value || 'reward';
            const target = hrmsGetSingleSelectValue(document.getElementById('reward-create-target'));
            const reason = String(document.getElementById('reward-create-reason')?.value || '').trim();
            const result = String(document.getElementById('reward-create-result')?.value || '').trim();
            const note = (document.getElementById('reward-create-note')?.value || '').trim();
            const amountRaw = Number(document.getElementById('reward-create-amount')?.value || '');
            const amount = Number.isFinite(amountRaw) ? amountRaw : null;

            if (!target) {
                showNotification('请选择员工', 'warning');
                return;
            }
            if (!reason) {
                showNotification('请填写奖惩事由', 'warning');
                return;
            }
            if (!result) {
                showNotification('请填写奖惩结果', 'warning');
                return;
            }
            if (amount == null || amount < 0) {
                showNotification('请填写有效的薪资影响金额', 'warning');
                return;
            }

            const employees = HRMS_STORE.getEmployees() || [];
            const emp = employees.find(e => String(e?.username || '').toLowerCase() === String(target || '').toLowerCase());
            const rpType = type === 'reward' ? '奖励' : '惩罚';

            // Submit through approval API
            try {
                const payload = {
                    targetUsername: target,
                    targetName: emp?.name || target,
                    rpType: rpType,
                    reason: reason,
                    result: result,
                    note: note,
                    amount: amount
                };
                const freq = String(document.getElementById('reward-create-frequency')?.value || 'once');
                if (rpType === '奖励' && freq === 'monthly') {
                    payload.recurringFrequency = 'monthly';
                }
                const data = await HRMS_API.createApproval('reward_punishment', payload);
                if (!data || data.error) {
                    if (data.error === 'duplicate_pending') {
                        showNotification('已有相同的待审批奖惩单，请勿重复提交', 'warning');
                    } else {
                        showNotification('提交失败：' + (data.error || '未知错误'), 'error');
                    }
                    return;
                }
                closeRewardCreateModal();
                showNotification(rpType + '单已提交审批', 'success');
                try { loadRewardsData(); } catch (e) {}
            } catch (e) {
                showNotification('提交失败：' + String(e?.message || e), 'error');
            }
        }

        function closeRewardViewModal() {
            const modal = document.getElementById('reward-view-modal');
            if (modal) modal.classList.remove('show');
        }

        // ── 考勤打卡模块 ──
        let __attGpsLat = null, __attGpsLng = null, __attGpsError = null;
        let __attCameraStream = null;
        let __attClockTimer = null;
        let __attGpsWatchId = null;

        function loadAttendanceData() {
            attStartClock();
            attStartGps();
            attLoadTodayRecords();
            attPopulateStoreSelects();
            // show location tab for admin and store_manager
            const locBtn = document.getElementById('att-tab-location-btn');
            if (locBtn) locBtn.style.display = (['admin','store_manager','hq_manager'].includes(currentUser?.role)) ? '' : 'none';
            // default dates for records
            const now = new Date();
            const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
            const startEl = document.getElementById('att-rec-start');
            const endEl = document.getElementById('att-rec-end');
            if (startEl && !startEl.value) startEl.value = `${y}-${m}-01`;
            if (endEl && !endEl.value) endEl.value = `${y}-${m}-${d}`;
            const monthEl = document.getElementById('att-sum-month');
            if (monthEl && !monthEl.value) monthEl.value = `${y}-${m}`;
        }

        function attStartClock() {
            if (__attClockTimer) clearInterval(__attClockTimer);
            const update = () => {
                const now = new Date();
                const h = String(now.getHours()).padStart(2, '0');
                const m = String(now.getMinutes()).padStart(2, '0');
                const s = String(now.getSeconds()).padStart(2, '0');
                const clockEl = document.getElementById('att-clock');
                if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
                const dateEl = document.getElementById('att-date');
                if (dateEl) {
                    const days = ['日', '一', '二', '三', '四', '五', '六'];
                    dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${days[now.getDay()]}`;
                }
            };
            update();
            __attClockTimer = setInterval(update, 1000);
        }

        let __attNoGps = false;
        const HRMS_ATT_GEO_DENIED_KEY = 'hrms_att_geo_denied_v1';
        function attGeoDeniedLoad() {
            try { return sessionStorage.getItem(HRMS_ATT_GEO_DENIED_KEY) === '1'; } catch (e) { return false; }
        }
        function attGeoDeniedSave() {
            try { sessionStorage.setItem(HRMS_ATT_GEO_DENIED_KEY, '1'); } catch (e) {}
        }
        function attGeoDeniedClear() {
            try { sessionStorage.removeItem(HRMS_ATT_GEO_DENIED_KEY); } catch (e) {}
        }

        function attStartGps() {
            if (__attGpsWatchId != null) { try { navigator.geolocation.clearWatch(__attGpsWatchId); } catch (e) {} }
            __attGpsLat = null; __attGpsLng = null; __attGpsError = null;
            const wasDenied = attGeoDeniedLoad();
            __attNoGps = wasDenied;
            const gpsText = document.getElementById('att-gps-text');
            const gpsContainer = document.getElementById('att-gps-status');
            const isSecure = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (!isSecure || !navigator.geolocation) {
                __attNoGps = true;
                attGeoDeniedSave();
                __attGpsError = !isSecure ? '定位不可用' : '浏览器不支持定位';
                if (gpsContainer) {
                    gpsContainer.style.display = '';
                    gpsContainer.style.background = 'rgba(220,38,38,0.1)';
                    gpsContainer.style.borderColor = 'rgba(220,38,38,0.3)';
                }
                if (gpsText) {
                    gpsText.style.display = '';
                    gpsText.innerHTML = !isSecure
                        ? '⚠️ 当前环境无法使用定位，无法打卡。请使用 HTTPS 访问本站。'
                        : '⚠️ 浏览器不支持定位，无法打卡。';
                    gpsText.style.color = 'rgba(248,113,113,0.9)';
                    gpsText.style.fontSize = '12px';
                }
                return;
            }
            if (wasDenied) {
                if (gpsContainer) {
                    gpsContainer.style.display = '';
                    gpsContainer.style.background = 'rgba(220,38,38,0.1)';
                    gpsContainer.style.borderColor = 'rgba(220,38,38,0.3)';
                }
                if (gpsText) {
                    gpsText.style.display = '';
                    gpsText.innerHTML = '⚠️ 定位不可用：请在系统设置中允许定位权限并下拉刷新本页，否则无法打卡。';
                    gpsText.style.color = 'rgba(248,113,113,0.9)';
                    gpsText.style.fontSize = '12px';
                }
            } else if (gpsText) {
                gpsText.textContent = '正在获取位置...';
                gpsText.style.color = 'rgba(234,179,8,0.9)';
            }
            try {
                __attGpsWatchId = navigator.geolocation.watchPosition(
                    (pos) => {
                        attGeoDeniedClear();
                        __attGpsLat = pos.coords.latitude;
                        __attGpsLng = pos.coords.longitude;
                        __attGpsError = null;
                        __attNoGps = false;
                        if (gpsContainer) gpsContainer.style.display = '';
                        if (gpsText) {
                            gpsText.style.display = '';
                            gpsText.textContent = `已定位 (${__attGpsLat.toFixed(6)}, ${__attGpsLng.toFixed(6)})`;
                            gpsText.style.color = 'rgba(34,197,94,0.9)';
                        }
                    },
                    (err) => {
                        __attGpsError = err.message || '定位失败';
                        __attNoGps = true;
                        attGeoDeniedSave();
                        if (gpsContainer) { gpsContainer.style.display = ''; gpsContainer.style.background = 'rgba(220,38,38,0.1)'; gpsContainer.style.borderColor = 'rgba(220,38,38,0.3)'; }
                        if (gpsText) {
                            gpsText.style.display = '';
                            const errCode = err.code;
                            if (errCode === 1) {
                                gpsText.innerHTML = '⚠️ 定位权限被拒绝：请在浏览器或系统设置中允许定位，否则无法打卡。';
                            } else if (errCode === 2) {
                                gpsText.innerHTML = '⚠️ 暂时无法获取位置信号：请到信号良好处或稍后重试，否则无法打卡。';
                            } else {
                                gpsText.innerHTML = '⚠️ 定位超时：请稍后重试或检查定位权限，否则无法打卡。';
                            }
                            gpsText.style.color = 'rgba(248,113,113,0.9)';
                            gpsText.style.fontSize = '12px';
                        }
                    },
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
                );
            } catch (e) {
                __attNoGps = true;
                attGeoDeniedSave();
                __attGpsError = String(e?.message || '定位异常');
                if (gpsContainer) {
                    gpsContainer.style.display = '';
                    gpsContainer.style.background = 'rgba(220,38,38,0.1)';
                    gpsContainer.style.borderColor = 'rgba(220,38,38,0.3)';
                }
                if (gpsText) {
                    gpsText.style.display = '';
                    gpsText.innerHTML = '⚠️ 定位异常：请刷新页面或检查权限，否则无法打卡。';
                    gpsText.style.color = 'rgba(248,113,113,0.9)';
                    gpsText.style.fontSize = '12px';
                }
            }
        }

        async function attToggleCamera() {
            const video = document.getElementById('att-video');
            const placeholder = document.getElementById('att-face-placeholder');
            const btn = document.getElementById('att-camera-btn');
            if (__attCameraStream) {
                __attCameraStream.getTracks().forEach(t => t.stop());
                __attCameraStream = null;
                if (video) { video.srcObject = null; video.style.display = 'none'; }
                if (placeholder) placeholder.style.display = '';
                if (btn) btn.textContent = '开启摄像头';
                return;
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                showNotification('因为未开启摄像头，无法打卡', 'error');
                return;
            }
            try {
                __attCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 320 } });
                if (video) { video.srcObject = __attCameraStream; video.style.display = 'block'; }
                if (placeholder) placeholder.style.display = 'none';
                if (btn) btn.textContent = '关闭摄像头';
            } catch (e) {
                showNotification('因为未开启摄像头，无法打卡', 'error');
            }
        }

        function attCapturePhoto() {
            const video = document.getElementById('att-video');
            const canvas = document.getElementById('att-canvas');
            if (!video || !canvas || !__attCameraStream) return null;
            canvas.width = 320; canvas.height = 320;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, 320, 320);
            return canvas.toDataURL('image/jpeg', 0.7);
        }

        async function attDoCheckin(type) {
            if (!__attCameraStream) {
                showNotification('因为未开启摄像头，无法打卡', 'error');
                return;
            }
            const photo = attCapturePhoto();
            if (!photo) {
                showNotification('因为未采集到有效人脸照片，无法打卡', 'error');
                return;
            }
            const locOk = __attGpsLat != null && __attGpsLng != null
                && Number.isFinite(__attGpsLat) && Number.isFinite(__attGpsLng);
            if (!locOk) {
                showNotification('因为未获取到有效定位，无法打卡', 'error');
                return;
            }
            let faceMatch = true;
            let faceScore = 0.95;
            let photoUrl = photo;
            const btn = type === 'clock_out' ? document.getElementById('att-clockout-btn') : document.getElementById('att-clockin-btn');
            if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
            try {
                const resp = await HRMS_API.checkin({
                    type,
                    latitude: __attGpsLat,
                    longitude: __attGpsLng,
                    faceMatch,
                    faceScore,
                    photoUrl: photoUrl,
                    store: currentUser?.current_store || currentUser?.store || ''
                });
                const statusLabel = (resp?.record?.status === 'normal' || resp?.record?.status === 'no_gps') ? '正常' :
                    resp?.record?.status === 'no_store_location' ? '(门店未设定位)' :
                    resp?.record?.status === 'face_fail' ? '(人脸未验证)' : '';
                showNotification((type === 'clock_in' ? '上班打卡成功' : '下班打卡成功') + ' ' + statusLabel, 'success');
                attLoadTodayRecords();
            } catch (e) {
                const msg = String(e?.message || '打卡失败');
                showNotification(msg, 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = type === 'clock_in' ? '上班打卡' : '下班打卡';
                }
            }
        }

        async function attLoadTodayRecords() {
            const box = document.getElementById('att-today-records');
            if (!box) return;
            try {
                const resp = await HRMS_API.getCheckinToday();
                const records = Array.isArray(resp?.records) ? resp.records : [];
                if (!records.length) {
                    box.innerHTML = '<div style="font-size:12px; color:rgba(200,215,230,0.5); text-align:center; padding:8px;">今日暂无打卡记录</div>';
                    return;
                }
                box.innerHTML = '<div style="font-size:12px; font-weight:700; color:rgba(200,215,230,0.7); margin-bottom:6px;">今日打卡记录</div>' +
                    records.map(r => {
                        const t = new Date(r.check_time);
                        const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
                        const typeLabel = r.type === 'clock_in' ? '<span class="att-dot att-dot--in" aria-hidden="true"></span> 上班' : '<span class="att-dot att-dot--out" aria-hidden="true"></span> 下班';
                        const statusColor = (r.status === 'normal' || r.status === 'no_gps') ? 'rgba(34,197,94,0.8)' : 'rgba(234,179,8,0.8)';
                        const statusLabel = (r.status === 'normal' || r.status === 'no_gps') ? '正常' : r.status === 'face_fail' ? '人脸异常' : r.status === 'no_store_location' ? '未设定位' : r.status;
                        const dist = r.distance_meters != null ? `${Math.round(r.distance_meters)}米` : '';
                        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; border-radius:6px; background:rgba(255,255,255,0.03); margin-bottom:4px; font-size:12px;">
                            <span>${typeLabel} ${time}</span>
                            <span style="color:${statusColor};">${statusLabel} · ${dist}</span>
                        </div>`;
                    }).join('');
            } catch (e) {
                box.innerHTML = '<div style="font-size:12px; color:rgba(239,68,68,0.6);">加载失败</div>';
            }
        }

        function attSwitchTab(tab) {
            ['checkin', 'records', 'summary', 'location'].forEach(t => {
                const el = document.getElementById('att-' + t + '-tab');
                if (el) el.style.display = t === tab ? '' : 'none';
                const btn = document.getElementById('att-tab-' + t + '-btn');
                if (btn) {
                    btn.className = 'rep-tab' + (t === tab ? ' rep-tab--active' : '');
                }
            });
            if (tab === 'records') attLoadRecords();
            if (tab === 'summary') attLoadSummary();
            if (tab === 'location') attLoadStoreLocations();
        }

        function attPopulateStoreSelects() {
            const state = HRMS_STORE.ensure();
            const stores = Array.isArray(state.stores) ? state.stores : [];
            const role = currentUser?.role || '';
            ['att-rec-store', 'att-sum-store'].forEach(id => {
                const sel = document.getElementById(id);
                if (!sel) return;
                if (role === 'admin' || role === 'hq_manager') {
                    const val = sel.value;
                    sel.innerHTML = '<option value="">全部门店</option>' + stores.map(s => `<option value="${s.name || ''}">${s.name || ''}</option>`).join('');
                    sel.value = val;
                    sel.style.display = '';
                } else {
                    sel.style.display = 'none';
                }
            });
            // Bug 4: Only admin can export
            const exportBtn = document.getElementById('att-export-btn');
            if (exportBtn) exportBtn.style.display = (role === 'admin') ? '' : 'none';
        }

        let __attRecordsGroupByDay = true;
        let __attRecordsLastData = [];
        const __attDayExpandState = {};

        function attToggleDailyGrouping() {
            __attRecordsGroupByDay = !__attRecordsGroupByDay;
            const btn = document.getElementById('att-group-day-btn');
            if (btn) btn.textContent = `按天折叠：${__attRecordsGroupByDay ? '开' : '关'}`;
            attRenderRecordsList(__attRecordsLastData);
        }

        function attToggleDayGroup(day) {
            const key = String(day || '');
            __attDayExpandState[key] = !__attDayExpandState[key];
            attRenderRecordsList(__attRecordsLastData);
        }

        function attRenderRecordsList(records) {
            const listBox = document.getElementById('att-records-list');
            const tableWrap = document.getElementById('att-records-table-wrap');
            const groupBtn = document.getElementById('att-group-day-btn');
            if (!listBox || !tableWrap) return;
            const isMobile = window.innerWidth <= 768;
            listBox.style.display = isMobile ? 'grid' : 'none';
            tableWrap.style.display = isMobile ? 'none' : 'block';
            if (groupBtn) groupBtn.style.display = isMobile ? '' : 'none';
            if (!isMobile) return;
            if (!Array.isArray(records) || !records.length) {
                listBox.innerHTML = '<div class="att-list-item"><div class="att-list-row">暂无记录</div></div>';
                return;
            }

            const statusMap = { normal: '正常', face_fail: '人脸异常', out_of_range: '超出范围', no_store_location: '未设定位', no_gps: '正常', confirmed: '已确认' };
            const itemHtml = (r) => {
                const t = new Date(r.check_time);
                const timeStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                const typeLabel = r.type === 'clock_in' ? '<span style="color:rgba(34,197,94,0.9); font-weight:800;">上班</span>' : '<span style="color:rgba(239,68,68,0.9); font-weight:800;">下班</span>';
                const dist = r.distance_meters != null ? Math.round(r.distance_meters) + '米' : '-';
                const statusLabel = statusMap[r.status] || r.status;
                const statusColor = r.status === 'normal' || r.status === 'confirmed' || r.status === 'no_gps' ? 'rgba(34,197,94,0.9)' : 'rgba(234,179,8,0.9)';
                const canConfirm = (currentUser?.role === 'admin' || currentUser?.role === 'hq_manager' || currentUser?.role === 'store_manager' || currentUser?.role === 'hr_manager') && r.status !== 'normal' && r.status !== 'confirmed';
                const actionText = canConfirm
                    ? `<button class="btn btn-secondary" style="font-size:11px; padding:3px 8px;" data-click="attConfirmRecord" data-arg="${r.id}">确认</button>`
                    : (r.confirmed_by ? `<span class="att-list-sub">${r.confirmed_by}确认</span>` : '<span class="att-list-sub">-</span>');
                return `<div class="att-list-item">
                    <div class="att-list-row"><span class="att-list-main">${r.display_name || r.username}</span><span class="att-list-sub">${r.store || '-'}</span></div>
                    <div class="att-list-row"><span>${typeLabel}</span><span class="att-list-sub">${timeStr}</span></div>
                    <div class="att-list-row"><span class="att-list-sub">距离 ${dist}</span><span style="color:${statusColor}; font-weight:700;">${statusLabel}</span></div>
                    <div class="att-list-row"><span class="att-list-sub">操作</span><span>${actionText}</span></div>
                </div>`;
            };

            if (!__attRecordsGroupByDay) {
                listBox.innerHTML = records.map(itemHtml).join('');
                return;
            }

            const groups = {};
            records.forEach(r => {
                const day = String(r?.check_time || '').slice(0, 10) || '未知日期';
                if (!groups[day]) groups[day] = [];
                groups[day].push(r);
            });

            const days = Object.keys(groups).sort((a, b) => String(b).localeCompare(String(a)));
            listBox.innerHTML = days.map(day => {
                const items = groups[day];
                const expanded = !!__attDayExpandState[day];
                const abnormal = items.filter(r => r.status !== 'normal' && r.status !== 'confirmed' && r.status !== 'no_gps').length;
                return `<div class="att-day-group">
                    <button class="att-day-group-head" type="button" data-click="attToggleDayGroup" data-arg="${day}">
                        <span>${day}</span>
                        <span class="meta">${items.length}条${abnormal ? ` · 异常${abnormal}` : ''} ${expanded ? '▾' : '▸'}</span>
                    </button>
                    <div class="att-day-group-body" style="display:${expanded ? 'grid' : 'none'};">${items.map(itemHtml).join('')}</div>
                </div>`;
            }).join('');
        }

        async function attLoadRecords() {
            const tbody = document.getElementById('att-records-tbody');
            const listBox = document.getElementById('att-records-list');
            const groupBtn = document.getElementById('att-group-day-btn');
            if (!tbody || !listBox) return;
            if (groupBtn) groupBtn.textContent = `按天折叠：${__attRecordsGroupByDay ? '开' : '关'}`;
            listBox.innerHTML = '<div class="att-list-item"><div class="att-list-row">加载中...</div></div>';
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:rgba(200,215,230,0.5);">加载中...</td></tr>';
            try {
                const params = {
                    name: document.getElementById('att-rec-name')?.value?.trim() || '',
                    start: document.getElementById('att-rec-start')?.value || '',
                    end: document.getElementById('att-rec-end')?.value || '',
                    store: document.getElementById('att-rec-store')?.value || '',
                    status: document.getElementById('att-rec-status')?.value || ''
                };
                const resp = await HRMS_API.getCheckinRecords(params);
                const records = Array.isArray(resp?.records) ? resp.records : [];
                __attRecordsLastData = records;
                if (!records.length) {
                    listBox.innerHTML = '<div class="att-list-item"><div class="att-list-row">暂无记录</div></div>';
                    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:rgba(200,215,230,0.5);">暂无记录</td></tr>';
                    return;
                }
                tbody.innerHTML = records.map(r => {
                    const t = new Date(r.check_time);
                    const timeStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                    const typeLabel = r.type === 'clock_in' ? '<span style="color:rgba(34,197,94,0.9);">上班</span>' : '<span style="color:rgba(239,68,68,0.9);">下班</span>';
                    const dist = r.distance_meters != null ? Math.round(r.distance_meters) + '米' : '-';
                    const faceLabel = r.face_match ? '<span style="color:rgba(34,197,94,0.8);">✓</span>' : '<span style="color:rgba(239,68,68,0.8);">✗</span>';
                    const statusMap = { normal: '正常', face_fail: '人脸异常', out_of_range: '超出范围', no_store_location: '未设定位', no_gps: '正常', confirmed: '已确认' };
                    const statusLabel = statusMap[r.status] || r.status;
                    const statusColor = r.status === 'normal' || r.status === 'confirmed' || r.status === 'no_gps' ? 'rgba(34,197,94,0.8)' : 'rgba(234,179,8,0.8)';
                    const canConfirm = (currentUser?.role === 'admin' || currentUser?.role === 'hq_manager' || currentUser?.role === 'store_manager' || currentUser?.role === 'hr_manager') && r.status !== 'normal' && r.status !== 'confirmed';
                    const actions = canConfirm ? `<button class="btn btn-secondary" style="font-size:11px; padding:2px 8px;" data-click="attConfirmRecord" data-arg="${r.id}">确认</button>` : (r.confirmed_by ? `<span style="font-size:11px; color:rgba(200,215,230,0.5);">${r.confirmed_by}确认</span>` : '-');
                    return `<tr>
                        <td>${r.display_name || r.username}</td>
                        <td>${r.store || '-'}</td>
                        <td>${typeLabel}</td>
                        <td>${timeStr}</td>
                        <td>${dist}</td>
                        <td>${faceLabel}</td>
                        <td><span style="color:${statusColor};">${statusLabel}</span></td>
                        <td>${actions}</td>
                    </tr>`;
                }).join('');
                attRenderRecordsList(records);
            } catch (e) {
                __attRecordsLastData = [];
                listBox.innerHTML = '<div class="att-list-item"><div class="att-list-row" style="color:rgba(239,68,68,0.75);">加载失败</div></div>';
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:rgba(239,68,68,0.6);">加载失败</td></tr>';
            }
        }

        async function attConfirmRecord(id) {
            const _okCR = await hrmsConfirm({ title: '确认打卡记录', message: '确认该打卡记录？', okText: '确认', icon: '✅' });
            if (!_okCR) return;
            try {
                await HRMS_API.confirmCheckin(id, { status: 'confirmed' });
                showNotification('已确认', 'success');
                attLoadRecords();
            } catch (e) {
                showNotification('确认失败: ' + (e?.message || e), 'error');
            }
        }

        async function attExportRecords() {
            try {
                const params = {
                    name: document.getElementById('att-rec-name')?.value?.trim() || '',
                    start: document.getElementById('att-rec-start')?.value || '',
                    end: document.getElementById('att-rec-end')?.value || '',
                    store: document.getElementById('att-rec-store')?.value || '',
                    status: document.getElementById('att-rec-status')?.value || ''
                };
                const resp = await HRMS_API.getCheckinRecords(params);
                const records = Array.isArray(resp?.records) ? resp.records : [];
                if (!records.length) { showNotification('没有可导出的记录', 'warning'); return; }

                const statusMap = { normal: '正常', face_fail: '人脸异常', out_of_range: '超出范围', no_store_location: '未设定位', no_gps: '正常', confirmed: '已确认' };

                const BOM = '\uFEFF';
                let csv = BOM + '姓名,门店,类型,打卡时间,距离(米),人脸验证,状态\n';
                records.forEach(r => {
                    const name = (r.display_name || r.username || '').replace(/,/g, '，');
                    const store = (r.store || '-').replace(/,/g, '，');
                    const type = r.type === 'clock_in' ? '上班' : '下班';
                    const t = new Date(r.check_time);
                    const timeStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
                    const dist = r.distance_meters != null ? Math.round(r.distance_meters) : '-';
                    const face = r.face_match ? '通过' : '未通过';
                    const status = statusMap[r.status] || r.status;
                    csv += `${name},${store},${type},${timeStr},${dist},${face},${status}\n`;
                });

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `考勤记录_${params.start || 'all'}_${params.end || 'all'}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showNotification('导出成功', 'success');
            } catch (e) {
                showNotification('导出失败: ' + (e?.message || e), 'error');
            }
        }

        async function attLoadSummary() {
            const box = document.getElementById('att-summary-box');
            if (!box) return;
            box.innerHTML = '<div style="color:rgba(200,215,230,0.5); padding:20px; text-align:center;">加载中...</div>';
            try {
                const month = document.getElementById('att-sum-month')?.value || '';
                const store = document.getElementById('att-sum-store')?.value || '';
                if (!month) { box.innerHTML = '<div style="color:rgba(200,215,230,0.5); padding:20px; text-align:center;">请选择月份</div>'; return; }
                const resp = await HRMS_API.getCheckinSummary({ month, store });
                const records = Array.isArray(resp?.records) ? resp.records : [];
                const leaveBalances = resp?.leaveBalances || {};
                if (!records.length) { box.innerHTML = '<div style="color:rgba(200,215,230,0.5); padding:20px; text-align:center;">暂无数据</div>'; return; }

                // Group by username, build nameMap from backend display_name
                const byUser = {};
                const nameMap = {};
                records.forEach(r => {
                    const u = r.username;
                    if (r.display_name) nameMap[u] = r.display_name;
                    if (!byUser[u]) byUser[u] = { days: {} };
                    const day = String(r.day || '').substring(0, 10);
                    if (!byUser[u].days[day]) byUser[u].days[day] = [];
                    byUser[u].days[day].push(r);
                });

                // Calculate working days in month
                const [yr, mo] = month.split('-').map(Number);
                const daysInMonth = new Date(yr, mo, 0).getDate();
                const today = new Date();
                const maxDay = (yr === today.getFullYear() && mo === today.getMonth() + 1) ? today.getDate() : daysInMonth;

                const canEditLeave = currentUser && (currentUser.role === 'admin' || currentUser.role === 'hr_manager');
                const canMonthlyConfirm = currentUser && (currentUser.role === 'store_manager' || currentUser.role === 'admin' || currentUser.role === 'hq_manager' || currentUser.role === 'hr_manager');

                let html = '<div class="att-list-view">';
                Object.keys(byUser).sort().forEach(u => {
                    const data = byUser[u];
                    const attendDays = Object.keys(data.days).length;
                    let abnormalCount = 0;
                    Object.values(data.days).forEach(dayRecords => {
                        dayRecords.forEach(r => {
                            if (r.status !== 'normal' && r.status !== 'confirmed' && r.status !== 'no_gps') abnormalCount++;
                        });
                    });
                    // Count working days (Mon-Fri) up to maxDay
                    let workDays = 0;
                    for (let d = 1; d <= maxDay; d++) {
                        const dow = new Date(yr, mo - 1, d).getDay();
                        if (dow !== 0 && dow !== 6) workDays++;
                    }
                    const absentDays = Math.max(0, workDays - attendDays);
                    const lb = leaveBalances[u] || {};
                    const leaveRemaining = lb.remaining != null ? lb.remaining : '-';
                    const leaveTitle = lb.totalLeave != null ? `总假期: ${lb.totalLeave}天 (周休${lb.baseLeave} + 年假${lb.annualLeave})\\n已用: ${lb.usedLeave}天` : '';
                    const leaveCell = canEditLeave
                        ? `<input type="number" step="0.5" value="${leaveRemaining}" style="width:76px; text-align:center; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:6px; color:rgba(226,232,240,0.9); font-size:12px; padding:4px 6px;" title="${leaveTitle}" data-change="attSaveLeaveBalance" data-arg="${u}" data-arg2="${month}" data-pass-value>${lb.overridden ? ' <span style="color:rgba(234,179,8,0.7); font-size:10px;" title="已手动修改">改</span>' : ''}`
                        : `<span title="${leaveTitle}" style="color:rgba(96,165,250,0.9); font-weight:700;">${leaveRemaining}</span>`;
                    html += `<div class="att-list-item">
                        <div class="att-list-row"><span class="att-list-main">${nameMap[u] || u}</span><span class="att-list-sub">${month}</span></div>
                        <div class="att-summary-metrics">
                            <div class="att-summary-metric"><div class="k">出勤</div><div class="v" style="color:rgba(34,197,94,0.95);">${attendDays}</div></div>
                            <div class="att-summary-metric"><div class="k">缺勤</div><div class="v" style="color:${absentDays > 0 ? 'rgba(239,68,68,0.95)' : 'rgba(200,215,230,0.7)'};">${absentDays}</div></div>
                            <div class="att-summary-metric"><div class="k">异常</div><div class="v" style="color:${abnormalCount > 0 ? 'rgba(234,179,8,0.95)' : 'rgba(200,215,230,0.7)'};">${abnormalCount}</div></div>
                            <div class="att-summary-metric"><div class="k">剩余假期</div><div class="v">${typeof leaveRemaining === 'number' ? leaveRemaining : leaveRemaining}</div></div>
                        </div>
                        <div class="att-list-row" style="margin-top:8px;"><span class="att-list-sub">假期调整</span><span>${leaveCell}</span></div>
                        <div class="att-list-row"><span class="att-list-sub">详情</span><span><button class="btn btn-secondary" style="font-size:11px; padding:3px 10px;" data-click="attShowUserDetail" data-arg="${u}" data-arg2="${month}">查看</button></span></div>
                    </div>`;
                });
                html += '</div>';
                box.innerHTML = html;

                // Show monthly confirm button for managers
                const confirmBtn = document.getElementById('att-monthly-confirm-btn');
                const confirmStatus = document.getElementById('att-monthly-confirm-status');
                if (confirmBtn && canMonthlyConfirm) {
                    confirmBtn.style.display = '';
                    confirmBtn.dataset.month = month;
                    confirmBtn.dataset.store = store;
                    // Check existing confirmation status
                    attCheckMonthlyConfirmStatus(month, store);
                } else if (confirmBtn) {
                    confirmBtn.style.display = 'none';
                }
            } catch (e) {
                box.innerHTML = '<div style="color:rgba(239,68,68,0.6); padding:20px; text-align:center;">加载失败</div>';
            }
        }

        async function attCheckMonthlyConfirmStatus(month, store) {
            const btn = document.getElementById('att-monthly-confirm-btn');
            const statusEl = document.getElementById('att-monthly-confirm-status');
            if (!statusEl) return;
            try {
                const resp = await HRMS_API.request('/api/checkin/monthly-confirm?month=' + encodeURIComponent(month), { method: 'GET' });
                const confirmations = Array.isArray(resp?.confirmations) ? resp.confirmations : [];
                const match = confirmations.find(c => c.month === month && (c.store || '') === (store || ''));
                if (match) {
                    statusEl.style.display = '';
                    const statusMap = { pending_supervisor: '⏳ 待上级审批', pending_hr: '⏳ 待HR确认', approved: '✅ 已确认', rejected: '❌ 已驳回' };
                    statusEl.innerHTML = statusMap[match.status] || match.status;
                    if (match.status === 'approved' || match.status === 'pending_supervisor' || match.status === 'pending_hr') {
                        if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
                    }
                } else {
                    statusEl.style.display = 'none';
                    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
                }
            } catch (e) {
                statusEl.style.display = 'none';
            }
        }

        async function attSubmitMonthlyConfirm() {
            const btn = document.getElementById('att-monthly-confirm-btn');
            const month = btn?.dataset?.month || '';
            const store = btn?.dataset?.store || '';
            if (!month) { showNotification('请先选择月份并查询', 'warning'); return; }
            const _okMC = await hrmsConfirm({ title: '月度考勤确认', message: `确认提交 ${month} ${store || '全部门店'} 的月度考勤确认？提交后将进入审批流程：直属上级审批 → HR确认 → 自动生成工资数据`, okText: '确认提交', icon: '📋' });
            if (!_okMC) return;
            try {
                btn.disabled = true;
                btn.textContent = '提交中...';
                await HRMS_API.request('/api/checkin/monthly-confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ month, store })
                });
                showNotification('月度考勤确认已提交，等待审批', 'success');
                btn.textContent = '📋 月度确认';
                btn.style.opacity = '0.5';
                attCheckMonthlyConfirmStatus(month, store);
            } catch (e) {
                const msg = e?.message || String(e);
                if (/already_submitted/i.test(msg)) {
                    showNotification('该月度考勤已提交过确认', 'warning');
                } else {
                    showNotification('提交失败: ' + msg, 'error');
                }
                btn.disabled = false;
                btn.textContent = '📋 月度确认';
            }
        }

        async function attSaveLeaveBalance(username, month, value) {
            try {
                const v = Number(value);
                if (!Number.isFinite(v)) { showNotification('请输入有效数字', 'error'); return; }
                const noteInput = prompt('请输入调整原因（必填）', '考勤页人工调整');
                if (noteInput === null) return;
                const note = String(noteInput || '').trim();
                if (!note) { showNotification('请填写调整原因', 'warning'); return; }
                await HRMS_API.request('/api/checkin/leave-balance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, month, value: v, mode: 'remaining', note })
                });
                showNotification('剩余假期已更新', 'success');
            } catch (e) {
                showNotification('保存失败: ' + (e?.message || e), 'error');
            }
        }

        function attShowUserDetail(username, month) {
            // Switch to records tab with filter
            const startEl = document.getElementById('att-rec-start');
            const endEl = document.getElementById('att-rec-end');
            if (startEl) startEl.value = month + '-01';
            const [yr, mo] = month.split('-').map(Number);
            const lastDay = new Date(yr, mo, 0).getDate();
            if (endEl) endEl.value = month + '-' + String(lastDay).padStart(2, '0');
            attSwitchTab('records');
        }

        async function attLoadStoreLocations() {
            const box = document.getElementById('att-store-locations-list');
            if (!box) return;
            const state = HRMS_STORE.ensure();
            const stores = Array.isArray(state.stores) ? state.stores : [];
            if (!stores.length) { box.innerHTML = '<div style="color:rgba(200,215,230,0.5);">暂无门店</div>'; return; }
            box.innerHTML = stores.map(s => {
                const hasLoc = Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude));
                const locText = hasLoc ? `${Number(s.latitude).toFixed(6)}, ${Number(s.longitude).toFixed(6)}` : '未设置';
                const locColor = hasLoc ? 'rgba(34,197,94,0.8)' : 'rgba(234,179,8,0.8)';
                const addr = s.address || '';
                return `<div class="card" style="padding:12px; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                    <div>
                        <div style="font-weight:700; font-size:14px;">${s.name || '未命名'}</div>
                        <div style="font-size:12px; color:${locColor}; margin-top:2px;">📍 ${locText}</div>
                        ${addr ? `<div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:2px;">${addr}</div>` : ''}
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button class="btn btn-secondary" style="font-size:11px; padding:4px 10px;" data-click="attSetStoreLocationCurrent" data-arg="${escapeHtml(s.name || '')}">用当前位置</button>
                        <button class="btn btn-secondary" style="font-size:11px; padding:4px 10px;" data-click="attSetStoreLocationManual" data-arg="${escapeHtml(s.name || '')}">手动输入</button>
                    </div>
                </div>`;
            }).join('');
        }

        async function attSetStoreLocationCurrent(storeName) {
            if (__attGpsLat == null || __attGpsLng == null) {
                showNotification('请先等待定位完成', 'warning');
                return;
            }
            const _okGPS = await hrmsConfirm({ title: '设置门店定位', message: `将门店"${storeName}"的位置设为当前GPS坐标？(${__attGpsLat.toFixed(6)}, ${__attGpsLng.toFixed(6)})`, okText: '确认设置', icon: '📍' });
            if (!_okGPS) return;
            try {
                await HRMS_API.setStoreLocation(storeName, { latitude: __attGpsLat, longitude: __attGpsLng });
                showNotification('门店定位已更新', 'success');
                // Update local state
                const state = HRMS_STORE.ensure();
                const stores = Array.isArray(state.stores) ? state.stores : [];
                const idx = stores.findIndex(s => s.name === storeName);
                if (idx >= 0) { stores[idx].latitude = __attGpsLat; stores[idx].longitude = __attGpsLng; HRMS_STORE.set(state); }
                attLoadStoreLocations();
            } catch (e) {
                showNotification('设置失败: ' + (e?.message || e), 'error');
            }
        }

        async function attSetStoreLocationManual(storeName) {
            const input = prompt(`请输入门店"${storeName}"的GPS坐标（格式：经度,纬度）\n例如：121.473701,31.230416`);
            if (!input) return;
            const parts = input.split(',').map(s => Number(s.trim()));
            if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
                showNotification('坐标格式错误，请输入 经度,纬度', 'error');
                return;
            }
            const inputLng = parts[0]; // 第一个数是经度
            const inputLat = parts[1]; // 第二个数是纬度
            if (inputLat < -90 || inputLat > 90 || inputLng < -180 || inputLng > 180) {
                showNotification('坐标范围错误：经度-180~180，纬度-90~90', 'error');
                return;
            }
            const addr = prompt('请输入门店地址（可选）') || '';
            try {
                await HRMS_API.setStoreLocation(storeName, { latitude: inputLat, longitude: inputLng, address: addr });
                showNotification('门店定位已更新', 'success');
                const state = HRMS_STORE.ensure();
                const stores = Array.isArray(state.stores) ? state.stores : [];
                const idx = stores.findIndex(s => s.name === storeName);
                if (idx >= 0) { stores[idx].latitude = inputLat; stores[idx].longitude = inputLng; if (addr) stores[idx].address = addr; HRMS_STORE.set(state); }
                attLoadStoreLocations();
            } catch (e) {
                showNotification('设置失败: ' + (e?.message || e), 'error');
            }
        }

        // Add attendance shortcut to profile quick actions
        function attAddProfileShortcut() {
            try {
                const grid = document.querySelector('#profile-page .card');
                if (!grid) return;
                // Already added check
                if (document.getElementById('profile-attendance-shortcut')) return;
            } catch (e) {}
        }

        // 登出函数
        async function logout() {
            if (await hrmsConfirm({ title: '确认登出', message: '确定要登出吗？', okText: '确认登出', icon: '🚪' })) {
                try { await hrmsFlushStateSave(); } catch (e) {}
                // 记录登出时间
                try { fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (HRMS_API.getToken && HRMS_API.getToken() || '') } }).catch(() => {}); } catch (e) {}
                try { if (window.__HRMS_HEARTBEAT) { clearInterval(window.__HRMS_HEARTBEAT); window.__HRMS_HEARTBEAT = null; } } catch (e) {}
                isLoggedIn = false;
                currentUser = null;
                try { HRMS_API.clearToken(); } catch (e) {}
                try {
                    localStorage.removeItem('HRMS_AUTO_USER');
                    localStorage.removeItem('HRMS_AUTO_PASS');
                    localStorage.removeItem('HRMS_AUTO_TENANT');
                } catch (e) {}
                
                document.getElementById('main-app').classList.add('hidden');
                document.getElementById('login').classList.remove('hidden');
                
                showNotification('已安全登出', 'info');
                updateDebug('已登出');
            }
        }

        // Mobile navigation functions
        function mobileNavigateTo(page, evt, el) {
            console.log('Mobile navigate to:', page);
            
            // Prevent event propagation
            if (evt) {
                evt.preventDefault();
                evt.stopPropagation();
            }

            if (page === 'forecast') {
                window.location.href = '/forecast.html';
                return;
            }
            
            // Update active state
            document.querySelectorAll('.mobile-nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const activeItem = document.querySelector(`#mobile-nav .mobile-nav-item[data-page="${page}"]`);
            if (activeItem) {
                activeItem.classList.add('active');
            }
            
            if (page === 'more') {
                toggleMobileMoreMenu(evt);
                return;
            }

            // showPage expects logical page keys (e.g. attendance/reports/daily-report)
            showPage(page || 'dashboard');
            
            // Add haptic feedback if available
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        }

        function toggleMobileMoreMenu(evt) {
            if (evt) evt.stopPropagation();
            const menu = document.getElementById('mobile-more-menu');
            if (!menu) return;
            if (menu.style.display !== 'none') {
                closeMobileMoreMenu();
            } else {
                openMobileMoreMenu();
            }
        }

        function openMobileMoreMenu() {
            const menu = document.getElementById('mobile-more-menu');
            const overlay = document.getElementById('mobile-more-overlay');
            if (!menu) return;

            const nameEl = document.getElementById('mobile-more-name');
            const roleEl = document.getElementById('mobile-more-role');
            if (nameEl && currentUser) nameEl.textContent = currentUser.name || currentUser.username || '-';
            if (roleEl && currentUser) {
                const roleMap = { admin:'系统管理员', hr_manager:'人事经理', hq_manager:'总部营运', store_manager:'店长', front_manager:'前厅经理', front_supervisor:'前厅主管', store_employee:'员工', cashier:'出纳', store_production_manager:'出品经理' };
                roleEl.textContent = ((currentUser.current_store || currentUser.store) ? (currentUser.current_store || currentUser.store) + ' · ' : '') + (roleMap[currentUser.role] || currentUser.role || '-');
            }
            const switchWrap = document.getElementById('mobile-more-store-switch');
            if (switchWrap) {
                const stores = getAllowedStoresForUser();
                if (stores.length > 1) {
                    switchWrap.style.display = 'block';
                    switchWrap.innerHTML = `
                        <div style="margin-top:12px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);">
                            <div style="font-size:11px;color:rgba(255,255,255,0.58);margin-bottom:6px;">当前操作门店</div>
                            <select id="mobile-store-switch-select" data-change="switchCurrentUserStore" data-pass-value style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,23,42,0.86);color:#fff;">
                                ${stores.map(function (store) {
                                    const selected = String(currentUser?.current_store || currentUser?.store || '') === String(store) ? 'selected' : '';
                                    return `<option value="${escapeHtml(store)}" ${selected}>${escapeHtml(store)}</option>`;
                                }).join('')}
                            </select>
                        </div>
                    `;
                } else {
                    switchWrap.style.display = 'none';
                    switchWrap.innerHTML = '';
                }
            }

            const allItems = [
                { icon:'👤', label:'我的档案', page:'profile' },
                { icon:'👥', label:'员工管理', page:'employees', roles:['admin','hr_manager','hq_manager','store_manager'] },
                { icon:'📋', label:'营业日报', page:'daily-report', roles:['admin','hq_manager','store_manager','front_manager','front_supervisor'] },
                { icon:'✅', label:'待审批', page:'approvals', roles:['admin','hr_manager','hq_manager','store_manager','store_production_manager'] },
                { icon:'💰', label:'请款', page:'payment', roles:['admin','hq_manager','store_manager','cashier','front_manager'] },
                { icon:'📚', label:'知识库', page:'knowledge' },
                { icon:'🎓', label:'培训认证', page:'training' },
                { icon:'📊', label:'数据中心', page:'agents', roles:['admin'] },
                { icon:'📈', label:'增长看板', page:'growth', roles:['admin'] },
                { icon:'🩺', label:'经营诊断', page:'diagnosis', roles:['admin'] },
                { icon:'🧪', label:'门店营销策略', page:'strategy', roles:['admin','hq_manager','store_manager','store_production_manager'] },
                { icon:'🧭', label:'Agent任务', page:'agent-tasks', roles:['admin','hq_manager','hr_manager'] },
                { icon:'📊', label:'任务和绩效', page:'task-performance', roles:['admin','hq_manager','hr_manager'] },
                // 考试测评已停用
                // 奖惩管理：管理员/HR/总部营运/店长/出品经理 可见
                { icon:'🏆', label:'奖惩管理', page:'rewards', roles:['admin','hr_manager','hq_manager','store_manager','store_production_manager'] },
                { icon:'💎', label:'员工积分', page:'points' },
                { icon:'⏰', label:'考勤打卡', page:'attendance' },
                { icon:'🍳', label:'厨房执行', page:'kitchen', kitchenOnly:true },
                { icon:'📊', label:'分析报表', page:'reports', roles:['admin','hr_manager','hq_manager','store_manager'] },
                // 智能助手：独立页 forecast.html（与主壳同源部署）；管理员/门店/总部均需可见（此前误排除 admin 导致「更多」里消失）
                { icon:'📦', label:'智能助手', href:'/forecast.html', roles:['admin','hr_manager','hq_manager','store_manager','store_production_manager'] },
                { icon:'⚙️', label:'系统设置', page:'settings', roles:['admin'] },
            ];
            const role = currentUser?.role || '';
            const _kitchenPos = String(currentUser?.position || '').toLowerCase();
            const _isKitchenUser = role === 'store_production_manager'
                || /(后厨|厨房|炒锅|烧味|打荷|砧板|切配|出品|厨师|厨工)/.test(_kitchenPos)
                || ['admin','hq_manager','store_manager'].includes(role);
            const visibleItems = allItems.filter(item => {
                if (item.kitchenOnly && !_isKitchenUser) return false;
                if (Array.isArray(item.roles) && item.roles.length && !item.roles.includes(role)) return false;
                if (item.href) return true;
                if (item.page && !canAccessModulePage(item.page, role)) return false;
                return true;
            });

            const grid = document.getElementById('mobile-more-grid');
            if (grid) {
                grid.innerHTML = visibleItems.map(item => `
                    <div data-click="handleMobileMoreItemClick" data-arg="${item.page || ''}" data-arg2="${item.href || ''}" style="
                        display:flex;flex-direction:column;align-items:center;gap:6px;
                        padding:12px 4px;border-radius:14px;cursor:pointer;
                        background:rgba(255,255,255,0.05);
                        -webkit-tap-highlight-color:transparent;
                    " ontouchstart="this.style.background='rgba(245,158,11,0.15)'" ontouchend="this.style.background='rgba(255,255,255,0.05)'">
                        <span style="font-size:24px;line-height:1;">${item.icon}</span>
                        <span style="font-size:11px;color:rgba(255,255,255,0.8);font-weight:500;text-align:center;">${item.label}</span>
                    </div>
                `).join('');
            }

            menu.style.display = 'block';
            if (overlay) overlay.style.display = 'block';
            if (navigator.vibrate) navigator.vibrate(30);
        }

        function handleMobileMoreItemClick(page, href) {
            closeMobileMoreMenu();
            const to = String(href || '').trim();
            if (to) {
                window.location.href = to;
                return;
            }
            showPage(page || 'dashboard');
        }

        function closeMobileMoreMenu() {
            const menu = document.getElementById('mobile-more-menu');
            const overlay = document.getElementById('mobile-more-overlay');
            if (menu) menu.style.display = 'none';
            if (overlay) overlay.style.display = 'none';
        }

        // Initialize mobile navigation
        function updateMobileBottomSafeArea() {
            const root = document.documentElement;
            if (!root) return;
            if (window.innerWidth > 768) {
                root.style.setProperty('--mobile-bottom-safe', '176px');
                return;
            }
            const nav = document.getElementById('mobile-nav');
            if (!nav || nav.style.display === 'none') {
                root.style.setProperty('--mobile-bottom-safe', '176px');
                return;
            }
            const rect = nav.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const navOccupied = Math.max(0, vh - rect.top);
            const safe = Math.max(176, Math.ceil(navOccupied + 24));
            root.style.setProperty('--mobile-bottom-safe', `${safe}px`);
        }

        function initMobileNavigation() {
            // Check if mobile
            const isMobile = window.innerWidth <= 768;
            console.log('Init mobile navigation, isMobile:', isMobile);
            
            if (isMobile) {
                // Show mobile navigation
                const mobileNav = document.getElementById('mobile-nav');
                if (mobileNav) {
                    mobileNav.style.display = 'flex';
                }
                updateMobileNavigationVisibility();
                requestAnimationFrame(() => requestAnimationFrame(updateMobileBottomSafeArea));
                
                // Hide sidebar
                const sidebar = document.querySelector('.sidebar');
                
                // Adjust main content for mobile
                const mainContent = document.querySelector('.main-content');
                if (mainContent) {
                    mainContent.style.marginLeft = '0';
                    mainContent.style.paddingBottom = '80px'; // Space for bottom nav
                }
                
                // Hide desktop navigation items
                const desktopNav = document.querySelector('.nav');
                if (desktopNav) {
                    desktopNav.style.display = 'none';
                }
                
                console.log('Mobile navigation initialized');
            } else {
                // Hide mobile navigation on desktop
                const mobileNav = document.getElementById('mobile-nav');
                if (mobileNav) {
                    mobileNav.style.display = 'none';
                }
                updateMobileBottomSafeArea();
                
                // Show sidebar on desktop
                const sidebar = document.querySelector('.sidebar');
                
                // Reset main content
                const mainContent = document.querySelector('.main-content');
                if (mainContent) {
                    mainContent.style.marginLeft = '';
                    mainContent.style.paddingBottom = '';
                }
                
                // Show desktop navigation
                const desktopNav = document.querySelector('.nav');
                if (desktopNav) {
                    desktopNav.style.display = '';
                }
            }
        }

        function updateMobileNavigationVisibility() {
            const role = String(currentUser?.role || '').trim();

            const pageMeta = {
                dashboard: { icon: '🏠', label: '首页' },
                profile: { icon: '👤', label: '档案' },
                attendance: { icon: '👤', label: '打卡' },
                knowledge: { icon: '📚', label: '知识库' },
                kitchen: { icon: '🍳', label: '执行' },
                forecast: { icon: '📦', label: '智能助手' },
                agents: { icon: '📦', label: '智能助手' },
                'agent-tasks': { icon: '🧭', label: 'Agent任务' },
                growth: { icon: '📈', label: '增长' },
                exam: { icon: '📝', label: '考试' },
                'daily-report': { icon: '📒', label: '日报' },
                payment: { icon: '💰', label: '请款' },
                approvals: { icon: '📋', label: '待审批' },
                reports: { icon: '📊', label: '报表' },
                employees: { icon: '👥', label: '员工管理' },
                points: { icon: '💎', label: '积分' },
                rewards: { icon: '🏆', label: '奖惩' },
                training: { icon: '🎓', label: '培训' }
            };

            let roleMenu = getRoleBottomNavPages(role).slice(0, 4);
            while (roleMenu.length < 4) roleMenu.push('profile');

            const slots = [
                document.getElementById('mobile-nav-slot-1'),
                document.getElementById('mobile-nav-slot-2'),
                document.getElementById('mobile-nav-slot-3'),
                document.getElementById('mobile-nav-slot-4')
            ];

            slots.forEach((slot, idx) => {
                if (!slot) return;
                const page = roleMenu[idx] || 'dashboard';
                let meta = pageMeta[page] || pageMeta.dashboard;
                if (page === 'agents' && role === ROLES.ADMIN) {
                    meta = { icon: '📊', label: '数据中心' };
                }
                slot.dataset.page = page;
                const iconEl = slot.querySelector('.mobile-nav-icon');
                const labelEl = slot.querySelector('.mobile-nav-label');
                if (iconEl) iconEl.textContent = meta.icon;
                if (labelEl) labelEl.textContent = meta.label;
                slot.style.display = 'flex';
            });

            const moreItem = document.querySelector('.mobile-nav-item[data-page="more"]');
            if (moreItem) moreItem.style.display = 'flex';

            const hasActiveVisible = Array.from(document.querySelectorAll('.mobile-nav-item.active')).some((item) => item.style.display !== 'none' && item.dataset.page !== 'more');
            if (!hasActiveVisible) {
                const firstMain = slots.find((s) => !!s);
                if (firstMain) firstMain.classList.add('active');
            }
        }

        // Sync mobile navigation with page changes
        function syncMobileNavigation(pageId) {
            if (window.innerWidth <= 768) {
                const pageMap = {
                    'dashboard': 'dashboard',
                    'attendance': 'attendance',
                    'knowledge': 'knowledge',
                    'kitchen': 'kitchen',
                    'agents': 'agents',
                    'agent-tasks': 'agent-tasks',
                    'growth': 'growth',
                    'exam': 'exam',
                    'approvals': 'approvals',
                    'payment': 'payment',
                    'daily-report': 'daily-report',
                    'reports': 'reports',
                    'employees': 'employees',
                    'profile': 'profile',
                    'rewards': 'rewards',
                    'points': 'points'
                };
                
                const mobilePage = pageMap[pageId];
                if (mobilePage) {
                    document.querySelectorAll('.mobile-nav-item').forEach(item => {
                        item.classList.remove('active');
                    });
                    const activeItem = document.querySelector(`#mobile-nav .mobile-nav-item[data-page="${mobilePage}"]`);
                    if (activeItem) {
                        activeItem.classList.add('active');
                    }
                }
                updateMobileNavigationVisibility();
            }
        }

        // Add pull-to-refresh functionality
        let pullToRefreshEnabled = false;
        let startY = 0;
        let currentY = 0;
        let pulling = false;

        function initPullToRefresh() {
            const container = document.querySelector('.content');
            if (!container) return;
            
            container.addEventListener('touchstart', (e) => {
                if (window.scrollY === 0) {
                    startY = e.touches[0].clientY;
                    pulling = true;
                }
            });
            
            container.addEventListener('touchmove', (e) => {
                if (!pulling) return;
                
                currentY = e.touches[0].clientY;
                const diff = currentY - startY;
                
                if (diff > 0 && window.scrollY === 0) {
                    e.preventDefault();
                    container.style.transform = `translateY(${diff * 0.5}px)`;
                    
                    if (diff > 80) {
                        container.classList.add('pulling');
                    }
                }
            });
            
            container.addEventListener('touchend', async (e) => {
                if (!pulling) return;
                
                const diff = currentY - startY;
                container.style.transform = '';
                container.classList.remove('pulling');
                
                if (diff > 120) {
                    // Trigger refresh
                    container.classList.add('refreshing');
                    await refreshCurrentPage();
                    setTimeout(() => {
                        container.classList.remove('refreshing');
                    }, 1000);
                }
                
                pulling = false;
                startY = 0;
                currentY = 0;
            });
        }

        async function refreshCurrentPage() {
            const currentPage = document.querySelector('.page-section:not(.hidden)');
            if (!currentPage) return;
            
            const pageId = currentPage.id;
            
            // Refresh based on current page
            switch(pageId) {
                case 'dashboard':
                    await loadDashboardData();
                    break;
                case 'attendance-page':
                    await attLoadRecords();
                    break;
                case 'rewards-page':
                    await loadRewardsData();
                    break;
                case 'payment-page':
                    await loadPaymentData();
                    break;
                default:
                    // Generic refresh
                    window.location.reload();
            }
            
            showNotification('刷新完成', 'success');
        }

        // Mobile swipe gestures for cards
        function initMobileSwipe() {
            document.addEventListener('touchstart', handleSwipeStart, { passive: true });
            document.addEventListener('touchmove', handleSwipeMove, { passive: true });
            document.addEventListener('touchend', handleSwipeEnd);
        }

        let swipeStartX = 0;
        let swipeStartY = 0;
        let currentSwipeElement = null;

        function handleSwipeStart(e) {
            const touch = e.touches[0];
            swipeStartX = touch.clientX;
            swipeStartY = touch.clientY;
            
            // Find swipe container
            const container = e.target.closest('.swipe-container');
            if (container) {
                currentSwipeElement = container;
            }
        }

        function handleSwipeMove(e) {
            if (!currentSwipeElement) return;
            
            const touch = e.touches[0];
            const diffX = touch.clientX - swipeStartX;
            const diffY = touch.clientY - swipeStartY;
            
            // Only handle horizontal swipes
            if (Math.abs(diffX) > Math.abs(diffY)) {
                const content = currentSwipeElement.querySelector('.swipe-content');
                const actions = currentSwipeElement.querySelector('.swipe-actions');
                
                if (diffX < -50) { // Swipe left
                    content.style.transform = `translateX(${diffX}px)`;
                    actions.style.transform = `translateX(${100 + diffX}%)`;
                }
            }
        }

        function handleSwipeEnd(e) {
            if (!currentSwipeElement) return;
            
            const touch = e.changedTouches[0];
            const diffX = touch.clientX - swipeStartX;
            
            const content = currentSwipeElement.querySelector('.swipe-content');
            const actions = currentSwipeElement.querySelector('.swipe-actions');
            
            if (diffX < -100) { // Full swipe
                content.style.transform = 'translateX(-100%)';
                actions.style.transform = 'translateX(0)';
            } else { // Snap back
                content.style.transform = 'translateX(0)';
                actions.style.transform = 'translateX(100%)';
            }
            
            currentSwipeElement = null;
        }

        // Virtual scrolling for mobile performance
        class VirtualScroll {
            constructor(container, itemHeight, renderItem, loadData) {
                this.container = container;
                this.itemHeight = itemHeight;
                this.renderItem = renderItem;
                this.loadData = loadData;
                this.visibleStart = 0;
                this.visibleEnd = 0;
                this.data = [];
                this.totalHeight = 0;
                this.containerHeight = 0;
                this.viewport = null;
                this.content = null;
                this.spacerBefore = null;
                this.spacerAfter = null;
                this.loading = false;
                this.hasMore = true;
                this.init();
            }

            init() {
                this.container.innerHTML = `
                    <div class="virtual-scroll-viewport" style="height: 100%; overflow-y: auto;">
                        <div class="virtual-scroll-content">
                            <div class="virtual-scroll-spacer-before"></div>
                            <div class="virtual-scroll-items"></div>
                            <div class="virtual-scroll-spacer-after"></div>
                        </div>
                    </div>
                `;

                this.viewport = this.container.querySelector('.virtual-scroll-viewport');
                this.content = this.container.querySelector('.virtual-scroll-content');
                this.spacerBefore = this.container.querySelector('.virtual-scroll-spacer-before');
                this.spacerAfter = this.container.querySelector('.virtual-scroll-spacer-after');
                this.itemsContainer = this.container.querySelector('.virtual-scroll-items');

                this.containerHeight = this.container.clientHeight || 400;
                this.viewport.style.height = this.containerHeight + 'px';

                this.viewport.addEventListener('scroll', this.handleScroll.bind(this));
                this.loadInitialData();
            }

            async loadInitialData() {
                this.loading = true;
                try {
                    const result = await this.loadData(0, 20);
                    this.data = result.items || [];
                    this.hasMore = result.hasMore !== false;
                    this.totalHeight = this.data.length * this.itemHeight;
                    this.updateView();
                } catch (error) {
                    console.error('Failed to load initial data:', error);
                } finally {
                    this.loading = false;
                }
            }

            async loadMoreData() {
                if (this.loading || !this.hasMore) return;

                this.loading = true;
                const startIndex = this.data.length;
                
                try {
                    const result = await this.loadData(startIndex, 20);
                    const newItems = result.items || [];
                    this.data = this.data.concat(newItems);
                    this.hasMore = result.hasMore !== false;
                    this.totalHeight = this.data.length * this.itemHeight;
                    this.updateView();
                } catch (error) {
                    console.error('Failed to load more data:', error);
                } finally {
                    this.loading = false;
                }
            }

            handleScroll() {
                const scrollTop = this.viewport.scrollTop;
                const containerHeight = this.containerHeight;
                
                this.visibleStart = Math.floor(scrollTop / this.itemHeight);
                this.visibleEnd = Math.ceil((scrollTop + containerHeight) / this.itemHeight);

                // Load more data when scrolling near bottom
                if (scrollTop + containerHeight >= this.totalHeight - 200 && this.hasMore) {
                    this.loadMoreData();
                }

                this.updateView();
            }

            updateView() {
                // Update spacers
                this.spacerBefore.style.height = (this.visibleStart * this.itemHeight) + 'px';
                this.spacerAfter.style.height = ((this.data.length - this.visibleEnd) * this.itemHeight) + 'px';

                // Render visible items
                const fragment = document.createDocumentFragment();
                for (let i = this.visibleStart; i < Math.min(this.visibleEnd, this.data.length); i++) {
                    const item = this.renderItem(this.data[i], i);
                    item.style.position = 'absolute';
                    item.style.top = (i * this.itemHeight) + 'px';
                    item.style.width = '100%';
                    item.style.height = this.itemHeight + 'px';
                    fragment.appendChild(item);
                }

                this.itemsContainer.innerHTML = '';
                this.itemsContainer.appendChild(fragment);
            }

            refresh() {
                this.data = [];
                this.visibleStart = 0;
                this.visibleEnd = 0;
                this.loadInitialData();
            }

            destroy() {
                if (this.viewport) {
                    this.viewport.removeEventListener('scroll', this.handleScroll.bind(this));
                }
            }
        }

        // Lazy loading for images
        class LazyImageLoader {
            constructor() {
                this.observer = null;
                this.init();
            }

            init() {
                if ('IntersectionObserver' in window) {
                    this.observer = new IntersectionObserver(this.handleIntersection.bind(this), {
                        rootMargin: '50px'
                    });
                }
            }

            observe(img) {
                if (this.observer) {
                    this.observer.observe(img);
                } else {
                    // Fallback for older browsers
                    this.loadImage(img);
                }
            }

            handleIntersection(entries) {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.loadImage(entry.target);
                        this.observer.unobserve(entry.target);
                    }
                });
            }

            loadImage(img) {
                const src = img.dataset.src;
                if (src) {
                    img.src = src;
                    img.classList.remove('lazy-loading');
                    img.classList.add('lazy-loaded');
                }
            }

            disconnect() {
                if (this.observer) {
                    this.observer.disconnect();
                }
            }
        }

        // Mobile performance optimizations
        class MobileOptimizer {
            constructor() {
                this.lazyImageLoader = new LazyImageLoader();
                this.init();
            }

            init() {
                this.optimizeImages();
                this.optimizeScrolling();
                this.optimizeTouch();
                this.addPerformanceMonitoring();
            }

            optimizeImages() {
                // Find all images with data-src
                document.querySelectorAll('img[data-src]').forEach(img => {
                    this.lazyImageLoader.observe(img);
                });
            }

            optimizeScrolling() {
                // Add passive event listeners for better scrolling performance
                document.addEventListener('touchstart', () => {}, { passive: true });
                document.addEventListener('touchmove', () => {}, { passive: true });
            }

            optimizeTouch() {
                // Prevent default touch behaviors that cause delays
                document.addEventListener('touchstart', function(e) {
                    if (e.target.closest('.no-prevent-default')) return;
                    // Add fast tap response
                    if (e.target.closest('.btn, .mobile-card, .mobile-nav-item')) {
                        e.target.style.transform = 'scale(0.98)';
                    }
                }, { passive: true });

                document.addEventListener('touchend', function(e) {
                    if (e.target.closest('.no-prevent-default')) return;
                    setTimeout(() => {
                        if (e.target.closest('.btn, .mobile-card, .mobile-nav-item')) {
                            e.target.style.transform = '';
                        }
                    }, 100);
                }, { passive: true });
            }

            addPerformanceMonitoring() {
                // Monitor performance metrics
                if ('performance' in window) {
                    window.addEventListener('load', () => {
                        const perfData = performance.getEntriesByType('navigation')[0];
                        console.log('Page load time:', perfData.loadEventEnd - perfData.loadEventStart, 'ms');
                    });
                }
            }

            createMobileCard(title, content, actions = []) {
                const card = document.createElement('div');
                card.className = 'mobile-card';
                
                let html = `
                    <div class="mobile-card-title">${title}</div>
                    <div class="mobile-card-content">${content}</div>
                `;
                
                if (actions.length > 0) {
                    html += '<div class="mobile-card-actions">';
                    actions.forEach(action => {
                        html += `<button class="btn btn-sm" type="button" data-click="${action.fn || 'hrmsNoop'}">${action.label}</button>`;
                    });
                    html += '</div>';
                }
                
                card.innerHTML = html;
                return card;
            }

            createSwipeCard(content, actions = []) {
                const container = document.createElement('div');
                container.className = 'swipe-container';
                
                let swipeActions = '';
                actions.forEach(action => {
                    swipeActions += `<div class="swipe-action ${action.type}" data-click="${action.fn || 'hrmsNoop'}">${action.label}</div>`;
                });
                
                container.innerHTML = `
                    <div class="swipe-content">${content}</div>
                    <div class="swipe-actions">${swipeActions}</div>
                `;
                
                return container;
            }
        }

        // Initialize mobile optimizer
        let mobileOptimizer;
        
        function initMobileOptimizer() {
            mobileOptimizer = new MobileOptimizer();
        }

        // Helper functions for mobile components
        function createMobileSkeletonLoader(lines = 3) {
            const skeleton = document.createElement('div');
            skeleton.className = 'mobile-skeleton';
            
            for (let i = 0; i < lines; i++) {
                const line = document.createElement('div');
                line.className = 'mobile-skeleton-line';
                line.style.height = '16px';
                line.style.marginBottom = '8px';
                line.style.borderRadius = '4px';
                skeleton.appendChild(line);
            }
            
            return skeleton;
        }

        function addPullToRefreshIndicator() {
            const content = document.querySelector('.content');
            if (!content) return;
            
            const indicator = document.createElement('div');
            indicator.className = 'refresh-indicator';
            indicator.innerHTML = '🔄';
            content.appendChild(indicator);
        }

        // Enhanced mobile notifications
        function showMobileNotification(message, type = 'info', duration = 3000) {
            const notification = document.createElement('div');
            notification.className = `mobile-notification mobile-notification-${type}`;
            notification.innerHTML = `
                <div class="notification-content">
                    <span class="notification-message">${message}</span>
                    <button class="notification-close" data-click="hrmsRemoveGrandparent" data-arg-self="1">×</button>
                </div>
            `;
            
            document.body.appendChild(notification);
            
            // Animate in
            setTimeout(() => {
                notification.classList.add('show');
            }, 10);
            
            // Auto remove
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentElement) {
                        notification.remove();
                    }
                }, 300);
            }, duration);
            
            // Haptic feedback
            if (navigator.vibrate) {
                navigator.vibrate(type === 'error' ? [100, 50, 100] : 50);
            }
        }

        function normalizeModalCloseButtons() {
            try {
                const btns = Array.from(document.querySelectorAll('button.modal-close'));
                btns.forEach(btn => {
                    const txt = String(btn.textContent || '').trim();
                    if (txt !== '×' && txt !== '✕' && txt !== '✖') return;
                    btn.textContent = '返回上一页';
                    btn.setAttribute('title', '返回上一页');
                    btn.setAttribute('aria-label', '返回上一页');
                    btn.style.width = 'auto';
                    btn.style.minWidth = '96px';
                    btn.style.height = '32px';
                    btn.style.padding = '0 10px';
                    btn.style.borderRadius = '10px';
                    btn.style.fontSize = '12px';
                    btn.style.fontWeight = '700';
                    btn.style.lineHeight = '32px';
                });
            } catch (e) {}
        }
        
        // 初始化
        document.addEventListener('DOMContentLoaded', () => {
            updateDebug('系统初始化完成');
            normalizeModalCloseButtons();

            // Initialize mobile features
            initMobileNavigation();
            initPullToRefresh();
            initMobileSwipe();
            initMobileOptimizer();
            
            // Handle window resize for mobile navigation
            window.addEventListener('resize', () => {
                initMobileNavigation();
                updateMobileBottomSafeArea();
            });
            window.addEventListener('orientationchange', () => {
                setTimeout(updateMobileBottomSafeArea, 220);
            });
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', updateMobileBottomSafeArea);
            }

            try {
                if ('serviceWorker' in navigator) {
                    let swReloading = false;
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        if (swReloading) return;
                        swReloading = true;
                        window.location.reload();
                    });
                    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
                        if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
                        reg.addEventListener('updatefound', () => {
                            const newSW = reg.installing;
                            if (newSW) {
                                newSW.addEventListener('statechange', () => {
                                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                                        newSW.postMessage({ type: 'SKIP_WAITING' });
                                    }
                                });
                            }
                        });
                        try { reg.update(); } catch (e) {}
                    }).catch(() => {});
                }
            } catch (e) {}

            (async () => {
                // 清理历史明文密码自动登录残留（商业化安全止血 A1）
                try { localStorage.removeItem('HRMS_AUTO_PASS'); } catch (e) {}
                const ok = await hrmsTryRestoreSessionOnLoad();
                if (!ok) {
                    // 仅预填用户名，不再用明文密码自动登录
                    try {
                        const savedU = localStorage.getItem('HRMS_AUTO_USER');
                        if (savedU && document.getElementById('username')) {
                            document.getElementById('username').value = savedU;
                        }
                    } catch (e) {}
                    showNotification('系统已就绪，请登录', 'info');
                    renderTestAccounts();
                }
            })();
        });

