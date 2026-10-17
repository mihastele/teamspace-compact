-- Canonical PostgreSQL records, preserving document/API identities.
begin;
select epoch from public.teamspace_store_state where singleton for update;

create table public.teamspace_projects (
  workspace_id text not null,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  data jsonb not null check (jsonb_typeof(data)='object'),
  version bigint not null,
  path text generated always as ('workspaces/'||workspace_id||'/projects/'||id) stored,
  workspace_path text generated always as ('workspaces/'||workspace_id) stored,
  name text generated always as (data->>'name') stored not null,
  archived boolean generated always as (coalesce((data->>'archived')::boolean,false)) stored,
  primary key(workspace_id,id), unique(path),
  foreign key(workspace_path) references public.teamspace_documents(path) on delete cascade,
  check(length(name) between 1 and 200)
);
create table public.teamspace_tasks (
  workspace_id text not null,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  data jsonb not null check (jsonb_typeof(data)='object' and not(data ? 'propertyValues')),
  has_properties boolean not null default false,
  version bigint not null,
  path text generated always as ('workspaces/'||workspace_id||'/tasks/'||id) stored,
  workspace_path text generated always as ('workspaces/'||workspace_id) stored,
  project_id text generated always as (data->>'projectId') stored,
  status text generated always as (data->>'status') stored,
  assignee_id text generated always as (data->>'assigneeId') stored,
  due_date text generated always as (data->>'dueDate') stored,
  priority text generated always as (data->>'priority') stored,
  primary key(workspace_id,id), unique(path),
  foreign key(workspace_path) references public.teamspace_documents(path) on delete cascade,
  foreign key(workspace_id,project_id) references public.teamspace_projects(workspace_id,id),
  check(status is null or status in ('todo','doing','done')),
  check(priority is null or priority in ('none','low','medium','high','urgent'))
);
create index teamspace_tasks_project on public.teamspace_tasks(workspace_id,project_id,id);
create index teamspace_tasks_assignee on public.teamspace_tasks(workspace_id,assignee_id,id);
create index teamspace_tasks_status on public.teamspace_tasks(workspace_id,status,id);
create index teamspace_tasks_priority on public.teamspace_tasks(workspace_id,priority,id);
create index teamspace_tasks_due on public.teamspace_tasks(workspace_id,due_date,id);
create index teamspace_projects_name on public.teamspace_projects(workspace_id,archived,lower(name),id);

