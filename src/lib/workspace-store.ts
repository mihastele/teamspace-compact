import { useSyncExternalStore } from "react";
import type {
  Block,
  DatabaseProperty,
  DatabaseTemplate,
  DatabaseView,
  ShareLink,
  SharePermission,
  Workspace,
} from "./model";
import { createDefaultWorkspace, generateSeedData } from "./seed-workspace";

export type WorkspaceState = {
  workspace: Workspace;
  blocks: Record<string, Block>;
  childrenIndex: Record<string, string[]>; // parentId (or 'root') -> blockIds in order
  properties: Record<string, DatabaseProperty[]>; // databaseId -> properties
  views: Record<string, DatabaseView[]>; // databaseId -> views
  templates: Record<string, DatabaseTemplate[]>; // databaseId -> page templates
  shareLinks: Record<string, ShareLink>; // token -> share link
  activeBlockId: string | null;
  sidePeekBlockId: string | null;
  activeViewIdByDatabase: Record<string, string>; // databaseId -> viewId
  searchQuery: string;
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
};

export const CORE_PROPERTY_DEFINITIONS: Record<string, Omit<DatabaseProperty, "position">> = {
  "prop-status": {
    id: "prop-status",
    name: "Status",
    type: "status",
    isCore: true,
    options: [
      { id: "opt-todo", name: "To Do", color: "gray", group: "todo" },
      { id: "opt-progress", name: "In Progress", color: "blue", group: "doing" },
      { id: "opt-done", name: "Done", color: "green", group: "done" },
    ],
  },
  "prop-priority": {
    id: "prop-priority",
    name: "Priority",
    type: "select",
    isCore: true,
    options: [
      { id: "prio-urgent", name: "Urgent", color: "red" },
      { id: "prio-high", name: "High", color: "orange" },
      { id: "prio-medium", name: "Medium", color: "yellow" },
      { id: "prio-low", name: "Low", color: "default" },
    ],
  },
  "prop-due": {
    id: "prop-due",
    name: "Due Date",
    type: "date",
    isCore: true,
  },
};

const STORAGE_KEY = "teamspace_workspace_state_v1";
// Pre-rebrand key; read once so existing local edits are not lost.
const LEGACY_STORAGE_KEY = "opennotion_workspace_state_v1";
const OUTBOX_STORAGE_KEY = "teamspace_sync_outbox_v1";
const TOMBSTONES_STORAGE_KEY = "teamspace_sync_tombstones_v1";
const SYNC_CHANNEL_NAME = "teamspace_workspace_sync";

export type ServerSyncAdapter = {
  workspaceId: string;
  fetchBlocks: () => Promise<Block[]>;
  syncBlocks: (blocks: Block[], tombstones?: Record<string, number>) => Promise<Block[]>;
  deleteBlock: (blockId: string) => Promise<void>;
};

let currentAdapter: ServerSyncAdapter | null = null;
let isFirstSync = true;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function loadOutbox(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveOutbox(outbox: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(Array.from(outbox)));
  } catch {}
}

function loadTombstones(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TOMBSTONES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveTombstones(records: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOMBSTONES_STORAGE_KEY, JSON.stringify(records));
  } catch {}
}

const syncOutbox: Set<string> = loadOutbox();
const tombstones: Record<string, number> = loadTombstones();

let syncChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  try {
    syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    syncChannel.onmessage = (event) => {
      if (event.data?.type === "workspace_reload") {
        const stored = readStoredState();
        if (stored) {
          const parsed = stored.state as Partial<WorkspaceState>;
          if (parsed.workspace && parsed.blocks) {
            currentState = {
              ...currentState,
              ...parsed,
            };
            for (const listener of listeners) {
              listener();
            }
          }
        }
      }
    };
  } catch {}
}

function broadcastLocalChange() {
  if (syncChannel) {
    try {
      syncChannel.postMessage({ type: "workspace_reload" });
    } catch {}
  }
}

let activeSyncPromise: Promise<void> | null = null;

function scheduleSync(delayMs = 250) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void workspaceStore.flushSync();
  }, delayMs);
  if (syncTimer && typeof (syncTimer as unknown as { unref?: () => void }).unref === "function") {
    (syncTimer as unknown as { unref: () => void }).unref();
  }
}

function markDirty(blockId: string) {
  syncOutbox.add(blockId);
  saveOutbox(syncOutbox);
  broadcastLocalChange();
  scheduleSync(250);
}

function recordTombstone(blockId: string, timestamp = Date.now()) {
  tombstones[blockId] = Math.max(tombstones[blockId] || 0, timestamp);
  saveTombstones(tombstones);
  syncOutbox.add(blockId);
  saveOutbox(syncOutbox);
  broadcastLocalChange();
  scheduleSync(0);
}

function unpackDatabaseBlock(
  dbBlock: Block,
  targetProperties: Record<string, DatabaseProperty[]>,
  targetViews: Record<string, DatabaseView[]>,
  targetTemplates: Record<string, DatabaseTemplate[]>
) {
  const customProps = dbBlock.properties?.databaseProperties as DatabaseProperty[] | undefined;
  if (Array.isArray(customProps)) {
    targetProperties[dbBlock.id] = customProps;
  }
  const customViews = dbBlock.properties?.databaseViews as DatabaseView[] | undefined;
  if (Array.isArray(customViews)) {
    targetViews[dbBlock.id] = customViews;
    if (!currentState.activeViewIdByDatabase[dbBlock.id] && customViews[0]) {
      currentState.activeViewIdByDatabase[dbBlock.id] = customViews[0].id;
    }
  }
  const customTemplates = dbBlock.properties?.databaseTemplates as DatabaseTemplate[] | undefined;
  if (Array.isArray(customTemplates)) {
    targetTemplates[dbBlock.id] = customTemplates;
  }
}

