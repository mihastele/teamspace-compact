const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Y = require('yjs');
const linked = require('../.test-build/linked-content.js');
const model = require('../.test-build/collaboration-model.js');
const { noteContent } = require('../.test-build/server/validation.js');
const { exportNoteMarkdown } = require('../.test-build/note-export.js');

test('linked metadata round-trips legacy boards, saved views and sources without copied text',()=>{
  const source={noteId:'source',blockId:randomUUID()}, view={...linked.defaultBoardView,name:'My open work',assignee:'me',status:'doing',sort:'dueDate'};
  const content={blocks:[{type:'board',text:''},{type:'board',text:'',boardView:view},{type:'synced',text:'',source}]};
  assert.deepEqual(noteContent(content),content);
  const doc=model.initializeDocument(content), decoded=model.decodeDocument(model.encodeDocument(doc));
  const roundtrip=model.readContent(decoded);
  assert.deepEqual(roundtrip.blocks.map(block=>{const copy={...block};delete copy.id;return copy;}),content.blocks);
  decoded.destroy();doc.destroy();
});
test('server and CRDT validators reject foreign paths, nested source references, malformed settings and text on references',()=>{
  const source={noteId:'source',blockId:randomUUID()};
  const invalid=[
    {type:'synced',text:'copied text',source}, {type:'synced',text:''},
    {type:'synced',text:'',source:{...source,workspaceId:'foreign'}},
    {type:'synced',text:'',source:{...source,noteId:'foreign/notes/source'}},
    {type:'synced',text:'',source:{...source,blockId:'not-a-uuid'}},
    {type:'paragraph',text:'',source}, {type:'board',text:'',source},
    {type:'board',text:'',boardView:{...linked.defaultBoardView,sort:'script'}},
    {type:'board',text:'',boardView:{...linked.defaultBoardView,status:['all']}},
    {type:'board',text:'',boardView:{...linked.defaultBoardView,deadline:['all']}},
    {type:'board',text:'',boardView:{...linked.defaultBoardView,sort:['title']}},
    {type:'board',text:'',boardView:{...linked.defaultBoardView,query:'x'.repeat(201)}},
    {type:'heading',text:'Title',boardView:linked.defaultBoardView},
  ];
  for(const block of invalid){assert.throws(()=>noteContent({blocks:[block]}));assert.throws(()=>model.initializeDocument({blocks:[block]}));}
});
test('linked board filters and stable sorts are independent, viewer-aware and immutable',()=>{
  const tasks=[
    {id:'b',title:'Bravo',description:'project',status:'doing',assigneeId:'alice',dueDate:'2026-10-06',position:0},
    {id:'a',title:'Alpha',description:'project',status:'todo',assigneeId:null,dueDate:null,position:0},
    {id:'c',title:'Charlie',description:'other',status:'done',assigneeId:'alice',dueDate:'2026-10-03',position:1},
  ];
  const snapshot=JSON.stringify(tasks);
  const base=linked.defaultBoardView;
  assert.deepEqual(linked.linkedBoardTasks(tasks,{...base,assignee:'me',status:'doing'},'alice','2026-10-04').map(task=>task.id),['b']);
  assert.deepEqual(linked.linkedBoardTasks(tasks,{...base,assignee:'me'},undefined,'2026-10-04'),[]);
  assert.deepEqual(linked.linkedBoardTasks(tasks,{...base,assignee:'unassigned'},'alice','2026-10-04').map(task=>task.id),['a']);
  assert.deepEqual(linked.linkedBoardTasks(tasks,{...base,query:'PROJECT',sort:'title'},'alice','2026-10-04').map(task=>task.id),['a','b']);
  assert.deepEqual(linked.linkedBoardTasks(tasks,{...base,sort:'dueDate'},'alice','2026-10-04').map(task=>task.id),['c','b','a']);
  assert.deepEqual(linked.linkedBoardTasks(tasks,{...base,deadline:'overdue'},'alice','2026-10-04'),[]);
  assert.equal(linked.linkedBoardTasks(tasks,base,'alice','2026-10-04').length,3);assert.equal(JSON.stringify(tasks),snapshot);
});
test('synced source intent preserves unrelated blocks and detach retains the destination identity',()=>{
  const id=randomUUID(),other=randomUUID(),source={noteId:'source',blockId:id};
  const original={id,type:'todo',text:'Original',checked:false},base={blocks:[original,{id:other,type:'paragraph',text:'Keep me'}]};
  const changed=linked.editLinkedSource(base,source,{text:'Edited',checked:true});
  assert.deepEqual(changed.blocks[1],base.blocks[1]);assert.equal(base.blocks[0].text,'Original');
  assert.equal(linked.sourceBlock(changed,source).text,'Edited');
  const reference={id:randomUUID(),type:'synced',text:'',source};
  const independent=linked.detachLinkedBlock(reference,changed.blocks[0]);
  assert.deepEqual(independent,{id:reference.id,type:'todo',text:'Edited',checked:true});assert.equal(independent.source,undefined);
  assert.equal(linked.sourceBlock({blocks:[reference]}, {...source,blockId:reference.id}),undefined);
  assert.throws(()=>linked.editLinkedSource({blocks:[]},source,{text:'Cannot resurrect'}));
  assert.equal(linked.sourceBlock({blocks:[{...original,type:'board',text:''}]},source),undefined);
});
test('synced references are bounded and Markdown exports references/settings without resolving live content',()=>{
  const source={noteId:'source',blockId:randomUUID()};
  assert.throws(()=>noteContent({blocks:Array.from({length:101},()=>({type:'synced',text:'',source}))}));
  assert.throws(()=>noteContent({blocks:Array.from({length:21},(_,i)=>({type:'synced',text:'',source:{...source,noteId:`source${i}`}}))}));
  const exported=exportNoteMarkdown('Links',{blocks:[{type:'synced',text:'',source},{type:'board',text:'',boardView:{...linked.defaultBoardView,name:'Release'}}]});
  assert.ok(exported.markdown.includes(source.blockId));assert.ok(exported.markdown.includes('Release'));assert.ok(exported.markdown.includes('"sort":"position"'));
});

