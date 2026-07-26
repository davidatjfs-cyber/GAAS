/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 14-subscription-and-tail.js
 * lines: 39919-44315 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        // ===== 订阅消息规则：前台设置 + 内容管理（与短信同一治理闭环） =====
        // 模板字段说明（与小程序 sendSubscribeMessage 报备模板严格一致）：
        //  received 领取通知：thing1门店名 / thing2券名 / thing3面额 / thing5有效期（其余补占位）
        //  expiring 过期提醒：thing1券名 / thing2到期日 / thing3面额 / thing4提示语 / thing5到期日
        var AM_SUB_FIELDS = {
            received: [
                { id: 'storeName', label: '门店名称', ph: '如 马己仙广东小馆' },
                { id: 'couponName', label: '优惠券名称', ph: '如 满100减20券' },
                { id: 'faceValue', label: '面额', ph: '如 20元' },
                { id: 'validUntil', label: '有效期', ph: '如 2026-12-31' }
            ],
            expiring: [
                { id: 'couponName', label: '优惠券名称', ph: '如 满100减20券' },
                { id: 'expireDate', label: '到期日期', ph: '如 2026-06-30' },
                { id: 'faceValue', label: '面额', ph: '如 20元' },
                { id: 'tip', label: '提示语', ph: '如 优惠券即将过期请尽快使用' }
            ]
        };

        function amRenderSubFields(values) {
            values = values || {};
            var type = document.getElementById('am-sub-type').value === 'expiring' ? 'expiring' : 'received';
            var host = document.getElementById('am-sub-fields');
            host.innerHTML = AM_SUB_FIELDS[type].map(function(f){
                var v = values[f.id] != null ? String(values[f.id]) : '';
                return '<div><label class="am-sub-lbl">' + f.label + '</label>'
                    + '<input class="am-sub-in" data-sub-field="' + f.id + '" placeholder="' + f.ph + '" value="' + escapeHtml(v) + '"></div>';
            }).join('');
        }

        // 把友好字段拼成微信模板 data（thing1-9/time8）。20字截断与小程序侧一致。
        function amBuildSubscribeData(type) {
            function g(id){ var el = document.querySelector('#am-sub-fields [data-sub-field="' + id + '"]'); return el ? String(el.value || '').trim() : ''; }
            function thing(v, fallback){ return { value: (v || fallback || '-').substring(0, 20) }; }
            if (type === 'expiring') {
                var exp = g('expireDate') || '详见小程序';
                return {
                    thing1: thing(g('couponName'), '优惠券'),
                    thing2: thing(exp),
                    thing3: thing(g('faceValue'), '详见小程序'),
                    thing4: thing(g('tip'), '您的优惠券即将过期，请尽快使用'),
                    thing5: thing(exp)
                };
            }
            var vu = g('validUntil') || '详见小程序';
            return {
                thing1: thing(g('storeName'), '本店'),
                thing2: thing(g('couponName'), '优惠券'),
                thing3: thing(g('faceValue'), '详见小程序'),
                thing4: thing(g('faceValue'), '详见小程序'),
                thing5: thing(vu),
                thing6: { value: '-' },
                thing7: { value: '-' },
                time8: { value: (vu || '详见小程序').substring(0, 20) },
                thing9: { value: '-' }
            };
        }

        function amResetSubscribeForm() {
            ['am-sub-key','am-sub-name','am-sub-owner','am-sub-minvisit','am-sub-mindays','am-sub-maxdays','am-sub-page','am-sub-freq'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
            document.getElementById('am-sub-priority').value = '50';
            document.getElementById('am-sub-stage').value = '';
            document.getElementById('am-sub-tier').value = '';
            document.getElementById('am-sub-type').value = 'received';
            amRenderSubFields();
        }

        function amNum(id){ var el=document.getElementById(id); var v=el&&el.value!==''?Number(el.value):null; return (v!=null&&Number.isFinite(v))?v:null; }

        async function amSaveSubscribeRule() {
            var name = String(document.getElementById('am-sub-name').value || '').trim();
            if (!name) { showNotification('请填写规则名称', 'error'); return; }
            // 规则标识为系统内部用，自动生成；编辑时沿用原标识
            var ruleKey = String(document.getElementById('am-sub-key').value || '').trim();
            if (!ruleKey) ruleKey = 'sub_' + Date.now().toString(36);
            var type = document.getElementById('am-sub-type').value === 'expiring' ? 'expiring' : 'received';
            var storeId = document.getElementById('am-sub-store').value || '';
            var criteria = {};
            var stage = document.getElementById('am-sub-stage').value; if (stage) criteria.lifecycle_stage = stage;
            var tier = document.getElementById('am-sub-tier').value; if (tier) criteria.value_tier = tier;
            var minVisit = amNum('am-sub-minvisit'); if (minVisit != null) criteria.min_visit_count = minVisit;
            var minDays = amNum('am-sub-mindays'); if (minDays != null) criteria.min_days_since_last_visit = minDays;
            var maxDays = amNum('am-sub-maxdays'); if (maxDays != null) criteria.max_days_since_last_visit = maxDays;
            if (storeId) criteria.store_id = storeId;
            if (!(criteria.lifecycle_stage || criteria.value_tier || criteria.min_visit_count != null || criteria.min_days_since_last_visit != null || criteria.max_days_since_last_visit != null)) {
                showNotification('请至少设置一个人群条件（生命周期/价值/到店次数/未到店天数），否则规则不会命中任何人', 'error');
                return;
            }
            var freqDays = amNum('am-sub-freq'); freqDays = (freqDays != null && freqDays > 0) ? Math.floor(freqDays) : 0;
            var actionPayload = {
                channel: 'subscribe',
                store_id: storeId,
                frequency_days: freqDays,
                subscribe_template_type: type,
                subscribe_template_data: amBuildSubscribeData(type),
                subscribe_page: String(document.getElementById('am-sub-page').value || '').trim() || undefined,
                content_template: name,
                title_template: name
            };
            var body = {
                rule_key: ruleKey, name: name,
                priority: amNum('am-sub-priority') != null ? amNum('am-sub-priority') : 50,
                auto_execute: true, enabled: true,
                criteria: criteria,
                action_type: 'send_message',
                action_payload: actionPayload,
                owner: String(document.getElementById('am-sub-owner').value || '').trim(),
                note: '订阅消息规则（前台创建）'
            };
            try {
                var r = await fetch('/api/growth/touch-rules', { method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                showNotification('订阅规则已保存（待审核）。请在上方卡片「审核通过」后生效', 'success');
                amResetSubscribeForm();
                loadAutoMarketing();
            } catch (e) { showNotification('保存失败：' + (e && e.message || e), 'error'); }
        }

        // 点击订阅规则卡片「编辑」→ 回填表单（保留 rule_key）
        function amEditSubscribeRule(ruleKey) {
            fetch('/api/growth/touch-rules', { headers: growthAuthHeaders() }).then(function(r){return r.json();}).then(function(rg){
                var rule = ((rg && rg.rules) || []).find(function(x){ return x.rule_key === ruleKey; });
                if (!rule) { showNotification('未找到规则', 'error'); return; }
                var p = rule.action_payload || {};
                var c = rule.criteria || {};
                document.getElementById('am-sub-key').value = rule.rule_key;
                document.getElementById('am-sub-key').setAttribute('readonly', 'readonly');
                document.getElementById('am-sub-name').value = rule.name || '';
                document.getElementById('am-sub-owner').value = rule.owner || '';
                document.getElementById('am-sub-store').value = p.store_id || c.store_id || '51866138';
                document.getElementById('am-sub-type').value = (p.subscribe_template_type === 'expiring') ? 'expiring' : 'received';
                document.getElementById('am-sub-priority').value = rule.priority != null ? rule.priority : 50;
                document.getElementById('am-sub-stage').value = c.lifecycle_stage || '';
                document.getElementById('am-sub-tier').value = c.value_tier || '';
                document.getElementById('am-sub-minvisit').value = c.min_visit_count != null ? c.min_visit_count : '';
                document.getElementById('am-sub-mindays').value = c.min_days_since_last_visit != null ? c.min_days_since_last_visit : '';
                document.getElementById('am-sub-maxdays').value = c.max_days_since_last_visit != null ? c.max_days_since_last_visit : '';
                document.getElementById('am-sub-page').value = p.subscribe_page || '';
                document.getElementById('am-sub-freq').value = (p.frequency_days && Number(p.frequency_days) > 0) ? Number(p.frequency_days) : '';
                // 反解 thing 字段为友好输入
                var td = p.subscribe_template_data || {};
                function tv(k){ return (td[k] && td[k].value) ? td[k].value : ''; }
                var vals = (p.subscribe_template_type === 'expiring')
                    ? { couponName: tv('thing1'), expireDate: tv('thing2'), faceValue: tv('thing3'), tip: tv('thing4') }
                    : { storeName: tv('thing1'), couponName: tv('thing2'), faceValue: tv('thing3'), validUntil: tv('thing5') };
                amRenderSubFields(vals);
                document.getElementById('am-sub-fields').scrollIntoView({ behavior: 'smooth', block: 'center' });
            }).catch(function(e){ showNotification('加载失败：' + (e && e.message || e), 'error'); });
        }

        async function refreshGrowthDashboard() {
            if (!canAccessGrowthModule()) { document.getElementById('growth-page').style.display = 'none'; return; }
            const storeFilter = document.getElementById('growth-store-filter')?.value || '';
            const campaignFilter = document.getElementById('growth-campaign-filter')?.value || '';
            const daysFilter = document.getElementById('growth-days-filter')?.value || '30';
            try {
                var gh = { 'Authorization': 'Bearer ' + (HRMS_API.token() || '') };

                // A链：POS数据
                try {
                    var posUrl = '/api/growth/pos-stats?days=' + daysFilter + '&store_id=' + encodeURIComponent(storeFilter);
                    if (campaignFilter) posUrl += '&campaign_id=' + encodeURIComponent(campaignFilter);
                    var posRes = await fetch(posUrl, { headers: gh });
                    var posData = await posRes.json();
                    renderGrowthPosMetricsCards(posData);
                } catch (e) {
                    document.getElementById('growth-pos-metrics-cards').innerHTML = '<div style="color:rgba(226,232,240,0.4);font-size:12px;">POS数据暂不可用</div>';
                }

                // B链：小程序数据
                var metricsUrl = '/api/growth/metrics?days=' + daysFilter + '&store_id=' + encodeURIComponent(storeFilter);
                if (campaignFilter) metricsUrl += '&campaign_id=' + encodeURIComponent(campaignFilter);
                const metricsRes = await fetch(metricsUrl, { headers: gh });
                const metricsData = await metricsRes.json();
                const metrics = metricsData?.rows || [];
                const alertsRes = await fetch('/api/growth/alerts?status=open', { headers: gh });
                const alertsData = await alertsRes.json();
                const alerts = alertsData?.alerts || [];
                const actionsRes = await fetch('/api/growth/actions', { headers: gh });
                const actionsData = await actionsRes.json();
                const actions = actionsData?.actions || [];

                renderGrowthMetricsCards(metrics);
                renderGrowthFunnel(metrics);

                // 如果选择了具体活动，额外加载该活动的独立漏斗（campaign_id值展示）
                if (campaignFilter) {
                    try {
                        var funnelRes = await fetch('/api/growth/campaigns/' + encodeURIComponent(campaignFilter) + '/funnel', { headers: gh });
                        var funnelData = await funnelRes.json();
                        if (funnelData?.counts) renderCampaignFunnelDetail(campaignFilter, funnelData.counts, metrics);
                    } catch (e) { /* campaign funnel optional */ }
                }

                renderGrowthAlerts(alerts);
                renderGrowthTrends(metrics);
                renderGrowthActions(actions);

                try {
                    var wRes = await fetch('/api/growth/weather-context', { headers: gh });
                    var wData = await wRes.json();
                    renderGrowthWeather(wData);
                } catch (e) { document.getElementById('growth-weather').innerHTML = '<div style="color:rgba(226,232,240,0.4);font-size:12px;">天气数据暂不可用</div>'; }
                try {
                    var awStore = document.getElementById('growth-store-filter')?.value || '';
                    var awRes = await fetch('/api/growth/active-window' + (awStore ? '?store_id=' + encodeURIComponent(awStore) : ''), { headers: gh });
                    var awData = await awRes.json();
                    renderGrowthActiveWindow(awData);
                } catch (e) { document.getElementById('growth-active-window').innerHTML = '<div style="color:rgba(226,232,240,0.4);font-size:12px;">触达时段数据暂不可用</div>'; }
                try {
                    var rpStore = document.getElementById('growth-store-filter')?.value || '';
                    var rpRes = await fetch('/api/growth/customer-profiles?limit=1000' + (rpStore ? '&store_id=' + encodeURIComponent(rpStore) : ''), { headers: gh });
                    var rpData = await rpRes.json();
                    var rpRows = rpData?.profiles || [];
                    var atRisk = rpRows.filter(function(p) { return p.lifecycle_stage === 'at_risk'; });
                    var churned = rpRows.filter(function(p) { return p.lifecycle_stage === 'churned'; });
                    renderGrowthRepurchase(atRisk.length, churned.length, rpStore);
                } catch (e) { document.getElementById('growth-repurchase').innerHTML = '<div style="color:rgba(226,232,240,0.4);font-size:12px;">复购数据暂不可用</div>'; }

                document.querySelectorAll('#growth-page .hidden').forEach(function(e) { e.classList.remove('hidden'); });
            } catch (e) {
                console.error('growth dashboard error:', e);
                document.getElementById('growth-metrics-cards').innerHTML = '<div style="color:red;padding:20px;">加载失败</div>';
            }
        }

        async function loadCampaignFilterOptions() {
            try {
                var gh = { 'Authorization': 'Bearer ' + (HRMS_API.token() || '') };
                var r = await fetch('/api/growth/campaigns', { headers: gh });
                var d = await r.json();
                var campaigns = d?.campaigns || [];
                var sel = document.getElementById('growth-campaign-filter');
                if (!sel) return;
                sel.innerHTML = '<option value="">全部活动</option>';
                var seen = {};
                campaigns.forEach(function(c) {
                    var opt = document.createElement('option');
                    opt.value = c.campaign_id || '';
                    var chLabel = growthChannelLabel(c.channel || '');
                    var storeLabel = growthStoreName(c.store_id || '');
                    var displayName;
                    if (c.name) {
                        displayName = c.name;
                    } else if (c.channel === 'miniprogram' && c.store_id) {
                        displayName = '小程序·' + storeLabel;
                    } else if (c.channel) {
                        displayName = chLabel;
                    } else {
                        displayName = '活动 ' + (c.campaign_id || '').slice(-8);
                    }
                    var key = displayName + '|' + (c.store_id || '');
                    if (seen[key]) return;
                    seen[key] = true;
                    opt.textContent = displayName + (storeLabel && !displayName.includes(storeLabel) ? ' · ' + storeLabel : '');
                    sel.appendChild(opt);
                });
            } catch (e) { /* ignore */ }
        }

         function renderGrowthStoreOptions(stores) {
             var sel = document.getElementById('growth-store-filter');
             if (!sel) return;
             var current = sel.value || '';
             sel.innerHTML = '<option value="">全部门店</option>';
             stores.forEach(function(s) {
                 var sid = s.store_id || '';
                 var sname = s.store_name || __GROWTH_STORE_MAP[sid] || sid;
                 if (!sid || !sname) return;
                 var opt = document.createElement('option');
                 opt.value = sid;
                 opt.textContent = sname;
                 __GROWTH_STORE_MAP[sid] = sname;
                 sel.appendChild(opt);
             });
             if (current && Array.prototype.some.call(sel.options, function(o) { return o.value === current; })) {
                 sel.value = current;
             }
         }

         async function loadGrowthStoreOptions() {
             renderGrowthStoreOptions(Object.keys(__GROWTH_STORE_MAP).map(function(k) {
                 return { store_id: k, store_name: __GROWTH_STORE_MAP[k] };
             }));
             try {
                 var gh = { 'Authorization': 'Bearer ' + (HRMS_API.token() || '') };
                 var r = await fetch('/api/growth/stores', { headers: gh });
                 var d = await r.json();
                 var stores = Array.isArray(d?.stores) ? d.stores : [];
                 if (stores.length > 0) renderGrowthStoreOptions(stores);
             } catch (e) { /* keep local fallback options */ }
         }

        function renderCampaignFunnelDetail(campaignId, counts, dailyMetrics) {
            var detailHost = document.createElement('div');
            detailHost.id = 'growth-campaign-funnel-detail';
            detailHost.style.marginTop = '16px';
            detailHost.style.padding = '16px';
            detailHost.style.background = 'rgba(14,165,233,0.06)';
            detailHost.style.border = '1px solid rgba(14,165,233,0.2)';
            detailHost.style.borderRadius = '12px';

            var countMap = {};
            counts.forEach(function(c) { countMap[c.event_type] = c.count; });
            var steps = [
                { key: 'campaign_scan', label: '扫码', count: countMap['campaign_scan'] || 0, pctBase: countMap['campaign_scan'] || 0 },
                { key: 'phone_authorized', label: '授权', count: countMap['phone_authorized'] || 0, pctBase: countMap['campaign_scan'] || 1 },
                { key: 'coupon_claimed', label: '主动领券', count: countMap['coupon_claimed'] || 0, pctBase: countMap['phone_authorized'] || 1 },
                { key: 'coupon_redeemed', label: '核销', count: countMap['coupon_redeemed'] || 0, pctBase: countMap['coupon_claimed'] || 1 },
                { key: 'payment_success', label: '支付', count: countMap['payment_success'] || 0, pctBase: countMap['coupon_redeemed'] || 1 }
            ];
            var marketingCount = countMap['marketing_triggered'] || 0;
            var marketingNote = marketingCount > 0 ? '<div style="font-size:11px;color:rgba(226,232,240,0.4);margin-top:6px;"> 另：HRMS自动营销发券 ' + marketingCount + ' 次（不计入漏斗）</div>' : '';

            // 从 dailyMetrics 累计收入
            var revenueFen = 0;
            (dailyMetrics || []).forEach(function(m) {
                revenueFen += Number(m.revenue_fen) || 0;
            });

            detailHost.innerHTML = '<div style="font-size:13px;font-weight:700;color:#38bdf8;margin-bottom:10px;">📊 活动漏斗：' + campaignId.slice(0, 40) + '</div>'
                + '<div style="margin-bottom:8px;">' + steps.map(function(s, i) {
                    var pct = s.pctBase > 0 ? Math.round(s.count / s.pctBase * 100) : 0;
                    var barColor = pct < 10 ? '#ef4444' : pct < 30 ? '#f59e0b' : '#22c55e';
                    return '<div style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:rgba(226,232,240,0.78);"><strong style="color:#fff;">' + s.label + '</strong><span>' + s.count + ' · ' + pct + '%</span></div><div style="height:8px;background:rgba(255,255,255,0.07);border-radius:999px;overflow:hidden;"><div style="height:100%;width:' + Math.max(4, Math.min(100, pct)) + '%;background:' + barColor + ';border-radius:999px;"></div></div></div>';
                }).join('') + '</div>'
                + marketingNote
                + '<div style="font-size:12px;color:#22c55e;margin-top:8px;">💰 总收入(events): ¥' + (revenueFen / 100).toFixed(2) + '</div>';

            var existing = document.getElementById('growth-campaign-funnel-detail');
            if (existing) existing.replaceWith(detailHost);
            else {
                var funnelPanel = document.getElementById('growth-funnel')?.parentElement;
                if (funnelPanel) funnelPanel.after(detailHost);
            }
        }

        function renderGrowthPosMetricsCards(posData) {
            var s = posData.summary || {};
            var takeaway = (posData.byOrderType || []).find(function(t) { return t.order_type === '平台外卖'; });
            var dineIn = (posData.byOrderType || []).find(function(t) { return t.order_type === '堂食'; });
            var takeawayOrders = s.delivery_orders != null ? Number(s.delivery_orders || 0) : (takeaway ? takeaway.cnt : 0);
            var takeawayRevenue = s.delivery_revenue != null ? Number(s.delivery_revenue || 0) : (takeaway ? Number(takeaway.revenue) : 0);
            var dineInOrders = dineIn ? dineIn.cnt : 0;
            var dineInRevenue = dineIn ? Number(dineIn.revenue) : 0;
            var avgTableSpend = Number(s.avg_table_spend || 0);
            var allOrders = Number(s.total_orders || 0);
            var allRevenue = Number(s.total_revenue || 0);
            var cards = [
                { label: '总订单', value: allOrders, tag: '订单', source: 'POS系统导入' },
                { label: '堂食桌均', value: (avgTableSpend > 0 ? avgTableSpend.toFixed(2) : (dineInOrders > 0 ? (dineInRevenue / dineInOrders).toFixed(2) : '0.00')), tag: '桌均', source: '堂食折前营业额 / 堂食订单数' },
                { label: '外卖均消', value: (takeawayOrders > 0 ? (takeawayRevenue / takeawayOrders).toFixed(2) : '0.00'), tag: '外卖均消', source: '仅外卖订单' },
                { label: '识别客户', value: s.distinct_phones || 0, tag: '手机号', source: 'POS系统导入' },
                { label: '外卖订单', value: takeawayOrders, tag: '外卖', source: 'POS系统导入' },
                { label: '新客率', value: (posData.profileInsights && posData.profileInsights.new_vs_returning ? posData.profileInsights.new_vs_returning.new_pct : '-') + '%', tag: '新客', source: '统计期内首次消费手机号占比' }
            ];
            document.getElementById('growth-pos-metrics-cards').innerHTML = '<div style="font-size:11px;color:rgba(226,232,240,0.4);margin-bottom:8px;"> 新客率 = 统计期内历史首次消费手机号数 / 总识别手机号数（基于POS订单手机号去重）</div>'
                + cards.map(function(c) {
                return '<div class="rep-metric" style="text-align:center;">'
                    + '<div class="k" style="text-align:center;">' + c.tag + '</div>'
                    + '<div class="v" style="text-align:center;font-size:24px;">' + c.value + '</div>'
                    + '<div style="font-size:11px;color:var(--rep-muted);text-align:center;margin-top:4px;">' + c.label + '</div>'
                    + '</div>';
            }).join('');
        }

        function renderGrowthMetricsCards(metrics) {
            var total = { scan: 0, auth: 0, claimed: 0, purchased: 0, marketing: 0, redeem: 0, payment: 0 };
            metrics.forEach(function(m) {
                total.scan += Number(m.scan_count) || 0;
                total.auth += Number(m.authorized_count) || 0;
                total.claimed += Number(m.coupon_claimed_count) || 0;
                total.purchased += Number(m.coupon_purchased_count) || 0;
                total.marketing += Number(m.marketing_triggered_count) || 0;
                total.redeem += Number(m.coupon_redeemed_count) || 0;
                total.payment += Number(m.payment_count) || 0;
            });
            var cards = [
                { label: '扫码', value: total.scan, tag: '扫码', source: '小程序扫码进店' },
                { label: '授权', value: total.auth, tag: '授权', source: '小程序授权手机号' },
                { label: '主动领券', value: total.claimed, tag: '领券', source: '小程序用户主动领取' },
                { label: '购券', value: total.purchased, tag: '购券', source: '小程序支付后购券' },
                { label: '营销发券', value: total.marketing, tag: '营销', source: 'HRMS自动营销引擎触发' },
                { label: '核销', value: total.redeem, tag: '核销', source: '小程序店员核销' },
                { label: '支付', value: total.payment, tag: '支付', source: '小程序支付订单' }
            ];
            document.getElementById('growth-metrics-cards').innerHTML = cards.map(function(c) {
                return '<div class="rep-metric" style="text-align:center;">'
                    + '<div class="k" style="text-align:center;">' + c.tag + '</div>'
                    + '<div class="v" style="text-align:center;font-size:24px;">' + c.value + '</div>'
                    + '<div style="font-size:11px;color:var(--rep-muted);text-align:center;margin-top:4px;">' + c.label + '</div>'
                    + '<div style="font-size:10px;color:rgba(226,232,240,0.35);text-align:center;margin-top:2px;line-height:1.3;">' + c.source + '</div>'
                    + '</div>';
            }).join('');
        }

        async function loadPosStats() {
            var days = document.getElementById('growth-days-filter')?.value || document.getElementById('pos-stats-days')?.value || '30';
            var posDaysSel = document.getElementById('pos-stats-days');
            if (posDaysSel && posDaysSel.value !== days) posDaysSel.value = days;
            var storeFilter = document.getElementById('growth-store-filter')?.value || '';
            var campaignFilter = document.getElementById('growth-campaign-filter')?.value || '';
            try {
                var loadingEl = document.getElementById('pos-stats-loading');
                if (loadingEl) loadingEl.style.display = 'block';
                var posUrl = '/api/growth/pos-stats?days=' + days + '&store_id=' + encodeURIComponent(storeFilter);
                if (campaignFilter) posUrl += '&campaign_id=' + encodeURIComponent(campaignFilter);
                var r = await fetch(posUrl, { headers: growthAuthHeaders() });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'api_error');
                if (!d.summary) throw new Error('empty_response');

                var s = d.summary;
                var takeaway = (d.byOrderType || []).find(function(t) { return t.order_type === '平台外卖'; });
                var takeawayOrders = s.delivery_orders != null ? Number(s.delivery_orders || 0) : (takeaway ? takeaway.cnt : 0);
                var takeawayRevenue = s.delivery_revenue != null ? Number(s.delivery_revenue || 0) : (takeaway ? Number(takeaway.revenue) : 0);
                var allOrders = Number(s.total_orders || 0);
                var allRevenue = Number(s.total_revenue || 0);
                var avgTableSpend = Number(s.avg_table_spend || 0);
                var kpisEl = document.getElementById('pos-stats-kpis');
                if (kpisEl) kpisEl.innerHTML = [
                    { label: '总订单', value: allOrders, tag: '订单' },
                    { label: '总收入(元)', value: allRevenue.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}), tag: '收入' },
                    { label: '堂食桌均(元)', value: (avgTableSpend > 0 ? avgTableSpend.toFixed(2) : '0.00'), tag: '桌均' },
                    { label: '外卖订单', value: takeawayOrders, tag: '外卖' },
                    { label: '外卖收入', value: '¥' + takeawayRevenue.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0}), tag: '外卖收' },
                    { label: '识别客户', value: s.distinct_phones || 0, tag: '手机号' },
                    { label: '新客率', value: (d.profileInsights && d.profileInsights.new_vs_returning ? d.profileInsights.new_vs_returning.new_pct : '-') + '%', tag: '新客' },
                    { label: '回头率', value: (d.profileInsights && d.profileInsights.new_vs_returning ? d.profileInsights.new_vs_returning.returning_pct : '-') + '%', tag: '复购' }
                ].map(function(c) {
                    return '<div class="growth-metric-card"><div class="metric-tag">' + c.tag + '</div><div class="metric-value" style="font-size:24px;font-weight:800;color:#fff;">' + c.value + '</div><div style="font-size:11px;color:rgba(226,232,240,0.5);">' + c.label + '</div></div>';
                }).join('');

                renderPosHourChart(d.hourDist || []);
                renderPosPayChart(d.payDist || []);
                renderPosTopDishes(d.topDishes || []);
                renderPosStoreTable(d.byStore || []);
                renderPosRepeatStats(d.repeatStats || {});
                renderPosProfileInsights(d.profileInsights || {}, d.byOrderType || [], d.byOrderSource || [], d.byDept || []);
                renderPosOrderType(d.byOrderType || []);
                renderPosOrderSource(d.byOrderSource || []);
                renderPosDept(d.byDept || []);
                if (loadingEl) loadingEl.style.display = 'none';
            } catch (e) {
                console.error('loadPosStats error:', e);
                var loadingEl = document.getElementById('pos-stats-loading');
                if (loadingEl) loadingEl.innerHTML = '<div style="color:#ef4444;padding:20px;">加载失败: ' + (e.message || e) + '</div>';
            }
        }

        function renderPosHourChart(hours) {
            var el = document.getElementById('pos-stats-hour');
            if (!hours.length) { el.innerHTML = '<div style="padding:20px;color:rgba(226,232,240,0.4);font-size:13px;">暂无数据</div>'; return; }
            var maxVal = Math.max.apply(null, hours.map(function(h) { return h.orders; }));
            el.innerHTML = '<div style="display:flex;align-items:end;gap:4px;height:160px;padding:0 4px;">'
                + hours.map(function(h) {
                    var pct = maxVal > 0 ? (h.orders / maxVal * 100) : 0;
                    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;height:100%;">'
                        + '<div style="font-size:9px;color:rgba(226,232,240,0.5);margin-bottom:2px;">' + h.orders + '</div>'
                        + '<div style="width:100%;max-width:28px;height:' + Math.max(4, Math.min(pct, 100)) + '%;background:linear-gradient(180deg,#38bdf8,#0ea5e9);border-radius:4px 4px 0 0;"></div>'
                        + '<div style="font-size:9px;color:rgba(226,232,240,0.7);margin-top:4px;">' + h.hour + ':00</div>'
                        + '</div>';
                }).join('') + '</div>';
        }

        function renderPosPayChart(pays) {
            var el = document.getElementById('pos-stats-pay');
            if (!pays.length) { el.innerHTML = '<div style="padding:20px;color:rgba(226,232,240,0.4);font-size:13px;">暂无数据</div>'; return; }
            var total = pays.reduce(function(a, b) { return a + Number(b.orders); }, 0) || 1;
            var colors = ['#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6', '#94a3b8'];
            el.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
                + pays.map(function(p, i) {
                    var pct = Math.round(Number(p.orders) / total * 100);
                    var rev = Number(p.revenue || 0);
                    return '<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;display:flex;align-items:center;gap:10px;">'
                        + '<div style="width:4px;height:36px;border-radius:4px;background:' + (colors[i % colors.length]) + ';flex-shrink:0;"></div>'
                        + '<div style="flex:1;min-width:0;">'
                        + '<div style="font-size:13px;color:#fff;font-weight:600;">' + p.pay_group + '</div>'
                        + '<div style="font-size:11px;color:rgba(226,232,240,0.55);margin-top:2px;">' + p.orders + '笔 · ' + pct + '%</div>'
                        + (rev > 0 ? '<div style="font-size:11px;color:#22c55e;margin-top:2px;">¥' + Number(rev / 100).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) + '</div>' : '')
                        + '</div></div>';
                }).join('') + '</div>';
        }

        function renderPosTopDishes(dishes) {
            var el = document.getElementById('pos-stats-dishes');
            if (!dishes.length) { el.innerHTML = '<div style="padding:20px;color:rgba(226,232,240,0.4);font-size:13px;">暂无数据</div>'; return; }
            var maxRev = Math.max.apply(null, dishes.map(function(d) { return Number(d.revenue); })) || 1;
            el.innerHTML = '<div style="max-height:300px;overflow-y:auto;">'
                + '<table style="width:100%;border-collapse:collapse;font-size:11px;">'
                + '<thead><tr style="color:rgba(226,232,240,0.5);border-bottom:1px solid rgba(255,255,255,0.06);"><th style="text-align:left;padding:4px 6px;">菜品</th><th style="text-align:right;padding:4px 6px;">分类</th><th style="text-align:right;padding:4px 6px;">销量</th><th style="text-align:right;padding:4px 6px;">营收</th></tr></thead>'
                + '<tbody>' + dishes.map(function(d) {
                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.03);"><td style="padding:5px 6px;color:#fff;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (d.dish_name || '-') + '</td><td style="padding:5px 6px;text-align:right;color:rgba(226,232,240,0.5);">' + (d.category || '-') + '</td><td style="padding:5px 6px;text-align:right;color:rgba(226,232,240,0.7);">' + d.total_qty + '</td><td style="padding:5px 6px;text-align:right;color:#22c55e;">¥' + parseFloat(d.revenue).toFixed(2) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }

        var __GROWTH_STORE_MAP = { '64822111': '洪潮大宁久光店', '51866138': '马己仙上海音乐广场店' };
        var __CONTENT_PURPOSE_TAGS = ['品宣','促销','拉新','召回','节日','会员日','新品','限时特惠'];
        var __CONTENT_CHANNEL_TAGS = ['朋友圈','小红书','美团','大众点评','企微','门店','抖音','公众号'];
        var __TEMPLATE_CATEGORY_OPTIONS = ['拉新','召回','节日','品宣','促销','会员日','新品','通用'];
        var __TEMPLATE_CHANNEL_OPTIONS = ['朋友圈','小红书','美团','大众点评','企微','门店','抖音','公众号'];
        var __TEMPLATE_ASPECT_OPTIONS = ['3:4','9:16','1:1','16:9','4:3','2:3'];
        var __TEMPLATE_STYLE_OPTIONS = ['明亮暖色促销，橙红渐变','深灰暖金老客召回，氛围感','黑金高端会员，奢华克制','红金节日庆典，喜庆热烈','清新现代新品，简洁编辑感','奶油白底酒红配，杂志感','极简留白高级感','中式传统红金风'];
        var __TEMPLATE_PROMPT_OPTIONS = ['保留大面积留白','产品主体占画面40%','文案位置给顶部与左侧','不要卡通风，保持真实质感','暖色灯光氛围','突出食物纹理细节','人物与食物互动','无特定约束'];
        function growthStoreName(id) { return __GROWTH_STORE_MAP[id] || id; }
        var __CHANNEL_MAP = { 'miniprogram': '微信小程序', 'wecom': '企微私聊', 'xiaohongshu': '小红书', 'douyin': '抖音', 'dianping': '大众点评', 'waimai': '外卖平台', 'sms': '短信', 'email': '邮件' };
        function growthChannelLabel(ch) { return __CHANNEL_MAP[ch] || ch; }
        var __STATUS_MAP = { 'proposed': '可一键执行', 'planned': '已排期', 'published': '已发布', 'draft': '草稿', 'active': '进行中', 'executed': '已执行', 'ignored': '已忽略', 'completed': '已完成', 'paused': '已暂停' };
        function growthStatusLabel(st) { return __STATUS_MAP[st] || st; }
        var __AUDIENCE_MAP = { 'all': '全部顾客', 'new': '新客', 'inactive': '沉睡客户', 'active': '活跃客户', 'vip': 'VIP', 'at_risk': '临界流失' };
        function growthAudienceLabel(au) { return __AUDIENCE_MAP[au] || au; }

        function renderPosBreakdown(elId, rows, labelKey) {
            var el = document.getElementById(elId);
            if (!el) return;
            if (!rows.length) { el.innerHTML = '<div style="padding:10px;color:rgba(226,232,240,0.4);font-size:12px;">暂无数据</div>'; return; }
            var totalRev = rows.reduce(function(s, r) { return s + Number(r.revenue || 0); }, 0) || 1;
            var colors = ['#38bdf8','#22c55e','#f59e0b','#ef4444','#a78bfa','#f472b6','#94a3b8','#fb923c','#4ade80','#e879f9'];
            el.innerHTML = rows.map(function(r, i) {
                var pct = Math.round(Number(r.revenue) / totalRev * 1000) / 10;
                var c = colors[i % colors.length];
                return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
                    + '<div style="width:6px;height:6px;border-radius:50%;background:' + c + ';flex-shrink:0;"></div>'
                    + '<div style="flex:1;min-width:0;">'
                    + '<div style="display:flex;justify-content:space-between;font-size:12px;">'
                    + '<span style="color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (r[labelKey] || '-') + '</span>'
                    + '<span style="color:' + c + ';font-weight:700;flex-shrink:0;margin-left:4px;">' + pct + '%</span></div>'
                    + '<div style="font-size:10px;color:rgba(226,232,240,0.5);">' + r.cnt + '笔 · ¥' + Number(r.revenue || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0}) + '</div>'
                    + '<div style="height:3px;border-radius:2px;background:rgba(255,255,255,0.06);margin-top:3px;"><div style="width:' + Math.max(4, pct) + '%;height:100%;border-radius:2px;background:' + c + ';"></div></div>'
                    + '</div></div>';
            }).join('');
        }

        function renderPosOrderType(rows) { renderPosBreakdown('pos-stats-order-type', rows, 'order_type'); }
        function renderPosOrderSource(rows) { renderPosBreakdown('pos-stats-order-source', rows, 'order_source'); }
        function renderPosDept(rows) { renderPosBreakdown('pos-stats-dept', rows, 'department'); }

        function renderPosStoreTable(stores) {
            var el = document.getElementById('pos-stats-stores');
            if (!stores.length) { el.innerHTML = '<div style="padding:20px;color:rgba(226,232,240,0.4);font-size:13px;">暂无数据</div>'; return; }
            var ranked = stores.slice().sort(function(a, b) { return Number(b.total_revenue || 0) - Number(a.total_revenue || 0); });
            var totalRevenue = ranked.reduce(function(sum, item) { return sum + Number(item.total_revenue || 0); }, 0) || 1;
            el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">'
                + ranked.map(function(s, idx) {
                    var displayName = s.store_name || growthStoreName(s.store_id) || '-';
                    var rank = idx + 1;
                    var badge = rank === 1 ? '🥇 TOP1' : rank === 2 ? '🥈 TOP2' : rank === 3 ? '🥉 TOP3' : '#' + rank;
                    var revenue = Number(s.total_revenue || 0);
                    var share = Math.round(revenue / totalRevenue * 1000) / 10;
                    return '<div style="background:linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px;box-shadow:0 8px 24px rgba(15,23,42,0.2);">'
                        + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">'
                        + '<div style="font-size:14px;font-weight:700;color:#fff;line-height:1.4;">🏪 ' + displayName + '</div>'
                        + '<div style="font-size:11px;font-weight:800;color:' + (rank === 1 ? '#c9a96a' : rank === 2 ? '#cbd5e1' : rank === 3 ? '#fdba74' : '#94a3b8') + ';background:rgba(15,23,42,0.38);border:1px solid rgba(255,255,255,0.08);padding:4px 8px;border-radius:999px;white-space:nowrap;">' + badge + '</div>'
                        + '</div>'
                        + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:10px;">营收贡献 ' + share + '%</div>'
                        + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">'
                        + '<div style="text-align:center;padding:6px 0;background:rgba(255,255,255,0.04);border-radius:6px;"><div style="font-size:18px;font-weight:800;color:#38bdf8;">' + s.orders + '</div><div style="font-size:10px;color:rgba(226,232,240,0.5);margin-top:2px;">订单</div></div>'
                        + '<div style="text-align:center;padding:6px 0;background:rgba(255,255,255,0.04);border-radius:6px;"><div style="font-size:18px;font-weight:800;color:#22c55e;">¥' + revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</div><div style="font-size:10px;color:rgba(226,232,240,0.5);margin-top:2px;">总营收</div></div>'
                        + '<div style="text-align:center;padding:6px 0;background:rgba(255,255,255,0.04);border-radius:6px;"><div style="font-size:18px;font-weight:800;color:#f59e0b;">¥' + parseFloat(s.avg_check || 0).toFixed(0) + '</div><div style="font-size:10px;color:rgba(226,232,240,0.5);margin-top:2px;">均单(折后)</div></div>'
                        + '</div>'
                        + '<div style="margin-top:10px;height:8px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;">'
                        + '<div style="width:' + Math.max(8, share) + '%;height:100%;background:linear-gradient(90deg,#22c55e,#38bdf8);"></div>'
                        + '</div></div>';
                }).join('') + '</div>';
        }

        function renderPosRepeatStats(repeat) {
            var el = document.getElementById('pos-stats-repeat');
            if (!repeat || !repeat.total_customers) { el.innerHTML = '<div style="padding:20px;color:rgba(226,232,240,0.4);font-size:13px;">暂无数据</div>'; return; }
            var total = Number(repeat.total_customers) || 1;
            var once = Number(repeat.one_timer) || 0;
            var twice = Number(repeat.two_timer) || 0;
            var threePlus = Number(repeat.repeat_3plus) || 0;
            var repeatRate = ((twice + threePlus) / total * 100).toFixed(1);
            el.innerHTML = '<div style="text-align:center;margin-bottom:12px;"><div style="font-size:28px;font-weight:800;color:#22c55e;">' + repeatRate + '%</div><div style="font-size:11px;color:rgba(226,232,240,0.5);">复购率</div></div>'
                + '<div style="display:flex;gap:8px;margin-bottom:8px;">'
                + '<div style="flex:1;background:rgba(56,189,248,0.1);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:16px;font-weight:800;color:#38bdf8;">' + once + '</div><div style="font-size:10px;color:rgba(226,232,240,0.5);">仅1次</div></div>'
                + '<div style="flex:1;background:rgba(245,158,11,0.1);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:16px;font-weight:800;color:#f59e0b;">' + twice + '</div><div style="font-size:10px;color:rgba(226,232,240,0.5);">2次</div></div>'
                + '<div style="flex:1;background:rgba(34,197,94,0.1);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:16px;font-weight:800;color:#22c55e;">' + threePlus + '</div><div style="font-size:10px;color:rgba(226,232,240,0.5);">3次+</div></div>'
                + '</div>'
                + '<div style="display:flex;gap:0;height:20px;border-radius:999px;overflow:hidden;">'
                + '<div style="flex:0 0 ' + (once / total * 100) + '%;background:#38bdf8;display:flex;align-items:center;justify-content:center;min-width:2px;"></div>'
                + '<div style="flex:0 0 ' + (twice / total * 100) + '%;background:#f59e0b;display:flex;align-items:center;justify-content:center;min-width:2px;"></div>'
                + '<div style="flex:0 0 ' + (threePlus / total * 100) + '%;background:#22c55e;display:flex;align-items:center;justify-content:center;min-width:2px;"></div>'
                + '</div>'
                + '<div style="margin-top:6px;font-size:11px;color:rgba(226,232,240,0.5);">共 ' + total + ' 位客户产生POS消费</div>';
        }

        function renderPosProfileInsights(pi, orderTypes, orderSources, depts) {
            var el = document.getElementById('pos-stats-profile');
            if (!el) return;
            if (!pi || !pi.lifecycle) { el.innerHTML = '<div style="padding:20px;color:rgba(226,232,240,0.4);font-size:13px;">暂无画像数据</div>'; return; }

            function totalOf(obj) {
                var total = 0;
                for (var k in obj) total += Number(obj[k] || 0);
                return total;
            }

            function renderMiniBars(title, dataMap, colorMap, labelMap, unit, limit) {
                var keys = Object.keys(dataMap || {});
                if (!keys.length) return '';
                keys.sort(function(a, b) { return Number(dataMap[b] || 0) - Number(dataMap[a] || 0); });
                if (limit) keys = keys.slice(0, limit);
                var total = 0;
                keys.forEach(function(k) { total += Number(dataMap[k] || 0); });
                var html = '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;">'
                    + '<div style="font-size:12px;color:rgba(226,232,240,0.88);font-weight:700;margin-bottom:8px;">' + title + '</div>';
                keys.forEach(function(k) {
                    var val = Number(dataMap[k] || 0);
                    var pct = total > 0 ? Math.round(val / total * 100) : 0;
                    var color = (colorMap && colorMap[k]) || '#38bdf8';
                    var label = (labelMap && labelMap[k]) || k;
                    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
                        + '<div style="width:72px;font-size:11px;color:rgba(226,232,240,0.66);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + label + '</div>'
                        + '<div style="flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:999px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:999px;"></div></div>'
                        + '<div style="width:64px;text-align:right;font-size:11px;color:rgba(226,232,240,0.66);">' + val + unit + ' ' + pct + '%</div>'
                        + '</div>';
                });
                html += '</div>';
                return html;
            }

            function topRow(rows, key) {
                if (!rows || !rows.length) return null;
                var sorted = rows.slice().sort(function(a, b) { return Number(b[key] || b.cnt || 0) - Number(a[key] || a.cnt || 0); });
                return sorted[0] || null;
            }

            var lifecycle = pi.lifecycle || {};
            var statDays = Number(pi.stats_days || 0);
            var statDaysLabel = statDays > 0 ? ('近' + statDays + '天') : '统计期';
            var lifecycleLabels = { prospect: '潜在新客', new: '新客', active: '活跃', at_risk: '临界客', dormant: '沉睡老客', churned: '流失客', lost_90: '流失客(3-6月)', lost_180: '流失客(6-12月)', lost_365: '流失客(1年+)' };
            var totalLc = totalOf(lifecycle);
            var lcColors = { prospect: '#94a3b8', new: '#38bdf8', active: '#22c55e', at_risk: '#f59e0b', dormant: '#ef4444', churned: '#6b7280', lost_90: '#a855f7', lost_180: '#7c3aed', lost_365: '#4c1d95' };
            var lcHtml = '<div style="margin-bottom:12px;"><div style="font-size:12px;color:rgba(226,232,240,0.88);font-weight:700;margin-bottom:8px;">客户生命周期 <span style="font-weight:500;color:rgba(226,232,240,0.45);">（' + statDaysLabel + ' POS消费客户）</span></div>'
                + '<div style="display:flex;gap:0;height:22px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,0.04);">';
            var lifecycleDefs = {
                prospect: '扫码/被触达但从未下单',
                new: '累计下单1次 · 近14天内到过店',
                active: '累计下单≥2次 · 近14天内到过店',
                at_risk: '14–30天未到店 · 有流失苗头',
                dormant: '30–90天未到店 · 但曾下单≥2次，值得召回',
                churned: '30–90天未到店 · 历史仅下过1单',
                lost_90: '90–180天未到店 · 导入老客，分批试召回',
                lost_180: '180–365天未到店 · 导入老客，分批试召回',
                lost_365: '365天+未到店 · 导入老客，分批试召回'
            };
            var lcLegend = '';
            for (var lk in lifecycleLabels) {
                var cnt = Number(lifecycle[lk] || 0);
                if (cnt > 0) {
                    var pct = totalLc > 0 ? (cnt / totalLc * 100) : 0;
                    var pctRound = totalLc > 0 ? Math.round(cnt / totalLc * 100) : 0;
                    lcHtml += '<div title="' + lifecycleLabels[lk] + ' ' + cnt + '" style="flex:0 0 ' + pct + '%;background:' + (lcColors[lk] || '#94a3b8') + ';min-width:6px;"></div>';
                    lcLegend += '<div style="display:flex;gap:7px;align-items:flex-start;">'
                        + '<span style="width:9px;height:9px;border-radius:2px;background:' + (lcColors[lk] || '#94a3b8') + ';flex:0 0 auto;margin-top:4px;"></span>'
                        + '<div style="flex:1;min-width:0;">'
                        + '<div style="font-size:12px;color:rgba(226,232,240,0.9);font-weight:600;">' + lifecycleLabels[lk] + ' <strong style="color:#fff;">' + cnt + '</strong> <span style="color:rgba(226,232,240,0.45);font-weight:400;">' + pctRound + '%</span></div>'
                        + '<div style="font-size:10px;color:rgba(226,232,240,0.5);line-height:1.4;margin-top:1px;">' + (lifecycleDefs[lk] || '') + '</div>'
                        + '</div></div>';
                }
            }
            lcHtml += '</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px 16px;margin-top:10px;">' + lcLegend + '</div></div>';

            var hv = pi.high_value_customers || {};
            var nvr = pi.new_vs_returning || {};
            var topSource = topRow(orderSources || [], 'cnt');
            var topDept = topRow(depts || [], 'cnt');
            var takeawayRow = (orderTypes || []).find(function(x) { return x.order_type === '平台外卖'; }) || null;
            var dineInRow = (orderTypes || []).find(function(x) { return x.order_type === '堂食'; }) || null;
            var takeawayPct = takeawayRow && (takeawayRow.cnt || 0) > 0 ? Math.round(Number(takeawayRow.cnt) / ((Number(takeawayRow.cnt) || 0) + (Number(dineInRow && dineInRow.cnt) || 0)) * 100) : 0;
            var topLifecycleKey = Object.keys(lifecycle).sort(function(a, b) { return Number(lifecycle[b] || 0) - Number(lifecycle[a] || 0); })[0] || 'active';
            var topLifecycleLabel = lifecycleLabels[topLifecycleKey] || topLifecycleKey;
            var personaHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;">'
                + '<div style="background:linear-gradient(180deg,rgba(59,130,246,0.14),rgba(56,189,248,0.05));border:1px solid rgba(56,189,248,0.18);border-radius:12px;padding:12px;">'
                + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:6px;">核心客群</div>'
                + '<div style="font-size:16px;font-weight:800;color:#fff;">以' + topLifecycleLabel + '为主</div>'
                + '<div style="font-size:12px;color:rgba(226,232,240,0.7);margin-top:6px;">当前以' + topLifecycleLabel + '阶段客户为主体，适合围绕复购和加深黏性运营。</div>'
                + '</div>'
                + '<div style="background:linear-gradient(180deg,rgba(34,197,94,0.14),rgba(34,197,94,0.05));border:1px solid rgba(34,197,94,0.18);border-radius:12px;padding:12px;">'
                + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:6px;">渠道画像</div>'
                + '<div style="font-size:16px;font-weight:800;color:#fff;">' + (topSource ? topSource.order_source : '暂无') + '</div>'
                + '<div style="font-size:12px;color:rgba(226,232,240,0.7);margin-top:6px;">客户主要从' + (topSource ? topSource.order_source : '主渠道') + '完成下单，建议围绕该触点做活动承接。</div>'
                + '</div>'
                + '<div style="background:linear-gradient(180deg,rgba(249,115,22,0.14),rgba(249,115,22,0.05));border:1px solid rgba(249,115,22,0.18);border-radius:12px;padding:12px;">'
                + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:6px;">消费场景</div>'
                + '<div style="font-size:16px;font-weight:800;color:#fff;">' + (takeawayPct > 0 ? ('外卖占比 ' + takeawayPct + '%') : '堂食消费为主') + '</div>'
                + '<div style="font-size:12px;color:rgba(226,232,240,0.7);margin-top:6px;">' + (takeawayPct >= 20 ? '存在明显外卖需求，适合做平台券和外卖套餐。' : '消费仍以到店堂食为主，适合做到店复购和桌边加购。') + '</div>'
                + '</div>'
                + '<div style="background:linear-gradient(180deg,rgba(168,85,247,0.14),rgba(168,85,247,0.05));border:1px solid rgba(168,85,247,0.18);border-radius:12px;padding:12px;">'
                + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:6px;">口味锚点</div>'
                + '<div style="font-size:16px;font-weight:800;color:#fff;">' + (topDept ? topDept.department : '暂无') + '</div>'
                + '<div style="font-size:12px;color:rgba(226,232,240,0.7);margin-top:6px;">客户下单更集中在' + (topDept ? topDept.department : '核心出品部门') + '，可围绕该线做主推与组合推荐。</div>'
                + '</div>'
                + '</div>';
            var adviceTitle = takeawayPct >= 20 ? '补强外卖套餐与平台承接' : '强化堂食复购与到店加购';
            var adviceDesc = takeawayPct >= 20
                ? '当前外卖需求已形成规模，优先围绕' + (topSource ? topSource.order_source : '主渠道') + '设计套餐、满减券和二次复购券。'
                : '当前消费以堂食为主，优先围绕' + topLifecycleLabel + '客做到店回访、桌边加购和次日复购提醒。';
            var segmentTitle = (nvr.new_pct || 0) >= 60 ? '优先触达新客首单群体' : '优先触达已消费活跃客群';
            var segmentDesc = (nvr.new_pct || 0) >= 60
                ? '新客占比较高，建议用首单礼、加企微/会员入会券提升二次转化。'
                : '回头客基础已经形成，建议做老客唤醒、节气菜单、双人套餐等复购动作。';
            var actionTitle = topDept && topDept.department ? ('主推' + topDept.department + '关联菜品') : '主推高偏好菜品组合';
            var actionDesc = topDept && topDept.department
                ? '围绕' + topDept.department + '做套餐锚点，搭配' + (topSource ? topSource.order_source : '主渠道') + '专属券，更容易提升转化。'
                : '围绕当前高频品类做套餐和加价购，提高客单与复购。';
            var suggestHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:12px;">'
                + '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.16);border-radius:12px;padding:12px;">'
                + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:6px;">门店经营建议</div>'
                + '<div style="font-size:15px;font-weight:800;color:#fff;">' + adviceTitle + '</div>'
                + '<div style="font-size:12px;line-height:1.6;color:rgba(226,232,240,0.74);margin-top:6px;">' + adviceDesc + '</div>'
                + '</div>'
                + '<div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.16);border-radius:12px;padding:12px;">'
                + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:6px;">适合触达客群</div>'
                + '<div style="font-size:15px;font-weight:800;color:#fff;">' + segmentTitle + '</div>'
                + '<div style="font-size:12px;line-height:1.6;color:rgba(226,232,240,0.74);margin-top:6px;">' + segmentDesc + '</div>'
                + '</div>'
                + '<div style="background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.16);border-radius:12px;padding:12px;">'
                + '<div style="font-size:11px;color:rgba(226,232,240,0.58);margin-bottom:6px;">推荐营销动作</div>'
                + '<div style="font-size:15px;font-weight:800;color:#fff;">' + actionTitle + '</div>'
                + '<div style="font-size:12px;line-height:1.6;color:rgba(226,232,240,0.74);margin-top:6px;">' + actionDesc + '</div>'
                + '</div>'
                + '</div>';
            var overviewHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:12px;">'
                + '<div style="background:rgba(56,189,248,0.10);border:1px solid rgba(56,189,248,0.18);border-radius:10px;padding:10px;"><div style="font-size:11px;color:rgba(226,232,240,0.6);">新客占比</div><div style="font-size:22px;font-weight:800;color:#38bdf8;">' + (nvr.new_pct || 0) + '%</div></div>'
                + '<div style="background:rgba(34,197,94,0.10);border:1px solid rgba(34,197,94,0.18);border-radius:10px;padding:10px;"><div style="font-size:11px;color:rgba(226,232,240,0.6);">回头客占比</div><div style="font-size:22px;font-weight:800;color:#22c55e;">' + (nvr.returning_pct || 0) + '%</div></div>'
                + '<div style="background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.18);border-radius:10px;padding:10px;"><div style="font-size:11px;color:rgba(226,232,240,0.6);">POS消费客户</div><div style="font-size:22px;font-weight:800;color:#f59e0b;">' + Number(hv.count || 0) + '</div></div>'
                + '<div style="background:rgba(167,139,250,0.10);border:1px solid rgba(167,139,250,0.18);border-radius:10px;padding:10px;"><div style="font-size:11px;color:rgba(226,232,240,0.6);">堂食桌均</div><div style="font-size:22px;font-weight:800;color:#a78bfa;">¥' + (pi.avg_table_spend || '0') + '</div></div>'
                + '</div>';

            var spendHtml = renderMiniBars('堂食桌均分布', pi.avg_spend_dist || {}, {
                '0-200': '#38bdf8', '200-400': '#22c55e', '400-600': '#f59e0b', '600-800': '#ef4444', '800+': '#a78bfa'
            }, {
                '0-200': '0-200元', '200-400': '200-400元', '400-600': '400-600元', '600-800': '600-800元', '800+': '800元+'
            }, '单');

            var visitHtml = renderMiniBars('到店时段偏好', pi.top_visit_times || {}, {
                '午市(10-14点)': '#f59e0b', '晚市(17-21点)': '#38bdf8', '其他时段': '#94a3b8'
            }, {
                '午市(10-14点)': '午市', '晚市(17-21点)': '晚市', '其他时段': '其他'
            }, '单');

            var custTypeHtml = renderMiniBars('客户订单类型偏好', pi.cust_order_type || {}, {
                '堂食': '#22c55e', '平台外卖': '#f97316'
            }, null, '项');

            var custSourceHtml = renderMiniBars('客户订单来源偏好', pi.cust_order_source || {}, {
                '微信小程序': '#22c55e', '收银POS': '#38bdf8', '掌上客如云': '#a78bfa', '支付宝小程序': '#f59e0b', '美团外卖': '#f97316', '淘宝闪购餐饮外卖': '#ef4444'
            }, null, '项', 6);

            var deptHtml = renderMiniBars('客户偏好出品部门', pi.cust_dept || {}, {
                '热厨': '#ef4444', '烧味': '#f59e0b', '卤水档': '#22c55e', '刺身档': '#38bdf8', '煲仔档': '#a78bfa', '汤档': '#14b8a6', '水吧': '#e879f9', '上杂': '#fb7185', '前厅': '#94a3b8'
            }, null, '份', 8);

            var dishHtml = renderMiniBars('品类偏好 TOP5', pi.top_dish_categories || {}, {
                '广东小炒': '#38bdf8', '饮品酒水': '#22c55e', '招牌主食': '#f59e0b', '名厨啫啫': '#ef4444', '招牌烧味': '#a78bfa'
            }, null, '份', 5);

            var cm = pi.customer_metrics || {};
            var cmCards = [
                { label: '客户总数', value: Number(cm.total_customers || 0), color: '#38bdf8', sub: statDaysLabel + '有消费手机号' },
                { label: '新客', value: Number(cm.new_count || nvr.new_count || 0), color: '#0ea5e9', sub: statDaysLabel + '内首次消费' },
                { label: '回头客', value: Number(cm.returning_count || nvr.returning_count || 0), color: '#6366f1', sub: statDaysLabel + '内复访老客' },
                { label: '活跃客', value: Number(cm.active_count || lifecycle.active || 0), color: '#22c55e', sub: statDaysLabel + '消费·近14天活跃' },
                { label: '临界客', value: Number(cm.at_risk_count || lifecycle.at_risk || 0), color: '#f59e0b', sub: statDaysLabel + '消费·14-30天未到' },
                { label: '沉睡老客', value: Number(cm.dormant_count || lifecycle.dormant || 0), color: '#ef4444', sub: statDaysLabel + '消费·30天+未到' },
                { label: '流失客', value: Number(cm.churned_count || lifecycle.churned || 0), color: '#9ca3af', sub: statDaysLabel + '消费·低频流失' },
                { label: 'VIP人数', value: Number(cm.vip_count || 0), color: '#fbbf24', sub: statDaysLabel + '折前人均消费前15%' },
                { label: '流失率', value: Number(cm.churn_rate || 0) + '%', color: '#f87171', sub: statDaysLabel + '消费客中沉睡+流失' },
                { label: '复购率', value: Number(cm.repurchase_rate || 0) + '%', color: '#a78bfa', sub: statDaysLabel + '内下单≥2次占比' }
            ];
            var cmHtml = '<div style="margin-bottom:12px;"><div style="font-size:13px;color:#fff;font-weight:800;margin-bottom:8px;">📊 核心客户指标 <span style="font-size:11px;color:rgba(226,232,240,0.45);font-weight:500;">（' + statDaysLabel + ' POS消费客户）</span></div>'
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;">'
                + cmCards.map(function(c) {
                    return '<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:10px 8px;text-align:center;">'
                        + '<div style="font-size:21px;font-weight:800;color:' + c.color + ';line-height:1.1;white-space:nowrap;">' + c.value + '</div>'
                        + '<div style="font-size:12px;color:rgba(226,232,240,0.82);margin-top:5px;font-weight:600;">' + c.label + '</div>'
                        + '<div style="font-size:10px;color:rgba(226,232,240,0.45);margin-top:2px;line-height:1.3;">' + c.sub + '</div>'
                        + '</div>';
                }).join('') + '</div></div>';

            el.innerHTML = cmHtml
                + personaHtml
                + suggestHtml
                + overviewHtml
                + lcHtml
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">'
                + spendHtml
                + visitHtml
                + custTypeHtml
                + '</div>'
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px;">'
                + custSourceHtml
                + deptHtml
                + dishHtml
                + '</div>';
        }

        function renderGrowthFunnel(metrics) {
            var total = { scan: 0, auth: 0, claimed: 0, purchased: 0, marketing: 0, redeem: 0, payment: 0 };
            var byChannel = {};
            metrics.forEach(function(m) {
                total.scan += Number(m.scan_count) || 0;
                total.auth += Number(m.authorized_count) || 0;
                total.claimed += Number(m.coupon_claimed_count) || 0;
                total.purchased += Number(m.coupon_purchased_count) || 0;
                total.marketing += Number(m.marketing_triggered_count) || 0;
                total.redeem += Number(m.coupon_redeemed_count) || 0;
                total.payment += Number(m.payment_count) || 0;
                var ch = m.channel || 'unknown';
                if (!byChannel[ch]) byChannel[ch] = { scan: 0, auth: 0, claimed: 0, purchased: 0, marketing: 0, redeem: 0, payment: 0 };
                byChannel[ch].scan += Number(m.scan_count) || 0;
                byChannel[ch].auth += Number(m.authorized_count) || 0;
                byChannel[ch].claimed += Number(m.coupon_claimed_count) || 0;
                byChannel[ch].purchased += Number(m.coupon_purchased_count) || 0;
                byChannel[ch].marketing += Number(m.marketing_triggered_count) || 0;
                byChannel[ch].redeem += Number(m.coupon_redeemed_count) || 0;
                byChannel[ch].payment += Number(m.payment_count) || 0;
            });
            var chLabels = { miniprogram: '小程序', wecom: '企微', sms: '短信', subscribe: '订阅消息', pos: 'POS', unknown: '其他' };
            var chColors = { miniprogram: '#38bdf8', wecom: '#22c55e', sms: '#f59e0b', subscribe: '#a78bfa', pos: '#f472b6', unknown: '#94a3b8' };
            var chList = Object.keys(byChannel).filter(function(c) { return byChannel[c].scan > 0 || byChannel[c].auth > 0 || byChannel[c].claimed > 0; });
            var steps = [
                { name: '扫码', count: total.scan, pct: 100 },
                { name: '授权', count: total.auth, pct: total.scan > 0 ? Math.round(total.auth / total.scan * 100) : 0 },
                { name: '主动领券', count: total.claimed, pct: total.auth > 0 ? Math.round(total.claimed / total.auth * 100) : 0 },
                { name: '核销', count: total.redeem, pct: total.claimed > 0 ? Math.round(total.redeem / total.claimed * 100) : 0 },
                { name: '支付', count: total.payment, pct: total.redeem > 0 ? Math.round(total.payment / total.redeem * 100) : 0 }
            ];
            var chBreakdownHtml = '';
            if (chList.length > 1) {
                chBreakdownHtml = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--pf-line);">'
                    + '<div style="font-size:11px;color:rgba(226,232,240,0.5);margin-bottom:6px;"> 按渠道细分</div>'
                    + chList.map(function(ch) {
                        var d = byChannel[ch];
                        var label = chLabels[ch] || ch;
                        var color = chColors[ch] || '#94a3b8';
                        return '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(226,232,240,0.6);padding:2px 0;">'
                            + '<span style="width:8px;height:8px;border-radius:2px;background:' + color + ';flex-shrink:0;"></span>'
                            + '<span style="flex:1;">' + label + '</span>'
                            + '<span>扫码' + d.scan + ' · 授权' + d.auth + ' · 领券' + d.claimed + ' · 核销' + d.redeem + '</span>'
                            + '</div>';
                    }).join('') + '</div>';
            }
            var marketingNote = total.marketing > 0 ? '<div style="font-size:11px;color:rgba(226,232,240,0.4);margin-top:8px;"> 另：HRMS自动营销发券 ' + total.marketing + ' 次（不计入漏斗）</div>' : '';
            document.getElementById('growth-funnel').innerHTML = '<div style="font-size:11px;color:rgba(226,232,240,0.4);margin-bottom:8px;"> 漏斗仅统计小程序用户主动行为，HRMS自动营销发券单独展示</div>'
                + steps.map(function(s, i) {
                var barColor = s.pct < 10 ? '#ef4444' : s.pct < 30 ? '#f59e0b' : '#22c55e';
                return '<div style="margin-bottom:12px;">'
                    + '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;font-size:12px;color:rgba(226,232,240,0.78);">'
                    + '<strong style="color:#fff;">' + s.name + '</strong><span>' + s.count + ' · ' + s.pct + '%</span></div>'
                    + '<div style="height:10px;background:rgba(255,255,255,0.07);border-radius:999px;overflow:hidden;">'
                    + '<div style="height:100%;width:' + Math.max(4, Math.min(100, s.pct)) + '%;background:' + barColor + ';border-radius:999px;"></div>'
                    + '</div></div>';
            }).join('') + marketingNote + chBreakdownHtml;
            if (!total.scan && !total.auth) {
                document.getElementById('growth-funnel').innerHTML = '<div style="color:rgba(226,232,240,0.4);padding:20px;">暂无数据</div>';
            }
        }

        function renderGrowthAlerts(alerts) {
            var churnAlerts = alerts.filter(function(a) { return a.alert_type === 'churn' || /流失/.test(a.title || ''); });
            if (!churnAlerts.length) {
                document.getElementById('growth-alerts').innerHTML = '<div style="color:rgba(226,232,240,0.4);padding:20px;">暂无流失预警</div>';
                return;
            }
            document.getElementById('growth-alerts').innerHTML = churnAlerts.slice(0, 10).map(function(a) {
                var sevColor = a.severity === 'high' ? '#ef4444' : a.severity === 'medium' ? '#f59e0b' : '#22c55e';
                var sevEmoji = a.severity === 'high' ? '🚨' : a.severity === 'medium' ? '⚠️' : 'ℹ️';
                var sevZh = a.severity === 'high' ? '严重' : a.severity === 'medium' ? '中等' : '低';
                var storeId = (a.store_id || '').replace(/'/g, "\\'");
                var storeLabel = a.store_id ? ('🏪 ' + amStoreName(a.store_id)) : '🏪 未关联门店';
                return '<div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">'
                    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">'
                    + '<span style="font-size:13px;font-weight:800;color:#fff;line-height:1.35;">' + sevEmoji + ' ' + (a.title || '').slice(0, 48) + '</span>'
                    + '<span style="font-size:10px;padding:3px 8px;border-radius:999px;background:' + sevColor + ';color:#fff;flex:0 0 auto;">' + sevZh + '</span>'
                    + '</div>'
                    + '<div style="margin-top:5px;"><span style="font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(56,189,248,0.14);color:#7dd3fc;border:1px solid rgba(56,189,248,0.25);">' + storeLabel + '</span></div>'
                    + '<div style="font-size:12px;color:rgba(226,232,240,0.66);margin-top:6px;line-height:1.55;">' + (a.message || '').slice(0, 120) + '</div>'
                    + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">'
                    + '<button onclick="alertActionRecall(\'' + storeId + '\',\'' + (a.alert_key || '').replace(/'/g, "\\'") + '\')" style="padding:4px 10px;border-radius:6px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);cursor:pointer;font-size:11px;"> 发送召回券</button>'
                    + '<button data-click="alertActionDismiss" data-arg="' + (a.alert_key || '').replace(/'/g, "\\'") + '" style="padding:4px 10px;border-radius:6px;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);cursor:pointer;font-size:11px;">✅ 标记已处理</button>'
                    + '</div></div>';
            }).join('');
        }

        async function alertActionRecall(storeId, alertKey) {
            try {
                var r = await fetch('/api/growth/repurchase-trigger', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify({ store_id: storeId || '' })
                });
                var data = await r.json();
                if (!data.ok && !data.triggered) throw new Error(data.error || 'trigger_failed');
                var count = data.triggered || data.actions_created || 0;
                showNotification('已为该门店创建 ' + count + ' 条复购召回行动，请到「AI建议」Tab查看并执行', 'success');
                if (alertKey) {
                    await fetch('/api/growth/alerts/' + encodeURIComponent(alertKey) + '/resolve', {
                        method: 'POST',
                        headers: growthAuthHeaders()
                    }).catch(function(){});
                }
                refreshGrowthCurrentTab();
            } catch (e) { showNotification('操作失败：' + (e?.message || e), 'error'); }
        }

        async function alertActionDismiss(alertKey) {
            if (!confirm('确认标记此预警为「已处理」？')) return;
            try {
                await fetch('/api/growth/alerts/' + encodeURIComponent(alertKey) + '/resolve', {
                    method: 'POST',
                    headers: growthAuthHeaders()
                });
                showNotification('预警已标记为已处理', 'success');
                refreshGrowthCurrentTab();
            } catch (e) { showNotification('操作失败：' + (e?.message || e), 'error'); }
        }

        function renderGrowthTrends(metrics) {
            var byDate = {};
            metrics.forEach(function(m) {
                var d = m.metric_date;
                if (!byDate[d]) byDate[d] = { scan: 0, auth: 0, claimed: 0, redeem: 0, payment: 0 };
                byDate[d].scan += Number(m.scan_count) || 0;
                byDate[d].auth += Number(m.authorized_count) || 0;
                byDate[d].claimed += Number(m.coupon_claimed_count) || 0;
                byDate[d].redeem += Number(m.coupon_redeemed_count) || 0;
                byDate[d].payment += Number(m.payment_count) || 0;
            });
            var dates = Object.keys(byDate).sort();
            if (!dates.length) {
                document.getElementById('growth-trends').innerHTML = '<div style="color:rgba(226,232,240,0.4);padding:20px;">暂无数据</div>';
                return;
            }
            var trendIndicators = [
                { key: 'scan', label: '扫码', color: '#3b82f6' },
                { key: 'auth', label: '授权', color: '#22c55e' },
                { key: 'claimed', label: '领券', color: '#a78bfa' },
                { key: 'redeem', label: '核销', color: '#f59e0b' },
                { key: 'payment', label: '支付', color: '#f472b6' }
            ];
            var activeKey = __growthTrendIndicator || 'scan';
            var barHeight = 120;
            var colWidth = Math.max(40, Math.min(80, 600 / dates.length));
            var maxVal = 0;
            dates.forEach(function(d) { maxVal = Math.max(maxVal, byDate[d][activeKey] || 0); });
            var lastDate = dates[dates.length - 1];
            var prevDate = dates.length >= 2 ? dates[dates.length - 2] : null;
            var curVal = byDate[lastDate][activeKey] || 0;
            var prevVal = prevDate ? (byDate[prevDate][activeKey] || 0) : 0;
            var changePct = prevVal > 0 ? (((curVal - prevVal) / prevVal) * 100).toFixed(1) : '0.0';
            var changeDir = curVal >= prevVal ? '↑' : '↓';
            var changeColor = curVal >= prevVal ? '#22c55e' : '#ef4444';
            var daysLabel = document.getElementById('growth-days-filter')?.value || '30';
            var indicatorHtml = '<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">'
                + '<span style="font-size:11px;color:rgba(226,232,240,0.5);">指标：</span>'
                + trendIndicators.map(function(ind) {
                    return '<button data-click="switchTrendIndicator" data-arg="' + ind.key + '" style="padding:3px 8px;border-radius:4px;font-size:11px;border:1px solid ' + (ind.key === activeKey ? ind.color : 'rgba(255,255,255,0.1)') + ';background:' + (ind.key === activeKey ? ind.color + '33' : 'transparent') + ';color:' + (ind.key === activeKey ? ind.color : 'rgba(226,232,240,0.5)') + ';cursor:pointer;">' + ind.label + '</button>';
                }).join('')
                + '<span style="margin-left:auto;font-size:11px;color:' + changeColor + ';">' + changeDir + ' ' + changePct + '%（较前一日）</span>'
                + '</div>';
            document.getElementById('growth-trends').innerHTML = '<div style="font-size:11px;color:rgba(226,232,240,0.4);margin-bottom:8px;"> 近' + daysLabel + '天核心指标趋势，数据来自小程序事件上报</div>'
                + indicatorHtml
                + '<div style="display:flex;align-items:flex-end;gap:' + (colWidth * 0.25) + 'px;min-height:' + (barHeight + 30) + 'px;padding-top:10px;overflow-x:auto;">'
                + dates.map(function(d) {
                    var s = byDate[d];
                    var val = s[activeKey] || 0;
                    var h = maxVal > 0 ? Math.round(val / maxVal * barHeight) : 0;
                    var activeInd = trendIndicators.find(function(ind) { return ind.key === activeKey; });
                    var barColor = activeInd ? activeInd.color : '#3b82f6';
                    return '<div style="display:flex;flex-direction:column;align-items:center;width:' + colWidth + 'px;">'
                        + '<div style="font-size:10px;color:rgba(226,232,240,0.6);margin-bottom:2px;white-space:nowrap;">' + val + '</div>'
                        + '<div style="width:12px;background:' + barColor + ';border-radius:3px 3px 0 0;height:' + h + 'px;"></div>'
                        + '<div style="font-size:10px;color:rgba(226,232,240,0.5);margin-top:4px;white-space:nowrap;">' + d.slice(5) + '</div>'
                        + '</div>';
                }).join('')
                + '</div>';
        }

        function switchTrendIndicator(key) {
            __growthTrendIndicator = key;
            refreshGrowthCurrentTab();
        }

        function renderGrowthActions(actions) {
            if (!actions.length) {
                document.getElementById('growth-actions').innerHTML = '<div style="color:rgba(226,232,240,0.4);padding:20px;">暂无行动建议</div>';
                return;
            }
            document.getElementById('growth-actions').innerHTML = actions.slice(0, 10).map(function(a) {
                var status = a.status || '-';
                var statusColor = status === 'executed' ? '#22c55e' : status === 'ignored' ? '#ef4444' : '#f59e0b';
                return '<div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">'
                    + '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">'
                    + '<div style="font-size:13px;font-weight:800;color:#fff;line-height:1.4;">💡 ' + (a.title || '').slice(0, 54) + '</div>'
                    + '<span style="font-size:10px;padding:3px 8px;border-radius:999px;background:' + statusColor + '22;color:' + statusColor + ';border:1px solid ' + statusColor + '55;white-space:nowrap;">' + status + '</span></div>'
                    + '<div style="font-size:12px;color:rgba(226,232,240,0.66);margin-top:7px;line-height:1.55;">' + (a.detail || '-').slice(0, 150) + '</div>'
                    + '</div>';
            }).join('');
        }

        function renderGrowthWeather(data) {
            var el = document.getElementById('growth-weather');
            if (!el) return;
            var tips = Array.isArray(data?.tips) ? data.tips : [];
            var temp = data?.temperature || '-';
            var cond = data?.condition || '-';
            var season = data?.season || '-';
            var holiday = data?.holiday || '';
            var isWeekend = data?.is_weekend;
            var dayType = holiday ? '🎯 ' + holiday : (isWeekend ? '🌿 周末' : '💼 工作日');
            el.innerHTML = '<div style="font-size:28px;font-weight:800;color:#fff;">' + temp + '</div>'
                + '<div style="font-size:13px;color:rgba(226,232,240,0.7);margin-top:4px;">' + cond + ' · ' + season + '</div>'
                + '<div style="font-size:12px;color:#38bdf8;margin-top:6px;">' + dayType + '</div>'
                + (tips.length ? '<div style="margin-top:8px;">' + tips.map(function(t) { return '<div style="font-size:11px;color:rgba(226,232,240,0.55);padding:2px 0;">💡 ' + t + '</div>'; }).join('') + '</div>' : '');
        }

        function renderGrowthActiveWindow(data) {
            var el = document.getElementById('growth-active-window');
            if (!el) return;
            var pred = data?.predicted_window || '数据不足';
            var recs = Array.isArray(data?.recommendations) ? data.recommendations : [];
            var segments = Array.isArray(data?.segments) ? data.segments : [];
            var risk = Array.isArray(data?.repurchase_risk) ? data.repurchase_risk : [];
            var html = '<div style="font-size:13px;font-weight:700;color:' + (pred !== '数据不足' ? '#22c55e' : 'rgba(226,232,240,0.5)') + ';margin-bottom:8px;">' + (pred !== '数据不足' ? '✅ ' + pred : '⏳ 暂无足够事件数据') + '</div>';
            if (segments.length) {
                html += '<div style="font-size:11px;color:rgba(226,232,240,0.55);margin-bottom:6px;">客群分布</div>';
                segments.forEach(function(s) {
                    html += '<div style="font-size:11px;color:rgba(226,232,240,0.5);padding:2px 0;">' + (s.lifecycle_stage || '-') + ': ' + (s.cnt || 0) + '人 · 触达窗口 ' + (s.top_window || '-') + '</div>';
                });
            }
            if (risk.length) {
                html += '<div style="font-size:11px;color:#f59e0b;margin-top:6px;">⚠️ ' + risk[0].at_risk_count + '位客户复购临界</div>';
            }
            el.innerHTML = html;
        }

        function renderGrowthRepurchase(atRiskCount, churnedCount, storeId) {
            var el = document.getElementById('growth-repurchase');
            if (!el) return;
            var total = atRiskCount + churnedCount;
            var storeLabel = storeId ? amStoreName(storeId) : '全部门店';
            var html = '<div style="font-size:11px;color:rgba(226,232,240,0.4);margin-bottom:8px;">📌 基于客户最近到店时间自动判定：14-30天未到店=临界，30天+=流失</div>'
                + '<div style="margin-bottom:8px;"><span style="font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(56,189,248,0.14);color:#7dd3fc;border:1px solid rgba(56,189,248,0.25);">🏪 ' + storeLabel + '</span></div>'
                + '<div style="display:flex;gap:10px;margin-bottom:12px;">'
                + '<div style="flex:1;text-align:center;background:rgba(245,158,11,0.08);border-radius:10px;padding:10px 4px;"><div style="font-size:24px;font-weight:800;color:#f59e0b;">' + atRiskCount + '</div><div style="font-size:11px;color:rgba(226,232,240,0.6);margin-top:2px;">临界客户</div></div>'
                + '<div style="flex:1;text-align:center;background:rgba(239,68,68,0.08);border-radius:10px;padding:10px 4px;"><div style="font-size:24px;font-weight:800;color:#ef4444;">' + churnedCount + '</div><div style="font-size:11px;color:rgba(226,232,240,0.6);margin-top:2px;">流失客户</div></div>'
                + '</div>';
            if (total > 0) {
                html += '<button data-click="triggerRepurchase" data-arg="' + (storeId || '') + '" style="display:block;width:100%;box-sizing:border-box;min-height:44px;padding:11px 14px;border-radius:10px;background:rgba(245,158,11,0.2);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);cursor:pointer;font-size:14px;font-weight:700;">🚀 立即触发复购行动</button>'
                    + '<div style="font-size:10px;color:rgba(226,232,240,0.35);margin-top:6px;line-height:1.4;">⚡ 点击后将自动为这些客户创建「发券/内容触达」待办行动，请到「AI建议」Tab中逐条确认后执行，不会自动发送</div>';
            } else {
                html += '<div style="font-size:12px;color:rgba(226,232,240,0.4);">当前无复购临界客户</div>';
            }
            el.innerHTML = html;
        }

        async function triggerRepurchase(storeId) {
            try {
                var r = await fetch('/api/growth/repurchase-trigger', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify({ store_id: storeId || '' })
                });
                var data = await r.json();
                if (!data.ok && !data.triggered) throw new Error(data.error || 'trigger_failed');
                var count = data.triggered || data.actions_created || 0;
                showNotification('复购行动已触发' + (count ? '，创建了' + count + '条行动' : ''), 'success');
                refreshGrowthDashboard();
            } catch (e) {
                showNotification('触发复购失败：' + (e?.message || e), 'error');
            }
        }

    // ════════════════════════════════════════════════
    // Phase 6: 海报模板 + 渲染系统
    // ════════════════════════════════════════════════

    var POSTER_TEMPLATES = [
      {
        key: 'new_welcome', name: '新客福利', desc: '暖色喜庆，适合拉新入会',
        style: '明亮暖色促销海报，橙红渐变背景，大字标题居中，节庆感与新客福利感强，适合餐饮拉新。',
        promptNotes: '商业餐饮KV，真实摄影质感，版式清晰，标题区留白充足，适合后期叠加中文文案，不要卡通插画。',
        colors: { bg1: '#FF6B35', bg2: '#E63E1A', text: '#FFFFFF', accent: '#FFD700' },
        draw: function(ctx, w, h, d) {
          var g = ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#FF6B35'); g.addColorStop(1,'#E63E1A');
          ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
          ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.arc(w*0.8,h*0.2,220,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.beginPath(); ctx.arc(w*0.2,h*0.7,180,0,Math.PI*2); ctx.fill();
          ctx.textAlign='center';
          ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.font='bold 72px sans-serif'; ctx.fillText('🎉', w/2, 160);
          ctx.fillStyle='#FFFFFF'; ctx.font='bold 58px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText(d.title||'', w/2, 280);
          ctx.font='28px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillStyle='rgba(255,255,255,0.85)'; if(d.subtitle) ctx.fillText(d.subtitle, w/2, 350);
          ctx.fillStyle='rgba(255,215,0,0.15)'; roundRect(ctx, w/2-160,420,320,160,20); ctx.fill();
          ctx.fillStyle='#FFD700'; ctx.font='bold 44px sans-serif'; if(d.offer) ctx.fillText(d.offer, w/2, 540);
          if(d.cta){ctx.fillStyle='#FFFFFF'; ctx.font='22px "PingFang SC",sans-serif'; ctx.fillText(d.cta, w/2, 620);}
          ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='18px sans-serif'; ctx.fillText(d.store||'', w/2, h-100);
          if (d.qrDataURL) { ctx.drawImage(d.qrDataURL, w/2-50, h-230, 100, 100); }
        }
      },
      {
        key: 'recall', name: '老客召回', desc: '温暖怀旧，唤醒复购',
        style: '深灰暖金色老客召回海报，温暖克制，有情绪氛围与怀旧感，适合回流与私域触达。',
        promptNotes: '高级餐饮广告，真实食物摄影，情绪化暖光，文案区明确，不要过度复杂背景。',
        colors: { bg1: '#2D3436', bg2: '#636E72', text: '#FFFFFF', accent: '#FDCB6E' },
        draw: function(ctx, w, h, d) {
          var g = ctx.createLinearGradient(0,0,w,0); g.addColorStop(0,'#2D3436'); g.addColorStop(1,'#636E72');
          ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
          ctx.fillStyle='rgba(253,203,110,0.08)'; ctx.beginPath(); ctx.arc(w/2,h/2,300,0,Math.PI*2); ctx.fill();
          ctx.textAlign='center';
          ctx.fillStyle='rgba(253,203,110,0.2)'; ctx.font='bold 60px sans-serif'; ctx.fillText('💝', w/2, 160);
          ctx.fillStyle='#FDCB6E'; ctx.font='bold 50px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText(d.title||'', w/2, 290);
          ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='24px "PingFang SC",sans-serif'; if(d.subtitle) ctx.fillText(d.subtitle, w/2, 360);
          ctx.fillStyle='rgba(253,203,110,0.12)'; roundRect(ctx, w/2-170,410,340,140,16); ctx.fill();
          ctx.fillStyle='#FDCB6E'; ctx.font='bold 40px sans-serif'; if(d.offer) ctx.fillText(d.offer, w/2, 520);
          if(d.cta){ctx.fillStyle='#FFFFFF'; ctx.font='22px "PingFang SC",sans-serif'; ctx.fillText(d.cta, w/2, 600);}
          ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='16px sans-serif'; ctx.fillText(d.store||'', w/2, h-90);
          if (d.qrDataURL) { ctx.drawImage(d.qrDataURL, w/2-45, h-210, 90, 90); }
        }
      },
      {
        key: 'vip', name: 'VIP专享', desc: '高端黑金，高价值客户',
        style: '黑金高端会员海报，奢华克制，强质感，高净值会员礼遇方向。',
        promptNotes: '高端商业视觉，暗色背景，金属点缀，版面高级留白，不要廉价促销感。',
        colors: { bg1: '#0A0A0A', bg2: '#1A1A2E', text: '#FFD700', accent: '#C5A55A' },
        draw: function(ctx, w, h, d) {
          var g = ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,'#0A0A0A'); g.addColorStop(1,'#1A1A2E');
          ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
          ctx.fillStyle='rgba(197,165,90,0.06)'; ctx.beginPath(); ctx.arc(w/2,h*0.4,260,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle='rgba(197,165,90,0.2)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(w/2,h*0.4,280,0,Math.PI*2); ctx.stroke();
          ctx.textAlign='center';
          ctx.fillStyle='#C5A55A'; ctx.font='bold 40px sans-serif'; ctx.fillText('👑 VIP', w/2, 150);
          ctx.fillStyle='#FFD700'; ctx.font='bold 44px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText(d.title||'', w/2, 260);
          ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.font='22px "PingFang SC",sans-serif'; if(d.subtitle) ctx.fillText(d.subtitle, w/2, 330);
          ctx.fillStyle='rgba(197,165,90,0.15)'; roundRect(ctx, w/2-180,380,360,150,20); ctx.fill();
          ctx.fillStyle='#FFD700'; ctx.font='bold 38px sans-serif'; if(d.offer) ctx.fillText(d.offer, w/2, 490);
          if(d.cta){ctx.fillStyle='#FFFFFF'; ctx.font='20px "PingFang SC",sans-serif'; ctx.fillText(d.cta, w/2, 570);}
          ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='16px sans-serif'; ctx.fillText(d.store||'', w/2, h-90);
          if (d.qrDataURL) { ctx.drawImage(d.qrDataURL, w/2-45, h-210, 90, 90); }
        }
      },
      {
        key: 'festival', name: '节日活动', desc: '喜庆节日风格',
        style: '节日庆典餐饮海报，红金色喜庆氛围，热烈但不土，适合节庆限时活动。',
        promptNotes: '节庆商业视觉，红金主色，留白足够，重点突出优惠与菜品，不要过度拥挤。',
        colors: { bg1: '#C0392B', bg2: '#8E1B1B', text: '#FFFFFF', accent: '#FFD700' },
        draw: function(ctx, w, h, d) {
          var g = ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,'#C0392B'); g.addColorStop(1,'#8E1B1B');
          ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
          ctx.fillStyle='rgba(255,215,0,0.07)'; ctx.beginPath(); ctx.arc(100,100,150,0,Math.PI*2); ctx.fill();
          ctx.fillStyle='rgba(255,215,0,0.07)'; ctx.beginPath(); ctx.arc(w-100,h-200,180,0,Math.PI*2); ctx.fill();
          ctx.textAlign='center';
          ctx.fillStyle='rgba(255,215,0,0.15)'; ctx.font='bold 56px sans-serif'; ctx.fillText('🎊', w/2, 140);
          ctx.fillStyle='#FFD700'; ctx.font='bold 52px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText(d.title||'', w/2, 270);
          ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.font='26px "PingFang SC",sans-serif'; if(d.subtitle) ctx.fillText(d.subtitle, w/2, 340);
          ctx.fillStyle='rgba(255,255,255,0.12)'; roundRect(ctx, w/2-180,390,360,145,18); ctx.fill();
          ctx.fillStyle='#FFFFFF'; ctx.font='bold 36px sans-serif'; if(d.offer) ctx.fillText(d.offer, w/2, 495);
          if(d.cta){ctx.fillStyle='#FFD700'; ctx.font='22px "PingFang SC",sans-serif'; ctx.fillText(d.cta, w/2, 570);}
          ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='18px sans-serif'; ctx.fillText(d.store||'', w/2, h-90);
          if (d.qrDataURL) { ctx.drawImage(d.qrDataURL, w/2-45, h-210, 90, 90); }
        }
      },
      {
        key: 'new_dish', name: '新品推荐', desc: '清新简洁，突出菜品',
        style: '清新餐饮新品海报，重点突出一道主菜，现代简洁，偏编辑感。',
        promptNotes: '真实产品摄影，食物为主角，背景简洁，文字区清晰，适合新品上市。',
        colors: { bg1: '#0F766E', bg2: '#065F46', text: '#FFFFFF', accent: '#34D399' },
        draw: function(ctx, w, h, d) {
          var g = ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#0F766E'); g.addColorStop(1,'#065F46');
          ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
          ctx.fillStyle='rgba(52,211,153,0.05)'; ctx.beginPath(); ctx.arc(w*0.25,h*0.3,200,0,Math.PI*2); ctx.fill();
          ctx.textAlign='center';
          ctx.fillStyle='rgba(52,211,153,0.2)'; ctx.font='bold 50px sans-serif'; ctx.fillText('✨', w/2, 130);
          ctx.fillStyle='#34D399'; ctx.font='bold 48px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText(d.title||'', w/2, 260);
          ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='24px "PingFang SC",sans-serif'; if(d.subtitle) ctx.fillText(d.subtitle, w/2, 330);
          ctx.fillStyle='rgba(52,211,153,0.12)'; roundRect(ctx, w/2-170,380,340,140,18); ctx.fill();
          ctx.fillStyle='#FFFFFF'; ctx.font='bold 34px sans-serif'; if(d.offer) ctx.fillText(d.offer, w/2, 490);
          if(d.cta){ctx.fillStyle='#34D399'; ctx.font='20px "PingFang SC",sans-serif'; ctx.fillText(d.cta, w/2, 570);}
          ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.font='16px sans-serif'; ctx.fillText(d.store||'', w/2, h-90);
          if (d.qrDataURL) { ctx.drawImage(d.qrDataURL, w/2-45, h-210, 90, 90); }
        }
      }
    ];

    var _selectedPosterTemplate = 'new_welcome';
    var _savedPosterTemplates = [];
    var _growthPublicChannels = [];
    var _posterCanvasW = 540, _posterCanvasH = 720;
    var _editingTemplateKey = '';

    function autoGenCampaignId() {
      var d = new Date();
      var ds = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
      var r = Math.random().toString(36).substring(2,6).toUpperCase();
      return 'CAM' + ds + r;
    }
    function initAutoCampaignId() {
      var el = document.getElementById('poster-campaign');
      if (el && !el.value) el.value = autoGenCampaignId();
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
      ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
      ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
    }

    function renderPosterTemplateSelector() {
      var host = document.getElementById('poster-template-selector');
      if (!host) return;
      host.innerHTML = POSTER_TEMPLATES.map(function(t) {
        var sel = t.key === _selectedPosterTemplate;
        var thumbHtml = '';
        var savedTpl = _savedPosterTemplates.find(function(st) { return st.template_key === t.key; });
        var imgUrl = savedTpl && savedTpl.image_url ? savedTpl.image_url : (t.image_url || '');
        if (imgUrl) thumbHtml = '<img src="' + escapeHtml(imgUrl) + '" style="width:100%;height:60px;object-fit:cover;border-radius:6px;margin-bottom:4px;">';
        return '<button data-click="selectPosterTemplate" data-arg="'+t.key+'" style="padding:8px;border-radius:8px;text-align:left;width:100%;'
          + (sel ? 'background:'+(t.colors?.bg1||'#334155')+';color:#fff;border:2px solid '+(t.colors?.accent||'#a78bfa')+';' : 'background:rgba(255,255,255,0.06);color:rgba(226,232,240,0.7);border:1px solid rgba(255,255,255,0.12);')
          + 'cursor:pointer;font-size:12px;font-weight:'+(sel?'700':'400')+';">'
          + thumbHtml
          + '<span style="font-size:16px;">' + (sel?'◉':'○') + '</span> ' + t.name
          + '<br><span style="font-size:10px;opacity:0.6;">' + t.desc + '</span></button>';
      }).join('');
      renderPosterTemplateBrief();
    }

    function renderPosterTemplateBrief() {
      var host = document.getElementById('poster-template-brief');
      if (!host) return;
      var tpl = POSTER_TEMPLATES.find(function(t) { return t.key === _selectedPosterTemplate; });
      if (!tpl) { host.innerHTML = ''; return; }
      host.innerHTML = '<div style="font-weight:700;color:#fff;margin-bottom:6px;">当前模板：' + escapeHtml(tpl.name || tpl.key || '-') + '</div>'
        + '<div><span style="color:rgba(226,232,240,0.45);">风格：</span>' + escapeHtml(tpl.style || tpl.desc || '-') + '</div>'
        + '<div style="margin-top:4px;"><span style="color:rgba(226,232,240,0.45);">Image2 附加约束：</span>' + escapeHtml(tpl.promptNotes || '无') + '</div>';
    }

    function renderPosterTemplateLibrary() {
      var host = document.getElementById('poster-template-library');
      if (!host) return;
      var allItems = _savedPosterTemplates.slice();
      POSTER_TEMPLATES.forEach(function(pt) {
        if (!allItems.some(function(s) { return s.template_key === pt.key; })) {
          allItems.push({ template_key: pt.key, name: pt.name + ' (系统)', category: '系统', channel: '', aspect_ratio: '',
            image_url: '', style_guide: { style: pt.style || '', prompt_notes: pt.promptNotes || '' },
            _isBuiltin: true, _builtinKey: pt.key });
        }
      });
      host.innerHTML = allItems.length ? allItems.map(function(t) {
        var thumb = t.image_url ? '<img src="' + escapeHtml(t.image_url) + '" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;">' : '';
        var nameLabel = t._isBuiltin ? (t.name || t.template_key) : (t.name || t.template_key || '-');
        var isBuiltin = t._isBuiltin;
        return '<div style="display:flex;gap:6px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">'
          + thumb
          + '<div style="flex:1;min-width:0;color:#fff;font-weight:600;">' + escapeHtml(nameLabel) + '</div>'
          + '<div style="color:rgba(226,232,240,0.4);font-size:10px;margin-right:6px;">' + escapeHtml(t.category || '') + '</div>'
          + '<button data-click="editPosterTemplate" data-arg="' + t.template_key + '" style="padding:2px 6px;border-radius:4px;background:rgba(99,102,241,0.15);color:#a5b4fc;border:none;cursor:pointer;font-size:10px;">编辑</button>'
          + (isBuiltin ? '' : '<button data-click="deletePosterTemplate" data-arg="' + t.id + '" data-arg-type="number" style="padding:2px 6px;border-radius:4px;background:rgba(239,68,68,0.15);color:#fca5a5;border:none;cursor:pointer;font-size:10px;">删除</button>')
          + '</div>';
      }).join('') : '<div style="color:rgba(226,232,240,0.4);padding:8px 0;font-size:11px;">暂无模板</div>';
    }

    function populatePosterStoreSelect() {
      var sel = document.getElementById('poster-store');
      if (!sel) return;
      var cur = sel.value;
      sel.innerHTML = '<option value="">选择门店</option>' + Object.keys(__GROWTH_STORE_MAP).map(function(k) {
        return '<option value="' + k + '">' + escapeHtml(__GROWTH_STORE_MAP[k]) + '</option>';
      }).join('');
      if (cur) sel.value = cur;
      var assetSel = document.getElementById('creative-asset-store');
      if (assetSel) {
        var cur2 = assetSel.value;
        assetSel.innerHTML = '<option value="">选择门店（可选）</option>' + Object.keys(__GROWTH_STORE_MAP).map(function(k) {
          return '<option value="' + k + '">' + escapeHtml(__GROWTH_STORE_MAP[k]) + '</option>';
        }).join('');
        if (cur2) assetSel.value = cur2;
      }
    }

    function renderTagCheckboxes(containerId, tags, selectedArr) {
      var container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = tags.map(function(tag) {
        var checked = selectedArr.indexOf(tag) >= 0 ? 'checked' : '';
        return '<label style="display:flex;align-items:center;gap:3px;padding:3px 8px;border-radius:6px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);cursor:pointer;font-size:11px;color:rgba(226,232,240,0.8);">' +
          '<input type="checkbox" value="' + escapeHtml(tag) + '" ' + checked + ' style="margin:0;width:14px;height:14px;accent-color:#6366f1;">' +
          escapeHtml(tag) + '</label>';
      }).join('');
    }
    function getCheckedValues(containerId) {
      var checks = document.querySelectorAll('#' + containerId + ' input[type=checkbox]:checked');
      return Array.from(checks).map(function(c) { return c.value; });
    }
    function populateTemplateFormSelects() {
      renderTagCheckboxes('poster-template-category-checkboxes', __TEMPLATE_CATEGORY_OPTIONS, []);
      renderTagCheckboxes('poster-template-channel-checkboxes', __TEMPLATE_CHANNEL_OPTIONS, []);
      function fillSelect(id, options) {
        var el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="">请选择</option>' + options.map(function(o) { return '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + '</option>'; }).join('');
      }
      fillSelect('poster-template-aspect-input', __TEMPLATE_ASPECT_OPTIONS);
    }
    function populatePosterGenStylePrompt() {
      function fillSelect(id, options, label) {
        var el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="">' + label + '</option>' + options.map(function(o) { return '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + '</option>'; }).join('');
      }
      fillSelect('poster-gen-style-select', __TEMPLATE_STYLE_OPTIONS, '选择视觉风格（从模板继承）');
      fillSelect('poster-gen-prompt-select', __TEMPLATE_PROMPT_OPTIONS, '选择排版约束（从模板继承）');
    }

    function resetTemplateForm() {
      _editingTemplateKey = '';
        ['poster-template-key-input','poster-template-name-input','poster-template-aspect-input','poster-template-image-url'].forEach(function(id) {
         var el = document.getElementById(id);
         if (el) el.value = '';
       });
       renderTagCheckboxes('poster-template-category-checkboxes', __TEMPLATE_CATEGORY_OPTIONS, []);
       renderTagCheckboxes('poster-template-channel-checkboxes', __TEMPLATE_CHANNEL_OPTIONS, []);
       document.getElementById('poster-template-image-preview').style.display = 'none';
    }

     function editPosterTemplate(key) {
       var t = _savedPosterTemplates.find(function(st) { return st.template_key === key; });
       if (!t) {
         var builtin = POSTER_TEMPLATES.find(function(pt) { return pt.key === key; });
         if (!builtin) return;
         t = { template_key: builtin.key, name: builtin.name, category: '系统', channel: '',
           aspect_ratio: '', image_url: '', style_guide: { style: builtin.style || builtin.desc || '',
           prompt_notes: builtin.promptNotes || '' } };
       }
        _editingTemplateKey = key;
        setField('poster-template-key-input', t.template_key || '');
        setField('poster-template-name-input', t.name || '');
        renderTagCheckboxes('poster-template-category-checkboxes', __TEMPLATE_CATEGORY_OPTIONS, (t.category || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean));
        renderTagCheckboxes('poster-template-channel-checkboxes', __TEMPLATE_CHANNEL_OPTIONS, (t.channel || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean));
        setField('poster-template-aspect-input', t.aspect_ratio || '');
        setField('poster-template-image-url', t.image_url || '');
       var previewEl = document.getElementById('poster-template-image-preview');
       var previewImg = document.getElementById('poster-template-image-preview-img');
       if (previewEl && previewImg && t.image_url) {
         previewImg.src = t.image_url;
         previewEl.style.display = 'block';
       } else if (previewEl) {
         previewEl.style.display = 'none';
       }
       showNotification('已加载模板「' + t.name + '」到编辑区，修改后保存即可更新', 'info');
     }

    function deletePosterTemplate(id) {
      if (!confirm('确认删除此模板？')) return;
      fetch('/api/growth/poster-templates/' + id, {
        method: 'DELETE',
        headers: growthAuthHeaders()
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) { showNotification('模板已删除', 'success'); loadPosterTemplates(); }
        else { showNotification('删除失败：' + (d.error || ''), 'error'); }
      }).catch(function(e) { showNotification('删除失败：' + (e.message || e), 'error'); });
    }

    async function loadPosterTemplates() {
      renderPosterTemplateSelector();
      try {
        var r = await fetch('/api/growth/poster-templates', { headers: growthAuthHeaders() });
        var d = await r.json();
        _savedPosterTemplates = d?.templates || [];
        _savedPosterTemplates.forEach(function(saved) {
          var local = POSTER_TEMPLATES.find(function(t) { return t.key === saved.template_key; });
          if (!local) {
            local = {
              key: saved.template_key,
              name: saved.name || saved.template_key,
              desc: [saved.category, saved.channel].filter(Boolean).join(' · ') || '自定义模板',
              style: saved?.style_guide?.style || '自定义海报风格',
              promptNotes: saved?.style_guide?.prompt_notes || '遵循模板风格描述，保留清晰文本区。',
              colors: { bg1: '#334155', bg2: '#0f172a', text: '#FFFFFF', accent: '#a78bfa' },
              draw: function(ctx, w, h, d2) {
                var g = ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#334155'); g.addColorStop(1,'#0f172a');
                ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
                ctx.textAlign='left';
                ctx.fillStyle='#ffffff'; ctx.font='bold 46px "PingFang SC","Microsoft YaHei",sans-serif'; if(d2.title) ctx.fillText(d2.title, 48, 140);
                ctx.fillStyle='rgba(255,255,255,0.82)'; ctx.font='24px "PingFang SC",sans-serif'; if(d2.subtitle) ctx.fillText(d2.subtitle, 48, 190);
                ctx.fillStyle='rgba(255,255,255,0.12)'; roundRect(ctx, 48, 250, w - 96, 120, 16); ctx.fill();
                ctx.fillStyle='#a78bfa'; ctx.font='bold 34px sans-serif'; if(d2.offer) ctx.fillText(d2.offer, 48, 320);
                ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='18px sans-serif'; ctx.fillText(d2.store || '', 48, h - 60);
              }
            };
            POSTER_TEMPLATES.push(local);
          }
          if (saved.name) local.name = saved.name;
          local.desc = [saved.category, saved.channel].filter(Boolean).join(' · ') || local.desc;
          if (saved.style_guide && typeof saved.style_guide === 'object') {
            if (saved.style_guide.style) local.style = saved.style_guide.style;
            if (saved.style_guide.prompt_notes) local.promptNotes = saved.style_guide.prompt_notes;
          }
          if (saved.image_url) local.image_url = saved.image_url;
        });
      } catch (e) {
        _savedPosterTemplates = [];
      }
      renderPosterTemplateSelector();
      renderPosterTemplateLibrary();
    }

    function selectPosterTemplate(key) {
      _selectedPosterTemplate = key;
      renderPosterTemplateSelector();
      var tpl = POSTER_TEMPLATES.find(function(t) { return t.key === key; });
      if (tpl) {
        setField('poster-gen-style-select', tpl.style || '');
        setField('poster-gen-prompt-select', tpl.promptNotes || '');
      }
    }

    function getPosterEditorData() {
      var storeEl = document.getElementById('poster-store');
      return {
        title: document.getElementById('poster-title')?.value || '',
        subtitle: document.getElementById('poster-subtitle')?.value || '',
        offer: document.getElementById('poster-offer')?.value || '',
        cta: document.getElementById('poster-cta')?.value || '',
        price: document.getElementById('poster-price')?.value || '',
        size: document.getElementById('poster-size')?.value || '',
        clarity: document.getElementById('poster-clarity')?.value || '',
        format: document.getElementById('poster-format')?.value || '',
        store: storeEl ? storeEl.options[storeEl.selectedIndex]?.text || storeEl.value || '' : '',
        storeId: storeEl?.value || '',
        campaignId: document.getElementById('poster-campaign')?.value || '',
        couponId: document.getElementById('poster-coupon')?.value || '',
        publicChannelKey: document.getElementById('poster-public-channel')?.value || '',
        publicDate: document.getElementById('poster-public-date')?.value || '',
        privateChannel: document.getElementById('poster-private-channel')?.value || 'wecom',
        finalImageUrl: document.getElementById('poster-final-image-url')?.value || '',
        image2Prompt: document.getElementById('poster-image2-prompt')?.value || '',
        keywords: document.getElementById('poster-keywords')?.value || ''
      };
    }

    function buildPosterCopyText(editor) {
      var parts = [editor.title, editor.subtitle, editor.offer, editor.price].filter(Boolean);
      if (editor.cta) parts.push(editor.cta);
      return parts.join('｜');
    }

    async function ensurePosterSavedForFlow() {
      var editor = getPosterEditorData();
      if (!editor.finalImageUrl) {
        showNotification('请先上传成图', 'warning');
        return null;
      }
      var purposes = getCheckedValues('poster-gen-purposes');
      var channels = getCheckedValues('poster-gen-channels');
      if (!purposes.length) {
        showNotification('请至少选择一个营销用途', 'warning');
        return null;
      }
      if (!channels.length) {
        showNotification('请至少选择一个投放渠道', 'warning');
        return null;
      }
      var title = editor.title || '海报';
      var payload = {
        poster_key: 'poster_' + Date.now(),
        campaign_id: editor.campaignId || undefined,
        title: title,
        store_id: editor.storeId || '',
        template_key: _selectedPosterTemplate,
        subtitle: editor.subtitle || '',
        cta: editor.cta || '',
        purposes: getCheckedValues('poster-gen-purposes'),
        channels: getCheckedValues('poster-gen-channels'),
        status: 'generated',
        image_url: editor.finalImageUrl,
        output_url: editor.finalImageUrl,
        meta: {
          template: _selectedPosterTemplate,
          image2_prompt: editor.image2Prompt,
          offer: editor.offer,
          price: editor.price,
          size: editor.size,
          clarity: editor.clarity,
          format: editor.format,
          coupon_id: editor.couponId,
          keywords: editor.keywords
        }
      };
      var r = await fetch('/api/growth/generated-posters', {
        method: 'POST',
        headers: growthAuthHeaders(),
        body: JSON.stringify(payload)
      });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'save_failed');
      loadPosterHistory();
      return d.poster;
    }

    async function generatePosterCopy() {
       var titleEl = document.getElementById('poster-title');
       var offerEl = document.getElementById('poster-offer');
       if (!titleEl?.value && !offerEl?.value) { showNotification('请先填写标题或优惠信息', 'warning'); return; }
       try {
         var storeEl = document.getElementById('poster-store');
         var storeName = storeEl ? (storeEl.options[storeEl.selectedIndex]?.text || storeEl.value || '') : '';
         var resp = await fetch('/api/growth/generate-selling-point', {
           method: 'POST',
           headers: growthAuthHeaders(),
           body: JSON.stringify({ title: titleEl?.value || '', offer: offerEl?.value || '', store: storeName })
         });
         var data = await resp.json();
          var sellPoint = data?.selling_point || '限时优惠，到店即享';
          var subEl = document.getElementById('poster-subtitle');
          if (subEl) subEl.value = sellPoint.slice(0, 24);
          showNotification('引流卖点已生成到副标题', 'success');
       } catch (e) {
         showNotification('生成失败：' + (e?.message || e), 'error');
       }
     }

     function generatePosterImagePrompt() {
        var tpl = POSTER_TEMPLATES.find(function(t) { return t.key === _selectedPosterTemplate; });
        if (!tpl) { showNotification('请先选择模板', 'warning'); return; }
        var editor = getPosterEditorData();
        if (!editor.title && !editor.offer) { showNotification('请先填写标题或优惠信息', 'warning'); return; }
        var styleVal = document.getElementById('poster-gen-style-select')?.value || tpl.style || tpl.desc || '';
        var promptVal = document.getElementById('poster-gen-prompt-select')?.value || tpl.promptNotes || 'clear hierarchy, enough empty space for Chinese copy, commercial ad quality.';
        var aspectRatio = ((_savedPosterTemplates.find(function(t) { return t.template_key === _selectedPosterTemplate; }) || {}).aspect_ratio) || '3:4';
        var prompt = [
          'Create a premium restaurant marketing poster image for GPT Image 2.',
          'Use this visual style: ' + styleVal,
          'Follow these composition constraints: ' + promptVal,
          'Aspect ratio: ' + aspectRatio + '.',
         '',
         '## Typography & Font Specifications (critical for Chinese poster)',
         'Font family — Headline: bold modern Chinese sans-serif (思源黑体 / Source Han Sans SC / Noto Sans SC), weight 700–900.',
         'Font family — Subtitle / body: lighter Chinese sans-serif (思源黑体 Light / Noto Sans SC Light), weight 300–400.',
         'Font family — Offer / price: bold condensed Chinese font or medium weight, clearly differentiated from headline.',
         'Font family — CTA button text: medium weight Chinese, enclosed in a rounded pill-shaped button.',
         'Letter spacing (字间距): normal for headlines, +0.02em to +0.05em for subtitle/body for readability.',
         'Line height (行距): 1.3x to 1.5x for multi-line Chinese text, avoid crowding.',
         'Text alignment: center-aligned for headline + offer block; left-aligned if the template style specifies editorial/magazine feel.',
         'Hierarchy order (top to bottom): headline → subtitle → offer/price block → CTA button → brand/store name at bottom.',
         'Typography must be razor-sharp, no blurry or broken Chinese characters. All text must be perfectly rendered Chinese.',
         'Leave generous negative space around each text block — do not overlap text with decorative elements or food imagery.',
         'Keep at least 15% of the poster as clean margin around the edges. Do not let text touch the borders.',
         'If the poster has a food photo, place it as a background or side hero — text must remain fully readable over or beside it.',
         'No mockup frame, no watermark, no random English text, no collage, no low-quality stock look, no cartoon style.',
         '',
          '## Content to include (all text to be rendered on the poster image)',
          'Main headline in Chinese: ' + (editor.title || '未填写标题') + '.',
          'Subtitle in Chinese: ' + (editor.subtitle || '未填写副标题') + '.',
          'Offer copy in Chinese: ' + (editor.offer || '未填写优惠信息') + '.',
          (editor.price ? 'Displayed price in Chinese: ' + editor.price + '.' : ''),
          'CTA button copy (inside rounded button shape): ' + (editor.cta || '不显示CTA按钮') + '.',
          (editor.store ? 'Brand/store name in Chinese at bottom: ' + editor.store + '.' : ''),
          (editor.keywords ? 'Extra scene / mood / product cues: ' + editor.keywords + '.' : ''),
          '',
          '## Image generation parameters (do NOT render these as text on the poster)',
          (editor.size ? 'Canvas/output resolution: ' + editor.size + ' pixels.' : ''),
          (editor.clarity ? 'Image quality/clarity: ' + editor.clarity + '.' : 'Image quality: high-definition commercial grade.'),
          (editor.format ? 'Output format: ' + editor.format + '.' : '')
       ].filter(Boolean).join('\n');
      var out = document.getElementById('poster-image2-prompt');
      if (out) out.value = prompt;
      showNotification('Image2 提示词已生成', 'success');
    }

    async function saveGeneratedPoster() {
      try {
        await ensurePosterSavedForFlow();
        showNotification('海报已保存', 'success');
      } catch (e) {
        showNotification('保存失败：' + (e?.message || e), 'error');
      }
    }

    async function createPosterPrivateFlow() {
      try {
        var editor = getPosterEditorData();
        if (!editor.campaignId) { showNotification('请先填写活动ID', 'warning'); return; }
        var savedPoster = await ensurePosterSavedForFlow();
        var actionType = editor.couponId || editor.offer ? 'send_voucher' : 'send_message';
        var copyText = buildPosterCopyText(editor);
        var r = await fetch('/api/growth/actions', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify({
            action_key: 'poster_private_' + Date.now(),
            action_type: actionType,
            status: 'proposed',
            store_id: editor.storeId || '',
            campaign_id: editor.campaignId || '',
            title: (editor.title || '海报') + ' 私域触达',
            detail: copyText,
            payload: {
              channel: editor.privateChannel || 'wecom',
              campaign_id: editor.campaignId || '',
              coupon_id: editor.couponId || '',
              poster_key: savedPoster?.poster_key || '',
              poster_url: savedPoster?.output_url || editor.finalImageUrl,
              content_template: copyText,
              title_template: editor.title || '海报触达',
              store_id: editor.storeId || ''
            },
            created_by: 'poster_workflow'
          })
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error || 'create_action_failed');
        showNotification('已进入私域链路，可到 AI建议执行 中批准执行', 'success');
        showGrowthTab('actions');
      } catch (e) {
        showNotification('进入私域链路失败：' + (e?.message || e), 'error');
      }
    }

    async function createPosterPublicFlow() {
      try {
        var editor = getPosterEditorData();
        if (!editor.publicChannelKey) { showNotification('请先选择公域渠道', 'warning'); return; }
        var savedPoster = await ensurePosterSavedForFlow();
        var copyText = buildPosterCopyText(editor);
        var itemId = 'poster_calendar_' + Date.now();
        var taskKey = 'poster_public_' + Date.now();
        var channel = _growthPublicChannels.find(function(ch) { return ch.channel_key === editor.publicChannelKey; });
        var channelName = channel ? (channel.name || channel.channel_key || '') : editor.publicChannelKey;
        var calendarRes = await fetch('/api/growth/content-calendar', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify({
            item_id: itemId,
            store_id: editor.storeId || '',
            channel: channelName || editor.publicChannelKey,
            publish_date: editor.publicDate || '',
            title: editor.title || '海报发布',
            content_brief: editor.subtitle || editor.offer || '',
            copy_text: copyText,
            image_url: savedPoster?.output_url || editor.finalImageUrl,
            campaign_id: editor.campaignId || '',
            status: 'planned'
          })
        });
        var calendarData = await calendarRes.json();
        if (!calendarData.ok) throw new Error(calendarData.error || 'calendar_failed');
        var taskRes = await fetch('/api/growth/public-promo-tasks', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify({
            task_key: taskKey,
            title: (editor.title || '海报') + ' 公域发布',
            channel_key: editor.publicChannelKey,
            store_id: editor.storeId || '',
            campaign_id: editor.campaignId || '',
            due_at: editor.publicDate || '',
            content_brief: editor.subtitle || editor.offer || '',
            copy_text: copyText,
            poster_url: savedPoster?.output_url || editor.finalImageUrl,
            status: 'planned'
          })
        });
        var taskData = await taskRes.json();
        if (!taskData.ok) throw new Error(taskData.error || 'task_failed');
        showNotification('已进入公域链路：已排期并自动入任务池', 'success');
        showGrowthTab('public');
      } catch (e) {
        showNotification('进入公域链路失败：' + (e?.message || e), 'error');
      }
    }

    async function loadPosterHistory() {
      try {
            var r = await fetch('/api/growth/generated-posters?status=generated', { headers: growthAuthHeaders() });
            var d = await r.json();
            var posters = d?.posters || [];
            var host = document.getElementById('poster-history-list');
            if (!host) return;
            host.innerHTML = posters.length ? '<div style="grid-column:1/-1;font-size:11px;color:rgba(226,232,240,0.4);margin-bottom:4px;">共 ' + posters.length + ' 张</div>' + posters.slice(0, 30).map(function(p) {
              return '<div style="border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;cursor:pointer;position:relative;" data-click="open" data-arg="' + (p.output_url || '#') + '">'
                + (p.id ? '<button onclick="event.stopPropagation();deleteGeneratedPoster(' + p.id + ')" style="position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:6px;background:rgba(0,0,0,0.5);color:#fca5a5;border:none;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;z-index:2;">✕</button>' : '')
                + '<div style="aspect-ratio:3/4;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;overflow:hidden;">'
                + (p.output_url ? '<img src="' + p.output_url + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;">' : '<span style="color:rgba(226,232,240,0.3);font-size:11px;">无预览</span>')
                + '</div><div style="padding:6px;font-size:11px;color:rgba(226,232,240,0.6);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">'
                + (p.title || '-') + '</div></div>';
            }).join('') : '<div style="color:rgba(226,232,240,0.4);grid-column:1/-1;padding:20px;">暂无已生成海报</div>';
      } catch (e) { /* ignore */ }
    }

    function deleteGeneratedPoster(id) {
      if (!confirm('确认删除此海报？')) return;
      fetch('/api/growth/generated-posters/' + id, { method: 'DELETE', headers: growthAuthHeaders() }).then(function(r){return r.json();}).then(function(d){
        if(d.ok){showNotification('海报已删除','success');loadPosterHistory();}else{showNotification('删除失败','error');}
      }).catch(function(e){showNotification('删除失败:'+e.message,'error');});
    }

    // ════════════════════════════════════════════════
    // Phase 8: 公域品宣管理
    // ════════════════════════════════════════════════

    function renderPublicChannelSelectOptions() {
      var options = '<option value="">选择渠道</option>' + _growthPublicChannels.map(function(ch) {
        var label = [ch.name, ch.platform].filter(Boolean).join(' · ');
        return '<option value="' + escapeHtml(ch.channel_key || '') + '">' + escapeHtml(label || (ch.channel_key || '-')) + '</option>';
      }).join('');
      ['public-task-channel', 'public-calendar-channel', 'poster-public-channel'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = options;
      });
    }

    function refreshPublicContentWorkspace() {
      loadPublicChannels();
      loadPublicTasks();
      loadChannelEffects();
      loadContentCalendar();
    }

    async function loadPublicChannels() {
      try {
        var r = await fetch('/api/growth/public-channels', { headers: growthAuthHeaders() });
        var d = await r.json();
        _growthPublicChannels = d?.channels || [];
        renderPublicChannelSelectOptions();
        var host = document.getElementById('public-channels-list');
        if (!host) return;
        host.innerHTML = _growthPublicChannels.length ? _growthPublicChannels.map(function(ch) {
          return '<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">'
            + '<div style="color:#fff;font-weight:700;">' + escapeHtml(ch.name || ch.channel_key || '-') + '</div>'
            + '<div style="margin-top:4px;color:rgba(226,232,240,0.55);">' + escapeHtml([ch.channel_key, ch.platform, growthStoreName(ch.store_id || ''), ch.owner_username].filter(Boolean).join(' · ')) + '</div>'
            + '</div>';
        }).join('') : '<div style="color:rgba(226,232,240,0.4);padding:10px 0;">暂无渠道台账</div>';
      } catch (e) {
        document.getElementById('public-channels-list').innerHTML = '<div style="color:#ef4444;font-size:12px;">渠道加载失败</div>';
      }
    }

    async function savePublicChannel() {
      var payload = {
        channel_key: document.getElementById('public-channel-key')?.value || '',
        name: document.getElementById('public-channel-name')?.value || '',
        platform: document.getElementById('public-channel-platform')?.value || '',
        store_id: document.getElementById('public-channel-store')?.value || '',
        owner_username: document.getElementById('public-channel-owner')?.value || ''
      };
      if (!payload.channel_key || !payload.name || !payload.platform) {
        showNotification('请完整填写渠道键、名称、平台', 'warning');
        return;
      }
      try {
        var r = await fetch('/api/growth/public-channels', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error || 'save_failed');
        showNotification('渠道已保存', 'success');
        loadPublicChannels();
      } catch (e) {
        showNotification('保存渠道失败：' + (e?.message || e), 'error');
      }
    }

    async function loadPublicTasks() {
      try {
        var r = await fetch('/api/growth/public-promo-tasks', { headers: growthAuthHeaders() });
        var d = await r.json();
        var tasks = d?.tasks || [];
        var host = document.getElementById('public-tasks-list');
        if (!host) return;
        host.innerHTML = tasks.length ? tasks.map(function(t) {
          var statusColor = t.status === 'published' ? '#22c55e' : t.status === 'planned' ? '#f59e0b' : '#94a3b8';
          var copyText = escapeHtml(String(t.copy_text || '').replace(/'/g, '&#39;'));
          var posterUrl = escapeHtml(String(t.poster_url || ''));
          return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">'
            + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">'
            + '<div style="color:#fff;font-weight:600;">' + (t.title || '-').slice(0, 40) + '</div>'
            + '<span style="font-size:10px;padding:2px 6px;border-radius:999px;background:' + statusColor + '22;color:' + statusColor + ';">' + escapeHtml(growthStatusLabel(t.status || '-')) + '</span>'
            + '</div>'
            + '<div style="color:rgba(226,232,240,0.5);margin-top:3px;">' + escapeHtml(growthChannelLabel(t.channel_key || '-')) + (t.store_id ? ' · ' + escapeHtml(growthStoreName(t.store_id)) : '') + '</div>'
            + (t.content_brief ? '<div style="color:rgba(226,232,240,0.42);margin-top:4px;line-height:1.5;">' + escapeHtml(String(t.content_brief).slice(0, 56)) + '</div>' : '')
            + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">'
            + '<button onclick="copyPublicTaskText(' + JSON.stringify(String(t.copy_text || '')) + ')" style="padding:4px 8px;border:none;border-radius:6px;background:rgba(99,102,241,0.18);color:#c4b5fd;cursor:pointer;font-size:11px;">复制文案</button>'
            + (t.poster_url ? '<button onclick="window.open(' + JSON.stringify(String(t.poster_url)) + ')" style="padding:4px 8px;border:none;border-radius:6px;background:rgba(14,165,233,0.18);color:#7dd3fc;cursor:pointer;font-size:11px;">打开海报</button>' : '')
            + '</div>'
            + '</div>';
        }).join('') : '<div style="color:rgba(226,232,240,0.4);padding:16px;">暂无品宣任务</div>';
      } catch (e) { /* ignore */ }
    }

    async function copyPublicTaskText(text) {
      try {
        await navigator.clipboard.writeText(String(text || ''));
        showNotification('文案已复制，可直接去平台发布', 'success');
      } catch (e) {
        showNotification('复制失败，请手动复制', 'warning');
      }
    }

    async function savePublicTask() {
      var payload = {
        task_key: 'public_task_' + Date.now(),
        title: document.getElementById('public-task-title')?.value || '',
        channel_key: document.getElementById('public-task-channel')?.value || '',
        store_id: document.getElementById('public-task-store')?.value || '',
        campaign_id: document.getElementById('public-task-campaign')?.value || '',
        due_at: document.getElementById('public-task-due')?.value || '',
        content_brief: document.getElementById('public-task-brief')?.value || '',
        copy_text: document.getElementById('public-task-brief')?.value || '',
        status: 'planned'
      };
      if (!payload.title || !payload.channel_key) {
        showNotification('请至少填写任务标题和渠道', 'warning');
        return;
      }
      try {
        var r = await fetch('/api/growth/public-promo-tasks', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error || 'save_failed');
        showNotification('品宣任务已创建', 'success');
        loadPublicTasks();
      } catch (e) {
        showNotification('创建任务失败：' + (e?.message || e), 'error');
      }
    }

    async function loadChannelEffects() {
      try {
        var r = await fetch('/api/growth/channel-effects', { headers: growthAuthHeaders() });
        var d = await r.json();
        var effects = d?.effects || d?.rows || [];
        var host = document.getElementById('public-channel-effects');
        if (!host) return;
        host.innerHTML = effects.length ? effects.map(function(e) {
          return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">'
            + '<div style="color:#fff;font-weight:600;">' + (e.channel || e.platform || '-') + '</div>'
            + '<div style="color:rgba(226,232,240,0.5);margin-top:3px;">发布' + (e.published || e.publish_count || e.total_items || 0) + ' / 总计划' + (e.total_items || e.total || 0) + ' · 扫码' + (e.total_scans || e.scan_count || 0) + ' · 收入¥' + ((e.total_revenue_fen || e.revenue_fen || 0)/100).toFixed(0) + '</div>'
            + '</div>';
        }).join('') : '<div style="color:rgba(226,232,240,0.4);padding:16px;">暂无渠道数据</div>';
      } catch (e) { /* ignore */ }
    }

    async function loadContentCalendar() {
      try {
        var r = await fetch('/api/growth/content-calendar/upcoming', { headers: growthAuthHeaders() });
        var d = await r.json();
        var items = d?.items || d?.rows || [];
        var host = document.getElementById('public-calendar-list');
        if (!host) return;
        host.innerHTML = items.length ? items.map(function(i) {
          var dateStr = i.publish_date ? String(i.publish_date).slice(0, 10) : '-';
          return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">'
            + '<div style="color:#fff;font-weight:600;">' + (i.title || '-').slice(0, 40) + '</div>'
            + '<div style="color:rgba(226,232,240,0.5);margin-top:3px;">' + dateStr + ' · ' + escapeHtml(growthChannelLabel(i.channel || '')) + (i.store_id ? ' · ' + escapeHtml(growthStoreName(i.store_id)) : '') + '</div>'
            + (i.content_brief ? '<div style="color:rgba(226,232,240,0.42);margin-top:4px;line-height:1.5;">' + escapeHtml(String(i.content_brief).slice(0, 56)) + '</div>' : '')
            + '</div>';
        }).join('') : '<div style="color:rgba(226,232,240,0.4);padding:16px;">暂无内容计划</div>';
      } catch (e) { /* ignore */ }
    }

    async function saveContentCalendarItem() {
      var title = document.getElementById('public-calendar-title')?.value || '';
      var brief = document.getElementById('public-calendar-brief')?.value || '';
      var channel = document.getElementById('public-calendar-channel')?.value || '';
      if (!title || !channel) {
        showNotification('请至少填写内容标题和渠道', 'warning');
        return;
      }
      try {
        var r = await fetch('/api/growth/content-calendar', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify({
            item_id: document.getElementById('public-calendar-item-id')?.value || ('calendar_' + Date.now()),
            title: title,
            publish_date: document.getElementById('public-calendar-date')?.value || '',
            channel: channel,
            store_id: document.getElementById('public-calendar-store')?.value || '',
            campaign_id: document.getElementById('public-calendar-campaign')?.value || '',
            content_brief: brief,
            copy_text: brief,
            status: 'draft'
          })
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error || 'save_failed');
        showNotification('内容日历已保存', 'success');
        loadContentCalendar();
        loadChannelEffects();
      } catch (e) {
        showNotification('保存日历失败：' + (e?.message || e), 'error');
      }
    }

    async function loadCreativeAssets() {
      try {
        var r = await fetch('/api/growth/creative-assets', { headers: growthAuthHeaders() });
        var d = await r.json();
         var assets = d?.assets || [];
         var host = document.getElementById('creative-assets-list');
         if (!host) return;
         host.innerHTML = assets.length ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;">' + assets.map(function(a) {
           var thumb = a.url ? '<img src="' + escapeHtml(a.url) + '" loading="lazy" style="width:100%;height:80px;object-fit:cover;border-radius:6px;display:block;">' : '<div style="width:100%;height:80px;background:rgba(255,255,255,0.04);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;color:rgba(226,232,240,0.2);">🖼</div>';
           return '<div style="position:relative;border:1px solid rgba(255,255,255,0.06);border-radius:8px;overflow:hidden;">'
             + thumb
             + '<div style="padding:4px 6px;font-size:10px;color:rgba(226,232,240,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(a.name || '-') + '</div>'
             + '<button data-click="deleteCreativeAsset" data-arg="' + a.id + '" data-arg-type="number" style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:4px;background:rgba(0,0,0,0.5);color:#fca5a5;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">✕</button>'
             + '</div>';
         }).join('') + '</div>' : '<div style="color:rgba(226,232,240,0.4);padding:10px 0;font-size:12px;">暂无素材</div>';
      } catch (e) {
        document.getElementById('creative-assets-list').innerHTML = '<div style="color:#ef4444;font-size:12px;">素材加载失败</div>';
      }
    }

    async function saveCreativeAsset() {
      var payload = {
        asset_key: document.getElementById('creative-asset-key')?.value || ('asset_' + Date.now()),
        name: document.getElementById('creative-asset-name')?.value || '',
        asset_type: document.getElementById('creative-asset-type')?.value || '',
        store_id: document.getElementById('creative-asset-store')?.value || '',
        url: document.getElementById('creative-asset-url')?.value || '',
        tags: growthCsvList('creative-asset-tags')
      };
      if (!payload.name || !payload.asset_type) {
        showNotification('请至少填写素材名称和类型', 'warning');
        return;
      }
      try {
        var r = await fetch('/api/growth/creative-assets', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error || 'save_failed');
        showNotification('创意素材已保存', 'success');
        loadCreativeAssets();
      } catch (e) {
        showNotification('保存素材失败：' + (e?.message || e), 'error');
      }
    }

     async function savePosterTemplateMeta() {
        var payload = {
          template_key: document.getElementById('poster-template-key-input')?.value || '',
          name: document.getElementById('poster-template-name-input')?.value || '',
          category: getCheckedValues('poster-template-category-checkboxes').join(','),
          channel: getCheckedValues('poster-template-channel-checkboxes').join(','),
          aspect_ratio: document.getElementById('poster-template-aspect-input')?.value || '',
          image_url: document.getElementById('poster-template-image-url')?.value || '',
          layout: {},
          style_guide: {}
        };
      if (!payload.template_key || !payload.name) {
        showNotification('请至少填写模板键和名称', 'warning');
        return;
      }
      try {
        var r = await fetch('/api/growth/poster-templates', {
          method: 'POST',
          headers: growthAuthHeaders(),
          body: JSON.stringify(payload)
        });
        var d = await r.json();
        if (!d.ok) throw new Error(d.error || 'save_failed');
        showNotification('模板已保存', 'success');
        loadPosterTemplates();
      } catch (e) {
        showNotification('保存模板失败：' + (e?.message || e), 'error');
      }
    }

    function copyImage2Prompt() {
      var el = document.getElementById('poster-image2-prompt');
      if (!el || !el.value) { showNotification('没有可复制的提示词', 'warning'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.value).then(function() { showNotification('提示词已复制到剪贴板', 'success'); });
      } else {
        el.select(); el.setSelectionRange(0, el.value.length);
        document.execCommand('copy'); showNotification('提示词已复制到剪贴板', 'success');
      }
    }

    function deleteCreativeAsset(id) {
      if (!confirm('确认删除此素材？')) return;
      fetch('/api/growth/creative-assets/' + id, {
        method: 'DELETE',
        headers: growthAuthHeaders()
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) { showNotification('素材已删除', 'success'); loadCreativeAssets(); }
        else { showNotification('删除失败：' + (d.error || ''), 'error'); }
      }).catch(function(e) { showNotification('删除失败：' + (e.message || e), 'error'); });
    }

    function resetAssetForm() {
      ['creative-asset-key','creative-asset-name','creative-asset-url','creative-asset-tags'].forEach(function(id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      var typeEl = document.getElementById('creative-asset-type'); if (typeEl) typeEl.value = '';
      var storeEl = document.getElementById('creative-asset-store'); if (storeEl) storeEl.value = '';
      document.getElementById('creative-asset-upload-preview').style.display = 'none';
    }

    function setField(id, val) {
      var el = document.getElementById(id); if (el) el.value = val;
    }

    async function uploadFile(file) {
      var fd = new FormData(); fd.append('file', file);
      var r = await fetch('/api/growth/upload', { method: 'POST', headers: growthAuthHeaders(true), body: fd });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || 'upload_failed');
      var host = window.location.protocol + '//' + window.location.host;
      return host + d.url;
    }

    function uploadPosterImage(event) {
      var file = event.target?.files?.[0]; if (!file) return;
      var previewEl = document.getElementById('poster-upload-preview');
      var previewImg = document.getElementById('poster-upload-preview-img');
      var reader = new FileReader();
      reader.onload = function(e) { if (previewImg) previewImg.src = e.target.result; if (previewEl) previewEl.style.display = 'block'; };
      reader.readAsDataURL(file);
      uploadFile(file).then(function(url) {
        document.getElementById('poster-final-image-url').value = url;
        showNotification('海报已上传，URL已填充', 'success');
      }).catch(function(e) { showNotification('上传失败：' + (e.message || e), 'error'); });
    }

    function uploadTemplateImage(event) {
      var file = event.target?.files?.[0]; if (!file) return;
      var previewEl = document.getElementById('poster-template-image-preview');
      var previewImg = document.getElementById('poster-template-image-preview-img');
      var reader = new FileReader();
      reader.onload = function(e) { if (previewImg) previewImg.src = e.target.result; if (previewEl) previewEl.style.display = 'block'; };
      reader.readAsDataURL(file);
      uploadFile(file).then(function(url) {
        document.getElementById('poster-template-image-url').value = url;
        showNotification('模板缩略图已上传', 'success');
      }).catch(function(e) { showNotification('上传失败：' + (e.message || e), 'error'); });
    }

     function uploadAssetFile(event) {
       var file = event.target?.files?.[0]; if (!file) return;
       var previewEl = document.getElementById('creative-asset-upload-preview');
       var previewImg = document.getElementById('creative-asset-upload-preview-img');
       var reader = new FileReader();
       reader.onload = function(e) { if (previewImg) previewImg.src = e.target.result; if (previewEl) previewEl.style.display = 'block'; };
       reader.readAsDataURL(file);
       uploadFile(file).then(function(url) {
         document.getElementById('creative-asset-url').value = url;
         showNotification('素材文件已上传', 'success');
       }).catch(function(e) { showNotification('上传失败：' + (e.message || e), 'error'); });
     }

     function uploadAssetFiles(event) {
       var files = event.target?.files; if (!files || !files.length) return;
       var nameBase = document.getElementById('creative-asset-name')?.value || '素材';
       var assetType = document.getElementById('creative-asset-type')?.value || 'other';
       var storeId = document.getElementById('creative-asset-store')?.value || '';
       var tagsInput = document.getElementById('creative-asset-tags')?.value || '';
       var countEl = document.getElementById('creative-asset-upload-count');
       var total = files.length;
       var done = 0;
       if (countEl) countEl.textContent = '0/' + total + ' 上传中...';
       var uploadOne = function(idx) {
         if (idx >= total) {
           if (countEl) countEl.textContent = total + '/' + total + ' 全部完成';
           loadCreativeAssets();
           showNotification('全部 ' + total + ' 个素材上传完成', 'success');
           return;
         }
         var file = files[idx];
         var name = nameBase;
         if (total > 1) name = nameBase + '_' + (idx + 1);
         uploadFile(file).then(function(url) {
           var payload = {
             asset_key: 'asset_' + Date.now() + '_' + idx,
             name: name,
             asset_type: assetType,
             store_id: storeId,
             url: url,
             tags: tagsInput ? tagsInput.split(/[,，\s]+/).filter(Boolean) : []
           };
           return fetch('/api/growth/creative-assets', {
             method: 'POST',
             headers: growthAuthHeaders(),
             body: JSON.stringify(payload)
           }).then(function(r) { return r.json(); });
         }).then(function(d) {
           if (d.ok) done++;
           if (countEl) countEl.textContent = done + '/' + total + (done < total ? ' 上传中...' : '');
           uploadOne(idx + 1);
         }).catch(function(e) {
           if (countEl) countEl.textContent = done + '/' + total + ' 部分失败';
           showNotification('第 ' + (idx + 1) + ' 个上传失败：' + (e.message || e), 'error');
           uploadOne(idx + 1);
         });
       };
       uploadOne(0);
     }

    // ═══════════════════════════════════════════════════════
    // 打点卡弹层 HTML（动态注入body）
    // ═══════════════════════════════════════════════════════
    (function injectPunchCardModal() {
      const el = document.createElement('div');
      el.id = 'kitchen-punch-modal';
      el.style.cssText = `
        display:none;position:fixed;inset:0;z-index:3000;
        background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);
        -webkit-backdrop-filter:blur(6px);
        display:none;align-items:flex-end;justify-content:center;
      `;
      el.innerHTML = `
        <div style="
          width:100%;max-width:560px;
          background:#1a1a1f;border-radius:20px 20px 0 0;
          border:1px solid rgba(255,255,255,0.1);
          max-height:85vh;overflow-y:auto;
          padding:0 0 env(safe-area-inset-bottom,0) 0;
        ">
          <div style="position:sticky;top:0;background:#1a1a1f;z-index:1;padding:16px 20px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div id="punch-dish-name" style="font-size:17px;font-weight:700;color:#fff;"></div>
                <div id="punch-dish-station" style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;"></div>
              </div>
              <button data-click="closePunchCard" style="
                width:32px;height:32px;border-radius:50%;border:none;
                background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);
                font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;
              ">×</button>
            </div>
            <div id="punch-progress-bar" style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;margin-top:12px;">
              <div id="punch-progress-fill" style="height:100%;width:0%;background:#22c55e;border-radius:2px;transition:width .4s;"></div>
            </div>
            <div id="punch-progress-text" style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:5px;text-align:right;"></div>
          </div>
          <!-- 半成品组成：仅出品经理及以上可见 -->
          <div id="punch-components" style="display:none;margin:0 16px 10px;padding:10px 14px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.18);border-radius:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">
              <div style="font-size:11px;font-weight:700;color:#6ee7b7;letter-spacing:.05em;">📋 配方组成</div>
              <button id="punch-view-steps-btn" style="display:none;padding:4px 10px;border-radius:16px;border:1px solid rgba(251,191,36,0.35);background:rgba(251,191,36,0.1);color:#fcd34d;font-size:11px;cursor:pointer;" data-click="openRecipeStepViewerFromPunch">👁 查看工艺</button>
            </div>
            <div id="punch-components-list" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
          </div>
          <div id="punch-steps-list" style="padding:4px 16px 24px;display:grid;gap:8px;"></div>
          <div id="punch-no-sop" style="display:none;padding:32px 20px;text-align:center;color:rgba(255,255,255,0.35);font-size:14px;">
            📋 该菜品的SOP步骤尚未录入飞书表格<br>
            <span style="font-size:12px;margin-top:6px;display:block;">录入后系统自动同步，无需重启</span>
          </div>
        </div>
      `;
      document.body.appendChild(el);
      el.addEventListener('click', e => { if (e.target === el) closePunchCard(); });
    })();

    // ─── 配方工艺查看器（步骤 + 媒体）───────────────────────────
    (function injectRecipeStepViewer() {
      const el = document.createElement('div');
      el.id = 'recipe-step-viewer-modal';
      el.style.cssText = 'display:none;position:fixed;inset:0;z-index:3500;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);align-items:center;justify-content:center;';
      el.innerHTML = `
        <div style="width:min(540px,96vw);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(135deg,rgba(22,22,40,0.98),rgba(14,14,28,0.98));border:1px solid rgba(255,255,255,0.1);border-radius:20px;overflow:hidden;">
          <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
            <div>
              <div id="rsv-dish-name" style="font-size:16px;font-weight:700;color:#e2e8f0;"></div>
              <div id="rsv-comp-name" style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;"></div>
            </div>
            <button data-click="closeRecipeStepViewer" style="width:32px;height:32px;border-radius:8px;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);cursor:pointer;font-size:18px;">×</button>
          </div>
          <!-- comp tabs -->
          <div id="rsv-comp-tabs" style="display:flex;gap:6px;padding:10px 16px 0;overflow-x:auto;flex-shrink:0;"></div>
          <!-- steps list -->
          <div id="rsv-steps-list" style="flex:1;overflow-y:auto;padding:12px 16px 24px;display:flex;flex-direction:column;gap:10px;"></div>
        </div>`;
      document.body.appendChild(el);
      el.addEventListener('click', e => { if (e.target === el) closeRecipeStepViewer(); });

      // lightbox
      const lb = document.createElement('div');
      lb.id = 'media-lightbox';
      lb.style.cssText = 'display:none;position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,0.92);align-items:center;justify-content:center;';
      lb.innerHTML = `
        <button onclick="document.getElementById(\'media-lightbox\').style.display=\'none\'" style="position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:32px;cursor:pointer;line-height:1;">×</button>
        <img id="lightbox-img" src="" style="max-width:94vw;max-height:90vh;border-radius:10px;object-fit:contain;display:none;">
        <video id="lightbox-vid" src="" controls style="max-width:94vw;max-height:90vh;border-radius:10px;display:none;"></video>`;
      document.body.appendChild(lb);
      lb.addEventListener('click', e => { if (e.target === lb) lb.style.display = 'none'; });
    })();

    function openMediaLightbox(url, type) {
      const lb = document.getElementById('media-lightbox');
      const img = document.getElementById('lightbox-img');
      const vid = document.getElementById('lightbox-vid');
      if (type === 'video') {
        img.style.display = 'none'; vid.src = url; vid.style.display = '';
      } else {
        vid.style.display = 'none'; img.src = url; img.style.display = '';
      }
      lb.style.display = 'flex';
    }

    let _rsvRecipe = null;
    let _rsvCompIdx = 0;

    async function openRecipeStepViewer(recipeId, dishName) {
      const modal = document.getElementById('recipe-step-viewer-modal');
      modal.style.display = 'flex';
      document.getElementById('rsv-dish-name').textContent = dishName || '配方工艺';
      document.getElementById('rsv-comp-name').textContent = '加载中…';
      document.getElementById('rsv-comp-tabs').innerHTML = '';
      document.getElementById('rsv-steps-list').innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:32px;">加载中…</div>';
      try {
        const r = await fetch(`/api/recipes/${recipeId}`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        _rsvRecipe = data.recipe;
        _rsvCompIdx = 0;
        _renderRsvTabs();
        _renderRsvSteps(0);
      } catch(e) {
        document.getElementById('rsv-steps-list').innerHTML = `<div style="color:#f87171;padding:20px;">${e.message}</div>`;
      }
    }

    function _renderRsvTabs() {
      const comps = _rsvRecipe?.components || [];
      const tabs = document.getElementById('rsv-comp-tabs');
      tabs.innerHTML = comps.map((c, i) => `
        <button id="rsv-tab-${i}" data-click="_renderRsvSteps" data-arg="${i}" data-arg-type="number"
          style="padding:6px 14px;border-radius:20px;border:1px solid rgba(99,102,241,0.3);background:${i===0?'rgba(99,102,241,0.18)':'rgba(255,255,255,0.04)'};color:${i===0?'#a5b4fc':'rgba(255,255,255,0.5)'};font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0;">
          ${c.name}
        </button>`).join('');
    }

    function _renderRsvSteps(compIdx) {
      _rsvCompIdx = compIdx;
      const comp = (_rsvRecipe?.components || [])[compIdx];
      if (!comp) return;
      // update tab styles
      (_rsvRecipe?.components || []).forEach((_, i) => {
        const t = document.getElementById(`rsv-tab-${i}`);
        if (!t) return;
        t.style.background = i === compIdx ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)';
        t.style.color      = i === compIdx ? '#a5b4fc' : 'rgba(255,255,255,0.5)';
      });
      document.getElementById('rsv-comp-name').textContent = `${comp.name} · ${(comp.steps||[]).length} 步`;
      const list = document.getElementById('rsv-steps-list');
      if (!comp.steps?.length) {
        list.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.3);padding:32px;">该半成品暂无工艺步骤</div>';
        return;
      }
      list.innerHTML = comp.steps.map((s, i) => {
        const mediaHtml = s.media_url ? `
          <div style="margin-top:8px;">
            ${s.media_type === 'video'
              ? `<video src="${s.media_url}" controls preload="metadata" style="width:100%;max-height:200px;border-radius:10px;display:block;"></video>`
              : `<img src="${s.media_url}" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;cursor:pointer;" data-click="openMediaLightbox" data-arg="${s.media_url}" data-arg2="image">`
            }
          </div>` : '';
        return `
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 14px;">
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <div style="width:26px;height:26px;border-radius:50%;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</div>
              <div style="font-size:13px;color:#e2e8f0;line-height:1.6;flex:1;">${s.instruction}</div>
              ${s.media_url ? `<button onclick="openMediaLightbox('${s.media_url}','${s.media_type||'image'}')" title="查看${s.media_type==='video'?'视频':'图片'}"
                style="width:30px;height:30px;border-radius:8px;border:none;background:rgba(99,102,241,0.15);color:#a5b4fc;cursor:pointer;font-size:14px;flex-shrink:0;">${s.media_type==='video'?'▶':'🔍'}</button>` : ''}
            </div>
            ${mediaHtml}
          </div>`;
      }).join('');
    }

    function closeRecipeStepViewer() {
      document.getElementById('recipe-step-viewer-modal').style.display = 'none';
      const vid = document.getElementById('lightbox-vid');
      if (vid) vid.pause();
    }

    function openRecipeStepViewerFromPunch() {
      const compEl = document.getElementById('punch-components');
      const recipeId = compEl?.dataset?.recipeId;
      const dishName = document.getElementById('punch-dish-name')?.textContent || '';
      if (recipeId) openRecipeStepViewer(recipeId, dishName);
    }

    // ═══════════════════════════════════════════════════════
    // 厨房备料执行模块 JS
    // ═══════════════════════════════════════════════════════
    let _kitchenCurrentView = 'staff'; // staff | dashboard | manage | recipe
    let _kitchenStation = '';
    let _kitchenStore = '';
    const KITCHEN_VALID_STORES = ['洪潮大宁久光店', '马己仙上海音乐广场店'];

    // 进入厨房页面时调用
     // 进入厨房页面时调用
     async function initKitchenPage() {
       const role = currentUser?.role || '';
       const isMgr = ['admin','hq_manager','store_manager','store_production_manager'].includes(role);

       // 标准化岗位名：员工档案可能写 "烧味/卤水"，截取 / 前的部分
       const rawStation = currentUser?.position || currentUser?.station || '';
       _kitchenStation = rawStation.replace(/\/.*/, '').trim();
       _kitchenStore   = currentUser?.store || '';

       document.getElementById('kitchen-mgr-actions').style.display = isMgr ? '' : 'none';
       const dashboardBtn = document.getElementById('kitchen-dashboard-tab-btn');
       // 配方、同步、菜品配置：仅管理员
       const isAdmin = role === 'admin';
       const manageBtn = document.getElementById('kitchen-manage-btn');
       const recipeBtn = document.getElementById('kitchen-recipe-btn');
       const syncBtn   = document.getElementById('kitchen-sync-btn');
       if (dashboardBtn) dashboardBtn.style.display = isMgr ? '' : 'none';
       if (manageBtn) manageBtn.style.display = isAdmin ? '' : 'none';
       if (recipeBtn) recipeBtn.style.display = isAdmin ? '' : 'none';
       if (syncBtn)   syncBtn.style.display   = isAdmin ? '' : 'none';

       if (isMgr) {
         showKitchenView('dashboard');
       } else {
         showKitchenView('staff');
       }
     }

    function showKitchenView(view) {
      _kitchenCurrentView = view;
      document.getElementById('kitchen-staff-view').style.display     = view === 'staff'     ? '' : 'none';
      document.getElementById('kitchen-dashboard-view').style.display = view === 'dashboard' ? '' : 'none';
      document.getElementById('kitchen-manage-view').style.display    = view === 'manage'    ? '' : 'none';
      document.getElementById('kitchen-recipe-view').style.display    = view === 'recipe'    ? '' : 'none';
      document.getElementById('kitchen-progress-ring').style.display  = view === 'staff'     ? '' : 'none';
      document.getElementById('kitchen-time-chips').style.display     = view === 'staff'     ? '' : 'none';
      [
        ['staff', 'kitchen-staff-tab-btn'],
        ['dashboard', 'kitchen-dashboard-tab-btn'],
        ['manage', 'kitchen-manage-btn'],
        ['recipe', 'kitchen-recipe-btn']
      ].forEach(function(pair) {
        const btn = document.getElementById(pair[1]);
        if (!btn) return;
        btn.classList.toggle('kitchen-segmented__item--active', pair[0] === view);
      });

      if (view === 'staff')     loadKitchenTasks();
      if (view === 'dashboard') loadKitchenDashboard();
      if (view === 'manage')    loadKitchenMappings();
      if (view === 'recipe')    { switchRecipeTab('recipes'); loadRecipeList(); }
    }

    // ── 员工：加载今日任务 ──────────────────────────────────
    async function loadKitchenTasks() {
      const station = _kitchenStation;
      const store   = _kitchenStore;

      document.getElementById('kitchen-page-title').textContent = '今日备料';
      document.getElementById('kitchen-page-sub').textContent =
        station ? `${station} · ${new Date().toLocaleDateString('zh-CN')}` : '未配置岗位';
      document.getElementById('kitchen-progress-ring').style.display = 'none';
      document.getElementById('kitchen-time-chips').style.display = 'none';

      if (!station || !store) {
        document.getElementById('kitchen-empty-tip').style.display = 'none';
        document.getElementById('kitchen-no-tasks').style.display = '';
        document.getElementById('kitchen-task-list').style.display = 'none';
        document.getElementById('kitchen-no-tasks-reason').textContent =
          !store ? '请先在系统设置中配置门店' : '请先在员工档案中配置岗位（如：炒锅/烧味）';
        return;
      }

      try {
        const r = await fetch(`/api/kitchen/my-tasks?station=${encodeURIComponent(station)}&store=${encodeURIComponent(store)}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'load_failed');

        const tasks = data.tasks || [];
        const list  = document.getElementById('kitchen-task-list');
        const empty = document.getElementById('kitchen-empty-tip');
        const none  = document.getElementById('kitchen-no-tasks');

        empty.style.display = 'none';
        none.style.display = 'none';
        list.style.display = '';

        if (!tasks.length) {
          none.style.display = ''; list.style.display = 'none';
          document.getElementById('kitchen-no-tasks-reason').textContent = '请在「菜品配置」中添加档口负责菜品';
          return;
        }

        const allDone = tasks.every(t => t.confirmed);
        if (allDone) { empty.style.display = ''; list.style.display = 'none'; }
        else { empty.style.display = 'none'; list.style.display = ''; }

        // 渲染顶部完成进度环
        const done = tasks.filter(t => t.confirmed).length;
        const total = tasks.length;
        const pct = Math.round(done / total * 100);
        document.getElementById('kitchen-progress-ring').style.display = '';
        document.getElementById('kitchen-progress-ring').innerHTML = `
          <div class="kitchen-progress-card">
            <div class="kitchen-progress-card__ring">
              <svg viewBox="0 0 64 64" style="width:72px;height:72px;transform:rotate(-90deg);">
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5"/>
                <circle cx="32" cy="32" r="28" fill="none" stroke="${pct===100?'#5eead4':pct>=50?'#ffc46b':'#6d7cff'}" stroke-width="5"
                  stroke-dasharray="${Math.round(pct/100*175.9)} 175.9" stroke-linecap="round"/>
              </svg>
              <div class="kitchen-progress-card__value">${pct}%</div>
            </div>
            <div>
              <div class="kitchen-pill-title">TODAY SNAPSHOT</div>
              <div class="kitchen-progress-card__title">${done} / ${total} 项完成</div>
              <div class="kitchen-progress-card__meta">${pct===100?'所有任务已经清空，可以准备收尾。':pct>=50?'完成过半，优先处理当前时段和风险项。':'先把当前时段任务跑顺，再逐步清掉后续队列。'}</div>
            </div>
          </div>`;

        // 渲染时段快选 chips
        var timeSet = new Set(tasks.map(t => t.schedule_time || '--:--').filter(Boolean));
        var times = Array.from(timeSet).sort();
        var currentTime = new Date().getHours().toString().padStart(2,'0') + ':' + new Date().getMinutes().toString().padStart(2,'0');
        var activeTime = '';
        for (var i = times.length - 1; i >= 0; i--) { if (times[i] <= currentTime) { activeTime = times[i]; break; } }
        if (!activeTime && times.length) activeTime = times[0];

        document.getElementById('kitchen-time-chips').style.display = '';
        document.getElementById('kitchen-time-chips').innerHTML = times.map(t => {
          var tDone = tasks.filter(x => x.schedule_time === t && x.confirmed).length;
          var tTotal = tasks.filter(x => x.schedule_time === t).length;
          var isActive = t === activeTime;
          return `<button class="kitchen-time-chip ${isActive ? 'kitchen-time-chip--active' : ''}" data-click="scrollToTimeGroup" data-arg="${t}">🕒 ${t} <span class="kitchen-time-chip__count">${tDone}/${tTotal}</span></button>`;
        }).join('');

        // 按时段分组渲染任务卡
        var grouped = {};
        tasks.forEach(function(task) {
          var key = task.schedule_time || '--:--';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(task);
        });
        list.innerHTML = Object.keys(grouped).sort().map(timeKey => {
          var rows = grouped[timeKey];
          var doneCount = rows.filter(t => t.confirmed).length;
          var overdueCount = rows.filter(t => !t.confirmed && kitchenTaskTimingState(t.schedule_time).overdue).length;
          return `<div id="kitchen-group-${timeKey.replace(':','')}" class="kitchen-task-group">
            <div class="kitchen-task-group__head">
              <div class="kitchen-task-group__time" style="color:${overdueCount?'#ffd1d7':'rgba(238,241,250,0.88)'};">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                ${timeKey}
              </div>
              <div class="kitchen-task-group__meta" style="color:${overdueCount?'#ffd1d7':'rgba(238,241,250,0.52)'};">${doneCount}/${rows.length}${overdueCount? '<br>'+overdueCount+' 项超时':''}</div>
            </div>
            <div class="kitchen-task-stack">${rows.map(t => kitchenTaskCard(t, station, store)).join('')}</div>
          </div>`;
        }).join('');

      } catch(e) {
        showNotification('加载任务失败：' + (e?.message || e), 'error');
      }
    }

    function scrollToTimeGroup(timeKey) {
      var el = document.getElementById('kitchen-group-' + timeKey.replace(':',''));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function kitchenTaskTimingState(scheduleTime) {
      var now = new Date();
      var hhmm = String(scheduleTime || '').split(':');
      var target = new Date(now);
      target.setHours(Number(hhmm[0] || 0), Number(hhmm[1] || 0), 0, 0);
      var diffMs = now.getTime() - target.getTime();
      if (diffMs > 30 * 60 * 1000) return { label: '超时', color: '#ef4444', overdue: true };
      if (diffMs > 0) return { label: '进行中', color: '#f59e0b', overdue: false };
      return { label: '待执行', color: '#38bdf8', overdue: false };
    }

    function kitchenTaskCard(task, station, store) {
      const done = task.confirmed;
      const dishEsc = task.dish_name.replace(/'/g, "\\'");
      const scheduleEsc = String(task.schedule_time || '').replace(/'/g, "\\'");
      const timing = kitchenTaskTimingState(task.schedule_time);
      const accent = done ? '#5eead4' : timing.overdue ? '#ff7a90' : timing.label === '进行中' ? '#ffc46b' : '#6d7cff';
      const bgColor = done ? 'rgba(94,234,212,0.08)' : timing.overdue ? 'rgba(255,122,144,0.08)' : timing.label === '进行中' ? 'rgba(255,196,107,0.08)' : 'rgba(109,124,255,0.08)';
      return `
        <div onclick="openPunchCard('${dishEsc}','${station}','${store}','${scheduleEsc}')" style="
          background:${bgColor};border-color:${done ? 'rgba(94,234,212,0.28)' : timing.overdue ? 'rgba(255,122,144,0.28)' : 'rgba(255,255,255,0.12)'};
          ${done ? 'opacity:0.7;' : ''}
        " class="kitchen-task-card">
          <div class="kitchen-task-card__row">
            <div class="kitchen-task-card__icon" style="background:${done ? 'rgba(94,234,212,0.18)' : timing.overdue ? 'rgba(255,122,144,0.18)' : 'rgba(109,124,255,0.18)'};color:${accent};border-color:${done ? 'rgba(94,234,212,0.3)' : timing.overdue ? 'rgba(255,122,144,0.3)' : 'rgba(109,124,255,0.32)'};">${done ? '✓' : task.is_prep ? '🧂' : '🍽'}</div>
            <div style="flex:1;min-width:0;">
              <div class="kitchen-task-card__title" style="color:${done?'rgba(238,241,250,0.56)':'#eef1fa'};${done?'text-decoration:line-through;':''}">
                ${task.dish_name}
              </div>
              <div class="kitchen-task-card__chips">
                <span class="kitchen-task-card__chip">${task.schedule_time || '--:--'}</span>
                ${!done ? `<span class="kitchen-task-card__chip" style="background:${accent}20;color:${accent};border-color:${accent}26;">${timing.label}</span>` : ''}
                ${done && task.confirmed_at ? `<span class="kitchen-task-card__chip">完成 ${String(task.confirmed_at).slice(11,16)}</span>` : ''}
              </div>
              ${!done && task.critical_step_name
                ? `<div class="kitchen-task-card__hint" style="color:#ffc46b;">⚡ 关键控制点：${task.critical_step_name}</div>`
                : !done ? `<div class="kitchen-task-card__hint">点击进入逐步骤打点，按当前档口节奏完成确认。</div>` : ''}
            </div>
            ${!done ? `<div class="kitchen-task-card__arrow">▸</div>` : ''}
          </div>
        </div>`;
    }

    // ── 打点卡：打开弹层 ────────────────────────────────────
    let _punchCurrent = {};

    async function openPunchCard(dishName, station, store, scheduleTime) {
      _punchCurrent = { dishName, station, store, scheduleTime };
      const modal = document.getElementById('kitchen-punch-modal');
      modal.style.display = 'flex';
      document.getElementById('punch-dish-name').textContent = dishName;
      document.getElementById('punch-dish-station').textContent = `${station} · ${store} · ${scheduleTime || '--:--'}`;
      document.getElementById('punch-no-sop').style.display = 'none';
      document.getElementById('punch-components').style.display = 'none';
      document.getElementById('punch-steps-list').innerHTML =
        '<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-size:13px;">加载中…</div>';

      // 出品经理及以上：异步加载半成品组成（不阻塞步骤加载）
      const role = currentUser?.role || '';
      const canSeeComponents = ['admin','hq_manager','store_manager','store_production_manager'].includes(role);
      if (canSeeComponents) {
        fetch(`/api/recipes/components/by-dish?dish=${encodeURIComponent(dishName)}`,
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } })
          .then(r => r.json())
          .then(data => {
            if (data.success && data.components?.length) {
              const compEl = document.getElementById('punch-components');
              const listEl = document.getElementById('punch-components-list');
              const viewBtn = document.getElementById('punch-view-steps-btn');
              listEl.innerHTML = data.components.map(c =>
                `<span style="padding:4px 10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.25);border-radius:16px;font-size:12px;color:#6ee7b7;">${c.name}</span>`
              ).join('');
              if (data.recipe_id) {
                compEl.dataset.recipeId = data.recipe_id;
                if (viewBtn) viewBtn.style.display = '';
              }
              compEl.style.display = '';
            }
          }).catch(() => {});
      }

      try {
        const r = await fetch(
          `/api/kitchen/dish-steps?dishName=${encodeURIComponent(dishName)}&store=${encodeURIComponent(store)}&scheduleTime=${encodeURIComponent(scheduleTime || '')}`,
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } }
        );
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        renderPunchSteps(data.steps || [], data.hasData);
      } catch(e) {
        document.getElementById('punch-steps-list').innerHTML =
          `<div style="padding:20px;text-align:center;color:#ef4444;font-size:13px;">加载失败：${e.message}</div>`;
      }
    }

    // ── 打点卡倒计时状态 ──────────────────────────────────────
    let _punchCountdownTimer = null;   // setInterval handle
    let _punchCountingStep   = null;   // 正在倒计时的 step_seq
    let _punchCountdownSecs  = 0;      // 剩余秒数
    let _punchStepsCache     = [];     // 当前步骤列表缓存（供倒计时结束后使用）

    function renderPunchSteps(steps, hasData) {
      const list = document.getElementById('punch-steps-list');
      const noSop = document.getElementById('punch-no-sop');
      const bar   = document.getElementById('punch-progress-fill');
      const txt   = document.getElementById('punch-progress-text');

      if (!hasData || !steps.length) {
        list.innerHTML = '';
        noSop.style.display = '';
        bar.style.width = '0%';
        txt.textContent = '暂无步骤数据';
        return;
      }

      noSop.style.display = 'none';
      _punchStepsCache = steps;

      const done  = steps.filter(s => s.punched).length;
      const total = steps.length;
      bar.style.width = `${Math.round(done/total*100)}%`;
      txt.textContent  = `${done} / ${total} 步已完成`;

      // 第一个未完成步骤 = 当前激活步骤
      const activeIdx = steps.findIndex(s => !s.punched);

      list.innerHTML = steps.map((s, idx) => {
        const { dishName, station, store, scheduleTime } = _punchCurrent;
        const dishEsc     = dishName.replace(/'/g, "\\'");
        const actEsc      = (s.action || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const scheduleEsc = String(scheduleTime || '').replace(/'/g, "\\'");

        const isDone      = s.punched;
        const isActive    = !isDone && idx === activeIdx;
        const isLocked    = !isDone && !isActive;
        const isCounting  = isActive && _punchCountingStep === s.step_seq;

        // 圆形序号样式
        const circleStyle = isDone
          ? 'background:#22c55e;border-color:#22c55e;color:#fff;'
          : isActive
            ? 'background:rgba(99,102,241,0.2);border-color:#6366f1;color:#a5b4fc;'
            : 'background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1);color:rgba(255,255,255,0.2);';

        // 卡片整体样式
        const cardStyle = isDone
          ? 'background:rgba(34,197,94,0.07);border-color:rgba(34,197,94,0.25);'
          : isActive
            ? 'background:rgba(99,102,241,0.06);border-color:rgba(99,102,241,0.35);'
            : 'background:rgba(255,255,255,0.02);border-color:rgba(255,255,255,0.05);opacity:0.45;';

        // 按钮区
        let btnHtml = '';
        if (isDone) {
          btnHtml = `<div style="font-size:18px;color:#22c55e;flex-shrink:0;">✓</div>`;
        } else if (isActive) {
          if (isCounting) {
            btnHtml = `
              <div id="punch-countdown-${s.step_seq}" style="
                flex-shrink:0;width:44px;height:44px;border-radius:50%;
                border:2.5px solid #6366f1;
                display:flex;align-items:center;justify-content:center;
                font-size:16px;font-weight:700;color:#a5b4fc;
                background:rgba(99,102,241,0.12);
              ">${_punchCountdownSecs}</div>`;
          } else {
            btnHtml = `
              <button onclick="startStepCountdown('${dishEsc}','${s.step_seq}','${actEsc}','${station}','${store}','${scheduleEsc}')"
                style="flex-shrink:0;height:40px;padding:0 16px;border-radius:9px;border:none;
                       background:linear-gradient(135deg,#6366f1,#4f46e5);
                       color:#fff;font-size:13px;font-weight:600;cursor:pointer;
                       box-shadow:0 3px 10px rgba(99,102,241,0.35);">
                开始
              </button>`;
          }
        } else {
          btnHtml = `<div style="font-size:16px;color:rgba(255,255,255,0.12);flex-shrink:0;">🔒</div>`;
        }

        return `
          <div style="border:1px solid;border-radius:12px;padding:12px 14px;transition:all 0.2s;${cardStyle}">
            <div style="display:flex;align-items:flex-start;gap:12px;">
              <div style="
                width:28px;height:28px;border-radius:50%;flex-shrink:0;
                border:1.5px solid;display:flex;align-items:center;justify-content:center;
                font-size:12px;font-weight:700;${circleStyle}
              ">${isDone ? '✓' : s.step_seq}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;line-height:1.5;
                  color:${isDone ? 'rgba(255,255,255,0.4)' : isActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.3)'};
                  ${isDone ? 'text-decoration:line-through;' : ''}">
                  ${s.is_critical ? '⚡ ' : ''}${s.action}
                </div>
                ${s.time_limit_seconds ? `<div style="font-size:11px;color:rgba(255,255,255,0.25);margin-top:4px;">⏱ ${s.time_limit_seconds >= 60 ? Math.round(s.time_limit_seconds/60)+'分钟' : s.time_limit_seconds+'秒'}</div>` : ''}
                ${s.quality_standard && !isDone ? `<div style="font-size:11px;color:rgba(100,200,100,0.55);margin-top:3px;">✓ ${s.quality_standard}</div>` : ''}
                ${s.common_failure && isActive ? `<div style="font-size:11px;color:rgba(245,158,11,0.6);margin-top:3px;">⚠ ${s.common_failure}</div>` : ''}
              </div>
              ${btnHtml}
            </div>
          </div>`;
      }).join('');
    }

    // 点击"开始"→启动10秒倒计时
    // 异步拉取当前步骤用料并注入到激活卡片中
    function startStepCountdown(dishName, stepSeq, stepAction, station, store, scheduleTime) {
      // 防重复
      if (_punchCountingStep !== null) return;

      _punchCountingStep  = Number(stepSeq);
      _punchCountdownSecs = 10;

      // 重渲染，显示倒计时圆圈
      renderPunchSteps(_punchStepsCache, true);

      _punchCountdownTimer = setInterval(() => {
        _punchCountdownSecs--;
        // 更新圆圈数字（避免重渲染整个列表）
        const el = document.getElementById(`punch-countdown-${stepSeq}`);
        if (el) el.textContent = _punchCountdownSecs;

        if (_punchCountdownSecs <= 0) {
          clearInterval(_punchCountdownTimer);
          _punchCountdownTimer = null;
          _punchCountingStep   = null;
          // 倒计时结束 → 调用服务端打点
          punchStep(dishName, stepSeq, stepAction, station, store, scheduleTime);
        }
      }, 1000);
    }

    async function punchStep(dishName, stepSeq, stepAction, station, store, scheduleTime) {
      try {
        const r = await fetch('/api/kitchen/punch-step', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('hrms_token')}`
          },
          body: JSON.stringify({ dishName, stepSeq: Number(stepSeq), stepAction, station, store, scheduleTime })
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);

        if (data.allDone) {
          showNotification(`✅ ${dishName} 所有步骤完成，已自动确认`, 'success');
          closePunchCard();
          loadKitchenTasks();
        } else {
          // 从服务端拉最新状态，重渲染
          const res = await fetch(
            `/api/kitchen/dish-steps?dishName=${encodeURIComponent(dishName)}&store=${encodeURIComponent(store)}&scheduleTime=${encodeURIComponent(scheduleTime || '')}`,
            { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } }
          );
          const d = await res.json();
          if (d.success) renderPunchSteps(d.steps || [], d.hasData);
        }
      } catch(e) {
        showNotification('打点失败：' + (e?.message || e), 'error');
      }
    }

    function closePunchCard() {
      // 关闭时清除倒计时，防止后台继续跑
      if (_punchCountdownTimer) {
        clearInterval(_punchCountdownTimer);
        _punchCountdownTimer = null;
      }
      _punchCountingStep  = null;
      _punchCountdownSecs = 0;
      const modal = document.getElementById('kitchen-punch-modal');
      if (modal) modal.style.display = 'none';
    }

    async function kitchenConfirmTask(dishName, station, store, scheduleTime) {
      try {
        const r = await fetch('/api/kitchen/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('hrms_token')}`
          },
          body: JSON.stringify({ dishName, station, store, scheduleTime })
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'confirm_failed');
        showNotification(`✅ ${dishName} 已确认`, 'success');
        loadKitchenTasks(); // 刷新列表
      } catch(e) {
        showNotification('确认失败：' + (e?.message || e), 'error');
      }
    }

    // ── 管理：完成率看板 ────────────────────────────────────
      async function loadKitchenDashboard() {
        document.getElementById('kitchen-page-title').textContent = '完成率看板';
        document.getElementById('kitchen-progress-ring').style.display = 'none';
        document.getElementById('kitchen-time-chips').style.display = 'none';
        let store = _kitchenStore || currentUser?.store || '';

        if (!KITCHEN_VALID_STORES.includes(store)) {
          document.getElementById('kitchen-page-sub').textContent = '请选择门店';
          document.getElementById('kitchen-dashboard-store-picker').style.display = '';
          document.getElementById('kitchen-dashboard-store-picker').innerHTML =
            KITCHEN_VALID_STORES.map(s => `
              <button class="kitchen-store-pick" onclick="_kitchenStore='${s}';loadKitchenDashboard();">📍 ${s}</button>
            `).join('');
          document.getElementById('kitchen-dashboard-overview').innerHTML = '';
          document.getElementById('kitchen-dashboard-cards').innerHTML = '';
          document.getElementById('kitchen-unchecked-section').style.display = 'none';
          return;
        }
        document.getElementById('kitchen-dashboard-store-picker').style.display = 'none';
        document.getElementById('kitchen-page-sub').textContent = store + ' · ' + new Date().toLocaleDateString('zh-CN');

       try {
        const r = await fetch(`/api/kitchen/dashboard?store=${encodeURIComponent(store)}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);

        var summary = data.summary || [];
        var totalAll = summary.reduce((a,s) => a + (s.total||0), 0);
        var confirmedAll = summary.reduce((a,s) => a + (s.confirmed||0), 0);
        var overallRate = totalAll ? Math.round(confirmedAll / totalAll * 100) : 0;

        // 整体概览
        document.getElementById('kitchen-dashboard-overview').innerHTML = totalAll ? `
          <div class="kitchen-overview-card">
            <div class="kitchen-progress-card__ring">
              <svg viewBox="0 0 64 64" style="width:72px;height:72px;transform:rotate(-90deg);">
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5"/>
                <circle cx="32" cy="32" r="28" fill="none" stroke="${overallRate===100?'#5eead4':overallRate>=60?'#ffc46b':'#ff7a90'}" stroke-width="5"
                  stroke-dasharray="${Math.round(overallRate/100*175.9)} 175.9" stroke-linecap="round"/>
              </svg>
              <div class="kitchen-progress-card__value">${overallRate}%</div>
            </div>
            <div>
              <div class="kitchen-pill-title">STORE OVERVIEW</div>
              <div class="kitchen-overview-card__title">整体完成率</div>
              <div class="kitchen-overview-card__meta">${confirmedAll} / ${totalAll} 项已确认，覆盖 ${summary.length} 个档口。${overallRate===100?' 当前门店节奏稳定。':overallRate>=60?' 当前班次总体可控，重点看风险项。':' 需要尽快清理未确认队列，避免时段积压。'}</div>
            </div>
          </div>
        ` : '';

        // 岗位卡片
        var cardsHtml = summary.map(s => `
          <div class="kitchen-dashboard-card">
            <div class="kitchen-dashboard-card__top">
              <div>
                <div class="kitchen-pill-title">STATION</div>
                <div class="kitchen-dashboard-card__station">${s.station}</div>
              </div>
              <div class="kitchen-dashboard-card__rate" style="color:${s.rate===100?'#5eead4':s.rate>=60?'#ffc46b':'#ff7a90'};">${s.rate}%</div>
            </div>
            <div class="kitchen-progress-bar"><span style="width:${s.rate}%;background:${s.rate===100?'#5eead4':s.rate>=60?'#ffc46b':'#ff7a90'};"></span></div>
            <div class="kitchen-dashboard-card__meta">${s.confirmed}/${s.total} 项完成</div>
            ${(s.completed_details||[]).length ? `
              <div class="kitchen-mini-list">
                ${(s.completed_details||[]).slice(-3).map(item => {
                  var durStr = '';
                  if (item.confirmed_at && item.schedule_time) {
                    try {
                      var dt = new Date(item.confirmed_at);
                      var hhmm = String(item.schedule_time).split(':');
                      var scheduled = new Date(dt);
                      scheduled.setHours(Number(hhmm[0]||0), Number(hhmm[1]||0), 0, 0);
                      var diffMin = Math.round((dt.getTime() - scheduled.getTime()) / 60000);
                      if (diffMin >= 0) {
                        durStr = diffMin >= 60 ? Math.floor(diffMin/60)+'h'+(diffMin%60)+'m' : diffMin+'m';
                      }
                    } catch(e) {}
                  }
                  return `
                  <div class="kitchen-mini-list__item">
                    <span style="color:#86efac;flex-shrink:0;">✓</span>
                    <span style="flex:1;min-width:0;">
                      <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.is_prep?'🧂':'🍽'} ${item.dish_name}</strong>
                      <span>${item.employee_name || item.employee_username || ''}</span>
                    </span>
                    <span style="color:rgba(255,255,255,0.3);flex-shrink:0;text-align:right;line-height:1.4;">
                      <div>${String(item.confirmed_at||'').slice(11,16)||''}</div>
                      ${durStr ? '<div style="color:rgba(255,255,255,0.15);">'+durStr+'</div>' : ''}
                    </span>
                  </div>`;
                }).join('')}
              </div>
            ` : ''}
            ${(s.unchecked_details||[]).some(i => kitchenTaskTimingState(i.schedule_time).overdue) ? `
              <div style="font-size:11px;color:#ffd1d7;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);">
                ⚠ ${s.unchecked_details.filter(i => kitchenTaskTimingState(i.schedule_time).overdue).length} 项超时未完成
              </div>
            ` : ''}
          </div>
        `).join('');

        document.getElementById('kitchen-dashboard-cards').innerHTML = cardsHtml || '<div class="kitchen-empty-state" style="display:block;"><div class="kitchen-empty-state__icon">📈</div><div class="kitchen-empty-state__title">暂无看板数据</div><div class="kitchen-empty-state__desc">请先配置岗位菜品并开始执行，系统才会生成完成率统计。</div></div>';

        // 未确认明细
        const unchecked = data.unchecked || [];
        const sec  = document.getElementById('kitchen-unchecked-section');
        const ulist = document.getElementById('kitchen-unchecked-list');
        if (unchecked.length) {
          sec.style.display = '';
          ulist.innerHTML = unchecked.map(u => {
            const overdue = kitchenTaskTimingState(u.schedule_time).overdue;
            return `
            <div class="kitchen-risk-card" style="background:${overdue ? 'rgba(255,122,144,0.1)' : 'rgba(255,255,255,0.06)'};border-color:${overdue ? 'rgba(255,122,144,0.24)' : 'rgba(255,255,255,0.1)'};">
              <div>
                <div class="kitchen-risk-card__title">${u.is_prep?'🧂':'🍽'} ${u.dish_name}</div>
                <div class="kitchen-risk-card__meta">${u.station} · ${u.schedule_time||'--:--'}${u.assignee_name?' · '+u.assignee_name:''}</div>
              </div>
              <div class="kitchen-pill-title" style="background:${overdue ? 'rgba(255,122,144,0.18)' : 'rgba(255,255,255,0.08)'};border-color:${overdue ? 'rgba(255,122,144,0.26)' : 'rgba(255,255,255,0.1)'};color:${overdue ? '#ffd1d7' : 'rgba(238,241,250,0.74)'};">${overdue?'超时未确认':'待确认'}</div>
            </div>`;
          }).join('');
        } else {
          sec.style.display = 'none';
        }
       } catch(e) {
         console.error('[kitchen] dashboard error:', e);
         showNotification('加载看板失败：' + (e?.message || e), 'error');
       }
     }

    // ── 管理：菜品配置 ──────────────────────────────────────
    async function loadKitchenMappings() {
      document.getElementById('kitchen-page-title').textContent = '菜品岗位配置';
      document.getElementById('kitchen-page-sub').textContent   = '管理各档口负责的菜品及关键步骤';

       let store = _kitchenStore || currentUser?.store || '';
       if (!store || store === '总部' || !KITCHEN_VALID_STORES.includes(store)) {
         showNotification('请先在看板中选择门店', 'warn');
         showKitchenView('dashboard');
         return;
       }

      try {
        const r = await fetch(`/api/kitchen/station-dish?store=${encodeURIComponent(store)}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
        });
        const data = await r.json();
        const mappings = data.rows || [];
        document.getElementById('kitchen-mapping-list').innerHTML = mappings.length ? mappings.map(m => `
          <div class="kitchen-mapping-card">
            <div class="kitchen-mapping-card__top">
              <div style="min-width:0;">
                <div class="kitchen-pill-title">ASSIGNMENT</div>
                <div class="kitchen-mapping-card__title">${m.station} · ${m.dish_name}</div>
                <div class="kitchen-mapping-card__meta">执行人：${m.assignee_name || m.assignee_username || '未指定'} · 时间：${(m.scheduled_times || []).join(' / ') || '09:00'}</div>
                ${m.critical_step_name ? `<div class="kitchen-mapping-card__meta">关键点：${m.critical_step_name}</div>` : ''}
                ${m.is_prep ? `<div class="kitchen-mapping-card__meta">类型：预制料 / 半成品任务</div>` : ''}
              </div>
              <div class="kitchen-mapping-card__actions">
                <button class="btn btn-secondary" type="button" onclick='kitchenEditMappingFromJson("${encodeURIComponent(JSON.stringify(m)).replace(/"/g, '&quot;')}")' style="font-size:12px;white-space:nowrap;">编辑</button>
                <button class="btn btn-secondary" type="button" data-click="kitchenRemoveMapping" data-arg="${m.id}" style="font-size:12px;white-space:nowrap;">删除</button>
              </div>
            </div>
          </div>
        `).join('') : '<div class="kitchen-empty-state" style="display:block;"><div class="kitchen-empty-state__icon">🗂</div><div class="kitchen-empty-state__title">暂无岗位配置</div><div class="kitchen-empty-state__desc">先为档口绑定执行人和菜品，员工视图才会生成当天任务。</div></div>';
      } catch(e) {
        document.getElementById('kitchen-mapping-list').innerHTML = '<div style="color:#ef4444;font-size:13px;padding:10px 0;">加载配置失败</div>';
      }
    }

    function kitchenResetForm() {
      document.getElementById('kitchen-edit-id').value = '';
      document.getElementById('kitchen-form-title').textContent = '添加岗位负责菜品';
      document.getElementById('kitchen-form-subtitle').textContent = '选择档口、具体员工和固定执行时间后，可一次分配多道菜品。';
      document.getElementById('kitchen-save-btn').textContent = '+ 添加';
      document.getElementById('kitchen-cancel-edit-btn').style.display = 'none';
      document.getElementById('kitchen-add-station').value = '';
      document.getElementById('kitchen-add-employee').innerHTML = '<option value="">先选择档口</option>';
      document.getElementById('kitchen-add-dish').innerHTML = '<option value="">先选择档口</option>';
      document.getElementById('kitchen-add-times').value = '09:00';
      document.getElementById('kitchen-add-step').value = '';
      document.getElementById('kitchen-add-isprep').checked = false;
    }

    async function kitchenEditMappingFromJson(encodedRow) {
      try {
        const row = JSON.parse(decodeURIComponent(encodedRow || ''));
        kitchenResetForm();
        document.getElementById('kitchen-edit-id').value = String(row.id || '');
        document.getElementById('kitchen-form-title').textContent = '编辑岗位菜品配置';
        document.getElementById('kitchen-form-subtitle').textContent = '可调整执行员工、时间、关键控制点和菜品。';
        document.getElementById('kitchen-save-btn').textContent = '保存修改';
        document.getElementById('kitchen-cancel-edit-btn').style.display = '';
        document.getElementById('kitchen-add-station').value = row.station || '';
        await onKitchenStationChange();
        document.getElementById('kitchen-add-employee').value = row.assignee_username || '';
        Array.from(document.getElementById('kitchen-add-dish').options).forEach(function(option) {
          option.selected = option.value === row.dish_name;
        });
        document.getElementById('kitchen-add-times').value = (row.scheduled_times || []).join(',');
        document.getElementById('kitchen-add-step').value = row.critical_step_name || '';
        document.getElementById('kitchen-add-isprep').checked = !!row.is_prep;
      } catch (e) {
        showNotification('进入编辑失败：' + (e?.message || e), 'error');
      }
    }

    async function onKitchenStationChange() {
      const sel = document.getElementById('kitchen-add-station');
      const dish = document.getElementById('kitchen-add-dish');
      const emp = document.getElementById('kitchen-add-employee');
      if (!sel || !dish || !emp) return;
      const station = sel.value;
      const store = _kitchenStore || currentUser?.store || '';
      if (!station) {
        dish.innerHTML = '<option value="">先选择档口</option>';
        emp.innerHTML = '<option value="">先选择档口</option>';
        return;
      }
      dish.innerHTML = '<option value="">加载中…</option>';
      emp.innerHTML = '<option value="">加载中…</option>';
      try {
        const [dishRes, empRes] = await Promise.all([
          fetch('/api/kitchen/available-dishes', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
          }),
          fetch(`/api/kitchen/station-employees?store=${encodeURIComponent(store)}&station=${encodeURIComponent(station)}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
          })
        ]);
        const data = await dishRes.json();
        const empData = await empRes.json();
        const list = (data.dishes || []).filter(d => d.station === station);
        dish.innerHTML = list.map(d => `<option value="${d.dish_name.replace(/"/g,'&quot;')}">${d.dish_name}</option>`).join('') || '<option value="">暂无菜品</option>';
        const employees = empData.rows || [];
        emp.innerHTML = '<option value="">选择员工</option>' + employees.map(item => `<option value="${item.username.replace(/"/g,'&quot;')}" data-name="${(item.name || '').replace(/"/g,'&quot;')}">${item.name || item.username}${item.position ? ' · ' + item.position : ''}</option>`).join('');
      } catch(e) {
        dish.innerHTML = '<option value="">加载失败</option>';
        emp.innerHTML = '<option value="">加载失败</option>';
      }
    }

    async function kitchenSaveDishConfig() {
      const station       = document.getElementById('kitchen-add-station').value.trim();
      const dishSelect    = document.getElementById('kitchen-add-dish');
      const dishNames     = Array.from(dishSelect?.selectedOptions || []).map(option => option.value.trim()).filter(Boolean);
      const editId        = document.getElementById('kitchen-edit-id').value.trim();
      const employeeSel   = document.getElementById('kitchen-add-employee');
      const assigneeUsername = employeeSel?.value.trim() || '';
      const assigneeName  = employeeSel?.selectedOptions?.[0]?.dataset?.name || employeeSel?.selectedOptions?.[0]?.textContent?.split(' · ')[0] || '';
      const scheduledTimes = document.getElementById('kitchen-add-times').value.trim();
      const criticalStep  = document.getElementById('kitchen-add-step').value.trim();
      const isPrep        = document.getElementById('kitchen-add-isprep').checked;
      const store         = _kitchenStore || currentUser?.store || '';

      if (!station || !dishNames.length || !assigneeUsername) {
        showNotification('请选择档口、员工和至少一道菜品', 'warning'); return;
      }
      if (editId && dishNames.length !== 1) {
        showNotification('编辑模式下仅可保存 1 道菜品', 'warning'); return;
      }
      try {
        const isEdit = !!editId;
        const r = await fetch(isEdit ? ('/api/kitchen/station-dish/' + encodeURIComponent(editId)) : '/api/kitchen/station-dish', {
          method: isEdit ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('hrms_token')}`
          },
          body: JSON.stringify(isEdit
            ? { store, station, dishName: dishNames[0], assigneeUsername, assigneeName, scheduledTimes, isPrep, criticalStepName: criticalStep }
            : { store, station, dishNames, assigneeUsername, assigneeName, scheduledTimes, isPrep, criticalStepName: criticalStep })
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        showNotification(isEdit ? '✅ 配置已更新' : `✅ 已为 ${assigneeName || assigneeUsername} 添加 ${dishNames.length} 道定时任务`, 'success');
        kitchenResetForm();
        loadKitchenMappings();
      } catch(e) {
        showNotification((editId ? '保存失败：' : '添加失败：') + (e?.message || e), 'error');
      }
    }

    async function kitchenRemoveMapping(id) {
      if (!confirm('确定删除这条厨房配置？')) return;
      try {
        const store = _kitchenStore || currentUser?.store || '';
        const r = await fetch('/api/kitchen/station-dish/' + encodeURIComponent(id) + '?store=' + encodeURIComponent(store), {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error || 'delete_failed');
        showNotification('已删除配置', 'success');
        loadKitchenMappings();
      } catch(e) {
        showNotification('删除失败：' + (e?.message || e), 'error');
      }
    }

    async function kitchenSyncSopSteps() {
      const statusEl = document.getElementById('kitchen-sync-status');
      if (statusEl) statusEl.textContent = '同步中…';
      try {
        const r = await fetch('/api/feishu/sync-sop-steps', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || data.error);
        showNotification(`✅ SOP步骤库同步完成：${data.upserted} 条`, 'success');
        if (statusEl) statusEl.textContent = `上次同步：${new Date().toLocaleTimeString('zh-CN')}，${data.upserted} 条`;
      } catch(e) {
        showNotification('同步失败：' + (e?.message || e), 'error');
        if (statusEl) statusEl.textContent = '同步失败';
      }
    }

    // ═══════════════════════════════════════════════════════
    // 配方管理模块 JS  v2 — 原料库 + 半成品 + 工艺步骤
    // ═══════════════════════════════════════════════════════

    // ── 原料库 & 分类缓存 ──────────────────────────────────────
    let _ingredientLibCache = []; // [{id, name, category, brand, spec, default_unit}]
    let _categoryCache      = []; // [{id, name}]

    // ── 加载原料库（填充 datalist）────────────────────────────
    async function loadIngredientLib() {
      try {
        const r = await fetch('/api/ingredients',
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
        const data = await r.json();
        if (!data.success) return;
        _ingredientLibCache = data.ingredients;
        const dl = document.getElementById('ingredient-datalist');
        if (dl) dl.innerHTML = data.ingredients.map(i =>
          `<option value="${i.name.replace(/"/g,'&quot;')}"></option>`).join('');
        return data.ingredients;
      } catch(e) { return []; }
    }

    // ── 加载分类列表 ──────────────────────────────────────────
    async function loadCategories() {
      try {
        const r = await fetch('/api/ingredient-categories',
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
        const data = await r.json();
        if (!data.success) return;
        _categoryCache = data.categories;
        renderCategoryList();
        // 同步更新原料新增表单里的分类 select
        const sel = document.getElementById('ing-lib-category');
        if (sel) {
          const cur = sel.value;
          sel.innerHTML = '<option value="">-- 选择分类 --</option>' +
            data.categories.map(c => `<option value="${c.name.replace(/"/g,'&quot;')}" ${c.name===cur?'selected':''}>${c.name}</option>`).join('');
        }
      } catch(e) {}
    }

    // ── 分类列表渲染（气泡标签） ──────────────────────────────
    function renderCategoryList() {
      const el = document.getElementById('ing-cat-list');
      if (!el) return;
      if (!_categoryCache.length) {
        el.innerHTML = '<span style="font-size:12px;color:rgba(255,255,255,0.2);">暂无分类，请先添加</span>';
        return;
      }
      el.innerHTML = _categoryCache.map(c => `
        <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:20px;font-size:12px;color:var(--rep-text);">
          ${c.name}
          <button type="button" onclick="deleteCategoryItem(${c.id},'${c.name.replace(/'/g,"\\'")}',this)"
            style="background:none;border:none;color:#f87171;cursor:pointer;font-size:13px;line-height:1;padding:0;">×</button>
        </span>`).join('');
    }

    // ── 分类折叠切换 ──────────────────────────────────────────
    function toggleIngCatSection() {
      const sec   = document.getElementById('ing-cat-section');
      const arrow = document.getElementById('ing-cat-arrow');
      const open  = sec.style.display === 'none';
      sec.style.display = open ? '' : 'none';
      arrow.textContent = open ? '▼ 收起' : '▶ 展开';
      if (open) loadCategories();
    }

    // ── 分类：新增 ────────────────────────────────────────────
    async function saveCategoryItem() {
      const name = document.getElementById('ing-cat-name')?.value?.trim();
      if (!name) { showNotification('请填写分类名称', 'warning'); return; }
      try {
        const r = await fetch('/api/ingredient-categories', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
          body: JSON.stringify({ name })
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        document.getElementById('ing-cat-name').value = '';
        showNotification(`✅ 已添加分类：${name}`, 'success');
        await loadCategories();
      } catch(e) { showNotification('添加失败：' + e.message, 'error'); }
    }

    // ── 分类：删除 ────────────────────────────────────────────
    async function deleteCategoryItem(id, name, btn) {
      if (btn._confirming) {
        btn._confirming = false;
        try {
          const r = await fetch(`/api/ingredient-categories/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
          });
          const data = await r.json();
          if (!data.success) throw new Error(data.error);
          showNotification(`已删除分类：${name}`, 'success');
          await loadCategories();
        } catch(e) { showNotification('删除失败：' + e.message, 'error'); }
      } else {
        btn._confirming = true; btn.textContent = '?';
        setTimeout(() => { if (btn._confirming) { btn._confirming = false; btn.textContent = '×'; } }, 3000);
      }
    }

    // ── Tab 切换 ──────────────────────────────────────────────
    function switchRecipeTab(tab) {
      const isRecipes = tab === 'recipes';
      document.getElementById('recipe-panel-wrap').style.display    = isRecipes ? '' : 'none';
      document.getElementById('ingredient-lib-panel').style.display = isRecipes ? 'none' : '';
      const tR = document.getElementById('recipe-tab-recipes');
      const tI = document.getElementById('recipe-tab-ingredients');
      if (tR) {
        tR.style.background  = isRecipes ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)';
        tR.style.borderColor = isRecipes ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)';
        tR.style.color       = isRecipes ? '#a5b4fc' : 'var(--rep-muted)';
      }
      if (tI) {
        tI.style.background  = !isRecipes ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.03)';
        tI.style.borderColor = !isRecipes ? 'rgba(16,185,129,0.4)'  : 'rgba(255,255,255,0.1)';
        tI.style.color       = !isRecipes ? '#6ee7b7' : 'var(--rep-muted)';
      }
      if (!isRecipes) { loadCategories(); loadIngredientLib().then(renderIngredientLibList); }
    }

    // ── 原料库列表渲染（含品牌、规格、编辑） ──────────────────
    function renderIngredientLibList() {
      const list = document.getElementById('ingredient-lib-list');
      if (!list) return;
      if (!_ingredientLibCache.length) {
        list.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.25);font-size:13px;">原料库为空，请先添加原料</div>';
        return;
      }
      const groups = {};
      _ingredientLibCache.forEach(i => {
        const cat = i.category || '未分类';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(i);
      });
      list.innerHTML = Object.entries(groups).map(([cat, items]) => `
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;font-weight:700;color:var(--rep-muted);letter-spacing:.05em;padding:4px 0 6px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:6px;">${cat}</div>
          <div style="display:grid;gap:5px;">
            ${items.map(i => `
              <div id="ing-row-${i.id}" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;overflow:hidden;">
                <!-- 显示行 -->
                <div class="ing-display-row" style="display:flex;align-items:center;gap:8px;padding:8px 12px;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;color:var(--rep-text);font-weight:500;">${i.name}</div>
                    <div style="font-size:11px;color:var(--rep-muted);margin-top:2px;">
                      ${[i.category, i.brand, i.spec, i.default_unit ? '单位：'+i.default_unit : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button type="button" data-click="toggleIngredientEdit" data-arg="${i.id}" data-arg-type="number"
                    style="flex-shrink:0;font-size:11px;padding:4px 9px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);border-radius:6px;color:#a5b4fc;cursor:pointer;">编辑</button>
                  <button type="button" onclick="deleteIngredientLibItem(${i.id},'${i.name.replace(/'/g,"\\'")}',this)"
                    style="flex-shrink:0;font-size:11px;padding:4px 9px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:6px;color:#f87171;cursor:pointer;">删</button>
                </div>
                <!-- 编辑行（默认隐藏）-->
                <div class="ing-edit-row" style="display:none;padding:10px 12px;border-top:1px solid rgba(255,255,255,0.07);background:rgba(99,102,241,0.04);">
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
                    <div>
                      <label style="font-size:10px;color:var(--rep-muted);display:block;margin-bottom:3px;">原料名称</label>
                      <input class="ing-e-name" value="${i.name.replace(/"/g,'&quot;')}" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:var(--rep-text);font-size:12px;box-sizing:border-box;">
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--rep-muted);display:block;margin-bottom:3px;">分类</label>
                      <select class="ing-e-cat" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:var(--rep-text);font-size:12px;box-sizing:border-box;">
                        <option value="">-- 无分类 --</option>
                        ${_categoryCache.map(c => `<option value="${c.name}" ${c.name === i.category ? 'selected' : ''}>${c.name}</option>`).join('')}
                      </select>
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--rep-muted);display:block;margin-bottom:3px;">品牌</label>
                      <input class="ing-e-brand" value="${(i.brand||'').replace(/"/g,'&quot;')}" placeholder="如：福临门" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:var(--rep-text);font-size:12px;box-sizing:border-box;">
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--rep-muted);display:block;margin-bottom:3px;">规格</label>
                      <input class="ing-e-spec" value="${(i.spec||'').replace(/"/g,'&quot;')}" placeholder="如：500ml/瓶" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:var(--rep-text);font-size:12px;box-sizing:border-box;">
                    </div>
                    <div>
                      <label style="font-size:10px;color:var(--rep-muted);display:block;margin-bottom:3px;">默认单位</label>
                      <input class="ing-e-unit" value="${(i.default_unit||'').replace(/"/g,'&quot;')}" placeholder="g / ml / 个" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:7px;color:var(--rep-text);font-size:12px;box-sizing:border-box;">
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;justify-content:flex-end;">
                    <button type="button" data-click="toggleIngredientEdit" data-arg="${i.id}" data-arg-type="number"
                      style="font-size:12px;padding:5px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:var(--rep-muted);cursor:pointer;">取消</button>
                    <button type="button" onclick="saveIngredientLibEdit(${i.id},this)"
                      style="font-size:12px;padding:5px 14px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:7px;color:#a5b4fc;cursor:pointer;">保存</button>
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('');
    }

    function toggleIngredientEdit(id) {
      const row = document.getElementById(`ing-row-${id}`);
      if (!row) return;
      const display = row.querySelector('.ing-display-row');
      const edit    = row.querySelector('.ing-edit-row');
      const isOpen  = edit.style.display !== 'none';
      display.style.display = isOpen ? 'flex' : 'none';
      edit.style.display    = isOpen ? 'none' : '';
      if (!isOpen) row.querySelector('.ing-e-name')?.focus();
    }

    async function saveIngredientLibEdit(id, btn) {
      const row = document.getElementById(`ing-row-${id}`);
      if (!row) return;
      const name = row.querySelector('.ing-e-name')?.value?.trim();
      if (!name) { showNotification('原料名称不能为空', 'warning'); return; }
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        const r = await fetch(`/api/ingredients/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
          body: JSON.stringify({
            name,
            category:     row.querySelector('.ing-e-cat')?.value  || null,
            brand:        row.querySelector('.ing-e-brand')?.value?.trim() || null,
            spec:         row.querySelector('.ing-e-spec')?.value?.trim()  || null,
            default_unit: row.querySelector('.ing-e-unit')?.value?.trim()  || null,
          })
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        showNotification(`✅ 已更新：${name}`, 'success');
        await loadIngredientLib();
        renderIngredientLibList();
      } catch(e) {
        showNotification('保存失败：' + e.message, 'error');
        btn.disabled = false; btn.textContent = '保存';
      }
    }

    // ── 原料库：去重实时检查 ──────────────────────────────────
    function checkIngLibDuplicate(input) {
      const warn = document.getElementById('ing-lib-dup-warn');
      if (!warn) return;
      const name = input.value.trim();
      if (!name) { warn.style.display = 'none'; return; }
      const hit = _ingredientLibCache.find(i => i.name.toLowerCase() === name.toLowerCase());
      if (hit) {
        warn.textContent = `⚠️ 「${hit.name}」已存在（${hit.category || '未分类'}${hit.brand ? ' · ' + hit.brand : ''}），保存将覆盖现有数据`;
        warn.style.display = '';
      } else {
        warn.style.display = 'none';
      }
    }

    // ── 原料库：新增 ─────────────────────────────────────────
    async function saveIngredientLibItem() {
      const name = document.getElementById('ing-lib-name')?.value?.trim();
      if (!name) { showNotification('请填写原料名称', 'warning'); return; }
      // 去重确认
      const hit = _ingredientLibCache.find(i => i.name.toLowerCase() === name.toLowerCase());
      if (hit && !confirm(`「${name}」已存在，是否覆盖更新现有数据？`)) return;
      try {
        const r = await fetch('/api/ingredients', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
          body: JSON.stringify({
            name,
            category:     document.getElementById('ing-lib-category')?.value || null,
            brand:        document.getElementById('ing-lib-brand')?.value?.trim() || null,
            spec:         document.getElementById('ing-lib-spec')?.value?.trim() || null,
            default_unit: document.getElementById('ing-lib-unit')?.value?.trim() || null,
          })
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        document.getElementById('ing-lib-name').value = '';
        document.getElementById('ing-lib-brand').value = '';
        document.getElementById('ing-lib-spec').value = '';
        document.getElementById('ing-lib-unit').value = '';
        const w = document.getElementById('ing-lib-dup-warn');
        if (w) w.style.display = 'none';
        showNotification(hit ? `✅ 已更新原料：${name}` : `✅ 已添加原料：${name}`, 'success');
        await loadIngredientLib();
        renderIngredientLibList();
      } catch(e) {
        showNotification('添加失败：' + e.message, 'error');
      }
    }

    // ── 原料库：删除 ─────────────────────────────────────────
    async function deleteIngredientLibItem(id, name, btn) {
      if (btn._confirming) {
        btn._confirming = false; btn.textContent = '删';
        try {
          const r = await fetch(`/api/ingredients/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
          });
          const data = await r.json();
          if (!data.success) throw new Error(data.error);
          showNotification(`已删除：${name}`, 'success');
          await loadIngredientLib();
          renderIngredientLibList();
        } catch(e) { showNotification('删除失败：' + e.message, 'error'); }
      } else {
        btn._confirming = true; btn.textContent = '确认?';
        setTimeout(() => { if (btn._confirming) { btn._confirming = false; btn.textContent = '删'; } }, 3000);
      }
    }

    // ── 品牌 select 填充 ─────────────────────────────────────────
    async function loadBrandsSelect(currentBrand) {
      const sel = document.getElementById('recipe-brand');
      if (!sel) return;
      try {
        const r = await fetch('/api/brands', { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
        const data = await r.json();
        const brands = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        sel.innerHTML = '<option value="">-- 选择品牌 --</option>';
        brands.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b.name || b.id;
          opt.textContent = b.name || b.id;
          sel.appendChild(opt);
        });
        if (currentBrand) sel.value = currentBrand;
      } catch(e) {
        console.warn('加载品牌失败', e);
      }
    }

    // ── 配方列表（同时预热原料库 + 分类）────────────────────────
    async function loadRecipeList() {
      loadIngredientLib(); // 预热 datalist，不阻塞
      loadCategories();    // 预热分类 select，不阻塞
      const store = _kitchenStore || currentUser?.store || '';
      const list = document.getElementById('recipe-list');
      if (!list) return;
      list.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.25);font-size:13px;">加载中…</div>';
      try {
        const r = await fetch(`/api/recipes?store=${encodeURIComponent(store)}`,
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        if (!data.recipes.length) {
          list.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.25);font-size:13px;">暂无配方，点击「+ 新建配方」开始录入</div>';
          return;
        }
        const statusLabel = { active:'✅ 生效中', draft:'📝 草稿', archived:'📦 已归档' };
        const statusBorder = { active:'rgba(34,197,94,0.2)', draft:'rgba(255,255,255,0.08)', archived:'rgba(255,255,255,0.05)' };
        list.innerHTML = data.recipes.map(r => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid ${statusBorder[r.status]||'rgba(255,255,255,0.08)'};border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;color:var(--rep-text);">${r.dish_name}</div>
              <div style="font-size:11px;color:var(--rep-muted);margin-top:3px;">
                ${r.brand ? `<span style="color:#a5b4fc;">${r.brand}</span> · ` : ''}${r.station ? r.station + ' · ' : ''}v${r.version} · ${statusLabel[r.status]||r.status} · ${r.component_count} 个半成品
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">
              ${r.status !== 'active' ? `<button type="button" onclick="approveRecipe(${r.id},this)"
                style="font-size:12px;padding:6px 12px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.35);border-radius:8px;color:#86efac;cursor:pointer;">✓ 生效</button>` : ''}
              <button type="button" onclick="downloadRecipePdf(${r.id},'${r.dish_name.replace(/'/g,"\\'")}')"
                style="font-size:12px;padding:6px 12px;background:rgba(148,163,184,0.1);border:1px solid rgba(148,163,184,0.25);border-radius:8px;color:#94a3b8;cursor:pointer;">⬇ PDF</button>
              <button type="button" onclick="openRecipeStepViewer(${r.id},'${r.dish_name.replace(/'/g,"\\'")}')"
                style="font-size:12px;padding:6px 12px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.3);border-radius:8px;color:#fcd34d;cursor:pointer;">👁 工艺</button>
              <button type="button" data-click="openRecipeEditor" data-arg="${r.id}" data-arg-type="number"
                style="font-size:12px;padding:6px 12px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);border-radius:8px;color:#a5b4fc;cursor:pointer;">编辑</button>
              <button type="button" onclick="confirmDeleteRecipe(${r.id},'${r.dish_name.replace(/'/g,"\\'")}',this)"
                style="font-size:12px;padding:6px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;color:#f87171;cursor:pointer;">删</button>
            </div>
          </div>`).join('');
      } catch(e) {
        list.innerHTML = `<div style="text-align:center;padding:20px;color:#f87171;font-size:13px;">加载失败：${e.message}</div>`;
      }
    }

    // ── 下载 Excel 模版 ───────────────────────────────────────
    function downloadRecipeTemplate() {
      fetch('/api/recipes/template', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
      })
      .then(r => {
        if (!r.ok) throw new Error('下载失败');
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '配方导入模版.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(e => showNotification('下载失败：' + e.message, 'error'));
    }

    // ── 导入 Excel 配方 ────────────────────────────────────────
    async function importRecipeTemplate(input) {
      if (!input.files?.length) return;
      const file = input.files[0];
      input.value = '';
      showNotification('正在导入…', 'info');
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await fetch('/api/recipes/import', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
          body: fd
        });
        const data = await r.json();
        if (data.success) {
          showNotification(`✅ 已导入「${data.dishName}」（草稿，请检查后生效）`, 'success');
          loadRecipeList();
        } else {
          showNotification('导入失败：' + (data.error || '未知错误'), 'error');
        }
      } catch(e) {
        showNotification('导入失败：' + e.message, 'error');
      }
    }

    // ── 下载 PDF ──────────────────────────────────────────────
    async function downloadRecipePdf(id, dishName) {
      showNotification('正在生成 PDF…', 'info');
      try {
        const r = await fetch(`/api/recipes/${id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        const html = _buildRecipePdfHtml(data.recipe);
        const win = window.open('', '_blank', 'width=820,height=900,scrollbars=yes');
        if (!win) { showNotification('请允许弹出窗口后重试', 'warning'); return; }
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => { try { win.print(); } catch(e) {} }, 600);
      } catch(e) {
        showNotification('生成失败：' + e.message, 'error');
      }
    }

    function _buildRecipePdfHtml(recipe) {
      const statusLabel = { active: '已生效', draft: '草稿', archived: '已归档' };
      const compsHtml = (recipe.components || []).map(comp => {
        const ingRows = (comp.ingredients || []).map(ing =>
          `<tr><td>${ing.ingredient_name}</td><td>${ing.quantity ?? ''}</td><td>${ing.unit || ''}</td><td>${ing.is_pack ? '✓' : ''}</td></tr>`
        ).join('');
        const ingsHtml = ingRows ? `
          <h3>原料配比</h3>
          <table><thead><tr><th>原料名称</th><th>用量</th><th>单位</th><th>料包</th></tr></thead><tbody>${ingRows}</tbody></table>` : '';

        const stepsHtml = (comp.steps || []).length ? `
          <h3>工艺步骤</h3>
          <ol>${comp.steps.map(s => `
            <li>
              <div>${s.instruction}</div>
              ${s.media_url && s.media_type !== 'video' ? `<img src="${location.origin}${s.media_url}" class="step-img">` : ''}
              ${s.media_url && s.media_type === 'video' ? `<div class="step-vid-note">📹 视频参考：${location.origin}${s.media_url}</div>` : ''}
            </li>`).join('')}</ol>` : '';

        return `<div class="comp">
          <h2>🔹 ${comp.name}${comp.notes ? ` <small>${comp.notes}</small>` : ''}</h2>
          ${ingsHtml}${stepsHtml}
        </div>`;
      }).join('');

      return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>${recipe.dish_name} 配方</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:12px;color:#1a1a1a;padding:24px 28px;}
.hd{border-bottom:2.5px solid #1a1a1a;padding-bottom:12px;margin-bottom:18px;}
.hd h1{font-size:22px;font-weight:800;letter-spacing:-.02em;}
.hd .meta{margin-top:5px;font-size:11px;color:#555;}
.hd .meta span{margin-right:16px;}
.comp{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;}
.comp:last-child{border-bottom:none;}
h2{font-size:14px;font-weight:700;border-left:4px solid #6366f1;padding-left:10px;margin-bottom:10px;}
h2 small{font-size:11px;color:#888;font-weight:400;}
h3{font-size:11px;font-weight:700;color:#444;margin:10px 0 5px;text-transform:uppercase;letter-spacing:.04em;}
table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px;}
th,td{border:1px solid #d1d5db;padding:4px 8px;text-align:left;}
th{background:#f3f4f6;font-weight:600;}
ol{padding-left:18px;}
li{margin-bottom:8px;line-height:1.65;}
.step-img{max-width:220px;max-height:160px;border-radius:6px;margin-top:6px;display:block;object-fit:cover;}
.step-vid-note{font-size:10px;color:#6366f1;margin-top:4px;}
.footer{margin-top:18px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#aaa;text-align:center;}
@media print{body{padding:10mm 15mm;}@page{margin:12mm 15mm;}li{page-break-inside:avoid;}}
</style></head><body>
<div class="hd">
  <h1>${recipe.dish_name}</h1>
  <div class="meta">
    ${recipe.brand ? `<span>品牌：${recipe.brand}</span>` : ''}
    ${recipe.station ? `<span>档口：${recipe.station}</span>` : ''}
    <span>版本：v${recipe.version}</span>
    <span>状态：${statusLabel[recipe.status] || recipe.status}</span>
    ${recipe.notes ? `<span>备注：${recipe.notes}</span>` : ''}
  </div>
</div>
${compsHtml || '<p style="color:#888;">暂无半成品数据</p>'}
<div class="footer">生成时间：${new Date().toLocaleString('zh-CN')} · HRMS 配方管理</div>
</body></html>`;
    }

    // ── 配方审核通过 ──────────────────────────────────────────
    async function approveRecipe(id, btn) {
      btn.disabled = true;
      btn.textContent = '处理中…';
      try {
        const r = await fetch(`/api/recipes/${id}/approve`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        showNotification('✅ 配方已审核通过，状态更新为生效中', 'success');
        loadRecipeList();
      } catch(e) {
        showNotification('审核失败：' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = '✓ 审核通过';
      }
    }

    // ── 打开编辑器 ────────────────────────────────────────────
    async function openRecipeEditor(id) {
      await loadIngredientLib(); // 每次打开都刷新，确保下拉列表最新
      document.getElementById('recipe-tab-bar').style.display = 'none'; // 编辑时隐藏 tab
      document.getElementById('recipe-list-panel').style.display = 'none';
      document.getElementById('recipe-editor-panel').style.display = '';
      document.getElementById('recipe-components-list').innerHTML = '';
      document.getElementById('recipe-edit-id').value = id || '';

      if (!id) {
        document.getElementById('recipe-editor-title').textContent = '新建配方';
        document.getElementById('recipe-version-badge').textContent = '';
        document.getElementById('recipe-dish-name').value = '';
        document.getElementById('recipe-station').value = '';
        document.getElementById('recipe-version').value = '1.0';
        document.getElementById('recipe-status').value = 'draft';  // 新建默认草稿
        document.getElementById('recipe-notes').value = '';
        loadBrandsSelect(''); // 加载品牌 select
        addComponentCard(); // 默认一个半成品
        return;
      }

      try {
        const r = await fetch(`/api/recipes/${id}`,
          { headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` } });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        const recipe = data.recipe;
        document.getElementById('recipe-editor-title').textContent = `编辑配方：${recipe.dish_name}`;
        document.getElementById('recipe-version-badge').textContent = `v${recipe.version}`;
        document.getElementById('recipe-dish-name').value = recipe.dish_name;
        document.getElementById('recipe-station').value = recipe.station || '';
        loadBrandsSelect(recipe.brand || ''); // 加载品牌 select 并选中当前值
        document.getElementById('recipe-version').value = recipe.version;
        document.getElementById('recipe-status').value = recipe.status;
        document.getElementById('recipe-notes').value = recipe.notes || '';
        const comps = recipe.components || [];
        comps.forEach(comp => addComponentCard(comp));
        if (!comps.length) addComponentCard();
      } catch(e) {
        showNotification('加载配方失败：' + e.message, 'error');
        closeRecipeEditor();
      }
    }

    function closeRecipeEditor() {
      document.getElementById('recipe-editor-panel').style.display = 'none';
      document.getElementById('recipe-list-panel').style.display = '';
      document.getElementById('recipe-tab-bar').style.display = ''; // 恢复 tab
      loadRecipeList();
    }

    // ── 半成品卡片 ────────────────────────────────────────────
    function addComponentCard(comp = {}) {
      const compList = document.getElementById('recipe-components-list');
      const card = document.createElement('div');
      card.className = 'recipe-comp-card';
      card.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;';
      const inputS = 'width:100%;padding:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--rep-text);font-size:13px;box-sizing:border-box;';
      const nameVal = (comp.name || '').replace(/"/g, '&quot;');
      const notesVal = (comp.notes || '').replace(/"/g, '&quot;');
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="text" placeholder="半成品名称，如：烧鹅皮水" value="${nameVal}"
            style="${inputS}flex:1;font-weight:600;" class="comp-name">
          <button type="button" onclick="this.closest('.recipe-comp-card').remove()"
            style="flex-shrink:0;width:30px;height:30px;border-radius:8px;border:none;background:rgba(239,68,68,0.12);color:#f87171;cursor:pointer;font-size:16px;line-height:1;">×</button>
        </div>
        <input type="text" placeholder="备注（选填）" value="${notesVal}" style="${inputS}" class="comp-notes">

        <div style="font-size:12px;color:var(--rep-muted);font-weight:600;letter-spacing:.5px;margin-bottom:2px;">原料配比</div>
        <div class="comp-ingredients" style="display:flex;flex-direction:column;gap:5px;"></div>
        <button type="button" onclick="addIngredientRow(this.previousElementSibling)"
          style="align-self:flex-start;font-size:12px;padding:5px 12px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);border-radius:8px;color:#a5b4fc;cursor:pointer;">+ 添加原料</button>

        <div style="font-size:12px;color:var(--rep-muted);font-weight:600;letter-spacing:.5px;margin-top:4px;margin-bottom:2px;">工艺步骤</div>
        <div class="comp-steps" style="display:flex;flex-direction:column;gap:5px;"></div>
        <button type="button" onclick="addProcessStepRow(this.previousElementSibling)"
          style="align-self:flex-start;font-size:12px;padding:5px 12px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:8px;color:#6ee7b7;cursor:pointer;">+ 添加工艺步骤</button>
      `;
      compList.appendChild(card);

      const ingContainer  = card.querySelector('.comp-ingredients');
      const stepContainer = card.querySelector('.comp-steps');
      (comp.ingredients || []).forEach(ing => addIngredientRow(ingContainer, ing));
      if (!(comp.ingredients || []).length) addIngredientRow(ingContainer);
      (comp.steps || []).forEach(step => addProcessStepRow(stepContainer, step));
    }

    // ── 原料行（自定义下拉，兼容 iOS Safari）─────────────────────
    function addIngredientRow(container, ing = {}) {
      const row = document.createElement('div');
      // align-items:start 以免下拉撑开行高时其他列跟着移位
      row.style.cssText = 'display:grid;grid-template-columns:1fr 70px 55px 60px 28px;gap:4px;align-items:start;';
      const s = 'width:100%;padding:7px 8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:8px;color:var(--rep-text);font-size:12px;box-sizing:border-box;';
      const nameVal = (ing.ingredient_name || '').replace(/"/g, '&quot;');
      const unitVal = (ing.unit || '').replace(/"/g, '&quot;');
      row.innerHTML = `
        <div style="position:relative;">
          <input type="text" placeholder="搜索原料…" value="${nameVal}"
            style="${s}width:100%;" class="ri-name" autocomplete="off">
          <div class="ri-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;
            max-height:160px;overflow-y:auto;background:#1e1e2a;
            border:1px solid rgba(255,255,255,0.15);border-radius:8px;
            z-index:999;margin-top:3px;box-shadow:0 8px 24px rgba(0,0,0,0.4);"></div>
        </div>
        <input type="number" placeholder="用量" step="0.01" min="0" value="${ing.quantity||''}" style="${s}text-align:right;" class="ri-qty">
        <input type="text"   placeholder="单位" value="${unitVal}" style="${s}text-align:center;" class="ri-unit">
        <label style="display:flex;align-items:center;justify-content:center;gap:3px;cursor:pointer;padding-top:7px;">
          <input type="checkbox" ${ing.is_pack?'checked':''} style="accent-color:#6366f1;" class="ri-pack">
          <span style="font-size:10px;color:var(--rep-muted);">料包</span>
        </label>
        <button type="button" onclick="this.closest('[style*=grid]').remove()"
          style="width:26px;height:26px;margin-top:2px;border-radius:6px;border:none;background:rgba(239,68,68,0.1);color:#f87171;cursor:pointer;font-size:14px;line-height:1;">×</button>`;
      container.appendChild(row);

      const nameInput = row.querySelector('.ri-name');
      const unitInput = row.querySelector('.ri-unit');
      const dropdown  = row.querySelector('.ri-dropdown');

      function showDropdown(q) {
        const list = q
          ? _ingredientLibCache.filter(i => i.name.toLowerCase().includes(q.toLowerCase()))
          : _ingredientLibCache;
        const hits = list.slice(0, 12);
        if (!hits.length) { dropdown.style.display = 'none'; return; }
        dropdown.innerHTML = hits.map(i => `
          <div class="ri-opt"
            style="padding:8px 12px;font-size:12px;color:var(--rep-text);cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);"
            data-name="${i.name.replace(/"/g,'&quot;')}"
            data-unit="${(i.default_unit||'').replace(/"/g,'&quot;')}">
            <span style="font-weight:500;">${i.name}</span>
            ${i.brand  ? `<span style="color:var(--rep-muted);font-size:10px;"> · ${i.brand}</span>` : ''}
            ${i.spec   ? `<span style="color:var(--rep-muted);font-size:10px;"> ${i.spec}</span>` : ''}
            ${i.default_unit ? `<span style="float:right;color:rgba(255,255,255,0.3);font-size:10px;">${i.default_unit}</span>` : ''}
          </div>`).join('');
        dropdown.querySelectorAll('.ri-opt').forEach(opt => {
          opt.addEventListener('mousedown', e => {
            e.preventDefault(); // 阻止 blur 先触发
            nameInput.value = opt.dataset.name;
            if (!unitInput.value) unitInput.value = opt.dataset.unit || '';
            dropdown.style.display = 'none';
          });
          // 移动端 touchstart
          opt.addEventListener('touchstart', e => {
            nameInput.value = opt.dataset.name;
            if (!unitInput.value) unitInput.value = opt.dataset.unit || '';
            dropdown.style.display = 'none';
          }, { passive: true });
        });
        dropdown.style.display = '';
      }

      nameInput.addEventListener('focus', () => { showDropdown(nameInput.value); });
      nameInput.addEventListener('input', () => { showDropdown(nameInput.value); });
      nameInput.addEventListener('blur',  () => { setTimeout(() => { dropdown.style.display = 'none'; }, 200); });
    }

    // ── 工艺步骤行 ────────────────────────────────────────────
    function addProcessStepRow(container, step = {}) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;';
      if (step.media_url) row.dataset.mediaUrl = step.media_url;
      if (step.media_type) row.dataset.mediaType = step.media_type;

      const instrVal = (step.instruction || '').replace(/"/g, '&quot;');
      const inputStyle = 'width:100%;padding:7px 8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:8px;color:var(--rep-text);font-size:12px;box-sizing:border-box;';

      // 媒体预览 HTML
      const mediaHtml = step.media_url ? _buildStepMediaPreview(step.media_url, step.media_type) : '';

      row.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;">
          <input type="text" placeholder="工艺步骤，如：顺时针搅拌至均匀" value="${instrVal}" style="${inputStyle}" class="rs-instruction">
          <label title="上传图片或视频" style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(99,102,241,0.4);background:rgba(99,102,241,0.08);color:#a5b4fc;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">
            📷<input type="file" accept="image/*,video/*" style="display:none;" onchange="uploadStepMedia(this)">
          </label>
          <button type="button" onclick="this.closest('div').parentElement.remove()"
            style="width:32px;height:32px;border-radius:8px;border:none;background:rgba(239,68,68,0.1);color:#f87171;cursor:pointer;font-size:14px;flex-shrink:0;">×</button>
        </div>
        <div class="rs-media-preview" style="${step.media_url ? '' : 'display:none;'}">${mediaHtml}</div>`;
      container.appendChild(row);
    }

    function _buildStepMediaPreview(url, type) {
      if (type === 'video') {
        return `<div style="position:relative;display:inline-block;">
          <video src="${url}" style="max-height:120px;max-width:100%;border-radius:8px;display:block;" controls preload="metadata"></video>
          <button data-click="_removeStepMedia" data-arg-self="1" title="移除视频"
            style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,0.6);color:#fff;font-size:12px;cursor:pointer;line-height:22px;text-align:center;padding:0;">×</button>
        </div>`;
      }
      return `<div style="position:relative;display:inline-block;">
        <img src="${url}" style="max-height:120px;max-width:100%;border-radius:8px;display:block;cursor:pointer;" data-click="openMediaLightbox" data-arg="${url}" data-arg2="image" title="点击查看大图">
        <button data-click="_removeStepMedia" data-arg-self="1" title="移除图片"
          style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,0.6);color:#fff;font-size:12px;cursor:pointer;line-height:22px;text-align:center;padding:0;">×</button>
      </div>`;
    }

    function _removeStepMedia(btn) {
      const row = btn.closest('div[style*="flex-direction:column"]') || btn.closest('.rs-media-preview')?.parentElement;
      if (!row) return;
      delete row.dataset.mediaUrl;
      delete row.dataset.mediaType;
      const preview = row.querySelector('.rs-media-preview');
      if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    }

    async function uploadStepMedia(input) {
      if (!input.files?.length) return;
      const file = input.files[0];
      const row = input.closest('div[style*="flex-direction:column"]');
      if (!row) return;
      const label = input.parentElement;
      const origText = label.childNodes[0]?.textContent || '📷';
      label.childNodes[0].textContent = '⏳';
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/recipes/upload-step-media', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
          body: fd
        });
        const data = await r.json();
        if (!data.ok) throw new Error(data.error || '上传失败');
        row.dataset.mediaUrl = data.url;
        row.dataset.mediaType = data.type;
        const preview = row.querySelector('.rs-media-preview');
        preview.innerHTML = _buildStepMediaPreview(data.url, data.type);
        preview.style.display = '';
        label.childNodes[0].textContent = '✅';
        setTimeout(() => { label.childNodes[0].textContent = '📷'; }, 1500);
      } catch(e) {
        label.childNodes[0].textContent = origText;
        showNotification('上传失败：' + e.message, 'error');
      }
      input.value = '';
    }

    // ── 保存配方 ──────────────────────────────────────────────
    async function saveRecipe() {
      const id = document.getElementById('recipe-edit-id').value || null;
      const dishName = document.getElementById('recipe-dish-name').value.trim();
      if (!dishName) { showNotification('请填写菜品名称', 'warning'); return; }

      // 收集半成品 → 原料 + 工艺步骤
      const components = [];
      document.querySelectorAll('.recipe-comp-card').forEach(card => {
        const name = card.querySelector('.comp-name')?.value?.trim();
        if (!name) return;
        const ingredients = [];
        // .comp-ingredients > div 选中 row div；.ri-name 穿透 wrapper 找到 input
        card.querySelectorAll('.comp-ingredients > div').forEach(row => {
          const ingName = row.querySelector('.ri-name')?.value?.trim();
          if (!ingName) return;
          ingredients.push({
            ingredient_name: ingName,
            quantity:        parseFloat(row.querySelector('.ri-qty')?.value) || null,
            unit:            row.querySelector('.ri-unit')?.value?.trim() || null,
            is_pack:         row.querySelector('.ri-pack')?.checked || false,
          });
        });
        const steps = [];
        card.querySelectorAll('.comp-steps > div').forEach(row => {
          const instr = row.querySelector('.rs-instruction')?.value?.trim();
          if (!instr) return;
          steps.push({
            instruction: instr,
            media_url:   row.dataset.mediaUrl  || null,
            media_type:  row.dataset.mediaType || null,
          });
        });
        components.push({
          name,
          notes: card.querySelector('.comp-notes')?.value?.trim() || null,
          ingredients,
          steps,
        });
      });

      // ── 前端数据验证 ──
      if (!components.length) {
        showNotification('请至少添加一个半成品', 'warning'); return;
      }
      const emptyComp = components.find(c => !c.ingredients.length);
      if (emptyComp) {
        showNotification(`「${emptyComp.name}」没有填写任何原料，请检查`, 'warning'); return;
      }

      const totalIngs  = components.reduce((s, c) => s + c.ingredients.length, 0);
      const totalSteps = components.reduce((s, c) => s + c.steps.length, 0);

      const store = _kitchenStore || currentUser?.store || '*';
      const body = {
        id, dishName, store,
        brand:   document.getElementById('recipe-brand').value.trim() || null,
        station: document.getElementById('recipe-station').value,
        version: document.getElementById('recipe-version').value || '1.0',
        status:  document.getElementById('recipe-status').value,
        notes:   document.getElementById('recipe-notes').value.trim(),
        components,
      };

      // ── 调试日志（生产环境可关注此输出确认结构完整） ──
      console.log('[Recipe Save]', JSON.stringify({
        dishName, components: components.length, totalIngs, totalSteps,
        detail: components.map(c => ({ name: c.name, ings: c.ingredients.length, steps: c.steps.length }))
      }));

      try {
        const r = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` },
          body: JSON.stringify(body)
        });
        const data = await r.json();
        if (!data.success) throw new Error(data.error);
        showNotification(
          `✅ 已存入数据库：${components.length} 个半成品 / ${totalIngs} 条原料 / ${totalSteps} 个步骤`,
          'success'
        );
        closeRecipeEditor();
      } catch(e) {
        showNotification('保存失败：' + e.message, 'error');
      }
    }

    // ── 删除配方 ──────────────────────────────────────────────
    async function confirmDeleteRecipe(id, dishName, btn) {
      if (btn._confirming) {
        btn._confirming = false;
        btn.textContent = '删';
        btn.style.background = 'rgba(239,68,68,0.08)';
        try {
          const r = await fetch(`/api/recipes/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('hrms_token')}` }
          });
          const data = await r.json();
          if (!data.success) throw new Error(data.error);
          showNotification(`已删除配方：${dishName}`, 'success');
          loadRecipeList();
        } catch(e) {
          showNotification('删除失败：' + e.message, 'error');
        }
      } else {
        btn._confirming = true;
        btn.textContent = '确认删?';
        btn.style.background = 'rgba(239,68,68,0.3)';
        setTimeout(() => {
          if (btn._confirming) {
            btn._confirming = false;
            btn.textContent = '删';
            btn.style.background = 'rgba(239,68,68,0.08)';
          }
        }, 3000);
      }
    }

    // ── 进入页面时初始化 + 导航权限控制 ────────────────────
    // 在 showPage 调用链中挂载（通过 showPage 的 pageName === 'kitchen' 分支触发）
    // 详见下方 showPage 补丁
    (function patchShowPageForKitchen() {
      const _origShowPage = typeof showPage === 'function' ? showPage : null;
      if (!_origShowPage) return;
      window.__kitchenShowPagePatched = true;
    })();

    // 厨房导航显示控制：登录后调用
    function updateKitchenNavVisibility() {
      const role = currentUser?.role || '';
      const pos  = (currentUser?.position || '').toLowerCase();
      const isKitchenRole = role === 'store_production_manager';
      const isKitchenPos  = /(后厨|厨房|炒锅|烧味|打荷|砧板|切配|出品|厨师|厨工)/.test(pos);
      const isManager     = ['admin','hq_manager','store_manager'].includes(role);
      const nav = document.getElementById('nav-kitchen');
      if (nav) nav.style.display = (isKitchenRole || isKitchenPos || isManager) ? '' : 'none';
    }
    // ═══════════════════════════════════════════════════════

        // ── 门店营销策略模块 ──
        var __strategyTab = 'experiments';
        var __strategyExperiments = [];
        var __strategyPendingVariants = [];

        function switchStrategyTab(tab) {
            __strategyTab = tab;
            document.querySelectorAll('#sp-tabs .sp-tab').forEach(function(el) {
                el.classList.toggle('sp-tab--active', el.dataset.tab === tab);
            });
            document.getElementById('sp-experiments-view').style.display = tab === 'experiments' ? '' : 'none';
            document.getElementById('sp-pending-view').style.display = tab === 'pending' ? '' : 'none';
            document.getElementById('sp-create-view').style.display = tab === 'create' ? '' : 'none';
            document.getElementById('sp-detail-view').style.display = 'none';
            if (tab === 'experiments') loadStrategyExperiments();
            if (tab === 'pending') loadStrategyPendingVariants();
        }

        function statusLabelZh(s) {
            var m = { pending_approval:'待审批', approved:'已审批', running:'进行中', reviewing:'评估中', completed:'已完成', rejected:'已拒绝', incomplete:'未完成', archived:'已归档' };
            return m[s] || s || '未知';
        }
        function statusBadgeClass(s) {
            var m = { pending_approval:'sp-badge--pending', approved:'sp-badge--approved', running:'sp-badge--running', reviewing:'sp-badge--reviewing', completed:'sp-badge--completed', rejected:'sp-badge--rejected', incomplete:'sp-badge--incomplete' };
            return m[s] || 'sp-badge--pending';
        }
        function fidelityLabelZh(f) {
            var m = { full:'完全执行', partial:'部分执行', failed:'执行失败' };
            return m[f] || f || '部分执行';
        }
        function metricFocusZh(mf) {
            var m = { revenue:'营收', customer_count:'客流', composite:'综合' };
            return m[mf] || mf || '营收';
        }

        async function loadStrategyPage() {
            updateStrategyModuleVisibility();
            switchStrategyTab('experiments');
        }

        async function loadStrategyExperiments() {
            var el = document.getElementById('sp-experiments-view');
            try {
                var resp = await HRMS_API.request('/api/strategy-experiments?limit=50');
                if (!resp || !resp.ok) { el.innerHTML = '<div class="sp-empty">加载失败</div>'; return; }
                __strategyExperiments = resp.experiments || [];
                renderStrategyExperiments();
            } catch(e) {
                el.innerHTML = '<div class="sp-empty">网络错误</div>';
            }
        }

        function renderStrategyExperiments() {
            var el = document.getElementById('sp-experiments-view');
            if (!__strategyExperiments.length) {
                el.innerHTML = '<div class="sp-empty">暂无实验数据</div>';
                return;
            }
            var isAdminOrHq = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER);
            var html = '';
            __strategyExperiments.forEach(function(exp) {
                var variants = Array.isArray(exp.variants) ? exp.variants : [];
                html += '<div class="sp-card" data-click="showStrategyDetail" data-arg="' + exp.experiment_code + '" style="cursor:pointer;">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
                html += '<h3>' + (exp.title || exp.experiment_code) + '</h3>';
                html += '<span class="sp-badge ' + statusBadgeClass(exp.status) + '">' + statusLabelZh(exp.status) + '</span>';
                html += '</div>';
                html += '<div class="sp-row"><span class="label">目标</span><span class="value">' + (exp.goal || '—') + '</span></div>';
                html += '<div class="sp-row"><span class="label">指标侧重</span><span class="value">' + metricFocusZh(exp.metric_focus) + '</span></div>';
                html += '<div class="sp-row"><span class="label">开始日期</span><span class="value">' + (exp.planned_start || '—').slice(0,10) + '</span></div>';
                html += '<div class="sp-row"><span class="label">结束日期</span><span class="value">' + (exp.planned_end || '—').slice(0,10) + '</span></div>';
                if (variants.length) {
                    html += '<div style="margin-top:8px;">';
                    variants.forEach(function(v) {
                        html += '<div class="sp-row"><span class="label">方案' + v.variant_code + '</span><span class="value">' + (v.label || '—') + ' · ' + (v.store || '—') + '</span></div>';
                    });
                    html += '</div>';
                }
                if (isAdminOrHq && exp.status === 'pending_approval') {
                    html += '<div class="sp-actions">';
                    html += '<button class="sp-btn sp-btn--primary" onclick="event.stopPropagation();approveStrategyExperiment(\'' + exp.experiment_code + '\')">审批通过</button>';
                    html += '<button class="sp-btn sp-btn--secondary" onclick="event.stopPropagation();rejectStrategyExperiment(\'' + exp.experiment_code + '\')">拒绝</button>';
                    html += '</div>';
                }
                html += '</div>';
            });
            el.innerHTML = html;
        }

        async function loadStrategyPendingVariants() {
            var el = document.getElementById('sp-pending-view');
            try {
                var resp = await HRMS_API.request('/api/strategy-experiments/pending-for-store');
                if (!resp || !resp.ok) { el.innerHTML = '<div class="sp-empty">加载失败</div>'; return; }
                __strategyPendingVariants = resp.variants || [];
                renderStrategyPendingVariants();
            } catch(e) {
                el.innerHTML = '<div class="sp-empty">网络错误</div>';
            }
        }

        function renderStrategyPendingVariants() {
            var el = document.getElementById('sp-pending-view');
            if (!__strategyPendingVariants.length) {
                el.innerHTML = '<div class="sp-empty">暂无待执行策略</div>';
                return;
            }
            var html = '';
            __strategyPendingVariants.forEach(function(v) {
                var statusZh = v.status === 'executing' ? '执行中' : '待执行';
                html += '<div class="sp-card">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
                html += '<h3>方案' + v.variant_code + '：' + (v.label || '—') + '</h3>';
                html += '<span class="sp-badge ' + (v.status === 'executing' ? 'sp-badge--running' : 'sp-badge--pending') + '">' + statusZh + '</span>';
                html += '</div>';
                html += '<div class="sp-row"><span class="label">实验</span><span class="value">' + (v.experiment_code || '—') + '</span></div>';
                html += '<div class="sp-row"><span class="label">动作</span><span class="value">' + (v.action || '—') + '</span></div>';
                html += '<div class="sp-row"><span class="label">执行指南</span><span class="value">' + (v.execution_guide || '—') + '</span></div>';
                html += '<div class="sp-row"><span class="label">截止日期</span><span class="value">' + (v.planned_end || '—').toString().slice(0,10) + '</span></div>';
                if (v.status === 'pending') {
                    html += '<div class="sp-actions"><button class="sp-btn sp-btn--primary" onclick="startVariantExecution(\'' + v.experiment_code + '\',\'' + v.variant_code + '\')">开始执行</button></div>';
                }
                if (v.status === 'executing' || v.status === 'pending') {
                    html += '<div class="sp-result-form" id="sp-result-form-' + v.experiment_code + '-' + v.variant_code + '">';
                    html += '<h4 style="font-size:13px;font-weight:700;margin:10px 0 6px;color:#e2e8f0;">提交执行结果</h4>';
                    html += '<div class="sp-form-group"><label>执行前日均营收（元）</label><input type="number" id="sp-before-rev-' + v.experiment_code + '-' + v.variant_code + '" placeholder="例：5000"></div>';
                    html += '<div class="sp-form-group"><label>执行期间日均营收（元）</label><input type="number" id="sp-during-rev-' + v.experiment_code + '-' + v.variant_code + '" placeholder="例：6500"></div>';
                    html += '<div class="sp-form-group"><label>执行前日均客流</label><input type="number" id="sp-before-traffic-' + v.experiment_code + '-' + v.variant_code + '" placeholder="例：80"></div>';
                    html += '<div class="sp-form-group"><label>执行期间日均客流</label><input type="number" id="sp-during-traffic-' + v.experiment_code + '-' + v.variant_code + '" placeholder="例：95"></div>';
                    html += '<div class="sp-form-group"><label>额外成本（元，选填）</label><input type="number" id="sp-extra-cost-' + v.experiment_code + '-' + v.variant_code + '" placeholder="例：2000"></div>';
                    html += '<div class="sp-form-group"><label>新增客户数（选填）</label><input type="number" id="sp-new-cust-' + v.experiment_code + '-' + v.variant_code + '" placeholder="例：30"></div>';
                    html += '<div class="sp-form-group"><label>执行保真度</label><select id="sp-fidelity-' + v.experiment_code + '-' + v.variant_code + '"><option value="full">完全执行</option><option value="partial" selected>部分执行</option><option value="failed">执行失败</option></select></div>';
                    html += '<div class="sp-form-group"><label>补充说明</label><textarea id="sp-feedback-' + v.experiment_code + '-' + v.variant_code + '" placeholder="执行情况备注"></textarea></div>';
                    html += '<button class="sp-btn sp-btn--primary" onclick="submitStrategyVariantResult(\'' + v.experiment_code + '\',\'' + v.variant_code + '\')">提交结果</button>';
                    html += '</div>';
                }
                html += '</div>';
            });
            el.innerHTML = html;
        }

        async function showStrategyDetail(code) {
            var el = document.getElementById('sp-detail-view');
            document.getElementById('sp-experiments-view').style.display = 'none';
            document.getElementById('sp-pending-view').style.display = 'none';
            document.getElementById('sp-create-view').style.display = 'none';
            el.style.display = '';
            try {
                var resp = await HRMS_API.request('/api/strategy-experiments/' + code);
                if (!resp || !resp.ok) { el.innerHTML = '<div class="sp-empty">加载失败</div>'; return; }
                renderStrategyDetail(resp);
            } catch(e) {
                el.innerHTML = '<div class="sp-empty">网络错误</div>';
            }
        }

        function renderStrategyDetail(data) {
            var exp = data.experiment || {};
            var variants = data.variants || [];
            var el = document.getElementById('sp-detail-view');
            var isAdminOrHq = currentUser && (currentUser.role === ROLES.ADMIN || currentUser.role === ROLES.HQ_MANAGER);
            var html = '<div class="sp-card">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
            html += '<div><button class="sp-btn sp-btn--secondary" data-click="switchStrategyTab" data-arg="experiments">&larr; 返回列表</button></div>';
            html += '<span class="sp-badge ' + statusBadgeClass(exp.status) + '">' + statusLabelZh(exp.status) + '</span>';
            html += '</div>';
            html += '<h3>' + (exp.title || exp.experiment_code) + '</h3>';
            html += '<div class="sp-row"><span class="label">实验编号</span><span class="value">' + exp.experiment_code + '</span></div>';
            html += '<div class="sp-row"><span class="label">目标</span><span class="value">' + (exp.goal || '—') + '</span></div>';
            html += '<div class="sp-row"><span class="label">指标侧重</span><span class="value">' + metricFocusZh(exp.metric_focus) + '</span></div>';
            html += '<div class="sp-row"><span class="label">开始日期</span><span class="value">' + (exp.planned_start || '—').toString().slice(0,10) + '</span></div>';
            html += '<div class="sp-row"><span class="label">结束日期</span><span class="value">' + (exp.planned_end || '—').toString().slice(0,10) + '</span></div>';
            html += '<div class="sp-row"><span class="label">结果截止</span><span class="value">' + (exp.result_deadline || '—').toString().slice(0,10) + '</span></div>';
            html += '<div class="sp-row"><span class="label">异常类型</span><span class="value">' + (exp.anomaly_type || '—') + '</span></div>';
            if (exp.result_summary) {
                html += '<div class="sp-row"><span class="label">评估结论</span><span class="value">' + (exp.conclusion || '—') + '</span></div>';
            }
            html += '</div>';

            variants.forEach(function(v) {
                html += '<div class="sp-card sp-variant-form' + (v.variant_code === 'B' ? ' sp-variant-form variant-b' : '') + '">';
                html += '<h3>方案' + v.variant_code + '：' + (v.label || '—') + '</h3>';
                html += '<span class="sp-badge ' + statusBadgeClass(v.status) + '">' + statusLabelZh(v.status) + '</span>';
                html += '<div class="sp-row"><span class="label">执行门店</span><span class="value">' + (v.store || '—') + '</span></div>';
                html += '<div class="sp-row"><span class="label">策略动作</span><span class="value">' + (v.action || '—') + '</span></div>';
                if (v.execution_guide) html += '<div class="sp-row"><span class="label">执行指南</span><span class="value">' + v.execution_guide + '</span></div>';
                if (v.result_data) {
                    var rd = typeof v.result_data === 'string' ? JSON.parse(v.result_data) : v.result_data;
                    html += '<div style="margin-top:10px;padding:10px;background:rgba(14,165,233,0.06);border-radius:10px;">';
                    html += '<div class="sp-row"><span class="label">执行前日均营收</span><span class="value">¥' + (rd.before_daily_revenue || '—') + '</span></div>';
                    html += '<div class="sp-row"><span class="label">执行期间日均营收</span><span class="value">¥' + (rd.during_daily_revenue || '—') + '</span></div>';
                    html += '<div class="sp-row"><span class="label">执行前日均客流</span><span class="value">' + (rd.before_daily_traffic || '—') + '</span></div>';
                    html += '<div class="sp-row"><span class="label">执行期间日均客流</span><span class="value">' + (rd.during_daily_traffic || '—') + '</span></div>';
                    if (rd.extra_cost) html += '<div class="sp-row"><span class="label">额外成本</span><span class="value">¥' + rd.extra_cost + '</span></div>';
                    html += '<div class="sp-row"><span class="label">执行保真度</span><span class="value">' + fidelityLabelZh(rd.execution_fidelity) + '</span></div>';
                    if (v.outcome_score != null) {
                        var score = Number(v.outcome_score);
                        var cls = score >= 7 ? 'sp-score--high' : score >= 4 ? 'sp-score--mid' : 'sp-score--low';
                        html += '<div class="sp-row"><span class="label">综合得分</span><span class="sp-score ' + cls + '">' + score.toFixed(1) + '</span></div>';
                    }
                    html += '</div>';
                }
                html += '</div>';
            });

            if (isAdminOrHq && exp.status === 'pending_approval') {
                html += '<div class="sp-actions">';
                html += '<button class="sp-btn sp-btn--primary" data-click="approveStrategyExperiment" data-arg="' + exp.experiment_code + '">审批通过并启动</button>';
                html += '<button class="sp-btn sp-btn--secondary" data-click="rejectStrategyExperiment" data-arg="' + exp.experiment_code + '">拒绝</button>';
                html += '</div>';
            }
            if (isAdminOrHq && exp.status === 'reviewing') {
                html += '<div class="sp-actions">';
                html += '<button class="sp-btn sp-btn--primary" data-click="evaluateStrategyExperiment" data-arg="' + exp.experiment_code + '">评估实验</button>';
                html += '</div>';
            }
            el.innerHTML = html;
        }

        async function approveStrategyExperiment(code) {
            if (!confirm('确认审批通过并启动实验 ' + code + '？')) return;
            try {
                var resp = await HRMS_API.request('/api/strategy-experiments/' + code + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                if (resp && resp.ok) {
                    showNotification('实验已审批通过并启动', 'success');
                    loadStrategyExperiments();
                } else {
                    showNotification('审批失败: ' + (resp?.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('网络错误', 'error');
            }
        }

        async function rejectStrategyExperiment(code) {
            if (!confirm('确认拒绝实验 ' + code + '？')) return;
            try {
                var resp = await HRMS_API.request('/api/strategy-experiments/' + code + '/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                if (resp && resp.ok) {
                    showNotification('实验已拒绝', 'success');
                    loadStrategyExperiments();
                } else {
                    showNotification('拒绝失败: ' + (resp?.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('网络错误', 'error');
            }
        }

        async function startVariantExecution(code, variant) {
            try {
                var resp = await HRMS_API.request('/api/strategy-experiments/' + code + '/variants/' + variant + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                if (resp && resp.ok) {
                    showNotification('已开始执行', 'success');
                    loadStrategyPendingVariants();
                } else {
                    showNotification('操作失败: ' + (resp?.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('网络错误', 'error');
            }
        }

        async function submitStrategyVariantResult(code, variant) {
            var baseId = 'sp-' + code + '-' + variant;
            var beforeRev = parseFloat(document.getElementById('before-rev-' + code + '-' + variant)?.value || document.getElementById('sp-before-rev-' + code + '-' + variant)?.value);
            var duringRev = parseFloat(document.getElementById('during-rev-' + code + '-' + variant)?.value || document.getElementById('sp-during-rev-' + code + '-' + variant)?.value);
            var beforeTraffic = parseInt(document.getElementById('before-traffic-' + code + '-' + variant)?.value || document.getElementById('sp-before-traffic-' + code + '-' + variant)?.value);
            var duringTraffic = parseInt(document.getElementById('during-traffic-' + code + '-' + variant)?.value || document.getElementById('sp-during-traffic-' + code + '-' + variant)?.value);
            var extraCost = parseFloat(document.getElementById('sp-extra-cost-' + code + '-' + variant)?.value) || null;
            var newCustomers = parseInt(document.getElementById('sp-new-cust-' + code + '-' + variant)?.value) || null;
            var fidelityEl = document.getElementById('sp-fidelity-' + code + '-' + variant);
            var fidelity = fidelityEl ? fidelityEl.value : 'partial';
            var feedback = document.getElementById('sp-feedback-' + code + '-' + variant)?.value || '';

            if (isNaN(beforeRev) || isNaN(duringRev) || isNaN(beforeTraffic) || isNaN(duringTraffic)) {
                showNotification('请填写日均营收和日均客流', 'warning');
                return;
            }

            try {
                var resp = await HRMS_API.request('/api/strategy-experiments/' + code + '/variants/' + variant + '/result', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        before_daily_revenue: beforeRev,
                        during_daily_revenue: duringRev,
                        before_daily_traffic: beforeTraffic,
                        during_daily_traffic: duringTraffic,
                        extra_cost: extraCost,
                        new_customers: newCustomers,
                        execution_fidelity: fidelity,
                        feedback: feedback
                    })
                });
                if (resp && resp.ok) {
                    showNotification('结果已提交', 'success');
                    loadStrategyPendingVariants();
                } else {
                    showNotification('提交失败: ' + (resp?.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('网络错误', 'error');
            }
        }

        async function evaluateStrategyExperiment(code) {
            try {
                var resp = await HRMS_API.request('/api/strategy-experiments/' + code + '/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                if (resp && resp.ok) {
                    showNotification('评估完成', 'success');
                    showStrategyDetail(code);
                } else {
                    showNotification('评估失败: ' + (resp?.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('网络错误', 'error');
            }
        }

        function showStrategyCreateForm() {
            switchStrategyTab('create');
            var el = document.getElementById('sp-create-view');
            el.innerHTML = '<div class="sp-card">' +
                '<h3>新建策略实验</h3>' +
                '<div class="sp-form-group"><label>实验标题</label><input type="text" id="sp-new-title" placeholder="例：午市引流方案"></div>' +
                '<div class="sp-form-group"><label>实验目标</label><textarea id="sp-new-goal" placeholder="例：提升午市营收20%"></textarea></div>' +
                '<div class="sp-form-group"><label>指标侧重</label><select id="sp-new-metric"><option value="revenue">营收</option><option value="customer_count">客流</option><option value="composite">综合</option></select></div>' +
                '<div class="sp-form-group"><label>开始日期</label><input type="date" id="sp-new-start"></div>' +
                '<div class="sp-form-group"><label>结束日期（14天实验）</label><input type="date" id="sp-new-end"></div>' +
                '<div class="sp-variant-form"><h4 style="font-size:14px;font-weight:700;color:#38bdf8;margin-bottom:8px;">方案 A</h4>' +
                '<div class="sp-form-group"><label>方案名称</label><input type="text" id="sp-new-va-label" placeholder="例：满减券方案"></div>' +
                '<div class="sp-form-group"><label>策略动作</label><textarea id="sp-new-va-action" placeholder="详细描述策略内容"></textarea></div>' +
                '<div class="sp-form-group"><label>执行门店</label><input type="text" id="sp-new-va-store" placeholder="门店名称"></div>' +
                '<div class="sp-form-group"><label>执行指南（选填）</label><textarea id="sp-new-va-guide" placeholder="具体执行步骤"></textarea></div></div>' +
                '<div class="sp-variant-form variant-b"><h4 style="font-size:14px;font-weight:700;color:#a855f7;margin-bottom:8px;">方案 B（选填，留空则为单方案实验）</h4>' +
                '<div class="sp-form-group"><label>方案名称</label><input type="text" id="sp-new-vb-label" placeholder="例：新菜品推广方案"></div>' +
                '<div class="sp-form-group"><label>策略动作</label><textarea id="sp-new-vb-action" placeholder="详细描述策略内容"></textarea></div>' +
                '<div class="sp-form-group"><label>执行门店</label><input type="text" id="sp-new-vb-store" placeholder="门店名称"></div>' +
                '<div class="sp-form-group"><label>执行指南（选填）</label><textarea id="sp-new-vb-guide" placeholder="具体执行步骤"></textarea></div></div>' +
                '<div class="sp-actions"><button class="sp-btn sp-btn--primary" data-click="createStrategyExperiment">创建实验</button>' +
                '<button class="sp-btn sp-btn--secondary" data-click="switchStrategyTab" data-arg="experiments">取消</button></div>' +
                '</div>';
        }

        async function createStrategyExperiment() {
            var title = document.getElementById('sp-new-title').value.trim();
            var goal = document.getElementById('sp-new-goal').value.trim();
            var metricFocus = document.getElementById('sp-new-metric').value;
            var plannedStart = document.getElementById('sp-new-start').value;
            var plannedEnd = document.getElementById('sp-new-end').value;
            var vaLabel = document.getElementById('sp-new-va-label').value.trim();
            var vaAction = document.getElementById('sp-new-va-action').value.trim();
            var vaStore = document.getElementById('sp-new-va-store').value.trim();
            var vaGuide = document.getElementById('sp-new-va-guide').value.trim();
            var vbLabel = document.getElementById('sp-new-vb-label').value.trim();
            var vbAction = document.getElementById('sp-new-vb-action').value.trim();
            var vbStore = document.getElementById('sp-new-vb-store').value.trim();
            var vbGuide = document.getElementById('sp-new-vb-guide').value.trim();

            if (!title || !goal || !vaAction) {
                showNotification('请填写标题、目标和方案A的动作', 'warning');
                return;
            }

            var variantA = { label: vaLabel || '方案A', action: vaAction, store: vaStore, executionGuide: vaGuide };
            var variantB = null;
            if (vbAction) {
                variantB = { label: vbLabel || '方案B', action: vbAction, store: vbStore, executionGuide: vbGuide };
            }

            try {
                var resp = await HRMS_API.request('/api/strategy-experiments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: title,
                        goal: goal,
                        metricFocus: metricFocus,
                        variantA: variantA,
                        variantB: variantB,
                        plannedStart: plannedStart || undefined,
                        plannedEnd: plannedEnd || undefined
                    })
                });
                if (resp && resp.ok) {
                    showNotification('实验创建成功', 'success');
                    switchStrategyTab('experiments');
                } else {
                    showNotification('创建失败: ' + (resp?.error || '未知错误'), 'error');
                }
            } catch(e) {
                showNotification('网络错误', 'error');
            }
        }

