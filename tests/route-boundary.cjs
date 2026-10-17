const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Script } = require('node:vm');
const ts = require('typescript');

// Exercise the actual framework entry file instead of only the trusted dispatcher.
// The injected boundary supplies fixture authentication; domain services stay real.
const filename = resolve(__dirname, '../src/app/api/[...path]/route.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const script = new Script(compiled, { filename });
module.exports = function loadApiRoute(handleApi) {
  const exports = {};
  script.runInNewContext({ exports, require: id => {
    if (id !== '@/lib/server/api') throw new Error(`Unexpected route dependency: ${id}`);
    return { handleApi };
  } });
  return exports;
};
