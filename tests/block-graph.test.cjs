const { test } = require("node:test");
const assert = require("node:assert/strict");
const { moveBlock } = require("../.test-build/block-graph.js");

const children = (blocks, parent) => blocks.filter(block => block.parentId === parent).map(block => block.id);
const initial = () => [
  { id: "page-a", parentId: null },
  { id: "page-b", parentId: null },
  { id: "one", parentId: "page-a" },
  { id: "two", parentId: "page-a" },
  { id: "nested", parentId: "one" },
  { id: "three", parentId: "page-b" },
];

test("moves preserve identity, descendants, unrelated order and the input snapshot", () => {
  const source = initial(), original = structuredClone(source);
  const result = moveBlock(source, "one", "page-b", 0);
  assert.deepEqual(children(result, "page-a"), ["two"]);
  assert.deepEqual(children(result, "page-b"), ["one", "three"]);
  assert.deepEqual(children(result, "one"), ["nested"]);
  assert.deepEqual(children(result, null), ["page-a", "page-b"]);
  assert.deepEqual(source, original);
});

test("reorders siblings and moves between root and empty destinations", () => {
  const reordered = moveBlock(initial(), "one", "page-a", 1);
  assert.deepEqual(children(reordered, "page-a"), ["two", "one"]);
  const rooted = moveBlock(reordered, "one", null, 1);
  assert.deepEqual(children(rooted, null), ["page-a", "one", "page-b"]);
  const nested = moveBlock(rooted, "three", "two", 0);
  assert.deepEqual(children(nested, "two"), ["three"]);
});

test("rejects invalid moves and corrupt or incomplete graph snapshots", () => {
  assert.throws(() => moveBlock(initial(), "one", "nested", 0), /contain itself/);
  assert.throws(() => moveBlock(initial(), "one", "one", 0), /contain itself/);
  assert.throws(() => moveBlock(initial(), "missing", null, 0), /unavailable/);
  assert.throws(() => moveBlock(initial(), "one", "missing", 0), /unavailable/);
  for (const index of [-1, 3, 0.5, NaN])
    assert.throws(() => moveBlock(initial(), "one", "page-b", index), /position/);
  assert.throws(() => moveBlock([...initial(), { id: "one", parentId: null }], "one", null, 0), /identity/);
  assert.throws(() => moveBlock([{ id: "a", parentId: "missing" }], "a", null, 0), /missing parent/);
  assert.throws(() => moveBlock([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], "a", null, 0), /cycle/);
});
