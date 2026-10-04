import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const literal = value => "'" + value.replace(/'/g, "''") + "'";
export function migrationSQL() {
  let sql = "\\set ON_ERROR_STOP on\nselect pg_advisory_lock(71649328);\n";
  sql += readFileSync(resolve(root, 'migrations/000-supabase-migration-ledger.sql'), 'utf8') + '\n';
  for (const name of ['007-supabase-backend.sql', '008-workspace-administration.sql']) {
    const source = readFileSync(resolve(root, 'migrations', name), 'utf8').replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(source).digest('hex');
    if (!/commit;\s*$/i.test(source)) throw new Error('Migration must end with COMMIT.');
    sql += `do $$begin
      if exists(select 1 from public.teamspace_schema_migrations where name=${literal(name)} and checksum<>${literal(checksum)}) then
        raise exception 'Applied migration checksum changed'; end if;
    end$$;\n`;
    sql += `select not exists(select 1 from public.teamspace_schema_migrations where name=${literal(name)}) as pending \\gset\n\\if :pending\n`;
    if (name.startsWith('007')) sql += "do $$begin if to_regclass('public.teamspace_documents') is not null then raise exception 'Existing application schema has no migration ledger; use the documented manual upgrade path'; end if; end$$;\n";
    sql += source.replace(/commit;\s*$/i, `insert into public.teamspace_schema_migrations(name,checksum) values(${literal(name)},${literal(checksum)});\ncommit;\n`);
    sql += '\\endif\n';
  }
  return sql + 'select pg_advisory_unlock(71649328);\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync('docker', ['compose', '--env-file', '.env.supabase', '-f', 'docker.compose.supabase.yml',
    'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'],
  { cwd: root, input: migrationSQL(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    console.error('Migration failed. No failed migration was recorded as applied. Check database readiness, migration checksums, and the manual upgrade path for an existing installation.');
    process.exitCode = 1;
  } else console.log('Application migrations applied or already current. No credentials printed.');
}
