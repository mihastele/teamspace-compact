const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { taskContent, taskDescription, templateDefaults, applyTaskTemplate, duplicateTask } = require('../.test-build/task-pages.js');
const { decodeTaskDraft, taskDraftBaseline } = require('../.test-build/task-drafts.js');
const { taskInput, taskMutationInput } = require('../.test-build/server/validation.js');

test('duplicated tasks copy editable fields independently and exclude identity and audit data', () => {
  const source = { id: 'source', title: 'Release', status: 'doing', assigneeId: 'member', dueDate: '2026-10-18',
    projectId: 'project', priority: 'high', estimate: 3, propertyValues: { labels: ['a'] },
    description: 'old excerpt', content: { blocks: [{ id: randomUUID(), type: 'heading', level: 2, text: 'Plan' }, { type: 'todo', checked: true, text: 'Ship' }] },
    revision: 9, createdBy: 'owner', createdAt: 42, attachments: ['private'], comments: ['private'] };
  const copy = duplicateTask(source), second = duplicateTask(source);
  assert.equal(copy.title, 'Release (copy)');
  assert.equal(copy.status, 'doing'); assert.equal(copy.projectId, 'project');
  assert.equal(copy.assigneeId, 'member'); assert.equal(copy.dueDate, '2026-10-18');
  assert.equal(copy.priority, 'high'); assert.equal(copy.estimate, 3);
  assert.equal(copy.description, 'Plan\nShip');
  assert.equal(copy.content.blocks[0].level, 2); assert.equal(copy.content.blocks[1].checked, true);
  assert.notEqual(copy.content.blocks[0].id, source.content.blocks[0].id);
  assert.notEqual(copy.content.blocks[1].id, second.content.blocks[1].id);
  for (const key of ['id', 'revision', 'createdBy', 'createdAt', 'attachments', 'comments']) assert.equal(Object.hasOwn(copy, key), false, key);
  copy.content.blocks[0].text = 'Changed'; copy.propertyValues.labels.push('b');
  assert.equal(source.content.blocks[0].text, 'Plan'); assert.deepEqual(second.propertyValues.labels, ['a']);
  const legacy = duplicateTask({ title: 'x'.repeat(200), description: '# Literal' });
  assert.equal(legacy.title.length, 200); assert.equal(legacy.content.blocks[0].text, '# Literal');
  assert.equal(duplicateTask({ title: '🌿'.repeat(100) }).title.isWellFormed(), true);
  assert.equal(duplicateTask({}).title, 'Untitled task (copy)');
});

test('task pages preserve legacy literal descriptions and independently copy template blocks and values', () => {
  const description = '# Literal heading\n- literal list\n\nMore';
  const content = taskContent({ description });
  assert.deepEqual(content, { blocks: [{ type: 'paragraph', text: description }] });
  const template = { id: randomUUID(), name: 'Bug', revision: 1, defaults: templateDefaults({ title: 'Bug report', content, propertyValues: { labels: ['a'] } }) };
  const first = applyTaskTemplate(template), second = applyTaskTemplate(template);
  assert.notEqual(first.content.blocks[0].id, second.content.blocks[0].id);
  first.content.blocks[0].text = 'changed'; first.propertyValues.labels.push('b');
  assert.equal(template.defaults.content.blocks[0].text, description);
  assert.deepEqual(second.propertyValues.labels, ['a']);
  assert.equal(taskDescription(content), description);
  const empty = templateDefaults({ title: 'Task', content, assigneeId: '', dueDate: '', projectId: '' });
  assert.equal(empty.assigneeId, null); assert.equal(empty.dueDate, null); assert.equal(empty.projectId, null);
});

test('task body validation derives the compatibility excerpt, retains formatting and bounds unsupported content', () => {
  const content = { blocks: [{ id: randomUUID(), type: 'heading', level: 2, text: 'Steps' }, { type: 'todo', checked: true, text: 'Done' }, { type: 'code', text: 'literal <script>' }] };
  const result = taskMutationInput({ title: 'Task', content, description: 'untrusted projection' }, false).value;
  assert.deepEqual(result.content, content); assert.equal(result.description, 'Steps\nDone\nliteral <script>');
  for (const block of [{ type: 'board', text: '' }, { type: 'synced', text: '', source: { noteId: 'note', blockId: randomUUID() } }, { type: 'todo', text: '', checked: 'yes' }])
    assert.throws(() => taskInput({ content: { blocks: [block] } }, true));
  assert.throws(() => taskInput({ content: { blocks: Array.from({ length: 6 }, () => ({ type: 'paragraph', text: 'x'.repeat(20000) })) } }, true));
  const long = taskInput({ content: { blocks: [{ type: 'paragraph', text: 'x'.repeat(20000) }] } }, true);
  assert.equal(long.description.length, 10000); assert.equal(long.content.blocks[0].text.length, 20000);
});

test('task recovery binds baseline and exact retry to the task and rejects malformed persisted data', () => {
  const baseline = taskDraftBaseline({ id: 'task', title: 'Before', description: '', revision: 2 });
  const packet = { id: 'task', title: 'After', operationId: randomUUID(), expectedRevision: 2 };
  const record = { version: 1, baseline, draft: { title: 'After', description: '', content: { blocks: [] } }, packet };
  assert.deepEqual(decodeTaskDraft(JSON.stringify(record), 'task'), record);
  assert.throws(() => decodeTaskDraft(JSON.stringify(record), 'other'));
  assert.throws(() => decodeTaskDraft(JSON.stringify({ ...record, packet: { ...packet, expectedRevision: -1 } }), 'task'));
  assert.throws(() => decodeTaskDraft(JSON.stringify({ ...record, draft: { ...record.draft, content: { blocks: [{ type: 'board', text: '' }] } } }), 'task'));
  assert.throws(() => decodeTaskDraft('{broken', 'task'));
  assert.deepEqual(taskDraftBaseline({ id: 'task', title: 'Before', createdBy: 'private' }), { id: 'task', title: 'Before' });
});

test('task relation edits survive draft recovery and duplication without sharing arrays', () => {
  const field=randomUUID(),entry=randomUUID(),relations={[field]:[entry]};
  const baseline=taskDraftBaseline({id:'task',title:'Before',revision:2,databaseRelations:relations});
  const record={version:1,baseline,draft:{title:'After',description:'',content:{blocks:[]},databaseRelations:relations},packet:{id:'task',databaseRelations:relations,operationId:randomUUID(),expectedRevision:2}};
  assert.deepEqual(decodeTaskDraft(JSON.stringify(record),'task'),record);
  const duplicate=duplicateTask({title:'Before',databaseRelations:relations});
  duplicate.databaseRelations[field].push(randomUUID());
  assert.deepEqual(relations[field],[entry]);
  assert.throws(()=>decodeTaskDraft(JSON.stringify({...record,draft:{...record.draft,databaseRelations:{[field]:['bad/path']}}}),'task'));
});
