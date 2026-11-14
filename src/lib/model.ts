// Teamspace Unified Data Model (MIT License)

export type BlockType =
  | "page"
  | "database"
  | "linked_database"
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bullet"
  | "ordered"
  | "todo"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "divider"
  | "synced_block"
  | "columns"
  | "column"
  | "image"
  | "file"
  | "attachment"
  | "audio"
  | "video"
  | "page_mention";

export type PropertyType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "person"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "relation"
  | "rollup"
  | "created_time"
  | "last_edited_time";

export type CalculationType =
  | "none"
  | "count_all"
  | "count_values"
  | "count_empty"
  | "percent_empty"
  | "percent_not_empty"
  | "sum"
  | "average"
  | "min"
  | "max";

export type SelectOption = {
  id: string;
  name: string;
  color?: string; // "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red"
  archived?: boolean;
  group?: "todo" | "doing" | "done";
};

export type DatabaseProperty = {
  id: string;
  name: string;
  type: PropertyType;
  position: string;
  isCore?: boolean;
  isDeleted?: boolean;
  options?: SelectOption[];
  targetDatabaseId?: string;
  rollup?: {
    relationPropertyId: string;
    targetPropertyId: string;
    calculate: CalculationType;
  };
};

export type ViewLayout = "table" | "board" | "list" | "calendar";

export type ViewFilterRule = {
  propertyId: string;
  operator:
    | "equals"
    | "does_not_equal"
    | "contains"
    | "does_not_contain"
    | "is_empty"
    | "is_not_empty"
    | "greater_than"
    | "less_than"
    | "before"
    | "after"
    | "is_today"
    | "is_overdue"
    | "next_7_days";
  value: unknown;
};

export type DatabaseView = {
  id: string;
  databaseId: string;
  name: string;
  layout: ViewLayout;
  filter?: {
    operator: "and" | "or";
    rules: ViewFilterRule[];
  };
  sorts?: {
    propertyId: string;
    direction: "asc" | "desc";
  }[];
  groupBy?: string; // Property ID for Board/Kanban columns
  visibleProperties?: string[]; // Array of property IDs in order
  calculations?: Record<string, CalculationType>;
  position: string;
};

export type DatabaseTemplate = {
  id: string;
  databaseId: string;
  name: string;
  icon?: string | null;
  defaultProperties: Record<string, unknown>; // Supports "$today" and "$this" dynamic tokens
  content?: {
    type?: string;
    content?: unknown[];
    [key: string]: unknown;
  } | null;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type SharePermission = "read" | "edit";

export type ShareLink = {
  token: string;
  blockId: string;
  workspaceId: string;
  permission: SharePermission;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Block = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  type: BlockType;
  title: string;
  icon?: string | null;
  coverUrl?: string | null;
  properties?: Record<string, unknown>; // Database row property values: { [propId]: value }
  content?: {
    type?: string;
    content?: unknown[];
    [key: string]: unknown;
  } | null; // ProseMirror/Tiptap document JSON
  text?: string; // Plain text fallback or index string
  position: string;
  isFavorite?: boolean;
  isFullWidth?: boolean;
  fontStyle?: "sans" | "serif" | "mono";
  isArchived?: boolean;
  deletedAt?: number;
  revision: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type Workspace = {
  id: string;
  name: string;
  icon?: string;
  ownerId: string;
};

export type MemberRole = "owner" | "admin" | "member";

export type Member = {
  id: string;
  displayName: string;
  role: MemberRole;
  email?: string;
  photoUrl?: string | null;
};

export type BlockSource = { noteId: string; blockId: string };

export type Comment = {
  id: string;
  blockId?: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  deleted: boolean;
};

export type PageVersion = {
  id: string;
  blockId?: string;
  sourceRevision: number;
  title: string;
  kind: "checkpoint" | "named" | "before_restore";
  name: string | null;
  capturedAt: number;
  capturedBy: string;
  capturedName: string;
  expiresAt: number | null;
  content: NoteContent;
};

export type Attachment = {
  id: string;
  parentId: string;
  parentType: "page" | "task" | "note";
  originalName: string;
  bytes: number;
  contentType: string;
  status?: "pending" | "ready" | "deleting";
};

// Legacy compatibility aliases for smooth transition during refactoring
export type Status = "todo" | "doing" | "done";
export type PropertyValue = string | string[] | number | boolean | null;
export type BoardProperty = {
  id: string;
  name: string;
  type: string;
  projectId?: string | null;
  options: SelectOption[];
  revision: number;
};
export type BoardView = {
  savedViewId?: string;
  name: string;
  query: string;
  status: "all" | Status;
  assignee: string;
  deadline: "all" | "overdue" | "today" | "week" | "undated";
  sort: "position" | "title" | "dueDate";
};
export type MediaBlockData = {
  attachmentId?: string;
  url?: string;
  originalName?: string;
  contentType?: string;
  bytes?: number;
  width?: number;
  caption?: string;
  durationSeconds?: number;
  transcript?: string;
  summary?: string;
  transcriptionStatus?: "idle" | "transcribing" | "completed" | "failed";
};
export type NoteBlock = {
  id?: string;
  type: string;
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  checked?: boolean;
  boardView?: BoardView;
  source?: BlockSource;
  media?: MediaBlockData;
};
export type NoteContent = { blocks: NoteBlock[] };
export type Note = {
  id: string;
  parentId: string | null;
  title: string;
  content: NoteContent;
  revision: number;
  metadataRevision?: number;
  collab?: { version: 1; generation: string; state: string; sequence: number };
};
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
  databaseRelations?: Record<string, string[]>;
  projectId?: string | null;
  priority?: "none" | "low" | "medium" | "high" | "urgent";
  estimate?: number | null;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  revision: number;
  databaseRelations?: Record<string, string[]>;
};
export type TaskTemplate = {
  id: string;
  name: string;
  revision: number;
  archived?: boolean;
  defaults: Pick<Task, "title" | "description" | "status" | "assigneeId" | "dueDate" | "propertyValues" | "projectId" | "priority" | "estimate"> & { content: NoteContent };
};
export type ConversationComment = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  deleted: boolean;
  mentions: { uid: string; displayName: string }[];
  blockId?: string;
};
export type PageVersionSummary = Omit<PageVersion, "content">;
