import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fresh legacy HS256 keys supported by the pinned official self-hosted stack. */
export function createSupabaseEnvironment(template, seconds = Math.floor(Date.now() / 1000)) {
  const secret = randomBytes(32).toString('base64url');
  const token = (role) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: seconds,
      exp: seconds + 5 * 365 * 24 * 60 * 60 })).toString('base64url');
    const message = `${header}.${payload}`;
    return `${message}.${createHmac('sha256', secret).update(message).digest('base64url')}`;
  };
  const anon = token('anon');
  const service = token('service_role');
  const values = {
    JWT_SECRET: secret, ANON_KEY: anon, SERVICE_ROLE_KEY: service,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service,
    POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
    DASHBOARD_PASSWORD: 'admin' + randomBytes(24).toString('hex'),
    SECRET_KEY_BASE: randomBytes(48).toString('base64'),
    REALTIME_DB_ENC_KEY: randomBytes(8).toString('hex'),
    VAULT_ENC_KEY: randomBytes(16).toString('hex'),
    PG_META_CRYPTO_KEY: randomBytes(24).toString('base64'),
    S3_PROTOCOL_ACCESS_KEY_ID: randomBytes(16).toString('hex'),
    S3_PROTOCOL_ACCESS_KEY_SECRET: randomBytes(32).toString('hex'),
  };
  return template.replace(/^([A-Z_0-9]+)=.*$/gm, (line, key) =>
    Object.hasOwn(values, key) ? `${key}=${values[key]}` : line);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = resolve(root, '.env.supabase');
  // Exclusive creation prevents accidental key rotation or overwriting an admin's settings.
  const template = readFileSync(resolve(root, '.env.supabase.example'), 'utf8');
  writeFileSync(output, createSupabaseEnvironment(template), { flag: 'wx', mode: 0o600 });
  console.log('Fresh credentials saved to .env.supabase (gitignored). Existing files are never overwritten.');
  console.log('Configure email delivery and production URLs before launch. No secrets were printed.');
}
