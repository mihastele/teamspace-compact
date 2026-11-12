-- 021-teamspace-unified-schema.sql
-- Native PostgreSQL schema for Teamspace: unified blocks, database schemas, views, and relations.
begin;
select epoch from public.teamspace_store_state where singleton for update;

create table public.teamspace_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  parent_id uuid,
  type text not null check (length(type) between 1 and 64),
  title text not null default '',
  icon text,
  cover_url text,
  properties jsonb not null default '{}'::jsonb,
  content jsonb,
  position text collate "C" not null default 'a0',
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  created_by text,
  updated_by text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (parent_id) references public.teamspace_blocks(id) on delete cascade,
  check (id is distinct from parent_id)
);

create index teamspace_blocks_parent on public.teamspace_blocks(workspace_id, parent_id, position, id);
create index teamspace_blocks_type on public.teamspace_blocks(workspace_id, type);
create index teamspace_blocks_archived on public.teamspace_blocks(workspace_id, is_archived);

create table public.teamspace_database_properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  database_id uuid not null references public.teamspace_blocks(id) on delete cascade,
  name text not null,
  type text not null,
  options jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  position text collate "C" not null default 'a0'
);

create index teamspace_db_props on public.teamspace_database_properties(database_id, position);

create table public.teamspace_database_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  database_id uuid not null references public.teamspace_blocks(id) on delete cascade,
  name text not null,
  layout text not null check (layout in ('table','board','list','calendar')),
  filter jsonb not null default '{}'::jsonb,
  sorts jsonb not null default '[]'::jsonb,
  group_by text,
  visible_properties jsonb not null default '[]'::jsonb,
  position text collate "C" not null default 'a0'
);

create index teamspace_db_views on public.teamspace_database_views(database_id, position);

create table public.teamspace_block_relations (
  workspace_id text not null check (workspace_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  source_block_id uuid not null references public.teamspace_blocks(id) on delete cascade,
  target_block_id uuid not null references public.teamspace_blocks(id) on delete cascade,
  property_id text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (source_block_id, target_block_id)
);

create index teamspace_relations_target on public.teamspace_block_relations(target_block_id, source_block_id);

-- Row-Level Security
alter table public.teamspace_blocks enable row level security;
alter table public.teamspace_database_properties enable row level security;
alter table public.teamspace_database_views enable row level security;
alter table public.teamspace_block_relations enable row level security;

revoke all on public.teamspace_blocks, public.teamspace_database_properties, public.teamspace_database_views, public.teamspace_block_relations from public, anon, authenticated, service_role;
grant select on public.teamspace_blocks, public.teamspace_database_properties, public.teamspace_database_views, public.teamspace_block_relations to authenticated, service_role;

create policy teamspace_blocks_member_read on public.teamspace_blocks for select to authenticated
  using (public.teamspace_can_read('workspaces/' || workspace_id));

create policy teamspace_db_props_member_read on public.teamspace_database_properties for select to authenticated
  using (public.teamspace_can_read('workspaces/' || workspace_id));

create policy teamspace_db_views_member_read on public.teamspace_database_views for select to authenticated
  using (public.teamspace_can_read('workspaces/' || workspace_id));

create policy teamspace_relations_member_read on public.teamspace_block_relations for select to authenticated
  using (public.teamspace_can_read('workspaces/' || workspace_id));

update public.teamspace_store_state set epoch=epoch+1 where singleton;
commit;
