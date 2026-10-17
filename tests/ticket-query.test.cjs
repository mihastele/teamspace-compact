const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module'),load=Module._load;
Module._load=function(id,...args){return id==='server-only'?{}:load.call(this,id,...args);};
const {compileTicketQuery}=require('../.test-build/server/ticket-query-sql.js');
Module._load=load;
const {validateTicketQuery,validateViewConfig,resolveTicketQuery,defaultTicketViews,queryOperators,mergeSavedViews,ticketViewUrl}=require('../.test-build/ticket-query.js');
const {randomUUID}=require('node:crypto');
const types=['text','longText','number','date','checkbox','select','multiSelect','person','relation','url'];
const fields=types.map(type=>({id:randomUUID(),name:type,type,options:type.includes('elect')?[{id:randomUUID(),name:'Choice',archived:true}]:[],revision:1}));
const query=(filter={and:[]},sort=[])=>({version:1,filter,sort,timeZone:'Europe/Ljubljana'});
const field=type=>`custom:${fields.find(field=>field.type===type).id}`;

test('typed nested query operators validate all ten fields and archived option identities',()=>{
  const values={text:'needle',longText:'needle',number:-0.25,date:'2028-02-29',checkbox:false,select:fields.find(f=>f.type==='select').options[0].id,multiSelect:[fields.find(f=>f.type==='multiSelect').options[0].id],person:'@me',relation:'project',url:'https://example.test'};
  for(const type of types){const op=type==='multiSelect'?'containsAll':'eq';assert.doesNotThrow(()=>validateTicketQuery(query({field:field(type),op,value:values[type]}),fields));}
  assert.doesNotThrow(()=>validateTicketQuery(query({and:[{or:[{field:'status',op:'eq',value:'doing'},{field:field('number'),op:'gt',value:0}]}]}),fields));
  assert.ok(queryOperators('text').includes('notContains'));
});
test('query validation rejects unknown keys, coercions, bad operators/options/dates and costly trees',()=>{
  for(const filter of [
    {field:'missing',op:'eq',value:'x'}, {field:field('number'),op:'gt',value:'2'},
    {field:field('checkbox'),op:'eq',value:0},{field:field('select'),op:'in',value:[randomUUID()]},
    {field:field('multiSelect'),op:'eq',value:'x'}, {field:'dueDate',op:'eq',value:'0000-01-01'},
    {field:'dueDate',op:'between',value:['2026-02-29','2026-03-01']},
    {field:'title',op:'isEmpty',value:''},{field:'title',op:'contains',value:'x',sql:'drop table'},
    {and:[],or:[]},{and:Array.from({length:33},()=>({and:[]}))}
  ])assert.throws(()=>validateTicketQuery(query(filter),fields));
  assert.throws(()=>validateTicketQuery({...query(),timeZone:'not/a-zone'},fields));
  assert.throws(()=>validateTicketQuery(query({and:[]},[{field:field('multiSelect'),direction:'asc'}]),fields));
  assert.throws(()=>validateTicketQuery({...query(),version:2},fields));
  assert.throws(()=>validateTicketQuery(query({and:Array.from({length:11},()=>({field:field("person"),op:"in",value:Array.from({length:50},(_,i)=>`member${i}`)}))}),fields));
});
test('tokens resolve typed fields only, with explicit timezone and inclusive today plus seven calendar days',()=>{
  const instant=new Date('2026-10-24T22:30:00Z');
  const input=query({and:[{field:'dueDate',op:'between',value:['@today','@today+7']},{field:'assigneeId',op:'eq',value:'@me'},{field:field('text'),op:'eq',value:'@today'},{field:'projectId',op:'eq',value:'@project'}]});
  const result=resolveTicketQuery(validateTicketQuery(input,fields),'member','p',instant,fields);
  assert.deepEqual(result.filter.and.map(filter=>filter.value),[['2026-10-25','2026-11-01'],'member','@today','p']);
  assert.throws(()=>resolveTicketQuery(input,'member',undefined,instant,fields));
  const utc=resolveTicketQuery({...input,timeZone:'UTC'},'member','p',instant,fields);
  assert.equal(utc.filter.and[0].value[0],'2026-10-24');
});
test('SQL compilation never interpolates hostile values and uses normalized selection rows',()=>{
  const attack="%' OR true; DROP TABLE x; --";
  const input=validateTicketQuery(query({and:[{field:'title',op:'contains',value:attack},{field:field('multiSelect'),op:'containsAll',value:[fields.find(f=>f.type==='multiSelect').options[0].id]}]}),fields);
  const compiled=compileTicketQuery(input,fields);
  assert.ok(!compiled.where.includes(attack));assert.ok(compiled.parameters.includes(attack));
  assert.match(compiled.where,/teamspace_task_field_selections/);assert.match(compiled.where,/\$1/);
  assert.match(compiled.order,/t.id COLLATE "C" asc NULLS LAST/);
});
test('keyset compilation preserves signed numeric sorts, nulls last, three sorts and stable ID ties',()=>{
  const input=validateTicketQuery(query({and:[]},[{field:field('number'),direction:'desc'},{field:'dueDate',direction:'asc'},{field:'title',direction:'asc'}]),fields);
  const compiled=compileTicketQuery(input,fields,[-0.5,null,'a','task']);
  assert.match(compiled.where,/IS NULL/);assert.match(compiled.order,/desc NULLS LAST/);
  assert.ok(compiled.parameters.includes(-0.5));
  assert.throws(()=>compileTicketQuery(input,fields,[1]));
  assert.throws(()=>compileTicketQuery(input,fields,['wrong',null,'a','task']));
});
test('view configurations require valid fields/layout/grouping and preserve explicit query state',()=>{
  const config=defaultTicketViews()[0];const {id,...input}=config;void id;
  assert.deepEqual(validateViewConfig(input,fields),input);
  assert.throws(()=>validateViewConfig({...input,columns:['status']},fields));
  assert.throws(()=>validateViewConfig({...input,groupBy:'none'},fields));
  assert.throws(()=>validateViewConfig({...input,query:{...input.query,sql:'x'}},fields));
  assert.equal(validateViewConfig({...input,layout:'list',groupBy:'none'},fields).layout,'list');
});
test('default views retain requested ownership, project, overdue and inclusive week semantics',()=>{
  const views=defaultTicketViews();assert.equal(views.length,5);
  assert.equal(views.find(view=>view.id==='default-project').query.filter.value,'@project');
  assert.deepEqual(views.find(view=>view.id==='default-week').query.filter.value,['@today','@today+7']);
  assert.equal(views.find(view=>view.id==='default-overdue').query.filter.and[1].value,'done');
});

