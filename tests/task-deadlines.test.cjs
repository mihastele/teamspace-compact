const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  localCalendarDay,
  deadlineState,
  matchesDeadline,
} = require("../.test-build/task-deadlines.js");
const task = (dueDate, status = "todo") => ({
  id: "a",
  title: "Task",
  description: "",
  status,
  dueDate,
  assigneeId: null,
  position: 0,
});

test("calendar formatting uses local fields without locale assumptions", () => {
  assert.equal(localCalendarDay(new Date(2026, 0, 2, 0, 5)), "2026-01-02");
  assert.equal(localCalendarDay(new Date(2026, 11, 31, 23, 55)), "2026-12-31");
});
test("deadlines distinguish yesterday, today, future and completed work", () => {
  assert.equal(deadlineState(task("2026-10-03"), "2026-10-04"), "overdue");
  assert.equal(deadlineState(task("2026-10-04"), "2026-10-04"), "today");
  assert.equal(deadlineState(task("2026-10-05"), "2026-10-04"), "scheduled");
  assert.equal(
    deadlineState(task("2026-10-03", "done"), "2026-10-04"),
    "scheduled",
  );
  assert.equal(deadlineState(task(null), "2026-10-04"), "none");
});
test("focused deadline views omit completed tasks and preserve the all view", () => {
  for (const filter of ["overdue", "today", "week", "undated"]) {
    assert.equal(
      matchesDeadline(task("2026-10-04", "done"), filter, "2026-10-04"),
      false,
    );
  }
  assert.equal(
    matchesDeadline(task(null, "done"), "undated", "2026-10-04"),
    false,
  );
  assert.equal(
    matchesDeadline(task("2026-10-03", "done"), "all", "2026-10-04"),
    true,
  );
  assert.equal(matchesDeadline(task(null), "undated", "2026-10-04"), true);
  assert.equal(
    matchesDeadline(task("2026-10-03"), "overdue", "2026-10-04"),
    true,
  );
  assert.equal(
    matchesDeadline(task("2026-10-04"), "overdue", "2026-10-04"),
    false,
  );
  assert.equal(
    matchesDeadline(task("2026-10-04", "doing"), "today", "2026-10-04"),
    true,
  );
  assert.equal(
    matchesDeadline(task("2026-10-05"), "today", "2026-10-04"),
    false,
  );
});
test("seven-day range includes today and six following calendar days across boundaries", () => {
  for (const [start, last, outside] of [
    ["2026-12-28", "2027-01-03", "2027-01-04"],
    ["2028-02-26", "2028-03-03", "2028-03-04"],
    ["2026-03-27", "2026-04-02", "2026-04-03"],
    ["2026-10-23", "2026-10-29", "2026-10-30"],
  ]) {
    assert.equal(matchesDeadline(task(start), "week", start), true);
    assert.equal(matchesDeadline(task(last), "week", start), true);
    assert.equal(matchesDeadline(task(outside), "week", start), false);
    assert.equal(matchesDeadline(task("2025-01-01"), "week", start), false);
  }
});
test("dated filters wait for client timezone and do not match undated work", () => {
  for (const filter of ["overdue", "today", "week"]) {
    assert.equal(matchesDeadline(task("2026-10-04"), filter, ""), false);
    assert.equal(matchesDeadline(task(null), filter, "2026-10-04"), false);
  }
  assert.equal(deadlineState(task("2026-10-03"), ""), "scheduled");
});

test("seven-day windows survive actual spring and autumn clock changes", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const assert = require('node:assert/strict');
    const { matchesDeadline } = require(${JSON.stringify(require.resolve("../.test-build/task-deadlines.js"))});
    assert.equal((new Date('2026-03-29T12:00:00') - new Date('2026-03-28T12:00:00')) / 3600000, 23);
    assert.equal((new Date('2026-10-25T12:00:00') - new Date('2026-10-24T12:00:00')) / 3600000, 25);
    for (const [today, last, outside] of [
      ['2026-03-28', '2026-04-03', '2026-04-04'],
      ['2026-10-24', '2026-10-30', '2026-10-31'],
    ]) {
      assert.equal(matchesDeadline({status: 'todo', dueDate: last}, 'week', today), true);
      assert.equal(matchesDeadline({status: 'todo', dueDate: outside}, 'week', today), false);
    }
  `,
    ],
    {
      env: { ...process.env, TZ: "Europe/Ljubljana" },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
