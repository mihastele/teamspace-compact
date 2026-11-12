const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const source = ts.createSourceFile("page.tsx", fs.readFileSync(require.resolve("../src/app/page.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const keys = new Map();
function visit(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const name = node.tagName.getText(source);
    if (["TeamspaceEditor", "DatabaseView"].includes(name)) {
      const key = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "key");
      assert.ok(key?.initializer && ts.isJsxExpression(key.initializer), `${name} must have an explicit scope key`);
      keys.set(name, new Function("activeBlock", `return (${key.initializer.expression.getText(source)});`));
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);

test("note editor and database view have distinct stable identities across idle updates and navigation", () => {
  assert.equal(keys.size, 2);
  const seen = new Set();
  for (const id of ["page-a", "page-b", "database-a"]) {
    const activeBlock = { id };
    for (const [name, evaluate] of keys) {
      const identity = `${name}:${evaluate(activeBlock)}`;
      assert.ok(!seen.has(identity), `${name} collides with another block scope: ${identity}`);
      seen.add(identity);
    }
  }
});
