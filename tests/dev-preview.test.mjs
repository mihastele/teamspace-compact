import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewLaunch } from '../scripts/dev-preview.mjs';

test('preview isolates inherited provider settings without modifying the caller environment', () => {
  const inherited = { PATH: 'tools', BACKEND_PROVIDER: 'supabase', NEXT_PUBLIC_BACKEND_PROVIDER: 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-private',
    FIREBASE_PRIVATE_KEY: 'fixture-private', AGENT_MODEL: 'fixture-model', ROOT_ADMIN_UIDS: 'fixture-admin' };
  const before = structuredClone(inherited);
  const launch = previewLaunch([], inherited);
  assert.deepEqual(inherited, before);
  assert.equal(launch.url, 'http://127.0.0.1:3107');
  assert.deepEqual(launch.args.slice(-5), ['dev', '--hostname', '127.0.0.1', '--port', '3107']);
  assert.equal(launch.options.env.PATH, 'tools');
  assert.equal(launch.options.env.NEXT_PUBLIC_BACKEND_PROVIDER, 'firebase');
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_PRIVATE_KEY',
    'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_APP_ID', 'AGENT_MODEL', 'ROOT_ADMIN_UIDS', 'DEV_AUTO_JOIN_WORKSPACE_ID']) {
    assert.equal(launch.options.env[key], '', key);
  }
  assert.equal(launch.options.env.AGENT_ENABLED, 'false');
});

test('preview accepts an explicit local port and rejects unknown options without starting processes', () => {
  assert.equal(previewLaunch(['3200'], {}).url, 'http://127.0.0.1:3200');
  for (const args of [['0'], ['80'], ['65536'], ['NaN'], ['3107', '--hostname', '0.0.0.0'], ['--help']]) {
    assert.throws(() => previewLaunch(args, {}), /Usage:/);
  }
});
