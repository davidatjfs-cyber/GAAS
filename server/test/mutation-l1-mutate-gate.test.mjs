/**
 * Mutation L1 mutate allowlist must stay a subset of l1-coverage-floor files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('mutation-l1-mutate.json 文件存在且属于 l1-coverage-floor', () => {
  const floor = JSON.parse(fs.readFileSync(path.join(root, 'l1-coverage-floor.json'), 'utf8'));
  const mutate = JSON.parse(fs.readFileSync(path.join(root, 'mutation-l1-mutate.json'), 'utf8'));
  assert.ok(Array.isArray(mutate.files) && mutate.files.length > 0);
  const floorSet = new Set(Object.keys(floor.files || {}));
  for (const f of mutate.files) {
    assert.ok(floorSet.has(f), `mutate file missing from L1 floor: ${f}`);
    assert.ok(fs.existsSync(path.join(root, f)), `mutate file missing on disk: ${f}`);
  }
});

test('stryker.conf.mjs 默认走 mutation-l1-mutate（非全量 floor）', () => {
  const src = fs.readFileSync(path.join(root, 'stryker.conf.mjs'), 'utf8');
  assert.match(src, /mutation-l1-mutate\.json/);
  assert.match(src, /MUTATION_MUTATE=all/);
});
