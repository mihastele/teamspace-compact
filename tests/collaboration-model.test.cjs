const { test } = require("node:test");
const assert = require("node:assert/strict");
const Y = require("yjs");
const m = require("../.test-build/collaboration-model.js");

const initial = () =>
  m.initializeDocument({
    blocks: [
      { type: "paragraph", text: "Alpha" },
      { type: "paragraph", text: "Bravo" },
      { type: "paragraph", text: "Charlie" },
    ],
  });
const clone = (doc) => m.decodeDocument(m.encodeDocument(doc));
function edit(doc, mutate) {
  const before = m.readContent(doc);
  const next = structuredClone(before);
  mutate(next.blocks);
  const vector = Y.encodeStateVector(doc);
  m.applyEditorContent(doc, before, next);
  m.validateDocument(doc);
  return Y.encodeStateAsUpdate(doc, vector);
}
function delivery(base, updates) {
  const doc = clone(base);
  for (const update of updates) {
    const previous = clone(doc);
    Y.applyUpdate(doc, update, m.REMOTE_ORIGIN);
    m.validateDocument(doc, previous);
  }
  return m.readContent(doc);
}
function bothOrders(base, a, b) {
  const first = delivery(base, [a, b]);
  assert.deepEqual(first, delivery(base, [b, a]));
  return first.blocks;
}

test("independent concurrent edits survive in both delivery orders", () => {
  const base = initial(),
    a = clone(base),
    b = clone(base);
  const result = bothOrders(
    base,
    edit(a, (blocks) => (blocks[0].text = "Alpha A")),
    edit(b, (blocks) => (blocks[1].text = "Bravo B")),
  );
  assert.deepEqual(
    result.map((block) => block.text),
    ["Alpha A", "Bravo B", "Charlie"],
  );
});

test("same-block concurrent inserts merge rather than silently overwrite", () => {
  const base = initial(),
    a = clone(base),
    b = clone(base);
  const result = bothOrders(
    base,
    edit(a, (blocks) => (blocks[0].text += " A")),
    edit(b, (blocks) => (blocks[0].text += " B")),
  );
  assert.match(result[0].text, /^Alpha(?: A B| B A)$/);
});

test("simultaneous inserts have distinct ranks and deterministic order", () => {
  const base = initial(),
    a = clone(base),
    b = clone(base);
  const first = edit(a, (blocks) =>
    blocks.splice(1, 0, { type: "heading", level: 2, text: "A" }),
  );
  const second = edit(b, (blocks) =>
    blocks.splice(1, 0, { type: "todo", checked: true, text: "B" }),
  );
  const result = bothOrders(base, first, second);
  assert.equal(result.length, 5);
  assert.equal(new Set(result.map((block) => block.id)).size, 5);
  assert.equal(result[0].text, "Alpha");
  assert.equal(result[3].text, "Bravo");
  assert.deepEqual(
    new Set(result.slice(1, 3).map((block) => block.text)),
    new Set(["A", "B"]),
  );
  const merged = clone(base);
  Y.applyUpdate(merged, first);
  Y.applyUpdate(merged, second);
  const ranks = [...merged.getMap("blocks").values()].map((block) =>
    block.get("meta").get("rank"),
  );
  assert.equal(new Set(ranks).size, 5);
});

test("move and independent edit preserve both intents", () => {
  const base = initial(),
    a = clone(base),
    b = clone(base);
  const result = bothOrders(
    base,
    edit(a, (blocks) => blocks.push(blocks.shift())),
    edit(b, (blocks) => (blocks[1].text = "Edited Bravo")),
  );
  assert.deepEqual(
    result.map((block) => block.text),
    ["Edited Bravo", "Charlie", "Alpha"],
  );
});

test("concurrent opposing moves converge to valid unique blocks", () => {
  const base = initial(),
    a = clone(base),
    b = clone(base);
  const result = bothOrders(
    base,
    edit(a, (blocks) => blocks.unshift(blocks.pop())),
    edit(b, (blocks) => blocks.push(blocks.shift())),
  );
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map((block) => block.id)).size, 3);
  assert.deepEqual(
    new Set(result.map((block) => block.text)),
    new Set(["Alpha", "Bravo", "Charlie"]),
  );
});

