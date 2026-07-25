/**
 * 经营诊断日更调度：每天上海时间 08:00–08:14 对活跃租户各门店
 * sync 真实数据 → runDailyDiagnosis，保证 issues/opportunities 不会只靠人工点 API 才刷新。
 *
 * 去重：同一租户同一自然日只跑一轮（进程内 Map；多实例时各自可能跑，诊断本身幂等 supersede）。
 */
import { runForActiveTenants } from '../utils/database.js';
import { ensureGrowthOntologyCore } from './growth-ontology-schema.js';
import { syncOntologyDataFromProduction } from './real-data-sync.js';
import { runDailyDiagnosis } from './diagnosis-tree-service.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'ontology', handler: 'daily-diagnosis-scheduler' });

const FIRE_HOUR = 8;
const FIRE_MINUTE_MIN = 0;
const FIRE_MINUTE_MAX = 14;
const TICK_MS = 5 * 60 * 1000;

const _firedByTenantDate = new Map();

function shanghaiParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

async function listDiagnosisStoreIds(pool, tenantId) {
  const r = await pool.query(
    `SELECT store_id FROM growth_ontology_stores
      WHERE tenant_id = $1 AND COALESCE(status, 'active') = 'active'
      ORDER BY store_id`,
    [tenantId]
  );
  return (r.rows || []).map((row) => String(row.store_id || '').trim()).filter(Boolean);
}

export async function runOntologyDailyDiagnosisForTenant(pool, tenantId, options = {}) {
  const date = options.date || shanghaiParts().dateKey;
  await ensureGrowthOntologyCore(pool);
  const syncResult = await syncOntologyDataFromProduction(pool, tenantId);
  const storeIds = options.storeIds?.length
    ? options.storeIds
    : await listDiagnosisStoreIds(pool, tenantId);

  const stores = [];
  for (const storeId of storeIds) {
    const diag = await runDailyDiagnosis(pool, { tenantId, storeId, date });
    stores.push({
      storeId,
      ontologyStatus: diag.ontologyStatus,
      issues: (diag.issues || []).length,
      opportunities: (diag.opportunities || []).length,
      dataGaps: diag.dataGaps || [],
    });
  }

  return {
    tenantId,
    date,
    syncResult,
    storesDiagnosed: stores.length,
    stores,
  };
}

export async function runOntologyDailyDiagnosisTick(pool, options = {}) {
  const force = options.force === true;
  const { dateKey, hour, minute } = shanghaiParts();
  if (!force) {
    if (hour !== FIRE_HOUR || minute < FIRE_MINUTE_MIN || minute > FIRE_MINUTE_MAX) {
      return { skipped: true, reason: 'outside_window', dateKey, hour, minute };
    }
  }

  const summaries = [];
  await runForActiveTenants(async (tenantId) => {
    if (!force && _firedByTenantDate.get(tenantId) === dateKey) return;
    _firedByTenantDate.set(tenantId, dateKey);
    try {
      const summary = await runOntologyDailyDiagnosisForTenant(pool, tenantId, { date: dateKey });
      summaries.push(summary);
      log.info({
        msg: 'daily_diagnosis_done',
        tenant_id: tenantId,
        date: dateKey,
        stores: summary.storesDiagnosed,
        sync_touches: summary.syncResult?.touches ?? 0,
        issues: summary.stores.reduce((n, s) => n + s.issues, 0),
      });
    } catch (e) {
      log.error({ msg: 'daily_diagnosis_tenant_failed', tenant_id: tenantId, err: e?.message || String(e) });
      _firedByTenantDate.delete(tenantId);
    }
  }, { continueOnError: true });

  return { skipped: false, dateKey, summaries };
}

export function startOntologyDailyDiagnosisScheduler(pool) {
  if (!pool) {
    log.warn({ msg: 'scheduler_not_started_missing_pool' });
    return;
  }
  if (globalThis.__ontologyDailyDiagnosisSchedulerStarted) {
    log.info({ msg: 'scheduler_already_started' });
    return;
  }
  globalThis.__ontologyDailyDiagnosisSchedulerStarted = true;

  const tick = () => {
    runOntologyDailyDiagnosisTick(pool).catch((e) => {
      log.error({ msg: 'scheduler_tick_error', err: e?.message || String(e) });
    });
  };

  // 启动约 2 分钟后先探一次窗口（若刚好在 08:00–08:14 会立刻跑）
  setTimeout(tick, 120 * 1000);
  setInterval(tick, TICK_MS);
  log.info({ msg: 'scheduler_started', fire_hour: FIRE_HOUR, fire_minute_max: FIRE_MINUTE_MAX, tick_min: TICK_MS / 60000 });
}
