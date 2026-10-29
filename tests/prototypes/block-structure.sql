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

-- An illustrative optimistic checkpoint and retry receipt, not a production API.
create table experiment_checkpoints (
  workspace_id text not null,
  block_id text not null,
  state bytea not null,
  revision integer not null default 0,
  primary key (workspace_id, block_id),
  foreign key (workspace_id, block_id) references experiment_blocks(workspace_id, id)
);
create table experiment_receipts (
  workspace_id text not null,
  block_id text not null,
  operation_id text not null,
  digest text not null,
  primary key (workspace_id, block_id, operation_id),
  foreign key (workspace_id, block_id) references experiment_checkpoints(workspace_id, block_id)
);
create function experiment_save(w text, block text, operation text, payload_digest text, expected integer, checkpoint bytea)
returns text language plpgsql as $$
declare previous_digest text; current_revision integer;
begin
  select revision into current_revision from experiment_checkpoints
    where workspace_id=w and block_id=block for update;
  if not found then raise exception 'checkpoint unavailable'; end if;
  select digest into previous_digest from experiment_receipts
    where workspace_id=w and block_id=block and operation_id=operation;
  if found then
    if previous_digest <> payload_digest then raise exception 'operation mismatch'; end if;
    return 'replayed';
  end if;
  if current_revision <> expected then return 'conflict'; end if;
  update experiment_checkpoints set state=checkpoint, revision=revision+1
    where workspace_id=w and block_id=block;
  insert into experiment_receipts values(w,block,operation,payload_digest);
  return 'applied';
end $$;
