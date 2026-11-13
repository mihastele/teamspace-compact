begin;

create table if not exists public.teamspace_share_links (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{4,64}$'),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  block_id text not null check (length(block_id) between 1 and 256),
  permission text not null check (permission in ('read', 'edit')),
  enabled boolean not null default true,
  created_by text,
  workspace_path text generated always as ('workspaces/' || workspace_id) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_path) references public.teamspace_documents(path) on delete cascade
);

create index if not exists teamspace_share_links_workspace_block_idx
  on public.teamspace_share_links (workspace_id, block_id);

alter table public.teamspace_share_links enable row level security;

drop policy if exists teamspace_share_links_member_read on public.teamspace_share_links;
create policy teamspace_share_links_member_read on public.teamspace_share_links
  for select to authenticated
  using (public.teamspace_can_read(workspace_path));

revoke all on public.teamspace_share_links from public, anon, authenticated, service_role;
grant select on public.teamspace_share_links to authenticated, service_role;

commit;
