# 019 — Task and project relations to database entries

Adds separate workspace-scoped task and project relation properties. Each
definition names one immutable target database. Selected entry IDs are stored in
the task or project record and saved with that page's reviewed revision. Two
trigger-maintained projections index incoming links and enforce same-workspace
foreign keys. Existing task properties and database-entry relation definitions
are unchanged. Apply this migration and deploy the paired API/client together.

The new projection tables have member-read RLS using the existing confirmation
policy; anonymous reads and direct authenticated/service-role writes are denied.
Property definitions and minimal retry receipts use the existing private
document table; trusted APIs reauthorize membership and check target existence,
scope, archive state and limits. A property definition has at most 50 selected
entries per page; each scope supports at most 32 properties. Archived targets
can be retained or removed but cannot be newly selected.

Task deletion removes its projection rows; project archive preserves them.
Workspace deletion removes definitions, receipts and projections. There is no
application hard-delete for database entries; before adding one, design how its
authoritative incoming values are handled. Direct administrative deletion of an
entry is not a supported replacement for that policy. Board JSON export includes
task/project relation values and their definitions; export target databases
separately for entry content. Full workspace export remains an open feature.

Generate row types using `node scripts/generate-database-entity-link-types.mjs
--container <owned-test-container> --write`; the integration fixture verifies the
generated types against a clean catalog. Verify clean and populated migrations,
access, retries, archive/deletion races, drafts and two-user UI before release.
Development builds do not migrate staging or production. Rollback must preserve
stored page values and requires a reviewed migration.
