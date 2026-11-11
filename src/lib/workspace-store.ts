import { useSyncExternalStore } from "react";
import type { Block, DatabaseProperty, DatabaseView, Workspace } from "./model";
import { createDefaultWorkspace, generateSeedData } from "./seed-workspace";

export type WorkspaceState = {
  workspace: Workspace;
  blocks: Record<string, Block>;
  childrenIndex: Record<string, string[]>; // parentId (or 'root') -> blockIds in order
  properties: Record<string, DatabaseProperty[]>; // databaseId -> properties
  views: Record<string, DatabaseView[]>; // databaseId -> views
  activeBlockId: string | null;
  sidePeekBlockId: string | null;
  activeViewIdByDatabase: Record<string, string>; // databaseId -> viewId
  searchQuery: string;
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
};

const STORAGE_KEY = "opennotion_workspace_state_v1";

function buildInitialState(): WorkspaceState {
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.workspace && parsed.blocks) {
          return parsed;
        }
      }
    } catch {
      // Fallback to fresh seed
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
    return newPage;
  },

  createDatabase(parentId: string | null = null, title: string = "Untitled Database"): Block {
    const now = Date.now();
    const id = `database-${now}-${Math.random().toString(36).slice(2, 7)}`;
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
    };

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
      workspaceStore.updateBlock(id, { isArchived: true });
      if (currentState.sidePeekBlockId === id) {
        workspaceStore.setSidePeekBlock(null);
      }
      if (currentState.activeBlockId === id) {
        // Find another root page to switch to
        const rootIds = currentState.childrenIndex["root"] || [];
        const nextId = rootIds.find((bid) => bid !== id && !currentState.blocks[bid]?.isArchived);
        workspaceStore.setActiveBlock(nextId || null);
      }
    }
  },

  restoreBlock(id: string) {
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
    return duplicate;
  },

  // Database Rows
  createDatabaseRow(
    databaseId: string,
    title: string = "New entry",
    initialProperties: Record<string, unknown> = {}
  ): Block {
    const now = Date.now();
    const id = `row-${now}-${Math.random().toString(36).slice(2, 7)}`;

    // Resolve default status property if not provided in initialProperties
    const dbProps = currentState.properties[databaseId] || [];
    const statusProp = dbProps.find((p) => p.type === "status");
    const mergedProperties: Record<string, unknown> = {
      "prop-title": title,
      ...initialProperties,
    };

    if (statusProp && !mergedProperties[statusProp.id] && statusProp.options?.[0]) {
      mergedProperties[statusProp.id] = statusProp.options[0].id;
    }

    const newRow: Block = {
      id,
      workspaceId: currentState.workspace.id,
      parentId: databaseId,
      type: "page",
      title,
      icon: "📄",
      position: `z${now}`,
      properties: mergedProperties,
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
      },
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

  // Reset to default seed
  resetToDefaultSeed() {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
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
    resetToDefaultSeed: workspaceStore.resetToDefaultSeed,
    setWorkspace: workspaceStore.setWorkspace,
    syncFromApi: workspaceStore.syncFromApi,
  };
}
