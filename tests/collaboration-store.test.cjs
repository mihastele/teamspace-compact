const { test } = require("node:test");
const assert = require("node:assert/strict");
const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
const {
  indexedRecoveryStore,
} = require("../.test-build/collaboration-store.js");
const {
  initializeDocument,
  encodeDocument,
  decodeDocument,
  readContent,
  applyEditorContent,
} = require("../.test-build/collaboration-model.js");
function setup() {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  const held = new Set();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      async request(name, options, callback) {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name });
        } finally {
          held.delete(name);
        }
      },
    },
  });
  return held;
}
function record() {
  const doc = initializeDocument({
    blocks: [{ type: "paragraph", text: "Local work" }],
  });
  return {
    version: 1,
    generation: crypto.randomUUID(),
    state: encodeDocument(doc),
    sequence: 0,
    pending: [
      { operationId: crypto.randomUUID(), update: "AAA=", sent: false },
    ],
  };
}
test("IndexedDB journal survives a fresh store connection and isolates users/workspaces", async () => {
  setup();
  const value = record();
  await indexedRecoveryStore("alice:alpha:note:session").save(value);
  assert.deepEqual(
    await indexedRecoveryStore("alice:alpha:note:session").load(),
    value,
  );
  assert.equal(
    await indexedRecoveryStore("bob:alpha:note:session").load(),
    null,
  );
  assert.equal(
    await indexedRecoveryStore("alice:other:note:session").load(),
    null,
  );
});
test("closed-tab journal is adopted atomically while active-tab work stays owned", async () => {
  const held = setup();
  const closed = record(),
    active = {
      ...closed,
      pending: [
        { operationId: crypto.randomUUID(), update: "AAA=", sent: false },
      ],
    };
  await indexedRecoveryStore("alice:alpha:note:closed").save(closed);
  await indexedRecoveryStore("alice:alpha:note:active").save(active);
  held.add("teamspace-recovery:alice:alpha:note:active");
  const opened = indexedRecoveryStore("alice:alpha:note:opened");
  assert.deepEqual(await opened.load(), closed);
  // The active writer is neither stolen nor cleared during adoption.
  held.add("teamspace-recovery:alice:alpha:note:opened");
  assert.deepEqual(
    await indexedRecoveryStore("alice:alpha:note:active").load(),
    active,
  );
  assert.equal(
    await indexedRecoveryStore("alice:alpha:note:closed").load(),
    null,
  );
});
test("recovering two closed journals merges CRDT states and retains both ordered queues", async () => {
  setup();
  const first = record();
  const second = structuredClone(first);
  const doc = decodeDocument(first.state),
    before = readContent(doc),
    next = structuredClone(before);
  next.blocks[0].text = "Local work from another tab";
  applyEditorContent(doc, before, next);
  second.state = encodeDocument(doc);
  second.pending[0].operationId = crypto.randomUUID();
  await indexedRecoveryStore("alice:alpha:note:one").save(first);
  await indexedRecoveryStore("alice:alpha:note:two").save(second);
  const result = await indexedRecoveryStore("alice:alpha:note:opened").load();
  assert.equal(result.pending.length, 2);
  assert.equal(
    readContent(decodeDocument(result.state)).blocks[0].text,
    "Local work from another tab",
  );
});
test("a different document generation is retained separately instead of discarded", async () => {
  const held = setup();
  const current = record(),
    old = record();
  await indexedRecoveryStore("alice:alpha:note:current").save(current);
  await indexedRecoveryStore("alice:alpha:note:old").save(old);
  assert.deepEqual(
    await indexedRecoveryStore("alice:alpha:note:current").load(),
    current,
  );
  held.add("teamspace-recovery:alice:alpha:note:current");
  assert.deepEqual(
    await indexedRecoveryStore("alice:alpha:note:old").load(),
    old,
  );
});

