import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRootDiskHealthInfo } from '../disk.js';

const GiB = 1024 ** 3;

function mockStatfs({ totalGb, availGb, bsize = 4096 }) {
  const total = totalGb * GiB;
  const avail = availGb * GiB;
  return async () => ({
    bsize,
    blocks: total / bsize,
    bavail: avail / bsize,
  });
}

test('buildRootDiskHealthInfo: ok shape when plenty of free space', async () => {
  const info = await buildRootDiskHealthInfo(mockStatfs({ totalGb: 100, availGb: 50 }));
  assert.equal(info.path, '/');
  assert.equal(info.error, undefined);
  assert.equal(info.level, 'ok');
  assert.equal(info.message, null);
  assert.equal(info.totalGb, 100);
  assert.equal(info.availGb, 50);
  assert.equal(info.usedPercent, 50);
  assert.equal(typeof info.totalBytes, 'number');
  assert.equal(typeof info.availBytes, 'number');
});

test('buildRootDiskHealthInfo: notice around 72% used', async () => {
  const info = await buildRootDiskHealthInfo(mockStatfs({ totalGb: 100, availGb: 25 }));
  assert.equal(info.level, 'notice');
  assert.match(String(info.message), /已用约/);
});

test('buildRootDiskHealthInfo: warn when avail < 20GiB', async () => {
  const info = await buildRootDiskHealthInfo(mockStatfs({ totalGb: 100, availGb: 15 }));
  assert.equal(info.level, 'warn');
  assert.match(String(info.message), /空间紧张/);
});

test('buildRootDiskHealthInfo: crit when avail < 2GiB', async () => {
  const info = await buildRootDiskHealthInfo(mockStatfs({ totalGb: 100, availGb: 1 }));
  assert.equal(info.level, 'crit');
  assert.match(String(info.message), /危急/);
});

test('buildRootDiskHealthInfo: error shape when statfs throws', async () => {
  const info = await buildRootDiskHealthInfo(async () => {
    throw new Error('boom');
  });
  assert.deepEqual(info, { path: '/', error: 'internal_error' });
});
