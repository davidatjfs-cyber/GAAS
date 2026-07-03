import test from 'node:test';
import assert from 'node:assert/strict';

import { OBJECT_REGISTRY, getObject, listObjectTypes, validateRegistry } from './objects.js';

test('getObject returns the registered definition', () => {
  const store = getObject('store');
  assert.equal(store.table, 'stores');
  assert.equal(store.keyField, 'name');
});

test('getObject throws on unknown type', () => {
  assert.throws(() => getObject('nonexistent'), /unknown object type/);
});

test('listObjectTypes returns all registered keys', () => {
  assert.deepEqual(listObjectTypes().sort(), Object.keys(OBJECT_REGISTRY).sort());
});

test('validateRegistry passes on the real registry (every link target is registered)', () => {
  assert.deepEqual(validateRegistry(), []);
});

test('task and dish objects link back to store', () => {
  assert.equal(getObject('task').links.store.to, 'store');
  assert.equal(getObject('dish').links.store.to, 'store');
});

test('validateRegistry catches a dangling link target', () => {
  const broken = {
    store: { table: 'stores', keyField: 'name', links: { ghost: { to: 'nope', via: 'x' } } },
  };
  const errors = validateRegistry(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nope/);
});
