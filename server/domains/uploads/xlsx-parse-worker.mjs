/**
 * Worker-thread entry: parses an untrusted .xlsx/.xls file in isolation.
 *
 * xlsx@0.18.5 has unpatched prototype-pollution / ReDoS advisories (no fix
 * available upstream). Running the parse here means a malicious file can at
 * worst hang or crash *this* worker — the caller enforces a timeout and
 * terminates it — instead of blocking the single-threaded main event loop
 * for every tenant.
 */
import { parentPort, workerData } from 'worker_threads';
import XLSX from 'xlsx';

function run() {
  const { filePath, readOpts, sheetToJsonOpts, maxSheets, maxRowsPerSheet, maxCellsPerRow, __testForceHang } = workerData;
  if (__testForceHang) {
    // Test-only hook: simulate a pathological parse (e.g. ReDoS) hanging the
    // worker, so callers can assert the timeout in xlsx-safe-parse.js fires
    // and terminates this thread instead of the whole process. Not reachable
    // from production callers (they never set this flag).
    for (;;) { /* spin */ }
  }
  const workbook = XLSX.readFile(filePath, readOpts || {});
  const sheetNames = (Array.isArray(workbook.SheetNames) ? workbook.SheetNames : []).slice(0, maxSheets);
  const sheets = {};
  for (const name of sheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    let matrix = XLSX.utils.sheet_to_json(ws, sheetToJsonOpts || { header: 1, defval: '' });
    if (matrix.length > maxRowsPerSheet) matrix = matrix.slice(0, maxRowsPerSheet);
    if (maxCellsPerRow) {
      matrix = matrix.map((row) => (Array.isArray(row) ? row.slice(0, maxCellsPerRow) : row));
    }
    sheets[name] = matrix;
  }
  return { sheetNames, sheets };
}

try {
  const result = run();
  parentPort.postMessage({ ok: true, result });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e?.message || e) });
}
