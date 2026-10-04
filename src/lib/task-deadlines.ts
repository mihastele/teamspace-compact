import type { Task } from "./model";

export type DeadlineFilter = "all" | "overdue" | "today" | "week" | "undated";

/** Calendar dates follow the viewer's local day, never UTC or locale formatting. */
export function localCalendarDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function deadlineState(
  task: Task,
  today: string,
): "overdue" | "today" | "scheduled" | "none" {
  if (!task.dueDate) return "none";
  if (task.status === "done" || !today) return "scheduled";
  if (task.dueDate < today) return "overdue";
  return task.dueDate === today ? "today" : "scheduled";
}

export function matchesDeadline(
  task: Task,
  filter: DeadlineFilter,
  today: string,
): boolean {
  if (filter === "all") return true;
  if (task.status === "done") return false;
  if (filter === "undated") return !task.dueDate;
  if (!today || !task.dueDate) return false;
  if (filter === "overdue") return task.dueDate < today;
  if (filter === "today") return task.dueDate === today;
  // Calendar arithmetic at noon avoids treating DST days as exactly 24 hours.
  const end = new Date(`${today}T12:00:00`);
  end.setDate(end.getDate() + 6);
  return task.dueDate >= today && task.dueDate <= localCalendarDay(end);
}
