const STATUS = {
  ok: '正常',
  abnormal: '异常',
  missing: '缺失',
  delayed: '延迟',
  pending: '待配置',
};

const SEVERITY_DEDUCTION = { P0: 25, P1: 12, P2: 6, P3: 2 };
const ALLOWED_SCOPES = new Set(['全部', '基础配置', '数据接入', '数据新鲜度', '任务闭环', 'AI 可运行度', '营销归因']);
const CORE_TABLES = ['stores', 'pos_order_items', 'growth_customer_profiles', 'customer_ops_source_records'];
const RESPONSIBLE_PARTY_LABELS = {
  platform_team: '我方实施 / 系统人员',
  tenant_admin: '租户管理员',
  store_manager: '店长',
  employee: '员工',
  system_integration: '系统接口',
  customer_success: '客户成功',
};
const MODULES = ['经营诊断', '客户资产报告', '自动营销', '营销归因', '任务闭环', '人才盘点', '绩效评估', '老板日报', '月度复盘'];

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

function riskLevel(score) {
  if (score >= 90) return '健康';
  if (score >= 75) return '关注';
  if (score >= 60) return '预警';
  return '严重';
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
  return (values || []).filter(Boolean).map(likePattern);
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
    console.warn('[tenant-inspection] tableExists failed:', table, e?.message || e);
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
    console.warn('[tenant-inspection] tableColumns failed:', table, e?.message || e);
    return new Set();
  }
}

async function queryIfTable(pool, table, sql, params = []) {
  if (!(await tableExists(pool, table))) return { exists: false, rows: [], error: null, evidence: { table_missing: table, table_exists: false } };
  try {
    const r = await pool.query(sql, params);
    return { exists: true, rows: r.rows || [], error: null, evidence: { table_exists: true } };
  } catch (e) {
    console.warn('[tenant-inspection] query failed:', table, e?.message || e);
    return { exists: true, rows: [], error: String(e?.message || e), evidence: { table_exists: true, field_missing: String(e?.message || e) } };
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
  return storesR.rows.map(normalizeStore).filter((s) => s.store_id || s.store_name);
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
    impact_modules: ['系统基础配置', '老板日报'],
    impact_description: hasStores ? '租户已配置门店，系统可以按门店运行。' : '租户没有门店，系统无法按门店生成日报和经营诊断。',
    suggestion: hasStores ? '保持门店主数据维护。' : '请租户管理员先创建门店，并补齐门店编码和名称。',
    evidence: { store_count: stores.length },
  }));

  let empR = { exists: false, rows: [] };
  if (await tableExists(pool, 'employees')) {
    const cols = await tableColumns(pool, 'employees');
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
      'employees',
      `SELECT username, role, position, ${selectStore}, ${selectStoreId} FROM employees WHERE ${whereParts.join(' AND ')}`,
      params
    );
  }
  const employees = empR.rows || [];
  const managerCount = employees.filter((e) => ['store_manager', 'admin', 'tenant_admin', 'operation_admin', 'agent_admin'].includes(String(e.role || '').trim())).length;
  const boundCount = employees.filter((e) => String(e.store || e.store_id || '').trim() && String(e.role || e.position || '').trim()).length;

  for (const store of stores.length ? stores : [{}]) {
    items.push(issue({
      category: '基础配置',
      item_key: 'store_business_hours',
      item_name: '门店是否配置营业时间',
      status: STATUS.pending,
      severity: 'P3',
      owner_role: '实施人员',
      impact_modules: ['系统基础配置', '老板日报'],
      impact_description: '未发现统一营业时间字段，日报时段和复检判断会使用系统默认时段。',
      suggestion: '请在门店配置中补充营业时间或接入门店营业配置表。',
      store,
      evidence: { compatible_reason: 'stores table has no stable business_hours contract' },
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
    `SELECT COUNT(*)::int AS total FROM kpi_targets WHERE tenant_id=$1 AND ($2::text[] IS NULL OR store = ANY($2::text[]) OR store ILIKE ANY($3::text[]))`,
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
    impact_modules: ['经营诊断', '老板日报', '月度复盘'],
    impact_description: targetTotal > 0 ? '已配置经营目标，可用于达成率分析。' : '未设置门店目标时，经营诊断只能看趋势，不能判断目标达成。',
    suggestion: '请配置收入、毛利、客流等核心经营目标。',
    evidence: { ...(targetR.evidence || {}), kpi_targets_exists: targetR.exists, target_count: targetTotal },
  }));
  return items;
}

