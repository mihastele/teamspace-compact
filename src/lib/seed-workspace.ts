import type { Block, DatabaseProperty, DatabaseView, Workspace } from "./model";

export const DEFAULT_WORKSPACE_ID = "workspace-default";

export function createDefaultWorkspace(): Workspace {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: "My Workspace",
    icon: "🚀",
    ownerId: "user-local",
  };
}

export function generateSeedData(workspaceId: string = DEFAULT_WORKSPACE_ID): {
  blocks: Block[];
  properties: DatabaseProperty[];
  views: DatabaseView[];
} {
  const now = Date.now();

  // 1. Getting Started Page
  const gettingStartedPage: Block = {
    id: "page-getting-started",
    workspaceId,
    parentId: null,
    type: "page",
    title: "Getting Started with openNotion",
    icon: "👋",
    coverUrl: null,
    position: "a0",
    isFavorite: true,
    revision: 1,
    createdAt: now - 86400000,
    updatedAt: now - 86400000,
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Welcome to openNotion!" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "openNotion is a high-performance, MIT-licensed open-source workspace built for notes, tasks, databases, and knowledge bases.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Quick Keyboard Shortcuts" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Type '/' anywhere to open the command palette and insert blocks" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Press 'Cmd+K' or 'Ctrl+K' to quickly search across pages and databases" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Create subpages inside any page or organize them in databases" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Drag blocks or reorder pages in the sidebar" }] }],
            },
          ],
        },
      ],
    },
  };

  // 2. Tasks Database
  const tasksDatabaseId = "database-tasks";
  const tasksDatabase: Block = {
    id: tasksDatabaseId,
    workspaceId,
    parentId: null,
    type: "database",
    title: "Tasks & Roadmap",
    icon: "📋",
    position: "a1",
    isFavorite: true,
    revision: 1,
    createdAt: now - 72000000,
    updatedAt: now - 3600000,
  };

  const taskProperties: DatabaseProperty[] = [
    {
      id: "prop-title",
      name: "Task",
      type: "title",
      position: "a0",
      isCore: true,
    },
    {
      id: "prop-status",
      name: "Status",
      type: "status",
      position: "a1",
      isCore: true,
      options: [
        { id: "opt-todo", name: "To Do", color: "gray", group: "todo" },
        { id: "opt-progress", name: "In Progress", color: "blue", group: "doing" },
        { id: "opt-done", name: "Done", color: "green", group: "done" },
      ],
    },
    {
      id: "prop-priority",
      name: "Priority",
      type: "select",
      position: "a2",
      isCore: true,
      options: [
        { id: "prio-urgent", name: "Urgent", color: "red" },
        { id: "prio-high", name: "High", color: "orange" },
        { id: "prio-medium", name: "Medium", color: "yellow" },
        { id: "prio-low", name: "Low", color: "default" },
      ],
    },
    {
      id: "prop-due",
      name: "Due Date",
      type: "date",
      position: "a3",
      isCore: true,
    },
    {
      id: "prop-relations",
      name: "Related Tasks",
      type: "relation",
      position: "a4",
      targetDatabaseId: tasksDatabaseId,
    },
  ];

  const taskViews: DatabaseView[] = [
    {
      id: "view-tasks-board",
      databaseId: tasksDatabaseId,
      name: "Board",
      layout: "board",
      groupBy: "prop-status",
      visibleProperties: ["prop-title", "prop-priority", "prop-due"],
      position: "a0",
    },
    {
      id: "view-tasks-table",
      databaseId: tasksDatabaseId,
      name: "All Tasks",
      layout: "table",
      visibleProperties: ["prop-title", "prop-status", "prop-priority", "prop-due"],
      position: "a1",
    },
    {
      id: "view-tasks-calendar",
      databaseId: tasksDatabaseId,
      name: "Calendar",
      layout: "calendar",
      position: "a2",
    },
  ];

  // Seed rows for Tasks
  const taskRows: Block[] = [
    {
      id: "task-1",
      workspaceId,
      parentId: tasksDatabaseId,
      type: "page",
      title: "Design intuitive Notion-like sidebar & canvas",
      icon: "🎨",
      position: "a0",
      properties: {
        "prop-title": "Design intuitive Notion-like sidebar & canvas",
        "prop-status": "opt-done",
        "prop-priority": "prio-high",
        "prop-due": new Date(now + 86400000).toISOString().split("T")[0],
      },
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Create clean light/dark themes, collapsible sidebar, and smooth block editor." }],
          },
        ],
      },
      revision: 1,
      createdAt: now - 36000000,
      updatedAt: now - 18000000,
    },
    {
      id: "task-2",
      workspaceId,
      parentId: tasksDatabaseId,
      type: "page",
      title: "Refactor data model to unified blocks and views",
      icon: "⚡",
      position: "a1",
      properties: {
        "prop-title": "Refactor data model to unified blocks and views",
        "prop-status": "opt-progress",
        "prop-priority": "prio-urgent",
        "prop-due": new Date(now + 172800000).toISOString().split("T")[0],
      },
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Unify pages, databases, and rows under one cohesive block table." }],
          },
        ],
      },
      revision: 1,
      createdAt: now - 28000000,
      updatedAt: now - 7200000,
    },
    {
      id: "task-3",
      workspaceId,
      parentId: tasksDatabaseId,
      type: "page",
      title: "Add offline caching & instantaneous local updates",
      icon: "📦",
      position: "a2",
      properties: {
        "prop-title": "Add offline caching & instantaneous local updates",
        "prop-status": "opt-todo",
        "prop-priority": "prio-medium",
        "prop-due": new Date(now + 345600000).toISOString().split("T")[0],
      },
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Store state locally so reloads and transitions are snappy (<16ms)." }],
          },
        ],
      },
      revision: 1,
      createdAt: now - 14000000,
      updatedAt: now - 14000000,
    },
  ];

  // 3. Engineering Wiki Page with Nested Subpages
  const wikiPageId = "page-engineering-wiki";
  const wikiPage: Block = {
    id: wikiPageId,
    workspaceId,
    parentId: null,
    type: "page",
    title: "Engineering Wiki",
    icon: "📚",
    position: "a2",
    isFavorite: false,
    revision: 1,
    createdAt: now - 50000000,
    updatedAt: now - 20000000,
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Welcome to our Engineering Handbook" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Check out our architecture guidelines, coding standards, and meeting notes below." }],
        },
      ],
    },
  };

  const wikiSubpageArchitecture: Block = {
    id: "page-wiki-arch",
    workspaceId,
    parentId: wikiPageId,
    type: "page",
    title: "Architecture Decisions (ADRs)",
    icon: "🏛️",
    position: "a0",
    revision: 1,
    createdAt: now - 40000000,
    updatedAt: now - 20000000,
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "ADR-001: Unified Block & Database Model" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Decision: Represent all documents, subpages, and database entries as blocks in a single hierarchical tree for maximum flexibility.",
            },
          ],
        },
      ],
    },
  };

  return {
    blocks: [gettingStartedPage, tasksDatabase, ...taskRows, wikiPage, wikiSubpageArchitecture],
    properties: taskProperties,
    views: taskViews,
  };
}
