const { test } = require("node:test");
const assert = require("node:assert/strict");
const { exportNoteMarkdown } = require("../.test-build/note-export.js");

test("exports rich draft text without mutating content or losing metadata", () => {
  const content = {
    blocks: [
      { type: "heading", level: 2, text: "Details" },
      { type: "todo", checked: true, text: "Done" },
      { type: "quote", text: "one\ntwo" },
      { type: "code", text: "```\nsource" },
      { type: "markdown", text: "| A |\n| - |\n| Ž |" },
      { type: "board", text: "" },
    ],
  };
  const before = JSON.stringify(content);
  const result = exportNoteMarkdown("My draft", content);
  assert.equal(
    result.markdown,
    "# My draft\n\n## Details\n\n- [x] Done\n\n> one\n> two\n\n````\n```\nsource\n````\n\n| A |\n| - |\n| Ž |\n\n[Shared workspace board]\n",
  );
  assert.equal(JSON.stringify(content), before);
});

test("filenames cannot contain path separators or Windows device names", () => {
  for (const title of [
    "../../escape",
    "CON",
    "NUL",
    "A:B*?<>|",
    "",
    "a".repeat(160),
  ]) {
    const { filename } = exportNoteMarkdown(title, { blocks: [] });
    assert.match(filename, /^note-.+\.md$/);
    assert.doesNotMatch(filename, /[\\/:*?<>|]/);
    assert.ok(filename.length <= 108);
  }
});

test("title is one escaped heading, while Unicode and draft body stay intact", () => {
  const result = exportNoteMarkdown(" Živjo\n# **title** ", {
    blocks: [{ type: "paragraph", text: "Unsaved café 📝" }],
  });
  assert.equal(
    result.markdown,
    "# Živjo \\# \\*\\*title\\*\\*\n\nUnsaved café 📝\n",
  );
  assert.ok(result.filename.includes("Živjo"));
  assert.equal(
    exportNoteMarkdown("", { blocks: [] }).markdown,
    "# Untitled note\n\n",
  );
});
