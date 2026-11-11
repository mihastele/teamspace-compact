const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const source = ts.createSourceFile("page.tsx", fs.readFileSync(require.resolve("../src/app/page.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const keys = new Map();
function visit(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const name = node.tagName.getText(source);
    if (["RecoveryArchives", "SyncedContentScope"].includes(name)) {
      const key = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "key");
      assert.ok(key?.initializer && ts.isJsxExpression(key.initializer), `${name} must have an explicit scope key`);
      keys.set(name, new Function("api", "key", `return (${key.initializer.expression.getText(source)});`));
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);

test("note archive controls and synced editor have distinct stable identities across idle updates and navigation", () => {
  assert.equal(keys.size, 2);
  const seen = new Set();
  for (const uid of ["member-a", "member-b"]) {
    for (const workspace of ["workspace-a", "workspace-b"]) {
      for (const note of ["note-a", "note-b"]) {
        const api = { user: { uid } };
        const scope = `${workspace}:${note}`;
        for (const [name, evaluate] of keys) {
          const identity = evaluate(api, scope);
          assert.ok(!seen.has(identity), `${name} collides with another component or account/workspace/note scope: ${identity}`);
          seen.add(identity);
          for (let heartbeat = 0; heartbeat < 100; heartbeat++) {
            assert.equal(evaluate({ user: { uid }, presence: [{ displayName: `Viewer ${heartbeat}` }] }, scope), identity, "presence must not remount recovery or the editor");
          }
        }
      }
    }
  }
});