test('preview self-links preserve other local edits and refuse conflicting or deleted source blocks',()=>{
  const source={noteId:'self',blockId:randomUUID()},base={blocks:[{id:source.blockId,type:'paragraph',text:'Before'},{id:randomUUID(),type:'quote',text:'Other'}]};
  const next=linked.editLinkedSource(base,source,{text:'After'}),current=structuredClone(base);
  current.blocks[1].text='Edited elsewhere during composition';current.blocks.push({id:randomUUID(),type:'paragraph',text:'Added'});
  const merged=linked.mergePreviewLinkedEdit(current,base,next,source);
  assert.equal(merged.blocks[0].text,'After');assert.equal(merged.blocks[1].text,current.blocks[1].text);assert.deepEqual(merged.blocks[2],current.blocks[2]);
  current.blocks[0].text='Conflicting source edit';assert.throws(()=>linked.mergePreviewLinkedEdit(current,base,next,source));
  assert.throws(()=>linked.mergePreviewLinkedEdit({blocks:[]},base,next,source));assert.equal(base.blocks[0].text,'Before');
});
test('atomic view settings and source targets converge while concurrent source text survives',()=>{
  const original=model.initializeDocument({blocks:[{type:'board',text:'',boardView:linked.defaultBoardView},{type:'synced',text:'',source:{noteId:'original',blockId:randomUUID()}},{type:'paragraph',text:'Source'}]});
  const a=model.decodeDocument(model.encodeDocument(original)),b=model.decodeDocument(model.encodeDocument(original));
  const mutate=(doc,name)=>{const before=model.readContent(doc),next=structuredClone(before),vector=Y.encodeStateVector(doc);
    next.blocks[0].boardView={...linked.defaultBoardView,name,query:name};next.blocks[1].source={noteId:name,blockId:randomUUID()};next.blocks[2].text+=name;
    model.applyEditorContent(doc,before,next);return Y.encodeStateAsUpdate(doc,vector);};
  const updateA=mutate(a,'A'),updateB=mutate(b,'B');
  const deliver=updates=>{const doc=model.decodeDocument(model.encodeDocument(original));for(const update of updates)Y.applyUpdate(doc,update);model.validateDocument(doc);const result=model.readContent(doc);doc.destroy();return result;};
  const result=deliver([updateA,updateB]);assert.deepEqual(result,deliver([updateB,updateA]));
  assert.equal(result.blocks[0].boardView.name,result.blocks[0].boardView.query);
  assert.ok(result.blocks[2].text.includes('A')&&result.blocks[2].text.includes('B'));
  original.destroy();a.destroy();b.destroy();
});
