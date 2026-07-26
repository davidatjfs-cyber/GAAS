/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 05-agents.js
 * lines: 13505-15265 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ========== Agent 监控中心 (Feishu-First) ==========
        function openAgentMonitorModal() {
            if (!currentUser) { showNotification('请先登录', 'warning'); return; }
            const modal = document.getElementById('agent-monitor-modal');
            if (!modal) return;
            if (!modal.dataset.boundClose) {
                modal.addEventListener('click', (e) => { if (e.target === modal) closeAgentMonitorModal(); });
                modal.dataset.boundClose = '1';
            }
            modal.style.display = '';
            modal.classList.add('show');
            refreshBrandsCache(true).then(() => {
                populateAmBrandFilter(__AM_BRAND_FILTER || 'all');
                loadAmDashboard();
            });
        }

        function closeAgentMonitorModal() {
            const modal = document.getElementById('agent-monitor-modal');
            if (!modal) return;
            modal.classList.remove('show');
            modal.style.display = '';
        }

        // ========== Agent 配置中心 ==========
        let __AGENT_CONFIGS = [];
        let __AGENT_RULES = [];
        let __AGENT_TEMPLATES = [];
        let __AGENT_TEMPLATE_MAP = {};
        let __AGENT_REPLY_TEMPLATES = [];
        let __AGENT_REPLY_TEMPLATE_MAP = {};
        let __AGENT_TEMPLATE_KIND = 'prompt';
        let __BI_AGENT_CONFIG = null;
        let __AGENT_ACTIVE_TAB = 'configs';
        let __AGENT_TAB_SWITCH_TIMER = 0;
        const __AGENT_TAB_LOADED = {};
        const __AGENT_REQUEST_CONTROLLERS = {};
        const BI_SOURCE_PRESET_OPTIONS = [
            { key: 'daily_reports', label: '营业日报（系统）', sourceType: 'system' },
            { key: 'table_visit_records', label: '桌访记录（系统入库）', sourceType: 'system' },
            { key: 'table_visit_bitable', label: '桌访表（飞书）', sourceType: 'bitable' },
            { key: 'opening_reports_bitable', label: '开档报告（飞书）', sourceType: 'bitable' },
            { key: 'closing_reports_bitable', label: '收档报告DB（飞书）', sourceType: 'bitable' },
            { key: 'meeting_reports_bitable', label: '例会报告（飞书）', sourceType: 'bitable' },
            { key: 'bad_reviews', label: '差评报告（飞书）', sourceType: 'bitable' },
            { key: 'material_majixian_bitable', label: '马己仙原料收货日报（飞书）', sourceType: 'bitable' },
            { key: 'material_hongchao_bitable', label: '洪潮原料收货日报（飞书）', sourceType: 'bitable' },
            { key: 'ops_checklist_bitable', label: '开-收档检查表（飞书）', sourceType: 'bitable' },
            { key: 'loss_reports_bitable', label: '报损单（飞书）', sourceType: 'bitable' }
        ];
        const OP_FREQUENCY_OPTIONS = ['daily', 'weekly', 'biweekly', 'monthly', 'custom'];
        const AGENT_MODEL_OPTIONS = [
            'deepseek-chat', 'deepseek-reasoner',
            'qwen-plus', 'qwen-max',
            'doubao-seed-2-0-pro-260215'
        ];
        const OP_REASONING_MODEL_OPTIONS = [
            'deepseek-chat', 'deepseek-reasoner',
            'qwen-plus', 'qwen-max'
        ];
        const OP_VISION_MODEL_OPTIONS = [
            'doubao-seed-2-0-pro-260215',
            'doubao-vision-pro-32k'
        ];
        const OP_INSPECTION_TYPE_OPTIONS = ['opening', 'closing', 'hygiene', 'food_safety', 'equipment', 'custom'];
        const OP_RANDOM_TYPE_OPTIONS = [
            { key: 'seafood_pool_temperature', label: '海鲜池温度' },
            { key: 'fridge_label_check', label: '冰箱标签检查' },
            { key: 'hand_washing_duration', label: '洗手时长检查' }
        ];

        window.hrmsOpsInspectionTypeChange = function(el) { if (el.value !== 'custom') return; const n = prompt('请输入自定义巡检类型英文标识(如 fire_safety)'); if (n) { const o = document.createElement('option'); o.value = n; o.text = n; o.selected = true; el.appendChild(o); } else el.value = 'opening'; }; window.hrmsSetBiAnomalyRuleEnabled = function(idx, checked) { if (__BI_ANOMALY_RULES[idx]) __BI_ANOMALY_RULES[idx].enabled = checked; }; window.hrmsSetBiAnomalyRuleMedium = function(idx, value) { if (__BI_ANOMALY_RULES[idx]) __BI_ANOMALY_RULES[idx].medium = Number(value); }; window.hrmsSetBiAnomalyRuleHigh = function(idx, value) { if (__BI_ANOMALY_RULES[idx]) __BI_ANOMALY_RULES[idx].high = Number(value); }; window.hrmsSetHrRatingDimWeight = function(i, value) { if (__HR_RATING_CURRENT_DIMS[i]) __HR_RATING_CURRENT_DIMS[i].weight = Number(value); }; window.hrmsSetHrRatingDimThreshold = function(i, grade, value) { if (__HR_RATING_CURRENT_DIMS[i]) { if (!__HR_RATING_CURRENT_DIMS[i].thresholds) __HR_RATING_CURRENT_DIMS[i].thresholds = {}; __HR_RATING_CURRENT_DIMS[i].thresholds[grade] = Number(value); } };

        async function fetchWithAgentAbort(key, url, options = {}) {
            const prev = __AGENT_REQUEST_CONTROLLERS[key];
            if (prev) prev.abort();
            const controller = new AbortController();
            __AGENT_REQUEST_CONTROLLERS[key] = controller;
            try {
                return await fetch(url, { ...options, signal: controller.signal });
            } finally {
                if (__AGENT_REQUEST_CONTROLLERS[key] === controller) {
                    delete __AGENT_REQUEST_CONTROLLERS[key];
                }
            }
        }

        function getAgentModelSelectHtml(agentId, currentModel) {
            const current = String(currentModel || '').trim();
            const options = AGENT_MODEL_OPTIONS.slice();
            const rendered = options.map((m) => `<option value="${escapeHtml(m)}" ${m === current ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
            return `<select id="cfg-model-${escapeHtml(agentId)}" class="acm-inp acm-inp-sm">${rendered}</select>`;
        }

        function getOpFrequencySelectHtml(value, cls) {
            const v = String(value || 'daily').trim();
            const label = { daily: '每天', weekly: '每周', biweekly: '每2周', monthly: '每月', custom: '自定义' };
            return `<select class="${cls}" style="width:100%; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff;">${OP_FREQUENCY_OPTIONS.map((k)=>`<option value="${k}" ${k===v?'selected':''}>${label[k]||k}</option>`).join('')}</select>`;
        }

        function getOpInspectionTypeSelectHtml(value, cls) {
            const v = String(value || 'opening').trim();
            const label = { opening: '开市', closing: '收档', hygiene: '卫生巡检', food_safety: '食安检查', equipment: '设备巡检', custom: '自定义…' };
            const isCustom = !OP_INSPECTION_TYPE_OPTIONS.includes(v);
            let opts = OP_INSPECTION_TYPE_OPTIONS.map((k)=>`<option value="${k}" ${k===v?'selected':''}>${label[k]||k}</option>`).join('');
            if (isCustom) opts += `<option value="${v}" selected>${v}</option>`;
            return `<select class="${cls}" style="width:100%; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff;" data-change="hrmsOpsInspectionTypeChange" data-arg-self>${opts}</select>`;
        }

        function getOpRandomTypeSelectHtml(value, cls) {
            const v = String(value || '').trim();
            const dlId = 'dl-rand-type-' + Math.random().toString(36).slice(2, 8);
            const presetOpts = OP_RANDOM_TYPE_OPTIONS.map((x) => `<option value="${escapeHtml(x.label)}"></option>`).join('');
            return `<input class="${cls}" list="${dlId}" value="${escapeHtml(v)}" placeholder="选择或输入自定义类型" style="width:100%; padding: 8px; border-radius: 6px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size:13px;"><datalist id="${dlId}">${presetOpts}</datalist>`;
        }

        function getOpStoreOptions(selectedStore = '', allowAll = false) {
            const stores = (HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : []).filter(Boolean);
            const selected = String(selectedStore || '').trim();
            if (!stores.length) {
                return '<option value="">暂无门店</option>';
            }
            const hasSelected = stores.some((s) => String(s?.name || '').trim() === selected) || (allowAll && selected === '');
            const allOption = allowAll ? `<option value="" ${selected === '' ? 'selected' : ''}>全部门店（随机）</option>` : '';
            const options = stores.map((s, idx) => {
                const name = String(s?.name || '').trim();
                const picked = hasSelected ? (name === selected) : idx === 0;
                return `<option value="${escapeHtml(name)}" ${picked ? 'selected' : ''}>${escapeHtml(name)}</option>`;
            }).join('');
            return `${allOption}${options}`;
        }

        function getOpRandomRoleChecksHtml(selectedRoles = []) {
            const all = ['store_manager', 'store_production_manager'];
            const labels = { store_manager: '店长', store_production_manager: '出品经理' };
            const normalized = Array.isArray(selectedRoles) && selectedRoles.length ? selectedRoles : all;
            return all.map((role) => {
                const checked = normalized.includes(role) ? 'checked' : '';
                return `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:10px;color:#cbd5e1;font-size:12px;"><input type="checkbox" class="op-random-role" value="${role}" ${checked}>${labels[role] || role}</label>`;
            }).join('');
        }

        function getOpStoreBrandByName(storeName) {
            const name = String(storeName || '').trim();
            if (!name) return '';
            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            const hit = stores.find((s) => String(s?.name || '').trim() === name);
            return String(hit?.brand || hit?.brandName || '').trim();
        }

        function parseChecklistFromCard(card) {
            try {
                const raw = String(card?.dataset?.checklist || '[]').trim();
                const arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean) : [];
            } catch (_) {
                return [];
            }
        }

        function bindOpFrequencyToggle(root) {
            const freqEl = root.querySelector('.op-daily-frequency');
            const customWrap = root.querySelector('.op-daily-custom-wrap');
            if (!freqEl || !customWrap) return;
            const refresh = () => { customWrap.style.display = freqEl.value === 'custom' ? 'block' : 'none'; };
            freqEl.onchange = refresh;
            refresh();
        }

        function ensureOpModelSelectOptions(reasoningModel, visionModel) {
            const reason = document.getElementById('op-llm-reasoning');
            const vision = document.getElementById('op-llm-vision');
            if (reason) {
                const options = OP_REASONING_MODEL_OPTIONS.slice();
                reason.innerHTML = options.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
                reason.value = options.includes(reasoningModel) ? reasoningModel : OP_REASONING_MODEL_OPTIONS[0];
            }
            if (vision) {
                const options = Array.from(new Set([...OP_VISION_MODEL_OPTIONS, String(visionModel || '').trim()].filter((m)=>String(m).startsWith('doubao-'))));
                vision.innerHTML = options.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
                vision.value = options.includes(visionModel) ? visionModel : OP_VISION_MODEL_OPTIONS[0];
            }
        }

        async function loadOpAgentConfig() {
            try {
                const res = await fetch('/api/admin/agents/ops-config', { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                
                const cfg = data.config || {};
                ensureOpModelSelectOptions(
                    String(cfg?.llmModels?.reasoningModel || 'deepseek-chat').trim(),
                    String(cfg?.llmModels?.visionModel || 'doubao-seed-2-0-pro-260215').trim()
                );
                
                // 1. Dispatchers
                const dispatchers = cfg.dispatchers || [];
                document.querySelectorAll('#op-config-dispatchers input[type="checkbox"]').forEach(cb => {
                    cb.checked = dispatchers.includes(cb.value);
                });

                // 2. Daily Inspections
                const dailyList = document.getElementById('op-config-daily-list');
                const dailyInspections = cfg.scheduledTasks?.dailyInspections || [];
                dailyList.innerHTML = dailyInspections.map((item, idx) => `
                    <div class="am-card" data-checklist="${escapeHtml(JSON.stringify(item.checklist || []))}" style="padding:14px;margin-bottom:0;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                            <div style="grid-column:span 2;">
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">门店</label>
                                <select class="op-daily-store" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                    ${getOpStoreOptions(item.store || '')}
                                </select>
                            </div>
                            <div>
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">类型</label>
                                ${getOpInspectionTypeSelectHtml(item.type || 'opening', 'op-daily-type')}
                            </div>
                            <div>
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">触发时间</label>
                                <input type="time" class="op-daily-time" value="${item.time || ''}" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                            </div>
                            <div>
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">触发频率</label>
                                ${getOpFrequencySelectHtml(item.frequency || 'daily', 'op-daily-frequency')}
                                <div class="op-daily-custom-wrap" style="margin-top:6px;display:none;">
                                    <input type="number" class="op-daily-custom-days" min="1" value="${Number(item.customIntervalDays || 1)}" placeholder="间隔天数" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                </div>
                            </div>
                            <div style="grid-column:span 2;">
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">检查表链接（可选，留空则在聊天中回复）</label>
                                <input class="op-daily-formurl" value="${item.formUrl || ''}" placeholder="https://xxx.feishu.cn/base/..." style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                            </div>
                            <div style="display:flex;align-items:flex-end;">
                                <button class="btn btn-secondary" data-click="hrmsRemoveClosest" data-arg="[data-checklist]" data-arg-self="1" style="width:100%;padding:10px;border-radius:8px;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.25);font-size:13px;">删除</button>
                            </div>
                        </div>
                    </div>
                `).join('');

                Array.from(dailyList.children).forEach((card) => bindOpFrequencyToggle(card));

                // 3. Random Inspections
                const randomList = document.getElementById('op-config-random-list');
                const randomInspections = cfg.scheduledTasks?.randomInspections || [];
                randomList.innerHTML = randomInspections.map((item, idx) => `
                    <div class="am-card" style="padding:14px;margin-bottom:0;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                            <div>
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">类型</label>
                                ${getOpRandomTypeSelectHtml((() => { const t = item.type || ''; const found = OP_RANDOM_TYPE_OPTIONS.find(x => x.key === t); return found ? found.label : t; })(), 'op-random-type')}
                            </div>
                            <div>
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">指定门店</label>
                                <select class="op-random-store" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                    ${getOpStoreOptions(item.store || '', true)}
                                </select>
                            </div>
                            <div style="grid-column:span 2;">
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">任务描述</label>
                                <input class="op-random-desc" value="${item.description || ''}" placeholder="例如：拍摄海鲜池水温计照片" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                            </div>
                            <div>
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">随机间隔(小时)</label>
                                <div style="display:flex;gap:6px;align-items:center;">
                                    <input type="number" class="op-random-interval-min" value="${Number(item.intervalMinHours || item.interval?.[0] || 2)}" min="1" style="width:50%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                    <span style="color:#64748b;font-size:13px;">~</span>
                                    <input type="number" class="op-random-interval-max" value="${Number(item.intervalMaxHours || item.interval?.[1] || 4)}" min="1" style="width:50%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                </div>
                            </div>
                            <div>
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">时间窗口(分钟)</label>
                                <input type="number" class="op-random-time" value="${item.timeWindow || 15}" min="1" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                            </div>
                            <div style="grid-column:span 2;">
                                <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">指定人员角色</label>
                                <div>${getOpRandomRoleChecksHtml(item.assigneeRoles || [])}</div>
                            </div>
                            <div style="grid-column:span 2;display:flex;justify-content:flex-end;">
                                <button class="btn btn-secondary" data-click="hrmsRemoveClosest" data-arg=".am-card" data-arg-self="1" style="padding:10px 20px;border-radius:8px;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.25);font-size:13px;">删除</button>
                            </div>
                        </div>
                    </div>
                `).join('');

            } catch (e) {
                console.error('loadOpAgentConfig error:', e);
                showNotification('加载OP配置失败', 'error');
            }
        }

        function addOpConfigDailyInspection() {
            const list = document.getElementById('op-config-daily-list');
            const div = document.createElement('div');
            div.innerHTML = `
                <div class="am-card" style="padding:14px;margin-bottom:0;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                        <div style="grid-column:span 2;">
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">门店</label>
                            <select class="op-daily-store" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                ${getOpStoreOptions('')}
                            </select>
                        </div>
                        <div>
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">类型</label>
                            ${getOpInspectionTypeSelectHtml('opening', 'op-daily-type')}
                        </div>
                        <div>
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">触发时间</label>
                            <input type="time" class="op-daily-time" value="10:00" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                        </div>
                        <div>
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">触发频率</label>
                            ${getOpFrequencySelectHtml('daily', 'op-daily-frequency')}
                            <div class="op-daily-custom-wrap" style="margin-top:6px;display:none;">
                                <input type="number" class="op-daily-custom-days" min="1" value="1" placeholder="间隔天数" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                            </div>
                        </div>
                        <div style="grid-column:span 2;">
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">检查表链接（可选，留空则在聊天中回复）</label>
                            <input class="op-daily-formurl" value="" placeholder="https://xxx.feishu.cn/base/..." style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                        </div>
                        <div style="display:flex;align-items:flex-end;">
                            <button class="btn btn-secondary" data-click="hrmsRemoveClosest" data-arg=".am-card" data-arg-self="1" style="width:100%;padding:10px;border-radius:8px;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.25);font-size:13px;">删除</button>
                        </div>
                    </div>
                </div>
            `;
            const card = div.firstElementChild;
            card.dataset.checklist = '[]';
            list.appendChild(card);
            bindOpFrequencyToggle(card);
        }

        function addOpConfigRandomInspection() {
            const list = document.getElementById('op-config-random-list');
            const div = document.createElement('div');
            div.innerHTML = `
                <div class="am-card" style="padding:14px;margin-bottom:0;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">类型</label>
                            ${getOpRandomTypeSelectHtml(OP_RANDOM_TYPE_OPTIONS[0].label, 'op-random-type')}
                        </div>
                        <div>
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">指定门店</label>
                            <select class="op-random-store" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                ${getOpStoreOptions('', true)}
                            </select>
                        </div>
                        <div style="grid-column:span 2;">
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">任务描述</label>
                            <input class="op-random-desc" placeholder="例如：拍摄海鲜池水温计照片" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                        </div>
                        <div>
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">随机间隔(小时)</label>
                            <div style="display:flex;gap:6px;align-items:center;">
                                <input type="number" class="op-random-interval-min" value="2" min="1" style="width:50%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                                <span style="color:#64748b;font-size:13px;">~</span>
                                <input type="number" class="op-random-interval-max" value="4" min="1" style="width:50%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                            </div>
                        </div>
                        <div>
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">时间窗口(分钟)</label>
                            <input type="number" class="op-random-time" value="15" min="1" style="width:100%;padding:10px 12px;border-radius:8px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;font-size:13px;">
                        </div>
                        <div style="grid-column:span 2;">
                            <label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;font-weight:600;">指定人员角色</label>
                            <div>${getOpRandomRoleChecksHtml([])}</div>
                        </div>
                        <div style="grid-column:span 2;display:flex;justify-content:flex-end;">
                            <button class="btn btn-secondary" data-click="hrmsRemoveClosest" data-arg=".am-card" data-arg-self="1" style="padding:10px 20px;border-radius:8px;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.25);font-size:13px;">删除</button>
                        </div>
                    </div>
                </div>
            `;
            list.appendChild(div.firstElementChild);
        }

        async function saveOpAgentConfig() {
            try {
                // Fetch current config to merge partial changes if needed, or reconstruct from scratch
                const res = await fetch('/api/admin/agents/ops-config', { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
                const currentData = await res.json();
                const config = currentData.config || {};
                config.llmModels = {
                    reasoningModel: String(document.getElementById('op-llm-reasoning')?.value || 'deepseek-chat').trim(),
                    visionModel: String(document.getElementById('op-llm-vision')?.value || 'doubao-seed-2-0-pro-260215').trim()
                };
                
                // 1. Dispatchers
                const dispatchers = Array.from(document.querySelectorAll('#op-config-dispatchers input[type="checkbox"]:checked')).map(cb => cb.value);
                config.dispatchers = dispatchers;

                // 2. Daily Inspections
                const dailyCards = document.querySelectorAll('#op-config-daily-list > div');
                const dailyInspections = Array.from(dailyCards).map(card => {
                    const store = String(card.querySelector('.op-daily-store')?.value || '').trim();
                    const formUrl = String(card.querySelector('.op-daily-formurl')?.value || '').trim();
                    return {
                        store,
                        brand: getOpStoreBrandByName(store),
                        type: String(card.querySelector('.op-daily-type').value || '').trim(),
                        time: card.querySelector('.op-daily-time').value,
                        frequency: String(card.querySelector('.op-daily-frequency')?.value || 'daily').trim(),
                        customIntervalDays: Number(card.querySelector('.op-daily-custom-days')?.value || 1),
                        checklist: parseChecklistFromCard(card),
                        ...(formUrl ? { formUrl } : {})
                    };
                }).filter(item => item.store && item.type && item.time);
                
                // 3. Random Inspections
                const randomCards = document.querySelectorAll('#op-config-random-list > div');
                const randomInspections = Array.from(randomCards).map(card => {
                    const store = String(card.querySelector('.op-random-store')?.value || '').trim();
                    const intervalMin = Math.max(1, parseInt(card.querySelector('.op-random-interval-min')?.value, 10) || 2);
                    const intervalMaxRaw = Math.max(1, parseInt(card.querySelector('.op-random-interval-max')?.value, 10) || 4);
                    const intervalMax = Math.max(intervalMin, intervalMaxRaw);
                    const assigneeRoles = Array.from(card.querySelectorAll('.op-random-role:checked')).map((el) => String(el.value || '').trim()).filter(Boolean);
                    return {
                        type: card.querySelector('.op-random-type').value.trim(),
                        store,
                        brand: store ? getOpStoreBrandByName(store) : '',
                        description: card.querySelector('.op-random-desc').value.trim(),
                        intervalMinHours: intervalMin,
                        intervalMaxHours: intervalMax,
                        interval: [intervalMin, intervalMax],
                        assigneeRoles: assigneeRoles.length ? assigneeRoles : ['store_manager', 'store_production_manager'],
                        timeWindow: parseInt(card.querySelector('.op-random-time').value) || 15
                    };
                }).filter(item => item.type && item.description);

                if (!config.scheduledTasks) config.scheduledTasks = {};
                config.scheduledTasks.dailyInspections = dailyInspections;
                config.scheduledTasks.randomInspections = randomInspections;

                const saveRes = await fetch('/api/admin/agents/ops-config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
                    body: JSON.stringify({ config, enabled: true })
                });
                
                if (!saveRes.ok) throw new Error((await saveRes.json()).error);
                showNotification('OP配置已保存');
            } catch (e) {
                console.error('saveOpAgentConfig error:', e);
                showNotification('保存失败: ' + e.message, 'error');
            }
        }

        // BI异常规则预设类型 - 所有规则均可配置，支持门店级别覆盖
        const BI_ANOMALY_RULE_PRESETS = [
            { id: 'revenue_gap', label: '实收营收达成率差值', category: '实收营收异常', compareMode: 'ratio_below', unit: '%', defaultMedium: 10, defaultHigh: 20, description: '月累计达成率与理论达成率的差值百分比', configKeys: ['revenueGapMedium', 'revenueGapHigh'], isPercent: true },
            { id: 'labor_efficiency', label: '人效值异常', category: '人效值异常', compareMode: 'below', unit: '元/人', defaultMedium: 1100, defaultHigh: 1000, description: '每日人均产值低于阈值', configKeys: ['efficiencyMedium', 'efficiencyHigh'] },
            { id: 'gross_margin', label: '总实收毛利率异常', category: '总实收毛利率异常', compareMode: 'below', unit: '%', defaultMedium: 69, defaultHigh: 68, description: '毛利率低于设定阈值触发', configKeys: ['marginMedium', 'marginHigh'], isPercent: true },
            { id: 'table_visit_product', label: '桌访产品不满意', category: '桌访产品异常', compareMode: 'above_count', unit: '次/周', defaultMedium: 2, defaultHigh: 4, description: '同一产品7天内不满意次数', configKeys: ['tableVisitProductMedium', 'tableVisitProductHigh'] },
            { id: 'table_visit_ratio', label: '桌访占比', category: '桌访占比异常', compareMode: 'below', unit: '%', defaultMedium: 50, defaultHigh: 40, description: '桌访覆盖率低于设定百分比', configKeys: ['tableVisitRatioMedium', 'tableVisitRatioHigh'], isPercent: true },
            { id: 'bad_review', label: '差评数量', category: '产品差评异常', compareMode: 'above_count', unit: '条/周', defaultMedium: 1, defaultHigh: 2, description: '周累计差评数', configKeys: ['badReviewMedium', 'badReviewHigh'] },
            { id: 'recharge_streak', label: '充值连续为零', category: '充值异常', compareMode: 'above_days', unit: '天', defaultMedium: 2, defaultHigh: 3, description: '连续N天无充值', configKeys: ['rechargeStreakHighDays', 'rechargeStreakHighDays'] }
        ];
        let __BI_ANOMALY_RULES = [];
        let __BI_STORE_OVERRIDES = {}; // { storeName: { key: value, ... } }
        const __BI_KNOWN_STORES = ['洪潮大宁久光店', '马己仙上海音乐广场店'];

        function renderBiAnomalyRules() {
            const list = document.getElementById('bi-anomaly-rules-list');
            const empty = document.getElementById('bi-anomaly-rules-empty');
            if (!list) return;
            if (!__BI_ANOMALY_RULES.length) {
                list.innerHTML = '';
                if (empty) empty.style.display = '';
                return;
            }
            if (empty) empty.style.display = 'none';
            const compareModeLabels = { ratio_below: '低于目标比例', below: '低于阈值', above_count: '超过次数', above_days: '超过天数' };
            list.innerHTML = __BI_ANOMALY_RULES.map((rule, idx) => {
                const preset = BI_ANOMALY_RULE_PRESETS.find(p => p.id === rule.presetId);
                const label = preset?.label || rule.customLabel || '自定义规则';
                const modeLabel = compareModeLabels[rule.compareMode] || rule.compareMode;
                const unitLabel = rule.unit || preset?.unit || '';
                return `<div style="background:#1e293b;border-radius:10px;padding:12px 14px;border:1px solid #334155;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <div style="font-weight:600;color:#e2e8f0;font-size:13px;">${escapeHtml(label)}</div>
                        <div style="display:flex;gap:6px;align-items:center;">
                            <label style="font-size:11px;color:#94a3b8;"><input type="checkbox" ${rule.enabled !== false ? 'checked' : ''} data-change="hrmsSetBiAnomalyRuleEnabled" data-arg="${idx}" data-arg-type="number" data-pass-checked> 启用</label>
                            <button data-click="removeBiAnomalyRule" data-arg="${idx}" data-arg-type="number" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;padding:2px;" title="删除">✕</button>
                        </div>
                    </div>
                    <div style="font-size:11px;color:#64748b;margin-bottom:8px;">${escapeHtml(preset?.description || rule.description || '')}　|　比较方式: ${escapeHtml(modeLabel)}</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div>
                            <label class="acm-lbl">🟡 中优先级 (${escapeHtml(unitLabel)})</label>
                            <input type="number" class="acm-inp acm-inp-sm" value="${rule.medium ?? ''}" data-change="hrmsSetBiAnomalyRuleMedium" data-arg="${idx}" data-arg-type="number" data-pass-number step="any">
                        </div>
                        <div>
                            <label class="acm-lbl">🔴 高优先级 (${escapeHtml(unitLabel)})</label>
                            <input type="number" class="acm-inp acm-inp-sm" value="${rule.high ?? ''}" data-change="hrmsSetBiAnomalyRuleHigh" data-arg="${idx}" data-arg-type="number" data-pass-number step="any">
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        function addBiAnomalyRule() {
            const usedIds = new Set(__BI_ANOMALY_RULES.map(r => r.presetId));
            const available = BI_ANOMALY_RULE_PRESETS.filter(p => !usedIds.has(p.id));
            if (!available.length) { showNotification('所有预设规则已添加', 'info'); return; }
            const opts = available.map(p => `<option value="${p.id}">${escapeHtml(p.label)} - ${escapeHtml(p.description)}</option>`).join('');
            const sel = prompt('选择要添加的异常规则编号（输入序号）：\n' + available.map((p, i) => `${i + 1}. ${p.label}`).join('\n'));
            const idx = parseInt(sel, 10) - 1;
            if (isNaN(idx) || idx < 0 || idx >= available.length) return;
            const p = available[idx];
            __BI_ANOMALY_RULES.push({
                presetId: p.id, category: p.category, compareMode: p.compareMode,
                unit: p.unit, medium: p.defaultMedium, high: p.defaultHigh, enabled: true
            });
            renderBiAnomalyRules();
        }

        function removeBiAnomalyRule(idx) {
            __BI_ANOMALY_RULES.splice(idx, 1);
            renderBiAnomalyRules();
            renderBiStoreOverrides();
        }

        function setBiStoreOverride(s,k,v,pct){
            if(!k)return;if(!__BI_STORE_OVERRIDES[s])__BI_STORE_OVERRIDES[s]={};
            if(v===''||v==null){delete __BI_STORE_OVERRIDES[s][k];return;}
            __BI_STORE_OVERRIDES[s][k]=pct?Number(v)/100:Number(v);
        }

        function renderBiStoreOverrides(){
            var el=document.getElementById('bi-store-overrides-area');
            if(!el)return;
            if(!__BI_ANOMALY_RULES.length||!__BI_KNOWN_STORES.length){el.innerHTML='<div style="color:#64748b;font-size:12px;padding:12px">请先添加全局规则</div>';return;}
            var h='';
            for(var i=0;i<__BI_KNOWN_STORES.length;i++){
                var s=__BI_KNOWN_STORES[i],ov=__BI_STORE_OVERRIDES[s]||{},cells='';
                for(var j=0;j<__BI_ANOMALY_RULES.length;j++){
                    var r=__BI_ANOMALY_RULES[j],p=BI_ANOMALY_RULE_PRESETS.find(function(x){return x.id===r.presetId;});
                    if(!p||!p.configKeys)continue;
                    var mk=p.configKeys[0],hk=p.configKeys[1],ip=!!p.isPercent;
                    var mv=ov[mk]!=null?(ip?+(ov[mk]*100).toFixed(2):ov[mk]):'';
                    var hv=ov[hk]!=null?(ip?+(ov[hk]*100).toFixed(2):ov[hk]):'';
                    cells+='<div style="display:flex;gap:4px;align-items:center;margin:2px 0"><span style="font-size:10px;color:#64748b;width:68px;flex-shrink:0">'+escapeHtml(p.label.slice(0,6))+'</span>';
                    cells+='<input type="number" class="acm-inp acm-inp-sm" style="width:58px;font-size:11px" placeholder="中" value="'+mv+'" data-change="setBiStoreOverride" data-arg="'+s.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'" data-arg2="'+mk+'" data-pass-value data-arg3="'+(ip?1:0)+'" data-arg3-type="number" step="any">';
                    cells+='<input type="number" class="acm-inp acm-inp-sm" style="width:58px;font-size:11px" placeholder="高" value="'+hv+'" data-change="setBiStoreOverride" data-arg="'+s.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'" data-arg2="'+hk+'" data-pass-value data-arg3="'+(ip?1:0)+'" data-arg3-type="number" step="any"></div>';
                }
                h+='<div style="background:#1e293b;border-radius:8px;padding:10px;border:1px solid #334155;margin-bottom:8px"><div style="font-weight:600;color:#e2e8f0;font-size:12px;margin-bottom:4px">🏪 '+escapeHtml(s)+'</div><div style="font-size:10px;color:#64748b;margin-bottom:4px">留空=使用全局默认值</div>'+cells+'</div>';
            }
            el.innerHTML=h;
        }

        // 将旧格式anomalyTriggers迁移为新rules数组
        function migrateOldTriggersToRules(t) {
            const rules = [];
            const g = t.global || t; // 兼容新旧格式
            for (const p of BI_ANOMALY_RULE_PRESETS) {
                const mk = p.configKeys?.[0], hk = p.configKeys?.[1];
                if (!mk) continue;
                const mv = g[mk], hv = g[hk];
                if (mv == null && hv == null) continue;
                let medium = mv ?? p.defaultMedium, high = hv ?? p.defaultHigh;
                if (p.isPercent) { medium = +(medium * 100).toFixed(2); high = +(high * 100).toFixed(2); }
                rules.push({ presetId: p.id, category: p.category, compareMode: p.compareMode, unit: p.unit, medium, high, enabled: true });
            }
            return rules.length ? rules : BI_ANOMALY_RULE_PRESETS.map(p => ({
                presetId: p.id, category: p.category, compareMode: p.compareMode,
                unit: p.unit, medium: p.defaultMedium, high: p.defaultHigh, enabled: true
            }));
        }

        async function loadBiAgentConfig() {
            try {
                renderBiSourcePresetDatalist();
                const res = await fetchWithAgentAbort('bi_config_load', '/api/admin/agents/bi-config', { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || 'load_bi_failed');

                const cfg = data?.config || {};
                const mergedSources = normalizeBiDataSourcesForUi(cfg);
                __BI_AGENT_CONFIG = { ...cfg, dataSources: mergedSources };
                renderBiDataSources(mergedSources);
                syncRuleCategoryOptions();

                // 加载异常规则（新格式优先，兼容旧格式迁移）
                if (Array.isArray(cfg?.anomalyRules) && cfg.anomalyRules.length) {
                    __BI_ANOMALY_RULES = cfg.anomalyRules;
                } else if (cfg?.anomalyTriggers && typeof cfg.anomalyTriggers === 'object') {
                    __BI_ANOMALY_RULES = migrateOldTriggersToRules(cfg.anomalyTriggers);
                } else {
                    // 默认规则
                    __BI_ANOMALY_RULES = BI_ANOMALY_RULE_PRESETS.slice(0, 6).map(p => ({
                        presetId: p.id, category: p.category, compareMode: p.compareMode,
                        unit: p.unit, medium: p.defaultMedium, high: p.defaultHigh, enabled: true
                    }));
                }
                // 加载门店覆盖
                const triggers = cfg?.anomalyTriggers || {};
                __BI_STORE_OVERRIDES = (triggers.storeOverrides && typeof triggers.storeOverrides === 'object') ? JSON.parse(JSON.stringify(triggers.storeOverrides)) : {};
                renderBiAnomalyRules();
                renderBiStoreOverrides();
            } catch (e) {
                if (String(e?.name || '') === 'AbortError') return;
                console.error('loadBiAgentConfig error:', e);
                showNotification('加载BI配置失败', 'error');
            }
        }

        async function saveBiAgentConfig() {
            try {
                const current = (__BI_AGENT_CONFIG && typeof __BI_AGENT_CONFIG === 'object') ? __BI_AGENT_CONFIG : {};
                const currentDs = normalizeBiDataSourcesForUi(current);
                const dsSelect = document.getElementById('bi-config-datasources');
                const enabledMap = new Set(Array.from(dsSelect?.selectedOptions || []).map((opt) => String(opt.value || '').trim()));
                const dataSources = currentDs.map((x) => ({ ...x, enabled: enabledMap.has(String(x?.key || '').trim()) }));

                // 构建 anomalyTriggers: global + storeOverrides
                const anomalyRules = __BI_ANOMALY_RULES.map(r => ({ ...r }));
                const globalTriggers = {};
                for (const r of anomalyRules) {
                    const p = BI_ANOMALY_RULE_PRESETS.find(x => x.id === r.presetId);
                    if (!p || !p.configKeys) continue;
                    const mk = p.configKeys[0], hk = p.configKeys[1];
                    if (mk) globalTriggers[mk] = p.isPercent ? (r.medium || 0) / 100 : r.medium;
                    if (hk && hk !== mk) globalTriggers[hk] = p.isPercent ? (r.high || 0) / 100 : r.high;
                    else if (hk === mk) globalTriggers[hk] = p.isPercent ? (r.high || 0) / 100 : r.high;
                }
                // 清理空的门店覆盖
                const storeOv = {};
                for (const [s, ov] of Object.entries(__BI_STORE_OVERRIDES || {})) {
                    const cleaned = {};
                    for (const [k, v] of Object.entries(ov || {})) { if (v != null && v !== '') cleaned[k] = v; }
                    if (Object.keys(cleaned).length) storeOv[s] = cleaned;
                }
                const anomalyTriggers = { global: globalTriggers, storeOverrides: storeOv };

                const config = { ...current, dataSources, anomalyRules, anomalyTriggers };

                const saveRes = await fetch('/api/admin/agents/bi-config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
                    body: JSON.stringify({ config, enabled: true })
                });
                const saveData = await saveRes.json().catch(() => ({}));
                if (!saveRes.ok) throw new Error(saveData?.error || 'save_bi_failed');
                showNotification('BI配置已保存', 'success');
                __BI_AGENT_CONFIG = config;
            } catch (e) {
                console.error('saveBiAgentConfig error:', e);
                showNotification('保存BI配置失败', 'error');
            }
        }

        function openAgentConfigModal() {
            const role = String(currentUser?.role || '').trim();
            if (!currentUser || !(role === ROLES.ADMIN || role === ROLES.HQ_MANAGER || role === ROLES.HR_MANAGER || role.startsWith('custom_'))) {
                showNotification('仅管理员可使用 Agent 配置', 'warning');
                return;
            }
            const modal = document.getElementById('agent-config-modal');
            if (!modal) return;
            if (!modal.dataset.boundClose) {
                modal.addEventListener('click', (e) => { if (e.target === modal) closeAgentConfigModal(); });
                modal.dataset.boundClose = '1';
            }
            modal.style.display = 'flex';
            modal.classList.add('open');
            ['configs', 'op_config', 'bi_config', 'rules', 'templates', 'hr_rating', 'perf_audit'].forEach((k) => { delete __AGENT_TAB_LOADED[k]; });
            switchAgentConfigTab('configs');
            const paInput = document.getElementById('perf-audit-period');
            if (paInput && !paInput.value) {
                const d = new Date();
                d.setDate(1);
                d.setMonth(d.getMonth() - 1);
                paInput.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            }
        }

        function closeAgentConfigModal() {
            const modal = document.getElementById('agent-config-modal');
            if (!modal) return;
            modal.classList.remove('open');
            modal.style.display = 'none';
        }

        function switchAgentConfigTab(tab) {
            __AGENT_ACTIVE_TAB = tab;
            document.getElementById('agent-config-tab-configs').style.display = tab === 'configs' ? 'block' : 'none';
            document.getElementById('agent-config-tab-op_config').style.display = tab === 'op_config' ? 'flex' : 'none';
            document.getElementById('agent-config-tab-op_config').style.flexDirection = 'column';
            document.getElementById('agent-config-tab-bi_config').style.display = tab === 'bi_config' ? 'block' : 'none';
            document.getElementById('agent-config-tab-rules').style.display = tab === 'rules' ? 'block' : 'none';
            document.getElementById('agent-config-tab-templates').style.display = tab === 'templates' ? 'block' : 'none';
            document.getElementById('agent-config-tab-hr-rating').style.display = tab === 'hr_rating' ? 'block' : 'none';
            document.getElementById('agent-config-tab-perf_audit').style.display = tab === 'perf_audit' ? 'block' : 'none';

            const cfgBtn = document.getElementById('agent-config-tab-btn-configs');
            const opBtn = document.getElementById('agent-config-tab-btn-op_config');
            const biBtn = document.getElementById('agent-config-tab-btn-bi_config');
            const rulesBtn = document.getElementById('agent-config-tab-btn-rules');
            const tplBtn = document.getElementById('agent-config-tab-btn-templates');
            const hrBtn = document.getElementById('agent-config-tab-btn-hr-rating');
            
            if (cfgBtn) cfgBtn.classList.toggle('active', tab === 'configs');
            if (cfgBtn) cfgBtn.classList.toggle('btn-secondary', tab !== 'configs');
            if (opBtn) opBtn.classList.toggle('active', tab === 'op_config');
            if (opBtn) opBtn.classList.toggle('btn-secondary', tab !== 'op_config');
            if (biBtn) biBtn.classList.toggle('active', tab === 'bi_config');
            if (biBtn) biBtn.classList.toggle('btn-secondary', tab !== 'bi_config');
            if (rulesBtn) rulesBtn.classList.toggle('active', tab === 'rules');
            if (rulesBtn) rulesBtn.classList.toggle('btn-secondary', tab !== 'rules');
            if (tplBtn) tplBtn.classList.toggle('active', tab === 'templates');
            if (tplBtn) tplBtn.classList.toggle('btn-secondary', tab !== 'templates');
            if (hrBtn) hrBtn.classList.toggle('active', tab === 'hr_rating');
            if (hrBtn) hrBtn.classList.toggle('btn-secondary', tab !== 'hr_rating');
            const paBtn = document.getElementById('agent-config-tab-btn-perf-audit');
            if (paBtn) paBtn.classList.toggle('active', tab === 'perf_audit');
            if (paBtn) paBtn.classList.toggle('btn-secondary', tab !== 'perf_audit');

            if (__AGENT_TAB_SWITCH_TIMER) clearTimeout(__AGENT_TAB_SWITCH_TIMER);
            __AGENT_TAB_SWITCH_TIMER = window.setTimeout(() => {
                const firstOpen = !__AGENT_TAB_LOADED[tab];
                if (tab === 'configs' && firstOpen) loadAgentConfigs();
                if (tab === 'op_config' && firstOpen) loadOpAgentConfig();
                if (tab === 'bi_config' && firstOpen) loadBiAgentConfig();
                if (tab === 'rules' && firstOpen) loadAgentRules();
                if (tab === 'templates' && firstOpen) loadAgentTemplates();
                if (tab === 'hr_rating' && firstOpen) loadHrEmployeeRatingConfig();
                __AGENT_TAB_LOADED[tab] = true;
            }, 60);
        }

        async function loadAgentTemplates(agentId = '') {
            const box = document.getElementById('agent-templates-list');
            if (box) box.innerHTML = '<div class="acm-empty">加载中…</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const basePath = __AGENT_TEMPLATE_KIND === 'reply' ? '/api/admin/agents/reply-templates' : '/api/admin/agents/templates';
                const url = agentId ? (basePath + '?agent_id=' + encodeURIComponent(agentId)) : basePath;
                const resp = await fetchWithAgentAbort('agent_templates_active', url, { headers: { 'Authorization': 'Bearer ' + token } });
                if (!resp.ok) throw new Error('load_templates_failed');
                const data = await resp.json();
                const list = Array.isArray(data?.templates) ? data.templates : [];
                if (__AGENT_TEMPLATE_KIND === 'reply') {
                    __AGENT_REPLY_TEMPLATES = list;
                    __AGENT_REPLY_TEMPLATE_MAP = {};
                } else {
                    __AGENT_TEMPLATES = list;
                    __AGENT_TEMPLATE_MAP = {};
                }
                list.forEach((t) => {
                    const k = String(t.agent_id || '').trim();
                    if (!k) return;
                    const targetMap = __AGENT_TEMPLATE_KIND === 'reply' ? __AGENT_REPLY_TEMPLATE_MAP : __AGENT_TEMPLATE_MAP;
                    if (!targetMap[k]) targetMap[k] = [];
                    targetMap[k].push(t);
                });
                renderAgentTemplateCreatorOptions();
                renderAgentTemplatesList();
            } catch (e) {
                if (String(e?.name || '') === 'AbortError') return;
                if (box) box.innerHTML = '<div class="acm-empty" style="color:#f87171;">模板加载失败</div>';
            }
        }

        function renderAgentTemplateCreatorOptions() {
            const sel = document.getElementById('agent-template-new-agent');
            if (!sel) return;
            sel.innerHTML = (__AGENT_CONFIGS || []).map((c) => `<option value="${escapeHtml(c.agent_id || '')}">${escapeHtml(c.name || c.agent_id || '')}</option>`).join('');
        }

        function renderAgentTemplatesList() {
            const box = document.getElementById('agent-templates-list');
            if (!box) return;
            const list = getActiveTemplateList();
            if (!Array.isArray(list) || !list.length) {
                box.innerHTML = '<div class="acm-empty">暂无模板，请在上方新增</div>';
                return;
            }
            box.innerHTML = list.map((t) => {
                const locked = !!t.is_builtin;
                return `
                    <div class="acm-tpl-card">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                            <div style="flex:1;min-width:0;">
                                <div class="acm-tpl-name">${escapeHtml(t.name || '')}</div>
                                <div class="acm-tpl-agent">${escapeHtml(t.agent_id || '')} ${locked ? '· 系统模板' : '· 公司模板'}</div>
                            </div>
                            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:#64748b;flex-shrink:0;">
                                <input type="checkbox" id="tpl-enabled-${escapeHtml(t.id)}" ${t.enabled ? 'checked' : ''} style="accent-color:#6366f1;"> 启用
                            </label>
                        </div>
                        <input id="tpl-name-${escapeHtml(t.id)}" value="${escapeHtml(t.name || '')}" placeholder="模板名称" class="acm-inp acm-inp-sm" style="margin-top:10px;">
                        <textarea id="tpl-content-${escapeHtml(t.id)}" ${locked ? 'readonly' : ''} class="acm-inp" style="min-height:80px;resize:vertical;margin-top:8px;">${escapeHtml(t.content || '')}</textarea>
                        <div class="acm-tpl-footer">
                            ${locked ? '' : `<button class="acm-tpl-del" data-click="deleteAgentTemplate" data-arg="${escapeHtml(t.id)}">删除</button>`}
                            <button class="acm-edit-btn" data-click="saveAgentTemplate" data-arg="${escapeHtml(t.id)}">保存</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function createAgentTemplate() {
            const agentId = String(document.getElementById('agent-template-new-agent')?.value || '').trim();
            const name = String(document.getElementById('agent-template-new-name')?.value || '').trim();
            const content = String(document.getElementById('agent-template-new-content')?.value || '').trim();
            if (!agentId || !name || !content) { showNotification('请完整填写模板信息', 'warning'); return; }
            try {
                const token = localStorage.getItem('hrms_token');
                const apiPath = __AGENT_TEMPLATE_KIND === 'reply' ? '/api/admin/agents/reply-templates' : '/api/admin/agents/templates';
                const resp = await fetch(apiPath, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ agent_id: agentId, name, content, enabled: true })
                });
                if (!resp.ok) throw new Error('create_template_failed');
                showNotification('模板已新增', 'success');
                document.getElementById('agent-template-new-name').value = '';
                document.getElementById('agent-template-new-content').value = '';
                await loadAgentTemplates();
                loadAgentConfigs();
            } catch (e) {
                showNotification('模板新增失败', 'error');
            }
        }

        async function saveAgentTemplate(id) {
            const payload = {
                name: String(document.getElementById(`tpl-name-${id}`)?.value || '').trim(),
                content: String(document.getElementById(`tpl-content-${id}`)?.value || '').trim(),
                enabled: !!document.getElementById(`tpl-enabled-${id}`)?.checked
            };
            if (!payload.name) { showNotification('模板名称不能为空', 'warning'); return; }
            try {
                const token = localStorage.getItem('hrms_token');
                const apiPath = __AGENT_TEMPLATE_KIND === 'reply' ? '/api/admin/agents/reply-templates/' : '/api/admin/agents/templates/';
                const resp = await fetch(apiPath + encodeURIComponent(id), {
                    method: 'PUT',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!resp.ok) throw new Error('save_template_failed');
                showNotification('模板已保存', 'success');
                await loadAgentTemplates();
                loadAgentConfigs();
            } catch (e) {
                showNotification('模板保存失败', 'error');
            }
        }

        async function deleteAgentTemplate(id) {
            const _okTpl = await hrmsConfirm({ title: '删除模板', message: '确定删除该模板？此操作不可恢复。', okText: '确认删除', icon: '🗑️' });
            if (!_okTpl) return;
            try {
                const token = localStorage.getItem('hrms_token');
                const apiPath = __AGENT_TEMPLATE_KIND === 'reply' ? '/api/admin/agents/reply-templates/' : '/api/admin/agents/templates/';
                const resp = await fetch(apiPath + encodeURIComponent(id), {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) throw new Error('delete_template_failed');
                showNotification('模板已删除', 'success');
                await loadAgentTemplates();
                loadAgentConfigs();
            } catch (e) {
                showNotification('模板删除失败（可能模板正在使用）', 'error');
            }
        }

        // ─── HR评级：维度预设模板 ───
        const HR_DIMENSION_PRESETS = [
            { id: 'closing_missing', category: '执行力', label: '收档缺失次数', unit: '次', direction: 'lower_better', defaultThresholds: { A: 0, B: 1, C: 3, D: 5 } },
            { id: 'opening_missing', category: '执行力', label: '开档缺失次数', unit: '次', direction: 'lower_better', defaultThresholds: { A: 0, B: 1, C: 3, D: 5 } },
            { id: 'wechat_members', category: '执行力', label: '企微会员月新增', unit: '人', direction: 'higher_better', defaultThresholds: { A: 200, B: 150, C: 100, D: 50 } },
            { id: 'meeting_missing', category: '执行力', label: '例会缺失次数', unit: '次', direction: 'lower_better', defaultThresholds: { A: 0, B: 1, C: 2, D: 3 } },
            { id: 'meeting_low_score', category: '执行力', label: '例会低分次数', unit: '次', direction: 'lower_better', defaultThresholds: { A: 0, B: 1, C: 2, D: 3 } },
            { id: 'margin_diff', category: '工作能力', label: '毛利率差值(实际-目标)', unit: '%', direction: 'higher_better', defaultThresholds: { A: 2, B: 0, C: -2, D: -5 } },
            { id: 'dianping_rating', category: '工作能力', label: '大众点评星级', unit: '分', direction: 'higher_better', defaultThresholds: { A: 4.5, B: 4.2, C: 4.0, D: 3.5 } },
            { id: 'revenue_achieve', category: '工作能力', label: '营收达成率', unit: '%', direction: 'higher_better', defaultThresholds: { A: 95, B: 90, C: 85, D: 70 } },
            { id: 'task_incomplete', category: '工作态度', label: '未完成任务次数', unit: '次', direction: 'lower_better', defaultThresholds: { A: 0, B: 1, C: 3, D: 5 } },
            { id: 'task_timeout', category: '工作态度', label: '任务超时次数', unit: '次', direction: 'lower_better', defaultThresholds: { A: 0, B: 2, C: 4, D: 6 } },
            { id: 'checklist_score', category: '工作能力', label: '检查表平均得分', unit: '分', direction: 'higher_better', defaultThresholds: { A: 90, B: 80, C: 70, D: 60 } },
            { id: 'bad_review_count', category: '工作能力', label: '差评数量', unit: '条', direction: 'lower_better', defaultThresholds: { A: 0, B: 1, C: 3, D: 5 } }
        ];
        const HR_WEIGHT_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 50];
        let __HR_RATING_FULL_CONFIG = {};
        let __HR_RATING_CURRENT_DIMS = [];

        async function loadHrEmployeeRatingConfig() {
            try {
                const token = localStorage.getItem('hrms_token');
                // 并行加载评级配置和门店列表
                const [ratingResp, storesResp, stateResp] = await Promise.all([
                    fetch('/api/admin/hr/employee-rating-config', { headers: { 'Authorization': 'Bearer ' + token } }),
                    fetch('/api/stores', { headers: { 'Authorization': 'Bearer ' + token } }).catch(() => null),
                    fetch('/api/state', { headers: { 'Authorization': 'Bearer ' + token } }).catch(() => null)
                ]);
                if (!ratingResp.ok) throw new Error('load_hr_rating_failed');
                const data = await ratingResp.json();
                __HR_RATING_FULL_CONFIG = data?.config || {};
                // 填充门店下拉 - 从多个来源获取门店列表
                const storeSel = document.getElementById('hr-rating-store');
                if (storeSel) {
                    const stores = [];
                    const addStore = (n) => { const s = String(n || '').trim(); if (s && !stores.includes(s)) stores.push(s); };
                    // 来源1: /api/stores → {items:[{name:...}]}
                    try {
                        if (storesResp?.ok) {
                            const sd = await storesResp.json();
                            const storeList = Array.isArray(sd?.items) ? sd.items : (Array.isArray(sd) ? sd : (Array.isArray(sd?.stores) ? sd.stores : []));
                            storeList.forEach(s => addStore(typeof s === 'string' ? s : s?.name));
                        }
                    } catch (e) {}
                    // 来源2: /api/state → {data:{stores:["name1","name2"], employees:[{store:"..."}]}}
                    try {
                        if (stateResp?.ok) {
                            const stateData = await stateResp.json();
                            const st = stateData?.data || stateData || {};
                            const rawStores = st?.stores || {};
                            if (Array.isArray(rawStores)) rawStores.forEach(s => addStore(typeof s === 'string' ? s : s?.name));
                            else Object.values(rawStores).forEach(s => addStore(typeof s === 'string' ? s : s?.name));
                            (Array.isArray(st?.employees) ? st.employees : []).forEach(e => addStore(e?.store));
                        }
                    } catch (e) {}
                    // 来源3: 本地 hrmsState / HRMS_STORE
                    try {
                        const state = typeof hrmsState !== 'undefined' ? hrmsState : (typeof HRMS_STORE !== 'undefined' ? HRMS_STORE.ensure() : {});
                        const ls = state?.stores || {};
                        if (Array.isArray(ls)) ls.forEach(s => addStore(typeof s === 'string' ? s : s?.name));
                        else Object.values(ls).forEach(s => addStore(typeof s === 'string' ? s : s?.name));
                        (Array.isArray(state?.employees) ? state.employees : []).forEach(e => addStore(e?.store));
                    } catch (e) {}
                    storeSel.innerHTML = '<option value="">请选择门店</option>' + stores.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
                    if (!stores.length) {
                        storeSel.innerHTML = '<option value="">暂无门店数据（请先在员工管理中添加门店）</option>';
                    }
                }
            } catch (e) {
                showNotification('HR评级配置加载失败', 'error');
            }
        }

        function onHrRatingStoreRoleChange() {
            const store = String(document.getElementById('hr-rating-store')?.value || '').trim();
            const role = String(document.getElementById('hr-rating-role')?.value || '').trim();
            const area = document.getElementById('hr-rating-dims-area');
            if (!store || !role) { if (area) area.style.display = 'none'; return; }
            if (area) area.style.display = '';
            const storeKey = store;
            const dims = __HR_RATING_FULL_CONFIG?.storeRoles?.[storeKey]?.[role]?.dimensions || [];
            __HR_RATING_CURRENT_DIMS = dims.length ? JSON.parse(JSON.stringify(dims)) : [];
            renderHrRatingDims();
        }

        function renderHrRatingDims() {
            const list = document.getElementById('hr-rating-dims-list');
            const empty = document.getElementById('hr-rating-dims-empty');
            if (!list) return;
            if (!__HR_RATING_CURRENT_DIMS.length) {
                list.innerHTML = '';
                if (empty) empty.style.display = '';
                return;
            }
            if (empty) empty.style.display = 'none';
            list.innerHTML = __HR_RATING_CURRENT_DIMS.map((dim, i) => {
                const preset = HR_DIMENSION_PRESETS.find(p => p.id === dim.metricId) || {};
                const dir = dim.direction || preset.direction || 'lower_better';
                const dirLabel = dir === 'higher_better' ? '越高越好 ↑' : '越低越好 ↓';
                const catLabel = dim.category || preset.category || '';
                const weightOpts = HR_WEIGHT_OPTIONS.map(w => `<option value="${w}" ${Number(dim.weight) === w ? 'selected' : ''}>${w}%</option>`).join('');
                const metricOpts = HR_DIMENSION_PRESETS.map(p => `<option value="${p.id}" ${dim.metricId === p.id ? 'selected' : ''}>[${p.category}] ${p.label}</option>`).join('');
                return `<div class="acm-card" style="position:relative;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="background:rgba(99,102,241,0.15);color:#818cf8;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;">${escapeHtml(catLabel)}</span>
                            <span style="font-size:13px;font-weight:700;color:#e2e8f0;">${escapeHtml(dim.label || preset.label || '')}</span>
                        </div>
                        <button data-click="removeHrRatingDim" data-arg="${i}" data-arg-type="number" style="background:none;border:none;color:#ef4444;font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
                        <div>
                            <label class="acm-lbl">评估指标</label>
                            <select class="acm-inp acm-inp-sm" data-change="updateHrDimMetric" data-arg="${i}" data-arg-type="number" data-pass-value>${metricOpts}</select>
                        </div>
                        <div>
                            <label class="acm-lbl">权重</label>
                            <select class="acm-inp acm-inp-sm" data-change="hrmsSetHrRatingDimWeight" data-arg="${i}" data-arg-type="number" data-pass-number>${weightOpts}</select>
                        </div>
                    </div>
                    <div style="font-size:11px;color:#64748b;margin-bottom:6px;">ABCD 评级阈值 <span style="color:#818cf8;">(${dirLabel})</span></div>
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                        <div style="text-align:center;">
                            <span class="acm-badge acm-ba" style="display:inline-block;margin-bottom:4px;">A</span>
                            <input type="number" step="any" class="acm-inp acm-inp-sm" value="${dim.thresholds?.A ?? ''}" data-change="hrmsSetHrRatingDimThreshold" data-arg="${i}" data-arg-type="number" data-arg2="A" data-pass-number placeholder="${dir === 'higher_better' ? '≥' : '≤'}">
                        </div>
                        <div style="text-align:center;">
                            <span class="acm-badge acm-bb" style="display:inline-block;margin-bottom:4px;">B</span>
                            <input type="number" step="any" class="acm-inp acm-inp-sm" value="${dim.thresholds?.B ?? ''}" data-change="hrmsSetHrRatingDimThreshold" data-arg="${i}" data-arg-type="number" data-arg2="B" data-pass-number placeholder="${dir === 'higher_better' ? '≥' : '≤'}">
                        </div>
                        <div style="text-align:center;">
                            <span class="acm-badge acm-bc" style="display:inline-block;margin-bottom:4px;">C</span>
                            <input type="number" step="any" class="acm-inp acm-inp-sm" value="${dim.thresholds?.C ?? ''}" data-change="hrmsSetHrRatingDimThreshold" data-arg="${i}" data-arg-type="number" data-arg2="C" data-pass-number placeholder="${dir === 'higher_better' ? '≥' : '≤'}">
                        </div>
                        <div style="text-align:center;">
                            <span class="acm-badge" style="background:#ef4444;display:inline-block;margin-bottom:4px;">D</span>
                            <input type="number" step="any" class="acm-inp acm-inp-sm" value="${dim.thresholds?.D ?? ''}" data-change="hrmsSetHrRatingDimThreshold" data-arg="${i}" data-arg-type="number" data-arg2="D" data-pass-number placeholder="${dir === 'higher_better' ? '<' : '>'}">
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        function addHrRatingDimension() {
            const store = String(document.getElementById('hr-rating-store')?.value || '').trim();
            const role = String(document.getElementById('hr-rating-role')?.value || '').trim();
            if (!store || !role) { showNotification('请先选择门店和岗位', 'warning'); return; }
            const usedIds = new Set(__HR_RATING_CURRENT_DIMS.map(d => d.metricId));
            const available = HR_DIMENSION_PRESETS.filter(p => !usedIds.has(p.id));
            if (!available.length) { showNotification('所有预设维度均已添加', 'warning'); return; }
            const preset = available[0];
            __HR_RATING_CURRENT_DIMS.push({
                metricId: preset.id,
                category: preset.category,
                label: preset.label,
                unit: preset.unit,
                direction: preset.direction,
                weight: 25,
                thresholds: { ...preset.defaultThresholds }
            });
            renderHrRatingDims();
        }

        function removeHrRatingDim(index) {
            __HR_RATING_CURRENT_DIMS.splice(index, 1);
            renderHrRatingDims();
        }

        function updateHrDimMetric(index, metricId) {
            const preset = HR_DIMENSION_PRESETS.find(p => p.id === metricId);
            if (!preset) return;
            const dim = __HR_RATING_CURRENT_DIMS[index];
            dim.metricId = preset.id;
            dim.category = preset.category;
            dim.label = preset.label;
            dim.unit = preset.unit;
            dim.direction = preset.direction;
            dim.thresholds = { ...preset.defaultThresholds };
            renderHrRatingDims();
        }

        function copyHrRatingToOtherStore() {
            const store = String(document.getElementById('hr-rating-store')?.value || '').trim();
            const role = String(document.getElementById('hr-rating-role')?.value || '').trim();
            if (!store || !role || !__HR_RATING_CURRENT_DIMS.length) { showNotification('请先配置当前门店的维度', 'warning'); return; }
            const storeSel = document.getElementById('hr-rating-store');
            const allStores = Array.from(storeSel?.options || []).map(o => o.value).filter(v => v && v !== store);
            if (!allStores.length) { showNotification('没有其他门店可复制', 'warning'); return; }
            const target = prompt('复制到哪个门店？可选：' + allStores.join('、'));
            if (!target || !allStores.includes(target)) { showNotification('门店名称不匹配', 'warning'); return; }
            if (!__HR_RATING_FULL_CONFIG.storeRoles) __HR_RATING_FULL_CONFIG.storeRoles = {};
            if (!__HR_RATING_FULL_CONFIG.storeRoles[target]) __HR_RATING_FULL_CONFIG.storeRoles[target] = {};
            __HR_RATING_FULL_CONFIG.storeRoles[target][role] = { dimensions: JSON.parse(JSON.stringify(__HR_RATING_CURRENT_DIMS)) };
            showNotification(`已复制到 ${target}·${role === 'store_manager' ? '店长' : '出品经理'}（需点击保存生效）`, 'success');
        }

        async function saveHrEmployeeRatingConfig() {
            const store = String(document.getElementById('hr-rating-store')?.value || '').trim();
            const role = String(document.getElementById('hr-rating-role')?.value || '').trim();
            if (!store || !role) { showNotification('请先选择门店和岗位', 'warning'); return; }
            // 校验权重
            const totalWeight = __HR_RATING_CURRENT_DIMS.reduce((s, d) => s + (Number(d.weight) || 0), 0);
            if (__HR_RATING_CURRENT_DIMS.length && totalWeight !== 100) {
                showNotification(`权重总和应为100%，当前为${totalWeight}%`, 'warning');
                return;
            }
            if (!__HR_RATING_FULL_CONFIG.storeRoles) __HR_RATING_FULL_CONFIG.storeRoles = {};
            if (!__HR_RATING_FULL_CONFIG.storeRoles[store]) __HR_RATING_FULL_CONFIG.storeRoles[store] = {};
            __HR_RATING_FULL_CONFIG.storeRoles[store][role] = { dimensions: JSON.parse(JSON.stringify(__HR_RATING_CURRENT_DIMS)) };
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/admin/hr/employee-rating-config', {
                    method: 'PUT',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ config: __HR_RATING_FULL_CONFIG, enabled: true })
                });
                if (!resp.ok) throw new Error('save_hr_rating_failed');
                showNotification(`${store}·${role === 'store_manager' ? '店长' : '出品经理'} 评级配置已保存`, 'success');
            } catch (e) {
                showNotification('HR评级配置保存失败', 'error');
            }
        }

        // ─── 绩效审核 ───
        function initPerformanceAuditMonthInput(inputId) {
            const el = document.getElementById(inputId);
            if (!el || el.value) return;
            const d = new Date();
            d.setDate(1);
            d.setMonth(d.getMonth() - 1);
            el.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }

        function getPerformanceAuditDom(prefix) {
            return {
                results: document.getElementById(prefix + 'results'),
                monthlyHint: document.getElementById(prefix + 'monthly-hint'),
                weeklyList: document.getElementById(prefix + 'weekly-list'),
                weeklyCount: document.getElementById(prefix + 'weekly-count'),
                dailyList: document.getElementById(prefix + 'daily-list'),
                dailyCount: document.getElementById(prefix + 'daily-count'),
                filingList: document.getElementById(prefix + 'filing-list'),
                filingCount: document.getElementById(prefix + 'filing-count'),
                invalidationList: document.getElementById(prefix + 'invalidation-list')
            };
        }

        async function loadPerformanceAuditRecords() {
            initPerformanceAuditMonthInput('perf-audit-period');
            const period = String(document.getElementById('perf-audit-period')?.value || '').trim();
            const username = String(document.getElementById('perf-audit-username')?.value || '').trim();
            if (!period) { showNotification('请选择统计月份', 'warning'); return; }
            const token = (typeof HRMS_API !== 'undefined' && HRMS_API && typeof HRMS_API.token === 'function')
                ? HRMS_API.token()
                : String(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '').trim();
            const params = new URLSearchParams({ period });
            if (username) params.set('username', username);
            try {
                const resp = await fetch('/api/admin/performance-records?' + params, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) { showNotification('查询失败（无权限或接口错误）', 'error'); return; }
                const data = await resp.json();
                if (!data.success) { showNotification(data.error || '查询失败', 'error'); return; }
                renderPerformanceAuditToDom(getPerformanceAuditDom('perf-audit-'), data.data, period, 'acm-empty');
            } catch (e) {
                showNotification('查询异常', 'error');
            }
        }

        function renderPerformanceAuditToDom(dom, data, period, emptyClassName) {
            const results = dom?.results;
            if (results) results.style.display = 'block';

            const monthly = dom?.monthlyHint;
            const emRows = data.employee_monthly_scores || [];
            if (monthly) {
                if (emRows.length) {
                    monthly.innerHTML = emRows.map((r) => {
                        const sc = r.total_score != null ? Number(r.total_score).toFixed(1) : '—';
                        return `<span style="display:block;margin-bottom:4px;"><strong>本月累计绩效（employee_scores）</strong> · ${escapeHtml(r.store || '—')} · ${escapeHtml(r.role || '—')}：<strong style="color:#fde68a;">${escapeHtml(sc)}</strong> 分（执行力 ${escapeHtml(r.execution_rating || '—')} · 态度 ${escapeHtml(r.attitude_rating || '—')} · 能力 ${escapeHtml(r.ability_rating || '—')}）</span>`;
                    }).join('');
                } else {
                    monthly.innerHTML = '<span style="color:#64748b;">未查到该统计月在 <code style="font-size:10px;">employee_scores</code> 中的月度汇总（可能未到关账日或尚未写入）。卡片上的「100 分」等为<strong>当周周度 BI 汇总行</strong>得分，与月度累计不同；最终绩效以月度汇总为准。填写账号后再次查询可核对本人月度行。</span>';
                }
            }

            const weeklyList = dom?.weeklyList;
            const weeklyCount = dom?.weeklyCount;
            const weeks = data.weekly_scores || [];
            if (weeklyCount) weeklyCount.textContent = weeks.length + ' 条';
            if (weeklyList) {
                if (!weeks.length) {
                    weeklyList.innerHTML = `<div class="${emptyClassName}">无周度扣分记录</div>`;
                } else {
                    weeklyList.innerHTML = weeks.map(w => {
                        const inv = w.is_invalidated;
                        const deductions = (() => {
                            try { const d = typeof w.deductions === 'string' ? JSON.parse(w.deductions) : w.deductions; return Array.isArray(d) ? d : []; } catch { return []; }
                        })();
                        const dedLines = deductions.filter(d => Number(d?.points || 0) > 0).map(d => `${escapeHtml(perfAuditDeductionLabelZh(d.category || d.reason || d.metric_key))} -${d.points}`).join('、');
                        const bgStyle = inv
                            ? 'background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);opacity:0.6;'
                            : 'background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.06);';
                        const scNum = Number(w.total_score);
                        const scDisp = (w.total_score !== null && w.total_score !== undefined && String(w.total_score).trim() !== '' && Number.isFinite(scNum))
                            ? scNum.toFixed(1)
                            : escapeHtml(String(w.total_score ?? '—'));
                        const scColor = Number.isFinite(scNum) && scNum < 100 ? '#fb923c' : '#22c55e';
                        return `<div style="padding:10px 12px;border-radius:8px;${bgStyle}">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                                <span style="font-size:13px;font-weight:600;color:#f1f5f9;">${escapeHtml(w.name || w.username)} <span style="color:#64748b;font-weight:400;">(${escapeHtml(w.username)})</span></span>
                                <span style="font-size:14px;font-weight:700;color:${scColor};">${scDisp}分</span>
                            </div>
                            <div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">${escapeHtml(w.period)} · ${escapeHtml(w.store)}</div>
                            ${dedLines ? `<div style="font-size:12px;color:#fb923c;margin-bottom:4px;">${dedLines}</div>` : ''}
                            ${inv ? '<div style="font-size:12px;color:#ef4444;font-weight:600;">已失效</div>' : `<button data-click="invalidatePerformanceRecord" data-arg="agent_scores_weekly" data-arg2="${escapeHtml(String(w.id))}" data-arg3="${escapeHtml(w.username)}" data-arg4="${escapeHtml(w.store || '')}" data-arg5="${escapeHtml(period)}" style="margin-top:6px;font-size:12px;padding:4px 12px;border-radius:6px;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);cursor:pointer;">标记失效</button>`}
                        </div>`;
                    }).join('');
                }
            }

            const dailyList = dom?.dailyList;
            const dailyCount = dom?.dailyCount;
            const dailyRows = data.daily_bi_triggers || [];
            if (dailyCount) dailyCount.textContent = dailyRows.length + ' 条';
            if (dailyList) {
                if (!dailyRows.length) {
                    dailyList.innerHTML = `<div class="${emptyClassName}">本月无 BI 按日触发记录（或请先输入账号以按门店过滤）</div>`;
                } else {
                    dailyList.innerHTML = dailyRows.map((r) => {
                        const dt = r.trigger_date ? escapeHtml(String(r.trigger_date)) : '—';
                        const sev = escapeHtml(dcDeductionSeverityZh(r.severity));
                        const st = escapeHtml(String(r.status || '—'));
                        const ak = escapeHtml(dcDeductionAnomalyKeyZh(r.anomaly_key));
                        return `<div style="padding:8px 10px;border-radius:8px;background:rgba(30,41,59,0.45);border:1px solid rgba(255,255,255,0.06);font-size:12px;color:#cbd5e1;">
                            <div style="display:flex;justify-content:space-between;gap:8px;"><span style="font-weight:600;color:#e2e8f0;">${dt}</span><span style="color:#64748b;">${sev} · ${st}</span></div>
                            <div style="margin-top:4px;color:#94a3b8;">${escapeHtml(r.store || '')} · ${ak}</div>
                        </div>`;
                    }).join('');
                }
            }

            // Filings
            const filingList = dom?.filingList;
            const filingCount = dom?.filingCount;
            const filings = data.filings || [];
            if (filingCount) filingCount.textContent = filings.length + ' 条';
            if (filingList) {
                if (!filings.length) {
                    filingList.innerHTML = `<div class="${emptyClassName}">无备案记录</div>`;
                } else {
                    filingList.innerHTML = filings.map(f => {
                        const inv = f.is_invalidated;
                        const bgStyle = inv
                            ? 'background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);opacity:0.6;'
                            : 'background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.06);';
                        const dt = f.dispatched_at ? new Date(f.dispatched_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
                        const dispName = String(f.assignee_name || f.name || '').trim();
                        const who = dispName && dispName !== f.assignee_username
                            ? `${escapeHtml(dispName)}（${escapeHtml(f.assignee_username || '')}）`
                            : `${escapeHtml(f.assignee_username || dispName || '—')}`;
                        return `<div style="padding:10px 12px;border-radius:8px;${bgStyle}">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                                <span style="font-size:13px;font-weight:600;color:#f1f5f9;">${who}</span>
                                <span style="font-size:11px;color:#64748b;">${escapeHtml(perfAuditMasterSourceZh(f.source))}</span>
                            </div>
                            <div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">${escapeHtml(f.title || f.category || '')}</div>
                            <div style="font-size:11px;color:#64748b;margin-bottom:4px;">${dt} · ${escapeHtml(f.store || '')}</div>
                            ${inv ? '<div style="font-size:12px;color:#ef4444;font-weight:600;">已失效</div>' : `<button data-click="invalidatePerformanceRecord" data-arg="master_tasks_filing" data-arg2="${escapeHtml(f.task_id)}" data-arg3="${escapeHtml(f.assignee_username || '')}" data-arg4="${escapeHtml(f.store || '')}" data-arg5="${period}" style="margin-top:6px;font-size:12px;padding:4px 12px;border-radius:6px;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);cursor:pointer;">标记失效</button>`}
                        </div>`;
                    }).join('');
                }
            }

            // Invalidation history
            const invList = dom?.invalidationList;
            const invs = data.invalidations || [];
            if (invList) {
                if (!invs.length) {
                    invList.innerHTML = `<div class="${emptyClassName}">无失效操作记录</div>`;
                } else {
                    invList.innerHTML = invs.map(iv => {
                        const dt = iv.invalidated_at ? new Date(iv.invalidated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
                        const srcLabel = iv.source_type === 'agent_scores_weekly' ? '周度扣分' : iv.source_type === 'master_tasks_filing' ? '备案记录' : iv.source_type;
                        return `<div style="padding:8px 12px;border-radius:8px;background:rgba(30,41,59,0.3);border:1px solid rgba(255,255,255,0.04);">
                            <span style="font-size:12px;color:#f87171;font-weight:600;">已失效</span>
                            <span style="font-size:12px;color:#94a3b8;margin-left:6px;">${srcLabel}</span>
                            <span style="font-size:12px;color:#64748b;margin-left:6px;">${escapeHtml(iv.username || '')} · ${escapeHtml(iv.source_id || '')}</span>
                            <span style="font-size:11px;color:#475569;margin-left:8px;">${dt} · by ${escapeHtml(iv.invalidated_by || '')}</span>
                        </div>`;
                    }).join('');
                }
            }
        }

        async function loadDataCenterPerformanceAuditRecords() {
            initPerformanceAuditMonthInput('dc-perf-audit-period');
            const period = String(document.getElementById('dc-perf-audit-period')?.value || '').trim();
            const username = String(document.getElementById('dc-perf-audit-username')?.value || '').trim();
            if (!period) { showNotification('请选择统计月份', 'warning'); return; }
            const token = (typeof HRMS_API !== 'undefined' && HRMS_API && typeof HRMS_API.token === 'function')
                ? HRMS_API.token()
                : String(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '').trim();
            const params = new URLSearchParams({ period });
            if (username) params.set('username', username);
            try {
                const resp = await fetch('/api/admin/performance-records?' + params, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) { showNotification('查询失败（无权限或接口错误）', 'error'); return; }
                const data = await resp.json();
                if (!data.success) { showNotification(data.error || '查询失败', 'error'); return; }
                renderPerformanceAuditToDom(getPerformanceAuditDom('dc-perf-audit-'), data.data, period, 'acm-empty');
            } catch (e) {
                showNotification('查询异常', 'error');
            }
        }

        async function invalidatePerformanceRecord(sourceType, sourceId, username, store, period) {
            if (!confirm(`确认失效该记录？\n\n类型：${sourceType === 'agent_scores_weekly' ? '周度扣分' : '备案记录'}\n员工：${username}\n\n失效后系统将自动重新计算绩效并通知变更。`)) return;
            const token = (typeof HRMS_API !== 'undefined' && HRMS_API && typeof HRMS_API.token === 'function')
                ? HRMS_API.token()
                : String(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '').trim();
            try {
                const resp = await fetch('/api/admin/performance-invalidate', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source_type: sourceType, source_id: sourceId, username, store, period })
                });
                const data = await resp.json();
                if (data.success) {
                    const msg = data.data?.changed
                        ? `已失效。绩效得分：${data.data.before?.total_score ?? '—'} → ${data.data.after?.total_score ?? '—'}`
                        : '已失效，得分无变化。';
                    showNotification(msg, 'success');
                    loadPerformanceAuditRecords();
                    loadDataCenterPerformanceAuditRecords();
                } else {
                    showNotification(data.error || data.message || '操作失败', 'error');
                }
            } catch (e) {
                showNotification('操作异常', 'error');
            }
        }

        async function loadAgentConfigs() {
            const box = document.getElementById('agent-configs-list');
            if (!box) return;
            box.innerHTML = '<div class="acm-empty">加载中…</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetchWithAgentAbort('agent_configs', '/api/admin/agents/configs', { headers: { 'Authorization': 'Bearer ' + token } });
                if (!resp.ok) {
                    box.innerHTML = '<div class="acm-empty" style="color:#f87171;">无权限或接口不可用</div>';
                    return;
                }
                const data = await resp.json();
                __AGENT_CONFIGS = Array.isArray(data?.configs) ? data.configs : [];
                await ensureAgentTemplateMaps();
                if (!__AGENT_CONFIGS.length) {
                    box.innerHTML = '<div class="acm-empty">暂无配置</div>';
                    return;
                }
                box.innerHTML = __AGENT_CONFIGS.map((c) => `
                    <div class="acm-card">
                        <div class="acm-card-hd">
                            <div class="acm-card-title">${escapeHtml(c.name || c.agent_id || '')}</div>
                            <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:#64748b;flex-shrink:0;">
                                <input type="checkbox" id="cfg-enabled-${escapeHtml(c.agent_id)}" ${c.enabled ? 'checked' : ''} style="accent-color:#6366f1;"> 启用
                            </label>
                        </div>
                        <div style="font-size:11px;color:#334155;margin-bottom:10px;">${escapeHtml(c.agent_id || '')}</div>
                        <div style="display:flex;flex-direction:column;gap:8px;">
                            <div>
                                <label class="acm-lbl">模型名称</label>
                                ${getAgentModelSelectHtml(c.agent_id, c.model_name || '')}
                            </div>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                                <div>
                                    <label class="acm-lbl">Temperature</label>
                                    <input id="cfg-temp-${escapeHtml(c.agent_id)}" value="${escapeHtml(String(c.temperature ?? '0.1'))}" placeholder="0.1" class="acm-inp acm-inp-sm" type="number" step="0.1" min="0" max="2">
                                </div>
                                <div>
                                    <label class="acm-lbl">调度间隔（分钟）</label>
                                    <input id="cfg-interval-${escapeHtml(c.agent_id)}" value="${escapeHtml(String(c.schedule_interval ?? '0'))}" placeholder="0" class="acm-inp acm-inp-sm" type="number" min="0">
                                </div>
                            </div>
                            <div>
                                <label class="acm-lbl">提示词模板</label>
                                <div style="display:flex;gap:8px;align-items:center;">
                                    <select id="cfg-template-${escapeHtml(c.agent_id)}" data-change="onConfigTemplateChange" data-arg="${escapeHtml(c.agent_id)}" class="acm-inp acm-inp-sm" style="flex:1;">
                                        <option value="">手动提示词</option>
                                        ${(Array.isArray(__AGENT_TEMPLATE_MAP?.[c.agent_id]) ? __AGENT_TEMPLATE_MAP[c.agent_id] : []).map((t) => `<option value="${escapeHtml(t.id)}" ${String(c.prompt_template_id || '') === String(t.id || '') ? 'selected' : ''}>${escapeHtml(t.name || '')}${t.is_builtin ? '（系统）' : ''}</option>`).join('')}
                                    </select>
                                    <button class="acm-add-btn" data-click="hrmsSwitchAgentTemplates" data-arg="prompt" style="white-space:nowrap;">管理模板</button>
                                </div>
                            </div>
                            <div>
                                <label class="acm-lbl">回复模板</label>
                                <div style="display:flex;gap:8px;align-items:center;">
                                    <select id="cfg-reply-template-${escapeHtml(c.agent_id)}" class="acm-inp acm-inp-sm" style="flex:1;">
                                        <option value="">不指定</option>
                                        ${(Array.isArray(__AGENT_REPLY_TEMPLATE_MAP?.[c.agent_id]) ? __AGENT_REPLY_TEMPLATE_MAP[c.agent_id] : []).map((t) => `<option value="${escapeHtml(t.id)}" ${String(c.reply_template_id || '') === String(t.id || '') ? 'selected' : ''}>${escapeHtml(t.name || '')}${t.is_builtin ? '（系统）' : ''}</option>`).join('')}
                                    </select>
                                    <button class="acm-add-btn" data-click="hrmsSwitchAgentTemplates" data-arg="reply" style="white-space:nowrap;">管理模板</button>
                                </div>
                            </div>
                            <div>
                                <label class="acm-lbl">系统提示词</label>
                                <textarea id="cfg-prompt-${escapeHtml(c.agent_id)}" class="acm-inp" style="min-height:80px;resize:vertical;">${escapeHtml(c.system_prompt || '')}</textarea>
                            </div>
                        </div>
                        <button class="acm-save" data-click="saveAgentConfig" data-arg="${escapeHtml(c.agent_id)}" style="margin-top:12px;">保存配置</button>
                    </div>
                `).join('');
            } catch (e) {
                if (String(e?.name || '') === 'AbortError') return;
                box.innerHTML = '<div class="acm-empty" style="color:#f87171;">加载失败</div>';
            }
        }

        function onConfigTemplateChange(agentId) {
            const tplId = String(document.getElementById(`cfg-template-${agentId}`)?.value || '').trim();
            if (!tplId) return;
            const t = (__AGENT_TEMPLATES || []).find((x) => String(x.id) === tplId);
            if (!t) return;
            const promptEl = document.getElementById(`cfg-prompt-${agentId}`);
            if (promptEl) promptEl.value = String(t.content || '');
        }

        async function saveAgentConfig(agentId) {
            try {
                const token = localStorage.getItem('hrms_token');
                const selectedModel = String(document.getElementById(`cfg-model-${agentId}`)?.value || '').trim();
                if (!AGENT_MODEL_OPTIONS.includes(selectedModel)) {
                    showNotification('仅允许 deepseek / qwen / doubao 模型', 'error');
                    return;
                }
                const payload = {
                    enabled: !!document.getElementById(`cfg-enabled-${agentId}`)?.checked,
                    model_name: selectedModel,
                    temperature: Number(document.getElementById(`cfg-temp-${agentId}`)?.value || 0.1),
                    schedule_interval: Number(document.getElementById(`cfg-interval-${agentId}`)?.value || 0),
                    system_prompt: String(document.getElementById(`cfg-prompt-${agentId}`)?.value || '').trim(),
                    prompt_template_id: String(document.getElementById(`cfg-template-${agentId}`)?.value || '').trim() || null,
                    reply_template_id: String(document.getElementById(`cfg-reply-template-${agentId}`)?.value || '').trim() || null
                };
                const resp = await fetch('/api/admin/agents/configs/' + encodeURIComponent(agentId), {
                    method: 'PUT',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!resp.ok) throw new Error('save_failed');
                showNotification('Agent 配置已保存', 'success');
                loadAgentConfigs();
            } catch (e) {
                showNotification('保存失败', 'error');
            }
        }

        async function loadAgentRules() {
            const list = document.getElementById('agent-rules-card-list');
            if (!list) return;
            list.innerHTML = '<div class="acm-empty">加载中…</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetchWithAgentAbort('agent_rules', '/api/admin/agents/rules', { headers: { 'Authorization': 'Bearer ' + token } });
                if (!resp.ok) {
                    list.innerHTML = '<div class="acm-empty" style="color:#f87171;">无权限或接口不可用</div>';
                    return;
                }
                const data = await resp.json();
                __AGENT_RULES = Array.isArray(data?.rules) ? data.rules : [];
                syncRuleCategoryOptions();
                if (!__AGENT_RULES.length) {
                    list.innerHTML = '<div class="acm-empty">暂无规则，点击「+ 新增规则」添加</div>';
                    return;
                }
                const roleLabel = { store_manager: '店长', store_production_manager: '出品经理' };
                list.innerHTML = __AGENT_RULES.map((r) => `
                    <div class="acm-rule-row">
                        <div class="acm-rule-info">
                            <div class="acm-rule-cat">${escapeHtml(r.category || '')}</div>
                            <div class="acm-rule-meta">${roleLabel[r.assignee_role] || escapeHtml(r.assignee_role || '')} · ${r.enabled ? '启用' : '<span style="color:#f87171">停用</span>'}</div>
                        </div>
                        <span class="acm-rule-deduct">中-${Number(r.normal_deduction||0)} / 重-${Number(r.major_deduction||0)}</span>
                        <button class="acm-edit-btn" data-click="openAgentRuleEditor" data-arg="${escapeHtml(String(r.id))}">编辑</button>
                    </div>
                `).join('');
            } catch (e) {
                if (String(e?.name || '') === 'AbortError') return;
                list.innerHTML = '<div class="acm-empty" style="color:#f87171;">加载失败</div>';
            }
        }

        function openAgentRuleEditor(ruleId) {
            const modal = document.getElementById('agent-rule-modal');
            if (!modal) return;
            const row = __AGENT_RULES.find((x) => String(x.id) === String(ruleId)) || null;
            syncRuleCategoryOptions(row?.category || '');
            document.getElementById('rule-id').value = row?.id || '';
            document.getElementById('rule-category').value = row?.category || '';
            document.getElementById('rule-role').value = row?.assignee_role || 'store_manager';
            document.getElementById('rule-normal').value = Number(row?.normal_deduction || 5);
            document.getElementById('rule-major').value = Number(row?.major_deduction || 10);
            document.getElementById('rule-enabled').checked = row?.enabled !== false;
            modal.style.display = '';
            modal.classList.add('show');
        }

        function closeAgentRuleModal() {
            const modal = document.getElementById('agent-rule-modal');
            if (!modal) return;
            modal.classList.remove('show');
            modal.style.display = '';
        }

        async function saveAgentRule() {
            const id = String(document.getElementById('rule-id')?.value || '').trim();
            const payload = {
                category: String(document.getElementById('rule-category')?.value || '').trim(),
                assignee_role: String(document.getElementById('rule-role')?.value || 'store_manager').trim(),
                normal_deduction: Number(document.getElementById('rule-normal')?.value || 5),
                major_deduction: Number(document.getElementById('rule-major')?.value || 10),
                enabled: !!document.getElementById('rule-enabled')?.checked
            };
            if (!payload.category) { showNotification('请填写异常类型', 'warning'); return; }
            try {
                const token = localStorage.getItem('hrms_token');
                const isNew = !id;
                const resp = await fetch(isNew ? '/api/admin/agents/rules' : ('/api/admin/agents/rules/' + encodeURIComponent(id)), {
                    method: isNew ? 'POST' : 'PUT',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!resp.ok) throw new Error('save_rule_failed');
                showNotification('规则已保存', 'success');
                closeAgentRuleModal();
                loadAgentRules();
            } catch (e) {
                showNotification('规则保存失败', 'error');
            }
        }

        function switchAmTab(tab) {
            const tabs = ['overview', 'issues', 'scores', 'audits', 'messages', 'users'];
            tabs.forEach(t => {
                const panel = document.getElementById('am-tab-' + t);
                const btn = document.querySelector(`.am-nav-btn[data-tab="${t}"]`);
                if (panel) panel.style.display = t === tab ? '' : 'none';
                if (btn) { btn.classList.toggle('active', t === tab); }
            });
            if (tab === 'overview') loadAmDashboard();
            if (tab === 'issues') loadAmIssues();
            if (tab === 'scores') loadAmScores();
            if (tab === 'audits') loadAmAudits();
            if (tab === 'messages') loadAmMessages();
            if (tab === 'users') loadAmUsers();
        }

        function formatAmTime(v) {
            const s = String(v || '').trim();
            if (!s) return '-';
            try { const d = new Date(s); if (!Number.isFinite(d.getTime())) return s; return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch(e) { return s; }
        }

        async function loadAmDashboard() {
            const box = document.getElementById('am-dashboard');
            const actionsBox = document.getElementById('am-admin-actions');
            if (!box) return;
            box.innerHTML = '<div class="am-stat-card" style="grid-column:1/-1; text-align:center;">加载中...</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/dashboard', { headers: { 'Authorization': 'Bearer ' + token } });
                if (!resp.ok) { box.innerHTML = '<div class="am-stat-card" style="grid-column:1/-1; text-align:center;">需要管理员权限</div>'; if (actionsBox) actionsBox.innerHTML = ''; return; }
                const d = await resp.json();

                const issuesResp = await fetch('/api/agents/issues?limit=300', { headers: { 'Authorization': 'Bearer ' + token } }).catch(() => null);
                const issuesData = issuesResp && issuesResp.ok ? await issuesResp.json() : { items: [] };
                const issues = (Array.isArray(issuesData?.items) ? issuesData.items : []).filter(amItemMatchBrand);
                renderAmBrandCockpit(issues);

                box.innerHTML = `
                    <div class="am-stat-card">
                        <div class="am-stat-label">异常问题</div>
                        <div class="am-stat-value red">${__AM_BRAND_FILTER === 'all' ? (d.issues?.open || 0) : issues.filter(x => String(x?.status || '') !== 'resolved').length}</div>
                        <div class="am-stat-sub">高优 ${__AM_BRAND_FILTER === 'all' ? (d.issues?.high_open || 0) : issues.filter(x => String(x?.severity || '') === 'high' && String(x?.status || '') !== 'resolved').length} · 总 ${__AM_BRAND_FILTER === 'all' ? (d.issues?.total || 0) : issues.length}</div>
                    </div>
                    <div class="am-stat-card">
                        <div class="am-stat-label">平均绩效</div>
                        <div class="am-stat-value green">${d.scores?.avg_score || '-'}</div>
                        <div class="am-stat-sub">近30天 ${d.scores?.total || 0} 条</div>
                    </div>
                    <div class="am-stat-card">
                        <div class="am-stat-label">图片审核</div>
                        <div class="am-stat-value orange">${d.audits?.total || 0}</div>
                        <div class="am-stat-sub">不合格 ${d.audits?.failed || 0} · 重复 ${d.audits?.duplicates || 0}</div>
                    </div>
                    <div class="am-stat-card">
                        <div class="am-stat-label">飞书消息</div>
                        <div class="am-stat-value purple">${d.messages?.total_7d || 0}</div>
                        <div class="am-stat-sub">绑定 ${d.feishuUsers?.registered || 0}/${d.feishuUsers?.total || 0}</div>
                    </div>`;
                if (actionsBox && ['admin', 'hq_manager'].includes(currentUser?.role)) {
                    actionsBox.innerHTML = `
                        <button class="btn" data-click="triggerAmAudit">数据审计</button>
                        <button class="btn" data-click="triggerAmEval">绩效评估</button>`;
                } else if (actionsBox) { actionsBox.innerHTML = ''; }
            } catch (e) { box.innerHTML = '<div class="am-stat-card" style="grid-column:1/-1; text-align:center; color:#f87171;">加载失败</div>'; }
        }

        async function triggerAmAudit() {
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/run/audit', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
                const d = await resp.json();
                showNotification(`审计完成：发现 ${d.issuesFound || 0} 条，新增 ${d.issuesCreated || 0} 条，飞书推送 ${d.feishuPushed || 0} 条`, 'success');
                loadAmDashboard();
            } catch (e) { showNotification('审计触发失败', 'error'); }
        }

        async function triggerAmEval() {
            const now = new Date();
            const weekNum = Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7);
            const period = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/run/evaluate', {
                    method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ period })
                });
                const d = await resp.json();
                showNotification(`评估完成：${d.evaluated || 0} 人，飞书推送 ${d.feishuPushed || 0} 条`, 'success');
                loadAmDashboard();
            } catch (e) { showNotification('评估触发失败', 'error'); }
        }

        async function loadAmIssues() {
            const box = document.getElementById('am-issues-list');
            if (!box) return;
            box.innerHTML = '<div class="am-card" style="text-align:center;">加载中...</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/issues?limit=50', { headers: { 'Authorization': 'Bearer ' + token } });
                const data = await resp.json();
                const items = (Array.isArray(data?.items) ? data.items : []).filter(amItemMatchBrand);
                if (!items.length) { box.innerHTML = '<div class="am-card" style="text-align:center;">暂无异常记录</div>'; return; }
                box.innerHTML = items.map(i => {
                    const sev = i.severity === 'high' ? '!' : '-';
                    const statusBadge = i.status === 'resolved'
                        ? '<span class="am-badge green">已解决</span>'
                        : '<span class="am-badge red">待处理</span>';
                    const notified = i.feishu_notified ? '<span class="am-badge green">已推送</span>' : '<span class="am-badge gray">未推送</span>';
                    return `<div class="am-card">
                        <div class="am-card-header">
                            <div class="am-card-title">${sev} ${escapeHtml(i.title || '')}</div>
                            <div>${notified} ${statusBadge}</div>
                        </div>
                        <div class="am-card-meta">${escapeHtml(i.brand || '')} / ${escapeHtml(i.store || '')} · ${escapeHtml(i.category || '')} · ${formatAmTime(i.created_at)}${i.assignee_username ? ' · 指派: ' + escapeHtml(i.assignee_username) : ''}</div>
                        ${i.detail ? `<div class="am-card-detail">${escapeHtml(i.detail)}</div>` : ''}
                        ${i.status !== 'resolved' ? `<div class="am-resolve-row">
                            <input id="resolve-${i.id}" placeholder="整改说明...">
                            <button class="btn" data-click="resolveAmIssue" data-arg="${i.id}">解决</button>
                        </div>` : (i.resolution ? `<div class="am-card-detail" style="color:#4ade80;">✓ ${escapeHtml(i.resolution)}</div>` : '')}
                    </div>`;
                }).join('');
            } catch (e) { box.innerHTML = '<div class="am-card" style="text-align:center; color:#f87171;">加载失败</div>'; }
        }

        async function resolveAmIssue(id) {
            const input = document.getElementById('resolve-' + id);
            const resolution = String(input?.value || '').trim();
            if (!resolution) { showNotification('请输入整改说明', 'warning'); return; }
            try {
                const token = localStorage.getItem('hrms_token');
                await fetch('/api/agents/issues/' + id + '/resolve', {
                    method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resolution })
                });
                showNotification('已标记解决', 'success');
                loadAmIssues();
            } catch (e) { showNotification('操作失败', 'error'); }
        }

        async function loadAmScores() {
            const box = document.getElementById('am-scores-list');
            if (!box) return;
            box.innerHTML = '<div class="am-card" style="text-align:center;">加载中...</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/scores?limit=20', { headers: { 'Authorization': 'Bearer ' + token } });
                const data = await resp.json();
                const items = (Array.isArray(data?.items) ? data.items : []).filter(amItemMatchBrand);
                if (!items.length) { box.innerHTML = '<div class="am-card" style="text-align:center;">暂无绩效记录</div>'; return; }
                box.innerHTML = items.map(s => {
                    const breakdown = s.breakdown && typeof s.breakdown === 'object' ? s.breakdown : {};
                    const deductions = Array.isArray(s.deductions) ? s.deductions : [];
                    const scoreColor = s.total_score >= 80 ? 'green' : s.total_score >= 60 ? 'orange' : 'red';
                    return `<div class="am-card">
                        <div class="am-card-header">
                            <div class="am-card-title">${escapeHtml(s.store || '')}（${escapeHtml(s.brand || '')}）</div>
                            <div class="am-card-score ${scoreColor}">${s.total_score}</div>
                        </div>
                        <div class="am-card-meta">${escapeHtml(s.name || s.username || '')} · ${escapeHtml(s.period || '')}</div>
                        <div class="am-card-tags">
                            ${Object.entries(breakdown).map(([k,v]) => `<span class="am-tag">${escapeHtml(k)}: ${v}</span>`).join('')}
                        </div>
                        ${deductions.length ? `<div class="am-card-detail" style="color:#f87171;">扣分：${deductions.map(d => `${escapeHtml(d.category||'')}(${d.points})`).join('、')}</div>` : ''}
                        ${s.summary ? `<div class="am-card-detail">${escapeHtml(s.summary)}</div>` : ''}
                    </div>`;
                }).join('');
            } catch (e) { box.innerHTML = '<div class="am-card" style="text-align:center; color:#f87171;">加载失败</div>'; }
        }

        async function loadAmAudits() {
            const box = document.getElementById('am-audits-list');
            if (!box) return;
            box.innerHTML = '<div class="am-card" style="text-align:center;">加载中...</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/audits?limit=50', { headers: { 'Authorization': 'Bearer ' + token } });
                const data = await resp.json();
                const items = (Array.isArray(data?.items) ? data.items : []).filter(amItemMatchBrand);
                if (!items.length) { box.innerHTML = '<div class="am-card" style="text-align:center;">暂无审核记录</div>'; return; }
                box.innerHTML = items.map(a => {
                    const resultBadge = a.result === 'pass' ? '<span class="am-badge green">合格</span>' : a.result === 'fail' ? '<span class="am-badge red">不合格</span>' : '<span class="am-badge gray">待定</span>';
                    const conf = a.confidence ? `（${Math.round(a.confidence * 100)}%）` : '';
                    return `<div class="am-card">
                        <div class="am-card-header">
                            <div class="am-card-title">${a.audit_type || '通用'}审核</div>
                            ${resultBadge}
                        </div>
                        <div class="am-card-meta">${escapeHtml(a.store || '')} · ${escapeHtml(a.username || '')} · ${formatAmTime(a.created_at)}${a.duplicate_of ? ' · 重复' : ''}</div>
                        ${a.findings ? `<div class="am-card-detail">${escapeHtml(a.findings)}${conf}</div>` : ''}
                    </div>`;
                }).join('');
            } catch (e) { box.innerHTML = '<div class="am-card" style="text-align:center; color:#f87171;">加载失败</div>'; }
        }

        async function loadAmMessages() {
            const box = document.getElementById('am-messages-list');
            if (!box) return;
            box.innerHTML = '<div class="am-card" style="text-align:center;">加载中...</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/messages?limit=50', { headers: { 'Authorization': 'Bearer ' + token } });
                const data = await resp.json();
                const items = (Array.isArray(data?.items) ? data.items : []).filter(amItemMatchBrand);
                if (!items.length) { box.innerHTML = '<div class="am-card" style="text-align:center;">暂无消息记录</div>'; return; }
                const routeLabels = { data_auditor: '审计', ops_supervisor: '督导', chief_evaluator: '考核', appeal: '申诉', sop_advisor: 'SOP', general: '通用' };
                box.innerHTML = items.map(m => {
                    const dir = m.direction === 'out' ? '↑ 推送' : '↓ 收到';
                    const route = routeLabels[m.routed_to] || m.routed_to || '';
                    return `<div class="am-card">
                        <div class="am-card-header">
                            <div class="am-card-title">${dir} ${escapeHtml(m.sender_name || m.sender_username || '未知')}</div>
                            <span class="am-badge gray">${route}</span>
                        </div>
                        <div class="am-card-meta">${formatAmTime(m.created_at)}</div>
                        ${m.content ? `<div class="am-card-detail">${escapeHtml(String(m.content).slice(0, 150))}${String(m.content).length > 150 ? '...' : ''}</div>` : ''}
                        ${m.agent_response ? `<div class="am-card-detail" style="background:rgba(20,184,166,0.1); padding:8px; border-radius:6px; margin-top:6px; color:#14b8a6;">${escapeHtml(String(m.agent_response).slice(0, 200))}${String(m.agent_response).length > 200 ? '...' : ''}</div>` : ''}
                    </div>`;
                }).join('');
            } catch (e) { box.innerHTML = '<div class="am-card" style="text-align:center; color:#f87171;">加载失败</div>'; }
        }

        async function loadAmUsers() {
            const box = document.getElementById('am-users-list');
            if (!box) return;
            box.innerHTML = '<div class="am-card" style="text-align:center;">加载中...</div>';
            try {
                const token = localStorage.getItem('hrms_token');
                const resp = await fetch('/api/agents/feishu-users', { headers: { 'Authorization': 'Bearer ' + token } });
                if (!resp.ok) { box.innerHTML = '<div class="am-card" style="text-align:center;">需要管理员权限</div>'; return; }
                const data = await resp.json();
                const items = (Array.isArray(data?.items) ? data.items : []).filter(amItemMatchBrand);
                if (!items.length) { box.innerHTML = '<div class="am-card" style="text-align:center;">暂无飞书用户绑定</div>'; return; }
                box.innerHTML = items.map(u => {
                    const status = u.registered ? '<span class="am-badge green">已绑定</span>' : '<span class="am-badge red">待绑定</span>';
                    return `<div class="am-card">
                        <div class="am-card-header">
                            <div class="am-card-title">${escapeHtml(u.name || u.username || '未知')}</div>
                            ${status}
                        </div>
                        <div class="am-card-meta">${escapeHtml(u.username || '-')} · ${escapeHtml(u.store || '-')} · ${escapeHtml(u.role || '-')}</div>
                        <div class="am-card-detail" style="font-size:10px;">open_id: ${escapeHtml(String(u.open_id || '').slice(0, 20))}... · ${formatAmTime(u.created_at)}</div>
                    </div>`;
                }).join('');
            } catch (e) { box.innerHTML = '<div class="am-card" style="text-align:center; color:#f87171;">加载失败</div>'; }
        }

