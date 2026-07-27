import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../utils/logger.js';
import { runCheckDataIntegration } from './check-data-integration-helpers.js';
import {
  buildInspectionOverview,
  buildInspectionStoreResults,
  calculateHealthScore,
} from './tenant-operation-inspection/inspection-overview-service.js';
import {
  buildInspectionReportHtml,
  createInspectionReportService,
  generateInspectionReport,
} from './tenant-operation-inspection/inspection-report-service.js';

export { buildInspectionReportHtml, calculateHealthScore, generateInspectionReport };

const log = childLogger({ domain: 'tenant-operation-inspection', handler: 'service' });

const STATUS = {
  ok: '正常',
  abnormal: '异常',
  missing: '缺失',
  delayed: '延迟',
  pending: '待配置',
};

const ALLOWED_SCOPES = new Set(['全部', '基础配置', '数据接入', '数据新鲜度', '任务闭环', 'AI 可运行度', '营销归因']);
const _CORE_TABLES = ['stores', SHARED_TABLES.POS_ORDER_ITEMS, 'growth_customer_profiles', 'customer_ops_source_records'];
const RESPONSIBLE_PARTY_LABELS = {
  platform_team: '我方实施 / 系统人员',
  tenant_admin: '租户管理员',
  store_manager: '店长',
  employee: '员工',
  system_integration: '系统接口',
  customer_success: '客户成功',
};

function ymd(date = new Date()) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date ? new Date(date) : new Date());
}

function previousDate(date) {
  const d = new Date(`${ymd(date)}T00:00:00+08:00`);
  d.setDate(d.getDate() - 1);
  return ymd(d);
}

function n(v) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function pct(ok, total) {
  if (n(total) <= 0) return 0;
  return Math.round((n(ok) / n(total)) * 100);
}

function normalizeStore(row) {
  return {
    store_id: String(row?.store_id || row?.id || row?.store_code || row?.name || row?.store_name || '').trim(),
    store_name: String(row?.name || row?.store_name || row?.store || row?.store_id || row?.id || '').trim(),
  };
}

function likePattern(value) {
  return `%${String(value || '').replace(/[%_]/g, '\\$&')}%`;
}

function normalizeStoreText(value) {
  return String(value || '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[·•\-\s_【】\[\]（）()]/g, '')
    .trim();
}

function storeSearchTokens(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeStoreText(raw);
  const tokens = new Set([raw, normalized]);
  const brand = normalized.match(/^[\u4e00-\u9fa5]{2,4}/)?.[0];
  if (brand) tokens.add(brand);
  for (const word of ['马己仙', '洪潮', '久光', '音乐广场', '大宁']) {
    if (raw.includes(word) || normalized.includes(word)) tokens.add(word);
  }
  return Array.from(tokens).filter((x) => x && x.length >= 2);
}

function storeFilterValues(ctx = {}, stores = []) {
  const values = new Set();
  if (ctx.storeId) values.add(String(ctx.storeId).trim());
  for (const store of stores || []) {
    if (store.store_id) values.add(String(store.store_id).trim());
    if (store.store_name) values.add(String(store.store_name).trim());
  }
  return Array.from(values).filter(Boolean);
}

function storeFilterPatterns(values = []) {
  const patterns = new Set();
  for (const value of values || []) {
    for (const token of storeSearchTokens(value)) patterns.add(likePattern(token));
  }
  return Array.from(patterns);
}

function responsibleParty(ownerRole = '') {
  const role = String(ownerRole || '').trim();
  if (/租户/.test(role)) return 'tenant_admin';
  if (/店长/.test(role)) return 'store_manager';
  if (/员工/.test(role)) return 'employee';
  if (/接口|同步|实施|系统/.test(role)) return role === '系统' ? 'system_integration' : 'platform_team';
  if (/客户成功|托管/.test(role)) return 'customer_success';
  return 'platform_team';
}

function issue({
  category,
  item_key,
  item_name,
  status = STATUS.ok,
  severity = 'P3',
  owner_role = '系统',
  impact_modules = [],
  impact_description = '',
  suggestion = '',
  evidence = {},
  store = {},
  can_generate_task,
  responsible_party,
}) {
  const party = responsible_party || responsibleParty(owner_role);
  return {
    id: null,
    run_id: null,
    tenant_id: '',
    store_id: store.store_id || '',
    store_name: store.store_name || '',
    category,
    item_key,
    item_name,
    status,
    severity,
    owner_role,
    responsible_party: party,
    responsible_party_label: RESPONSIBLE_PARTY_LABELS[party] || party,
    impact_modules,
    impact_description,
    suggestion,
    evidence,
    can_generate_task: can_generate_task ?? status !== STATUS.ok,
    generated_task_id: null,
    created_at: new Date().toISOString(),
  };
}

async function tableExists(pool, table) {
  try {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [table]
    );
    return (r.rows || []).length > 0;
  } catch (e) {
    log.warn({ msg: 'tenant_inspection_tableexists_failed', detail: [table, e?.message || e] });
    return false;
  }
}

