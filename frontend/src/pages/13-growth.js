/* AUTO-SPLIT from working-fixed.html main <script>
 * file: 13-growth.js
 * lines: 36215-39918 (of 44315)
 * DO NOT add import/export — files are concatenated as a classic script.
 * Edit this file, then: node scripts/bundle-frontend.mjs
 */

        function showGrowthTab(tab) {
            // 兼容旧调用：tab 可为分组名(dashboard/audience/engine/content/execution/settings)或成员名(actions/abtests/…)
            var group = null, member = null;
            for (var gi = 0; gi < GROWTH_GROUPS.length; gi++) { if (GROWTH_GROUPS[gi].key === tab) { group = GROWTH_GROUPS[gi]; break; } }
            if (group) { member = __growthActiveSub[group.key] || group.members[0]; }
            else { group = growthGroupOf(tab); member = tab; }
            if (!group) { group = GROWTH_GROUPS[0]; member = 'dashboard'; }
            __growthActiveSub[group.key] = member;
            __growthActiveTab = member;

            GROWTH_ALL_MEMBERS.forEach(function(name) {
                var content = document.getElementById('growth-' + name + '-content');
                if (content) content.style.display = name === member ? '' : 'none';
            });
            GROWTH_GROUPS.forEach(function(g) {
                var btn = document.getElementById('growth-tab-' + g.key);
                if (btn) { if (g.key === group.key) btn.classList.add('rep-tab--active'); else btn.classList.remove('rep-tab--active'); }
            });
            renderGrowthSubnav(group, member);
            loadGrowthMember(member);
        }

        // ── 支付后发券规则（配置集中在 HRMS，小程序定时同步执行）──
        var PAY_TAG_LABEL = { '': '不限人群', vip: 'VIP', regular: '常规价值', low: '低价值', general: '普通用户', prospect: '潜在新客', new: '新客', active: '活跃客', at_risk: '临界客', dormant: '沉睡老客', churned: '流失客' };
        function payStoreName(sid){ return (window.__GROWTH_STORE_MAP && __GROWTH_STORE_MAP[sid]) || ('门店 ' + (sid||'')); }
        function payMinYuan(triggerValue){ var m = String(triggerValue||'').match(/(\d+)/); var fen = m ? parseInt(m[1],10) : 0; return fen>0 ? (fen/100) : 0; }

        async function loadPaymentRules(){
            var host = document.getElementById('pay-rules-list');
            if (!host) return;
            host.innerHTML = '<div style="color:rgba(242,234,238,0.4);padding:14px 0;">加载中…</div>';
            try {
                var storeFilter = document.getElementById('growth-store-filter')?.value || '';
                var r = await fetch('/api/growth/payment-rules', { headers: growthAuthHeaders() }).then(function(x){return x.json();});
                var rules = (r && r.rules) || [];
                if (storeFilter) rules = rules.filter(function(x){ return String(x.store_id)===storeFilter; });
                window.__PAY_RULES_CACHE = rules;
                if (!rules.length){ host.innerHTML = '<div style="color:rgba(242,234,238,0.4);padding:14px 0;">暂无支付发券规则，请在下方新建。</div>'; return; }
                host.innerHTML = rules.map(function(rule){
                    var tags = Array.isArray(rule.target_tags) ? rule.target_tags : [];
                    var tagTxt = tags.length ? tags.map(function(t){return PAY_TAG_LABEL[t]||t;}).join('、') : '不限人群';
                    var minY = payMinYuan(rule.trigger_value);
                    var minTxt = minY>0 ? ('实付满'+minY+'元') : '无消费门槛';
                    var lim = [];
                    if (rule.daily_user_limit!=null) lim.push('每人'+rule.daily_user_limit+'次/天');
                    if (rule.global_daily_limit!=null) lim.push('全店'+rule.global_daily_limit+'次/天');
                    var statusBadge = rule.active
                        ? '<span style="background:rgba(134,201,162,0.15);color:#86C9A2;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">启用中</span>'
                        : '<span style="background:rgba(151,132,142,0.18);color:#97848E;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">已停用</span>';
                    var rk = escapeHtml(rule.rule_key);
                    return '<div style="border:1px solid rgba(242,234,238,0.08);border-radius:12px;padding:14px;margin-bottom:10px;background:rgba(0,0,0,0.2);">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">'
                        +   '<div style="font-weight:700;color:#fff;font-size:14px;">'+escapeHtml(rule.name||rule.rule_key)+'</div>'+statusBadge+'</div>'
                        + '<div style="color:rgba(242,234,238,0.7);font-size:12px;line-height:1.9;">'
                        +   '门店：'+escapeHtml(payStoreName(rule.store_id))+' · 优先级 '+(rule.priority||0)+'<br>'
                        +   '触发：支付成功后发券（'+minTxt+'）<br>'
                        +   '目标人群：'+escapeHtml(tagTxt)+'<br>'
                        +   '券模板ID：'+escapeHtml(rule.member_template_id||'—')+'<br>'
                        +   (lim.length ? '限额：'+escapeHtml(lim.join(' · '))+'<br>' : '')
                        + '</div>'
                        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">'
                        +   '<button class="btn btn-secondary" type="button" style="font-size:12px;" data-click="editPaymentRule" data-arg="'+rk+'">编辑</button>'
                        +   '<button class="btn btn-secondary" type="button" style="font-size:12px;" data-click="togglePaymentRule" data-arg="'+rk+'" data-arg2="'+(rule.active?'false':'true')+'">'+(rule.active?'停用':'启用')+'</button>'
                        +   '<button class="btn btn-secondary" type="button" style="font-size:12px;color:#E58B98;" data-click="deletePaymentRule" data-arg="'+rk+'">删除</button>'
                        + '</div></div>';
                }).join('');
            } catch(e){
                host.innerHTML = '<div style="color:#E58B98;padding:14px 0;">加载失败：'+escapeHtml(String(e&&e.message||e))+'</div>';
            }
        }

        function resetPaymentRuleForm(){
            ['pay-rule-key','pay-name','pay-template'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
            var p=document.getElementById('pay-priority'); if(p) p.value='100';
            var m=document.getElementById('pay-minspend'); if(m) m.value='0';
            ['pay-daily-user','pay-daily-global'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
            var t=document.getElementById('pay-tag'); if(t) t.value='';
            var a=document.getElementById('pay-active'); if(a) a.checked=true;
        }

        function editPaymentRule(ruleKey){
            var rule=(window.__PAY_RULES_CACHE||[]).filter(function(x){return x.rule_key===ruleKey;})[0];
            if(!rule) return;
            document.getElementById('pay-rule-key').value=rule.rule_key;
            document.getElementById('pay-name').value=rule.name||'';
            document.getElementById('pay-store').value=String(rule.store_id||'51866138');
            var tags=Array.isArray(rule.target_tags)?rule.target_tags:[];
            document.getElementById('pay-tag').value=tags[0]||'';
            document.getElementById('pay-priority').value=rule.priority||100;
            document.getElementById('pay-minspend').value=payMinYuan(rule.trigger_value)||0;
            document.getElementById('pay-daily-user').value=rule.daily_user_limit==null?'':rule.daily_user_limit;
            document.getElementById('pay-daily-global').value=rule.global_daily_limit==null?'':rule.global_daily_limit;
            document.getElementById('pay-template').value=rule.member_template_id||'';
            document.getElementById('pay-active').checked=!!rule.active;
            try{ document.getElementById('pay-rules-list').scrollIntoView({behavior:'smooth'}); }catch(e){}
        }

        async function savePaymentRule(){
            var name=(document.getElementById('pay-name').value||'').trim();
            var storeId=document.getElementById('pay-store').value||'';
            var templateId=(document.getElementById('pay-template').value||'').trim();
            if(!name) return showNotification('请填写规则名称','error');
            if(!templateId) return showNotification('请填写关联券模板ID','error');
            var minYuan=Math.max(0, Math.floor(Number(document.getElementById('pay-minspend').value)||0));
            var tag=document.getElementById('pay-tag').value||'';
            var du=document.getElementById('pay-daily-user').value;
            var dg=document.getElementById('pay-daily-global').value;
            var body={
                rule_key: document.getElementById('pay-rule-key').value||'',
                store_id: storeId,
                name: name,
                active: document.getElementById('pay-active').checked,
                priority: Math.max(0, Math.floor(Number(document.getElementById('pay-priority').value)||0)),
                target_tags: tag? [tag] : [],
                trigger_value: String(minYuan*100),
                member_template_id: templateId,
                daily_user_limit: du===''?null:Math.max(0,Math.floor(Number(du)||0)),
                global_daily_limit: dg===''?null:Math.max(0,Math.floor(Number(dg)||0))
            };
            try{
                var r=await fetch('/api/growth/payment-rules',{method:'POST',headers:growthAuthHeaders(),body:JSON.stringify(body)}).then(function(x){return x.json();});
                if(!r||!r.ok) throw new Error((r&&r.error)||'保存失败');
                showNotification('已保存，约2分钟内同步到小程序生效','success');
                resetPaymentRuleForm();
                loadPaymentRules();
            }catch(e){ showNotification('保存失败：'+(e.message||e),'error'); }
        }

        async function togglePaymentRule(ruleKey, toActive){
            var rule=(window.__PAY_RULES_CACHE||[]).filter(function(x){return x.rule_key===ruleKey;})[0];
            if(!rule) return;
            var body={
                rule_key: rule.rule_key, store_id: rule.store_id, name: rule.name,
                active: !!toActive, priority: rule.priority||0,
                target_tags: Array.isArray(rule.target_tags)?rule.target_tags:[],
                trigger_value: rule.trigger_value||'', member_template_id: rule.member_template_id||'',
                daily_user_limit: rule.daily_user_limit, global_daily_limit: rule.global_daily_limit
            };
            try{
                var r=await fetch('/api/growth/payment-rules',{method:'POST',headers:growthAuthHeaders(),body:JSON.stringify(body)}).then(function(x){return x.json();});
                if(!r||!r.ok) throw new Error((r&&r.error)||'操作失败');
                showNotification(toActive?'已启用':'已停用','success');
                loadPaymentRules();
            }catch(e){ showNotification('操作失败：'+(e.message||e),'error'); }
        }

        async function deletePaymentRule(ruleKey){
            var ok = await hrmsConfirm({title:'删除规则',message:'确定删除该支付发券规则？删除后小程序约2分钟内同步移除。',okText:'确认删除',icon:'🗑️'});
            if(!ok) return;
            try{
                var r=await fetch('/api/growth/payment-rules/'+encodeURIComponent(ruleKey),{method:'DELETE',headers:growthAuthHeaders()}).then(function(x){return x.json();});
                if(!r||!r.ok) throw new Error((r&&r.error)||'删除失败');
                showNotification('已删除','success');
                loadPaymentRules();
            }catch(e){ showNotification('删除失败：'+(e.message||e),'error'); }
        }

    // 增长移动端导航权限
    try {
      updateGrowthModuleVisibility();
      updateStrategyModuleVisibility();
    } catch(e) {}

    // Phase 8: 增长模块仅管理员/总部可见
    try {
      updateGrowthModuleVisibility();
      updateStrategyModuleVisibility();
    } catch(e) {}

    // 门店营销策略模块
    try {
      updateStrategyModuleVisibility();
    } catch(e) {}

        function growthCsvList(id) {
            return String(document.getElementById(id)?.value || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean);
        }

        async function loadWechatWorkStats() {
            try {
                const r = await fetch('/api/growth/wechat-work/stats', { headers: growthAuthHeaders() });
                const data = await r.json();
                const rows = data?.stats || [];
                const host = document.getElementById('wecom-stats');
                host.innerHTML = rows.length ? rows.map(function(x) {
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:13px;">'
                        + '<strong>' + (x.store_id || '未分配门店') + '</strong>'
                        + ' · 总数 ' + (x.total_count || 0)
                        + ' · 已绑定 ' + (x.bound_count || 0)
                        + ' · 未绑定 ' + (x.unbound_count || 0)
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无企微统计</div>';
            } catch (e) {
                document.getElementById('wecom-stats').innerHTML = '<div style="color:#E58B98;">加载企微统计失败</div>';
            }
        }

        async function loadWechatWorkCustomers() {
            try {
                const store = document.getElementById('growth-store-filter')?.value || '';
                const url = '/api/growth/wechat-work/customers' + (store ? ('?store_id=' + encodeURIComponent(store)) : '');
                const r = await fetch(url, { headers: growthAuthHeaders() });
                const data = await r.json();
                const rows = data?.customers || [];
                const host = document.getElementById('wecom-customers-list');
                host.innerHTML = rows.length ? rows.map(function(x) {
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:13px;">'
                        + '<div style="color:#fff;font-weight:600;">' + (x.name || '-') + ' · ' + (x.phone || '-') + '</div>'
                        + '<div style="color:rgba(242,234,238,0.6);margin-top:4px;">门店: ' + (x.store_id || '-') + ' · external_userid: ' + (x.external_userid || '-') + '</div>'
                        + '<div style="color:' + (x.bind_customer_id ? '#86C9A2' : '#CFA14A') + ';margin-top:4px;">' + (x.bind_customer_id ? ('已绑定客户 #' + x.bind_customer_id) : '未绑定') + '</div>'
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无企微客户</div>';
            } catch (e) {
                document.getElementById('wecom-customers-list').innerHTML = '<div style="color:#E58B98;">加载企微客户失败</div>';
            }
        }

        async function showWechatImportDialog() {
            // 先加载已有配置
            var currentConfig = null;
            try {
                var cr = await fetch('/api/growth/feishu-config', { headers: growthAuthHeaders() });
                var cd = await cr.json();
                currentConfig = cd?.config || null;
            } catch (e) { /* ignore */ }
            var msg = '配置飞书多维表格自动同步';
            if (currentConfig && currentConfig.app_token) {
                msg = '当前配置：\napp_token: ' + currentConfig.app_token.slice(0, 8) + '...\ntable_id: ' + currentConfig.table_id.slice(0, 8) + '...\n\n如需修改请重新输入';
            }
            var appToken = prompt(msg + '\n\n请输入飞书 app_token', currentConfig?.app_token || '');
            if (!appToken) return;
            var tableId = prompt('请输入飞书 table_id', currentConfig?.table_id || '');
            if (!tableId) return;
            try {
                showNotification('正在保存配置并导入飞书数据，请稍候...', 'info');
                // 保存配置（持久化，供定时任务自动同步）
                var saveR = await fetch('/api/growth/feishu-config', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify({ app_token: appToken, table_id: tableId })
                });
                var saveData = await saveR.json();
                if (!saveData.ok) throw new Error(saveData.error || 'save_failed');
                // 立即执行一次导入
                var r = await fetch('/api/growth/wechat-work/import-feishu', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify({ app_token: appToken, table_id: tableId })
                });
                var data = await r.json();
                if (!data.ok) throw new Error(data.error || 'import_failed');
                showNotification('配置已保存，导入成功：' + (data.imported || 0) + ' 条，匹配 ' + (data.matched || 0) + ' 条', 'success');
                loadWechatWorkStats();
                loadWechatWorkCustomers();
            } catch (e) {
                showNotification('操作失败：' + (e?.message || e), 'error');
            }
        }

        async function showImportWechatCsv() {
            var f = document.getElementById('csv-upload-input');
            if (!f) {
                f = document.createElement('input');
                f.type = 'file';
                f.id = 'csv-upload-input';
                f.accept = '.csv,.xlsx,.xls';
                f.style.display = 'none';
                document.body.appendChild(f);
                f.onchange = function() {
                    var file = f.files[0];
                    if (!file) return;
                    var reader = new FileReader();
                    reader.onload = function(e) {
                        var text = e.target.result;
                        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
                        if (lines.length < 2) { showNotification('CSV文件至少需要表头+1行数据', 'warning'); return; }
                        var customers = [];
                        for (var i = 1; i < lines.length; i++) {
                            var cols = lines[i].split(',').map(function(c) { return c.trim().replace(/\"/g, ''); });
                            if (cols[0] || cols[1]) {
                                customers.push({
                                    name: cols[0] || '',
                                    phone: cols[1] || '',
                                    external_userid: cols[2] || '',
                                    store_id: cols[3] || '',
                                    note: cols[4] || ''
                                });
                            }
                        }
                        if (customers.length === 0) { showNotification('未找到有效数据行', 'warning'); return; }
                        showNotification('解析到 ' + customers.length + ' 条记录，正在导入...', 'info');
                        fetch('/api/growth/wechat-work/customers', {
                            method: 'POST',
                            headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                            body: JSON.stringify({ customers: customers })
                        }).then(function(r) { return r.json(); }).then(function(data) {
                            if (!data.ok) throw new Error(data.error || 'import_failed');
                            showNotification('导入成功：' + (data.imported || 0) + ' 条，匹配 ' + (data.matched || 0) + ' 条', 'success');
                        }).catch(function(e) {
                            showNotification('导入失败：' + (e?.message || e), 'error');
                        });
                    };
                    reader.readAsText(file);
                };
            }
            f.click();
        }

        async function showWechatManualDialog() {
            const raw = prompt('请输入 JSON 数组，如 [{"phone":"138...","name":"张三","store_id":"store_1"}]');
            if (!raw) return;
            try {
                const customers = JSON.parse(raw);
                const r = await fetch('/api/growth/wechat-work/customers', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify({ customers: customers })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'save_failed');
                showNotification('手动导入成功：' + (data.imported || 0) + ' 条', 'success');
                loadWechatWorkStats();
                loadWechatWorkCustomers();
            } catch (e) {
                showNotification('手动导入失败：' + (e?.message || e), 'error');
            }
        }

        async function loadWecomFullDashboard() {
            try {
                // 显示飞书自动同步配置状态
                var configHost = document.getElementById('wecom-feishu-status');
                if (!configHost) {
                    configHost = document.createElement('div');
                    configHost.id = 'wecom-feishu-status';
                    var statsHost = document.getElementById('wecom-stats');
                    if (statsHost && statsHost.parentNode) statsHost.parentNode.insertBefore(configHost, statsHost);
                }
                try {
                    var fc = await fetch('/api/growth/feishu-config', { headers: growthAuthHeaders() });
                    var fd = await fc.json();
                    if (fd?.config?.app_token) {
                        configHost.innerHTML = '<div style="padding:8px 12px;margin-bottom:12px;background:rgba(134,201,162,0.08);border:1px solid rgba(134,201,162,0.2);border-radius:8px;font-size:12px;color:#86C9A2;">✅ 飞书自动同步已配置 (app_token: ' + fd.config.app_token.slice(0, 8) + '...) — 系统每小时自动同步</div>';
                    } else {
                        configHost.innerHTML = '<div style="padding:8px 12px;margin-bottom:12px;background:rgba(207,161,74,0.08);border:1px solid rgba(207,161,74,0.2);border-radius:8px;font-size:12px;color:#CFA14A;">⚠️ 未配置飞书同步。点击「飞书导入/配置」按钮设置，设置后系统将每小时自动同步企微客户数据</div>';
                    }
                } catch (e) { /* ignore */ }
                const r = await fetch('/api/growth/wechat-work/stats', { headers: growthAuthHeaders() });
                const data = await r.json();
                const rows = data?.stats || [];
                const host = document.getElementById('wecom-stats');
                host.innerHTML = rows.length ? rows.map(function(x) {
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:13px;">'
                        + '<strong>' + (x.store_id || '未分配门店') + '</strong>'
                        + ' · 总数 ' + (x.total_count || 0)
                        + ' · 已绑定 ' + (x.bound_count || 0)
                        + ' · 未绑定 ' + (x.unbound_count || 0)
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无企微统计</div>';
                // Show unbound customers section
                const unboundSection = document.getElementById('wecom-unbound-section');
                if (unboundSection) {
                    var totalUnbound = rows.reduce(function(s, r) { return s + (r.unbound || r.unbound_count || 0); }, 0);
                    unboundSection.style.display = totalUnbound > 0 ? 'block' : 'none';
                    if (totalUnbound > 0) {
                        loadWechatWorkCustomers();
                    }
                }
            } catch (e) {
                document.getElementById('wecom-stats').innerHTML = '<div style="color:#E58B98;">加载企微统计失败</div>';
            }
        }

        var _marketingTemplates = [];
        var _matchedPosterId = null;

        async function loadMarketingTemplates() {
            try {
                var r = await fetch('/api/growth/marketing-templates', { headers: growthAuthHeaders() });
                var data = await r.json();
                _marketingTemplates = data.templates || [];
                var sel = document.getElementById('camp-template');
                if (sel) {
                    sel.innerHTML = '<option value="">— 从营销模板创建（可选）—</option>';
                    _marketingTemplates.forEach(function(t) {
                        var opt = document.createElement('option');
                        opt.value = t.id;
                        opt.textContent = t.name + '（' + (t.category || '') + ' · ROI ' + (t.expected_roi || '?') + ' · 成功率 ' + Math.round((t.success_rate || 0) * 100) + '% · 已用' + (t.use_count || 0) + '次）';
                        sel.appendChild(opt);
                    });
                }
            } catch (e) { console.error('loadMarketingTemplates:', e); }
        }

        async function matchPosterForTemplate(channel) {
            _matchedPosterId = null;
            var posterDiv = document.getElementById('camp-matched-poster');
            var posterInfo = document.getElementById('camp-matched-poster-info');
            if (!posterDiv || !posterInfo) return;
            try {
                var purposeMap = { 'miniprogram': '拉新', 'wecom': '召回', 'xiaohongshu': '品宣', 'douyin': '拉新', 'dianping': '促销', 'waimai': '促销' };
                var channelMap = { 'miniprogram': '企微', 'wecom': '企微', 'xiaohongshu': '小红书', 'douyin': '抖音', 'dianping': '大众点评', 'waimai': '美团' };
                var purpose = purposeMap[channel] || '品宣';
                var ch = channelMap[channel] || '';
                var url = '/api/growth/content-library?purpose=' + encodeURIComponent(purpose);
                if (ch) url += '&channel=' + encodeURIComponent(ch);
                url += '&limit=5';
                var r = await fetch(url, { headers: growthAuthHeaders() });
                var data = await r.json();
                var posters = data.posters || [];
                if (posters.length > 0) {
                    _matchedPosterId = posters[0].id;
                    posterDiv.style.display = 'block';
                    posterInfo.innerHTML = '✅ 匹配到 <b>' + posters.length + '</b> 张海报，推荐：「' + escapeHtml(posters[0].title || '未命名') + '」';
                } else {
                    posterDiv.style.display = 'none';
                }
            } catch (e) {
                posterDiv.style.display = 'none';
            }
        }

        function applyMarketingTemplate() {
            var sel = document.getElementById('camp-template');
            var hint = document.getElementById('camp-template-hint');
            var id = sel ? sel.value : '';
            if (!id) {
                if (hint) hint.style.display = 'none';
                document.getElementById('camp-matched-poster').style.display = 'none';
                _matchedPosterId = null;
                return;
            }
            var tpl = _marketingTemplates.find(function(t) { return String(t.id) === String(id); });
            if (!tpl) return;
            var pt = tpl.payload_template || {};
            var fields = {
                'camp-title': tpl.name || '',
                'camp-channel': tpl.channel || 'miniprogram',
                'camp-audience': tpl.target_audience || 'all',
                'camp-budget': pt.budget_fen ? String(pt.budget_fen) : '',
                'camp-coupon-value': pt.coupon_value_fen ? String(pt.coupon_value_fen) : '',
                'camp-detail': (tpl.description || '') + (tpl.actions ? '\n执行步骤：' + (Array.isArray(tpl.actions) ? tpl.actions.join(' → ') : '') : '')
            };
            Object.keys(fields).forEach(function(fid) {
                var el = document.getElementById(fid);
                if (el && fields[fid]) el.value = fields[fid];
            });
            var endDate = new Date(Date.now() + (tpl.duration_days || 7) * 86400000);
            var endEl = document.getElementById('camp-end');
            if (endEl && !endEl.value) endEl.value = endDate.toISOString().slice(0, 10);
            var startEl = document.getElementById('camp-start');
            if (startEl && !startEl.value) startEl.value = new Date().toISOString().slice(0, 10);
            if (hint) {
                hint.innerHTML = '📋 ' + escapeHtml(tpl.name) + '：' + escapeHtml(tpl.description || '') + ' | 预算' + escapeHtml(tpl.budget_range || '?') + '元 · ' + (tpl.duration_days || 7) + '天 · ROI ' + (tpl.expected_roi || '?') + ' · 成功率 ' + Math.round((tpl.success_rate || 0) * 100) + '% · 已用' + (tpl.use_count || 0) + '次';
                hint.style.display = 'block';
            }
            matchPosterForTemplate(tpl.channel || 'miniprogram');
        }

         function showCreateCampaignForm() {
             var form = document.getElementById('campaign-create-form');
             if (form) {
                 form.style.display = form.style.display === 'none' ? 'block' : 'none';
                 if (form.style.display !== 'none') {
                     loadMarketingTemplates();
                     populateCampStoreSelect();
                     var list = document.getElementById('campaign-plans-list');
                     if (list && form.parentElement === list.parentElement && form.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_PRECEDING) {
                         list.parentElement.insertBefore(form, list);
                     }
                     try { form.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
                 }
             }
         }

         function populateCampStoreSelect() {
             var sel = document.getElementById('camp-store');
             if (!sel) return;
             var currentVal = sel.value;
             sel.innerHTML = '<option value="">选择门店</option>';
             Object.keys(__GROWTH_STORE_MAP).forEach(function(k) {
                 var opt = document.createElement('option');
                 opt.value = k;
                 opt.textContent = __GROWTH_STORE_MAP[k];
                 sel.appendChild(opt);
             });
             if (currentVal) sel.value = currentVal;
             var mainStore = document.getElementById('growth-store-filter')?.value;
             if (mainStore && !sel.value) sel.value = mainStore;
         }

        /* ── Store WeCom Config ── */
        let __editWecomStoreId = '';

        async function loadStoreWecomConfigs() {
            try {
                var host = document.getElementById('store-wecom-configs-list');
                host.innerHTML = '<div style="color:var(--rep-muted);padding:12px;">加载中...</div>';
                var r = await fetch('/api/growth/store-wecom-configs', { headers: growthAuthHeaders() });
                var data = await r.json();
                var configs = data?.configs || [];
                if (!configs.length) {
                    host.innerHTML = '<div style="color:var(--rep-muted);padding:12px;">暂无门店企微配置，点击上方「新增配置」添加</div>';
                    return;
                }
                var html = configs.map(function(c) {
                    return '<div style="padding:12px 14px;margin-bottom:8px;background:rgba(242,234,238,0.04);border:1px solid rgba(242,234,238,0.08);border-radius:12px;display:flex;align-items:center;justify-content:space-between;">'
                        + '<div><strong style="color:var(--rep-gold);">' + escHtml(c.store_id) + '</strong>'
                        + '<div style="font-size:12px;color:var(--rep-muted);margin-top:2px;">CorpID: ' + escHtml(c.corp_id) + ' | AgentID: ' + escHtml(c.agent_id || '-') + '</div></div>'
                        + '<div style="display:flex;gap:6px;">'
                        + '<button data-click="editStoreWecomConfig" data-arg="' + escHtml(c.store_id) + '" style="padding:6px 12px;border:1px solid rgba(242,234,238,0.15);border-radius:8px;background:transparent;color:var(--rep-text);cursor:pointer;">编辑</button>'
                        + '<button data-click="deleteStoreWecomConfig" data-arg="' + escHtml(c.store_id) + '" style="padding:6px 12px;border:1px solid rgba(229,139,152,0.4);border-radius:8px;background:transparent;color:#E58B98;cursor:pointer;">删除</button>'
                        + '</div></div>';
                }).join('');
                host.innerHTML = html;
            } catch (e) {
                document.getElementById('store-wecom-configs-list').innerHTML = '<div style="color:#E58B98;padding:12px;">加载失败: ' + (e.message || e) + '</div>';
            }
        }

        function showAddStoreWecomConfig() {
            __editWecomStoreId = '';
            document.getElementById('wecom-config-modal-title').textContent = '新增门店企微配置';
            ['wecom-store-id','wecom-corp-id','wecom-corp-secret','wecom-agent-id','wecom-sender-userid'].forEach(function(id) {
                document.getElementById(id).value = '';
            });
            document.getElementById('store-wecom-config-modal').style.display = 'flex';
        }

        function editStoreWecomConfig(storeId) {
            __editWecomStoreId = storeId;
            document.getElementById('wecom-config-modal-title').textContent = '编辑门店企微配置 - ' + storeId;
            fetch('/api/growth/store-wecom-configs', { headers: growthAuthHeaders() })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var configs = data?.configs || [];
                    var c = configs.find(function(x) { return x.store_id === storeId; });
                    if (!c) return;
                    document.getElementById('wecom-store-id').value = c.store_id;
                    document.getElementById('wecom-corp-id').value = c.corp_id;
                    document.getElementById('wecom-corp-secret').value = c.corp_secret;
                    document.getElementById('wecom-agent-id').value = c.agent_id || '';
                    document.getElementById('wecom-sender-userid').value = c.sender_userid || '';
                    document.getElementById('store-wecom-config-modal').style.display = 'flex';
                })
                .catch(function() {});
        }

        function closeStoreWecomConfigModal() {
            document.getElementById('store-wecom-config-modal').style.display = 'none';
        }

        async function saveStoreWecomConfig() {
            var payload = {
                store_id: document.getElementById('wecom-store-id').value.trim(),
                corp_id: document.getElementById('wecom-corp-id').value.trim(),
                corp_secret: document.getElementById('wecom-corp-secret').value.trim(),
                agent_id: document.getElementById('wecom-agent-id').value.trim(),
                sender_userid: document.getElementById('wecom-sender-userid').value.trim()
            };
            if (!payload.store_id || !payload.corp_id || !payload.corp_secret) {
                alert('门店ID、企业ID和Secret为必填项');
                return;
            }
            try {
                var r = await fetch('/api/growth/store-wecom-configs', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, growthAuthHeaders()),
                    body: JSON.stringify(payload)
                });
                var data = await r.json();
                if (data.ok) {
                    closeStoreWecomConfigModal();
                    loadStoreWecomConfigs();
                } else {
                    alert('保存失败: ' + (data.error || ''));
                }
            } catch (e) {
                alert('保存失败: ' + (e.message || e));
            }
        }

        async function deleteStoreWecomConfig(storeId) {
            if (!confirm('确定删除门店 ' + storeId + ' 的企微配置？')) return;
            try {
                var r = await fetch('/api/growth/store-wecom-configs/' + encodeURIComponent(storeId), {
                    method: 'DELETE',
                    headers: growthAuthHeaders()
                });
                var data = await r.json();
                if (data.ok) {
                    loadStoreWecomConfigs();
                } else {
                    alert('删除失败: ' + (data.error || ''));
                }
            } catch (e) {
                alert('删除失败: ' + (e.message || e));
            }
        }

        async function triggerSyncAllWecomContacts() {
            if (!confirm('确定要同步所有门店的企微客户列表？此操作可能需要几分钟。')) return;
            try {
                var host = document.getElementById('store-wecom-configs-list');
                host.innerHTML = '<div style="color:var(--rep-muted);padding:12px;">同步中...</div>';
                var r = await fetch('/api/growth/sync-wecom-contacts', {
                    method: 'POST',
                    headers: growthAuthHeaders()
                });
                var data = await r.json();
                if (data.ok) {
                    var summary = (data.results || []).map(function(x) {
                        return x.store_id + ': 同步' + x.synced + '人';
                    }).join('<br>');
                    host.innerHTML = '<div style="color:#86C9A2;padding:12px;">同步完成！<br>' + summary + '</div>';
                    setTimeout(loadStoreWecomConfigs, 2000);
                } else {
                    host.innerHTML = '<div style="color:#E58B98;padding:12px;">同步失败: ' + (data.error || '') + '</div>';
                }
            } catch (e) {
                document.getElementById('store-wecom-configs-list').innerHTML = '<div style="color:#E58B98;padding:12px;">同步失败: ' + (e.message || e) + '</div>';
            }
        }

        function escHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        async function createCampaignFromForm() {
            try {
                const payload = {
                    plan_id: 'plan_' + Date.now(),
                    campaign_id: 'campaign_' + Date.now(),
                    store_id: document.getElementById('camp-store')?.value || '',
                    title: document.getElementById('camp-title')?.value || '',
                    channel: document.getElementById('camp-channel')?.value || 'miniprogram',
                    target_audience: document.getElementById('camp-audience')?.value || 'all',
                    coupon_value_fen: parseInt(document.getElementById('camp-coupon-value')?.value || '0', 10),
                    budget_fen: parseInt(document.getElementById('camp-budget')?.value || '0', 10),
                    planned_start: document.getElementById('camp-start')?.value || null,
                    planned_end: document.getElementById('camp-end')?.value || null,
                    status: 'draft',
                    voucher_template_id: '',
                    created_by: 'admin',
                    source_template_id: document.getElementById('camp-template')?.value || null,
                    recommended_poster_id: _matchedPosterId || null
                };
                if (!payload.store_id || !payload.title) {
                    showNotification('请填写门店ID和活动标题', 'warning');
                    return;
                }
                const r = await fetch('/api/growth/campaign-plans', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify(payload)
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'create_failed');
                showNotification('活动创建成功', 'success');
                document.getElementById('campaign-create-form').style.display = 'none';
                loadCampaignPlans();
            } catch (e) {
                showNotification('创建失败：' + (e?.message || e), 'error');
            }
        }

        async function loadCampaignPlans() {
            try {
                const store = document.getElementById('growth-store-filter')?.value || '';
                const url = '/api/growth/campaign-plans' + (store ? ('?store_id=' + encodeURIComponent(store)) : '');
                const [planRes, posterRes, tplRes] = await Promise.all([
                    fetch(url, { headers: growthAuthHeaders() }),
                    fetch('/api/growth/generated-posters?status=generated', { headers: growthAuthHeaders() }),
                    fetch('/api/growth/marketing-templates', { headers: growthAuthHeaders() })
                ]);
                const data = await planRes.json();
                const posterData = await posterRes.json();
                const tplData = await tplRes.json();
                const rows = data?.plans || [];
                const posters = posterData?.posters || [];
                const templates = tplData?.templates || [];
                var postersByCampaign = {};
                posters.forEach(function(p) {
                    var k = p.campaign_id || p.plan_id || p.poster_key || '';
                    if (!k || postersByCampaign[k]) return;
                    postersByCampaign[k] = p;
                });
                var postersById = {};
                posters.forEach(function(p) { postersById[p.id] = p; });
                var tplsById = {};
                templates.forEach(function(t) { tplsById[t.id] = t; });
                const host = document.getElementById('campaign-plans-list');
                host.innerHTML = rows.length ? rows.map(function(x) {
                    var cid = x.campaign_id || x.plan_id || '';
                    var poster = postersByCampaign[cid];
                    var recPoster = x.recommended_poster_id ? postersById[x.recommended_poster_id] : null;
                    var srcTpl = x.source_template_id ? tplsById[x.source_template_id] : null;
                    var statusLabel = growthStatusLabel(x.status);
                    var statusColor = x.status === 'active' ? '#86C9A2' : x.status === 'draft' ? '#CFA14A' : x.status === 'executed' ? '#EABBC5' : x.status === 'cancelled' ? '#E58B98' : '#CFA14A';
                    var actionsHtml = '';
                    if (x.status === 'draft') {
                        actionsHtml = '<button data-click="activateCampaignPlan" data-arg="' + cid.replace(/'/g, '\\\'') + '" style="padding:3px 8px;border-radius:6px;background:rgba(134,201,162,0.15);color:#86C9A2;border:1px solid rgba(134,201,162,0.3);cursor:pointer;font-size:11px;">激活</button>'
                            + '<button data-click="cancelCampaignPlan" data-arg="' + cid.replace(/'/g, '\\\'') + '" style="padding:3px 8px;border-radius:6px;background:rgba(229,139,152,0.10);color:#EDA1AC;border:1px solid rgba(229,139,152,0.2);cursor:pointer;font-size:11px;">取消</button>';
                    } else if (x.status === 'active') {
                        actionsHtml = '<button data-click="completeCampaignPlan" data-arg="' + cid.replace(/'/g, '\\\'') + '" style="padding:3px 8px;border-radius:6px;background:rgba(234,187,197,0.12);color:#EABBC5;border:1px solid rgba(234,187,197,0.25);cursor:pointer;font-size:11px;">完结</button>';
                    }
                    var posterHtml = '';
                    if (poster && (poster.output_url || poster.image_url)) {
                        posterHtml = '<div style="display:flex;gap:10px;align-items:center;margin-top:10px;padding:8px 10px;background:rgba(242,234,238,0.03);border:1px solid rgba(242,234,238,0.05);border-radius:10px;">'
                            + '<img src="' + escapeHtml(poster.output_url || poster.image_url) + '" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid rgba(242,234,238,0.08);">'
                            + '<div style="min-width:0;"><div style="font-size:11px;color:#F2EAEE;font-weight:700;">已关联海报</div><div style="font-size:11px;color:rgba(242,234,238,0.5);margin-top:2px;">' + escapeHtml((poster.title || '海报').slice(0, 24)) + '</div></div>'
                            + '<a href="' + escapeHtml(poster.output_url || poster.image_url) + '" target="_blank" style="margin-left:auto;padding:4px 8px;border:none;border-radius:6px;background:rgba(209,143,160,0.16);color:#EABBC5;cursor:pointer;font-size:11px;text-decoration:none;">查看大图</a></div>';
                    } else if (recPoster && (recPoster.output_url || recPoster.image_url)) {
                        posterHtml = '<div style="display:flex;gap:10px;align-items:center;margin-top:10px;padding:8px 10px;background:rgba(209,143,160,0.04);border:1px dashed rgba(209,143,160,0.2);border-radius:10px;">'
                            + '<img src="' + escapeHtml(recPoster.output_url || recPoster.image_url) + '" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid rgba(242,234,238,0.08);">'
                            + '<div style="min-width:0;"><div style="font-size:11px;color:#EABBC5;font-weight:700;">推荐海报（未确认）</div><div style="font-size:11px;color:rgba(242,234,238,0.5);margin-top:2px;">' + escapeHtml((recPoster.title || '海报').slice(0, 24)) + '</div></div>'
                            + '<a href="' + escapeHtml(recPoster.output_url || recPoster.image_url) + '" target="_blank" style="margin-left:auto;padding:4px 8px;border:none;border-radius:6px;background:rgba(209,143,160,0.12);color:#EABBC5;cursor:pointer;font-size:11px;text-decoration:none;">预览</a></div>';
                    } else {
                        posterHtml = '<div style="margin-top:8px;font-size:11px;color:rgba(242,234,238,0.35);">暂无关联海报</div>';
                    }
                    var tplHtml = srcTpl ? '<span style="color:var(--rep-muted);font-size:11px;"> · 模板：' + escapeHtml(srcTpl.name) + ' 已用' + (srcTpl.use_count || 0) + '次</span>' : '';
                    return '<div style="padding:12px 0;border-bottom:1px solid rgba(242,234,238,0.05);">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
                        + '<div style="flex:1;min-width:0;"><span style="color:#fff;font-weight:700;font-size:14px;">' + escapeHtml(x.title || '未命名活动') + '</span>'
                        + '<span style="margin-left:8px;font-size:11px;padding:2px 10px;border-radius:999px;background:' + statusColor + '22;color:' + statusColor + ';font-weight:600;">' + statusLabel + '</span>'
                        + '</div>'
                        + '<div style="display:flex;gap:4px;flex-shrink:0;align-items:center;">'
                        + (cid ? '<button data-click="showCampaignFunnelDashboard" data-arg="' + cid.replace(/'/g, '\\\'') + '" style="padding:4px 8px;border-radius:8px;background:rgba(209,143,160,0.1);color:#EABBC5;border:none;cursor:pointer;font-size:10px;font-weight:600;">📊</button>' : '')
                        + (x.status === 'draft' ? '<button data-click="activateCampaignPlan" data-arg="' + cid.replace(/'/g, '\\\'') + '" style="padding:4px 10px;border-radius:8px;background:rgba(134,201,162,0.15);color:#86C9A2;border:1px solid rgba(134,201,162,0.25);cursor:pointer;font-size:11px;font-weight:600;">激活</button>'
                            + '<button data-click="cancelCampaignPlan" data-arg="' + cid.replace(/'/g, '\\\'') + '" style="padding:4px 10px;border-radius:8px;background:transparent;color:#EDA1AC;border:1px solid rgba(229,139,152,0.2);cursor:pointer;font-size:11px;">取消</button>' : '')
                        + (x.status === 'active' ? '<button data-click="completeCampaignPlan" data-arg="' + cid.replace(/'/g, '\\\'') + '" style="padding:4px 10px;border-radius:8px;background:rgb(56,189,248,0.12);color:#EABBC5;border:none;cursor:pointer;font-size:11px;font-weight:600;">完结</button>' : '')
                        + '</div></div>'
                        + '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:12px;color:var(--rep-muted);">'
                        + '<span>' + growthStoreName(x.store_id) + '</span>'
                        + '<span>' + growthChannelLabel(x.channel) + '</span>'
                        + '<span>' + growthAudienceLabel(x.target_audience) + '</span>'
                        + (x.budget_fen ? '<span>预算 ¥' + Math.round(Number(x.budget_fen) / 100) + '</span>' : '')
                        + (x.planned_start ? '<span>' + String(x.planned_start).slice(5,10) + '-' + String(x.planned_end || '').slice(5,10) + '</span>' : '')
                        + tplHtml
                        + '</div>'
                        + posterHtml
                        + '<div style="font-size:10px;color:rgba(242,234,238,0.12);margin-top:4px;">' + cid + '</div>'
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无活动计划</div>';
            } catch (e) {
                document.getElementById('campaign-plans-list').innerHTML = '<div style="color:#E58B98;">加载活动计划失败</div>';
            }
        }

        async function activateCampaignPlan(planId) {
            if (!confirm('确定激活该活动？')) return;
            try {
                var r = await fetch('/api/growth/campaign-plans/' + encodeURIComponent(planId) + '/status', {
                    method: 'PATCH', headers: Object.assign({}, growthAuthHeaders(), {'Content-Type':'application/json'}),
                    body: JSON.stringify({status:'active'})
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error);
                var msg = d.execution && d.execution.real_executions && d.execution.real_executions.length ? '活动已激活并执行' : '活动已激活';
                showNotification(msg, 'success');
                loadCampaignPlans();
            } catch (e) { showNotification('操作失败: ' + (e?.message||e), 'error'); }
        }
        async function cancelCampaignPlan(planId) {
            if (!confirm('确定取消该活动？')) return;
            try {
                var r = await fetch('/api/growth/campaign-plans/' + encodeURIComponent(planId) + '/status', {
                    method: 'PATCH', headers: Object.assign({}, growthAuthHeaders(), {'Content-Type':'application/json'}),
                    body: JSON.stringify({status:'cancelled'})
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error);
                showNotification('活动已取消', 'success');
                loadCampaignPlans();
            } catch (e) { showNotification('操作失败: ' + (e?.message||e), 'error'); }
        }
        async function completeCampaignPlan(planId) {
            if (!confirm('确定完结该活动？')) return;
            try {
                var r = await fetch('/api/growth/campaign-plans/' + encodeURIComponent(planId) + '/status', {
                    method: 'PATCH', headers: Object.assign({}, growthAuthHeaders(), {'Content-Type':'application/json'}),
                    body: JSON.stringify({status:'completed'})
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error);
                showNotification('活动已完结', 'success');
                loadCampaignPlans();
            } catch (e) { showNotification('操作失败: ' + (e?.message||e), 'error'); }
        }

        function showCampaignFunnelDashboard(campaignId) {
            var sel = document.getElementById('growth-campaign-filter');
            if (sel) {
                // 尝试选中对应活动
                for (var i = 0; i < sel.options.length; i++) {
                    if (sel.options[i].value === campaignId) { sel.selectedIndex = i; break; }
                }
            }
            showGrowthTab('dashboard');
            refreshGrowthDashboard();
        }

        async function showCreateCampaignDialog() {
            const store_id = prompt('门店 ID');
            if (!store_id) return;
            const title = prompt('活动标题');
            if (!title) return;
            const channel = prompt('渠道（如 miniprogram / wecom / xiaohongshu）', 'miniprogram') || 'miniprogram';
            const status = prompt('状态（draft / active）', 'draft') || 'draft';
            try {
                const payload = {
                    plan_id: 'plan_' + Date.now(),
                    campaign_id: 'campaign_' + Date.now(),
                    store_id: store_id,
                    title: title,
                    channel: channel,
                    status: status
                };
                const r = await fetch('/api/growth/campaign-plans', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify(payload)
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'create_failed');
                showNotification('活动创建成功', 'success');
                loadCampaignPlans();
            } catch (e) {
                showNotification('活动创建失败：' + (e?.message || e), 'error');
            }
        }

        async function loadGrowthProfiles() {
            try {
                const store = document.getElementById('growth-store-filter')?.value || '';
                const url = '/api/growth/customer-profiles' + (store ? ('?store_id=' + encodeURIComponent(store)) : '');
                const r = await fetch(url, { headers: growthAuthHeaders() });
                const data = await r.json();
                const rows = data?.profiles || [];
                const host = document.getElementById('growth-profiles-list');
                try {
                    var qs = __custopsDiagnosisId ? ('?diagnosis_id=' + encodeURIComponent(__custopsDiagnosisId)) : '';
                    var opsRes = await fetch('/api/customer-ops/customers' + qs, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                    var opsData = await opsRes.json();
                    var opsRows = opsData?.customers || [];
                    if (opsRows.length) {
                        var ps = document.getElementById('custops-profile-summary');
                        if (ps) {
                            var vip = opsRows.filter(function(c){ return c.value_tier === 'vip'; }).length;
                            var risk = opsRows.filter(function(c){ return (c.scene_tags || []).indexOf('risk') >= 0 || c.lifecycle_stage === 'at_risk' || c.lifecycle_stage === 'dormant'; }).length;
                            var biz = opsRows.filter(function(c){ return (c.scene_tags || []).indexOf('business') >= 0; }).length;
                            var reachable = opsRows.filter(function(c){ return !!c.phone; }).length;
                            var stored = opsRows.filter(function(c){ return Number(c.stored_value_count || 0) > 0; }).length;
                            ps.innerHTML = '<div class="rep-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">'
                                + custopsMiniMetric('客户资产', opsRows.length + '人', '来自最近POS清洗', '#fff')
                                + custopsMiniMetric('VIP客户', vip + '人', '折前人均消费前15%', '#CFA14A')
                                + custopsMiniMetric('待维护风险', risk + '人', '濒临流失/沉睡', '#E58B98')
                                + custopsMiniMetric('可触达客户', reachable + '人', '手机号可用，商务客' + biz + '人，储值客' + stored + '人', '#86C9A2')
                                + '</div>';
                            try {
                                var assetReportRes = await fetch('/api/customer-ops/reports/customer-assets', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                                var assetReportData = await assetReportRes.json();
                                if (assetReportData && assetReportData.report) ps.innerHTML += renderBusinessOntologySection(assetReportData.report);
                            } catch (_) {}
                        }
                        host.innerHTML = '<div style="font-size:12px;color:rgba(242,234,238,0.55);margin-bottom:8px;">来自最近POS清洗诊断 · 点击查看360档案</div>' + opsRows.slice(0, 80).map(function(c) {
                            var tags = (c.scene_tags || []).map(custSceneLabel).join('、') || custStageLabel(c.lifecycle_stage);
                            return '<div data-click="hrmsOpenJsonArg" data-arg="openCustomer360" data-arg2="' + encodeURIComponent(JSON.stringify(c)) + '" style="cursor:pointer;padding:12px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:13px;">'
                                + '<div style="display:flex;justify-content:space-between;gap:12px;">'
                                + '<div style="color:#fff;font-weight:700;">' + escapeHtml(c.customer_id || '-') + ' · ' + escapeHtml(c.phone || '-') + '</div>'
                                + '<div style="color:#EABBC5;">' + escapeHtml(tags) + '</div>'
                                + '</div>'
                                + '<div style="color:rgba(242,234,238,0.62);margin-top:5px;">累计' + fmtCustMoney(c.total_spend) + ' · ' + (c.order_count || 0) + '次 · 均客' + fmtCustMoney(c.avg_check) + ' · 储值余额' + fmtCustMoney(c.stored_value_balance) + ' · 最近' + (c.days_since_last_visit || 0) + '天前</div>'
                                + '<div style="color:rgba(242,234,238,0.45);margin-top:3px;">喜好：' + escapeHtml((c.favorite_dishes || []).slice(0, 5).join('、') || '-') + ' · 下一步：' + escapeHtml(c.next_best_action || '-') + '</div>'
                                + '</div>';
                        }).join('');
                        renderGrowthClusters({ total: opsRows.length, clusters: Object.entries(opsRows.reduce(function(acc, c){ acc[c.lifecycle_stage || 'unknown'] = (acc[c.lifecycle_stage || 'unknown'] || 0) + 1; return acc; }, {})).map(function(kv){ return { lifecycle_stage: kv[0], user_count: kv[1] }; }) });
                        return;
                    }
                } catch (_) {}
                var fallbackSummary = document.getElementById('custops-profile-summary');
                if (fallbackSummary) fallbackSummary.innerHTML = '<div class="rep-pay-empty" style="margin-bottom:10px;">尚未导入POS诊断，当前显示旧画像数据。要形成360客人档案，请先上传客户POS Excel。</div>';
                host.innerHTML = rows.length ? rows.map(function(x) {
                    var posInfo = '';
                    if (x.pos_order_count > 0) {
                        posInfo = '<div style="color:#86C9A2;margin-top:4px;font-size:12px;">📊 POS: ' + x.pos_order_count + '笔消费 · 总计¥' + parseFloat(x.pos_total_spend || 0).toFixed(0) + ' · 均消¥' + parseFloat(x.avg_check || 0).toFixed(0) + (x.pos_dine_in_ratio != null ? ' · 堂食率' + Math.round(x.pos_dine_in_ratio * 100) + '%' : '') + '</div>';
                    }
                    var dishes = x.favorite_dishes && x.favorite_dishes.length ? x.favorite_dishes.slice(0, 5).join('、') : '-';
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:13px;">'
                        + '<div style="display:flex;justify-content:space-between;gap:12px;">'
                        + '<div style="color:#fff;font-weight:600;">客户#' + (x.customer_id || '-') + ' · ' + (x.phone || x.openid || '-') + '</div>'
                        + '<div style="color:#EABBC5;">' + (x.lifecycle_stage || 'new') + '</div>'
                        + '</div>'
                        + '<div style="color:rgba(242,234,238,0.6);margin-top:4px;">门店: ' + (x.store_id || '-') + ' · 价格敏感度: ' + (x.price_sensitivity || 0) + ' · 折扣响应: ' + (x.response_to_discount || 0) + '</div>'
                        + '<div style="color:rgba(242,234,238,0.45);margin-top:2px;">触达窗口: ' + (x.best_contact_window || '-') + ' · 偏好时段: ' + (x.preferred_visit_time || '-') + ' · 喜好: ' + dishes + '</div>'
                        + posInfo
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无用户画像</div>';
            } catch (e) {
                document.getElementById('growth-profiles-list').innerHTML = '<div style="color:#E58B98;">加载用户画像失败</div>';
            }
            try {
                var cs = document.getElementById('growth-store-filter')?.value || '';
                var cRes = await fetch('/api/growth/user-clusters' + (cs ? '?store_id=' + encodeURIComponent(cs) : ''), { headers: growthAuthHeaders() });
                var cData = await cRes.json();
                renderGrowthClusters(cData);
            } catch (e) { document.getElementById('growth-clusters').innerHTML = '<div style="color:rgba(242,234,238,0.4);font-size:12px;">分群数据暂不可用</div>'; }
        }

        async function recomputeGrowthProfiles() {
            try {
                const r = await fetch('/api/growth/customer-profiles/recompute', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify({ days: 90 })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'recompute_failed');
                showNotification('用户画像已重算', 'success');
                loadGrowthProfiles();
            } catch (e) {
                showNotification('重算画像失败：' + (e?.message || e), 'error');
            }
        }

        var __custopsDiagnosisId = null;
        function fmtCustMoney(n) {
            n = Number(n || 0);
            if (!Number.isFinite(n)) n = 0;
            return '¥' + Math.round(n).toLocaleString();
        }
        function pctCust(n) {
            n = Number(n || 0);
            if (!Number.isFinite(n)) n = 0;
            return (n * 100).toFixed(1) + '%';
        }
        function custStageLabel(s) {
            return ({ regular:'常来客', one_time:'来一次客', occasional:'偶尔来', at_risk:'濒临流失', dormant:'沉睡客' })[s] || s || '-';
        }
        function custSceneLabel(s) {
            return ({ high_value:'高消费客', business:'商务客', family:'家庭客', risk:'流失风险' })[s] || s || '-';
        }
        function custopsMiniMetric(label, value, sub, color) {
            return '<div class="rep-metric" style="text-align:left;min-height:86px;">'
                + '<div class="k">' + escapeHtml(label) + '</div>'
                + '<div class="v" style="font-size:22px;color:' + (color || 'var(--rep-text)') + ';">' + value + '</div>'
                + '<div class="s">' + escapeHtml(sub || '') + '</div>'
                + '</div>';
        }
        function renderBusinessOntologySection(report) {
            if (!report) return '';
            if (report.ontologyStatus === 'insufficient_data') {
                return '<div class="rep-metric" style="text-align:left;margin-top:12px;"><div class="k">AI经营结论</div><div style="font-size:13px;color:var(--rep-muted);margin-top:8px;">当前数据不足，暂无法生成经营判断。</div></div>';
            }
            var insights = report.ontologyInsights || [];
            var actions = report.actionPlan || [];
            var drafts = report.taskDrafts || [];
            var metrics = report.trackingMetrics || [];
            if (!insights.length && !actions.length && !drafts.length) return '';
            var issueHtml = insights.slice(0, 4).map(function(x) {
                return '<div style="padding:10px 0;border-top:1px solid rgba(242,234,238,.06);">'
                    + '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#fff;">' + escapeHtml(x.bossLanguageTitle || x.issueName || '-') + '</b><span style="color:' + (x.severity === 'P1' ? '#E58B98' : '#CFA14A') + ';font-weight:800;">' + escapeHtml(x.severity || '-') + '</span></div>'
                    + '<div style="font-size:12px;color:rgba(242,234,238,.68);margin-top:4px;">' + escapeHtml(x.issueName || '') + ' · 责任对象：' + escapeHtml((x.responsibleRoles || []).join('、') || '-') + '</div>'
                    + '<div style="font-size:12px;color:rgba(242,234,238,.5);margin-top:4px;line-height:1.55;">' + escapeHtml((x.evidence || []).join('；') || '-') + '</div>'
                    + '</div>';
            }).join('');
            var actionHtml = actions.slice(0, 5).map(function(a) {
                return '<div style="padding:9px 0;border-top:1px solid rgba(242,234,238,.06);font-size:12px;line-height:1.55;">'
                    + '<b style="color:#fff;">' + escapeHtml(a.actionName || '-') + '</b>'
                    + '<div style="color:rgba(242,234,238,.62);">责任：' + escapeHtml(a.ownerRole || '-') + ' · 优先级：' + escapeHtml(a.priority || '-') + ' · 截止：' + (a.deadlineDays || 3) + '天</div>'
                    + '<div style="color:rgba(242,234,238,.5);">' + escapeHtml(a.expectedResult || '-') + '</div>'
                    + '</div>';
            }).join('');
            var draftHtml = drafts.slice(0, 5).map(function(t) {
                var encoded = encodeURIComponent(JSON.stringify(t));
                return '<div style="padding:9px 0;border-top:1px solid rgba(242,234,238,.06);font-size:12px;line-height:1.55;">'
                    + '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#fff;">' + escapeHtml(t.title || '-') + '</b><span style="color:#EABBC5;">draft</span></div>'
                    + '<div style="color:rgba(242,234,238,.62);">责任：' + escapeHtml(t.ownerRole || '-') + ' · 到期：' + escapeHtml(String(t.dueDate || '').slice(0, 10)) + '</div>'
                    + '<div style="color:rgba(242,234,238,.5);">' + escapeHtml(t.expectedResult || '-') + '</div>'
                    + '<div style="display:flex;gap:8px;margin-top:8px;"><button class="rep-seg-btn rep-seg-btn--active" style="width:auto;padding:7px 12px;" data-click="hrmsConfirmOntologyTask" data-arg="' + encoded + '" data-arg-self="1">确认创建任务</button><button class="rep-seg-btn" style="width:auto;padding:7px 12px;" data-click="hrmsDismissClosestInner" data-arg-self="1">暂不处理</button></div>'
                    + '</div>';
            }).join('');
            var review = report.previousActionReview || null;
            var reviewHtml = review ? '<div style="margin-top:12px;"><div class="k">上期动作复盘</div><div style="font-size:12px;color:rgba(242,234,238,.65);line-height:1.6;margin-top:8px;">' + escapeHtml(review.summary || '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。') + '</div></div>' : '';
            return '<div class="rep-metric" style="text-align:left;margin-top:12px;">'
                + '<div class="k">AI经营结论</div><div style="font-size:14px;color:#fff;line-height:1.7;margin-top:8px;">' + escapeHtml(report.bossSummary || '-') + '</div>'
                + '<div class="rep-grid" style="grid-template-columns:1fr 1fr;margin-top:12px;">'
                + '<div><div class="k">AI识别的问题</div>' + (issueHtml || '<div style="font-size:12px;color:var(--rep-muted);margin-top:8px;">暂无P1/P2问题</div>') + '</div>'
                + '<div><div class="k">下一步动作</div>' + (actionHtml || '<div style="font-size:12px;color:var(--rep-muted);margin-top:8px;">暂无动作</div>') + '</div>'
                + '</div>'
                + '<div style="margin-top:12px;"><div class="k">结果追踪指标</div><div style="margin-top:8px;">' + (metrics.length ? metrics.map(function(m){ return '<span style="display:inline-block;margin:4px 6px 0 0;padding:5px 9px;border-radius:999px;background:rgba(134,201,162,.12);color:#BEE6CE;font-size:12px;">' + escapeHtml(m) + '</span>'; }).join('') : '<span style="color:var(--rep-muted);font-size:12px;">暂无</span>') + '</div></div>'
                + '<div style="margin-top:12px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div class="k">任务草稿</div><span style="font-size:12px;color:var(--rep-muted);">生成任务草稿</span></div>' + (draftHtml || '<div style="font-size:12px;color:var(--rep-muted);margin-top:8px;">暂无草稿</div>') + '</div>'
                + reviewHtml
                + '</div>';
        }
        async function confirmCreateOntologyTask(encodedDraft, btn) {
            try {
                var taskDraft = JSON.parse(encodedDraft || '{}');
                var storeId = document.getElementById('growth-store-filter')?.value || '';
                var r = await fetch('/api/ontology/business/create-task-from-draft', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token'), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskDraft: taskDraft, reportType: 'customer_assets', storeId: storeId })
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'create_failed');
                var ct = d.createdTask || {};
                if (btn) btn.closest('div').innerHTML = '<span style="color:#86C9A2;">已生成正式任务 · ' + escapeHtml(ct.task_id || '') + ' · ' + escapeHtml(ct.status || 'pending_dispatch') + '</span>';
                showNotification('已生成正式任务', 'success');
            } catch (e) {
                if (btn) btn.closest('div').innerHTML += '<div style="color:#E58B98;margin-top:6px;">创建任务失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }
        function renderCustomerOpsCleaning(q) {
            var c = (q && q.cleaning) || {};
            var sheets = c.sheets || [];
            if (!sheets.length) return '';
            var missing = (c.missing_required || []).join('、') || '无';
            var warning = (c.warnings || []).join('；');
            var sheetHtml = sheets.slice(0, 3).map(function(s) {
                var mp = s.mapping || {};
                var fields = ['phone','bizDate','amount','dish','orderNo','store'].map(function(f) {
                    var m = mp[f];
                    var label = ({ phone:'手机号', bizDate:'日期', amount:'金额', dish:'菜品', orderNo:'订单号', store:'门店' })[f];
                    return '<span style="display:inline-flex;align-items:center;gap:5px;margin:4px 6px 0 0;padding:4px 8px;border-radius:999px;background:' + (m ? 'rgba(134,201,162,.12);color:#BEE6CE;' : 'rgba(151,132,142,.1);color:rgba(242,234,238,.45);') + 'font-size:11px;">'
                        + label + (m ? (' · ' + escapeHtml(m.source_header || '-') + ' ' + (m.confidence || 0) + '%') : ' · 未识别') + '</span>';
                }).join('');
                return '<div style="padding:9px 0;border-top:1px solid rgba(242,234,238,.06);"><div style="font-size:12px;color:#fff;font-weight:800;">' + escapeHtml(s.sheet_name || '-') + ' · 表头第' + (s.header_row || 1) + '行 · ' + (s.rows || 0) + '行</div><div>' + fields + '</div></div>';
            }).join('');
            return '<div class="rep-metric" style="text-align:left;margin-top:12px;">'
                + '<div style="display:flex;justify-content:space-between;gap:12px;"><div><div class="k">POS智能清洗质量</div><div class="v" style="font-size:20px;">' + (c.confidence_score || 0) + '/100</div></div><div style="text-align:right;font-size:12px;color:var(--rep-muted);">缺失关键字段<br><b style="color:' + ((c.missing_required || []).length ? '#CFA14A' : '#86C9A2') + ';">' + escapeHtml(missing) + '</b></div></div>'
                + '<div style="margin-top:8px;font-size:12px;color:rgba(242,234,238,.62);">本批记录 ' + (c.batch_records || 0) + ' 条 · 历史合并 ' + (c.historical_records || 0) + ' 条 · 合并后 ' + (c.total_records_after_merge || 0) + ' 条 · 文件 ' + escapeHtml((c.batch_files || c.files || []).join('、') || '-') + '</div>'
                + '<div style="margin-top:8px;font-size:12px;color:rgba(242,234,238,.62);">记录类型：' + escapeHtml(Object.entries(c.record_types || {}).map(function(kv){ return kv[0] + ' ' + kv[1]; }).join(' / ') || '-') + '</div>'
                + sheetHtml
                + (warning ? '<div style="margin-top:8px;font-size:12px;color:#DDB66A;line-height:1.55;">' + escapeHtml(warning) + '</div>' : '')
                + '</div>';
        }
        function renderCustomerOpsDiagnosis(report, id) {
            __custopsDiagnosisId = id || __custopsDiagnosisId;
            var host = document.getElementById('custops-diagnosis-result');
            if (!host) return;
            if (!report) {
                host.innerHTML = '<div class="rep-pay-empty">暂无POS诊断记录。上传客户POS Excel后生成客户经营诊断。</div>';
                return;
            }
            var b = report.business || {};
            var q = report.input_quality || {};
            var sv = b.stored_value || {};
            var lifecycle = (report.customer_mix && report.customer_mix.lifecycle) || {};
            var scene = (report.customer_mix && report.customer_mix.scene) || {};
            var lp = Object.keys(lifecycle).map(function(k) {
                var total = Number(q.customers || 0) || 1;
                return '<div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(242,234,238,0.05);padding:6px 0;"><span>' + custStageLabel(k) + '</span><b>' + lifecycle[k] + ' · ' + Math.round(lifecycle[k] / total * 100) + '%</b></div>';
            }).join('');
            var sp = Object.keys(scene).map(function(k) {
                return '<span style="display:inline-block;margin:4px 6px 0 0;padding:4px 9px;border-radius:999px;background:rgba(234,187,197,0.12);color:#EABBC5;font-size:12px;">' + custSceneLabel(k) + ' ' + scene[k] + '</span>';
            }).join('');
            host.innerHTML = ''
                + '<div class="rep-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">'
                + '<div class="rep-metric"><div class="k">营业额</div><div class="v">' + fmtCustMoney(b.revenue) + '</div><div class="s">有效订单 ' + (q.valid_orders || 0) + '</div></div>'
                + '<div class="rep-metric"><div class="k">客户数</div><div class="v">' + (q.customers || 0) + '</div><div class="s">' + escapeHtml(q.date_start || '-') + ' ~ ' + escapeHtml(q.date_end || '-') + '</div></div>'
                + '<div class="rep-metric"><div class="k">平均客单</div><div class="v">' + fmtCustMoney(b.avg_check) + '</div><div class="s">按订单实收估算</div></div>'
                + '<div class="rep-metric"><div class="k">复购客户占比</div><div class="v">' + pctCust(b.customer_repeat_rate) + '</div><div class="s">客户维护基础盘</div></div>'
                + '</div>'
                + '<div class="rep-grid" style="grid-template-columns:1fr 1fr;margin-top:12px;">'
                + '<div class="rep-metric" style="text-align:left;"><div class="k">客群结构</div><div style="margin-top:8px;font-size:13px;color:var(--rep-text);">' + (lp || '暂无') + '</div></div>'
                + '<div class="rep-metric" style="text-align:left;"><div class="k">场景标签</div><div style="margin-top:8px;">' + (sp || '<span style="color:var(--rep-muted);font-size:12px;">暂无明显场景</span>') + '</div>'
                + '<div style="margin-top:12px;color:var(--rep-muted);font-size:12px;">午市占比 ' + pctCust(((b.daypart || {}).lunch || {}).revenue / Math.max(1, b.revenue || 0)) + ' · 晚市占比 ' + pctCust(((b.daypart || {}).dinner || {}).revenue / Math.max(1, b.revenue || 0)) + ' · 周末占比 ' + pctCust(((b.weekday || {}).weekend || {}).revenue / Math.max(1, b.revenue || 0)) + '</div></div>'
                + '</div>'
                + '<div class="rep-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:12px;">'
                + custopsMiniMetric('储值客户', (sv.customers || 0) + '人', '来自储值/会员文件', '#EABBC5')
                + custopsMiniMetric('充值金额', fmtCustMoney(sv.recharge), '不计入营业额', '#86C9A2')
                + custopsMiniMetric('赠送金额', fmtCustMoney(sv.gift), '会员权益成本', '#CFA14A')
                + custopsMiniMetric('储值余额', fmtCustMoney(sv.balance), '客户预付资产', '#E58B98')
                + '</div>'
                + renderBusinessOntologySection(report)
                + renderCustomerOpsCleaning(q);
        }
        async function uploadCustomerOpsDiagnosis() {
            var files = Array.prototype.slice.call(document.getElementById('custops-pos-file')?.files || []);
            if (!files.length) { showNotification('请先选择客户数据Excel文件', 'warning'); return; }
            var fd = new FormData();
            files.forEach(function(file){ fd.append('files', file); });
            fd.append('store_name', document.getElementById('custops-store-name')?.value || '');
            fd.append('merge_previous', document.getElementById('custops-merge-previous')?.checked ? 'true' : 'false');
            var host = document.getElementById('custops-diagnosis-result');
            if (host) host.innerHTML = '<div class="rep-pay-empty">正在自动识别字段、清洗多文件客户数据并生成诊断...</div>';
            try {
                var r = await fetch('/api/customer-ops/diagnosis/upload', { method:'POST', headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') }, body: fd });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'upload_failed');
                __custopsDiagnosisId = d.diagnosis_id;
                renderCustomerOpsDiagnosis(d.report, d.diagnosis_id);
                showNotification('客户经营诊断已生成：本批' + (d.imported_records || 0) + '条，合并后' + (d.merged_records || 0) + '条', 'success');
            } catch (e) {
                if (host) host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">生成失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }
        async function loadCustomerOpsLatest() {
            var host = document.getElementById('custops-diagnosis-result');
            if (!host) return;
            try {
                var r = await fetch('/api/customer-ops/diagnosis/latest', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'load_failed');
                if (!d.diagnosis) { renderCustomerOpsDiagnosis(null); return; }
                __custopsDiagnosisId = d.diagnosis.id;
                renderCustomerOpsDiagnosis(d.diagnosis.report_json, d.diagnosis.id);
            } catch (e) {
                host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">加载失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }
        async function exportCustomerOpsPdf() {
            if (!__custopsDiagnosisId) { showNotification('请先上传或加载一份诊断', 'warning'); return; }
            try {
                var r = await fetch('/api/customer-ops/diagnosis/' + encodeURIComponent(__custopsDiagnosisId) + '/pdf', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'pdf_failed');
                window.open(d.url, '_blank');
            } catch (e) { showNotification('PDF导出失败：' + (e?.message || e), 'error'); }
        }
        function custopsHeadersJson() {
            return { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token'), 'Content-Type': 'application/json' };
        }

        // ── 模块3：营销活动台账 ─────────────────────────────────────────
        var CAMPAIGN_CHANNEL_LABELS = { xiaohongshu:'小红书', wecom:'企微群发', sms:'短信', dianping:'大众点评', douyin:'抖音', offline:'线下活动', pos:'POS促销', other:'其他' };
        var CAMPAIGN_EFFECT_LABELS = { excellent:'优秀', meets:'达标', below:'不达标', blacklist:'黑名单（禁用）' };
        var CAMPAIGN_EFFECT_COLORS = { excellent:'#86C9A2', meets:'#EABBC5', below:'#CFA14A', blacklist:'#E58B98' };
        var CAMPAIGN_STATUS_LABELS = { planned:'计划中', in_progress:'进行中', active:'进行中', completed:'已完成', paused:'已暂停', cancelled:'已取消' };
        var CAMPAIGN_STATUS_COLORS = { planned:'#EABBC5', in_progress:'#CFA14A', active:'#CFA14A', completed:'#86C9A2', paused:'#CFA14A', cancelled:'rgba(151,132,142,0.5)' };
        var CAMPAIGN_TYPE_OPTIONS = ['充值活动','沉睡召回','新客激活','节日营销','新品推广','积分兑换','会员日','媒体投放','竞品反击','店庆活动','其他'];
        var CAMPAIGN_AUDIENCE_PRESETS = [
            { value:'dormant', label:'沉睡客（90天+未到店）' },
            { value:'at_risk', label:'预警流失（30-90天未到）' },
            { value:'one_time', label:'一次性客（未复购）' },
            { value:'vip', label:'高价值客户（VIP）' },
            { value:'business', label:'商务客户' },
            { value:'stored_value', label:'储值余额客户' },
            { value:'custom', label:'自定义说明...' },
        ];
        var __campaignStores = null;
        var __campaignsCache = [];

        async function loadCampaignStores() {
            if (__campaignStores) return __campaignStores;
            try {
                var r = await fetch('/api/stores', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                var d = await r.json();
                __campaignStores = (d.items || d.stores || d || []).map(function(s){ return typeof s === 'string' ? { name: s, id: s } : { name: s.name || s.store_name || s.id, id: String(s.id || s.store_id || s.name) }; });
            } catch { __campaignStores = []; }
            return __campaignStores;
        }

        async function loadCampaignLog() {
            var host = document.getElementById('custops-campaign-list');
            if (!host) return;
            host.innerHTML = '<div class="rep-pay-empty">加载中…</div>';
            try {
                var status = document.getElementById('campaign-status-filter')?.value || '';
                var qs = status ? '?status=' + encodeURIComponent(status) : '';
                var r = await fetch('/api/customer-ops/campaigns' + qs, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'load_failed');
                var campaigns = d.campaigns || [];
                __campaignsCache = campaigns;
                if (!campaigns.length) { host.innerHTML = '<div class="rep-pay-empty" style="padding:32px 0;text-align:center;">暂无活动记录<br><span style="font-size:12px;color:var(--rep-muted);">点击右上角「+ 新建活动」开始规划</span></div>'; return; }
                host.innerHTML = campaigns.map(function(c) {
                    var results = c.results || [];
                    var totalRevenue = results.reduce(function(s, x){ return s + Number(x.actual_revenue || 0); }, 0);
                    var totalConv = results.reduce(function(s, x){ return s + Number(x.actual_conversion_count || 0); }, 0);
                    var color = CAMPAIGN_STATUS_COLORS[c.status] || '#97848E';
                    var statusLabel = CAMPAIGN_STATUS_LABELS[c.status] || c.status;
                    var channelLabel = CAMPAIGN_CHANNEL_LABELS[c.channel] || c.channel;
                    var storeIds = [];
                    try { storeIds = Array.isArray(c.store_ids) ? c.store_ids : JSON.parse(c.store_ids || '[]'); } catch {}
                    var dateStr = c.planned_date ? c.planned_date.slice(0, 10) + (c.planned_end_date ? ' → ' + c.planned_end_date.slice(0, 10) : '') : '';
                    var resultsHtml = results.length ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(242,234,238,.06);">'
                        + '<div style="font-size:11px;color:var(--rep-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">门店复盘</div>'
                        + results.map(function(res) {
                            var effColor = CAMPAIGN_EFFECT_COLORS[res.effect_rating] || '#97848E';
                            var effLabel = CAMPAIGN_EFFECT_LABELS[res.effect_rating] || '';
                            return '<div style="background:rgba(242,234,238,.03);border-radius:10px;padding:10px;margin-bottom:6px;">'
                                + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
                                + '<span style="color:#fff;font-weight:600;font-size:13px;">' + escapeHtml(res.store_name || res.store_id || '-') + (effLabel ? ' <span style="font-size:10px;font-weight:700;color:' + effColor + ';background:rgba(242,234,238,.06);border-radius:5px;padding:2px 6px;margin-left:4px;">' + effLabel + '</span>' : '') + '</span>'
                                + '<button data-click="openCampaignResultModal" data-arg="' + c.id + '" data-arg-type="number" data-arg2="' + res.id + '" data-arg2-type="number" data-arg3="' + escapeHtml(res.store_id || '') + '" data-arg4="' + escapeHtml(res.store_name || '') + '" style="border:none;background:rgba(242,234,238,.08);color:rgba(242,234,238,.8);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">编辑</button>'
                                + '</div>'
                                + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;">'
                                + '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#EABBC5;">' + (res.actual_conversion_count || 0) + '</div><div style="font-size:10px;color:var(--rep-muted);">到店</div></div>'
                                + '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#86C9A2;">' + fmtCustMoney(res.actual_revenue) + '</div><div style="font-size:10px;color:var(--rep-muted);">带动收入</div></div>'
                                + '<div style="text-align:center;"><div style="font-size:18px;font-weight:800;color:#CFA14A;">' + (res.actual_send_count || 0) + '</div><div style="font-size:10px;color:var(--rep-muted);">发送量</div></div>'
                                + '</div>'
                                + (res.result_note ? '<div style="font-size:12px;color:rgba(242,234,238,.55);margin-top:6px;line-height:1.5;">' + escapeHtml(res.result_note) + '</div>' : '')
                                + '</div>';
                        }).join('')
                        + '</div>' : '';
                    return '<div style="background:rgba(242,234,238,.04);border:1px solid rgba(242,234,238,.08);border-radius:14px;padding:14px;margin-bottom:10px;">'
                        + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">'
                        + '<div style="flex:1;min-width:0;">'
                        + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px;">'
                        + '<span style="display:inline-flex;align-items:center;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(242,234,238,.06);color:' + color + ';">' + statusLabel + '</span>'
                        + '<span style="font-size:11px;color:var(--rep-muted);background:rgba(242,234,238,.04);padding:3px 8px;border-radius:6px;">' + escapeHtml(channelLabel) + '</span>'
                        + '<span style="font-size:11px;color:var(--rep-muted);">' + escapeHtml(c.campaign_type || '') + '</span>'
                        + '</div>'
                        + '<div style="font-size:16px;font-weight:800;color:#fff;line-height:1.3;word-break:break-all;">' + escapeHtml(c.title) + '</div>'
                        + '<div style="font-size:12px;color:var(--rep-muted);margin-top:5px;">📅 执行时间：' + (dateStr || '未设置') + '</div>'
                        + '<div style="font-size:12px;color:var(--rep-muted);margin-top:3px;">🏪 ' + (storeIds.length ? escapeHtml(storeIds.join('、')) : '全部门店') + (c.target_count ? '  👥 目标 ' + c.target_count + ' 人' : '') + '</div>'
                        + (c.goal ? '<div style="font-size:12px;color:rgba(242,234,238,.55);margin-top:4px;line-height:1.4;">🎯 ' + escapeHtml(c.goal) + '</div>' : '')
                        + (results.length ? '<div style="font-size:12px;color:#86C9A2;margin-top:4px;">✅ ' + results.length + ' 家门店已复盘' + (totalRevenue ? '  ·  总收入 ' + fmtCustMoney(totalRevenue) : '') + (totalConv ? '  ·  总到店 ' + totalConv + ' 人' : '') + '</div>' : '')
                        + '</div>'
                        + '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">'
                        + '<button data-click="hrmsOpenJsonArg" data-arg="openCreateCampaignModal" data-arg2="' + encodeURIComponent(JSON.stringify(c)) + '" style="border:none;background:rgba(242,234,238,.08);color:rgba(242,234,238,.9);border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;white-space:nowrap;">✏️ 编辑</button>'
                        + '<button data-click="openCampaignResultModal" data-arg="' + c.id + '" data-arg-type="number" style="border:none;background:rgba(234,187,197,.15);color:#EABBC5;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;white-space:nowrap;">📊 复盘</button>'
                        + ((c.status === 'completed' && results.length) ? '<button data-click="openCampaignReportModal" data-arg="' + c.id + '" data-arg-type="number" style="border:none;background:rgba(201,169,106,.15);color:#CFA14A;border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;white-space:nowrap;">📄 评估报告</button>' : '')
                        + '</div>'
                        + '</div>'
                        + resultsHtml
                        + '</div>';
                }).join('');
            } catch (e) {
                host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">加载失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }

        async function openCreateCampaignModal(existing) {
            var isEdit = !!(existing && existing.id);
            var c = typeof existing === 'string' ? JSON.parse(existing) : (existing || {});
            var storeIds = [];
            try { storeIds = Array.isArray(c.store_ids) ? c.store_ids : JSON.parse(c.store_ids || '[]'); } catch {}
            var stores = await loadCampaignStores();
            // 预选客群（多选）：把已存字符串按 '+' 拆分，匹配到的预设标签打勾，其余留在自定义框
            var audienceParts = c.target_audience ? String(c.target_audience).split('+').map(function(s){ return s.trim(); }).filter(Boolean) : [];
            var audiencePresetList = CAMPAIGN_AUDIENCE_PRESETS.filter(function(p){ return p.value !== 'custom'; });
            var checkedPresetValues = audiencePresetList.filter(function(p){ return audienceParts.indexOf(p.label) >= 0; }).map(function(p){ return p.value; });
            var audienceCustom = audienceParts.filter(function(part){ return !audiencePresetList.some(function(p){ return p.label === part; }); }).join('+');
            var storeCheckboxes = stores.length
                ? stores.map(function(s){ return '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;background:rgba(242,234,238,.04);cursor:pointer;"><input type="checkbox" name="cpm-store" value="' + escapeHtml(s.id) + '"' + (storeIds.indexOf(s.id) >= 0 || storeIds.indexOf(s.name) >= 0 ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:#5C9A76;"> <span style="color:#fff;font-size:14px;">' + escapeHtml(s.name) + '</span></label>'; }).join('')
                : '<div style="color:var(--rep-muted);font-size:13px;padding:8px 0;">无法加载门店列表，留空表示全部门店</div>';
            var statusOpts = [['planned','计划中'],['in_progress','进行中'],['completed','已完成'],['paused','已暂停'],['cancelled','已取消']];
            var ov = document.createElement('div');
            ov.id = 'campaign-modal-overlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
            ov.innerHTML = '<div style="width:100%;max-width:600px;max-height:95vh;overflow-y:auto;background:#121012;border-radius:20px 20px 0 0;padding:0 0 env(safe-area-inset-bottom,0);">'
                + '<div style="position:sticky;top:0;background:#121012;border-bottom:1px solid rgba(242,234,238,.08);padding:16px 16px 12px;z-index:1;display:flex;justify-content:space-between;align-items:center;">'
                + '<div style="font-size:17px;font-weight:900;color:#fff;">' + (isEdit ? '编辑活动' : '新建营销活动') + '</div>'
                + '<button data-click="hrmsRemoveById" data-arg="campaign-modal-overlay" style="border:none;background:rgba(242,234,238,.08);color:rgba(242,234,238,.7);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;">关闭</button>'
                + '</div>'
                + '<div style="padding:16px;">'
                // 活动名称
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">活动名称 *</div><input id="cpm-title" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:12px 14px;color:#fff;font-size:15px;box-sizing:border-box;" placeholder="如：国庆储值送好礼" value="' + escapeHtml(c.title || '') + '"></div>'
                // 渠道
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">活动渠道</div><div style="display:flex;flex-wrap:wrap;gap:8px;">'
                + Object.entries(CAMPAIGN_CHANNEL_LABELS).map(function(kv){ return '<label style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;border:1.5px solid ' + (c.channel === kv[0] ? '#5C9A76' : 'rgba(242,234,238,.12)') + ';background:' + (c.channel === kv[0] ? 'rgba(92,154,118,.2)' : 'rgba(242,234,238,.04)') + ';cursor:pointer;"><input type="radio" name="cpm-channel" value="' + kv[0] + '"' + (c.channel === kv[0] || (!c.channel && kv[0] === 'offline') ? ' checked' : '') + ' style="accent-color:#5C9A76;"> <span style="color:#fff;font-size:13px;">' + kv[1] + '</span></label>'; }).join('')
                + '</div></div>'
                // 活动类型
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">活动类型</div><div style="display:flex;flex-wrap:wrap;gap:8px;">'
                + CAMPAIGN_TYPE_OPTIONS.map(function(t){ return '<label style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;border:1.5px solid ' + (c.campaign_type === t ? '#5C9A76' : 'rgba(242,234,238,.12)') + ';background:' + (c.campaign_type === t ? 'rgba(92,154,118,.2)' : 'rgba(242,234,238,.04)') + ';cursor:pointer;"><input type="radio" name="cpm-type" value="' + t + '"' + (c.campaign_type === t ? ' checked' : '') + ' style="accent-color:#5C9A76;"> <span style="color:#fff;font-size:13px;">' + t + '</span></label>'; }).join('')
                + '</div></div>'
                // 状态
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">当前状态</div><div style="display:flex;flex-wrap:wrap;gap:8px;">'
                + statusOpts.map(function(kv){ var sel = c.status === kv[0] || (!c.status && kv[0] === 'planned'); return '<label style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;border:1.5px solid ' + (sel ? '#5C9A76' : 'rgba(242,234,238,.12)') + ';background:' + (sel ? 'rgba(92,154,118,.2)' : 'rgba(242,234,238,.04)') + ';cursor:pointer;"><input type="radio" name="cpm-status" value="' + kv[0] + '"' + (sel ? ' checked' : '') + ' style="accent-color:#5C9A76;"> <span style="color:#fff;font-size:13px;">' + kv[1] + '</span></label>'; }).join('')
                + '</div></div>'
                // 日期
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">计划开始</div><input id="cpm-date" type="date" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:11px 12px;color:#fff;font-size:14px;box-sizing:border-box;" value="' + escapeHtml(c.planned_date || '') + '"></div>'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">计划结束</div><input id="cpm-date-end" type="date" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:11px 12px;color:#fff;font-size:14px;box-sizing:border-box;" value="' + escapeHtml(c.planned_end_date || '') + '"></div>'
                + '</div>'
                // 覆盖门店
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">覆盖门店（不选=全部）</div><div style="display:flex;flex-direction:column;gap:6px;">' + storeCheckboxes + '</div></div>'
                // 目标客群（多选）
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">目标客群（可多选）</div><div style="display:flex;flex-direction:column;gap:6px;">'
                + audiencePresetList.map(function(p){ var sel = checkedPresetValues.indexOf(p.value) >= 0; return '<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;border:1.5px solid ' + (sel ? '#5C9A76' : 'rgba(242,234,238,.08)') + ';background:' + (sel ? 'rgba(92,154,118,.12)' : 'rgba(242,234,238,.03)') + ';cursor:pointer;"><input type="checkbox" name="cpm-audience-preset" value="' + escapeHtml(p.value) + '"' + (sel ? ' checked' : '') + ' style="accent-color:#5C9A76;width:18px;height:18px;"> <span style="color:#fff;font-size:13px;">' + escapeHtml(p.label) + '</span></label>'; }).join('')
                + '</div>'
                + '<div style="margin-top:8px;"><div style="font-size:11px;color:var(--rep-muted);margin-bottom:4px;">其他补充说明（可选）</div><input id="cpm-audience-custom" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:11px 14px;color:#fff;font-size:14px;box-sizing:border-box;" placeholder="如 储值余额50元以上" value="' + escapeHtml(audienceCustom) + '"></div>'
                + '</div>'
                // 目标人数 / 预算
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">目标人数</div><input id="cpm-target" type="number" min="0" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:11px 12px;color:#fff;font-size:14px;box-sizing:border-box;" value="' + (c.target_count || '') + '" placeholder="0"></div>'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">预算（元）</div><input id="cpm-budget" type="number" min="0" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:11px 12px;color:#fff;font-size:14px;box-sizing:border-box;" value="' + (c.budget || '') + '" placeholder="0"></div>'
                + '</div>'
                // 提醒日期
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">提醒日期（可选）</div><input id="cpm-reminder" type="date" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:11px 12px;color:#fff;font-size:14px;box-sizing:border-box;" value="' + escapeHtml(c.reminder_date || '') + '"></div>'
                // 活动内容/文案
                + '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">活动内容 / 文案</div><textarea id="cpm-content" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:12px 14px;color:#fff;font-size:14px;min-height:80px;resize:vertical;box-sizing:border-box;" placeholder="活动内容、推广语、短信文案等…">' + escapeHtml(c.content || '') + '</textarea></div>'
                // 活动目标
                + '<div style="margin-bottom:20px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">活动目标 / 预期效果</div><input id="cpm-goal" style="width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:12px 14px;color:#fff;font-size:14px;box-sizing:border-box;" placeholder="如：带动复购50人 / 储值增加10万" value="' + escapeHtml(c.goal || '') + '"></div>'
                // 底部按钮
                + '<div style="display:flex;gap:10px;padding-bottom:16px;">'
                + '<button data-click="submitCampaignForm" data-arg="' + (isEdit ? c.id : '') + '" style="flex:1;background:#5C9A76;color:#fff;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;">保存活动</button>'
                + (isEdit ? '<button data-click="deleteCampaign" data-arg="' + c.id + '" data-arg-type="number" style="background:rgba(229,139,152,.15);color:#EDA1AC;border:1px solid rgba(229,139,152,.3);border-radius:12px;padding:14px 18px;font-size:14px;cursor:pointer;">删除</button>' : '')
                + '</div>'
                + '</div>'
                + '</div>';
            ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); });
            document.body.appendChild(ov);
            // 动态样式：radio 组点击后更新视觉选中态
            ov.querySelectorAll('input[type=radio]').forEach(function(radio) {
                radio.addEventListener('change', function() {
                    var name = this.name;
                    ov.querySelectorAll('input[name="' + name + '"]').forEach(function(r) {
                        var lbl = r.closest('label');
                        if (!lbl) return;
                        if (r.checked) { lbl.style.borderColor = '#5C9A76'; lbl.style.background = 'rgba(92,154,118,.2)'; }
                        else { lbl.style.borderColor = 'rgba(242,234,238,.12)'; lbl.style.background = 'rgba(242,234,238,.04)'; }
                    });
                });
            });
        }

        async function submitCampaignForm(id) {
            try {
                var ov = document.getElementById('campaign-modal-overlay');
                var channelRadio = ov?.querySelector('input[name="cpm-channel"]:checked');
                var typeRadio = ov?.querySelector('input[name="cpm-type"]:checked');
                var statusRadio = ov?.querySelector('input[name="cpm-status"]:checked');
                var audienceChecks = Array.from(ov?.querySelectorAll('input[name="cpm-audience-preset"]:checked') || []).map(function(cb){ return cb.value; });
                var audienceLabels = audienceChecks.map(function(v){ return CAMPAIGN_AUDIENCE_PRESETS.find(function(p){ return p.value === v; })?.label; }).filter(Boolean);
                var audienceCustomVal = (document.getElementById('cpm-audience-custom')?.value || '').trim();
                if (audienceCustomVal) audienceLabels.push(audienceCustomVal);
                var audienceText = audienceLabels.length ? audienceLabels.join('+') : '全部客户';
                var storeChecks = Array.from(ov?.querySelectorAll('input[name="cpm-store"]:checked') || []).map(function(cb){ return cb.value; });
                var body = {
                    title: document.getElementById('cpm-title')?.value?.trim() || '',
                    channel: channelRadio?.value || 'offline',
                    campaign_type: typeRadio?.value || '其他',
                    status: statusRadio?.value || 'planned',
                    planned_date: document.getElementById('cpm-date')?.value || null,
                    planned_end_date: document.getElementById('cpm-date-end')?.value || null,
                    store_ids: storeChecks,
                    target_audience: audienceText,
                    target_count: Number(document.getElementById('cpm-target')?.value || 0),
                    content: document.getElementById('cpm-content')?.value || '',
                    goal: document.getElementById('cpm-goal')?.value || '',
                    budget: Number(document.getElementById('cpm-budget')?.value || 0),
                    reminder_date: document.getElementById('cpm-reminder')?.value || null,
                };
                if (!body.title) { showNotification('活动名称不能为空', 'warning'); return; }
                var url = id ? '/api/customer-ops/campaigns/' + id : '/api/customer-ops/campaigns';
                var method = id ? 'PUT' : 'POST';
                var r = await fetch(url, { method, headers: custopsHeadersJson(), body: JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                document.getElementById('campaign-modal-overlay')?.remove();
                showNotification(id ? '活动已更新' : '活动已创建', 'success');
                loadCampaignLog();
            } catch (e) { showNotification('保存失败：' + (e?.message || e), 'error'); }
        }

        async function deleteCampaign(id) {
            if (!confirm('确认删除该活动？此操作不可撤销。')) return;
            try {
                await fetch('/api/customer-ops/campaigns/' + id, { method: 'DELETE', headers: custopsHeadersJson() });
                document.getElementById('campaign-modal-overlay')?.remove();
                showNotification('活动已删除', 'success');
                loadCampaignLog();
            } catch (e) { showNotification('删除失败', 'error'); }
        }

        async function openCampaignResultModal(campaignId, resultId, storeId, storeName) {
            var isEdit = !!resultId;
            var stores = await loadCampaignStores();
            var campaign = __campaignsCache.find(function(c){ return c.id === campaignId; }) || {};
            var existing = isEdit ? (campaign.results || []).find(function(r){ return r.id === resultId; }) || {} : {};
            var storeOpts = stores.map(function(s){ return '<option value="' + escapeHtml(s.id) + '"' + ((existing.store_id || storeId) === s.id || (existing.store_name || storeName) === s.name ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>'; }).join('');
            var ov = document.createElement('div');
            ov.id = 'result-modal-overlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
            var iStyle = 'width:100%;background:rgba(242,234,238,.07);border:1px solid rgba(242,234,238,.12);border-radius:10px;padding:12px 14px;color:#fff;font-size:15px;box-sizing:border-box;';
            var effectOpts = Object.entries(CAMPAIGN_EFFECT_LABELS).map(function(kv){ return '<label style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:20px;border:1.5px solid ' + (existing.effect_rating === kv[0] ? CAMPAIGN_EFFECT_COLORS[kv[0]] : 'rgba(242,234,238,.12)') + ';background:' + (existing.effect_rating === kv[0] ? 'rgba(242,234,238,.08)' : 'rgba(242,234,238,.04)') + ';cursor:pointer;"><input type="radio" name="crm-effect" value="' + kv[0] + '"' + (existing.effect_rating === kv[0] ? ' checked' : '') + ' style="accent-color:' + CAMPAIGN_EFFECT_COLORS[kv[0]] + ';"> <span style="color:#fff;font-size:13px;">' + kv[1] + '</span></label>'; }).join('');
            ov.innerHTML = '<div style="width:100%;max-width:520px;max-height:95vh;overflow-y:auto;background:#121012;border-radius:20px 20px 0 0;padding-bottom:env(safe-area-inset-bottom,0);">'
                + '<div style="position:sticky;top:0;background:#121012;padding:16px 16px 12px;border-bottom:1px solid rgba(242,234,238,.08);display:flex;justify-content:space-between;align-items:center;z-index:1;">'
                + '<div style="font-size:16px;font-weight:900;color:#fff;">' + (isEdit ? '编辑复盘' : '+ 添加门店复盘') + '</div>'
                + '<button data-click="hrmsRemoveById" data-arg="result-modal-overlay" style="border:none;background:rgba(242,234,238,.08);color:rgba(242,234,238,.7);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;">关闭</button>'
                + '</div>'
                + '<div style="padding:16px;">'
                + (campaign.goal ? '<div style="background:rgba(201,169,106,.08);border:1px solid rgba(201,169,106,.25);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:13px;color:#CFA14A;">🎯 活动目标：' + escapeHtml(campaign.goal) + '</div>' : '')
                + '<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">选择门店</div><select id="crm-store-sel" style="' + iStyle + '">' + '<option value="">全部门店</option>' + storeOpts + '</select></div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">曝光人数</div><input id="crm-exposure" type="number" min="0" style="' + iStyle + '" value="' + (existing.actual_exposure_count || '') + '" placeholder="0"></div>'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">发送人数</div><input id="crm-send" type="number" min="0" style="' + iStyle + '" value="' + (existing.actual_send_count || '') + '" placeholder="0"></div>'
                + '</div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">核销单数</div><input id="crm-redeem" type="number" min="0" style="' + iStyle + '" value="' + (existing.actual_redemption_count || '') + '" placeholder="0"></div>'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">到店/转化人数</div><input id="crm-conv" type="number" min="0" style="' + iStyle + '" value="' + (existing.actual_conversion_count || '') + '" placeholder="0"></div>'
                + '</div>'
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">带动收入（元）</div><input id="crm-revenue" type="number" min="0" style="' + iStyle + '" value="' + (existing.actual_revenue || '') + '" placeholder="0"></div>'
                + '<div><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">活动成本（元）</div><input id="crm-cost" type="number" min="0" style="' + iStyle + '" value="' + (existing.actual_cost || '') + '" placeholder="0"></div>'
                + '</div>'
                + '<div id="crm-derived" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;background:rgba(242,234,238,.03);border-radius:10px;padding:10px;">'
                + '<div style="text-align:center;"><div id="crm-derived-rate" style="font-size:18px;font-weight:800;color:#EABBC5;">-</div><div style="font-size:10px;color:var(--rep-muted);">核销率</div></div>'
                + '<div style="text-align:center;"><div id="crm-derived-roi" style="font-size:18px;font-weight:800;color:#86C9A2;">-</div><div style="font-size:10px;color:var(--rep-muted);">ROI</div></div>'
                + '</div>'
                + '<div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:8px;font-weight:600;">活动效果评级</div><div style="display:flex;flex-wrap:wrap;gap:8px;">' + effectOpts + '</div></div>'
                + '<div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--rep-muted);margin-bottom:6px;font-weight:600;">复盘备注</div><textarea id="crm-note" style="' + iStyle + 'min-height:80px;resize:vertical;" placeholder="执行情况、问题点、改进建议…">' + escapeHtml(existing.result_note || '') + '</textarea></div>'
                + '<button data-click="submitCampaignResult" data-arg="' + campaignId + '" data-arg2="' + (resultId || '') + '" style="width:100%;background:#5C9A76;color:#fff;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:12px;">保存复盘结果</button>'
                + '</div>'
                + '</div>';
            ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); });
            document.body.appendChild(ov);
            function updateDerived() {
                var send = Number(document.getElementById('crm-send')?.value || 0);
                var redeem = Number(document.getElementById('crm-redeem')?.value || 0);
                var revenue = Number(document.getElementById('crm-revenue')?.value || 0);
                var cost = Number(document.getElementById('crm-cost')?.value || 0);
                document.getElementById('crm-derived-rate').textContent = send > 0 ? (redeem / send * 100).toFixed(1) + '%' : '-';
                document.getElementById('crm-derived-roi').textContent = cost > 0 ? ((revenue - cost) / cost).toFixed(2) : '-';
            }
            ['crm-send', 'crm-redeem', 'crm-revenue', 'crm-cost'].forEach(function(id) {
                document.getElementById(id)?.addEventListener('input', updateDerived);
            });
            updateDerived();
            ov.querySelectorAll('input[name="crm-effect"]').forEach(function(radio) {
                radio.addEventListener('change', function() {
                    ov.querySelectorAll('input[name="crm-effect"]').forEach(function(r) {
                        var lbl = r.closest('label');
                        if (!lbl) return;
                        if (r.checked) { lbl.style.borderColor = CAMPAIGN_EFFECT_COLORS[r.value]; lbl.style.background = 'rgba(242,234,238,.08)'; }
                        else { lbl.style.borderColor = 'rgba(242,234,238,.12)'; lbl.style.background = 'rgba(242,234,238,.04)'; }
                    });
                });
            });
        }

        async function submitCampaignResult(campaignId, resultId) {
            try {
                var ov = document.getElementById('result-modal-overlay');
                var sel = document.getElementById('crm-store-sel');
                var storeId = sel?.value || '';
                var storeName = sel?.options[sel.selectedIndex]?.text || '';
                if (storeName === '全部门店') storeName = '';
                var effectRadio = ov?.querySelector('input[name="crm-effect"]:checked');
                var body = {
                    store_id: storeId,
                    store_name: storeName,
                    actual_exposure_count: Number(document.getElementById('crm-exposure')?.value || 0),
                    actual_send_count: Number(document.getElementById('crm-send')?.value || 0),
                    actual_reach_count: 0,
                    actual_redemption_count: Number(document.getElementById('crm-redeem')?.value || 0),
                    actual_conversion_count: Number(document.getElementById('crm-conv')?.value || 0),
                    actual_revenue: Number(document.getElementById('crm-revenue')?.value || 0),
                    actual_cost: Number(document.getElementById('crm-cost')?.value || 0),
                    effect_rating: effectRadio?.value || '',
                    result_note: document.getElementById('crm-note')?.value || '',
                };
                var url = resultId
                    ? '/api/customer-ops/campaigns/' + campaignId + '/results/' + resultId
                    : '/api/customer-ops/campaigns/' + campaignId + '/results';
                var method = resultId ? 'PUT' : 'POST';
                var r = await fetch(url, { method, headers: custopsHeadersJson(), body: JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                document.getElementById('result-modal-overlay')?.remove();
                showNotification('复盘已保存', 'success');
                loadCampaignLog();
            } catch (e) { showNotification('保存失败：' + (e?.message || e), 'error'); }
        }

        function openCampaignReportModal(campaignId) {
            var c = __campaignsCache.find(function(x){ return x.id === campaignId; });
            if (!c) return;
            var results = c.results || [];
            var totalExposure = results.reduce(function(s, r){ return s + Number(r.actual_exposure_count || 0); }, 0);
            var totalSend = results.reduce(function(s, r){ return s + Number(r.actual_send_count || 0); }, 0);
            var totalRedeem = results.reduce(function(s, r){ return s + Number(r.actual_redemption_count || 0); }, 0);
            var totalConv = results.reduce(function(s, r){ return s + Number(r.actual_conversion_count || 0); }, 0);
            var totalRevenue = results.reduce(function(s, r){ return s + Number(r.actual_revenue || 0); }, 0);
            var totalCost = results.reduce(function(s, r){ return s + Number(r.actual_cost || 0); }, 0);
            var redeemRate = totalSend > 0 ? (totalRedeem / totalSend * 100).toFixed(1) + '%' : '-';
            var roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost).toFixed(2) : '-';
            var dateStr = c.planned_date ? c.planned_date.slice(0, 10) + (c.planned_end_date ? ' → ' + c.planned_end_date.slice(0, 10) : '') : '未设置';
            var kpiCard = function(label, value, color) {
                return '<div style="background:rgba(242,234,238,.04);border-radius:10px;padding:12px;text-align:center;"><div style="font-size:20px;font-weight:800;color:' + color + ';">' + value + '</div><div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">' + label + '</div></div>';
            };
            var ov = document.createElement('div');
            ov.id = 'report-modal-overlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';
            ov.innerHTML = '<div style="width:100%;max-width:600px;max-height:95vh;overflow-y:auto;background:#121012;border-radius:20px 20px 0 0;padding-bottom:env(safe-area-inset-bottom,0);">'
                + '<div style="position:sticky;top:0;background:#121012;padding:16px 16px 12px;border-bottom:1px solid rgba(242,234,238,.08);display:flex;justify-content:space-between;align-items:center;z-index:1;">'
                + '<div style="font-size:17px;font-weight:900;color:#fff;">活动评估报告</div>'
                + '<button data-click="hrmsRemoveById" data-arg="report-modal-overlay" style="border:none;background:rgba(242,234,238,.08);color:rgba(242,234,238,.7);border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;">关闭</button>'
                + '</div>'
                + '<div style="padding:16px;">'
                + '<div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:4px;">' + escapeHtml(c.title) + '</div>'
                + '<div style="font-size:12px;color:var(--rep-muted);margin-bottom:2px;">📅 执行时间：' + dateStr + '</div>'
                + (c.goal ? '<div style="font-size:12px;color:#CFA14A;margin-bottom:14px;">🎯 活动目标：' + escapeHtml(c.goal) + '</div>' : '<div style="margin-bottom:14px;"></div>')
                + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">'
                + kpiCard('曝光人数', totalExposure, '#D18FA0')
                + kpiCard('发送人数', totalSend, '#EABBC5')
                + kpiCard('核销单数', totalRedeem, '#CFA14A')
                + '</div>'
                + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">'
                + kpiCard('核销率', redeemRate, '#CFA14A')
                + kpiCard('到店/转化', totalConv, '#EABBC5')
                + kpiCard('带动收入', fmtCustMoney(totalRevenue), '#86C9A2')
                + '</div>'
                + '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;">'
                + kpiCard('活动成本', fmtCustMoney(totalCost), '#EDA1AC')
                + kpiCard('ROI', roi, '#86C9A2')
                + '</div>'
                + '<div style="font-size:12px;color:var(--rep-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">各门店明细</div>'
                + results.map(function(res) {
                    var effColor = CAMPAIGN_EFFECT_COLORS[res.effect_rating] || '#97848E';
                    var effLabel = CAMPAIGN_EFFECT_LABELS[res.effect_rating] || '未评级';
                    var rRate = Number(res.actual_send_count) > 0 ? (Number(res.actual_redemption_count || 0) / Number(res.actual_send_count) * 100).toFixed(1) + '%' : '-';
                    var rRoi = Number(res.actual_cost) > 0 ? ((Number(res.actual_revenue || 0) - Number(res.actual_cost)) / Number(res.actual_cost)).toFixed(2) : '-';
                    return '<div style="background:rgba(242,234,238,.04);border-radius:10px;padding:12px;margin-bottom:8px;">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
                        + '<span style="color:#fff;font-weight:700;font-size:14px;">' + escapeHtml(res.store_name || res.store_id || '-') + '</span>'
                        + '<span style="font-size:11px;font-weight:700;color:' + effColor + ';background:rgba(242,234,238,.06);border-radius:6px;padding:3px 8px;">' + effLabel + '</span>'
                        + '</div>'
                        + '<div style="font-size:12px;color:rgba(242,234,238,.7);line-height:1.8;">曝光 ' + (res.actual_exposure_count || 0) + ' · 发送 ' + (res.actual_send_count || 0) + ' · 核销 ' + (res.actual_redemption_count || 0) + '（' + rRate + '）· 到店 ' + (res.actual_conversion_count || 0) + '<br>收入 ' + fmtCustMoney(res.actual_revenue) + ' · 成本 ' + fmtCustMoney(res.actual_cost) + ' · ROI ' + rRoi + '</div>'
                        + (res.result_note ? '<div style="font-size:12px;color:rgba(242,234,238,.55);margin-top:6px;line-height:1.5;">' + escapeHtml(res.result_note) + '</div>' : '')
                        + '</div>';
                }).join('')
                + '</div>'
                + '</div>';
            ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); });
            document.body.appendChild(ov);
        }

        async function loadAutoMarketingSummary() {
            var host = document.getElementById('custops-ams-list');
            if (!host) return;
            host.innerHTML = '<div class="rep-pay-empty">加载中…</div>';
            try {
                var from = document.getElementById('ams-date-from')?.value || '';
                var to = document.getElementById('ams-date-to')?.value || '';
                var qs = (from ? '?date_from=' + from : '') + (to ? (from ? '&' : '?') + 'date_to=' + to : '');
                var r = await fetch('/api/customer-ops/auto-marketing-summary' + qs, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'load_failed');
                var rules = d.rules || [];
                var attributionHtml = '';
                try {
                    var ar = await fetch('/api/customer-ops/attribution-report' + qs, { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('hrms_token') } });
                    var ad = await ar.json();
                    var rep = ad && ad.report;
                    if (rep && rep.summary) {
                        var evidence = rep.evidenceDetails || rep.evidence_orders || [];
                        var evHtml = evidence.length ? '<details style="margin-bottom:12px;background:rgba(242,234,238,.04);border:1px solid rgba(242,234,238,.08);border-radius:12px;padding:12px;"><summary style="cursor:pointer;color:#fff;font-weight:800;">归因证据 · 以下订单为本次营销触达后 7 天内产生的真实消费记录</summary>'
                            + evidence.slice(0, 20).map(function(e) {
                                var assisted = e.attributionType === 'assisted' ? '<div style="color:#CFA14A;margin-top:4px;">辅助归因：客户在触达后窗口内回店，但未使用对应优惠券。</div>' : '';
                                return '<div style="padding:10px 0;border-top:1px solid rgba(242,234,238,.06);font-size:12px;line-height:1.6;">'
                                    + '<div style="display:flex;justify-content:space-between;gap:8px;"><b style="color:#fff;">客户 ' + escapeHtml(e.customerId || e.phone || '-') + '</b><span style="color:#EABBC5;">' + escapeHtml(e.attributionType || '-') + '</span></div>'
                                    + '<div style="color:rgba(242,234,238,.65);">触达：' + escapeHtml(String(e.touchTime || e.last_touch_date || '-').slice(0, 16)) + ' · 回店：' + escapeHtml(String(e.orderTime || e.date || '-').slice(0, 16)) + ' · 订单：' + escapeHtml(e.relatedOrderId || e.order_no || '-') + '</div>'
                                    + '<div style="color:rgba(242,234,238,.55);">金额：' + fmtCustMoney(e.orderAmount || e.revenue) + ' · 用券：' + (e.couponUsed ? '是' : '否') + ' · 券：' + escapeHtml(e.couponId || '-') + '</div>'
                                    + assisted
                                    + '</div>';
                            }).join('') + '</details>' : '';
                        attributionHtml = '<div class="rep-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:12px;">'
                            + custopsMiniMetric('触达人数', rep.summary.touched_customers || 0, '自动营销触达客户', '#fff')
                            + custopsMiniMetric('回店人数', rep.summary.returned_customers || 0, '触达窗口内回店', '#86C9A2')
                            + custopsMiniMetric('归因营业额', fmtCustMoney(rep.summary.attributed_revenue), '有订单记录支撑', '#EABBC5')
                            + custopsMiniMetric('转化率', pctCust(rep.summary.return_rate), '回店/触达', '#CFA14A')
                            + '</div>' + evHtml;
                    }
                } catch (_) {}
                host.innerHTML = attributionHtml + (rules.length
                    ? '<div style="font-size:12px;color:var(--rep-muted);margin-bottom:10px;">' + escapeHtml(d.date_from || '') + ' 至 ' + escapeHtml(d.date_to || '') + '</div>'
                    + rules.map(function(x) {
                        return '<div style="background:rgba(242,234,238,.04);border-radius:10px;padding:12px;margin-bottom:8px;">'
                            + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
                            + '<div style="color:#fff;font-weight:700;font-size:14px;">' + escapeHtml(x.rule_name || x.rule_key || '-') + '</div>'
                            + '<div style="font-size:13px;color:#86C9A2;font-weight:700;">发 ' + (x.send_count || 0) + ' 人</div>'
                            + '</div>'
                            + (x.sample_message ? '<div style="font-size:12px;color:rgba(242,234,238,.55);margin-top:6px;line-height:1.55;background:rgba(242,234,238,.03);border-radius:6px;padding:8px;">样本：' + escapeHtml(String(x.sample_message).slice(0, 150)) + '</div>' : '')
                            + '<div style="font-size:11px;color:var(--rep-muted);margin-top:5px;">最近发送：' + escapeHtml(x.last_sent_date || '-') + '</div>'
                            + '</div>';
                    }).join('')
                    : '<div class="rep-pay-empty">该时段无自动营销发送记录</div>');
            } catch (e) {
                host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">加载失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }
        function openCustomer360(c) {
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.62);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
            var tags = (c.scene_tags || []).map(custSceneLabel).join('、') || custStageLabel(c.lifecycle_stage);
            var channels = c.channel_readiness || {};
            var channelHtml = ['sms','wecom','miniprogram','xiaohongshu','dianping','douyin'].map(function(k) {
                var label = CAMPAIGN_CHANNEL_LABELS[k] || k;
                var on = !!channels[k];
                return '<span style="display:inline-block;margin:4px 6px 0 0;padding:5px 9px;border-radius:999px;background:' + (on ? 'rgba(134,201,162,.12);color:#BEE6CE;' : 'rgba(151,132,142,.10);color:rgba(242,234,238,.45);') + 'font-size:12px;">' + label + (on ? '可用' : '待补') + '</span>';
            }).join('');
            var timeline = (c.last_orders || []).slice(0, 6).map(function(o) {
                return '<div style="padding:9px 0;border-top:1px solid rgba(242,234,238,.06);font-size:12px;line-height:1.55;">'
                    + '<div style="display:flex;justify-content:space-between;gap:10px;"><b style="color:#fff;">' + escapeHtml(o.date || '-') + ' · ' + escapeHtml(o.store || c.primary_store || '-') + '</b><span style="color:#86C9A2;">' + fmtCustMoney(o.amount) + '</span></div>'
                    + '<div style="color:rgba(242,234,238,.58);">人数' + (o.diners || '-') + ' · ' + escapeHtml(o.order_type || '-') + ' · 菜品：' + escapeHtml((o.dishes || []).join('、') || '-') + '</div>'
                    + '</div>';
            }).join('');
            var storedTimeline = (c.stored_value_timeline || []).slice(0, 6).map(function(o) {
                return '<div style="padding:9px 0;border-top:1px solid rgba(242,234,238,.06);font-size:12px;line-height:1.55;">'
                    + '<div style="display:flex;justify-content:space-between;gap:10px;"><b style="color:#fff;">' + escapeHtml(o.date || '-') + ' · ' + escapeHtml(o.store || c.primary_store || '-') + '</b><span style="color:#EABBC5;">余额' + fmtCustMoney(o.balance) + '</span></div>'
                    + '<div style="color:rgba(242,234,238,.58);">充值' + fmtCustMoney(o.recharge_amount) + ' · 赠送' + fmtCustMoney(o.gift_amount) + ' · 积分' + (o.points || 0) + ' · ' + escapeHtml(o.order_type || '') + '</div>'
                    + '</div>';
            }).join('');
            var touchPlan = (c.touch_plan || []).map(function(x) {
                return '<li style="margin:4px 0;color:rgba(242,234,238,.78);">' + escapeHtml(x) + '</li>';
            }).join('');
            ov.innerHTML = '<div style="width:min(560px,100%);max-height:90vh;overflow:auto;background:#121012;border:1px solid rgba(242,234,238,0.12);border-radius:16px;padding:18px;">'
                + '<div style="display:flex;justify-content:space-between;gap:12px;"><div><div style="font-size:12px;color:#EABBC5;font-weight:800;">360 CUSTOMER PROFILE</div><div style="font-size:22px;color:#fff;font-weight:900;margin-top:4px;">' + escapeHtml(c.customer_id || '-') + '</div></div><button data-click="hrmsRemoveClosest" data-arg="div[style*=fixed]" data-arg-self="1" style="border:none;background:rgba(242,234,238,0.08);color:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;">关闭</button></div>'
                + '<div class="rep-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px;">'
                + '<div class="rep-metric"><div class="k">手机号</div><div class="v" style="font-size:18px;">' + escapeHtml(c.phone || '-') + '</div></div>'
                + '<div class="rep-metric"><div class="k">会员号/企微</div><div class="v" style="font-size:18px;">' + escapeHtml(c.member_no || c.external_userid || '-') + '</div></div>'
                + '<div class="rep-metric"><div class="k">累计消费</div><div class="v">' + fmtCustMoney(c.total_spend) + '</div></div>'
                + '<div class="rep-metric"><div class="k">消费次数</div><div class="v">' + (c.order_count || 0) + '次</div></div>'
                + '<div class="rep-metric"><div class="k">最近消费</div><div class="v">' + (c.days_since_last_visit || 0) + '天前</div></div>'
                + '<div class="rep-metric"><div class="k">平均客单</div><div class="v">' + fmtCustMoney(c.avg_check) + '</div></div>'
                + '<div class="rep-metric"><div class="k">累计充值</div><div class="v">' + fmtCustMoney(c.total_recharge) + '</div></div>'
                + '<div class="rep-metric"><div class="k">储值余额</div><div class="v">' + fmtCustMoney(c.stored_value_balance) + '</div></div>'
                + '<div class="rep-metric"><div class="k">近90天消费</div><div class="v">' + fmtCustMoney(c.spend_90d) + '</div></div>'
                + '<div class="rep-metric"><div class="k">最高单次</div><div class="v">' + fmtCustMoney(c.max_single_spend) + '</div></div>'
                + '<div class="rep-metric"><div class="k">午市占比</div><div class="v">' + Math.round((c.lunch_pct || 0) * 100) + '%</div></div>'
                + '<div class="rep-metric"><div class="k">周末占比</div><div class="v">' + Math.round((c.weekend_pct || 0) * 100) + '%</div></div>'
                + '</div>'
                + '<div style="margin-top:12px;padding:12px;border-radius:12px;background:rgba(242,234,238,0.04);color:rgba(242,234,238,0.82);font-size:13px;line-height:1.8;">'
                + '<b style="color:#fff;">最喜欢：</b>' + escapeHtml((c.favorite_dishes || []).join('、') || '-') + '<br>'
                + '<b style="color:#fff;">常去门店：</b>' + escapeHtml(c.primary_store || (c.stores || []).join('、') || '-') + '<br>'
                + '<b style="color:#fff;">常来时段：</b>' + escapeHtml(c.preferred_visit_time || '-') + '<br>'
                + '<b style="color:#fff;">员工评价：</b>' + escapeHtml(c.staff_note || tags || '-') + '<br>'
                + '<b style="color:#fff;">是否到店：</b>' + escapeHtml(c.visit_status || '-') + '<br>'
                + '<b style="color:#fff;">AI建议：</b>' + escapeHtml(c.next_best_action || ((c.value_tier === 'vip' && c.days_since_last_visit >= 30) ? '高价值客久未到店，优先企微/短信发专属新品邀请，到店后提醒店长重点接待。' : '按当前客群标签进入对应维护节奏。'))
                + '</div>'
                + '<div class="rep-metric" style="text-align:left;margin-top:12px;"><div class="k">可触达渠道</div><div style="margin-top:8px;">' + channelHtml + '</div></div>'
                + '<div class="rep-metric" style="text-align:left;margin-top:12px;"><div class="k">维护动作建议</div><ul style="padding-left:18px;margin:8px 0 0;font-size:13px;line-height:1.6;">' + (touchPlan || '<li style="color:var(--rep-muted);">暂无</li>') + '</ul></div>'
                + '<div class="rep-metric" style="text-align:left;margin-top:12px;"><div class="k">最近消费时间线</div>' + (timeline || '<div style="color:var(--rep-muted);font-size:12px;margin-top:8px;">暂无消费明细</div>') + '</div>'
                + '<div class="rep-metric" style="text-align:left;margin-top:12px;"><div class="k">储值/会员资金时间线</div>' + (storedTimeline || '<div style="color:var(--rep-muted);font-size:12px;margin-top:8px;">暂无储值记录</div>') + '</div>'
                + '</div>';
            ov.addEventListener('click', function(e){ if (e.target === ov) ov.remove(); });
            document.body.appendChild(ov);
        }

        function renderGrowthClusters(data) {
            var el = document.getElementById('growth-clusters');
            if (!el) return;
            var clusters = Array.isArray(data?.clusters) ? data.clusters : [];
            var total = data?.total || 0;
            if (!clusters.length) { el.innerHTML = '<div style="color:rgba(242,234,238,0.4);font-size:12px;">暂无分群数据</div>'; return; }
            var stageColors = { prospect: '#97848E', new: '#EABBC5', active: '#86C9A2', at_risk: '#CFA14A', dormant: '#E58B98', churned: '#97848E', lost_90: '#D18FA0', lost_180: '#B87B8C', lost_365: '#6E5223' };
            var stageLabels = { prospect: '潜在新客', new: '新客', active: '活跃', at_risk: '临界客', dormant: '沉睡老客', churned: '流失客', lost_90: '流失客(3-6月)', lost_180: '流失客(6-12月)', lost_365: '流失客(1年+)' };
            el.innerHTML = '<div style="font-size:11px;color:rgba(242,234,238,0.5);margin-bottom:8px;">共' + total + '人</div>' + clusters.map(function(c) {
                var label = stageLabels[c.lifecycle_stage] || c.lifecycle_stage;
                var color = stageColors[c.lifecycle_stage] || '#EABBC5';
                var pct = total > 0 ? Math.round(c.user_count / total * 100) : 0;
                return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">'
                    + '<span style="font-size:11px;padding:2px 8px;border-radius:999px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;white-space:nowrap;">' + label + '</span>'
                    + '<span style="font-size:12px;color:#fff;font-weight:700;min-width:32px;">' + c.user_count + '</span>'
                    + '<div style="flex:1;height:6px;border-radius:3px;background:rgba(242,234,238,0.06);overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px;"></div></div>'
                    + '<span style="font-size:11px;color:rgba(242,234,238,0.45);">' + pct + '%</span>'
                    + '</div>';
            }).join('');
        }

        function growthFmtPct(n) {
            var v = Number(n || 0);
            if (!Number.isFinite(v)) return '0.00%';
            return (v * 100).toFixed(2) + '%';
        }

        // 模板化 A/B：内存里保存已加载的任务（供录入表单按 metrics_schema 动态生成字段）。
        var _abTasksById = {};
        // 按指标公式 format 格式化展示值。pct→百分比；money→¥；x→倍数；其余→整数。
        function abFmtMetric(v, fmt) {
            v = Number(v || 0);
            if (!Number.isFinite(v)) v = 0;
            if (fmt === 'pct') return (v * 100).toFixed(2) + '%';
            if (fmt === 'money') return '¥' + (Math.round(v * 100) / 100);
            if (fmt === 'x') return v.toFixed(2) + 'x';
            return String(Math.round(v));
        }
        function abVariantCell(label, m, schema) {
            m = m || {};
            if (schema && schema.primary) {
                var pf = schema.primary.format;
                var extras = (m.extras || []).map(function(e) { return escapeHtml(e.label) + ' ' + abFmtMetric(e.value, e.format); }).join(' · ');
                return '<div class="rep-metric"><div class="k">' + label + '</div><div class="v">' + abFmtMetric(m.primary, pf) + '</div>'
                    + '<div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">样本' + (m.sample || 0) + (extras ? (' · ' + extras) : '') + '</div></div>';
            }
            return '<div class="rep-metric"><div class="k">' + label + '</div><div class="v">' + growthFmtPct(m.redemption_rate || 0) + '</div>'
                + '<div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">发送' + (m.sent || 0) + ' · 核销' + (m.redemptions || 0) + ' · ¥' + (m.revenue || 0) + '</div></div>';
        }

        async function loadGrowthAbTests() {
            try {
                var store = document.getElementById('growth-store-filter')?.value || '51866138';
                var r = await fetch('/api/growth/ab-tests?store_code=' + encodeURIComponent(store), { headers: growthAuthHeaders() });
                var data = await r.json();
                var tasks = data?.tasks || [];
                _abTasksById = {};
                tasks.forEach(function(t) { _abTasksById[Number(t.id || 0)] = t; });
                var summary = document.getElementById('growth-abtest-summary');
                var host = document.getElementById('growth-abtests-list');
                var completed = tasks.filter(function(t){ return t.status === 'completed'; }).length;
                if (summary) {
                    summary.innerHTML = '<div class="rep-grid">'
                        + '<div class="rep-metric"><div class="k">测试数</div><div class="v">' + tasks.length + '</div></div>'
                        + '<div class="rep-metric"><div class="k">已完成</div><div class="v">' + completed + '</div></div>'
                        + '<div class="rep-metric"><div class="k">经验条数</div><div class="v" id="growth-ab-learning-count">-</div></div>'
                        + '</div>';
                }
                host.innerHTML = tasks.length ? tasks.map(function(t) {
                    var id = Number(t.id || 0);
                    var schema = (t.metrics_schema && typeof t.metrics_schema === 'object') ? t.metrics_schema : null;
                    var mA = t.metrics?.A || {};
                    var mB = t.metrics?.B || {};
                    var winner = t.winner || '-';
                    var lift = Number(t.winner_lift || 0).toFixed(2);
                    var metricName = (schema && schema.primary && schema.primary.label) || t.target_metric || '-';
                    var isBound = !!t.target_rule_key;
                    var modeLine = isBound
                        ? '绑定：' + escapeHtml(t.target_kind === 'payment_rule' ? '支付发券' : '规则引擎/订阅') + ' · ' + escapeHtml(t.target_rule_key)
                        : (t.mode === 'channel' ? '渠道：' + escapeHtml(t.channel || '-') + ' · 变量：' + escapeHtml(t.test_type || '-') : '');
                    var vA = (t.variant_a && typeof t.variant_a === 'object') ? (t.variant_a.content || '') : '';
                    var vB = (t.variant_b && typeof t.variant_b === 'object') ? (t.variant_b.content || '') : '';
                    var aLabel = isBound ? 'A组(当前)' : 'A版本';
                    var bLabel = isBound ? 'B组(挑战)' : 'B版本';
                    return '<div style="padding:14px 0;border-bottom:1px solid rgba(242,234,238,0.06);">'
                        + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">'
                        + '<div style="min-width:0;flex:1;">'
                        + '<div style="font-size:14px;font-weight:800;color:#fff;">' + escapeHtml(t.test_name || '未命名测试') + '</div>'
                        + '<div style="font-size:12px;color:var(--rep-muted);margin-top:4px;">' + escapeHtml(metricName) + ' · ' + escapeHtml(t.start_date || '') + ' ~ ' + escapeHtml(t.end_date || '') + '</div>'
                        + '</div>'
                        + '<div style="font-size:11px;padding:3px 10px;border-radius:999px;background:' + (t.status === 'completed' ? 'rgba(134,201,162,0.12)' : 'rgba(207,161,74,0.12)') + ';color:' + (t.status === 'completed' ? '#86C9A2' : '#CFA14A') + ';font-weight:700;">' + escapeHtml(t.status || 'running') + '</div>'
                        + '</div>'
                        + (modeLine ? '<div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">' + modeLine + '</div>' : '')
                        + ((!isBound && (vA || vB)) ? '<div style="font-size:11px;color:rgba(242,234,238,0.6);margin-top:4px;line-height:1.5;">A：' + escapeHtml(vA.slice(0, 60)) + '　｜　B：' + escapeHtml(vB.slice(0, 60)) + '</div>' : '')
                        + '<div class="rep-grid" style="margin-top:12px;grid-template-columns:repeat(3,minmax(0,1fr));">'
                        + abVariantCell(aLabel, mA, schema)
                        + abVariantCell(bLabel, mB, schema)
                        + '<div class="rep-metric"><div class="k">胜者</div><div class="v" style="color:var(--rep-gold);">' + escapeHtml(String(winner)) + '</div><div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">提升 ' + lift + '%</div></div>'
                        + '</div>'
                        + '<div style="margin-top:10px;font-size:12px;color:rgba(242,234,238,0.78);line-height:1.6;">' + escapeHtml(t.ai_summary || '尚未生成总结') + '</div>'
                        + '<div style="margin-top:10px;display:flex;gap:8px;">'
                        + '<button class="rep-seg-btn" style="flex:1;" data-click="toggleAbResultForm" data-arg="' + id + '" data-arg-type="number">✏️ 录入结果</button>'
                        + ((winner === 'A' || winner === 'B')
                            ? (t.promoted_rule_key
                                ? '<button class="rep-seg-btn" style="flex:1.4;opacity:0.6;cursor:default;" disabled>✅ ' + (isBound ? (winner === 'A' ? '已采用(维持当前)' : '已采用(挑战者)') : '已沉淀经验库') + '</button>'
                                : '<button class="rep-seg-btn rep-seg-btn--active" style="flex:1.4;" data-click="promoteGrowthAbTest" data-arg="' + id + '" data-arg2="' + String(winner) + '">' + (isBound ? '🚀 采用胜者' : '📚 沉淀经验库') + '</button>')
                            : '')
                        + '</div>'
                        + abResultFormHtml(id)
                        + '</div>';
                }).join('') : '<div class="rep-pay-empty">暂无A/B测试</div>';
                loadGrowthLearnings();
            } catch (e) {
                document.getElementById('growth-abtests-list').innerHTML = '<div class="rep-pay-empty">加载A/B测试失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }

        // ── 模板：加载模板注册表并填入下拉，按所选模板动态渲染创建表单 ──
        var _abTemplates = [];
        var _abCurrentTemplate = null;
        var _abBindableRules = {};
        var _abCustomFieldKeys = [];
        async function loadAbTemplates() {
            var sel = document.getElementById('abtest-template');
            if (!sel) return;
            try {
                var r = await fetch('/api/growth/ab-templates', { headers: growthAuthHeaders() });
                var d = await r.json();
                _abTemplates = d?.templates || [];
                sel.innerHTML = '<option value="">— 请选择模板 —</option>' + _abTemplates.map(function(t) {
                    var tag = t.scope === 'bound' ? '内部·绑定规则' : '外部·经验库';
                    return '<option value="' + escapeHtml(t.key) + '">' + escapeHtml(t.label) + '（' + tag + '）</option>';
                }).join('');
            } catch (e) {
                sel.innerHTML = '<option value="">加载模板失败</option>';
            }
        }

        function onAbTemplateChange() {
            var key = document.getElementById('abtest-template')?.value || '';
            var tpl = _abTemplates.find(function(t) { return t.key === key; }) || null;
            _abCurrentTemplate = tpl;
            var dyn = document.getElementById('abtest-dynamic');
            var metricLabel = document.getElementById('abtest-metric-label');
            if (!dyn) return;
            if (!tpl) { dyn.innerHTML = ''; if (metricLabel) metricLabel.value = ''; return; }
            if (metricLabel) metricLabel.value = tpl.primary ? tpl.primary.label : (tpl.key === 'custom' ? '由自定义指标决定' : '-');
            if (tpl.scope === 'bound') {
                dyn.innerHTML = ''
                    + '<div class="rep-field"><label>绑定规则 *（' + escapeHtml(tpl.bind_kind === 'payment_rule' ? '支付发券' : '规则引擎/订阅') + '）</label>'
                    + '<select id="abtest-target-rule" class="dr-store-select" data-change="onAbBindRuleChange"><option value="">加载中…</option></select></div>'
                    + '<div style="font-size:12px;color:rgba(242,234,238,0.7);margin-top:10px;">A组 · 当前版本（只读）</div>'
                    + '<textarea id="abtest-variant-a" class="dr-store-select" readonly placeholder="选择绑定规则后自动带出当前版本" style="margin-top:6px;width:100%;min-height:54px;padding:10px;color:rgba(242,234,238,0.7);background:rgba(242,234,238,0.03);resize:vertical;"></textarea>'
                    + '<div style="font-size:12px;color:rgba(242,234,238,0.7);margin-top:10px;">B组 · 挑战版本 *（' + (tpl.bind_kind === 'payment_rule' ? '券模板ID / 触发门槛' : '短信文案，可用 {name}/{姓名} 占位') + '）</div>'
                    + '<textarea id="abtest-variant-b" class="dr-store-select" placeholder="输入挑战版本内容" style="margin-top:6px;width:100%;min-height:54px;padding:10px;color:var(--rep-text);resize:vertical;"></textarea>';
                loadAbBindableRules();
                return;
            }
            // channel / custom
            var fieldsNote = '';
            if (tpl.key !== 'custom') {
                fieldsNote = '<div style="font-size:11px;color:rgba(242,234,238,0.55);margin-top:8px;">本模板将录入：' + tpl.fields.map(function(f) { return escapeHtml(f.label); }).join(' / ') + '；主判定指标：<b>' + escapeHtml(tpl.primary.label) + '</b>。</div>';
            }
            var customEditor = '';
            if (tpl.key === 'custom') {
                _abCustomFieldKeys = [];
                customEditor = ''
                    + '<div class="rep-field" style="margin-top:8px;"><label>渠道名称 *（如 抖音团购 / 私域社群）</label><input id="abtest-channel" class="dr-store-select" placeholder="渠道名称" style="padding:10px;color:var(--rep-text);"></div>'
                    + '<div style="font-size:12px;font-weight:700;color:#fff;margin:12px 0 4px;">自定义录入字段（至少1个）</div>'
                    + '<div id="abtest-custom-fields"></div>'
                    + '<button type="button" class="rep-seg-btn" style="margin-top:6px;" data-click="abAddCustomField">+ 添加字段</button>'
                    + '<div style="font-size:12px;font-weight:700;color:#fff;margin:12px 0 4px;">主判定指标 *（决定胜负）</div>'
                    + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">'
                    + '<div class="rep-field"><label style="font-size:11px;">指标名称</label><input id="abtest-primary-label" class="dr-store-select" placeholder="如 转化率" style="padding:8px;color:var(--rep-text);"></div>'
                    + '<div class="rep-field"><label style="font-size:11px;">展示格式</label><select id="abtest-primary-format" class="dr-store-select"><option value="pct">比率 %</option><option value="money">金额 ¥</option><option value="x">倍数 x</option><option value="int">计数</option></select></div>'
                    + '<div class="rep-field"><label style="font-size:11px;">分子字段</label><select id="abtest-primary-num" class="dr-store-select"></select></div>'
                    + '<div class="rep-field"><label style="font-size:11px;">分母字段（留空=求和）</label><select id="abtest-primary-den" class="dr-store-select"></select></div>'
                    + '</div>';
            }
            dyn.innerHTML = ''
                + '<div class="rep-field"><label>测试变量 *（比较的是什么，如 封面图 / 标题 / 套餐组合）</label><input id="abtest-variable" class="dr-store-select" placeholder="如 封面图风格" style="padding:10px;color:var(--rep-text);"></div>'
                + customEditor
                + '<div style="font-size:12px;color:rgba(242,234,238,0.7);margin-top:10px;">A版本内容 *</div>'
                + '<textarea id="abtest-variant-a-text" class="dr-store-select" placeholder="描述 A 版本（如 探店实拍封面 + 套餐价标题）" style="margin-top:6px;width:100%;min-height:48px;padding:10px;color:var(--rep-text);resize:vertical;"></textarea>'
                + '<div style="font-size:12px;color:rgba(242,234,238,0.7);margin-top:10px;">B版本内容 *</div>'
                + '<textarea id="abtest-variant-b-text" class="dr-store-select" placeholder="描述 B 版本" style="margin-top:6px;width:100%;min-height:48px;padding:10px;color:var(--rep-text);resize:vertical;"></textarea>'
                + fieldsNote;
            if (tpl.key === 'custom') abAddCustomField();
        }

        // 自定义模板：动态字段编辑器。每行 key 由前端分配为 f1/f2…（保证与主指标分子/分母引用一致）。
        function abAddCustomField() {
            var host = document.getElementById('abtest-custom-fields');
            if (!host) return;
            if (_abCustomFieldKeys.length >= 12) { showNotification('最多 12 个字段', 'error'); return; }
            var idx = (_abCustomFieldKeys.length ? Math.max.apply(null, _abCustomFieldKeys.map(function(k){ return parseInt(k.slice(1), 10) || 0; })) : 0) + 1;
            var key = 'f' + idx;
            _abCustomFieldKeys.push(key);
            var row = document.createElement('div');
            row.id = 'abcf-row-' + key;
            row.style.cssText = 'display:grid;grid-template-columns:1fr 110px 36px;gap:6px;margin-bottom:6px;';
            row.innerHTML = '<input id="abcf-' + key + '-label" class="dr-store-select" placeholder="字段名（如 浏览量）" style="padding:8px;color:var(--rep-text);font-size:12px;" data-input="abRefreshCustomMetric">'
                + '<select id="abcf-' + key + '-type" class="dr-store-select" style="font-size:12px;"><option value="int">计数</option><option value="money">金额</option></select>'
                + '<button type="button" class="rep-seg-btn" style="padding:0;" data-click="abRemoveCustomField" data-arg="' + key + '">×</button>';
            host.appendChild(row);
            abRefreshCustomMetric();
        }
        function abRemoveCustomField(key) {
            _abCustomFieldKeys = _abCustomFieldKeys.filter(function(k) { return k !== key; });
            var row = document.getElementById('abcf-row-' + key);
            if (row) row.remove();
            abRefreshCustomMetric();
        }
        function abReadCustomFields() {
            return _abCustomFieldKeys.map(function(key) {
                var label = (document.getElementById('abcf-' + key + '-label')?.value || '').trim();
                var type = document.getElementById('abcf-' + key + '-type')?.value || 'int';
                return { key: key, label: label, type: type };
            }).filter(function(f) { return f.label; });
        }
        function abRefreshCustomMetric() {
            var fields = abReadCustomFields();
            var numSel = document.getElementById('abtest-primary-num');
            var denSel = document.getElementById('abtest-primary-den');
            if (!numSel || !denSel) return;
            var prevNum = numSel.value, prevDen = denSel.value;
            var numOpts = fields.map(function(f) { return '<option value="' + f.key + '">' + escapeHtml(f.label) + '</option>'; }).join('');
            numSel.innerHTML = numOpts || '<option value="">（先添加字段）</option>';
            denSel.innerHTML = '<option value="">（求和，无分母）</option>' + numOpts;
            if (prevNum) numSel.value = prevNum;
            if (prevDen) denSel.value = prevDen;
        }

        // 绑定模式：拉取可绑定的已有规则（规则引擎/订阅 touch_rule 或 支付发券 payment_rule）填入下拉框。
        async function loadAbBindableRules() {
            var kind = (_abCurrentTemplate && _abCurrentTemplate.bind_kind) || 'touch_rule';
            var sel = document.getElementById('abtest-target-rule');
            if (!sel) return;
            sel.innerHTML = '<option value="">加载中…</option>';
            _abBindableRules = {};
            try {
                var url = kind === 'payment_rule' ? '/api/growth/payment-rules' : '/api/growth/touch-rules';
                var r = await fetch(url, { headers: growthAuthHeaders() });
                var d = await r.json();
                var rows = d?.rules || d?.data || [];
                var opts = ['<option value="">— 请选择规则 —</option>'];
                rows.forEach(function(row) {
                    var key = row.rule_key || '';
                    if (!key) return;
                    _abBindableRules[key] = row;
                    opts.push('<option value="' + escapeHtml(key) + '">' + escapeHtml(row.name || key) + '</option>');
                });
                sel.innerHTML = opts.join('');
            } catch (e) {
                sel.innerHTML = '<option value="">加载失败</option>';
            }
            var aBox = document.getElementById('abtest-variant-a');
            if (aBox) aBox.value = '';
        }

        // 选中绑定规则后，把该规则当前版本带入 A组只读框。
        function onAbBindRuleChange() {
            var kind = (_abCurrentTemplate && _abCurrentTemplate.bind_kind) || 'touch_rule';
            var key = document.getElementById('abtest-target-rule')?.value || '';
            var aBox = document.getElementById('abtest-variant-a');
            var row = _abBindableRules[key];
            if (!aBox) return;
            if (!row) { aBox.value = ''; return; }
            if (kind === 'payment_rule') {
                aBox.value = '券模板ID：' + (row.member_template_id || '-') + ' ｜ 触发门槛：' + (row.trigger_value || '无');
            } else {
                var ap = row.action_payload || {};
                aBox.value = (ap.content_template || ap.template_text || '(该规则当前无文案内容)');
            }
        }

        async function createGrowthAbTest() {
            try {
                var tpl = _abCurrentTemplate;
                if (!tpl) { showNotification('请先选择测试模板', 'error'); return; }
                var name = (document.getElementById('abtest-name')?.value || '').trim();
                var store = (document.getElementById('abtest-store-code')?.value || '').trim()
                    || (document.getElementById('growth-store-filter')?.value || '').trim()
                    || '51866138';
                var minSample = parseInt(document.getElementById('abtest-minsample')?.value || '', 10);
                var start = (document.getElementById('abtest-start')?.value || '').trim();
                var end = (document.getElementById('abtest-end')?.value || '').trim();
                if (!name) { showNotification('请填写测试名称', 'error'); return; }
                var body = { test_name: name, store_code: store, template_key: tpl.key };
                if (Number.isFinite(minSample) && minSample > 0) body.min_sample_size = minSample;
                if (start) body.start_date = start;
                if (end) body.end_date = end;

                if (tpl.scope === 'bound') {
                    var ruleKey = (document.getElementById('abtest-target-rule')?.value || '').trim();
                    var vB = (document.getElementById('abtest-variant-b')?.value || '').trim();
                    if (!ruleKey) { showNotification('请选择要绑定的已有规则', 'error'); return; }
                    if (!vB) { showNotification('请填写 B组（挑战版本）内容', 'error'); return; }
                    body.target_rule_key = ruleKey;
                    body.variant_b = tpl.bind_kind === 'payment_rule'
                        ? { label: '挑战者(B)', template_id: vB, content: vB }
                        : { label: '挑战者(B)', content: vB };
                } else {
                    var variable = (document.getElementById('abtest-variable')?.value || '').trim();
                    var vAt = (document.getElementById('abtest-variant-a-text')?.value || '').trim();
                    var vBt = (document.getElementById('abtest-variant-b-text')?.value || '').trim();
                    if (!variable) { showNotification('请填写测试变量', 'error'); return; }
                    if (!vAt || !vBt) { showNotification('请填写 A / B 两个版本的内容', 'error'); return; }
                    body.variable = variable;
                    body.variant_a = { content: vAt };
                    body.variant_b = { content: vBt };
                    if (tpl.key === 'custom') {
                        var ch = (document.getElementById('abtest-channel')?.value || '').trim();
                        if (!ch) { showNotification('请填写渠道名称', 'error'); return; }
                        var fields = abReadCustomFields();
                        if (!fields.length) { showNotification('请至少添加 1 个录入字段', 'error'); return; }
                        var pNum = document.getElementById('abtest-primary-num')?.value || '';
                        if (!pNum) { showNotification('请选择主指标的分子字段', 'error'); return; }
                        body.channel = ch;
                        body.fields = fields;
                        body.primary = {
                            key: 'primary',
                            label: (document.getElementById('abtest-primary-label')?.value || '主指标').trim() || '主指标',
                            num: [pNum],
                            den: (document.getElementById('abtest-primary-den')?.value || '') || null,
                            format: document.getElementById('abtest-primary-format')?.value || 'pct'
                        };
                    }
                }
                var r = await fetch('/api/growth/ab-tests', {
                    method: 'POST',
                    headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify(body)
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.message || d.error || 'create_failed');
                showNotification(tpl.scope === 'bound' ? 'A/B测试已创建（已绑定规则）' : 'A/B测试已创建（外部渠道，结果手动录入）', 'success');
                ['abtest-name', 'abtest-store-code', 'abtest-start', 'abtest-end', 'abtest-minsample'].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.value = '';
                });
                document.getElementById('abtest-template').value = '';
                onAbTemplateChange();
                loadGrowthAbTests();
            } catch (e) {
                showNotification('创建失败：' + (e?.message || e), 'error');
            }
        }

        // 每张测试卡片下的「录入结果」内联表单（默认折叠）。字段按该测试的 metrics_schema 动态生成。
        function abResultFormHtml(id) {
            var t = _abTasksById[id] || {};
            var schema = (t.metrics_schema && typeof t.metrics_schema === 'object') ? t.metrics_schema : null;
            var fields = (schema && Array.isArray(schema.fields) && schema.fields.length)
                ? schema.fields
                : [{ key: 'sent', label: '发送' }, { key: 'clicks', label: '点击' }, { key: 'redemptions', label: '核销' }, { key: 'revenue', label: '营收¥' }];
            function cells(grp) {
                return fields.map(function(f) {
                    return '<input id="abres-' + id + '-' + grp + '-' + f.key + '" type="number" min="0" step="0.01" placeholder="' + escapeHtml(f.label) + '" class="dr-store-select" style="padding:8px;color:var(--rep-text);font-size:12px;">';
                }).join('');
            }
            var cols = Math.min(4, Math.max(2, fields.length));
            var gridStyle = 'display:grid;grid-template-columns:repeat(' + cols + ',minmax(0,1fr));gap:6px;';
            return '<div id="ab-result-form-' + id + '" style="display:none;margin-top:10px;padding:12px;border:1px solid rgba(242,234,238,0.08);border-radius:10px;background:rgba(242,234,238,0.02);">'
                + '<div style="font-size:12px;color:rgba(242,234,238,0.7);margin-bottom:8px;">录入真实投放结果，按该模板的指标分组填写，可多次录入累加。</div>'
                + '<div class="rep-field" style="margin-bottom:8px;"><label style="font-size:11px;">数据日期（留空=今天）</label><input id="abres-' + id + '-date" type="date" class="dr-store-select" style="padding:8px;color:var(--rep-text);"></div>'
                + '<div style="font-size:12px;font-weight:700;color:#fff;margin:6px 0 4px;">A组</div>'
                + '<div style="' + gridStyle + '">' + cells('a') + '</div>'
                + '<div style="font-size:12px;font-weight:700;color:#fff;margin:8px 0 4px;">B组</div>'
                + '<div style="' + gridStyle + '">' + cells('b') + '</div>'
                + '<div class="rep-seg" style="margin-top:10px;"><button class="rep-seg-btn rep-seg-btn--active" style="flex:1;" data-click="submitAbResult" data-arg="' + id + '" data-arg-type="number">提交结果并判定</button></div>'
                + '</div>';
        }

        function toggleAbResultForm(id) {
            var box = document.getElementById('ab-result-form-' + id);
            if (box) box.style.display = (box.style.display === 'none' || !box.style.display) ? 'block' : 'none';
        }

        // 手动录入 A/B 结果：按该测试 metrics_schema 的字段收集 A/B 两组数据并触发判定。
        async function submitAbResult(id) {
            try {
                function num(elId){ var v = parseFloat(document.getElementById(elId)?.value || ''); return Number.isFinite(v) ? v : 0; }
                var t = _abTasksById[id] || {};
                var schema = (t.metrics_schema && typeof t.metrics_schema === 'object') ? t.metrics_schema : null;
                var fields = (schema && Array.isArray(schema.fields) && schema.fields.length)
                    ? schema.fields
                    : [{ key: 'sent' }, { key: 'clicks' }, { key: 'redemptions' }, { key: 'revenue' }];
                var A = {}, B = {};
                fields.forEach(function(f) {
                    A[f.key] = num('abres-' + id + '-a-' + f.key);
                    B[f.key] = num('abres-' + id + '-b-' + f.key);
                });
                var body = { A: A, B: B };
                var rd = (document.getElementById('abres-' + id + '-date')?.value || '').trim();
                if (rd) body.result_date = rd;
                var r = await fetch('/api/growth/ab-tests/' + encodeURIComponent(String(id)) + '/results', {
                    method: 'POST',
                    headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify(body)
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.message || d.error || 'submit_failed');
                showNotification('结果已录入并完成判定', 'success');
                loadGrowthAbTests();
            } catch (e) {
                showNotification('录入失败：' + (e?.message || e), 'error');
            }
        }

        async function refreshGrowthAbTest(id) {
            try {
                var r = await fetch('/api/growth/ab-tests/' + encodeURIComponent(String(id || '')) + '/refresh', {
                    method: 'POST',
                    headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' })
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'refresh_failed');
                showNotification('测试结果已刷新', 'success');
                loadGrowthAbTests();
            } catch (e) {
                showNotification('刷新失败：' + (e?.message || e), 'error');
            }
        }

        // 闭环回路：把 A/B 胜出变体一键回写到所绑定的真实规则。
        async function promoteGrowthAbTest(id, winner) {
            var msg = winner === 'A'
                ? '确认采用 A组（当前版本）为胜者？\n\nA组即所绑定规则的现有版本，采用后规则维持不变，仅标记本次测试已采用。'
                : '确认采用 B组（挑战版本）为胜者？\n\n采用后将把 B组内容直接回写覆盖到所绑定的真实规则（规则引擎/订阅 的文案/券，或 支付发券 的券模板/门槛），并标记为已审核。绑定规则的引擎下一轮即按新版本投放。';
            if (!confirm(msg)) return;
            try {
                var r = await fetch('/api/growth/ab-tests/' + encodeURIComponent(String(id || '')) + '/promote', {
                    method: 'POST',
                    headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({})
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.message || d.error || 'promote_failed');
                showNotification('已采用为自动规则：' + (d.rule_key || ''), 'success');
                loadGrowthAbTests();
                if (typeof loadAutoMarketing === 'function') { try { loadAutoMarketing(); } catch (e) {} }
            } catch (e) {
                showNotification('采用失败：' + (e?.message || e), 'error');
            }
        }

        async function loadGrowthLearnings() {
            try {
                var store = document.getElementById('growth-store-filter')?.value || '51866138';
                var r = await fetch('/api/growth/learnings?store_code=' + encodeURIComponent(store), { headers: growthAuthHeaders() });
                var d = await r.json();
                var rows = d?.learnings || [];
                var host = document.getElementById('growth-learnings-list');
                var countEl = document.getElementById('growth-ab-learning-count');
                if (countEl) countEl.textContent = rows.length;
                if (!host) return;
                host.innerHTML = rows.length ? rows.map(function(x) {
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);">'
                        + '<div style="font-size:13px;font-weight:700;color:#fff;">' + escapeHtml(x.variable || '-') + ' · ' + escapeHtml(x.channel || '-') + '</div>'
                        + '<div style="font-size:12px;color:rgba(242,234,238,0.78);margin-top:4px;">胜出：' + escapeHtml(x.winning_value || '-') + (x.losing_value ? ' ｜ 落败：' + escapeHtml(x.losing_value) : '') + '</div>'
                        + '<div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">' + escapeHtml(x.effect_desc || '-') + ' · 样本' + escapeHtml(String(x.sample_size || 0)) + ' · 置信度' + escapeHtml(x.confidence || 'medium') + '</div>'
                        + '</div>';
                }).join('') : '<div class="rep-pay-empty">暂无经验库数据</div>';
            } catch (e) {
                var host = document.getElementById('growth-learnings-list');
                if (host) host.innerHTML = '<div class="rep-pay-empty">加载经验库失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }

        async function loadGrowthContentSuggestions() {
            try {
                var store = document.getElementById('growth-store-filter')?.value || '51866138';
                var r = await fetch('/api/growth/content-suggestions?store_code=' + encodeURIComponent(store), { headers: growthAuthHeaders() });
                var d = await r.json();
                var rows = d?.suggestions || [];
                var host = document.getElementById('growth-content-suggestions-list');
                host.innerHTML = rows.length ? rows.map(function(x) {
                    var summary = x.summary_json || {};
                    var items = Array.isArray(summary.items) ? summary.items : [];
                    return '<div style="padding:12px 0;border-bottom:1px solid rgba(242,234,238,0.06);">'
                        + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">'
                        + '<div><div style="font-size:14px;font-weight:800;color:#fff;">周建议 · ' + escapeHtml(summary.store_code || x.store_code || '-') + '</div><div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">周起始 ' + escapeHtml(x.week_start || '-') + '</div></div>'
                        + '<div style="font-size:11px;color:' + (x.feishu_pushed_at ? '#86C9A2' : '#CFA14A') + ';font-weight:700;">' + (x.feishu_pushed_at ? '已推飞书' : '未推送') + '</div>'
                        + '</div>'
                        + '<div style="margin-top:10px;font-size:12px;color:rgba(242,234,238,0.78);line-height:1.6;">' + escapeHtml(summary.summary_text || '') + '</div>'
                        + items.map(function(it) {
                            return '<div style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(242,234,238,0.03);border:1px solid rgba(242,234,238,0.05);">'
                                + '<div style="font-size:13px;font-weight:700;color:#fff;">' + escapeHtml(String(it.rank || '')) + '）' + escapeHtml(it.theme || '-') + '</div>'
                                + '<div style="font-size:12px;color:rgba(242,234,238,0.78);margin-top:4px;">' + escapeHtml(it.reason || '-') + '</div>'
                                + (it.sms_copy_a ? '<div style="font-size:11px;color:var(--rep-gold);margin-top:6px;">A：' + escapeHtml(it.sms_copy_a) + '</div>' : '')
                                + (it.sms_copy_b ? '<div style="font-size:11px;color:#EABBC5;margin-top:4px;">B：' + escapeHtml(it.sms_copy_b) + '</div>' : '')
                                + '</div>';
                        }).join('')
                        + '</div>';
                }).join('') : '<div class="rep-pay-empty">暂无内容建议</div>';
            } catch (e) {
                document.getElementById('growth-content-suggestions-list').innerHTML = '<div class="rep-pay-empty">加载建议失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }

        async function generateGrowthContentSuggestions() {
            try {
                var store = document.getElementById('growth-store-filter')?.value || '51866138';
                var r = await fetch('/api/growth/content-suggestions/generate', {
                    method: 'POST',
                    headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ store_code: store })
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'generate_failed');
                showNotification('内容建议已生成并尝试推送飞书', 'success');
                loadGrowthContentSuggestions();
                loadGrowthLearnings();
            } catch (e) {
                showNotification('生成失败：' + (e?.message || e), 'error');
            }
        }

        async function loadGrowthContentPerformance() {
            try {
                var store = document.getElementById('growth-store-filter')?.value || '51866138';
                var r = await fetch('/api/growth/content-performance-v2?store_code=' + encodeURIComponent(store), { headers: growthAuthHeaders() });
                var d = await r.json();
                var rows = d?.items || [];
                var host = document.getElementById('growth-content-performance-list');
                host.innerHTML = rows.length ? rows.map(function(x) {
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);">'
                        + '<div style="font-size:13px;font-weight:700;color:#fff;">' + escapeHtml(x.content_title || x.channel || '-') + '</div>'
                        + '<div style="font-size:12px;color:rgba(242,234,238,0.78);margin-top:4px;">' + escapeHtml(x.channel || '-') + ' · ' + escapeHtml(x.scene || '-') + ' · ' + escapeHtml(x.audience_tag || '-') + '</div>'
                        + '<div style="font-size:11px;color:var(--rep-muted);margin-top:4px;">曝光' + (x.impressions || 0) + ' · 点击' + (x.clicks || 0) + ' · 订单' + (x.orders || 0) + ' · 核销' + (x.redemptions || 0) + ' · 营收¥' + Number(x.revenue || 0).toFixed(2) + '</div>'
                        + '</div>';
                }).join('') : '<div class="rep-pay-empty">暂无内容效果记录</div>';
            } catch (e) {
                document.getElementById('growth-content-performance-list').innerHTML = '<div class="rep-pay-empty">加载效果失败：' + escapeHtml(e?.message || e) + '</div>';
            }
        }

        async function saveGrowthContentPerformance() {
            try {
                var store = document.getElementById('growth-store-filter')?.value || '51866138';
                var payload = {
                    store_code: store,
                    channel: document.getElementById('content-perf-channel')?.value || 'sms',
                    scene: document.getElementById('content-perf-scene')?.value || '',
                    audience_tag: document.getElementById('content-perf-audience')?.value || '',
                    variable: document.getElementById('content-perf-variable')?.value || '',
                    content_title: document.getElementById('content-perf-title')?.value || '',
                    winning_value: document.getElementById('content-perf-winning')?.value || '',
                    losing_value: document.getElementById('content-perf-losing')?.value || '',
                    impressions: Number(document.getElementById('content-perf-impressions')?.value || 0),
                    clicks: Number(document.getElementById('content-perf-clicks')?.value || 0),
                    orders: Number(document.getElementById('content-perf-orders')?.value || 0),
                    redemptions: Number(document.getElementById('content-perf-redemptions')?.value || 0),
                    revenue: Number(document.getElementById('content-perf-revenue')?.value || 0),
                    notes: document.getElementById('content-perf-notes')?.value || ''
                };
                if (!payload.content_title) {
                    showNotification('请填写内容标题', 'warning');
                    return;
                }
                var r = await fetch('/api/growth/content-performance-v2', {
                    method: 'POST',
                    headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify(payload)
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                showNotification('内容效果已保存，并写入经验库', 'success');
                loadGrowthContentPerformance();
                loadGrowthLearnings();
            } catch (e) {
                showNotification('保存失败：' + (e?.message || e), 'error');
            }
        }

        async function loadGrowthConstraints() {
            try {
                const r = await fetch('/api/growth/store-constraints', { headers: growthAuthHeaders() });
                const data = await r.json();
                const rows = data?.constraints || [];
                const host = document.getElementById('growth-constraints-list');
                host.innerHTML = rows.length ? rows.map(function(x) {
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:13px;">'
                        + '<div style="color:#fff;font-weight:600;">' + (x.store_id || '-') + ' · ' + (x.brand || '-') + '</div>'
                        + '<div style="color:rgba(242,234,238,0.6);margin-top:4px;">最低折扣: ' + (x.min_discount_rate || '-') + ' · 最大券面值: ' + (x.max_coupon_value_fen || '-') + '分 · 月预算: ' + (x.monthly_budget_fen || '-') + '分</div>'
                        + '<div style="color:rgba(242,234,238,0.45);margin-top:4px;">品牌语气: ' + (x.brand_voice_style || '-') + '</div>'
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无营销约束</div>';
            } catch (e) {
                document.getElementById('growth-constraints-list').innerHTML = '<div style="color:#E58B98;">加载营销约束失败</div>';
            }
        }

        async function applyBrandTemplate() {
            var v = document.getElementById('constraint-brand-template')?.value || '';
            var TEMPLATES = {
                majixian: { brand:'马己仙广东小馆', voice:'精致', min_discount:0.85, max_coupon:2000, budget:80000, touch:2, cooldown:48, channels:['wecom','xiaohongshu','dianping','douyin'], disallowed:['大额折扣'] },
                hongchao: { brand:'洪潮', voice:'豪迈', min_discount:0.8, max_coupon:3000, budget:50000, touch:1, cooldown:24, channels:['wecom','xiaohongshu','dianping','douyin'], disallowed:['赠品'] },
                custom: { brand:'自定义', voice:'', min_discount:0.9, max_coupon:1000, budget:30000, touch:1, cooldown:24, channels:[], disallowed:[] }
            };
            var t = TEMPLATES[v] || TEMPLATES.custom;
            var si = document.getElementById('constraint-store-id');
            if (si && !si.value && v !== 'custom' && v) si.value = 'store_' + v;
            setVal('constraint-brand', t.brand);
            setVal('constraint-min-discount', t.min_discount);
            setVal('constraint-max-coupon', t.max_coupon);
            setVal('constraint-budget', t.budget);
            setVal('constraint-touch', t.touch);
            setVal('constraint-cooldown', t.cooldown);
            if (document.getElementById('constraint-voice')) document.getElementById('constraint-voice').value = t.voice;
            setCheckboxes('constraint-channels-checkboxes', t.channels);
            setCheckboxes('constraint-campaign-checkboxes', t.disallowed);
        }
        function setVal(id, v) { var e = document.getElementById(id); if (e) e.value = v == null ? '' : v; }
        function setCheckboxes(containerId, values) {
            var el = document.getElementById(containerId);
            if (!el) return;
            var cbs = el.querySelectorAll('input[type=checkbox]');
            for (var i = 0; i < cbs.length; i++) cbs[i].checked = values.indexOf(cbs[i].value) >= 0;
        }

        async function saveGrowthConstraint() {
            try {
                const payload = {
                    store_id: document.getElementById('constraint-store-id')?.value || '',
                    brand: document.getElementById('constraint-brand')?.value || '',
                    min_discount_rate: document.getElementById('constraint-min-discount')?.value || null,
                    max_coupon_value_fen: document.getElementById('constraint-max-coupon')?.value || null,
                    monthly_budget_fen: document.getElementById('constraint-budget')?.value || null,
                    max_touch_per_72h: document.getElementById('constraint-touch')?.value || 1,
                    cooldown_hours_after_payment: document.getElementById('constraint-cooldown')?.value || 24,
                    brand_voice_style: document.getElementById('constraint-voice')?.value || '',
                    disallowed_campaign_types: getCheckedBoxes('constraint-campaign-checkboxes'),
                    disallowed_dishes: growthCsvList('constraint-disallowed-dishes'),
                    allowed_channels: getCheckedBoxes('constraint-channels-checkboxes'),
                    execution_notes: document.getElementById('constraint-notes')?.value || ''
                };
                const r = await fetch('/api/growth/store-constraints', {
                    method: 'POST',
                    headers: growthAuthHeaders(),
                    body: JSON.stringify(payload)
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'save_failed');
                showNotification('营销约束已保存', 'success');
                loadGrowthConstraints();
            } catch (e) {
                showNotification('保存营销约束失败：' + (e?.message || e), 'error');
            }
        }

        async function loadGrowthActionBoard() {
            try {
                var host = document.getElementById('growth-action-board');
                if (!host) { console.error('loadGrowthActionBoard: growth-action-board element not found'); return; }
                host.innerHTML = '<div style="color:rgba(242,234,238,0.3);padding:10px 0;">加载中...</div>';
                var statusFilter = document.getElementById('growth-action-status-filter')?.value || '';
                var channelFilter = document.getElementById('growth-action-channel-filter')?.value || '';
                var url = '/api/growth/actions?limit=200';
                if (statusFilter) url += '&status=' + encodeURIComponent(statusFilter);
                if (channelFilter) url += '&channel=' + encodeURIComponent(channelFilter);
                const r = await fetch(url, { headers: growthAuthHeaders() });
                const actionsData = await r.json();
                if (!actionsData.ok) throw new Error(actionsData.error || 'api_error');
                const rows = actionsData?.actions || [];
                try { document.getElementById('__growth_actions_cache').textContent = JSON.stringify(rows); } catch (e) {}
                var channelLabels = { 'miniprogram': '会员小程序', 'wecom': '企微', 'xiaohongshu': '小红书', 'douyin': '抖音', 'pengyouquan': '朋友圈', 'dianping': '大众点评', 'waimai': '美团', 'sms': '短信', 'subscribe': '订阅消息' };
                var actionTypeLabels = { 'send_voucher': '🎫 发券', 'campaign_activate': '🚀 激活活动', 'create_content': '📝 创建内容', 'promo_task': '📋 推广任务', 'generate_poster': '🖼️ 生成海报', 'pllm_task': '🤖 PLLM任务', 'pllm_experiment': '🧭 PLLM策略实验' };
                host.innerHTML = rows.length ? rows.map(function(x) {
                    const key = x.action_key || '';
                    var payload = x.payload || {};

                    // --- pllm_experiment: 方案A/B卡片专属渲染 ---
                    if (x.action_type === 'pllm_experiment') {
                        var va = payload.variant_a;
                        var vb = payload.variant_b;
                        var expCode = payload.experiment_code || '';
                        var anomaly = payload.anomaly_type || '';
                        var variantHtml = '';
                        if (va) {
                            variantHtml += '<div style="margin-top:8px;padding:8px 10px;background:rgba(134,201,162,0.06);border:1px solid rgba(134,201,162,0.2);border-radius:8px;">'
                                + '<div style="font-size:10px;color:#86C9A2;font-weight:700;margin-bottom:4px;">方案A — ' + escapeHtml(va.label || '') + '</div>'
                                + '<div style="font-size:11px;color:rgba(242,234,238,0.85);line-height:1.55;white-space:pre-wrap;">' + escapeHtml(va.action || '') + '</div>'
                                + (va.execution_guide ? '<div style="font-size:10px;color:rgba(242,234,238,0.45);margin-top:4px;line-height:1.5;white-space:pre-wrap;">' + escapeHtml(va.execution_guide) + '</div>' : '')
                                + '</div>';
                        }
                        if (vb) {
                            variantHtml += '<div style="margin-top:6px;padding:8px 10px;background:rgba(209,143,160,0.06);border:1px solid rgba(209,143,160,0.2);border-radius:8px;">'
                                + '<div style="font-size:10px;color:#E0A6B4;font-weight:700;margin-bottom:4px;">方案B — ' + escapeHtml(vb.label || '') + '</div>'
                                + '<div style="font-size:11px;color:rgba(242,234,238,0.85);line-height:1.55;white-space:pre-wrap;">' + escapeHtml(vb.action || '') + '</div>'
                                + (vb.execution_guide ? '<div style="font-size:10px;color:rgba(242,234,238,0.45);margin-top:4px;line-height:1.5;white-space:pre-wrap;">' + escapeHtml(vb.execution_guide) + '</div>' : '')
                                + '</div>';
                        }
                        var ts = (function(d){ try { return new Date(d).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); } catch(e){ return String(d).slice(0,16); } })(x.created_at);
                        return '<div style="padding:12px 0;border-bottom:1px solid rgba(242,234,238,0.05);border-left:3px solid #D18FA0;padding-left:10px;">'
                            + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
                            + '<div style="flex:1;min-width:0;">'
                            + '<span style="display:inline-block;font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(209,143,160,0.18);color:#D18FA0;font-weight:700;margin-right:6px;vertical-align:middle;">🧭 PLLM策略实验</span>'
                            + (anomaly ? '<span style="font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(207,161,74,0.15);color:#CFA14A;font-weight:600;margin-right:6px;vertical-align:middle;">' + escapeHtml(typeof hrmsAnomalyLabel === 'function' ? hrmsAnomalyLabel(anomaly) : anomaly) + '</span>' : '')
                            + '<span style="font-weight:700;color:#fff;font-size:14px;">' + escapeHtml(x.title || '-') + '</span>'
                            + '<span style="margin-left:8px;font-size:11px;padding:2px 10px;border-radius:999px;background:rgba(207,161,74,0.15);color:#CFA14A;font-weight:600;">⚡ 待审批</span>'
                            + '</div>'
                            + '<div style="font-size:11px;padding:2px 10px;border-radius:999px;background:rgba(209,143,160,0.12);color:#D18FA0;font-weight:600;flex-shrink:0;">PLLM</div>'
                            + '</div>'
                            + '<div style="font-size:11px;color:rgba(242,234,238,0.45);margin-top:4px;">' + ts + (expCode ? ' · ' + expCode : '') + '</div>'
                            + (x.detail ? '<div style="font-size:12px;color:rgba(242,234,238,0.7);margin-top:6px;line-height:1.5;">' + escapeHtml(x.detail) + '</div>' : '')
                            + variantHtml
                            + '<div style="display:flex;gap:8px;margin-top:10px;">'
                            + '<button data-click="approvePllmExp" data-arg="' + expCode + '" style="flex:1;padding:7px 12px;border:none;border-radius:8px;background:rgba(134,201,162,0.15);color:#86C9A2;cursor:pointer;font-size:11px;font-weight:700;">✅ 采纳·我要执行</button>'
                            + '<button data-click="rejectPllmExp" data-arg="' + expCode + '" style="flex-shrink:0;padding:7px 10px;border:none;border-radius:8px;background:rgba(229,139,152,0.1);color:#E58B98;cursor:pointer;font-size:11px;">不适合</button>'
                            + '</div>'
                            + '</div>';
                    }

                    var posterUrl = payload.poster_url || payload.output_url || '';
                    var confidence = payload.confidence_level || '';
                    var confidenceColor = confidence === '高置信' ? '#86C9A2' : confidence === '试验性' ? '#CFA14A' : confidence === '需人工判断' ? '#E58B98' : '#7A6B72';
                    var channel = payload.channel || '';
                    var channelLabel = channelLabels[channel] || channel || '-';
                    var channelColor = channel === 'wecom' ? '#86C9A2' : channel === 'miniprogram' ? '#EABBC5' : channel === 'xiaohongshu' ? '#E58B98' : '#97848E';
                    var typeLabel = actionTypeLabels[x.action_type] || '✅ 触达';
                    var isPllm = x.action_type === 'pllm_task';
                    var isFinal = x.status === 'executed' || x.status === 'ignored';
                    var kpi = payload.expected_kpi || {};
                    var kpiHtml = (kpi && (kpi.redemption_rate || kpi.revenue_fen || kpi.reach)) ?
                        '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">'
                        + '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:rgba(209,143,160,0.12);color:#EABBC5;">🎯 预计核销率 ' + (kpi.redemption_rate || 0) + '%</span>'
                        + '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:rgba(209,143,160,0.12);color:#EABBC5;">预计营收 ¥' + Math.round(Number(kpi.revenue_fen || 0) / 100) + '</span>'
                        + '<span style="font-size:10px;padding:2px 8px;border-radius:6px;background:rgba(209,143,160,0.12);color:#EABBC5;">预计触达 ' + (kpi.reach || 0) + '人</span>'
                        + '</div>' : '';
                    var readyCopy = payload.ready_copy || '';
                    var readyCopyHtml = readyCopy ?
                        '<div style="margin-top:6px;padding:8px 10px;background:rgba(134,201,162,0.05);border:1px solid rgba(134,201,162,0.18);border-radius:8px;">'
                        + '<div style="font-size:10px;color:#86C9A2;font-weight:700;margin-bottom:4px;">📝 成品文案（可直接使用）</div>'
                        + '<div style="font-size:11px;color:rgba(242,234,238,0.85);line-height:1.6;white-space:pre-wrap;">' + escapeHtml(readyCopy) + '</div>'
                        + '<button data-click="hrmsCopyReadyCopy" data-arg-self="1" data-stop data-copy="' + escapeHtml(readyCopy) + '" style="margin-top:6px;padding:3px 10px;border:none;border-radius:6px;background:rgba(134,201,162,0.15);color:#86C9A2;font-size:10px;cursor:pointer;">📋 复制文案</button>'
                        + '</div>' : '';
                    var oc = payload.outcome_summary || null;
                    var ocHtml = (oc && oc.effectiveness_score != null) ?
                        '<div style="margin-top:6px;padding:8px 10px;background:rgba(242,234,238,0.03);border-radius:8px;">'
                        + '<span style="font-size:11px;font-weight:700;color:' + (oc.effectiveness === '有效' ? '#86C9A2' : oc.effectiveness === '无效' ? '#E58B98' : '#CFA14A') + ';">📊 实际效果 ' + oc.effectiveness + ' · ' + oc.effectiveness_score + '分</span>'
                        + '<span style="font-size:10px;color:rgba(242,234,238,0.5);margin-left:8px;">核销率' + (oc.actual_redemption_rate != null ? oc.actual_redemption_rate + '%' : '-') + ' / 营收¥' + (oc.actual && oc.actual.revenue_fen != null ? Math.round(oc.actual.revenue_fen / 100) : '-') + ' / 达成' + (oc.achievement != null ? Math.round(oc.achievement * 100) + '%' : '-') + '</span>'
                        + '</div>' : '';
                    var draftPreview = '<div style="margin-top:6px;padding:8px 10px;background:rgba(209,143,160,0.04);border:1px solid rgba(209,143,160,0.12);border-radius:8px;font-size:11px;">'
                        + '<div style="display:flex;gap:8px;flex-wrap:wrap;color:var(--rep-muted);">'
                        + '<span>门店 ' + escapeHtml(growthStoreName(x.store_id) || '-') + (confidence ? ' <span style="font-size:10px;padding:1px 6px;border-radius:999px;background:' + confidenceColor + '22;color:' + confidenceColor + ';">' + confidence + '</span>' : '') + '</span>'
                        + '<span>目标 ' + (payload.target_audience || payload.audience || '活跃客群') + '</span>'
                        + (payload.execution_time ? '<span>🕐 ' + escapeHtml(payload.execution_time) + '</span>' : '')
                        + (payload.cost_estimate ? '<span>' + escapeHtml(payload.cost_estimate) + '</span>' : (payload.budget_fen ? '<span>预算 ¥' + Math.round(Number(payload.budget_fen) / 100) + '</span>' : ''))
                        + '<span style="color:rgba(242,234,238,0.4);">' + (function(ts){ try { return new Date(ts).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); } catch(e){ return String(ts).slice(0,16); } })(x.executed_at || x.created_at) + '</span>'
                        + '</div>'
                        + kpiHtml
                        + readyCopyHtml
                        + (readyCopy ? '' : (function(){ var fullText = payload.execution_action || x.detail || ''; var eid = 'exp-' + key.replace(/[^a-z0-9]/gi,'_'); var isLong = fullText.length > 150; var preview = isLong ? fullText.slice(0,150) + '…' : fullText; return '<div style="margin-top:4px;color:rgba(242,234,238,0.6);line-height:1.6;">' + '<span id="' + eid + '-txt" style="white-space:pre-wrap;">' + escapeHtml(preview) + '</span>' + (isLong ? '<span id="' + eid + '-full" style="white-space:pre-wrap;display:none;">' + escapeHtml(fullText) + '</span>' + '<button data-click="hrmsExpandCollapsePair" data-arg="' + eid + '-txt" data-arg2="' + eid + '-full" data-arg-self data-stop style="margin-left:6px;padding:1px 8px;border:none;border-radius:6px;background:rgba(209,143,160,0.15);color:#D18FA0;font-size:10px;cursor:pointer;">展开全文</button>' : '') + '</div>'; })())
                        + ocHtml
                        + '</div>';
                    var posterHtml;
                    if (posterUrl) {
                        posterHtml = '<div style="margin-top:8px;display:flex;gap:10px;align-items:center;padding:8px 10px;background:rgba(242,234,238,0.03);border:1px solid rgba(242,234,238,0.05);border-radius:10px;"><img src="' + escapeHtml(posterUrl) + '" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid rgba(242,234,238,0.08);"><div style="font-size:11px;color:rgba(242,234,238,0.58);">已绑定海报</div></div>';
                    } else if (x.status === 'proposed' && (x.action_type === 'send_voucher' || x.action_type === 'campaign_activate')) {
                        posterHtml = '<div style="margin-top:8px;padding:8px 10px;background:rgba(207,161,74,0.06);border:1px dashed rgba(207,161,74,0.3);border-radius:10px;font-size:11px;color:#CFA14A;cursor:pointer;" data-click="openPosterPicker" data-arg="' + key + '">🖼️ 未绑定海报 — 点此选择海报</div>';
                    } else {
                        posterHtml = '';
                    }
                    // LLM建议=纯人工看板：采纳(不自动发)→执行后回填结果→自动打分；非LLM动作保留原执行链路
                    var isLlm = isPllm || (payload.source === 'llm_campaign_autopilot') || !!payload.expected_kpi || !!payload.confidence_level;
                    var actionButtons;
                    if (isLlm) {
                        if (x.status === 'proposed') {
                            actionButtons = '<button data-click="adoptGrowthSuggestion" data-arg="' + key + '" style="flex:1;padding:6px 12px;border:none;border-radius:8px;background:rgba(134,201,162,0.15);color:#86C9A2;cursor:pointer;font-size:11px;font-weight:700;">✅ 采纳·我要执行</button>'
                                + '<button data-click="ignoreGrowthAction" data-arg="' + key + '" style="flex-shrink:0;padding:6px 10px;border:none;border-radius:8px;background:rgba(229,139,152,0.1);color:#E58B98;cursor:pointer;font-size:11px;">忽略</button>';
                        } else if (x.status === 'executing' || x.status === 'adopted') {
                            actionButtons = '<button data-click="openResultFeedbackForm" data-arg="' + key + '" style="flex:1;padding:6px 12px;border:none;border-radius:8px;background:rgba(207,161,74,0.15);color:#CFA14A;cursor:pointer;font-size:11px;font-weight:700;">⏳ 回填活动结果</button>';
                        } else if (x.status === 'measured') {
                            actionButtons = '<button data-click="openResultFeedbackForm" data-arg="' + key + '" style="flex:1;padding:6px 12px;border:none;border-radius:8px;background:rgba(242,234,238,0.06);color:rgba(242,234,238,0.7);cursor:pointer;font-size:11px;">✏️ 修正结果</button>';
                        } else {
                            actionButtons = '';
                        }
                    } else {
                        actionButtons = !isFinal ?
                            '<button data-click="executeGrowthAction" data-arg="' + key + '" style="flex:1;padding:6px 12px;border:none;border-radius:8px;background:rgba(134,201,162,0.15);color:#86C9A2;cursor:pointer;font-size:11px;font-weight:700;">批准执行</button>'
                            + '<button data-click="openEditExecuteForm" data-arg="' + key + '" style="flex:1;padding:6px 12px;border:none;border-radius:8px;background:rgba(209,143,160,0.12);color:#EABBC5;cursor:pointer;font-size:11px;font-weight:600;">修改后执行</button>'
                            + '<button data-click="ignoreGrowthAction" data-arg="' + key + '" style="flex-shrink:0;padding:6px 10px;border:none;border-radius:8px;background:rgba(229,139,152,0.1);color:#E58B98;cursor:pointer;font-size:11px;">忽略</button>'
                            : '';
                    }
                    var statusBadge = x.status === 'executed' ? '✅ 已执行' : x.status === 'ignored' ? '⛔ 已忽略' : x.status === 'proposed' ? '⚡ 可执行' : x.status === 'executing' || x.status === 'adopted' ? '⏳ 执行中·待回填' : x.status === 'measured' ? '📊 已测评' : x.status || '-';
                    var statusBadgeStyle = x.status === 'executed' || x.status === 'measured' ? 'background:rgba(134,201,162,0.15);color:#86C9A2' : x.status === 'ignored' ? 'background:rgba(229,139,152,0.12);color:#E58B98' : 'background:rgba(207,161,74,0.15);color:#CFA14A';
                    return '<div style="padding:12px 0;border-bottom:1px solid rgba(242,234,238,0.05);' + (isPllm ? 'border-left:3px solid #D18FA0;padding-left:10px;' : '') + '">'
                        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">'
                        + '<div style="flex:1;min-width:0;cursor:pointer;" data-click="openActionDetailModal" data-arg="' + key + '">'
                        + (isPllm ? '<span style="display:inline-block;font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(209,143,160,0.18);color:#D18FA0;font-weight:700;margin-right:6px;vertical-align:middle;">🤖 PLLM智能检测</span>' : '')
                        + '<span style="font-weight:700;color:#fff;font-size:14px;">' + (isPllm ? '' : typeLabel + ' ') + (x.title || '-') + '</span>'
                        + '<span style="margin-left:8px;font-size:11px;padding:2px 10px;border-radius:999px;' + statusBadgeStyle + ';font-weight:600;">' + statusBadge + '</span>'
                        + '</div>'
                        + '<div style="font-size:11px;padding:2px 10px;border-radius:999px;background:' + channelColor + '18;color:' + channelColor + ';font-weight:600;flex-shrink:0;">' + channelLabel + '</div>'
                        + '</div>'
                        + posterHtml
                        + draftPreview
                        + (actionButtons ? '<div style="margin-top:8px;display:flex;gap:6px;align-items:center;">' + actionButtons + '</div>' : '')
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无AI建议</div>';
            } catch (e) {
                document.getElementById('growth-action-board').innerHTML = '<div style="color:#E58B98;">加载AI建议失败</div>';
            }
        }

        async function executeGrowthAction(actionKey) {
            showExecConfirm(actionKey, 'execute');
        }

        var __execConfirmData = null;
        function showExecConfirm(actionKey, mode) {
            var actions = JSON.parse(document.getElementById('__growth_actions_cache')?.textContent || '[]');
            var x = actions.find(function(a) { return a.action_key === actionKey; });
            if (!x) { showNotification('动作数据未缓存', 'warning'); return; }
            __execConfirmData = { actionKey: actionKey, mode: mode || 'execute', action: x };
            var payload = x.payload || {};
            var channelLabels = { 'miniprogram': '会员小程序', 'wecom': '企微', 'xiaohongshu': '小红书', 'douyin': '抖音', 'pengyouquan': '朋友圈', 'dianping': '大众点评', 'waimai': '美团', 'sms': '短信', 'subscribe': '订阅消息' };
            var channel = payload.channel || 'wecom';
            var channelLabel = channelLabels[channel] || channel;
            var audienceLabels = { 'all': '全部客户', 'new': '新客', 'loyal': '老客/忠诚', 'churn': '流失预警', 'birthday': '生日月客户' };
            var audience = payload.target_audience || payload.audience || 'all';
            var couponValue = payload.coupon_value_fen || payload.value_fen || 0;
            var budget = payload.budget_fen || 0;
            var validDays = payload.valid_days || 7;
            var body = document.getElementById('exec-confirm-body');
            var posterUrl = payload.poster_url || payload.output_url || '';

            var channelColors = { 'wecom': '#86C9A2', 'miniprogram': '#EABBC5', 'xiaohongshu': '#E58B98', 'douyin': '#CFA14A', 'pengyouquan': '#5C9A76', 'dianping': '#D18FA0', 'waimai': '#CFA14A' };
            var cc = channelColors[channel] || '#97848E';

            var matchStatus = '';
            var matchColor = '#86C9A2';
            if (x.action_type === 'send_voucher' || x.action_type === 'campaign_activate') {
                if (!couponValue && !payload.execution_action) {
                    matchStatus = '⚠️ 缺少券金额或执行动作';
                    matchColor = '#CFA14A';
                } else if (!posterUrl) {
                    matchStatus = '⚠️ 未绑定海报，客户看不到视觉素材';
                    matchColor = '#CFA14A';
                } else {
                    matchStatus = '✅ 消息文案与券匹配正常';
                    matchColor = '#86C9A2';
                }
            } else {
                matchStatus = '✅ 触达任务';
                matchColor = '#86C9A2';
            }

            body.innerHTML =
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">'
                + '<div style="padding:10px;background:rgba(242,234,238,0.03);border-radius:8px;"><span style="color:rgba(242,234,238,0.5);">发送渠道</span><div style="color:' + cc + ';font-weight:700;margin-top:4px;font-size:14px;">📡 ' + channelLabel + '</div></div>'
                + '<div style="padding:10px;background:rgba(242,234,238,0.03);border-radius:8px;"><span style="color:rgba(242,234,238,0.5);">目标人群</span><div style="color:#fff;font-weight:600;margin-top:4px;font-size:14px;">' + (audienceLabels[audience] || audience) + '</div></div>'
                + '<div style="padding:10px;background:rgba(242,234,238,0.03);border-radius:8px;"><span style="color:rgba(242,234,238,0.5);">门店</span><div style="color:#fff;margin-top:4px;font-size:14px;">' + escapeHtml(growthStoreName(x.store_id) || '-') + '</div></div>'
                + '<div style="padding:10px;background:rgba(242,234,238,0.03);border-radius:8px;"><span style="color:rgba(242,234,238,0.5);">执行动作</span><div style="color:#fff;margin-top:4px;font-size:13px;">' + (payload.execution_action || x.detail || x.title || '-') + '</div></div>'
                + '</div>'
                + (couponValue ? '<div style="padding:12px;background:rgba(134,201,162,0.06);border:1px solid rgba(134,201,162,0.15);border-radius:10px;margin-top:10px;"><span style="color:rgba(242,234,238,0.5);font-size:12px;">优惠券</span><div style="color:#86C9A2;font-weight:700;margin-top:4px;">🎫 ¥' + (Math.round(couponValue / 100)) + ' · 有效期 ' + validDays + ' 天</div></div>' : '')
                + (budget ? '<div style="padding:12px;background:rgba(207,161,74,0.06);border:1px solid rgba(207,161,74,0.15);border-radius:10px;margin-top:4px;"><span style="color:rgba(242,234,238,0.5);font-size:12px;">预算</span><div style="color:#CFA14A;font-weight:700;margin-top:4px;">💰 ¥' + (Math.round(budget / 100)) + '</div></div>' : '')
                + (posterUrl ? '<div style="padding:10px;background:rgba(242,234,238,0.03);border-radius:8px;margin-top:10px;"><span style="color:rgba(242,234,238,0.5);font-size:12px;">附带海报</span><div style="margin-top:6px;"><img src="' + escapeHtml(posterUrl) + '" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid rgba(242,234,238,0.08);object-fit:contain;"></div></div>' : '')
                + '<div style="margin-top:12px;padding:14px;background:rgba(242,234,238,0.02);border:1px solid rgba(242,234,238,0.06);border-radius:10px;">'
                + '<div style="font-size:12px;font-weight:700;color:rgba(242,234,238,0.75);margin-bottom:8px;">📱 客户将收到的消息预览</div>'
                + '<div style="background:rgba(242,234,238,0.04);border:1px solid rgba(242,234,238,0.08);border-radius:10px;padding:14px;font-size:13px;line-height:1.8;color:rgba(242,234,238,0.85);">'
                + '<div style="font-weight:700;color:#fff;font-size:14px;margin-bottom:6px;">' + escapeHtml(x.title || '营销活动') + '</div>'
                + '<div style="color:rgba(242,234,238,0.7);margin-bottom:8px;">' + escapeHtml(x.detail || payload.execution_action || '') + '</div>'
                + (couponValue ? '<div style="display:inline-block;padding:4px 12px;background:rgba(134,201,162,0.12);border-radius:999px;color:#86C9A2;font-weight:700;">券 ¥' + (Math.round(couponValue / 100)) + ' · ' + validDays + '天有效</div>' : '')
                + (payload.execution_action ? '<div style="margin-top:6px;color:rgba(242,234,238,0.5);font-size:11px;">动作：' + escapeHtml(payload.execution_action) + '</div>' : '')
                + '</div></div>'
                + '<div style="margin-top:10px;padding:10px;border-radius:8px;font-size:12px;font-weight:600;background:' + matchColor + '15;color:' + matchColor + ';border:1px solid ' + matchColor + '33;">' + matchStatus + '</div>';

            document.getElementById('exec-confirm-modal').classList.remove('hidden');
            document.getElementById('exec-confirm-modal').style.display = 'flex';
            document.getElementById('exec-confirm-btn').setAttribute('onclick',
                mode === 'edit' ? 'executeEditAction()' : 'confirmExecAction()');
        }

        function closeExecConfirm() {
            document.getElementById('exec-confirm-modal').classList.add('hidden');
            document.getElementById('exec-confirm-modal').style.display = '';
            __execConfirmData = null;
        }

        async function confirmExecAction() {
            var d = __execConfirmData;
            if (!d) { showNotification('数据异常', 'error'); return; }
            closeExecConfirm();
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(d.actionKey) + '/execute', {
                    method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify({ reason: '批准执行' })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'execute_failed');
                var execMsg = '动作已执行';
                if (data.execution && data.execution.real_executions && data.execution.real_executions.length) {
                    var details = data.execution.real_executions.map(function(e) { return Object.entries(e).map(function(kv) { return kv[0] + ':' + kv[1]; }).join(' '); }).join('\n');
                    execMsg += '\n已完成：' + details;
                }
                showNotification(execMsg, 'success');
                loadGrowthActionBoard();
            } catch (e) {
                showNotification('执行失败：' + (e?.message || e), 'error');
            }
        }

        async function requestActionFeedback(actionKey) { return; }

        // 复制成品文案到剪贴板
        function copyReadyCopy(btn) {
            var txt = btn.getAttribute('data-copy') || '';
            try {
                navigator.clipboard.writeText(txt);
                var old = btn.textContent; btn.textContent = '✅ 已复制';
                setTimeout(function() { btn.textContent = old; }, 1500);
            } catch (e) { showNotification('复制失败，请手动选择', 'warning'); }
        }

        // 采纳建议（纯人工：只标记执行中，不自动群发；执行后回填结果）
        async function adoptGrowthSuggestion(actionKey) {
            if (!confirm('采纳此方案？\n\n系统只记录「执行中」，不会自动群发。请你按文案在对应平台人工执行，执行完后回到这里「回填活动结果」。')) return;
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(actionKey) + '/feedback', {
                    method: 'POST', headers: growthAuthHeaders(),
                    body: JSON.stringify({ status: 'executing', note: '已采纳，人工执行中' })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'adopt_failed');
                showNotification('已采纳·执行中。执行后请回填活动结果以优化AI建议', 'success');
                loadGrowthActionBoard();
            } catch (e) { showNotification('采纳失败：' + (e?.message || e), 'error'); }
        }

        // 结果回填表单（动态模态）
        function openResultFeedbackForm(actionKey) {
            var actions = JSON.parse(document.getElementById('__growth_actions_cache')?.textContent || '[]');
            var x = actions.find(function(a) { return a.action_key === actionKey; });
            if (!x) { showNotification('动作数据未缓存', 'warning'); return; }
            var payload = x.payload || {};
            var kpi = payload.expected_kpi || {};
            var oc = payload.outcome_summary || {};
            var ac = oc.actual || {};
            var ov = document.createElement('div');
            ov.id = 'result-feedback-overlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
            ov.innerHTML =
                '<div style="background:#121012;border:1px solid rgba(242,234,238,0.1);border-radius:14px;max-width:420px;width:100%;padding:18px;max-height:90vh;overflow:auto;">'
                + '<div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:4px;">📊 回填活动结果</div>'
                + '<div style="font-size:12px;color:rgba(242,234,238,0.55);margin-bottom:6px;">' + escapeHtml(x.title || '') + '</div>'
                + '<div style="font-size:11px;color:#EABBC5;background:rgba(209,143,160,0.1);border-radius:8px;padding:8px 10px;margin-bottom:12px;">预计目标：核销率 ' + (kpi.redemption_rate || 0) + '% · 营收 ¥' + Math.round(Number(kpi.revenue_fen || 0) / 100) + ' · 触达 ' + (kpi.reach || 0) + '人</div>'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">实际触达人数</label>'
                + '<input id="rf-reach" type="number" min="0" value="' + (ac.reach != null ? ac.reach : '') + '" placeholder="如 47" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">实际核销/到店数</label>'
                + '<input id="rf-redemptions" type="number" min="0" value="' + (ac.redemptions != null ? ac.redemptions : '') + '" placeholder="如 6" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">带来营收（元）</label>'
                + '<input id="rf-revenue" type="number" min="0" value="' + (ac.revenue_fen != null ? Math.round(ac.revenue_fen / 100) : '') + '" placeholder="如 2800" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">备注（可选）</label>'
                + '<textarea id="rf-note" rows="2" placeholder="执行情况/复盘" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:14px;box-sizing:border-box;resize:vertical;">' + escapeHtml(payload.feedback_note || '') + '</textarea>'
                + '<div style="display:flex;gap:8px;">'
                + '<button data-click="submitResultFeedback" data-arg="' + actionKey + '" style="flex:1;padding:10px;border:none;border-radius:10px;background:#86C9A2;color:#fff;font-weight:700;cursor:pointer;">提交并打分</button>'
                + '<button data-click="hrmsRemoveById" data-arg="result-feedback-overlay" style="padding:10px 16px;border:none;border-radius:10px;background:rgba(242,234,238,0.08);color:#fff;cursor:pointer;">取消</button>'
                + '</div></div>';
            ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
            document.body.appendChild(ov);
        }

        async function submitResultFeedback(actionKey) {
            var reach = document.getElementById('rf-reach').value;
            var redemptions = document.getElementById('rf-redemptions').value;
            var revenue = document.getElementById('rf-revenue').value;
            var note = document.getElementById('rf-note').value;
            if (reach === '' && redemptions === '' && revenue === '') { showNotification('请至少填写一项实际结果', 'warning'); return; }
            var body = { status: 'measured', note: note };
            if (reach !== '') body.actual_reach = Number(reach);
            if (redemptions !== '') body.actual_redemptions = Number(redemptions);
            if (revenue !== '') body.actual_revenue_fen = Math.round(Number(revenue) * 100);
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(actionKey) + '/feedback', {
                    method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify(body)
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'feedback_failed');
                var s = data.score;
                document.getElementById('result-feedback-overlay')?.remove();
                showNotification(s && s.effectiveness_score != null ? ('已记录·自动评分：' + s.effectiveness + ' ' + s.effectiveness_score + '分（已沉淀经验库）') : '结果已记录', 'success');
                loadGrowthActionBoard();
            } catch (e) { showNotification('回填失败：' + (e?.message || e), 'error'); }
        }

        /** 独立营销草稿执行页：全屏模态 */
        function openActionDetailModal(actionKey) {
            var actions = JSON.parse(document.getElementById('__growth_actions_cache')?.textContent || '[]');
            var x = actions.find(function(a) { return a.action_key === actionKey; });
            if (!x) { showNotification('动作数据未缓存', 'warning'); return; }
            var payload = x.payload || {};
            var key = x.action_key || '';
            var actionType = x.action_type || '';
            var channelLabels = { 'miniprogram': '会员小程序', 'wecom': '企微', 'xiaohongshu': '小红书', 'douyin': '抖音', 'pengyouquan': '朋友圈', 'dianping': '大众点评', 'waimai': '美团', 'sms': '短信', 'subscribe': '订阅消息' };
            var channelColors = { 'wecom': '#86C9A2', 'miniprogram': '#EABBC5', 'xiaohongshu': '#E58B98', 'douyin': '#CFA14A', 'pengyouquan': '#5C9A76', 'dianping': '#D18FA0', 'waimai': '#CFA14A' };
            var channel = payload.channel || '';
            var channelLabel = channelLabels[channel] || channel || '-';
            var channelColor = channelColors[channel] || '#97848E';
            var actionTypeLabel = '';
            if (actionType === 'send_voucher' || actionType === 'campaign_activate') actionTypeLabel = '🎫 发券/激活活动 — 将创建券记录+计划';
            else if (actionType === 'create_content' || actionType === 'promo_task') actionTypeLabel = '📝 创建内容 — 将写入内容日历';
            else if (actionType === 'generate_poster') actionTypeLabel = '🖼️ 生成海报 — 将创建海报任务';
            else if (actionType === 'pllm_task') actionTypeLabel = '🤖 PLLM任务 — AI检测异常后自动生成的营销方案，人工执行后回填结果';
            else actionTypeLabel = '✅ 触达动作';
            document.getElementById('growth-action-detail-modal').classList.remove('hidden');
            document.getElementById('growth-action-detail-modal').style.display = 'flex';
            document.getElementById('growth-action-detail-title').textContent = x.title || '执行草稿';
            var host = document.getElementById('growth-action-detail-body');
            host.innerHTML = '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
                + '<span style="padding:6px 12px;border-radius:8px;background:rgba(134,201,162,0.1);border:1px solid rgba(134,201,162,0.3);color:#86C9A2;font-weight:700;font-size:12px;">' + actionTypeLabel + '</span>'
                + '<span style="padding:4px 10px;border-radius:999px;background:' + channelColor + '22;color:' + channelColor + ';font-size:12px;font-weight:600;">📡 ' + channelLabel + '</span>'
                + '</div>'
                + '<div style="display:flex;flex-direction:column;gap:8px;">'
                + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
                + '<div><span style="color:rgba(242,234,238,0.5);font-size:12px;">门店</span><div style="color:#fff;font-weight:600;margin-top:2px;">' + escapeHtml(growthStoreName(x.store_id) || '-') + '</div></div>'
                + '<div><span style="color:rgba(242,234,238,0.5);font-size:12px;">状态</span><div style="color:' + (x.status === 'executed' ? '#86C9A2' : x.status === 'ignored' ? '#E58B98' : '#CFA14A') + ';font-weight:600;margin-top:2px;">' + (x.status === 'executed' ? '✅ 已执行' : x.status === 'ignored' ? '⛔ 已忽略' : x.status === 'proposed' ? '⚡ 可一键执行' : x.status || '-') + '</div></div>'
                + '<div><span style="color:rgba(242,234,238,0.5);font-size:12px;">渠道</span><div style="color:' + channelColor + ';margin-top:2px;font-weight:600;">' + channelLabel + '</div></div>'
                + '<div><span style="color:rgba(242,234,238,0.5);font-size:12px;">预算</span><div style="color:#fff;margin-top:2px;">' + (payload.budget_fen ? '¥' + Math.round(Number(payload.budget_fen) / 100) : '-') + '</div></div>'
                + '</div>'
                + '<div><span style="color:rgba(242,234,238,0.5);font-size:12px;">目标人群</span><div style="color:#fff;margin-top:2px;">' + (payload.target_audience || payload.audience || '门店活跃客群') + '</div></div>'
                + '<div><span style="color:rgba(242,234,238,0.5);font-size:12px;">执行动作</span><div style="color:' + (x.status === 'executed' ? 'rgba(134,201,162,0.8)' : 'rgba(242,234,238,0.8)') + ';margin-top:2px;font-size:13px;line-height:1.5;">' + (payload.execution_action || x.detail || '-') + '</div></div>'
                + (x.status === 'executed' && payload.real_executions ? '<div style="padding:12px;background:rgba(134,201,162,0.08);border-radius:8px;"><div style="color:#86C9A2;font-weight:700;margin-bottom:6px;">✅ 执行结果</div><div style="color:rgba(242,234,238,0.75);font-size:12px;line-height:1.6;">' + payload.real_executions.map(function(e) { return '• ' + Object.entries(e).map(function(kv) { return kv[0] + ': <span style="color:#fff;">' + kv[1] + '</span>'; }).join(' · '); }).join('<br>') + '</div></div>' : '')
                + '<div style="padding:10px;background:rgba(209,143,160,0.08);border-radius:8px;"><div style="color:rgba(242,234,238,0.5);font-size:12px;margin-bottom:4px;">📊 说明</div><div style="color:rgba(242,234,238,0.7);font-size:12px;line-height:1.5;">基于门店增长数据与营销约束生成。</div></div>'
                + '</div>';
            if (payload.poster_url || payload.output_url) {
                host.innerHTML += '<div style="margin-top:16px;padding:12px;background:rgba(242,234,238,0.04);border-radius:10px;border:1px solid rgba(242,234,238,0.06);"><div style="font-size:12px;color:rgba(242,234,238,0.55);margin-bottom:8px;">来源海报</div><img src="' + escapeHtml(payload.poster_url || payload.output_url) + '" style="max-width:100%;max-height:320px;object-fit:contain;border-radius:8px;border:1px solid rgba(242,234,238,0.08);"></div>';
            } else if (x.status === 'proposed' && (actionType === 'send_voucher' || actionType === 'campaign_activate')) {
                host.innerHTML += '<div style="margin-top:16px;padding:12px;background:rgba(207,161,74,0.06);border:1px dashed rgba(207,161,74,0.3);border-radius:10px;font-size:12px;color:#CFA14A;cursor:pointer;" data-click="hrmsCloseActionOpenPoster" data-arg="' + key + '">🖼️ 尚未绑定海报 — 点击选择海报</div>';
            }
            var detailIsLlm = (payload.source === 'llm_campaign_autopilot') || !!payload.expected_kpi || !!payload.confidence_level;
            var execBtn = document.getElementById('growth-action-detail-execute');
            var editBtn = document.getElementById('growth-action-detail-edit');
            var ignoreBtn = document.getElementById('growth-action-detail-ignore');
            if (detailIsLlm) {
                // 纯人工：采纳(不自动发) / 回填结果；隐藏「修改后执行」
                editBtn.style.display = 'none';
                if (x.status === 'proposed') {
                    execBtn.style.display = ''; execBtn.textContent = '✅ 采纳·我要执行';
                    execBtn.setAttribute('onclick', "closeActionDetailModal();adoptGrowthSuggestion('" + key + "')");
                    ignoreBtn.style.display = '';
                    ignoreBtn.setAttribute('onclick', "closeActionDetailModal();ignoreGrowthAction('" + key + "')");
                } else if (x.status === 'executing' || x.status === 'adopted' || x.status === 'measured') {
                    execBtn.style.display = ''; execBtn.textContent = '📊 回填活动结果';
                    execBtn.setAttribute('onclick', "closeActionDetailModal();openResultFeedbackForm('" + key + "')");
                    ignoreBtn.style.display = 'none';
                } else {
                    execBtn.style.display = 'none'; ignoreBtn.style.display = 'none';
                }
            } else {
                execBtn.style.display = x.status === 'executed' || x.status === 'ignored' ? 'none' : '';
                execBtn.textContent = '✅ 批准执行';
                execBtn.setAttribute('onclick', "closeActionDetailModal();executeGrowthAction('" + key + "')");
                editBtn.style.display = x.status === 'executed' || x.status === 'ignored' ? 'none' : '';
                editBtn.setAttribute('onclick', "closeActionDetailModal();openEditExecuteForm('" + key + "')");
                ignoreBtn.style.display = x.status === 'executed' || x.status === 'ignored' ? 'none' : '';
                ignoreBtn.setAttribute('onclick', "closeActionDetailModal();ignoreGrowthAction('" + key + "')");
            }
        }
        function closeActionDetailModal() {
            document.getElementById('growth-action-detail-modal').classList.add('hidden');
            document.getElementById('growth-action-detail-modal').style.display = '';
        }

        var __editingActionKey = null;
        function openEditExecuteForm(actionKey) {
            __editingActionKey = actionKey;
            var actions = JSON.parse(document.getElementById('__growth_actions_cache')?.textContent || '[]');
            var x = actions.find(function(a) { return a.action_key === actionKey; });
            if (!x) { showNotification('动作数据未缓存', 'warning'); return; }
            var payload = x.payload || {};
            document.getElementById('edit-exec-modal').classList.remove('hidden');
            document.getElementById('edit-exec-modal').style.display = 'flex';
            document.getElementById('edit-exec-store').textContent = x.store_id || '-';
            document.getElementById('edit-exec-title').textContent = x.title || '-';
            var channelEl = document.getElementById('edit-exec-channel');
            if (channelEl) channelEl.value = payload.channel || 'miniprogram';
            var audienceEl = document.getElementById('edit-exec-audience');
            if (audienceEl) audienceEl.value = payload.target_audience || payload.audience || 'all';
            var budgetEl = document.getElementById('edit-exec-budget');
            if (budgetEl) budgetEl.value = payload.budget_fen ? String(Math.round(Number(payload.budget_fen) / 100)) : '';
            var reasonEl = document.getElementById('edit-exec-reason');
            if (reasonEl) reasonEl.value = '已调整后执行';
        }
        function closeEditExecuteForm() {
            document.getElementById('edit-exec-modal').classList.add('hidden');
            document.getElementById('edit-exec-modal').style.display = '';
            __editingActionKey = null;
        }
        var __editExecPayload = null;
        var __editExecReason = '';
        function submitEditExecuteForm() {
            var actionKey = __editingActionKey;
            if (!actionKey) { showNotification('数据异常', 'error'); return; }
            var channel = document.getElementById('edit-exec-channel')?.value || 'miniprogram';
            var audience = document.getElementById('edit-exec-audience')?.value || 'all';
            var budgetYuan = document.getElementById('edit-exec-budget')?.value || '';
            var reason = document.getElementById('edit-exec-reason')?.value || '已调整后执行';
            __editExecPayload = { channel: channel, target_audience: audience };
            if (budgetYuan) __editExecPayload.budget_fen = Math.round(Number(budgetYuan) * 100);
            __editExecReason = reason;
            closeEditExecuteForm();
            showExecConfirm(actionKey, 'edit');
        }
        async function executeEditAction() {
            var d = __execConfirmData;
            if (!d) { showNotification('数据异常', 'error'); return; }
            closeExecConfirm();
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(d.actionKey) + '/edit-and-execute', {
                    method: 'POST', headers: growthAuthHeaders(),
                    body: JSON.stringify({ payload: __editExecPayload || {}, reason: __editExecReason || '已调整后执行' })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'edit_execute_failed');
                showNotification('动作已修改并执行', 'success');
                __editExecPayload = null;
                __editExecReason = '';
                loadGrowthActionBoard();
            } catch (e) {
                showNotification('修改执行失败：' + (e?.message || e), 'error');
            }
        }

        // 执行记录中英文词条 → 中文映射
        var GROWTH_CN_TOKENS = {
            // 动作类型
            'send_voucher': '发券', 'send_coupon': '发券', 'send_message': '发消息',
            'send_sms': '发短信', 'send_wecom': '发企微', 'send_subscribe': '发订阅消息',
            'generate_poster': '生成海报', 'create_campaign': '创建活动', 'create_plan': '创建活动方案',
            'content_calendar': '内容排期', 'push_subscribe': '订阅推送', 'churn_alert': '流失预警',
            'repurchase': '复购触发', 'recall': '召回',
            // 操作人
            'rule_engine': '规则引擎', 'agent_v2': 'AI助手', 'system': '系统', 'auto': '自动',
            'admin': '管理员',
            // 内部动作类型
            'marked_executed': '已标记执行', 'wecom_message': '企微消息', 'sms_message': '短信',
            'subscribe_message': '订阅消息', 'member_coupon': '小程序站内推券', 'poster': '海报', 'campaign_plan': '活动方案',
            'coupon': '优惠券', 'content': '内容',
            // 状态/结果
            'sent': '已发送', 'delivered': '已送达', 'read': '已读', 'clicked': '已点击',
            'redeemed': '已核销', 'failed': '发送失败', 'skipped': '已跳过', 'active': '生效中',
            'pending': '待处理', 'none': '无',
            // 渠道
            'wecom': '企业微信', 'sms': '短信', 'subscribe': '订阅消息', 'member': '小程序会员', 'phone': '电话',
            // 常见错误片段
            'sms_skipped_no_coupon_value': '无券面额已跳过', 'subscribe_push_not_configured': '订阅推送未配置',
            'no_coupon_value': '无券面额'
        };
        function growthCnToken(s) {
            if (s === null || s === undefined || s === '') return '-';
            var str = String(s);
            if (GROWTH_CN_TOKENS[str]) return GROWTH_CN_TOKENS[str];
            // 逐词替换（处理 a=b,c 这类组合串）
            return str.replace(/[a-zA-Z_]+/g, function(m) { return GROWTH_CN_TOKENS[m] || m; });
        }
        function growthCnChannels(s) {
            if (!s) return '';
            return String(s).split(',').map(function(c){ return GROWTH_CN_TOKENS[c.trim()] || c.trim(); }).join('、');
        }
        function growthCnStore(s) {
            var map = {
                'majixian': '马己仙广东小馆', 'hongchao': '洪潮潮汕传统菜',
                '51866138': '马己仙广东小馆', '64822111': '洪潮潮汕传统菜'
            };
            if (!s) return '-';
            return map[String(s)] || String(s);
        }
        function growthCnActionKey(k, ruleName) {
            if (!k) return '-';
            // rule:xxx:123:period → 规则「中文名」· 客户#123（中文名优先取后端 rule_name）
            var str = String(k);
            var m = str.match(/^rule:([^:]+):(\d+):?(.*)$/);
            if (m) {
                var label = ruleName || growthCnToken(m[1]);
                return '规则「' + label + '」· 客户#' + m[2];
            }
            return str.length > 48 ? str.slice(0, 48) + '…' : str;
        }
        function growthCnReason(reason, actionKey, ruleName) {
            if (!reason) return '';
            var str = String(reason);
            // 把 "...:lost_lowfreq_lastcall" 里的规则代码替换成中文规则名
            if (actionKey) {
                var m = String(actionKey).match(/^rule:([^:]+):/);
                if (m) {
                    var label = ruleName || growthCnToken(m[1]);
                    str = str.split(m[1]).join('「' + label + '」');
                }
            }
            return growthCnToken(str);
        }
        function growthCnResultSummary(s) {
            if (!s) return '-';
            var str = String(s).replace(/^真实执行[:：]\s*/, '');
            if (!str || str === 'none' || str === '无') return '无（未产生内部动作）';
            // 形如 "campaign_plan=exec_plan_x,active; coupon=exec_coupon_y; sms_message=...,sent"
            return str.split(';').map(function(part) {
                part = part.trim();
                if (!part) return '';
                var eq = part.indexOf('=');
                if (eq < 0) return growthCnToken(part);
                var key = part.slice(0, eq).trim();
                var val = part.slice(eq + 1).trim();
                // 值里通常是 内部ID,状态；只翻译状态词，ID保留
                var vparts = val.split(',').map(function(v){ return growthCnToken(v.trim()); });
                return growthCnToken(key) + '：' + vparts.join('，');
            }).filter(Boolean).join('；');
        }

        async function loadExecutionLogs() {
            try {
                var host = document.getElementById('growth-exec-logs-list');
                if (!host) return;
                host.innerHTML = '<div style="color:rgba(242,234,238,0.3);padding:10px 0;">加载中...</div>';
                var decision = document.getElementById('exec-log-decision-filter')?.value || '';
                var url = '/api/growth/execution-logs?limit=100';
                if (decision) url += '&decision=' + encodeURIComponent(decision);
                const r = await fetch(url, { headers: growthAuthHeaders() });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'api_error');
                const logs = data?.logs || [];
                // 引擎处理结果（仅代表「引擎是否处理了该动作」，不代表是否触达客人）
                var decisionLabels = { 'executed': '引擎已处理', 'ignored': '已忽略', 'edited_then_executed': '修改后处理', 'feedback': '已回填' };
                // 真实触达状态（核心语义：只有「打通的渠道把消息送到客人」才算已触达）
                var reachMeta = {
                    'reached':       { label: '✅ 已触达客户', color: '#86C9A2' },
                    'failed':        { label: '❌ 发送失败（未触达）', color: '#E58B98' },
                    'skipped':       { label: '⏭️ 已跳过（未触达）', color: '#CFA14A' },
                    'internal_only': { label: '⚪ 仅内部执行（未触达客户）', color: '#97848E' },
                    'ignored':       { label: '⛔ 已忽略', color: '#E58B98' },
                    'na':            { label: '—', color: '#97848E' }
                };
                host.innerHTML = logs.length ? logs.map(function(l) {
                    var dLabel = decisionLabels[l.decision] || l.decision || '-';
                    var reach = reachMeta[l.reach] || reachMeta['na'];
                    var channels = growthCnChannels(l.delivery_channels);
                    var reachDetail = '';
                    if (l.reach === 'reached') reachDetail = (channels ? '渠道：' + channels + ' · ' : '') + '已送达 ' + (l.delivery_delivered || 0) + ' 条';
                    else if (l.reach === 'failed') reachDetail = (channels ? '渠道：' + channels + ' · ' : '') + '失败 ' + (l.delivery_failed || 0) + ' 条' + (l.delivery_last_error ? '（' + growthCnToken(l.delivery_last_error) + '）' : '');
                    else if (l.reach === 'skipped') reachDetail = (channels ? '渠道：' + channels + ' · ' : '') + '跳过 ' + (l.delivery_skipped || 0) + ' 条' + (l.delivery_last_error ? '（' + growthCnToken(l.delivery_last_error) + '）' : '');
                    else if (l.reach === 'internal_only') reachDetail = '仅生成了券/活动/海报等内部动作，未通过任何渠道发送给客人';
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:12px;">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">'
                        + '<span style="color:#fff;font-weight:600;word-break:break-all;">' + escapeHtml(growthCnActionKey(l.action_key, l.rule_name)) + '</span>'
                        + '<span style="color:' + reach.color + ';font-size:11px;white-space:nowrap;font-weight:600;">' + reach.label + '</span>'
                        + '</div>'
                        + (reachDetail ? '<div style="color:' + reach.color + ';opacity:0.85;margin-top:3px;font-size:11px;">' + escapeHtml(reachDetail) + '</div>' : '')
                        + '<div style="color:rgba(242,234,238,0.5);margin-top:4px;">门店：' + growthCnStore(l.store_id) + ' · 类型：' + growthCnToken(l.action_type) + ' · 操作人：' + growthCnToken(l.operator_username) + ' · 引擎处理：' + dLabel + ' · ' + (l.created_at ? String(l.created_at).slice(0, 16).replace('T',' ') : '') + '</div>'
                        + (l.decision_reason ? '<div style="color:rgba(242,234,238,0.6);margin-top:2px;">原因：' + escapeHtml(growthCnReason(l.decision_reason, l.action_key, l.rule_name)) + '</div>' : '')
                        + (l.result_summary ? '<div style="color:rgba(242,234,238,0.6);margin-top:2px;">内部动作：' + escapeHtml(growthCnResultSummary(l.result_summary)) + '</div>' : '')
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无执行记录</div>';
            } catch (e) {
                document.getElementById('growth-exec-logs-list').innerHTML = '<div style="color:#E58B98;">加载执行记录失败：' + escapeHtml(e.message) + '</div>';
            }
        }

        var __posterPickerActionKey = null;
        async function openPosterPicker(actionKey) {
            __posterPickerActionKey = actionKey;
            document.getElementById('poster-picker-modal').classList.remove('hidden');
            document.getElementById('poster-picker-modal').style.display = 'flex';
            var host = document.getElementById('poster-picker-list');
            host.innerHTML = '<div style="color:rgba(242,234,238,0.3);grid-column:1/-1;padding:20px;">加载海报列表...</div>';
            try {
                const r = await fetch('/api/growth/content-library?limit=50', { headers: growthAuthHeaders() });
                const data = await r.json();
                var posters = data?.items || data?.posters || [];
                host.innerHTML = posters.length ? posters.map(function(p) {
                    var imgUrl = p.image_url || p.output_url || p.thumbnail_url || '';
                    var title = p.name || p.title || p.prompt || '未命名';
                    return '<div data-click="bindPosterToAction" data-arg="' + p.id + '" data-arg-type="number" style="cursor:pointer;border:1px solid rgba(242,234,238,0.08);border-radius:10px;overflow:hidden;background:rgba(242,234,238,0.02);transition:border-color 0.2s;" onmouseover="this.style.borderColor=\'#86C9A2\'" onmouseout="this.style.borderColor=\'rgba(242,234,238,0.08)\'">'
                        + (imgUrl ? '<img src="' + escapeHtml(imgUrl) + '" style="width:100%;height:120px;object-fit:cover;border-bottom:1px solid rgba(242,234,238,0.06);">' : '<div style="width:100%;height:120px;background:rgba(242,234,238,0.04);display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(242,234,238,0.3);">无预览</div>')
                        + '<div style="padding:6px 8px;font-size:11px;color:rgba(242,234,238,0.7);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">' + escapeHtml(title) + '</div>'
                        + '</div>';
                }).join('') : '<div style="color:rgba(242,234,238,0.4);grid-column:1/-1;padding:20px;text-align:center;">暂无已生成海报，<span style="color:#EABBC5;cursor:pointer;" data-click="hrmsClosePosterShowGrowth">去生成</span></div>';
            } catch (e) {
                host.innerHTML = '<div style="color:#E58B98;grid-column:1/-1;padding:20px;">加载失败：' + escapeHtml(e.message) + '</div>';
            }
        }
        function closePosterPicker() {
            document.getElementById('poster-picker-modal').classList.add('hidden');
            document.getElementById('poster-picker-modal').style.display = '';
            __posterPickerActionKey = null;
        }
        async function bindPosterToAction(posterId) {
            var actionKey = __posterPickerActionKey;
            if (!actionKey) { showNotification('数据异常', 'error'); return; }
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(actionKey) + '/edit-and-execute', {
                    method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify({ payload: { recommended_poster_id: posterId }, reason: '绑定海报后执行' })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'bind_failed');
                showNotification('海报已绑定并执行', 'success');
                closePosterPicker();
                loadGrowthActionBoard();
            } catch (e) {
                showNotification('绑定海报失败：' + (e?.message || e), 'error');
            }
        }

        async function ignoreGrowthAction(actionKey) {
            const reason = prompt('请输入忽略原因', '当前不适合执行');
            if (reason === null) return;
            try {
                const r = await fetch('/api/growth/actions/' + encodeURIComponent(actionKey) + '/ignore', {
                    method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify({ reason: reason || '' })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'ignore_failed');
                showNotification('动作已忽略', 'success');
                loadGrowthActionBoard();
            } catch (e) {
                showNotification('忽略失败：' + (e?.message || e), 'error');
            }
        }

        async function feedbackGrowthAction(actionKey) { return; }

        async function approvePllmExp(experimentCode) {
            if (!confirm('采纳此PLLM策略实验方案？\n\n将通过审批并进入推送池：自动生成门店活动计划草稿并派发给责任人，由门店人工按方案执行。')) return;
            try {
                const r = await fetch('/api/growth/pllm-experiment/' + encodeURIComponent(experimentCode) + '/approve', {
                    method: 'POST', headers: growthAuthHeaders()
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'approve_failed');
                showNotification('已通过，进入推送池', 'success');
                loadGrowthActionBoard();
            } catch (e) { showNotification('采纳失败：' + (e?.message || e), 'error'); }
        }

        async function rejectPllmExp(experimentCode) {
            const reason = typeof hrmsAskMarketingRejectReason === 'function' ? await hrmsAskMarketingRejectReason() : null;
            if (!reason) return;
            try {
                const r = await fetch('/api/growth/pllm-experiment/' + encodeURIComponent(experimentCode) + '/reject', {
                    method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify({ reason })
                });
                const data = await r.json();
                if (!data.ok) throw new Error(data.error || 'reject_failed');
                showNotification('已拒绝，原因已回流给 AI', 'info');
                loadGrowthActionBoard();
            } catch (e) { showNotification('操作失败：' + (e?.message || e), 'error'); }
        }

        // ── 营销活动审核（执行中心 → 活动审核：待审 / 推送池 / 门店回填 / 门店画像） ──
        async function loadGrowthMarketingReview() {
            var role = String(currentUser?.role || '');
            var isAdmin = role === 'admin' || role === 'hq_manager';
            var pw = document.getElementById('mkt-review-pending-wrap');
            if (pw) pw.style.display = isAdmin ? '' : 'none';
            if (isAdmin) mktReviewLoadPending();
            mktReviewLoadPool();
            mktReviewLoadStoreExec();
            mktReviewLoadProfiles();
        }

        async function mktReviewLoadPending() {
            var host = document.getElementById('mkt-review-pending');
            if (!host) return;
            host.innerHTML = '<div class="rep-pay-empty">加载中…</div>';
            try {
                // 统一审核队列：策略实验（每日任务/异常派工/PLLM）+ growth_actions(proposed) 聚合
                var r = await fetch('/api/marketing/review-queue', { headers: growthAuthHeaders() });
                var d = await r.json();
                var items = Array.isArray(d?.items) ? d.items : [];
                if (!items.length) { host.innerHTML = '<div class="rep-pay-empty">暂无待审核营销建议（每天 09:30 生成，规则引擎/AI建议也会进这个队列）</div>'; return; }
                host.innerHTML = items.map(function (it) {
                    if (it.kind === 'growth_action') {
                        var storeName = (window.__GROWTH_STORE_MAP && __GROWTH_STORE_MAP[it.store]) || it.store || '';
                        var gaOpts = wsMarketingAssigneeOptions(storeName);
                        return '<div style="border:1px solid rgba(134,201,162,0.16);border-radius:12px;padding:12px;margin-bottom:12px;background:rgba(0,0,0,0.18);">'
                            + '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><div style="font-weight:800;color:#fff;font-size:14px;">' + escHtml((storeName || '') + ' — ' + (it.title || '')) + '</div>'
                            + '<span style="font-size:11px;color:#86C9A2;">' + escHtml(it.sourceLabel || 'AI建议') + (it.channelLabel ? ' · ' + escHtml(it.channelLabel) : '') + '</span></div>'
                            + '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55;color:rgba(242,234,238,0.82);background:rgba(0,0,0,.2);border-radius:8px;padding:8px;margin:6px 0;max-height:200px;overflow:auto;">' + escHtml(it.detail || '') + '</pre>'
                            + (gaOpts.empty
                                ? '<div style="font-size:12px;color:#EDA1AC;margin-bottom:8px;">本店未配置店长/前厅主管，无法派发</div>'
                                : '<div style="font-size:12px;margin:8px 0;">责任人：<select data-mkt-ga-assignee="' + escHtml(it.actionKey || '') + '" style="min-width:180px;padding:7px 10px;border-radius:8px;border:1px solid rgba(242,234,238,0.15);background:rgba(0,0,0,0.35);color:var(--rep-text);">' + gaOpts.html + '</select></div>')
                            + '<div style="display:flex;gap:8px;margin-top:8px;"><button data-click="mktReviewApproveAction" data-arg="' + escHtml(it.actionKey || '') + '" data-arg-self style="padding:8px 14px;border:none;border-radius:9px;background:#0d7a5f;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">通过·派发执行</button>'
                            + '<button data-click="mktReviewIgnoreAction" data-arg="' + escHtml(it.actionKey || '') + '" style="padding:8px 14px;border:1px solid rgba(229,139,152,0.5);border-radius:9px;background:transparent;color:#EDA1AC;cursor:pointer;font-size:13px;">不适合·忽略</button></div>'
                            + '</div>';
                    }
                    var fb = it.payload && it.payload.feedback ? ('近30天本店审核：采纳 ' + it.payload.feedback.approved + ' / 拒绝 ' + it.payload.feedback.rejected +
                        (it.payload.feedback.topReasons && it.payload.feedback.topReasons.length ? ' · ' + it.payload.feedback.topReasons.map(function (t) { return t.label + (t.count > 1 ? '×' + t.count : ''); }).join('、') : '')) : '';
                    var vs = (it.payload && it.payload.variants || []).map(function (v) {
                        var opts = wsMarketingAssigneeOptions(v.store);
                        return '<div style="border:1px solid rgba(209,143,160,0.18);border-radius:10px;padding:10px;margin:8px 0;background:rgba(209,143,160,0.04);">'
                            + '<div style="font-weight:700;color:#fff;">方案' + escHtml(v.variantCode || 'A') + (v.label ? ' — ' + escHtml(v.label) : '') + '（' + escHtml(v.store || '') + '）</div>'
                            + '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55;color:rgba(242,234,238,0.82);background:rgba(0,0,0,.2);border-radius:8px;padding:8px;margin:6px 0;max-height:220px;overflow:auto;">' + escHtml(v.action || '') + '</pre>'
                            + (v.executionGuide ? '<div style="font-size:11px;opacity:.72;">' + escHtml(v.executionGuide) + '</div>' : '')
                            + (opts.empty
                                ? '<div style="font-size:12px;color:#EDA1AC;">本店未配置店长/前厅主管，无法分配</div>'
                                : '<div style="font-size:12px;margin-top:6px;">责任人：<select data-mkt-assignee="' + escHtml(v.variantCode || 'A') + '" style="min-width:180px;padding:7px 10px;border-radius:8px;border:1px solid rgba(242,234,238,0.15);background:rgba(0,0,0,0.35);color:var(--rep-text);">' + opts.html + '</select></div>')
                            + '</div>';
                    }).join('');
                    return '<div style="border:1px solid rgba(242,234,238,0.1);border-radius:12px;padding:12px;margin-bottom:12px;background:rgba(0,0,0,0.18);">'
                        + '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><div style="font-weight:800;color:#fff;font-size:14px;">' + escHtml((it.store || '') + ' — ' + (it.title || '')) + '</div><span style="font-size:11px;color:#EABBC5;">' + escHtml(it.sourceLabel || '') + (it.anomalyLabel ? ' · ' + escHtml(it.anomalyLabel) : '') + '</span></div>'
                        + (fb ? '<div style="font-size:11px;opacity:.65;margin:4px 0;">' + escHtml(fb) + '</div>' : '')
                        + vs
                        + '<div style="display:flex;gap:8px;margin-top:8px;"><button data-click="mktReviewApprove" data-arg="' + escHtml(it.actionKey || '') + '" data-arg-self style="padding:8px 14px;border:none;border-radius:9px;background:#0d7a5f;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">通过·进入推送池</button>'
                        + '<button data-click="mktReviewReject" data-arg="' + escHtml(it.actionKey || '') + '" data-arg-self style="padding:8px 14px;border:1px solid rgba(229,139,152,0.5);border-radius:9px;background:transparent;color:#EDA1AC;cursor:pointer;font-size:13px;">不适合</button></div>'
                        + '</div>';
                }).join('');
            } catch (e) { host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">加载失败：' + escHtml(e?.message || e) + '</div>'; }
        }

        async function mktReviewApprove(code, btn) {
            if (!code) return;
            var card = btn && btn.closest ? btn.closest('div[style*="border"]') : null;
            var selects = card ? card.querySelectorAll('[data-mkt-assignee]') : [];
            var storeAssignments = Array.prototype.map.call(selects, function (s) {
                return { variantCode: s.getAttribute('data-mkt-assignee'), assigneeUsername: s.value };
            }).filter(function (a) { return a.assigneeUsername; });
            if (selects.length && !storeAssignments.length) { showNotification('请至少为一个方案选择责任人', 'warning'); return; }
            if (!confirm('通过该营销建议？\n\n将进入推送池（自动生成活动计划草稿）并派发给所选责任人，由门店人工按方案执行。')) return;
            try {
                var r = await fetch('/api/strategy-experiments/' + encodeURIComponent(code) + '/approve', {
                    method: 'POST', headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ storeAssignments })
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'approve_failed');
                showNotification('已通过，进入推送池', 'success');
                loadGrowthMarketingReview();
            } catch (e) { showNotification('操作失败：' + (e?.message || e), 'error'); }
        }

        async function mktReviewReject(code, btn) {
            if (!code) return;
            var reason = typeof hrmsAskMarketingRejectReason === 'function' ? await hrmsAskMarketingRejectReason() : null;
            if (!reason) return;
            try {
                var r = await fetch('/api/strategy-experiments/' + encodeURIComponent(code) + '/reject', {
                    method: 'POST', headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ reason })
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'reject_failed');
                showNotification('已拒绝，原因已回流给 AI', 'info');
                loadGrowthMarketingReview();
            } catch (e) { showNotification('操作失败：' + (e?.message || e), 'error'); }
        }

        async function mktReviewApproveAction(actionKey, btn) {
            if (!actionKey) return;
            var card = btn && btn.closest ? btn.closest('div[style*="border"]') : null;
            var sel = card ? card.querySelector('[data-mkt-ga-assignee]') : null;
            if (!sel) { showNotification('请先选择责任人', 'warning'); return; }
            if (!confirm('通过该 AI 营销建议？\n\n将派发给所选责任人并生成任务，由门店人工按方案执行并回填结果。')) return;
            try {
                var r = await fetch('/api/growth/actions/' + encodeURIComponent(actionKey) + '/assign-and-execute', {
                    method: 'POST', headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ assigneeUsername: sel.value })
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'assign_failed');
                showNotification('已派发执行，任务进入责任人待办', 'success');
                loadGrowthMarketingReview();
            } catch (e) { showNotification('派发失败：' + (e?.message || e), 'error'); }
        }

        async function mktReviewIgnoreAction(actionKey) {
            if (!actionKey) return;
            var reason = typeof hrmsAskMarketingRejectReason === 'function' ? await hrmsAskMarketingRejectReason() : null;
            if (!reason) return;
            var reasonText = reason.primary + (reason.note ? '：' + reason.note : '');
            try {
                var r = await fetch('/api/growth/actions/' + encodeURIComponent(actionKey) + '/ignore', {
                    method: 'POST', headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ reason: reasonText })
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'ignore_failed');
                showNotification('已忽略，原因已记录', 'info');
                loadGrowthMarketingReview();
            } catch (e) { showNotification('操作失败：' + (e?.message || e), 'error'); }
        }

        async function mktReviewLoadPool() {
            var host = document.getElementById('mkt-review-pool');
            if (!host) return;
            host.innerHTML = '<div class="rep-pay-empty">加载中…</div>';
            try {
                var r = await fetch('/api/growth/campaign-plans', { headers: growthAuthHeaders() });
                var d = await r.json();
                var rows = (d?.plans || []).filter(function (p) { return p.status === 'draft' || p.status === 'active'; }).slice(0, 30);
                if (!rows.length) { host.innerHTML = '<div class="rep-pay-empty">推送池暂无活动草稿（采纳建议后自动生成，也可在「活动管理」新建）</div>'; return; }
                host.innerHTML = rows.map(function (p) {
                    var cid = p.campaign_id || p.plan_id || '';
                    return '<div style="border:1px solid rgba(242,234,238,0.08);border-radius:10px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">'
                        + '<div style="flex:1;min-width:0;"><strong style="color:#fff;">' + escHtml(p.title || '未命名活动') + '</strong>'
                        + '<div style="font-size:11px;color:rgba(242,234,238,0.6);margin-top:3px;">' + escHtml(growthStoreName(p.store_id)) + ' · ' + escHtml(growthChannelLabel(p.channel) || p.channel || '') + ' · 预算 ¥' + Math.round(Number(p.budget_fen || 0) / 100) + ' · ' + String(p.planned_start || '').slice(0, 10) + ' ~ ' + String(p.planned_end || '').slice(0, 10) + '</div></div>'
                        + (p.status === 'draft'
                            ? '<div style="display:flex;gap:6px;"><button data-click="activateCampaignPlan" data-arg="' + escHtml(cid) + '" style="padding:6px 12px;border:none;border-radius:8px;background:rgba(134,201,162,0.18);color:#86C9A2;cursor:pointer;font-size:12px;font-weight:700;">激活</button>'
                              + '<button data-click="cancelCampaignPlan" data-arg="' + escHtml(cid) + '" style="padding:6px 12px;border:1px solid rgba(229,139,152,0.3);border-radius:8px;background:transparent;color:#EDA1AC;cursor:pointer;font-size:12px;">取消</button></div>'
                            : '<span style="color:#86C9A2;font-size:12px;">✅ 进行中</span>')
                        + '</div>';
                }).join('');
            } catch (e) { host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">加载失败：' + escHtml(e?.message || e) + '</div>'; }
        }

        async function mktReviewLoadStoreExec() {
            var host = document.getElementById('mkt-review-store-exec');
            if (!host) return;
            host.innerHTML = '<div class="rep-pay-empty">加载中…</div>';
            try {
                var isAdmin = ['admin', 'hq_manager'].includes(String(currentUser?.role || ''));
                var url = isAdmin ? '/api/strategy-experiments?status=running&limit=100' : '/api/strategy-experiments/pending-for-store';
                var r = await fetch(url, { headers: growthAuthHeaders() });
                var d = await r.json();
                var variants = [];
                if (isAdmin) {
                    (d?.experiments || []).forEach(function (e) {
                        (e.variants || []).forEach(function (v) {
                            if (v.status === 'pending' || v.status === 'executing') variants.push({ experimentCode: e.experiment_code, variantCode: v.variant_code, store: v.store || '', title: e.title || '', status: v.status, action: v.action || '' });
                        });
                    });
                } else {
                    variants = (d?.variants || []).map(function (v) {
                        return { experimentCode: v.experiment_code, variantCode: v.variant_code, store: v.store || '', title: v.title || '', status: v.status, action: v.action || '' };
                    });
                }
                if (!variants.length) { host.innerHTML = '<div class="rep-pay-empty">暂无待执行/执行中的营销活动（管理员采纳后出现在这里；到期后系统还会按 POS 数据自动评估）</div>'; return; }
                host.innerHTML = variants.map(function (v) {
                    return '<div style="border:1px solid rgba(242,234,238,0.08);border-radius:10px;padding:10px;margin-bottom:8px;">'
                        + '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><strong style="color:#fff;">' + escHtml((v.store || '') + ' — ' + v.title) + '</strong><span style="font-size:11px;color:' + (v.status === 'executing' ? '#CFA14A' : '#EABBC5') + ';">' + (v.status === 'executing' ? '⏳ 执行中·待回填' : '待执行') + '</span></div>'
                        + '<details><summary style="font-size:12px;color:rgba(242,234,238,0.55);cursor:pointer;margin-top:4px;">查看方案全文</summary><pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.55;color:rgba(242,234,238,0.8);background:rgba(0,0,0,.2);border-radius:8px;padding:8px;margin:6px 0;max-height:240px;overflow:auto;">' + escHtml(v.action || '') + '</pre></details>'
                        + '<button data-click="mktReviewOpenResultForm" data-arg="' + escHtml(v.experimentCode) + '" data-arg2="' + escHtml(v.variantCode) + '" data-arg3="' + escHtml(v.title) + '" style="margin-top:8px;padding:7px 14px;border:none;border-radius:8px;background:rgba(207,161,74,0.18);color:#CFA14A;cursor:pointer;font-size:12px;font-weight:700;">📊 回填执行结果</button>'
                        + '</div>';
                }).join('');
            } catch (e) { host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">加载失败：' + escHtml(e?.message || e) + '</div>'; }
        }

        function mktReviewOpenResultForm(code, variantCode, title) {
            if (!code || !variantCode) return;
            var ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
            ov.innerHTML =
                '<div style="background:#121012;border:1px solid rgba(242,234,238,0.1);border-radius:14px;max-width:440px;width:100%;padding:18px;max-height:92vh;overflow:auto;">'
                + '<div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:4px;">📊 回填活动执行结果</div>'
                + '<div style="font-size:12px;color:rgba(242,234,238,0.55);margin-bottom:12px;">' + escHtml(title || code) + ' · 方案' + escHtml(variantCode) + '</div>'
                + '<div style="font-size:11px;color:rgba(242,234,238,0.5);margin-bottom:8px;">执行期日均营收与执行前日均营收（系统会在到期后按 POS 自动比对，这里用于补充执行保真度/成本/主观反馈）</div>'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">执行前日均营收（元）*</label><input id="mkt-rf-before-rev" type="number" min="0" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">执行期日均营收（元）*</label><input id="mkt-rf-during-rev" type="number" min="0" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">执行前日均客流（可选）</label><input id="mkt-rf-before-traffic" type="number" min="0" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">执行期日均客流（可选）</label><input id="mkt-rf-during-traffic" type="number" min="0" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">额外投入成本（元，可选）</label><input id="mkt-rf-cost" type="number" min="0" placeholder="如 1200" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;">'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">执行完整度</label><select id="mkt-rf-fidelity" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;"><option value="full">完整执行</option><option value="partial" selected>部分执行</option><option value="failed">未执行</option></select>'
                + '<label style="font-size:12px;color:rgba(242,234,238,0.7);display:block;margin-bottom:4px;">备注（可选）</label><textarea id="mkt-rf-note" rows="2" placeholder="实际执行情况/复盘" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:14px;box-sizing:border-box;resize:vertical;"></textarea>'
                + '<div style="display:flex;gap:8px;"><button data-click="mktReviewSubmitResult" data-arg="' + escHtml(code) + '" data-arg2="' + escHtml(variantCode) + '" style="flex:1;padding:10px;border:none;border-radius:10px;background:#86C9A2;color:#fff;font-weight:700;cursor:pointer;">提交回填</button>'
                + '<button data-click="hrmsRemoveById" data-arg="mkt-review-result-overlay" style="padding:10px 16px;border:none;border-radius:10px;background:rgba(242,234,238,0.08);color:#fff;cursor:pointer;">取消</button></div>'
                + '</div>';
            ov.id = 'mkt-review-result-overlay';
            ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
            document.body.appendChild(ov);
        }

        async function mktReviewSubmitResult(code, variantCode) {
            var beforeRev = Number(document.getElementById('mkt-rf-before-rev')?.value);
            var duringRev = Number(document.getElementById('mkt-rf-during-rev')?.value);
            if (!(beforeRev > 0) || !(duringRev > 0)) { showNotification('请填写执行前/执行期日均营收', 'warning'); return; }
            var body = {
                before_daily_revenue: beforeRev,
                during_daily_revenue: duringRev,
                before_daily_traffic: Number(document.getElementById('mkt-rf-before-traffic')?.value || 0),
                during_daily_traffic: Number(document.getElementById('mkt-rf-during-traffic')?.value || 0),
                extra_cost: document.getElementById('mkt-rf-cost')?.value ? Number(document.getElementById('mkt-rf-cost').value) : null,
                execution_fidelity: document.getElementById('mkt-rf-fidelity')?.value || 'partial',
                feedback: document.getElementById('mkt-rf-note')?.value || ''
            };
            try {
                var r = await fetch('/api/strategy-experiments/' + encodeURIComponent(code) + '/variants/' + encodeURIComponent(variantCode) + '/result', {
                    method: 'POST', headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify(body)
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'submit_failed');
                document.getElementById('mkt-review-result-overlay')?.remove();
                showNotification('已回填，将参与自动评分', 'success');
                mktReviewLoadStoreExec();
            } catch (e) { showNotification('回填失败：' + (e?.message || e), 'error'); }
        }

        async function mktReviewLoadProfiles() {
            var host = document.getElementById('mkt-review-profiles');
            if (!host) return;
            try {
                var r = await fetch('/api/growth/store-profiles', { headers: growthAuthHeaders() });
                var d = await r.json();
                var rows = d?.profiles || [];
                var listHtml = rows.length ? rows.map(function (p) {
                    return '<div style="border:1px solid rgba(242,234,238,0.08);border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px;color:rgba(242,234,238,0.78);">'
                        + '<strong style="color:#fff;">' + escHtml(p.store_id) + (p.brand ? ' · ' + escHtml(p.brand) : '') + '</strong>'
                        + ' · 客单价 ¥' + Math.round(Number(p.avg_ticket_fen || 0) / 100) + ' · ' + escHtml(p.primary_audience || '')
                        + '<div style="margin-top:3px;font-size:11px;color:rgba(242,234,238,0.55);">适合券：' + escHtml((p.suitable_offers || []).join('、') || '-') + ' ｜ 禁用活动：' + escHtml((p.unsuitable_offers || []).join('、') || '-') + ' ｜ 高峰：' + escHtml((p.peak_hours || []).join('、') || '-') + '</div></div>';
                }).join('') : '<div class="rep-pay-empty">暂无门店画像（填了之后 AI 会按客单价/适合券/禁用活动生成方案）</div>';
                var storeOptions = Object.keys(window.__GROWTH_STORE_MAP || {}).map(function (k) { return '<option value="' + escHtml(k) + '">' + escHtml(__GROWTH_STORE_MAP[k]) + '</option>'; }).join('');
                host.innerHTML = listHtml
                    + '<div style="border:1px solid rgba(242,234,238,0.1);border-radius:12px;padding:12px;margin-top:12px;background:rgba(0,0,0,0.16);">'
                    + '<div style="font-weight:800;color:#fff;margin-bottom:8px;">新增/更新门店画像</div>'
                    + '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">'
                    + '<button data-click="mktReviewApplyProfileTemplate" data-arg="majixian" style="padding:6px 12px;border:1px solid rgba(134,201,162,0.35);border-radius:8px;background:rgba(134,201,162,0.12);color:#86C9A2;cursor:pointer;font-size:12px;">马己仙模板</button>'
                    + '<button data-click="mktReviewApplyProfileTemplate" data-arg="hongchao" style="padding:6px 12px;border:1px solid rgba(209,143,160,0.35);border-radius:8px;background:rgba(209,143,160,0.12);color:#EABBC5;cursor:pointer;font-size:12px;">洪潮模板</button></div>'
                    + '<select id="mkt-profile-store" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.15);background:rgba(0,0,0,0.35);color:var(--rep-text);font-size:13px;margin-bottom:8px;">' + storeOptions + '</select>'
                    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"><input id="mkt-profile-brand" placeholder="品牌（如 马己仙）" style="flex:1;min-width:120px;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;box-sizing:border-box;">'
                    + '<input id="mkt-profile-ticket" type="number" min="0" placeholder="客单价（元）" style="flex:1;min-width:110px;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;box-sizing:border-box;"></div>'
                    + '<input id="mkt-profile-audience" placeholder="主力客群（如 音乐广场周边家庭/年轻客群）" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:8px;box-sizing:border-box;">'
                    + '<input id="mkt-profile-peak" placeholder="高峰时段（逗号分隔，如 午市,晚市）" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:8px;box-sizing:border-box;">'
                    + '<input id="mkt-profile-suitable" placeholder="适合券类型（逗号分隔，如 双人套餐,储值赠券）" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:8px;box-sizing:border-box;">'
                    + '<input id="mkt-profile-unsuitable" placeholder="禁用活动类型（逗号分隔，如 大额折扣,赠品）" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:8px;box-sizing:border-box;">'
                    + '<textarea id="mkt-profile-notes" rows="2" placeholder="备注（选填）" style="width:100%;padding:9px;border-radius:8px;border:1px solid rgba(242,234,238,0.12);background:rgba(242,234,238,0.06);color:#fff;font-size:13px;margin-bottom:10px;box-sizing:border-box;resize:vertical;"></textarea>'
                    + '<button data-click="mktReviewSaveProfile" style="width:100%;padding:10px;border:none;border-radius:10px;background:#0d7a5f;color:#fff;font-weight:700;cursor:pointer;">保存画像</button>'
                    + '</div>';
            } catch (e) { host.innerHTML = '<div class="rep-pay-empty" style="color:#E58B98;">加载失败：' + escHtml(e?.message || e) + '</div>'; }
        }

        function mktReviewApplyProfileTemplate(kind) {
            var T = {
                majixian: { brand: '马己仙', ticket: 120, audience: '音乐广场周边家庭/年轻客群', peak: '午市,晚市', suitable: '双人套餐,储值赠券', unsuitable: '大额折扣' },
                hongchao: { brand: '洪潮', ticket: 160, audience: '大宁商圈家庭/聚会客群', peak: '午市,晚市', suitable: '多人套餐,会员日', unsuitable: '赠品' }
            };
            var t = T[kind] || T.majixian;
            setVal('mkt-profile-brand', t.brand);
            setVal('mkt-profile-ticket', t.ticket);
            setVal('mkt-profile-audience', t.audience);
            setVal('mkt-profile-peak', t.peak);
            setVal('mkt-profile-suitable', t.suitable);
            setVal('mkt-profile-unsuitable', t.unsuitable);
            if (kind === 'majixian') setVal('mkt-profile-store', '51866138');
            if (kind === 'hongchao') setVal('mkt-profile-store', '64822111');
        }

        async function mktReviewSaveProfile() {
            var storeId = document.getElementById('mkt-profile-store')?.value || '';
            if (!storeId) { showNotification('请选择门店', 'warning'); return; }
            var ticketYuan = Number(document.getElementById('mkt-profile-ticket')?.value || 0);
            var body = {
                store_id: storeId,
                brand: document.getElementById('mkt-profile-brand')?.value || '',
                avg_ticket_fen: Math.round(ticketYuan * 100),
                primary_audience: document.getElementById('mkt-profile-audience')?.value || '',
                peak_hours: growthCsvList('mkt-profile-peak'),
                suitable_offers: growthCsvList('mkt-profile-suitable'),
                unsuitable_offers: growthCsvList('mkt-profile-unsuitable'),
                notes: document.getElementById('mkt-profile-notes')?.value || ''
            };
            try {
                var r = await fetch('/api/growth/store-profiles', {
                    method: 'POST', headers: Object.assign({}, growthAuthHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify(body)
                });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                showNotification('门店画像已保存，将作为后续方案生成约束', 'success');
                mktReviewLoadProfiles();
            } catch (e) { showNotification('保存失败：' + (e?.message || e), 'error'); }
        }

        // ── 自动营销治理 + 闭环统计 ──
        // 人群字典（与 HRMS 客户标签/分级口径统一，后端 growth_customer_profiles 自动派生）：
        //  生命周期 6 段 + 价值分层 3 级，每项含「中文名 + 判定口径」，全站唯一来源。
        var AM_LIFECYCLE = {
            prospect: { name: '潜在新客', tip: '扫码/被触达但从未下单' },
            new:      { name: '新客',     tip: '累计下单 1 次 且 近 14 天到店' },
            active:   { name: '活跃客',   tip: '累计下单 ≥2 次 且 近 14 天到店' },
            at_risk:  { name: '临界客',   tip: '14–30 天未到店（流失预警）' },
            dormant:  { name: '沉睡老客', tip: '30–90 天未到店 且 累计 ≥2 单' },
            churned:  { name: '流失低频客', tip: '30–90 天未到店 且 仅 1 单' },
            lost_90:  { name: '流失客(3-6月)', tip: '90–180 天未到店（导入老客，试召回）' },
            lost_180: { name: '流失客(6-12月)', tip: '180–365 天未到店（导入老客，试召回）' },
            lost_365: { name: '流失客(1年+)', tip: '365 天以上未到店（导入老客，试召回）' }
        };
        // 价值分层（与 growth_customer_profiles.value_tier 一致：VIP=折前人均消费金额 avg_check 门店内排名前15%）
        var AM_VALUE_TIER = {
            vip:     { name: 'VIP客',   tip: '折前人均消费金额排名前 15%（与自动营销统一）' },
            regular: { name: '普通客',  tip: '折前人均消费 15–50 分位' },
            low:     { name: '低价值客', tip: '折前人均消费后 50% 或 未消费' }
        };
        // 可用投放渠道（与引擎 deliverViaChannel 分支一致）。企微为旧规则保留项。
        var AM_CHANNELS = {
            sms:       { name: '短信',         cost: '0.05 元/条', note: '需手机号；阿里云已报备模板' },
            subscribe: { name: '订阅消息',     cost: '免费',       note: '需 openid+订阅授权（微信硬约束，实际覆盖≤上限）' },
            member:    { name: '小程序站内券', cost: '免费',       note: '需 openid；发券进会员卡包' },
            wecom:     { name: '企微（旧）',   cost: '免费',       note: '企微优先，无企微回落短信' },
            balance:   { name: '储值余额提醒', cost: '0.05 元/条', note: 'HRMS 直发余额短信，无券无码（独立触发器）' }
        };
        function amLifecycleName(k){ return (AM_LIFECYCLE[k] && AM_LIFECYCLE[k].name) || k; }
        function amTierName(k){ return (AM_VALUE_TIER[k] && AM_VALUE_TIER[k].name) || k; }

        function amDescribeCriteria(c) {
            c = c || {};
            var parts = [];
            if (c.lifecycle_stage) parts.push('阶段:' + amLifecycleName(c.lifecycle_stage));
            if (c.value_tier) parts.push('价值:' + amTierName(c.value_tier));
            if (c.value_tier_not) parts.push('排除:' + amTierName(c.value_tier_not));
            if (c.min_days_since_last_visit != null || c.max_days_since_last_visit != null) {
                parts.push('未到店 ' + (c.min_days_since_last_visit != null ? c.min_days_since_last_visit : '?') + '~' + (c.max_days_since_last_visit != null ? c.max_days_since_last_visit : '∞') + ' 天');
            }
            if (c.min_visit_count != null) parts.push('到店≥' + c.min_visit_count + '次');
            return parts.length ? parts.join(' · ') : '全部人群';
        }

        // 规则的人群「判定口径」一行说明（取生命周期/价值的口径，便于一眼看懂选了谁）
        function amCriteriaTip(c) {
            c = c || {};
            var tips = [];
            if (c.lifecycle_stage && AM_LIFECYCLE[c.lifecycle_stage]) tips.push(AM_LIFECYCLE[c.lifecycle_stage].name + '：' + AM_LIFECYCLE[c.lifecycle_stage].tip);
            if (c.value_tier && AM_VALUE_TIER[c.value_tier]) tips.push(AM_VALUE_TIER[c.value_tier].name + '：' + AM_VALUE_TIER[c.value_tier].tip);
            if (c.value_tier_not && AM_VALUE_TIER[c.value_tier_not]) tips.push('排除' + AM_VALUE_TIER[c.value_tier_not].name);
            return tips.join('；');
        }

        function amDescribeAction(rule) {
            var p = rule.action_payload || {};
            var ch = p.channel || 'wecom';
            var bits = [ (AM_CHANNELS[ch] && AM_CHANNELS[ch].name) || ch ];
            if (p.coupon_value || p.value) bits.push('券额 ¥' + (p.coupon_value || p.value));
            if (p.template_text || p.content) bits.push('「' + String(p.template_text || p.content).slice(0, 28) + '」');
            return bits.join(' · ');
        }

        // 阿里云已报备短信模板「权威库」：code→真实报备正文+变量+门店。
        // 文案以此为唯一真相：选定模板后文案只读展示真实内容，content_template 同步落库，
        // 保证「自动营销文案 = 客人实际收到的短信」一致，便于统一管理。
        // store: 51866138=马己仙音乐广场店, 64822111=洪潮大宁久光店。
        var AM_SMS_TEMPLATES = [
            { code: '', label: '自动（按门店默认模板）', vars: [], content: '' },
            { code: 'SMS_507105250', store: '51866138', vars: ['value','date','code'], label: '长期流失召回180-365天 · 马己仙（value/date/code）', content: '马己仙音乐广场店菜单全面升级，特别赠送${value}元回归礼券2张，${date}前有效，券码${code}，单次使用1张，拒收请回复R' },
            { code: 'SMS_507890076', store: '64822111', vars: ['value','date','code'], label: '长期流失召回180-365天 · 洪潮（value/date/code）', content: '洪潮.大宁久光店店菜单全面升级，特别赠送${value}元回归礼券2张，${date}前有效，券码${code}，单次使用1张，拒收请回复R' },
            { code: 'SMS_507580074', store: '51866138', vars: ['value','date','code'], label: '新客二次召回21-60天 · 马己仙（value/date/code）', content: '马己仙广东小馆(大宁音乐广场店)想您啦!送您${value}元无门槛现金抵用券,${date}前到店报券码${code}核销,拒收请回复R' },
            { code: 'SMS_507865078', store: '64822111', vars: ['value','date','code'], label: '新客二次召回21-60天 · 洪潮（value/date/code）', content: '洪潮传统潮汕菜(大宁久光店)想您啦!送您${value}元无门槛现金抵用券,${date}前到店报券码${code}核销,拒收请回复R' },
            { code: 'SMS_507220292', store: '51866138', vars: ['value','date','code'], label: '沉睡老客召回60-90天 · 马己仙（value/date/code）', content: '好久没来马己仙音乐广场店吃饭了，为您准备一张${value}元无门槛回归礼券，${date}前来门店报券码${code}可抵扣，拒收请回复R' },
            { code: 'SMS_507240296', store: '64822111', vars: ['value','date','code'], label: '沉睡老客召回60-90天 · 洪潮（value/date/code）', content: '好久没来洪潮大宁久光店吃饭了，为您准备一张${value}元无门槛回归礼券，${date}前来门店报券码${code}可直接抵扣拒收请回复R' },
            { code: 'SMS_507165317', store: '51866138', vars: ['value','date','code'], label: '沉睡老客召回90-180天 · 马己仙（value/date/code）', content: '好久没来马己仙音乐广场店吃饭了，为您准备一张${value}元无门槛回归礼券，${date}前来门店报券码${code}可抵扣，拒收请回复R' },
            { code: 'SMS_507390330', store: '64822111', vars: ['value','date','code'], label: '沉睡老客召回90-180天 · 洪潮（value/date/code）', content: '好久没来洪潮大宁久光店吃饭了，为您准备一张${value}元无门槛回归礼券，${date}前来门店报券码${code}可直接抵扣拒收请回复R' },
            { code: 'SMS_507100271', store: '51866138', vars: ['date','code'], label: '活跃客户维护 · 马己仙（date/code）', content: '马己仙音乐广场店：招牌荔枝木烧鹅每日现烤现卖+推荐蚝仔捞饭，在${date}前到店赠送养生炖汤一份，凭券码${code}领取，拒收请回复R' },
            { code: 'SMS_507400282', store: '64822111', vars: ['date','code'], label: '活跃客户维护 · 洪潮（date/code）', content: '洪潮大宁久光店新升级：荔枝木烧鹅，每日现烤限量供应，${date}前到店赠送养生炖汤一份，凭券码${code}领取，拒收请回复R' },
            { code: 'SMS_507260262', store: '51866138', vars: ['balance'], label: '储值客户维护 · 马己仙（balance）', content: '您在马己仙音乐广场店的会员账户尚有${balance}元，本周推荐：荔枝木烧鹅+啫啫沙姜走地鸡+蚝仔捞饭，可提前预定！拒收请回复R' },
            { code: 'SMS_507290291', store: '64822111', vars: ['balance'], label: '储值客户维护 · 洪潮（balance）', content: '您在洪潮大宁久光店的会员账户尚有${balance}元，本周推荐：荔枝木烧鹅+招牌潮州虾生，可提前订位！拒收请回复R' },
            { code: 'SMS_507280284', store: '51866138', vars: ['date','code'], label: '新客第8天维护 · 马己仙（date/code）', content: '感谢您对马己仙音乐广场店的支持，二次到店客人最爱：荔枝木烧鹅、蚝仔捞饭，${date}前到店报券码${code}赠送糖水一份！拒收请回复R' },
            { code: 'SMS_507055275', store: '64822111', vars: ['date','code'], label: '新客第8天维护 · 洪潮（date/code）', content: '感谢您对洪潮大宁久光店支持，二次到店客人最爱：荔枝木烧鹅、潮州虾生，${date}前到店报券码${code}赠送招牌冻奶茶1份，拒收请回复R' },
            { code: 'SMS_507390274', store: '51866138', vars: ['date','code'], label: '新客第4天维护 · 马己仙（date/code）', content: '感谢光临马己仙音乐广场店，本店招牌荔枝木烧鹅，${date}前再次到店赠送招牌冻柠茶一份，报券码${code}使用，一桌限1份！拒收请回复R' },
            { code: 'SMS_507075274', store: '64822111', vars: ['date','code'], label: '新客第4天维护 · 洪潮（date/code）', content: '感谢光临洪潮大宁久光店，潮州虾生是本店招牌，${date}前再次到店赠送潮州奶冻一份，报券码${code}使用，一桌限1份！拒收请回复R' },
            { code: 'SMS_507760075', store: '51866138', vars: ['date','code'], label: 'VIP客人维护 · 马己仙（date/code）', content: '感谢您一直以来对马己仙大宁音乐广场店的支持，为您预留一份招牌手打虾饼免费品鉴，请于${date}前到店报券码${code}使用,拒收请回复R' },
            { code: 'SMS_507580073', store: '64822111', vars: ['date','code'], label: 'VIP客人维护 · 洪潮（date/code）', content: '感谢您对洪潮大宁久光店的支持，洪潮2.0菜单升级，为您预留一份潮汕蚝仔烙免费品鉴，请于${date}前到店报券码${code}拒收请回复R' },
            { code: 'SMS_508075082', store: '51866138', vars: ['value','date','code'], label: '马己仙晚市/周末复购客（value/date/code）', content: '马己仙音乐广场店为您准备一张${value}元无门槛晚市专享礼券17点后可用，${date}前来门店报券码${code}可抵扣，拒收请回复R' },
            { code: 'SMS_508135078', store: '64822111', vars: ['date','code'], label: '洪潮平日午市客唤醒（date/code）', content: '洪潮大宁久光店新升级：荔枝木烧鹅，每日现烤限量供应，${date}前到店赠送养生炖汤一份，凭券码${code}，仅限平日午市使用拒收请回复R' }
        ];
        // 待报备短信文案库（变量严格 name/days/value 三个，提交阿里云审核后回填 code 即可下发）
        var AM_SMS_DRAFTS = [
            { name: '沉睡老客召回',   text: '尊敬的${name}，您已${days}天未光临，备好${value}元优惠券期待您回归，到店即可使用。' },
            { name: '临界客温和提醒', text: '${name}您好，距上次到店已${days}天，送您${value}元优惠券，近期来尝尝新品吧。' },
            { name: '流失低频客召回', text: '${name}您好，好久不见已${days}天，特送${value}元券一张，欢迎回店体验。' },
            { name: 'VIP专属回馈',    text: '尊贵的${name}，感谢长期支持，专属${value}元贵宾券已送达，${days}天内到店尽享。' },
            { name: '新客复购激励',   text: '${name}您好，首次光临已${days}天，送您${value}元复购券，期待再次为您服务。' }
        ];
        // 返回已报备模板真实正文（用于文案只读展示 + content_template 落库）；未知/自动返回 ''
        function amSmsTemplateContent(code){
            var t = AM_SMS_TEMPLATES.find(function(x){ return x.code === (code || ''); });
            return (t && t.content) ? t.content : '';
        }

        // ── 活动制（campaign）单一真相表 ──
        // 自动营销规则 = 一个活动；选活动即自动绑定「门店双模板对」并把规则标题同步为活动名，
        // 避免从 14 条短信模板里逐条挑选导致选错/无策略。key 与后端 CAMPAIGN_TYPES 对齐。
        // tpl: 门店ID→已报备短信模板 code（51866138=马己仙，64822111=洪潮）；空表示短信后补未配。
        var AM_CAMPAIGNS = {
            vip_gift:       { name: 'VIP客户维护',          vars: ['date','code'],         tpl: { '51866138': 'SMS_507760075', '64822111': 'SMS_507580073' } },
            active:         { name: '活跃客经营',           vars: ['date','code'],         tpl: { '51866138': 'SMS_507100271', '64822111': 'SMS_507400282' } },
            newcomer_4d:    { name: '新客回头·4天',         vars: ['date','code'],         tpl: { '51866138': 'SMS_507390274', '64822111': 'SMS_507075274' } },
            newcomer_8d:    { name: '新客回头·8天',         vars: ['date','code'],         tpl: { '51866138': 'SMS_507280284', '64822111': 'SMS_507055275' } },
            newcomer_recall:{ name: '新客二次召回·21-60天',  vars: ['value','date','code'], tpl: { '51866138': 'SMS_507580074', '64822111': 'SMS_507865078' } },
            regular_cooling:{ name: '常客降温唤醒·21-60天',  vars: ['date','code'],         tpl: { '51866138': 'SMS_507100271', '64822111': 'SMS_507400282' } },
            vip_winback:    { name: 'VIP专属召回·61-365天',  vars: ['value','date','code'], tpl: { '51866138': 'SMS_507220292', '64822111': 'SMS_507240296' } },
            dormant_60_90:  { name: '沉睡客户召回·60-90天',  vars: ['value','date','code'], tpl: { '51866138': 'SMS_507220292', '64822111': 'SMS_507240296' } },
            dormant_90_180: { name: '沉睡客户召回·90-180天', vars: ['value','date','code'], tpl: { '51866138': 'SMS_507165317', '64822111': 'SMS_507390330' } },
            lost_long:      { name: '长期流失召回',          vars: ['value','date','code'], tpl: { '51866138': 'SMS_507105250', '64822111': 'SMS_507890076' } },
            lost_over365:   { name: '长期流失超1年召回',     vars: ['value','date','code'], tpl: { '51866138': 'SMS_507105250', '64822111': 'SMS_507890076' } },
            mj_dinner_weekend: { name: '马己仙晚市/周末复购客', vars: ['value','date','code'], tpl: { '51866138': 'SMS_508075082', '64822111': '' } },
            hc_weekday_lunch:  { name: '洪潮平日午市客唤醒',   vars: ['date','code'],         tpl: { '51866138': '', '64822111': 'SMS_508135078' } },
            mj_dinner_weekend_gift: { name: '马己仙晚市赠菜券(A/B免费菜组)', vars: ['date','code'], tpl: { '51866138': 'SMS_507100271', '64822111': '' } },
            prospect_recall: { name: '到店未买单潜客召回', vars: ['value','date','code'], tpl: { '51866138': '', '64822111': '' } }
        };
        // ABC 6模板滚动活动：这些活动的「券面额」按模板步骤固定(赠菜¥0/赠券¥30·¥50·2×¥50)、
        // 「发送频率」由降频阶梯15/30/45/60/75/90自动控制，前端这两项设置不生效→渲染时标灰禁用。
        // 与后端 ABC_ROTATION_ORDER 保持一致。
        var AM_ABC_CAMPAIGNS = ['vip_gift','active','regular_cooling','dormant_90_180','newcomer_recall','dormant_60_90','vip_winback','lost_long','lost_over365','prospect_recall'];
        // 券模板 id（campaign_<key>_<store> / winback_cash_<store>）→ 活动中文名，用于核销明细标注来源。
        // ABC 滚动活动的 key 可能带 _cash/_gift 后缀(标注该次核销走的是券还是赠菜步骤)，
        // AM_CAMPAIGNS 里未收录带后缀的变体，先按原 key 查，查不到再剥掉后缀重试。
        var AM_ABC_STEP_SUFFIX_LABEL = { cash: '·现金券', gift: '·赠菜' };
        function amCampaignLabelFromTemplate(templateId){
            var t = String(templateId || '');
            if (!t) return '';
            if (t.indexOf('winback_') === 0) return '储值客召回·现金券';
            var m = t.match(/^campaign_(.+)_(\d+)$/);
            if (!m) return '';
            var key = m[1];
            var c = AM_CAMPAIGNS[key];
            if (c) return c.name;
            var sm = key.match(/^(.+)_(cash|gift)$/);
            if (sm) {
                var base = AM_CAMPAIGNS[sm[1]];
                if (base) return base.name + (AM_ABC_STEP_SUFFIX_LABEL[sm[2]] || '');
            }
            return '营销发券·' + key;
        }
        // 活动 → 已绑定门店双模板提示（选活动即绑定「马己仙＋洪潮」，无需手挑 14 条模板）
        function amCampaignPairTip(key){
            var c = AM_CAMPAIGNS[key]; if (!c) return '';
            var parts = [];
            if (c.tpl['51866138']) parts.push('马己仙 ' + c.tpl['51866138']);
            if (c.tpl['64822111']) parts.push('洪潮 ' + c.tpl['64822111']);
            return '已绑定门店模板：' + (parts.join(' · ') || '（短信后补）') + '（变量 ' + c.vars.join('/') + '）';
        }
        // 活动 → 双门店已报备短信正文预览（只读展示，发送时引擎按客户门店自动取对应模板）
        function amCampaignContentPreview(key){
            var c = AM_CAMPAIGNS[key]; if (!c) return '';
            return ['51866138','64822111'].filter(function(sid){ return c.tpl[sid]; }).map(function(sid){
                var code = c.tpl[sid];
                var content = code ? amSmsTemplateContent(code) : '';
                return '【' + amStoreName(sid) + '】' + (content || '（短信模板后补，暂不可发）');
            }).join('\n\n');
        }
        // 渲染「人群字典 / 渠道说明 / 待报备文案库」（静态，只需渲染一次）
        function amRenderGlossary(){
            var host = document.getElementById('am-glossary');
            if (!host || host.dataset.rendered === '1') return;
            function row(name, tip){ return '<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid rgba(242,234,238,0.05);font-size:12px;"><span style="color:#fff;min-width:78px;font-weight:600;">' + escapeHtml(name) + '</span><span style="color:rgba(242,234,238,0.65);">' + escapeHtml(tip) + '</span></div>'; }
            var life = Object.keys(AM_LIFECYCLE).map(function(k){ return row(AM_LIFECYCLE[k].name, AM_LIFECYCLE[k].tip); }).join('');
            var tier = Object.keys(AM_VALUE_TIER).map(function(k){ return row(AM_VALUE_TIER[k].name, AM_VALUE_TIER[k].tip); }).join('');
            var chan = ['sms','subscribe','member'].map(function(k){ var c = AM_CHANNELS[k]; return row(c.name, c.note + '（成本 ' + c.cost + '）'); }).join('');
            var drafts = AM_SMS_DRAFTS.map(function(d){
                return '<div style="padding:7px 0;border-bottom:1px solid rgba(242,234,238,0.05);font-size:12px;">'
                    + '<div style="color:#fff;font-weight:600;margin-bottom:2px;">' + escapeHtml(d.name) + ' <span style="color:#CFA14A;font-size:11px;font-weight:400;">（待报备）</span></div>'
                    + '<div style="color:rgba(242,234,238,0.7);">' + escapeHtml(d.text) + '</div>'
                    + '</div>';
            }).join('');
            host.innerHTML =
                '<div style="color:#EABBC5;font-size:12px;font-weight:700;margin-bottom:4px;">🧭 生命周期（6 段）</div>' + life
                + '<div style="color:#EABBC5;font-size:12px;font-weight:700;margin:12px 0 4px;">💎 价值分层（3 级）</div>' + tier
                + '<div style="color:#EABBC5;font-size:12px;font-weight:700;margin:12px 0 4px;">📣 可用投放渠道</div>' + chan
                + '<div style="color:#EABBC5;font-size:12px;font-weight:700;margin:12px 0 4px;">✉️ 待报备短信文案库（变量固定 name/days/value）</div>'
                + '<div style="color:rgba(242,234,238,0.5);font-size:11px;margin-bottom:6px;">将下列文案提交阿里云短信平台报备，审核通过后把得到的 SMS_xxx 模板号发我，我加入「短信模板」下拉即可下发。</div>'
                + drafts;
            host.dataset.rendered = '1';
        }

        // 取规则所属门店ID（优先动作门店，其次人群门店；都没有则为「全部门店」）
        function amRuleStoreId(rule) {
            var p = rule.action_payload || {};
            var c = rule.criteria || {};
            return String(p.store_id || c.store_id || '').trim();
        }
        function amStoreName(storeId) {
            if (!storeId) return '全部门店';
            return (window.__GROWTH_STORE_MAP && __GROWTH_STORE_MAP[storeId]) || ('门店 ' + storeId);
        }

        function amStatsPeriodLabel(days) {
            var d = String(days == null ? '0' : days);
            if (d === '0') return '累计';
            if (d === '1') return '今日';
            return '近' + d + '天';
        }

        async function loadAutoMarketing() {
            if (!canAccessGrowthModule()) { document.getElementById('growth-page').style.display = 'none'; return; }
            var host = document.getElementById('am-rules-list');
            var days = document.getElementById('am-stats-days')?.value || '0';
            if (document.getElementById('am-sub-fields') && !document.querySelector('#am-sub-fields [data-sub-field]')) amRenderSubFields();
            amRenderGlossary();
            host.innerHTML = '<div style="color:rgba(242,234,238,0.4);padding:14px 0;">加载中…</div>';
            try {
                var hdr = growthAuthHeaders();
                var rs = await Promise.all([
                    fetch('/api/growth/touch-rules', { headers: hdr }).then(function(r){return r.json();}),
                    fetch('/api/growth/touch-rules/stats?days=' + encodeURIComponent(days), { headers: hdr }).then(function(r){return r.json();})
                ]);
                var allRules = (rs[0] && rs[0].rules) || [];
                var statRows = (rs[1] && rs[1].stats) || [];
                amRenderRulesList(allRules, statRows, {});
                // 涉及会员（人群覆盖）单独异步获取：全表扫描较慢(冷缓存约5秒)，不阻塞规则列表先行展示。
                // 拿到后只就地更新每条规则的"涉及会员/分渠道覆盖"两处文字（不整列表重渲染，避免
                // 在手机上重建大 DOM 造成卡顿、也避免清掉用户正在编辑的输入框）。
                var storeFilter = document.getElementById('growth-store-filter')?.value || '';
                var audQs = [];
                if (storeFilter) audQs.push('store_id=' + encodeURIComponent(storeFilter));
                fetch('/api/growth/touch-rules/audience' + (audQs.length ? ('?' + audQs.join('&')) : ''), { headers: hdr }).then(function(r){return r.json();}).then(function(d){
                    amApplyAudience((d && d.audience) || {});
                }).catch(function(){});
                // 红名单总览：同样异步获取，不阻塞规则列表先行展示。
                fetch('/api/growth/abc-blacklist-summary', { headers: hdr }).then(function(r){return r.json();}).then(function(d){
                    amApplyBlacklist((d && d.items) || []);
                }).catch(function(){});
            } catch (e) {
                host.innerHTML = '<div style="color:#E58B98;padding:14px 0;">加载自动营销失败：' + escapeHtml(String(e && e.message || e)) + '</div>';
            }
            loadAmRedemptions();
        }

        function amRenderRulesList(allRules, statRows, audienceMap) {
            var host = document.getElementById('am-rules-list');
            var days = document.getElementById('am-stats-days')?.value || '0';
            var periodLabel = amStatsPeriodLabel(days);
            var statMap = {};
            statRows.forEach(function(s){ statMap[s.rule_key] = s; });

            // 按上方「门店范围」筛选：选中某门店时，展示该门店规则 +「全部门店」通用规则
                var storeFilter = document.getElementById('growth-store-filter')?.value || '';
                var rules = storeFilter
                    ? allRules.filter(function(rule){ var sid = amRuleStoreId(rule); return sid === storeFilter || sid === ''; })
                    : allRules;

                // 隐藏「已停用的旧企微规则」：已被活动制短信规则取代，停用后不再展示，避免新旧混淆。
                // 新的短信/余额规则即便停用也保留（便于重新启用）。
                rules = rules.filter(function(rule){
                    var ch = String((rule.action_payload || {}).channel || 'wecom');
                    return !(rule.enabled === false && ch === 'wecom');
                });

                // 按营销效果评分排序（打分排序）：已发送且评分高的排前，未发送的排后，便于复用高效规则
                rules = rules.slice().sort(function(a, b){
                    var sa = statMap[a.rule_key], sb = statMap[b.rule_key];
                    var va = (sa && sa.score != null) ? Number(sa.score) : -1;
                    var vb = (sb && sb.score != null) ? Number(sb.score) : -1;
                    return vb - va;
                });

                // 汇总
                var totalSent = 0, totalRedeemed = 0, approvedCount = 0, autoLiveCount = 0;
                rules.forEach(function(rule){
                    var st = statMap[rule.rule_key] || {};
                    totalSent += Number(st.sent_count || 0);
                    totalRedeemed += Number(st.redeemed_count || 0);
                    if (rule.approved_at) approvedCount++;
                    if (rule.approved_at && rule.enabled && rule.auto_execute !== false) autoLiveCount++;
                });
                var rate = totalSent > 0 ? ((totalRedeemed / totalSent) * 100).toFixed(1) : '0.0';
                var summary = document.getElementById('am-summary');
                function card(k, v){ return '<div class="rep-metric"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
                summary.innerHTML = card(periodLabel + '发送', totalSent)
                    + card(periodLabel + '核销', totalRedeemed)
                    + card('核销率', rate + '%')
                    + card('自动执行中', autoLiveCount + ' / ' + rules.length)
                    + card('🔴 红名单', '<span id="am-redlist-total">计算中</span>');

                if (!rules.length) { host.innerHTML = '<div style="color:rgba(242,234,238,0.4);padding:14px 0;">暂无营销规则</div>'; return; }

                host.innerHTML = rules.map(function(rule){
                    var st = statMap[rule.rule_key] || {};
                    var sent = Number(st.sent_count || 0), red = Number(st.redeemed_count || 0);
                    var reachRaw = (audienceMap && (rule.rule_key in audienceMap)) ? audienceMap[rule.rule_key] : null;
                    // 兼容老接口（数字）与新接口（分渠道对象）
                    var cov = (reachRaw && typeof reachRaw === 'object') ? reachRaw : null;
                    var reach = cov ? cov.total : reachRaw;
                    var __ap0 = rule.action_payload || {};
                    var curChannel = String(__ap0.channel || 'wecom');
                    var curSmsCode = String(__ap0.sms_template_code || '');
                    var curCampaign = String(__ap0.campaign_key || '');
                    // ABC 滚动活动：券面额(按步骤固定)与发送频率(降频阶梯自动控制)在前端不生效 → 标灰禁用
                    var isAbcCampaign = curCampaign && AM_ABC_CAMPAIGNS.indexOf(curCampaign) >= 0;
                    var curFreq = Math.max(0, Math.floor(Number(__ap0.frequency_days) || 0));
                    var curValYuan = Math.max(0, Math.round(Number(__ap0.coupon_value_fen || __ap0.value_fen || 0) / 100));
                    // 活动是否需要券面额：仅「沉睡召回/长期流失」等现金券含 value 变量；VIP/新客/活跃为赠菜券无需面额
                    var campNeedsValue = curCampaign ? !!(AM_CAMPAIGNS[curCampaign] && AM_CAMPAIGNS[curCampaign].vars.indexOf('value') >= 0) : true;
                    // 储值余额提醒：HRMS 后台直发余额短信，无券无码，由独立触发器执行（不走渠道/活动/券）
                    var isBalance = curChannel === 'balance';
                    var curValidDays = Math.max(0, Math.floor(Number(__ap0.valid_days) || 0));
                    var curTpl = String(__ap0.content_template || __ap0.message_template || '');
                    // 短信渠道：活动制规则按 campaign_key 预览双门店模板正文；旧规则回落单一模板正文（与客人实收一致）
                    var __smsTplContent = (curChannel === 'sms')
                        ? (curCampaign ? amCampaignContentPreview(curCampaign) : amSmsTemplateContent(curSmsCode))
                        : '';
                    var __tplReadonly = !!__smsTplContent;
                    var __tplShown = __tplReadonly ? __smsTplContent : curTpl;
                    var rrate = sent > 0 ? ((red / sent) * 100).toFixed(1) : '0.0';
                    // 营销效果：营收 / 成本(短信0.05元·条) / ROI / 评分 / 建议
                    var revYuan = (Number(st.revenue_fen || 0) / 100).toFixed(2);
                    var costYuan = (Number(st.cost_fen || 0) / 100).toFixed(2);
                    var roiTxt = (st.roi == null) ? '—' : (Number(st.roi).toFixed(2) + '×');
                    var scoreVal = (st.score == null) ? null : Number(st.score);
                    var scoreColor = scoreVal == null ? '#97848E' : (scoreVal >= 70 ? '#86C9A2' : (scoreVal >= 40 ? '#CFA14A' : '#E58B98'));
                    var scoreTxt = scoreVal == null ? '未发送' : (scoreVal + ' 分');
                    var suggestionTxt = st.suggestion || '';
                    var approved = !!rule.approved_at;
                    var autoLive = approved && rule.enabled && rule.auto_execute !== false;
                    var statusBadge = autoLive
                        ? '<span style="background:rgba(134,201,162,0.15);color:#86C9A2;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">自动执行中</span>'
                        : (approved
                            ? '<span style="background:rgba(207,161,74,0.15);color:#CFA14A;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">已审核·未启用</span>'
                            : '<span style="background:rgba(151,132,142,0.18);color:#97848E;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">待审核（仅建议）</span>');
                    var lastRun = rule.last_run_at ? new Date(rule.last_run_at).toLocaleString('zh-CN') : '从未运行';
                    var approver = approved ? ('审核人 ' + escapeHtml(rule.approved_by || '?') + ' · ' + new Date(rule.approved_at).toLocaleDateString('zh-CN')) : '尚未审核';
                    var rk = escapeHtml(rule.rule_key);
                    var isSubscribe = ((rule.action_payload || {}).channel === 'subscribe');
                    var storeNm = amStoreName(amRuleStoreId(rule));
                    var storeBadge = '<span style="background:rgba(209,143,160,0.16);color:#EABBC5;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">🏪 ' + escapeHtml(storeNm) + '</span>';
                    var critTip = amCriteriaTip(rule.criteria);
                    // 投放渠道下拉：短信/订阅消息/小程序站内券；旧规则若为企微则保留该选项
                    var channelOpts = ['sms','subscribe','member'].concat(curChannel === 'wecom' ? ['wecom'] : []).map(function(k){
                        return '<option value="' + k + '"' + (curChannel === k ? ' selected' : '') + '>' + AM_CHANNELS[k].name + '</option>';
                    }).join('');
                    // 各渠道覆盖标注（命中人群中可触达人数）
                    var covLine = cov
                        ? ('短信 <strong style="color:#EABBC5;">' + cov.sms + '</strong> 人 · 订阅消息 <strong style="color:#EABBC5;">' + cov.subscribe + '</strong> 人(上限·需授权) · 小程序站内 <strong style="color:#EABBC5;">' + cov.member + '</strong> 人')
                        : '计算中/未知';
                    var campaignOpts = '<option value="">（请选择营销活动）</option>' + Object.keys(AM_CAMPAIGNS).map(function(k){ return '<option value="' + k + '"' + (curCampaign === k ? ' selected' : '') + '>' + escapeHtml(AM_CAMPAIGNS[k].name) + '</option>'; }).join('');
                    var campaignTip = curCampaign ? amCampaignPairTip(curCampaign) : '选定活动即自动绑定「马己仙＋洪潮」双门店已报备模板，规则标题同步为活动名（无需从十几条模板里逐条挑选）。';
                    return '<div class="rep-pay-card amr">'
                        // —— 卡头：标题 + 元信息 + 状态徽章（竖排，整宽自适应）——
                        + '<div class="amr-head">'
                        +   '<div class="amr-title">' + escapeHtml(rule.name || rule.rule_key) + '</div>'
                        +   '<div class="amr-meta">所属门店 ' + escapeHtml(storeNm) + ' · 优先级 ' + (rule.priority || '-') + ' · 经办人 ' + escapeHtml(rule.owner || '未指派') + '</div>'
                        +   '<div class="amr-badges">' + storeBadge + '<span id="am-status-' + rk + '">' + statusBadge + '</span></div>'
                        + '</div>'
                        // —— 人群与动作概览 ——
                        + '<div class="amr-sec">'
                        +   '<div class="amr-sec-title">🎯 人群与动作</div>'
                        +   '<div class="amr-info">目标人群：' + escapeHtml(isBalance ? '有储值余额且久未消费的会员' : amDescribeCriteria(rule.criteria)) + '</div>'
                        +   (isBalance ? '<div class="amr-info amr-info--sub">判定口径：余额≥下限（默认1元）且超过设定天数未消费</div>' : (critTip ? '<div class="amr-info amr-info--sub">判定口径：' + escapeHtml(critTip) + '</div>' : ''))
                        +   '<div class="amr-info">涉及会员：<span id="am-reach-' + rk + '">' + (reach == null ? '<span style="color:rgba(242,234,238,0.4);">计算中/未知</span>' : ('<strong>' + reach + '</strong> 人（命中人群且可触达）')) + '</span></div>'
                        +   (isAbcCampaign ? ('<div class="amr-info">🔴 红名单：<span id="am-redlist-' + rk + '"><span style="color:rgba(242,234,238,0.4);">计算中/未知</span></span></div>') : '')
                        +   '<div class="amr-info amr-info--sub">统计范围：' + escapeHtml(storeFilter ? (amStoreName(storeFilter) + ' · 按上方门店筛选') : (storeNm + ' · 全部门店')) + '；与「近N天发送/核销」统计周期无关</div>'
                        +   '<div class="amr-info amr-info--sub">分渠道覆盖：<span id="am-cov-' + rk + '">' + covLine + '</span></div>'
                        +   '<div class="amr-info">触达动作：' + escapeHtml(amDescribeAction(rule)) + '</div>'
                        + '</div>'
                        // —— 储值余额提醒（HRMS 直发·无券）说明 ——
                        + (isBalance ? (
                            '<div class="amr-sec">'
                          +   '<div class="amr-sec-title">💰 储值余额提醒（HRMS 直发）</div>'
                          +   '<div class="amr-info">由 HRMS 每日自动为各门店冻结余额提醒任务，仅发送「您账户尚有 ¥余额」短信，<strong>无券无码</strong>。</div>'
                          +   '<div class="amr-info amr-info--sub">口径：有储值余额 + 久未消费的会员；受全局短信总闸（每号码每周≤1条）与 remind 频控控制。</div>'
                          +   '<div class="amr-hint">门店余额模板需在服务器配置 ALIYUN_SMS_BALANCE_TEMPLATE_*（未配置则该门店跳过）。审核通过并启用后才会自动执行。</div>'
                          + '</div>') : '')
                        // —— 投放渠道 ——
                        + ((isSubscribe || isBalance) ? '' : (
                            '<div class="amr-sec">'
                          +   '<div class="amr-sec-title">📡 投放渠道</div>'
                          +   '<div class="amr-field">'
                          +     '<select id="am-ch-' + rk + '" class="amr-ctrl" data-change="amOnChannelChange" data-arg="' + rk + '">' + channelOpts + '</select>'
                          +   '</div>'
                          +   '<div id="am-ch-sms-' + rk + '" class="amr-field" style="display:' + (curChannel === 'sms' ? 'block' : 'none') + ';">'
                          +     '<label class="amr-label">营销活动（自动绑定门店双模板＋同步规则标题）</label>'
                          +     '<select id="am-campaign-' + rk + '" class="amr-ctrl" data-change="amOnCampaignChange" data-arg="' + rk + '">' + campaignOpts + '</select>'
                          +     '<div class="amr-hint" id="am-campaign-tip-' + rk + '">' + escapeHtml(campaignTip) + '</div>'
                          +   '</div>'
                          +   '<button type="button" class="amr-btn amr-btn--ghost" data-click="amSetChannel" data-arg="' + rk + '">保存渠道</button>'
                          + '</div>'))
                        // —— 发送频率 ——
                        + (isBalance ? '' : (isAbcCampaign ? (
                            '<div class="amr-sec">'
                          +   '<div class="amr-sec-title">⏱️ 发送频率</div>'
                          +   '<div class="amr-field amr-suffix" style="opacity:0.45;">'
                          +     '<span class="amr-suffix-txt">每位会员每</span>'
                          +     '<input class="amr-ctrl" type="number" value="' + curFreq + '" disabled>'
                          +     '<span class="amr-suffix-txt">天最多1次</span>'
                          +   '</div>'
                          +   '<div class="amr-hint">🔒 ABC 滚动活动的发送频率由系统「降频阶梯 15/30/45/60/75/90 天」自动控制，此处不生效。仍受全局总闸：每号码每周最多 1 条短信。</div>'
                          + '</div>'
                          ) : (
                            '<div class="amr-sec">'
                          +   '<div class="amr-sec-title">⏱️ 发送频率</div>'
                          +   '<div class="amr-field amr-suffix">'
                          +     '<span class="amr-suffix-txt">每位会员每</span>'
                          +     '<input id="am-freq-' + rk + '" class="amr-ctrl" type="number" min="0" value="' + curFreq + '">'
                          +     '<span class="amr-suffix-txt">天最多1次</span>'
                          +   '</div>'
                          +   '<div class="amr-hint">填 0 = 按到店周期自动判定。另有全局总闸：每号码每周最多 1 条短信。</div>'
                          +   '<button type="button" class="amr-btn amr-btn--ghost" data-click="amSetFrequency" data-arg="' + rk + '">保存频率</button>'
                          + '</div>')))
                        // —— 券与文案 ——
                        + ((isSubscribe || isBalance) ? '' : (
                            '<div class="amr-sec">'
                          +   '<div class="amr-sec-title">🎫 券与文案</div>'
                          +   '<div class="amr-coupon-box">'
                          +     '<div class="amr-row2">'
                          +       (isAbcCampaign
                                    ? '<div><label class="amr-label">券面额（元）</label><input class="amr-ctrl" value="🔒 ABC按步骤固定 菜¥0/券¥30·¥50·2×¥50" disabled style="opacity:0.5;"></div>'
                                    : (campNeedsValue
                                        ? '<div><label class="amr-label">券面额（元）</label><input id="am-val-' + rk + '" class="amr-ctrl" type="number" min="0" value="' + curValYuan + '"></div>'
                                        : '<div><label class="amr-label">券类型</label><input class="amr-ctrl" value="赠菜/赠品券（无需面额）" disabled style="opacity:0.6;"></div>'))
                          +       '<div><label class="amr-label">有效期（天）</label><input id="am-vd-' + rk + '" class="amr-ctrl" type="number" min="0" value="' + curValidDays + '"></div>'
                          +     '</div>'
                          +     '<div class="amr-field" style="margin-top:10px;">'
                          +       '<label class="amr-label">短信文案' + (__tplReadonly ? '（🔒 只读·已报备模板）' : '') + '</label>'
                          +       '<textarea id="am-tpl-' + rk + '" class="amr-ctrl"' + (__tplReadonly ? ' readonly style="opacity:0.85;"' : '') + ' placeholder="短信文案，可用占位符：{customer_name} {coupon_value_text}（自动填券面额）{valid_days}（自动填有效天数）{days_since_last_visit} {favorite_dishes_text}">' + escapeHtml(__tplShown) + '</textarea>'
                          +       '<div class="amr-hint">' + (__tplReadonly ? '文案为阿里云已报备模板真实内容（客人实收即此文）。${value}=券面额、${date}=有效期(按上方天数)、${code}=券码，发送时自动填充。' : '金额写文案用 {coupon_value_text}（自动=¥券面额）；到期天数用 {valid_days}，避免写死天数对不上券有效期。') + '</div>'
                          +     '</div>'
                          +     '<button type="button" class="amr-btn amr-btn--ghost" data-click="amSetCoupon" data-arg="' + rk + '">保存券面额/有效期/文案</button>'
                          +   '</div>'
                          + '</div>'))
                        // —— 效果统计 ——
                        + '<div class="amr-sec">'
                        +   '<div class="amr-sec-title" style="margin-bottom:8px;">📊 活动数据（' + periodLabel + '）</div>'
                        +   '<div class="amr-stats">'
                        +     '<div class="amr-stat"><span class="amr-stat-k">发送</span><span class="amr-stat-v">' + sent + '</span></div>'
                        +     '<div class="amr-stat"><span class="amr-stat-k">核销</span><span class="amr-stat-v" style="color:#86C9A2;">' + red + '</span></div>'
                        +     '<div class="amr-stat"><span class="amr-stat-k">核销率</span><span class="amr-stat-v">' + rrate + '%</span></div>'
                        +     '<div class="amr-stat"><span class="amr-stat-k">营收</span><span class="amr-stat-v" style="color:#86C9A2;">¥' + revYuan + '</span></div>'
                        +     '<div class="amr-stat"><span class="amr-stat-k">成本</span><span class="amr-stat-v">¥' + costYuan + '</span></div>'
                        +     '<div class="amr-stat"><span class="amr-stat-k">ROI</span><span class="amr-stat-v" style="color:#EABBC5;">' + roiTxt + '</span></div>'
                        +     '<div class="amr-stat"><span class="amr-stat-k">评分</span><span class="amr-stat-v" style="color:' + scoreColor + ';">' + scoreTxt + '</span></div>'
                        +     '<div class="amr-stat"><span class="amr-stat-k">上次运行</span><span class="amr-stat-v" style="font-size:12px;font-weight:600;color:rgba(242,234,238,0.7);">' + escapeHtml(lastRun) + '</span></div>'
                        +   '</div>'
                        +   (isAbcCampaign
                              ? '<div class="amr-hint" style="margin-top:8px;">🔴 红名单：<span id="am-redlist-' + escapeHtml(curCampaign) + '">统计中…</span></div>'
                              : '')
                        + '</div>'
                        + (suggestionTxt ? '<div class="amr-sec"><div class="amr-suggest">💡 优化建议：' + escapeHtml(suggestionTxt) + '</div></div>' : '')
                        // —— 底部：审核信息 + 操作 ——
                        + '<div class="amr-foot">'
                        +   '<span class="amr-foot-by">' + escapeHtml(approver) + '</span>'
                        +   '<div class="amr-foot-btns">'
                        +     (isSubscribe ? '<button type="button" class="amr-btn amr-btn--ghost" data-click="amEditSubscribeRule" data-arg="' + rk + '">编辑内容</button>' : '')
                        +     '<button type="button" class="amr-btn amr-btn--ghost" data-click="amToggleEnabled" data-arg="' + rk + '" data-arg2="' + (rule.enabled ? 'true' : 'false') + '">' + (rule.enabled ? '停用' : '启用') + '</button>'
                        +     (approved
                              ? '<button type="button" class="amr-btn amr-btn--ghost" data-click="amUnapprove" data-arg="' + rk + '">撤销审核</button>'
                              : '<button type="button" class="amr-btn" data-click="amApprove" data-arg="' + rk + '">审核通过 → 允许自动执行</button>')
                        +   '</div>'
                        + '</div>'
                        + '</div>';
                }).join('');
        }

        // 异步拿到「涉及会员/分渠道覆盖」后就地更新文字，不重渲染整个规则列表（手机上更流畅，
        // 也不会清掉用户正在编辑的输入框）。audienceMap: rule_key → {total,sms,subscribe,member,wecom}
        function amApplyAudience(audienceMap) {
            if (!audienceMap) return;
            Object.keys(audienceMap).forEach(function(ruleKey){
                var rk = (typeof escapeHtml === 'function') ? escapeHtml(ruleKey) : ruleKey;
                var raw = audienceMap[ruleKey];
                var cov = (raw && typeof raw === 'object') ? raw : null;
                var reach = cov ? cov.total : raw;
                var reachEl = document.getElementById('am-reach-' + rk);
                if (reachEl) {
                    reachEl.innerHTML = (reach == null)
                        ? '<span style="color:rgba(242,234,238,0.4);">计算中/未知</span>'
                        : ('<strong>' + reach + '</strong> 人（命中人群且可触达）');
                }
                var covEl = document.getElementById('am-cov-' + rk);
                if (covEl) {
                    covEl.innerHTML = cov
                        ? ('短信 <strong style="color:#EABBC5;">' + cov.sms + '</strong> 人 · 订阅消息 <strong style="color:#EABBC5;">' + cov.subscribe + '</strong> 人(上限·需授权) · 小程序站内 <strong style="color:#EABBC5;">' + cov.member + '</strong> 人')
                        : '计算中/未知';
                }
            });
        }

        // 红名单：ABC滚动活动阶梯走完仍未回应的人数，就地更新每条规则卡片+顶部汇总（不整列表重渲染）。
        function amApplyBlacklist(items) {
            if (!Array.isArray(items)) return;
            var total = 0;
            items.forEach(function(it){
                total += Number(it.blacklisted || 0);
                var rk = (typeof escapeHtml === 'function') ? escapeHtml(it.campaign_key) : it.campaign_key;
                var el = document.getElementById('am-redlist-' + rk);
                if (el) {
                    var n = Number(it.blacklisted || 0);
                    el.innerHTML = '<strong style="color:' + (n > 0 ? '#E58B98' : '#97848E') + ';">' + n + '</strong> 人（阶梯走完仍未回应，本活动不再自动触达）';
                }
            });
            var sumEl = document.getElementById('am-redlist-total');
            if (sumEl) sumEl.textContent = total;
        }

        // 保存「频率/券面额/有效期/文案」后就地把该规则状态徽章改为「待审核」（这类改动会重置审核态），
        // 不整列表重渲染——避免在手机上重建大 DOM 造成数秒卡顿（即"一改就死机"的真正来源）。
        function amMarkRulePendingReview(ruleKey) {
            var rk = (typeof escapeHtml === 'function') ? escapeHtml(ruleKey) : ruleKey;
            var el = document.getElementById('am-status-' + rk);
            if (el) el.innerHTML = '<span style="background:rgba(151,132,142,0.18);color:#97848E;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">待审核（仅建议）</span>';
        }

        async function loadAmRedemptions() {
            var host = document.getElementById('am-redemptions-list');
            if (!host) return;
            var store = document.getElementById('growth-store-filter')?.value || '';
            try {
                var url = '/api/growth/redemptions?limit=100' + (store ? ('&store_id=' + encodeURIComponent(store)) : '');
                var d = await fetch(url, { headers: growthAuthHeaders() }).then(function(r){return r.json();});
                var rows = (d && d.redemptions) || [];
                if (!rows.length) { host.innerHTML = '<div style="color:rgba(242,234,238,0.4);padding:10px 0;">暂无核销记录</div>'; return; }
                host.innerHTML = rows.map(function(x){
                    var amt = Number(x.amount_fen || 0) / 100;
                    var md = x.metadata || {};
                    // 活动中文名：优先 campaigns.name，其次券模板id解析出的活动名，再次 metadata 活动/规则名，最后占位
                    var actName = x.campaign_name || md.campaign_name || amCampaignLabelFromTemplate(md.template_id) || md.coupon_label || md.coupon_name || md.rule_name || md.rule_key || x.campaign_id || md.coupon_source || '—';
                    var storeNm = amStoreName(String(x.store_id || ''));
                    var dateTxt = x.redeemed_at ? new Date(x.redeemed_at).toLocaleString('zh-CN') : '—';
                    return '<div style="padding:10px 0;border-bottom:1px solid rgba(242,234,238,0.06);font-size:12px;">'
                        + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;">'
                        +   '<span style="color:#fff;font-weight:600;">🎟 ' + escapeHtml(String(actName)) + '</span>'
                        +   '<span style="color:#86C9A2;font-weight:700;">核销 ¥' + amt.toFixed(2) + '</span>'
                        + '</div>'
                        + '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;color:rgba(242,234,238,0.6);">'
                        +   '<span>🏪 ' + escapeHtml(storeNm) + '</span>'
                        +   '<span>券号 ' + escapeHtml(String(x.coupon_id || '—')) + '</span>'
                        +   '<span>客户#' + escapeHtml(String(x.customer_id || '—')) + '</span>'
                        +   '<span>🗓 ' + escapeHtml(dateTxt) + '</span>'
                        + '</div>'
                        + '</div>';
                }).join('');
            } catch (e) {
                host.innerHTML = '<div style="color:#E58B98;padding:10px 0;">加载核销记录失败</div>';
            }
        }

        async function amApprove(ruleKey) {
            if (!await hrmsConfirm({ title: '审核通过', message: '确认审核通过「' + ruleKey + '」？审核后引擎将每15分钟自动向命中人群发送，您将作为经办人记录在案。', okText: '确认通过', icon: '✅' })) return;
            try {
                var r = await fetch('/api/growth/touch-rules/' + encodeURIComponent(ruleKey) + '/approve', { method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify({}) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'approve_failed');
                showNotification('已审核通过，规则进入自动执行', 'success');
                loadAutoMarketing();
            } catch (e) { showNotification('审核失败：' + (e && e.message || e), 'error'); }
        }

        async function amUnapprove(ruleKey) {
            if (!await hrmsConfirm({ title: '撤销审核', message: '撤销「' + ruleKey + '」的审核？撤销后该规则不再自动发送，仅生成待发建议。', okText: '确认撤销', icon: '↩️' })) return;
            try {
                var r = await fetch('/api/growth/touch-rules/' + encodeURIComponent(ruleKey) + '/unapprove', { method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify({}) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'unapprove_failed');
                showNotification('已撤销审核', 'success');
                loadAutoMarketing();
            } catch (e) { showNotification('撤销失败：' + (e && e.message || e), 'error'); }
        }

        async function amToggleEnabled(ruleKey, currentEnabled) {
            try {
                // 复用 upsert：仅改 enabled，criteria/action 不变 → 后端 keepApproval 保留审核态。
                var rg = await fetch('/api/growth/touch-rules', { headers: growthAuthHeaders() }).then(function(r){return r.json();});
                var rule = ((rg && rg.rules) || []).find(function(x){ return x.rule_key === ruleKey; });
                if (!rule) throw new Error('rule_not_found');
                var body = {
                    rule_key: rule.rule_key, name: rule.name, priority: rule.priority,
                    auto_execute: rule.auto_execute, criteria: rule.criteria || {},
                    action_type: rule.action_type, action_payload: rule.action_payload || {},
                    owner: rule.owner || '', note: rule.note || '',
                    enabled: !currentEnabled
                };
                var r = await fetch('/api/growth/touch-rules', { method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'toggle_failed');
                showNotification(currentEnabled ? '已停用' : '已启用', 'success');
                loadAutoMarketing();
            } catch (e) { showNotification('操作失败：' + (e && e.message || e), 'error'); }
        }

        // 设置某规则的「发送频率」（每位会员最短重发间隔，天）。改动 action_payload，
        // 按治理规则会重置审核态（频率属重大变更，需重新审核后才继续自动执行）。
        async function amSetFrequency(ruleKey) {
            var inp = document.getElementById('am-freq-' + ruleKey);
            var val = inp ? Math.max(0, Math.floor(Number(inp.value) || 0)) : 0;
            if (!await hrmsConfirm({ title: '设置发送频率', message: '将「' + ruleKey + '」的发送频率设为' + (val > 0 ? ('每位会员每 ' + val + ' 天最多1次') : '按到店周期（默认）') + '？注意：修改频率会重置审核态，需重新「审核通过」后才会继续自动执行。', okText: '确认保存', icon: '⏱️' })) return;
            try {
                var rg = await fetch('/api/growth/touch-rules', { headers: growthAuthHeaders() }).then(function(r){return r.json();});
                var rule = ((rg && rg.rules) || []).find(function(x){ return x.rule_key === ruleKey; });
                if (!rule) throw new Error('rule_not_found');
                var ap = Object.assign({}, rule.action_payload || {}, { frequency_days: val });
                var body = {
                    rule_key: rule.rule_key, name: rule.name, priority: rule.priority,
                    auto_execute: rule.auto_execute, enabled: rule.enabled,
                    criteria: rule.criteria || {}, action_type: rule.action_type,
                    action_payload: ap, owner: rule.owner || '', note: rule.note || ''
                };
                var r = await fetch('/api/growth/touch-rules', { method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                showNotification('发送频率已更新（如该规则原已审核，请重新审核以继续自动执行）', 'success');
                amMarkRulePendingReview(ruleKey); // 就地更新状态，不整列表重渲染（避免手机卡顿）
            } catch (e) { showNotification('保存频率失败：' + (e && e.message || e), 'error'); }
        }

        // 设置某规则的「券面额 / 有效期 / 短信文案」。写入 action_payload：
        //  coupon_value_fen（分，引擎据此换算 {coupon_value_text}=¥面额）、valid_days（券真实有效天数，
        //  也作为 {valid_days} 占位）、content_template（短信正文）。
        //  属重大变更 → 按治理规则会重置审核态，需重新「审核通过」后才继续自动执行。
        async function amSetCoupon(ruleKey) {
            var vInp = document.getElementById('am-val-' + ruleKey);
            var dInp = document.getElementById('am-vd-' + ruleKey);
            var tInp = document.getElementById('am-tpl-' + ruleKey);
            var valYuan = vInp ? Math.max(0, Math.floor(Number(vInp.value) || 0)) : 0;
            var validDays = dInp ? Math.max(0, Math.floor(Number(dInp.value) || 0)) : 0;
            var tpl = tInp ? String(tInp.value || '').trim() : '';
            if (vInp && valYuan <= 0) { showNotification('券面额需大于 0 元', 'error'); return; }
            if (validDays <= 0) { showNotification('有效期需大于 0 天', 'error'); return; }
            if (!await hrmsConfirm({ title: '设置券面额/有效期', message: '将「' + ruleKey + '」设为：券面额 ¥' + valYuan + ' · 有效期 ' + validDays + ' 天？注意：修改会重置审核态，需重新「审核通过」后才会继续自动执行。', okText: '确认保存', icon: '🎟️' })) return;
            try {
                var rg = await fetch('/api/growth/touch-rules', { headers: growthAuthHeaders() }).then(function(r){return r.json();});
                var rule = ((rg && rg.rules) || []).find(function(x){ return x.rule_key === ruleKey; });
                if (!rule) throw new Error('rule_not_found');
                var ap = Object.assign({}, rule.action_payload || {}, { valid_days: validDays });
                // ABC 活动券面额输入已标灰移除(am-val 不存在)→ 不改 coupon_value_fen，保留原值
                if (vInp) ap.coupon_value_fen = valYuan * 100;
                if (tpl) ap.content_template = tpl;
                var body = {
                    rule_key: rule.rule_key, name: rule.name, priority: rule.priority,
                    auto_execute: rule.auto_execute, enabled: rule.enabled,
                    criteria: rule.criteria || {}, action_type: rule.action_type,
                    action_payload: ap, owner: rule.owner || '', note: rule.note || ''
                };
                var r = await fetch('/api/growth/touch-rules', { method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                showNotification('券面额/有效期/文案已更新（如该规则原已审核，请重新审核以继续自动执行）', 'success');
                amMarkRulePendingReview(ruleKey); // 就地更新状态，不整列表重渲染（避免手机卡顿）
            } catch (e) { showNotification('保存失败：' + (e && e.message || e), 'error'); }
        }

        // 切换渠道下拉时，仅在「短信」渠道显示营销活动选择
        function amOnChannelChange(ruleKey) {
            var sel = document.getElementById('am-ch-' + ruleKey);
            var smsBox = document.getElementById('am-ch-sms-' + ruleKey);
            if (sel && smsBox) smsBox.style.display = (sel.value === 'sms') ? 'block' : 'none';
            // 切到短信渠道时，按当前活动把文案刷成只读双门店真实正文；切走则恢复可编辑
            amOnCampaignChange(ruleKey);
        }

        // 选择营销活动时：刷新「已绑定门店双模板」提示，并把文案区刷为双门店真实正文（只读）
        function amOnCampaignChange(ruleKey) {
            var sel = document.getElementById('am-campaign-' + ruleKey);
            var tip = document.getElementById('am-campaign-tip-' + ruleKey);
            var tInp = document.getElementById('am-tpl-' + ruleKey);
            var chSel = document.getElementById('am-ch-' + ruleKey);
            var isSms = chSel && chSel.value === 'sms';
            var key = sel ? sel.value : '';
            if (tip) tip.textContent = key ? amCampaignPairTip(key) : '选定活动即自动绑定双门店已报备模板，规则标题同步为活动名。';
            if (tInp && isSms && key) {
                tInp.value = amCampaignContentPreview(key);
                tInp.readOnly = true;
                tInp.style.opacity = '0.85';
            }
        }

        // 设置某规则的「投放渠道」（+营销活动）。活动制：短信渠道只选「活动」，
        // 系统自动绑定门店双模板（按客户门店发送时解析）并把规则标题同步为活动名。
        // 改动 action_payload → 按治理规则重置审核态。
        async function amSetChannel(ruleKey) {
            var sel = document.getElementById('am-ch-' + ruleKey);
            var channel = sel ? sel.value : '';
            if (!channel) { showNotification('请选择投放渠道', 'error'); return; }
            var cpSel = document.getElementById('am-campaign-' + ruleKey);
            var campaignKey = (channel === 'sms' && cpSel) ? String(cpSel.value || '') : '';
            if (channel === 'sms' && !campaignKey) { showNotification('请选择营销活动', 'error'); return; }
            var chName = (AM_CHANNELS[channel] && AM_CHANNELS[channel].name) || channel;
            var cpName = campaignKey ? ((AM_CAMPAIGNS[campaignKey] && AM_CAMPAIGNS[campaignKey].name) || campaignKey) : '';
            var newName = (channel === 'sms') ? cpName : '';
            var extra = channel === 'sms' ? ('\n营销活动：' + cpName + '\n' + amCampaignPairTip(campaignKey)) : '';
            if (channel === 'sms' && newName) extra += '\n规则标题将同步为：' + newName;
            if (channel === 'member') extra += '\n注意：小程序站内券需在 action_payload 配置 member_template_id（券模板ID），否则会跳过下发。';
            if (channel === 'subscribe') extra += '\n注意：订阅消息仅能发给已「订阅授权」且有剩余次数的用户（微信硬约束）。';
            if (!await hrmsConfirm({ title: '设置投放渠道', message: '将「' + ruleKey + '」投放渠道设为：' + chName + extra.replace(/\n/g, ' ') + ' 注意：修改渠道会重置审核态，需重新「审核通过」后才会继续自动执行。', okText: '确认保存', icon: '📡' })) return;
            try {
                var rg = await fetch('/api/growth/touch-rules', { headers: growthAuthHeaders() }).then(function(r){return r.json();});
                var rule = ((rg && rg.rules) || []).find(function(x){ return x.rule_key === ruleKey; });
                if (!rule) throw new Error('rule_not_found');
                var ap = Object.assign({}, rule.action_payload || {}, { channel: channel });
                if (channel === 'sms') {
                    ap.campaign_key = campaignKey;
                    delete ap.sms_template_code; // 活动制：按客户门店解析模板，不再存单一模板
                    // content_template 仅作面板展示（双门店真实正文）；发送时引擎按门店取已报备模板
                    ap.content_template = amCampaignContentPreview(campaignKey);
                } else { delete ap.sms_template_code; delete ap.campaign_key; }
                var body = {
                    rule_key: rule.rule_key, name: (newName || rule.name), priority: rule.priority,
                    auto_execute: rule.auto_execute, enabled: rule.enabled,
                    criteria: rule.criteria || {}, action_type: rule.action_type,
                    action_payload: ap, owner: rule.owner || '', note: rule.note || ''
                };
                var r = await fetch('/api/growth/touch-rules', { method: 'POST', headers: growthAuthHeaders(), body: JSON.stringify(body) });
                var d = await r.json();
                if (!d.ok) throw new Error(d.error || 'save_failed');
                showNotification('投放渠道已更新（如该规则原已审核，请重新审核以继续自动执行）', 'success');
                loadAutoMarketing();
            } catch (e) { showNotification('保存渠道失败：' + (e && e.message || e), 'error'); }
        }
