begin;

create table if not exists public.teamspace_share_links (
  token text primary key,
  workspace_id text not null references public.teamspace_documents(id) on delete cascade,
  block_id text not null,
  permission text not null check (permission in ('read', 'edit')),
  enabled boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teamspace_share_links_workspace_block_idx
  on public.teamspace_share_links (workspace_id, block_id);

alter table public.teamspace_share_links enable row level security;

drop policy if exists teamspace_share_links_member_read on public.teamspace_share_links;
create policy teamspace_share_links_member_read on public.teamspace_share_links
  for select to authenticated
  using (
    exists (
      select 1
      from public.teamspace_documents m
      where m.workspace_id = teamspace_share_links.workspace_id
        and m.collection_name = 'members'
        and m.document_id = auth.uid()::text
    )
  );

revoke all on public.teamspace_share_links from anon, authenticated, service_role;
grant select on public.teamspace_share_links to authenticated;

commit;
