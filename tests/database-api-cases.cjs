const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=function(test,{api,member,outsider,prefix,read,sql,db}){
  const definition=(id,name,fields=[],extra={})=>({name,description:'Collection',fields,archived:false,expectedRevision:0,operationId:randomUUID(),...extra});
  const entry=(databaseId,title,propertyValues={},extra={})=>({databaseId,title,content:{blocks:[{type:'heading',text:'Rich body',level:2}]},propertyValues,archived:false,expectedRevision:0,operationId:randomUUID(),...extra});
  const save=(kind,id,body,uid=member)=>api(uid,'PUT',`${prefix}/${kind}/${id}`,body);
  test('database created time is server-owned, immutable, retry-safe and unknown for legacy entries',async()=>{
    const database=randomUUID(), field=randomUUID(), fresh=randomUUID(), legacy=randomUUID();
    assert.equal((await save('databases',database,definition(database,'Dates',[{id:field,name:'Created',type:'createdTime',options:[]}]))).status,200);
    const packet=entry(database,'New');
    const first=await save('databaseEntries',fresh,packet);
    assert.equal(first.status,200); assert.equal(typeof first.data.record.createdAt,'number');
    const timestamp=first.data.record.createdAt;
    assert.equal((await save('databaseEntries',fresh,packet)).data.record.createdAt,timestamp);
    assert.equal((await api(member,'GET',`${prefix}/databaseEntries/${fresh}`)).data.entry.createdAt,timestamp);
    assert.equal((await api(member,'GET',`${prefix}/databases/${database}`)).data.entries.find(row=>row.id===fresh).createdAt,timestamp);
    assert.equal((await save('databaseEntries',fresh,entry(database,'Edited',{}, {expectedRevision:1}))).data.record.createdAt,timestamp);
    assert.equal((await save('databaseEntries',fresh,entry(database,'Forged',{[field]:'2020-01-01'},{expectedRevision:2}))).status,400);
    assert.equal((await save('databaseEntries',randomUUID(),{...entry(database,'Forged'),createdAt:0})).status,400);
    await db.runTransaction(async tx=>tx.create(db.doc(`${prefix}/databaseEntries/${legacy}`),{databaseId:database,entryKey:legacy,title:'Old',content:{blocks:[]},propertyValues:{},archived:false,revision:1}));
    assert.equal((await api(member,'GET',`${prefix}/databaseEntries/${legacy}`)).data.entry.createdAt,null);
    assert.equal((await save('databaseEntries',legacy,entry(database,'Edited old',{}, {expectedRevision:1}))).data.record.createdAt,null);
    assert.equal((await api(outsider,'GET',`${prefix}/databaseEntries/${fresh}`)).status,403);
  });
  test('database task and project links validate targets and task deletion preserves entry revisions',async()=>{
    const database=randomUUID(),taskField=randomUUID(),projectField=randomUUID(),source=randomUUID();
    await db.runTransaction(async tx=>tx.create(db.doc(`${prefix}/projects/project`),{name:'Project',description:'',archived:false,revision:1}));
    const fields=[{id:taskField,name:'Tasks',type:'relation',options:[],targetKind:'task'}, {id:projectField,name:'Projects',type:'relation',options:[],targetKind:'project'}];
    assert.equal((await save('databases',database,definition(database,'Linked',fields))).status,200);
    const body=entry(database,'Source',{[taskField]:['task'],[projectField]:['project']});
    assert.equal((await save('databaseEntries',source,body)).status,200);
    assert.equal((await save('databaseEntries',randomUUID(),entry(database,'Missing',{[taskField]:['not_found']}))).status,400);
    await db.runTransaction(async tx=>{tx.create(db.doc('workspaces/foreign'),{name:'Foreign'});tx.create(db.doc('workspaces/foreign/tasks/foreign_task'),{title:'Foreign'});});
    assert.equal((await save('databaseEntries',randomUUID(),entry(database,'Foreign',{[taskField]:['foreign_task']}))).status,400);
    assert.equal((await save('databaseEntries',randomUUID(),entry(database,'Forbidden',{[taskField]:['task']}),outsider)).status,403);
    assert.equal(await sql('select count(*) from public.teamspace_database_task_links;'),'1');
    assert.equal(await sql('select count(*) from public.teamspace_database_project_links;'),'1');
    await db.runTransaction(async tx=>tx.update(db.doc(`${prefix}/projects/project`),{archived:true}));
    assert.equal((await save('databaseEntries',randomUUID(),entry(database,'Archived',{[projectField]:['project']}))).status,400);
    assert.equal((await save('databaseEntries',source,entry(database,'Retained',{[taskField]:['task'],[projectField]:['project']},{expectedRevision:1}))).status,200);
    assert.equal((await api(outsider,'DELETE',`${prefix}/tasks/task`)).status,403);
    assert.equal((await api(member,'DELETE',`${prefix}/tasks/task`)).status,200);
    const saved=await read(`${prefix}/databaseEntries/${source}`);
    assert.deepEqual(saved.propertyValues,{[taskField]:[],[projectField]:['project']});
    assert.equal(saved.revision,3);
    assert.equal((await save('databaseEntries',source,entry(database,'Stale',{}, {expectedRevision:2}))).status,409);
    assert.equal((await save('databaseEntries',source,body)).status,200);
    assert.deepEqual((await read(`${prefix}/databaseEntries/${source}`)).propertyValues[taskField],[]);
  });
  test('independent databases persist rich entries and multi-entry relations with indexed incoming links',async()=>{
    const clients=randomUUID(),documents=randomUUID(),field=randomUUID(),a=randomUUID(),b=randomUUID(),doc=randomUUID();
    assert.equal((await save('databases',clients,definition(clients,'Clients'))).status,200);
    const relation={id:field,name:'Clients',type:'relation',options:[],targetDatabaseId:clients};
    assert.equal((await save('databases',documents,definition(documents,'Documents',[relation]))).status,200);
    assert.equal((await save('databaseEntries',a,entry(clients,'Acme'))).status,200);
    assert.equal((await save('databaseEntries',b,entry(clients,'Other client'))).status,200);
    const body=entry(documents,'Contract',{[field]:[a,b]});
    assert.equal((await save('databaseEntries',doc,body)).status,200);
    const incoming=await api(member,'GET',`${prefix}/databaseEntries/${a}`);
    assert.equal(incoming.status,200,JSON.stringify(incoming.data));
    assert.equal(incoming.data.incoming[0].title,'Contract');assert.equal(incoming.data.incoming[0].fieldName,'Clients');
    assert.equal(await sql(`select count(*) from public.teamspace_database_links;`),'2');
    const exported=await api(member,'GET',`${prefix}/databases/${documents}`);
    assert.deepEqual(exported.data.entries[0].propertyValues,{[field]:[a,b]});
    assert.equal(exported.data.entries[0].content.blocks[0].level,2);
    const renamed=entry(documents,'Signed contract',{[field]:[b]},{expectedRevision:1});
    assert.equal((await save('databaseEntries',doc,renamed)).status,200);
    assert.equal((await api(member,'GET',`${prefix}/databaseEntries/${a}`)).data.incoming.length,0);
    assert.equal((await api(member,'GET',`${prefix}/databaseEntries/${b}`)).data.incoming[0].title,'Signed contract');
    assert.equal(await sql('select count(*) from public.teamspace_database_links;'),'1');
    await assert.rejects(db.runTransaction(async tx=>{
      tx.update(db.doc(`${prefix}/databaseEntries/${doc}`),{propertyValues:{[field]:[randomUUID()]}});
    }),/Invalid relation target/);
    assert.deepEqual((await read(`${prefix}/databaseEntries/${doc}`)).propertyValues,{[field]:[b]});
    assert.equal((await read(`${prefix}/tasks/task`)).title,'Original');
    await assert.rejects(sql(`set role service_role;update public.teamspace_documents set data=jsonb_set(data,'{propertyValues}',${"'{\""+field+'\":[\"'+randomUUID()+'\"]}\''}::jsonb) where path='${prefix}/databaseEntries/${doc}';`),/permission denied/);
  });
  test('database saves converge concurrent retries and reject stale, foreign, archived and schema-changing links',async()=>{
    const a=randomUUID(),b=randomUUID(),field=randomUUID(),target=randomUUID(),source=randomUUID();
    const dbBody=definition(a,'People');
    const creates=await Promise.all([save('databases',a,dbBody),save('databases',a,dbBody)]);
    assert.deepEqual(creates.map(row=>row.status),[200,200]);
    assert.equal((await save('databases',a,{...dbBody,name:'Changed'})).status,409);
    assert.equal((await save('databases',b,definition(b,'Links',[{id:field,name:'People',type:'relation',options:[],targetDatabaseId:a}]))).status,200);
    assert.equal((await save('databaseEntries',target,entry(a,'Person'))).status,200);
    assert.equal((await save('databaseEntries',source,entry(b,'Source',{[field]:[target]}))).status,200);
    assert.equal((await save('databaseEntries',randomUUID(),entry(b,'Bad',{[field]:[randomUUID()]}))).status,400);
    assert.equal((await save('databaseEntries',randomUUID(),entry(b,'Wrong database',{[field]:[source]}))).status,400);
    const foreign=randomUUID();
    await db.runTransaction(async tx=>{
      tx.create(db.doc('workspaces/foreign'),{name:'Foreign',ownerId:outsider});
      tx.create(db.doc(`workspaces/foreign/databases/${a}`),{name:'Foreign people',fields:[],archived:false,revision:1});
      tx.create(db.doc(`workspaces/foreign/databaseEntries/${foreign}`),{...entry(a,'Secret'),revision:1});
    });
    assert.equal((await save('databaseEntries',randomUUID(),entry(b,'Foreign entry',{[field]:[foreign]}))).status,400);
    assert.equal((await save('databaseEntries',target,entry(a,'Person',{}, {archived:true,expectedRevision:1}))).status,200);
    assert.equal((await save('databaseEntries',randomUUID(),entry(b,'Archived',{[field]:[target]}))).status,400);
    assert.equal((await save('databaseEntries',source,entry(b,'Retained',{[field]:[target]},{expectedRevision:1}))).status,200);
    assert.equal((await save('databaseEntries',source,entry(b,'Stale',{}, {expectedRevision:1}))).status,409);
    assert.equal((await save('databases',b,definition(b,'Links',[{id:field,name:'Retargeted',type:'relation',options:[],targetDatabaseId:b}],{expectedRevision:1}))).status,400);
    assert.equal((await save('databases',a,definition(a,'People',[],{expectedRevision:1,archived:true}))).status,200);
    assert.equal((await save('databaseEntries',randomUUID(),entry(a,'Forbidden new'))).status,409);
    assert.equal((await api(member,'DELETE',`${prefix}/databases/${a}`)).status,405);
    assert.equal((await api(outsider,'GET',`${prefix}/databases/${a}`)).status,403);
    assert.equal((await api(outsider,'GET',`${prefix}/databaseEntries/${target}`)).status,403);
    assert.equal((await save('databases',randomUUID(),definition(a,'Outsider'),outsider)).status,403);
  });
  test('database relation projection and private receipts enforce RLS, policy and workspace-root deletion',async()=>{
    const id=randomUUID(),field=randomUUID(),target=randomUUID(),source=randomUUID();
    assert.equal((await save('databases',id,definition(id,'Graph',[{id:field,name:'Links',type:'relation',options:[],targetDatabaseId:id}]))).status,200);
    await save('databaseEntries',target,entry(id,'Target'));
    await save('databaseEntries',source,entry(id,'Source',{[field]:[target]}));
    assert.equal(await sql("select bool_and(relrowsecurity) from pg_class where relname in ('teamspace_documents','teamspace_store_state','teamspace_database_links');"),'t');
    const count=async(uid,table,where='true')=>(await sql(`set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);select count(*) from public.${table} where ${where};`)).split('\n').at(-1);
    assert.equal(await count(member,'teamspace_database_links'),'1');assert.equal(await count(outsider,'teamspace_database_links'),'0');
    assert.equal(await count(member,'teamspace_documents',`collection='${prefix}/databaseOperations'`),'0');
    assert.equal(await count(member,'teamspace_documents',`collection='${prefix}/databases'`),'1');
    for(const role of ['authenticated','service_role'])await assert.rejects(sql(`set role ${role};delete from public.teamspace_database_links;`),/permission denied/);
    await assert.rejects(sql(`set role authenticated;select public.teamspace_database_entry('alpha','${member}',true,true,'${target}');`),/permission denied/);
    await assert.rejects(sql(`set role service_role;select public.teamspace_index_database_relations();`),/permission denied/);
    await sql(`update auth.users set email_confirmed_at=null where id='${member}';`);
    assert.equal(await count(member,'teamspace_database_links'),'0');
    assert.equal((await api(member,'GET',`${prefix}/databaseEntries/${target}`)).status,403);
    await sql(`update auth.users set email_confirmed_at=now() where id='${member}';`);
    await db.runTransaction(async tx=>{tx.delete(db.doc(prefix));});
    assert.equal(await sql('select count(*) from public.teamspace_database_links;'),'0');
    assert.equal(await sql(`select count(*) from public.teamspace_documents where collection in ('${prefix}/databases','${prefix}/databaseEntries','${prefix}/databaseOperations');`),'0');
  });
  test('database entry pages bound body bytes, preserve keysets and offer body-free relation choices',async()=>{
    const id=randomUUID();
    await save('databases',id,definition(id,'Paged'));
    const ids=Array.from({length:23},()=>randomUUID());
    await db.runTransaction(async tx=>{
      for(const [index,entryId] of ids.entries())tx.create(db.doc(`${prefix}/databaseEntries/${entryId}`),{
        databaseId:id,entryKey:entryId,title:`Entry ${index}`,content:{blocks:Array.from({length:6},()=>({type:'paragraph',text:'x'.repeat(10000)}))},propertyValues:{},archived:false,revision:1
      });
    });
    const first=await api(member,'GET',`${prefix}/databases/${id}`);
    assert.equal(first.status,200);assert.ok(first.data.entries.length>0&&first.data.entries.length<20);
    assert.equal(first.data.truncated,true);assert.ok(first.data.nextCursor);
    const seen=new Set(first.data.entries.map(entry=>entry.id));
    let cursor=first.data.nextCursor;
    while(cursor){
      const page=await api(member,'GET',`${prefix}/databases/${id}?cursor=${cursor}`);
      assert.equal(page.status,200,JSON.stringify(page.data));
      for(const row of page.data.entries){assert.ok(!seen.has(row.id));seen.add(row.id);}
      assert.notEqual(page.data.nextCursor,cursor);cursor=page.data.nextCursor;
    }
    assert.equal(seen.size,23);
    const choices=await api(member,'GET',`${prefix}/databases/${id}?summary=1`);
    assert.equal(choices.data.entries.length,23);assert.deepEqual(choices.data.entries[0].content,{blocks:[]});
    assert.equal((await api(member,'GET',`${prefix}/databases/${id}?cursor=invalid`)).status,400);
    assert.equal((await api(member,'GET',`${prefix}/databases/${id}?sql=bad`)).status,400);
  });
};