async function tableColumns(pool, table) {
  try {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table]
    );
    return new Set((r.rows || []).map((row) => String(row.column_name || '').trim()).filter(Boolean));
  } catch (e) {
    log.warn({ msg: 'tenant_inspection_tablecolumns_failed', detail: [table, e?.message || e] });
    return new Set();
  }
}

async function queryIfTable(pool, table, sql, params = []) {
  if (!(await tableExists(pool, table))) return { exists: false, rows: [], error: null, evidence: { table_missing: table, table_exists: false } };
  try {
    const r = await pool.query(sql, params);
    return { exists: true, rows: r.rows || [], error: null, evidence: { table_exists: true } };
  } catch (e) {
    log.warn({ msg: 'tenant_inspection_query_failed', detail: [table, e?.message || e] });
    return { exists: true, rows: [], error: String(e?.message || e), evidence: { table_exists: true, field_missing: String(e?.message || e) } };
  }
}

export const {
  saveInspectionReport,
  listInspectionReports,
  markInspectionReportSent,
} = createInspectionReportService({ queryIfTable });

// “多门店管理”创建门店时生成的是 store_<timestamp> 这种合成ID，只写在 hrms_state.data->'stores'
// 这个JSON字段里，不落在关系型 stores 表、也不含品牌关键词——loadStores 原来的匹配路径
// （精确匹配 stores 表 / ILIKE 模糊匹配 / growth_ontology_stores）都查不到这种ID，会导致
// 后续所有按门店过滤的检查（员工绑定、POS接入等）查出 0 条，被误判成"数据缺失"。
// 这里补一条兜底：查 hrms_state 拿到该ID对应的真实门店名称，再用真实名称去匹配业务表。
async function resolveStoreIdFromHrmsState(pool, tenantId, storeId) {
  if (!storeId) return null;
  try {
    const r = await pool.query(`SELECT data->'stores' AS stores FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`, [tenantId || 'default']);
    const list = Array.isArray(r.rows?.[0]?.stores) ? r.rows[0].stores : [];
    const hit = list.find((s) => String(s?.id || '').trim() === storeId || String(s?.name || '').trim() === storeId);
    if (!hit) return null;
    const name = String(hit.name || hit.brandName || hit.brand || '').trim();
    if (!name) return null;
    return { store_id: storeId, store_name: name };
  } catch (e) {
    log.warn({ msg: 'tenant_operation_inspection_hrms_state_store_lookup_skipped', err: e?.message });
    return null;
  }
}

async function loadStores(pool, { tenantId, storeId }) {
  if (await tableExists(pool, 'stores')) {
    const cols = await tableColumns(pool, 'stores');
    const idExpr = cols.has('store_id') ? 'store_id::text' : cols.has('id') ? 'id::text' : cols.has('code') ? 'code::text' : cols.has('name') ? 'name::text' : "''::text";
    const nameExpr = cols.has('name') ? 'name::text' : cols.has('store_name') ? 'store_name::text' : idExpr;
    const whereParts = ['tenant_id=$1'];
    const params = [tenantId];
    if (storeId) {
      params.push(storeId);
      const match = [];
      if (cols.has('store_id')) match.push(`store_id::text=$${params.length}`);
      if (cols.has('id')) match.push(`id::text=$${params.length}`);
      if (cols.has('name')) match.push(`name::text=$${params.length}`);
      if (cols.has('store_name')) match.push(`store_name::text=$${params.length}`);
      if (match.length) whereParts.push(`(${match.join(' OR ')})`);
    }
    const storesR = await queryIfTable(
      pool,
      'stores',
      `SELECT ${idExpr} AS store_id, ${nameExpr} AS name FROM stores WHERE ${whereParts.join(' AND ')} ORDER BY name`,
      params
    );
    const rows = storesR.rows.map(normalizeStore).filter((s) => s.store_id || s.store_name);
    if (rows.length) return rows;
    if (storeId && (cols.has('name') || cols.has('store_name'))) {
      const likeParts = [];
      const likeParams = [tenantId, likePattern(storeId)];
      if (cols.has('name')) likeParts.push(`name::text ILIKE $2`);
      if (cols.has('store_name')) likeParts.push(`store_name::text ILIKE $2`);
      const fuzzyR = await queryIfTable(
        pool,
        'stores',
        `SELECT ${idExpr} AS store_id, ${nameExpr} AS name FROM stores WHERE tenant_id=$1 AND (${likeParts.join(' OR ')}) ORDER BY name`,
        likeParams
      );
      const fuzzyRows = fuzzyR.rows.map(normalizeStore).filter((s) => s.store_id || s.store_name);
      if (fuzzyRows.length) return fuzzyRows;
    }
  }
  const storesR = await queryIfTable(
    pool,
    'growth_ontology_stores',
    `SELECT store_id, name FROM growth_ontology_stores WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2 OR name=$2 OR name ILIKE $3) ORDER BY name`,
    [tenantId, storeId || '', storeId ? likePattern(storeId) : '%%']
  );
  const rows = storesR.rows.map(normalizeStore).filter((s) => s.store_id || s.store_name);
  if (rows.length) return rows;
  if (storeId) {
    const hrmsStateHit = await resolveStoreIdFromHrmsState(pool, tenantId, storeId);
    if (hrmsStateHit) return [normalizeStore(hrmsStateHit)];
  }
  return rows;
}

