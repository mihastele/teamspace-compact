const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  updateTaskStatus,
  taskEditPatch,
} = require("../.test-build/task-status.js");

test("quick status updates preserve latest task details and other tasks", () => {
  const latest = Object.freeze({
    id: "a",
    title: "Teammate title",
    description: "Latest remote description",
    status: "todo",
    dueDate: "2026-10-10",
    assigneeId: "member",
    position: 7,
  });
  const other = Object.freeze({ ...latest, id: "b" });
  const tasks = Object.freeze([latest, other]);
  const next = updateTaskStatus(tasks, "a", "done");
  assert.deepEqual(next[0], { ...latest, status: "done" });
  assert.equal(next[1], other);
  assert.equal(latest.status, "todo");
  assert.deepEqual(updateTaskStatus(next, "a", "done"), next);
});

test("a stale quick move cannot resurrect a deleted preview task", () => {
  assert.throws(
    () => updateTaskStatus([], "deleted", "doing"),
    /no longer exists/,
  );
});

test("task editor sends changed fields only, preserving concurrent moves and details", () => {
  const baseline = {
    title: "Original",
    description: "Original detail",
    status: "todo",
    assigneeId: "member",
    dueDate: "2026-10-10",
  };
  const patch = taskEditPatch(baseline, {
    ...baseline,
    description: "My detail",
  });
  assert.deepEqual(patch, { description: "My detail" });
  const remote = { ...baseline, title: "Teammate title", status: "doing" };
  assert.deepEqual(
    { ...remote, ...patch },
    { ...remote, description: "My detail" },
  );
  assert.deepEqual(taskEditPatch(baseline, baseline), {});
});

test("task editor includes intentional nullable clears without rewriting defaults", () => {
  assert.deepEqual(
    taskEditPatch(
      { title: "Task", assigneeId: "member", dueDate: "2026-10-10" },
      {
        title: "Task",
        description: "",
        status: "todo",
        assigneeId: null,
        dueDate: null,
      },
    ),
    { assigneeId: null, dueDate: null },
  );
});