async function checkDataIntegration(pool, ctx, stores = []) {
  const yesterday = previousDate(ctx.date);
  const storeValues = storeFilterValues(ctx, stores);
  const storePatterns = storeFilterPatterns(storeValues);
  const posR = await queryIfTable(
    pool,
    'pos_order_items',
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE biz_date=$3::date)::int AS yesterday_total,
            MAX(biz_date)::text AS latest_date,
            COUNT(*) FILTER (WHERE COALESCE(tags,'') <> '' OR COALESCE(order_no,'') <> '')::int AS phone_rows,
            COUNT(*) FILTER (WHERE COALESCE(tags,'') <> '')::int AS rows_with_phone,
            COUNT(DISTINCT dish_name)::int AS dish_rows,
            COUNT(DISTINCT dish_name) FILTER (WHERE COALESCE(category,'') <> '')::int AS categorized_dish_rows
       FROM pos_order_items
      WHERE tenant_id=$1 AND ($2::text[] IS NULL OR store_code = ANY($2::text[]) OR store_name = ANY($2::text[]) OR store_name ILIKE ANY($4::text[]))`,
    [ctx.tenantId, storeValues.length ? storeValues : null, yesterday, storePatterns.length ? storePatterns : null]
  );
  const pos = posR.rows?.[0] || {};
  const posTotal = n(pos.total);
  const yesterdayTotal = n(pos.yesterday_total);
  const phoneRate = pct(pos.rows_with_phone, pos.phone_rows);
  const dishRate = pct(pos.categorized_dish_rows, pos.dish_rows);

  const customerR = await queryIfTable(
    pool,
    'growth_customer_profiles',
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE updated_at >= ($2::date - INTERVAL '7 days'))::int AS updated_7d,
            COUNT(*) FILTER (WHERE COALESCE(lifecycle_stage,'') <> '' OR COALESCE(value_tier,'') <> '')::int AS segmented,
            COUNT(*) FILTER (WHERE COALESCE(phone,'') <> '')::int AS phone_matched,
            COUNT(*)::int AS phone_total
       FROM growth_customer_profiles
      WHERE tenant_id=$1`,
    [ctx.tenantId, ctx.date]
  );
  const customerOpsR = await queryIfTable(
    pool,
    'customer_ops_source_records',
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at >= ($2::date - INTERVAL '7 days'))::int AS updated_7d
       FROM customer_ops_source_records WHERE tenant_id=$1`,
    [ctx.tenantId, ctx.date]
  );
  const customers = customerR.rows?.[0] || {};
  const customerTotal = Math.max(n(customers.total), n(customerOpsR.rows?.[0]?.total));

  return [
    issue({
      category: '数据接入',
      item_key: 'pos_data_connected',
      item_name: 'POS 数据是否接入',
      status: !posR.exists ? STATUS.pending : posTotal > 0 ? STATUS.ok : STATUS.missing,
      severity: !posR.exists ? 'P0' : posTotal > 0 ? 'P3' : 'P0',
      owner_role: '实施人员',
      impact_modules: ['经营诊断', '老板日报', '营销归因'],
      impact_description: posTotal > 0 ? 'POS 数据已接入，经营诊断可读取订单明细。' : 'POS 数据未接入会导致经营诊断、老板日报和客户回店归因无法运转。',
      suggestion: '请检查 POS 接口、pos_order_items 同步任务和租户门店映射。',
      evidence: { ...(posR.evidence || {}), table_exists: posR.exists, total: posTotal },
    }),
    issue({
      category: '数据新鲜度',
      item_key: 'yesterday_orders_synced',
      item_name: '昨日订单数据是否同步',
      status: !posR.exists ? STATUS.pending : yesterdayTotal > 0 ? STATUS.ok : STATUS.delayed,
      severity: !posR.exists ? 'P1' : yesterdayTotal > 0 ? 'P3' : 'P1',
      owner_role: '实施人员',
      impact_modules: ['经营诊断', '老板日报', '营销归因'],
      impact_description: yesterdayTotal > 0 ? '昨日订单已同步，可生成昨日经营判断。' : '昨日 POS 数据未同步，会导致经营诊断无法判断昨日营业额变化，也会影响客户回店订单归因。',
      suggestion: '请实施人员检查 POS 同步状态，或由门店补传昨日订单数据。',
      evidence: { ...(posR.evidence || {}), yesterday, yesterday_order_count: yesterdayTotal, latest_sync_time: pos.latest_date || null, seven_day_avg_order_count: Math.round(posTotal / 7) },
    }),
    issue({
      category: '数据接入',
      item_key: 'customer_phone_match_rate',
      item_name: 'POS 订单客户识别率是否足够',
      status: !posR.exists ? STATUS.pending : phoneRate >= 60 ? STATUS.ok : STATUS.abnormal,
      severity: phoneRate >= 60 ? 'P3' : 'P1',
      owner_role: '实施人员',
      impact_modules: ['客户资产报告', '自动营销', '营销归因'],
      impact_description: phoneRate >= 60 ? 'POS 订单里的手机号、会员 ID 或顾客标识可支持基础客户识别。' : '系统根据 POS 订单中的手机号、会员 ID 或顾客标识识别顾客。如果订单缺少这些字段，客户资产分析、复购判断和营销归因会不完整。这不一定是门店错误，需要租赁方确认 POS 是否提供相关字段，或确认门店是否有会员手机号采集流程。',
      suggestion: '请租赁方确认 POS 导出的订单是否包含手机号、会员 ID 或顾客标识；如 POS 已提供字段，请我方协助核对导入映射。',
      evidence: { ...(posR.evidence || {}), phone_match_rate: phoneRate, rows_with_phone: n(pos.rows_with_phone), phone_rows: n(pos.phone_rows) },
    }),
    issue({
      category: '数据接入',
      item_key: 'dish_data_complete',
      item_name: '菜品数据是否完整',
      status: !posR.exists ? STATUS.pending : dishRate >= 60 ? STATUS.ok : STATUS.abnormal,
      severity: dishRate >= 60 ? 'P3' : 'P3',
      owner_role: '实施人员',
      impact_modules: ['经营诊断', '月度复盘'],
      impact_description: dishRate >= 60 ? '菜品分类可支持基础菜品分析。' : '菜品分类不完整会影响菜品结构、毛利和复盘分析。',
      suggestion: '请补齐菜品分类、别名和门店菜品映射。',
      evidence: { ...(posR.evidence || {}), dish_rate: dishRate, dish_rows: n(pos.dish_rows), categorized_dish_rows: n(pos.categorized_dish_rows) },
    }),
    issue({
      category: '数据新鲜度',
      item_key: 'customer_data_updated',
      item_name: '会员 / 客户数据是否更新',
      status: customerR.exists || customerOpsR.exists ? (customerTotal > 0 ? STATUS.ok : STATUS.missing) : STATUS.pending,
      severity: customerTotal > 0 ? 'P3' : 'P0',
      owner_role: '实施人员',
      impact_modules: ['客户资产报告', '自动营销'],
      impact_description: customerTotal > 0 ? '客户数据已接入，可支持客户资产分析。' : '客户数据为空时，客户资产报告和自动营销无法运转。',
      suggestion: '请导入会员、客户或客户运营原始记录，并保持定期更新。',
      evidence: { ...(customerR.evidence || customerOpsR.evidence || {}), growth_customer_profiles_exists: customerR.exists, customer_ops_exists: customerOpsR.exists, customer_count: customerTotal, customer_updated_7d: n(customers.updated_7d) || n(customerOpsR.rows?.[0]?.updated_7d) },
    }),
  ];
}

async function checkMarketing(pool, ctx) {
  const [profilesR, deliveryR, redemptionsR, attrR] = await Promise.all([
    queryIfTable(pool, 'growth_customer_profiles', `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE COALESCE(lifecycle_stage,'')<>'' OR COALESCE(value_tier,'')<>'')::int AS segmented FROM growth_customer_profiles WHERE tenant_id=$1`, [ctx.tenantId]),
    queryIfTable(pool, 'growth_delivery_logs', `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status IN ('sent','success','delivered'))::int AS sent FROM growth_delivery_logs WHERE tenant_id=$1`, [ctx.tenantId]),
    queryIfTable(pool, 'growth_redemptions', `SELECT COUNT(*)::int AS total FROM growth_redemptions WHERE tenant_id=$1`, [ctx.tenantId]),
    queryIfTable(pool, 'growth_ontology_attributions', `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE COALESCE(related_order_id,'')<>'')::int AS linked_orders FROM growth_ontology_attributions WHERE tenant_id=$1`, [ctx.tenantId]),
  ]);
  const profiles = profilesR.rows?.[0] || {};
  const delivery = deliveryR.rows?.[0] || {};
  const redemptions = redemptionsR.rows?.[0] || {};
  const attr = attrR.rows?.[0] || {};
  return [
    issue({ category: 'AI 可运行度', item_key: 'customer_segments_generatable', item_name: '客户分层是否可生成', status: !profilesR.exists ? STATUS.pending : n(profiles.segmented) > 0 ? STATUS.ok : STATUS.missing, severity: n(profiles.segmented) > 0 ? 'P3' : 'P2', owner_role: '系统', impact_modules: ['客户资产报告', '自动营销'], impact_description: '客户分层决定自动营销能否按价值、流失风险和回店周期生成名单。', suggestion: '请先同步客户画像并运行客户分层。', evidence: { ...(profilesR.evidence || {}), customer_count: n(profiles.total), segmented_count: n(profiles.segmented) } }),
    issue({ category: '营销归因', item_key: 'marketing_list_non_empty', item_name: '营销名单是否为空', status: !profilesR.exists ? STATUS.pending : n(profiles.total) > 0 ? STATUS.ok : STATUS.missing, severity: n(profiles.total) > 0 ? 'P3' : 'P1', owner_role: '实施人员', impact_modules: ['自动营销'], impact_description: '营销名单为空时，自动触达无法发起。', suggestion: '请检查客户画像、营销规则和名单生成条件。', evidence: { ...(profilesR.evidence || {}), customer_count: n(profiles.total) } }),
    issue({ category: '营销归因', item_key: 'sms_wecom_sent', item_name: '短信 / 企微是否有发送记录', status: !deliveryR.exists ? STATUS.pending : n(delivery.sent) > 0 ? STATUS.ok : STATUS.missing, severity: n(delivery.sent) > 0 ? 'P3' : 'P1', owner_role: '实施人员', impact_modules: ['自动营销', '营销归因'], impact_description: '没有发送记录时，系统无法判断触达是否发生，也无法做转化归因。', suggestion: '请检查 growth_delivery_logs、短信和企微发送配置。', evidence: { ...(deliveryR.evidence || {}), delivery_total: n(delivery.total), delivery_sent: n(delivery.sent) } }),
    issue({ category: '营销归因', item_key: 'coupon_issue_redeem_data', item_name: '优惠券是否有发放和核销数据', status: !redemptionsR.exists ? STATUS.pending : n(redemptions.total) > 0 ? STATUS.ok : STATUS.missing, severity: n(redemptions.total) > 0 ? 'P3' : 'P1', owner_role: '实施人员', impact_modules: ['自动营销', '营销归因'], impact_description: '优惠券核销缺失会导致营销 ROI 和活动复盘不准确。', suggestion: '请检查券发放、核销同步，以及优惠券是否能和营销活动、回店订单对应起来。', evidence: { ...(redemptionsR.evidence || {}), coupon_writeoff_count: n(redemptions.total) } }),
    issue({ category: '营销归因', item_key: 'attribution_links_orders', item_name: '营销活动是否能识别回店订单', status: !attrR.exists ? STATUS.pending : n(attr.linked_orders) > 0 ? STATUS.ok : STATUS.missing, severity: n(attr.linked_orders) > 0 ? 'P3' : 'P1', owner_role: '系统', impact_modules: ['营销归因', '月度复盘'], impact_description: '系统需要根据营销触达记录、客户识别信息、回店订单和优惠券核销数据，判断营销活动带来了哪些回店消费。当前回店订单识别不足，营销效果和月度复盘中的营销部分会不完整。', suggestion: '请先确认营销触达记录、POS 订单客户识别字段和优惠券核销数据是否完整；数据齐全后可重新计算归因。', evidence: { ...(attrR.evidence || {}), attribution_order_count: n(attr.linked_orders), attribution_total: n(attr.total) } }),
  ];
}

async function checkTaskClosedLoop(pool, ctx, stores = []) {
  const storeValues = storeFilterValues(ctx, stores);
  const storePatterns = storeFilterPatterns(storeValues);
  const taskR = await queryIfTable(
    pool,
    'master_tasks',
    `SELECT COUNT(*)::int AS total,
            COUNT(*)::int AS generated,
            COUNT(*) FILTER (WHERE status IN ('pending_response','pending_review','resolved','settled','closed','hr_filed'))::int AS confirmed,
            COUNT(*) FILTER (WHERE status IN ('resolved','settled','closed','hr_filed'))::int AS executed,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','settled','closed','hr_filed') AND COALESCE(timeout_at, dispatched_at + INTERVAL '1 day') < NOW())::int AS overdue,
            COUNT(*) FILTER (WHERE review_result <> '{}'::jsonb OR status IN ('resolved','settled','closed','hr_filed'))::int AS reviewed
       FROM master_tasks
      WHERE tenant_id=$1 AND ($2::text[] IS NULL OR store = ANY($2::text[]) OR store ILIKE ANY($3::text[]) OR source_data->>'store_id' = ANY($2::text[]))`,
    [ctx.tenantId, storeValues.length ? storeValues : null, storePatterns.length ? storePatterns : null]
  );
  const t = taskR.rows?.[0] || {};
  return [
    issue({ category: '任务闭环', item_key: 'ai_tasks_generated', item_name: 'AI 运营建议是否已生成', status: !taskR.exists ? STATUS.pending : n(t.generated) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.generated) > 0 ? 'P3' : 'P2', owner_role: '系统', impact_modules: ['任务闭环'], impact_description: '没有 AI 运营建议时，系统只能发现问题，不能形成后续跟进记录。', suggestion: '请检查运营建议生成链路和 Agent 调度是否正常。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_generated_count: n(t.generated) } }),
    issue({ category: '任务闭环', item_key: 'manager_confirmed_tasks', item_name: '门店负责人是否确认运营建议', status: !taskR.exists ? STATUS.pending : n(t.confirmed) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.confirmed) > 0 ? 'P3' : 'P2', owner_role: '店长', impact_modules: ['任务闭环'], impact_description: '门店负责人未确认运营建议会导致后续动作没有责任承接。', suggestion: '请租赁方安排门店负责人确认待处理运营建议。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_confirmed_count: n(t.confirmed) } }),
    issue({ category: '任务闭环', item_key: 'employees_executed_tasks', item_name: '员工是否反馈执行结果', status: !taskR.exists ? STATUS.pending : n(t.executed) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.executed) > 0 ? 'P3' : 'P2', owner_role: '员工', impact_modules: ['任务闭环', '绩效评估'], impact_description: '执行结果缺失会影响闭环、复盘和绩效判定。', suggestion: '请租赁方补充执行结果、照片或文字说明。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_executed_count: n(t.executed) } }),
    issue({ category: '任务闭环', item_key: 'overdue_tasks_exist', item_name: '是否存在逾期未完成事项', status: !taskR.exists ? STATUS.pending : n(t.overdue) > 0 ? STATUS.abnormal : STATUS.ok, severity: n(t.overdue) > 0 ? 'P2' : 'P3', owner_role: '店长', impact_modules: ['任务闭环', '老板日报'], impact_description: '逾期事项会导致系统判断门店动作未完成，影响老板日报和复盘结论。', suggestion: '请租赁方优先处理逾期事项，必要时由我方协助说明处理口径。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_overdue_count: n(t.overdue) } }),
    issue({ category: '任务闭环', item_key: 'execution_review_records', item_name: '是否有执行结果和复核记录', status: !taskR.exists ? STATUS.pending : n(t.reviewed) > 0 ? STATUS.ok : STATUS.missing, severity: n(t.reviewed) > 0 ? 'P3' : 'P1', owner_role: '系统', impact_modules: ['任务闭环', '绩效评估'], impact_description: '执行结果未回传会导致事项是否有效无法判断，也影响绩效评估。', suggestion: '请检查执行结果回传、复核流程和运营记录是否完整。', evidence: { ...(taskR.evidence || {}), task_total: n(t.total), task_reviewed_count: n(t.reviewed) } }),
  ];
}

export function calculateHealthScore(items) {
  const deductions = (items || [])
    .filter((item) => item.status !== STATUS.ok)
    .map((item) => ({
      item_key: item.item_key,
      item_name: item.item_name,
      severity: item.severity,
      deduction: SEVERITY_DEDUCTION[item.severity] || 0,
      reason: `${item.severity} ${item.item_name}: ${item.impact_description}`,
      category: item.category,
    }));
  const totalDeduction = deductions.reduce((sum, d) => sum + d.deduction, 0);
  const health_score = Math.max(0, 100 - totalDeduction);
  const scoreCategory = (category) => {
    const sub = (items || []).filter((item) => item.category === category);
    const bad = sub.filter((item) => item.status !== STATUS.ok).reduce((sum, item) => sum + (SEVERITY_DEDUCTION[item.severity] || 0), 0);
    return Math.max(0, Math.min(100, 100 - bad));
  };
  const baseScore = scoreCategory('基础配置');
  const integrationScore = scoreCategory('数据接入');
  return {
    health_score,
    risk_level: riskLevel(health_score),
    data_completeness: Math.round((baseScore + integrationScore) / 2),
    data_freshness: scoreCategory('数据新鲜度'),
    task_completion_rate: scoreCategory('任务闭环'),
    ai_runnable_rate: scoreCategory('AI 可运行度'),
    attribution_completeness: scoreCategory('营销归因'),
    deductions,
  };
}

function topIssues(items, limit = 3) {
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (items || [])
    .filter((item) => item.status !== STATUS.ok)
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.item_name,
      severity: item.severity,
      impact_modules: item.impact_modules,
      owner_role: item.owner_role,
      suggestion: item.suggestion,
      can_generate_task: item.can_generate_task,
    }));
}

function categoryStats(items) {
  const by = new Map();
  for (const item of items || []) {
    const key = item.category || '未分类';
    if (!by.has(key)) by.set(key, { category: key, ok_count: 0, abnormal_count: 0, missing_count: 0, delayed_count: 0, pending_count: 0, p0_count: 0, p1_count: 0, p2_count: 0, p3_count: 0, total: 0, ok_rate: 0 });
    const row = by.get(key);
    row.total += 1;
    if (item.status === STATUS.ok) row.ok_count += 1;
    else if (item.status === STATUS.missing) row.missing_count += 1;
    else if (item.status === STATUS.delayed) row.delayed_count += 1;
    else if (item.status === STATUS.pending) row.pending_count += 1;
    else row.abnormal_count += 1;
    const sev = String(item.severity || '').toLowerCase() + '_count';
    if (Object.prototype.hasOwnProperty.call(row, sev)) row[sev] += 1;
  }
  return Array.from(by.values()).map((row) => ({ ...row, ok_rate: pct(row.ok_count, row.total) }));
}

function initializationStatus(items, stores) {
  const byKey = Object.fromEntries((items || []).map((item) => [item.item_key, item]));
  const required = [];
  const missingStores = !stores?.length || byKey.tenant_has_stores?.status !== STATUS.ok;
  const posBlocked = byKey.pos_data_connected?.status !== STATUS.ok;
  const customerBlocked = byKey.customer_data_updated?.status !== STATUS.ok;
  if (missingStores) required.push('先创建门店并补齐门店名称、编码和基础资料');
  if (posBlocked) required.push('接入 POS 订单明细，至少同步最近 1 天真实订单');
  if (customerBlocked) required.push('导入会员 / 客户数据，确保客户资产和自动营销有名单');
  if (missingStores) return { inspection_status: 'not_initialized', initialization_required: required };
  if (posBlocked || customerBlocked) return { inspection_status: 'pending_integration', initialization_required: required };
  return { inspection_status: 'completed', initialization_required: [] };
}

function featureAvailability(items) {
  return MODULES.map((feature) => {
    const blockers = (items || []).filter((item) => item.status !== STATUS.ok && (item.impact_modules || []).includes(feature));
    if (feature === '月度复盘') {
      const businessBlocked = blockers.some((item) => ['数据接入', '数据新鲜度'].includes(item.category) && ['P0', 'P1'].includes(item.severity));
      const attributionBlocked = blockers.some((item) => item.category === '营销归因');
      const status = businessBlocked ? '暂不可生成' : attributionBlocked ? '部分不完整' : blockers.length ? '部分不完整' : '可用';
      return {
        feature,
        status,
        blocked_by: blockers.map((item) => ({ id: item.id, item_key: item.item_key, title: item.item_name, severity: item.severity })),
        reason: status === '部分不完整' ? '月度复盘可以生成经营部分，但营销效果部分暂时不完整。' : status === '暂不可生成' ? '核心经营数据缺失，月度复盘暂不可生成。' : '月度复盘具备当前阶段的基础运行条件。',
        suggestion: blockers[0]?.suggestion || '保持经营数据、营销数据和任务结果持续同步。',
      };
    }
    const hard = blockers.filter((item) => ['P0', 'P1'].includes(item.severity));
    const status = blockers.length === 0 ? '可用' : hard.length ? '不可用' : blockers.some((item) => item.status === STATUS.pending) ? '待配置' : '部分可用';
    const reason = blockers.length
      ? `${feature}受${blockers.slice(0, 2).map((x) => x.item_name).join('、')}影响，老板看到的结果可能不完整或不准确。`
      : `${feature}具备当前阶段的基础运行条件。`;
    return {
      feature,
      status,
      blocked_by: blockers.map((item) => ({ id: item.id, item_key: item.item_key, title: item.item_name, severity: item.severity })),
      reason,
      suggestion: blockers[0]?.suggestion || '保持当前数据同步和任务闭环节奏。',
    };
  });
}

function todayPriorities(items, limit = 5) {
  const severityWeight = { P0: 100, P1: 70, P2: 35, P3: 10 };
  return (items || [])
    .filter((item) => item.status !== STATUS.ok)
    .map((item) => {
      const modules = item.impact_modules || [];
      const core = modules.some((m) => ['经营诊断', '客户资产报告', '自动营销', '营销归因', '老板日报'].includes(m));
      return { item, score: (severityWeight[item.severity] || 0) + modules.length * 8 + (core ? 25 : 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => ({
      id: item.id,
      title: item.item_name,
      severity: item.severity,
      impact_modules: item.impact_modules || [],
      responsible_party: item.responsible_party,
      responsible_party_label: item.responsible_party_label || RESPONSIBLE_PARTY_LABELS[item.responsible_party] || item.owner_role,
      owner_role: item.owner_role,
      suggestion: item.suggestion,
      can_generate_task: item.can_generate_task,
      generated_task_id: item.generated_task_id || null,
    }));
}

function operationStage(items) {
  const byKey = Object.fromEntries((items || []).map((item) => [item.item_key, item]));
  if (byKey.tenant_has_stores?.status !== STATUS.ok || byKey.pos_data_connected?.status !== STATUS.ok || byKey.customer_data_updated?.status !== STATUS.ok) {
    return {
      operation_stage: 'initialization',
      operation_stage_label: '初始化阶段',
      stage_message: '当前重点是先完成基础配置和核心数据接入，否则健康分、日报和 AI 报告都没有真实依据。',
    };
  }
  const taskBlocked = (items || []).some((item) => item.category === '任务闭环' && item.status !== STATUS.ok);
  const freshnessBlocked = (items || []).some((item) => item.category === '数据新鲜度' && item.status !== STATUS.ok);
  if (taskBlocked || freshnessBlocked) {
    return {
      operation_stage: 'trial',
      operation_stage_label: '30 天试跑阶段',
      stage_message: '当前重点是稳定每日数据同步、任务执行和老板日报完整度，让系统连续跑起来。',
    };
  }
  return {
    operation_stage: 'active',
    operation_stage_label: '正式运营阶段',
    stage_message: '当前重点可以转向增长归因、复购提升和月度复盘，用数据推动下一轮运营动作。',
  };
}

function customerSuccessRisk(score, items) {
  const p0p1 = (items || []).filter((item) => item.status !== STATUS.ok && ['P0', 'P1'].includes(item.severity));
  const taskBad = (items || []).some((item) => item.category === '任务闭环' && item.status !== STATUS.ok && ['P1', 'P2'].includes(item.severity));
  const attrBad = (items || []).some((item) => item.category === '营销归因' && item.status !== STATUS.ok && ['P1', 'P2'].includes(item.severity));
  const dailyBad = (items || []).some((item) => item.impact_modules?.includes('老板日报') && item.status !== STATUS.ok);
  const reasons = [];
  if (score.health_score != null && score.health_score < 60) reasons.push('健康分连续处于低位风险区间');
  if (p0p1.length) reasons.push(`仍有 ${p0p1.length} 个 P0/P1 阻塞未处理`);
  if (taskBad) reasons.push('任务执行或审核闭环不足');
  if (attrBad) reasons.push('自动营销归因无法稳定生成');
  if (dailyBad) reasons.push('老板日报依赖的数据或任务结果不完整');
  const level = p0p1.length >= 2 || (score.health_score != null && score.health_score < 60) ? 'high' : reasons.length ? 'medium' : 'low';
  return { customer_success_risk: level, customer_success_risk_label: level === 'high' ? '高' : level === 'medium' ? '中' : '低', customer_success_risk_reasons: reasons.length ? reasons : ['核心数据和任务闭环当前没有明显托管交付阻塞'] };
}

function buildOverview(score, items, stores) {
  const init = initializationStatus(items, stores);
  const stage = operationStage(items);
  const effectiveScore = init.inspection_status === 'completed' ? score.health_score : null;
  const effectiveRisk = init.inspection_status === 'completed' ? score.risk_level : init.inspection_status === 'not_initialized' ? '初始化未完成' : '待接入';
  const overview = {
    ...score,
    health_score: effectiveScore,
    raw_health_score: score.health_score,
    risk_level: effectiveRisk,
    ...init,
    ...stage,
    category_stats: categoryStats(items),
    feature_availability: featureAvailability(items),
    today_priorities: todayPriorities(items),
    top_issues: topIssues(items, 5),
  };
  return { ...overview, ...customerSuccessRisk(overview, items) };
}

function buildStoreResults(stores, items) {
  const baseStores = stores.length ? stores : [{ store_id: '', store_name: '全部门店' }];
  return baseStores.map((store) => {
    const sub = items.filter((item) => !item.store_id || item.store_id === store.store_id || item.store_name === store.store_name);
    const score = calculateHealthScore(sub);
    const risk = topIssues(sub, 1)[0];
    return {
      store_id: store.store_id || '',
      store_name: store.store_name || store.store_id || '全部门店',
      health_score: score.health_score,
      risk_level: score.risk_level,
      data_status: sub.some((i) => ['数据接入', '数据新鲜度'].includes(i.category) && i.status !== STATUS.ok) ? '需处理' : '正常',
      task_status: sub.some((i) => i.category === '任务闭环' && i.status !== STATUS.ok) ? '需处理' : '正常',
      ai_report_status: sub.some((i) => i.category === 'AI 可运行度' && i.status !== STATUS.ok) ? '受影响' : '可运行',
      attribution_status: sub.some((i) => i.category === '营销归因' && i.status !== STATUS.ok) ? '不完整' : '完整',
      main_risk: risk?.title || '暂无主要风险',
      abnormal_items: sub.filter((item) => item.status !== STATUS.ok).length,
    };
  });
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
    console.warn('[tenant-inspection] persist run failed:', e?.message || e);
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
      console.warn('[tenant-inspection] persist item failed:', e?.message || e);
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
  let overview = buildOverview(score, items, stores);
  items = await persistRun(pool, ctx, overview, items);
  overview = buildOverview(score, items, stores);
  return { ok: true, tenant_id: ctx.tenantId, store_id: ctx.storeId, date: ctx.date, overview, top_issues: overview.top_issues, store_results: buildStoreResults(stores, items), items };
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

export function generateInspectionReport({ tenantId, overview, store_results = [], items = [] }) {
  const top = overview?.top_issues || topIssues(items);
  const affected = Array.from(new Set((items || []).flatMap((item) => item.status !== STATUS.ok ? item.impact_modules || [] : [])));
  const worstStores = (store_results || []).filter((s) => s.health_score < 90).slice(0, 5);
  const storeNames = Array.from(new Set((items || []).map((item) => item.store_name).filter(Boolean)));
  const storeScope = storeNames.length === 1 ? storeNames[0] : storeNames.length > 1 ? storeNames.join('、') : '全部门店';
  const scoreText = overview?.health_score == null ? (overview?.risk_level || '初始化未完成') : `健康分 ${overview.health_score} 分`;
  const summary = `本次检测范围：${storeScope}。当前租户系统${scoreText}。主要问题是${top.map((x) => x.title).join('、') || '暂无关键阻塞'}，会影响${affected.slice(0, 4).join('、') || '核心运营模块'}。`;
  const badItems = (items || []).filter((item) => item.status !== STATUS.ok);
  const itemToReport = (item) => ({
    item_name: item.item_name,
    store_name: item.store_name || storeScope || '全部门店',
    impact_modules: item.impact_modules || [],
    status: item.status,
    severity: item.severity,
    problem_description: item.impact_description || '',
    suggested_arrangement: item.responsible_party === 'platform_team' || item.responsible_party === 'system_integration' ? '我方系统实施人员协助说明，租赁方配合确认数据来源' : '租赁方安排系统管理员或门店负责人',
    suggested_deadline: ['P0', 'P1'].includes(item.severity) ? '建议 3 天内完成' : '建议 7 天内完成',
    rectification_suggestion: item.suggestion || '',
    evidence_summary: Object.entries(item.evidence || {})
      .filter(([k]) => !['table_exists'].includes(k))
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('；'),
    include_in_report: true,
  });
  const tenantRectificationItems = badItems
    .filter((item) => !['platform_team', 'system_integration'].includes(item.responsible_party))
    .map(itemToReport);
  const platformNotes = badItems
    .filter((item) => ['platform_team', 'system_integration'].includes(item.responsible_party))
    .map((item) => ({
      problem: item.item_name,
      impact: item.impact_description || '',
      suggestion: item.suggestion || '',
      tenant_cooperation: '请租赁方确认数据源、字段导出或业务采集流程是否具备。',
      impact_modules: item.impact_modules || [],
    }));
  return {
    tenant_id: tenantId,
    report_title: '租户运营整改报告',
    store_scope: storeScope,
    summary,
    top_risks: top,
    affected_modules: affected,
    tenant_rectification_items: tenantRectificationItems,
    platform_notes: platformNotes,
    data_gap_impact: badItems
      .filter((item) => ['数据接入', '数据新鲜度', '营销归因'].includes(item.category))
      .map((item) => `${item.item_name}会影响${(item.impact_modules || []).join('、') || '相关报告'}，导致对应判断不完整。`),
    next_recheck_suggestion: '建议租赁方完成以上整改后，在 3 天内重新运行检测。',
    store_status: worstStores.length ? worstStores : store_results,
    ai_conclusion: summary,
    system_health: overview?.health_score == null ? '当前租户尚未完成初始化，先不要用 0 分判断经营风险。' : (overview?.health_score ?? 0) >= 75 ? '当前租户系统基本可运转，但仍需处理影响准确性的项目。' : '当前租户系统存在明显运转风险，需要先处理数据和任务闭环问题。',
    blocking_issues: top.map((x) => `${x.title}：${x.suggestion}`),
    stores_missing_actions: worstStores.map((s) => `${s.store_name}：${s.main_risk}`),
    inaccurate_ai_features: affected.filter((m) => ['经营诊断', '客户资产报告', '自动营销', '营销归因', '老板日报'].includes(m)),
    next_actions: [...tenantRectificationItems.map((x) => x.rectification_suggestion), ...platformNotes.map((x) => x.suggestion)].filter(Boolean).slice(0, 5),
  };
}

export async function generateRecoveryTask(pool, { item, itemId } = {}) {
  return { ok: false, deprecated: true, message: '当前版本已取消门店任务派发，请使用导出整改报告流程。' };
}

function normalizeSeverityFilter(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return ['P0', 'P1'];
  if (raw.includes(',')) return raw.split(',').map((x) => x.trim()).filter(Boolean);
  return [raw];
}

export async function generateRecoveryTasksBatch(pool, opts = {}) {
  return { ok: false, deprecated: true, message: '当前版本已取消门店任务派发，请使用导出整改报告流程。' };
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

export async function saveInspectionReport(pool, { tenantId = 'default', runId = null, report = {} } = {}) {
  const r = await pool.query(
    `INSERT INTO tenant_operation_inspection_reports
      (tenant_id, run_id, report_title, report_status, summary, affected_modules, tenant_rectification_items, platform_notes, next_recheck_suggestion, store_scope)
     VALUES ($1,$2,$3,'generated',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)
     RETURNING *`,
    [
      tenantId,
      runId,
      report.report_title || '租户运营整改报告',
      report.summary || '',
      JSON.stringify(report.affected_modules || []),
      JSON.stringify(report.tenant_rectification_items || []),
      JSON.stringify(report.platform_notes || []),
      report.next_recheck_suggestion || '建议租赁方完成整改后，在 3 天内重新运行检测。',
      report.store_scope || '全部门店',
    ]
  );
  return { ok: true, report: r.rows?.[0] || null };
}

export async function listInspectionReports(pool, opts = {}) {
  const tenantId = String(opts.tenantId || opts.tenant_id || 'default').trim() || 'default';
  const r = await queryIfTable(
    pool,
    'tenant_operation_inspection_reports',
    `SELECT id, tenant_id, run_id, report_title, report_status, summary, affected_modules, store_scope,
            tenant_rectification_items, platform_notes, next_recheck_suggestion, pdf_file_url, sent_at, created_at, updated_at
       FROM tenant_operation_inspection_reports
      WHERE tenant_id=$1
      ORDER BY created_at DESC, id DESC
      LIMIT 50`,
    [tenantId]
  );
  return r.exists ? r.rows : [];
}

export async function markInspectionReportSent(pool, { reportId, tenantId = 'default' } = {}) {
  const r = await pool.query(
    `UPDATE tenant_operation_inspection_reports
        SET report_status='sent', sent_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND tenant_id=$2
      RETURNING id, report_status, sent_at`,
    [reportId, tenantId]
  );
  return {
    ok: !!r.rows?.length,
    report: r.rows?.[0] || null,
    delivery_performed: false,
    message: '已记录为已发送；当前版本未配置自动发送渠道，请导出报告后自行发送给租赁方。',
  };
}

function stripTechnicalText(value) {
  return String(value || '')
    .replace(/ontology/ig, '归因计算')
    .replace(/customer_id/ig, '顾客标识')
    .replace(/campaign_id/ig, '营销活动标识')
    .replace(/coupon_id/ig, '优惠券标识')
    .replace(/master_tasks/ig, '系统任务记录')
    .replace(/generated_task_id/ig, '已生成记录');
}

export function buildInspectionReportHtml(report = {}, meta = {}) {
  const esc = (v) => stripTechnicalText(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rows = (arr, cols) => (arr || []).map((x) => `<tr>${cols.map(([k]) => `<td>${esc(Array.isArray(x[k]) ? x[k].join('、') : x[k] || '-')}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>租户运营整改报告</title><style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;margin:32px;line-height:1.6}
  h1{font-size:30px;margin:0 0 8px} h2{font-size:18px;margin:28px 0 10px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
  .muted{color:#6b7280}.cover{background:#111827;color:white;border-radius:18px;padding:28px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.kpi{border:1px solid #e5e7eb;border-radius:12px;padding:12px}
  table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #e5e7eb;text-align:left;padding:8px;vertical-align:top}th{background:#f9fafb}
  </style></head><body>
  <div class="cover"><h1>租户运营整改报告</h1><div>租户：${esc(meta.tenantName || report.tenant_id || '-')}</div><div>检测日期：${esc(meta.date || '')}</div><div>报告生成时间：${esc(new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</div></div>
  <div class="grid"><div class="kpi"><b>系统运行状态</b><br>${esc(meta.riskLevel || '-')}</div><div class="kpi"><b>健康分</b><br>${esc(meta.healthScore ?? '-')}</div><div class="kpi"><b>报告状态</b><br>${esc(report.report_status || 'generated')}</div><div class="kpi"><b>下次复检</b><br>整改后 3 天内</div></div>
  <h2>本次检测结论</h2><p>${esc(report.summary || '')}</p>
  <h2>核心影响</h2><p>${esc((report.affected_modules || []).join('、') || '-')}</p>
  <h2>需要租赁方安排整改的事项</h2><table><thead><tr><th>整改事项</th><th>涉及门店</th><th>影响功能</th><th>问题说明</th><th>建议安排对象</th><th>建议完成时间</th><th>整改建议</th></tr></thead><tbody>${rows(report.tenant_rectification_items || [], [['item_name'],['store_name'],['impact_modules'],['problem_description'],['suggested_arrangement'],['suggested_deadline'],['rectification_suggestion']])}</tbody></table>
  <h2>我方说明 / 协助事项</h2><table><thead><tr><th>问题</th><th>影响</th><th>我方建议</th><th>需要租赁方配合什么</th></tr></thead><tbody>${rows(report.platform_notes || [], [['problem'],['impact'],['suggestion'],['tenant_cooperation']])}</tbody></table>
  <h2>数据缺失造成的影响说明</h2><ul>${(report.data_gap_impact || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>-</li>'}</ul>
  <h2>下次复检建议</h2><p>${esc(report.next_recheck_suggestion || '建议租赁方完成以上整改后，在 3 天内重新运行检测。')}</p>
  </body></html>`;
}
