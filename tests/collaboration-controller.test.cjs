const { test } = require("node:test");
const assert = require("node:assert/strict");
const Y = require("yjs");
const {
  CollaborationController,
} = require("../.test-build/collaboration-controller.js");
const {
  initializeDocument,
  encodeDocument,
  decodeDocument,
  readContent,
  applyEditorContent,
  fromBase64,
  validateDocument,
} = require("../.test-build/collaboration-model.js");
const drain = async () => {
  for (let i = 0; i < 70; i++) await Promise.resolve();
};
function memoryStore() {
  return {
    record: null,
    failing: false,
    async load() {
      return structuredClone(this.record);
    },
    async save(record) {
      if (this.failing) throw new Error("Storage unavailable");
      this.record = structuredClone(record);
    },
  };
}
function server() {
  const doc = initializeDocument({
    blocks: [
      { type: "paragraph", text: "First" },
      { type: "paragraph", text: "Second" },
    ],
  });
  const generation = crypto.randomUUID();
  const listeners = new Set();
  const receipts = new Map();
  let sequence = 0;
  const service = {
    calls: [],
    lostResponse: false,
    badAck: false,
    note() {
      return {
        id: "note",
        parentId: null,
        title: "Note",
        revision: sequence + 1,
        content: readContent(doc),
        collab: {
          version: 1,
          generation,
          sequence,
          state: encodeDocument(doc),
        },
      };
    },
    broadcast(note = service.note()) {
      listeners.forEach((listener) => listener.next(note));
    },
    transport() {
      return {
        subscribe(next, fail) {
          const entry = { next, fail };
          listeners.add(entry);
          return () => listeners.delete(entry);
        },
        async send(packet) {
          service.calls.push(structuredClone(packet));
          if (service.badAck)
            return {
              ...service.note(),
              collab: {
                ...service.note().collab,
                generation: crypto.randomUUID(),
              },
            };
          if (!receipts.has(packet.operationId)) {
            const before = decodeDocument(encodeDocument(doc));
            Y.applyUpdate(doc, fromBase64(packet.update));
            validateDocument(doc, before);
            before.destroy();
            receipts.set(packet.operationId, packet.update);
            sequence++;
            service.broadcast();
          } else
            assert.equal(
              receipts.get(packet.operationId),
              packet.update,
              "retry identity must have identical bytes",
            );
          if (service.lostResponse) {
            service.lostResponse = false;
            throw new Error("Response lost");
          }
          return service.note();
        },
      };
    },
    listenerCount() {
      return listeners.size;
    },
    mutate(fn) {
      const before = readContent(doc);
      const next = structuredClone(before);
      fn(next);
      applyEditorContent(doc, before, next);
      sequence++;
      service.broadcast();
    },
  };
  return service;
}
function edit(
  controller,
  index,
  text,
  base = controller.getSnapshot().content,
) {
  const next = structuredClone(base);
  next.blocks[index].text = text;
  controller.change(next, base);
}
async function tick(t, amount = 2000) {
  t.mock.timers.tick(amount);
  await drain();
}

test("two controllers preserve independent edits and concurrent text without remote write loops", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    a = new CollaborationController(s.note(), s.transport(), memoryStore()),
    b = new CollaborationController(s.note(), s.transport(), memoryStore());
  await a.start();
  await b.start();
  edit(a, 0, "A first");
  edit(b, 1, "B second");
  await drain();
  await tick(t);
  assert.deepEqual(
    s.note().content.blocks.map((block) => block.text),
    ["A first", "B second"],
  );
  const baseA = a.getSnapshot().content,
    baseB = b.getSnapshot().content;
  edit(a, 0, "A first!", baseA);
  edit(b, 0, "?A first", baseB);
  await drain();
  await tick(t);
  assert.equal(s.note().content.blocks[0].text, "?A first!");
  s.broadcast();
  s.broadcast();
  await drain();
  await tick(t, 5000);
  assert.equal(s.calls.length, 4);
  assert.equal(a.getSnapshot().status, "Saved");
  assert.equal(b.getSnapshot().status, "Saved");
  a.dispose();
  b.dispose();
  assert.equal(s.listenerCount(), 0);
});

test("a stale rendered callback merges its text intent against the rendered CRDT baseline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    a = new CollaborationController(s.note(), s.transport(), memoryStore());
  await a.start();
  const rendered = a.getSnapshot().content;
  s.mutate((next) => {
    next.blocks[0].text = "Remote First";
  });
  edit(a, 0, "First local", rendered);
  await drain();
  await tick(t);
  assert.equal(s.note().content.blocks[0].text, "Remote First local");
  a.dispose();
});