async function checkBaseConfiguration(pool, ctx, stores) {
  const items = [];
  const storeValues = storeFilterValues(ctx, stores);
  const storePatterns = storeFilterPatterns(storeValues);
  const hasStores = stores.length > 0;
  items.push(issue({
    category: '基础配置',
    item_key: 'tenant_has_stores',
    item_name: '租户是否已创建门店',
    status: hasStores ? STATUS.ok : STATUS.missing,
    severity: hasStores ? 'P3' : 'P0',
    owner_role: '租户管理员',
    impact_modules: ['系统基础配置', '老板晨报'],
    impact_description: hasStores ? '租户已配置门店，系统可以按门店运行。' : '租户没有门店，系统无法按门店生成日报和经营诊断。',
    suggestion: hasStores ? '保持门店主数据维护。' : '请租户管理员先创建门店，并补齐门店编码和名称。',
    evidence: { store_count: stores.length },
  }));

  let empR = { exists: false, rows: [] };
  if (await tableExists(pool, SHARED_TABLES.EMPLOYEES)) {
    const cols = await tableColumns(pool, SHARED_TABLES.EMPLOYEES);
    const selectStoreId = cols.has('store_id') ? 'store_id::text AS store_id' : "''::text AS store_id";
    const selectStore = cols.has('store') ? 'store::text AS store' : cols.has('store_name') ? 'store_name::text AS store' : "''::text AS store";
    const whereParts = ['tenant_id=$1'];
    const params = [ctx.tenantId];
    if (storeValues.length) {
      params.push(storeValues, storePatterns);
      const match = [];
      if (cols.has('store_id')) match.push(`store_id::text = ANY($${params.length - 1}::text[])`);
      if (cols.has('store')) match.push(`store::text = ANY($${params.length - 1}::text[]) OR store::text ILIKE ANY($${params.length}::text[])`);
      if (cols.has('store_name')) match.push(`store_name::text = ANY($${params.length - 1}::text[]) OR store_name::text ILIKE ANY($${params.length}::text[])`);
      if (match.length) whereParts.push(`(${match.join(' OR ')})`);
    }
    empR = await queryIfTable(
      pool,
      SHARED_TABLES.EMPLOYEES,
      `SELECT username, role, position, ${selectStore}, ${selectStoreId} FROM ${SHARED_TABLES.EMPLOYEES} WHERE ${whereParts.join(' AND ')}`,
      params
    );
  }
  const employees = empR.rows || [];
  const managerCount = employees.filter((e) => ['store_manager', 'admin', 'tenant_admin', 'operation_admin', 'agent_admin'].includes(String(e.role || '').trim())).length;
  const boundCount = employees.filter((e) => String(e.store || e.store_id || '').trim() && String(e.role || e.position || '').trim()).length;

  // 营业时间现在由门店在"编辑门店"里自行维护（hrms_state key='default' -> data.stores[].businessHours），
  // 保存时会同步写一份到 chairman_config；这里两个来源都查一遍，兼容还没被重新保存过的旧数据。
  let businessHoursByStore = {};
  try {
    const r = await pool.query(`SELECT data->'stores' AS stores FROM ${SHARED_TABLES.HRMS_STATE} WHERE key='chairman_config' LIMIT 1`);
    const storeMap = r.rows?.[0]?.stores || {};
    for (const [name, profile] of Object.entries(storeMap)) {
      businessHoursByStore[name] = String(profile?.businessHours || '').trim();
    }
  } catch (e) {
    log.warn({ msg: 'tenant_inspection_chairman_config_business_hours_lookup_skipped', err: e?.message });
  }
  try {
    const r2 = await pool.query(`SELECT data->'stores' AS stores FROM ${SHARED_TABLES.HRMS_STATE} WHERE key=$1 LIMIT 1`, [ctx.tenantId || 'default']);
    const storeList = Array.isArray(r2.rows?.[0]?.stores) ? r2.rows[0].stores : [];
    for (const s of storeList) {
      const hours = String(s?.businessHours || '').trim();
      if (hours && s?.name) businessHoursByStore[s.name] = hours;
    }
  } catch (e) {
    log.warn({ msg: 'tenant_inspection_store_businesshours_lookup_skipped', err: e?.message });
  }
  for (const store of stores.length ? stores : [{}]) {
    const hours = businessHoursByStore[store.store_name] || '';
    items.push(issue({
      category: '基础配置',
      item_key: 'store_business_hours',
      item_name: '门店是否配置营业时间',
      status: hours ? STATUS.ok : STATUS.pending,
      severity: hours ? 'P3' : 'P3',
      owner_role: '实施人员',
      impact_modules: ['系统基础配置', '老板晨报'],
      impact_description: hours ? `已配置营业时间：${hours}。` : '未配置营业时间，日报时段和复检判断会使用系统默认时段。',
      suggestion: '请在"门店画像"配置里补充营业时间字段。',
      store,
      evidence: { business_hours: hours || null },
    }));
  }

  items.push(issue({
    category: '基础配置',
    item_key: 'employees_bound_store_role',
    item_name: '员工是否绑定门店和岗位',
    status: !empR.exists ? STATUS.pending : boundCount > 0 ? STATUS.ok : STATUS.missing,
    severity: !empR.exists ? 'P2' : boundCount > 0 ? 'P3' : 'P0',
    owner_role: '租户管理员',
    impact_modules: ['任务闭环', '人才盘点', '绩效评估'],
    impact_description: boundCount > 0 ? '员工已绑定门店和岗位，人才盘点和绩效评估可以按角色分析。' : '员工门店或岗位缺失会导致人才盘点、绩效评估和整改责任建议不准确。',
    suggestion: '请补齐员工门店、岗位和角色字段。',
    evidence: { ...(empR.evidence || {}), employee_table_exists: empR.exists, employee_count: employees.length, bound_count: boundCount },
  }));
  items.push(issue({
    category: '基础配置',
    item_key: 'manager_roles_configured',
    item_name: '是否设置店长 / 管理员角色',
    status: !empR.exists ? STATUS.pending : managerCount > 0 ? STATUS.ok : STATUS.missing,
    severity: !empR.exists ? 'P2' : managerCount > 0 ? 'P3' : 'P0',
    owner_role: '租户管理员',
    impact_modules: ['任务闭环', '系统基础配置'],
    impact_description: managerCount > 0 ? '已识别店长或管理员角色。' : '没有店长或管理员角色时，门店问题确认和异常升级没有明确承接人。',
    suggestion: '请为每个门店至少配置一名店长或管理员。',
    evidence: { ...(empR.evidence || {}), manager_count: managerCount },
  }));

  const targetR = await queryIfTable(
    pool,
    'kpi_targets',
    // kpi_targets 实际是按品牌存目标（store 列基本是空的，品牌名存在 brand 列），
    // 原查询只查了 store 列，马己仙/洪潮已经配置的经营目标会被查成 0 条——这是真实的字段用错，不是数据缺失。
    `SELECT COUNT(*)::int AS total FROM kpi_targets WHERE tenant_id=$1 AND ($2::text[] IS NULL OR store = ANY($2::text[]) OR store ILIKE ANY($3::text[]) OR brand = ANY($2::text[]) OR brand ILIKE ANY($3::text[]))`,
    [ctx.tenantId, storeValues.length ? storeValues : null, storePatterns.length ? storePatterns : null]
  );
  const targetTotal = n(targetR.rows?.[0]?.total);
  items.push(issue({
    category: '基础配置',
    item_key: 'business_targets_configured',
    item_name: '是否设置经营目标',
    status: !targetR.exists ? STATUS.pending : targetTotal > 0 ? STATUS.ok : STATUS.pending,
    severity: targetTotal > 0 ? 'P3' : 'P3',
    owner_role: '租户管理员',
    impact_modules: ['经营诊断', '老板晨报', '月度复盘'],
    impact_description: targetTotal > 0 ? '已配置经营目标，可用于达成率分析。' : '未设置门店目标时，经营诊断只能看趋势，不能判断目标达成。',
    suggestion: '请配置收入、毛利、客流等核心经营目标。',
    evidence: { ...(targetR.evidence || {}), kpi_targets_exists: targetR.exists, target_count: targetTotal },
  }));
  return items;
}

