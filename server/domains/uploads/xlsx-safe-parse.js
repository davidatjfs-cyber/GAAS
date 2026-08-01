/**
 * Sandboxed xlsx parsing for untrusted uploads.
 *
 * xlsx@0.18.5 has two unpatched advisories (prototype pollution, ReDoS —
 * no fix available upstream). Since the parser runs on user-uploaded files
 * and this is a multi-tenant service, a malicious file must not be able to
 * hang or crash the shared Node process. This isolates XLSX.readFile /
 * sheet_to_json in a worker thread with a hard timeout and a byte-size
 * pre-check, and bounds the parsed result (sheets/rows/cells) so downstream
 * code can't be handed unbounded data even on success.
 *
 * The caller's promise settles as soon as the timeout/message/error fires —
 * it never waits on worker.terminate() itself, because V8's termination of
 * a tight synchronous loop can take longer than we want the caller to wait.
 * Termination is still requested (fire-and-forget) so the OS thread is torn
 * down; that happens on a separate, isolated thread so it never blocks the
 * main event loop other requests are running on.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, 'xlsx-parse-worker.mjs');

const DEFAULTS = {
  maxBytes: 15 * 1024 * 1024, // 15MB — generous for a single onboarding report
  timeoutMs: 10_000,
  maxSheets: 20,
  maxRowsPerSheet: 50_000,
  maxCellsPerRow: 200,
};

/**
 * @param {string} filePath
 * @param {object} [opts]
 * @param {object} [opts.readOpts] - passed to XLSX.readFile
 * @param {object} [opts.sheetToJsonOpts] - passed to XLSX.utils.sheet_to_json
 * @returns {Promise<{sheetNames: string[], sheets: Record<string, any[]>}>}
 */
export function parseXlsxSafely(filePath, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return Promise.reject(new Error(`xlsx_stat_failed: ${String(e?.message || e)}`));
  }
  if (stat.size > cfg.maxBytes) {
    return Promise.reject(new Error(`xlsx_too_large: ${stat.size} bytes exceeds ${cfg.maxBytes}`));
  }

  const worker = new Worker(WORKER_PATH, {
    workerData: {
      filePath,
      readOpts: cfg.readOpts,
      sheetToJsonOpts: cfg.sheetToJsonOpts,
      maxSheets: cfg.maxSheets,
      maxRowsPerSheet: cfg.maxRowsPerSheet,
      maxCellsPerRow: cfg.maxCellsPerRow,
      __testForceHang: cfg.__testForceHang,
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(arg);
    };

    const timer = setTimeout(() => {
      settle(reject, new Error(`xlsx_parse_timeout: exceeded ${cfg.timeoutMs}ms`));
    }, cfg.timeoutMs);

    worker.once('message', (msg) => {
      if (msg?.ok) return settle(resolve, msg.result);
      settle(reject, new Error(`xlsx_parse_failed: ${msg?.error || 'unknown'}`));
    });

    worker.once('error', (err) => {
      settle(reject, new Error(`xlsx_worker_error: ${String(err?.message || err)}`));
    });

    worker.once('exit', (code) => {
      settle(reject, new Error(`xlsx_worker_exit: code ${code}`));
    });
  });
}
