import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [flag, container, action] = process.argv.slice(2);
if (flag !== '--container' || !container || !['--write','--check'].includes(action))
  throw new Error('Usage: node scripts/generate-database-entity-link-types.mjs --container <test-container> --write|--check');
const types = { text:'string', uuid:'string' };
const definitions = [
  ['teamspace_database_task_links','DatabaseTaskLinkRow',['workspace_id','source_path','field_id','task_id']],
  ['teamspace_database_project_links','DatabaseProjectLinkRow',['workspace_id','source_path','field_id','project_id']],
  ['teamspace_task_database_relations','TaskDatabaseRelationRow',['workspace_id','task_id','field_path','entry_path']],
  ['teamspace_project_database_relations','ProjectDatabaseRelationRow',['workspace_id','project_id','field_path','entry_path']],
];
const output = ['// Generated from PostgreSQL by scripts/generate-database-entity-link-types.mjs. Do not edit.'];
for (const [table,name,expected] of definitions) {
  const query = `select coalesce(json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) order by a.attnum),'[]'::json) from pg_attribute a where a.attrelid='public.${table}'::regclass and a.attnum>0 and not a.attisdropped;`;
  const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});
  if(result.error||result.status!==0)throw new Error(`Could not inspect ${table} in the specified PostgreSQL container.`);
  const columns=JSON.parse(result.stdout);
  if(columns.map(column=>column.name).join(',')!==expected.join(','))throw new Error(`Unexpected ${table} columns.`);
  output.push(`export type ${name} = {`);
  for(const column of columns){
    if(!types[column.type])throw new Error(`Unexpected database type: ${column.type}`);
    output.push(`  ${column.name}: ${types[column.type]}${column.notNull?'':' | null'};`);
  }
  output.push('};');
}
const target='src/lib/generated/database-entity-links.ts', result=output.concat('').join('\n');
if(action==='--write')writeFileSync(target,result);
else if(readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==result)throw new Error('Generated entity-link types are out of date.');
