-- Isolated research fixture. This is not an application migration or access policy.
create table experiment_workspaces (id text primary key);
create table experiment_blocks (
  workspace_id text not null references experiment_workspaces(id),
  id text not null,
  parent_id text,
  primary key (workspace_id, id),
  foreign key (workspace_id, parent_id) references experiment_blocks(workspace_id, id),
  check (id <> parent_id)
);
create table experiment_content (
  workspace_id text not null,
  block_id text not null,
  text_value text not null,
  primary key (workspace_id, block_id),
  foreign key (workspace_id, block_id) references experiment_blocks(workspace_id, id)
);

-- Every structural mutation in this experiment must use this serialization lock.
create function experiment_move(w text, block text, new_parent text) returns void
language plpgsql as $$
begin
  perform 1 from experiment_workspaces where id = w for update;
  if not found then raise exception 'workspace unavailable'; end if;
  if not exists (select 1 from experiment_blocks where workspace_id=w and id=block)
     or (new_parent is not null and not exists
         (select 1 from experiment_blocks where workspace_id=w and id=new_parent)) then
    raise exception 'block unavailable';
  end if;
  if exists (
    with recursive ancestry(id, parent_id) as (
      select id, parent_id from experiment_blocks where workspace_id=w and id=new_parent
      union
      select p.id, p.parent_id from experiment_blocks p join ancestry a on p.id=a.parent_id
      where p.workspace_id=w
    ) select 1 from ancestry where id=block
  ) then raise exception 'cycle'; end if;
  update experiment_blocks set parent_id=new_parent where workspace_id=w and id=block;
end $$;
