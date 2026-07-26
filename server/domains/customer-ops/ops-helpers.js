/**
 * Customer-ops shared helpers (extracted for report builders).
 * Note: ensureCustomerOpsTables (listen-time CREATE) stays in server/customer-ops.js
 * so domains/ ensure-ddl-freeze gate stays green.
 */
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { STORES, storeIdToName, storeNameToId, inferBrandFromStoreName } from '../../brands-config.js';
import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'customer-ops', handler: 'ops-helpers' });
const PYTHON_BIN = process.env.CUSTOMER_OPS_PYTHON_BIN || process.env.CODEX_PYTHON_BIN || 'python3';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function cleanPhone(value) {
  return cleanText(value, 40).replace(/[^0-9]/g, '').slice(-11);
}

export function num(value) {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/[¥,，\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function uniqueClean(values, max = 160) {
  return Array.from(new Set((values || []).map((v) => cleanText(v, max)).filter(Boolean)));
}

export function sqlLikePattern(value) {
  const s = cleanText(value, 160).replace(/[\\%_]/g, '\\$&');
  return s ? `%${s}%` : '';
}

export function storeKeywordsFromName(value) {
  const s = cleanText(value, 160);
  const words = [];
  if (!s) return words;
  for (const store of STORES) {
    if (s.includes(store.name) || s.includes(store.brandName) || store.name.includes(s) || store.brandName.includes(s)) {
      words.push(store.name, store.brandName, store.storeId);
    }
  }
  const brand = inferBrandFromStoreName(s);
  if (brand) words.push(brand);
  if (s.includes('洪潮')) words.push('洪潮', '64822111', '洪潮大宁久光店');
  if (s.includes('马己仙')) words.push('马己仙', '51866138', '马己仙上海音乐广场店');
  return words;
}

export async function resolveCustomerOpsStoreFilter(pool, tenantId, rawStoreId = '') {
  const raw = cleanText(rawStoreId || '', 120);
  if (!raw) {
    return { requested: '', displayName: '全部门店', posStoreIds: [], posStoreNames: [], posStorePatterns: [] };
  }

  let stateStores = [];
  try {
    const r = await pool.query(`SELECT data->'stores' AS stores FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`, [tenantId || 'default']);
    stateStores = Array.isArray(r.rows?.[0]?.stores) ? r.rows[0].stores : [];
  } catch (e) {
    log.warn({ msg: 'customer_ops_store_state_lookup_skipped', err: e?.message });
  }

  const stateStore = stateStores.find((s) => cleanText(s?.id, 120) === raw || cleanText(s?.name, 160) === raw || cleanText(s?.brandName || s?.brand, 160) === raw);
  const configuredId = storeNameToId(raw);
  const configuredName = configuredId ? storeIdToName(configuredId) : '';
  const displayName = cleanText(stateStore?.name || configuredName || storeIdToName(raw) || raw, 160);
  const candidates = uniqueClean([
    raw,
    stateStore?.id,
    stateStore?.name,
    stateStore?.brandName,
    stateStore?.brand,
    configuredId,
    configuredName,
    ...storeKeywordsFromName(raw),
    ...storeKeywordsFromName(stateStore?.name),
    ...storeKeywordsFromName(stateStore?.brandName || stateStore?.brand),
  ]);
  const patterns = uniqueClean(candidates.map(sqlLikePattern));

  let posRows = [];
  try {
    const r = await pool.query(`
      SELECT DISTINCT store_id, store_name
      FROM pos_orders
      WHERE store_id = ANY($1::text[])
         OR store_name = ANY($1::text[])
         OR store_name ILIKE ANY($2::text[])
      LIMIT 20`, [candidates, patterns]);
    posRows = r.rows || [];
  } catch (e) {
    log.warn({ msg: 'customer_ops_pos_store_lookup_skipped', err: e?.message });
  }

  const posStoreIds = uniqueClean([...posRows.map((r) => r.store_id), configuredId, raw]);
  const posStoreNames = uniqueClean([...posRows.map((r) => r.store_name), stateStore?.name, configuredName]);
  const posStorePatterns = uniqueClean([...posStoreNames, ...candidates].map(sqlLikePattern));
  return {
    requested: raw,
    displayName: stateStore?.name || configuredName || posRows[0]?.store_name || displayName,
    posStoreIds,
    posStoreNames,
    posStorePatterns,
  };
}

export function posStoreFilterSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `($3::text = '' OR ${p}store_id = ANY($4::text[]) OR ${p}store_name = ANY($5::text[]) OR ${p}store_name ILIKE ANY($6::text[]))`;
}

export async function latestDiagnosis(pool, tenantId, diagnosisId = 0) {
  if (diagnosisId) {
    const r = await pool.query(`SELECT * FROM customer_ops_diagnoses WHERE id = $1 AND tenant_id = $2`, [diagnosisId, tenantId]);
    return r.rows[0] || null;
  }
  const r = await pool.query(`SELECT * FROM customer_ops_diagnoses WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`, [tenantId]);
  return r.rows[0] || null;
}

export function runPdfGenerator(report, outputPath) {
  const script = path.join(SERVER_ROOT, 'scripts', 'customer_ops_pdf.py');
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [script, outputPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(err || `pdf_failed_${code}`)));
    child.stdin.write(JSON.stringify(report));
    child.stdin.end();
  });
}

