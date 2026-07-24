import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createEnsureUploadsDir } from '../domains/uploads/ensure-dir.js';
import { createHasColumnHelpers } from '../domains/shared/has-column.js';
import { isWebStaticPathAllowed } from '../domains/health/web-static.js';

test('ensureUploadsDir creates and verifies R/W', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h30-uploads-'));
  const nested = path.join(dir, 'uploads');
  const { ensureUploadsDir } = createEnsureUploadsDir({ fs, uploadsDir: nested });
  const st = ensureUploadsDir();
  assert.equal(st.ok, true);
  assert.ok(fs.existsSync(nested));
});

test('hasColumn rejects empty names; queries information_schema', async () => {
  let params = null;
  const pool = {
    async query(_sql, p) {
      params = p;
      return { rows: [{ '?column?': 1 }] };
    },
  };
  const { hasColumn } = createHasColumnHelpers({ pool });
  assert.equal(await hasColumn('', 'x'), false);
  assert.equal(await hasColumn('t', ''), false);
  assert.equal(await hasColumn('exam_results', 'user_key'), true);
  assert.deepEqual(params, ['exam_results', 'user_key']);
});

test('isWebStaticPathAllowed whitelist', () => {
  assert.equal(isWebStaticPathAllowed('working-fixed.html'), true);
  assert.equal(isWebStaticPathAllowed('/assets/x.png'), true);
  assert.equal(isWebStaticPathAllowed('app.abc123.js'), true);
  assert.equal(isWebStaticPathAllowed('server/index.js'), false);
  assert.equal(isWebStaticPathAllowed('migrations/001.sql'), false);
});
