const { test } = require("node:test");
const assert = require("node:assert/strict");
const { relationTarget, relationTargetIds } = require("../.test-build/database-relation-target.js");

test("legacy database relations retain their target and reject mixed kinds", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(relationTarget({ targetDatabaseId: id }), { kind: "database", databaseId: id });
  assert.deepEqual(relationTarget({ targetKind: "database", targetDatabaseId: id }), { kind: "database", databaseId: id });
  assert.deepEqual(relationTarget({ targetKind: "task" }), { kind: "task" });
  assert.deepEqual(relationTarget({ targetKind: "project" }), { kind: "project" });
  for (const input of [{ targetKind: "task", targetDatabaseId: id }, { targetKind: "other" }, {}, { targetKind: "project", targetDatabaseId: null }])
    assert.throws(() => relationTarget(input));
});

test("relation IDs respect existing task identifiers and reject unsafe or excessive selections", () => {
  const task = { kind: "task" }, database = { kind: "database", databaseId: "11111111-1111-4111-8111-111111111111" };
  const ids = ["task", "t_abcd-1234"];
  assert.deepEqual(relationTargetIds(ids, task), ids);
  assert.notEqual(relationTargetIds(ids, task), ids);
  assert.equal(relationTargetIds(null, task), null);
  assert.throws(() => relationTargetIds(ids, database));
  assert.throws(() => relationTargetIds(["task/other"], task));
  assert.throws(() => relationTargetIds(["task", "task"], task));
  assert.throws(() => relationTargetIds(Array.from({ length: 51 }, (_, index) => `task_${index}`), task));
});
