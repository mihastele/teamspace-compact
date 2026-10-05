const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  HISTORY_INTERVAL, HISTORY_RETENTION, checkpointLocalPage,
  nameLocalVersion, restoreLocalPage, visibleVersions, reconcilePageSnapshots,
} = require("../.test-build/page-history.js");
const note = (revision, text = String(revision)) => ({
  id: "page", parentId: "parent", title: `Title ${revision}`, revision,
  content: { blocks: [{ type: "heading", level: 2, text }, { type: "board", text: "" }] },
});
test("checkpoints follow saved activity at five-minute cadence and expire at 30 days", () => {
  let history = checkpointLocalPage(undefined, note(1), 1000);
  history = checkpointLocalPage(history, note(2), 1000 + HISTORY_INTERVAL - 1);
  assert.deepEqual(history.versions.map(v => v.sourceRevision), [1]);
  history = checkpointLocalPage(history, note(3), 1000 + HISTORY_INTERVAL);
  assert.deepEqual(history.versions.map(v => v.sourceRevision), [1, 3]);
  assert.deepEqual(visibleVersions(history, 1000 + HISTORY_RETENTION).map(v => v.sourceRevision), [3]);
});
test("named versions are permanent, immutable and retryable after later edits", () => {
  const current = note(1);
  let history = checkpointLocalPage(undefined, current, 1000);
  history = nameLocalVersion(history, current, 1, " Release ", 2000);
  current.content.blocks[0].text = "mutated outside history";
  assert.equal(history.versions[0].content.blocks[0].text, "1");
  assert.equal(visibleVersions(history, 1000 + HISTORY_RETENTION * 2).length, 1);
  assert.strictEqual(nameLocalVersion(history, note(2), 1, "Release", 3000), history);
  assert.throws(() => nameLocalVersion(history, note(1), 1, "Different", 3000), /already/);
  assert.throws(() => nameLocalVersion(history, note(2), 1, "New", 3000), /changed/);
  assert.throws(() => nameLocalVersion(history, note(2), 2, "a".repeat(101), 3000), /100/);
});
test("restore backs up current state and preserves location, with payload-bound duplicate receipts", () => {
  let history = nameLocalVersion(undefined, note(1), 1, "Release", 1000);
  const current = note(5, "Current");
  const result = restoreLocalPage(history, current, "r1", 5, "operation", 2000);
  assert.equal(result.note.revision, 6);
  assert.equal(result.note.parentId, "parent");
  assert.equal(result.note.title, "Title 1");
  assert.deepEqual(result.note.content, note(1).content);
  assert.equal(result.history.versions.find(v => v.id === "r5").content.blocks[0].text, "Current");
  assert.equal(result.history.checkpointAt, 2000);
  assert.equal(checkpointLocalPage(result.history, note(7), 2001).versions.length, result.history.versions.length);
  const later = note(7, "Teammate");
  assert.strictEqual(restoreLocalPage(result.history, later, "r1", 5, "operation", 3000).note, later);
  assert.throws(() => restoreLocalPage(result.history, later, "r1", 7, "operation", 3000), /identity/);
  assert.throws(() => restoreLocalPage(history, current, "r1", 4, "other", 3000), /changed/);
  result.note.content.blocks[0].text = "Edited restored page";
  assert.equal(history.versions[0].content.blocks[0].text, "1");
});
test("expired versions cannot restore and pre-restore automatic backup gets a full retention window", () => {
  let history = checkpointLocalPage(undefined, note(1), 1000);
  assert.throws(() => restoreLocalPage(history, note(2), "r1", 2, "op", 1000 + HISTORY_RETENTION), /expired/);
  history = nameLocalVersion(history, note(1), 1, "Keep", 2000);
  history = checkpointLocalPage(history, note(2), 1000 + HISTORY_INTERVAL);
  const restored = restoreLocalPage(history, note(2), "r1", 2, "op", 1000 + HISTORY_RETENTION - 1);
  assert.equal(restored.history.versions.find(v => v.id === "r2").expiresAt, 1000 + HISTORY_RETENTION * 2 - 1);
  assert.equal(restored.history.versions.find(v => v.id === "r1").expiresAt, null);
});
test("stale cache cannot rewind acknowledged pages but missing/deleting rows never resurrect", () => {
  const acknowledged = note(10);
  assert.strictEqual(reconcilePageSnapshots([acknowledged], [note(9)])[0], acknowledged);
  const newer = note(11);
  assert.strictEqual(reconcilePageSnapshots([acknowledged], [newer])[0], newer);
  assert.deepEqual(reconcilePageSnapshots([acknowledged], []), []);
  const fenced = { ...note(9), deleting: true };
  assert.strictEqual(reconcilePageSnapshots([acknowledged], [fenced])[0], fenced);
});
