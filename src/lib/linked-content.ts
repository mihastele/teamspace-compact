import type { BlockSource, BoardView, Note, NoteBlock, NoteContent, Task } from "./model";
import { matchesDeadline } from "./task-deadlines";

export const defaultBoardView: BoardView = {
  name: "Workspace board", query: "", status: "all", assignee: "all", deadline: "all", sort: "position",
};
export const linkableTypes = new Set<NoteBlock["type"]>(["paragraph", "heading", "bullet", "ordered", "quote", "todo", "code", "markdown"]);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid linked-content settings.");
  return value as Record<string, unknown>;
}
function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/\u0000/.test(value);
}
export function validateBoardView(value: unknown): BoardView {
  const data = record(value);
  if (Object.keys(data).some(key => !Object.keys(defaultBoardView).includes(key)) ||
      !boundedText(data.name, 80) || !data.name.trim() || !boundedText(data.query, 200) ||
      typeof data.status !== "string" || !["all", "todo", "doing", "done"].includes(data.status) ||
      !boundedText(data.assignee, 128) || !/^[a-zA-Z0-9_-]+$/.test(data.assignee) ||
      typeof data.deadline !== "string" || !["all", "overdue", "today", "week", "undated"].includes(data.deadline) ||
      typeof data.sort !== "string" || !["position", "title", "dueDate"].includes(data.sort)) throw new Error("Invalid linked board view.");
  return { name: data.name, query: data.query, status: data.status as BoardView["status"], assignee: data.assignee, deadline: data.deadline as BoardView["deadline"], sort: data.sort as BoardView["sort"] };
}
export function validateBlockSource(value: unknown): BlockSource {
  const data = record(value);
  if (Object.keys(data).some(key => !["noteId", "blockId"].includes(key)) ||
      !boundedText(data.noteId, 128) || !/^[a-zA-Z0-9_-]+$/.test(data.noteId) ||
      typeof data.blockId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.blockId))
    throw new Error("Invalid synced block source. Links must stay in this workspace.");
  return { noteId: data.noteId, blockId: data.blockId };
}
export function linkedBoardTasks(tasks: readonly Task[], view: BoardView, uid: string | undefined, today: string): Task[] {
  const query = view.query.trim().toLowerCase();
  const assignee = view.assignee === "me" ? uid : view.assignee;
  return tasks.filter(task =>
    (!query || `${task.title} ${task.description}`.toLowerCase().includes(query)) &&
    (view.status === "all" || task.status === view.status) &&
    (view.assignee === "all" || (view.assignee === "unassigned" ? task.assigneeId === null : Boolean(assignee) && task.assigneeId === assignee)) &&
    matchesDeadline(task, view.deadline, today)
  ).sort((a,b) => {
    const primary = view.sort === "title" ? a.title.localeCompare(b.title) : view.sort === "dueDate" ? (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99") : a.position - b.position;
    return primary || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
export function linkedSourceIds(content: NoteContent): string[] {
  return [...new Set(content.blocks.filter(block => block.type === "synced" && block.source).map(block => block.source!.noteId))];
}
export function validateLinkedContentLimits(content: NoteContent): void {
  if (content.blocks.filter(block => block.type === "synced").length > 100 || linkedSourceIds(content).length > 20)
    throw new Error("A page supports up to 100 synced references from 20 source notes.");
}
export function sourceBlock(content: NoteContent | null | undefined, source: BlockSource): NoteBlock | undefined {
  return content?.blocks.find(block => block.id === source.blockId && linkableTypes.has(block.type));
}
/** Generate intent against the captured full source document, preserving every other block. */
export function editLinkedSource(base: NoteContent, source: BlockSource, patch: { text?: string; checked?: boolean }): NoteContent {
  const block = sourceBlock(base, source);
  if (!block) throw new Error("The original block is unavailable. Keep your text before reloading.");
  if (patch.checked !== undefined && block.type !== "todo") throw new Error("Only a task-list block has a checkbox.");
  return { blocks: base.blocks.map(item => item.id === source.blockId ? { ...item, ...patch } : item) };
}
/** Preview self-links preserve other draft edits and reject a stale source block. */
export function mergePreviewLinkedEdit(current: NoteContent, base: NoteContent, next: NoteContent, source: BlockSource): NoteContent {
  const before = sourceBlock(base, source), latest = sourceBlock(current, source), intended = sourceBlock(next, source);
  if (!before || !latest || !intended || before.text !== latest.text || before.checked !== latest.checked || before.type !== latest.type)
    throw new Error("The original block changed. Your linked draft is preserved for recovery.");
  return editLinkedSource(current, source, { text: intended.text, ...(intended.type === "todo" ? { checked: intended.checked } : {}) });
}
/** Detaching keeps the destination identity; subsequent edits cannot change the source. */
export function detachLinkedBlock(reference: NoteBlock, source: NoteBlock): NoteBlock {
  if (reference.type !== "synced" || !linkableTypes.has(source.type)) throw new Error("The original block is unavailable.");
  return { ...(reference.id ? { id: reference.id } : {}), type: source.type, text: source.text,
    ...(source.level !== undefined ? { level: source.level } : {}), ...(source.checked !== undefined ? { checked: source.checked } : {}) };
}
export function savedSourceOptions(notes: readonly Note[]) {
  return notes.flatMap(note => note.content.blocks.filter(block => block.id && linkableTypes.has(block.type)).map(block => ({ noteId: note.id, blockId: block.id!, title: note.title, text: block.text, type: block.type })));
}