create table public.teamspace_field_definitions (
  workspace_id text not null,
  id uuid not null,
  project_id text,
  name text not null check(length(name) between 1 and 80),
  type text not null check(type in ('text','longText','number','date','checkbox','select','multiSelect','person','relation','url')),
  revision bigint not null check(revision>=1),
  meta jsonb not null default '{}'::jsonb,
  workspace_path text generated always as ('workspaces/'||workspace_id) stored,
  primary key(workspace_id,id), unique(workspace_id,id,type),
  foreign key(workspace_path) references public.teamspace_documents(path) on delete cascade,
  foreign key(workspace_id,project_id) references public.teamspace_projects(workspace_id,id)
);
create unique index teamspace_fields_name on public.teamspace_field_definitions(workspace_id,coalesce(project_id,''),lower(name));
create table public.teamspace_field_options (
  workspace_id text not null,
  field_id uuid not null,
  id uuid not null,
  label text not null check(length(label) between 1 and 80),
  color text not null default 'gray' check(color in ('gray','red','orange','yellow','green','blue','purple','pink')),
  position integer not null check(position between 0 and 49),
  archived boolean not null default false,
  label_key text generated always as (lower(label)) stored,
  primary key(workspace_id,field_id,id),
  unique(workspace_id,field_id,label_key) deferrable initially deferred,
  foreign key(workspace_id,field_id) references public.teamspace_field_definitions(workspace_id,id) on delete cascade
);
create table public.teamspace_task_field_values (
  workspace_id text not null,
  task_id text not null,
  field_id uuid not null,
  type text not null,
  cleared boolean not null default false,
  text_value text,
  number_value numeric,
  date_value date,
  checkbox_value boolean,
  person_value text,
  relation_value text,
  option_value uuid,
  primary key(workspace_id,task_id,field_id), unique(workspace_id,task_id,field_id,type),
  foreign key(workspace_id,task_id) references public.teamspace_tasks(workspace_id,id) on delete cascade,
  foreign key(workspace_id,field_id,type) references public.teamspace_field_definitions(workspace_id,id,type),
  foreign key(workspace_id,field_id,option_value) references public.teamspace_field_options(workspace_id,field_id,id),
  foreign key(workspace_id,relation_value) references public.teamspace_projects(workspace_id,id),
  check(case when cleared then num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=0
    when type='multiSelect' then num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=0
    when type in ('text','longText','url') then text_value is not null and num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=1
    when type='number' then number_value is not null and num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=1
    when type='date' then date_value is not null and num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=1
    when type='checkbox' then checkbox_value is not null and num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=1
    when type='person' then person_value is not null and num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=1
    when type='relation' then relation_value is not null and num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=1
    when type='select' then option_value is not null and num_nonnulls(text_value,number_value,date_value,checkbox_value,person_value,relation_value,option_value)=1 else false end)
);
create table public.teamspace_task_field_selections (
  workspace_id text not null,
  task_id text not null,
  field_id uuid not null,
  type text not null default 'multiSelect' check(type='multiSelect'),
  option_id uuid not null,
  position integer not null check(position between 0 and 49),
  primary key(workspace_id,task_id,field_id,option_id),
  foreign key(workspace_id,task_id,field_id,type) references public.teamspace_task_field_values(workspace_id,task_id,field_id,type) on delete cascade,
  foreign key(workspace_id,field_id,option_id) references public.teamspace_field_options(workspace_id,field_id,id)
);
create index teamspace_values_text on public.teamspace_task_field_values(workspace_id,field_id,text_value,task_id);
create index teamspace_values_number on public.teamspace_task_field_values(workspace_id,field_id,number_value,task_id);
create index teamspace_values_date on public.teamspace_task_field_values(workspace_id,field_id,date_value,task_id);
create index teamspace_values_person on public.teamspace_task_field_values(workspace_id,field_id,person_value,task_id);
create index teamspace_values_relation on public.teamspace_task_field_values(workspace_id,field_id,relation_value,task_id);
create index teamspace_values_option on public.teamspace_task_field_values(workspace_id,field_id,option_value,task_id);
create index teamspace_selections_option on public.teamspace_task_field_selections(workspace_id,field_id,option_id,task_id);

create function public.teamspace_task_values(p_workspace text,p_task text) returns jsonb language sql stable set search_path=pg_catalog,public as $$
  select coalesce(jsonb_object_agg(v.field_id::text,case when v.cleared then 'null'::jsonb
    when v.type='multiSelect' then coalesce((select jsonb_agg(s.option_id::text order by s.position) from public.teamspace_task_field_selections s where s.workspace_id=v.workspace_id and s.task_id=v.task_id and s.field_id=v.field_id),'[]'::jsonb)
    when v.type in ('text','longText','url') then to_jsonb(v.text_value)
    when v.type='number' then to_jsonb(v.number_value)
    when v.type='date' then to_jsonb(to_char(v.date_value,'YYYY-MM-DD'))
    when v.type='checkbox' then to_jsonb(v.checkbox_value)
    when v.type='person' then to_jsonb(v.person_value)
    when v.type='relation' then to_jsonb(v.relation_value)
    when v.type='select' then to_jsonb(v.option_value::text) end),'{}'::jsonb)
  from public.teamspace_task_field_values v where v.workspace_id=p_workspace and v.task_id=p_task
$$;
revoke all on function public.teamspace_task_values(text,text) from public,anon;
grant execute on function public.teamspace_task_values(text,text) to authenticated,service_role;

