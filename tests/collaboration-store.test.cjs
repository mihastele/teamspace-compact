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
