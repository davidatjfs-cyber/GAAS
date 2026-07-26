import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  normalizeCreatedByUuid,
  normalizeKnowledgeTags,
  parseJsonStringArrayForAudience,
  parseKnowledgeAudienceFromBody,
  canViewerSeeKnowledgeAudience,
  resolveUploadsFile,
} from '../helpers.js';

test('normalizeCreatedByUuid accepts valid uuid only', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(normalizeCreatedByUuid(id), id);
  assert.equal(normalizeCreatedByUuid('not-uuid'), null);
  assert.equal(normalizeCreatedByUuid(''), null);
});

test('normalizeKnowledgeTags merges agent, brand scope, dedupes', () => {
  const tags = normalizeKnowledgeTags(['SOP', '前厅', 'SOP'], 'trainer', 'brand:hongchao');
  assert.deepEqual(tags, ['brand:hongchao', 'agent:trainer', 'SOP', '前厅']);
  assert.equal(normalizeKnowledgeTags([], '', ''), null);
});

test('normalizeKnowledgeTags parses JSON string and comma split', () => {
  assert.deepEqual(normalizeKnowledgeTags('["a","b"]', '', ''), ['a', 'b']);
  assert.deepEqual(normalizeKnowledgeTags('a,b c', '', ''), ['a', 'b', 'c']);
});

test('parseJsonStringArrayForAudience handles array, JSON, comma split', () => {
  assert.deepEqual(parseJsonStringArrayForAudience(['a', ' b ']), ['a', 'b']);
  assert.deepEqual(parseJsonStringArrayForAudience('["x","y"]'), ['x', 'y']);
  assert.deepEqual(parseJsonStringArrayForAudience('x，y'), ['x', 'y']);
  assert.deepEqual(parseJsonStringArrayForAudience(''), []);
});

test('parseKnowledgeAudienceFromBody: store / position / all', () => {
  assert.deepEqual(parseKnowledgeAudienceFromBody({ audienceType: 'all' }), { type: 'all' });
  assert.deepEqual(
    parseKnowledgeAudienceFromBody({ audienceType: 'store', audienceStores: '["洪潮"]' }),
    { type: 'store', stores: ['洪潮'] }
  );
  assert.deepEqual(
    parseKnowledgeAudienceFromBody({ audience_type: 'store', audience_store: '马己仙' }),
    { type: 'store', store: '马己仙', stores: ['马己仙'] }
  );
  assert.deepEqual(
    parseKnowledgeAudienceFromBody({ audienceType: 'position', audiencePositions: ['服务员'] }),
    { type: 'position', positions: ['服务员'] }
  );
  assert.deepEqual(parseKnowledgeAudienceFromBody({ audienceType: 'store' }), { type: 'all' });
});

test('canViewerSeeKnowledgeAudience enforces store and position', () => {
  assert.equal(canViewerSeeKnowledgeAudience({ store: '洪潮' }, { type: 'all' }), true);
  assert.equal(
    canViewerSeeKnowledgeAudience({ store: '洪潮' }, { type: 'store', stores: ['洪潮', '马己仙'] }),
    true
  );
  assert.equal(
    canViewerSeeKnowledgeAudience({ store: '其他' }, { type: 'store', stores: ['洪潮'] }),
    false
  );
  assert.equal(
    canViewerSeeKnowledgeAudience({ position: '服务员' }, { type: 'position', positions: ['服务员'] }),
    true
  );
  assert.equal(
    canViewerSeeKnowledgeAudience({ role: 'admin', position: '' }, { type: 'position', positions: ['系统管理员'] }),
    true
  );
  assert.equal(canViewerSeeKnowledgeAudience({ store: 'x' }, { type: 'store', stores: [] }), false);
});

test('resolveUploadsFile blocks traversal and resolves under uploadsDir', () => {
  const uploadsDir = '/var/uploads';
  assert.equal(resolveUploadsFile(uploadsDir, '/var/uploads/docs/a.pdf'), path.join(uploadsDir, 'docs/a.pdf'));
  assert.equal(resolveUploadsFile(uploadsDir, '/uploads/docs/a.pdf'), path.join(uploadsDir, 'docs/a.pdf'));
  assert.equal(resolveUploadsFile(uploadsDir, '../secret'), null);
  assert.equal(resolveUploadsFile(uploadsDir, ''), null);
  assert.equal(
    resolveUploadsFile(uploadsDir, '/etc/passwd'),
    path.join(uploadsDir, 'etc/passwd')
  );
});
