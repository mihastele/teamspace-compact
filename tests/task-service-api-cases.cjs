const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');

module.exports = function taskServiceCases(test, { api, member, outsider, owner, prefix, read }) {
  test('task detail service returns saved fields/audit metadata and rejects foreign, missing and deleted tasks', async () => {
    const created = await api(member, 'POST', `${prefix}/tasks`, {
      title: 'Service boundary', description: 'Shared ticket data', status: 'todo',
      assigneeId: member, dueDate: '2026-10-20',
    });
    assert.equal(created.status, 201);
    const path = `${prefix}/tasks/${created.data.task.id}`;
    const detail = await api(member, 'GET', path);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.task.title, 'Service boundary');
    assert.equal(detail.data.task.assigneeId, member);
    assert.equal(detail.data.task.createdBy, member);
    assert.ok(Number.isSafeInteger(detail.data.task.createdAt));
    assert.ok(Number.isSafeInteger(detail.data.task.updatedAt));
    assert.deepEqual(detail.data.task.propertyValues, {});
    assert.equal((await api(outsider, 'GET', path)).status, 403);
    assert.equal((await api(member, 'GET', `${prefix}/tasks/no-such-task`)).status, 404);
    assert.equal((await api(member, 'DELETE', path)).status, 200);
    assert.equal((await api(member, 'GET', path)).status, 404);
    assert.equal((await api(member, 'PATCH', path, { title: 'Cannot resurrect' })).status, 404);
  });

  test('legacy task detail has explicit unknown audit values and reads never mutate the task', async () => {
    const before = await api(member, 'GET', `${prefix}/snapshot`);
    const task = await api(member, 'GET', `${prefix}/tasks/task`);
    assert.equal(task.status, 200);
    assert.equal(task.data.task.createdBy, null);
    assert.equal(task.data.task.createdAt, null);
    assert.equal(task.data.task.updatedAt, null);
    const after = await api(member, 'GET', `${prefix}/snapshot`);
    assert.deepEqual(after.data.tasks, before.data.tasks);
  });
  test('task create retries converge once, preserve later edits and bind canonical payloads', async () => {
    const operationId = randomUUID();
    const packet = { title: 'One durable task', operationId, description: 'Keep this context' };
    const copies = await Promise.all([api(member, 'POST', `${prefix}/tasks`, packet), api(member, 'POST', `${prefix}/tasks`, { description: packet.description, operationId, title: packet.title })]);
    for (const result of copies) assert.equal(result.status, 201);
    const id = copies[0].data.task.id;
    assert.equal(copies[1].data.task.id, id);
    assert.equal(copies[0].data.task.revision, 1);
    const before = await api(member, 'GET', `${prefix}/tasks/${id}`);
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/${id}`, { title: 'Later edit' })).status, 200);
    const replay = await api(member, 'POST', `${prefix}/tasks`, packet);
    assert.equal(replay.data.task.title, 'Later edit');
    assert.equal(replay.data.task.revision, 2);
    assert.equal((await api(member, 'GET', `${prefix}/tasks/${id}`)).data.task.createdAt, before.data.task.createdAt);
    const changed = await api(member, 'POST', `${prefix}/tasks`, { ...packet, title: 'Different intent' });
    assert.equal(changed.status, 409); assert.equal(changed.data.error.code, 'operation_conflict');
    const snapshot = await api(member, 'GET', `${prefix}/snapshot`);
    assert.equal(snapshot.data.tasks.length, 2);
  });

  test('reviewed task updates have one winner and exact replay never reapplies old values', async () => {
    const path = `${prefix}/tasks/task`;
    const first = { title: 'First reviewed title', operationId: randomUUID(), expectedRevision: 0 };
    const second = { title: 'Second reviewed title', operationId: randomUUID(), expectedRevision: 0 };
    const results = await Promise.all([api(member, 'PATCH', path, first), api(member, 'PATCH', path, second)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200,409]);
    const winner = results[0].status === 200 ? first : second;
    const loser = results.find(result => result.status === 409);
    assert.equal(loser.data.error.code, 'revision_conflict');
    const saved = await api(member, 'GET', path);
    assert.equal(saved.data.task.title, winner.title); assert.equal(saved.data.task.revision, 1);
    assert.equal((await api(member, 'PATCH', path, winner)).status, 200);
    assert.equal((await api(member, 'GET', path)).data.task.updatedAt, saved.data.task.updatedAt);
    await api(member, 'PATCH', path, { status: 'done' });
    const replay = await api(member, 'PATCH', path, winner);
    assert.equal(replay.data.task.status, 'done'); assert.equal(replay.data.task.revision, 2);
    assert.equal((await api(member, 'PATCH', path, { ...winner, title: 'Changed approved intent' })).data.error.code, 'operation_conflict');
  });

  test('task operation identities cannot cross mutation kind or target', async () => {
    const operationId = randomUUID();
    const created = await api(member, 'POST', `${prefix}/tasks`, { title: 'Bound create', operationId });
    const changed = await api(member, 'PATCH', `${prefix}/tasks/${created.data.task.id}`, { title: 'Wrong kind', operationId });
    assert.equal(changed.status, 409); assert.equal(changed.data.error.code, 'operation_conflict');
    const updateId = randomUUID();
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/task`, { status: 'doing', operationId: updateId })).status, 200);
    const foreign = await api(member, 'PATCH', `${prefix}/tasks/${created.data.task.id}`, { status: 'doing', operationId: updateId });
    assert.equal(foreign.status, 409); assert.equal(foreign.data.error.code, 'operation_conflict');
    assert.equal((await api(member, 'GET', `${prefix}/tasks/${created.data.task.id}`)).data.task.status, 'todo');
  });

  test('minimal task receipts survive deletion and prevent create/update resurrection', async () => {
    const operationId = randomUUID();
    const packet = { title: 'Private text is not a receipt', description: 'Sensitive description', operationId };
    const created = await api(member, 'POST', `${prefix}/tasks`, packet);
    const path = `${prefix}/tasks/${created.data.task.id}`;
    const update = { title: 'Updated once', operationId: randomUUID(), expectedRevision: 1 };
    assert.equal((await api(member, 'PATCH', path, update)).status, 200);
    assert.equal((await api(member, 'DELETE', path)).status, 200);
    const replay = await api(member, 'POST', `${prefix}/tasks`, packet);
    assert.equal(replay.status, 409); assert.equal(replay.data.error.code, 'task_removed');
    assert.equal((await api(member, 'PATCH', path, update)).data.error.code, 'task_removed');
    assert.equal((await api(member, 'GET', path)).status, 404);
    const receiptId = createHash('sha256').update(`${member}:${operationId}`).digest('hex');
    const receipt = await read(`${prefix}/taskOperations/${receiptId}`);
    assert.deepEqual(Object.keys(receipt).sort(), ['createdAt','digest','revision','taskId','uid']);
    assert.equal(receipt.taskId, created.data.task.id); assert.equal(receipt.revision, 1);
    assert.ok(!JSON.stringify(receipt).includes(packet.title));
    assert.ok(!JSON.stringify(receipt).includes(packet.description));
  });

  test('task operation replay reauthorizes revoked membership before revealing its outcome', async () => {
    const packet = { title: 'Before revocation', operationId: randomUUID() };
    assert.equal((await api(member, 'POST', `${prefix}/tasks`, packet)).status, 201);
    assert.equal((await api(owner, 'DELETE', `${prefix}/members/${member}`)).status, 200);
    const replay = await api(member, 'POST', `${prefix}/tasks`, packet);
    assert.equal(replay.status, 403); assert.equal(replay.data.error.code, 'forbidden');
    assert.equal(replay.data.task, undefined);
  });

  test('membership removal advances task revision and invalidates an old reviewed patch', async () => {
    const path = `${prefix}/tasks/task`;
    assert.equal((await api(owner, 'GET', path)).data.task.revision, 0);
    assert.equal((await api(owner, 'DELETE', `${prefix}/members/${member}`)).status, 200);
    const latest = await api(owner, 'GET', path);
    assert.equal(latest.data.task.assigneeId, null); assert.equal(latest.data.task.revision, 1);
    const stale = await api(owner, 'PATCH', path, { description: 'Stale review', expectedRevision: 0, operationId: randomUUID() });
    assert.equal(stale.status, 409); assert.equal(stale.data.error.code, 'revision_conflict');
    assert.equal((await api(owner, 'GET', path)).data.task.description, '');
  });

  test('task operation IDs are actor scoped and failed validations never consume them', async () => {
    const operationId = randomUUID();
    const packet = { title: 'Actor scoped', operationId };
    const a = await api(member, 'POST', `${prefix}/tasks`, packet);
    const b = await api(owner, 'POST', `${prefix}/tasks`, packet);
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.notEqual(a.data.task.id, b.data.task.id);
    const invalidId = randomUUID();
    assert.equal((await api(member, 'POST', `${prefix}/tasks`, { title: 'Invalid assignee', assigneeId: outsider, operationId: invalidId })).status, 400);
    assert.equal((await api(member, 'POST', `${prefix}/tasks`, { title: 'Valid after rejection', operationId: invalidId })).status, 201);
  });

};
