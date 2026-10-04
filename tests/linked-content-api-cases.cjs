const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const Y=require('yjs');
const model=require('../.test-build/collaboration-model.js');
const {defaultBoardView}=require('../.test-build/linked-content.js');

module.exports=function(test,{api,member,outsider,prefix,read}){
  test('linked source edits persist once, references stay live pointers and deletion never cascades into shared data',async()=>{
    const created=await api(member,'POST',`${prefix}/notes`,{title:'Source',content:{blocks:[{type:'paragraph',text:'Original source'},{type:'quote',text:'Untouched'}]}});
    assert.equal(created.status,201);
    const sourceId=created.data.note.id;
    const initialized=await api(member,'POST',`${prefix}/notes/${sourceId}/collaboration`,{});assert.equal(initialized.status,200);
    const source={noteId:sourceId,blockId:initialized.data.note.content.blocks[0].id};
    const content={blocks:[{type:'synced',text:'',source},{type:'board',text:'',boardView:{...defaultBoardView,name:'Open work',status:'doing'}}]};
    const hosts=await Promise.all(['Host one','Host two'].map(title=>api(member,'POST',`${prefix}/notes`,{title,content})));assert.ok(hosts.every(result=>result.status===201));
    const host1=hosts[0].data.note.id,host2=hosts[1].data.note.id;
    const promoted=await api(member,'POST',`${prefix}/notes/${host1}/collaboration`,{});assert.equal(promoted.status,200);
    assert.deepEqual(promoted.data.note.content.blocks[0].source,source);assert.equal(promoted.data.note.content.blocks[1].boardView.name,'Open work');
    const note=initialized.data.note,doc=model.decodeDocument(note.collab.state),before=model.readContent(doc),next=structuredClone(before),vector=Y.encodeStateVector(doc);
    next.blocks[0].text='Edited from a linked location';model.applyEditorContent(doc,before,next);
    const packet={operationId:randomUUID(),generation:note.collab.generation,update:Buffer.from(Y.encodeStateAsUpdate(doc,vector)).toString('base64')};doc.destroy();
    assert.equal((await api(outsider,'POST',`${prefix}/notes/${sourceId}/updates`,packet)).status,403);
    assert.equal((await api(member,'POST',`${prefix}/notes/${sourceId}/updates`,packet)).status,200);
    assert.equal((await api(member,'POST',`${prefix}/notes/${sourceId}/updates`,packet)).status,200);
    const saved=await read(`${prefix}/notes/${sourceId}`);assert.equal(saved.content.blocks[0].text,'Edited from a linked location');assert.equal(saved.content.blocks[1].text,'Untouched');assert.equal(saved.collab.sequence,1);
    for(const host of [host1,host2]){const note=await read(`${prefix}/notes/${host}`);assert.deepEqual(note.content.blocks[0].source,source);assert.equal(note.content.blocks[0].text,'');}
    assert.equal((await api(member,'POST',`${prefix}/notes`,{title:'Foreign',content:{blocks:[{type:'synced',text:'',source:{...source,workspaceId:'foreign'}}]}})).status,400);
    assert.equal((await api(member,'POST',`${prefix}/notes`,{title:'Malformed view',content:{blocks:[{type:'board',text:'',boardView:{...defaultBoardView,status:['all']}}]}})).status,400);
    assert.equal((await api(member,'DELETE',`${prefix}/notes/${host1}`)).status,200);assert.ok(await read(`${prefix}/notes/${sourceId}`));assert.ok(await read(`${prefix}/tasks/task`));
    assert.equal((await api(member,'DELETE',`${prefix}/notes/${sourceId}`)).status,200);
    const surviving=await read(`${prefix}/notes/${host2}`);assert.deepEqual(surviving.content.blocks[0].source,source);
    const edited=await api(member,'PATCH',`${prefix}/notes/${host2}`,{title:'Keep unavailable reference',expectedRevision:surviving.revision,content:{blocks:[...surviving.content.blocks,{type:'paragraph',text:'Still editable'}]}});
    assert.equal(edited.status,200);assert.equal(await read(`${prefix}/notes/${sourceId}`),undefined);
  });
  test('restoring a linked page restores reference/view settings without reverting source content or board tasks',async()=>{
    const source=await api(member,'POST',`${prefix}/notes`,{title:'Source history',content:{blocks:[{id:randomUUID(),type:'paragraph',text:'Before'}]}});assert.equal(source.status,201);
    const ref={noteId:source.data.note.id,blockId:source.data.note.content.blocks[0].id};
    const content={blocks:[{type:'synced',text:'',source:ref},{type:'board',text:'',boardView:{...defaultBoardView,name:'Original view',sort:'title'}}]};
    const host=await api(member,'POST',`${prefix}/notes`,{title:'Linked history',content});assert.equal(host.status,201);
    const hostId=host.data.note.id;
    assert.equal((await api(member,'POST',`${prefix}/notes/${hostId}/history`,{expectedRevision:1,name:'Linked baseline'})).status,200);
    assert.equal((await api(member,'PATCH',`${prefix}/notes/${ref.noteId}`,{title:'Source history',expectedRevision:1,content:{blocks:[{id:ref.blockId,type:'paragraph',text:'New source text'}]}})).status,200);
    assert.equal((await api(member,'PATCH',`${prefix}/notes/${hostId}`,{title:'Changed host',expectedRevision:1,content:{blocks:[{type:'paragraph',text:'Independent content'}]}})).status,200);
    const restored=await api(member,'POST',`${prefix}/notes/${hostId}/restore`,{versionId:'r1',expectedRevision:2,operationId:randomUUID()});assert.equal(restored.status,200);
    assert.deepEqual(restored.data.note.content.blocks.map(block=>{const copy={...block};delete copy.id;return copy;}),content.blocks);
    assert.equal((await read(`${prefix}/notes/${ref.noteId}`)).content.blocks[0].text,'New source text');assert.equal((await read(`${prefix}/tasks/task`)).title,'Original');
  });
};
