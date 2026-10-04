const { test } = require("node:test");
const assert = require("node:assert/strict");
const { duplicateBlock } = require("../.test-build/note-blocks.js");
const { createHistory, recordHistory, undoHistory, redoHistory } = require("../.test-build/note-history.js");

test("duplicates full formatting after the source without sharing the copied object", () => {
  for (const block of [
    { type: "heading", level: 3, text: "Plan" },
    { type: "todo", checked: true, text: "Done" },
    { type: "markdown", text: "**hello**\n\n| A | B |" },
    { type: "board", text: "" },
    { type: "divider", text: "" },
  ]) {
    const content = { blocks: [block, { type: "paragraph", text: "Next" }] };
    const next = duplicateBlock(content, 0);
    assert.deepEqual(next.blocks, [block, block, content.blocks[1]]);
    assert.notEqual(next.blocks[1], block);
    const originalText = block.text;
    next.blocks[1].text = "Changed copy";
    assert.equal(content.blocks[0].text, originalText);
    assert.equal(content.blocks.length, 2);
  }
});

test("duplication is one reversible history step and invalid indices leave content intact", () => {
  const content = { blocks: [{ type: "code", text: "const x = 1;" }] };
  for (const index of [-1, 1, 0.5, NaN]) assert.equal(duplicateBlock(content, index), content);
  const next = duplicateBlock(content, 0);
  const history = recordHistory(createHistory(content), next);
  assert.deepEqual(undoHistory(history).present, content);
  assert.deepEqual(redoHistory(undoHistory(history)).present, next);
});

test("collaborative duplication gives the copy a distinct identity", () => {
  const id = crypto.randomUUID();
  const content = { blocks: [{ id, type: "heading", level: 2, text: "Plan" }] };
  const next = duplicateBlock(content, 0);
  assert.equal(next.blocks[0].id, id);
  assert.notEqual(next.blocks[1].id, id);
  assert.equal(next.blocks[1].level, 2);
  assert.equal(next.blocks[1].text, "Plan");
  assert.equal(content.blocks.length, 1);
});
