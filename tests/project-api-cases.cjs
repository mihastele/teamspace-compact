const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = function(test,{api,member,outsider,prefix,read,sql,db}) {
  const create = (name='Project',operationId=randomUUID())=>api(member,'POST',`${prefix}/projects`,{name,operationId});
  const field = (id,type,extra={})=>api(member,'PUT',`${prefix}/boardProperties/${id}`,{name:type,type,options:[],expectedRevision:0,...extra});
  test('projects inherit access, converge retries, enforce reviewed revisions and archive reversibly',async()=>{
    const operationId=randomUUID();
    const responses=await Promise.all([create('Release',operationId),create('Release',operationId)]);
    for(const response of responses) assert.equal(response.status,201,JSON.stringify(response.data));
    const project=responses[0].data.project,path=`${prefix}/projects/${project.id}`;
    assert.equal(responses[1].data.project.id,project.id);
    assert.equal((await create('Changed',operationId)).status,409);
    assert.equal((await api(outsider,'GET',path)).status,403);
    const task=await api(member,'POST',`${prefix}/tasks`,{title:'Linked',projectId:project.id,priority:'high',estimate:2.5});
    assert.equal(task.status,201,JSON.stringify(task.data));
    const archived=await api(member,'PATCH',path,{archived:true,expectedRevision:1});
    assert.equal(archived.status,200);
    assert.equal((await api(member,'PATCH',path,{name:'Stale',expectedRevision:1})).status,409);
    assert.equal((await api(member,'POST',`${prefix}/tasks`,{title:'Rejected',projectId:project.id})).status,400);
    assert.equal((await api(member,'PATCH',`${prefix}/tasks/${task.data.task.id}`,{title:'Retained'})).status,200);
    assert.equal((await read(`${prefix}/tasks/${task.data.task.id}`)).projectId,project.id);
    assert.equal((await api(member,'DELETE',path)).status,405);
    assert.equal((await api(member,'PATCH',path,{archived:false,expectedRevision:2})).status,200);
    assert.equal((await api(member,'GET',`${prefix}/projects`)).data.projects.length,1);
    assert.equal((await api(member,'GET',`${prefix}/snapshot`)).data.projects[0].id,project.id);
    const raced=await Promise.all([
      api(member,'PATCH',path,{archived:true,expectedRevision:3}),
      api(member,'POST',`${prefix}/tasks`,{title:'Racing assignment',projectId:project.id})
    ]);
    assert.equal(raced[0].status,200);assert.ok([201,400].includes(raced[1].status));
    assert.equal((await api(member,'POST',`${prefix}/tasks`,{title:'After archive',projectId:project.id})).status,400);
  });

  test('all ten custom field types round trip as normalized values and project scopes stay immutable',async()=>{
    const project=(await create()).data.project;
    const options=[{id:randomUUID(),name:'First',color:'blue'},{id:randomUUID(),name:'Second',color:'red'}];
    const types=['text','longText','number','date','checkbox','select','multiSelect','person','relation','url'];
    const ids={};
    for(const type of types){ids[type]=randomUUID();const result=await field(ids[type],type,{...(type.includes('elect')?{options}:{}),...(type==='number'?{projectId:project.id}:{})});assert.equal(result.status,201,JSON.stringify(result.data));}
    const values={text:'short',longText:'long\ntext',number:-2.5,date:'2028-02-29',checkbox:false,select:options[0].id,multiSelect:options.map(option=>option.id),person:member,relation:project.id,url:'https://example.test/a'};
    const propertyValues=Object.fromEntries(types.map(type=>[ids[type],values[type]]));
    assert.equal((await api(member,'POST',`${prefix}/tasks`,{title:'Wrong scope',propertyValues:{[ids.number]:2}})).status,400);
    const response=await api(member,'POST',`${prefix}/tasks`,{title:'Typed',projectId:project.id,propertyValues});
    assert.equal(response.status,201,JSON.stringify(response.data));
    const path=`${prefix}/tasks/${response.data.task.id}`;
    assert.deepEqual((await api(member,'GET',path)).data.task.propertyValues,propertyValues);
    assert.equal(await sql(`select count(*) from public.teamspace_task_field_values where task_id='${response.data.task.id}';`),'10');
    assert.equal(await sql(`select count(*) from public.teamspace_task_field_selections where task_id='${response.data.task.id}';`),'2');
    assert.equal(await sql(`select count(*) from public.teamspace_documents where collection='${prefix}/tasks';`),'0');
    assert.equal((await api(member,'PATCH',path,{propertyValues:{[ids.person]:outsider}})).status,400);
    assert.equal((await api(member,'PATCH',path,{propertyValues:{[ids.relation]:'foreign'}})).status,400);
    assert.equal((await api(member,'PUT',`${prefix}/boardProperties/${ids.number}`,{name:'number',type:'number',projectId:null,options:[],expectedRevision:1})).status,409);
    assert.equal((await api(member,'PATCH',path,{projectId:null})).status,200);
    assert.equal((await read(path)).propertyValues[ids.number],-2.5);
    assert.equal((await api(member,'PATCH',path,{propertyValues:{[ids.number]:3}})).status,400);
    assert.equal((await api(member,'PATCH',path,{propertyValues:{[ids.number]:null,[ids.multiSelect]:[]}})).status,200);
    assert.equal((await read(path)).propertyValues[ids.number],null);
    assert.deepEqual((await read(path)).propertyValues[ids.multiSelect],[]);
    assert.equal((await api(member,'DELETE',path)).status,200);
    assert.equal(await sql(`select count(*) from public.teamspace_task_field_values where task_id='${response.data.task.id}';`),'0');
    assert.equal(await sql(`select count(*) from public.teamspace_task_field_selections where task_id='${response.data.task.id}';`),'0');
  });

  test('option rename swaps, order, colors and archival preserve IDs and historic selections',async()=>{
    const id=randomUUID(),options=[{id:randomUUID(),name:'One'},{id:randomUUID(),name:'Two'}];
    assert.equal((await field(id,'multiSelect',{options})).status,201);
    const task=await api(member,'POST',`${prefix}/tasks`,{title:'History',propertyValues:{[id]:[options[0].id]}});
    const next=[{...options[1],name:'One',color:'green'},{...options[0],name:'Two',color:'purple',archived:true}];
    const saved=await api(member,'PUT',`${prefix}/boardProperties/${id}`,{name:'Labels',type:'multiSelect',options:next,expectedRevision:1});
    assert.equal(saved.status,200,JSON.stringify(saved.data));
    assert.deepEqual((await read(`${prefix}/boardProperties/${id}`)).options,next.map(option=>({color:'gray',archived:false,...option})));
    assert.equal((await api(member,'POST',`${prefix}/tasks`,{title:'New selection',propertyValues:{[id]:[options[0].id]}})).status,400);
    assert.equal((await api(member,'PATCH',`${prefix}/tasks/${task.data.task.id}`,{propertyValues:{[id]:[options[0].id,options[1].id]}})).status,200);
    assert.equal((await api(member,'PATCH',`${prefix}/tasks/${task.data.task.id}`,{propertyValues:{[id]:[]}})).status,200);
    assert.equal((await api(member,'PATCH',`${prefix}/tasks/${task.data.task.id}`,{propertyValues:{[id]:[options[0].id]}})).status,400);
  });

  test('every canonical table enforces member reads, confirmation and direct write denial',async()=>{
    const project=(await create()).data.project,id=randomUUID(),option={id:randomUUID(),name:'Choice'};
    await field(id,'multiSelect',{options:[option]});
    await api(member,'POST',`${prefix}/tasks`,{title:'Rows',projectId:project.id,propertyValues:{[id]:[option.id]}});
    const tables=['teamspace_projects','teamspace_tasks','teamspace_field_definitions','teamspace_field_options','teamspace_task_field_values','teamspace_task_field_selections'];
    for(const table of tables){
      assert.equal(await sql(`select relrowsecurity from pg_class where relname='${table}';`),'t');
      for(const [uid,expected] of [[member,true],[outsider,false]]){
        const count=(await sql(`set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false);select count(*)>0 from public.${table};`)).split('\n').at(-1);
        assert.equal(count,expected?'t':'f',table);
      }
      for(const role of ['authenticated','service_role'])await assert.rejects(sql(`set role ${role};delete from public.${table};`),/permission denied/);
    }
    await assert.rejects(sql(`set role service_role;select public.teamspace_put_record('x','{}',1);`),/permission denied/);
    await sql(`update auth.users set email_confirmed_at=null where id='${member}';`);
    assert.equal((await sql(`set role authenticated;select set_config('request.jwt.claim.sub','${member}',false);select count(*) from public.teamspace_all_records where collection='${prefix}/tasks';`)).split('\n').at(-1),'0');
    await db.recursiveDelete(db.doc(prefix));
    for(const table of tables)assert.equal(await sql(`select count(*) from public.${table};`),'0');
  });
};
