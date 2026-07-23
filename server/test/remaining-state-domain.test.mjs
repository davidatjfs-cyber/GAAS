import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUserRecord,
  upsertUsersInList,
  removeUserFromList,
  removeAnnouncementFromList,
} from '../domains/remaining-state/service.js';
import { STATE_PUT_WHITELIST, STATE_PUT_SERVER_OWNED, applyStatePutWhitelist } from '../hrms-state-put.js';

test('A3 终态：白名单仅 settings', () => {
  assert.deepEqual([...STATE_PUT_WHITELIST], ['settings']);
});

test('剩余业务字段均 SERVER_OWNED 且 PUT 不能覆盖', () => {
  const keys = [
    'users',
    'announcements',
    'examAssignments',
    'questionBank',
    'questionSets',
    'trainingTasks',
    'trainingMaterials',
  ];
  for (const k of keys) {
    assert.equal(STATE_PUT_WHITELIST.includes(k), false, k + ' still whitelisted');
    assert.ok(STATE_PUT_SERVER_OWNED.includes(k), k + ' not server-owned');
  }
  const existing = {
    users: [{ username: 'alice', name: 'Alice' }],
    announcements: [{ id: 'a1', title: '旧' }],
    examAssignments: [{ id: 'e1' }],
    questionBank: [{ id: 'q1' }],
    questionSets: [[{ id: 'q1' }]],
    trainingTasks: [{ id: 't1' }],
    trainingMaterials: [{ id: 'm1' }],
    settings: { theme: 'old' },
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, {
    users: [{ username: 'hack' }],
    announcements: [{ id: 'hack' }],
    examAssignments: [{ id: 'hack' }],
    questionBank: [{ id: 'hack' }],
    questionSets: [[{ id: 'hack' }]],
    trainingTasks: [{ id: 'hack' }],
    trainingMaterials: [{ id: 'hack' }],
    settings: { theme: 'new' },
  });
  assert.equal(next.users[0].username, 'alice');
  assert.equal(next.announcements[0].id, 'a1');
  assert.equal(next.examAssignments[0].id, 'e1');
  assert.equal(next.questionBank[0].id, 'q1');
  assert.equal(next.trainingMaterials[0].id, 'm1');
  assert.equal(next.settings.theme, 'new');
  for (const k of keys) assert.ok(ignoredKeys.includes(k), 'ignored ' + k);
});

test('normalizeUserRecord / upsert / remove users', () => {
  assert.equal(normalizeUserRecord({}), null);
  const u = normalizeUserRecord({ username: ' Bob ', name: 'B', role: 'staff' });
  assert.equal(u.username, 'Bob');
  const { list, upserted } = upsertUsersInList(
    [{ username: 'alice', name: 'A1', role: 'admin' }],
    [{ username: 'alice', name: 'A2' }, { username: 'bob', name: 'B' }]
  );
  assert.equal(upserted.length, 2);
  assert.equal(list.find((x) => x.username === 'alice').name, 'A2');
  assert.equal(list.find((x) => x.username === 'alice').role, 'admin');
  assert.ok(list.some((x) => x.username === 'bob'));
  const rm = removeUserFromList(list, 'alice');
  assert.equal(rm.ok, true);
  assert.equal(rm.list.length, 1);
  assert.equal(removeUserFromList(list, 'nobody').ok, false);
});

test('removeAnnouncementFromList', () => {
  const list = [{ id: 'a1' }, { id: 'a2' }];
  const ok = removeAnnouncementFromList(list, 'a1');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.list.map((x) => x.id), ['a2']);
  assert.equal(removeAnnouncementFromList(list, 'x').ok, false);
});
