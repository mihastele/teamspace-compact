const test = require("node:test");
const assert = require("node:assert/strict");
const { workspaceStore } = require("../.test-build/workspace-store.js");

test("database templates resolve $today and $this dynamic tokens on row creation", () => {
  workspaceStore.resetToDefaultSeed();
  const projectsDb = workspaceStore.createDatabase("Projects");
  const todosDb = workspaceStore.createDatabase("TODOs");
  const projectRelProp = workspaceStore.createDatabaseProperty(
    todosDb.id,
    "Project",
    "relation",
    undefined,
    projectsDb.id
  );
  assert.equal(projectRelProp.targetDatabaseId, projectsDb.id);

  const tpl = workspaceStore.createDatabaseTemplate(projectsDb.id, {
    name: "Project Template",
    icon: "🚀",
    defaultProperties: {
      "prop-due": "$today",
    },
    content: {
      type: "doc",
      content: [
        {
          type: "databaseView",
          attrs: {
            databaseId: todosDb.id,
            viewId: null,
            filterRules: [
              {
                propertyId: projectRelProp.id,
                operator: "contains",
                value: "$this",
              },
            ],
          },
        },
      ],
    },
    isDefault: true,
  });

  const row = workspaceStore.createDatabaseRow(projectsDb.id, "Alpha Project", {}, tpl.id);
  const todayStr = new Date().toISOString().slice(0, 10);

  assert.equal(row.icon, "🚀");
  assert.equal(row.properties["prop-due"], todayStr);
  const embeddedNode = row.content.content[0];
  assert.equal(embeddedNode.type, "databaseView");
  assert.equal(embeddedNode.attrs.filterRules[0].value, row.id);
});

test("share links support read-only, edit, and revocation lifecycle", () => {
  workspaceStore.resetToDefaultSeed();
  const page = workspaceStore.createPage("Public Roadmap");
  const link = workspaceStore.createOrGetShareLink(page.id, "read");
  assert.equal(link.blockId, page.id);
  assert.equal(link.permission, "read");
  assert.equal(link.enabled, true);

  workspaceStore.updateShareLink(link.token, { permission: "edit" });
  const updated = workspaceStore.getState().shareLinks[link.token];
  assert.equal(updated.permission, "edit");

  workspaceStore.revokeShareLink(link.token);
  assert.equal(workspaceStore.getState().shareLinks[link.token], undefined);
});

test("server sync reconciles blocks at block level without overwriting unrelated blocks", async () => {
  workspaceStore.resetToDefaultSeed();
  const pageA = workspaceStore.createPage(null, "Device A Page");
  assert.ok(workspaceStore.getState().blocks[pageA.id]);

  // Simulate server sending Device B's new block
  const serverBlockB = {
    id: "page-device-b",
    workspaceId: workspaceStore.getState().workspace.id,
    parentId: null,
    type: "page",
    title: "Device B Page",
    icon: "📄",
    position: "z100",
    revision: 1,
    createdAt: 1000,
    updatedAt: 1000,
    content: { type: "doc", content: [] },
  };

  workspaceStore.reconcileWithServer([serverBlockB]);

  const state = workspaceStore.getState();
  // Both pageA and page-device-b must exist!
  assert.equal(state.blocks[pageA.id]?.title, "Device A Page");
  assert.equal(state.blocks["page-device-b"]?.title, "Device B Page");
  assert.ok(state.childrenIndex["root"].includes(pageA.id));
  assert.ok(state.childrenIndex["root"].includes("page-device-b"));
});

test("same-block conflict resolution uses newer value (LWW)", async () => {
  workspaceStore.resetToDefaultSeed();
  const page = workspaceStore.createPage(null, "Original Title");
  const blockId = page.id;

  // Case 1: Server has a newer update
  const newerServerBlock = {
    ...page,
    title: "Newer Server Title",
    updatedAt: page.updatedAt + 10000,
    revision: page.revision + 1,
  };
  workspaceStore.reconcileWithServer([newerServerBlock]);
  assert.equal(workspaceStore.getState().blocks[blockId]?.title, "Newer Server Title");

  // Case 2: Local has a newer update than an older server update
  workspaceStore.updateBlock(blockId, { title: "Local Fresh Edit" });
  const localTime = workspaceStore.getState().blocks[blockId].updatedAt;

  const olderServerBlock = {
    ...page,
    title: "Stale Server Title",
    updatedAt: localTime - 5000,
    revision: 1,
  };
  workspaceStore.reconcileWithServer([olderServerBlock]);
  // Local newer edit must win
  assert.equal(workspaceStore.getState().blocks[blockId]?.title, "Local Fresh Edit");
});

test("tombstone deletion synchronization prevents resurrecting deleted blocks", async () => {
  workspaceStore.resetToDefaultSeed();
  const pageToDelete = workspaceStore.createPage(null, "To Be Deleted");
  const delId = pageToDelete.id;

  // Archive / delete block on this device
  workspaceStore.archiveBlock(delId);
  assert.equal(workspaceStore.getState().blocks[delId], undefined);

  // Stale server response arrives containing the block from before deletion
  const staleServerBlock = {
    ...pageToDelete,
    updatedAt: pageToDelete.updatedAt,
  };
  workspaceStore.reconcileWithServer([staleServerBlock]);

  // Must NOT be resurrected!
  assert.equal(workspaceStore.getState().blocks[delId], undefined);
  assert.ok(!workspaceStore.getState().childrenIndex["root"]?.includes(delId));

  // If another device deleted a block, server sends tombstone
  const remotePage = workspaceStore.createPage(null, "Remote Active Page");
  assert.ok(workspaceStore.getState().blocks[remotePage.id]);

  const remoteServerTombstone = {
    id: remotePage.id,
    isArchived: true,
    deletedAt: Date.now() + 5000,
    updatedAt: Date.now() + 5000,
  };
  workspaceStore.reconcileWithServer([remoteServerTombstone]);

  // Must be deleted locally
  assert.equal(workspaceStore.getState().blocks[remotePage.id], undefined);
});

test("offline changes queue in outbox and flush when connected", async () => {
  workspaceStore.resetToDefaultSeed();

  let syncedBlocks = [];

  const mockAdapter = {
    workspaceId: workspaceStore.getState().workspace.id,
    fetchBlocks: async () => [],
    syncBlocks: async (blocks) => {
      syncedBlocks = blocks;
      return blocks;
    },
    deleteBlock: async () => {},
  };

  const offlinePage = workspaceStore.createPage(null, "Offline Created Page");
  workspaceStore.updateBlock(offlinePage.id, { title: "Offline Updated Page" });

  workspaceStore.setServerSyncAdapter(mockAdapter);
  await workspaceStore.flushSync();

  assert.ok(syncedBlocks.some((b) => b.id === offlinePage.id && b.title === "Offline Updated Page"));
  workspaceStore.setServerSyncAdapter(null);
});