export function runCampaignReportPdfGenerator(payload, outputPath) {
  const script = path.join(SERVER_ROOT, 'scripts', 'campaign_report_pdf.py');
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [script, outputPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(err || `pdf_failed_${code}`)));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// 自动营销发送(growth_delivery_logs)按 规则+日期 聚合生成一条营销活动台账记录，
// 标注 source='auto'，让维护导航舱能看到系统自动执行的常态化触达，而不只是手动策划的活动。
export async function syncAutoCampaignsFromDeliveryLogs(pool, tenantId) {
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS rule_key TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_campaigns_auto ON marketing_campaigns (tenant_id, rule_key, planned_date) WHERE source='auto' AND rule_key IS NOT NULL`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_campaign_results_auto ON marketing_campaign_results (campaign_id, store_id) WHERE source='auto'`);

  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const grouped = await pool.query(
    `SELECT dl.rule_key, tr.name AS rule_name, dl.created_at::date AS day,
            COUNT(*) AS send_count,
            array_agg(DISTINCT dl.store_id) FILTER (WHERE dl.store_id IS NOT NULL AND dl.store_id <> '') AS store_ids,
            MAX(dl.channel) AS channel,
            MAX(dl.payload->>'message') AS sample_message
       FROM growth_delivery_logs dl
       LEFT JOIN growth_touch_rules tr ON tr.rule_key = dl.rule_key
      WHERE dl.tenant_id = $1 AND dl.status = 'sent' AND dl.rule_key IS NOT NULL AND dl.rule_key <> ''
        AND dl.created_at >= $2::date
      GROUP BY dl.rule_key, tr.name, dl.created_at::date`,
    [tenantId, since]
  ).catch(() => ({ rows: [] }));

  for (const row of grouped.rows) {
    const storeIds = row.store_ids || [];
    const existingCampaign = await pool.query(
      `SELECT id FROM marketing_campaigns
        WHERE tenant_id=$1 AND source='auto' AND rule_key=$2 AND planned_date=$3::date
        ORDER BY id ASC LIMIT 1`,
      [tenantId, row.rule_key, row.day]
    );
    let campaignId = existingCampaign.rows[0]?.id;
    if (campaignId) {
      await pool.query(
        `UPDATE marketing_campaigns
            SET title=$2, channel=$3, store_ids=$4::jsonb, target_count=$5, content=$6, updated_at=NOW()
          WHERE id=$1 AND tenant_id=$7`,
        [campaignId, row.rule_name || row.rule_key, row.channel || 'wecom', JSON.stringify(storeIds), Number(row.send_count || 0), row.sample_message || '', tenantId]
      );
    } else {
      const campaignRes = await pool.query(
        `INSERT INTO marketing_campaigns (tenant_id, title, channel, campaign_type, status, planned_date, planned_end_date, store_ids, target_audience, target_count, content, goal, source, rule_key, created_by)
         VALUES ($1,$2,$3,'自动营销','completed',$4,$4,$5::jsonb,'系统规则自动圈选',$6,$7,'系统按预设规则自动执行的常态化营销触达','auto',$8,'system')
         RETURNING id`,
        [tenantId, row.rule_name || row.rule_key, row.channel || 'wecom', row.day, JSON.stringify(storeIds), Number(row.send_count || 0), row.sample_message || '', row.rule_key]
      );
      campaignId = campaignRes.rows[0].id;
    }

    const perStore = await pool.query(
      `SELECT COALESCE(NULLIF(dl.store_id, ''), '') AS store_id, COUNT(*) AS send_count
         FROM growth_delivery_logs dl
        WHERE dl.tenant_id = $1 AND dl.status = 'sent' AND dl.rule_key = $2 AND dl.created_at::date = $3::date
        GROUP BY dl.store_id`,
      [tenantId, row.rule_key, row.day]
    );
    for (const sr of perStore.rows) {
      const existingResult = await pool.query(
        `SELECT id FROM marketing_campaign_results
          WHERE tenant_id=$1 AND campaign_id=$2 AND store_id=$3 AND source='auto'
          ORDER BY id ASC LIMIT 1`,
        [tenantId, campaignId, sr.store_id]
      );
      if (existingResult.rows[0]?.id) {
        await pool.query(
          `UPDATE marketing_campaign_results
              SET store_name=$2, actual_send_count=$3, updated_at=NOW()
            WHERE id=$1 AND tenant_id=$4`,
          [existingResult.rows[0].id, sr.store_id, Number(sr.send_count || 0), tenantId]
        );
      } else {
        await pool.query(
          `INSERT INTO marketing_campaign_results (tenant_id, campaign_id, store_id, store_name, actual_send_count, source, recorded_by)
           VALUES ($1,$2,$3,$3,$4,'auto','system')`,
          [tenantId, campaignId, sr.store_id, Number(sr.send_count || 0)]
        );
      }
    }
  }
}

