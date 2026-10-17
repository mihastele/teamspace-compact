const assert = require('node:assert/strict');

module.exports = function taskServiceCases(test, { api, member, outsider, prefix }) {
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
};
