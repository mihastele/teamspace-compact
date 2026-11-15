begin;

alter table public.teamspace_share_links add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.teamspace_share_links drop constraint if exists teamspace_share_links_workspace_path_fkey;

grant all on public.teamspace_share_links to service_role;

commit;
