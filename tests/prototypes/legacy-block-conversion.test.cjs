// Research only: no authorization, persistence, receipts, or production writer.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Y = require("yjs");
const legacy = require("../../.test-build/collaboration-model.js");
const blocks = require("../../.test-build/block-collaboration.js");

function clone(doc) {
  return legacy.decodeDocument(legacy.encodeDocument(doc), { gc: false });
}

function edit(doc, change) {
  const before = legacy.readContent(doc);
  const next = structuredClone(before);
  change(next.blocks);
  const vector = Y.encodeStateVector(doc);
  legacy.applyEditorContent(doc, before, next);
  return Y.encodeStateAsUpdate(doc, vector);
}

function mergeLegacy(base, updates) {
  const candidate = clone(base);
  try {
    for (const update of updates) Y.applyUpdate(candidate, update);
    legacy.validateDocument(candidate, base);
    return legacy.readContent(candidate);
  } finally { candidate.destroy(); }
}

test("offline page edits can be merged before splitting into independent block checkpoints", () => {
  const base = legacy.initializeDocument({ blocks: [
    { type: "paragraph", text: "Alpha" }, { type: "paragraph", text: "Bravo" },
  ] });
  const first = clone(base), second = clone(base);
  const one = edit(first, values => { values[0].text += " offline"; });
  const two = edit(second, values => { values[1].text += " remote"; });
  const merged = mergeLegacy(base, [one, two, one]);
  assert.deepEqual(merged, mergeLegacy(base, [two, one]));
  assert.deepEqual(merged.blocks.map(value => value.text), ["Alpha offline", "Bravo remote"]);
  for (const value of merged.blocks) {
    const state = blocks.createBlockState(value.text);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    assert.equal(doc.getText("text").toString(), value.text);
    doc.destroy();
  }
  base.destroy(); first.destroy(); second.destroy();
});

test("a missing legacy dependency is rejected before any projection", () => {
  const base = legacy.initializeDocument({ blocks: [{ type: "paragraph", text: "Start" }] });
  const offline = clone(base);
  const first = edit(offline, values => { values[0].text += " one"; });
  const second = edit(offline, values => { values[0].text += " two"; });
  const original = legacy.encodeDocument(base);
  assert.throws(() => mergeLegacy(base, [second]), /dependencies/);
  assert.equal(legacy.encodeDocument(base), original);
  assert.equal(mergeLegacy(base, [second, first]).blocks[0].text, "Start one two");
  base.destroy(); offline.destroy();
});

test("a new checkpoint cannot directly receive an old page update", () => {
  const base = legacy.initializeDocument({ blocks: [{ type: "paragraph", text: "Start" }] });
  const offline = clone(base);
  const update = edit(offline, values => { values[0].text += " offline"; });
  const checkpoint = blocks.createBlockState("Start");
  assert.throws(() => blocks.mergeBlockUpdate(checkpoint, update));
  assert.equal(mergeLegacy(base, [update]).blocks[0].text, "Start offline");
  base.destroy(); offline.destroy();
});