function packDatabaseBlock(databaseId: string) {
  const db = currentState.blocks[databaseId];
  if (!db || db.type !== "database") return;
  const now = Date.now();
  currentState = {
    ...currentState,
    blocks: {
      ...currentState.blocks,
      [databaseId]: {
        ...db,
        updatedAt: now,
        revision: (db.revision || 1) + 1,
        properties: {
          ...(db.properties || {}),
          databaseProperties: currentState.properties[databaseId] || [],
          databaseViews: currentState.views[databaseId] || [],
          databaseTemplates: currentState.templates?.[databaseId] || [],
        },
      },
    },
  };
  markDirty(databaseId);
}

function reconcileWithServerBlocks(serverBlocks: Block[]) {
  const nextBlocks = { ...currentState.blocks };
  const nextProps = { ...currentState.properties };
  const nextViews = { ...currentState.views };
  const nextTemplates = { ...(currentState.templates || {}) };
  let stateChanged = false;

  for (const sb of serverBlocks) {
    const isDeleted = Boolean(sb.isArchived || typeof sb.deletedAt === "number");
    const localTombstone = tombstones[sb.id];
    const localBlock = nextBlocks[sb.id];

    if (isDeleted) {
      const serverDelTime = typeof sb.deletedAt === "number" ? sb.deletedAt : (sb.updatedAt || 0);
      if (localBlock && (localBlock.updatedAt || 0) > serverDelTime) {
        // Local edit occurred after server deletion: local edit wins
        syncOutbox.add(sb.id);
        continue;
      }
      // Server deletion wins
      tombstones[sb.id] = Math.max(tombstones[sb.id] || 0, serverDelTime);
      if (localBlock) {
        delete nextBlocks[sb.id];
        syncOutbox.delete(sb.id);
        stateChanged = true;
      }
      continue;
    }

    // Server block is active
    if (localTombstone && localTombstone >= (sb.updatedAt || 0)) {
      // Local deletion wins over older server block
      syncOutbox.add(sb.id);
      if (localBlock) {
        delete nextBlocks[sb.id];
        stateChanged = true;
      }
      continue;
    }

    if (!localBlock) {
      nextBlocks[sb.id] = sb;
      syncOutbox.delete(sb.id);
      stateChanged = true;
      if (sb.type === "database") {
        unpackDatabaseBlock(sb, nextProps, nextViews, nextTemplates);
      }
    } else {
      const serverTime = (sb.updatedAt || 0) as number;
      const localTime = (localBlock.updatedAt || 0) as number;

      if (serverTime > localTime) {
        // Server block is newer
        nextBlocks[sb.id] = sb;
        syncOutbox.delete(sb.id);
        stateChanged = true;
        if (sb.type === "database") {
          unpackDatabaseBlock(sb, nextProps, nextViews, nextTemplates);
        }
      } else if (localTime > serverTime) {
        // Local block is newer: keep local block and keep in outbox to push
        syncOutbox.add(sb.id);
      } else {
        if ((sb.revision || 0) >= (localBlock.revision || 0)) {
          nextBlocks[sb.id] = sb;
          syncOutbox.delete(sb.id);
          stateChanged = true;
          if (sb.type === "database") {
            unpackDatabaseBlock(sb, nextProps, nextViews, nextTemplates);
          }
        }
      }
    }
  }

  if (stateChanged) {
    const nextChildren: Record<string, string[]> = { root: [] };
    for (const b of Object.values(nextBlocks)) {
      if (b.isArchived) continue;
      const parentKey = b.parentId || "root";
      if (!nextChildren[parentKey]) nextChildren[parentKey] = [];
      if (!nextChildren[parentKey].includes(b.id)) {
        nextChildren[parentKey].push(b.id);
      }
    }

    let nextActive = currentState.activeBlockId;
    if (nextActive && !nextBlocks[nextActive]) {
      const rootIds = nextChildren["root"] || [];
      nextActive = rootIds[0] || null;
    }

    currentState = {
      ...currentState,
      blocks: nextBlocks,
      childrenIndex: nextChildren,
      properties: nextProps,
      views: nextViews,
      templates: nextTemplates,
      activeBlockId: nextActive,
    };
    saveOutbox(syncOutbox);
    saveTombstones(tombstones);
    emitChange();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    scheduleSync(0);
  });
  window.addEventListener("focus", () => {
    scheduleSync(0);
  });
}

function readStoredState(): { state: unknown; legacy: boolean } | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { state: JSON.parse(stored), legacy: false };
    const legacyStored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyStored) return { state: JSON.parse(legacyStored), legacy: true };
  } catch {
    // Fallback to fresh seed
  }
  return null;
}

