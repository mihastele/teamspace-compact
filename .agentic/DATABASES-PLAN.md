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

## Proposed task and project relation increment

On 2026-10-30 the user requested task and project relation targets and chose
one target kind per relation property. Keep the existing database-entry relation
format and its immutable target database compatible; new relation properties
would instead name either tasks or projects as their immutable target kind.
Each property can hold multiple distinct same-workspace IDs, within the existing
50-link bound. Existing task/project IDs must remain valid; do not assume their
IDs are UUIDs merely because database entry IDs are. Existing relation data and
drafts need an upgrade-compatible interpretation.

Tasks and projects are stored in their own canonical PostgreSQL tables, so the
existing entry-only projection and foreign key cannot simply be reused for
their targets. A new numbered migration and trusted writer need typed,
same-workspace referential checks, indexed backlinks, appropriate RLS and
direct-write denial. A target lookup must distinguish task titles and project
names and respect membership. Existing archived-project rules should prevent
new links while retaining or removing existing links. Task deletion and
references require an explicit policy before implementing the migration; do not
silently cascade links or block existing deletes. Confirm transaction ordering,
concurrent link/deletion behavior, export and workspace deletion, pagination,
type regeneration and rollback before implementation. Scope this increment to
database-entry properties; reciprocal editable task/project properties, rollups
and block migration remain separate work.

Verification must include clean and populated upgrades, old-format relations and
drafts, all three target kinds, cross-workspace and outsider denial, archived
projects, link/delete races, exact retries, backlinks, export and workspace
deletion, plus authenticated UI and mobile acceptance. No migration or app
writer for these targets is present yet.
