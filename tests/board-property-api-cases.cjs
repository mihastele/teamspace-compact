const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = function boardPropertyCases(test, { api, member, outsider, prefix, read }) {
  test('custom board properties persist all value types, rename options and enforce access/schema',async()=>{
    const fields=['text','select','multiSelect','date'].map(type=>({id:randomUUID(),name:type,type,options:type.includes('elect')?[{id:randomUUID(),name:'First'}]:[]}));
    for(const {id,...field} of fields) assert.equal((await api(member,'PUT',`${prefix}/boardProperties/${id}`,{...field,expectedRevision:0})).status,201);
    const [text,select,multi,date]=fields;
    const values={[text.id]:'Context',[select.id]:select.options[0].id,[multi.id]:[multi.options[0].id],[date.id]:'2028-02-29'};
    assert.equal((await api(member,'PATCH',`${prefix}/tasks/task`,{propertyValues:values})).status,200);
    assert.deepEqual((await read(`${prefix}/tasks/task`)).propertyValues,values);
    const {id,...field}=select;
    assert.equal((await api(member,'PUT',`${prefix}/boardProperties/${id}`,{...field,options:[{...field.options[0],name:'Renamed'}],expectedRevision:1})).status,200);
    assert.equal((await api(member,'PUT',`${prefix}/boardProperties/${id}`,{...field,expectedRevision:1})).status,409);
    assert.equal((await api(member,'PUT',`${prefix}/boardProperties/${id}`,{...field,options:[],expectedRevision:2})).status,409);
    assert.deepEqual((await read(`${prefix}/tasks/task`)).propertyValues,values);
    for(const invalid of [{[select.id]:randomUUID()},{[date.id]:'2026-02-29'},{[multi.id]:[multi.options[0].id,multi.options[0].id]},{[randomUUID()]:'unknown'}])
      assert.equal((await api(member,'PATCH',`${prefix}/tasks/task`,{propertyValues:invalid})).status,400);
    assert.equal((await api(outsider,'PATCH',`${prefix}/tasks/task`,{propertyValues:{[text.id]:'stolen'}})).status,403);
    assert.equal((await api(outsider,'PUT',`${prefix}/boardProperties/${id}`,{...field,expectedRevision:2})).status,403);
    const snapshot=await api(member,'GET',`${prefix}/snapshot`);
    assert.equal(snapshot.data.boardProperties.length,4);
    assert.equal(snapshot.data.tasks.find(task=>task.id==='task').propertyValues[date.id],'2028-02-29');
    assert.equal((await api(member,'PATCH',`${prefix}/tasks/task`,{propertyValues:{[date.id]:null}})).status,200);
    const saved=await read(`${prefix}/tasks/task`); assert.equal(saved.propertyValues[date.id],null); assert.equal(saved.propertyValues[text.id],'Context');
  });
  test('concurrent field edits and status changes preserve final state; property creates serialize names',async()=>{
    const one=randomUUID(),two=randomUUID();
    for(const [id,name] of [[one,'A'],[two,'B']]) assert.equal((await api(member,'PUT',`${prefix}/boardProperties/${id}`,{name,type:'text',options:[],expectedRevision:0})).status,201);
    const changes=await Promise.all([
      api(member,'PATCH',`${prefix}/tasks/task`,{propertyValues:{[one]:'First'}}),
      api(member,'PATCH',`${prefix}/tasks/task`,{propertyValues:{[two]:'Second'}}),
      api(member,'PATCH',`${prefix}/tasks/task`,{status:'doing'}),
    ]);
    for(const result of changes)assert.equal(result.status,200);
    const saved=await read(`${prefix}/tasks/task`);
    assert.deepEqual(saved.propertyValues,{[one]:'First',[two]:'Second'}); assert.equal(saved.status,'doing'); assert.equal(saved.title,'Original');
    const creates=await Promise.all([randomUUID(),randomUUID()].map(id=>api(member,'PUT',`${prefix}/boardProperties/${id}`,{name:'Same name',type:'text',options:[],expectedRevision:0})));
    assert.deepEqual(creates.map(result=>result.status).sort(),[201,409]);
    const renames=await Promise.all(['One rename','Other rename'].map(name=>api(member,'PUT',`${prefix}/boardProperties/${one}`,{name,type:'text',options:[],expectedRevision:1})));
    assert.deepEqual(renames.map(result=>result.status).sort(),[200,409]);
    const definition=await read(`${prefix}/boardProperties/${one}`); assert.equal(definition.revision,2);
    assert.ok(['One rename','Other rename'].includes(definition.name));
  });
};