test("offline edits reconcile remote updates after reconnect and ignore stale snapshots", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    store = memoryStore(),
    old = s.note();
  const a = new CollaborationController(old, s.transport(), store);
  await a.start();
  a.setOnline(false);
  edit(a, 0, "Offline work");
  edit(a, 0, "Offline work!");
  await drain();
  await tick(t);
  assert.equal(s.calls.length, 0);
  assert.equal(a.getSnapshot().status, "Offline");
  s.mutate((next) => {
    next.blocks[1].text = "Remote work";
  });
  a.receive(old);
  assert.equal(a.getSnapshot().content.blocks[1].text, "Remote work");
  a.setOnline(true);
  await tick(t);
  assert.deepEqual(
    s.note().content.blocks.map((block) => block.text),
    ["Offline work!", "Remote work"],
  );
  assert.equal(store.record.pending.length, 0);
  a.dispose();
});

test("refresh after lost acknowledgement retries identical operation exactly once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    store = memoryStore(),
    a = new CollaborationController(s.note(), s.transport(), store);
  await a.start();
  s.lostResponse = true;
  edit(a, 0, "Durable work");
  await drain();
  await tick(t);
  assert.equal(store.record.pending.length, 1);
  assert.equal(store.record.pending[0].sent, true);
  a.dispose();
  const refreshed = new CollaborationController(s.note(), s.transport(), store);
  await refreshed.start();
  await tick(t);
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls[0], s.calls[1]);
  assert.equal(s.note().collab.sequence, 1);
  assert.equal(refreshed.getSnapshot().status, "Saved");
  assert.equal(s.note().content.blocks[0].text, "Durable work");
  refreshed.dispose();
});

test("deletion wins stale queued editing without resurrecting the block", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    a = new CollaborationController(s.note(), s.transport(), memoryStore());
  await a.start();
  a.setOnline(false);
  edit(a, 0, "Stale edit");
  s.mutate((next) => next.blocks.splice(0, 1));
  await drain();
  assert.equal(a.getSnapshot().canUndo, false);
  a.setOnline(true);
  await tick(t);
  assert.deepEqual(
    s.note().content.blocks.map((block) => block.text),
    ["Second"],
  );
  a.dispose();
});

test("large offline backlog uses bounded dependency-ordered batches", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    a = new CollaborationController(s.note(), s.transport(), memoryStore());
  await a.start();
  a.setOnline(false);
  for (let i = 0; i < 5; i++) {
    const before = a.getSnapshot().content,
      next = structuredClone(before);
    next.blocks.push({
      id: crypto.randomUUID(),
      type: "paragraph",
      text: "x".repeat(18000),
    });
    a.change(next, before);
  }
  await drain();
  a.setOnline(true);
  for (let i = 0; i < 4; i++) await tick(t);
  assert.ok(s.calls.length >= 2);
  assert.ok(
    s.calls.every((packet) => fromBase64(packet.update).byteLength <= 64000),
  );
  assert.equal(s.note().content.blocks.length, 7);
  assert.equal(a.getSnapshot().status, "Saved");
  a.dispose();
});

test("failed local durability never sends and retry retains work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    store = memoryStore(),
    a = new CollaborationController(s.note(), s.transport(), store);
  await a.start();
  store.failing = true;
  edit(a, 0, "Keep me");
  await drain();
  await tick(t);
  assert.equal(s.calls.length, 0);
  assert.equal(a.getSnapshot().status, "Sync failed");
  store.failing = false;
  a.retry();
  await tick(t);
  assert.equal(s.note().content.blocks[0].text, "Keep me");
  assert.equal(a.getSnapshot().status, "Saved");
  a.dispose();
});

test("invalid acknowledgement preserves pending recovery and does not report Saved", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    store = memoryStore(),
    a = new CollaborationController(s.note(), s.transport(), store);
  await a.start();
  s.badAck = true;
  edit(a, 0, "Pending");
  await drain();
  await tick(t);
  assert.equal(a.getSnapshot().status, "Sync failed");
  assert.equal(store.record.pending.length, 1);
  assert.equal(a.getSnapshot().content.blocks[0].text, "Pending");
  a.dispose();
});