test("delete wins over stale edit and stale move without resurrecting content", () => {
  for (const action of [
    (blocks) => (blocks[0].text = "Stale Alpha"),
    (blocks) => blocks.push(blocks.shift()),
  ]) {
    const base = initial(),
      a = clone(base),
      b = clone(base);
    const result = bothOrders(
      base,
      edit(a, (blocks) => blocks.shift()),
      edit(b, action),
    );
    assert.equal(result.length, 2);
    assert.deepEqual(
      new Set(result.map((block) => block.text)),
      new Set(["Bravo", "Charlie"]),
    );
  }
});

test("duplicate delivery and response-loss retries are idempotent", () => {
  const base = initial(),
    a = clone(base);
  const update = edit(a, (blocks) => {
    blocks[0].text += "!";
    blocks.push({ type: "paragraph", text: "New" });
  });
  assert.deepEqual(
    delivery(base, [update, update, update]),
    delivery(base, [update]),
  );
});

test("offline edits replay after remote updates and refresh restores acknowledged state", () => {
  const base = initial(),
    offline = clone(base),
    remote = clone(base);
  const pending = edit(offline, (blocks) => (blocks[0].text = "Offline Alpha"));
  const acknowledged = edit(
    remote,
    (blocks) => (blocks[1].text = "Remote Bravo"),
  );
  const result = bothOrders(base, pending, acknowledged);
  assert.deepEqual(
    result.map((block) => block.text),
    ["Offline Alpha", "Remote Bravo", "Charlie"],
  );
  Y.applyUpdate(remote, pending);
  const refreshed = clone(remote);
  assert.deepEqual(m.readContent(refreshed).blocks, result);
});

test("rapid sequential edits preserve final text and missing dependencies are rejected", () => {
  const base = initial(),
    a = clone(base);
  const updates = [];
  for (let index = 0; index < 30; index++)
    updates.push(edit(a, (blocks) => (blocks[0].text += `${index},`)));
  assert.deepEqual(delivery(base, updates), m.readContent(a));
  const outOfOrder = clone(base);
  Y.applyUpdate(outOfOrder, updates[29]);
  assert.throws(() => m.validateDocument(outOfOrder), /dependencies/);
  for (const update of updates) Y.applyUpdate(outOfOrder, update);
  m.validateDocument(outOfOrder);
  assert.deepEqual(m.readContent(outOfOrder), m.readContent(a));
});

test("remote origin never becomes a local edit and unsubscribe stops notifications", () => {
  const base = initial(),
    a = clone(base),
    b = clone(base);
  let local = 0,
    remote = 0;
  const listener = (_update, origin) => {
    if (origin === m.LOCAL_ORIGIN) local++;
    if (origin === m.REMOTE_ORIGIN) remote++;
  };
  b.on("update", listener);
  const update = edit(a, (blocks) => (blocks[0].text += "!"));
  Y.applyUpdate(b, update, m.REMOTE_ORIGIN);
  assert.equal(local, 0);
  assert.equal(remote, 1);
  b.off("update", listener);
  Y.applyUpdate(
    b,
    edit(a, (blocks) => (blocks[1].text += "!")),
    m.REMOTE_ORIGIN,
  );
  assert.equal(remote, 1);
});

test("stale callback rejection is atomic and empty content creates no phantom blocks", () => {
  const doc = initial();
  const before = m.readContent(doc),
    next = structuredClone(before);
  edit(doc, (blocks) => (blocks[1].text += " Remote"));
  next.blocks.shift();
  next.blocks[0].text += " Local";
  const snapshot = m.encodeDocument(doc);
  assert.throws(() => m.applyEditorContent(doc, before, next), /baseline/);
  assert.equal(m.encodeDocument(doc), snapshot);
  edit(doc, (blocks) => blocks.splice(0));
  assert.deepEqual(m.readContent(doc), { blocks: [] });
  assert.deepEqual(m.readContent(m.initializeDocument({ blocks: [] })), {
    blocks: [],
  });
});

test("malicious identity replacement, resurrection, schema fields and invalid payloads fail", () => {
  const base = initial();
  const id = m.readContent(base).blocks[0].id;
  const replace = clone(base);
  const old = replace.getMap("blocks").get(id);
  const block = new Y.Map(),
    meta = new Y.Map();
  meta.set("format", { type: "paragraph" });
  meta.set("rank", old.get("meta").get("rank"));
  block.set("meta", meta);
  block.set("text", new Y.Text("Replacement"));
  replace.getMap("blocks").set(id, block);
  assert.throws(() => m.validateDocument(replace, base), /identity/);
  const deleted = clone(base);
  edit(deleted, (blocks) => blocks.shift());
  const resurrect = clone(deleted);
  resurrect.getMap("tombstones").delete(id);
  assert.throws(() => m.validateDocument(resurrect, deleted), /reappear/);
  const unknown = clone(base);
  unknown.getMap("foreign").set("secret", "x");
  assert.throws(() => m.validateDocument(unknown), /root/);
  assert.throws(() => m.fromBase64("not!base64"), /base64/);
  assert.throws(() => m.decodeDocument(m.toBase64(new Uint8Array([1, 2, 3]))));
});

