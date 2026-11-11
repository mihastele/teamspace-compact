// Generated from PostgreSQL by scripts/generate-database-entity-link-types.mjs. Do not edit.
export type DatabaseTaskLinkRow = {
  workspace_id: string;
  source_path: string;
  field_id: string;
  task_id: string;
};
export type DatabaseProjectLinkRow = {
  workspace_id: string;
  source_path: string;
  field_id: string;
  project_id: string;
};
export type TaskDatabaseRelationRow = {
  workspace_id: string;
  task_id: string;
  field_path: string;
  entry_path: string;
};
export type ProjectDatabaseRelationRow = {
  workspace_id: string;
  project_id: string;
  field_path: string;
  entry_path: string;
};
