const { test } = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ConversationBody = require("../.test-build/app/components/ConversationBody.js").default;
test("comment renderer escapes message and trusted mention names as plain text", () => {
  const comment = { body: '<script>alert(1)</script> @{user} javascript:alert(2) @{unknown}', mentions: [{ uid: "user", displayName: '<img src=x onerror="alert(3)">' }], deleted: false };
  const html = renderToStaticMarkup(React.createElement(ConversationBody, { comment, mentionClassName: "mention" }));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('class="mention"'));
  assert.ok(html.includes("@&lt;img"));
  assert.ok(html.includes("@{unknown}"));
  assert.ok(!/<script|<img|<a /.test(html));
});
test("deleted comments never render stale body or mention metadata", () => {
  const html = renderToStaticMarkup(React.createElement(ConversationBody, { comment: { body: "Deleted sensitive text @{user}", mentions: [{ uid: "user", displayName: "User" }], deleted: true } }));
  assert.ok(html.includes("Comment deleted."));
  assert.ok(!html.includes("sensitive"));
  assert.ok(!html.includes("@User"));
});
