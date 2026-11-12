import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { applicationMigrations, migrationSQL } from '../scripts/migrate-supabase.mjs';

const directory = new URL('../migrations/', import.meta.url);
const files = readdirSync(directory).filter((name) => /^\d{3}-.*\.sql$/.test(name) && !name.startsWith('000-'));

test('generated migration chain creates every application table at most once', () => {
  const script = migrationSQL();
  const created = [...script.matchAll(/create table (?!if not exists )public\.([a-z0-9_]+)/gi)]
    .map((match) => match[1].toLowerCase());
  const duplicates = [...new Set(created.filter((name, index) => created.indexOf(name) !== index))];
  // A second CREATE TABLE aborts the whole run at ON_ERROR_STOP, so no later
  // migration is applied: every fresh installation would be blocked.
  assert.deepEqual(duplicates, [], `Duplicate CREATE TABLE targets: ${duplicates.join(', ')}`);
});

test('registered application migrations are unique, ordered and match the files on disk', () => {
  assert.equal(new Set(applicationMigrations).size, applicationMigrations.length, 'A migration is registered more than once.');
  const prefixes = applicationMigrations.map((name) => Number(name.slice(0, 3)));
  assert.deepEqual(prefixes, [...prefixes].sort((a, b) => a - b), 'Migrations must be registered in numeric order.');
  for (const name of applicationMigrations) assert.ok(files.includes(name), `${name} is registered but missing from migrations/.`);
  for (const name of files) assert.ok(applicationMigrations.includes(name), `${name} exists but is not registered in the deployment runner.`);
});