function buildInitialState(): WorkspaceState {
  const stored = readStoredState();
  if (stored) {
    const parsed = stored.state as { workspace?: unknown; blocks?: unknown };
    if (parsed.workspace && parsed.blocks) {
      if (stored.legacy && typeof window !== "undefined") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // Keep the legacy key if the migration cannot be persisted.
        }
      }
      const ws = parsed as Partial<WorkspaceState>;
      return {
        ...(ws as WorkspaceState),
        templates: ws.templates || {},
        shareLinks: ws.shareLinks || {},
      };
    }
  }

  const workspace = createDefaultWorkspace();
  const seed = generateSeedData(workspace.id);

  const blocks: Record<string, Block> = {};
  const childrenIndex: Record<string, string[]> = { root: [] };
  const properties: Record<string, DatabaseProperty[]> = {};
  const views: Record<string, DatabaseView[]> = {};

  for (const block of seed.blocks) {
    blocks[block.id] = block;
    const parentKey = block.parentId || "root";
    if (!childrenIndex[parentKey]) {
      childrenIndex[parentKey] = [];
    }
    childrenIndex[parentKey].push(block.id);
  }

  for (const prop of seed.properties) {
    const dbId = "database-tasks";
    if (!properties[dbId]) properties[dbId] = [];
    properties[dbId].push(prop);
  }

  const activeViewIdByDatabase: Record<string, string> = {};
  for (const view of seed.views) {
    if (!views[view.databaseId]) views[view.databaseId] = [];
    views[view.databaseId].push(view);
    if (!activeViewIdByDatabase[view.databaseId]) {
      activeViewIdByDatabase[view.databaseId] = view.id;
    }
  }

  return {
    workspace,
    blocks,
    childrenIndex,
    properties,
    views,
    templates: {},
    shareLinks: {},
    activeBlockId: "page-getting-started",
    sidePeekBlockId: null,
    activeViewIdByDatabase,
    searchQuery: "",
    theme: "light",
    sidebarCollapsed: false,
  };
}

let currentState: WorkspaceState = buildInitialState();
const listeners = new Set<() => void>();

function emitChange() {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState));
    } catch {
      // ignore storage quota errors
    }
  }
  for (const listener of listeners) {
    listener();
  }
}

