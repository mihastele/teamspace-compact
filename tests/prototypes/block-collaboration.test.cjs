// Research fixture only: the Map stands in for containment, not a server or database.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Y = require("yjs");

function clone(doc) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

function insert(doc, text) {
  const vector = Y.encodeStateVector(doc);
  const content = doc.getText("text");
  content.insert(content.length, text);
  return Y.encodeStateAsUpdate(doc, vector);
}

test("concurrent edits survive a cross-page move in either delivery order", () => {
  const original = new Y.Doc();
  original.getText("text").insert(0, "Shared");
  const first = clone(original);
  const second = clone(original);
  const firstUpdate = insert(first, " A");
  const secondUpdate = insert(second, " B");

  const results = [];
  for (const moveBeforeUpdates of [true, false]) {
    const parent = new Map([["block-1", "page-a"]]);
    const contents = new Map([["block-1", clone(original)]]);
    if (moveBeforeUpdates) parent.set("block-1", "page-b");
    for (const update of moveBeforeUpdates
      ? [firstUpdate, secondUpdate]
      : [secondUpdate, firstUpdate]) {
      Y.applyUpdate(contents.get("block-1"), update);
    }
    if (!moveBeforeUpdates) parent.set("block-1", "page-b");
    assert.equal(parent.get("block-1"), "page-b");
    assert.equal(contents.size, 1);
    results.push(contents.get("block-1").getText("text").toString());
  }
  assert.equal(results[0], results[1]);
  assert.match(results[0], /^Shared(?: A B| B A)$/);
});

test("delayed dependent updates converge when their missing predecessor arrives", () => {
  const original = new Y.Doc();
  original.getText("text").insert(0, "Start");
  const offline = clone(original);
  const first = insert(offline, " one");
  const second = insert(offline, " two");
  const receiver = clone(original);
  Y.applyUpdate(receiver, second);
  Y.applyUpdate(receiver, first);
  assert.equal(receiver.getText("text").toString(), "Start one two");
  Y.applyUpdate(receiver, first);
  assert.equal(receiver.getText("text").toString(), "Start one two");
});

test("moving one block does not merge its content with another block", () => {
  const first = new Y.Doc();
  const second = new Y.Doc();
  first.getText("text").insert(0, "First");
  second.getText("text").insert(0, "Second");
  const parent = new Map([["first", "page-a"], ["second", "page-b"]]);
  parent.set("first", "page-b");
  insert(first, " edited");
  assert.equal(parent.get("first"), parent.get("second"));
  assert.equal(first.getText("text").toString(), "First edited");
  assert.equal(second.getText("text").toString(), "Second");
});
