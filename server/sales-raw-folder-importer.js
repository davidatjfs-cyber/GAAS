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
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'sales-raw-folder' });

const _LOCK = { running: false };

/** 由 index 注册：目录入库出现失败时立刻飞书通知 admin（避免循环依赖） */
let _importFailureNotifier = null;
export function setSalesRawFolderImportFailureNotifier(fn) {
  _importFailureNotifier = typeof fn === 'function' ? fn : null;
}

function inferDateFromFilename(input, now = new Date()) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const basename = raw.replace(/\.[^.]+$/, '');

  const full = basename.match(/(20\d{2})[-_.\/年](\d{1,2})[-_.\/月](\d{1,2})/);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const mdRange = basename.match(/(^|\D)(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{1,2})(\D|$)/);
  if (mdRange) {
    const m = Number(mdRange[2]);
    const d1 = Number(mdRange[3]);
    const d2 = Number(mdRange[4]);
    if (m >= 1 && m <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
      const y = now.getFullYear();
      const day = Math.max(d1, d2);
      return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const md = basename.match(/(^|\D)(\d{1,2})[-_.\/](\d{1,2})(\D|$)/);
  if (md) {
    const m = Number(md[2]);
    const d = Number(md[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = now.getFullYear();
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return '';
}

async function moveUnder(destDir, filePath, tag) {
  const base = path.basename(filePath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  let dest = path.join(destDir, `${tag}_${ts}_${base}`);
  let n = 0;
  while (fs.existsSync(dest)) {
    n += 1;
    dest = path.join(destDir, `${tag}_${ts}_${n}_${base}`);
  }
  await fs.promises.rename(filePath, dest);
  return dest;
}

async function collectExcelFiles(baseDir, recursive) {
  const out = [];
  const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(baseDir, ent.name);
    if (ent.isDirectory()) {
      if (['imported', 'failed'].includes(ent.name)) continue;
      if (recursive) out.push(...(await collectExcelFiles(full, true)));
      continue;
    }
    if (!/\.(xlsx|xls)$/i.test(ent.name)) continue;
    if (ent.name.startsWith('~$')) continue;
    if (/\.imported\./i.test(ent.name)) continue;
    out.push(full);
  }
  return out;
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