test("ordering supports a large existing note without rebalancing", () => {
  const doc = m.initializeDocument({
    blocks: Array.from({ length: 1000 }, (_, index) => ({
      type: "paragraph",
      text: `${index}`,
    })),
  });
  assert.equal(m.readContent(doc).blocks.length, 1000);
  m.validateDocument(doc);
});

test("text diff never splits emoji surrogate pairs", () => {
  const doc = m.initializeDocument({
    blocks: [{ type: "paragraph", text: "😀a😀" }],
  });
  edit(doc, (blocks) => (blocks[0].text = "😁a😁"));
  assert.equal(m.readContent(doc).blocks[0].text, "😁a😁");
  edit(doc, (blocks) => (blocks[0].text = "😁x😁"));
  assert.equal(m.readContent(doc).blocks[0].text, "😁x😁");
});

test("concurrent format conversions merge as valid atomic registers", () => {
  const base = m.initializeDocument({
    blocks: [{ type: "heading", level: 1, text: "Heading" }],
  });
  const a = clone(base),
    b = clone(base);
  const result = bothOrders(
    base,
    edit(a, (blocks) => {
      blocks[0].type = "paragraph";
      delete blocks[0].level;
    }),
    edit(b, (blocks) => {
      blocks[0].level = 2;
    }),
  );
  if (result[0].type === "paragraph") assert.equal(result[0].level, undefined);
  else {
    assert.equal(result[0].type, "heading");
    assert.equal(result[0].level, 2);
  }
});

test("invalid format, oversized action and textless conversion failures leave live state intact", () => {
  const doc = initial();
  const before = m.readContent(doc),
    next = structuredClone(before);
  next.blocks[0].level = 4;
  const state = m.encodeDocument(doc);
  assert.throws(() => m.applyEditorContent(doc, before, next), /heading/);
  assert.equal(m.encodeDocument(doc), state);
  next.blocks[0] = { ...before.blocks[0], type: "board" };
  assert.throws(() => m.applyEditorContent(doc, before, next), /text length/);
  assert.equal(m.encodeDocument(doc), state);
  next.blocks = [
    { ...before.blocks[0], text: "€".repeat(20000) },
    { ...before.blocks[1], text: "€".repeat(20000) },
    before.blocks[2],
  ];
  assert.throws(
    () => m.applyEditorContent(doc, before, next),
    /synchronization capacity/,
  );
  assert.equal(m.encodeDocument(doc), state);
});

test("local text undo preserves concurrent remote text and later redo", () => {
  const base = initial(),
    a = clone(base),
    b = clone(base);
  const undo = new Y.UndoManager(m.getTextTypes(a), {
    trackedOrigins: new Set([m.LOCAL_ORIGIN]),
  });
  edit(a, (blocks) => (blocks[0].text += " A"));
  const remote = edit(b, (blocks) => (blocks[0].text += " B"));
  Y.applyUpdate(a, remote, m.REMOTE_ORIGIN);
  undo.undo();
  assert.equal(m.readContent(a).blocks[0].text, "Alpha B");
  undo.redo();
  assert.match(m.readContent(a).blocks[0].text, /^Alpha(?: A B| B A)$/);
  m.validateDocument(a);
  undo.destroy();
});

test("retained undo history cannot bypass the document capacity guard", () => {
  const doc = m.initializeDocument({ blocks: [{ type: "paragraph", text: "A".repeat(20000) }] });
  const undo = new Y.UndoManager(m.getTextTypes(doc), { trackedOrigins: new Set([m.LOCAL_ORIGIN]) });
  let rejected = false;
  for (let index = 1; index < 30; index++) {
    const before = m.readContent(doc), next = structuredClone(before), snapshot = m.encodeDocument(doc);
    next.blocks[0].text = String.fromCharCode(65 + index).repeat(20000);
    try { m.applyEditorContent(doc, before, next); }
    catch (error) { assert.match(error.message, /capacity/); assert.equal(m.encodeDocument(doc), snapshot); rejected = true; break; }
    m.validateDocument(doc);
  }
  assert.equal(rejected, true);
  undo.destroy();
});
