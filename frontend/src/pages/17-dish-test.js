/* bundled page: 17-dish-test.js — 菜品测试（仅系统管理员可见） */

// ========== 菜品测试（试菜前客群体检：匹配 + 风险 + 试菜验证清单） ==========
var __cdt = { brand: '', dishes: [], report: null };

var __cdtSeverityLabel = { 高: '高风险', 中: '中风险', 低: '低风险' };

function cdtEnsureContainer() {
  if (document.getElementById('customer-twin-dish-test-page')) return;
  const page = document.createElement('div');
  page.id = 'customer-twin-dish-test-page';
  page.className = 'hidden';
  page.innerHTML =
    '<div style="max-width:820px;margin:0 auto;padding:14px 12px 30px;color:#e8eef2;font-family:inherit">' +
    '<div style="font-size:17px;font-weight:800">菜品测试</div>' +
    '<div style="font-size:12px;color:rgba(232,238,242,.62);margin:3px 0 12px">试菜前的客群体检：客群匹配 + 风险预判 + 试菜验证清单（模拟结果，需试菜会真实验证）</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
    '<select id="cdt-brand" style="padding:9px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#e8eef2;font-size:13px">' +
    '<option value="">选择品牌</option><option value="马己仙">马己仙</option><option value="洪潮">洪潮</option></select>' +
    '<select id="cdt-dish" style="flex:1;min-width:220px;padding:9px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#e8eef2;font-size:13px"><option value="">先选择品牌</option></select>' +
    '<button id="cdt-run" style="padding:9px 14px;border-radius:10px;border:1px solid #0d7a5f;background:#0d7a5f;color:#fff;cursor:pointer;font-size:13px">开始体检</button>' +
    '</div>' +
    '<div id="cdt-attr" class="hidden" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;color:rgba(232,238,242,.8);line-height:1.8"></div>' +
    '<div id="cdt-error" class="hidden" style="background:rgba(185,28,28,.15);border:1px solid rgba(185,28,28,.45);border-radius:12px;padding:12px;margin-bottom:10px;font-size:13px"></div>' +
    '<div id="cdt-result"></div></div>';
  document.body.appendChild(page);
}

async function cdtLoadDishes(brand) {
  const dishSel = document.getElementById('cdt-dish');
  dishSel.innerHTML = '<option value="">加载中…</option>';
  try {
    const data = await ctrApi('/api/customer-twin/dish-test/options?brand=' + encodeURIComponent(brand));
    __cdt.dishes = data.dishes || [];
    dishSel.innerHTML = '<option value="">选择菜品</option>' +
      __cdt.dishes.map((d) => '<option value="' + ctrEsc(d.dish_name) + '">' + ctrEsc(d.dish_name) + '（' + ctrEsc(d.dish_price) + ' 元）</option>').join('');
  } catch (e) {
    dishSel.innerHTML = '<option value="">加载失败</option>';
    cdtShowError(e.message);
  }
}

function cdtShowAttr(dishName) {
  const d = __cdt.dishes.find((x) => x.dish_name === dishName);
  const box = document.getElementById('cdt-attr');
  if (!d) { box.className = 'hidden'; return; }
  box.className = '';
  box.innerHTML = '属性：辣度 ' + ctrEsc(d.spicy_level || '未填') +
    ' · 主食材 ' + ctrEsc(d.main_ingredient || '未填') +
    ' · 做法 ' + ctrEsc(d.cooking_method || '未填') +
    ' · 口味 ' + ctrEsc(d.taste_type || '未填') +
    ' · 招牌 ' + ctrEsc(d.is_signature || '未填') +
    ' · 新品 ' + ctrEsc(d.is_new || '未填') +
    ' · 分量 ' + ctrEsc(d.portion_size || '未填') +
    ' · 场景 ' + ctrEsc(d.suitable_scenes || '未填');
}

function cdtShowError(msg) {
  const box = document.getElementById('cdt-error');
  box.textContent = msg;
  box.className = '';
}

