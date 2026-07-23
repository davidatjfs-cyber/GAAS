#!/usr/bin/env node
/** 将 GAAS/packages/gaas-shared 同步到 agents-service-v2/packages/gaas-shared（GAAS 为权威）。 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAAS_SHARED = join(__dirname, '../packages/gaas-shared');
const AGENTS_SHARED = join(__dirname, '../../agents-service-v2/packages/gaas-shared');

if (!existsSync(GAAS_SHARED)) {
  console.error('missing', GAAS_SHARED);
  process.exit(1);
}
rmSync(AGENTS_SHARED, { recursive: true, force: true });
mkdirSync(dirname(AGENTS_SHARED), { recursive: true });
cpSync(GAAS_SHARED, AGENTS_SHARED, { recursive: true });
console.log('synced @gaas/shared →', AGENTS_SHARED);