function syncShareLinkAsync(link: ShareLink, block?: Block) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  const targetBlock = block || currentState.blocks[link.blockId];
  void fetch(`/api/share/${encodeURIComponent(link.token)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: link.workspaceId,
      blockId: link.blockId,
      permission: link.permission,
      enabled: link.enabled,
      document: targetBlock
        ? {
            title: targetBlock.title,
            icon: targetBlock.icon,
            coverUrl: targetBlock.coverUrl,
            content: targetBlock.content,
            revision: targetBlock.revision,
            createdAt: targetBlock.createdAt,
            updatedAt: targetBlock.updatedAt,
          }
        : {},
    }),
  }).catch(() => {});
}

function revokeShareLinkAsync(token: string) {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  void fetch(`/api/share/${encodeURIComponent(token)}`, {
    method: "DELETE",
  }).catch(() => {});
}

export const workspaceStore = {
  getState(): WorkspaceState {
    return currentState;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  setActiveBlock(blockId: string | null) {
    currentState = {
      ...currentState,
      activeBlockId: blockId,
    };
    emitChange();
  },

  setSidePeekBlock(blockId: string | null) {
    currentState = {
      ...currentState,
      sidePeekBlockId: blockId,
    };
    emitChange();
  },

  setActiveView(databaseId: string, viewId: string) {
    currentState = {
      ...currentState,
      activeViewIdByDatabase: {
        ...currentState.activeViewIdByDatabase,
        [databaseId]: viewId,
      },
    };
    emitChange();
  },

  toggleTheme() {
    const nextTheme = currentState.theme === "light" ? "dark" : "light";
    currentState = {
      ...currentState,
      theme: nextTheme,
    };
    emitChange();
  },

  setSidebarCollapsed(collapsed: boolean) {
    currentState = {
      ...currentState,
      sidebarCollapsed: collapsed,
    };
    emitChange();
  },

  setSearchQuery(query: string) {
    currentState = {
      ...currentState,
      searchQuery: query,
    };
    emitChange();
  },

  // Block Mutations
  createPage(parentId: string | null = null, title: string = "Untitled"): Block {
    const now = Date.now();
    const id = `page-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const newPage: Block = {
      id,
      workspaceId: currentState.workspace.id,
      parentId,
      type: "page",
      title,
      icon: "📄",
      position: `z${now}`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
    };

    const parentKey = parentId || "root";
    const existingChildren = currentState.childrenIndex[parentKey] || [];

    currentState = {
      ...currentState,
      blocks: {
        ...currentState.blocks,
        [id]: newPage,
      },
      childrenIndex: {
        ...currentState.childrenIndex,
        [parentKey]: [...existingChildren, id],
      },
      activeBlockId: id,
    };

    emitChange();
    markDirty(id);
    return newPage;
  },

  createDatabase(parentId: string | null = null, title: string = "Untitled Database"): Block {
    const now = Date.now();
    const id = `database-${now}-${Math.random().toString(36).slice(2, 7)}`;

    const defaultProps: DatabaseProperty[] = [
      { id: "prop-title", name: "Name", type: "title", position: "a0" },
      {
        id: "prop-status",
        name: "Status",
        type: "status",
        position: "a1",
        options: [
          { id: "opt-todo", name: "Not started", color: "default", group: "todo" },
          { id: "opt-progress", name: "In progress", color: "blue", group: "doing" },
          { id: "opt-done", name: "Done", color: "green", group: "done" },
        ],
      },
    ];

    const defaultViews: DatabaseView[] = [
      {
        id: `view-table-${now}`,
        databaseId: id,
        name: "Table",
        layout: "table",
        position: "a0",
        visibleProperties: ["prop-title", "prop-status"],
      },
      {
        id: `view-board-${now}`,
        databaseId: id,
        name: "Board",
        layout: "board",
        groupBy: "prop-status",
        position: "a1",
        visibleProperties: ["prop-title"],
      },
    ];

    const newDb: Block = {
      id,
      workspaceId: currentState.workspace.id,
      parentId,
      type: "database",
      title,
      icon: "🗂️",
      position: `z${now}`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      properties: {
        databaseProperties: defaultProps,
        databaseViews: defaultViews,
        databaseTemplates: [],
      },
    };

    const parentKey = parentId || "root";
    const existingChildren = currentState.childrenIndex[parentKey] || [];

    currentState = {
      ...currentState,
      blocks: {
        ...currentState.blocks,
        [id]: newDb,
      },
      childrenIndex: {
        ...currentState.childrenIndex,
        [parentKey]: [...existingChildren, id],
      },
      properties: {
        ...currentState.properties,
        [id]: defaultProps,
      },
      views: {
        ...currentState.views,
        [id]: defaultViews,
      },
      activeViewIdByDatabase: {
        ...currentState.activeViewIdByDatabase,
        [id]: defaultViews[0].id,
      },
      activeBlockId: id,
    };

    emitChange();
    markDirty(id);
    return newDb;
  },

  updateBlock(id: string, updates: Partial<Block>) {
    const existing = currentState.blocks[id];
    if (!existing) return;

    const mergedProperties = updates.properties
      ? { ...(existing.properties || {}), ...updates.properties }
      : existing.properties ? { ...existing.properties } : undefined;

    if (updates.title !== undefined && mergedProperties && "prop-title" in mergedProperties) {
      mergedProperties["prop-title"] = updates.title;
    }

    currentState = {
      ...currentState,
      blocks: {
        ...currentState.blocks,
        [id]: {
          ...existing,
          ...updates,
          properties: mergedProperties,
          updatedAt: Date.now(),
          revision: existing.revision + 1,
        },
      },
    };
    emitChange();
    markDirty(id);

    const matchingLink = Object.values(currentState.shareLinks || {}).find(
      (l) => l.blockId === id && l.enabled
    );
    if (matchingLink) {
      syncShareLinkAsync(matchingLink, currentState.blocks[id]);
    }
  },

  toggleFavorite(id: string) {
    const block = currentState.blocks[id];
    if (block) {
      workspaceStore.updateBlock(id, { isFavorite: !block.isFavorite });
    }
  },

  archiveBlock(id: string) {
    const block = currentState.blocks[id];
    if (block) {
      recordTombstone(id);
      const nextBlocks = { ...currentState.blocks };
      delete nextBlocks[id];

      const parentKey = block.parentId || "root";
      const existingChildren = currentState.childrenIndex[parentKey] || [];
      const nextChildren = {
        ...currentState.childrenIndex,
        [parentKey]: existingChildren.filter((bid) => bid !== id),
      };

      let nextActive = currentState.activeBlockId;
      if (nextActive === id) {
        const rootIds = nextChildren["root"] || [];
        const nextId = rootIds.find((bid) => bid !== id && !nextBlocks[bid]?.isArchived);
        nextActive = nextId || null;
      }

      currentState = {
        ...currentState,
        blocks: nextBlocks,
        childrenIndex: nextChildren,
        activeBlockId: nextActive,
        sidePeekBlockId: currentState.sidePeekBlockId === id ? null : currentState.sidePeekBlockId,
      };
      emitChange();
    }
  },

  restoreBlock(id: string) {
    delete tombstones[id];
    saveTombstones(tombstones);
    workspaceStore.updateBlock(id, { isArchived: false });
  },

  duplicateBlock(id: string): Block | null {
    const original = currentState.blocks[id];
    if (!original) return null;

    const now = Date.now();
    const newId = `${original.type}-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const duplicate: Block = {
      ...original,
      id: newId,
      title: `${original.title || "Untitled"} (Copy)`,
      properties: original.properties ? { ...original.properties, "prop-title": `${original.title || "Untitled"} (Copy)` } : undefined,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      isFavorite: false,
    };

    const parentKey = original.parentId || "root";
    const existingChildren = currentState.childrenIndex[parentKey] || [];
    const originalIndex = existingChildren.indexOf(id);
    const nextChildren = [...existingChildren];
    if (originalIndex >= 0) {
      nextChildren.splice(originalIndex + 1, 0, newId);
    } else {
      nextChildren.push(newId);
    }

    currentState = {
      ...currentState,
      blocks: {
        ...currentState.blocks,
        [newId]: duplicate,
      },
      childrenIndex: {
        ...currentState.childrenIndex,
        [parentKey]: nextChildren,
      },
    };

    emitChange();
    markDirty(newId);
    return duplicate;
  },

  // Database Rows
  createDatabaseRow(
    databaseId: string,
    title?: string,
    initialProperties: Record<string, unknown> = {},
    templateId?: string | null
  ): Block {
    const now = Date.now();
    const id = `row-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const todayStr = new Date().toISOString().slice(0, 10);

    const dbTemplates = currentState.templates?.[databaseId] || [];
    const selectedTemplate =
      templateId === null
        ? undefined
        : templateId
          ? dbTemplates.find((t) => t.id === templateId)
          : dbTemplates.find((t) => t.isDefault);

    const resolveDynamicValue = (val: unknown): unknown => {
      if (val === "$today") return todayStr;
      if (val === "$this") return id;
      if (Array.isArray(val)) return val.map(resolveDynamicValue);
      if (val && typeof val === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          out[k] = resolveDynamicValue(v);
        }
        return out;
      }
      return val;
    };

    const resolvedTemplateProps: Record<string, unknown> = {};
    if (selectedTemplate?.defaultProperties) {
      for (const [k, v] of Object.entries(selectedTemplate.defaultProperties)) {
        resolvedTemplateProps[k] = resolveDynamicValue(v);
      }
    }

    const finalTitle =
      title !== undefined
        ? title
        : selectedTemplate?.name
          ? selectedTemplate.name
          : "New entry";

    // Resolve default status property if not provided in initialProperties
    const dbProps = currentState.properties[databaseId] || [];
    const statusProp = dbProps.find((p) => p.type === "status");
    const mergedProperties: Record<string, unknown> = {
      ...resolvedTemplateProps,
      ...initialProperties,
      "prop-title": finalTitle,
    };

    if (statusProp && !mergedProperties[statusProp.id] && statusProp.options?.[0]) {
      mergedProperties[statusProp.id] = statusProp.options[0].id;
    }

    const resolvedContent = selectedTemplate?.content
      ? (resolveDynamicValue(selectedTemplate.content) as Block["content"])
      : {
          type: "doc",
          content: [{ type: "paragraph" }],
        };

    const newRow: Block = {
      id,
      workspaceId: currentState.workspace.id,
      parentId: databaseId,
      type: "page",
      title: finalTitle,
      icon: selectedTemplate?.icon || "📄",
      position: `z${now}`,
      properties: mergedProperties,
      content: resolvedContent,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };

    const existingChildren = currentState.childrenIndex[databaseId] || [];

    currentState = {
      ...currentState,
      blocks: {
        ...currentState.blocks,
        [id]: newRow,
      },
      childrenIndex: {
        ...currentState.childrenIndex,
        [databaseId]: [...existingChildren, id],
      },
    };

    emitChange();
    markDirty(newRow.id);
    return newRow;
  },

  updateRowProperty(rowId: string, propertyId: string, value: unknown) {
    const row = currentState.blocks[rowId];
    if (!row) return;

    const updatedProps = {
      ...(row.properties || {}),
      [propertyId]: value,
    };

    // If updating the title property, sync title attribute
    const updates: Partial<Block> = {
      properties: updatedProps,
    };
    if (propertyId === "prop-title" && typeof value === "string") {
      updates.title = value;
    }

    workspaceStore.updateBlock(rowId, updates);
  },

  createDatabaseView(databaseId: string, layout: "table" | "board" | "list" | "calendar", name?: string): DatabaseView {
    const now = Date.now();
    const id = `view-${layout}-${now}`;
    const layoutNames: Record<"table" | "board" | "list" | "calendar", string> = {
      table: "Table",
      board: "Board",
      list: "List",
      calendar: "Calendar",
    };
    const newView: DatabaseView = {
      id,
      databaseId,
      name: name || layoutNames[layout] || "View",
      layout,
      position: `v${now}`,
      groupBy: layout === "board" ? "prop-status" : undefined,
      visibleProperties: ["prop-title", "prop-status", "prop-due"],
    };

    const existingViews = currentState.views[databaseId] || [];
    currentState = {
      ...currentState,
      views: {
        ...currentState.views,
        [databaseId]: [...existingViews, newView],
      },
      activeViewIdByDatabase: {
        ...currentState.activeViewIdByDatabase,
        [databaseId]: id,
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
    return newView;
  },

  deleteDatabaseView(databaseId: string, viewId: string) {
    const existingViews = currentState.views[databaseId] || [];
    const remaining = existingViews.filter((v) => v.id !== viewId);
    let nextActive = currentState.activeViewIdByDatabase[databaseId];
    if (nextActive === viewId) {
      nextActive = remaining[0]?.id || "";
    }
    currentState = {
      ...currentState,
      views: {
        ...currentState.views,
        [databaseId]: remaining,
      },
      activeViewIdByDatabase: {
        ...currentState.activeViewIdByDatabase,
        [databaseId]: nextActive,
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
  },

  moveDatabaseView(databaseId: string, activeViewId: string, overViewId: string) {
    const list = currentState.views[databaseId] || [];
    const from = list.findIndex((v) => v.id === activeViewId);
    const to = list.findIndex((v) => v.id === overViewId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    currentState = {
      ...currentState,
      views: { ...currentState.views, [databaseId]: next },
    };
    emitChange();
    packDatabaseBlock(databaseId);
  },

  /** Custom manual ordering: place blockId at the position currently held by overId (same parent). */
  moveBlockWithinParent(parentId: string, blockId: string, overId: string) {
    const list = currentState.childrenIndex[parentId] || [];
    const from = list.indexOf(blockId);
    const to = list.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...list];
    next.splice(from, 1);
    next.splice(to, 0, blockId);
    currentState = {
      ...currentState,
      childrenIndex: { ...currentState.childrenIndex, [parentId]: next },
    };
    emitChange();
    markDirty(parentId);
  },

  updateDatabaseView(
    databaseId: string,
    viewId: string,
    updates: Partial<DatabaseView>
  ) {
    const existingViews = currentState.views[databaseId] || [];
    currentState = {
      ...currentState,
      views: {
        ...currentState.views,
        [databaseId]: existingViews.map((v) => (v.id === viewId ? { ...v, ...updates } : v)),
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
  },

  createDatabaseProperty(
    databaseId: string,
    name: string,
    type: DatabaseProperty["type"],
    options?: DatabaseProperty["options"],
    targetDatabaseId?: string
  ): DatabaseProperty {
    const now = Date.now();
    const id = `prop-${now}`;

    let defaultOptions = options;
    if (!defaultOptions && (type === "select" || type === "multi_select")) {
      defaultOptions = [
        { id: `opt-${now}-1`, name: "Option 1", color: "blue" },
        { id: `opt-${now}-2`, name: "Option 2", color: "green" },
      ];
    } else if (!defaultOptions && type === "status") {
      defaultOptions = [
        { id: `opt-${now}-todo`, name: "Not started", color: "default", group: "todo" },
        { id: `opt-${now}-prog`, name: "In progress", color: "blue", group: "doing" },
        { id: `opt-${now}-done`, name: "Done", color: "green", group: "done" },
      ];
    }

    const newProp: DatabaseProperty = {
      id,
      name: name || "New property",
      type,
      position: `p${now}`,
      options: defaultOptions,
      targetDatabaseId: type === "relation" ? (targetDatabaseId || databaseId) : undefined,
    };
    const existingProps = currentState.properties[databaseId] || [];
    currentState = {
      ...currentState,
      properties: {
        ...currentState.properties,
        [databaseId]: [...existingProps, newProp],
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
    return newProp;
  },

  updateDatabaseProperty(
    databaseId: string,
    propertyId: string,
    updates: Partial<DatabaseProperty>
  ) {
    const existingProps = currentState.properties[databaseId] || [];
    currentState = {
      ...currentState,
      properties: {
        ...currentState.properties,
        [databaseId]: existingProps.map((p) =>
          p.id === propertyId ? { ...p, ...updates } : p
        ),
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
  },

  deleteDatabaseProperty(databaseId: string, propertyId: string) {
    const existingProps = currentState.properties[databaseId] || [];
    const targetProp = existingProps.find((p) => p.id === propertyId);
    
    // Core property deletion rule: if property is core or one of standard core IDs, mark isDeleted: true
    if (targetProp && (targetProp.isCore || CORE_PROPERTY_DEFINITIONS[propertyId])) {
      currentState = {
        ...currentState,
        properties: {
          ...currentState.properties,
          [databaseId]: existingProps.map((p) =>
            p.id === propertyId ? { ...p, isDeleted: true } : p
          ),
        },
      };
    } else {
      // Normal custom property: fully remove
      currentState = {
        ...currentState,
        properties: {
          ...currentState.properties,
          [databaseId]: existingProps.filter((p) => p.id !== propertyId),
        },
      };
    }
    emitChange();
    packDatabaseBlock(databaseId);
  },

  restoreDatabaseProperty(databaseId: string, propertyId: string) {
    const existingProps = currentState.properties[databaseId] || [];
    const targetProp = existingProps.find((p) => p.id === propertyId);

    if (targetProp) {
      currentState = {
        ...currentState,
        properties: {
          ...currentState.properties,
          [databaseId]: existingProps.map((p) =>
            p.id === propertyId ? { ...p, isDeleted: false } : p
          ),
        },
      };
    } else if (CORE_PROPERTY_DEFINITIONS[propertyId]) {
      // Re-create from core definition if missing completely
      const coreDef = CORE_PROPERTY_DEFINITIONS[propertyId];
      const restoredProp: DatabaseProperty = {
        ...coreDef,
        position: `p${Date.now()}`,
        isDeleted: false,
      };
      currentState = {
        ...currentState,
        properties: {
          ...currentState.properties,
          [databaseId]: [...existingProps, restoredProp],
        },
      };
    }
    emitChange();
    packDatabaseBlock(databaseId);
  },

  // Database Templates
  createDatabaseTemplate(
    databaseId: string,
    data: {
      name: string;
      icon?: string | null;
      defaultProperties?: Record<string, unknown>;
      content?: DatabaseTemplate["content"];
      isDefault?: boolean;
    }
  ): DatabaseTemplate {
    const now = Date.now();
    const id = `tpl-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const existing = currentState.templates?.[databaseId] || [];
    const shouldBeDefault = data.isDefault ?? existing.length === 0;
    const newTemplate: DatabaseTemplate = {
      id,
      databaseId,
      name: data.name || "Untitled template",
      icon: data.icon || "📄",
      defaultProperties: data.defaultProperties || {},
      content: data.content || { type: "doc", content: [{ type: "paragraph" }] },
      isDefault: shouldBeDefault,
      createdAt: now,
      updatedAt: now,
    };
    const nextList: DatabaseTemplate[] = shouldBeDefault
      ? [...existing.map((t) => ({ ...t, isDefault: false })), newTemplate]
      : [...existing, newTemplate];
    currentState = {
      ...currentState,
      templates: {
        ...(currentState.templates || {}),
        [databaseId]: nextList,
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
    return newTemplate;
  },

  updateDatabaseTemplate(
    databaseId: string,
    templateId: string,
    updates: Partial<DatabaseTemplate>
  ) {
    const existing = currentState.templates?.[databaseId] || [];
    currentState = {
      ...currentState,
      templates: {
        ...(currentState.templates || {}),
        [databaseId]: existing.map((t) => {
          if (t.id === templateId) {
            return { ...t, ...updates, updatedAt: Date.now() };
          }
          if (updates.isDefault) {
            return { ...t, isDefault: false };
          }
          return t;
        }),
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
  },

  deleteDatabaseTemplate(databaseId: string, templateId: string) {
    const existing = currentState.templates?.[databaseId] || [];
    currentState = {
      ...currentState,
      templates: {
        ...(currentState.templates || {}),
        [databaseId]: existing.filter((t) => t.id !== templateId),
      },
    };
    emitChange();
    packDatabaseBlock(databaseId);
  },

  // Share Links
  syncShareLink(link: ShareLink, block?: Block) {
    syncShareLinkAsync(link, block);
  },

  createOrGetShareLink(
    blockId: string,
    permission: SharePermission = "read"
  ): ShareLink {
    const existingMap = currentState.shareLinks || {};
    const existing = Object.values(existingMap).find(
      (link) => link.blockId === blockId
    );
    if (existing) {
      if (!existing.enabled) {
        const updated: ShareLink = {
          ...existing,
          enabled: true,
          updatedAt: Date.now(),
        };
        currentState = {
          ...currentState,
          shareLinks: { ...existingMap, [existing.token]: updated },
        };
        emitChange();
        syncShareLinkAsync(updated);
        return updated;
      }
      syncShareLinkAsync(existing);
      return existing;
    }

    const token =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
        : `sh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const link: ShareLink = {
      token,
      blockId,
      workspaceId: currentState.workspace.id,
      permission,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    currentState = {
      ...currentState,
      shareLinks: {
        ...existingMap,
        [token]: link,
      },
    };
    emitChange();
    syncShareLinkAsync(link);
    return link;
  },

  updateShareLink(token: string, updates: Partial<Pick<ShareLink, "permission" | "enabled">>) {
    const existingMap = currentState.shareLinks || {};
    const existing = existingMap[token];
    if (!existing) return;
    const updated = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    currentState = {
      ...currentState,
      shareLinks: {
        ...existingMap,
        [token]: updated,
      },
    };
    emitChange();
    syncShareLinkAsync(updated);
  },

  revokeShareLink(token: string) {
    const existingMap = { ...(currentState.shareLinks || {}) };
    if (!(token in existingMap)) return;
    delete existingMap[token];
    currentState = {
      ...currentState,
      shareLinks: existingMap,
    };
    emitChange();
    revokeShareLinkAsync(token);
  },

  setWorkspace(workspace: Workspace) {
    currentState = {
      ...currentState,
      workspace,
    };
    emitChange();
  },

  syncFromApi(
    currentWorkspace: Workspace | null,
    notes: { id: string; parentId: string | null; title: string; content?: unknown; revision?: number }[] = [],
    tasks: { id: string; title: string; status?: string; priority?: string; dueDate?: string | null; revision?: number }[] = []
  ) {
    if (!currentWorkspace) return;

    let changed = false;

    // Check if workspace metadata changed
    const currentWs = currentState.workspace;
    if (
      currentWs.id !== currentWorkspace.id ||
      currentWs.name !== currentWorkspace.name ||
      currentWs.ownerId !== currentWorkspace.ownerId
    ) {
      changed = true;
    }

    const workspaceObj: Workspace = {
      id: currentWorkspace.id,
      name: currentWorkspace.name,
      icon: "🚀",
      ownerId: currentWorkspace.ownerId,
    };

    const nextBlocks = { ...currentState.blocks };
    const nextChildren = { ...currentState.childrenIndex };

    // Ingest notes as pages
    for (const note of notes) {
      const existing = nextBlocks[note.id];
      const parentKey = note.parentId || "root";
      const hasChild = nextChildren[parentKey]?.includes(note.id);

      if (
        !existing ||
        !hasChild ||
        (existing.revision <= (note.revision || 1) &&
          (existing.title !== (note.title || "Untitled") ||
            existing.parentId !== note.parentId ||
            existing.revision !== (note.revision || 1)))
      ) {
        changed = true;
        const block: Block = {
          id: note.id,
          workspaceId: currentWorkspace.id,
          parentId: note.parentId,
          type: "page",
          title: note.title || "Untitled",
          icon: existing?.icon || "📄",
          position: existing?.position || `n_${note.id}`,
          content: (note.content as { type?: string; content?: unknown[] }) || existing?.content || {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
          revision: note.revision || 1,
          createdAt: existing?.createdAt || Date.now(),
          updatedAt: existing?.updatedAt || Date.now(),
        };
        nextBlocks[note.id] = block;

        if (!nextChildren[parentKey]) nextChildren[parentKey] = [];
        if (!nextChildren[parentKey].includes(note.id)) {
          nextChildren[parentKey].push(note.id);
        }
      }
    }

    // Ingest tasks as database rows under database-tasks
    const dbId = "database-tasks";
    if (!nextChildren[dbId]) nextChildren[dbId] = [];

    const statusMap: Record<string, string> = {
      todo: "opt-todo",
      doing: "opt-progress",
      done: "opt-done",
    };
    const prioMap: Record<string, string> = {
      urgent: "prio-urgent",
      high: "prio-high",
      medium: "prio-medium",
      low: "prio-low",
    };

    for (const task of tasks) {
      const existing = nextBlocks[task.id];
      const hasChild = nextChildren[dbId]?.includes(task.id);
      const mappedStatus = statusMap[task.status || "todo"] || "opt-todo";
      const mappedPriority = prioMap[task.priority || "none"] || "prio-medium";
      const mappedDue = task.dueDate || null;

      if (
        !existing ||
        !hasChild ||
        (existing.revision <= (task.revision || 1) &&
          (existing.title !== (task.title || "Untitled") ||
            existing.properties?.["prop-status"] !== mappedStatus ||
            existing.properties?.["prop-priority"] !== mappedPriority ||
            existing.properties?.["prop-due"] !== mappedDue ||
            existing.revision !== (task.revision || 1)))
      ) {
        changed = true;
        const row: Block = {
          id: task.id,
          workspaceId: currentWorkspace.id,
          parentId: dbId,
          type: "page",
          title: task.title || "Untitled",
          icon: existing?.icon || "📄",
          position: existing?.position || `t_${task.id}`,
          properties: {
            "prop-title": task.title,
            "prop-status": mappedStatus,
            "prop-priority": mappedPriority,
            "prop-due": mappedDue,
          },
          content: existing?.content || {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
          revision: task.revision || 1,
          createdAt: existing?.createdAt || Date.now(),
          updatedAt: existing?.updatedAt || Date.now(),
        };
        nextBlocks[task.id] = row;

        if (!nextChildren[dbId].includes(task.id)) {
          nextChildren[dbId].push(task.id);
        }
      }
    }

    // If nothing changed, do not mutate state or trigger re-renders
    if (!changed) {
      return;
    }

    currentState = {
      ...currentState,
      workspace: workspaceObj,
      blocks: nextBlocks,
      childrenIndex: nextChildren,
    };
    emitChange();
  },

  setServerSyncAdapter(adapter: ServerSyncAdapter | null) {
    currentAdapter = adapter;
    isFirstSync = true;
    if (adapter) {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => {
        if (currentAdapter && !activeSyncPromise && !syncTimer) {
          if (typeof document === "undefined" || document.visibilityState === "visible") {
            void workspaceStore.flushSync();
          }
        }
      }, 4000);
      if (pollInterval && typeof (pollInterval as unknown as { unref?: () => void }).unref === "function") {
        (pollInterval as unknown as { unref: () => void }).unref();
      }
      void workspaceStore.flushSync();
    } else {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
  },

  getServerSyncAdapter(): ServerSyncAdapter | null {
    return currentAdapter;
  },

  async flushSync() {
    if (!currentAdapter) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (activeSyncPromise) return activeSyncPromise;

    activeSyncPromise = (async () => {
      try {
        let blocksToPush: Block[] = [];
        const dirtyIds = Array.from(syncOutbox);

        if (isFirstSync) {
          isFirstSync = false;
          const serverBlocks = await currentAdapter.fetchBlocks();
          if (serverBlocks.length === 0) {
            // Server has no blocks yet: push all local non-archived blocks
            blocksToPush = Object.values(currentState.blocks).filter((b) => !b.isArchived);
          } else {
            // Check if local was only initial seed with no local modifications
            const localOnlySeed =
              dirtyIds.length === 0 &&
              Object.keys(tombstones).length === 0 &&
              Object.keys(currentState.blocks).every((id) =>
                id.startsWith("page-getting-started") ||
                id.startsWith("database-tasks") ||
                id.startsWith("task-")
              );

            if (localOnlySeed) {
              // Replace local seed state with server blocks cleanly
              currentState = {
                ...currentState,
                blocks: {},
                childrenIndex: { root: [] },
                properties: {},
                views: {},
                templates: {},
              };
            }
            reconcileWithServerBlocks(serverBlocks);
            blocksToPush = Array.from(syncOutbox)
              .map((id) => currentState.blocks[id])
              .filter(Boolean) as Block[];
          }
        } else if (dirtyIds.length > 0) {
          blocksToPush = dirtyIds
            .map((id) => currentState.blocks[id])
            .filter(Boolean) as Block[];
        }

        const tombstoneCount = Object.keys(tombstones).length;
        if (blocksToPush.length > 0 || tombstoneCount > 0) {
          const returnedBlocks = await currentAdapter.syncBlocks(blocksToPush, tombstones);
          if (Array.isArray(returnedBlocks)) {
            for (const b of blocksToPush) {
              syncOutbox.delete(b.id);
            }
            saveOutbox(syncOutbox);
            reconcileWithServerBlocks(returnedBlocks);
          }
        }
      } catch (err) {
        console.warn("workspaceStore sync warning:", err);
      }
    })().finally(() => {
      activeSyncPromise = null;
    });

    return activeSyncPromise;
  },

  reconcileWithServer(blocks: Block[]) {
    reconcileWithServerBlocks(blocks);
  },

  // Reset to default seed
  resetToDefaultSeed() {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(OUTBOX_STORAGE_KEY);
      localStorage.removeItem(TOMBSTONES_STORAGE_KEY);
    }
    syncOutbox.clear();
    for (const key of Object.keys(tombstones)) {
      delete tombstones[key];
    }
    currentState = buildInitialState();
    emitChange();
  },
};

export function useWorkspace() {
  const state = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getState,
    workspaceStore.getState
  );

  return {
    ...state,
    setActiveBlock: workspaceStore.setActiveBlock,
    setSidePeekBlock: workspaceStore.setSidePeekBlock,
    setActiveView: workspaceStore.setActiveView,
    toggleTheme: workspaceStore.toggleTheme,
    setSidebarCollapsed: workspaceStore.setSidebarCollapsed,
    setSearchQuery: workspaceStore.setSearchQuery,
    createPage: workspaceStore.createPage,
    createDatabase: workspaceStore.createDatabase,
    updateBlock: workspaceStore.updateBlock,
    toggleFavorite: workspaceStore.toggleFavorite,
    archiveBlock: workspaceStore.archiveBlock,
    restoreBlock: workspaceStore.restoreBlock,
    duplicateBlock: workspaceStore.duplicateBlock,
    createDatabaseRow: workspaceStore.createDatabaseRow,
    updateRowProperty: workspaceStore.updateRowProperty,
    createDatabaseView: workspaceStore.createDatabaseView,
    updateDatabaseView: workspaceStore.updateDatabaseView,
    moveDatabaseView: workspaceStore.moveDatabaseView,
    moveBlockWithinParent: workspaceStore.moveBlockWithinParent,
    deleteDatabaseView: workspaceStore.deleteDatabaseView,
    createDatabaseProperty: workspaceStore.createDatabaseProperty,
    updateDatabaseProperty: workspaceStore.updateDatabaseProperty,
    deleteDatabaseProperty: workspaceStore.deleteDatabaseProperty,
    restoreDatabaseProperty: workspaceStore.restoreDatabaseProperty,
    createDatabaseTemplate: workspaceStore.createDatabaseTemplate,
    updateDatabaseTemplate: workspaceStore.updateDatabaseTemplate,
    deleteDatabaseTemplate: workspaceStore.deleteDatabaseTemplate,
    createOrGetShareLink: workspaceStore.createOrGetShareLink,
    updateShareLink: workspaceStore.updateShareLink,
    revokeShareLink: workspaceStore.revokeShareLink,
    syncShareLink: workspaceStore.syncShareLink,
    resetToDefaultSeed: workspaceStore.resetToDefaultSeed,
    setWorkspace: workspaceStore.setWorkspace,
    syncFromApi: workspaceStore.syncFromApi,
    setServerSyncAdapter: workspaceStore.setServerSyncAdapter,
    flushSync: workspaceStore.flushSync,
    reconcileWithServer: workspaceStore.reconcileWithServer,
  };
}
