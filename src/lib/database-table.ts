import type { DatabaseEntry, DatabaseField } from "./databases";
import type { Member } from "./model";
import type { TableSort } from "./task-table";
import { propertyDisplay } from "./board-properties";

const compareText = (first: string, second: string) => first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });

export function databaseColumns(fields: readonly DatabaseField[]) {
  return [{ id: "title", label: "Title" }, ...fields.map(field => ({ id: `property:${field.id}`, label: field.name }))];
}

/** Sort only the supplied loaded rows; never change records or the server paging cursor. */
export function sortDatabaseEntries(entries: readonly DatabaseEntry[], sort: TableSort | null, fields: readonly DatabaseField[], members: readonly Member[], targets: Readonly<Record<string, DatabaseEntry>>): DatabaseEntry[] {
  const field = fields.find(field => `property:${field.id}` === sort?.column);
  const active = sort && (sort.column === "title" || field) ? sort : null;
  const cells = new Map(entries.map(entry => {
    const value = field ? entry.propertyValues[field.id] : undefined;
    const text = !active || active.column === "title" ? entry.title : field!.type === "relation"
      ? (Array.isArray(value) ? value : []).map(id => targets[id]?.title ?? "Unavailable entry").sort(compareText).join(", ")
      : propertyDisplay(field!, value, members);
    return [entry.id, text] as const;
  }));
  return [...entries].sort((first, second) => {
    const a = cells.get(first.id)!, b = cells.get(second.id)!;
    if (Boolean(a) !== Boolean(b)) return a ? -1 : 1;
    let compared = active && field?.type === "number" && a && b
      ? Number(first.propertyValues[field.id]) - Number(second.propertyValues[field.id])
      : compareText(a, b);
    if (active?.direction === "descending") compared *= -1;
    return compared || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  });
}
