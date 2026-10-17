# 012 — Canonical PostgreSQL Projects, Tasks and custom fields

Apply `012-canonical-projects-fields.sql` **after 007, 008 and 009**, using an
administrative SQL connection. The tracked migration runner includes it. This
upgrade targets Supabase/PostgreSQL only; Firebase keeps the existing four field
types and workspace board. No production or local installation is automatically
migrated by building the app.

## What changes

Existing task IDs, field UUIDs, option UUIDs, parent references and task mutation
receipts remain valid. Tasks and Projects move to canonical tables. Their base
record JSON preserves existing application metadata; generated core columns and
indexes support Project, status, assignee, priority and due-date queries. Task
JSON no longer contains a second copy of custom values. Field definitions,
ordered/color-coded/archivable options, typed scalar values and multi-select
selection rows are authoritative relational records with foreign keys.

The six tables are `teamspace_projects`, `teamspace_tasks`,
`teamspace_field_definitions`, `teamspace_field_options`,
`teamspace_task_field_values`, and `teamspace_task_field_selections`.
Maintained TypeScript models/validators in `src/lib/model.ts` and
`src/lib/board-properties.ts` are the application schema types; there is no ORM
or generated database client schema in this repository.

`teamspace_all_records` is a security-invoker compatibility view. Existing
transactional store RPCs read this view and route writes to the canonical tables
under the same epoch lock. Migrated rows are removed from `teamspace_documents`;
a constraint prevents a second writable copy. Notes, comments, attachment
metadata, operation receipts and other records stay in the document table.
Task/comment/attachment IDs do not change. Field options acquire explicit default
`color: gray` and `archived: false`; values retain their original IDs and order,
including null, empty arrays and absent property maps.

This remains the existing small-workspace snapshot/global-epoch design. The
indexes prepare the schema for M3; nested indexed query endpoints, pagination
contracts and reusable saved views are separate work, not implemented here.

## Lifecycle and authorization

Projects inherit workspace access. All current members may create/edit/archive
them; PATCH requires a reviewed revision. Create accepts a UUID operation ID and
converges retries to one Project. Archive/restore preserves tasks and references;
new assignments and new relation values reject archived Projects. Existing links
remain editable. Project hard deletion is not exposed. An epoch-serialized
archive/assignment race either commits assignment before archiving or rejects it.

Custom fields support text, longText, number, date, checkbox, select, multiSelect,
person, relation (Project), and URL. Definitions can be workspace-wide or scoped
to a Project. Scope and type cannot change. Existing values survive moving a
task to another Project; new values must match its current scope (clearing is
allowed). New person/relation values require a current member/active same-workspace
Project. Historical removed-member/archived-Project values can remain unchanged.
Archived options remain readable and can be retained or cleared, but cannot be
newly selected. Option IDs cannot be removed or replaced.

RLS is enabled on all six new tables, plus the existing document/state/ledger
tables. Authenticated users get SELECT only after the existing membership and
email-confirmation policy. Anonymous access and direct authenticated/service-role
table writes are denied by privileges. The view respects those policies; the
internal canonical writer is not executable by application roles. Only the
existing service-only transaction RPCs write. Trusted HTTP services validate and
authorize inside transactions; root administration does not grant content access.

Realtime publishes changes from all six tables through the existing shared
workspace channel. Events invalidate authorized snapshots; they are not applied
as authoritative client writes. Existing periodic reconciliation remains active.

## Export and deletion

Download board JSON includes saved Projects, tasks and hydrated field definitions,
including stable option IDs, option metadata and values. It excludes attachments
and conversations, as before. Authorized task/Project detail and workspace
snapshot APIs use the same canonical records. Full account/workspace export and
deletion UI remains an explicitly open product feature.

Task deletion cascades typed values and multi-select rows. Project archival
retains content. Workspace-root deletion cascades all six tables through their
workspace foreign keys; existing document-prefix cleanup handles their associated
comments/attachments/receipts. File bytes still require the existing attachment
cleanup workflow. Permanent minimal operation receipts retain the migration 011
workspace-lifetime policy; full agent audit retention is future agent work.

## Upgrade, verification and rollback

Stop old API/worker writers, take a database/Storage backup, apply this migration,
then deploy the paired API/client. Backfill and cutover run in one transaction
under the store lock. Invalid historical types, missing definitions or foreign
option/Project IDs abort and roll back the **entire** migration. Inspect and repair
invalid data through an approved migration before retrying; do not discard values.
For previously manual installations, apply only unapplied numbered SQL files;
do not replay 007 or fabricate ledger receipts.

Direct clients reading tasks/fields from `teamspace_documents` must switch to
`teamspace_all_records` or the trusted APIs. Current browser sync already uses
authorized snapshots. Do not roll back SQL by dropping canonical tables. Rollback
requires a reviewed reverse migration or restoring the pre-upgrade backup while
writes are stopped; a code-only rollback is not sufficient for direct old readers.

The isolated PostgreSQL suite exercises clean tracked installs, populated legacy
backfill, failed-backfill rollback, task/option identity preservation, all ten
types, scope checks, archive races, option label swaps, RLS/confirmation/SDK denial
and deletion cascades. Live Auth, Realtime delivery, upgraded two-user browser
acceptance and backup/restore acceptance remain deployment gates.
