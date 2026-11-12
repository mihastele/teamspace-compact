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
