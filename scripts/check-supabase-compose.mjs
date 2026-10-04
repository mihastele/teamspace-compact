import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSupabaseEnvironment } from './supabase-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(resolve(tmpdir(), 'teamspace-compose-'));
try {
  const environment = resolve(temporary, 'test.env');
  writeFileSync(environment, createSupabaseEnvironment(readFileSync(resolve(root, '.env.supabase.example'), 'utf8')),
    { mode: 0o600 });
  const result = spawnSync('docker', ['compose', '--env-file', environment,
    '-f', 'docker.compose.supabase.yml', 'config', '--format', 'json'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, SUPABASE_COMPOSE_ENV_FILE: environment, PORT: '8088', WEB_BIND_ADDRESS: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Never print resolved Compose configuration: it contains service credentials.
  if (result.error || result.status !== 0) {
    console.error('Supabase Compose validation failed. Prepare the pinned source and use Docker Compose 2.24.4+.');
    process.exitCode = 1;
  } else {
    const configuration = JSON.parse(result.stdout);
    const web = configuration.services.web;
    const port = web?.ports?.find(value => value.target === 3000);
    if (!port || String(port.published) !== '8088' || port.host_ip !== '127.0.0.1'
      || web.environment.SUPABASE_INTERNAL_URL !== 'http://api-gw:8000'
      || web.environment.DEV_AUTO_JOIN_WORKSPACE_ID !== ''
      || Object.keys(web.build.args).some(key => !key.startsWith('NEXT_PUBLIC_'))) {
      console.error('Website port, private transport, production configuration or build arguments failed validation.');
      process.exitCode = 1;
    } else console.log('Pinned Supabase Compose and custom website PORT are valid. No services started.');
  }
} finally {
  // This freshly created temporary directory contains only this script's test credentials.
  rmSync(temporary, { recursive: true, force: true });
}