create view public.teamspace_all_records with(security_invoker=true) as
  select path,data,version,workspace_id,collection from public.teamspace_documents
  union all select t.path,t.data||case when t.has_properties then jsonb_build_object('propertyValues',public.teamspace_task_values(t.workspace_id,t.id)) else '{}'::jsonb end,t.version,t.workspace_id,'workspaces/'||t.workspace_id||'/tasks' from public.teamspace_tasks t
  union all select p.path,p.data,p.version,p.workspace_id,'workspaces/'||p.workspace_id||'/projects' from public.teamspace_projects p
  union all select 'workspaces/'||f.workspace_id||'/boardProperties/'||f.id::text,
    f.meta||jsonb_build_object('name',f.name,'type',f.type,'revision',f.revision,'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id::text,'name',o.label,'color',o.color,'archived',o.archived) order by o.position) from public.teamspace_field_options o where o.workspace_id=f.workspace_id and o.field_id=f.id),'[]'::jsonb))||case when f.project_id is null then '{}'::jsonb else jsonb_build_object('projectId',f.project_id) end,
    f.revision,f.workspace_id,'workspaces/'||f.workspace_id||'/boardProperties' from public.teamspace_field_definitions f;
revoke all on public.teamspace_all_records from public,anon;
grant select on public.teamspace_all_records to authenticated,service_role;

-- Only the epoch-locked service commit may call this writer.
create function public.teamspace_put_record(p_path text,p_data jsonb,p_version bigint) returns void language plpgsql set search_path=pg_catalog,public as $$
declare parts text[]:=string_to_array(p_path,'/'); w text:=parts[2]; entity text:=parts[4]; item record; opt record; def public.teamspace_field_definitions%rowtype; scalar text; cleared boolean;
begin
  if array_length(parts,1)=4 and parts[1]='workspaces' and parts[3]='projects' then
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

-- Upgrade in dependency order and remove the old writable copies atomically.
do $$declare item record; begin
  for item in select path,data,version from public.teamspace_documents where collection ~ '^workspaces/[^/]+/(projects|boardProperties|tasks)$'
    order by case split_part(path,'/',3) when 'projects' then 0 when 'boardProperties' then 1 else 2 end,path
  loop perform public.teamspace_put_record(item.path,item.data,item.version); end loop;
  delete from public.teamspace_documents where collection ~ '^workspaces/[^/]+/(projects|boardProperties|tasks)$';
end $$;
alter table public.teamspace_documents add constraint teamspace_canonical_records_not_documents check(collection !~ '^workspaces/[^/]+/(projects|boardProperties|tasks)$');

create or replace function public.teamspace_store_read(p_epoch bigint,p_path text,p_query jsonb default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint; item record; filtered boolean; filter jsonb; output jsonb := '[]'::jsonb; selected jsonb; field text; lim integer; ordering_field text; descending boolean;
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for share;
  if p_epoch is not null and current_epoch<>p_epoch then return jsonb_build_object('epoch',current_epoch::text,'rows',output,'conflict',true); end if;
  if p_query is null then
    select coalesce(jsonb_agg(jsonb_build_object('path',path,'data',data)),'[]'::jsonb) into output from public.teamspace_all_records where path=p_path;
    return jsonb_build_object('epoch',current_epoch::text,'rows',output);
  end if;
  lim := case when p_query->>'limit' is null then null else greatest(1,(p_query->>'limit')::integer) end;
  ordering_field := p_query->'order'->>'field'; descending := p_query->'order'->>'direction'='desc';
  -- Fixed SQL/JSON parameters; never interpolate caller-controlled SQL text.
  for item in select path,data from public.teamspace_all_records where collection=p_path
    order by case when not coalesce(descending,false) then data->ordering_field end asc,
      case when descending then data->ordering_field end desc,
      case when not coalesce(descending,false) then path end asc,
      case when descending then path end desc
  loop
    filtered := false;
    for filter in select value from jsonb_array_elements(coalesce(p_query->'filters','[]'::jsonb)) loop
      if filter->>'operator'='==' then
        if item.data->(filter->>'field') is distinct from filter->'value' then filtered:=true; exit; end if;
      elsif filter->>'operator'='<' then
        if item.data->(filter->>'field') is null or not (item.data->(filter->>'field') < filter->'value') then filtered:=true; exit; end if;
      else raise exception 'Invalid query operator'; end if;
    end loop;
    if filtered then continue; end if;
    selected := item.data;
    if p_query ? 'fields' then
      selected := '{}'::jsonb;
      for field in select jsonb_array_elements_text(p_query->'fields') loop
        if item.data ? field then selected := selected||jsonb_build_object(field,item.data->field); end if;
      end loop;
    end if;
    output := output||jsonb_build_array(jsonb_build_object('path',item.path,'data',selected));
    if lim is not null and jsonb_array_length(output)>=lim then exit; end if;
  end loop;
  return jsonb_build_object('epoch',current_epoch::text,'rows',output);
end $$;

create or replace function public.teamspace_store_commit(p_epoch bigint,p_writes jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint; operation jsonb; existing jsonb; replacement jsonb; field record; resolved jsonb; stamp bigint := floor(extract(epoch from clock_timestamp())*1000);
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for update;
  if current_epoch<>p_epoch then return jsonb_build_object('epoch',current_epoch::text,'rows','[]'::jsonb,'conflict',true); end if;
  if jsonb_array_length(p_writes)>500 then raise exception 'Transaction write limit exceeded'; end if;
  for operation in select value from jsonb_array_elements(p_writes) loop
    select data into existing from public.teamspace_all_records where path=operation->>'path';
    if operation->>'kind'='delete' then
      if operation->>'path' ~ '^workspaces/[^/]+/projects/[^/]+$' then raise exception 'Projects must be archived';
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
  delete from public.teamspace_tasks where left(path,length(p_path)+1)=p_path||'/';
  delete from public.teamspace_field_definitions where left('workspaces/'||workspace_id||'/boardProperties/'||id::text,length(p_path)+1)=p_path||'/';
  delete from public.teamspace_projects where left(path,length(p_path)+1)=p_path||'/';
  delete from public.teamspace_documents where left(path,length(p_path)+1)=p_path||'/';
  update public.teamspace_store_state set epoch=current_epoch+1 where singleton;
  return jsonb_build_object('epoch',(current_epoch+1)::text,'rows','[]'::jsonb);
end $$;

create or replace function public.teamspace_can_read(p_path text) returns boolean language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare parts text[] := string_to_array(p_path,'/'); uid text := auth.uid()::text; needs_confirmation boolean;
begin
  if uid is null then return false; end if;
  select (data->>'emailConfirmationRequired')::boolean into needs_confirmation from public.teamspace_documents where path='security/policy';
  if coalesce(needs_confirmation,true) and not exists(select 1 from auth.users where id::text=uid and email_confirmed_at is not null) then return false; end if;
  if array_length(parts,1)=2 and parts[1]='users' then return parts[2]=uid; end if;
  if parts[1]<>'workspaces' or not exists(select 1 from public.teamspace_documents where path='workspaces/'||parts[2]||'/members/'||uid) then return false; end if;
  if array_length(parts,1)=2 then return true; end if;
  if array_length(parts,1)=4 and parts[3] in ('members','tasks','notes','attachments','boardProperties','projects') then return true; end if;
  if array_length(parts,1)=6 and ((parts[3] in ('tasks','notes') and parts[5]='comments') or (parts[3]='notes' and parts[5]='presence')) then
    return exists(select 1 from public.teamspace_all_records where path=array_to_string(parts[1:4],'/') and not coalesce((data->>'deleting')::boolean,false));
  end if;
  return false;
end $$;


do $$declare tab text; begin
  foreach tab in array array['teamspace_projects','teamspace_tasks','teamspace_field_definitions','teamspace_field_options','teamspace_task_field_values','teamspace_task_field_selections'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
    execute format('grant select on public.%I to authenticated,service_role',tab);
    execute format('create policy workspace_member_read on public.%I for select to authenticated using(public.teamspace_can_read(''workspaces/''||workspace_id))',tab);
    if exists(select 1 from pg_publication where pubname='supabase_realtime') then execute format('alter publication supabase_realtime add table public.%I',tab); end if;
  end loop;
end $$;
update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
