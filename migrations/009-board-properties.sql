begin;

-- Extend the existing member-read policy to additive property definition records.
create or replace function public.teamspace_can_read(p_path text) returns boolean language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare parts text[] := string_to_array(p_path,'/'); uid text := auth.uid()::text; needs_confirmation boolean;
begin
  if uid is null then return false; end if;
  select (data->>'emailConfirmationRequired')::boolean into needs_confirmation from public.teamspace_documents where path='security/policy';
  if coalesce(needs_confirmation,true) and not exists(select 1 from auth.users where id::text=uid and email_confirmed_at is not null) then return false; end if;
  if array_length(parts,1)=2 and parts[1]='users' then return parts[2]=uid; end if;
  if parts[1]<>'workspaces' or not exists(select 1 from public.teamspace_documents where path='workspaces/'||parts[2]||'/members/'||uid) then return false; end if;
  if array_length(parts,1)=2 then return true; end if;
  if array_length(parts,1)=4 and parts[3] in ('members','tasks','notes','attachments','boardProperties') then return true; end if;
  if array_length(parts,1)=6 and ((parts[3] in ('tasks','notes') and parts[5]='comments') or (parts[3]='notes' and parts[5]='presence')) then
    return exists(select 1 from public.teamspace_documents where path=array_to_string(parts[1:4],'/') and not coalesce((data->>'deleting')::boolean,false));
  end if;
  return false;
end $$;
revoke all on function public.teamspace_can_read(text) from public;
grant execute on function public.teamspace_can_read(text) to authenticated;

commit;
