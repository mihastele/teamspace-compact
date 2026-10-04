export type Status = "todo" | "doing" | "done";
export type Task = {
  id: string;
  title: string;
  description: string;
  status: Status;
  assigneeId: string | null;
  dueDate: string | null;
  position: number;
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
    | "board";
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  checked?: boolean;
};
export type NoteContent = { blocks: NoteBlock[] };
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
