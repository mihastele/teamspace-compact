const { test } = require("node:test");
const assert = require("node:assert/strict");
const { matchNote } = require("../.test-build/note-search.js");
const {
  flattenNoteTree,
  filterVisibleNoteTree,
  noteAncestors,
} = require("../.test-build/note-tree.js");
const note = (id, title, text, parentId = null) => ({
  id,
  title,
  parentId,
  revision: 1,
  content: { blocks: [{ type: "paragraph", text }] },
});

test("title and body matching ignore case and normalize whitespace", () => {
  assert.deepEqual(
    matchNote(note("a", "Project  Plan", ""), " project plan "),
    { matches: true },
  );
  assert.equal(
    matchNote(
      note("a", "Other", "A launch\n\tdecision tomorrow"),
      "LAUNCH decision",
    ).matches,
    true,
  );
  assert.equal(
    matchNote(note("a", "Other", "No match"), "missing").matches,
    false,
  );
  assert.deepEqual(matchNote(note("a", "Other", ""), "  "), { matches: true });
});

test("body excerpt is bounded and does not reinterpret markup", () => {
  const result = matchNote(
    note(
      "a",
      "Other",
      "x".repeat(150) + " <script>needle</script> " + "y".repeat(150),
    ),
    "needle",
  );
  assert.equal(result.matches, true);
  assert.ok(result.excerpt.includes("<script>needle</script>"));
  assert.ok(result.excerpt.length <= 102);
  assert.ok(result.excerpt.startsWith("…") && result.excerpt.endsWith("…"));
});

test("content-only descendant match remains visible through collapsed ancestors", () => {
  const notes = [
    note("root", "Handbook", ""),
    note("child", "Research", "", "root"),
    note("leaf", "Interviews", "Café findings", "child"),
    note("other", "Other", ""),
  ];
  const matches = new Set();
  for (const n of notes)
    if (matchNote(n, "café").matches) {
      matches.add(n.id);
      noteAncestors(notes, n.id).forEach((a) => matches.add(a.id));
    }
  assert.deepEqual(
    filterVisibleNoteTree(flattenNoteTree(notes), () => false, matches).map(
      (row) => row.note.id,
    ),
    ["root", "child", "leaf"],
  );
});

test("all textual block types are searchable; an empty board contributes no tasks", () => {
  const n = note("a", "Other", "");
  n.content.blocks = [
    { type: "heading", level: 2, text: "Budget" },
    { type: "code", text: "const total = 4" },
    { type: "markdown", text: "**Summary**" },
    { type: "board", text: "" },
  ];
  for (const term of ["budget", "total", "summary"])
    assert.equal(matchNote(n, term).matches, true);
  assert.equal(matchNote(n, "task").matches, false);
});
