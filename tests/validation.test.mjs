import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, identifier, integer, noteContent, object, taskInput, text } from "../.test-build/validation.js";

const rejected = (run) => assert.throws(run, error => error instanceof ApiError && error.status === 400 && error.code === "invalid_input");

test("server rejects mass assignment of ownership and immutable audit fields", () => {
  for (const field of ["ownerId", "createdBy", "createdAt", "updatedAt", "role", "revision"]) rejected(() => taskInput({ title: "Task", [field]: "forged" }, false));
  for (const input of [null, [], "object", 1]) rejected(() => object(input, []));
});

test("identifiers cannot escape their Firestore path or become compound paths", () => {
  for (const input of ["../owner", "task/subcollection", "a\\b", "", " ", "id\0", "a".repeat(129)]) rejected(() => identifier(input));
  assert.equal(identifier("owner_123-AbC"), "owner_123-AbC");
});

test("task creation applies explicit safe defaults and keeps assignment nullable", () => {
  assert.deepEqual(taskInput({ title: "  New task  " }, false), { title: "New task", description: "", status: "todo", assigneeId: null, dueDate: null, position: 0 });
});

test("partial task changes do not overwrite unsupplied fields", () => {
  assert.deepEqual(taskInput({ status: "done" }, true), { status: "done" });
  assert.deepEqual(taskInput({ assigneeId: null, dueDate: null }, true), { assigneeId: null, dueDate: null });
  rejected(() => taskInput({}, true));
});

test("task status, title, description and position have enforceable bounds", () => {
  for (const status of ["deleted", "DONE", {}, 3]) rejected(() => taskInput({ status }, true));
  for (const title of ["", "   ", "a".repeat(201), null]) rejected(() => taskInput({ title }, true));
  rejected(() => taskInput({ description: "a".repeat(10001) }, true));
  for (const position of [-1, 0.5, NaN, Infinity, 1000000001, "0"]) rejected(() => taskInput({ position }, true));
});

test("calendar dates reject rollovers and accept real leap days", () => {
  for (const dueDate of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-2-01", "today", "2026-10-03T12:00:00Z"]) rejected(() => taskInput({ dueDate }, true));
  assert.deepEqual(taskInput({ dueDate: "2028-02-29" }, true), { dueDate: "2028-02-29" });
});

test("note JSON cannot inject HTML nodes or unsupported schema fields", () => {
  for (const type of ["html", "script", "iframe", null]) rejected(() => noteContent({ blocks: [{ type, text: "unsafe" }] }));
  rejected(() => noteContent({ blocks: [], html: "<script>alert(1)</script>" }));
  rejected(() => noteContent({ blocks: [{ type: "paragraph", text: "Text", html: "<b>" }] }));
  assert.deepEqual(noteContent({ blocks: [{ type: "paragraph", text: "<script>literal text</script>" }] }), { blocks: [{ type: "paragraph", text: "<script>literal text</script>" }] });
});

test("note block counts and total text lengths prevent oversized writes", () => {
  rejected(() => noteContent({ blocks: Array.from({ length: 1001 }, () => ({ type: "paragraph", text: "" })) }));
  rejected(() => noteContent({ blocks: [{ type: "paragraph", text: "a".repeat(20001) }] }));
  rejected(() => noteContent({ blocks: Array.from({ length: 6 }, () => ({ type: "paragraph", text: "a".repeat(20000) })) }));
  assert.equal(noteContent({ blocks: Array.from({ length: 5 }, () => ({ type: "paragraph", text: "a".repeat(20000) })) }).blocks.length, 5);
});

test("numeric guards reject unsafe revision counters and text rejects NUL", () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, 1.5, -1, "1", NaN]) rejected(() => integer(value, "Revision", 0, Number.MAX_SAFE_INTEGER));
  rejected(() => text("bad\0input", "Name", 100));
  assert.equal(text("  Name  ", "Name", 100), "Name");
});