async function checkDataIntegration(pool, ctx, stores = []) {
  return runCheckDataIntegration(pool, ctx, stores, {
    queryIfTable,
    issue,
    STATUS,
    previousDate,
    storeFilterValues,
    storeFilterPatterns,
    n,
    pct,
  });
}

async function checkMarketing(pool, ctx) {
  const [profilesR, deliveryR, redemptionsR, attrR] = await Promise.all([
    queryIfTable(pool, 'growth_customer_profiles', `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE COALESCE(lifecycle_stage,'')<>'' OR COALESCE(value_tier,'')<>'')::int AS segmented FROM growth_customer_profiles WHERE tenant_id=$1`, [ctx.tenantId]),
    queryIfTable(pool, 'growth_delivery_logs', `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('sent','success','delivered'))::int AS sent, COUNT(*) FILTER (WHERE COALESCE(campaign_id,'') <> '')::int AS with_campaign_id FROM growth_delivery_logs WHERE tenant_id=$1`, [ctx.tenantId]),
    queryIfTable(pool, 'growth_redemptions', `SELECT COUNT(*)::int AS total FROM growth_redemptions WHERE tenant_id=$1`, [ctx.tenantId]),
    // 归因是否能落地，看的应该是 customer-ops.js 实际在跑的归因引擎（触达记录关联手机号 -> 匹配POS回店订单），
    // 不是 growth_ontology_attributions 这张基本没有真实数据写入的旧表——用错表会把"能用的功能"误判成"不可用"。
    queryIfTable(pool, 'pos_orders', `
      WITH touches AS (
        SELECT DISTINCT regexp_replace(COALESCE(payload->>'phone',''), '[^0-9]', '', 'g') AS phone
          FROM growth_delivery_logs
         WHERE tenant_id=$1 AND status='sent' AND COALESCE(payload->>'phone','') <> ''
      )
      SELECT COUNT(DISTINCT po.order_no)::int AS linked_orders, (SELECT COUNT(*) FROM touches)::int AS total
        FROM touches t
        JOIN pos_orders po ON regexp_replace(COALESCE(po.phone,''), '[^0-9]', '', 'g') = t.phone
       WHERE po.tenant_id=$1`, [ctx.tenantId]),
  ]);
  const profiles = profilesR.rows?.[0] || {};
  const delivery = deliveryR.rows?.[0] || {};
  const redemptions = redemptionsR.rows?.[0] || {};
  const attr = attrR.rows?.[0] || {};
  return [
    issue({ category: 'AI 可运行度', item_key: 'customer_segments_generatable', item_name: '客户分层是否可生成', status: !profilesR.exists ? STATUS.pending : n(profiles.segmented) > 0 ? STATUS.ok : STATUS.missing, severity: n(profiles.segmented) > 0 ? 'P3' : 'P2', owner_role: '系统', impact_modules: ['客户资产报告', '自动营销'], impact_description: '客户分层决定自动营销能否按价值、流失风险和回店周期生成名单。', suggestion: '请先同步客户画像并运行客户分层。', evidence: { ...(profilesR.evidence || {}), customer_count: n(profiles.total), segmented_count: n(profiles.segmented) } }),
    issue({ category: '营销归因', item_key: 'marketing_list_non_empty', item_name: '营销名单是否为空', status: !profilesR.exists ? STATUS.pending : n(profiles.total) > 0 ? STATUS.ok : STATUS.missing, severity: n(profiles.total) > 0 ? 'P3' : 'P1', owner_role: '实施人员', impact_modules: ['自动营销'], impact_description: '营销名单为空时，自动触达无法发起。', suggestion: '请检查客户画像、营销规则和名单生成条件。', evidence: { ...(profilesR.evidence || {}), customer_count: n(profiles.total) } }),
    issue({ category: '营销归因', item_key: 'sms_wecom_sent', item_name: '短信 / 企微是否有发送记录', status: !deliveryR.exists ? STATUS.pending : n(delivery.sent) > 0 ? STATUS.ok : STATUS.missing, severity: n(delivery.sent) > 0 ? 'P3' : 'P1', owner_role: '实施人员', impact_modules: ['自动营销', '营销归因'], impact_description: '没有发送记录时，系统无法判断触达是否发生，也无法做转化归因。', suggestion: '请检查 growth_delivery_logs、短信和企微发送配置。', evidence: { ...(deliveryR.evidence || {}), delivery_total: n(delivery.total), delivery_sent: n(delivery.sent) } }),
    issue({
      category: '营销归因',
      item_key: 'delivery_campaign_id_complete_rate',
      item_name: '触达记录关联活动的完整率',
      status: !deliveryR.exists ? STATUS.pending : n(delivery.total) === 0 ? STATUS.pending : pct(delivery.with_campaign_id, delivery.total) >= 60 ? STATUS.ok : STATUS.abnormal,
      severity: !deliveryR.exists || n(delivery.total) === 0 ? 'P2' : pct(delivery.with_campaign_id, delivery.total) >= 60 ? 'P3' : 'P1',
      owner_role: '系统',
      impact_modules: ['营销归因', '月度复盘'],
      impact_description: n(delivery.total) === 0 ? '暂无触达记录，暂时无法计算这项比例。' : `系统里的触达记录（短信/企微发送）中，能明确对应到"这是哪次营销活动"的比例是 ${pct(delivery.with_campaign_id, delivery.total)}%。比例太低会导致月度复盘时算不清"这次活动到底带来了多少回店和营业额"，因为系统分不清这条发送记录属于哪次活动。`,
      suggestion: '这是系统内部记录发送时的技术设置问题，不需要租户操作——我方会检查自动触达和手动群发在写入发送记录时，是否都正确关联了对应的活动编号。',
      evidence: { ...(deliveryR.evidence || {}), rate: pct(delivery.with_campaign_id, delivery.total), with_campaign_id: n(delivery.with_campaign_id), total: n(delivery.total) },
    }),
    issue({ category: '营销归因', item_key: 'coupon_issue_redeem_data', item_name: '优惠券是否有发放和核销数据', status: !redemptionsR.exists ? STATUS.pending : n(redemptions.total) > 0 ? STATUS.ok : STATUS.missing, severity: n(redemptions.total) > 0 ? 'P3' : 'P1', owner_role: '实施人员', impact_modules: ['自动营销', '营销归因'], impact_description: '优惠券核销缺失会导致营销 ROI 和活动复盘不准确。', suggestion: '请检查券发放、核销同步，以及优惠券是否能和营销活动、回店订单对应起来。', evidence: { ...(redemptionsR.evidence || {}), coupon_writeoff_count: n(redemptions.total) } }),
    issue({
      category: '营销归因',
      item_key: 'attribution_links_orders',
      item_name: '营销活动是否能识别回店订单',
      status: !attrR.exists ? STATUS.pending : n(attr.total) === 0 ? STATUS.pending : n(attr.linked_orders) > 0 ? STATUS.ok : STATUS.missing,
      severity: n(attr.total) === 0 ? 'P2' : n(attr.linked_orders) > 0 ? 'P3' : 'P1',
      owner_role: '系统',
      impact_modules: ['营销归因', '月度复盘'],
      impact_description: n(attr.total) === 0 ? '暂无触达记录可用于匹配回店订单，等有实际发送记录后再评估。' : `已发送触达的客户里，有回店订单能匹配上的比例是 ${pct(attr.linked_orders, attr.total)}%（${n(attr.linked_orders)}/${n(attr.total)}人）。这个数字同时受手机号完整率、触达后客户是否真的回店两个因素影响。`,
      suggestion: '这项主要看两点：一是这次触达的客户手机号是否完整（不完整会导致匹配不到，属于POS数据限制）；二是触达后客户是否真的回店消费。不需要单独整改系统配置。',
      evidence: { ...(attrR.evidence || {}), attribution_order_count: n(attr.linked_orders), attribution_total: n(attr.total) },
    }),
  ];
}

