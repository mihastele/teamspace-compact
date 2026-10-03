const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  flattenNoteTree,
  noteAncestors,
  noteDescendants,
  assertNoteParent,
} = require("../.test-build/note-tree.js");

const note = (id, title, parentId = null) => ({
  id,
  title,
  parentId,
  content: { blocks: [] },
  revision: 1,
});
const nested = () => [
  note("roadmap", "Roadmap"),
  note("research", "Research", "roadmap"),
  note("interviews", "Interviews", "research"),
  note("build", "Build", "roadmap"),
  note("overview", "Overview"),
];
const rows = (notes) =>
  flattenNoteTree(notes).map(({ note: item, depth }) => [item.id, depth]);

test("nested documents flatten in alphabetical preorder with correct indentation", () => {
  const expected = [
    ["overview", 0],
    ["roadmap", 0],
    ["build", 1],
    ["research", 1],
    ["interviews", 2],
  ];
  assert.deepEqual(rows(nested()), expected);
  assert.deepEqual(rows(nested().reverse()), expected);
});

test("equal-title siblings remain deterministic when snapshot order changes", () => {
  const notes = [note("z", "Same"), note("a", "Same"), note("m", "Same")];
  assert.deepEqual(rows(notes), [
    ["a", 0],
    ["m", 0],
    ["z", 0],
  ]);
  assert.deepEqual(rows(notes.reverse()), [
    ["a", 0],
    ["m", 0],
    ["z", 0],
  ]);
});

test("breadcrumbs contain only ancestors, ordered from root to immediate parent", () => {
  assert.deepEqual(
    noteAncestors(nested(), "interviews").map((item) => item.id),
    ["roadmap", "research"],
  );
  assert.deepEqual(
    noteAncestors(nested(), "research").map((item) => item.id),
    ["roadmap"],
  );
  assert.deepEqual(noteAncestors(nested(), "roadmap"), []);
  assert.deepEqual(noteAncestors(nested(), "missing"), []);
});

test("descendant lookup includes every depth and excludes unrelated documents and self", () => {
  assert.deepEqual([...noteDescendants(nested(), "roadmap")].sort(), [
    "build",
    "interviews",
    "research",
  ]);
  assert.deepEqual([...noteDescendants(nested(), "research")], ["interviews"]);
  assert.equal(noteDescendants(nested(), "interviews").size, 0);
  assert.equal(noteDescendants(nested(), "missing").size, 0);
});

test("valid moves permit roots, siblings and a new child beneath an existing parent", () => {
  assert.doesNotThrow(() => assertNoteParent(nested(), "research", null));
  assert.doesNotThrow(() => assertNoteParent(nested(), "research", "build"));
  assert.doesNotThrow(() =>
    assertNoteParent(nested(), "overview", "interviews"),
  );
  assert.doesNotThrow(() => assertNoteParent(nested(), null, "research"));
  assert.doesNotThrow(() => assertNoteParent(nested(), null, null));
});

test("moves reject self-parenting, indirect descendant cycles and unknown parents", () => {
  assert.throws(() => assertNoteParent(nested(), "roadmap", "roadmap"));
  assert.throws(() => assertNoteParent(nested(), "roadmap", "research"));
  assert.throws(() => assertNoteParent(nested(), "roadmap", "interviews"));
  assert.throws(() => assertNoteParent(nested(), "overview", "missing"));
  assert.throws(() => assertNoteParent(nested(), null, "missing"));
});

test("legacy documents and explicit null parents appear as roots", () => {
  const legacy = {
    id: "legacy",
    title: "Legacy",
    content: { blocks: [] },
    revision: 1,
  };
  const undefinedParent = {
    ...note("undefined", "Undefined"),
    parentId: undefined,
  };
  assert.deepEqual(rows([undefinedParent, note("root", "Root"), legacy]), [
    ["legacy", 0],
    ["root", 0],
    ["undefined", 0],
  ]);
});

test("missing and invalid parent references cannot hide documents", () => {
  const notes = [
    note("orphan", "Orphan", "missing"),
    note("child", "Child", "orphan"),
    note("invalid", "Invalid", 42),
    note("root", "Root"),
  ];
  const result = rows(notes);
  assert.equal(result.find(([id]) => id === "orphan")[1], 0);
  assert.equal(result.find(([id]) => id === "invalid")[1], 0);
  assert.equal(result.find(([id]) => id === "child")[1], 1);
  assert.equal(new Set(result.map(([id]) => id)).size, notes.length);
  assert.deepEqual(noteAncestors(notes, "orphan"), []);
});

test("self-cycles and multi-document cycles terminate without hiding or repeating notes", () => {
  const notes = [
    note("self", "Self", "self"),
    note("a", "Alpha", "b"),
    note("b", "Beta", "a"),
    note("child", "Child", "a"),
    note("safe", "Safe"),
  ];
  const result = rows(notes);
  assert.equal(result.length, notes.length);
  assert.equal(new Set(result.map(([id]) => id)).size, notes.length);
  for (const [, depth] of result)
    assert.ok(Number.isInteger(depth) && depth >= 0 && depth < notes.length);
  for (const id of ["self", "a", "b"]) {
    const ancestors = noteAncestors(notes, id);
    assert.ok(ancestors.length < notes.length);
    assert.equal(
      new Set(ancestors.map((item) => item.id)).size,
      ancestors.length,
    );
    assert.ok(ancestors.every((item) => item.id !== id));
    const descendants = noteDescendants(notes, id);
    assert.ok(descendants.size < notes.length);
    assert.ok(!descendants.has(id));
  }
});

test("an empty note collection supports each read helper", () => {
  assert.deepEqual(flattenNoteTree([]), []);
  assert.deepEqual(noteAncestors([], "missing"), []);
  assert.equal(noteDescendants([], "missing").size, 0);
});