test("switching documents cancels timers, removes subscriptions and ignores late delivery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    store = memoryStore(),
    a = new CollaborationController(s.note(), s.transport(), store);
  await a.start();
  edit(a, 0, "Pending before switch");
  await drain();
  const view = a.getSnapshot();
  a.dispose();
  assert.equal(s.listenerCount(), 0);
  a.receive(s.note());
  await tick(t, 30000);
  assert.equal(s.calls.length, 0);
  assert.equal(a.getSnapshot(), view);
  assert.equal(store.record.pending.length, 1);
});

test("cached pre-promotion snapshots and foreign editor callbacks cannot replace live content", async () => {
  const s = server(),
    a = new CollaborationController(s.note(), s.transport(), memoryStore());
  await a.start();
  const legacy = { ...s.note() };
  delete legacy.collab;
  a.receive(legacy);
  assert.equal(a.getSnapshot().status, "Saved");
  const foreign = structuredClone(a.getSnapshot().content);
  edit(a, 0, "Wrong document", foreign);
  assert.equal(a.getSnapshot().content.blocks[0].text, "First");
  assert.equal(a.getSnapshot().status, "Sync failed");
  await a.dispose();
});

test("generation conflict exposes the actual unsent recovery copy", async () => {
  const s = server(),
    store = memoryStore(),
    a = new CollaborationController(s.note(), s.transport(), store);
  await a.start();
  a.setOnline(false);
  edit(a, 0, "Recover original work");
  await drain();
  await a.dispose();
  const replacement = s.note();
  replacement.collab.generation = crypto.randomUUID();
  const reopened = new CollaborationController(
    replacement,
    s.transport(),
    store,
  );
  await reopened.start();
  assert.equal(reopened.getSnapshot().status, "Sync failed");
  assert.equal(
    reopened.getSnapshot().recoveryContent.blocks[0].text,
    "Recover original work",
  );
  assert.equal(store.record.pending.length, 1);
  await reopened.dispose();
});

test("disposal waits for already queued recovery writes before releasing journal ownership", async () => {
  const s = server(),
    store = memoryStore(),
    a = new CollaborationController(s.note(), s.transport(), store);
  await a.start();
  let release;
  const original = store.save.bind(store);
  store.save = async (record) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    await original(record);
  };
  edit(a, 0, "Latest local work");
  await drain();
  let stopped = false;
  const disposal = a.dispose().then(() => {
    stopped = true;
  });
  await drain();
  assert.equal(stopped, false);
  release();
  await disposal;
  assert.equal(
    readContent(decodeDocument(store.record.state)).blocks[0].text,
    "Latest local work",
  );
});

test("a journal failure after server acknowledgement retains a retryable operation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    store = memoryStore();
  const transport = s.transport();
  const send = transport.send;
  transport.send = async (packet) => {
    const note = await send(packet);
    store.failing = true;
    return note;
  };
  const a = new CollaborationController(s.note(), transport, store);
  await a.start();
  edit(a, 0, "Acknowledged but journal failed");
  await drain();
  await tick(t);
  assert.equal(s.note().collab.sequence, 1);
  assert.equal(a.getSnapshot().status, "Sync failed");
  assert.equal(a.getSnapshot().pending, true);
  store.failing = false;
  transport.send = send;
  a.retry();
  await tick(t);
  assert.equal(a.getSnapshot().status, "Saved");
  assert.equal(s.note().collab.sequence, 1);
  assert.equal(store.record.pending.length, 0);
  await a.dispose();
});

test("undo cannot restore paragraph text into a remotely converted board", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    store = memoryStore(),
    a = new CollaborationController(s.note(), s.transport(), store);
  await a.start();
  edit(a, 0, "");
  await drain();
  await tick(t);
  s.mutate((next) => {
    next.blocks[0].type = "board";
  });
  await drain();
  a.undo();
  await drain();
  await tick(t);
  assert.equal(a.getSnapshot().content.blocks[0].type, "board");
  assert.equal(a.getSnapshot().content.blocks[0].text, "");
  validateDocument(decodeDocument(store.record.state));
  assert.equal(s.calls.length, 1);
  await a.dispose();
});

test("valid local undo preserves another user's same-block insert", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const s = server(),
    a = new CollaborationController(s.note(), s.transport(), memoryStore());
  await a.start();
  edit(a, 0, "First local");
  await drain();
  await tick(t);
  s.mutate((next) => {
    next.blocks[0].text = "Remote First local";
  });
  await drain();
  a.undo();
  await drain();
  await tick(t);
  assert.equal(s.note().content.blocks[0].text, "Remote First");
  a.redo();
  await drain();
  await tick(t);
  assert.equal(s.note().content.blocks[0].text, "Remote First local");
  await a.dispose();
});
