const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const loader = Module._load;
Module._load = function (id, ...args) { return id === 'server-only' ? {} : loader.call(this, id, ...args); };
const { createAgentQueue, agentRetentionDays } = require('../.test-build/server/agent-queue.js');
Module._load = loader;
const actor = { uid: randomUUID(), email_verified: true };
const stamp = '2026-10-17T10:00:00Z';
const row = () => ({ id: randomUUID(), workspace_id: 'alpha', initiator_id: actor.uid, status: 'queued', prompt: 'Fixture prompt', context: {}, result: null,
  error_code: null, attempts: 0, version: 1, last_sequence: 1, created_at: stamp, updated_at: stamp, expires_at: '2026-11-16T10:00:00Z' });

test('agent audit retention defaults to 30 days with bounded strict configuration', () => {
  assert.equal(agentRetentionDays({}), 30); assert.equal(agentRetentionDays({ AGENT_AUDIT_RETENTION_DAYS: '1' }), 1);
  assert.equal(agentRetentionDays({ AGENT_AUDIT_RETENTION_DAYS: '365' }), 365);
  for (const value of ['', '0', '366', '-1', '30.5', '3e1', 'Infinity', 'true']) assert.throws(() => agentRetentionDays({ AGENT_AUDIT_RETENTION_DAYS: value }), error => error.code === 'agent_configuration');
  assert.throws(() => createAgentQueue(async () => ({}), 'true'), error => error.code === 'agent_configuration');
});

test('agent queue request authority/retention is server-held and unknown create fields fail before RPC', async () => {
  let captured, count = 0;
  const q = createAgentQueue(async (name, input) => { captured = { name, input }; count++; return { run: row(), replayed: false }; }, true, 7);
  const operationId = randomUUID();
  await q.create('alpha', actor, { operationId, prompt: '  Summarize  ', context: { noteId: 'note' } });
  assert.deepEqual(captured, { name: 'teamspace_agent_queue', input: { p_action: 'create', p_input: { workspace: 'alpha', uid: actor.uid, verified: true, operationId, prompt: 'Summarize', context: { noteId: 'note' }, retentionDays: 7, required: true } } });
  for (const change of [{ uid: 'other' }, { required: false }, { retentionDays: 365 }, { context: { noteId: '../foreign' } }, { operationId: 'bad' }, { prompt: '' }]) {
    await assert.rejects(q.create('alpha', actor, { operationId, prompt: 'Fixture', ...change }), error => error.code === 'invalid_input');
  }
  assert.equal(count, 1);
});

test('agent queue ordinary DTOs select public fields and exclude lease/worker/checkpoint state', async () => {
  const run = { ...row(), lease_token: randomUUID(), checkpoint: { version: 1, private: 'internal' }, worker_id: 'worker', event_bytes: 1000 };
  const q = createAgentQueue(async () => ({ run, replayed: true }), true);
  const result = await q.create('alpha', actor, { operationId: randomUUID(), prompt: 'Fixture' });
  assert.equal(result.replayed, true);
  for (const key of ['lease_token', 'checkpoint', 'worker_id', 'event_bytes']) assert.equal(Object.hasOwn(result.run, key), false);
});

test('agent queue known errors use stable codes and transport/unknown errors do not expose database details', async () => {
  for (const [code, status] of [['lease_lost', 409], ['version_conflict', 409], ['expired', 410], ['forbidden', 403], ['policy_mismatch', 503], ['queue_full', 429]]) {
    const q = createAgentQueue(async () => ({ error: code }), true);
    await assert.rejects(q.list('alpha', actor), error => error.code === code && error.status === status);
  }
  for (const rpc of [async () => { throw new Error('private DB connection and prompt'); }, async () => ({ error: 'private DB details' }), async () => null, async () => ({ run: { ...row(), status: 'unrecognized' } })]) {
    const q = createAgentQueue(rpc, true);
    await assert.rejects(q.create('alpha', actor, { operationId: randomUUID(), prompt: 'Fixture' }), error => error.code === 'agent_queue_unavailable' && !error.message.includes('private') && !error.cause);
  }
});

test('agent queue event and receipt DTOs reject malformed rows and drop unselected response metadata', async () => {
  const record = row(), operationId = randomUUID();
  const q = createAgentQueue(async (_, input) => input.p_action === 'read' ? { run: record, events: [{ run_id: record.id, sequence: 1, kind: 'queued', payload: {}, created_at: stamp, lease_token: 'must-not-leak' }] }
    : { requests: [{ initiator_id: actor.uid, operation_id: operationId, run_id: record.id, digest: 'a'.repeat(64), created_at: stamp, internal: 'must-not-leak' }] }, true);
  assert.equal((await q.read('alpha', actor, record.id)).events[0].lease_token, undefined);
  assert.equal((await q.exportRequests('alpha', actor)).requests[0].internal, undefined);
  const malformed = createAgentQueue(async () => ({ run: record, events: [{ sequence: 0, kind: 'queued', payload: {} }] }), true);
  await assert.rejects(malformed.read('alpha', actor, record.id), error => error.code === 'agent_queue_unavailable');
});

test('agent queue validates checkpoints before transport and never sends a caller-supplied fence override', async () => {
  let count = 0, sent;
  const q = createAgentQueue(async (_, value) => { count++; sent = value.p_input; return { run: row() }; }, true);
  const lease = { id: randomUUID(), lease_token: randomUUID(), worker_id: 'worker', version: 3 };
  await assert.rejects(q.save(lease, { status: 'running', kind: 'model_request', checkpoint: { version: 2 }, payload: {} }), error => error.code === 'invalid_input');
  await assert.rejects(q.save(lease, { status: 'running', kind: 'model_request', checkpoint: { version: 1, text: 'x'.repeat(512000) }, payload: {} }), error => error.code === 'invalid_input');
  await assert.rejects(q.save(lease, { status: 'running', kind: 'model_request', checkpoint: { version: 1 }, payload: {}, token: randomUUID() }), error => error.code === 'invalid_input');
  assert.equal(count, 0);
  await q.save(lease, { status: 'running', kind: 'model_request', checkpoint: { version: 1, phase: 'model' }, payload: {} });
  assert.equal(sent.token, lease.lease_token); assert.equal(sent.version, 3); assert.equal(sent.required, true);
});
