/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 07-promotion.js
 * lines: 15882-20129 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ========== 升职申请功能 ==========
        let __PROMOTION_APPROVALS = [];
        let __PROMOTION_TRACKS = [];
        let __PROMOTION_TAB = 'qualification';
        let __PROMO_TIER = 'level_promotion'; // 'level_promotion' | 'skill_bump'

        function promoSetTier(tier) {
            __PROMO_TIER = tier;
            const lvBtn = document.getElementById('promo-tier-level');
            const skBtn = document.getElementById('promo-tier-skill');
            if (lvBtn) lvBtn.className = tier === 'level_promotion' ? 'btn' : 'btn btn-secondary';
            if (skBtn) skBtn.className = tier === 'skill_bump' ? 'btn' : 'btn btn-secondary';
            const lvGroup = document.getElementById('promo-target-level-group');
            if (lvGroup) lvGroup.style.display = tier === 'level_promotion' ? '' : 'none';
            const typeGroup = document.getElementById('promo-qualification-type')?.closest('.form-group');
            if (typeGroup) typeGroup.style.display = tier === 'level_promotion' ? '' : 'none';
            const capLabel = document.getElementById('promo-capability-label');
            if (capLabel) capLabel.textContent = tier === 'level_promotion' ? '目标岗位能力要求（系统自动）' : '选择要提升的技能项（可多选）';
            promoOnTargetPositionChange();
        }

        function promoGetCurrentProfile() {
            const uname = String(currentUser?.username || '').trim().toLowerCase();
            const emps = HRMS_STORE.getEmployees ? (HRMS_STORE.getEmployees() || []) : [];
            const users = HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : [];
            const e = emps.find(x => String(x?.username || '').trim().toLowerCase() === uname) || {};
            const u = users.find(x => String(x?.username || '').trim().toLowerCase() === uname) || {};
            const merged = { ...u, ...e };
            const joinDate = String(merged?.joinDate || '').trim();
            let tenureYears = 0;
            if (/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) {
                tenureYears = Math.max(0, (Date.now() - new Date(joinDate + 'T00:00:00').getTime()) / (365 * 86400000));
            }
            return {
                username: String(merged?.username || currentUser?.username || '').trim(),
                name: String(merged?.name || currentUser?.name || currentUser?.username || '').trim(),
                role: String(merged?.role || currentUser?.role || '').trim(),
                department: String(merged?.department || '').trim(),
                store: String(merged?.store || currentUser?.store || '').trim(),
                position: String(merged?.position || '').trim(),
                level: String(merged?.level || '').trim(),
                managerUsername: String(merged?.managerUsername || merged?.manager || merged?.directManager || '').trim(),
                tenureYears
            };
        }

        function promoDefaultLevelsMap() {
            // 注意：这里的级别码必须与 training_topics.level 实际存的值一致
            // (T1/T2/T3 厨房线，L1-L3 前厅一线，M1-M3 管理线)，否则按目标级别
            // 匹配培训知识点时会查不到任何记录，导致晋升通过后不会派发培训任务。
            return {
                '打荷': ['T1', 'T2'],
                '汤档/煲仔': ['T1', 'T2'],
                '砧板': ['T1', 'T2'],
                '炒锅': ['T1', 'T2'],
                '烧味/卤水': ['T1', 'T2'],
                '刺身': ['T1', 'T2'],
                '洗碗': ['T1'],
                '水吧': ['L1', 'L2', 'L3'],
                '传菜': ['L1'],
                '服务员': ['L2'],
                '主管': ['M1'],
                '前厅经理': ['M2'],
                '门店店长': ['M3'],
                '出纳': ['L1', 'L2'],
                '出品经理': ['T2', 'T3']
            };
        }

        // 目标岗位的晋升能力要求知识点（来自 /api/training/promotion-requirements，与培训知识库统一）
        let __PROMO_TARGET_TOPICS = [];

        async function promoFetchPromotionRequirements(position, level) {
            if (!position) return [];
            try {
                let url = '/api/training/promotion-requirements?position=' + encodeURIComponent(position);
                if (level) url += '&level=' + encodeURIComponent(level);
                const resp = await fetch(url, {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                return Array.isArray(data?.topics) ? data.topics : [];
            } catch (e) {
                return [];
            }
        }

        // 同岗位晋升时，按该岗位的级别序列计算下一级；若已是该线最高级（或当前级别未在序列中），
        // 返回序列首级（无记录时视为从0级开始挑战）；已在最高级则返回空字符串，提示需跨岗位晋升
        function promoCalcNextLevel(position, currentLevel) {
            const levels = promoDefaultLevelsMap()[position];
            if (!Array.isArray(levels) || !levels.length) return '';
            const idx = levels.indexOf(String(currentLevel || '').trim());
            if (idx === -1) return levels[0];
            return idx + 1 < levels.length ? levels[idx + 1] : '';
        }

        function promoRenderTargetOptions() {
            const sel = document.getElementById('promo-target-position');
            if (!sel) return;
            const names = Object.keys(promoDefaultLevelsMap()).filter(Boolean);
            const profile = promoGetCurrentProfile();
            if (profile.position && !names.includes(profile.position)) names.unshift(profile.position);
            sel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        }

        function promoOnQualificationTypeChange() {
            const profile = promoGetCurrentProfile();
            const type = String(document.getElementById('promo-qualification-type')?.value || 'same').trim();
            const targetSel = document.getElementById('promo-target-position');
            if (!targetSel) return;
            if (type === 'same' && profile.position) targetSel.value = profile.position;
            promoOnTargetPositionChange();
        }

        async function promoOnTargetPositionChange() {
            const profile = promoGetCurrentProfile();
            const type = String(document.getElementById('promo-qualification-type')?.value || 'same').trim();
            const targetPosition = String(document.getElementById('promo-target-position')?.value || '').trim();
            const levelEl = document.getElementById('promo-target-level');
            const abilityEl = document.getElementById('promo-capability-list');

            if (__PROMO_TIER === 'skill_bump') {
                // 技能提升：展示该岗位所有可选技能（checkbox 多选），不自动计算级别
                if (levelEl) levelEl.value = profile.level || '';
                if (!targetPosition) { if (abilityEl) abilityEl.innerHTML = '<span style="color:rgba(200,215,230,0.6)">请先选择岗位</span>'; return; }
                if (abilityEl) abilityEl.innerHTML = '<span style="color:rgba(200,215,230,0.5)">加载中…</span>';
                try {
                    const resp = await fetch('/api/training/topics?position=' + encodeURIComponent(targetPosition), {
                        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                    });
                    const data = await resp.json();
                    const allTopics = (data.topics || []).filter(t => {
                        const posArr = (t.position || '').split(',').map(s => s.trim());
                        return posArr.includes(targetPosition);
                    });
                    __PROMO_TARGET_TOPICS = allTopics;
                    if (!allTopics.length) {
                        if (abilityEl) abilityEl.innerHTML = '<span style="color:rgba(200,215,230,0.6)">该岗位暂无知识点，请先在「培训认证 → 知识点管理」中创建。</span>';
                        return;
                    }
                    if (abilityEl) {
                        abilityEl.innerHTML = allTopics.map(t => {
                            const badge = t.promotion_required ? '<span style="font-size:10px;background:rgba(99,102,241,0.25);color:#a5b4fc;border-radius:4px;padding:1px 5px;margin-left:4px;">晋升必须</span>' : '';
                            return `<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:6px;"
                                onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background=''">
                                <input type="checkbox" data-id="${t.id}" style="width:15px;height:15px;accent-color:#6366f1;flex-shrink:0;">
                                <span style="flex:1;">${escapeHtml(String(t.title || ''))}${badge}</span>
                            </label>`;
                        }).join('');
                    }
                } catch (e) {
                    if (abilityEl) abilityEl.innerHTML = '<span style="color:#f87171;">加载失败：' + escapeHtml(e.message) + '</span>';
                }
                return;
            }

            // 级别晋升：原有逻辑
            const levelMap = promoDefaultLevelsMap();
            let targetLevel = '';
            if (type === 'same') {
                targetLevel = promoCalcNextLevel(profile.position, profile.level);
            } else {
                const lvList = Array.isArray(levelMap[targetPosition]) ? levelMap[targetPosition] : [];
                targetLevel = lvList[0] || '';
            }
            if (levelEl) levelEl.value = targetLevel;
            if (!targetLevel) {
                __PROMO_TARGET_TOPICS = [];
                if (abilityEl) {
                    abilityEl.innerHTML = type === 'same'
                        ? '<span style="color:rgba(200,215,230,0.7)">当前岗位已是该线最高级，暂无更高级别可挑战，请选择「跨岗位晋升」。</span>'
                        : '<span style="color:rgba(200,215,230,0.7)">该岗位暂未配置晋升级别，请联系管理员配置。</span>';
                }
                return;
            }
            __PROMO_TARGET_TOPICS = await promoFetchPromotionRequirements(targetPosition, targetLevel);
            if (abilityEl) {
                abilityEl.innerHTML = __PROMO_TARGET_TOPICS.length
                    ? `<ul style="margin:0; padding-left:18px;">${__PROMO_TARGET_TOPICS.map(t => `<li>${escapeHtml(String(t?.title || ''))}</li>`).join('')}</ul>`
                    : '<span style="color:rgba(200,215,230,0.7)">暂无配置，请联系管理员在「培训认证 → 知识点管理」中为该岗位配置晋升能力要求。</span>';
            }
        }

        function promoFillQualificationBaseInfo() {
            const p = promoGetCurrentProfile();
            const lvEl = document.getElementById('promo-current-level');
            const teEl = document.getElementById('promo-current-tenure');
            const posEl = document.getElementById('promo-current-position');
            if (lvEl) lvEl.value = p.level || '-';
            if (teEl) teEl.value = `${Math.floor(p.tenureYears * 10) / 10} 年`;
            if (posEl) posEl.value = p.position || '-';
        }

        function promoRenderAbilityConfigEditor() {
            const hint = document.getElementById('promo-ability-config-hint');
            const canEdit = currentUser && [ROLES.ADMIN, ROLES.HQ_MANAGER].includes(String(currentUser.role || ''));
            if (hint) hint.style.display = canEdit ? '' : 'none';
        }

        function promoSwitchTab(tab) {
            __PROMOTION_TAB = (tab === 'formal') ? 'formal' : 'qualification';
            const q = document.getElementById('promotion-qualification-module');
            const f = document.getElementById('promotion-formal-module');
            const tq = document.getElementById('promo-tab-qualification');
            const tf = document.getElementById('promo-tab-formal');
            if (q) q.style.display = __PROMOTION_TAB === 'qualification' ? '' : 'none';
            if (f) f.style.display = __PROMOTION_TAB === 'formal' ? '' : 'none';
            if (tq) tq.className = __PROMOTION_TAB === 'qualification' ? 'btn' : 'btn btn-secondary';
            if (tf) tf.className = __PROMOTION_TAB === 'formal' ? 'btn' : 'btn btn-secondary';
            if (__PROMOTION_TAB === 'formal') promoRenderFormalTracks();
        }

        function promoResetQualificationForm() {
            const reasonEl = document.getElementById('promo-qualification-reason');
            const confirmEl = document.getElementById('promo-qualification-confirm');
            const typeEl = document.getElementById('promo-qualification-type');
            if (reasonEl) reasonEl.value = '';
            if (confirmEl) confirmEl.checked = false;
            if (typeEl) typeEl.value = 'same';
            promoSetTier('level_promotion');
        }

        function promoRenderFormalTracks() {
            const sel = document.getElementById('promo-formal-track');
            if (!sel || !currentUser) return;
            const tracks = Array.isArray(__PROMOTION_TRACKS) && __PROMOTION_TRACKS.length
                ? __PROMOTION_TRACKS
                : ((HRMS_STORE.ensure ? HRMS_STORE.ensure() : {})?.promotionTracks || []);
            const mine = tracks.filter(t => String(t?.applicantUsername || '').toLowerCase() === String(currentUser?.username || '').toLowerCase());
            const eligible = mine.filter(t => String(t?.assessmentStatus || '') === 'passed' && !t?.formalApplied);
            if (!eligible.length) {
                sel.innerHTML = '<option value="">暂无可申请记录（需先完成培训并通过考核）</option>';
                return;
            }
            sel.innerHTML = eligible.map(t => {
                const id = String(t?.id || '');
                const target = String(t?.targetPosition || '-');
                const lv = String(t?.targetLevel || '-');
                const dt = String(t?.createdAt || '').slice(0, 10);
                return `<option value="${escapeHtml(id)}">${escapeHtml(target)} / ${escapeHtml(lv)} / 资格通过于 ${escapeHtml(dt || '-')}</option>`;
            }).join('');
        }

        async function submitPromotionQualification() {
            if (!currentUser) return showNotification('请先登录', 'warning');
            const profile = promoGetCurrentProfile();
            const promotionType = String(document.getElementById('promo-qualification-type')?.value || '').trim();
            const targetPosition = String(document.getElementById('promo-target-position')?.value || '').trim();
            const targetLevel = __PROMO_TIER === 'skill_bump'
                ? (profile.level || '')
                : String(document.getElementById('promo-target-level')?.value || '').trim();
            const reason = String(document.getElementById('promo-qualification-reason')?.value || '').trim();
            const agreed = !!document.getElementById('promo-qualification-confirm')?.checked;

            if (!targetPosition) return showNotification('请选择目标岗位', 'warning');
            if (__PROMO_TIER === 'level_promotion' && !targetLevel) return showNotification('目标级别不能为空', 'warning');
            if (!reason) return showNotification('请填写晋升申请理由', 'warning');
            if (!agreed) return showNotification('请勾选培训与考核承诺', 'warning');

            // 技能提升：收集勾选的 topic id
            let selectedTopicIds = [];
            if (__PROMO_TIER === 'skill_bump') {
                document.querySelectorAll('#promo-capability-list input[type=checkbox]:checked').forEach(cb => {
                    const id = Number(cb.dataset.id);
                    if (id > 0) selectedTopicIds.push(id);
                });
                if (!selectedTopicIds.length) return showNotification('请至少选择一项技能', 'warning');
            }

            const reqs = Array.isArray(__PROMO_TARGET_TOPICS) ? __PROMO_TARGET_TOPICS.map(t => String(t?.title || '').trim()).filter(Boolean) : [];
            const payload = {
                promotionStage: 'qualification',
                promotionType: __PROMO_TIER === 'skill_bump' ? 'same' : (promotionType || 'same'),
                promoTier: __PROMO_TIER,
                ...__PROMO_TIER === 'skill_bump' ? { selectedTopicIds } : {},
                store: profile.store,
                department: profile.department,
                currentLevel: profile.level,
                currentPosition: profile.position,
                tenureYears: Number((profile.tenureYears || 0).toFixed(1)),
                targetPosition,
                targetLevel,
                capabilityRequirements: reqs.join('\n'),
                agreedTrainingAssess: true,
                reason
            };
            try {
                await HRMS_API.createApproval('promotion', payload);
                promoResetQualificationForm();
                await promoLoadApprovals();
                showNotification('晋升资格申请已提交', 'success');
            } catch (e) {
                showNotification('提交失败：' + String(e?.message || e), 'error');
            }
        }

        async function submitPromotionFormal() {
            if (!currentUser) return showNotification('请先登录', 'warning');
            const trackId = String(document.getElementById('promo-formal-track')?.value || '').trim();
            const reason = String(document.getElementById('promo-formal-reason')?.value || '').trim();
            if (!trackId) return showNotification('请选择资格记录', 'warning');
            if (!reason) return showNotification('请填写正式晋升申请理由', 'warning');
            const tracks = Array.isArray(__PROMOTION_TRACKS) && __PROMOTION_TRACKS.length
                ? __PROMOTION_TRACKS.slice()
                : (((HRMS_STORE.ensure ? HRMS_STORE.ensure() : {})?.promotionTracks) || []).slice();
            const track = tracks.find(t => String(t?.id || '') === trackId);
            if (!track) return showNotification('未找到资格记录', 'error');
            const payload = {
                promotionStage: 'formal',
                promotionTrackId: trackId,
                promotionType: String(track?.promotionType || '').trim(),
                store: String(track?.store || '').trim(),
                currentLevel: String(track?.currentLevel || '').trim(),
                currentPosition: String(track?.currentPosition || '').trim(),
                newLevel: String(track?.targetLevel || '').trim(),
                newPosition: String(track?.targetPosition || '').trim(),
                reason
            };
            try {
                await HRMS_API.createApproval('promotion', payload);
                const formalReasonEl = document.getElementById('promo-formal-reason');
                if (formalReasonEl) formalReasonEl.value = '';
                await promoLoadApprovals();
                await promoLoadTracks();
                showNotification('正式晋升申请已提交', 'success');
            } catch (e) {
                showNotification('提交失败：' + String(e?.message || e), 'error');
            }
        }

        function promoRenderTrackBoard() {
            const box = document.getElementById('promo-track-board');
            if (!box) return;
            const tracks = Array.isArray(__PROMOTION_TRACKS) ? __PROMOTION_TRACKS : [];
            if (!tracks.length) {
                box.innerHTML = '<div style="text-align:center;color:rgba(200,215,230,0.7);padding:18px;border:1px dashed rgba(255,255,255,0.12);border-radius:12px;">暂无培训考核记录</div>';
                return;
            }
            box.innerHTML = tracks.map(t => {
                const applicant = String(t?.applicantName || t?.applicantUsername || '-');
                const status = String(t?.status || '-');
                const assess = String(t?.assessmentStatus || 'pending');
                const assessText = assess === 'passed' ? '已通过' : '进行中';
                const progress = t?.trainingProgress && typeof t.trainingProgress === 'object' ? t.trainingProgress : null;
                const items = Array.isArray(progress?.items) ? progress.items : [];
                const progressRows = items.length ? items.map(it => {
                    const ok = !!it?.certified;
                    const validTxt = ok && it?.validUntil ? `（有效期至 ${escapeHtml(String(it.validUntil))}）` : '';
                    return `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
                        <div style="color:rgba(226,232,240,0.92);">${escapeHtml(String(it?.title || '-'))}</div>
                        <div style="color:${ok ? '#34d399' : 'rgba(200,215,230,0.6)'};">${ok ? '✅ 已认证' : '⏳ 待认证'}${validTxt}</div>
                    </div>`;
                }).join('') : '<div style="font-size:12px;color:rgba(200,215,230,0.72);">该岗位暂无配置晋升能力要求，可直接发起正式晋升申请</div>';
                return `<div style="margin-top:10px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);">
                    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                        <div style="font-weight:800;">${escapeHtml(applicant)} · ${escapeHtml(String(t?.targetPosition || '-'))}/${escapeHtml(String(t?.targetLevel || '-'))}</div>
                        <div style="font-size:12px;color:rgba(226,232,240,0.85);">状态：${escapeHtml(status)} · 培训考核：${escapeHtml(assessText)}${progress ? `（${progress.certifiedCount}/${progress.total}）` : ''}</div>
                    </div>
                    <div style="margin-top:8px;font-size:12px;color:rgba(200,215,230,0.85);">带教人：${escapeHtml(String(t?.mentorName || t?.mentorUsername || '待指定'))}${t?.trainingDueDate ? ` · 培训截止：${escapeHtml(String(t.trainingDueDate))}` : ''}</div>
                    <div style="margin-top:8px;">${progressRows}</div>
                </div>`;
            }).join('');
        }

        async function promoLoadTracks() {
            try {
                const resp = await HRMS_API.getPromotionTracks();
                __PROMOTION_TRACKS = Array.isArray(resp?.items) ? resp.items : [];
            } catch (e) {
                __PROMOTION_TRACKS = [];
            }
            promoRenderFormalTracks();
            promoRenderTrackBoard();
        }

        async function promoLoadApprovals() {
            try {
                const role = String(currentUser?.role || '').trim();
                const calls = [HRMS_API.getApprovals({ view: 'created', type: 'promotion', limit: 300 })];
                const canAssigned = [ROLES.ADMIN, ROLES.HQ_MANAGER, ROLES.HR_MANAGER, ROLES.STORE_MANAGER, ROLES.PRODUCTION_MANAGER].includes(role);
                const canAll = [ROLES.ADMIN, ROLES.HQ_MANAGER, ROLES.HR_MANAGER].includes(role);
                if (canAssigned) calls.push(HRMS_API.getApprovals({ view: 'assigned', type: 'promotion', limit: 300 }));
                if (canAll) calls.push(HRMS_API.getApprovals({ view: 'all', type: 'promotion', limit: 500 }));
                const respList = await Promise.all(calls);
                const map = new Map();
                respList.forEach(r => {
                    const items = Array.isArray(r?.items) ? r.items : [];
                    items.forEach(it => {
                        const id = String(it?.id || '').trim();
                        if (id) map.set(id, it);
                    });
                });
                __PROMOTION_APPROVALS = Array.from(map.values()).sort((a, b) => {
                    const ta = new Date(String(a?.created_at || a?.createdAt || '')).getTime() || 0;
                    const tb = new Date(String(b?.created_at || b?.createdAt || '')).getTime() || 0;
                    return tb - ta;
                });
                renderPromotionRequests();
            } catch (e) {
                __PROMOTION_APPROVALS = [];
                renderPromotionRequests();
            }
        }

        function renderPromotionRequests() {
            const tbody = document.getElementById('promotion-tbody');
            if (!tbody) return;
            const cardsEl = document.getElementById('promotion-cards');
            const all = Array.isArray(__PROMOTION_APPROVALS) ? __PROMOTION_APPROVALS : [];
            const mineOnly = !(currentUser && [ROLES.ADMIN, ROLES.HQ_MANAGER, ROLES.HR_MANAGER].includes(String(currentUser.role || '')));
            const uname = String(currentUser?.username || '').trim().toLowerCase();
            const filtered = mineOnly
                ? all.filter(r => String(r?.applicant_username || '').trim().toLowerCase() === uname)
                : all;

            const stageText = (p) => {
                const s = String(p?.promotionStage || 'qualification').trim().toLowerCase();
                return s === 'formal' ? '正式晋升' : '晋升资格';
            };
            const typeText = (p) => {
                const t = String(p?.promotionType || '').trim();
                return t === 'same' ? '同岗位晋升' : (t === 'cross' ? '跨岗位晋升' : '-');
            };
            const statusText = (s) => s === 'pending' ? '待审批' : (s === 'approved' ? '已通过' : (s === 'rejected' ? '已拒绝' : s || '-'));

            if (!filtered.length) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#888;padding:40px;">暂无申请记录</td></tr>';
                if (cardsEl) cardsEl.innerHTML = '<div style="text-align:center;color:rgba(200,215,230,0.72);padding:28px 12px;">暂无申请记录</div>';
                return;
            }

            tbody.innerHTML = filtered.map(req => {
                const p = req?.payload && typeof req.payload === 'object' ? req.payload : {};
                const created = String(req?.created_at || req?.createdAt || '').slice(0, 10);
                const badgeColor = req?.status === 'approved' ? '#22c55e' : (req?.status === 'rejected' ? '#ef4444' : '#f59e0b');
                return `<tr>
                    <td>${escapeHtml(String(req?.id || ''))}</td>
                    <td>${escapeHtml(hrmsDisplayName(req?.applicant_username))}</td>
                    <td>${escapeHtml(String(p?.store || '-'))}</td>
                    <td>${escapeHtml(stageText(p))}</td>
                    <td>${escapeHtml(typeText(p))}</td>
                    <td>${escapeHtml(String(p?.targetPosition || p?.newPosition || '-'))}</td>
                    <td>${escapeHtml(String(p?.targetLevel || p?.newLevel || '-'))}</td>
                    <td><span style="color:${badgeColor};font-weight:800;">${escapeHtml(statusText(String(req?.status || '')))}</span></td>
                    <td>${escapeHtml(hrmsDisplayName(req?.current_assignee_username || '-'))}</td>
                    <td>${escapeHtml(created || '-')}</td>
                </tr>`;
            }).join('');

            if (cardsEl) {
                cardsEl.innerHTML = filtered.map(req => {
                    const p = req?.payload && typeof req.payload === 'object' ? req.payload : {};
                    const created = String(req?.created_at || req?.createdAt || '').slice(0, 10);
                    const status = String(req?.status || '');
                    const badgeClass = status === 'pending' ? 'pending' : (status === 'approved' ? 'approved' : (status === 'rejected' ? 'rejected' : ''));
                    return `<div class="pr-card" onclick="openApprovalDetailModal('${escapeHtml(String(req?.id || ''))}')" style="cursor:pointer;">
                        <div class="pr-card-head">
                            <div style="min-width:0;">
                                <div class="pr-card-title">${escapeHtml(hrmsDisplayName(req?.applicant_username))}</div>
                                <div class="pr-card-meta">申请号 ${escapeHtml(String(req?.id || ''))} · ${escapeHtml(created || '-')}</div>
                            </div>
                            <div class="pr-badge ${badgeClass}">${escapeHtml(statusText(status))}</div>
                        </div>
                        <div class="pr-card-body">
                            <div class="pr-item"><div class="k">阶段</div><div class="v">${escapeHtml(stageText(p))}</div></div>
                            <div class="pr-item"><div class="k">类型</div><div class="v">${escapeHtml(typeText(p))}</div></div>
                            <div class="pr-item" style="grid-column:1 / -1;"><div class="k">目标岗位/级别</div><div class="v">${escapeHtml(String(p?.targetPosition || p?.newPosition || '-'))} / ${escapeHtml(String(p?.targetLevel || p?.newLevel || '-'))}</div></div>
                            <div class="pr-item"><div class="k">当前审批人</div><div class="v">${escapeHtml(hrmsDisplayName(req?.current_assignee_username || '-'))}</div></div>
                        </div>
                    </div>`;
                }).join('');
            }
        }

        function loadPromotionData() {
            promoFillQualificationBaseInfo();
            promoRenderTargetOptions();
            promoOnQualificationTypeChange();
            promoRenderAbilityConfigEditor();
            promoRenderFormalTracks();
            promoSwitchTab(__PROMOTION_TAB);
            promoLoadApprovals();
            promoLoadTracks();
        }

        function loadExamData() {
            try {
                // 权限控制：只有管理员可以看到出题设置、考试内容、安排考试按钮
                const isAdmin = isAdminUser();
                const settingsCard = document.getElementById('exam-card-settings');
                const materialCard = document.getElementById('exam-card-material');
                const aiGenerateBtn = document.getElementById('btn-ai-generate');
                const publishExamBtn = document.getElementById('btn-publish-exam');
                
                if (settingsCard) settingsCard.style.display = isAdmin ? '' : 'none';
                if (materialCard) materialCard.style.display = isAdmin ? '' : 'none';
                if (aiGenerateBtn) aiGenerateBtn.style.display = isAdmin ? '' : 'none';
                if (publishExamBtn) publishExamBtn.style.display = isAdmin ? '' : 'none';

                try { renderQuestionBankPreview(); } catch (e) { console.error('renderQuestionBankPreview error', e); }
                try { renderExamContainer(null); } catch (e) { console.error('renderExamContainer init error', e); }

                try { migrateExamResultsUsers(); } catch (e) {}

                try {
                    if (currentUser && HRMS_API.token && HRMS_API.token()) {
                        HRMS_API.getExamResults(100)
                            .then(resp => {
                                const items = Array.isArray(resp?.items) ? resp.items : [];
                                const mapped = items.map(r => ({
                                    id: String(r?.id || ''),
                                    assignmentId: r?.assignment_id == null ? null : String(r.assignment_id),
                                    user: String(r?.user_key || ''),
                                    createdAt: r?.created_at ? new Date(r.created_at).toISOString() : hrmsNowISO(),
                                    startedAt: r?.started_at ? new Date(r.started_at).toISOString() : null,
                                    submittedAt: r?.submitted_at ? new Date(r.submitted_at).toISOString() : null,
                                    timeUsedSeconds: r?.time_used_seconds == null ? null : Number(r.time_used_seconds),
                                    autoSubmitted: !!r?.auto_submitted,
                                    setIndex: r?.set_index == null ? null : Number(r.set_index),
                                    total: r?.total == null ? null : Number(r.total),
                                    correct: r?.correct == null ? null : Number(r.correct),
                                    score: r?.score == null ? null : Number(r.score),
                                    answers: Array.isArray(r?.answers) ? r.answers : []
                                })).filter(x => x.id);
                                if (mapped.length) {
                                    HRMS_STORE.setExamResults(mapped);
                                }
                                try { migrateExamResultsUsers(); } catch (e) {}
                                try { renderAssignedExams(); } catch (e) {}
                                try { renderExamResultsPanel(); } catch (e) {}
                            })
                            .catch(() => {
                                // ignore server fetch failure
                            });
                    }
                } catch (e) {}

                // 管理员可以出题和安排考试
                const canAuthor = isAdminUser();
                const canSeeBank = isAdminUser();
                const btnAi = document.getElementById('btn-ai-generate');
                if (btnAi) btnAi.style.display = canAuthor ? '' : 'none';
                const btnPublish = document.getElementById('btn-publish-exam');
                if (btnPublish) btnPublish.style.display = canAuthor ? '' : 'none';

                const bankCard = document.getElementById('exam-card-bank');
                if (bankCard) bankCard.style.display = canAuthor ? '' : 'none';

                const cardSettings = document.getElementById('exam-card-settings');
                if (cardSettings) cardSettings.style.display = canAuthor ? '' : 'none';
                const cardMaterial = document.getElementById('exam-card-material');
                if (cardMaterial) cardMaterial.style.display = canAuthor ? '' : 'none';

                loadExamConfigUI();
                applyTrainingUploadPermissions();
                try { populateExamMaterialSources(); } catch (e) { console.error(e); }
                try {
                    if (window.__HRMS_EXAM_MATERIAL_WATCHDOG) {
                        clearInterval(window.__HRMS_EXAM_MATERIAL_WATCHDOG);
                        window.__HRMS_EXAM_MATERIAL_WATCHDOG = null;
                    }
                    const startedAt = Date.now();
                    window.__HRMS_EXAM_MATERIAL_WATCHDOG = setInterval(() => {
                        try {
                            if (currentPage !== 'exam') {
                                clearInterval(window.__HRMS_EXAM_MATERIAL_WATCHDOG);
                                window.__HRMS_EXAM_MATERIAL_WATCHDOG = null;
                                return;
                            }
                            hrmsEnsureExamMaterialSources();
                            if (Date.now() - startedAt > 8000) {
                                clearInterval(window.__HRMS_EXAM_MATERIAL_WATCHDOG);
                                window.__HRMS_EXAM_MATERIAL_WATCHDOG = null;
                            }
                        } catch (e) {}
                    }, 600);
                } catch (e) {}
                try {
                    setTimeout(() => {
                        try {
                            if (currentPage !== 'exam') return;
                            populateExamMaterialSources();
                        } catch (e) { console.error(e); }
                    }, 350);
                } catch (e) {}

                try {
                    if (typeof renderAssignedTrainings === 'function') {
                        renderAssignedTrainings();
                    }
                } catch (e) {}

                try {
                    const assignments = (HRMS_STORE.getExamAssignments ? HRMS_STORE.getExamAssignments() : []) || [];
                    const mine = assignments.filter(a => examAssignmentMatchesUser(a, currentUser));
                    const keys = mine.map(a => String(a?.id || '').trim()).filter(Boolean);
                    if (keys.length && HRMS_API.token && HRMS_API.token()) {
                        HRMS_API.batchRead('exam', keys).then(() => {
                            try { refreshUnreadBadges(); } catch (e) {}
                        }).catch(() => {});
                    }
                    if (!window.__HRMS_EXAM_LIVE_WIRED) {
                        window.__HRMS_EXAM_LIVE_WIRED = true;
                        window.addEventListener('storage', (ev) => {
                            try {
                                if (!ev || ev.key !== HRMS_STORAGE_KEY) return;
                                if (currentPage !== 'exam') return;
                                try { migrateExamResultsUsers(); } catch (e) {}
                                try { renderAssignedExams(); } catch (e) {}
                                try { renderExamResultsPanel(); } catch (e) {}
                            } catch (e) {}
                        });
                    }
                } catch (e) {}

                // Short polling window to handle same-tab updates and ensure initial render.
                try {
                    if (window.__HRMS_EXAM_POLL_ID) clearInterval(window.__HRMS_EXAM_POLL_ID);
                    const startedAt = Date.now();
                    window.__HRMS_EXAM_POLL_ID = setInterval(() => {
                        try {
                            if (currentPage !== 'exam') {
                                clearInterval(window.__HRMS_EXAM_POLL_ID);
                                window.__HRMS_EXAM_POLL_ID = null;
                                return;
                            }
                            try { migrateExamResultsUsers(); } catch (e) {}
                            try { renderAssignedExams(); } catch (e) {}
                            try { renderExamResultsPanel(); } catch (e) {}
                            if (Date.now() - startedAt > 8000) {
                                clearInterval(window.__HRMS_EXAM_POLL_ID);
                                window.__HRMS_EXAM_POLL_ID = null;
                            }
                        } catch (e) {}
                    }, 800);
                } catch (e) {}

                const bankPreview = document.getElementById('question-bank-preview');
                if (bankPreview && !canSeeBank) {
                    bankPreview.textContent = '';
                }
            } catch (e) {
                console.error('loadExamData fatal error', e);
                try { populateExamMaterialSources(); } catch (e2) {}
                try {
                    if (window.__HRMS_EXAM_MATERIAL_WATCHDOG) {
                        clearInterval(window.__HRMS_EXAM_MATERIAL_WATCHDOG);
                        window.__HRMS_EXAM_MATERIAL_WATCHDOG = null;
                    }
                    const startedAt = Date.now();
                    window.__HRMS_EXAM_MATERIAL_WATCHDOG = setInterval(() => {
                        try {
                            if (currentPage !== 'exam') {
                                clearInterval(window.__HRMS_EXAM_MATERIAL_WATCHDOG);
                                window.__HRMS_EXAM_MATERIAL_WATCHDOG = null;
                                return;
                            }
                            hrmsEnsureExamMaterialSources();
                            if (Date.now() - startedAt > 8000) {
                                clearInterval(window.__HRMS_EXAM_MATERIAL_WATCHDOG);
                                window.__HRMS_EXAM_MATERIAL_WATCHDOG = null;
                            }
                        } catch (e3) {}
                    }, 600);
                } catch (e2) {}
                try {
                    if (window.__HRMS_EXAM_POLL_ID) clearInterval(window.__HRMS_EXAM_POLL_ID);
                    window.__HRMS_EXAM_POLL_ID = null;
                } catch (e2) {}
                try { renderAssignedExams(); } catch (e2) {}
                try { renderExamResultsPanel(); } catch (e2) {}
            }
        }

        function getCurrentUserKey() {
            if (!currentUser) return '';
            const canonical = getCanonicalUserKey(currentUser);
            return String(canonical || currentUser.username || currentUser.id || currentUser.name || '').trim();
        }

        function getCurrentUserKeys() {
            if (!currentUser) return [];
            const canonical = getCanonicalUserKey(currentUser);
            const keys = [canonical, currentUser.username, currentUser.id, currentUser.name]
                .map(x => String(x || '').trim())
                .filter(Boolean);
            return Array.from(new Set(keys));
        }

        function getCanonicalUserKey(user) {
            try {
                if (!user) return '';
                const byAny = buildEmployeeKeyMap();
                const rawKeys = [user.username, user.id, user.name].map(x => String(x || '').trim()).filter(Boolean);
                for (const k of rawKeys) {
                    const emp = byAny.get(hrmsNormKey(k));
                    if (emp) {
                        const canonical = String(emp?.username || emp?.id || emp?.name || '').trim();
                        if (canonical) return canonical;
                    }
                }
                return '';
            } catch (e) {
                return '';
            }
        }

        function hrmsNormKey(input) {
            return String(input || '').trim().toLowerCase();
        }

        function buildEmployeeKeyMap() {
            const employees = HRMS_STORE.getEmployees();
            const m = new Map();
            (employees || []).forEach(e => {
                const keys = [e?.username, e?.id, e?.name].map(x => String(x || '').trim()).filter(Boolean);
                keys.forEach(k => {
                    const nk = hrmsNormKey(k);
                    if (!nk) return;
                    if (!m.has(nk)) m.set(nk, e);
                });
            });
            return m;
        }

        function migrateExamResultsUsers() {
            // Best-effort migration: normalize examResults.user to canonical employee.username
            // so employee/store manager filtering works across historical data.
            try {
                const results = HRMS_STORE.getExamResults();
                if (!Array.isArray(results) || !results.length) return;

                const employees = HRMS_STORE.getEmployees();
                const byAny = new Map();
                (employees || []).forEach(e => {
                    const keys = [e?.username, e?.id, e?.name].map(x => String(x || '').trim()).filter(Boolean);
                    keys.forEach(k => {
                        const nk = hrmsNormKey(k);
                        if (!nk) return;
                        if (!byAny.has(nk)) byAny.set(nk, e);
                    });
                });

                let changed = 0;
                let unknownLeft = 0;
                const next = results.map(r => {
                    const cur = Object.assign({}, r);
                    const u = String(cur?.user || '').trim();
                    if (!u || u === 'unknown') {
                        if (u === 'unknown') unknownLeft += 1;
                        return cur;
                    }
                    const emp = byAny.get(hrmsNormKey(u));
                    if (!emp) return cur;
                    const canonical = String(emp?.username || emp?.id || emp?.name || '').trim();
                    if (canonical && canonical !== u) {
                        cur.user = canonical;
                        changed += 1;
                    }
                    return cur;
                });

                if (changed > 0) {
                    HRMS_STORE.setExamResults(next);
                }

                if (isAdminUser() && unknownLeft > 0) {
                    // Cannot safely infer unknown -> user without additional data.
                    console.warn('Exam results still have unknown user:', unknownLeft);
                }
            } catch (e) {
                console.error('migrateExamResultsUsers error', e);
            }
        }

        function getExamConfig() {
            const settings = HRMS_STORE.getSettings();
            const cfg = settings.examConfig || {};
            const normalizeTypes = (input) => {
                if (Array.isArray(input)) {
                    return input.map(x => String(x || '').trim()).filter(Boolean);
                }
                const v = String(input || '').trim();
                if (v === 'single') return ['single'];
                if (v === 'tf') return ['tf'];
                if (v === 'mix') return ['single', 'tf'];
                return [];
            };
            const types = normalizeTypes(cfg.questionTypes);
            return {
                questionTypes: types.length ? types : ['single', 'tf'],
                difficulty: String(cfg.difficulty || 'medium').trim() || 'medium',
                count: Math.max(1, Math.min(500, Number(cfg.count || 8) || 8)),
                sets: Math.max(1, Math.min(20, Number(cfg.sets || 1) || 1)),
                durationMinutes: Math.max(1, Math.min(300, Number(cfg.durationMinutes || 20) || 20))
            };
        }

        function loadExamConfigUI() {
            const cfg = getExamConfig();
            const typeEl = document.getElementById('exam-q-type');
            const diffEl = document.getElementById('exam-q-difficulty');
            const countEl = document.getElementById('exam-q-count');
            const setsEl = document.getElementById('exam-q-sets');
            if (typeEl) {
                const selected = new Set((cfg.questionTypes || []).map(x => String(x || '').trim()).filter(Boolean));
                Array.from(typeEl.querySelectorAll('input[type="checkbox"][data-qtype]')).forEach(cb => {
                    cb.checked = selected.has(String(cb.dataset.qtype || '').trim());
                });
            }
            if (diffEl) diffEl.value = String(cfg.difficulty || 'medium');
            if (countEl) countEl.value = String(Math.max(1, Math.min(500, Number(cfg.count || 8) || 8)));
            if (setsEl) setsEl.value = String(Math.max(1, Math.min(20, Number(cfg.sets || 1) || 1)));
        }

        function getExamConfigFromUI() {
            const typeWrap = document.getElementById('exam-q-type');
            const picked = typeWrap
                ? Array.from(typeWrap.querySelectorAll('input[type="checkbox"][data-qtype]'))
                    .filter(cb => cb.checked)
                    .map(cb => String(cb.dataset.qtype || '').trim())
                : [];
            const questionTypes = picked.length ? picked : ['single', 'tf'];
            const difficulty = String(document.getElementById('exam-q-difficulty')?.value || 'medium').trim() || 'medium';
            const countRaw = Number(document.getElementById('exam-q-count')?.value || 8);
            const count = Math.max(1, Math.min(500, Number.isFinite(countRaw) ? countRaw : 8));
            const setsRaw = Number(document.getElementById('exam-q-sets')?.value || 1);
            const sets = Math.max(1, Math.min(20, Number.isFinite(setsRaw) ? setsRaw : 1));
            const cfg = getExamConfig();
            return {
                questionTypes,
                difficulty,
                count,
                sets,
                durationMinutes: cfg.durationMinutes
            };
        }

        function saveExamConfig() {
            const uiCfg = getExamConfigFromUI();
            const settings = HRMS_STORE.getSettings();
            settings.examConfig = {
                questionTypes: uiCfg.questionTypes,
                difficulty: uiCfg.difficulty,
                count: uiCfg.count,
                sets: uiCfg.sets,
                durationMinutes: uiCfg.durationMinutes
            };
            HRMS_STORE.setSettings(settings);
            showNotification('已保存出题设置', 'success');
        }

        function hrmsHashString(str) {
            try {
                const s = String(str || '');
                let h = 0;
                for (let i = 0; i < s.length; i += 1) {
                    h = ((h << 5) - h) + s.charCodeAt(i);
                    h |= 0;
                }
                return Math.abs(h);
            } catch (e) {
                return 0;
            }
        }

        function hrmsBuildQuestionSets(baseQuestions, setsCount, seedPrefix) {
            const base = Array.isArray(baseQuestions) ? baseQuestions.slice() : [];
            const n = Math.max(1, Math.min(20, Number(setsCount || 1) || 1));
            if (!base.length) return [];
            const makeSet = (setIdx) => {
                const seed = hrmsMakeRunSeed(String(seedPrefix || 'exam_sets') + '_' + String(setIdx));
                const rng = hrmsSeededRng(seed);
                const qs = base.map(q => {
                    const qq = Object.assign({}, q);
                    const opts = Array.isArray(qq.options) ? qq.options.slice() : [];
                    if (opts.length >= 2) {
                        const withIndex = opts.map((v, i) => ({ v, i }));
                        hrmsShuffleInPlace(withIndex, rng);
                        const nextOpts = withIndex.map(x => x.v);
                        const idxMap = {};
                        withIndex.forEach((x, newI) => { idxMap[x.i] = newI; });
                        const mapAnswer = (ans) => {
                            if (Array.isArray(ans)) {
                                const mapped = ans.map(a => {
                                    const oldI = opts.findIndex(o => String(o) === String(a));
                                    if (oldI >= 0 && idxMap[oldI] != null) return nextOpts[idxMap[oldI]];
                                    return a;
                                });
                                return mapped;
                            }
                            const oldI = opts.findIndex(o => String(o) === String(ans));
                            if (oldI >= 0 && idxMap[oldI] != null) return nextOpts[idxMap[oldI]];
                            return ans;
                        };
                        qq.options = nextOpts;
                        qq.answer = mapAnswer(qq.answer);
                    }
                    return qq;
                });
                hrmsShuffleInPlace(qs, rng);
                return qs;
            };
            const out = [];
            for (let i = 0; i < n; i += 1) out.push(makeSet(i));
            return out;
        }

        function hrmsPickQuestionSetIndexForUser(setsCount) {
            const n = Math.max(1, Number(setsCount || 1) || 1);
            const key = getCurrentUserKey() || String(currentUser?.username || currentUser?.id || currentUser?.name || '');
            return n <= 1 ? 0 : (hrmsHashString(key) % n);
        }

        function renderExamReview(questions, answerRows, score, correct) {
            const container = document.getElementById('exam-container');
            if (!container) return;
            const qs = Array.isArray(questions) ? questions : [];
            const ans = Array.isArray(answerRows) ? answerRows : [];
            const map = new Map();
            ans.forEach((a, i) => map.set(String(a?.questionId || i), a));
            const normPicked = (p) => {
                if (Array.isArray(p)) return p.map(x => String(x || '').trim()).filter(Boolean).join('、');
                return String(p || '').trim();
            };
            const rows = qs.map((q, idx) => {
                const a = map.get(String(q?.id || idx)) || ans[idx] || {};
                const picked = normPicked(a?.picked);
                const correctA = normPicked(a?.correctAnswer ?? q?.answer);
                const ok = !!a?.isCorrect;
                const okText = ok ? '正确' : '错误';
                const okColor = ok ? 'rgba(34,197,94,0.92)' : 'rgba(239,68,68,0.92)';
                const qText = cleanExamText(String(q?.question || ''));
                return `
                    <div style="padding: 12px 0; border-bottom: 1px solid rgba(200,215,230,0.18);">
                        <div style="font-weight: 900; line-height: 1.55; color: rgba(226,232,240,0.96);">${escapeHtml(String(idx + 1) + '. ' + qText)}</div>
                        <div style="margin-top: 6px; font-size: 13px; color: rgba(200,215,230,0.82);">你的答案：${escapeHtml(picked || '（未作答）')}</div>
                        <div style="margin-top: 4px; font-size: 13px; color: rgba(200,215,230,0.82);">正确答案：${escapeHtml(correctA || '--')}</div>
                        <div style="margin-top: 6px; font-weight: 900; color: ${okColor};">${okText}</div>
                    </div>
                `;
            }).join('');

            container.innerHTML = `
                <div style="display:flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items:center; margin-bottom: 12px;">
                    <div style="font-weight: 900; color: rgba(226,232,240,0.96);">交卷解析</div>
                    <div style="font-weight: 900; color: rgba(245,158,11,0.92);">得分：${escapeHtml(String(score ?? '--'))}（${escapeHtml(String(correct ?? '--'))}/${escapeHtml(String(qs.length || '--'))}）</div>
                </div>
                <div style="border-top: 1px solid rgba(200,215,230,0.18);"></div>
                <div style="margin-top: 4px; max-height: 70vh; overflow:auto; padding-right: 4px;">${rows}</div>
            `;
        }

        function clearExamTimer() {
            if (window.__EXAM_TIMER_ID) {
                clearInterval(window.__EXAM_TIMER_ID);
                window.__EXAM_TIMER_ID = null;
            }
            window.__EXAM_END_TS = null;
        }

        function formatRemaining(seconds) {
            const s = Math.max(0, Math.floor(seconds));
            const mm = String(Math.floor(s / 60)).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            return `${mm}:${ss}`;
        }

        function updateExamTimerUI() {
            const el = document.getElementById('exam-timer');
            if (!el || !window.__EXAM_END_TS) return;
            const remaining = Math.max(0, Math.floor((window.__EXAM_END_TS - Date.now()) / 1000));
            el.textContent = '剩余时间：' + formatRemaining(remaining);
            if (remaining <= 0) {
                clearExamTimer();
                submitExam(true);
            }
        }

        function applyTrainingUploadPermissions() {
            const isAdmin = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === '管理员');
            const canUse = canUploadMaterialForExtraction();
            const btnSave = document.getElementById('btn-save-training');
            const btnClear = document.getElementById('btn-clear-training');
            const textarea = document.getElementById('training-material-text');

            const kbSel = document.getElementById('exam-kb-material');
            if (kbSel) kbSel.disabled = !canUse;
            if (btnSave) btnSave.style.display = isAdmin ? '' : 'none';
            if (btnClear) btnClear.style.display = isAdmin ? '' : 'none';

            if (textarea) textarea.readOnly = !canUse;

            if (!canUse && textarea) {
                const latest = getLatestTrainingMaterialText();
                if (latest) textarea.value = latest;
            }
        }

        function requireAdminForMaterialSave() {
            const canUse = canUploadMaterialForExtraction();
            if (!canUse) {
                showNotification('当前账号无权限操作考试资料（需管理员/出题权限）', 'warning');
                return false;
            }
            return true;
        }

        function hrmsWireClickToggleMultiSelect(selectEl) {
            if (!selectEl) return;
            if (String(selectEl.multiple) !== 'true' && selectEl.multiple !== true) return;
            if (selectEl.dataset && selectEl.dataset.kbClickToggleWired === '1') return;

            const handler = (e) => {
                try {
                    if (!e || e.button !== 0) return;
                    const opt = e.target && e.target.tagName === 'OPTION' ? e.target : null;
                    if (!opt) return;
                    e.preventDefault();
                    opt.selected = !opt.selected;
                    try {
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    } catch (e2) {
                        const ev = document.createEvent('Event');
                        ev.initEvent('change', true, true);
                        selectEl.dispatchEvent(ev);
                    }
                } catch (err) {}
            };

            selectEl.addEventListener('mousedown', handler);
            selectEl.addEventListener('touchstart', handler, { passive: false });
            if (selectEl.dataset) selectEl.dataset.kbClickToggleWired = '1';
        }

        function hrmsGetSelectedValues(selectEl) {
            if (!selectEl) return [];
            try {
                const so = selectEl.selectedOptions;
                if (so && so.length) {
                    return Array.from(so).map(o => String(o?.value || '').trim()).filter(Boolean);
                }
            } catch (e) {}
            try {
                const opts = Array.from(selectEl.options || []);
                const picked = opts.filter(o => !!o.selected).map(o => String(o?.value || '').trim()).filter(Boolean);
                if (picked.length) return picked;
            } catch (e) {}
            const v = String(selectEl.value || '').trim();
            return v ? [v] : [];
        }

        function hrmsGetSingleSelectValue(selectEl) {
            if (!selectEl) return '';
            const v = String(selectEl.value || '').trim();
            if (v) return v;
            try {
                const so = selectEl.selectedOptions;
                if (so && so.length) {
                    const vv = String(so[0]?.value || '').trim();
                    if (vv) return vv;
                }
            } catch (e) {}
            try {
                const idx = Number(selectEl.selectedIndex);
                if (Number.isFinite(idx) && idx >= 0) {
                    const opt = selectEl.options && selectEl.options[idx] ? selectEl.options[idx] : null;
                    const vv = String(opt?.value || '').trim();
                    if (vv) return vv;
                }
            } catch (e) {}
            return '';
        }

        function hrmsGetExamResultsList() {
            const results = (HRMS_STORE.getExamResults ? HRMS_STORE.getExamResults() : []) || [];
            const userKey = getCurrentUserKey();
            const isPrivileged = isAdminUser() || isHqManagerViewer();
            const visible = isPrivileged
                ? results.slice()
                : results.filter(r => String(r?.user || '') === String(userKey));

            const employees = (HRMS_STORE.getEmployees ? HRMS_STORE.getEmployees() : []) || [];
            const byKey = new Map();
            (employees || []).forEach(e => {
                const keys = [e?.username, e?.id, e?.name].map(x => String(x || '').trim()).filter(Boolean);
                keys.forEach(k => {
                    const nk = hrmsNormKey(k);
                    if (!nk) return;
                    if (!byKey.has(nk)) byKey.set(nk, e);
                });
            });
            const formatWho = (uk) => {
                const raw = String(uk || '').trim();
                if (!raw) return '';
                const emp = byKey.get(hrmsNormKey(raw));
                if (!emp) return raw;
                const name = String(emp?.name || '').trim();
                const uname = String(emp?.username || '').trim();
                if (name && uname) return `${name}(${uname})`;
                return name || uname || raw;
            };
            const formatWhen = (iso) => {
                const s = String(iso || '').trim();
                if (!s) return '';
                const d = new Date(s);
                if (!Number.isFinite(d.getTime())) return s;
                try {
                    return d.toLocaleString('zh-CN', { hour12: false });
                } catch (e) {
                    return d.toISOString().replace('T', ' ').replace('Z', '');
                }
            };

            const list = visible
                .slice()
                .sort((a, b) => String(b?.submittedAt || b?.createdAt || '').localeCompare(String(a?.submittedAt || a?.createdAt || '')))
                .slice(0, 30);

            if (!list.length) {
                box.textContent = '暂无记录。';
                return;
            }

            box.innerHTML = list.map(r => {
                const score = (r?.score == null) ? '' : String(r.score);
                const correct = (r?.correct == null) ? '' : String(r.correct);
                const total = (r?.total == null) ? '' : String(r.total);
                const who = isPrivileged ? formatWho(r?.user) : '';
                const when = formatWhen(r?.submittedAt || r?.createdAt || '');
                const line1 = [who, when].filter(Boolean).join(' · ');
                const line2 = score ? (`得分 ${score}${(correct && total) ? `（${correct}/${total}）` : ''}`) : '已提交';
                return `<div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <div style="font-weight: 800; color: rgba(226,232,240,0.95);">${escapeHtml(line2)}</div>
                    <div style="margin-top: 4px; font-size: 12px; color: rgba(200,215,230,0.78);">${escapeHtml(line1 || '')}</div>
                </div>`;
            }).join('');
        }

        function examAssignmentMatchesUser(a, user) {
            if (!a || !user) return false;
            const scope = a.scope || a.audience || {};
            const t = String(scope.type || 'all');
            if (t === 'all') return true;

            const userStore = String(user.store || '').trim();
            const userPos = String(user.position || '').trim();
            const uname = String(user.username || '').trim();

            const toArr = (v) => {
                if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
                const s = String(v || '').trim();
                return s ? [s] : [];
            };

            if (t === 'store') return toArr(scope.stores || scope.store || scope.value).includes(userStore);
            if (t === 'position') return toArr(scope.positions || scope.position || scope.value).includes(userPos);
            if (t === 'user') return toArr(scope.users || scope.user || scope.value).includes(uname);
            return true;
        }

        function renderAssignedExams() {
            const box = document.getElementById('assigned-exams');
            if (!box) return;
            if (!currentUser) {
                box.textContent = '暂无考试安排。';
                return;
            }
            const assignments = (HRMS_STORE.getExamAssignments ? HRMS_STORE.getExamAssignments() : []) || [];
            const mine = assignments.filter(a => examAssignmentMatchesUser(a, currentUser));
            const list = mine
                .slice()
                .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))
                .slice(0, 30);
            if (!list.length) {
                box.textContent = '暂无考试安排。';
                return;
            }
            box.innerHTML = list.map(a => {
                const id = String(a?.id || '');
                const title = String(a?.title || '考试');
                const when = String(a?.createdAt || '');
                const dt = when ? (new Date(when)) : null;
                const whenText = dt && Number.isFinite(dt.getTime()) ? dt.toLocaleString('zh-CN', { hour12: false }) : '';
                const dur = a?.durationMinutes ? (`时长 ${a.durationMinutes} 分钟`) : '';
                const meta = [whenText, dur].filter(Boolean).join(' · ');
                return `<div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); display:flex; justify-content: space-between; gap: 10px; align-items: center;">
                    <div style="min-width:0;">
                        <div style="font-weight: 900; color: rgba(226,232,240,0.95);">${escapeHtml(title)}</div>
                        <div style="margin-top:4px; font-size:12px; color: rgba(200,215,230,0.78);">${escapeHtml(meta)}</div>
                    </div>
                    <button class="btn btn-secondary" type="button" onclick="startAssignedExam('${escapeHtml(id)}')">开始</button>
                </div>`;
            }).join('');
        }

        function startAssignedExam(assignmentId) {
            const assignments = HRMS_STORE.getExamAssignments();
            const a = (assignments || []).find(x => String(x?.id || '') === String(assignmentId || ''));
            if (!a) {
                showNotification('未找到考试安排', 'error');
                return;
            }
            if (!examAssignmentMatchesUser(a, currentUser)) {
                showNotification('您不在该考试范围内', 'warning');
                return;
            }
            const uname = String(currentUser?.username || '').trim();
            const results = HRMS_STORE.getExamResults();
            const existing = (results || []).find(r => String(r?.assignmentId || '') === String(a.id) && String(r?.user || '') === uname);
            if (existing) {
                showNotification('该考试已提交，不可重复考试', 'warning');
                renderAssignedExams();
                return;
            }
            window.__CURRENT_EXAM_ASSIGNMENT_ID = a.id;
            window.__EXAM_STARTED_AT = Date.now();
            window.__EXAM_SUBMITTED = false;
            clearExamTimer();
            const duration = Number(a.durationMinutes || getExamConfig().durationMinutes || 20);
            window.__EXAM_END_TS = Date.now() + Math.max(1, duration) * 60 * 1000;
            const sets = Array.isArray(a?.questionSets) ? a.questionSets : [];
            const bank = sets.length ? (sets[0] || []) : (a.questions || []);
            renderExamContainer(bank);
            updateExamTimerUI();
            window.__EXAM_TIMER_ID = setInterval(updateExamTimerUI, 500);
            showNotification('考试已开始', 'info');
        }

        function publishExamAssignment() {
            if (!isAdminUser() && !(currentUser && (currentUser.role === ROLES.HR_MANAGER || currentUser.role === ROLES.HQ_MANAGER))) {
                showNotification('仅管理员或HR可批量安排培训/考试', 'warning');
                return;
            }
            const modal = document.getElementById('exam-assign-modal');
            if (!modal) return;
            const titleEl = document.getElementById('exam-assign-title');
            if (titleEl && !String(titleEl.value || '').trim()) titleEl.value = '培训考试';
            populateExamAssignModalOptions();
            syncExamAssignModalFields();
            modal.style.display = 'flex';
        }

        function closeExamAssignModal() {
            const modal = document.getElementById('exam-assign-modal');
            if (!modal) return;
            modal.style.display = 'none';
        }

        function populateExamAssignModalOptions() {
            const scopeSel = document.getElementById('exam-assign-scope-type');
            if (scopeSel && !scopeSel.options?.length) {
                scopeSel.innerHTML = `
                    <option value="all">全体</option>
                    <option value="store">按门店</option>
                    <option value="position">按岗位</option>
                    <option value="user">指定员工</option>
                `;
            }

            const storeSel = document.getElementById('exam-assign-store');
            if (storeSel) {
                const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];
                const names = Array.from(new Set(stores.map(s => String(s?.name || '').trim()).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
                storeSel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
                try { hrmsWireClickToggleMultiSelect(storeSel); } catch (e) {}
            }

            const posSel = document.getElementById('exam-assign-position');
            if (posSel) {
                const emps = (HRMS_STORE.getEmployees ? HRMS_STORE.getEmployees() : []) || [];
                const poss = Array.from(new Set(emps.map(e => String(e?.position || '').trim()).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
                posSel.innerHTML = poss.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
                try { hrmsWireClickToggleMultiSelect(posSel); } catch (e) {}
            }

            const userSel = document.getElementById('exam-assign-user');
            if (userSel) {
                const emps = (HRMS_STORE.getEmployees ? HRMS_STORE.getEmployees() : []) || [];
                const list = emps.map(e => ({
                    username: String(e?.username || '').trim(),
                    name: String(e?.name || '').trim()
                })).filter(x => x.username);
                userSel.innerHTML = list.map(x => {
                    const label = x.name || x.username;
                    return `<option value="${escapeHtml(x.username)}">${escapeHtml(label)}</option>`;
                }).join('');
                try { hrmsWireClickToggleMultiSelect(userSel); } catch (e) {}
            }

            // 填充题目套数选项
            const setIndexSel = document.getElementById('exam-assign-set-index');
            if (setIndexSel) {
                const data = HRMS_STORE.ensure();
                const sets = Array.isArray(data.questionSets) ? data.questionSets : [];
                const setsCount = sets.length || 1;
                let opts = '<option value="random">随机分配</option>';
                for (let i = 0; i < setsCount; i++) {
                    opts += `<option value="${i}">第 ${i + 1} 套</option>`;
                }
                setIndexSel.innerHTML = opts;
            }
        }

        function syncExamAssignModalFields() {
            const scope = String(document.getElementById('exam-assign-scope-type')?.value || 'all');
            const boxStore = document.getElementById('exam-assign-scope-store');
            const boxPos = document.getElementById('exam-assign-scope-position');
            const boxUser = document.getElementById('exam-assign-scope-user');
            const boxUserSets = document.getElementById('exam-assign-user-sets');
            if (boxStore) boxStore.style.display = scope === 'store' ? '' : 'none';
            if (boxPos) boxPos.style.display = scope === 'position' ? '' : 'none';
            if (boxUser) boxUser.style.display = scope === 'user' ? '' : 'none';
            if (boxUserSets) boxUserSets.style.display = 'none';
        }

        function confirmExamAssignModal() {
            if (!isAdminUser()) {
                showNotification('您没有安排考试权限', 'warning');
                return;
            }
            const title = String(document.getElementById('exam-assign-title')?.value || '').trim();
            if (!title) {
                showNotification('请输入考试标题', 'warning');
                return;
            }
            const scopeType = String(document.getElementById('exam-assign-scope-type')?.value || 'all');
            const duration = Number(document.getElementById('exam-assign-duration')?.value || 20);

            const pickValues = (selId) => {
                const sel = document.getElementById(selId);
                return sel ? Array.from(sel.selectedOptions || []).map(o => String(o?.value || '').trim()).filter(Boolean) : [];
            };

            const scope = { type: scopeType };
            if (scopeType === 'store') scope.stores = pickValues('exam-assign-store');
            if (scopeType === 'position') scope.positions = pickValues('exam-assign-position');
            if (scopeType === 'user') scope.users = pickValues('exam-assign-user');

            if (scopeType !== 'all') {
                const ok = (scope.stores && scope.stores.length) || (scope.positions && scope.positions.length) || (scope.users && scope.users.length);
                if (!ok) {
                    showNotification('请至少选择一个范围项', 'warning');
                    return;
                }
            }

            const data = HRMS_STORE.ensure();
            const sets = Array.isArray(data.questionSets) ? data.questionSets : [];
            const bankFallback = (HRMS_STORE.getQuestionBank ? HRMS_STORE.getQuestionBank() : []) || [];
            const allQuestionSets = sets.length ? sets : (bankFallback.length ? [bankFallback] : []);
            if (!allQuestionSets.length) {
                showNotification('暂无题目，请先保存资料并 AI 出题', 'warning');
                return;
            }

            // 获取选择的题目套数
            const setIndexValue = document.getElementById('exam-assign-set-index')?.value || 'random';
            let questionSets = allQuestionSets;
            let selectedSetIndex = null;
            if (setIndexValue !== 'random') {
                const idx = parseInt(setIndexValue, 10);
                if (!isNaN(idx) && idx >= 0 && idx < allQuestionSets.length) {
                    questionSets = [allQuestionSets[idx]];
                    selectedSetIndex = idx;
                }
            }

            const assignment = {
                id: 'asg_' + Date.now(),
                title,
                durationMinutes: Math.max(1, Math.min(300, Number.isFinite(duration) ? duration : 20)),
                scope,
                questionSets,
                selectedSetIndex,
                createdAt: hrmsNowISO(),
                createdBy: String(currentUser?.username || '')
            };

            const cur = (HRMS_STORE.getExamAssignments ? HRMS_STORE.getExamAssignments() : []) || [];
            HRMS_STORE.setExamAssignments([assignment, ...cur]);
            closeExamAssignModal();
            renderAssignedExams();
            showNotification('已安排考试', 'success');
        }

        function populateExamMaterialSources() {
            const sel = document.getElementById('exam-kb-material');
            if (!sel) return;
            try {
                const items = HRMS_STORE.getKnowledge();
                const canSeeAll = !!(currentUser && (isAdminUser() || isHqManagerViewer()));
                const allList = Array.isArray(items) ? items.slice() : [];
                const supported = allList.filter(it => it && (it.type === 'pdf' || it.type === 'doc' || it.type === 'txt' || it.type === 'img'));
                const visible = supported
                    .filter(it => canSeeAll || knowledgeItemMatchesUser(it, currentUser))
                    .slice()
                    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

                if (!visible.length) {
                    const allCount = allList.length;
                    const supportedCount = supported.length;
                    const role = String(currentUser?.role || '');
                    let msg = `暂无可用资料（总数${allCount}，可解析${supportedCount}，角色${role}）`;
                    if (allCount === 0) {
                        msg = `暂无可用资料（帮助：请先去知识库上传 PDF/DOCX/TXT/图片；总数0，角色${role}）`;
                    } else if (supportedCount === 0) {
                        msg = `知识库已有 ${allCount} 条内容，但仅支持 PDF/DOCX/TXT/图片 提取文本（当前多为视频，暂不支持）`;
                    } else if (!canSeeAll) {
                        msg = `知识库有 ${supportedCount} 条可解析资料，但你当前权限/范围无法使用（请管理员分发范围）`;
                    }
                    sel.innerHTML = `<option value="" disabled selected>${escapeHtml(msg)}</option>`;
                    try { sel.value = ''; } catch (e) {}
                    return;
                }

                sel.innerHTML = visible.map(it => {
                    const t = `${String(it.title || '知识资料')}（${String(it.type || '').toUpperCase()}）`;
                    return `<option value="${escapeHtml(it.id)}">${escapeHtml(t)}</option>`;
                }).join('');

                try {
                    if (!hrmsGetSelectedValues(sel).length && visible[0]) {
                        const first = Array.from(sel.options || [])[0];
                        if (first) first.selected = true;
                    }
                } catch (e) {}

                try {
                    hrmsWireClickToggleMultiSelect(sel);
                } catch (e) {}
            } catch (e) {
                const msg = '加载失败：' + String(e?.message || e);
                try {
                    sel.innerHTML = `<option value="" disabled selected>${escapeHtml(msg)}</option>`;
                } catch (e2) {
                    sel.innerHTML = '<option value="" disabled selected>加载失败</option>';
                }
                console.error(e);
            }
        }

        async function loadExamMaterialFromKnowledge() {
            if (!requireAdminForMaterialSave()) return;
            const sel = document.getElementById('exam-kb-material');
            const ids = hrmsGetSelectedValues(sel);
            if (!ids.length) {
                showNotification('请选择知识库资料（可多选）', 'warning');
                return;
            }

            const items = HRMS_STORE.getKnowledge();
            const pickedItems = ids.map(id => items.find(x => String(x?.id || '') === String(id))).filter(Boolean);
            if (!pickedItems.length) {
                showNotification('未找到资料', 'error');
                return;
            }
            const canSeeAll = !!(currentUser && (isAdminUser() || isHqManagerViewer()));
            if (!canSeeAll) {
                const denied = pickedItems.find(it => !knowledgeItemMatchesUser(it, currentUser));
                if (denied) {
                    showNotification('包含无权限资料，请调整选择', 'warning');
                    return;
                }
            }

            const textarea = document.getElementById('training-material-text');
            if (textarea) textarea.value = '';
            showNotification('正在提取文本，请稍候...', 'info');
            try {
                const chunks = [];
                const failed = [];
                for (const it of pickedItems) {
                    const label = String(it?.title || it?.fileName || it?.id || '资料');
                    try {
                        const text = await extractTextFromKnowledgeItem(it);
                        const cleaned = String(text || '').trim();
                        if (cleaned) {
                            chunks.push(cleaned);
                        } else {
                            failed.push(label + '：无可提取文本');
                        }
                    } catch (e) {
                        failed.push(label + '：' + String(e?.message || e));
                    }
                }
                const merged = chunks.join('\n\n');
                if (!merged) {
                    const msg = failed.length ? ('提取失败：' + failed.slice(0, 3).join('；') + (failed.length > 3 ? '…' : ''))
                        : '提取失败：所选资料暂不支持解析（PDF/DOCX/TXT/图片）';
                    showNotification(msg, 'warning');
                    return;
                }
                if (textarea) textarea.value = merged;
                try {
                    if (textarea) {
                        textarea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        textarea.focus({ preventScroll: true });
                    }
                } catch (e) {}
                if (failed.length) {
                    showNotification('部分资料提取失败：' + failed.slice(0, 2).join('；') + (failed.length > 2 ? '…' : ''), 'warning');
                } else {
                    showNotification('已加载资料文本', 'success');
                }
            } catch (e) {
                console.error(e);
                showNotification('提取失败：' + String(e?.message || e), 'error');
            }
        }

        function canUploadMaterialForExtraction() {
            if (!currentUser) return false;
            const r = String(currentUser.role || '').trim();
            // roles that can maintain material for question generation
            if (r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.STORE_MANAGER) return true;
            // legacy fallbacks
            if (r === '管理员' || r === '总部管理层' || r === '门店店长') return true;
            return false;
        }

        function isExamResultsViewer() {
            if (!currentUser) return false;
            const r = String(currentUser.role || '').trim();
            if (r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.STORE_MANAGER) return true;
            if (r === '管理员' || r === '总部管理层' || r === '门店店长') return true;
            return false;
        }

        function isHqManagerViewer() {
            if (!currentUser) return false;
            const r = String(currentUser.role || '').trim();
            return r === ROLES.HQ_MANAGER || r === '总部管理层';
        }

        function isStoreManagerViewer() {
            if (!currentUser) return false;
            const r = String(currentUser.role || '').trim();
            return r === ROLES.STORE_MANAGER || r === '门店店长';
        }

        function hrmsSeededRng(seed) {
            let t = Number(seed) || 0;
            t = (t + 0x6D2B79F5) | 0;
            return function () {
                t |= 0;
                t = (t + 0x6D2B79F5) | 0;
                let r = Math.imul(t ^ (t >>> 15), 1 | t);
                r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
                return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
            };
        }

        function hrmsMakeRunSeed(tag) {
            const uname = String(currentUser?.username || currentUser?.name || 'anon');
            const base = `${tag || 'run'}|${uname}|${Date.now()}|${Math.random()}`;
            let h = 2166136261;
            for (let i = 0; i < base.length; i += 1) {
                h ^= base.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return (h >>> 0);
        }

        function hrmsShuffleInPlace(arr, rng) {
            const a = Array.isArray(arr) ? arr : [];
            const r = typeof rng === 'function' ? rng : Math.random;
            for (let i = a.length - 1; i > 0; i -= 1) {
                const j = Math.floor(r() * (i + 1));
                const tmp = a[i];
                a[i] = a[j];
                a[j] = tmp;
            }
            return a;
        }

        function hrmsSample(arr, n, rng) {
            const list = Array.isArray(arr) ? arr.slice() : [];
            hrmsShuffleInPlace(list, rng);
            return list.slice(0, Math.max(0, Number(n) || 0));
        }

        const HRMS_FILE_DB = {
            async open() {
                if (window.__HRMS_FILE_DB) return window.__HRMS_FILE_DB;
                const req = indexedDB.open('hrms_files', 1);
                const db = await new Promise((resolve, reject) => {
                    req.onupgradeneeded = () => {
                        const db = req.result;
                        if (!db.objectStoreNames.contains('files')) {
                            db.createObjectStore('files', { keyPath: 'id' });
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
                });
                window.__HRMS_FILE_DB = db;
                return db;
            },
            async putFile({ id, blob, meta }) {
                const db = await this.open();
                const tx = db.transaction('files', 'readwrite');
                const store = tx.objectStore('files');
                store.put({ id, blob, meta: meta || {}, updatedAt: Date.now() });
                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => reject(tx.error || new Error('IndexedDB tx failed'));
                    tx.onabort = () => reject(tx.error || new Error('IndexedDB tx aborted'));
                });
                return id;
            },
            async getFile(id) {
                const db = await this.open();
                const tx = db.transaction('files', 'readonly');
                const store = tx.objectStore('files');
                const req = store.get(id);
                const row = await new Promise((resolve, reject) => {
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
                });
                return row;
            },
            async deleteFile(id) {
                const db = await this.open();
                const tx = db.transaction('files', 'readwrite');
                const store = tx.objectStore('files');
                store.delete(id);
                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
                    tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
                });
                return true;
            }
        };

        function isAdminUser() {
            const r = String(currentUser?.role || '').trim();
            if (r === 'admin') return true;
            if (r === '管理员' || r === '系统管理员' || r === '系统管理员（管理员）') return true;
            if (r.includes('管理员')) return true;
            return false;
        }

        const KNOWLEDGE_AGENT_TAG_PRESETS = {
            sop_advisor: ['sop', '流程', '标准', '规范'],
            data_auditor: ['数据', '审计', '异常', '标准'],
            ops_supervisor: ['审核', '检查', '图片', '卫生'],
            chief_evaluator: ['绩效', '考核', '评分', '权重'],
            appeal: ['申诉', '处理', '流程']
        };

        function getKnowledgeAgentTags(agent) {
            const key = String(agent || '').trim();
            const tags = KNOWLEDGE_AGENT_TAG_PRESETS[key];
            return Array.isArray(tags) ? tags.slice() : [];
        }

        function openKnowledgeUploadModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可上传知识库内容', 'warning');
                return;
            }
            window.__KB_UPLOAD_IN_PROGRESS = false;
            window.__KB_UPLOAD_USER_ABORTED = false;
            window.__KB_UPLOAD_ABORT_CONTROLLER = null;
            const modal = document.getElementById('knowledge-upload-modal');
            if (!modal) return;
            const title = document.getElementById('knowledge-upload-title');
            const category = document.getElementById('knowledge-upload-category');
            const type = document.getElementById('knowledge-upload-type');
            const agent = document.getElementById('knowledge-upload-agent');
            const file = document.getElementById('knowledge-upload-file');
            const status = document.getElementById('knowledge-upload-file-status');
            const aud = document.getElementById('knowledge-upload-audience-type');
            const groupName = document.getElementById('knowledge-upload-group-name');
            if (title) title.value = '';
            if (category) category.value = '';
            if (type) type.value = 'pdf';
            if (agent) agent.value = '';
            if (aud) aud.value = 'all';
            if (file) file.value = '';
            if (status) status.textContent = '';
            if (groupName) groupName.value = '';
            // Reset file zone display
            const fileIcon = document.getElementById('kb-upload-file-icon');
            const fileLabel = document.getElementById('kb-upload-file-label');
            if (fileIcon) fileIcon.textContent = '📎';
            if (fileLabel) { fileLabel.textContent = '点击选择文件'; fileLabel.style.color = '#a5b4fc'; }

            // Load existing SOP groups into selector
            (async () => {
                const sel = document.getElementById('knowledge-upload-group');
                if (!sel) return;
                try {
                    const groups = await HRMS_API.getKnowledgeGroups();
                    const opts = (groups?.items || []).map(g =>
                        `<option value="${escapeHtml(String(g.group_id || ''))}">${escapeHtml(String(g.title || ''))} (${g.file_count || 0}个文件)</option>`
                    );
                    sel.innerHTML = '<option value="">新建项目组</option>' + opts.join('');
                } catch (e) {
                    sel.innerHTML = '<option value="">新建项目组</option>';
                }
            })();

            const confirmBtn = document.getElementById('btn-knowledge-upload-confirm');
            const cancelBtn = document.getElementById('btn-knowledge-upload-cancel');
            if (confirmBtn) confirmBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
            populateKnowledgeBrandOptions('all');
            try { populateKnowledgeAudienceOptions(); } catch (e) {}
            syncKnowledgeUploadFields();
            modal.classList.add('active');
        }

        function closeKnowledgeUploadModal() {
            if (window.__KB_UPLOAD_IN_PROGRESS) {
                try {
                    const controller = window.__KB_UPLOAD_ABORT_CONTROLLER;
                    if (controller) {
                        window.__KB_UPLOAD_USER_ABORTED = true;
                        controller.abort();
                        window.__KB_UPLOAD_ABORT_CONTROLLER = null;
                        window.__KB_UPLOAD_IN_PROGRESS = false;
                        const statusEl = document.getElementById('knowledge-upload-file-status');
                        if (statusEl) statusEl.textContent = '';
                        showNotification('已取消上传，请重新上传', 'warning');
                    } else {
                    const xhr = window.__KB_UPLOAD_XHR;
                    if (xhr && xhr.readyState !== 4) {
                        xhr.abort();
                        window.__KB_UPLOAD_XHR = null;
                        window.__KB_UPLOAD_IN_PROGRESS = false;
                        const statusEl = document.getElementById('knowledge-upload-file-status');
                        if (statusEl) statusEl.textContent = '';
                        showNotification('已取消上传，请重新上传', 'warning');
                    } else {
                        showNotification('正在写入中，请稍候完成后自动关闭', 'info');
                        return;
                    }
                    }
                } catch (e) {
                    showNotification('正在写入中，请稍候完成后自动关闭', 'info');
                    return;
                }
            }
            const modal = document.getElementById('knowledge-upload-modal');
            if (!modal) return;
            modal.classList.remove('active');
            const batchCb = document.getElementById('knowledge-upload-batch');
            if (batchCb) batchCb.checked = false;
            const batchTitleGroup = document.getElementById('knowledge-upload-batch-title-group');
            if (batchTitleGroup) batchTitleGroup.style.display = 'none';
            const fileEl = document.getElementById('knowledge-upload-file');
            if (fileEl) fileEl.removeAttribute('multiple');
            const titleEl = document.getElementById('knowledge-upload-title');
            if (titleEl) { titleEl.style.display = ''; titleEl.parentElement.style.display = ''; }
        }

        function toggleKnowledgeBatchMode() {
            const batchCb = document.getElementById('knowledge-upload-batch');
            const isBatch = batchCb && batchCb.checked;
            const fileEl = document.getElementById('knowledge-upload-file');
            const titleGroup = document.getElementById('knowledge-upload-batch-title-group');
            const singleTitleWrap = document.getElementById('kb-single-title-wrap');
            const hint = document.getElementById('knowledge-upload-file-hint');
            if (isBatch) {
                if (fileEl) fileEl.setAttribute('multiple', 'multiple');
                if (titleGroup) titleGroup.style.display = '';
                // 批量模式：隐藏单文件标题输入（标题由文件名自动生成）
                if (singleTitleWrap) singleTitleWrap.style.display = 'none';
                if (hint) hint.textContent = '已开启多选模式，可同时选择多个文件（最多10个）';
            } else {
                if (fileEl) fileEl.removeAttribute('multiple');
                if (titleGroup) titleGroup.style.display = 'none';
                // 恢复单文件标题输入
                if (singleTitleWrap) singleTitleWrap.style.display = '';
                syncKnowledgeUploadFields();
            }
            const batchTitleMode = document.getElementById('knowledge-upload-batch-title-mode');
            if (batchTitleMode) {
                batchTitleMode.onchange = () => {
                    const prefixInput = document.getElementById('knowledge-upload-batch-title-prefix');
                    if (prefixInput) prefixInput.style.display = batchTitleMode.value === 'custom' ? '' : 'none';
                };
            }
        }

        function openKnowledgeEditModal(itemId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可编辑知识库内容', 'warning');
                return;
            }
            const items = HRMS_STORE.getKnowledge();
            const item = (items || []).find(x => String(x?.id || '') === String(itemId || ''));
            if (!item) {
                showNotification('未找到该资料', 'error');
                return;
            }

            const modal = document.getElementById('knowledge-edit-modal');
            if (!modal) return;

            document.getElementById('knowledge-edit-id').value = String(item.id || '');
            document.getElementById('knowledge-edit-title').value = String(item.title || '');
            document.getElementById('knowledge-edit-category').value = String(item.category || '');
            document.getElementById('knowledge-edit-scope').value = String(item.scope || 'public');
            document.getElementById('knowledge-edit-version').value = String(item.version || '');
            document.getElementById('knowledge-edit-group-name').value = String(item.groupName || getKnowledgeGroupLabel(item.groupId) || item.title || '');
            document.getElementById('knowledge-edit-audience-type').value = String(item.audience?.type || 'all');

            syncKnowledgeEditAudience();

            const audType = String(item.audience?.type || 'all');
            if (audType === 'store' && item.audience?.stores) {
                const storeList = document.getElementById('knowledge-edit-audience-store-list');
                if (storeList) {
                    (item.audience.stores || []).forEach(s => {
                        const inp = Array.from(storeList.querySelectorAll('input[name="kb-edit-aud-store"]')).find(i => String(i.value) === String(s));
                        if (inp) inp.checked = true;
                    });
                }
            }
            if (audType === 'position' && item.audience?.positions) {
                const posList = document.getElementById('knowledge-edit-audience-position-list');
                if (posList) {
                    (item.audience.positions || []).forEach(p => {
                        const inp = Array.from(posList.querySelectorAll('input[name="kb-edit-aud-pos"]')).find(i => String(i.value) === String(p));
                        if (inp) inp.checked = true;
                    });
                }
            }

            modal.classList.add('active');
        }

        function closeKnowledgeEditModal() {
            const modal = document.getElementById('knowledge-edit-modal');
            if (modal) modal.classList.remove('active');
        }

        async function openKnowledgeTransferModal(itemId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可操作', 'warning');
                return;
            }
            const items = HRMS_STORE.getKnowledge();
            const item = (items || []).find((x) => String(x?.id || '') === String(itemId || ''));
            await openKnowledgeOrganizerSheet(item?.groupId || __KB_ACTIVE_GROUP_ID || '', itemId);
        }

        function syncKnowledgeEditAudience() {
            const audType = (document.getElementById('knowledge-edit-audience-type')?.value || '').trim();
            const boxStore = document.getElementById('knowledge-edit-audience-store-box');
            const boxPos = document.getElementById('knowledge-edit-audience-position-box');
            if (boxStore) boxStore.style.display = audType === 'store' ? '' : 'none';
            if (boxPos) boxPos.style.display = audType === 'position' ? '' : 'none';

            if (audType === 'store') {
                const storeBox = document.getElementById('knowledge-edit-audience-store-list');
                if (storeBox) {
                    const prevChecked = Array.from(storeBox.querySelectorAll('input[name="kb-edit-aud-store"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean);
                    const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []).filter(s => String(s?.status || 'active') === 'active');
                    const names = new Set();
                    (stores || []).forEach(s => s && s.name && names.add(s.name));
                    const list = Array.from(names).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
                    storeBox.innerHTML = list.map(n =>
                        `<label class="kb-aud-check" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;"><input type="checkbox" name="kb-edit-aud-store" value="${escapeHtml(n)}"> <span>${escapeHtml(n)}</span></label>`
                    ).join('');
                    prevChecked.forEach(v => {
                        const inp = Array.from(storeBox.querySelectorAll('input[name="kb-edit-aud-store"]')).find(i => String(i.value) === v);
                        if (inp) inp.checked = true;
                    });
                }
            }
            if (audType === 'position') {
                const posBox = document.getElementById('knowledge-edit-audience-position-list');
                if (posBox) {
                    const prevChecked = Array.from(posBox.querySelectorAll('input[name="kb-edit-aud-pos"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean);
                    const users = (HRMS_STORE.getUsers ? HRMS_STORE.getUsers() : []) || [];
                    const emps = (HRMS_STORE.getEmployees ? HRMS_STORE.getEmployees() : []) || [];
                    const fallbackPos = ['系统管理员', '总部营运', '店长', '出品经理', '前厅经理', '门店员工', '人事经理', '出纳', '区域经理'];
                    const positions = Array.from(new Set([
                        ...users.map(u => String(u?.position || '').trim()),
                        ...emps.map(e => String(e?.position || '').trim()),
                        ...fallbackPos
                    ].filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
                    posBox.innerHTML = positions.map(p =>
                        `<label class="kb-aud-check" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;"><input type="checkbox" name="kb-edit-aud-pos" value="${escapeHtml(p)}"> <span>${escapeHtml(p)}</span></label>`
                    ).join('');
                    prevChecked.forEach(v => {
                        const inp = Array.from(posBox.querySelectorAll('input[name="kb-edit-aud-pos"]')).find(i => String(i.value) === v);
                        if (inp) inp.checked = true;
                    });
                }
            }
        }

        async function confirmKnowledgeEdit() {
            const id = (document.getElementById('knowledge-edit-id')?.value || '').trim();
            const title = (document.getElementById('knowledge-edit-title')?.value || '').trim();
            const category = (document.getElementById('knowledge-edit-category')?.value || '').trim();
            const scope = (document.getElementById('knowledge-edit-scope')?.value || 'public').trim();
            const version = (document.getElementById('knowledge-edit-version')?.value || '').trim();
            const groupName = (document.getElementById('knowledge-edit-group-name')?.value || '').trim();
            const audType = (document.getElementById('knowledge-edit-audience-type')?.value || '').trim();

            if (!title) { showNotification('请输入标题', 'warning'); return; }
            if (!category) { showNotification('请选择分类', 'warning'); return; }
            if (!groupName) { showNotification('请输入项目组名称', 'warning'); return; }
            if (!['all', 'store', 'position'].includes(audType)) { showNotification('请选择分发范围', 'warning'); return; }

            const audience = { type: audType };
            if (audType === 'store') {
                const storeBox = document.getElementById('knowledge-edit-audience-store-list');
                const stores = storeBox
                    ? Array.from(storeBox.querySelectorAll('input[name="kb-edit-aud-store"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean)
                    : [];
                if (!stores.length) { showNotification('请至少选择一个门店', 'warning'); return; }
                audience.stores = stores;
                audience.store = stores[0];
            }
            if (audType === 'position') {
                const posBox = document.getElementById('knowledge-edit-audience-position-list');
                const positions = posBox
                    ? Array.from(posBox.querySelectorAll('input[name="kb-edit-aud-pos"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean)
                    : [];
                if (!positions.length) { showNotification('请至少选择一个岗位', 'warning'); return; }
                audience.positions = positions;
                audience.position = positions[0];
            }

            const payload = { title, category, scope, audience, groupName };
            if (version) payload.version = version;

            try {
                const confirmBtn = document.getElementById('btn-knowledge-edit-confirm');
                if (confirmBtn) confirmBtn.disabled = true;
                const result = await HRMS_API.updateKnowledge(id, payload);
                if (result?.item) {
                    const items = HRMS_STORE.getKnowledge();
                    const idx = (items || []).findIndex(x => String(x?.id || '') === id);
                    const targetGroupId = idx >= 0 ? String(items[idx]?.groupId || '') : String(result?.item?.group_id || '');
                    (items || []).forEach((it) => {
                        if (targetGroupId && String(it?.groupId || '') === targetGroupId) it.groupName = groupName;
                    });
                    if (idx >= 0) {
                        items[idx].title = result.item.title;
                        items[idx].category = result.item.category;
                        items[idx].scope = result.item.scope;
                        items[idx].audience = result.item.audience;
                        items[idx].version = result.item.version;
                        items[idx].updatedAt = result.item.updated_at;
                    }
                    HRMS_STORE.setKnowledge(items);
                    closeKnowledgeEditModal();
                    await loadKnowledgeGroups();
                    renderKnowledgeList();
                    const viewerTitle = document.getElementById('knowledge-viewer-title');
                    if (viewerTitle && window.__HRMS_KB_ACTIVE_ID === id) viewerTitle.textContent = title;
                    showNotification('修改已保存', 'success');
                } else {
                    showNotification('修改失败：' + String(result?.error || '未知错误'), 'error');
                }
            } catch (e) {
                showNotification('修改失败：' + String(e?.message || e), 'error');
            } finally {
                const confirmBtn = document.getElementById('btn-knowledge-edit-confirm');
                if (confirmBtn) confirmBtn.disabled = false;
            }
        }

        function setKnowledgeUploadBusy(busy, text) {
            window.__KB_UPLOAD_IN_PROGRESS = !!busy;
            const confirmBtn = document.getElementById('btn-knowledge-upload-confirm');
            const cancelBtn = document.getElementById('btn-knowledge-upload-cancel');
            const closeBtn = document.querySelector('#knowledge-upload-modal .kb-upload-close');
            if (confirmBtn) confirmBtn.disabled = !!busy;
            if (cancelBtn) cancelBtn.disabled = false;
            if (closeBtn) closeBtn.disabled = false;
            const btnText = document.getElementById('kb-upload-btn-text');
            if (busy && text) {
                if (btnText) btnText.textContent = text;
            } else if (!busy) {
                if (btnText) btnText.textContent = '📤 上传';
            }
            const statusEl = document.getElementById('knowledge-upload-file-status');
            if (statusEl && text != null && busy) statusEl.textContent = String(text);
        }

        function renderKnowledgeUploadProgress(pct, text) {
            const statusEl = document.getElementById('knowledge-upload-file-status');
            if (!statusEl) return;
            const p = Math.max(0, Math.min(100, Number(pct || 0)));
            const label = String(text || `上传中... ${p}%`);
            statusEl.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <div style="font-size:12px;color:#c7d2e5;">${escapeHtml(label)}</div>
                    <div style="height:8px;border-radius:999px;background:rgba(255,255,255,0.14);overflow:hidden;">
                        <div style="height:100%;width:${p}%;background:linear-gradient(90deg,#4f8cff,#f59e0b);transition:width .2s ease;"></div>
                    </div>
                </div>
            `;
        }

        function populateKnowledgeAudienceOptions() {
            const storeBox = document.getElementById('knowledge-upload-audience-store-list');
            const posBox = document.getElementById('knowledge-upload-audience-position-list');
            const prevStores = storeBox ? Array.from(storeBox.querySelectorAll('input[name="kb-aud-store"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean) : [];
            const prevPos = posBox ? Array.from(posBox.querySelectorAll('input[name="kb-aud-pos"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean) : [];

            if (storeBox) {
                const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : [])
                    .filter(s => String(s?.status || 'active') === 'active');
                const names = new Set();
                (stores || []).forEach(s => s && s.name && names.add(s.name));
                const list = Array.from(names).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
                storeBox.innerHTML = list.map(n =>
                    `<label class="kb-aud-check" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;"><input type="checkbox" name="kb-aud-store" value="${escapeHtml(n)}"> <span>${escapeHtml(n)}</span></label>`
                ).join('');
                prevStores.forEach(v => {
                    const inp = Array.from(storeBox.querySelectorAll('input[name="kb-aud-store"]')).find(i => String(i.value) === v);
                    if (inp) inp.checked = true;
                });
            }

            if (posBox) {
                const users = (HRMS_STORE.getUsers ? HRMS_STORE.getUsers() : []) || [];
                const emps = (HRMS_STORE.getEmployees ? HRMS_STORE.getEmployees() : []) || [];
                const fallbackPos = ['系统管理员', '总部营运', '店长', '出品经理', '前厅经理', '门店员工', '人事经理', '出纳', '区域经理'];
                const positions = Array.from(new Set([
                    ...users.map(u => String(u?.position || '').trim()),
                    ...emps.map(e => String(e?.position || '').trim()),
                    ...fallbackPos
                ].filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
                posBox.innerHTML = positions.map(p =>
                    `<label class="kb-aud-check" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;"><input type="checkbox" name="kb-aud-pos" value="${escapeHtml(p)}"> <span>${escapeHtml(p)}</span></label>`
                ).join('');
                prevPos.forEach(v => {
                    const inp = Array.from(posBox.querySelectorAll('input[name="kb-aud-pos"]')).find(i => String(i.value) === v);
                    if (inp) inp.checked = true;
                });
            }
        }

        function syncKnowledgeUploadFields() {
            const type = (document.getElementById('knowledge-upload-type')?.value || '').trim();
            const audType = (document.getElementById('knowledge-upload-audience-type')?.value || '').trim();
            const agent = (document.getElementById('knowledge-upload-agent')?.value || '').trim();
            const groupId = (document.getElementById('knowledge-upload-group')?.value || '').trim();
            const groupNameInput = document.getElementById('knowledge-upload-group-name');
            const groupNoteEl = document.getElementById('knowledge-upload-group-note');
            const category = (document.getElementById('knowledge-upload-category')?.value || '').trim();
            const title = (document.getElementById('knowledge-upload-title')?.value || '').trim();
            const boxStore = document.getElementById('knowledge-upload-audience-store-box');
            const boxPos = document.getElementById('knowledge-upload-audience-position-box');
            if (boxStore) boxStore.style.display = audType === 'store' ? '' : 'none';
            if (boxPos) boxPos.style.display = audType === 'position' ? '' : 'none';
            if (audType === 'store' || audType === 'position') {
                try { populateKnowledgeAudienceOptions(); } catch (e) {}
            }

            const tagsEl = document.getElementById('knowledge-upload-agent-tags');
            const tags = getKnowledgeAgentTags(agent);
            if (tagsEl) {
                tagsEl.textContent = tags.length ? tags.join(' / ') : '请选择投喂Agent后自动带出标签';
            }

            // 视频摘要框仅视频类型显示
            const videoSummaryBox = document.getElementById('knowledge-upload-video-summary-box');
            if (videoSummaryBox) videoSummaryBox.style.display = type === 'video' ? '' : 'none';

            // 图片类型：标题即菜品名，更新标签和 placeholder 提示
            const titleInput = document.getElementById('knowledge-upload-title');
            const titleLabel = document.querySelector('#kb-single-title-wrap label');
            if (titleInput && titleLabel) {
                if (type === 'img') {
                    titleLabel.innerHTML = '菜品名称 <span class="req">*</span> <span style="font-size:10px;color:#fde68a;font-weight:400;">（自动来自文件名，可修改）</span>';
                    titleInput.placeholder = '例：宫保鸡丁（选文件后自动填入）';
                } else {
                    titleLabel.innerHTML = '标题 <span class="req">*</span>';
                    titleInput.placeholder = '例：门店卫生操作SOP';
                }
            }

            const hint = document.getElementById('knowledge-upload-file-hint');
            const fileEl = document.getElementById('knowledge-upload-file');
            if (hint) {
                if (type === 'video') hint.textContent = '支持：视频（mp4/mov/webm等），且必须 ≤ 500MB';
                else if (type === 'pdf') hint.textContent = '支持：PDF';
                else if (type === 'doc') hint.textContent = '支持：DOC/DOCX（推荐DOCX）';
                else if (type === 'txt') hint.textContent = '支持：TXT';
                else if (type === 'img') hint.textContent = '支持：图片（png/jpg/jpeg/webp等）· 📌 文件名即菜品名，请以菜品名命名文件（如"宫保鸡丁.jpg"）';
                else hint.textContent = '请选择文件';
            }

            if (fileEl) {
                if (type === 'video') fileEl.accept = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v,.avi';
                else if (type === 'pdf') fileEl.accept = 'application/pdf,.pdf';
                else if (type === 'doc') fileEl.accept = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                else if (type === 'txt') fileEl.accept = 'text/plain,.txt';
                else if (type === 'img') fileEl.accept = 'image/*,.png,.jpg,.jpeg,.webp,.bmp';
                else fileEl.accept = '';
            }

            if (groupNameInput) {
                const fallbackName = title || category || '';
                groupNameInput.style.display = groupId ? 'none' : '';
                if (!groupId && !String(groupNameInput.value || '').trim()) {
                    const imgHint = type === 'img' ? '例如：菜品图库 / 炒饭系列' : (fallbackName ? `新项目组名称，例如：${fallbackName}` : '新项目组名称');
                    groupNameInput.placeholder = imgHint;
                }
            }
            if (groupNoteEl) {
                if (type === 'img' && !groupId) {
                    groupNoteEl.innerHTML = '<span style=”color:#fde68a;”>💡 菜品图建议共用同一文件夹：上方先选「已有项目组」，或填写文件夹名后多次上传到同组。</span>';
                } else {
                    groupNoteEl.textContent = groupId
                        ? '已选择已有项目组，上传后会直接进入该组。要换名字请在”整理/转组”里修改。'
                        : '未选择已有项目组时，会新建一个项目组；这里的名字可自定义。';
                }
            }
        }

        function getKnowledgeUploadAudience() {
            const audType = (document.getElementById('knowledge-upload-audience-type')?.value || '').trim();
            const t = ['all', 'store', 'position'].includes(audType) ? audType : 'all';
            const audience = { type: t };
            if (t === 'store') {
                const storeBox = document.getElementById('knowledge-upload-audience-store-list');
                const stores = storeBox
                    ? Array.from(storeBox.querySelectorAll('input[name="kb-aud-store"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean)
                    : [];
                if (stores.length) {
                    audience.stores = stores;
                    audience.store = stores[0];
                }
            }
            if (t === 'position') {
                const posBox = document.getElementById('knowledge-upload-audience-position-list');
                const positions = posBox
                    ? Array.from(posBox.querySelectorAll('input[name="kb-aud-pos"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean)
                    : [];
                if (positions.length) {
                    audience.positions = positions;
                    audience.position = positions[0];
                }
            }
            return audience;
        }

        function handleKnowledgeFileSelect(event) {
            const statusEl = document.getElementById('knowledge-upload-file-status');
            if (statusEl) statusEl.textContent = '';
            const files = Array.from(event?.target?.files || []);
            if (!files.length) return;

            const batchCb = document.getElementById('knowledge-upload-batch');
            const isBatch = files.length > 1 || (batchCb && batchCb.checked);

            // Auto-toggle batch checkbox when multiple files selected
            if (files.length > 1 && batchCb && !batchCb.checked) {
                batchCb.checked = true;
                toggleKnowledgeBatchMode();
            }

            if (isBatch) {
                const maxBatchFiles = 10;
                if (files.length > maxBatchFiles) {
                    if (statusEl) statusEl.textContent = `批量上传最多 ${maxBatchFiles} 个文件，请分批上传`;
                    showNotification(`批量上传最多 ${maxBatchFiles} 个文件，请分批上传`, 'warning');
                    event.target.value = '';
                    return;
                }
                // 批量模式：显示已选择文件数量和总大小
                const total = files.length;
                const totalSize = files.reduce((sum, f) => sum + Number(f.size || 0), 0);
                let invalid = '';
                for (const file of files) {
                    if (Number(file.size || 0) > 500 * 1024 * 1024) invalid = file.name;
                }
                if (invalid) {
                    if (statusEl) statusEl.textContent = `文件过大（>500MB）：${invalid}`;
                    showNotification('部分文件超过500MB限制，请重新选择', 'warning');
                    event.target.value = '';
                    return;
                }
                if (statusEl) statusEl.textContent = `已选择 ${total} 个文件，共 ${formatFileSize(totalSize)}`;
                return;
            }

            // 单文件模式保持原有逻辑
            const file = files[0];
            const type = (document.getElementById('knowledge-upload-type')?.value || '').trim();
            const name = String(file.name || '').toLowerCase();
            const size = Number(file.size || 0);

            const isVideo = String(file.type || '').startsWith('video/') || ['.mp4', '.mov', '.webm', '.m4v', '.avi'].some(ext => name.endsWith(ext));
            const isPdf = (file.type === 'application/pdf') || name.endsWith('.pdf');
            const isTxt = (file.type === 'text/plain') || name.endsWith('.txt');
            const isDocx = name.endsWith('.docx');
            const isDoc = name.endsWith('.doc');
            const isImg = String(file.type || '').startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.bmp'].some(ext => name.endsWith(ext));

            if (type === 'video' && !isVideo) {
                if (statusEl) statusEl.textContent = '请选择视频文件';
                event.target.value = '';
                return;
            }
            if (type === 'pdf' && !isPdf) {
                if (statusEl) statusEl.textContent = '请选择 PDF 文件';
                event.target.value = '';
                return;
            }
            if (type === 'txt' && !isTxt) {
                if (statusEl) statusEl.textContent = '请选择 TXT 文件';
                event.target.value = '';
                return;
            }
            if (type === 'doc' && !(isDocx || isDoc)) {
                if (statusEl) statusEl.textContent = '请选择 DOC/DOCX 文件（推荐 DOCX）';
                event.target.value = '';
                return;
            }
            if (type === 'img' && !isImg) {
                if (statusEl) statusEl.textContent = '请选择图片文件（png/jpg/jpeg/webp等）';
                event.target.value = '';
                return;
            }
            if (type === 'video') {
                const maxSize = 500 * 1024 * 1024;
                if (size > maxSize) {
                    if (statusEl) statusEl.textContent = '视频必须 ≤ 500MB（当前：' + formatFileSize(size) + '）';
                    showNotification('视频必须 ≤ 500MB，当前文件过大', 'warning');
                    event.target.value = '';
                    return;
                }
            }
            if (size > 500 * 1024 * 1024) {
                if (statusEl) statusEl.textContent = '文件必须 ≤ 500MB（当前：' + formatFileSize(size) + '）';
                showNotification('文件必须 ≤ 500MB，当前文件过大', 'warning');
                event.target.value = '';
                return;
            }
            // 图片类型：自动用文件名（去扩展名）作为标题（即菜品名）
            if (type === 'img') {
                const titleInput = document.getElementById('knowledge-upload-title');
                if (titleInput) {
                    // 去掉扩展名作为菜品名称
                    const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
                    titleInput.value = nameWithoutExt;
                    // 触发 syncKnowledgeUploadFields 更新组名 placeholder
                    syncKnowledgeUploadFields();
                }
            }

            // Update new file zone UI
            const fileIcon = document.getElementById('kb-upload-file-icon');
            const fileLabel = document.getElementById('kb-upload-file-label');
            if (fileIcon) fileIcon.textContent = '✅';
            if (fileLabel) { fileLabel.textContent = file.name; fileLabel.style.color = '#6ee7b7'; }
            if (statusEl) statusEl.textContent = formatFileSize(size);
        }

        async function confirmKnowledgeUpload() {
            if (!isAdminUser()) {
                showNotification('仅管理员可上传知识库内容', 'warning');
                return;
            }
            const title = (document.getElementById('knowledge-upload-title')?.value || '').trim();
            const category = (document.getElementById('knowledge-upload-category')?.value || '').trim();
            const type = (document.getElementById('knowledge-upload-type')?.value || '').trim();
            const feedAgent = (document.getElementById('knowledge-upload-agent')?.value || '').trim();
            const brandId = normalizeBrandIdInput(document.getElementById('knowledge-upload-brand-id')?.value || 'all') || 'all';
            const audType = (document.getElementById('knowledge-upload-audience-type')?.value || '').trim();
            const kbScope = (document.getElementById('knowledge-upload-scope')?.value || 'public').trim();
            const version = (document.getElementById('knowledge-upload-version')?.value || '').trim();
            const isRequired = document.getElementById('knowledge-upload-required')?.checked || false;
            const quizEnabled = document.getElementById('knowledge-upload-quiz-link')?.checked || false;
            const trainingModule = (document.getElementById('knowledge-upload-training-module')?.value || '').trim();
            const groupId = (document.getElementById('knowledge-upload-group')?.value || '').trim();
            const groupName = (document.getElementById('knowledge-upload-group-name')?.value || '').trim();
            const fileInput = document.getElementById('knowledge-upload-file');
            const statusEl = document.getElementById('knowledge-upload-file-status');
            const feedTags = getKnowledgeAgentTags(feedAgent);
            const files = Array.from(fileInput?.files || []);
            const batchCb = document.getElementById('knowledge-upload-batch');
            const isBatch = files.length > 1 || (batchCb && batchCb.checked);
            const file = files[0];
            if (!isBatch && !title) {
                showNotification('请输入标题', 'warning');
                return;
            }
            if (!category) {
                showNotification('请选择分类', 'warning');
                return;
            }
            if (!feedAgent || !feedTags.length) {
                showNotification('请选择投喂Agent', 'warning');
                return;
            }
            if (!file) {
                showNotification('请选择文件', 'warning');
                return;
            }
            // 视频类型必须填写内容摘要（供AI出题使用）
            const videoSummary = type === 'video' ? (document.getElementById('knowledge-upload-video-summary')?.value || '').trim() : '';
            if (type === 'video' && !videoSummary) {
                showNotification('上传视频时必须填写"视频内容摘要"，这是AI出题的依据', 'warning');
                return;
            }
            if (!['all', 'store', 'position'].includes(audType)) {
                showNotification('请选择分发范围', 'warning');
                return;
            }

            const audience = { type: audType };
            if (audType === 'store') {
                const storeBox = document.getElementById('knowledge-upload-audience-store-list');
                const stores = storeBox
                    ? Array.from(storeBox.querySelectorAll('input[name="kb-aud-store"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean)
                    : [];
                if (!stores.length) {
                    showNotification('请至少选择一个门店', 'warning');
                    return;
                }
                audience.stores = stores;
                audience.store = stores[0];
            }
            if (audType === 'position') {
                const posBox = document.getElementById('knowledge-upload-audience-position-list');
                const positions = posBox
                    ? Array.from(posBox.querySelectorAll('input[name="kb-aud-pos"]:checked')).map(cb => String(cb.value || '').trim()).filter(Boolean)
                    : [];
                if (!positions.length) {
                    showNotification('请至少选择一个岗位', 'warning');
                    return;
                }
                audience.positions = positions;
                audience.position = positions[0];
            }

            // 批量上传模式
            if (isBatch) {
                const batchTitleMode = document.getElementById('knowledge-upload-batch-title-mode')?.value || 'filename';
                const customPrefix = (document.getElementById('knowledge-upload-batch-title-prefix')?.value || '').trim();

                if (batchTitleMode === 'custom' && !customPrefix) {
                    showNotification('请输入自定义标题前缀', 'warning');
                    return;
                }

                try {
                    setKnowledgeUploadBusy(true, '准备批量上传...');
                    const fd = new FormData();
                    fd.append('title', title);
                    fd.append('category', category);
                    fd.append('type', type);
                    fd.append('feedAgent', feedAgent);
                    fd.append('brandId', brandId);
                    fd.append('tags', JSON.stringify(feedTags));
                    fd.append('scope', kbScope);
                    if (version) fd.append('version', version);
                    fd.append('audienceType', String(audience.type || 'all'));
                    if (audience.type === 'store') {
                        fd.append('audienceStores', JSON.stringify(audience.stores || []));
                        if (audience.store) fd.append('audienceStore', String(audience.store));
                    }
                    if (audience.type === 'position') {
                        fd.append('audiencePositions', JSON.stringify(audience.positions || []));
                        if (audience.position) fd.append('audiencePosition', String(audience.position));
                    }
                    files.forEach(f => fd.append('files', f, f.name));
                    fd.append('batchTitleMode', batchTitleMode);
                    if (customPrefix) fd.append('customPrefix', customPrefix);
                    fd.append('isRequired', isRequired ? '1' : '0');
                    fd.append('quizEnabled', quizEnabled ? '1' : '0');
                    if (trainingModule) fd.append('trainingModule', trainingModule);
                    if (groupId) fd.append('groupId', groupId);
                    if (groupName) fd.append('groupName', groupName);

                    renderKnowledgeUploadProgress(1, `批量上传 ${files.length} 个文件中...`);
                    const result = await HRMS_API.batchUploadKnowledge(fd);
                    setKnowledgeUploadBusy(false);
                    closeKnowledgeUploadModal();
                    loadKnowledgeData();
                    if (result?.succeeded !== undefined) {
                        showNotification(`批量上传完成：${result.succeeded} 个成功${result.failed ? '，' + result.failed + ' 个失败' : ''}`, result.failed ? 'warning' : 'success');
                    } else {
                        showNotification('批量上传完成', 'success');
                    }
                    return;
                } catch (e) {
                    console.error(e);
                    setKnowledgeUploadBusy(false);
                    if (statusEl) statusEl.textContent = '';
                    if (window.__KB_UPLOAD_USER_ABORTED) {
                        window.__KB_UPLOAD_USER_ABORTED = false;
                        return;
                    }
                    showNotification('批量上传失败：' + String(e?.message || e), 'error');
                    return;
                }
            }

            // 单文件上传模式（原有逻辑）
            if (!title) {
                showNotification('请输入标题', 'warning');
                return;
            }

            try {
                setKnowledgeUploadBusy(true, '准备上传...');
                const size = Number(file?.size || 0);
                const useDirect = size >= 50 * 1024 * 1024;

                if (useDirect) {
                    if (statusEl) statusEl.textContent = '准备直传...';

                    try {
                        const presign = await HRMS_API.presignKnowledgeUpload({
                            originalName: file.name,
                            type,
                            mimeType: file.type || '',
                            size
                        });

                        const signedUrl = String(presign?.signedUrl || '').trim();
                        const publicUrl = String(presign?.publicUrl || '').trim();
                        const hdrs = presign?.headers || {};
                        if (!signedUrl || !publicUrl) throw new Error('直传初始化失败');

                        await new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest();
                            xhr.open('PUT', signedUrl, true);
                            try {
                                Object.keys(hdrs || {}).forEach(k => {
                                    const v = hdrs[k];
                                    if (v != null && v !== '') xhr.setRequestHeader(k, String(v));
                                });
                            } catch (e) {}
                            xhr.upload.onprogress = (ev) => {
                                if (!ev || !ev.lengthComputable) {
                                    if (statusEl) statusEl.textContent = '直传中...';
                                    return;
                                }
                                const pct = Math.max(0, Math.min(100, Math.floor((ev.loaded / ev.total) * 100)));
                                if (statusEl) statusEl.textContent = pct >= 100 ? '直传完成，处理中...' : `直传中... ${pct}%（${formatFileSize(ev.loaded)}/${formatFileSize(ev.total)}）`;
                            };
                            xhr.onerror = () => reject(new Error('直传失败（网络错误）'));
                            xhr.onload = () => {
                                if (xhr.status >= 200 && xhr.status < 300) return resolve(true);
                                return reject(new Error('直传失败：HTTP ' + xhr.status));
                            };
                            xhr.send(file);
                        });

                        if (statusEl) statusEl.textContent = '写入记录...';
                        await HRMS_API.createKnowledgeDirect({
                            title,
                            category,
                            type,
                            feedAgent,
                            brandId,
                            tags: feedTags,
                            filePath: publicUrl,
                            size,
                            scope: kbScope,
                            version: version || undefined,
                            audienceType: audience.type,
                            isRequired,
                            quizEnabled,
                            ...(groupName ? { groupName } : {}),
                            ...(groupId ? { groupId } : {}),
                            ...(trainingModule ? { trainingModule } : {}),
                            ...(videoSummary ? { videoSummary } : {}),
                            ...(audience.type === 'store' && audience.stores?.length ? { audienceStores: audience.stores } : {}),
                            ...(audience.type === 'position' && audience.positions?.length ? { audiencePositions: audience.positions } : {})
                        });

                        setKnowledgeUploadBusy(false);
                        closeKnowledgeUploadModal();
                        loadKnowledgeData();
                        showNotification('知识库内容已上传（直传）', 'success');
                        return;
                    } catch (e2) {
                        // Any presign/direct failure should fall back to server upload

                        if (statusEl) statusEl.textContent = '未配置云存储，改用服务器上传...';
                        const fd = new FormData();
                        fd.append('title', title);
                        fd.append('category', category);
                        fd.append('type', type);
                        fd.append('feedAgent', feedAgent);
                        fd.append('brandId', brandId);
                        fd.append('tags', JSON.stringify(feedTags));
                        fd.append('scope', kbScope);
                        if (version) fd.append('version', version);
                        fd.append('audienceType', String(audience.type || 'all'));
                        if (audience.type === 'store') {
                            fd.append('audienceStores', JSON.stringify(audience.stores || []));
                            if (audience.store) fd.append('audienceStore', String(audience.store));
                        }
                        if (audience.type === 'position') {
                            fd.append('audiencePositions', JSON.stringify(audience.positions || []));
                            if (audience.position) fd.append('audiencePosition', String(audience.position));
                        }
                        if (videoSummary) fd.append('videoSummary', videoSummary);
                        fd.append('isRequired', isRequired ? '1' : '0');
                        fd.append('quizEnabled', quizEnabled ? '1' : '0');
                        if (trainingModule) fd.append('trainingModule', trainingModule);
                        if (groupId) fd.append('groupId', groupId);
                        if (groupName) fd.append('groupName', groupName);
                        fd.append('file', file, file.name);
                        await HRMS_API.uploadKnowledge(fd);

                        setKnowledgeUploadBusy(false);
                        closeKnowledgeUploadModal();
                        loadKnowledgeData();
                        showNotification('知识库内容已上传', 'success');
                        return;
                    }
                } else {
                    if (statusEl) statusEl.textContent = '上传中...';

                    const fd = new FormData();
                    fd.append('title', title);
                    fd.append('category', category);
                    fd.append('type', type);
                    fd.append('feedAgent', feedAgent);
                    fd.append('brandId', brandId);
                    fd.append('tags', JSON.stringify(feedTags));
                    fd.append('scope', kbScope);
                    if (version) fd.append('version', version);

                    // Audience scope
                    fd.append('audienceType', String(audience.type || 'all'));
                    if (audience.type === 'store') {
                        fd.append('audienceStores', JSON.stringify(audience.stores || []));
                        if (audience.store) fd.append('audienceStore', String(audience.store));
                    }
                    if (audience.type === 'position') {
                        fd.append('audiencePositions', JSON.stringify(audience.positions || []));
                        if (audience.position) fd.append('audiencePosition', String(audience.position));
                    }
                    if (videoSummary) fd.append('videoSummary', videoSummary);
                    fd.append('isRequired', isRequired ? '1' : '0');
                    fd.append('quizEnabled', quizEnabled ? '1' : '0');
                    if (trainingModule) fd.append('trainingModule', trainingModule);
                    if (groupId) fd.append('groupId', groupId);
                    if (groupName) fd.append('groupName', groupName);
                    fd.append('file', file, file.name);

                    await HRMS_API.uploadKnowledge(fd);

                    setKnowledgeUploadBusy(false);
                    closeKnowledgeUploadModal();
                    loadKnowledgeData();
                    showNotification('知识库内容已上传', 'success');
                }
            } catch (e) {
                console.error(e);
                setKnowledgeUploadBusy(false);
                if (statusEl) statusEl.textContent = '';
                showNotification('上传失败：' + String(e?.message || e), 'error');
            }
        }

        function openStoreFormModal(mode, storeId) {
            const modal = document.getElementById('store-form-modal');
            if (!modal) {
                showNotification('门店表单未加载（请刷新）', 'error');
                return;
            }

            const m = ['create', 'edit', 'view'].includes(String(mode || '')) ? String(mode) : 'create';
            modal.dataset.mode = m;
            modal.dataset.id = storeId ? String(storeId) : '';

            const titleEl = document.getElementById('store-form-title');
            if (titleEl) titleEl.textContent = m === 'edit' ? '编辑门店' : (m === 'view' ? '门店详情' : '新增门店');

            const idEl = document.getElementById('store-form-id');
            const nameEl = document.getElementById('store-form-name');
            const addressEl = document.getElementById('store-form-address');
            const cityEl = document.getElementById('store-form-city');
            const floorEl = document.getElementById('store-form-floor');
            const managerEl = document.getElementById('store-form-manager');
            const phoneEl = document.getElementById('store-form-phone');
            const brandEl = document.getElementById('store-form-brand-id');
            const regionEl = document.getElementById('store-form-region');
            const openDateEl = document.getElementById('store-form-open-date');
            const statusEl = document.getElementById('store-form-status');
            const saveBtn = document.getElementById('store-form-save-btn');

            const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];
            const store = m === 'create' ? null : (stores || []).find(s => String(s?.id || '') === String(storeId || ''));
            if ((m === 'edit' || m === 'view') && !store) {
                showNotification('未找到门店', 'error');
                return;
            }

            const idValue = m === 'create' ? ('store_' + Date.now()) : String(store?.id || storeId || '');
            if (idEl) idEl.value = idValue;
            if (nameEl) nameEl.value = m === 'create' ? '' : String(store?.name || '');
            if (addressEl) addressEl.value = m === 'create' ? '' : String(store?.address || '');
            if (cityEl) cityEl.value = m === 'create' ? '' : String(store?.city || '');
            if (floorEl) floorEl.value = m === 'create' ? '' : String(store?.floor || '');
            if (managerEl) managerEl.value = m === 'create' ? '' : String(store?.managerName || store?.manager_name || '');
            if (phoneEl) phoneEl.value = m === 'create' ? '' : String(store?.phone || '');
            if (regionEl) regionEl.value = m === 'create' ? '' : String(store?.region || '');
            if (openDateEl) openDateEl.value = m === 'create' ? '' : String(store?.openDate || store?.open_date || '');
            if (statusEl) statusEl.value = store?.status ? String(store.status) : (store?.is_active === false ? 'inactive' : 'active');
            populateStoreBrandSelect(m === 'create' ? '' : String(store?.brandId || store?.brand || store?.brandName || ''));

            // 门店经营画像（原Agent控制台"门店画像"配置，改为门店自行维护，字段名保持一致以便与AI上下文同步）
            const profileFieldIds = ['positioning', 'targetCustomer', 'coreStrategy', 'bottleneck', 'businessHours', 'signatureProducts', 'competitiveAdvantage', 'serviceStyle'];
            profileFieldIds.forEach(k => { const e = document.getElementById('store-form-' + k); if (e) e.value = m === 'create' ? '' : String(store?.[k] || ''); });
            const numFieldIds = ['seats', 'tables', 'avgPrice', 'area', 'privateRooms', 'kitchenCapacity'];
            numFieldIds.forEach(k => { const e = document.getElementById('store-form-' + k); if (e) e.value = m === 'create' ? '' : (store?.[k] || ''); });
            const peakHoursEl = document.getElementById('store-form-peakHours');
            if (peakHoursEl) peakHoursEl.value = m === 'create' ? '' : (Array.isArray(store?.peakHours) ? store.peakHours.join(', ') : '');
            const lowSeasonEl = document.getElementById('store-form-lowSeasonNote');
            if (lowSeasonEl) lowSeasonEl.value = m === 'create' ? '' : String(store?.lowSeasonNote || '');
            const takeoutCb = document.getElementById('store-form-hasTakeout');
            if (takeoutCb) takeoutCb.checked = m === 'create' ? false : !!store?.hasTakeout;
            const di = (store && store.target_daily_dineIn) || {};
            const to = (store && store.target_daily_takeout) || {};
            const cs = (store && store.cost_structure) || {};
            [['di-revenue', di.revenue], ['di-orders', di.orders], ['di-avgTicket', di.avgTicket], ['di-turnover', di.turnover],
             ['to-revenue', to.revenue], ['to-orders', to.orders], ['to-avgTicket', to.avgTicket],
             ['cs-food', cs.foodCostRate], ['cs-labor', cs.laborCostRate], ['cs-rent', cs.rentCostRate], ['cs-profit', cs.targetProfitRate]
            ].forEach(([id, val]) => { const e = document.getElementById('store-form-' + id); if (e) e.value = m === 'create' ? '' : (val ?? ''); });
            const topDishesEl = document.getElementById('store-form-topDishes');
            if (topDishesEl) topDishesEl.value = m === 'create' ? '' : (Array.isArray(store?.topDishes) ? store.topDishes.map(d => [d.name, d.price, d.margin].filter(x => x !== undefined && x !== '').join(',')).join('\n') : '');
            const problemDishesEl = document.getElementById('store-form-problemDishes');
            if (problemDishesEl) problemDishesEl.value = m === 'create' ? '' : (Array.isArray(store?.problemDishes) ? store.problemDishes.map(d => typeof d === 'string' ? d : [d.name, d.note].filter(Boolean).join(',')).join('\n') : '');

            const readOnly = m === 'view';
            try {
                const profileInputs = [...profileFieldIds, ...numFieldIds, 'peakHours', 'lowSeasonNote', 'hasTakeout', 'di-revenue', 'di-orders', 'di-avgTicket', 'di-turnover', 'to-revenue', 'to-orders', 'to-avgTicket', 'cs-food', 'cs-labor', 'cs-rent', 'cs-profit', 'topDishes', 'problemDishes']
                    .map(k => document.getElementById('store-form-' + k));
                [nameEl, addressEl, cityEl, floorEl, managerEl, phoneEl, openDateEl, brandEl, regionEl, ...profileInputs].forEach(el => {
                    if (el) el.disabled = readOnly;
                });
            } catch (e) {}
            if (saveBtn) saveBtn.style.display = readOnly ? 'none' : '';

            hrmsSyncSegmentWithSelect('store-form-status-seg', 'store-form-status', readOnly);

            modal.classList.add('show');
        }

        function closeStoreFormModal() {
            const modal = document.getElementById('store-form-modal');
            if (modal) modal.classList.remove('show');
        }

        function saveStoreFormModal() {
            if (!hasPermission(PERMISSIONS.EDIT_CONTENT)) {
                showNotification('您没有门店管理权限', 'warning');
                return;
            }

            const modal = document.getElementById('store-form-modal');
            if (!modal) return;
            const mode = String(modal.dataset.mode || 'create');
            const id = String(modal.dataset.id || (document.getElementById('store-form-id')?.value || '')).trim() || ('store_' + Date.now());

            const name = (document.getElementById('store-form-name')?.value || '').trim();
            const address = (document.getElementById('store-form-address')?.value || '').trim();
            const city = (document.getElementById('store-form-city')?.value || '').trim();
            const floor = (document.getElementById('store-form-floor')?.value || '').trim();
            const managerName = (document.getElementById('store-form-manager')?.value || '').trim();
            const phone = (document.getElementById('store-form-phone')?.value || '').trim();
            const brandId = normalizeBrandIdInput(document.getElementById('store-form-brand-id')?.value || '');
            const brandName = getBrandNameById(brandId);
            const region = (document.getElementById('store-form-region')?.value || '').trim();
            const openDate = (document.getElementById('store-form-open-date')?.value || '').trim();
            const status = String(document.getElementById('store-form-status')?.value || 'active');

            if (!name) {
                showNotification('请填写门店名称', 'warning');
                return;
            }
            if (!brandId || !brandName) {
                showNotification('请选择所属品牌', 'warning');
                return;
            }

            const g = (k) => (document.getElementById('store-form-' + k)?.value || '').trim();
            const gn = (k) => { const v = g(k); return v === '' ? undefined : Number(v); };
            const peakHoursVal = g('peakHours').split(/[,，]/).map(x => x.trim()).filter(Boolean);
            const topDishesVal = g('topDishes').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
                const [dn, price, margin] = line.split(',').map(x => (x || '').trim());
                return { name: dn || '', price: Number(price) || 0, margin: Number(margin) || 0 };
            });
            const problemDishesVal = g('problemDishes').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
                const [dn, note] = line.split(',').map(x => (x || '').trim());
                return { name: dn || '', note: note || '' };
            });
            const hasTakeoutVal = !!document.getElementById('store-form-hasTakeout')?.checked;

            (async () => {
                const payload = {
                    id,
                    name,
                    address,
                    city,
                    floor,
                    managerName,
                    phone,
                    openDate,
                    status,
                    brandId,
                    brandName,
                    brand: brandName,
                    region,
                    positioning: g('positioning'),
                    targetCustomer: g('targetCustomer'),
                    coreStrategy: g('coreStrategy'),
                    bottleneck: g('bottleneck'),
                    businessHours: g('businessHours'),
                    peakHours: peakHoursVal,
                    seats: gn('seats'),
                    tables: gn('tables'),
                    avgPrice: gn('avgPrice'),
                    area: gn('area'),
                    privateRooms: gn('privateRooms'),
                    kitchenCapacity: gn('kitchenCapacity'),
                    signatureProducts: g('signatureProducts'),
                    competitiveAdvantage: g('competitiveAdvantage'),
                    serviceStyle: g('serviceStyle'),
                    lowSeasonNote: g('lowSeasonNote'),
                    hasTakeout: hasTakeoutVal,
                    target_daily_dineIn: { revenue: gn('di-revenue') || 0, orders: gn('di-orders') || 0, avgTicket: gn('di-avgTicket') || 0, turnover: gn('di-turnover') || 0 },
                    target_daily_takeout: { revenue: gn('to-revenue') || 0, orders: gn('to-orders') || 0, avgTicket: gn('to-avgTicket') || 0 },
                    cost_structure: { foodCostRate: gn('cs-food') || 0, laborCostRate: gn('cs-labor') || 0, rentCostRate: gn('cs-rent') || 0, targetProfitRate: gn('cs-profit') || 0 },
                    topDishes: topDishesVal,
                    problemDishes: problemDishesVal
                };
                if (mode === 'edit') {
                    await HRMS_API.updateStore(id, payload);
                } else {
                    await HRMS_API.createStore(payload);
                }
                const latest = await HRMS_API.getStores();
                HRMS_STORE.setStores(Array.isArray(latest?.items) ? latest.items : []);
                closeStoreFormModal();
                loadStoresData();
                try { populateKnowledgeAudienceOptions(); } catch (e) {}
                try { populateTrainingAssignModalOptions(); } catch (e) {}
                try { populateExamAssignStoreOptions(); } catch (e) {}
                try { await refreshBrandsCache(true); } catch (e) {}
                showNotification(mode === 'edit' ? '编辑门店成功' : '新增门店成功', 'success');
            })().catch((e) => {
                showNotification('保存门店失败：' + String(e?.message || e), 'error');
            });
        }

        // Track deleted built-in roles (persisted in HRMS_STORE)
        let deletedBuiltInRoles = [];
        try {
            const st = HRMS_STORE.get();
            deletedBuiltInRoles = Array.isArray(st?.deletedBuiltInRoles) ? st.deletedBuiltInRoles : [];
        } catch (e) {}

        async function deleteBuiltInRole(code) {
            if (!isAdminUser()) { showNotification('仅管理员可操作', 'warning'); return; }
            if (code === 'admin') { showNotification('不能删除管理员角色', 'warning'); return; }
            const _okBR = await hrmsConfirm({ title: '删除内置角色', message: `确定删除内置角色「${code}」？`, okText: '确认删除', icon: '🗑️' });
            if (!_okBR) return;
            if (!deletedBuiltInRoles.includes(code)) deletedBuiltInRoles.push(code);
            try {
                const st = HRMS_STORE.get() || HRMS_STORE.ensure();
                st.deletedBuiltInRoles = deletedBuiltInRoles;
                HRMS_STORE.set(st);
            } catch (e) {}
            loadRolesData();
            showNotification('已删除', 'success');
        }

        // 内置角色视图定义（基于业务需求固定，不可修改）
        const BUILTIN_ROLE_VIEWS = {
            store_employee: {
                name: '门店员工',
                views: ['我的档案', '知识库', '考试测评', '考勤打卡（只能看到自己的信息）']
            },
            store_production_manager: {
                name: '出品经理',
                views: ['我的档案', '知识库', '考试测评', '考勤打卡（只能看到自己的信息）', '分析报表中的业务报表（只能看到自己门店的）']
            },
            store_manager: {
                name: '店长',
                views: ['我的档案', '员工管理（本门店的信息）', '业务日报（本门店的信息）', '待审批', '请款（本门店信息）', '知识库', '考试测评', '奖惩管理（本门店的记录）', '考勤打卡（本门店的所有人员）', '分析报表（本门店的内容）']
            },
            hr_manager: {
                name: '总部人事',
                views: ['我的档案', '员工管理（公司所有人员）', '待审批', '知识库', '请款（只能看到自己的）', '考勤打卡（所有门店人员信息）', '考试测评', '奖惩管理（所有门店的记录）', '分析报表（只看考勤表、薪资表、离职表、所有员工的信息）']
            },
            hq_manager: {
                name: '总部营运',
                views: ['我的档案', '员工管理（公司所有人员）', '营业日报（所有门店信息）', '待审批', '请款（所有门店信息）', '知识库', '考试测评', '奖惩管理（所有门店的记录）', '考勤打卡（所有门店人员信息）', '分析报表（所有门店信息）']
            },
            cashier: {
                name: '总部出纳',
                views: ['我的档案', '请款（所有门店的请款单）', '知识库', '考勤打卡（只能看到自己的）']
            },
            admin: {
                name: '系统管理员',
                views: ['所有模块（完整权限）']
            }
        };

        function loadRolesData() {
            const grid = document.getElementById('builtin-roles-grid');
            if (!grid) return;

            let html = '';
            Object.keys(BUILTIN_ROLE_VIEWS).forEach(code => {
                const role = BUILTIN_ROLE_VIEWS[code];
                const viewsHtml = role.views.map(v => `<div style="padding:3px 0; font-size:12px; color:rgba(255,255,255,0.7);">• ${escapeHtml(v)}</div>`).join('');
                html += `<div class="card" style="padding:18px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <span style="font-size:15px; font-weight:700;">${escapeHtml(role.name)}</span>
                        <span style="font-size:10px; padding:2px 8px; border-radius:6px; background:rgba(59,130,246,0.15); color:#60a5fa;">内置</span>
                    </div>
                    <div style="font-size:12px; color:rgba(255,255,255,0.45); margin-bottom:8px;">角色代码：${escapeHtml(code)}</div>
                    <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:8px;">
                        <div style="font-size:11px; font-weight:600; color:rgba(255,255,255,0.5); margin-bottom:4px;">可见视图：</div>
                        ${viewsHtml}
                    </div>
                </div>`;
            });
            grid.innerHTML = html;
        }

        // ─── 任务和绩效 ───
        async function tpFetch(key, method, body) {
            const tok = localStorage.getItem('hrms_token') || '';
            const r = await fetch('/api/tenant-settings/' + encodeURIComponent(key), {
                method: method || 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                body: body ? JSON.stringify(body) : undefined
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        }

        function switchTpTab(tab) {
            document.querySelectorAll('.tp-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tpTab === tab));
            ['perf', 'sched', 'target'].forEach(t => {
                document.getElementById('tp-tab-' + t).classList.toggle('hidden', t !== tab);
            });
        }

        let _tpPerfConfig = null;
        let _tpRhythmItems = [];
        let _tpInspections = [];
        let _tpRandomItems = [];
        const TP_ROLE_LABELS = { store_manager: '店长', store_production_manager: '出品经理', hq_manager: '总部' };
        const TP_REF_LIST_LABELS = { deductions: '扣分说明', bonusRules: '奖金说明', storeRatings: '评级说明', executionRatings: '执行力说明', attitudeRatings: '态度说明', abilityRatings: '能力说明' };

        async function loadTaskPerformanceData() {
            try {
                const perfResp = await tpFetch('performance_eval');
                _tpPerfConfig = perfResp.config_value || {};
                const t = (_tpPerfConfig.thresholds) || {};
                const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); };
                set('tp-attitude-aMax', t.attitude?.aMax ?? 2);
                set('tp-attitude-bMax', t.attitude?.bMax ?? 4);
                set('tp-attitude-cMax', t.attitude?.cMax ?? 8);
                set('tp-pmexec-aMax', t.pmExecution?.aMax ?? 2);
                set('tp-pmexec-bMax', t.pmExecution?.bMax ?? 4);
                set('tp-pmexec-cMax', t.pmExecution?.cMax ?? 6);
                set('tp-hcmgr-aMin', t.hongchaoManagerExecution?.aMin ?? 400);
                set('tp-hcmgr-bMin', t.hongchaoManagerExecution?.bMin ?? 349);
                set('tp-hcmgr-cMin', t.hongchaoManagerExecution?.cMin ?? 300);
                set('tp-mjmgr-aMax', t.majixianManagerExecution?.aMax ?? 2);
                set('tp-mjmgr-bMax', t.majixianManagerExecution?.bMax ?? 4);
                set('tp-mjmgr-cMax', t.majixianManagerExecution?.cMax ?? 6);
                set('tp-pmability-aMin', t.pmAbility?.aMin ?? 1.01);
                set('tp-pmability-bLow', t.pmAbility?.bLow ?? -1.0);
                set('tp-pmability-bHigh', t.pmAbility?.bHigh ?? 1.0);
                set('tp-pmability-cLow', t.pmAbility?.cLow ?? -2.0);
                set('tp-hcability-A', t.managerAbility?.hongchao?.A ?? 4.6);
                set('tp-hcability-B', t.managerAbility?.hongchao?.B ?? 4.5);
                set('tp-hcability-C', t.managerAbility?.hongchao?.C ?? 4.3);
                set('tp-mjability-A', t.managerAbility?.majixian?.A ?? 4.5);
                set('tp-mjability-B', t.managerAbility?.majixian?.B ?? 4.4);
                set('tp-mjability-C', t.managerAbility?.majixian?.C ?? 4.0);
                set('tp-storerating-aMin', t.storeRating?.aMin ?? 95);
                set('tp-storerating-bMin', t.storeRating?.bMin ?? 90);
                set('tp-storerating-cMin', t.storeRating?.cMin ?? 85);

                Object.keys(TP_REF_LIST_LABELS).forEach(key => renderTpRefList(key));

                document.getElementById('tp-perf-loading').classList.add('hidden');
                document.getElementById('tp-perf-form').classList.remove('hidden');
            } catch (e) {
                document.getElementById('tp-perf-loading').textContent = '加载失败：' + (e?.message || e);
            }

            try {
                const rhythmResp = await tpFetch('rhythm_schedule');
                _tpRhythmItems = rhythmResp.config_value?.rhythmItems || [];
                if (!_tpRhythmItems.length) _tpRhythmItems = ['opening', 'closing', 'patrol', 'inventory', 'cleaning'].map(k => ({ key: k, label: k, desc: '', enabled: true }));
                renderTpRhythmList();

                const inspResp = await tpFetch('daily_inspections');
                _tpInspections = Array.isArray(inspResp.config_value) ? inspResp.config_value : (inspResp.config_value?.items || []);
                renderTpInspectionList();

                const randResp = await tpFetch('random_inspections');
                _tpRandomItems = Array.isArray(randResp.config_value) ? randResp.config_value : [];
                renderTpRandomList();

                document.getElementById('tp-sched-loading').classList.add('hidden');
                document.getElementById('tp-sched-form').classList.remove('hidden');
            } catch (e) {
                document.getElementById('tp-sched-loading').textContent = '加载失败：' + (e?.message || e);
            }

            try {
                const laborResp = await tpFetch('labor_cost_targets');
                const labor = laborResp.config_value || { '洪潮': 1200, '马己仙': 1500 };
                document.getElementById('tp-labor-hongchao').value = labor['洪潮'] ?? 1200;
                document.getElementById('tp-labor-majixian').value = labor['马己仙'] ?? 1500;
                await loadTpKpiTargets();
                document.getElementById('tp-target-loading').classList.add('hidden');
                document.getElementById('tp-target-form').classList.remove('hidden');
            } catch (e) {
                document.getElementById('tp-target-loading').textContent = '加载失败：' + (e?.message || e);
            }
        }

        // ── 目标管理：通用KPI目标（可自由新增任意metric_key，门店/品牌/公司三级） ──
        let _tpKpiTargets = [];

        async function tpKtFetch(method, path, body) {
            const tok = localStorage.getItem('hrms_token') || '';
            const r = await fetch('/api/tenant-settings/kpi-targets' + (path || ''), {
                method: method || 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
                body: body ? JSON.stringify(body) : undefined
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        }

        async function loadTpKpiTargets() {
            const resp = await tpKtFetch('GET');
            _tpKpiTargets = Array.isArray(resp.targets) ? resp.targets : [];
            renderTpKpiTargetList();
        }

        function renderTpKpiTargetList() {
            const box = document.getElementById('tp-kpi-target-list');
            if (!box) return;
            if (!_tpKpiTargets.length) {
                box.innerHTML = '<div style="color:rgba(255,255,255,0.5); padding:8px 0;">暂无自定义KPI目标</div>';
                return;
            }
            box.innerHTML = _tpKpiTargets.map((t) => `
                <div class="tp-row-item">
                    <div class="tp-grid-4">
                        <div class="tp-field">范围<div style="color:#fff; font-size:13px;">${escapeHtml(t.store || t.brand || '公司级')}</div></div>
                        <div class="tp-field">指标<div style="color:#fff; font-size:13px; font-family:monospace;">${escapeHtml(t.metric_key)}</div></div>
                        <label class="tp-field">目标值<input type="number" step="0.01" class="tp-input" value="${t.target_value ?? ''}" onchange="updateTpKpiTargetField('${t.id}','target_value',this.value)"></label>
                        <label class="tp-field">预警值<input type="number" step="0.01" class="tp-input" value="${t.warning_value ?? ''}" onchange="updateTpKpiTargetField('${t.id}','warning_value',this.value)"></label>
                    </div>
                    <div style="font-size:11px; color:rgba(255,255,255,0.4); margin-top:6px;">单位:${escapeHtml(t.unit||'-')} · ${t.direction==='lower_better'?'越低越好':'越高越好'} · ${({daily:'每日',weekly:'每周',monthly:'每月'})[t.period]||t.period}</div>
                    <div class="tp-row-actions"><button type="button" class="btn btn-danger" onclick="deleteTpKpiTarget('${t.id}')">删除</button></div>
                </div>`).join('');
        }

        async function updateTpKpiTargetField(id, field, value) {
            const t = _tpKpiTargets.find(x => String(x.id) === String(id));
            if (!t) return;
            try {
                await tpKtFetch('PUT', '', { ...t, [field]: Number(value) });
                t[field] = Number(value);
                showNotification('目标已更新', 'success');
            } catch (e) {
                showNotification('更新失败：' + (e?.message || e), 'error');
            }
        }

        async function deleteTpKpiTarget(id) {
            try {
                await tpKtFetch('DELETE', '/' + encodeURIComponent(id));
                await loadTpKpiTargets();
                showNotification('已删除', 'success');
            } catch (e) {
                showNotification('删除失败：' + (e?.message || e), 'error');
            }
        }

        async function addTpKpiTarget() {
            const metric_key = document.getElementById('tp-kt-new-metric')?.value?.trim();
            if (!metric_key) { showNotification('请填写指标key', 'warning'); return; }
            const payload = {
                store: document.getElementById('tp-kt-new-store')?.value?.trim() || null,
                brand: document.getElementById('tp-kt-new-brand')?.value || null,
                metric_key,
                period: document.getElementById('tp-kt-new-period')?.value || 'monthly',
                target_value: Number(document.getElementById('tp-kt-new-target')?.value) || 0,
                warning_value: document.getElementById('tp-kt-new-warning')?.value ? Number(document.getElementById('tp-kt-new-warning').value) : null,
                unit: document.getElementById('tp-kt-new-unit')?.value?.trim() || null,
                direction: document.getElementById('tp-kt-new-direction')?.value || 'higher_better'
            };
            try {
                await tpKtFetch('PUT', '', payload);
                await loadTpKpiTargets();
                showNotification('目标已添加', 'success');
                ['tp-kt-new-store','tp-kt-new-metric','tp-kt-new-target','tp-kt-new-warning','tp-kt-new-unit'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            } catch (e) {
                showNotification('添加失败：' + (e?.message || e), 'error');
            }
        }

        // ── 绩效核心阈值 保存 ──
        async function saveTpPerformance() {
            const num = (id) => Number(document.getElementById(id)?.value);
            const thresholds = {
                attitude: { aMax: num('tp-attitude-aMax'), bMax: num('tp-attitude-bMax'), cMax: num('tp-attitude-cMax') },
                pmExecution: { aMax: num('tp-pmexec-aMax'), bMax: num('tp-pmexec-bMax'), cMax: num('tp-pmexec-cMax') },
                hongchaoManagerExecution: { aMin: num('tp-hcmgr-aMin'), bMin: num('tp-hcmgr-bMin'), cMin: num('tp-hcmgr-cMin') },
                majixianManagerExecution: { aMax: num('tp-mjmgr-aMax'), bMax: num('tp-mjmgr-bMax'), cMax: num('tp-mjmgr-cMax') },
                pmAbility: { aMin: num('tp-pmability-aMin'), bLow: num('tp-pmability-bLow'), bHigh: num('tp-pmability-bHigh'), cLow: num('tp-pmability-cLow'), cHigh: num('tp-pmability-bLow') - 0.01 },
                managerAbility: {
                    hongchao: { A: num('tp-hcability-A'), B: num('tp-hcability-B'), C: num('tp-hcability-C') },
                    majixian: { A: num('tp-mjability-A'), B: num('tp-mjability-B'), C: num('tp-mjability-C') }
                },
                storeRating: { aMin: num('tp-storerating-aMin'), bMin: num('tp-storerating-bMin'), cMin: num('tp-storerating-cMin') }
            };
            const configValue = { ..._tpPerfConfig, thresholds };
            try {
                await tpFetch('performance_eval', 'PUT', { config_value: configValue, description: '租户前端-绩效考核规则' });
                _tpPerfConfig = configValue;
                showNotification('绩效考核规则已保存，Agent将在1分钟内按新规则执行', 'success');
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        // ── 参考备注列表（deductions/bonusRules/storeRatings/executionRatings/attitudeRatings/abilityRatings）：仅文字记录，不影响Agent ──
        function tpRefFieldsFor(key) {
            if (key === 'deductions') return [['cat', '异常类型'], ['role', '责任角色'], ['med', 'Medium扣分'], ['high', 'High扣分'], ['freq', '频率']];
            if (key === 'bonusRules') return [['brand', '品牌'], ['base', '基础奖金'], ['ruleA', 'A/B级规则'], ['ruleC', 'C级规则'], ['ruleD', 'D级规则']];
            if (key === 'storeRatings') return [['grade', '等级'], ['condition', '条件说明'], ['threshold', '阈值%']];
            if (key === 'executionRatings') return [['role', '角色'], ['desc', '评级规则描述']];
            if (key === 'attitudeRatings') return [['desc', '评判标准'], ['gradeA', 'A级条件'], ['gradeB', 'B级条件'], ['gradeC', 'C级条件']];
            if (key === 'abilityRatings') return [['role', '角色'], ['metric', '考核指标'], ['gradeA', 'A级'], ['gradeB', 'B级'], ['gradeC', 'C级'], ['gradeD', 'D级']];
            return [];
        }

        function renderTpRefList(key) {
            const box = document.getElementById('tp-ref-' + key);
            if (!box) return;
            const list = _tpPerfConfig?.[key] || [];
            const fields = tpRefFieldsFor(key);
            if (!list.length) {
                box.innerHTML = '<div style="color:rgba(255,255,255,0.5); padding:6px 0; font-size:12px;">暂无记录</div>';
                return;
            }
            box.innerHTML = list.map((item, idx) => `
                <div class="tp-row-item">
                    <div class="tp-grid-3" style="grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));">
                        ${fields.map(([f, label]) => `<label class="tp-field">${label}<input type="text" class="tp-input" value="${escapeHtml(String(item[f] ?? ''))}" onchange="updateTpRefItem('${key}',${idx},'${f}',this.value)"></label>`).join('')}
                    </div>
                    <div class="tp-row-actions"><button type="button" class="btn btn-danger" onclick="removeTpRefItem('${key}',${idx})">删除</button></div>
                </div>`).join('');
        }

        function addTpRef(key) {
            _tpPerfConfig = _tpPerfConfig || {};
            _tpPerfConfig[key] = _tpPerfConfig[key] || [];
            const blank = {}; tpRefFieldsFor(key).forEach(([f]) => blank[f] = '');
            _tpPerfConfig[key].push(blank);
            renderTpRefList(key);
        }

        function updateTpRefItem(key, idx, field, value) {
            if (_tpPerfConfig?.[key]?.[idx]) _tpPerfConfig[key][idx][field] = value;
        }

        function removeTpRefItem(key, idx) {
            _tpPerfConfig?.[key]?.splice(idx, 1);
            renderTpRefList(key);
        }

        async function saveTpRefLists() {
            try {
                await tpFetch('performance_eval', 'PUT', { config_value: _tpPerfConfig, description: '租户前端-参考备注' });
                showNotification('参考备注已保存（仅文字记录，不影响Agent执行）', 'success');
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        // ── 任务设定（自定义巡检任务类型 rhythmItems）──
        function renderTpRhythmList() {
            const box = document.getElementById('tp-rhythm-list');
            if (!box) return;
            box.innerHTML = _tpRhythmItems.map((it, idx) => `
                <div class="tp-row-item" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <label style="display:flex; align-items:center; gap:4px; font-size:12px;"><input type="checkbox" ${it.enabled !== false ? 'checked' : ''} onchange="updateTpRhythmItem(${idx},'enabled',this.checked)">启用</label>
                    <input type="text" placeholder="名称" class="tp-input" style="flex:1; min-width:100px;" value="${escapeHtml(it.label || '')}" onchange="updateTpRhythmItem(${idx},'label',this.value)">
                    <input type="text" placeholder="说明" class="tp-input" style="flex:2; min-width:140px;" value="${escapeHtml(it.desc || '')}" onchange="updateTpRhythmItem(${idx},'desc',this.value)">
                    <button type="button" class="btn btn-danger" onclick="removeTpRhythmItem(${idx})">删除</button>
                </div>`).join('');
        }

        function addTpRhythmItem() {
            _tpRhythmItems.push({ key: 'custom_' + Date.now().toString(36), label: '', desc: '', enabled: true });
            renderTpRhythmList();
        }

        function updateTpRhythmItem(idx, field, value) {
            if (_tpRhythmItems[idx]) _tpRhythmItems[idx][field] = value;
        }

        function removeTpRhythmItem(idx) {
            _tpRhythmItems.splice(idx, 1);
            renderTpRhythmList();
            renderTpInspectionList();
        }

        async function saveTpRhythmItems() {
            try {
                await tpFetch('rhythm_schedule', 'PUT', { config_value: { rhythmItems: _tpRhythmItems }, description: '租户前端-任务设定' });
                renderTpInspectionList();
                showNotification('任务设定已保存', 'success');
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        // ── 每日巡检 ──
        function renderTpInspectionList() {
            const box = document.getElementById('tp-inspection-list');
            if (!box) return;
            if (!_tpInspections.length) {
                box.innerHTML = '<div style="color:rgba(255,255,255,0.5); padding:8px 0;">暂无巡检任务，点击下方"新增"添加</div>';
                return;
            }
            box.innerHTML = _tpInspections.map((item, idx) => `
                <div class="tp-row-item">
                    <div class="tp-grid-4">
                        <label class="tp-field">门店（留空=按品牌）<input type="text" class="tp-input" value="${escapeHtml(item.store || '')}" onchange="updateTpInspection(${idx},'store',this.value)"></label>
                        <label class="tp-field">品牌<select class="tp-input" onchange="updateTpInspection(${idx},'brand',this.value)">
                            <option value="">（全部品牌）</option>
                            ${['洪潮','马己仙'].map(b => `<option value="${b}" ${item.brand===b?'selected':''}>${b}</option>`).join('')}
                        </select></label>
                        <label class="tp-field">任务类型<select class="tp-input" onchange="updateTpInspection(${idx},'type',this.value)">
                            ${_tpRhythmItems.map(it => `<option value="${escapeHtml(it.key)}" ${item.type===it.key?'selected':''}>${escapeHtml(it.label||it.key)}</option>`).join('')}
                        </select></label>
                        <label class="tp-field">时间(北京)<input type="time" class="tp-input" value="${escapeHtml(item.time || '09:00')}" onchange="updateTpInspection(${idx},'time',this.value)"></label>
                    </div>
                    <div class="tp-grid-2" style="margin-top:8px;">
                        <label class="tp-field">频率<select class="tp-input" onchange="updateTpInspection(${idx},'frequency',this.value)">
                            ${['daily','weekly','biweekly','monthly'].map(f => `<option value="${f}" ${((item.frequency||'daily')===f)?'selected':''}>${({daily:'每天',weekly:'每周',biweekly:'每两周',monthly:'每月'})[f]}</option>`).join('')}
                        </select></label>
                        <div class="tp-field">发送对象
                            <div style="display:flex; gap:10px; flex-wrap:wrap; padding-top:4px;">
                                ${Object.entries(TP_ROLE_LABELS).map(([role,label]) => `<label style="font-size:12px; display:flex; align-items:center; gap:2px;"><input type="checkbox" ${((item.assigneeRoles||[]).includes(role))?'checked':''} onchange="toggleTpInspectionRole(${idx},'${role}',this.checked)">${label}</label>`).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="tp-row-actions"><button type="button" class="btn btn-danger" onclick="removeTpInspectionItem(${idx})">删除</button></div>
                </div>`).join('');
        }

        function addTpInspectionItem() {
            _tpInspections.push({ store: '', brand: '', type: _tpRhythmItems[0]?.key || '', time: '09:00', frequency: 'daily', assigneeRoles: ['store_manager'] });
            renderTpInspectionList();
        }

        function updateTpInspection(idx, field, value) {
            if (_tpInspections[idx]) _tpInspections[idx][field] = value;
        }

        function toggleTpInspectionRole(idx, role, checked) {
            const item = _tpInspections[idx];
            if (!item) return;
            const roles = new Set(item.assigneeRoles || []);
            if (checked) roles.add(role); else roles.delete(role);
            item.assigneeRoles = Array.from(roles);
        }

        function removeTpInspectionItem(idx) {
            _tpInspections.splice(idx, 1);
            renderTpInspectionList();
        }

        async function saveTpInspections() {
            try {
                await tpFetch('daily_inspections', 'PUT', { config_value: _tpInspections, description: '租户前端-每日巡检任务' });
                showNotification('每日巡检已保存，Agent将在1分钟内按新配置执行', 'success');
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        // ── 随机抽检 ──
        function renderTpRandomList() {
            const box = document.getElementById('tp-random-list');
            if (!box) return;
            if (!_tpRandomItems.length) {
                box.innerHTML = '<div style="color:rgba(255,255,255,0.5); padding:8px 0;">暂无随机抽检项，点击下方"新增"添加</div>';
                return;
            }
            box.innerHTML = _tpRandomItems.map((item, idx) => `
                <div class="tp-row-item">
                    <div class="tp-grid-4">
                        <label class="tp-field">检查项名称<input type="text" class="tp-input" value="${escapeHtml(item.type || '')}" onchange="updateTpRandom(${idx},'type',this.value)"></label>
                        <label class="tp-field">描述<input type="text" class="tp-input" value="${escapeHtml(item.description || '')}" onchange="updateTpRandom(${idx},'description',this.value)"></label>
                        <label class="tp-field">限时(分)<input type="number" class="tp-input" value="${item.timeWindow ?? 15}" onchange="updateTpRandom(${idx},'timeWindow',Number(this.value))"></label>
                        <div class="tp-field">间隔(小时)
                            <div style="display:flex; gap:4px; align-items:center;">
                                <input type="number" class="tp-input" value="${item.intervalMinHours ?? 2}" onchange="updateTpRandom(${idx},'intervalMinHours',Number(this.value))">
                                <span>~</span>
                                <input type="number" class="tp-input" value="${item.intervalMaxHours ?? 4}" onchange="updateTpRandom(${idx},'intervalMaxHours',Number(this.value))">
                            </div>
                        </div>
                    </div>
                    <div class="tp-field" style="margin-top:8px;">发送对象（绩效归属）
                        <div style="display:flex; gap:10px; flex-wrap:wrap; padding-top:4px;">
                            ${Object.entries(TP_ROLE_LABELS).map(([role,label]) => `<label style="font-size:12px; display:flex; align-items:center; gap:2px;"><input type="checkbox" ${((item.assigneeRoles||[]).includes(role))?'checked':''} onchange="toggleTpRandomRole(${idx},'${role}',this.checked)">${label}</label>`).join('')}
                        </div>
                    </div>
                    <div class="tp-row-actions"><button type="button" class="btn btn-danger" onclick="removeTpRandomItem(${idx})">删除</button></div>
                </div>`).join('');
        }

        function addTpRandomItem() {
            _tpRandomItems.push({ type: '', description: '', timeWindow: 15, intervalMinHours: 2, intervalMaxHours: 4, assigneeRoles: ['store_production_manager'] });
            renderTpRandomList();
        }

        function updateTpRandom(idx, field, value) {
            if (_tpRandomItems[idx]) _tpRandomItems[idx][field] = value;
        }

        function toggleTpRandomRole(idx, role, checked) {
            const item = _tpRandomItems[idx];
            if (!item) return;
            const roles = new Set(item.assigneeRoles || []);
            if (checked) roles.add(role); else roles.delete(role);
            item.assigneeRoles = Array.from(roles);
        }

        function removeTpRandomItem(idx) {
            _tpRandomItems.splice(idx, 1);
            renderTpRandomList();
        }

        async function saveTpRandom() {
            try {
                await tpFetch('random_inspections', 'PUT', { config_value: _tpRandomItems, description: '租户前端-随机抽检' });
                showNotification('随机抽检已保存，Agent将在1分钟内按新配置执行', 'success');
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        // ── 目标管理：人力成本目标 ──
        async function saveTpLaborCost() {
            const laborValue = {
                '洪潮': Number(document.getElementById('tp-labor-hongchao')?.value),
                '马己仙': Number(document.getElementById('tp-labor-majixian')?.value)
            };
            try {
                await tpFetch('labor_cost_targets', 'PUT', { config_value: laborValue, description: '租户前端-人力成本目标' });
                showNotification('人力成本目标已保存', 'success');
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        function openAddRoleModal() {
            showNotification('角色已由系统内置，无需手动添加', 'info');
        }

        function editRoleName(idx) {
            if (!isAdminUser()) {
                showNotification('仅管理员可编辑角色', 'warning');
                return;
            }
            const dict = hrmsGetOrgDict();
            const arr = Array.isArray(dict.roles) ? dict.roles.slice() : [];
            if (idx < 0 || idx >= arr.length) return;
            const oldName = arr[idx];
            const newName = prompt('编辑角色名称：', oldName);
            if (!newName || !String(newName).trim() || String(newName).trim() === oldName) return;
            const val = String(newName).trim();
            if (arr.some((x, i) => i !== idx && String(x).toLowerCase() === val.toLowerCase())) {
                showNotification('该角色名称已存在', 'warning');
                return;
            }
            // Migrate permissions from old code to new code
            const oldCode = 'custom_' + oldName.replace(/\s+/g, '_');
            const newCode = 'custom_' + val.replace(/\s+/g, '_');
            const rolePerms = getRolePermissions();
            if (rolePerms[oldCode] && oldCode !== newCode) {
                rolePerms[newCode] = rolePerms[oldCode];
                delete rolePerms[oldCode];
                setRolePermissions(rolePerms);
            }
            arr[idx] = val;
            dict.roles = arr;
            hrmsSetOrgDict(dict);
            loadRolesData();
            showNotification(`角色已重命名为「${val}」`, 'success');
        }

        async function deleteCustomRole(idx) {
            if (!isAdminUser()) {
                showNotification('仅管理员可删除角色', 'warning');
                return;
            }
            const dict = hrmsGetOrgDict();
            const arr = Array.isArray(dict.roles) ? dict.roles.slice() : [];
            if (idx < 0 || idx >= arr.length) return;
            const roleName = arr[idx];
            const _okCR = await hrmsConfirm({ title: '删除自定义角色', message: `确定删除自定义角色「${roleName}」？删除后该角色的权限配置也会被清除。`, okText: '确认删除', icon: '🗑️' });
            if (!_okCR) return;
            const roleCode = 'custom_' + roleName.replace(/\s+/g, '_');
            const rolePerms = getRolePermissions();
            if (rolePerms[roleCode]) {
                delete rolePerms[roleCode];
                setRolePermissions(rolePerms);
            }
            arr.splice(idx, 1);
            dict.roles = arr;
            hrmsSetOrgDict(dict);
            loadRolesData();
            showNotification(`角色「${roleName}」已删除`, 'success');
        }

        async function toggleRoleStatus(roleId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可操作', 'warning');
                return;
            }
            const id = String(roleId || '').trim();
            if (!id) return;
            const roles = HRMS_STORE.getRoles();
            const idx = (roles || []).findIndex(r => String(r?.id || '') === id);
            if (idx < 0) {
                showNotification('未找到角色', 'error');
                return;
            }
            const cur = roles[idx];
            const next = String(cur.status || 'active') === 'active' ? 'inactive' : 'active';
            const _okRS = await hrmsConfirm({ title: '修改角色状态', message: `确定要将角色「${cur.name || id}」${next === 'active' ? '启用' : '禁用'}吗？`, okText: next === 'active' ? '确认启用' : '确认禁用', icon: next === 'active' ? '✅' : '🚫' });
            if (!_okRS) return;
            roles[idx] = { ...cur, status: next };
            HRMS_STORE.setRoles(roles);
            loadRolesData();
            showNotification('状态已更新', 'success');
        }
        
        // 加载设置数据
        function loadSettingsData() {
            backToSettingsOverview();
            const settings = HRMS_STORE.getSettings();
            renderAiConfigPanel();

            const basic = settings.basic || {};
            const sec = settings.security || {};
            const systemNameEl = document.getElementById('settings-system-name');
            const companyNameEl = document.getElementById('settings-company-name');
            const pwEl = document.getElementById('settings-password-policy');
            const lockEl = document.getElementById('settings-lock-policy');
            const sessionEl = document.getElementById('settings-session-timeout');

            if (systemNameEl) systemNameEl.value = Object.prototype.hasOwnProperty.call(basic, 'systemName') ? String(basic.systemName || '') : (systemNameEl.value || '');
            if (companyNameEl) companyNameEl.value = Object.prototype.hasOwnProperty.call(basic, 'companyName') ? String(basic.companyName || '') : (companyNameEl.value || '');

            if (pwEl) pwEl.value = String(sec.passwordPolicy || pwEl.value || 'high');
            if (lockEl) lockEl.value = String(sec.lockPolicy || lockEl.value || '3_30m');
            if (sessionEl) sessionEl.value = String(sec.sessionTimeout || sessionEl.value || '30m');

            const dictCard = document.getElementById('org-dict-settings-card');
            if (dictCard) dictCard.style.display = isAdminUser() ? '' : 'none';

            const mtCard = document.getElementById('monthly-target-settings-card');
            if (mtCard) mtCard.style.display = isAdminUser() ? '' : 'none';

            const afCard = document.getElementById('approval-flow-settings-card');
            if (afCard) afCard.style.display = isAdminUser() ? '' : 'none';

            const pointsCard = document.getElementById('points-rule-settings-card');
            if (pointsCard) pointsCard.style.display = isAdminUser() ? '' : 'none';

            const brandsCard = document.getElementById('brands-settings-card');
            if (brandsCard) brandsCard.style.display = isAdminUser() ? '' : 'none';

            const dutyCard = document.getElementById('store-duty-settings-card');
            if (dutyCard) dutyCard.style.display = isAdminUser() ? '' : 'none';

            const pgCard = document.getElementById('permission-groups-settings-card');
            if (pgCard) pgCard.style.display = isAdminUser() ? '' : 'none';

            refreshBrandsCache(true).then(() => {
                const s = document.getElementById('brands-settings-summary');
                if (s) {
                    s.textContent = `当前品牌数：${(__BRANDS_CACHE || []).length}（${(__BRANDS_CACHE || []).map((b) => b.name).join(' / ') || '-' }）`;
                }
                if (isAdminUser()) loadPermissionGroupsForSettings();
            });

            if (isAdminUser()) renderApprovalFlowSummary();
            if (isAdminUser()) loadPointRulesSettings();
            if (isAdminUser()) { renderDutyBindingStoreOptions(); loadStoreDutyBindings(); }
        }

        function closeBrandSettingsModal() {
            const modal = document.getElementById('brand-settings-modal');
            if (modal) {
                modal.classList.remove('show');
                modal.style.display = '';
            }
        }

        function resetBrandForm() {
            __BRAND_FORM_EDITING_ID = '';
            const idEl = document.getElementById('brand-form-id');
            const nameEl = document.getElementById('brand-form-name');
            const storesEl = document.getElementById('brand-form-stores');
            const sEl = document.getElementById('brand-form-status');
            if (idEl) idEl.value = '';
            if (nameEl) nameEl.value = '';
            if (storesEl) {
                try { storesEl.querySelectorAll('input[type="checkbox"]').forEach((x) => { x.checked = false; }); } catch (e) {}
            }
            if (sEl) sEl.textContent = '';
        }

        function brandFormSyncIdFromName() {
            const idEl = document.getElementById('brand-form-id');
            const nameEl = document.getElementById('brand-form-name');
            if (!idEl || !nameEl) return;
            if (__BRAND_FORM_EDITING_ID) {
                idEl.value = __BRAND_FORM_EDITING_ID;
                return;
            }
            const rawName = String(nameEl.value || '').trim();
            idEl.value = rawName ? normalizeBrandIdInput(rawName) : '';
        }

        function renderBrandStoreChecklist(selectedBrandId) {
            const box = document.getElementById('brand-form-stores');
            if (!box) return;
            const bid = normalizeBrandIdInput(selectedBrandId);
            const storesAll = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : (HRMS_STORE.ensure().stores || []);
            const stores = Array.isArray(storesAll) ? storesAll.slice() : [];
            stores.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-Hans-CN'));
            if (!stores.length) {
                box.innerHTML = '<div style="grid-column:1/-1; font-size:12px; color:rgba(200,215,230,0.7);">暂无门店，请先创建门店</div>';
                return;
            }
            box.innerHTML = stores.map((s) => {
                const sid = String(s?.id || '').trim();
                const name = String(s?.name || s?.id || '').trim();
                const sbid = normalizeBrandIdInput(s?.brandId || s?.brand || s?.brandName);
                const checked = bid && sbid === bid;
                return `
                    <label style="display:flex; gap:8px; align-items:center; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.03); cursor:pointer;">
                        <input type="checkbox" data-store-id="${escapeHtml(sid)}" ${checked ? 'checked' : ''} />
                        <span style="font-size:12px; font-weight:700; color:rgba(226,232,240,0.92);">${escapeHtml(name || '-')}</span>
                    </label>
                `;
            }).join('');
        }

        function selectBrandForEdit(brandId) {
            const bid = normalizeBrandIdInput(brandId);
            const one = (__BRANDS_CACHE || []).find((b) => normalizeBrandIdInput(b?.id) === bid) || null;
            if (!one) return;
            __BRAND_FORM_EDITING_ID = bid;
            const idEl = document.getElementById('brand-form-id');
            const nameEl = document.getElementById('brand-form-name');
            const sEl = document.getElementById('brand-form-status');
            if (idEl) idEl.value = String(one.id || '');
            if (nameEl) nameEl.value = String(one.name || '');
            renderBrandStoreChecklist(bid);
            if (sEl) sEl.textContent = `正在编辑：${String(one.name || one.id || '')}`;
        }

        function renderBrandSettingsList() {
            const box = document.getElementById('brand-settings-list');
            if (!box) return;
            const list = Array.isArray(__BRANDS_CACHE) ? __BRANDS_CACHE : [];
            if (!list.length) {
                box.innerHTML = '<div style="color:rgba(200,215,230,0.7); font-size:12px;">暂无品牌，请新建。</div>';
                return;
            }
            box.innerHTML = list.map((b) => {
                const bid = normalizeBrandIdInput(b?.id);
                const active = bid === __BRAND_FORM_EDITING_ID;
                return `
                    <button type="button" onclick="selectBrandForEdit('${escapeHtml(bid)}')" style="text-align:left; padding:10px; border-radius:10px; border:1px solid ${active ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.10)'}; background:${active ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.04)'}; color:#fff; cursor:pointer;">
                        <div style="font-weight:800;">${escapeHtml(String(b?.name || '-'))}</div>
                        <div style="font-size:11px; color:rgba(200,215,230,0.7); margin-top:2px;">${escapeHtml(String(b?.id || '-'))}</div>
                    </button>
                `;
            }).join('');
        }

        async function openBrandSettingsModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可维护品牌', 'warning');
                return;
            }
            const modal = document.getElementById('brand-settings-modal');
            if (!modal) return;
            try {
                await refreshBrandsCache(true);
            } catch (e) {
                // still allow opening the modal even if remote brand API is down
                try { __BRANDS_CACHE = inferBrandsFromStores(); } catch (e2) { __BRANDS_CACHE = []; }
            }
            __BRAND_FORM_EDITING_ID = '';
            renderBrandSettingsList();
            resetBrandForm();
            brandFormSyncIdFromName();
            renderBrandStoreChecklist('');
            modal.style.display = 'flex';
            modal.classList.add('show');
        }

        async function applyBrandStoreMapping(brandId, brandName, storeIds) {
            const bid = normalizeBrandIdInput(brandId);
            const list = Array.isArray(storeIds) ? storeIds : [];
            const storesAll = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : (HRMS_STORE.ensure().stores || []);
            const stores = Array.isArray(storesAll) ? storesAll.slice() : [];
            const selected = new Set(list.map((x) => String(x || '').trim()).filter(Boolean));
            const tasks = [];
            stores.forEach((s) => {
                const sid = String(s?.id || '').trim();
                if (!sid) return;
                const should = selected.has(sid);
                const curBid = normalizeBrandIdInput(s?.brandId || s?.brand || s?.brandName);
                const nextBid = should ? bid : '';
                if (curBid === nextBid) return;
                const storeName = String(s?.name || s?.id || '').trim();
                if (!storeName) return;
                tasks.push(HRMS_API.updateStore(sid, {
                    name: storeName,
                    brandId: should ? bid : '',
                    brand: should ? String(brandName || '').trim() : ''
                }));
            });
            if (tasks.length) {
                await Promise.all(tasks);
                try { await HRMS_STORE.refresh(); } catch (e) {}
            }
        }

        async function saveBrandSettings() {
            if (!isAdminUser()) return;
            const idInput = document.getElementById('brand-form-id');
            const nameInput = document.getElementById('brand-form-name');
            const storesEl = document.getElementById('brand-form-stores');
            const statusEl = document.getElementById('brand-form-status');
            const rawName = String(nameInput?.value || '').trim();
            const id = normalizeBrandIdInput(__BRAND_FORM_EDITING_ID || idInput?.value || rawName);
            if (!rawName || !id) {
                showNotification('请填写品牌名称', 'warning');
                return;
            }
            const storeIds = [];
            try {
                if (storesEl) {
                    storesEl.querySelectorAll('input[type="checkbox"]').forEach((x) => {
                        if (!x.checked) return;
                        const sid = String(x.getAttribute('data-store-id') || '').trim();
                        if (sid) storeIds.push(sid);
                    });
                }
            } catch (e) {}
            const payload = { id, name: rawName, label: rawName, config: {} };
            try {
                if (__BRAND_FORM_EDITING_ID && __BRAND_FORM_EDITING_ID === id) {
                    await HRMS_API.updateBrand(id, { name: rawName, label: rawName, config: {} });
                } else {
                    await HRMS_API.createBrand({ id, name: rawName, label: rawName, config: {} });
                }
                await applyBrandStoreMapping(id, rawName, storeIds);
                await refreshBrandsCache(true);
                renderBrandSettingsList();
                populateStoreBrandSelect(id);
                populateKnowledgeBrandOptions('all');
                populateKnowledgeFilterBrandOptions('');
                populateReportsBrandSelect('');
                populateAmBrandFilter(__AM_BRAND_FILTER || 'all');
                if (statusEl) statusEl.textContent = `保存成功：${rawName}`;
                showNotification('品牌设置已保存', 'success');
            } catch (e) {
                if (statusEl) statusEl.textContent = `保存失败：${String(e?.message || e)}`;
                showNotification('品牌保存失败：' + String(e?.message || e), 'error');
            }
        }

        async function loadPointRulesSettings() {
            const sel = document.getElementById('points-rule-store');
            const list = document.getElementById('points-rule-list');
            if (!sel || !list || !isAdminUser()) return;
            try {
                const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
                const names = Array.from(new Set(stores.map(s => String(s?.name || '').trim()).filter(Boolean)));
                if (!names.length) {
                    sel.innerHTML = '<option value="">暂无门店</option>';
                    list.innerHTML = '<div style="color:rgba(200,215,230,0.75);">请先创建门店</div>';
                    return;
                }
                const oldVal = String(sel.value || '').trim();
                sel.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
                if (oldVal && names.includes(oldVal)) sel.value = oldVal;

                const store = String(sel.value || names[0] || '').trim();
                const resp = await HRMS_API.getPointRules({ store });
                const items = Array.isArray(resp?.items) ? resp.items : [];
                if (!items.length) {
                    list.innerHTML = '<div style="color:rgba(200,215,230,0.75);">该门店暂未配置积分事项</div>';
                    return;
                }
                list.innerHTML = items.map(r => {
                    const id = String(r?.id || '').trim();
                    const enabled = r?.enabled !== false;
                    return `<div style="padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
                        <div>
                            <div style="font-weight:800; color:rgba(226,232,240,0.95);">${escapeHtml(String(r?.itemName || '-'))} · ${Number(r?.points || 0)}分</div>
                            <div style="font-size:12px; color:rgba(200,215,230,0.75);">${escapeHtml(store)}</div>
                        </div>
                        <button class="btn btn-secondary" type="button" style="padding:6px 10px; font-size:12px;" onclick="togglePointRuleEnabled('${escapeHtml(id)}', ${enabled ? 'false' : 'true'})">${enabled ? '禁用' : '启用'}</button>
                    </div>`;
                }).join('');
            } catch (e) {
                list.innerHTML = '<div style="color:#ef4444;">加载失败：' + escapeHtml(String(e?.message || e)) + '</div>';
            }
        }

        function isTripleSocialPointRuleName(name) {
            const n = String(name || '');
            return n.includes('抖音') && n.includes('小红书') && n.includes('大众点评');
        }

        async function addPointRuleItem() {
            if (!isAdminUser()) return;
            const store = String(document.getElementById('points-rule-store')?.value || '').trim();
            const itemName = String(document.getElementById('points-rule-item')?.value || '').trim();
            const points = Number(document.getElementById('points-rule-points')?.value || 0);
            if (!store) return showNotification('请选择门店', 'warning');
            if (!itemName) return showNotification('请填写事项名称', 'warning');
            if (!Number.isFinite(points) || points <= 0) return showNotification('积分必须大于0', 'warning');

            const clearPointRuleForm = () => {
                const itemEl = document.getElementById('points-rule-item');
                const ptsEl = document.getElementById('points-rule-points');
                if (itemEl) itemEl.value = '';
                if (ptsEl) ptsEl.value = '';
            };

            const tryUpdateExistingTripleSocial = async () => {
                const resp = await HRMS_API.getPointRules({ store });
                const items = Array.isArray(resp?.items) ? resp.items : [];
                const existing = items.find((r) => isTripleSocialPointRuleName(r?.itemName));
                if (!existing?.id) return false;
                const cur = Number(existing.points) || 0;
                if (cur === points) {
                    showNotification('该宣传类积分事项已存在且分值相同，无需重复新增', 'warning');
                    return true;
                }
                const ok = window.confirm(
                    `已存在「抖音 / 小红书 / 大众点评」类宣传积分事项（当前 ${cur} 分）。\n\n是否将分值改为 ${points} 分？\n（不会新增第二条规则）`
                );
                if (!ok) return true;
                await HRMS_API.updatePointRule(String(existing.id), { points, enabled: true });
                clearPointRuleForm();
                showNotification('积分分值已更新', 'success');
                await loadPointRulesSettings();
                return true;
            };

            if (isTripleSocialPointRuleName(itemName)) {
                try {
                    if (await tryUpdateExistingTripleSocial()) return;
                } catch (e) {
                    showNotification('检查或更新已有规则失败：' + String(e?.message || e), 'error');
                    return;
                }
            }

            try {
                await HRMS_API.createPointRule({ store, itemName, points, enabled: true });
                clearPointRuleForm();
                showNotification('积分事项已新增', 'success');
                await loadPointRulesSettings();
            } catch (e) {
                const code = String(e?.data?.error || '').trim();
                if (code === 'duplicate_triple_social_rule') {
                    try {
                        if (await tryUpdateExistingTripleSocial()) return;
                    } catch (e2) {
                        showNotification('更新失败：' + String(e2?.message || e2), 'error');
                        return;
                    }
                }
                showNotification('新增失败：' + String(e?.message || e), 'error');
            }
        }

        async function togglePointRuleEnabled(id, enabled) {
            if (!isAdminUser()) return;
            try {
                await HRMS_API.updatePointRule(id, { enabled: !!enabled });
                showNotification('状态已更新', 'success');
                await loadPointRulesSettings();
            } catch (e) {
                showNotification('更新失败：' + String(e?.message || e), 'error');
            }
        }

        async function openSalaryChangeHistoryModal(username, displayName) {
            const modal = document.getElementById('salary-change-history-modal');
            const title = document.getElementById('salary-change-history-title');
            const body = document.getElementById('salary-change-history-body');
            if (!modal || !body) return;
            if (title) title.textContent = `薪资变更记录 · ${displayName || username || ''}`;
            body.innerHTML = '<div style="color:rgba(200,215,230,0.72);">加载中...</div>';
            modal.classList.add('show');
            try {
                const resp = await HRMS_API.getSalaryChangesReport({ username, limit: 200 });
                const rows = Array.isArray(resp?.items) ? resp.items : [];
                if (!rows.length) {
                    body.innerHTML = '<div style="color:rgba(200,215,230,0.72);">暂无薪资变更记录</div>';
                    return;
                }
                const fmtMoney = (n) => {
                    if (n == null || n === '') return '-';
                    const v = Number(n);
                    return Number.isFinite(v) ? ('¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : '-';
                };
                body.innerHTML = rows.map((r) => {
                    const t = String(r?.approvedAt || '').slice(0, 19).replace('T', ' ');
                    const approver = hrmsDisplayName(String(r?.approvedBy || ''));
                    const delta = Number(r?.delta);
                    const deltaText = Number.isFinite(delta)
                        ? ((delta >= 0 ? '+' : '') + '¥' + Math.abs(delta).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                        : '-';
                    return `<div style="padding:10px 0;border-bottom:1px dashed rgba(255,255,255,0.1);">
                        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                            <div style="font-weight:800;">${escapeHtml(String(r?.targetName || r?.targetUsername || username || '-'))}</div>
                            <div style="font-size:12px;color:rgba(200,215,230,0.72);">${escapeHtml(t || '-')}</div>
                        </div>
                        <div style="margin-top:6px;font-size:12px;color:rgba(226,232,240,0.92);">原薪资：<span style="font-weight:800;">${escapeHtml(fmtMoney(r?.oldSalary))}</span> → 新薪资：<span style="font-weight:900;color:#22c55e;">${escapeHtml(fmtMoney(r?.newSalary))}</span></div>
                        <div style="margin-top:4px;font-size:12px;color:${delta >= 0 ? '#22c55e' : '#ef4444'};">变动：${escapeHtml(deltaText)}</div>
                        <div style="margin-top:4px;font-size:12px;color:rgba(200,215,230,0.75);">审批人：${escapeHtml(approver || '-')} · 门店：${escapeHtml(String(r?.store || '-'))}</div>
                    </div>`;
                }).join('');
            } catch (e) {
                body.innerHTML = `<div style="color:#ef4444;">加载失败：${escapeHtml(String(e?.message || e))}</div>`;
            }
        }

        function closeSalaryChangeHistoryModal() {
            const modal = document.getElementById('salary-change-history-modal');
            if (modal) modal.classList.remove('show');
        }

        async function renderApprovalFlowSummary() {
            const el = document.getElementById('approval-flow-summary');
            if (!el) return;
            try {
                const st = await HRMS_API.getState();
                const stData = (st && typeof st === 'object' ? (st.data || st) : {}) || {};
                const flows = stData.approvalFlows && typeof stData.approvalFlows === 'object' ? stData.approvalFlows : {};
                const pfbs = stData.paymentFlowByStore && typeof stData.paymentFlowByStore === 'object' ? stData.paymentFlowByStore : {};
                const typeLabels = { leave: '请假', offboarding: '离职', onboarding: '入职', promotion: '晋升', payment: '请款', reward_punishment: '奖惩', points: '积分', monthly_confirm: '月度考勤确认' };
                afBuildRoleLabels();
                afBuildNameMap();
                const lines = [];
                Object.keys(typeLabels).forEach(type => {
                    const cfg = flows?.[type];
                    const steps = cfg?.steps;
                    if (!Array.isArray(steps) || !steps.length) return;
                    const labels = steps.map(s => afStepLabel(s)).join(' → ');
                    const cfgStores = Array.isArray(cfg?.stores) ? cfg.stores.filter(Boolean) : [];
                    const storeTag = cfgStores.length ? ' <span style="color:rgba(59,130,246,0.85); font-size:11px;">(' + cfgStores.map(s => escapeHtml(s)).join('、') + ')</span>' : '';
                    lines.push('<div style="margin-bottom:6px;"><span style="font-weight:800; color:rgba(226,232,240,0.95);">' + typeLabels[type] + storeTag + '：</span>' + labels + '</div>');
                });
                const storeKeys = Object.keys(pfbs);
                if (storeKeys.length) {
                    storeKeys.forEach(store => {
                        const cfg = pfbs[store] || {};
                        const approvers = Array.isArray(cfg.approvers) ? cfg.approvers : [];
                        const cashier = String(cfg.cashier || '').trim();
                        const parts = [];
                        approvers.forEach(a => {
                            const name = _afNameMap[String(a || '').trim()] || _afNameMap[String(a || '').trim().toLowerCase()] || a;
                            parts.push('审批人: ' + escapeHtml(name));
                        });
                        if (cashier) {
                            const cname = _afNameMap[cashier] || _afNameMap[cashier.toLowerCase()] || cashier;
                            parts.push('付款人: ' + escapeHtml(cname));
                        }
                        if (parts.length) {
                            lines.push('<div style="margin-bottom:6px;"><span style="font-weight:800; color:rgba(226,232,240,0.95);">请款(' + escapeHtml(store) + ')：</span>' + parts.join(' → ') + '</div>');
                        }
                    });
                }
                if (lines.length) {
                    el.innerHTML = '<div style="padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03);">' + lines.join('') + '</div>';
                } else {
                    el.innerHTML = '<div style="color:rgba(200,215,230,0.5);">暂未配置审批流程</div>';
                }
            } catch (e) {
                el.innerHTML = '';
            }
        }

        function hrmsScrollToSettingsCard(id) {
            try {
                const el = document.getElementById(String(id || ''));
                if (!el) return;
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) {}
        }

        async function hrmsFetchApprovalFlows() {
            try {
                const token = HRMS_API.token();
                if (token) {
                    const st = await HRMS_API.getState();
                    const flows = st?.data?.approvalFlows || st?.approvalFlows || {};
                    return flows && typeof flows === 'object' ? flows : {};
                }
            } catch (e) {
                // fallback to local
            }
            try {
                const settings = HRMS_STORE.getSettings();
                const flows = settings?.approvalFlows || {};
                return flows && typeof flows === 'object' ? flows : {};
            } catch (e) {
                return {};
            }
        }

        async function hrmsSaveApprovalFlows(nextFlows) {
            const flows = nextFlows && typeof nextFlows === 'object' ? nextFlows : {};
            try {
                const token = HRMS_API.token();
                if (token) {
                    // 走专用原子接口，避免全量 PUT /api/state 把审批流程被陈旧浏览器覆盖
                    const r = await fetch('/api/approval-flows', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                        body: JSON.stringify({ approvalFlows: flows })
                    });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    return { ok: true, mode: 'server' };
                }
            } catch (e) {
                return { ok: false, mode: 'server', error: e };
            }

            try {
                HRMS_STORE.updateSettings({ approvalFlows: flows });
                try { hrmsScheduleStateSave(); } catch (e) {}
                try { hrmsFlushStateSave(); } catch (e) {}
                return { ok: true, mode: 'local' };
            } catch (e) {
                return { ok: false, mode: 'local', error: e };
            }
        }

        var _afStepsData = { leave: [], offboarding: [], onboarding: [], promotion: [], payment: [], reward_punishment: [], points: [] };
        var _afStoresData = { leave: [], offboarding: [], onboarding: [], promotion: [], payment: [], reward_punishment: [], points: [] };
        var _afRoleLabels = {};
        var _afNameMap = {};

        function afBuildRoleLabels() {
            _afRoleLabels = {
                manager: '直属上级',
                admin: '管理员',
                hq_manager: '总部营运',
                hr_manager: '总部人事',
                cashier: '总部出纳',
                store_manager: '门店店长',
                store_production_manager: '门店出品经理',
                store_employee: '门店员工'
            };
        }

        function afPopulateStoreSelects() {
            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            const names = Array.from(new Set(stores.map(s => String(s?.name || '').trim()).filter(Boolean)))
                .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
            const types = ['leave', 'offboarding', 'onboarding', 'promotion', 'payment', 'reward_punishment', 'points'];
            types.forEach(type => {
                const sel = document.getElementById('af-store-' + type);
                if (!sel) return;
                sel.innerHTML = '<option value="__all__" selected>全部门店</option>' + names.map(n =>
                    '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'
                ).join('');
            });
        }

        function afSetStoreSelectValues(type, storeList) {
            const sel = document.getElementById('af-store-' + type);
            if (!sel) return;
            const arr = Array.isArray(storeList) ? storeList : [];
            const isAll = !arr.length || (arr.length === 1 && arr[0] === '__all__');
            Array.from(sel.options).forEach(opt => {
                if (isAll) {
                    opt.selected = opt.value === '__all__';
                } else {
                    opt.selected = arr.includes(opt.value);
                }
            });
        }

        function afGetStoreSelectValues(type) {
            const sel = document.getElementById('af-store-' + type);
            if (!sel) return [];
            const vals = Array.from(sel.selectedOptions).map(o => o.value);
            if (vals.includes('__all__') || !vals.length) return [];
            return vals.filter(v => v !== '__all__');
        }

        function afOnStoreChange(type) {
            const sel = document.getElementById('af-store-' + type);
            if (!sel) return;
            const vals = Array.from(sel.selectedOptions).map(o => o.value);
            if (vals.includes('__all__') && vals.length > 1) {
                const last = vals[vals.length - 1];
                if (last === '__all__') {
                    Array.from(sel.options).forEach(o => { o.selected = o.value === '__all__'; });
                } else {
                    Array.from(sel.options).forEach(o => { if (o.value === '__all__') o.selected = false; });
                }
            }
            _afStoresData[type] = afGetStoreSelectValues(type);
        }

        function afBuildNameMap() {
            _afNameMap = {};
            const users = HRMS_STORE.getUsers() || [];
            const employees = HRMS_STORE.getEmployees() || [];
            users.forEach(u => { if (u?.username) _afNameMap[String(u.username).trim()] = String(u.name || '').trim(); });
            employees.forEach(e => { if (e?.username && !_afNameMap[String(e.username).trim()]) _afNameMap[String(e.username).trim()] = String(e.name || '').trim(); });
        }

        function afStepLabel(token) {
            const t = String(token || '').trim();
            if (_afRoleLabels[t]) return _afRoleLabels[t];
            if (t.startsWith('role:')) {
                const roleId = t.slice('role:'.length).trim();
                return _afRoleLabels[roleId] || roleId;
            }
            if (t.startsWith('username:')) {
                const uname = t.slice('username:'.length).trim();
                const name = _afNameMap[uname] || _afNameMap[uname.toUpperCase()] || _afNameMap[uname.toLowerCase()];
                return name || uname;
            }
            return t;
        }

        function afPopulateSelects() {
            const types = ['leave', 'offboarding', 'onboarding', 'promotion', 'payment', 'reward_punishment', 'points'];
            const users = HRMS_STORE.getUsers() || [];
            const employees = HRMS_STORE.getEmployees() || [];
            const seen = new Set();
            const people = [];
            // Employees first (authoritative source), then users as fallback
            [...employees, ...users].forEach(x => {
                const u = String(x?.username || '').trim();
                if (!u || seen.has(u.toLowerCase())) return;
                const st = String(x?.status || '').trim();
                if (st === '离职' || st === 'inactive' || st === 'disabled') return;
                seen.add(u.toLowerCase());
                people.push({ username: u, name: String(x?.name || '').trim(), role: String(x?.role || '').trim() });
            });
            people.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'zh-CN'));

            types.forEach(type => {
                const sel = document.getElementById('af-select-' + type);
                if (!sel) return;
                let html = '<option value="">选择审批人…</option>';
                html += '<optgroup label="── 角色 ──">';
                Object.keys(_afRoleLabels).forEach(k => {
                    html += '<option value="' + k + '">' + escapeHtml(_afRoleLabels[k]) + '</option>';
                });
                html += '</optgroup>';
                html += '<optgroup label="── 指定人员 ──">';
                people.forEach(p => {
                    const label = (p.name || p.username) + (p.role && _afRoleLabels[p.role] ? ' (' + _afRoleLabels[p.role] + ')' : '');
                    html += '<option value="username:' + p.username.replace(/"/g, '&quot;') + '">' + escapeHtml(label) + '</option>';
                });
                html += '</optgroup>';
                sel.innerHTML = html;
            });
        }

        function afRenderTags(type) {
            const container = document.getElementById('af-tags-' + type);
            if (!container) return;
            const steps = _afStepsData[type] || [];
            if (!steps.length) {
                container.innerHTML = '<span style="color:rgba(200,215,230,0.5); font-size:12px; padding:4px;">暂无审批步骤（使用系统默认）</span>';
                return;
            }
            container.innerHTML = steps.map((token, idx) => {
                const label = afStepLabel(token);
                return '<span style="display:inline-flex; align-items:center; gap:4px; background:rgba(59,130,246,0.2); color:#93c5fd; border:1px solid rgba(59,130,246,0.3); border-radius:6px; padding:4px 8px; font-size:12px; white-space:nowrap;">'
                    + '<span style="color:rgba(200,215,230,0.6); font-size:10px; margin-right:2px;">' + (idx + 1) + '.</span>'
                    + label
                    + '<button type="button" onclick="afRemoveStep(\'' + type + '\',' + idx + ')" style="background:none; border:none; color:#f87171; cursor:pointer; font-size:14px; padding:0 2px; line-height:1;">×</button>'
                    + '</span>';
            }).join('');
        }

        function afAddStep(type) {
            const sel = document.getElementById('af-select-' + type);
            if (!sel) return;
            const val = sel.value;
            if (!val) return;
            if (!_afStepsData[type]) _afStepsData[type] = [];
            _afStepsData[type].push(val);
            sel.value = '';
            afRenderTags(type);
        }

        function afRemoveStep(type, idx) {
            if (!_afStepsData[type]) return;
            _afStepsData[type].splice(idx, 1);
            afRenderTags(type);
        }

        function openApprovalFlowModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可配置审批流程', 'warning');
                return;
            }
            const modal = document.getElementById('approval-flow-modal');
            if (!modal) return;

            const statusEl = document.getElementById('approval-flow-modal-status');
            if (statusEl) statusEl.textContent = '';

            afBuildRoleLabels();
            afBuildNameMap();

            const afTypeMeta = [
                { type: 'leave', icon: '🌿', label: '休假申请', desc: '本人发起 → 直属上级 → 人事经理 → 自动记录考勤' },
                { type: 'onboarding', icon: '👋', label: '入职申请', desc: '店长发起 → 直属上级 → 人事经理 → 管理员 → 创建档案' },
                { type: 'offboarding', icon: '📤', label: '离职申请', desc: '本人发起 → 直属上级 → 人事经理 → 管理员 → 禁用账号' },
                { type: 'promotion', icon: '📈', label: '晋升申请', desc: '本人发起 → 直属上级 → 总部经理 → 人事经理 → 更新级别' },
                { type: 'payment', icon: '💰', label: '请款申请', desc: '门店发起 → 审批人 → 出纳付款' },
                { type: 'reward_punishment', icon: '⚖️', label: '奖惩申请', desc: '发起人 → 直属上级 → 人事经理 → 加入薪资表' },
                { type: 'points', icon: '💎', label: '积分申请', desc: '员工发起 → 直属上级 → 总部营运 → 总部人事 → 折算补贴' }
            ];

            // Build store options HTML once
            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            const storeNames = Array.from(new Set(stores.map(s => String(s?.name || '').trim()).filter(Boolean)))
                .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
            const storeOptsHtml = '<option value="__all__" selected>全部门店</option>' + storeNames.map(n =>
                '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>'
            ).join('');

            // Build approver select options HTML once
            const users = HRMS_STORE.getUsers() || [];
            const employees = HRMS_STORE.getEmployees() || [];
            const seen = new Set();
            const people = [];
            [...employees, ...users].forEach(x => {
                const u = String(x?.username || '').trim();
                if (!u || seen.has(u.toLowerCase())) return;
                const st = String(x?.status || '').trim();
                if (st === '离职' || st === 'inactive' || st === 'disabled') return;
                seen.add(u.toLowerCase());
                people.push({ username: u, name: String(x?.name || '').trim(), role: String(x?.role || '').trim() });
            });
            people.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'zh-CN'));
            let approverOptsHtml = '<option value="">选择审批人…</option>';
            approverOptsHtml += '<optgroup label="── 角色 ──">';
            Object.keys(_afRoleLabels).forEach(k => {
                approverOptsHtml += '<option value="' + k + '">' + escapeHtml(_afRoleLabels[k]) + '</option>';
            });
            approverOptsHtml += '</optgroup><optgroup label="── 指定人员 ──">';
            people.forEach(p => {
                const lbl = (p.name || p.username) + (p.role && _afRoleLabels[p.role] ? ' (' + _afRoleLabels[p.role] + ')' : '');
                approverOptsHtml += '<option value="username:' + p.username.replace(/"/g, '&quot;') + '">' + escapeHtml(lbl) + '</option>';
            });
            approverOptsHtml += '</optgroup>';

            // Render cards
            const container = document.getElementById('af-flow-cards');
            if (!container) return;
            container.innerHTML = afTypeMeta.map(m => `
                <div style="border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); overflow: hidden;" data-af-type="${m.type}">
                    <div style="padding: 14px 16px; display:flex; align-items:center; gap: 10px; cursor:pointer; user-select:none;" onclick="afToggleCard(this)">
                        <span style="font-size: 18px; width: 28px; text-align:center;">${m.icon}</span>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight: 700; font-size: 14px;">${m.label}</div>
                            <div style="font-size: 11px; color: rgba(200,215,230,0.55); margin-top: 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.desc}</div>
                        </div>
                        <span class="af-card-arrow" style="font-size: 12px; color: rgba(200,215,230,0.4); transition: transform 0.2s;">▼</span>
                    </div>
                    <div class="af-card-body" style="display:none; padding: 0 16px 14px; border-top: 1px solid rgba(255,255,255,0.05);">
                        <div style="padding-top: 12px;">
                            <div style="font-size: 11px; color: rgba(200,215,230,0.6); font-weight: 600; margin-bottom: 6px;">适用门店</div>
                            <select id="af-store-${m.type}" class="settings-input" multiple style="width:100%; min-height:34px; font-size:13px; border-radius:10px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:rgba(226,232,240,0.9); padding:6px 8px;" onchange="afOnStoreChange('${m.type}')">${storeOptsHtml}</select>
                        </div>
                        <div style="margin-top: 10px;">
                            <div style="font-size: 11px; color: rgba(200,215,230,0.6); font-weight: 600; margin-bottom: 6px;">审批链路</div>
                            <div class="af-tags" id="af-tags-${m.type}" style="display:flex; flex-wrap:wrap; gap:6px; min-height:34px; padding:8px 10px; background:rgba(255,255,255,0.04); border-radius:10px; border:1px solid rgba(255,255,255,0.08); margin-bottom:8px;"></div>
                            <div style="display:flex; gap:6px;">
                                <select id="af-select-${m.type}" class="settings-input" style="flex:1; font-size:13px; border-radius:10px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:rgba(226,232,240,0.9); padding:8px 10px;">${approverOptsHtml}</select>
                                <button class="btn btn-secondary" type="button" onclick="afAddStep('${m.type}')" style="padding:8px 14px; font-size:13px; border-radius:10px; white-space:nowrap; font-weight:600;">+ 添加</button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');

            (async () => {
                const flows = await hrmsFetchApprovalFlows();
                const types = afTypeMeta.map(m => m.type);
                types.forEach(type => {
                    const cfg = flows?.[type];
                    const steps = cfg?.steps;
                    _afStepsData[type] = Array.isArray(steps) ? steps.map(x => String(x || '').trim()).filter(Boolean) : [];
                    const storesCfg = cfg?.stores;
                    _afStoresData[type] = Array.isArray(storesCfg) ? storesCfg.map(x => String(x || '').trim()).filter(Boolean) : [];
                    afSetStoreSelectValues(type, _afStoresData[type]);
                    afRenderTags(type);
                });

                modal.classList.add('show');
            })();
        }

        function afToggleCard(headerEl) {
            const body = headerEl.nextElementSibling;
            const arrow = headerEl.querySelector('.af-card-arrow');
            if (!body) return;
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(180deg)';
        }

        function closeApprovalFlowModal() {
            const modal = document.getElementById('approval-flow-modal');
            if (modal) modal.classList.remove('show');
        }

        function saveApprovalFlowModal() {
            if (!isAdminUser()) return;
            const statusEl = document.getElementById('approval-flow-modal-status');
            const types = ['leave', 'offboarding', 'onboarding', 'promotion', 'payment', 'reward_punishment', 'points'];
            const flows = {};
            types.forEach(type => {
                const steps = (_afStepsData[type] || []).filter(Boolean);
                const stores = afGetStoreSelectValues(type);
                if (steps.length) {
                    flows[type] = { steps };
                    if (stores.length) flows[type].stores = stores;
                }
            });

            (async () => {
                if (statusEl) statusEl.textContent = '保存中...';
                const r = await hrmsSaveApprovalFlows(flows);
                if (r?.ok) {
                    if (statusEl) statusEl.textContent = '已保存';
                    showNotification('审批流程已保存', 'success');
                    renderApprovalFlowSummary();
                    closeApprovalFlowModal();
                } else {
                    const msg = String(r?.error?.message || r?.error || '保存失败');
                    if (statusEl) statusEl.textContent = '保存失败：' + msg;
                    showNotification('保存失败：' + msg, 'error');
                }
            })();
        }

        function drFmtMoneyInt(n) {
            const v = Number(n || 0);
            if (!Number.isFinite(v)) return '¥0';
            return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
        }

        const MT_ALL_FIELDS = [
            { key: 'actual',          label: '实收营业额',   unit: '元', group: '营收' },
            { key: 'margin',          label: '实收毛利率',   unit: '%', group: '营收' },
            { key: 'gross',           label: '折前营业额',   unit: '元', group: '营收' },
            { key: 'budget',          label: '预算折前营业额', unit: '元', group: '营收' },
            { key: 'recharge',        label: '充值金额',     unit: '元', group: '营收' },
            { key: 'rechargeCount',   label: '充值笔数',     unit: '笔', group: '营收' },
            { key: 'dineRevenue',     label: '堂食营收',     unit: '元', group: '堂食' },
            { key: 'dineOrders',      label: '堂食订单数',   unit: '单', group: '堂食' },
            { key: 'dineTraffic',     label: '堂食客流量',   unit: '人', group: '堂食' },
            { key: 'elemeRevenue',    label: '饿了么营收',   unit: '元', group: '外卖' },
            { key: 'elemeOrders',     label: '饿了么订单数', unit: '单', group: '外卖' },
            { key: 'elemeActual',     label: '饿了么实收',   unit: '元', group: '外卖' },
            { key: 'meituanRevenue',  label: '美团营收',     unit: '元', group: '外卖' },
            { key: 'meituanOrders',   label: '美团订单数',   unit: '单', group: '外卖' },
            { key: 'meituanActual',   label: '美团实收',     unit: '元', group: '外卖' },
            { key: 'discountTotal',   label: '总折扣',       unit: '元', group: '折扣' },
            { key: 'noon',            label: '午市营收',     unit: '元', group: '时段' },
            { key: 'afternoon',       label: '下午营收',     unit: '元', group: '时段' },
            { key: 'night',           label: '晚市营收',     unit: '元', group: '时段' },
            { key: 'waterAmt',        label: '水吧金额',     unit: '元', group: '品类' },
            { key: 'waterQty',        label: '水吧数量',     unit: '份', group: '品类' },
            { key: 'soupAmt',         label: '汤品金额',     unit: '元', group: '品类' },
            { key: 'soupQty',         label: '汤品数量',     unit: '份', group: '品类' },
            { key: 'roastAmt',        label: '烤品金额',     unit: '元', group: '品类' },
            { key: 'roastQty',        label: '烤品数量',     unit: '份', group: '品类' },
            { key: 'wokAmt',          label: '炒品金额',     unit: '元', group: '品类' },
            { key: 'wokQty',          label: '炒品数量',     unit: '份', group: '品类' },
            { key: 'badDianping',     label: '大众点评差评',  unit: '条', group: '差评' },
            { key: 'badMeituan',      label: '美团差评',      unit: '条', group: '差评' },
            { key: 'badEleme',        label: '饿了么差评',    unit: '条', group: '差评' },
            { key: 'dianpingRating',  label: '大众点评星级', unit: '星', group: '口碑' },
            { key: 'wechatMonthNew',  label: '本月企微新增数量', unit: '人', group: '企微' },
        ];
        const MT_FIELD_MAP = {};
        MT_ALL_FIELDS.forEach(f => { MT_FIELD_MAP[f.key] = f; });
        let __MT_ACTIVE_FIELDS = [];

        function mtGetKey(ym, store) {
            return String(ym || '').trim() + '|' + String(store || '').trim();
        }

        function mtGetAll() {
            const s = HRMS_STORE.getSettings() || {};
            const list = Array.isArray(s.monthlyTargets) ? s.monthlyTargets : [];
            return list.filter(Boolean);
        }

