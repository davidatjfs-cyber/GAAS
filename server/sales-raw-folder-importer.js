/**
 * 销售明细目录自动入库 → sales_raw
 *
 * 说明：生产环境（ECS）无法读取你 Mac 上的 /Users/.../Desktop/HRMS。
 * 用法：在服务器上建目录（如 /opt/hrms/incoming-sales），用 rsync/scp 把 Excel 拷过去，
 * 并设置环境变量 SALES_RAW_IMPORT_DIR。默认每 15 分钟扫描一次。
 *
 * 环境变量：
 * - SALES_RAW_IMPORT_DIR     绝对路径，未设置则本模块不启动
 * - SALES_RAW_IMPORT_INTERVAL_MS  扫描间隔（毫秒），默认 900000（15 分钟）
 * - SALES_RAW_IMPORT_FORCE=true   跳过成本覆盖率门槛（与后台 force 上传等价，慎用）
 * - SALES_RAW_IMPORT_DEFAULT_STORE  Excel 无「门店」列时用默认门店名
 * - SALES_RAW_IMPORT_RECURSIVE=true 递归子目录（跳过 imported/、failed/）
 */
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'sales-raw-folder' });

const _LOCK = { running: false };

/** 由 index 注册：目录入库出现失败时立刻飞书通知 admin（避免循环依赖） */
let _importFailureNotifier = null;
export function setSalesRawFolderImportFailureNotifier(fn) {
  _importFailureNotifier = typeof fn === 'function' ? fn : null;
}

export async function runSalesRawFolderImportOnce() {
  // sales_raw表已于2026-07-03下线，销售明细改由pos_order_items自动同步，
  // 此目录导入流程不再需要写入任何表，直接跳过。
  return { skipped: true, reason: 'sales_raw_retired' };
}

export function startSalesRawFolderImporter() {
  const dir = String(process.env.SALES_RAW_IMPORT_DIR || '').trim();
  if (!dir) {
    log.info({ msg: 'import_dir_unset_skip' });
    return;
  }
  const ms = Math.max(60_000, Number(process.env.SALES_RAW_IMPORT_INTERVAL_MS || 900_000));
  setInterval(() => {
    runSalesRawFolderImportOnce().catch((e) => {
      log.error({ msg: 'tick_error', err: e?.message || String(e) });
      try {
        void _importFailureNotifier?.(e, { dir, tick: true });
      } catch (_e2) {
        /* ignore */
      }
    });
  }, ms);
  setTimeout(() => {
    runSalesRawFolderImportOnce().catch((e) => {
      log.error({ msg: 'startup_run_error', err: e?.message || String(e) });
      try {
        void _importFailureNotifier?.(e, { dir, startup: true });
      } catch (_e2) {
        /* ignore */
      }
    });
  }, 30_000);
  log.info({ msg: 'importer_armed', interval_min: Math.round(ms / 60000), dir });
}
