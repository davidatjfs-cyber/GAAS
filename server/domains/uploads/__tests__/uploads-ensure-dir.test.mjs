/**
 * domains/uploads/ensure-dir.js 失败分支
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnsureUploadsDir } from '../ensure-dir.js';

test('ensureUploadsDir：mkdir 失败 → ok false', () => {
  const { ensureUploadsDir } = createEnsureUploadsDir({
    fs: {
      mkdirSync() {
        throw new Error('eperm');
      },
      constants: { R_OK: 4, W_OK: 2 },
    },
    uploadsDir: '/tmp/x',
  });
  assert.deepEqual(ensureUploadsDir(), { ok: false, error: 'internal_error' });
});

test('ensureUploadsDir：access 失败 → ok false', () => {
  const { ensureUploadsDir } = createEnsureUploadsDir({
    fs: {
      mkdirSync() {},
      accessSync() {
        throw new Error('eacces');
      },
      constants: { R_OK: 4, W_OK: 2 },
    },
    uploadsDir: '/tmp/x',
  });
  assert.deepEqual(ensureUploadsDir(), { ok: false, error: 'internal_error' });
});
