/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 04-knowledge-ai.js
 * lines: 13066-13504 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ========== 知识库AI对话功能 ==========
        let kbChatHistory = [];
        let kbChatLoading = false;

        function openKnowledgeChatModal() {
            if (!currentUser) {
                showNotification('请先登录', 'warning');
                return;
            }
            const modal = document.getElementById('kb-chat-modal');
            if (!modal) return;
            if (!modal.dataset.boundClose) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) closeKnowledgeChatModal();
                });
                modal.dataset.boundClose = '1';
            }
            populateKnowledgeChatSources();
            modal.style.display = '';
            modal.classList.add('show');
        }

        function closeKnowledgeChatModal() {
            const modal = document.getElementById('kb-chat-modal');
            if (!modal) return;
            modal.classList.remove('show');
            modal.style.display = '';
        }

        let kbChatSelectedSources = new Set();

        function populateKnowledgeChatSources() {
            const container = document.getElementById('kb-chat-source-container');
            if (!container) return;
            const items = HRMS_STORE.getKnowledge();
            const visible = (items || [])
                .filter(it => it && (it.type === 'pdf' || it.type === 'doc' || it.type === 'txt' || it.type === 'img'))
                .filter(it => isAdminUser() || knowledgeItemMatchesUser(it, currentUser))
                .slice()
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

            if (!visible.length) {
                container.innerHTML = '<div style="color: #999; font-size: 13px; padding: 8px;">暂无可用的培训资料</div>';
                return;
            }

            container.innerHTML = visible.map(it => {
                const cat = it.category || '未分类';
                const name = it.title || it.name || '未命名';
                const isSelected = kbChatSelectedSources.has(it.id);
                const typeIcon = it.type === 'pdf' ? '📄' : (it.type === 'doc' ? '📝' : (it.type === 'img' ? '🖼️' : '📃'));
                return `<button type="button" class="kb-chat-source-chip ${isSelected ? 'selected' : ''}" data-id="${escapeHtml(it.id)}" data-click="toggleKbChatSource" data-arg="${escapeHtml(it.id)}">
                    <span class="kb-src-ic" aria-hidden="true">${typeIcon}</span>
                    <span class="kb-src-name">${escapeHtml(name)}</span>
                    <span class="kb-src-cat">${escapeHtml(cat)}</span>
                </button>`;
            }).join('');

            updateKbChatSelectedCount();
        }

        function toggleKbChatSource(id) {
            if (kbChatSelectedSources.has(id)) {
                kbChatSelectedSources.delete(id);
            } else {
                kbChatSelectedSources.add(id);
            }
            populateKnowledgeChatSources();
        }

        function updateKbChatSelectedCount() {
            const countEl = document.getElementById('kb-chat-selected-count');
            if (countEl) {
                const count = kbChatSelectedSources.size;
                countEl.textContent = `已选 ${count} 项`;
                countEl.classList.toggle('kb-rpt-chip-on', count > 0);
            }
        }

        function getKbChatSelectedIds() {
            return Array.from(kbChatSelectedSources);
        }

        function insertKbChatSuggestion(text) {
            const input = document.getElementById('kb-chat-input');
            if (input) {
                input.value = text;
                input.focus();
            }
        }

        function handleKbChatKeydown(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendKnowledgeChatMessage();
            }
        }

        function clearKnowledgeChatHistory() {
            kbChatHistory = [];
            const messagesEl = document.getElementById('kb-chat-messages');
            if (messagesEl) {
                messagesEl.innerHTML = `
                    <div class="kb-rpt-welcome kb-chat-welcome">
                        <div style="font-size: 40px; line-height: 1; opacity: 0.9;">🎓</div>
                        <div class="kb-rpt-welcome-title">欢迎使用 AI 培训助手</div>
                        <div style="margin-top: 8px; font-size: 13px;">选择资料后提问；建议先用快捷指令建立上下文。</div>
                        <div class="kb-rpt-welcome-actions">
                            <button type="button" class="btn btn-secondary kb-rpt-btn-ghost" data-click="insertKbChatSuggestion" data-arg="请总结这份资料的主要内容">总结内容</button>
                            <button type="button" class="btn btn-secondary kb-rpt-btn-ghost" data-click="insertKbChatSuggestion" data-arg="这份资料的关键要点有哪些？">关键要点</button>
                            <button type="button" class="btn btn-secondary kb-rpt-btn-ghost" data-click="insertKbChatSuggestion" data-arg="帮我出几道测试题检验学习效果">出测试题</button>
                        </div>
                    </div>
                `;
            }
            showNotification('对话已清空', 'success');
        }

        function appendKbChatMessage(role, content) {
            const messagesEl = document.getElementById('kb-chat-messages');
            if (!messagesEl) return;

            // 移除欢迎信息
            const welcome = messagesEl.querySelector('.kb-chat-welcome');
            if (welcome) welcome.remove();

            const msgDiv = document.createElement('div');
            msgDiv.className = 'kb-rpt-turn kb-rpt-turn-' + (role === 'user' ? 'user' : 'assistant');

            const bubble = document.createElement('div');
            bubble.className = 'kb-rpt-bubble kb-rpt-bubble-' + (role === 'user' ? 'user' : 'assistant');
            bubble.textContent = content;
            msgDiv.appendChild(bubble);
            messagesEl.appendChild(msgDiv);

            // 滚动到底部
            messagesEl.scrollTop = messagesEl.scrollHeight;

            return bubble;
        }

        async function getKnowledgeContentForChat(itemIds) {
            const items = HRMS_STORE.getKnowledge();
            let combinedText = '';

            for (const id of itemIds) {
                const item = items.find(it => String(it.id) === String(id));
                if (!item) continue;
                try {
                    const type = String(item.type || '').toLowerCase();
                    if (type === 'video') {
                        combinedText += `\n\n【${item.title || item.name || '视频资料'}】\n（该条目为视频文件，暂无逐字文本；请改选 PDF/DOCX/TXT 进行深度问答。）`;
                        continue;
                    }
                    const text = await extractTextFromKnowledgeItem(item);
                    if (text && String(text).trim()) {
                        combinedText += `\n\n【${item.title || item.name || '资料'}】\n${String(text).slice(0, 15000)}`;
                    }
                } catch (e) {
                    console.error('读取知识库内容失败:', e);
                }
            }

            return combinedText.trim();
        }

        async function sendKnowledgeChatMessage() {
            if (kbChatLoading) return;

            const input = document.getElementById('kb-chat-input');
            const statusEl = document.getElementById('kb-chat-status');
            const sendBtn = document.getElementById('kb-chat-send-btn');

            const question = (input?.value || '').trim();
            if (!question) {
                showNotification('请输入问题', 'warning');
                return;
            }

            const selectedIds = getKbChatSelectedIds();

            if (!selectedIds.length) {
                showNotification('请先选择培训资料', 'warning');
                return;
            }

            // 显示用户消息
            appendKbChatMessage('user', question);
            input.value = '';
            kbChatHistory.push({ role: 'user', content: question });

            // 显示加载状态
            kbChatLoading = true;
            if (sendBtn) sendBtn.disabled = true;
            if (statusEl) statusEl.textContent = '正在读取知识库内容...';

            try {
                // 获取知识库内容
                const knowledgeContent = await getKnowledgeContentForChat(selectedIds);
                if (!knowledgeContent) {
                    throw new Error('无法读取所选资料内容');
                }

                if (statusEl) statusEl.textContent = 'AI思考中...';

                // 构建系统提示
                const systemPrompt = `你是一个专业的知识库助手。请基于以下知识库内容回答用户的问题。
如果问题与知识库内容无关，请礼貌地告知用户。
回答时请简洁明了，使用中文。

【知识库内容】
${knowledgeContent.slice(0, 30000)}`;

                // 调用AI API
                const response = await callKnowledgeChatAPI(systemPrompt, kbChatHistory);
                
                // 显示AI回复
                appendKbChatMessage('assistant', response);
                kbChatHistory.push({ role: 'assistant', content: response });

                if (statusEl) statusEl.textContent = '';
            } catch (e) {
                console.error('AI对话失败:', e);
                appendKbChatMessage('assistant', `抱歉，处理您的问题时出错了：${e.message || '未知错误'}`);
                if (statusEl) statusEl.textContent = '';
            } finally {
                kbChatLoading = false;
                if (sendBtn) sendBtn.disabled = false;
            }
        }

        async function callKnowledgeChatAPI(systemPrompt, history) {
            // 与闪卡/系统其它 AI 一致：统一走服务端 /api/ai/chat-completions（DeepSeek 等由系统预设或设置页配置）
            const messages = [
                { role: 'system', content: systemPrompt },
                ...history.slice(-10)
            ];
            try {
                const data = await callLlmViaServer(messages, { max_tokens: 2200, temperature: 0.35, feature: 'kb_chat' });
                return data.choices?.[0]?.message?.content || '无法获取回复';
            } catch (e) {
                console.error('AI API调用失败:', e);
                const hint = String(e?.message || e || '');
                throw new Error(`AI 服务不可用（${hint || '请检查网络与系统设置中的 LLM'}）。培训助手需使用云端大模型，请确认已配置有效 API。`);
            }
        }

        let __BRANDS_CACHE = [];
        let __KB_ACTIVE_BRAND_ID = 'all';
        let __AM_BRAND_FILTER = 'all';
        let __BRAND_FORM_EDITING_ID = '';

        function normalizeBrandIdInput(input) {
            const raw = String(input || '').trim().toLowerCase();
            if (!raw) return '';
            return raw
                .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 80);
        }

        function getBrandNameById(id) {
            const bid = normalizeBrandIdInput(id);
            const one = (__BRANDS_CACHE || []).find((b) => normalizeBrandIdInput(b?.id) === bid) || null;
            return String(one?.name || '').trim();
        }

        function getStoreBrandByName(storeName) {
            const s = String(storeName || '').trim();
            if (!s) return { brandId: '', brandName: '' };
            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            const one = stores.find((x) => String(x?.name || '').trim() === s) || null;
            const brandId = normalizeBrandIdInput(one?.brandId || one?.brand || one?.brandName);
            const brandName = String(one?.brandName || one?.brand || getBrandNameById(brandId) || '').trim();
            return { brandId, brandName };
        }

        function inferBrandsFromStores() {
            const stores = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : [];
            const map = new Map();
            stores.forEach((s) => {
                const name = String(s?.brandName || s?.brand || '').trim();
                const id = normalizeBrandIdInput(s?.brandId || name);
                if (!id || !name || map.has(id)) return;
                map.set(id, { id, name, config: { sopKeypoints: [], performanceWeights: {} } });
            });
            return Array.from(map.values());
        }

        async function refreshBrandsCache(silent) {
            try {
                const resp = await HRMS_API.getBrands();
                const items = Array.isArray(resp?.items) ? resp.items : [];
                __BRANDS_CACHE = items.map((b) => ({
                    id: normalizeBrandIdInput(b?.id || b?.brandId || b?.name),
                    name: String(b?.name || '').trim(),
                    config: b?.config && typeof b.config === 'object' ? b.config : { sopKeypoints: [], performanceWeights: {} }
                })).filter((b) => b.id && b.name);
            } catch (e) {
                __BRANDS_CACHE = inferBrandsFromStores();
                if (!silent) {
                    console.warn('refreshBrandsCache fallback:', e?.message || e);
                }
            }
            if (!Array.isArray(__BRANDS_CACHE)) __BRANDS_CACHE = [];
            __BRANDS_CACHE.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
            return __BRANDS_CACHE;
        }

        function buildBrandOptionsHtml(includeAll, allLabel) {
            const options = [];
            if (includeAll) options.push(`<option value="all">${escapeHtml(allLabel || '全部品牌')}</option>`);
            (__BRANDS_CACHE || []).forEach((b) => {
                options.push(`<option value="${escapeHtml(String(b.id || ''))}">${escapeHtml(String(b.name || b.id || ''))}</option>`);
            });
            return options.join('');
        }

        function populateKnowledgeBrandOptions(selectedId) {
            const sel = document.getElementById('knowledge-upload-brand-id');
            if (!sel) return;
            const cur = normalizeBrandIdInput(selectedId || sel.value || 'all') || 'all';
            sel.innerHTML = buildBrandOptionsHtml(true, '全部品牌（公司制度）');
            sel.value = cur;
        }

        function populateStoreBrandSelect(selectedId) {
            const sel = document.getElementById('store-form-brand-id');
            if (!sel) return;
            const cur = normalizeBrandIdInput(selectedId || sel.value || '');
            const placeholder = '<option value="">请选择品牌</option>';
            sel.innerHTML = placeholder + buildBrandOptionsHtml(false);
            if (cur) sel.value = cur;
        }

        function populateReportsBrandSelect(selectedId) {
            const sel = document.getElementById('rep-brand');
            if (!sel) return;
            const cur = normalizeBrandIdInput(selectedId || sel.value || '');
            sel.innerHTML = '<option value="">全部品牌</option>' + buildBrandOptionsHtml(false);
            if (cur) sel.value = cur;
        }

        function populateKnowledgeFilterBrandOptions(selectedId) {
            const sel = document.getElementById('knowledge-filter-brand');
            if (!sel) return;
            const cur = normalizeBrandIdInput(selectedId || sel.value || '');
            sel.innerHTML = '<option value="">全部品牌</option>' + buildBrandOptionsHtml(false);
            if (cur) sel.value = cur;
        }

        function populateAmBrandFilter(selectedId) {
            const sel = document.getElementById('am-brand-filter');
            if (!sel) return;
            const cur = normalizeBrandIdInput(selectedId || __AM_BRAND_FILTER || 'all') || 'all';
            sel.innerHTML = buildBrandOptionsHtml(true, '全部品牌');
            sel.value = cur;
            __AM_BRAND_FILTER = cur;
            const badge = document.getElementById('am-brand-badge');
            if (badge) {
                badge.textContent = cur === 'all' ? 'AI 全品牌态势' : `AI 品牌态势：${getBrandNameById(cur) || cur}`;
            }
        }

        function parseBrandFromKnowledgeTags(tags) {
            const list = Array.isArray(tags) ? tags : [];
            const hit = list.find((x) => String(x || '').startsWith('brand:'));
            const raw = String(hit || '').replace(/^brand:/, '').trim();
            const id = normalizeBrandIdInput(raw);
            if (!id || id === 'all') return { brandId: 'all', brandName: '全部品牌' };
            return { brandId: id, brandName: getBrandNameById(id) || raw || id };
        }

        function knowledgeItemMatchBrand(item, brandId) {
            const bid = normalizeBrandIdInput(brandId);
            if (!bid) return true;
            const itemId = normalizeBrandIdInput(item?.brandId || item?.brandName);
            return itemId === bid || itemId === 'all' || !itemId;
        }

        function getItemBrandRef(item) {
            const directId = normalizeBrandIdInput(item?.brand_id || item?.brandId);
            const directName = String(item?.brand_name || item?.brandName || item?.brand || '').trim();
            if (directId || directName) {
                const id = directId || normalizeBrandIdInput(directName);
                return { brandId: id, brandName: directName || getBrandNameById(id) || id };
            }
            const storeRef = String(item?.store || item?.sender_store || item?.storeName || '').trim();
            if (storeRef) return getStoreBrandByName(storeRef);
            return { brandId: '', brandName: '' };
        }

        function amItemMatchBrand(item) {
            const bid = normalizeBrandIdInput(__AM_BRAND_FILTER);
            if (!bid || bid === 'all') return true;
            const ref = getItemBrandRef(item);
            const id = normalizeBrandIdInput(ref.brandId || ref.brandName);
            return id === bid;
        }

        function onAmBrandChange(v) {
            __AM_BRAND_FILTER = normalizeBrandIdInput(v || 'all') || 'all';
            populateAmBrandFilter(__AM_BRAND_FILTER);
            const active = document.querySelector('.am-nav-btn.active');
            const tab = String(active?.dataset?.tab || 'overview').trim() || 'overview';
            switchAmTab(tab);
        }

        function renderAmBrandCockpit(items) {
            const box = document.getElementById('am-brand-cockpit');
            if (!box) return;
            const list = Array.isArray(items) ? items : [];
            const names = ['马己仙', '洪潮'];
            const cards = names.map((name) => {
                const aliases = new Set([normalizeBrandIdInput(name)]);
                (__BRANDS_CACHE || []).forEach((b) => {
                    if (String(b?.name || '').trim() === name) {
                        aliases.add(normalizeBrandIdInput(b?.id));
                        aliases.add(normalizeBrandIdInput(b?.name));
                    }
                });
                const one = list.filter((x) => {
                    const ref = getItemBrandRef(x);
                    const bid = normalizeBrandIdInput(ref.brandId);
                    const bname = normalizeBrandIdInput(ref.brandName);
                    return aliases.has(bid) || aliases.has(bname);
                });
                const openIssues = one.filter((x) => String(x?.status || '').trim() !== 'resolved').length;
                return `
                    <div class="am-stat-card" style="text-align:left;">
                        <div class="am-stat-label">${escapeHtml(name)} · AI监控</div>
                        <div class="am-stat-value ${openIssues > 0 ? 'orange' : 'green'}">${openIssues}</div>
                        <div class="am-stat-sub">待处理异常 ${openIssues} 条 · 总事件 ${one.length} 条</div>
                    </div>
                `;
            }).join('');
            box.innerHTML = cards || '';
        }

