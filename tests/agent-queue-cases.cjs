const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = (test, { db, rpc, sql, member, owner, outsider, prefix, createAgentQueue }) => {
  const actor = uid => ({ uid, email_verified: true });
  const queue = (days = 30, required = true) => createAgentQueue(rpc, required, days);
  const create = (client = queue(), uid = member, extra = {}) => client.create('alpha', actor(uid), { operationId: randomUUID(), prompt: 'Summarize current tickets.', ...extra });
  const rejection = (work, code) => assert.rejects(work, error => error.code === code);
  const save = (client, run, extra = {}) => client.save(run, { status: 'running', kind: 'model_request', checkpoint: { version: 1, phase: 'model' }, payload: { messages: [{ role: 'user', content: 'Private fixture' }] }, ...extra });
  const expireLease = id => sql(`update public.teamspace_agent_runs set lease_until=clock_timestamp()-interval '1 second' where id='${id}';`);

  test('agent queue creates once under concurrent replay, binds payload and preserves the document epoch', async () => {
    const q = queue(), operationId = randomUUID(), input = { operationId, prompt: 'Read note', context: { noteId: 'note' } };
    const epoch = await sql('select epoch from public.teamspace_store_state;');
    const [a, b] = await Promise.all([q.create('alpha', actor(member), input), q.create('alpha', actor(member), input)]);
    assert.equal(a.run.id, b.run.id); assert.deepEqual([a.replayed, b.replayed].sort(), [false, true]);
    assert.equal(await sql('select count(*) from public.teamspace_agent_runs;'), '1');
    assert.equal(await sql('select count(*) from public.teamspace_agent_events;'), '1');
    assert.equal(await sql('select epoch from public.teamspace_store_state;'), epoch);
    assert.ok(Math.abs(Date.parse(a.run.expires_at) - Date.parse(a.run.created_at) - 30 * 86400000) < 1000);
    await rejection(() => q.create('alpha', actor(member), { ...input, prompt: 'Changed' }), 'operation_conflict');
    await rejection(() => create(q, member, { context: { noteId: 'foreign' } }), 'invalid_context');
    await q.cancel('alpha', actor(member), a.run.id);
    assert.equal((await q.create('alpha', actor(member), input)).run.status, 'cancelled');
  });

  test('agent queue private access and every new table enforce RLS and deny SDK writes/helper execution', async () => {
    const q = queue(), { run } = await create(q);
    await db().runTransaction(async tx => tx.set(db().doc(`${prefix}/members/${outsider}`), { role: 'member', displayName: 'Other' }));
    await sql(`update auth.users set email_confirmed_at=now() where id='${outsider}';`);
    await rejection(() => q.read('alpha', actor(outsider), run.id), 'not_found');
    assert.deepEqual(await q.list('alpha', actor(outsider)), []);
    assert.equal((await q.export('alpha', actor(owner), run.id)).run.prompt, run.prompt);
    for (const [uid, count] of [[member, '1'], [owner, '1'], [outsider, '0']]) {
      const query = `set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);`;
      assert.equal((await sql(query + 'select count(id) from public.teamspace_agent_runs;')).split('\n').at(-1), count);
      assert.equal((await sql(query + 'select count(*) from public.teamspace_agent_events;')).split('\n').at(-1), count);
    }
    for (const table of ['teamspace_agent_runs', 'teamspace_agent_events', 'teamspace_agent_requests']) {
      assert.equal(await sql(`select relrowsecurity from pg_class where relname='${table}';`), 't');
      for (const role of ['authenticated', 'service_role']) await assert.rejects(sql(`set role ${role};delete from public.${table};`), /permission denied/);
    }
    await assert.rejects(sql('set role authenticated;select lease_token,checkpoint from public.teamspace_agent_runs;'), /permission denied/);
    await assert.rejects(sql('set role authenticated;select * from public.teamspace_agent_requests;'), /permission denied/);
    for (const role of ['authenticated', 'anon']) await assert.rejects(sql(`set role ${role};select public.teamspace_agent_queue('prune','{}');`), /permission denied/);
    await assert.rejects(sql(`set role service_role;select public.teamspace_agent_event('${run.id}','completed','{}');`), /permission denied/);
    await db().runTransaction(async tx => tx.update(db().doc(`${prefix}/members/${outsider}`), { role: 'admin' }));
    assert.equal((await q.export('alpha', actor(outsider), run.id)).run.id, run.id);
    await sql(`update auth.users set email_confirmed_at=null where id='${member}';`);
    assert.equal((await sql(`set role authenticated;select set_config('request.jwt.claim.sub','${member}',false);select count(id) from public.teamspace_agent_runs;`)).split('\n').at(-1), '0');
  });

  test('agent queue claims distinct leases, saves audit/checkpoint atomically and exports without lease secrets', async () => {
    const q = queue(); await create(q); await create(q);
    const [a, b] = await Promise.all([q.claim('worker_a'), q.claim('worker_b')]);
    assert.notEqual(a.id, b.id); assert.equal(a.attempts, 1);
    const updated = await save(q, a);
    assert.equal(updated.version, a.version + 1); assert.equal(updated.last_sequence, 3);
    await rejection(() => save(q, a), 'version_conflict');
    await q.heartbeat(a); // Heartbeat does not race the checkpoint's CAS version.
    const done = await save(q, { ...a, version: updated.version }, { status: 'completed', kind: 'completed', checkpoint: { version: 1, phase: 'finished' }, payload: { output: 'Visible answer' }, result: { content: 'Visible answer' } });
    assert.equal(done.status, 'completed'); assert.equal(done.last_sequence, 4);
    await rejection(() => q.heartbeat(a), 'lease_lost');
    const read = await q.read('alpha', actor(member), a.id), exported = await q.export('alpha', actor(member), a.id);
    assert.deepEqual(read.events.map(row => row.kind), ['queued', 'claimed', 'model_request', 'completed']);
    assert.equal(read.run.checkpoint, undefined); assert.equal(read.run.lease_token, undefined); assert.equal(exported.run.lease_token, undefined);
    assert.equal(exported.checkpoint.phase, 'finished'); assert.equal(exported.formatVersion, 1);
  });

  test('agent queue replaces expired leases and fences stale output and cancellation races', async () => {
    const q = queue(); const { run } = await create(q);
    const old = await q.claim('old_worker');
    const updated = await save(q, old);
    await expireLease(run.id);
    const current = await q.claim('new_worker');
    assert.notEqual(current.lease_token, old.lease_token); assert.equal(current.attempts, 2); assert.equal(current.checkpoint.phase, 'model');
    await rejection(() => q.heartbeat(old), 'lease_lost');
    await rejection(() => save(q, { ...old, version: updated.version }), 'lease_lost');
    await q.cancel('alpha', actor(owner), run.id);
    await rejection(() => save(q, current, { status: 'completed', kind: 'completed', result: { content: 'Too late' } }), 'lease_lost');
    const read = await q.read('alpha', actor(member), run.id);
    assert.equal(read.run.status, 'cancelled'); assert.equal(read.run.result, null);
    assert.equal(read.events.some(event => event.kind === 'lease_expired' && event.payload.readMayRepeat), true);
  });

  test('agent queue bounds retries, preserves checkpoint and eventually terminally fails crashed workers', async () => {
    const q = queue(); const { run } = await create(q);
    const first = await q.claim('worker');
    await save(q, first, { status: 'retrying', kind: 'retrying', errorCode: 'agent_timeout' });
    assert.equal(await q.claim('worker'), null);
    await sql(`update public.teamspace_agent_runs set available_at=clock_timestamp()-interval '1 second' where id='${run.id}';`);
    const second = await q.claim('worker'); assert.equal(second.attempts, 2); assert.equal(second.checkpoint.phase, 'model');
    await expireLease(run.id); assert.equal((await q.claim('worker')).attempts, 3);
    await expireLease(run.id); assert.equal(await q.claim('worker'), null);
    const read = await q.read('alpha', actor(member), run.id);
    assert.equal(read.run.status, 'failed'); assert.equal(read.run.error_code, 'lease_exhausted'); assert.equal(read.run.attempts, 3);
  });

  test('agent queue rechecks account state, membership and published policy on claim/heartbeat/checkpoint', async () => {
    const q = queue();
    for (const assignment of ["banned_until='2999-01-01'", 'is_anonymous=true', 'deleted_at=now()', 'email_confirmed_at=null']) {
      await sql(`update auth.users set banned_until=null,is_anonymous=false,deleted_at=null,email_confirmed_at=now() where id='${member}';`);
      const { run } = await create(q);
      await sql(`update auth.users set ${assignment} where id='${member}';`);
      assert.equal(await q.claim('worker'), null);
      assert.equal((await q.read('alpha', actor(owner), run.id)).run.error_code, 'access_revoked');
    }
    await sql(`update auth.users set banned_until=null,is_anonymous=false,deleted_at=null,email_confirmed_at=now() where id='${member}';`);
    const { run } = await create(q);
    await rejection(() => queue(30, false).claim('worker'), 'policy_mismatch');
    assert.equal((await q.read('alpha', actor(member), run.id)).run.status, 'queued');
    const lease = await q.claim('worker');
    await sql(`delete from public.teamspace_documents where path='${prefix}/members/${member}';`);
    await rejection(() => q.heartbeat(lease), 'forbidden'); await rejection(() => save(q, lease), 'forbidden');
    await rejection(() => q.export('alpha', actor(member), run.id), 'forbidden');
    assert.equal((await q.read('alpha', actor(owner), run.id)).run.last_sequence, 2);
  });

  test('agent queue expiry hides content, prunes it, retains exportable retry receipts and prevents resurrection', async () => {
    const q = queue(7), operationId = randomUUID(), input = { operationId, prompt: 'Expire this private fixture' };
    const { run } = await q.create('alpha', actor(member), input);
    assert.ok(Math.abs(Date.parse(run.expires_at) - Date.parse(run.created_at) - 7 * 86400000) < 1000);
    await sql(`update public.teamspace_agent_runs set expires_at=clock_timestamp()-interval '1 second' where id='${run.id}';`);
    await rejection(() => q.read('alpha', actor(owner), run.id), 'not_found');
    assert.deepEqual(await q.list('alpha', actor(member)), []);
    assert.equal((await sql(`set role authenticated;select set_config('request.jwt.claim.sub','${member}',false);select count(id) from public.teamspace_agent_runs;`)).split('\n').at(-1), '0');
    await rejection(() => q.create('alpha', actor(member), input), 'expired');
    assert.equal((await q.prune()).deleted, 1);
    assert.equal(await sql('select count(*) from public.teamspace_agent_events;'), '0');
    await rejection(() => q.create('alpha', actor(member), input), 'expired');
    const exported = await q.exportRequests('alpha', actor(member));
    assert.equal(exported.requests[0].operation_id, operationId); assert.equal(exported.requests[0].prompt, undefined);
    assert.equal((await q.exportRequests('alpha', actor(owner))).requests.length, 1);
    await db().runTransaction(async tx => tx.delete(db().doc(prefix)));
    assert.equal(await sql('select count(*) from public.teamspace_agent_requests;'), '0');
  });

  test('agent queue serializes per-user capacity and throttles accepted creation requests', async () => {
    const q = queue();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => create(q)));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 5);
    assert.equal(results.filter(row => row.status === 'rejected' && row.reason.code === 'queue_full').length, 3);
    for (const row of results) if (row.status === 'fulfilled') await q.cancel('alpha', actor(member), row.value.run.id);
    for (let i = 0; i < 5; i++) { const { run } = await create(q); await q.cancel('alpha', actor(member), run.id); }
    // Keep the fixture in the same quota window even on a minute boundary.
    await sql('update public.teamspace_agent_requests set created_at=clock_timestamp();');
    await rejection(() => create(q), 'rate_limited');
  });

  test('agent queue rejects malformed/budget-exhausted checkpoints without a partial audit commit', async () => {
    const q = queue(); await create(q); const lease = await q.claim('worker');
    const response = await rpc('teamspace_agent_queue', { p_action: 'checkpoint', p_input: { id: lease.id, token: lease.lease_token, worker: lease.worker_id, required: true,
      version: lease.version, checkpoint: { version: 1 }, status: 'running', kind: 'model_request', payload: { text: 'x'.repeat(300001) } } });
    assert.equal(response.error, 'invalid_input');
    assert.equal((await q.read('alpha', actor(member), lease.id)).run.last_sequence, 2);
    await sql(`update public.teamspace_agent_runs set last_sequence=180 where id='${lease.id}';`);
    await rejection(() => save(q, lease), 'audit_limit');
    assert.equal((await q.cancel('alpha', actor(member), lease.id)).status, 'cancelled');
  });

  test('agent queue enforces workspace-wide capacity across different initiators', async () => {
    const ids = [member, owner, randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids.slice(2)) await sql(`insert into auth.users(id,email_confirmed_at) values('${id}',now());`);
    await db().runTransaction(async tx => {
      for (const id of ids.slice(2)) tx.set(db().doc(`${prefix}/members/${id}`), { role: 'member', displayName: 'Capacity fixture' });
    });
    const make = uid => `public.teamspace_agent_queue('create',jsonb_build_object('workspace','alpha','uid','${uid}','required',true,'verified',true,'retentionDays',30,'prompt','Capacity fixture','operationId',gen_random_uuid()))`;
    for (const id of ids.slice(0, 4)) {
      const results = (await sql(`set role service_role;select ${make(id)}->>'error' is null from generate_series(1,5);`)).split('\n');
      assert.deepEqual(results, ['t', 't', 't', 't', 't']);
    }
    assert.equal(await sql(`set role service_role;select ${make(ids[4])}->>'error';`), 'queue_full');
    assert.equal(await sql('select count(*) from public.teamspace_agent_runs;'), '20');
  });

  test('agent queue workspace deletion races cannot resurrect a run or deadlock checkpoint locks', async () => {
    const q = queue(); await create(q); const lease = await q.claim('worker');
    const results = await Promise.allSettled([save(q, lease), db().runTransaction(async tx => tx.delete(db().doc(prefix)))]);
    assert.equal(results[1].status, 'fulfilled');
    if (results[0].status === 'rejected') assert.equal(results[0].reason.code, 'not_found');
    for (const table of ['teamspace_agent_runs', 'teamspace_agent_events', 'teamspace_agent_requests']) assert.equal(await sql(`select count(*) from public.${table};`), '0');
    await rejection(() => save(q, lease), 'not_found');
  });

  test('agent queue minimal-receipt export uses bounded keysets and keeps other initiators private', async () => {
    const q = queue();
    await sql(`insert into public.teamspace_agent_requests(workspace_id,initiator_id,operation_id,digest,run_id)
      select 'alpha','${member}',gen_random_uuid(),repeat('a',64),gen_random_uuid() from generate_series(1,501);`);
    const first = await q.exportRequests('alpha', actor(member)); assert.equal(first.requests.length, 500); assert.ok(first.nextCursor);
    const last = await q.exportRequests('alpha', actor(member), first.nextCursor); assert.equal(last.requests.length, 1); assert.equal(last.nextCursor, null);
    assert.equal(new Set([...first.requests, ...last.requests].map(row => row.operation_id)).size, 501);
  });
};
