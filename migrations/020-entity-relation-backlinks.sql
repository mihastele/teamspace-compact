begin;
select epoch from public.teamspace_store_state where singleton for update;

-- Keep the original entry-to-entry response and its 200-link bound unchanged.
-- Task/project backlinks have an independent, deterministic 200-link bound.
create or replace function public.teamspace_database_entry(p_workspace text,p_uid text,p_required boolean,p_verified boolean,p_entry text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare context jsonb; entry jsonb; incoming jsonb; entity_incoming jsonb; base text:='workspaces/'||p_workspace;
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
  select coalesce(jsonb_agg(row order by row.kind,row."entityId",row."fieldId"),'[]'::jsonb) into entity_incoming from (
    select * from (
      select 'task'::text as kind,t.id as "entityId",t.data->>'title' as title,split_part(l.field_path,'/',4) as "fieldId",f.data->>'name' as "fieldName",false as archived
      from public.teamspace_task_database_relations l
      join public.teamspace_tasks t on t.workspace_id=l.workspace_id and t.id=l.task_id
      join public.teamspace_documents f on f.path=l.field_path
      where l.workspace_id=p_workspace and l.entry_path=base||'/databaseEntries/'||p_entry and not coalesce((t.data->>'deleting')::boolean,false)
      union all
      select 'project'::text,p.id,p.data->>'name',split_part(l.field_path,'/',4),f.data->>'name',p.archived
      from public.teamspace_project_database_relations l
      join public.teamspace_projects p on p.workspace_id=l.workspace_id and p.id=l.project_id
      join public.teamspace_documents f on f.path=l.field_path
      where l.workspace_id=p_workspace and l.entry_path=base||'/databaseEntries/'||p_entry
    ) links order by kind,"entityId","fieldId" limit 201
  ) row;
  return jsonb_build_object('entry',entry,'incoming',case when jsonb_array_length(incoming)>200 then incoming-200 else incoming end,'truncated',jsonb_array_length(incoming)>200,
    'entityIncoming',case when jsonb_array_length(entity_incoming)>200 then entity_incoming-200 else entity_incoming end,'entityTruncated',jsonb_array_length(entity_incoming)>200);
end $$;
revoke all on function public.teamspace_database_entry(text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.teamspace_database_entry(text,text,boolean,boolean,text) to service_role;
update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
