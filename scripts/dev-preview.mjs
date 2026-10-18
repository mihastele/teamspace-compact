import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const providerKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'NEXT_PUBLIC_FIREBASE_APP_ID',
  'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL', 'SUPABASE_INTERNAL_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET',
];

export function previewLaunch(args = [], inherited = process.env) {
  const port = args[0] ?? '3107';
  if (args.length > 1 || !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
    throw new Error('Usage: npm run dev:preview -- [port between 1024 and 65535]');
  }
  // Empty inherited values take precedence over Next's .env files, without editing them.
  const env = { ...inherited };
  for (const key of new Set([...providerKeys, ...Object.keys(env).filter(key => /^(FIREBASE_|SUPABASE_|NEXT_PUBLIC_FIREBASE_|NEXT_PUBLIC_SUPABASE_|AGENT_)/.test(key))])) env[key] = '';
  Object.assign(env, {
    BACKEND_PROVIDER: 'firebase', NEXT_PUBLIC_BACKEND_PROVIDER: 'firebase',
    ROOT_ADMIN_UIDS: '', DEV_AUTO_JOIN_WORKSPACE_ID: '', AGENT_ENABLED: 'false',
    NODE_ENV: 'development', PORT: String(Number(port)),
  });
  return {
    command: process.execPath,
    args: [resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', env.PORT],
    options: { cwd: root, env, stdio: 'inherit', windowsHide: true },
    url: `http://127.0.0.1:${env.PORT}`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const launch = previewLaunch(process.argv.slice(2));
    console.log(`Local preview: ${launch.url} — browser-only data, no connected backend. Stop with Ctrl+C.`);
    const child = spawn(launch.command, launch.args, launch.options);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('Could not start Next.js. Run npm ci first.'); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
