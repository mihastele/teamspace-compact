const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=function(test,{api,member,outsider,owner,prefix,read,sql,rpc,compileTicketQuery}){
  const query=(filter={and:[]},sort=[])=>({version:1,filter,sort,timeZone:'UTC'});
  const run=(q,extra={},uid=member)=>api(uid,'POST',`${prefix}/tasks/query`,{query:q,...extra});
  test('indexed queries compose typed operators and normalized option selections without trusting raw SQL',async()=>{
    const fields={};
    const options=[{id:randomUUID(),name:'Web'},{id:randomUUID(),name:'Android'}];
    for(const type of ['text','number','date','checkbox','select','multiSelect']){
      const id=fields[type]=randomUUID();
      assert.equal((await api(member,'PUT',`${prefix}/boardProperties/${id}`,{name:type,type,options:type.includes('elect')?options:[],expectedRevision:0})).status,201);
    }
    const values=Object.fromEntries(Object.entries({text:"Literal %' OR true --",number:-0.25,date:'2026-10-20',checkbox:false,select:options[0].id,multiSelect:options.map(option=>option.id)}).map(([type,value])=>[fields[type],value]));
    const task=await api(member,'POST',`${prefix}/tasks`,{title:'Selected',propertyValues:values});assert.equal(task.status,201);
    const check=async(filter,expected)=>{const result=await run(query(filter));assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data.tasks.map(task=>task.id).sort(),expected.sort());};
    const f=(type,op,value)=>({field:`custom:${fields[type]}`,op,...(value===undefined?{}:{value})});
    await check({and:[f('number','gt',-1),f('date','between',['2026-10-19','2026-10-21']),{or:[f('checkbox','eq',false),{field:'status',op:'eq',value:'done'}]},f('multiSelect','containsAll',options.map(option=>option.id))]},[task.data.task.id]);
    await check(f('multiSelect','containsAny',[options[1].id]),[task.data.task.id]);
    await check(f('text','contains',"%' OR true"),[task.data.task.id]);
    await check(f('select','in',[options[0].id]),[task.data.task.id]);
    await check(f('checkbox','isEmpty'),['task']);
    await check(f('number','neq',-0.25),['task']);
    await check(f('text','notContains','Literal'),['task']);
    assert.equal((await run(query(f('select','eq',randomUUID())))).status,400);
    assert.equal((await api(member,'POST',`${prefix}/tasks/query`,{query:query(),sql:'select *'})).status,400);
    assert.equal((await run(query(),{},outsider)).status,403);
  });
  test('query pagination uses stable multi-sort keysets, nulls last, and binds cursors to viewer/query/schema',async()=>{
    for(const [title,estimate]of [['A',0],['B',0.01],['C',0.1],['D',0.11],['E',null]])assert.equal((await api(member,'POST',`${prefix}/tasks`,{title,estimate})).status,201);
    const q=query({field:'title',op:'neq',value:'Original'},[{field:'estimate',direction:'asc'},{field:'title',direction:'asc'}]);
    const first=await run(q,{limit:2});assert.equal(first.status,200,JSON.stringify(first.data));assert.deepEqual(first.data.tasks.map(task=>task.title),['A','B']);
    const second=await run(q,{limit:2,cursor:first.data.nextCursor});assert.deepEqual(second.data.tasks.map(task=>task.title),['C','D']);
    const last=await run(q,{limit:2,cursor:second.data.nextCursor});assert.deepEqual(last.data.tasks.map(task=>task.title),['E']);assert.equal(last.data.nextCursor,null);
    assert.equal((await run({...q,sort:[]},{cursor:first.data.nextCursor})).status,409);
    assert.equal((await run(q,{cursor:first.data.nextCursor},owner)).status,409);
    const descending=await run({...q,sort:[{field:'estimate',direction:'desc'}]});assert.deepEqual(descending.data.tasks.map(task=>task.title),['D','C','B','A','E']);
    for(const title of ['Long A','Long B'])assert.equal((await api(member,'POST',`${prefix}/tasks`,{title,description:'\u0001'.repeat(10000)})).status,201);
    const longQuery=query({field:'title',op:'contains',value:'Long'},[{field:'description',direction:'asc'}]);
    const longFirst=await run(longQuery,{limit:1});assert.equal(longFirst.status,200);assert.ok(longFirst.data.nextCursor.length>16384);
    const longSecond=await run(longQuery,{limit:1,cursor:longFirst.data.nextCursor});assert.equal(longSecond.status,200,JSON.stringify(longSecond.data));assert.notEqual(longFirst.data.tasks[0].id,longSecond.data.tasks[0].id);

  });
  test('saved views persist revisions and defaults idempotently without overwriting customized or archived views',async()=>{
    assert.equal((await api(member,'POST',`${prefix}/views/seed`,{})).status,200);
    assert.equal((await api(member,'POST',`${prefix}/views/seed`,{})).data.created,0);
    const views=(await api(member,'GET',`${prefix}/views`)).data.views;assert.equal(views.length,5);
    const view=views[0],path=`${prefix}/views/${view.id}`;
    const {name,layout,groupBy,columns,query}=view;
    const config={name:'Custom',layout,groupBy,columns,query};
    assert.equal((await api(member,'PATCH',path,{config,expectedRevision:1,archived:true})).status,200);
    assert.equal((await api(member,'PATCH',path,{config,expectedRevision:1})).status,409);
    await api(member,'POST',`${prefix}/views/seed`,{});
    const saved=(await api(member,'GET',path)).data.view;assert.equal(saved.name,'Custom');assert.equal(saved.archived,true);assert.equal(saved.revision,2);
    assert.equal((await api(outsider,'GET',path)).status,403);
    const operationId=randomUUID(),fresh={name,layout,groupBy,columns,query};
    const created=await api(member,'POST',`${prefix}/views`,{config:fresh,operationId});
    assert.equal(created.status,201,JSON.stringify(created.data));
    assert.equal((await api(member,'POST',`${prefix}/views`,{config:fresh,operationId})).data.view.id,created.data.view.id);
    assert.equal((await api(member,'POST',`${prefix}/views`,{config:{...fresh,name:'Different'},operationId})).status,409);
    assert.ok(await read(`${prefix}/savedViews/${created.data.view.id}`));
    assert.equal((await api(member,'DELETE',path)).status,405);
    assert.equal(await sql("select relrowsecurity from pg_class where relname='teamspace_saved_views';"),'t');
    for(const role of ['authenticated','service_role'])await assert.rejects(sql(`set role ${role};delete from public.teamspace_saved_views;`),/permission denied/);
    await assert.rejects(sql(`set role authenticated;select public.teamspace_ticket_context('alpha','${member}',true,true);`),/permission denied/);
    assert.equal((await sql(`set role authenticated;select set_config('request.jwt.claim.sub','${outsider}',false);select count(*) from public.teamspace_saved_views;`)).split('\n').at(-1),'0');
    await sql(`delete from public.teamspace_documents where path='${prefix}';`);
    assert.equal(await sql('select count(*) from public.teamspace_saved_views;'),'0');
  });
  test('canonical query plans use project and typed-number indexes rather than workspace JSON snapshots',async()=>{
    const field=randomUUID();
    await api(member,'PUT',`${prefix}/boardProperties/${field}`,{name:'Measure',type:'number',options:[],expectedRevision:0});
    const project=(await api(member,'POST',`${prefix}/projects`,{name:'Target'})).data.project;
    await sql(`insert into public.teamspace_tasks(workspace_id,id,data,has_properties,version) select 'alpha','fixture_'||n,jsonb_build_object('title','Fixture '||n,'status','todo','projectId',case when n%100=0 then '${project.id}' else null end),true,1 from generate_series(1,3000)n;
      insert into public.teamspace_task_field_values(workspace_id,task_id,field_id,type,number_value) select 'alpha','fixture_'||n,'${field}','number',n from generate_series(1,3000)n;
      analyze public.teamspace_tasks;analyze public.teamspace_task_field_values;update public.teamspace_store_state set epoch=epoch+1;`);
    const definitions=[{id:field,type:'number',name:'Measure',options:[],revision:1}];
    for(const [filter,index]of [[{field:'projectId',op:'eq',value:project.id},'teamspace_tasks_project'],[{field:`custom:${field}`,op:'gt',value:2998},'teamspace_values_number']]){
      const compiled=compileTicketQuery(query(filter),definitions);
      const params="'"+JSON.stringify(compiled.parameters).replace(/'/g,"''")+"'::jsonb";
      const plan=await sql(`explain (format json) select t.id from public.teamspace_tasks t where t.workspace_id='alpha' and ${compiled.where.replaceAll('$1',params)};`);
      assert.match(plan,new RegExp(index));
      assert.doesNotMatch(plan,/teamspace_all_records/);
    }
    const result=await run(query({field:`custom:${field}`,op:'gt',value:2998}));assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.tasks.length,2);
  });
  test('indexed reads reauthorize revocation, confirmation policy and epoch after compiler context reads',async()=>{
    const input={p_workspace:'alpha',p_uid:member,p_required:true,p_verified:true};
    const context=await rpc('teamspace_ticket_context',input),compiled=compileTicketQuery(query(),[]);
    const params={...input,p_epoch:context.epoch,p_where:compiled.where,p_order:compiled.order,p_keys:compiled.keys,p_parameters:compiled.parameters,p_limit:10};
    assert.equal((await rpc('teamspace_ticket_query',{...params,p_verified:false})).error,'email_confirmation_required');
    assert.equal((await rpc('teamspace_ticket_query',{...params,p_required:false})).error,'policy_mismatch');
    await api(owner,'PATCH',`${prefix}/tasks/task`,{title:'Concurrent'});
    assert.equal((await rpc('teamspace_ticket_query',params)).conflict,true);
    await api(owner,'DELETE',`${prefix}/members/${member}`);
    assert.equal((await rpc('teamspace_ticket_query',params)).error,'forbidden');
  });

};
