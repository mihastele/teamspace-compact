const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mentionIds, commentMentions, commentWindow, postPreviewComment, deletePreviewComment, validCommentDraft, commentIdentity, reconcileCommentSnapshots, canReleaseCommentRejection } = require("../.test-build/conversations.js");
const members = [{ id: "preview", displayName: "You", role: "owner" }];
const packet = body => ({ operationId: crypto.randomUUID(), body });
test("mentions deduplicate member identities, reject outsiders and enforce the bound", () => {
  assert.deepEqual(mentionIds("Hi @{preview} and @{preview}"), ["preview"]);
  assert.deepEqual(commentMentions("Hi @{preview}", members), [{ uid: "preview", displayName: "You" }]);
  assert.throws(() => commentMentions("Hi @{outsider}", members), /no longer/);
  assert.throws(() => commentMentions(Array.from({ length: 11 }, (_, i) => `@{u${i}}`).join(" "), []), /10/);
});
test("preview posts are immutable exact retries and deleted-message retries cannot resurrect body", async () => {
  const request = packet(" Hello @{preview} ");
  let rows = await postPreviewComment([], request, members, 1000);
  assert.equal(rows[0].body, "Hello @{preview}");
  assert.strictEqual(await postPreviewComment(rows, request, [], 2000), rows);
  await assert.rejects(postPreviewComment(rows, { ...request, body: "changed" }, members, 2000), /identity/);
  rows = deletePreviewComment(rows, rows[0].id);
  assert.equal(rows[0].body, "");
  assert.equal(rows[0].deleted, true);
  assert.deepEqual(rows[0].mentions, []);
  assert.ok(!JSON.stringify(rows).includes("Hello"));
  assert.strictEqual(await postPreviewComment(rows, request, [], 3000), rows);
  assert.equal(rows[0].body, "");
  assert.deepEqual(deletePreviewComment(rows, rows[0].id), rows);
});
test("preview message validation rejects oversized, empty and malformed operations", async () => {
  for (const body of ["", " ", "a".repeat(4001), "bad\0data"])
    await assert.rejects(postPreviewComment([], packet(body), members, 0), /message/);
  await assert.rejects(postPreviewComment([], { operationId: "wrong", body: "Hi" }, members, 0), /identity/);
  assert.throws(() => deletePreviewComment([], "missing"), /no longer/);
  assert.throws(() => deletePreviewComment([{ id: "foreign", authorId: "other" }], "foreign"), /author/);
});
test("equal server timestamps use deterministic IDs and newest window displays in chronological order", () => {
  const rows = [{ id: "b", createdAt: 10 }, { id: "a", createdAt: 10 }, { id: "c", createdAt: 20 }];
  assert.deepEqual(commentWindow(rows, 2).map(r => r.id), ["b", "c"]);
  assert.deepEqual(commentWindow([...rows].reverse(), 2), commentWindow(rows, 2));
  assert.deepEqual(rows.map(r => r.id), ["b", "a", "c"]);
});
test("persisted recovery accepts only exact displayed packet and valid identities", () => {
  const request = packet("Uncertain response");
  const draft = { version: 1, body: request.body, pending: request };
  assert.equal(validCommentDraft(draft), true);
  assert.equal(validCommentDraft({ ...draft, body: "A different unsent draft" }), false);
  assert.equal(validCommentDraft({ ...draft, pending: { ...request, operationId: "-".repeat(36) } }), false);
  assert.equal(validCommentDraft({ ...draft, body: "bad\0data", pending: null }), false);
  assert.equal(validCommentDraft({ version: 1, body: "", pending: null }), true);
});
test("optimistic identity equals server UID-bound identity before acknowledgment", async () => {
  const request = packet("Hello");
  const expected = require("node:crypto").createHash("sha256").update(`user:${request.operationId}`).digest("hex");
  assert.equal(await commentIdentity("user", request.operationId, true), expected);
  assert.notEqual(await commentIdentity("other", request.operationId, true), expected);
  assert.equal(await commentIdentity("preview", request.operationId, false), request.operationId);
});
test("terminal deletions survive duplicate stale snapshots and late acknowledgments", () => {
  const deleted = new Set();
  const original = { id: "message", body: "Removed text", mentions: [{ uid: "u", displayName: "U" }], deleted: false };
  reconcileCommentSnapshots([{ ...original, body: "", mentions: [], deleted: true }], deleted);
  reconcileCommentSnapshots([], deleted);
  const replay = reconcileCommentSnapshots([original, { ...original }], deleted);
  assert.ok(replay.every(row => row.deleted && row.body === "" && row.mentions.length === 0));
  assert.equal(original.body, "Removed text");
});
test("revocation after a lost acknowledgment never unlocks a new operation identity", () => {
  for (const status of [400, 401, 403, 404]) {
    assert.equal(canReleaseCommentRejection(false, { status }), true);
    assert.equal(canReleaseCommentRejection(true, { status }), false);
  }
  for (const status of [408, 409, 429, 500, 502]) assert.equal(canReleaseCommentRejection(false, { status }), false);
  assert.equal(canReleaseCommentRejection(false, new Error("Lost response")), false);
});
