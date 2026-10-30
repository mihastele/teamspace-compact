import type { Task } from "./model";
import { taskInput, taskMutationInput } from "./server/validation";

export type TaskSavePacket = Partial<Task> & { operationId: string; expectedRevision?: number };
export type TaskDraftRecord = { version: 1; baseline: Partial<Task>; draft: Partial<Task>; packet: TaskSavePacket | null };

export function taskDraftBaseline(task: Partial<Task>): Partial<Task> {
  const keys = ["id", "revision", "title", "description", "content", "status", "assigneeId", "dueDate", "propertyValues", "databaseRelations", "projectId", "priority", "estimate"] as const;
  return Object.fromEntries(keys.filter(key => task[key] !== undefined).map(key => [key, task[key]]));
}

/** Validate device storage before it can become an editable draft or retry. */
export function decodeTaskDraft(raw: string, taskId?: string): TaskDraftRecord {
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.baseline?.id !== taskId || typeof value.draft?.title !== "string" || value.draft.title.length > 200)
    throw new Error("This saved task draft cannot be opened. Download its raw recovery data before discarding it.");
  taskInput({ ...value.draft, title: value.draft.title.trim() || "Unsaved task" }, true);
  const { id, revision, ...baseline } = value.baseline;
  if (id !== undefined && id !== taskId) throw new Error("Invalid task draft scope.");
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new Error("Invalid task draft revision.");
  if (Object.keys(baseline).length) taskInput(baseline, true);
  if (value.packet !== null) {
    const { id: packetId, ...packet } = value.packet;
    if (packetId !== taskId || !packet.operationId) throw new Error("Invalid task retry scope.");
    taskMutationInput(packet, Boolean(taskId));
  }
  return value;
}