test("generation archive atomically retains pending work and is never reclaimed as active edits", async () => {
  setup();
  const value = record();
  const store = indexedRecoveryStore("alice:alpha:note:session");
  await store.save(value);
  await store.archiveGeneration(value.generation);
  assert.equal(await store.load(), null);
  const fresh = indexedRecoveryStore("alice:alpha:note:new-session");
  assert.equal(await fresh.load(), null);
  assert.equal((await fresh.archivedContent()).blocks[0].text, "Local work");
  assert.equal(
    await indexedRecoveryStore("bob:alpha:note:new-session").archivedContent(),
    null,
  );
  assert.equal(
    await indexedRecoveryStore(
      "alice:other:note:new-session",
    ).archivedContent(),
    null,
  );
});

test("archiving a mismatched generation rejects without deleting or replacing its active journal", async () => {
  setup();
  const value = record();
  const store = indexedRecoveryStore("alice:alpha:note:session");
  await store.save(value);
  await assert.rejects(
    store.archiveGeneration(crypto.randomUUID()),
    /retained/,
  );
  assert.deepEqual(await store.load(), value);
  assert.equal(await store.archivedContent(), null);
  await assert.rejects(
    indexedRecoveryStore("alice:alpha:other:empty").archiveGeneration(
      value.generation,
    ),
    /retained/,
  );
});

test("archived content selects the latest local archive even with equal wall clocks while active new-generation state stays separate", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  setup();
  const store = indexedRecoveryStore("alice:alpha:note:session");
  const old = record();
  await store.save(old);
  await store.archiveGeneration(old.generation);
  const newer = record();
  const doc = decodeDocument(newer.state);
  const before = readContent(doc),
    next = structuredClone(before);
  next.blocks[0].text = "Latest archive";
  applyEditorContent(doc, before, next);
  newer.state = encodeDocument(doc);
  doc.destroy();
  await store.save(newer);
  await store.archiveGeneration(newer.generation);
  const active = record();
  await store.save(active);
  assert.equal(
    (await store.archivedContent()).blocks[0].text,
    "Latest archive",
  );
  assert.deepEqual(await store.load(), active);
});

