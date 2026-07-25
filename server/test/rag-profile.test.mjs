/**
 * domains/rag/profile.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getKnowledgeViewerProfile } from '../domains/rag/profile.js';

test('getKnowledgeViewerProfile：无 username；员工/用户合并；getSharedState 抛错', async () => {
  assert.deepEqual(await getKnowledgeViewerProfile({ user: {} }, async () => ({})), {
    username: '',
    role: '',
    store: '',
    position: '',
  });

  const profile = await getKnowledgeViewerProfile(
    { user: { username: 'Alice', role: 'store_manager' } },
    async () => ({
      employees: [{ username: 'alice', store: 'S1', position: '店长' }],
      users: [{ username: 'Alice', store: 'S2', position: '备用' }],
    })
  );
  assert.equal(profile.username, 'Alice');
  assert.equal(profile.store, 'S1');
  assert.equal(profile.position, '店长');

  const fromUser = await getKnowledgeViewerProfile(
    { user: { username: 'bob', role: 'admin' } },
    async () => ({
      employees: [],
      users: [{ username: 'bob', store: 'U店', position: '总部' }],
    })
  );
  assert.equal(fromUser.store, 'U店');

  const err = await getKnowledgeViewerProfile(
    { user: { username: 'x', role: 'r' } },
    async () => {
      throw new Error('state');
    }
  );
  assert.deepEqual(err, { username: 'x', role: 'r', store: '', position: '' });
});
