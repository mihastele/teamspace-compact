-- Persistent shared views and service-only indexed ticket reads.
begin;
select epoch from public.teamspace_store_state where singleton for update;
create table public.teamspace_saved_views (
  workspace_id text not null,
  id text not null check(id ~ '^[A-Za-z0-9_-]{1,128}$'),
  data jsonb not null check(jsonb_typeof(data)='object' and data ?& array['name','layout','groupBy','columns','query','revision','archived'] and jsonb_typeof(data->'query')='object' and jsonb_typeof(data->'columns')='array' and jsonb_typeof(data->'archived')='boolean' and (data->>'revision')::bigint>=1 and data->>'layout' in ('board','table','list')),
  version bigint not null,
  path text generated always as ('workspaces/'||workspace_id||'/savedViews/'||id) stored,
  workspace_path text generated always as ('workspaces/'||workspace_id) stored,
  primary key(workspace_id,id), unique(path),
  foreign key(workspace_path) references public.teamspace_documents(path) on delete cascade
);
alter table public.teamspace_saved_views enable row level security;
revoke all on public.teamspace_saved_views from public,anon,authenticated,service_role;
grant select on public.teamspace_saved_views to authenticated,service_role;
create policy workspace_member_read on public.teamspace_saved_views for select to authenticated using(public.teamspace_can_read(workspace_path));
create or replace view public.teamspace_all_records with(security_invoker=true) as
  select path,data,version,workspace_id,collection from public.teamspace_documents
  union all select t.path,t.data||case when t.has_properties then jsonb_build_object('propertyValues',public.teamspace_task_values(t.workspace_id,t.id)) else '{}'::jsonb end,t.version,t.workspace_id,'workspaces/'||t.workspace_id||'/tasks' from public.teamspace_tasks t
  union all select p.path,p.data,p.version,p.workspace_id,'workspaces/'||p.workspace_id||'/projects' from public.teamspace_projects p
  union all select 'workspaces/'||f.workspace_id||'/boardProperties/'||f.id::text,
    f.meta||jsonb_build_object('name',f.name,'type',f.type,'revision',f.revision,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id::text,'name',o.label,'color',o.color,'archived',o.archived) order by o.position) from public.teamspace_field_options o where o.workspace_id=f.workspace_id and o.field_id=f.id),'[]'::jsonb))||case when f.project_id is null then '{}'::jsonb else jsonb_build_object('projectId',f.project_id) end,
    f.revision,f.workspace_id,'workspaces/'||f.workspace_id||'/boardProperties' from public.teamspace_field_definitions f
  union all select path,data,version,workspace_id,'workspaces/'||workspace_id||'/savedViews' from public.teamspace_saved_views;
