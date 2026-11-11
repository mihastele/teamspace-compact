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

    currentState = {
      ...currentState,
      blocks: {
        ...currentState.blocks,
        [id]: {
          ...existing,
          ...updates,
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
      this.updateBlock(id, { isFavorite: !block.isFavorite });
    }
  },

  archiveBlock(id: string) {
    const block = currentState.blocks[id];
    if (block) {
      this.updateBlock(id, { isArchived: true });
      if (currentState.activeBlockId === id) {
        // Find another root page to switch to
        const rootIds = currentState.childrenIndex["root"] || [];
        const nextId = rootIds.find((bid) => bid !== id && !currentState.blocks[bid]?.isArchived);
        this.setActiveBlock(nextId || null);
      }
    }
  },

  restoreBlock(id: string) {
    this.updateBlock(id, { isArchived: false });
  },

  // Database Rows
  createDatabaseRow(databaseId: string, title: string = "New entry"): Block {
    const now = Date.now();
    const id = `row-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const newRow: Block = {
      id,
      workspaceId: currentState.workspace.id,
      parentId: databaseId,
      type: "page",
      title,
      icon: "📄",
      position: `z${now}`,
      properties: {
        "prop-title": title,
      },
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

    this.updateBlock(rowId, updates);
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
    createDatabaseRow: workspaceStore.createDatabaseRow,
    updateRowProperty: workspaceStore.updateRowProperty,
    resetToDefaultSeed: workspaceStore.resetToDefaultSeed,
  };
}
