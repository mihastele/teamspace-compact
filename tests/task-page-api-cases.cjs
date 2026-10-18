const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = function taskPageCases(test, { api, member, outsider, prefix, read }) {
  test('task block bodies persist through detail/snapshot and require reviewed edits; exact creates and updates replay once', async () => {
    const content = { blocks: [{ id: randomUUID(), type: 'heading', level: 2, text: 'Steps' }, { type: 'todo', checked: false, text: 'Reproduce' }] };
    const operationId = randomUUID();
    const create = { title: 'Rich task', content, operationId };
    const first = await api(member, 'POST', `${prefix}/tasks`, create);
    assert.equal(first.status, 201); const id = first.data.task.id;
    assert.deepEqual(first.data.task.content, content); assert.equal(first.data.task.description, 'Steps\nReproduce');
    assert.equal((await api(member, 'POST', `${prefix}/tasks`, create)).data.task.id, id);
    assert.deepEqual((await api(member, 'GET', `${prefix}/tasks/${id}`)).data.task.content, content);
    assert.deepEqual((await api(member, 'GET', `${prefix}/snapshot`)).data.tasks.find(row => row.id === id).content, content);
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/${id}`, { content })).status, 409);
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/${id}`, { description: 'stale legacy write' })).status, 409);
    const next = { content: { blocks: [{ type: 'quote', text: 'New body' }] }, expectedRevision: 1, operationId: randomUUID() };
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/${id}`, next)).status, 200);
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/${id}`, next)).data.task.revision, 2);
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/${id}`, { content, expectedRevision: 1 })).status, 409);
    assert.equal((await api(outsider, 'PATCH', `${prefix}/tasks/${id}`, { content, expectedRevision: 2 })).status, 403);
    const concurrent = await Promise.all(['One', 'Two'].map(text => api(member, 'PATCH', `${prefix}/tasks/${id}`, { content: { blocks: [{ type: 'paragraph', text }] }, expectedRevision: 2 })));
    assert.deepEqual(concurrent.map(row => row.status).sort(), [200, 409]);
    const actual = await read(`${prefix}/tasks/${id}`); assert.equal(actual.revision, 3);
    assert.equal(actual.content.blocks[0].text, actual.description);
    assert.equal((await api(member, 'PATCH', `${prefix}/tasks/${id}`, { description: 'Reviewed literal replacement', expectedRevision: 3 })).status, 200);
    assert.deepEqual((await read(`${prefix}/tasks/${id}`)).content, { blocks: [{ type: 'paragraph', text: 'Reviewed literal replacement' }] });
    assert.equal((await api(member, 'POST', `${prefix}/tasks`, { title: 'Invalid', content: { blocks: [{ type: 'board', text: '' }] } })).status, 400);
  });

  test('shared templates enforce workspace access, reviewed revisions and copy-independent application with current field validation', async () => {
    const fieldId = randomUUID(), optionId = randomUUID();
    assert.equal((await api(member, 'PUT', `${prefix}/boardProperties/${fieldId}`, { name: 'Labels', type: 'multiSelect', options: [{ id: optionId, name: 'Bug' }], expectedRevision: 0 })).status, 201);
    const id = randomUUID(), defaults = { title: 'Bug report', content: { blocks: [{ type: 'heading', text: 'Steps', level: 2 }] }, propertyValues: { [fieldId]: [optionId] } };
    const input = { name: 'Bug report', defaults, expectedRevision: 0 };
    const first = await api(member, 'PUT', `${prefix}/taskTemplates/${id}`, input);
    assert.equal(first.status, 200); assert.equal(first.data.template.revision, 1);
    assert.equal((await api(member, 'PUT', `${prefix}/taskTemplates/${id}`, input)).data.template.revision, 1);
    assert.equal((await api(outsider, 'GET', `${prefix}/taskTemplates`)).status, 403);
    assert.equal((await api(outsider, 'PUT', `${prefix}/taskTemplates/${id}`, { ...input, expectedRevision: 1 })).status, 403);
    assert.equal((await api(member, 'PUT', `${prefix}/taskTemplates/${id}`, { ...input, name: 'Overwrite' })).status, 409);
    assert.equal((await api(member, 'PUT', `${prefix}/taskTemplates/${randomUUID()}`, { ...input, defaults: { ...defaults, ownerId: member } })).status, 400);
    const saved = (await api(member, 'GET', `${prefix}/taskTemplates`)).data.templates[0];
    assert.equal(saved.name, 'Bug report'); assert.equal(saved.lastDigest, undefined);
    const created = await api(member, 'POST', `${prefix}/tasks`, { ...saved.defaults, operationId: randomUUID() });
    assert.equal(created.status, 201);
    const changes = await Promise.all(['Rename one', 'Rename two'].map(name => api(member, 'PUT', `${prefix}/taskTemplates/${id}`, { ...input, name, expectedRevision: 1 })));
    assert.deepEqual(changes.map(row => row.status).sort(), [200, 409]);
    assert.equal((await read(`${prefix}/tasks/${created.data.task.id}`)).title, 'Bug report');
    assert.equal((await api(member, 'PUT', `${prefix}/taskTemplates/${id}`, { ...input, expectedRevision: 2, archived: true })).status, 200);
    assert.equal((await api(member, 'GET', `${prefix}/snapshot`)).data.taskTemplates[0].archived, true);
    assert.equal((await api(member, 'POST', `${prefix}/tasks`, { ...saved.defaults, propertyValues: { [fieldId]: [randomUUID()] } })).status, 400);
  });
};