// 把已评级的活动复盘结果沉淀到经验库(growth_learnings)，供AI内容建议引擎下一轮复用。
export async function saveCampaignResultAsLearning(pool, tenantId, campaign, result) {
  if (!campaign || !result || !result.effect_rating) return;
  const send = Number(result.actual_send_count || 0);
  const redeem = Number(result.actual_redemption_count || 0);
  const revenue = Number(result.actual_revenue || 0);
  const cost = Number(result.actual_cost || 0);
  const rate = send > 0 ? `${(redeem / send * 100).toFixed(1)}%` : '-';
  const roi = cost > 0 ? ((revenue - cost) / cost).toFixed(2) : '-';
  const effectLabel = { excellent: '优秀', meets: '达标', below: '不达标', blacklist: '黑名单(不建议再用)' }[result.effect_rating] || result.effect_rating;
  const confidence = result.effect_rating === 'excellent' ? 'high' : result.effect_rating === 'blacklist' ? 'high' : 'medium';
  const effectDesc = `活动「${campaign.title}」(${campaign.campaign_type || '其他'}/${campaign.channel || '-'})：`
    + `发送${send}人，核销${redeem}单(核销率${rate})，带动收入¥${revenue.toFixed(0)}，成本¥${cost.toFixed(0)}，ROI ${roi}。`
    + `效果评级：${effectLabel}。${result.result_note ? '备注：' + cleanText(result.result_note, 300) : ''}`;
  await pool.query(
    `INSERT INTO growth_learnings (source_type, source_id, store_code, channel, scene, audience_tag, variable, winning_value, losing_value, effect_desc, sample_size, confidence, is_verified, tenant_id)
     VALUES ('marketing_campaign', $1, $2, $3, $4, $5, $6, $7, '', $8, $9, $10, true, $11)
     ON CONFLICT (source_type, source_id, tenant_id) WHERE source_id IS NOT NULL AND source_id <> '' DO UPDATE SET
       store_code = EXCLUDED.store_code, channel = EXCLUDED.channel, effect_desc = EXCLUDED.effect_desc,
       sample_size = EXCLUDED.sample_size, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [
      String(campaign.id),
      cleanText(result.store_name || result.store_id || '', 80),
      cleanText(campaign.channel || '', 40),
      cleanText(campaign.campaign_type || '', 40),
      cleanText(campaign.target_audience || '', 200),
      `活动类型:${campaign.campaign_type || '其他'}`,
      cleanText(campaign.title || '', 200),
      effectDesc,
      send,
      confidence,
      tenantId,
    ]
  ).catch((e) => log.warn({ msg: 'customer_ops_save_learning_failed', err: e?.message }));
}

export async function safeReportQuery(pool, sql, params = [], fallback = []) {
  try {
    const r = await pool.query(sql, params);
    return r.rows || [];
  } catch (e) {
    log.warn({ msg: 'customer_ops_report_query_skipped', err: e?.message });
    return fallback;
  }
}
