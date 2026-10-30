const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {databaseFields,databaseValues,databaseFieldInput}=require('../.test-build/databases.js');
const {databaseColumns,sortDatabaseEntries}=require('../.test-build/database-table.js');
const {databaseRelationChoices,changeDatabaseRelation}=require('../.test-build/database-relations.js');
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
test('task and project relations keep immutable typed targets and accept existing non-UUID IDs',()=>{
  const task=randomUUID(),project=randomUUID();
  const fields=databaseFields([{id:task,name:'Tasks',type:'relation',options:[],targetKind:'task'},{id:project,name:'Projects',type:'relation',options:[],targetKind:'project'}]);
  assert.deepEqual(databaseValues({[task]:['t_existing'],[project]:['project-1']},fields),{[task]:['t_existing'],[project]:['project-1']});
  assert.throws(()=>databaseValues({[task]:['bad/path']},fields));
  assert.throws(()=>databaseFields([{...databaseFieldInput(fields[0]),targetKind:'project'},databaseFieldInput(fields[1])],fields));
  assert.equal(databaseFieldInput(fields[0]).targetKind,'task');
});
test('task and project relation sorting uses the label for the selected target kind',()=>{
  const fields=[{id:'task',name:'Task',type:'relation',targetKind:'task',options:[],revision:1},{id:'project',name:'Project',type:'relation',targetKind:'project',options:[],revision:1}];
  const entries=[{id:'a',title:'A',propertyValues:{task:['same'],project:['same']}},{id:'b',title:'B',propertyValues:{task:['other'],project:['other']}}];
  const entities={tasks:[{id:'same',title:'Zulu'},{id:'other',title:'Alpha'}],projects:[{id:'same',name:'Alpha'},{id:'other',name:'Zulu'}]};
  assert.deepEqual(sortDatabaseEntries(entries,{column:'property:task',direction:'ascending'},fields,[],{},entities).map(item=>item.id),['b','a']);
  assert.deepEqual(sortDatabaseEntries(entries,{column:'property:project',direction:'ascending'},fields,[],{},entities).map(item=>item.id),['a','b']);
});

const row=(id,propertyValues={},title=id)=>({id,databaseId:'collection',title,content:{blocks:[]},propertyValues,archived:false,revision:1});
const field=(id,type,options=[])=>({id,name:id,type,options,revision:1});
const sorted=(rows,column,direction,fields,members=[],targets={})=>sortDatabaseEntries(rows,{column,direction},fields,members,targets).map(row=>row.id);

test('relation search keeps selected and unavailable identities visible without modifying links',()=>{
  const entries=[row('b',{},'Client 10'),row('a',{},'Client 2'),row('unicode',{},'Čebelica\n  Team')];
  const selected=['b','missing'];
  const before=structuredClone(entries);
  const matches=databaseRelationChoices(entries,selected,'  čEBELICA   team  ');
  assert.deepEqual(matches.map(choice=>choice.id),['b','missing','unicode']);
  assert.equal(matches[1].unavailable,true);assert.equal(matches[1].disabled,false);
  const all=databaseRelationChoices(entries,[], '').map(choice=>choice.id);
  assert.deepEqual(all.filter(id=>id!=='unicode'),['a','b']);assert.ok(all.includes('unicode'));
  assert.deepEqual(databaseRelationChoices(entries,[],'no match'),[]);
  assert.deepEqual(entries,before);assert.deepEqual(selected,['b','missing']);
});

test('relation selection prevents new archived links while allowing removal of retained and unavailable links',()=>{
  const entries=[row('active'),{...row('archived'),archived:true}];
  const choices=databaseRelationChoices(entries,['archived','missing'],'');
  const archived=choices.find(choice=>choice.id==='archived'),missing=choices.find(choice=>choice.id==='missing');
  assert.deepEqual(changeDatabaseRelation(['archived','missing'],archived,false),['missing']);
  assert.deepEqual(changeDatabaseRelation(['missing'],missing,false),[]);
  const available=databaseRelationChoices(entries,[],'');
  assert.equal(available.find(choice=>choice.id==='archived').disabled,true);
  assert.deepEqual(changeDatabaseRelation([],available.find(choice=>choice.id==='archived'),true),[]);
  const archivedDatabase=databaseRelationChoices(entries,[],'',true);
  assert.equal(archivedDatabase.find(choice=>choice.id==='active').disabled,true);
  assert.deepEqual(changeDatabaseRelation([],archivedDatabase.find(choice=>choice.id==='active'),true),[]);
});

