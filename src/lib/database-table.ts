import { createdTimeDisplay, type DatabaseEntry, type DatabaseField } from "./databases";
import type { Member, Project, Task } from "./model";
import type { TableSort } from "./task-table";
import { propertyDisplay } from "./board-properties";

const compareText = (first: string, second: string) => first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });

export function databaseColumns(fields: readonly DatabaseField[]) {
  return [{ id: "title", label: "Title" }, ...fields.map(field => ({ id: `property:${field.id}`, label: field.name }))];
}

/** Sort only the supplied loaded rows; never change records or the server paging cursor. */
export function sortDatabaseEntries(entries: readonly DatabaseEntry[], sort: TableSort | null, fields: readonly DatabaseField[], members: readonly Member[], targets: Readonly<Record<string, DatabaseEntry>>, entities?: { tasks: readonly Task[]; projects: readonly Project[] }): DatabaseEntry[] {
  const field = fields.find(field => `property:${field.id}` === sort?.column);
  const active = sort && (sort.column === "title" || field) ? sort : null;
  const tasks = new Map(entities?.tasks.map(task=>[task.id,task.title]));
  const projects = new Map(entities?.projects.map(project=>[project.id,project.name]));
  const cells = new Map(entries.map(entry => {
    const value = field ? entry.propertyValues[field.id] : undefined;
    const text = !active || active.column === "title" ? entry.title : field!.type === "relation"
      ? (Array.isArray(value) ? value : []).map(id => field!.targetKind === "task" ? tasks.get(id) ?? "Unavailable task" : field!.targetKind === "project" ? projects.get(id) ?? "Unavailable project" : targets[id]?.title ?? "Unavailable entry").sort(compareText).join(", ")
      : field!.type === "createdTime" ? createdTimeDisplay(entry) : propertyDisplay(field!, value, members);
    return [entry.id, text] as const;
  }));
  const statusOrder = field?.type === "status" ? [...field.options].sort((a,b) => (["todo","doing","done"].indexOf(a.group ?? "") - ["todo","doing","done"].indexOf(b.group ?? ""))) : [];
  return [...entries].sort((first, second) => {
    const a = cells.get(first.id)!, b = cells.get(second.id)!;
    if (Boolean(a) !== Boolean(b)) return a ? -1 : 1;
    let compared = active && field?.type === "createdTime" && a && b
      ? (first.createdAt ?? 0) - (second.createdAt ?? 0)
      : active && field?.type === "status" && a && b
      ? statusOrder.findIndex(option=>option.id===first.propertyValues[field.id]) - statusOrder.findIndex(option=>option.id===second.propertyValues[field.id])
      : active && field?.type === "number" && a && b
      ? Number(first.propertyValues[field.id]) - Number(second.propertyValues[field.id])
      : compareText(a, b);
    if (active?.direction === "descending") compared *= -1;
    return compared || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  });
}
