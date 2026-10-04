import type { Status, Task } from "./model";

/** Update existing preview data only; never recreate a deleted task from stale UI. */
export function updateTaskStatus(
  tasks: readonly Task[],
  id: string,
  status: Status,
): Task[] {
  if (!tasks.some((task) => task.id === id))
    throw new Error(
      "This task no longer exists. Refresh the board before trying again.",
    );
  return tasks.map((task) => (task.id === id ? { ...task, status } : task));
}

type EditableTask = Pick<
  Task,
  "title" | "description" | "status" | "assigneeId" | "dueDate"
>;

/** Send user intent only, preserving unrelated changes made after the editor opened. */
export function taskEditPatch(
  before: Partial<Task>,
  after: EditableTask,
): Partial<EditableTask> {
  const baseline: EditableTask = {
    title: before.title ?? "",
    description: before.description ?? "",
    status: before.status ?? "todo",
    assigneeId: before.assigneeId ?? null,
    dueDate: before.dueDate ?? null,
  };
  return Object.fromEntries(
    Object.entries(after).filter(
      ([field, value]) => value !== baseline[field as keyof EditableTask],
    ),
  );
}
