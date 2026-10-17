import type { BoardProperty } from "./model";

export type Filter = { and: Filter[] } | { or: Filter[] } | { field: string; op: string; value?: unknown };
export type TicketQuery = { version: 1; filter: Filter; sort: { field: string; direction: "asc" | "desc" }[]; timeZone: string };
export type ViewConfig = { name: string; layout: "board" | "table" | "list"; groupBy: "status" | "priority" | "none"; columns: string[]; query: TicketQuery };
export type SavedView = ViewConfig & { id: string; revision: number; archived: boolean };
/** An acknowledged write may arrive before its workspace snapshot. Never regress it. */
export function mergeSavedViews(snapshot: readonly SavedView[], acknowledged: readonly SavedView[]): SavedView[] {
  const rows = new Map(acknowledged.map(view => [view.id, view]));
  for (const view of snapshot) if (!rows.has(view.id) || rows.get(view.id)!.revision <= view.revision) rows.set(view.id, view);
  return [...rows.values()];
}
export function ticketViewUrl(current: string, workspace: string, viewId: string, projectId: string, override?: ViewConfig): string {
  const url = new URL(current);
  url.searchParams.set("workspace", workspace); url.searchParams.set("ticketView", viewId);
  if (projectId) url.searchParams.set("project", projectId); else url.searchParams.delete("project");
  if (override) url.searchParams.set("ticketQuery", JSON.stringify(override)); else url.searchParams.delete("ticketQuery");
  if (url.href.length > 7000) throw new Error("These settings are too large for a reusable URL. Save the view to share it.");
  return url.href;
}
export const builtinFields = { title: "text", description: "longText", status: "status", priority: "priority", assigneeId: "person", projectId: "relation", dueDate: "date", estimate: "number", position: "number" } as const;
const id = /^[A-Za-z0-9_-]{1,128}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function queryFieldType(field: string, fields: readonly BoardProperty[]): string {
  if (Object.hasOwn(builtinFields, field)) return builtinFields[field as keyof typeof builtinFields];
  if (field.startsWith("custom:") && uuid.test(field.slice(7))) {
    const found = fields.find(item => item.id === field.slice(7));
    if (found) return found.type;
  }
  throw new Error("Unknown query field. Refresh the field definitions.");
}
export function queryOperators(type: string): string[] {
  return ["isEmpty", "isNotEmpty", ...(type === "multiSelect" ? ["containsAny", "containsAll"] :
    ["eq", "neq", ...(["select", "person", "relation", "status", "priority"].includes(type) ? ["in", "notIn"] : []),
      ...(["text", "longText", "url"].includes(type) ? ["contains", "notContains"] : []),
      ...(type === "number" ? ["gt", "lt"] : []), ...(type === "date" ? ["before", "after", "between"] : [])])];
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error("Invalid query object.");
  return value as Record<string, unknown>;
}
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && !value.startsWith("0000-") && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateTicketQuery(value: unknown, fields: readonly BoardProperty[]): TicketQuery {
  const data = object(value, ["version", "filter", "sort", "timeZone"]);
  if (data.version !== 1 || typeof data.timeZone !== "string" || data.timeZone.length > 80) throw new Error("Unsupported query version or timezone.");
  try { new Intl.DateTimeFormat("en", { timeZone: data.timeZone }).format(); } catch { throw new Error("Choose a valid IANA timezone."); }
  let count = 0, valueCount = 0;
  function scalar(value: unknown, type: string, field: string): unknown {
    if (++valueCount > 512) throw new Error("Filters support at most 512 comparison values.");
    if (type === "number") { if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("Expected a finite query number."); return value; }
    if (type === "checkbox") { if (typeof value !== "boolean") throw new Error("Expected a checkbox value."); return value; }
    if (typeof value !== "string" || value.length > 2000 || /\u0000/.test(value)) throw new Error("Invalid query value.");
    if (type === "date" && !validDate(value) && !/^@today(?:[+-](?:[0-9]|[1-9][0-9]{1,2}))?$/.test(value)) throw new Error("Expected a date or @today offset.");
    if (type === "status" && !["todo", "doing", "done"].includes(value)) throw new Error("Invalid status.");
    if (type === "priority" && !["none", "low", "medium", "high", "urgent"].includes(value)) throw new Error("Invalid priority.");
    if (type === "person" && value !== "@me" && !id.test(value)) throw new Error("Invalid member ID.");
    if (type === "relation" && !(field === "projectId" && value === "@project") && !id.test(value)) throw new Error("Invalid Project ID.");
    if (["select", "multiSelect"].includes(type) && !fields.find(item => `custom:${item.id}` === field)?.options.some(option => option.id === value)) throw new Error("Unknown custom option ID.");
    return value;
  }
  function node(value: unknown, depth: number): Filter {
    if (++count > 32 || depth > 4) throw new Error("Filters support 32 nodes and four nested groups.");
    const item = object(value, ["and", "or", "field", "op", "value"]);
    const group = "and" in item ? "and" : "or" in item ? "or" : null;
    if (group) {
      if (Object.keys(item).length !== 1 || !Array.isArray(item[group])) throw new Error("Invalid filter group.");
      return { [group]: item[group].map(child => node(child, depth + 1)) } as Filter;
    }
    if (typeof item.field !== "string" || typeof item.op !== "string") throw new Error("Choose a field and operator.");
    const type = queryFieldType(item.field, fields);
    if (!queryOperators(type).includes(item.op)) throw new Error("That operator is not supported for this field.");
    if (["isEmpty", "isNotEmpty"].includes(item.op)) {
      if ("value" in item) throw new Error("Empty filters do not take values.");
      return { field: item.field, op: item.op };
    }
    let selected: unknown;
    if (["in", "notIn", "containsAny", "containsAll", "between"].includes(item.op)) {
      if (!Array.isArray(item.value) || item.value.length < 1 || item.value.length > 50 || (item.op === "between" && item.value.length !== 2)) throw new Error("Choose a bounded list of query values.");
      selected = item.value.map(value => scalar(value, type, item.field as string));
      if (new Set((selected as unknown[]).map(value => JSON.stringify(value))).size !== (selected as unknown[]).length && item.op !== "between") throw new Error("Duplicate query values.");
    } else selected = scalar(item.value, type, item.field);
    return { field: item.field, op: item.op, value: selected };
  }
  const filter = node(data.filter, 0);
  if (!Array.isArray(data.sort) || data.sort.length > 3) throw new Error("Choose at most three sorts.");
  const sort = data.sort.map(value => {
    const item = object(value, ["field", "direction"]);
    if (typeof item.field !== "string" || !["asc", "desc"].includes(String(item.direction)) || queryFieldType(item.field, fields) === "multiSelect") throw new Error("Unsupported sort.");
    return { field: item.field, direction: item.direction as "asc" | "desc" };
  });
  if (new Set(sort.map(item => item.field)).size !== sort.length) throw new Error("Duplicate sort field.");
  return { version: 1, filter, sort, timeZone: data.timeZone };
}
export function validateViewConfig(value: unknown, fields: readonly BoardProperty[]): ViewConfig {
  const item = object(value, ["name", "layout", "groupBy", "columns", "query"]);
  if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || /\u0000/.test(item.name) || !["board", "table", "list"].includes(String(item.layout)) || !["status", "priority", "none"].includes(String(item.groupBy))) throw new Error("Invalid view name or layout.");
  if (item.layout === "board" && item.groupBy === "none") throw new Error("Board views need a grouping.");
  if (!Array.isArray(item.columns) || item.columns.length > 40 || !item.columns.includes("title") || new Set(item.columns).size !== item.columns.length) throw new Error("Choose visible columns including Task.");
  for (const column of item.columns) { if (typeof column !== "string") throw new Error("Invalid column."); queryFieldType(column, fields); }
  return { name: item.name.trim(), layout: item.layout as ViewConfig["layout"], groupBy: item.groupBy as ViewConfig["groupBy"], columns: item.columns as string[], query: validateTicketQuery(item.query, fields) };
}
export function resolveTicketQuery(query: TicketQuery, uid: string, projectId?: string, instant = new Date(), fields: readonly BoardProperty[] = []): TicketQuery {
  const parts = new Intl.DateTimeFormat("en", { timeZone: query.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  function resolve(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(resolve);
    if (value === "@me") return uid;
    if (value === "@project") { if (!projectId || !id.test(projectId)) throw new Error("Choose a Project for this view."); return projectId; }
    if (typeof value === "string" && /^@today(?:[+-][0-9]+)?$/.test(value)) {
      const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + Number(value.slice(6) || 0));
      const result = date.toISOString().slice(0, 10); if (!validDate(result)) throw new Error("Relative date is outside the supported range."); return result;
    }
    return value;
  }
  function walk(filter: Filter): Filter {
    if ("and" in filter) return { and: filter.and.map(walk) };
    if ("or" in filter) return { or: filter.or.map(walk) };
    const type = queryFieldTypeForToken(filter.field);
    // Text containing token-like strings stays literal. Only typed tokens resolve.
    return { ...filter, ...("value" in filter ? { value: type ? resolve(filter.value) : filter.value } : {}) };
  }
  function queryFieldTypeForToken(field: string) { return ["person", "relation", "date"].includes(queryFieldType(field, fields)); }
  return { ...query, filter: walk(query.filter) };
}
export function defaultTicketViews(timeZone = "UTC"): (ViewConfig & { id: string })[] {
  const config = (id: string, name: string, filter: Filter): ViewConfig & { id: string } => ({ id, name, layout: "board", groupBy: "status", columns: ["title", "status", "assigneeId", "dueDate", "projectId"], query: { version: 1, filter, sort: [{ field: "position", direction: "asc" }], timeZone } });
  return [config("default-engineering", "Engineering Kanban", { and: [] }), config("default-project", "Project board", { field: "projectId", op: "eq", value: "@project" }),
    config("default-mine", "My open work", { and: [{ field: "assigneeId", op: "eq", value: "@me" }, { field: "status", op: "neq", value: "done" }] }),
    config("default-week", "This week", { field: "dueDate", op: "between", value: ["@today", "@today+7"] }),
    config("default-overdue", "Overdue", { and: [{ field: "dueDate", op: "before", value: "@today" }, { field: "status", op: "neq", value: "done" }] })];
}
