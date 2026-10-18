const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {databaseFields,databaseValues,databaseFieldInput}=require('../.test-build/databases.js');
test('database relations use distinct bounded entry identities and immutable target databases',()=>{
  const target=randomUUID(),id=randomUUID(),entry=randomUUID();
  const fields=databaseFields([{id,name:'Customers',type:'relation',options:[],targetDatabaseId:target}]);
  assert.deepEqual(databaseValues({[id]:[entry]},fields),{[id]:[entry]});
  assert.throws(()=>databaseValues({[id]:entry},fields));
  assert.throws(()=>databaseValues({[id]:[entry,entry]},fields));
  assert.throws(()=>databaseFields([{...databaseFieldInput(fields[0]),targetDatabaseId:randomUUID()}],fields));
  assert.throws(()=>databaseFields([],fields));
  const renamed=databaseFields([{...databaseFieldInput(fields[0]),name:'Clients'}],fields);
  assert.equal(renamed[0].id,id);assert.equal(renamed[0].targetDatabaseId,target);
});
test('database scalar properties reuse typed validation and option identity preservation',()=>{
  const text=randomUUID(),number=randomUUID(),choice=randomUUID(),option=randomUUID();
  const fields=databaseFields([{id:text,name:'Name',type:'text',options:[]},{id:number,name:'Balance',type:'number',options:[]},{id:choice,name:'State',type:'select',options:[{id:option,name:'Active'}]}]);
  assert.deepEqual(databaseValues({[text]:'Acme',[number]:-0.25,[choice]:option},fields),{[text]:'Acme',[number]:-0.25,[choice]:option});
  assert.throws(()=>databaseValues({[number]:'2'},fields));assert.throws(()=>databaseValues({[randomUUID()]:'unknown'},fields));
  assert.throws(()=>databaseFields([{id:randomUUID(),name:'Invalid',type:'relation',options:[]} ]));
  assert.throws(()=>databaseFields([{id:text,name:'A',type:'text',options:[],projectId:'project'}]));
});
