-- Additive application JSON shapes are documented in 008-workspace-administration.md.
-- Run after 007 on Supabase. Firebase needs no SQL or permission changes.
begin;
create function public.teamspace_registered_account_id(p_email text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare ids uuid[];
begin
  if p_email is null or length(p_email)>254 then return null; end if;
  select array_agg(id) into ids from (
    select id from auth.users where lower(email)=lower(trim(p_email)) limit 2
  ) matches;
  -- Ambiguous provider identities never select an arbitrary account.
  if coalesce(array_length(ids,1),0)<>1 then return null; end if;
  return ids[1]::text;
end $$;
revoke all on function public.teamspace_registered_account_id(text) from public,anon,authenticated;
grant execute on function public.teamspace_registered_account_id(text) to service_role;
commit;
