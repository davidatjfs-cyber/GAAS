/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 03-training-focus.js
 * lines: 7683-13065 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ========== 培训专注度监控系统 ==========
        var __ATTN = {
            active: false,
            stream: null,
            intervalId: null,
            faceApiLoaded: false,
            faceApiLoading: false,
            startTime: 0,
            samples: [],        // {ts, faceDetected, lookingAtScreen, score}
            currentScore: 0,
            materialId: '',
            materialTitle: '',
            noFaceCount: 0,
            totalSamples: 0,
            attentiveSamples: 0
        };

        async function attnEnsureFaceApiLoaded() {
            if (__ATTN.faceApiLoaded) return true;
            if (__ATTN.faceApiLoading) {
                for (let i = 0; i < 60; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    if (__ATTN.faceApiLoaded) return true;
                }
                return false;
            }
            __ATTN.faceApiLoading = true;
            const statusEl = document.getElementById('attn-status-text');
            if (statusEl) statusEl.textContent = '加载AI模型...';

            const cdnUrls = [
                'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
                'https://unpkg.com/face-api.js@0.22.2/dist/face-api.min.js'
            ];
            let loaded = false;
            for (const url of cdnUrls) {
                try {
                    await loadScript(url);
                    if (typeof faceapi !== 'undefined') { loaded = true; break; }
                } catch (e) {}
            }
            if (!loaded || typeof faceapi === 'undefined') {
                __ATTN.faceApiLoading = false;
                if (statusEl) statusEl.textContent = 'AI模型加载失败';
                return false;
            }

            if (statusEl) statusEl.textContent = '加载检测模型...';
            const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
            try {
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL)
                ]);
                __ATTN.faceApiLoaded = true;
                __ATTN.faceApiLoading = false;
                return true;
            } catch (e) {
                console.error('face-api model load error:', e);
                __ATTN.faceApiLoading = false;
                if (statusEl) statusEl.textContent = '检测模型加载失败';
                return false;
            }
        }

        async function attnStartCamera() {
            try {
                const video = document.getElementById('attn-video');
                if (!video) return false;
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
                    audio: false
                });
                video.srcObject = stream;
                __ATTN.stream = stream;
                await new Promise((resolve) => { video.onloadedmetadata = resolve; });
                await video.play();
                return true;
            } catch (e) {
                console.error('Camera error:', e);
                const noCamEl = document.getElementById('attn-no-cam');
                if (noCamEl) noCamEl.style.display = 'flex';
                try {
                    const statusEl = document.getElementById('attn-status-text');
                    if (statusEl) {
                        const proto = String(window.location?.protocol || '');
                        const httpsHint = proto !== 'https:' ? '（当前非HTTPS，手机浏览器通常会禁用摄像头）' : '';
                        statusEl.textContent = '摄像头不可用：请检查权限/是否被占用' + httpsHint;
                    }
                } catch (e2) {}
                return false;
            }
        }

        function attnStopCamera() {
            try {
                const video = document.getElementById('attn-video');
                if (video) video.srcObject = null;
                if (__ATTN.stream) {
                    __ATTN.stream.getTracks().forEach(t => t.stop());
                    __ATTN.stream = null;
                }
            } catch (e) {}
        }

        function attnAnalyzeGaze(landmarks) {
            if (!landmarks) return { lookingAtScreen: false, confidence: 0 };
            try {
                const positions = landmarks.positions || [];
                if (positions.length < 68) return { lookingAtScreen: false, confidence: 0 };

                // 左眼: 36-41, 右眼: 42-47
                const leftEye = positions.slice(36, 42);
                const rightEye = positions.slice(42, 48);
                const nose = positions[30];

                // 计算眼睛中心
                const leftCenter = { x: leftEye.reduce((s, p) => s + p.x, 0) / 6, y: leftEye.reduce((s, p) => s + p.y, 0) / 6 };
                const rightCenter = { x: rightEye.reduce((s, p) => s + p.x, 0) / 6, y: rightEye.reduce((s, p) => s + p.y, 0) / 6 };
                const eyeCenter = { x: (leftCenter.x + rightCenter.x) / 2, y: (leftCenter.y + rightCenter.y) / 2 };

                // 鼻子相对于眼睛中心的偏移 → 判断头部朝向
                const eyeDist = Math.sqrt(Math.pow(rightCenter.x - leftCenter.x, 2) + Math.pow(rightCenter.y - leftCenter.y, 2));
                if (eyeDist < 5) return { lookingAtScreen: false, confidence: 0 };

                const noseOffsetX = (nose.x - eyeCenter.x) / eyeDist;
                const noseOffsetY = (nose.y - eyeCenter.y) / eyeDist;

                // 正对屏幕时 noseOffsetX ≈ 0, noseOffsetY ≈ 0.6~1.0
                const xDeviation = Math.abs(noseOffsetX);
                const lookingAtScreen = xDeviation < 0.35 && noseOffsetY > 0.2 && noseOffsetY < 1.8;

                // 眨眼检测 (EAR - Eye Aspect Ratio)
                const ear = (p) => {
                    const h1 = Math.sqrt(Math.pow(p[1].x - p[5].x, 2) + Math.pow(p[1].y - p[5].y, 2));
                    const h2 = Math.sqrt(Math.pow(p[2].x - p[4].x, 2) + Math.pow(p[2].y - p[4].y, 2));
                    const w = Math.sqrt(Math.pow(p[0].x - p[3].x, 2) + Math.pow(p[0].y - p[3].y, 2));
                    return w > 0 ? (h1 + h2) / (2 * w) : 0;
                };
                const leftEAR = ear(leftEye);
                const rightEAR = ear(rightEye);
                const avgEAR = (leftEAR + rightEAR) / 2;
                const eyesOpen = avgEAR > 0.18;

                const confidence = lookingAtScreen && eyesOpen ? Math.max(0, 1 - xDeviation * 2) : 0;
                return { lookingAtScreen: lookingAtScreen && eyesOpen, confidence, xDeviation, noseOffsetY, avgEAR };
            } catch (e) {
                return { lookingAtScreen: false, confidence: 0 };
            }
        }

        async function attnDetectOnce() {
            if (!__ATTN.active || !__ATTN.faceApiLoaded) return;
            const video = document.getElementById('attn-video');
            if (!video || video.readyState < 2) return;

            try {
                const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })).withFaceLandmarks(true);

                const faceDetected = !!detection;
                let lookingAtScreen = false;
                let gazeConfidence = 0;

                if (faceDetected && detection.landmarks) {
                    const gaze = attnAnalyzeGaze(detection.landmarks);
                    lookingAtScreen = gaze.lookingAtScreen;
                    gazeConfidence = gaze.confidence;
                }

                // 计算本次采样分数 (0-100)
                let sampleScore = 0;
                if (faceDetected && lookingAtScreen) {
                    sampleScore = 70 + Math.round(gazeConfidence * 30); // 70-100
                } else if (faceDetected && !lookingAtScreen) {
                    sampleScore = 30; // 人脸在但没看屏幕
                } else {
                    sampleScore = 0; // 没检测到人脸
                }

                __ATTN.totalSamples++;
                if (sampleScore >= 60) __ATTN.attentiveSamples++;

                __ATTN.samples.push({
                    ts: Date.now(),
                    faceDetected,
                    lookingAtScreen,
                    score: sampleScore
                });

                // 只保留最近120个采样 (约2分钟)
                if (__ATTN.samples.length > 120) __ATTN.samples.shift();

                // 计算滑动窗口平均分
                const recent = __ATTN.samples.slice(-30); // 最近30次采样
                const avgScore = Math.round(recent.reduce((s, x) => s + x.score, 0) / recent.length);
                __ATTN.currentScore = avgScore;

                // 连续未检测到人脸计数
                if (!faceDetected) {
                    __ATTN.noFaceCount++;
                } else {
                    __ATTN.noFaceCount = 0;
                }

                // 更新UI
                attnUpdateUI(avgScore, faceDetected, lookingAtScreen);

            } catch (e) {
                // 静默失败，下次重试
            }
        }

        function attnUpdateUI(score, faceDetected, lookingAtScreen) {
            const scoreEl = document.getElementById('attn-score-display');
            const barEl = document.getElementById('attn-score-bar');
            const dotEl = document.getElementById('attn-status-dot');
            const statusEl = document.getElementById('attn-status-text');
            const gazeEl = document.getElementById('attn-d-gaze');
            const faceEl = document.getElementById('attn-d-face');
            const durationEl = document.getElementById('attn-d-duration');
            const avgEl = document.getElementById('attn-d-avg');

            if (scoreEl) {
                scoreEl.textContent = String(score);
                scoreEl.style.color = score >= 70 ? 'rgba(34,197,94,0.95)' : score >= 40 ? 'rgba(234,179,8,0.95)' : 'rgba(239,68,68,0.95)';
            }
            if (barEl) barEl.style.width = score + '%';
            if (dotEl) dotEl.style.background = faceDetected ? (lookingAtScreen ? '#22c55e' : '#eab308') : '#ef4444';

            if (statusEl) {
                if (!faceDetected) statusEl.textContent = '未检测到人脸';
                else if (lookingAtScreen) statusEl.textContent = '专注观看中';
                else statusEl.textContent = '注意力分散';
            }

            if (gazeEl) gazeEl.textContent = lookingAtScreen ? '正对屏幕' : '偏离';
            if (faceEl) faceEl.textContent = faceDetected ? '已检测' : '未检测';

            if (durationEl && __ATTN.startTime) {
                const sec = Math.floor((Date.now() - __ATTN.startTime) / 1000);
                const m = Math.floor(sec / 60);
                const s = sec % 60;
                durationEl.textContent = m + ':' + String(s).padStart(2, '0');
            }

            if (avgEl && __ATTN.totalSamples > 0) {
                const pct = Math.round((__ATTN.attentiveSamples / __ATTN.totalSamples) * 100);
                avgEl.textContent = pct + '%';
            }
        }

        async function attnToggleMonitor() {
            if (__ATTN.active) {
                attnStopMonitor();
            } else {
                await attnStartMonitor();
            }
        }

        async function attnStartMonitor() {
            const btn = document.getElementById('attn-toggle-btn');
            const detailRow = document.getElementById('attn-detail-row');
            const statusEl = document.getElementById('attn-status-text');

            if (btn) { btn.disabled = true; btn.textContent = '启动中...'; }

            const modelOk = await attnEnsureFaceApiLoaded();
            if (!modelOk) {
                if (statusEl) statusEl.textContent = 'AI模型加载失败';
                if (btn) { btn.disabled = false; btn.textContent = '重试监控'; }
                return;
            }

            if (statusEl) statusEl.textContent = '开启摄像头...';
            const camOk = await attnStartCamera();
            if (!camOk) {
                if (statusEl) statusEl.textContent = '摄像头不可用';
                if (btn) { btn.disabled = false; btn.textContent = '重试监控'; }
                return;
            }

            __ATTN.active = true;
            __ATTN.startTime = Date.now();
            __ATTN.samples = [];
            __ATTN.totalSamples = 0;
            __ATTN.attentiveSamples = 0;
            __ATTN.noFaceCount = 0;
            __ATTN.currentScore = 0;
            __ATTN.materialId = String(window.__HRMS_KB_ACTIVE_ID || '').trim();
            try {
                const items = HRMS_STORE.getKnowledge();
                const item = (items || []).find(x => String(x?.id || '') === __ATTN.materialId);
                __ATTN.materialTitle = String(item?.title || '');
            } catch (e) { __ATTN.materialTitle = ''; }

            // 每秒检测一次
            __ATTN.intervalId = setInterval(() => attnDetectOnce(), 1000);

            if (btn) { btn.disabled = false; btn.textContent = '停止监控'; btn.style.background = 'rgba(239,68,68,0.15)'; btn.style.borderColor = 'rgba(239,68,68,0.3)'; btn.style.color = '#ef4444'; }
            if (detailRow) detailRow.style.display = 'flex';
            if (statusEl) statusEl.textContent = '监控中...';
            showNotification('专注度监控已开启', 'info');
        }

        async function attnStopMonitor() {
            const btn = document.getElementById('attn-toggle-btn');
            const detailRow = document.getElementById('attn-detail-row');
            const statusEl = document.getElementById('attn-status-text');
            const dotEl = document.getElementById('attn-status-dot');

            __ATTN.active = false;
            if (__ATTN.intervalId) { clearInterval(__ATTN.intervalId); __ATTN.intervalId = null; }
            attnStopCamera();

            // 计算最终分数
            const finalScore = __ATTN.totalSamples > 0 ? Math.round((__ATTN.attentiveSamples / __ATTN.totalSamples) * 100) : 0;
            const durationSec = __ATTN.startTime ? Math.floor((Date.now() - __ATTN.startTime) / 1000) : 0;

            // 保存到后端
            if (__ATTN.materialId && durationSec >= 10 && __ATTN.totalSamples >= 5) {
                try {
                    await HRMS_API.request('/api/attention-scores', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            materialId: __ATTN.materialId,
                            materialTitle: __ATTN.materialTitle,
                            score: finalScore,
                            durationSeconds: durationSec,
                            totalSamples: __ATTN.totalSamples,
                            attentiveSamples: __ATTN.attentiveSamples,
                            avgScore: __ATTN.currentScore
                        })
                    });
                } catch (e) {
                    console.error('Save attention score error:', e);
                }
            }

            if (btn) { btn.textContent = '开启监控'; btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }
            if (statusEl) statusEl.textContent = durationSec >= 10 ? '已保存 · 专注率 ' + finalScore + '%' : '已停止';
            if (dotEl) dotEl.style.background = '#666';

            if (durationSec >= 10) {
                showNotification('专注度监控已结束，专注率：' + finalScore + '%', finalScore >= 60 ? 'success' : 'warning');
            } else {
                showNotification('监控时间过短，未保存记录', 'info');
            }
        }

        function attnShowMonitorBar() {
            const bar = document.getElementById('attn-monitor-bar');
            if (bar) bar.style.display = '';
            // 不自动开启摄像头：多数移动端浏览器要求用户手势/HTTPS，否则会直接失败
            try {
                const statusEl = document.getElementById('attn-status-text');
                if (statusEl && !__ATTN.active) statusEl.textContent = '点击“开启监控”启动摄像头';
            } catch (e) {}
        }

        function attnHideMonitorBar() {
            const bar = document.getElementById('attn-monitor-bar');
            if (bar) bar.style.display = 'none';
            if (__ATTN.active) attnStopMonitor();
        }

        function clearKnowledgeViewer() {
            try { attnHideMonitorBar(); } catch (e) {}
            try { document.body.classList.remove('kb-detail-mode'); } catch (e) {}
            try { window.__HRMS_KB_ACTIVE_ID = ''; } catch (e) {}
            const title = document.getElementById('knowledge-viewer-title');
            const meta = document.getElementById('knowledge-viewer-meta');
            const hint = document.getElementById('knowledge-viewer-hint');
            const body = document.getElementById('knowledge-viewer-body');
            if (title) title.textContent = '';
            if (meta) meta.innerHTML = '';
            if (hint) hint.style.display = '';
            if (body) body.innerHTML = '';

            const exportWordBtn = document.getElementById('knowledge-export-word-btn');
            if (exportWordBtn) exportWordBtn.style.display = 'none';
            // V2: 关闭 overlay viewer, 显示列表
            const viewer = document.getElementById('knowledge-viewer');
            const listView = document.getElementById('kb-list-view');
            if (viewer) viewer.classList.remove('kb-v2-active');
            if (listView) listView.classList.remove('kb-v2-hidden');
        }

        function kbBackToList() {
            __KB_ACTIVE_GROUP_ID = '';
            clearKnowledgeViewer();
        }

        function getKnowledgeLastViewedKey() {
            const uname = String(currentUser?.username || 'anonymous');
            return `HRMS_KB_LAST_VIEWED_${uname}`;
        }

        function getKnowledgeLastViewed() {
            try {
                return String(localStorage.getItem(getKnowledgeLastViewedKey()) || '').trim();
            } catch (e) {
                return '';
            }
        }

        function setKnowledgeLastViewed(id) {
            try {
                localStorage.setItem(getKnowledgeLastViewedKey(), String(id || ''));
            } catch (e) {
                // ignore
            }
        }

        function knowledgeItemMatchesUser(item, user) {
            if (!item) return false;
            if (!user) return false;
            if (String(user.role || '') === ROLES.ADMIN) return true;

            const audience = item.audience || item.access || item.scope || {};
            const t = String(audience.type || 'all');
            if (t === 'all') return true;

            const userStore = String(user.store || '').trim();
            const userPos = String(user.position || '').trim();
            if (t === 'store') {
                const list = [];
                if (Array.isArray(audience.stores)) list.push(...audience.stores.map(x => String(x || '').trim()).filter(Boolean));
                const legacy = String(audience.store || audience.value || '').trim();
                if (legacy) list.push(legacy);
                const uniq = [...new Set(list)];
                if (!uniq.length) return false;
                return uniq.some(s => s === userStore);
            }
            if (t === 'position') {
                const list = [];
                if (Array.isArray(audience.positions)) list.push(...audience.positions.map(x => String(x || '').trim()).filter(Boolean));
                const legacy = String(audience.position || audience.value || '').trim();
                if (legacy) list.push(legacy);
                const uniq = [...new Set(list)];
                if (!uniq.length) return false;
                if (uniq.some(p => p === userPos)) return true;
                if (uniq.includes('系统管理员') && String(user.role || '') === ROLES.ADMIN) return true;
                return false;
            }
            return true;
        }

        async function renderKbPdfPreviewFromUrl(src, bodyEl) {
            if (!bodyEl) return;
            bodyEl.innerHTML = '';

            const wrap = document.createElement('div');
            wrap.className = 'kb-pdf-shell kb-dc-panel';

            const toolbar = document.createElement('div');
            toolbar.className = 'kb-pdf-toolbar kb-dc-bar';
            const left = document.createElement('div');
            left.style.cssText = 'display:flex;gap:10px;align-items:center;';

            const btnPrev = document.createElement('button');
            btnPrev.className = 'btn btn-secondary';
            btnPrev.type = 'button';
            btnPrev.textContent = '上一页';
            btnPrev.disabled = true;

            const btnNext = document.createElement('button');
            btnNext.className = 'btn btn-secondary';
            btnNext.type = 'button';
            btnNext.textContent = '下一页';
            btnNext.disabled = true;

            const pageInfo = document.createElement('div');
            pageInfo.className = 'kb-pdf-page-indicator';
            pageInfo.textContent = 'PDF 加载中...';

            left.appendChild(btnPrev);
            left.appendChild(pageInfo);
            left.appendChild(btnNext);
            toolbar.appendChild(left);

            const canvasWrap = document.createElement('div');
            canvasWrap.className = 'kb-pdf-canvas-wrap';

            const canvas = document.createElement('canvas');
            canvas.className = 'kb-pdf-canvas';

            const frame = document.createElement('iframe');
            frame.title = 'pdf';
            frame.src = src;
            frame.className = 'kb-pdf-fallback-frame';

            canvasWrap.appendChild(canvas);
            canvasWrap.appendChild(frame);
            wrap.appendChild(toolbar);
            wrap.appendChild(canvasWrap);
            bodyEl.appendChild(wrap);

            const fallbackToIframe = (msg) => {
                try { if (msg) pageInfo.textContent = msg; } catch (e) {}
                try { canvas.style.display = 'none'; frame.style.display = ''; } catch (e) {}
            };

            let done = false;
            let tmr = null;
            const armPdfTimeout = (ms, msg) => {
                try {
                    if (tmr) clearTimeout(tmr);
                } catch (e) {}
                tmr = setTimeout(() => {
                    if (done) return;
                    done = true;
                    fallbackToIframe(msg);
                }, ms);
            };

            try {
                const ok = await ensurePdfJsLoaded();
                if (!ok || typeof pdfjsLib === 'undefined') {
                    done = true;
                    if (tmr) clearTimeout(tmr);
                    fallbackToIframe('PDF 预览组件未加载，已切换到内嵌打开');
                    return;
                }

                pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.js';
                armPdfTimeout(55000, 'PDF 预览超时，已切换到内嵌打开');

                const doc = await pdfjsLib.getDocument({ url: src }).promise;
                let cur = 1;
                const total = Math.max(1, Number(doc.numPages || 1) || 1);

                const renderPage = async (n) => {
                    const pageNum = Math.max(1, Math.min(total, Number(n || 1) || 1));
                    cur = pageNum;
                    const page = await doc.getPage(pageNum);
                    const wrapWidth = Math.max(320, Math.floor((canvasWrap.getBoundingClientRect?.().width || 0) - 8));
                    const vp1 = page.getViewport({ scale: 1 });
                    const dpr = Math.max(1, window.devicePixelRatio || 1);
                    const fitScale = wrapWidth > 0 ? (wrapWidth / Math.max(1, vp1.width)) : 1.5;
                    const renderScale = Math.max(1.0, Math.min(dpr * 2, fitScale * dpr));
                    const viewport = page.getViewport({ scale: renderScale });

                    canvas.width = Math.floor(viewport.width);
                    canvas.height = Math.floor(viewport.height);
                    const cssW = Math.floor(viewport.width / dpr);
                    const cssH = Math.floor(viewport.height / dpr);
                    canvas.style.width = cssW + 'px';
                    canvas.style.height = cssH + 'px';
                    canvas.style.maxWidth = '100%';

                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    await page.render({ canvasContext: ctx, viewport }).promise;
                    try { pageInfo.textContent = `第 ${cur} / ${total} 页`; } catch (e) {}
                    try { btnPrev.disabled = cur <= 1; btnNext.disabled = cur >= total; } catch (e) {}
                };

                btnPrev.onclick = async () => { try { await renderPage(cur - 1); } catch (e) {} };
                btnNext.onclick = async () => { try { await renderPage(cur + 1); } catch (e) {} };
                try { btnPrev.disabled = total <= 1; btnNext.disabled = total <= 1; } catch (e) {}

                await renderPage(1);

                done = true;
                if (tmr) clearTimeout(tmr);
                try { btnPrev.disabled = total <= 1; btnNext.disabled = total <= 1; } catch (e) {}
            } catch (e) {
                console.error(e);
                done = true;
                if (tmr) clearTimeout(tmr);
                fallbackToIframe('PDF 预览失败，已切换到内嵌打开');
            }
        }

        function openKnowledgeItem(itemId) {
            const id = String(itemId || '').trim();
            if (!id) return;
            const items = HRMS_STORE.getKnowledge();
            const item = (items || []).find(x => String(x?.id || '') === id);
            if (!item) {
                showNotification('未找到资料', 'error');
                return;
            }
            if (!isAdminUser() && !knowledgeItemMatchesUser(item, currentUser)) {
                showNotification('无权限查看该资料', 'warning');
                return;
            }

            setKnowledgeLastViewed(id);

            try { window.__HRMS_KB_ACTIVE_ID = id; } catch (e) {}

            const type = String(item.type || 'doc');

            // V2: 显示 overlay viewer，隐藏列表
            const viewer = document.getElementById('knowledge-viewer');
            const listView = document.getElementById('kb-list-view');
            if (viewer) viewer.classList.add('kb-v2-active');
            if (listView) listView.classList.add('kb-v2-hidden');

            try { attnHideMonitorBar(); } catch (e) {}

            const title = document.getElementById('knowledge-viewer-title');
            const meta = document.getElementById('knowledge-viewer-meta');
            const hint = document.getElementById('knowledge-viewer-hint');
            const body = document.getElementById('knowledge-viewer-body');

            if (hint) hint.style.display = 'none';
            if (title) title.textContent = String(item.title || '');
            if (meta) {
                const typeIcon = { video:'🎬', pdf:'📕', doc:'📘', img:'🖼️', txt:'📝' }[String(item.type||'doc')] || '📄';
                const t = String(item.type || 'doc').toUpperCase();
                const cat = String(item.category || '');
                const groupName = String(item.groupName || getKnowledgeGroupLabel(item.groupId) || '').trim();
                const sz = item.size ? formatFileSize(item.size) : '';
                meta.innerHTML = `<span class="kb-v2-chip kb-v2-chip-type">${typeIcon} ${t}</span>${groupName ? `<span class="kb-v2-chip" style="background:rgba(124,141,255,0.16);color:#d8ddff;">${escapeHtml(groupName)}</span>` : ''}${cat ? `<span class="kb-v2-chip" style="background:rgba(255,255,255,0.07);color:rgba(148,163,184,0.8);">${escapeHtml(cat)}</span>` : ''}${sz ? `<span class="kb-v2-item-date">${escapeHtml(sz)}</span>` : ''}`;
            }

            // 管理员按钮
            const deleteBtn = document.getElementById('knowledge-delete-btn');
            const editBtn = document.getElementById('knowledge-edit-btn');
            const transferBtn = document.getElementById('knowledge-transfer-btn');
            if (deleteBtn) {
                deleteBtn.style.display = isAdminUser() ? '' : 'none';
                deleteBtn.onclick = () => deleteKnowledgeItem(id);
            }
            if (editBtn) {
                editBtn.style.display = isAdminUser() ? '' : 'none';
                editBtn.onclick = () => openKnowledgeEditModal(id);
            }
            if (transferBtn) {
                transferBtn.style.display = isAdminUser() ? '' : 'none';
                transferBtn.onclick = () => openKnowledgeOrganizerSheet(item?.groupId || __KB_ACTIVE_GROUP_ID || '', id);
            }
            const rubricBtn = document.getElementById('knowledge-rubric-btn');
            if (rubricBtn) {
                const isVideoImg = type === 'video' || type === 'img';
                rubricBtn.style.display = (isAdminUser() && isVideoImg) ? '' : 'none';
                if (isVideoImg) {
                    rubricBtn.textContent = item.step_rubric ? '🔄 重新生成图谱' : '🎯 生成步骤图谱';
                    rubricBtn.onclick = () => analyzeKnowledgeRubric(id);
                }
            }
            const exportWordBtn2 = document.getElementById('knowledge-export-word-btn');
            if (exportWordBtn2) exportWordBtn2.style.display = '';

            if (!body) return;
            body.innerHTML = '';
            body.dataset.itemId = id;

            // ── AI 知识解析视图（主展示方式，与培训认证共用缓存）──
            const base = String(HRMS_API.baseUrl() || window.location?.origin || '').replace(/\/$/, '');
            const token = String(HRMS_API.token() || '').trim();

            // 所有类型：只显示 AI 解析（视频额外保留播放器）
            const fileSrc = token ? `${base}/api/knowledge/${encodeURIComponent(id)}/file?token=${encodeURIComponent(token)}` : '';

            if (type === 'video' && token) {
                const vWrap = document.createElement('div');
                vWrap.className = 'kb-video-viewer';
                const v = document.createElement('video');
                v.controls = true; v.src = fileSrc; v.preload = 'metadata';
                vWrap.appendChild(v);
                body.appendChild(vWrap);
            }

            const aiBox = document.createElement('div');
            if (type === 'video') aiBox.style.marginTop = '16px';
            body.appendChild(aiBox);
            kbLoadAiSummary(id, aiBox, { showFileBtn: isAdminUser() && type !== 'video', fileSrc, fileType: type });

            if (isAdminUser()) {
                const contentBox = document.createElement('div');
                contentBox.style.marginTop = '16px';
                body.appendChild(contentBox);
                kbLoadRawContent(id, contentBox);
            }
        }

        // ── 知识库 AI 解析（复用培训认证缓存端点）──
        async function kbLoadAiSummary(itemId, container, opts = {}) {
            const token = HRMS_API.token() || '';
            container.innerHTML = `
                <div style="text-align:center;padding:44px 0;color:rgba(255,255,255,0.38);">
                    <div style="font-size:32px;margin-bottom:12px;opacity:0.8;">✨</div>
                    <div style="font-size:13px;">AI 正在整理知识要点，请稍候…</div>
                </div>`;
            try {
                const resp = await fetch('/api/knowledge/' + encodeURIComponent(itemId) + '/explanation', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await resp.json();
                // Helper: render rubric card
                function renderRubricCard(rubric) {
                    if (!rubric || !Array.isArray(rubric.items)) return '';
                    const typeLabel = rubric.type === 'checkpoints' ? '连续检查' : '分步操作';
                    const stepsSummary = rubric.items.map((s,i)=>`${i+1}.${escapeHtml(s.name)}(${s.weight}分)`).join(' · ');
                    const stepsDetail = rubric.items.map(s =>
                        `<div style="margin:6px 0"><strong>${escapeHtml(s.name)}</strong> (${s.weight}分): ${(s.checks||[]).map(c=>escapeHtml(c)).join('；')}</div>`
                    ).join('');
                    const failHtml = rubric.fail_criteria?.length
                        ? `<div style="margin-top:8px;color:#fca5a5;">⚠️ 一票否决: ${rubric.fail_criteria.map(f=>escapeHtml(f)).join('；')}</div>`
                        : '';
                    return `<div class="kb-ai-card" style="margin-top:12px;">
                        <div class="kb-ai-card-hdr">
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-size:20px;flex-shrink:0;">🎯</span>
                                <div style="flex:1;min-width:0;">
                                    <div class="kb-ai-card-title">步骤图谱（${typeLabel}）</div>
                                    <div class="kb-ai-card-sub">${stepsSummary} | 合格线 ${rubric.pass_threshold||80}分</div>
                                </div>
                            </div>
                        </div>
                        <div class="kb-ai-content" style="font-size:12px;">${stepsDetail}${failHtml}</div>
                    </div>`;
                }

                if (data.success && data.explanation) {
                    const rawExplanation = data.explanation;
                    const cacheBadge = data.cached
                        ? '<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:rgba(52,211,153,0.15);color:#6ee7b7;margin-left:6px;">已缓存</span>'
                        : '<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:rgba(251,191,36,0.15);color:#fde68a;margin-left:6px;">✨ 新生成</span>';
                    const html = rawExplanation
                        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                        .replace(/^## (.+)$/gm,'<div class="kb-ai-h2">$1</div>')
                        .replace(/^### (.+)$/gm,'<div class="kb-ai-h3">$1</div>')
                        .replace(/^[-•] (.+)$/gm,'<div class="kb-ai-bullet"><span class="kb-ai-dot">•</span><span>$1</span></div>')
                        .replace(/^\d+\. (.+)$/gm,'<div class="kb-ai-num">$1</div>')
                        .replace(/\*\*(.+?)\*\*/g,'<strong style="color:#fff;font-weight:600;">$1</strong>')
                        .replace(/\n/g,'<br>');

                    let fileBtnHtml = '';
                    if (opts.showFileBtn && opts.fileSrc) {
                        const typeLabel = opts.fileType === 'pdf' ? 'PDF' : (opts.fileType === 'doc' ? '原文档' : '原文件');
                        fileBtnHtml = `<a href="${escapeHtml(opts.fileSrc)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:16px;padding:8px 16px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:12px;text-decoration:none;">📎 查看${typeLabel}</a>`;
                    }

                    const isAdmin = isAdminUser();
                    const editBtnHtml = isAdmin
                        ? `<button onclick="editKnowledgeExplanation('${escapeHtml(itemId)}', this)" style="padding:4px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;">✏️ 编辑</button>`
                        : '';
                    const regenBtnHtml = isAdmin && data.cached
                        ? `<button onclick="regenKnowledgeExplanation('${escapeHtml(itemId)}', this)" style="padding:4px 12px;border-radius:8px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.25);color:#fde68a;font-size:11px;cursor:pointer;">🔄 重新生成</button>`
                        : '';
                    const copyBtnHtml = `<button onclick="copyKnowledgeExplanation(this)" style="padding:4px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;">📋 复制</button>`;

                    container.innerHTML = `
                        <div class="kb-ai-card">
                            <div class="kb-ai-card-hdr">
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <span style="font-size:20px;flex-shrink:0;">✨</span>
                                    <div style="flex:1;min-width:0;">
                                        <div class="kb-ai-card-title">AI 知识解析${cacheBadge}</div>
                                        <div class="kb-ai-card-sub">AI 精心整理要点，助你快速掌握核心内容</div>
                                    </div>
                                </div>
                                <div class="kb-ai-card-actions">
                                    ${copyBtnHtml}
                                    ${regenBtnHtml}
                                    ${editBtnHtml}
                                </div>
                            </div>
                            <div class="kb-ai-content">${html}</div>
                            ${fileBtnHtml ? `<div style="margin-top:12px;">${fileBtnHtml}</div>` : ''}
                        </div>
                        ${renderRubricCard(data.rubric)}`;
                    container.dataset.rawExplanation = rawExplanation;
                } else if (data.success && !data.explanation && data.rubric) {
                    // 媒体文件：有图谱但无文字解析（图片/视频的正常状态）
                    container.innerHTML = renderRubricCard(data.rubric);
                } else if (data.error === 'no_content') {
                    const hint = String(data.message || '');
                    const isMedia = hint.includes('图片') || hint.includes('视频') || hint.includes('生成步骤图谱');
                    const canGenRubric = isMedia && isAdminUser();
                    container.innerHTML = `
                        <div class="kb-ai-empty">
                            <div style="font-size:36px;margin-bottom:12px;">${isMedia ? '🖼️' : '📄'}</div>
                            <div style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:6px;">${isMedia ? '图片/视频文件' : '暂无可解析内容'}</div>
                            <div style="font-size:12px;color:rgba(255,255,255,0.35);line-height:1.7;margin-bottom:${canGenRubric ? '16px' : '0'};">${isMedia ? 'AI 可分析此文件并生成实操评分标准（步骤图谱）' : '文件正在处理中，通常需要 1-2 分钟<br>视频请确保管理员已填写内容摘要'}</div>
                            ${canGenRubric ? `<button onclick="analyzeKnowledgeRubric('${escapeHtml(itemId)}', this)" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:12px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:0.02em;">🎯 生成步骤图谱</button>` : ''}
                            ${opts.showFileBtn && opts.fileSrc ? `<a href="${escapeHtml(opts.fileSrc)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;margin-top:16px;padding:8px 16px;border-radius:10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.5);font-size:12px;text-decoration:none;">📎 查看原文件</a>` : ''}
                        </div>`;
                } else {
                    container.innerHTML = `<div class="kb-ai-empty"><div style="font-size:32px;margin-bottom:10px;">⚠️</div><div style="font-size:13px;color:rgba(255,255,255,0.4);">${escapeHtml(data.message || 'AI 解析失败，请稍后重试')}</div></div>`;
                }
            } catch(e) {
                container.innerHTML = `<div class="kb-ai-empty"><div style="font-size:32px;margin-bottom:10px;">📡</div><div style="font-size:13px;color:rgba(255,255,255,0.4);">网络错误，请检查连接后重试</div></div>`;
            }
        }

        async function analyzeKnowledgeRubric(itemId, inlineBtn) {
            const token = HRMS_API.token() || '';
            const topbarBtn = document.getElementById('knowledge-rubric-btn');
            // Support both the topbar button and an inline button inside the card
            const allBtns = [topbarBtn, inlineBtn].filter(Boolean);
            try {
                allBtns.forEach(b => { b.disabled = true; b.textContent = '⏳ AI分析中...'; });
                const resp = await fetch('/api/knowledge/' + encodeURIComponent(itemId) + '/analyze-rubric', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                const data = await resp.json();
                if (data.success && data.rubric) {
                    showNotification(`步骤图谱已生成！共 ${data.rubric.items?.length || 0} 个步骤/检查点`, 'success');
                    allBtns.forEach(b => { b.textContent = '🔄 重新生成图谱'; });
                    // Replace viewer body with fresh rubric card
                    const viewerBody = document.getElementById('knowledge-viewer-body');
                    if (viewerBody) {
                        viewerBody.innerHTML = '';
                        const rubricInfo = document.createElement('div');
                        rubricInfo.className = 'kb-ai-card';
                        rubricInfo.innerHTML = `
                            <div class="kb-ai-card-hdr">
                                <div style="display:flex;align-items:center;gap:10px;">
                                    <span style="font-size:20px;flex-shrink:0;">🎯</span>
                                    <div style="flex:1;min-width:0;">
                                        <div class="kb-ai-card-title">步骤图谱 (${data.rubric.type === 'checkpoints' ? '连续检查' : '分步操作'})</div>
                                        <div class="kb-ai-card-sub">${data.rubric.items.map((s,i)=>`${i+1}.${s.name}(${s.weight}分)`).join(' · ')} | 合格线 ${data.rubric.pass_threshold||80}分</div>
                                    </div>
                                </div>
                            </div>
                            <div class="kb-ai-content" style="font-size:12px;">
                                ${data.rubric.items.map(s => `<div style="margin:6px 0"><strong>${escapeHtml(s.name)}</strong> (${s.weight}分): ${(s.checks||[]).map(c=>escapeHtml(c)).join('；')}</div>`).join('')}
                                ${data.rubric.fail_criteria?.length ? `<div style="margin-top:8px;color:#fca5a5;">⚠️ 一票否决: ${data.rubric.fail_criteria.map(f=>escapeHtml(f)).join('；')}</div>` : ''}
                            </div>`;
                        viewerBody.appendChild(rubricInfo);
                    }
                } else {
                    showNotification('生成失败: ' + (data.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('请求失败: ' + (e.message || e), 'error');
            } finally {
                allBtns.forEach(b => { b.disabled = false; });
            }
        }

        async function exportKnowledgeToWord() {
            const itemId = window.__HRMS_KB_ACTIVE_ID;
            if (!itemId) { showNotification('请先打开一个知识库条目', 'warning'); return; }
            const btn = document.getElementById('knowledge-export-word-btn');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }
            try {
                // 1. 懒加载 docx.js
                if (!window.docx) {
                    await new Promise((resolve, reject) => {
                        const urls = [
                            '/docx.umd.js',
                            'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
                            'https://unpkg.com/docx@8.5.0/build/index.umd.js'
                        ];
                        let tried = 0;
                        const tryLoad = (url) => {
                            const s = document.createElement('script'); s.src = url;
                            s.onload = resolve;
                            s.onerror = () => { tried++; tried < urls.length ? tryLoad(urls[tried]) : reject(new Error('docx.js 加载失败')); };
                            document.head.appendChild(s);
                        };
                        tryLoad(urls[0]);
                    });
                }

                // 2. 获取条目信息和 AI 解析数据
                const token = HRMS_API.token() || '';
                const allItems = HRMS_STORE.getKnowledge();
                const item = (allItems || []).find(x => String(x?.id || '') === itemId) || {};
                const resp = await fetch('/api/knowledge/' + encodeURIComponent(itemId) + '/explanation', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await resp.json();

                // 3. 构建 Word 文档
                const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;
                const children = [];

                // 标题
                children.push(new Paragraph({ text: String(item.title || '知识库资料'), heading: HeadingLevel.HEADING_1 }));

                // 元数据
                const metaParts = [];
                if (item.type) metaParts.push('类型：' + String(item.type).toUpperCase());
                if (item.category) metaParts.push('分类：' + item.category);
                if (item.groupName) metaParts.push('分组：' + item.groupName);
                const created = String(item.created_at || '').slice(0, 10);
                if (created) metaParts.push('创建日期：' + created);
                if (metaParts.length) {
                    children.push(new Paragraph({ children: [new TextRun({ text: metaParts.join('   |   '), color: '888888', size: 20 })] }));
                }
                children.push(new Paragraph({ text: '' }));

                // AI 知识解析
                if (data.success && data.explanation) {
                    children.push(new Paragraph({ text: 'AI 知识解析', heading: HeadingLevel.HEADING_2 }));
                    children.push(new Paragraph({ text: '' }));
                    let numIdx = 0;
                    for (const line of String(data.explanation).split('\n')) {
                        const t = line.trim();
                        if (!t) { children.push(new Paragraph({ text: '' })); numIdx = 0; continue; }
                        if (t.startsWith('## ')) {
                            numIdx = 0;
                            children.push(new Paragraph({ text: t.slice(3).trim(), heading: HeadingLevel.HEADING_3 }));
                        } else if (t.startsWith('### ')) {
                            numIdx = 0;
                            children.push(new Paragraph({ text: t.slice(4).trim(), heading: HeadingLevel.HEADING_4 }));
                        } else if (t.startsWith('- ') || t.startsWith('• ')) {
                            const content = t.replace(/^[-•] /, '').replace(/\*\*(.+?)\*\*/g, '$1');
                            children.push(new Paragraph({ children: [new TextRun({ text: '• ' + content })], indent: { left: 360 } }));
                        } else if (/^\d+\.\s/.test(t)) {
                            numIdx++;
                            const content = t.replace(/^\d+\.\s/, '').replace(/\*\*(.+?)\*\*/g, '$1');
                            children.push(new Paragraph({ children: [new TextRun({ text: numIdx + '. ' + content })], indent: { left: 360 } }));
                        } else {
                            const parts = t.split(/(\*\*[^*]+\*\*)/g);
                            const runs = parts.filter(Boolean).map(p =>
                                p.startsWith('**') ? new TextRun({ text: p.slice(2, -2), bold: true }) : new TextRun({ text: p })
                            );
                            children.push(new Paragraph({ children: runs.length ? runs : [new TextRun({ text: t })] }));
                        }
                    }
                    children.push(new Paragraph({ text: '' }));
                }

                // 步骤图谱 — rendered as paragraphs (avoids Table API cross-platform issues)
                const rubric = data.rubric;
                if (rubric && Array.isArray(rubric.items) && rubric.items.length > 0) {
                    children.push(new Paragraph({ text: '步骤图谱', heading: HeadingLevel.HEADING_2 }));
                    const typeLabel = rubric.type === 'checkpoints' ? '连续检查' : '分步操作';
                    children.push(new Paragraph({
                        children: [new TextRun({ text: '评分类型：' + typeLabel + '　　合格线：' + (rubric.pass_threshold || 80) + ' 分', color: '666666', size: 20 })]
                    }));
                    children.push(new Paragraph({ text: '' }));
                    const nums = ['一','二','三','四','五','六','七','八','九','十'];
                    rubric.items.forEach((s, idx) => {
                        children.push(new Paragraph({
                            children: [new TextRun({ text: '步骤' + (nums[idx] || (idx+1)) + '：' + String(s.name || '') + '（' + (s.weight || 0) + ' 分）', bold: true })]
                        }));
                        (s.checks || []).forEach(c => {
                            children.push(new Paragraph({ children: [new TextRun({ text: '• ' + c })], indent: { left: 360 } }));
                        });
                        children.push(new Paragraph({ text: '' }));
                    });
                    if (rubric.fail_criteria?.length) {
                        children.push(new Paragraph({ children: [new TextRun({ text: '⚠ 一票否决条件', bold: true, color: 'CC0000' })] }));
                        rubric.fail_criteria.forEach(f => children.push(new Paragraph({ children: [new TextRun({ text: '• ' + f })], indent: { left: 360 } })));
                        children.push(new Paragraph({ text: '' }));
                    }
                }

                // 4. 生成并下载
                const doc = new Document({ sections: [{ properties: {}, children }] });
                const blob = await Packer.toBlob(doc);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = String(item.title || '知识库资料').replace(/[\\/:*?"<>|]/g, '_') + '.docx';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch(e){} }, 300);
                showNotification('Word 文件已生成，请查看下载', 'success');

            } catch(e) {
                showNotification('导出失败：' + (e.message || String(e)), 'error');
                console.error('[exportKnowledgeToWord]', e);
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '📄 导出 Word'; }
            }
        }

        function renderBiSourcePresetDatalist() {
            const sel = document.getElementById('bi-source-add-key');
            if (!sel) return;
            sel.innerHTML = ['<option value="">请选择数据源</option>']
                .concat(BI_SOURCE_PRESET_OPTIONS.map((x) => `<option value="${escapeHtml(x.key)}">${escapeHtml(x.label)} (${escapeHtml(x.key)})</option>`))
                .join('');
        }

        function editKnowledgeExplanation(itemId, btn) {
            const viewerBody = document.getElementById('knowledge-viewer-body');
            const card = btn?.closest('.kb-ai-card');
            const raw = card?.parentElement?.dataset?.rawExplanation || viewerBody?.dataset?.rawExplanation || '';
            const contentDiv = card?.querySelector('.kb-ai-content');
            if (!contentDiv) return;
            const textarea = document.createElement('textarea');
            textarea.value = raw;
            textarea.style.width = '100%';
            textarea.style.minHeight = '200px';
            textarea.style.padding = '12px';
            textarea.style.borderRadius = '10px';
            textarea.style.border = '1px solid rgba(255,255,255,0.15)';
            textarea.style.background = 'rgba(0,0,0,0.25)';
            textarea.style.color = 'rgba(255,255,255,0.85)';
            textarea.style.fontSize = '13px';
            textarea.style.lineHeight = '1.7';
            textarea.style.resize = 'vertical';
            textarea.style.outline = 'none';
            contentDiv.replaceWith(textarea);
            const actions = card?.querySelector('.kb-ai-card-actions');
            if (actions) {
                actions.innerHTML = `
                    <button onclick="saveKnowledgeExplanation('${escapeHtml(itemId)}', this)" style="padding:6px 16px;border-radius:8px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;font-size:12px;cursor:pointer;">💾 保存</button>
                    <button onclick="cancelEditKnowledgeExplanation(this)" style="padding:6px 16px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);font-size:12px;cursor:pointer;">取消</button>
                `;
            }
        }

        async function saveKnowledgeExplanation(itemId, btn) {
            const container = btn?.closest('#knowledge-viewer-body') || document.getElementById('knowledge-viewer-body');
            const textarea = container?.querySelector('textarea');
            if (!textarea) return;
            const explanation = textarea.value.trim();
            if (!explanation) { showNotification('内容不能为空', 'warning'); return; }
            try {
                btn.disabled = true;
                btn.textContent = '保存中...';
                await HRMS_API.updateKnowledgeExplanation(itemId, explanation);
                showNotification('已保存', 'success');
                btn.textContent = 'AI正在整理排版...';
                try {
                    await HRMS_API.reformatKnowledgeExplanation(itemId);
                } catch (e2) {
                    console.error('reformat failed:', e2);
                }
                // reload the summary
                const aiBox = container?.querySelector('.kb-ai-card')?.parentElement || container;
                await kbLoadAiSummary(itemId, aiBox, {});
            } catch (e) {
                showNotification('保存失败：' + String(e?.message || e), 'error');
                btn.disabled = false;
                btn.textContent = '💾 保存';
            }
        }

        function cancelEditKnowledgeExplanation(btn) {
            const container = btn?.closest('#knowledge-viewer-body') || document.getElementById('knowledge-viewer-body');
            if (!container) return;
            const kbAiCard = container.querySelector('.kb-ai-card');
            if (kbAiCard) {
                const aiBox = kbAiCard.parentElement;
                const itemId = container.dataset?.itemId || window.__HRMS_KB_ACTIVE_ID;
                if (itemId) kbLoadAiSummary(itemId, aiBox, {});
            }
        }

        async function copyKnowledgeExplanation(btn) {
            const card = btn?.closest('.kb-ai-card');
            const raw = card?.parentElement?.dataset?.rawExplanation || '';
            if (!raw) return;
            try {
                await navigator.clipboard.writeText(raw);
                btn.textContent = '✅ 已复制';
                btn.style.color = '#6ee7b7';
                setTimeout(() => { btn.textContent = '📋 复制'; btn.style.color = 'rgba(255,255,255,0.5)'; }, 2000);
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = raw;
                ta.style.position = 'fixed'; ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                btn.textContent = '✅ 已复制';
                setTimeout(() => { btn.textContent = '📋 复制'; }, 2000);
            }
        }

        async function regenKnowledgeExplanation(itemId, btn) {
            if (!itemId) return;
            const token = HRMS_API.token() || '';
            const origText = btn ? btn.textContent : '';
            try {
                if (btn) { btn.disabled = true; btn.textContent = '⏳ 清除中…'; }
                const resp = await fetch('/api/knowledge/' + encodeURIComponent(itemId) + '/explanation/regenerate', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await resp.json();
                if (data.success) {
                    showNotification('缓存已清除，正在重新生成完整解析…', 'info');
                    // Reload the AI summary from scratch
                    const viewerBody = document.getElementById('knowledge-viewer-body');
                    const aiBox = viewerBody || document.createElement('div');
                    aiBox.innerHTML = '';
                    await kbLoadAiSummary(itemId, aiBox, {
                        showFileBtn: isAdminUser(),
                        fileType: String(window.__HRMS_KB_ACTIVE_ID || '')
                    });
                } else {
                    showNotification('操作失败：' + (data.message || data.error), 'error');
                    if (btn) { btn.disabled = false; btn.textContent = origText; }
                }
            } catch(e) {
                showNotification('请求失败：' + (e.message || e), 'error');
                if (btn) { btn.disabled = false; btn.textContent = origText; }
            }
        }

        // ── 知识库 教材原文（可编辑，留痕）──
        async function kbLoadRawContent(itemId, container) {
            container.innerHTML = `<div style="text-align:center;padding:16px 0;color:rgba(255,255,255,0.3);font-size:12px;">加载教材原文…</div>`;
            try {
                const resp = await HRMS_API.request('/api/knowledge/' + encodeURIComponent(itemId) + '/content', { method: 'GET' });
                const content = String(resp?.content || '').trim();
                if (!content) { container.innerHTML = ''; return; }
                const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
                container.dataset.rawContent = content;
                container.innerHTML = `
                    <details class="kb-ai-card kb-content-card">
                        <summary style="cursor:pointer;font-weight:700;color:#EEF1FA;font-size:13px;">📄 教材原文（${content.length}字，可编辑）</summary>
                        <div class="kb-ai-card-actions" style="margin-top:12px;">
                            <button onclick="editKnowledgeContent('${escapeHtml(itemId)}', this)" style="padding:4px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;">✏️ 编辑</button>
                        </div>
                        <div class="kb-ai-content" style="margin-top:12px;font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;">${esc(content)}</div>
                    </details>`;
            } catch (e) {
                container.innerHTML = '';
            }
        }

        function editKnowledgeContent(itemId, btn) {
            const card = btn?.closest('.kb-content-card');
            if (!card) return;
            const raw = card.parentElement?.dataset?.rawContent || '';
            const contentDiv = card.querySelector('.kb-ai-content');
            if (!contentDiv) return;
            const textarea = document.createElement('textarea');
            textarea.value = raw;
            textarea.style.width = '100%';
            textarea.style.minHeight = '240px';
            textarea.style.marginTop = '12px';
            textarea.style.padding = '12px';
            textarea.style.borderRadius = '10px';
            textarea.style.border = '1px solid rgba(255,255,255,0.15)';
            textarea.style.background = 'rgba(0,0,0,0.25)';
            textarea.style.color = 'rgba(255,255,255,0.85)';
            textarea.style.fontSize = '12px';
            textarea.style.lineHeight = '1.7';
            textarea.style.resize = 'vertical';
            textarea.style.outline = 'none';
            contentDiv.replaceWith(textarea);
            const actions = card.querySelector('.kb-ai-card-actions');
            if (actions) {
                actions.innerHTML = `
                    <button onclick="saveKnowledgeContent('${escapeHtml(itemId)}', this)" style="padding:6px 16px;border-radius:8px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;font-size:12px;cursor:pointer;">💾 保存</button>
                    <button onclick="cancelEditKnowledgeContent(this)" style="padding:6px 16px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);font-size:12px;cursor:pointer;">取消</button>
                `;
            }
        }

        async function saveKnowledgeContent(itemId, btn) {
            const card = btn?.closest('.kb-content-card');
            const textarea = card?.querySelector('textarea');
            if (!textarea) return;
            const content = textarea.value;
            if (!content.trim()) { showNotification('内容不能为空', 'warning'); return; }
            try {
                btn.disabled = true;
                btn.textContent = '保存中...';
                await HRMS_API.updateKnowledge(itemId, { content });
                showNotification('已保存', 'success');
                const container = card.parentElement;
                await kbLoadRawContent(itemId, container);
            } catch (e) {
                showNotification('保存失败：' + String(e?.message || e), 'error');
                btn.disabled = false;
                btn.textContent = '💾 保存';
            }
        }

        function cancelEditKnowledgeContent(btn) {
            const card = btn?.closest('.kb-content-card');
            const container = card?.parentElement;
            const itemId = document.getElementById('knowledge-viewer-body')?.dataset?.itemId || window.__HRMS_KB_ACTIVE_ID;
            if (container && itemId) kbLoadRawContent(itemId, container);
        }

        function normalizeBiDataSourcesForUi(cfg) {
            const current = Array.isArray(cfg?.dataSources) ? cfg.dataSources : [];
            const map = new Map(current.map((x) => [String(x?.key || '').trim(), x]));
            const merged = BI_SOURCE_PRESET_OPTIONS.map((x) => {
                const hit = map.get(x.key) || {};
                return {
                    key: x.key,
                    label: String(hit.label || x.label || x.key).trim(),
                    sourceType: String(hit.sourceType || x.sourceType || 'custom').trim(),
                    enabled: hit.enabled === undefined ? true : !!hit.enabled
                };
            });
            current.forEach((x) => {
                const key = String(x?.key || '').trim();
                if (!key || merged.some((m) => m.key === key)) return;
                merged.push({
                    key,
                    label: String(x?.label || key).trim(),
                    sourceType: String(x?.sourceType || 'custom').trim(),
                    enabled: x?.enabled !== false
                });
            });
            return merged;
        }

        function renderBiDataSources(list) {
            const dsBox = document.getElementById('bi-config-datasources');
            if (!dsBox) return;
            dsBox.innerHTML = (Array.isArray(list) ? list : []).map((item) => {
                const key = String(item?.key || '').trim();
                const label = String(item?.label || key).trim();
                return `<option value="${escapeHtml(key)}" ${item?.enabled === false ? '' : 'selected'}>${escapeHtml(label)} (${escapeHtml(key)})</option>`;
            }).join('');
        }

        function getBiAnomalyCategoryOptions() {
            const dict = Array.isArray(__BI_AGENT_CONFIG?.anomalyDictionary) ? __BI_AGENT_CONFIG.anomalyDictionary : [];
            const out = [];
            const seen = new Set();
            dict.forEach((x) => {
                const c = String(x?.category || x?.label || '').trim();
                if (!c || seen.has(c)) return;
                seen.add(c);
                out.push(c);
            });
            return out;
        }

        function syncRuleCategoryOptions(selected = '') {
            const sel = document.getElementById('rule-category');
            if (!sel) return;
            const values = [];
            const seen = new Set();
            getBiAnomalyCategoryOptions().forEach((x) => {
                if (!seen.has(x)) { seen.add(x); values.push(x); }
            });
            (__AGENT_RULES || []).forEach((r) => {
                const c = String(r?.category || '').trim();
                if (!c || seen.has(c)) return;
                seen.add(c);
                values.push(c);
            });
            const s = String(selected || '').trim();
            if (s && !seen.has(s)) values.unshift(s);
            sel.innerHTML = values.map((x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
            if (!values.length) sel.innerHTML = '<option value="">暂无异常类型，请先在 BI 配置维护字典</option>';
            if (s) sel.value = s;
        }

        function addBiDataSource() {
            const keyEl = document.getElementById('bi-source-add-key');
            const key = String(keyEl?.value || '').trim();
            if (!key) { showNotification('请先选择数据源', 'warning'); return; }
            const current = (__BI_AGENT_CONFIG && typeof __BI_AGENT_CONFIG === 'object') ? __BI_AGENT_CONFIG : {};
            const list = normalizeBiDataSourcesForUi(current);
            if (list.some((x) => String(x.key) === key)) {
                showNotification('该数据源已存在', 'warning');
                return;
            }
            const preset = BI_SOURCE_PRESET_OPTIONS.find((x) => String(x.key) === key);
            list.push({ key, label: String(preset?.label || key), sourceType: String(preset?.sourceType || 'custom'), enabled: true });
            __BI_AGENT_CONFIG = { ...current, dataSources: list };
            renderBiDataSources(list);
            if (keyEl) keyEl.value = '';
        }

        function switchAgentTemplateKind(kind) {
            const next = kind === 'reply' ? 'reply' : 'prompt';
            __AGENT_TEMPLATE_KIND = next;
            const promptBtn = document.getElementById('agent-template-kind-prompt');
            const replyBtn = document.getElementById('agent-template-kind-reply');
            if (promptBtn) promptBtn.classList.toggle('active', next === 'prompt');
            if (replyBtn) replyBtn.classList.toggle('active', next === 'reply');
            const title = document.getElementById('agent-template-create-title');
            if (title) title.textContent = next === 'reply' ? '新增回复模板' : '新增提示词模板';
            const label = document.getElementById('agent-template-content-label');
            if (label) label.textContent = next === 'reply' ? '回复内容' : '提示词内容';
            const ta = document.getElementById('agent-template-new-content');
            if (ta) ta.placeholder = next === 'reply' ? '输入回复模板内容…' : '输入提示词模板内容…';
            loadAgentTemplates();
        }

        function getActiveTemplateList() {
            return __AGENT_TEMPLATE_KIND === 'reply' ? (__AGENT_REPLY_TEMPLATES || []) : (__AGENT_TEMPLATES || []);
        }

        function getActiveTemplateMap() {
            return __AGENT_TEMPLATE_KIND === 'reply' ? (__AGENT_REPLY_TEMPLATE_MAP || {}) : (__AGENT_TEMPLATE_MAP || {});
        }

        async function ensureAgentTemplateMaps() {
            const token = (typeof HRMS_API !== 'undefined' && HRMS_API && typeof HRMS_API.token === 'function')
                ? HRMS_API.token()
                : String(localStorage.getItem('HRMS_API_TOKEN') || localStorage.getItem('hrms_token') || '').trim();
            const [promptResp, replyResp] = await Promise.all([
                fetchWithAgentAbort('agent_templates_prompt', '/api/admin/agents/templates', { headers: { 'Authorization': 'Bearer ' + token } }),
                fetchWithAgentAbort('agent_templates_reply', '/api/admin/agents/reply-templates', { headers: { 'Authorization': 'Bearer ' + token } })
            ]);
            if (promptResp.ok) {
                const data = await promptResp.json();
                __AGENT_TEMPLATES = Array.isArray(data?.templates) ? data.templates : [];
                __AGENT_TEMPLATE_MAP = {};
                __AGENT_TEMPLATES.forEach((t) => {
                    const k = String(t.agent_id || '').trim();
                    if (!k) return;
                    if (!__AGENT_TEMPLATE_MAP[k]) __AGENT_TEMPLATE_MAP[k] = [];
                    __AGENT_TEMPLATE_MAP[k].push(t);
                });
            }
            if (replyResp.ok) {
                const data2 = await replyResp.json();
                __AGENT_REPLY_TEMPLATES = Array.isArray(data2?.templates) ? data2.templates : [];
                __AGENT_REPLY_TEMPLATE_MAP = {};
                __AGENT_REPLY_TEMPLATES.forEach((t) => {
                    const k = String(t.agent_id || '').trim();
                    if (!k) return;
                    if (!__AGENT_REPLY_TEMPLATE_MAP[k]) __AGENT_REPLY_TEMPLATE_MAP[k] = [];
                    __AGENT_REPLY_TEMPLATE_MAP[k].push(t);
                });
            }
        }

        function normalizeKnowledgeTextDisplay(input) {
            const raw = String(input || '');
            if (!raw) return '';
            try {
                const recovered = decodeURIComponent(escape(raw));
                const hasCjk = /[\u4e00-\u9fff]/.test(recovered);
                const rawLooksMojibake = /[ÃÂæçéèêëåäöø]/.test(raw);
                if (recovered && !recovered.includes('\uFFFD') && (hasCjk || rawLooksMojibake)) return recovered;
            } catch (e) {}
            return raw;
        }

        let __KB_ACTIVE_GROUP_ID = '';
        let __KB_ORGANIZER_GROUPS = [];
        let __KB_ORGANIZER_ACTIVE_GROUP_ID = '';
        let __KB_ORGANIZER_HIGHLIGHT_ITEM_ID = '';

        function getVisibleKnowledgeItems(items) {
            const list = Array.isArray(items) ? items : [];
            return isAdminUser()
                ? list.slice()
                : list.filter((it) => knowledgeItemMatchesUser(it, currentUser));
        }

        function getKnowledgeGroupLabel(groupId) {
            const gid = String(groupId || '').trim();
            if (!gid) return '';
            const hit = (__KB_CACHED_GROUPS || []).find((g) => String(g?.group_id || '') === gid);
            if (hit) return String(hit?.title || '').trim();
            const itemHit = (HRMS_STORE.getKnowledge() || []).find((item) => String(item?.groupId || '') === gid);
            return String(itemHit?.groupName || '').trim();
        }

        function updateKnowledgeHeroStats(items, focusLabel, contextText) {
            const visibleItems = getVisibleKnowledgeItems(items);
            const groupsCountEl = document.getElementById('kb-stat-groups');
            const filesCountEl = document.getElementById('kb-stat-files');
            const focusEl = document.getElementById('kb-stat-focus');
            const contextEl = document.getElementById('kb-current-context');
            if (groupsCountEl) groupsCountEl.textContent = String((__KB_CACHED_GROUPS || []).length || 0);
            if (filesCountEl) filesCountEl.textContent = String(visibleItems.length || 0);
            if (focusEl) focusEl.textContent = String(focusLabel || '全部');
            if (contextEl) contextEl.textContent = String(contextText || '向下查看资料列表，点击卡片进入详情。');
        }

        function syncKnowledgeAdminUi() {
            const organizerBtn = document.getElementById('kb-organizer-entry');
            if (organizerBtn) organizerBtn.style.display = isAdminUser() ? 'inline-flex' : 'none';
        }

        async function loadKnowledgeGroups() {
            try {
                const groups = await HRMS_API.getKnowledgeGroups();
                __KB_CACHED_GROUPS = (groups?.items || []);
            } catch (e) {
                __KB_CACHED_GROUPS = [];
            }
        }
        let __KB_CACHED_GROUPS = [];

        function renderKnowledgeGroupList() {
            const cardsEl = document.getElementById('knowledge-cards');
            const empty = document.getElementById('knowledge-list-empty');
            if (!cardsEl) return;
            const groups = __KB_CACHED_GROUPS;
            if (!groups.length) {
                cardsEl.innerHTML = '<div class="kb-list-empty-msg">暂无SOP分组，请上传资料</div>';
                if (empty) empty.style.display = 'none';
                updateKnowledgeHeroStats([], '分组', '还没有 SOP 分组，管理员上传资料后会在这里形成更清晰的手机入口。');
                return;
            }
            cardsEl.innerHTML = groups.map(g => {
                const gid = String(g.group_id || '');
                const title = String(g.title || '未命名SOP');
                const fileCount = g.file_count || 0;
                const updated = g.updated_at ? String(g.updated_at).slice(0, 10) : '';
                return `<div class="kb-v2-item" data-click="openKnowledgeGroup" data-arg="${escapeHtml(gid)}">
                    <div class="kb-v2-item-icon" style="font-size:22px;">📁</div>
                    <div class="kb-v2-item-body">
                        <div class="kb-v2-item-title">${escapeHtml(title)}</div>
                        <div class="kb-v2-item-meta">
                            <span class="kb-v2-chip" style="background:rgba(255,255,255,0.07);color:rgba(148,163,184,0.8);">${fileCount} 个文件</span>
                            ${updated ? `<span class="kb-v2-item-date">${updated}</span>` : ''}
                        </div>
                    </div>
                    <div class="kb-v2-item-arrow">›</div>
                </div>`;
            }).join('');
            if (empty) empty.style.display = 'none';
            updateKnowledgeHeroStats(HRMS_STORE.getKnowledge(), '分组', '先选一个 SOP 分组，再进入该分组下的资料列表。');
        }

        async function openKnowledgeGroup(groupId) {
            if (!groupId) return;
            __KB_ACTIVE_GROUP_ID = groupId;
            const cardsEl = document.getElementById('knowledge-cards');
            const empty = document.getElementById('knowledge-list-empty');
            if (cardsEl) cardsEl.innerHTML = '<div class="kb-list-empty-msg" style="padding:40px 0;text-align:center;color:rgba(255,255,255,0.3);">加载中...</div>';
            try {
                const data = await HRMS_API.getKnowledgeGroupFiles(groupId);
                const items = (data?.items || []);
                const itemsMapped = items.map(r => {
                    const fileType = String(r?.file_type || '').toLowerCase();
                    const type = (fileType === 'video') ? 'video' : (fileType === 'pdf' ? 'pdf' : (fileType === 'img' ? 'img' : 'doc'));
                    const createdAt = r?.created_at ? String(r.created_at) : '';
                    const filePath = String(r?.file_path || '');
                    let aud = { type: 'all' };
                    try {
                        const raw = r?.audience;
                        if (raw && typeof raw === 'object' && !Array.isArray(raw)) aud = raw;
                        else if (typeof raw === 'string' && raw.trim()) aud = JSON.parse(raw);
                    } catch (e) {}
                    const brandRef = parseBrandFromKnowledgeTags(r?.tags);
                    return {
                        id: String(r?.id || ''),
                        title: normalizeKnowledgeTextDisplay(String(r?.title || '')),
                        category: String(r?.category || ''),
                        type,
                        tags: Array.isArray(r?.tags) ? r.tags : [],
                        brandId: String(brandRef.brandId || 'all'),
                        brandName: String(brandRef.brandName || '全部品牌'),
                        audience: aud,
                        fileId: '',
                        fileName: normalizeKnowledgeTextDisplay(String(r?.title || filePath || '')),
                        mimeType: String(r?.file_type || ''),
                        size: Number(r?.file_size || 0),
                        createdAt,
                        createdBy: String(r?.created_by || ''),
                        groupId: String(r?.group_id || ''),
                        groupName: normalizeKnowledgeTextDisplay(String(r?.group_name || '')),
                        step_rubric: r?.step_rubric || null,
                        source: 'cloud',
                        cloud: { filePath }
                    };
                }).filter(it => it.id);
                const typeIcon2 = t => t === 'video' ? '🎬' : t === 'pdf' ? '📄' : t === 'img' ? '🖼️' : '📝';
                const typeBadge = t => t === 'video' ? '视频' : t === 'pdf' ? 'PDF' : t === 'img' ? '图片' : '文档';
                if (!itemsMapped.length) {
                    if (cardsEl) cardsEl.innerHTML = '<div class="kb-list-empty-msg">该分组暂无文件</div>';
                    if (empty) empty.style.display = 'none';
                    updateKnowledgeHeroStats([], '空分组', `当前分组「${getKnowledgeGroupLabel(groupId) || '未命名分组'}」还没有文件。`);
                    return;
                }
                const backHtml = `<div style="margin-bottom:16px;"><button data-click="kbBackToGroups" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;">‹ 返回所有分组</button></div>`;
                if (cardsEl) cardsEl.innerHTML = backHtml + itemsMapped.map(it => {
                    const icon = typeIcon2(it.type);
                    const badge = typeBadge(it.type);
                    const date = it.createdAt ? it.createdAt.slice(0,10) : '';
                    return `<div class="kb-v2-item" data-click="openKnowledgeItem" data-arg="${escapeHtml(it.id)}">
                        <div class="kb-v2-item-icon" data-type="${escapeHtml(it.type)}">${icon}</div>
                        <div class="kb-v2-item-body">
                            <div class="kb-v2-item-title">${escapeHtml(it.title)}</div>
                            <div class="kb-v2-item-meta">
                                <span class="kb-v2-chip kb-v2-chip-type">${badge}</span>
                                ${date ? `<span class="kb-v2-item-date">${date}</span>` : ''}
                            </div>
                        </div>
                        <div class="kb-v2-item-arrow">›</div>
                    </div>`;
                }).join('');
                if (empty) empty.style.display = 'none';
                updateKnowledgeHeroStats(itemsMapped, getKnowledgeGroupLabel(groupId) || '分组', `当前分组「${getKnowledgeGroupLabel(groupId) || '未命名分组'}」共 ${itemsMapped.length} 个文件，点击卡片进入详情。`);
            } catch (e) {
                console.error(e);
                if (cardsEl) cardsEl.innerHTML = '<div class="kb-list-empty-msg">加载失败: ' + escapeHtml(String(e.message || e)) + '</div>';
            }
        }

        function kbBackToGroups() {
            __KB_ACTIVE_GROUP_ID = '';
            const cardsEl = document.getElementById('knowledge-cards');
            if (cardsEl) cardsEl.innerHTML = '<div class="kb-list-empty-msg" style="padding:40px 0;text-align:center;color:rgba(255,255,255,0.3);">加载中...</div>';
            const empty = document.getElementById('knowledge-list-empty');
            if (empty) empty.style.display = 'none';
            loadKnowledgeGroups().then(() => {
                renderKnowledgeGroupList();
            });
        }

        async function openKnowledgeOrganizerSheet(preferredGroupId = '', highlightItemId = '') {
            if (!isAdminUser()) {
                showNotification('仅管理员可整理知识库文件', 'warning');
                return;
            }
            const modal = document.getElementById('knowledge-organizer-modal');
            if (!modal) return;
            modal.classList.add('is-open');
            __KB_ORGANIZER_HIGHLIGHT_ITEM_ID = String(highlightItemId || '').trim();
            await refreshKnowledgeOrganizer(preferredGroupId || __KB_ACTIVE_GROUP_ID || __KB_ORGANIZER_ACTIVE_GROUP_ID || '');
        }

        function closeKnowledgeOrganizerSheet() {
            const modal = document.getElementById('knowledge-organizer-modal');
            if (modal) modal.classList.remove('is-open');
            __KB_ORGANIZER_HIGHLIGHT_ITEM_ID = '';
        }

        async function refreshKnowledgeOrganizer(preferredGroupId = '') {
            const statusEl = document.getElementById('kb-organizer-status');
            const selectEl = document.getElementById('kb-organizer-group');
            const listEl = document.getElementById('kb-organizer-list');
            if (statusEl) statusEl.textContent = '正在同步分组与文件...';
            if (listEl) listEl.innerHTML = '<div class="kb-org-empty">正在加载当前分组文件...</div>';
            try {
                const groupsResp = await HRMS_API.getKnowledgeGroups();
                __KB_ORGANIZER_GROUPS = Array.isArray(groupsResp?.items) ? groupsResp.items : [];
                if (!__KB_ORGANIZER_GROUPS.length) {
                    if (selectEl) selectEl.innerHTML = '<option value="">暂无分组</option>';
                    if (listEl) listEl.innerHTML = '<div class="kb-org-empty">还没有可整理的 SOP 分组。</div>';
                    if (statusEl) statusEl.textContent = '暂无分组，请先上传资料创建 SOP 分组。';
                    return;
                }
                if (selectEl) {
                    selectEl.innerHTML = __KB_ORGANIZER_GROUPS.map((g) => {
                        const gid = String(g?.group_id || '').trim();
                        const title = String(g?.title || '未命名SOP');
                        return `<option value="${escapeHtml(gid)}">${escapeHtml(title)} (${Number(g?.file_count || 0)}个文件)</option>`;
                    }).join('');
                }
                const nextGroupId = String(preferredGroupId || __KB_ORGANIZER_ACTIVE_GROUP_ID || __KB_ORGANIZER_GROUPS?.[0]?.group_id || '').trim();
                __KB_ORGANIZER_ACTIVE_GROUP_ID = nextGroupId;
                if (selectEl) selectEl.value = nextGroupId;
                await renderKnowledgeOrganizerGroup(nextGroupId);
            } catch (e) {
                console.error(e);
                if (statusEl) statusEl.textContent = '整理台加载失败，请稍后重试。';
                if (listEl) listEl.innerHTML = '<div class="kb-org-empty">分组加载失败，请稍后重试。</div>';
            }
        }

        async function handleKnowledgeOrganizerGroupChange(groupId) {
            __KB_ORGANIZER_ACTIVE_GROUP_ID = String(groupId || '').trim();
            await renderKnowledgeOrganizerGroup(__KB_ORGANIZER_ACTIVE_GROUP_ID);
        }

        async function renderKnowledgeOrganizerGroup(groupId) {
            const statusEl = document.getElementById('kb-organizer-status');
            const listEl = document.getElementById('kb-organizer-list');
            if (!listEl) return;
            const gid = String(groupId || '').trim();
            if (!gid) {
                if (statusEl) statusEl.textContent = '请选择一个分组。';
                listEl.innerHTML = '<div class="kb-org-empty">请选择一个分组后再整理文件。</div>';
                return;
            }
            if (statusEl) statusEl.textContent = '正在载入当前分组文件...';
            listEl.innerHTML = '<div class="kb-org-empty">正在载入当前分组文件...</div>';
            try {
                const data = await HRMS_API.getKnowledgeGroupFiles(gid);
                const items = Array.isArray(data?.items) ? data.items : [];
                const groupTitle = getKnowledgeGroupLabel(gid) || '未命名分组';
                if (statusEl) statusEl.textContent = `当前项目组「${groupTitle}」共 ${items.length} 个文件。这里可以转移文件、改组名，也可以删除整个项目组。`;
                if (!items.length) {
                    listEl.innerHTML = '<div class="kb-org-empty">这个项目组还没有文件。你可以直接删组，或先上传新文件。</div>';
                    return;
                }
                listEl.innerHTML = items.map((item) => {
                    const id = String(item?.id || '');
                    const title = normalizeKnowledgeTextDisplay(String(item?.title || '未命名资料'));
                    const category = String(item?.category || '未分类');
                    const createdAt = item?.created_at ? String(item.created_at).slice(0, 10) : '';
                    const type = String(item?.file_type || '').toUpperCase() || 'FILE';
                    const isHighlight = __KB_ORGANIZER_HIGHLIGHT_ITEM_ID && __KB_ORGANIZER_HIGHLIGHT_ITEM_ID === id;
                    const targetOptions = __KB_ORGANIZER_GROUPS
                        .filter((g) => String(g?.group_id || '') !== gid)
                        .map((g) => `<option value="${escapeHtml(String(g?.group_id || ''))}">${escapeHtml(String(g?.title || '未命名SOP'))}</option>`)
                        .join('');
                    return `<div class="kb-org-card${isHighlight ? ' is-highlight' : ''}">
                        <div class="kb-org-card-head">
                            <div>
                                <div class="kb-org-card-title">${escapeHtml(title)}</div>
                                <div class="kb-org-card-meta">${escapeHtml(category)} · ${escapeHtml(type)}${createdAt ? ` · ${escapeHtml(createdAt)}` : ''}</div>
                            </div>
                            <span class="kb-org-badge">${escapeHtml(type)}</span>
                        </div>
                        <div class="kb-org-actions">
                            <select class="kb-org-target-select" id="kb-org-target-${escapeHtml(id)}">
                                <option value="">${targetOptions ? '选择目标项目组...' : '暂无其他项目组'}</option>
                                ${targetOptions}
                            </select>
                            <button class="kb-org-move-btn" type="button" onclick="moveKnowledgeFromOrganizer('${escapeHtml(id)}', '${escapeHtml(gid)}')">转移</button>
                        </div>
                    </div>`;
                }).join('');
            } catch (e) {
                console.error(e);
                if (statusEl) statusEl.textContent = '文件加载失败，请重试。';
                listEl.innerHTML = '<div class="kb-org-empty">当前分组文件加载失败，请稍后重试。</div>';
            }
        }

        async function moveKnowledgeFromOrganizer(itemId, sourceGroupId) {
            const targetEl = document.getElementById('kb-org-target-' + String(itemId || ''));
            const targetGroupId = String(targetEl?.value || '').trim();
            if (!targetGroupId) {
                showNotification('请选择目标分组', 'warning');
                return;
            }
            try {
                await HRMS_API.moveKnowledgeToGroup(itemId, targetGroupId);
                showNotification('资料已转移到目标分组', 'success');
                __KB_ORGANIZER_HIGHLIGHT_ITEM_ID = String(itemId || '').trim();
                await Promise.all([
                    renderKnowledgeOrganizerGroup(String(sourceGroupId || '').trim()),
                    loadKnowledgeGroups()
                ]);
                loadKnowledgeData();
            } catch (e) {
                showNotification('转移失败：' + String(e?.message || e), 'error');
            }
        }

        async function renameKnowledgeGroupFromOrganizer() {
            const groupId = String(document.getElementById('kb-organizer-group')?.value || '').trim();
            if (!groupId) {
                showNotification('请先选择一个项目组', 'warning');
                return;
            }
            const currentName = getKnowledgeGroupLabel(groupId) || '未命名项目组';
            const nextName = String(prompt('请输入新的项目组名称', currentName) || '').trim();
            if (!nextName || nextName === currentName) return;
            try {
                await HRMS_API.updateKnowledgeGroup(groupId, { groupName: nextName });
                const items = HRMS_STORE.getKnowledge();
                (items || []).forEach((item) => {
                    if (String(item?.groupId || '') === groupId) item.groupName = nextName;
                });
                HRMS_STORE.setKnowledge(items);
                await loadKnowledgeGroups();
                await refreshKnowledgeOrganizer(groupId);
                renderKnowledgeList();
                showNotification('项目组名称已更新', 'success');
            } catch (e) {
                showNotification('修改项目组名称失败：' + String(e?.message || e), 'error');
            }
        }

        async function deleteKnowledgeGroupFromOrganizer() {
            const groupId = String(document.getElementById('kb-organizer-group')?.value || '').trim();
            const groupName = getKnowledgeGroupLabel(groupId) || '未命名项目组';
            if (!groupId) {
                showNotification('请先选择一个项目组', 'warning');
                return;
            }
            if (!confirm(`确定删除整个项目组「${groupName}」吗？\n\n该组下所有文件都会一起删除。`)) return;
            try {
                await HRMS_API.deleteKnowledgeGroup(groupId);
                const remaining = (HRMS_STORE.getKnowledge() || []).filter((item) => String(item?.groupId || '') !== groupId);
                HRMS_STORE.setKnowledge(remaining);
                if (String(__KB_ACTIVE_GROUP_ID || '') === groupId) __KB_ACTIVE_GROUP_ID = '';
                if (String(window.__HRMS_KB_ACTIVE_ID || '').trim()) {
                    const active = remaining.find((item) => String(item?.id || '') === String(window.__HRMS_KB_ACTIVE_ID || ''));
                    if (!active) clearKnowledgeViewer();
                }
                await loadKnowledgeGroups();
                await refreshKnowledgeOrganizer('');
                renderKnowledgeList();
                showNotification('整个项目组已删除', 'success');
            } catch (e) {
                showNotification('删除项目组失败：' + String(e?.message || e), 'error');
            }
        }

        document.addEventListener('click', (event) => {
            const modal = document.getElementById('knowledge-organizer-modal');
            if (!modal || !modal.classList.contains('is-open')) return;
            if (event.target === modal) closeKnowledgeOrganizerSheet();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const modal = document.getElementById('knowledge-organizer-modal');
            if (modal && modal.classList.contains('is-open')) closeKnowledgeOrganizerSheet();
        });

        function renderKnowledgeList() {
            const list = document.getElementById('knowledge-list');
            const empty = document.getElementById('knowledge-list-empty');
            if (!list) return;

            const cardsEl = document.getElementById('knowledge-cards');

            const st = getKnowledgeFilterState();
            const tab = String(st.tab || 'all');
            const activeCat = String(st.category || '');

            const allItems = HRMS_STORE.getKnowledge();
            let items = isAdminUser() ? (allItems || []) : (allItems || []).filter(it => knowledgeItemMatchesUser(it, currentUser));
            if (activeCat) items = items.filter(it => String(it?.category || '') === activeCat);
            if (tab === 'video') items = items.filter(it => String(it?.type || '') === 'video');
            if (tab === 'doc') items = items.filter(it => String(it?.type || '') !== 'video');

            const q1 = String(document.getElementById('knowledge-search')?.value || '').trim().toLowerCase();
            const q2 = String(document.getElementById('knowledge-recent-search')?.value || '').trim().toLowerCase();
            const q = q1 || q2;
            const audienceVal = String(document.getElementById('knowledge-filter-audience')?.value || st.audMode || 'mine').trim();
            const storeVal = String(document.getElementById('knowledge-filter-store')?.value || st.store || '').trim();
            const positionVal = String(document.getElementById('knowledge-filter-position')?.value || st.position || '').trim();
            const brandValRaw = String(document.getElementById('knowledge-filter-brand')?.value || '').trim();
            const brandVal = normalizeBrandIdInput(brandValRaw);
            const targetBrandScope = brandVal || 'all';

            // persist current filter state
            setKnowledgeFilterState({
                ...st,
                q,
                audMode: audienceVal,
                store: storeVal,
                position: positionVal,
                brandId: brandVal
            });

            // Brand scope is fetched server-side; if user switched brand scope,
            // refetch first to avoid showing stale subset from previous scope.
            if (String(__KB_ACTIVE_BRAND_ID || 'all') !== targetBrandScope) {
                __KB_ACTIVE_BRAND_ID = targetBrandScope;
                loadKnowledgeData();
                return;
            }

            if (isAdminUser() && audienceVal !== 'all') {
                items = items.filter(it => knowledgeItemMatchesUser(it, currentUser));
            }
            if (storeVal) {
                items = items.filter((it) => {
                    const aud = it?.audience || {};
                    const list = [];
                    if (Array.isArray(aud.stores)) list.push(...aud.stores.map(x => String(x || '').trim()).filter(Boolean));
                    const legacy = String(aud.store || '').trim();
                    if (legacy) list.push(legacy);
                    return [...new Set(list)].includes(storeVal);
                });
            }
            if (positionVal) {
                items = items.filter((it) => {
                    const aud = it?.audience || {};
                    const list = [];
                    if (Array.isArray(aud.positions)) list.push(...aud.positions.map(x => String(x || '').trim()).filter(Boolean));
                    const legacy = String(aud.position || '').trim();
                    if (legacy) list.push(legacy);
                    return [...new Set(list)].includes(positionVal);
                });
            }
            if (brandVal) {
                items = items.filter((it) => knowledgeItemMatchBrand(it, brandVal));
            }
            if (q) {
                items = items.filter(it => {
                    const hay = [it?.title, it?.category, it?.fileName, it?.fileId].map(x => String(x || '')).join(' ').toLowerCase();
                    return hay.includes(q);
                });
            }

            items = items.slice().sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));

            if (!items.length) {
                list.innerHTML = '';
                if (empty) empty.style.display = '';
                if (cardsEl) cardsEl.innerHTML = '<div class="kb-list-empty-msg">暂无内容，请上传资料</div>';
                updateKnowledgeHeroStats([], '空结果', q ? `没有找到和“${q}”相关的资料，换个关键词试试。` : '当前筛选范围下暂无资料。');
                return;
            }
            if (empty) empty.style.display = 'none';
            list.innerHTML = ''; // legacy list not used anymore

            // ─── 分类分组卡片视图 ───
            if (!cardsEl) return;

            const typeIcon = t => t === 'video' ? '🎬' : t === 'pdf' ? '📄' : t === 'img' ? '🖼️' : '📝';
            const typeBadge = t => t === 'video' ? '视频' : t === 'pdf' ? 'PDF' : t === 'img' ? '图片' : '文档';

            if (activeCat) {
                // When a category is selected, show filtered items (not groups)
                cardsEl.innerHTML = `<div class="kb-v2-cat-body">${items.map(it => kbRenderListItem(it, typeIcon, typeBadge)).join('')}</div>`;
                updateKnowledgeHeroStats(items, activeCat, `已筛到分类「${activeCat}」，共 ${items.length} 个文件。`);
            } else if (tab === 'all' && !__KB_ACTIVE_GROUP_ID && !q) {
                renderKnowledgeGroupList();
            } else {
                const CATS = getKbCategoryOptions();
                const grouped = {};
                const uncategorized = [];
                items.forEach(it => {
                    const c = String(it?.category || '').trim();
                    if (CATS.includes(c)) { if (!grouped[c]) grouped[c] = []; grouped[c].push(it); }
                    else uncategorized.push(it);
                });
                let html = '';
                CATS.forEach(cat => {
                    const grp = grouped[cat] || [];
                    if (!grp.length) return;
                    const catIcon = (KB_CATEGORY_ICON || {})[cat] || '📂';
                    html += `<div class="kb-v2-cat-group">
                        <div class="kb-v2-cat-hdr" onclick="this.parentElement.classList.toggle('kb-v2-collapsed')">
                            <span class="kb-v2-cat-hdr-icon">${catIcon}</span>
                            <span class="kb-v2-cat-hdr-name">${escapeHtml(cat)}</span>
                            <span class="kb-v2-cat-count">${grp.length}</span>
                            <span class="kb-v2-cat-chev">›</span>
                        </div>
                        <div class="kb-v2-cat-body">${grp.map(it => kbRenderListItem(it, typeIcon, typeBadge)).join('')}</div>
                    </div>`;
                });
                if (uncategorized.length) {
                    html += `<div class="kb-v2-cat-group">
                        <div class="kb-v2-cat-hdr" onclick="this.parentElement.classList.toggle('kb-v2-collapsed')">
                            <span class="kb-v2-cat-hdr-icon">📂</span>
                            <span class="kb-v2-cat-hdr-name">其他</span>
                            <span class="kb-v2-cat-count">${uncategorized.length}</span>
                            <span class="kb-v2-cat-chev">›</span>
                        </div>
                        <div class="kb-v2-cat-body">${uncategorized.map(it => kbRenderListItem(it, typeIcon, typeBadge)).join('')}</div>
                    </div>`;
                }
                cardsEl.innerHTML = html;
                const focusLabel = tab === 'video' ? '视频' : (tab === 'doc' ? '文档' : '全部');
                const filters = [];
                if (q) filters.push(`关键词“${q}”`);
                if (storeVal) filters.push(`门店 ${storeVal}`);
                if (positionVal) filters.push(`岗位 ${positionVal}`);
                if (brandVal) filters.push(`品牌 ${brandVal}`);
                const contextText = filters.length
                    ? `当前按 ${filters.join(' / ')} 浏览，共 ${items.length} 个文件。`
                    : `当前在「${focusLabel}」范围内，共 ${items.length} 个文件。`;
                updateKnowledgeHeroStats(items, focusLabel, contextText);
            }
        }

        function kbRenderListItem(it, typeIcon, typeBadge) {
            const id = String(it?.id || '');
            const t = String(it?.type || 'doc');
            const title = String(it?.title || '未命名');
            const date = it?.createdAt ? String(it.createdAt).slice(0,10) : '';
            const isRequired = it?.is_required || it?.isRequired;
            const quizEnabled = it?.quiz_enabled || it?.quizEnabled;
            const icon = typeIcon(t);
            const badge = typeBadge(t);
            const tags = [];
            if (isRequired) tags.push('<span class="kb-v2-chip kb-v2-chip-req">必读</span>');
            if (quizEnabled) tags.push('<span class="kb-v2-chip kb-v2-chip-quiz">测验</span>');
            return `<div class="kb-v2-item" data-click="openKnowledgeItem" data-arg="${escapeHtml(id)}">
                <div class="kb-v2-item-icon" data-type="${escapeHtml(t)}">${icon}</div>
                <div class="kb-v2-item-body">
                    <div class="kb-v2-item-title">${escapeHtml(title)}</div>
                    <div class="kb-v2-item-meta">
                        <span class="kb-v2-chip kb-v2-chip-type">${badge}</span>
                        ${tags.join('')}
                        ${date ? `<span class="kb-v2-item-date">${date}</span>` : ''}
                    </div>
                </div>
                <div class="kb-v2-item-arrow">›</div>
            </div>`;
        }

        // ═══════════════════════════════════════════════════════════
        // 培训认证模块
        // ═══════════════════════════════════════════════════════════

        let _trainingCurrentSession = null;
        let _trainingCurrentTopic = null;
        const _trainingManagerRoles = ['admin', 'hq_manager', 'store_manager', 'store_production_manager', 'hr_manager'];

        function isTrainingManager() {
            return _trainingManagerRoles.includes(currentUser?.role);
        }
        // 仅管理员和总部营运可新建/编辑/删除知识点
        function isAdminOrHQ() {
            return ['admin', 'hq_manager'].includes(currentUser?.role);
        }
        // 可以指派任务的角色：管理员、总部营运、店长、出品经理
        function canAssignTraining() {
            return ['admin', 'hq_manager', 'store_manager', 'store_production_manager'].includes(currentUser?.role);
        }

        function getTrainingDeadlineState(item) {
            const dueDate = item?.due_date ? String(item.due_date).slice(0, 10) : '';
            const daysOverdue = Number(item?.days_overdue || 0);
            const isOverdue = item?.is_overdue === true || daysOverdue > 0;
            const isDueToday = item?.is_due_today === true;
            let dueText = dueDate ? ('截止 ' + dueDate) : '无期限';
            if (isOverdue) dueText = `已逾期 ${Math.max(1, daysOverdue)} 天`;
            else if (isDueToday) dueText = `今日到期 ${dueDate}`;
            return { dueDate, daysOverdue, isOverdue, isDueToday, dueText };
        }

        function getTrainingDeadlineBadge(state) {
            if (state.isOverdue) {
                return `<span class="training-admin-badge" style="background:rgba(239,68,68,0.16);color:#fca5a5;">逾期 ${Math.max(1, state.daysOverdue)} 天</span>`;
            }
            if (state.isDueToday) {
                return `<span class="training-admin-badge" style="background:rgba(245,158,11,0.16);color:#fcd34d;">今日到期</span>`;
            }
            return '';
        }

        function loadTrainingPage() {
            const adminPanel = document.getElementById('training-admin-panel');
            const employeePanel = document.getElementById('training-employee-panel');
            const topicCreateBtn = document.getElementById('training-topic-create-btn');
            const assignCreateBtn = document.getElementById('training-assign-create-btn');
            if (topicCreateBtn) topicCreateBtn.style.display = isAdminOrHQ() ? '' : 'none';
            if (assignCreateBtn) assignCreateBtn.style.display = canAssignTraining() ? '' : 'none';
            if (isTrainingManager()) {
                if (adminPanel) adminPanel.style.display = '';
                if (employeePanel) employeePanel.style.display = '';
                switchTrainingAdminTab('topics');
                loadMyTrainingTopics();
            } else {
                if (adminPanel) adminPanel.style.display = 'none';
                if (employeePanel) employeePanel.style.display = '';
                backToTrainingHome();
                loadMyTrainingTopics();
            }
        }

        function switchTrainingAdminTab(tab) {
            ['topics', 'assignments', 'dashboard', 'pending', 'progress', 'promoreq'].forEach(t => {
                const btn = document.getElementById('training-tab-' + t);
                const panel = document.getElementById('training-' + t + '-panel');
                if (btn) {
                    const isActive = t === tab;
                    btn.style.background = isActive ? 'rgba(99,102,241,0.9)' : 'rgba(255,255,255,0.06)';
                    btn.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.7)';
                    btn.style.border = isActive ? 'none' : '1px solid rgba(255,255,255,0.15)';
                }
                if (panel) panel.style.display = t === tab ? '' : 'none';
            });
            if (tab === 'topics') loadTrainingTopics();
            if (tab === 'assignments') loadTrainingAssignments();
            if (tab === 'dashboard') loadTrainingDashboard();
            if (tab === 'pending') loadPendingCertifications();
            if (tab === 'progress') loadPromoProgress();
            if (tab === 'promoreq') loadPromoReqTopics();
        }

        // ── 晋升进度跟踪面板 ────────────────────────────────────────
        async function loadPromoProgress() {
            const body = document.getElementById('promo-progress-body');
            if (!body) return;
            body.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);font-size:13px;">加载中…</div>';
            try {
                const resp = await fetch('/api/promotion/tracks', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const tracks = (data.items || []).filter(t => String(t?.status || '') === 'qualification_approved' && !t?.formalApplied);
                if (!tracks.length) {
                    body.innerHTML = '<div style="text-align:center;padding:32px;color:rgba(255,255,255,0.4);font-size:13px;">目前没有在途晋升培训</div>';
                    return;
                }
                const tierLabel = t => t?.promoTier === 'skill_bump' ? '<span style="font-size:10px;background:rgba(251,191,36,0.2);color:#fbbf24;border-radius:4px;padding:1px 6px;">技能提升</span>' : '<span style="font-size:10px;background:rgba(99,102,241,0.2);color:#a5b4fc;border-radius:4px;padding:1px 6px;">级别晋升</span>';
                let html = '';
                for (const tr of tracks) {
                    const items = Array.isArray(tr.trainingProgress?.items) ? tr.trainingProgress.items : [];
                    const total = items.length;
                    const passed = items.filter(i => i.certified).length;
                    const pct = total ? Math.round(passed / total * 100) : 0;
                    const barColor = pct === 100 ? '#34d399' : pct >= 60 ? '#60a5fa' : '#f87171';
                    const dueDate = tr.trainingDueDate || '';
                    const today = new Date().toISOString().slice(0, 10);
                    const overdue = dueDate && dueDate < today && pct < 100;

                    html += `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,${overdue ? '0.25' : '0.08'});border-radius:12px;padding:14px 16px;margin-bottom:10px;">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
                            <div>
                                <span style="font-size:14px;font-weight:700;color:#fff;">${escapeHtml(tr.applicantName || tr.applicantUsername)}</span>
                                ${tierLabel(tr)}
                                ${overdue ? '<span style="font-size:10px;background:rgba(248,113,113,0.2);color:#f87171;border-radius:4px;padding:1px 6px;margin-left:4px;">已逾期</span>' : ''}
                            </div>
                            <div style="text-align:right;font-size:12px;color:rgba(255,255,255,0.45);">
                                ${escapeHtml(tr.targetPosition || '')}${tr.targetLevel ? ' / ' + escapeHtml(tr.targetLevel) : ''}
                                ${dueDate ? '<br>截止 ' + escapeHtml(dueDate) : ''}
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                            <div style="flex:1;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;">
                                <div style="width:${pct}%;height:100%;background:${barColor};border-radius:3px;transition:width .3s;"></div>
                            </div>
                            <span style="font-size:12px;color:${barColor};font-weight:700;min-width:38px;text-align:right;">${passed}/${total}</span>
                        </div>`;

                    if (items.length) {
                        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
                        items.forEach(it => {
                            const c = it.certified;
                            html += `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:${c ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.06)'};color:${c ? '#34d399' : 'rgba(255,255,255,0.5)'};border:1px solid ${c ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.1)'};">${c ? '✓ ' : ''}${escapeHtml(it.title || '')}</span>`;
                        });
                        html += '</div>';
                    } else {
                        html += '<div style="font-size:12px;color:rgba(255,255,255,0.35);">暂无技能项</div>';
                    }
                    html += '</div>';
                }
                body.innerHTML = `<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:10px;">共 ${tracks.length} 人在途晋升培训</div>` + html;
            } catch (e) {
                body.innerHTML = `<div style="text-align:center;padding:24px;color:#f87171;font-size:13px;">${escapeHtml(e.message)}</div>`;
            }
        }

        // ── 晋升认证要求矩阵 ──────────────────────────────────────────
        async function loadPromoReqTopics() {
            const position = document.getElementById('promoreq-position')?.value || '';
            const level = document.getElementById('promoreq-level')?.value || '';
            const body = document.getElementById('promoreq-body');
            if (!body) return;
            if (!position || !level) {
                body.innerHTML = '<div style="text-align:center;padding:32px;color:rgba(255,255,255,0.4);font-size:13px;">请先选择岗位和级别</div>';
                return;
            }
            body.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);font-size:13px;">加载中…</div>';
            try {
                const resp = await fetch('/api/training/topics?position=' + encodeURIComponent(position), {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                if (!data.success) throw new Error(data.error || '加载失败');

                // 只展示该岗位 + 该级别的知识点
                const topics = (data.topics || []).filter(t => {
                    const posArr = (t.position || '').split(',').map(s => s.trim());
                    return posArr.includes(position) && t.level === level;
                });

                if (!topics.length) {
                    body.innerHTML = `<div style="text-align:center;padding:32px;color:rgba(255,255,255,0.4);font-size:13px;">该岗位/级别下暂无知识点<br><span style="font-size:11px;opacity:.6">请先在「知识点」标签里创建知识点并设置对应岗位和级别</span></div>`;
                    return;
                }

                const reqCount = topics.filter(t => t.promotion_required).length;
                let html = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <div style="font-size:13px;color:rgba(255,255,255,0.6);">
                        共 <b style="color:#fff">${topics.length}</b> 个知识点，
                        当前 <b style="color:#a5b4fc">${reqCount}</b> 个设为晋升必须认证
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button data-click="promoReqSelectAll" data-arg="true" style="padding:6px 12px;border-radius:8px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;font-size:12px;cursor:pointer;">全选</button>
                        <button data-click="promoReqSelectAll" data-arg="false" style="padding:6px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);font-size:12px;cursor:pointer;">全不选</button>
                        <button data-click="savePromoReqTopics" style="padding:6px 16px;border-radius:8px;background:rgba(99,102,241,0.9);border:none;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">保存设置</button>
                    </div>
                </div>
                <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:12px;">✓ 勾选 = 员工晋升到「${position} ${level}」时必须通过此知识点认证；取消勾选 = 不强制要求</div>
                <div id="promoreq-checklist" style="display:flex;flex-direction:column;gap:6px;">`;

                topics.forEach(t => {
                    const checked = t.promotion_required ? 'checked' : '';
                    const stageM = /^(.+?)[：:]/.exec(t.title || '');
                    const stage = stageM ? `<span style="font-size:10px;color:rgba(255,255,255,0.35);margin-right:4px;">[${stageM[1]}]</span>` : '';
                    const title = stageM ? t.title.slice(stageM[0].length) : t.title;
                    html += `
                    <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);cursor:pointer;transition:background .15s;"
                           onmouseover="this.style.background='rgba(99,102,241,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.04)'">
                        <input type="checkbox" data-id="${t.id}" ${checked} style="width:16px;height:16px;accent-color:#6366f1;flex-shrink:0;margin-top:2px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;color:#fff;line-height:1.4;">${stage}${escapeHtml(title)}</div>
                            <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px;">有效期 ${t.validity_days || 180} 天${t.practice_task ? ' · 含实操' : ''}</div>
                        </div>
                        <span style="font-size:11px;padding:2px 8px;border-radius:20px;flex-shrink:0;${t.promotion_required ? 'background:rgba(99,102,241,0.2);color:#a5b4fc;' : 'background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.35);'}">${t.promotion_required ? '必须认证' : '不要求'}</span>
                    </label>`;
                });

                html += `</div>
                <div style="margin-top:14px;text-align:right;">
                    <button data-click="savePromoReqTopics" style="padding:8px 20px;border-radius:10px;background:rgba(99,102,241,0.9);border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">💾 保存晋升认证要求</button>
                </div>`;

                body.innerHTML = html;
            } catch (e) {
                body.innerHTML = `<div style="text-align:center;padding:24px;color:#f87171;font-size:13px;">${e.message}</div>`;
            }
        }

        function promoReqSelectAll(val) {
            document.querySelectorAll('#promoreq-checklist input[type=checkbox]').forEach(cb => {
                cb.checked = val;
                const badge = cb.closest('label')?.querySelector('span[style*="border-radius:20px"]');
                if (badge) {
                    badge.textContent = val ? '必须认证' : '不要求';
                    badge.style.background = val ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)';
                    badge.style.color = val ? '#a5b4fc' : 'rgba(255,255,255,0.35)';
                }
            });
        }

        async function savePromoReqTopics() {
            const position = document.getElementById('promoreq-position')?.value || '';
            const level = document.getElementById('promoreq-level')?.value || '';
            if (!position || !level) return showNotification('请先选择岗位和级别', 'error');
            const checkboxes = document.querySelectorAll('#promoreq-checklist input[type=checkbox]');
            const required_ids = [];
            checkboxes.forEach(cb => { if (cb.checked) required_ids.push(Number(cb.dataset.id)); });
            try {
                const resp = await fetch('/api/training/topics/set-promotion-requirements', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token'), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ position, level, required_ids })
                });
                const data = await resp.json();
                if (!data.success) throw new Error(data.error || '保存失败');
                showNotification(`已更新：${required_ids.length} 项设为必须认证，共 ${data.updated} 项知识点`, 'success');
                loadPromoReqTopics(); // 刷新显示最新状态
            } catch (e) {
                showNotification('保存失败：' + e.message, 'error');
            }
        }

        async function loadTrainingTopics() {
            try {
                const position = document.getElementById('training-filter-position')?.value || '';
                const resp = await fetch('/api/training/topics?position=' + encodeURIComponent(position), {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const list = document.getElementById('training-topics-list');
                if (!list) return;
                if (!data.success || !data.topics?.length) {
                    list.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">暂无知识点</div>';
                    return;
                }
                const canEdit = isAdminOrHQ();
                const TT_LEVEL_LABEL = { T1:'T1 合格', T2:'T2 师傅', T3:'T3 厨师长', M1:'M1 主管', M2:'M2 经理', M3:'M3 店长', L1:'L1', L2:'L2', L3:'L3' };
                const ttLevelRank = lv => { const m = /^([A-Z]+)(\d+)$/.exec(lv || ''); return m ? m[1].charCodeAt(0) * 100 + Number(m[2]) : 9999; };

                const renderTopicCard = (t, displayTitle) => {
                    const posArr = (t.position || '').split(',').map(s => s.trim()).filter(Boolean);
                    const posTags = posArr.map(p => `<span class="training-admin-chip">${escapeHtml(p)}</span>`).join('');
                    const storeBadge = t.store ? `<span class="training-admin-chip">🏪 ${escapeHtml(t.store)}</span>` : '<span class="training-admin-chip">🏪 全部门店</span>';
                    const promotionBadge = t.promotion_required ? `<span class="training-admin-chip">🎯 晋升要求${t.level ? ' · ' + escapeHtml(t.level) : ''} · 有效期${t.validity_days || 180}天</span>` : '';
                    const editBtns = canEdit ? `
                        <div class="training-admin-actions">
                            <button data-click="editTrainingTopic" data-arg="${t.id}" data-arg-type="number" class="training-admin-btn">✏️ 编辑</button>
                            <button data-click="deleteTrainingTopic" data-arg="${t.id}" data-arg-type="number" class="training-admin-btn training-admin-btn--danger">🗑 删除</button>
                        </div>` : '';
                    return `
                    <div class="training-admin-card">
                        <details>
                            <summary class="training-admin-summary" style="list-style:none;cursor:pointer;">
                                <div class="training-admin-row">
                                    <div style="flex:1;min-width:0;">
                                        <div class="training-admin-title">${escapeHtml(displayTitle)}</div>
                                        <div class="training-admin-sub">${t.kb_article_ids?.length ? `关联 ${t.kb_article_ids.length} 篇知识库文章` : '未配置知识库文章数量展示'}</div>
                                    </div>
                                    <span class="training-admin-badge" style="background:rgba(99,102,241,0.14);color:#c7d2fe;">${posArr.length || 0} 岗位</span>
                                </div>
                                <div class="training-admin-meta">
                                    ${storeBadge}
                                    ${posTags || '<span class="training-admin-chip">未设置岗位</span>'}
                                    ${promotionBadge}
                                </div>
                            </summary>
                            <button class="training-admin-toggle" type="button" onclick="this.parentElement.open = !this.parentElement.open;">查看详情</button>
                            <div class="training-admin-details">
                                <div class="training-admin-sub">${t.practice_task ? escapeHtml(t.practice_task) : '未填写实操目标'}</div>
                                ${editBtns}
                            </div>
                        </details>
                    </div>`;
                };

                // 按"岗位 + 晋升级别"归类，组内再按标题"："前缀细分阶段，让培训内容有清晰的进阶方向
                const graded = data.topics.filter(t => t.promotion_required && t.level);
                const ungraded = data.topics.filter(t => !(t.promotion_required && t.level));

                const groupMap = new Map();
                graded.forEach(t => {
                    const key = (t.position || '') + '|' + t.level;
                    if (!groupMap.has(key)) groupMap.set(key, { position: t.position, level: t.level, items: [] });
                    groupMap.get(key).items.push(t);
                });
                const groups = [...groupMap.values()].sort((a, b) => {
                    if (a.position !== b.position) return String(a.position).localeCompare(String(b.position), 'zh');
                    return ttLevelRank(a.level) - ttLevelRank(b.level);
                });

                let html = `<div class="training-admin-stack">`;
                groups.forEach(g => {
                    // 组内按标题"XXX："前缀再细分阶段（出现≥2次才算一个阶段，否则单独展示）
                    const stageOrder = [];
                    const stageMap = new Map();
                    g.items.forEach(t => {
                        const m = /^(.+?)[：:]/.exec(t.title || '');
                        const prefix = m ? m[1] : '';
                        if (!stageMap.has(prefix)) { stageMap.set(prefix, []); stageOrder.push(prefix); }
                        stageMap.get(prefix).push(t);
                    });
                    let bodyHtml = '';
                    stageOrder.forEach(prefix => {
                        const items = stageMap.get(prefix);
                        const useStage = prefix && items.length >= 2;
                        if (useStage) {
                            bodyHtml += `<div class="tt-stage-header">📍 ${escapeHtml(prefix)}（${items.length}项）</div>`;
                        }
                        items.forEach(t => {
                            const displayTitle = (useStage && t.title.startsWith(prefix))
                                ? t.title.slice(prefix.length).replace(/^[：:]\s*/, '')
                                : t.title;
                            bodyHtml += renderTopicCard(t, displayTitle);
                        });
                    });
                    const levelLabel = TT_LEVEL_LABEL[g.level] || g.level;
                    html += `
                    <details class="tt-level-group" open>
                        <summary>
                            <span>${escapeHtml(g.position)} · ${escapeHtml(levelLabel)}</span>
                            <span class="training-admin-badge" style="background:rgba(94,234,212,0.16);color:#5EEAD4;">${g.items.length} 项</span>
                        </summary>
                        <div class="tt-level-body">${bodyHtml}</div>
                    </details>`;
                });
                if (ungraded.length) {
                    html += `
                    <details class="tt-level-group" open>
                        <summary>
                            <span>📚 通用知识点（非晋升要求）</span>
                            <span class="training-admin-badge" style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);">${ungraded.length} 项</span>
                        </summary>
                        <div class="tt-level-body">${ungraded.map(t => renderTopicCard(t, t.title)).join('')}</div>
                    </details>`;
                }
                html += `</div>`;
                list.innerHTML = html;

                // 更新指派弹窗的下拉框
                const assignSelect = document.getElementById('training-assign-topic');
                if (assignSelect) {
                    assignSelect.innerHTML = '<option value="">请选择</option>' + data.topics.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
                }
            } catch (e) {
                showNotification('加载知识点失败：' + e.message, 'error');
            }
        }

        // ── 知识库多选 picker ──────────────────────────────────
        let _selectedKbArticles = []; // [{id, title, category, excerpt}]
        let _kbSearchResults = [];
        let _kbSearchTimer = null;

        async function searchKbArticles(q) {
            const dd = document.getElementById('training-kb-dropdown');
            clearTimeout(_kbSearchTimer);
            _kbSearchTimer = setTimeout(async () => {
                try {
                    const resp = await fetch('/api/training/kb-search?q=' + encodeURIComponent(q || ''), {
                        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                    });
                    const data = await resp.json();
                    _kbSearchResults = Array.isArray(data.articles) ? data.articles : [];
                    const selectedIds = new Set(_selectedKbArticles.map(a => a.id));
                    const candidates = _kbSearchResults.filter(a => !selectedIds.has(a.id));
                    if (!candidates.length) {
                        dd.innerHTML = selectedIds.size
                            ? '<div class="tt-kb-empty">搜索到了，但这些文章都已经加入当前知识点了。</div>'
                            : '<div class="tt-kb-empty">未找到文章，换个关键词试试。</div>';
                    } else {
                        dd.innerHTML = candidates.map(a => {
                            const excerpt = escapeHtml((a.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 90));
                            return `<div class="tt-kb-result">
                                <span class="tt-kb-result-mark">+</span>
                                <div class="tt-kb-result-main">
                                    <div class="tt-kb-result-top">
                                        <div class="tt-kb-result-title">${escapeHtml(a.title)}</div>
                                        <span class="tt-kb-result-badge">${escapeHtml(a.category||'未分类')}</span>
                                    </div>
                                    <div class="tt-kb-result-meta">${excerpt}${(a.excerpt||'').length > 90 ? '…' : ''}</div>
                                </div>
                                <div class="tt-kb-result-side">
                                    <button type="button" class="tt-kb-result-add-btn" onclick="event.stopPropagation(); addKbArticleFromSearch('${a.id}')">加入</button>
                                    <div class="tt-kb-result-hint">加入当前知识点</div>
                                </div>
                            </div>`;
                        }).join('');
                    }
                    dd.style.display = 'block';
                } catch(err) {}
            }, 250);
        }

        function addKbArticleFromSearch(id) {
            const article = _kbSearchResults.find(a => a.id === id);
            if (!article) return;
            // 单选：每个知识点只能对应一个文件
            _selectedKbArticles = [{
                id: article.id,
                title: article.title,
                category: article.category || '',
                excerpt: article.excerpt || ''
            }];
            renderKbChips();
            searchKbArticles(document.getElementById('training-kb-search').value);
        }

        function toggleKbArticle(id, title) {
            const idx = _selectedKbArticles.findIndex(a => a.id === id);
            if (idx >= 0) {
                _selectedKbArticles.splice(idx, 1);
            } else {
                // 单选：替换，不追加
                _selectedKbArticles = [{ id, title }];
            }
            renderKbChips();
            searchKbArticles(document.getElementById('training-kb-search').value);
        }

        function clearKbArticles() {
            if (!_selectedKbArticles.length) return;
            _selectedKbArticles = [];
            renderKbChips();
            searchKbArticles(document.getElementById('training-kb-search').value);
        }

        function removeKbArticle(id) {
            _selectedKbArticles = _selectedKbArticles.filter(a => a.id !== id);
            renderKbChips();
            searchKbArticles(document.getElementById('training-kb-search').value);
        }

        function renderKbChips() {
            const container = document.getElementById('training-kb-selected');
            if (!container) return;
            if (_selectedKbArticles.length === 0) {
                container.innerHTML = '<div class="tt-kb-empty">还没有选中文章。先在下方搜索，再点“加入”。</div>';
                return;
            }
            const head = `<div class="tt-kb-selected-head"><span class="tt-kb-selected-count">已选文件（每个知识点限 1 个）</span><span style="color:rgba(148,163,184,0.72);">保存后员工学习时会看到此文件</span></div>`;
            const cards = _selectedKbArticles.map((a, idx) =>
                `<div class="tt-kb-chip">
                    <div class="tt-kb-chip-main">
                        <div class="tt-kb-chip-title">0${idx + 1}. ${escapeHtml(a.title)}</div>
                        <div class="tt-kb-chip-sub">${escapeHtml((a.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 70)) || '已加入当前知识点，员工学习时会直接看到这篇资料。'}${(a.excerpt || '').length > 70 ? '…' : ''}</div>
                        <div class="tt-kb-chip-meta">
                            <span class="tt-kb-chip-badge">${escapeHtml(a.category || '未分类')}</span>
                            <span>可在右侧随时移除</span>
                        </div>
                    </div>
                    <span data-click="removeKbArticle" data-arg="${a.id}" class="tt-kb-chip-remove">×</span>
                </div>`
            ).join('');
            container.innerHTML = head + `<div class="tt-kb-selected-grid">${cards}</div>`;
        }

        // 点击外部关闭下拉
        document.addEventListener('click', e => {
            if (!e.target.closest('#training-topic-modal')) {
                const dd = document.getElementById('training-kb-dropdown');
                if (dd) dd.style.display = 'none';
            }
        });
        // ──────────────────────────────────────────────────────

        // ── 岗位列表（知识点 + 指派共用）──
        const _TRAINING_POSITIONS = ['炒锅','烧味','打荷','切配','出品','洗碗工','前厅服务员','收银','迎宾','前厅主管','出品经理','店长','全员通用'];

        function renderTrainingAssignEmptyState(message) {
            return `<div class="ta-employee-empty">${escapeHtml(message || '请先选择门店或岗位范围，再点击“加载员工”')}</div>`;
        }

        function formatTrainingExplanationText(text) {
            return String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:700;">$1</strong>');
        }

        function buildTrainingExplanationView(markdown, cacheBadgeHtml) {
            const safe = formatTrainingExplanationText(markdown || '');
            const lines = safe.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            const sections = [];
            let current = { title: '学习概览', intro: [], groups: [], loose: [] };
            let currentGroup = null;

            lines.forEach((line) => {
                const h2 = line.match(/^##\s+(.+)$/);
                const h3 = line.match(/^###\s+(.+)$/);
                const bullet = line.match(/^[-•]\s+(.+)$/);
                const ordered = line.match(/^\d+\.\s+(.+)$/);

                if (h2) {
                    if (current.title || current.intro.length || current.groups.length || current.loose.length) sections.push(current);
                    current = { title: h2[1], intro: [], groups: [], loose: [] };
                    currentGroup = null;
                } else if (h3) {
                    currentGroup = { title: h3[1], bullets: [], steps: [], text: [] };
                    current.groups.push(currentGroup);
                } else if (bullet) {
                    if (currentGroup) currentGroup.bullets.push(bullet[1]);
                    else current.loose.push({ kind: 'bullet', text: bullet[1] });
                } else if (ordered) {
                    if (currentGroup) currentGroup.steps.push(ordered[1]);
                    else current.loose.push({ kind: 'step', text: ordered[1] });
                } else {
                    if (currentGroup) currentGroup.text.push(line);
                    else current.intro.push(line);
                }
            });
            if (current.title || current.intro.length || current.groups.length || current.loose.length) sections.push(current);

            const validSections = sections.filter((section) => section.title || section.intro.length || section.groups.length || section.loose.length);
            const sectionSource = validSections.length
                ? validSections
                : [{ title: '学习概览', intro: [safe.replace(/\n/g, '<br>')], groups: [], loose: [] }];

            const outline = sectionSource.map((section, index) => `
                <a class="training-ai-outline-chip" href="#training-ai-sec-${index}">
                    <span>${index + 1}</span>
                    <span>${section.title || `模块 ${index + 1}`}</span>
                </a>
            `).join('');

            const renderLooseItems = (items) => {
                if (!items.length) return '';
                const bullets = items.filter((item) => item.kind === 'bullet');
                const steps = items.filter((item) => item.kind === 'step');
                const text = items.filter((item) => item.kind === 'text');
                return `
                    ${text.length ? `<div class="training-ai-plain">${text.map((item) => `<div class="training-ai-plain-row">${item.text}</div>`).join('')}</div>` : ''}
                    ${bullets.length ? `<div class="training-ai-points">${bullets.map((item) => `<div class="training-ai-point"><span class="training-ai-point-mark">要</span><div class="training-ai-point-text">${item.text}</div></div>`).join('')}</div>` : ''}
                    ${steps.length ? `<div class="training-ai-steps">${steps.map((item, idx) => `<div class="training-ai-step-row"><span class="training-ai-step-mark">${idx + 1}</span><div class="training-ai-step-text">${item.text}</div></div>`).join('')}</div>` : ''}
                `;
            };

            const contentCards = sectionSource.map((section, sectionIndex) => {
                const introHtml = section.intro.length
                    ? `<div class="training-ai-intro">${section.intro.map((paragraph) => `<p>${paragraph}</p>`).join('')}</div>`
                    : '';
                const groupsHtml = section.groups.map((group) => `
                    <div class="training-ai-group">
                        <div class="training-ai-group-title">${group.title}</div>
                        ${group.text.length ? `<div class="training-ai-plain">${group.text.map((row) => `<div class="training-ai-plain-row">${row}</div>`).join('')}</div>` : ''}
                        ${group.steps.length ? `<div class="training-ai-steps">${group.steps.map((step, idx) => `<div class="training-ai-step-row"><span class="training-ai-step-mark">${idx + 1}</span><div class="training-ai-step-text">${step}</div></div>`).join('')}</div>` : ''}
                        ${group.bullets.length ? `<div class="training-ai-points">${group.bullets.map((point) => `<div class="training-ai-point"><span class="training-ai-point-mark">要</span><div class="training-ai-point-text">${point}</div></div>`).join('')}</div>` : ''}
                    </div>
                `).join('');
                return `
                    <section class="training-ai-section" id="training-ai-sec-${sectionIndex}">
                        <div class="training-ai-section-head">
                            <span class="training-ai-section-index">${sectionIndex + 1}</span>
                            <div class="training-ai-section-title">${section.title || `模块 ${sectionIndex + 1}`}</div>
                        </div>
                        ${introHtml}
                        ${renderLooseItems(section.loose)}
                        ${groupsHtml}
                    </section>
                `;
            }).join('');

            return `
                <div class="training-ai-shell">
                    <div class="training-ai-hero">
                        <div class="training-ai-hero-head">
                            <span style="font-size:24px;">✨</span>
                            <div>
                                <div class="training-ai-hero-title">AI 培训解析 ${cacheBadgeHtml || ''}</div>
                                <div class="training-ai-hero-sub">以下内容按照原始解析的章节顺序展开。先看目录，再按章节往下读，会比直接扫长文更容易掌握重点。</div>
                            </div>
                        </div>
                        <div class="training-ai-outline">${outline}</div>
                    </div>
                    <div class="training-ai-grid">${contentCards}</div>
                    <div class="training-ai-note">
                        <div class="training-ai-note-title">学习建议</div>
                        <div class="training-ai-note-text">每看完一个章节就停下来回想 1 次重点，再继续看下一章；这样在进入测验前，理解和记忆都会更稳。</div>
                    </div>
                </div>
            `;
        }

        function updateTrainingTopicSummary() {
            const summary = document.getElementById('training-topic-summary');
            if (!summary) return;
            const storeText = document.getElementById('training-topic-store')?.selectedOptions?.[0]?.textContent?.trim() || '全部门店';
            const positions = getSelectedPositions('training-topic-positions');
            const posText = positions.length ? `${positions.length} 个岗位` : '未选择岗位';
            summary.innerHTML = `
                <span class="tt-chip">适用门店：${escapeHtml(storeText)}</span>
                <span class="tt-chip">适用岗位：${escapeHtml(posText)}</span>
            `;
        }

        function updateTrainingAssignFilterSummary() {
            const summary = document.getElementById('training-assign-filter-summary');
            if (!summary) return;
            const storeText = document.getElementById('training-assign-store')?.selectedOptions?.[0]?.textContent?.trim() || '全部门店';
            const positions = getSelectedPositions('training-assign-positions');
            const posText = positions.length ? `${positions.length} 个岗位` : '全部岗位';
            summary.innerHTML = `
                <span class="ta-chip">当前门店：${escapeHtml(storeText)}</span>
                <span class="ta-chip">岗位范围：${escapeHtml(posText)}</span>
            `;
        }

        function handleTrainingAssignStoreChange() {
            updateTrainingAssignFilterSummary();
            loadAssignableEmployees();
        }

        // 渲染岗位多选复选框
        function renderPositionCheckboxes(containerId, selectedPositions) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const selected = new Set(Array.isArray(selectedPositions) ? selectedPositions : []);
            container.innerHTML = _TRAINING_POSITIONS.map(p => {
                const checked = selected.has(p);
                if (containerId === 'training-assign-positions') {
                    return `<label onclick="togglePositionBox('${containerId}','${p}',this)"
                        class="ta-position-pill${checked ? ' is-active' : ''}"
                        data-pos="${p}" data-checked="${checked ? '1' : '0'}">
                        <span class="ta-position-icon">${checked ? '✓' : '+'}</span>
                        <span>${p}</span>
                    </label>`;
                }
                if (containerId === 'training-topic-positions') {
                    return `<label onclick="togglePositionBox('${containerId}','${p}',this)"
                        class="ta-position-pill${checked ? ' is-active' : ''}"
                        data-pos="${p}" data-checked="${checked ? '1' : '0'}">
                        <span class="ta-position-icon">${checked ? '✓' : '+'}</span>
                        <span>${p}</span>
                    </label>`;
                }
                return `<label onclick="togglePositionBox('${containerId}','${p}',this)"
                    style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;cursor:pointer;font-size:13px;
                    background:${checked ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)'};
                    border:1px solid ${checked ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.12)'};
                    color:${checked ? '#a5b4fc' : 'rgba(255,255,255,0.6)'};"
                    data-pos="${p}" data-checked="${checked ? '1' : '0'}">
                    <span style="font-size:11px;">${checked ? '☑' : '☐'}</span> ${p}
                </label>`;
            }).join('');
            if (containerId === 'training-assign-positions') updateTrainingAssignFilterSummary();
            if (containerId === 'training-topic-positions') updateTrainingTopicSummary();
        }

        function togglePositionBox(containerId, pos, el) {
            const isChecked = el.dataset.checked === '1';
            const newChecked = !isChecked;
            el.dataset.checked = newChecked ? '1' : '0';
            if (containerId === 'training-assign-positions' || containerId === 'training-topic-positions') {
                el.classList.toggle('is-active', newChecked);
                const icon = el.querySelector('.ta-position-icon');
                if (icon) icon.textContent = newChecked ? '✓' : '+';
                if (containerId === 'training-assign-positions') updateTrainingAssignFilterSummary();
                if (containerId === 'training-topic-positions') updateTrainingTopicSummary();
            } else {
                el.style.background = newChecked ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)';
                el.style.border = `1px solid ${newChecked ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.12)'}`;
                el.style.color = newChecked ? '#a5b4fc' : 'rgba(255,255,255,0.6)';
                el.querySelector('span').textContent = newChecked ? '☑' : '☐';
            }
            // 如果是指派弹窗的岗位选择，自动刷新员工列表
            if (containerId === 'training-assign-positions') {
                clearTimeout(window._assignPosTimer);
                window._assignPosTimer = setTimeout(loadAssignableEmployees, 400);
            }
        }

        function getSelectedPositions(containerId) {
            const container = document.getElementById(containerId);
            if (!container) return [];
            return Array.from(container.querySelectorAll('[data-checked="1"]')).map(el => el.dataset.pos);
        }

        async function openTrainingTopicModal(id = null) {
            document.getElementById('training-topic-id').value = id || '';
            const modalTitle = document.getElementById('training-topic-modal-title');
            if (modalTitle) modalTitle.textContent = id ? '编辑知识点' : '新建知识点';
            document.getElementById('training-topic-title').value = '';
            document.getElementById('training-topic-practice').value = '';
            document.getElementById('training-topic-promotion-required').checked = false;
            document.getElementById('training-topic-level').value = '';
            document.getElementById('training-topic-validity-days').value = '180';
            document.getElementById('training-kb-search').value = '';
            document.getElementById('training-kb-dropdown').style.display = 'none';
            _selectedKbArticles = [];
            renderKbChips();
            renderPositionCheckboxes('training-topic-positions', []);

            // 门店下拉：从后端获取可选门店（后端已按角色过滤）
            const storeSelect = document.getElementById('training-topic-store');
            storeSelect.innerHTML = '<option value="">全部门店</option>';
            storeSelect.disabled = false;
            try {
                const r = await fetch('/api/training/stores', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                const d = await r.json();
                (d.stores || []).forEach(s => {
                    storeSelect.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
                });
                // 如果只有一个门店（store_manager 自己门店），自动选中并锁定
                if (d.stores?.length === 1) {
                    storeSelect.value = d.stores[0];
                    storeSelect.disabled = true;
                }
            } catch(_) {}

            updateTrainingTopicSummary();

            // Reset rubric display for new topic
            const rubricBtn = document.getElementById('training-rubric-btn');
            if (rubricBtn) rubricBtn.style.display = 'none';
            document.getElementById('training-rubric-status').textContent = '未配置';
            document.getElementById('training-rubric-preview').style.display = 'none';

            document.getElementById('training-topic-modal').classList.add('show');
        }

        function closeTrainingTopicModal() {
            document.getElementById('training-topic-modal').classList.remove('show');
        }

        function showTopicRubric(rubric) {
            const statusEl = document.getElementById('training-rubric-status');
            const previewEl = document.getElementById('training-rubric-preview');
            if (!statusEl || !previewEl) return;
            if (rubric && Array.isArray(rubric.items) && rubric.items.length) {
                statusEl.textContent = `已配置 · ${rubric.items.length}项 · 合格线${rubric.pass_threshold||80}分`;
                statusEl.style.color = 'rgba(52,211,153,0.9)';
                previewEl.style.display = '';
                previewEl.innerHTML = rubric.items.map((s, i) =>
                    `<div style="margin:4px 0">${i+1}. <strong>${s.name}</strong> (${s.weight}分): ${(s.checks||[]).join('；')}</div>`
                ).join('') + (rubric.fail_criteria?.length ? `<div style="margin-top:6px;color:#fca5a5;">⚠️ 一票否决: ${rubric.fail_criteria.join('；')}</div>` : '');
            } else {
                statusEl.textContent = '未配置';
                statusEl.style.color = 'rgba(255,255,255,0.35)';
                previewEl.style.display = 'none';
                previewEl.innerHTML = '';
            }
        }

        async function generateTopicRubric() {
            const id = document.getElementById('training-topic-id').value;
            if (!id) return showNotification('请先保存知识点', 'warning');
            const token = localStorage.getItem('hrms_token');
            const btn = document.getElementById('training-rubric-btn');
            try {
                if (btn) { btn.disabled = true; btn.textContent = '⏳ 分析中...'; }
                const resp = await fetch('/api/training/topics/' + id + '/generate-rubric', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                });
                const data = await resp.json();
                if (data.success && data.rubric) {
                    showNotification(`步骤图谱已生成！共 ${data.rubric.items?.length || 0} 项`, 'success');
                    showTopicRubric(data.rubric);
                } else {
                    showNotification('生成失败: ' + (data.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('请求失败: ' + (e.message || e), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '📹 从培训视频生成'; }
            }
        }

        async function editTrainingTopic(id) {
            try {
                const resp = await fetch('/api/training/topics', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const topic = data.topics?.find(t => t.id === id);
                if (!topic) return showNotification('知识点不存在', 'error');
                await openTrainingTopicModal(id);
                document.getElementById('training-topic-title').value = topic.title || '';
                // 还原多选岗位
                const savedPositions = (topic.position || '').split(',').map(s => s.trim()).filter(Boolean);
                renderPositionCheckboxes('training-topic-positions', savedPositions);
                // 还原门店
                const storeSelect = document.getElementById('training-topic-store');
                if (!storeSelect.disabled && topic.store) {
                    storeSelect.value = topic.store;
                }
                updateTrainingTopicSummary();
                document.getElementById('training-topic-practice').value = topic.practice_task || '';
                document.getElementById('training-topic-promotion-required').checked = !!topic.promotion_required;
                document.getElementById('training-topic-level').value = topic.level || '';
                document.getElementById('training-topic-validity-days').value = topic.validity_days || 180;
                // 恢复已关联知识库文章
                const kbIds = topic.kb_article_ids || [];
                if (kbIds.length > 0) {
                    try {
                        const kbResp = await fetch('/api/training/kb-search?ids=' + encodeURIComponent(kbIds.join(',')), {
                            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                        });
                        const kbData = await kbResp.json();
                        const fetched = kbData.articles || [];
                        _selectedKbArticles = kbIds.map(kid => {
                            const found = fetched.find(a => a.id === kid);
                            return found ? { id: found.id, title: found.title } : { id: kid, title: '文章 ' + kid.slice(0,8) };
                        });
                    } catch(_) {}
                    renderKbChips();
                }
                // 恢复步骤图谱
                showTopicRubric(topic.step_rubric);
                const rubricBtn = document.getElementById('training-rubric-btn');
                if (rubricBtn) rubricBtn.style.display = kbIds.length > 0 ? '' : 'none';
            } catch (e) {
                showNotification('加载知识点失败', 'error');
            }
        }

        async function saveTrainingTopic() {
            const id = document.getElementById('training-topic-id').value;
            const title = document.getElementById('training-topic-title').value.trim();
            const positions = getSelectedPositions('training-topic-positions');
            const store = document.getElementById('training-topic-store')?.value || '';
            const practice = document.getElementById('training-topic-practice').value.trim();
            const kb_article_ids = _selectedKbArticles.map(a => a.id);
            const promotion_required = document.getElementById('training-topic-promotion-required').checked;
            const level = document.getElementById('training-topic-level').value.trim();
            const validity_days = Math.max(1, parseInt(document.getElementById('training-topic-validity-days').value, 10) || 180);

            if (!title) return showNotification('标题必填', 'warning');
            if (positions.length === 0) return showNotification('请至少选择一个适用岗位', 'warning');
            if (kb_article_ids.length === 0) return showNotification('请至少关联一篇知识库文章', 'warning');

            try {
                const url = id ? '/api/training/topics/' + id : '/api/training/topics';
                const method = id ? 'PUT' : 'POST';
                const resp = await fetch(url, {
                    method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + localStorage.getItem('hrms_token')
                    },
                    body: JSON.stringify({ title, positions, store, description: '', key_points: [], practice_task: practice, kb_article_ids, promotion_required, validity_days, level })
                });
                const data = await resp.json();
                if (data.success) {
                    showNotification('保存成功', 'success');
                    closeTrainingTopicModal();
                    // If KB articles linked, prompt to generate rubric
                    if (kb_article_ids.length > 0 && !id) {
                        const newId = data.topic?.id;
                        if (newId) {
                            setTimeout(() => {
                                showNotification('知识点已创建。可编辑知识点并点击"从培训视频生成"来设置实操评分图谱', 'info');
                            }, 500);
                        }
                    }
                    loadTrainingTopics();
                } else {
                    showNotification(data.error || '保存失败', 'error');
                }
            } catch (e) {
                showNotification('保存失败：' + e.message, 'error');
            }
        }

        async function deleteTrainingTopic(id) {
            if (!confirm('确定删除此知识点？')) return;
            try {
                const resp = await fetch('/api/training/topics/' + id, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                if (data.success) {
                    showNotification('删除成功', 'success');
                    loadTrainingTopics();
                } else {
                    showNotification(data.error || '删除失败', 'error');
                }
            } catch (e) {
                showNotification('删除失败', 'error');
            }
        }

        async function loadTrainingAssignments() {
            try {
                const name = document.getElementById('training-filter-name')?.value || '';
                const resp = await fetch('/api/training/assignments?name=' + encodeURIComponent(name), {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const list = document.getElementById('training-assignments-list');
                if (!list) return;
                if (!data.success || !data.assignments?.length) {
                    list.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">暂无指派记录</div>';
                    return;
                }
                const sMap = {not_started:'未开始',learning:'学习中',quiz:'待测验',practice:'待实操认证',certified:'已认证',failed:'未通过'};
                const sColor = {not_started:'#94a3b8',learning:'#60a5fa',quiz:'#a78bfa',practice:'#fb923c',certified:'#34d399',failed:'#f87171'};
                list.innerHTML = `<div class="training-admin-stack">` + data.assignments.map(a => {
                    const st = a.session_status || 'not_started';
                    const color = sColor[st] || '#94a3b8';
                    const deadline = getTrainingDeadlineState(a);
                    const displayName = escapeHtml(a.employee_name || a.employee_username);
                    const canRevoke = isAdminOrHQ() || a.assigned_by === currentUser?.username;
                    const revokeBtn = canRevoke ? `<button data-click="deleteTrainingAssignment" data-arg="${a.id}" data-arg-type="number" style="width:100%;padding:8px;border-radius:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#f87171;font-size:13px;cursor:pointer;">撤销指派</button>` : '';
                    const badge = `<span class="training-admin-badge" style="background:rgba(255,255,255,0.07);color:${color};">${sMap[st]||'未开始'}</span>`;
                    const deadlineBadge = getTrainingDeadlineBadge(deadline);
                    const cardStyle = deadline.isOverdue
                        ? 'background:linear-gradient(145deg, rgba(127,29,29,0.42), rgba(30,41,59,0.96));border:1px solid rgba(248,113,113,0.38);box-shadow:0 0 0 1px rgba(239,68,68,0.08) inset;'
                        : '';
                    return `
                    <div class="training-admin-card" style="${cardStyle}">
                        <details>
                            <summary class="training-admin-summary" style="list-style:none;cursor:pointer;">
                                <div class="training-admin-row">
                                    <div style="flex:1;min-width:0;">
                                        <div class="training-admin-title">${displayName}</div>
                                        <div class="training-admin-sub">📚 ${escapeHtml(a.title)}</div>
                                    </div>
                                    ${badge}
                                </div>
                                <div class="training-admin-meta">
                                    <span class="training-admin-chip">${escapeHtml(a.position || '未标注岗位')}</span>
                                    <span class="training-admin-chip" style="${deadline.isOverdue ? 'color:#fecaca;border-color:rgba(248,113,113,0.35);background:rgba(127,29,29,0.22);' : deadline.isDueToday ? 'color:#fde68a;border-color:rgba(245,158,11,0.3);background:rgba(120,53,15,0.22);' : ''}">${escapeHtml(deadline.dueText)}</span>
                                    ${a.quiz_score !== null ? `<span class="training-admin-chip">测验 ${a.quiz_score}分</span>` : ''}
                                    ${deadlineBadge}
                                </div>
                            </summary>
                            <button class="training-admin-toggle" type="button" onclick="this.parentElement.open = !this.parentElement.open;">查看详情</button>
                            <div class="training-admin-details">
                                <div class="training-admin-sub">指派人：${escapeHtml(a.assigned_by || '系统')} · 员工账号：${escapeHtml(a.employee_username || '')}</div>
                                ${deadline.isOverdue ? `<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(127,29,29,0.22);border:1px solid rgba(248,113,113,0.24);font-size:12px;line-height:1.6;color:#fecaca;">该培训任务已逾期，系统会继续在进度看板中高亮，并向指派人发送飞书催办提醒。</div>` : ''}
                                ${revokeBtn ? `<div style="margin-top:12px;">${revokeBtn}</div>` : ''}
                            </div>
                        </details>
                    </div>`;
                }).join('') + `</div>`;
            } catch (e) {
                showNotification('加载指派记录失败', 'error');
            }
        }

        let _trainingRequirePractice = false;
        function toggleRequirePractice() {
            _trainingRequirePractice = !_trainingRequirePractice;
            const toggle = document.getElementById('training-assign-practice-toggle');
            const knob = document.getElementById('training-assign-practice-knob');
            if (toggle) toggle.style.background = _trainingRequirePractice ? 'rgba(245,158,11,0.8)' : 'rgba(255,255,255,0.15)';
            if (knob) knob.style.left = _trainingRequirePractice ? '23px' : '3px';
        }

        async function openTrainingAssignmentModal() {
            document.getElementById('training-assign-topic').value = '';
            document.getElementById('training-assign-duedate').value = '';
            document.getElementById('training-assign-note').value = '';
            // 重置实操验证开关
            _trainingRequirePractice = false;
            const toggle = document.getElementById('training-assign-practice-toggle');
            const knob = document.getElementById('training-assign-practice-knob');
            if (toggle) toggle.style.background = 'rgba(255,255,255,0.15)';
            if (knob) knob.style.left = '3px';
            // 渲染岗位多选复选框
            renderPositionCheckboxes('training-assign-positions', []);
            // 清空员工列表
            const empList = document.getElementById('training-assign-emp-list');
            if (empList) empList.innerHTML = renderTrainingAssignEmptyState();
            const empSummary = document.getElementById('training-assign-emp-summary');
            if (empSummary) empSummary.textContent = '';

            // 门店选择：加载可选门店
            const storeSelect = document.getElementById('training-assign-store');
            storeSelect.innerHTML = '<option value="">全部门店</option>';
            try {
                const r = await fetch('/api/training/stores', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                const d = await r.json();
                (d.stores || []).forEach(s => {
                    storeSelect.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
                });
                // 如果只有一个门店（自己），自动选中并加载员工
                if (d.stores?.length === 1) {
                    storeSelect.value = d.stores[0];
                    storeSelect.disabled = true;
                } else {
                    storeSelect.disabled = false;
                }
            } catch(_) {}

            updateTrainingAssignFilterSummary();

            document.getElementById('training-assignment-modal').classList.add('show');
            if (storeSelect?.value) loadAssignableEmployees();
        }

        function closeTrainingAssignmentModal() {
            document.getElementById('training-assignment-modal').classList.remove('show');
        }

        // 加载可指派员工列表（根据门店+岗位过滤）
        async function loadAssignableEmployees() {
            const store = document.getElementById('training-assign-store')?.value || '';
            const positions = getSelectedPositions('training-assign-positions');
            const empList = document.getElementById('training-assign-emp-list');
            if (!empList) return;
            empList.innerHTML = renderTrainingAssignEmptyState('正在加载符合条件的员工…');
            try {
                const params = new URLSearchParams();
                if (store) params.set('store', store);
                // 对每个选中的岗位分别查询（position是ILIKE过滤）
                const results = [];
                if (positions.length > 0) {
                    for (const pos of positions) {
                        params.set('position', pos);
                        const r = await fetch('/api/training/search-employees?' + params.toString(), {
                            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                        });
                        const d = await r.json();
                        (d.employees || []).forEach(e => {
                            if (!results.find(x => x.username === e.username)) results.push(e);
                        });
                    }
                } else {
                    params.delete('position');
                    const r = await fetch('/api/training/search-employees?' + params.toString(), {
                        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                    });
                    const d = await r.json();
                    results.push(...(d.employees || []));
                }
                if (!results.length) {
                    empList.innerHTML = renderTrainingAssignEmptyState('未找到符合条件的员工，请调整门店或岗位范围');
                    return;
                }
                // 按门店分组渲染（带多选复选框）
                const byStore = {};
                results.forEach(e => {
                    const s = e.store || '未分配门店';
                    if (!byStore[s]) byStore[s] = [];
                    byStore[s].push(e);
                });
                empList.innerHTML = Object.entries(byStore).map(([storeName, emps]) => `
                    <div class="ta-store-group">
                        <div class="ta-store-name">门店 / 部门 · ${escapeHtml(storeName)}</div>
                        ${emps.map(e => `
                            <label class="ta-employee-item" data-click="updateEmpSelectionSummary">
                                <input type="checkbox" value="${escapeHtml(e.username)}" data-name="${escapeHtml(e.name||e.username)}"
                                    style="cursor:pointer;">
                                <span class="ta-employee-name">${escapeHtml(e.name||e.username)}</span>
                                <span class="ta-employee-position">${escapeHtml(e.position||'')}</span>
                            </label>
                        `).join('')}
                    </div>
                `).join('');
                updateEmpSelectionSummary();
            } catch(err) {
                empList.innerHTML = renderTrainingAssignEmptyState('加载失败，请稍后重试');
            }
        }

        function updateEmpSelectionSummary() {
            const empList = document.getElementById('training-assign-emp-list');
            const summary = document.getElementById('training-assign-emp-summary');
            if (!empList || !summary) return;
            const checked = empList.querySelectorAll('input[type=checkbox]:checked');
            summary.textContent = checked.length > 0 ? `已选 ${checked.length} 名员工` : '';
        }

        function selectAllAssignEmployees(selectAll) {
            const empList = document.getElementById('training-assign-emp-list');
            if (!empList) return;
            empList.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = selectAll);
            updateEmpSelectionSummary();
        }

        async function saveTrainingAssignment() {
            const topic_id = document.getElementById('training-assign-topic').value;
            const due_date = document.getElementById('training-assign-duedate').value;
            const note = document.getElementById('training-assign-note').value.trim();

            if (!topic_id) return showNotification('请选择知识点', 'warning');

            const empList = document.getElementById('training-assign-emp-list');
            const checked = empList ? empList.querySelectorAll('input[type=checkbox]:checked') : [];
            const employee_usernames = Array.from(checked).map(cb => cb.value);
            if (employee_usernames.length === 0) return showNotification('请至少选择一名员工', 'warning');

            try {
                const resp = await fetch('/api/training/assignments', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + localStorage.getItem('hrms_token')
                    },
                    body: JSON.stringify({ employee_usernames, topic_id, due_date, note, require_practice: _trainingRequirePractice })
                });
                const data = await resp.json();
                if (data.success) {
                    showNotification(`已向 ${data.count} 名员工指派培训，并发送通知`, 'success');
                    closeTrainingAssignmentModal();
                    loadTrainingAssignments();
                } else {
                    showNotification(data.error || '指派失败', 'error');
                }
            } catch (e) {
                showNotification('指派失败', 'error');
            }
        }

        async function deleteTrainingAssignment(id) {
            if (!confirm('确定撤销此指派？')) return;
            try {
                const resp = await fetch('/api/training/assignments/' + id, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                if (data.success) {
                    showNotification('撤销成功', 'success');
                    loadTrainingAssignments();
                } else {
                    showNotification(data.error || '撤销失败', 'error');
                }
            } catch (e) {
                showNotification('撤销失败', 'error');
            }
        }

        async function loadTrainingDashboard() {
            try {
                const resp = await fetch('/api/training/dashboard', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const content = document.getElementById('training-dashboard-content');
                if (!content) return;
                if (!data.success || !data.dashboard?.length) {
                    content.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">暂无数据</div>';
                    return;
                }
                const stMap = {not_started:'未开始',learning:'学习中',quiz:'待测验',practice:'待实操认证',certified:'已认证',failed:'未通过'};
                const stBg   = {not_started:'rgba(71,85,105,0.5)',learning:'rgba(96,165,250,0.2)',quiz:'rgba(139,92,246,0.25)',practice:'rgba(249,115,22,0.2)',certified:'rgba(52,211,153,0.2)',failed:'rgba(248,113,113,0.2)'};
                const stColor = {not_started:'#94a3b8',learning:'#60a5fa',quiz:'#a78bfa',practice:'#fb923c',certified:'#34d399',failed:'#f87171'};
                content.innerHTML = `<div class="training-admin-stack">` + data.dashboard.map((d, idx) => {
                    const rate = d.assigned_count > 0 ? Math.round(d.certified_count / d.assigned_count * 100) : 0;
                    const barColor = rate >= 80 ? '#34d399' : rate >= 50 ? '#fbbf24' : '#f87171';
                    const overdueCount = Number(d.overdue_count || 0);
                    const members = Array.isArray(d.members) ? d.members : [];
                    const assignerLine = d.assigner_name ? `<span style="font-size:11px;color:rgba(251,191,36,0.7);margin-left:6px;">派发人：${escapeHtml(d.assigner_name)}</span>` : '';
                    const membersHtml = members.length ? members.map((m, mi) => {
                        const st = m.status || 'not_started';
                        const deadline = getTrainingDeadlineState(m);
                        const needsRetake = st === 'quiz' && m.quiz_score !== null && m.quiz_score !== undefined;
                        const label = deadline.isOverdue ? `逾期 ${Math.max(1, deadline.daysOverdue)} 天` : (needsRetake ? '需补考' : (stMap[st] || st));
                        const bg = deadline.isOverdue ? 'rgba(239,68,68,0.18)' : (needsRetake ? 'rgba(239,68,68,0.18)' : (stBg[st] || 'rgba(71,85,105,0.5)'));
                        const color = deadline.isOverdue ? '#fca5a5' : (needsRetake ? '#fca5a5' : (stColor[st] || '#94a3b8'));
                        const scoreNote = (m.quiz_score !== null && m.quiz_score !== undefined) ? ` · ${m.quiz_score}分` : '';
                        // 考试历史
                        const history = Array.isArray(m.quiz_history) ? m.quiz_history : [];
                        const attemptCount = history.length;
                        const historyBadge = attemptCount > 0
                            ? `<span style="font-size:10px;color:rgba(255,255,255,0.4);margin-left:6px;">考${attemptCount}次</span>`
                            : '';
                        const historyHtml = attemptCount > 0 ? history.map((h, hi) => {
                            const sc = h.score ?? '?';
                            const ok = h.passed;
                            const dt = h.at ? h.at.slice(0,10) : '';
                            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:3px;">
                                <span style="font-size:11px;color:rgba(255,255,255,0.4);">第${hi+1}次 ${dt}</span>
                                <span style="font-size:12px;font-weight:700;color:${ok ? '#34d399' : '#f87171'};">${sc}分 ${ok ? '✓通过' : '✗未通过'}</span>
                            </div>`;
                        }).join('') : '';
                        const historyId = `dash-hist-${idx}-${mi}`;
                        const toggleBtn = attemptCount > 0
                            ? `<button onclick="(function(e){e.stopPropagation();var d=document.getElementById('${historyId}');d.style.display=d.style.display==='none'?'':'none';})(event)" style="font-size:10px;padding:2px 7px;border-radius:8px;border:none;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.5);cursor:pointer;margin-left:6px;">历史</button>`
                            : '';
                        const memberStyle = deadline.isOverdue
                            ? 'background:rgba(127,29,29,0.26);border:1px solid rgba(248,113,113,0.26);'
                            : '';
                        const metaDeadline = deadline.dueDate ? ` · ${deadline.dueText}` : '';
                        return `<div class="training-admin-member" style="${memberStyle}">
                            <div style="flex:1;min-width:0;">
                                <div class="training-admin-member-name">${escapeHtml(m.name||m.username)} ${historyBadge}${toggleBtn}</div>
                                <div class="training-admin-member-meta">${escapeHtml(m.position || '')}${scoreNote}${escapeHtml(metaDeadline)}</div>
                                ${historyHtml ? `<div id="${historyId}" style="display:none;padding-top:8px;">${historyHtml}</div>` : ''}
                            </div>
                            <span class="training-admin-badge" style="background:${bg};color:${color};">${label}</span>
                        </div>`;
                    }).join('') : '<div style="padding:8px 0;font-size:13px;color:rgba(255,255,255,0.3);">暂无指派成员</div>';
                    const cardStyle = overdueCount > 0
                        ? 'background:linear-gradient(145deg, rgba(127,29,29,0.4), rgba(30,41,59,0.96));border:1px solid rgba(248,113,113,0.4);box-shadow:0 0 0 1px rgba(239,68,68,0.08) inset;'
                        : '';
                    const overdueBanner = overdueCount > 0
                        ? `<div style="margin-bottom:12px;padding:10px 12px;border-radius:12px;background:rgba(127,29,29,0.22);border:1px solid rgba(248,113,113,0.24);font-size:12px;line-height:1.6;color:#fecaca;">当前有 ${overdueCount} 人逾期未完成，该培训主题已进入重点跟进状态。</div>`
                        : '';
                    return `
                    <div class="training-admin-card" style="${cardStyle}">
                        <details>
                            <summary class="training-admin-summary" style="list-style:none;cursor:pointer;">
                                <div class="training-admin-row">
                                    <div style="flex:1;min-width:0;">
                                        <div class="training-admin-title">${escapeHtml(d.title)}</div>
                                        <div class="training-admin-sub">${escapeHtml(d.position || '未标注岗位')} ${assignerLine}</div>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                                        ${overdueCount > 0 ? `<span class="training-admin-badge" style="background:rgba(239,68,68,0.16);color:#fca5a5;">${overdueCount} 人逾期</span>` : ''}
                                        <span class="training-admin-badge" style="background:rgba(255,255,255,0.07);color:${barColor};">${rate}%</span>
                                    </div>
                                </div>
                                <div class="training-admin-stats">
                                    <div class="training-admin-stat">
                                        <div class="training-admin-stat-value">${d.assigned_count}</div>
                                        <div class="training-admin-stat-label">已指派</div>
                                    </div>
                                    <div class="training-admin-stat">
                                        <div class="training-admin-stat-value">${d.certified_count}</div>
                                        <div class="training-admin-stat-label">已认证</div>
                                    </div>
                                    <div class="training-admin-stat">
                                        <div class="training-admin-stat-value">${members.length}</div>
                                        <div class="training-admin-stat-label">成员数</div>
                                    </div>
                                </div>
                            </summary>
                            <button class="training-admin-toggle" type="button" onclick="this.parentElement.open = !this.parentElement.open;">查看成员进度</button>
                            <div class="training-admin-details">
                                ${overdueBanner}
                                <div style="height:6px;border-radius:999px;background:rgba(255,255,255,0.1);overflow:hidden;margin-bottom:12px;">
                                    <div style="height:100%;width:${rate}%;background:${barColor};border-radius:999px;transition:width .4s;"></div>
                                </div>
                                <div class="training-admin-member-list">${membersHtml}</div>
                            </div>
                        </details>
                    </div>`;
                }).join('') + `</div>`;
            } catch (e) {
                showNotification('加载看板失败', 'error');
            }
        }

        function toggleDashboardMembers(idx) {
            const el = document.getElementById('dashboard-members-' + idx);
            if (!el) return;
            const btn = el.previousElementSibling;
            if (el.style.display === 'none') {
                el.style.display = 'block';
                if (btn) btn.style.background = 'rgba(99,102,241,0.15)';
            } else {
                el.style.display = 'none';
                if (btn) btn.style.background = 'rgba(255,255,255,0.06)';
            }
        }

        async function loadPendingCertifications() {
            try {
                const resp = await fetch('/api/training/certifications/pending', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const list = document.getElementById('training-pending-list');
                if (!list) return;
                if (!data.success || !data.pending?.length) {
                    list.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">暂无待审核记录</div>';
                    return;
                }
                const aiLabel = {passed:'AI：合格',review:'AI：建议复核',failed:'AI：不合格'};
                const aiColor = {passed:'#34d399',review:'#fbbf24',failed:'#f87171'};
                list.innerHTML = data.pending.map(c => {
                    const stepScores = c.ai_step_scores;
                    const totalScore = c.ai_total_score;
                    let scoreHtml = '';
                    if (stepScores && Array.isArray(stepScores) && stepScores.length) {
                        const stepsStr = stepScores.map(s => {
                            const pct = Math.round((s.score||0)/Math.max(1,s.max||1)*100);
                            const c2 = pct>=80?'#34d399':pct>=60?'#fbbf24':'#f87171';
                            return `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;font-size:11px;">
                                <span style="width:60px;color:rgba(255,255,255,0.55);">${escapeHtml(s.name||'')}</span>
                                <span style="width:60px;text-align:right;font-weight:600;color:${c2};">${s.score}/${s.max}</span>
                            </div>`;
                        }).join('');
                        scoreHtml = `<div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:10px;margin-bottom:10px;">
                            <div style="font-size:18px;font-weight:800;color:${totalScore>=80?'#34d399':totalScore>=60?'#fbbf24':'#f87171'};margin-bottom:4px;">AI评分：${totalScore}分</div>
                            ${stepsStr}
                        </div>`;
                    }
                    return `<div style="background:rgba(255,255,255,0.05);border-radius:14px;padding:14px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                            <span style="font-weight:700;color:#fff;font-size:14px;">${escapeHtml(c.employee_name || c.employee_username)}</span>
                            <span style="font-size:11px;color:${aiColor[c.ai_verdict]||'#94a3b8'};">${aiLabel[c.ai_verdict]||''}</span>
                        </div>
                        <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:10px;">📚 ${escapeHtml(c.title)} · ${escapeHtml(c.position)}</div>
                        ${c.media_url ? (c.media_type === 'video'
                            ? `<video src="${c.media_url}" controls playsinline style="width:100%;border-radius:10px;margin-bottom:10px;max-height:200px;object-fit:cover;"></video>`
                            : `<img src="${c.media_url}" style="width:100%;border-radius:10px;margin-bottom:10px;max-height:200px;object-fit:cover;">`) : ''}
                        ${c.ai_feedback ? `<div style="background:rgba(0,0,0,0.25);border-radius:8px;padding:10px;font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:10px;line-height:1.5;">💬 ${escapeHtml(c.ai_feedback)}</div>` : ''}
                        ${scoreHtml}
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            <button onclick="reviewCertWithScore(${c.id},'confirm')" style="padding:12px;border-radius:10px;background:rgba(52,211,153,0.15);border:1px solid rgba(52,211,153,0.3);color:#34d399;font-size:14px;font-weight:600;cursor:pointer;">✓ 确认AI评分</button>
                            <button data-click="reviewCertWithOverride" data-arg="${c.id}" data-arg-type="number" style="padding:12px;border-radius:10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.25);color:#fbbf24;font-size:14px;font-weight:600;cursor:pointer;">✎ 手动评分</button>
                        </div>
                    </div>`;
                }).join('');
            } catch (e) {
                showNotification('加载待审核列表失败', 'error');
            }
        }

        async function reviewCertWithScore(id, action) {
            try {
                const resp = await fetch('/api/training/certifications/' + id + '/review', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + localStorage.getItem('hrms_token')
                    },
                    body: JSON.stringify({ action })
                });
                const data = await resp.json();
                if (data.success) {
                    showNotification(action === 'confirm' ? '已确认AI评分' : '审核完成', 'success');
                    loadPendingCertifications();
                } else {
                    showNotification(data.error || '审核失败', 'error');
                }
            } catch (e) {
                showNotification('审核失败', 'error');
            }
        }

        async function reviewCertWithOverride(id) {
            // Load score detail and show override dialog
            try {
                const resp = await fetch('/api/training/certifications/' + id + '/score-detail', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                if (!data.success) return showNotification('加载失败', 'error');

                const scores = data.ai_step_scores || [];
                const total = data.ai_total_score || 0;
                const feedback = data.certification?.ai_feedback || '';

                const stepsHtml = scores.map((s, i) =>
                    `<div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
                        <span style="width:80px;color:rgba(255,255,255,0.7);font-size:13px;">${escapeHtml(s.name||'步骤'+(i+1))}</span>
                        <input type="number" id="override-score-${i}" value="${s.score||0}" min="0" max="${s.max||100}"
                            style="width:60px;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;font-size:13px;text-align:center;">
                        <span style="color:rgba(255,255,255,0.3);font-size:11px;">/${s.max||100}</span>
                        <span style="font-size:11px;color:rgba(255,255,255,0.35);flex:1;">${escapeHtml(s.feedback||'')}</span>
                    </div>`
                ).join('');

                const dialog = document.createElement('div');
                dialog.innerHTML = `
                    <div class="modal show" style="display:flex;z-index:9999;">
                        <div class="modal-backdrop" onclick="this.parentElement.remove()"></div>
                        <div class="modal-content" style="width:min(480px,calc(100vw-20px));max-height:90vh;overflow-y:auto;border-radius:18px;padding:24px;background:linear-gradient(180deg,rgba(30,41,59,0.98),rgba(15,23,42,0.98));border:1px solid rgba(148,163,184,0.16);">
                            <h3 style="color:#fff;margin:0 0 4px;">手动覆盖评分</h3>
                            <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:16px;">AI评分：${total}分。你可以逐项调整分数。</div>
                            ${stepsHtml}
                            <div style="margin-top:10px;">
                                <label style="font-size:11px;color:rgba(255,255,255,0.4);">审核备注</label>
                                <textarea id="override-note" rows="2" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;font-size:12px;resize:vertical;"></textarea>
                            </div>
                            <div style="display:flex;gap:8px;margin-top:16px;">
                                <button onclick="this.closest('.modal').remove()" style="flex:1;padding:12px;border-radius:10px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.6);font-size:14px;cursor:pointer;">取消</button>
                                <button data-click="submitOverride" data-arg="${id}" data-arg-type="number" style="flex:1;padding:12px;border-radius:10px;background:rgba(99,102,241,0.9);border:none;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">提交人工评分</button>
                            </div>
                        </div>
                    </div>`;
                document.body.appendChild(dialog);
            } catch (e) {
                showNotification('加载失败: ' + (e.message||e), 'error');
            }
        }

        async function submitOverride(id) {
            const steps = [];
            let i = 0;
            while (true) {
                const inp = document.getElementById('override-score-' + i);
                if (!inp) break;
                steps.push({ name: inp.previousElementSibling?.textContent || ('步骤'+(i+1)), score: Math.max(0, Number(inp.value) || 0) });
                i++;
            }
            const note = document.getElementById('override-note')?.value || '';
            try {
                const resp = await fetch('/api/training/certifications/' + id + '/review', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + localStorage.getItem('hrms_token')
                    },
                    body: JSON.stringify({ action: 'override', steps, note })
                });
                const data = await resp.json();
                if (data.success) {
                    showNotification('已提交人工评分：' + (data.final_score||0) + '分', 'success');
                    // Close dialog
                    const modals = document.querySelectorAll('.modal.show');
                    modals.forEach(m => m.remove());
                    loadPendingCertifications();
                } else {
                    showNotification(data.error || '提交失败', 'error');
                }
            } catch (e) {
                showNotification('提交失败: ' + (e.message||e), 'error');
            }
        }

        // Legacy compatibility
        async function reviewCertification(id, verdict) {
            return reviewCertWithScore(id, verdict === 'passed' ? 'confirm' : 'override');
        }

        // 员工端 tab 切换
        function switchEmpTab(tab) {
            const tasksBtn = document.getElementById('emp-tab-tasks');
            const certsBtn = document.getElementById('emp-tab-certs');
            const tasksPanel = document.getElementById('emp-tasks-panel');
            const certsPanel = document.getElementById('emp-certs-panel');
            const active = 'flex:1;padding:10px;border-radius:12px;background:rgba(99,102,241,0.9);border:none;color:#fff;font-size:14px;font-weight:700;cursor:pointer;';
            const inactive = 'flex:1;padding:10px;border-radius:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.7);font-size:14px;font-weight:600;cursor:pointer;';
            if (tab === 'tasks') {
                if (tasksBtn) tasksBtn.style.cssText = active;
                if (certsBtn) certsBtn.style.cssText = inactive;
                if (tasksPanel) tasksPanel.style.display = '';
                if (certsPanel) certsPanel.style.display = 'none';
                loadMyTrainingTopics();
            } else {
                if (tasksBtn) tasksBtn.style.cssText = inactive;
                if (certsBtn) certsBtn.style.cssText = active;
                if (tasksPanel) tasksPanel.style.display = 'none';
                if (certsPanel) certsPanel.style.display = '';
                loadMyCertifications();
            }
        }

        async function loadMyCertifications() {
            try {
                const resp = await fetch('/api/training/my-certifications', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const list = document.getElementById('emp-certs-list');
                const empty = document.getElementById('emp-certs-empty');
                if (!list) return;
                if (!data.success || !data.certifications?.length) {
                    list.innerHTML = '';
                    if (empty) empty.style.display = '';
                    return;
                }
                if (empty) empty.style.display = 'none';
                list.innerHTML = data.certifications.map(c => {
                    const certDate = c.certified_at ? c.certified_at.slice(0, 10) : '—';
                    const score = c.quiz_score !== null && c.quiz_score !== undefined ? c.quiz_score + '分' : '—';
                    const posArr = (c.position || '').split(',').map(s => s.trim()).filter(Boolean);
                    const posTags = posArr.map(p => `<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(99,102,241,0.2);color:#a5b4fc;">${escapeHtml(p)}</span>`).join('');
                    // 实操评分
                    let practiceScoreHtml = '';
                    const finalScore = c.final_score;
                    const aiTotal = c.ai_total_score;
                    const reviewStatus = c.review_status;
                    const effectiveStatus = c.effective_status || (c.manager_verdict === 'passed' ? 'certified' : 'pending_review');
                    const certState = effectiveStatus === 'certified'
                        ? { label: '✓ 已认证', color: '#34d399', bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.25)' }
                        : effectiveStatus === 'pending_review'
                            ? { label: '⏳ 实操审核中', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.25)' }
                            : { label: '⚠️ 未通过', color: '#fca5a5', bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.25)' };
                    if (c.require_practice && finalScore !== null && finalScore !== undefined) {
                        const scoreColor = finalScore >= 80 ? '#34d399' : finalScore >= 60 ? '#fbbf24' : '#f87171';
                        const scoreBadge = reviewStatus === 'overridden'
                            ? '<span style="font-size:9px;color:rgba(255,255,255,0.35);">(人工)</span>'
                            : '<span style="font-size:9px;color:rgba(255,255,255,0.35);">(AI确认)</span>';
                        practiceScoreHtml = `<div style="margin-top:6px;font-size:13px;font-weight:700;color:${scoreColor};">实操 ${finalScore}分 ${scoreBadge}</div>`;
                    } else if (c.require_practice && reviewStatus === 'pending') {
                        practiceScoreHtml = `<div style="margin-top:6px;font-size:12px;color:#eab308;">实操评分待派发人审核</div>`;
                    }
                    return `
                    <div style="background:${effectiveStatus === 'certified' ? 'rgba(52,211,153,0.07)' : 'rgba(251,191,36,0.06)'};border:1px solid ${certState.border};border-radius:14px;padding:16px;">
                        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;">
                            <div style="font-size:15px;font-weight:700;color:#fff;flex:1;margin-right:8px;">${escapeHtml(c.title)}</div>
                            <span style="font-size:11px;padding:3px 10px;border-radius:10px;background:${certState.bg};color:${certState.color};white-space:nowrap;">${certState.label}</span>
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${posTags}</div>
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div style="font-size:12px;color:rgba(255,255,255,0.5);">认证日期：${certDate}</div>
                            <div style="font-size:13px;font-weight:700;color:#fbbf24;">测验 ${score}</div>
                        </div>
                        ${practiceScoreHtml}
                    </div>`;
                }).join('');
            } catch (e) {
                showNotification('加载认证记录失败', 'error');
            }
        }

        function backToTrainingHome() {
            document.getElementById('training-home-screen').style.display = '';
            document.getElementById('training-learn-screen').style.display = 'none';
            document.getElementById('training-quiz-screen').style.display = 'none';
            document.getElementById('training-practice-screen').style.display = 'none';
            const cs = document.getElementById('training-certified-screen');
            if (cs) cs.style.display = 'none';
            switchEmpTab('tasks');
        }

        async function loadMyTrainingTopics() {
            try {
                const resp = await fetch('/api/training/my-topics', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                const list = document.getElementById('training-my-topics-list');
                const empty = document.getElementById('training-my-topics-empty');
                if (!list) return;

                if (!data.success || !data.topics?.length) {
                    list.innerHTML = '';
                    if (empty) empty.style.display = '';
                    return;
                }
                if (empty) empty.style.display = 'none';

                list.innerHTML = data.topics.map(t => {
                    const sMap = {'learning':'学习中','quiz':'待测验','practice':'实操审核中','certified':'已认证','not_started':'未开始'};
                    const sIcon = {'learning':'📖','quiz':'📝','practice':'⏳','certified':'✅','not_started':'🔔'};
                    const sBg   = {'learning':'rgba(96,165,250,0.12)','quiz':'rgba(139,92,246,0.12)','practice':'rgba(249,115,22,0.12)','certified':'rgba(52,211,153,0.12)','not_started':'rgba(148,163,184,0.1)'};
                    const sBorder = {'learning':'rgba(96,165,250,0.3)','quiz':'rgba(139,92,246,0.3)','practice':'rgba(249,115,22,0.3)','certified':'rgba(52,211,153,0.3)','not_started':'rgba(148,163,184,0.2)'};
                    const sColor = {'learning':'#60a5fa','quiz':'#a78bfa','practice':'#fb923c','certified':'#34d399','not_started':'#94a3b8'};
                    const st = t.effective_status || t.session_status || 'not_started';
                    const deadline = getTrainingDeadlineState(t);
                    const isDone = st === 'certified';
                    const isPending = st === 'practice';
                    const btnLabel = isDone ? '✅ 已完成' : isPending ? '📤 提交实操材料 →' : '开始学习 →';
                    const btnDisabled = isDone;
                    const practiceTag = t.require_practice === false ? '<span style="font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(96,165,250,0.12);color:#60a5fa;margin-left:6px;">无需实操</span>' : '';
                    const statusBg = deadline.isOverdue ? 'rgba(239,68,68,0.12)' : sBg[st];
                    const statusBorder = deadline.isOverdue ? 'rgba(239,68,68,0.3)' : sBorder[st];
                    const statusColor = deadline.isOverdue ? '#fca5a5' : sColor[st];
                    const statusLabel = deadline.isOverdue ? `⚠️ 已逾期 ${Math.max(1, deadline.daysOverdue)} 天` : `${sIcon[st]} ${sMap[st]||'未开始'}`;
                    const cardStyle = deadline.isOverdue
                        ? 'background:linear-gradient(145deg, rgba(127,29,29,0.36), rgba(30,41,59,0.96));border:1px solid rgba(248,113,113,0.34);'
                        : 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);';
                    return `
                        <div style="${cardStyle}border-radius:16px;overflow:hidden;">
                            <div style="padding:16px;">
                                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                                    <span style="font-weight:700;color:#fff;font-size:15px;">${escapeHtml(t.title)}${practiceTag}</span>
                                    <span style="font-size:12px;padding:4px 10px;border-radius:10px;background:${statusBg};border:1px solid ${statusBorder};color:${statusColor};">${statusLabel}</span>
                                </div>
                                <div style="font-size:12px;color:rgba(255,255,255,0.4);">
                                    ${escapeHtml(t.position)} &nbsp;·&nbsp; ${escapeHtml(deadline.dueText)}
                                    ${t.quiz_score !== null && t.quiz_score !== undefined ? ' &nbsp;·&nbsp; 测验 '+t.quiz_score+'分' : ''}
                                </div>
                            </div>
                            <button onclick="${btnDisabled ? '' : 'openTrainingSession('+t.topic_id+')'}"
                                style="width:100%;padding:13px;border:none;border-top:1px solid var(--pf-line);background:${btnDisabled ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.8)'};color:${btnDisabled ? 'rgba(255,255,255,0.3)' : '#fff'};font-size:14px;font-weight:600;cursor:${btnDisabled ? 'default' : 'pointer'};letter-spacing:.3px;">
                                ${btnLabel}
                            </button>
                        </div>
                    `;
                }).join('');

                // 更新 badge
                const badge = document.getElementById('nav-badge-training');
                if (badge) {
                    const pending = data.topics.filter(t => t.session_status !== 'certified').length;
                    badge.textContent = pending;
                    badge.style.display = pending > 0 ? '' : 'none';
                }
            } catch (e) {
                showNotification('加载培训任务失败', 'error');
            }
        }

        async function openTrainingSession(topicId) {
            try {
                const resp = await fetch('/api/training/topics/' + topicId + '/session', {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                if (!data.success) return showNotification(data.error || '加载失败', 'error');

                _trainingCurrentSession = data.session;
                _trainingCurrentTopic = data.topic;
                _trainingCurrentKbArticles = data.kb_articles || [];

                if (data.session.status === 'certified') {
                    showNotification('已通过认证', 'success');
                    return;
                }

                // 根据状态显示对应界面
                if (data.session.status === 'practice' || data.session.quiz_passed) {
                    showTrainingPracticeScreen();
                } else if (data.session.quiz_passed === false && data.session.quiz_questions?.length) {
                    showTrainingQuizScreen();
                } else {
                    showTrainingLearnScreen();
                }
            } catch (e) {
                showNotification('加载失败', 'error');
            }
        }

        let _trainingCurrentArticleIdx = 0;

        function showTrainingLearnScreen() {
            document.getElementById('training-home-screen').style.display = 'none';
            document.getElementById('training-learn-screen').style.display = '';
            document.getElementById('training-quiz-screen').style.display = 'none';
            document.getElementById('training-practice-screen').style.display = 'none';
            const cs = document.getElementById('training-certified-screen');
            if (cs) cs.style.display = 'none';

            document.getElementById('training-learn-title').textContent = _trainingCurrentTopic?.title || '学习';

            const articlesDiv = document.getElementById('training-content-articles');
            const articles = _trainingCurrentKbArticles || [];
            _trainingCurrentArticleIdx = 0;

            const tabsDiv = document.getElementById('training-article-tabs');

            if (articles.length === 0) {
                if (tabsDiv) tabsDiv.style.display = 'none';
                articlesDiv.innerHTML = `<div style="text-align:center;padding:40px 0;color:rgba(255,255,255,0.45);">
                    <div style="font-size:36px;margin-bottom:10px;">📄</div>
                    <div>暂无培训资料</div>
                </div>`;
                enableTrainingQuizBtn();
            } else {
                // Build article tabs if more than one article
                if (tabsDiv) {
                    if (articles.length > 1) {
                        tabsDiv.style.display = 'flex';
                        tabsDiv.innerHTML = articles.map((a, i) => `
                            <button id="training-article-tab-${i}" data-click="showTrainingArticle" data-arg="${i}" data-arg-type="number"
                                style="padding:6px 14px;border-radius:20px;border:1px solid rgba(255,255,255,0.18);
                                       background:${i === 0 ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.06)'};
                                       color:${i === 0 ? '#c4b5fd' : 'rgba(255,255,255,0.6)'};
                                       font-size:13px;cursor:pointer;white-space:nowrap;transition:all .2s;">
                                📖 ${escapeHtml(a.title)}
                            </button>`).join('');
                    } else {
                        tabsDiv.style.display = 'none';
                    }
                }

                const token = localStorage.getItem('hrms_token') || '';

                window.showTrainingArticle = async function(idx) {
                    _trainingCurrentArticleIdx = idx;
                    articles.forEach((_, i) => {
                        const tab = document.getElementById(`training-article-tab-${i}`);
                        if (!tab) return;
                        tab.style.background = i === idx ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.06)';
                        tab.style.color = i === idx ? '#c4b5fd' : 'rgba(255,255,255,0.6)';
                    });
                    const a = articles[idx];
                    articlesDiv.innerHTML = '';
                    loadTrainingAiExplanation(a.id, articlesDiv);
                };

                // AI 解析作为主培训内容直接渲染（缓存后全员共用，无需查看原文件）
                window.loadTrainingAiExplanation = async function(articleId, container) {
                    disableTrainingQuizBtn();
                    container.innerHTML = '<div style="text-align:center;padding:52px 0;color:rgba(255,255,255,0.4);"><div style="font-size:34px;margin-bottom:14px;opacity:0.7;">✨</div><div style="font-size:13px;">AI 正在整理培训内容，请稍候…</div></div>';

                    try {
                        const resp = await fetch('/api/training/kb/' + encodeURIComponent(articleId) + '/explanation', {
                            headers: { 'Authorization': 'Bearer ' + token }
                        });
                        const data = await resp.json();

                        if (data.success && data.explanation) {
                            const cacheBadge = data.cached
                                ? '<span style="font-size:10px;padding:2px 8px;border-radius:8px;background:rgba(52,211,153,0.15);color:#6ee7b7;margin-left:6px;">已缓存</span>'
                                : '<span style="font-size:10px;padding:2px 8px;border-radius:8px;background:rgba(251,191,36,0.15);color:#fde68a;margin-left:6px;">✨ 新生成</span>';
                            container.innerHTML = buildTrainingExplanationView(data.explanation, cacheBadge);
                        } else if (data.error === 'no_content') {
                            container.innerHTML = '<div style="text-align:center;padding:44px 0;"><div style="font-size:32px;margin-bottom:12px;">📄</div><div style="color:rgba(255,255,255,0.45);font-size:13px;line-height:1.7;">该培训资料暂无文字内容<br>管理员需填写「视频内容摘要」后方可生成解析</div></div>';
                        } else {
                            container.innerHTML = '<div style="text-align:center;padding:44px 0;"><div style="font-size:32px;margin-bottom:12px;">⚠️</div><div style="color:rgba(255,255,255,0.45);font-size:13px;">' + escapeHtml(data.message || 'AI 解析生成失败，请稍后重试') + '</div></div>';
                        }
                    } catch (e) {
                        container.innerHTML = '<div style="text-align:center;padding:44px 0;"><div style="font-size:32px;margin-bottom:12px;">📡</div><div style="color:rgba(255,255,255,0.45);font-size:13px;">网络错误，请检查连接后重试</div></div>';
                    }
                    enableTrainingQuizBtn();
                };

                showTrainingArticle(0);
            }

            const area = document.getElementById('training-content-area');
            if (area) area.scrollTop = 0;
        }

        let _learnBtnWaitTimer = null;
        function disableTrainingQuizBtn() {
            const btn = document.getElementById('training-start-quiz-btn');
            if (!btn) return;
            btn.disabled = true;
            let waitSec = 0;
            if (_learnBtnWaitTimer) clearInterval(_learnBtnWaitTimer);
            btn.textContent = '⏳ AI 正在整理培训内容…';
            _learnBtnWaitTimer = setInterval(() => {
                waitSec++;
                btn.textContent = `⏳ AI 正在整理培训内容…(${waitSec}s)`;
            }, 1000);
        }
        function enableTrainingQuizBtn() {
            if (_learnBtnWaitTimer) { clearInterval(_learnBtnWaitTimer); _learnBtnWaitTimer = null; }
            const btn = document.getElementById('training-start-quiz-btn');
            if (btn) { btn.disabled = false; btn.textContent = '✍️ 完成阅读，开始考试认证'; }
        }

        let _quizLoadingTimer = null;
        async function startTrainingQuiz() {
            const btn = document.getElementById('training-start-quiz-btn');
            if (btn) { btn.disabled = true; btn.textContent = '正在生成测验…'; }

            // Switch to quiz screen showing loading state
            document.getElementById('training-home-screen').style.display = 'none';
            document.getElementById('training-learn-screen').style.display = 'none';
            document.getElementById('training-quiz-screen').style.display = '';
            document.getElementById('training-practice-screen').style.display = 'none';
            const cs = document.getElementById('training-certified-screen');
            if (cs) cs.style.display = 'none';

            const loadingDiv = document.getElementById('training-quiz-loading');
            const questionsDiv = document.getElementById('training-quiz-questions');
            const submitBtn = document.getElementById('training-quiz-submit-btn');
            if (loadingDiv) loadingDiv.style.display = '';
            if (questionsDiv) questionsDiv.innerHTML = '';
            if (submitBtn) submitBtn.style.display = 'none';

            // Countdown timer
            let count = 30;
            const countEl = document.getElementById('training-quiz-loading-count');
            if (countEl) countEl.textContent = count;
            if (_quizLoadingTimer) clearInterval(_quizLoadingTimer);
            _quizLoadingTimer = setInterval(() => {
                count = Math.max(0, count - 1);
                if (countEl) countEl.textContent = count;
            }, 1000);

            try {
                const resp = await fetch('/api/training/sessions/' + _trainingCurrentSession.id + '/start-quiz', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }
                });
                const data = await resp.json();
                if (data.success) {
                    _trainingCurrentSession.quiz_questions = data.questions;
                    showTrainingQuizScreen();
                } else {
                    if (loadingDiv) loadingDiv.style.display = 'none';
                    showNotification(data.error || '生成测验失败', 'error');
                    backToTrainingStudy();
                }
            } catch (e) {
                if (loadingDiv) loadingDiv.style.display = 'none';
                showNotification('生成测验失败', 'error');
                backToTrainingStudy();
            } finally {
                if (_quizLoadingTimer) { clearInterval(_quizLoadingTimer); _quizLoadingTimer = null; }
                if (btn) { btn.disabled = false; btn.textContent = '✍️ 完成阅读，开始考试认证'; }
            }
        }

        function backToTrainingStudy() {
            // Clear quiz questions so next time re-generates
            if (_trainingCurrentSession) _trainingCurrentSession.quiz_questions = null;
            showTrainingLearnScreen();
        }

        function showTrainingQuizScreen() {
            document.getElementById('training-home-screen').style.display = 'none';
            document.getElementById('training-learn-screen').style.display = 'none';
            document.getElementById('training-quiz-screen').style.display = '';
            document.getElementById('training-practice-screen').style.display = 'none';

            const loadingDiv = document.getElementById('training-quiz-loading');
            const submitBtn = document.getElementById('training-quiz-submit-btn');
            if (loadingDiv) loadingDiv.style.display = 'none';
            if (submitBtn) submitBtn.style.display = '';

            const questions = _trainingCurrentSession?.quiz_questions || [];
            const container = document.getElementById('training-quiz-questions');
            container.innerHTML = questions.map((q, i) => `
                <div style="background:rgba(255,255,255,0.05);border-radius:14px;padding:16px;margin-bottom:14px;border:1px solid rgba(255,255,255,0.08);">
                    <div style="font-weight:700;color:#fff;font-size:15px;margin-bottom:14px;line-height:1.5;">第 ${i+1} 题 &nbsp;·&nbsp; ${escapeHtml(q.q)}</div>
                    <div style="display:flex;flex-direction:column;gap:10px;">
                        ${(q.options || []).map((opt, j) => `
                            <label style="display:flex;align-items:center;gap:12px;padding:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:rgba(99,102,241,0.15);" ontouchstart="this.style.background='rgba(99,102,241,0.12)'" ontouchend="this.style.background='rgba(255,255,255,0.04)'">
                                <input type="radio" name="quiz-q${i}" value="${j}" style="width:20px;height:20px;flex-shrink:0;accent-color:#6366f1;">
                                <span style="color:rgba(255,255,255,0.9);font-size:14px;line-height:1.5;"><span style="color:#a5b4fc;font-weight:600;">${String.fromCharCode(65+j)}.</span> ${escapeHtml(opt)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        }

        async function submitTrainingQuiz() {
            const questions = _trainingCurrentSession?.quiz_questions || [];
            const answers = questions.map((_, i) => {
                const selected = document.querySelector(`input[name="quiz-q${i}"]:checked`);
                return selected ? parseInt(selected.value) : -1;
            });

            if (answers.some(a => a === -1)) {
                return showNotification('请完成所有题目', 'warning');
            }

            try {
                const resp = await fetch('/api/training/sessions/' + _trainingCurrentSession.id + '/submit-quiz', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + localStorage.getItem('hrms_token')
                    },
                    body: JSON.stringify({ answers })
                });
                const data = await resp.json();
                if (data.success) {
                    _trainingCurrentSession.quiz_score = data.score;
                    showTrainingQuizResults(data);
                    _trainingCurrentSession.quiz_questions = null; // cleared server-side after render
                } else {
                    showNotification(data.error || '提交失败', 'error');
                }
            } catch (e) {
                showNotification('提交失败', 'error');
            }
        }

        function showTrainingQuizResults(data) {
            const { score, passed, total, results } = data;
            const quizBody = document.getElementById('training-quiz-questions');
            if (!quizBody) return;
            const submitBar = document.getElementById('training-quiz-submit-btn');
            if (submitBar) submitBar.style.display = 'none';

            const correctCount = results.filter(r => r.isCorrect).length;
            const scoreColor = passed ? '#34d399' : '#f87171';
            const scoreBg = passed ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)';
            const scoreBorder = passed ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)';

            const questionsHtml = results.map((r, i) => {
                const optLetters = ['A','B','C','D'];
                const optionsHtml = r.options.map((opt, oi) => {
                    let bg = 'rgba(255,255,255,0.04)';
                    let border = 'rgba(255,255,255,0.1)';
                    let color = 'rgba(255,255,255,0.75)';
                    let badge = '';
                    if (oi === r.correct) {
                        bg = 'rgba(52,211,153,0.12)';
                        border = 'rgba(52,211,153,0.4)';
                        color = '#6ee7b7';
                        badge = `<span style="margin-left:6px;font-size:11px;background:rgba(52,211,153,0.2);color:#6ee7b7;padding:1px 6px;border-radius:8px;">✓ 正确</span>`;
                    } else if (oi === r.userAnswer && !r.isCorrect) {
                        bg = 'rgba(248,113,113,0.1)';
                        border = 'rgba(248,113,113,0.35)';
                        color = '#fca5a5';
                        badge = `<span style="margin-left:6px;font-size:11px;background:rgba(248,113,113,0.2);color:#fca5a5;padding:1px 6px;border-radius:8px;">✗ 你的答案</span>`;
                    }
                    return `<div style="padding:8px 12px;margin:5px 0;border-radius:10px;border:1px solid ${border};background:${bg};color:${color};font-size:13px;display:flex;align-items:center;gap:4px;">
                        <span style="font-weight:600;flex-shrink:0;">${optLetters[oi]}.</span> ${escapeHtml(opt)}${badge}
                    </div>`;
                }).join('');
                const explanationHtml = (!r.isCorrect && r.explanation)
                    ? `<div style="margin-top:8px;padding:8px 12px;background:rgba(251,191,36,0.08);border-left:2px solid rgba(251,191,36,0.5);border-radius:0 8px 8px 0;font-size:12px;color:#fde68a;line-height:1.6;">💡 ${escapeHtml(r.explanation)}</div>`
                    : '';
                const qStatus = r.isCorrect
                    ? `<span style="font-size:12px;color:#34d399;">✓ 答对</span>`
                    : `<span style="font-size:12px;color:#f87171;">✗ 答错</span>`;
                return `<div style="margin-bottom:14px;padding:14px;background:rgba(255,255,255,0.04);border-radius:14px;border:1px solid rgba(255,255,255,0.08);">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                        <div style="font-size:14px;color:rgba(255,255,255,0.9);line-height:1.6;flex:1;padding-right:8px;">${i+1}. ${escapeHtml(r.q)}</div>
                        ${qStatus}
                    </div>
                    ${optionsHtml}
                    ${explanationHtml}
                </div>`;
            }).join('');

            const actionBtn = passed
                ? `<button onclick="(function(){
                        if('${data.next_status}'==='certified'){showTrainingCertifiedScreen();}
                        else{showTrainingPracticeScreen();}
                   })()" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,rgba(52,211,153,0.9),rgba(16,185,129,0.9));border:none;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">
                        🎉 继续
                   </button>`
                : `<button data-click="startTrainingQuiz" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,rgba(99,102,241,0.9),rgba(139,92,246,0.9));border:none;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">
                        🔄 重新生成题目再考一次
                   </button>`;

            const retakeWarning = !passed ? `
                <div style="margin-bottom:16px;padding:14px 16px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:14px;display:flex;align-items:flex-start;gap:10px;">
                    <span style="font-size:20px;flex-shrink:0;">⚠️</span>
                    <div>
                        <div style="font-size:14px;font-weight:700;color:#fca5a5;margin-bottom:4px;">需要重新补考</div>
                        <div style="font-size:13px;color:rgba(255,255,255,0.6);line-height:1.5;">本次测验未达到90分，<strong style="color:#fca5a5;">此培训任务未完成</strong>。请仔细查看错题解析后，重新生成题目进行补考，直到达到90分及以上方可完成认证。</div>
                    </div>
                </div>` : '';

            quizBody.innerHTML = `
                <div style="text-align:center;padding:20px 0 16px;margin-bottom:16px;background:${scoreBg};border:1px solid ${scoreBorder};border-radius:16px;">
                    <div style="font-size:48px;font-weight:800;color:${scoreColor};line-height:1;">${score}</div>
                    <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:2px;">/ 100分</div>
                    <div style="font-size:15px;font-weight:600;color:${scoreColor};margin-top:8px;">
                        ${passed ? '🎉 恭喜通过！' : '❌ 未通过，需达到90分'}
                    </div>
                    <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-top:4px;">答对 ${correctCount} / ${total} 题</div>
                </div>
                ${retakeWarning}
                <div style="margin-bottom:16px;">${questionsHtml}</div>
                ${actionBtn}`;
            try { quizBody.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
        }

        function showTrainingPracticeScreen() {
            document.getElementById('training-home-screen').style.display = 'none';
            document.getElementById('training-learn-screen').style.display = 'none';
            document.getElementById('training-quiz-screen').style.display = 'none';
            document.getElementById('training-practice-screen').style.display = '';

            document.getElementById('training-practice-task').textContent = _trainingCurrentTopic?.practice_task || '按要求完成实操任务';
            document.getElementById('training-practice-result').style.display = 'none';
            // 重置上传区
            const fileInput = document.getElementById('training-practice-file');
            if (fileInput) fileInput.value = '';
            const preview = document.getElementById('training-file-preview');
            if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
            const uploadBtn = document.getElementById('training-upload-btn');
            if (uploadBtn) uploadBtn.style.display = 'none';
            const uploadArea = document.getElementById('training-upload-area');
            if (uploadArea) uploadArea.style.display = '';
        }

        function showTrainingCertifiedScreen() {
            document.getElementById('training-home-screen').style.display = 'none';
            document.getElementById('training-learn-screen').style.display = 'none';
            document.getElementById('training-quiz-screen').style.display = 'none';
            document.getElementById('training-practice-screen').style.display = 'none';
            document.getElementById('training-certified-screen').style.display = '';

            const nameEl = document.getElementById('training-certified-topic-name');
            if (nameEl) nameEl.textContent = _trainingCurrentTopic?.title || '';
        }

        function trainingFileSelected(input) {
            const file = input.files?.[0];
            if (!file) return;
            const preview = document.getElementById('training-file-preview');
            const uploadBtn = document.getElementById('training-upload-btn');
            const uploadArea = document.getElementById('training-upload-area');
            if (!preview || !uploadBtn) return;

            const isVideo = file.type.startsWith('video/');
            const url = URL.createObjectURL(file);
            preview.style.display = '';
            if (isVideo) {
                preview.innerHTML = `
                    <video src="${url}" controls playsinline style="width:100%;border-radius:12px;max-height:240px;object-fit:cover;"></video>
                    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:6px;text-align:center;">📹 ${escapeHtml(file.name)}</div>`;
            } else {
                preview.innerHTML = `
                    <img src="${url}" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover;">
                    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:6px;text-align:center;">🖼 ${escapeHtml(file.name)}</div>`;
            }
            if (uploadArea) uploadArea.style.display = 'none';
            uploadBtn.style.display = '';
        }

        async function uploadTrainingPractice() {
            const fileInput = document.getElementById('training-practice-file');
            if (!fileInput.files?.length) return showNotification('请选择文件', 'warning');

            const formData = new FormData();
            formData.append('file', fileInput.files[0]);

            try {
                const resp = await fetch('/api/training/sessions/' + _trainingCurrentSession.id + '/upload-practice', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') },
                    body: formData
                });
                const data = await resp.json();
                if (data.success) {
                    const resultDiv = document.getElementById('training-practice-result');
                    resultDiv.style.display = '';
                    const stepScores = data.step_scores;
                    const totalScore = data.total_score;
                    const hasRubric = data.has_rubric;

                    // 图谱评分结果
                    if (hasRubric && stepScores && Array.isArray(stepScores) && stepScores.length) {
                        const scoreColor = totalScore >= 80 ? '#22c55e' : totalScore >= 60 ? '#eab308' : '#ef4444';
                        const scoreEmoji = totalScore >= 80 ? '✅' : totalScore >= 60 ? '⚠️' : '❌';
                        const stepsHtml = stepScores.map(s => {
                            const pct = Math.round((s.score || 0) / Math.max(1, s.max || 1) * 100);
                            const barColor = pct >= 80 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';
                            return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0;font-size:13px;">
                                <span style="min-width:80px;color:rgba(255,255,255,0.7);">${escapeHtml(s.name || '')}</span>
                                <div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;">
                                    <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;"></div>
                                </div>
                                <span style="min-width:45px;text-align:right;color:${barColor};font-weight:600;">${s.score}/${s.max}</span>
                            </div>
                            ${s.feedback ? `<div style="margin-left:90px;margin-bottom:4px;font-size:11px;color:rgba(255,255,255,0.4);">${escapeHtml(s.feedback)}</div>` : ''}`;
                        }).join('');

                        resultDiv.innerHTML = `<div style="background:rgba(30,41,59,0.98);border:1px solid rgba(148,163,184,0.2);border-radius:14px;padding:24px;">
                            <div style="text-align:center;margin-bottom:16px;">
                                <div style="font-size:36px;margin-bottom:8px;">${scoreEmoji}</div>
                                <div style="font-size:28px;font-weight:800;color:${scoreColor};">${totalScore !== null ? totalScore + '分' : 'N/A'}</div>
                                <div style="font-size:12px;color:rgba(255,255,255,0.4);">AI自动评分 · 待派发人审核确认</div>
                            </div>
                            <div style="border-top:1px solid rgba(148,163,184,0.1);padding-top:12px;">
                                ${stepsHtml}
                            </div>
                            <div style="margin-top:12px;padding:10px;border-radius:8px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.2);text-align:center;font-size:12px;color:#eab308;">
                                ⏳ 评分已提交，等待派发人审核确认后生效
                            </div>
                        </div>`;
                    } else if (data.verdict === 'passed') {
                        resultDiv.innerHTML = `<div style="background:rgba(34,197,94,0.2);border:1px solid rgba(34,197,94,0.3);border-radius:12px;padding:20px;text-align:center;"><div style="font-size:48px;margin-bottom:12px;">🎉</div><div style="font-size:18px;font-weight:600;color:#22c55e;">认证通过</div><div style="color:rgba(255,255,255,0.6);margin-top:8px;">${escapeHtml(data.feedback || '操作规范，符合要求')}</div></div>`;
                        setTimeout(() => backToTrainingHome(), 2000);
                    } else if (data.verdict === 'review') {
                        resultDiv.innerHTML = `<div style="background:rgba(234,179,8,0.2);border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:20px;text-align:center;"><div style="font-size:48px;margin-bottom:12px;">⏳</div><div style="font-size:18px;font-weight:600;color:#eab308;">等待人工审核</div><div style="color:rgba(255,255,255,0.6);margin-top:8px;">${escapeHtml(data.feedback || '已提交，请等待管理员审核')}</div></div>`;
                    } else {
                        resultDiv.innerHTML = `<div style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:20px;text-align:center;"><div style="font-size:48px;margin-bottom:12px;">❌</div><div style="font-size:18px;font-weight:600;color:#ef4444;">需要重新练习</div><div style="color:rgba(255,255,255,0.6);margin-top:8px;">${escapeHtml(data.feedback || '操作不符合要求，请重新练习后再次提交')}</div></div>`;
                    }
                } else {
                    showNotification(data.error || '上传失败', 'error');
                }
            } catch (e) {
                showNotification('上传失败', 'error');
            }
        }

        // ── 知识库模块 Tab 切换 ──
        function switchKbModule(module) {
            const knowledgePanel = document.getElementById('kb-panel-knowledge');
            const filesPanel = document.getElementById('kb-panel-files');
            const kbTab = document.getElementById('kb-mtab-knowledge');
            const filesTab = document.getElementById('kb-mtab-files');
            if (!knowledgePanel || !filesPanel) return;

            if (module === 'files') {
                knowledgePanel.style.display = 'none';
                filesPanel.style.display = '';
                if (kbTab) kbTab.classList.remove('active');
                if (filesTab) filesTab.classList.add('active');
                loadFilesList(1);
            } else {
                filesPanel.style.display = 'none';
                knowledgePanel.style.display = '';
                if (kbTab) kbTab.classList.add('active');
                if (filesTab) filesTab.classList.remove('active');
            }
        }

        function loadKnowledgeData() {
            const btn = document.getElementById('btn-knowledge-upload');
            const isAdmin = currentUser && currentUser.role === ROLES.ADMIN;
            if (btn) btn.style.display = isAdmin ? '' : 'none';
            syncKnowledgeAdminUi();

            const filterAudience = document.getElementById('knowledge-filter-audience');
            if (filterAudience) {
                // keep UI simple: only admin sees "全量（管理员）"
                const optAll = Array.from(filterAudience.options || []).find(o => o.value === 'all');
                if (optAll) optAll.disabled = !isAdmin;
                if (!isAdmin) filterAudience.value = 'mine';
                if (isAdmin) filterAudience.value = 'all';
            }

            kbBackToList();
            populateKnowledgeFilterOptions();
            applyKnowledgeFilterState();
            applyKnowledgeFiltersVisibility();
            renderKbCategoryBar();

            refreshBrandsCache(true).then(() => {
                populateKnowledgeBrandOptions('all');
                const st = getKnowledgeFilterState();
                populateKnowledgeFilterBrandOptions(st.brandId || '');
            });

            (async () => {
                try {
                    const st = getKnowledgeFilterState();
                    const selectedBrandId = normalizeBrandIdInput(st.brandId || document.getElementById('knowledge-filter-brand')?.value || '');
                    __KB_ACTIVE_BRAND_ID = selectedBrandId || 'all';
                    await Promise.all([
                        (async () => {
                            const resp = await HRMS_API.getKnowledge({ brandId: selectedBrandId && selectedBrandId !== 'all' ? selectedBrandId : '' });
                            const items = (resp?.items || []).map(r => {
                        const fileType = String(r?.file_type || '').toLowerCase();
                        const type = (fileType === 'video') ? 'video' : (fileType === 'pdf' ? 'pdf' : (fileType === 'doc' || fileType === 'docx' ? 'doc' : (fileType === 'txt' ? 'txt' : (fileType === 'img' ? 'img' : 'doc'))));
                        const createdAt = r?.created_at ? String(r.created_at) : '';
                        const filePath = String(r?.file_path || '');
                        const brandRef = parseBrandFromKnowledgeTags(r?.tags);
                        let aud = { type: 'all' };
                        try {
                            const raw = r?.audience;
                            if (raw && typeof raw === 'object' && !Array.isArray(raw)) aud = raw;
                            else if (typeof raw === 'string' && raw.trim()) aud = JSON.parse(raw);
                        } catch (e) { /* keep default */ }
                        return {
                            id: String(r?.id || ''),
                            title: normalizeKnowledgeTextDisplay(String(r?.title || '')),
                            category: String(r?.category || ''),
                            type,
                            tags: Array.isArray(r?.tags) ? r.tags : [],
                            brandId: String(brandRef.brandId || 'all'),
                            brandName: String(brandRef.brandName || '全部品牌'),
                            audience: aud,
                            fileId: '',
                            fileName: normalizeKnowledgeTextDisplay(String(r?.title || filePath || '')),
                            mimeType: String(r?.file_type || ''),
                            size: Number(r?.file_size || 0),
                            createdAt,
                            createdBy: String(r?.created_by || ''),
                            groupId: String(r?.group_id || ''),
                            groupName: normalizeKnowledgeTextDisplay(String(r?.group_name || '')),
                            step_rubric: r?.step_rubric || null,
                            source: 'cloud',
                            cloud: { filePath }
                        };
                    }).filter(it => it.id);
                    HRMS_STORE.setKnowledge(items);
                        })(),
                        loadKnowledgeGroups()
                    ]);
                } catch (e) {
                    console.error(e);
                    showNotification('知识库同步失败：' + String(e?.message || e), 'warning');
                } finally {
                    renderKnowledgeList();

                    const lastId = getKnowledgeLastViewed();
                    const items2 = HRMS_STORE.getKnowledge();
                    const last = lastId ? items2.find(x => String(x.id) === String(lastId)) : null;
                    if (last && (isAdminUser() || knowledgeItemMatchesUser(last, currentUser))) {
                        openKnowledgeItem(String(last.id));
                    } else {
                        clearKnowledgeViewer();
                    }
                }
            })();
        }

        function hrmsApplyAgentsHeroCopy() {
            try {
                const h2 = document.getElementById('dc-hero-title');
                const sub = document.getElementById('dc-subtitle');
                const eyebrow = document.querySelector('#agents-page .dc-dr-page-head__eyebrow');
                const r = String(currentUser?.role || '').trim();
                if (!h2) return;
                if (r === ROLES.ADMIN) {
                    if (eyebrow) eyebrow.textContent = 'DATA CENTER';
                    h2.textContent = '数据中心';
                    if (sub) sub.textContent = '活动、绩效、同步与健康状态总览。配置与审计请使用 Agent 控制台。';
                } else {
                    if (eyebrow) eyebrow.textContent = 'ASSISTANT';
                    h2.textContent = '智能助手';
                    if (sub) sub.textContent = '门店协同、标准执行与运营问题的智能支持入口。';
                }
            } catch (e) {}
        }

        function setDataCenterTab(tab) {
            try {
                const key = String(tab || 'overview').trim();
                const ok = ['overview', 'activity', 'score', 'audit', 'metrics', 'ops'];
                const k = ok.includes(key) ? key : 'overview';
                document.querySelectorAll('#agents-page.dc-v2 .dc-dr-report-seg__btn').forEach((btn) => {
                    btn.classList.toggle('active', btn.getAttribute('data-dctab') === k);
                });
                document.querySelectorAll('#agents-page.dc-v2 .dc-dr-report-panel').forEach((p) => {
                    p.classList.toggle('is-active', p.id === 'dc-tab-' + k);
                });
            } catch (e) {}
        }

        function loadAgentsData() {
            hrmsApplyAgentsHeroCopy();
            const role = String(currentUser?.role || '').trim();
            const canManageAgents = !!currentUser && (role === ROLES.ADMIN || role === ROLES.HQ_MANAGER || role === ROLES.HR_MANAGER || role.startsWith('custom_'));
            const btnMain = document.getElementById('btn-agents-config-main');
            const btnCard = document.getElementById('btn-agents-config-card');
            const lockTip = document.getElementById('agents-config-lock-tip');
            if (btnMain) btnMain.style.display = canManageAgents ? '' : 'none';
            if (btnCard) btnCard.style.display = canManageAgents ? '' : 'none';
            if (lockTip) lockTip.style.display = canManageAgents ? 'none' : '';
            try {
                const lp = document.getElementById('dc-live-period');
                if (lp && !lp.value) {
                    lp.value = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
                }
            } catch (e) {}
            setDataCenterTab('overview');
            loadDataCenterDashboard();
            if (role === ROLES.ADMIN) loadDataCenterPerformanceAuditRecords();
        }

        async function loadDataCenterDashboard() {
            const hdr = { 'Authorization': 'Bearer ' + (HRMS_API.token ? HRMS_API.token() : '') };
            const role = String(currentUser?.role || '').trim();
            const canBrief = ['admin', 'hq_manager', 'hr_manager'].includes(role);
            const shDefault = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
            const dateInp = document.getElementById('dc-activity-date-input');
            if (dateInp && !dateInp.value) dateInp.value = shDefault;
            const picked = dateInp && dateInp.value && /^\d{4}-\d{2}-\d{2}$/.test(dateInp.value) ? dateInp.value : shDefault;
            const briefUrl = '/api/agents/data-center-brief' + (canBrief ? ('?activityDate=' + encodeURIComponent(picked)) : '');
            const fetches = [
                fetch('/api/health', { headers: hdr }).then(r => r.json()).catch(() => null),
                fetch('/api/agents/dashboard', { headers: hdr }).then(r => r.json()).catch(() => null),
                fetch('/api/agents/bitable-sync', { headers: hdr }).then(r => r.json()).catch(() => null)
            ];
            if (canBrief) fetches.push(fetch(briefUrl, { headers: hdr }).then(r => r.json()).catch(() => null));
            const results = await Promise.allSettled(fetches);
            const health = results[0].status === 'fulfilled' ? results[0].value : null;
            const _dashRaw = results[1].status === 'fulfilled' ? results[1].value : null;
            const dash = (_dashRaw && !_dashRaw.error) ? _dashRaw : null;
            const _syncRaw = results[2].status === 'fulfilled' ? results[2].value : null;
            const sync = (_syncRaw && !_syncRaw.error) ? _syncRaw : null;
            const brief = canBrief && results[3] && results[3].status === 'fulfilled' && !results[3].value?.error ? results[3].value : null;

            const hBar = document.getElementById('dc-health-bar');
            if (hBar && health) {
                const ag = health.agents || {};
                const as = health.agentsService || null;
                const dbOk = health.database === true || health.database === 'ok';
                const schedDelegated = ag.schedulingDelegated === true;
                const schedOk = schedDelegated === true || ag.schedulerRunning === true;
                const schedSub = schedDelegated ? '已委托V2' : '';
                const schedTip = schedDelegated
                    ? '未在 HRMS 本进程跑本地 Agent 定时调度（环境变量 DISABLE_AGENT_SCHEDULING），由 Agent V2 负责调度；红点不代表故障。'
                    : 'HRMS 内 Agent 定时调度（巡检、数据推送等）是否已启动。';
                const llmOk = ag.llmHealthy === true;
                const dotCol = (ok) => (ok ? '#22c55e' : '#ef4444');
                const chip = (ok, label, sub, tip) =>
                    `<span class="dc-chip" title="${tip ? escapeHtml(tip) : ''}"><span class="dc-dot" style="background:${dotCol(ok)};"></span><span>${escapeHtml(label)}${sub ? '<span style="opacity:.72;font-weight:500;margin-left:4px;">' + escapeHtml(sub) + '</span>' : ''}</span></span>`;
                let chips = [
                    chip(dbOk, '数据库', '', ''),
                    chip(schedOk, '调度器', schedSub, schedTip),
                    chip(llmOk, 'LLM', '', '')
                ];
                if (health.disk && !health.disk.error && canBrief) {
                    const d = health.disk;
                    const dLvl = String(d.level || 'ok');
                    const dOk = dLvl === 'ok' || dLvl === 'notice';
                    const dSub = `${d.availGb}/${d.totalGb}GiB`;
                    const dTip = d.message || '';
                    chips.push(
                        `<span class="dc-chip" title="${escapeHtml(dTip)}"><span class="dc-dot" style="background:${dotCol(dOk)};"></span><span>磁盘<span style="opacity:.72;font-weight:500;margin-left:4px;">${escapeHtml(dSub)}</span></span></span>`
                    );
                    if (health.databaseSizeGb != null) {
                        chips.push(
                            `<span class="dc-chip" title="PostgreSQL 当前库体积（约）"><span class="dc-dot" style="background:#22c55e;"></span><span>库<span style="opacity:.72;font-weight:500;margin-left:4px;">${escapeHtml(String(health.databaseSizeGb))}GiB</span></span></span>`
                        );
                    }
                }
                if (as && typeof as === 'object') {
                    const mp = as.mempalace;
                    const wk = as.wikiKnowledge;
                    if (mp && typeof mp === 'object') {
                        const mpOk = mp.reachable === true;
                        const mpHint = mp.enabled ? '已启用' : '未启用';
                        const invT = mp.inventory && mp.inventory.total != null ? String(mp.inventory.total) : '';
                        const sub = mpHint + (invT ? ' · ' + invT + '条' : '');
                        chips.push(`<span class="dc-chip" title="${escapeHtml(String(mp.baseUrl || ''))}"><span class="dc-dot" style="background:${dotCol(mpOk)};"></span><span>MemPalace<span style="opacity:.72;font-weight:500;margin-left:4px;">${escapeHtml(sub)}</span></span></span>`);
                    }
                    if (wk && typeof wk === 'object') {
                        const wkOk = wk.ok === true;
                        const wkN = wk.mdCount != null ? String(wk.mdCount) : '?';
                        const wkDisk = wk.persistence === 'disk' ? '落盘' : '';
                        const wkDs = wk.knowledgeLlmRanking ? '·LLM排序' : '';
                        const wkTitle = 'Wiki' + (wkDisk ? '（' + wkDisk + '）' : '') + wkDs;
                        chips.push(`<span class="dc-chip" title="${escapeHtml(wkTitle)}"><span class="dc-dot" style="background:${dotCol(wkOk)};"></span><span>Wiki<span style="opacity:.72;font-weight:500;margin-left:4px;">${escapeHtml(wkN)}篇</span></span></span>`);
                    }
                }
                hBar.innerHTML =
                    '<span class="dc-h-inner">' +
                    chips.join('') +
                    '<span class="dc-chip-meta">' +
                    escapeHtml(new Date().toLocaleTimeString('zh-CN')) +
                    ' · 45s 刷新</span></span>';
                const hExtra = document.getElementById('dc-health-extra');
                if (hExtra && as && typeof as === 'object') {
                    const bits = [];
                    const wk = as.wikiKnowledge;
                    if (wk && Array.isArray(wk.mdFiles) && wk.mdFiles.length) {
                        const pre = wk.mdFiles.map((f) => escapeHtml(String(f))).join('\n');
                        bits.push(
                            '<details style="cursor:pointer;margin-bottom:8px;"><summary style="color:#cbd5e1;">Wiki 文档明细（' +
                            escapeHtml(String(wk.mdCount != null ? wk.mdCount : wk.mdFiles.length)) +
                            ' 篇）</summary><pre style="margin:8px 0 0;padding:8px;border-radius:8px;background:rgba(2,6,23,0.45);overflow:auto;max-height:200px;white-space:pre-wrap;font-size:10px;color:#94a3b8;">' +
                            pre +
                            '</pre></details>'
                        );
                    } else if (wk && wk.mdCount != null) {
                        bits.push(
                            '<div style="color:#64748b;margin-bottom:6px;">Wiki：共 <strong>' +
                            escapeHtml(String(wk.mdCount)) +
                            '</strong> 篇；当前 agents 健康接口未返回文件名列表，请确认已部署最新 agents-service-v2。</div>'
                        );
                    }
                    const mp = as.mempalace;
                    if (mp && typeof mp === 'object') {
                        if (mp.inventory && Array.isArray(mp.inventory.items) && mp.inventory.items.length) {
                            const blocks = mp.inventory.items.map((it) => {
                                let ts = '—';
                                try {
                                    if (it.timestamp) ts = new Date(it.timestamp).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
                                } catch (e) { /* ignore */ }
                                const pv = escapeHtml(String(it.preview || '').slice(0, 600));
                                const meta =
                                    '#' +
                                    escapeHtml(String(it.seq != null ? it.seq : '')) +
                                    ' · wing ' +
                                    escapeHtml(String(it.wing || '—')) +
                                    ' · room ' +
                                    escapeHtml(String(it.room || '—')) +
                                    ' · ' +
                                    escapeHtml(String(it.type || '—')) +
                                    (it.score != null ? ' · score ' + escapeHtml(String(it.score)) : '');
                                return (
                                    '<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:rgba(2,6,23,0.4);border:1px solid rgba(148,163,184,0.08);">' +
                                    '<div style="color:#94a3b8;font-size:10px;">' +
                                    meta +
                                    '</div>' +
                                    '<div style="color:#64748b;font-size:10px;margin-top:3px;">' +
                                    escapeHtml(ts) +
                                    '</div>' +
                                    '<pre style="margin:6px 0 0;white-space:pre-wrap;font-size:10px;color:#e2e8f0;max-height:140px;overflow:auto;">' +
                                    pv +
                                    (it.truncated ? '\n…' : '') +
                                    '</pre></div>'
                                );
                            });
                            bits.push(
                                '<details style="cursor:pointer;margin-bottom:8px;"><summary style="color:#cbd5e1;">MemPalace 记忆明细（最近 ' +
                                escapeHtml(String(mp.inventory.returned != null ? mp.inventory.returned : mp.inventory.items.length)) +
                                ' 条 · 进程内共 ' +
                                escapeHtml(String(mp.inventory.total != null ? mp.inventory.total : '—')) +
                                ' 条）</summary><div style="margin-top:8px;">' +
                                blocks.join('') +
                                '</div></details>'
                            );
                        } else if (mp.detailHint) {
                            bits.push('<div style="color:#64748b;margin-bottom:6px;">MemPalace：' + escapeHtml(String(mp.detailHint)) + '</div>');
                        }
                    }
                    hExtra.innerHTML = bits.join('');
                    hExtra.style.display = bits.length ? 'block' : 'none';
                } else if (hExtra) {
                    hExtra.innerHTML = '';
                    hExtra.style.display = 'none';
                }
            }

            const actDateEl = document.getElementById('dc-activity-date');
            const actBody = document.getElementById('dc-activity-body');
            if (actDateEl) {
                const sumD = brief?.activitySummaryDate || picked;
                if (brief?.shanghaiDate) {
                    actDateEl.textContent = '今日上海 ' + brief.shanghaiDate + ' · 活动汇总/明细 ' + sumD + (sumD !== brief.shanghaiDate ? '（历史）' : '');
                } else {
                    actDateEl.textContent = '—';
                }
            }
            if (actBody) {
                if (!canBrief) {
                    actBody.innerHTML = '<div style="padding:6px 4px 10px;color:#94a3b8;font-size:13px;line-height:1.55;">当前角色仅展示公开健康状态；完整活动摘要需管理员 / 总部营运 / HR。</div>';
                } else if (!brief) {
                    actBody.innerHTML = '<div style="padding:6px 4px 10px;color:#f87171;font-size:13px;">活动摘要加载失败（请确认已登录且接口可用）</div>';
                } else {
                    const a = brief.activityToday || {};
                    const n = (x) => escapeHtml(String(x ?? 0));
                    actBody.innerHTML = `
                        <div class="dc-kpi-grid">
                            <div class="dc-kpi dc-kpi--a"><div class="dc-kpi-label">任务日志</div><div class="dc-kpi-val">${n(a.agentTaskLogs)}</div></div>
                            <div class="dc-kpi dc-kpi--b"><div class="dc-kpi-label">节奏引擎</div><div class="dc-kpi-val">${n(a.rhythmRuns)}</div></div>
                            <div class="dc-kpi dc-kpi--c"><div class="dc-kpi-label">异常触发</div><div class="dc-kpi-val">${n(a.anomalyTriggers)}</div></div>
                            <div class="dc-kpi dc-kpi--d"><div class="dc-kpi-label">管理告警</div><div class="dc-kpi-val">${n(a.adminAlerts)}</div></div>
                        </div>
                        <p style="margin:12px 4px 0;font-size:11px;color:#64748b;line-height:1.45;">以上为所选上海日历日汇总，与 Agent 控制台「Agent 活动」一致。</p>`;
                }
            }

            const actDetail = document.getElementById('dc-activity-detail');
            if (actDetail) {
                if (!canBrief) {
                    actDetail.innerHTML = '';
                } else {
                    const d0 = brief?.activitySummaryDate || picked;
                    actDetail.innerHTML = '<div style="color:#64748b;padding:4px 0;">加载 ' + escapeHtml(d0) + ' 明细…</div>';
                    try {
                        const dr = await fetch('/api/agents/activity-detail?date=' + encodeURIComponent(d0), { headers: hdr });
                        const dj = await dr.json();
                        if (dj.error) {
                            actDetail.innerHTML = '<span style="color:#ef4444;">' + escapeHtml(String(dj.error)) + '</span>';
                        } else {
                            actDetail.innerHTML = renderDcActivityDetailHtml(dj);
                        }
                    } catch (e) {
                        actDetail.innerHTML = '<span style="color:#ef4444;">活动明细请求失败</span>';
                    }
                }
            }

            const perfBody = document.getElementById('dc-perf-body');
            if (perfBody) {
                if (!dash) {
                    perfBody.innerHTML = '<div style="color:#ef4444;font-size:12px;">绩效摘要加载失败' + (_dashRaw?.error ? ' (' + escapeHtml(String(_dashRaw.error)) + ')' : '') + '</div>';
                } else {
                    const br = brief?.performanceRollup14d || {};
                    const avgBi = br.avgScore != null ? Number(br.avgScore).toFixed(1) : '—';
                    const tiles = [
                        { k: '待处理异常', v: dash.openIssues ?? '—', c: (Number(dash.openIssues) > 0 ? '#f87171' : '#34d399') },
                        { k: '近14天·周度BI均分', v: avgBi, c: '#60a5fa', sub: br.rowCount != null ? br.rowCount + ' 条 rollup' : '' },
                        { k: '30天·仪表盘均分', v: dash.avgScore != null ? Number(dash.avgScore).toFixed(1) : '—', c: '#a78bfa', sub: '含全部 score 模型' },
                        { k: '飞书消息(7天)', v: dash.totalMessages ?? '—', c: '#22d3ee' },
                        { k: '飞书用户', v: dash.totalFeishuUsers ?? '—', c: '#fbbf24' },
                        { k: '视觉审核(30天)', v: dash.totalAudits ?? '—', c: '#c084fc' }
                    ];
                    perfBody.innerHTML = tiles.map(t => `
                        <div class="dc-perf-card">
                            <div class="dc-perf-k">${escapeHtml(t.k)}</div>
                            <div class="dc-perf-v" style="color:${t.c};">${escapeHtml(String(t.v))}</div>
                            ${t.sub ? `<div class="dc-perf-s">${escapeHtml(t.sub)}</div>` : ''}
                        </div>`).join('');
                }
            }

            const alertsBody = document.getElementById('dc-alerts-body');
            if (alertsBody) {
                if (!canBrief || !brief) {
                    alertsBody.innerHTML = '<div style="padding:16px;color:#64748b;font-size:12px;">' + (!canBrief ? '无权限查看管理告警。' : '告警列表加载失败。') + '</div>';
                } else {
                    const rows = brief.adminAlerts || [];
                    if (!rows.length) {
                        alertsBody.innerHTML = '<div style="padding:16px;color:#64748b;font-size:12px;">暂无最近管理告警记录。</div>';
                    } else {
                        alertsBody.innerHTML = rows.map(r => {
                            const pr = String(r.priority || '').toUpperCase();
                            const col = pr === 'A' ? '#f87171' : pr === 'C' ? '#fbbf24' : '#fb923c';
                            return `<div style="padding:10px 18px;border-bottom:1px solid rgba(148,163,184,0.06);font-size:12px;">
                                <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">
                                    <span style="flex-shrink:0;padding:2px 6px;border-radius:4px;background:${col}22;color:${col};font-size:10px;font-weight:700;">${escapeHtml(pr || '—')}</span>
                                    <span style="color:#e2e8f0;font-weight:600;flex:1;min-width:0;">${_dcEsc(r.title)}</span>
                                    <span style="color:#475569;font-size:10px;white-space:nowrap;">${_dcFmtTime(r.sent_at)}</span>
                                </div>
                                <div style="margin-top:4px;color:#64748b;font-size:11px;line-height:1.45;">${_dcEsc(r.body_preview || r.alert_type || '')}</div>
                            </div>`;
                        }).join('');
                    }
                }
            }

            const dw = document.getElementById('dc-dualwrite-strip');
            if (dw) {
                if (brief?.dualWrite) {
                    const sc = (brief.dualWrite.scopes || []).map(s => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border-radius:999px;background:rgba(59,130,246,0.12);color:#93c5fd;font-size:10px;">${_dcEsc(s)}</span>`).join('');
                    dw.innerHTML = `<div style="margin-bottom:6px;">${_dcEsc(brief.dualWrite.summary || '')}</div><div>${sc}</div>`;
                } else {
                    dw.innerHTML = '<span style="color:#64748b;">双写范围说明需管理员加载 data-center-brief。</span>';
                }
            }

            const cronBody = document.getElementById('dc-cron-body');
            if (cronBody) {
                if (!canBrief || !brief || !Array.isArray(brief.cronRuns)) {
                    cronBody.innerHTML = '<div style="padding:8px 6px;color:#64748b;">—</div>';
                } else if (!brief.cronRuns.length) {
                    cronBody.innerHTML = '<div style="padding:8px 6px;color:#64748b;">暂无 cron 运行记录（表未创建或无数据）。</div>';
                } else {
                    cronBody.innerHTML = brief.cronRuns.map(c => {
                        const ok = c.ok === true;
                        const label = c.job_label_zh || c.job_key;
                        const statusZh = ok ? '成功' : _dcEsc(c.error_preview || '失败');
                        const tip = ok ? '' : String(c.error_preview || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid rgba(148,163,184,0.05);">
                            <span style="width:7px;height:7px;border-radius:50%;background:${ok ? '#22c55e' : '#ef4444'};flex-shrink:0;"></span>
                            <span style="flex:1;min-width:0;color:#cbd5e1;">${_dcEsc(label)}</span>
                            <span style="color:#64748b;white-space:nowrap;">${_dcEsc(c.run_ymd || '')}</span>
                            <span style="color:#475569;font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${tip}">${statusZh}</span>
                        </div>`;
                    }).join('');
                }
            }

            const sList = document.getElementById('dc-sync-list');
            if (sList && !sync) {
                sList.innerHTML = '<div style="padding:12px 18px;text-align:center;color:#ef4444;font-size:12px;">同步数据加载失败' + (_syncRaw?.error ? ' (' + escapeHtml(String(_syncRaw.error)) + ')' : '') + '</div>';
            }
            const syncItems = sync?.items || sync?.sources || [];
            if (sList && sync && Array.isArray(syncItems)) {
                if (syncItems.length === 0) {
                    sList.innerHTML = '<div style="padding:12px 18px;text-align:center;color:#64748b;font-size:12px;">暂无数据源</div>';
                } else {
                    sList.innerHTML = syncItems.map(s => {
                        const ago = s.lastSync ? _dcTimeAgo(s.lastSync) : '从未同步';
                        const ok = s.count > 0;
                        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid rgba(148,163,184,0.06);font-size:12px;">
                            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${ok ? '#22c55e' : '#f59e0b'};flex-shrink:0;"></span>
                            <span style="color:#e2e8f0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_dcEsc(s.name)}</span>
                            <span style="color:#64748b;white-space:nowrap;">${s.count}条</span>
                            <span style="color:#475569;white-space:nowrap;">${ago}</span>
                        </div>`;
                    }).join('');
                }
            } else if (sList) {
                sList.innerHTML = '<div style="padding:12px 18px;text-align:center;color:#64748b;font-size:12px;">无法获取同步状态</div>';
            }
        }

        /** 节奏引擎 result_summary：JSON → 分行中文，避免表格里出现整段 JSON */
        function dcFormatRhythmSummary(raw) {
            if (raw == null || raw === '') return '—';
            let obj = null;
            if (typeof raw === 'object') {
                obj = raw;
            } else {
                const s = String(raw).trim();
                if (!s) return '—';
                try {
                    obj = JSON.parse(s);
                } catch (_) {
                    const trig = s.match(/"triggered"\s*:\s*(\d+)/);
                    if (trig) return '已解析到触发统计 ' + trig[1] + '（摘要 JSON 不完整，已扩大服务端返回长度；若仍异常请查库 rhythm_logs.result_summary）';
                    return s.length > 220 ? s.slice(0, 220) + '…' : s;
                }
            }
            if (!obj || typeof obj !== 'object') return '—';
            const lines = [];
            if (obj.triggered != null) lines.push('触发记录数：' + String(obj.triggered));
            if (Array.isArray(obj.kpiByStore) && obj.kpiByStore.length) {
                const arr = obj.kpiByStore;
                lines.push('门店指标（共 ' + arr.length + ' 家）：');
                const max = 12;
                for (let i = 0; i < Math.min(arr.length, max); i++) {
                    const k = arr[i] || {};
                    const name = String(k.store || k.store_name || '—').trim();
                    const bits = [];
                    if (k.total_tasks != null) bits.push('任务 ' + k.total_tasks);
                    if (k.closed_tasks != null) bits.push('闭环 ' + k.closed_tasks);
                    if (k.avg_ttc != null) bits.push('均出餐 ' + String(k.avg_ttc).replace(/(\.\d{1,4})\d+/, '$1'));
                    if (k.avg_ttfr != null) bits.push('首单 ' + String(k.avg_ttfr).replace(/(\.\d{1,4})\d+/, '$1'));
                    if (k.avg_timeout != null) bits.push('超时均 ' + String(k.avg_timeout).replace(/(\.\d{1,4})\d+/, '$1'));
                    lines.push(' · ' + name + (bits.length ? '：' + bits.join('，') : ''));
                }
                if (arr.length > max) lines.push(' · … 其余 ' + (arr.length - max) + ' 家已折叠');
            }
            if (obj.scanned != null) lines.push('扫描条数：' + obj.scanned);
            if (obj.issuesFound != null) lines.push('问题数：' + obj.issuesFound);
            if (obj.detail) lines.push(String(obj.detail).slice(0, 240));
            if (!lines.length) {
                try {
                    const j = JSON.stringify(obj);
                    return j.length > 200 ? j.slice(0, 200) + '…' : j;
                } catch (e) { return '—'; }
            }
            return lines.join('\n');
        }

        function renderDcActivityDetailHtml(dj) {
            const ANOM_KEY_ZH = {
                revenue_achievement: '实收营收异常',
                revenue_achievement_monthly: '月度实收营收异常',
                labor_efficiency: '人效值异常',
                recharge_zero: '充值异常',
                table_visit_product: '桌访产品异常',
                table_visit_ratio: '桌访占比异常',
                gross_margin: '总实收毛利率异常',
                bad_review_product: '差评产品异常',
                bad_review_service: '差评服务异常',
                hongchao_jiuguang_private_room: '洪潮久光包房使用',
                food_safety: '食品安全异常'
            };
            const RHYTHM_TYPE_ZH = {
                weekly_report: '周报',
                daily_report: '日报',
                rhythm_engine: '节奏引擎',
                monthly_report: '月报',
                bi_weekly: '双周报',
                anomaly_scan: '异常扫描',
                rollup: '汇总'
            };
            const SEV_ZH = { high: '高', medium: '中', low: '低' };
            const TRIG_STATUS_ZH = {
                open: '待结案',
                closed: '已闭环',
                pending_data: '待数据',
                superseded: '已替代',
                resolved: '已处理'
            };
            const cellStr = (r, c) => {
                let v = r[c.key];
                if (c.key === 'result_summary') return dcFormatRhythmSummary(v);
                if (c.map === 'anomaly_key') v = ANOM_KEY_ZH[String(v || '').trim()] || v;
                if (c.map === 'rhythm_type') v = RHYTHM_TYPE_ZH[String(v || '').trim()] || v;
                if (c.map === 'severity') v = SEV_ZH[String(v || '').toLowerCase()] || v;
                if (c.map === 'trig_status') v = TRIG_STATUS_ZH[String(v || '').toLowerCase()] || v;
                if (c.fmt === 'sh') {
                    const t = _dcFmtTime(v);
                    return t || '—';
                }
                if (v == null || v === '') return '—';
                if (typeof v === 'object') {
                    try {
                        const s = JSON.stringify(v);
                        return s.length > 200 ? s.slice(0, 197) + '…' : s;
                    } catch (_) { return '[object]'; }
                }
                const sv = String(v);
                return sv.length > 200 ? sv.slice(0, 197) + '…' : sv;
            };
            const sec = (title, rows, cols) => {
                if (!rows || !rows.length) {
                    return `<div class="dc-act-sec"><div class="dc-act-sec-title">${escapeHtml(title)}<span class="dc-act-count">0</span></div><div style="color:#64748b;font-size:12px;padding:2px 0 8px;">暂无</div></div>`;
                }
                const th = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
                const trs = rows
                    .map((r) => {
                        const tds = cols
                            .map((c) => {
                                const raw = cellStr(r, c);
                                const cls = c.key === 'result_summary' ? 'dc-td-summary' : (c.nowrap ? 'dc-td-nowrap' : '');
                                return `<td${cls ? ` class="${cls}"` : ''}>${_dcEsc(raw)}</td>`;
                            })
                            .join('');
                        return `<tr>${tds}</tr>`;
                    })
                    .join('');
                return `<div class="dc-act-sec"><div class="dc-act-sec-title">${escapeHtml(title)}<span class="dc-act-count">${rows.length}</span></div><div class="dc-table-scroll"><table class="dc-data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div></div>`;
            };
            const MASTER_ST_ZH = {
                closed: '已结案',
                open: '待处理',
                pending: '待处理',
                dispatched: '已派发',
                cancelled: '已取消',
                resolved: '已解决',
                in_progress: '进行中'
            };
            const secMasterTasks = (rows) => {
                if (!rows || !rows.length) {
                    return `<div class="dc-act-sec"><div class="dc-act-sec-title">调度任务<span class="dc-act-count">0</span></div><div style="color:#64748b;font-size:12px;padding:2px 0 8px;">暂无</div></div>`;
                }
                const cards = rows.map((r) => {
                    const tid = escapeHtml(String(r.task_id || '—'));
                    const title = escapeHtml(String(r.title || '').trim() || '—');
                    const store = escapeHtml(String(r.store || '').trim() || '—');
                    const assignee = escapeHtml(String(r.assignee_name || r.assignee_username || '—'));
                    const rawSt = String(r.status || '').trim().toLowerCase();
                    const stZh = MASTER_ST_ZH[rawSt] || String(r.status || '—').trim() || '—';
                    const stDisp = escapeHtml(stZh);
                    let badgeClass = 'dc-mt-badge dc-mt-badge--muted';
                    if (rawSt === 'closed' || rawSt === 'resolved') badgeClass = 'dc-mt-badge';
                    else if (rawSt === 'open' || rawSt === 'pending' || rawSt === 'dispatched' || rawSt === 'in_progress') badgeClass = 'dc-mt-badge dc-mt-badge--open';
                    const d1 = escapeHtml(_dcFmtTime(r.dispatched_at) || '—');
                    const d2 = escapeHtml(_dcFmtTime(r.created_at) || '—');
                    const d3 = escapeHtml(_dcFmtTime(r.resolved_at) || '—');
                    return `<article class="dc-mt-card"><div class="dc-mt-card-head"><div class="dc-mt-body"><div class="dc-mt-id">${tid}</div><div class="dc-mt-title">${title}</div><div class="dc-mt-store">${store}</div></div><span class="${badgeClass}">${stDisp}</span></div><div class="dc-mt-grid"><div><div class="k">责任人</div><div class="v">${assignee}</div></div><div><div class="k">派发（沪）</div><div class="v">${d1}</div></div><div><div class="k">创建（沪）</div><div class="v">${d2}</div></div><div><div class="k">结案（沪）</div><div class="v">${d3}</div></div></div></article>`;
                }).join('');
                return `<div class="dc-act-sec"><div class="dc-act-sec-title">调度任务<span class="dc-act-count">${rows.length}</span></div><div class="dc-mt-list">${cards}</div></div>`;
            };
            const legend =
                '<details class="dc-doc" style="margin:0 0 14px 2px;border-radius:12px;border:1px dashed rgba(148,163,184,0.2);background:rgba(2,6,23,0.28);">' +
                '<summary style="cursor:pointer;padding:10px 12px;font-size:12px;font-weight:600;color:#94a3b8;list-style:none;">列说明：触发日、落库、状态码（展开）</summary>' +
                '<div class="dc-doc-body" style="border-top:1px solid rgba(148,163,184,0.08);">「触发日」= 本条判定所指的<strong>营业日日历</strong>（充值：该日日报充值为 0 才记一条）。「落库」= 写入数据库时刻。充值绩效分：<strong>落库当日即重算</strong>当周汇总行，周一 08:25 再全量跑一遍。状态 <code style="font-size:10px;">open</code> / <code style="font-size:10px;">closed</code> 均参与扣分汇总；飞书结案后会标 <code style="font-size:10px;">closed</code>。</div>' +
                '</details>';
            return (
                legend +
                sec('任务日志', dj.taskLogs, [
                    { label: 'Agent', key: 'agent', nowrap: true },
                    { label: '门店', key: 'store' },
                    { label: '责任人', key: 'display_name', nowrap: true },
                    { label: 'ms', key: 'latency_ms', nowrap: true },
                    { label: '时间(沪)', key: 'created_at', fmt: 'sh', nowrap: true }
                ]) +
                sec('异常触发', dj.anomalyTriggers, [
                    { label: '门店', key: 'store' },
                    { label: '类型', key: 'anomaly_key', map: 'anomaly_key', nowrap: true },
                    { label: '级别', key: 'severity', map: 'severity', nowrap: true },
                    { label: '触发日', key: 'trigger_date', nowrap: true },
                    { label: '落库(沪)', key: 'created_at', fmt: 'sh', nowrap: true },
                    { label: '状态', key: 'status', map: 'trig_status', nowrap: true }
                ]) +
                sec('节奏引擎', dj.rhythmLogs, [
                    { label: '类型', key: 'rhythm_type', map: 'rhythm_type', nowrap: true },
                    { label: '状态', key: 'status', nowrap: true },
                    { label: '业务日', key: 'execution_date', nowrap: true },
                    { label: '执行(沪)', key: 'created_at', fmt: 'sh', nowrap: true },
                    { label: '摘要', key: 'result_summary' }
                ]) +
                secMasterTasks(dj.masterTasks)
            );
        }

        /** 数据中心·绩效扣分 JSON → 中文展示（与 agents 周汇总/食安判罚字段对齐） */
        function dcScoreModelLabelZh(model) {
            const m = {
                anomaly_rollups_v2: '周度BI异常汇总',
                new_model_monthly: '月度绩效（新模型）',
                new_model: '绩效模型（新）',
                anomaly_item_monthly_bonus: '月度未触发异常加分'
            };
            const k = String(model || '').trim();
            return m[k] || k;
        }
        function dcDeductionCategoryZh(cat) {
            const map = {
                revenue_anomaly: '营收/实收异常',
                efficiency_anomaly: '人效异常',
                recharge_anomaly: '充值异常',
                table_visit_anomaly: '桌访相关异常',
                table_visit_ratio_anomaly: '桌访占比异常',
                margin_anomaly: '毛利异常',
                product_review: '产品差评异常',
                service_review: '服务差评异常',
                private_room_anomaly: '包房使用异常',
                food_safety: '食品安全（含总部判罚）'
            };
            const c = String(cat || '').trim();
            return map[c] || c;
        }
        function dcDeductionAnomalyKeyZh(key) {
            const map = {
                revenue_achievement: '实收营收异常',
                labor_efficiency: '人效值异常',
                recharge_zero: '充值异常',
                table_visit_product: '桌访产品异常',
                table_visit_ratio: '桌访占比异常',
                gross_margin: '总实收毛利率异常',
                bad_review_product: '差评产品异常',
                bad_review_service: '差评服务异常',
                hongchao_jiuguang_private_room: '洪潮久光包房使用异常',
                food_safety: '食品安全异常'
            };
            const k = String(key || '').trim();
            return map[k] || k;
        }
        function dcDeductionSeverityZh(sev) {
            const s = String(sev || '').trim().toLowerCase();
            if (s === 'high') return '高';
            if (s === 'medium') return '中';
            if (s === 'low') return '低';
            if (s === 'mixed') return '混合';
            return sev || '—';
        }
        function dcDeductionExtraZh(obj) {
            const parts = [];
            if (obj.task_id) parts.push('关联任务 ' + String(obj.task_id));
            const src = String(obj.source || '').trim();
            if (src === 'hq_ruling') parts.push('来源：总部判罚');
            else if (src) parts.push('来源：' + src);
            return parts.length ? parts.join(' · ') : '';
        }
        function perfAuditMasterSourceZh(src) {
            const map = {
                random_inspection: '随机抽检',
                scheduled_inspection: '定时巡检',
                bi_anomaly: 'BI异常',
                auto_collab: '自动协同',
                data_auditor: '数据稽核'
            };
            const k = String(src || '').trim();
            return map[k] || k;
        }
        function perfAuditDeductionLabelZh(raw) {
            const s = String(raw || '').trim();
            if (!s) return '';
            const a = dcDeductionCategoryZh(s);
            if (a && a !== s) return a;
            return dcDeductionAnomalyKeyZh(s);
        }
        function formatDcDeductionsPreview(raw) {
            const t = String(raw || '').trim();
            if (!t) return '';
            let parsed;
            try {
                parsed = JSON.parse(t);
            } catch (_e) {
                return (
                    '<pre style="margin:6px 0 0;font-size:9px;color:#64748b;white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto;">' +
                    _dcEsc(t) +
                    '</pre>'
                );
            }
            const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
            if (!items.length) {
                return (
                    '<pre style="margin:6px 0 0;font-size:9px;color:#64748b;white-space:pre-wrap;word-break:break-word;max-height:140px;overflow:auto;">' +
                    _dcEsc(t) +
                    '</pre>'
                );
            }
            return (
                '<div style="margin:6px 0 0;font-size:10px;color:#94a3b8;line-height:1.45;">' +
                items
                    .map((obj) => {
                        if (!obj || typeof obj !== 'object') {
                            return (
                                '<div style="margin-top:4px;padding:6px;border-radius:6px;background:rgba(30,41,59,0.35);">' +
                                _dcEsc(JSON.stringify(obj)) +
                                '</div>'
                            );
                        }
                        const pts = obj.points != null ? '<span style="color:#fbbf24;">扣 ' + escapeHtml(String(obj.points)) + ' 分</span>' : '';
                        const cat = escapeHtml(dcDeductionCategoryZh(obj.category));
                        const rule = escapeHtml(dcDeductionAnomalyKeyZh(obj.anomaly_key));
                        const sev = escapeHtml(dcDeductionSeverityZh(obj.severity));
                        const extra = dcDeductionExtraZh(obj);
                        const note = obj.detail_note ? _dcEsc(String(obj.detail_note).slice(0, 280)) : '';
                        return (
                            '<div style="margin-top:6px;padding:8px;border-radius:8px;background:rgba(30,41,59,0.45);border-left:3px solid rgba(96,165,250,0.45);">' +
                            '<div>' +
                            pts +
                            (pts ? ' · ' : '') +
                            '<span style="color:#e2e8f0;">' +
                            cat +
                            '</span> · <span style="color:#64748b;">规则 ' +
                            rule +
                            '</span> · <span style="color:#64748b;">严重度 ' +
                            sev +
                            '</span></div>' +
                            (extra
                                ? '<div style="margin-top:4px;font-size:9px;color:#64748b;">' + escapeHtml(extra) + '</div>'
                                : '') +
                            (note ? '<div style="margin-top:4px;font-size:9px;color:#94a3b8;">' + note + '</div>' : '') +
                            '</div>'
                        );
                    })
                    .join('') +
                '</div>'
            );
        }

        async function loadDcScoreProvenance(pickUsername) {
            const hdr = { Authorization: 'Bearer ' + (HRMS_API.token ? HRMS_API.token() : '') };
            const inp = document.getElementById('dc-prov-username');
            const out = document.getElementById('dc-prov-results');
            if (!inp || !out) return;
            if (pickUsername) inp.value = String(pickUsername);
            const u = String(inp.value || '').trim();
            if (!u) {
                __dcProvWatchUser = null;
                out.innerHTML = '<span style="color:#fbbf24;">请输入姓名或飞书账号</span>';
                return;
            }
            out.innerHTML = '<span style="color:#64748b;">查询中…</span>';
            try {
                const r = await fetch('/api/agents/score-provenance?q=' + encodeURIComponent(u) + '&limit=35', { headers: hdr });
                const j = await r.json();
                if (r.status === 409 && j.candidates && j.candidates.length) {
                    const btns = j.candidates
                        .map((c) => {
                            const uj = escapeHtml(String(c.username || ''));
                            return `<button type="button" class="btn btn-secondary" style="margin:4px 6px 0 0;padding:4px 10px;font-size:11px;" data-click="loadDcScoreProvenance" data-arg="${uj}">${escapeHtml(
                                String(c.name || '')
                            )} <span style="color:#64748b;">(${escapeHtml(String(c.username || ''))})</span></button>`;
                        })
                        .join('');
                    out.innerHTML =
                        '<div style="color:#fbbf24;margin-bottom:8px;">' +
                        escapeHtml(String(j.message || '多名匹配，请点选账号')) +
                        '</div>' +
                        btns;
                    __dcProvWatchUser = null;
                    return;
                }
                if (j.error) {
                    __dcProvWatchUser = null;
                    out.innerHTML =
                        '<span style="color:#ef4444;">' +
                        escapeHtml(String(j.message || j.error)) +
                        '</span>';
                    return;
                }
                const head =
                    j.resolvedName || j.username
                        ? `<div style="color:#94a3b8;margin-bottom:8px;">已解析：<strong style="color:#e2e8f0;">${escapeHtml(
                              String(j.resolvedName || j.username || '')
                          )}</strong> <span style="color:#64748b;">(${escapeHtml(String(j.username || ''))})</span></div>`
                        : '';
                const scores = (j.scores || [])
                    .map((s) => {
                        const modelZh = escapeHtml(dcScoreModelLabelZh(s.score_model));
                        return `<div style="margin-bottom:10px;padding:8px;border-radius:8px;background:rgba(2,6,23,0.35);border:1px solid rgba(148,163,184,0.1);">
                        <div style="color:#cbd5e1;font-weight:600;">${modelZh} · ${escapeHtml(s.period || '')}</div>
                        <div style="color:#60a5fa;margin-top:2px;">总分 <strong>${escapeHtml(String(s.total_score != null ? s.total_score : '—'))}</strong>${s.store ? ' · ' + escapeHtml(s.store) : ''}</div>
                        ${s.summary ? `<div style="margin-top:4px;color:#94a3b8;">${_dcEsc(s.summary)}</div>` : ''}
                        ${s.deductions_preview ? formatDcDeductionsPreview(s.deductions_preview) : ''}
                        <div style="font-size:9px;color:#475569;margin-top:2px;">${_dcEsc(String(s.updated_at || ''))}</div>
                    </div>`;
                    })
                    .join('');
                const notes = (j.notifications || [])
                    .map(
                        (n) =>
                            `<div style="margin-bottom:6px;padding:6px;border-radius:6px;background:rgba(30,41,59,0.4);">
                    <span style="color:#a78bfa;">${escapeHtml(n.type || '')}</span> <span style="color:#e2e8f0;">${_dcEsc(n.title || '')}</span>
                    <div style="color:#64748b;font-size:10px;margin-top:2px;">${_dcEsc(n.message_preview || '')}</div>
                </div>`
                    )
                    .join('');
                out.innerHTML =
                    head +
                    '<div style="color:#94a3b8;font-weight:600;margin-bottom:6px;">绩效分记录（绩效分表 <code style="font-size:10px;">agent_scores</code>）</div>' +
                    (scores || '<div style="color:#475569;">无记录</div>') +
                    '<div style="color:#94a3b8;font-weight:600;margin:14px 0 6px;">公司通知 / 备案（库表 <code style="font-size:10px;">hrms_user_notifications</code>）</div>' +
                    (notes || '<div style="color:#475569;">无记录</div>');
                __dcProvWatchUser = String(j.username || '').trim() || null;
                try { loadDcEmployeeLiveDashboard(__dcProvWatchUser); } catch (e2) {}
            } catch (e) {
                __dcProvWatchUser = null;
                out.innerHTML = '<span style="color:#ef4444;">加载失败</span>';
            }
        }

        function renderDcLiveDashboardError(msg) {
            const out = document.getElementById('dc-live-dashboard-body');
            if (out) out.innerHTML = '<div style="font-size:12px;color:#f87171;">' + escapeHtml(String(msg || '加载失败')) + '</div>';
        }

        function renderDcLiveDashboardFromJson(j) {
            const out = document.getElementById('dc-live-dashboard-body');
            const asof = document.getElementById('dc-live-asof');
            if (!out) return;
            if (asof) {
                asof.textContent = j.as_of_shanghai ? `数据截止（沪）：${j.as_of_shanghai}` : '';
            }
            const dedN = Number(j.month_bi_deducted_total);
            const dedDisp = Number.isFinite(dedN) ? dedN.toFixed(1) : '—';
            const scoreN = Number(j.latest_performance_score);
            let scoreDisp = '—';
            if (Number.isFinite(scoreN)) scoreDisp = scoreN.toFixed(1);
            else if (Number.isFinite(dedN)) scoreDisp = (100 - dedN).toFixed(1);
            const srcP = j.rollup_breakdown_source_period ? escapeHtml(String(j.rollup_breakdown_source_period)) : '';
            const empRows = Array.isArray(j.employee_scores_rows) ? j.employee_scores_rows : [];
            const empLine = empRows.length
                ? empRows.map((r) => `月度表 ${escapeHtml(r.store || '')}·${escapeHtml(r.role || '')}：<strong>${escapeHtml(String(r.total_score != null ? r.total_score : '—'))}</strong>（执行力 ${escapeHtml(String(r.execution_rating || '—'))}）`).join('<br>')
                : '<span style="color:#64748b;">月度 employee_scores 尚无该月行（可能未到关账）</span>';
            const lw = j.latest_weekly_anomaly_row;
            const lwLine = lw
                ? `最新周汇总行 total_score：<strong>${escapeHtml(String(lw.total_score != null ? Number(lw.total_score).toFixed(1) : '—'))}</strong> · ${escapeHtml(String(lw.period || ''))}`
                : '暂无周汇总行';
            const who = `${escapeHtml(String(j.resolvedName || j.username || ''))} <span style="color:#64748b;">(${escapeHtml(String(j.username || ''))})</span>`;
            const dedSub = srcP ? `数据取自该月内最近更新的周行 <code style="font-size:9px;">${srcP}</code> 的 breakdown。` : '该统计月内暂无有效 BI 周汇总行，已扣分数按 0。';
            out.innerHTML =
                '<div class="dc-live-who">' + who + ' · 统计月 <strong style="color:#e2e8f0;">' + escapeHtml(String(j.period || '')) + '</strong></div>' +
                '<div class="dc-live-hero">' +
                '<div class="dc-live-hero-card dc-live-hero-card--ded">' +
                '<div class="dc-live-hero-k">本月已扣分数</div>' +
                '<div class="dc-live-hero-v">' + escapeHtml(dedDisp) + '</div>' +
                '<div class="dc-live-hero-s">BI 统计月内系统累计扣分（周行 JSON「本月累计扣分」）。' + dedSub + '</div>' +
                '</div>' +
                '<div class="dc-live-hero-card dc-live-hero-card--score">' +
                '<div class="dc-live-hero-k">最新绩效得分</div>' +
                '<div class="dc-live-hero-v">' + escapeHtml(scoreDisp) + '</div>' +
                '<div class="dc-live-hero-s">按 <strong>100 − 本月已扣分数</strong> 计算，便于与满分对齐理解。</div>' +
                '</div></div>' +
                '<div class="dc-live-sec-head">备案与能力</div>' +
                '<div class="dc-live-secondary">' +
                '<div class="dc-kpi dc-kpi--c"><div class="dc-kpi-label">执行力备案数</div><div class="dc-kpi-val">' + escapeHtml(String(j.execution_filing_count ?? 0)) + '</div><div class="dc-kpi-s">ops_tasks · execution_rating_daily</div></div>' +
                '<div class="dc-kpi dc-kpi--d"><div class="dc-kpi-label">态度备案数</div><div class="dc-kpi-val">' + escapeHtml(String(j.attitude_filing_count ?? 0)) + '</div><div class="dc-kpi-s">master_tasks · hr_performance_record</div></div>' +
                '<div class="dc-kpi dc-kpi--a"><div class="dc-kpi-label">能力备案数</div><div class="dc-kpi-val">' + escapeHtml(String(j.ability_filing_count ?? 0)) + '</div><div class="dc-kpi-s">' + escapeHtml(String(j.ability_filing_note || '')) + '</div></div>' +
                '</div>' +
                '<div class="dc-live-foot">' + empLine + '<div style="margin-top:10px;color:#94a3b8;">' + lwLine + '</div></div>';
        }

        async function loadDcEmployeeLiveDashboard(pickUsername) {
            const hdr = { Authorization: 'Bearer ' + (HRMS_API.token ? HRMS_API.token() : '') };
            const inp = document.getElementById('dc-prov-username');
            const per = document.getElementById('dc-live-period');
            const out = document.getElementById('dc-live-dashboard-body');
            if (!inp || !out) return;
            const u = String(pickUsername || inp.value || '').trim();
            if (!u) {
                out.innerHTML = '<div style="font-size:12px;color:#fbbf24;">请先在下方「个人绩效分由来」输入姓名或飞书账号。</div>';
                const asof = document.getElementById('dc-live-asof');
                if (asof) asof.textContent = '';
                return;
            }
            let period = String(per?.value || '').trim();
            if (!period) {
                period = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
                if (per) per.value = period;
            }
            out.innerHTML = '<div style="color:#64748b;">看板加载中…</div>';
            try {
                const qs = new URLSearchParams({ q: u, period });
                const r = await fetch('/api/agents/employee-live-dashboard?' + qs.toString(), { headers: hdr });
                const j = await r.json();
                if (r.status === 409 && j.candidates && j.candidates.length) {
                    const btns = j.candidates
                        .map((c) => {
                            const uj = escapeHtml(String(c.username || ''));
                            return `<button type="button" class="btn btn-secondary" style="margin:4px 6px 0 0;padding:4px 10px;font-size:11px;" data-click="loadDcScoreProvenance" data-arg="${uj}">${escapeHtml(String(c.name || ''))} <span style="color:#64748b;">(${escapeHtml(String(c.username || ''))})</span></button>`;
                        })
                        .join('');
                    out.innerHTML =
                        '<div style="color:#fbbf24;margin-bottom:8px;">' + escapeHtml(String(j.message || '多名匹配')) + '</div>' + btns;
                    return;
                }
                if (!r.ok || j.error) {
                    renderDcLiveDashboardError(j.message || j.error || '加载失败');
                    return;
                }
                renderDcLiveDashboardFromJson(j);
            } catch (e) {
                renderDcLiveDashboardError(e?.message || e);
            }
        }

        function _dcFmtTime(iso) {
            try {
                if (!iso) return '';
                const d = new Date(iso);
                return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
            } catch (e) { return ''; }
        }

        function _dcEsc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        function _dcTimeAgo(iso) {
            try {
                const diff = Date.now() - new Date(iso).getTime();
                if (diff < 60000) return '刚刚';
                if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
                if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
                return Math.floor(diff / 86400000) + '天前';
            } catch { return ''; }
        }

        function applyKnowledgeFiltersVisibility() {
            const isAdmin = isAdminUser();
            const box = document.getElementById('kb-admin-filters');
            if (box) box.style.display = isAdmin ? 'flex' : 'none';

            // For non-admin: fixed identity, no need to expose these filters.
            if (!isAdmin) {
                const aud = document.getElementById('knowledge-filter-audience');
                const store = document.getElementById('knowledge-filter-store');
                const pos = document.getElementById('knowledge-filter-position');
                if (aud) aud.value = 'mine';
                if (store) store.value = '';
                if (pos) pos.value = '';
            }
        }

        function getKnowledgeFilterStateKey() {
            const uname = currentUser?.username || 'anonymous';
            return `HRMS_KB_FILTERS_${uname}`;
        }

        function getKnowledgeFilterState() {
            try {
                const raw = localStorage.getItem(getKnowledgeFilterStateKey());
                const parsed = raw ? JSON.parse(raw) : null;
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        function setKnowledgeFilterState(state) {
            try {
                localStorage.setItem(getKnowledgeFilterStateKey(), JSON.stringify(state || {}));
            } catch (e) {
                // ignore
            }
        }

        function setKnowledgeTab(tab) {
            const t = String(tab || 'all');
            const st = getKnowledgeFilterState();
            st.tab = t;
            setKnowledgeFilterState(st);

            ['kb-tab-all','kb-tab-video','kb-tab-doc'].forEach(id => {
                const btn = document.getElementById(id);
                if (!btn) return;
                // V2 tabs use kb-v2-ttab + active
                btn.classList.remove('btn','btn-secondary');
                btn.classList.add('kb-v2-ttab');
                const tabMap = { 'kb-tab-all': 'all', 'kb-tab-video': 'video', 'kb-tab-doc': 'doc' };
                if (tabMap[id] === t) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            renderKnowledgeList();
        }

        function setKbCategory(cat) {
            const st = getKnowledgeFilterState();
            st.category = String(cat || '');
            setKnowledgeFilterState(st);
            renderKbCategoryBar();
            renderKnowledgeList();
        }

        function getKbCategoryOptions() {
            return ['岗位SOP', '产品培训', '入职培训', '考核标准', '公司制度', '模板文档'];
        }

        // 分类图标映射
        const KB_CATEGORY_ICON = {
            '岗位SOP': '📋',
            '产品培训': '🍽️',
            '入职培训': '🎓',
            '考核标准': '📐',
            '公司制度': '🏢',
            '模板文档': '📁',
        };

        function renderKbCategoryBar() {
            const bar = document.getElementById('kb-category-bar');
            if (!bar) return;
            const st = getKnowledgeFilterState();
            const active = String(st.category || '');

            const allItems = HRMS_STORE.getKnowledge();
            const items = isAdminUser() ? allItems : (allItems || []).filter(it => knowledgeItemMatchesUser(it, currentUser));
            const catsInData = new Set((items || []).map(it => String(it?.category || '').trim()).filter(Boolean));
            const base = getKbCategoryOptions();
            const cats = base.filter(c => catsInData.size ? catsInData.has(c) : true);

            const btnHtml = (label, value) => {
                const isOn = String(value || '') === active;
                const cls = isOn ? 'btn' : 'btn btn-secondary';
                return `<button class="${cls}" type="button" data-click="setKbCategory" data-arg="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
            };

            const parts = [btnHtml('全部分类', '')].concat(cats.map(c => btnHtml(c, c)));
            bar.innerHTML = parts.join('');
        }

        function applyKnowledgeFilterState() {
            const st = getKnowledgeFilterState();
            const tab = String(st.tab || 'all');
            setKnowledgeTab(tab);

            const setVal = (id, v) => {
                const el = document.getElementById(id);
                if (!el) return;
                if (v === undefined || v === null) return;
                el.value = String(v);
            };

            setVal('knowledge-search', st.q || '');
            setVal('knowledge-filter-audience', st.audMode || 'mine');
            setVal('knowledge-filter-store', st.store || '');
            setVal('knowledge-filter-position', st.position || '');
            setVal('knowledge-filter-brand', st.brandId || '');
        }

        function resetKnowledgeFilters() {
            setKnowledgeFilterState({ tab: 'all', category: '', brandId: '' });
            applyKnowledgeFilterState();
            renderKbCategoryBar();
            renderKnowledgeList();
        }

        function populateKnowledgeFilterOptions() {
            const storeSel = document.getElementById('knowledge-filter-store');
            const posSel = document.getElementById('knowledge-filter-position');
            if (!storeSel || !posSel) return;

            const allItems = HRMS_STORE.getKnowledge();
            const items = isAdminUser() ? allItems : (allItems || []).filter(it => knowledgeItemMatchesUser(it, currentUser));
            const stores = new Set();
            const positions = new Set();
            items.forEach(it => {
                const aud = it?.audience || {};
                if (aud.type === 'store' && aud.store) stores.add(String(aud.store));
                if (aud.type === 'position' && aud.position) positions.add(String(aud.position));
            });
            if (currentUser?.store) stores.add(String(currentUser.store));
            if (currentUser?.position) positions.add(String(currentUser.position));

            const st = getKnowledgeFilterState();
            const selectedStore = String(st.store || storeSel.value || '');
            const selectedPos = String(st.position || posSel.value || '');

            const buildOptions = (values, firstText) => {
                const arr = Array.from(values).sort((a, b) => String(a).localeCompare(String(b)));
                return [`<option value="">${escapeHtml(firstText)}</option>`]
                    .concat(arr.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`))
                    .join('');
            };

            storeSel.innerHTML = buildOptions(stores, '全部门店');
            posSel.innerHTML = buildOptions(positions, '全部岗位');

            const st2 = getKnowledgeFilterState();
            populateKnowledgeFilterBrandOptions(st2.brandId || '');

            storeSel.value = selectedStore;
            posSel.value = selectedPos;
        }

        function escapeHtml(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function toBeijingTime(isoStr) {
            const s = String(isoStr || '').trim();
            if (!s) return '';
            try {
                const d = new Date(s);
                if (isNaN(d.getTime())) return s.slice(0, 19).replace('T', ' ');
                return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-');
            } catch (e) { return s.slice(0, 19).replace('T', ' '); }
        }

        function hrmsDisplayName(username) {
            const u = String(username || '').trim();
            if (!u) return '-';
            const uLower = u.toLowerCase();
            try {
                const users = HRMS_STORE.getUsers() || [];
                const employees = HRMS_STORE.getEmployees() || [];
                const found = users.find(x => String(x?.username || '').trim().toLowerCase() === uLower)
                    || employees.find(x => String(x?.username || '').trim().toLowerCase() === uLower);
                if (found) {
                    const name = String(found.name || '').trim();
                    if (name) return name;
                }
            } catch (e) {}
            return u;
        }

        function hrmsLookupUserRecord(username) {
            const u = String(username || '').trim();
            if (!u) return null;
            const uLower = u.toLowerCase();
            try {
                const users = HRMS_STORE.getUsers() || [];
                const employees = HRMS_STORE.getEmployees() || [];
                return users.find(x => String(x?.username || '').trim().toLowerCase() === uLower)
                    || employees.find(x => String(x?.username || '').trim().toLowerCase() === uLower)
                    || null;
            } catch (e) { return null; }
        }

        // Populate the promotion-approval "带教人" select with active employees from the applicant's store,
        // preferring production-manager/management roles. Falls back to all active employees of the store
        // if no role match is found, so the store manager is never left with an empty list.
        function promoPopulateMentorSelect(item) {
            const sel = document.getElementById('promotion-mentor-username-input');
            const nameInput = document.getElementById('promotion-mentor-name-input');
            if (!sel) return;
            try {
                const applicantRec = hrmsLookupUserRecord(item?.applicant_username);
                const applicantStore = String(applicantRec?.store || item?.payload?.store || '').trim();
                const applicantUsername = String(item?.applicant_username || '').trim().toLowerCase();

                const employeesAll = HRMS_STORE.getEmployees() || [];
                const usersAll = (HRMS_STORE.getUsers ? HRMS_STORE.getUsers() : []) || [];
                const seen = new Set();
                const candidates = [];
                const addCandidate = (x) => {
                    const u = String(x?.username || '').trim();
                    if (!u || seen.has(u.toLowerCase())) return;
                    if (u.toLowerCase() === applicantUsername) return; // can't mentor yourself
                    const status = String(x?.status || 'active').trim().toLowerCase();
                    if (status && status !== 'active') return;
                    seen.add(u.toLowerCase());
                    candidates.push({
                        username: u,
                        name: String(x?.name || '').trim(),
                        store: String(x?.store || '').trim(),
                        role: hrmsNormalizeRoleCode(x?.role)
                    });
                };
                employeesAll.forEach(addCandidate);
                usersAll.forEach(addCandidate);

                const sameStore = applicantStore ? candidates.filter(c => c.store === applicantStore) : candidates.slice();
                const managementRoles = new Set([ROLES.PRODUCTION_MANAGER, ROLES.STORE_MANAGER, ROLES.FRONT_MANAGER, ROLES.FRONT_SUPERVISOR, ROLES.HQ_MANAGER, ROLES.ADMIN]);
                let pool = sameStore.filter(c => managementRoles.has(c.role));
                if (!pool.length) pool = sameStore.length ? sameStore : candidates;

                pool.sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username, 'zh-CN'));

                const selectedUsername = String(sel.dataset.selected || '').trim();
                sel.innerHTML = '<option value="">请选择带教人</option>' + pool.map(c => {
                    const label = c.name ? `${c.name}（${c.username}）` : c.username;
                    const isSelected = selectedUsername && c.username.toLowerCase() === selectedUsername.toLowerCase();
                    return `<option value="${c.username.replace(/"/g, '&quot;')}" data-name="${(c.name || '').replace(/"/g, '&quot;')}"${isSelected ? ' selected' : ''}>${label}</option>`;
                }).join('');

                if (selectedUsername && !pool.some(c => c.username.toLowerCase() === selectedUsername.toLowerCase())) {
                    // Preserve a previously-saved mentor even if they fall outside the computed pool (e.g. different store)
                    const existingName = String(nameInput?.value || '').trim();
                    const opt = document.createElement('option');
                    opt.value = selectedUsername;
                    opt.dataset.name = existingName;
                    opt.selected = true;
                    opt.textContent = existingName ? `${existingName}（${selectedUsername}）` : selectedUsername;
                    sel.appendChild(opt);
                }

                const syncMentorName = () => {
                    const opt = sel.options[sel.selectedIndex];
                    if (nameInput) nameInput.value = opt ? (opt.dataset.name || '') : '';
                };
                sel.onchange = syncMentorName;
                syncMentorName();
            } catch (e) {}
        }

        function escapeJsString(str) {
            return String(str || '')
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n')
                .replace(/\u2028/g, '\\u2028')
                .replace(/\u2029/g, '\\u2029');
        }

        function formatFileSize(bytes) {
            const b = Number(bytes || 0);
            if (!Number.isFinite(b) || b <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let idx = 0;
            let val = b;
            while (val >= 1024 && idx < units.length - 1) {
                val = val / 1024;
                idx += 1;
            }
            const fixed = idx === 0 ? 0 : (idx === 1 ? 1 : 2);
            return `${val.toFixed(fixed)} ${units[idx]}`;
        }

        function getKbFlashcardsProgressKey(itemId) {
            const uname = currentUser?.username || 'guest';
            return `HRMS_KB_FLASHCARDS_${uname}_${String(itemId || '')}`;
        }

        function getKbFlashcardsProgress(itemId) {
            try {
                const raw = localStorage.getItem(getKbFlashcardsProgressKey(itemId));
                const parsed = hrmsSafeParseJson(raw);
                if (!parsed || typeof parsed !== 'object') return null;
                return parsed;
            } catch (e) {
                return null;
            }
        }

        function setKbFlashcardsProgress(itemId, data) {
            try {
                localStorage.setItem(getKbFlashcardsProgressKey(itemId), JSON.stringify(data || {}));
            } catch (e) {
                // ignore
            }
        }

        function getKbFlashcardsHistoryKey() {
            const uname = currentUser?.username || 'guest';
            return `HRMS_KB_FLASHCARDS_HISTORY_${uname}`;
        }

        function getKbFlashcardsHistory() {
            try {
                const raw = localStorage.getItem(getKbFlashcardsHistoryKey());
                const parsed = hrmsSafeParseJson(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                return [];
            }
        }

        function setKbFlashcardsHistory(list) {
            try {
                localStorage.setItem(getKbFlashcardsHistoryKey(), JSON.stringify(Array.isArray(list) ? list : []));
            } catch (e) {
                // ignore
            }
        }

        function getKnowledgeItemTitleById(itemId) {
            const id = String(itemId || '').trim();
            if (!id) return '-';
            const items = HRMS_STORE.getKnowledge ? (HRMS_STORE.getKnowledge() || []) : [];
            const one = items.find(x => String(x?.id || '').trim() === id) || null;
            return String(one?.title || one?.originalName || one?.fileName || id).trim() || id;
        }

        function renderKnowledgeFlashcardHistory() {
            const box = document.getElementById('kb-fc-history-list');
            if (!box) return;
            const list = getKbFlashcardsHistory().slice().sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))).slice(0, 30);
            if (!list.length) {
                box.innerHTML = '暂无记录';
                return;
            }
            box.innerHTML = list.map((it) => {
                const title = escapeHtml(String(it?.itemTitle || getKnowledgeItemTitleById(it?.itemId) || '-'));
                const createdAt = escapeHtml(String(it?.createdAt || '').replace('T', ' ').slice(0, 16) || '-');
                const answered = Number(it?.answered || 0);
                const correct = Number(it?.correct || 0);
                const accuracy = answered > 0 ? ((correct / answered) * 100).toFixed(1) : '0.0';
                const count = Number(it?.count || 0);
                const types = Array.isArray(it?.typeFilter) ? it.typeFilter.join('/') : '-';
                return `
                    <div style="padding:8px 10px; border:1px solid rgba(255,255,255,0.08); border-radius:10px; margin-bottom:8px; background:rgba(255,255,255,0.02);">
                        <div style="font-weight:800; color:rgba(241,245,249,0.95);">${title}</div>
                        <div style="margin-top:4px; color:rgba(200,215,230,0.72);">${createdAt}</div>
                        <div style="margin-top:4px; color:rgba(200,215,230,0.85);">题量 ${count} · 答题 ${answered} · 正确 ${correct} · 正确率 ${accuracy}%</div>
                        <div style="margin-top:4px; color:rgba(200,215,230,0.65);">题型：${escapeHtml(types)}</div>
                    </div>
                `;
            }).join('');
        }

        async function clearKnowledgeFlashcardHistory() {
            const ok = await hrmsConfirm({ title: '清空历史记录', message: '确认清空自我测验历史记录？', okText: '确认清空', icon: '🗑️' });
            if (!ok) return;
            setKbFlashcardsHistory([]);
            renderKnowledgeFlashcardHistory();
            showNotification('历史记录已清空', 'success');
        }

        function getSelectedFlashcardTypes() {
            const out = [];
            if (document.getElementById('kb-fc-type-single')?.checked) out.push('single');
            if (document.getElementById('kb-fc-type-tf')?.checked) out.push('tf');
            if (document.getElementById('kb-fc-type-blank')?.checked) out.push('blank');
            return out;
        }

        function renderKnowledgeFlashcardStats() {
            const st = getCurrentFlashcardsState();
            const statEl = document.getElementById('kb-fc-session-stats');
            const barEl = document.querySelector('#flashcards-page .kb-fc-progressbar > div');
            if (!statEl || !barEl) return;
            const answered = Number(st?.session?.answered || 0);
            const correct = Number(st?.session?.correct || 0);
            const accuracy = answered > 0 ? ((correct / answered) * 100) : 0;
            const byType = st?.session?.byType || { single: 0, tf: 0, blank: 0 };
            statEl.textContent = `答题 ${answered} · 正确率 ${accuracy.toFixed(1)}% · 单选 ${byType.single || 0} · 判断 ${byType.tf || 0} · 填空 ${byType.blank || 0}`;
            const total = Number(st?.order?.length || 0);
            const pct = total > 0 ? Math.min(100, Math.max(0, (answered / total) * 100)) : 0;
            barEl.style.width = `${pct.toFixed(1)}%`;
        }

        function saveKnowledgeFlashcardHistoryRecord(st) {
            if (!st || st.completedLogged) return;
            const answered = Number(st?.session?.answered || 0);
            const total = Number(st?.order?.length || 0);
            if (!total || answered < total) return;
            const list = getKbFlashcardsHistory();
            const itemTitle = getKnowledgeItemTitleById(st.itemId);
            list.unshift({
                id: `kb_fc_hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                createdAt: hrmsNowISO(),
                itemId: st.itemId,
                itemTitle,
                count: total,
                answered,
                correct: Number(st?.session?.correct || 0),
                typeFilter: Array.isArray(st?.typeFilter) ? st.typeFilter.slice() : []
            });
            setKbFlashcardsHistory(list.slice(0, 200));
            st.completedLogged = true;
            renderKnowledgeFlashcardHistory();
        }

