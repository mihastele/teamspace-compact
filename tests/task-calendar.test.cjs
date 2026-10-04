const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { calendarDays, calendarLastDay, calendarTasks, calendarAgenda, shiftDay, shiftMonth, calendarLabel } = require("../.test-build/task-calendar.js");
const task = (id, dueDate, status = "todo", position = 0) => ({ id, dueDate, status, position, title: id, description: "", assigneeId: null });

test("Monday-first grids include every leap/month day exactly once and cross years", () => {
  for (const month of ["2028-02", "2026-12", "2027-01", "2026-03", "2026-10"]) {
    const days = calendarDays(month);
    assert.equal(days.length, 42);
    assert.equal(new Set(days.map(({ day }) => day)).size, 42);
    assert.equal(new Date(days[0].day + "T12:00:00Z").getUTCDay(), 1);
    const own = days.filter(({ inMonth }) => inMonth);
    assert.equal(own[0].day, `${month}-01`);
    assert.equal(own.at(-1).day, calendarLastDay(month));
    for (let i = 1; i < days.length; i++) assert.equal(days[i].day, shiftDay(days[i - 1].day, 1));
  }
  assert.equal(calendarLastDay("2028-02"), "2028-02-29");
  assert.equal(calendarLastDay("2026-02"), "2026-02-28");
});

test("month navigation clamps days and date arithmetic handles midnight/year boundaries", () => {
  assert.equal(shiftMonth("2026-01-31", 1), "2026-02-28");
  assert.equal(shiftMonth("2028-01-31", 1), "2028-02-29");
  assert.equal(shiftMonth("2026-12-31", 1), "2027-01-31");
  assert.equal(shiftMonth("2027-01-31", -1), "2026-12-31");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDay("2028-03-01", -1), "2028-02-29");
  assert.throws(() => calendarDays("2026-13"));
  assert.throws(() => shiftDay("2026-02-30", 1));
  assert.throws(() => shiftDay("0001-01-01", -1));
  assert.equal(calendarLastDay("9999-12"), "9999-12-31");
});

test("calendar grouping is deterministic, does not mutate tasks and retains malformed legacy deadlines", () => {
  const tasks = Object.freeze([
    Object.freeze(task("z", "2026-10-04")), Object.freeze(task("a", "2026-10-04")),
    Object.freeze(task("first", "2026-10-04", "doing", -1)), Object.freeze(task("no-date", null)),
    Object.freeze(task("invalid", "2026-02-30")), Object.freeze(task("complete", "2026-10-03", "done")),
  ]);
  const open = calendarTasks(tasks, false);
  assert.deepEqual(open.dated.get("2026-10-04").map(({ id }) => id), ["first", "a", "z"]);
  assert.deepEqual(open.undated.map(({ id }) => id), ["invalid", "no-date"]);
  assert.equal(open.dated.has("2026-10-03"), false);
  assert.deepEqual([...calendarTasks([...tasks].reverse(), true).dated.keys()], ["2026-10-03", "2026-10-04"]);
});

test("agenda separates overdue from scheduled without duplicate tasks or hidden completed history", () => {
  const { dated } = calendarTasks([
    task("old", "2026-09-01"), task("yesterday", "2026-10-03"),
    task("finished", "2026-10-03", "done"), task("today", "2026-10-04"), task("future", "2026-11-01"),
  ], true);
  const { overdue, scheduled } = calendarAgenda(dated, "2026-10", "2026-10-04");
  const ids = (groups) => groups.flatMap(([, rows]) => rows.map(({ id }) => id));
  assert.deepEqual(ids(overdue), ["old", "yesterday"]);
  assert.deepEqual(ids(scheduled), ["finished", "today", "future"]);
  assert.equal(new Set([...ids(overdue), ...ids(scheduled)]).size, 5);
  assert.deepEqual(ids(calendarAgenda(dated, "2026-11", "2026-10-04").scheduled), ["future"]);
  assert.deepEqual(calendarAgenda(calendarTasks([task("done", "2026-10-01", "done")], true).dated, "2026-10", "2026-10-04").overdue, []);
});

test("remote reschedules and removals change derived calendar without resurrecting old rows", () => {
  const initial = [task("a", "2026-10-04"), task("b", "2026-10-05")];
  const before = calendarTasks(initial, false);
  const after = calendarTasks([task("a", "2026-10-08")], false);
  assert.equal(after.dated.has("2026-10-04"), false);
  assert.equal(after.dated.has("2026-10-05"), false);
  assert.deepEqual(after.dated.get("2026-10-08").map(({ id }) => id), ["a"]);
  assert.equal(before.dated.get("2026-10-04")[0].dueDate, "2026-10-04");
});

test("calendar labels and cells remain date-only across timezone and DST changes", () => {
  for (const timezone of ["Europe/Ljubljana", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const result = spawnSync(process.execPath, ["-e", `
      const assert = require('node:assert/strict');
      const { shiftDay, calendarDays, calendarLabel } = require(${JSON.stringify(require.resolve("../.test-build/task-calendar.js"))});
      assert.equal(shiftDay('2026-03-28', 2), '2026-03-30');
      assert.equal(shiftDay('2026-10-24', 2), '2026-10-26');
      assert.equal(calendarDays('2026-03')[0].day, '2026-02-23');
      assert.equal(calendarLabel('2026-10-04'), 'Sunday, October 4, 2026');
    `], { env: { ...process.env, TZ: timezone }, encoding: "utf8", timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(calendarLabel("2026-10-01", true), "October 2026");
});
