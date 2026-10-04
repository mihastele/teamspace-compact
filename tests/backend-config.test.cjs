const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backendConfiguration, strictFlag } = require('../.test-build/server/backend-config.js');
const { isPrivilegedSupabaseKey } = require('../.test-build/public-key.js');
const { accessConfiguration, isRootAdmin } = require('../.test-build/server/access-config.js');

test('root authority is an exact server ID allowlist; auto-join is forbidden outside development',()=>{
  const names=['ROOT_ADMIN_UIDS','DEV_AUTO_JOIN_WORKSPACE_ID','NODE_ENV'];
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try {
    names.forEach(name=>delete process.env[name]);
    assert.equal(isRootAdmin('owner'),false);
    process.env.ROOT_ADMIN_UIDS=' root-a,root-b ';
    assert.equal(isRootAdmin('root-a'),true);assert.equal(isRootAdmin('root'),false);
    process.env.ROOT_ADMIN_UIDS='root-a,';assert.throws(()=>accessConfiguration(),/comma-separated/);
    process.env.ROOT_ADMIN_UIDS='root-a';process.env.DEV_AUTO_JOIN_WORKSPACE_ID='test-space';
    for(const mode of ['production','test']){process.env.NODE_ENV=mode;assert.throws(()=>accessConfiguration(),/only in development/);}
    process.env.NODE_ENV='development';assert.equal(accessConfiguration().developmentWorkspace,'test-space');
    process.env.DEV_AUTO_JOIN_WORKSPACE_ID='../escape';assert.throws(()=>accessConfiguration(),/valid workspace/);
  } finally {for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
test('backend selection and security flags are explicit and fail closed', () => {
  const names = ['BACKEND_PROVIDER', 'NEXT_PUBLIC_BACKEND_PROVIDER', 'EMAIL_CONFIRMATION_REQUIRED',
    'GOOGLE_AUTH_ENABLED', 'PASSWORD_AUTH_ENABLED', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.equal(backendConfiguration().provider, 'firebase');
    assert.equal(backendConfiguration().emailConfirmationRequired, true);
    process.env.EMAIL_CONFIRMATION_REQUIRED = 'false';
    assert.equal(backendConfiguration().emailConfirmationRequired, false);
    for (const invalid of ['False', '0', 'yes', ' true ']) {
      process.env.EMAIL_CONFIRMATION_REQUIRED = invalid;
      assert.throws(() => backendConfiguration(), /must be true or false/);
    }
    process.env.EMAIL_CONFIRMATION_REQUIRED = 'true';
    process.env.BACKEND_PROVIDER = 'supabase';
    assert.throws(() => backendConfiguration(), /selections must match/);
    process.env.NEXT_PUBLIC_BACKEND_PROVIDER = 'supabase';
    process.env.SUPABASE_URL = 'https://one.test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://two.test';
    assert.throws(() => backendConfiguration(), /projects must match/);
    process.env.BACKEND_PROVIDER = process.env.NEXT_PUBLIC_BACKEND_PROVIDER = 'unknown';
    assert.throws(() => backendConfiguration(), /Unsupported/);
    assert.equal(strictFlag('UNSET_TEST_FLAG', false), false);
  } finally { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } }
});
test('privileged Supabase keys are rejected before browser bundling', () => {
  const jwt = role => ['header',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');
  assert.equal(isPrivilegedSupabaseKey(jwt('service_role')),true);
  assert.equal(isPrivilegedSupabaseKey('sb_secret_test'),true);
  assert.equal(isPrivilegedSupabaseKey(jwt('anon')),false);
  assert.equal(isPrivilegedSupabaseKey('sb_publishable_test'),false);
  assert.equal(isPrivilegedSupabaseKey('malformed-public-test'),false);
});
