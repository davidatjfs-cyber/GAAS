/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 06-flashcards.js
 * lines: 15266-15881 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ========== 闪卡功能 ==========
        function openKnowledgeFlashcardsModal() {
            if (!currentUser) {
                showNotification('请先登录', 'warning');
                return;
            }
            showPage('flashcards');
        }

        function loadFlashcardsModule() {
            populateKnowledgeFlashcardSources();
            const status = document.getElementById('kb-fc-status');
            if (status) status.textContent = '';
            hideFlashcardCard();
            renderKnowledgeFlashcardHistory();
            renderKnowledgeFlashcardStats();
        }

        function closeKnowledgeFlashcardsModal() {
            showPage('knowledge');
        }

        function populateKnowledgeFlashcardSources() {
            const sel = document.getElementById('kb-fc-source');
            if (!sel) return;
            const items = HRMS_STORE.getKnowledge();
            const visible = (items || [])
                .filter(it => it && (it.type === 'pdf' || it.type === 'doc' || it.type === 'txt' || it.type === 'img'))
                .filter(it => isAdminUser() || knowledgeItemMatchesUser(it, currentUser))
                .slice()
                .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

            if (!visible.length) {
                sel.innerHTML = '<option value="">暂无可用资料</option>';
                sel.value = '';
                return;
            }

            sel.innerHTML = visible.map(it => {
                const t = `${String(it.title || '知识资料')}（${String(it.type || '').toUpperCase()}）`;
                return `<option value="${escapeHtml(it.id)}">${escapeHtml(t)}</option>`;
            }).join('');
            try {
                if (!Array.from(sel.selectedOptions || []).length && visible[0]) {
                    const first = Array.from(sel.options || [])[0];
                    if (first) first.selected = true;
                }
            } catch (e) {}

            try {
                hrmsWireClickToggleMultiSelect(sel);
            } catch (e) {}
        }

        async function readKnowledgeItemBlob(item) {
            const rawKey = item?.fileId;
            // PG 同步项把 file_path 误塞进 fileId 时，IndexedDB 查不到；应走下方 /api/knowledge/:id/file
            const blobDbKey = rawKey && !String(rawKey).includes('/') && !String(rawKey).includes('\\')
                ? String(rawKey).trim()
                : '';
            if (blobDbKey) {
                try {
                    const row = await HRMS_FILE_DB.getFile(blobDbKey);
                    if (row?.blob) return row.blob;
                } catch (e) {}
                try {
                    await new Promise(r => setTimeout(r, 120));
                    const row2 = await HRMS_FILE_DB.getFile(blobDbKey);
                    if (row2?.blob) return row2.blob;
                } catch (e) {}
            }

            try {
                const directUrl = String(item?.cloud?.filePath || '').trim();
                if (directUrl && /^https?:\/\//i.test(directUrl)) {
                    const resp = await fetch(directUrl, { method: 'GET' });
                    if (resp.ok) {
                        return await resp.blob();
                    }
                }
            } catch (e) {
                // ignore and fallback to proxy
            }

            try {
                const id = String(item?.id || '').trim();
                if (!id) return null;
                const baseUrl = String(HRMS_API.baseUrl() || '').replace(/\/$/, '');
                const url = `${baseUrl}/api/knowledge/${encodeURIComponent(id)}/file`;
                const hdrs = {};
                const token = HRMS_API.token();
                if (token) hdrs['Authorization'] = `Bearer ${token}`;
                const resp = await fetch(url, { headers: hdrs });
                if (!resp.ok) return null;
                return await resp.blob();
            } catch (e) {
                return null;
            }
        }

        async function extractTextFromKnowledgeItem(item) {
            if (!item) return '';
            const type = String(item.type || '').toLowerCase();
            if (type === 'txt') {
                const blob = await readKnowledgeItemBlob(item);
                if (!blob) return '';
                return String(await blob.text()).trim();
            }

            if (type === 'pdf') {
                const blob = await readKnowledgeItemBlob(item);
                if (!blob) return '';
                const ok = await ensurePdfJsLoaded();
                if (!ok || typeof pdfjsLib === 'undefined') return '';
                pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.js';
                const arrayBuffer = await blob.arrayBuffer();
                const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';
                for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
                    const page = await doc.getPage(pageNum);
                    const content = await page.getTextContent();
                    const pageText = (content.items || []).map(it => it.str).join(' ');
                    fullText += pageText + '\n';
                }

                const extractedText = String(fullText || '').trim();
                if (extractedText) return extractedText;

                // OCR fallback for scanned PDFs (no text layer)
                try {
                    const worker = await getOrCreateOcrWorker(null);
                    const canOcr = !!worker || (typeof Tesseract !== 'undefined' && Tesseract?.recognize);
                    if (!canOcr) return '';

                    const maxPages = Math.min(2, Math.max(1, Number(doc.numPages || 1)));
                    const ocrTexts = [];
                    for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
                        const page = await doc.getPage(pageNum);
                        const viewport = page.getViewport({ scale: 1.6 });
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = Math.max(1, Math.floor(viewport.width));
                        canvas.height = Math.max(1, Math.floor(viewport.height));
                        await page.render({ canvasContext: ctx, viewport }).promise;

                        const pageBlob = await new Promise(resolve => {
                            try {
                                canvas.toBlob(b => resolve(b), 'image/png');
                            } catch (e) {
                                resolve(null);
                            }
                        });
                        if (!pageBlob) continue;

                        let text = '';
                        if (worker) {
                            const res = await worker.recognize(pageBlob);
                            text = String(res?.data?.text || '').trim();
                        } else {
                            const res = await Tesseract.recognize(pageBlob, 'chi_sim+eng');
                            text = String(res?.data?.text || '').trim();
                        }
                        if (text) ocrTexts.push(text);
                    }
                    return ocrTexts.join('\n\n').trim();
                } catch (e) {
                    return '';
                }
            }

            if (type === 'doc') {
                const name = String(item?.originalName || item?.fileName || item?.title || '').toLowerCase();
                const isDocx = name.endsWith('.docx') || name.includes('docx');
                if (!isDocx) {
                    // current build only guarantees DOCX parsing
                    return '';
                }
                const blob = await readKnowledgeItemBlob(item);
                if (!blob) return '';
                const ok = await ensureMammothLoaded();
                if (!ok || typeof mammoth === 'undefined') return '';
                const arrayBuffer = await blob.arrayBuffer();
                const result = await mammoth.extractRawText({ arrayBuffer });
                return String(result?.value || '').trim();
            }

            if (type === 'img' || type === 'image') {
                try {
                    const id = String(item?.id || '').trim();
                    if (id) {
                        const resp = await HRMS_API.request('/api/knowledge/' + encodeURIComponent(id) + '/content', { method: 'GET' });
                        const c = String(resp?.content || '').trim();
                        if (c) return c;
                    }
                } catch (e) { /* fallback OCR */ }
                const blob = await readKnowledgeItemBlob(item);
                if (!blob) return '';
                const worker = await getOrCreateOcrWorker(null);
                if (worker) {
                    const res = await worker.recognize(blob);
                    return String(res?.data?.text || '').trim();
                }
                if (typeof Tesseract !== 'undefined' && Tesseract?.recognize) {
                    const res = await Tesseract.recognize(blob, 'chi_sim+eng');
                    return String(res?.data?.text || '').trim();
                }
                return '';
            }

            return '';
        }

        async function aiGenerateFlashcards(text, count, meta) {
            const n = Math.min(80, Math.max(5, Number(count || 20)));
            const metaTitle = String(meta?.title || '').trim();
            const metaType = String(meta?.type || '').trim();
            const prompt = `你是企业内训“资料理解与记忆”的出题老师。你的任务：严格基于给定资料内容生成自测闪卡题。\n\n资料信息：\n- 标题：${metaTitle || '（未知）'}\n- 类型：${metaType || '（未知）'}\n\n出题要求（非常重要）：\n- 只能使用资料中明确出现的信息出题与作答；禁止编造或引入资料外知识。\n- 如果资料内容不足以支持某题，请跳过，不要硬凑。\n- 避免泛泛提问：不要出现“概括/谈谈/如何理解/为什么重要”等作文题。\n- 优先考核：关键结论、数据/指标、定义、对比关系、原因-结果、范围/口径、注意事项。\n- 可判分：答案必须唯一且简短（建议 <= 20 字）；不要给长段落答案。\n- 题干 q 须为通顺完整的中文书面句；禁止在汉字之间插入空格；填空用 ____ 占位且整句仍可读。\n- 禁止水题：single 的选项中禁止出现“以上都是/都对/都错/以上均是/以上全是”。\n\n题型比例建议：blank 占 50%-70%，single 与 tf 用于核对关键点。\n\n输出格式要求：\n- 只输出严格 JSON 数组，不要输出多余文字\n- 每项字段：id,type,q,options,answer\n- type 仅允许：single / tf / blank\n- single: options 为 4 个选项，且 answer 必须出现在 options 内\n- tf: options 固定为 [\"正确\",\"错误\"]，answer 为其中一个\n- blank: options 为空数组，answer 为标准答案字符串（短、可背诵）\n\n资料正文：\n${String(text || '').slice(0, 9000)}`;

            let data = null;
            try {
                data = await callLlmViaServer([{ role: 'user', content: prompt }], {
                    max_tokens: 2200,
                    temperature: 0.25,
                    feature: 'flashcard_generate',
                });
            } catch (e) {
                console.error('AI flashcards error:', e);
                throw new Error('AI 出题失败：' + String(e?.message || e));
            }
            const content = data?.choices?.[0]?.message?.content || '';
            const extracted = extractJsonArrayFromText(content);
            const parsed = hrmsSafeParseJson(extracted);
            const arr = Array.isArray(parsed) ? parsed : [];
            const bannedOptionRe = /(以上都是|以上均是|以上全是|都对|都错)/;
            const cards = arr.map((c, i) => {
                const type = String(c?.type || 'blank').trim();
                const q = String(c?.q || '').trim();
                const answer = String(c?.answer || '').trim();
                const options = Array.isArray(c?.options) ? c.options.map(x => String(x || '').trim()).filter(Boolean) : [];

                let normalizedType = type;
                if (normalizedType !== 'single' && normalizedType !== 'tf' && normalizedType !== 'blank') normalizedType = 'blank';

                // Normalize TF options
                let normalizedOptions = options;
                if (normalizedType === 'tf') normalizedOptions = ['正确', '错误'];

                // Ensure single has 4 options; otherwise degrade to blank
                if (normalizedType === 'single') {
                    const uniq = Array.from(new Set(normalizedOptions));
                    if (uniq.length !== 4) normalizedType = 'blank';
                    normalizedOptions = uniq;
                }

                return {
                    id: String(c?.id || `fc_ai_${Date.now()}_${i}`),
                    type: normalizedType,
                    q,
                    options: normalizedType === 'blank' ? [] : normalizedOptions,
                    answer
                };
            }).filter(x => {
                if (!x.q || !x.answer) return false;

                // Filter trivial/banned option patterns
                if ((x.type === 'single') && Array.isArray(x.options)) {
                    if (x.options.some(op => bannedOptionRe.test(op))) return false;
                    if (!x.options.includes(x.answer)) return false;
                }

                // Prefer short, gradable answers for process memorization
                if (x.type === 'blank' && x.answer.length > 80) return false;
                return true;
            });

            if (cards.length < Math.max(3, Math.floor(n * 0.35))) {
                throw new Error('大模型返回题目过少或格式异常，请重试；若持续失败请检查 LLM 配置与资料是否含可读文本');
            }
            const seed = hrmsMakeRunSeed('flash_ai');
            const rng = hrmsSeededRng(seed);
            hrmsShuffleInPlace(cards, rng);
            return cards.slice(0, n);
        }

        function normalizeFlashAnswer(s) {
            return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
        }

        function getCurrentFlashcard(st) {
            if (!st || !st.order?.length) return null;
            const idx = Math.max(0, Math.min(st.order.length - 1, st.index || 0));
            const id = st.order[idx];
            return st.cards?.find(c => String(c.id) === String(id)) || null;
        }

        function hideFlashcardCard() {
            const card = document.getElementById('kb-fc-card');
            if (card) card.style.display = 'none';
            const empty = document.getElementById('kb-fc-empty');
            if (empty) empty.style.display = '';
            const front = document.getElementById('kb-fc-front');
            const back = document.getElementById('kb-fc-back');
            if (front) front.style.display = '';
            if (back) back.style.display = 'none';
        }

        function showFlashcardCard() {
            const card = document.getElementById('kb-fc-card');
            if (card) card.style.display = '';
            const empty = document.getElementById('kb-fc-empty');
            if (empty) empty.style.display = 'none';
        }

        function getCurrentFlashcardsState() {
            return window.__KB_FLASHCARDS_STATE || null;
        }

        function setCurrentFlashcardsState(state) {
            window.__KB_FLASHCARDS_STATE = state;
        }

        function renderKnowledgeFlashcard() {
            const st = getCurrentFlashcardsState();
            const frontEl = document.getElementById('kb-fc-front');
            const backEl = document.getElementById('kb-fc-back');
            const progEl = document.getElementById('kb-fc-progress');
            const optionsEl = document.getElementById('kb-fc-options');
            const inputBox = document.getElementById('kb-fc-input-box');
            const inputEl = document.getElementById('kb-fc-input');
            const judgeEl = document.getElementById('kb-fc-judge');
            if (!st || !st.cards?.length) {
                hideFlashcardCard();
                return;
            }
            const idx = Math.max(0, Math.min(st.order.length - 1, st.index || 0));
            st.index = idx;
            const card = getCurrentFlashcard(st);
            if (!card) {
                hideFlashcardCard();
                return;
            }

            if (progEl) progEl.textContent = `进度：${idx + 1}/${st.order.length}　错题：${st.wrongIds.size}`;
            if (frontEl) frontEl.textContent = card.q;
            if (backEl) {
                const answerText = card.type === 'single' || card.type === 'tf'
                    ? `正确答案：${card.answer}`
                    : `参考答案：${card.answer}`;
                backEl.textContent = answerText;
                backEl.style.display = st.flipped ? '' : 'none';
            }

            if (judgeEl) judgeEl.textContent = '';
            st.picked = '';
            if (inputEl) inputEl.value = '';

            const opts = Array.isArray(card.options) ? card.options : [];
            if (opts.length && optionsEl) {
                optionsEl.style.display = 'flex';
                optionsEl.innerHTML = opts.map(op => {
                    const safe = escapeHtml(op);
                    return `<button class="btn btn-secondary" type="button" onclick="selectKnowledgeFlashcardOption('${safe}')">${safe}</button>`;
                }).join('');
            } else if (optionsEl) {
                optionsEl.style.display = 'none';
                optionsEl.innerHTML = '';
            }
            if (inputBox) inputBox.style.display = opts.length ? 'none' : '';

            showFlashcardCard();
            renderKnowledgeFlashcardStats();
            persistFlashcardsProgress(st);
        }

        function persistFlashcardsProgress(st) {
            if (!st?.itemId) return;
            setKbFlashcardsProgress(st.itemId, {
                cards: st.cards,
                wrongIds: Array.from(st.wrongIds || []),
                index: st.index || 0,
                order: st.order || [],
                typeFilter: Array.isArray(st.typeFilter) ? st.typeFilter.slice() : [],
                session: st.session || { answered: 0, correct: 0, byType: { single: 0, tf: 0, blank: 0 } },
                answeredIds: Array.from(st.answeredIds || []),
                completedLogged: !!st.completedLogged,
                updatedAt: hrmsNowISO()
            });
        }

        function selectKnowledgeFlashcardOption(value) {
            const st = getCurrentFlashcardsState();
            if (!st) return;
            st.picked = String(value || '');

            const optionsEl = document.getElementById('kb-fc-options');
            if (optionsEl) {
                Array.from(optionsEl.querySelectorAll('button')).forEach(btn => {
                    const txt = String(btn.textContent || '');
                    if (txt === st.picked) {
                        btn.classList.remove('btn-secondary');
                        btn.classList.add('btn');
                    } else {
                        btn.classList.remove('btn');
                        btn.classList.add('btn-secondary');
                    }
                });
            }
        }

        function submitKnowledgeFlashcardAnswer() {
            const st = getCurrentFlashcardsState();
            if (!st) return;
            const card = getCurrentFlashcard(st);
            if (!card) return;

            let userAnswer = '';
            if (Array.isArray(card.options) && card.options.length) {
                userAnswer = String(st.picked || '').trim();
                if (!userAnswer) {
                    showNotification('请选择一个答案', 'warning');
                    return;
                }
            } else {
                userAnswer = String(document.getElementById('kb-fc-input')?.value || '').trim();
                if (!userAnswer) {
                    showNotification('请输入答案', 'warning');
                    return;
                }
            }

            const judgeEl = document.getElementById('kb-fc-judge');
            const correct = normalizeFlashAnswer(userAnswer) === normalizeFlashAnswer(card.answer)
                || normalizeFlashAnswer(card.answer).includes(normalizeFlashAnswer(userAnswer))
                || normalizeFlashAnswer(userAnswer).includes(normalizeFlashAnswer(card.answer));

            if (correct) {
                st.wrongIds.delete(String(card.id));
                if (judgeEl) judgeEl.textContent = '判定：正确';
                showNotification('回答正确', 'success');
            } else {
                st.wrongIds.add(String(card.id));
                if (judgeEl) judgeEl.textContent = '判定：错误（可翻面查看答案）';
                showNotification('回答错误', 'warning');
            }

            const cardId = String(card.id || '');
            if (!st.answeredIds) st.answeredIds = new Set();
            if (!st.session) st.session = { answered: 0, correct: 0, byType: { single: 0, tf: 0, blank: 0 } };
            if (!st.session.byType) st.session.byType = { single: 0, tf: 0, blank: 0 };
            if (!st.answeredIds.has(cardId)) {
                st.answeredIds.add(cardId);
                st.session.answered += 1;
                if (correct) st.session.correct += 1;
                const type = String(card.type || 'blank');
                if (type === 'single' || type === 'tf' || type === 'blank') {
                    st.session.byType[type] = Number(st.session.byType[type] || 0) + 1;
                }
            }

            persistFlashcardsProgress(st);
            renderKnowledgeFlashcardStats();
            saveKnowledgeFlashcardHistoryRecord(st);
        }

        async function generateKnowledgeFlashcards() {
            if (!currentUser) return;
            const status = document.getElementById('kb-fc-status');
            const itemId = String(document.getElementById('kb-fc-source')?.value || '').trim();
            const count = Number(document.getElementById('kb-fc-count')?.value || 20);
            const selectedTypes = getSelectedFlashcardTypes();
            if (!itemId) {
                showNotification('请选择知识资料', 'warning');
                return;
            }
            if (!selectedTypes.length) {
                showNotification('请至少选择一种题型', 'warning');
                return;
            }

            const items = HRMS_STORE.getKnowledge();
            const item = (items || []).find(x => String(x.id) === itemId);
            if (!item) {
                showNotification('未找到资料', 'error');
                return;
            }

            try {
                if (status) status.textContent = '解析资料中...';
                showNotification('正在生成闪卡，请稍候...', 'info');
                const text = await extractTextFromKnowledgeItem(item);
                if (!text) {
                    if (status) status.textContent = '解析失败：请确认资料为 PDF/DOCX/TXT，且可解析';
                    showNotification('资料解析失败（PDF/DOCX/TXT）', 'error');
                    return;
                }
                if (status) status.textContent = '生成闪卡中...';
                const meta = { title: item?.title || item?.originalName || '', type: String(item?.type || '').toUpperCase() };
                const allCards = await aiGenerateFlashcards(text, count, meta);
                const cards = (Array.isArray(allCards) ? allCards : [])
                    .filter(c => selectedTypes.includes(String(c?.type || 'blank')))
                    .slice(0, Math.min(80, Math.max(5, Number(count || 20))));
                if (!cards.length) {
                    if (status) status.textContent = '生成失败：当前题型下未生成卡片，请调整题型或题量';
                    showNotification('未生成可用题目', 'error');
                    return;
                }
                const order = cards.map(c => c.id);
                const st = {
                    itemId,
                    cards,
                    order,
                    index: 0,
                    flipped: false,
                    wrongIds: new Set(),
                    typeFilter: selectedTypes,
                    answeredIds: new Set(),
                    session: { answered: 0, correct: 0, byType: { single: 0, tf: 0, blank: 0 } },
                    completedLogged: false
                };
                setCurrentFlashcardsState(st);
                persistFlashcardsProgress(st);
                if (status) status.textContent = `已生成 ${cards.length} 题（题型：${selectedTypes.join('/')}）`;
                showNotification('闪卡已生成', 'success');
                renderKnowledgeFlashcard();
            } catch (e) {
                console.error(e);
                if (status) status.textContent = '生成失败：' + String(e?.message || e);
                showNotification('生成失败：' + String(e?.message || e), 'error');
            }
        }

        function startKnowledgeFlashcards() {
            if (!currentUser) return;
            const status = document.getElementById('kb-fc-status');
            const itemId = String(document.getElementById('kb-fc-source')?.value || '').trim();
            const mode = String(document.getElementById('kb-fc-mode')?.value || 'all');
            if (!itemId) {
                showNotification('请选择知识资料', 'warning');
                return;
            }

            const saved = getKbFlashcardsProgress(itemId);
            if (!saved || !Array.isArray(saved.cards) || !saved.cards.length) {
                if (status) status.textContent = '请先点击“生成闪卡”';
                showNotification('请先生成闪卡', 'warning');
                return;
            }

            const wrongSet = new Set((saved.wrongIds || []).map(String));
            let order = Array.isArray(saved.order) && saved.order.length ? saved.order.map(String) : saved.cards.map(c => String(c.id));
            if (mode === 'wrong') {
                order = order.filter(id => wrongSet.has(String(id)));
                if (!order.length) {
                    if (status) status.textContent = '暂无错题，可切换为“随机练习”';
                    showNotification('暂无错题', 'info');
                    return;
                }
            }

            // shuffle for practice
            order = order.slice().sort(() => Math.random() - 0.5);
            const st = {
                itemId,
                cards: saved.cards,
                order,
                index: 0,
                flipped: false,
                wrongIds: wrongSet,
                picked: '',
                typeFilter: Array.isArray(saved?.typeFilter) ? saved.typeFilter.slice() : ['single', 'tf', 'blank'],
                answeredIds: new Set((saved?.answeredIds || []).map(String)),
                session: saved?.session || { answered: 0, correct: 0, byType: { single: 0, tf: 0, blank: 0 } },
                completedLogged: !!saved?.completedLogged
            };
            setCurrentFlashcardsState(st);
            if (status) status.textContent = '';
            renderKnowledgeFlashcard();
        }

        function flipKnowledgeFlashcard() {
            const st = getCurrentFlashcardsState();
            if (!st) return;
            st.flipped = !st.flipped;
            renderKnowledgeFlashcard();
        }

        function nextKnowledgeFlashcard() {
            const st = getCurrentFlashcardsState();
            if (!st || !st.order?.length) return;
            st.index = (st.index + 1) % st.order.length;
            st.flipped = false;
            renderKnowledgeFlashcard();
        }

        async function resetKnowledgeFlashcardsProgress() {
            if (!currentUser) return;
            const itemId = String(document.getElementById('kb-fc-source')?.value || '').trim();
            if (!itemId) {
                showNotification('请选择知识资料', 'warning');
                return;
            }
            const ok = await hrmsConfirm({ title: '重置闪卡进度', message: '确定重置该资料的闪卡进度？', okText: '确认重置', icon: '🔄' });
            if (!ok) return;
            try {
                localStorage.removeItem(getKbFlashcardsProgressKey(itemId));
            } catch (e) {
                // ignore
            }
            setCurrentFlashcardsState(null);
            hideFlashcardCard();
            const status = document.getElementById('kb-fc-status');
            if (status) status.textContent = '进度已重置';
            renderKnowledgeFlashcardStats();
            showNotification('已重置', 'success');
        }