create or replace function public.teamspace_put_record(p_path text,p_data jsonb,p_version bigint) returns void language plpgsql set search_path=pg_catalog,public as $$
declare parts text[]:=string_to_array(p_path,'/'); w text:=parts[2]; entity text:=parts[4]; item record; opt record; def public.teamspace_field_definitions%rowtype; scalar text; cleared boolean;
begin
  if array_length(parts,1)=4 and parts[1]='workspaces' and parts[3]='savedViews' then
    insert into public.teamspace_saved_views(workspace_id,id,data,version) values(w,entity,p_data,p_version)
      on conflict(workspace_id,id) do update set data=excluded.data,version=excluded.version;
  elsif array_length(parts,1)=4 and parts[1]='workspaces' and parts[3]='projects' then
    insert into public.teamspace_projects(workspace_id,id,data,version) values(w,entity,p_data,p_version)
      on conflict(workspace_id,id) do update set data=excluded.data,version=excluded.version;
  elsif array_length(parts,1)=4 and parts[1]='workspaces' and parts[3]='boardProperties' then
    insert into public.teamspace_field_definitions(workspace_id,id,project_id,name,type,revision,meta)
      values(w,entity::uuid,p_data->>'projectId',p_data->>'name',p_data->>'type',(p_data->>'revision')::bigint,p_data-array['name','type','revision','projectId','options'])
      on conflict(workspace_id,id) do update set name=excluded.name,type=excluded.type,revision=excluded.revision,project_id=excluded.project_id,meta=excluded.meta;
    if exists(select 1 from public.teamspace_field_options o where o.workspace_id=w and o.field_id=entity::uuid and not exists(select 1 from jsonb_array_elements(p_data->'options') x where x->>'id'=o.id::text)) then raise exception 'Existing options cannot be removed'; end if;
    for opt in select value,ordinality-1 as pos from jsonb_array_elements(p_data->'options') with ordinality loop
      insert into public.teamspace_field_options(workspace_id,field_id,id,label,color,position,archived)
        values(w,entity::uuid,(opt.value->>'id')::uuid,opt.value->>'name',coalesce(opt.value->>'color','gray'),opt.pos,coalesce((opt.value->>'archived')::boolean,false))
        on conflict(workspace_id,field_id,id) do update set label=excluded.label,color=excluded.color,position=excluded.position,archived=excluded.archived;
    end loop;
  elsif array_length(parts,1)=4 and parts[1]='workspaces' and parts[3]='tasks' then
    insert into public.teamspace_tasks(workspace_id,id,data,has_properties,version) values(w,entity,p_data-'propertyValues',p_data ? 'propertyValues',p_version)
      on conflict(workspace_id,id) do update set data=excluded.data,has_properties=excluded.has_properties,version=excluded.version;
    delete from public.teamspace_task_field_values where workspace_id=w and task_id=entity;
    for item in select key,value from jsonb_each(coalesce(p_data->'propertyValues','{}'::jsonb)) loop
      select * into strict def from public.teamspace_field_definitions where workspace_id=w and id=item.key::uuid;
      cleared:=item.value='null'::jsonb; scalar:=item.value #>> '{}';
      if not cleared and ((def.type in ('text','longText','url','date','person','relation','select') and jsonb_typeof(item.value)<>'string') or (def.type='number' and jsonb_typeof(item.value)<>'number') or (def.type='checkbox' and jsonb_typeof(item.value)<>'boolean') or (def.type='multiSelect' and jsonb_typeof(item.value)<>'array')) then raise exception 'Invalid field value type'; end if;
      insert into public.teamspace_task_field_values(workspace_id,task_id,field_id,type,cleared,text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)
        values(w,entity,def.id,def.type,cleared,
          case when not cleared and def.type in ('text','longText','url') then scalar end,
          case when not cleared and def.type='number' then scalar::numeric end,
          case when not cleared and def.type='date' then scalar::date end,
          case when not cleared and def.type='checkbox' then scalar::boolean end,
          case when not cleared and def.type='person' then scalar end,
          case when not cleared and def.type='relation' then scalar end,
          case when not cleared and def.type='select' then scalar::uuid end);
      if not cleared and def.type='multiSelect' then
        for opt in select value,ordinality-1 as pos from jsonb_array_elements_text(item.value) with ordinality loop
          insert into public.teamspace_task_field_selections(workspace_id,task_id,field_id,option_id,position) values(w,entity,def.id,opt.value::uuid,opt.pos);
        end loop;
      end if;
    end loop;
  else
    insert into public.teamspace_documents(path,data,version) values(p_path,p_data,p_version) on conflict(path) do update set data=excluded.data,version=excluded.version;
  end if;
end $$;
revoke all on function public.teamspace_put_record(text,jsonb,bigint) from public,anon,authenticated,service_role;

