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

const LOG = '[ontology-daily]';
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
      console.log(
        `${LOG} done tenant=${tenantId} date=${dateKey} stores=${summary.storesDiagnosed}` +
          ` sync.touches=${summary.syncResult?.touches ?? 0}` +
          ` issues=${summary.stores.reduce((n, s) => n + s.issues, 0)}`
      );
    } catch (e) {
      console.error(`${LOG} tenant=${tenantId} failed:`, e?.message || e);
      _firedByTenantDate.delete(tenantId);
    }
  }, { continueOnError: true });

  return { skipped: false, dateKey, summaries };
}

export function startOntologyDailyDiagnosisScheduler(pool) {
  if (!pool) {
    console.warn(`${LOG} scheduler not started: missing pool`);
    return;
  }
  if (globalThis.__ontologyDailyDiagnosisSchedulerStarted) {
    console.log(`${LOG} scheduler already started, skip`);
    return;
  }
  globalThis.__ontologyDailyDiagnosisSchedulerStarted = true;

  const tick = () => {
    runOntologyDailyDiagnosisTick(pool).catch((e) => {
      console.error(`${LOG} tick error:`, e?.message || e);
    });
  };

  // 启动约 2 分钟后先探一次窗口（若刚好在 08:00–08:14 会立刻跑）
  setTimeout(tick, 120 * 1000);
  setInterval(tick, TICK_MS);
  console.log(`${LOG} scheduler started (CST ${FIRE_HOUR}:00–${String(FIRE_HOUR).padStart(2, '0')}:${String(FIRE_MINUTE_MAX).padStart(2, '0')}, every ${TICK_MS / 60000}min)`);
}
