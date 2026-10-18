# 016 — Independent databases and entry relations

User-selected architecture: add independent collections alongside Tasks/Projects.
PostgreSQL only; existing task IDs, boards, calendar, comments and attachments
retain their models. Apply after 015 with the tracked runner, or follow the
existing manual-install upgrade policy. Back up first and deploy matching API
and client. Builds never apply migrations to an installation.

## Storage and constraints

Workspace documents `databases/{uuid}` contain name, description, typed field
definitions, archive flag and reviewed revision. `databaseEntries/{uuid}` contain
an immutable database ID, title, rich text body, property values, archive flag
and revision. Scalar validation reuses the board's ten-type contract, except
relations select arrays of at most 50 distinct **entry** UUIDs in one immutable
target database. Both same-database and cross-database links are supported.
Field IDs/types/targets and option IDs cannot be removed or replaced. Existing
options can be renamed or archived. All content inherits workspace membership.

`teamspace_database_links` is a trigger-maintained projection of authoritative
entry relation arrays, not a second writable record source. Source/target/workspace
foreign keys prevent dangling or cross-workspace links. The trigger also checks
that each target entry belongs to the field's target database. Array edits replace
the projection atomically. An indexed, service-only RPC returns an entry and its
first 200 incoming links with a truncation flag. It rechecks membership, published
confirmation policy and the actual Auth confirmation record under the store lock.

Limits: 64 databases/workspace, 32 fields/database, 50 options/field,
1,000 entries/database including archives. Reads use descending entry-UUID keysets,
at most 20 full entries and a 1 MB entry payload budget/page (one legal entry always
fits). Relation choices use body-free pages of 100. Exports cover loaded rows and
report truncation. This increment retains the existing small-workspace
transaction/epoch model; it does not claim arbitrary-scale queries. The first table
page refreshes every 30 seconds; loading more pauses that reset until manual
Refresh. Reads are live pages, not a frozen backup. Saved forms retain reviewed revisions.
Formulas, rollups, database-specific saved layouts, templates, entry comments,
attachments, Task/Project targets and automatic reciprocal properties are deferred.
Incoming links are derived and cannot be edited independently.

## Trusted writes and access

PUT `/api/workspaces/:workspace/databases/:uuid` and
`/api/workspaces/:workspace/databaseEntries/:uuid` require expectedRevision and
operationId. Private actor/workspace operation receipts bind the full canonical
payload and mutation target. Exact retry returns current content without replaying
old state. Changed intent conflicts. Creates and schema/entry/archive races use
the existing serialized transaction boundary. Writes are limited to 60/user/minute
in addition to the API limit. New links require active target databases/entries;
historical archived links may remain or be cleared. Archived databases reject
entry writes until restored. No hard-delete API is exposed.

RLS remains enabled on the document/state tables and is enabled on the new link
table. Current confirmed members can read definitions, entries and links; outsiders
cannot. Browser/service-role direct writes and browser execution of internal RPCs
are denied. `databaseOperations` receipts remain SDK-private. The added server
read port forwards the auth-policy guard rather than accepting client authority.

## Export, archive and deletion

Loaded database JSON export includes its saved definition, full entry bodies, option
identities and outgoing relation IDs, including loaded archived entries. The
truncated flag requires loading remaining pages for a full collection export. Export linked
databases separately to obtain target bodies. The entry API includes incoming
link metadata. No attachment bytes or comments belong to new entries in this slice.
Archive is reversible and retains content/links. Workspace-root deletion and the
existing recursive prefix cleanup erase definitions, entries and private receipts;
link rows cascade. Permanent minimal save receipts follow existing workspace-life
idempotency policy and contain hashes/IDs/revisions, never body copies. Full
account/workspace export/deletion UI remains the existing open feature.

Device-local drafts are account/workspace/record scoped and require Web Locks.
New-entry and new-database drafts have stable recovery slots. Writes persist an
exact request packet before sending and freeze uncertain packets for safe retry.
Conflicts preserve the draft and require downloading/reopening/reviewing before
reapplying edits; there is no automatic merge. Clearing browser storage removes
drafts. Browsers without Web Locks remain read-only. Draft JSON download is
separate from saved-data export.

## Verification and rollback

Clean tracked install, populated upgrade, relational constraints, option/body
round trips, safe retry/conflict/archival, member/outsider/confirmation RLS,
private receipts and root deletion must pass against disposable PostgreSQL.
TypeScript contracts are maintained and compiled; this repo has no ORM generator.
Live migration, authenticated browser/two-user acceptance and restored-backup
acceptance remain release gates. Code-only rollback may hide the feature but
must not drop content; destructive reversal requires a reviewed migration or backup.
