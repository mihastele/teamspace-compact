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
