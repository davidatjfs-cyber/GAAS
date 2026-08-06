import path from 'path';
import { storeNameToId } from './brands-config.js';
import { SHARED_TABLES } from '@gaas/shared';
import { createBuildAttributionReport } from './domains/customer-ops/attribution-report.js';
import { childLogger } from './utils/logger.js';
import {
  cleanText,
  resolveCustomerOpsStoreFilter,
  safeReportQuery,
  runCampaignReportPdfGenerator,
  syncAutoCampaignsFromDeliveryLogs,
} from './domains/customer-ops/ops-helpers.js';
import { registerCustomerOpsReportCampaignRoutes } from './domains/customer-ops/report-campaign-routes.js';
import { registerCustomerOpsDiagnosisRoutes } from './domains/customer-ops/diagnosis-routes.js';
import { registerCustomerOpsCustomerRoutes } from './domains/customer-ops/customer-routes.js';
import { registerCustomerOpsSegmentOutreachRoutes } from './domains/customer-ops/segment-outreach-routes.js';

const log = childLogger({ domain: 'customer-ops', handler: 'service' });

/** Listen-time ensure* stays here (not under domains/) — B5 freeze gate. */
async function ensureCustomerOpsTables(pool) {
  // 2026-08-06：本文件的用户名列（username / created_by）必须建成 CITEXT，与 migration 184
  // 保持一致——否则同一个人会因为写入方大小写不一致被拆成两个身份。
  // 这里需要显式确保扩展存在：本文件是 **listen-time 建表**，在"先跑 migration 再启动"的
  // 环境（CI/新库）里，这几张表是在 184 跑完之后才被创建的，184 扫不到它们，
  // 它们不会被自动转换——CI 实测正是 customer_ops_diagnoses.created_by /
  // customer_segments.created_by 两列漏网打红了 username-citext-gate。
  // 闸门：server/test/integration/username-citext-gate.test.mjs
  await pool.query(`CREATE EXTENSION IF NOT EXISTS citext`);
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_ops_diagnoses (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', store_name TEXT, source_filename TEXT, report_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_by CITEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_diag_tenant_created ON customer_ops_diagnoses (tenant_id, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_ops_profiles (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', diagnosis_id BIGINT REFERENCES customer_ops_diagnoses(id) ON DELETE CASCADE, customer_id TEXT, customer_key TEXT, phone TEXT, profile_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_profiles_diag ON customer_ops_profiles (tenant_id, diagnosis_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_profiles_phone ON customer_ops_profiles (tenant_id, phone) WHERE phone IS NOT NULL AND phone <> ''`);
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_ops_source_records (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', diagnosis_id BIGINT REFERENCES customer_ops_diagnoses(id) ON DELETE CASCADE, source_filename TEXT, record_key TEXT NOT NULL, phone TEXT, member_no TEXT, record_kind TEXT, record_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, record_key))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_source_tenant_kind ON customer_ops_source_records (tenant_id, record_kind, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_source_phone ON customer_ops_source_records (tenant_id, phone) WHERE phone IS NOT NULL AND phone <> ''`);

  // 模块2：自定义客群分层
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_segments (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', name TEXT NOT NULL, criteria_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_by CITEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_segments_tenant ON customer_segments (tenant_id, created_at DESC)`);

  // 模块3：营销活动台账
  // marketing_campaigns在本模块之前就已存在(更早的老版本"维护导航舱"用的是
  // start_date/target_metric等字段)，CREATE TABLE IF NOT EXISTS对已存在的老表是空操作，
  // 不会补上下面这些新字段——历史上这个缺口只在生产库上手动ALTER过、未进代码，
  // 新环境(比如全新客户/demo)首次启动就会在下一行CREATE INDEX时因缺列报错。
  // 这里显式补齐，保证无论老表(缺列)还是全新库(建表已含全部列)都能正常往下走。
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_campaigns (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', title TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'offline', campaign_type TEXT DEFAULT '其他', status TEXT NOT NULL DEFAULT 'planned', planned_date DATE, planned_end_date DATE, store_ids JSONB DEFAULT '[]'::jsonb, target_audience TEXT DEFAULT '', target_count INT DEFAULT 0, content TEXT DEFAULT '', goal TEXT DEFAULT '', budget NUMERIC DEFAULT 0, reminder_date DATE, source TEXT DEFAULT 'manual', created_by CITEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'offline'`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS campaign_type TEXT DEFAULT '其他'`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS planned_date DATE`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS planned_end_date DATE`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS store_ids JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS target_audience TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS target_count INT DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS content TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS goal TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS budget NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS reminder_date DATE`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  // status约束的'in_progress'取值是生产历史上手动加的、从未进过代码；这里用DROP+ADD
  // 保证幂等，同时覆盖老库(约束缺in_progress)和全新库(约束还不存在)两种情况。
  await pool.query(`ALTER TABLE marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_status_check`);
  await pool.query(`ALTER TABLE marketing_campaigns ADD CONSTRAINT marketing_campaigns_status_check CHECK (status = ANY (ARRAY['planned'::text, 'active'::text, 'in_progress'::text, 'paused'::text, 'completed'::text, 'cancelled'::text]))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant ON marketing_campaigns (tenant_id, planned_date DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_campaign_results (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', campaign_id BIGINT REFERENCES marketing_campaigns(id) ON DELETE CASCADE, store_id TEXT NOT NULL DEFAULT '', store_name TEXT DEFAULT '', actual_send_count INT DEFAULT 0, actual_reach_count INT DEFAULT 0, actual_conversion_count INT DEFAULT 0, actual_revenue NUMERIC DEFAULT 0, result_note TEXT DEFAULT '', recorded_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mkt_campaign_results ON marketing_campaign_results (tenant_id, campaign_id)`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS actual_exposure_count INT DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS actual_redemption_count INT DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS actual_cost NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS effect_rating TEXT DEFAULT ''`);

  await pool.query(`CREATE TABLE IF NOT EXISTS anomaly_triggers (id SERIAL PRIMARY KEY, anomaly_key TEXT NOT NULL, store TEXT NOT NULL, brand TEXT, severity TEXT NOT NULL DEFAULT 'medium', trigger_date DATE NOT NULL, trigger_value JSONB DEFAULT '{}'::jsonb, threshold_value JSONB DEFAULT '{}'::jsonb, task_id TEXT, status TEXT DEFAULT 'open', assigned_role TEXT, notify_target_role TEXT, evidence_submitted JSONB DEFAULT '[]'::jsonb, resolution_code TEXT, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_anomaly_triggers_tenant_date ON anomaly_triggers (tenant_id, trigger_date DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_assignments (id SERIAL PRIMARY KEY, employee_username CITEXT NOT NULL, topic_id INTEGER NOT NULL DEFAULT 0, assigned_by VARCHAR(100), due_date DATE, note TEXT, created_at TIMESTAMP DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_assignments_tenant_created ON training_assignments (tenant_id, created_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_sessions (id SERIAL PRIMARY KEY, employee_username CITEXT NOT NULL, topic_id INTEGER NOT NULL DEFAULT 0, quiz_passed BOOLEAN DEFAULT FALSE, status VARCHAR(20) DEFAULT 'learning', started_at TIMESTAMP DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_sessions_tenant_started ON training_sessions (tenant_id, started_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_certifications (id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL DEFAULT 0, employee_username CITEXT NOT NULL, topic_id INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_certifications_tenant_created ON training_certifications (tenant_id, created_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${SHARED_TABLES.AGENT_SCORES} (id SERIAL PRIMARY KEY, username CITEXT, total_score NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`ALTER TABLE ${SHARED_TABLES.AGENT_SCORES} ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_scores_tenant_created ON ${SHARED_TABLES.AGENT_SCORES} (tenant_id, created_at)`);
}

const buildAttributionReport = createBuildAttributionReport({
  resolveStoreFilter: resolveCustomerOpsStoreFilter,
  ensureTables: ensureCustomerOpsTables,
  syncCampaigns: syncAutoCampaignsFromDeliveryLogs,
  log,
});

async function applyReportMetricFacts(pool, tenantId, report, reportType, storeId) {
  if (!report || !reportType) return report;
  const rows = await safeReportQuery(pool, `
    SELECT record_json
      FROM customer_ops_source_records
     WHERE tenant_id = $1
       AND record_kind = 'report_metric_fact'
       AND record_json->>'reportType' = $2
       AND COALESCE(record_json->>'storeId', '') = $3
     ORDER BY id ASC`,
    [tenantId || 'default', reportType, cleanText(storeId || '', 80)],
    []
  );
  for (const row of rows) {
    const fact = row.record_json || {};
    const metrics = fact.metrics && typeof fact.metrics === 'object' ? fact.metrics : {};
    const period = cleanText(fact.period || 'current', 20);
    if (period === 'previous') {
      report.previous_period = { ...(report.previous_period || {}), ...metrics };
      report.summary = { ...(report.summary || {}) };
      for (const [key, value] of Object.entries(metrics)) report.summary[`previous_${key}`] = value;
    } else {
      report.summary = { ...(report.summary || {}), ...metrics };
    }
  }
  return report;
}


async function generateDiagnosisNarrative(report, callLLM) {
  const b = report.business || {};
  const mix = report.customer_mix || {};
  const lifecycle = mix.lifecycle || {};
  const total = Math.max(b.customers || 1, 1);
  const dormantPct = Math.round((lifecycle.dormant || 0) / total * 100);
  const oneTimePct = Math.round((lifecycle.one_time || 0) / total * 100);
  const repeatRate = Math.round((b.customer_repeat_rate || 0) * 100);
  const lunchRevPct = Math.round((b.daypart?.lunch?.revenue || 0) / Math.max(b.revenue || 1, 1) * 100);
  const dinnerRevPct = Math.round((b.daypart?.dinner?.revenue || 0) / Math.max(b.revenue || 1, 1) * 100);
  const weekendOrders = b.weekday?.weekend?.orders || 0;
  const weekdayOrders = b.weekday?.weekday?.orders || 0;

  const prompt = `你是一位有15年经验的餐饮行业经营顾问。以下是${report.store_name}的POS数据分析结果，请生成专业的诊断报告文字内容，语气专业但老板能看懂，每条发现必须有具体数字支撑。

经营数据：
- 分析周期：${report.input_quality?.date_start || '-'} 至 ${report.input_quality?.date_end || '-'}
- 总营业额：¥${(b.revenue || 0).toLocaleString()}，日均营业额：¥${Math.round((b.revenue || 0) / Math.max(1, (() => { try { const d1 = new Date(report.input_quality?.date_start); const d2 = new Date(report.input_quality?.date_end); return Math.max(1, Math.round((d2 - d1) / 86400000)); } catch { return 30; } })())).toLocaleString()}
- 总客户数：${b.customers}人 | 复购客户占比：${repeatRate}% | 平均客单：¥${b.avg_check}
- 客群结构：常来客${lifecycle.regular || 0}人 / 偶尔来${lifecycle.occasional || 0}人 / 首次来${lifecycle.one_time || 0}人(${oneTimePct}%) / 沉睡客${lifecycle.dormant || 0}人(${dormantPct}%)
- 餐次分布：午市营业额占${lunchRevPct}% / 晚市营业额占${dinnerRevPct}%
- 周期分布：工作日${weekdayOrders}单 / 周末${weekendOrders}单
- 储值客：${b.stored_value?.customers || 0}人，在手余额：¥${(b.stored_value?.balance || 0).toLocaleString()}
- 客流稳定性评分：${b.revenue_stability_score}/100

请直接输出JSON，不要有其他文字：
{
  "executive_summary": "2-3句话，指出最突出的亮点和最紧迫的问题",
  "findings": [
    {"title": "发现标题（10字内）", "data": "具体数据说明", "assessment": "问题定性和对生意的影响（30-50字）"},
    {"title": "...", "data": "...", "assessment": "..."},
    {"title": "...", "data": "...", "assessment": "..."}
  ],
  "recommendations": [
    {"action": "具体可执行的建议（20字内）", "expected_result": "预期效果（20字内）"},
    {"action": "...", "expected_result": "..."},
    {"action": "...", "expected_result": "..."}
  ]
}`;

  try {
    const result = await callLLM([{ role: 'user', content: prompt }], { purpose: 'reasoning', max_tokens: 1200, temperature: 0.3 });
    if (!result.ok) return null;
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// 优惠策略生成：按 lifecycle_stage x value_tier 做规则映射，不是自由生成——折扣策略涉及真实成本，
// 用可审计的固定规则比用 LLM 自由发挥更适合报告交付场景。VIP 优先用权益而非折扣，避免过度让利。
// lifecycle_stage 口径来自 recomputeCustomerProfiles（growth-api.js）实际写入的值：
// prospect(从未下单) / new(14天内首单) / active(14天内≥2单) / at_risk(14-30天未到店) /
// dormant(30-90天未到店但曾≥2单) / churned(30-90天未到店且只下过1单) / lost_90 / lost_180 / lost_365。
const OFFER_STRATEGY_RULES = [
  { match: (c) => c.value_tier === 'vip' && ['at_risk', 'dormant', 'lost_90', 'lost_180', 'lost_365'].includes(c.lifecycle_stage), strategy_type: 'vip_reactivation_benefit', offer: '专属包厢/招牌菜权益，不建议直接打折', reasoning: 'VIP流失召回优先用体验权益维护身份感，直接大额折扣会拉低客单价预期。' },
  { match: (c) => c.value_tier === 'vip', strategy_type: 'vip_maintenance_benefit', offer: '生日礼/专属服务权益', reasoning: 'VIP在店活跃，不需要用价格刺激，用权益维护粘性即可。' },
  { match: (c) => c.lifecycle_stage === 'prospect', strategy_type: 'no_offer_yet', offer: '暂不建议发放优惠', reasoning: '从未产生过消费，缺乏转化基础，优先用到店邀约观察反应，避免优惠成本打水漂。' },
  { match: (c) => c.lifecycle_stage === 'new', strategy_type: 'second_visit_coupon', offer: '二次到店满减券（满80减15）', reasoning: '新客首次消费后最需要一个明确的二次到店理由，转化窗口在14-30天内最有效。' },
  { match: (c) => c.lifecycle_stage === 'active', strategy_type: 'loyalty_light_touch', offer: '常规复购小额券或积分权益', reasoning: '活跃客户本身高频到店，不需要大额补贴，小额权益维持习惯即可。' },
  { match: (c) => c.lifecycle_stage === 'at_risk', strategy_type: 'early_retention_reminder', offer: '轻量提醒+小额到店券（满50减8）', reasoning: '14-30天未到店的临界客户，用小额度及时提醒比等流失后大力度召回更划算。' },
  { match: (c) => c.lifecycle_stage === 'dormant', strategy_type: 'reactivation_coupon', offer: '满100减20召回券（或等值满赠）', reasoning: '30-90天未到店但历史消费≥2次，说明认可门店，值得投入召回成本。' },
  { match: (c) => ['lost_90', 'lost_180'].includes(c.lifecycle_stage), strategy_type: 'reactivation_coupon_strong', offer: '满100减25召回券，附加招牌菜权益', reasoning: '90-180天长期流失，需要更明确的让利理由才有机会拉回，但要控制在能覆盖ROI的额度内。' },
  { match: (c) => c.lifecycle_stage === 'lost_365', strategy_type: 'low_priority_recall', offer: '低成本试探性召回（短信提醒为主，不建议发大额券）', reasoning: '流失超过365天的客户召回成功率通常很低，优先控制成本，不建议投入大额优惠。' },
  { match: (c) => c.lifecycle_stage === 'churned', strategy_type: 'low_priority_recall', offer: '低成本试探性召回', reasoning: '只消费过1次且已流失，客户粘性未建立，召回投入产出比通常不高，建议轻量触达即可。' },
];
function suggestOfferStrategy(customerProfile) {
  const c = { lifecycle_stage: customerProfile.lifecycle_stage || '', value_tier: customerProfile.value_tier || 'low' };
  const rule = OFFER_STRATEGY_RULES.find((r) => r.match(c)) || { strategy_type: 'default_light_touch', offer: '常规到店提醒，不建议主动让利', reasoning: '未匹配到明确的流失或召回信号，暂不建议投入优惠成本。' };
  return { customer_type: c, ...rule };
}

// 触达文案生成：短信是当前唯一稳定的自动化触达渠道，文案必须满足国内短信合规要求
// （带签名、可退订），不能直接照搬企微/朋友圈文案风格。
async function generateOutreachCopy({ segmentLabel, storeName, offerText, signName }, callLLM) {
  const prompt = `你是餐饮行业的短信营销文案专家。请为「${storeName || '本店'}」给「${segmentLabel || '目标客户'}」这类客户写3条营销短信文案，用于自动召回/维护触达。

背景信息：
- 目标客群：${segmentLabel || '未指定客群'}
- 本次权益/优惠：${offerText || '未指定，可写为到店提醒，不强调优惠'}
- 短信签名：${signName || '【本店】'}（会自动加在文案开头，不要在正文里重复写签名）

硬性要求（国内短信合规）：
1. 每条正文（不含签名和退订提示）控制在 50 字以内，超过70字会被计成多条短信增加成本。
2. 不能有夸大宣传或绝对化用语（如"最"、"第一"、"史上最低"）。
3. 语气要像真人发的邀请，不要用感叹号堆砌。
4. 不需要写退订提示，系统会自动追加。

请直接输出JSON，不要有其他文字：
{
  "variants": [
    {"copy": "文案1正文", "style": "风格标签，如：直接优惠型"},
    {"copy": "文案2正文", "style": "风格标签，如：情感邀约型"},
    {"copy": "文案3正文", "style": "风格标签，如：稀缺紧迫型"}
  ]
}`;
  try {
    const result = await callLLM([{ role: 'user', content: prompt }], { purpose: 'reasoning', max_tokens: 600, temperature: 0.6 });
    if (!result.ok) return { ok: false, error: 'llm_failed' };
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: 'llm_parse_failed' };
    const parsed = JSON.parse(jsonMatch[0]);
    const variants = (parsed.variants || []).map((v) => ({
      copy: cleanText(v.copy, 100),
      style: cleanText(v.style, 40),
      char_count: cleanText(v.copy, 100).length,
      sms_billing_units: Math.ceil(cleanText(v.copy, 100).length / 70) || 1,
    }));
    return { ok: true, variants };
  } catch (e) {
    return { ok: false, error: e?.message || 'llm_error' };
  }
}

function mergeDiagnostics(parts) {
  const merged = { files: [], sheets: [], missing_required: [], warnings: [], confidence_score: 0, record_types: {} };
  for (const d of parts || []) {
    if (!d) continue;
    merged.files.push(d.source_file || '');
    merged.sheets.push(...(d.sheets || []));
    for (const w of d.warnings || []) if (!merged.warnings.includes(w)) merged.warnings.push(w);
    for (const [k, v] of Object.entries(d.record_types || {})) merged.record_types[k] = (merged.record_types[k] || 0) + Number(v || 0);
  }
  const present = merged.sheets.reduce((acc, s) => { for (const f of ['phone', 'bizDate', 'amount', 'dish', 'rechargeAmount', 'balance']) if (s.present?.[f]) acc[f] = true; return acc; }, {});
  merged.missing_required = ['phone', 'bizDate'].filter((f) => !present[f]).map((f) => FIELD_DEFS[f].label);
  if (!present.amount && !present.rechargeAmount && !present.balance) merged.missing_required.push('消费/储值金额');
  if (!present.dish) merged.warnings.push('未识别到菜品字段，菜品偏好和新品匹配会较弱');
  if (!present.phone) merged.warnings.push('未识别到手机号字段，只能做匿名客户诊断，无法沉淀可触达客户');
  merged.confidence_score = Math.round((['phone', 'bizDate'].reduce((s, f) => s + (present[f] ? 25 : 0), 0)) + ((present.amount || present.rechargeAmount || present.balance) ? 25 : 0) + (present.dish ? 25 : 0));
  merged.files = merged.files.filter(Boolean);
  return merged;
}

function dedupeRecords(records) {
  const map = new Map();
  for (const r of records || []) { const key = r.recordKey || ''; if (!key) continue; map.set(key, { ...r, recordKey: key }); }
  return Array.from(map.values());
}

// Converts parsed Excel rows into the pos_orders/pos_order_items shape so the diagnosis
// upload also feeds tenant-operation-inspection-service / closed-loop-report-service /
// growth-opportunity-service, which read those tables directly and never see customer_ops_*.
// Only rows with a real order number and a POS-consumption kind are eligible — synthetic
// keys (phone/date fallback) aren't real order identifiers and stored_value/member_profile
// rows aren't orders.
function toPosOrderPayload(batchRecords) {
  const orders = [];
  const items = [];
  for (const r of batchRecords) {
    if (r.kind !== 'pos_consumption' || !r.hasRealOrderNo || !(r.amount > 0)) continue;
    const storeId = storeNameToId(r.store || '') || '';
    const timeStr = r.bizDate ? `${r.bizDate} ${String(r.hour ?? 0).padStart(2, '0')}:00:00` : '';
    orders.push({
      order_no: r.orderNo,
      order_source: 'customer_ops_excel',
      biz_date: r.bizDate,
      order_time: timeStr,
      checkout_time: timeStr,
      amount_before_discount: r.amount,
      total_discount: 0,
      amount_after_discount: r.amount,
      member_name: r.memberName,
      phone: r.phone,
      order_type: r.orderType,
      table_no: r.tableNo,
      diners: r.diners,
      store_name: r.store,
      store_id: storeId,
    });
    for (const it of r.items || []) {
      items.push({
        biz_date: r.bizDate,
        store_name: r.store,
        store_code: storeId,
        order_no: r.orderNo,
        dish_name: it.dish,
        category: it.category || '',
        qty: it.qty || 1,
        amount_before_discount: it.amount || 0,
        amount_after_discount: it.amount || 0,
        order_time: timeStr,
        checkout_time: timeStr,
      });
    }
  }
  return { orders, items };
}

async function loadExistingSourceRecords(pool, tenantId) {
  const r = await pool.query(`SELECT record_json FROM customer_ops_source_records WHERE tenant_id=$1 ORDER BY id ASC LIMIT 120000`, [tenantId]);
  return (r.rows || []).map((x) => x.record_json || {});
}

// 模块2：根据criteria_json过滤客户
function applySegmentCriteria(profiles, criteria) {
  return profiles.filter((c) => {
    if (criteria.lifecycle_stage && c.lifecycle_stage !== criteria.lifecycle_stage) return false;
    if (criteria.value_tier && c.value_tier !== criteria.value_tier) return false;
    if (criteria.scene_tag && !(c.scene_tags || []).includes(criteria.scene_tag)) return false;
    if (criteria.min_order_count != null && c.order_count < Number(criteria.min_order_count)) return false;
    if (criteria.max_order_count != null && c.order_count > Number(criteria.max_order_count)) return false;
    if (criteria.min_orders_30d != null && (c.orders_30d || 0) < Number(criteria.min_orders_30d)) return false;
    if (criteria.max_days_since != null && c.days_since_last_visit > Number(criteria.max_days_since)) return false;
    if (criteria.min_days_since != null && c.days_since_last_visit < Number(criteria.min_days_since)) return false;
    if (criteria.min_avg_check != null && c.avg_check < Number(criteria.min_avg_check)) return false;
    if (criteria.max_avg_check != null && c.avg_check > Number(criteria.max_avg_check)) return false;
    if (criteria.min_total_spend != null && c.total_spend < Number(criteria.min_total_spend)) return false;
    if (criteria.min_spend_90d != null && (c.spend_90d || 0) < Number(criteria.min_spend_90d)) return false;
    if (criteria.min_max_single_spend != null && (c.max_single_spend || 0) < Number(criteria.min_max_single_spend)) return false;
    if (criteria.min_max_single_diners != null && (c.max_single_diners || 0) < Number(criteria.min_max_single_diners)) return false;
    if (criteria.min_stored_value_balance != null && c.stored_value_balance < Number(criteria.min_stored_value_balance)) return false;
    if (criteria.preferred_visit_time && c.preferred_visit_time !== criteria.preferred_visit_time) return false;
    if (criteria.primary_store && c.primary_store !== criteria.primary_store) return false;
    if (criteria.favorite_dish_keyword) {
      const kw = String(criteria.favorite_dish_keyword).toLowerCase();
      if (!(c.favorite_dishes || []).some((d) => String(d).toLowerCase().includes(kw))) return false;
    }
    return true;
  });
}

export function registerCustomerOpsRoutes(app, pool, authRequired, upload, uploadsDir, recordUploadOwnership, callLLM, opts = {}) {
  const basePath = opts.basePath || '/api/customer-ops';
  const getTenantId = opts.getTenantId || ((req) => req.tenantId || 'default');
  const sharedRouteDeps = {
    pool, authRequired, upload, uploadsDir, recordUploadOwnership, callLLM,
    basePath, getTenantId, ensureCustomerOpsTables,
    dedupeRecords, loadExistingSourceRecords, mergeDiagnostics, toPosOrderPayload,
    generateDiagnosisNarrative, applySegmentCriteria, suggestOfferStrategy, generateOutreachCopy,
  };
  registerCustomerOpsDiagnosisRoutes(app, sharedRouteDeps);
  registerCustomerOpsCustomerRoutes(app, sharedRouteDeps);
  registerCustomerOpsSegmentOutreachRoutes(app, sharedRouteDeps);

  // ── 模块3：营销活动台账 ──────────────────────────────────────────

  app.get(`${basePath}/campaigns`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      await syncAutoCampaignsFromDeliveryLogs(pool, tenantId).catch((e) => log.warn({ msg: 'customer_ops_auto_campaign_sync_failed', err: e?.message }));
      const status = cleanText(req.query.status || '', 20);
      const dateFrom = cleanText(req.query.date_from || '', 20);
      const dateTo = cleanText(req.query.date_to || '', 20);
      const storeId = cleanText(req.query.store_id || '', 80);
      const params = [tenantId];
      let where = 'c.tenant_id=$1';
      if (status) { params.push(status); where += ` AND c.status=$${params.length}`; }
      if (dateFrom) { params.push(dateFrom); where += ` AND c.planned_date >= $${params.length}::date`; }
      if (dateTo) { params.push(dateTo); where += ` AND c.planned_date <= $${params.length}::date`; }
      if (storeId) { params.push(JSON.stringify([storeId])); where += ` AND (c.store_ids = '[]'::jsonb OR c.store_ids @> $${params.length}::jsonb)`; }
      const r = await pool.query(
        `SELECT c.*, COALESCE(json_agg(r ORDER BY r.created_at) FILTER (WHERE r.id IS NOT NULL), '[]') AS results
           FROM marketing_campaigns c
           LEFT JOIN marketing_campaign_results r ON r.campaign_id=c.id AND r.tenant_id=c.tenant_id
          WHERE ${where} GROUP BY c.id ORDER BY c.planned_date DESC NULLS LAST, c.created_at DESC LIMIT 200`,
        params
      );
      res.json({ ok: true, campaigns: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // PDF导出：指定时间/门店范围内的营销活动执行报告（供租户证明行动内容）
  app.get(`${basePath}/campaigns/report-pdf`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      await syncAutoCampaignsFromDeliveryLogs(pool, tenantId).catch(() => {});
      const dateFrom = cleanText(req.query.date_from || '', 20) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const dateTo = cleanText(req.query.date_to || '', 20) || new Date().toISOString().slice(0, 10);
      const storeId = cleanText(req.query.store_id || '', 80);
      const params = [tenantId, dateFrom, dateTo];
      let where = 'c.tenant_id=$1 AND c.planned_date >= $2::date AND c.planned_date <= $3::date';
      if (storeId) { params.push(JSON.stringify([storeId])); where += ` AND (c.store_ids = '[]'::jsonb OR c.store_ids @> $${params.length}::jsonb)`; }
      const r = await pool.query(
        `SELECT c.*, COALESCE(json_agg(r ORDER BY r.created_at) FILTER (WHERE r.id IS NOT NULL), '[]') AS results
           FROM marketing_campaigns c
           LEFT JOIN marketing_campaign_results r ON r.campaign_id=c.id AND r.tenant_id=c.tenant_id
          WHERE ${where} GROUP BY c.id ORDER BY c.planned_date ASC NULLS LAST, c.created_at ASC LIMIT 500`,
        params
      );
      const payload = {
        campaigns: r.rows,
        date_from: dateFrom,
        date_to: dateTo,
        store_filter: storeId || '全部门店',
        generated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      const filename = `campaign_report_${tenantId}_${dateFrom}_${dateTo}.pdf`;
      const outputPath = path.join(uploadsDir, filename);
      await runCampaignReportPdfGenerator(payload, outputPath);
      await recordUploadOwnership(filename, tenantId, req.user?.username || req.platformAdmin?.username);
      res.json({ ok: true, url: `/uploads/${filename}` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'pdf_failed' });
    }
  });

  registerCustomerOpsReportCampaignRoutes(app, {
    pool,
    authRequired,
    basePath,
    getTenantId,
    ensureCustomerOpsTables,
    buildAttributionReport,
    applyReportMetricFacts,
  });

}

export { ensureCustomerOpsTables };
export { analyzeOrders, normalizeWorkbook } from './domains/customer-ops/workbook-analysis.js';
export { buildCustomerAssetReport, buildOpsRectificationReport, buildTalentGrowthReport } from './domains/customer-ops/report-builders.js';
