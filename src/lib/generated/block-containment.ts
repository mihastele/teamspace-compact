// Generated from PostgreSQL by scripts/generate-block-types.mjs. Do not edit.
// PostgREST JSON represents revision as a number; raw pg drivers may return bigint as a string.
// The migration constrains revision to JavaScript safe integers.
export type BlockContainmentRow = {
  workspace_id: string;
  id: string;
  parent_id: string | null;
  kind: string;
  position: string;
  revision: number;
  workspace_path: string | null;
};
