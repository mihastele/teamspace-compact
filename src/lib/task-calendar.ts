import type { Task } from "./model";

/** Date-only arithmetic deliberately avoids parsing a deadline in the viewer's timezone. */
function dateOf(day: string): Date {
  const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== day || day.startsWith("0000"))
    throw new Error("Invalid calendar date");
  return date;
}

function dateKey(date: Date): string {
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) throw new Error("Calendar boundary reached");
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day: string, amount: number): string {
  const date = dateOf(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

/** Preserve the day where possible; January 31 -> February's last day. */
export function shiftMonth(day: string, amount: number): string {
  const date = dateOf(day);
  const number = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(number, last.getUTCDate()));
  return dateKey(date);
}

export function calendarDays(month: string): { day: string; inMonth: boolean }[] {
  const first = dateOf(`${month}-01`);
  first.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + index);
    // Boundary cells outside the supported four-digit year are blank.
    const day = date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? "" : dateKey(date);
    return { day, inMonth: day.startsWith(`${month}-`) };
  });
}

export function calendarLabel(day: string, monthOnly = false): string {
  return new Intl.DateTimeFormat("en", monthOnly
    ? { month: "long", year: "numeric", timeZone: "UTC" }
    : { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }
  ).format(dateOf(day));
}

export function calendarLastDay(month: string): string {
  const date = dateOf(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return dateKey(date);
}

/** Each dated task occurs in exactly one agenda section, including completed history. */
export function calendarAgenda(dated: Map<string, Task[]>, month: string, today: string) {
  const overdue = [...dated].filter(([day]) => day < today)
    .map(([day, list]) => [day, list.filter((task) => task.status !== "done")] as const)
    .filter(([, list]) => list.length > 0);
  const scheduled = [...dated].filter(([day]) => day >= `${month}-01`)
    .map(([day, list]) => [day, list.filter((task) => day >= today || task.status === "done")] as const)
    .filter(([, list]) => list.length > 0);
  return { overdue, scheduled };
}

export function calendarTasks(tasks: readonly Task[], includeDone: boolean): {
  dated: Map<string, Task[]>; undated: Task[];
} {
  const dated = new Map<string, Task[]>();
  const undated: Task[] = [];
  const compare = (a: Task, b: Task) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const task of [...tasks].sort(compare)) {
    if (!includeDone && task.status === "done") continue;
    let valid = false;
    if (task.dueDate) {
      try { dateOf(task.dueDate); valid = true; } catch { /* Keep malformed legacy dates discoverable. */ }
    }
    if (!valid) undated.push(task);
    else {
      const day = task.dueDate!;
      const list = dated.get(day) || [];
      list.push(task);
      dated.set(day, list);
    }
  }
  return { dated: new Map([...dated].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), undated };
}
