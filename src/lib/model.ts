export type Status = "todo" | "doing" | "done";
export type BoardProperty = {
  id: string;
  name: string;
  type: "text" | "longText" | "number" | "date" | "checkbox" | "select" | "multiSelect" | "person" | "relation" | "url" | "email" | "phone";
  projectId?: string | null;
  options: { id: string; name: string; color?: string; archived?: boolean }[];
  revision: number;
};
export type PropertyValue = string | string[] | number | boolean | null;
export type Project = { id: string; name: string; description: string; archived: boolean; revision: number };
export type BoardView = {
  savedViewId?: string;
  name: string;
  query: string;
  status: "all" | Status;
  assignee: string;
  deadline: "all" | "overdue" | "today" | "week" | "undated";
  sort: "position" | "title" | "dueDate";
};
export type BlockSource = { noteId: string; blockId: string };
export type Task = {
  id: string;
  revision?: number;
  title: string;
  description: string;
  content?: NoteContent;
  status: Status;
  assigneeId: string | null;
  dueDate: string | null;
  position: number;
  propertyValues?: Record<string, PropertyValue>;
  projectId?: string | null;
  priority?: "none" | "low" | "medium" | "high" | "urgent";
  estimate?: number | null;
};
export type NoteBlock = {
  id?: string;
  type:
    | "paragraph"
    | "heading"
    | "bullet"
    | "ordered"
    | "quote"
    | "todo"
    | "code"
    | "divider"
    | "markdown"
    | "board"
    | "synced";
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  checked?: boolean;
  boardView?: BoardView;
  source?: BlockSource;
};
export type NoteContent = { blocks: NoteBlock[] };
export type TaskTemplate = {
  id: string;
  name: string;
  revision: number;
  archived?: boolean;
  defaults: Pick<Task, "title" | "description" | "status" | "assigneeId" | "dueDate" | "propertyValues" | "projectId" | "priority" | "estimate"> & { content: NoteContent };
};
export type Note = {
  id: string;
  parentId: string | null;
  title: string;
  content: NoteContent;
  revision: number;
  metadataRevision?: number;
  collab?: {
    version: 1;
    generation: string;
    state: string;
    sequence: number;
  };
};
export type PageVersionSummary = {
  id: string;
  sourceRevision: number;
  title: string;
  kind: "checkpoint" | "named" | "before_restore";
  name: string | null;
  capturedAt: number;
  capturedBy: string;
  capturedName: string;
  expiresAt: number | null;
};
export type PageVersion = PageVersionSummary & { content: NoteContent };
export type ConversationComment = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  deleted: boolean;
  mentions: { uid: string; displayName: string }[];
};
export type Member = {
  id: string;
  displayName: string;
  role: "owner" | "admin" | "member";
};
export type Workspace = { id: string; name: string; ownerId: string };
export type Attachment = {
  id: string;
  parentType: "task" | "note";
  parentId: string;
  originalName: string;
  bytes: number;
  contentType: string;
  status?: "pending" | "ready" | "deleting";
};
