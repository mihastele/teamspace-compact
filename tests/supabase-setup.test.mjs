import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createSupabaseEnvironment } from '../scripts/supabase-env.mjs';

const template = readFileSync(new URL('../.env.supabase.example', import.meta.url), 'utf8');
const parse = (source) => Object.fromEntries(source.split(/\r?\n/)
  .filter((line) => /^[A-Z_0-9]+=/.test(line)).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));

test('self-hosted keys are fresh, aligned and correctly signed; example has no credentials', () => {
  const example = parse(template);
  for (const key of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY', 'DASHBOARD_PASSWORD', 'SMTP_PASS', 'GOOGLE_SECRET']) {
    assert.equal(example[key], '', key);
  }
  const first = parse(createSupabaseEnvironment(template, 100));
  const second = parse(createSupabaseEnvironment(template, 100));
  assert.notEqual(first.JWT_SECRET, second.JWT_SECRET);
  assert.notEqual(first.POSTGRES_PASSWORD, second.POSTGRES_PASSWORD);
  assert.equal(first.NEXT_PUBLIC_SUPABASE_ANON_KEY, first.ANON_KEY);
  assert.equal(first.SUPABASE_SERVICE_ROLE_KEY, first.SERVICE_ROLE_KEY);
  assert.equal(first.REALTIME_DB_ENC_KEY.length, 16);
  assert.equal(first.VAULT_ENC_KEY.length, 32);
  assert.equal(Buffer.from(first.SECRET_KEY_BASE, 'base64').length, 48);
  for (const [key, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    const [header, payload, signature] = first[key].split('.');
    assert.equal(signature, createHmac('sha256', first.JWT_SECRET).update(`${header}.${payload}`).digest('base64url'));
    assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), {
      role, iss: 'supabase', iat: 100, exp: 100 + 5 * 365 * 24 * 60 * 60,
    });
  }
  assert.equal(first.EMAIL_CONFIRMATION_REQUIRED, 'true');
  assert.equal(first.GOOGLE_AUTH_ENABLED, 'false');
});
