-- Add empty containment storage. No legacy content is migrated by this step.
begin;
select epoch from public.teamspace_store_state where singleton for update;

create table public.teamspace_blocks (
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  id uuid not null,
  parent_id uuid,
  kind text not null check (length(kind) between 1 and 64),
  position text collate "C" not null check (length(position) between 1 and 1024),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  workspace_path text generated always as ('workspaces/'||workspace_id) stored,
  primary key (workspace_id,id),
  foreign key (workspace_path) references public.teamspace_documents(path) on delete cascade,
  foreign key (workspace_id,parent_id) references public.teamspace_blocks(workspace_id,id) deferrable initially deferred,
  check (id is distinct from parent_id)
);
create index teamspace_blocks_children on public.teamspace_blocks(workspace_id,parent_id,position,id);

-- Serialize inserts, moves and reorders on the workspace row. Future trusted
-- deletion writers must take the same lock. Direct role writes are denied.
create function public.teamspace_validate_block_containment() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and (new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id) then
    raise exception 'Block identity is immutable';
  end if;
  perform 1 from public.teamspace_documents where path='workspaces/'||new.workspace_id for update;
  if not found then raise exception 'Workspace not found'; end if;
  if new.parent_id is not null and not exists (
    select 1 from public.teamspace_blocks where workspace_id=new.workspace_id and id=new.parent_id
  ) then raise exception 'Block parent not found'; end if;
  if exists (
    with recursive ancestry(id,parent_id) as (
      select id,parent_id from public.teamspace_blocks where workspace_id=new.workspace_id and id=new.parent_id
      union
      select parent.id,parent.parent_id from public.teamspace_blocks parent
        join ancestry child on child.parent_id=parent.id where parent.workspace_id=new.workspace_id
    ) select 1 from ancestry where id=new.id
  ) then raise exception 'Block containment cycle'; end if;
  return new;
end $$;
revoke all on function public.teamspace_validate_block_containment() from public,anon,authenticated,service_role;
create trigger teamspace_block_containment before insert or update of workspace_id,id,parent_id,position on public.teamspace_blocks
for each row execute function public.teamspace_validate_block_containment();

alter table public.teamspace_blocks enable row level security;
revoke all on public.teamspace_blocks from public,anon,authenticated,service_role;
grant select on public.teamspace_blocks to authenticated,service_role;
create policy workspace_member_read on public.teamspace_blocks for select to authenticated
using(public.teamspace_can_read(workspace_path));

update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