create or replace function public.teamspace_store_commit(p_epoch bigint,p_writes jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint; operation jsonb; existing jsonb; replacement jsonb; field record; resolved jsonb; stamp bigint := floor(extract(epoch from clock_timestamp())*1000);
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for update;
  if current_epoch<>p_epoch then return jsonb_build_object('epoch',current_epoch::text,'rows','[]'::jsonb,'conflict',true); end if;
  if jsonb_array_length(p_writes)>500 then raise exception 'Transaction write limit exceeded'; end if;
  for operation in select value from jsonb_array_elements(p_writes) loop
    select data into existing from public.teamspace_all_records where path=operation->>'path';
    if operation->>'kind'='delete' then
      if operation->>'path' ~ '^workspaces/[^/]+/(projects|savedViews)/[^/]+$' then raise exception 'Projects and views must be archived';
      elsif operation->>'path' ~ '^workspaces/[^/]+/tasks/[^/]+$' then delete from public.teamspace_tasks where path=operation->>'path';
      elsif operation->>'path' ~ '^workspaces/[^/]+/boardProperties/[^/]+$' then delete from public.teamspace_field_definitions where workspace_id=split_part(operation->>'path','/',2) and id=split_part(operation->>'path','/',4)::uuid;
      else delete from public.teamspace_documents where path=operation->>'path'; end if;
      continue;
    end if;
    if operation->>'kind'='create' and existing is not null then raise exception 'Document already exists'; end if;
    if operation->>'kind'='update' and existing is null then raise exception 'Document not found'; end if;
    if operation->>'kind' not in ('create','set','update') then raise exception 'Invalid operation'; end if;
    replacement := case when operation->>'kind'='update' or coalesce((operation->>'merge')::boolean,false) then coalesce(existing,'{}'::jsonb) else '{}'::jsonb end;
    for field in select key,value from jsonb_each(operation->'data') loop
      resolved:=case when coalesce((operation->>'merge')::boolean,false) then public.teamspace_merge_value(field.value,existing->field.key,stamp) else public.teamspace_resolve_value(field.value,existing->field.key,stamp) end;
      if resolved is null then replacement:=replacement-field.key; else replacement:=replacement||jsonb_build_object(field.key,resolved); end if;
    end loop;
    perform public.teamspace_put_record(operation->>'path',replacement,current_epoch+1);
  end loop;
  if jsonb_array_length(p_writes)>0 then update public.teamspace_store_state set epoch=current_epoch+1 where singleton; current_epoch:=current_epoch+1; end if;
  return jsonb_build_object('epoch',current_epoch::text,'rows','[]'::jsonb);
end $$;

create or replace function public.teamspace_store_delete_collection(p_path text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint;
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for update;
  delete from public.teamspace_saved_views where left(path,length(p_path)+1)=p_path||'/';
  delete from public.teamspace_tasks where left(path,length(p_path)+1)=p_path||'/';
  delete from public.teamspace_field_definitions where left('workspaces/'||workspace_id||'/boardProperties/'||id::text,length(p_path)+1)=p_path||'/';
  delete from public.teamspace_projects where left(path,length(p_path)+1)=p_path||'/';
  delete from public.teamspace_documents where left(path,length(p_path)+1)=p_path||'/';
  update public.teamspace_store_state set epoch=current_epoch+1 where singleton;
  return jsonb_build_object('epoch',(current_epoch+1)::text,'rows','[]'::jsonb);
end $$;


alter table public.teamspace_documents drop constraint teamspace_canonical_records_not_documents;
alter table public.teamspace_documents add constraint teamspace_canonical_records_not_documents check(collection !~ '^workspaces/[^/]+/(projects|boardProperties|tasks|savedViews)$');

create function public.teamspace_ticket_context(p_workspace text,p_uid text,p_required boolean,p_verified boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint; required boolean;
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for share;
  if not exists(select 1 from public.teamspace_documents where path='workspaces/'||p_workspace)
    or not exists(select 1 from public.teamspace_documents where path='workspaces/'||p_workspace||'/members/'||p_uid) then return jsonb_build_object('error','forbidden'); end if;
  select coalesce((data->>'emailConfirmationRequired')::boolean,true) into required from public.teamspace_documents where path='security/policy';
  if coalesce(required,true)<>p_required then return jsonb_build_object('error','policy_mismatch'); end if;
  if p_required and not p_verified then return jsonb_build_object('error','email_confirmation_required'); end if;
  return jsonb_build_object('epoch',current_epoch::text,'fields',coalesce((select jsonb_agg(data||jsonb_build_object('id',split_part(path,'/',4))) from public.teamspace_all_records where collection='workspaces/'||p_workspace||'/boardProperties'),'[]'::jsonb));
end $$;
-- The caller is the trusted compiler, never a browser/model-provided SQL string.
-- All field IDs, values and cursor keys travel in p_parameters, bound with USING.
create function public.teamspace_ticket_query(p_workspace text,p_uid text,p_required boolean,p_verified boolean,p_epoch text,p_where text,p_order text,p_keys text,p_parameters jsonb,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare context jsonb; rows jsonb;
begin
  context:=public.teamspace_ticket_context(p_workspace,p_uid,p_required,p_verified);
  if context ? 'error' then return context; end if;
  if context->>'epoch'<>p_epoch then return jsonb_build_object('conflict',true); end if;
  if p_limit<1 or p_limit>101 or length(p_where)>200000 or length(p_order)>30000 or length(p_keys)>30000 or jsonb_array_length(p_parameters)>1000 then raise exception 'Query bounds exceeded'; end if;
  execute 'select coalesce(jsonb_agg(result),''[]''::jsonb) from (select t.id,t.data||case when t.has_properties then jsonb_build_object(''propertyValues'',public.teamspace_task_values(t.workspace_id,t.id)) else ''{}''::jsonb end as data,'||p_keys||' as keys from public.teamspace_tasks t where t.workspace_id=$2 and not coalesce((t.data->>''deleting'')::boolean,false) and ('||p_where||') order by '||p_order||' limit $3) result'
    into rows using p_parameters,p_workspace,p_limit;
  return jsonb_build_object('rows',rows,'epoch',context->>'epoch');
end $$;
revoke all on function public.teamspace_ticket_context(text,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.teamspace_ticket_query(text,text,boolean,boolean,text,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.teamspace_ticket_context(text,text,boolean,boolean) to service_role;
grant execute on function public.teamspace_ticket_query(text,text,boolean,boolean,text,text,text,text,jsonb,integer) to service_role;
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.teamspace_saved_views; end if; end $$;
update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
