const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createHistory,
  recordHistory,
  undoHistory,
  redoHistory,
  sameContent,
} = require("../.test-build/note-history.js");
const text = (value) => ({ blocks: [{ type: "paragraph", text: value }] });

test("deletion, conversion and reordering can restore full block metadata", () => {
  const original = {
    blocks: [
      { type: "heading", level: 2, text: "Plan" },
      { type: "todo", checked: true, text: "Done" },
      { type: "board", text: "" },
    ],
  };
  let history = recordHistory(createHistory(original), {
    blocks: [original.blocks[2], original.blocks[0]],
  });
  history = undoHistory(history);
  assert.deepEqual(history.present, original);
  assert.deepEqual(redoHistory(history).present.blocks, [
    original.blocks[2],
    original.blocks[0],
  ]);
});

test("continuous typing groups, pauses and structural edits create separate undo steps", () => {
  let history = recordHistory(
    createHistory(text("")),
    text("H"),
    "typing:0",
    1000,
  );
  history = recordHistory(history, text("Hi"), "typing:0", 1200);
  assert.equal(undoHistory(history).present.blocks[0].text, "");
  history = recordHistory(history, text("Hi!"), "typing:0", 2100);
  assert.equal(undoHistory(history).present.blocks[0].text, "Hi");
  history = recordHistory(
    history,
    { blocks: [{ type: "heading", level: 1, text: "Hi!" }] },
    undefined,
    2200,
  );
  assert.equal(undoHistory(history).present.blocks[0].type, "paragraph");
});

test("typing in another block does not join the previous typing group", () => {
  let history = recordHistory(
    createHistory(text("a")),
    text("ab"),
    "typing:0",
    1000,
  );
  history = recordHistory(
    history,
    { blocks: [...text("ab").blocks, ...text("b").blocks] },
    "typing:1",
    1100,
  );
  assert.deepEqual(undoHistory(history).present, text("ab"));
});

test("editing after undo discards redo and never overwrites the abandoned branch", () => {
  let history = recordHistory(createHistory(text("a")), text("b"));
  history = recordHistory(history, text("c"));
  history = recordHistory(undoHistory(history), text("different"));
  assert.equal(history.future.length, 0);
  assert.equal(redoHistory(history).present.blocks[0].text, "different");
  assert.equal(undoHistory(history).present.blocks[0].text, "b");
});

test("history is bounded to twenty checkpoints and unchanged content adds nothing", () => {
  let history = createHistory(text("0"));
  for (let i = 1; i <= 25; i++)
    history = recordHistory(history, text(String(i)));
  assert.equal(history.past.length, 20);
  assert.strictEqual(recordHistory(history, text("25")), history);
  for (let i = 0; i < 30; i++) history = undoHistory(history);
  assert.equal(history.present.blocks[0].text, "5");
});

test("external replacement starts a clean history rather than reverting teammate content", () => {
  const local = recordHistory(
    createHistory(text("saved")),
    text("local draft"),
  );
  const remote = text("teammate version");
  const reconciled = sameContent(local.present, remote)
    ? local
    : createHistory(remote);
  assert.strictEqual(undoHistory(reconciled), reconciled);
  assert.deepEqual(reconciled.present, remote);
});
