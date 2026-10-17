import type { BoardProperty, Member, Project, Task } from "./model";
import { propertyDisplay } from "./board-properties";

export type TaskColumn = { id: string; label: string };
export type TableSort = { column: string; direction: "ascending" | "descending" };
export const statusLabels = { todo: "To do", doing: "In progress", done: "Done" };
export function taskColumns(properties: readonly BoardProperty[], extended = false, projects: readonly Project[] = []): TaskColumn[] {
  return [
    { id: "title", label: "Task" }, { id: "status", label: "Status" },
    { id: "assignee", label: "Assignee" }, { id: "dueDate", label: "Due date" },
    ...(extended ? [{id:"project",label:"Project"},{id:"priority",label:"Priority"},{id:"estimate",label:"Estimate"}] : []),
    ...properties.map(property => ({ id: `property:${property.id}`, label: property.projectId ? `${property.name} (${projects.find(project=>project.id===property.projectId)?.name??"Project"})` : property.name })),
  ];
}
export function taskCell(task: Task, column: string, properties: readonly BoardProperty[], members: readonly Member[], projects: readonly Project[] = []): string {
  switch (column) {
    case "title": return task.title;
    case "status": return statusLabels[task.status];
    case "assignee": return task.assigneeId ? members.find(member => member.id === task.assigneeId)?.displayName || "Unavailable member" : "";
    case "project": return projects.find(project=>project.id===task.projectId)?.name ?? "";
    case "priority": return task.priority ?? "none";
    case "estimate": return task.estimate == null ? "" : String(task.estimate);
    case "dueDate": return task.dueDate ?? "";
    default: {
      const property = properties.find(property => `property:${property.id}` === column);
      return property ? propertyDisplay(property, task.propertyValues?.[property.id], [...members], [...projects]) : "";
    }
  }
}
/** Empty values stay last in either direction; stable ID ties never reorder shared data. */
export function sortTableTasks(tasks: readonly Task[], sort: TableSort | null, properties: readonly BoardProperty[], members: readonly Member[], projects: readonly Project[] = []): Task[] {
  const active = sort && taskColumns(properties, true).some(column => column.id === sort.column) ? sort : null;
  const order = { todo: 0, doing: 1, done: 2 };
  const cells = new Map(tasks.map(task => [task.id, active ? taskCell(task, active.column, properties, members, projects) : ""]));
  return [...tasks].sort((a, b) => {
    let compared = a.position - b.position;
    if (active) {
      const first = cells.get(a.id)!, second = cells.get(b.id)!;
      if (!first || !second) {
        if (Boolean(first) !== Boolean(second)) return first ? -1 : 1;
        compared = 0;
      } else {
        const property = properties.find(property=>`property:${property.id}`===active.column);
        const priorityOrder = {none:0,low:1,medium:2,high:3,urgent:4};
        compared = active.column === "status" ? order[a.status] - order[b.status] :
          active.column === "priority" ? priorityOrder[a.priority??"none"]-priorityOrder[b.priority??"none"] :
          active.column === "estimate" ? a.estimate!-b.estimate! :
          property?.type === "number" ? Number(a.propertyValues?.[property.id])-Number(b.propertyValues?.[property.id]) :
          first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });
        if (active.direction === "descending") compared *= -1;
      }
    }
    return compared || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