function cdtRenderReport(r) {
  const box = document.getElementById('cdt-result');
  const m = r.match;
  const fitColor = (f) => (f === '适合' ? '#7fd7b8' : f === '一般' ? '#e7c987' : '#f2a0a0');
  const matrix = m.personas.map((p) =>
    '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)">' +
    '<span style="font-size:13px;font-weight:600">' + ctrEsc(p.label) + '</span>' +
    '<span style="font-size:12.5px;color:' + fitColor(p.fit) + '">' + ctrEsc(p.fit) + '（' + p.score + '）</span></div>' +
    (p.reasons.length ? '<div style="font-size:12px;color:rgba(232,238,242,.6);padding:0 0 6px">' + p.reasons.map(ctrEsc).join('；') + '</div>' : '')
  ).join('');
  const risks = (r.risks || []).map((x) =>
    '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)">' +
    '<span style="font-size:12px;padding:2px 7px;border-radius:999px;background:rgba(185,28,28,.2);color:#f2a0a0">' + ctrEsc(__cdtSeverityLabel[x.severity] || x.severity) + '</span> ' +
    '<span style="font-size:13px;font-weight:600">' + ctrEsc(x.risk) + '</span>' +
    '<div style="font-size:12.5px;color:rgba(232,238,242,.8);margin-top:3px">' + ctrEsc(x.hint) + '（' + ctrEsc(x.segment) + '）</div>' +
    (x.evidence && x.evidence.length ? x.evidence.map((e) =>
      '<div style="font-size:12px;color:rgba(232,238,242,.55);margin-top:2px">依据[' + ctrEsc(e.source) + ']：' + ctrEsc(e.text) + '</div>').join('') : '') +
    '<div style="font-size:11.5px;color:rgba(232,238,242,.4);margin-top:2px">来源：' + ctrEsc(x.source) + '</div></div>'
  ).join('');
  const checklist = (r.checklist || []).map((q, i) =>
    '<label style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px;cursor:pointer">' +
    '<input type="checkbox" style="margin-top:2px" /> <span>' + (i + 1) + '. ' + ctrEsc(q.question) +
    '<span style="display:block;font-size:11.5px;color:rgba(232,238,242,.5)">关注点：' + ctrEsc(q.focus) + ' · ' + ctrEsc(q.related_segments) + '</span></span></label>'
  ).join('');
  box.innerHTML =
    '<div style="background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-bottom:10px">' +
    '<div style="font-size:15px;font-weight:700;margin-bottom:8px">体检结论：' + ctrEsc(r.dish.name) + '（' + ctrEsc(r.brand) + '）</div>' +
    '<div style="font-size:13px;line-height:1.8">主攻客群：<b style="color:#7fd7b8">' + (m.main_segments.length ? ctrEsc(m.main_segments.join('、')) : '暂无明显主攻客群') + '</b></div>' +
    '<div style="font-size:13px;line-height:1.8">风险客群：<b style="color:#f2a0a0">' + (m.risk_segments.length ? m.risk_segments.map((s) => ctrEsc(s.label)).join('、') : '无明显风险客群') + '</b></div>' +
    '<div style="font-size:13px;line-height:1.8">建议定价区间：' + ctrEsc(m.suggested_price.low) + ' ~ ' + ctrEsc(m.suggested_price.high) + ' 元（店均 ' + ctrEsc(r.avg_price) + ' 元 · ' + ctrEsc(m.suggested_price.basis) + '）</div>' +
    '</div>' +
    '<div style="background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-bottom:10px">' +
    '<div style="font-size:14px;font-weight:700;margin-bottom:6px">客群匹配</div>' + matrix + '</div>' +
    '<div style="background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-bottom:10px">' +
    '<div style="font-size:14px;font-weight:700;margin-bottom:6px">风险预判</div>' + (risks || '<div style="font-size:13px;color:rgba(232,238,242,.6)">暂无明显风险</div>') + '</div>' +
    '<div style="background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;margin-bottom:10px">' +
    '<div style="font-size:14px;font-weight:700;margin-bottom:6px">试菜会验证清单（勾选后由试菜人确认）</div>' + checklist + '</div>' +
    '<div style="font-size:11.5px;color:rgba(232,238,242,.4)">本报告为模拟结果，需试菜会真实验证后用于决策。生成时间：' + ctrEsc(r.generated_at) + '</div>';
}

async function cdtRun() {
  const brand = document.getElementById('cdt-brand').value;
  const dish = document.getElementById('cdt-dish').value;
  if (!brand || !dish) { cdtShowError('请先选择品牌和菜品'); return; }
  const btn = document.getElementById('cdt-run');
  btn.disabled = true;
  btn.textContent = '体检中…';
  cdtShowError('');
  try {
    const r = await ctrApi('/api/customer-twin/dish-test/run', { method: 'POST', body: { brand, dish_name: dish } });
    if (!r.ok) throw new Error(r.error || '未找到该菜品');
    __cdt.report = r;
    cdtRenderReport(r);
  } catch (e) {
    cdtShowError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '开始体检';
  }
}

function cdtWireEvents() {
  const brandSel = document.getElementById('cdt-brand');
  if (brandSel && !brandSel.dataset.wired) {
    brandSel.dataset.wired = '1';
    brandSel.addEventListener('change', () => cdtLoadDishes(brandSel.value));
  }
  const dishSel = document.getElementById('cdt-dish');
  if (dishSel && !dishSel.dataset.wired) {
    dishSel.dataset.wired = '1';
    dishSel.addEventListener('change', () => cdtShowAttr(dishSel.value));
  }
  const runBtn = document.getElementById('cdt-run');
  if (runBtn && !runBtn.dataset.wired) {
    runBtn.dataset.wired = '1';
    runBtn.addEventListener('click', cdtRun);
  }
}

function loadDishTestPage() {
  cdtEnsureContainer();
  cdtWireEvents();
}
