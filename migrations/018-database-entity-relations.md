# 018 — Task and project relations

Adds two initially empty, workspace-scoped indexes for links from database
entries to canonical tasks and projects. Each uses a same-workspace foreign key;
the existing entry-to-entry index and old definitions remain compatible. The
entry's stored property values remain authoritative. The paired trusted API and
UI accept task and project targets; deploy them together with this migration.
Existing entry relation values are not rewritten.

Confirmed workspace members may read the two indexes under RLS. Anonymous users
and direct authenticated/service-role writes are denied. New application writes
must still authorize membership, validate target existence and project archive
state, limit selection counts, and follow the store's serialized transaction
protocol. The paired API performs those checks. Authenticated browser and
two-user acceptance remain open.

Before a linked task is deleted, a trigger removes its ID from the authoritative
entry arrays and increments affected entry revisions in the same database
transaction. It fails the delete if an affected revision cannot safely advance.
Project deletion remains prohibited by the existing application policy; project
archive preserves links. Workspace deletion removes both indexes with their
source records. Database exports include entry property values; task and project
content must be exported separately. A full
workspace export remains an open feature.

Generate the two row types from an owned disposable PostgreSQL container with
`node scripts/generate-database-entity-link-types.mjs --container <test-container> --write`;
the PostgreSQL fixture checks them against its catalog. Run clean and populated
migration, RLS, foreign-key, deletion, concurrency and paired API/UI tests before
release. Staging is not migrated by development builds. Rollback must preserve
existing entry data and be reviewed before reverting the new writer.
