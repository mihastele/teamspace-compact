const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotRunner, collectionSnapshotRows, SnapshotReadError, terminalSnapshotReadFailure } = require('../.test-build/browser-sync.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const reads = [], values = [], failures = [];
  let current = true;
  const runner = createSnapshotRunner({
    read: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    publish: value => values.push(value), fail: error => failures.push(error), isCurrent: () => current,
  });
  return { runner, reads, values, failures, leave: () => { current = false; } };
}
test('in-flight invalidation suppresses stale snapshot and serializes reconnect reads', async () => {
  const h = harness();
  h.runner.invalidate(); h.runner.invalidate(); h.runner.invalidate();
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve('stale'); await tick();
  assert.deepEqual(h.values, []); assert.equal(h.reads.length, 2);
  h.reads[1].resolve('fresh'); await tick();
  assert.deepEqual(h.values, ['fresh']);
  h.runner.invalidate(); h.reads[2].reject(new Error('offline')); await tick();
  assert.equal(h.failures.length, 1);
  h.runner.invalidate(); h.reads[3].resolve('reconnected'); await tick();
  assert.deepEqual(h.values, ['fresh', 'reconnected']);
});
test('switching documents and disposal fence late results, errors and duplicate invalidation', async () => {
  for (const end of ['stop', 'leave']) {
    const h = harness(); h.runner.invalidate();
    if (end === 'stop') h.runner.stop(); else h.leave();
    h.reads[0].resolve('old-document'); await tick();
    assert.deepEqual(h.values, []); assert.deepEqual(h.failures, []);
    if (end === 'stop') { h.runner.invalidate(); assert.equal(h.reads.length, 1); }
  }
  const h = harness(); h.runner.invalidate(); h.runner.stop();
  h.reads[0].reject(new Error('late-error')); await tick();
  assert.deepEqual(h.failures, []);
});
test('entity snapshots preserve comments/presence and malformed data cannot become deletion', () => {
  const comments = [{ id: 'a', body: 'hello' }];
  assert.deepEqual(collectionSnapshotRows('workspaces/w/notes/n/comments', { comments }), { 'workspaces/w/notes/n/comments': comments });
  assert.deepEqual(collectionSnapshotRows('workspaces/w/notes/n/presence', { presence: [{ id: 'p' }] }), { 'workspaces/w/notes/n/presence': [{ id: 'p' }] });
  assert.throws(() => collectionSnapshotRows('workspaces/w/notes/n/comments', { rows: [] }));
  assert.throws(() => collectionSnapshotRows('workspaces/w/snapshot', { tasks: [], notes: [], members: [] }));
  assert.throws(() => collectionSnapshotRows('workspaces/w/notes/n/comments', { comments: [{ body: 'missing id' }] }));
});
test('shared workspace snapshots deliver custom properties alongside tasks and reject malformed definitions', () => {
  const property={id:'field',name:'Priority'};
  const data={tasks:[],notes:[],members:[],attachments:[],boardProperties:[property]};
  assert.deepEqual(collectionSnapshotRows('workspaces/w/snapshot',data)['workspaces/w/boardProperties'],[property]);
  assert.throws(()=>collectionSnapshotRows('workspaces/w/snapshot',{...data,boardProperties:[{name:'missing id'}]}));
});
test('transient offline and server read failures retain the previous snapshot; revoked access is terminal', () => {
  for(const error of [new TypeError('network lost'),new SnapshotReadError('busy',503),new SnapshotReadError('limited',429)]) assert.equal(terminalSnapshotReadFailure(error),false);
  for(const status of [401,403,404])assert.equal(terminalSnapshotReadFailure(new SnapshotReadError('denied',status)),true);
});
test('periodic reconciliation cannot starve a slow in-flight snapshot', async () => {
  const h=harness();h.runner.invalidate();
  for(let index=0;index<10;index++)h.runner.invalidate(true);
  h.reads[0].resolve('slow but current');await tick();
  assert.deepEqual(h.values,['slow but current']);assert.equal(h.reads.length,1);
});