test('shared view snapshots cannot roll back an acknowledged save and newer remote revisions still win',()=>{
  const base={...defaultTicketViews()[0],revision:1,archived:false};
  const ack={...base,name:'Saved locally',revision:2},remote={...base,name:'Edited remotely',revision:3};
  const snapshot=[base],local=[ack];
  assert.equal(mergeSavedViews(snapshot,local)[0].name,'Saved locally');
  assert.equal(mergeSavedViews([remote],local)[0].name,'Edited remotely');
  assert.equal(mergeSavedViews([],[ack]).length,1);
  assert.equal(snapshot[0].revision,1);assert.equal(local[0].revision,2);
});

test('view URLs encode validated overrides, preserve other parameters and keep shared references live',()=>{
  const {id,...config}=defaultTicketViews()[0];void id;
  config.query.filter={field:'title',op:'contains',value:'quote \" & percent % 日本語'};
  const url=new URL(ticketViewUrl('https://example.test/?invite=keep','w','view','p',config));
  assert.equal(url.searchParams.get('workspace'),'w');assert.equal(url.searchParams.get('invite'),'keep');
  assert.deepEqual(JSON.parse(url.searchParams.get('ticketQuery')),config);
  const saved=new URL(ticketViewUrl(url.href,'w','view',''));
  assert.equal(saved.searchParams.has('ticketQuery'),false);assert.equal(saved.searchParams.has('project'),false);
  assert.throws(()=>ticketViewUrl(url.href,'w','unsaved','',{...config,name:'x'.repeat(8000)}));
});