test('relation cap disables only new links and selection changes remain distinct and immutable',()=>{
  const selected=Array.from({length:50},(_,i)=>`entry-${i}`);
  const entries=[...selected.map(id=>row(id)),row('new')];
  const choices=databaseRelationChoices(entries,selected,'');
  const next=choices.find(choice=>choice.id==='new'),retained=choices.find(choice=>choice.id===selected[0]);
  assert.equal(next.disabled,true);assert.equal(retained.disabled,false);
  assert.deepEqual(changeDatabaseRelation(selected,next,true),selected);
  assert.equal(changeDatabaseRelation(selected,retained,false).length,49);
  const allowed=databaseRelationChoices(entries,selected.slice(1),'').find(choice=>choice.id==='new');
  const added=changeDatabaseRelation(selected.slice(1),allowed,true);
  assert.equal(added.length,50);assert.equal(new Set(added).size,50);
  assert.deepEqual(changeDatabaseRelation(added,allowed,true),added);
  assert.equal(selected.length,50);assert.notEqual(added,selected);
});

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


test('email and phone database fields retain bounded text values and display and sort them',()=>{
  const email=randomUUID(),phone=randomUUID();
  const fields=databaseFields([{id:email,name:'Email',type:'email',options:[]},{id:phone,name:'Phone',type:'phone',options:[]}]);
  const values={[email]:'person@example.com',[phone]:'+386 1 234 567'};
  assert.deepEqual(databaseValues(values,fields),values);
  assert.deepEqual(databaseFields(fields.map(databaseFieldInput),fields).map(f=>f.type),['email','phone']);
  assert.throws(()=>databaseValues({[phone]:'x'.repeat(2001)},fields));
  assert.throws(()=>databaseValues({[email]:false},fields));
  assert.throws(()=>databaseValues({[email]:'bad\0value'},fields));
  assert.deepEqual(sorted([row('b',{[email]:'z@example.com'}),row('a',{[email]:'a@example.com'}),row('empty')],`property:${email}`,'ascending',fields),['a','b','empty']);
  const {propertyDefinition}=require('../.test-build/board-properties.js');
  assert.throws(()=>propertyDefinition({name:'Email',type:'email',options:[]}));
});


test('database statuses preserve workflow groups, identities, archived values and group order',()=>{
  const id=randomUUID(),todo=randomUUID(),doing=randomUUID(),done=randomUUID();
  const input={id,name:'Progress',type:'status',options:[{id:done,name:'Shipped',group:'done'},{id:todo,name:'Planned',group:'todo'},{id:doing,name:'Building',group:'doing'}]};
  const fields=databaseFields([input]);
  assert.deepEqual(databaseValues({[id]:doing},fields),{[id]:doing});
  assert.deepEqual(databaseFieldInput(fields[0]).options,input.options);
  assert.throws(()=>databaseFields([{...input,options:[{id:todo,name:'Bad'}]}]));
  assert.throws(()=>databaseFields([{...input,options:[{id:todo,name:'Bad',group:'other'}]}]));
  assert.throws(()=>databaseFields([{...input,type:'select'}]));
  assert.throws(()=>databaseValues({[id]:randomUUID()},fields));
  const updated=databaseFields([{...input,options:input.options.map(option=>option.id===doing?{...option,archived:true,group:'done'}:option)}],fields);
  assert.deepEqual(databaseValues({[id]:doing},updated,{[id]:doing}),{[id]:doing});
  assert.throws(()=>databaseValues({[id]:doing},updated));
  assert.throws(()=>databaseFields([{...input,options:input.options.slice(1)}],fields));
  assert.deepEqual(sorted([row('done',{[id]:done}),row('todo',{[id]:todo}),row('doing',{[id]:doing}),row('empty')],`property:${id}`,'ascending',fields),['todo','doing','done','empty']);
  assert.deepEqual(sorted([row('done',{[id]:done}),row('todo',{[id]:todo}),row('doing',{[id]:doing}),row('empty')],`property:${id}`,'descending',fields),['done','doing','todo','empty']);
  assert.throws(()=>require('../.test-build/board-properties.js').propertyDefinition({name:'Status',type:'status',options:[]}));
});


test('created time is read-only, shows UTC and sorts unknown timestamps last',()=>{
  const id=randomUUID(),fields=databaseFields([{id,name:'Created',type:'createdTime',options:[]}]);
  assert.deepEqual(databaseValues({},fields),{});
  assert.throws(()=>databaseValues({[id]:'2026-10-30'},fields));
  assert.throws(()=>databaseValues({[id]:null},fields));
  const {createdTimeDisplay}=require('../.test-build/databases.js');
  assert.equal(createdTimeDisplay({createdAt:Date.UTC(2026,9,30,12,30)}),'2026-10-30 12:30:00 UTC');
  assert.equal(createdTimeDisplay({}),'');
  const rows=[{...row('late'),createdAt:2000},{...row('early'),createdAt:1000},row('old')];
  assert.deepEqual(sorted(rows,`property:${id}`,'ascending',fields),['early','late','old']);
  assert.deepEqual(sorted(rows,`property:${id}`,'descending',fields),['late','early','old']);
});
