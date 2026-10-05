-- Administrative migration bookkeeping only; never exposed to app/browser roles.
begin;
create table if not exists public.teamspace_schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default clock_timestamp()
);
alter table public.teamspace_schema_migrations enable row level security;
revoke all on public.teamspace_schema_migrations from public,anon,authenticated,service_role;
commit;
