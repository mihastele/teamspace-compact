-- Supabase alternative, one provider per deployment. Run on a clean Supabase
-- project before enabling traffic. Existing Firebase data is not migrated.
begin;
create table public.teamspace_documents (
  path text primary key check (path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$' and length(path) <= 4096),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null,
  workspace_id text generated always as (case when split_part(path,'/',1)='workspaces' then split_part(path,'/',2) else null end) stored,
  collection text generated always as (regexp_replace(path,'/[^/]+$','')) stored
);
create index teamspace_documents_collection on public.teamspace_documents(collection);
create index teamspace_documents_workspace on public.teamspace_documents(workspace_id);
create table public.teamspace_store_state (singleton boolean primary key default true check (singleton), epoch bigint not null default 0);
insert into public.teamspace_store_state values(true,0);
insert into public.teamspace_documents(path,data,version) values('security/policy','{"emailConfirmationRequired":true}'::jsonb,0);
alter table public.teamspace_documents enable row level security;
alter table public.teamspace_store_state enable row level security;
revoke all on public.teamspace_store_state from anon,authenticated;
revoke all on public.teamspace_documents from anon,authenticated;
grant select on public.teamspace_documents to authenticated;
revoke all on public.teamspace_documents,public.teamspace_store_state from service_role;
grant select on public.teamspace_documents,public.teamspace_store_state to service_role;

create function public.teamspace_can_read(p_path text) returns boolean language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare parts text[] := string_to_array(p_path,'/'); uid text := auth.uid()::text; needs_confirmation boolean;
begin
  if uid is null then return false; end if;
  select (data->>'emailConfirmationRequired')::boolean into needs_confirmation from public.teamspace_documents where path='security/policy';
  if coalesce(needs_confirmation,true) and not exists(select 1 from auth.users where id::text=uid and email_confirmed_at is not null) then return false; end if;
  if array_length(parts,1)=2 and parts[1]='users' then return parts[2]=uid; end if;
  if parts[1]<>'workspaces' or not exists(select 1 from public.teamspace_documents where path='workspaces/'||parts[2]||'/members/'||uid) then return false; end if;
  if array_length(parts,1)=2 then return true; end if;
  if array_length(parts,1)=4 and parts[3] in ('members','tasks','notes','attachments') then return true; end if;
  if array_length(parts,1)=6 and ((parts[3] in ('tasks','notes') and parts[5]='comments') or (parts[3]='notes' and parts[5]='presence')) then
    return exists(select 1 from public.teamspace_documents where path=array_to_string(parts[1:4],'/') and not coalesce((data->>'deleting')::boolean,false));
  end if;
  return false;
end $$;

-- Signed capabilities are issued by trusted member-authorized server routes.
-- No SDK Storage policies are added. A fresh Supabase project denies direct reads/writes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('teamspace-private','teamspace-private',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;
revoke all on function public.teamspace_can_read(text) from public;
grant execute on function public.teamspace_can_read(text) to authenticated;
create policy teamspace_member_read on public.teamspace_documents for select to authenticated using(public.teamspace_can_read(path));

create function public.teamspace_store_epoch() returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('epoch',epoch::text,'rows','[]'::jsonb) from public.teamspace_store_state where singleton
$$;
create function public.teamspace_store_read(p_epoch bigint,p_path text,p_query jsonb default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint; item record; filtered boolean; filter jsonb; output jsonb := '[]'::jsonb; selected jsonb; field text; lim integer; ordering_field text; descending boolean;
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for share;
  if p_epoch is not null and current_epoch<>p_epoch then return jsonb_build_object('epoch',current_epoch::text,'rows',output,'conflict',true); end if;
  if p_query is null then
    select coalesce(jsonb_agg(jsonb_build_object('path',path,'data',data)),'[]'::jsonb) into output from public.teamspace_documents where path=p_path;
    return jsonb_build_object('epoch',current_epoch::text,'rows',output);
  end if;
  lim := case when p_query->>'limit' is null then null else greatest(1,(p_query->>'limit')::integer) end;
  ordering_field := p_query->'order'->>'field'; descending := p_query->'order'->>'direction'='desc';
  -- Fixed SQL/JSON parameters; never interpolate caller-controlled SQL text.
  for item in select path,data from public.teamspace_documents where collection=p_path
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
create function public.teamspace_resolve_value(p_value jsonb,p_previous jsonb,p_now bigint) returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare result jsonb; entry record; child jsonb;
begin
  if jsonb_typeof(p_value)='object' then
    if p_value->>'__teamspaceTransform'='timestamp' then return jsonb_build_object('$ts',p_now); end if;
    if p_value->>'__teamspaceTransform'='increment' then return to_jsonb(coalesce((p_previous #>> '{}')::numeric,0)+(p_value->>'amount')::numeric); end if;
    if p_value->>'__teamspaceTransform'='delete' then return null; end if;
    result:='{}'::jsonb;
    for entry in select key,value from jsonb_each(p_value) loop
      child:=public.teamspace_resolve_value(entry.value,p_previous->entry.key,p_now);
      if child is not null then result:=result||jsonb_build_object(entry.key,child); end if;
    end loop;
    return result;
  end if;
  return p_value;
end $$;
create function public.teamspace_merge_value(p_value jsonb,p_previous jsonb,p_now bigint) returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare result jsonb; entry record; child jsonb;
begin
  if jsonb_typeof(p_value)='object' and not(p_value ? '__teamspaceTransform') then
    result:=case when jsonb_typeof(p_previous)='object' then p_previous else '{}'::jsonb end;
    for entry in select key,value from jsonb_each(p_value) loop
      child:=public.teamspace_merge_value(entry.value,p_previous->entry.key,p_now);
      if child is null then result:=result-entry.key; else result:=result||jsonb_build_object(entry.key,child); end if;
    end loop;
    return result;
  end if;
  return public.teamspace_resolve_value(p_value,p_previous,p_now);
end $$;
create function public.teamspace_store_commit(p_epoch bigint,p_writes jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint; operation jsonb; existing jsonb; replacement jsonb; field record; resolved jsonb; stamp bigint := floor(extract(epoch from clock_timestamp())*1000);
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for update;
  if current_epoch<>p_epoch then return jsonb_build_object('epoch',current_epoch::text,'rows','[]'::jsonb,'conflict',true); end if;
  if jsonb_array_length(p_writes)>500 then raise exception 'Transaction write limit exceeded'; end if;
  for operation in select value from jsonb_array_elements(p_writes) loop
    select data into existing from public.teamspace_documents where path=operation->>'path';
    if operation->>'kind'='delete' then delete from public.teamspace_documents where path=operation->>'path'; continue; end if;
    if operation->>'kind'='create' and existing is not null then raise exception 'Document already exists'; end if;
    if operation->>'kind'='update' and existing is null then raise exception 'Document not found'; end if;
    if operation->>'kind' not in ('create','set','update') then raise exception 'Invalid operation'; end if;
    replacement := case when operation->>'kind'='update' or coalesce((operation->>'merge')::boolean,false) then coalesce(existing,'{}'::jsonb) else '{}'::jsonb end;
    for field in select key,value from jsonb_each(operation->'data') loop
      resolved:=case when coalesce((operation->>'merge')::boolean,false) then public.teamspace_merge_value(field.value,existing->field.key,stamp) else public.teamspace_resolve_value(field.value,existing->field.key,stamp) end;
      if resolved is null then replacement:=replacement-field.key; else replacement:=replacement||jsonb_build_object(field.key,resolved); end if;
    end loop;
    insert into public.teamspace_documents(path,data,version) values(operation->>'path',replacement,current_epoch+1)
      on conflict(path) do update set data=excluded.data,version=excluded.version;
  end loop;
  if jsonb_array_length(p_writes)>0 then update public.teamspace_store_state set epoch=current_epoch+1 where singleton; current_epoch:=current_epoch+1; end if;
  return jsonb_build_object('epoch',current_epoch::text,'rows','[]'::jsonb);
end $$;
create function public.teamspace_store_delete_collection(p_path text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint;
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for update;
  delete from public.teamspace_documents where left(path,length(p_path)+1)=p_path||'/';
  update public.teamspace_store_state set epoch=current_epoch+1 where singleton;
  return jsonb_build_object('epoch',(current_epoch+1)::text,'rows','[]'::jsonb);
end $$;
-- These privileged RPCs are server-only, never anonymous/authenticated calls.
revoke all on function public.teamspace_store_epoch(),public.teamspace_store_read(bigint,text,jsonb),public.teamspace_resolve_value(jsonb,jsonb,bigint),public.teamspace_merge_value(jsonb,jsonb,bigint),public.teamspace_store_commit(bigint,jsonb),public.teamspace_store_delete_collection(text) from public,anon,authenticated;
grant execute on function public.teamspace_store_epoch(),public.teamspace_store_read(bigint,text,jsonb),public.teamspace_store_commit(bigint,jsonb),public.teamspace_store_delete_collection(text) to service_role;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.teamspace_documents; end if;
end $$;
-- Match Firestore TTL scopes. Permanent named versions and operation receipts survive.
-- This writer also takes the epoch lock, so expiry cannot invalidate an unnoticed read set.
create function public.teamspace_store_prune_expired() returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_epoch bigint; removed bigint; cutoff bigint := floor(extract(epoch from clock_timestamp())*1000);
begin
  select epoch into current_epoch from public.teamspace_store_state where singleton for update;
  delete from public.teamspace_documents where jsonb_typeof(data->'expiresAt'->'$ts')='number'
    and (data->'expiresAt'->>'$ts')::numeric <= cutoff
    and (collection='rateLimits'
      or collection ~ '^workspaces/[^/]+/notes/[^/]+/presence$'
      or (collection ~ '^workspaces/[^/]+/notes/[^/]+/historyVersions$' and data->>'kind'<>'named')
      or (collection ~ '^workspaces/[^/]+/attachments$' and data->>'status'='pending'));
  get diagnostics removed = row_count;
  if removed>0 then update public.teamspace_store_state set epoch=epoch+1 where singleton; end if;
  return jsonb_build_object('removed',removed);
end $$;
revoke all on function public.teamspace_store_prune_expired() from public,anon,authenticated;
grant execute on function public.teamspace_store_prune_expired() to service_role;
commit;
