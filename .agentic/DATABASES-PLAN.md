# Independent databases and relations

2026-10-18: user prioritized database expansion over M4c and explicitly selected
adding databases alongside Tasks/Projects. Existing IDs and specialized task
behavior remain authoritative. PostgreSQL focus continues from the approved
October 17 architecture; Firebase/local preview retain their existing features.

First increment: named workspace databases, rich entry pages, ten typed property
kinds, multi-entry same/cross-database relations, derived incoming links, reviewed
saves, durable device-local draft/retry packets, reversible archives and
loaded-row JSON export with explicit truncation. Migration 016 extends member RLS and adds a
trigger-maintained FK relation projection. Existing transaction services, field
validators, block editor and Web Locks are reused; no dependency is needed.

The first table uses byte-bounded keyset pages, loaded-title search and
manual/first-page 30-second refresh. Database and entry edits use explicit Save; relation targets/types and
field/option identities stay immutable. Bounds and export/deletion policies are
in migrations/016-independent-databases.md. Tasks and Projects are not yet
relation targets in generic databases. Formulas/rollups and new saved layouts,
templates, comments/attachments and simultaneous editing remain future increments.

Verification: pure field/identity tests; disposable PostgreSQL persistence,
relation projection/FK validation, retry/CAS, archived/foreign links, RLS,
root deletion, clean/populated migrations; lint/typecheck/build; browser/manual
acceptance if an authenticated fixture is available. Never treat preview or a
successful build as evidence that live migrations or two-user flows passed.

2026-10-21: database table headers now sort loaded entries by title or any typed
property. Numeric values use numeric order; other fields use display text, with
relation name lists normalized independently of selection order. Empty values
stay last in both directions and equal values use stable entry IDs. Headers
expose aria-sort; a live count names loaded scope and current order. Reset or
switching databases returns to natural title order. Paging/refresh retain the
selected sort without changing cursor/query/export contracts or saved records.
No saved-layout schema or migration is introduced.

Relation picker follow-up (2026-10-21): local target-title search retains all
selected identities, including unavailable targets, with explicit uncheck/Clear
links. New archived targets and selections beyond 50 are disabled; removals
remain available. Failed reads preserve selections and offer retry. Existing
trusted save/archive validation, schema, export and recovery contracts remain.
Maintained Strict Mode manual fixture: npm run test:ui:database-relations;
component search/limits/archive/disabled/loading/retry/keyboard/390px checks pass.
Full editor, authenticated saves/two-user/recovery and automated DOM acceptance
remain open.

2026-10-30: added a local Table/List layout switch for the same loaded entries.
List entries show typed properties and navigable relation values; list sort
controls use the existing loaded-row sort and share search, archive and paging
state with the table. This is not a saved or workspace-shared view. Browser,
mobile and authenticated interaction acceptance remain open.

## Task and project relation increment

On 2026-10-30 the user chose one target kind per database relation property:
entries in one database, tasks, or projects. Existing entry relation definitions
remain compatible. Each property holds at most 50 distinct same-workspace IDs;
task/project IDs need not be UUIDs. Migration 018 adds typed task/project
projections with same-workspace foreign keys, member-read RLS and denied direct
writes. Trusted writes authorize and validate targets; archived projects cannot
be newly linked, while retained links can be kept or removed.

The user chose automatic removal of incoming database links on permanent task
deletion. The deletion trigger removes IDs from authoritative entry values and
advances revisions in the same transaction, preserving stale-draft detection.
Exports include outgoing IDs; export tasks/projects separately for their data.
Existing entry backlinks are unchanged. A task/project backlink UI for entries,
rollups, shared database views and block
migration remain future work. Authenticated browser/mobile/two-user and live
migration/restore acceptance remain open.

`src/lib/database-relation-target.ts` validates target kind and IDs; trusted
services separately check authorization, existence and archive state.

## Relations from task and project pages to database entries

On 2026-10-30 the user requested the direction shown in their reference: task
and project pages can define relation properties that choose a database as the
data source and select its entries. They chose separate task and project
property sets. This is distinct from entry properties that point to tasks or
projects; an incoming link alone does not provide this editing flow.

Migration 019 and the paired application add named relation definitions with one
immutable target database and explicit task or project scope. Each page value
holds up to 50 distinct entry IDs. Existing task properties retain their format.
The selector searches entries, retains or removes archived selections, and
blocks new archived selections. Property definitions are shared and created
immediately; selections save with the task or project. Task draft recovery and
reviewed revisions include selections; project saves keep their existing reviewed
revision/conflict behavior. Project pages display their relations in read-only
mode outside the editor. Values and definitions are included in board export;
target database content is exported separately.

PostgreSQL projections enforce same-workspace foreign keys with member-read RLS
and denied direct writes. Trusted services authorize writes and validate target
and archive state; task deletion removes its links and project archive retains
them. Workspace deletion cascades projections and removes definitions/receipts.
There is no hard-delete API for database entries; its future behavior must be
designed before it is added. Task/project incoming-link display on database
entries, opening linked entries directly from these pickers, project local draft
recovery and authenticated two-user/mobile acceptance remain open.

2026-10-30: independent databases additionally support Email and Phone as bounded text values. Their editors use email and telephone input modes; values are stored as entered, without claiming address or phone-number verification. They use the existing database record storage and access controls.

2026-10-30: user selected customizable Status options grouped into To do, In progress and Complete. New fields start with one option per group; options can be renamed, archived and moved between groups while preserving identity. Entry values select one option or remain empty; loaded-row sorting follows group then option order.
