/**
 * 日对账：仓库 migrations/*.sql vs schema_migrations 记账漂移告警。
 * 挂在进程内定时器；告警走注入的 notifyFn（通常是 pushGrowthAlert / sendLark 管理员通道）。
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { getMigrationDriftReport } from './schema-migrations.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'schema-migration-drift' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _firedDate = '';

/**
 * @param {import('pg').Pool} pool
 * @param {{ notifyFn?: (msg: string) => Promise<unknown>, migrationsDir?: string }} [opts]
 */
export async function runSchemaMigrationDriftCheck(pool, opts = {}) {
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  if (_firedDate === todayStr) return { skipped: true, reason: 'already_alerted_today' };

  const report = await getMigrationDriftReport(pool, {
    migrationsDir: opts.migrationsDir || path.join(__dirname, 'migrations'),
  });
  if (report.ok) {
    log.info({ msg: 'drift_ok', repo: report.repoCount, applied: report.appliedCount });
    return { ok: true, report };
  }

  _firedDate = todayStr;
  const pendingPreview = report.pending.slice(0, 12).join(', ');
  const orphanPreview = report.orphanApplied.slice(0, 12).join(', ');
  const msg = [
    '【schema_migrations 漂移】仓库 migration 与生产记账不一致',
    `repo=${report.repoCount} applied=${report.appliedCount}`,
    report.pending.length ? `pending(${report.pending.length}): ${pendingPreview}` : null,
    report.orphanApplied.length
      ? `orphanApplied(${report.orphanApplied.length}): ${orphanPreview}`
      : null,
    '请核对后补 INSERT schema_migrations 或受控执行 migrate。',
  ]
    .filter(Boolean)
    .join('\n');

  log.error({ msg: 'drift_detected', detail: msg.replace(/\n/g, ' | ') });
  if (typeof opts.notifyFn === 'function') {
    try {
      await opts.notifyFn(msg);
    } catch (e) {
      log.error({ msg: 'drift_notify_failed', err: e?.message || String(e) });
    }
  }
  return { ok: false, report };
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ notifyFn?: (msg: string) => Promise<unknown> }} [opts]
 */
export function startSchemaMigrationDriftMonitor(pool, opts = {}) {
  const tick = () => {
    runSchemaMigrationDriftCheck(pool, opts).catch((e) => {
      log.error({ msg: 'drift_tick_error', err: e?.message || String(e) });
    });
  };
  // 启动后 2 分钟首次，之后每 6 小时（与 freshness 同频）
  setTimeout(tick, 120000);
  setInterval(tick, 6 * 3600 * 1000);
}
