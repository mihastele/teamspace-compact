begin;
select epoch from public.teamspace_store_state where singleton for update;

-- The document records remain authoritative. This trigger-maintained projection
-- enforces relation foreign keys and supports indexed incoming-link queries.
create table public.teamspace_database_links (
  workspace_path text not null references public.teamspace_documents(path) on delete cascade,
  source_path text not null references public.teamspace_documents(path) on delete cascade,
  field_id uuid not null,
  target_path text not null references public.teamspace_documents(path) on delete cascade,
  primary key(source_path,field_id,target_path),
  check(workspace_path ~ '^workspaces/[^/]+$'),
  check(source_path ~ '^workspaces/[^/]+/databaseEntries/[^/]+$' and left(source_path,length(workspace_path)+1)=workspace_path||'/'),
  check(target_path ~ '^workspaces/[^/]+/databaseEntries/[^/]+$' and left(target_path,length(workspace_path)+1)=workspace_path||'/')
);
create index teamspace_database_links_target on public.teamspace_database_links(target_path,source_path,field_id);
create index teamspace_database_entries_database on public.teamspace_documents(workspace_id,(data->>'databaseId'),path) where collection ~ '^workspaces/[^/]+/databaseEntries$';
alter table public.teamspace_database_links enable row level security;
revoke all on public.teamspace_database_links from public,anon,authenticated,service_role;
grant select on public.teamspace_database_links to authenticated,service_role;
create policy workspace_member_read on public.teamspace_database_links for select to authenticated using(public.teamspace_can_read(workspace_path));

create function public.teamspace_index_database_relations() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare definition jsonb; field jsonb; target text; target_row jsonb; base text:='workspaces/'||new.workspace_id;
begin
  select data into definition from public.teamspace_documents where path=base||'/databases/'||(new.data->>'databaseId');
  if definition is null then raise exception 'Database not found'; end if;
  if jsonb_typeof(new.data->'propertyValues')<>'object' then raise exception 'Invalid database values'; end if;
  delete from public.teamspace_database_links where source_path=new.path;
  for field in select value from jsonb_array_elements(definition->'fields') where value->>'type'='relation' loop
    if not(new.data->'propertyValues' ? (field->>'id')) or new.data->'propertyValues'->(field->>'id')='null'::jsonb then continue; end if;
    if jsonb_typeof(new.data->'propertyValues'->(field->>'id'))<>'array' then raise exception 'Invalid database relation'; end if;
    for target in select jsonb_array_elements_text(new.data->'propertyValues'->(field->>'id')) loop
      select data into target_row from public.teamspace_documents where path=base||'/databaseEntries/'||target;
      if target_row is null or target_row->>'databaseId' is distinct from field->>'targetDatabaseId' then raise exception 'Invalid relation target'; end if;
      insert into public.teamspace_database_links(workspace_path,source_path,field_id,target_path) values(base,new.path,(field->>'id')::uuid,base||'/databaseEntries/'||target);
    end loop;
  end loop;
  return new;
end $$;
revoke all on function public.teamspace_index_database_relations() from public,anon,authenticated,service_role;
create trigger teamspace_database_relation_index after insert or update on public.teamspace_documents
for each row when (new.collection ~ '^workspaces/[^/]+/databaseEntries$') execute function public.teamspace_index_database_relations();

create or replace function public.teamspace_can_read(p_path text) returns boolean language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare parts text[] := string_to_array(p_path,'/'); uid text := auth.uid()::text; needs_confirmation boolean;
begin
  if uid is null then return false; end if;
  select (data->>'emailConfirmationRequired')::boolean into needs_confirmation from public.teamspace_documents where path='security/policy';
  if coalesce(needs_confirmation,true) and not exists(select 1 from auth.users where id::text=uid and email_confirmed_at is not null) then return false; end if;
  if array_length(parts,1)=2 and parts[1]='users' then return parts[2]=uid; end if;
  if parts[1]<>'workspaces' or not exists(select 1 from public.teamspace_documents where path='workspaces/'||parts[2]||'/members/'||uid) then return false; end if;
  if array_length(parts,1)=2 then return true; end if;
  if array_length(parts,1)=4 and parts[3] in ('members','tasks','notes','attachments','boardProperties','projects','savedViews','taskTemplates','databases','databaseEntries') then return true; end if;
  if array_length(parts,1)=6 and ((parts[3] in ('tasks','notes') and parts[5]='comments') or (parts[3]='notes' and parts[5]='presence')) then
    return exists(select 1 from public.teamspace_all_records where path=array_to_string(parts[1:4],'/') and not coalesce((data->>'deleting')::boolean,false));
  end if;
  return false;
end $$;
revoke all on function public.teamspace_can_read(text) from public;
grant execute on function public.teamspace_can_read(text) to authenticated;

create function public.teamspace_delete_databases() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.teamspace_documents where collection in (old.path||'/databaseEntries',old.path||'/databases',old.path||'/databaseOperations');
  return old;
end $$;
revoke all on function public.teamspace_delete_databases() from public,anon,authenticated,service_role;
create trigger teamspace_workspace_database_cleanup after delete on public.teamspace_documents
for each row when (old.path ~ '^workspaces/[^/]+$') execute function public.teamspace_delete_databases();

create function public.teamspace_database_entry(p_workspace text,p_uid text,p_required boolean,p_verified boolean,p_entry text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare context jsonb; entry jsonb; incoming jsonb; base text:='workspaces/'||p_workspace;
begin
  context:=public.teamspace_ticket_context(p_workspace,p_uid,p_required,p_verified);
  if context ? 'error' then return context; end if;
  if not exists(select 1 from auth.users where id::text=p_uid and (not p_required or email_confirmed_at is not null)) then return jsonb_build_object('error','forbidden'); end if;
  select data into entry from public.teamspace_documents where path=base||'/databaseEntries/'||p_entry;
  if entry is null then return jsonb_build_object('error','not_found'); end if;
  select coalesce(jsonb_agg(row),'[]'::jsonb) into incoming from (
    select split_part(s.path,'/',4) as "entryId",s.data->>'databaseId' as "databaseId",s.data->>'title' as title,l.field_id::text as "fieldId",
      f.value->>'name' as "fieldName",coalesce((s.data->>'archived')::boolean,false) or coalesce((d.data->>'archived')::boolean,false) as archived
    from public.teamspace_database_links l
    join public.teamspace_documents s on s.path=l.source_path
    join public.teamspace_documents d on d.path=base||'/databases/'||(s.data->>'databaseId')
    cross join lateral jsonb_array_elements(d.data->'fields') f
    where l.target_path=base||'/databaseEntries/'||p_entry and l.workspace_path=base and f.value->>'id'=l.field_id::text
    order by l.source_path,l.field_id limit 201
  ) row;
  return jsonb_build_object('entry',entry,'incoming',case when jsonb_array_length(incoming)>200 then incoming-200 else incoming end,'truncated',jsonb_array_length(incoming)>200);
end $$;
revoke all on function public.teamspace_database_entry(text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.teamspace_database_entry(text,text,boolean,boolean,text) to service_role;
update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
