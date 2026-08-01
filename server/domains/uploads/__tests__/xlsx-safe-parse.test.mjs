import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import XLSX from 'xlsx';
import { parseXlsxSafely } from '../xlsx-safe-parse.js';

function writeSampleXlsx(dir) {
  const filePath = path.join(dir, 'sample.xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['a', 'b'],
    [1, 2],
    [3, 4],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filePath);
  return filePath;
}

test('parseXlsxSafely: parses a well-formed workbook in a worker', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-safe-'));
  const filePath = writeSampleXlsx(dir);
  const result = await parseXlsxSafely(filePath, {
    sheetToJsonOpts: { header: 1, defval: '' },
  });
  assert.deepEqual(result.sheetNames, ['Sheet1']);
  assert.deepEqual(result.sheets.Sheet1, [['a', 'b'], [1, 2], [3, 4]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseXlsxSafely: rejects files over the byte-size cap without spawning a worker', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-safe-'));
  const filePath = writeSampleXlsx(dir);
  await assert.rejects(
    () => parseXlsxSafely(filePath, { maxBytes: 1 }),
    /xlsx_too_large/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseXlsxSafely: a hung/slow parse is terminated by the timeout instead of blocking forever', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-safe-'));
  const filePath = writeSampleXlsx(dir);
  const start = Date.now();
  await assert.rejects(
    () => parseXlsxSafely(filePath, { timeoutMs: 50, __testForceHang: true }),
    /xlsx_parse_timeout/
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `expected timeout to fire quickly, took ${elapsed}ms`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseXlsxSafely: bounds rows/sheets/cells on the returned data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-safe-'));
  const filePath = path.join(dir, 'big.xlsx');
  const rows = [['a', 'b']];
  for (let i = 0; i < 20; i += 1) rows.push([i, i * 2]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Big');
  XLSX.writeFile(wb, filePath);

  const result = await parseXlsxSafely(filePath, {
    sheetToJsonOpts: { header: 1, defval: '' },
    maxRowsPerSheet: 5,
  });
  assert.equal(result.sheets.Big.length, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});
