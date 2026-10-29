const { test } = require("node:test");
const assert = require("node:assert/strict");
const Y = require("yjs");
const { createBlockState, mergeBlockUpdate, MAX_BLOCK_TEXT_LENGTH, MAX_BLOCK_UPDATE_BYTES } = require("../.test-build/block-collaboration.js");

function copy(state) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}
function edit(doc, text) {
  const vector = Y.encodeStateVector(doc);
  doc.getText("text").insert(doc.getText("text").length, text);
  return Y.encodeStateAsUpdate(doc, vector);
}
function fails(code) { return error => error.code === code; }

test("new checkpoints preserve empty and Unicode text and accept subsequent updates", () => {
  for (const text of ["", "Živjo 👋\n世界"]) {
    const state = createBlockState(text);
    const client = copy(state);
    assert.equal(client.getText("text").toString(), text);
    const update = edit(client, " added");
    assert.equal(mergeBlockUpdate(state, update).text, `${text} added`);
  }
  assert.throws(() => createBlockState("bad\0text"), fails("invalid_state"));
  assert.throws(() => createBlockState("a".repeat(MAX_BLOCK_TEXT_LENGTH + 1)), fails("invalid_state"));
});

test("recreating visible text does not recreate the checkpoint needed by existing updates", () => {
  const first = createBlockState("Existing"), recreated = createBlockState("Existing");
  const update = edit(copy(first), " offline");
  assert.throws(() => mergeBlockUpdate(recreated, update), fails("missing_dependencies"));
  assert.equal(mergeBlockUpdate(first, update).text, "Existing offline");
});

test("concurrent edits merge in either order and duplicate updates do not duplicate text", () => {
  const doc = new Y.Doc();
  doc.getText("text").insert(0, "Start");
  const base = Y.encodeStateAsUpdate(doc);
  const a = edit(copy(base), " A"), b = edit(copy(base), " B");
  const ab = mergeBlockUpdate(mergeBlockUpdate(base, a).state, b);
  const ba = mergeBlockUpdate(mergeBlockUpdate(base, b).state, a);
  assert.equal(ab.text, ba.text);
  assert.match(ab.text, /^Start(?: A B| B A)$/);
  assert.equal(mergeBlockUpdate(ab.state, a).text, ab.text);
});

test("updates with missing dependencies are rejected until the predecessor is applied", () => {
  const doc = new Y.Doc();
  doc.getText("text").insert(0, "Start");
  const base = Y.encodeStateAsUpdate(doc);
  const offline = copy(base), first = edit(offline, " one"), second = edit(offline, " two");
  assert.throws(() => mergeBlockUpdate(base, second), fails("missing_dependencies"));
  assert.equal(mergeBlockUpdate(mergeBlockUpdate(base, first).state, second).text, "Start one two");
});

test("rejects unexpected roots, embedded values, formatting, NUL and oversized or corrupt updates", () => {
  const baseDoc = new Y.Doc();
  baseDoc.getText("text").insert(0, "safe");
  const base = Y.encodeStateAsUpdate(baseDoc);
  for (const mutate of [
    doc => doc.getMap("extra").set("key", "value"),
    doc => doc.getText("text").insertEmbed(0, { value: "embed" }),
    doc => doc.getText("text").format(0, 1, { bold: true }),
    doc => doc.getText("text").insert(0, "\0"),
  ]) {
    const doc = copy(base), vector = Y.encodeStateVector(doc);
    mutate(doc);
    assert.throws(() => mergeBlockUpdate(base, Y.encodeStateAsUpdate(doc, vector)), fails("invalid_update"));
  }
  assert.throws(() => mergeBlockUpdate(base, new Uint8Array(MAX_BLOCK_UPDATE_BYTES + 1)), fails("invalid_update"));
  assert.throws(() => mergeBlockUpdate(base, new Uint8Array([255])), fails("invalid_update"));
  assert.throws(() => mergeBlockUpdate(new Uint8Array([255]), new Uint8Array()), fails("invalid_state"));
  const forgedRoot = new Y.Doc();
  forgedRoot.getMap("text").set("hidden", "value");
  assert.throws(() => mergeBlockUpdate(base, Y.encodeStateAsUpdate(forgedRoot)), fails("invalid_update"));
});
