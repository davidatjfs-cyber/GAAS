/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 12-files.js
 * lines: 34550-36214 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ==================== 文件管理功能 ====================
        let currentFilesPage = 1;
        const filesPerPage = 20;

        async function loadFilesList(page = 1) {
            try {
                currentFilesPage = page;
                const filters = {
                    type: document.getElementById('file-filter-type')?.value || '',
                    store: document.getElementById('file-filter-store')?.value || '',
                    validation_status: document.getElementById('file-filter-validation')?.value || '',
                    uploader: document.getElementById('file-filter-uploader')?.value || ''
                };

                const params = new URLSearchParams({
                    page: page,
                    limit: filesPerPage,
                    ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
                });

                const res = await fetch(`/api/files?${params}`, {
                    headers: { 'Authorization': `Bearer ${(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '')}` }
                });

                if (!res.ok) throw new Error('获取文件列表失败');
                const data = await res.json();

                renderFilesList(data.files || []);
                renderFilesPagination(data.total, data.page, data.limit);
            } catch (e) {
                console.error('[files] loadFilesList error:', e);
                showNotification('加载文件列表失败: ' + e.message, 'error');
            }
        }

        let selectedFiles = new Set();
        let isSearchMode = false;

        function renderFilesList(files) {
            const container = document.getElementById('files-list-container');
            if (!files || files.length === 0) {
                container.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:#999;">暂无文件</div>';
                return;
            }

            const html = files.map(file => {
                const validationBadge = {
                    'pending': '<span style="background:#fbbf24;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">待校验</span>',
                    'passed': '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">✓ 已通过</span>',
                    'failed': '<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">✗ 未通过</span>'
                }[file.validation_status] || '';

                const fileTypeLabel = {
                    'pos_sales': 'POS销售',
                    'feishu_export': '飞书导出',
                    'daily_report': '营业日报'
                }[file.file_type] || file.file_type;

                const fileSize = formatFileSize(file.file_size);
                const uploadTime = new Date(file.created_at).toLocaleString('zh-CN');
                const isSelected = selectedFiles.has(file.file_id);

                return `
                    <div class="card" style="margin-bottom:12px;${isSelected ? 'border:2px solid #3b82f6;' : ''}">
                        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;">
                            <div style="display:flex;align-items:start;gap:12px;flex:1;min-width:0;">
                                <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleFileSelection('${file.file_id}')" style="margin-top:4px;">
                                <div style="flex:1;min-width:0;">
                                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                                        <span style="font-size:20px;">📄</span>
                                        <strong style="font-size:14px;">${file.original_name}</strong>
                                        ${validationBadge}
                                    </div>
                                    <div style="font-size:12px;color:#666;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
                                        <div>类型: ${fileTypeLabel}</div>
                                        <div>大小: ${fileSize}</div>
                                        <div>上传人: ${file.uploader_name || file.uploader_username}</div>
                                        <div>上传时间: ${uploadTime}</div>
                                        ${file.store ? `<div>门店: ${file.store}</div>` : ''}
                                        ${file.download_count > 0 ? `<div>下载: ${file.download_count}次</div>` : ''}
                                    </div>
                                    ${file.upload_note ? `<div style="margin-top:8px;padding:8px;background:#f3f4f6;border-radius:6px;font-size:12px;color:#666;">备注: ${file.upload_note}</div>` : ''}
                                    ${file.validation_status === 'failed' && file.validation_result?.errors ? `
                                        <div style="margin-top:8px;padding:8px;background:#fee;border-radius:6px;font-size:12px;color:#c00;">
                                            校验失败: ${file.validation_result.errors.join('; ')}
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                            <div style="display:flex;gap:8px;flex-shrink:0;">
                                <button class="btn btn-sm" data-click="downloadFile" data-arg="${file.file_id}" data-arg2="${file.original_name}">
                                    <i>⬇️</i> 下载
                                </button>
                                ${file.validation_status === 'pending' ? `
                                    <button class="btn btn-sm btn-secondary" data-click="validateFile" data-arg="${file.file_id}">
                                        <i>✓</i> 校验
                                    </button>
                                ` : ''}
                                ${currentUser?.role === 'admin' || currentUser?.username === file.uploader_username ? `
                                    <button class="btn btn-sm btn-danger" data-click="deleteFile" data-arg="${file.file_id}">
                                        <i>🗑️</i>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            container.innerHTML = html;
        }

        function toggleFileSelection(fileId) {
            if (selectedFiles.has(fileId)) {
                selectedFiles.delete(fileId);
            } else {
                selectedFiles.add(fileId);
            }
            updateBatchDownloadButton();
            // 重新渲染以更新复选框状态
            const container = document.getElementById('files-list-container');
            const checkbox = container.querySelector(`input[onchange*="${fileId}"]`);
            if (checkbox) {
                const card = checkbox.closest('.card');
                if (selectedFiles.has(fileId)) {
                    card.style.border = '2px solid #3b82f6';
                } else {
                    card.style.border = '';
                }
            }
        }

        function updateBatchDownloadButton() {
            const btn = document.getElementById('batch-download-btn');
            const count = document.getElementById('selected-count');
            if (selectedFiles.size > 0) {
                btn.style.display = 'block';
                count.textContent = selectedFiles.size;
            } else {
                btn.style.display = 'none';
            }
        }

        async function searchFiles() {
            const query = document.getElementById('file-search-input').value.trim();
            if (!query) {
                showNotification('请输入搜索关键词', 'warning');
                return;
            }

            try {
                isSearchMode = true;
                const res = await fetch(`/api/files/search?q=${encodeURIComponent(query)}`, {
                    headers: { 'Authorization': `Bearer ${(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '')}` }
                });

                if (!res.ok) throw new Error('搜索失败');
                const data = await res.json();

                renderFilesList(data.files || []);
                renderFilesPagination(data.total, data.page, data.limit);
                showNotification(`找到 ${data.total} 个文件`, 'success');
            } catch (e) {
                console.error('[files] searchFiles error:', e);
                showNotification('搜索失败: ' + e.message, 'error');
            }
        }

        function clearSearch() {
            document.getElementById('file-search-input').value = '';
            isSearchMode = false;
            loadFilesList(1);
        }

        async function batchDownloadFiles() {
            if (selectedFiles.size === 0) {
                showNotification('请先选择要下载的文件', 'warning');
                return;
            }

            if (selectedFiles.size > 50) {
                showNotification('一次最多下载50个文件', 'warning');
                return;
            }

            try {
                const res = await fetch('/api/files/batch-download', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '')}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ file_ids: Array.from(selectedFiles) })
                });

                if (!res.ok) throw new Error('批量下载失败');

                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'files.zip';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);

                showNotification(`成功下载 ${selectedFiles.size} 个文件`, 'success');
                selectedFiles.clear();
                updateBatchDownloadButton();
            } catch (e) {
                console.error('[files] batchDownloadFiles error:', e);
                showNotification('批量下载失败: ' + e.message, 'error');
            }
        }

        function renderFilesPagination(total, page, limit) {
            const totalPages = Math.ceil(total / limit);
            const container = document.getElementById('files-pagination');
            
            if (totalPages <= 1) {
                container.innerHTML = '';
                return;
            }

            let html = '';
            if (page > 1) {
                html += `<button class="btn btn-sm" data-click="loadFilesList" data-arg="${page - 1}" data-arg-type="number">上一页</button>`;
            }
            
            html += `<span style="padding:8px 16px;color:#666;">第 ${page} / ${totalPages} 页 (共 ${total} 个文件)</span>`;
            
            if (page < totalPages) {
                html += `<button class="btn btn-sm" data-click="loadFilesList" data-arg="${page + 1}" data-arg-type="number">下一页</button>`;
            }

            container.innerHTML = html;
        }

        function formatFileSize(bytes) {
            if (!bytes) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
        }

        async function downloadFile(fileId, fileName) {
            try {
                const res = await fetch(`/api/files/${fileId}/download`, {
                    headers: { 'Authorization': `Bearer ${(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '')}` }
                });

                if (!res.ok) throw new Error('下载失败');

                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);

                showNotification('文件下载成功', 'success');
                loadFilesList(currentFilesPage);
            } catch (e) {
                console.error('[files] download error:', e);
                showNotification('下载失败: ' + e.message, 'error');
            }
        }

        async function validateFile(fileId) {
            try {
                const res = await fetch(`/api/files/${fileId}/validate`, {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '')}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!res.ok) throw new Error('校验失败');
                const data = await res.json();

                showNotification(data.message || '校验完成', data.validation?.passed ? 'success' : 'warning');
                loadFilesList(currentFilesPage);
            } catch (e) {
                console.error('[files] validate error:', e);
                showNotification('校验失败: ' + e.message, 'error');
            }
        }

        async function deleteFile(fileId) {
            if (!confirm('确定要删除此文件吗？')) return;

            try {
                const res = await fetch(`/api/files/${fileId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '')}` }
                });

                if (!res.ok) throw new Error('删除失败');

                showNotification('文件已删除', 'success');
                loadFilesList(currentFilesPage);
            } catch (e) {
                console.error('[files] delete error:', e);
                showNotification('删除失败: ' + e.message, 'error');
            }
        }

        // ── 文件上传弹窗（深色主题，支持拖拽）──
        function showUploadFileDialog() {
            if (document.getElementById('upload-file-dialog')) return;
            const container = document.createElement('div');
            container.id = 'upload-file-dialog';
            container.innerHTML = `
                <div class="uf-backdrop" data-click="closeUploadFileDialog"></div>
                <div class="uf-modal">
                    <div class="uf-header">
                        <div>
                            <div class="uf-eyebrow">DATA FILES</div>
                            <h3 class="uf-title">上传数据文件</h3>
                        </div>
                        <button class="uf-close" data-click="closeUploadFileDialog">×</button>
                    </div>
                    <div class="uf-body">
                        <!-- 拖拽区 -->
                        <div class="uf-dropzone" id="uf-dropzone"
                             ondragover="event.preventDefault();this.classList.add('dragover')"
                             ondragleave="this.classList.remove('dragover')"
                             ondrop="ufHandleDrop(event)"
                             data-click="hrmsTriggerClick" data-arg="upload-file-input">
                            <div class="uf-drop-icon">📂</div>
                            <div class="uf-drop-text">拖放文件到此处，或点击选择</div>
                            <div class="uf-drop-hint">支持 Excel / CSV / PDF / ZIP / 图片，最大 50MB</div>
                            <input type="file" id="upload-file-input" style="display:none;"
                                   accept=".xlsx,.xls,.csv,.pdf,.zip,.png,.jpg,.jpeg,.doc,.docx,.txt"
                                   onchange="ufShowSelected(this)">
                        </div>
                        <div class="uf-selected" id="uf-selected" style="display:none;">
                            <span class="uf-file-icon" id="uf-file-icon">📄</span>
                            <span class="uf-file-name" id="uf-file-name"></span>
                            <span class="uf-file-size" id="uf-file-size"></span>
                            <button class="uf-file-clear" data-click="ufClearFile">×</button>
                        </div>

                        <!-- 文件类型 -->
                        <div class="uf-field">
                            <label class="uf-label">文件类型 <span style="color:#f43f5e;">*</span></label>
                            <div class="uf-type-grid" id="uf-type-grid">
                                <button class="uf-type-btn active" data-val="pos_sales" data-click="ufSelectType" data-arg-self="1">📊<br><span>POS销售</span></button>
                                <button class="uf-type-btn" data-val="feishu_export" data-click="ufSelectType" data-arg-self="1">🪶<br><span>飞书导出</span></button>
                                <button class="uf-type-btn" data-val="daily_report" data-click="ufSelectType" data-arg-self="1">📋<br><span>营业日报</span></button>
                                <button class="uf-type-btn" data-val="inventory" data-click="ufSelectType" data-arg-self="1">📦<br><span>库存数据</span></button>
                                <button class="uf-type-btn" data-val="hr_doc" data-click="ufSelectType" data-arg-self="1">👥<br><span>HR文档</span></button>
                                <button class="uf-type-btn" data-val="other" data-click="ufSelectType" data-arg-self="1">📄<br><span>其他</span></button>
                            </div>
                            <input type="hidden" id="upload-file-type" value="pos_sales">
                        </div>

                        <!-- 关联门店 -->
                        <div class="uf-field">
                            <label class="uf-label">关联门店（可选）</label>
                            <select id="upload-file-store" class="uf-select">
                                <option value="">不关联</option>
                                <option value="洪潮大宁久光店">洪潮大宁久光店</option>
                                <option value="马己仙上海音乐广场店">马己仙上海音乐广场店</option>
                            </select>
                        </div>

                        <!-- 备注 -->
                        <div class="uf-field">
                            <label class="uf-label">上传说明（可选）</label>
                            <textarea id="upload-file-note" class="uf-textarea" rows="2" placeholder="数据来源、时间范围、备注..."></textarea>
                        </div>
                    </div>
                    <div class="uf-footer">
                        <button class="btn btn-secondary" data-click="closeUploadFileDialog">取消</button>
                        <button class="btn" id="uf-submit-btn" data-click="submitFileUpload">⬆️ 上传</button>
                    </div>
                </div>
            `;
            document.body.appendChild(container);
        }

        function ufHandleDrop(e) {
            e.preventDefault();
            document.getElementById('uf-dropzone').classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (!file) return;
            const input = document.getElementById('upload-file-input');
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            ufShowSelected(input);
        }

        function ufShowSelected(input) {
            const file = input.files?.[0];
            if (!file) return;
            const ext = file.name.split('.').pop().toLowerCase();
            const iconMap = { xlsx:'📊', xls:'📊', csv:'📊', pdf:'📕', zip:'📦', png:'🖼️', jpg:'🖼️', jpeg:'🖼️', doc:'📝', docx:'📝', txt:'📄' };
            document.getElementById('uf-file-icon').textContent = iconMap[ext] || '📄';
            document.getElementById('uf-file-name').textContent = file.name;
            document.getElementById('uf-file-size').textContent = formatFileSize(file.size);
            document.getElementById('uf-selected').style.display = 'flex';
            document.getElementById('uf-dropzone').style.display = 'none';
        }

        function ufClearFile() {
            document.getElementById('upload-file-input').value = '';
            document.getElementById('uf-selected').style.display = 'none';
            document.getElementById('uf-dropzone').style.display = '';
        }

        function ufSelectType(btn) {
            document.querySelectorAll('#uf-type-grid .uf-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('upload-file-type').value = btn.dataset.val;
        }

        function closeUploadFileDialog() {
            const dialog = document.getElementById('upload-file-dialog');
            if (dialog) dialog.remove();
        }

        // ── 门店经营诊断 ──
        function dxToken() {
            return (window.HRMS_API && typeof HRMS_API.token === 'function') ? HRMS_API.token() : (localStorage.getItem('hrms_token') || '');
        }

        function dxIsGoodFactor(factor, direction) {
            if (direction === 'up') return true;
            if (direction === 'down') return false;
            if (/增长|提升|上升/.test(factor)) return true;
            if (factor === '差评下降' || factor === '桌访问题产品下降') return true;
            return false;
        }

        function dxDefaultDateRange() {
            const end = new Date();
            const start = new Date(end.getTime() - 29 * 86400000);
            const fmt = d => d.toISOString().slice(0, 10);
            return { start: fmt(start), end: fmt(end) };
        }

        function dxFmtPct(v, digits = 1) {
            if (v === null || v === undefined || v === '') return '-';
            const n = Number(v);
            if (!Number.isFinite(n)) return '-';
            const sign = n > 0 ? '+' : '';
            return sign + n.toFixed(digits) + '%';
        }

        function dxFmtMoney(v, digits = 0) {
            const n = Number(v);
            if (!Number.isFinite(n)) return '-';
            return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
        }

        function dxSourceMeta(source) {
            const s = String(source || '').toLowerCase();
            if (s.includes('pllm')) return { label: 'PLLM', cls: 'dx-source--pllm', card: 'dx-action-card--pllm' };
            if (s.includes('ai')) return { label: 'AI', cls: 'dx-source--ai', card: 'dx-action-card--ai' };
            if (s.includes('rule')) return { label: '规则', cls: 'dx-source--rule', card: 'dx-action-card--rule' };
            if (s.includes('manual')) return { label: '人工', cls: 'dx-source--manual', card: 'dx-action-card--rule' };
            return { label: '系统', cls: '', card: 'dx-action-card--rule' };
        }

        function dxNormalizeActions(list, fallbackSource) {
            return (Array.isArray(list) ? list : []).map((item, idx) => {
                const source = item?.source || fallbackSource || 'rule_engine';
                const meta = dxSourceMeta(source);
                return {
                    id: item?.action_key || item?.title || ('dx-' + idx),
                    source,
                    sourceLabel: meta.label,
                    sourceClass: meta.cls,
                    cardClass: meta.card,
                    type: item?.type || item?.action_type || '',
                    status: item?.status || '',
                    title: item?.title || item?.name || '建议行动',
                    detail: item?.detail || '',
                    priority: item?.priority || 'medium',
                    actions: Array.isArray(item?.actions) ? item.actions : [],
                    target_metric: item?.target_metric || '',
                    target_value: item?.target_value,
                    budget_amount: item?.budget_amount,
                    duration_days: item?.duration_days,
                    created_at: item?.created_at || null,
                };
            });
        }

        function dxBuildActionNotes(item) {
            const notes = [];
            if (item.target_metric) notes.push('目标 ' + item.target_metric + (item.target_value != null ? ' = ' + item.target_value : ''));
            if (item.duration_days) notes.push('周期 ' + item.duration_days + ' 天');
            if (item.budget_amount != null) notes.push('预算 ' + dxFmtMoney(item.budget_amount));
            return notes;
        }

        function dxFormatActionStep(step, idx) {
            if (typeof step === 'string') return step.trim();
            if (step && typeof step === 'object') {
                const role = step.role || step.owner || step.assignee || '';
                const action = step.action || step.task || step.title || step.name || '';
                const detail = step.detail || step.description || step.note || '';
                const parts = [role, action, detail].map(x => String(x || '').trim()).filter(Boolean);
                if (parts.length) return parts.join(' · ');
                try { return JSON.stringify(step); } catch (_) { return '步骤 ' + (idx + 1); }
            }
            return String(step || ('步骤 ' + (idx + 1))).trim();
        }

        function dxRenderActionSteps(steps) {
            const list = Array.isArray(steps) ? steps : [];
            if (!list.length) return '';
            return `<div class="dx-action-steps">${list.map((step, idx) =>
                `<div class="dx-action-step">${escapeHtml(String(idx + 1) + '. ' + dxFormatActionStep(step, idx))}</div>`
            ).join('')}</div>`;
        }

        function dxCloseAnomalyDetail() {
            document.getElementById('dx-anomaly-modal')?.classList.remove('show');
        }

        function dxFmtAnomalyValue(v) {
            if (v == null || v === '') return '';
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
            if (Array.isArray(v)) return v.map(dxFmtAnomalyValue).filter(Boolean).join('、');
            if (typeof v === 'object') {
                const entries = Object.entries(v).filter(([, val]) => val != null && val !== '');
                if (!entries.length) return '';
                return entries.map(([k, val]) => `${k}: ${dxFmtAnomalyValue(val)}`).join('；');
            }
            return String(v);
        }

        function dxFmtAnomalyThreshold(val) {
            if (val == null || val === '') return '';
            if (typeof val === 'object') {
                if (val.value != null) return String(val.value);
                if (val.threshold != null) return String(val.threshold);
                const text = dxFmtAnomalyValue(val);
                return text === '{}' ? '' : text;
            }
            return String(val);
        }

        function dxAnomalyRoleLabel(role) {
            const map = {
                kitchen_manager: '出品经理',
                hq_manager: '总部营运',
                store_manager: '店长',
                store_production_manager: '出品经理',
                hr_manager: '人事经理',
            };
            return map[role] || role || '';
        }

        function dxAnomalyStatusLabel(status) {
            const map = { closed: '已关闭', open: '进行中', pending: '待处理', active: '生效中' };
            return map[status] || status || '';
        }

        function dxRenderAnomalyTriggerValue(tv) {
            if (!tv || typeof tv !== 'object') return '';
            const parts = [];

            if (Array.isArray(tv.products) && tv.products.length) {
                parts.push(`<div class="dx-anomaly-kv"><div class="dx-anomaly-kv__label">涉及菜品</div>${tv.products.map((p) => {
                    const dish = p.complaint || p.product || p.name || p.dish || '-';
                    const cnt = p.cnt != null ? ` ×${p.cnt}` : '';
                    const tier = p.tier ? `（${p.tier}）` : '';
                    const pts = p.deduction_points != null ? `，扣${p.deduction_points}分` : '';
                    return `<div class="dx-anomaly-evidence">${escapeHtml('• ' + dish + cnt + tier + pts)}</div>`;
                }).join('')}</div>`);
            }

            if (Array.isArray(tv.evidence) && tv.evidence.length) {
                parts.push(`<div class="dx-anomaly-kv"><div class="dx-anomaly-kv__label">证据摘录</div>${tv.evidence.map((ev) => {
                    const excerpt = ev.excerpt || ev.text || ev.content || '';
                    const label = ev.source_label || ev.source_kind || '';
                    const date = ev.record_date || '';
                    const kw = Array.isArray(ev.matched_keywords) ? ev.matched_keywords.join('、') : '';
                    return `<div class="dx-anomaly-evidence">
                        <div>${escapeHtml(excerpt || '-')}</div>
                        ${label || date ? `<div class="dx-anomaly-evidence__meta">${escapeHtml([label, date].filter(Boolean).join(' · '))}</div>` : ''}
                        ${kw ? `<div class="dx-anomaly-evidence__meta">关键词：${escapeHtml(kw)}</div>` : ''}
                    </div>`;
                }).join('')}</div>`);
            }

            const scalarFields = [
                ['window', '统计窗口'],
                ['weekStart', '周起始'],
                ['weekEnd', '周结束'],
                ['scanDate', '扫描日期'],
                ['source', '来源'],
                ['dataSource', '数据来源'],
                ['deduction_points_total', '合计扣分'],
            ];
            scalarFields.forEach(([key, label]) => {
                if (tv[key] != null && tv[key] !== '') {
                    parts.push(`<div class="dx-anomaly-record__meta">${escapeHtml(label)}：${escapeHtml(dxFmtAnomalyValue(tv[key]))}</div>`);
                }
            });

            if (Array.isArray(tv.matchedKeywords) && tv.matchedKeywords.length) {
                parts.push(`<div class="dx-anomaly-record__meta">命中关键词：${escapeHtml(tv.matchedKeywords.join('、'))}</div>`);
            }
            if (tv.consecutiveDown != null) {
                parts.push(`<div class="dx-anomaly-record__meta">连续下降：${escapeHtml(String(tv.consecutiveDown))}周${tv.changePct != null ? `（${tv.changePct}%）` : ''}</div>`);
            }

            return parts.join('');
        }

        function dxRenderAnomalyRecord(r, sevLabel) {
            const tv = r.trigger_value && typeof r.trigger_value === 'object' ? r.trigger_value : {};
            const statusText = dxAnomalyStatusLabel(r.status);
            const roleText = dxAnomalyRoleLabel(r.assigned_role);
            const threshold = dxFmtAnomalyThreshold(r.threshold_value);
            const detailHtml = dxRenderAnomalyTriggerValue(tv);
            const summaryLine = r.detail && r.detail !== detailHtml ? r.detail : '';

            return `<div class="dx-anomaly-modal__record">
                <div class="dx-anomaly-record__head">
                    <strong>${escapeHtml(String(r.date || '-'))}</strong>
                    <span>${escapeHtml(sevLabel)}${statusText ? ' · ' + escapeHtml(statusText) : ''}</span>
                </div>
                ${summaryLine ? `<div class="dx-anomaly-record__line">${escapeHtml(summaryLine)}</div>` : ''}
                ${roleText ? `<div class="dx-anomaly-record__meta">责任岗位：${escapeHtml(roleText)}</div>` : ''}
                ${threshold ? `<div class="dx-anomaly-record__meta">阈值：${escapeHtml(threshold)}</div>` : ''}
                ${detailHtml}
            </div>`;
        }

        function dxShowAnomalyDetail(idx) {
            const list = window.__DX_CURRENT_ANOMALIES || [];
            const a = list[idx];
            if (!a) return;
            const titleEl = document.getElementById('dx-anomaly-modal-title');
            const bodyEl = document.getElementById('dx-anomaly-modal-body');
            if (titleEl) titleEl.textContent = a.type || '异常详情';
            if (!bodyEl) return;
            const sevLabel = a.severity === 'high' ? '高' : (a.severity === 'medium' ? '中' : '低');
            const records = Array.isArray(a.records) ? a.records : [];
            const recordHTML = records.length
                ? records.map((r) => dxRenderAnomalyRecord(r, sevLabel)).join('')
                : '<div class="dx-anomaly-modal__text">暂无逐条触发记录，以下为汇总说明。</div>';
            bodyEl.innerHTML = `
                <div class="dx-anomaly-modal__section">
                    <div class="dx-anomaly-modal__label">汇总</div>
                    <div class="dx-anomaly-modal__text">
                        本期触发 <strong>${escapeHtml(String(a.count != null ? a.count : '-'))}</strong> 次
                        · 最近 ${escapeHtml(String(a.latest_date || '-'))}
                        · 严重度 ${escapeHtml(sevLabel)}
                    </div>
                </div>
                <div class="dx-anomaly-modal__section">
                    <div class="dx-anomaly-modal__label">异常说明</div>
                    <div class="dx-anomaly-modal__text">${escapeHtml(a.description || a.detail || '-')}</div>
                </div>
                ${a.detail && a.detail !== a.description ? `
                <div class="dx-anomaly-modal__section">
                    <div class="dx-anomaly-modal__label">本期具体情况</div>
                    <div class="dx-anomaly-modal__text">${escapeHtml(a.detail)}</div>
                </div>` : ''}
                <div class="dx-anomaly-modal__section">
                    <div class="dx-anomaly-modal__label">触发记录（${records.length}条）</div>
                    ${recordHTML}
                </div>`;
            document.getElementById('dx-anomaly-modal')?.classList.add('show');
        }

        async function loadDiagnosisData() {
            const container = document.getElementById('dx-cards-container');
            if (!container) return;
            const startEl = document.getElementById('dx-start-date');
            const endEl = document.getElementById('dx-end-date');
            if (startEl && !startEl.value) { const r = dxDefaultDateRange(); startEl.value = r.start; if (endEl) endEl.value = r.end; }
            const start = startEl?.value;
            const end = endEl?.value;
            container.innerHTML = '<div class="dx-empty">⏳ 正在加载诊断数据...</div>';
            try {
                const res = await fetch(`/api/diagnosis/overview?start=${start}&end=${end}`, {
                    headers: { 'Authorization': 'Bearer ' + dxToken() }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'unknown');
                dxRenderCards(data.stores, start, end);
                gsInitStores((data.stores || []).map(s => s.store));
            } catch (e) {
                container.innerHTML = `<div class="dx-empty">❌ 加载失败: ${escapeHtml(e.message)}<br><br><button class="ga-btn ga-btn--ghost ga-btn--sm" data-click="loadDiagnosisData">重试</button></div>`;
            }
        }

        // ── 六大增长方案 ─────────────────────────────────────
        const GS_PROBLEM_ICONS = { staff_efficiency: '👥', revenue: '📈', kitchen_standard: '👨‍🍳', menu_optimization: '🍽️', gross_margin: '💰', training_replication: '🎓' };
        const GS_STATUS_LABEL = { active: '执行中', observing: '观察期', reviewing: '待复盘确认' };
        let gsCurrentDetail = null;

        function gsInitStores(stores) {
            const sel = document.getElementById('gs-store-select');
            if (!sel || !stores || !stores.length) return;
            const prev = sel.value;
            sel.innerHTML = stores.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
            if (prev && stores.includes(prev)) sel.value = prev;
            gsLoadCards();
            gsLoadCustomHistory(); gsLoadCustomActiveRounds();
        }

        async function gsLoadCards() {
            const sel = document.getElementById('gs-store-select');
            const container = document.getElementById('gs-cards');
            if (!sel || !container || !sel.value) return;
            container.innerHTML = '<div class="dx-empty">⏳ 正在计算六大问题现状数据...</div>';
            try {
                const res = await fetch(`/api/diagnosis/solutions/overview?store=${encodeURIComponent(sel.value)}`, { headers: { 'Authorization': 'Bearer ' + dxToken() } });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                container.innerHTML = data.cards.map(c => {
                    let badge = '<span class="gs-badge gs-badge--idle">未启动</span>';
                    if (c.round) badge = `<span class="gs-badge gs-badge--${escapeHtml(c.round.status)}">${GS_STATUS_LABEL[c.round.status] || c.round.status} 第${c.round.round_no}轮</span>`;
                    else if (c.capped) badge = '<span class="gs-badge gs-badge--capped">已封顶</span>';
                    const val = c.current_value != null ? Number(c.current_value).toLocaleString('zh-CN') : '—';
                    let targetLine = '';
                    if (c.round) targetLine = `本轮目标 ${Number(c.round.target_value).toLocaleString('zh-CN')}${escapeHtml(c.unit)} · 任务 ${c.round.tasks_done}/${c.round.tasks_total}`;
                    else if (c.next_target != null) targetLine = `建议目标 ${Number(c.next_target).toLocaleString('zh-CN')}${escapeHtml(c.unit)} →`;
                    return `<div class="gs-card" data-click="gsOpenDetail" data-arg="${escapeHtml(c.problem_key)}">
                      <div class="gs-card__top"><span class="gs-card__title">${GS_PROBLEM_ICONS[c.problem_key] || ''} ${escapeHtml(c.title)}</span>${badge}</div>
                      <div class="gs-card__metric">${escapeHtml(c.metric)}</div>
                      <div class="gs-card__value">${val} <small>${escapeHtml(c.unit)}</small></div>
                      ${targetLine ? `<div class="gs-card__target">${targetLine}</div>` : ''}
                      <div class="gs-card__sum">${escapeHtml(c.summary || '')}</div>
                    </div>`;
                }).join('');
            } catch (e) {
                container.innerHTML = `<div class="dx-empty">❌ ${escapeHtml(e.message)} <button class="ga-btn ga-btn--ghost ga-btn--sm" data-click="gsLoadCards">重试</button></div>`;
            }
        }

        function gsCloseModal() { document.getElementById('gs-modal')?.classList.remove('show'); }

        async function gsOpenDetail(key, extraAnalysis) {
            const store = document.getElementById('gs-store-select')?.value;
            if (!store) return;
            const modal = document.getElementById('gs-modal');
            const body = document.getElementById('gs-modal-body');
            const title = document.getElementById('gs-modal-title');
            modal.classList.add('show');
            body.innerHTML = '<div class="dx-empty">⏳ 加载方案详情...</div>';
            try {
                const res = await fetch(`/api/diagnosis/solutions/${encodeURIComponent(key)}?store=${encodeURIComponent(store)}`, { headers: { 'Authorization': 'Bearer ' + dxToken() } });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                gsCurrentDetail = data;
                title.textContent = `${GS_PROBLEM_ICONS[key] || ''} ${data.title} · ${store}`;
                // extraAnalysis：从自定义问题分析(gsAnalyzeCustom)判断出"这属于六大标准问题之一"时，
                // AI基于真实数据做的分析文字——之前直接跳转详情页会把这段分析丢掉，现在放在最前面。
                const analysisHtml = extraAnalysis ? `<div class="dx-anomaly-modal__section" style="background:rgba(109,124,255,0.06);border:1px solid rgba(109,124,255,0.18);border-radius:12px;padding:12px;margin-bottom:10px;"><div class="dx-anomaly-modal__label">📋 经营分析</div><div class="dx-anomaly-modal__text" style="white-space:pre-line;line-height:1.7;">${escapeHtml(extraAnalysis)}</div></div>` : '';
                body.innerHTML = analysisHtml + (data.open_round ? gsRenderRound(data) : gsRenderPlan(data));
            } catch (e) {
                body.innerHTML = `<div class="dx-empty">❌ ${escapeHtml(e.message)}</div>`;
            }
        }

        function gsFmtVal(v, unit) { return v == null ? '—' : `${Number(v).toLocaleString('zh-CN')}<small style="font-size:12px;color:#9AA3C7"> ${escapeHtml(unit)}</small>`; }

        function gsStageHtml(baseline, target, unit, baselineHint, targetHint) {
            return `<div class="gs-stage">
              <div class="gs-stage__cell"><div class="gs-stage__label">现状 · 真实数据</div><div class="gs-stage__value">${gsFmtVal(baseline, unit)}</div><div class="gs-stage__hint">${escapeHtml(baselineHint || '近30天')}</div></div>
              <div class="gs-stage__arrow">→</div>
              <div class="gs-stage__cell gs-stage__cell--target"><div class="gs-stage__label">本轮目标</div><div class="gs-stage__value">${gsFmtVal(target, unit)}</div><div class="gs-stage__hint">${escapeHtml(targetHint || '达成率=实际/目标,≥90%达成')}</div></div>
            </div>`;
        }

        function gsMenuDetailHtml(detail) {
            if (!detail) return '';
            let html = '';
            const cds = detail.complaint_dishes || [];
            if (cds.length) {
                html += `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">高投诉菜品(桌访不满意,近30天)</div>
                  <table class="gs-dishtable"><tr><th>菜品</th><th>投诉次数</th></tr>
                  ${cds.slice(0, 10).map(c => `<tr><td>${escapeHtml(c.dish)}</td><td>${c.count}</td></tr>`).join('')}</table></div>`;
            }
            // 菜品四象限(明星/引流/潜力/淘汰)暂时不展示——按品类分组排名后数值本身没问题，
            // 但用户反馈这个功能整体的呈现质量还不达标，要重新设计判断方法后再上，先隐藏
            // 不删代码(quadrants数据后端仍在算、仍在返回，只是这里不渲染)。
            return html;
        }

        function gsExtraDetailHtml(data) {
            const d = data.current?.detail || {};
            if (data.problem_key === 'menu_optimization') return gsMenuDetailHtml(d);
            if (data.problem_key === 'gross_margin' && Array.isArray(d.low_margin_top) && d.low_margin_top.length) {
                return `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">低毛利菜品 TOP10</div>
                  <table class="gs-dishtable"><tr><th>菜品</th><th>渠道</th><th>销量</th><th>毛利率</th></tr>
                  ${d.low_margin_top.map(x => `<tr><td>${escapeHtml(x.dish)}</td><td>${x.biz === 'takeaway' ? '外卖' : '堂食'}</td><td>${x.qty}</td><td>${x.margin != null ? x.margin + '%' : '—'}</td></tr>`).join('')}</table></div>`;
            }
            if (data.problem_key === 'training_replication' && Array.isArray(d.gaps) && d.gaps.length) {
                return `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">认证缺口(前20)</div>
                  <table class="gs-dishtable"><tr><th>员工</th><th>岗位</th><th>缺认证</th></tr>
                  ${d.gaps.slice(0, 20).map(g => `<tr><td>${escapeHtml(g.name || g.username)}</td><td>${escapeHtml(g.position || '')}</td><td>${escapeHtml(g.topic)}</td></tr>`).join('')}</table></div>`;
            }
            return '';
        }

        function gsRenderPlan(data) {
            if (data.capped) {
                return gsStageHtml(data.current?.value, null, data.unit, '', '已达封顶,无需新轮次') + gsExtraDetailHtml(data) + '<div class="gs-report">该指标已达阶梯封顶 🎉 保持当前水平即可。</div>';
            }
            const plan = data.plan || [];
            const tasks = plan.map((t, i) => {
                const opts = (t.suggested_assignees || []).map(a => `<option value="${escapeHtml(a.username)}" data-name="${escapeHtml(a.name)}">${escapeHtml(a.name)}(${escapeHtml(a.position)})</option>`).join('');
                const defDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
                return `<div class="gs-task" data-idx="${i}">
                  <div class="gs-task__num">${i + 1}</div>
                  <div class="gs-task__body">
                    <div class="gs-task__title">${escapeHtml(t.title)}${t.phase ? `<span class="gs-task__phase">${escapeHtml(t.phase)}</span>` : ''}</div>
                    <div class="gs-task__desc">${escapeHtml(t.description || '')}</div>
                    ${t.why ? `<div style="font-size:12px;color:#A5B0FF;margin-top:6px;">💡 为什么要做:${escapeHtml(t.why)}</div>` : ''}
                    ${t.acceptance_criteria ? `<div style="font-size:12px;color:#3ED9A6;margin-top:4px;">✓ 验收标准:${escapeHtml(t.acceptance_criteria)}</div>` : ''}
                    <div class="gs-task__meta">
                      <label class="gs-task__field"><span class="gs-task__field-label">责任人</span><select class="gs-assignee ${opts ? '' : 'gs-missing'}" data-idx="${i}">${opts || '<option value="">⚠️ 无候选人,请补员工岗位</option>'}</select></label>
                      <label class="gs-task__field"><span class="gs-task__field-label">截止日期</span><input type="date" class="gs-due" data-idx="${i}" value="${defDue}"></label>
                    </div>
                  </div>
                </div>`;
            }).join('');
            const histHtml = (data.history || []).length ? `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">历史轮次</div>${data.history.map(h => `<div class="dx-anomaly-modal__text">第${h.round_no}轮:基线 ${h.baseline} → 目标 ${h.target},实际 ${h.actual ?? '—'},达成率 ${h.achievement_rate != null ? (h.achievement_rate * 100).toFixed(1) + '%' : '—'}(${h.decision === 'advance' ? '达成进阶' : '重跑'})</div>`).join('')}</div>` : '';
            // analysis是这次的核心内容——不管有没有匹配到六大指标，都要求AI给出150-300字的
            // 现状判断+根因假设+任务关联分析，不是简单复述数字。放在最前面、单独一块突出展示。
            const analysisHtml = data.analysis ? `<div class="dx-anomaly-modal__section" style="background:rgba(109,124,255,0.06);border:1px solid rgba(109,124,255,0.18);border-radius:12px;padding:12px;"><div class="dx-anomaly-modal__label">📋 经营分析</div><div class="dx-anomaly-modal__text" style="white-space:pre-line;line-height:1.7;">${escapeHtml(data.analysis)}</div></div>` : '';
            const priorityHtml = data.priority_recommendation ? `<div class="gs-report" style="border-color:rgba(62,217,166,0.3);background:rgba(62,217,166,0.06);margin-bottom:10px;">🎯 ${escapeHtml(data.priority_recommendation)}</div>` : '';
            // data.metric 为空说明六大指标都不适用，没有"现状/目标"可展示——不硬凑stage box。
            const stageHtml = data.metric ? gsStageHtml(data.current?.value, data.suggested_target, data.unit, data.metric, '') : '';
            // real_data_evidence：差评/员工流动这类新接的真实数据源，跟六大指标是两套东西，
            // 单独渲染成证据卡片，附带明细列表(点开能看到具体差评原文/在职离职人数)。
            const evidenceHtml = (data.real_data_evidence || []).map(ev => {
              const detailHtml = Array.isArray(ev.detail) && ev.detail.length
                ? `<details style="margin-top:6px;"><summary style="cursor:pointer;color:#9AA3C7;font-size:12px;">查看明细</summary><div style="margin-top:6px;">${ev.detail.map(d => `<div class="dx-anomaly-modal__text" style="font-size:12px;padding:4px 0;border-top:1px solid rgba(255,255,255,.06);">${escapeHtml(d)}</div>`).join('')}</div></details>`
                : '';
              return `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">📊 ${escapeHtml(ev.label)}</div><div class="dx-anomaly-modal__text">${escapeHtml(ev.value)}</div>${detailHtml}</div>`;
            }).join('');
            return analysisHtml + priorityHtml + stageHtml + evidenceHtml + gsExtraDetailHtml(data) + histHtml +
              `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">任务方案(每项必须指定责任人)</div>${tasks}</div>
               <div class="gs-actions"><button class="ga-btn ga-btn--primary" data-click="gsDispatch" data-arg="${escapeHtml(data.problem_key)}">一键下发全部任务</button></div>`;
        }

        function gsRenderRound(data) {
            const r = data.open_round;
            const tasks = (r.tasks || []).map((t, i) => `<div class="gs-task">
              <div class="gs-task__num">${i + 1}</div>
              <div class="gs-task__body">
                <div class="gs-task__title">${escapeHtml(t.title)}</div>
                <div class="gs-task__desc">${escapeHtml(t.description || '')}</div>
                ${t.why ? `<div style="font-size:12px;color:#A5B0FF;margin-top:6px;">💡 为什么要做:${escapeHtml(t.why)}</div>` : ''}
                ${t.acceptance_criteria ? `<div style="font-size:12px;color:#3ED9A6;margin-top:4px;">✓ 验收标准:${escapeHtml(t.acceptance_criteria)}</div>` : ''}
                <div class="gs-task__meta">
                  <span class="dx-d-tag">👤 ${escapeHtml(t.assignee_name || t.assignee_username)}</span>
                  ${t.due_date ? `<span class="gs-task__phase">截止 ${String(t.due_date).slice(0, 10)}</span>` : ''}
                  <span class="gs-task__status gs-task__status--${t.status === 'done' ? 'done' : 'pending'}">${t.status === 'done' ? '✓ 已完成' : (t.due_date && String(t.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10) ? '⚠️ 已逾期' : '进行中')}</span>
                  ${Number(t.reminder_count) > 0 ? `<span class="gs-task__phase" style="color:#FF8A7A;">已催促 ${t.reminder_count} 次</span>` : ''}
                  ${t.status !== 'done' && r.status === 'active' ? `<button class="ga-btn ga-btn--ghost ga-btn--sm" onclick="gsRemindTask(${t.id}, this)">提醒</button>` : ''}
                </div>
              </div>
            </div>`).join('');
            let stateHtml = '';
            if (r.status === 'active') {
                const todayYmd = new Date().toISOString().slice(0, 10);
                const hasOverdue = (r.tasks || []).some(t => t.status !== 'done' && t.due_date && String(t.due_date).slice(0, 10) < todayYmd);
                if (hasOverdue) {
                    stateHtml = `<div class="gs-report" style="border-color:rgba(255,138,122,0.35);">⚠️ 存在逾期未完成任务,系统每日自动催促并记录次数。若持续无进展,可直接强制复盘——报告将如实点名未完成任务与催促次数。
                      <div class="gs-actions"><button class="ga-btn ga-btn--ghost" data-click="gsForceReview" data-arg="${r.id}" data-arg-type="number">强制复盘(点名未执行)</button></div></div>`;
                }
            } else if (r.status === 'observing') {
                stateHtml = `<div class="gs-report">✅ 任务已全部完成,处于观察期,<b>${escapeHtml(String(r.measure_end_date).slice(0, 10))}</b> 自动复盘(观察期实际值以最后30天数据计算)。</div>`;
            } else if (r.status === 'reviewing' && r.review_report) {
                const rp = typeof r.review_report === 'string' ? JSON.parse(r.review_report) : r.review_report;
                const ok = rp.success;
                const ex = rp.execution || null;
                let execHtml = '';
                if (ex) {
                    const findings = (ex.findings || []).map(f => `<div style="padding:6px 10px;border-radius:8px;background:rgba(255,138,122,0.08);border:1px solid rgba(255,138,122,0.2);margin-top:6px;color:#FFB4A8;font-size:12px;line-height:1.5;">⚠️ ${escapeHtml(f)}</div>`).join('');
                    const personRows = (ex.per_person || []).map(p => `<tr><td>${escapeHtml(p.assignee)}</td><td>${p.done}/${p.total}</td><td>${p.on_time}</td><td>${p.late}${p.max_days_late ? `(最长${p.max_days_late}天)` : ''}</td><td>${p.undone}</td><td>${p.reminders}</td></tr>`).join('');
                    execHtml = `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">执行力问责(按时完成率 ${ex.on_time_rate}%)</div>
                      <div style="font-size:13px;color:#EEF1FA;line-height:1.6;">${escapeHtml(ex.verdict || '')}</div>
                      ${findings || '<div style="font-size:12px;color:#3ED9A6;margin-top:6px;">✓ 无执行问题,全部按时完成</div>'}
                      <table class="gs-dishtable" style="margin-top:10px;"><tr><th>责任人</th><th>完成</th><th>按时</th><th>逾期</th><th>未完成</th><th>被催促</th></tr>${personRows}</table>
                    </div>`;
                }
                stateHtml = `<div class="gs-report">
                  <div style="display:flex;gap:18px;align-items:baseline;flex-wrap:wrap;">
                    <span class="gs-rate ${ok ? 'gs-rate--ok' : 'gs-rate--bad'}">${rp.achievement_rate}%</span>
                    <span>目标 ${rp.target}${escapeHtml(rp.unit)} / 实际 ${rp.actual}${escapeHtml(rp.unit)}(基线 ${rp.baseline})</span>
                  </div>
                  ${execHtml}
                  <div style="margin-top:10px;">${escapeHtml(rp.attribution || '')}</div>
                  <div style="margin-top:8px;color:#9AA3C7;">${escapeHtml(rp.suggestion || '')}</div>
                  <div class="gs-actions">
                    ${ok ? `<button class="ga-btn ga-btn--primary" data-click="gsConfirm" data-arg="${r.id}" data-arg-type="number" data-arg2="advance">确认达成,进入下一轮</button>` : ''}
                    <button class="ga-btn ga-btn--ghost" data-click="gsConfirm" data-arg="${r.id}" data-arg-type="number" data-arg2="retry">同目标重跑一轮</button>
                  </div>
                </div>`;
            }
            return `<div class="dx-anomaly-modal__text">第 ${r.round_no} 轮 · ${GS_STATUS_LABEL[r.status] || r.status}</div>` +
              gsStageHtml(r.baseline_value, r.target_value, r.unit, '开轮时冻结', '') +
              `<div class="dx-anomaly-modal__section"><div class="dx-anomaly-modal__label">任务执行(${(r.tasks || []).filter(t => t.status === 'done').length}/${(r.tasks || []).length})</div>${tasks}</div>` + stateHtml;
        }

        async function gsDispatch(key) {
            const store = document.getElementById('gs-store-select')?.value;
            const plan = gsCurrentDetail?.plan || [];
            const body = document.getElementById('gs-modal-body');
            const tasks = [];
            let missing = 0;
            plan.forEach((t, i) => {
                const sel = body.querySelector(`select.gs-assignee[data-idx="${i}"]`);
                const due = body.querySelector(`input.gs-due[data-idx="${i}"]`);
                const username = sel?.value || '';
                if (!username) { missing++; sel?.classList.add('gs-missing'); return; }
                tasks.push({
                    template_code: t.template_code, title: t.title, description: t.description, phase: t.phase,
                    why: t.why || '', acceptance_criteria: t.acceptance_criteria || '',
                    assignee_username: username,
                    assignee_name: sel.selectedOptions[0]?.dataset?.name || '',
                    due_date: due?.value || null,
                });
            });
            if (missing > 0) { showNotification(`还有 ${missing} 项任务未指定责任人,不能下发`, 'warning'); return; }
            const targetLine = gsCurrentDetail.metric ? `目标 ${gsCurrentDetail.suggested_target}${gsCurrentDetail.unit}(基线将以当前值冻结)` : '该方案没有对应的量化指标，将按任务清单直接跟踪执行情况';
            if (!confirm(`确认下发 ${tasks.length} 项任务?${targetLine}`)) return;
            try {
                const payload = { store, tasks };
                if (key.startsWith('custom:')) {
                    payload.custom_title = gsCurrentDetail.title;
                    payload.metric_key = gsCurrentDetail.metric_key;
                }
                const res = await fetch(`/api/diagnosis/solutions/${encodeURIComponent(key)}/rounds`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dxToken() },
                    body: JSON.stringify({ store, ...payload }),
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                showNotification(data.target != null ? `第${data.round_no}轮已启动:基线 ${data.baseline} → 目标 ${data.target}` : `第${data.round_no}轮已启动,共${tasks.length}项任务`, 'success');
                gsOpenDetail(key); gsLoadCards(); gsLoadCustomActiveRounds();
            } catch (e) { showNotification('下发失败: ' + e.message, 'error'); }
        }

        // "标记完成"只应该由任务的责任人在自己"我的档案"里操作(见profileCompleteMyTask)——
        // 派发人/管理者在这里(诊断页的轮次详情)看别人的任务，能做的是"提醒"，不该代替责任人
        // 标记完成，所以这个按钮换成了提醒。限流(1小时1次)在后端做，这里失败了就提示错误。
        async function gsRemindTask(taskId, btn) {
            if (btn) { btn.disabled = true; }
            try {
                const res = await fetch(`/api/diagnosis/solutions/tasks/${taskId}/remind`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dxToken() }, body: '{}',
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                showNotification(`已提醒，累计第${data.reminder_count}次`, 'success');
                gsOpenDetail(gsCurrentDetail.problem_key);
            } catch (e) {
                showNotification(e.message, 'warning');
                if (btn) { btn.disabled = false; }
            }
        }

        async function gsForceReview(roundId) {
            if (!confirm('确认强制复盘?未完成的任务将在报告中被如实点名(含逾期天数与催促次数),且本轮只能以"未达成"处理。')) return;
            try {
                const res = await fetch(`/api/diagnosis/solutions/rounds/${roundId}/force-review`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dxToken() }, body: '{}',
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                showNotification('已生成复盘报告', 'success');
                gsOpenDetail(gsCurrentDetail.problem_key); gsLoadCards();
            } catch (e) { showNotification('操作失败: ' + e.message, 'error'); }
        }

        async function gsAnalyzeCustom() {
            const storeSelEl = document.getElementById('gs-store-select');
            const store = storeSelEl?.value;
            const q = document.getElementById('gs-custom-q')?.value?.trim();
            if (!store) { showNotification('请先选择门店', 'warning'); return; }
            if (!q) { showNotification('请先描述你遇到的问题', 'warning'); return; }
            // 分析只认门店选择器的值，问题文字里提到的门店名不会被读取——如果两者不一致，
            // 用户很容易以为"输入里写了哪家店就分析哪家店"，结果分析的其实是选择器上那家，
            // 之前就出现过"选择器停在洪潮、问题文字写马己仙，结果分析了洪潮"的误用。这里做
            // 一次防呆：问题文字里如果提到了选择器列表中另一家店，先拦下来让用户确认。
            const otherStoreNames = Array.from(storeSelEl.options || [])
                .map(o => o.value).filter(v => v && v !== store);
            const mentionedOtherStore = otherStoreNames.find(name => q.includes(name));
            if (mentionedOtherStore) {
                const proceed = confirm(`当前选择的门店是"${store}"，但问题里提到了"${mentionedOtherStore}"。\n\n分析只会按门店选择器里选的门店来算，不会读取问题文字里提到的门店名。\n\n点"确定"按当前选择器的"${store}"继续分析；点"取消"先去切换门店选择器再重新提交。`);
                if (!proceed) return;
            }
            const modal = document.getElementById('gs-modal');
            const body = document.getElementById('gs-modal-body');
            const title = document.getElementById('gs-modal-title');
            modal.classList.add('show');
            title.textContent = '🤖 AI 正在分析';
            body.innerHTML = '<div class="dx-empty">⏳ 结合门店数据生成方案中,约需10-30秒...</div>';
            try {
                const res = await fetch('/api/diagnosis/solutions/custom/analyze', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dxToken() },
                    body: JSON.stringify({ store, question: q }),
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                if (data.mode === 'existing') {
                    gsOpenDetail(data.problem_key, data.analysis);
                    return;
                }
                gsCurrentDetail = data;
                title.textContent = `🤖 ${data.title} · ${store}`;
                const scopeNote = data.out_of_scope ? `<div class="gs-report" style="border-color:rgba(232,184,90,0.35);">⚠️ 能力范围说明:${escapeHtml(data.out_of_scope)}</div>` : '';
                const reasonNote = data.reason ? `<div class="dx-anomaly-modal__text">${data.metric ? `考核指标:${escapeHtml(data.metric)} — ` : ''}${escapeHtml(data.reason)}</div>` : '';
                body.innerHTML = reasonNote + scopeNote + gsRenderPlan(data);
                gsLoadCustomHistory(); gsLoadCustomActiveRounds();
            } catch (e) {
                body.innerHTML = `<div class="dx-empty">❌ ${escapeHtml(e.message)} <button class="ga-btn ga-btn--ghost ga-btn--sm" data-click="gsAnalyzeCustom">重试</button></div>`;
            }
        }

        async function gsLoadCustomActiveRounds() {
            const host = document.getElementById('gs-custom-active');
            const store = document.getElementById('gs-store-select')?.value;
            if (!host || !store) return;
            try {
                const res = await fetch(`/api/diagnosis/solutions/custom/active-rounds?store=${encodeURIComponent(store)}`, { headers: { 'Authorization': 'Bearer ' + dxToken() } });
                const data = await res.json();
                if (!data.ok || !(data.rounds || []).length) { host.innerHTML = ''; return; }
                const statusLabel = { active: '执行中', observing: '观察期', reviewing: '待复盘确认' };
                host.innerHTML = '<div style="font-size:11px;color:#5B6597;margin-bottom:6px;">📌 进行中的自定义任务(点击查看进度)</div>' +
                  '<div style="display:flex;flex-direction:column;gap:6px;">' +
                  data.rounds.map(r => `<button type="button" class="ga-btn ga-btn--ghost ga-btn--sm" style="justify-content:space-between;width:100%;" data-click="gsOpenDetail" data-arg="${escapeHtml(r.problem_key)}">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.problem_title)} · 第${r.round_no}轮</span>
                    <span style="flex-shrink:0;margin-left:8px;color:#A5B0FF;">${statusLabel[r.status] || r.status} ${r.tasks_done}/${r.tasks_total}</span>
                  </button>`).join('') +
                  '</div>';
            } catch (e) { host.innerHTML = ''; }
        }

        async function gsLoadCustomHistory() {
            const host = document.getElementById('gs-custom-history');
            const store = document.getElementById('gs-store-select')?.value;
            if (!host || !store) return;
            try {
                const res = await fetch(`/api/diagnosis/solutions/custom/history?store=${encodeURIComponent(store)}&limit=10`, { headers: { 'Authorization': 'Bearer ' + dxToken() } });
                const data = await res.json();
                if (!data.ok || !(data.history || []).length) { host.innerHTML = ''; return; }
                host.innerHTML = '<div style="font-size:11px;color:#5B6597;margin-bottom:6px;">最近查询记录(点击直接查看，不用重新输入)</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                  data.history.map(h => `<button type="button" class="ga-btn ga-btn--ghost ga-btn--sm" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-click="gsRerunFromHistory" data-arg="${escapeHtml(h.question)}" title="${escapeHtml(h.question)}">${escapeHtml(h.title || h.question)}</button>`).join('') +
                  '</div>';
            } catch (e) { host.innerHTML = ''; }
        }

        // 历史记录只保留"问过什么问题"，不保留"当时的结果"——点历史记录里的问题，每次都
        // 重新调用AI生成最新方案，而不是把当时保存的旧结果原样显示出来(旧结果会一直是旧结果，
        // 数据早就变了，分析也早就过时了，用户点历史记录的目的是"再问一次"而不是"看旧答案")。
        function gsRerunFromHistory(question) {
            const q = document.getElementById('gs-custom-q');
            if (q) q.value = question;
            gsAnalyzeCustom();
        }

        async function gsExportPdf(btn) {
            // window.print()在企业微信/微信内置浏览器里经常被平台静默屏蔽(不报错，就是没反应)，
            // 改用html2canvas截图+jsPDF打包成文件下载，不依赖浏览器打印能力，中文内容截图式
            // 生成不存在字体缺失问题，在企微内置浏览器里也能正常触发下载。
            const box = document.querySelector('#gs-modal .gs-modal__box');
            if (!box) return;
            if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
                showNotification('PDF组件未加载完成，请刷新页面后重试', 'error');
                return;
            }
            const originalText = btn ? btn.textContent : '';
            if (btn) { btn.textContent = '生成中...'; btn.disabled = true; }
            document.body.classList.add('gs-printing');
            try {
                await new Promise(r => setTimeout(r, 50)); // 等gs-printing的样式(隐藏按钮)先应用再截图
                const canvas = await html2canvas(box, { scale: 2, backgroundColor: '#12162b', useCORS: true });
                const imgData = canvas.toDataURL('image/jpeg', 0.92);
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'pt', 'a4');
                const pageWidth = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();
                const imgWidth = pageWidth;
                const imgHeight = canvas.height * imgWidth / canvas.width;
                let heightLeft = imgHeight;
                let position = 0;
                pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
                while (heightLeft > 0) {
                    position = heightLeft - imgHeight;
                    pdf.addPage();
                    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
                    heightLeft -= pageHeight;
                }
                const title = (document.getElementById('gs-modal-title')?.textContent || '增长方案').replace(/[^一-龥a-zA-Z0-9]/g, '');
                pdf.save(`${title}_${new Date().toISOString().slice(0, 10)}.pdf`);
            } catch (e) {
                showNotification('PDF导出失败: ' + e.message, 'error');
            } finally {
                document.body.classList.remove('gs-printing');
                if (btn) { btn.textContent = originalText; btn.disabled = false; }
            }
        }

        async function gsConfirm(roundId, decision) {
            if (!confirm(decision === 'advance' ? '确认本轮达成,关闭轮次?下一轮将以本轮实际值为新基线。' : '确认同目标重跑?本轮关闭后可重新生成任务方案。')) return;
            try {
                const res = await fetch(`/api/diagnosis/solutions/rounds/${roundId}/confirm`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + dxToken() },
                    body: JSON.stringify({ decision }),
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                showNotification('轮次已关闭', 'success');
                gsOpenDetail(gsCurrentDetail.problem_key); gsLoadCards();
            } catch (e) { showNotification('操作失败: ' + e.message, 'error'); }
        }

        function dxRenderCards(stores, start, end) {
            const container = document.getElementById('dx-cards-container');
            if (!container) return;
            if (!stores || stores.length === 0) {
                container.innerHTML = '<div class="dx-empty">暂无诊断数据</div>';
                return;
            }
            container.innerHTML = stores.map(s => {
                const isDecline = !!s.revenue.is_decline;
                const changePct = Number(s.revenue.change_pct || 0);
                const changeSign = changePct >= 0 ? '+' : '';
                const revenue = s.revenue || {};
                const recs = dxNormalizeActions(s.recommendations || [], 'rule_engine');
                const topAnomalies = (s.anomalies || []).slice(0, 4).map(a =>
                    `<span class="dx-chip dx-chip--bad">${escapeHtml(a.type)}</span>`
                ).join('');
                const topRecs = recs.slice(0, 3).map(r =>
                    `<div class="dx-rec"><span class="dx-source ${escapeHtml(r.sourceClass)}">${escapeHtml(r.sourceLabel)}</span><span>${escapeHtml(r.title)}</span></div>`
                ).join('');
                const moreRecs = recs.length > 3 ? `<div class="dx-more">还有${recs.length - 3}条建议，点击查看完整报告 →</div>` : (recs.length > 0 ? `<div class="dx-more">点击查看完整诊断报告 →</div>` : '');
                return `<div class="dx-card ${isDecline ? 'dx-card--decline' : ''}" onclick="openDiagnosisDetail('${encodeURIComponent(s.store)}', '${start}', '${end}')">
                  <div class="dx-card__top">
                    <span class="dx-card__store">${escapeHtml(s.store)}</span>
                    <span class="dx-pill ${isDecline ? 'dx-pill--bad' : 'dx-pill--ok'}">${isDecline ? '营收下降' : '营收正常'}</span>
                  </div>
                  <div class="dx-headline">${escapeHtml(s.summary?.headline || '')}</div>
                  <div class="dx-metrics dx-metrics--five">
                    <div class="dx-metric dx-metric--revenue"><div class="v">${dxFmtMoney(revenue.total || 0)}</div><div class="l">本期营收</div><span class="dx-metric__delta">${changeSign}${changePct.toFixed(1)}%</span></div>
                    <div class="dx-metric dx-metric--traffic"><div class="v">${Number(revenue.total_traffic || 0).toLocaleString('zh-CN')}</div><div class="l">堂食总客流</div><span class="dx-metric__delta">日均 ${Number(revenue.avg_daily_traffic || 0).toLocaleString('zh-CN')} 人</span></div>
                    <div class="dx-metric dx-metric--ticket"><div class="v">${dxFmtMoney(revenue.avg_table_spend || revenue.avg_order_value || 0)}</div><div class="l">堂食桌均(折前)</div><span class="dx-metric__delta">折前堂食人均 ${dxFmtMoney(revenue.avg_spend_per_person || 0)} · 新客 ${s.summary?.new_customer_ratio || '-'}</span></div>
                    <div class="dx-metric dx-metric--takeout"><div class="v">${Number(revenue.delivery_share_pct || 0).toFixed(1)}%</div><div class="l">外卖占比</div><span class="dx-metric__delta">${dxFmtMoney(revenue.total_delivery_revenue || 0)}</span></div>
                    <div class="dx-metric dx-metric--efficiency"><div class="v">${dxFmtMoney(revenue.avg_efficiency || 0)}</div><div class="l">人效值</div><span class="dx-metric__delta">${s.action_suggestion_count || 0} 条行动</span></div>
                  </div>
                  <div class="dx-chips">${topAnomalies}${s.action_suggestion_count ? `<span class="dx-chip dx-chip--info">行动建议 ${s.action_suggestion_count} 条</span>` : ''}</div>
                  ${topRecs}
                  ${moreRecs}
                </div>`;
            }).join('');
        }

        async function openDiagnosisDetail(storeEncoded, start, end) {
            const store = decodeURIComponent(storeEncoded);
            document.getElementById('dx-backdrop')?.classList.add('show');
            document.getElementById('dx-detail-panel')?.classList.add('show');
            const content = document.getElementById('dx-detail-content');
            if (content) content.innerHTML = '<div class="dx-empty">⏳ 加载详情...</div>';
            try {
                const res = await fetch(`/api/diagnosis/store/${storeEncoded}?start=${start}&end=${end}`, {
                    headers: { 'Authorization': 'Bearer ' + dxToken() }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || 'unknown');
                dxRenderDetail(data.diagnosis);
            } catch (e) {
                if (content) content.innerHTML = `<div class="dx-empty">❌ 加载失败: ${escapeHtml(e.message)}</div>`;
            }
        }

        function closeDiagnosisDetail() {
            dxCloseAnomalyDetail();
            document.getElementById('dx-backdrop')?.classList.remove('show');
            document.getElementById('dx-detail-panel')?.classList.remove('show');
        }

        function dxRenderDetail(d) {
            const content = document.getElementById('dx-detail-content');
            if (!content) return;
            const revenue = d.revenue || {};
            const customer = d.customer || {};
            const anomalies = Array.isArray(d.anomalies) ? d.anomalies : [];
            window.__DX_CURRENT_ANOMALIES = anomalies;
            dxCloseAnomalyDetail();
            const recommendations = dxNormalizeActions(d.recommendations || [], 'rule_engine');
            const actionSuggestions = dxNormalizeActions(d.action_suggestions || [], 'AI');
            const allActions = [...actionSuggestions, ...recommendations];
            const groupedActions = allActions.reduce((acc, item) => {
                const key = item.sourceLabel || '系统';
                if (!acc[key]) acc[key] = [];
                acc[key].push(item);
                return acc;
            }, {});
            const groupOrder = ['PLLM', 'AI', '规则', '系统'];
            const actionGroups = Object.keys(groupedActions).sort((a, b) => {
                const ai = groupOrder.indexOf(a);
                const bi = groupOrder.indexOf(b);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            const heroMetrics = [
                { key: '本期营收', value: dxFmtMoney(revenue.total || 0), delta: dxFmtPct(revenue.change_pct || 0), cls: 'dx-metric--revenue' },
                { key: '堂食总客流', value: Number(revenue.total_traffic || 0).toLocaleString('zh-CN'), delta: '日均 ' + Number(revenue.avg_daily_traffic || 0).toLocaleString('zh-CN') + ' 人', cls: 'dx-metric--traffic' },
                { key: '堂食桌均(折前)', value: dxFmtMoney(revenue.avg_table_spend || revenue.avg_order_value || 0), delta: '折前堂食人均 ' + dxFmtMoney(revenue.avg_spend_per_person || 0) + ' · 新客 ' + (customer.new_ratio != null ? customer.new_ratio + '%' : '-'), cls: 'dx-metric--ticket' },
                { key: '外卖占比', value: Number(revenue.delivery_share_pct || 0).toFixed(1) + '%', delta: dxFmtMoney(revenue.total_delivery_revenue || 0), cls: 'dx-metric--takeout' },
                { key: '人效值', value: dxFmtMoney(revenue.avg_efficiency || 0), delta: (d.summary?.action_suggestion_count || 0) + ' 条行动建议', cls: 'dx-metric--efficiency' }
            ];

            const contribHTML = (revenue.contributions || []).length > 0
                ? `<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">📊 贡献度分析</div><div class="dx-board__meta">提升/增加为 +，下降/减少为 -</div></div></div><div class="dx-section-grid dx-section-grid--2">${revenue.contributions.map(c => {
                    const good = dxIsGoodFactor(c.factor, c.direction);
                    return `<div class="dx-metric-card"><div class="k">${escapeHtml(c.factor)}</div><div class="v" style="color:${good ? '#5EEAD4' : '#FF7A90'}">${escapeHtml(c.impact || '-')}</div><div class="s">${escapeHtml(c.detail || '')}</div></div>`;
                  }).join('')}</div></div>`
                : '<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">📊 贡献度分析</div><div class="dx-board__meta">按因素拆解本期波动来源</div></div></div><div class="dx-empty dx-empty--compact">暂无贡献度数据</div></div>';

            const catHTML = (revenue.categories || []).length > 0
                ? `<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">🍽️ 品类营收</div><div class="dx-board__meta">各档口销售金额、占比与制作量（本期汇总）</div></div></div><div class="dx-section-grid dx-section-grid--2">${revenue.categories.slice(0, 6).map(c => {
                    const sharePct = Number(c.share_pct || 0);
                    const shareColor = sharePct >= 25 ? '#5EEAD4' : (sharePct >= 15 ? '#FFC46B' : '#FF7A90');
                    return `<div class="dx-metric-card"><div class="k">${escapeHtml(c.name)}</div><div class="v" style="font-size:16px;">${dxFmtMoney(c.avg_daily || 0)} <span class="dx-cat-share" style="color:${shareColor}">${sharePct.toFixed(1)}%</span></div><div class="s">占全部营收 ${sharePct.toFixed(1)}% · 本期合计 ${dxFmtMoney(c.total || 0)}${c.qty_total != null ? ' · ' + Number(c.qty_total).toLocaleString('zh-CN') + '份' : ''}</div></div>`;
                  }).join('')}</div></div>`
                : '<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">🍽️ 品类营收</div><div class="dx-board__meta">各档口销售金额与制作量（本期汇总）</div></div></div><div class="dx-empty dx-empty--compact">本期日报未填写品类销售数据</div></div>';

            const anomHTML = anomalies.length
                ? `<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">🔴 本周异常（${anomalies.length}项）</div><div class="dx-board__meta">点击查看每条异常的基础信息与触发记录</div></div></div><div class="dx-section-grid dx-section-grid--2">${anomalies.map((a, idx) =>
                    `<div class="dx-metric-card dx-anomaly-card" data-click="dxShowAnomalyDetail" data-arg="${idx}" data-arg-type="number" role="button" tabindex="0">
                        <div class="k">${escapeHtml(a.type)}</div>
                        <div class="v" style="font-size:16px;color:${a.severity === 'high' ? '#FF7A90' : '#FFC46B'}">${escapeHtml(a.count != null ? String(a.count) : '-') }</div>
                        <div class="s">${escapeHtml(a.detail || a.description || '')}</div>
                        <div class="dx-anomaly-card__hint">点击查看详情 →</div>
                    </div>`
                ).join('')}</div></div>`
                : '<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">🔴 本周异常</div><div class="dx-board__meta">异常越具体，整改越好落地</div></div></div><div class="dx-empty dx-empty--compact">本期无异常</div></div>';

            const sourceSummary = actionGroups.map(group => {
                const items = groupedActions[group] || [];
                return `<div class="dx-metric-card">
                    <div class="k">${escapeHtml(group)}</div>
                    <div class="v" style="font-size:16px;">${items.length}</div>
                    <div class="s">行动建议分组</div>
                </div>`;
            }).join('');

            const actionPanels = actionGroups.map(group => {
                const items = groupedActions[group] || [];
                return `<div class="dx-board">
                    <div class="dx-board__head">
                        <div><div class="dx-board__title">${escapeHtml(group)} 建议</div><div class="dx-board__meta">${items.length} 项，按来源拆分执行</div></div>
                        <div class="dx-chip dx-chip--info">${escapeHtml(group)}</div>
                    </div>
                    <div class="dx-action-grid">${items.map(item => {
                        const notes = dxBuildActionNotes(item);
                        const steps = item.actions || [];
                        return `<div class="dx-action-card ${escapeHtml(item.cardClass)}">
                            <div class="dx-action-card__top">
                                <div>
                                    <div class="dx-action-card__title">${escapeHtml(item.title)}</div>
                                    <div class="dx-action-card__meta">
                                        <span class="dx-source ${escapeHtml(item.sourceClass)}">${escapeHtml(item.sourceLabel)}</span>
                                        <span class="dx-source">${escapeHtml(item.priority === 'high' ? '高优先级' : '普通优先级')}</span>
                                        ${item.status ? `<span class="dx-source">${escapeHtml(item.status)}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            ${item.detail ? `<div class="dx-action-card__detail">${escapeHtml(item.detail)}</div>` : ''}
                            ${notes.length ? `<div class="dx-action-card__detail" style="margin-top:8px;color:#9AA3C7;">${notes.map(n => escapeHtml(n)).join(' · ')}</div>` : ''}
                            ${dxRenderActionSteps(steps)}
                        </div>`;
                    }).join('')}</div>
                </div>`;
            }).join('');

            const actionSummaryHTML = sourceSummary
                ? `<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">💡 行动建议总览</div><div class="dx-board__meta">PLLM、AI 和规则建议分开看，便于落地</div></div><div class="dx-chip dx-chip--info">${allActions.length} 条</div></div><div class="dx-section-grid dx-section-grid--2">${sourceSummary}</div></div>`
                : '<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">💡 行动建议总览</div><div class="dx-board__meta">PLLM、AI 和规则建议分开看，便于落地</div></div></div><div class="dx-empty dx-empty--compact">暂无建议</div></div>';

            const untrained = d.training?.employees_without_training || [];
            const trainingScope = d.training?.scope_label || '截至本期结束日，在职且从未被指派任何培训任务';
            const trainingEmpty = d.training?.empty_label || '全员均已指派培训任务，无漏培人员';
            const trainingHTML = `<div class="dx-board"><div class="dx-board__head"><div><div class="dx-board__title">👤 未指派培训任务员工</div><div class="dx-board__meta">${escapeHtml(trainingScope)}</div></div><div class="dx-chip dx-chip--info">${untrained.length} 人</div></div><div class="dx-d-people">${untrained.length ? untrained.map(e => `<span class="dx-d-tag">${escapeHtml(e.name)} (${escapeHtml(e.position || '-')}${e.is_new ? ' · 新入职' : ''})</span>`).join('') : `<span class="dx-d-tag" style="color:#5EEAD4;">✅ ${escapeHtml(trainingEmpty)}</span>`}</div></div>`;

            content.innerHTML = `
                <div class="dx-detail-hero">
                  <h2 class="dx-detail-hero__title">${escapeHtml(d.store)}</h2>
                  <div class="dx-detail-hero__desc">${escapeHtml(d.summary?.headline || '')}</div>
                  <div class="dx-detail-hero__metrics">${heroMetrics.map(m => `<div class="dx-metric ${escapeHtml(m.cls)}"><div class="v">${escapeHtml(m.value)}</div><div class="l">${escapeHtml(m.key)}</div><span class="dx-metric__delta">${escapeHtml(m.delta)}</span></div>`).join('')}</div>
                </div>

                <div class="dx-detail-layout">
                  <div class="dx-detail-stack">
                    ${contribHTML}
                    ${catHTML}
                  </div>
                  <div class="dx-detail-stack">
                    ${anomHTML}
                  </div>
                </div>

                ${actionSummaryHTML}

                <div class="dx-board" style="margin-top:12px;">
                  <div class="dx-board__head">
                    <div><div class="dx-board__title">💡 分组建议行动</div><div class="dx-board__meta">每个来源都是独立卡片，方便店长逐条执行</div></div>
                    <div class="dx-chip dx-chip--info">${actionGroups.length} 组</div>
                  </div>
                  <div class="dx-section-grid dx-section-grid--2">${actionPanels || '<div class="dx-empty dx-empty--compact">暂无建议</div>'}</div>
                </div>

                <div style="margin-top:12px;">${trainingHTML}</div>
            `;
        }

        async function submitFileUpload() {
            const fileInput = document.getElementById('upload-file-input');
            const file = fileInput?.files?.[0];
            if (!file) { showNotification('请先选择文件', 'warning'); return; }

            const btn = document.getElementById('uf-submit-btn');
            if (btn) { btn.disabled = true; btn.textContent = '上传中...'; }

            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('file_type', document.getElementById('upload-file-type').value);
                formData.append('store', document.getElementById('upload-file-store').value);
                formData.append('upload_note', document.getElementById('upload-file-note').value);

                const res = await fetch('/api/files/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '')}` },
                    body: formData
                });
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '上传失败');
                const data = await res.json();
                showNotification(data.message || '文件上传成功', 'success');
                closeUploadFileDialog();
                loadFilesList(1);
            } catch (e) {
                console.error('文件上传失败:', e);
                showNotification('上传失败：' + (e?.message || '未知错误'), 'error');
                if (btn) { btn.disabled = false; btn.textContent = '⬆️ 上传'; }
            }
        }

        function growthAuthHeaders(multipart) {
            var h = { 'Authorization': 'Bearer ' + (HRMS_API.token() || '') };
            if (!multipart) h['Content-Type'] = 'application/json';
            return h;
        }

        function growthRoleCode() {
            return hrmsNormalizeRoleCode((currentUser && currentUser.role) || (window.__user_role) || '');
        }

        function canAccessGrowthModule() {
            var role = growthRoleCode();
            return role === 'admin';
        }

        function updateGrowthModuleVisibility() {
            var canAccess = canAccessGrowthModule();
            document.querySelectorAll('.growth-mobile-nav').forEach(function(el) { el.style.display = canAccess ? '' : 'none'; });
            document.querySelectorAll('.growth-nav-link').forEach(function(el) { el.style.display = canAccess ? '' : 'none'; });
        }

        function canAccessStrategyModule() {
            if (!currentUser) return false;
            var role = String(currentUser.role || '').trim();
            return ['admin', 'hq_manager', 'store_manager', 'store_production_manager'].includes(role);
        }

        function updateStrategyModuleVisibility() {
            var canAccess = canAccessStrategyModule();
            var navEl = document.getElementById('strategy-nav-item');
            if (navEl) navEl.style.display = canAccess ? '' : 'none';
            var createBtn = document.getElementById('sp-create-btn-wrap');
            var createTab = document.getElementById('sp-create-tab');
            var isAdminOrHq = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER);
            if (createBtn) createBtn.style.display = (canAccess && isAdminOrHq) ? '' : 'none';
            if (createTab) createTab.style.display = isAdminOrHq ? '' : 'none';
        }

        var __growthActiveTab = 'dashboard';
        var __growthTrendIndicator = 'scan';
        function refreshGrowthCurrentTab() {
            showGrowthTab(__growthActiveTab || 'dashboard');
        }
        // ── 增长模块 6 大分组（14→6 重组，零DOM搬迁：内容区按 id 显示/隐藏）──
        var GROWTH_GROUPS = [
            { key: 'dashboard', label: '看板', members: ['dashboard', 'ontology'] },
            { key: 'audience', label: '客户数据', members: ['pos', 'wecom'] },
            { key: 'engine', label: '自动营销', members: ['automarketing', 'abtests', 'paymentrules'] },
            { key: 'content', label: '海报创意', members: ['posters'] },
            { key: 'execution', label: '执行中心', members: ['actions', 'exec-logs'] },
            { key: 'settings', label: '设置治理', members: ['wecomconfig', 'constraints', 'rules'] }
        ];
        var GROWTH_MEMBER_LABEL = {
            dashboard: '看板', ontology: '餐厅增长大脑', posdiagnosis: 'POS诊断导入', profiles: '360客人档案', maintenance: '维护导航舱', pos: 'POS消费', wecom: '企微客户',
            automarketing: '规则引擎', abtests: 'A/B测试', paymentrules: '支付发券',
            campaigns: '活动管理', posters: '海报创意', public: '公域品宣', contentsys: '内容系统',
            actions: 'AI建议', 'exec-logs': '执行记录',
            wecomconfig: '企微配置', constraints: '营销约束', rules: '经营规则设置'
        };
        var GROWTH_ALL_MEMBERS = ['dashboard', 'ontology', 'wecom', 'wecomconfig', 'campaigns', 'profiles', 'posdiagnosis', 'maintenance', 'constraints', 'rules', 'posters', 'public', 'actions', 'abtests', 'contentsys', 'pos', 'exec-logs', 'automarketing', 'paymentrules'];
        var __growthActiveSub = {}; // group.key -> 最近激活的成员

        function growthGroupOf(member) {
            for (var i = 0; i < GROWTH_GROUPS.length; i++) {
                if (GROWTH_GROUPS[i].members.indexOf(member) !== -1) return GROWTH_GROUPS[i];
            }
            return null;
        }

        function loadGrowthMember(member) {
            if (member === 'wecom') { loadWechatWorkStats(); loadWechatWorkCustomers(); }
            else if (member === 'campaigns') { loadCampaignPlans(); loadContentCalendar(); }
            else if (member === 'profiles') { loadGrowthProfiles(); }
            else if (member === 'posdiagnosis') { loadCustomerOpsLatest(); }
            else if (member === 'maintenance') { loadCampaignLog(); loadAutoMarketingSummary(); }
            else if (member === 'constraints') { loadGrowthConstraints(); }
            else if (member === 'actions') { loadGrowthActionBoard(); }
            else if (member === 'abtests') { loadGrowthAbTests(); loadAbTemplates(); }
            else if (member === 'contentsys') { loadGrowthContentSuggestions(); loadGrowthContentPerformance(); loadGrowthLearnings(); }
            else if (member === 'posters') {
                loadPosterTemplates(); loadPosterHistory(); loadCreativeAssets(); loadPublicChannels();
                populatePosterStoreSelect(); initAutoCampaignId();
                renderTagCheckboxes('poster-gen-purposes', __CONTENT_PURPOSE_TAGS, []);
                renderTagCheckboxes('poster-gen-channels', __CONTENT_CHANNEL_TAGS, []);
                populatePosterGenStylePrompt(); populateTemplateFormSelects();
            }
            else if (member === 'public') { refreshPublicContentWorkspace(); }
            else if (member === 'pos') { loadPosStats(); }
            else if (member === 'exec-logs') { loadExecutionLogs(); }
            else if (member === 'wecomconfig') { loadStoreWecomConfigs(); }
            else if (member === 'rules') { loadGrowthRules(); }
            else if (member === 'automarketing') { loadAutoMarketing(); }
            else if (member === 'paymentrules') { loadPaymentRules(); }
            else if (member === 'ontology') { loadGrowthOntologyBrain(); }
            else { refreshGrowthDashboard(); }
        }

        function growthOntologyStoreQS() {
            var storeId = document.getElementById('growth-store-filter')?.value || '';
            return storeId ? ('?store_id=' + encodeURIComponent(storeId)) : '';
        }
        async function runGrowthOntologyDiagnosis() {
            var host = document.getElementById('growth-ontology-brain');
            if (host) host.innerHTML = '<div class="rep-pay-empty">正在生成今日诊断…</div>';
            try {
                var storeId = document.getElementById('growth-store-filter')?.value || '';
                var body = { store_id: storeId, date: new Date().toISOString().slice(0, 10) };
                var r = await fetch('/api/ontology/diagnosis/run', { method:'POST', headers:growthAuthHeaders(), body:JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'diagnosis_failed');
                await loadGrowthOntologyBrain();
                showNotification('今日诊断已生成', 'success');
            } catch (e) {
                if (host) host.innerHTML = '<div class="rep-pay-empty" style="color:#ef4444;">诊断失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }
        async function generateGrowthOpportunityTasks(oppId, btn) {
            try {
                var storeId = document.getElementById('growth-store-filter')?.value || '';
                var r = await fetch('/api/ontology/opportunities/' + encodeURIComponent(oppId) + '/generate-tasks', { method:'POST', headers:growthAuthHeaders(), body:JSON.stringify({ store_id: storeId }) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'generate_failed');
                if (btn) btn.outerHTML = '<span style="color:#22c55e;font-size:12px;">已生成正式任务 ' + (d.tasks || []).length + ' 个</span>';
                showNotification('已生成正式任务', 'success');
            } catch (e) {
                if (btn) btn.insertAdjacentHTML('afterend', '<div style="color:#ef4444;font-size:12px;margin-top:6px;">创建失败：' + escapeHtml(e?.message || e) + '</div>');
            }
        }
        async function loadGrowthOntologyBrain() {
            var host = document.getElementById('growth-ontology-brain');
            if (!host) return;
            host.innerHTML = '<div class="rep-pay-empty">加载中…</div>';
            try {
                var qs = growthOntologyStoreQS();
                var report = await fetch('/api/ontology/closed-loop-report' + qs, { headers:growthAuthHeaders() }).then(function(r){ return r.json(); });
                var issues = await fetch('/api/ontology/issues' + qs, { headers:growthAuthHeaders() }).then(function(r){ return r.json(); }).catch(function(){ return { issues: [] }; });
                var opportunities = await fetch('/api/ontology/opportunities' + qs, { headers:growthAuthHeaders() }).then(function(r){ return r.json(); }).catch(function(){ return { opportunities: [] }; });
                if (report.ontologyStatus === 'insufficient_data') {
                    host.innerHTML = '<div class="rep-pay-empty">当前数据不足，暂无法生成经营判断。</div>';
                    return;
                }
                var issueRows = issues.issues || report.issues || [];
                var oppRows = opportunities.opportunities || report.opportunities || [];
                var evidence = (report.attributionSummary && report.attributionSummary.evidenceDetails) || [];
                var issueHtml = issueRows.slice(0, 6).map(function(x) {
                    return '<div style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);">'
                        + '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#fff;">' + escapeHtml(x.boss_language_summary || x.issue_title || '-') + '</b><span style="color:' + (x.severity === 'P1' ? '#fb7185' : '#c9a96a') + ';font-weight:800;">' + escapeHtml(x.severity || '-') + '</span></div>'
                        + '<div style="font-size:12px;color:rgba(226,232,240,.56);margin-top:4px;">' + escapeHtml(x.issue_type || '') + ' · 置信度 ' + escapeHtml(String(x.confidence_score || '-')) + '</div>'
                        + '</div>';
                }).join('');
                var oppHtml = oppRows.slice(0, 6).map(function(x) {
                    return '<div style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);">'
                        + '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#fff;">' + escapeHtml(x.title || '-') + '</b><span style="color:#38bdf8;">' + escapeHtml(x.priority || '-') + '</span></div>'
                        + '<div style="font-size:12px;color:rgba(226,232,240,.58);margin:4px 0 8px;">' + escapeHtml(x.description || '') + '</div>'
                        + '<button class="rep-seg-btn rep-seg-btn--active" style="width:auto;padding:7px 12px;" onclick="generateGrowthOpportunityTasks(\'' + escapeHtml(x.opportunity_id || '') + '\', this)">生成任务草稿并确认创建</button>'
                        + '</div>';
                }).join('');
                var taskHtml = (report.tasks || []).slice(0, 8).map(function(t) {
                    return '<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.06);font-size:12px;line-height:1.55;">'
                        + '<b style="color:#fff;">' + escapeHtml(t.title || '-') + '</b>'
                        + '<div style="color:rgba(226,232,240,.58);">状态：' + escapeHtml(t.status || '-') + ' · 负责人：' + escapeHtml(t.assignee_role || t.assignee_username || '-') + ' · 截止：' + escapeHtml(String(t.due_at || '').slice(0, 10) || '-')
                        + '</div></div>';
                }).join('');
                var evHtml = evidence.length ? '<details style="margin-top:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;"><summary style="cursor:pointer;color:#fff;font-weight:800;">归因证据 · 以下订单为本次营销触达后窗口内产生的真实消费记录</summary>'
                    + evidence.slice(0, 20).map(function(e) {
                        var ev = e.evidence || {};
                        var assisted = e.attributionType === 'assisted' ? '<div style="color:#c9a96a;margin-top:4px;">辅助归因：客户在触达后窗口内回店，但未使用对应优惠券。</div>' : '';
                        return '<div style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);font-size:12px;line-height:1.6;">'
                            + '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#fff;">客户 ' + escapeHtml(e.customerId || '-') + '</b><span style="color:#38bdf8;">' + escapeHtml(e.attributionType || '-') + '</span></div>'
                            + '<div style="color:rgba(226,232,240,.65);">触达：' + escapeHtml(String(ev.touchTime || '-').slice(0, 16)) + ' · 回店：' + escapeHtml(String(ev.conversionTime || '-').slice(0, 16)) + ' · 订单：' + escapeHtml(e.relatedOrderId || '-') + '</div>'
                            + '<div style="color:rgba(226,232,240,.55);">金额：' + fmtCustMoney(e.orderAmount || 0) + ' · 用券：' + (ev.couponUsed ? '是' : '否') + '</div>'
                            + assisted + '</div>';
                    }).join('') + '</details>' : '';
                host.innerHTML = ''
                    + '<div class="rep-metric" style="text-align:left;margin-bottom:12px;"><div class="k">AI经营结论</div><div style="font-size:15px;color:#fff;line-height:1.7;margin-top:8px;">' + escapeHtml(report.boss_summary || report.bossSummary || '当前数据不足，暂无法生成经营判断。') + '</div></div>'
                    + '<div class="rep-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:12px;">'
                    + custopsMiniMetric('经营问题', issueRows.length, '经营问题地图', '#fb7185')
                    + custopsMiniMetric('增长机会', oppRows.length, '增长机会列表', '#38bdf8')
                    + custopsMiniMetric('闭环任务', (report.tasks || []).length, '动作闭环看板', '#22c55e')
                    + custopsMiniMetric('归因营业额', fmtCustMoney(report.attributionSummary?.attributedRevenue || 0), '真实订单支撑', '#c9a96a')
                    + '</div>'
                    + '<div class="rep-dashboard-grid">'
                    + '<div class="rep-metric" style="text-align:left;"><div class="k">经营问题地图</div>' + (issueHtml || '<div class="rep-pay-empty">暂无经营问题</div>') + '</div>'
                    + '<div class="rep-metric" style="text-align:left;"><div class="k">增长机会列表</div>' + (oppHtml || '<div class="rep-pay-empty">暂无增长机会</div>') + '</div>'
                    + '</div>'
                    + '<div class="rep-dashboard-grid" style="margin-top:12px;">'
                    + '<div class="rep-metric" style="text-align:left;"><div class="k">动作闭环看板</div>' + (taskHtml || '<div class="rep-pay-empty">暂无任务</div>') + '</div>'
                    + '<div class="rep-metric" style="text-align:left;"><div class="k">老板版闭环报告</div><div style="font-size:12px;color:rgba(226,232,240,.65);line-height:1.7;margin-top:8px;">' + escapeHtml((report.key_findings_for_owner || []).join('；') || report.confidence_note || '') + '</div>' + evHtml + '</div>'
                    + '</div>';
            } catch (e) {
                host.innerHTML = '<div class="rep-pay-empty" style="color:#ef4444;">加载失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }

        var __GROWTH_RULES_CACHE = [];
        var __GROWTH_RULE_THRESHOLD_LABELS = {
            days_min: '沉睡客户起始天数',
            days_max: '沉睡客户结束天数',
            min_historical_visit_count: '优先维护最低消费次数',
            min_total_spend: '优先维护最低消费金额',
            first_visit_days_min: '新客二次转化起始天数',
            first_visit_days_max: '新客二次转化结束天数',
            revenue_decline_threshold: '营收下降阈值',
            repeat_rate_threshold: '复购率健康线',
            marketing_conversion_threshold: '营销转化健康线'
        };
        function growthRuleScopeLabel(scope) {
            if (scope === 'store') return '当前门店标准';
            if (scope === 'tenant') return '品牌标准';
            return '系统默认标准';
        }
        function growthRuleThresholdMap(rule) {
            var m = {};
            (rule.thresholds || []).forEach(function(t) {
                if (m[t.threshold_key] == null) m[t.threshold_key] = t;
            });
            return m;
        }
        async function loadGrowthRules() {
            var list = document.getElementById('growth-rules-list');
            var hits = document.getElementById('growth-rule-hits-list');
            if (list) list.innerHTML = '<div class="rep-pay-empty">加载经营规则…</div>';
            try {
                var storeId = document.getElementById('growth-store-filter')?.value || '';
                var qs = storeId ? ('?store_id=' + encodeURIComponent(storeId)) : '';
                var data = await fetch('/api/ontology/rules' + qs, { headers:growthAuthHeaders() }).then(function(r){ return r.json(); });
                if (!data.ok) throw new Error(data.error || 'rules_failed');
                __GROWTH_RULES_CACHE = data.rules || [];
                var editableKeys = Object.keys(__GROWTH_RULE_THRESHOLD_LABELS);
                list.innerHTML = __GROWTH_RULES_CACHE.map(function(rule) {
                    var thresholds = growthRuleThresholdMap(rule);
                    var editable = editableKeys.filter(function(k){ return thresholds[k]; });
                    var thresholdHtml = editable.length ? editable.map(function(k) {
                        var t = thresholds[k];
                        return '<label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:rgba(226,232,240,.68);">'
                            + '<span>' + escapeHtml(__GROWTH_RULE_THRESHOLD_LABELS[k]) + '</span>'
                            + '<input class="dr-store-select growth-rule-threshold" data-rule="' + escapeHtml(rule.rule_id) + '" data-key="' + escapeHtml(k) + '" value="' + escapeHtml(String(t.threshold_value ?? '')) + '" style="height:34px;">'
                            + '</label>';
                    }).join('') : '<div style="font-size:12px;color:rgba(226,232,240,.45);">暂无可编辑判断标准</div>';
                    return '<div style="border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;margin-bottom:10px;background:rgba(0,0,0,.20);">'
                        + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px;">'
                        + '<div><div style="font-weight:800;color:#fff;">' + escapeHtml(rule.rule_name || '-') + '</div>'
                        + '<div style="font-size:12px;color:rgba(226,232,240,.55);margin-top:4px;">' + escapeHtml(rule.business_domain || '-') + ' · ' + escapeHtml(growthRuleScopeLabel(rule.rule_scope)) + '</div></div>'
                        + '<div style="font-size:12px;color:#38bdf8;font-weight:800;">近30天命中 ' + escapeHtml(String(rule.recentHitCount || 0)) + ' 次</div>'
                        + '</div>'
                        + '<div class="rep-filters__grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">' + thresholdHtml + '</div>'
                        + '</div>';
                }).join('') || '<div class="rep-pay-empty">暂无经营规则</div>';
                var hitData = await fetch('/api/ontology/rule-hits' + qs + (qs ? '&' : '?') + 'limit=20', { headers:growthAuthHeaders() }).then(function(r){ return r.json(); }).catch(function(){ return { hits: [] }; });
                var hitRows = hitData.hits || [];
                hits.innerHTML = hitRows.map(function(h) {
                    var rule = (__GROWTH_RULES_CACHE || []).find(function(r){ return r.rule_id === h.rule_id; });
                    var generated = [h.generated_issue_id ? '问题' : '', h.generated_opportunity_id ? '机会' : '', h.generated_task_id ? '任务' : ''].filter(Boolean).join(' / ') || '记录';
                    return '<div style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06);font-size:12px;line-height:1.65;">'
                        + '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#fff;">' + escapeHtml(rule?.rule_name || h.rule_id || '-') + '</b><span style="color:#22c55e;">' + escapeHtml(generated) + '</span></div>'
                        + '<div style="color:rgba(226,232,240,.6);">门店：' + escapeHtml(h.store_id || '全部') + ' · ' + escapeHtml(String(h.hit_at || '').slice(0, 16).replace('T', ' ')) + '</div>'
                        + '<div style="color:rgba(226,232,240,.75);">' + escapeHtml(h.boss_language_output || '已按经营规则生成判断。') + '</div>'
                        + '</div>';
                }).join('') || '<div class="rep-pay-empty">暂无命中记录</div>';
            } catch (e) {
                if (list) list.innerHTML = '<div class="rep-pay-empty" style="color:#ef4444;">加载失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }
        async function saveGrowthRuleThresholds() {
            try {
                var storeId = document.getElementById('growth-store-filter')?.value || '';
                var grouped = {};
                document.querySelectorAll('.growth-rule-threshold').forEach(function(input) {
                    var ruleId = input.getAttribute('data-rule');
                    var key = input.getAttribute('data-key');
                    if (!grouped[ruleId]) grouped[ruleId] = {};
                    grouped[ruleId][key] = input.value;
                });
                for (var ruleId in grouped) {
                    var r = await fetch('/api/ontology/rules/' + encodeURIComponent(ruleId), {
                        method:'PUT',
                        headers:growthAuthHeaders(),
                        body:JSON.stringify({ store_id: storeId, thresholds: grouped[ruleId] })
                    }).then(function(x){ return x.json(); });
                    if (!r.ok) throw new Error(r.error || 'save_failed');
                }
                showNotification('当前门店经营标准已保存', 'success');
                await loadGrowthRules();
            } catch (e) {
                showNotification('经营规则保存失败：' + (e?.message || e), 'error');
            }
        }

        /* ══ 增长看板 v2 · 模块抽屉 + 筛选摘要 ══
           原来一级 9 个 tab 横向滚动，手机上只看得见 2.5 个且无滚动提示，
           后面 6 个（执行中心/设置治理等）等于不存在。
           这里把跨组导航收进一个底部抽屉（12 个成员 + 3 个外链工具一次全可见），
           组内切换仍走原有的 #growth-subnav 分段。showGrowthTab 本身未改。 */
        var GX_EXTERNAL = [
            { label: '营销发券（手动补发）', url: '/campaign.html' },
            { label: '储值召回（手动）', url: '/winback.html' },
            { label: '储值提醒（手动测试）', url: '/svremind.html' }
        ];

        function gxOpenSheet() {
            var sheet = document.getElementById('gx-sheet');
            var body = document.getElementById('gx-sheet-body');
            if (!sheet || !body) return;
            // 祖先若有 transform/filter/backdrop-filter，会成为 fixed 的包含块，
            // 导致抽屉被定位到长页面的最底部（手机上表现为「点一下跳到页面最下面」）。
            // 挂到 body 下可彻底绕开，不依赖排查是哪个祖先。
            if (sheet.parentNode !== document.body) document.body.appendChild(sheet);
            var cur = (typeof __growthActiveTab !== 'undefined') ? __growthActiveTab : 'dashboard';
            var html = '';
            (typeof GROWTH_GROUPS !== 'undefined' ? GROWTH_GROUPS : []).forEach(function (g) {
                html += '<div class="gx-grp"><div class="gx-grp__t">' + escapeHtml(g.label) + '</div>';
                g.members.forEach(function (m) {
                    var on = m === cur;
                    var label = (typeof GROWTH_MEMBER_LABEL !== 'undefined' && GROWTH_MEMBER_LABEL[m]) || m;
                    html += '<button type="button" class="gx-item' + (on ? ' is-on' : '') + '"'
                         + ' data-click="gxPick" data-arg="' + m + '">'
                         + '<span class="gx-item__dot"></span>' + escapeHtml(label) + '</button>';
                });
                html += '</div>';
            });
            html += '<div class="gx-grp"><div class="gx-grp__t">手动工具</div>';
            GX_EXTERNAL.forEach(function (x) {
                html += '<button type="button" class="gx-item" data-click="gxOpenExternal" data-arg="' + x.url + '">'
                     + '<span class="gx-item__dot"></span>' + escapeHtml(x.label)
                     + '<span class="gx-item__ext">新窗口</span></button>';
            });
            html += '</div>';
            body.innerHTML = html;
            sheet.classList.add('is-open');
            sheet.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            document.addEventListener('keydown', gxSheetEsc);
        }

        function gxCloseSheet() {
            var sheet = document.getElementById('gx-sheet');
            if (!sheet) return;
            sheet.classList.remove('is-open');
            sheet.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            document.removeEventListener('keydown', gxSheetEsc);
        }
        function gxSheetEsc(e) { if (e.key === 'Escape') gxCloseSheet(); }

        function gxPick(member) {
            gxCloseSheet();
            try { showGrowthTab(member); } catch (e) {}
        }
        function gxOpenExternal(url) {
            gxCloseSheet();
            window.open(url, '_blank');
        }

        // 切换器标题：显示「分组 · 成员」，成员与分组同名时不重复
        function gxSyncSwitchLabel(group, member) {
            var el = document.getElementById('gx-switch-label');
            if (!el) return;
            var gl = group && group.label ? group.label : '';
            var ml = (typeof GROWTH_MEMBER_LABEL !== 'undefined' && GROWTH_MEMBER_LABEL[member]) || member || '';
            var txt = (gl && ml && gl !== ml) ? (gl + ' \u00b7 ' + ml) : (ml || gl);
            if (el.textContent !== txt) el.textContent = txt;
        }

        // 筛选摘要：把三个 select 的当前选项拼成一行
        function gxSyncFilterSummary() {
            var el = document.getElementById('gx-filter-summary');
            if (!el) return;
            var pick = function (id, fallback) {
                var sel = document.getElementById(id);
                if (!sel) return fallback;
                var o = sel.options[sel.selectedIndex];
                return (o && o.text) ? o.text.trim() : fallback;
            };
            var txt = [
                pick('growth-store-filter', '全部门店'),
                pick('growth-campaign-filter', '全部活动'),
                pick('growth-days-filter', '近30天')
            ].join(' \u00b7 ');
            if (el.textContent !== txt) el.textContent = txt;
        }

        function renderGrowthSubnav(group, activeMember) {
            try { gxSyncSwitchLabel(group, activeMember); gxSyncFilterSummary(); } catch (e) {}
            var host = document.getElementById('growth-subnav');
            if (!host) return;
            if (!group || group.members.length <= 1) { host.innerHTML = ''; host.style.display = 'none'; return; }
            host.style.display = '';
            host.innerHTML = group.members.map(function(m) {
                var on = m === activeMember;
                return '<button type="button" class="rep-subtab' + (on ? ' rep-subtab--active' : '') + '" data-click="showGrowthTab" data-arg="' + m + '">' + (GROWTH_MEMBER_LABEL[m] || m) + '</button>';
            }).join('');
        }

