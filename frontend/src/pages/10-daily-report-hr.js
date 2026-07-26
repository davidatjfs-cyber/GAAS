/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 10-daily-report-hr.js
 * lines: 28148-32508 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        function getDailyReportLockReason() {
            try {
                const role = String(currentUser?.role || '').trim();
                if (!hrmsIsRoleCanWriteDailyReport(role)) return '当前角色仅可查看日报';
                if (role === ROLES.STORE_MANAGER) {
                    const submittedAt = __DR_CURRENT_REPORT && (__DR_CURRENT_REPORT.submittedAt || __DR_CURRENT_REPORT.submitted_at);
                    if (submittedAt) return '该日报已提交，店长不可修改';
                }
                return '';
            } catch (e) {
                return '';
            }
        }

        function applyDailyReportEditorPermissions() {
            try {
                const role = String(currentUser?.role || '').trim();
                const isAdmin = hrmsIsRoleAdmin(role);
                const canWrite = hrmsIsRoleCanWriteDailyReport(role);
                const lockReason = getDailyReportLockReason();
                const locked = !!lockReason;

                const inputs = document.querySelectorAll('#daily-report-page input, #daily-report-page select, #daily-report-page textarea');
                inputs.forEach(el => {
                    const id = String(el?.id || '').trim();
                    if (id === 'dr-store' || id === 'dr-list-start' || id === 'dr-list-end') return;
                    if (id === 'dr-photo-input') return;
                    if (!canWrite) {
                        el.disabled = true;
                    } else {
                        el.disabled = locked;
                    }
                });

                const draftBtn = document.getElementById('dr-save-draft-btn');
                const submitBtn = document.getElementById('dr-submit-btn');
                const delBtn = document.getElementById('dr-delete-btn');
                const exportBtn = document.getElementById('dr-export-pdf-btn');
                const photoUploadBtn = document.getElementById('dr-photo-upload-btn');
                if (draftBtn) draftBtn.style.display = canWrite && !locked ? '' : 'none';
                if (submitBtn) submitBtn.style.display = canWrite && !locked ? '' : 'none';
                if (delBtn) delBtn.style.display = (isAdmin && __DR_CURRENT_REPORT) ? '' : 'none';
                if (exportBtn) exportBtn.style.display = isAdmin ? '' : 'none';
                if (photoUploadBtn) photoUploadBtn.style.display = canWrite ? '' : 'none';

                if (!canWrite || locked) {
                    const msg = lockReason || (!canWrite ? '仅店长和管理员可编辑日报' : '已锁定');
                    if (msg) {
                        const banner = document.getElementById('dr-missing-banner');
                        if (banner) {
                            banner.textContent = msg;
                            banner.style.display = '';
                        }
                    }
                }
            } catch (e) {}
        }

        function drNormalizeStoreKey(store) {
            const s = String(store || '').trim().replace(/\s+/g, '');
            if (!s) return '';
            if (/洪潮|大宁久光|久光店/.test(s)) return '洪潮大宁久光店';
            if (/马己仙|音乐广场|大宁店/.test(s)) return '马己仙上海音乐广场店';
            return s;
        }

        function drCalcPrivateRoomMonthTotalLocal(date, store) {
            const rawDate = String(date || '').trim();
            const rawStore = String(store || '').trim();
            if (!rawDate || !rawStore) return null;
            const ym = rawDate.slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(ym)) return null;
            const storeKey = drNormalizeStoreKey(rawStore);
            const currentUses = Math.max(0, Math.floor(drGetNum('dr-private-room-uses') || 0));
            const list = Array.isArray(__DR_LAST_LIST) ? __DR_LAST_LIST : [];
            let total = 0;
            list.forEach((r) => {
                const rowDate = String(r?.date || '').trim();
                if (!rowDate.startsWith(ym) || rowDate === rawDate) return;
                const rowStoreKey = drNormalizeStoreKey(String(r?.store || '').trim());
                if (!rowStoreKey || rowStoreKey !== storeKey) return;
                total += Math.max(0, Math.floor(Number(r?.data?.private_room_uses) || 0));
            });
            return total + currentUses;
        }

        async function syncDailyReportPrivateRoom() {
            // 先用当前已加载的日报即时汇总，再用服务器累计补齐历史已提交数据。
            const dateEl = document.getElementById('dr-date');
            const storeEl = document.getElementById('dr-store');
            const date = dateEl?.value?.trim();
            const store = storeEl?.value?.trim();
            if (!date || !store) return;
            const monthTotalEl = document.getElementById('dr-private-room-month-total');
            if (!monthTotalEl) return;
            const localTotal = drCalcPrivateRoomMonthTotalLocal(date, store);
            monthTotalEl.textContent = `${localTotal == null ? 0 : localTotal} 次`;
            try {
                const token = localStorage.getItem('hrms_token') || '';
                const ym = date.slice(0, 7);
                const r = await fetch(`/api/daily-reports/private-room-month-total?store=${encodeURIComponent(store)}&month=${encodeURIComponent(ym)}`, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (r.ok) {
                    const d = await r.json();
                    const serverTotal = Math.max(0, Math.floor(Number(d?.total) || 0));
                    const finalTotal = localTotal == null ? serverTotal : Math.max(localTotal, serverTotal);
                    monthTotalEl.textContent = `${finalTotal} 次`;
                }
            } catch (e) {}
        }

        function syncDailyReportComputed() {
            const budget = drGetNum('dr-budget');
            const gross = drGetNum('dr-gross');
            const actual = drGetNum('dr-actual');

            const labor = drSumStaff(__DR_FRONT_STAFF) + drSumStaff(__DR_KITCHEN_STAFF);
            const eff = (gross > 0 && labor > 0) ? (gross / labor) : 0;
            drSetText('dr-eff-card', `¥${eff ? eff.toFixed(0) : 0} 折前 / 上班人数`);

            const budgetRate = (budget > 0 && gross > 0) ? (gross / budget) : 0;
            drSetText('dr-budget-rate', drFmtPct(budgetRate));

            // Recharge target completion
            try {
                const date = String(document.getElementById('dr-date')?.value || '').trim();
                const store = String(document.getElementById('dr-store')?.value || '').trim();
                const rechargeAmt = drGetNum('dr-recharge-amt');
                if (date && store) {
                    const ym = date.slice(0, 7);
                    const mt = mtFind(ym, store);
                    const targetRecharge = Number(mt?.targets?.recharge || 0);
                    drSetText('dr-recharge-ach', targetRecharge > 0 ? drFmtPct(rechargeAmt / targetRecharge) : '0.00%');
                } else {
                    drSetText('dr-recharge-ach', '0.00%');
                }
            } catch (e) {}

            // Schedule efficiency
            try {
                const box = document.getElementById('dr-schedule-eff-box');
                const gross2 = drGetNum('dr-tomorrow-gross');
                drRebuildScheduleStaff();
                const people = Array.isArray(__DR_SCHEDULE_STAFF) ? __DR_SCHEDULE_STAFF.length : 0;
                const eff2 = (gross2 > 0 && people > 0) ? (gross2 / people) : 0;
                drSetText('dr-schedule-people', `${people}人`);
                drSetText('dr-schedule-gross', drFmtMoney(gross2));
                drSetText('dr-schedule-eff', `¥${eff2 ? eff2.toFixed(0) : 0}`);
                if (box) box.style.visibility = (gross2 > 0 && people > 0) ? 'visible' : 'hidden';
            } catch (e) {}

            const dineRevenue = drGetNum('dr-dine-revenue');
            const dineOrders = drGetNum('dr-dine-orders');
            const dineTraffic = drGetNum('dr-dine-traffic');
            const dineAvgTable = dineOrders > 0 ? (dineRevenue / dineOrders) : 0;
            const dineAvgPerson = dineTraffic > 0 ? (dineRevenue / dineTraffic) : 0;
            try {
                const tEl = document.getElementById('dr-dine-avg-table');
                if (tEl) tEl.value = dineAvgTable ? String(dineAvgTable.toFixed(2)) : '';
                const pEl = document.getElementById('dr-dine-avg-person');
                if (pEl) pEl.value = dineAvgPerson ? String(dineAvgPerson.toFixed(2)) : '';
            } catch (e) {}

            const noon = drGetNum('dr-noon');
            const afternoon = drGetNum('dr-afternoon');
            const night = drGetNum('dr-night');
            const segSum = noon + afternoon + night;
            drSetText('dr-seg-sum', drFmtMoney(segSum));
            drSetText('dr-noon-rate', drFmtPct(gross > 0 ? (noon / gross) : 0));
            drSetText('dr-afternoon-rate', drFmtPct(gross > 0 ? (afternoon / gross) : 0));
            drSetText('dr-night-rate', drFmtPct(gross > 0 ? (night / gross) : 0));
            drSetText('dr-seg-rate', drFmtPct(gross > 0 ? (segSum / gross) : 0));

            const discountTotal = drGetNum('dr-discount-total');
            const discountRate = gross > 0 ? (discountTotal / gross) : 0;
            drSetValue('dr-discount-rate', drFmtPct(discountRate));
            drSetText('dr-discount-delivery-ref', drFmtMoney(drGetNum('dr-discount-delivery')));

            const eleRev = drGetNum('dr-eleme-rev');
            const eleAct = drGetNum('dr-eleme-actual');
            const eleTar = drGetNum('dr-eleme-target');
            drSetText('dr-eleme-actual-rate', drFmtPct(eleRev > 0 ? (eleAct / eleRev) : 0));
            drSetText('dr-eleme-ach', drFmtPct(eleTar > 0 ? (eleAct / eleTar) : 0));

            const mtRev = drGetNum('dr-meituan-rev');
            const mtAct = drGetNum('dr-meituan-actual');
            const mtTar = drGetNum('dr-meituan-target');
            drSetText('dr-meituan-actual-rate', drFmtPct(mtRev > 0 ? (mtAct / mtRev) : 0));
            drSetText('dr-meituan-ach', drFmtPct(mtTar > 0 ? (mtAct / mtTar) : 0));

            const eleDiscount = Math.max(0, eleRev - eleAct);
            const mtDiscount = Math.max(0, mtRev - mtAct);
            drSetText('dr-eleme-discount', drFmtMoney(eleDiscount));
            drSetText('dr-meituan-discount', drFmtMoney(mtDiscount));
            drSetText('dr-delivery-discount-total', drFmtMoney(eleDiscount + mtDiscount));

            const catAmts = [
                drGetNum('dr-cat-water-amt'),
                drGetNum('dr-cat-soup-amt'),
                drGetNum('dr-cat-roast-amt'),
                drGetNum('dr-cat-wok-amt'),
                drGetNum('dr-cat-sashimi-amt')
            ];
            const catQtys = [
                drGetNum('dr-cat-water-qty'),
                drGetNum('dr-cat-soup-qty'),
                drGetNum('dr-cat-roast-qty'),
                drGetNum('dr-cat-wok-qty'),
                drGetNum('dr-cat-sashimi-qty')
            ];
            const qtySum = catQtys.reduce((a, b) => a + b, 0);
            const ids = [
                ['dr-cat-water-amt-rate', 'dr-cat-water-qty-rate', catAmts[0], catQtys[0]],
                ['dr-cat-soup-amt-rate', 'dr-cat-soup-qty-rate', catAmts[1], catQtys[1]],
                ['dr-cat-roast-amt-rate', 'dr-cat-roast-qty-rate', catAmts[2], catQtys[2]],
                ['dr-cat-wok-amt-rate', 'dr-cat-wok-qty-rate', catAmts[3], catQtys[3]],
                ['dr-cat-sashimi-amt-rate', 'dr-cat-sashimi-qty-rate', catAmts[4], catQtys[4]]
            ];
            ids.forEach(([aId, qId, aV, qV]) => {
                drSetText(aId, drFmtPct(gross > 0 ? (Number(aV || 0) / gross) : 0));
                drSetText(qId, drFmtPct(qtySum > 0 ? (Number(qV || 0) / qtySum) : 0));
            });

            // monthly auto stats (simple from stored reports)
            try {
                const date = String(document.getElementById('dr-date')?.value || '').trim();
                const store = String(document.getElementById('dr-store')?.value || '').trim();
                if (date && store) {
                    const ym = date.slice(0, 7);
                    const list = Array.isArray(__DR_LAST_LIST) ? __DR_LAST_LIST : [];
                    const monthItems = list.filter(r => String(r?.store || '').trim() === store && String(r?.date || '').startsWith(ym));
                    const mg = monthItems.reduce((s, r) => s + Number(r?.data?.gross || 0), 0);
                    const ma = monthItems.reduce((s, r) => s + Number(r?.data?.actual || 0), 0);
                    const mt = mtFind(ym, store);
                    const targetActual = Number(mt?.targets?.actual || 0);

                    drSetText('dr-month-target-actual', targetActual > 0 ? drFmtMoneyInt(targetActual) : '未设置');
                    drSetText('dr-month-gross', drFmtMoneyInt(mg));
                    drSetText('dr-month-actual', drFmtMoneyInt(ma));
                    drSetText('dr-month-rate', targetActual > 0 ? drFmtPct(ma / targetActual) : '0.00%');

                    const targetRecharge = Number(mt?.targets?.recharge || 0);
                    drSetText('dr-recharge-target', targetRecharge > 0 ? drFmtMoneyInt(targetRecharge) : '未设置');

                    const monthRechargeTotal = monthItems.reduce((s, r) => s + Number(r?.data?.recharge?.amount || 0), 0);
                    drSetText('dr-recharge-month-total', drFmtMoneyInt(monthRechargeTotal));
                    drSetText('dr-recharge-ach', targetRecharge > 0 ? drFmtPct(monthRechargeTotal / targetRecharge) : '0.00%');

                    const targetDineTraffic = Number(mt?.targets?.dineTraffic || 0);
                    const targetDineOrders = Number(mt?.targets?.dineOrders || 0);
                    const dineRevenueSum = monthItems.reduce((s, r) => s + Number(r?.data?.dine?.revenue || 0), 0);
                    const dineTrafficSum = monthItems.reduce((s, r) => s + Number(r?.data?.dine?.traffic || 0), 0);
                    const dineOrdersSum = monthItems.reduce((s, r) => s + Number(r?.data?.dine?.orders || 0), 0);
                    const avgTable = dineOrdersSum > 0 ? (dineRevenueSum / dineOrdersSum) : 0;
                    const avgPerson = dineTrafficSum > 0 ? (dineRevenueSum / dineTrafficSum) : 0;

                    drSetText('dr-month-dine-traffic-target', targetDineTraffic > 0 ? (String(targetDineTraffic) + '人') : '未设置');
                    drSetText('dr-month-dine-traffic', String(Number.isFinite(dineTrafficSum) ? dineTrafficSum : 0) + '人');
                    drSetText('dr-month-dine-traffic-rate', targetDineTraffic > 0 ? drFmtPct(dineTrafficSum / targetDineTraffic) : '0.00%');

                    drSetText('dr-month-dine-orders-target', targetDineOrders > 0 ? (String(targetDineOrders) + '单') : '未设置');
                    drSetText('dr-month-dine-orders', String(Number.isFinite(dineOrdersSum) ? dineOrdersSum : 0) + '单');
                    drSetText('dr-month-dine-orders-rate', targetDineOrders > 0 ? drFmtPct(dineOrdersSum / targetDineOrders) : '0.00%');
                    drSetText('dr-month-dine-avg-table', '¥' + (avgTable ? avgTable.toFixed(2) : '0.00'));
                    drSetText('dr-month-dine-avg-person', '¥' + (avgPerson ? avgPerson.toFixed(2) : '0.00'));

                    drSetText('dr-recharge-target-store', store);
                }
            } catch (e) {}

            // keep for list fields
            return { budget, gross, actual, labor, eff };
        }

        async function deleteDailyReport() {
            if (!currentUser) return;
            if (!hrmsIsRoleAdmin(String(currentUser?.role || '').trim())) {
                showNotification('仅管理员可删除日报', 'warning');
                return;
            }
            const store = String(document.getElementById('dr-store')?.value || '').trim();
            const date = String(document.getElementById('dr-date')?.value || '').trim();
            if (!store || !date) {
                showNotification('请选择门店与日期', 'warning');
                return;
            }
            const _okDR = await hrmsConfirm({ title: '删除营业日报', message: `确定删除 ${store} ${date} 的日报？此操作不可恢复。`, okText: '确认删除', icon: '📊' });
            if (!_okDR) return;
            HRMS_API.deleteDailyReport({ store, date })
                .then(() => {
                    showNotification('已删除', 'success');
                    try { __DR_CURRENT_REPORT = null; } catch (e) {}
                    loadDailyReportData();
                    closeDailyReportEditor();
                })
                .catch(e => {
                    showNotification('删除失败：' + String(e?.message || e), 'error');
                });
        }

        function buildDailyReportPayload() {
            const date = String(document.getElementById('dr-date')?.value || '').trim();
            const store = String(document.getElementById('dr-store')?.value || '').trim();
            const budget = drGetNum('dr-budget');
            const gross = drGetNum('dr-gross');
            const actual = drGetNum('dr-actual');

            const staffFront = Array.isArray(__DR_FRONT_STAFF) ? __DR_FRONT_STAFF.slice() : [];
            const staffKitchen = Array.isArray(__DR_KITCHEN_STAFF) ? __DR_KITCHEN_STAFF.slice() : [];
            const staffRest = Array.isArray(__DR_REST_STAFF) ? __DR_REST_STAFF.slice() : [];
            const laborTotal = drSumStaff(staffFront) + drSumStaff(staffKitchen);
            const efficiency = laborTotal > 0 ? (gross / laborTotal) : null;

            drRebuildScheduleStaff();

            const prevData = (__DR_CURRENT_REPORT && __DR_CURRENT_REPORT.data && typeof __DR_CURRENT_REPORT.data === 'object')
                ? __DR_CURRENT_REPORT.data
                : {};
            const prevStaff = (prevData.staff && typeof prevData.staff === 'object') ? { ...prevData.staff } : {};
            const prevSch = (prevData.scheduleNextDay && typeof prevData.scheduleNextDay === 'object')
                ? { ...prevData.scheduleNextDay }
                : {};
            const staff = {
                ...prevStaff,
                front: staffFront,
                kitchen: staffKitchen,
                restStaff: staffRest,
                frontRestStaff: staffRest,
                frontSupport: String(document.getElementById('dr-front-support')?.value || '').trim(),
                kitchenSupport: String(document.getElementById('dr-kitchen-support')?.value || '').trim()
            };
            const scheduleNextDay = {
                ...prevSch,
                staff: Array.isArray(__DR_SCHEDULE_STAFF) ? __DR_SCHEDULE_STAFF.slice() : [],
                frontStaff: Array.isArray(__DR_SCHEDULE_FRONT_STAFF) ? __DR_SCHEDULE_FRONT_STAFF.slice() : [],
                kitchenStaff: Array.isArray(__DR_SCHEDULE_KITCHEN_STAFF) ? __DR_SCHEDULE_KITCHEN_STAFF.slice() : [],
                morningStaff: Array.isArray(__DR_SCHEDULE_FRONT_STAFF) ? __DR_SCHEDULE_FRONT_STAFF.slice() : [],
                afternoonStaff: Array.isArray(__DR_SCHEDULE_KITCHEN_STAFF) ? __DR_SCHEDULE_KITCHEN_STAFF.slice() : [],
                tomorrowGrossEstimate: drGetNum('dr-tomorrow-gross'),
                remark: String(document.getElementById('dr-schedule-remark')?.value || '').trim()
            };

            const data = {
                weather: String(document.getElementById('dr-weather')?.value || '').trim(),
                holiday_switch: !!document.getElementById('dr-holiday-switch')?.checked,
                budget,
                gross,
                actual,
                budgetRate: budget > 0 ? (gross / budget) : null,
                laborTotal,
                efficiency,
                segments: {
                    noon: drGetNum('dr-noon'),
                    afternoon: drGetNum('dr-afternoon'),
                    night: drGetNum('dr-night')
                },
                dine: {
                    revenue: drGetNum('dr-dine-revenue'),
                    orders: drGetNum('dr-dine-orders'),
                    traffic: drGetNum('dr-dine-traffic'),
                    avgTable: drGetNum('dr-dine-avg-table'),
                    avgPerson: drGetNum('dr-dine-avg-person')
                },
                discount: {
                    total: drGetNum('dr-discount-total'),
                    dine: drGetNum('dr-discount-dine'),
                    delivery: drGetNum('dr-discount-delivery')
                },
                categories: {
                    water: { amt: drGetNum('dr-cat-water-amt'), qty: drGetNum('dr-cat-water-qty') },
                    soup: { amt: drGetNum('dr-cat-soup-amt'), qty: drGetNum('dr-cat-soup-qty') },
                    roast: { amt: drGetNum('dr-cat-roast-amt'), qty: drGetNum('dr-cat-roast-qty') },
                    wok: { amt: drGetNum('dr-cat-wok-amt'), qty: drGetNum('dr-cat-wok-qty') },
                    sashimi: { amt: drGetNum('dr-cat-sashimi-amt'), qty: drGetNum('dr-cat-sashimi-qty') }
                },
                delivery: {
                    eleme: {
                        orders: drGetNum('dr-eleme-orders'),
                        revenue: drGetNum('dr-eleme-rev'),
                        actual: drGetNum('dr-eleme-actual'),
                        targetRevenue: drGetNum('dr-eleme-target')
                    },
                    meituan: {
                        orders: drGetNum('dr-meituan-orders'),
                        revenue: drGetNum('dr-meituan-rev'),
                        actual: drGetNum('dr-meituan-actual'),
                        targetRevenue: drGetNum('dr-meituan-target')
                    }
                },
                badReviews: {
                    dianping: drGetNum('dr-bad-dianping'),
                    meituan: drGetNum('dr-bad-meituan'),
                    eleme: drGetNum('dr-bad-eleme')
                },
                operational_anomaly_note: String(document.getElementById('dr-operational-anomaly')?.value || '').trim().slice(0, 4000),
                new_wechat_members: drGetNum('dr-new-wechat-members'),
                wechat_month_total: __DR_WECHAT_MONTH_BASE + drGetNum('dr-new-wechat-members'),
                recharge: {
                    count: drGetNum('dr-recharge-count'),
                    amount: drGetNum('dr-recharge-amt')
                },
                // 新增字段：毛利率目标和大众点评星级
                target_revenue: drGetNum('dr-target-revenue'),
                target_margin: drGetNum('dr-target-margin'),
                dianping_rating: drGetNum('dr-dianping-rating'),
                private_room_uses: drGetNum('dr-private-room-uses'),
                staff,
                scheduleNextDay,
                photos: drNormalizeDailyReportPhotosArr(__DR_PHOTOS)
            };

            return { date, store, data };
        }

        function validateDailyReportBeforeSubmit(payload) {
            const date = String(payload?.date || '').trim();
            const store = String(payload?.store || '').trim();
            const budget = Number(payload?.data?.budget || 0);
            const gross = Number(payload?.data?.gross || 0);
            const actual = Number(payload?.data?.actual || 0);
            const staffFront = Array.isArray(payload?.data?.staff?.front) ? payload.data.staff.front : [];
            const staffKitchen = Array.isArray(payload?.data?.staff?.kitchen) ? payload.data.staff.kitchen : [];
            if (!date) return '请选择日期';
            if (!store) return '请选择门店';
            if (!(budget > 0)) return '请填写预算折前营业额';
            if (!(gross > 0)) return '请填写今日折前营业额';
            if (!(actual > 0)) return '请填写今日实收营业额';
            if (!((staffFront.length + staffKitchen.length) > 0)) return '请添加上班人员';
            return '';
        }

        function saveDailyReportDraft() {
            if (!currentUser) return;
            const role = String(currentUser?.role || '').trim();
            if (!hrmsIsRoleCanWriteDailyReport(role)) {
                showNotification('无权限保存草稿', 'warning');
                return;
            }
            const lockReason = getDailyReportLockReason();
            if (lockReason) {
                showNotification(lockReason, 'warning');
                return;
            }
            const payload = buildDailyReportPayload();
            HRMS_API.saveDailyReport({ ...payload, submitted: false })
                .then(resp => {
                    __DR_CURRENT_REPORT = resp?.item || __DR_CURRENT_REPORT;
                    showNotification('草稿已保存', 'success');
                    loadDailyReportData();
                    try { applyDailyReportEditorPermissions(); } catch (e) {}
                })
                .catch(e => {
                    showNotification('保存失败：' + String(e?.message || e), 'error');
                });
        }

        async function submitDailyReport() {
            if (!currentUser) return;
            const role = String(currentUser?.role || '').trim();
            if (!hrmsIsRoleCanWriteDailyReport(role)) {
                showNotification('无权限提交日报', 'warning');
                return;
            }
            const lockReason = getDailyReportLockReason();
            if (lockReason) {
                showNotification(lockReason, 'warning');
                return;
            }
            const payload = buildDailyReportPayload();
            const errMsg = validateDailyReportBeforeSubmit(payload);
            if (errMsg) {
                showNotification(errMsg, 'warning');
                return;
            }
            if (role === ROLES.STORE_MANAGER) {
                const _okDR = await hrmsConfirm({ title: '提交日报', message: '确认提交日报？提交后将不可再修改。', okText: '确认提交', icon: '📊' });
                if (!_okDR) return;
            }

            HRMS_API.saveDailyReport({ ...payload, submitted: true })
                .then(() => {
                    showNotification('日报已提交', 'success');
                    loadDailyReportData();
                    closeDailyReportEditor();
                })
                .catch(e => {
                    showNotification('保存失败：' + String(e?.message || e), 'error');
                });
        }

        function renderDailyReportList(items) {
            const box = document.getElementById('dr-list');
            const empty = document.getElementById('dr-empty');
            if (!box || !empty) return;
            const list = Array.isArray(items) ? items : [];
            if (!list.length) {
                box.innerHTML = '';
                empty.style.display = '';
                return;
            }
            empty.style.display = 'none';
            const fmtMoney = (n) => {
                const v = Number(n || 0);
                if (!Number.isFinite(v)) return '¥0.00';
                return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            };
            const fmtInt = (n) => {
                const v = Number(n || 0);
                if (!Number.isFinite(v)) return '0';
                return String(Math.round(v));
            };
            const fmtDateTitle = (s) => {
                const raw = String(s || '').trim();
                if (!raw) return '-';
                const d = new Date(raw + 'T00:00:00');
                if (!Number.isFinite(d.getTime())) return raw;
                const m = d.getMonth() + 1;
                const dd = d.getDate();
                const wd = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()];
                return `${m}月${dd}日 ${wd}`;
            };

            box.innerHTML = list.slice(0, 60).map(r => {
                const rawDate = String(r?.date || '-');
                const rawStore = String(r?.store || '-');
                const title = escapeHtml(fmtDateTitle(rawDate));
                const store = escapeHtml(rawStore);
                const weather = escapeHtml(String(r?.data?.weather || '').trim());
                const holidayMark = !!(r?.data?.holiday_switch ?? r?.data?.holidaySwitch);
                const submittedAt = String(r?.submittedAt || r?.submitted_at || '').trim();
                const submitterName = escapeHtml(String(r?.submitterName || '').trim());
                const submittedBadge = submittedAt ? '<span style="margin-left:6px; font-size:10px; padding:2px 7px; border-radius:99px; background:rgba(34,197,94,0.15); color:#22c55e; font-weight:800;">已提交</span>' : '<span style="margin-left:6px; font-size:10px; padding:2px 7px; border-radius:99px; background:rgba(245,158,11,0.15); color:#f59e0b; font-weight:800;">草稿</span>';
                const actual = Number(r?.data?.actual || 0);
                const budget = Number(r?.data?.budget || 0);
                const gross = Number(r?.data?.gross || 0);
                const discount = Number(r?.data?.discount?.total || 0);
                const eff = Number(r?.data?.efficiency || 0);
                const dineRev = Number(r?.data?.dine?.revenue || 0);
                const elemeRev = Number(r?.data?.delivery?.eleme?.revenue || 0);
                const meituanRev = Number(r?.data?.delivery?.meituan?.revenue || 0);
                const rechargeAmt = Number(r?.data?.recharge?.amount || 0);
                const rate = (budget > 0 && gross > 0) ? (gross / budget) : 0;
                const rateColor = rate >= 1 ? '#22c55e' : rate >= 0.8 ? '#f59e0b' : '#ef4444';
                const safeStore = escapeHtml(rawStore).replace(/'/g, '&#39;');
                const safeDate = escapeHtml(rawDate).replace(/'/g, '&#39;');

                return `
                    <div class="dr-report-card" data-click="openDailyReport" data-arg="${safeStore}" data-arg2="${safeDate}">
                        <div class="dr-report-card__in">
                            <div class="dr-report-head">
                                <div class="dr-report-date">${title}${submittedBadge}</div>
                                <div class="dr-report-arrow">›</div>
                            </div>
                            <div class="dr-report-sub">
                                <span style="color:#93c5fd; font-weight:800;">🏬 ${store}</span>
                                ${submitterName ? `<span style="color:rgba(200,215,230,0.7);">·</span><span style="color:rgba(200,215,230,0.7);">👤 ${submitterName}</span>` : ''}
                                ${weather ? `<span style="color:rgba(200,215,230,0.7);">·</span><span style="color:rgba(200,215,230,0.7);">${weather}</span>` : ''}
                                ${holidayMark ? `<span style="margin-left:6px; font-size:10px; padding:2px 7px; border-radius:99px; background:rgba(249,115,22,0.18); color:#fb923c; font-weight:800;">休</span>` : ''}
                            </div>
                            <div class="dr-report-kpis">
                                <div class="dr-kpi">
                                    <div class="k">今日实收</div>
                                    <div class="v" style="color:#f1f5f9;">${fmtMoney(actual)}</div>
                                </div>
                                <div class="dr-kpi">
                                    <div class="k">达成率</div>
                                    <div class="v" style="color:${rateColor};">${drFmtPct(rate)}</div>
                                </div>
                            </div>
                        </div>
                        <div class="dr-report-metrics">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><span class="dm-lab">折前营业额</span><span class="dm-val" style="color:#93c5fd;">${fmtMoney(gross)}</span></div>
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><span class="dm-lab">总折扣</span><span class="dm-val" style="color:#f87171;">${fmtMoney(discount)}</span></div>
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><span class="dm-lab">堂食</span><span class="dm-val" style="color:#34d399;">${fmtMoney(dineRev)}</span></div>
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><span class="dm-lab">人效</span><span class="dm-val" style="color:#60a5fa;">¥${escapeHtml(Number.isFinite(eff) ? fmtInt(eff) : '0')}</span></div>
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><span class="dm-lab">饿了么</span><span class="dm-val" style="color:#38bdf8;">${fmtMoney(elemeRev)}</span></div>
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><span class="dm-lab">美团</span><span class="dm-val" style="color:#fb923c;">${fmtMoney(meituanRev)}</span></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function openDailyReport(store, date) {
            try {
                const st = String(store || '').trim();
                const dt = String(date || '').trim();
                const one = (__DR_LAST_LIST || []).find(x => String(x?.store || '').trim() === st && String(x?.date || '').trim() === dt) || null;
                showDailyReportEditor();
                const sel = document.getElementById('dr-store');
                if (sel) sel.value = st;
                const dateEl = document.getElementById('dr-date');
                if (dateEl) dateEl.value = dt;
                if (one) fillDailyReportForm(one);
                else {
                    try { drResetStaffState(); } catch (e) {}
                    try { __DR_PHOTOS = []; renderDailyReportPhotos(); } catch (e) {}
                    // 新建日报：从服务器获取本月企微累计基数
                    try { __DR_WECHAT_MONTH_BASE = 0; drUpdateWechatMonthTotal(); drFetchAndSetWechatMonthBase(dt, st); } catch(_e) { __DR_WECHAT_MONTH_BASE = 0; }
                    syncDailyReportComputed();
                }
                try { __DR_CURRENT_REPORT = one; } catch (e) {}
                try { applyDailyReportEditorPermissions(); } catch (e) {}
            } catch (e) {}
        }

        function fillDailyReportForm(report) {
            const r = report && typeof report === 'object' ? report : {};
            const raw = r.data && typeof r.data === 'object' ? r.data : {};
            const data = {
                ...raw,
                photos: drNormalizeDailyReportPhotosArr(drCollectPhotosFromReport(raw, r))
            };
            __DR_CURRENT_REPORT = r;
            try { showDailyReportEditor(); } catch (e) {}
            try {
                const dateEl = document.getElementById('dr-date');
                if (dateEl) dateEl.value = String(r?.date || '').trim();
            } catch (e) {}
            try {
                drEnsureSelectStores();
                const sel = document.getElementById('dr-store');
                if (sel) sel.value = String(r?.store || '').trim();
            } catch (e) {}
            try {
                drSetValue('dr-budget', data.budget);
                drSetValue('dr-gross', data.gross);
                drSetValue('dr-actual', data.actual);
                drSetValue('dr-noon', data?.segments?.noon);
                drSetValue('dr-afternoon', data?.segments?.afternoon);
                drSetValue('dr-night', data?.segments?.night);
                drSetValue('dr-dine-revenue', data?.dine?.revenue);
                drSetValue('dr-dine-orders', data?.dine?.orders);
                drSetValue('dr-dine-traffic', data?.dine?.traffic);
                drSetValue('dr-dine-avg-table', data?.dine?.avgTable);
                drSetValue('dr-dine-avg-person', data?.dine?.avgPerson);
                drSetValue('dr-discount-total', data?.discount?.total);
                drSetValue('dr-discount-dine', data?.discount?.dine);
                drSetValue('dr-discount-delivery', data?.discount?.delivery);
                drSetValue('dr-cat-water-amt', data?.categories?.water?.amt);
                drSetValue('dr-cat-water-qty', data?.categories?.water?.qty);
                drSetValue('dr-cat-soup-amt', data?.categories?.soup?.amt);
                drSetValue('dr-cat-soup-qty', data?.categories?.soup?.qty);
                drSetValue('dr-cat-roast-amt', data?.categories?.roast?.amt);
                drSetValue('dr-cat-roast-qty', data?.categories?.roast?.qty);
                drSetValue('dr-cat-wok-amt', data?.categories?.wok?.amt);
                drSetValue('dr-cat-wok-qty', data?.categories?.wok?.qty);
                drSetValue('dr-cat-sashimi-amt', data?.categories?.sashimi?.amt);
                drSetValue('dr-cat-sashimi-qty', data?.categories?.sashimi?.qty);
                drSetValue('dr-eleme-orders', data?.delivery?.eleme?.orders);
                drSetValue('dr-eleme-rev', data?.delivery?.eleme?.revenue);
                drSetValue('dr-eleme-actual', data?.delivery?.eleme?.actual);
                drSetValue('dr-eleme-target', data?.delivery?.eleme?.targetRevenue);
                drSetValue('dr-meituan-orders', data?.delivery?.meituan?.orders);
                drSetValue('dr-meituan-rev', data?.delivery?.meituan?.revenue);
                drSetValue('dr-meituan-actual', data?.delivery?.meituan?.actual);
                drSetValue('dr-meituan-target', data?.delivery?.meituan?.targetRevenue);
                drSetValue('dr-operational-anomaly', data?.operational_anomaly_note);
                drSetValue('dr-bad-dianping', data?.badReviews?.dianping);
                drSetValue('dr-bad-meituan', data?.badReviews?.meituan);
                drSetValue('dr-bad-eleme', data?.badReviews?.eleme);
                drSetValue('dr-new-wechat-members', data?.new_wechat_members);
                try { __DR_WECHAT_MONTH_BASE = drCalcWechatMonthBase(r?.date, r?.store); } catch(_e) { __DR_WECHAT_MONTH_BASE = 0; }
                { const _sv = Number(data?.wechat_month_total || 0); const _today = Math.max(0, Number(data?.new_wechat_members || 0)); if (_sv > 0 && _sv - _today >= 0) __DR_WECHAT_MONTH_BASE = _sv - _today; }
                drUpdateWechatMonthTotal();
                try { drFetchAndSetWechatMonthBase(r?.date, r?.store); } catch(_e2) {}
                drSetValue('dr-recharge-count', data?.recharge?.count);
                drSetValue('dr-recharge-amt', data?.recharge?.amount);
                // 目标字段：从系统设置读取，只读显示（只有毛利率目标）
                const targetMargin = data?.target_margin;
                drSetText('dr-target-margin', targetMargin ? `${Number(targetMargin).toFixed(1)}%` : '未设置');
                // 点评星级：可输入
                drSetValue('dr-dianping-rating', data?.dianping_rating);
                // 包房使用：可输入今日次数，显示本月累计
                drSetValue('dr-private-room-uses', data?.private_room_uses);
                const monthTotalEl = document.getElementById('dr-private-room-month-total');
                if (monthTotalEl) {
                    const mt = data?.private_room_month_total;
                    monthTotalEl.textContent = (mt !== null && mt !== undefined) ? `${mt} 次` : '0 次';
                }
                drSetValue('dr-front-support', data?.staff?.frontSupport);
                drSetValue('dr-kitchen-support', data?.staff?.kitchenSupport);
                drSetValue('dr-tomorrow-gross', data?.scheduleNextDay?.tomorrowGrossEstimate);
                drSetValue('dr-schedule-remark', data?.scheduleNextDay?.remark);
                try {
                    const wEl = document.getElementById('dr-weather');
                    if (wEl) wEl.value = String(data?.weather || wEl.value || '').trim() || wEl.value;
                } catch (e2) {}
                try {
                    const hEl = document.getElementById('dr-holiday-switch');
                    if (hEl) hEl.checked = !!(data?.holiday_switch ?? data?.holidaySwitch);
                } catch (e3) {}
            } catch (e) {}

            // Backward compatible: accept {name,days} or {user,name,days}
            const normStaff = (arr) => {
                const list = Array.isArray(arr) ? arr : [];
                return list.map(x => {
                    const u = String(x?.user || '').trim();
                    const n = String(x?.name || '').trim();
                    const days = Number(x?.days || 1);
                    return { user: u, name: n, days: (Number.isFinite(days) ? days : 1) };
                });
            };
            const normRestStaff = (arr, textFallback) => {
                const list = normStaff(arr);
                if (list.length) return list;
                const raw = String(textFallback || '').trim();
                if (!raw) return [];
                const parts = raw.split(/[，,、;；\n\r\t\s\/|]+/).map(x => String(x || '').trim()).filter(Boolean);
                if (!parts.length) return [];
                const users = (HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : [])
                    .concat(HRMS_STORE.getEmployees ? (HRMS_STORE.getEmployees() || []) : []);
                return parts.map((name) => {
                    const matched = users.find(u => String(u?.name || '').trim() === name) || null;
                    const uname = String(matched?.username || '').trim();
                    return { user: uname, name, days: 1 };
                });
            };
            __DR_FRONT_STAFF = normStaff(data?.staff?.front);
            __DR_KITCHEN_STAFF = normStaff(data?.staff?.kitchen);
            __DR_REST_STAFF = drMergeUniqueStaffLists(
                normRestStaff(data?.staff?.restStaff, ''),
                normRestStaff(data?.staff?.frontRestStaff, data?.staff?.frontRest),
                normRestStaff(data?.staff?.kitchenRestStaff, data?.staff?.kitchenRest)
            );
            __DR_SCHEDULE_FRONT_STAFF = normStaff(data?.scheduleNextDay?.frontStaff);
            __DR_SCHEDULE_KITCHEN_STAFF = normStaff(data?.scheduleNextDay?.kitchenStaff);
            if (!__DR_SCHEDULE_FRONT_STAFF.length && !__DR_SCHEDULE_KITCHEN_STAFF.length) {
                __DR_SCHEDULE_FRONT_STAFF = normStaff(data?.scheduleNextDay?.morningStaff);
                __DR_SCHEDULE_KITCHEN_STAFF = normStaff(data?.scheduleNextDay?.afternoonStaff);
            }
            drRebuildScheduleStaff();
            __DR_PHOTOS = drNormalizeDailyReportPhotosArr(data?.photos);
            drRenderStaff('front');
            drRenderStaff('kitchen');
            drRenderStaff('rest');
            drRenderStaff('schedule');
            drRenderStaff('schedule_front');
            drRenderStaff('schedule_kitchen');
            renderDailyReportPhotos();
            try { syncDailyReportPrivateRoom(); } catch (e) {}
            syncDailyReportComputed();
            try { applyDailyReportEditorPermissions(); } catch (e) {}
        }

        let __REP_TAB = 'business';

        function repRoleCanSeeStoreSelect() {
            const r = String(currentUser?.role || '').trim();
            return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.HR_MANAGER;
        }

        function repRoleCanSeeReports() {
            return !!currentUser && canAccessModulePage('reports', currentUser?.role);
        }

        function repRoleCanSeeBusinessReport() {
            const r = String(currentUser?.role || '').trim();
            return r === ROLES.ADMIN || r === ROLES.HQ_MANAGER || r === ROLES.STORE_MANAGER;
        }

        function repRoleCanDownload() {
            return hrmsPayrollPermAllowed('reports.payroll.export', String(currentUser?.role || '').trim() === ROLES.ADMIN);
        }

        function repRoleIsHrManager() {
            const r = String(currentUser?.role || '').trim();
            return r === ROLES.HR_MANAGER;
        }

        function repRoleCanViewPromotionRecords() {
            const r = String(currentUser?.role || '').trim();
            return r === ROLES.ADMIN || r === ROLES.HR_MANAGER || r === ROLES.HQ_MANAGER;
        }

        function repRoleCanViewDailyAttendanceRegister() {
            if (!currentUser) return false;
            const nr =
                typeof hrmsNormalizeRoleCode === 'function'
                    ? hrmsNormalizeRoleCode(currentUser.role)
                    : String(currentUser.role || '').trim();
            return nr === ROLES.ADMIN || nr === ROLES.HQ_MANAGER || nr === ROLES.HR_MANAGER;
        }

        let __REP_STORE_POPULATED = false;
        function repEnsureSelectStores(forceRebuild) {
            const sel = document.getElementById('rep-store');
            if (!sel) return;
            if (__REP_STORE_POPULATED && !forceRebuild) return;
            const prevVal = sel.value;
            const brandSelVal = normalizeBrandIdInput(document.getElementById('rep-brand')?.value || '');
            const canSelect = repRoleCanSeeStoreSelect();
            const storesAll = HRMS_STORE.getStores ? (HRMS_STORE.getStores() || []) : (HRMS_STORE.ensure().stores || []);
            const stores = brandSelVal
                ? storesAll.filter((s) => normalizeBrandIdInput(s?.brandId || s?.brand || s?.brandName) === brandSelVal)
                : storesAll;

            populateReportsBrandSelect(brandSelVal || '');
            if (canSelect) {
                sel.innerHTML = ['<option value="">所有门店</option>'].concat(stores.map(s => {
                    const name = String(s?.name || s?.id || '').trim();
                    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
                })).join('');
                sel.disabled = false;
            } else {
                let myStore = String(currentUser?.store || '').trim();
                if (!myStore) {
                    try {
                        const emps = HRMS_STORE.getEmployees ? (HRMS_STORE.getEmployees() || []) : [];
                        const users = HRMS_STORE.getUsers ? (HRMS_STORE.getUsers() || []) : [];
                        const all = emps.concat(users);
                        const me = all.find(e => String(e?.username || '').toLowerCase() === String(currentUser?.username || '').toLowerCase());
                        if (me?.store) { myStore = String(me.store).trim(); currentUser.store = myStore; }
                    } catch (e) {}
                }
                if (!myStore) {
                    try {
                        if (stores.length === 1) myStore = String(stores[0]?.name || stores[0]?.id || '').trim();
                    } catch (e) {}
                }
                sel.innerHTML = myStore ? `<option value="${escapeHtml(myStore)}">${escapeHtml(myStore)}</option>` : '<option value="">-</option>';
                sel.disabled = true;
            }
            if (prevVal) {
                sel.value = prevVal;
            }
            if (!sel.value) {
                const v = String(currentUser?.store || '').trim();
                if (v) sel.value = v;
            }
            __REP_STORE_POPULATED = true;
        }

        var __REP_FILTERS_COLLAPSED = false;
        var __REP_FILTERS_AUTO_COLLAPSED = false;

        function repTabTitle(tab) {
            const key = String(tab || '').trim();
            return ({
                business: '业务报表',
                attendance: '考勤报表',
                'daily-attendance-register': '出勤表',
                payroll: '薪资报表',
                'inventory-forecast': '预测报表',
                promotions: '晋升报表',
                turnover: '离职分析',
                'leave-owed': '欠休报表'
            })[key] || '分析报表';
        }

        function repCurrentPeriodText(tab, start, end, month) {
            const key = String(tab || '').trim();
            if (key === 'payroll' || key === 'turnover' || key === 'leave-owed') {
                return month ? `${month} 月份` : '待选择月份';
            }
            return start && end ? `${start} 至 ${end}` : '待选择时间范围';
        }

        function renderReportsOverview(meta) {
            const bar = document.getElementById('rep-overview-bar');
            if (!bar) return;
            const info = meta && typeof meta === 'object' ? meta : {};
            const tab = String(info.tab || __REP_TAB || 'business').trim() || 'business';
            const store = String(info.store || document.getElementById('rep-store')?.value || '').trim();
            const brand = String(info.brand || document.getElementById('rep-brand')?.value || '').trim();
            const start = String(info.start || document.getElementById('rep-start')?.value || '').trim();
            const end = String(info.end || document.getElementById('rep-end')?.value || '').trim();
            const month = String(info.month || document.getElementById('rep-month')?.value || '').trim();
            const chips = [
                `<span class="rep-overview-chip rep-overview-chip--active">当前 <strong>${escapeHtml(repTabTitle(tab))}</strong></span>`,
                `<span class="rep-overview-chip">门店 <strong>${escapeHtml(store || '全部门店')}</strong></span>`,
                `<span class="rep-overview-chip">品牌 <strong>${escapeHtml(brand || '全部品牌')}</strong></span>`,
                `<span class="rep-overview-chip">周期 <strong>${escapeHtml(repCurrentPeriodText(tab, start, end, month))}</strong></span>`
            ];
            if (tab === 'business') {
                chips.push(`<span class="rep-overview-chip">视图 <strong>${escapeHtml(__BIZ_VIEW === 'dashboard' ? '仪表盘' : '列表')}</strong></span>`);
            }
            if (__REP_FILTERS_COLLAPSED) {
                chips.push('<span class="rep-overview-chip">筛选 <strong>已折叠</strong></span>');
            }
            bar.innerHTML = chips.join('');
        }

        function toggleReportsFilters(forceExpanded) {
            const card = document.getElementById('rep-filters-card');
            const btn = document.getElementById('rep-filters-toggle');
            if (!card || !btn) return;
            if (typeof forceExpanded === 'boolean') {
                __REP_FILTERS_COLLAPSED = !forceExpanded;
            } else {
                __REP_FILTERS_COLLAPSED = !__REP_FILTERS_COLLAPSED;
            }
            card.setAttribute('data-collapsed', __REP_FILTERS_COLLAPSED ? 'true' : 'false');
            btn.textContent = __REP_FILTERS_COLLAPSED ? '展开筛选' : '收起筛选';
            btn.setAttribute('aria-expanded', __REP_FILTERS_COLLAPSED ? 'false' : 'true');
            renderReportsOverview();
        }

        function autoCollapseReportsFiltersIfNeeded() {
            if (__REP_FILTERS_AUTO_COLLAPSED) return;
            try {
                if (window.innerWidth <= 640) {
                    toggleReportsFilters(false);
                    __REP_FILTERS_AUTO_COLLAPSED = true;
                }
            } catch (e) {}
        }

        function enhanceReportsResponsiveTables(root) {
            const scope = root && root.querySelectorAll ? root : document.getElementById('reports-page');
            if (!scope) return;
            const tables = scope.querySelectorAll('table');
            tables.forEach((table) => {
                if (!(table instanceof HTMLElement)) return;
                table.classList.add('rep-responsive-table');
                const headerCells = Array.from(table.querySelectorAll('thead th'));
                if (!headerCells.length) return;
                const labels = headerCells.map((th) => String(th.textContent || '').trim());
                const rows = table.querySelectorAll('tbody tr');
                rows.forEach((tr) => {
                    const cells = tr.querySelectorAll('td');
                    cells.forEach((td, index) => {
                        if (!(td instanceof HTMLElement)) return;
                        const label = labels[index] || '';
                        if (label) td.setAttribute('data-label', label);
                    });
                });
            });
        }

        function finalizeReportsBox(box) {
            if (!box) return;
            enhanceReportsResponsiveTables(box);
            autoCollapseReportsFiltersIfNeeded();
            renderReportsOverview();
        }

        function repAttendanceFmtDay(dateStr) {
            const raw = String(dateStr || '').trim();
            return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.slice(5) : (raw || '-');
        }

        function repAttendanceFmtTime(value) {
            const dt = new Date(value);
            if (!Number.isFinite(dt.getTime())) return '--:--';
            return String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
        }

        function repAttendanceDateTags(dates, tone, emptyText) {
            const items = Array.isArray(dates) ? dates.filter(Boolean) : [];
            if (!items.length) {
                return '<span style="font-size:11px; color:rgba(148,163,184,0.82);">' + escapeHtml(emptyText || '暂无') + '</span>';
            }
            const bgMap = {
                green: 'rgba(34,197,94,0.14)',
                red: 'rgba(248,113,113,0.16)',
                amber: 'rgba(251,191,36,0.16)',
                blue: 'rgba(96,165,250,0.14)'
            };
            const borderMap = {
                green: 'rgba(74,222,128,0.28)',
                red: 'rgba(248,113,113,0.28)',
                amber: 'rgba(251,191,36,0.28)',
                blue: 'rgba(96,165,250,0.24)'
            };
            const textMap = {
                green: '#bbf7d0',
                red: '#fecaca',
                amber: '#fde68a',
                blue: '#bfdbfe'
            };
            const bg = bgMap[tone] || bgMap.blue;
            const bd = borderMap[tone] || borderMap.blue;
            const color = textMap[tone] || textMap.blue;
            return items.map(function(date) {
                return '<span style="display:inline-flex; align-items:center; min-height:28px; padding:0 10px; border-radius:999px; background:' + bg + '; border:1px solid ' + bd + '; color:' + color + '; font-size:11px; font-weight:800;">' + escapeHtml(repAttendanceFmtDay(date)) + '</span>';
            }).join('');
        }

        function repBuildAttendanceCheckinDigest(checkinDetails, summaryRows) {
            const lateMap = new Map();
            (Array.isArray(summaryRows) ? summaryRows : []).forEach(function(row) {
                const identity = String(row?.username || row?.name || '').trim().toLowerCase();
                const store = String(row?.store || '').trim();
                (Array.isArray(row?.lateDates) ? row.lateDates : []).forEach(function(date) {
                    lateMap.set(store + '||' + identity + '||' + String(date || '').trim(), true);
                });
            });

            const peopleMap = new Map();
            (Array.isArray(checkinDetails) ? checkinDetails : []).forEach(function(item) {
                const username = String(item?.username || '').trim();
                const identity = username.toLowerCase();
                const name = String(item?.display_name || item?.name || username).trim() || username;
                const store = String(item?.store || '').trim();
                const date = String((item?.check_time || '')).slice(0, 10);
                if (!identity || !date) return;
                const personKey = store + '||' + identity;
                if (!peopleMap.has(personKey)) {
                    peopleMap.set(personKey, {
                        store: store,
                        username: username,
                        name: name,
                        dayMap: new Map(),
                        totalPunches: 0,
                        anomalyPunches: 0
                    });
                }
                const person = peopleMap.get(personKey);
                if (!person.name) person.name = name;
                const dayKey = store + '||' + identity + '||' + date;
                if (!person.dayMap.has(dayKey)) {
                    person.dayMap.set(dayKey, {
                        date: date,
                        firstIn: '',
                        lastOut: '',
                        punchCount: 0,
                        anomalyCount: 0,
                        isLate: !!lateMap.get(dayKey)
                    });
                }
                const day = person.dayMap.get(dayKey);
                day.punchCount += 1;
                person.totalPunches += 1;
                const status = String(item?.status || '').trim();
                if (status && !['normal', 'no_gps', 'confirmed'].includes(status)) {
                    day.anomalyCount += 1;
                    person.anomalyPunches += 1;
                }
                const hhmm = repAttendanceFmtTime(item?.check_time);
                const type = String(item?.type || '').trim();
                if (type === 'clock_in') {
                    if (!day.firstIn || hhmm < day.firstIn) day.firstIn = hhmm;
                } else if (type === 'clock_out') {
                    if (!day.lastOut || hhmm > day.lastOut) day.lastOut = hhmm;
                }
            });

            return Array.from(peopleMap.values()).map(function(person) {
                const days = Array.from(person.dayMap.values()).sort(function(a, b) {
                    return String(b.date || '').localeCompare(String(a.date || ''));
                });
                return {
                    store: person.store,
                    username: person.username,
                    name: person.name,
                    totalPunches: person.totalPunches,
                    anomalyPunches: person.anomalyPunches,
                    checkinDays: days.length,
                    days: days
                };
            }).sort(function(a, b) {
                if (Number(b.checkinDays || 0) !== Number(a.checkinDays || 0)) return Number(b.checkinDays || 0) - Number(a.checkinDays || 0);
                if (Number(b.anomalyPunches || 0) !== Number(a.anomalyPunches || 0)) return Number(b.anomalyPunches || 0) - Number(a.anomalyPunches || 0);
                return String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), 'zh-Hans-CN');
            });
        }

        function repRenderAttendanceReport(resp, store, start, end) {
            const summaryRows = Array.isArray(resp?.summaryRows) ? resp.summaryRows : (Array.isArray(resp?.rows) ? resp.rows : []);
            const checkinDetails = Array.isArray(resp?.checkinDetails) ? resp.checkinDetails : [];
            const digestRows = repBuildAttendanceCheckinDigest(checkinDetails, summaryRows);
            const totals = resp?.totals || summaryRows.reduce(function(acc, row) {
                acc.people += 1;
                acc.actualAttendanceDays += Number(row?.actualAttendanceDays || 0);
                acc.absenceDays += Number(row?.absenceDays || 0);
                acc.lateDays += Number(row?.lateDays || 0);
                acc.restDays += Number(row?.restDays || 0);
                return acc;
            }, { people: 0, actualAttendanceDays: 0, absenceDays: 0, lateDays: 0, restDays: 0 });

            const titleStore = store || '全部门店';
            const hasRegisterData = resp?.hasRegisterData !== false;
            const heroMetric = function(label, value, hint, color) {
                return '<div class="rep-metric" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08);"><div class="k">' + escapeHtml(label) + '</div><div class="v" style="color:' + color + ';">' + escapeHtml(String(value)) + '</div><div style="margin-top:4px; font-size:11px; color:rgba(191,219,254,0.72);">' + escapeHtml(hint) + '</div></div>';
            };
            const statCell = function(label, value, color) {
                return '<div style="padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06);"><div style="font-size:11px; color:rgba(148,163,184,0.9);">' + escapeHtml(label) + '</div><div style="margin-top:4px; font-size:20px; font-weight:900; color:' + color + ';">' + escapeHtml(String(value)) + '</div></div>';
            };

            return `
                <div class="rep-hero" style="background:linear-gradient(135deg, #14532d, #0f766e 58%, #1d4ed8);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                        <div>
                            <div style="font-weight:900; font-size:16px;">${escapeHtml(titleStore)} 考勤核查总览</div>
                            <div class="meta" style="margin-top:6px;">统计周期：${escapeHtml(start)} - ${escapeHtml(end)} · 默认改成先看全局，再展开核查日期</div>
                        </div>
                    </div>
                    <div class="rep-grid">
                        ${heroMetric('员工人数', (totals.people || digestRows.length) + ' 人', '本周期进入汇总的员工', '#f8fafc')}
                        ${heroMetric('实际出勤', Number(totals.actualAttendanceDays || 0) + ' 天', '按日报核对 + 打卡回退', '#86efac')}
                        ${heroMetric('缺勤', Number(totals.absenceDays || 0) + ' 天', '无打卡且未命中休息/休假', '#fca5a5')}
                        ${heroMetric('迟到', Number(totals.lateDays || 0) + ' 天', '以上班首次打卡判断', '#fde68a')}
                        ${heroMetric('休息', Number(totals.restDays || 0) + ' 天', '营业日报排休 + 已批休假', '#93c5fd')}
                        ${heroMetric('打卡轨迹', checkinDetails.length + ' 条', '默认不再直接铺满原始流水', '#c4b5fd')}
                    </div>
                    ${!hasRegisterData ? '<div style="margin-top:12px; padding:10px 12px; border-radius:12px; background:rgba(251,191,36,0.14); border:1px solid rgba(251,191,36,0.22); color:#fde68a; font-size:12px;">当前区间缺少营业日报核对台账，缺勤/休息统计已尽量按打卡回退，但仍建议结合日报补录后再复核。</div>' : ''}
                </div>

                ${(function() {
                    if (!digestRows.length && !summaryRows.length) return '';
                    // Build per-store-per-day map
                    const sdMap = new Map();
                    digestRows.forEach(function(person) {
                        person.days.forEach(function(day) {
                            const key = day.date + '||' + person.store;
                            if (!sdMap.has(key)) sdMap.set(key, { date: day.date, store: person.store, people: [] });
                            const isAnomalous = day.isLate || day.anomalyCount > 0;
                            sdMap.get(key).people.push({ name: person.name || person.username, username: person.username, firstIn: day.firstIn, lastOut: day.lastOut, isLate: day.isLate, anomalyCount: day.anomalyCount, isAnomalous });
                        });
                    });
                    // Add absent employees from summaryRows
                    summaryRows.forEach(function(row) {
                        (Array.isArray(row.absentDates) ? row.absentDates : []).forEach(function(date) {
                            const key = date + '||' + (row.store || '');
                            if (!sdMap.has(key)) sdMap.set(key, { date, store: row.store || '', people: [] });
                            const entry = sdMap.get(key);
                            if (!entry.people.find(function(p) { return p.username === row.username; })) {
                                entry.people.push({ name: row.name || row.username, username: row.username, firstIn: '', lastOut: '', isLate: false, anomalyCount: 0, isAbsent: true, isAnomalous: true });
                            }
                        });
                    });
                    const sdRows = Array.from(sdMap.values()).sort(function(a, b) {
                        if (b.date !== a.date) return b.date.localeCompare(a.date);
                        return (a.store || '').localeCompare(b.store || '');
                    });
                    if (!sdRows.length) return '';
                    const anomTotal = sdRows.reduce(function(s, sd) { return s + sd.people.filter(function(p) { return p.isAnomalous; }).length; }, 0);
                    const parts = [`<details open style="margin-top:14px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);overflow:hidden;"><summary style="list-style:none;cursor:pointer;padding:12px 14px;display:flex;align-items:center;gap:8px;user-select:none;"><span style="font-size:12px;color:rgba(200,215,230,0.78);font-weight:800;flex:1;">打卡全局视图（按门店/日期）</span>${anomTotal > 0 ? `<span style="padding:2px 8px;border-radius:999px;background:rgba(249,115,22,0.18);color:#fdba74;font-size:11px;font-weight:800;">⚠ ${anomTotal} 人异常</span>` : '<span style="padding:2px 8px;border-radius:999px;background:rgba(34,197,94,0.12);color:#86efac;font-size:11px;font-weight:800;">✓ 全部正常</span>'}<span style="font-size:11px;color:rgba(148,163,184,0.5);">▾</span></summary>`, '<div style="display:flex;flex-direction:column;gap:8px;padding:0 10px 12px;">'];
                    sdRows.forEach(function(sd) {
                        const anomPeople = sd.people.filter(function(p) { return p.isAnomalous; });
                        const hasAnom = anomPeople.length > 0;
                        parts.push(`<details style="border-radius:14px;background:${hasAnom ? 'rgba(30,15,5,0.45)' : 'rgba(15,23,42,0.28)'};border:1px solid ${hasAnom ? 'rgba(249,115,22,0.25)' : 'rgba(34,197,94,0.15)'};overflow:hidden;">`);
                        parts.push(`<summary style="list-style:none;cursor:pointer;padding:13px 14px;display:flex;align-items:center;gap:10px;user-select:none;"><span style="display:inline-block;transition:transform .15s;color:rgba(148,163,184,0.8);font-size:12px;">▸</span><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:800;color:#e2e8f0;">${escapeHtml(sd.store || '未知门店')}</div><div style="font-size:11px;color:rgba(148,163,184,0.8);margin-top:2px;">${escapeHtml(sd.date)} · ${escapeHtml(String(sd.people.length))} 人打卡</div></div>${hasAnom ? `<span style="padding:3px 10px;border-radius:999px;background:rgba(249,115,22,0.18);color:#fdba74;font-size:11px;font-weight:800;">⚠ ${escapeHtml(String(anomPeople.length))} 人异常</span>` : '<span style="padding:3px 10px;border-radius:999px;background:rgba(34,197,94,0.15);color:#86efac;font-size:11px;font-weight:800;">✓ 正常</span>'}</summary>`);
                        if (hasAnom) {
                            parts.push(`<div style="padding:0 14px 14px;border-top:1px solid var(--pf-line);">`);
                            anomPeople.forEach(function(p) {
                                const label = p.isAbsent ? '未打卡' : (p.isLate ? '迟到' + (p.firstIn ? ' ' + p.firstIn : '') : '异常打卡');
                                parts.push(`<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><div style="width:6px;height:6px;border-radius:50%;background:${p.isAbsent ? '#f87171' : '#fbbf24'};flex-shrink:0;"></div><div style="flex:1;"><div style="font-size:12px;font-weight:700;color:#e2e8f0;">${escapeHtml(p.name || p.username || '—')}</div></div><span style="font-size:11px;padding:2px 8px;border-radius:6px;background:${p.isAbsent ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)'};color:${p.isAbsent ? '#fca5a5' : '#fde68a'};">${escapeHtml(label)}</span></div>`);
                            });
                            parts.push(`</div>`);
                        } else {
                            parts.push(`<div style="padding:10px 14px 12px;font-size:12px;color:rgba(134,239,172,0.7);">当日所有打卡记录均正常 ✓</div>`);
                        }
                        parts.push('</details>');
                    });
                    parts.push('</div></details>');
                    return parts.join('');
                })()}

                ${summaryRows.length ? `
                <details open style="margin-top:14px;border-radius:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
                <summary style="list-style:none;cursor:pointer;padding:12px 14px;display:flex;align-items:center;gap:8px;user-select:none;"><span style="font-size:12px;color:rgba(200,215,230,0.78);font-weight:800;flex:1;">打卡出勤汇总（${summaryRows.length} 人）</span><span style="font-size:11px;color:rgba(148,163,184,0.5);">▾</span></summary>
                <div style="display:grid; grid-template-columns:1fr; gap:12px; padding:0 10px 12px;">
                    ${summaryRows.map(function(row) {
                        return `
                        <details style="border-radius:18px; background:linear-gradient(180deg, rgba(15,23,42,0.72), rgba(2,6,23,0.88)); border:1px solid rgba(255,255,255,0.08); overflow:hidden;">
                            <summary style="list-style:none; cursor:pointer; padding:16px; display:flex; justify-content:space-between; align-items:flex-start; gap:14px;">
                                <div>
                                    <div style="font-size:14px; font-weight:900; color:#f8fafc;">${escapeHtml(row.name || row.username || '-')}</div>
                                    <div style="margin-top:4px; font-size:11px; color:rgba(148,163,184,0.88);">${escapeHtml(row.store || '-')} · ${escapeHtml(row.username || '-')}</div>
                                </div>
                                <div style="font-size:11px; color:rgba(148,163,184,0.84); white-space:nowrap;">点击展开日期核查</div>
                            </summary>
                            <div style="padding:0 16px 16px;">
                                <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px;">
                                    ${statCell('实际出勤', row.actualAttendanceDays || 0, '#86efac')}
                                    ${statCell('缺勤', row.absenceDays || 0, '#fca5a5')}
                                    ${statCell('迟到', row.lateDays || 0, '#fde68a')}
                                    ${statCell('休息', row.restDays || 0, '#93c5fd')}
                                </div>
                                <div style="margin-top:14px; display:grid; grid-template-columns:1fr; gap:12px;">
                                    <div>
                                        <div style="font-size:11px; color:rgba(148,163,184,0.88); margin-bottom:8px;">实际出勤日期</div>
                                        <div style="display:flex; flex-wrap:wrap; gap:8px;">${repAttendanceDateTags(row.actualDates, 'green', '无')}</div>
                                    </div>
                                    <div>
                                        <div style="font-size:11px; color:rgba(148,163,184,0.88); margin-bottom:8px;">缺勤日期</div>
                                        <div style="display:flex; flex-wrap:wrap; gap:8px;">${repAttendanceDateTags(row.absentDates, 'red', '无缺勤')}</div>
                                    </div>
                                    <div>
                                        <div style="font-size:11px; color:rgba(148,163,184,0.88); margin-bottom:8px;">迟到日期</div>
                                        <div style="display:flex; flex-wrap:wrap; gap:8px;">${repAttendanceDateTags(row.lateDates, 'amber', '无迟到')}</div>
                                    </div>
                                    <div>
                                        <div style="font-size:11px; color:rgba(148,163,184,0.88); margin-bottom:8px;">休息 / 可抵扣日期</div>
                                        <div style="display:flex; flex-wrap:wrap; gap:8px;">${repAttendanceDateTags(row.restOffsetDates || row.restDates, 'blue', '无休息/休假')}</div>
                                    </div>
                                </div>
                            </div>
                        </details>`;
                    }).join('')}
                </div></details>` : ''}

                ${!summaryRows.length && !digestRows.length ? '<div style="color:rgba(200,215,230,0.52); padding:24px; text-align:center;">暂无考勤数据</div>' : ''}
            `;
        }

        var __REP_MUTATION_OBSERVER = null;
        function initReportsEnhancementsObserver() {
            if (__REP_MUTATION_OBSERVER) return;
            const root = document.getElementById('reports-page');
            if (!root || typeof MutationObserver === 'undefined') return;
            __REP_MUTATION_OBSERVER = new MutationObserver(() => {
                enhanceReportsResponsiveTables(root);
                autoCollapseReportsFiltersIfNeeded();
            });
            __REP_MUTATION_OBSERVER.observe(root, { childList: true, subtree: true });
        }

        function showReportsTab(tab) {
            const t = String(tab || '').trim() || 'business';
            __REP_TAB = t;
            const ids = ['business', 'attendance', 'daily-attendance-register', 'payroll', 'inventory-forecast', 'promotions', 'turnover', 'leave-owed'];
            ids.forEach(x => {
                const box = document.getElementById('rep-' + x);
                if (box) box.classList.toggle('hidden', x !== t);
                const btn = document.getElementById('rep-tab-' + x);
                if (btn) {
                    btn.classList.toggle('rep-tab--active', x === t);
                    btn.setAttribute('aria-selected', x === t ? 'true' : 'false');
                }
            });
            initReportsEnhancementsObserver();
            autoCollapseReportsFiltersIfNeeded();
            renderReportsOverview();
        }

        function maybeOpenSmartAssistantFromRoute() {
            const hash = String(window.location.hash || '').trim().toLowerCase();
            if (hash !== '#smart-assistant' && hash !== '#inventory-forecast' && hash !== '#gross-margin') return false;
            try { showPage('reports'); } catch (e) {}
            try { showReportsTab('inventory-forecast'); } catch (e) {}
            try { loadReportsData(); } catch (e) {}
            try {
                if (window.history && window.history.replaceState) {
                    window.history.replaceState(null, '', window.location.pathname + window.location.search);
                }
            } catch (e) {}
            return true;
        }

        async function loadAttentionReport() {
            const box = document.getElementById('rep-attention-box');
            if (!box) return;
            box.innerHTML = '<div style="color:rgba(200,215,230,0.6); text-align:center; padding:24px 0;">加载中...</div>';
            try {
                const base = String(HRMS_API.baseUrl() || '').replace(/\/$/, '');
                const token = String(HRMS_API.token() || '').trim();
                if (!token) { box.innerHTML = '<div style="color:#c2410c;">请先登录</div>'; return; }

                const resp = await fetch(base + '/api/attention-scores/summary', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) {
                    if (resp.status === 403) { box.innerHTML = '<div style="color:#c2410c;">无权限查看专注度报告</div>'; return; }
                    throw new Error('HTTP ' + resp.status);
                }
                const data = await resp.json();
                const summary = Array.isArray(data?.summary) ? data.summary : [];

                if (!summary.length) {
                    box.innerHTML = '<div style="color:rgba(200,215,230,0.6); text-align:center; padding:24px 0;">暂无专注度数据</div>';
                    return;
                }

                let html = '<div style="margin-bottom:12px; font-size:13px; font-weight:800; color:rgba(226,232,240,0.95);">📊 培训专注度汇总（按员工）</div>';
                html += '<div style="overflow-x:auto;">';
                html += '<table style="width:100%; border-collapse:collapse; font-size:12px;">';
                html += '<thead><tr style="background:rgba(255,255,255,0.06);">';
                html += '<th style="padding:10px 8px; text-align:left; color:rgba(200,215,230,0.8); font-weight:700; border-bottom:1px solid rgba(255,255,255,0.08);">员工</th>';
                html += '<th style="padding:10px 8px; text-align:left; color:rgba(200,215,230,0.8); font-weight:700; border-bottom:1px solid rgba(255,255,255,0.08);">门店</th>';
                html += '<th style="padding:10px 8px; text-align:center; color:rgba(200,215,230,0.8); font-weight:700; border-bottom:1px solid rgba(255,255,255,0.08);">学习次数</th>';
                html += '<th style="padding:10px 8px; text-align:center; color:rgba(200,215,230,0.8); font-weight:700; border-bottom:1px solid rgba(255,255,255,0.08);">平均专注度</th>';
                html += '<th style="padding:10px 8px; text-align:center; color:rgba(200,215,230,0.8); font-weight:700; border-bottom:1px solid rgba(255,255,255,0.08);">总时长</th>';
                html += '<th style="padding:10px 8px; text-align:right; color:rgba(200,215,230,0.8); font-weight:700; border-bottom:1px solid rgba(255,255,255,0.08);">最近学习</th>';
                html += '</tr></thead><tbody>';

                for (const row of summary) {
                    const avgScore = Number(row.avg_score || 0);
                    const scoreColor = avgScore >= 70 ? '#22c55e' : avgScore >= 40 ? '#eab308' : '#ef4444';
                    const totalMin = Math.round(Number(row.total_duration || 0) / 60);
                    const lastDate = row.last_session ? new Date(row.last_session).toLocaleDateString('zh-CN') : '-';

                    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">';
                    html += `<td style="padding:10px 8px; color:rgba(226,232,240,0.95); font-weight:700;">${escapeHtml(row.name || row.username || '-')}</td>`;
                    html += `<td style="padding:10px 8px; color:rgba(200,215,230,0.7);">${escapeHtml(row.store || '-')}</td>`;
                    html += `<td style="padding:10px 8px; text-align:center; color:rgba(226,232,240,0.9);">${Number(row.session_count || 0)}</td>`;
                    html += `<td style="padding:10px 8px; text-align:center;"><span style="display:inline-block; padding:3px 10px; border-radius:8px; font-weight:800; font-size:13px; color:${scoreColor}; background:${scoreColor}18;">${avgScore}%</span></td>`;
                    html += `<td style="padding:10px 8px; text-align:center; color:rgba(200,215,230,0.7);">${totalMin} 分钟</td>`;
                    html += `<td style="padding:10px 8px; text-align:right; color:rgba(200,215,230,0.7);">${lastDate}</td>`;
                    html += '</tr>';
                }

                html += '</tbody></table></div>';

                // 添加详细记录按钮
                html += '<div style="margin-top:16px; text-align:center;">';
                html += '<button class="btn btn-secondary" type="button" data-click="loadAttentionDetail" style="padding:8px 18px; font-size:12px; border-radius:8px;">查看详细记录</button>';
                html += '</div>';
                html += '<div id="rep-attention-detail" style="margin-top:12px;"></div>';

                box.innerHTML = html;
            } catch (e) {
                box.innerHTML = '<div style="color:#c2410c; font-size:12px;">加载失败: ' + escapeHtml(String(e?.message || e)) + '</div>';
            }
        }

        async function loadAttentionDetail() {
            const box = document.getElementById('rep-attention-detail');
            if (!box) return;
            box.innerHTML = '<div style="color:rgba(200,215,230,0.6); text-align:center; padding:12px 0;">加载中...</div>';
            try {
                const base = String(HRMS_API.baseUrl() || '').replace(/\/$/, '');
                const token = String(HRMS_API.token() || '').trim();
                const resp = await fetch(base + '/api/attention-scores?limit=100', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                const scores = Array.isArray(data?.scores) ? data.scores : [];

                if (!scores.length) {
                    box.innerHTML = '<div style="color:rgba(200,215,230,0.6); text-align:center; padding:12px 0;">暂无详细记录</div>';
                    return;
                }

                let html = '<div style="font-size:12px; font-weight:800; color:rgba(226,232,240,0.9); margin-bottom:8px;">📋 详细学习记录（最近100条）</div>';
                html += '<div style="overflow-x:auto;">';
                html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
                html += '<thead><tr style="background:rgba(255,255,255,0.05);">';
                html += '<th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">员工</th>';
                html += '<th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">资料</th>';
                html += '<th style="padding:8px 6px; text-align:center; color:rgba(200,215,230,0.7); font-weight:700;">专注度</th>';
                html += '<th style="padding:8px 6px; text-align:center; color:rgba(200,215,230,0.7); font-weight:700;">时长</th>';
                html += '<th style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.7); font-weight:700;">时间</th>';
                html += '</tr></thead><tbody>';

                for (const s of scores) {
                    const sc = Number(s.score || s.avg_score || 0);
                    const scColor = sc >= 70 ? '#22c55e' : sc >= 40 ? '#eab308' : '#ef4444';
                    const dur = Math.round(Number(s.duration_seconds || 0) / 60);
                    const dt = s.created_at ? new Date(s.created_at).toLocaleString('zh-CN') : '-';

                    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.03);">';
                    html += `<td style="padding:8px 6px; color:rgba(226,232,240,0.9); font-weight:600;">${escapeHtml(s.name || s.username || '-')}</td>`;
                    html += `<td style="padding:8px 6px; color:rgba(200,215,230,0.7); max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(s.material_title || s.material_id || '-')}</td>`;
                    html += `<td style="padding:8px 6px; text-align:center;"><span style="color:${scColor}; font-weight:800;">${sc}%</span></td>`;
                    html += `<td style="padding:8px 6px; text-align:center; color:rgba(200,215,230,0.7);">${dur}分</td>`;
                    html += `<td style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.6);">${dt}</td>`;
                    html += '</tr>';
                }

                html += '</tbody></table></div>';
                box.innerHTML = html;
            } catch (e) {
                box.innerHTML = '<div style="color:#c2410c; font-size:12px;">加载失败: ' + escapeHtml(String(e?.message || e)) + '</div>';
            }
        }

        function repDefaultRange() {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const start = `${yyyy}-${mm}-01`;
            const end = `${yyyy}-${mm}-${dd}`;
            return { start, end, month: `${yyyy}-${mm}` };
        }

        var __BIZ_VIEW = 'table';
        var __REP_INV_STATE = null;

        function repInventoryForecastDefaultState() {
            const d = new Date();
            const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return {
                date,
                grossMarginStartDate: date,
                grossMarginEndDate: date,
                grossMarginBizType: '',
                weather: '',
                isHoliday: false,
                expectedRevenueTakeaway: 10000,
                expectedRevenueDinein: 10000,
                topN: 20,
                historyBizType: 'takeaway'
            };
        }

        function repCollectInventoryForecastState() {
            const prev = (__REP_INV_STATE && typeof __REP_INV_STATE === 'object') ? __REP_INV_STATE : repInventoryForecastDefaultState();
            const dateVal = String(document.getElementById('rep-inv-date')?.value || prev.date || '').trim();
            const weatherVal = String(document.getElementById('rep-inv-weather')?.value || prev.weather || '').trim();
            const isHolidayVal = !!document.getElementById('rep-inv-holiday')?.checked;
            const gmStartVal = String(document.getElementById('rep-gm-start-date')?.value || prev.grossMarginStartDate || '').trim();
            const gmEndVal = String(document.getElementById('rep-gm-end-date')?.value || prev.grossMarginEndDate || '').trim();
            const gmBizTypeVal = String(document.getElementById('rep-gm-biz-type')?.value || prev.grossMarginBizType || '').trim();
            const revTakeawayRaw = Number(document.getElementById('rep-inv-revenue-takeaway')?.value);
            const revDineinRaw = Number(document.getElementById('rep-inv-revenue-dinein')?.value);
            const topNRaw = Number(document.getElementById('rep-inv-topn')?.value);
            const histBiz = String(document.getElementById('rep-inv-history-biz')?.value || prev.historyBizType || 'takeaway').trim();
            const prevTakeaway = Number(prev.expectedRevenueTakeaway ?? prev.expectedRevenue ?? 10000);
            const prevDinein = Number(prev.expectedRevenueDinein ?? prev.expectedRevenue ?? 10000);
            __REP_INV_STATE = {
                date: /^\d{4}-\d{2}-\d{2}$/.test(dateVal) ? dateVal : prev.date,
                grossMarginStartDate: /^\d{4}-\d{2}-\d{2}$/.test(gmStartVal) ? gmStartVal : prev.grossMarginStartDate,
                grossMarginEndDate: /^\d{4}-\d{2}-\d{2}$/.test(gmEndVal) ? gmEndVal : prev.grossMarginEndDate,
                grossMarginBizType: (gmBizTypeVal === 'takeaway' || gmBizTypeVal === 'dinein') ? gmBizTypeVal : '',
                weather: weatherVal,
                isHoliday: isHolidayVal,
                expectedRevenueTakeaway: Number.isFinite(revTakeawayRaw) && revTakeawayRaw >= 0 ? revTakeawayRaw : (Number.isFinite(prevTakeaway) ? prevTakeaway : 10000),
                expectedRevenueDinein: Number.isFinite(revDineinRaw) && revDineinRaw >= 0 ? revDineinRaw : (Number.isFinite(prevDinein) ? prevDinein : 10000),
                topN: Number.isFinite(topNRaw) ? Math.max(5, Math.min(80, topNRaw)) : Number(prev.topN || 20),
                historyBizType: (histBiz === 'dinein' ? 'dinein' : 'takeaway')
            };
            return __REP_INV_STATE;
        }

        function repInventoryForecastRun() {
            repCollectInventoryForecastState();
            loadReportsData();
        }

        function repBuildGrossProfitProfileText(items) {
            const list = Array.isArray(items) ? items : [];
            return list
                .map((x) => {
                    const product = String(x?.product || '').trim();
                    const bizType = String(x?.bizType || '').trim();
                    const gross = Number(x?.grossPerUnit || 0);
                    if (!product || !Number.isFinite(gross) || gross < 0) return '';
                    const bizLabel = bizType === 'takeaway' ? '外卖' : (bizType === 'dinein' ? '堂食' : '');
                    return `${product},${bizLabel},${gross}`;
                })
                .filter(Boolean)
                .join('\n');
        }

        function repParseGrossProfitProfileText(text) {
            const rows = String(text || '').split(/\r?\n/).map((x) => String(x || '').trim()).filter(Boolean);
            const out = [];
            rows.forEach((line) => {
                const cols = String(line).split(/[，,\t]/).map((x) => String(x || '').trim()).filter(Boolean);
                if (cols.length < 2) return;
                const product = String(cols[0] || '').trim();
                if (!product) return;

                let bizType = '';
                let grossRaw = '';
                if (cols.length >= 3) {
                    bizType = repNormalizeForecastBizTypeInput(cols[1]);
                    grossRaw = cols[2];
                } else {
                    grossRaw = cols[1];
                }
                const grossPerUnit = Number(grossRaw);
                if (!Number.isFinite(grossPerUnit) || grossPerUnit < 0) return;
                out.push({ product, bizType, grossPerUnit: Number(grossPerUnit.toFixed(4)) });
            });
            return out;
        }

        async function repSaveGrossProfitProfiles() {
            if (!currentUser) return;
            const store = String(document.getElementById('rep-store')?.value || '').trim();
            const brandId = normalizeBrandIdInput(document.getElementById('rep-brand')?.value || '');
            if (!brandId) {
                showNotification('请先选择品牌', 'warning');
                return;
            }
            const txt = String(document.getElementById('rep-gross-profile-editor')?.value || '').trim();
            const items = repParseGrossProfitProfileText(txt);
            if (!items.length) {
                showNotification('请先填写毛利配置，格式：产品,业务类型(可空),单份毛利', 'warning');
                return;
            }
            try {
                const resp = await HRMS_API.saveForecastGrossProfitProfiles({
                    brandId,
                    replace: true,
                    items
                });
                showNotification(`毛利配置已保存：${Number(resp?.count || items.length)} 条`, 'success');
                loadReportsData();
            } catch (e) {
                showNotification('毛利配置保存失败：' + String(e?.message || e), 'error');
            }
        }

        function repBuildProductAliasRulesText(items) {
            const list = Array.isArray(items) ? items : [];
            return list
                .map((x) => {
                    const canonical = String(x?.canonical || '').trim();
                    const aliases = Array.isArray(x?.aliases) ? x.aliases : [];
                    const aliasStr = aliases.map(a => String(a || '').trim()).filter(Boolean).join('、');
                    if (!canonical) return '';
                    return aliasStr ? `${canonical} => ${aliasStr}` : canonical;
                })
                .filter(Boolean)
                .join('\n');
        }

        function repParseProductAliasRulesText(text) {
            const rows = String(text || '').split(/\r?\n/).map((x) => String(x || '').trim()).filter(Boolean);
            const out = [];
            rows.forEach((line) => {
                const parts = String(line).split(/=>|＝>|=＞/).map((x) => String(x || '').trim()).filter(Boolean);
                const canonical = String(parts[0] || '').trim();
                if (!canonical) return;
                const aliasPart = String(parts[1] || '').trim();
                const aliases = aliasPart
                    ? aliasPart.split(/[、，,\/\|\s]+/g).map((x) => String(x || '').trim()).filter(Boolean)
                    : [];
                out.push({ canonical, aliases });
            });
            return out;
        }

        async function repSaveProductAliasRules() {
            if (!currentUser) return;
            const brandId = normalizeBrandIdInput(document.getElementById('rep-brand')?.value || '');
            if (!brandId) {
                showNotification('请先选择品牌', 'warning');
                return;
            }
            const txt = String(document.getElementById('rep-product-alias-editor')?.value || '').trim();
            const rules = repParseProductAliasRulesText(txt);
            if (!rules.length) {
                showNotification('请先填写别名规则，格式：标准名 => 别名1、别名2', 'warning');
                return;
            }
            try {
                const existing = await HRMS_API.getForecastProductAliases({ brandId });
                const exItems = Array.isArray(existing?.items) ? existing.items : [];
                for (const it of exItems) {
                    const id = String(it?.id || '').trim();
                    if (!id) continue;
                    try { await HRMS_API.deleteForecastProductAlias(id); } catch (e) {}
                }

                let ok = 0;
                for (const r of rules) {
                    await HRMS_API.createForecastProductAlias({ brandId, canonical: r.canonical, aliases: r.aliases });
                    ok += 1;
                }
                showNotification(`别名规则已保存：${ok} 条（按品牌隔离）`, 'success');
                loadReportsData();
            } catch (e) {
                showNotification('别名规则保存失败：' + String(e?.message || e), 'error');
            }
        }

        function repCsvSplitLine(line) {
            const out = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i += 1) {
                const ch = line[i];
                if (ch === '"') {
                    if (inQuotes && line[i + 1] === '"') {
                        cur += '"';
                        i += 1;
                    } else {
                        inQuotes = !inQuotes;
                    }
                    continue;
                }
                if (ch === ',' && !inQuotes) {
                    out.push(cur);
                    cur = '';
                    continue;
                }
                cur += ch;
            }
            out.push(cur);
            return out;
        }

        function repNormalizeForecastBizTypeInput(input) {
            const v = String(input || '').trim().toLowerCase();
            if (!v) return '';
            if (v.includes('堂食') || v === 'dinein' || v === 'dine_in' || v === 'eatin' || v === '堂吃') return 'dinein';
            if (v.includes('外卖') || v.includes('外送') || v === 'takeaway' || v === 'delivery') return 'takeaway';
            return '';
        }

        function repNormalizeForecastSlotInput(input) {
            const raw = String(input || '').trim();
            const v = raw.toLowerCase();
            if (!raw) return '';
            if (v.includes('午') || v.includes('lunch') || v.includes('noon')) return 'lunch';
            if (v.includes('下午') || v.includes('tea') || v.includes('afternoon')) return 'afternoon';
            if (v.includes('晚') || v.includes('dinner') || v.includes('night')) return 'dinner';
            const hm = raw.match(/(\d{1,2})[:：](\d{1,2})/);
            if (hm) {
                const hour = Number(hm[1]);
                if (Number.isFinite(hour)) {
                    if (hour >= 10 && hour < 14) return 'lunch';
                    if (hour >= 14 && hour < 17) return 'afternoon';
                    if (hour >= 17 && hour < 22) return 'dinner';
                }
            }
            return '';
        }

        function repNormalizeUploadDate(input) {
            const v = String(input || '').trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
            const cn = v.match(/^(\d{1,2})月(\d{1,2})日$/);
            if (cn) {
                const y = new Date().getFullYear();
                const m = String(Math.max(1, Math.min(12, Number(cn[1] || 1)))).padStart(2, '0');
                const d = String(Math.max(1, Math.min(31, Number(cn[2] || 1)))).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
            return '';
        }

        function repParseInventoryCsvRows(text) {
            const rows = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(x => String(x || '').trim()).filter(Boolean);
            if (rows.length < 2) return [];

            const normalizeHeader = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, '');
            const headersRaw = repCsvSplitLine(rows[0]);
            const headers = headersRaw.map(normalizeHeader);
            const idx = (names) => {
                for (const n of names) {
                    const i = headers.indexOf(normalizeHeader(n));
                    if (i >= 0) return i;
                }
                return -1;
            };

            const iDate = idx(['date', '日期']);
            const iSaleDate = idx(['销售日期']);
            const iWeather = idx(['weather', '天气']);
            const iHoliday = idx(['isholiday', 'holiday', '是否假日', '是否节假日']);
            const iRevenue = idx(['expectedrevenue', 'revenue', '预计营收', '营收']);
            const iSaleAmount = idx(['销售金额', '销售额']);
            const iSaleType = idx(['销售类型']);
            const iSlotName = idx(['餐/时段名称', '时段名称', '餐时段', '时段']);
            const iProducts = idx(['products', 'productquantities', '产品json']);
            const iProduct = idx(['product', '产品', '菜品名称']);
            const iQty = idx(['qty', 'quantity', '数量', '销售数量']);

            const dateIndex = iDate >= 0 ? iDate : iSaleDate;
            const revenueIndex = iRevenue >= 0 ? iRevenue : iSaleAmount;
            if (dateIndex < 0) return [];

            const grouped = new Map();
            for (let r = 1; r < rows.length; r += 1) {
                const cols = repCsvSplitLine(rows[r]);
                const date = repNormalizeUploadDate(String(cols[dateIndex] || '').trim());
                if (!date) continue;
                const rowBizType = iSaleType >= 0 ? repNormalizeForecastBizTypeInput(cols[iSaleType]) : '';
                const rowSlot = iSlotName >= 0 ? repNormalizeForecastSlotInput(cols[iSlotName]) : '';
                const weather = iWeather >= 0 ? String(cols[iWeather] || '').trim() : '';
                const holidayRaw = iHoliday >= 0 ? String(cols[iHoliday] || '').trim().toLowerCase() : '';
                const isHoliday = holidayRaw === '1' || holidayRaw === 'true' || holidayRaw === '是' || holidayRaw === 'y';
                const rev = revenueIndex >= 0 ? Number(cols[revenueIndex]) : 0;
                const expectedRevenue = Number.isFinite(rev) ? rev : 0;
                const key = `${date}||${weather}||${isHoliday ? '1' : '0'}||${expectedRevenue}||${rowBizType || '-'}||${rowSlot || '-'}`;

                if (!grouped.has(key)) {
                    grouped.set(key, {
                        date,
                        weather,
                        isHoliday,
                        expectedRevenue,
                        productQuantities: {},
                        __bizType: rowBizType,
                        __slot: rowSlot
                    });
                }
                const rowObj = grouped.get(key);

                if (iProducts >= 0) {
                    const rawProducts = String(cols[iProducts] || '').trim();
                    if (rawProducts) {
                        try {
                            const parsed = JSON.parse(rawProducts);
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                Object.keys(parsed).forEach((k) => {
                                    const name = String(k || '').trim();
                                    const qty = Number(parsed[k]);
                                    if (!name || !Number.isFinite(qty) || qty < 0) return;
                                    rowObj.productQuantities[name] = Number((Number(rowObj.productQuantities[name] || 0) + qty).toFixed(2));
                                });
                                continue;
                            }
                        } catch (e) {}
                    }
                }

                if (iProduct >= 0 && iQty >= 0) {
                    const pName = String(cols[iProduct] || '').trim();
                    const pQty = Number(cols[iQty]);
                    if (pName && Number.isFinite(pQty) && pQty >= 0) {
                        rowObj.productQuantities[pName] = Number((Number(rowObj.productQuantities[pName] || 0) + pQty).toFixed(2));
                    }
                }
            }
            return Array.from(grouped.values()).filter(x => Object.keys(x.productQuantities || {}).length > 0);
        }

        async function repInventoryForecastUpload() {
            if (!currentUser) return;
            showNotification('智能助手已改为自动读取销售明细（pos_sales_detail），无需再手动上传历史数据。', 'info');
            loadReportsData();
        }

        function renderInventoryForecastReport(data, box) {
            if (!box) return;
            const state = data?.state || repInventoryForecastDefaultState();
            const predMap = data?.predMap || {};
            const historyRows = Array.isArray(data?.historyRows) ? data.historyRows : [];
            const accuracySummary = data?.accuracySummary || {};
            const accuracyItems = Array.isArray(data?.accuracyItems) ? data.accuracyItems : [];
            const revenueEstimate = data?.revenueEstimate?.estimate || {};
            const grossMarginEstimate = data?.grossMarginEstimate?.estimate || {};
            const grossProfiles = Array.isArray(data?.grossProfiles) ? data.grossProfiles : [];
            const historyBizType = String(state.historyBizType || 'takeaway').trim();
            const store = String(data?.store || '').trim();
            const brandId = normalizeBrandIdInput(data?.brandId || document.getElementById('rep-brand')?.value || '');
            const brandName = String(data?.brandName || getBrandNameById(brandId) || '').trim();
            const revenueTakeaway = Number(revenueEstimate?.byBizType?.takeaway?.estimatedRevenue || 0);
            const revenueDinein = Number(revenueEstimate?.byBizType?.dinein?.estimatedRevenue || 0);
            const revenueTakeawayEnabled = !!revenueEstimate?.byBizType?.takeaway?.enabled;
            const revenueDineinEnabled = !!revenueEstimate?.byBizType?.dinein?.enabled;
            const grossMarginRate = Number(grossMarginEstimate?.marginRate || 0);
            const grossActualMarginRate = Number(grossMarginEstimate?.actualMarginRate || 0);
            const grossRevenue = Number(grossMarginEstimate?.revenue || 0);
            const grossActualRevenue = Number(grossMarginEstimate?.actualRevenue || 0);
            const grossProfit = Number(grossMarginEstimate?.grossProfit || 0);
            const uncoveredProducts = Array.isArray(grossMarginEstimate?.uncoveredProducts) ? grossMarginEstimate.uncoveredProducts : [];
            const grossProfileText = repBuildGrossProfitProfileText(grossProfiles);
            const productAliasText = repBuildProductAliasRulesText(Array.isArray(data?.productAliases) ? data.productAliases : []);

            const fmt = (n) => {
                const v = Number(n || 0);
                return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
            };
            const slotLabel = (s) => (s === 'dinner' ? '晚市' : (s === 'afternoon' ? '下午茶' : '午市'));
            const bizLabel = (b) => (b === 'dinein' ? '堂食' : '外卖');
            const pick = (bizType, slot) => predMap[`${bizType}||${slot}`] || null;
            const renderPredBlock = (bizType, slot) => {
                const rec = pick(bizType, slot) || {};
                const predictions = Array.isArray(rec?.predictions) ? rec.predictions.slice(0, 6) : [];
                const sourceLabel = rec?.source === 'ai' ? 'AI模型' : '历史加权';
                return `
                    <div style="padding:12px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08);">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <div style="font-weight:900; font-size:13px; color:rgba(226,232,240,0.95);">${slotLabel(slot)}</div>
                            <div style="font-size:11px; color:rgba(200,215,230,0.65);">${sourceLabel} · 置信度 ${fmt(Number(rec?.confidence || 0) * 100)}%</div>
                        </div>
                        <div style="margin-top:8px; display:grid; gap:6px;">
                            ${predictions.map(p => `
                                <div style="display:flex; justify-content:space-between; gap:8px; font-size:12px;">
                                    <span style="color:rgba(226,232,240,0.9);">${escapeHtml(String(p?.product || ''))}</span>
                                    <span style="font-weight:800; color:#22c55e;">${fmt(p?.qty)} 份</span>
                                </div>
                            `).join('')}
                            ${predictions.length ? '' : '<div style="font-size:12px; color:rgba(200,215,230,0.5);">暂无预测结果</div>'}
                        </div>
                    </div>
                `;
            };

            const html = `
                <div class="rep-hero" style="background:linear-gradient(135deg, #0f766e, #0ea5e9);">
                    <div style="font-weight:900; font-size:16px;">智能助手（品牌级）</div>
                    <div class="meta" style="margin-top:6px;">品牌：${escapeHtml(brandName || '-')}${store ? ` · 门店：${escapeHtml(store)}` : ''} · 模糊归类与毛利配置按品牌隔离</div>
                    <div class="rep-grid" style="margin-top:10px;">
                        <div class="rep-metric"><div class="k">预测日期</div><div class="v">${escapeHtml(String(state.date || '-'))}</div></div>
                        <div class="rep-metric"><div class="k">外卖预计营收</div><div class="v">¥${fmt(state.expectedRevenueTakeaway ?? state.expectedRevenue ?? 0)}</div></div>
                        <div class="rep-metric"><div class="k">堂食预计营收</div><div class="v">¥${fmt(state.expectedRevenueDinein ?? state.expectedRevenue ?? 0)}</div></div>
                        <div class="rep-metric"><div class="k">历史样本</div><div class="v">${historyRows.length} 条</div></div>
                        <div class="rep-metric"><div class="k">折前毛利率</div><div class="v">${fmt(grossMarginRate * 100)}%</div></div>
                        <div class="rep-metric"><div class="k">实收毛利率</div><div class="v" style="color:#f59e0b;">${grossActualRevenue > 0 ? fmt(grossActualMarginRate * 100) + '%' : '--'}</div></div>
                    </div>
                </div>

                <div style="margin-top:12px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px;">
                    <div class="rep-metric"><div class="k">预估营业额-外卖</div><div class="v">${revenueTakeawayEnabled ? `¥${fmt(revenueTakeaway)}` : '无外卖样本'}</div></div>
                    <div class="rep-metric"><div class="k">预估营业额-堂食</div><div class="v">${revenueDineinEnabled ? `¥${fmt(revenueDinein)}` : '无堂食样本'}</div></div>
                    <div class="rep-metric"><div class="k">预估营业额-合计</div><div class="v">¥${fmt(Number(revenueEstimate?.totalEstimatedRevenue || 0))}</div></div>
                </div>

                <div style="margin-top:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                    <div style="font-size:12px; font-weight:800; color:rgba(226,232,240,0.9); margin-bottom:8px;">预估毛利率（按历史销售+毛利配置）</div>
                    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-bottom:8px;">
                        <input id="rep-gm-start-date" type="date" value="${escapeHtml(String(state.grossMarginStartDate || state.date || ''))}" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff; color-scheme:dark;" />
                        <input id="rep-gm-end-date" type="date" value="${escapeHtml(String(state.grossMarginEndDate || state.date || ''))}" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff; color-scheme:dark;" />
                        <select id="rep-gm-biz-type" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff;">
                            <option value="" ${!state.grossMarginBizType ? 'selected' : ''}>全部业务</option>
                            <option value="takeaway" ${state.grossMarginBizType === 'takeaway' ? 'selected' : ''}>仅外卖</option>
                            <option value="dinein" ${state.grossMarginBizType === 'dinein' ? 'selected' : ''}>仅堂食</option>
                        </select>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px;">
                        <div class="rep-metric"><div class="k">样本天数</div><div class="v">${Number(grossMarginEstimate?.sampleCount || 0)}</div></div>
                        <div class="rep-metric"><div class="k">折前营收</div><div class="v">¥${fmt(grossRevenue)}</div></div>
                        <div class="rep-metric"><div class="k">实收营收</div><div class="v" style="color:#f59e0b;">¥${grossActualRevenue > 0 ? fmt(grossActualRevenue) : '--'}</div></div>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:8px;">
                        <div class="rep-metric"><div class="k">毛利额</div><div class="v">¥${fmt(grossProfit)}</div></div>
                        <div class="rep-metric"><div class="k">折前毛利率</div><div class="v">${fmt(grossMarginRate * 100)}%</div></div>
                        <div class="rep-metric"><div class="k">实收毛利率</div><div class="v" style="color:#f59e0b;">${grossActualRevenue > 0 ? fmt(grossActualMarginRate * 100) + '%' : '--'}</div></div>
                    </div>
                    <div style="margin-top:8px; font-size:11px; color:rgba(200,215,230,0.66);">
                        未配置毛利产品：${uncoveredProducts.length ? escapeHtml(uncoveredProducts.slice(0, 8).map(x => x.product).join('、')) : '无'}
                    </div>
                </div>

                <div style="margin-top:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                    <div style="font-size:12px; font-weight:800; color:rgba(226,232,240,0.92); margin-bottom:8px;">产品毛利配置（品牌：${escapeHtml(brandName || '-')}; 每行：产品,业务类型(可空),单份毛利）</div>
                    <textarea id="rep-gross-profile-editor" rows="6" style="width:100%; padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff; font-size:12px;">${escapeHtml(grossProfileText)}</textarea>
                    <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                        <button class="btn" type="button" data-click="repSaveGrossProfitProfiles" style="padding:8px 12px; border-radius:8px;">保存毛利配置</button>
                        <button class="btn btn-secondary" type="button" data-click="repInventoryForecastRun" style="padding:8px 12px; border-radius:8px;">刷新预估结果</button>
                    </div>
                </div>

                <div style="margin-top:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                    <div style="font-size:12px; font-weight:800; color:rgba(226,232,240,0.92); margin-bottom:8px;">自定义模糊名称归类（品牌：${escapeHtml(brandName || '-')}; 每行：标准名 => 别名1、别名2）</div>
                    <textarea id="rep-product-alias-editor" rows="6" style="width:100%; padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff; font-size:12px;" placeholder="例如：\n九秒生炒鱼片 => 9秒生炒鱼片、九秒生炒魚片\n白灼虾">${escapeHtml(productAliasText)}</textarea>
                    <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                        <button class="btn" type="button" data-click="repSaveProductAliasRules" style="padding:8px 12px; border-radius:8px;">保存归类规则</button>
                        <button class="btn btn-secondary" type="button" data-click="loadReportsData" style="padding:8px 12px; border-radius:8px;">刷新规则</button>
                    </div>
                </div>

                <div style="margin-top:12px; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px;">
                    <div class="rep-metric"><div class="k">累计对比次数</div><div class="v">${Number(accuracySummary?.comparedCount || 0)}</div></div>
                    <div class="rep-metric"><div class="k">平均精准率</div><div class="v">${fmt(Number(accuracySummary?.avgAccuracy || 0) * 100)}%</div></div>
                    <div class="rep-metric"><div class="k">平均误差率(MAPE)</div><div class="v">${fmt(Number(accuracySummary?.avgMape || 0) * 100)}%</div></div>
                    <div class="rep-metric"><div class="k">20%误差命中率</div><div class="v">${fmt(Number(accuracySummary?.avgHitRate20 || 0) * 100)}%</div></div>
                </div>

                <div style="margin-top:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:10px; font-size:12px; color:rgba(200,215,230,0.78);">
                    自校准说明：系统会把每天上传的实际销售与历史预测自动比对，并持续更新校准系数；后续预测会根据误差偏差自动修正。
                </div>

                <div style="margin-top:12px; display:grid; gap:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                    <div style="font-size:12px; font-weight:800; color:rgba(226,232,240,0.9);">预测条件</div>
                    <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px;">
                        <input id="rep-inv-date" type="date" value="${escapeHtml(state.date || '')}" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff; color-scheme:dark;" />
                        <input id="rep-inv-weather" type="text" placeholder="天气，如：晴/雨" value="${escapeHtml(state.weather || '')}" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff;" />
                        <input id="rep-inv-revenue-takeaway" type="number" min="0" step="0.01" placeholder="外卖预计营收" value="${escapeHtml(String(state.expectedRevenueTakeaway ?? state.expectedRevenue ?? 0))}" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff;" />
                        <input id="rep-inv-revenue-dinein" type="number" min="0" step="0.01" placeholder="堂食预计营收" value="${escapeHtml(String(state.expectedRevenueDinein ?? state.expectedRevenue ?? 0))}" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff;" />
                        <input id="rep-inv-topn" type="hidden" value="${escapeHtml(String(state.topN || 20))}" />
                    </div>
                    <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:rgba(226,232,240,0.9);">
                        <input id="rep-inv-holiday" type="checkbox" ${state.isHoliday ? 'checked' : ''} /> 是否假日
                    </label>
                    <div style="display:flex; gap:8px;">
                        <button class="btn" type="button" data-click="repInventoryForecastRun" style="padding:8px 12px; border-radius:8px;">更新预测</button>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr; gap:12px; margin-top:12px;">
                    <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                        <div style="font-weight:900; margin-bottom:10px;">🛵 外卖模块</div>
                        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
                            ${renderPredBlock('takeaway', 'lunch')}
                            ${renderPredBlock('takeaway', 'afternoon')}
                            ${renderPredBlock('takeaway', 'dinner')}
                        </div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                        <div style="font-weight:900; margin-bottom:10px;">🍽 堂食模块</div>
                        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
                            ${renderPredBlock('dinein', 'lunch')}
                            ${renderPredBlock('dinein', 'afternoon')}
                            ${renderPredBlock('dinein', 'dinner')}
                        </div>
                    </div>
                </div>

                <div style="margin-top:12px; font-size:12px; font-weight:800; color:rgba(226,232,240,0.92);">预测备货明细（产品销量）</div>
                <div class="rep-table" style="margin-top:8px; overflow-x:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>模块</th>
                                <th>时段</th>
                                <th>产品</th>
                                <th style="text-align:right;">预计销量</th>
                                <th style="text-align:right;">置信度</th>
                                <th>来源</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(() => {
                                const rows = [];
                                [['takeaway', 'lunch'], ['takeaway', 'afternoon'], ['takeaway', 'dinner'], ['dinein', 'lunch'], ['dinein', 'afternoon'], ['dinein', 'dinner']].forEach(([bizType, slot]) => {
                                    const rec = pick(bizType, slot) || {};
                                    const sourceLabel = rec?.source === 'ai' ? 'AI模型' : '历史加权';
                                    const confLabel = `${fmt(Number(rec?.confidence || 0) * 100)}%`;
                                    const predictions = Array.isArray(rec?.predictions) ? rec.predictions : [];
                                    predictions.forEach((p) => {
                                        rows.push(`
                                            <tr>
                                                <td>${bizLabel(bizType)}</td>
                                                <td>${slotLabel(slot)}</td>
                                                <td>${escapeHtml(String(p?.product || '-'))}</td>
                                                <td style="text-align:right;">${fmt(Number(p?.quantity || 0))}</td>
                                                <td style="text-align:right;">${confLabel}</td>
                                                <td>${sourceLabel}</td>
                                            </tr>
                                        `);
                                    });
                                });
                                return rows.length ? rows.join('') : '<tr><td colspan="6" style="text-align:center; color:rgba(200,215,230,0.6); padding:14px 0;">暂无预测明细（当前按销售明细自动汇总，可先检查 pos_sales_detail 是否已入库）</td></tr>';
                            })()}
                        </tbody>
                    </table>
                </div>

                ${isAdminUser() ? `<div style="margin-top:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px;">
                    <div style="font-size:12px; font-weight:800; color:rgba(226,232,240,0.92); margin-bottom:8px;">历史销售样本（自动读取）</div>
                    <div style="display:grid; grid-template-columns:1fr; gap:8px; margin-bottom:8px;">
                        <select id="rep-inv-history-biz" style="width:100%; padding:9px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.08); color:#fff;">
                            <option value="takeaway" ${historyBizType === 'takeaway' ? 'selected' : ''}>外卖模块</option>
                            <option value="dinein" ${historyBizType === 'dinein' ? 'selected' : ''}>堂食模块</option>
                        </select>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                        <button class="btn btn-secondary" type="button" data-click="repInventoryForecastRun" style="padding:8px 12px; border-radius:8px;">刷新销售明细样本</button>
                    </div>
                    <div style="margin-top:8px; font-size:11px; color:rgba(200,215,230,0.62);">智能助手现在直接按所选门店、业态与日期范围汇总销售明细（pos_sales_detail），不再依赖手工上传第二份历史文件。</div>
                </div>` : ''}

                <div style="margin-top:12px; font-size:12px; font-weight:800; color:rgba(226,232,240,0.92);">历史样本（${bizLabel(historyBizType)}）</div>
                <div class="rep-table" style="margin-top:8px; overflow-x:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>日期</th>
                                <th>时段</th>
                                <th>天气</th>
                                <th>假日</th>
                                <th style="text-align:right;">预计营收</th>
                                <th>产品销量</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${historyRows.map(r => {
                                const products = r?.productQuantities && typeof r.productQuantities === 'object' ? r.productQuantities : {};
                                const pairs = Object.keys(products).slice(0, 6).map(k => `${k}:${fmt(products[k])}`);
                                return `
                                    <tr>
                                        <td>${escapeHtml(String(r?.date || ''))}</td>
                                        <td>${slotLabel(String(r?.slot || ''))}</td>
                                        <td>${escapeHtml(String(r?.weather || '-'))}</td>
                                        <td>${r?.isHoliday ? '是' : '否'}</td>
                                        <td style="text-align:right;">¥${fmt(r?.expectedRevenue || 0)}</td>
                                        <td>${escapeHtml(pairs.join('，') || '-')}</td>
                                    </tr>
                                `;
                            }).join('')}
                            ${historyRows.length ? '' : '<tr><td colspan="6" style="text-align:center; color:rgba(200,215,230,0.6); padding:14px 0;">暂无历史样本</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div style="margin-top:12px; font-size:12px; font-weight:800; color:rgba(226,232,240,0.92);">预测 vs 实际 对比（最近）</div>
                <div class="rep-table" style="margin-top:8px; overflow-x:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>日期</th>
                                <th>模块</th>
                                <th style="text-align:right;">精准率</th>
                                <th style="text-align:right;">MAPE</th>
                                <th style="text-align:right;">20%命中</th>
                                <th style="text-align:right;">预测总量</th>
                                <th style="text-align:right;">实际总量</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${accuracyItems.slice(0, 20).map(r => `
                                <tr>
                                    <td>${escapeHtml(String(r?.date || ''))}</td>
                                    <td>${bizLabel(String(r?.bizType || ''))} · ${slotLabel(String(r?.slot || ''))}</td>
                                    <td style="text-align:right; color:#22c55e; font-weight:800;">${fmt(Number(r?.totalAccuracy || 0) * 100)}%</td>
                                    <td style="text-align:right; color:#f97316;">${fmt(Number(r?.mape || 0) * 100)}%</td>
                                    <td style="text-align:right;">${fmt(Number(r?.hitRate20 || 0) * 100)}%</td>
                                    <td style="text-align:right;">${fmt(r?.totalPredQty || 0)}</td>
                                    <td style="text-align:right;">${fmt(r?.totalActualQty || 0)}</td>
                                </tr>
                            `).join('')}
                            ${accuracyItems.length ? '' : '<tr><td colspan="7" style="text-align:center; color:rgba(200,215,230,0.6); padding:14px 0;">暂无对比数据（上传实际销售后自动生成）</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
            box.innerHTML = html;
        }

        function switchBizView(view) {
            __BIZ_VIEW = view || 'table';
            const tableBox = document.getElementById('rep-business-box');
            const dashBox = document.getElementById('rep-dashboard-box');
            const btnTable = document.getElementById('rep-biz-view-table');
            const btnDash = document.getElementById('rep-biz-view-dashboard');
            if (view === 'dashboard') {
                if (tableBox) tableBox.classList.add('hidden');
                if (dashBox) dashBox.classList.remove('hidden');
                if (btnTable) btnTable.classList.remove('rep-subtab--active');
                if (btnDash) btnDash.classList.add('rep-subtab--active');
                renderBizDashboard();
            } else {
                if (tableBox) tableBox.classList.remove('hidden');
                if (dashBox) dashBox.classList.add('hidden');
                if (btnTable) btnTable.classList.add('rep-subtab--active');
                if (btnDash) btnDash.classList.remove('rep-subtab--active');
            }
            renderReportsOverview();
        }

        function renderBizDashboard() {
            const box = document.getElementById('rep-dashboard-box');
            if (!box) return;
            const data = window.__REP_LAST_BUSINESS;
            if (!data) { box.innerHTML = '<div style="color:rgba(200,215,230,0.6); padding:20px; text-align:center;">请先加载业务分析数据</div>'; return; }
            const { store, start, end, rows, total, budgetExecution, lastMonth, lastMonthRange } = data;
            const s = (() => {
                if (store) {
                    const k = String(store).trim();
                    return (rows || []).find(x => String(x?.store || '').trim() === k) || total || (rows || [])[0] || null;
                }
                return total || (rows || [])[0] || null;
            })() || {};
            const lm = lastMonth || {};
            const hasLm = !!lastMonth;

            const days = Number(s.days || 0);
            const fmt = (n) => { const v = Number(n || 0); return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'; };
            const fmtInt = (n) => { const v = Number(n || 0); return Number.isFinite(v) ? v.toLocaleString('zh-CN') : '0'; };
            const pct = (n) => { const v = Number(n || 0); return Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '0.0%'; };
            const pctRaw = (a, b) => b > 0 ? pct(a / b) : '0.0%';

            const blue = '#2563eb'; const green = '#059669'; const red = '#dc2626'; const orange = '#ea580c'; const purple = '#7c3aed'; const cyan = '#0891b2';

            const yoyBadge = (cur, prev) => {
                if (!hasLm || prev == null) return '';
                const c = Number(cur || 0), p = Number(prev || 0);
                if (p === 0 && c === 0) return '<span style="font-size:10px; color:rgba(200,215,230,0.5); margin-left:4px;">同比 -</span>';
                if (p === 0) return '<span style="font-size:10px; color:' + green + '; margin-left:4px;">同比 +∞</span>';
                const rate = ((c - p) / Math.abs(p) * 100).toFixed(1);
                const up = c >= p;
                const arrow = up ? '↑' : '↓';
                const color = up ? green : red;
                return '<span style="font-size:10px; color:' + color + '; margin-left:4px;">同比 ' + arrow + Math.abs(rate) + '%</span>';
            };
            const yoyBadgeInverse = (cur, prev) => {
                if (!hasLm || prev == null) return '';
                const c = Number(cur || 0), p = Number(prev || 0);
                if (p === 0 && c === 0) return '<span style="font-size:10px; color:rgba(200,215,230,0.5); margin-left:4px;">同比 -</span>';
                if (p === 0) return '<span style="font-size:10px; color:' + red + '; margin-left:4px;">同比 +∞</span>';
                const rate = ((c - p) / Math.abs(p) * 100).toFixed(1);
                const up = c >= p;
                const arrow = up ? '↑' : '↓';
                const color = up ? red : green;
                return '<span style="font-size:10px; color:' + color + '; margin-left:4px;">同比 ' + arrow + Math.abs(rate) + '%</span>';
            };

            const kpiCard = (label, value, sub, color, icon, yoyHtml) => `
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:4px; min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:${color}18; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;">${icon}</div>
                        <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${label}</div>
                    </div>
                    <div style="font-size:20px; font-weight:900; color:${color}; margin-top:4px;">${value}${yoyHtml || ''}</div>
                    <div style="font-size:11px; color:rgba(200,215,230,0.55);">${sub}</div>
                </div>`;

            const gaugeRing = (label, rate, color, size) => {
                const sz = size || 100;
                const r = sz * 0.38;
                const circ = 2 * Math.PI * r;
                const val = Math.max(0, Math.min(1, Number(rate || 0)));
                const offset = circ * (1 - val);
                return `<div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
                    <svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
                        <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/>
                        <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${color}" stroke-width="8"
                            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
                            stroke-linecap="round" transform="rotate(-90 ${sz/2} ${sz/2})" style="transition:stroke-dashoffset 0.6s;"/>
                        <text x="${sz/2}" y="${sz/2}" text-anchor="middle" dominant-baseline="central"
                            fill="${color}" font-size="14" font-weight="900">${pct(val)}</text>
                    </svg>
                    <div style="font-size:11px; color:rgba(200,215,230,0.75); font-weight:700; text-align:center;">${label}</div>
                </div>`;
            };

            const barH = (label, value, maxVal, color, lmValue) => {
                const w = maxVal > 0 ? Math.min(100, (Number(value || 0) / maxVal) * 100) : 0;
                const lmW = (hasLm && maxVal > 0) ? Math.min(100, (Number(lmValue || 0) / maxVal) * 100) : 0;
                return `<div style="margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:3px;">
                        <span style="color:rgba(200,215,230,0.75);">${label}</span>
                        <span style="font-weight:800; color:${color};">¥${fmt(value)} ${yoyBadge(value, lmValue)}</span>
                    </div>
                    <div style="height:8px; border-radius:99px; background:rgba(255,255,255,0.08); overflow:hidden; position:relative;">
                        <div style="height:100%; width:${w}%; background:${color}; border-radius:99px; transition:width 0.5s;"></div>
                    </div>
                    ${hasLm ? '<div style="height:5px; border-radius:99px; background:rgba(255,255,255,0.05); overflow:hidden; margin-top:2px;"><div style="height:100%; width:' + lmW + '%; background:' + color + '44; border-radius:99px;"></div></div><div style="font-size:9px; color:rgba(200,215,230,0.4); text-align:right;">上月同期 ¥' + fmt(lmValue) + '</div>' : ''}
                </div>`;
            };

            const scoreCard = (label, value, unit, color, lmVal) => `
                <div style="background:${color}10; border:1px solid ${color}22; border-radius:12px; padding:12px 14px; text-align:center;">
                    <div style="font-size:24px; font-weight:900; color:${color};">${value}</div>
                    <div style="font-size:10px; color:rgba(200,215,230,0.6); margin-top:2px;">${unit}</div>
                    <div style="font-size:11px; color:rgba(200,215,230,0.75); font-weight:700; margin-top:4px;">${label}</div>
                    ${hasLm ? '<div style="margin-top:3px;">' + yoyBadgeInverse(Number(String(value).replace(/,/g,'')) || 0, Number(lmVal || 0)) + '</div>' : ''}
                </div>`;

            const actual = Number(s.actual || 0);
            const gross = Number(s.gross || 0);
            const discount = Number(s.discount || 0);
            const dineTraffic = Number(s.dineTraffic || 0);
            const dineOrders = Number(s.dineOrders || 0);
            const efficiency = Number(s.efficiency || 0);
            const rechargeAmt = Number(s.rechargeAmount || 0);
            const rechargeCnt = Number(s.rechargeCount || 0);
            const badDianping = Number(s.badDianping || 0);
            const badMeituan = Number(s.badMeituan || 0);
            const badEleme = Number(s.badEleme || 0);
            const badTotal = badDianping + badMeituan + badEleme;
            const elemeOrders = Number(s.elemeOrders || 0);
            const elemeRevenue = Number(s.elemeRevenue || 0);
            const elemeActual = Number(s.elemeActual || 0);
            const meituanOrders = Number(s.meituanOrders || 0);
            const meituanRevenue = Number(s.meituanRevenue || 0);
            const meituanActual = Number(s.meituanActual || 0);
            const segNoon = Number(s.segNoon || 0);
            const segAfternoon = Number(s.segAfternoon || 0);
            const segNight = Number(s.segNight || 0);
            const segTotal = segNoon + segAfternoon + segNight;
            const catWater = Number(s.catWaterAmt || 0);
            const catSoup = Number(s.catSoupAmt || 0);
            const catRoast = Number(s.catRoastAmt || 0);
            const catWok = Number(s.catWokAmt || 0);
            const catTotal = catWater + catSoup + catRoast + catWok;
            const dailyActual = days > 0 ? actual / days : 0;

            const lmActual = Number(lm.actual || 0);
            const lmDineTraffic = Number(lm.dineTraffic || 0);
            const lmDineOrders = Number(lm.dineOrders || 0);
            const lmEfficiency = Number(lm.efficiency || 0);
            const lmSegNoon = Number(lm.segNoon || 0);
            const lmSegAfternoon = Number(lm.segAfternoon || 0);
            const lmSegNight = Number(lm.segNight || 0);
            const lmElemeRevenue = Number(lm.elemeRevenue || 0);
            const lmMeituanRevenue = Number(lm.meituanRevenue || 0);
            const lmRechargeAmt = Number(lm.rechargeAmount || 0);
            const lmRechargeCnt = Number(lm.rechargeCount || 0);
            const lmBadDianping = Number(lm.badDianping || 0);
            const lmBadMeituan = Number(lm.badMeituan || 0);
            const lmBadEleme = Number(lm.badEleme || 0);
            const lmBadTotal = lmBadDianping + lmBadMeituan + lmBadEleme;
            const lmGross = Number(lm.gross || 0);
            const lmDiscount = Number(lm.discount || 0);

            const titleStore = store || '全部门店';
            const lmLabel = lastMonthRange ? (lastMonthRange.start + ' ~ ' + lastMonthRange.end) : '上月同期';

            box.innerHTML = `
                <div style="margin-bottom:16px;">
                    <div style="font-size:18px; font-weight:900; color:rgba(226,232,240,0.95);">📊 ${escapeHtml(titleStore)} 业务仪表盘</div>
                    <div style="font-size:12px; color:rgba(200,215,230,0.6); margin-top:4px;">${escapeHtml(start)} 至 ${escapeHtml(end)}（共${days}天）${hasLm ? ' · <span style="color:rgba(200,215,230,0.45);">同比：' + escapeHtml(lmLabel) + '</span>' : ''}</div>
                </div>

                <!-- KPI Cards -->
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px; margin-bottom:16px;">
                    ${kpiCard('累计实收', '¥' + fmt(actual), '日均 ¥' + fmt(dailyActual), blue, '💰', yoyBadge(actual, lmActual))}
                    ${kpiCard('堂食客流', fmtInt(dineTraffic) + '人', '日均 ' + fmtInt(days > 0 ? dineTraffic / days : 0) + '人', green, '👥', yoyBadge(dineTraffic, lmDineTraffic))}
                    ${kpiCard('堂食订单', fmtInt(dineOrders) + '单', '桌均 ¥' + fmt(s.dineAvgTable), orange, '🍽️', yoyBadge(dineOrders, lmDineOrders))}
                    ${kpiCard('日均人效', '¥' + fmtInt(efficiency), days > 0 ? '共' + days + '天' : '-', purple, '⚡', yoyBadge(efficiency, lmEfficiency))}
                </div>

                <!-- Gauge Rings Row -->
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:16px;">
                    <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:14px; border-left:3px solid ${blue}; padding-left:10px;">达成率总览</div>
                    <div style="display:flex; justify-content:space-around; flex-wrap:wrap; gap:12px;">
                        ${gaugeRing('营业额', actual / Math.max(Number(s.budget || 0), 1), blue, 90)}
                        ${gaugeRing('堂食客流', dineTraffic / Math.max(Number(s.dineTraffic || 0) > 0 ? dineTraffic * 1.2 : 1, 1), green, 90)}
                        ${gaugeRing('外卖饿了么', Number(s.elemeTarget || 0) > 0 ? elemeRevenue / Number(s.elemeTarget) : 0, orange, 90)}
                        ${gaugeRing('外卖美团', Number(s.meituanTarget || 0) > 0 ? meituanRevenue / Number(s.meituanTarget) : 0, red, 90)}
                        ${gaugeRing('充值', Number(s.rechargeAmount || 0) > 0 ? rechargeAmt / Math.max(rechargeAmt * 1.1, 1) : 0, purple, 90)}
                    </div>
                </div>

                <!-- Time Segment Analysis -->
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:16px;">
                    <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:14px; border-left:3px solid ${orange}; padding-left:10px;">时段营业额</div>
                    ${barH('午市', segNoon, Math.max(segNoon, segAfternoon, segNight, lmSegNoon, lmSegAfternoon, lmSegNight, 1), blue, lmSegNoon)}
                    ${barH('下午茶', segAfternoon, Math.max(segNoon, segAfternoon, segNight, lmSegNoon, lmSegAfternoon, lmSegNight, 1), green, lmSegAfternoon)}
                    ${barH('晚市', segNight, Math.max(segNoon, segAfternoon, segNight, lmSegNoon, lmSegAfternoon, lmSegNight, 1), orange, lmSegNight)}
                    <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:12px;">
                        <span style="color:rgba(200,215,230,0.6);">合计</span>
                        <span style="font-weight:900; color:${blue};">¥${fmt(segTotal)} ${yoyBadge(segTotal, lmSegNoon + lmSegAfternoon + lmSegNight)}</span>
                    </div>
                </div>

                <!-- Category Sales -->
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:16px;">
                    <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:14px; border-left:3px solid ${green}; padding-left:10px;">品类销售占比</div>
                    <div style="display:flex; justify-content:center; gap:6px; flex-wrap:wrap; margin-bottom:14px;">
                        ${[['水吧', catWater, blue, Number(lm.catWaterAmt||0)], ['汤档', catSoup, green, Number(lm.catSoupAmt||0)], ['烧味', catRoast, orange, Number(lm.catRoastAmt||0)], ['炒锅', catWok, purple, Number(lm.catWokAmt||0)]].map(([name, amt, color, lmAmt]) => {
                            const ratio = catTotal > 0 ? amt / catTotal : 0;
                            return gaugeRing(name + ' ¥' + fmt(amt) + (hasLm ? '<br>' + yoyBadge(amt, lmAmt).replace(/margin-left:4px/,'') : ''), ratio, color, 80);
                        }).join('')}
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:12px;">
                        <span style="color:rgba(200,215,230,0.6);">品类合计</span>
                        <span style="font-weight:900; color:${blue};">¥${fmt(catTotal)} ${yoyBadge(catTotal, Number(lm.catWaterAmt||0)+Number(lm.catSoupAmt||0)+Number(lm.catRoastAmt||0)+Number(lm.catWokAmt||0))}</span>
                    </div>
                </div>

                <!-- Delivery Data -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
                    <div style="background:${blue}08; border:1px solid ${blue}18; border-radius:14px; padding:16px;">
                        <div style="font-weight:900; font-size:13px; color:${blue}; margin-bottom:10px;">🛵 饿了么</div>
                        <div style="font-size:22px; font-weight:900; color:${blue};">¥${fmt(elemeRevenue)}</div>
                        <div style="font-size:11px; color:rgba(200,215,230,0.6); margin-top:4px;">${fmtInt(elemeOrders)}单 · 实收 ¥${fmt(elemeActual)}</div>
                        <div style="font-size:11px; color:rgba(200,215,230,0.6);">实收率 ${pctRaw(elemeActual, elemeRevenue)}</div>
                        <div style="margin-top:6px;">${yoyBadge(elemeRevenue, lmElemeRevenue)}</div>
                    </div>
                    <div style="background:${orange}08; border:1px solid ${orange}18; border-radius:14px; padding:16px;">
                        <div style="font-weight:900; font-size:13px; color:${orange}; margin-bottom:10px;">🛵 美团外卖</div>
                        <div style="font-size:22px; font-weight:900; color:${orange};">¥${fmt(meituanRevenue)}</div>
                        <div style="font-size:11px; color:rgba(200,215,230,0.6); margin-top:4px;">${fmtInt(meituanOrders)}单 · 实收 ¥${fmt(meituanActual)}</div>
                        <div style="font-size:11px; color:rgba(200,215,230,0.6);">实收率 ${pctRaw(meituanActual, meituanRevenue)}</div>
                        <div style="margin-top:6px;">${yoyBadge(meituanRevenue, lmMeituanRevenue)}</div>
                    </div>
                </div>

                <!-- Score Cards Row -->
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:16px;">
                    <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:14px; border-left:3px solid ${red}; padding-left:10px;">差评与评分</div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(100px, 1fr)); gap:10px;">
                        ${scoreCard('总差评', fmtInt(badTotal), '条', red, lmBadTotal)}
                        ${scoreCard('大众点评', fmtInt(badDianping), '条', orange, lmBadDianping)}
                        ${scoreCard('美团外卖', fmtInt(badMeituan), '条', blue, lmBadMeituan)}
                        ${scoreCard('饿了么', fmtInt(badEleme), '条', green, lmBadEleme)}
                    </div>
                </div>

                <!-- Recharge Stats -->
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:16px;">
                    <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:14px; border-left:3px solid ${purple}; padding-left:10px;">充值统计</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div style="background:${purple}10; border:1px solid ${purple}22; border-radius:12px; padding:14px; text-align:center;">
                            <div style="font-size:11px; color:rgba(200,215,230,0.7);">累计充值</div>
                            <div style="font-size:22px; font-weight:900; color:${purple}; margin-top:4px;">¥${fmt(rechargeAmt)}</div>
                            <div style="margin-top:4px;">${yoyBadge(rechargeAmt, lmRechargeAmt)}</div>
                        </div>
                        <div style="background:${cyan}10; border:1px solid ${cyan}22; border-radius:12px; padding:14px; text-align:center;">
                            <div style="font-size:11px; color:rgba(200,215,230,0.7);">充值笔数</div>
                            <div style="font-size:22px; font-weight:900; color:${cyan}; margin-top:4px;">${fmtInt(rechargeCnt)}笔</div>
                            <div style="margin-top:4px;">${yoyBadge(rechargeCnt, lmRechargeCnt)}</div>
                        </div>
                    </div>
                </div>

                <!-- Discount -->
                <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:16px;">
                    <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:14px; border-left:3px solid ${red}; padding-left:10px;">折扣分析</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
                        <div style="text-align:center;">
                            <div style="font-size:11px; color:rgba(200,215,230,0.7);">应收总额</div>
                            <div style="font-size:16px; font-weight:900; color:${blue};">¥${fmt(gross)}</div>
                            <div style="margin-top:3px;">${yoyBadge(gross, lmGross)}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:11px; color:rgba(200,215,230,0.7);">折扣金额</div>
                            <div style="font-size:16px; font-weight:900; color:${red};">¥${fmt(discount)}</div>
                            <div style="margin-top:3px;">${yoyBadgeInverse(discount, lmDiscount)}</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-size:11px; color:rgba(200,215,230,0.7);">折扣率</div>
                            <div style="font-size:16px; font-weight:900; color:${orange};">${pctRaw(discount, gross)}</div>
                            <div style="margin-top:3px;">${yoyBadgeInverse(gross > 0 ? discount/gross : 0, lmGross > 0 ? lmDiscount/lmGross : 0)}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        async function notifyAttendanceAnomalies(date) {
            const dateStr = String(date || '').trim();
            if (!dateStr) return;
            const ok = await hrmsConfirm({ title: '通知考勤异常员工', message: `将向 ${dateStr} 存在考勤异常的员工发送公司通知，确认吗？`, okText: '发送通知', icon: '📣' });
            if (!ok) return;
            try {
                const token = HRMS_API.token() || '';
                const resp = await fetch('/api/admin/attendance-anomaly-notify', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date: dateStr })
                });
                const data = await resp.json();
                if (data.ok) {
                    showNotification(`已通知 ${data.notified} 名异常员工`, 'success');
                } else {
                    showNotification(data.message || '通知失败', 'error');
                }
            } catch (e) {
                showNotification('网络错误，通知失败', 'error');
            }
        }

        function loadReportsData() {
            if (!currentUser) return;
            refreshBrandsCache(true).then(() => {
                populateReportsBrandSelect(document.getElementById('rep-brand')?.value || '');
                repEnsureSelectStores(true);
            });
            repEnsureSelectStores();

            const forecastTab = document.getElementById('rep-tab-inventory-forecast');
            if (forecastTab) forecastTab.style.display = '';

            // Admin-only download buttons
            const csvBtn = document.getElementById('rep-btn-csv');
            const pdfBtn = document.getElementById('rep-btn-pdf');
            if (csvBtn) csvBtn.style.display = repRoleCanDownload() ? '' : 'none';
            if (pdfBtn) pdfBtn.style.display = repRoleCanDownload() ? '' : 'none';

            // Hide business tab for roles without business-report permission
            const bizTab = document.getElementById('rep-tab-business');
            const canSeeBusinessTab = repRoleCanSeeBusinessReport();
            if (bizTab) bizTab.style.display = canSeeBusinessTab ? '' : 'none';
            if (!canSeeBusinessTab && __REP_TAB === 'business') {
                showReportsTab(repRoleIsHrManager() ? 'attendance' : 'inventory-forecast');
            }
            const promoTab = document.getElementById('rep-tab-promotions');
            const canViewPromotions = repRoleCanViewPromotionRecords();
            if (promoTab) promoTab.style.display = canViewPromotions ? '' : 'none';
            if (!canViewPromotions && __REP_TAB === 'promotions') {
                showReportsTab(canSeeBusinessTab ? 'business' : (repRoleIsHrManager() ? 'attendance' : 'inventory-forecast'));
            }

            const dailyRegTab = document.getElementById('rep-tab-daily-attendance-register');
            const canViewDailyReg = repRoleCanViewDailyAttendanceRegister();
            if (dailyRegTab) dailyRegTab.style.display = canViewDailyReg ? '' : 'none';
            if (!canViewDailyReg && __REP_TAB === 'daily-attendance-register') {
                showReportsTab(canSeeBusinessTab ? 'business' : (repRoleIsHrManager() ? 'attendance' : 'inventory-forecast'));
            }

            // HR manager can see all stores
            const repStoreEl = document.getElementById('rep-store');
            if (repStoreEl && repRoleIsHrManager()) {
                repStoreEl.disabled = false;
            }

            const def = repDefaultRange();
            const startEl = document.getElementById('rep-start');
            const endEl = document.getElementById('rep-end');
            const monthEl = document.getElementById('rep-month');
            if (startEl && !startEl.value) startEl.value = def.start;
            if (endEl && !endEl.value) endEl.value = def.end;
            if (monthEl && !monthEl.value) monthEl.value = def.month;

            const store = String(document.getElementById('rep-store')?.value || '').trim();
            const brandId = normalizeBrandIdInput(document.getElementById('rep-brand')?.value || '');
            const start = String(document.getElementById('rep-start')?.value || '').trim();
            const end = String(document.getElementById('rep-end')?.value || '').trim();
            const month = String(document.getElementById('rep-month')?.value || '').trim();
            const darEmp = String(document.getElementById('rep-dar-employee')?.value || '').trim();

            if (__REP_TAB === 'business') {
                const box = document.getElementById('rep-business-box');
                if (box) box.innerHTML = '加载中...';
                // compute last month same period for 同比
                const _lastMonthRange = (() => {
                    try {
                        const sd = new Date(start + 'T00:00:00');
                        const ed = new Date(end + 'T00:00:00');
                        const lmStart = new Date(sd.getFullYear(), sd.getMonth() - 1, sd.getDate());
                        const lmEnd = new Date(ed.getFullYear(), ed.getMonth() - 1, ed.getDate());
                        const pad = (n) => String(n).padStart(2, '0');
                        return {
                            start: `${lmStart.getFullYear()}-${pad(lmStart.getMonth()+1)}-${pad(lmStart.getDate())}`,
                            end: `${lmEnd.getFullYear()}-${pad(lmEnd.getMonth()+1)}-${pad(lmEnd.getDate())}`
                        };
                    } catch(e) { return null; }
                })();
                const bizPromise = HRMS_API.getBusinessReport({ store, start, end });
                const lmPromise = _lastMonthRange ? HRMS_API.getBusinessReport({ store, start: _lastMonthRange.start, end: _lastMonthRange.end }).catch(() => null) : Promise.resolve(null);
                Promise.all([bizPromise, lmPromise]).then(([resp, lmResp]) => {
                        const rows = Array.isArray(resp?.rows) ? resp.rows : [];
                        const total = resp?.total || null;
                        const mt = resp?.monthlyTargets || null;
                        const fmt = (n) => {
                            const v = Number(n || 0);
                            return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
                        };
                        const fmtInt = (n) => {
                            const v = Number(n || 0);
                            return Number.isFinite(v) ? v.toLocaleString('zh-CN') : '0';
                        };
                        const pct = (n) => {
                            const v = Number(n || 0);
                            return Number.isFinite(v) ? (v * 100).toFixed(2) + '%' : '0.00%';
                        };
                        const pctRaw = (a, b) => b > 0 ? pct(a / b) : '0.00%';
                        const diffStr = (a, b) => {
                            const d = a - b;
                            const sign = d >= 0 ? '+' : '';
                            return sign + fmt(d);
                        };
                        const budgetExecution = Array.isArray(resp?.budgetExecution) ? resp.budgetExecution : [];
                        // extract last month aggregated data
                        const _lmTotal = lmResp?.total || null;
                        const _lmRows = Array.isArray(lmResp?.rows) ? lmResp.rows : [];
                        const _lmData = (() => {
                            if (store) {
                                const k = String(store).trim();
                                return _lmRows.find(x => String(x?.store || '').trim() === k) || _lmTotal || _lmRows[0] || null;
                            }
                            return _lmTotal || _lmRows[0] || null;
                        })() || null;
                        try { window.__REP_LAST_BUSINESS = { store, start, end, rows: rows.slice(), total: total || null, budgetExecution, lastMonth: _lmData, lastMonthRange: _lastMonthRange }; } catch (e) {}

                        const s = (() => {
                            if (store) {
                                const k = String(store).trim();
                                return rows.find(x => String(x?.store || '').trim() === k) || total || rows[0] || null;
                            }
                            return total || rows[0] || null;
                        })() || {};

                        const reportDays = Number(s.days || 0);
                        const monthBudget = Number(mt?.actual || s.budget || 0);
                        const daysInMonth = (() => { try { const d = new Date(start); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); } catch(e) { return 30; } })();
                        // Use calendar days elapsed (from 1st of month to today or end date)
                        const elapsedDays = (() => {
                            try {
                                const now = new Date();
                                const bjNow = new Date(now.getTime() + (8 - (-(now.getTimezoneOffset() / 60))) * 3600000);
                                const monthStart = new Date(start + 'T00:00:00');
                                const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
                                const today = new Date(bjNow.getFullYear(), bjNow.getMonth(), bjNow.getDate());
                                const effectiveEnd = today < monthEnd ? today : monthEnd;
                                const diff = Math.floor((effectiveEnd - monthStart) / 86400000) + 1;
                                return Math.max(0, Math.min(diff, daysInMonth));
                            } catch(e) { return reportDays; }
                        })();
                        const theoreticalRate = daysInMonth > 0 ? (elapsedDays / daysInMonth) : 0;
                        const theoreticalAmount = monthBudget * theoreticalRate;
                        const actualRate = monthBudget > 0 ? (Number(s.actual || 0) / monthBudget) : 0;
                        const progressDiff = Number(s.actual || 0) - theoreticalAmount;
                        const progressDiffPct = actualRate - theoreticalRate;

                        const targetDineTraffic = Number(mt?.dineTraffic || 0);
                        const targetDineOrders = Number(mt?.dineOrders || 0);
                        const targetRecharge = Number(mt?.recharge || 0);
                        const targetEfficiency = Number(mt?.efficiency || 1500);
                        const targetDianpingRating = Number(mt?.dianpingRating || 0);
                        const avgDianpingStars =
                          s.avgDianpingRating != null && Number.isFinite(Number(s.avgDianpingRating))
                            ? Number(s.avgDianpingRating)
                            : null;

                        const catTotal = Number(s.catWaterAmt||0) + Number(s.catSoupAmt||0) + Number(s.catRoastAmt||0) + Number(s.catWokAmt||0);
                        const catQtyTotal = Number(s.catWaterQty||0) + Number(s.catSoupQty||0) + Number(s.catRoastQty||0) + Number(s.catWokQty||0);
                        const segTotal = Number(s.segNoon||0) + Number(s.segAfternoon||0) + Number(s.segNight||0);
                        const badTotal = Number(s.badDianping||0) + Number(s.badMeituan||0) + Number(s.badEleme||0);
                        const dailyActual = reportDays > 0 ? (Number(s.actual||0) / reportDays) : 0;
                        const dailyGross = reportDays > 0 ? (Number(s.gross||0) / reportDays) : 0;
                        const dailyEff = reportDays > 0 ? (Number(s.efficiency||0)) : 0;

                        const catLabor = Number(s.laborTotal || 0);
                        const catWaterLabor = Number(s.catWaterQty || 0) > 0 ? (catLabor > 0 ? (Number(s.catWaterAmt||0) > 0 ? Math.round(catLabor * Number(s.catWaterAmt||0) / (catTotal || 1)) : 0) : 0) : 0;

                        const sc = (cls) => `style="color:${cls}; font-weight:900;"`;
                        const blue = '#2563eb';
                        const red = '#dc2626';
                        const green = '#059669';
                        const orange = '#ea580c';
                        const purple = '#7c3aed';

                        const section = (title, content) => `
                            <div style="background:rgba(255,255,255,0.04); border-radius:14px; border:1px solid rgba(255,255,255,0.08); padding:16px; margin-bottom:12px; box-shadow: 0 1px 3px rgba(0,0,0,0.15);">
                                <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:12px; border-left:3px solid ${blue}; padding-left:10px;">${title}</div>
                                ${content}
                            </div>`;

                        const kv = (label, value, color) => `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                                <span style="color:rgba(200,215,230,0.75); font-size:13px;">${label}</span>
                                <span style="font-weight:800; font-size:13px; ${color ? 'color:'+color : 'color:rgba(226,232,240,0.95)'}">${value}</span>
                            </div>`;

                        const bigNum = (label, value, color) => `
                            <div style="background:${color || blue}10; border:1px solid ${color || blue}22; border-radius:10px; padding:10px 14px; margin-bottom:8px;">
                                <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700;">${label}</div>
                                <div style="font-size:22px; font-weight:900; color:${color || blue}; margin-top:2px;">¥${fmt(value)}</div>
                            </div>`;

                        const progressBar = (rate, color) => {
                            const w = Math.max(0, Math.min(100, (Number(rate||0)*100)));
                            return `<div style="height:6px; border-radius:99px; background:rgba(255,255,255,0.1); overflow:hidden; margin-top:4px;">
                                <div style="height:100%; width:${w}%; background:${color || blue}; border-radius:99px;"></div>
                            </div>`;
                        };

                        const html = `
                            <div style="font-size:12px; color:rgba(200,215,230,0.7); margin-bottom:10px;">查询日期范围：${escapeHtml(start)} 至 ${escapeHtml(end)}</div>

                            ${section('目标进度', `
                                <div style="display:flex; gap:16px; margin-bottom:8px;">
                                    <div style="flex:1;">
                                        <div style="font-size:12px; color:rgba(200,215,230,0.7);">实际进度</div>
                                        <div style="font-size:18px; font-weight:900; color:${blue};">${pct(actualRate)}</div>
                                        ${progressBar(actualRate, blue)}
                                    </div>
                                    <div style="flex:1;">
                                        <div style="font-size:12px; color:rgba(200,215,230,0.7);">理论进度</div>
                                        <div style="font-size:18px; font-weight:900; color:${orange};">${pct(theoreticalRate)}</div>
                                        ${progressBar(theoreticalRate, orange)}
                                    </div>
                                </div>
                                ${kv('实际营业额', '¥' + fmt(s.actual), blue)}
                                ${kv('理论应完成', '¥' + fmt(theoreticalAmount), orange)}
                                ${kv('月度目标', '¥' + fmt(monthBudget), null)}
                                ${kv('进度差距', (progressDiff >= 0 ? '+' : '') + fmt(progressDiff) + ' <span style="font-size:11px; color:' + (progressDiffPct >= 0 ? green : red) + ';">' + (progressDiffPct >= 0 ? '超前' : '落后') + '</span>', progressDiff >= 0 ? green : red)}
                                <div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:6px;">已过 ${elapsedDays} 天 / 本月共 ${daysInMonth} 天</div>
                            `)}

                            ${section('堂食达成数据', `
                                ${kv('堂食客流量', '')}
                                ${kv('目标：' + fmtInt(targetDineTraffic) + '人', '累计：' + fmtInt(s.dineTraffic) + '人', null)}
                                <div style="font-size:12px; color:rgba(200,215,230,0.7); margin-bottom:4px;">达成率</div>
                                <div style="font-size:18px; font-weight:900; color:${blue}; margin-bottom:8px;">${pctRaw(s.dineTraffic, targetDineTraffic)}</div>
                                ${progressBar(targetDineTraffic > 0 ? s.dineTraffic / targetDineTraffic : 0, blue)}
                                <div style="height:12px;"></div>
                                ${kv('堂食订单数', '')}
                                ${kv('目标：' + fmtInt(targetDineOrders) + '单', '累计：' + fmtInt(s.dineOrders) + '单', null)}
                                <div style="font-size:12px; color:rgba(200,215,230,0.7); margin-bottom:4px;">达成率</div>
                                <div style="font-size:18px; font-weight:900; color:${blue}; margin-bottom:8px;">${pctRaw(s.dineOrders, targetDineOrders)}</div>
                                ${progressBar(targetDineOrders > 0 ? s.dineOrders / targetDineOrders : 0, blue)}
                                <div style="height:8px;"></div>
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                                    <div>${kv('本月平均桌单价', '¥' + fmt(s.dineAvgTable), blue)}</div>
                                    <div>${kv('本月平均人均', '¥' + fmt(s.dineAvgPerson), blue)}</div>
                                </div>
                                <div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:4px;">统计${reportDays}天，共${fmtInt(s.dineTraffic)}人次</div>
                            `)}

                            ${section('统计周期', `
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                                    ${bigNum('累计实收', s.actual, blue)}
                                    ${bigNum('日均实收', dailyActual, green)}
                                    ${bigNum('累计折扣', s.discount, red)}
                                    <div style="background:${purple}10; border:1px solid ${purple}22; border-radius:10px; padding:10px 14px; margin-bottom:8px;">
                                        <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700;">平均折扣率</div>
                                        <div style="font-size:22px; font-weight:900; color:${purple}; margin-top:2px;">${pctRaw(s.discount, s.gross)}</div>
                                    </div>
                                </div>
                                <div style="font-size:11px; color:rgba(200,215,230,0.5);">统计周期：${escapeHtml(start)} 至 ${escapeHtml(end)}（共${reportDays}天）</div>
                            `)}

                            ${section('人效分析', `
                                ${bigNum('实际日均人效', s.efficiency, blue)}
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                                    <div>${kv('目标人效', '¥' + fmtInt(targetEfficiency), null)}</div>
                                    <div>${kv('差距', diffStr(Number(s.efficiency||0), targetEfficiency), Number(s.efficiency||0) >= targetEfficiency ? green : red)}</div>
                                </div>
                                ${kv('完成率', pctRaw(s.efficiency, targetEfficiency), Number(s.efficiency||0) >= targetEfficiency ? green : red)}
                                <div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:4px;">超出目标 ${pct(Math.max(0, (Number(s.efficiency||0) / (targetEfficiency||1)) - 1))}</div>
                            `)}

                            ${section('档口人均产值', `
                                ${[
                                    ['水吧', s.catWaterAmt, s.catWaterQty, blue],
                                    ['汤档', s.catSoupAmt, s.catSoupQty, green],
                                    ['烧味', s.catRoastAmt, s.catRoastQty, orange],
                                    ['炒锅', s.catWokAmt, s.catWokQty, purple]
                                ].map(([name, amt, qty, color]) => {
                                    const perCapita = Number(qty||0) > 0 ? (Number(amt||0) / Number(qty||0)) : 0;
                                    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                                        <div>
                                            <div style="font-weight:800; font-size:13px; color:rgba(226,232,240,0.95);">${name}</div>
                                            <div style="font-size:11px; color:rgba(200,215,230,0.6);">销售额：¥${fmt(amt)} &nbsp; 人：${fmtInt(qty)}人</div>
                                        </div>
                                        <div style="font-size:18px; font-weight:900; color:${color};">¥${fmtInt(perCapita)}</div>
                                    </div>`;
                                }).join('')}
                            `)}

                            ${section('时段营业额分析', `
                                ${[
                                    ['午市', s.segNoon, blue],
                                    ['下午茶', s.segAfternoon, green],
                                    ['晚市', s.segNight, orange]
                                ].map(([name, amt, color]) => {
                                    const ratio = Number(s.gross||0) > 0 ? (Number(amt||0) / Number(s.gross||0)) : 0;
                                    const dailyAvg = reportDays > 0 ? (Number(amt||0) / reportDays) : 0;
                                    return `<div style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                                        <div style="display:flex; justify-content:space-between; align-items:center;">
                                            <span style="font-weight:800; font-size:13px;">${name}</span>
                                            <span style="font-weight:900; color:${color};">¥${fmt(amt)} (${pct(ratio)})</span>
                                        </div>
                                        <div style="font-size:11px; color:rgba(200,215,230,0.6); margin-top:2px;">日均营业额 ¥${fmt(dailyAvg)}</div>
                                    </div>`;
                                }).join('')}
                                ${kv('时段营业额合计', '¥' + fmt(segTotal), blue)}
                            `)}

                            ${section('品类销售占比', `
                                ${[
                                    ['水吧', s.catWaterAmt, s.catWaterQty],
                                    ['汤档', s.catSoupAmt, s.catSoupQty],
                                    ['烧味', s.catRoastAmt, s.catRoastQty],
                                    ['炒锅', s.catWokAmt, s.catWokQty]
                                ].map(([name, amt, qty]) => {
                                    const ratio = catTotal > 0 ? (Number(amt||0) / catTotal) : 0;
                                    const perCapita = Number(qty||0) > 0 ? (Number(amt||0) / Number(qty||0)) : 0;
                                    const qtyRatio = catQtyTotal > 0 ? (Number(qty||0) / catQtyTotal) : 0;
                                    return `<div style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                                        <div style="display:flex; justify-content:space-between; align-items:center;">
                                            <span style="font-weight:800; font-size:13px;">${name}</span>
                                            <span style="font-weight:900; color:${blue};">¥${fmt(amt)} (${pct(ratio)})</span>
                                        </div>
                                        <div style="font-size:11px; color:rgba(200,215,230,0.6); margin-top:2px;">人均产值 ¥${fmt(perCapita)} &nbsp; 人均产品件数 ${fmtInt(qty)}件(${pct(qtyRatio)})</div>
                                    </div>`;
                                }).join('')}
                            `)}

                            ${section('外卖数据', `
                                <div style="background:${blue}08; border:1px solid ${blue}15; border-radius:10px; padding:12px; margin-bottom:10px;">
                                    <div style="font-weight:900; color:${blue}; font-size:13px; margin-bottom:8px;">饿了么</div>
                                    ${kv('订单数', fmtInt(s.elemeOrders) + '单', null)}
                                    ${kv('日营目标', '¥' + fmt(s.elemeTarget), null)}
                                    ${kv('折收金额', '¥' + fmt(s.elemeRevenue), blue)}
                                    ${kv('实收金额', '¥' + fmt(s.elemeActual), green)}
                                    ${kv('实收率（实收/账单）', pctRaw(s.elemeActual, s.elemeRevenue), null)}
                                    ${kv('目标达成率', pctRaw(s.elemeRevenue, s.elemeTarget), Number(s.elemeRevenue||0) >= Number(s.elemeTarget||0) ? green : red)}
                                </div>
                                <div style="background:${orange}08; border:1px solid ${orange}15; border-radius:10px; padding:12px;">
                                    <div style="font-weight:900; color:${orange}; font-size:13px; margin-bottom:8px;">美团外卖</div>
                                    ${kv('订单数', fmtInt(s.meituanOrders) + '单', null)}
                                    ${kv('日营目标', '¥' + fmt(s.meituanTarget), null)}
                                    ${kv('折收金额', '¥' + fmt(s.meituanRevenue), orange)}
                                    ${kv('实收金额', '¥' + fmt(s.meituanActual), green)}
                                    ${kv('实收率（实收/账单）', pctRaw(s.meituanActual, s.meituanRevenue), null)}
                                    ${kv('目标达成率', pctRaw(s.meituanRevenue, s.meituanTarget), Number(s.meituanRevenue||0) >= Number(s.meituanTarget||0) ? green : red)}
                                </div>
                            `)}

                            ${section('差评统计', `
                                <div style="background:${red}08; border:1px solid ${red}18; border-radius:10px; padding:10px 14px; margin-bottom:8px;">
                                    <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700;">总差评数</div>
                                    <div style="font-size:24px; font-weight:900; color:${red}; margin-top:2px;">${fmtInt(badTotal)}条</div>
                                </div>
                                ${kv('大众点评星级（有填报日期的均值）', avgDianpingStars != null ? avgDianpingStars.toFixed(2) + ' 星' : '—', blue)}
                                ${kv('大众点评星级目标', targetDianpingRating > 0 ? targetDianpingRating.toFixed(2) + ' 星' : '未设置', targetDianpingRating > 0 && avgDianpingStars != null ? (avgDianpingStars >= targetDianpingRating ? green : red) : null)}
                                ${kv('大众点评', fmtInt(s.badDianping) + '条', null)}
                                ${kv('美团外卖', fmtInt(s.badMeituan) + '条', null)}
                                ${kv('饿了么外卖', fmtInt(s.badEleme) + '条', null)}
                                ${kv('今日企微会员新增', fmtInt(s.newWechatMembers) + '人', null)}
                            `)}

                            ${section('充值统计', `
                                <div style="background:${purple}08; border:1px solid ${purple}18; border-radius:10px; padding:10px 14px; margin-bottom:8px;">
                                    <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700;">累计充值金额</div>
                                    <div style="font-size:24px; font-weight:900; color:${purple}; margin-top:2px;">¥${fmt(s.rechargeAmount)}</div>
                                </div>
                                ${kv('充值笔数', fmtInt(s.rechargeCount) + '笔', null)}
                                ${kv('本月目标', '¥' + fmt(targetRecharge), null)}
                                ${kv('达成率', pctRaw(s.rechargeAmount, targetRecharge), Number(s.rechargeAmount||0) >= targetRecharge ? green : red)}
                            `)}

                            ${(() => {
                                if (!budgetExecution || budgetExecution.length === 0) return '';
                                const totalBudget = budgetExecution.reduce((s, b) => s + Number(b.budget || 0), 0);
                                const totalUsed = budgetExecution.reduce((s, b) => s + Number(b.used || 0), 0);
                                const totalRemaining = totalBudget - totalUsed;
                                const totalRate = totalBudget > 0 ? (totalUsed / totalBudget) : 0;
                                const ym = start.slice(0, 7);
                                return section('预算执行情况', `
                                    <div style="background:${blue}08; border:1px solid ${blue}20; border-radius:12px; padding:14px; margin-bottom:14px;">
                                        <div style="font-weight:900; font-size:13px; color:${blue}; margin-bottom:10px;">总体预算</div>
                                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px 16px;">
                                            <div>
                                                <div style="font-size:11px; color:rgba(200,215,230,0.7);">总预算</div>
                                                <div style="font-size:18px; font-weight:900; color:${blue};">¥${fmt(totalBudget)}</div>
                                            </div>
                                            <div>
                                                <div style="font-size:11px; color:rgba(200,215,230,0.7);">已使用</div>
                                                <div style="font-size:18px; font-weight:900; color:${red};">¥${fmt(totalUsed)}</div>
                                            </div>
                                            <div>
                                                <div style="font-size:11px; color:rgba(200,215,230,0.7);">剩余预算</div>
                                                <div style="font-size:18px; font-weight:900; color:${green};">¥${fmt(totalRemaining)}</div>
                                            </div>
                                            <div>
                                                <div style="font-size:11px; color:rgba(200,215,230,0.7);">总执行率</div>
                                                <div style="font-size:18px; font-weight:900; color:${orange};">${pct(totalRate)}</div>
                                            </div>
                                        </div>
                                    </div>
                                    ${budgetExecution.map(b => {
                                        const cat = b.category || '';
                                        const bAmt = Number(b.budget || 0);
                                        const uAmt = Number(b.used || 0);
                                        const rAmt = Number(b.remaining || 0);
                                        const rateVal = Number(b.rate || 0);
                                        const rateColor = rateVal > 0.8 ? red : (rateVal > 0.5 ? orange : green);
                                        return '<div style="padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.08);">' +
                                            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">' +
                                                '<span style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95);">' + escapeHtml(cat) + '</span>' +
                                                '<span style="font-weight:900; font-size:14px; color:' + rateColor + ';">' + pct(rateVal) + '</span>' +
                                            '</div>' +
                                            '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; font-size:12px;">' +
                                                '<div><span style="color:rgba(200,215,230,0.7);">预算</span><span style="font-weight:800; color:' + blue + ';"> ¥' + fmt(bAmt) + '</span></div>' +
                                                '<div><span style="color:rgba(200,215,230,0.7);">已用</span><span style="font-weight:800; color:' + red + ';"> ¥' + fmt(uAmt) + '</span></div>' +
                                                '<div><span style="color:rgba(200,215,230,0.7);">剩余</span><span style="font-weight:800; color:' + green + ';"> ¥' + fmt(rAmt) + '</span></div>' +
                                            '</div>' +
                                        '</div>';
                                    }).join('')}
                                    <div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:8px;">统计月份：${escapeHtml(ym)}（只统计已审批和已付款的请款单）</div>
                                `);
                            })()}
                        `;
                        if (box) box.innerHTML = html;
                        if (__BIZ_VIEW === 'dashboard') renderBizDashboard();
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
                return;
            }

            if (__REP_TAB === 'promotions') {
                const box = document.getElementById('rep-promotions-box');
                if (box) box.innerHTML = '加载中...';
                if (!repRoleCanViewPromotionRecords()) {
                    if (box) box.innerHTML = '<div style="color:#c2410c; padding:12px 0;">仅总部人事/总部运营/管理员可查看</div>';
                    return;
                }
                HRMS_API.getPromotionRecordsReport({ store, month, limit: 500 })
                    .then(resp => {
                        const rows = Array.isArray(resp?.items) ? resp.items : [];
                        try { window.__REP_LAST_PROMOTIONS = { month, store, rows: rows.slice() }; } catch (e) {}
                        const fmtMoney = (n) => {
                            const v = Number(n);
                            return Number.isFinite(v) && v > 0
                                ? ('¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                                : '-';
                        };
                        const html = `
                            <div class="rep-hero" style="background: linear-gradient(135deg, #0ea5e9, #0284c7);">
                                <div style="font-weight:900; font-size:16px;">晋升记录汇总</div>
                                <div class="meta" style="margin-top:6px;">范围：${escapeHtml(store || '全部门店')} · 月份：${escapeHtml(month || '全部')}</div>
                                <div class="rep-grid" style="margin-top:10px;">
                                    <div class="rep-metric"><div class="k">记录数</div><div class="v">${rows.length} 条</div></div>
                                    <div class="rep-metric"><div class="k">涉及门店</div><div class="v">${new Set(rows.map(x => String(x?.store || '').trim()).filter(Boolean)).size} 家</div></div>
                                </div>
                            </div>
                            <div class="rep-table" style="overflow-x:auto; margin-top:12px;">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>审批时间</th>
                                            <th>门店</th>
                                            <th>员工</th>
                                            <th>原岗位/级别</th>
                                            <th>新岗位/级别</th>
                                            <th style="text-align:right;">晋升后薪资</th>
                                            <th>审批人</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${rows.map(r => `
                                            <tr>
                                                <td>${escapeHtml(String(r?.approvedAt || '').slice(0, 19).replace('T', ' ') || '-')}</td>
                                                <td>${escapeHtml(String(r?.store || '-'))}</td>
                                                <td>${escapeHtml(String(r?.applicantName || r?.applicantUsername || '-'))}</td>
                                                <td>${escapeHtml(String(r?.fromPosition || '-'))} / ${escapeHtml(String(r?.fromLevel || '-'))}</td>
                                                <td>${escapeHtml(String(r?.toPosition || '-'))} / ${escapeHtml(String(r?.toLevel || '-'))}</td>
                                                <td style="text-align:right; font-weight:800; color:#22c55e;">${escapeHtml(fmtMoney(r?.promotedSalary))}</td>
                                                <td>${escapeHtml(hrmsDisplayName(String(r?.approvedBy || '')) || '-')}</td>
                                            </tr>
                                        `).join('')}
                                        ${!rows.length ? '<tr><td colspan="7" style="text-align:center; color:rgba(200,215,230,0.6); padding:16px 0;">暂无晋升记录</td></tr>' : ''}
                                    </tbody>
                                </table>
                            </div>
                        `;
                        if (box) box.innerHTML = html;
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
                return;
            }

            if (__REP_TAB === 'attendance') {
                const box = document.getElementById('rep-attendance-box');
                if (box) box.innerHTML = '加载中...';
                HRMS_API.getAttendanceReport({ store, start, end })
                    .then(resp => {
                        const summaryRows = Array.isArray(resp?.summaryRows) ? resp.summaryRows : (Array.isArray(resp?.rows) ? resp.rows : []);
                        const checkinDetails = Array.isArray(resp?.checkinDetails) ? resp.checkinDetails : [];
                        try { window.__REP_LAST_ATT = { store, start, end, rows: summaryRows.slice(), checkinDetails: checkinDetails.slice(), totals: resp?.totals || null }; } catch (e) {}
                        const html = repRenderAttendanceReport(resp, store, start, end);
                        if (box) box.innerHTML = html;
                        if (box) finalizeReportsBox(box);
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
                return;
            }

            if (__REP_TAB === 'daily-attendance-register') {
                const box = document.getElementById('rep-daily-attendance-register-box');
                if (box) box.innerHTML = '加载中...';
                HRMS_API.getDailyAttendanceRegisterReport({ store, start, end, employee: darEmp })
                    .then(resp => {
                        const rows = Array.isArray(resp?.rows) ? resp.rows : [];
                        const es = resp?.employee_summary || null;
                        const normDarLines = (row) => {
                            let ld = row?.line_details;
                            if (typeof ld === 'string') {
                                try { ld = JSON.parse(ld); } catch (e) { ld = []; }
                            }
                            return Array.isArray(ld) ? ld : [];
                        };
                        const segZh = (s) => ({ front: '前厅在职', kitchen: '后厨在职', rest: '休息', roster: '名册核对' }[s] || String(s || '—'));
                        const kindZh = (k) => {
                            if (k === 'rest') return '休息';
                            if (k === 'absent') return '缺勤';
                            if (k === 'leave_only') return '休假未列日报';
                            return k === 'work' ? '在职' : String(k || '—');
                        };
                        // 计算总异常数
                        const totalAnomalies = rows.reduce((sum, row) => sum + Number(row.anomaly_count ?? 0), 0);
                        const notifyDateVal = end; // 默认通知最后一天的异常

                        let html = `
                            <div class="rep-hero" style="background: linear-gradient(135deg, #1d4ed8, #6366f1);">
                                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                                    <div style="font-weight: 900; font-size: 16px;flex:1;">出勤表（营业日报核对）</div>
                                    ${isAdminUser() && totalAnomalies > 0 ? `<button data-click="notifyAttendanceAnomalies" data-arg="${escapeHtml(notifyDateVal)}" style="padding:6px 14px;border-radius:10px;background:rgba(251,146,60,0.2);border:1px solid rgba(251,146,60,0.4);color:#fdba74;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">📣 通知异常员工 (${totalAnomalies})</button>` : ''}
                                </div>
                                <div class="meta" style="margin-top: 8px;">数据来源：<strong>正式提交</strong>营业日报。在职人员与打卡、已通过休假比对；<strong>休息</strong>以日报为准（本休/调休不要求休假流程）。门店名册中未列入出勤/休息且无已通过休假者标为<strong>缺勤</strong>。</div>
                                <div class="meta" style="margin-top: 6px;">统计周期：${escapeHtml(start)} - ${escapeHtml(end)} · 每日默认折叠，点击标题展开明细</div>`;
                        if (darEmp && es) {
                            html += `
                                <div style="margin-top:14px;padding:12px 14px;border-radius:12px;background:rgba(15,23,42,0.55);border:1px solid rgba(129,140,248,0.45);text-align:left;">
                                    <div style="font-weight:900;font-size:14px;color:#e0e7ff;">员工筛选「${escapeHtml(es.employee_query || darEmp)}」· 区间内汇总</div>
                                    <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:14px 22px;font-size:13px;color:rgba(226,232,240,0.95);">
                                        <span><strong style="color:#86efac;">出勤天数</strong>（有在职记录的自然日）　<strong style="font-size:15px;">${escapeHtml(String(es.attendance_days ?? 0))}</strong></span>
                                        <span><strong style="color:#fde047;">休息天数</strong>（有休息记录的自然日）　<strong style="font-size:15px;">${escapeHtml(String(es.rest_days ?? 0))}</strong></span>
                                        <span>出勤人日累计　<strong>${escapeHtml(String(es.attendance_person_days ?? 0))}</strong></span>
                                        <span>休息人日累计　<strong>${escapeHtml(String(es.rest_person_days ?? 0))}</strong></span>
                                    </div>
                                    <div style="margin-top:8px;font-size:11px;color:rgba(199,210,254,0.75);">姓名支持模糊匹配显示名或账号；天数按自然日去重；人日为明细申报人日之和。</div>
                                </div>`;
                        }
                        html += '</div>';
                        if (!rows.length) {
                            html += darEmp
                                ? '<div style="color:rgba(200,215,230,0.55); padding:20px; text-align:center;">所选区间<strong>无匹配该姓名</strong>的出勤表明细；请尝试更换关键词、扩大日期或确认门店范围。</div>'
                                : '<div style="color:rgba(200,215,230,0.5); padding:20px; text-align:center;">暂无台账：仅统计<strong>已正式提交</strong>且写入数据库的营业日报；上线前的历史日报需由系统自动补缺（重启服务后最多补约 2500 条）。请确认日期范围包含提交日，门店筛选为「所有门店」；仍无数据则说明所选时间内 PostgreSQL 中尚无日报记录。</div>';
                            if (box) box.innerHTML = html;
                            return;
                        }
                        html += '<style>.rep-dar-day summary::-webkit-details-marker{display:none}.rep-dar-day summary{list-style:none}.rep-dar-day[open] summary .rep-dar-chev{transform:rotate(90deg)}</style>';
                        html += '<div style="margin-top:14px;display:flex;flex-direction:column;gap:8px;">';
                        for (const row of rows) {
                            const lines = normDarLines(row);
                            const anomLines = lines.filter((l) => String(l.status || '') !== 'verified');
                            const anomCount = anomLines.length;
                            const ok = anomCount === 0;
                            const dateStr = String(row.report_date || '').slice(0, 10);
                            html += `<details class="rep-dar-day" style="border:1px solid ${ok ? 'rgba(34,197,94,0.15)' : 'rgba(249,115,22,0.25)'};border-radius:14px;background:${ok ? 'rgba(15,23,42,0.28)' : 'rgba(30,15,5,0.45)'};overflow:hidden;">
<summary style="cursor:pointer;padding:13px 14px;display:flex;align-items:center;gap:10px;user-select:none;">
<span class="rep-dar-chev" style="display:inline-block;transition:transform .15s;color:rgba(148,163,184,0.8);font-size:12px;">▸</span>
<div style="flex:1;min-width:0;">
  <div style="font-size:13px;font-weight:800;color:#e2e8f0;">${escapeHtml(String(row.store || ''))}</div>
  <div style="font-size:11px;color:rgba(148,163,184,0.8);margin-top:2px;">${escapeHtml(dateStr)}</div>
</div>
${ok
    ? '<span style="padding:3px 10px;border-radius:999px;background:rgba(34,197,94,0.15);color:#86efac;font-size:11px;font-weight:800;">✓ 全部核实</span>'
    : `<span style="padding:3px 10px;border-radius:999px;background:rgba(249,115,22,0.18);color:#fdba74;font-size:11px;font-weight:800;">⚠ 异常 ${escapeHtml(String(anomCount))} 人</span>`}
</summary>`;
                            if (!ok) {
                                html += `<div style="padding:0 14px 14px;border-top:1px solid var(--pf-line);margin-top:0;">`;
                                for (const ln of anomLines) {
                                    const rs = Array.isArray(ln.reasons) && ln.reasons.length ? ln.reasons.join('；') : (ln.has_clock_in ? '状态异常' : '无打卡记录');
                                    html += `<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
<div style="width:6px;height:6px;border-radius:50%;background:#f97316;flex-shrink:0;"></div>
<div style="flex:1;min-width:0;">
  <div style="font-size:12px;font-weight:700;color:#e2e8f0;">${escapeHtml(String(ln.display_name || ln.username || '—'))}</div>
  <div style="font-size:11px;color:rgba(251,146,60,0.8);margin-top:2px;">${escapeHtml(rs)}</div>
</div>
<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:rgba(251,146,60,0.12);color:#fdba74;">${escapeHtml(ln.has_clock_in ? '有打卡' : '无打卡')}</span>
</div>`;
                                }
                                html += `</div>`;
                            } else {
                                html += `<div style="padding:10px 14px 12px;font-size:12px;color:rgba(134,239,172,0.7);">当日所有员工出勤状态均已核实 ✓</div>`;
                            }
                            html += `</details>`;
                        }
                        html += '</div>';
                        if (box) box.innerHTML = html;
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
                return;
            }

            if (__REP_TAB === 'payroll') {
                const box = document.getElementById('rep-payroll-box');
                if (box) box.innerHTML = '加载中...';

                const auditBtn = document.getElementById('rep-payroll-audit-btn');
                const canAudit = hrmsPayrollPermAllowed('reports.payroll.audit', currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER || currentUser.role === ROLES.HR_MANAGER));
                const canEditPayroll = hrmsPayrollPermAllowed('reports.payroll.adjust', currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HR_MANAGER));
                if (auditBtn) auditBtn.style.display = canAudit ? '' : 'none';

                HRMS_API.getPayrollReport({ store, month })
                    .then(resp => {
                        const rowsRaw = Array.isArray(resp?.rows) ? resp.rows : [];
                        const rowMap = new Map();
                        rowsRaw.forEach((r) => {
                            const st = String(r?.store || '').trim();
                            const u = String(r?.username || '').trim().toLowerCase();
                            if (!u) return;
                            const k = `${st}||${u}`;
                            if (!rowMap.has(k)) {
                                rowMap.set(k, r);
                                return;
                            }
                            const prev = rowMap.get(k) || {};
                            const prevDays = Number(prev?.attendanceDays || 0) || 0;
                            const nextDays = Number(r?.attendanceDays || 0) || 0;
                            // Keep the row with higher attendance / richer numeric payload
                            const prevScore = prevDays + (Number(prev?.amount || 0) || 0) / 100000;
                            const nextScore = nextDays + (Number(r?.amount || 0) || 0) / 100000;
                            if (nextScore >= prevScore) rowMap.set(k, r);
                        });
                        const rows = Array.from(rowMap.values());
                        const audit = resp?.audit || null;
                        const audited = !!audit?.audited;
                        const auditEl = document.getElementById('rep-payroll-audit');
                        if (auditEl) auditEl.textContent = audited ? '状态：已审核' : '状态：未审核';
                        const engEl = document.getElementById('rep-payroll-engine');
                        const monthRun = resp?.monthRun || null;
                        const runStatus = String(monthRun?.status || 'open');
                        if (engEl) {
                            const eng = String(resp?.engine || 'legacy');
                            engEl.textContent = eng === 'closed_loop_v1'
                              ? `闭环引擎 · 月结:${runStatus} · 分母${Number(resp?.workDaysPerMonth || 0)}天`
                              : `引擎:${eng}`;
                        }
                        const canMonthLock = hrmsPayrollPermAllowed('reports.payroll.month_run', currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HR_MANAGER || currentUser.role === ROLES.HQ_MANAGER));
                        const showBtn = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
                        showBtn('rep-payroll-att-lock-btn', canMonthLock && runStatus === 'open');
                        showBtn('rep-payroll-pay-lock-btn', canMonthLock && runStatus === 'attendance_locked');
                        showBtn('rep-payroll-paid-btn', canMonthLock && runStatus === 'payroll_locked');
                        showBtn('rep-payroll-reopen-btn', canMonthLock && runStatus !== 'open');
                        // 拉取有打卡无排班异常
                        const abBox = document.getElementById('rep-payroll-abnormals');
                        if (abBox && store) {
                            fetch(`/api/hrms/attendance-day/abnormals?store=${encodeURIComponent(store)}&start=${encodeURIComponent(month + '-01')}&end=${encodeURIComponent(month + '-31')}`, {
                                headers: { Authorization: 'Bearer ' + (localStorage.getItem('hrms_token') || '') }
                            }).then((r) => r.json()).then((ab) => {
                                const list = Array.isArray(ab?.rows) ? ab.rows : [];
                                if (!list.length) { abBox.style.display = 'none'; abBox.innerHTML = ''; return; }
                                abBox.style.display = '';
                                abBox.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">有打卡无排班异常（${list.length}）— 店长请确认记出勤或休息</div>` +
                                  list.slice(0, 20).map((x) => {
                                    const u = escapeHtml(String(x.username || ''));
                                    const d = escapeHtml(String(x.work_date || '').slice(0, 10));
                                    const n = escapeHtml(String(x.name || x.username || ''));
                                    return `<div style="margin:4px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                                      <span>${n} · ${d}</span>
                                      <button class="btn btn-secondary" type="button" style="padding:2px 8px;font-size:12px;" data-click="confirmPayrollAttendanceAbnormal" data-arg="${u}" data-arg2="${d}" data-arg3="work">记出勤</button>
                                      <button class="btn btn-secondary" type="button" style="padding:2px 8px;font-size:12px;" data-click="confirmPayrollAttendanceAbnormal" data-arg="${u}" data-arg2="${d}" data-arg3="rest">记休息</button>
                                    </div>`;
                                  }).join('');
                            }).catch(() => { abBox.style.display = 'none'; });
                        } else if (abBox) { abBox.style.display = 'none'; }
                        const fmt = (n) => {
                            if (n == null) return '-';
                            const v = Number(n || 0);
                            return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
                        };
                        const totalAmount = rows.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
                        const totalAttDays = rows.reduce((s, r) => s + (Number(r?.attendanceDays) || 0), 0);
                        const totalPayableDays = rows.reduce((s, r) => s + (Number(r?.payableAttendanceDays) || 0), 0);
                        const totalLeaveOffsetDays = rows.reduce((s, r) => s + (Number(r?.leaveOffsetDays) || 0), 0);
                        const titleStore = store || '全部门店';
                        const rpCls = (n) => {
                            const v = Number(n || 0);
                            if (!Number.isFinite(v)) return '';
                            return v >= 0 ? 'rep-pay-cell--pos' : 'rep-pay-cell--neg';
                        };
                        const subCls = (n) => {
                            const v = Number(n || 0);
                            if (!Number.isFinite(v)) return '';
                            return v >= 0 ? 'rep-pay-cell--pos' : 'rep-pay-cell--neg';
                        };
                        const loCls = (n) => {
                            const v = Number(n || 0);
                            if (!Number.isFinite(v)) return '';
                            return v > 0 ? 'rep-pay-cell--warn' : '';
                        };
                        const html = `
                            <div class="rep-hero">
                                <div style="display:flex; justify-content: space-between; align-items:flex-start; gap: 12px; flex-wrap: wrap;">
                                    <div>
                                        <div style="font-weight: 800; font-size: 15px; letter-spacing:0.04em;">${escapeHtml(titleStore)} · 薪资汇总</div>
                                        <div class="meta" style="margin-top: 8px;">账期 ${escapeHtml(month || '')} · ${audited ? '已审核' : '未审核'}</div>
                                        <div class="meta" style="margin-top: 4px;">计薪：月薪 ÷（月天数 − 应休${Number(resp?.rules?.monthlyRestDays ?? 4)}）= 月薪 ÷ ${Number(resp?.workDaysPerMonth || 0)} 个工作日${resp?.engine === 'closed_loop_v1' ? ' · 积分/奖惩/补贴按账本相加 · 晋升次月生效' : ''}</div>
                                    </div>
                                </div>
                                <div class="rep-grid">
                                    <div class="rep-metric">
                                        <div class="k">人数</div>
                                        <div class="v">${rows.length}</div>
                                    </div>
                                    <div class="rep-metric">
                                        <div class="k">实际出勤合计</div>
                                        <div class="v">${totalAttDays.toFixed(1)}<span style="font-size:12px;font-weight:600;opacity:0.85"> 天</span></div>
                                    </div>
                                    <div class="rep-metric">
                                        <div class="k">假期抵扣合计</div>
                                        <div class="v">${totalLeaveOffsetDays.toFixed(1)}<span style="font-size:12px;font-weight:600;opacity:0.85"> 天</span></div>
                                    </div>
                                    <div class="rep-metric">
                                        <div class="k">计薪出勤合计</div>
                                        <div class="v">${totalPayableDays.toFixed(1)}<span style="font-size:12px;font-weight:600;opacity:0.85"> 天</span></div>
                                    </div>
                                    <div class="rep-metric" style="grid-column: 1 / -1;">
                                        <div class="k">应发总额</div>
                                        <div class="v" style="color:var(--rep-gold);">¥${fmt(totalAmount)}</div>
                                    </div>
                                </div>
                            </div>
                            <div class="rep-pay-section-title">员工明细</div>
                            <div class="rep-pay-stack">
                                ${rows.length ? rows.map(r => {
                                    const nm = escapeHtml(String(r?.name || r?.username || ''));
                                    const st = escapeHtml(String(r?.store || ''));
                                    const un = escapeHtml(String(r?.username || ''));
                                    const sto = escapeHtml(String(r?.store || ''));
                                    const baseWarn = r?.baseAmountOverridden ? ' rep-pay-cell--warn' : '';
                                    const actParts = [];
                                    if (canEditPayroll) {
                                        actParts.push(`<button class="btn btn-secondary" type="button" data-click="editPayrollBaseAmount" data-arg="${un}" data-arg2="${sto}" data-arg3="${Number(r?.baseAmount || 0)}" data-arg3-type="number" data-stop>基础应发</button>`);
                                        actParts.push(`<button class="btn btn-secondary" type="button" data-click="editPayrollSubsidy" data-arg="${un}" data-arg2="${sto}" data-arg3="${Number(r?.subsidy || 0)}" data-arg3-type="number" data-stop>补贴</button>`);
                                    }
                                    actParts.push(`<button class="btn btn-secondary" type="button" data-click="openSalaryChangeHistoryModal" data-arg="${un}" data-arg2="${nm}" data-stop>薪资记录</button>`);
                                    const act = actParts.length ? `<div class="rep-pay-card__actions">${actParts.join('')}</div>` : '';
                                    return `
                                    <details class="rep-pay-card rep-row-details">
                                        <summary class="rep-row-details__summary">
                                            <div style="flex:1; min-width:0;">
                                                <div class="rep-pay-card__name">${nm}</div>
                                                <span class="rep-pay-card__store">${st || '—'}</span>
                                            </div>
                                            <div style="text-align:right; flex-shrink:0;">
                                                <div style="font-size:11px; color:var(--rep-muted); font-weight:700;">实发</div>
                                                <div style="font-size:17px; font-weight:900; color:var(--rep-teal); font-family:var(--rep-mono);">¥${fmt(r?.amount)}</div>
                                            </div>
                                            <span class="rep-row-details__chev" aria-hidden="true">▼</span>
                                        </summary>
                                        <div class="rep-row-details__body">
                                            <div class="rep-pay-card__grid">
                                                <div class="rep-pay-cell"><span class="k">实际出勤</span><span class="v">${escapeHtml(String(r?.attendanceDays ?? 0))}</span></div>
                                                <div class="rep-pay-cell${loCls(r?.leaveOffsetDays)}"><span class="k">假期抵扣</span><span class="v">${escapeHtml(String(r?.leaveOffsetDays ?? 0))}</span></div>
                                                <div class="rep-pay-cell"><span class="k">计薪出勤</span><span class="v">${escapeHtml(String(r?.payableAttendanceDays ?? r?.attendanceDays ?? 0))}</span></div>
                                                <div class="rep-pay-cell"><span class="k">月薪</span><span class="v">${fmt(r?.monthlySalary)}</span></div>
                                                <div class="rep-pay-cell"><span class="k">日薪</span><span class="v">${fmt(r?.dailyRate)}</span></div>
                                                <div class="rep-pay-cell${baseWarn}"><span class="k">基础应发</span><span class="v">${fmt(r?.baseAmount)}</span></div>
                                                <div class="rep-pay-cell ${rpCls(r?.rewardPunishmentAdj)}"><span class="k">奖惩</span><span class="v">${Number(r?.rewardPunishmentAdj || 0) >= 0 ? '+' : ''}${fmt(r?.rewardPunishmentAdj)}</span></div>
                                                <div class="rep-pay-cell ${subCls(r?.subsidy)}"><span class="k">补贴</span><span class="v">${Number(r?.subsidy || 0) >= 0 ? '+' : ''}${fmt(r?.subsidy)}</span></div>
                                                <div class="rep-pay-cell rep-pay-cell--warn" style="grid-column:1/-1;"><span class="k">抵扣后累计假期</span><span class="v">${fmt(r?.remainingLeaveAfterOffset)}</span></div>
                                            </div>
                                            <div class="rep-pay-cell rep-pay-cell--accent" style="margin-top:10px;border-radius:12px;">
                                                <span class="k">实发应发</span>
                                                <span class="v" style="font-size:18px;">¥${fmt(r?.amount)}</span>
                                            </div>
                                            ${act}
                                        </div>
                                    </details>`;
                                }).join('') : '<div class="rep-pay-empty">该条件下暂无薪资明细</div>'}
                            </div>
                            <div class="rep-pay-total">
                                <div class="rep-pay-total__row"><span>人数合计</span><span>${rows.length} 人</span></div>
                                <div class="rep-pay-total__row"><span>实际出勤合计</span><span>${totalAttDays.toFixed(1)} 天</span></div>
                                <div class="rep-pay-total__row"><span>假期抵扣合计</span><span>${totalLeaveOffsetDays.toFixed(1)} 天</span></div>
                                <div class="rep-pay-total__row"><span>计薪出勤合计</span><span>${totalPayableDays.toFixed(1)} 天</span></div>
                                <div class="rep-pay-total__row" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1);"><span>应发总额</span><span class="rep-pay-total__amt">¥${fmt(totalAmount)}</span></div>
                            </div>
                        `;
                        if (box) box.innerHTML = html;
                        try {
                            window.__REP_PAYROLL_LAST = { month, store, audited: audited, monthDays: Number(resp?.monthDays || 0), workDaysPerMonth: Number(resp?.workDaysPerMonth || 0) };
                            window.__REP_LAST_PAYROLL = { month, store, audited: audited, monthDays: Number(resp?.monthDays || 0), workDaysPerMonth: Number(resp?.workDaysPerMonth || 0), rows: rows.slice(), audit: audit || null };
                        } catch (e) {}
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
            }

            if (__REP_TAB === 'inventory-forecast') {
                const box = document.getElementById('rep-inventory-forecast-box');
                if (box) box.innerHTML = '加载中...';
                const invState = repCollectInventoryForecastState();
                const storeVal = String(store || '').trim();
                if (!storeVal && !brandId) {
                    if (box) box.innerHTML = '<div style="color:#c2410c; padding:12px 0;">请先选择品牌（可选门店）后再进行预测</div>';
                    return;
                }
                const combos = [
                    ['takeaway', 'lunch'],
                    ['takeaway', 'afternoon'],
                    ['takeaway', 'dinner'],
                    ['dinein', 'lunch'],
                    ['dinein', 'afternoon'],
                    ['dinein', 'dinner']
                ];
                const basePayload = {
                    store: storeVal,
                    brandId,
                    date: invState.date,
                    weather: invState.weather,
                    isHoliday: !!invState.isHoliday,
                    topN: Number(invState.topN || 20)
                };
                Promise.all([
                    Promise.all(combos.map(([bizType, slotType]) =>
                        HRMS_API.predictInventoryForecast({
                            ...basePayload,
                            bizType,
                            slot: slotType,
                            expectedRevenue: Number(bizType === 'takeaway' ? (invState.expectedRevenueTakeaway ?? invState.expectedRevenue ?? 0) : (invState.expectedRevenueDinein ?? invState.expectedRevenue ?? 0))
                        })
                            .then(resp => ({ ok: true, bizType, slot: slotType, resp }))
                            .catch(err => ({ ok: false, bizType, slot: slotType, err }))
                    )),
                    HRMS_API.getInventoryForecastHistory({
                        store: storeVal,
                        brandId,
                        bizType: invState.historyBizType,
                        limit: 120
                    }).catch(() => ({ items: [] })),
                    HRMS_API.getInventoryForecastAccuracy({
                        store: storeVal,
                        brandId,
                        limit: 200
                    }).catch(() => ({ summary: {}, items: [] })),
                    HRMS_API.estimateInventoryRevenue({
                        store: storeVal,
                        brandId,
                        date: invState.date,
                        weather: invState.weather,
                        isHoliday: !!invState.isHoliday
                    }).catch(() => ({ estimate: {} })),
                    HRMS_API.getForecastGrossProfitProfiles({
                        brandId
                    }).catch(() => ({ items: [] })),
                    HRMS_API.getForecastProductAliases({
                        brandId
                    }).catch(() => ({ items: [] })),
                    HRMS_API.estimateForecastGrossMargin({
                        brandId,
                        startDate: invState.grossMarginStartDate || invState.date,
                        endDate: invState.grossMarginEndDate || invState.date,
                        bizType: invState.grossMarginBizType || ''
                    }).catch(() => ({ estimate: {} }))
                ])
                    .then(([predList, histResp, accResp, revResp, profileResp, aliasResp, grossResp]) => {
                        const predMap = {};
                        predList.forEach((it) => {
                            const key = `${it.bizType}||${it.slot}`;
                            if (it.ok) predMap[key] = it.resp || {};
                            else predMap[key] = { source: 'heuristic', confidence: 0, predictions: [], summary: String(it?.err?.message || '预测失败') };
                        });
                        const data = {
                            store: storeVal,
                            brandId,
                            brandName: getBrandNameById(brandId),
                            state: invState,
                            predMap,
                            historyRows: Array.isArray(histResp?.items) ? histResp.items : [],
                            accuracySummary: accResp?.summary || {},
                            accuracyItems: Array.isArray(accResp?.items) ? accResp.items : [],
                            revenueEstimate: revResp || {},
                            grossProfiles: Array.isArray(profileResp?.items) ? profileResp.items : [],
                            productAliases: Array.isArray(aliasResp?.items) ? aliasResp.items : [],
                            grossMarginEstimate: grossResp || {}
                        };
                        try { window.__REP_LAST_INV_FORECAST = data; } catch (e) {}
                        renderInventoryForecastReport(data, box);
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
                return;
            }

            if (__REP_TAB === 'turnover') {
                const box = document.getElementById('rep-turnover-box');
                if (box) box.innerHTML = '加载中...';
                HRMS_API.getTurnoverReport({ store, month })
                    .then(resp => {
                        try { window.__REP_LAST_TURNOVER = resp; } catch (e) {}
                        renderTurnoverReport(resp, box);
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
                return;
            }

            if (__REP_TAB === 'leave-owed') {
                const box = document.getElementById('rep-leave-owed-box');
                if (box) box.innerHTML = '加载中...';
                const leaveMonth = /^\d{4}-\d{2}$/.test(String(month || '').trim())
                    ? String(month || '').trim()
                    : new Date().toISOString().slice(0, 7);
                HRMS_API.getLeaveOwedReport({ month: leaveMonth, store })
                    .then((resp) => {
                        const merged = repMergeLeaveOwedMultiMonth([resp], [leaveMonth], { store });
                        try { window.__REP_LAST_LEAVE_OWED = merged; } catch (e) {}
                        renderLeaveOwedReport(merged, box);
                    })
                    .catch(e => {
                        if (box) box.innerHTML = escapeHtml('加载失败：' + String(e?.message || e));
                    });
            }
        }

        function repBuildRecentMonths(endMonth, count) {
            const safe = String(endMonth || '').trim();
            const m = /^\d{4}-\d{2}$/.test(safe) ? safe : new Date().toISOString().slice(0, 7);
            const [y0, mo0] = m.split('-').map(Number);
            const total = Math.max(1, Number(count) || 1);
            const out = [];
            for (let i = total - 1; i >= 0; i--) {
                const dt = new Date(y0, mo0 - 1 - i, 1);
                out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
            }
            return out;
        }

        function repMergeLeaveOwedMultiMonth(list, months, meta = {}) {
            const reports = Array.isArray(list) ? list : [];
            const monthList = Array.isArray(months) ? months : [];
            const latest = reports[reports.length - 1] || {};
            const byUser = new Map();

            reports.forEach((rep, idx) => {
                const m = monthList[idx] || String(rep?.month || '');
                const rows = Array.isArray(rep?.rows) ? rep.rows : [];
                rows.forEach((r) => {
                    const uname = String(r?.username || '').trim();
                    if (!uname) return;
                    if (!byUser.has(uname)) {
                        byUser.set(uname, {
                            username: uname,
                            name: String(r?.name || uname).trim(),
                            role: String(r?.role || '').trim(),
                            store: String(r?.store || '').trim(),
                            position: String(r?.position || '').trim(),
                            lastAdjustment: r?.lastAdjustment || null,
                            monthly: {}
                        });
                    }
                    const row = byUser.get(uname);
                    row.monthly[m] = {
                        cumulativeLeaveDays: Number(r?.cumulativeLeaveDays || 0),
                        actualRestDays: Number(r?.actualRestDays || 0),
                        holidayDays: Number(r?.holidayDays || 0),
                        diff: Number((Number(r?.holidayDays || 0) - Number(r?.actualRestDays || 0)).toFixed(2)),
                        remaining: Number(r?.remaining || 0),
                        owedDays: Number(r?.owedDays || 0),
                        isOwed: !!r?.isOwed,
                        usedLeaveDetails: Array.isArray(r?.usedLeaveDetails) ? r.usedLeaveDetails : []
                    };
                    if (r?.lastAdjustment) row.lastAdjustment = r.lastAdjustment;
                });
            });

            const rows = Array.from(byUser.values()).map((r) => {
                let latestRemaining = 0;
                let latestDiff = 0;
                const latestMonth = monthList[monthList.length - 1] || '';
                if (latestMonth && r.monthly[latestMonth]) latestRemaining = Number(r.monthly[latestMonth].remaining || 0);
                if (latestMonth && r.monthly[latestMonth]) latestDiff = Number(r.monthly[latestMonth].diff || 0);
                const cumulativeLeaveDays = Number(r?.monthly?.[latestMonth]?.cumulativeLeaveDays || 0);
                return {
                    ...r,
                    latestRemaining,
                    latestDiff,
                    cumulativeLeaveDays,
                    isOwedAny: monthList.some(m => Number(r?.monthly?.[m]?.remaining || 0) > 0)
                };
            }).sort((a, b) => {
                if (Number(a.isOwedAny) !== Number(b.isOwedAny)) return Number(b.isOwedAny) - Number(a.isOwedAny);
                if (Number(a.latestRemaining || 0) !== Number(b.latestRemaining || 0)) return Number(b.latestRemaining || 0) - Number(a.latestRemaining || 0);
                return String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), 'zh-Hans-CN');
            });

            const totals = rows.reduce((acc, r) => {
                acc.people += 1;
                if (r.isOwedAny) acc.owedPeople += 1;
                acc.monthlyDiffTotal = Number((acc.monthlyDiffTotal + Number(r.latestDiff || 0)).toFixed(2));
                acc.cumulativeLeaveDays = Number((acc.cumulativeLeaveDays + Number(r.cumulativeLeaveDays || 0)).toFixed(2));
                return acc;
            }, { people: 0, owedPeople: 0, cumulativeLeaveDays: 0, monthlyDiffTotal: 0 });

            return {
                month: monthList[monthList.length - 1] || '',
                store: String(meta?.store || latest?.store || ''),
                canAdjust: !!latest?.canAdjust,
                months: monthList,
                totals,
                rows,
                adjustments: Array.isArray(latest?.adjustments) ? latest.adjustments : []
            };
        }

        async function repAdjustLeaveBalance(username, month, currentVal) {
            if (!currentUser) return;
            const valueInput = prompt(`请输入 ${username} 在薪资月 ${month} 的「截止上月」累计假期池（天，可 0.5）。与我的档案展示、次月1日6:00锁定口径一致。`, String(currentVal ?? '0'));
            if (valueInput === null) return;
            const val = Number(String(valueInput || '').trim());
            if (!Number.isFinite(val)) {
                showNotification('请输入有效数字，支持 0.5', 'warning');
                return;
            }
            const noteInput = prompt('请输入调整原因（将记录在审计日志中）', '');
            if (noteInput === null) return;
            const note = String(noteInput || '').trim();
            if (!note) {
                showNotification('请填写调整原因', 'warning');
                return;
            }
            try {
                await HRMS_API.request('/api/checkin/leave-balance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, month, value: val, mode: 'carryover', note })
                });
                showNotification('累计假期已调整并记录审计日志', 'success');
                loadReportsData();
            } catch (e) {
                showNotification('调整失败：' + String(e?.message || e), 'error');
            }
        }

        function renderLeaveOwedReport(resp, box) {
            if (!box) return;
            const rows = Array.isArray(resp?.rows) ? resp.rows : [];
            const totals = resp?.totals || {};
            const canAdjust = !!resp?.canAdjust;
            const month = String(resp?.month || '');
            const months = Array.isArray(resp?.months) && resp.months.length ? resp.months : [month];
            const fmt = (n, digits) => {
                const v = Number(n || 0);
                const d = Number.isFinite(Number(digits)) ? Number(digits) : 2;
                return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '0';
            };
            const fmtInt = (n) => {
                const v = Number(n || 0);
                return Number.isFinite(v) ? v.toLocaleString('zh-CN') : '0';
            };
            const adjustments = Array.isArray(resp?.adjustments) ? resp.adjustments.slice(0, 30) : [];
            const monthTag = (m) => {
                const s = String(m || '');
                if (!/^\d{4}-\d{2}$/.test(s)) return s;
                return `${Number(s.slice(5, 7))}月差值(假-休)`;
            };

            const titleStore = String(resp?.store || '').trim() || '全部门店';
            const statMonth = String(months[months.length - 1] || month || '').trim();
            const cumulativeTotal = Number(totals?.cumulativeLeaveDays || 0);
            const monthlyDiffTotal = Number(totals?.monthlyDiffTotal || 0);

            const diffCellClass = (row, m) => {
                const one = row?.monthly?.[m] || {};
                const diff = Number(one?.diff);
                if (!Number.isFinite(diff)) return '';
                if (diff > 0) return 'rep-pay-cell--neg';
                if (diff < 0) return 'rep-pay-cell--pos';
                return '';
            };
            const diffText = (row, m) => {
                const one = row?.monthly?.[m] || {};
                const diff = Number(one?.diff);
                if (!Number.isFinite(diff)) return '0.00';
                return (diff > 0 ? '+' : '') + fmt(diff, 2);
            };

            const html = `
                <div class="rep-hero">
                    <div style="font-weight:800; font-size:15px; letter-spacing:0.04em;">欠休报表 · ${escapeHtml(titleStore)}</div>
                    <div class="meta" style="margin-top:8px;">统计月份 ${escapeHtml(statMonth)} · 人员 ${fmtInt(totals.people)} · 欠休人数 ${fmtInt(totals.owedPeople)}</div>
                    <div class="meta" style="margin-top:4px;">本月欠休合计（假−休）${fmt(monthlyDiffTotal, 2)} · 累计假期合计 ${fmt(cumulativeTotal, 2)}</div>
                    <div class="rep-grid" style="margin-top:14px;">
                        <div class="rep-metric"><div class="k">统计月份</div><div class="v">${escapeHtml(statMonth || '-')}</div></div>
                        <div class="rep-metric"><div class="k">本月欠休合计</div><div class="v">${fmt(monthlyDiffTotal, 2)}</div></div>
                        <div class="rep-metric" style="grid-column:1/-1;"><div class="k">累计假期合计</div><div class="v" style="color:var(--rep-gold);">${fmt(cumulativeTotal, 2)}</div></div>
                    </div>
                </div>
                <p class="rep-filters__hint" style="margin:12px 0 0; font-size:11px; line-height:1.45; color:var(--rep-muted);">说明：本表按「薪资月份」整月统计，不受分析报表上方日期区间影响。「当月欠休合计」等假−休相关汇总随日报与休假每日实时重算（每次打开/刷新报表拉最新）。「累计假期」列与我的档案一致：人事「调整累计假期」保存后以人工月初池为准、当月内不再公式滚动该列；否则为上月末系统锁定（次月1日6:00）或滚动计算。有权限者可对单人做累计假期校准。</p>
                <div class="rep-pay-section-title">人员明细</div>
                <div class="rep-pay-stack">
                    ${rows.length ? rows.map(r => {
                        const latestM = months[months.length - 1] || month;
                        const latestActualRest = Number(r?.monthly?.[latestM]?.actualRestDays || 0);
                        const latestHolidayDays = Number(r?.monthly?.[latestM]?.holidayDays || 0);
                        const restDetails = r?.monthly?.[latestM]?.usedLeaveDetails || [];
                        const adj = r?.lastAdjustment || null;
                        const adjText = adj
                            ? `${escapeHtml(String(adj?.adjustedBy || '-'))} · ${escapeHtml(String(adj?.adjustedAt || '').slice(0, 16).replace('T', ' '))}<br><span style="opacity:0.85">${escapeHtml(String(adj?.note || ''))}</span>`
                            : '—';
                        const monthCells = months.map(m => `
                            <div class="rep-pay-cell ${diffCellClass(r, m)}"><span class="k">${escapeHtml(monthTag(m))}</span><span class="v">${diffText(r, m)}</span></div>
                        `).join('');
                        const adjBtn = canAdjust
                            ? `<div class="rep-pay-card__actions"><button class="btn btn-secondary" type="button" onclick="event.stopPropagation(); repAdjustLeaveBalance('${escapeJsString(String(r?.username || ''))}', '${escapeJsString(latestM)}', ${Number(r?.cumulativeLeaveDays || 0)})">调整累计假期</button></div>`
                            : '';
                        const personName = escapeHtml(String(r?.name || r?.username || ''));
                        const personMeta = escapeHtml(String(r?.username || '')) + ' · ' + escapeHtml(String(r?.store || '-')) + ' · ' + escapeHtml(String(r?.position || '-'));
                        return `
                        <details class="rep-pay-card rep-row-details">
                            <summary class="rep-row-details__summary">
                                <div style="flex:1; min-width:0;">
                                    <div class="rep-pay-card__name">${personName}</div>
                                    <span class="rep-pay-card__store">${personMeta}</span>
                                </div>
                                <div style="text-align:right; flex-shrink:0;">
                                    <div style="font-size:11px; color:var(--rep-muted); font-weight:700;">累计假期</div>
                                    <div style="font-size:16px; font-weight:900; color:#fbbf24; font-family:var(--rep-mono);">${fmt(r?.cumulativeLeaveDays || 0, 2)}</div>
                                </div>
                                <span class="rep-row-details__chev" aria-hidden="true">▼</span>
                            </summary>
                            <div class="rep-row-details__body">
                                <div class="rep-pay-card__grid">
                                    ${monthCells}
                                    <div class="rep-pay-cell"><span class="k">当月实际休息</span><span class="v">${fmt(latestActualRest, 2)}</span></div>
                                    <div class="rep-pay-cell"><span class="k">当月假期天数</span><span class="v">${fmt(latestHolidayDays, 2)}</span></div>
                                    <div style="grid-column:1/-1;margin-top:8px;border-top:1px solid var(--pf-line);padding-top:8px;">
                                        <div style="font-size:11px;color:rgba(200,215,230,0.6);margin-bottom:6px;">明细</div>
                                        ${restDetails.length ? restDetails.map(function(d) {
                                            return '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:rgba(200,215,230,0.8);">'
                                                + '<span>' + escapeHtml(d.type) + ' · ' + escapeHtml(d.date || '') + '</span>'
                                                + '<span>' + (d.days || 0) + '天</span>'
                                                + '</div>';
                                        }).join('') : '<div style="font-size:11px;color:rgba(200,215,230,0.4);">暂无明细</div>'}
                                    </div>
                                    <div class="rep-pay-cell rep-pay-cell--warn" style="grid-column:1/-1;"><span class="k">累计假期（首页同口径）</span><span class="v">${fmt(r?.cumulativeLeaveDays || 0, 2)}</span></div>
                                    <div class="rep-pay-cell" style="grid-column:1/-1;"><span class="k">最近调整</span><span class="v" style="font-size:12px;font-weight:600;line-height:1.45;">${adjText}</span></div>
                                </div>
                                ${adjBtn}
                            </div>
                        </details>`;
                    }).join('') : '<div class="rep-pay-empty">该条件下暂无欠休数据</div>'}
                </div>
                ${adjustments.length ? `
                    <div class="rep-pay-section-title" style="margin-top:22px;">最近调整记录</div>
                    <div class="rep-pay-stack">
                        ${adjustments.map(a => `
                            <details class="rep-pay-card rep-row-details">
                                <summary class="rep-row-details__summary">
                                    <div style="flex:1; min-width:0;">
                                        <div class="rep-pay-card__name" style="font-size:14px;">${escapeHtml(String(a?.targetName || a?.targetUsername || '-'))}</div>
                                        <span class="rep-pay-card__store">${escapeHtml(String(a?.targetUsername || '-'))} · ${escapeHtml(String(a?.adjustedAt || '').slice(0, 16).replace('T', ' '))}</span>
                                    </div>
                                    <div style="text-align:right; flex-shrink:0; font-size:12px; font-weight:800; color:var(--rep-teal); font-family:var(--rep-mono);">${fmt(a?.oldValue)}→${fmt(a?.newValue)}</div>
                                    <span class="rep-row-details__chev" aria-hidden="true">▼</span>
                                </summary>
                                <div class="rep-row-details__body">
                                    <div class="meta">${escapeHtml(String(a?.adjustedBy || '-'))} 于 ${escapeHtml(String(a?.adjustedAt || '').slice(0, 16).replace('T', ' '))} · ${fmt(a?.oldValue)} → ${fmt(a?.newValue)}</div>
                                    ${a?.note ? `<div class="meta" style="margin-top:6px;">原因：${escapeHtml(String(a.note))}</div>` : ''}
                                </div>
                            </details>
                        `).join('')}
                    </div>
                ` : ''}
            `;
            box.innerHTML = html;
        }

        function renderTurnoverReport(data, box) {
            if (!box || !data) return;
            const pct = (n) => { const v = Number(n || 0); return Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : '0.0%'; };
            const fmtInt = (n) => { const v = Number(n || 0); return Number.isFinite(v) ? v.toLocaleString('zh-CN') : '0'; };

            const blue = '#2563eb', green = '#059669', red = '#dc2626', orange = '#ea580c', purple = '#7c3aed', cyan = '#0891b2';

            const titleStore = data.store || '全部门店';
            const ct = data.criticalTalent || {};
            const nh = data.newHire || {};
            const vi = data.voluntaryInvoluntary || {};
            const details = Array.isArray(data.departedDetails) ? data.departedDetails : [];
            const breakdown = Array.isArray(data.storeBreakdown) ? data.storeBreakdown : [];

            const gaugeRing = (label, rate, color, size) => {
                const sz = size || 100;
                const r = sz * 0.38;
                const circ = 2 * Math.PI * r;
                const val = Math.max(0, Math.min(1, Number(rate || 0)));
                const offset = circ * (1 - val);
                return `<div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
                    <svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
                        <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/>
                        <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${color}" stroke-width="8"
                            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
                            stroke-linecap="round" transform="rotate(-90 ${sz/2} ${sz/2})" style="transition:stroke-dashoffset 0.6s;"/>
                        <text x="${sz/2}" y="${sz/2}" text-anchor="middle" dominant-baseline="central"
                            fill="${color}" font-size="14" font-weight="900">${pct(val)}</text>
                    </svg>
                    <div style="font-size:11px; color:rgba(200,215,230,0.75); font-weight:700; text-align:center;">${label}</div>
                </div>`;
            };

            const section = (title, borderColor, content) => `
                <div style="background:rgba(255,255,255,0.04); border-radius:14px; border:1px solid rgba(255,255,255,0.08); padding:16px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,0.15);">
                    <div style="font-weight:900; font-size:14px; color:rgba(226,232,240,0.95); margin-bottom:12px; border-left:3px solid ${borderColor}; padding-left:10px;">${title}</div>
                    ${content}
                </div>`;

            const kv = (label, value, color) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                    <span style="color:rgba(200,215,230,0.75); font-size:13px;">${label}</span>
                    <span style="font-weight:800; font-size:13px; ${color ? 'color:'+color : 'color:rgba(226,232,240,0.95)'}">${value}</span>
                </div>`;

            // Donut chart for voluntary vs involuntary
            const donut = (vol, invol) => {
                const total = vol + invol;
                if (total === 0) return '<div style="text-align:center; color:rgba(200,215,230,0.5); padding:12px;">暂无离职数据</div>';
                const volPct = total > 0 ? vol / total : 0;
                const involPct = total > 0 ? invol / total : 0;
                const sz = 120, r = 42, circ = 2 * Math.PI * r;
                const volLen = circ * volPct;
                const involLen = circ * involPct;
                return `<div style="display:flex; align-items:center; justify-content:center; gap:24px; flex-wrap:wrap;">
                    <svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">
                        <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12"/>
                        <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${orange}" stroke-width="12"
                            stroke-dasharray="${volLen} ${circ - volLen}"
                            stroke-linecap="round" transform="rotate(-90 ${sz/2} ${sz/2})" style="transition:stroke-dasharray 0.6s;"/>
                        <circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${purple}" stroke-width="12"
                            stroke-dasharray="${involLen} ${circ - involLen}"
                            stroke-dashoffset="${-volLen}"
                            stroke-linecap="round" transform="rotate(-90 ${sz/2} ${sz/2})" style="transition:stroke-dasharray 0.6s;"/>
                        <text x="${sz/2}" y="${sz/2}" text-anchor="middle" dominant-baseline="central"
                            fill="rgba(226,232,240,0.95)" font-size="16" font-weight="900">${total}</text>
                        <text x="${sz/2}" y="${sz/2 + 14}" text-anchor="middle" dominant-baseline="central"
                            fill="rgba(200,215,230,0.6)" font-size="10">离职总数</text>
                    </svg>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:12px; height:12px; border-radius:3px; background:${orange};"></div>
                            <div>
                                <div style="font-size:12px; color:rgba(200,215,230,0.75);">主动离职（辞职）</div>
                                <div style="font-size:18px; font-weight:900; color:${orange};">${vol}人 <span style="font-size:12px; font-weight:700;">${pct(volPct)}</span></div>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:12px; height:12px; border-radius:3px; background:${purple};"></div>
                            <div>
                                <div style="font-size:12px; color:rgba(200,215,230,0.75);">被动离职（劝退/裁员）</div>
                                <div style="font-size:18px; font-weight:900; color:${purple};">${invol}人 <span style="font-size:12px; font-weight:700;">${pct(involPct)}</span></div>
                            </div>
                        </div>
                    </div>
                </div>`;
            };

            const html = `
                <!-- Header -->
                <div style="margin-bottom:16px;">
                    <div style="font-size:18px; font-weight:900; color:rgba(226,232,240,0.95);">📊 ${escapeHtml(titleStore)} 员工离职率分析</div>
                    <div style="font-size:12px; color:rgba(200,215,230,0.6); margin-top:4px;">统计月份：${escapeHtml(data.month || '')} · 在册人数 ${fmtInt(data.totalHeadcount)} · 本月离职 ${fmtInt(data.totalDeparted)}</div>
                </div>

                <!-- Overview KPI Cards -->
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:10px; margin-bottom:16px;">
                    <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:4px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:36px; height:36px; border-radius:10px; background:${blue}18; display:flex; align-items:center; justify-content:center; font-size:18px;">👥</div>
                            <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700;">在册人数</div>
                        </div>
                        <div style="font-size:20px; font-weight:900; color:${blue}; margin-top:4px;">${fmtInt(data.totalHeadcount)}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:4px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:36px; height:36px; border-radius:10px; background:${red}18; display:flex; align-items:center; justify-content:center; font-size:18px;">📤</div>
                            <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700;">本月离职</div>
                        </div>
                        <div style="font-size:20px; font-weight:900; color:${red}; margin-top:4px;">${fmtInt(data.totalDeparted)}</div>
                    </div>
                    <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:4px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:36px; height:36px; border-radius:10px; background:${orange}18; display:flex; align-items:center; justify-content:center; font-size:18px;">📉</div>
                            <div style="font-size:11px; color:rgba(200,215,230,0.7); font-weight:700;">总离职率</div>
                        </div>
                        <div style="font-size:20px; font-weight:900; color:${orange}; margin-top:4px;">${pct(data.overallTurnoverRate)}</div>
                    </div>
                </div>

                <!-- A. Critical Talent Turnover -->
                ${section('A. 关键人才流失率', red, `
                    <div style="font-size:12px; color:rgba(200,215,230,0.6); margin-bottom:12px;">核心人才：员工档案勾选「核心人才」<b>或</b>职级≥3 / 管理岗位（经理、主管、店长等）</div>
                    <div style="display:flex; justify-content:center; margin-bottom:14px;">
                        ${gaugeRing('关键人才流失率', ct.rate || 0, ct.rate > 0.1 ? red : (ct.rate > 0.05 ? orange : green), 120)}
                    </div>
                    ${kv('核心人才总数', fmtInt(ct.total) + '人', blue)}
                    ${kv('核心人才离职', fmtInt(ct.departed) + '人', ct.departed > 0 ? red : green)}
                    ${kv('流失率', pct(ct.rate), ct.rate > 0.1 ? red : (ct.rate > 0.05 ? orange : green))}
                    <div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:8px; padding:8px; background:rgba(255,255,255,0.03); border-radius:8px;">
                        💡 <b>计算公式：</b>核心人才离职人数 ÷ 本门店核心人才总数 × 100%<br>
                        <span style="color:${green};">● &lt;5% 健康</span> &nbsp;
                        <span style="color:${orange};">● 5%-10% 需关注</span> &nbsp;
                        <span style="color:${red};">● &gt;10% 严重</span>
                    </div>
                `)}

                <!-- B. New Hire Retention -->
                ${section('B. 新人留存率（入职3个月内）', blue, `
                    <div style="font-size:12px; color:rgba(200,215,230,0.6); margin-bottom:12px;">新人定义：入职3个月内的员工</div>
                    <div style="display:flex; justify-content:center; margin-bottom:14px;">
                        ${gaugeRing('新人留存率', nh.retentionRate || 0, nh.retentionRate >= 0.8 ? green : (nh.retentionRate >= 0.6 ? orange : red), 120)}
                    </div>
                    ${kv('新人总数', fmtInt(nh.total) + '人', blue)}
                    ${kv('新人离职', fmtInt(nh.departed) + '人', nh.departed > 0 ? red : green)}
                    ${kv('新人离职率', pct(nh.turnoverRate), nh.turnoverRate > 0.2 ? red : (nh.turnoverRate > 0.1 ? orange : green))}
                    ${kv('新人留存率', pct(nh.retentionRate), nh.retentionRate >= 0.8 ? green : (nh.retentionRate >= 0.6 ? orange : red))}
                    <div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:8px; padding:8px; background:rgba(255,255,255,0.03); border-radius:8px;">
                        💡 <b>计算公式：</b>新人离职人数 ÷ 本门店新人总数 × 100%<br>
                        <span style="color:${green};">● 留存率≥80% 优秀</span> &nbsp;
                        <span style="color:${orange};">● 60%-80% 需改善</span> &nbsp;
                        <span style="color:${red};">● &lt;60% 严重</span>
                    </div>
                `)}

                <!-- C. Voluntary vs Involuntary -->
                ${section('C. 主动 vs 被动离职率', orange, `
                    <div style="font-size:12px; color:rgba(200,215,230,0.6); margin-bottom:12px;">
                        主动离职：员工辞职（反映薪酬、氛围、发展问题）<br>
                        被动离职：劝退、裁员（反映招聘失误或业务调整）
                    </div>
                    ${donut(vi.voluntary || 0, vi.involuntary || 0)}
                    <div style="margin-top:12px;">
                        ${kv('主动离职率', pct(vi.voluntaryRate), orange)}
                        ${kv('被动离职率', pct(vi.involuntaryRate), purple)}
                    </div>
                    <div style="font-size:11px; color:rgba(200,215,230,0.5); margin-top:8px; padding:8px; background:rgba(255,255,255,0.03); border-radius:8px;">
                        💡 <b>计算公式：</b>主动/被动离职人数 ÷ 本月离职总人数 × 100%
                    </div>
                `)}

                <!-- Departed Details Table -->
                ${details.length > 0 ? section('离职明细', cyan, `
                    <div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
                        <table style="width:100%; border-collapse:collapse; font-size:12px;">
                            <thead>
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                                    <th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">姓名</th>
                                    <th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">门店</th>
                                    <th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">岗位</th>
                                    <th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">入职日期</th>
                                    <th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">离职日期</th>
                                    <th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">原因</th>
                                    <th style="padding:8px 6px; text-align:center; color:rgba(200,215,230,0.7); font-weight:700;">类型</th>
                                    <th style="padding:8px 6px; text-align:center; color:rgba(200,215,230,0.7); font-weight:700;">标签</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${details.map(d => {
                                    const typeColor = d.departureType === 'voluntary' ? orange : purple;
                                    const typeLabel = d.departureType === 'voluntary' ? '主动' : '被动';
                                    const tags = [];
                                    if (d.isCoreTalent) tags.push('<span style="background:' + red + '22; color:' + red + '; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:700;">核心</span>');
                                    if (d.isNewHire) tags.push('<span style="background:' + blue + '22; color:' + blue + '; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:700;">新人</span>');
                                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                                        '<td style="padding:8px 6px; color:rgba(226,232,240,0.9);">' + escapeHtml(d.name || d.username) + '</td>' +
                                        '<td style="padding:8px 6px; color:rgba(200,215,230,0.7);">' + escapeHtml(d.store) + '</td>' +
                                        '<td style="padding:8px 6px; color:rgba(200,215,230,0.7);">' + escapeHtml(d.position) + '</td>' +
                                        '<td style="padding:8px 6px; color:rgba(200,215,230,0.7);">' + escapeHtml(d.joinDate) + '</td>' +
                                        '<td style="padding:8px 6px; color:rgba(200,215,230,0.7);">' + escapeHtml(d.departureDate) + '</td>' +
                                        '<td style="padding:8px 6px; color:rgba(200,215,230,0.7);">' + escapeHtml(d.reason) + '</td>' +
                                        '<td style="padding:8px 6px; text-align:center;"><span style="color:' + typeColor + '; font-weight:800;">' + typeLabel + '</span></td>' +
                                        '<td style="padding:8px 6px; text-align:center;">' + (tags.length ? tags.join(' ') : '-') + '</td>' +
                                    '</tr>';
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `) : ''}

                <!-- Store Breakdown -->
                ${breakdown.length > 1 ? section('门店对比', green, `
                    <div style="overflow-x:auto;">
                        <table style="width:100%; border-collapse:collapse; font-size:12px;">
                            <thead>
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                                    <th style="padding:8px 6px; text-align:left; color:rgba(200,215,230,0.7); font-weight:700;">门店</th>
                                    <th style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.7); font-weight:700;">在册</th>
                                    <th style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.7); font-weight:700;">离职</th>
                                    <th style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.7); font-weight:700;">离职率</th>
                                    <th style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.7); font-weight:700;">核心流失</th>
                                    <th style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.7); font-weight:700;">新人留存</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${breakdown.map(s => {
                                    const trColor = s.turnoverRate > 0.15 ? red : (s.turnoverRate > 0.08 ? orange : green);
                                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                                        '<td style="padding:8px 6px; font-weight:800; color:rgba(226,232,240,0.9);">' + escapeHtml(s.store) + '</td>' +
                                        '<td style="padding:8px 6px; text-align:right; color:rgba(200,215,230,0.7);">' + s.headcount + '</td>' +
                                        '<td style="padding:8px 6px; text-align:right; color:' + (s.departed > 0 ? red : green) + '; font-weight:800;">' + s.departed + '</td>' +
                                        '<td style="padding:8px 6px; text-align:right; color:' + trColor + '; font-weight:800;">' + pct(s.turnoverRate) + '</td>' +
                                        '<td style="padding:8px 6px; text-align:right; color:' + (s.criticalRate > 0 ? red : green) + ';">' + s.coreTalentDeparted + '/' + s.coreTalentTotal + ' (' + pct(s.criticalRate) + ')</td>' +
                                        '<td style="padding:8px 6px; text-align:right; color:' + (s.newHireRetention >= 0.8 ? green : (s.newHireRetention >= 0.6 ? orange : red)) + ';">' + pct(s.newHireRetention) + '</td>' +
                                    '</tr>';
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `) : ''}

                ${!data.totalDeparted && !details.length ? '<div style="text-align:center; padding:40px 20px; color:rgba(200,215,230,0.5);"><div style="font-size:48px; margin-bottom:12px;">🎉</div><div style="font-size:14px; font-weight:700;">本月暂无离职记录</div><div style="font-size:12px; margin-top:4px;">团队稳定，继续保持！</div></div>' : ''}
            `;
            box.innerHTML = html;
        }

        function exportCurrentReportCsv() {
            try {
                const tab = String(window.__REP_TAB || __REP_TAB || 'business').trim() || 'business';
                const now = new Date();
                const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
                if (tab === 'business') {
                    const st = window.__REP_LAST_BUSINESS || {};
                    const rows = Array.isArray(st?.rows) ? st.rows : [];
                    const total = st?.total || null;
                    const be = Array.isArray(st?.budgetExecution) ? st.budgetExecution : [];
                    const pctV = (n) => (Number(n||0)*100).toFixed(2)+'%';
                    const pctRV = (a,b) => b > 0 ? pctV(a/b) : '0.00%';
                    const fmtN = (n) => Number(n||0).toFixed(2);
                    const header = ['门店','天数','目标','折前','实收','折扣','平均折扣率','堂食营收','堂食订单','堂食客流','桌均','人均','午市','下午茶','晚市','水吧金额','水吧人数','汤档金额','汤档人数','烧味金额','烧味人数','炒锅金额','炒锅人数','饿了么订单','饿了么折收','饿了么实收','饿了么目标','美团订单','美团折收','美团实收','美团目标','差评-大众点评','差评-美团','差评-饿了么','企微新增会员','充值笔数','充值金额','用工','达成率','人效'];
                    const mapRow = (r) => [r?.store||'', r?.days||0, r?.budget||0, r?.gross||0, r?.actual||0, r?.discount||0, pctRV(r?.discount,r?.gross), r?.dineRevenue||0, r?.dineOrders||0, r?.dineTraffic||0, (r?.dineAvgTable||0).toFixed(2), (r?.dineAvgPerson||0).toFixed(2), r?.segNoon||0, r?.segAfternoon||0, r?.segNight||0, r?.catWaterAmt||0, r?.catWaterQty||0, r?.catSoupAmt||0, r?.catSoupQty||0, r?.catRoastAmt||0, r?.catRoastQty||0, r?.catWokAmt||0, r?.catWokQty||0, r?.elemeOrders||0, r?.elemeRevenue||0, r?.elemeActual||0, r?.elemeTarget||0, r?.meituanOrders||0, r?.meituanRevenue||0, r?.meituanActual||0, r?.meituanTarget||0, r?.badDianping||0, r?.badMeituan||0, r?.badEleme||0, r?.newWechatMembers||0, r?.rechargeCount||0, r?.rechargeAmount||0, r?.laborTotal||0, pctV(r?.budgetRate), r?.efficiency||0];
                    const body = rows.map(mapRow);
                    if (total) body.push(mapRow(total));
                    const allRows = [header].concat(body);
                    // append budget execution section
                    if (be.length > 0) {
                        allRows.push([]);
                        allRows.push(['预算执行情况']);
                        allRows.push(['分类','预算','已用','剩余','执行率']);
                        be.forEach(b => {
                            allRows.push([b.category||'', fmtN(b.budget), fmtN(b.used), fmtN(b.remaining), pctV(b.rate)]);
                        });
                        const tBudget = be.reduce((s,b) => s + Number(b.budget||0), 0);
                        const tUsed = be.reduce((s,b) => s + Number(b.used||0), 0);
                        allRows.push(['合计', fmtN(tBudget), fmtN(tUsed), fmtN(tBudget - tUsed), tBudget > 0 ? pctV(tUsed/tBudget) : '0.00%']);
                    }
                    const csv = allRows.map(arr => arr.map(x => {
                        const s = String(x == null ? '' : x);
                        const safe = s.includes(',') || s.includes('"') || s.includes('\n') ? ('"' + s.replaceAll('"', '""') + '"') : s;
                        return safe;
                    }).join(',')).join('\n');
                    hrmsDownloadText(`业务分析_${stamp}.csv`, csv);
                    showNotification('已下载 CSV', 'success');
                    return;
                }
                if (tab === 'attendance') {
                    const st = window.__REP_LAST_ATT || {};
                    const rows = Array.isArray(st?.rows) ? st.rows : [];
                    const header = ['日期', '门店', '员工', '出勤'];
                    const body = rows.map(r => [r?.date || '', r?.store || '', r?.name || r?.username || '', r?.days || 0]);
                    const csv = [header].concat(body).map(arr => arr.map(x => {
                        const s = String(x == null ? '' : x);
                        const safe = s.includes(',') || s.includes('"') || s.includes('\n') ? ('"' + s.replaceAll('"', '""') + '"') : s;
                        return safe;
                    }).join(',')).join('\n');
                    hrmsDownloadText(`考勤表_${stamp}.csv`, csv);
                    showNotification('已下载 CSV', 'success');
                    return;
                }
                if (tab === 'payroll') {
                    const last = window.__REP_PAYROLL_LAST || {};
                    const month = String(last?.month || document.getElementById('rep-month')?.value || '').trim();
                    const store = String(document.getElementById('rep-store')?.value || '').trim();
                    HRMS_API.getPayrollReport({ store, month })
                        .then(resp => {
                            const rows = Array.isArray(resp?.rows) ? resp.rows : [];
                            const header = ['门店', '员工', '出勤', '月薪', '日薪', '基础应发', '奖惩调整', '补贴', '应发'];
                            const body = rows.map(r => [r?.store || '', r?.name || r?.username || '', r?.attendanceDays || 0, r?.monthlySalary || 0, r?.dailyRate || 0, r?.baseAmount || 0, r?.rewardPunishmentAdj || 0, r?.subsidy || 0, r?.amount || 0]);
                            const csv = [header].concat(body).map(arr => arr.map(x => {
                                const s = String(x == null ? '' : x);
                                const safe = s.includes(',') || s.includes('"') || s.includes('\n') ? ('"' + s.replaceAll('"', '""') + '"') : s;
                                return safe;
                            }).join(',')).join('\n');
                            hrmsDownloadText(`薪资表_${month || stamp}.csv`, csv);
                            showNotification('已下载 CSV', 'success');
                        })
                        .catch(e => showNotification('下载失败：' + String(e?.message || e), 'error'));
                    return;
                }
                showNotification('暂无可下载内容', 'warning');
            } catch (e) {
                showNotification('下载失败：' + String(e?.message || e), 'error');
            }
        }

        function __repPdfOpen(bodyHtml, css) {
            // Use a full-screen overlay instead of window.open to avoid mobile navigation issues
            let overlay = document.getElementById('rep-pdf-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'rep-pdf-overlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:#fff;overflow-y:auto;display:none;';
                document.body.appendChild(overlay);
            }
            overlay.innerHTML = `
                <div style="position:sticky;top:0;z-index:10;background:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;">
                    <button onclick="document.getElementById('rep-pdf-overlay').style.display='none';" style="padding:8px 16px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;font-size:14px;font-weight:700;cursor:pointer;">← 返回</button>
                    <button data-click="print" style="padding:8px 16px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">🖨 打印/PDF</button>
                </div>
                <style>@media print{#rep-pdf-overlay>div:first-child{display:none!important;}}</style>
                <div style="max-width:820px;margin:0 auto;padding:16px;">
                    <style>${css}</style>
                    ${bodyHtml}
                    <div style="margin-top:14px;color:#64748b;font-size:12px;">提示：点击"打印/PDF"按钮，在打印对话框中选择"另存为 PDF"。</div>
                </div>
            `;
            overlay.style.display = 'block';
            overlay.scrollTop = 0;
        }

        function exportCurrentReportPdf() {
            try {
                const tab = String(window.__REP_TAB || __REP_TAB || 'business').trim() || 'business';
                const store = String(document.getElementById('rep-store')?.value || '').trim();
                const start = String(document.getElementById('rep-start')?.value || '').trim();
                const end = String(document.getElementById('rep-end')?.value || '').trim();
                const month = String(document.getElementById('rep-month')?.value || '').trim();

                const css = `
                    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial; color:#0f172a;}
                    .sec{border:1px solid rgba(15,23,42,0.08); border-radius:12px; padding:14px; margin-bottom:10px;}
                    .sec-title{font-weight:900; font-size:14px; margin-bottom:10px; border-left:3px solid #2563eb; padding-left:8px;}
                    .row{display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.06); font-size:12px;}
                    .row .lbl{color:#64748b;} .row .val{font-weight:800;}
                    .big{font-size:20px; font-weight:900; margin:4px 0;}
                    table{width:100%; border-collapse:collapse; font-size:11px;}
                    th{background:#f1f5f9; text-align:left; padding:8px 6px; border-bottom:1px solid rgba(15,23,42,0.12);}
                    td{padding:8px 6px; border-top:1px solid rgba(15,23,42,0.06);}
                    .right{text-align:right;}
                    @media print{@page{size:A4;margin:12mm;}}
                `;

                const esc = (s) => escapeHtml(String(s == null ? '' : s));
                const fmt2 = (n) => {
                    const v = Number(n || 0);
                    return Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
                };
                const fmtI = (n) => { const v = Number(n||0); return Number.isFinite(v) ? v.toLocaleString('zh-CN') : '0'; };
                const pct = (n) => { const v = Number(n||0); return Number.isFinite(v) ? (v*100).toFixed(2)+'%' : '0.00%'; };
                const pctR = (a,b) => b > 0 ? pct(a/b) : '0.00%';
                const kvRow = (l,v) => `<div class="row"><span class="lbl">${l}</span><span class="val">${v}</span></div>`;

                let body = '';

                if (tab === 'business') {
                    const d = window.__REP_LAST_BUSINESS || {};
                    const rows = Array.isArray(d?.rows) ? d.rows : [];
                    const total = d?.total || null;
                    const s = (store && rows.length) ? (rows.find(x => String(x?.store||'').trim() === String(store).trim()) || total || rows[0]) : (total || rows[0] || {});
                    const days = Number(s?.days||0);
                    const dailyActual = days > 0 ? Number(s?.actual||0)/days : 0;
                    const catTotal = Number(s?.catWaterAmt||0)+Number(s?.catSoupAmt||0)+Number(s?.catRoastAmt||0)+Number(s?.catWokAmt||0);
                    const segTotal = Number(s?.segNoon||0)+Number(s?.segAfternoon||0)+Number(s?.segNight||0);
                    const badTotal = Number(s?.badDianping||0)+Number(s?.badMeituan||0)+Number(s?.badEleme||0);

                    body = `
                        <div style="font-size:18px;font-weight:900;margin-bottom:4px;">业务分析表 ${esc(store||'')}</div>
                        <div style="color:#64748b;font-size:12px;margin-bottom:14px;">统计周期：${esc(start)} 至 ${esc(end)}（共${days}天）</div>

                        <div class="sec">
                            <div class="sec-title">目标进度</div>
                            ${kvRow('实际营业额','¥'+fmt2(s?.actual))}
                            ${kvRow('月度目标','¥'+fmt2(s?.budget))}
                            ${kvRow('达成率',pct(s?.budgetRate))}
                            ${kvRow('人效','¥'+fmt2(s?.efficiency))}
                            ${kvRow('统计天数',days+'天')}
                        </div>

                        <div class="sec">
                            <div class="sec-title">统计周期</div>
                            ${kvRow('累计实收','¥'+fmt2(s?.actual))}
                            ${kvRow('日均实收','¥'+fmt2(dailyActual))}
                            ${kvRow('累计折扣','¥'+fmt2(s?.discount))}
                            ${kvRow('平均折扣率',pctR(s?.discount,s?.gross))}
                        </div>

                        <div class="sec">
                            <div class="sec-title">堂食达成数据</div>
                            ${kvRow('堂食客流',fmtI(s?.dineTraffic)+'人')}
                            ${kvRow('堂食订单',fmtI(s?.dineOrders)+'单')}
                            ${kvRow('桌均','¥'+fmt2(s?.dineAvgTable))}
                            ${kvRow('人均','¥'+fmt2(s?.dineAvgPerson))}
                        </div>

                        <div class="sec">
                            <div class="sec-title">档口人均产值</div>
                            ${['水吧','汤档','烧味','炒锅'].map((n,i) => {
                                const keys = [['catWaterAmt','catWaterQty'],['catSoupAmt','catSoupQty'],['catRoastAmt','catRoastQty'],['catWokAmt','catWokQty']];
                                const amt = Number(s?.[keys[i][0]]||0), qty = Number(s?.[keys[i][1]]||0);
                                const pc = qty > 0 ? (amt/qty) : 0;
                                return kvRow(n+' (¥'+fmt2(amt)+', '+fmtI(qty)+'人)','¥'+fmtI(pc));
                            }).join('')}
                        </div>

                        <div class="sec">
                            <div class="sec-title">时段营业额</div>
                            ${kvRow('午市','¥'+fmt2(s?.segNoon)+' ('+pctR(s?.segNoon,s?.gross)+')')}
                            ${kvRow('下午茶','¥'+fmt2(s?.segAfternoon)+' ('+pctR(s?.segAfternoon,s?.gross)+')')}
                            ${kvRow('晚市','¥'+fmt2(s?.segNight)+' ('+pctR(s?.segNight,s?.gross)+')')}
                            ${kvRow('合计','¥'+fmt2(segTotal))}
                        </div>

                        <div class="sec">
                            <div class="sec-title">品类销售占比</div>
                            ${['水吧','汤档','烧味','炒锅'].map((n,i) => {
                                const keys = [['catWaterAmt','catWaterQty'],['catSoupAmt','catSoupQty'],['catRoastAmt','catRoastQty'],['catWokAmt','catWokQty']];
                                const amt = Number(s?.[keys[i][0]]||0);
                                return kvRow(n,'¥'+fmt2(amt)+' ('+pctR(amt,catTotal)+')');
                            }).join('')}
                        </div>

                        <div class="sec">
                            <div class="sec-title">外卖数据</div>
                            <div style="font-weight:800;font-size:12px;margin-bottom:6px;">饿了么</div>
                            ${kvRow('订单数',fmtI(s?.elemeOrders)+'单')}
                            ${kvRow('折收金额','¥'+fmt2(s?.elemeRevenue))}
                            ${kvRow('实收金额','¥'+fmt2(s?.elemeActual))}
                            ${kvRow('实收率',pctR(s?.elemeActual,s?.elemeRevenue))}
                            ${kvRow('目标达成率',pctR(s?.elemeRevenue,s?.elemeTarget))}
                            <div style="height:8px;"></div>
                            <div style="font-weight:800;font-size:12px;margin-bottom:6px;">美团外卖</div>
                            ${kvRow('订单数',fmtI(s?.meituanOrders)+'单')}
                            ${kvRow('折收金额','¥'+fmt2(s?.meituanRevenue))}
                            ${kvRow('实收金额','¥'+fmt2(s?.meituanActual))}
                            ${kvRow('实收率',pctR(s?.meituanActual,s?.meituanRevenue))}
                            ${kvRow('目标达成率',pctR(s?.meituanRevenue,s?.meituanTarget))}
                        </div>

                        <div class="sec">
                            <div class="sec-title">差评统计</div>
                            ${kvRow('总差评数',fmtI(badTotal)+'条')}
                            ${kvRow('大众点评',fmtI(s?.badDianping)+'条')}
                            ${kvRow('美团外卖',fmtI(s?.badMeituan)+'条')}
                            ${kvRow('饿了么外卖',fmtI(s?.badEleme)+'条')}
                            ${kvRow('今日企微会员新增',fmtI(s?.newWechatMembers)+'人')}
                        </div>

                        <div class="sec">
                            <div class="sec-title">充值统计</div>
                            ${kvRow('累计充值金额','¥'+fmt2(s?.rechargeAmount))}
                            ${kvRow('充值笔数',fmtI(s?.rechargeCount)+'笔')}
                        </div>

                        ${(() => {
                            const be = Array.isArray(d?.budgetExecution) ? d.budgetExecution : [];
                            if (be.length === 0) return '';
                            const tB = be.reduce((s,b) => s + Number(b.budget||0), 0);
                            const tU = be.reduce((s,b) => s + Number(b.used||0), 0);
                            const tR = tB - tU;
                            const tRate = tB > 0 ? (tU / tB) : 0;
                            return '<div class="sec">' +
                                '<div class="sec-title">预算执行情况</div>' +
                                kvRow('总预算','¥'+fmt2(tB)) +
                                kvRow('已使用','¥'+fmt2(tU)) +
                                kvRow('剩余预算','¥'+fmt2(tR)) +
                                kvRow('总执行率',pct(tRate)) +
                                '<div style="height:10px;"></div>' +
                                be.map(b => {
                                    const rateVal = Number(b.rate||0);
                                    return kvRow(esc(b.category||'')+'<span style="font-size:10px;color:#64748b;"> (预算¥'+fmt2(b.budget)+' / 已用¥'+fmt2(b.used)+' / 剩余¥'+fmt2(b.remaining)+')</span>', pct(rateVal));
                                }).join('') +
                                '<div style="font-size:10px;color:#94a3b8;margin-top:6px;">只统计已审批和已付款的请款单</div>' +
                            '</div>';
                        })()}
                    `;
                }

                if (tab === 'attendance') {
                    const st = window.__REP_LAST_ATT || {};
                    const rows = Array.isArray(st?.rows) ? st.rows : [];
                    const attUniqueNames = new Set(rows.map(r => String(r?.name || r?.username || '').trim()).filter(Boolean));
                    const attTotalDays = rows.reduce((s, r) => s + Number(r?.days || 0), 0);
                    body = `
                        <div style="font-size:18px;font-weight:900;">考勤表 ${esc(store || '')}</div>
                        <div style="color:#64748b;font-size:12px;margin-bottom:14px;">统计周期：${esc(start)} - ${esc(end)} · 员工 ${attUniqueNames.size} 人 · 出勤 ${attTotalDays.toFixed(1)} 天</div>
                        <div class="sec">
                            <table>
                                <thead><tr><th>日期</th><th>门店</th><th>员工</th><th class="right">出勤</th></tr></thead>
                                <tbody>
                                    ${rows.map(r => `<tr><td>${esc(r?.date||'')}</td><td>${esc(r?.store||'')}</td><td>${esc(r?.name||r?.username||'')}</td><td class="right">${esc(r?.days||0)}</td></tr>`).join('')}
                                    <tr><td style="font-weight:900;">合计</td><td style="font-weight:900;">${attUniqueNames.size} 人</td><td></td><td class="right" style="font-weight:900;">${attTotalDays.toFixed(1)}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    `;
                }

                if (tab === 'payroll') {
                    HRMS_API.getPayrollReport({ store, month })
                        .then(resp => {
                            const rows = Array.isArray(resp?.rows) ? resp.rows : [];
                            const audit = resp?.audit || null;
                            const audited = !!audit?.audited;
                            const fmt = (n) => { if(n==null)return'-'; const v=Number(n||0); return Number.isFinite(v)?v.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'-'; };
                            const pTotalAmt = rows.reduce((s, r) => s + (Number(r?.amount) || 0), 0);
                            const pTotalAtt = rows.reduce((s, r) => s + (Number(r?.attendanceDays) || 0), 0);
                            const payBody = `
                                <div style="font-size:18px;font-weight:900;">薪资表 ${esc(store || '')}</div>
                                <div style="color:#64748b;font-size:12px;margin-bottom:14px;">月份：${esc(month)} · 状态：${audited?'已审核':'未审核'} · 员工 ${rows.length} 人 · 应发总额 ¥${fmt(pTotalAmt)}</div>
                                <div class="sec">
                                    <table>
                                        <thead><tr><th>门店</th><th>员工</th><th class="right">出勤</th><th class="right">月薪</th><th class="right">日薪</th><th class="right">应发</th></tr></thead>
                                        <tbody>
                                            ${rows.map(r => `<tr><td>${esc(r?.store||'')}</td><td>${esc(r?.name||r?.username||'')}</td><td class="right">${esc(r?.attendanceDays||0)}</td><td class="right">${esc(fmt(r?.monthlySalary))}</td><td class="right">${esc(fmt(r?.dailyRate))}</td><td class="right" style="font-weight:900;">${esc(fmt(r?.amount))}</td></tr>`).join('')}
                                            <tr><td style="font-weight:900;">合计</td><td style="font-weight:900;">${rows.length} 人</td><td class="right" style="font-weight:900;">${pTotalAtt.toFixed(1)}</td><td></td><td></td><td class="right" style="font-weight:900;">¥${fmt(pTotalAmt)}</td></tr>
                                        </tbody>
                                    </table>
                                </div>
                            `;
                            __repPdfOpen(payBody, css);
                        })
                        .catch(e => showNotification('导出失败：' + String(e?.message || e), 'error'));
                    return;
                }

                __repPdfOpen(body, css);
            } catch (e) {
                showNotification('导出失败：' + String(e?.message || e), 'error');
            }
        }

        function togglePayrollAudit() {
            try {
                const st = window.__REP_PAYROLL_LAST || {};
                const month = String(st?.month || document.getElementById('rep-month')?.value || '').trim();
                const store = String(document.getElementById('rep-store')?.value || '').trim();
                const audited = !!st?.audited;
                if (!month) {
                    showNotification('请选择月份', 'warning');
                    return;
                }
                HRMS_API.setPayrollAudit({ month, store, audited: !audited })
                    .then(() => {
                        showNotification('已更新审核状态', 'success');
                        showReportsTab('payroll');
                        loadReportsData();
                    })
                    .catch(e => {
                        showNotification('更新失败：' + String(e?.message || e), 'error');
                    });
            } catch (e) {
                showNotification('更新失败：' + String(e?.message || e), 'error');
            }
        }

        function editPayrollSubsidy(username, store, currentSubsidy) {
            try {
                if (!(hrmsPayrollPermAllowed('reports.payroll.adjust', currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HR_MANAGER)))) {
                    showNotification('仅管理员或总部人事可修改', 'warning');
                    return;
                }
                const st = window.__REP_PAYROLL_LAST || {};
                const month = String(st?.month || document.getElementById('rep-month')?.value || '').trim();
                if (!month) {
                    showNotification('请选择月份', 'warning');
                    return;
                }
                const seed = Number(currentSubsidy || 0);
                const raw = prompt(`请输入 ${username} 的补贴金额（元）`, String(Number.isFinite(seed) ? seed : 0));
                if (raw === null) return;
                const subsidy = Number(raw);
                if (!Number.isFinite(subsidy)) {
                    showNotification('请输入有效数字', 'warning');
                    return;
                }
                HRMS_API.setPayrollAdjustment({ month, store, username, subsidy })
                    .then(() => {
                        showNotification('补贴已更新', 'success');
                        loadReportsData();
                    })
                    .catch(e => {
                        showNotification('更新失败：' + String(e?.message || e), 'error');
                    });
            } catch (e) {
                showNotification('更新失败：' + String(e?.message || e), 'error');
            }
        }

        function editPayrollBaseAmount(username, store, currentBaseAmount) {
            try {
                if (!(hrmsPayrollPermAllowed('reports.payroll.adjust', currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HR_MANAGER)))) {
                    showNotification('仅管理员或总部人事可修改', 'warning');
                    return;
                }
                const st = window.__REP_PAYROLL_LAST || {};
                const month = String(st?.month || document.getElementById('rep-month')?.value || '').trim();
                if (!month) {
                    showNotification('请选择月份', 'warning');
                    return;
                }
                const seed = Number(currentBaseAmount || 0);
                const raw = prompt(`请输入 ${username} 的基础应发金额（元）`, String(Number.isFinite(seed) ? seed : 0));
                if (raw === null) return;
                const baseAmount = Number(raw);
                if (!Number.isFinite(baseAmount)) {
                    showNotification('请输入有效数字', 'warning');
                    return;
                }
                HRMS_API.setPayrollAdjustment({ month, store, username, baseAmount })
                    .then(() => {
                        showNotification('基础应发已更新', 'success');
                        loadReportsData();
                    })
                    .catch(e => {
                        showNotification('更新失败：' + String(e?.message || e), 'error');
                    });
            } catch (e) {
                showNotification('更新失败：' + String(e?.message || e), 'error');
            }
        }

        function buildDailyReportPrintHtml(payload) {
            const esc = (s) => escapeHtml(String(s ?? ''));
            const p = payload && typeof payload === 'object' ? payload : {};
            const store = esc(p.store || '');
            const date = esc(p.date || '');
            const d = p.data && typeof p.data === 'object' ? p.data : {};
            const tr = (k, v) =>
                `<tr><th style="text-align:left;padding:7px 10px;border:1px solid #e5e7eb;background:#f8fafc;width:30%;font-size:12px;">${k}</th><td style="padding:7px 10px;border:1px solid #e5e7eb;font-size:12px;">${v}</td></tr>`;
            const tblOpen = '<table style="width:100%;border-collapse:collapse;margin:0 0 14px;">';
            const tblClose = '</table>';
            const sec = (title, inner) => `<h2 style="font-size:15px;margin:18px 0 8px;border-bottom:2px solid #111827;padding-bottom:4px;">${title}</h2>${inner}`;
            const fmtM = (n) => esc(drFmtMoney(n));
            const fmtN = (n) => {
                const v = Number(n || 0);
                return esc(Number.isFinite(v) ? String(v) : '0');
            };
            const staffLine = (list) => {
                const arr = Array.isArray(list) ? list : [];
                const t = arr
                    .map((x) => {
                        const nm = String(x?.name || x?.username || '').trim() || '—';
                        const days = Number(x?.days || 0);
                        const suf =
                            Number.isFinite(days) && days > 0 && days !== 1 ? `（${days} 人天）` : '';
                        return esc(nm) + suf;
                    })
                    .filter(Boolean)
                    .join('、');
                return t || '—';
            };
            const st = d.staff && typeof d.staff === 'object' ? d.staff : {};
            const seg = d.segments && typeof d.segments === 'object' ? d.segments : {};
            const dine = d.dine && typeof d.dine === 'object' ? d.dine : {};
            const disc = d.discount && typeof d.discount === 'object' ? d.discount : {};
            const cat = d.categories && typeof d.categories === 'object' ? d.categories : {};
            const del = d.delivery && typeof d.delivery === 'object' ? d.delivery : {};
            const ele = del.eleme && typeof del.eleme === 'object' ? del.eleme : {};
            const mt = del.meituan && typeof del.meituan === 'object' ? del.meituan : {};
            const bad = d.badReviews && typeof d.badReviews === 'object' ? d.badReviews : {};
            const rech = d.recharge && typeof d.recharge === 'object' ? d.recharge : {};
            const sch = d.scheduleNextDay && typeof d.scheduleNextDay === 'object' ? d.scheduleNextDay : {};
            const photos = Array.isArray(d.photos) ? d.photos : [];

            let body = '';
            body += sec(
                '基础与营收',
                `${tblOpen}
                ${tr('门店', store)}
                ${tr('日期', date)}
                ${tr('天气', esc(d.weather || ''))}
                ${tr('节假日开关', d.holiday_switch || d.holidaySwitch ? '是' : '否')}
                ${tr('预算（折前）', fmtM(d.budget))}
                ${tr('今日折前营业额', fmtM(d.gross))}
                ${tr('今日实收营业额', fmtM(d.actual))}
                ${tr('预算达成（折前/预算）', d.budgetRate != null ? esc(drFmtPct(Number(d.budgetRate))) : '—')}
                ${tr('人力合计（前厅+后厨人天）', fmtN(d.laborTotal))}
                ${tr('人均产出（折前/人力）', d.efficiency != null ? fmtM(d.efficiency) : '—')}
                ${tr('今日营运异常报备', esc((d.operational_anomaly_note || '').trim() || '（无）'))}
                ${tblClose}`
            );

            body += sec(
                '分段与堂食',
                `${tblOpen}
                ${tr('午市', fmtM(seg.noon))}
                ${tr('下午茶', fmtM(seg.afternoon))}
                ${tr('晚市', fmtM(seg.night))}
                ${tr('堂食营业额', fmtM(dine.revenue))}
                ${tr('堂食单数', fmtN(dine.orders))}
                ${tr('堂食客流', fmtN(dine.traffic))}
                ${tr('桌均', fmtM(dine.avgTable))}
                ${tr('人均', fmtM(dine.avgPerson))}
                ${tblClose}`
            );

            body += sec(
                '折扣',
                `${tblOpen}
                ${tr('折扣合计', fmtM(disc.total))}
                ${tr('堂食折扣', fmtM(disc.dine))}
                ${tr('外卖折扣', fmtM(disc.delivery))}
                ${tblClose}`
            );

            const catRows = ['water', 'soup', 'roast', 'wok'].map((key) => {
                const lab = { water: '水吧酒水', soup: '炖汤', roast: '烧味', wok: '炒锅' }[key] || key;
                const o = cat[key] && typeof cat[key] === 'object' ? cat[key] : {};
                return tr(lab + '（额/量）', `${fmtM(o.amt)} / ${fmtN(o.qty)}`);
            });
            body += sec('品类结构', `${tblOpen}${catRows.join('')}${tblClose}`);

            body += sec(
                '外卖平台',
                `${tblOpen}
                ${tr('饿了么（单/流水/实收/目标）', `${fmtN(ele.orders)} / ${fmtM(ele.revenue)} / ${fmtM(ele.actual)} / ${fmtM(ele.targetRevenue)}`)}
                ${tr('美团（单/流水/实收/目标）', `${fmtN(mt.orders)} / ${fmtM(mt.revenue)} / ${fmtM(mt.actual)} / ${fmtM(mt.targetRevenue)}`)}
                ${tblClose}`
            );

            body += sec(
                '口碑',
                `${tblOpen}
                ${tr('点评差评', fmtN(bad.dianping))}
                ${tr('美团差评', fmtN(bad.meituan))}
                ${tr('饿了么差评', fmtN(bad.eleme))}
                ${tblClose}`
            );

            body += sec(
                '充值',
                `${tblOpen}
                ${tr('充值笔数', fmtN(rech.count))}
                ${tr('充值金额', fmtM(rech.amount))}
                ${tblClose}`
            );

            body += sec(
                '人力',
                `${tblOpen}
                ${tr('前厅上班', staffLine(st.front))}
                ${tr('后厨上班', staffLine(st.kitchen))}
                ${tr('休息/支援（前厅）', staffLine(st.restStaff || st.frontRestStaff))}
                ${tr('前厅支援说明', esc(st.frontSupport || ''))}
                ${tr('后厨支援说明', esc(st.kitchenSupport || ''))}
                ${tblClose}`
            );

            body += sec(
                '次日排班与预估',
                `${tblOpen}
                ${tr('次日预估折前', fmtM(sch.tomorrowGrossEstimate))}
                ${tr('排班备注', esc(sch.remark || ''))}
                ${tr('排班人员（合并）', staffLine(sch.staff))}
                ${tr('排班·前厅', staffLine(sch.frontStaff))}
                ${tr('排班·后厨', staffLine(sch.kitchenStaff))}
                ${tblClose}`
            );

            const photoBlock =
                photos.length > 0
                    ? `<ol style="margin:0;padding-left:18px;font-size:11px;word-break:break-all;">${photos
                          .map((u) => `<li style="margin:4px 0;"><a href="${esc(u)}">${esc(u)}</a></li>`)
                          .join('')}</ol>`
                    : '<p style="color:#64748b;font-size:12px;">（无附件图片 URL）</p>';
            body += sec('日结照片 / 附件链接', photoBlock);

            return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>营业日报 ${store} ${date}</title>
<style>
  @media print { @page { size: A4; margin: 12mm; } }
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;padding:16px;color:#111;font-size:13px;line-height:1.45;}
  h1{font-size:20px;margin:0 0 12px;}
  .hint{color:#64748b;font-size:12px;margin-top:16px;}
</style></head><body>
<h1>营业日报</h1>
${body}
<p class="hint">提示：在打印对话框中选择「另存为 PDF」。若某段为「—」表示当前表单该字段为空。</p>
</body></html>`;
        }

        function exportDailyReportPdf() {
            try {
                const store = String(document.getElementById('dr-store')?.value || '').trim();
                const date = String(document.getElementById('dr-date')?.value || '').trim();
                if (!store || !date) {
                    showNotification('请先选择门店与日期', 'warning');
                    return;
                }
                let payload = null;
                try {
                    payload = buildDailyReportPayload();
                } catch (e) {
                    payload = { store, date, data: {} };
                }
                const w = window.open('', '_blank');
                if (!w) {
                    showNotification('请允许弹窗以导出 PDF', 'warning');
                    return;
                }
                const html = buildDailyReportPrintHtml(payload);
                w.document.open();
                w.document.write(html);
                w.document.close();
                w.focus();
                setTimeout(() => {
                    try {
                        w.print();
                    } catch (e2) {
                        /* ignore */
                    }
                }, 450);
            } catch (e) {
                showNotification('导出失败：' + String(e?.message || e), 'error');
            }
        }

        function openMyRewards(type) {
            if (!currentUser) return;
            __REWARDS_FILTER_USER = String(currentUser.username || currentUser.id || '').trim();
            __REWARDS_FILTER_TYPE = String(type || '').trim();
            __REWARDS_FILTER_LOCK = true;
            window.__REWARDS_FILTER_LOCK = true;
            showPage('rewards');
        }
        
