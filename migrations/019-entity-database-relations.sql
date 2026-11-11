begin;
select epoch from public.teamspace_store_state where singleton for update;

create table public.teamspace_task_database_relations (
  workspace_id text not null,
  task_id text not null,
  field_path text not null references public.teamspace_documents(path) on delete cascade,
  entry_path text not null references public.teamspace_documents(path) on delete cascade,
  primary key(workspace_id,task_id,field_path,entry_path),
  foreign key(workspace_id,task_id) references public.teamspace_tasks(workspace_id,id) on delete cascade,
  check(field_path ~ '^workspaces/[^/]+/entityRelationFields/[^/]+$' and left(field_path,length('workspaces/'||workspace_id)+1)='workspaces/'||workspace_id||'/'),
  check(entry_path ~ '^workspaces/[^/]+/databaseEntries/[^/]+$' and left(entry_path,length('workspaces/'||workspace_id)+1)='workspaces/'||workspace_id||'/')
);
create table public.teamspace_project_database_relations (
  workspace_id text not null,
  project_id text not null,
  field_path text not null references public.teamspace_documents(path) on delete cascade,
  entry_path text not null references public.teamspace_documents(path) on delete cascade,
  primary key(workspace_id,project_id,field_path,entry_path),
  foreign key(workspace_id,project_id) references public.teamspace_projects(workspace_id,id) on delete cascade,
  check(field_path ~ '^workspaces/[^/]+/entityRelationFields/[^/]+$' and left(field_path,length('workspaces/'||workspace_id)+1)='workspaces/'||workspace_id||'/'),
  check(entry_path ~ '^workspaces/[^/]+/databaseEntries/[^/]+$' and left(entry_path,length('workspaces/'||workspace_id)+1)='workspaces/'||workspace_id||'/')
);
create index teamspace_task_database_relations_entry on public.teamspace_task_database_relations(entry_path,task_id,field_path);
create index teamspace_project_database_relations_entry on public.teamspace_project_database_relations(entry_path,project_id,field_path);
alter table public.teamspace_task_database_relations enable row level security;
alter table public.teamspace_project_database_relations enable row level security;
revoke all on public.teamspace_task_database_relations,public.teamspace_project_database_relations from public,anon,authenticated,service_role;
grant select on public.teamspace_task_database_relations,public.teamspace_project_database_relations to authenticated,service_role;
create policy workspace_member_read on public.teamspace_task_database_relations for select to authenticated using(public.teamspace_can_read('workspaces/'||workspace_id));
create policy workspace_member_read on public.teamspace_project_database_relations for select to authenticated using(public.teamspace_can_read('workspaces/'||workspace_id));

create function public.teamspace_index_entity_database_relations() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item record; target text; definition jsonb; entry jsonb; base text:='workspaces/'||new.workspace_id; scope text:=tg_argv[0];
begin
  if scope='task' then delete from public.teamspace_task_database_relations where workspace_id=new.workspace_id and task_id=new.id;
  else delete from public.teamspace_project_database_relations where workspace_id=new.workspace_id and project_id=new.id; end if;
  if not (new.data ? 'databaseRelations') then return new; end if;
  if jsonb_typeof(new.data->'databaseRelations')<>'object' or (select count(*) from jsonb_object_keys(new.data->'databaseRelations'))>32 then raise exception 'Invalid database relations'; end if;
  for item in select key,value from jsonb_each(new.data->'databaseRelations') loop
    select data into definition from public.teamspace_documents where path=base||'/entityRelationFields/'||item.key;
    if definition is null or definition->>'scope' is distinct from scope or jsonb_typeof(item.value)<>'array' or jsonb_array_length(item.value)>50 then raise exception 'Invalid relation property'; end if;
    for target in select jsonb_array_elements_text(item.value) loop
      select data into entry from public.teamspace_documents where path=base||'/databaseEntries/'||target;
      if entry is null or entry->>'databaseId' is distinct from definition->>'targetDatabaseId' then raise exception 'Invalid relation target'; end if;
      if scope='task' then insert into public.teamspace_task_database_relations values(new.workspace_id,new.id,base||'/entityRelationFields/'||item.key,base||'/databaseEntries/'||target);
      else insert into public.teamspace_project_database_relations values(new.workspace_id,new.id,base||'/entityRelationFields/'||item.key,base||'/databaseEntries/'||target); end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function public.teamspace_index_entity_database_relations() from public,anon,authenticated,service_role;
create trigger teamspace_task_database_relations after insert or update on public.teamspace_tasks for each row execute function public.teamspace_index_entity_database_relations('task');
create trigger teamspace_project_database_relations after insert or update on public.teamspace_projects for each row execute function public.teamspace_index_entity_database_relations('project');

create function public.teamspace_delete_entity_relation_fields() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.teamspace_documents where collection in (old.path||'/entityRelationFields',old.path||'/entityRelationOperations');
  return old;
end $$;
revoke all on function public.teamspace_delete_entity_relation_fields() from public,anon,authenticated,service_role;
create trigger teamspace_workspace_entity_relations_cleanup after delete on public.teamspace_documents for each row when (old.path ~ '^workspaces/[^/]+$') execute function public.teamspace_delete_entity_relation_fields();
update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
