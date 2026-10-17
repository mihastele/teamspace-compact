import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';

test('built Next server advertises PUT and routes field saves to the guarded API', { timeout: 60000 }, async () => {
  const entry = resolve('.next/standalone/server.js');
  await access(entry); // Run after npm run build; missing output is a failure, never a skip.
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NEXT_PUBLIC_|FIREBASE_|SUPABASE_)/.test(key)) delete env[key];
  }
  Object.assign(env, {
    PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production',
    BACKEND_PROVIDER: 'firebase', NEXT_PUBLIC_BACKEND_PROVIDER: 'firebase',
    ROOT_ADMIN_UIDS: '', DEV_AUTO_JOIN_WORKSPACE_ID: '',
    EMAIL_CONFIRMATION_REQUIRED: 'true', PASSWORD_AUTH_ENABLED: 'true', GOOGLE_AUTH_ENABLED: 'false',
  });
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '', startError;
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
  child.on('error', error => { startError = error; });
  const exited = new Promise(resolve => child.once('close', resolve));
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    const deadline = Date.now() + 35000;
    for (let attempt = 0; attempt < 100 && Date.now() < deadline; attempt++) {
      if (startError) throw startError;
      if (child.exitCode !== null) throw new Error(`Preview exited before readiness: ${output}`);
      try {
        const response = await fetch(`${origin}/api/config`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200 || response.status === 503) { ready = true; break; }
      } catch { /* Initial connection refusal is expected before listen. */ }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.ok(ready, `Built API failed readiness: ${output}`);
    const url = `${origin}/api/workspaces/route-fixture/boardProperties/00000000-0000-4000-8000-000000000000`;
    const options = await fetch(url, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.ok(options.headers.get('allow')?.split(/,\s*/).includes('PUT'));
    const put = await fetch(url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Route smoke', type: 'text', options: [], expectedRevision: 0 }),
    });
    assert.equal(put.status, 503, 'PUT must reach guarded application code instead of returning framework 405');
    const payload = await put.json();
    assert.ok(['not_configured', 'invalid_configuration'].includes(payload.error?.code));
    assert.equal(put.headers.get('cache-control'), 'no-store');
  } finally {
    child.kill();
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await exited; } finally { clearTimeout(timer); }
  }
});