async function putArchiveRows(entries) {
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('teamspace-collaboration-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('notes');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try {await new Promise((resolve,reject)=>{const transaction=db.transaction('notes','readwrite');for(const [key,value] of entries)transaction.objectStore('notes').put(value,key);transaction.oncomplete=resolve;transaction.onabort=transaction.onerror=()=>reject(transaction.error);});}
  finally {db.close();}
}

test('archive browsing pages newest first, survives newer insertions, and never reads or rewrites active journals',async()=>{
  setup();const store=indexedRecoveryStore('alice:alpha:note:session'),value=record();
  await putArchiveRows(Array.from({length:25},(_,i)=>[`alice:alpha:note:closed:archive:${String(i).padStart(2,'0')}`,{...value,archived:true,archivedAt:1000+i}]));
  const active=record();await store.save(active);
  const first=await store.listArchives();assert.equal(first.archives.length,20);assert.equal(first.archives[0].archivedAt,1024);assert.equal(first.archives[19].archivedAt,1005);assert.ok(first.next);
  assert.equal('state' in first.archives[0],false);assert.equal('content' in first.archives[0],false);
  await putArchiveRows([['alice:alpha:note:new:archive:latest',{...value,archived:true,archivedAt:2000}]]);
  const second=await store.listArchives(first.next);assert.equal(second.archives.length,5);assert.equal(second.next,null);assert.equal(second.archives[0].archivedAt,1004);
  assert.equal(new Set([...first.archives,...second.archives].map(row=>row.id)).size,25);
  assert.equal((await store.listArchives()).archives[0].archivedAt,2000);
  assert.equal((await store.readArchive(second.archives[4].id)).blocks[0].text,'Local work');assert.deepEqual(await store.load(),active);
  await assert.rejects(store.readArchive('alice:alpha:note:session'),/unavailable/);assert.deepEqual(await store.load(),active);
});

test('archive IDs and cursors cannot cross account, workspace or note boundaries',async()=>{
  setup();const value=record();await putArchiveRows([
    ['alice:alpha:note:one:archive:a',{...value,archived:true,archivedAt:100}],
    ['bob:alpha:note:one:archive:b',{...value,archived:true,archivedAt:101}],
    ['alice:other:note:one:archive:c',{...value,archived:true,archivedAt:102}],
    ['alice:alpha:note-two:one:archive:d',{...value,archived:true,archivedAt:103}],
  ]);
  const store=indexedRecoveryStore('alice:alpha:note:browser');assert.equal((await store.listArchives()).archives.length,1);
  for(const foreign of ['bob:alpha:note:one:archive:b','alice:other:note:one:archive:c','alice:alpha:note-two:one:archive:d']){
    await assert.rejects(store.readArchive(foreign),/different/);await assert.rejects(store.listArchives({id:foreign,archivedAt:200}),/cursor/);
  }
  await assert.rejects(store.listArchives(undefined,0),/size/);await assert.rejects(store.listArchives(undefined,51),/size/);
  await assert.rejects(store.listArchives({id:'alice:alpha:note:one:archive:a',archivedAt:NaN}),/cursor/);
});

test('equal archive timestamps use stable key ties and missing timestamps remain accessible',async()=>{
  setup();const value=record();await putArchiveRows(['a','b','c'].map(id=>[`alice:alpha:note:session:archive:${id}`,{...value,archived:true,archivedAt:1000}]));
  await putArchiveRows([['alice:alpha:note:session:archive:legacy',{...value,archived:true}]]);
  const store=indexedRecoveryStore('alice:alpha:note:browser'),first=await store.listArchives(undefined,2),second=await store.listArchives(first.next,2);
  assert.deepEqual(first.archives.map(row=>row.id.split(':').at(-1)),['c','b']);assert.deepEqual(second.archives.map(row=>row.id.split(':').at(-1)),['a','legacy']);assert.equal(second.next,null);assert.equal(second.archives[1].archivedAt,0);
});

test('a corrupt newest archive can be listed without decoding and does not hide older recovery',async()=>{
  setup();const value=record(),good='alice:alpha:note:session:archive:good',bad='alice:alpha:note:session:archive:bad';
  await putArchiveRows([[good,{...value,archived:true,archivedAt:100}],[bad,{...value,state:'not a checkpoint',archived:true,archivedAt:200}],['alice:alpha:note:session:broken',null]]);
  const store=indexedRecoveryStore('alice:alpha:note:browser');assert.equal((await store.listArchives()).archives.length,2);
  await assert.rejects(store.archivedContent());
  await assert.rejects(store.readArchive(bad));assert.equal((await store.readArchive(good)).blocks[0].text,'Local work');
  assert.equal((await store.listArchives()).archives.length,2);await assert.rejects(store.readArchive('alice:alpha:note:session:archive:missing'),/unavailable/);
});

test('malformed archive metadata cannot poison the timestamp of a newly archived generation',async()=>{
  setup();const value=record(),store=indexedRecoveryStore('alice:alpha:note:session');
  await putArchiveRows([['alice:alpha:note:old:archive:bad-time',{...value,state:'not a checkpoint',archived:true,archivedAt:Infinity}],['alice:alpha:note:old:invalid',null]]);
  await store.save(value);await store.archiveGeneration(value.generation);
  const page=await store.listArchives();assert.equal(page.archives.length,2);assert.ok(page.archives[0].archivedAt>0);assert.ok(Number.isFinite(page.archives[0].archivedAt));assert.equal(page.archives[1].archivedAt,0);
  assert.equal((await store.readArchive(page.archives[0].id)).blocks[0].text,'Local work');
  assert.equal((await store.archivedContent()).blocks[0].text,'Local work');
});
