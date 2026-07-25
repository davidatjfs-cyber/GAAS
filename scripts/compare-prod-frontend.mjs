#!/usr/bin/env node
/**
 * 正确对比前端：生产 shell 是「抽壳」产物，不能拿本地 monolith working-fixed.html 直接 md5。
 * 口径：本地 `npm run build:shell` → dist/working-fixed.html + app.*.js/css vs 生产同名文件。
 *
 * Usage: node scripts/compare-prod-frontend.mjs
 * Env: DEPLOY_HOST=root@47.100.96.30  REMOTE_DIR=/opt/hrms
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const HOST = process.env.DEPLOY_HOST || 'root@47.100.96.30';
const REMOTE = process.env.REMOTE_DIR || '/opt/hrms';

function md5File(p) {
  return createHash('md5').update(readFileSync(p)).digest('hex');
}

function remoteMd5(rel) {
  const out = execFileSync(
    'ssh',
    ['-o', 'ConnectTimeout=30', HOST, `md5sum ${REMOTE}/${rel} 2>/dev/null | awk '{print $1}'`],
    { encoding: 'utf8' }
  ).trim();
  return out || null;
}

if (!existsSync(join(DIST, 'working-fixed.html'))) {
  console.error('缺少 dist/working-fixed.html，请先：npm run build:shell');
  process.exit(2);
}

const shellLocal = md5File(join(DIST, 'working-fixed.html'));
const shellRemote = remoteMd5('working-fixed.html');
const refs = String(readFileSync(join(DIST, 'working-fixed.html'), 'utf8')).match(
  /app\.[a-f0-9]+\.(?:js|css)/g
);
const assets = [...new Set(refs || [])];

console.log('=== frontend prod compare (dist shell 口径) ===');
console.log(`shell local : ${shellLocal}`);
console.log(`shell remote: ${shellRemote || '(missing)'}`);
console.log(`shell match : ${shellLocal === shellRemote ? 'YES' : 'NO'}`);

let allOk = shellLocal === shellRemote;
for (const name of assets) {
  const localPath = join(DIST, name);
  if (!existsSync(localPath)) {
    console.log(`asset ${name}: LOCAL MISSING`);
    allOk = false;
    continue;
  }
  const l = md5File(localPath);
  const r = remoteMd5(name);
  const ok = l === r;
  if (!ok) allOk = false;
  console.log(`asset ${name}: ${ok ? 'YES' : 'NO'} local=${l} remote=${r || '(missing)'}`);
}

const monolith = join(ROOT, 'working-fixed.html');
if (existsSync(monolith)) {
  const m = md5File(monolith);
  console.log('');
  console.log('note: 本地 monolith working-fixed.html md5 =', m);
  console.log('      它与生产 shell 不同是正常的（生产是抽壳 HTML），不要用这个判断漂移。');
}

const distFiles = readdirSync(DIST);
console.log('');
console.log('dist/:', distFiles.join(', '));
process.exit(allOk ? 0 : 1);