async function checkTaskClosedLoop(pool, ctx, stores = []) {
  const storeValues = storeFilterValues(ctx, stores);
  const storePatterns = storeFilterPatterns(storeValues);
  const taskR = await queryIfTable(
    pool,
    SHARED_TABLES.MASTER_TASKS,
    `SELECT COUNT(*)::int AS total,
            COUNT(*)::int AS generated,
            COUNT(*) FILTER (WHERE status IN ('pending_response','pending_review','resolved','settled','closed','hr_filed'))::int AS confirmed,
            COUNT(*) FILTER (WHERE status IN ('resolved','settled','closed','hr_filed'))::int AS executed,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','settled','closed','hr_filed') AND COALESCE(timeout_at, dispatched_at + INTERVAL '1 day') < NOW())::int AS overdue,
            COUNT(*) FILTER (WHERE review_result <> '{}'::jsonb OR status IN ('resolved','settled','closed','hr_filed'))::int AS reviewed
       FROM ${SHARED_TABLES.MASTER_TASKS}
      WHERE tenant_id=$1 AND ($2::text[] IS NULL OR store = ANY($2::text[]) OR store ILIKE ANY($3::text[]) OR source_data->>'store_id' = ANY($2::text[]))`,
    [ctx.tenantId, storeValues.length ? storeValues : null, storePatterns.length ? storePatterns : null]
  );
  const t = taskR.rows?.[0] || {};
  return [
    issue({ category: '任务闭环', item_key: 'ai_tasks_generated', item_name: 'AI 运营建议是否已生成', status: !taskR.exists ? STATUS.pending : n(t.generated) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.generated) > 0 ? 'P3' : 'P2', owner_role: '系统', impact_modules: ['任务闭环'], impact_description: '没有 AI 运营建议时，系统只能发现问题，不能形成后续跟进记录。', suggestion: '请检查运营建议生成链路和 Agent 调度是否正常。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_generated_count: n(t.generated) } }),
    issue({ category: '任务闭环', item_key: 'manager_confirmed_tasks', item_name: '门店负责人是否确认运营建议', status: !taskR.exists ? STATUS.pending : n(t.confirmed) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.confirmed) > 0 ? 'P3' : 'P2', owner_role: '店长', impact_modules: ['任务闭环'], impact_description: '门店负责人未确认运营建议会导致后续动作没有责任承接。', suggestion: '请租赁方安排门店负责人确认待处理运营建议。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_confirmed_count: n(t.confirmed) } }),
    issue({ category: '任务闭环', item_key: 'employees_executed_tasks', item_name: '员工是否反馈执行结果', status: !taskR.exists ? STATUS.pending : n(t.executed) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.executed) > 0 ? 'P3' : 'P2', owner_role: '员工', impact_modules: ['任务闭环', '绩效评估'], impact_description: '执行结果缺失会影响闭环、复盘和绩效判定。', suggestion: '请租赁方补充执行结果、照片或文字说明。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_executed_count: n(t.executed) } }),
    issue({ category: '任务闭环', item_key: 'overdue_tasks_exist', item_name: '是否存在逾期未完成事项', status: !taskR.exists ? STATUS.pending : n(t.overdue) > 0 ? STATUS.abnormal : STATUS.ok, severity: n(t.overdue) > 0 ? 'P2' : 'P3', owner_role: '店长', impact_modules: ['任务闭环', '老板晨报'], impact_description: '逾期事项会导致系统判断门店动作未完成，影响老板晨报和复盘结论。', suggestion: '请租赁方优先处理逾期事项，必要时由我方协助说明处理口径。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_overdue_count: n(t.overdue) } }),
    issue({ category: '任务闭环', item_key: 'execution_review_records', item_name: '是否有执行结果和复核记录', status: !taskR.exists ? STATUS.pending : n(t.reviewed) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.reviewed) > 0 ? 'P3' : 'P1', owner_role: '系统', impact_modules: ['任务闭环', '绩效评估'], impact_description: '执行结果未回传会导致事项是否有效无法判断，也影响绩效评估。', suggestion: '请检查执行结果回传、复核流程和运营记录是否完整。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_reviewed_count: n(t.reviewed) } }),
  ];
}

async function persistRun(pool, ctx, overview, items) {
  const summary = overview.health_score == null
    ? `${overview.risk_level}：${(overview.initialization_required || []).join('；') || '请先完成初始化配置'}`
    : `健康分 ${overview.health_score} 分，风险等级 ${overview.risk_level}`;
  const runR = await pool.query(
    `INSERT INTO tenant_operation_inspection_runs
      (tenant_id, store_id, inspection_date, health_score, risk_level, data_completeness, data_freshness, task_completion_rate, ai_runnable_rate, attribution_completeness, summary, inspection_status, operation_stage, customer_success_risk)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [ctx.tenantId, ctx.storeId || null, ctx.date, overview.raw_health_score ?? overview.health_score ?? 0, overview.risk_level, overview.data_completeness, overview.data_freshness, overview.task_completion_rate, overview.ai_runnable_rate, overview.attribution_completeness, summary, overview.inspection_status || 'completed', overview.operation_stage || 'active', overview.customer_success_risk || 'low']
  ).catch((e) => {
    log.warn({ msg: 'tenant_inspection_persist_run_failed', err: e?.message || e });
    return { rows: [] };
  });
  const runId = runR.rows?.[0]?.id || null;
  if (!runId) return items;
  for (const item of items) {
    const r = await pool.query(
      `INSERT INTO tenant_operation_inspection_items
        (run_id, tenant_id, store_id, category, item_key, item_name, status, severity, owner_role, responsible_party, impact_modules, impact_description, suggestion, evidence, can_generate_task)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15)
       RETURNING id`,
      [runId, ctx.tenantId, item.store_id || null, item.category, item.item_key, item.item_name, item.status, item.severity, item.owner_role, item.responsible_party || responsibleParty(item.owner_role), JSON.stringify(item.impact_modules || []), item.impact_description, item.suggestion, JSON.stringify(item.evidence || {}), !!item.can_generate_task]
    ).catch((e) => {
      log.warn({ msg: 'tenant_inspection_persist_item_failed', err: e?.message || e });
      return { rows: [] };
    });
    item.id = r.rows?.[0]?.id || item.id;
    item.run_id = runId;
    item.tenant_id = ctx.tenantId;
  }
  return items;
}

export async function runInspection(pool, opts = {}) {
  const ctx = {
    tenantId: String(opts.tenantId || opts.tenant_id || 'default').trim() || 'default',
    storeId: String(opts.storeId || opts.store_id || '').trim(),
    date: ymd(opts.date),
    scope: ALLOWED_SCOPES.has(String(opts.scope || '全部')) ? String(opts.scope || '全部') : '全部',
  };
  const stores = await loadStores(pool, ctx);
  let items = [
    ...(await checkBaseConfiguration(pool, ctx, stores)),
    ...(await checkDataIntegration(pool, ctx, stores)),
    ...(await checkMarketing(pool, ctx)),
    ...(await checkTaskClosedLoop(pool, ctx, stores)),
  ];
  if (ctx.scope !== '全部') items = items.filter((item) => item.category === ctx.scope);
  const score = calculateHealthScore(items);
  let overview = buildInspectionOverview(score, items, stores);
  items = await persistRun(pool, ctx, overview, items);
  overview = buildInspectionOverview(score, items, stores);
  return { ok: true, tenant_id: ctx.tenantId, store_id: ctx.storeId, date: ctx.date, overview, top_issues: overview.top_issues, store_results: buildInspectionStoreResults(stores, items), items };
}

export async function getLatestOverview(pool, opts = {}) {
  const result = await runInspection(pool, opts);
  return result.overview;
}

export async function listInspectionItems(pool, opts = {}) {
  const tenantId = String(opts.tenantId || opts.tenant_id || 'default').trim() || 'default';
  const storeId = String(opts.storeId || opts.store_id || '').trim();
  const category = String(opts.category || '').trim();
  const severity = String(opts.severity || '').trim();
  const r = await queryIfTable(
    pool,
    'tenant_operation_inspection_items',
    `SELECT * FROM tenant_operation_inspection_items
      WHERE tenant_id=$1
        AND ($2::text='' OR store_id=$2)
        AND ($3::text='' OR category=$3)
        AND ($4::text='' OR severity=$4)
      ORDER BY created_at DESC, id DESC LIMIT 300`,
    [tenantId, storeId, category, severity]
  );
  return r.exists ? r.rows : [];
}

export async function generateRecoveryTask(pool, { item, itemId } = {}) {
  const { routeInspectionItemToIncident } = await import('./tenant-health-incident-service.js');
  return routeInspectionItemToIncident(pool, { item, itemId });
}

export async function generateRecoveryTasksBatch(pool, opts = {}) {
  const { routeInspectionItemsBatch } = await import('./tenant-health-incident-service.js');
  return routeInspectionItemsBatch(pool, opts);
}

function dateRange7(endDate) {
  const end = new Date(`${ymd(endDate)}T00:00:00+08:00`);
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    out.push(ymd(d));
  }
  return out;
}

export async function getInspectionTrends(pool, opts = {}) {
  const tenantId = String(opts.tenantId || opts.tenant_id || 'default').trim() || 'default';
  const storeId = String(opts.storeId || opts.store_id || '').trim();
  const dates = dateRange7(opts.date);
  const r = await queryIfTable(
    pool,
    'tenant_operation_inspection_runs',
    `WITH latest AS (
       SELECT DISTINCT ON (inspection_date)
              inspection_date::text AS date, health_score, data_completeness, task_completion_rate, attribution_completeness, id
         FROM tenant_operation_inspection_runs
        WHERE tenant_id=$1
          AND ($2::text='' OR store_id=$2)
          AND inspection_date BETWEEN $3::date AND $4::date
        ORDER BY inspection_date, created_at DESC, id DESC
     )
     SELECT l.date, l.health_score, l.data_completeness, l.task_completion_rate, l.attribution_completeness,
            COALESCE(SUM(CASE WHEN i.severity='P0' AND i.status <> '正常' THEN 1 ELSE 0 END), 0)::int AS p0_count,
            COALESCE(SUM(CASE WHEN i.severity='P1' AND i.status <> '正常' THEN 1 ELSE 0 END), 0)::int AS p1_count
       FROM latest l
       LEFT JOIN tenant_operation_inspection_items i ON i.run_id = l.id
      GROUP BY l.date, l.health_score, l.data_completeness, l.task_completion_rate, l.attribution_completeness
      ORDER BY l.date`,
    [tenantId, storeId, dates[0], dates[6]]
  );
  const byDate = new Map((r.rows || []).map((row) => [String(row.date).slice(0, 10), row]));
  return dates.map((date) => {
    const row = byDate.get(date) || {};
    return {
      date,
      health_score: row.health_score == null ? null : n(row.health_score),
      p0_count: n(row.p0_count),
      p1_count: n(row.p1_count),
      data_completeness: row.data_completeness == null ? null : n(row.data_completeness),
      task_completion_rate: row.task_completion_rate == null ? null : n(row.task_completion_rate),
      attribution_completeness: row.attribution_completeness == null ? null : n(row.attribution_completeness),
    };
  });
}
