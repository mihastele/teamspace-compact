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
export type NoteContent = {
  blocks: { type: "paragraph" | "heading" | "bullet"; text: string }[];
};
export type Note = {
  id: string;
  title: string;
  content: NoteContent;
  revision: number;
};
export type Member = {
  id: string;
  displayName: string;
  role: "owner" | "member";
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
