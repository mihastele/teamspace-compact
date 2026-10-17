-- Private read-agent queue. No model calls or application content writes.
begin;
select epoch from public.teamspace_store_state where singleton for update;

create table public.teamspace_agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  workspace_path text generated always as ('workspaces/'||workspace_id) stored,
  initiator_id text not null,
  status text not null default 'queued' check(status in ('queued','running','retrying','completed','failed','cancelled')),
  prompt text not null check(length(btrim(prompt)) between 1 and 16000 and octet_length(prompt)<=64000),
  context jsonb not null default '{}' check(jsonb_typeof(context)='object' and octet_length(context::text)<=1024),
  checkpoint jsonb not null default '{"version":1}' check(jsonb_typeof(checkpoint)='object' and checkpoint ? 'version' and checkpoint->>'version'='1' and octet_length(checkpoint::text)<=512000),
  result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=64000)),
  error_code text check(error_code is null or error_code ~ '^[a-z_]{1,80}$'),
  attempts integer not null default 0 check(attempts between 0 and 3),
  version integer not null default 1 check(version>0),
  available_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  lease_token uuid,
  worker_id text,
  last_sequence integer not null default 0 check(last_sequence between 0 and 200),
  event_bytes integer not null default 0 check(event_bytes between 0 and 8000000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key(workspace_path) references public.teamspace_documents(path) on delete cascade,
  check((status='running')=(lease_token is not null and lease_until is not null and worker_id is not null)),
  check(status='running' or (lease_token is null and lease_until is null and worker_id is null))
);
create index teamspace_agent_due on public.teamspace_agent_runs(available_at,created_at,id) where status in ('queued','retrying','running');
create index teamspace_agent_history on public.teamspace_agent_runs(workspace_id,created_at desc,id);
create index teamspace_agent_expiry on public.teamspace_agent_runs(expires_at,id);
create table public.teamspace_agent_events (
  run_id uuid not null references public.teamspace_agent_runs(id) on delete cascade,
  sequence integer not null check(sequence between 1 and 200),
  kind text not null check(kind in ('queued','claimed','lease_expired','model_request','model_result','tool_request','tool_result','retrying','completed','failed','cancelled')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=300000),
  created_at timestamptz not null default clock_timestamp(),
  primary key(run_id,sequence)
);
-- Survives full-content expiry, preventing retry resurrection. Contains no prompt.
create table public.teamspace_agent_requests (
  workspace_id text not null,
  workspace_path text generated always as ('workspaces/'||workspace_id) stored,
  initiator_id text not null,
  operation_id uuid not null,
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  run_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,initiator_id,operation_id),
  foreign key(workspace_path) references public.teamspace_documents(path) on delete cascade
);
create index teamspace_agent_request_rate on public.teamspace_agent_requests(workspace_id,initiator_id,created_at);
alter table public.teamspace_agent_runs enable row level security;
alter table public.teamspace_agent_events enable row level security;
alter table public.teamspace_agent_requests enable row level security;
revoke all on public.teamspace_agent_runs,public.teamspace_agent_events,public.teamspace_agent_requests from public,anon,authenticated,service_role;

create function public.teamspace_agent_authorized(w text,u text,required boolean,verified boolean)
returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare account jsonb; policy boolean;
begin
  if not exists(select 1 from public.teamspace_documents where path='workspaces/'||w)
    or not exists(select 1 from public.teamspace_documents where path='workspaces/'||w||'/members/'||u) then return 'forbidden'; end if;
  select coalesce((data->>'emailConfirmationRequired')::boolean,true) into policy from public.teamspace_documents where path='security/policy';
  if coalesce(policy,true) is distinct from required or required is null then return 'policy_mismatch'; end if;
  select to_jsonb(a) into account from auth.users a where a.id::text=u;
  if account is null or account->>'deleted_at' is not null or coalesce((account->>'is_anonymous')::boolean,false)
    or (account->>'banned_until')::timestamptz>statement_timestamp() then return 'forbidden'; end if;
  if required and (verified is distinct from true or account->>'email_confirmed_at' is null) then return 'email_confirmation_required'; end if;
  return null;
end $$;
revoke all on function public.teamspace_agent_authorized(text,text,boolean,boolean) from public,anon,authenticated,service_role;

