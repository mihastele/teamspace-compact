import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Official source includes all required SQL, gateway and Storage configuration.
// Pin both tag and commit; never accept a moved upstream tag silently.
export const SUPABASE_TAG = 'self-hosted/v0.8.2';
export const SUPABASE_COMMIT = '564eab8ad7840b13324f68b1bfac074ef8d51c21';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkout = resolve(root, '.supabase/upstream');

function git(args, capture = false) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error('Could not prepare the pinned Supabase source. Check Git and network access.');
  }
  return result.stdout?.trim();
}

if (!existsSync(checkout)) {
  mkdirSync(resolve(root, '.supabase'), { recursive: true });
  git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', SUPABASE_TAG,
    'https://github.com/supabase/supabase.git', checkout]);
}
if (git(['-C', checkout, 'rev-parse', 'HEAD'], true) !== SUPABASE_COMMIT) {
  throw new Error('Supabase checkout does not match the pinned commit. No files were replaced.');
}
git(['-C', checkout, 'sparse-checkout', 'set', 'docker']);
if (!existsSync(resolve(checkout, 'docker/volumes/db/roles.sql'))) {
  throw new Error('Supabase database initialization files are missing.');
}
console.log('Pinned Supabase configuration prepared in .supabase/upstream (gitignored).');
console.log('Configure .env.supabase before starting. No credentials were generated or printed.');
