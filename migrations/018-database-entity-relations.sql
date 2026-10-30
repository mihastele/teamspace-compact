begin;
select epoch from public.teamspace_store_state where singleton for update;

-- Empty projections until a matching trusted writer supports the new kinds.
create table public.teamspace_database_task_links (
  workspace_id text not null,
  source_path text not null references public.teamspace_documents(path) on delete cascade,
  field_id uuid not null,
  task_id text not null,
  primary key(source_path,field_id,task_id),
  foreign key(workspace_id,task_id) references public.teamspace_tasks(workspace_id,id),
  check(source_path ~ '^workspaces/[^/]+/databaseEntries/[^/]+$' and left(source_path,length('workspaces/'||workspace_id)+1)='workspaces/'||workspace_id||'/')
);
create table public.teamspace_database_project_links (
  workspace_id text not null,
  source_path text not null references public.teamspace_documents(path) on delete cascade,
  field_id uuid not null,
  project_id text not null,
  primary key(source_path,field_id,project_id),
  foreign key(workspace_id,project_id) references public.teamspace_projects(workspace_id,id),
  check(source_path ~ '^workspaces/[^/]+/databaseEntries/[^/]+$' and left(source_path,length('workspaces/'||workspace_id)+1)='workspaces/'||workspace_id||'/')
);
create index teamspace_database_task_links_target on public.teamspace_database_task_links(workspace_id,task_id,source_path,field_id);
create index teamspace_database_project_links_target on public.teamspace_database_project_links(workspace_id,project_id,source_path,field_id);
alter table public.teamspace_database_task_links enable row level security;
alter table public.teamspace_database_project_links enable row level security;
revoke all on public.teamspace_database_task_links, public.teamspace_database_project_links from public,anon,authenticated,service_role;
grant select on public.teamspace_database_task_links, public.teamspace_database_project_links to authenticated,service_role;
create policy workspace_member_read on public.teamspace_database_task_links for select to authenticated using(public.teamspace_can_read('workspaces/'||workspace_id));
create policy workspace_member_read on public.teamspace_database_project_links for select to authenticated using(public.teamspace_can_read('workspaces/'||workspace_id));

create or replace function public.teamspace_index_database_relations() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare definition jsonb; field jsonb; target text; target_row jsonb; kind text; base text:='workspaces/'||new.workspace_id;
begin
  select data into definition from public.teamspace_documents where path=base||'/databases/'||(new.data->>'databaseId');
  if definition is null then raise exception 'Database not found'; end if;
  if jsonb_typeof(new.data->'propertyValues')<>'object' then raise exception 'Invalid database values'; end if;
  delete from public.teamspace_database_links where source_path=new.path;
  delete from public.teamspace_database_task_links where source_path=new.path;
  delete from public.teamspace_database_project_links where source_path=new.path;
  for field in select value from jsonb_array_elements(definition->'fields') where value->>'type'='relation' loop
    kind:=coalesce(field->>'targetKind','database');
    if kind not in ('database','task','project') then raise exception 'Invalid relation kind'; end if;
    if not(new.data->'propertyValues' ? (field->>'id')) or new.data->'propertyValues'->(field->>'id')='null'::jsonb then continue; end if;
    if jsonb_typeof(new.data->'propertyValues'->(field->>'id'))<>'array' then raise exception 'Invalid database relation'; end if;
    for target in select jsonb_array_elements_text(new.data->'propertyValues'->(field->>'id')) loop
      if kind='database' then
        select data into target_row from public.teamspace_documents where path=base||'/databaseEntries/'||target;
        if target_row is null or target_row->>'databaseId' is distinct from field->>'targetDatabaseId' then raise exception 'Invalid relation target'; end if;
        insert into public.teamspace_database_links(workspace_path,source_path,field_id,target_path) values(base,new.path,(field->>'id')::uuid,base||'/databaseEntries/'||target);
      elsif kind='task' then
        insert into public.teamspace_database_task_links(workspace_id,source_path,field_id,task_id) values(new.workspace_id,new.path,(field->>'id')::uuid,target);
      else
        insert into public.teamspace_database_project_links(workspace_id,source_path,field_id,project_id) values(new.workspace_id,new.path,(field->>'id')::uuid,target);
      end if;
    end loop;
  end loop;
  return new;
end $$;

-- The store serializes trusted writes on its epoch row. Rewrite authoritative
-- values, not just the projection, and advance reviewed entry revisions.
create function public.teamspace_unlink_deleted_task() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare link record;
begin
  if not exists(select 1 from public.teamspace_documents where path='workspaces/'||old.workspace_id) then return old; end if;
  for link in select source_path,field_id from public.teamspace_database_task_links where workspace_id=old.workspace_id and task_id=old.id order by source_path,field_id loop
    update public.teamspace_documents set
      data=jsonb_set(jsonb_set(data,array['propertyValues',link.field_id::text],(data->'propertyValues'->(link.field_id::text))-old.id),'{revision}',to_jsonb((data->>'revision')::bigint+1)),
      version=version+1
    where path=link.source_path and coalesce((data->>'revision')::bigint,1000000000)<1000000000;
    if not found then raise exception 'Linked entry cannot be updated safely'; end if;
  end loop;
  return old;
end $$;
revoke all on function public.teamspace_unlink_deleted_task() from public,anon,authenticated,service_role;
create trigger teamspace_task_relation_cleanup before delete on public.teamspace_tasks
for each row execute function public.teamspace_unlink_deleted_task();
update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
