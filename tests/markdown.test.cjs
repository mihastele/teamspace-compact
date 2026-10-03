const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  markdownShortcut,
  blockMarkdown,
} = require("../.test-build/lib/markdown-shortcuts.js");
const { noteContent } = require("../.test-build/server/validation.js");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const MarkdownText =
  require("../.test-build/app/components/MarkdownText.js").default;

test("one through six hashes plus space produce distinct persisted heading levels", () => {
  for (let level = 1; level <= 6; level++) {
    const block = markdownShortcut("#".repeat(level) + " ");
    assert.deepEqual(block, { type: "heading", level, text: "" });
    assert.deepEqual(noteContent({ blocks: [block] }).blocks[0], block);
    assert.equal(
      blockMarkdown({ ...block, text: "Title" }),
      "#".repeat(level) + " Title",
    );
  }
  for (const text of ["#", "####### ", "#not a heading", "a # ", "## prose"])
    assert.equal(markdownShortcut(text), null);
});

test("list, task, quote, code and divider shortcuts preserve semantics", () => {
  for (const [source, type] of [
    ["- ", "bullet"],
    ["* ", "bullet"],
    ["1. ", "ordered"],
    ["> ", "quote"],
    ["``` ", "code"],
    ["--- ", "divider"],
    ["[ ] ", "todo"],
    ["- [x] ", "todo"],
  ]) {
    const block = markdownShortcut(source);
    assert.equal(block.type, type);
    assert.deepEqual(noteContent({ blocks: [block] }).blocks[0], block);
  }
  assert.equal(markdownShortcut("- [x] ").checked, true);
  assert.equal(markdownShortcut("[ ] ").checked, false);
});

test("extended content validates round trips and legacy headings stay compatible", () => {
  const blocks = [
    { type: "heading", text: "Legacy" },
    { type: "markdown", text: "| A | B |\n| - | - |\n| 1 | 2 |" },
    { type: "todo", text: "Done", checked: true },
    { type: "board", text: "" },
  ];
  assert.deepEqual(noteContent({ blocks }), { blocks });
  for (const block of [
    { type: "heading", text: "", level: 0 },
    { type: "heading", text: "", level: 7 },
    { type: "paragraph", text: "", level: 2 },
    { type: "todo", text: "", checked: "yes" },
    { type: "paragraph", text: "", checked: false },
    { type: "board", text: "foreign-workspace" },
    { type: "board", text: "", workspaceId: "other" },
  ])
    assert.throws(() => noteContent({ blocks: [block] }));
});

test("actual renderer supports CommonMark and GFM including tables, code, footnotes and task lists", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownText, {
      text: "# One\n\n## Two\n\n**bold** *italic* ~~gone~~ `inline`\n\n> quote\n\n1. first\n2. second\n\n- [x] done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\nA footnote[^1].\n\n[^1]: footnote text",
    }),
  );
  for (const tag of [
    "<h1>",
    "<h2>",
    "<strong>",
    "<em>",
    "<del>",
    "<code>",
    "<blockquote>",
    "<ol>",
    "<table>",
    "<pre>",
  ])
    assert.ok(html.includes(tag), tag);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /footnote text/);
});

test("actual renderer rejects script links, raw HTML and executable image URLs", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownText, {
      text: "[bad](javascript:alert%281%29) ![bad](data:text/html,evil) <script>alert(1)</script>\n\n[good](https://example.com)",
    }),
  );
  assert.doesNotMatch(html, /javascript:|data:text\/html|<script>/);
  assert.match(html, /href="https:\/\/example.com\/"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("code export uses a fence longer than embedded backticks", () => {
  assert.equal(
    blockMarkdown({ type: "code", text: "```\nsource" }),
    "````\n```\nsource\n````",
  );
});
