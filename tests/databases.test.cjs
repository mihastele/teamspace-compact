const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {databaseFields,databaseValues,databaseFieldInput}=require('../.test-build/databases.js');
const {databaseColumns,sortDatabaseEntries}=require('../.test-build/database-table.js');
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

const row=(id,propertyValues={},title=id)=>({id,databaseId:'collection',title,content:{blocks:[]},propertyValues,archived:false,revision:1});
const field=(id,type,options=[])=>({id,name:id,type,options,revision:1});
const sorted=(rows,column,direction,fields,members=[],targets={})=>sortDatabaseEntries(rows,{column,direction},fields,members,targets).map(row=>row.id);

test('database table orders signed numbers, zero and dates with missing values last in both directions',()=>{
  const fields=[field('cost','number'),field('date','date')];
  const rows=[row('two',{cost:2,date:'2026-12-01'}),row('negative',{cost:-10.5,date:'2026-01-01'}),row('zero',{cost:0,date:'2026-10-21'}),row('empty'),row('null',{cost:null,date:null})];
  const before=structuredClone(rows);
  assert.deepEqual(sorted(rows,'property:cost','ascending',fields),['negative','zero','two','empty','null']);
  assert.deepEqual(sorted(rows,'property:cost','descending',fields),['two','zero','negative','empty','null']);
  assert.deepEqual(sorted(rows,'property:date','descending',fields),['two','zero','negative','empty','null']);
  assert.deepEqual(rows,before);
});

test('database table sorts current option/member labels and checkbox false stays a populated value',()=>{
  const fields=[field('choice','select',[{id:'z',name:'Alpha'},{id:'a',name:'Zulu'}]),field('person','person'),field('check','checkbox')];
  const rows=[row('first',{choice:'a',person:'a',check:false}),row('last',{choice:'z',person:'z',check:true}),row('empty')];
  const members=[{id:'a',displayName:'Zulu'},{id:'z',displayName:'Alpha'}];
  assert.deepEqual(sorted(rows,'property:choice','ascending',fields),['last','first','empty']);
  assert.deepEqual(sorted(rows,'property:person','ascending',fields,members),['last','first','empty']);
  assert.deepEqual(sorted(rows,'property:check','descending',fields),['last','first','empty']);
  const renamed=fields.map(item=>item.id==='choice'?{...item,options:[{id:'z',name:'Zulu'},{id:'a',name:'Alpha'}]}:item);
  assert.deepEqual(sorted(rows,'property:choice','ascending',renamed),['first','last','empty']);
  assert.deepEqual(databaseColumns(renamed).map(column=>column.id),['title','property:choice','property:person','property:check']);
});

test('database relations sort by linked entry names independently of target IDs and selection order',()=>{
  const fields=[field('links','relation')];
  const targets={z:row('z',{},'Alpha'),a:row('a',{},'Zulu'),b:row('b',{},'Beta')};
  const rows=[row('last',{links:['a']}),row('pair-b',{links:['b','z']}),row('pair-a',{links:['z','b']}),row('empty',{links:[]}),row('unknown',{links:['missing']})];
  assert.deepEqual(sorted(rows,'property:links','ascending',fields,[],targets),['pair-a','pair-b','unknown','last','empty']);
  const renamed={...targets,a:{...targets.a,title:'Aardvark'}};
  assert.equal(sorted(rows,'property:links','ascending',fields,[],renamed)[0],'last');
  assert.deepEqual(rows[1].propertyValues.links,['b','z']);
});

test('database title defaults, removed sort fields and loaded-row changes preserve deterministic identities',()=>{
  const rows=[row('z',{},'Entry 10'),row('b',{},'Entry 2'),row('a',{},'entry 2')];
  assert.deepEqual(sortDatabaseEntries(rows,null,[],[],{}).map(row=>row.id),['a','b','z']);
  assert.deepEqual(sorted(rows,'property:removed','descending',[]),['a','b','z']);
  assert.deepEqual(sorted(rows,'title','descending',[]),['z','a','b']);
  const refreshed=[...rows.filter(row=>row.id!=='a'),row('new',{},'Entry 1')];
  assert.deepEqual(sorted(refreshed,'title','ascending',[]),['new','b','z']);
  assert.equal(rows.length,3);
});
test('database scalar properties reuse typed validation and option identity preservation',()=>{
  const text=randomUUID(),number=randomUUID(),choice=randomUUID(),option=randomUUID();
  const fields=databaseFields([{id:text,name:'Name',type:'text',options:[]},{id:number,name:'Balance',type:'number',options:[]},{id:choice,name:'State',type:'select',options:[{id:option,name:'Active'}]}]);
  assert.deepEqual(databaseValues({[text]:'Acme',[number]:-0.25,[choice]:option},fields),{[text]:'Acme',[number]:-0.25,[choice]:option});
  assert.throws(()=>databaseValues({[number]:'2'},fields));assert.throws(()=>databaseValues({[randomUUID()]:'unknown'},fields));
  assert.throws(()=>databaseFields([{id:randomUUID(),name:'Invalid',type:'relation',options:[]} ]));
  assert.throws(()=>databaseFields([{id:text,name:'A',type:'text',options:[],projectId:'project'}]));
});
