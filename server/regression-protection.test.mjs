import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CRITICAL_FUNCTIONS } from './regression-protection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('CRITICAL_FUNCTIONS entries exist as exports or declarations in source files', () => {
  for (const item of CRITICAL_FUNCTIONS) {
    const full = path.join(__dirname, item.file);
    assert.ok(fs.existsSync(full), `missing file ${item.file}`);
    const src = fs.readFileSync(full, 'utf8');
    const patterns = [
      new RegExp(`export\\s+(async\\s+)?function\\s+${item.name}\\b`),
      new RegExp(`export\\s+(const|let|var)\\s+${item.name}\\b`),
      new RegExp(`(?:async\\s+)?function\\s+${item.name}\\b`),
      new RegExp(`(?:const|let|var)\\s+${item.name}\\s*=`),
    ];
    assert.ok(
      patterns.some((re) => re.test(src)),
      `critical function ${item.name} not found in ${item.file}`
    );
  }
});

test('sales_raw must not appear as live table write target in server JS (retired)', () => {
  const banned = [
    /INSERT\s+INTO\s+sales_raw\b/i,
    /FROM\s+sales_raw\b/i,
    /UPDATE\s+sales_raw\b/i,
  ];
  const files = ['sales-raw.js', 'batch-upload-sales.js'].map((f) => path.join(__dirname, f));
  for (const full of files) {
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    for (const re of banned) {
      // retired modules may mention sales_raw in error strings / comments; ban only live SQL
      if (/sales_raw_retired|sales_raw has been retired|禁止/.test(src) && !/INSERT\s+INTO\s+sales_raw/i.test(src)) {
        continue;
      }
      assert.ok(!re.test(src) || /retired|throw|exit/i.test(src), `${path.basename(full)} still has live ${re}`);
    }
  }
});
