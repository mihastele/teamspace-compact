// Disposable PostgreSQL research fixture; never connects to application data.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");

const container = `teamspace-block-experiment-${randomBytes(6).toString("hex")}`;
let started = false;
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", error = "";
    child.stdout.on("data", chunk => { out += chunk; });
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(out.trim()) : reject(new Error(error.trim())));
    child.stdin.end(input);
  });
}
const sql = source => docker(["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], source);
before(async () => {
  await docker(["run", "-d", "--rm", "--name", container, "-e", `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}`, "postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f"]);
  started = true;
  for (let attempt = 0; ; attempt++) {
    try { await sql("select 1;"); break; }
    catch (error) { if (attempt === 40) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  await sql(readFileSync("tests/prototypes/block-structure.sql", "utf8"));
  await sql("insert into experiment_workspaces values ('one'),('two'); insert into experiment_blocks values ('one','a',null),('one','b',null),('one','leaf','a'),('two','other',null); insert into experiment_content values ('one','leaf','retained');");
});
after(async () => { if (started) await docker(["stop", container]); });

test("move preserves block identity and its separately stored content", async () => {
  await sql("select experiment_move('one','leaf','b');");
  assert.equal(await sql("select b.id||':'||b.parent_id||':'||c.text_value from experiment_blocks b join experiment_content c on (b.workspace_id,b.id)=(c.workspace_id,c.block_id) where b.id='leaf';"), "leaf:b:retained");
});

test("cross-workspace parent and self or descendant moves are rejected", async () => {
  await assert.rejects(sql("select experiment_move('one','a','other');"), /block unavailable/);
  await assert.rejects(sql("select experiment_move('one','a','a');"), /cycle/);
  await assert.rejects(sql("select experiment_move('one','b','leaf');"), /cycle/);
  await assert.rejects(sql("update experiment_blocks set parent_id='other' where workspace_id='one' and id='a';"), /foreign key/);
});

test("concurrent reciprocal moves cannot form a cycle", async () => {
  const results = await Promise.allSettled([
    sql("begin; select experiment_move('one','a','b'); select pg_sleep(0.2); commit;"),
    sql("begin; select experiment_move('one','b','a'); select pg_sleep(0.2); commit;"),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.match(rejected.reason.message, /cycle/);
  assert.equal(await sql("select count(*) from experiment_blocks a join experiment_blocks b on a.workspace_id=b.workspace_id and a.parent_id=b.id and b.parent_id=a.id where a.workspace_id='one';"), "0");
});