create function public.teamspace_agent_can_read(w text,initiator text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare u text:=auth.uid()::text; required boolean;
begin
  select coalesce((data->>'emailConfirmationRequired')::boolean,true) into required from public.teamspace_documents where path='security/policy';
  return u is not null and public.teamspace_agent_authorized(w,u,coalesce(required,true),true) is null and
    (u=initiator or exists(select 1 from public.teamspace_documents where path='workspaces/'||w||'/members/'||u and data->>'role' in ('owner','admin')));
end $$;
revoke all on function public.teamspace_agent_can_read(text,text) from public,anon,authenticated,service_role;
grant execute on function public.teamspace_agent_can_read(text,text) to authenticated;
grant select(id,workspace_id,initiator_id,status,prompt,context,result,error_code,attempts,version,last_sequence,created_at,updated_at,expires_at) on public.teamspace_agent_runs to authenticated;
grant select on public.teamspace_agent_events to authenticated;
create policy private_agent_run_read on public.teamspace_agent_runs for select to authenticated
  using(expires_at>statement_timestamp() and public.teamspace_agent_can_read(workspace_id,initiator_id));
create policy private_agent_event_read on public.teamspace_agent_events for select to authenticated using(exists(
  select 1 from public.teamspace_agent_runs r where r.id=run_id));

create function public.teamspace_agent_public(r public.teamspace_agent_runs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
  select to_jsonb(r)-array['workspace_path','checkpoint','lease_token','lease_until','worker_id','event_bytes','available_at'];
$$;
revoke all on function public.teamspace_agent_public(public.teamspace_agent_runs) from public,anon,authenticated,service_role;
-- Caller already holds global state SHARE, then the run row. Never reverses that
-- lock order, never advances the document epoch for queue-only writes.
create function public.teamspace_agent_event(run uuid,k text,p jsonb) returns void language plpgsql set search_path=pg_catalog,public as $$
declare seq integer;
begin
  update public.teamspace_agent_runs set last_sequence=last_sequence+1,event_bytes=event_bytes+octet_length(p::text)
    where id=run returning last_sequence into strict seq;
  insert into public.teamspace_agent_events(run_id,sequence,kind,payload) values(run,seq,k,p);
end $$;
revoke all on function public.teamspace_agent_event(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.teamspace_agent_queue(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  w text:=p_input->>'workspace'; u text:=p_input->>'uid'; required boolean:=(p_input->>'required')::boolean;
  r public.teamspace_agent_runs%rowtype; receipt public.teamspace_agent_requests%rowtype;
  denial text; digest text; ctx jsonb:=coalesce(p_input->'context','{}'); days integer; worker text:=p_input->>'worker';
  kind text:=p_input->>'kind'; payload jsonb:=coalesce(p_input->'payload','{}'); target text:=p_input->>'status';
  stamp timestamptz:=clock_timestamp(); n integer; events jsonb; result jsonb; iteration integer;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>900000 then return jsonb_build_object('error','invalid_input'); end if;
  perform epoch from public.teamspace_store_state where singleton for share;
  stamp:=clock_timestamp();
  if p_action='prune' then
    with candidates as (select id from public.teamspace_agent_runs where expires_at<=stamp order by expires_at,id limit 500 for update skip locked),
    removed as (delete from public.teamspace_agent_runs a using candidates c where a.id=c.id returning a.id)
    select count(*) into n from removed;
    return jsonb_build_object('deleted',n,'moreAvailable',n=500);
  end if;
  if p_action='claim' then
    if worker is null or worker !~ '^[A-Za-z0-9_-]{1,100}$' or required is null then return jsonb_build_object('error','invalid_input'); end if;
    if coalesce((select (data->>'emailConfirmationRequired')::boolean from public.teamspace_documents where path='security/policy'),true) is distinct from required then return jsonb_build_object('error','policy_mismatch'); end if;
    for iteration in 1..20 loop
      select * into r from public.teamspace_agent_runs where expires_at>stamp and
        ((status in ('queued','retrying') and available_at<=stamp) or (status='running' and lease_until<=stamp))
        order by available_at,created_at,id limit 1 for update skip locked;
      if not found then return jsonb_build_object('run',null); end if;
      denial:=public.teamspace_agent_authorized(r.workspace_id,r.initiator_id,required,true);
      if denial is not null or r.attempts>=3 then
        update public.teamspace_agent_runs set status='failed',error_code=case when denial is null then 'lease_exhausted' else 'access_revoked' end,
          version=version+1,updated_at=stamp,lease_token=null,lease_until=null,worker_id=null where id=r.id;
        perform public.teamspace_agent_event(r.id,'failed',jsonb_build_object('code',case when denial is null then 'lease_exhausted' else 'access_revoked' end));
        continue;
      end if;
      if r.status='running' then perform public.teamspace_agent_event(r.id,'lease_expired',jsonb_build_object('attempt',r.attempts,'readMayRepeat',true)); end if;
      update public.teamspace_agent_runs set status='running',attempts=attempts+1,version=version+1,lease_token=gen_random_uuid(),
        lease_until=stamp+interval '90 seconds',worker_id=worker,updated_at=stamp where id=r.id;
      perform public.teamspace_agent_event(r.id,'claimed',jsonb_build_object('attempt',r.attempts+1));
      select * into r from public.teamspace_agent_runs where id=r.id;
      return jsonb_build_object('run',to_jsonb(r)-'workspace_path');
    end loop;
    return jsonb_build_object('run',null);
  end if;

  if p_action in ('create','read','list','export','cancel','export_requests') then
    denial:=public.teamspace_agent_authorized(w,u,required,(p_input->>'verified')::boolean);
    if denial is not null then return jsonb_build_object('error',denial); end if;
    if p_action='export_requests' then
      select coalesce(jsonb_agg(to_jsonb(x) order by initiator_id,operation_id),'[]') into result from (
        select a.initiator_id,a.operation_id,a.digest,a.run_id,a.created_at from public.teamspace_agent_requests a
        where a.workspace_id=w and (a.initiator_id=u or exists(select 1 from public.teamspace_documents where path='workspaces/'||w||'/members/'||u and data->>'role' in ('owner','admin')))
          and (not (p_input ? 'afterInitiator') or (a.initiator_id,a.operation_id)>(p_input->>'afterInitiator',(p_input->>'afterOperation')::uuid))
        order by a.initiator_id,a.operation_id limit 501) x;
      return jsonb_build_object('requests',result);
    end if;
    if p_action='list' then
      select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]') into result from
        (select public.teamspace_agent_public(a) as item,a.created_at,a.id from public.teamspace_agent_runs a
          where workspace_id=w and expires_at>stamp and (initiator_id=u or exists(select 1 from public.teamspace_documents where path='workspaces/'||w||'/members/'||u and data->>'role' in ('owner','admin')))
          order by created_at desc,id limit 50) x;
      return jsonb_build_object('runs',result);
    end if;
    if p_action='create' then
      days:=(p_input->>'retentionDays')::integer;
      if coalesce(days,0) not between 1 and 365 or coalesce(length(btrim(p_input->>'prompt')),0) not between 1 and 16000
        or octet_length(p_input->>'prompt')>64000 or jsonb_typeof(ctx) is distinct from 'object' or octet_length(ctx::text)>1024
        or ctx-array['projectId','noteId']<>'{}'::jsonb or p_input->>'operationId' is null then return jsonb_build_object('error','invalid_input'); end if;
      perform pg_advisory_xact_lock(hashtextextended('teamspace_agent_queue:'||w,0));
      stamp:=clock_timestamp();
      digest:=encode(sha256(convert_to(jsonb_build_object('prompt',p_input->>'prompt','context',ctx)::text,'UTF8')),'hex');
      select * into receipt from public.teamspace_agent_requests where workspace_id=w and initiator_id=u and operation_id=(p_input->>'operationId')::uuid;
      if found then
        if receipt.digest<>digest then return jsonb_build_object('error','operation_conflict'); end if;
        select * into r from public.teamspace_agent_runs where id=receipt.run_id;
        if not found or r.expires_at<=stamp then return jsonb_build_object('error','expired'); end if;
        return jsonb_build_object('run',public.teamspace_agent_public(r),'replayed',true);
      end if;
      if ctx ? 'projectId' and not exists(select 1 from public.teamspace_projects where workspace_id=w and id=ctx->>'projectId') then return jsonb_build_object('error','invalid_context'); end if;
      if ctx ? 'noteId' and not exists(select 1 from public.teamspace_documents where path='workspaces/'||w||'/notes/'||(ctx->>'noteId') and not coalesce((data->>'deleting')::boolean,false)) then return jsonb_build_object('error','invalid_context'); end if;
      if (select count(*) from public.teamspace_agent_requests where workspace_id=w and initiator_id=u and created_at>=date_trunc('minute',stamp))>=10 then return jsonb_build_object('error','rate_limited'); end if;
      if (select count(*) from public.teamspace_agent_runs where workspace_id=w and initiator_id=u and expires_at>stamp and status in ('queued','running','retrying'))>=5
        or (select count(*) from public.teamspace_agent_runs where workspace_id=w and expires_at>stamp and status in ('queued','running','retrying'))>=20 then return jsonb_build_object('error','queue_full'); end if;
      insert into public.teamspace_agent_runs(workspace_id,initiator_id,prompt,context,expires_at)
        values(w,u,p_input->>'prompt',ctx,stamp+make_interval(days=>days)) returning * into r;
      insert into public.teamspace_agent_requests(workspace_id,initiator_id,operation_id,digest,run_id) values(w,u,(p_input->>'operationId')::uuid,digest,r.id);
      perform public.teamspace_agent_event(r.id,'queued','{}');
      select * into r from public.teamspace_agent_runs where id=r.id;
      return jsonb_build_object('run',public.teamspace_agent_public(r),'replayed',false);
    end if;
  end if;

  if p_action not in ('read','export','cancel','heartbeat','checkpoint') or p_action is null then return jsonb_build_object('error','invalid_input'); end if;
  select * into r from public.teamspace_agent_runs where id=(p_input->>'id')::uuid for update;
  stamp:=clock_timestamp();
  if not found or r.expires_at<=stamp then return jsonb_build_object('error','not_found'); end if;
  if p_action in ('read','export','cancel') then
    if r.workspace_id is distinct from w or not (r.initiator_id=u or exists(select 1 from public.teamspace_documents where path='workspaces/'||w||'/members/'||u and data->>'role' in ('owner','admin'))) then return jsonb_build_object('error','not_found'); end if;
    if p_action='cancel' then
      if r.status in ('queued','running','retrying') then
        update public.teamspace_agent_runs set status='cancelled',version=version+1,updated_at=stamp,error_code='cancelled',lease_token=null,lease_until=null,worker_id=null where id=r.id;
        perform public.teamspace_agent_event(r.id,'cancelled',jsonb_build_object('actor',u));
        select * into r from public.teamspace_agent_runs where id=r.id;
      end if;
      return jsonb_build_object('run',public.teamspace_agent_public(r));
    end if;
    select coalesce(jsonb_agg(to_jsonb(e) order by sequence),'[]') into events from public.teamspace_agent_events e where run_id=r.id;
    return jsonb_build_object('run',public.teamspace_agent_public(r),'events',events)||case when p_action='export' then
      jsonb_build_object('formatVersion',1,'exportedAt',stamp,'checkpoint',r.checkpoint) else '{}'::jsonb end;
  end if;

  -- Both heartbeats and checkpoints recheck account/membership/policy. A caller
  -- with an expired/replaced token cannot extend a lease or save a result.
  if r.status<>'running' or r.lease_until<=stamp or r.lease_token is distinct from (p_input->>'token')::uuid or r.worker_id is distinct from worker then return jsonb_build_object('error','lease_lost'); end if;
  denial:=public.teamspace_agent_authorized(r.workspace_id,r.initiator_id,required,true);
  if denial is not null then return jsonb_build_object('error',denial); end if;
  if p_action='heartbeat' then
    update public.teamspace_agent_runs set lease_until=stamp+interval '90 seconds' where id=r.id;
    return jsonb_build_object('leaseUntil',stamp+interval '90 seconds');
  end if;
  if r.version is distinct from (p_input->>'version')::integer then return jsonb_build_object('error','version_conflict'); end if;
  if target is null or target not in ('running','retrying','completed','failed') or kind is null
    or (target='running' and kind not in ('model_request','model_result','tool_request','tool_result'))
    or (target<>'running' and kind<>target) or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>300000
    or jsonb_typeof(p_input->'checkpoint') is distinct from 'object' or coalesce(p_input->'checkpoint'->>'version','')<>'1' or octet_length((p_input->'checkpoint')::text)>512000
    or (target='completed' and jsonb_typeof(p_input->'result') is distinct from 'object') or (target<>'completed' and p_input ? 'result')
    or (p_input ? 'result' and (jsonb_typeof(p_input->'result')<>'object' or octet_length((p_input->'result')::text)>64000))
    or (p_input ? 'errorCode' and coalesce(p_input->>'errorCode','') !~ '^[a-z_]{1,80}$') then return jsonb_build_object('error','invalid_input'); end if;
  -- Reserve space for claim/recovery/cancel/failure events even after a worker
  -- consumes its budget. Heartbeats do not create full-content audit entries.
  if r.last_sequence>=180 or r.event_bytes+octet_length(payload::text)>7500000 then return jsonb_build_object('error','audit_limit'); end if;
  if target='retrying' and r.attempts>=3 then target:='failed'; kind:='failed'; end if;
  update public.teamspace_agent_runs a set checkpoint=p_input->'checkpoint',result=case when target='completed' then p_input->'result' else a.result end,
    status=target,error_code=case when target in ('failed','retrying') then coalesce(p_input->>'errorCode','agent_failed') else null end,
    version=version+1,updated_at=stamp,available_at=case when target='retrying' then stamp+make_interval(secs=>least(60,power(2,r.attempts)::integer)) else available_at end,
    lease_token=case when target='running' then lease_token end,lease_until=case when target='running' then lease_until end,worker_id=case when target='running' then worker_id end where id=r.id;
  perform public.teamspace_agent_event(r.id,kind,payload);
  select * into r from public.teamspace_agent_runs where id=r.id;
  return jsonb_build_object('run',public.teamspace_agent_public(r));
end $$;
revoke all on function public.teamspace_agent_queue(text,jsonb) from public,anon,authenticated;
grant execute on function public.teamspace_agent_queue(text,jsonb) to service_role;
commit;
