/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 08-materials-tasks.js
 * lines: 20130-25411 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        function mtUpsert(rec) {
            const next = rec && typeof rec === 'object' ? rec : {};
            const ym = String(next.ym || '').trim();
            const store = String(next.store || '').trim();
            if (!ym || !store) return;
            const key = mtGetKey(ym, store);
            const list = mtGetAll().slice();
            const idx = list.findIndex(x => mtGetKey(x?.ym, x?.store) === key);
            if (idx >= 0) list.splice(idx, 1);
            list.unshift({ ...next, ym, store });
            HRMS_STORE.updateSettings({ monthlyTargets: list });
        }

        function mtFind(ym, store) {
            const key = mtGetKey(ym, store);
            return mtGetAll().find(x => mtGetKey(x?.ym, x?.store) === key) || null;
        }

        function mtPopulateFieldSelect() {
            const sel = document.getElementById('mt-add-field');
            if (!sel) return;
            const activeKeys = new Set(__MT_ACTIVE_FIELDS.map(f => f.key));
            const groups = {};
            MT_ALL_FIELDS.forEach(f => {
                if (activeKeys.has(f.key)) return;
                if (!groups[f.group]) groups[f.group] = [];
                groups[f.group].push(f);
            });
            let html = '<option value="">选择目标项…</option>';
            Object.keys(groups).forEach(g => {
                html += `<optgroup label="${escapeHtml(g)}">`;
                groups[g].forEach(f => {
                    html += `<option value="${f.key}">${escapeHtml(f.label)}（${escapeHtml(f.unit)}）</option>`;
                });
                html += '</optgroup>';
            });
            sel.innerHTML = html;
        }

        function mtRenderDynamicFields() {
            const container = document.getElementById('mt-dynamic-fields');
            const noFields = document.getElementById('mt-no-fields');
            if (!container) return;
            if (!__MT_ACTIVE_FIELDS.length) {
                container.innerHTML = '';
                if (noFields) noFields.style.display = '';
                return;
            }
            if (noFields) noFields.style.display = 'none';
            container.innerHTML = __MT_ACTIVE_FIELDS.map((f, idx) => {
                const meta = MT_FIELD_MAP[f.key] || { label: f.key, unit: '', group: '' };
                const val = f.value != null ? f.value : '';
                return `<div class="mt-field-row" data-mt-idx="${idx}">
                    <div class="mt-field-row__meta">
                        <div class="mt-field-row__label">${escapeHtml(meta.label)}</div>
                        <div class="mt-field-row__hint">${escapeHtml(meta.group)} · ${escapeHtml(meta.unit)}</div>
                    </div>
                    <input type="number" class="mt-field-row__input" inputmode="decimal" placeholder="目标值" value="${escapeHtml(String(val))}"
                        data-change="mtUpdateFieldValue" data-input="mtUpdateFieldValue" data-arg="${idx}" data-arg-type="number" data-pass-value />
                    <button type="button" class="mt-field-row__remove" data-click="mtRemoveField" data-arg="${idx}" data-arg-type="number" title="移除">✕</button>
                </div>`;
            }).join('');
            mtPopulateFieldSelect();
        }

        function mtAddTargetField() {
            const sel = document.getElementById('mt-add-field');
            if (!sel) return;
            const key = String(sel.value || '').trim();
            if (!key || !MT_FIELD_MAP[key]) { showNotification('请选择目标项', 'warning'); return; }
            if (__MT_ACTIVE_FIELDS.some(f => f.key === key)) return;
            __MT_ACTIVE_FIELDS.push({ key, value: null });
            mtRenderDynamicFields();
        }

        function mtRemoveField(idx) {
            if (idx >= 0 && idx < __MT_ACTIVE_FIELDS.length) {
                __MT_ACTIVE_FIELDS.splice(idx, 1);
                mtRenderDynamicFields();
            }
        }

        function mtUpdateFieldValue(idx, val) {
            if (idx >= 0 && idx < __MT_ACTIVE_FIELDS.length) {
                const v = Number(val);
                __MT_ACTIVE_FIELDS[idx].value = (Number.isFinite(v) && v >= 0) ? v : null;
            }
        }

        function mtRenderList() {
            const el = document.getElementById('mt-list');
            if (!el) return;
            const list = mtGetAll().slice();
            if (!list.length) {
                el.innerHTML = '<div class="mt-registry-empty">暂无目标</div>';
                return;
            }
            list.sort((a, b) => String(b?.ym || '').localeCompare(String(a?.ym || '')) || String(a?.store || '').localeCompare(String(b?.store || ''), 'zh-Hans-CN'));
            const lines = list.slice(0, 60).map(x => {
                const ym = escapeHtml(String(x?.ym || ''));
                const store = escapeHtml(String(x?.store || ''));
                const t = x?.targets || {};
                const keys = Object.keys(t).filter(k => t[k] != null);
                let summary = '';
                if (keys.length) {
                    summary = keys.slice(0, 4).map(k => {
                        const meta = MT_FIELD_MAP[k];
                        const label = meta ? meta.label : k;
                        const unit = meta ? meta.unit : '';
                        const v = Number(t[k] || 0);
                        return `<span style="white-space:nowrap;">${escapeHtml(label)}：<b>${unit === '元' ? drFmtMoneyInt(v) : v + (unit || '')}</b></span>`;
                    }).join('<span style="opacity:0.3; margin:0 4px;">|</span>');
                    if (keys.length > 4) summary += `<span style="opacity:0.5;"> +${keys.length - 4}项</span>`;
                } else {
                    summary = '<span style="opacity:0.5;">无目标项</span>';
                }
                return `<div class="mt-reg-row">
                    <div class="mt-reg-row__main">
                        <span class="mt-reg-row__ym">${ym}</span>
                        <span class="mt-reg-row__store">${store}</span>
                        <div class="mt-reg-row__sum">${summary}</div>
                    </div>
                    <button type="button" class="mt-reg-row__del" data-click="mtDeleteTarget" data-arg="${ym}" data-arg2="${store}" title="删除">🗑</button>
                </div>`;
            });
            el.innerHTML = lines.join('');
        }

        async function mtDeleteTarget(ym, store) {
            if (!isAdminUser()) return;
            const _okMT = await hrmsConfirm({ title: '删除月度目标', message: `确定删除 ${ym} ${store} 的月度目标？`, okText: '确认删除', icon: '🎯' });
            if (!_okMT) return;
            const key = mtGetKey(ym, store);
            const list = mtGetAll().filter(x => mtGetKey(x?.ym, x?.store) !== key);
            HRMS_STORE.updateSettings({ monthlyTargets: list });
            mtRenderList();
            try { hrmsScheduleStateSave(); } catch (e) {}
            try { hrmsFlushStateSave(); } catch (e) {}
            showNotification('已删除', 'success');
        }

        function openMonthlyTargetsModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可维护目标', 'warning');
                return;
            }
            const modal = document.getElementById('monthly-targets-modal');
            if (!modal) return;

            const ymEl = document.getElementById('mt-ym');
            const storeEl = document.getElementById('mt-store');
            if (ymEl && !String(ymEl.value || '').trim()) {
                const d = new Date();
                ymEl.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            }
            if (storeEl) {
                const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : (HRMS_STORE.ensure().stores || []);
                storeEl.innerHTML = stores.map(s => {
                    const name = String(s?.name || s?.id || '').trim();
                    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
                }).join('');
            }
            __MT_ACTIVE_FIELDS = [];
            mtRenderDynamicFields();
            mtPopulateFieldSelect();
            mtRenderList();
            modal.classList.add('show');
        }

        function closeMonthlyTargetsModal() {
            const modal = document.getElementById('monthly-targets-modal');
            if (modal) modal.classList.remove('show');
        }

        function loadMonthlyTargetsIntoForm() {
            if (!isAdminUser()) return;
            const ym = String(document.getElementById('mt-ym')?.value || '').trim();
            const store = String(document.getElementById('mt-store')?.value || '').trim();
            if (!ym || !store) {
                showNotification('请选择月份和门店', 'warning');
                return;
            }
            const rec = mtFind(ym, store);
            const t = rec?.targets || {};
            __MT_ACTIVE_FIELDS = [];
            Object.keys(t).forEach(k => {
                if (t[k] != null && MT_FIELD_MAP[k]) {
                    __MT_ACTIVE_FIELDS.push({ key: k, value: t[k] });
                }
            });
            mtRenderDynamicFields();
            showNotification(rec ? '已加载目标' : '未找到已保存目标，请添加目标项', rec ? 'success' : 'info');
        }

        // 2026-08-02：用户反馈"目标管理"里录的洪潮8月实收营业额90万，工作台"营业日目标"
        // 卡片依然显示旧值——查证发现"目标管理"存的是monthlyTargets（前端本地状态，本函数
        // 上面的mtUpsert），工作台"营业日目标"读的是revenue_targets表（后端另一张表），
        // 两者完全独立、互不知道对方。用户确认以"目标管理"为准：这里把"实收营业额"这一项
        // 同步写入revenue_targets，工作台各处（营业日目标/营业额排名等）就能自动读到最新值，
        // 不用逐个页面改读取逻辑。其它目标项(毛利/充值等)不在这次范围内，不动。
        async function mtSyncRevenueTarget(ym, store, targetRevenue) {
            if (targetRevenue == null) return;
            const authToken = String(
                localStorage.getItem('HRMS_API_TOKEN') ||
                localStorage.getItem('hrms_token') ||
                ''
            ).trim();
            if (!authToken) return;
            const { brandName } = (typeof getStoreBrandByName === 'function') ? getStoreBrandByName(store) : { brandName: '' };
            if (!brandName) return;
            try {
                await fetch('/api/scoring/revenue-targets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ store, brand: brandName, period: ym, target_revenue: targetRevenue })
                });
            } catch (e) {
                console.error('sync revenue_targets failed:', e);
            }
        }

        async function saveMonthlyTargets() {
            if (!isAdminUser()) return;
            const ym = String(document.getElementById('mt-ym')?.value || '').trim();
            const store = String(document.getElementById('mt-store')?.value || '').trim();
            if (!ym || !store) {
                showNotification('请选择月份和门店', 'warning');
                return;
            }
            if (!__MT_ACTIVE_FIELDS.length) {
                showNotification('请至少添加一个目标项', 'warning');
                return;
            }
            const targets = {};
            __MT_ACTIVE_FIELDS.forEach(f => {
                if (f.value != null) targets[f.key] = f.value;
            });
            const now = hrmsNowISO();
            mtUpsert({ ym, store, targets, updatedAt: now, updatedBy: String(currentUser?.username || '') });
            mtRenderList();

            try {
                hrmsScheduleStateSave();
            } catch (e) {}
            try {
                hrmsFlushStateSave();
            } catch (e) {}

            await mtSyncRevenueTarget(ym, store, targets.actual);

            showNotification('目标已保存', 'success');
        }

        function hrmsGetOrgDict() {
            const settings = HRMS_STORE.getSettings();
            const dict = settings.orgDict || {};
            const ensureArray = (v) => Array.isArray(v) ? v.map(x => String(x || '').trim()).filter(Boolean) : [];
            return {
                departments: ensureArray(dict.departments),
                positions: ensureArray(dict.positions),
                levels: ensureArray(dict.levels),
                roles: ensureArray(dict.roles)
            };
        }

        function hrmsSetOrgDict(next) {
            HRMS_STORE.updateSettings({
                orgDict: {
                    departments: Array.isArray(next?.departments) ? next.departments : [],
                    positions: Array.isArray(next?.positions) ? next.positions : [],
                    levels: Array.isArray(next?.levels) ? next.levels : [],
                    roles: Array.isArray(next?.roles) ? next.roles : []
                }
            });
        }

        function setOrgDictTab(tab) {
            const t = String(tab || 'departments');
            ['departments', 'positions', 'levels'].forEach((k) => {
                document.querySelectorAll(`[data-od-tab="${k}"]`).forEach((btn) => {
                    btn.classList.toggle('active', k === t);
                });
                const panel = document.getElementById(`org-dict-panel-${k}`);
                if (panel) panel.classList.toggle('is-active', k === t);
            });
            const focusMap = {
                departments: 'org-dict-department-input',
                positions: 'org-dict-position-input',
                levels: 'org-dict-level-input'
            };
            try {
                const fid = focusMap[t] || focusMap.departments;
                const inp = document.getElementById(fid);
                if (inp && typeof inp.focus === 'function') inp.focus();
            } catch (e) {}
        }

        function openOrgDictModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可维护字典', 'warning');
                return;
            }
            const modal = document.getElementById('org-dict-modal');
            if (!modal) return;
            renderOrgDictModal();
            setOrgDictTab('departments');
            modal.classList.add('show');
        }

        function closeOrgDictModal() {
            const modal = document.getElementById('org-dict-modal');
            if (modal) modal.classList.remove('show');
        }

        function renderOrgDictModal() {
            const dict = hrmsGetOrgDict();
            const renderList = (elId, items, type) => {
                const el = document.getElementById(elId);
                if (!el) return;
                if (!items.length) {
                    el.innerHTML = '<span style="color: rgba(242,234,238,0.4); font-size: 12px;">（暂无）</span>';
                    return;
                }
                el.innerHTML = items.map((it, idx) => {
                    const safe = escapeHtml(String(it));
                    return `<span class="tag">${safe}<span class="del-btn" data-click="removeOrgDictItem" data-arg="${type}" data-arg2="${idx}" data-arg2-type="number">×</span></span>`;
                }).join('');
            };
            renderList('org-dict-departments', dict.departments, 'departments');
            renderList('org-dict-positions', dict.positions, 'positions');
            renderList('org-dict-levels', dict.levels, 'levels');
            renderList('org-dict-roles', dict.roles || [], 'roles');
        }

        function addOrgDictItem(type) {
            if (!isAdminUser()) return;
            const inputMap = {
                departments: 'org-dict-department-input',
                positions: 'org-dict-position-input',
                levels: 'org-dict-level-input',
                roles: 'org-dict-role-input'
            };
            const inputId = inputMap[type];
            const el = document.getElementById(inputId);
            const value = (el?.value || '').trim();
            if (!value) return;
            const dict = hrmsGetOrgDict();
            const arr = dict[type] || [];
            if (arr.some(x => String(x).toLowerCase() === value.toLowerCase())) {
                showNotification('已存在', 'warning');
                return;
            }
            arr.push(value);
            dict[type] = arr;
            hrmsSetOrgDict(dict);
            if (el) el.value = '';
            renderOrgDictModal();
            if (type === 'departments' || type === 'positions' || type === 'levels') {
                setOrgDictTab(type);
            }
        }

        function removeOrgDictItem(type, idx) {
            if (!isAdminUser()) return;
            const dict = hrmsGetOrgDict();
            const arr = Array.isArray(dict[type]) ? dict[type].slice() : [];
            arr.splice(Number(idx), 1);
            dict[type] = arr;
            hrmsSetOrgDict(dict);
            renderOrgDictModal();
            if (type === 'departments' || type === 'positions' || type === 'levels') {
                setOrgDictTab(type);
            }
        }

        function saveOrgDictSettings() {
            if (!isAdminUser()) {
                showNotification('仅管理员可保存', 'warning');
                return;
            }
            closeOrgDictModal();
            showNotification('组织字典已保存', 'success');
        }

        function saveBasicSettings() {
            if (!isAdminUser()) {
                showNotification('仅管理员可保存系统设置', 'warning');
                return;
            }
            const systemName = (document.getElementById('settings-system-name')?.value || '').trim();
            const companyName = (document.getElementById('settings-company-name')?.value || '').trim();
            HRMS_STORE.updateSettings({
                basic: {
                    systemName,
                    companyName
                }
            });
            showNotification('基础设置已保存', 'success');
        }

        function saveSecuritySettings() {
            if (!isAdminUser()) {
                showNotification('仅管理员可保存系统设置', 'warning');
                return;
            }
            const passwordPolicy = String(document.getElementById('settings-password-policy')?.value || 'high');
            const lockPolicy = String(document.getElementById('settings-lock-policy')?.value || '3_30m');
            const sessionTimeout = String(document.getElementById('settings-session-timeout')?.value || '30m');
            HRMS_STORE.updateSettings({
                security: {
                    passwordPolicy,
                    lockPolicy,
                    sessionTimeout
                }
            });
            showNotification('安全设置已保存', 'success');
        }

        const HRMS_AI_FEATURE_DEFS = [
            { key: 'exam_generate', label: '考试 AI 出题', desc: '培训考试模块根据资料自动生成客观题' },
            { key: 'flashcard_generate', label: '闪卡 AI 生成', desc: '知识库资料一键生成闪卡练习题' },
            { key: 'kb_chat', label: '培训 AI 助手', desc: '知识库对话框基于所选资料问答' },
            { key: 'vision_scoring', label: '实操评分（视觉）', desc: '员工拍照/视频抽帧提交实操内容，AI 自动打分；必须选一个支持图片输入的模型（如 qwen-vl-max、doubao-vision 系列），不支持视觉的模型（如 DeepSeek）会调用失败' },
            { key: 'director_data_audit', label: 'Agent总监·数据稽核', desc: '差评/异常审计、评分裁决、经营数据分析' },
            { key: 'director_training', label: 'Agent总监·培训督导', desc: '培训问答、门店督导、SOP生成' },
            { key: 'director_marketing', label: 'Agent总监·营销策划', desc: '营销策略、文案生成、活动执行、差评自动回复' },
            { key: 'director_procurement', label: 'Agent总监·采购', desc: '基于销量/库存/毛利自动生成采购建议' },
            { key: 'director_strategy', label: 'Agent总监·策略增长', desc: '策略打标、异常自动决策、经营建议、排班审批' },
            { key: 'director_dispatch', label: 'Agent总监·总调度', desc: 'Agent总入口对话、任务解析、申诉与反馈处理、董事长诊断' },
            { key: 'default', label: '默认 / 其它', desc: '未单独指定的功能使用此模型；连接校验亦用此模型' },
        ];

        let __AI_MODELS_WORKING = { models: [], bindings: {} };
        let __AI_MODEL_EDIT_ID = null;

        function newAiModelId() {
            return 'ai_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        }

        function normalizeAiLlmSettings(raw) {
            const llm = raw && typeof raw === 'object' ? raw : {};
            if (Array.isArray(llm.models) && llm.models.length) {
                const models = llm.models.map((m, i) => ({
                    id: String(m?.id || `ai_${i}`),
                    name: String(m?.name || m?.model || '未命名模型'),
                    baseUrl: String(m?.baseUrl || ''),
                    model: normalizeLlmModelName(String(m?.model || '')),
                    apiKey: String(m?.apiKey || ''),
                    enabled: m?.enabled !== false,
                }));
                const bindings = { ...(llm.bindings || {}) };
                HRMS_AI_FEATURE_DEFS.forEach((f) => {
                    if (!bindings[f.key] && models[0]) bindings[f.key] = models[0].id;
                });
                return { models, bindings };
            }
            const legacyKey = String(llm.apiKey || '').trim();
            if (legacyKey || llm.baseUrl || llm.model) {
                const id = 'legacy_default';
                const one = {
                    id,
                    name: '默认模型',
                    baseUrl: String(llm.baseUrl || ''),
                    model: normalizeLlmModelName(String(llm.model || '')),
                    apiKey: legacyKey,
                    enabled: true,
                };
                const bindings = {};
                HRMS_AI_FEATURE_DEFS.forEach((f) => { bindings[f.key] = id; });
                return { models: [one], bindings };
            }
            return { models: [], bindings: {} };
        }

        function syncAiWorkingFromStore() {
            __AI_MODELS_WORKING = JSON.parse(JSON.stringify(normalizeAiLlmSettings(HRMS_STORE.getSettings().llm)));
        }

        function renderAiConfigPanel() {
            syncAiWorkingFromStore();
            const listEl = document.getElementById('ai-models-list');
            const bindEl = document.getElementById('ai-bindings-grid');
            if (!listEl || !bindEl) return;

            const models = __AI_MODELS_WORKING.models || [];
            if (!models.length) {
                listEl.innerHTML = '<div class="settings-hint">尚未添加模型。点击「添加模型」配置租户专属 API（不再使用硬编码密钥）。</div>';
            } else {
                listEl.innerHTML = models.map((m) => `
                    <div class="ai-model-card ${m.enabled === false ? 'is-disabled' : ''}">
                        <div class="ai-model-card__head">
                            <div>
                                <div class="ai-model-card__name">${escapeHtml(m.name || m.model || '未命名')}</div>
                                <div class="ai-model-card__meta">${escapeHtml(m.model || '')} · ${escapeHtml(m.baseUrl || '')}</div>
                            </div>
                            <span class="pill ${m.enabled !== false ? 'ok' : 'bad'}">${m.enabled !== false ? '启用' : '停用'}</span>
                        </div>
                        <div class="ai-model-card__actions">
                            <button type="button" class="btn btn-secondary" data-click="openAiModelModal" data-arg="${escapeHtml(m.id)}">编辑</button>
                            <button type="button" class="btn btn-secondary" data-click="testAiModelById" data-arg="${escapeHtml(m.id)}">测试</button>
                            <button type="button" class="btn btn-secondary" data-click="deleteAiModel" data-arg="${escapeHtml(m.id)}">删除</button>
                        </div>
                    </div>
                `).join('');
            }

            const opts = models.filter((m) => m.enabled !== false).map((m) =>
                `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.model)}</option>`
            ).join('');
            bindEl.innerHTML = HRMS_AI_FEATURE_DEFS.map((f) => {
                const cur = String(__AI_MODELS_WORKING.bindings?.[f.key] || '');
                return `
                    <div class="ai-binding-row">
                        <div>
                            <div class="ai-binding-row__label">${escapeHtml(f.label)}</div>
                            <div class="ai-binding-row__desc">${escapeHtml(f.desc)}</div>
                        </div>
                        <select id="ai-bind-${f.key}" class="settings-input" ${models.length ? '' : 'disabled'}>
                            <option value="">未指定</option>
                            ${opts}
                        </select>
                    </div>
                `;
            }).join('');
            HRMS_AI_FEATURE_DEFS.forEach((f) => {
                const sel = document.getElementById(`ai-bind-${f.key}`);
                if (sel) sel.value = String(__AI_MODELS_WORKING.bindings?.[f.key] || '');
            });
        }

        function readAiBindingsFromDom() {
            const bindings = { ...(__AI_MODELS_WORKING.bindings || {}) };
            HRMS_AI_FEATURE_DEFS.forEach((f) => {
                const sel = document.getElementById(`ai-bind-${f.key}`);
                if (sel) bindings[f.key] = String(sel.value || '').trim();
            });
            __AI_MODELS_WORKING.bindings = bindings;
        }

        function saveAiConfigSettings() {
            if (!isAdminUser()) {
                showNotification('仅管理员可保存系统设置', 'warning');
                return;
            }
            readAiBindingsFromDom();
            HRMS_STORE.updateSettings({ llm: __AI_MODELS_WORKING });
            showNotification('AI 配置已保存', 'success');
        }

        function openAiModelModal(modelId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可配置 AI', 'warning');
                return;
            }
            syncAiWorkingFromStore();
            __AI_MODEL_EDIT_ID = modelId ? String(modelId) : null;
            const modal = document.getElementById('llm-model-modal');
            const title = document.getElementById('ai-model-modal-title');
            const m = __AI_MODEL_EDIT_ID
                ? (__AI_MODELS_WORKING.models || []).find((x) => x.id === __AI_MODEL_EDIT_ID)
                : null;
            if (title) title.textContent = m ? '编辑 AI 模型' : '添加 AI 模型';
            const nameEl = document.getElementById('ai-model-name');
            const baseEl = document.getElementById('ai-model-base-url');
            const modelEl = document.getElementById('ai-model-model');
            const keyEl = document.getElementById('ai-model-api-key');
            const enabledEl = document.getElementById('ai-model-enabled');
            if (nameEl) nameEl.value = m?.name || '';
            if (baseEl) baseEl.value = m?.baseUrl || '';
            if (modelEl) modelEl.value = m?.model || '';
            if (keyEl) keyEl.value = m?.apiKey || '';
            if (enabledEl) enabledEl.checked = m ? m.enabled !== false : true;
            if (modal) modal.classList.add('show');
        }

        function closeAiModelModal() {
            const modal = document.getElementById('llm-model-modal');
            if (modal) modal.classList.remove('show');
            __AI_MODEL_EDIT_ID = null;
        }

        function saveAiModelFromModal() {
            if (!isAdminUser()) return;
            const name = String(document.getElementById('ai-model-name')?.value || '').trim();
            const baseUrl = String(document.getElementById('ai-model-base-url')?.value || '').trim();
            const model = normalizeLlmModelName(String(document.getElementById('ai-model-model')?.value || '').trim());
            const apiKey = String(document.getElementById('ai-model-api-key')?.value || '').trim();
            const enabled = !!document.getElementById('ai-model-enabled')?.checked;
            if (!name || !baseUrl || !model || !apiKey) {
                showNotification('请填写名称、Base URL、Model 和 API Key', 'warning');
                return;
            }
            syncAiWorkingFromStore();
            const payload = { id: __AI_MODEL_EDIT_ID || newAiModelId(), name, baseUrl, model, apiKey, enabled };
            const idx = (__AI_MODELS_WORKING.models || []).findIndex((x) => x.id === payload.id);
            if (idx >= 0) __AI_MODELS_WORKING.models[idx] = payload;
            else __AI_MODELS_WORKING.models.push(payload);
            HRMS_AI_FEATURE_DEFS.forEach((f) => {
                if (!__AI_MODELS_WORKING.bindings?.[f.key]) {
                    __AI_MODELS_WORKING.bindings = __AI_MODELS_WORKING.bindings || {};
                    __AI_MODELS_WORKING.bindings[f.key] = payload.id;
                }
            });
            HRMS_STORE.updateSettings({ llm: __AI_MODELS_WORKING });
            closeAiModelModal();
            renderAiConfigPanel();
            showNotification('模型已保存', 'success');
        }

        async function deleteAiModel(modelId) {
            if (!isAdminUser()) return;
            const id = String(modelId || '').trim();
            if (!id) return;
            const _ok = await hrmsConfirm({ title: '删除模型', message: '确定删除该 AI 模型？相关功能配对将清空。', okText: '删除', icon: '🤖' });
            if (!_ok) return;
            syncAiWorkingFromStore();
            __AI_MODELS_WORKING.models = (__AI_MODELS_WORKING.models || []).filter((m) => m.id !== id);
            Object.keys(__AI_MODELS_WORKING.bindings || {}).forEach((k) => {
                if (__AI_MODELS_WORKING.bindings[k] === id) __AI_MODELS_WORKING.bindings[k] = '';
            });
            HRMS_STORE.updateSettings({ llm: __AI_MODELS_WORKING });
            renderAiConfigPanel();
            showNotification('已删除', 'success');
        }

        async function testAiModelById(modelId) {
            const id = String(modelId || '').trim();
            syncAiWorkingFromStore();
            const m = (__AI_MODELS_WORKING.models || []).find((x) => x.id === id);
            if (!m) return;
            await testAiConnectionWithConfig(normalizeLlmConfig(m));
        }

        async function testAiConnection() {
            const feature = 'default';
            try {
                const cfg = getEffectiveLlmConfig(feature);
                await testAiConnectionWithConfig(cfg);
            } catch (e) {
                showNotification(String(e?.message || e), 'warning');
            }
        }

        async function testAiConnectionWithConfig(cfg) {
            const baseUrl = normalizeOpenAiBaseUrl(cfg?.baseUrl);
            const apiKey = String(cfg?.apiKey || '').trim();
            const model = normalizeLlmModelName(cfg?.model);
            const errBox = document.getElementById('llm-last-error');
            if (errBox) errBox.value = '';
            if (!isUsableLlmConfig({ baseUrl, apiKey, model })) {
                showNotification('请先配置有效的模型', 'warning');
                return;
            }
            try {
                await callLlmViaServer([{ role: 'user', content: 'hello' }], {
                    max_tokens: 10,
                    temperature: 0,
                    feature: 'default',
                    llmConfig: { baseUrl, apiKey, model },
                });
                showNotification('连接成功', 'success');
            } catch (e) {
                showNotification('连接失败：' + String(e?.message || e), 'error');
                if (errBox) errBox.value = `Exception\nBaseURL: ${baseUrl}\nModel: ${model}\n\n${String(e?.message || e)}`;
            }
        }

        function saveLlmSettings() {
            saveAiConfigSettings();
        }

        // 租户级 LLM：不再硬编码默认密钥，需在「AI 配置」中添加模型
        const DEFAULT_LLM_CONFIG = {
            baseUrl: '',
            model: '',
            apiKey: ''
        };

        function getEffectiveLlmConfig(featureKey = 'default') {
            const { models, bindings } = normalizeAiLlmSettings(HRMS_STORE.getSettings().llm);
            const key = String(featureKey || 'default').trim() || 'default';
            const boundId = String(bindings?.[key] || bindings?.default || '').trim();
            let m = models.find((x) => x.id === boundId && x.enabled !== false);
            if (!m) m = models.find((x) => x.enabled !== false);
            if (m && String(m.apiKey || '').trim()) {
                return {
                    baseUrl: normalizeOpenAiBaseUrl(m.baseUrl),
                    model: normalizeLlmModelName(m.model),
                    apiKey: String(m.apiKey || '').trim(),
                    modelId: m.id,
                    modelName: m.name,
                };
            }
            const legacy = normalizeAiLlmSettings(HRMS_STORE.getSettings().llm);
            if (!legacy.models.length && DEFAULT_LLM_CONFIG.apiKey) {
                return {
                    baseUrl: normalizeOpenAiBaseUrl(DEFAULT_LLM_CONFIG.baseUrl),
                    model: normalizeLlmModelName(DEFAULT_LLM_CONFIG.model),
                    apiKey: DEFAULT_LLM_CONFIG.apiKey,
                };
            }
            return { baseUrl: '', model: '', apiKey: '' };
        }

        function normalizeOpenAiBaseUrl(baseUrl) {
            const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
            if (!trimmed) return '';
            if (/ark\.cn-beijing\.volces\.com/i.test(trimmed)) {
                if (/\/api\/v3$/i.test(trimmed)) return trimmed;
                if (/\/v1$/i.test(trimmed)) return trimmed.replace(/\/v1$/i, '/api/v3');
                return trimmed + '/api/v3';
            }
            if (trimmed.endsWith('/v1')) return trimmed;
            return trimmed + '/v1';
        }

        function normalizeLlmModelName(model) {
            const raw = String(model || '').trim();
            if (!raw) return '';

            const lower = raw.toLowerCase();
            // Only normalize explicit DeepSeek aliases; keep other providers' model names as-is (e.g., qwen-turbo).
            if (lower.startsWith('deepseek')) {
                if (lower.includes('reasoner') || lower.endsWith('-r1') || lower === 'deepseek-r1') return 'deepseek-reasoner';
                if (lower.includes('chat') || lower.includes('v3')) return 'deepseek-chat';
                return 'deepseek-chat';
            }
            return raw;
        }

        function normalizeLlmConfig(raw) {
            return {
                baseUrl: normalizeOpenAiBaseUrl(raw?.baseUrl),
                apiKey: String(raw?.apiKey || '').trim(),
                model: normalizeLlmModelName(raw?.model)
            };
        }

        function isUsableLlmConfig(cfg) {
            return !!(cfg && cfg.baseUrl && cfg.apiKey && cfg.model);
        }

        function isSameLlmConfig(a, b) {
            return String(a?.baseUrl || '') === String(b?.baseUrl || '')
                && String(a?.apiKey || '') === String(b?.apiKey || '')
                && String(a?.model || '') === String(b?.model || '');
        }

        function shouldRetryWithDefaultLlm(err) {
            const status = Number(err?.status || 0);
            const msg = String(err?.message || err?.data?.message || '').toLowerCase();
            if (status === 401 || status === 403 || status === 404) return true;
            return /(model|endpoint|not exist|no access|invalid|forbidden|unauthorized|权限|不存在)/i.test(msg);
        }

        async function callLlmViaServer(messages, options = {}) {
            // 按 options.feature（如 kb_chat/flashcard_generate/exam_generate）取该功能在
            // 「AI配置」里绑定的具体模型；未单独绑定则退回 default 绑定的模型。
            const featureCfg = getEffectiveLlmConfig(options?.feature || 'default');
            const settings = HRMS_STORE.getSettings();
            const userCfg = isUsableLlmConfig(featureCfg) ? featureCfg : normalizeLlmConfig(settings?.llm || {});
            const defaultCfg = normalizeLlmConfig(DEFAULT_LLM_CONFIG);
            const primaryCfg = isUsableLlmConfig(userCfg) ? userCfg : defaultCfg;
            const fallbackCfg = (isUsableLlmConfig(userCfg) && !isSameLlmConfig(userCfg, defaultCfg) && isUsableLlmConfig(defaultCfg))
                ? defaultCfg
                : null;
            if (!isUsableLlmConfig(primaryCfg)) throw new Error('missing_llm_config');

            const send = async (cfg) => HRMS_API.request('/api/ai/chat-completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    baseUrl: cfg.baseUrl,
                    apiKey: cfg.apiKey,
                    model: cfg.model,
                    messages: Array.isArray(messages) ? messages : [],
                    max_tokens: Number(options?.maxTokens || options?.max_tokens || 1024),
                    temperature: Number.isFinite(Number(options?.temperature)) ? Number(options.temperature) : 0.2
                })
            });

            try {
                const data = await send(primaryCfg);
                if (data && typeof data === 'object') data.__hrmsLlmFallbackUsed = false;
                return data;
            } catch (e) {
                if (fallbackCfg && shouldRetryWithDefaultLlm(e)) {
                    const data = await send(fallbackCfg);
                    if (data && typeof data === 'object') {
                        data.__hrmsLlmFallbackUsed = true;
                        data.__hrmsLlmFallbackReason = String(e?.message || '');
                    }
                    return data;
                }
                throw e;
            }
        }

        function extractJsonArrayFromText(text) {
            const s = String(text || '').trim();
            if (!s) return '';

            const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (fenced && fenced[1]) return fenced[1].trim();

            const start = s.indexOf('[');
            const end = s.lastIndexOf(']');
            if (start >= 0 && end > start) return s.slice(start, end + 1).trim();
            return s;
        }

        async function testLlmConnection() {
            // 使用系统LLM配置（自动使用预设或用户配置）
            const llm = getEffectiveLlmConfig();
            const baseUrl = normalizeOpenAiBaseUrl(llm.baseUrl);
            const apiKey = String(llm.apiKey || '').trim();
            const model = normalizeLlmModelName(llm.model);
            const errBox = document.getElementById('llm-last-error');
            if (errBox) errBox.value = '';
            if (!baseUrl || !apiKey || !model) {
                showNotification('请先填写 BaseURL/Model/Key', 'warning');
                return;
            }

            try {
                const data = await callLlmViaServer([{ role: 'user', content: 'hello' }], {
                    max_tokens: 10,
                    temperature: 0
                });
                if (errBox) errBox.value = '';
                if (data?.__hrmsLlmFallbackUsed) {
                    showNotification('连接成功（已自动回退到系统默认模型）', 'success');
                    if (errBox) {
                        errBox.value = `检测到当前自定义配置不可用，已自动回退系统默认配置。\n\n原始错误:\n${String(data?.__hrmsLlmFallbackReason || '')}`;
                    }
                } else {
                    showNotification('连接成功', 'success');
                }
            } catch (e) {
                console.error(e);
                showNotification('连接失败：' + String(e?.message || e), 'error');
                if (errBox) {
                    errBox.value = `Exception\nBaseURL: ${baseUrl}\nModel: ${model}\n\n${String(e?.message || e)}`;
                }
            }
        }

        // 飞书同步相关函数
        function saveFeishuSettings() {
            const appId = (document.getElementById('feishu-app-id')?.value || '').trim();
            const appSecret = (document.getElementById('feishu-app-secret')?.value || '').trim();
            const appToken = (document.getElementById('feishu-app-token')?.value || '').trim();
            const tableId = (document.getElementById('feishu-table-id')?.value || '').trim();

            if (!appId || !appSecret || !appToken || !tableId) {
                showNotification('请填写完整的飞书配置信息', 'warning');
                return;
            }

            // 使用localStorage保存配置
            const feishuConfig = {
                appId,
                appSecret,
                appToken,
                tableId,
                updatedAt: new Date().toISOString()
            };
            
            localStorage.setItem('feishuConfig', JSON.stringify(feishuConfig));
            showNotification('飞书配置已保存', 'success');
        }

        async function testFeishuConnection() {
            // 从localStorage获取配置
            const savedConfig = localStorage.getItem('feishuConfig');
            const config = savedConfig ? JSON.parse(savedConfig) : {};
            const authToken = String(
                localStorage.getItem('HRMS_API_TOKEN') ||
                localStorage.getItem('hrms_token') ||
                ''
            ).trim();
            
            if (!config.appId || !config.appSecret) {
                showNotification('请先保存飞书配置', 'warning');
                return;
            }

            if (!authToken) {
                showNotification('登录状态已失效，请重新登录后再测试连接', 'warning');
                return;
            }

            try {
                const response = await fetch('/api/feishu/test-connection', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify(config)
                });

                const result = await response.json();
                if (response.ok && result.success) {
                    showNotification('飞书连接测试成功', 'success');
                } else {
                    showNotification('飞书连接测试失败：' + (result.message || '未知错误'), 'error');
                }
            } catch (error) {
                console.error('Feishu connection test error:', error);
                showNotification('飞书连接测试失败：' + error.message, 'error');
            }
        }

        async function triggerManualFeishuSync() {
            // 从localStorage获取配置
            const savedConfig = localStorage.getItem('feishuConfig');
            const config = savedConfig ? JSON.parse(savedConfig) : {};
            // Prefer current form values so user can switch tableId/appToken without re-saving
            const appIdInput = document.getElementById('feishu-app-id');
            const appSecretInput = document.getElementById('feishu-app-secret');
            const appTokenInput = document.getElementById('feishu-app-token');
            const tableIdInput = document.getElementById('feishu-table-id');
            const liveConfig = {
                appId: String(appIdInput?.value || '').trim(),
                appSecret: String(appSecretInput?.value || '').trim(),
                appToken: String(appTokenInput?.value || '').trim(),
                tableId: String(tableIdInput?.value || '').trim()
            };
            const effectiveConfig = {
                appId: liveConfig.appId || String(config.appId || '').trim(),
                appSecret: liveConfig.appSecret || String(config.appSecret || '').trim(),
                appToken: liveConfig.appToken || String(config.appToken || '').trim(),
                tableId: liveConfig.tableId || String(config.tableId || '').trim()
            };
            const authToken = String(
                localStorage.getItem('HRMS_API_TOKEN') ||
                localStorage.getItem('hrms_token') ||
                ''
            ).trim();
            
            if (!effectiveConfig.appId || !effectiveConfig.appSecret || !effectiveConfig.appToken || !effectiveConfig.tableId) {
                showNotification('请先保存飞书配置', 'warning');
                return;
            }

            if (!authToken) {
                showNotification('登录状态已失效，请重新登录后再手动同步', 'warning');
                return;
            }

            try {
                showNotification('开始手动同步...', 'info');
                
                const response = await fetch('/api/feishu/sync-manual', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({
                        appId: effectiveConfig.appId,
                        appSecret: effectiveConfig.appSecret,
                        appToken: effectiveConfig.appToken,
                        tableId: effectiveConfig.tableId
                    })
                });

                const result = await response.json();
                if (response.ok) {
                    const isTableVisit = !!result.isTableVisit;
                    const synced = Number(result.synced || 0) || 0;
                    const failed = Number(result.failed || 0) || 0;
                    const total = Number(result.total || 0) || 0;
                    const genericUpserted = Number(result.genericUpserted || 0) || 0;
                    const msg = isTableVisit
                        ? `同步完成（桌访表）：成功 ${synced} 条，失败 ${failed} 条（拉取 ${total} 条）`
                        : `同步完成（通用表）：写入 ${genericUpserted} 条（拉取 ${total} 条）`;
                    showNotification(msg, 'success');
                    loadFeishuSyncStatus(); // 刷新状态列表
                } else {
                    showNotification('同步失败：' + (result.message || '未知错误'), 'error');
                }
            } catch (error) {
                console.error('Manual sync error:', error);
                showNotification('同步失败：' + error.message, 'error');
            }
        }

        async function loadFeishuSyncStatus() {
            try {
                const statusFilter = document.getElementById('feishu-status-filter')?.value || '';
                const authToken = String(
                    localStorage.getItem('HRMS_API_TOKEN') ||
                    localStorage.getItem('hrms_token') ||
                    ''
                ).trim();
                const response = await fetch(`/api/feishu/sync-status?status=${encodeURIComponent(statusFilter)}&limit=20`, {
                    headers: {
                        'Authorization': authToken ? `Bearer ${authToken}` : ''
                    }
                });

                if (response.ok) {
                    const result = await response.json();
                    renderFeishuSyncStatus(result.items || []);
                } else {
                    console.error('Failed to load sync status');
                }
            } catch (error) {
                console.error('Load sync status error:', error);
            }
        }

        function renderFeishuSyncStatus(items) {
            const container = document.getElementById('feishu-sync-status-list');
            if (!container) return;

            if (!items || items.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: rgba(242,234,238,0.4); font-size: 13px;">
                        暂无同步记录
                    </div>
                `;
                return;
            }

            const html = items.map(item => {
                const statusColor = {
                    pending: '#CFA14A',
                    success: '#86C9A2',
                    failed: '#E58B98'
                }[item.sync_status] || '#97848E';

                const statusText = {
                    pending: '待处理',
                    success: '成功',
                    failed: '失败'
                }[item.sync_status] || item.sync_status;

                const createdAt = new Date(item.created_at).toLocaleString('zh-CN');

                return `
                    <div style="background: rgba(242,234,238,0.03); border: 1px solid rgba(242,234,238,0.08); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="color: ${statusColor}; font-size: 12px; font-weight: 600;">${statusText}</span>
                            <span style="color: rgba(242,234,238,0.4); font-size: 11px;">${createdAt}</span>
                        </div>
                        <div style="font-size: 13px; color: rgba(242,234,238,0.8); margin-bottom: 4px;">
                            事件类型: ${item.event_type}
                        </div>
                        <div style="font-size: 12px; color: rgba(242,234,238,0.5);">
                            记录ID: ${item.record_id || 'N/A'}
                        </div>
                        ${item.error_message ? `
                            <div style="font-size: 12px; color: #E58B98; margin-top: 8px; padding: 8px; background: rgba(229,139,152,0.1); border-radius: 4px;">
                                错误: ${item.error_message}
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        }

        // 页面加载时初始化飞书配置（设置页已下线飞书表单时跳过，避免空节点报错）
        document.addEventListener('DOMContentLoaded', function() {
            const feApp = document.getElementById('feishu-app-id');
            if (!feApp) return;
            const savedConfig = localStorage.getItem('feishuConfig');
            const feishuConfig = savedConfig ? JSON.parse(savedConfig) : {};
            const feSec = document.getElementById('feishu-app-secret');
            const feTok = document.getElementById('feishu-app-token');
            const feTbl = document.getElementById('feishu-table-id');
            if (feishuConfig.appId) feApp.value = feishuConfig.appId;
            if (feishuConfig.appSecret && feSec) feSec.value = feishuConfig.appSecret;
            if (feishuConfig.appToken && feTok) feTok.value = feishuConfig.appToken;
            if (feishuConfig.tableId && feTbl) feTbl.value = feishuConfig.tableId;
            const sp = document.getElementById('settings-page');
            if (sp && !sp.classList.contains('hidden')) {
                loadFeishuSyncStatus();
            }
        });

        function clearTrainingMaterialText() {
            if (!requireAdminForMaterialSave()) return;
            const el = document.getElementById('training-material-text');
            if (el) el.value = '';
        }

        function loadScript(url) {
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = url;
                s.async = true;
                s.onload = () => resolve(true);
                s.onerror = () => reject(new Error('Failed to load: ' + url));
                document.head.appendChild(s);
            });
        }

        function hrmsGetStaticBaseUrl() {
            try {
                const base = String(HRMS_API?.baseUrl ? HRMS_API.baseUrl() : (window.location?.origin || '')).trim();
                return base ? base.replace(/\/$/, '') : '';
            } catch (e) {
                return '';
            }
        }

        async function ensureMammothLoaded() {
            if (typeof mammoth !== 'undefined') return true;
            const candidates = [
                'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
                'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
                'https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js'
            ];
            for (const url of candidates) {
                try {
                    await loadScript(url);
                    if (typeof mammoth !== 'undefined') return true;
                } catch (e) {}
            }
            return false;
        }

        async function ensureTesseractLoaded() {
            if (typeof Tesseract !== 'undefined') return true;
            const candidates = [
                '/assets/vendor/tesseract/tesseract.min.js',
                'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/tesseract.min.js',
                'https://unpkg.com/tesseract.js@5.0.4/dist/tesseract.min.js'
            ];
            for (const url of candidates) {
                try {
                    await loadScript(url);
                    if (typeof Tesseract !== 'undefined') return true;
                } catch (e) {}
            }
            return false;
        }

        async function getOrCreateOcrWorker(statusEl) {
            try {
                if (window.__HRMS_OCR_WORKER_PROMISE) return await window.__HRMS_OCR_WORKER_PROMISE;
            } catch (e) {}

            const p = (async () => {
                try {
                    const ok = await ensureTesseractLoaded();
                    if (!ok || typeof Tesseract === 'undefined') return null;
                    if (typeof Tesseract.createWorker !== 'function') return null;
                    try { if (statusEl) statusEl.textContent = '初始化OCR...'; } catch (e) {}
                    const worker = await Tesseract.createWorker('chi_sim+eng');
                    return worker;
                } catch (e) {
                    return null;
                }
            })();

            try { window.__HRMS_OCR_WORKER_PROMISE = p; } catch (e) {}
            return await p;
        }

        async function ensurePdfJsLoaded() {
            if (typeof pdfjsLib !== 'undefined') return true;

            const candidates = [
                '/assets/vendor/pdfjs/pdf.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js',
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.js',
                'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.min.js'
            ];

            for (const url of candidates) {
                try {
                    await loadScript(url);
                    if (typeof pdfjsLib !== 'undefined') return true;
                } catch (e) {
                    // ignore and try next
                }
            }
            return false;
        }

        async function handleTrainingPdfUpload(event) {
            if (!canUploadMaterialForExtraction()) {
                showNotification('您没有上传培训资料的权限', 'warning');
                event.target.value = '';
                return;
            }
            const file = event?.target?.files?.[0];
            const statusEl = document.getElementById('training-pdf-status');
            if (statusEl) statusEl.textContent = '';
            if (!file) return;

            try {
                if (statusEl) statusEl.textContent = '加载PDF解析库...';
                const ok = await ensurePdfJsLoaded();
                if (!ok || typeof pdfjsLib === 'undefined') {
                    if (statusEl) statusEl.textContent = 'PDF解析库加载失败';
                    showNotification('PDF解析库未加载（请检查网络/CDN是否被拦，或使用离线方案）', 'error');
                    return;
                }

                pdfjsLib.GlobalWorkerOptions.workerSrc =
                    '/assets/vendor/pdfjs/pdf.worker.min.js';

                if (statusEl) statusEl.textContent = '解析中...';
                showNotification('PDF解析中，请稍候...', 'info');

                const arrayBuffer = await file.arrayBuffer();
                const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                let fullText = '';
                for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
                    if (statusEl) statusEl.textContent = `解析中... (${pageNum}/${doc.numPages})`;
                    const page = await doc.getPage(pageNum);
                    const content = await page.getTextContent();
                    const pageText = (content.items || []).map(it => it.str).join(' ');
                    fullText += pageText + '\n';
                }

                const textarea = document.getElementById('training-material-text');
                if (textarea) textarea.value = fullText.trim();

                if (statusEl) statusEl.textContent = `解析完成：${file.name}`;
                showNotification('PDF解析完成，已填入文本框', 'success');
            } catch (e) {
                console.error(e);
                if (statusEl) statusEl.textContent = '解析失败';
                showNotification('PDF解析失败（可能是扫描件/加密PDF）', 'error');
            } finally {
                event.target.value = '';
            }
        }

        async function handleTrainingDocxUpload(event) {
            if (!canUploadMaterialForExtraction()) {
                showNotification('您没有上传培训资料的权限', 'warning');
                event.target.value = '';
                return;
            }
            const file = event?.target?.files?.[0];
            const statusEl = document.getElementById('training-docx-status');
            const nameEl = document.getElementById('training-docx-name');
            if (statusEl) statusEl.textContent = '';
            if (!file) return;

            if (nameEl) nameEl.textContent = file.name || '已选择文件';

            const fileName = String(file.name || '').toLowerCase();
            const isDocx = fileName.endsWith('.docx');
            if (!isDocx) {
                if (statusEl) statusEl.textContent = '仅支持 .docx（建议将 .doc/.wps 先另存为 .docx）';
                showNotification('当前仅支持 DOCX 解析：请将 .doc/.wps 转为 .docx 后再上传', 'warning');
                event.target.value = '';
                return;
            }

            try {
                if (statusEl) statusEl.textContent = '加载DOCX解析库...';
                const ok = await ensureMammothLoaded();
                if (!ok || typeof mammoth === 'undefined') {
                    if (statusEl) statusEl.textContent = 'DOCX解析库加载失败';
                    showNotification('DOCX解析库未加载（请检查网络/CDN是否被拦，或使用离线方案）', 'error');
                    return;
                }

                if (statusEl) statusEl.textContent = '解析中...';
                showNotification('DOCX解析中，请稍候...', 'info');
                const arrayBuffer = await file.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                const text = String(result?.value || '').trim();
                const textarea = document.getElementById('training-material-text');
                if (textarea) textarea.value = text;
                if (statusEl) statusEl.textContent = `解析完成：${file.name}`;
                showNotification('DOCX解析完成，已填入文本框', 'success');
            } catch (e) {
                console.error(e);
                if (statusEl) statusEl.textContent = '解析失败';
                showNotification('DOCX解析失败', 'error');
            } finally {
                event.target.value = '';
            }
        }

        async function handleTrainingImageUpload(event) {
            if (!canUploadMaterialForExtraction()) {
                showNotification('您没有上传培训资料的权限', 'warning');
                event.target.value = '';
                return;
            }
            const file = event?.target?.files?.[0];
            const statusEl = document.getElementById('training-img-status');
            const nameEl = document.getElementById('training-img-name');
            if (statusEl) statusEl.textContent = '';
            if (!file) return;

            if (nameEl) nameEl.textContent = file.name || '已选择文件';

            if (!String(file.type || '').startsWith('image/')) {
                if (statusEl) statusEl.textContent = '请选择图片文件';
                showNotification('OCR仅支持图片文件（png/jpg/webp等）', 'warning');
                event.target.value = '';
                return;
            }

            try {
                if (statusEl) statusEl.textContent = '加载OCR库...';
                showNotification('图片OCR识别中，请稍候...', 'info');

                const worker = await getOrCreateOcrWorker(statusEl);
                let text = '';
                if (worker) {
                    const res = await worker.recognize(file);
                    text = String(res?.data?.text || '').trim();
                } else {
                    // Fallback for builds without createWorker
                    const res = await Tesseract.recognize(file, 'chi_sim+eng');
                    text = String(res?.data?.text || '').trim();
                }

                const textarea = document.getElementById('training-material-text');
                if (textarea) textarea.value = text;
                if (statusEl) statusEl.textContent = `识别完成：${file.name}`;
                showNotification('图片OCR完成，已填入文本框', 'success');
            } catch (e) {
                console.error(e);
                if (statusEl) statusEl.textContent = '识别失败：' + String(e?.message || e);
                showNotification('图片OCR失败（可能是traineddata无法下载/网络限制）', 'error');
            } finally {
                event.target.value = '';
            }
        }

        async function saveTrainingMaterialFromText() {
            if (!requireAdminForMaterialSave()) return;
            const text = (document.getElementById('training-material-text')?.value || '').trim();
            if (!text) {
                showNotification('请输入或粘贴培训资料文本', 'warning');
                return;
            }
            const materials = HRMS_STORE.getTrainingMaterials();
            materials.push({
                id: 'mat_' + Date.now(),
                type: 'text',
                title: '培训资料_' + new Date().toISOString().slice(0, 10),
                text,
                createdAt: hrmsNowISO()
            });
            HRMS_STORE.setTrainingMaterials(materials);
            try {
                await HRMS_API.saveTrainingMaterials(materials);
            } catch (e) {
                showNotification('资料已保存到本地，但同步服务器失败：' + String(e?.message || e), 'warning');
                return;
            }
            showNotification('资料已保存', 'success');
            renderTrainingMaterialsSelect();
        }

        function renderTrainingMaterialsSelect() {
            const sel = document.getElementById('training-materials-select');
            if (!sel) return;
            if (!isAdminUser()) {
                sel.innerHTML = '';
                return;
            }
            const materials = HRMS_STORE.getTrainingMaterials();
            if (!materials.length) {
                sel.innerHTML = '<option value="">暂无已保存资料</option>';
                sel.value = '';
                return;
            }

            const current = String(sel.value || '').trim();
            const opts = materials
                .slice()
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
                .map(m => {
                    const time = String(m.createdAt || '').slice(0, 19).replace('T', ' ');
                    const title = String(m.title || '培训资料');
                    return `<option value="${m.id}">${title}（${time}）</option>`;
                })
                .join('');
            sel.innerHTML = opts;
            if (current && materials.some(m => String(m.id) === current)) {
                sel.value = current;
            }
        }

        function loadSelectedTrainingMaterial() {
            if (!isAdminUser()) {
                showNotification('仅管理员可操作', 'warning');
                return;
            }
            const sel = document.getElementById('training-materials-select');
            const id = String(sel?.value || '').trim();
            if (!id) {
                showNotification('请选择资料', 'warning');
                return;
            }
            const materials = HRMS_STORE.getTrainingMaterials();
            const m = materials.find(x => String(x.id) === id);
            if (!m) {
                showNotification('未找到资料', 'error');
                return;
            }
            const textarea = document.getElementById('training-material-text');
            if (textarea) textarea.value = String(m.text || '');
            showNotification('已加载资料', 'success');
        }

        async function deleteSelectedTrainingMaterial() {
            if (!isAdminUser()) {
                showNotification('仅管理员可操作', 'warning');
                return;
            }
            const sel = document.getElementById('training-materials-select');
            const id = String(sel?.value || '').trim();
            if (!id) {
                showNotification('请选择资料', 'warning');
                return;
            }
            const ok = await hrmsConfirm({ title: '删除培训资料', message: '确定删除该培训资料？删除后不可恢复。', okText: '确认删除', icon: '📋' });
            if (!ok) return;

            const materials = HRMS_STORE.getTrainingMaterials();
            const idx = materials.findIndex(x => String(x.id) === id);
            if (idx < 0) {
                showNotification('未找到资料', 'error');
                return;
            }
            materials.splice(idx, 1);
            HRMS_STORE.setTrainingMaterials(materials);
            try {
                await HRMS_API.saveTrainingMaterials(materials);
            } catch (e) {
                showNotification('本地已删除，但同步服务器失败：' + String(e?.message || e), 'warning');
                return;
            }
            renderTrainingMaterialsSelect();

            const textarea = document.getElementById('training-material-text');
            if (textarea) textarea.value = getLatestTrainingMaterialText();

            showNotification('已删除', 'success');
        }

        function getLatestTrainingMaterialText() {
            const materials = HRMS_STORE.getTrainingMaterials();
            if (!materials.length) return '';
            const latest = materials[materials.length - 1];
            return latest?.text || '';
        }

        function renderQuestionBankPreview() {
            const el = document.getElementById('question-bank-preview');
            if (!el) return;
            const data = HRMS_STORE.ensure();
            const sets = Array.isArray(data.questionSets) ? data.questionSets : [];
            const bankFallback = HRMS_STORE.getQuestionBank();
            const availableSets = (sets && sets.length) ? sets : (bankFallback.length ? [bankFallback] : []);

            const setSel = document.getElementById('exam-bank-set-select');
            const setIndex = Math.max(0, Math.min((availableSets.length || 1) - 1, Number(window.__QUESTION_SET_PREVIEW_INDEX || 0) || 0));
            window.__QUESTION_SET_PREVIEW_INDEX = setIndex;
            if (setSel) {
                if (!availableSets.length) {
                    setSel.innerHTML = '<option value="0">第1套</option>';
                    setSel.value = '0';
                    setSel.disabled = true;
                } else {
                    setSel.disabled = availableSets.length <= 1;
                    setSel.innerHTML = availableSets.map((_, i) => `<option value="${i}">第${i + 1}套</option>`).join('');
                    setSel.value = String(setIndex);
                }
            }

            const bank = availableSets[setIndex] || [];
            if (!bank.length) {
                el.textContent = '暂无题目，请先保存资料并点击 AI 出题。';
                return;
            }

            const pageSize = 10;
            const perPage = 6;
            const totalPages = Math.max(1, Math.ceil(bank.length / perPage));
            const pageMap = (window.__QUESTION_BANK_PREVIEW_PAGE_MAP && typeof window.__QUESTION_BANK_PREVIEW_PAGE_MAP === 'object')
                ? window.__QUESTION_BANK_PREVIEW_PAGE_MAP
                : {};
            window.__QUESTION_BANK_PREVIEW_PAGE_MAP = pageMap;
            const mapKey = String(setIndex);
            const cur = Math.max(1, Math.min(totalPages, Number(pageMap[mapKey] || window.__QUESTION_BANK_PREVIEW_PAGE || 1) || 1));
            pageMap[mapKey] = cur;
            window.__QUESTION_BANK_PREVIEW_PAGE = cur;
            const start = (cur - 1) * perPage;
            const slice = bank.slice(start, start + perPage);
            const normalizeQ = (s) => String(s || '')
                .replace(/[\u25A1\u25A0\u25A2\u25A3\u25A4\u25A5\u25A6\u25A7\u25A8\u25A9]/g, '')
                .replace(/[\t\r]+/g, ' ')
                .replace(/\n+/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();

            const itemsHtml = slice.map((q, i) => {
                const title = normalizeQ(q?.question || '');
                const show = title.length > 160 ? (title.slice(0, 160) + '…') : title;
                return `
                    <div style="padding: 10px 0; border-bottom: 1px solid rgba(151,132,142,0.18);">
                        <div style="font-weight: 700; color: rgba(242,234,238,0.96); line-height: 1.5; word-break: break-word;">${start + i + 1}. ${escapeHtml(show)}</div>
                    </div>
                `;
            }).join('');

            const pager = (() => {
                const makeBtn = (label, page, disabled) => {
                    const dis = disabled ? 'disabled' : '';
                    return `<button type="button" class="btn btn-secondary" ${dis} data-click="setQuestionBankPreviewPage" data-arg="${page}" data-arg-type="number" style="padding: 6px 10px;">${label}</button>`;
                };
                const btnPrev = makeBtn('上一页', cur - 1, cur <= 1);
                const btnNext = makeBtn('下一页', cur + 1, cur >= totalPages);

                const pages = [];
                const maxButtons = 7;
                let from = Math.max(1, cur - Math.floor(maxButtons / 2));
                let to = Math.min(totalPages, from + maxButtons - 1);
                from = Math.max(1, to - maxButtons + 1);
                for (let p = from; p <= to; p += 1) {
                    const active = p === cur;
                    pages.push(`<button type="button" class="btn ${active ? '' : 'btn-secondary'}" data-click="setQuestionBankPreviewPage" data-arg="${p}" data-arg-type="number" style="padding: 6px 10px;">${p}</button>`);
                }
                return `
                    <div style="margin-top: 10px; display:flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <div style="color: rgba(151,132,142, 0.72); font-size: 12px; margin-right: 6px;">第 ${cur}/${totalPages} 页（共 ${bank.length} 题）</div>
                        ${btnPrev}
                        ${pages.join('')}
                        ${btnNext}
                    </div>
                `;
            })();

            el.innerHTML = `<div>${itemsHtml}</div>${pager}`;
        }

        function setQuestionSetPreviewIndex(idx) {
            window.__QUESTION_SET_PREVIEW_INDEX = Math.max(0, Number(idx || 0) || 0);
            renderQuestionBankPreview();
        }

        function setQuestionBankPreviewPage(page) {
            window.__QUESTION_BANK_PREVIEW_PAGE = Math.max(1, Number(page || 1) || 1);
            try {
                const map = (window.__QUESTION_BANK_PREVIEW_PAGE_MAP && typeof window.__QUESTION_BANK_PREVIEW_PAGE_MAP === 'object')
                    ? window.__QUESTION_BANK_PREVIEW_PAGE_MAP
                    : null;
                const setIndex = Math.max(0, Number(window.__QUESTION_SET_PREVIEW_INDEX || 0) || 0);
                if (map) map[String(setIndex)] = window.__QUESTION_BANK_PREVIEW_PAGE;
            } catch (e) {}
            renderQuestionBankPreview();
        }

        function renderExamContainer(questions) {
            const container = document.getElementById('exam-container');
            if (!container) return;
            if (!questions || !questions.length) {
                container.textContent = '请先生成题目后点击“开始考试”。';
                return;
            }

            const cleanExamText = (s) => {
                return String(s || '')
                    .replace(/[\u25A1\u25A0\u25A2\u25A3\u25A4\u25A5\u25A6\u25A7\u25A8\u25A9]/g, '')
                    .replace(/[\t\r]+/g, ' ')
                    .replace(/\n+/g, ' ')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
            };

            window.__EXAM_SUBMIT_CONFIRMED = false;

            if (!window.__EXAM_QA_STATE || window.__EXAM_QA_STATE?.questions !== questions) {
                window.__EXAM_QA_STATE = {
                    questions,
                    index: 0,
                    answers: {},
                    expandedMap: {}
                };
            }
            const st = window.__EXAM_QA_STATE;
            st.expandedMap = st.expandedMap || {};
            const idx = Math.max(0, Math.min(questions.length - 1, Number(st.index || 0) || 0));
            st.index = idx;
            const q = questions[idx];
            const t = String(q?.type || 'single');
            const opts = Array.isArray(q?.options) ? q.options : [];
            const title = cleanExamText(q?.question || '');
            const isExpanded = !!st.expandedMap[String(idx)];
            const needsToggle = title.length > 240;
            const shown = (!needsToggle || isExpanded) ? title : (title.slice(0, 240) + '…');
            const prevDisabled = idx <= 0;
            const nextDisabled = idx >= questions.length - 1;

            const existingPicked = st.answers[String(idx)] ?? (t === 'multi' ? [] : '');

            const timerHtml = window.__EXAM_END_TS
                ? `<div id="exam-timer" style="margin-bottom: 12px; font-weight: 700; color:#A67D34;">剩余时间：--:--</div>`
                : '';

            const toggleHtml = needsToggle
                ? `<button type="button" class="btn btn-secondary" data-click="toggleExamQuestionExpanded" style="padding: 6px 10px; border-radius: 999px;">${isExpanded ? '收起' : '展开'}</button>`
                : '';

            const optionsHtml = (t === 'blank')
                ? `
                    <div class="exam-blank">
                        <input type="text" id="exam-qa-input" name="q_${idx}" placeholder="请输入答案" value="${escapeHtml(String(existingPicked || ''))}" />
                    </div>
                `
                : `
                    <div class="exam-options">
                        ${opts.map((opt, oi) => {
                            const id = `q_${idx}_opt_${oi}`;
                            const inputType = t === 'multi' ? 'checkbox' : 'radio';
                            const safeVal = String(opt);
                            const text = cleanExamText(opt);
                            const checked = (t === 'multi')
                                ? (Array.isArray(existingPicked) && existingPicked.includes(String(opt)))
                                : (String(existingPicked || '') === String(opt));
                            return `
                                <label class="exam-option" for="${id}">
                                    <input id="${id}" type="${inputType}" name="q_${idx}" value="${escapeHtml(safeVal)}" ${checked ? 'checked' : ''} />
                                    <div class="exam-option-text">${escapeHtml(text)}</div>
                                </label>
                            `;
                        }).join('')}
                    </div>
                `;

            container.innerHTML = `
                <div class="exam-qa">
                    ${timerHtml}
                    <div class="exam-qa-topbar">
                        <div class="meta" id="exam-qa-meta">第 ${idx + 1}/${questions.length} 题</div>
                        <div style="display:flex; gap: 10px; align-items:center;">
                            <div class="meta" id="exam-qa-unanswered">未答：--</div>
                            ${toggleHtml}
                        </div>
                    </div>

                    <form id="exam-form">
                        <div class="exam-question-card" data-qidx="${idx}">
                            <div class="exam-question-title">${escapeHtml(String(idx + 1) + '. ' + shown)}</div>
                            ${optionsHtml}
                        </div>

                        <div class="exam-submitbar">
                            <div class="hint" id="exam-submit-hint">--</div>
                            <div style="display:flex; gap: 8px; align-items:center; flex-wrap: wrap;">
                                <button type="button" class="btn btn-secondary" ${prevDisabled ? 'disabled' : ''} data-click="examPrevQuestion" style="padding: 10px 12px;">上一题</button>
                                <button type="button" class="btn btn-secondary" ${nextDisabled ? 'disabled' : ''} data-click="examNextQuestion" style="padding: 10px 12px;">下一题</button>
                                <button id="exam-submit-btn" type="button" class="btn" data-click="submitExam">提交</button>
                            </div>
                        </div>
                    </form>
                </div>
            `;

            const updateMeta = () => {
                try {
                    const total = questions.length;
                    // persist current answer into state
                    const curIdx = idx;
                    const curType = String(q?.type || 'single').trim();
                    if (curType === 'multi') {
                        const picked = Array.from(document.querySelectorAll(`input[name="q_${curIdx}"]:checked`)).map(el => String(el?.value || '').trim()).filter(Boolean);
                        st.answers[String(curIdx)] = picked;
                    } else if (curType === 'blank') {
                        const v = String(document.querySelector(`#exam-qa-input`)?.value || '').trim();
                        st.answers[String(curIdx)] = v;
                    } else {
                        const picked = String(document.querySelector(`input[name="q_${curIdx}"]:checked`)?.value || '').trim();
                        st.answers[String(curIdx)] = picked;
                    }

                    let unanswered = 0;
                    for (let i = 0; i < total; i += 1) {
                        const qt = String(questions[i]?.type || 'single').trim();
                        const a = st.answers[String(i)];
                        if (qt === 'multi') {
                            if (!Array.isArray(a) || !a.length) unanswered += 1;
                        } else {
                            if (!String(a || '').trim()) unanswered += 1;
                        }
                    }
                    const metaEl = document.getElementById('exam-qa-meta');
                    if (metaEl) metaEl.textContent = `第 ${idx + 1}/${total} 题`;
                    const unEl = document.getElementById('exam-qa-unanswered');
                    if (unEl) unEl.textContent = `未答：${unanswered}`;
                    const hintEl = document.getElementById('exam-submit-hint');
                    if (hintEl) hintEl.textContent = unanswered > 0 ? `还有 ${unanswered} 题未答` : '已全部作答，可提交';
                } catch (e) {}
            };

            try {
                const form = document.getElementById('exam-form');
                if (form) {
                    form.addEventListener('change', updateMeta);
                    form.addEventListener('input', updateMeta);
                }
            } catch (e) {}
            updateMeta();
        }

        function toggleExamQuestionExpanded() {
            try {
                const st = window.__EXAM_QA_STATE;
                if (!st || !st.questions || !st.questions.length) return;
                const idx = Math.max(0, Math.min(st.questions.length - 1, Number(st.index || 0) || 0));
                st.expandedMap = st.expandedMap || {};
                st.expandedMap[String(idx)] = !st.expandedMap[String(idx)];
                renderExamContainer(st.questions);
            } catch (e) {}
        }

        function examPrevQuestion() {
            try {
                const st = window.__EXAM_QA_STATE;
                if (!st || !st.questions || !st.questions.length) return;
                st.index = Math.max(0, Number(st.index || 0) - 1);
                renderExamContainer(st.questions);
            } catch (e) {}
        }

        function examNextQuestion() {
            try {
                const st = window.__EXAM_QA_STATE;
                if (!st) return;
                st.index = Math.min((st.questions?.length || 1) - 1, Number(st.index || 0) + 1);
                renderExamContainer(st.questions);
            } catch (e) {}
        }

        function startExam() {
            if (window.__CURRENT_EXAM_ASSIGNMENT_ID) {
                startAssignedExam(window.__CURRENT_EXAM_ASSIGNMENT_ID);
                return;
            }
            const assignments = HRMS_STORE.getExamAssignments();
            const mine = assignments.filter(a => examAssignmentMatchesUser(a, currentUser));
            if (mine.length) {
                // Start latest assigned exam by default
                const latest = mine.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
                startAssignedExam(latest.id);
                return;
            }

            const canAuthor = currentUser && (currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.STORE_MANAGER);
            if (!canAuthor) {
                showNotification('暂无被安排的考试', 'warning');
                return;
            }
            const data = HRMS_STORE.ensure();
            const sets = Array.isArray(data.questionSets) ? data.questionSets : [];
            const bank = HRMS_STORE.getQuestionBank();
            const use = sets.length ? (sets[hrmsPickQuestionSetIndexForUser(sets.length)] || sets[0] || []) : bank;
            if (!use.length) {
                showNotification('暂无题目，请先出题或安排考试', 'warning');
                return;
            }
            window.__CURRENT_EXAM_ASSIGNMENT_ID = null;
            renderExamContainer(use);
            showNotification('考试已开始', 'info');
        }

        async function submitExam(autoSubmit) {
            if (window.__EXAM_SUBMITTED) return;
            window.__EXAM_SUBMITTED = true;
            clearExamTimer();

            const assignmentId = window.__CURRENT_EXAM_ASSIGNMENT_ID || null;
            let bank = [];
            let usedSetIndex = 0;
            if (assignmentId) {
                const assignments = HRMS_STORE.getExamAssignments();
                const a = assignments.find(x => x.id === assignmentId);
                const sets = Array.isArray(a?.questionSets) ? a.questionSets : [];
                if (sets.length) {
                    usedSetIndex = hrmsPickQuestionSetIndexForUser(sets.length);
                    bank = sets[usedSetIndex] || sets[0] || [];
                } else {
                    bank = a?.questions || [];
                }
            } else {
                const data = HRMS_STORE.ensure();
                const sets = Array.isArray(data.questionSets) ? data.questionSets : [];
                if (sets.length) {
                    usedSetIndex = hrmsPickQuestionSetIndexForUser(sets.length);
                    bank = sets[usedSetIndex] || sets[0] || [];
                } else {
                    bank = HRMS_STORE.getQuestionBank();
                }
            }
            if (!bank.length) return;

            if (assignmentId) {
                const uname = String(currentUser?.username || '').trim();
                const results = HRMS_STORE.getExamResults();
                const existing = (results || []).find(r => String(r?.assignmentId || '') === String(assignmentId) && String(r?.user || '') === uname);
                if (existing) {
                    showNotification('该考试已提交，不可重复提交', 'warning');
                    renderAssignedExams();
                    const btn = document.getElementById('exam-submit-btn');
                    if (btn) btn.disabled = true;
                    try {
                        const form = document.getElementById('exam-form');
                        if (form) Array.from(form.querySelectorAll('input,button,textarea,select')).forEach(x => { x.disabled = true; });
                    } catch (e) {}
                    return;
                }
            }
            const answers = [];
            let correct = 0;

            let unanswered = 0;
            const st = window.__EXAM_QA_STATE;
            // In single-question mode, DOM only renders one question at a time.
            // Always prefer state answers if available.
            const stAnswers = st && st.answers ? st.answers : null;

            // Persist current question answer into state before scoring.
            try {
                if (st && st.questions && Array.isArray(st.questions) && st.questions.length) {
                    const curIdx = Math.max(0, Math.min(st.questions.length - 1, Number(st.index || 0) || 0));
                    const curQ = st.questions[curIdx];
                    const curType = String(curQ?.type || 'single').trim();
                    if (curType === 'multi') {
                        const picked = Array.from(document.querySelectorAll(`input[name="q_${curIdx}"]:checked`)).map(el => String(el?.value || '').trim()).filter(Boolean);
                        st.answers[String(curIdx)] = picked;
                    } else if (curType === 'blank') {
                        const v = String(document.getElementById('exam-qa-input')?.value || '').trim();
                        st.answers[String(curIdx)] = v;
                    } else {
                        const picked = String(document.querySelector(`input[name="q_${curIdx}"]:checked`)?.value || '').trim();
                        st.answers[String(curIdx)] = picked;
                    }
                }
            } catch (e) {}

            const getPickedFromState = (idx, type) => {
                if (!stAnswers) return null;
                const v = stAnswers[String(idx)];
                if (type === 'multi') return Array.isArray(v) ? v : (v ? [String(v)] : []);
                return v == null ? '' : v;
            };

            bank.forEach((q, idx) => {
                const t = String(q?.type || 'single').trim();
                let picked = '';
                if (stAnswers) {
                    picked = getPickedFromState(idx, t);
                } else if (t === 'multi') {
                    picked = Array.from(document.querySelectorAll(`input[name="q_${idx}"]:checked`)).map(el => String(el?.value || '').trim()).filter(Boolean);
                } else if (t === 'blank') {
                    picked = String(document.querySelector(`input[name="q_${idx}"]`)?.value || '').trim();
                } else {
                    picked = String(document.querySelector(`input[name="q_${idx}"]:checked`)?.value || '').trim();
                }

                if (t === 'multi') {
                    if (!Array.isArray(picked) || !picked.length) unanswered += 1;
                } else {
                    if (!String(picked || '').trim()) unanswered += 1;
                }

                const normalizeArr = (a) => Array.from(new Set((Array.isArray(a) ? a : String(a || '').split(/[，,;；\n]+/)).map(x => String(x || '').trim()).filter(Boolean))).sort();
                const isCorrect = (t === 'multi')
                    ? JSON.stringify(normalizeArr(picked)) === JSON.stringify(normalizeArr(q.answer))
                    : (t === 'blank')
                        ? (String(picked || '').trim() === String(q.answer || '').trim())
                        : (String(picked).trim() === String(q.answer).trim());

                answers.push({
                    questionId: q.id,
                    picked,
                    correctAnswer: q.answer,
                    isCorrect
                });
                if (isCorrect) correct += 1;
            });

            if (!autoSubmit && unanswered > 0 && !window.__EXAM_SUBMIT_CONFIRMED) {
                window.__EXAM_SUBMITTED = false;
                window.__EXAM_SUBMIT_CONFIRMED = true;
                const ok = await hrmsConfirm({ title: '提交确认', message: `还有 ${unanswered} 道题未作答，确定要提交吗？`, okText: '确认提交', icon: '⚠️' });
                if (!ok) {
                    window.__EXAM_SUBMIT_CONFIRMED = false;
                    return;
                }
            }
            const score = Math.round((correct / bank.length) * 100);

            const results = HRMS_STORE.getExamResults();
            const nowTs = Date.now();
            const startedAt = window.__EXAM_STARTED_AT ? new Date(window.__EXAM_STARTED_AT).toISOString() : hrmsNowISO();
            const submittedAt = new Date(nowTs).toISOString();
            const timeUsedSeconds = window.__EXAM_STARTED_AT ? Math.max(0, Math.floor((nowTs - window.__EXAM_STARTED_AT) / 1000)) : null;
            const localId = 'result_' + Date.now();
            const userKey = getCurrentUserKey() || 'unknown';
            const localResult = {
                id: localId,
                assignmentId,
                user: userKey,
                createdAt: hrmsNowISO(),
                startedAt,
                submittedAt,
                timeUsedSeconds,
                autoSubmitted: !!autoSubmit,
                setIndex: usedSetIndex,
                total: bank.length,
                correct,
                score,
                answers
            };
            results.push(localResult);
            HRMS_STORE.setExamResults(results);

            try {
                if (currentUser && HRMS_API.token && HRMS_API.token()) {
                    HRMS_API.saveExamResult({
                        assignmentId,
                        startedAt,
                        submittedAt,
                        timeUsedSeconds,
                        autoSubmitted: !!autoSubmit,
                        setIndex: usedSetIndex,
                        total: bank.length,
                        correct,
                        score,
                        answers
                    })
                        .then(resp => {
                            const saved = resp?.item;
                            const newId = String(saved?.id || '').trim();
                            if (!newId) return;
                            const cur = HRMS_STORE.getExamResults();
                            const idx = (cur || []).findIndex(x => String(x?.id || '') === localId);
                            if (idx >= 0) {
                                const copy = (cur || []).slice();
                                copy[idx] = { ...copy[idx], id: newId };
                                HRMS_STORE.setExamResults(copy);
                            }
                        })
                        .catch(() => {
                            // ignore save failure, local record still exists
                        });
                }
            } catch (e) {}

            try {
                const btn = document.getElementById('exam-submit-btn');
                if (btn) btn.disabled = true;
                const form = document.getElementById('exam-form');
                if (form) Array.from(form.querySelectorAll('input,button,textarea,select')).forEach(x => { x.disabled = true; });
            } catch (e) {}

            try { renderAssignedExams(); } catch (e) {}
            try { renderExamResultsPanel(); } catch (e) {}
            try { renderExamReview(bank, answers, score, correct); } catch (e) {}
            if (autoSubmit) {
                showNotification(`时间到，已自动交卷：得分 ${score}（${correct}/${bank.length}）`, 'warning');
            } else {
                showNotification(`已判卷：得分 ${score}（${correct}/${bank.length}）`, 'success');
            }
        }

        function ruleBasedGenerateQuestions(text, cfg) {
            const allow = new Set((cfg?.questionTypes && cfg.questionTypes.length ? cfg.questionTypes : ['single', 'tf']).map(x => String(x || '').trim()));
            const count = Number(cfg?.count || 8);
            const seed = hrmsMakeRunSeed('exam_rule');
            const rng = hrmsSeededRng(seed);
            const lines = String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
            const base = hrmsSample(lines.slice(0, 60), 24, rng);

            // 从文本中提取内容作为选项（不截断，保留完整内容）
            const extractOption = (s) => {
                return String(s || '').trim();
            };

            const makeSingle = (seedText, idx, allLines) => {
                // 生成有意义的选项（保留完整内容）
                const correctOpt = extractOption(seedText);
                const wrongOpts = hrmsSample(allLines.filter(l => l !== seedText), 3, rng).map(l => extractOption(l));
                while (wrongOpts.length < 3) wrongOpts.push('其他选项');
                const opts = [correctOpt, ...wrongOpts];
                hrmsShuffleInPlace(opts, rng);
                return {
                    id: 'q_rule_' + Date.now() + '_' + idx,
                    type: 'single',
                    question: `根据培训资料，以下哪项描述是正确的？`,
                    options: opts,
                    answer: correctOpt
                };
            };
            const makeMulti = (seedText, idx, allLines) => {
                const opt1 = extractOption(seedText);
                const opt2 = extractOption(allLines[(idx + 1) % allLines.length] || '相关要点');
                const wrongOpts = hrmsSample(allLines.filter(l => l !== seedText), 2, rng).map(l => extractOption(l));
                while (wrongOpts.length < 2) wrongOpts.push('其他选项');
                const opts = [opt1, opt2, ...wrongOpts];
                hrmsShuffleInPlace(opts, rng);
                return {
                    id: 'q_rule_' + Date.now() + '_' + idx,
                    type: 'multi',
                    question: `根据培训资料，以下哪些描述是正确的？（可多选）`,
                    options: opts,
                    answer: [opt1, opt2]
                };
            };
            const makeTf = (seedText, idx) => ({
                id: 'q_rule_' + Date.now() + '_' + idx,
                type: 'tf',
                question: `根据培训资料，以下说法是否正确：${extractOption(seedText)}`,
                options: ['正确', '错误'],
                answer: '正确'
            });
            const makeBlank = (seedText, idx) => ({
                id: 'q_rule_' + Date.now() + '_' + idx,
                type: 'blank',
                question: `填空：根据培训资料，请补充关键内容：${extractOption(seedText)}____`,
                options: [],
                answer: '（以资料为准）'
            });

            const questions = [];
            const total = Number.isFinite(count) && count > 0 ? count : 8;
            for (let i = 0; i < total; i++) {
                const seedText = base[i % (base.length || 1)] || '培训重点';
                const candidates = [];
                if (allow.has('single')) candidates.push('single');
                if (allow.has('multi')) candidates.push('multi');
                if (allow.has('blank')) candidates.push('blank');
                if (allow.has('tf')) candidates.push('tf');
                const pick = candidates.length ? candidates[Math.floor(rng() * candidates.length)] : 'single';
                if (pick === 'multi') questions.push(makeMulti(seedText, i, lines));
                else if (pick === 'blank') questions.push(makeBlank(seedText, i));
                else if (pick === 'tf') questions.push(makeTf(seedText, i));
                else questions.push(makeSingle(seedText, i, lines));
            }
            hrmsShuffleInPlace(questions, rng);
            return questions;
        }

        function applyQuestionConfig(questions, cfg) {
            if (!Array.isArray(questions)) return [];
            return questions.map(q => ({ ...q }));
        }

        async function aiGenerateExamQuestions(text, cfg) {
            const allow = (cfg?.questionTypes && cfg.questionTypes.length ? cfg.questionTypes : ['single', 'tf']).map(x => String(x || '').trim());
            const count = Math.min(40, Math.max(3, Number(cfg?.count || 8)));
            const typeDesc = {
                single: 'single（单选，4个选项，answer 为其中一个选项的完整文本）',
                multi: 'multi（多选，4个选项，answer 为数组，包含2-3个正确选项的完整文本）',
                tf: 'tf（判断题，options 固定为 ["正确","错误"]，answer 为其中一个）',
                blank: 'blank（填空题，options 为空数组，answer 为简短标准答案）'
            };
            const allowedDesc = allow.map(t => typeDesc[t] || t).join('；');
            const prompt = `你是企业内训考试出题老师。请严格基于给定培训资料内容出题，用于员工考试。

出题要求（非常重要）：
- 只能使用资料中明确出现的信息出题与作答；禁止编造或引入资料外知识。
- 题干必须是通顺完整的中文书面句，禁止在汉字之间插入空格。
- 允许的题型：${allowedDesc}
- 一共出 ${count} 道题，题型从允许列表中合理搭配。

输出格式要求：
- 只输出严格 JSON 数组，不要输出多余文字
- 每项字段：type,question,options,answer

资料正文：
${String(text || '').slice(0, 9000)}`;

            const data = await callLlmViaServer([{ role: 'user', content: prompt }], {
                max_tokens: 2600,
                temperature: 0.25,
                feature: 'exam_generate',
            });
            const content = data?.choices?.[0]?.message?.content || '';
            const extracted = extractJsonArrayFromText(content);
            const parsed = hrmsSafeParseJson(extracted);
            const arr = Array.isArray(parsed) ? parsed : [];
            if (!arr.length) throw new Error('AI 未返回有效题目');

            return arr.map((q, i) => {
                let type = String(q?.type || 'single').trim();
                if (!allow.includes(type)) type = allow[0] || 'single';
                const question = String(q?.question || q?.q || '').trim();
                const options = Array.isArray(q?.options) ? q.options.map(x => String(x || '').trim()).filter(Boolean) : [];
                const answer = type === 'multi'
                    ? (Array.isArray(q?.answer) ? q.answer.map(x => String(x || '').trim()) : [String(q?.answer || '').trim()])
                    : String(q?.answer || '').trim();
                return { id: 'q_ai_' + Date.now() + '_' + i, type, question, options, answer };
            }).filter(q => q.question);
        }

        async function generateQuestionsForExam(text, cfg) {
            // 优先真实调用 AI 出题（跟闪卡/培训助手一致，走 feature: 'exam_generate' 绑定的模型）；
            // 未配置 AI 或调用失败时才回退到规则生成（保证考试模块始终可用）。
            try {
                const aiQuestions = await aiGenerateExamQuestions(text, cfg);
                if (aiQuestions.length) return applyQuestionConfig(aiQuestions, cfg);
                return applyQuestionConfig(ruleBasedGenerateQuestions(text, cfg), cfg);
            } catch (e) {
                console.error('generateQuestionsForExam error:', e);
                window.__HRMS_LAST_AI_ERROR = String(e?.message || e);
                return applyQuestionConfig(ruleBasedGenerateQuestions(text, cfg), cfg);
            }
        }

        function sanitizeQuestions(raw) {
            const arr = Array.isArray(raw) ? raw : [];
            const mapLetterAnswer = (ans, options) => {
                const a = String(ans || '').trim();
                const idxMap = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
                const k = a.toUpperCase();
                if (k in idxMap) {
                    const idx = idxMap[k];
                    if (Array.isArray(options) && options[idx] != null) return String(options[idx] || '').trim();
                }
                return a;
            };
            return arr.map((q, i) => {
                const type = String(q.type || 'single').trim();
                const options = Array.isArray(q.options) ? q.options.map(String).map(s => String(s || '').trim()).filter(Boolean) : [];
                const answer = q.answer;
                let normalizedAnswer = '';
                if (type === 'multi') {
                    const a = Array.isArray(answer) ? answer : String(answer || '').split(/[，,;；\n]+/);
                    normalizedAnswer = Array.from(new Set(a.map(x => mapLetterAnswer(x, options)).map(x => String(x || '').trim()).filter(Boolean)));
                } else {
                    normalizedAnswer = mapLetterAnswer(answer, options);
                }
                return {
                    id: String(q.id || `q_ai_${Date.now()}_${i}`),
                    type,
                    question: String(q.question || q.q || q.title || q.stem || '').trim(),
                    options,
                    answer: normalizedAnswer
                };
            }).filter(q => {
                if (!q.question) return false;
                const t = String(q.type || '').trim();
                if (t === 'blank') return !!String(q.answer || '').trim();
                if (t === 'tf') return q.options.length === 2 && q.options.includes('正确') && q.options.includes('错误') && !!String(q.answer || '').trim();
                if (t === 'single') return q.options.length >= 2 && !!String(q.answer || '').trim();
                if (t === 'multi') return Array.isArray(q.answer) && q.answer.length >= 1 && q.options.length >= 2;
                return false;
            });
        }

        function getExamMaterialTextForGeneration() {
            const textarea = document.getElementById('training-material-text');
            return textarea ? String(textarea.value || '').trim() : '';
        }

        async function generateQuestionsFromMaterial() {
            if (!isAdminUser()) {
                showNotification('仅管理员可使用AI出题', 'warning');
                return;
            }
            const text = getExamMaterialTextForGeneration();
            if (!text) {
                showNotification('请先在“考试内容”中输入/加载培训资料文本（无需先点保存资料）', 'warning');
                return;
            }

            const btnAi = document.getElementById('btn-ai-generate');
            const oldAiText = btnAi ? btnAi.innerHTML : '';
            if (btnAi) {
                btnAi.disabled = true;
                btnAi.innerHTML = '<i>🤖</i> 正在出题...';
            }

            try { window.__HRMS_LAST_AI_ERROR = ''; } catch (e) {}

            const cfg = getExamConfigFromUI();
            const targetCount = Math.max(1, Math.min(500, Number(cfg?.count || 8) || 8));
            const setsCount = Math.max(1, Math.min(20, Number(cfg?.sets || 1) || 1));
            const padToCount = (arr) => {
                let out = Array.isArray(arr) ? arr.slice() : [];
                if (out.length < targetCount) {
                    const fallback = applyQuestionConfig(ruleBasedGenerateQuestions(text, cfg), cfg);
                    const used = new Set(out.map(q => String(q?.id || '')));
                    for (const q of fallback) {
                        if (out.length >= targetCount) break;
                        const id = String(q?.id || '');
                        if (id && used.has(id)) continue;
                        out.push(q);
                        if (id) used.add(id);
                    }
                }
                if (out.length > targetCount) out = out.slice(0, targetCount);
                const seed = hrmsMakeRunSeed('exam_bank');
                const rng = hrmsSeededRng(seed);
                hrmsShuffleInPlace(out, rng);
                return out;
            };

            try {
                showNotification('AI出题中，请稍候...', 'info');
                const questions = await generateQuestionsForExam(text, cfg);
                const base = padToCount(questions);
                const questionSets = setsCount > 1 ? hrmsBuildQuestionSets(base, setsCount, 'bank_' + String(cfg?.difficulty || 'm')) : [base];
                const bank = questionSets[0] || base;
                try {
                    const data = HRMS_STORE.ensure();
                    data.questionSets = questionSets;
                    HRMS_STORE.set(data);
                } catch (e) {}
                HRMS_STORE.setQuestionBank(bank);
                try {
                    await HRMS_API.saveExamQuestionBank(bank, questionSets);
                } catch (e) {
                    showNotification('题库已更新到本地，但同步服务器失败：' + String(e?.message || e), 'warning');
                    renderQuestionBankPreview();
                    return;
                }
                renderQuestionBankPreview();
                const lastErr = String(window.__HRMS_LAST_AI_ERROR || '').trim();
                if (lastErr) {
                    showNotification('AI出题已降级规则生成：' + lastErr, 'warning');
                } else {
                    showNotification('AI出题完成（已更新题库）', 'success');
                }
            } catch (e) {
                console.error(e);
                const fallback = padToCount([]);
                const questionSets = setsCount > 1 ? hrmsBuildQuestionSets(fallback, setsCount, 'bank_fallback') : [fallback];
                const bank = questionSets[0] || fallback;
                try {
                    const data = HRMS_STORE.ensure();
                    data.questionSets = questionSets;
                    HRMS_STORE.set(data);
                } catch (e2) {}
                HRMS_STORE.setQuestionBank(bank);
                try {
                    await HRMS_API.saveExamQuestionBank(bank, questionSets);
                } catch (e2) {
                    showNotification('规则题库已更新到本地，但同步服务器失败：' + String(e2?.message || e2), 'warning');
                    renderQuestionBankPreview();
                    return;
                }
                renderQuestionBankPreview();
                const lastErr = String(window.__HRMS_LAST_AI_ERROR || '').trim();
                showNotification('AI调用异常，已使用规则生成（已更新题库）' + (lastErr ? '：' + lastErr : ''), 'warning');
            } finally {
                try {
                    if (btnAi) {
                        btnAi.disabled = false;
                        btnAi.innerHTML = oldAiText || '<i>🤖</i> AI出题(客观题)';
                    }
                } catch (e) {}
            }
        }
        
        // 员工管理功能
        function empCalcAgeFromBirthday(birthdayRaw) {
            const s = String(birthdayRaw || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
            const b = new Date(s + 'T00:00:00');
            if (!Number.isFinite(b.getTime())) return null;
            const now = new Date();
            let age = now.getFullYear() - b.getFullYear();
            const m = now.getMonth() - b.getMonth();
            if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
            return Number.isFinite(age) && age >= 0 ? age : null;
        }

        function empCalcTenureYears(joinDateRaw) {
            const jd = String(joinDateRaw || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(jd)) return null;
            const start = new Date(jd + 'T00:00:00');
            if (!Number.isFinite(start.getTime())) return null;
            const now = new Date();
            const years = (now.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
            return Number.isFinite(years) && years >= 0 ? years : null;
        }

        function empIsKitchenRole(emp) {
            const txt = `${String(emp?.position || '')} ${String(emp?.department || '')}`.toLowerCase();
            return /(后厨|厨房|后堂|后场|出品|厨师|厨工)/.test(txt);
        }

        function applyEmployeeFilters() {
            loadEmployeesData();
        }

        function loadEmployeesData() {
            const tbody = document.getElementById('employee-tbody');
            if (!tbody) return;

            const cardsEl = document.getElementById('employee-cards');

            const employeesRaw = HRMS_STORE.getEmployees() || [];
            const usersRaw = (HRMS_STORE.getUsers ? HRMS_STORE.getUsers() : []) || [];
            const byUsername = new Map();
            const byUsernameLower = new Map();
            try {
                (usersRaw || []).forEach(u => {
                    const k = String(u?.username || '').trim();
                    const kl = k.toLowerCase();
                    if (!k) return;
                    if (!byUsernameLower.has(kl)) {
                        byUsernameLower.set(kl, {
                            id: String(u?.id || '').trim(),
                            username: k,
                            password: String(u?.password || ''),
                            name: String(u?.name || ''),
                            role: hrmsNormalizeRoleCode(u?.role),
                            store: String(u?.store || ''),
                            managerUsername: String(u?.managerUsername || ''),
                            position: String(u?.position || ''),
                            department: String(u?.department || ''),
                            level: String(u?.level || ''),
                            salary: u?.salary ?? '',
                            joinDate: String(u?.joinDate || ''),
                            phone: String(u?.phone || ''),
                            email: String(u?.email || ''),
                            status: String(u?.status || 'active'),
                            createdAt: String(u?.createdAt || ''),
                            lastLogin: u?.lastLogin || null
                        });
                    }
                });

                (employeesRaw || []).forEach(u => {
                    const k = String(u?.username || '').trim();
                    const kl = k.toLowerCase();
                    if (!k) return;
                    const existing = byUsernameLower.get(kl) || {};
                    byUsernameLower.set(kl, {
                        ...existing,
                        ...u,
                        username: k,
                        role: hrmsNormalizeRoleCode(u?.role)
                    });
                });

                byUsernameLower.forEach((v, kl) => {
                    const k = String(v?.username || '').trim();
                    if (!k) return;
                    byUsername.set(k, v);
                    byUsername.set(kl, v);
                });
            } catch (e) {}

            const employees = Array.from(byUsernameLower.values()).filter(e => String(e?.username || '').trim());
            try {
                const oldCount = Array.isArray(employeesRaw) ? employeesRaw.filter(e => String(e?.username || '').trim()).length : 0;
                if (employees.length !== oldCount) {
                    HRMS_STORE.setEmployees(employees);
                }
            } catch (e) {}

            const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];

            const normEmpStore = (s) => String(s || '').trim().replace(/\s+/g, ' ');
            const isInactiveEmp = (emp) => {
                const raw = String(emp?.status || '').trim();
                if (!raw) return false;
                const st = raw.toLowerCase();
                if (['inactive', 'resigned', 'terminated', 'deleted', 'left', 'departed'].includes(st)) return true;
                if (/离职|离岗|离退|已删除|已离职|停职|停用/.test(raw)) return true;
                return false;
            };
            const resolveManagerStoreForEmployees = (pool) => {
                let s = normEmpStore(currentUser?.store || '');
                if (s) return s;
                const un = String(currentUser?.username || '').trim().toLowerCase();
                const self = (pool || []).find((e) => String(e?.username || '').trim().toLowerCase() === un);
                return normEmpStore(self?.store || '');
            };

            // 根据当前用户角色过滤员工（与 GET /api/state 裁剪策略一致）
            let filtered = employees;
            if (currentUser && currentUser.role === ROLES.STORE_MANAGER) {
                const myStore = resolveManagerStoreForEmployees(employees);
                filtered = myStore
                    ? employees.filter((e) => normEmpStore(e?.store) === myStore && !isInactiveEmp(e))
                    : [];
            } else if (currentUser && currentUser.role === ROLES.ADMIN) {
                // 管理员可见含离职在内的全量
            } else if (currentUser) {
                // 总部营运 / 人事及其他非管理员：不展示离职等停用记录
                filtered = employees.filter((e) => !isInactiveEmp(e));
            }

            const parseJoinDateTs = (emp) => {
                const jd = String(emp?.joinDate || emp?.hireDate || emp?.startDate || emp?.entryDate || emp?.onboardDate || emp?.joiningDate || '').trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(jd)) return Number.POSITIVE_INFINITY;
                const t = new Date(jd + 'T00:00:00').getTime();
                return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
            };
            filtered = (Array.isArray(filtered) ? filtered.slice() : []).sort((a, b) => {
                const aInactive = isInactiveEmp(a) ? 1 : 0;
                const bInactive = isInactiveEmp(b) ? 1 : 0;
                if (aInactive !== bInactive) return aInactive - bInactive;

                const ta = parseJoinDateTs(a);
                const tb = parseJoinDateTs(b);
                if (ta !== tb) return ta - tb;

                const an = String(a?.name || a?.username || '').trim();
                const bn = String(b?.name || b?.username || '').trim();
                return an.localeCompare(bn, 'zh-Hans-CN');
            });

            const searchQuery = String(document.getElementById('employee-search-input')?.value || '').trim().toLowerCase();
            const filterStore = String(document.getElementById('emp-filter-store')?.value || '').trim();
            const filterPos = String(document.getElementById('emp-filter-position')?.value || '').trim();
            const filterGender = String(document.getElementById('emp-filter-gender')?.value || '').trim();
            const filterAge = String(document.getElementById('emp-filter-age')?.value || '').trim();
            const filterTenure = String(document.getElementById('emp-filter-tenure')?.value || '').trim();

            try {
                const storeEl = document.getElementById('emp-filter-store');
                const posEl = document.getElementById('emp-filter-position');
                if (storeEl) {
                    const prev = filterStore;
                    if (currentUser && currentUser.role === ROLES.STORE_MANAGER) {
                        const ms = resolveManagerStoreForEmployees(employees);
                        if (ms) {
                            storeEl.innerHTML = `<option value="${escapeHtml(ms)}">${escapeHtml(ms)}</option>`;
                            storeEl.value = ms;
                        } else {
                            storeEl.innerHTML = '<option value="">未绑定门店</option>';
                            storeEl.value = '';
                        }
                        storeEl.disabled = true;
                    } else {
                        storeEl.disabled = false;
                        const vals = Array.from(new Set(filtered.map(e => String(e?.store || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
                        storeEl.innerHTML = '<option value="">全部门店</option>' + vals.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
                        if (prev) storeEl.value = prev;
                    }
                }
                if (posEl) {
                    const prev = filterPos;
                    const vals = Array.from(new Set(filtered.map(e => String(e?.position || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
                    posEl.innerHTML = '<option value="">全部岗位</option>' + vals.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
                    if (prev) posEl.value = prev;
                }
            } catch (e) {}

            const beforeFilterCount = filtered.length;
            const beforeFilterActiveCount = filtered.filter(e => !isInactiveEmp(e)).length;
            filtered = filtered.filter((emp) => {
                const name = String(emp?.name || '').trim();
                const username = String(emp?.username || '').trim();
                const store = String(emp?.store || '').trim();
                const pos = String(emp?.position || '').trim();
                const dept = String(emp?.department || '').trim();
                const gender = String(emp?.gender || '').trim();
                const salary = String(emp?.salary ?? emp?.wage ?? emp?.baseSalary ?? emp?.monthlySalary ?? emp?.pay ?? '').trim();
                const joinDateRaw = String(emp?.joinDate || emp?.hireDate || emp?.startDate || emp?.entryDate || emp?.onboardDate || emp?.joiningDate || '').trim();
                const text = `${name} ${username} ${store} ${pos} ${dept} ${gender} ${salary} ${joinDateRaw}`.toLowerCase();
                if (searchQuery && !text.includes(searchQuery)) return false;
                if (filterStore && store !== filterStore) return false;
                if (filterPos && pos !== filterPos) return false;
                if (filterGender && gender !== filterGender) return false;

                const age = empCalcAgeFromBirthday(emp?.birthday);
                if (filterAge === 'lt25' && !(age != null && age < 25)) return false;
                if (filterAge === '25to30' && !(age != null && age >= 25 && age <= 30)) return false;
                if (filterAge === '31to40' && !(age != null && age >= 31 && age <= 40)) return false;
                if (filterAge === 'gt40' && !(age != null && age > 40)) return false;

                const tenureYears = empCalcTenureYears(joinDateRaw);
                if (filterTenure === 'lt1' && !(tenureYears != null && tenureYears < 1)) return false;
                if (filterTenure === '1to3' && !(tenureYears != null && tenureYears >= 1 && tenureYears < 3)) return false;
                if (filterTenure === '3to5' && !(tenureYears != null && tenureYears >= 3 && tenureYears < 5)) return false;
                if (filterTenure === 'gt5' && !(tenureYears != null && tenureYears >= 5)) return false;
                return true;
            });

            try {
                const summaryEl = document.getElementById('emp-summary-view');
                if (summaryEl) {
                    const activeFiltered = filtered.filter(e => !isInactiveEmp(e));
                    const storesSet = Array.from(new Set(activeFiltered.map(e => String(e?.store || '').trim()).filter(Boolean)));
                    const kitchenCount = activeFiltered.filter(empIsKitchenRole).length;
                    const frontCount = Math.max(0, activeFiltered.length - kitchenCount);
                    const baseStoreLabel = currentUser?.role === ROLES.STORE_MANAGER
                        ? String(currentUser.store || '当前门店')
                        : (storesSet.length ? storesSet.join('、') : '全部门店');
                    summaryEl.innerHTML = `
                        <div class="emp-summary-strip">
                            <span><span class="emp-sum-k">范围</span><span class="emp-sum-v">${escapeHtml(baseStoreLabel)}</span></span>
                            <span><span class="emp-sum-k">在职</span><span class="emp-sum-v">${activeFiltered.length}</span><span style="opacity:.55;font-weight:500;"> / 筛选前 ${beforeFilterActiveCount}</span></span>
                            <span><span class="emp-sum-k">前厅</span><span class="emp-sum-v">${frontCount}</span></span>
                            <span><span class="emp-sum-k">后厨</span><span class="emp-sum-v">${kitchenCount}</span></span>
                        </div>
                    `;
                }
            } catch (e) {}

            const computeTenureText = (joinDateRaw) => {
                const jd = String(joinDateRaw || '').trim();
                if (!jd || !/^\d{4}-\d{2}-\d{2}$/.test(jd)) return '-';
                try {
                    const start = new Date(jd + 'T00:00:00');
                    const now = new Date();
                    if (!(start instanceof Date) || isNaN(start.getTime())) return '-';
                    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
                    if (now.getDate() < start.getDate()) months -= 1;
                    if (!Number.isFinite(months) || months < 0) months = 0;
                    const years = Math.floor(months / 12);
                    const rem = months % 12;
                    if (years <= 0) return `${rem}月`;
                    if (rem <= 0) return `${years}年`;
                    return `${years}年${rem}月`;
                } catch (e) {
                    return '-';
                }
            };
            
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#97848E;padding:40px;">暂无员工数据</td></tr>';
                try {
                    if (cardsEl) {
                        cardsEl.innerHTML = '<div style="text-align:center;color:rgba(151,132,142,0.72);padding:28px 12px;">暂无员工数据</div>';
                    }
                } catch (e) {}
                return;
            }

            const roleLabels = {
                [ROLES.ADMIN]: '系统管理员',
                [ROLES.HQ_MANAGER]: '总部经理',
                [ROLES.STORE_MANAGER]: '门店店长',
                [ROLES.EMPLOYEE]: '普通员工'
            };

            const statusLabels = {
                'active': '<span style="color:#86C9A2;">在职</span>',
                'inactive': '<span style="color:#E58B98;">离职</span>',
                'pending': '<span style="color:#CFA14A;">待入职</span>'
            };

            const statusText = {
                'active': '在职',
                'inactive': '离职',
                'pending': '待入职'
            };

            tbody.innerHTML = filtered.map(emp => {
                const username = emp.username || '';
                const empKey = String(username || emp.id || '').trim();
                const name = emp.name || '';
                const store = emp.store || '-';
                const pos = emp.position || '-';
                const status = statusLabels[emp.status] || emp.status || '-';
                const statusPlain = statusText[emp.status] || (emp.status || '-');
                const joinDateRaw = emp.joinDate || emp.hireDate || emp.startDate || emp.entryDate || emp.onboardDate || emp.joiningDate || '';
                const joinDate = joinDateRaw || '-';
                const tenure = computeTenureText(joinDateRaw);
                const salaryRaw = (emp.salary !== undefined && emp.salary !== null && emp.salary !== '') ? emp.salary
                    : ((emp.wage !== undefined && emp.wage !== null && emp.wage !== '') ? emp.wage
                        : ((emp.baseSalary !== undefined && emp.baseSalary !== null && emp.baseSalary !== '') ? emp.baseSalary
                            : ((emp.monthlySalary !== undefined && emp.monthlySalary !== null && emp.monthlySalary !== '') ? emp.monthlySalary
                                : ((emp.pay !== undefined && emp.pay !== null && emp.pay !== '') ? emp.pay : ''))));
                const salary = (salaryRaw === null || salaryRaw === undefined || salaryRaw === '') ? '-' : String(salaryRaw);
                const gender = String(emp.gender || '').trim() || '-';
                const birthday = String(emp.birthday || '').trim() || '-';
                const age = empCalcAgeFromBirthday(emp?.birthday);
                const ageDisp = age !== null ? `${age}岁` : '-';
                const mgrU = String(emp.managerUsername || '').trim();
                let mgrDisp = '-';
                if (mgrU) {
                    const m = byUsername.get(mgrU) || null;
                    const mn = String(m?.name || '').trim();
                    mgrDisp = mn || mgrU;
                }

                let isNew = false;
                try {
                    const jd = String(joinDateRaw || '').trim();
                    if (jd && /^\d{4}-\d{2}-\d{2}$/.test(jd)) {
                        const t = new Date(jd + 'T00:00:00');
                        const now = new Date();
                        const days = Math.floor((now.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
                        if (Number.isFinite(days) && days >= 0 && days <= 90) isNew = true;
                    }
                } catch (e) {}
                const newBadge = isNew ? '<span class="emp-new-badge">新</span>' : '';
                const coreTalentBadge = emp.coreTalent ? '<span style="display:inline-block;background:linear-gradient(135deg,rgba(207,161,74,0.25),rgba(207,161,74,0.15));color:rgba(207,161,74,0.95);font-size:10px;font-weight:800;padding:1px 6px;border-radius:6px;margin-left:4px;">核心</span>' : '';

                return `<tr>
                    <td>${name}${newBadge}${coreTalentBadge}</td>
                    <td>${gender}</td>
                    <td>${birthday}</td>
                    <td>${ageDisp}</td>
                    <td>${store}</td>
                    <td>${pos}</td>
                    <td>${salary}</td>
                    <td>${tenure}</td>
                    <td>${mgrDisp}</td>
                    <td>${status}</td>
                    <td>
                        <div class="action-buttons" style="display:flex;gap:6px;flex-wrap:nowrap;">
                            <button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" data-click="viewEmployee" data-arg="${escapeHtml(empKey)}">查看</button>
                            ${isAdminUser() ? `<button class="btn" style="padding:6px 10px;font-size:12px;" data-click="editEmployee" data-arg="${escapeHtml(empKey)}">编辑</button>` : ''}
                            ${isAdminUser() ? `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;color:#E58B98;" data-click="deleteEmployee" data-arg="${escapeHtml(empKey)}">删除</button>` : ''}
                            ${isAdminUser() && isInactiveEmp(emp) ? `<button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;color:#D18FA0;border-color:rgba(209,143,160,0.35);background:rgba(209,143,160,0.08);" data-click="loginAsEmployee" data-arg="${escapeJsString(empKey)}" data-arg2="${escapeJsString(emp.name || empKey)}">代登录</button>` : ''}
                        </div>
                    </td>
                </tr>`;
            }).join('');

            try {
                if (cardsEl) {
                    cardsEl.innerHTML = filtered.map(emp => {
                        const idRaw = String(emp.id || '').trim();
                        const usernameRaw = String(emp.username || '').trim();
                        const empKey = String(usernameRaw || idRaw || '').trim();
                        const username = usernameRaw || '-';
                        const name = String(emp.name || '').trim() || '-';
                        const store = String(emp.store || '').trim() || '-';
                        const dept = String(emp.department || '').trim() || '-';
                        const pos = String(emp.position || '').trim() || '-';
                        const level = String(emp.level || '').trim() || '-';
                        const managerU = String(emp.managerUsername || '').trim();
                        const manager = managerU ? hrmsDisplayName(managerU) : '-';
                        const phone = String(emp.phone || '').trim() || '-';
                        const email = String(emp.email || '').trim() || '-';
                        const joinDateRaw = String(emp.joinDate || emp.hireDate || emp.startDate || emp.entryDate || emp.onboardDate || emp.joiningDate || '').trim();
                        const joinDate = joinDateRaw || '-';
                        const tenure = computeTenureText(joinDateRaw);
                        const salaryRaw = (emp.salary !== undefined && emp.salary !== null && emp.salary !== '') ? emp.salary
                            : ((emp.wage !== undefined && emp.wage !== null && emp.wage !== '') ? emp.wage
                                : ((emp.baseSalary !== undefined && emp.baseSalary !== null && emp.baseSalary !== '') ? emp.baseSalary
                                    : ((emp.monthlySalary !== undefined && emp.monthlySalary !== null && emp.monthlySalary !== '') ? emp.monthlySalary
                                        : ((emp.pay !== undefined && emp.pay !== null && emp.pay !== '') ? emp.pay : ''))));
                        const salary = (salaryRaw === null || salaryRaw === undefined || salaryRaw === '') ? '-' : String(salaryRaw);
                        const gender = String(emp.gender || '').trim() || '-';
                        const birthday = String(emp.birthday || '').trim() || '-';
                        const ageM = empCalcAgeFromBirthday(emp?.birthday);
                        const ageDispM = ageM !== null ? `${ageM}岁` : '-';
                        const role = String(roleLabels[emp.role] || emp.role || '-');
                        const st = String(statusText[emp.status] || emp.status || '-');
                        const statusBadge = st === '在职' ? '在职' : (st === '离职' ? '离职' : st);

                        let isNew = false;
                        try {
                            const jd = String(joinDateRaw || '').trim();
                            if (jd && /^\d{4}-\d{2}-\d{2}$/.test(jd)) {
                                const t = new Date(jd + 'T00:00:00');
                                const now = new Date();
                                const days = Math.floor((now.getTime() - t.getTime()) / (24 * 60 * 60 * 1000));
                                if (Number.isFinite(days) && days >= 0 && days <= 90) isNew = true;
                            }
                        } catch (e) {}
                        const newBadge = isNew ? '<span class="emp-new-badge">新</span>' : '';
                        const coreTalentBadge = emp.coreTalent ? '<span style="display:inline-block;background:linear-gradient(135deg,rgba(207,161,74,0.25),rgba(207,161,74,0.15));color:rgba(207,161,74,0.95);font-size:10px;font-weight:800;padding:1px 6px;border-radius:6px;margin-left:4px;">核心</span>' : '';

                        const searchKey = [username, name, store, dept, pos, level, manager, role, statusBadge, joinDate, phone, email, gender, birthday, salary, tenure].join(' ');

                        const click = null; // data-click on card
                        const actions = `
                            <button class="btn btn-secondary" type="button" data-click="viewEmployee" data-arg="${escapeJsString(empKey)}" data-stop>查看</button>
                            ${isAdminUser() ? `<button class="btn btn-secondary" type="button" data-click="editEmployee" data-arg="${escapeJsString(empKey)}" data-stop>编辑</button>` : ''}
                            ${isAdminUser() ? `<button class="btn btn-secondary" type="button" style="color:#EDA1AC;border-color:rgba(237,161,172,0.35);" data-click="deleteEmployee" data-arg="${escapeJsString(empKey)}" data-stop>删除</button>` : ''}
                            ${isAdminUser() && isInactiveEmp(emp) ? `<button class="btn btn-secondary" type="button" style="color:#D18FA0;border-color:rgba(209,143,160,0.35);background:rgba(209,143,160,0.08);" data-click="loginAsEmployee" data-arg="${escapeJsString(empKey)}" data-arg2="${escapeJsString(emp.name || empKey)}" data-stop>代登录</button>` : ''}
                        `;

                        const stCls = emp.status === 'active' ? 'st-active' : (emp.status === 'inactive' ? 'st-inactive' : 'st-pending');
                        return `
                            <div class="emp-card" data-search="${escapeHtml(searchKey)}" data-click="hrmsToggleSelfClass" data-arg="expanded" data-arg-self data-click-self-only>
                                <div class="emp-card-head">
                                    <div class="emp-card-name">${escapeHtml(name)}${newBadge}${coreTalentBadge}</div>
                                    <div class="emp-card-status ${stCls}">${escapeHtml(statusBadge)}</div>
                                </div>
                                <div class="emp-card-compact-meta">${escapeHtml(store)}<span class="emp-meta-sep">·</span>${escapeHtml(pos)}<span class="emp-meta-sep">·</span>${escapeHtml(tenure)}<span class="emp-meta-sep">·</span>${escapeHtml(phone)}</div>
                                <div class="emp-card-actions emp-card-actions--tight">${actions}</div>
                                <div class="emp-card-more">
                                    <div class="emp-card-grid">
                                        <div class="emp-card-item"><div class="k">性别</div><div class="v">${escapeHtml(gender)}</div></div>
                                        <div class="emp-card-item"><div class="k">生日</div><div class="v">${escapeHtml(birthday)}</div></div>
                                        <div class="emp-card-item"><div class="k">年龄</div><div class="v">${escapeHtml(ageDispM)}</div></div>
                                        <div class="emp-card-item"><div class="k">工资</div><div class="v">${escapeHtml(salary)}</div></div>
                                        <div class="emp-card-item"><div class="k">部门</div><div class="v">${escapeHtml(dept)}</div></div>
                                        <div class="emp-card-item"><div class="k">级别</div><div class="v">${escapeHtml(level)}</div></div>
                                        <div class="emp-card-item"><div class="k">上级</div><div class="v">${escapeHtml(manager)}</div></div>
                                        <div class="emp-card-item"><div class="k">角色</div><div class="v">${escapeHtml(role)}</div></div>
                                        <div class="emp-card-item"><div class="k">入职</div><div class="v">${escapeHtml(joinDate)}</div></div>
                                        <div class="emp-card-item"><div class="k">邮箱</div><div class="v">${escapeHtml(email)}</div></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            } catch (e) {}
        }

        function hrmsNormalizeIdCardNumber(v) {
            return String(v || '').replace(/\s+/g, '').toUpperCase();
        }

        function hrmsCalcChinaIdCardCheckCode(id17) {
            const s = String(id17 || '').trim();
            if (!/^\d{17}$/.test(s)) return '';
            const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
            const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
            let sum = 0;
            for (let i = 0; i < 17; i += 1) {
                sum += Number(s.charAt(i)) * weights[i];
            }
            return codes[sum % 11] || '';
        }

        function hrmsParseChinaIdCardInfo(idRaw) {
            const input = hrmsNormalizeIdCardNumber(idRaw);
            if (!input) return { ok: false, reason: 'empty' };

            let id18 = '';
            if (/^\d{15}$/.test(input)) {
                const id17 = input.slice(0, 6) + '19' + input.slice(6);
                const check = hrmsCalcChinaIdCardCheckCode(id17);
                if (!check) return { ok: false, reason: 'checksum' };
                id18 = id17 + check;
            } else if (/^\d{17}[\dX]$/.test(input)) {
                const id17 = input.slice(0, 17);
                const check = hrmsCalcChinaIdCardCheckCode(id17);
                if (!check || check !== input.slice(17)) return { ok: false, reason: 'checksum' };
                id18 = input;
            } else {
                return { ok: false, reason: 'format' };
            }

            const birth = id18.slice(6, 14);
            const yyyy = birth.slice(0, 4);
            const mm = birth.slice(4, 6);
            const dd = birth.slice(6, 8);
            const birthMonth = `${yyyy}-${mm}`;

            const y = Number(yyyy);
            const m = Number(mm);
            const d = Number(dd);
            const dt = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
            if (!Number.isFinite(y) || y < 1900 || y > 2100) return { ok: false, reason: 'birth' };
            if (!Number.isFinite(m) || m < 1 || m > 12) return { ok: false, reason: 'birth' };
            if (!Number.isFinite(d) || d < 1 || d > 31) return { ok: false, reason: 'birth' };
            if (!(dt instanceof Date) || isNaN(dt.getTime())) return { ok: false, reason: 'birth' };
            if (dt.getFullYear() !== y || (dt.getMonth() + 1) !== m || dt.getDate() !== d) return { ok: false, reason: 'birth' };

            const sexCode = Number(id18.charAt(16));
            const gender = Number.isFinite(sexCode) ? (sexCode % 2 === 1 ? '男' : '女') : '';

            return { ok: true, id18, birthMonth, birthDate: `${yyyy}-${mm}-${dd}`, gender };
        }

        function hrmsMarkFieldInvalid(el) {
            if (!el) return;
            try {
                el.classList.add('field-invalid');
                el.focus();
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => { try { el.classList.remove('field-invalid'); } catch (e) {} }, 4000);
            } catch (e) {}
        }

        function hrmsEmployeeDraftKey() {
            const u = String(currentUser?.username || 'anon').trim() || 'anon';
            return `hrms_employee_draft_${u}`;
        }

        const HRMS_EMPLOYEE_DRAFT_FIELD_IDS = [
            'employee-form-username', 'employee-form-name', 'employee-form-gender', 'employee-form-birthday',
            'employee-form-idCardNumber', 'employee-form-hometown', 'employee-form-registeredResidence',
            'employee-form-maritalStatus', 'employee-form-store', 'employee-form-wechat', 'employee-form-role',
            'employee-form-department', 'employee-form-position', 'employee-form-level', 'employee-form-manager',
            'employee-form-salary', 'employee-form-education', 'employee-form-joinDate', 'employee-form-bankCardCompany',
            'employee-form-bankNameCompany', 'employee-form-bankCardPersonal', 'employee-form-bankNamePersonal',
            'employee-form-phone', 'employee-form-email', 'employee-form-emergencyContactName',
            'employee-form-emergencyContactPhone', 'employee-form-emergencyContactRelation',
            'employee-form-idcard-front-url', 'employee-form-idcard-back-url', 'employee-form-coreTalent'
        ];

        function saveEmployeeFormDraft() {
            const modal = document.getElementById('employee-form-modal');
            if (!modal || String(modal.dataset.mode || '') !== 'create') return;
            const draft = {};
            HRMS_EMPLOYEE_DRAFT_FIELD_IDS.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                draft[id] = el.type === 'checkbox' ? !!el.checked : String(el.value || '');
            });
            draft.savedAt = new Date().toISOString();
            try {
                localStorage.setItem(hrmsEmployeeDraftKey(), JSON.stringify(draft));
                showNotification('草稿已保存，下次打开新增员工时可恢复', 'success');
            } catch (e) {
                showNotification('草稿保存失败：' + String(e?.message || e), 'error');
            }
        }

        function hrmsLoadEmployeeDraftRaw() {
            try {
                const raw = localStorage.getItem(hrmsEmployeeDraftKey());
                return raw ? JSON.parse(raw) : null;
            } catch (e) { return null; }
        }

        function clearEmployeeFormDraft() {
            try { localStorage.removeItem(hrmsEmployeeDraftKey()); } catch (e) {}
        }

        async function hrmsMaybeRestoreEmployeeDraft() {
            const draft = hrmsLoadEmployeeDraftRaw();
            if (!draft) return;
            const ok = await hrmsConfirm({
                title: '恢复草稿',
                message: '检测到上次未提交成功的员工信息草稿，是否恢复填充？',
                okText: '恢复草稿',
                icon: '📝'
            });
            if (!ok) { clearEmployeeFormDraft(); return; }
            HRMS_EMPLOYEE_DRAFT_FIELD_IDS.forEach(id => {
                if (!(id in draft)) return;
                const el = document.getElementById(id);
                if (!el) return;
                if (el.type === 'checkbox') el.checked = !!draft[id];
                else el.value = String(draft[id] || '');
            });
            try {
                const coreTalentEl = document.getElementById('employee-form-coreTalent');
                const coreTalentLabelEl = document.getElementById('employee-form-coreTalent-label');
                if (coreTalentEl && coreTalentLabelEl) coreTalentLabelEl.textContent = coreTalentEl.checked ? '是' : '否';
            } catch (e) {}
            showNotification('已恢复草稿', 'success');
        }

        function hrmsApplyIdCardDerivedFields(idCardInput, genderEl, birthdayEl) {
            try {
                const normalized = hrmsNormalizeIdCardNumber(idCardInput || '');
                if (!normalized) return false;
                const info = hrmsParseChinaIdCardInfo(normalized);
                if (!info?.ok) return false;
                if (genderEl && info.gender) genderEl.value = info.gender;
                if (birthdayEl && info.birthDate) birthdayEl.value = String(info.birthDate).slice(0, 10);
                return true;
            } catch (e) {
                return false;
            }
        }

        function showAddEmployeeModal() {
            if (!isAdminUser() && !(currentUser && currentUser.role === ROLES.STORE_MANAGER)) {
                showNotification('仅管理员或店长可新增员工', 'warning');
                return;
            }
            openEmployeeFormModal('create');
        }
        
        function editEmployee(empId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可编辑员工', 'warning');
                return;
            }
            openEmployeeFormModal('edit', empId);
        }

        function hrmsGenerateEmployeeId() {
            const employees = HRMS_STORE.getEmployees();
            const used = new Set((employees || []).map(e => String(e?.id || '').trim()).filter(Boolean));
            let maxNum = 0;
            (employees || []).forEach(e => {
                const id = String(e?.id || '').trim();
                const m = id.match(/^(?:EMP)?(\d+)$/i);
                if (m && m[1]) {
                    const n = Number(m[1]);
                    if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
                }
            });
            let next = maxNum + 1;
            let candidate = '';
            for (let i = 0; i < 9999; i += 1) {
                candidate = String(next).padStart(4, '0');
                if (!used.has(candidate)) return candidate;
                next += 1;
            }
            return String(Date.now()).slice(-6);
        }

        var _PINYIN_INITIALS_ = "YDKQSXHWZSSXQBYMGCCZQPSSQBYCDSCDQLDYLYBSGJGYPZJJFGCCLZZBWDWZJLJPFYYNWJJTMYYZWZHFLYPPQHGCCYHYNJQYXXGJX_SDSJNJJSMHML_RXYFSNQSYZZQZGQLLYJLGYZSSECYKYYHQWJSSGGYXYQYJTWKDJHYCHMYXJTLXJYQBYXDLDWRRJJWYSRLDZJPCBZJJBRCFJLBCZSTZFXXTHTRQGYBDLYCCSCYMMRFCYQZPWWJJYFCRWFDFZQPYDDWYXKYJAWJFFXJPDFTZYHHYCYSWCCYQSCLCXXWZCXNBGNNXBXLZSQSBSJPYSYZDHMDZBQBZCWDZZYYTZHBTSYYFZGNTNXQYWQYKBPHGLXGYBFMJEBJHHGQTJCYSXSTKZGLYCKGLYSMZXYALMELDCCXGZYRJXSDLTJZCQKCNNJWHJCZZCQLJSTSTBNXBTYXCEQXGKWJYFLZQLYHJQSPSFXLFPBYSXXXYDCCZYLLLSJXFHJXPJBCFFYABYXBHCZBJYCLWLCZGGBTSSMDTJCXPTHYQTGLJSCJFZKJZJQNLZWLSLHDZBWJNCJZYZSQNYCQYRZCJJWYBRTWPYFTWEXCSKDZCTBXHYZCAYJXZCFBZZMJYXXCDCZOTTBZLJWFCKSZSXFYRLNYGMBDTHJXSQQCCSBXRYTSYFBJDZTGBCNCLCYZZPSACYZQSCJCSHZQYDXLBPJLLMQXTYDZXSQJTZPXLCGLQDCWJBHCTDJJSFXYEJJTLBGXSXJMYJJQPFZASYJNCYDJXKJCDJSZCBARTCCLNJQMWNQNCLLLKBYBZZSYHQCLTWLCCRSHLLZNTYLNEWYZYXCZXXGDKDMTCEDEQTSYYS_D_D__SD_J_HRWNQLYBGLXHLGTGXBQJDZ_YJSJYJCJMRNYMGRCJCZGJMZMGXMMRYXKJNYMSGMZZYMKLFXMBDTGFBHCJYKYLPFMDXLQJJSMTQGZSJLQDLDGJYCALCMZCSDJLLNXDJFFFFJCZFMZFFPFKHKGDPKXKTACJDHHZDDDRRCFQYJKQCCWJDXHWJLYLLZGCFCQDSMLZPBJJPLSBCJGGDCKKDEZSQCCKJGCGKDJTJLLZYCXKLQCCGJCLTFPCQCZGWBJDQYDJJBYJHSJDDWGFSJGDKCCCTLLPSPKJGQJHZZLJPLGJGJJTHJJYJZCZMLZLYQBGJWMLJKXZDZNJQSYZMLJLLJKYWXMKJLHSKJGBMCLYYMKXJQLBMCLKMDXXKWYXWSLMLPSJQJJQXYQFJTJDXMXXLLCRQBSYJBGWY_XGGBCYXPJTGPEPFGDJGBHBNCFJYZJKJKHXQFGQZKFHYGKHDKLLSDJJXPQYKYBNQSXQNSZSWHBSXWHXWBZZXDMNDJBSBKBBZKLYLXGWXJJWAQZMYWSJQLCJXXJQWJEQXSCWETLZHLYYYSDZPYQYZCMTLSHTZCFYCYXYLJSDCJJAGYSLCLLYYYSGLQQQ_LDXZSCCCCADYCJYSFSGBFRLSZQSBXJPSJWSDRCKGJLGDKZJZBDKTCSYQPYHSTCLDJ_HMXMCGXYZHJDCTMHLTXZXYLAMOHYJCLTYFBQQJBFBDFEHTKSQHZYWWCNXXCDWHHWGYJLEGWDMCWGFJHCSNTFYDOLBYGHQWESJPWNMLRYDZSZTXYQPZGCWHHNXPYHSHMDQZXZTDPPBFYHZHHJYFDZWKGKZBLDNTSXHQEEGZXYLZMMZYJZGSZXHHKHTXEXXWYLYAPSTHXDWHZYDPXAGKYDXBYNHXKD_JNMYHYLPMGOCSLNZHKXXLBZZLBMLSFBHHGCGYYGGBHSCYAJTYWLXTZQCWZYDQDQM_GD_LLSZHLSJZWFYHQSWSCELQAJYNYTLSXTHAZGKZZSDHLACQTWWCDGQQTDDYZBCCHYQZFLXPSLZYGPZSZNGLYDQTBDLXJTCTAJDKYWNSYZLJHHDZCWNXYZYWMHYCHHHXHJKZWSXHDYXLYSCQYDPCLYZWMYP_KXYJLKZHTYHAXQSYSGXASMCHKDSCRSWJPWXSGZJLWWSCHS_HSQNHZSNGNDAQTBAALZZMSSTDQJCJKTSCJAXPLGGJHHGOXZCXPDMMHLDGTYBYSJMXHMRZPLXJZCKZXSHFLQXCTDHXEZFCHZCCDJTCJYXQHLXDHYPJQXNLSYYDZOZJNYXQEZYSJYAYJKYPDGXDDXSPPYZNDLTHRHHYDXZJJHTCXMCTLHBYNYHMHZLLXNAMYLLLPDCPPXHMXDKYCYRDLTXJCHHZNXZLCCLYLNZSXZJZZLNN_LWHYQSNJHXYNTTTKYJPYCHHYEGKCWTWLGQRLGGTGTYGYHPYHYLQYQGCWYQKPYYYTTTTLHYHLLTYTTSPLKYZXGTWGPYDQQZZDQXSKCQNMJJZZBXYQMJRTFFBTKHZKBJDJJKDJJTLBWFZPPTKQTZTGPDWNTPJYFALQMKGXFDCLZFHZCLLLLADPMXDJHLCCLGYHDZFGYDDGCYYFGYDXKSSEBDHYKDKDKHNAXXYBPBYYHXCCGABDQYJXDMLJCSQZLLPCHBSXGJYNDYBYQSPQWJLZKTDDTACCBKZDYZYPJZQSJNKKTKNJDJGYEPGTLFYQKASDNTCYHBLGDZHBBYDMJRAGKZYHEYYBJMCDTYFZJJHGCJPLJHLDWXJJKYTCYKSSSMTWCTTQZLPBSZDTWZXGZAGYXTYWXLHLCPBCLLOQMMZSSLCMBJQSDZKYDCZXGQJDSMCYTZQQLWZQZXSSFPKTFQMDDZDSDDTDWFHTDYZJAQJQKYPBDJYYXTLJHDRQXLXHAYDHRJLKLYTWHLLRLLRCXYLBWSRSZZSYMKZZHHKYHXKSMCSYZGCJPBZBSQLFCXXXNXKXWWMSDDYQ_GGQMMYHCDCTTFGYYHGSTTTYBYKJDHKYJBELHDYPJQNFXFDQKZHQKZBYJTZBXHFDXBDASWHAWAJLDYJSFHBLDNNDNQJTJNCHXFJSRFWHZFMDRFJYHWZPDJKZYJYMFCYZNYNXFBYTFWFWYGDBNZZZDNYTXZEMMQBSQEHXFZMBMFLZZSRSYMJGSXWZJSPRYDJSJGXHJJGLJJYNZZJXHGJKYMLPEYYCXYSGQZSWHWLYRJLPXSLCXMFSWWKCCTNXNYNPNJSZHDZEPTMMWYWXYYSYWLXJQZQXZDCLAEELMCPJPCLWBXSQHFWWTFFJTNQJHJQDXHWLBYZCFJLNLHYYJLDXHHYCSTDYWNRJTXYWDRMDRQHWQCMFJDYZMHMAYXJWMYZQTXDLMRSPWWCHAJBXTGCYPXYYRRCLMPAMGKQJSZYJRMYJSNXTPLNBAPPYPYLXMYZKYNLDGYJZCZHNLMZHHANQMPGWQTZMXXMLLHGDZXYHXKRXYCJMFFXYHJFSBSSQLQXNDYCANNMTCJCYPRRNYTYQNYYMBMSXNDLYLYSLJNLQYSXHMLLYZLZJJJKYMZCSFBZXXMSTBJGNXYZHLSNMCQSCYZNFZLXBRNNNYLMNRTGZQYSATSWRYHYJZMZDHZGZDWYBSSCSKXSYHYTSXGCQGXZZBHYXJSCRHMKKBSCJJYJYMKQHZJFNBHMQHYSNJNZYBKNQMCLGQHWLSNZSWXKHLJHYYBQCBFCDSXDLDSPFZFSKJJZWZXSDDXJSEEEGJSCSSMGCLXXHWWYLLYMWWWGYDKZJGGGTGGSYCKNJWNJPCXBJJTQTJWDSSPJXZXNZXWMELBTFSXTLLXCLJXJJLJSXCTNSWXLAHHHYQRWHSYCSQRYBYAYWJEJQFWQCQQCJQGXALDBZZYJGKGXPLTQYFXJLTPADKYQHPMATLDPDZKXMTXYBHBLEFXDLEEGQDYMSAWHZMLFTWYQXLYQZLJEEYXBQQFFNLYXRDSCTGJGXYWLKLLXQKCCTLHJLQMKKZGCYYGLLLJDZGYDHZWXPYSJBZJDZGYZZHYWYFQYTYZSZYEZKLYMHJJHTSMQWYZLKYYWZCSRKQYQLTCXWCDRJALWSKZWBDCQYNCJSRSZJLKCDCDTLZZZACQQWZDDXYPLXCBQJYLZLLLQDTZJJYJYJZYXNYYYNXJXKGDAZWYRDLJYYYRJLXLLDYXJCYKYWNQCCLDDNYYYKYCKCZHJXCCLGZQJGJWGGCQQJYSBZZXYJXJ_XJFZBSBDSFNSFPZXHDWZTDMPPTFLZZBZDMYYPQJRSDZSQZSQXBDGCPZJWDWCSQZGMZHZZMWWFYBPDGPHTMJTHZSMMBGZMBZJCFZHFZBBZMQCFMBCMCJXLGPNJBBXGYHYYJGPTZGZMQBQDCGYBJXLWZKYDPDYMGCFTPFXYZTZXDZXTGKMTYBBCLBJASKYTSSQYYMSCXFJEGLSLLSZBQJJJAKLYLDLYCCTSXMCWFGKKBQXLLLLJYXTYLTYXYTDPJHNHGNKBYQNFJYYZBYYESSESSGDYHFHWTCJBSDZJTFDMXHCNJZYMQWSRXJDZJQPTQBBSDJGGFBKJBXDGQHMGWJJJGDLLTHZHHYYYYYHSXWTYYYCCBDBPYPZYCCZTJPZYWCBDLFWZCWJDXXHYHLHWCZXJTCCLCDPXDJCZCZLYXJJSJBHFXWPYWXZPTDZZBDCCJHJHMLXBQXXBYLRDDGJRRCTTTGYTCZWMXFYTMMZCWJWXJYWCSKYBZQCCTTQNHXNKXXKHKFHTSWOCCJYBCMPZZYKBNNZPBTHHCDLSYDDYTYFJPXYNGFXBYQXCBHXCBSXTYZDM_YSNXSXLHKMZXLTHDHKGHXXSSHQYHHCJYXGLHZXCSNHEKDTGQXQYPKDHEQTYKCNYMYYYPKQYYTJXZLTHHQTBYQHXBMYHSQCKWWYLLHCYYLNNEQXQWMCFBDCCMLJGGXDQKTLXKGNQCDGZJWYJJLYHHQDTTNWCHHXCXWHESZJYDJCCDBQCDGDNYXZDHCQRXCBMZTQCBXWGQWYYBXHMBYMYKDYECMKKYAQYNGYCSLFYKKQGYSSQYSHJGJCNXKZYCXSBKYXHYYLCTYCXQTHYSMGSCPMMGCCCCCMTZTASMGQZJHKLOSJYLSWTMQSYQKDZLJQQYPLCYCZTCQQPBBQJZCLPKHQCYYXXDTDDDSJCXFFLLCHQXMJLWCJCXTSPYCXNDTJSHJWXDQQJCKXYAMYLSJHMLALYGXCYYDMAMDQMLMCZNNYYBZKKYFLMCHCMLHXRCJJHSYLNMTJGGZGYWJXSRXCWJGJQHQZDQJDZJJZKJKGDZQGJJYJYLXZHXCDQHHHESTMHLFSBDJSYYSHFYSSCZQLPBDRFRZTZDKYYHSCTGKWDQZRKMSYNBCRXQBJYFBXPZZEDZCJYKBCJWHYJBQDZYWNYSZPTDKZPFPBAZTKLQYHBBZPNBPTYZZYBHNYDCPJMMCYCQMZJFZZDCMNLFPBPLNGQJTBTTAJZPZBBDNJKLJQYLNBZQHKSJZNGGQSCZKYXCHPZSNBCGZKDDZQANZGJKDNTLZLDWJLJZLYWTXNDJZJHXYATNCBGTZCSSKMNJBJYTSRWXCPJWJJTKHTZPLBHSNJZSYJBWBZYZLSTLSBJHDWWQPSLMMFBJDLAJYZCCJTBNNRZWQXCDSLQGDSDPDZHJTQQPSQLYYJZLGNHYZLCTCBJTKTYCZJTQKBPJLGMJZDMCSGPYNJZJJYYKNHRPWSZXMTNCSZZYXHBYHYZAXYWKCJDLLCKJJTJHGCXDXYJYCZBYWBLWQCGLZGJGQRQCCZSSBCRPCSKYDZNLJSQGXSSJMECNSTJTPBDLTHZWHQWQTZEXNQCZGWESGSSBYBSTSCSJCCGBFSDQSZLCCGLLLZGHZQTHCNMJGYZAZNMCKCSTJMMZCKBJYGQLJYJPPLDXRGZYXCCSNHSHHDZNLCHZJJCDDCBCJXLBFQBCZZWPQDNHXLJCTHQZJGYLNLSZZPCJDSCQQHJQKDXKPBAJYEMSMJTZDXLCJYRYYNHJBNGZZKMJXLTBSLLRTPYLCSZNXJHLLHYLLQQZQLXYMRCWCXSLJMCZLTZLDWDJJLLNZGGJXPPSKYGYGGBFZPDKMWGHCXMCGDXJMCJSDYCABXJDLNBCDDYGSKYDQTXDJJYXMSAQAZDCFSLQXYJSJZYLBLXXWXQQZBJZLFBBLYLWDSLJHXJYZJWTDJCYFQZQZZDZSXZZQLZCDZFCHWSPYMPQZMLPPLFFXJJNZZYLSJ_YQZFPFZKSYWJJJHRDJZZXTXXGLGHTDXCSKYSWMMTCWYBAZBJKSHFHGCXMHFQHYXXYZFTSJYZBXYXPZLCHMZMBXHZZSSYFYMNCWDABAZLXKTCSHHXKXJJZJSTHYGXSXYYHHHJWXKZXSSBZZWWHHCWTZZZPJXSNXQQJGZYZAWLLCWXZFXGYXYHXMKYYDWSQMNJNAYCYSPMJKHWCQHYLAJJMZXHMMCNZHBHXCLXTJPLTXYJHDYYLTTXFSZHYXXSJBJYAYRSMXYPLCKDLYHLXRLNLLSTYZYYQYGYHHSCCSMZCTZCXHYQFBYYRPBFLFQTNTSZLLJMHWTCJQYZWTLLMLM_WMBZZS_ZRBPDDDLGJJBXCCSRZQQYGWCSXFWZLXCCRSTDZMCYGGDYQSGTJMWLJMYMMSYHBBJDGYXCCPSHXNZCSBSJWJGJMPPWAFFYFNXHYDXZYLREMZGZCYHSSZDLLJCSQFZXXKPTXZGXJJGBMYYYSNBTYLBNLHPFZDCYFBMGQRRMSSZXYSGTZNNYDDZCDGBJAFJBDKNZBLCSSZBSGCYCJSZLMLRSZBZZLDL_LLYSXSQCQLYXZLSGKBRXBRBZCYCXZJZEEYFGKLZLYYHGZSGZLFJHGTGWKRAAJYZKZQTSSHJJXDCYZ_YJLZYRZDQQHGJZXSSCBTGJBBFRTJXLLFQWJGSLQTYMBLPZDXTZAGBDHZZRBGJHWNJTJXLKSQFSMWLLDQYSJTXKZSCFWJLBXFTZLLJZLLQBLCQMQQCGCDFPBBHZCZJLPYYGJDTGWDCFCZQYYYQYSRCLQZFKLZZZGFFCQNWGLHJYCJJSZLQZZYJBJZZBPDCCMHJGXDQDGDLZQ_FGPSYTSDYFWWDJZHYSXYYCJCYHZWPBYGXRYLYBHKJKSFXTJJMMCKHLLTNYYMSYXYZPDJJYCDYCWMDJJKQYRHLLQXPSGTLWYCLJSCBXJYZFNMLRGJJTYZBSYZMSJYJHGFZQMSYXRSZCWTLRTQZSSTKXGQGGSPTGCDNJSGCQCQHMXGGZTQYDJKZDLBZSXJLHRQGGGTHQSCPYHJHHGNYGKGGCMJDZLLCCLXQSFTGZSLLLMLCSKCCBLJZZSZMMNYTPZSXQHJCJYQXYEXZQZCPSHGZZYSXCDFGMWQRLLQXRFZTLYSTCTMJCSJJTHJNXTNRZTZFQRHQGLLGCXSZZJDJLXCYTSJTLNYXHSZXCGJZYQPYLFHDJSBPCCZGJJJQZJQDYBSSLLCMYTTMQTBHJQNNYGJYNQYQMZGCJKPDCGMYZHQLLSLLCLMHOLZGDYLFZSLJCQZLYLZCJESHNYLLQXGJXLYJYYYXNBCLJSSWCQQCJYLLCLDQYLLZLLBNYLGQCHXYYQOXCCQKYJXXHYKLKSXAQQCCQKKKKCSGYXXYQXYGWTJOHTHXPXXXXSLCYEYCHZZCBWQBBWJQZSCSZSSLZYLGDESJZWMYMCYTSDSXXSCJPQQSQYLYFZYCHDJDZYWCBTJSYCJKCYDDJLBDJJSODZYQYSQKYXDHHGQJYOHDYXWGMMMAJDYBBBPPBCMHCBLJZSMTXERXJMHQDSTPJDCBSSMSSSTHJTSLMMTRCPLZSZMLQDSDMJMQPNQDXCFYNNFSDQQYXHYAYKQYDDLQYYYSSZBYDSLNTFGTZQBZMCHDHCZCWFDXTMQQSPHQWWXSRGJCWTJTZZQMGWJJRJHTTJBBGWZFXJHNQFXXQYWYYHYSCDYDHHQMNMTMMCHBSZPPZZGPMZFOLLCFWHMMSJZTTDHLMYFFYTZZGZYSKJJXQYJZQBHMBZCLYGHGFMSHPCFZSNCLPBQSNJYZSLXJFPMTYJYGBXLLDLXPZJYPJYHHZCYWHJYLSJEXFSSZYWXKZJLLADYSLYMQJPWXXHXSKTQJEZRPXXZGHMHWQPWQLYJJQJJZSZCFHJLCHHNXJLQWZJHBMZYXBDHHYPYLHLHLGFWLCFYYTLHJJCJMSCPXSTKPNHJXSNTYXXTESTJCTLSSLSTDLLLWWYHDHRJZSFGXSSYCZYKWHTDHWJSLHTZDQDJZXXQGGYLTZPHCSQFZLNJTCLZPFSTPDYNYLGMJLLYCQHYNSBCHYLHQYQTMZYBBYWRFQYKJSYSLZDYJMPXYYSSRHZJNYQTQDFZBWWDWWRXCWHGYHXMKMYYYHMSMZHNGCEPMLQQMTCWCTMHPXJPJJHFXYYZSJZHTYBMSTSYJDTQQQYTLHYNBYQZLCXCNZWSMYLKFJXLWGBYPJYTYSYLYMZCKTDWLGSMZSYLMPWLZWXWQZSSAZSYXYRHSSNTSRAPCCPWCMGDHHQZDZXFJHGZTTSBJHGYZLZYSMYCLLLYBTYXHBBZJKSSDMALHHYCFYGMQYPJYCQXJLLLJGCLZGQLYCJCCTOTYXMTMSHLLWCGFXYMZMKLPSZZCXHHJYSLCTYJCYHXSGYXCKXLZWPYJPDHJWPJPWSQQXLXXDHMRSLZCYZWTTCXKYSTZSHBSCCSTPLWSSCJCHJLCGCJSSPHYLHFHHXJSXALLNYLMZDHZXYLSXLWZYKCLDYAHZCMGDYSPJTQJZLNGJPSJSHCTSDSZLBLMSSMNYYMJQBJHRCWTYYDCHQLJAPZWBGQYBKFCMJWLZLLYYLSZYDWHXPSBCMLJPSCGBHXLQHYRLJXYSWXHXZLLDFHLSLYMJLZYFLYJYCDRJLFSYZFSLLCQYQFGJYHYSZLYLMSTDJCYHBZLLNWLXXYGYYHHMGDHXXHHLZZJZXCZZZCYQZFNJWPYLCPKPYYPMCLQKDGXZGGWQBDXZZKZFBXXLZXJTPJPTTBYTSZZDWSLCHZHSLTJXHQLHYXXXYWZYSWTMZKHLXZXZPYHGCHKJFSYH_TJRLXFJXPTZTWHPLYXFCRHXSHHKJXXYHZJDXJWYLHYHMJTBFLKHTXCWHCFWJZFPQRXQXCYYYJYGRPXGSCSXNGQCHKZDXHFLXXHJJBYZWTQXXNCYJJYMSWYJQRMHXZWFQSYLZJZGBHYNSHBGTTCSEBHXXWXYHHXYXXSQYXMLYWRGYQLXBBCLJSYLFCYTJZYHYZAWLHORJMKSCZJXXXYXCHCYTRYXQJDDSJFSLYLTSFFYXLMTYJMZJYYYXLTZCSXQZLHZXLWYXZHDNLXXHXJCDYHLBRLMBRLLAXKSLLLJLYXXLYCRYLCJCGQCMTLZLLCYZZPZPCYAWHJJFYBDYYZSEPCKZDQYQPBPCJPDCYZBDBBCYYDYCNNPJMTMLRMFMMGWYGBSJGYKSMDQQQZTXMKQWGXLLPJGTBQCDJJJFPKJKCXBLJMSWMDTQJXLDLPPBXCWKCQQBFQJCZAGZGMYKPHYYFZYKNDKZMBPJYXPXTHLFPNYYGXJDBKXNHHJHZJXSTRSTLDXSKZYSYBMXJLXYSLBZYSLHXJPFXBQNBYLLJQKYGZMCYZZYMCCSL_LHZGWFWYXZMWCXTYNHJHBYYMCYSBMHYSMHDYSHQYZCHMJJMZCAAHCFJBBHPLXTYLSXSDJGJDHKXXTXXNBHNMLNGSLTXMRHNLXQJXMZLLYSWQGDLBJHDCGJYQYYMHWFMJYBBBYJMJWJMDPWHXQLDYAPDFXXBCGJSPCKRSSYZJMSLBZZJFLJJJLGXZGYXYXLSZQYXBEXYXHGCXBPLDYHWECDWWCJMBTXCHXYQXLLXFLYXLLJLSSFWDBZCMYJCLMSYTCZBCHQEKCQBWLCGYDBLQPPQZQFJQDJHYMMCXTXDRMJWRHXCJZCLQXDYYNHYYHRSLSRSYWWZJYMTLTLLGTQCJZYABTCKZCJYCCQLJZQXALMZYYYZLWDXZXQDLLJSHGPJFJLJHJABCQZDJGTHHSSTCYJLBSWZLXJXRWGLDLZRLZQTGSLLLLZLYMXQGDZHGBDBHZPBRLW_X_BPFDWO___HLYPC_JCC_DWBZPBZZ_CYQXLDOMZBLZWPDWYYGDSTTHCSQSCCRSSSYSLFYBBNTYJSYDFNDPTHTZZMBBMXLCMYFFGTJJQWFTMDPJWDNLBZCMMCZGBDZLQLFYFHSSMJYLSDCHDZJWJCCTLJCLDTLJJCPDDPJDSSDYNNDBJLGGJZXSXNLYCYBJJQYCBYLZCFZPPGKCXZDZFZTJJFGSJXZBNZYJQTTYJWHTYCZHYMDJXTTMPXSPLZCDWSLSHXYBZGTFMMCJTACBBMGDKWYCYZCDSZZYHFLYCTYGWHKJYYLSJCXGYWJCBLLCSNDDBTZBSCLYZCZZSSQDLLMQYYHFLLQLLXFDYHABXGGNYWYYPLLSDLDLLBJCYXJZMLHLJDXYYQYTDLLLBBGBFDFBBBJZZMDPJHGCLGMJJPGAEHHBWCQXAXHHHZCHXYPHJAXHLPHJPGPZJQCQZGJJZZGZDMQYYBDZPHYHYBWHAZYJHYKFGDPFQSDLZMLJXJPGALXZDAGLMDGXMMZQYTXDXXPFDMMSSYMPFMDMMKXKSYZYSHDZKJSYSMMZZZMSYDNZZCZXBPLSTMDDNMXCKJMZTYYMZMZZMSQHHDCCJEMXXKLJSTGWLSQLYJZLLSJSSDBPMHNLYJCZYHMXXHHZCJMDHXTKGRMXFWMCGMWKDCKSXQMMMFZZYDKMSCLCMPCGMWSPXQPZDSSLCJKYXTWLGJYAHZJGZQWCSNXYHMMPMLKJXMHLMLGMXCTKZMJJYSZJSYSZHSYJZJCDAJZYBSDQJZGWZKGXFKDMSDJLFMEHKZQKJPEYPZYSZCDWYJFFMZJYLTTDZZEFMZLBNPPLPLPBPSZALLTYLKCKQZKGENQLHAGYXYDPXLGSXQQWQ_KXQCLHYXXMLYCCWLYMQYSKY_HLCJNSZKPYZKCQZQLJBDHDJHLASQLBYDWQLWDNBQCRYDDZTJYBKBWSZDXDTNPJDTCTQDFXQQMGNSECLSTBHPWSLCTXXLPWYDZKLZYGZCQAPLLKCCYLBQMQCZQCLJSLQZDJXLDTHPJQDLJJXZQDJYZHKZLJCYQDYJPPYPEAKJYRMPCBYMCXKLLZLLFQPYLLLMBSGJCYSSLRSYSQTMXYXQQZBDZRYSYZTFFBZZSMZQHZSSCCMLYXWTPZGXZJGZGSJSGKDDHTQGGZLLBJDZLCBCHYXYZHZFYXXYZYMSDBZZYJGTSMTFXQYXJSSDGSLNMDLRYTZLRYYLXQHTXSRTZCGZXBNQQZFHYKMZJBZYMKBPNLYZPBLMCNQYZZDSJZHJCTSHHYZZJRDYZHNFXGLFXSLKGJTCTSSYLLGZRZBBJZZKLPKBCZYSLXYXBJFPNJZZXCDWXZYJXZZDJJGGGRSRJKMSMZJLSJYWQS_YHQJSXPJZTZLSNSHRNYPJTWCHKLBSRZLCXWJQXQKYSJYCZTLQZYBBYBWKJQDWWYZCYTJCJXCKCWDKKZHSGKDZXWWYYJQYYTCYTDJLXWKCCKKLCCLZCQQDZLQLCSFQCHQHSFSMQZZLLBJJZBSJHTSJDYSJQJPDLZCDCWJKJZZLPYCGMZWDJJBSJQZSYZYHHXCBBJYDSSDDZNCGLQMBTSFCBFDZDLZNFGFJGFSMPTJQLMBLGQCYYXBQKDJJQSRFKZTJDHCZKLBSDZCFYTPLLJGJHTXZCSSZZXSTCYGKGCKGYOQXJPLZPBBGTGYJZGCZJSZLBJLSJFZGKQQJCGYCZPZQTLDXRJXBSXXPZXHSZYCLWDXJJHXMFCZPFZHQHQMQGKYLYHTYCGFRZGNQXCGPDLBZCSCZQLLJBLHBDCYPZZPPDYMTZSGYHCKCPZJGSLCLNSCDSLDZXBMSDLDDFJMKDJDHSLZXLSZQPQPGJLLYBDSZGQLBZLSLKYYHZTTNCJYQTZZFSZQZTLLJTYYLLQLLQYZQLBDZLSLYYZYMDFSZSNHLXZNCZQZBBWSKRFBCYZMTHBLGJPYCNZCSTLXSHTZCYZLZBLFEQHLXFLCJLYLJQCBZLZJGHSSTBRMHXZHJZCLXFNBGXGTQJCZTMSFZKJMSSNXLJKBHSZXNTNLZDNTLMSJXGZJGJCZXYHYHWRWWQNZTNFJSCPZSHZJFYRDJSFSCJZHJFZQZCHZLXFXSBZQLZSGYFTTDCSZXZJBQMSZKJRHXJZCGBJKHCGGTJKJQGLXBXFGTRTYLXJXGDTSJXHJZJJCWZLCQSBTXHQGXTXXHXFTSDKFJHZYJFJXRZCDLLJCQSQQZJWQXSWQTWGWBZCGCLLQZBCLMQJTZGZXZXLJFRMYZFLXYSZXXJKXRMJDZDMMYXBSQBHGZMWFWTGMXLZBYYTGZYCCDXYZXSWG_YJYZNBGPZJCQSYXCXRTFYZGRHZTXSZZTHCBFCLSYXZLZQMZLMPLMXZJSSFLBYSMYQSXJZXRXSQZZZSSLJFLCZJRCRXHHZXQWDSHXSJJHQCXJBDYNSYSXJBQLPXZZPYMLXZKYXLXCJLCYCRXZZLLDLLLSJYHZXHYJWKJRWYHCPSGNRZLFZWFZZNSXGXFLZSXZZZBFCSYJDBRJKRDHHGXJLJJTGXJXXSTJTJXLYXQFCSGSWMSBCTLQZZWLZZKXJMLTMJWHSDDBXGZHDLBMYJFRZFSGCLYJBPMLYSMSXLSZJQQHJZFXGFQFQBPXZGYYQXGZTCQWYLTLGWWWWHWLFSFGZJMGMGBGTJFSYZZGZYZAFLSSPMLBFLCWBJZCLJJMZLPJJLYMQDMYLYFBGYGQZMLYZDXQYXRQQQHSXYYQQYGJTYXFSFSLLGNQCYHYCWFHCCCFXBYLYPLLZQXXXXXKQHHXSHJZCFDSCZJXCPZWHHHHHAPYLHALPQAFYHXDYLLKMZQGGGDDESRENZLTZGCHYPPCSQJJHCLLJTOLNJPZLJLHYMHEYDYDSQYCDDHGZPNDZCLZYWLLZNTEYTGXLHSLPJJBDGWXPCDNTJCKLKCLWKLLCASSTKNZDNQNTTLYYZSSYSSZZRYLJQKCGBHHCRXRZYDGRGCWCGZHFFBPPJFZYNAKRGYWYQPQXXFKJTSZZXSWZDDFBBQTBGTFFZNPZFPZXZPJSZBMQHQCYXYLDKLJNYPKYGGGDCJXXEAHPNZGZTZCMXCXMMJXNKSZQNMNLWBWWXJJRHCLSTMCSJDZCXXTPCNPDTNNPGLLLZCJLSPBLPGJCDTNJNLYYRSZFFJFQWDPGZDWMRZCCLODAXNSSNYZRESTYJWJYJDBCFXNMWTTBQLWSTSZGYBLJPXGLBOCLGPCBJFTMXZLJYLZXCLTPNCLCKXTFZJSWCRXSFYSZDKNTLBYJCYJLLSTGQCBXNWZXBXKLYLHZLQZLNZCQWGZLGZJNCJGCMNZZGJDZXTZJXYCYYCXXJYYXJJXSSSJSTSSTTPPGHTCSXWZDCSYFPTFBCHFBBLZJCLZZDBXGCXLQPXKFZFLSYLTYWBMNJHSKBMDDBCYSCCLDXYCDDQLYJJHMQLLCSGLJJSYFPYYCAYLDJANTQJPWYCMMGQYYSXDHQMZHSZXPFTWWZQSWQRFKJLXJQQYFBRXJHLFWJGZYQACMYFRHCCYBYQWLPEXCCZSDYRLTTDMQLYKMBBGMYYJPRKZNPBSXYXBHYZDJDNGHPMFSGBWFZMFQMMBZMZZCJJLCNYXYQGMLRYGQCCYHZLWJGCJCHGMCJJFYZZJHYCFRRCMTZQZXHFQGDJXCCJEAQCRJYHPLJLSZDJRBCQHQDZRHYLYQJSYMHZYDWLDFRYHBBYDTSSCCWBXGLPZMLZZTQSSCPJMMXJCSJYTYCWHYCJWYNSXLPEMWJNMKLLSWTXHYYY_CMMCWJDQDJZGLLJWJNKHPZGGFLCCSCZMCBLTBHBQJXQDJPDJQTGHGLFQAWBZYZJLTSTDHQHCTCBCHFLQMPWDSHYYTQWCNZTJTLBYPBPDYYYXSQKXWYYFLXXNCWCSYBMAELYKKJMZZZBRXYAQJFLJPFHHHXTZZXSGQQMHSPGDZQWBWPJHZJDYJCQWZKTHXSQLZYYMYSDZGRXCKKHJLWPYSYSCSYZLRMLQSYLJXBCXTLHDQZPCYCYKPPPNSXFYZJJRCEMHSZMSXLXGLRWGCSTLRSXBYGBZGZTCPLDJLSLYLYMDTMTZPALCXPXJCJWTCYYZLBLXBZLQMYLJPGHDSLSSDMHMBDCZSXWHAMLCZCPJMCNHJYJNSYGCHSKQMZZQDLLKABLWJQSFMOCDXJRRLYQZHJMYBYQLRHETFJZFRFKSRYXFJDWDSXXSWSQJYSLYXWJHSNLXYYXHBHAWHHJCXWMYLJCSQLKYDTTXBZSXFDXGXSJKHSXXYBSSXDPYNZWRPTJZCZENYGCXQFJYKJBDMLJCMQQXLOXSLYXXLYLLJDZBTYMHBFSTTQQWLHOGYBLSCALZXQLHTWRRQHLSTMYPYXJJXMQSJPNBRYXYJLLYQYLTHYLQYFMLGLJDMLLHFZWKZHLJMLHLJKLJ_TLQXYLMBHHLNLSXQCHXCFXXLHYHJJGBYZZKBXSCQDJQDSXJZSYGZHHMGSXCSYMXFEBCQWWRBPYYJQTYQCYJHQQZYHMWFFHGZFRJFCDBXNDQYZPCYKHJLFRZGPBXZDBBGZQSTLGDTYLCQMGCHHMFYWLZYXKJLYPJHSYWMQQGQZMLZJNSQXJQSYJTCBEHSXFSSFXZWFLLBCYYJDYTDTHWZZFJMQQYJLMQSXLLDTTKHHYBFPWDYYSQQRNQWLGWDEBDWCYYGCDLKJXTMXMYJSXHYBRWFYMWFRXYYMXYSCTZZDFYKMLDHQDLWYQNLCRYJBLPSXCXYWLSBRRJWXHQYBHTYDNHHGMMYWYTZCSQMDSSCCDALWZTCPQPYJLLQZYJSWXWZZMMGLMXCLMXCZMXMZSQTZPPJQBLPGXJZHBLJJHYCJSNXWCXSCCDLXSYJDCQCXSLQYCLZXLZZXMXQRJMHRHZJPHMFLJLMLCLQNLDXZLLLFYPNGJYSXCQQDCMQJZZXHNPNXZMEKMXXYKYQLXSXTXJXYHWDCWDZHQYYBGYBCYSCFGFSJNZDRZZJZXRZRQJJYMCANHRJTLDBPYZBSTJHXXZYPFDWFGZZRPYMTNGXZQBYXMBBFCCKRPJJBJEGRZGYCLKHZDXKKNSJKCLJSPJYYZLQQJYBZSSQLLLKJBCBKTYLCCDDBLSPPFYLGYDTZJYQGGKQTTFCXBDKDXXHYBBFYTYHBCLPDYTGDHRYRNJSBTCSNYJQHKLLLZSLYDXXWBCJQSBXBFJZJCJDZFBXXBRMLAZGCSNCLBJDSTBLFRZ_SWSBXBCLLXXLZDJZSJPYLYXYYFQF_FBHJJJGBYGJPMMMPSSCZJMTLYZJXSWXTYLEDQPJMYGQZJGDJLQJWJQLLSDGJGYGMSCLJJXDTYGJQJQJCJZCJGDZDSHQGSJGGCJHQXSNJJZZBXHSGZXCXYLJXYXYYDFQQJHJFXDHCTXJDRXYSQTJXYEFYYSSYXJXNCYZXFXCSYSZXYYSCHSHXZZZGZZZGFJDLDYLNPZGYJYZTYQZPBXQBDZTZCZYXXYHHSCXSHCGGQHJHGXWSCTMZMLHYXGEBDYLZKKWYTJZRCLEKESTDBCYKQQSAYXCJXWWGSBHJSZYDHCSJKQCXSWXFCTYNYDPZCCZJQTZWJQDZZZQZLJCHLSBHBYDXPSXSHHEZDXFPTJQYZZXHYAXNCFZYYHXGNXMYWXTZSJBKHHGYMXMXQCXTSBCQSJYXHTYYLYBCQLMMSZMJZJLLCOGXZAAJZYHJMCHHCXZSXZDZNLEYJJZJBHZWZZSQTJPSXZTDSXJJJZNYAZPHHYYSRRQDTHZHAYJYJHDZJZLSWCLYBZYECWCYCRYLCXNHZYDZYDYJDFRJJHTRSQTXYXJRJHOJYNXELXSFSFJZGHPZSXZSZDZCQZBYYKLSGSJHCZSHDGQGXYZGXCHXZJWYQWGYHKSSEQZZNDZFKWYSSTCLZSTSYMCDHJXXYWEYXCZAYDMPXMDSXYBSQMJMZJMTZQLPJYQZCGQHXJHHHXXHLHDLDJQCLDWBSXFZZYYSCHTYTYJBHECXHJKGJFXBHYZJFXHWHBDZFYZBCAPNPGNYDMSXHKMMMAMLNBYJTMPXYJMCTHJBZYFCGDYHWPHFTGZZEZSBZEGPBMDSKFTYCMHBLLHGPZJXZJGZJYJZSBBQSCZZLZCCSTPGXMJSFDCCZJZDJXCYBZLFCJSAZFGSZLYBCWZZBYZDZYPSWYJGXZBDSYSXLGZBZFYGCZXBZHZFTPBGZGEJBSTGKDMFHYZZJHZLLZZGJQZLSFDJSSCBZGPDLFZFZSZYZYZSYGCXSNTXCHCZXTZZLJFZGQSQYXZJQCCCCDJCDXZJYQJQCGXZTDLGSCXZSYJJQTCCLQDQZTQCHQQJZYEZZZPBKKDGFCJFZTYPQYQTTYJLMBDKTJCPQZJDZFPJSBNJLGYJDXJDZQKZGQKXDLBZJTCJDQBXDJJJSTCJNXBXCMSLYJCQMTJJWWCJJNJNLLLHJCWQTBZQYCZCZPZZDZYDDCYZDZCCJGTJFCDPRNTCTJDCQTQNDTJNPLZBCLLCTDSXKJZQDPZLBZNBTJDCXFCZDBCCJJLTQQPLDCGZTBBZJCQDCJWYNLLZLZCCDWLLXWZLXRXNTQJCZXKJLSGDFQTDDGLRLAJJTKLYMKQLLDZYTDYYJYGJWYXDXFRSKSTCDENQMRKQZHHQKDLDAZFKYPBGGPZREBZZYKYQSPEGJJGLKQZZZSLYSYWYZWFQZNLZHLZHWCGKYPQGNPGBLPLRRJYXCCCGYHSFZFWFZYWTGZXYLJCZWHXZJZBLFFLGSKHYJDEYJHLPLLLLCYGXDRZELRHGKLZZYHZLYQSZZJZQLJZFLNBHGWLCZCFJWSPYXNLZLXGCCPZBLLCXBBBBXBBCBBCRNNZCCYRBDSYLDCGQYYQXYGMQZWTZYDYJHYFWDEHZDJYWLCCCTZYJJCDEDPZDZTSY_JHDYMBJNYJZLXTSSTPHNDJXXBYXQTZQDDTJTDYZTGWSCSZQFLSHLGLBCZBHDLYZJYCKWTYDYLBNYDSDSYCCTYSZYYEBGEXHQDDWNYGYCLXTDCYSTQMYGZASCCSZZDDLCCLZRQXYYELJSBYMXSHZTEMBBLLYYLLYTDQYSHYMRQXKFKBFXNXSBYCHXBWJYHTQBPBSBWDZYLKGZSKYGHXZJHHXJXGNLJKZLYYCDCLFWFGHLJGJYBXBLYBXQPQGZTZPLNCYBXDJYQYDYMRBESJYYHKXXSTMXRCZZYWXYHYBMCFLYZHQYZMQXDBXBZWZMSLPDMYCKFMZKLZCYQYCZLHXFZLYDQZPZYGYJYZMDXDZFYFYTTQTCHGSFCZMLCCYTZXJCYTJMKSLPZHYSNWLLYTPZCTZZCKTXDHXXTQCYPKSMQCCYYAZHTJPCYLZLYJBJXTPNYLJYYNRXCYLMMNXJSMYBCSYSSLZYLLJJGYLDZDPQHFZZBLFNDSQKCZFYHHGQMRDSXYCSTXNQQRPYJBFCXDYQFBNXEJDGYQBSRCNFYYQPGHYJDYZXGRHTKYLEQDZNTSMGKLBSGBPYSZBYDJZSSTJZSTXZBHBSCSBZCZPTQFZMQFLYPYBBJGSZMXXDJMTSYSKKBJTXHJCEGBSMHYJZCXTMLJYXRZZQSCXXQPTZHMKDXXXJCLJPRMYYGADYSKQLSADHRSKQXZXZTCXHZTLMLWXYBWSYCTBHJHJFCWZSJWWTKZLXQSHLYCZJXEMPLPRCGLTBZZTLZJCYJGDTSLKLPLLQPJMZPAPXYZLAKTKDNCZZBNCCTDQQZJYJGMCTXLDGCSZLMLHBGLKFBNWZHDXPHLFMKYCLGXDTWZFRJEJCTZHYDXYKSHWFZCQSHKNMQQHTCHYMJDJSKHXZJZBZZXYMPAJQMCDBXLSKLYYNWRTSQGSCBPDBSGZWYHTLKSSSWGZZLYYTNXJGMJSZSXFWNLSOZTXGXLSAMMLBWLDQCYLAKQCQSTMYCFJBSLXCLZJCLXXKSBZQZLHJPHQPLSXSCGSLNHPSFQQXTXJJZLQLDXZJJZDYYDJNZPTFCDSKJFSLJHYLZQJZLBTHYDGDJFDBYAZXDZHZJNHHQBYGNXJJQCZMLLJZKSPLDSCLBBLXKLELXJLBJYCXJXGCNLCQPLZLZNJTZLJGYZDZPLTQCSSFDMNYCXGBTJDCZNBGBQYQJWGKFHTNBYQZQGBKPBBYZMTJDYTBLSQMBSXTBNPDXKLEMYYCJYNZDTLDYKZZXTDXHQSHYGMZSJYCCTAYRZLPWLTLKXSLZCGGEXCLFXLKJRTLQJAQZNCMBQDKKCXGLCZJZXJHPTDJJMZQYKQSECQZDSHHADMLZFMMZBGNTJNNLHBYJBRBTMLBYJDZXLTJLPLDLPCQDHLHZLYCBLCXCCJADJLMCMMSSHMYBHBSKKBHRSXXJMXSDZNZPXLBBRHGGHFCHGMSKLLTSJYYCQLCSKYWYEHYWHBHQYWBAWYKQLDQ_TNTKHQCGDQKTGPKXHCPDHTWTMSSYHBWCRWXHJMKMZNGWTMLKFGHKJYLDYYCXWHYECLQHKQHTTQKHFFLDXQWYTYYDESBPKYRZPJFYYZJCEQDZZYLATTBBFJLLCXDLMJSDXEGYGSJQXCWBXSSZPDYZCXDNYXPFZQDLYJCCPLTXLSXYZYRXCYYYDYLWWNDSAHJSYGYHGYWWAXTJZDAXYSRLTDPSSYXFNEJDXYZHLXLLLZHZSJNYQYQJXYJGHZGJCYJCHZLYCDSHHSGCZYJGCLLNYZCJYYXNFSMWFPYLCYLLABWDDHWDXJMCXZTZPMLQZHSFHZYNSTLLDYWLSLXHYMMYLMBWWKYXYADTXYLLDJPYBPWFXJMMMLLHAFDLLAFLBHHHBQQLTZJCQJJDJTFFKMMMPYMHYGDCQRDDWRQJXNBYSNMZDBXYTBJHPYBYGTJXAAHGQDQTMBSTQJKBTSPKJLXRBEQQHQMJJBDJWTGTBXPGBKTLGQXJJJCDHXQDWJLWRFMQGWQHCKRYSWGBTGYGBWSDWDWRFHWYTJJXXXJYZYSLPHYYPAYXHYDQQXSHXYXESKQHYWBDDDPPLCJLHQEEWJKSYYKDYPLFJTHKJLTCYJHHJTTBLTZZCDLTHQKCJQYSTEEYWKYZYXXYYSDDJKLLPWMCYHQGXYHCRMBXPLLNQYDQHXSXXWGDQBSHYLLPJJJTHYJKYPHTHYYKTYEZYENMDSHLCRPQFBGFXZBSBTLGXXJBSWYYSKSFLXLPPLBBBLBSFXFYZBSJSSYLPBBFFFFSSCJDSTZSXTRYYCYFFSYZYZBJTBCTSBSDHRTJHBYTCXYJEYLXCBNEBJDSYSYHGSJCBXBYDFZWGENYHHTHJHAXFWGCSTBGXKLSTYWMTMBYXJSKZSXDYJRCYTWXZFHMYMCXLZNSDJTTTXRYCFYJSBSDYERXHGJXBBDEYNJGHXGCKGSCYMBLXJMSZNSKGXFBNBBTHFJAAFXYXFPXMYFHDTTCXZZPXRSYWZDLYBBKTYQWQJPZYPZJZNJPZJLZTFYSBTTSLMPTZRTDXQSJEHBZYLZDHLJSQMLHTXTJECXSLZZSPKTLZKQQYFSYGYWPCPQFHQHYTQXZKRSGTGSQCZLPTXCDYYZSSQZSLXLZMACPCQBZYXHBSXLZDLTCDJTYLZJYYTPZYLLTXJSJXHLBMYTXCQRBLZSSFJZZTNJYDXMYJHLHPBLCYXQJQQKZZSCPZKSWALQSPLCCZJSXGWWWYGYATJBBCTDKHXHKGTGPBKQYSLBXBBCKBMLLXDZSTBKLGGQKQLSBKKDFXRMDKBFTPZFRTBBMFEEQGXKJPZSSTLBZTPSZQZSJTHLJQLZBPMSMMSXLQQNHKNBLRDDNHXDKDDJCYYGYFXGZLGSYGMJQGKHBPMXYXLYTQWLWGCPBMJXCYZYDRJBHTDJYEJSHTMJSBYPLWHLZFFNYPMHXQHPLTBQPFBJWJDBYGPNXTBFZJGSDCTJSHXEAWZZYLLTYYBWJKGXGHLFKXTJTMSZSQYNZGGSWQSPHTLSSKMCLZXYSZQQXNCJDQGZDLFNYKLJCJLLZLMZZNHYDSSHTHXZLZJBBHQZWWYCRDHLYQQJBEYFSJXTHSRXWJHWPSLMSSGZTTYEYQQWRSLALHMJTQJSMXQBJJZJXZYZKXBYQXBJXSHZSSFGLXYXZXFGHKZSZGGYLCLSARJXHSLLLMZXELGLXYDJYTLFBHBPNLYZFBBHPTGJKWETZHKJJXZXXGLLJLSTGSHJJYQLQZFKCGNNDJSSZFDBCTWWSEQFHQJBSAQTGYPJLBXBMMYWXJSLZHGLZGNYFLJBYFDJFRGSFMBYZHQFBWJSYFYJJPHZBYYZFFWODJRLMFTMLBZGYCQXCDJYGZYYYYDYTYDWEGAZYHXJLZYYHLRMGRJXZCLHNELJJTHTBWJYBJJBXJJTJTEEKHWSLZPLPSFAZPQQBDLQJJTYYQLYZKDKSQJYYJZLDQCGJQYZJSYCMRAQTHTEJMFCTYHYPKMHYCWJDCFHYYXWSHCTXRLJGJSHCCYYYJLTKTTYTMXGTCJTZAYYOCZLYLBSZYWJYTSJYHBYSHFJLYGJXXTMZYYLTXXYPZLXYJZYZYYPNHMYMDYYLBLHLSYYGQLLNJJYMSOYCBZGDLYXYLCQYXTSZEGXHZGLHWBLJHEYXTWQMAKBPQCGYSHHEHQCMWYYWLJYJHYYZLLJJYLHZYHMGSLJLJXCJJYCLYCJBCPZJZJMMYLCJLNQLJJJLXXJMLSZLJQLYCMMHCFMMFPQQMFXLQMCFFQMMMMHMZ_FHHJGTTHHKHSLNCHHYQDXTMMQDCYDYXYQMYQYLDDCYYYDAZDCYMDYDLZFFFMMYCQCWZZMABTBYCTDMNDZGGDFTYPCGCYTTSSFFWBDTZQSSYSTWJJHJYTSXXYLBYQHWWHXEZXWZNNQZJZJJQJCCCHYYXBZXZCYJTLLCQXYNJYCYYCYNZZQYYYEWYCZDCJYCCHYJLBTZYYCQWLPGPYLLGKDLDLGKGQBGYCHJX________________________________________GDM________________________________________________";
        function hrmsPinyinInitial(ch) {
            var code = ch.charCodeAt(0);
            if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
            if (code >= 0x4E00 && code <= 0x9FFF) {
                var letter = _PINYIN_INITIALS_[code - 0x4E00];
                if (letter && letter !== "_") return letter;
            }
            return "";
        }

        function hrmsChinesePinyinInitials(name) {
            var chars = Array.from(String(name || "").trim());
            var initials = [];
            for (var i = 0; i < chars.length; i++) {
                var letter = hrmsPinyinInitial(chars[i]);
                if (letter) initials.push(letter);
            }
            return initials;
        }

        function hrmsGenerateUsername(name) {
            const n = String(name || '').trim();
            if (!n) return '';
            const initials = hrmsChinesePinyinInitials(n);
            const letters = initials.length > 0 ? initials.join('').toUpperCase() : 'X';
            const employees = HRMS_STORE.getEmployees();
            const usedUsernames = new Set((employees || []).map(e => String(e?.username || '').trim().toLowerCase()).filter(Boolean));
            const prefix = 'NNYX' + letters;
            // Try random 2-digit suffix first
            for (let i = 0; i < 50; i++) {
                const suffix = String(Math.floor(Math.random() * 100)).padStart(2, '0');
                const candidate = prefix + suffix;
                if (!usedUsernames.has(candidate.toLowerCase())) return candidate;
            }
            // Exhaustive 2-digit scan
            for (let i = 0; i < 100; i++) {
                const candidate = prefix + String(i).padStart(2, '0');
                if (!usedUsernames.has(candidate.toLowerCase())) return candidate;
            }
            // Fall back to 3-digit suffix
            for (let i = 0; i < 50; i++) {
                const suffix = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
                const candidate = prefix + suffix;
                if (!usedUsernames.has(candidate.toLowerCase())) return candidate;
            }
            // Last resort: timestamp-based
            return prefix + Date.now().toString().slice(-4);
        }

        function hrmsPickDefaultManagerUsername(store, role, accounts) {
            const s = String(store || '').trim();
            const r = String(role || '').trim();
            const list = Array.isArray(accounts) ? accounts : [];
            const isStoreManager = r === ROLES.STORE_MANAGER;
            const isHq = r === ROLES.HQ_MANAGER || r === ROLES.ADMIN;
            const isStoreStaff = !!s && !isStoreManager && !isHq;

            if (isStoreStaff) {
                const mgr = list.find(a => String(a?.role || '').trim() === ROLES.STORE_MANAGER && String(a?.store || '').trim() === s);
                const u = String(mgr?.username || '').trim();
                if (u) return u;
            }

            const gm = list.find(a => String(a?.role || '').trim() === ROLES.HQ_MANAGER) || list.find(a => String(a?.role || '').trim() === ROLES.ADMIN);
            const gmU = String(gm?.username || '').trim();
            return gmU || '';
        }

        /** 管理员打开表单后异步补全密码（state 可能无明文，与 JWT 角色归一化一致） */
        function hrmsScheduleAdminPasswordFetch(username, pwdInputId, pwdTipId, hadLocalPassword) {
            if (!isAdminUser() || !username || !HRMS_API.getAdminEmployeePassword) return;
            (async () => {
                try {
                    const resp = await HRMS_API.getAdminEmployeePassword(username);
                    const pw = String(resp?.password || '').trim();
                    const pe = document.getElementById(pwdInputId);
                    const te = pwdTipId ? document.getElementById(pwdTipId) : null;
                    if (pe && pw) {
                        pe.value = pw;
                        pe.type = 'text';
                        if (te) te.textContent = '当前登录密码';
                    } else if (te && !hadLocalPassword && !pw) {
                        te.textContent = '档案中暂无登录密码，可使用重置密码';
                    }
                } catch (_e) {}
            })();
        }

        function openEmployeeFormModal(mode, empId) {
            const realMode = mode === 'view' ? 'view' : (mode === 'edit' ? 'edit' : 'create');
            const canView = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HR_MANAGER);
            const canCreate = isAdminUser() || (currentUser && currentUser.role === ROLES.STORE_MANAGER);
            if (realMode === 'edit' && !isAdminUser()) {
                showNotification('仅管理员可编辑员工', 'warning');
                return;
            }
            if (realMode === 'create' && !canCreate) {
                showNotification('仅管理员或店长可新增员工', 'warning');
                return;
            }
            if (realMode === 'view' && !canView) {
                showNotification('您没有查看权限', 'warning');
                return;
            }
            const modal = document.getElementById('employee-form-modal');
            if (!modal) {
                showNotification('员工表单未加载（请刷新）', 'error');
                return;
            }

            const titleEl = document.getElementById('employee-form-title');
            if (titleEl) titleEl.textContent = realMode === 'edit' ? '编辑员工' : (realMode === 'view' ? '查看员工' : '新增员工');
            modal.dataset.mode = realMode;
            modal.dataset.empId = empId ? String(empId) : '';
            try { modal.dataset.managerTouched = realMode === 'create' ? '0' : '1'; } catch (e) {}

            const saveBtn = document.getElementById('employee-form-save-btn');
            if (saveBtn) saveBtn.style.display = realMode === 'view' ? 'none' : '';
            const draftBtn = document.getElementById('employee-form-draft-btn');
            if (draftBtn) draftBtn.style.display = realMode === 'create' ? '' : 'none';

            const idEl = document.getElementById('employee-form-id');
            const usernameEl = document.getElementById('employee-form-username');
            const nameEl = document.getElementById('employee-form-name');
            const pwdEl = document.getElementById('employee-form-password');
            const pwdTipEl = document.getElementById('employee-form-password-tip');
            const genderEl = document.getElementById('employee-form-gender');
            const birthdayEl = document.getElementById('employee-form-birthday');
            const ageEl = document.getElementById('employee-form-age');
            const idCardNumberEl = document.getElementById('employee-form-idCardNumber');
            const hometownEl = document.getElementById('employee-form-hometown');
            const registeredResidenceEl = document.getElementById('employee-form-registeredResidence');
            const maritalStatusEl = document.getElementById('employee-form-maritalStatus');
            const storeEl = document.getElementById('employee-form-store');
            const wechatEl = document.getElementById('employee-form-wechat');
            const roleEl = document.getElementById('employee-form-role');
            const deptEl = document.getElementById('employee-form-department');
            const posEl = document.getElementById('employee-form-position');
            const levelEl = document.getElementById('employee-form-level');
            const managerEl = document.getElementById('employee-form-manager');
            const salaryEl = document.getElementById('employee-form-salary');
            const educationEl = document.getElementById('employee-form-education');
            const joinDateEl = document.getElementById('employee-form-joinDate');
            const bankCardCompanyEl = document.getElementById('employee-form-bankCardCompany');
            const bankNameCompanyEl = document.getElementById('employee-form-bankNameCompany');
            const bankCardPersonalEl = document.getElementById('employee-form-bankCardPersonal');
            const bankNamePersonalEl = document.getElementById('employee-form-bankNamePersonal');
            const phoneEl = document.getElementById('employee-form-phone');
            const emailEl = document.getElementById('employee-form-email');
            const ecNameEl = document.getElementById('employee-form-emergencyContactName');
            const ecPhoneEl = document.getElementById('employee-form-emergencyContactPhone');
            const ecRelEl = document.getElementById('employee-form-emergencyContactRelation');
            const idFrontUrlEl = document.getElementById('employee-form-idcard-front-url');
            const idBackUrlEl = document.getElementById('employee-form-idcard-back-url');
            const idFrontPrevEl = document.getElementById('employee-form-idcard-front-preview');
            const idBackPrevEl = document.getElementById('employee-form-idcard-back-preview');
            const idFrontFileEl = document.getElementById('employee-form-idcard-front-file');
            const idBackFileEl = document.getElementById('employee-form-idcard-back-file');
            const idUploadBtnEl = document.getElementById('employee-form-idcard-upload-btn');
            const statusEl = document.getElementById('employee-form-status');
            const coreTalentEl = document.getElementById('employee-form-coreTalent');
            const coreTalentLabelEl = document.getElementById('employee-form-coreTalent-label');
            const badgeEl = document.getElementById('employee-form-mode-badge');

            if (coreTalentEl) {
                coreTalentEl.onchange = function() {
                    if (coreTalentLabelEl) coreTalentLabelEl.textContent = this.checked ? '是' : '否';
                };
            }

            const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];
            const activeStores = stores.filter(s => (s?.status || 'active') === 'active').map(s => String(s?.name || s?.id || '')).filter(Boolean);
            if (storeEl) {
                const opts = [''].concat(activeStores);
                storeEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }

            const dict = hrmsGetOrgDict();
            const employeesAll = HRMS_STORE.getEmployees();
            const usersAll = (HRMS_STORE.getUsers ? HRMS_STORE.getUsers() : []) || [];
            const fallbackDepts = ['销售部', '后厨出品', '管理部', '人事', '财务', '运营', '培训'];
            const fallbackPositions = ['销售员', '门店员工', '门店店长', '出品经理', '区域经理', '总部经理', '系统管理员'];
            const fallbackLevels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'P1', 'P2', 'P3', 'M1', 'M2', 'H1'];
            const depts = Array.from(new Set((dict.departments.length ? dict.departments : fallbackDepts).concat((employeesAll || []).map(e => String(e?.department || '').trim())).filter(Boolean)));
            const poss = Array.from(new Set((dict.positions.length ? dict.positions : fallbackPositions).concat((employeesAll || []).map(e => String(e?.position || '').trim())).filter(Boolean)));
            const levels = Array.from(new Set((dict.levels.length ? dict.levels : fallbackLevels).concat((employeesAll || []).map(e => String(e?.level || '').trim())).filter(Boolean)));
            if (deptEl) {
                const opts = [''].concat(depts);
                deptEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }
            if (posEl) {
                const opts = [''].concat(poss);
                posEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }
            if (levelEl) {
                const opts = [''].concat(levels);
                levelEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }
            if (managerEl) {
                const seen = new Set();
                const items = [];
                const addU = (x) => {
                    const u = String(x?.username || '').trim();
                    if (!u) return;
                    if (seen.has(u)) return;
                    seen.add(u);
                    items.push({ username: u, name: String(x?.name || '').trim() });
                };
                (usersAll || []).forEach(addU);
                (employeesAll || []).forEach(addU);
                items.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'zh-CN'));
                managerEl.innerHTML = '<option value="">（无）</option>' + items.map(it => {
                    const label = it.name || it.username;
                    return `<option value="${it.username.replace(/"/g, '&quot;')}">${label}</option>`;
                }).join('');
            }

            const allAccounts = (() => {
                const seen = new Set();
                const list = [];
                const add = (x) => {
                    const u = String(x?.username || '').trim();
                    if (!u) return;
                    if (seen.has(u)) return;
                    seen.add(u);
                    list.push(x);
                };
                (usersAll || []).forEach(add);
                (employeesAll || []).forEach(add);
                return list;
            })();

            const applyAutoManager = () => {
                try {
                    if (!managerEl) return;
                    const touched = String(modal.dataset.managerTouched || '0') === '1';
                    const cur = String(managerEl.value || '').trim();
                    if (touched && cur) return;
                    const storeVal = String(storeEl?.value || '').trim();
                    const roleVal = String(roleEl?.value || '').trim();
                    const picked = hrmsPickDefaultManagerUsername(storeVal, roleVal, allAccounts);
                    if (picked) managerEl.value = picked;
                } catch (e) {}
            };

            const syncFormAge = () => {
                if (!ageEl) return;
                const age = empCalcAgeFromBirthday(String(birthdayEl?.value || '').trim());
                ageEl.value = age === null ? '' : `${age}岁`;
            };

            try {
                if (managerEl) {
                    managerEl.onchange = () => {
                        const v = String(managerEl.value || '').trim();
                        modal.dataset.managerTouched = v ? '1' : '0';
                    };
                }
                if (storeEl) {
                    storeEl.onchange = () => applyAutoManager();
                }
                if (roleEl) {
                    roleEl.onchange = () => applyAutoManager();
                }
                if (birthdayEl) {
                    birthdayEl.onchange = () => syncFormAge();
                    birthdayEl.oninput = () => syncFormAge();
                }
            } catch (e) {}

            // 固定角色下拉选项（内置角色，不可自定义）
            if (roleEl) {
                const fixedRoles = [
                    { value: 'store_employee', label: '门店员工' },
                    { value: 'front_manager', label: '前厅经理' },
                    { value: 'front_supervisor', label: '前厅主管' },
                    { value: 'store_production_manager', label: '出品经理' },
                    { value: 'store_manager', label: '店长' },
                    { value: 'cashier', label: '总部出纳' },
                    { value: 'hr_manager', label: '总部人事' },
                    { value: 'hq_manager', label: '总部营运' },
                    { value: 'admin', label: '系统管理员' }
                ];
                roleEl.innerHTML = fixedRoles.map(r => `<option value="${r.value}">${r.label}</option>`).join('');
            }

            if (realMode === 'edit' || realMode === 'view') {
                const employees = HRMS_STORE.getEmployees();
                const key = String(empId || '').trim();
                const emp = (employees || []).find(e => String(e?.username || '') === key) || (employees || []).find(e => String(e?.id || '') === key);
                if (!emp) {
                    showNotification('未找到员工', 'error');
                    return;
                }

                if (currentUser && currentUser.role === ROLES.STORE_MANAGER) {
                    const myStore = String(currentUser.store || '').trim();
                    const empStore = String(emp.store || '').trim();
                    if (myStore && empStore !== myStore) {
                        showNotification('您只能查看本门店员工', 'warning');
                        return;
                    }
                }
                if (idEl) idEl.value = String(emp.id || '');
                if (usernameEl) usernameEl.value = String(emp.username || '');
                if (nameEl) nameEl.value = String(emp.name || '');
                if (pwdEl) {
                    const curPwd = String(emp.password || '');
                    pwdEl.value = curPwd;
                    pwdEl.type = isAdminUser() ? 'text' : 'password';
                    pwdEl.placeholder = curPwd ? '已设置，留空=不修改' : '初始密码';
                }
                if (pwdTipEl) pwdTipEl.textContent = String(emp.password || '') ? '当前密码已设置，留空则不修改' : '请设置初始密码';
                if (isAdminUser() && (realMode === 'edit' || realMode === 'view')) {
                    const unForPwd = String(emp.username || '').trim();
                    hrmsScheduleAdminPasswordFetch(unForPwd, 'employee-form-password', 'employee-form-password-tip', !!String(emp.password || '').trim());
                }
                if (genderEl) genderEl.value = String(emp.gender || '');
                if (birthdayEl) {
                    const raw = String(emp.birthday || '');
                    birthdayEl.value = raw && raw.length >= 10 ? raw.slice(0, 10) : raw;
                }
                syncFormAge();
                if (idCardNumberEl) idCardNumberEl.value = String(emp.idCardNumber || emp.idCardNo || emp.idNumber || '');
                if (hometownEl) hometownEl.value = String(emp.hometown || '');
                if (registeredResidenceEl) registeredResidenceEl.value = String(emp.registeredResidence || '');
                if (maritalStatusEl) maritalStatusEl.value = String(emp.maritalStatus || '');
                if (storeEl) storeEl.value = String(emp.store || '');
                if (wechatEl) wechatEl.value = String(emp.wechat || '');
                if (roleEl) roleEl.value = String(emp.role || '');
                if (deptEl) deptEl.value = String(emp.department || '');
                if (posEl) posEl.value = String(emp.position || '');
                if (levelEl) levelEl.value = String(emp.level || '');
                if (managerEl) managerEl.value = String(emp.managerUsername || '');
                if (salaryEl) salaryEl.value = emp.salary === null || emp.salary === undefined ? '' : String(emp.salary);
                if (educationEl) educationEl.value = String(emp.education || '');
                if (joinDateEl) joinDateEl.value = String(emp.joinDate || '');
                if (bankCardCompanyEl) bankCardCompanyEl.value = String(emp.bankCardCompany || '');
                if (bankNameCompanyEl) bankNameCompanyEl.value = String(emp.bankNameCompany || '');
                if (bankCardPersonalEl) bankCardPersonalEl.value = String(emp.bankCardPersonal || emp.bankCard || '');
                if (bankNamePersonalEl) bankNamePersonalEl.value = String(emp.bankNamePersonal || '');
                if (phoneEl) phoneEl.value = String(emp.phone || '');
                if (emailEl) emailEl.value = String(emp.email || '');
                if (ecNameEl) ecNameEl.value = String(emp.emergencyContactName || '');
                if (ecPhoneEl) ecPhoneEl.value = String(emp.emergencyContactPhone || '');
                if (ecRelEl) ecRelEl.value = String(emp.emergencyContactRelation || '');
                if (idFrontUrlEl) idFrontUrlEl.value = String(emp.idCardFrontUrl || '');
                if (idBackUrlEl) idBackUrlEl.value = String(emp.idCardBackUrl || '');
                if (idFrontPrevEl) {
                    const u = String(emp.idCardFrontUrl || '').trim();
                    if (u) {
                        idFrontPrevEl.src = u;
                        idFrontPrevEl.style.display = '';
                        try { document.getElementById('employee-form-idcard-front-delete').style.display = ''; } catch (e) {}
                    } else {
                        try { idFrontPrevEl.src = ''; } catch (e) {}
                        idFrontPrevEl.style.display = 'none';
                        try { document.getElementById('employee-form-idcard-front-delete').style.display = 'none'; } catch (e) {}
                    }
                }
                if (idBackPrevEl) {
                    const u = String(emp.idCardBackUrl || '').trim();
                    if (u) {
                        idBackPrevEl.src = u;
                        idBackPrevEl.style.display = '';
                        try { document.getElementById('employee-form-idcard-back-delete').style.display = ''; } catch (e) {}
                    } else {
                        try { idBackPrevEl.src = ''; } catch (e) {}
                        idBackPrevEl.style.display = 'none';
                        try { document.getElementById('employee-form-idcard-back-delete').style.display = 'none'; } catch (e) {}
                    }
                }
                if (statusEl) statusEl.value = String(emp.status || 'active');
                if (coreTalentEl) {
                    coreTalentEl.checked = !!emp.coreTalent;
                    if (coreTalentLabelEl) coreTalentLabelEl.textContent = emp.coreTalent ? '是' : '否';
                }
                if (idEl) idEl.disabled = true;
                if (usernameEl) usernameEl.disabled = !isAdminUser();
            } else {
                if (idEl) {
                    idEl.value = hrmsGenerateEmployeeId();
                    idEl.disabled = true;
                }
                if (usernameEl) {
                    usernameEl.value = '';
                    usernameEl.disabled = false;
                    usernameEl.dataset.autoGen = '1';
                }
                if (nameEl) {
                    nameEl.value = '';
                    if (!nameEl.dataset.autoUsernameHooked) {
                        nameEl.dataset.autoUsernameHooked = '1';
                        nameEl.addEventListener('input', function() {
                            const uEl = document.getElementById('employee-form-username');
                            if (uEl && uEl.dataset.autoGen === '1') {
                                const v = String(this.value || '').trim();
                                uEl.value = v ? hrmsGenerateUsername(v) : '';
                            }
                        });
                        nameEl.addEventListener('blur', function() {
                            const uEl = document.getElementById('employee-form-username');
                            if (uEl && uEl.dataset.autoGen === '1') {
                                const v = String(this.value || '').trim();
                                if (v && !String(uEl.value || '').trim()) {
                                    uEl.value = hrmsGenerateUsername(v);
                                }
                            }
                        });
                    }
                }
                if (pwdEl) pwdEl.value = '';
                if (pwdTipEl) pwdTipEl.textContent = '（留空=默认 123456）';
                if (genderEl) genderEl.value = '';
                if (birthdayEl) birthdayEl.value = '';
                syncFormAge();
                if (idCardNumberEl) idCardNumberEl.value = '';
                if (hometownEl) hometownEl.value = '';
                if (registeredResidenceEl) registeredResidenceEl.value = '';
                if (maritalStatusEl) maritalStatusEl.value = '';
                if (storeEl) {
                    storeEl.value = '';
                    try {
                        if (currentUser && currentUser.role === ROLES.STORE_MANAGER) {
                            const s = String(currentUser.store || '').trim();
                            if (s) storeEl.value = s;
                        }
                    } catch (e) {}
                }
                if (wechatEl) wechatEl.value = '';
                if (roleEl) roleEl.value = '';
                if (deptEl) deptEl.value = '';
                if (posEl) posEl.value = '';
                if (levelEl) levelEl.value = '';
                if (managerEl) {
                    managerEl.value = '';
                }
                if (salaryEl) salaryEl.value = '';
                if (educationEl) educationEl.value = '';
                if (joinDateEl) joinDateEl.value = '';
                if (bankCardCompanyEl) bankCardCompanyEl.value = '';
                if (bankNameCompanyEl) bankNameCompanyEl.value = '';
                if (bankCardPersonalEl) bankCardPersonalEl.value = '';
                if (bankNamePersonalEl) bankNamePersonalEl.value = '';
                if (phoneEl) phoneEl.value = '';
                if (emailEl) emailEl.value = '';
                if (ecNameEl) ecNameEl.value = '';
                if (ecPhoneEl) ecPhoneEl.value = '';
                if (ecRelEl) ecRelEl.value = '';
                if (idFrontUrlEl) idFrontUrlEl.value = '';
                if (idBackUrlEl) idBackUrlEl.value = '';
                if (idFrontPrevEl) {
                    try { idFrontPrevEl.src = ''; } catch (e) {}
                    idFrontPrevEl.style.display = 'none';
                }
                if (idBackPrevEl) {
                    try { idBackPrevEl.src = ''; } catch (e) {}
                    idBackPrevEl.style.display = 'none';
                }
                if (statusEl) statusEl.value = 'active';
                if (coreTalentEl) {
                    coreTalentEl.checked = false;
                    if (coreTalentLabelEl) coreTalentLabelEl.textContent = '否';
                }
            }

            if (realMode === 'create') {
                applyAutoManager();
            }

            const lock = realMode === 'view';
            if (usernameEl) {
                if (realMode === 'view') usernameEl.disabled = true;
                else if (realMode === 'edit') usernameEl.disabled = !isAdminUser();
                else usernameEl.disabled = false;
                if (realMode !== 'create') usernameEl.dataset.autoGen = '0';
                usernameEl.addEventListener('input', function() { this.dataset.autoGen = '0'; }, { once: true });
            }
            if (nameEl) nameEl.disabled = lock;
            if (pwdEl) pwdEl.disabled = lock;
            if (genderEl) genderEl.disabled = lock;
            if (birthdayEl) birthdayEl.disabled = lock;
            if (idCardNumberEl) idCardNumberEl.disabled = lock;
            if (hometownEl) hometownEl.disabled = lock;
            if (registeredResidenceEl) registeredResidenceEl.disabled = lock;
            if (maritalStatusEl) maritalStatusEl.disabled = lock;
            if (storeEl) storeEl.disabled = lock;
            if (wechatEl) wechatEl.disabled = lock;
            if (roleEl) roleEl.disabled = lock;
            if (deptEl) deptEl.disabled = lock;
            if (posEl) posEl.disabled = lock;
            if (levelEl) levelEl.disabled = lock;
            if (managerEl) managerEl.disabled = lock;
            if (salaryEl) salaryEl.disabled = lock;
            if (educationEl) educationEl.disabled = lock;
            if (joinDateEl) joinDateEl.disabled = lock;
            if (bankCardCompanyEl) bankCardCompanyEl.disabled = lock;
            if (bankNameCompanyEl) bankNameCompanyEl.disabled = lock;
            if (bankCardPersonalEl) bankCardPersonalEl.disabled = lock;
            if (bankNamePersonalEl) bankNamePersonalEl.disabled = lock;
            if (phoneEl) phoneEl.disabled = lock;
            if (emailEl) emailEl.disabled = lock;
            if (ecNameEl) ecNameEl.disabled = lock;
            if (ecPhoneEl) ecPhoneEl.disabled = lock;
            if (ecRelEl) ecRelEl.disabled = lock;
            if (idFrontFileEl) idFrontFileEl.disabled = lock;
            if (idBackFileEl) idBackFileEl.disabled = lock;
            if (idUploadBtnEl) idUploadBtnEl.style.display = lock ? 'none' : '';
            if (statusEl) statusEl.disabled = lock;
            if (coreTalentEl) coreTalentEl.disabled = lock;

            try {
                if (idCardNumberEl) {
                    idCardNumberEl.onblur = () => {
                        const v = hrmsNormalizeIdCardNumber(idCardNumberEl.value || '');
                        if (v) idCardNumberEl.value = v;
                        hrmsApplyIdCardDerivedFields(v, genderEl, birthdayEl);
                    };
                }
            } catch (e) {}

            if (badgeEl) badgeEl.style.display = isAdminUser() ? '' : 'none';

            hrmsSyncSegmentWithSelect('employee-form-status-seg', 'employee-form-status', lock);

            const attSection = document.getElementById('employee-form-attachments-section');
            if (attSection) {
                const uploadBtn = document.getElementById('employee-form-attachment-upload-btn');
                const fileInp = document.getElementById('employee-form-attachment-file');
                const descInp = document.getElementById('employee-form-attachment-desc');
                if (lock) {
                    if (uploadBtn) uploadBtn.disabled = true;
                    if (fileInp) fileInp.disabled = true;
                    if (descInp) descInp.disabled = true;
                } else {
                    if (uploadBtn) uploadBtn.disabled = false;
                    if (fileInp) fileInp.disabled = false;
                    if (descInp) descInp.disabled = false;
                }
            }
            if ((realMode === 'edit' || realMode === 'view') && empId) {
                loadEmployeeAttachments(empId);
            } else {
                renderEmployeeAttachments([]);
            }

            modal.classList.add('show');

            if (realMode === 'create') {
                try { hrmsMaybeRestoreEmployeeDraft(); } catch (e) {}
            }
        }

        function closeEmployeeFormModal() {
            const modal = document.getElementById('employee-form-modal');
            if (modal) modal.classList.remove('show');
        }

        async function uploadEmployeeIdCard() {
            try {
                if (!isLoggedIn || !currentUser) {
                    showNotification('请先登录', 'warning');
                    return;
                }
                if (!(currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HR_MANAGER)) {
                    showNotification('您没有上传权限', 'warning');
                    return;
                }

                const frontFileEl = document.getElementById('employee-form-idcard-front-file');
                const backFileEl = document.getElementById('employee-form-idcard-back-file');
                const frontUrlEl = document.getElementById('employee-form-idcard-front-url');
                const backUrlEl = document.getElementById('employee-form-idcard-back-url');
                const frontPrevEl = document.getElementById('employee-form-idcard-front-preview');
                const backPrevEl = document.getElementById('employee-form-idcard-back-preview');
                const btn = document.getElementById('employee-form-idcard-upload-btn');
                const hintEl = document.getElementById('employee-form-idcard-upload-hint');
                const idCardNumberEl = document.getElementById('employee-form-idCardNumber');
                const genderEl = document.getElementById('employee-form-gender');
                const birthdayEl = document.getElementById('employee-form-birthday');
                const nameEl = document.getElementById('employee-form-name');

                const modal = document.getElementById('employee-form-modal');
                const sessionId = `${Date.now()}_${Math.random()}`;
                try { if (modal) modal.dataset.idcardUploadSession = sessionId; } catch (e) {}

                const frontFile = frontFileEl?.files?.[0] || null;
                const backFile = backFileEl?.files?.[0] || null;
                if (!frontFile && !backFile) {
                    showNotification('请选择身份证正面或反面图片', 'warning');
                    return;
                }

                const fd = new FormData();
                if (frontFile) fd.append('front', frontFile);
                if (backFile) fd.append('back', backFile);

                try { if (btn) btn.disabled = true; } catch (e) {}
                const resp = await HRMS_API.uploadEmployeeIdCard(fd);

                try {
                    const modal2 = document.getElementById('employee-form-modal');
                    const sid = String(modal2?.dataset?.idcardUploadSession || '');
                    if (sid && sid !== sessionId) return;
                } catch (e) {}

                const base = String(HRMS_API.baseUrl ? HRMS_API.baseUrl() : '').replace(/\/$/, '');
                const toAbs = (u) => {
                    const s = String(u || '').trim();
                    if (!s) return '';
                    if (/^https?:\/\//i.test(s)) return s;
                    if (!base) return s;
                    if (s.startsWith('/')) return base + s;
                    return base + '/' + s;
                };

                const fUrl = String(resp?.frontUrl || '').trim();
                const bUrl = String(resp?.backUrl || '').trim();
                if (frontUrlEl && fUrl) frontUrlEl.value = fUrl;
                if (backUrlEl && bUrl) backUrlEl.value = bUrl;

                if (frontPrevEl) {
                    const u = toAbs(fUrl || frontUrlEl?.value);
                    if (u) {
                        frontPrevEl.src = u;
                        frontPrevEl.style.display = '';
                        try { document.getElementById('employee-form-idcard-front-delete').style.display = ''; } catch (e) {}
                    }
                }
                if (backPrevEl) {
                    const u = toAbs(bUrl || backUrlEl?.value);
                    if (u) {
                        backPrevEl.src = u;
                        backPrevEl.style.display = '';
                        try { document.getElementById('employee-form-idcard-back-delete').style.display = ''; } catch (e) {}
                    }
                }

                showNotification('证件上传成功', 'success');

                try {
                    const modal2 = document.getElementById('employee-form-modal');
                    const sid = String(modal2?.dataset?.idcardUploadSession || '');
                    if (sid && sid !== sessionId) return;
                } catch (e) {}

                const applyIdInfo = async (idNo, nameFromOcr) => {
                    try {
                        const v = hrmsNormalizeIdCardNumber(idNo || '');
                        if (!v) return;
                        if (idCardNumberEl) {
                            const oldNo = hrmsNormalizeIdCardNumber(idCardNumberEl.value || '');
                            if (!oldNo) {
                                idCardNumberEl.value = v;
                            } else if (oldNo !== v) {
                                const ok = await hrmsConfirm({ title: '覆盖身份证号', message: `识别到身份证号：${v}，当前填写：${oldNo}，是否使用识别结果覆盖？`, okText: '覆盖', icon: '🪪' });
                                if (ok) idCardNumberEl.value = v;
                            }
                        }
                        const info = hrmsParseChinaIdCardInfo(v);
                        if (info?.ok) {
                            if (genderEl && info.gender) genderEl.value = info.gender;
                            if (birthdayEl && info.birthDate) birthdayEl.value = String(info.birthDate).slice(0, 10);
                        }
                        const nm = String(nameFromOcr || '').trim();
                        if (nm && nameEl) {
                            const oldName = String(nameEl.value || '').trim();
                            if (!oldName) {
                                nameEl.value = nm;
                            } else if (oldName !== nm) {
                                const ok = await hrmsConfirm({ title: '覆盖姓名', message: `识别到姓名：${nm}，当前填写：${oldName}，是否使用识别结果覆盖？`, okText: '覆盖', icon: '👤' });
                                if (ok) nameEl.value = nm;
                            }
                        }
                    } catch (e) {}
                };

                try {
                    const existing = hrmsNormalizeIdCardNumber(idCardNumberEl?.value || '');
                    if (existing) applyIdInfo(existing, '');
                } catch (e) {}

                try {
                    try { if (modal) modal.dataset.idcardOcrStatus = 'disabled'; } catch (e) {}
                    try { if (hintEl) hintEl.textContent = '已上传，请手动填写身份证号'; } catch (e) {}
                } catch (e) {}
            } catch (e) {
                showNotification('证件上传失败：' + String(e?.message || e), 'error');
                try {
                    const modal = document.getElementById('employee-form-modal');
                    if (modal) modal.dataset.idcardOcrStatus = 'failed';
                } catch (e2) {}
            } finally {
                try {
                    const btn = document.getElementById('employee-form-idcard-upload-btn');
                    if (btn) btn.disabled = false;
                } catch (e) {}
            }
        }

        async function deleteIdCardImage(side) {
            const _okDel = await hrmsConfirm({ title: '删除证件照片', message: '确定要删除该证件照片吗？', okText: '确认删除', icon: '🗑️' });
            if (!_okDel) return;
            const urlEl = document.getElementById('employee-form-idcard-' + side + '-url');
            const prevEl = document.getElementById('employee-form-idcard-' + side + '-preview');
            const delBtn = document.getElementById('employee-form-idcard-' + side + '-delete');
            const fileEl = document.getElementById('employee-form-idcard-' + side + '-file');
            if (urlEl) urlEl.value = '';
            if (prevEl) { prevEl.src = ''; prevEl.style.display = 'none'; }
            if (delBtn) delBtn.style.display = 'none';
            if (fileEl) fileEl.value = '';
            showNotification('证件照片已删除，保存员工信息后生效', 'success');
        }

        function syncEmployeeAttachmentEmptyHint() {
            const emptyEl = document.getElementById('employee-form-attachments-empty');
            const container = document.getElementById('employee-form-attachments-list');
            const fileEl = document.getElementById('employee-form-attachment-file');
            if (!emptyEl || !container) return;
            const hasRows = container.querySelector('.emp-att-row');
            if (hasRows) {
                emptyEl.style.display = 'none';
                return;
            }
            const picking = fileEl && fileEl.files && fileEl.files.length > 0;
            emptyEl.style.display = picking ? 'none' : '';
        }

        function renderEmployeeAttachments(list) {
            const container = document.getElementById('employee-form-attachments-list');
            const emptyEl = document.getElementById('employee-form-attachments-empty');
            if (!container) return;
            container.innerHTML = '';
            const arr = Array.isArray(list) ? list : [];
            if (arr.length === 0) {
                syncEmployeeAttachmentEmptyHint();
                return;
            }
            if (emptyEl) emptyEl.style.display = 'none';
            const base = String(typeof HRMS_API?.baseUrl === 'function' ? HRMS_API.baseUrl() : '').replace(/\/$/, '');
            arr.forEach(a => {
                const url = String(a.url || '').trim();
                const absUrl = url.startsWith('http') ? url : (base + url);
                const fileName = String(a.original_name || a.filename || a.name || '未命名文件');
                const desc = String(a.description || a.desc || '');
                const id = a.id;
                const uploadedAt = String(a.created_at || a.uploaded_at || '').slice(0, 10) || '';
                const row = document.createElement('div');
                row.className = 'emp-att-row';
                row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 10px; background:rgba(242,234,238,0.05); border-radius:8px; border:1px solid rgba(242,234,238,0.08);';
                row.innerHTML = `
                    <span style="font-size:18px;">${fileName.toLowerCase().endsWith('.pdf') ? '📄' : (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? '🖼️' : (fileName.match(/\.(xls|xlsx)$/i) ? '📊' : '📎'))}</span>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:600; color:rgba(242,234,238,0.95); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(desc || fileName)}</div>
                        <div style="font-size:11px; color:rgba(151,132,142,0.5); margin-top:2px;">${escapeHtml(fileName)}${uploadedAt ? ' · ' + uploadedAt : ''}</div>
                    </div>
                    <a href="${escapeHtml(absUrl)}" target="_blank" class="btn btn-secondary" style="padding:5px 10px; font-size:12px; white-space:nowrap;">查看</a>
                    <button type="button" class="btn" style="padding:5px 10px; font-size:12px; background:rgba(229,139,152,0.2); color:#EDA1AC; border:1px solid rgba(229,139,152,0.3); white-space:nowrap;" data-click="deleteEmployeeAttachment" data-arg="${id}" data-arg-type="number">删除</button>
                `;
                container.appendChild(row);
            });
        }

        async function loadEmployeeAttachments(empId) {
            try {
                const container = document.getElementById('employee-form-attachments-list');
                const emptyEl = document.getElementById('employee-form-attachments-empty');
                if (!container) return;
                if (!empId) { if (emptyEl) emptyEl.style.display = ''; return; }
                container.innerHTML = '<div style="font-size:12px; color:rgba(151,132,142,0.5);">加载中…</div>';
                const resp = await HRMS_API.getEmployeeAttachments(empId);
                renderEmployeeAttachments(Array.isArray(resp) ? resp : (resp?.attachments || resp?.data || []));
            } catch (e) {
                const container = document.getElementById('employee-form-attachments-list');
                if (container) container.innerHTML = '<div style="font-size:12px; color:#EDA1AC;">附件加载失败</div>';
            }
        }

        async function uploadEmployeeAttachment() {
            const modal = document.getElementById('employee-form-modal');
            const empId = modal?.dataset?.empId || '';
            if (!empId) { showNotification('请先保存员工信息后再上传附件', 'warning'); return; }
            const fileEl = document.getElementById('employee-form-attachment-file');
            const descEl = document.getElementById('employee-form-attachment-desc');
            const files = fileEl && fileEl.files && fileEl.files.length ? Array.from(fileEl.files) : [];
            if (!files.length) { showNotification('请选择要上传的文件（可多选）', 'warning'); return; }
            for (const f of files) {
                if (f.size > 20 * 1024 * 1024) {
                    showNotification(`文件「${f.name}」超过 20MB 限制`, 'warning');
                    return;
                }
            }
            const desc = String(descEl?.value || '').trim();
            const btn = document.getElementById('employee-form-attachment-upload-btn');
            try {
                if (btn) btn.disabled = true;
                let ok = 0;
                for (let i = 0; i < files.length; i++) {
                    const fd = new FormData();
                    fd.append('file', files[i]);
                    if (desc) fd.append('description', desc);
                    await HRMS_API.uploadEmployeeAttachment(empId, fd);
                    ok++;
                }
                if (fileEl) fileEl.value = '';
                if (descEl) descEl.value = '';
                syncEmployeeAttachmentEmptyHint();
                showNotification(ok > 1 ? `已成功上传 ${ok} 个附件` : '附件上传成功', 'success');
                await loadEmployeeAttachments(empId);
            } catch (e) {
                showNotification('附件上传失败：' + String(e?.message || e), 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        async function deleteEmployeeAttachment(attachId) {
            const ok = await hrmsConfirm({ title: '删除附件', message: '确定要删除该附件吗？此操作不可恢复。', okText: '确认删除', icon: '🗑️' });
            if (!ok) return;
            const modal = document.getElementById('employee-form-modal');
            const empId = modal?.dataset?.empId || '';
            if (!empId) return;
            try {
                await HRMS_API.deleteEmployeeAttachment(empId, attachId);
                showNotification('附件已删除', 'success');
                await loadEmployeeAttachments(empId);
            } catch (e) {
                showNotification('删除失败：' + String(e?.message || e), 'error');
            }
        }

        async function submitEmployeeForm() {
            const modal = document.getElementById('employee-form-modal');
            if (!modal) return;

            const mode = String(modal.dataset.mode || 'create');
            if (mode === 'view') {
                closeEmployeeFormModal();
                return;
            }

            const isStoreMgrCreate = (!isAdminUser()) && (currentUser && currentUser.role === ROLES.STORE_MANAGER) && mode === 'create';
            if (!isAdminUser() && !isStoreMgrCreate) {
                showNotification('仅管理员可操作', 'warning');
                return;
            }
            const idEl = document.getElementById('employee-form-id');
            const usernameEl = document.getElementById('employee-form-username');
            const nameEl = document.getElementById('employee-form-name');
            const pwdEl = document.getElementById('employee-form-password');
            const genderEl = document.getElementById('employee-form-gender');
            const birthdayEl = document.getElementById('employee-form-birthday');
            const hometownEl = document.getElementById('employee-form-hometown');
            const registeredResidenceEl = document.getElementById('employee-form-registeredResidence');
            const maritalStatusEl = document.getElementById('employee-form-maritalStatus');
            const storeEl = document.getElementById('employee-form-store');
            const wechatEl = document.getElementById('employee-form-wechat');
            const roleEl = document.getElementById('employee-form-role');
            const deptEl = document.getElementById('employee-form-department');
            const posEl = document.getElementById('employee-form-position');
            const levelEl = document.getElementById('employee-form-level');
            const managerEl = document.getElementById('employee-form-manager');
            const salaryEl = document.getElementById('employee-form-salary');
            const educationEl = document.getElementById('employee-form-education');
            const joinDateEl = document.getElementById('employee-form-joinDate');
            const bankCardCompanyEl = document.getElementById('employee-form-bankCardCompany');
            const bankNameCompanyEl = document.getElementById('employee-form-bankNameCompany');
            const bankCardPersonalEl = document.getElementById('employee-form-bankCardPersonal');
            const bankNamePersonalEl = document.getElementById('employee-form-bankNamePersonal');
            const phoneEl = document.getElementById('employee-form-phone');
            const emailEl = document.getElementById('employee-form-email');
            const ecNameEl = document.getElementById('employee-form-emergencyContactName');
            const ecPhoneEl = document.getElementById('employee-form-emergencyContactPhone');
            const ecRelEl = document.getElementById('employee-form-emergencyContactRelation');
            const idCardNumberEl = document.getElementById('employee-form-idCardNumber');
            const idFrontUrlEl = document.getElementById('employee-form-idcard-front-url');
            const idBackUrlEl = document.getElementById('employee-form-idcard-back-url');
            const statusEl = document.getElementById('employee-form-status');
            const coreTalentEl = document.getElementById('employee-form-coreTalent');

            const id = (idEl?.value || '').trim();
            let username = (usernameEl?.value || '').trim();
            let name = (nameEl?.value || '').trim();
            if (!id) return;
            if (!name) {
                showNotification('请填写姓名', 'warning');
                hrmsMarkFieldInvalid(nameEl);
                return;
            }
            if (!username) {
                username = hrmsGenerateUsername(name);
                if (usernameEl) usernameEl.value = username;
            }
            if (!username) {
                showNotification('账号生成失败，请重试', 'warning');
                return;
            }

            const passwordInput = (pwdEl?.value || '').trim();
            let gender = (genderEl?.value || '').trim();
            let birthday = (birthdayEl?.value || '').trim();
            const idCardNumber = hrmsNormalizeIdCardNumber(idCardNumberEl?.value || '');
            const hometown = (hometownEl?.value || '').trim();
            const registeredResidence = String(registeredResidenceEl?.value || '').trim();
            const maritalStatus = String(maritalStatusEl?.value || '').trim();
            const store = (storeEl?.value || '').trim();
            const wechat = String(wechatEl?.value || '').trim();
            const role = (roleEl?.value || '').trim();
            const department = (deptEl?.value || '').trim();
            const position = (posEl?.value || '').trim();
            const level = String(levelEl?.value || '').trim();
            let managerUsername = String(managerEl?.value || '').trim();
            const joinDate = String(joinDateEl?.value || '').trim();
            const bankCardCompany = String(bankCardCompanyEl?.value || '').trim();
            const bankNameCompany = String(bankNameCompanyEl?.value || '').trim();
            const bankCardPersonal = String(bankCardPersonalEl?.value || '').trim();
            const bankNamePersonal = String(bankNamePersonalEl?.value || '').trim();
            const bankCard = bankCardPersonal;
            const phone = String(phoneEl?.value || '').trim();
            const email = String(emailEl?.value || '').trim();
            const education = String(educationEl?.value || '').trim();
            const emergencyContactName = String(ecNameEl?.value || '').trim();
            const emergencyContactPhone = String(ecPhoneEl?.value || '').trim();
            const emergencyContactRelation = String(ecRelEl?.value || '').trim();
            const idCardFrontUrl = String(idFrontUrlEl?.value || '').trim();
            const idCardBackUrl = String(idBackUrlEl?.value || '').trim();
            const status = String(statusEl?.value || 'active');
            const coreTalent = !!(coreTalentEl?.checked);

            try {
                const ocrStatus = String(modal.dataset.idcardOcrStatus || '').trim();
                if (ocrStatus === 'running') {
                    showNotification('身份证识别中，请稍候再保存', 'warning');
                    return;
                }
            } catch (e) {}

            if (!name) {
                if (idCardFrontUrl || idCardBackUrl || idCardNumber) {
                    name = username;
                    try { if (nameEl) nameEl.value = name; } catch (e) {}
                } else {
                    showNotification('请填写姓名', 'warning');
                    return;
                }
            }

            if (!managerUsername) {
                try {
                    if (isStoreMgrCreate && currentUser && String(currentUser.username || '').trim()) {
                        managerUsername = String(currentUser.username || '').trim();
                        if (managerEl) managerEl.value = managerUsername;
                    }
                } catch (e) {}
            }
            if (!managerUsername) {
                showNotification('请选择直属上级账号', 'warning');
                hrmsMarkFieldInvalid(managerEl);
                return;
            }
            if (!joinDate || !/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) {
                showNotification('请填写入职日期（必填，格式YYYY-MM-DD）', 'warning');
                hrmsMarkFieldInvalid(joinDateEl);
                return;
            }
            if (!gender) { showNotification('请选择性别（必填）', 'warning'); hrmsMarkFieldInvalid(genderEl); return; }
            if (!birthday) { showNotification('请填写出生日期（必填）', 'warning'); hrmsMarkFieldInvalid(birthdayEl); return; }
            if (!store) { showNotification('请选择门店（必填）', 'warning'); hrmsMarkFieldInvalid(storeEl); return; }
            if (!role) { showNotification('请选择角色（必填）', 'warning'); hrmsMarkFieldInvalid(roleEl); return; }
            if (!department) { showNotification('请填写部门（必填）', 'warning'); hrmsMarkFieldInvalid(deptEl); return; }
            if (!position) { showNotification('请填写岗位（必填）', 'warning'); hrmsMarkFieldInvalid(posEl); return; }
            if (!phone) { showNotification('请填写手机号（必填）', 'warning'); hrmsMarkFieldInvalid(phoneEl); return; }
            if (!hometown) { showNotification('请填写籍贯（必填）', 'warning'); hrmsMarkFieldInvalid(hometownEl); return; }
            if (!emergencyContactName) { showNotification('请填写紧急联系人姓名（必填）', 'warning'); hrmsMarkFieldInvalid(ecNameEl); return; }
            if (!emergencyContactPhone) { showNotification('请填写紧急联系人电话（必填）', 'warning'); hrmsMarkFieldInvalid(ecPhoneEl); return; }
            if (!emergencyContactRelation) { showNotification('请填写紧急联系人关系（必填）', 'warning'); hrmsMarkFieldInvalid(ecRelEl); return; }
            if (String(managerUsername || '').toLowerCase() === String(username || '').toLowerCase()) {
                showNotification('直属上级账号不能与员工账号相同', 'error');
                hrmsMarkFieldInvalid(managerEl);
                return;
            }

            if (idCardNumber) {
                const info = hrmsParseChinaIdCardInfo(idCardNumber);
                if (!info?.ok) {
                    showNotification('身份证号码不合法，请检查后再提交', 'error');
                    hrmsMarkFieldInvalid(idCardNumberEl);
                    return;
                }
                if (!gender && String(info.gender || '')) {
                    gender = String(info.gender);
                    try { if (genderEl) genderEl.value = gender; } catch (e) {}
                }
                if (!birthday && String(info.birthDate || '')) {
                    birthday = String(info.birthDate);
                    try { if (birthdayEl) birthdayEl.value = String(birthday).slice(0, 10); } catch (e) {}
                }
                if (String(info.gender || '') && gender && String(info.gender) !== gender) {
                    showNotification('身份证号码与性别不一致（身份证推算为' + info.gender + '），请检查并修正', 'error');
                    hrmsMarkFieldInvalid(genderEl);
                    return;
                }
                const b = String(birthday || '').trim();
                const bd = b.length >= 10 ? b.slice(0, 10) : '';
                if (String(info.birthDate || '') && bd && String(info.birthDate) !== bd) {
                    showNotification('身份证号码与出生日期不一致（身份证推算为' + info.birthDate + '），请检查并修正', 'error');
                    hrmsMarkFieldInvalid(birthdayEl);
                    return;
                }
                if (!idCardFrontUrl && !idCardBackUrl) {
                    showNotification('已填写身份证号但未上传身份证图片，将继续保存（建议后续补充上传）', 'warning');
                }
            } else if (idCardFrontUrl || idCardBackUrl) {
                showNotification('已上传身份证图片但未识别到身份证号，将继续保存（建议后续补充/重新上传更清晰图片）', 'warning');
            }

            let salary = '';
            const salaryRaw = String(salaryEl?.value ?? '').trim();
            if (salaryRaw !== '') {
                const n = Number(salaryRaw);
                salary = Number.isFinite(n) ? n : '';
            }

            const employees = HRMS_STORE.getEmployees();
            const existsUserIdx = (employees || []).findIndex(e => String(e?.username || '').toLowerCase() === username.toLowerCase());
            if (mode === 'create' && existsUserIdx >= 0) {
                showNotification('新增失败：账号已存在', 'error');
                return;
            }

            if (isStoreMgrCreate) {
                const pwd = passwordInput || '123456';
                const employee = { id, username, name, password: pwd, gender, birthday, idCardNumber, hometown, registeredResidence, maritalStatus, wechat, store, role, department, position, level, managerUsername, salary, education, bankCardCompany, bankNameCompany, bankCardPersonal, bankNamePersonal, bankCard, emergencyContactName, emergencyContactPhone, emergencyContactRelation, idCardFrontUrl, idCardBackUrl, joinDate, phone, email, coreTalent };
                HRMS_API.createApproval('onboarding', { employee })
                    .then(() => {
                        clearEmployeeFormDraft();
                        closeEmployeeFormModal();
                        showNotification('已提交入职审批（待直属上级 → 总部人事 → 管理员逐级审核）', 'success');
                        try { showPage('approvals'); } catch (e) {}
                        try { refreshUnreadBadges(); } catch (e) {}
                    })
                    .catch((e) => {
                        const raw = String(e?.message || '提交失败');
                        const msg = raw.includes('duplicate_pending') ? '该员工已有待审批的入职申请，请等待审批完成后再提交' : raw;
                        showNotification('提交入职审批失败：' + msg, 'error');
                    });
                return;
            }

            if (mode === 'edit') {
                const origEmpId = String(modal.dataset.empId || '').trim();
                let idx = (employees || []).findIndex(e => String(e?.username || '') === origEmpId);
                if (idx < 0) idx = (employees || []).findIndex(e => String(e?.id || '') === origEmpId);
                if (idx < 0) {
                    showNotification('未找到员工', 'error');
                    return;
                }
                if (username.toLowerCase() !== origEmpId.toLowerCase()) {
                    const dupIdx = (employees || []).findIndex(e => String(e?.username || '').toLowerCase() === username.toLowerCase());
                    if (dupIdx >= 0 && dupIdx !== idx) {
                        showNotification('修改失败：新账号已被其他员工使用', 'error');
                        return;
                    }
                }
                const old = employees[idx] || {};
                const nextPwd = passwordInput ? passwordInput : (old.password || '');
                const nextEmp = { ...old, id, username, name, password: nextPwd, gender, birthday, idCardNumber, hometown, registeredResidence, maritalStatus, wechat, store, role, department, position, level, managerUsername, salary, education, bankCardCompany, bankNameCompany, bankCardPersonal, bankNamePersonal, bankCard, emergencyContactName, emergencyContactPhone, emergencyContactRelation, idCardFrontUrl, idCardBackUrl, joinDate, phone, email, status, coreTalent };
                try {
                    const resp = await HRMS_API.upsertEmployee(origEmpId, nextEmp);
                    const saved = resp?.employee || nextEmp;
                    const keyLower = String(origEmpId).toLowerCase();
                    const nextList = (employees || []).filter(e => {
                        const un = String(e?.username || '').trim().toLowerCase();
                        const eid = String(e?.id || '').trim();
                        return un !== keyLower && eid !== origEmpId;
                    });
                    nextList.push(saved);
                    HRMS_STORE.setEmployees(nextList);
                } catch (e) {
                    showNotification('编辑员工失败：' + (e?.message || e || '网络错误'), 'error');
                    return;
                }
            } else {
                const pwd = passwordInput || '123456';
                const nextEmp = { id, username, name, password: pwd, gender, birthday, idCardNumber, hometown, registeredResidence, maritalStatus, wechat, store, role, department, position, level, managerUsername, salary, education, bankCardCompany, bankNameCompany, bankCardPersonal, bankNamePersonal, bankCard, emergencyContactName, emergencyContactPhone, emergencyContactRelation, idCardFrontUrl, idCardBackUrl, joinDate, phone, email, status, coreTalent, promotionHistory: [], createdAt: new Date().toISOString().slice(0, 10), lastLogin: null };
                try {
                    const resp = await HRMS_API.createEmployee(nextEmp);
                    const saved = resp?.employee || nextEmp;
                    HRMS_STORE.setEmployees([...(employees || []), saved]);
                    clearEmployeeFormDraft();
                } catch (e) {
                    const raw = String(e?.message || e || '网络错误');
                    showNotification('新增员工失败：' + (raw.includes('duplicate') ? '账号已存在' : raw), 'error');
                    return;
                }
            }

            closeEmployeeFormModal();
            loadEmployeesData();
            showNotification(mode === 'edit' ? '编辑员工成功' : '新增员工成功', 'success');
        }
        
        function viewEmployee(empId) {
            const canView = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.STORE_MANAGER || currentUser.role === ROLES.HR_MANAGER);
            if (!canView) {
                showNotification('您没有查看权限', 'warning');
                return;
            }
            openEmployeeFormModal('view', empId);
        }
        
        async function resetPassword(empId) {
            if (!hasPermission(PERMISSIONS.EDIT_CONTENT)) {
                showNotification('您没有密码重置权限', 'warning');
                return;
            }
            const key = String(empId || '').trim();
            if (!key) return;
            const employees = HRMS_STORE.getEmployees();
            let idx = (employees || []).findIndex(e => String(e?.username || '') === key);
            if (idx < 0) idx = (employees || []).findIndex(e => String(e?.id || '') === key);
            if (idx < 0) {
                showNotification('未找到员工', 'error');
                return;
            }
            const _okRP = await hrmsConfirm({ title: '重置密码', message: `确定要重置账号 ${key} 的密码为默认 123456 吗？`, okText: '确认重置', icon: '🔑' });
            if (!_okRP) return;
            const uname = String(employees[idx]?.username || key).trim();
            try {
                await HRMS_API.resetEmployeePassword(uname, '123456');
                employees[idx] = { ...employees[idx], password: '123456' };
                HRMS_STORE.setEmployees(employees);
                showNotification('密码已重置', 'success');
            } catch (e) {
                showNotification('重置密码失败：' + (e?.message || e || '网络错误'), 'error');
            }
        }
        
        async function toggleEmployeeStatus(empId) {
            if (!hasPermission(PERMISSIONS.EDIT_CONTENT)) {
                showNotification('您没有员工管理权限', 'warning');
                return;
            }

            const key = String(empId || '').trim();
            const employees = HRMS_STORE.getEmployees();
            let idx = (employees || []).findIndex(e => String(e?.username || '') === key);
            if (idx < 0) idx = (employees || []).findIndex(e => String(e?.id || '') === key);
            if (idx < 0) {
                showNotification('未找到员工', 'error');
                return;
            }
            const emp = employees[idx];
            const nextStatus = emp.status === 'active' ? 'inactive' : 'active';
            const ok = await hrmsConfirm({ title: '切换员工状态', message: `确定要将账号 ${emp.username || key} 状态切换为 ${nextStatus === 'active' ? '启用' : '禁用'} 吗？`, okText: nextStatus === 'active' ? '确认启用' : '确认禁用', icon: nextStatus === 'active' ? '✅' : '🚫' });
            if (!ok) return;

            try {
                const resp = await HRMS_API.patchEmployeeStatus(emp.username || key, nextStatus);
                employees[idx] = resp?.employee || { ...emp, status: nextStatus };
                HRMS_STORE.setEmployees(employees);
                loadEmployeesData();
                showNotification('状态已更新', 'success');
            } catch (e) {
                showNotification('状态更新失败：' + (e?.message || e || '网络错误'), 'error');
            }
        }

        async function loginAsEmployee(username, displayName) {
            if (!isAdminUser()) {
                showNotification('仅管理员可代登录', 'warning');
                return;
            }
            const reason = prompt('代登录：' + (displayName || username) + '\n\n请输入代登录原因（仅管理员可见，记录在日志中）：');
            if (reason === null) return;
            if (!reason.trim()) {
                showNotification('请输入代登录原因', 'warning');
                return;
            }
            try {
                const resp = await HRMS_API.request('/api/auth/login-as', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: username, reason: reason.trim() })
                });
                if (!resp || !resp.token) {
                    showNotification((resp && (resp.error || resp.message)) || '代登录失败', 'error');
                    return;
                }
                const prevAdminToken = HRMS_API.token();
                const prevAdminUser = { ...currentUser };
                sessionStorage.setItem('hrms_login_as_admin_token', prevAdminToken);
                sessionStorage.setItem('hrms_login_as_admin_user', JSON.stringify(prevAdminUser));
                HRMS_API.setToken(resp.token);
                currentUser = resp.user;
                isLoggedIn = true;
                const loginAsBanner = document.getElementById('login-as-banner');
                if (loginAsBanner) {
                    loginAsBanner.textContent = '⚠️ 代登录：' + (resp.user?.name || resp.user?.username || username) + '（点击退出恢复管理员）';
                    loginAsBanner.style.display = '';
                }
                showNotification('已切换为 ' + (resp.user?.name || username) + ' 的账号（代登录模式）', 'success');
                hrmsLoadStateFromServer().then(() => {
                    try { loadProfileData(); } catch (e) {}
                }).catch(() => {});
                showPage(getHomePageName());
                try { updateKitchenNavVisibility(); } catch (e) {}
                try { updateGrowthModuleVisibility(); updateStrategyModuleVisibility(); } catch (e) {}
            } catch (e) {
                showNotification('代登录失败：' + (e?.message || e || '网络错误'), 'error');
            }
        }

        async function exitLoginAs() {
            const savedToken = sessionStorage.getItem('hrms_login_as_admin_token');
            const savedUser = sessionStorage.getItem('hrms_login_as_admin_user');
            if (!savedToken) {
                showNotification('未找到管理员凭证，请重新登录', 'warning');
                return;
            }
            try {
                HRMS_API.setToken(savedToken);
                const prevUser = JSON.parse(savedUser || '{}');
                currentUser = prevUser;
                isLoggedIn = true;
                sessionStorage.removeItem('hrms_login_as_admin_token');
                sessionStorage.removeItem('hrms_login_as_admin_user');
                const loginAsBanner = document.getElementById('login-as-banner');
                if (loginAsBanner) loginAsBanner.style.display = 'none';
                showNotification('已恢复管理员账号', 'success');
                hrmsLoadStateFromServer().then(() => {
                    try { loadProfileData(); } catch (e) {}
                }).catch(() => {});
                showPage(getHomePageName());
                try { updateKitchenNavVisibility(); } catch (e) {}
                try { updateGrowthModuleVisibility(); updateStrategyModuleVisibility(); } catch (e) {}
            } catch (e) {
                showNotification('恢复失败：' + (e?.message || '未知错误'), 'error');
            }
        }

        async function deleteEmployee(empId) {
            if (!isAdminUser()) {
                showNotification('仅管理员可删除', 'warning');
                return;
            }
            const key = String(empId || '').trim();
            if (!key) return;
            const _ok1 = await hrmsConfirm({ title: '删除员工', message: `确定删除账号「${key}」？此操作不可恢复，员工数据将永久删除。`, okText: '确认删除', icon: '🗑️' });
            if (!_ok1) return;
            const keyLower = key.toLowerCase();
            const employees = HRMS_STORE.getEmployees();
            const users = HRMS_STORE.getUsers ? HRMS_STORE.getUsers() : [];
            const uname = (() => {
                const hit = (employees || []).find(e => {
                    const un = String(e?.username || '').trim().toLowerCase();
                    const id = String(e?.id || '').trim();
                    return un === keyLower || id === key;
                });
                return String(hit?.username || key).trim();
            })();
            try {
                await HRMS_API.deleteEmployeeApi(uname);
                try { await HRMS_API.deleteHrmsUser(uname); } catch (e) { /* 镜像可能不存在 */ }
            } catch (e) {
                showNotification('删除失败：' + (e?.message || e || '网络错误'), 'error');
                return;
            }
            HRMS_STORE.setEmployees((employees || []).filter(e => {
                const un = String(e?.username || '').trim().toLowerCase();
                const id = String(e?.id || '').trim();
                return un !== keyLower && id !== key && un !== String(uname).toLowerCase();
            }));
            try {
                if (HRMS_STORE.setUsers && Array.isArray(users)) {
                    HRMS_STORE.setUsers(users.filter(u => {
                        const un = String(u?.username || '').trim().toLowerCase();
                        const id = String(u?.id || '').trim();
                        return un !== keyLower && id !== key && un !== String(uname).toLowerCase();
                    }));
                }
            } catch (e) {}
            loadEmployeesData();
            showNotification('已删除', 'success');
        }
        
        function searchEmployees(query) {
            const input = document.getElementById('employee-search-input');
            if (input && String(input.value || '') !== String(query || '')) input.value = String(query || '');
            loadEmployeesData();
        }
        
        // 用户管理功能
        function showAddUserModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可新增用户', 'warning');
                return;
            }
            openUserFormModal('create');
        }
        
        function openUserFormModal(mode, username) {
            const modal = document.getElementById('user-form-modal');
            if (!modal) {
                showNotification('用户表单未加载（请刷新）', 'error');
                return;
            }

            const titleEl = document.getElementById('user-form-title');
            if (titleEl) titleEl.textContent = mode === 'edit' ? '编辑用户' : '新增用户';
            modal.dataset.mode = mode === 'edit' ? 'edit' : 'create';
            modal.dataset.username = username || '';

            const usernameEl = document.getElementById('user-form-username');
            const nameEl = document.getElementById('user-form-name');
            const pwdEl = document.getElementById('user-form-password');
            const pwdTipEl = document.getElementById('user-form-password-tip');
            const roleEl = document.getElementById('user-form-role');
            const storeEl = document.getElementById('user-form-store');
            const managerUsernameEl = document.getElementById('user-form-manager');
            const positionEl = document.getElementById('user-form-position');
            const departmentEl = document.getElementById('user-form-department');
            const levelEl = document.getElementById('user-form-level');
            const salaryEl = document.getElementById('user-form-salary');
            const joinDateEl = document.getElementById('user-form-joinDate');
            const phoneEl = document.getElementById('user-form-phone');
            const emailEl = document.getElementById('user-form-email');
            const statusEl = document.getElementById('user-form-status');

            const stores = (HRMS_STORE.getStores ? HRMS_STORE.getStores() : []) || [];
            const activeStores = stores.filter(s => (s?.status || 'active') === 'active').map(s => String(s?.name || s?.id || '')).filter(Boolean);
            if (storeEl) {
                const opts = [''].concat(activeStores);
                storeEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }

            if (managerUsernameEl) {
                const users = HRMS_STORE.getUsers();
                const employees = HRMS_STORE.getEmployees();
                // 直属上级只显示4个角色：店长/出品经理/总部营运/管理员
                const managerRoles = new Set(['store_manager', 'store_production_manager', 'hq_manager', 'admin']);
                const seen = new Set();
                const items = [];
                [...(employees || []), ...(users || [])].forEach(x => {
                    const u = String(x?.username || '').trim();
                    const r = String(x?.role || '').trim();
                    if (!u || seen.has(u)) return;
                    if (!managerRoles.has(r)) return;
                    seen.add(u);
                    items.push({ username: u, name: String(x?.name || '').trim() || u, role: r });
                });
                items.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'zh-CN'));
                managerUsernameEl.innerHTML = '<option value="">（无）</option>' + items.map(it => {
                    const label = it.name || it.username;
                    return `<option value="${it.username.replace(/"/g, '&quot;')}">${label}</option>`;
                }).join('');
            }

            const dict = hrmsGetOrgDict();
            const employeesAll = HRMS_STORE.getEmployees();
            const usersAll = HRMS_STORE.getUsers();
            const fallbackDepts = ['销售部', '后厨出品', '管理部', '人事', '财务', '运营', '培训'];
            const fallbackPositions = ['销售员', '门店员工', '门店店长', '出品经理', '区域经理', '总部经理', '系统管理员'];
            const fallbackLevels = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'P1', 'P2', 'P3', 'M1', 'M2', 'H1'];
            const depts = Array.from(new Set((dict.departments.length ? dict.departments : fallbackDepts).concat((employeesAll || []).map(e => String(e?.department || '').trim()), (usersAll || []).map(u => String(u?.department || '').trim())).filter(Boolean)));
            const poss = Array.from(new Set((dict.positions.length ? dict.positions : fallbackPositions).concat((employeesAll || []).map(e => String(e?.position || '').trim()), (usersAll || []).map(u => String(u?.position || '').trim())).filter(Boolean)));
            const levels = Array.from(new Set((dict.levels.length ? dict.levels : fallbackLevels).concat((usersAll || []).map(u => String(u?.level || '').trim())).filter(Boolean)));
            if (departmentEl) {
                const opts = [''].concat(depts);
                departmentEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }
            if (positionEl) {
                const opts = [''].concat(poss);
                positionEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }
            if (levelEl) {
                const opts = [''].concat(levels);
                levelEl.innerHTML = opts.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${v ? v : '（未选择）'}</option>`).join('');
            }

            if (mode === 'edit') {
                const users = HRMS_STORE.getUsers();
                const user = (users || []).find(u => u.username === username);
                if (!user) {
                    showNotification('未找到用户', 'error');
                    return;
                }
                if (usernameEl) usernameEl.value = String(user.username || '');
                if (nameEl) nameEl.value = String(user.name || '');
                if (pwdEl) {
                    const curPwd = String(user.password || '');
                    pwdEl.value = curPwd;
                    pwdEl.type = isAdminUser() ? 'text' : 'password';
                    pwdEl.placeholder = curPwd ? '已设置，留空=不修改' : '初始密码';
                }
                if (pwdTipEl) pwdTipEl.textContent = String(user.password || '').trim() ? '当前密码已设置，留空则不修改' : '（留空=不修改）';
                if (isAdminUser()) {
                    const unForPwd = String(user.username || '').trim();
                    hrmsScheduleAdminPasswordFetch(unForPwd, 'user-form-password', 'user-form-password-tip', !!String(user.password || '').trim());
                }
                if (roleEl) roleEl.value = String(user.role || '');
                if (storeEl) storeEl.value = String(user.store || '');
                if (managerUsernameEl) managerUsernameEl.value = String(user.managerUsername || '');
                if (positionEl) positionEl.value = String(user.position || '');
                if (departmentEl) departmentEl.value = String(user.department || '');
                if (levelEl) levelEl.value = String(user.level || '');
                if (salaryEl) salaryEl.value = user.salary === null || user.salary === undefined ? '' : String(user.salary);
                if (joinDateEl) joinDateEl.value = String(user.joinDate || '');
                if (phoneEl) phoneEl.value = String(user.phone || '');
                if (emailEl) emailEl.value = String(user.email || '');
                if (statusEl) statusEl.value = String(user.status || 'active');
                if (usernameEl) usernameEl.disabled = true;
            } else {
                if (usernameEl) {
                    usernameEl.value = '';
                    usernameEl.disabled = false;
                }
                if (nameEl) nameEl.value = '';
                if (pwdEl) pwdEl.value = '';
                if (pwdTipEl) pwdTipEl.textContent = '（留空=默认 123456）';
                if (roleEl) roleEl.value = '';
                if (storeEl) storeEl.value = '';
                if (managerUsernameEl) managerUsernameEl.value = '';
                if (positionEl) positionEl.value = '';
                if (departmentEl) departmentEl.value = '';
                if (levelEl) levelEl.value = '';
                if (salaryEl) salaryEl.value = '';
                if (joinDateEl) joinDateEl.value = '';
                if (phoneEl) phoneEl.value = '';
                if (emailEl) emailEl.value = '';
                if (statusEl) statusEl.value = 'active';
            }

            modal.classList.add('show');
        }

        function closeUserFormModal() {
            const modal = document.getElementById('user-form-modal');
            if (modal) modal.classList.remove('show');
        }

        async function submitUserForm() {
            if (!isAdminUser()) {
                showNotification('仅管理员可操作', 'warning');
                return;
            }
            const modal = document.getElementById('user-form-modal');
            if (!modal) return;

            const mode = String(modal.dataset.mode || 'create');
            const usernameEl = document.getElementById('user-form-username');
            const nameEl = document.getElementById('user-form-name');
            const pwdEl = document.getElementById('user-form-password');
            const roleEl = document.getElementById('user-form-role');
            const storeEl = document.getElementById('user-form-store');
            const managerUsernameEl = document.getElementById('user-form-manager');
            const positionEl = document.getElementById('user-form-position');
            const departmentEl = document.getElementById('user-form-department');
            const levelEl = document.getElementById('user-form-level');
            const salaryEl = document.getElementById('user-form-salary');
            const joinDateEl = document.getElementById('user-form-joinDate');
            const phoneEl = document.getElementById('user-form-phone');
            const emailEl = document.getElementById('user-form-email');
            const statusEl = document.getElementById('user-form-status');

            const username = (usernameEl?.value || '').trim();
            const name = (nameEl?.value || '').trim();
            if (!username) {
                showNotification('请填写用户名', 'warning');
                return;
            }
            if (!name) {
                showNotification('请填写姓名', 'warning');
                return;
            }

            const passwordInput = (pwdEl?.value || '').trim();
            const role = (roleEl?.value || '').trim();
            const store = (storeEl?.value || '').trim();
            const managerUsername = (managerUsernameEl?.value || '').trim();
            const position = (positionEl?.value || '').trim();
            const department = (departmentEl?.value || '').trim();
            const level = (levelEl?.value || '').trim();
            const joinDate = String(joinDateEl?.value || '').trim();
            const phone = (phoneEl?.value || '').trim();
            const email = (emailEl?.value || '').trim();
            const status = String(statusEl?.value || 'active');

            let salary = '';
            const salaryRaw = String(salaryEl?.value ?? '').trim();
            if (salaryRaw !== '') {
                const n = Number(salaryRaw);
                salary = Number.isFinite(n) ? n : '';
            }

            const users = HRMS_STORE.getUsers();
            const existsIdx = (users || []).findIndex(u => String(u?.username || '').toLowerCase() === username.toLowerCase());
            if (mode === 'create' && existsIdx >= 0) {
                showNotification('新增失败：用户名已存在', 'error');
                return;
            }

            let nextUser;
            if (mode === 'edit') {
                const idx = (users || []).findIndex(u => u.username === username);
                if (idx < 0) {
                    showNotification('未找到用户', 'error');
                    return;
                }
                const old = users[idx] || {};
                const nextPwd = passwordInput ? passwordInput : (old.password || '');
                nextUser = { ...old, username, name, role, store, managerUsername, position, department, level, salary, joinDate, phone, email, status, password: nextPwd };
                users[idx] = nextUser;
            } else {
                const pwd = passwordInput || '123456';
                nextUser = { username, name, role, store, managerUsername, position, department, level, salary, joinDate, phone, email, status, password: pwd, createdAt: new Date().toISOString().slice(0, 10), lastLogin: null };
                users.push(nextUser);
            }

            try {
                const resp = await HRMS_API.upsertHrmsUser(username, nextUser);
                nextUser = resp?.item || nextUser;
                const idx2 = users.findIndex(u => String(u?.username || '').toLowerCase() === username.toLowerCase());
                if (idx2 >= 0) users[idx2] = nextUser;
                else users.push(nextUser);
            } catch (e) {
                showNotification('保存用户失败：' + String(e?.message || e), 'error');
                return;
            }
            HRMS_STORE.setUsers(users);

            try {
                const empPatch = {
                    id: username,
                    username,
                    name,
                    store: store || (String(role || '') === String(ROLES.ADMIN) ? '总部' : ''),
                    department: department || (String(role || '') === String(ROLES.ADMIN) ? '管理部' : ''),
                    position: position || (String(role || '') === String(ROLES.ADMIN) ? '系统管理员' : ''),
                    level,
                    managerUsername,
                    role,
                    status: status || 'active'
                };
                if (mode === 'create') {
                    try { await HRMS_API.createEmployee(empPatch); } catch (e) {
                        try { await HRMS_API.upsertEmployee(username, empPatch); } catch (e2) {}
                    }
                } else {
                    try { await HRMS_API.upsertEmployee(username, empPatch); } catch (e) {}
                }
                const employees = HRMS_STORE.getEmployees() || [];
                const idx = (employees || []).findIndex(e => String(e?.username || '').toLowerCase() === username.toLowerCase());
                if (idx >= 0) employees[idx] = { ...(employees[idx] || {}), ...empPatch };
                else employees.push(empPatch);
                HRMS_STORE.setEmployees(employees);
            } catch (e) {}
            closeUserFormModal();
            loadUsersData();
            showNotification(mode === 'edit' ? '编辑用户成功' : '新增用户成功', 'success');
        }
        
        function editUser(username) {
            if (!isAdminUser()) {
                showNotification('您没有用户管理权限', 'warning');
                return;
            }
            openUserFormModal('edit', username);
        }
        
        async function resetUserPassword(username) {
            if (!isAdminUser()) {
                showNotification('您没有密码重置权限', 'warning');
                return;
            }

            const newPwd = (prompt('请输入新密码（留空则默认 123456）:') || '').trim() || '123456';
            const users = HRMS_STORE.getUsers();
            const idx = users.findIndex(u => u.username === username);
            if (idx < 0) {
                showNotification('未找到用户', 'error');
                return;
            }
            const _okUP = await hrmsConfirm({ title: '重置用户密码', message: `确定要将用户 ${username} 密码重置为：${newPwd} 吗？`, okText: '确认重置', icon: '🔑' });
            if (!_okUP) return;

            const next = { ...users[idx], password: newPwd };
            try {
                await HRMS_API.upsertHrmsUser(username, next);
                try { await HRMS_API.resetEmployeePassword(username, newPwd); } catch (e) {}
            } catch (e) {
                showNotification('重置失败：' + String(e?.message || e), 'error');
                return;
            }
            users[idx] = next;
            HRMS_STORE.setUsers(users);
            showNotification('密码已重置', 'success');
        }
        
        async function viewEmployeePassword(username) {
            if (!isAdminUser()) {
                showNotification('仅管理员可查看密码', 'warning');
                return;
            }
            const users = HRMS_STORE.getUsers() || [];
            const idx = users.findIndex(u => String(u?.username || '').trim() === String(username || '').trim());
            const user = idx >= 0 ? users[idx] : null;
            const employees = HRMS_STORE.getEmployees() || [];
            const empIdx = employees.findIndex(e => String(e?.username || '').trim() === String(username || '').trim());
            const emp = empIdx >= 0 ? employees[empIdx] : null;
            const pwd = String(user?.password || emp?.password || '').trim();
            const name = String(user?.name || emp?.name || username || '');
            if (pwd) {
                await hrmsConfirm({ title: `🔐 ${name || username} 的密码`, message: `用户名：${escapeHtml(username || '')}\n密码：${escapeHtml(pwd)}`, okText: '关闭' });
            } else {
                showNotification(`未找到用户「${username}」的密码`, 'warning');
            }
        }
        
        async function toggleUserStatus(username) {
            if (!isAdminUser()) {
                showNotification('您没有用户管理权限', 'warning');
                return;
            }

            const users = HRMS_STORE.getUsers();
            const idx = users.findIndex(u => u.username === username);
            if (idx < 0) {
                showNotification('未找到用户', 'error');
                return;
            }
            const u = users[idx];
            const nextStatus = (u.status || 'active') === 'active' ? 'inactive' : 'active';
            const _okUS = await hrmsConfirm({ title: '切换用户状态', message: `确定要将用户 ${username} ${nextStatus === 'active' ? '启用' : '禁用'} 吗？`, okText: nextStatus === 'active' ? '确认启用' : '确认禁用', icon: nextStatus === 'active' ? '✅' : '🚫' });
            if (!_okUS) return;

            const next = { ...u, status: nextStatus };
            try {
                await HRMS_API.upsertHrmsUser(username, next);
                try { await HRMS_API.patchEmployeeStatus(username, nextStatus); } catch (e) {}
            } catch (e) {
                showNotification('状态更新失败：' + String(e?.message || e), 'error');
                return;
            }
            users[idx] = next;
            HRMS_STORE.setUsers(users);
            loadUsersData();
            showNotification('状态已更新', 'success');
        }

        async function deleteUser(username) {
            if (!isAdminUser()) {
                showNotification('仅管理员可删除', 'warning');
                return;
            }
            const uname = String(username || '').trim();
            if (!uname) return;
            const _ok2 = await hrmsConfirm({ title: '删除用户', message: `确定删除用户「${uname}」？此操作不可恢复。`, okText: '确认删除', icon: '🗑️' });
            if (!_ok2) return;
            const unameLower = uname.toLowerCase();
            const users = HRMS_STORE.getUsers();
            const employees = HRMS_STORE.getEmployees ? HRMS_STORE.getEmployees() : [];
            try {
                await HRMS_API.deleteHrmsUser(uname);
                try { await HRMS_API.deleteEmployeeApi(uname); } catch (e) {}
            } catch (e) {
                showNotification('删除失败：' + String(e?.message || e), 'error');
                return;
            }
            HRMS_STORE.setUsers((users || []).filter(u => String(u?.username || '').trim().toLowerCase() !== unameLower));
            try {
                if (HRMS_STORE.setEmployees) {
                    HRMS_STORE.setEmployees((employees || []).filter(e => String(e?.username || '').trim().toLowerCase() !== unameLower));
                }
            } catch (e) {}
            loadUsersData();
            try { loadEmployeesData(); } catch (e) {}
            showNotification('已删除', 'success');
        }

        function loadUsersData() {
            const tbody = document.getElementById('users-tbody');
            if (!tbody) return;

            const cardsEl = document.getElementById('users-cards');
            const users = HRMS_STORE.getUsers() || [];

            if (!users.length) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#97848E;padding:40px;">暂无用户</td></tr>';
                try {
                    if (cardsEl) {
                        cardsEl.innerHTML = '<div style="text-align:center;color:rgba(151,132,142,0.72);padding:28px 12px;">暂无用户</div>';
                    }
                } catch (e) {}
                return;
            }

            const statusLabel = (s) => {
                const v = String(s || 'active');
                return v === 'inactive' ? '<span style="color:#E58B98;">离职</span>' : '<span style="color:#86C9A2;">在职</span>';
            };

            tbody.innerHTML = users.map(u => {
                const uname = String(u?.username || '');
                const canManage = isAdminUser();
                const roleName = getRoleDisplayName(u?.role);
                const store = String(u?.store || '-');
                const createdAt = u?.createdAt ? String(u.createdAt).slice(0, 10) : '-';
                const lastLogin = u?.lastLogin ? String(u.lastLogin).slice(0, 10) : '-';
                const act = canManage ? `
                    <button class="btn" style="padding:4px 8px;font-size:12px;" data-click="editUser" data-arg="${escapeHtml(uname)}">编辑</button>
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" data-click="resetUserPassword" data-arg="${escapeHtml(uname)}">重置密码</button>
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;background:#E0A6B4;border-color:#E0A6B4;" data-click="viewEmployeePassword" data-arg="${escapeHtml(uname)}">查看密码</button>
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;" data-click="toggleUserStatus" data-arg="${escapeHtml(uname)}">启用/禁用</button>
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:12px;color:#E58B98;" data-click="deleteUser" data-arg="${escapeHtml(uname)}">删除</button>
                ` : '-';
                return `<tr>
                    <td>${escapeHtml(uname)}</td>
                    <td>${escapeHtml(u?.name || '')}</td>
                    <td>${escapeHtml(roleName || '')}</td>
                    <td>${escapeHtml(store)}</td>
                    <td>${statusLabel(u?.status)}</td>
                    <td>${escapeHtml(createdAt)}</td>
                    <td>${escapeHtml(lastLogin)}</td>
                    <td>${act}</td>
                </tr>`;
            }).join('');

            try {
                if (cardsEl) {
                    cardsEl.innerHTML = users.map(u => {
                        const uname = String(u?.username || '').trim() || '-';
                        const name = String(u?.name || '').trim() || '-';
                        const roleName = String(getRoleDisplayName(u?.role) || '').trim() || '-';
                        const store = String(u?.store || '').trim() || '-';
                        const createdAt = u?.createdAt ? String(u.createdAt).slice(0, 10) : '-';
                        const lastLogin = u?.lastLogin ? String(u.lastLogin).slice(0, 10) : '-';
                        const st = String(u?.status || 'active');
                        const stText = st === 'inactive' ? '离职' : '在职';
                        const stClass = st === 'inactive' ? 'inactive' : 'active';
                        const act = isAdminUser() ? `
                            <button class="btn" type="button" style="padding:10px 14px;font-size:14px;" data-click="editUser" data-arg="${escapeHtml(uname)}">编辑</button>
                            <button class="btn btn-secondary" type="button" style="padding:10px 14px;font-size:14px;" data-click="resetUserPassword" data-arg="${escapeHtml(uname)}">重置密码</button>
                            <button class="btn btn-secondary" type="button" style="padding:10px 14px;font-size:14px;background:#E0A6B4;border-color:#E0A6B4;" data-click="viewEmployeePassword" data-arg="${escapeHtml(uname)}">查看密码</button>
                            <button class="btn btn-secondary" type="button" style="padding:10px 14px;font-size:14px;" data-click="toggleUserStatus" data-arg="${escapeHtml(uname)}">启用/禁用</button>
                            <button class="btn btn-secondary" type="button" style="padding:10px 14px;font-size:14px;color:#E58B98;" data-click="deleteUser" data-arg="${escapeHtml(uname)}">删除</button>
                        ` : '';
                        return `
                            <div class="us-card">
                                <div class="us-card-head">
                                    <div style="min-width:0;">
                                        <div class="us-card-title">${escapeHtml(name)}</div>
                                        <div class="us-card-meta">账号 ${escapeHtml(uname)}</div>
                                    </div>
                                    <div class="us-badge ${stClass}">${escapeHtml(stText)}</div>
                                </div>
                                <div class="us-card-body">
                                    <div class="us-item"><div class="k">角色</div><div class="v">${escapeHtml(roleName)}</div></div>
                                    <div class="us-item"><div class="k">门店</div><div class="v">${escapeHtml(store)}</div></div>
                                    <div class="us-item"><div class="k">创建</div><div class="v">${escapeHtml(createdAt)}</div></div>
                                    <div class="us-item"><div class="k">登录</div><div class="v">${escapeHtml(lastLogin)}</div></div>
                                </div>
                                <div class="us-actions">${act}</div>
                            </div>
                        `;
                    }).join('');
                }
            } catch (e) {}
        }
        
        // 门店管理功能
        function loadStoresData() {
            const grid = document.getElementById('stores-grid');
            if (!grid) return;

            const stores = HRMS_STORE.getStores() || [];
            
            if (stores.length === 0) {
                grid.innerHTML = '<div style="color:#97848E;padding:40px;text-align:center;grid-column:1/-1;">暂无门店数据，点击"新增门店"添加</div>';
                return;
            }

            grid.innerHTML = stores.map(store => {
                const statusColor = store.status === 'active' ? '#86C9A2' : '#E58B98';
                const statusText = store.status === 'active' ? '营业中' : '已关闭';
                return `
                <div class="card" style="padding:20px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                        <div>
                            <div style="font-weight:600;font-size:16px;">${escapeHtml(store.name || store.id)}</div>
                            <div style="font-size:12px;color:#97848E;margin-top:4px;">${escapeHtml(store.city || '')} ${escapeHtml(store.floor || '')}</div>
                        </div>
                        <span style="padding:4px 8px;border-radius:12px;font-size:12px;background:${statusColor}20;color:${statusColor};">${statusText}</span>
                    </div>
                    <div style="font-size:13px;color:#aaa;margin-bottom:8px;">
                        <div>📍 ${escapeHtml(store.address || '-')}</div>
                        <div>🏷️ 品牌：${escapeHtml(store.brandName || store.brand || getBrandNameById(store.brandId) || '-')}</div>
                        <div>👤 店长：${escapeHtml(store.managerName || '-')}</div>
                        <div>📞 ${escapeHtml(store.phone || '-')}</div>
                        <div>📅 开业：${escapeHtml(store.openDate || '-')}</div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:12px;">
                        <button class="btn btn-secondary" style="padding:6px 12px;font-size:12px;" data-click="viewStoreDetail" data-arg="${store.id}">查看</button>
                        ${isAdminUser() ? `<button class="btn" style="padding:6px 12px;font-size:12px;" data-click="editStore" data-arg="${store.id}">编辑</button>` : ''}
                        ${isAdminUser() ? `<button class="btn btn-secondary" style="padding:6px 12px;font-size:12px;color:#E58B98;" data-click="deleteStore" data-arg="${store.id}">删除</button>` : ''}
                    </div>
                </div>`;
            }).join('');
        }

        async function deleteStore(storeId) {
            const stores = HRMS_STORE.getStores() || [];
            const st = stores.find(s => s.id === storeId);
            const stName = st?.name || storeId;
            const _ok3 = await hrmsConfirm({ title: '删除门店', message: `确定删除门店「${stName}」？删除后相关数据将无法恢复。`, okText: '确认删除', icon: '🏪' });
            if (!_ok3) return;
            try {
                await HRMS_API.deleteStore(storeId);
                const latest = await HRMS_API.getStores();
                HRMS_STORE.setStores(Array.isArray(latest?.items) ? latest.items : []);
                loadStoresData();
                try { populateKnowledgeAudienceOptions(); } catch (e) {}
                try { populateTrainingAssignModalOptions(); } catch (e) {}
                try { populateExamAssignStoreOptions(); } catch (e) {}
                showNotification('已删除', 'success');
            } catch (e) {
                showNotification('删除失败：' + String(e?.message || e), 'error');
            }
        }

        function showAddStoreModal() {
            if (!hasPermission(PERMISSIONS.EDIT_CONTENT)) {
                showNotification('您没有门店管理权限', 'warning');
                return;
            }
            openStoreFormModal('create');
        }
        
        function editStore(storeId) {
            if (!hasPermission(PERMISSIONS.EDIT_CONTENT)) {
                showNotification('您没有门店管理权限', 'warning');
                return;
            }
            openStoreFormModal('edit', storeId);
        }
        
        function viewStoreDetail(storeId) {
            if (!hasPermission(PERMISSIONS.VIEW_STORE_INFO) && !hasPermission(PERMISSIONS.VIEW_ALL_INFO) && !hasPermission(PERMISSIONS.EDIT_CONTENT)) {
                showNotification('您没有查看门店详情权限', 'warning');
                return;
            }
            openStoreFormModal('view', storeId);
        }
        
        // 角色管理功能
        function showRoleConfigModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可配置角色权限', 'warning');
                return;
            }
            const modal = document.getElementById('role-config-modal');
            if (!modal) {
                showNotification('角色配置模态框未加载', 'error');
                return;
            }
            renderRoleConfigList();
            modal.classList.add('show');
        }

        function closeRoleConfigModal() {
            const modal = document.getElementById('role-config-modal');
            if (modal) modal.classList.remove('show');
        }

        function getRolePermissions() {
            const settings = HRMS_STORE.getSettings();
            return settings.rolePermissions || {};
        }

        function setRolePermissions(perms) {
            HRMS_STORE.updateSettings({ rolePermissions: perms });
        }

        function getDefaultRolePermissions() {
            return {
                admin: Object.values(PERMISSIONS),
                hq_manager: [PERMISSIONS.VIEW_OWN_INFO, PERMISSIONS.VIEW_STORE_INFO, PERMISSIONS.VIEW_ALL_INFO, PERMISSIONS.ASSIGN_TASKS, PERMISSIONS.MANAGE_REWARDS, PERMISSIONS.EDIT_CONTENT, PERMISSIONS.UPLOAD_CONTENT],
                hr_manager: [PERMISSIONS.VIEW_OWN_INFO, PERMISSIONS.VIEW_ALL_INFO, PERMISSIONS.MANAGE_REWARDS, PERMISSIONS.ASSIGN_TASKS],
                cashier: [PERMISSIONS.VIEW_OWN_INFO],
                store_manager: [PERMISSIONS.VIEW_OWN_INFO, PERMISSIONS.VIEW_STORE_INFO, PERMISSIONS.ASSIGN_TASKS, PERMISSIONS.MANAGE_REWARDS],
                store_production_manager: [PERMISSIONS.VIEW_OWN_INFO, PERMISSIONS.VIEW_STORE_INFO],
                store_employee: [PERMISSIONS.VIEW_OWN_INFO]
            };
        }

        function renderRoleConfigList() {
            const container = document.getElementById('role-config-list');
            if (!container) return;

            const rolePerms = getRolePermissions();
            const defaults = getDefaultRolePermissions();
            const allPerms = Object.values(PERMISSIONS);

            // 系统内置角色
            const builtInRoles = {
                admin: '系统管理员',
                hq_manager: '总部经理',
                store_manager: '门店店长',
                store_production_manager: '出品经理',
                store_employee: '门店员工'
            };

            // 从字典维护中获取自定义角色
            const orgDict = hrmsGetOrgDict();
            const customRoles = Array.isArray(orgDict.roles) ? orgDict.roles : [];

            // 合并角色列表：内置角色 + 自定义角色
            const allRoles = { ...builtInRoles };
            customRoles.forEach(roleName => {
                const roleCode = 'custom_' + roleName.replace(/\s+/g, '_');
                if (!allRoles[roleCode]) {
                    allRoles[roleCode] = roleName;
                }
            });

            const permLabels = {
                [PERMISSIONS.VIEW_OWN_INFO]: '查看本人信息',
                [PERMISSIONS.VIEW_STORE_INFO]: '查看本门店信息',
                [PERMISSIONS.VIEW_ALL_INFO]: '查看全局信息',
                [PERMISSIONS.EDIT_CONTENT]: '编辑内容/配置',
                [PERMISSIONS.DELETE_CONTENT]: '删除内容',
                [PERMISSIONS.UPLOAD_CONTENT]: '上传内容',
                [PERMISSIONS.ASSIGN_TASKS]: '安排培训/考试',
                [PERMISSIONS.MANAGE_REWARDS]: '管理奖惩',
                [PERMISSIONS.BATCH_OPERATIONS]: '批量操作'
            };

            let html = '';
            Object.keys(allRoles).forEach(roleCode => {
                const perms = rolePerms[roleCode] || defaults[roleCode] || [PERMISSIONS.VIEW_OWN_INFO];
                const isAdmin = roleCode === 'admin';
                const isCustom = roleCode.startsWith('custom_');

                html += `<div class="role-config-card${isCustom ? ' custom-role' : ''}">
                    <div class="role-config-card-header">
                        <h4>${allRoles[roleCode]}</h4>
                        ${isCustom ? '<span class="role-badge custom">自定义</span>' : ''}
                    </div>
                    <div class="role-perm-list">`;

                allPerms.forEach(perm => {
                    const checked = perms.includes(perm) ? 'checked' : '';
                    const disabled = isAdmin ? 'disabled' : '';
                    const label = permLabels[perm] || formatPermissionLabel(perm);
                    html += `<div class="role-perm-item">
                        <label>
                            <input type="checkbox" data-role="${roleCode}" data-perm="${perm}" ${checked} ${disabled}>
                            ${label}
                        </label>
                    </div>`;
                });

                html += `</div></div>`;
            });

            if (customRoles.length === 0) {
                html += `<div class="role-config-hint">
                    <p>💡 提示：您可以在「字典维护」中添加自定义角色，添加后会自动出现在此处进行权限配置。</p>
                </div>`;
            }

            container.innerHTML = html;
        }

        function saveRoleConfig() {
            const container = document.getElementById('role-config-list');
            if (!container) return;

            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            const perms = {};

            checkboxes.forEach(cb => {
                const role = cb.dataset.role;
                const perm = cb.dataset.perm;
                if (!perms[role]) perms[role] = [];
                if (cb.checked) perms[role].push(perm);
            });

            setRolePermissions(perms);
            closeRoleConfigModal();
            showNotification('角色权限配置已保存', 'success');
        }
        
        function editRole(role) {
            showRoleConfigModal();
        }

        function hrmsEscapeCsvCell(value) {
            const s = String(value ?? '');
            if (/[\n\r,\"]/g.test(s)) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        }

        function hrmsDownloadText(filename, text) {
            const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        function hrmsDetectCsvDelimiter(text) {
            const lines = String(text || '')
                .split(/\r?\n/)
                .map(x => String(x || '').trim())
                .filter(Boolean)
                .slice(0, 8);
            const candidates = [',', '\t', ';', '，'];
            let best = ',';
            let bestScore = -1;
            candidates.forEach(d => {
                const score = lines.reduce((s, line) => s + ((line.match(new RegExp(d === '\\t' ? '\\\\t' : d.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&'), 'g')) || []).length), 0);
                if (score > bestScore) {
                    bestScore = score;
                    best = d;
                }
            });
            return bestScore > 0 ? best : ',';
        }

        function hrmsParseCsv(text) {
            const rows = [];
            const s = String(text || '').replace(/^\uFEFF/, '');
            const delimiter = hrmsDetectCsvDelimiter(s);
            let row = [];
            let cell = '';
            let inQuotes = false;

            for (let i = 0; i < s.length; i += 1) {
                const ch = s[i];
                const next = s[i + 1];

                if (inQuotes) {
                    if (ch === '"' && next === '"') {
                        cell += '"';
                        i += 1;
                        continue;
                    }
                    if (ch === '"') {
                        inQuotes = false;
                        continue;
                    }
                    cell += ch;
                    continue;
                }

                if (ch === '"') {
                    inQuotes = true;
                    continue;
                }
                if (ch === delimiter) {
                    row.push(cell);
                    cell = '';
                    continue;
                }
                if (ch === '\n') {
                    row.push(cell);
                    cell = '';
                    if (row.some(v => String(v || '').trim() !== '')) rows.push(row);
                    row = [];
                    continue;
                }
                if (ch === '\r') {
                    continue;
                }
                cell += ch;
            }

            row.push(cell);
            if (row.some(v => String(v || '').trim() !== '')) rows.push(row);
            return rows;
        }

        function hrmsReadFileAsArrayBuffer(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('read_failed'));
                reader.onload = () => resolve(reader.result);
                reader.readAsArrayBuffer(file);
            });
        }

        async function hrmsReadCsvFile(file) {
            const buf = await hrmsReadFileAsArrayBuffer(file);
            let text = new TextDecoder('utf-8').decode(buf);
            const badCharCount = (text.match(/\uFFFD/g) || []).length;
            if (badCharCount >= 3) {
                try {
                    const gb = new TextDecoder('gb18030').decode(buf);
                    const zhUtf8 = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
                    const zhGb = (gb.match(/[\u4e00-\u9fa5]/g) || []).length;
                    if (zhGb >= zhUtf8) text = gb;
                } catch (e) {}
            }
            return String(text || '');
        }

        async function hrmsReadImportRows(file) {
            const ext = String(file?.name || '').toLowerCase();
            if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
                if (typeof XLSX === 'undefined' || !XLSX?.read || !XLSX?.utils?.sheet_to_json) {
                    throw new Error('xlsx_library_missing');
                }
                const buf = await hrmsReadFileAsArrayBuffer(file);
                const wb = XLSX.read(buf, { type: 'array' });
                const firstSheet = wb?.SheetNames?.[0];
                if (!firstSheet) return [];
                const ws = wb.Sheets[firstSheet];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
                return (rows || []).map(r => (Array.isArray(r) ? r.map(v => String(v ?? '')) : [])).filter(r => r.some(v => String(v || '').trim() !== ''));
            }
            const text = await hrmsReadCsvFile(file);
            return hrmsParseCsv(text);
        }

        function hrmsPickCsvFile() {
            return new Promise((resolve) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                input.style.display = 'none';
                document.body.appendChild(input);
                input.addEventListener('change', () => {
                    const f = input.files && input.files[0];
                    input.remove();
                    resolve(f || null);
                });
                input.click();
            });
        }

        function hrmsNormalizeCsvHeaders(headers) {
            const alias = {
                '员工编号': 'id',
                '工号': 'id',
                '编号': 'id',
                '序号': 'id',
                '账号': 'username',
                '用户名': 'username',
                '登录名': 'username',
                '登录账号': 'username',
                '密码': 'password',
                '初始密码': 'password',
                '姓名': 'name',
                '员工姓名': 'name',
                '名字': 'name',
                '员工名': 'name',
                '性别': 'gender',
                '出生年月': 'birthday',
                '生日': 'birthday',
                '出生日期': 'birthday',
                '身份证号码': 'idCardNumber',
                '身份证': 'idCardNumber',
                '身份证号': 'idCardNumber',
                '证件号码': 'idCardNumber',
                '籍贯': 'hometown',
                '户籍地': 'registeredResidence',
                '户口所在地': 'registeredResidence',
                '户籍': 'registeredResidence',
                '婚姻状况': 'maritalStatus',
                '婚否': 'maritalStatus',
                '微信': 'wechat',
                '微信号': 'wechat',
                '角色': 'role',
                '职位角色': 'role',
                '职务': 'role',
                '门店': 'store',
                '所属门店': 'store',
                '店铺': 'store',
                '工作门店': 'store',
                '直属上级': 'managerUsername',
                '上级': 'managerUsername',
                '上级领导': 'managerUsername',
                '主管': 'managerUsername',
                '部门': 'department',
                '所属部门': 'department',
                '岗位': 'position',
                '职位': 'position',
                '级别': 'level',
                '工资': 'salary',
                '薪资': 'salary',
                '月薪': 'salary',
                '基本工资': 'salary',
                '学历': 'education',
                '最高学历': 'education',
                '入职日期': 'joinDate',
                '入职时间': 'joinDate',
                '入职': 'joinDate',
                '工资卡号公': 'bankCardCompany',
                '公司卡号': 'bankCardCompany',
                '工资银行公': 'bankNameCompany',
                '公司开户行': 'bankNameCompany',
                '工资卡号私': 'bankCardPersonal',
                '个人卡号': 'bankCardPersonal',
                '工资银行私': 'bankNamePersonal',
                '个人开户行': 'bankNamePersonal',
                '工资卡号': 'bankCardPersonal',
                '银行卡号': 'bankCardPersonal',
                '银行卡': 'bankCardPersonal',
                '卡号': 'bankCardPersonal',
                '开户行': 'bankNamePersonal',
                '电话': 'phone',
                '手机号': 'phone',
                '手机': 'phone',
                '联系电话': 'phone',
                '手机号码': 'phone',
                '邮箱': 'email',
                '电子邮箱': 'email',
                '紧急联系人': 'emergencyContactName',
                '联系人': 'emergencyContactName',
                '联系人电话': 'emergencyContactPhone',
                '联系人手机': 'emergencyContactPhone',
                '紧急电话': 'emergencyContactPhone',
                '联系人关系': 'emergencyContactRelation',
                '关系': 'emergencyContactRelation',
                '与本人关系': 'emergencyContactRelation',
                '状态': 'status',
                '员工状态': 'status',
                '在职状态': 'status'
            };
            
            return (headers || []).map(h => {
                // 清理表头：去除BOM、空格、括号内容
                let key = String(h || '').trim()
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // 去除零宽字符/BOM
                    .replace(/\(.*\)$/, '')               // 去除英文括号及内容
                    .replace(/（.*）$/, '')                 // 去除中文括号及内容
                    .replace(/\s+/g, '')                   // 去除所有空格
                    .trim();
                
                // 直接匹配
                if (alias[key]) return alias[key];
                
                // 尝试用多种分隔符分割后匹配第一部分
                const delimiters = /[\/\\|／\-_]/;
                const parts = key.split(delimiters);
                for (const p of parts) {
                    const trimmed = p.trim();
                    if (alias[trimmed]) return alias[trimmed];
                }
                
                // 尝试模糊匹配：包含关键词
                for (const [cnKey, enKey] of Object.entries(alias)) {
                    if (key.includes(cnKey)) return enKey;
                }
                
                // 都没匹配到，返回原始值（小写化）
                return key.toLowerCase();
            });
        }

        function hrmsCsvRowsToObjects(headers, rows) {
            const hs = hrmsNormalizeCsvHeaders(headers);
            return (rows || []).map(r => {
                const obj = {};
                hs.forEach((h, idx) => {
                    obj[h] = idx < (r || []).length ? String(r[idx] ?? '') : '';
                });
                return obj;
            });
        }

        function hrmsImportEmployeesFromCsvObjects(objs) {
            const templateHeaders = ['username', 'password', 'name', 'gender', 'birthday', 'idCardNumber', 'hometown', 'registeredResidence', 'maritalStatus', 'wechat', 'role', 'store', 'managerUsername', 'department', 'position', 'level', 'salary', 'education', 'joinDate', 'bankCardCompany', 'bankNameCompany', 'bankCardPersonal', 'bankNamePersonal', 'bankCard', 'phone', 'email', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'status', 'id'];
            const employees = HRMS_STORE.getEmployees();
            const byUsername = new Map((employees || []).map(e => [String(e?.username || ''), e]));
            const nameToUser = new Map();
            (employees || []).forEach(e => { const n = String(e?.name || '').trim(); if (n) nameToUser.set(n, String(e?.username || '')); });
            let added = 0;
            let updated = 0;
            let skipped = 0;
            const skippedNames = [];

            (objs || []).forEach(o => {
                let username = String(o.username ?? '').trim();
                if (!username && o.id) username = String(o.id || '').trim();
                if (!username && o.name) {
                    const nm = String(o.name || '').trim();
                    const ph = String(o.phone || '').trim();
                    if (nm) username = ph ? (nm + '_' + ph.slice(-4)) : nm;
                }
                if (!username) return;
                const importName = String(o.name || '').trim();
                // Dedup: if name exists under a DIFFERENT username, skip to prevent cross-person overwrite
                if (importName && nameToUser.has(importName) && nameToUser.get(importName) !== username) {
                    skipped += 1;
                    skippedNames.push(importName + '(已有账号' + nameToUser.get(importName) + ')');
                    return;
                }
                const next = {};
                templateHeaders.forEach(k => {
                    next[k] = Object.prototype.hasOwnProperty.call(o, k) ? String(o[k] ?? '') : '';
                });
                next.username = username;
                next.role = hrmsNormalizeRoleCode(next.role);
                next.status = hrmsNormalizeStatusCode(next.status);
                if (!next.joinDate) next.joinDate = new Date().toISOString().slice(0, 10);

                if (next.salary !== '') {
                    const n = Number(next.salary);
                    next.salary = Number.isFinite(n) ? n : '';
                }
                if (!next.bankCardPersonal && next.bankCard) next.bankCardPersonal = next.bankCard;
                if (!next.bankCard) next.bankCard = next.bankCardPersonal;

                if (!next.id) next.id = hrmsGenerateEmployeeId();
                if (!next.password) next.password = '123456';

                if (byUsername.has(username)) {
                    const old = byUsername.get(username) || {};
                    // Only overwrite fields that have non-empty values from the import
                    const merged = { ...old };
                    Object.keys(next).forEach(k => {
                        if (k === 'id') return; // never overwrite id
                        if (next[k] !== '' && next[k] != null) merged[k] = next[k];
                    });
                    merged.username = username;
                    merged.id = old.id || next.id;
                    byUsername.set(username, merged);
                    updated += 1;
                } else {
                    byUsername.set(username, next);
                    nameToUser.set(importName, username);
                    added += 1;
                }
            });

            HRMS_STORE.setEmployees(Array.from(byUsername.values()));
            loadEmployeesData();
            return { added, updated, skipped, skippedNames };
        }

        function hrmsImportUsersFromCsvObjects(objs) {
            const templateHeaders = ['username', 'password', 'name', 'gender', 'birthday', 'idCardNumber', 'hometown', 'registeredResidence', 'maritalStatus', 'wechat', 'role', 'store', 'managerUsername', 'department', 'position', 'level', 'salary', 'education', 'joinDate', 'bankCardCompany', 'bankNameCompany', 'bankCardPersonal', 'bankNamePersonal', 'bankCard', 'phone', 'email', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'status'];
            const users = HRMS_STORE.getUsers();
            const byUname = new Map((users || []).map(u => [String(u?.username || ''), u]));
            let added = 0;
            let updated = 0;

            (objs || []).forEach(o => {
                let username = String(o.username ?? '').trim();
                if (!username && o.id) username = String(o.id || '').trim();
                if (!username) return;
                const next = {};
                templateHeaders.forEach(k => {
                    next[k] = Object.prototype.hasOwnProperty.call(o, k) ? String(o[k] ?? '') : '';
                });
                next.status = hrmsNormalizeStatusCode(next.status);
                if (!next.joinDate) next.joinDate = new Date().toISOString().slice(0, 10);

                if (next.salary !== '') {
                    const n = Number(next.salary);
                    next.salary = Number.isFinite(n) ? n : '';
                }
                if (!next.bankCardPersonal && next.bankCard) next.bankCardPersonal = next.bankCard;
                if (!next.bankCard) next.bankCard = next.bankCardPersonal;

                if (byUname.has(username)) {
                    const old = byUname.get(username) || {};
                    byUname.set(username, { ...old, ...next });
                    updated += 1;
                } else {
                    byUname.set(username, next);
                    added += 1;
                }
            });

            const list = Array.from(byUname.values());
            HRMS_STORE.setUsers(list);
            loadUsersData();
            return { added, updated, users: list };
        }
        
        // 批量导入功能
        function showBatchImportModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可批量导入', 'warning');
                return;
            }
            (async () => {
                try {
                    const file = await hrmsPickCsvFile();
                    if (!file) return;
                    console.log('[batch-import] file:', file.name, 'size:', file.size, 'type:', file.type);
                    const rows = await hrmsReadImportRows(file);
                    console.log('[batch-import] parsed rows:', rows.length);
                    if (!rows.length) {
                        showNotification('导入文件为空或格式不正确（请检查表头与内容）', 'warning');
                        return;
                    }
                    if (rows.length < 2) {
                        showNotification('导入文件只有表头没有数据行', 'warning');
                        return;
                    }
                    // 自动检测标题行：如果第一行不像表头（关键列匹配数<2），尝试第2行作为表头
                    let headerRowIdx = 0;
                    const _testHeaders = (idx) => {
                        const nh = hrmsNormalizeCsvHeaders(rows[idx] || []);
                        let score = 0;
                        if (nh.includes('name')) score++;
                        if (nh.includes('username')) score++;
                        if (nh.includes('id')) score++;
                        if (nh.includes('phone')) score++;
                        if (nh.includes('store')) score++;
                        if (nh.includes('role')) score++;
                        if (nh.includes('gender')) score++;
                        return score;
                    };
                    const row0Score = _testHeaders(0);
                    console.log('[batch-import] row0 header score:', row0Score, 'row0:', JSON.stringify((rows[0]||[]).slice(0,5)));
                    if (row0Score < 2 && rows.length > 2) {
                        const row1Score = _testHeaders(1);
                        console.log('[batch-import] row1 header score:', row1Score, 'row1:', JSON.stringify((rows[1]||[]).slice(0,5)));
                        if (row1Score > row0Score) {
                            headerRowIdx = 1;
                            console.log('[batch-import] detected title row, using row 1 as header');
                        }
                        // 继续尝试第3行（某些模版有2行标题）
                        if (row1Score < 2 && rows.length > 3) {
                            const row2Score = _testHeaders(2);
                            if (row2Score > row1Score) {
                                headerRowIdx = 2;
                                console.log('[batch-import] detected 2 title rows, using row 2 as header');
                            }
                        }
                    }
                    const headers = rows[headerRowIdx];
                    const normalizedHeaders = hrmsNormalizeCsvHeaders(headers);
                    console.log('[batch-import] headerRowIdx:', headerRowIdx, 'original headers:', JSON.stringify(headers));
                    console.log('[batch-import] normalized headers:', JSON.stringify(normalizedHeaders));
                    const dataRows = rows.slice(headerRowIdx + 1);
                    const objs = hrmsCsvRowsToObjects(headers, dataRows);
                    console.log('[batch-import] parsed objects:', objs.length, 'sample:', JSON.stringify(objs[0] || {}));
                    if (!objs.length) {
                        showNotification('导入文件解析后无有效数据行', 'warning');
                        return;
                    }
                    // 检查是否能识别到关键字段
                    const hasName = normalizedHeaders.includes('name');
                    const hasUsername = normalizedHeaders.includes('username');
                    const hasId = normalizedHeaders.includes('id');
                    if (!hasName && !hasUsername && !hasId) {
                        showNotification('导入失败：未识别到 姓名/账号/员工编号 列，请检查表头（支持：姓名、员工姓名、账号、用户名、工号、员工编号）', 'error');
                        return;
                    }
                    const { added, updated, skipped, skippedNames } = hrmsImportEmployeesFromCsvObjects(objs);
                    console.log('[batch-import] result: added=', added, 'updated=', updated, 'skipped=', skipped, 'skippedNames=', skippedNames);
                    const synced = await hrmsFlushStateSave();
                    let msg = `导入完成：新增 ${added}，更新 ${updated}`;
                    if (skipped > 0) msg += `，跳过重名 ${skipped} 条（${skippedNames.slice(0,5).join('、')}${skippedNames.length > 5 ? '等' : ''}）`;
                    showNotification(msg, skipped > 0 ? 'warning' : 'success');
                    loadEmployeesData();
                    if (!synced) {
                        showNotification('导入已写入本地，但同步到服务器失败（请稍后重试或刷新后检查）', 'warning');
                    }
                } catch (e) {
                    console.error('[batch-import] error:', e);
                    if (String(e?.message || '').includes('xlsx_library_missing')) {
                        showNotification('Excel解析库未加载成功，请改用 CSV 格式导入（将Excel另存为CSV后重试）', 'error');
                        return;
                    }
                    showNotification('导入失败：' + String(e?.message || '请检查文件格式'), 'error');
                }
            })();
        }
        
        function showUserImportModal() {
            if (!isAdminUser()) {
                showNotification('仅管理员可批量导入用户', 'warning');
                return;
            }
            (async () => {
                try {
                    const file = await hrmsPickCsvFile();
                    if (!file) return;
                    const rows = await hrmsReadImportRows(file);
                    if (!rows.length) {
                        showNotification('导入文件为空或格式不正确（请检查表头与内容）', 'warning');
                        return;
                    }
                    const headers = rows[0];
                    const objs = hrmsCsvRowsToObjects(headers, rows.slice(1));
                    const { added, updated, users } = hrmsImportUsersFromCsvObjects(objs);
                    try {
                        const resp = await HRMS_API.importHrmsUsers(users);
                        if (Array.isArray(resp?.items)) HRMS_STORE.setUsers(resp.items);
                        loadUsersData();
                        showNotification(`导入完成：新增 ${added}，覆盖 ${updated}`, 'success');
                    } catch (e) {
                        showNotification('用户导入已写入本地，但同步到服务器失败：' + String(e?.message || e), 'warning');
                    }
                } catch (e) {
                    console.error(e);
                    if (String(e?.message || '').includes('xlsx_library_missing')) {
                        showNotification('当前环境缺少 Excel 解析能力，请改为 CSV 导入', 'error');
                        return;
                    }
                    showNotification('导入失败：请检查文件格式（支持 CSV/XLSX）和表头字段', 'error');
                }
            })();
        }
        
        // 导出功能（与历史 CSV 列完全一致，通过打印另存为 PDF）
        function exportEmployees() {
            if (!isAdminUser()) {
                showNotification('仅管理员可导出数据', 'warning');
                return;
            }
            const headers = ['员工编号', '账号', '密码', '姓名', '性别', '出生年月', '年龄', '身份证号码', '籍贯', '户籍所在地', '婚姻状况', '微信号', '角色', '所属门店', '直属上级账号', '部门', '岗位', '级别', '工资', '学历', '入职日期', '工资卡号公', '工资银行公', '工资卡号私', '工资银行私', '电话', '邮箱', '紧急联系人', '联系人电话', '联系人关系', '状态'];
            const keys = ['id', 'username', 'password', 'name', 'gender', 'birthday', '__ageDisp', 'idCardNumber', 'hometown', 'registeredResidence', 'maritalStatus', 'wechat', 'role', 'store', 'managerUsername', 'department', 'position', 'level', 'salary', 'education', 'joinDate', 'bankCardCompany', 'bankNameCompany', 'bankCardPersonal', 'bankNamePersonal', 'phone', 'email', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'status'];
            const employees = HRMS_STORE.getEmployees();
            const th = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
            const trs = (employees || []).map(e => {
                const tds = keys.map(k => {
                    let v = '';
                    if (k === '__ageDisp') {
                        const age = empCalcAgeFromBirthday(e?.birthday);
                        v = age !== null ? `${age}` : '';
                    } else {
                        v = e?.[k] ?? '';
                    }
                    return `<td>${escapeHtml(String(v))}</td>`;
                }).join('');
                return `<tr>${tds}</tr>`;
            }).join('');
            const title = `员工档案导出 · ${new Date().toISOString().slice(0, 10)}`;
            const printHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
body { font-family: 'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif; margin: 0; padding: 12px; color: #121012; }
h1 { font-size: 15px; margin: 0 0 10px; letter-spacing: 0.06em; }
.meta { font-size: 11px; color: #7A6B72; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 8px; }
th, td { border: 1px solid #B8AAB1; padding: 4px 5px; text-align: left; vertical-align: top; word-break: break-word; }
th { background: #F2EAEE; font-weight: 800; }
tr:nth-child(even) td { background: #F2EAEE; }
.hint { margin-top: 10px; font-size: 11px; color: #7A6B72; }
@media print { body { padding: 4px; } }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">列与系统「员工导出」原 CSV 完全一致 · 共 ${(employees || []).length} 人 · HRMS</div>
<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
<p class="hint">请在打印对话框中选择「另存为 PDF」。</p>
</body></html>`;
            const w = window.open('', '_blank', 'width=1200,height=900');
            if (!w) {
                showNotification('弹窗被拦截，请允许本站弹窗后重试', 'warning');
                return;
            }
            w.document.write(printHtml);
            w.document.close();
            w.focus();
            setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
            showNotification('已打开打印/PDF（列与导出 CSV 一致）', 'success');
        }

        function downloadEmployeeImportTemplate() {
            if (!isAdminUser()) {
                showNotification('仅管理员可下载模板', 'warning');
                return;
            }
            const headers = ['员工编号', '账号', '密码', '姓名', '性别', '出生年月', '年龄(自动计算，可留空)', '身份证号码', '籍贯', '户籍所在地', '婚姻状况', '微信号', '角色', '所属门店', '直属上级账号', '部门', '岗位', '级别', '工资', '学历', '入职日期', '工资卡号公', '工资银行公', '工资卡号私', '工资银行私', '电话', '邮箱', '紧急联系人', '联系人电话', '联系人关系', '状态'];
            const sample = ['(可留空自动生成)', '示例账号', '123456', '张三', '男', '1995-06-15', '', '430102199506150012', '湖南长沙', '湖南长沙', '单身', 'wx_zhangsan', '门店员工', '北京朝阳门店', '示例上级账号', '销售部', '销售员', 'L1', '8000', '高中', '2026-01-01', '6222020000000001', '中国银行', '6222020000000002', '招商银行', '13800138000', 'example@company.com', '李四', '13900139000', '父母', '启用'];
            const lines = [];
            lines.push(headers.join(','));
            lines.push(sample.map(hrmsEscapeCsvCell).join(','));
            hrmsDownloadText('员工导入模板.csv', lines.join('\n'));
            showNotification('已下载导入模板', 'success');
        }
        
        function exportUsers() {
            if (!isAdminUser()) {
                showNotification('仅管理员可导出用户', 'warning');
                return;
            }
            const headers = ['用户名', '密码', '姓名', '性别', '出生年月', '年龄', '身份证号码', '籍贯', '户籍所在地', '婚姻状况', '微信号', '角色', '所属门店', '直属上级账号', '部门', '岗位', '级别', '工资', '学历', '入职日期', '工资卡号公', '工资银行公', '工资卡号私', '工资银行私', '电话', '邮箱', '紧急联系人', '联系人电话', '联系人关系', '状态'];
            const keys = ['username', 'password', 'name', 'gender', 'birthday', '__ageDisp', 'idCardNumber', 'hometown', 'registeredResidence', 'maritalStatus', 'wechat', 'role', 'store', 'managerUsername', 'department', 'position', 'level', 'salary', 'education', 'joinDate', 'bankCardCompany', 'bankNameCompany', 'bankCardPersonal', 'bankNamePersonal', 'phone', 'email', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'status'];
            const users = HRMS_STORE.getUsers();
            const lines = [];
            lines.push(headers.join(','));
            (users || []).forEach(u => {
                const row = keys.map(k => {
                    if (k === '__ageDisp') {
                        const age = empCalcAgeFromBirthday(u?.birthday);
                        return hrmsEscapeCsvCell(age !== null ? `${age}` : '');
                    }
                    return hrmsEscapeCsvCell(u?.[k] ?? '');
                });
                lines.push(row.join(','));
            });
            hrmsDownloadText(`users_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'));
            showNotification('已导出 CSV', 'success');
        }

