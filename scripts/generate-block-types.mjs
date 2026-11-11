import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Generate from a named PostgreSQL container; never infer or connect to staging.
const [containerFlag, container, action] = process.argv.slice(2);
if (containerFlag !== '--container' || !container || !['--write', '--check'].includes(action)) {
  throw new Error('Usage: node scripts/generate-block-types.mjs --container <test-container> --write|--check');
}
const query = `select coalesce(json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) order by a.attnum),'[]'::json)
from pg_attribute a where a.attrelid='public.teamspace_blocks'::regclass and a.attnum>0 and not a.attisdropped;`;
const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
if (result.error || result.status !== 0) throw new Error('Could not inspect the specified PostgreSQL container.');
const columns = JSON.parse(result.stdout);
const expected = ['workspace_id','id','parent_id','kind','position','revision','workspace_path'];
if (columns.map(column => column.name).join(',') !== expected.join(',')) throw new Error('Unexpected block table columns.');
const types = { text: 'string', uuid: 'string', bigint: 'number' };
const fields = columns.map(column => {
  if (!types[column.type]) throw new Error(`Unexpected database type: ${column.type}`);
  return `  ${column.name}: ${types[column.type]}${column.notNull ? '' : ' | null'};`;
});
const output = ['// Generated from PostgreSQL by scripts/generate-block-types.mjs. Do not edit.', '// PostgREST JSON represents revision as a number; raw pg drivers may return bigint as a string.', '// The migration constrains revision to JavaScript safe integers.', 'export type BlockContainmentRow = {', ...fields, '};', ''].join('\n');
const target = resolve('src/lib/generated/block-containment.ts');
if (action === '--write') writeFileSync(target, output);
else if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) throw new Error('Generated block types are out of date.');
