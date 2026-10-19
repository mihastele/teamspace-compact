const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NamedBoardCreation, newNamedBoard } = require('../.test-build/named-board.js');
const { validateViewConfig } = require('../.test-build/ticket-query.js');
const { randomUUID } = require('node:crypto');

const row = config => ({ ...config, id: 'saved-board', revision: 1, archived: false });

test('named boards start as independent valid board configurations over shared tickets', () => {
  const one = newNamedBoard(), two = newNamedBoard();
  assert.equal(one.layout, 'board');
  assert.deepEqual(validateViewConfig(one, []), one);
  one.query.filter.and.push({ field: 'projectId', op: 'eq', value: 'project-a' });
  one.columns.push('estimate');
  assert.deepEqual(two.query.filter, { and: [] });
  assert.ok(!two.columns.includes('estimate'));
});

test('board creation retries the original immutable packet after an accepted response is lost', async () => {
  const creation = new NamedBoardCreation(), draft = newNamedBoard(), calls = [];
  let ids = 0;
  const createId = () => { ids++; return randomUUID(); };
  const save = async (config, controls) => {
    calls.push(structuredClone({ config, controls }));
    config.name = 'Transport mutation';
    if (calls.length === 1) throw new Error('Lost response');
    return row(calls[0].config);
  };
  await assert.rejects(creation.save(draft, [], createId, save), /Lost response/);
  draft.name = 'Changed after failure';
  const result = await creation.save(draft, [], createId, save);
  assert.equal(result.name, 'New board');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(ids, 1);
});

test('acknowledged board is reused after linking fails and concurrent creates are fenced', async () => {
  const creation = new NamedBoardCreation();
  let finish, writes = 0;
  const save = config => { writes++; return new Promise(resolve => { finish = () => resolve(row(config)); }); };
  const first = creation.save(newNamedBoard(), [], randomUUID, save);
  await assert.rejects(creation.save(newNamedBoard(), [], randomUUID, save), /already in progress/);
  finish();
  const acknowledged = await first;
  // A stale block callback can fail after this acknowledgement; retry links the same row.
  const retried = await creation.save(newNamedBoard(), [], randomUUID, save);
  assert.equal(retried.id, acknowledged.id);
  assert.equal(writes, 1);
});

test('invalid board settings do not reserve a retry identity; ticket and Project filters persist', async () => {
  const creation = new NamedBoardCreation();
  let calls = 0;
  const createId = () => { calls++; return randomUUID(); };
  const invalid = { ...newNamedBoard(), name: '' };
  await assert.rejects(creation.save(invalid, [], createId, async config => row(config)));
  assert.equal(creation.started, false);
  assert.equal(calls, 0);
  const property = { id: randomUUID(), name: 'Related project', type: 'relation', revision: 1, options: [] };
  const config = newNamedBoard();
  config.query.filter = { and: [{ field: 'projectId', op: 'eq', value: 'p1' }, { or: [
    { field: 'priority', op: 'eq', value: 'high' },
    { field: `custom:${property.id}`, op: 'in', value: ['p2', 'p3'] },
  ] }] };
  const saved = await creation.save(config, [property], createId, async input => row(input));
  assert.deepEqual(saved.query.filter, config.query.filter);
  assert.equal(calls, 1);
});
